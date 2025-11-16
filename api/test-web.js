export default async function handler(req, res) {
  // защитим эндпоинт тем же секретом, что и для set-webhook
  const secret = process.env.SETUP_SECRET || "";
  if (secret && req.query.secret !== secret) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const key = process.env.TAVILY_API_KEY || "";
  const query = (req.query.query || "курс RON к EUR сегодня") + "";

  if (!key) return res.status(200).json({ ok: false, error: "NO_TAVILY_KEY" });

  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        include_answer: false,
        max_results: 3
      })
    });

    const status = resp.status;
    const data = await resp.json().catch(() => ({}));

    return res.status(200).json({
      ok: true,
      status,
      tavilyOk: resp.ok,
      resultsCount: Array.isArray(data.results) ? data.results.length : null,
      sample: Array.isArray(data.results)
        ? data.results.slice(0, 2).map(r => ({ title: r.title, url: r.url }))
        : null
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
                                       }
