export default async function handler(req, res) {
  // Защита по секрету
  const secret = process.env.SETUP_SECRET || "";
  if (secret && req.query.secret !== secret) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(200).json({ ok: false, error: "NO_TOKEN" });

  const url = `https://api.telegram.org/bot${token}/setMyCommands`;

  // 1. СПИСОК НА АНГЛИЙСКОМ (Default + EN)
  const en = [
    { command: "start", description: "🔄 Restart Bot" },
    { command: "info", description: "🤖 What bot can do" },
    { command: "account", description: "👤 My Account" },
    { command: "premium", description: "⭐️ Premium Subscription" },
    { command: "clear", description: "🗑️ Delete Context" },
    { command: "image", description: "🖼️ Image Generation" },
    { command: "suno", description: "🎸 Create Music" },
    { command: "video", description: "🎬 Create Video" },
    { command: "academic", description: "📚 Academic Service" },
    { command: "search", description: "🌐 Internet Search" },
    { command: "settings", description: "⚙️ Bot Settings" },
    { command: "help", description: "⌨️ Main Commands" },
    { command: "terms", description: "📜 User Agreement" }
  ];

  // 2. СПИСОК НА РУССКОМ
  const ru = [
    { command: "start", description: "🔄 Перезапуск" },
    { command: "info", description: "🤖 Что умеет бот" },
    { command: "account", description: "👤 Мой аккаунт" },
    { command: "premium", description: "⭐️ Премиум подписка" },
    { command: "clear", description: "🗑️ Сброс контекста" },
    { command: "image", description: "🖼️ Генерация фото" },
    { command: "suno", description: "🎸 Создать музыку" },
    { command: "video", description: "🎬 Создать видео" },
    { command: "academic", description: "📚 Учеба и Рефераты" },
    { command: "search", description: "🌐 Поиск в интернете" },
    { command: "settings", description: "⚙️ Настройки" },
    { command: "help", description: "⌨️ Главные команды" },
    { command: "terms", description: "📜 Соглашение" }
  ];

  // 3. СПИСОК НА РУМЫНСКОМ
  const ro = [
    { command: "start", description: "🔄 Repornire" },
    { command: "info", description: "🤖 Ce poate botul" },
    { command: "account", description: "👤 Contul meu" },
    { command: "premium", description: "⭐️ Abonament Premium" },
    { command: "clear", description: "🗑️ Șterge context" },
    { command: "image", description: "🖼️ Generare foto" },
    { command: "suno", description: "🎸 Creează muzică" },
    { command: "video", description: "🎬 Creează video" },
    { command: "academic", description: "📚 Studii și Referate" },
    { command: "search", description: "🌐 Căutare web" },
    { command: "settings", description: "⚙️ Setări" },
    { command: "help", description: "⌨️ Comenzi principale" },
    { command: "terms", description: "📜 Termeni" }
  ];

  // Функция отправки в Telegram
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
    // Устанавливаем дефолтный список (English)
    results.push(await setCmds(en, undefined));
    // Устанавливаем локализации
    results.push(await setCmds(en, "en"));
    results.push(await setCmds(ru, "ru"));
    results.push(await setCmds(ro, "ro"));

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
      }
