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

// --- ЛИМИТЫ (10 запросов в день) ---
const DAILY_LIMIT = 10;

async function checkAndIncrementLimit(userId) {
    if (!store.redis) return true; // Если Redis нет, лимитов нет (бесконечно)
    
    // Получаем текущую дату (чтобы сбрасывать каждый день)
    const today = new Date().toISOString().split('T')[0]; // 2023-10-25
    const key = `usage:${today}:${userId}`;
    
    // Получаем текущее использование
    let current = await store.redis.get(key);
    current = parseInt(current) || 0;

    if (current >= DAILY_LIMIT) {
        return false; // Лимит исчерпан
    }

    // Увеличиваем счетчик (+1) и ставим жизнь ключа 24 часа
    await store.redis.incr(key);
    await store.redis.expire(key, 86400); 
    
    // Обновляем общий счетчик в профиле (для команды /account)
    await store.redis.incr(`usage:text:${userId}`); 
    
    return true;
}

// --- ПОЛУЧЕНИЕ КРАСИВОГО ИМЕНИ ---
function getModelNiceName(key, lang = 'ru') {
    const m = GPT_MODELS.find(x => x.key === key);
    if (!m) return key;
    return m.label[lang] || m.label.en || m.key;
}

// --- СЕРВИС ГЕНЕРАЦИИ (Chat & Image) ---
async function openRouterRequest(messages, modelId) {
    if (!OPENROUTER_API_KEY) return null;
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
                "model": modelId,
                "messages": messages,
                "temperature": 0.7
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("OpenRouter Error:", errText);
            return "ERROR";
        }
        
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error("Fetch Error:", error);
        return "ERROR";
    }
}

// --- MAIN HANDLER ---
async function handleTextMessage(ctx, textInput) {
    const message = ctx.message;
    const caption = message?.caption || '';
    const text = textInput || caption || ''; 
    const userId = ctx.from.id.toString();

    // --- DEBUG ---
    if (text === '/debug') {
        if (store.getDebugData) {
            const debugInfo = await store.getDebugData(userId);
            await ctx.reply(`🐞 DEBUG INFO:\n\n${debugInfo}`);
        } else await ctx.reply('Debug not found.');
        return;
    }

    await ctx.sendChatAction('typing');

    try {
        // 1. ЗАГРУЗКА ДАННЫХ
        let savedModel = 'deepseek'; 
        let savedLang = 'ru';
        let userMode = 'chat';

        try {
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

        // 2. ПРОВЕРКА ЛИМИТОВ (ГЛОБАЛЬНАЯ)
        const isAllowed = await checkAndIncrementLimit(userId);
        if (!isAllowed) {
            const limitMsg = (lang === 'ru') 
                ? "⛔️ **Лимит исчерпан**\nВы использовали 10 бесплатных запросов на сегодня.\nКупите /premium для безлимита."
                : "⛔️ **Daily Limit Reached**\nYou used 10 free requests today.\nBuy /premium for unlimited access.";
            await ctx.reply(limitMsg, { parse_mode: 'Markdown' });
            return;
        }

        // --- ВЕТКА: РИСОВАНИЕ ---
        if (userMode === 'image') {
            if (text) {
                // Отправляем уведомление (без повтора промпта)
                const waitMsg = await ctx.reply("🎨 Generating...");
                
                // Маппинг моделей для рисования
                // gpt5mini (бесплатная) -> flux-1-schnell (быстрая и дешевая)
                // flux (премиум) -> flux-1-dev (качественная)
                let imageModel = 'black-forest-labs/flux-1-schnell'; 
                
                // Если пользователь выбрал другую модель в меню (логику добавим позже), можно менять здесь
                
                const prompt = `Generate an image: ${text}`;
                
                // Запрос к API
                const result = await openRouterRequest([{ role: "user", content: prompt }], imageModel);

                // Удаляем сообщение "Generating..."
                try { await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id); } catch(e){}

                if (!result || result === "ERROR") {
                    await ctx.reply("⚠️ Image Generation Error. Try again.");
                    return;
                }

                // Flux на OpenRouter возвращает ссылку на изображение в Markdown: ![image](url)
                // Нам нужно вытащить URL
                const urlMatch = result.match(/\((https?:\/\/[^\)]+)\)/);
                
                if (urlMatch && urlMatch[1]) {
                    const imageUrl = urlMatch[1];
                    await ctx.replyWithPhoto(imageUrl, { caption: `🖼 Generated by ${imageModel}` });
                } else {
                    // Если ссылка не нашлась, кидаем ответ текстом (иногда там описание ошибки)
                    await ctx.reply(result);
                }
                return; 
            }
        }

        // 3. ОБРАБОТКА ФАЙЛОВ (CHAT MODE)
        let fileUrl = null;
        let fileType = 'text'; 
        const pendingKey = `pending_file:${userId}`;
        
        const isPhoto = message?.photo;
        const isVoice = message?.voice || message?.audio;
        const isVideo = message?.video || message?.video_note;
        const isDoc = message?.document;

        if (isPhoto || isVoice || isVideo || isDoc) {
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
            } catch (e) { console.error("File error:", e); }
        } else if (text && store.redis) {
            const pending = await store.redis.get(pendingKey);
            if (pending) { fileUrl = pending.url; fileType = pending.type; await store.redis.del(pendingKey); }
        }

        if (!text && !fileUrl) return;

        // 4. МАРШРУТИЗАТОР (CHAT MODE)
        let modelToUse = savedModel;
        const pmodel = resolvePModelByKey(modelToUse);
        
        if (fileType === 'audio') modelToUse = getModelForTask('audio_input');
        else if (fileType === 'video') modelToUse = getModelForTask('video_input');
        else if (fileType === 'doc') modelToUse = getModelForTask('doc_heavy');
        else if (fileType === 'image') {
             // Если текущая модель не поддерживает зрение, переключаем на Gemini
             // (Упрощенная проверка, можно улучшить)
             if (!pmodel.includes('gpt-4o') && !pmodel.includes('gemini') && !pmodel.includes('claude-3-5')) {
                 modelToUse = 'gemini_flash';
             }
        }

        // 5. ИСТОРИЯ
        let history = [];
        if (store.getHistory) history = await store.getHistory(userId) || [];

        // 6. ЗАПРОС
        const niceModelName = getModelNiceName(modelToUse, lang);
        const systemPrompt = {
            role: "system",
            content: `You are a helpful AI assistant running on "${niceModelName}". Reply in the SAME language as the user.`
        };

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

        // Используем реальный ID модели
        const realModelId = resolvePModelByKey(modelToUse) || 'deepseek/deepseek-chat';
        const aiResponse = await openRouterRequest(messagesToSend, realModelId);

        if (!aiResponse || aiResponse === "ERROR") { await ctx.reply("⚠️ AI Service Error."); return; }

        const footer = FOOTER_MSG[lang] || FOOTER_MSG.en;
        await ctx.reply(aiResponse + footer);

        // 7. СОХРАНЕНИЕ
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
        
