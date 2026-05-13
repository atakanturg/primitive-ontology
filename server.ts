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

    // ── PASS 1: Objective Keyword Generation (Groq) ──
    const kwPrompt = `Ticker: "${ticker}". Provide a raw JSON object for equity research:
    {
      "companyName": "Legal Entity Name",
      "researchKeywords": "5-7 technical/domain terms (no company name)",
      "newsKeywords": "2-3 material price-moving topics"
    }`;

    const keywords = await askGroq(kwPrompt, env.GROQ_API_KEY, true);

    // ── Parallel Data Ingestion ──
    const [secData, scholarData, newsData] = await Promise.allSettled([
      fetchSECData(ticker), // Switched to Direct SEC
      fetchScholarData(keywords.researchKeywords, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(keywords.companyName, keywords.newsKeywords, env.FIRECRAWL_API_KEY),
    ]);

    const secString = secData.status === 'fulfilled' ? (secData.value || "No data returned") : 'Unavailable';
    const bundle = `
=== SEC FILINGS (Direct Govt Source) ===
${secString}

=== TECHNICAL CONTEXT ===
${scholarData.status === 'fulfilled' ? scholarData.value : 'Unavailable'}

=== MATERIAL NEWS ===
${newsData.status === 'fulfilled' ? newsData.value : 'Unavailable'}`.trim();

    // ── PASS 2: Objective Synthesis (Groq) ──
    const sentimentSchema = experimental_mode ? '"Bullish" | "Bearish"' : '"Bullish" | "Bearish" | "Neutral"';
    
    const systemPrompt = `You are a cold, objective quantitative analyst. You have zero bias.

    OBJECTIVE CLASSIFICATION RULES:
    1. RECENCY OVERRIDE: Any event older than 3-6 months (e.g., past mergers, old product launches) is PRICED IN and must be treated as NEUTRAL noise.
    2. BULLISH: Requires NEW, concrete positive data (e.g., surprise margin expansion, active debt reduction).
    3. BEARISH: Requires NEW, concrete negative data (e.g., rising cash burn, insolvency risk).
    4. NEUTRAL: Default for routine operations, "priced-in" historical events, or lack of concrete data.
    
    Hierarchy: SEC (Verified Facts) > Research (Structural) > News (Sentiment).`;
    
    const experimentalClause = experimental_mode
      ? `CRITICAL: Experimental Mode ON. FORBIDDEN to choose 'Neutral'. Analyze the smallest recent delta and pick a binary side. If data is completely empty, default to Bearish due to opacity.`
      : `Neutral is the default baseline for routine data or empty data.`;

    const userPrompt = `Analyze ticker $${ticker}. ${experimentalClause}\n\nBUNDLE:\n${bundle}\n\nReturn ONLY a JSON object:
    {
      "sentiment": ${sentimentSchema},
      "conviction_score": <1-10>,
      "primary_catalyst": "[SEC/Research/News] Blunt sentence.",
      "key_risks": "Single most dangerous counter-thesis.",
      "time_horizon": "Short/Medium/Long-term",
      "reasoning": "2-3 ruthless sentences of cold synthesis. Call out if an event is priced in.",
      "data_quality": "High|Medium|Low"
    }`;

    const analysis = await askGroq(userPrompt, env.GROQ_API_KEY, true, systemPrompt);

    // FIX: Safe Navigation (!secString || ...) prevents the crash if secString is null/undefined
    if (!secString || secString.includes("No filings found") || secString.includes("Error") || secString === "Unavailable") {
        analysis.data_quality = "Low";
        if (analysis.conviction_score > 4 && !experimental_mode) {
            analysis.conviction_score = 4; 
        }
    }

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
      reasoning: `Intelligence Error: ${error.message}`,
      last_updated: new Date().toISOString(),
    }).eq("id", row_id);
  }
}

// ── Helpers ──

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
      temperature: 0.05,
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

async function fetchSECData(ticker: string) {
  // Identify yourself to SEC as required by Fair Access policy
  const userAgent = "Primitive-OS Research Engine (atakan.turg@gmail.com)"; 

  try {
    // 1. Get CIK mapping from SEC
    const mappingRes = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": userAgent }
    });
    if (!mappingRes.ok) return "SEC Direct Error: Mapping unavailable.";

    const mapping: any = await mappingRes.json();
    const companyEntry = Object.values(mapping).find(
      (c: any) => c.ticker === ticker.toUpperCase()
    ) as any;

    if (!companyEntry) return "SEC Direct Error: Ticker not in mapping.";

    const cik = companyEntry.cik_str.toString().padStart(10, '0');

    // 2. Fetch submissions for this CIK
    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "User-Agent": userAgent }
    });
    if (!subRes.ok) return `SEC Direct Error: ${subRes.status}`;

    const subData: any = await subRes.json();
    const recent = subData.filings?.recent;
    if (!recent || !recent.form) return "SEC Direct Error: No filing history.";

    // 3. Filter for material forms (10-K, 10-Q, 8-K)
    const filtered = [];
    for (let i = 0; i < recent.form.length && filtered.length < 3; i++) {
      if (["10-K", "10-Q", "8-K"].includes(recent.form[i])) {
        filtered.push(`Form: ${recent.form[i]} | Date: ${recent.filingDate[i]}`);
      }
    }

    return filtered.length > 0 
      ? `Recent filings found:\n${filtered.join("\n")}`
      : "No material filings found recently.";

  } catch (e: any) {
    return `SEC Direct Error: ${e.message}`;
  }
}

async function fetchScholarData(keywords: string, apiKey: string) {
  if (!apiKey) return "Key missing.";
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(keywords)}&fields=title,tldr&limit=5&year=2024-`, {
    headers: { "x-api-key": apiKey }
  });
  const data: any = await res.json();
  return data?.data?.map((p: any) => `Title: ${p.title}\nTLDR: ${p.tldr?.text || "N/A"}`).join("\n\n") || "No research.";
}

async function fetchNewsData(companyName: string, newsKeywords: string, apiKey: string) {
  if (!apiKey) return "Key missing.";
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
