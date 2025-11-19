const store = require('../../lib/store');
const content = require('../../content.json');
const { 
    isProKey, 
    gptKeyboard, 
    premiumMsg, 
    resolvePModelByKey 
} = require('../../lib/models');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; 

// СЛОВАРЬ ИМЕН
const MODEL_NAMES = {
    'gpt5mini': 'GPT-5 Mini',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4o': 'GPT-4 Omni',
    'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
    'deepseek-chat': 'DeepSeek V3.2',
    'deepseek': 'DeepSeek V3.2',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-flash': 'Gemini 2.5 Flash',
    'gemini': 'Gemini 2.5 Pro',
    'gemini-pro': 'Gemini 2.5 Pro'
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
        // 1. Загрузка настроек
        let savedModel = 'gpt5mini';
        let savedLang = 'ru';

        try {
            if (store.getUserModel && store.getUserLang) {
                const [m, l] = await Promise.all([
                    store.getUserModel(userId),
                    store.getUserLang(userId)
                ]);
                if (m) savedModel = m;
                if (l) savedLang = l;
            }
        } catch (e) {
            console.error("[DEBUG] DB Load Error:", e);
        }

        const userData = { model: savedModel, language: savedLang };
        const lang = userData.language;
        
        // 2. ЗАГРУЗКА ИСТОРИИ
        let history = [];
        if (store.getHistory) {
            history = await store.getHistory(userId) || [];
            console.log(`[DEBUG] User ${userId} context size: ${history.length}`);
        }

        // 3. ФОРМИРОВАНИЕ ПРОМПТА (С УПОРОМ НА ПАМЯТЬ)
        const modelKey = userData.model;
        const niceModelName = MODEL_NAMES[modelKey] || modelKey;

        const systemPrompt = {
            role: "system",
            content: `You are a helpful AI assistant running on the "${niceModelName}" model.
            
            SYSTEM INSTRUCTIONS:
            1. CONTEXT: The messages above are the conversation history. USE IT to answer questions like "what did I just say?" or "repeat that".
            2. IDENTITY: If asked, you are ${niceModelName}.
            3. LANGUAGE: Reply in the SAME language as the user's message.
            4. FALLBACK: Only use ${lang === 'ru' ? 'Russian' : lang === 'ro' ? 'Romanian' : 'English'} if language is unclear.`
        };

        // Собираем массив: Система -> История -> Текущий вопрос
        const messagesToSend = [
            systemPrompt,
            ...history, 
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

        // 4. СОХРАНЕНИЕ ИСТОРИИ (БЕЗОПАСНОЕ)
        if (store.updateConversation) {
            await store.updateConversation(
                userId, 
                { role: "user", content: text }, 
                { role: "assistant", content: aiResponse }
            );
        }

    } catch (error) {
        console.error('Handle Text Error:', error);
        await ctx.reply('❌ Error.');
    }
}

async function handleClearCommand(ctx) {
    const userId = ctx.from.id.toString();
    if (store.clearHistory) await store.clearHistory(userId);
    await ctx.reply('🗑️ History cleared / История очищена.');
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

    let currentLang = langCode;
    try {
        if (!currentLang && store.getUserLang) {
            currentLang = await store.getUserLang(userId);
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

    // Смена модели ОЧИЩАЕТ историю, чтобы не путать разные ИИ
    if (store.clearHistory) await store.clearHistory(userId);

    if (store.setUserModel) await store.setUserModel(userId, key);

    try {
        const keyboard = gptKeyboard(currentLang, key, () => false);
        await ctx.editMessageReplyMarkup(keyboard); 
    } catch (e) {}

    const niceName = MODEL_NAMES[key] || key;
    
    let replyText = "";
    if (currentLang === 'ru') {
        replyText = `Вы выбрали модель ${niceName}. История диалога сброшена для корректной работы.`;
    } else if (currentLang === 'ro') {
        replyText = `Ai selectat modelul ${niceName}. Istoricul a fost resetat pentru o funcționare corectă.`;
    } else {
        replyText = `You selected model ${niceName}. History reset for better performance.`;
    }
    
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
