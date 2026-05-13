import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Initialize Supabase Service Client
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey) 
  : null;

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// The Signal-to-Action Orchestrator
app.post("/api/analyze", async (req, res) => {
  const { ticker, user_id, row_id } = req.body;

  if (!ticker || !user_id || !row_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // 1. Immediate Handshake
  res.status(202).json({ status: "processing" });

  // 2. The Data Acquisition Loop (Background)
  const processData = async () => {
    try {
      if (supabase) {
        await supabase
          .from("watchlist")
          .update({ status: "scanning", last_updated: new Date().toISOString() })
          .eq("id", row_id);
      }

      // Fetch from 3 sources simultaneously
      const [secData, scholarData, newsData] = await Promise.allSettled([
        fetchSECData(ticker),
        fetchScholarData(ticker),
        fetchNewsData(ticker),
      ]);

      const secText    = secData.status     === 'fulfilled' ? secData.value     : 'Unavailable';
      const scholarText = scholarData.status === 'fulfilled' ? scholarData.value : 'Unavailable';
      const newsText   = newsData.status    === 'fulfilled' ? newsData.value    : 'Unavailable';

      const bundle = `
=== SEC / REGULATORY FILINGS ===
${secText}

=== ACADEMIC & TECHNICAL RESEARCH ===
${scholarText}

=== REAL-TIME NEWS & PRESS RELEASES ===
${newsText}
      `.trim();

      // 3. The Reasoning Pass (Gemini)
      // CHANGED: Expanded from a 2-field schema to a rich 7-field structured schema.
      // The system prompt now instructs the model on source weighting, attribution,
      // conviction scoring, risk surfacing, time-horizon framing, and data quality.
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
  "conviction_score": <integer 1–10, where 10 = highest conviction>,
  "primary_catalyst": "<The single most impactful finding across all sources. Start with the source label, e.g. '[SEC]', '[Research]', or '[News]', followed by one blunt sentence.>",
  "key_risks": "<The strongest counterargument or tail risk to your thesis. One sentence.>",
  "time_horizon": "Short-term (0–3 months)" | "Medium-term (3–12 months)" | "Long-term (1+ years)",
  "reasoning": "<A 2–3 sentence synthesis connecting the data sources to the sentiment. Be specific — cite figures, dates, or named events from the data bundle where available. Avoid generic statements.>",
  "data_quality": "High" | "Medium" | "Low"
}

Rules:
- conviction_score must reflect data completeness: if one or more sources were unavailable, cap at 6.
- data_quality is "High" if all 3 sources had real data, "Medium" if 1–2 sources were missing or thin, "Low" if all sources were unavailable or mock.
- Never fabricate figures. If data is absent, reflect that uncertainty in your reasoning.
- sentiment must follow the weight hierarchy: a bearish SEC filing overrides a bullish news headline.`;

      // Default fallback values
      let sentiment = "Neutral";
      let conviction_score = 1;
      let primary_catalyst = "Insufficient data to identify a primary catalyst.";
      let key_risks = "Unable to assess risks due to lack of meaningful data.";
      let time_horizon = "Medium-term (3–12 months)";
      let reasoning = "Analysis could not be completed due to lack of meaningful correlations across data sources.";
      let data_quality = "Low";

      if (process.env.GEMINI_API_KEY) {
        try {
          const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: [
              { role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }
            ],
            config: {
              responseMimeType: "application/json",
            }
          });
          
          if (response.text) {
            // Strip any accidental markdown fences before parsing
            const cleaned = response.text.replace(/```json|```/g, "").trim();
            const result = JSON.parse(cleaned);

            sentiment        = result.sentiment        || sentiment;
            conviction_score = result.conviction_score || conviction_score;
            primary_catalyst = result.primary_catalyst || primary_catalyst;
            key_risks        = result.key_risks        || key_risks;
            time_horizon     = result.time_horizon     || time_horizon;
            reasoning        = result.reasoning        || reasoning;
            data_quality     = result.data_quality     || data_quality;
          }
        } catch (e) {
          console.error("Gemini failed:", e);
        }
      }

      // 4. The Database Write — now persists all 7 structured fields
      if (supabase) {
        let currentCount = 0;
        const { data: existing } = await supabase
          .from("watchlist")
          .select("analysis_count")
          .eq("id", row_id)
          .single();

        if (existing && typeof existing.analysis_count === 'number') {
          currentCount = existing.analysis_count;
        }

        await supabase
          .from("watchlist")
          .update({
            status:           "updated",
            sentiment,
            conviction_score,
            primary_catalyst,
            key_risks,
            time_horizon,
            reasoning,
            data_quality,
            last_updated:     new Date().toISOString(),
            last_analyzed_at: new Date().toISOString(),
            analysis_count:   currentCount + 1,
          })
          .eq("id", row_id);
      }
    } catch (error) {
      console.error("Background processing error:", error);
      if (supabase) {
        await supabase
          .from("watchlist")
          .update({
            status:       "idle",
            reasoning:    "System error during analysis process.",
            last_updated: new Date().toISOString(),
          })
          .eq("id", row_id);
      }
    }
  };

  processData();
});

// Mock implementations for external APIs
async function fetchSECData(ticker: string): Promise<string> {
  const apiKey = process.env.SEC_API_KEY;
  if (!apiKey) return "Skipped SEC processing: SEC_API_KEY not configured. Mock: Management discusses supply chain.";
  
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
    if (data?.filings && data.filings.length > 0) {
      const filing = data.filings[0];
      return `Document: ${filing.formType} on ${filing.filedAt}. URL: ${filing.documentUrl}. Desc: ${filing.description || "N/A"}`;
    }
    return "No recent SEC filings found.";
  } catch (error) {
    console.error("SEC fetch error:", error);
    return "Error fetching SEC data.";
  }
}

async function fetchScholarData(ticker: string): Promise<string> {
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (!apiKey) return "Skipped Scholar processing: SEMANTIC_SCHOLAR_API_KEY not configured. Mock: Innovations in architecture.";
  
  try {
    const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search/bulk?query=${ticker} industry technical innovation breakthroughs&fields=title,abstract,tldr&year=2024-`, {
      method: "GET",
      headers: { "x-api-key": apiKey }
    });
    
    if (!response.ok && response.status === 404) {
      const resFallback = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${ticker} industry technical innovation breakthroughs&fields=title,abstract,tldr&limit=3&year=2024-`, {
        method: "GET",
        headers: { "x-api-key": apiKey }
      });
      if (resFallback.ok) {
        const fallData = await resFallback.json();
        if (fallData?.data?.length > 0) {
          return fallData.data.slice(0, 3).map((p: any) => `Title: ${p.title}\nTLDR: ${p.tldr?.text || "N/A"}`).join("\n\n");
        }
      }
    }

    if (!response.ok) return "Scholar API Error.";
    const data = await response.json();
    if (data?.data && data.data.length > 0) {
      return data.data.slice(0, 3).map((p: any) => `Title: ${p.title}\nTLDR: ${p.tldr?.text || "N/A"}\nAbstract: ${p.abstract?.substring(0, 200) || "N/A"}...`).join("\n\n");
    }
    return "No recent relevant papers found.";
  } catch (error) {
    console.error("Scholar fetch error:", error);
    return "Error fetching academic data.";
  }
}

async function fetchNewsData(ticker: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return "Skipped Firecrawl processing: FIRECRAWL_API_KEY not configured. Mock: Q3 indicates breakthrough.";
  
  const targetUrl = `https://finance.yahoo.com/quote/${ticker}/press-releases`;
  
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: targetUrl,
        formats: ["markdown"]
      })
    });
    
    if (!response.ok) return "Firecrawl API Error.";
    const data = await response.json();
    if (data?.data?.markdown) {
      return data.data.markdown.substring(0, 1500) + "...";
    }
    return "No news data extracted from target URL.";
  } catch (error) {
    console.error("Firecrawl fetch error:", error);
    return "Error fetching real-time news data.";
  }
}

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
