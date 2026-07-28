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

    const prompt = `You are a highly accurate data extraction assistant.
I am providing an image of a table/inventory list (which might be handwritten or printed).
The expected column headers for this inventory are: ${headers.join(", ")}.

Extract all the rows of data visible in the image.
Return the data strictly as a JSON array of objects.
Each object should represent one row from the image.
The keys of the object must EXACTLY match the expected column headers provided above.
If a column's data is missing or unreadable for a specific row, use an empty string "" for that key.

Do not include any markdown formatting (like \`\`\`json), just return the raw JSON array.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
