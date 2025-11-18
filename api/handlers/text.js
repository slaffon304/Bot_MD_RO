const store = require('../../lib/store');
const content = require('../../content.json');
const { 
    isProKey, 
    gptKeyboard, 
    premiumMsg, 
    resolvePModelByKey 
} = require('../../lib/models');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; 

// СЛОВАРЬ ИМЕН МОДЕЛЕЙ
const MODEL_NAMES = {
    'gpt5mini': 'GPT-5 Mini',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4o': 'GPT-4 Omni',
    'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
    'deepseek-chat': 'DeepSeek V3',
    'deepseek-r1': 'DeepSeek R1',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
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
        // 1. ЗАГРУЗКА ДАННЫХ (ИСПРАВЛЕНО ПОД ТВОЙ STORE.JS)
        // Мы загружаем модель и язык отдельными функциями
        let savedModel = null;
        let savedLang = null;

        try {
            if (store.getUserModel) savedModel = await store.getUserModel(userId);
            if (store.getUserLang) savedLang = await store.getUserLang(userId);
            
            console.log(`[DEBUG] User ${userId} loaded: Model=${savedModel}, Lang=${savedLang}`);
        } catch (e) {
            console.error("[DEBUG] DB Load Error:", e);
        }

        const userData = {
            model: savedModel || 'gpt5mini',
            language: savedLang || 'ru'
        };

        const lang = userData.language;
        
        // Получаем историю
        let history = [];
        if (store.getHistory) history = await store.getHistory(userId) || [];

        // 2. ОПРЕДЕЛЕНИЕ ИМЕНИ
        const modelKey = userData.model;
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

        // 3. СОХРАНЕНИЕ ИСТОРИИ (ИСПРАВЛЕНО ПОД ТВОЙ STORE.JS)
        // У тебя функция называется pushMessage, а не addToHistory
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

async function handleModelCallback(ctx, langCode) {
    const data = ctx.callbackQuery.data;
    const key = data.replace('model_', ''); 
    const userId = ctx.from.id.toString();

    // Ищем язык в базе
    let currentLang = langCode;
    try {
        if (store.getUserLang) {
            const l = await store.getUserLang(userId);
            if (l) currentLang = l;
        }
    } catch (e) {}
    
    if (!currentLang) currentLang = 'ru';

    if (isProKey(key)) {
        const hasPremium = false; 
        if (!hasPremium) {
            const msg = premiumMsg(currentLang);
            await ctx.answerCbQuery(msg, { show_alert: true });
            return;
        }
    }

    console.log(`[DEBUG] User ${userId} saving model: ${key}`);
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
                
