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
        // Update status to scanning
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

      const bundle = `
      SEC Data: ${secData.status === 'fulfilled' ? secData.value : 'Unavailable'}
      Academic Data: ${scholarData.status === 'fulfilled' ? scholarData.value : 'Unavailable'}
      News Data: ${newsData.status === 'fulfilled' ? newsData.value : 'Unavailable'}
      `;

      // 3. The Reasoning Pass (Gemini)
      const prompt = `You are an elite quantitative analyst. Below is a bundle of regulatory filings, academic research, and real-time news for $${ticker}.
      
      Data Bundle:
      ${bundle}
      
      Strict Task: Identify exactly one high-impact causal link between this data and the stock's outlook. Avoid generic market noise.
      
      Constraint: Return ONLY a JSON object: { "sentiment": "Bullish" | "Bearish" | "Neutral", "reasoning": "One concise, blunt sentence starting with a verb." }`;

      let sentiment = "Neutral";
      let reasoning = "Analysis failed due to lack of meaningful correlations.";

      if (process.env.GEMINI_API_KEY) {
        try {
          const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
            }
          });
          
          if (response.text) {
            const result = JSON.parse(response.text);
            sentiment = result.sentiment || sentiment;
            reasoning = result.reasoning || reasoning;
          }
        } catch (e) {
          console.error("Gemini failed:", e);
        }
      }

      // 4. The Database Write
      if (supabase) {
        let currentCount = 0;
        const { data: existing } = await supabase.from("watchlist").select("analysis_count").eq("id", row_id).single();
        if (existing && typeof existing.analysis_count === 'number') {
          currentCount = existing.analysis_count;
        }

        await supabase
          .from("watchlist")
          .update({
            status: "updated",
            sentiment,
            reasoning,
            last_updated: new Date().toISOString(),
            last_analyzed_at: new Date().toISOString(),
            analysis_count: currentCount + 1
          })
          .eq("id", row_id);
      }
    } catch (error) {
      console.error("Background processing error:", error);
      if (supabase) {
        await supabase
          .from("watchlist")
          .update({
            status: "idle",
            reasoning: "System error during analysis process.",
            last_updated: new Date().toISOString(),
          })
          .eq("id", row_id);
      }
    }
  };

  processData();
});

// Mock implementations for external APIs (to be replaced with actual implementations if/when required)
async function fetchSECData(ticker: string): Promise<string> {
  const apiKey = process.env.SEC_API_KEY;
  if (!apiKey) return "Skipped SEC processing: SEC_API_KEY not configured. Mock: Management discusses supply chain.";
  
  try {
    const response = await fetch(`https://api.sec-api.io?token=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { query_string: { query: `ticker:${ticker} AND formType:(\"8-K\" OR \"10-Q\")` } },
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
    
    // Fallback to standard search if bulk fails
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
  
  // Since investor relations routing can be highly complex to determine upfront, 
  // we fallback to scraping Yahoo Finance news for the specific ticker as an example.
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
