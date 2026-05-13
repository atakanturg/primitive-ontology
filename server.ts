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
    await supabase
      .from("watchlist")
      .update({ status: "scanning", last_updated: new Date().toISOString(), experimental_mode })
      .eq("id", row_id);

    // ── PASS 1: Keyword Generation (DeepSeek) ──
    const kwPrompt = `Given the stock ticker symbol "${ticker}", return a JSON object:
    {
      "companyName": "Full Name",
      "researchKeywords": "5-7 academic terms for Semantic Scholar",
      "newsKeywords": "2-3 high-impact news topics"
    }
    Return ONLY raw JSON.`;

    const keywords = await askDeepSeek(kwPrompt, env.DEEPSEEK_API_KEY, true);

    // ── Data Ingestion ──
    const [secData, scholarData, newsData] = await Promise.allSettled([
      fetchSECData(ticker, env.SEC_API_KEY),
      fetchScholarData(keywords.researchKeywords, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(keywords.companyName, keywords.newsKeywords, env.FIRECRAWL_API_KEY),
    ]);

    const bundle = `
=== SEC FILINGS ===
${secData.status === 'fulfilled' ? secData.value : 'Unavailable'}
=== RESEARCH ===
${scholarData.status === 'fulfilled' ? scholarData.value : 'Unavailable'}
=== NEWS ===
${newsData.status === 'fulfilled' ? newsData.value : 'Unavailable'}`.trim();

    // ── PASS 2: Ruthless Synthesis (DeepSeek) ──
    const sentimentSchema = experimental_mode ? '"Bullish" | "Bearish"' : '"Bullish" | "Bearish" | "Neutral"';
    
    const systemPrompt = `You are a ruthless, skeptical hedge fund analyst. Source weight: SEC > Research > News. Call out corporate jargon. Do not polish turds.`;
    
    const experimentalClause = experimental_mode
      ? `STRICT: Return only Bullish or Bearish. If the company is failing or burning cash, you MUST return Bearish.`
      : `Neutral is allowed only if data is perfectly balanced.`;

    const userPrompt = `Analyze ticker $${ticker}. ${experimentalClause}\n\nBUNDLE:\n${bundle}\n\nReturn ONLY a JSON object:
    {
      "sentiment": ${sentimentSchema},
      "conviction_score": <1-10>,
      "primary_catalyst": "[SEC/Research/News] blunt sentence",
      "key_risks": "one sentence",
      "time_horizon": "Short/Medium/Long-term",
      "reasoning": "2-3 ruthless sentences",
      "data_quality": "High|Medium|Low"
    }`;

    const analysis = await askDeepSeek(userPrompt, env.DEEPSEEK_API_KEY, false, systemPrompt);

    // ── Persistence ──
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
    console.error("DeepSeek Analysis Failure:", error.message);
    await supabase.from("watchlist").update({
      status: "idle",
      reasoning: `DeepSeek Error: ${error.message}`,
      last_updated: new Date().toISOString(),
    }).eq("id", row_id);
  }
}

// ── DeepSeek API Helper ──────────────────────────────────────────────────────

async function askDeepSeek(prompt: string, apiKey: string, isJson: boolean, systemMsg?: string) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-chat", // V3 is the current flag-ship
      messages: [
        ...(systemMsg ? [{ role: "system", content: systemMsg }] : []),
        { role: "user", content: prompt }
      ],
      response_format: isJson ? { type: "json_object" } : undefined,
      temperature: 0.3 // Keep it tight for financial data
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${err}`);
  }

  const data: any = await response.json();
  const content = data.choices[0].message.content;
  return isJson ? JSON.parse(content.replace(/`{3}json|`{3}/g, "").trim()) : content;
}

// ... (Keep existing fetchSECData, fetchScholarData, fetchNewsData, and json helper)

async function fetchSECData(ticker: string, apiKey: string): Promise<string> {
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

async function fetchScholarData(keywords: string, apiKey: string): Promise<string> {
  if (!apiKey) return "Key missing.";
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(keywords)}&fields=title,tldr&limit=5&year=2024-`, {
    headers: { "x-api-key": apiKey }
  });
  const data: any = await res.json();
  return data?.data?.map((p: any) => `Title: ${p.title}\nTLDR: ${p.tldr?.text || "N/A"}`).join("\n\n") || "None.";
}

async function fetchNewsData(companyName: string, newsKeywords: string, apiKey: string): Promise<string> {
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
