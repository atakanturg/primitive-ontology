import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // Route: POST /api/analyze
    if (request.method === "POST" && url.pathname === "/api/analyze") {
      return handleAnalyze(request, env, ctx);
    }

    // Route: serve frontend assets with SPA fallback
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
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  // ctx.waitUntil keeps the Worker alive for background processing
  ctx.waitUntil(processData({ ticker, row_id, supabase, ai, env, experimental_mode: !!experimental_mode }));

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
    // Initial Status Update
    await supabase
      .from("watchlist")
      .update({ 
        status: "scanning", 
        last_updated: new Date().toISOString(),
        experimental_mode 
      })
      .eq("id", row_id);

    // ── Step 1: SEC fetch (Kicked off immediately) ──
    const secDataPromise = fetchSECData(ticker, env.SEC_API_KEY);

    // ── Step 2: Gemini Pass 1 — Targeted Keyword Generation ──
    const keywords = await generateSearchKeywords(ticker, ai);

    // ── Step 3: Parallel Data Ingestion ──
    const [secData, scholarData, newsData] = await Promise.allSettled([
      secDataPromise,
      fetchScholarData(keywords.researchKeywords, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(keywords.companyName, keywords.newsKeywords, env.FIRECRAWL_API_KEY),
    ]);

    const bundle = `
=== SEC / REGULATORY FILINGS ===
${secData.status === "fulfilled" ? secData.value : "Unavailable"}

=== ACADEMIC & TECHNICAL RESEARCH ===
${scholarData.status === "fulfilled" ? scholarData.value : "Unavailable"}

=== REAL-TIME NEWS & PRESS RELEASES ===
${newsData.status === "fulfilled" ? newsData.value : "Unavailable"}`.trim();

    // ── Step 4: Gemini Pass 2 — Synthesis & Enforcement ──
    const sentimentSchema = experimental_mode 
      ? `"Bullish" | "Bearish"` 
      : `"Bullish" | "Bearish" | "Neutral"`;

    const experimentalInstruction = experimental_mode 
      ? `CRITICAL: EXPERIMENTAL MODE ENABLED. You are strictly prohibited from returning "Neutral". You must analyze the balance of probabilities and issue a binary verdict (Bullish or Bearish). Do not be cautious; be decisive.`
      : `You may return "Neutral" if the data is genuinely ambiguous or contradictory.`;

    const systemPrompt = `You are an elite quantitative analyst with deep expertise in equity research, regulatory analysis, and academic literature review.
Your job is to synthesize three distinct data sources into a single, high-signal investment thesis.
Source weighting hierarchy:
1. SEC filings — highest weight (legally binding).
2. Academic research — medium weight (structural shifts).
3. News — lowest weight (timing/noise).`;

    const userPrompt = `Analyze ticker $${ticker}. ${experimentalInstruction}

--- DATA BUNDLE ---
${bundle}
--- END BUNDLE ---

Return ONLY a JSON object with exactly these fields:
{
  "sentiment": ${sentimentSchema},
  "conviction_score": <integer 1-10>,
  "primary_catalyst": "<blunt sentence starting with [SEC], [Research], or [News]>",
  "key_risks": "<one sentence>",
  "time_horizon": "Short-term (0-3 months)" | "Medium-term (3-12 months)" | "Long-term (1+ years)",
  "reasoning": "<2-3 sentence specific synthesis>",
  "data_quality": "High" | "Medium" | "Low"
}

Rules:
- conviction_score: cap at 6 if any source was unavailable.
- Never fabricate figures. If data is absent, reflect that uncertainty in your reasoning.`;

    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    });

    const rawText = result.response.text; 
    const cleanedJson = rawText.replace(/`{3}json|`{3}/g, "").trim();
    const analysis = JSON.parse(cleanedJson);

    // ── Step 5: Persistence ──
    const { data: existing } = await supabase
      .from("watchlist")
      .select("analysis_count")
      .eq("id", row_id)
      .single();

    const currentCount = typeof existing?.analysis_count === "number" ? existing.analysis_count : 0;

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

  } catch (error: any) {
    console.error("Analysis failure:", error?.message);
    await supabase.from("watchlist").update({
      status: "idle",
      reasoning: `Error: ${error?.message || "Unknown error"}`,
      last_updated: new Date().toISOString(),
    }).eq("id", row_id);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function generateSearchKeywords(ticker: string, ai: any) {
  const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent({
    contents: [{ 
      role: "user", 
      parts: [{ text: `Given ticker "${ticker}", return JSON with:
      "companyName": "full name",
      "researchKeywords": "5-7 domain terms for Semantic Scholar",
      "newsKeywords": "2-3 high-impact news topics"` }] 
    }],
    generationConfig: { responseMimeType: "application/json" },
  });
  return JSON.parse(result.response.text.replace(/`{3}json|`{3}/g, "").trim());
}

async function fetchSECData(ticker: string, apiKey: string) {
  if (!apiKey) return "SEC API Key missing.";
  try {
    const res = await fetch(`https://api.sec-api.io?token=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { query_string: { query: `ticker:${ticker} AND formType:("8-K" OR "10-Q")` } },
        from: "0", size: "3", sort: [{ filedAt: { order: "desc" } }]
      })
    });
    const data: any = await res.json();
    return data?.filings?.map((f: any) => `Form: ${f.formType} | Date: ${f.filedAt} | Desc: ${f.description || "N/A"}`).join("\n") || "No filings.";
  } catch (e) { return "SEC Fetch Error"; }
}

async function fetchScholarData(keywords: string, apiKey: string) {
  if (!apiKey) return "Scholar API Key missing.";
  try {
    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(keywords)}&fields=title,tldr,abstract&limit=5&year=2024-`, {
      headers: { "x-api-key": apiKey }
    });
    const data: any = await res.json();
    return data?.data?.map((p: any) => `Title: ${p.title}\nTLDR: ${p.tldr?.text || p.abstract?.substring(0, 200) || "N/A"}`).join("\n\n") || "No research.";
  } catch (e) { return "Scholar Fetch Error"; }
}

async function fetchNewsData(companyName: string, newsKeywords: string, apiKey: string) {
  if (!apiKey) return "Firecrawl API Key missing.";
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `${companyName} ${newsKeywords}`, limit: 5 })
    });
    const data: any = await res.json();
    return data?.data?.map((r: any) => `Source: ${r.url}\nContent: ${r.markdown?.substring(0, 400)}`).join("\n---\n") || "No news.";
  } catch (e) { return "News Fetch Error"; }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
