const store = require('../../lib/store');
const content = require('../../content.json');
const { 
    isProKey, 
    gptKeyboard, 
    premiumMsg, 
    resolvePModelByKey 
} = require('../../lib/models');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; 

// --- 1. СЛОВАРЬ ИМЕН ---
// Важно: ключи слева должны совпадать с тем, что прописано в кнопках (data)
const MODEL_NAMES = {
    'gpt5mini': 'GPT-5 Mini',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4o': 'GPT-4 Omni',
    'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
    'deepseek-chat': 'DeepSeek V3.2',
    'deepseek': 'DeepSeek V3.2', // Ключ который скорее всего идет с кнопки
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-flash': 'Gemini 2.5 Flash',
    'gemini': 'Gemini 2.5 Pro',
    'gemini-pro': 'Gemini 2.5 Pro'
};

// Безопасный разделитель
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
        // Загружаем модель и язык, используя функции из store.js
        let savedModel = 'gpt5mini';
        let savedLang = 'ru';

        try {
            // Используем Promise.all для скорости
            if (store.getUserModel && store.getUserLang) {
                const [m, l] = await Promise.all([
                    store.getUserModel(userId),
                    store.getUserLang(userId)
                ]);
                if (m) savedModel = m;
                if (l) savedLang = l;
                console.log(`[DEBUG] Text: User ${userId} using model: ${savedModel}`);
            }
        } catch (e) {
            console.error("[DEBUG] DB Load Error:", e);
        }

        const userData = { model: savedModel, language: savedLang };
        const lang = userData.language;
        
        // История
        let history = [];
        if (store.getHistory) history = await store.getHistory(userId) || [];

        // --- ФОРМИРОВАНИЕ СИСТЕМНОГО ПРОМПТА ---
        const modelKey = userData.model;
        // Получаем красивое имя, или используем ключ, если имени нет
        const niceModelName = MODEL_NAMES[modelKey] || modelKey;

        const systemPrompt = {
            role: "system",
            content: `You are a helpful AI assistant running on the "${niceModelName}" model. 
            
            IMPORTANT INSTRUCTIONS:
            1. IDENTITY: If the user asks "what model are you?" or "who are you?", answer: "I am an AI based on ${niceModelName}".
            2. LANGUAGE: Reply in the SAME language as the user's message.
            3. FALLBACK: Only use ${lang === 'ru' ? 'Russian' : lang === 'ro' ? 'Romanian' : 'English'} if you cannot detect the language.`
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
        await ctx.reply(aiResponse + footer);

        // Сохраняем историю (используем pushMessage как в твоем store.js)
        if (store.pushMessage) {
            await store.pushMessage(userId, { role: "user", content: text });
            await store.pushMessage(userId, { role: "assistant", content: aiResponse });
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
        if (store.getUserLang) {
            const l = await store.getUserLang(userId);
            if (l) lang = l;
        }
        if (store.getUserModel) {
            const m = await store.getUserModel(userId);
            if (m) model = m;
        }
    } catch(e){}

    const menuText = content.gpt_menu[lang] || content.gpt_menu.en;
    const keyboard = gptKeyboard(lang, model, () => false);

    await ctx.reply(menuText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard 
    });
}

// --- ОБРАБОТЧИК ВЫБОРА МОДЕЛИ (ИСПРАВЛЕНО СООБЩЕНИЕ) ---
async function handleModelCallback(ctx, langCode) {
    const data = ctx.callbackQuery.data;
    const key = data.replace('model_', ''); 
    const userId = ctx.from.id.toString();

    // 1. Определяем язык
    let currentLang = langCode;
    try {
        if (!currentLang && store.getUserLang) {
            currentLang = await store.getUserLang(userId);
        }
    } catch (e) {}
    if (!currentLang) currentLang = 'ru';

    // 2. Проверка премиума
    if (isProKey(key)) {
        const hasPremium = false; 
        if (!hasPremium) {
            const msg = premiumMsg(currentLang);
            await ctx.answerCbQuery(msg, { show_alert: true });
            return;
        }
    }

    // 3. Сохраняем выбор в базу
    console.log(`[DEBUG] User ${userId} SELECTED model: ${key}`);
    if (store.setUserModel) await store.setUserModel(userId, key);

    // 4. Обновляем клавиатуру
    try {
        const keyboard = gptKeyboard(currentLang, key, () => false);
        await ctx.editMessageReplyMarkup(keyboard); 
    } catch (e) {}

    // 5. ФОРМИРУЕМ НОВОЕ СООБЩЕНИЕ
    const niceName = MODEL_NAMES[key] || key; // Берем красивое имя
    
    let replyText = "";
    
    if (currentLang === 'ru') {
        replyText = `Вы выбрали модель ${niceName}, можете пользоваться. Настройки креативности и стиля по умолчанию.`;
    } else if (currentLang === 'ro') {
        replyText = `Ai selectat modelul ${niceName}, îl poți utiliza. Setările de creativitate și stil sunt implicite.`;
    } else {
        replyText = `You selected model ${niceName}, you can use it. Creativity and style settings are default.`;
    }
    
    // Добавляем ссылку на настройки
    replyText += "\n/settingsbot";

    await ctx.reply(replyText);
    await ctx.answerCbQuery();
}

module.exports = {
    handleTextMessage,
    handleClearCommand,
    handleModelCommand,
    handleModelCallback
};
                    
