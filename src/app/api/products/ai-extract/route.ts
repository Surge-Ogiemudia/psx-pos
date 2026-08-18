import { NextRequest, NextResponse } from "next/server";
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
    barcode: { type: Type.STRING, description: "The barcode or UPC. Leave empty if not found." },
    missingFields: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of fields from [itemName, brand, size, expiryDate, barcode] that you could NOT confidently find in the image."
    }
  },
  required: ["itemName", "brand", "size", "expiryDate", "barcode", "missingFields"]
};

export async function POST(req: NextRequest) {
  try {
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured." }, { status: 500 });
    }

    const { imageUrl } = await req.json();
    if (!imageUrl) return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("Failed to fetch image from URL");
    
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = imgRes.headers.get("content-type") || "image/jpeg";

    const prompt = `You are a product data extraction assistant for a pharmacy/supermarket POS.
Extract the product details from the packaging image. Be accurate. If a field is not visible in this image (because it might be on the back or side), leave it empty and include its name in the missingFields array.`;

    let response;
    const aiConfig: any = {
      contents: [
        { role: "user", parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Data } }
        ]}
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.1
      }
    };

    try {
      response = await ai.models.generateContent({ model: "gemini-3.6-flash", ...aiConfig });
    } catch (apiErr: any) {
      console.warn("Primary model failed, attempting fallback...", apiErr?.message);
      if (apiErr?.status === 503 || apiErr?.message?.includes("503") || apiErr?.message?.includes("UNAVAILABLE")) {
        response = await ai.models.generateContent({ model: "gemini-1.5-flash", ...aiConfig });
      } else {
        throw apiErr;
      }
    }

    const text = response.text;
    if (!text) throw new Error("Empty response from AI");

    const parsed = JSON.parse(text);
    return NextResponse.json({ data: parsed });

  } catch (error: any) {
    console.error("AI Extract Error:", error);
    return NextResponse.json({ error: error.message || "Failed to process image" }, { status: 500 });
  }
}
