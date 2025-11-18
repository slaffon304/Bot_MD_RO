const store = require('../../lib/store');
const content = require('../../content.json');
const { 
    isProKey, 
    gptKeyboard, 
    premiumMsg, 
    resolvePModelByKey 
} = require('../../lib/models');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; 
const SITE_URL = process.env.VERCEL_URL || 'https://bot.domain';
const APP_NAME = 'Telegram AI Bot';

// --- СООБЩЕНИЯ ---

// Текст, который добавляется в конце каждого ответа AI
const FOOTER_MSG = {
  ru: "\n\n___\n🔄 Сменить модель: /model | ⚙️ Настройки: /settingsbot",
  ro: "\n\n___\n🔄 Schimbă modelul: /model | ⚙️ Setări: /settingsbot",
  en: "\n\n___\n🔄 Change model: /model | ⚙️ Settings: /settingsbot"
};

// Всплывающее уведомление при смене модели
const TOAST_MSG = {
  ru: "✅ Модель изменена!",
  ro: "✅ Model schimbat!",
  en: "✅ Model changed!"
};

// --- ФУНКЦИИ ---

/**
 * Запрос к OpenRouter
 */
async function chatWithAI(messages, modelKey) {
    const pmodel = resolvePModelByKey(modelKey) || 'openai/gpt-4o-mini';
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "HTTP-Referer": SITE_URL,
                "X-Title": APP_NAME,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": pmodel,
                "messages": messages,
                "temperature": 0.7
            })
        });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error("AI Error:", error);
        return null;
    }
}

/**
 * Обработка входящего текста
 * 1. Сохраняет историю (НЕ удаляет сообщения)
 * 2. Отправляет запрос AI
 * 3. Добавляет Footer с подсказками
 */
async function handleTextMessage(ctx, text) {
    if (!text || text.trim().length === 0) return;
    const userId = ctx.from.id.toString();
    
    // Отображаем статус "печатает..."
    await ctx.sendChatAction('typing');

    try {
        // Определяем язык и модель
        let userData = { language: 'ro', model: 'gpt5mini' };
        try {
            if (store.getUser) {
                const stored = await store.getUser(userId);
                if (stored) userData = { ...userData, ...stored };
            } else {
                const m = await store.getUserModel(userId);
                if (m) userData.model = m;
            }
        } catch (e) {}

        const lang = userData.language || 'ro';
        
        // История
        let history = [];
        if (store.getHistory) history = await store.getHistory(userId) || [];

        // Системный промпт
        const systemPrompt = {
            role: "system",
            content: "You are a helpful AI assistant. Detect user language and reply in the same language."
        };

        const messagesToSend = [
            systemPrompt,
            ...history.slice(-8), 
            { role: "user", content: text }
        ];

        // Запрос к AI
        const aiResponse = await chatWithAI(messagesToSend, userData.model);

        if (!aiResponse) {
            await ctx.reply('⚠️ AI service unavailable. Check API Key.');
            return;
        }

        // Формируем ответ с футером
        const footer = FOOTER_MSG[lang] || FOOTER_MSG.en;
        const finalMessage = aiResponse + footer;

        // Отправляем ответ (НОВОЕ сообщение, ничего не удаляем)
        await ctx.reply(finalMessage, { parse_mode: 'Markdown' });

        // Сохраняем в историю
        if (store.addToHistory) {
            await store.addToHistory(userId, { role: "user", content: text });
            await store.addToHistory(userId, { role: "assistant", content: aiResponse });
        }

    } catch (error) {
        console.error('Handle Text Error:', error);
        await ctx.reply('❌ Error processing request.');
    }
}

async function handleClearCommand(ctx) {
    const userId = ctx.from.id.toString();
    if (store.clearHistory) await store.clearHistory(userId);
    await ctx.reply('🗑️ Context cleared.');
}

/**
 * Команда /model - показывает меню выбора (без удаления истории)
 */
async function handleModelCommand(ctx) {
    const userId = ctx.from.id.toString();
    
    let userData = { language: 'ro', model: 'gpt5mini' };
    try {
        if (store.getUser) {
            const stored = await store.getUser(userId);
            if (stored) userData = { ...userData, ...stored };
        } else {
            const m = await store.getUserModel(userId);
            if (m) userData.model = m;
        }
    } catch (e) {}

    const lang = userData.language || 'ro';
    const menuText = content.gpt_menu[lang] || content.gpt_menu.en;
    
    // Шлем новое сообщение с меню
    const keyboard = gptKeyboard(lang, userData.model, () => false);
    await ctx.reply(menuText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
}

/**
 * Нажатие на кнопку модели
 * Меняет галочку ✅, но НЕ удаляет сообщение и НЕ шлем спам в чат
 */
async function handleModelCallback(ctx, langCode = 'ro') {
    const data = ctx.callbackQuery.data;
    const key = data.replace('model_', ''); 
    const userId = ctx.from.id.toString();

    // 1. Проверка Premium
    if (isProKey(key)) {
        const hasPremium = false; 
        if (!hasPremium) {
            const msg = premiumMsg(langCode);
            await ctx.answerCbQuery(msg, { show_alert: true });
            return;
        }
    }

    // 2. Сохраняем выбор в базу
    if (store.setUserModel) await store.setUserModel(userId, key);

    // 3. Обновляем клавиатуру (переставляем галочку)
    // Это происходит "тихо" внутри того же сообщения
    try {
        const keyboard = gptKeyboard(langCode, key, () => false);
        await ctx.editMessageReplyMarkup(keyboard.reply_markup);
    } catch (e) {
        // Если юзер нажал на уже выбранную модель, Telegram вернет ошибку "not modified"
        // Мы её просто игнорируем
    }

    // 4. Показываем всплывающее уведомление сверху ("Toast")
    const toast = TOAST_MSG[langCode] || TOAST_MSG.en;
    await ctx.answerCbQuery(toast);
}

module.exports = {
    handleTextMessage,
    handleClearCommand,
    handleModelCommand,
    handleModelCallback
};
    
