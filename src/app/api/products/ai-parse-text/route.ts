import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Type, Schema } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || "dummy-key" });

export async function POST(req: NextRequest) {
  try {
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured." }, { status: 500 });
    }

    const { type, text, context } = await req.json();

    let schema: Schema;
    let prompt: string;

    if (type === "hierarchy") {
      schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            unitName: { type: Type.STRING, description: "Singular name of the unit (e.g. carton, pack, piece)" },
            unitsPerParent: { type: Type.NUMBER, description: "How many of this unit are in 1 of the parent unit? For the largest unit (first item), this is 1." }
          },
          required: ["unitName", "unitsPerParent"]
        },
        description: "Array of units ordered from largest (index 0) to smallest (last item)."
      };
      prompt = `Parse the user's description of how this product is packaged into a hierarchy from largest to smallest.
For example: '10 rows in a pack, 2 pieces in a row'.
Output: [{unitName: 'pack', unitsPerParent: 1}, {unitName: 'row', unitsPerParent: 10}, {unitName: 'piece', unitsPerParent: 2}].
User said: "${text}"`;
    } else if (type === "quantity") {
      schema = {
        type: Type.OBJECT,
        properties: {
          totalBaseUnits: { type: Type.NUMBER, description: "The total calculated quantity in the smallest (base) unit." }
        },
        required: ["totalBaseUnits"]
      };
      prompt = `Given the product's unit hierarchy: ${JSON.stringify(context?.hierarchy || [])},
Calculate the total quantity in the smallest base unit based on the user's inventory count.
User said: "${text}"`;
    } else if (type === "price") {
      schema = {
        type: Type.OBJECT,
        properties: {
          retailPrice: { type: Type.NUMBER, nullable: true, description: "Retail price." },
          wholesalePrice: { type: Type.NUMBER, nullable: true, description: "Wholesale price." },
          costPrice: { type: Type.NUMBER, nullable: true, description: "Cost price." },
          distributorPrice: { type: Type.NUMBER, nullable: true, description: "Distributor price." },
        }
      };
      prompt = `Extract pricing information from the user's message.
User said: "${text}"`;
    } else {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    return NextResponse.json({ data: parsed });

  } catch (error: any) {
    console.error("AI Parse Text Error:", error);
    return NextResponse.json({ error: error.message || "Failed to parse text" }, { status: 500 });
  }
}
