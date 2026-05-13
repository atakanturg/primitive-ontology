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

    // ── PASS 1: Keyword Generation ──
    const kwPrompt = `Ticker: "${ticker}". Provide a raw JSON object for equity research:
    {
      "companyName": "Legal Entity Name",
      "researchKeywords": "5-7 technical/domain terms",
      "newsKeywords": "2-3 material price-moving topics"
    }`;

    const keywords = await askGroq(kwPrompt, env.GROQ_API_KEY, true);

    // ── Parallel Data Ingestion ──
    const [secData, scholarData, newsData] = await Promise.allSettled([
      fetchSECData(ticker), 
      fetchScholarData(keywords.researchKeywords, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(keywords.companyName, keywords.newsKeywords, env.FIRECRAWL_API_KEY),
    ]);

    const secString = secData.status === 'fulfilled' ? (secData.value || "No data") : 'Unavailable';
    const bundle = `
=== SEC FILINGS ===
${secString}

=== ACADEMIC/TECHNICAL RESEARCH ===
${scholarData.status === 'fulfilled' ? scholarData.value : 'Unavailable'}

=== MARKET NEWS & SENTIMENT ===
${newsData.status === 'fulfilled' ? newsData.value : 'Unavailable'}`.trim();

    // ── PASS 2: Ruthless Quant Synthesis ──
    const sentimentSchema = experimental_mode ? '"Bullish" | "Bearish"' : '"Bullish" | "Bearish" | "Neutral"';
    
    const systemPrompt = `You are a sophisticated, ruthless Quant Analyst. You synthesize complex data points across financial (SEC), structural (Academic), and behavioral (News) domains.

    SYNTHESIS RULES:
    1. NO LAZY NEUTRALS: Do not default to Neutral unless the data is perfectly contradictory. 
    2. NUANCE: Evaluate the interaction between research and finance. Does academic technical debt explain the poor SEC filings? 
    3. CITATIONS REQUIRED: Your reasoning MUST cite specific data points (e.g., "Per the 8-K filed on X..." or "Academic research on [Topic] suggests...").
    4. WEIGHTING: SEC is your anchor, but Academic Research is your leading indicator for long-term moats, and News is your short-term sentiment proxy.`;
    
    const experimentalClause = experimental_mode
      ? `EXPERIMENTAL MODE: Forced binary output. Pick the delta. Even if small, choose Bullish or Bearish based on the most credible leading indicator.`
      : `STANDARD MODE: Provide a nuanced, cited analysis.`;

    const userPrompt = `Perform a deep-dive analysis on ticker $${ticker}. ${experimentalClause}\n\nDATA BUNDLE:\n${bundle}\n\nReturn ONLY a JSON object:
    {
      "sentiment": ${sentimentSchema},
      "conviction_score": <1-10>,
      "primary_catalyst": "One detailed sentence with a citation.",
      "key_risks": "The most dangerous tail risk identified in the data.",
      "time_horizon": "Short/Medium/Long-term",
      "reasoning": "A high-nuance, multi-paragraph synthesis. You MUST cite specific filings, research papers, or news sources from the bundle. Connect the technical research to the financial outcomes.",
      "data_quality": "High|Medium|Low"
    }`;

    const analysis = await askGroq(userPrompt, env.GROQ_API_KEY, true, systemPrompt);

    // REMOVED: Manual conviction/quality caps that were forcing "Neutral" behavior

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
      temperature: 0.15, // Slightly higher for better reasoning nuance
      max_tokens: 2048 // Increased for detailed reasoning
    })
  });

  const data: any = await response.json();
  const content = data.choices[0].message.content;
  return isJson ? JSON.parse(content.replace(/`{3}json|`{3}/g, "").trim()) : content;
}

async function fetchSECData(ticker: string) {
  const userAgent = "Primitive-OS Quant Research (atakan.turg@gmail.com)"; 
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
        filtered.push(`[Source: SEC Form ${recent.form[i]} filed ${recent.filingDate[i]}]`);
      }
    }
    return filtered.join("\n");
  } catch (e) {
    return "SEC Direct Data Fetch Failed.";
  }
}

async function fetchScholarData(keywords: string, apiKey: string) {
  if (!apiKey) return "Scholar: Key missing.";
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(keywords)}&fields=title,tldr,authors,year&limit=5&year=2023-`, {
    headers: { "x-api-key": apiKey }
  });
  const data: any = await res.json();
  return data?.data?.map((p: any) => `[Source: Research Paper "${p.title}" (${p.year})] TLDR: ${p.tldr?.text || "N/A"}`).join("\n\n");
}

async function fetchNewsData(companyName: string, newsKeywords: string, apiKey: string) {
  if (!apiKey) return "News: Key missing.";
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `${companyName} ${newsKeywords}`, limit: 5 })
  });
  const data: any = await res.json();
  return data?.data?.map((r: any) => `[Source: Market News ${r.url}] Content: ${r.markdown?.substring(0, 500)}`).join("\n---\n");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
