import express from "express";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// Initialize Supabase & Gemini using environment bindings
const getEnv = (req: any, key: string) => req.env?.[key] || process.env[key];

// The Signal-to-Action Orchestrator
app.post("/api/analyze", async (req, res) => {
  const { ticker, user_id, row_id } = req.body;
  const GEMINI_KEY = getEnv(req, "GEMINI_API_KEY");
  const SB_URL = getEnv(req, "VITE_SUPABASE_URL");
  const SB_KEY = getEnv(req, "SUPABASE_SERVICE_ROLE_KEY");

  if (!ticker || !user_id || !row_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const supabase = createClient(SB_URL, SB_KEY);
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

  res.status(202).json({ status: "processing" });

  const processData = async () => {
    try {
      await supabase
        .from("watchlist")
        .update({ status: "scanning", last_updated: new Date().toISOString() })
        .eq("id", row_id);

      const [secData, scholarData, newsData] = await Promise.allSettled([
        fetchSECData(ticker, getEnv(req, "SEC_API_KEY")),
        fetchScholarData(ticker, getEnv(req, "SEMANTIC_SCHOLAR_API_KEY")),
        fetchNewsData(ticker, getEnv(req, "FIRECRAWL_API_KEY")),
      ]);

      const bundle = `
=== SEC FILINGS ===
${secData.status === 'fulfilled' ? secData.value : 'Unavailable'}
=== RESEARCH ===
${scholarData.status === 'fulfilled' ? scholarData.value : 'Unavailable'}
=== NEWS ===
${newsData.status === 'fulfilled' ? newsData.value : 'Unavailable'}`.trim();

      const systemPrompt = `Analyze ticker $${ticker}. Return raw JSON only. Weight: SEC > Research > News.`;
      const userPrompt = `Data: ${bundle}. Fields: sentiment, conviction_score (1-10), primary_catalyst, key_risks, time_horizon, reasoning, data_quality.`;

      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text().replace(/```json|
```/g, "").trim());

      await supabase
        .from("watchlist")
        .update({
          ...result,
          status: "updated",
          last_updated: new Date().toISOString(),
          last_analyzed_at: new Date().toISOString(),
        })
        .eq("id", row_id);
    } catch (error) {
      console.error("Analysis failed:", error);
    }
  };

  processData();
});

// Helper Fetchers (Logic remains same, just passing keys)
async function fetchSECData(ticker: string, key: string) { /* ... same as your previous logic ... */ return "Data"; }
async function fetchScholarData(ticker: string, key: string) { /* ... same as your previous logic ... */ return "Data"; }
async function fetchNewsData(ticker: string, key: string) { /* ... same as your previous logic ... */ return "Data"; }

// Cloudflare Worker Export
export default {
  async fetch(request: Request, env: any, ctx: any) {
    const { handle } = await import("@hono/node-server"); // Use a lightweight bridge
    // Note: If you prefer to stay pure Express, use '@vendia/serverless-express'
    // but Cloudflare highly recommends Hono for performance.
    return app(request, env, ctx);
  },
};
