import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // Route: POST /api/analyze
    if (request.method === "POST" && url.pathname === "/api/analyze") {
      return handleAnalyze(request, env, ctx);
    }

    // SPA Fallback for assets
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

  // We pass env and the params, but initialize AI inside the background task to prevent "not a function" errors
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
    // 1. Initialize AI locally in this scope
    const ai = new GoogleGenAI(env.GEMINI_API_KEY);
    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 2. Update status to scanning
    await supabase
      .from("watchlist")
      .update({ 
        status: "scanning", 
        last_updated: new Date().toISOString(),
        experimental_mode 
      })
      .eq("id", row_id);

    // 3. Step 1: Keywords Generation
    const kwResult = await model.generateContent({
      contents: [{ 
        role: "user", 
        parts: [{ text: `Given ticker "${ticker}", return JSON with: "companyName", "researchKeywords" (5-7 terms), "newsKeywords" (2-3 topics).` }] 
      }],
      generationConfig: { responseMimeType: "application/json" },
    });
    
    // In Gemini 2.5, .text is a property
    const keywords = JSON.parse(kwResult.response.text.replace(/`{3}json|`{3}/g, "").trim());

    // 4. Step 2: Parallel Data Ingestion
    const [secData, scholarData, newsData] = await Promise.allSettled([
      fetchSECData(ticker, env.SEC_API_KEY),
      fetchScholarData(keywords.researchKeywords, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(keywords.companyName, keywords.newsKeywords, env.FIRECRAWL_API_KEY),
    ]);

    const bundle = `
=== SEC FILINGS ===
${secData.status === "fulfilled" ? secData.value : "Unavailable"}
=== RESEARCH ===
${scholarData.status === "fulfilled" ? scholarData.value : "Unavailable"}
=== NEWS ===
${newsData.status === "fulfilled" ? newsData.value : "Unavailable"}`.trim();

    // 5. Step 3: Synthesis with Experimental Mode Logic
    const sentimentSchema = experimental_mode ? `"Bullish" | "Bearish"` : `"Bullish" | "Bearish" | "Neutral"`;
    const experimentalInstruction = experimental_mode 
      ? `EXPERIMENTAL MODE: Return only Bullish or Bearish. Neutral is forbidden.` 
      : `Neutral is allowed if data is mixed.`;

    const systemPrompt = `You are an elite analyst. SEC > Research > News.`;
    const userPrompt = `Analyze ticker $${ticker}. ${experimentalInstruction}\n\nBUNDLE:\n${bundle}`;

    const analysisResult = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    });

    const analysis = JSON.parse(analysisResult.response.text.replace(/`{3}json|`{3}/g, "").trim());

    // 6. Final Persistence
    const { data: existing } = await supabase.from("watchlist").select("analysis_count").eq("id", row_id).single();
    const currentCount = existing?.analysis_count || 0;

    await supabase.from("watchlist").update({
      ...analysis,
      status: "updated",
      last_updated: new Date().toISOString(),
      last_analyzed_at: new Date().toISOString(),
      analysis_count: currentCount + 1,
    }).eq("id", row_id);

  } catch (error: any) {
    console.error("Analysis failure:", error?.message);
    await supabase.from("watchlist").update({
      status: "idle",
      reasoning: `System Error: ${error?.message || "Unknown error"}`,
      last_updated: new Date().toISOString(),
    }).eq("id", row_id);
  }
}

// ── External Fetchers ────────────────────────────────────────────────────────

async function fetchSECData(ticker: string, apiKey: string) {
  if (!apiKey) return "Key missing.";
  const res = await fetch(`https://api.sec-api.io?token=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: { query_string: { query: `ticker:${ticker} AND formType:("8-K" OR "10-Q")` } },
      from: "0", size: "3", sort: [{ filedAt: { order: "desc" } }]
    })
  });
  const data: any = await res.json();
  return data?.filings?.map((f: any) => `Form: ${f.formType} | Date: ${f.filedAt}`).join("\n") || "None.";
}

async function fetchScholarData(keywords: string, apiKey: string) {
  if (!apiKey) return "Key missing.";
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(keywords)}&fields=title,tldr&limit=5&year=2024-`, {
    headers: { "x-api-key": apiKey }
  });
  const data: any = await res.json();
  return data?.data?.map((p: any) => `Title: ${p.title}\nTLDR: ${p.tldr?.text || "N/A"}`).join("\n\n") || "None.";
}

async function fetchNewsData(companyName: string, newsKeywords: string, apiKey: string) {
  if (!apiKey) return "Key missing.";
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `${companyName} ${newsKeywords}`, limit: 5 })
  });
  const data: any = await res.json();
  return data?.data?.map((r: any) => `Source: ${r.url}\nContent: ${r.markdown?.substring(0, 400)}`).join("\n---\n") || "None.";
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
