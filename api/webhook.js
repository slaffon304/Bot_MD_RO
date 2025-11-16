import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import {
  getHistory, pushMessage, clearHistory,
  getUserModel, setUserModel,
  getUserLang, setUserLang, setLangManual, isLangManual,
} from "../lib/store.js";

// ── Конфиг ──────────────────────────────────────────────────────────
const provider = (process.env.PROVIDER || "none").toLowerCase();
const envModel = process.env.MODEL || "";
const FORCE_WEB_FOR_OPEN = (process.env.FORCE_WEB_FOR_OPEN ?? "1") !== "0";
const SOURCE_LIMIT = Math.max(1, Number(process.env.SOURCE_LIMIT || 2));   // 2 по умолчанию
const EXTRACT_CHARS = Math.max(60, Number(process.env.EXTRACT_CHARS || 220)); // 220 по умолчанию

function defaultModel() { return envModel || "gpt-4o-mini"; }
function isToolCapableModel(m){ return /gpt-4o/i.test(m); }
function isOpenModelNeedingWeb(m){ return /(meta-llama|llama|mistral)/i.test(m); }

function chunkAndReply(ctx, text) {
  const max = 3800, parts = [];
  for (let i = 0; i < text.length; i += max) parts.push(text.slice(i, i + max));
  return parts.reduce((p, t) => p.then(() => ctx.reply(t, { reply_to_message_id: ctx.message.message_id })), Promise.resolve());
}

// ── LLM клиент (OpenRouter) ─────────────────────────────────────────
async function getLLMClient() {
  if (provider !== "openrouter") return null;
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) return null;
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
}

// ── Язык ────────────────────────────────────────────────────────────
function detectLangFromTG(code) {
  const s = (code || "").toLowerCase().split("-")[0];
  return ["ru","ro","en"].includes(s) ? s : "en";
}
function detectLangFromText(text) {
  if (!text) return null;
  const hasCyr = /[\u0400-\u04FF]/.test(text);
  if (hasCyr) return "ru";
  const hasRoDiacritics = /[ăâîșțĂÂÎȘȚ]/.test(text);
  const t = text.toLowerCase();
  const roHints = ["este","sunt","mâine","maine","mîine","azi","astăzi","astazi","vreme","vremea","oraș","salut","bună","prognoză","meteo","moldova","românia","chișinău","bucurești","bălți"];
  const enHints = ["is","are","tomorrow","tommorow","tomorow","tmrw","today","weather","forecast","city","hello","hi"];
  if (hasRoDiacritics || roHints.some(w => t.includes(w))) return "ro";
  if (enHints.some(w => t.includes(w))) return "en";
  return null;
}
async function resolveLang(ctx, text) {
  const userId = ctx.from.id;
  const saved = await getUserLang(userId);
  const manual = await isLangManual(userId);
  const tg = detectLangFromTG(ctx.from?.language_code);
  const fromText = detectLangFromText(text);
  if (manual) return saved || tg || "en";
  if (fromText && fromText !== saved) { await setUserLang(userId, fromText); return fromText; }
  if (saved) return saved;
  await setUserLang(userId, tg);
  return tg;
}

function sysPrompt(lang){
  if (lang === "ro") return "Ești un asistent concis și util. Răspunde în română.";
  if (lang === "en") return "You are a concise and helpful assistant. Answer in English.";
  return "Ты краткий и полезный ассистент. Отвечай по-русски.";
}

const NAV = {
  ru: `Привет! 👋 Доступ к ИИ для текста, картинок, видео и музыки.
Команды:
• /model — выбрать модель (GPT‑4o‑mini, Llama, Mistral)
• /new — новый диалог
• /web запрос — ручной веб‑поиск
• /lang ru|ro|en — язык интерфейса
• /help — команды
Скоро: /img, /video, /tts, /stats`,
  ro: `Salut! 👋 Acces la AI pentru text, imagini, video și muzică.
Comenzi:
• /model — alege modelul (GPT‑4o‑mini, Llama, Mistral)
• /new — dialog nou
• /web întrebare — căutare web manuală
• /lang ru|ro|en — limba interfeței
• /help — comenzi
În curând: /img, /video, /tts, /stats`,
  en: `Hi! 👋 Access AI for text, images, video, and music.
Commands:
• /model — choose a model (GPT‑4o‑mini, Llama, Mistral)
• /new — new chat
• /web query — manual web search
• /lang ru|ro|en — interface language
• /help — commands
Coming soon: /img, /video, /tts, /stats`
};
const langKB = new InlineKeyboard().text("RU","lang:ru").text("RO","lang:ro").text("EN","lang:en");

// ── Web search (Tavily) ─────────────────────────────────────────────
async function tavilySearch(query, maxResults) {
  const key = process.env.TAVILY_API_KEY || "";
  if (!key) return { ok:false, error:"NO_TAVILY_KEY" };
  const wanted = Math.min(Math.max(maxResults || SOURCE_LIMIT, 1), SOURCE_LIMIT + 1); // чуть больше лимита на входе
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // неделя — чтобы захватывать tomorrow/next day и свежие новости
    body: JSON.stringify({ api_key:key, query, search_depth:"basic", include_answer:false, time_range:"w", max_results:wanted })
  });
  if (!resp.ok) return { ok:false, error:`HTTP_${resp.status}` };
  const data = await resp.json();
  return { ok:true, data };
}

// ── Нормализация опечаток (mîne→mâine/tomorow→tomorrow) ────────────
function rmDiacriticsRo(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ăâ]/g, "a")
    .replace(/[î]/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t");
}
function levenshtein(a, b) {
  a = a || ""; b = b || "";
  const m = a.length, n = b.length;
  const dp = new Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}
function fuzzyHasToken(token, dict) {
  token = rmDiacriticsRo(token.toLowerCase());
  return dict.some(w => levenshtein(token, rmDiacriticsRo(w)) <= 1);
}
function normalizeTimeAndQuery(text, lang) {
  const tokens = (text || "")
    .toLowerCase()
    .split(/[^a-zăâîșțşţa-яё0-9]+/i)
    .filter(Boolean);

  const roTomorrow = ["mâine","maine","mîine"], roToday = ["azi","astăzi","astazi"];
  const enTomorrow = ["tomorrow","tmrw","tmr","tommorow","tomorow","tommorrow"], enToday = ["today","2day","td"];
  const ruTomorrow = ["завтра"], ruToday = ["сегодня","сейчас"];

  let timeframe = null;
  for (const t of tokens) {
    if (fuzzyHasToken(t, roTomorrow) || fuzzyHasToken(t, enTomorrow) || fuzzyHasToken(t, ruTomorrow)) { timeframe = "tomorrow"; break; }
    if (fuzzyHasToken(t, roToday)    || fuzzyHasToken(t, enToday)    || fuzzyHasToken(t, ruToday))    { timeframe = timeframe || "today"; }
  }

  let q = text || "";
  if (timeframe === "tomorrow") {
    if (lang === "ro") q += " mâine maine";
    else if (lang === "ru") q += " завтра";
    else q += " tomorrow";
  } else if (timeframe === "today") {
    if (lang === "ro") q += " azi";
    else if (lang === "ru") q += " сегодня";
    else q += " today";
  }
  return { timeframe, corrected: q.trim() };
}

// ── Суммаризация (с лимитом источников и короткими выдержками) ─────
function summarizeSystem(lang){
  const common = `Citează cel mult ${SOURCE_LIMIT} surse. Respectă timeframe (azi/today vs mâine/tomorrow). Folosește doar fapte din Surse. Liste + referințe [1], [2]; la final — lista surselor.`;
  if (lang==="ro") return "Ești un asistent web. Răspunde pe scurt în română. " + common;
  if (lang==="en") return `You are a web assistant. Answer briefly in English. Cite at most ${SOURCE_LIMIT} sources. Respect the timeframe. Use only facts from Sources. Bullets + refs [1], [2]; add sources list at the end.`;
  return `Ты веб‑ассистент. Отвечай кратко по‑русски. Укажи не более ${SOURCE_LIMIT} источников. Соблюдай «сегодня/завтра». Только факты из Источников. Маркеры + ссылки [1], [2]; в конце — список источников.`;
}
function dedupeAndPick(results) {
  const picked = [];
  const seen = new Set();
  for (const r of results || []) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./,"");
      if (seen.has(host)) continue;
      seen.add(host);
      picked.push(r);
      if (picked.length >= SOURCE_LIMIT) break;
    } catch {
      // если URL кривой — пропускаем
    }
  }
  return picked;
}
function shortText(s) {
  const clean = String(s || "").replace(/\s+/g, " ").trim();
  return clean.slice(0, EXTRACT_CHARS);
}
async function summarizeWithSources({ question, searchData, model, lang }) {
  const client = await getLLMClient(); if (!client) throw new Error("NO_LLM");
  const selected = dedupeAndPick(searchData?.results || []);
  if (!selected.length) return lang==="ro" ? "Nu am găsit rezultate." : lang==="en" ? "No results found." : "Ничего не найдено.";

  const list = selected.map((s,i)=>`${i+1}. ${s.title||s.url} — ${s.url}`).join("\n");
  const extracts = selected.map((s,i)=>`[${i+1}] ${shortText(s.content)}`).join("\n\n");

  const r = await client.chat.completions.create({
    model, temperature:0.2, max_tokens:450,
    messages:[
      { role:"system", content: summarizeSystem(lang) },
      { role:"user", content:`Question: ${question}\n\nSources:\n${list}\n\nExtracts:\n${extracts}` }
    ]
  });
  return r.choices?.[0]?.message?.content || (lang==="ro"?"Nu am putut genera răspuns.":"Couldn't generate an answer.");
}

// ── Chat modes ──────────────────────────────────────────────────────
async function plainChat({ text, hist, model, lang }) {
  const client = await getLLMClient(); if (!client) throw new Error("NO_LLM");
  const r = await client.chat.completions.create({
    model, temperature:0.6, max_tokens:400,
    messages:[ { role:"system", content: sysPrompt(lang) }, ...hist, { role:"user", content:text } ]
  });
  return r.choices?.[0]?.message?.content || (lang==="ro"?"Niciun răspuns.":"No answer.");
}
async function chatWithAutoSearch({ text, hist, model, lang }) {
  const client = await getLLMClient(); if (!client) throw new Error("NO_LLM");
  const tools = [{
    type:"function",
    function:{ name:"web_search", description:"Search the web for fresh data",
      parameters:{ type:"object", properties:{ query:{type:"string"}, max_results:{type:"integer",default:SOURCE_LIMIT} }, required:["query"] } }
  }];
  const r1 = await client.chat.completions.create({
    model, temperature:0.6, max_tokens:300,
    messages:[ { role:"system", content: sysPrompt(lang) + " If fresh facts are needed (weather, rates, news etc.), call web_search." }, ...hist, { role:"user", content:text } ],
    tools, tool_choice:"auto"
  });
  const msg1 = r1.choices?.[0]?.message;
  const toolCalls = msg1?.tool_calls || [];
  if (toolCalls.length) {
    let args={}; try{ args = JSON.parse(toolCalls[0].function?.arguments || "{}"); }catch{}
    const q0 = (args.query || text).toString();
    const { corrected } = normalizeTimeAndQuery(q0, lang);
    const sr = await tavilySearch(corrected, SOURCE_LIMIT);
    if (!sr.ok) return sr.error==="NO_TAVILY_KEY" ? (lang==="ro"?"Adaugă TAVILY_API_KEY în Vercel.": "Add TAVILY_API_KEY in Vercel.") : `Search failed (${sr.error}).`;
    return await summarizeWithSources({ question:q0, searchData:sr.data, model, lang });
  }
  const plain = msg1?.content?.trim();
  return plain || (lang==="ro"?"Încearcă din nou.":"Try again.");
}

// ── Модели и команды ────────────────────────────────────────────────
const MODEL_OPTIONS = [
  { id:"gpt-4o-mini", label:"gpt-4o-mini (smart web tools)" },
  { id:"meta-llama/llama-3.1-70b-instruct", label:"Llama 3.1 70B (budget)" },
  { id:"mistralai/mistral-small", label:"Mistral Small (fast/cheap)" }
];
const KNOWN_CMDS = new Set(["start","help","lang","new","model","web"]);

// ── Бот ─────────────────────────────────────────────────────────────
let bot;
function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN; if (!token) return null;
  const b = new Bot(token);

  // Неизвестные /команды не пускаем в LLM
  b.use(async (ctx, next) => {
    if (ctx.message?.text?.startsWith("/")) {
      const m = ctx.message.text.match(/^\/(\w+)/);
      const cmd = (m?.[1] || "").toLowerCase();
      if (cmd && !KNOWN_CMDS.has(cmd)) {
        await ctx.reply("Unknown command. See /help.");
        return;
      }
    }
    await next();
  });

  // /start — сначала выбор языка, потом навигация
  b.command("start", async (ctx) => {
    await ctx.reply("Choose language / Alege limba / Выберите язык:", { reply_markup: langKB });
  });

  // /help
  b.command("help", async (ctx) => {
    const lang = await resolveLang(ctx, "");
    await ctx.reply(NAV[lang]);
  });

  // /lang — аргументом или кнопками
  b.command("lang", async (ctx) => {
    const arg = ((ctx.message.text || "").trim().split(/\s+/)[1] || "").toLowerCase();
    if (["ru","ro","en"].includes(arg)) {
      await setUserLang(ctx.from.id, arg);
      await setLangManual(ctx.from.id, true);
      await ctx.reply("OK");
      await ctx.reply(NAV[arg]);
      return;
    }
    await ctx.reply("ru | ro | en", { reply_markup: langKB });
  });
  b.callbackQuery(/^lang:(ru|ro|en)$/, async (ctx) => {
    const v = ctx.match[1];
    await setUserLang(ctx.from.id, v);
    await setLangManual(ctx.from.id, true);
    await ctx.answerCallbackQuery({ text: `Lang: ${v.toUpperCase()}` });
    try { await ctx.editMessageText("✓"); } catch {}
    const nav = NAV[v] || NAV.en;
    await ctx.reply(nav);
  });

  // /new
  b.command("new", async (ctx) => {
    await clearHistory(ctx.chat.id);
    await ctx.reply("OK. New chat.");
  });

  // /model
  b.command("model", async (ctx) => {
    const kb = new InlineKeyboard();
    for (const m of MODEL_OPTIONS) kb.text(m.label, `m:${m.id}`).row();
    await ctx.reply("Choose a model:", { reply_markup: kb });
  });
  b.callbackQuery(/m:.+/, async (ctx) => {
    const data = ctx.callbackQuery.data || "";
    const chosen = data.split(":")[1];
    const found = MODEL_OPTIONS.find((m) => m.id === chosen);
    if (!found) { await ctx.answerCallbackQuery({ text: "Unknown model", show_alert: true }); return; }
    await setUserModel(ctx.from.id, found.id);
    await ctx.answerCallbackQuery({ text: `Model: ${found.label}` });
    try { await ctx.editMessageText(`Current model: ${found.label}`); } catch {}
  });

  // /web — ручной поиск (с нормализацией опечаток)
  b.command("web", async (ctx) => {
    const text = ctx.message.text || "";
    const q = text.replace(/^\/web(@\S+)?\s*/i, "").trim();
    const lang = await resolveLang(ctx, q);
    if (!q) { await ctx.reply(lang==="ro"?"Scrie: /web întrebarea":"Type: /web your query"); return; }
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const userModel = await getUserModel(ctx.from.id); const model = userModel || defaultModel();
    const { corrected } = normalizeTimeAndQuery(q, lang);
    const sr = await tavilySearch(corrected, SOURCE_LIMIT);
    if (!sr.ok) { await ctx.reply(sr.error==="NO_TAVILY_KEY" ? "Add TAVILY_API_KEY in Vercel" : `Search failed (${sr.error}).`); return; }
    const ans = await summarizeWithSources({ question:q, searchData:sr.data, model, lang });
    await chunkAndReply(ctx, ans);
    await pushMessage(ctx.chat.id, { role:"user", content:`/web ${q}` });
    await pushMessage(ctx.chat.id, { role:"assistant", content: ans });
  });

  // Обычный чат
  b.on("message:text", async (ctx) => {
    const text = ctx.message.text?.trim() || ""; if (!text) return;
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const hist = await getHistory(ctx.chat.id);
    const userModel = await getUserModel(ctx.from.id);
    const model = userModel || defaultModel();
    const lang = await resolveLang(ctx, text);

    try {
      let answer;
      if (FORCE_WEB_FOR_OPEN && isOpenModelNeedingWeb(model)) {
        const { corrected } = normalizeTimeAndQuery(text, lang);
        const sr = await tavilySearch(corrected, SOURCE_LIMIT);
        answer = sr.ok ? await summarizeWithSources({ question:text, searchData:sr.data, model, lang })
                       : await plainChat({ text, hist, model, lang });
      } else if (isToolCapableModel(model)) {
        answer = await chatWithAutoSearch({ text, hist, model, lang });
      } else {
        answer = await plainChat({ text, hist, model, lang });
      }
      await pushMessage(ctx.chat.id, { role:"user", content:text });
      await pushMessage(ctx.chat.id, { role:"assistant", content:answer });
      await chunkAndReply(ctx, answer);
    } catch {
      await ctx.reply(lang==="ro"?"Eroare la procesare. Încearcă din nou.":"Error processing. Try again.");
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
