const store = require('../../lib/store');
const content = require('../../content.json');
const { 
    isProKey, 
    gptKeyboard, 
    premiumMsg, 
    resolvePModelByKey 
} = require('../../lib/models');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; 

// 1. СЛОВАРЬ ИМЕН (Добавь сюда точные ключи своих кнопок)
// Ключ слева должен совпадать с тем, что прописано в кнопках (callback_data)
const MODEL_NAMES = {
    'gpt5mini': 'GPT-5 Mini',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4o': 'GPT-4 Omni',
    'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
    'deepseek-chat': 'DeepSeek V3',
    'deepseek-r1': 'DeepSeek R1',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    // Если твои ключи отличаются (например, просто 'gemini'), добавь их сюда:
    'gemini': 'Gemini 2.5',
    'deepseek': 'DeepSeek V3'
};

const MODEL_CHANGE_MSG = {
  ru: "Выбранная модель настроена на обычный стиль общения и креативность по умолчанию. Настроить другие параметры можно в /settingsbot.",
  ro: "Modelul selectat este setat la stil normal de comunicare și creativitate implicită. Poți configura alți parametri în /settingsbot.",
  en: "The selected model is set to normal communication style and creativity by default. You can configure other parameters in /settingsbot."
};

const FOOTER_MSG = {
  ru: "\n\n➖➖➖➖➖➖\n🔄 Сменить модель: /model | ⚙️ Настройки: /settingsbot",
  ro: "\n\n➖➖➖➖➖➖\n🔄 Schimbă modelul: /model | ⚙️ Setări: /settingsbot",
  en: "\n\n➖➖➖➖➖➖\n🔄 Change model: /model | ⚙️ Settings: /settingsbot"
};

// --- AI SERVICE ---
async function chatWithAI(messages, modelKey) {
    if (!OPENROUTER_API_KEY) return "NO_KEY";
    // Здесь мы преобразуем короткий ключ (gemini) в длинный для API (google/gemini-flash...)
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
        // 2. ЗАГРУЗКА ПОЛЬЗОВАТЕЛЯ
        let userData = { language: 'ru', model: 'gpt5mini' }; // Дефолт
        
        try {
            if (store.getUser) {
               const u = await store.getUser(userId);
               // Лог для проверки: что реально загрузилось из базы?
               console.log(`[DEBUG] User ${userId} loaded data:`, u); 
               if (u) userData = { ...userData, ...u };
            }
        } catch (e) {
            console.error("[DEBUG] DB Load Error:", e);
        }

        const lang = userData.language || 'ru';
        let history = [];
        if (store.getHistory) history = await store.getHistory(userId) || [];

        // 3. ОПРЕДЕЛЕНИЕ ИМЕНИ ДЛЯ ПРОМПТА
        const modelKey = userData.model || 'gpt5mini';
        // Берем красивое имя из словаря, либо чистим техническое
        const niceModelName = MODEL_NAMES[modelKey] || modelKey;

        const systemPrompt = {
            role: "system",
            content: `You are a helpful AI assistant running on the "${niceModelName}" model. 
            
            IMPORTANT INSTRUCTIONS:
            1. IDENTITY: If the user asks "what model are you?", answer: "I am an AI based on ${niceModelName}".
            2. LANGUAGE: Reply in the SAME language as the user's message.
            3. FALLBACK: Only use ${lang === 'ru' ? 'Russian' : lang === 'ro' ? 'Romanian' : 'English'} if you cannot detect the language.`
        };

        const messagesToSend = [
            systemPrompt,
            ...history.slice(-6), 
            { role: "user", content: text }
        ];

        // ВАЖНО: Передаем технический ключ (modelKey) для API, но промпт уже содержит красивое имя
        const aiResponse = await chatWithAI(messagesToSend, modelKey);

        if (aiResponse === "NO_KEY") {
             await ctx.reply("⚙️ API Key is missing.");
             return;
        }
        if (!aiResponse) {
            await ctx.reply("⚠️ AI Service Error.");
            return;
        }

        const footer = FOOTER_MSG[lang] || FOOTER_MSG.en;
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

// --- CALLBACK (Смена модели) ---
async function handleModelCallback(ctx, langCode) {
    const data = ctx.callbackQuery.data;
    const key = data.replace('model_', ''); // Тут получаем ключ, например 'gemini'
    const userId = ctx.from.id.toString();

    // Определяем язык
    let currentLang = langCode || 'ru';
    try {
        if (store.getUser) {
            const u = await store.getUser(userId);
            if (u && u.language) currentLang = u.language;
        }
    } catch (e) {}

    if (isProKey(key)) {
        // Логика премиума (пока отключена)
        const hasPremium = false; 
        if (!hasPremium) {
            const msg = premiumMsg(currentLang);
            await ctx.answerCbQuery(msg, { show_alert: true });
            return;
        }
    }

    console.log(`[DEBUG] User ${userId} saving model: ${key}`); // Лог сохранения
    if (store.setUserModel) await store.setUserModel(userId, key);

    try {
        const keyboard = gptKeyboard(currentLang, key, () => false);
        await ctx.editMessageReplyMarkup(keyboard); 
    } catch (e) {}

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
    
