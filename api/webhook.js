import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import OpenAI from "openai";
import { getHistory, pushMessage, clearHistory, getUserModel, setUserModel } from "../lib/store.js";

// Настройки провайдера
const provider = (process.env.PROVIDER || "none").toLowerCase();
const envModel = process.env.MODEL || ""; // если хочешь фиксировать модель через переменную

function getLLMClient() {
  if (provider !== "openrouter") return null;
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
}

function defaultModel() {
  // дефолт для OpenRouter — оставляем gpt-4o-mini
  return envModel || "gpt-4o-mini";
}

// Модели для выбора в /model
const MODEL_OPTIONS = [
  { id: "gpt-4o-mini", label: "gpt-4o-mini (качественно/недорого)" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B (бюджет)" },
  { id: "mistralai/mistral-small", label: "Mistral Small (очень быстро/дешево)" }
];

let bot;
function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const b = new Bot(token);

  b.command("start", async (ctx) => {
    await ctx.reply("Привет! Бот на Vercel. Пиши текст — отвечу.\n/new — очистить контекст\n/model — выбрать модель");
  });

  b.command("help", async (ctx) => {
    await ctx.reply("Доступно: ответы ИИ, память последних сообщений, /new для сброса, /model для выбора модели.");
  });

  b.command("new", async (ctx) => {
    await clearHistory(ctx.chat.id);
    await ctx.reply("Окей, начинаем новый диалог. Что дальше?");
  });

  // /model: показать кнопки с моделями
  b.command("model", async (ctx) => {
    const kb = new InlineKeyboard();
    for (const m of MODEL_OPTIONS) kb.text(m.label, `model:${m.id}`).row();
    await ctx.reply("Выбери модель:", { reply_markup: kb });
  });

  // Обработка выбора модели
  b.callbackQuery(/^model:/, async (ctx) => {
    const chosen = ctx.match[0].split(":")[1];
    const found = MODEL_OPTIONS.find((m) => m.id === chosen);
    if (!found) {
      await ctx.answerCallbackQuery({ text: "Неизвестная модель", show_alert: true });
      return;
    }
    await setUserModel(ctx.from.id, found.id);
    await ctx.answerCallbackQuery({ text: `Модель: ${found.label}` });
    await ctx.editMessageText(`Текущая модель: ${found.label}`);
  });

  // Основной обработчик текста
  b.on("message:text", async (ctx) => {
    const text = ctx.message.text?.trim() || "";
    if (!text) return;

    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    const client = getLLMClient();
    if (!client) {
      await ctx.reply("ИИ пока не подключён. Проверь PROVIDER=openrouter и OPENROUTER_API_KEY.");
      return;
    }

    // Собираем контекст: прошлые сообщения + текущее
    const hist = await getHistory(ctx.chat.id);
    const userModel = await getUserModel(ctx.from.id);
    const model = userModel || defaultModel();

    const system = { role: "system", content: "Ты краткий и полезный ассистент. Отвечай на языке пользователя." };
    const messages = [system, ...hist, { role: "user", content: text }];

    try {
      const r = await client.chat.completions.create({
        model,
        temperature: 0.6,
        max_tokens: 400, // чтобы не упираться в таймауты Vercel
        messages
      });

      const answer = r.choices?.[0]?.message?.content || "Нет ответа от модели.";
      // Сохраняем в память
      await pushMessage(ctx.chat.id, { role: "user", content: text });
      await pushMessage(ctx.chat.id, { role: "assistant", content: answer });

      // Режем длинные ответы под лимит Telegram
      const max = 3800;
      for (let i = 0; i < answer.length; i += max) {
        await ctx.reply(answer.slice(i, i + max), { reply_to_message_id: ctx.message.message_id });
      }
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
