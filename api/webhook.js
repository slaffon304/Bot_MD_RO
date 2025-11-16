import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import OpenAI from "openai";
import { getHistory, pushMessage, clearHistory, getUserModel, setUserModel } from "../lib/store.js";

// Провайдер/модель (оставляем OpenRouter)
const provider = (process.env.PROVIDER || "none").toLowerCase();
const envModel = process.env.MODEL || ""; // можно задать через переменную, иначе дефолт ниже

function getLLMClient() {
  if (provider !== "openrouter") return null;
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
}

function defaultModel() {
  return envModel || "gpt-4o-mini"; // дефолт для OpenRouter
}

const MODEL_OPTIONS = [
  { id: "gpt-4o-mini", label: "gpt-4o-mini (качественно/недорого)" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B (бюджет)" },
  { id: "mistralai/mistral-small", label: "Mistral Small (очень быстро/дешево)" }
];

function chunkAndReply(ctx, text) {
  const max = 3800;
  const tasks = [];
  for (let i = 0; i < text.length; i += max) {
    tasks.push(ctx.reply(text.slice(i, i + max), { reply_to_message_id: ctx.message.message_id }));
  }
  return tasks.reduce((p, t) => p.then(() => t), Promise.resolve());
}

// Tavily: поиск в сети
async function tavilySearch(query) {
  const key = process.env.TAVILY_API_KEY || "";
  if (!key) return { ok: false, error: "NO_TAVILY_KEY" };
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "basic", // быстрее; можно advanced при необходимости
      include_answer: false,
      max_results: 5
    })
  });
  if (!resp.ok) {
    return { ok: false, error: `HTTP_${resp.status}` };
  }
  const data = await resp.json();
  return { ok: true, data };
}

// Суммаризация с источниками через OpenRouter
async function summarizeWithSources(question, searchData, model) {
  const client = getLLMClient();
  if (!client) throw new Error("NO_LLM");

  const sources = (searchData?.results || []).slice(0, 5);
  if (!sources.length) return "Ничего не нашёл по запросу. Попробуй переформулировать.";

  const list = sources.map((s, i) => `${i + 1}. ${s.title || s.url} — ${s.url}`).join("\n");

  // Короткие выдержки для контекста
  const extracts = sources
    .map((s, i) => `[${i + 1}] ${String(s.content || "").slice(0, 800)}`)
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content:
        "Ты веб-помощник. Отвечай кратко и по делу на языке пользователя. Используй только факты из 'Источников'. " +
        "Делай маркированные пункты. Ставь ссылки по номерам [1], [2], ... в тексте и добавляй список источников в конце. " +
        "Если данных мало — скажи об этом явно."
    },
    {
      role: "user",
      content:
        `Вопрос: ${question}\n\n` +
        `Источники (номер — заголовок — URL):\n${list}\n\n` +
        `Выдержки:\n${extracts}`
    }
  ];

  const r = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 450,
    messages
  });
  return r.choices?.[0]?.message?.content || "Не удалось сформировать ответ.";
}

let bot;
function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const b = new Bot(token);

  b.command("start", async (ctx) => {
    await ctx.reply("Привет! Я на Vercel.\nКоманды:\n/new — очистить контекст\n/model — выбрать модель\n/web вопрос — поиск в сети + краткий ответ с источниками");
  });

  b.command("help", async (ctx) => {
    await ctx.reply("Доступно: память контекста, /new, /model, /web. Провайдер: OpenRouter.");
  });

  b.command("new", async (ctx) => {
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
    const data = ctx.callbackQuery.data || "";
    const chosen = data.split(":")[1]; // всё после "m:"
    const found = MODEL_OPTIONS.find((m) => m.id === chosen);
    if (!found) {
      await ctx.answerCallbackQuery({ text: "Неизвестная модель", show_alert: true });
      return;
    }
    await setUserModel(ctx.from.id, found.id);
    await ctx.answerCallbackQuery({ text: `Модель: ${found.label}` });
    try {
      await ctx.editMessageText(`Текущая модель: ${found.label}`);
    } catch (_) {}
  });

  // Веб-поиск: /web вопрос...
  b.command("web", async (ctx) => {
    const text = ctx.message.text || "";
    const q = text.replace(/^\/web(@\S+)?\s*/i, "").trim();
    if (!q) {
      await ctx.reply("Напиши так: /web твой вопрос\nПример: /web курс RON к EUR сегодня");
      return;
    }
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const client = getLLMClient();
    if (!client) {
      await ctx.reply("ИИ пока не подключён. Проверь PROVIDER=openrouter и OPENROUTER_API_KEY.");
      return;
    }

    const userModel = await getUserModel(ctx.from.id);
    const model = userModel || defaultModel();

    const sr = await tavilySearch(q);
    if (!sr.ok) {
      if (sr.error === "NO_TAVILY_KEY") {
        await ctx.reply("Для веб-поиска добавь переменную TAVILY_API_KEY в Vercel (Production) и сделай Redeploy.");
      } else {
        await ctx.reply(`Поиск не удался (${sr.error}). Попробуй позже или измени запрос.`);
      }
      return;
    }

    try {
      const answer = await summarizeWithSources(q, sr.data, model);
      await chunkAndReply(ctx, answer);
      // По желанию — добавим ответ в память
      await pushMessage(ctx.chat.id, { role: "user", content: `/web ${q}` });
      await pushMessage(ctx.chat.id, { role: "assistant", content: answer });
    } catch (e) {
      console.error("WEB summarize error:", e);
      await ctx.reply("Не 
