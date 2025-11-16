export default async function handler(req, res) {
  // Защита по секрету (используй тот же SETUP_SECRET, что для /api/set-webhook)
  const secret = process.env.SETUP_SECRET || "";
  if (secret && req.query.secret !== secret) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(200).json({ ok: false, error: "NO_TOKEN" });

  const url = `https://api.telegram.org/bot${token}/setMyCommands`;

  // Команды "как на скрине" — двуязычные подписи в дефолтном наборе
  const def = [
    { command: "menu",  description: "Main menu / Главное меню" },
    { command: "gpt",   description: "AI Chat / Диалог с ИИ" },
    { command: "design",description: "AI Design / Дизайн с ИИ" },
    { command: "audio", description: "AI Audio / Аудио с ИИ" },
    { command: "video", description: "AI Video / Видео будущего" }
  ];

  // Чистые локализации (если язык клиента известен)
  const en = [
    { command: "menu",  description: "Main menu" },
    { command: "gpt",   description: "AI Chat" },
    { command: "design",description: "AI Design" },
    { command: "audio", description: "AI Audio" },
    { command: "video", description: "AI Video" }
  ];
  const ru = [
    { command: "menu",  description: "Главное меню" },
    { command: "gpt",   description: "Диалог с ИИ" },
    { command: "design",description: "Дизайн с ИИ" },
    { command: "audio", description: "Аудио с ИИ" },
    { command: "video", description: "Видео будущего" }
  ];
  const ro = [
    { command: "menu",  description: "Meniu principal" },
    { command: "gpt",   description: "Chat AI" },
    { command: "design",description: "Design AI" },
    { command: "audio", description: "Audio AI" },
    { command: "video", description: "Video AI" }
  ];

  async function setCmds(commands, language_code, scope = { type: "all_private_chats" }) {
    const body = { commands, scope };
    if (language_code) body.language_code = language_code;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    return { language_code: language_code || "default", ...j };
  }

  try {
    const results = [];
    // Дефолтный набор с двуязычными подписями
    results.push(await setCmds(def, undefined));
    // Локализации
    results.push(await setCmds(en, "en"));
    results.push(await setCmds(ru, "ru"));
    results.push(await setCmds(ro, "ro"));

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
    }
