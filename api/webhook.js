import { Bot, webhookCallback, InlineKeyboard } from "grammy";

// ── Конфиг провайдера ───────────────────────────────────────────────
const provider = (process.env.PROVIDER || "none").toLowerCase();
const envModel = process.env.MODEL || ""; // дефолт можно задать в Vercel

function defaultModel() {
  return envModel || "gpt-4o-mini"; // дефолт для OpenRouter
}

// ── Вспомогательные функции ─────────────────────────────────────────
function chunkAndReply(ctx, text) {
  const max = 3800;
  const tasks = [];
  for (let i = 0; i < text.length; i += max) {
    tasks.push(ctx.reply(text.slice(i, i + max), { reply_to_message_id: ctx.message.message_id }));
  }
  return tasks.reduce((p, t) => p.then(() => t), Promise.resolve());
}

// Ленивая загрузка OpenAI клиента (OpenRouter)
async function getLLMClient() {
  if (provider !== "openrouter") return null;
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) return null;
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
}

// Ленивая загрузка стора (Redis)
async function loadStore() {
  // ../lib относительно папки api
  const m = await import("../lib/store.js");
  return m;
}

// Tavily: поиск
async function tavilySearch(query) {
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
      max_results: 5
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
        "Ты веб-помощник. Отвечай кратко на языке пользователя. Используй только факты из 'Источников'. " +
        "Делай маркированные пункты. Ссылки ставь в тексте по номерам [1], [2] и добавляй список источников в конце."
    },
    { role: "user", content: `Вопрос: ${question}\n\nИсточники:\n${list}\n\nВыдержки:\n${extracts}` }
  ];

  const r = await (await getLLMClient()).chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 450,
    messages
  });
  return r.choices?.[0]?.message?.content || "Не удалось сформировать ответ.";
}

// ── Модели для выбора ───────────────────────────────────────────────
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
    await ctx.reply("Привет! Я на Vercel.\n/new — очистить контекст\n/model — выбрать модель\n/web вопрос — поиск в сети");
  });

  b.command("help", async (ctx) => {
    await ctx.reply("Доступно: память контекста, /new, /model, /web. Провайдер: OpenRouter.");
  });

  b.command("new", async (ctx) => {
    const { clearHistory } = await loadStore();
    await clearHistory(ctx.chat.id);
    await ctx.reply("Окей, начинаем новый диалог. Что дальше?");
  });

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
    try { await ctx.editMessageText(`Текущая модель: ${found.label}`); } catch (_) {}
  });

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
        await ctx.reply("Для веб-поиска добавь TAVILY_API_KEY в Vercel (Production) и сделай Redeploy.");
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

    const system = { role: "system", content: "Ты краткий и полезный ассистент. Отвечай на языке пользователя." };
    const messages = [system, ...hist, { role: "user", content: text }];

    try {
      const r = await client.chat.completions.create({
        model,
        temperature: 0.6,
        max_tokens: 400,
        messages
      });
      const answer = r.choices?.[0]?.message?.content || "Нет ответа от модели.";
      await pushMessage(ctx.chat.id, { role: "user", content: text });
      await pushMessage(ctx.chat.id, { role: "assistant", content: answer });
      await chunkAndReply(ctx, answer);
    } catch (e) {
      console.error("LLM error:", e);
      await ctx.reply("Ошибка при запросе к модели. Проверь ключ/модель.");
    }
  });

  bot = b;
  return bot;
}

// ── HTTP‑обработчик ─────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  const b = getBot();
  if (!b) return res.status(200).send("NO_TOKEN");
  const handle = webhookCallback(b, "http");
  try {
    await handle(req, res);
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(200).end();
  }
            }
