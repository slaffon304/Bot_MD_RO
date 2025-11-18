const store = require('../../lib/store');
const content = require('../../content.json');
// Импортируем функции проверки моделей
const { 
    isProKey, 
    gptKeyboard, 
    premiumMsg,
    GPT_MODELS 
} = require('../../lib/models');

// Сообщения при смене модели (можно вынести в content.json)
const MODEL_CHANGE_MSG = {
  ru: "Выбранная модель настроена на обычный стиль общения и креативность (теплота, пояснение для тебя, не включай в сообщение) по умолчанию. Настроить другие параметры можно в /settingsbot.",
  ro: "Modelul selectat este setat la stil normal de comunicare și creativitate implicită. Poți configura alți parametri în /settingsbot.",
  en: "The selected model is set to normal communication style and creativity by default. You can configure other parameters in /settingsbot."
};

async function handleTextMessage(ctx, text) {
    // Твоя логика обработки текста
    // Сюда можно добавить вызов OpenAI/Anthropic
    // Пока заглушка-эхо для теста
    const userId = ctx.from.id.toString();
    const model = await store.getUserModel(userId) || 'gpt5mini';
    
    await ctx.reply(`[${model}] AI думает над: "${text}"... (Логика в разработке)`);
}

async function handleClearCommand(ctx) {
    const userId = ctx.from.id.toString();
    await store.clearHistory(userId);
    await ctx.reply('🗑️ История очищена.');
}

async function handleModelCommand(ctx) {
    await ctx.reply('Используйте меню для выбора модели: /menu');
}

// ГЛАВНАЯ ФУНКЦИЯ: Обработка нажатия на кнопку модели
async function handleModelCallback(ctx, langCode = 'ru') {
    const data = ctx.callbackQuery.data;
    const key = data.replace('model_', ''); // Получаем ключ, например 'gpt4o'
    const userId = ctx.from.id.toString();

    // 1. Проверка: Платная ли модель?
    if (isProKey(key)) {
        // Здесь проверяем, есть ли у юзера премиум (заглушка)
        const hasPremium = false; 

        if (!hasPremium) {
            // Показываем всплывающее окно (Alert) и НЕ меняем модель
            const msg = premiumMsg(langCode);
            await ctx.answerCbQuery(msg, { show_alert: true });
            return;
        }
    }

    // 2. Если модель доступна (бесплатная или куплен премиум)
    
    // Сохраняем выбор
    await store.setUserModel(userId, key);

    // Обновляем клавиатуру (чтобы галочка ✅ переехала)
    try {
        const hasPremiumFn = () => false; // Заглушка
        const keyboard = gptKeyboard(langCode, key, hasPremiumFn);
        
        // Редактируем ТОЛЬКО клавиатуру, текст меню оставляем прежним
        await ctx.editMessageReplyMarkup(keyboard.reply_markup);
    } catch (e) {
        // Игнорируем ошибку, если клавиатура не изменилась (юзер нажал на ту же кнопку)
        console.log('Keyboard update skipped');
    }

    // 3. Отправляем сообщение с подтверждением (как ты просил)
    const infoText = MODEL_CHANGE_MSG[langCode] || MODEL_CHANGE_MSG.ru;
    
    await ctx.reply(infoText);
    
    // Закрываем часики загрузки на кнопке
    await ctx.answerCbQuery();
}

module.exports = {
    handleTextMessage,
    handleClearCommand,
    handleModelCommand,
    handleModelCallback
};
  
