/**
 * Обработчик текстовых сообщений
 */

const { sendChatCompletion } = require('../../lib/api/openrouter');
const { prepareContext } = require('../../lib/utils/context');
const { sendLongMessage } = require('../../lib/utils/format');
const { handleApiError } = require('../../lib/utils/errors');
const store = require('../../lib/store');
const models = require('../../lib/models');

/**
 * Обработка текстового сообщения пользователя
 */
async function handleTextMessage(ctx, userMessage) {
  const userId = ctx.from.id.toString();
  const chatId = ctx.chat.id.toString();
  
  try {
    // Показываем индикатор печати
    await ctx.sendChatAction('typing');

    // Получаем текущую модель пользователя
    const userModel = await store.getUserModel(userId);
    const modelId = models.getModelId(userModel);

    // Получаем историю диалога
    let history = await store.getHistory(chatId) || [];

    // Добавляем сообщение пользователя
    history.push({
      role: 'user',
      content: userMessage,
    });

    // Подготавливаем контекст (обрезаем, добавляем system prompt)
    const context = prepareContext(history, {
      mode: 'default',
      maxMessages: 20,
      maxTokens: 8000,
    });

    // Отправляем запрос в OpenRouter
    const response = await sendChatCompletion(context, modelId, {
      temperature: 0.7,
      maxTokens: 4000,
    });

    // Добавляем ответ ассистента в историю
    history.push({
      role: 'assistant',
      content: response.content,
    });

    // Сохраняем обновлённую историю
    await store.saveHistory(chatId, history);

    // Отправляем ответ пользователю (с разбивкой если нужно)
    await sendLongMessage(ctx, response.content, {
      parse_mode: 'Markdown',
    });

    // Логируем использование
    console.log(`[${userId}] Model: ${response.model}, Tokens: ${response.usage?.total_tokens || 'N/A'}`);

  } catch (error) {
    console.error('Text handler error:', error);
    await handleApiError(error, ctx);
  }
}

/**
 * Обработка команды /clear
 */
async function handleClearCommand(ctx) {
  const chatId = ctx.chat.id.toString();
  
  try {
    await store.clearHistory(chatId);
    await ctx.reply('🗑️ Istoricul conversației a fost șters.');
  } catch (error) {
    console.error('Clear command error:', error);
    await ctx.reply('❌ Eroare la ștergerea istoricului.');
  }
}

/**
 * Обработка команды /model
 */
async function handleModelCommand(ctx) {
  const userId = ctx.from.id.toString();
  
  try {
    const currentModel = await store.getUserModel(userId);
    const modelsList = models.getModelsList();

    // Создаём inline кнопки для выбора модели
    const keyboard = [];
    
    for (let i = 0; i < modelsList.length; i += 2) {
      const row = [];
      
      // Первая кнопка в ряду
      const model1 = modelsList[i];
      const isActive1 = model1.id === currentModel;
      row.push({
        text: `${isActive1 ? '✅ ' : ''}${model1.name}`,
        callback_data: `model_${model1.id}`,
      });
      
      // Вторая кнопка в ряду (если есть)
      if (i + 1 < modelsList.length) {
        const model2 = modelsList[i + 1];
        const isActive2 = model2.id === currentModel;
        row.push({
          text: `${isActive2 ? '✅ ' : ''}${model2.name}`,
          callback_data: `model_${model2.id}`,
        });
      }
      
      keyboard.push(row);
    }

    const currentModelName = models.getModelName(currentModel);
    
    await ctx.reply(
      `🤖 *Modelul curent:* ${currentModelName}\n\n` +
      `Selectează un model nou:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard,
        },
      }
    );

  } catch (error) {
    console.error('Model command error:', error);
    await ctx.reply('❌ Eroare la afișarea modelelor.');
  }
}

/**
 * Обработка callback выбора модели
 */
async function handleModelCallback(ctx) {
  const userId = ctx.from.id.toString();
  const callbackData = ctx.callbackQuery.data;
  
  try {
    // Извлекаем ID модели из callback_data
    const modelId = callbackData.replace('model_', '');
    
    // Проверяем существует ли модель
    if (!models.modelExists(modelId)) {
      await ctx.answerCbQuery('❌ Model invalid');
      return;
    }

    // Сохраняем выбор пользователя
    await store.setUserModel(userId, modelId);
    
    const modelName = models.getModelName(modelId);
    
    // Обновляем сообщение
    await ctx.editMessageText(
      `✅ *Model schimbat cu succes!*\n\n` +
      `Modelul activ: *${modelName}*\n\n` +
      `Poți începe conversația acum.`,
      {
        parse_mode: 'Markdown',
      }
    );

    await ctx.answerCbQuery(`✅ ${modelName}`);

  } catch (error) {
    console.error('Model callback error:', error);
    await ctx.answerCbQuery('❌ Eroare la schimbarea modelului');
  }
}

/**
 * Получение статистики использования
 */
async function getUsageStats(userId) {
  try {
    const history = await store.getHistory(userId);
    
    if (!history || history.length === 0) {
      return {
        messageCount: 0,
        totalTokens: 0,
      };
    }

    const { estimateTokens } = require('../../lib/utils/context');
    
    return {
      messageCount: history.length,
      totalTokens: estimateTokens(history),
    };

  } catch (error) {
    console.error('Get usage stats error:', error);
    return { messageCount: 0, totalTokens: 0 };
  }
}

module.exports = {
  handleTextMessage,
  handleClearCommand,
  handleModelCommand,
  handleModelCallback,
  getUsageStats,
};
