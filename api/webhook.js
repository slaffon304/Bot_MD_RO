import { Bot, webhookCallback, InlineKeyboard, Keyboard } from "grammy";
import {
  getHistory, pushMessage, clearHistory,
  getUserModel, setUserModel,
  getUserLang, setUserLang, setLangManual, isLangManual,
  subscribeWeather, unsubscribeWeather,
  setCity, getCity,
  setAwaitingCity, isAwaitingCity, clearAwaitingCity
} from "../lib/store.js";

// ── Конфиг ──────────────────────────────────────────────────────────
const provider = (process.env.PROVIDER || "none").toLowerCase();
const envModel = process.env.MODEL || "";
const FORCE_WEB_FOR_OPEN = (process.env.FORCE_WEB_FOR_OPEN ?? "1") !== "0";

function defaultModel() { return envModel || "gpt-4o-mini"; }
function systemPrompt() { return "Ты краткий и полезный ассистент. Отвечай на языке пользователя."; }
function isToolCapableModel(m){ return /gpt-4o/i.test(m); }
function isOpenModelNeedingWeb(m){ return /(meta-llama|llama|mistral)/i.test(m); }

function chunkAndReply(ctx, text) {
  const max = 3800;
  const tasks = [];
  for (let i = 0; i < text.length; i += max) {
    tasks.push(ctx.reply(text.slice(i, i + max), { reply_to_message_id: ctx.message.message_id }));
  }
  return tasks.reduce((p, t) => p.then(() => t), Promise.resolve());
}

// ── LLM (OpenRouter) ────────────────────────────────────────────────
async function getLLMClient() {
  if (provider !== "openrouter") return null;
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) return null;
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
}

// ── Язык ────────────────────────────────────────────────────────────
function detectLang(code) {
  const s = (code || "").toLowerCase().split("-")[0];
  if (["ru", "ro", "en"].includes(s)) return s;
  return "en";
}
async function userLang(ctx) {
  const current = detectLang(ctx.from?.language_code);
  const saved = await getUserLang(ctx.from.id);
  const manual = await isLangManual(ctx.from.id);
  if (!saved) { await setUserLang(ctx.from.id, current); return current; }
  if (!manual && current && current !== saved) { await setUserLang(ctx.from.id, current); return current; }
  return saved || current || "en";
}

// ── Навигация ───────────────────────────────────────────────────────
const NAV = {
  ru: `Привет! 👋 Я даю доступ к сильным ИИ для текста, картинок, видео и музыки.
Что умею:
• Писать/переводить тексты, объяснять, писать код
• Генерировать изображения и видео из текста
• Работать с документами
• Озвучивать текст и распознавать голос
Полезно:
• Просто напишите — если нужны свежие данные, схожу в интернет
• /model — выбрать модель (GPT‑4o‑mini, Llama, Mistral)
• /new — новый диалог
• /web запрос — ручной веб‑поиск
• /lang - выбор языка
• /weather [город] — погода сейчас
• /setcity [город] — город по умолчанию
• /unsubscribe — выключить утреннюю рассылку
• /help — список возможностей
Скоро: /img (картинки), /video (видео), /tts (озвучка), /stats (статистика)`,
  ro: `Salut! 👋 Acces rapid la AI pentru text, imagini, video și muzică.
Ce pot:
• Scriu/traduc texte, explic, scriu cod
• Generez imagini și video
• Lucrez cu documente
• TTS și recunoaștere voce
Util:
• Scrie un mesaj — dacă e nevoie, caut pe internet
• /model — alege modelul (GPT‑4o‑mini, Llama, Mistral)
• /new — dialog nou
• /web întrebare — căutare web manuală
• /lang - alegeți limba
• /weather [oraș] — meteo acum
• /setcity [oraș] — oraș implicit
• /unsubscribe — oprește prognoza de dimineață
• /help — comenzi
În curând: /img, /video, /tts, /stats`,
  en: `Hi! 👋 Access top AI for text, images, video, and music.
I can:
• Write/translate text, explain, write code
• Generate images and video
• Work with documents
• TTS and speech-to-text
Useful:
• Just type — I'll use the web if fresh data is needed
• /model — choose a model (GPT‑4o‑mini, Llama, Mistral)
• /new — new chat
• /web query — manual web search
• /lang - choose lanquage
• /weather [city] — weather now
• /setcity [city] — default city
• /unsubscribe — stop morning weather
• /help — commands
Coming soon: /img, /video, /tts, /stats`
};
const BTN = {
  ru: { share: "📍 Поделиться локацией", type: "✏️ Указать город", ask: "Чтобы получать прогноз погоды в 06:00, поделитесь локацией или нажмите «✏️ Указать город»" },
  ro: { share: "📍 Trimite locația",     type: "✏️ Setează orașul", ask: "Pentru a primi prognoză meteo la 06:00, trimite locația sau apasă «✏️ Setează orașul»" },
  en: { share: "📍 Share location",       type: "✏️ Set city",       ask: "For 06:00 forecast, share location or tap «✏️ Set city»" }
};

// ── Поиск (Tavily) и суммаризация ───────────────────────────────────
async function tavilySearch(query, maxResults = 5) {
  const key = process.env.TAVILY_API_KEY || "";
  if (!key) return { ok: false, error: "NO_TAVILY_KEY" };
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key, query,
      search_depth: "basic", include_answer: false, time_range: "d",
      max_results: Math.min(Math.max(maxResults, 1), 8)
    })
  });
  if (!resp.ok) return { ok: false, error: `HTTP_${resp.status}` };
  const data = await resp.json();
  return { ok: true, data };
}
async function summarizeWithSources(question, searchData, model) {
  const client = await getLLMClient();
  if (!client) throw new Error("NO_LLM");
  const sources = (searchData?.results || []).slice(0, 5);
  if (!sources.length) return "Ничего не нашёл по запросу. Попробуй переформулировать.";
  const list = sources.map((s, i) => `${i + 1}. ${s.title || s.url} — ${s.url}`).join("\n");
  const extracts = sources.map((s, i) => `[${i + 1}] ${String(s.content || "").slice(0, 800)}`).join("\n\n");
  const messages = [
    { role: "system", content: "Ты веб‑помощник. Используй только факты из 'Источников'. Делай маркированные пункты. Ссылки ставь в тексте по номерам [1], [2], а в конце — список источников." },
    { role: "user", content: `Вопрос: ${question}\n\nИсточники:\n${list}\n\nВыдержки:\n${extracts}` }
  ];
  const r = await client.chat.completions.create({ model, temperature: 0.2, max_tokens: 450, messages });
  return r.choices?.[0]?.message?.content || "Не удалось сформировать ответ.";
}
async function plainChat({ text, hist, model }) {
  const client = await getLLMClient(); if (!client) throw new Error("NO_LLM");
  const messages = [{ role: "system", content: systemPrompt() }, ...hist, { role: "user", content: text }];
  const r = await client.chat.completions.create({ model, temperature: 0.6, max_tokens: 400, messages });
  return r.choices?.[0]?.message?.content || "Нет ответа от модели.";
}
async function chatWithAutoSearch({ text, hist, model }) {
  const client = await getLLMClient(); if (!client) throw new Error("NO_LLM");
  const tools = [{
    type: "function",
    function: {
      name: "web_search",
      description: "Поиск в интернете для актуальных данных",
      parameters: { type: "object", properties: { query: { type: "string" }, max_results: { type: "integer", default: 5 } }, required: ["query"] }
    }
  }];
  const r1 = await client.chat.completions.create({
    model, temperature: 0.6, max_tokens: 300,
    messages: [{ role: "system", content: "Если для точного ответа нужны свежие факты (погода, курсы, новости и т.п.), вызови web_search. Иначе отвечай сам." }, ...hist, { role: "user", content: text }],
    tools, tool_choice: "auto"
  });
  const msg1 = r1.choices?.[0]?.message;
  const toolCalls = msg1?.tool_calls || [];
  if (toolCalls.length > 0) {
    const call = toolCalls.find((c) => c.function?.name === "web_search") || toolCalls[0];
    let args = {}; try { args = JSON.parse(call.function?.arguments || "{}"); } catch {}
    const q = (args.query || text).toString();
    const maxRes = Number(args.max_results || 5);
    const sr = await tavilySearch(q, maxRes);
    if (!sr.ok) return sr.error === "NO_TAVILY_KEY" ? "Добавь TAVILY_API_KEY в Vercel (Production) и Redeploy." : `Поиск не удался (${sr.error}).`;
    return await summarizeWithSources(q, sr.data, model);
  }
  const plain = msg1?.content?.trim(); if (plain) return plain;
  return "Не удалось получить ответ. Попробуй ещё раз.";
}

// ── Геокодинг и погода ──────────────────────────────────────────────
async function geocodeCity(name, lang) {
  const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=${lang || "en"}`;
  const r = await fetch(u); const j = await r.json(); const g = j?.results?.[0];
  if (!g) return null;
  return { name: `${g.name}${g.country ? ", " + g.country : ""}`, lat: g.latitude, lon: g.longitude };
}
async function reverseGeocode(lat, lon, lang) {
  try {
    const u = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=${lang || "en"}&count=1`;
    const r = await fetch(u); const j = await r.json(); const g = j?.results?.[0];
    return g ? `${g.name}${g.country ? ", " + g.country : ""}` : null;
  } catch { return null; }
}
async function weatherNow(lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,precipitation,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
  const r = await fetch(u);
  return await r.json();
}
function formatWeatherNow(w, lang, place) {
  const t = w?.current_weather?.temperature;
  const ws = w?.current_weather?.windspeed;
  const maxt = w?.daily?.temperature_2m_max?.[0];
  const mint = w?.daily?.temperature_2m_min?.[0];
  const pr = w?.daily?.precipitation_probability_max?.[0];
  const L = {
    ru: () => `Погода: ${place}\n• Сейчас: ${t}°C, ветер ${ws} м/с\n• Днём: ${maxt}°C, ночью: ${mint}°C\n• Осадки: ${pr}%`,
    ro: () => `Meteo: ${place}\n• Acum: ${t}°C, vânt ${ws} m/s\n• Zi: ${maxt}°C, noapte: ${mint}°C\n• Ploaie: ${pr}%`,
    en: () => `Weather: ${place}\n• Now: ${t}°C, wind ${ws} m/s\n• Day: ${maxt}°C, night: ${mint}°C\n• Precip.: ${pr}%`
  };
  const f = L[lang] || L.en;
  return f();
}

// ── Модели /model ───────────────────────────────────────────────────
const MODEL_OPTIONS = [
  { id: "gpt-4o-mini", label: "gpt-4o-mini (качественно/недорого)" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B (бюджет)" },
  { id: "mistralai/mistral-small", label: "Mistral Small (очень быстро/дешево)" }
];
const KNOWN_CMDS = new Set(["start","help","lang ru","lang ro","lang en","unsubscribe","setcity","weather","new","model","web"]);

// ── Бот ─────────────────────────────────────────────────────────────
let bot;
function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const b = new Bot(token);

  // Пред-мидлвар: режим ожидания города + неизвестные команды
  b.use(async (ctx, next) => {
    if (ctx.message?.text) {
      const text = ctx.message.text.trim();

      // Если ждём город — используем ближайший текст как название города
      if (await isAwaitingCity(ctx.from.id) && !text.startsWith("/")) {
        const lang = await userLang(ctx);
        const g = await geocodeCity(text, lang);
        await clearAwaitingCity(ctx.from.id);
        if (!g) { await ctx.reply(lang === "ro" ? "Nu am găsit orașul." : (lang === "en" ? "City not found." : "Город не найден.")); return; }
        await setCity(ctx.from.id, g);
        await ctx.reply((lang === "ro" ? "Setat: " : (lang === "en" ? "Set: " : "Установлен: ")) + `${g.name} (${g.lat.toFixed(2)}, ${g.lon.toFixed(2)})`);
        return; // не пускаем дальше в чат-LLM
      }

      // Неизвестная команда
      if (text.startsWith("/")) {
        const m = text.match(/^\/(\w+)/);
        const cmd = (m?.[1] || "").toLowerCase();
        if (cmd && !KNOWN_CMDS.has(cmd)) {
          const lang = await userLang(ctx);
          const msg = lang === "ro" ? "Comandă necunoscută. Vezi /help." : (lang === "en" ? "Unknown command. See /help." : "Неизвестная команда. Смотри /help.");
          await ctx.reply(msg);
          return;
        }
      }
    }
    await next();
  });

  b.command("start", async (ctx) => {
    const lang = await userLang(ctx);
    await subscribeWeather(ctx.from.id, ctx.chat.id);

    const kb = new Keyboard()
      .requestLocation(BTN[lang].share).row()
      .text(BTN[lang].type)
      .resized().oneTime();
    await ctx.reply(BTN[lang].ask, { reply_markup: kb });
    await ctx.reply(NAV[lang]);
  });

  b.command("help", async (ctx) => {
    const lang = await userLang(ctx);
    await ctx.reply(NAV[lang]);
  });

  b.command("lang", async (ctx) => {
    const v = ((ctx.message.text || "").trim().split(/\s+/)[1] || "").toLowerCase();
    if (!["ru","ro","en"].includes(v)) { await ctx.reply("Use: /lang ru | ro | en"); return; }
    await setUserLang(ctx.from.id, v);
    await setLangManual(ctx.from.id, true); // фиксируем ручной выбор
    await ctx.reply("OK");
    await ctx.reply(NAV[v]);
  });

  b.command("unsubscribe", async (ctx) => {
    await unsubscribeWeather(ctx.from.id);
    await ctx.reply("Рассылка погоды отключена.");
  });

  b.command("setcity", async (ctx) => {
    const lang = await userLang(ctx);
    const arg = (ctx.message.text || "").replace(/^\/setcity(@\S+)?\s*/i, "").trim();
    if (!arg) {
      // Включаем «ожидание города» и просим просто написать название
      await setAwaitingCity(ctx.from.id, 600);
      const msg = lang === "ro" ? "Scrie numele orașului în următorul mesaj." :
                  (lang === "en" ? "Type the city name in the next message." :
                                   "Напиши название города следующим сообщением.");
      await ctx.reply(msg);
      return;
    }
    const g = await geocodeCity(arg, lang);
    if (!g) { await ctx.reply(lang === "ro" ? "Nu am găsit orașul." : (lang === "en" ? "City not found." : "Город не найден.")); return; }
    await setCity(ctx.from.id, g);
    await ctx.reply((lang === "ro" ? "Setat: " : (lang === "en" ? "Set: " : "Установлен: ")) + `${g.name} (${g.lat.toFixed(2)}, ${g.lon.toFixed(2)})`);
  });

  b.command("weather", async (ctx) => {
    const lang = await userLang(ctx);
    let g = await getCity(ctx.from.id);
    const arg = (ctx.message.text || "").replace(/^\/weather(@\S+)?\s*/i, "").trim();
    if (arg) g = (await geocodeCity(arg, lang)) || g;
    if (!g) { await ctx.reply(lang === "ro" ? "Trimite locația sau folosește /setcity Oraș" : (lang === "en" ? "Share location or use /setcity City" : "Отправь локацию или /setcity Город")); return; }
    const w = await weatherNow(g.lat, g.lon);
    await ctx.reply(formatWeatherNow(w, lang, g.name));
  });

  b.on("message:location", async (ctx) => {
    const lang = await userLang(ctx);
    const { latitude, longitude } = ctx.message.location;
    const name = (await reverseGeocode(latitude, longitude, lang)) || "";
    await clearAwaitingCity(ctx.from.id);
    await setCity(ctx.from.id, { name: name || "—", lat: latitude, lon: longitude });
    await ctx.reply((lang === "ro" ? "Salvat locul: " : (lang === "en" ? "Saved: " : "Сохранено: ")) + (name || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`));
  });

  b.command("new", async (ctx) => {
    await clearHistory(ctx.chat.id);
    await ctx.reply("Окей, новый диалог.");
  });

  b.command("model", async (ctx) => {
    const kb = new InlineKeyboard();
    for (const m of MODEL_OPTIONS) kb.text(m.label, `m:${m.id}`).row();
    await ctx.reply("Выбери модель:", { reply_markup: kb });
  });
  b.callbackQuery(/m:.+/, async (ctx) => {
    const data = ctx.callbackQuery.data || "";
    const chosen = data.split(":")[1];
    const found = MODEL_OPTIONS.find((m) => m.id === chosen);
    if (!found) { await ctx.answerCallbackQuery({ text: "Неизвестная модель", show_alert: true }); return; }
    await setUserModel(ctx.from.id, found.id);
    await ctx.answerCallbackQuery({ text: `Модель: ${found.label}` });
    try { await ctx.editMessageText(`Текущая модель: ${found.label}`); } catch {}
  });

  // Ручной веб‑поиск
  b.command("web", async (ctx) => {
    const text = ctx.message.text || "";
    const q = text.replace(/^\/web(@\S+)?\s*/i, "").trim();
    if (!q) { await ctx.reply("Напиши так: /web твой вопрос"); return; }
    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const userModel = await getUserModel(ctx.from.id);
    const model = userModel || defaultModel();
    const sr = await tavilySearch(q);
    if (!sr.ok) { await ctx.reply(sr.error === "NO_TAVILY_KEY" ? "Добавь TAVILY_API_KEY в Vercel" : "Поиск не удался. Попробуй позже."); return; }
    const ans = await summarizeWithSources(q, sr.data, model);
    await chunkAndReply(ctx, ans);
    await pushMessage(ctx.chat.id, { role: "user", content: `/web ${q}` });
    await pushMessage(ctx.chat.id, { role: "assistant", content: ans });
  });

  // Главный чат: tools для gpt‑4o‑mini, принудительный веб‑поиск для Llama/Mistral
  b.on("message:text", async (ctx) => {
    const text = ctx.message.text?.trim() || "";
    if (!text) return;

    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const hist = await getHistory(ctx.chat.id);
    const userModel = await getUserModel(ctx.from.id);
    const model = userModel || defaultModel();

    try {
      let answer;
      if (FORCE_WEB_FOR_OPEN && isOpenModelNeedingWeb(model)) {
        const sr = await tavilySearch(text);
        answer = sr.ok ? await summarizeWithSources(text, sr.data, model)
                       : await plainChat({ text, hist, model });
      } else if (isToolCapableModel(model)) {
        answer = await chatWithAutoSearch({ text, hist, model });
      } else {
        answer = await plainChat({ text, hist, model });
      }

      await pushMessage(ctx.chat.id, { role: "user", content: text });
      await pushMessage(ctx.chat.id, { role: "assistant", content: answer });
      await chunkAndReply(ctx, answer);
    } catch {
      await ctx.reply("Ошибка при обработке запроса. Попробуй ещё раз.");
    }
  });

  bot = b;
  return bot;
}

// ── HTTP‑обработчик ─────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  const b = getBot(); if (!b) return res.status(200).send("NO_TOKEN");
  const handle = webhookCallback(b, "http");
  try { await handle(req, res); } catch { res.status(200).end(); }
    }
