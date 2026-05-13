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

  const { ticker, user_id, row_id } = body;

  if (!ticker || !user_id || !row_id) {
    return json({ error: "Missing required fields" }, 400);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  // ctx.waitUntil keeps the Worker alive until processData finishes
  // even after the 202 response is sent back to the client
  ctx.waitUntil(processData({ ticker, row_id, supabase, ai, env }));

  return json({ status: "processing" }, 202);
}

async function processData({
  ticker, row_id, supabase, ai, env,
}: {
  ticker: string;
  row_id: string;
  supabase: any;
  ai: any;
  env: any;
}): Promise<void> {
  try {
    await supabase
      .from("watchlist")
      .update({ status: "scanning", last_updated: new Date().toISOString() })
      .eq("id", row_id);

    const [secData, scholarData, newsData] = await Promise.allSettled([
      fetchSECData(ticker, env.SEC_API_KEY),
      fetchScholarData(ticker, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(ticker, env.FIRECRAWL_API_KEY),
    ]);

    const bundle = `
=== SEC FILINGS ===
${secData.status === "fulfilled" ? secData.value : "Unavailable"}
=== RESEARCH ===
${scholarData.status === "fulfilled" ? scholarData.value : "Unavailable"}
=== NEWS ===
${newsData.status === "fulfilled" ? newsData.value : "Unavailable"}`.trim();

    const systemPrompt = `You are an elite quantitative analyst with deep expertise in equity research, regulatory analysis, and academic literature review.

Your job is to synthesize three distinct data sources — SEC/regulatory filings, academic research, and real-time news — into a single, high-signal investment thesis for a given stock ticker.

Source weighting hierarchy (apply in this order):
1. SEC filings & regulatory disclosures — highest weight; these are material, legally binding signals.
2. Academic & technical research — medium weight; relevant for structural/innovation shifts.
3. News & press releases — lowest weight; useful for timing, but prone to noise and recency bias.

Your output must be a single JSON object. Do not include markdown, code fences, or any preamble. Return only raw JSON.`;

    const userPrompt = `Analyze the following data bundle for ticker $${ticker} and return a structured investment signal.

--- DATA BUNDLE ---
${bundle}
--- END BUNDLE ---

Return ONLY a JSON object with exactly these fields:

{
  "sentiment": "Bullish" | "Bearish" | "Neutral",
  "conviction_score": <integer 1-10, where 10 = highest conviction>,
  "primary_catalyst": "<The single most impactful finding. Start with '[SEC]', '[Research]', or '[News]', followed by one blunt sentence.>",
  "key_risks": "<The strongest counterargument or tail risk. One sentence.>",
  "time_horizon": "Short-term (0-3 months)" | "Medium-term (3-12 months)" | "Long-term (1+ years)",
  "reasoning": "<2-3 sentence synthesis connecting data sources to the sentiment. Be specific.>",
  "data_quality": "High" | "Medium" | "Low"
}

Rules:
- conviction_score: cap at 6 if any source was unavailable.
- data_quality: "High" if all 3 sources had real data, "Medium" if 1-2 missing, "Low" if all unavailable.
- Never fabricate figures.
- Sentiment must follow the source weight hierarchy.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
      config: { responseMimeType: "application/json" },
    });

    const rawText = response.text ?? "";
    console.log("Gemini raw response:", rawText);

    const cleanedJson = rawText.replace(/`{3}json|`{3}/g, "").trim();
    const analysis = JSON.parse(cleanedJson);

    const { data: existing } = await supabase
      .from("watchlist")
      .select("analysis_count")
      .eq("id", row_id)
      .single();

    const currentCount =
      typeof existing?.analysis_count === "number" ? existing.analysis_count : 0;

    const { error: updateError } = await supabase
      .from("watchlist")
      .update({
        ...analysis,
        status: "updated",
        last_updated: new Date().toISOString(),
        last_analyzed_at: new Date().toISOString(),
        analysis_count: currentCount + 1,
      })
      .eq("id", row_id);

    if (updateError) {
      console.error("Supabase update error:", updateError.message);
    } else {
      console.log("Successfully updated watchlist for", ticker);
    }

  } catch (error: any) {
    console.error("Analysis background failure:", error?.message || error);
    console.error("Stack:", error?.stack);

    await supabase
      .from("watchlist")
      .update({
        status: "idle",
        reasoning: `Error: ${error?.message || "Unknown error"}`,
        last_updated: new Date().toISOString(),
      })
      .eq("id", row_id);
  }
}

async function fetchSECData(ticker: string, apiKey: string): Promise<string> {
  if (!apiKey) return "Skipped: SEC_API_KEY not configured.";
  try {
    const response = await fetch(`https://api.sec-api.io?token=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { query_string: { query: `ticker:${ticker} AND formType:("8-K" OR "10-Q")` } },
        from: "0",
        size: "1",
        sort: [{ filedAt: { order: "desc" } }],
      }),
    });
    if (!response.ok) return "SEC API Error.";
    const data: any = await response.json();
    if (data?.filings?.length > 0) {
      const f = data.filings[0];
      return `Form: ${f.formType} on ${f.filedAt}. Desc: ${f.description || "N/A"}`;
    }
    return "No recent SEC filings found.";
  } catch {
    return "Error fetching SEC data.";
  }
}

async function fetchScholarData(ticker: string, apiKey: string): Promise<string> {
  if (!apiKey) return "Skipped: SEMANTIC_SCHOLAR_API_KEY not configured.";
  try {
    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${ticker} industry innovation&fields=title,abstract,tldr&limit=3&year=2024-`,
      { headers: { "x-api-key": apiKey } }
    );
    if (!response.ok) return "Scholar API Error.";
    const data: any = await response.json();
    if (data?.data?.length > 0) {
      return data.data
        .map((p: any) => `Title: ${p.title}\nTLDR: ${p.tldr?.text || "N/A"}`)
        .join("\n\n");
    }
    return "No recent papers found.";
  } catch {
    return "Error fetching academic data.";
  }
}

async function fetchNewsData(ticker: string, apiKey: string): Promise<string> {
  if (!apiKey) return "Skipped: FIRECRAWL_API_KEY not configured.";
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: `https://finance.yahoo.com/quote/${ticker}/press-releases`,
        formats: ["markdown"],
      }),
    });
    if (!response.ok) return "Firecrawl API Error.";
    const data: any = await response.json();
    if (data?.data?.markdown) {
      return data.data.markdown.substring(0, 1500) + "...";
    }
    return "No news data extracted.";
  } catch {
    return "Error fetching news data.";
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
