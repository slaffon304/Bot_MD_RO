import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import {
  getHistory, pushMessage, clearHistory,
  getUserModel, setUserModel,
  getUserLang, setUserLang, setLangManual, isLangManual,
} from "../lib/store.js";
import { GPT_MODELS, gptKeyboard, resolvePModelByKey, findKeyByPModel, isProKey, premiumMsg } from "../lib/models.js";

/* ==================== CONFIG ==================== */
const provider = (process.env.PROVIDER || "none").toLowerCase();
const envModel = process.env.MODEL || "";
const FORCE_WEB_FOR_OPEN = (process.env.FORCE_WEB_FOR_OPEN ?? "1") !== "0";
const SOURCE_LIMIT = Math.max(1, Number(process.env.SOURCE_LIMIT || 2));
const EXTRACT_CHARS = Math.max(60, Number(process.env.EXTRACT_CHARS || 220));
const PREMIUM_ALL = process.env.PREMIUM_ALL === "1"; // открыть все pro‑модели в тесте

function defaultModel() { return envModel || "gpt-4o-mini"; }
function isToolCapableModel(m){ return /gpt-4o/i.test(m); }
function isOpenModelNeedingWeb(m){ return /(meta-llama|llama|mistral)/i.test(m); }

function chunkAndReply(ctx, text) {
  const max = 3800, parts = [];
  for (let i = 0; i < text.length; i += max) parts.push(text.slice(i, i + max));
  return parts.reduce((p, t) => p.then(() => ctx.reply(t, { reply_to_message_id: ctx.message.message_id })), Promise.resolve());
}

// Кэш ключа модели (если Redis недоступен)
const MODEL_KEY_MEM = new Map();

/* ========= content.json loader ========= */
const CONTENT_PATH = new URL("../content.json", import.meta.url);
let CONTENT_CACHE = null;
async function loadContent() {
  if (CONTENT_CACHE) return CONTENT_CACHE;
  try {
    const { readFile } = await import("node:fs/promises");
    CONTENT_CACHE = JSON.parse(await readFile(CONTENT_PATH, "utf8"));
  } catch {
    CONTENT_CACHE = { defaultLang: "ru", start: { ru: "Добро пожаловать!" } };
  }
  return CONTENT_CACHE;
}
async function getStartText(lang) {
  const c = await loadContent();
  const START = c?.start || {}; const DEF = c?.defaultLang || "ru";
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

/* ==================== Language ==================== */
// UI‑язык: для /start, /help, подписей
async function getUiLang(ctx) {
  const saved = await getUserLang(ctx.from.id);
  if (saved) return saved;
  const code = (ctx.from?.language_code || "").toLowerCase().split("-")[0];
  return ["ru","ro","en"].includes(code) ? code : "en";
}
// Язык сообщения: если ясно распознан — отвечаем на нём, иначе UI‑язык
function detectMsgLang(text, uiLang) {
  if (!text) return uiLang;
  if (/[А-Яа-яЁё\u0400-\u04FF]/.test(text)) return "ru";
  const lower = text.toLowerCase();
  const roWords = ["este","sunt","mâine","maine","mîine","azi","astăzi","astazi","vreme","vremea","oraș","bună","salut","prognoză","meteo","moldova","românia","chișinău","bucurești","bălți","balti"];
  const enWords = ["weather","wheather","forecast","tomorrow","tommorow","tomorow","tommorrow","today","hello","hi","city","ny","nyc","new york","what","how"];
  const roDiacritics = (text.match(/[ăâîșțĂÂÎȘȚ]/g) || []).length;
  const enAscii     = (text.match(/[a-z]/gi) || []).length;
  let roScore = roDiacritics * 2, enScore = enAscii > 0 ? 1 : 0;
  for (const w of roWords) if (lower.includes(w)) roScore += 2;
  for (const w of enWords) if (lower.includes(w)) enScore += 2;
  if (roScore - enScore >= 2) return "ro";
  if (enScore - roScore >= 2) return "en";
  return uiLang || "en";
}

/* ==================== Web search (Tavily) + нормализация ==================== */
async function tavilySearch(query, maxResults) {
  const key = process.env.TAVILY_API_KEY || "";
  if (!key) return { ok:false, error:"NO_TAVILY_KEY" };
  const wanted = Math.min(Math.max(maxResults || SOURCE_LIMIT, 1), SOURCE_LIMIT + 1);
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key:key, query, search_depth:"basic", include_answer:false, time_range:"w", max_results:wanted })
  });
  if (!r.ok) return { ok:false, error:`HTTP_${r.status}` };
  return { ok:true, data: await r.json() };
}
function rmDiacriticsRo(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[ăâ]/g,"a").replace(/[î]/g,"i").replace(/[șş]/g,"s").replace(/[țţ]/g,"t");
}
function levenshtein(a,b){a=a||"";b=b||"";const m=a.length,n=b.length,dp=Array(n+1).fill(0).map((_,j)=>j);for(let i=1;i<=m;i++){let prev=dp[0];dp[0]=i;for(let j=1;j<=n;j++){const temp=dp[j];const cost=a[i-1]===b[j-1]?0:1;dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+cost);prev=temp;}}return dp[n];}
function fuzzyHasToken(t,dict){t=rmDiacriticsRo(t.toLowerCase());return dict.some(w=>levenshtein(t,rmDiacriticsRo(w))<=1);}
function normalizeTimeAndQuery(text, lang){
  const tokens=(text||"").toLowerCase().split(/[^a-zăâîșțşţa-яё0-9]+/i).filter(Boolean);
  const roT=["mâine","maine","mîine"], roD=["azi","astăzi","astazi"];
  const enT=["tomorrow","tmrw","tmr","tommorow","tomorow","tommorrow"], enD=["today","2day","td"];
  const ruT=["завтра"], ruD=["сегодня","сейчас"];
  let tf=null; for(const t of tokens){ if(fuzzyHasToken(t,roT)||fuzzyHasToken(t,enT)||fuzzyHasToken(t,ruT)){tf="tomorrow";break;} if(fuzzyHasToken(t,roD)||fuzzyHasToken(t,enD)||fuzzyHasToken(t,ruD)){tf=tf||"today";}}
  let q=text||""; if(tf==="tomorrow") q+= lang==="ro"?" mâine maine": lang==="ru"?" завтра":" tomorrow";
  else if(tf==="today") q+= lang==="ro"?" azi": lang==="ru"?" сегодня":" today";
  return { timeframe: tf, corrected: q.trim() };
}

/* ==================== Strict chat request ==================== */
async function chatRequestStrict(model, messages, opts={}) {
  const client = await getLLMClient(); if (!client) throw new Error("NO_LLM");
  const r = await client.chat.completions.create({
    model, messages, temperature: opts.temperature ?? 0.6, max_tokens: opts.max_tokens ?? 400
  });
  return r.choices?.[0]?.message?.content || "";
}

/* ==================== Summarize with sources ==================== */
function summarizeSystem(lang){
  const base = `Citează/Quote ≤ ${SOURCE_LIMIT} surse. Respectă/Respect timeframe (azi/today vs mâine/tomorrow). Doar fapte din Surse. Bullets + [1],[2]; la final — sursele.`;
  return lang==="ro" ? "Ești un asistent web. Răspunde pe scurt în română. "+base
       : lang==="en" ? "You are a web assistant. Answer briefly in English. "+base
                     : "Ты веб‑ассистент. Отвечай кратко по‑русски. "+base;
}
function dedupeAndPick(results){const out=[],seen=new Set();for(const r of results||[]){try{const h=new URL(r.url).hostname.replace(/^www\./,"");if(seen.has(h))continue;seen.add(h);out.push(r);if(out.length>=SOURCE_LIMIT)break;}catch{}}return out;}
function shortText(s){return String(s||"").replace(/\s+/g," ").trim().slice(0,EXTRACT_CHARS);}
async function summarizeWithSources({question,searchData,model,lang}){
  const sel=dedupeAndPick(searchData?.results||[]); if(!sel.length) return lang==="ro"?"Nu am găsit rezultate.":lang==="en"?"No results found.":"Ничего не найдено.";
  const list=sel.map((s,i)=>`${i+1}. ${s.title||s.url} — ${s.url}`).join("\n");
  const ex  =sel.map((s,i)=>`[${i+1}] ${shortText(s.content)}`).join("\n\n");
  return await chatRequestStrict(model,[{role:"system",content:summarizeSystem(lang)},{role:"user",content:`Question: ${question}\n\nSources:\n${list}\n\nExtracts:\n${ex}`}],{temperature:0.2,max_tokens:450});
}

/* ==================== Helpers: selected model ==================== */
async function getSelected(ctx){
  const raw = (await getUserModel(ctx.from.id)) || MODEL_KEY_MEM.get(ctx.from.id);
  // raw может быть key (новый способ) или pmodel (старый)
  if (raw && !String(raw).includes("/")) {
    const key = String(raw); const pmodel = resolvePModelByKey(key) || defaultModel();
    return { key, pmodel };
  }
  if (raw && String(raw).includes("/")) {
    const p = String(raw); const key = findKeyByPModel(p) || null;
    return { key, pmodel: p };
  }
  // по умолчанию
  return { key: findKeyByPModel(defaultModel()) || "gpt5mini", pmodel: defaultModel() };
}
async function setSelectedKey(ctx, key){
  await setUserModel(ctx.from.id, key); // сохраняем key (коротко)
  MODEL_KEY_MEM.set(ctx.from.id, key);
}
function hasPremium(){ return PREMIUM_ALL; } // заглушка
/* ==================== BOT ==================== */
const KNOWN_CMDS = new Set(["start","help","lang","new","model","web","i","gpt","mymodel"]);

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
      if (cmd && !KNOWN_CMDS.has(cmd)) { await ctx.reply("Unknown command. See /help."); return; }
    }
    await next();
  });

  // /start → выбор языка → текст из JSON
  b.command("start", async (ctx) => {
    await ctx.reply("Choose language / Alege limba / Выберите язык:", {
      reply_markup: new InlineKeyboard().text("RU","lang:ru").text("RO","lang:ro").text("EN","lang:en")
    });
  });

  // /help — текст навигации (UI‑язык)
  b.command("help", async (ctx) => {
    const ui = await getUiLang(ctx);
    await ctx.reply(await getStartText(ui));
  });

  // /lang — фиксируем только UI‑язык
  b.command("lang", async (ctx) => {
    const v = ((ctx.message.text || "").trim().split(/\s+/)[1] || "").toLowerCase();
    if (!["ru","ro","en"].includes(v)) {
      await ctx.reply("ru | ro | en", { reply_markup: new InlineKeyboard().text("RU","lang:ru").text("RO","lang:ro").text("EN","lang:en") });
      return;
    }
    await setUserLang(ctx.from.id, v);
    await setLangManual(ctx.from.id, true);
    await ctx.reply("OK");
    await ctx.reply(await getStartText(v));
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
  b.command("new", async (ctx) => { await clearHistory(ctx.chat.id); await ctx.reply("OK. New chat."); });

  // /mymodel — показать активную модель (label + provider id)
  b.command("mymodel", async (ctx) => {
    const { key, pmodel } = await getSelected(ctx);
    const ui = await getUiLang(ctx);
    const label = GPT_MODELS.find(x => x.key === key)?.label?.[ui] || pmodel;
    await ctx.reply(`Current model: ${pmodel}\n(${label})`);
  });

  // /model — простое меню (оставили)
  b.command("model", async (ctx) => {
    const kb = new InlineKeyboard();
    for (const m of ["gpt-4o-mini","meta-llama/llama-3.1-70b-instruct","mistralai/mistral-small"])
      kb.text(m, `m:${m}`).row();
    await ctx.reply("Choose a model (legacy):", { reply_markup: kb });
  });
  b.callbackQuery(/m:.+/, async (ctx) => {
    const model = (ctx.match[0].split(":")[1] || "").trim();
    // совместимость: сохраняем как key, если сможем подобрать; иначе как pmodel
    const key = findKeyByPModel(model);
    if (key) await setSelectedKey(ctx, key);
    else     await setUserModel(ctx.from.id, model);
    await ctx.answerCallbackQuery({ text: `Model: ${model}` });
    try { await ctx.editMessageText(`Current model: ${model}`); } catch {}
  });

  // /gpt — сетка моделей с замочками (UI‑язык для подписей)
  b.command("gpt", async (ctx) => {
    const ui = await getUiLang(ctx);
    const { key } = await getSelected(ctx);
    const title = ui==="ro" ? "Alege modelul:" : ui==="en" ? "Choose a model:" : "Выберите модель:";
    await ctx.reply(title, { reply_markup: gptKeyboard(ui, key, () => PREMIUM_ALL) });
  });
  b.callbackQuery(/^gptsel:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    const ui = await getUiLang(ctx);
    if (isProKey(key) && !PREMIUM_ALL) { await ctx.answerCallbackQuery({ text: premiumMsg(ui), show_alert: true }); return; }
    await setSelectedKey(ctx, key);
    const label = GPT_MODELS.find(x => x.key === key)?.label?.[ui] || key;
    await ctx.answerCallbackQuery({ text: (ui==="ro"?"Model setat: ":"Model set: ") + label });
    try { const { key: cur } = await getSelected(ctx); await ctx.editMessageReplyMarkup({ reply_markup: gptKeyboard(ui, cur, () => PREMIUM_ALL) }); } catch {}
  });
  b.callbackQuery("gpt:back", async (ctx) => {
    const ui = await getUiLang(ctx);
    try { await ctx.editMessageText("✓"); } catch {}
    await ctx.reply(await getStartText(ui));
  });

  // /web и /i — язык = язык сообщения
  b.command(["web","i"], async (ctx) => {
    const txt = ctx.message.text || "";
    const q = txt.replace(/^\/(web|i)(@\S+)?\s*/i, "").trim();
    const ui = await getUiLang(ctx);
    const lang = detectMsgLang(q, ui);
    if (!q) { await ctx.reply(lang==="ro"?"Scrie: /i întrebarea": lang==="en"?"Type: /i your query":"Напишите: /i ваш запрос"); return; }
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const { pmodel } = await getSelected(ctx);
    const { corrected } = normalizeTimeAndQuery(q, lang);
    const sr = await tavilySearch(corrected, SOURCE_LIMIT);
    if (!sr.ok) { await ctx.reply(sr.error==="NO_TAVILY_KEY" ? "Add TAVILY_API_KEY in Vercel" : `Search failed (${sr.error}).`); return; }
    try {
      const ans = await summarizeWithSources({ question:q, searchData:sr.data, model: pmodel, lang });
      await chunkAndReply(ctx, ans);
      await pushMessage(ctx.chat.id, { role:"user", content:`/i ${q}` });
      await pushMessage(ctx.chat.id, { role:"assistant", content: ans });
    } catch {
      const msg = lang==="ro" ? "Modelul selectat nu este disponibil acum. Alege altul în /gpt."
               : lang==="en" ? "Selected model is not available now. Please pick another in /gpt."
                             : "Выбранная модель сейчас недоступна. Выберите другую в /gpt.";
      await ctx.reply(msg);
    }
  });

  // Обычный чат — язык = язык текущего сообщения; модель = выбранный key → pmodel
  b.on("message:text", async (ctx) => {
    const text = ctx.message.text?.trim() || ""; if (!text) return;
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const ui = await getUiLang(ctx);
    const lang = detectMsgLang(text, ui);
    const hist = await getHistory(ctx.chat.id);
    const { pmodel } = await getSelected(ctx);

    try {
      let answer;
      if (FORCE_WEB_FOR_OPEN && isOpenModelNeedingWeb(pmodel)) {
        const { corrected } = normalizeTimeAndQuery(text, lang);
        const sr = await tavilySearch(corrected, SOURCE_LIMIT);
        answer = sr.ok ? await summarizeWithSources({ question:text, searchData:sr.data, model: pmodel, lang })
                       : await chatRequestStrict(pmodel, [{role:"system",content:sysPrompt(lang)}, ...hist, {role:"user",content:text}], {max_tokens:400});
      } else if (isToolCapableModel(pmodel)) {
        // tools‑режим
        answer = await chatRequestStrict(pmodel, [{role:"system",content:sysPrompt(lang)}, ...hist, {role:"user",content:text}], {max_tokens:400});
      } else {
        answer = await chatRequestStrict(pmodel, [{role:"system",content:sysPrompt(lang)}, ...hist, {role:"user",content:text}], {max_tokens:400});
      }
      await pushMessage(ctx.chat.id, { role:"user", content:text });
      await pushMessage(ctx.chat.id, { role:"assistant", content:answer });
      await chunkAndReply(ctx, answer);
    } catch (e) {
      console.error("message error:", e?.message || e);
      const msg = lang==="ro" ? "Modelul selectat nu este disponibil acum. Alege altul în /gpt."
               : lang==="en" ? "Selected model is not available now. Please pick another in /gpt."
                             : "Выбранная модель сейчас недоступна. Выберите другую в /gpt.";
      await ctx.reply(msg);
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
