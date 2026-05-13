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
    // Sync initial status and experimental flag to Supabase
    await supabase
      .from("watchlist")
      .update({ 
        status: "scanning", 
        last_updated: new Date().toISOString(), 
        experimental_mode 
      })
      .eq("id", row_id);

    // ── PASS 1: Objective Keyword Generation ──
    const kwPrompt = `Ticker: "${ticker}". Provide a raw JSON object for equity research:
    {
      "companyName": "Legal Entity Name",
      "researchKeywords": "5-7 technical/domain terms (no company name)",
      "newsKeywords": "2-3 material price-moving topics"
    }`;

    const keywords = await askGroq(kwPrompt, env.GROQ_API_KEY, true);

    // ── Parallel Data Ingestion ──
    const [secData, scholarData, newsData] = await Promise.allSettled([
      fetchSECData(ticker, env.SEC_API_KEY),
      fetchScholarData(keywords.researchKeywords, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(keywords.companyName, keywords.newsKeywords, env.FIRECRAWL_API_KEY),
    ]);

    const bundle = `
=== SEC REGULATORY FILINGS ===
${secData.status === 'fulfilled' ? secData.value : 'Unavailable'}

=== TECHNICAL/ACADEMIC CONTEXT ===
${scholarData.status === 'fulfilled' ? scholarData.value : 'Unavailable'}

=== MATERIAL NEWS & PRESS ===
${newsData.status === 'fulfilled' ? newsData.value : 'Unavailable'}`.trim();

    // ── PASS 2: Objective Synthesis ──
    const sentimentSchema = experimental_mode ? '"Bullish" | "Bearish"' : '"Bullish" | "Bearish" | "Neutral"';
    
    const systemPrompt = `You are a cold, objective quantitative analyst. You have no bias. 
    Your mission is to categorize a stock based on the balance of probabilities found in raw data.
    
    OBJECTIVE CLASSIFICATION RULES:
    1. BULLISH: Requires positive material catalysts (e.g., debt reduction, revenue beats, new patented tech).
    2. BEARISH: Requires negative material catalysts (e.g., default risk, shrinking margins, regulatory fines).
    3. NEUTRAL: Default for routine operations, business-as-usual filings, or high-uncertainty data where neither side has a 60% probability lead.
    
    Hierarchy of Truth: SEC (Verified Facts) > Research (Structural Trends) > News (Market Sentiment).`;
    
    const experimentalClause = experimental_mode
      ? `CRITICAL: Experimental Mode is ON. You are FORBIDDEN from choosing 'Neutral'. You must break the tie. Analyze the smallest delta in the data and commit to a binary 'Bullish' or 'Bearish' verdict.`
      : `Neutral is the expected baseline for low-volatility, routine financial data.`;

    const userPrompt = `Analyze ticker $${ticker}. ${experimentalClause}\n\nDATA BUNDLE:\n${bundle}\n\nReturn ONLY a JSON object:
    {
      "sentiment": ${sentimentSchema},
      "conviction_score": <1-10>,
      "primary_catalyst": "[SEC/Research/News] One blunt, objective sentence.",
      "key_risks": "The single most dangerous counter-thesis.",
      "time_horizon": "Short/Medium/Long-term",
      "reasoning": "2-3 sentences of cold synthesis. If Neutral, explain why the signal is noise.",
      "data_quality": "High|Medium|Low"
    }`;

    const analysis = await askGroq(userPrompt, env.GROQ_API_KEY, true, systemPrompt);

    // ── Final Update ──
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
    console.error("Analysis failure:", error.message);
    await supabase.from("watchlist").update({
      status: "idle",
      reasoning: `Objectivity Error: ${error.message}`,
      last_updated: new Date().toISOString(),
    }).eq("id", row_id);
  }
}

// ── Groq Logic ──
async function askGroq(prompt: string, apiKey: string, isJson: boolean, systemMsg?: string) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        ...(systemMsg ? [{ role: "system", content: systemMsg }] : []),
        { role: "user", content: prompt }
      ],
      response_format: isJson ? { type: "json_object" } : undefined,
      temperature: 0.05, // Near-zero for objective consistency
      max_tokens: 1024
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error: ${response.status}`);
  }

  const data: any = await response.json();
  const content = data.choices[0].message.content;
  return isJson ? JSON.parse(content.replace(/`{3}json|`{3}/g, "").trim()) : content;
}

// ── Data Fetchers ──
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
  return data?.filings?.map((f: any) => `Form: ${f.formType} | Date: ${f.filedAt}`).join("\n") || "No filings found.";
}

async function fetchScholarData(keywords: string, apiKey: string) {
  if (!apiKey) return "Key missing.";
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(keywords)}&fields=title,tldr&limit=5&year=2024-`, {
    headers: { "x-api-key": apiKey }
  });
  const data: any = await res.json();
  return data?.data?.map((p: any) => `Title: ${p.title}\nTLDR: ${p.tldr?.text || "N/A"}`).join("\n\n") || "No research papers.";
}

async function fetchNewsData(companyName: string, newsKeywords: string, apiKey: string) {
  if (!apiKey) return "Key missing.";
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `${companyName} ${newsKeywords}`, limit: 5 })
  });
  const data: any = await res.json();
  return data?.data?.map((r: any) => `Source: ${r.url}\nContent: ${r.markdown?.substring(0, 400)}`).join("\n---\n") || "No news found.";
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
