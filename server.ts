import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      return handleAnalyze(request, env, ctx);
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status === 404) {
        const indexUrl = new URL("/index.html", request.url);
        return env.ASSETS.fetch(new Request(indexUrl.toString(), request));
      }
      return assetResponse;
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleAnalyze(request: Request, env: any, ctx: any): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { ticker, user_id, row_id, experimental_mode } = body;

  if (!ticker || !user_id || !row_id) {
    return json({ error: "Missing required fields" }, 400);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  // HARDENED: Use object config for the constructor
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  ctx.waitUntil(processData({ 
    ticker, 
    row_id, 
    supabase, 
    ai, 
    env, 
    experimental_mode: Boolean(experimental_mode) 
  }));

  return json({ status: "processing" }, 202);
}

async function processData({
  ticker, row_id, supabase, ai, env, experimental_mode,
}: {
  ticker: string;
  row_id: string;
  supabase: any;
  ai: any;
  env: any;
  experimental_mode: boolean;
}): Promise<void> {
  try {
    // Update status to scanning and sync the experimental_mode flag
    await supabase.from("watchlist").update({ 
      status: "scanning", 
      last_updated: new Date().toISOString(),
      experimental_mode
    }).eq("id", row_id);

    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Step 1: Keywords
    const kwResult = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: `Ticker: ${ticker}. Return JSON: companyName, researchKeywords, newsKeywords.` }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
    const keywords = JSON.parse(kwResult.response.text.replace(/`{3}json|`{3}/g, "").trim());

    // Step 2: Data Fetching
    const [secData, scholarData, newsData] = await Promise.allSettled([
      fetchSECData(ticker, env.SEC_API_KEY),
      fetchScholarData(keywords.researchKeywords, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(keywords.companyName, keywords.newsKeywords, env.FIRECRAWL_API_KEY),
    ]);

    const bundle = `
SEC: ${secData.status === "fulfilled" ? secData.value : "Unavailable"}
Research: ${scholarData.status === "fulfilled" ? scholarData.value : "Unavailable"}
News: ${newsData.status === "fulfilled" ? newsData.value : "Unavailable"}`.trim();

    // Step 3: Synthesis
    const sentimentSchema = experimental_mode ? `"Bullish" | "Bearish"` : `"Bullish" | "Bearish" | "Neutral"`;
    const experimentalInstruction = experimental_mode 
      ? `CRITICAL: EXPERIMENTAL MODE ENABLED. Return a binary verdict (Bullish or Bearish). Neutral is forbidden.`
      : `Neutral is permitted if data is ambiguous.`;

    const userPrompt = `Analyze ticker $${ticker}. ${experimentalInstruction}\n\n--- DATA BUNDLE ---\n${bundle}`;

    const analysisResult = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    });

    const analysis = JSON.parse(analysisResult.response.text.replace(/`{3}json|`{3}/g, "").trim());

    // Step 4: Final Persistence
    await supabase.from("watchlist").update({
      ...analysis,
      status: "updated",
      last_updated: new Date().toISOString(),
      last_analyzed_at: new Date().toISOString()
    }).eq("id", row_id);

  } catch (error: any) {
    console.error("Worker Execution Error:", error.message);
    // Attempt to report error back to DB
    await supabase.from("watchlist").update({ 
      status: "idle", 
      reasoning: `System Error: ${error.message}` 
    }).eq("id", row_id);
  }
}

// RESTORED: Your specific fetchers
async function fetchSECData(ticker: string, apiKey: string) {
  const res = await fetch(`https://api.sec-api.io?token=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: { query_string: { query: `ticker:${ticker} AND formType:("8-K" OR "10-Q")` } },
      from: "0", size: "3", sort: [{ filedAt: { order: "desc" } }]
    })
  });
  const data: any = await res.json();
  return data?.filings?.map((f: any) => `Form: ${f.formType} | Date: ${f.filedAt}`).join("\n") || "No filings.";
}

async function fetchScholarData(keywords: string, apiKey: string) {
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(keywords)}&fields=title,tldr&limit=5&year=2024-`, {
    headers: { "x-api-key": apiKey }
  });
  const data: any = await res.json();
  return data?.data?.map((p: any) => `Title: ${p.title}\nTLDR: ${p.tldr?.text || "N/A"}`).join("\n\n") || "No research.";
}

async function fetchNewsData(companyName: string, newsKeywords: string, apiKey: string) {
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `${companyName} ${newsKeywords}`, limit: 5 })
  });
  const data: any = await res.json();
  return data?.data?.map((r: any) => `Source: ${r.url}\nContent: ${r.markdown?.substring(0, 400)}`).join("\n---\n") || "No news.";
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
