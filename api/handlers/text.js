const store = require('../../lib/store');
const content = require('../../content.json');
const { 
    isProKey, 
    gptKeyboard, 
    premiumMsg, 
    resolvePModelByKey 
} = require('../../lib/models');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; 

const MODEL_CHANGE_MSG = {
  ru: "Выбранная модель настроена на обычный стиль общения и креативность по умолчанию. Настроить другие параметры можно в /settingsbot.",
  ro: "Modelul selectat este setat la stil normal de comunicare și creativitate implicită. Poți configura alți parametri în /settingsbot.",
  en: "The selected model is set to normal communication style and creativity by default. You can configure other parameters in /settingsbot."
};

// Используем безопасный разделитель, чтобы не ломать Markdown
const FOOTER_MSG = {
  ru: "\n\n➖➖➖➖➖➖\n🔄 Сменить модель: /model | ⚙️ Настройки: /settingsbot",
  ro: "\n\n➖➖➖➖➖➖\n🔄 Schimbă modelul: /model | ⚙️ Setări: /settingsbot",
  en: "\n\n➖➖➖➖➖➖\n🔄 Change model: /model | ⚙️ Settings: /settingsbot"
};

// --- AI SERVICE ---
async function chatWithAI(messages, modelKey) {
    if (!OPENROUTER_API_KEY) return "NO_KEY";
    const pmodel = resolvePModelByKey(modelKey) || 'openai/gpt-4o-mini';
    
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "HTTP-Referer": process.env.VERCEL_URL || 'https://bot.com',
                "X-Title": 'Telegram Bot',
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

// --- TEXT HANDLER ---
async function handleTextMessage(ctx, text) {
    if (!text || text.trim().length === 0) return;
    const userId = ctx.from.id.toString();
    await ctx.sendChatAction('typing');

    try {
        // 1. Получаем данные пользователя
        let userData = { language: 'ru', model: 'gpt5mini' };
        try {
            if (store.getUser) {
               const u = await store.getUser(userId);
               if (u) userData = { ...userData, ...u };
            }
        } catch (e) {}

        const lang = userData.language || 'ru';
        let history = [];
        if (store.getHistory) history = await store.getHistory(userId) || [];

        // 2. УМНЫЙ СИСТЕМНЫЙ ПРОМПТ
        // Очищаем название модели для промпта (чтобы не было символов вроде / или :)
        const modelNameRaw = userData.model || "AI Model";
        const modelNameClean = modelNameRaw.split('/').pop().replace(/[^a-zA-Z0-9 .-]/g, " "); 
        
        const systemPrompt = {
            role: "system",
            content: `You are a helpful AI assistant running on the "${modelNameClean}" model. 
            
            IMPORTANT RULES:
            1. IDENTITY: If the user asks who you are, tell them you are an AI based on ${modelNameClean}. Do NOT say you are from OpenAI unless you actually are (like GPT-4).
            2. LANGUAGE: DETECT the language of the user's message. ALWAYS reply in the SAME language as the user's message.
            3. FALLBACK: Only use ${lang === 'ru' ? 'Russian' : lang === 'ro' ? 'Romanian' : 'English'} if the user's input language is impossible to detect.`
        };

        const messagesToSend = [
            systemPrompt,
            ...history.slice(-6), 
            { role: "user", content: text }
        ];

        const aiResponse = await chatWithAI(messagesToSend, userData.model);

        if (aiResponse === "NO_KEY") {
             await ctx.reply("⚙️ API Key is missing.");
             return;
        }
        if (!aiResponse) {
            await ctx.reply("⚠️ AI Service Error.");
            return;
        }

        const footer = FOOTER_MSG[lang] || FOOTER_MSG.en;
        
        // Отправляем БЕЗ Markdown, чтобы спецсимволы в ответе ИИ не ломали бота
        await ctx.reply(aiResponse + footer);

        if (store.addToHistory) {
            await store.addToHistory(userId, { role: "user", content: text });
            await store.addToHistory(userId, { role: "assistant", content: aiResponse });
        }

    } catch (error) {
        console.error('Handle Text Error:', error);
        await ctx.reply('❌ Error.');
    }
}

async function handleClearCommand(ctx) {
    const userId = ctx.from.id.toString();
    if (store.clearHistory) await store.clearHistory(userId);
    await ctx.reply('🗑️ History cleared.');
}

async function handleModelCommand(ctx) {
    const userId = ctx.from.id.toString();
    let lang = 'ru';
    let model = 'gpt5mini';
    try {
        const u = await store.getUser(userId);
        if(u) { lang = u.language || 'ru'; model = u.model || 'gpt5mini'; }
    } catch(e){}

    const menuText = content.gpt_menu[lang] || content.gpt_menu.en;
    const keyboard = gptKeyboard(lang, model, () => false);

    await ctx.reply(menuText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard 
    });
}

async function handleModelCallback(ctx) {
    // Убрали langCode из аргументов
    const data = ctx.callbackQuery.data;
    const key = data.replace('model_', ''); 
    const userId = ctx.from.id.toString();

    // 1. Определяем актуальный язык ИЗ БАЗЫ
    let currentLang = 'ru';
    try {
        if (store.getUser) {
            const u = await store.getUser(userId);
            if (u && u.language) currentLang = u.language;
        }
    } catch (e) {}

    if (isProKey(key)) {
        const hasPremium = false; 
        if (!hasPremium) {
            const msg = premiumMsg(currentLang);
            await ctx.answerCbQuery(msg, { show_alert: true });
            return;
        }
    }

    // 2. Сохраняем модель
    if (store.setUserModel) await store.setUserModel(userId, key);

    // 3. Обновляем галочку
    try {
        const keyboard = gptKeyboard(currentLang, key, () => false);
        await ctx.editMessageReplyMarkup(keyboard); 
    } catch (e) {
        // Игнорируем ошибку "message is not modified"
    }

    // 4. Ответ на правильном языке
    const msg = MODEL_CHANGE_MSG[currentLang] || MODEL_CHANGE_MSG.ru;
    await ctx.reply(msg);
    
    await ctx.answerCbQuery();
}

module.exports = {
    handleTextMessage,
    handleClearCommand,
    handleModelCommand,
    handleModelCallback
};
            
