const store = require('../../lib/store');
const content = require('../../content.json');
const { 
    GPT_MODELS, // Подключаем наш новый список
    isProKey, 
    isVisionModel, // Новая функция проверки зрения
    gptKeyboard, 
    premiumMsg, 
    resolvePModelByKey 
} = require('../../lib/models');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; 

// Безопасный разделитель
const FOOTER_MSG = {
  ru: "\n\n➖➖➖➖➖➖\n🔄 Сменить модель: /model | ⚙️ Настройки: /settingsbot",
  ro: "\n\n➖➖➖➖➖➖\n🔄 Schimbă modelul: /model | ⚙️ Setări: /settingsbot",
  en: "\n\n➖➖➖➖➖➖\n🔄 Change model: /model | ⚙️ Settings: /settingsbot"
};

// Вспомогательная: Получить красивое имя модели
function getModelNiceName(key, lang = 'ru') {
    const m = GPT_MODELS.find(x => x.key === key);
    if (!m) return key;
    return m.label[lang] || m.label.en || m.key;
}

// --- AI SERVICE ---
async function chatWithAI(messages, modelKey) {
    if (!OPENROUTER_API_KEY) return "NO_KEY";
    // Получаем реальный ID (например, openai/gpt-5-image-mini)
    const pmodel = resolvePModelByKey(modelKey) || 'deepseek/deepseek-chat';
    
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
                // Температура 0.7 хороша для креатива, но для кода лучше ниже.
                // Пока оставляем универсальную.
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

// --- MAIN HANDLER ---
async function handleTextMessage(ctx, textInput) {
    // Проверка: есть ли текст или подпись, или это просто картинка без текста
    const text = textInput || (ctx.message?.caption) || '';
    
    // Если текста нет и картинки нет - выходим
    if (!text && !ctx.message?.photo && !ctx.message?.document) return;
    
    const userId = ctx.from.id.toString();

    // --- DEBUG COMMAND ---
    if (text === '/debug') {
        if (store.getDebugData) {
            const debugInfo = await store.getDebugData(userId);
            await ctx.reply(`🐞 DEBUG INFO:\n\n${debugInfo}`);
        } else {
            await ctx.reply('Debug function not found.');
        }
        return;
    }

    await ctx.sendChatAction('typing');

    try {
        // 1. Загружаем данные юзера
        let savedModel = 'deepseek'; // Новый дефолт
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
        } catch (e) {}

        const userData = { model: savedModel, language: savedLang };
        const lang = userData.language;

        // 2. ОБРАБОТКА КАРТИНКИ (VISION LOGIC)
        let photoUrl = null;
        
        // Проверяем, прислал ли юзер фото
        if (ctx.message && ctx.message.photo) {
            // Берем самое большое фото из массива
            const photos = ctx.message.photo;
            const fileId = photos[photos.length - 1].file_id;
            try {
                const url = await ctx.telegram.getFileLink(fileId);
                photoUrl = url.href;
                console.log(`[Vision] Got photo URL for user ${userId}`);
            } catch (e) {
                console.error("GetFileLink Error:", e);
            }
        }

        // 3. УМНЫЙ МАРШРУТИЗАТОР (AUTO-SWITCH)
        let modelToUse = userData.model;
        
        // Если есть фото, но текущая модель СЛЕПАЯ (vision: false)
        if (photoUrl && !isVisionModel(modelToUse)) {
            console.log(`[Auto-Switch] Model ${modelToUse} is blind. Switching to Gemini Flash.`);
            modelToUse = 'gemini_flash'; // Подменяем на бесплатную Gemini
        }

        // 4. Загружаем историю
        let history = [];
        if (store.getHistory) {
            history = await store.getHistory(userId) || [];
        }

        // 5. Формируем Системный Промпт
        const niceModelName = getModelNiceName(modelToUse, lang);
        const systemPrompt = {
            role: "system",
            content: `You are a helpful AI assistant running on the "${niceModelName}" model.
            
            MEMORY: Use the conversation history above to answer context questions.
            LANGUAGE: Reply in the SAME language as the user's message.
            VISION: If an image is provided, describe it or answer questions about it.`
        };

        // 6. Формируем Сообщение Юзера
        let userMessageContent;

        if (photoUrl) {
            // Формат OpenRouter для картинок (Multimodal)
            userMessageContent = [
                { type: "text", text: text || (lang === 'ru' ? "Что на картинке?" : "Describe this image") },
                { type: "image_url", image_url: { url: photoUrl } }
            ];
        } else {
            // Обычный текст
            userMessageContent = text;
        }

        const messagesToSend = [
            systemPrompt,
            ...history, 
            { role: "user", content: userMessageContent }
        ];

        // 7. Отправляем запрос
        const aiResponse = await chatWithAI(messagesToSend, modelToUse);

        if (aiResponse === "NO_KEY") { await ctx.reply("⚙️ API Key missing."); return; }
        if (!aiResponse) { await ctx.reply("⚠️ AI Service Error."); return; }

        const footer = FOOTER_MSG[lang] || FOOTER_MSG.en;
        await ctx.reply(aiResponse + footer);

        // 8. Сохраняем в историю (только текст, чтобы не ломать базу ссылками)
        if (store.updateConversation) {
            const historyText = photoUrl ? `[Photo] ${text}` : text;
            await store.updateConversation(
                userId, 
                { role: "user", content: historyText }, 
                { role: "assistant", content: aiResponse }
            );
        }

    } catch (error) {
        console.error('Handle Text Error:', error);
        await ctx.reply('❌ Error.');
    }
}

// --- КОМАНДЫ (Остаются без изменений) ---

async function handleClearCommand(ctx) {
    const userId = ctx.from.id.toString();
    if (store.clearHistory) await store.clearHistory(userId);
    await ctx.reply('🗑️ History cleared.');
}

async function handleModelCommand(ctx) {
    const userId = ctx.from.id.toString();
    let lang = 'ru';
    let model = 'deepseek'; // Новый дефолт
    try {
        if (store.getUserLang) lang = await store.getUserLang(userId) || 'ru';
        if (store.getUserModel) model = await store.getUserModel(userId) || 'deepseek';
    } catch(e){}

    const menuText = content.gpt_menu[lang] || content.gpt_menu.en;
    const keyboard = gptKeyboard(lang, model, () => false);
    await ctx.reply(menuText, { parse_mode: 'Markdown', reply_markup: keyboard });
}

async function handleModelCallback(ctx, langCode) {
    const data = ctx.callbackQuery.data;
    const key = data.replace('model_', ''); 
    const userId = ctx.from.id.toString();

    let currentLang = langCode || 'ru';
    try {
        if (!langCode && store.getUserLang) currentLang = await store.getUserLang(userId) || 'ru';
    } catch (e) {}

    if (isProKey(key)) {
        const hasPremium = false; 
        if (!hasPremium) {
            const msg = premiumMsg(currentLang);
            await ctx.answerCbQuery(msg, { show_alert: true });
            return;
        }
    }

    if (store.clearHistory) await store.clearHistory(userId);
    if (store.setUserModel) await store.setUserModel(userId, key);

    try {
        const keyboard = gptKeyboard(currentLang, key, () => false);
        await ctx.editMessageReplyMarkup(keyboard); 
    } catch (e) {}

    const niceName = getModelNiceName(key, currentLang);
    
    let replyText = (currentLang === 'ru') 
        ? `Вы выбрали модель ${niceName}. История диалога сброшена.` 
        : `You selected model ${niceName}. History reset.`;

    await ctx.reply(replyText + "\n/settingsbot");
    await ctx.answerCbQuery();
}

module.exports = {
    handleTextMessage,
    handleClearCommand,
    handleModelCommand,
    handleModelCallback
};
                
