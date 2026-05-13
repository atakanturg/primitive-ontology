import express from "express";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// Helper to access environment variables in Cloudflare Workers
const getEnv = (req: any, key: string) => req.env?.[key] || process.env[key];

app.post("/api/analyze", async (req: any, res) => {
  const { ticker, user_id, row_id } = req.body;
  
  // Bindings from wrangler.toml or process.env
  const GEMINI_KEY = getEnv(req, "GEMINI_API_KEY");
  const SB_URL = getEnv(req, "VITE_SUPABASE_URL");
  const SB_KEY = getEnv(req, "SUPABASE_SERVICE_ROLE_KEY");

  if (!ticker || !user_id || !row_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const supabase = createClient(SB_URL, SB_KEY);
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

  // 1. Immediate Handshake
  res.status(202).json({ status: "processing" });

  // 2. Background Processing
  const processData = async () => {
    try {
      await supabase
        .from("watchlist")
        .update({ status: "scanning", last_updated: new Date().toISOString() })
        .eq("id", row_id);

      // Fetch from sources (Assume these helper functions are defined below)
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

      const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = `Analyze ticker $${ticker}. Return raw JSON with fields: sentiment, conviction_score, primary_catalyst, key_risks, time_horizon, reasoning, data_quality. 
      Data: ${bundle}`;

      const resultText = await model.generateContent(prompt);
      const response = await resultText.response;
      
      // FIXED REGEX LINE:
      const cleanedJson = response.text().replace(/```json|
```/g, "").trim();
      const analysis = JSON.parse(cleanedJson);

      await supabase
        .from("watchlist")
        .update({
          ...analysis,
          status: "updated",
          last_updated: new Date().toISOString(),
          last_analyzed_at: new Date().toISOString(),
        })
        .eq("id", row_id);

    } catch (error) {
      console.error("Analysis background failure:", error);
    }
  };

  processData();
});

// Placeholder helper functions for external APIs
async function fetchSECData(t: string, k: string) { return "SEC Data Result"; }
async function fetchScholarData(t: string, k: string) { return "Scholar Data Result"; }
async function fetchNewsData(t: string, k: string) { return "News Data Result"; }

// Cloudflare Export
export default {
  async fetch(request: Request, env: any, ctx: any) {
    // This allows the Express 'app' to handle the Worker fetch event
    return app(request, env, ctx);
  },
};
