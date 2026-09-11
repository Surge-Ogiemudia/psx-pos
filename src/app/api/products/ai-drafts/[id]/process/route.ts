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
    itemName: { type: Type.STRING, description: "The core product name (e.g. Paracetamol, Coca Cola). Leave empty if not found." },
    brand: { type: Type.STRING, description: "The manufacturer or brand. Leave empty if not found." },
    size: { type: Type.STRING, description: "The strength or size (e.g. 500mg, 50cl). Leave empty if not found." },
    expiryDate: { type: Type.STRING, description: "The expiry date in YYYY-MM-DD format. Leave empty if not found." },
    barcode: { type: Type.STRING, description: "The barcode or UPC. Leave empty if not found." }
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
      const prompt = `You are a product data extraction assistant for a pharmacy/supermarket POS.
Extract the product details from the packaging images provided. Be accurate. If a field is not visible in the images, leave it empty.`;
      
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

      const candidateModels = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];
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

      // 5. Create Real Product
      const newProduct = await Product.create({
        pharmacyId: draft.pharmacyId,
        branchId: draft.branchId,
        itemName: extracted.itemName || "Unnamed Product",
        brand: extracted.brand || "Unknown Brand",
        size: extracted.size || "Standard",
        category: "supermarket", // Default, user can change later if needed
        imageUrl: draft.frontImageUrl,
        quantityInStock: draft.quantityInStock,
        retailPrice: draft.retailPrice || 0,
        wholesalePrice: 0,
        distributorPrice: 0,
        costPrice: 0,
        alertQuantity: Math.max(1, Math.floor(draft.quantityInStock * 0.2)),
        unitHierarchy: [{ unitName: "Piece", unitsPerParent: 1 }],
        barcode: extracted.barcode || "",
        expiryDate: extracted.expiryDate ? new Date(extracted.expiryDate) : null,
      });

      // 6. Mark Draft Complete
      draft.status = "completed";
      draft.productId = newProduct._id;
      draft.errorMsg = null;
      await draft.save();

      return NextResponse.json({ success: true, product: newProduct });

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
