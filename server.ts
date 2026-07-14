import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Set up body parser with increased limit to handle base64 image uploads
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ limit: "15mb", extended: true }));

  // Initialize Gemini API client
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = apiKey
    ? new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      })
    : null;

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", geminiInitialized: !!ai });
  });

  // API Route for analyzing images of factory logs using Gemini 3.5 Flash
  app.post("/api/analyze-image", async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({
          error: "Gemini API key is not configured in environment variables.",
        });
      }

      const { image, mimeType } = req.body;
      if (!image || !mimeType) {
        return res.status(400).json({ error: "Missing image data or mimeType" });
      }

      const imagePart = {
        inlineData: {
          mimeType: mimeType,
          data: image,
        },
      };

      const textPart = {
        text: "Analyze this image of a factory production work hour record (工廠生產工時紀錄). Extract all logs/rows accurately. Look carefully at tables, printed forms, hand-written names, mold numbers, good quantities, bad quantities, hours, and worker names. Return a JSON array representing the identified rows.",
      };

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: { parts: [imagePart, textPart] },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            description: "List of identified factory production hour records.",
            items: {
              type: Type.OBJECT,
              properties: {
                client: {
                  type: Type.STRING,
                  description: "客戶名稱 (Customer Name). Empty if not found.",
                },
                moldId: {
                  type: Type.STRING,
                  description: "模具編號 (Mold Number). Empty if not found.",
                },
                goodQty: {
                  type: Type.INTEGER,
                  description: "良品數量 (Good Product Quantity). Default 0 if not found.",
                },
                badQty: {
                  type: Type.INTEGER,
                  description: "不良品數量 (Defective Product Quantity). Default 0 if not found.",
                },
                workHours: {
                  type: Type.NUMBER,
                  description: "工時(小時) (Work Hours in decimal hours). Default 0 if not found.",
                },
                operator: {
                  type: Type.STRING,
                  description: "工作者 (Worker Name / Operator). Empty if not found.",
                },
              },
              required: [
                "client",
                "moldId",
                "goodQty",
                "badQty",
                "workHours",
                "operator",
              ],
            },
          },
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("No text response returned from Gemini.");
      }

      const records = JSON.parse(text.trim());
      return res.json({ success: true, records });
    } catch (err: any) {
      console.error("Error analyzing image:", err);
      return res.status(500).json({
        error: err.message || "An error occurred while parsing the image.",
      });
    }
  });

  // Vite Integration for Assets and Frontend
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Serve index.html for any wildcard routing
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
});
