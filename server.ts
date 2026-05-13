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

    // ── PASS 1: Technical Keyword Generation ──
    const kwPrompt = `Ticker: "${ticker}". Provide a raw JSON object for equity research:
    {
      "companyName": "Legal Entity Name",
      "researchKeywords": "5-7 technical/domain terms (no company name)",
      "newsKeywords": "2-3 material price-moving topics"
    }`;

    const keywords = await askGroq(kwPrompt, env.GROQ_API_KEY, true);

    // ── Parallel Data Ingestion (SEC, Scholar, News, Senate) ──
    const [secData, scholarData, newsData, senateData] = await Promise.allSettled([
      fetchSECData(ticker), 
      fetchScholarData(keywords.researchKeywords, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(keywords.companyName, keywords.newsKeywords, env.FIRECRAWL_API_KEY),
      fetchSenateTrades(ticker, env.AINVEST_API_KEY)
    ]);

    const secString = secData.status === 'fulfilled' ? (secData.value || "No SEC data") : 'SEC Unavailable';
    const senateString = senateData.status === 'fulfilled' ? (senateData.value || "No Senate activity") : 'Senate Data Unavailable';

    const bundle = `
=== SEC FILINGS (Direct Govt Source) ===
${secString}

=== SENATE & POLITICIAN ACTIVITY (Ainvest) ===
${senateString}

=== ACADEMIC/TECHNICAL RESEARCH ===
${scholarData.status === 'fulfilled' ? scholarData.value : 'Unavailable'}

=== MARKET NEWS & SENTIMENT ===
${newsData.status === 'fulfilled' ? newsData.value : 'Unavailable'}`.trim();

    // ── PASS 2: Ruthless Informed-Capital Synthesis ──
    const sentimentSchema = experimental_mode ? '"Bullish" | "Bearish"' : '"Bullish" | "Bearish" | "Neutral"';
    
    const systemPrompt = `You are a Tier-1 Hedge Fund Strategy Lead. You detect "Informed Capital" flows.
    
    HIERARCHY OF TRUTH:
    1. SENATE TRADES: If a politician with committee oversight buys/sells, treat this as a PRIORITY 1 signal.
    2. SEC FILINGS: The hard baseline for fiscal health. 
    3. RESEARCH/NEWS: Structural context and short-term noise.
    
    ANALYSIS PROTOCOL:
    - SKEPTICISM: Corporate pivots or rebrands (e.g., dropping 'Meat' from a name) are ignored unless supported by SEC Gross Margin expansion or Senate buying.
    - CITATIONS: You MUST cite specific Form types, Politician names, or Research papers from the bundle.
    - NO HALLUCINATIONS: If data is missing or errored, you must state the financials are opaque and lower conviction.`;
    
    const experimentalClause = experimental_mode
      ? `EXPERIMENTAL MODE: Forced binary output. Even on weak signals, you must commit to Bullish or Bearish based on the most credible leading indicator.`
      : `STANDARD MODE: Provide a nuanced, highly cited analysis.`;

    const userPrompt = `Analyze ticker $${ticker}. ${experimentalClause}\n\nDATA BUNDLE:\n${bundle}\n\nReturn ONLY a JSON object:
    {
      "sentiment": ${sentimentSchema},
      "conviction_score": <1-10>,
      "primary_catalyst": "One detailed sentence citing specific SEC or Senate data.",
      "key_risks": "The single most dangerous counter-thesis.",
      "time_horizon": "Short/Medium/Long-term",
      "reasoning": "2-3 paragraphs of ruthless synthesis. Connect Senate activity and SEC filings to the long-term technical research. Call out PR noise vs fiscal reality.",
      "data_quality": "High|Medium|Low"
    }`;

    const analysis = await askGroq(userPrompt, env.GROQ_API_KEY, true, systemPrompt);

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
      temperature: 0.1,
      max_tokens: 2048
    })
  });

  const data: any = await response.json();
  const content = data.choices[0].message.content;
  return isJson ? JSON.parse(content.replace(/`{3}json|`{3}/g, "").trim()) : content;
}

async function fetchSenateTrades(ticker: string, apiKey: string) {
  if (!apiKey) return "Senate: API Key missing.";
  try {
    const res = await fetch(`https://api.ainvest.com/market/senate-trades?symbol=${ticker}`, {
      headers: { "x-api-key": apiKey }
    });
    if (!res.ok) return `Senate Data Error: ${res.status}`;
    const data: any = await res.json();
    return data?.items?.slice(0, 5).map((t: any) => 
      `Politician: ${t.name} | Office: ${t.office} | Action: ${t.transaction_type} | Amount: ${t.amount_range} on ${t.date}`
    ).join("\n") || "No recent Senate trades detected.";
  } catch (e) {
    return "Senate Data Fetch Failed.";
  }
}

async function fetchSECData(ticker: string) {
  const userAgent = "Primitive-OS Research Project (atakan.turg@gmail.com)"; 
  try {
    const mappingRes = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": userAgent }
    });
    const mapping: any = await mappingRes.json();
    const companyEntry = Object.values(mapping).find((c: any) => c.ticker === ticker.toUpperCase()) as any;
    if (!companyEntry) return "SEC: Ticker mapping failed.";

    const cik = companyEntry.cik_str.toString().padStart(10, '0');
    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "User-Agent": userAgent }
    });
    const subData: any = await subRes.json();
    const recent = subData.filings?.recent;
    const filtered = [];
    for (let i = 0; i < recent.form.length && filtered.length < 5; i++) {
      if (["10-K", "10-Q", "8-K"].includes(recent.form[i])) {
        filtered.push(`Form: ${recent.form[i]} | Date: ${recent.filingDate[i]}`);
      }
    }
    return filtered.join("\n");
  } catch (e) {
    return "SEC Direct Data Fetch Failed.";
  }
}

async function fetchScholarData(keywords: string, apiKey: string) {
  if (!apiKey) return "Scholar: Key missing.";
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(keywords)}&fields=title,tldr,year&limit=5&year=2024-`, {
    headers: { "x-api-key": apiKey }
  });
  const data: any = await res.json();
  return data?.data?.map((p: any) => `Paper: "${p.title}" (${p.year}) | TLDR: ${p.tldr?.text || "N/A"}`).join("\n\n");
}

async function fetchNewsData(companyName: string, newsKeywords: string, apiKey: string) {
  if (!apiKey) return "News: Key missing.";
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `${companyName} ${newsKeywords}`, limit: 5 })
  });
  const data: any = await res.json();
  return data?.data?.map((r: any) => `Source: ${r.url}\nContent: ${r.markdown?.substring(0, 400)}`).join("\n---\n");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
