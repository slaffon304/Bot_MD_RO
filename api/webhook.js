import { Bot, webhookCallback } from "grammy";

let bot; // создаём бота только когда есть токен
function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const b = new Bot(token);
  b.command("start", (ctx) => ctx.reply("Привет! Бот на Vercel. Пиши текст — отвечу."));
  b.command("help", (ctx) => ctx.reply("Пока отвечаю простым текстом. ИИ подключим позже."));
  b.on("message:text", async (ctx) => {
    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    await ctx.reply("✅ Вебхук активен. Готов подключить ИИ, как только дадим ключ.");
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
