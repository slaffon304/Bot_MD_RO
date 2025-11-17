import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import {
  getHistory, pushMessage, clearHistory,
  getUserModel, setUserModel,
  getUserLang, setUserLang, setLangManual, isLangManual,
} from "../lib/store.js";

/* ==================== CONFIG ==================== */
const provider = (process.env.PROVIDER || "none").toLowerCase();
const envModel = process.env.MODEL || "";
const FORCE_WEB_FOR_OPEN = (process.env.FORCE_WEB_FOR_OPEN ?? "1") !== "0";
const SOURCE_LIMIT = Math.max(1, Number(process.env.SOURCE_LIMIT || 2));
const EXTRACT_CHARS = Math.max(60, Number(process.env.EXTRACT_CHARS || 220));
const PREMIUM_ALL = process.env.PREMIUM_ALL === "1"; // открыть все pro‑модели для теста

function defaultModel() { return envModel || "gpt-4o-mini"; }
function isToolCapableModel(m){ return /gpt-4o/i.test(m); }
function isOpenModelNeedingWeb(m){ return /(meta-llama|llama|mistral)/i.test(m); }

function chunkAndReply(ctx, text) {
  const max = 3800, parts = [];
  for (let i = 0; i < text.length; i += max) parts.push(text.slice(i, i + max));
  return parts.reduce((p, t) => p.then(() => ctx.reply(t, { reply_to_message_id: ctx.message.message_id })), Promise.resolve());
}

// Локальный кэш модели (если Redis недоступен)
const MODEL_MEM = new Map();

/* ========= content.json loader (без import assert) ========= */
const CONTENT_PATH = new URL("../content.json", import.meta.url);
let CONTENT_CACHE = null;
async function loadContent() {
  if (CONTENT_CACHE) return CONTENT_CACHE;
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(CONTENT_PATH, "utf8");
    CONTENT_CACHE = JSON.parse(raw);
  } catch {
    CONTENT_CACHE = { defaultLang: "ru", start: { ru: "Добро пожаловать!" } };
  }
  return CONTENT_CACHE;
}
async function getStartText(lang) {
  const content = await loadContent();
  const START = content?.start || {};
  const DEF = content?.defaultLang || "ru";
  return START[lang] || START[DEF] || START.ru || START.ro || START.en || "";
}

/* ==================== LLM (OpenRouter) ==================== */
async function getLLMClient() {
  if (provider !== "openrouter") return null;
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) return null;
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
}

/* ==================== Language detect ==================== */
function detectLangFromTG(code) {
  const s = (code || "").toLowerCase().split("-")[0];
  return ["ru","ro","en"].includes(s) ? s : "en";
}
// устойчивый авто‑детектор (кириллица → RU, очки для RO/EN)
function detectLangFromText(text) {
  if (!text) return null;
  if (/[А-Яа-яЁё\u0400-\u04FF]/.test(text)) return "ru";

  const lower = text.toLowerCase();
  const roWords = ["este","sunt","mâine","maine","mîine","azi","astăzi","astazi","vreme","vremea","oraș","bună","salut","prognoză","meteo","moldova","românia","chișinău","bucurești","bălți","balti"];
  const enWords = ["weather","wheather","forecast","tomorrow","tommorow","tomorow","tommorrow","today","hello","hi","city","ny","nyc","new york","what","how"];

  const roDiacritics = (text.match(/[ăâîșțĂÂÎȘȚ]/g) || []).length;
  const enAscii = (text.match(/[a-z]/gi) || []).length;

  let roScore = roDiacritics, enScore = enAscii > 0 ? 1 : 0;
  for (const w of roWords) if (lower.includes(w)) roScore += 2;
  for (const w of enWords) if (lower.includes(w)) enScore += 2;

  if (enScore > roScore) return "en";
  if (roScore > enScore) return "ro";
  if (enScore === roScore) {
    if (roDiacritics <= 1 && enWords.some(w => lower.includes(w))) return "en";
    if (roWords.some(w => lower.includes(w))) return "ro";
  }
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

/* ==================== Web search (Tavily) ==================== */
async function tavilySearch(query, maxResults) {
  const key = process.env.TAVILY_API_KEY || "";
  if (!key) return { ok:false, error:"NO_TAVILY_KEY" };
  const wanted = Math.min(Math.max(maxResults || SOURCE_LIMIT, 1), SOURCE_LIMIT + 1);
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key:key, query, search_depth:"basic", include_answer:false, time_range:"w", max_results:wanted })
  });
  if (!resp.ok) return { ok:false, error:`HTTP_${resp.status}` };
  const data = await resp.json();
  return { ok:true, data };
}
// нормализация «сегодня/завтра» + опечатки
function rmDiacriticsRo(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[ăâ]/g,"a").replace(/[î]/g,"i").replace(/[șş]/g,"s").replace(/[țţ]/g,"t");
}
function levenshtein(a, b) {
  a = a || ""; b = b || "";
  const m = a.length, n = b.length;
  const dp = new Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[j] = Math.min(dp[j]+1, dp[j-1]+1, prev+cost);
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
  const tokens = (text || "").toLowerCase().split(/[^a-zăâîșțşţa-яё0-9]+/i).filter(Boolean);
  const roTomorrow = ["mâine","maine","mîine"], roToday = ["azi","astăzi","astazi"];
  const enTomorrow = ["tomorrow","tmrw","tmr","tommorow","tomorow","tommorrow"], enToday = ["today","2day","td"];
  const ruTomorrow = ["завтра"], ruToday = ["сегодня","сейчас"];
  let timeframe = null;
  for (const t of tokens) {
    if (fuzzyHasToken(t, roTomorrow) || fuzzyHasToken(t, enTomorrow) || fuzzyHasToken(t, ruTomorrow)) { timeframe = "tomorrow"; break; }
    if (fuzzyHasToken(t, roToday) || fuzzyHasToken(t, enToday) || fuzzyHasToken(t, ruToday)) { timeframe = timeframe || "today"; }
  }
  let q = text || "";
  if (timeframe === "tomorrow") q += lang==="ro" ? " mâine maine" : lang==="ru" ? " завтра" : " tomorrow";
  else if (timeframe === "today") q += lang==="ro" ? " azi" : lang==="ru" ? " сегодня" : " today";
  return { timeframe, corrected: q.trim() };
}

/* ==================== Chat request with fallback ==================== */
async function chatRequest(model, messages, opts = {}) {
  const client = await getLLMClient();
  if (!client) throw new Error("NO_LLM");
  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0.6,
    max_tokens: opts.max_tokens ?? 400,
  };
  try {
    const r = await client.chat.completions.create(body);
    return r.choices?.[0]?.message?.content || "";
  } catch (e) {
    console.error("chatRequest error for model:", model, e?.message || e);
    const def = defaultModel();
    if (model !== def) {
      try {
        const r2 = await client.chat.completions.create({ ...body, model: def });
        return r2.choices?.[0]?.message?.content || "";
      } catch (e2) {
        console.error("fallback error:", e2?.message || e2);
        throw e2;
      }
    }
    throw e;
  }
}

/* ==================== Summarize with sources ==================== */
function summarizeSystem(lang){
  const common = `Citează/Quote ≤ ${SOURCE_LIMIT} surse. Respectă/Respect timeframe (azi/today vs mâine/tomorrow). Doar fapte din Surse. Bullets + [1],[2]; la final — sursele.`;
  if (lang==="ro") return "Ești un asistent web. Răspunde pe scurt în română. " + common;
  if (lang==="en") return "You are a web assistant. Answer briefly in English. " + common;
  return "Ты веб‑ассистент. Отвечай кратко по‑русски. " + common;
}
function dedupeAndPick(results) {
  const picked = [], seen = new Set();
  for (const r of results || []) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./,"");
      if (seen.has(host)) continue;
      seen.add(host);
      picked.push(r);
      if (picked.length >= SOURCE_LIMIT) break;
    } catch {}
  }
  return picked;
}
function shortText(s) { return String(s || "").replace(/\s+/g," ").trim().slice(0, EXTRACT_CHARS); }
async function summarizeWithSources({ question, searchData, model, lang }) {
  const selected = dedupeAndPick(searchData?.results || []);
  if (!selected.length) return lang==="ro" ? "Nu am găsit rezultate." : lang==="en" ? "No results found." : "Ничего не найдено.";
  const list = selected.map((s,i)=>`${i+1}. ${s.title||s.url} — ${s.url}`).join("\n");
  const extracts = selected.map((s,i)=>`[${i+1}] ${shortText(s.content)}`).join("\n\n");
  return await chatRequest(model, [
    { role:"system", content: summarizeSystem(lang) },
    { role:"user", content:`Question: ${question}\n\nSources:\n${list}\n\nExtracts:\n${extracts}` }
  ], { temperature:0.2, max_tokens:450 });
}

/* ==================== Chat modes ==================== */
async function plainChat({ text, hist, model, lang }) {
  return await chatRequest(model, [{ role:"system", content: sysPrompt(lang) }, ...hist, { role:"user", content:text }], { temperature:0.6, max_tokens:400 });
}
async function chatWithAutoSearch({ text, hist, model, lang }) {
  const client = await getLLMClient();
  if (!client) throw new Error("NO_LLM");
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

/* ==================== /gpt: модели, замочки, клавиатура ==================== */
const GPT_MODELS = [
  { key:"chatgpt5",  label:{ru:"ChatGPT 5", ro:"ChatGPT 5", en:"ChatGPT 5"},            model:"openai/gpt-5",                         tier:"pro" },
  { key:"gpt5_0",    label:{ru:"GPT 5.0",    ro:"GPT 5.0",    en:"GPT 5.0"},            model:"openai/gpt-5.0",                         tier:"pro" },
  { key:"gpt4o",     label:{ru:"GPT 4o",     ro:"GPT 4o",     en:"GPT 4o"},             model:"openai/gpt-4o",                         tier:"pro" },
  { key:"o3",        label:{ru:"OpenAI o3",  ro:"OpenAI o3",  en:"OpenAI o3"},          model:"openai/gpt-o3",                         tier:"pro" },
  { key:"o4mini",    label:{ru:"OpenAI o4 mini", ro:"OpenAI o4 mini", en:"OpenAI o4 mini"}, model:"openai/gpt-o4-mini",                 tier:"pro" },
  { key:"gpt5mini",  label:{ru:"GPT 5 mini", ro:"GPT 5 mini", en:"GPT 5 mini"},         model:"openai/gpt-5-mini",                    tier:"free" },
  { key:"gpt41",     label:{ru:"GPT 4.1",    ro:"GPT 4.1",    en:"GPT 4.1"},            model:"openai/gpt-4.1",                         tier:"pro" },
  { key:"deepseek",  label:{ru:"DeepSeek V3.2", ro:"DeepSeek V3.2", en:"DeepSeek V3.2"}, model:"deepseek/deepseek-chat",                tier:"free" },
  { key:"deepthink", label:{ru:"DeepSeek Thinking", ro:"DeepSeek Thinking", en:"DeepSeek Thinking"}, model:"deepseek/deepseek-reasoner", tier:"pro" },
  { key:"claude_s",  label:{ru:"Claude 4.5 Sonnet", ro:"Claude 4.5 Sonnet", en:"Claude 4.5 Sonnet"}, model:"anthropic/claude-4.5-sonnet", tier:"free" },
  { key:"claude_t",  label:{ru:"Claude 4.5 Thinking", ro:"Claude 4.5 Thinking", en:"Claude 4.5 Thinking"}, model:"anthropic/claude-4.5-thinking", tier:"pro" },
  { key:"gemini_pro",   label:{ru:"Gemini 2.5 Pro", ro:"Gemini 2.5 Pro", en:"Gemini 2.5 Pro"},     model:"google/gemini-2.5-pro-latest",   tier:"pro" },
  { key:"gemini_flash", label:{ru:"Gemini 2.5 Flash", ro:"Gemini 2.5 Flash", en:"Gemini 2.5 Flash"}, model:"google/gemini-2.5-flash-latest", tier:"free" }
];
function hasPremium(_userId) { return PREMIUM_ALL; } // позже подвяжем к оплате/Redis

function labelWithState(item, lang, selectedModel) {
  const base = item.label[lang] || item.label.en || item.key;
  const locked = item.tier === "pro" && !hasPremium();
  const selected = selectedModel && item.model === selectedModel;
  if (selected) return `✅ ${base}`;
  if (locked)   return `🔒 ${base}`;
  return base;
}
function gptKeyboard(lang, selectedModel) {
  const kb = new InlineKeyboard();
  const perRow = 2; // можно 3 — будет “шире”
  for (let i = 0; i < GPT_MODELS.length; i += perRow) {
    const row = GPT_MODELS.slice(i, i + perRow);
    for (const item of row) kb.text(labelWithState(item, lang, selectedModel), `gptsel:${item.key}`);
    kb.row();
  }
  const back = lang==="ro" ? "⬅️ Înapoi" : lang==="en" ? "⬅️ Back" : "⬅️ Назад";
  kb.text(back, "gpt:back");
  return kb;
}
function premiumMsg(lang) {
  if (lang==="ro") return "Acest model este disponibil în Premium. Cumpără /premium.";
  if (lang==="en") return "This model is Premium only. Purchase /premium.";
  return "Эта модель доступна в премиум‑подписке. Оформите /premium.";
}

/* ==================== Старое /model (оставим) ==================== */
const MODEL_OPTIONS = [
  { id:"gpt-4o-mini", label:"gpt-4o-mini (smart web tools)" },
  { id:"meta-llama/llama-3.1-70b-instruct", label:"Llama 3.1 70B (budget)" },
  { id:"mistralai/mistral-small", label:"Mistral Small (fast/cheap)" }
];
const KNOWN_CMDS = new Set(["start","help","lang","new","model","web","i","gpt","mymodel"]);
/* ==================== BOT ==================== */
let bot;
function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN; if (!token) return null;
  const b = new Bot(token);

  // Фильтр неизвестных команд
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

  // /start → выбор языка → текст из JSON
  b.command("start", async (ctx) => {
    await ctx.reply("Choose language / Alege limba / Выберите язык:", {
      reply_markup: new InlineKeyboard().text("RU","lang:ru").text("RO","lang:ro").text("EN","lang:en")
    });
  });

  // /help → текст из JSON
  b.command("help", async (ctx) => {
    const lang = await resolveLang(ctx, "");
    await ctx.reply(await getStartText(lang));
  });

  // /lang — аргументом или кнопками
  b.command("lang", async (ctx) => {
    const arg = ((ctx.message.text || "").trim().split(/\s+/)[1] || "").toLowerCase();
    if (["ru","ro","en"].includes(arg)) {
      await setUserLang(ctx.from.id, arg);
      await setLangManual(ctx.from.id, true);
      await ctx.reply("OK");
      await ctx.reply(await getStartText(arg));
      return;
    }
    await ctx.reply("ru | ro | en", { reply_markup: new InlineKeyboard().text("RU","lang:ru").text("RO","lang:ro").text("EN","lang:en") });
  });
  b.callbackQuery(/^lang:(ru|ro|en)$/, async (ctx) => {
    const v = ctx.match[1];
    await setUserLang(ctx.from.id, v);
    await setLangManual(ctx.from.id, true);
    await ctx.answerCallbackQuery({ text: `Lang: ${v.toUpperCase()}` });
    try { await ctx.editMessageText("✓"); } catch {}
    await ctx.reply(await getStartText(v));
  });

  // /new
  b.command("new", async (ctx) => {
    await clearHistory(ctx.chat.id);
    await ctx.reply("OK. New chat.");
  });

  // /mymodel — показать активную модель
  b.command("mymodel", async (ctx) => {
    const current = (await getUserModel(ctx.from.id)) || MODEL_MEM.get(ctx.from.id) || defaultModel();
    await ctx.reply(`Current model: ${current}`);
  });

  // /model (простое меню)
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
    MODEL_MEM.set(ctx.from.id, found.id); // кэш на случай отсутствия Redis
    await ctx.answerCallbackQuery({ text: `Model: ${found.label}` });
    try { await ctx.editMessageText(`Current model: ${found.label}`); } catch {}
  });

  // /gpt — сетка моделей c замочками
  b.command("gpt", async (ctx) => {
    const lang = await resolveLang(ctx, "");
    const sel = (await getUserModel(ctx.from.id)) || MODEL_MEM.get(ctx.from.id) || defaultModel();
    const title = lang==="ro" ? "Alege modelul:" : lang==="en" ? "Choose a model:" : "Выберите модель:";
    await ctx.reply(title, { reply_markup: gptKeyboard(lang, sel) });
  });
  b.callbackQuery(/^gptsel:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    const lang = await resolveLang(ctx, "");
    const item = GPT_MODELS.find(m => m.key === key);
    if (!item) { await ctx.answerCallbackQuery({ text: "Unknown model", show_alert: true }); return; }
    const locked = item.tier === "pro" && !hasPremium(ctx.from.id);
    if (locked) { await ctx.answerCallbackQuery({ text: premiumMsg(lang), show_alert: true }); return; }
    await setUserModel(ctx.from.id, item.model);
    MODEL_MEM.set(ctx.from.id, item.model); // кэш
    await ctx.answerCallbackQuery({ text: (lang==="ro"?"Model setat: ":"Model set: ") + (item.label[lang] || item.label.en) });
    try { await ctx.editMessageReplyMarkup({ reply_markup: gptKeyboard(lang, item.model) }); } catch {}
  });
  b.callbackQuery("gpt:back", async (ctx) => {
    const lang = await resolveLang(ctx, "");
    try { await ctx.editMessageText("✓"); } catch {}
    await ctx.reply(await getStartText(lang));
  });

  // /web и /i — ручной поиск
  b.command(["web","i"], async (ctx) => {
    const text = ctx.message.text || "";
    const q = text.replace(/^\/(web|i)(@\S+)?\s*/i, "").trim();
    const lang = await resolveLang(ctx, q);
    if (!q) { await ctx.reply(lang==="ro"?"Scrie: /i întrebarea":"Type: /i your query"); return; }
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const userModel = (await getUserModel(ctx.from.id)) || MODEL_MEM.get(ctx.from.id);
    const model = userModel || defaultModel();

    const { corrected } = normalizeTimeAndQuery(q, lang);
    const sr = await tavilySearch(corrected, SOURCE_LIMIT);
    if (!sr.ok) { await ctx.reply(sr.error==="NO_TAVILY_KEY" ? "Add TAVILY_API_KEY in Vercel" : `Search failed (${sr.error}).`); return; }
    const ans = await summarizeWithSources({ question:q, searchData:sr.data, model, lang });
    await chunkAndReply(ctx, ans);
    await pushMessage(ctx.chat.id, { role:"user", content:`/i ${q}` });
    await pushMessage(ctx.chat.id, { role:"assistant", content: ans });
  });

  // Обычный чат
  b.on("message:text", async (ctx) => {
    const text = ctx.message.text?.trim() || ""; if (!text) return;
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const hist = await getHistory(ctx.chat.id);
    const userModel = (await getUserModel(ctx.from.id)) || MODEL_MEM.get(ctx.from.id);
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
    } catch (e) {
      console.error("message handler error:", e?.message || e);
      await ctx.reply(lang==="ro"?"Eroare la procesare. Încearcă din nou.":"Error processing. Try again.");
    }
  });

  bot = b;
  return bot;
}

/* ==================== HTTP handler ==================== */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  const b = getBot(); if (!b) return res.status(200).send("NO_TOKEN");
  const handle = webhookCallback(b, "http");
  try { await handle(req, res); } catch (e) { console.error("webhook error:", e?.message || e); res.status(200).end(); }
                                                                                        }
