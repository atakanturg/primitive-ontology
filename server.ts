import express from "express";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

const getEnv = (req: any, key: string) => req.env?.[key] || process.env[key];

app.post("/api/analyze", async (req: any, res) => {
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

      const systemPrompt = `You are an elite quantitative analyst with deep expertise in equity research, regulatory analysis, and academic literature review.

Your job is to synthesize three distinct data sources — SEC/regulatory filings, academic research, and real-time news — into a single, high-signal investment thesis for a given stock ticker.

Source weighting hierarchy (apply in this order):
1. SEC filings & regulatory disclosures — highest weight; these are material, legally binding signals.
2. Academic & technical research — medium weight; relevant for structural/innovation shifts.
3. News & press releases — lowest weight; useful for timing, but prone to noise and recency bias.

Your output must be a single JSON object. Do not include markdown, code fences, or any preamble. Return only raw JSON.`;

      const userPrompt = `Analyze the following data bundle for ticker $${ticker} and return a structured investment signal.

--- DATA BUNDLE ---
${bundle}
--- END BUNDLE ---

Return ONLY a JSON object with exactly these fields:

{
  "sentiment": "Bullish" | "Bearish" | "Neutral",
  "conviction_score": <integer 1-10, where 10 = highest conviction>,
  "primary_catalyst": "<The single most impactful finding across all sources. Start with the source label, e.g. '[SEC]', '[Research]', or '[News]', followed by one blunt sentence.>",
  "key_risks": "<The strongest counterargument or tail risk to your thesis. One sentence.>",
  "time_horizon": "Short-term (0-3 months)" | "Medium-term (3-12 months)" | "Long-term (1+ years)",
  "reasoning": "<A 2-3 sentence synthesis connecting the data sources to the sentiment. Be specific. Avoid generic statements.>",
  "data_quality": "High" | "Medium" | "Low"
}

Rules:
- conviction_score must reflect data completeness: if one or more sources were unavailable, cap at 6.
- data_quality is "High" if all 3 sources had real data, "Medium" if 1-2 sources were missing or thin, "Low" if all sources were unavailable or mock.
- Never fabricate figures. If data is absent, reflect that uncertainty in your reasoning.
- sentiment must follow the weight hierarchy: a bearish SEC filing overrides a bullish news headline.`;

      const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      const resultText = await model.generateContent(systemPrompt + "\n\n" + userPrompt);
      const response = await resultText.response;

      const cleanedJson = response.text().replace(/`{3}json|`{3}/g, "").trim();
      const analysis = JSON.parse(cleanedJson);

      let currentCount = 0;
      const { data: existing } = await supabase
        .from("watchlist")
        .select("analysis_count")
        .eq("id", row_id)
        .single();

      if (existing && typeof existing.analysis_count === "number") {
        currentCount = existing.analysis_count;
      }

      await supabase
        .from("watchlist")
        .update({
          ...analysis,
          status: "updated",
          last_updated: new Date().toISOString(),
          last_analyzed_at: new Date().toISOString(),
          analysis_count: currentCount + 1,
        })
        .eq("id", row_id);

    } catch (error) {
      console.error("Analysis background failure:", error);
      await supabase
        .from("watchlist")
        .update({
          status: "idle",
          reasoning: "System error during analysis process.",
          last_updated: new Date().toISOString(),
        })
        .eq("id", row_id);
    }
  };

  processData();
});

async function fetchSECData(ticker: string, apiKey: string): Promise<string> {
  if (!apiKey) return "Skipped: SEC_API_KEY not configured.";
  try {
    const response = await fetch(`https://api.sec-api.io?token=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { query_string: { query: `ticker:${ticker} AND formType:("8-K" OR "10-Q")` } },
        from: "0",
        size: "1",
        sort: [{ filedAt: { order: "desc" } }]
      })
    });
    if (!response.ok) return "SEC API Error.";
    const data = await response.json();
    if (data?.filings?.length > 0) {
      const f = data.filings[0];
      return `Form: ${f.formType} on ${f.filedAt}. Desc: ${f.description || "N/A"}`;
    }
    return "No recent SEC filings found.";
  } catch (e) {
    return "Error fetching SEC data.";
  }
}

async function fetchScholarData(ticker: string, apiKey: string): Promise<string> {
  if (!apiKey) return "Skipped: SEMANTIC_SCHOLAR_API_KEY not configured.";
  try {
    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${ticker} industry innovation&fields=title,abstract,tldr&limit=3&year=2024-`,
      { headers: { "x-api-key": apiKey } }
    );
    if (!response.ok) return "Scholar API Error.";
    const data = await response.json();
    if (data?.data?.length > 0) {
      return data.data.map((p: any) => `Title: ${p.title}\nTLDR: ${p.tldr?.text || "N/A"}`).join("\n\n");
    }
    return "No recent papers found.";
  } catch (e) {
    return "Error fetching academic data.";
  }
}

async function fetchNewsData(ticker: string, apiKey: string): Promise<string> {
  if (!apiKey) return "Skipped: FIRECRAWL_API_KEY not configured.";
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: `https://finance.yahoo.com/quote/${ticker}/press-releases`,
        formats: ["markdown"]
      })
    });
    if (!response.ok) return "Firecrawl API Error.";
    const data = await response.json();
    if (data?.data?.markdown) {
      return data.data.markdown.substring(0, 1500) + "...";
    }
    return "No news data extracted.";
  } catch (e) {
    return "Error fetching news data.";
  }
}

export default {
  async fetch(request: Request, env: any, ctx: any) {
    return (app as any)(request, env, ctx);
  },
};
