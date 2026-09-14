import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import { requireApiSession } from "@/lib/session";
import { GoogleGenAI, Type, Schema } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || "dummy-key" });

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    itemName: { type: Type.STRING, description: "The product or medicine name (e.g. Paracetamol, Augmentin, Coca Cola). Include dosage form if visible (e.g. Tablets, Suspension, Syrup). Leave empty if not found." },
    brand: { type: Type.STRING, description: "The manufacturer, pharmaceutical company, or brand (e.g. Emzor, GSK, Pfizer). Leave empty if not found." },
    size: { type: Type.STRING, description: "The dosage strength or package size (e.g. 500mg, 250mg/5ml, 1g, 20/120mg, 100ml, 50cl). For medicines, prioritize the active strength. Leave empty if not found." },
    expiryDate: { type: Type.STRING, description: "The expiry date in YYYY-MM-DD format. Leave empty if not found." },
    barcode: { type: Type.STRING, description: "The barcode or UPC/EAN. Leave empty if not found." }
  },
  required: ["itemName", "brand", "size", "expiryDate", "barcode"]
};

// Helper to fetch image and return base64
async function fetchImageAsBase64(url: string) {
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`Failed to fetch image from URL: ${url}`);
  const arrayBuffer = await imgRes.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
  return { mimeType, base64Data };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

    await dbConnect();
    
    const resolvedParams = await params;

    const { searchParams } = new URL(req.url);
    const stageOnly = searchParams.get("stageOnly") === "true";

    // 1. Fetch Draft
    const draft = await AiDraftProduct.findOne({ _id: resolvedParams.id, pharmacyId: session.user.pharmacyId });
    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (draft.status === "completed") return NextResponse.json({ error: "Already completed" }, { status: 400 });

    // 2. Mark as processing
    draft.status = "processing";
    await draft.save();

    try {
      // 3. Prepare images for Gemini
      const parts: any[] = [];
      const prompt = `You are an expert product and medicine data extraction assistant for a pharmacy and supermarket POS.
Extract the product details from the packaging images provided.
For pharmaceuticals and medicines:
- Identify the product or generic name, and include the dosage form (e.g., Tablets, Capsules, Syrup, Suspension) if visible.
- Look closely for the dosage strength (e.g., 500mg, 250mg/5ml, 1g, 20/120mg, 100ml) on the front or back and extract it into the 'size' field.
- Extract the pharmaceutical manufacturer or brand into the 'brand' field.
- If barcode or expiry date is visible, extract them accurately.
Be accurate. If a field is not visible in the images, leave it empty.`;
      
      parts.push({ text: prompt });

      // Add Front Image
      const frontImg = await fetchImageAsBase64(draft.frontImageUrl);
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.base64Data } });

      // Add Back Image if it exists
      if (draft.backImageUrl) {
        const backImg = await fetchImageAsBase64(draft.backImageUrl);
        parts.push({ inlineData: { mimeType: backImg.mimeType, data: backImg.base64Data } });
      }

      // 4. Call Gemini
      let response;
      const aiConfig: any = {
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature: 0.1
        }
      };

      const candidateModels = ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];
      let lastErr: any = null;

      for (const candidateModel of candidateModels) {
        try {
          response = await ai.models.generateContent({ model: candidateModel, ...aiConfig });
          if (response?.text) break;
        } catch (apiErr: any) {
          lastErr = apiErr;
          console.warn(`Model ${candidateModel} failed:`, apiErr?.message);
        }
      }

      if (!response?.text) {
        throw lastErr || new Error("Failed to extract product details from all available AI models.");
      }

      const text = response.text;
      const extracted = JSON.parse(text);

      // Save extracted values on draft
      draft.extractedItemName = extracted.itemName || "Unnamed Product";
      draft.extractedBrand = extracted.brand || "Unknown Brand";
      draft.extractedSize = extracted.size || "Standard";
      draft.extractedBarcode = extracted.barcode || "";
      draft.extractedExpiryDate = extracted.expiryDate ? new Date(extracted.expiryDate) : null;

      const reasons: string[] = [];
      if (!draft.retailPrice || draft.retailPrice <= 0) reasons.push("zero_price");
      if (!extracted.itemName || extracted.itemName.toLowerCase().includes("unnamed") || extracted.itemName.length < 3) {
        reasons.push("missing_name");
      }
      if (draft.retailPrice && draft.retailPrice > 100000) reasons.push("outlier_price");
      if (draft.quantityInStock && draft.quantityInStock > 500) reasons.push("outlier_qty");
      draft.needsReviewReason = reasons;

      // If stageOnly requested, finish at extracted stage
      if (stageOnly) {
        draft.status = "extracted";
        draft.errorMsg = null;
        await draft.save();
        return NextResponse.json({ success: true, draft });
      }

      // 5. Create Real Product (Direct Mode)
      const newProduct = await Product.create({
        pharmacyId: draft.pharmacyId,
        branchId: draft.branchId,
        itemName: draft.extractedItemName,
        brand: draft.extractedBrand,
        size: draft.extractedSize,
        category: draft.category || "supermarket",
        imageUrl: draft.frontImageUrl,
        quantityInStock: draft.quantityInStock,
        retailPrice: draft.retailPrice || 0,
        wholesalePrice: 0,
        distributorPrice: 0,
        costPrice: 0,
        alertQuantity: Math.max(1, Math.floor(draft.quantityInStock * 0.2)),
        unitHierarchy: [{ unitName: "Piece", unitsPerParent: 1 }],
        barcode: draft.extractedBarcode,
        expiryDate: draft.extractedExpiryDate,
      });

      // 6. Mark Draft Complete
      draft.status = "completed";
      draft.productId = newProduct._id;
      draft.errorMsg = null;
      await draft.save();

      return NextResponse.json({ success: true, product: newProduct, draft });

    } catch (processError: any) {
      draft.status = "error";
      draft.errorMsg = processError.message || "Failed to process images";
      await draft.save();
      throw processError;
    }

  } catch (error: any) {
    console.error("AI Draft Processing Error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
