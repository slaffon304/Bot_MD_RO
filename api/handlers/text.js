const store = require('../../lib/store');
// Импорт списка моделей и утилит
const { 
    isProKey, 
    gptKeyboard, 
    premiumMsg, 
    resolvePModelByKey 
} = require('../../lib/models');

// --- КОНФИГУРАЦИЯ ---
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; // Убедись, что ключ есть в Vercel
const SITE_URL = process.env.VERCEL_URL || 'https://bot-domain.vercel.app';
const APP_NAME = 'Telegram AI Bot';

// Сообщения при смене модели
const MODEL_CHANGE_MSG = {
  ru: "✅ Модель изменена.\nВыбранная модель настроена на обычный стиль общения. Настроить другие параметры (креативность, роль) можно в /settings.",
  ro: "✅ Model schimbat.\nModelul selectat este setat la stil normal de comunicare. Poți configura alți parametri în /settings.",
  en: "✅ Model changed.\nThe selected model is set to normal communication style. You can configure other parameters in /settings."
};

/**
 * Функция прямого запроса к LLM (OpenRouter)
 * Поддерживает все модели: GPT, Claude, DeepSeek, Gemini
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
                // Параметры для стабильности
                "temperature": 0.7, 
                "max_tokens": 2000
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`API Error: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error("AI Request Failed:", error);
        return null;
    }
}

/**
 * ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
 */
async function handleTextMessage(ctx, text) {
    // 1. Игнорируем пустые сообщения
    if (!text || text.trim().length === 0) return;

    const userId = ctx.from.id.toString();
    
    // 2. Показываем статус "печатает..."
    await ctx.sendChatAction('typing');

    try {
        // 3. Получаем настройки пользователя
        // Используем getUserModel или дефолт
        let modelKey = 'gpt5mini';
        if (store.getUserModel) {
            modelKey = await store.getUserModel(userId) || 'gpt5mini';
        }

        // 4. Формируем историю сообщений
        let history = [];
        if (store.getHistory) {
            history = await store.getHistory(userId) || [];
        }

        // --- ВАЖНО: СИСТЕМНЫЙ ПРОМПТ ---
        // Инструкция отвечать на языке пользователя
        const systemPrompt = {
            role: "system",
            content: "You are a helpful and intelligent AI assistant. IMPORTANT INSTRUCTION: Always detect the language of the user's latest message and reply in that SAME language. If the user asks in Romanian, reply in Romanian. If in Russian, reply in Russian. Keep formatting clean (Markdown)."
        };

        // Собираем массив для отправки: System + History + New Message
        // Ограничиваем историю последними 10 сообщениями, чтобы не превысить лимиты
        const messagesToSend = [
            systemPrompt,
            ...history.slice(-10), 
            { role: "user", content: text }
        ];

        // 5. Отправляем запрос нейросети
        const aiResponse = await chatWithAI(messagesToSend, modelKey);

        if (!aiResponse) {
            await ctx.reply('⚠️ Error: AI service is currently unavailable. Try again later.');
            return;
        }

        // 6. Отправляем ответ пользователю
        await ctx.reply(aiResponse, { parse_mode: 'Markdown' });

        // 7. Сохраняем в историю (если есть store)
        if (store.addToHistory) {
            await store.addToHistory(userId, { role: "user", content: text });
            await store.addToHistory(userId, { role: "assistant", content: aiResponse });
        }

    } catch (error) {
        console.error('Handle Text Error:', error);
        await ctx.reply('❌ An error occurred while processing your request.');
    }
}

/**
 * ОЧИСТКА ИСТОРИИ
 */
async function handleClearCommand(ctx) {
    const userId = ctx.from.id.toString();
    if (store.clearHistory) {
        await store.clearHistory(userId);
    }
    await ctx.reply('🗑️ Context cleared. Starting new conversation.');
}

/**
 * КОМАНДА /model
 */
async function handleModelCommand(ctx) {
    await ctx.reply('Please use /menu -> AI Chat to select a model.');
}

/**
 * ОБРАБОТКА НАЖАТИЙ НА КНОПКИ МОДЕЛЕЙ (CALLBACK)
 */
async function handleModelCallback(ctx, langCode = 'ru') {
    const data = ctx.callbackQuery.data;
    const key = data.replace('model_', ''); 
    const userId = ctx.from.id.toString();

    // 1. Проверка Premium
    if (isProKey(key)) {
        const hasPremium = false; // ЗАГЛУШКА: Замени на проверку из БД
        if (!hasPremium) {
            const msg = premiumMsg(langCode);
            await ctx.answerCbQuery(msg, { show_alert: true });
            return;
        }
    }

    // 2. Сохранение выбора
    if (store.setUserModel) {
        await store.setUserModel(userId, key);
    }

    // 3. Обновление галочки в меню
    try {
        const hasPremiumFn = () => false; 
        const keyboard = gptKeyboard(langCode, key, hasPremiumFn);
        await ctx.editMessageReplyMarkup(keyboard.reply_markup);
    } catch (e) {
        // Игнорируем, если клавиатура не изменилась
    }

    // 4. Инфо-сообщение пользователю
    const infoText = MODEL_CHANGE_MSG[langCode] || MODEL_CHANGE_MSG.en;
    
    // Чтобы не спамить, можно использовать answerCbQuery с текстом (всплывашка сверху)
    // Или сообщение в чат, как ты просил:
    await ctx.reply(infoText);
    
    await ctx.answerCbQuery();
}

module.exports = {
    handleTextMessage,
    handleClearCommand,
    handleModelCommand,
    handleModelCallback
};
        
