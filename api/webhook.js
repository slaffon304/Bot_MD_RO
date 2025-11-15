import { Bot, webhookCallback } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) console.error("TELEGRAM_BOT_TOKEN is missing");

const bot = new Bot(8247615029:AAETHqvbVkEmqvI4UB4bw9Qk5MU3b3X8tFo);

// Простейшие ответы для проверки
bot.command("start", (ctx) => ctx.reply("Привет! Бот на Vercel. Пиши текст — отвечу."));
bot.command("help", (ctx) => ctx.reply("Пока отвечаю простым текстом. ИИ подключим позже."));
bot.on("message:text", async (ctx) => {
  await ctx.api.sendChatAction(ctx.chat.id, "typing");
  await ctx.reply("✅ Вебхук активен. Готов подключить ИИ, как только дадим ключ.");
});

// Vercel serverless function
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK"); // чтобы GET /api/webhook показывал OK
  }
  const handleUpdate = webhookCallback(bot, "http");
  try {
    await handleUpdate(req, res);
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(200).end();
  }
}
