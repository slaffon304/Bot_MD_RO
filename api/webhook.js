import { Bot, webhookCallback } from "grammy";
import OpenAI from "openai";

const provider = (process.env.PROVIDER || "none").toLowerCase();
const model = process.env.MODEL || ""; // можно задать в Vercel

// Ленивая инициализация клиента под выбранного провайдера
function getLLMClient() {
  let baseURL = "";
  let apiKey = "";

  if (provider === "openrouter") {
    baseURL = "https://openrouter.ai/api/v1";
    apiKey = process.env.OPENROUTER_API_KEY || "";
  } else if (provider === "groq") {
    baseURL = "https://api.groq.com/openai/v1";
    apiKey = process.env.GROQ_API_KEY || "";
  } else if (provider === "together") {
    baseURL = "https://api.together.xyz/v1";
    apiKey = process.env.TOGETHER_API_KEY || "";
  } else if (provider === "fireworks") {
    baseURL = "https://api.fireworks.ai/inference/v1";
    apiKey = process.env.FIREWORKS_API_KEY || "";
  } else if (provider === "deepinfra") {
    baseURL = "https://api.deepinfra.com/v1/openai";
    apiKey = process.env.DEEPINFRA_API_KEY || "";
  } else {
    return null;
  }

  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL });
}

function defaultModel() {
  if (model) return model;
  if (provider === "groq") return "llama-3.1-70b-versatile";
  if (provider === "openrouter") return "gpt-4o-mini";
  if (provider === "together") return "meta-llama/llama-3.1-70b-instruct";
  if (provider === "fireworks") return "accounts/fireworks/models/llama-v3p1-70b-instruct";
  if (provider === "deepinfra") return "meta-llama/Meta-Llama-3.1-70B-Instruct";
  return "";
}

let bot;
function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const b = new Bot(token);

  b.command("start", (ctx) => ctx.reply("Привет! Бот на Vercel. Пиши текст — отвечу."));
  b.command("help", (ctx) => ctx.reply("Пока базовые ответы. ИИ включается переменными PROVIDER + ключ."));

  b.on("message:text", async (ctx) => {
    const text = ctx.message.text?.trim() || "";
    if (!text) return;

    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const client = getLLMClient();
    if (!client) {
      return ctx.reply("ИИ пока не подключён. В Vercel добавь PROVIDER и ключ (например, GROQ_API_KEY или OPENROUTER_API_KEY).");
    }

    try {
      const r = await client.chat.completions.create({
        model: defaultModel(),
        temperature: 0.6,
        messages: [
          { role: "system", content: "Ты краткий и полезный ассистент. Отвечай на языке пользователя." },
          { role: "user", content: text }
        ],
      });
      let answer = r.choices?.[0]?.message?.content || "Нет ответа от модели.";
      // Режем длинные ответы под лимит Telegram
      const parts = [];
      const max = 3800;
      for (let i = 0; i < answer.length; i += max) parts.push(answer.slice(i, i + max));
      for (const p of parts) await ctx.reply(p, { reply_to_message_id: ctx.message.message_id });
    } catch (e) {
      console.error("LLM error:", e);
      await ctx.reply("Ошибка при запросе к модели. Проверь ключ/модель.");
    }
  });

  bot = b;
  return bot;
}

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
