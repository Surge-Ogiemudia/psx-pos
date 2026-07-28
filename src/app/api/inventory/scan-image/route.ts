import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || "dummy-key" });

export async function POST(req: NextRequest) {
  try {
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { imageBase64, headers } = body;

    if (!imageBase64 || !headers || !Array.isArray(headers)) {
      return NextResponse.json({ error: "Missing imageBase64 or headers array" }, { status: 400 });
    }

    // Clean up base64 string if it contains data URI prefix
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const prompt = `You are an expert data extraction assistant for a pharmacy inventory system.
I am providing an image of a physical inventory ledger (often handwritten).
The expected final column headers for our system are: ${headers.join(", ")}.

CRITICAL RULES FOR EXTRACTING AND TRANSFORMING DATA:
1. The physical ledger will typically have columns like "Quantity" (e.g., "2 ctn", "5 packs") and "No inside carton" (e.g., "24 packs", "6 pieces").
2. You must transform these physical columns into our required system headers:
   - \`receivedQuantity\`: Extract ONLY the number from the physical "Quantity" column (e.g. if it says "2 ctn", output "2").
   - \`receivedForm\`: Extract the unit text from the physical "Quantity" column and normalize it (e.g., "ctn" -> "carton", "packs" -> "pack", "cups" -> "cup", "pcs" -> "piece").
   - \`unitHierarchy\`: You must combine the form and the "No inside carton" to create our strict hierarchy string. 
     * Example 1: Quantity is "2 ctn", No inside carton is "24 packs" -> unitHierarchy must be "carton:1>pack:24"
     * Example 2: Quantity is "5 packs", No inside carton is "6 pieces" -> unitHierarchy must be "pack:1>piece:6"
     * Example 3: Quantity is "12 cups", No inside carton is "24 cups" (meaning 24 cups in a carton) -> unitHierarchy must be "carton:1>cup:24".
3. \`itemName\`: Extract the exact product name. Expand ditto marks (") by copying the name from the row above.
4. \`expiryDate\`: Standardize any dates to YYYY-MM-DD. If it says "06/2027", output "2027-06-30" (end of month).

Extract all visible rows of data from the image.
Return the data strictly as a JSON array of objects.
Each object should represent one row.
The keys of the object must EXACTLY match the expected final column headers provided above.
If a column's data cannot be deduced, use an empty string "" for that key.

Do not include any markdown formatting (like \`\`\`json), just return the raw JSON array.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        prompt,
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Data,
          },
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from AI");
    }

    // Parse the JSON array
    let parsedData = [];
    try {
      parsedData = JSON.parse(text);
    } catch (e) {
      // Fallback in case the model returns markdown despite instructions
      const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
      parsedData = JSON.parse(cleaned);
    }

    return NextResponse.json({ rows: parsedData });
  } catch (error: any) {
    console.error("AI Scan Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
