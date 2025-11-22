const store = require('../../lib/store');
const content = require('../../content.json');
const { 
    GPT_MODELS, 
    isProKey, 
    getModelForTask, 
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

const ASK_FILE_MSG = {
    ru: "🧐 Я вижу файл! Что мне с ним сделать? (Описать, решить задачу или перевести текст?)",
    ro: "🧐 Văd fișierul! Ce dorești să fac cu el? (Să-l descriu, să rezolv o problemă sau să traduc text?)",
    en: "🧐 I see the file! What should I do with it? (Describe it, solve a problem, or translate text?)"
};

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
    const message = ctx.message;
    const caption = message?.caption || '';
    const text = textInput || caption || ''; 
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
        // 1. ЗАГРУЗКА РЕЖИМА И НАСТРОЕК
        let savedModel = 'deepseek'; 
        let savedLang = 'ru';
        let userMode = 'chat'; // По умолчанию чат

        try {
            // Запрашиваем всё параллельно: модель, язык, режим
            const [m, l, mode] = await Promise.all([
                store.getUserModel(userId),
                store.getUserLang(userId),
                store.getUserMode ? store.getUserMode(userId) : 'chat'
            ]);
            if (m) savedModel = m;
            if (l) savedLang = l;
            if (mode) userMode = mode;
        } catch (e) { console.error("DB Load Error", e); }

        const lang = savedLang;

        // --- ВЕТВЛЕНИЕ: ЕСЛИ РЕЖИМ РИСОВАНИЯ ---
        if (userMode === 'image') {
            // Если пользователь прислал текст — это промпт для картинки
            if (text) {
                // TODO: ВСТАВИТЬ СЮДА ВЫЗОВ ФУНКЦИИ ГЕНЕРАЦИИ (Midjourney / Flux)
                // Пока ставим заглушку, чтобы проверить переключение
                await ctx.reply(`🎨 *Generating Image...*\n\nPrompt: _${text}_\n\n(Здесь будет вызов API Midjourney/Flux)`, { parse_mode: 'Markdown' });
                return; // ВАЖНО: Прерываем выполнение, чтобы не идти в GPT
            }
        }

        // 2. ОБРАБОТКА ФАЙЛОВ (ТОЛЬКО ДЛЯ ЧАТА)
        // (Этот блок работает только если мы НЕ в режиме рисования или если режим рисования не сработал)
        
        let fileUrl = null;
        let fileType = 'text'; 
        const pendingKey = `pending_file:${userId}`;
        
        // ... (Код обработки файлов оставляем без изменений)
        const isPhoto = message?.photo;
        const isVoice = message?.voice || message?.audio;
        const isVideo = message?.video || message?.video_note;
        const isDoc = message?.document;

        if (isPhoto || isVoice || isVideo || isDoc) {
             // ... (Тот же код, что и был для загрузки файла)
             try {
                let fileId = null;
                if (isPhoto) { fileId = message.photo[message.photo.length - 1].file_id; fileType = 'image'; }
                else if (isVoice) { fileId = (message.voice || message.audio).file_id; fileType = 'audio'; }
                else if (isVideo) { fileId = (message.video || message.video_note).file_id; fileType = 'video'; }
                else if (isDoc) { fileId = message.document.file_id; fileType = 'doc'; }

                if (fileId) {
                    const urlObj = await ctx.telegram.getFileLink(fileId);
                    fileUrl = urlObj.href;
                    if (!text) {
                        if (store.redis) await store.redis.set(pendingKey, { url: fileUrl, type: fileType }, { ex: 300 });
                        const askText = ASK_FILE_MSG[lang] || ASK_FILE_MSG.en;
                        await ctx.reply(askText);
                        return;
                    }
                }
            } catch (e) { console.error("File processing error:", e); }
        } else if (text && store.redis) {
            const pending = await store.redis.get(pendingKey);
            if (pending) { fileUrl = pending.url; fileType = pending.type; await store.redis.del(pendingKey); }
        }

        if (!text && !fileUrl) return;

        // 3. УМНЫЙ МАРШРУТИЗАТОР (AUTO-SWITCH)
        let modelToUse = savedModel;
        
        // ... (Оставляем логику выбора модели для файлов)
        if (fileType === 'audio') modelToUse = getModelForTask('audio_input') || 'gemini_flash';
        else if (fileType === 'video') modelToUse = getModelForTask('video_input') || 'gemini_flash';
        else if (fileType === 'doc') modelToUse = getModelForTask('doc_heavy') || 'gemini_lite';
        else if (fileType === 'image') {
             // Простейшая проверка: если модель не видит, переключаем на Gemini
             // (Нужно убедиться, что isVisionModel импортирована корректно, либо убрать, если её нет)
             modelToUse = 'gemini_flash'; // Пока жестко ставим зрячую, для надежности
        }

        // 4. ЗАГРУЗКА ИСТОРИИ
        let history = [];
        if (store.getHistory) history = await store.getHistory(userId) || [];

        // 5. СИСТЕМНЫЙ ПРОМПТ
        const niceModelName = getModelNiceName(modelToUse, lang);
        const systemPrompt = {
            role: "system",
            content: `You are a helpful AI assistant running on "${niceModelName}". Reply in the SAME language as the user.`
        };

        // 6. СБОРКА СООБЩЕНИЯ
        let userMessageContent;
        if (fileUrl) {
            userMessageContent = [
                { type: "text", text: text || "Describe this." },
                { type: "image_url", image_url: { url: fileUrl } }
            ];
        } else {
            userMessageContent = text;
        }

        const messagesToSend = [
            systemPrompt,
            ...history, 
            { role: "user", content: userMessageContent }
        ];

        // 7. ЗАПРОС К ИИ
        const aiResponse = await chatWithAI(messagesToSend, modelToUse);

        if (aiResponse === "NO_KEY") { await ctx.reply("⚙️ API Key missing."); return; }
        if (!aiResponse) { await ctx.reply("⚠️ AI Service Error."); return; }

        const footer = FOOTER_MSG[lang] || FOOTER_MSG.en;
        await ctx.reply(aiResponse + footer);

        // 8. СОХРАНЕНИЕ
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

// ... (Остальные функции handleClearCommand, handleModelCommand и т.д. остаются без изменений)
async function handleClearCommand(ctx) {
    const userId = ctx.from.id.toString();
    if (store.clearHistory) await store.clearHistory(userId);
    await ctx.reply('🗑️ History cleared.');
}

async function handleModelCommand(ctx) {
    const userId = ctx.from.id.toString();
    let lang = 'ru';
    let model = 'deepseek'; 
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
