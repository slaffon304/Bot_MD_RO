import { Bot, webhookCallback, InlineKeyboard } from "grammy";

// ── Конфиг ──────────────────────────────────────────────────────────
const provider = (process.env.PROVIDER || "none").toLowerCase();
const envModel = process.env.MODEL || ""; // можно задать через переменные Vercel
const FORCE_WEB_FOR_OPEN = (process.env.FORCE_WEB_FOR_OPEN ?? "1") !== "0";

function defaultModel() {
  return envModel || "gpt-4o-mini"; // дефолт для OpenRouter, умеет tools
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

// ── Ленивая загрузка SDK и стора ────────────────────────────────────
async function getLLMClient() {
  if (provider !== "openrouter") return null;
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) return null;
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
}
async function loadStore() {
  const m = await import("../lib/store.js");
  return m;
}

// ── Веб‑поиск (Tavily) и суммаризация ───────────────────────────────
async function tavilySearch(query, maxResults = 5) {
  const key = process.env.TAVILY_API_KEY || "";
  if (!key) return { ok: false, error: "NO_TAVILY_KEY" };
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "basic",
      include_answer: false,
      time_range: "d", // последние сутки
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
    {
      role: "system",
      content:
        "Ты веб‑помощник. Если вопрос требует свежих фактов, используй только данные из 'Источников'. " +
        "Делай маркированные пункты. Ссылки ставь в тексте по номерам [1], [2], а в конце — список источников."
    },
    { role: "user", content: `Вопрос: ${question}\n\nИсточники:\n${list}\n\nВыдержки:\n${extracts}` }
  ];

  const r = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 450,
    messages
  });
  return r.choices?.[0]?.message?.content || "Не удалось сформировать ответ.";
}

// ── Вспомогательные определения моделей ─────────────────────────────
function isToolCapableModel(model) {
  return /gpt-4o/i.test(model);
}
function isOpenModelNeedingWeb(model) {
  return /(meta-llama|llama|mistral)/i.test(model);
}

// ── Чат с авто‑поиском через tools (для gpt‑4o‑mini) ────────────────
async function chatWithAutoSearch({ text, hist, model }) {
  const client = await getLLMClient();
  if (!client) throw new Error("NO_LLM");

  const system = {
    role: "system",
    content:
      "Ты помощник. Если для точного ответа нужны свежие факты (погода, курсы, новости и т.п.), " +
      "вызови инструмент web_search. Иначе отвечай сам."
  };
  const messages = [system, ...hist, { role: "user", content: text }];

  const tools = [
    {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Поиск в интернете для актуальных данных (погода, курсы валют, новости, цены и т.п.). " +
          "Формируй запрос на языке пользователя.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            max_results: { type: "integer", default: 5 }
          },
          required: ["query"]
        }
      }
    }
  ];

  const r1 = await client.chat.completions.create({
    model,
    temperature: 0.6,
    max_tokens: 300,
    messages,
    tools,
    tool_choice: "auto"
  });

  const msg1 = r1.choices?.[0]?.message;
  const toolCalls = msg1?.tool_calls || [];

  if (toolCalls.length > 0) {
    const call = toolCalls.find((c) => c.function?.name === "web_search") || toolCalls[0];
    let args = {};
    try { args = JSON.parse(call.function?.arguments || "{}"); } catch {}
    const q = (args.query || text).toString();
    const maxRes = Number(args.max_results || 5);

    const sr = await tavilySearch(q, maxRes);
    if (!sr.ok) {
      if (sr.error === "NO_TAVILY_KEY") return "Для веб‑поиска добавь TAVILY_API_KEY в Vercel (Production) и сделай Redeploy.";
      return `Поиск не удался (${sr.error}). Попробуй позже.`;
    }
    return await summarizeWithSources(q, sr.data, model);
  }

  const plain = msg1?.content?.trim();
  if (plain) return plain;
  return "Не удалось получить ответ. Попробуй переформулировать запрос.";
}

// ── Простой чат без tools ───────────────────────────────────────────
async function plainChat({ text, hist, model }) {
  const client = await getLLMClient();
  if (!client) throw new Error("NO_LLM");
  const messages = [{ role: "system", content: systemPrompt() }, ...hist, { role: "user", content: text }];
  const r = await client.chat.completions.create({
    model,
    temperature: 0.6,
    max_tokens: 400,
    messages
  });
  return r.choices?.[0]?.message?.content || "Нет ответа от модели.";
}

// ── Модели на выбор (/model) ────────────────────────────────────────
const MODEL_OPTIONS = [
  { id: "gpt-4o-mini", label: "gpt-4o-mini (качественно/недорого)" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B (бюджет)" },
  { id: "mistralai/mistral-small", label: "Mistral Small (очень быстро/дешево)" }
];

// ── Инициализация бота ──────────────────────────────────────────────
let bot;
function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const b = new Bot(token);

  b.command("start", async (ctx) => {
    await ctx.reply("Привет! Я на Vercel.\nКоманды:\n/new — очистить контекст\n/model — выбрать модель\n/web вопрос — ручной поиск в сети");
  });

  b.command("help", async (ctx) => {
    await ctx.reply("Доступно: память, /new, /model, /web. Авто‑поиск: на gpt‑4o‑mini — tools; на Llama/Mistral — принудительный веб‑поиск.");
  });

  // Очистка контекста
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
    const found = MODEL_OPTIONS.find((m) => m.id === chosen);
    if (!found) {
      await ctx.answerCallbackQuery({ text: "Неизвестная модель", show_alert: true });
      return;
    }
    await setUserModel(ctx.from.id, found.id);
    await ctx.answerCallbackQuery({ text: `Модель: ${found.label}` });
    try { await ctx.editMessageText(`Текущая модель: ${found.label}`); } catch {}
  });

  // Ручной веб‑поиск
  b.command("web", async (ctx) => {
    const { pushMessage, getUserModel } = await loadStore();
    const text = ctx.message.text || "";
    const q = text.replace(/^\/web(@\S+)?\s*/i, "").trim();
    if (!q) {
      await ctx.reply("Напиши так: /web твой вопрос\nПример: /web курс RON к EUR сегодня");
      return;
    }
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const client = await getLLMClient();
    if (!client) {
      await ctx.reply("ИИ пока не подключён. Проверь PROVIDER=openrouter и OPENROUTER_API_KEY.");
      return;
    }

    const userModel = await getUserModel(ctx.from.id);
    const model = userModel || defaultModel();

    const sr = await tavilySearch(q);
    if (!sr.ok) {
      if (sr.error === "NO_TAVILY_KEY") {
        await ctx.reply("Для веб‑поиска добавь TAVILY_API_KEY в Vercel (Production) и сделай Redeploy.");
      } else {
        await ctx.reply(`Поиск не удался (${sr.error}). Попробуй позже.`);
      }
      return;
    }

    try {
      const answer = await summarizeWithSources(q, sr.data, model);
      await chunkAndReply(ctx, answer);
      await pushMessage(ctx.chat.id, { role: "user", content: `/web ${q}` });
      await pushMessage(ctx.chat.id, { role: "assistant", content: answer });
    } catch (e) {
      console.error("WEB summarize error:", e);
      await ctx.reply("Не получилось суммаризовать результаты поиска.");
    }
  });

  // Обычный чат: tools для gpt‑4o‑mini, принудительный веб‑поиск для Llama/Mistral
  b.on("message:text", async (ctx) => {
    const { getHistory, pushMessage, getUserModel } = await loadStore();
    const text = ctx.message.text?.trim() || "";
    if (!text) return;

    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const client = await getLLMClient();
    if (!client) {
      await ctx.reply("ИИ пока не подключён. Проверь PROVIDER=openrouter и OPENROUTER_API_KEY.");
      return;
    }

    const hist = await getHistory(ctx.chat.id);
    const userModel = await getUserModel(ctx.from.id);
    const model = userModel || defaultModel();

    try {
      let answer;
