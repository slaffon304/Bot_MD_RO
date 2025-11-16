import { Bot, webhookCallback, InlineKeyboard, Keyboard } from "grammy";

// ── Провайдер и дефолтная модель ────────────────────────────────────
const provider = (process.env.PROVIDER || "none").toLowerCase();
const envModel = process.env.MODEL || "";
const FORCE_WEB_FOR_OPEN = (process.env.FORCE_WEB_FOR_OPEN ?? "1") !== "0";

function defaultModel() {
  return envModel || "gpt-4o-mini"; // умеет tools
}
function isToolCapableModel(model) {
  return /gpt-4o/i.test(model);
}
function isOpenModelNeedingWeb(model) {
  return /(meta-llama|llama|mistral)/i.test(model);
}
function systemPrompt() {
  return "Ты краткий и полезный ассистент. Отвечай на языке пользователя.";
}
function chunkAndReply(ctx, text) {
  const max = 3800;
  const tasks = [];
  for (let i = 0; i < text.length; i += max) {
    tasks.push(ctx.reply(text.slice(i, i + max), { reply_to_message_id: ctx.message.message_id }));
  }
  return tasks.reduce((p, t) => p.then(() => t), Promise.resolve());
}

// ── Lazy imports ────────────────────────────────────────────────────
async function getLLMClient() {
  if (provider !== "openrouter") return null;
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) return null;
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
}
async function loadStore() {
  return await import("../lib/store.js");
}

// ── I18N ────────────────────────────────────────────────────────────
const I18N = {
  ru: {
    start:
      "Привет! 👋 Я даю доступ к сильным ИИ для текста, картинок, видео и музыки.\n\n" +
      "Полезное:\n" +
      "• Просто напишите — при необходимости схожу в интернет\n" +
      "• /model — выбрать модель (GPT‑4o‑mini, Llama, Mistral)\n" +
      "• /new — новый диалог\n" +
      "• /web вопрос — ручной веб‑поиск\n" +
      "• /weather город — погода сейчас\n" +
      "• /subscribe — утренний прогноз в 06:00, /unsubscribe — выключить\n" +
      "• /setcity город — город по умолчанию\n" +
      "• /help — команды и примеры\n\n" +
      "Скоро: /imagine (картинки), /video (видео), /music (музыка), /tts (озвучка), /stats (статистика).",
    ask_city: "Чтобы присылать прогноз по утрам, укажи город или отправь геолокацию.",
    buttons: { send_loc: "📍 Отправить геолокацию", skip: "Пропустить" },
    saved_city: (name) => `Город сохранён: ${name}`,
    saved_lang: (lang) => `Язык интерфейса: ${lang}`,
    subscribed: "Подписка на утренний прогноз включена.",
    unsubscribed: "Подписка отключена.",
    no_tavily: "Для веб‑поиска добавь TAVILY_API_KEY в Vercel (Production) и Redeploy.",
    no_llm: "ИИ пока не подключён. Проверь PROVIDER=openrouter и OPENROUTER_API_KEY.",
    setcity_usage: "Используй: /setcity Город\nНапример: /setcity Chișinău",
    weather_now: (name, t, feels, wind, codeText) =>
      `Погода в ${name} сейчас: ${t}°C (ощущается как ${feels}°C), ветер ${wind} м/с, ${codeText}.`,
    soon: "Функция скоро будет доступна."
  },
  ro: {
    start:
      "Salut! 👋 Îți ofer acces la AI puternic pentru text, imagini, video și muzică.\n\n" +
      "Utile:\n" +
      "• Scrie un mesaj — dacă e nevoie, caut pe internet\n" +
      "• /model — alege modelul (GPT‑4o‑mini, Llama, Mistral)\n" +
      "• /new — dialog nou\n" +
      "• /web întrebare — căutare web manuală\n" +
      "• /weather oraș — meteo acum\n" +
      "• /subscribe — prognoză la 06:00, /unsubscribe — oprește\n" +
      "• /setcity oraș — oraș implicit\n" +
      "• /help — comenzi și exemple\n\n" +
      "În curând: /imagine (imagini), /video, /musică, /tts, /stats.",
    ask_city: "Pentru prognoza de dimineață, trimite locația sau setează orașul.",
    buttons: { send_loc: "📍 Trimite locația", skip: "Omite" },
    saved_city: (name) => `Oraș salvat: ${name}`,
    saved_lang: (lang) => `Limba interfeței: ${lang}`,
    subscribed: "Ai activat abonarea la prognoza de dimineață.",
    unsubscribed: "Ai dezactivat abonarea.",
    no_tavily: "Adaugă TAVILY_API_KEY în Vercel (Production) și redeploy.",
    no_llm: "AI nu este conectat. Verifică PROVIDER=openrouter și OPENROUTER_API_KEY.",
    setcity_usage: "Folosește: /setcity Oraș\nEx.: /setcity Chișinău",
    weather_now: (name, t, feels, wind, codeText) =>
      `Vremea în ${name} acum: ${t}°C (se simte ca ${feels}°C), vânt ${wind} m/s, ${codeText}.`,
    soon: "Funcția va fi disponibilă în curând."
  },
  en: {
    start:
      "Hi! 👋 I give you access to strong AI for text, images, video and music.\n\n" +
      "Useful:\n" +
      "• Just type — I’ll browse the web when needed\n" +
      "• /model — choose model (GPT‑4o‑mini, Llama, Mistral)\n" +
      "• /new — new dialog\n" +
      "• /web query — manual web search\n" +
      "• /weather city — weather now\n" +
      "• /subscribe — morning forecast at 06:00, /unsubscribe — stop\n" +
      "• /setcity city — default city\n" +
      "• /help — commands and examples\n\n" +
      "Coming soon: /imagine, /video, /music, /tts, /stats.",
    ask_city: "To send morning forecast, share location or set a city.",
    buttons: { send_loc: "📍 Share location", skip: "Skip" },
    saved_city: (name) => `City saved: ${name}`,
    saved_lang: (lang) => `Interface language: ${lang}`,
    subscribed: "Morning forecast subscription is ON.",
    unsubscribed: "Subscription is OFF.",
    no_tavily: "Add TAVILY_API_KEY in Vercel (Production) and redeploy.",
    no_llm: "AI is not connected. Check PROVIDER=openrouter and OPENROUTER_API_KEY.",
    setcity_usage: "Use: /setcity City\nExample: /setcity Chisinau",
    weather_now: (name, t, feels, wind, codeText) =>
      `Weather in ${name} now: ${t}°C (feels like ${feels}°C), wind ${wind} m/s, ${codeText}.`,
    soon: "Feature coming soon."
  }
};
function langOf(ctx) {
  const lc = (ctx.from?.language_code || "en").slice(0,2).toLowerCase();
  if (lc === "ru") return "ru";
  if (lc === "ro") return "ro";
  return "en";
}

// ── Веб‑поиск (Tavily) + суммаризация ───────────────────────────────
async function tavilySearch(query, maxResults = 5) {
  const key = process.env.TAVILY_API_KEY || "";
  if (!key) return { ok: false, error: "NO_TAVILY_KEY" };
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key, query,
      search_depth: "basic", include_answer: false, time_range: "d",
      max_results: Math.min(Math.max(maxResults,1),8)
    })
  });
  if (!resp.ok) return { ok:false, error:`HTTP_${resp.status}` };
  const data = await resp.json();
  return { ok:true, data };
}
async function summarizeWithSources(question, searchData, model) {
  const client = await getLLMClient();
  if (!client) throw new Error("NO_LLM");
  const sources = (searchData?.results || []).slice(0,5);
  if (!sources.length) return "Нет подходящих результатов. Попробуй иначе сформулировать запрос.";

  const list = sources.map((s,i)=>`${i+1}. ${s.title || s.url} — ${s.url}`).join("\n");
  const extracts = sources.map((s,i)=>`[${i+1}] ${String(s.content||"").slice(0,800)}`).join("\n\n");

  const messages = [
    {
      role:"system",
      content:"Ты веб‑помощник. Используй только факты из 'Источников'. Делай маркированные пункты. " +
              "В тексте ставь ссылки по номерам [1], [2]. В конце — список источников."
    },
    { role:"user", content:`Вопрос: ${question}\n\nИсточники:\n${list}\n\nВыдержки:\n${extracts}` }
  ];
  const r = await client.chat.completions.create({ model, temperature:0.2, max_tokens:450, messages });
  return r.choices?.[0]?.message?.content || "Не удалось сформировать ответ.";
}

// ── Чат режимы ──────────────────────────────────────────────────────
async function plainChat({ text, hist, model }) {
  const client = await getLLMClient(); if (!client) throw new Error("NO_LLM");
  const messages = [{ role:"system", content:systemPrompt() }, ...hist, { role:"user", content:text }];
  const r = await client.chat.completions.create({ model, temperature:0.6, max_tokens:400, messages });
  return r.choices?.[0]?.message?.content || "Нет ответа от модели.";
}
async function chatWithAutoSearch({ text, hist, model }) {
  const client = await getLLMClient(); if (!client) throw new Error("NO_LLM");
  const messages = [
    { role:"system", content:"Ты помощник. Если нужны свежие факты (погода, курсы, новости и т.п.), вызови инструмент web_search. Иначе отвечай сам." },
    ...hist, { role:"user", content:text }
  ];
  const tools = [{
    type:"function",
    function:{
      name:"web_search",
      description:"Поиск в интернете для актуальных данных. Формируй запрос на языке пользователя.",
      parameters:{ type:"object", properties:{ query:{type:"string"}, max_results:{type:"integer", default:5 } }, required:["query"] }
    }
  }];
  const r1 = await client.chat.completions.create({ model, temperature:0.6, max_tokens:300, messages, tools, tool_choice:"auto" });
  const msg1 = r1.choices?.[0]?.message;
  const toolCalls = msg1?.tool_calls || [];
  if (toolCalls.length > 0) {
    const call = toolCalls.find(c=>c.function?.name==="web_search") || toolCalls[0];
    let args={}; try{ args = JSON.parse(call.function?.arguments||"{}"); }catch{}
    const q = (args.query || text).toString();
    const maxRes = Number(args.max_results || 5);
    const sr = await tavilySearch(q, maxRes);
    if (!sr.ok) return sr.error==="NO_TAVILY_KEY" ? I18N.ru.no_tavily : `Поиск не удался (${sr.error}).`;
    return await summarizeWithSources(q, sr.data, model);
  }
  const plain = msg1?.content?.trim(); if (plain) return plain;
  return "Не удалось получить ответ. Попробуй ещё раз.";
}

// ── Геокодинг и погода ──────────────────────────────────────────────
async function geocodeCity(name, lang="en") {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=${encodeURIComponent(lang)}&format=json`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const p = j?.results?.[0];
  if (!p) return null;
  return { name: p.name, lat: p.latitude, lon: p.longitude, country: p.country };
}
function weatherCodeText(code, lang="ru") {
  const map = {
    0:{ru:"ясно", ro:"senin", en:"clear"},
    1:{ru:"в основном ясно", ro:"mai mult senin", en:"mainly clear"},
    2:{ru:"переменная облачность", ro:"parțial noros", en:"partly cloudy"},
    3:{ru:"пасмурно", ro:"înnorat", en:"overcast"},
    45:{ru:"туман", ro:"ceață", en:"fog"}, 48:{ru:"изморозь", ro:"ceață înghețată", en:"depositing rime fog"},
    51:{ru:"морось слабая", ro:"burniță slabă", en:"light drizzle"},
    53:{ru:"морось", ro:"burniță", en:"drizzle"},
    55:{ru:"морось сильная", ro:"burniță puternică", en:"dense drizzle"},
    61:{ru:"дождь слабый", ro:"ploaie slabă", en:"light rain"},
    63:{ru:"дождь", ro:"ploaie", en:"rain"},
    65:{ru:"ливень", ro:"ploaie puternică", en:"heavy rain"},
    71:{ru:"снег слабый", ro:"ninsoare slabă", en:"light snow"},
    73:{ru:"снег", ro:"ninsoare", en:"snow"},
    75:{ru:"снегопад", ro:"ninsoare puternică", en:"heavy snow"},
    80:{ru:"ливни местами", ro:"averse locale", en:"rain showers"},
    95:{ru:"гроза", ro:"furtună", en:"thunderstorm"}
  };
  return (map[code]?.[lang]) || (map[code]?.en) || "—";
}
async function fetchWeatherByCoords(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const cw = j.current_weather;
  if (!cw) return null;
  return { t: cw.temperature, wind: cw.windspeed, code: cw.weathercode, tz: j.timezone };
}

// ── Модели для /model ───────────────────────────────────────────────
const MODEL_OPTIONS = [
  { id: "gpt-4o-mini", label: "gpt-4o-mini (качественно/недорого)" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B (бюджет)" },
  { id: "mistralai/mistral-small", label: "Mistral Small (очень быстро/дешево)" }
];

// ── Бот ─────────────────────────────────────────────────────────────
let bot;
function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const b = new Bot(token);

  // /start: авто-язык, авто-подписка, запрос города/геолокации + приветствие
  b.command("start", async (ctx) => {
    const { setUserLang, subscribeWeather, getUserCity } = await loadStore();
    const lc = langOf(ctx);
    await setUserLang(ctx.from.id, lc);
    await subscribeWeather(ctx.from.id);

    const t = I18N[lc] || I18N.en;
    const kb = new Keyboard()
      .requestLocation(t.buttons.send_loc)
      .row()
      .text(t.buttons.skip)
      .resized();

    const city = await getUserCity(ctx.from.id);
    if (!city) {
      await ctx.reply(t.ask_city, { reply_markup: kb });
    }
    await ctx.reply(t.start, { reply_markup: { remove_keyboard: true } });
  });

  b.command("help", async (ctx) => {
    const lc = (await (await loadStore()).getUserLang(ctx.from.id)) || langOf(ctx);
    await ctx.reply((I18N[lc]||I18N.en).start);
  });

  // Язык вручную: /lang ru|ro|en
  b.command("lang", async (ctx) => {
    const { setUserLang } = await loadStore();
    const arg = (ctx.message.text||"").split(/\s+/)[1]?.toLowerCase();
    const lc = ["ru","ro","en"].includes(arg) ? arg : langOf(ctx);
    await setUserLang(ctx.from.id, lc);
    await ctx.reply((I18N[lc]||I18N.en).saved_lang(lc));
  });

  // Подписки
  b.command("subscribe", async (ctx) => {
    const { subscribeWeather, getUserLang } = await loadStore();
    await subscribeWeather(ctx.from.id);
    const lc = (await getUserLang(ctx.from.id)) || langOf(ctx);
    await ctx.reply((I18N[lc]||I18N.en).subscribed);
  });
  b.command("unsubscribe", async (ctx) => {
    const { unsubscribeWeather, getUserLang } = await loadStore();
    await unsubscribeWeather(ctx.from.id);
    const lc = (await getUserLang(ctx.from.id)) || langOf(ctx);
    await ctx.reply((I18N[lc]||I18N.en).unsubscribed);
  });

  // Город: /setcity <название>
  b.command("setcity", async (ctx) => {
    const { setUserCity, getUserLang } = await loadStore();
    const lc = (await getUserLang(ctx.from.id)) || langOf(ctx);
    const t = I18N[lc]||I18N.en;
    const text = ctx.message.text||"";
    const name = text.replace(/^\/setcity(@\S+)?\s*/i, "").trim();
    if (!name) {
      await ctx.reply(t.setcity_usage); return;
    }
    const geo = await geocodeCity(name, lc);
    if (!geo) { await ctx.reply("City not found. / Orașul nu a fost găsit. / Город не найден."); return; }
    await setUserCity(ctx.from.id, { name: geo.name, lat: geo.lat, lon: geo.lon });
    await ctx.reply(t.saved_city(geo.name));
  });

  // Приём геолокации
  b.on("message:location", async (ctx) => {
    const { setUserCity, getUserLang } = await loadStore();
    const lc = (await getUserLang(ctx.from.id)) || langOf(ctx);
    const t = I18N[lc]||I18N.en;
    const loc = ctx.message.location;
    if (!loc) return;
    // Попробуем обратный геокод: просто сохраним coords, имя дадим "Моё местоположение"
    await setUserCity(ctx.from.id, { name: lc==="ro"?"Locația mea":"Моё местоположение", lat: loc.latitude, lon: loc.longitude });
    await ctx.reply(t.saved_city(lc==="ro"?"Locația mea":"Моё местоположение"), { reply_markup: { remove_keyboard: true } });
  });

  // Погода сейчас: /weather [город]
  b.command("weather", async (ctx) => {
    const { getUserLang, getUserCity } = await loadStore();
    const lc = (await getUserLang(ctx.from.id)) || langOf(ctx);
    const t = I18N[lc]||I18N.en;
    const text = ctx.message.text||"";
    const arg = text.replace(/^\/weather(@\S+)?\s*/i, "").trim();

    let city = null;
    if (arg) {
      const geo = await geocodeCity(arg, lc);
      if (geo) city = { name: geo.name, lat: geo.lat, lon: geo.lon };
    } else {
      city = await getUserCity(ctx.from.id);
    }
    if (!city) { await ctx.reply(t.setcity_usage); return; }

    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const w = await fetchWeatherByCoords(city.lat, city.lon);
    if (!w) { await ctx.reply("Не удалось получить погоду."); return; }

    const codeText = weatherCodeText(w.code, lc);
    await ctx.reply(t.weather_now(city.name, w.t, w.t, w.wind, codeText));
  });

  // /new — очистить контекст
  b.command("new", async (ctx) => {
    const { clearHistory } = await loadStore();
    await clearHistory(ctx.chat.id);
    await ctx.reply("Окей, начинаем новый диалог. Что дальше?");
  });

  // Выбор модели
  b.command("model", async (ctx) => {
    const kb = new InlineKeyboard();
    for (const m of MODEL_OPTIONS) kb.text(m.label, `m:${m.id}`).row();
    await ctx.reply("Выбери модель:", { reply_markup: kb });
  });
  b.callbackQuery(/m:.+/, async (ctx) => {
    const { setUserModel } = await loadStore();
    const data = ctx.callbackQuery.data || "";
    const chosen = data.split(":")[1];
    const found = MODEL_OPTIONS.find((m)=>m.id===chosen);
    if (!found) { await ctx.answerCallbackQuery({ text:"Неизвестная модель", show_alert:true }); return; }
    await setUserModel(ctx.from.id, found.id);
    await ctx.answerCallbackQuery({ text:`Модель: ${found.label}` });
    try { await ctx.editMessageText(`Текущая модель: ${found.label}`); } catch {}
  });

  // Ручной веб‑поиск
  b.command("web", async (ctx) => {
    const { pushMessage, getUserModel } = await loadStore();
    const q = (ctx.message.text||"").replace(/^\/web(@\S+)?\s*/i, "").trim();
    if (!q) { await ctx.reply("Напиши так: /web твой вопрос"); return; }
    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const client = await getLLMClient(); if (!client) { await ctx.reply(I18N.ru.no_llm); return; }
    const userModel = await getUserModel(ctx.from.id);
    const model = userModel || defaultModel();
    const sr = await tavilySearch(q);
    if (!sr.ok) { await ctx.reply(sr.error==="NO_TAVILY_KEY" ? I18N.ru.no_tavily : `Поиск не удался (${sr.error}).`); return; }
    const answer = await summarizeWithSources(q, sr.data, model);
    await chunkAndReply(ctx, answer);
    await pushMessage(ctx.chat.id, { role:"user", content:`/web ${q}` });
    await pushMessage(ctx.chat.id, { role:"assistant", content:answer });
  });

  // Заглушки будущих фич (чтобы команды уже были)
  for (const cmd of ["imagine","video","music","tts","stats"]) {
    b.command(cmd, async (ctx) => {
      const { getUserLang } = await loadStore();
      const lc = (await getUserLang(ctx.from.id)) || langOf(ctx);
      await ctx.reply((I18N[lc]||I18N.en).soon);
    });
  }

  // Обычный чат: tools для gpt‑4o‑mini, принудительный веб‑поиск для Llama/Mistral
  b.on("message:text", async (ctx) => {
    const { getHistory, pushMessage, getUserModel } = await loadStore();
    const text = ctx.message.text?.trim() || "";
    if (!text) return;

    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const client = await getLLMClient();
    if (!client) { await ctx.reply(I18N.ru.no_llm); return; }

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
      await pushMessage(ctx.chat.id, { role:"user", content:text });
      await pushMessage(ctx.chat.id, { role:"assistant", content:answer });
      await chunkAndReply(ctx, answer);
    } catch (e) {
      console.error("LLM/chat error:", e);
      await ctx.reply("Ошибка при обработке запроса. Попробуй ещё раз.");
    }
  });

  bot = b;
  return bot;
}

// ── HTTP handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  const b = getBot();
  if (!b) return res.status(200).send("NO_TOKEN");
  const handle = webhookCallback(b, "http");
  try { await handle(req, res); } catch (e) { console.error("Webhook error:", e); res.status(200).end(); }
      }
