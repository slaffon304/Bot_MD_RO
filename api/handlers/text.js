const store = require('../../lib/store');
const content = require('../../content.json');
const { 
    GPT_MODELS, 
    isProKey, 
    isVisionModel, 
    getModelForTask, // Новая функция для выбора спец-моделей
    gptKeyboard, 
    premiumMsg, 
    resolvePModelByKey 
} = require('../../lib/models');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; 

const FOOTER_MSG = {
  ru: "\n\n➖➖➖➖➖➖\n🔄 Сменить модель: /model | ⚙️ Настройки: /settingsbot",
  ro: "\n\n➖➖➖➖➖➖\n🔄 Schimbă modelul: /model | ⚙️ Setări: /settingsbot",
  en: "\n\n➖➖➖➖➖➖\n🔄 Change model: /model | ⚙️ Settings: /settingsbot"
};

// Получить красивое имя модели
function getModelNiceName(key, lang = 'ru') {
    const m = GPT_MODELS.find(x => x.key === key);
    if (!m) return key;
    return m.label[lang] || m.label.en || m.key;
}

// --- AI SERVICE ---
async function chatWithAI(messages, modelKey) {
    if (!OPENROUTER_API_KEY) return "NO_KEY";
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
    // Проверяем наличие контента
    const message = ctx.message;
    const caption = message?.caption || '';
    const text = textInput || caption || ''; // Текст может прийти аргументом или быть подписью
    
    // Флаги типов контента
    const isPhoto = message?.photo;
    const isVoice = message?.voice || message?.audio;
    const isVideo = message?.video || message?.video_note;
    const isDoc = message?.document;

    // Если вообще пусто - выходим
    if (!text && !isPhoto && !isVoice && !isVideo && !isDoc) return;
    
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
        // 1. Загружаем данные пользователя
        let savedModel = 'deepseek'; 
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

        // 2. ДОСТАЕМ ФАЙЛ (ЕСЛИ ЕСТЬ)
        let fileUrl = null;
        let fileType = 'text'; // text, image, audio, video
        
        try {
            let fileId = null;
            
            if (isPhoto) {
                fileId = message.photo[message.photo.length - 1].file_id;
                fileType = 'image';
            } else if (isVoice) {
                fileId = (message.voice || message.audio).file_id;
                fileType = 'audio';
            } else if (isVideo) {
                fileId = (message.video || message.video_note).file_id;
                fileType = 'video';
            } else if (isDoc) {
                fileId = message.document.file_id;
                fileType = 'doc';
            }

            if (fileId) {
                const urlObj = await ctx.telegram.getFileLink(fileId);
                fileUrl = urlObj.href;
                console.log(`[Media] Got ${fileType} URL for user ${userId}`);
            }
        } catch (e) {
            console.error("FileLink Error:", e);
        }

        // 3. УМНЫЙ МАРШРУТИЗАТОР (AUTO-SWITCH)
        let modelToUse = userData.model;
        let overrideReason = null;

        // Логика переключения задач
        if (fileType === 'audio') {
            modelToUse = getModelForTask('audio_input') || 'gemini_flash';
            overrideReason = "Audio Processing";
        } else if (fileType === 'video') {
            modelToUse = getModelForTask('video_input') || 'gemini_flash';
            overrideReason = "Video Analysis";
        } else if (fileType === 'doc') {
            modelToUse = getModelForTask('doc_heavy') || 'gemini_lite';
            overrideReason = "Document Analysis";
        } else if (fileType === 'image') {
            // Если это фото, и текущая модель слепая -> переключаем на зрячую
            if (!isVisionModel(modelToUse)) {
                modelToUse = 'gemini_flash'; // Бесплатная смотрелка
                overrideReason = "Vision Fallback";
            }
        }

        if (overrideReason) {
            console.log(`[Router] Switching to ${modelToUse} for ${overrideReason}`);
        }

        // 4. История
        let history = [];
        if (store.getHistory) {
            history = await store.getHistory(userId) || [];
        }

        // 5. Системный Промпт
        const niceModelName = getModelNiceName(modelToUse, lang);
        const systemPrompt = {
            role: "system",
            content: `You are a helpful AI assistant running on the "${niceModelName}" model.
            
            CONTEXT: Use conversation history.
            LANGUAGE: Reply in the SAME language as the user.
            TASK: If a file (image/audio/doc) is provided, analyze it.`
        };

        // 6. Формирование сообщения (Multimodal Payload)
        let userMessageContent;

        if (fileUrl) {
            // Для большинства мультимодальных моделей OpenRouter формат такой:
            // (Для Gemini/GPT-4o это работает, для других может требоваться просто текст с URL)
            userMessageContent = [
                { type: "text", text: text || (lang === 'ru' ? "Проанализируй этот файл." : "Analyze this file.") },
                { type: "image_url", image_url: { url: fileUrl } } 
                // Прим: OpenRouter часто принимает audio/video тоже через image_url или content url, 
                // но для надежности лучше использовать модели, которые точно это умеют (Gemini).
            ];
        } else {
            userMessageContent = text;
        }

        const messagesToSend = [
            systemPrompt,
            ...history, 
            { role: "user", content: userMessageContent }
        ];

        // 7. Отправка
        const aiResponse = await chatWithAI(messagesToSend, modelToUse);

        if (aiResponse === "NO_KEY") { await ctx.reply("⚙️ API Key missing."); return; }
        if (!aiResponse) { await ctx.reply("⚠️ AI Service Error."); return; }

        const footer = FOOTER_MSG[lang] || FOOTER_MSG.en;
        await ctx.reply(aiResponse + footer);

        // 8. Сохранение
        if (store.updateConversation) {
            const historyText = fileUrl ? `[${fileType.toUpperCase()}] ${text}` : text;
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

// --- КОМАНДЫ ---

async function handleClearCommand(ctx) {
    const userId = ctx.from.id.toString();
    if (store.clearHistory) await store.clearHistory(userId);
    await ctx.reply('🗑️ History cleared.');
}

async function handleModelCommand(ctx) {
    const userId = ctx.from.id.toString();
    let lang = 'ru';
    let model = 'deepseek'; // Default
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
    const replyText = (currentLang === 'ru') 
        ? `Вы выбрали модель ${niceName}. История сброшена.` 
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
