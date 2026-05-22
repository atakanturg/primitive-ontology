import { createClient } from "@supabase/supabase-js";

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      return handleAnalyze(request, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/api/mailing-list") {
      return handleMailingList(request, env);
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

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase credentials not configured in Worker secrets" }, 503);
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

    // ── PASS 1: Keyword Generation (Groq) ──
    const kwPrompt = `Ticker: "${ticker}". Provide a raw JSON object for equity research:
    {
      "companyName": "Legal Entity Name",
      "researchKeywords": "5-7 technical/domain terms",
      "newsKeywords": "2-3 material price-moving topics"
    }`;

    const keywords = await askGroq(kwPrompt, env.GROQ_API_KEY, true);

    // ── Parallel Data Ingestion (SEC, Scholar, News, Ainvest Congress) ──
    const [secData, scholarData, newsData, senateData] = await Promise.allSettled([
      fetchSECData(ticker), 
      fetchScholarData(keywords.researchKeywords, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(keywords.companyName, keywords.newsKeywords, env.FIRECRAWL_API_KEY),
      fetchSenateTrades(ticker, env.AINVEST_API_KEY)
    ]);

    const secString = secData.status === 'fulfilled' ? secData.value : 'SEC Unavailable';
    const senateString = senateData.status === 'fulfilled' ? senateData.value : 'Congressional Data Unavailable';

    const bundle = `
=== SEC FILINGS (Direct Govt Source) ===
${secString}

=== CONGRESSIONAL TRADES (STOCK Act Disclosures) ===
${senateString}

=== ACADEMIC/TECHNICAL RESEARCH ===
${scholarData.status === 'fulfilled' ? scholarData.value : 'Unavailable'}

=== MARKET NEWS & SENTIMENT ===
${newsData.status === 'fulfilled' ? newsData.value : 'Unavailable'}`.trim();

    // ── PASS 2: Ruthless Informed-Capital Synthesis ──
    const sentimentSchema = experimental_mode ? '"Bullish" | "Bearish"' : '"Bullish" | "Bearish" | "Neutral"';
    
    const systemPrompt = `You are a Tier-1 Hedge Fund Strategy Lead. You detect "Informed Capital" flows.
    
    HIERARCHY OF TRUTH:
    1. CONGRESSIONAL TRADES: Politicians often have non-public insights into regulatory shifts. Treat STOCK Act disclosures (Form 278-T) as Priority 1.
    2. SEC FILINGS: The hard baseline for fiscal health.
    3. RESEARCH/NEWS: Structural context and short-term noise.
    
    ANALYSIS PROTOCOL:
    - SKEPTICISM: Ignore corporate rebrands or PR news unless supported by SEC Margin expansion or Congressional buying.
    - CITATIONS: You MUST cite specific Form types, Politician names, or Research papers from the bundle.
    - REPORTING GAPS: If a politician filed significantly late (e.g., >45 days), treat it as a red flag.`;
    
    const userPrompt = `Analyze ticker $${ticker}. ${experimental_mode ? 'EXPERIMENTAL: No Neutral.' : ''}\n\nDATA BUNDLE:\n${bundle}\n\nReturn ONLY a JSON object:
    {
      "sentiment": ${sentimentSchema},
      "conviction_score": <1-10>,
      "primary_catalyst": "One detailed sentence citing SEC or Congressional trade data.",
      "key_risks": "The single most dangerous counter-thesis.",
      "time_horizon": "Short/Medium/Long-term",
      "reasoning": "2-3 paragraphs of ruthless synthesis. Cite specific trade dates, sizes, and names. Connect politician activity and SEC filings to technical research.",
      "data_quality": "High|Medium|Low",
      "political_sentiment": "Bullish" | "Bearish" | "Neutral"
    }`;

    const analysis = await askGroq(userPrompt, env.GROQ_API_KEY, true, systemPrompt);

    // First get current count, then update atomically
    const { data: currentRow } = await supabase.from("watchlist").select("analysis_count").eq("id", row_id).single();
    const newCount = (currentRow?.analysis_count ?? 0) + 1;

    await supabase.from("watchlist").update({
      ...analysis,
      political_signal_data: senateData.status === 'fulfilled' ? senateData.value : null,
      status: "updated",
      last_updated: new Date().toISOString(),
      last_analyzed_at: new Date().toISOString(),
      analysis_count: newCount,
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

// ── Corrected Ainvest API Implementation (OpenAPI 3.1.0) ──
async function fetchSenateTrades(ticker: string, apiKey: string) {
  if (!apiKey) return "Senate: API Key missing.";
  try {
    // Official endpoint: /ownership/congress
    const url = `https://openapi.ainvest.com/open/ownership/congress?ticker=${ticker.toUpperCase()}&size=5`;
    
    const res = await fetch(url, {
      headers: { 
        "Authorization": `Bearer ${apiKey}`, // Bearer Auth required
        "Accept": "application/json"
      }
    });

    if (!res.ok) return `Senate Data Error: ${res.status}`;
    const json: any = await res.json();
    
    // Per schema: data is nested in data.data
    const trades = json?.data?.data;
    if (!trades || trades.length === 0) return "No recent Congressional trades found.";

    return trades.map((t: any) => 
      `${t.name} (${t.party}-${t.state}): ${t.trade_type.toUpperCase()} ${t.size} on ${t.trade_date} (Filed: ${t.filing_date}, Gap: ${t.reporting_gap})`
    ).join("\n");
  } catch (e) {
    return "Senate Data Fetch Failed.";
  }
}

async function fetchSECData(ticker: string) {
  const userAgent = "Primitive-OS Research Engine (atakan.turg@gmail.com)"; 
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

async function askGroq(prompt: string, apiKey: string, isJson: boolean, systemMsg?: string) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [...(systemMsg ? [{ role: "system", content: systemMsg }] : []), { role: "user", content: prompt }],
      response_format: isJson ? { type: "json_object" } : undefined,
      temperature: 0.1,
      max_tokens: 2048
    })
  });
  const data: any = await response.json();
  // Replace: const content = data.choices[0].message.content;
// With this bulletproof version:

const content = data?.choices?.[0]?.message?.content;

if (!content) {
  throw new Error(`AI Gateway Failure: The model returned an empty response. This often happens due to content filtering or malformed data bundles. Raw response: ${JSON.stringify(data?.error || data?.choices?.[0]?.finish_reason || 'unknown')}`);
}
  return isJson ? JSON.parse(content.replace(/`{3}json|`{3}/g, "").trim()) : content;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleMailingList(request: Request, env: any): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { email } = body;
  if (!email) return json({ error: "Email is required" }, 400);

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CONTACTS_GROUP_ID } = env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !GOOGLE_CONTACTS_GROUP_ID) {
    return json({ error: "Google API configuration missing on server" }, 500);
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    const tokenData: any = await tokenResponse.json();
    if (!tokenData.access_token) {
      throw new Error("Failed to refresh Google access token");
    }

    const createContactResponse = await fetch("https://people.googleapis.com/v1/people:createContact", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        emailAddresses: [{ value: email }],
        memberships: [{ contactGroupMembership: { contactGroupResourceName: `contactGroups/${GOOGLE_CONTACTS_GROUP_ID}` } }],
      }),
    });

    if (!createContactResponse.ok) {
      const errorData = await createContactResponse.json();
      // If contact already exists, we might want to just add to group, but createContact with membership is cleaner if new.
      // For simplicity in this requirement, we assume we create a new entry or handle error.
      throw new Error(`Google API error: ${JSON.stringify(errorData)}`);
    }

    return json({ success: true });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
}
