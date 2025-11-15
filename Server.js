import express from "express";
import { Bot, webhookCallback } from "grammy";
import OpenAI from "openai";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET || "secret";
const baseUrl = process.env.BASE_URL; // https://<твой_домен_от_DO>.ondigitalocean.app
const provider = process.env.PROVIDER || "none"; // "openrouter" или "none"
const model = process.env.MODEL || "openai/gpt-4o-mini"; // для OpenRouter можно поменять на более бюджетную

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

const bot = new Bot(token);

// Простые команды
bot.command("start", (ctx) =>
  ctx.reply("Привет! Я на связи. Напиши сообщение.")
);
bot.command("help", (ctx) =>
  ctx.reply("Пока я умею отвечать текстом. Скоро добавим картинки/голос.")
);

// Ответы
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text?.trim() || "";
  if (!text) return;

  await ctx.api.sendChatAction(ctx.chat.id, "typing");

  let answer = "";
  try {
    if (provider === "openrouter" && process.env.OPENROUTER_API_KEY) {
      const client = new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
        // headers: { "HTTP-Referer": "https://your.domain", "X-Title": "YourBot" }
      });
      const r = await client.chat.completions.create({
        model,
        temperature: 0.7,
        messages: [
          { role: "system", content: "Ты лаконичный помощник. Отвечай по делу." },
          { role: "user", content: text }
        ]
      });
      answer = r.choices?.[0]?.message?.content || "Нет ответа от модели.";
    } else {
      // Без ключа ИИ — чтобы проверить вебхук и деплой
      answer = "✅ Бот развернут. Чтобы включить ИИ‑ответы, добавь OPENROUTER_API_KEY и PROVIDER=openrouter.";
    }
  } catch (e) {
    answer = "Ошибка запроса к модели: " + (e?.message || e);
  }

  // Режем очень длинные ответы под лимит Telegram
  const chunks = [];
  const max = 3800;
  for (let i = 0; i < answer.length; i += max) chunks.push(answer.slice(i, i + max));
  for (const part of chunks) {
    await ctx.reply(part, { reply_to_message_id: ctx.message.message_id });
  }
});

// Вебсервер и вебхук
const app = express();
app.use(`/webhook/${secret}`, webhookCallback(bot, "express"));
app.get("/", (_, res) => res.send("OK"));

const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`Listening on ${port}`);
  if (baseUrl) {
    try {
      await bot.api.setWebhook(`${baseUrl}/webhook/${secret}`);
      console.log("Webhook set to", `${baseUrl}/webhook/${secret}`);
    } catch (e) {
      console.error("Failed to set webhook", e);
    }
  } else {
    console.log("BASE_URL not set; add it in env and redeploy.");
  }
});
