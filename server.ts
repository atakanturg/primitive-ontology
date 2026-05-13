import { GoogleGenAI } from "@google/genai";
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
  const ai = new GoogleGenAI(env.GEMINI_API_KEY);

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
    // 1. Update status to scanning
    await supabase.from("watchlist").update({ 
      status: "scanning", 
      last_updated: new Date().toISOString() 
    }).eq("id", row_id);

    // 2. Fetch Keywords (Gemini 2.5)
    const kwModel = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const kwResult = await kwModel.generateContent({
      contents: [{ role: "user", parts: [{ text: `Ticker: ${ticker}. Return JSON: companyName, researchKeywords, newsKeywords.` }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
    const keywords = JSON.parse(kwResult.response.text.replace(/`{3}json|`{3}/g, "").trim());

    // 3. Parallel Data Fetching
    const [sec, res, news] = await Promise.allSettled([
      fetchSECData(ticker, env.SEC_API_KEY),
      fetchScholarData(keywords.researchKeywords, env.SEMANTIC_SCHOLAR_API_KEY),
      fetchNewsData(keywords.companyName, keywords.newsKeywords, env.FIRECRAWL_API_KEY),
    ]);

    const bundle = `SEC: ${sec.status==='fulfilled'?sec.value:'N/A'}\nResearch: ${res.status==='fulfilled'?res.value:'N/A'}\nNews: ${news.status==='fulfilled'?news.value:'N/A'}`;

    // 4. Final Analysis (Experimental Switch)
    const sentimentSchema = experimental_mode ? `"Bullish" | "Bearish"` : `"Bullish" | "Bearish" | "Neutral"`;
    const experimentalModeInstruction = experimental_mode ? "STRICT: Return Bullish or Bearish only. NO NEUTRAL." : "";

    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const analysisResult = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: `Analyze ${ticker}. ${experimentalModeInstruction}\n\n${bundle}\n\nReturn JSON with: sentiment (${sentimentSchema}), conviction_score, primary_catalyst, key_risks, time_horizon, reasoning, data_quality.` }] }],
      generationConfig: { responseMimeType: "application/json" },
    });

    const analysis = JSON.parse(analysisResult.response.text.replace(/`{3}json|`{3}/g, "").trim());

    // 5. Final Supabase Update
    await supabase.from("watchlist").update({
      ...analysis,
      status: "updated",
      last_updated: new Date().toISOString(),
      last_analyzed_at: new Date().toISOString()
    }).eq("id", row_id);

  } catch (error: any) {
    console.error("Worker Failure:", error.message);
    await supabase.from("watchlist").update({ status: "idle", reasoning: error.message }).eq("id", row_id);
  }
}

// Minimal Helper implementations
async function fetchSECData(t: string, k: string) { return "SEC Data"; }
async function fetchScholarData(kw: string, k: string) { return "Scholar Data"; }
async function fetchNewsData(cn: string, nkw: string, k: string) { return "News Data"; }

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
