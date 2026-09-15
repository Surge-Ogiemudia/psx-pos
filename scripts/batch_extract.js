const fs = require('fs');
const mongoose = require('c:/Users/HP/Desktop/zipped pharmastackx/node_modules/mongoose');
const { GoogleGenAI, Type } = require('C:/Users/HP/Desktop/synkk/Synkk/node_modules/@google/genai');

// Load environment variables
const env = fs.readFileSync('c:/Users/HP/Desktop/psx-pos/.env.local', 'utf8');
const mongoUri = env.split('\n').find(l => l.startsWith('MONGODB_URI=')).slice('MONGODB_URI='.length).trim();
const rawApiKey = env.split('\n').find(l => l.startsWith('GEMINI_API_KEY='));
const apiKey = rawApiKey ? rawApiKey.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '') : null;

if (!apiKey) {
  console.error("Missing GEMINI_API_KEY in .env.local");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const pharmacyId = '6aa3cdfd7f1e8b4387e43c22';

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    itemName: { type: Type.STRING, description: "The product or medicine name (e.g. Paracetamol, Augmentin, Body Lotion). Include dosage form if visible (e.g. Tablets, Suspension, Syrup, Cream). Leave empty if not found." },
    brand: { type: Type.STRING, description: "The manufacturer, pharmaceutical company, or brand (e.g. Emzor, GSK, Pfizer, Dove). Leave empty if not found." },
    size: { type: Type.STRING, description: "The dosage strength or package size (e.g. 500mg, 250mg/5ml, 1g, 20/120mg, 100ml, 50cl). For medicines, prioritize the active strength. Leave empty if not found." },
    expiryDate: { type: Type.STRING, description: "The expiry date in YYYY-MM-DD format. Leave empty if not found." },
    barcode: { type: Type.STRING, description: "The barcode or UPC/EAN. Leave empty if not found." }
  },
  required: ["itemName", "brand", "size", "expiryDate", "barcode"]
};

async function fetchImageAsBase64(url) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    try {
      const imgRes = await fetch(url, { signal: controller.signal });
      if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.statusText}`);
      const arrayBuffer = await imgRes.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString("base64");
      const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
      return { mimeType, base64Data };
    } catch (err) {
      lastErr = err;
      if (attempt === 1) await new Promise(r => setTimeout(r, 1000));
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastErr || new Error(`Failed to fetch image from ${url}`);
}

async function extractWithGemini(frontUrl, backUrl) {
  const parts = [];
  const prompt = `You are an expert product and medicine data extraction assistant for a pharmacy and supermarket POS.
Extract the product details from the packaging images provided.
For pharmaceuticals and medicines:
- Identify the product or generic name, and include the dosage form (e.g., Tablets, Capsules, Syrup, Suspension, Injection) if visible.
- Look closely for the dosage strength (e.g., 500mg, 250mg/5ml, 1g, 20/120mg, 100ml) on the front or back and extract it into the 'size' field.
- Extract the pharmaceutical manufacturer or brand into the 'brand' field.
- If barcode or expiry date is visible, extract them accurately.
Be accurate. If a field is not visible in the images, leave it empty.`;

  parts.push({ text: prompt });

  const frontImg = await fetchImageAsBase64(frontUrl);
  parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.base64Data } });

  if (backUrl) {
    try {
      const backImg = await fetchImageAsBase64(backUrl);
      parts.push({ inlineData: { mimeType: backImg.mimeType, data: backImg.base64Data } });
    } catch (e) {
      // Non-critical if back image fails
    }
  }

  const aiConfig = {
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.1
    }
  };

  const candidateModels = ["gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"];
  let lastErr = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const candidateModel of candidateModels) {
      try {
        const response = await ai.models.generateContent({ model: candidateModel, ...aiConfig });
        if (response && response.text) {
          const raw = response.text.trim();
          const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
          return JSON.parse(cleaned);
        }
      } catch (err) {
        lastErr = err;
        if (err.status === 429) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }

  throw lastErr || new Error("Failed extraction with all models");
}

async function run() {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  const draftsCollection = db.collection('aidraftproducts');

  // Limit can be passed via CLI: node batch_extract.js [limit] [concurrency]
  const limitArg = process.argv[2] ? parseInt(process.argv[2], 10) : 0;
  const concurrency = process.argv[3] ? parseInt(process.argv[3], 10) : 4;

  let query = {
    pharmacyId: new mongoose.Types.ObjectId(pharmacyId),
    status: { $in: ['pending', 'error'] }
  };

  let cursor = draftsCollection.find(query).sort({ createdAt: 1 });
  if (limitArg > 0) cursor = cursor.limit(limitArg);

  const pendingDrafts = await cursor.toArray();
  const total = pendingDrafts.length;

  console.log(`\n======================================================`);
  console.log(`🚀 Starting Batch AI Extraction for ${total} items`);
  console.log(`Concurrency: ${concurrency} parallel workers`);
  console.log(`======================================================\n`);

  if (total === 0) {
    console.log("No pending or error drafts to process!");
    process.exit(0);
  }

  let completed = 0;
  let successCount = 0;
  let errorCount = 0;

  async function processDraft(draft) {
    try {
      const extracted = await extractWithGemini(draft.frontImageUrl, draft.backImageUrl);

      const itemName = extracted.itemName || "Unnamed Product";
      const brand = extracted.brand || "Unknown Brand";
      const size = extracted.size || "Standard";
      const barcode = extracted.barcode || "";
      const expiryDate = extracted.expiryDate ? new Date(extracted.expiryDate) : null;

      const reasons = [];
      const price = Number(draft.retailPrice || 0);
      const qty = Number(draft.quantityInStock || 0);
      const cat = draft.category || "medicine";
      const fullName = `${itemName} ${brand} ${size}`.toLowerCase();

      // 1. Price checks
      if (price <= 0) reasons.push("zero_price");
      else if (price < 50) reasons.push("unlikely_low_price");
      else if (price > 50000) reasons.push("high_price_check");

      // 2. Quantity checks
      if (qty <= 0) reasons.push("zero_qty");
      else if (qty > 100) reasons.push("high_qty_check");

      // 3. Name checks
      if (!itemName || itemName.toLowerCase().includes("unnamed") || itemName.length < 3) {
        reasons.push("missing_name");
      }

      // 4. Expiry checks
      if (expiryDate) {
        if (expiryDate < new Date()) reasons.push("past_expiry");
        const year = expiryDate.getFullYear();
        if (year > 2040 || year < 2020) reasons.push("unlikely_expiry_year");
      } else if (cat === "medicine") {
        reasons.push("missing_expiry");
      }

      // 5. Category mismatch check
      const pharmaKeywords = ["mg", "tablet", "tablets", "capsule", "capsules", "syrup", "suspension", "injection", "infusion", "ointment", "antibiotic", "paracetamol", "amoxicillin", "ampicillin", "metronidazole", "artemether", "lumefantrine", "ciprofloxacin", "ibuprofen", "diclofenac", "inhaler", "suppository"];
      const supermarketKeywords = ["biscuit", "biscuits", "wafer", "wafers", "drink", "drinks", "coca cola", "fanta", "sprite", "pepsi", "malt", "water", "detergent", "bleach", "soap", "toothpaste", "toilet roll", "tissue", "sponge", "cleaner", "deodorant", "perfume", "diaper", "diapers", "milk", "tea", "coffee", "sugar"];

      const hasPharma = pharmaKeywords.some(k => fullName.includes(k));
      const hasSuper = supermarketKeywords.some(k => fullName.includes(k));

      if (cat !== "medicine" && hasPharma) {
        reasons.push("looks_like_medicine");
      } else if (cat === "medicine" && hasSuper && !hasPharma) {
        reasons.push("looks_like_supermarket");
      }

      await draftsCollection.updateOne(
        { _id: draft._id },
        {
          $set: {
            status: "extracted",
            extractedItemName: itemName,
            extractedBrand: brand,
            extractedSize: size,
            extractedBarcode: barcode,
            extractedExpiryDate: expiryDate,
            needsReviewReason: reasons,
            errorMsg: null,
            updatedAt: new Date()
          }
        }
      );

      completed++;
      successCount++;
      const pct = ((completed / total) * 100).toFixed(1);
      console.log(`[${completed}/${total}] (${pct}%) ✅ "${itemName}" | Brand: "${brand}" | Size: "${size}" | Qty: ${draft.quantityInStock} | ₦${draft.retailPrice || 0}`);
    } catch (err) {
      completed++;
      errorCount++;
      const pct = ((completed / total) * 100).toFixed(1);
      console.error(`[${completed}/${total}] (${pct}%) ❌ Error on draft ${draft._id}: ${err.message}`);

      await draftsCollection.updateOne(
        { _id: draft._id },
        {
          $set: {
            status: "error",
            errorMsg: err.message,
            updatedAt: new Date()
          }
        }
      );
    }
  }

  // Worker pool
  let index = 0;
  async function worker() {
    while (index < pendingDrafts.length) {
      const current = pendingDrafts[index++];
      await processDraft(current);
      // Small breath to respect rate limits
      await new Promise(r => setTimeout(r, 600));
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  console.log(`\n======================================================`);
  console.log(`🏁 Batch Extraction Complete!`);
  console.log(`Total: ${total} | Success: ${successCount} | Errors: ${errorCount}`);
  console.log(`======================================================\n`);

  process.exit(0);
}

run().catch(err => {
  console.error("Fatal error in batch runner:", err);
  process.exit(1);
});
