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

  // ctx.waitUntil keeps the Worker alive until processData finishes
  ctx.waitUntil(processData({ 
    ticker, 
    row_id, 
    supabase, 
    env, 
    experimental_mode: !!experimental_mode 
  }));

  return json({ status: "processing" }, 202);
}

async function processData({
  ticker, row_id, supabase, env, experimental_mode,
}: {
  ticker: string;
  row_id: string;
  supabase: any;
  env: any;
  experimental_mode: boolean;
}): Promise<void> {
  try {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    await supabase
      .from("watchlist")
      .update({ status: "scanning", last_updated: new Date().toISOString(), experimental_mode })
      .eq("id", row_id);

    const secDataPromise = fetchSECData(ticker, env.SEC_API_KEY);
    const keywords = await generateSearchKeywords(ticker, ai);
    
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

    // ── THE FIX: Ruthless System Prompt ──
    const systemPrompt = `You are a ruthless, highly skeptical quantitative analyst at an elite hedge fund. Your job is to synthesize SEC filings, academic research, and real-time news into a brutal, high-signal investment thesis.

CRITICAL BEHAVIORAL CONSTRAINTS:
1. Default to skepticism. Do not be a cheerleader. Do not "polish a turd."
2. Recognize corporate jargon: "Financial restructuring," "liquidity enhancement," and "strategic pivots" are often desperate masks for severe financial distress, cash burn, and failing business models. 
3. If a company has massive debt, declining sales, or is fighting for survival, you MUST highlight this as an existential threat.
4. Source weighting: SEC (legally binding reality) > Academic (structural trends) > News (noise).

Your output must be a single JSON object. Do not include markdown, code fences, or any preamble. Return only raw JSON.`;

    // ── THE FIX: Brutal Experimental Logic ──
    const experimentalClause = experimental_mode
      ? `\n\nEXPERIMENTAL MODE ACTIVE: You MUST return either "Bullish" or "Bearish". "Neutral" is STRICTLY FORBIDDEN. CRITICAL: If the company is struggling, burning cash, or merely surviving via debt restructuring (e.g., struggling legacy companies or failing hyped stocks), you MUST choose "Bearish". Do not force a "Bullish" rating on a failing asset. Be brutal.`
      : `\n\nSTANDARD MODE: You may return "Neutral", but ONLY if the data is perfectly balanced. If the data leans even slightly negative, or if the company is masking poor performance with corporate speak, return "Bearish".`;

    const userPrompt = `Analyze the following data bundle for ticker $${ticker} and return a structured investment signal.

--- DATA BUNDLE ---
${bundle}
--- END BUNDLE ---

Return ONLY a JSON object with exactly these fields:

{
  "sentiment": ${experimental_mode ? '"Bullish" | "Bearish"' : '"Bullish" | "Bearish" | "Neutral"'},
  "conviction_score": <integer 1-10, where 10 = highest conviction>,
  "primary_catalyst": "<The single most impactful finding. Start with '[SEC]', '[Research]', or '[News]', followed by one blunt sentence.>",
  "key_risks": "<The strongest counterargument or tail risk. One sentence.>",
  "time_horizon": "Short-term (0-3 months)" | "Medium-term (3-12 months)" | "Long-term (1+ years)",
  "reasoning": "<2-3 sentence ruthless synthesis. Call out the trash if it's trash. Cite specific figures or named events where available.>",
  "data_quality": "High" | "Medium" | "Low"
}

Rules:
- conviction_score: cap at 6 if any source was unavailable.
- Sentiment must follow the source weight hierarchy.${experimentalClause}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
      config: { responseMimeType: "application/json" },
    });

    const rawText = response.text ?? "";
    const cleanedJson = rawText.replace(/`{3}json|`{3}/g, "").trim();
    const analysis = JSON.parse(cleanedJson);

    const { data: existing } = await supabase.from("watchlist").select("analysis_count").eq("id", row_id).single();
    const currentCount = typeof existing?.analysis_count === "number" ? existing.analysis_count : 0;

    await supabase.from("watchlist").update({
      ...analysis,
      status: "updated",
      last_updated: new Date().toISOString(),
      last_analyzed_at: new Date().toISOString(),
      analysis_count: currentCount + 1,
    }).eq("id", row_id);

  } catch (error: any) {
    console.error("Analysis background failure:", error?.message || error);
    await supabase.from("watchlist").update({
      status: "idle",
      reasoning: `Error: ${error?.message || "Unknown error"}`,
      last_updated: new Date().toISOString(),
    }).eq("id", row_id);
  }
}

// ── Gemini Pass 1: Keyword Generation ────────────────────────────────────────

async function generateSearchKeywords(ticker: string, ai: any): Promise<{
  companyName: string;
  researchKeywords: string;
  newsKeywords: string;
}> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{
      role: "user",
      parts: [{
        text: `Given the stock ticker symbol "${ticker}", return a JSON object with exactly these fields:
{
  "companyName": "<the full legal company name behind this ticker>",
  "researchKeywords": "<5-7 comma-separated keywords optimized for academic paper search on Semantic Scholar. Focus on the company's core technology domain, key innovations, and industry-specific technical terms. Do NOT use the company name itself — use domain terms that researchers would use.>",
  "newsKeywords": "<2-3 specific high-impact topics most likely to have material effect on this stock's price right now. Use the company name plus specific business events, regulatory topics, or macro factors relevant to this company.>"
}

Return only raw JSON. No markdown, no preamble.`
      }]
    }],
    config: { responseMimeType: "application/json" },
  });

  const raw = response.text ?? "";
  const cleaned = raw.replace(/`{3}json|`{3}/g, "").trim();
  return JSON.parse(cleaned);
}

// ── External Data Fetchers ────────────────────────────────────────────────────

async function fetchSECData(ticker: string, apiKey: string): Promise<string> {
  if (!apiKey) return "Skipped: SEC_API_KEY not configured.";
  try {
    const response = await fetch(`https://api.sec-api.io?token=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { query_string: { query: `ticker:${ticker} AND formType:("8-K" OR "10-Q")` } },
        from: "0",
        size: "3",
        sort: [{ filedAt: { order: "desc" } }],
      }),
    });
    if (!response.ok) return `SEC API Error: ${response.status}`;
    const data: any = await response.json();
    if (data?.filings?.length > 0) {
      return data.filings
        .map((f: any) => `Form: ${f.formType} | Filed: ${f.filedAt} | Desc: ${f.description || "N/A"}`)
        .join("\n");
    }
    return "No recent SEC filings found.";
  } catch (e: any) {
    return `Error fetching SEC data: ${e?.message}`;
  }
}

async function fetchScholarData(researchKeywords: string, apiKey: string): Promise<string> {
  if (!apiKey) return "Skipped: SEMANTIC_SCHOLAR_API_KEY not configured.";
  try {
    const encoded = encodeURIComponent(researchKeywords);
    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encoded}&fields=title,abstract,tldr&limit=5&year=2024-`,
      { headers: { "x-api-key": apiKey } }
    );
    if (!response.ok) return `Scholar API Error: ${response.status}`;
    const data: any = await response.json();
    if (data?.data?.length > 0) {
      return data.data
        .map((p: any) =>
          `Title: ${p.title}\nTLDR: ${p.tldr?.text || p.abstract?.substring(0, 300) || "N/A"}`
        )
        .join("\n\n");
    }
    return "No relevant academic papers found.";
  } catch (e: any) {
    return `Error fetching academic data: ${e?.message}`;
  }
}

async function fetchNewsData(companyName: string, newsKeywords: string, apiKey: string): Promise<string> {
  if (!apiKey) return "Skipped: FIRECRAWL_API_KEY not configured.";
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `${companyName} ${newsKeywords}`,
        limit: 5,
        scrapeOptions: { formats: ["markdown"] },
      }),
    });
    if (!response.ok) return `Firecrawl API Error: ${response.status}`;
    const data: any = await response.json();
    if (data?.data?.length > 0) {
      return data.data
        .map((r: any) =>
          `Source: ${r.url}\n${r.markdown?.substring(0, 600) || "No content extracted"}`
        )
        .join("\n\n---\n\n");
    }
    return "No news data found.";
  } catch (e: any) {
    return `Error fetching news data: ${e?.message}`;
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
