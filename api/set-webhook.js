export default async function handler(req, res) {
  // Защитим вызов простым секретом в URL, чтобы посторонние не дергали
  const secret = process.env.SETUP_SECRET || "";
  if (secret && req.query.secret !== secret) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(200).json({ ok: false, error: "NO_TOKEN" });

  const base = `https://${req.headers.host}`;
  const url = `${base}/api/webhook`;

  try {
    // удалим старый, на всякий
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    // ставим новый
    const tg = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await tg.json();
    return res.status(200).json({ requested_url: url, ...data });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
