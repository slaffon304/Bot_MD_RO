/**
 * Обработка ошибок для бота
 */

class BotError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR') {
    super(message);
    this.code = code;
    this.name = 'BotError';
  }
}

/**
 * Обработка ошибок API
 */
async function handleApiError(error, ctx) {
  console.error('API Error:', error);

  let message = '❌ A apărut o eroare. Te rog încearcă din nou.';

  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    message = '⏱️ Cererea a expirat. Te rog încearcă din nou.';
  } else if (error.message?.includes('rate limit')) {
    message = '🚫 Prea multe cereri. Te rog așteaptă un pic.';
  } else if (error.message?.includes('API key')) {
    message = '🔑 Problemă cu autentificarea API. Contactează administratorul.';
  } else if (error.message?.includes('context length')) {
    message = '📏 Conversația este prea lungă. Folosește /clear pentru a reseta.';
  }

  await ctx.reply(message);
}

/**
 * Обработка ошибок Telegram
 */
async function handleTelegramError(error, ctx) {
  console.error('Telegram Error:', error);

  if (error.description?.includes('message is too long')) {
    // Сообщение слишком длинное - разбиваем
    return { shouldSplit: true };
  } else if (error.description?.includes('bot was blocked')) {
    console.log('Bot was blocked by user:', ctx.from?.id);
    return { blocked: true };
  }

  return { unknown: true };
}

/**
 * Безопасное выполнение с обработкой ошибок
 */
async function safeExecute(fn, ctx, fallbackMessage = '❌ A apărut o eroare.') {
  try {
    return await fn();
  } catch (error) {
    console.error('Safe Execute Error:', error);
    
    if (ctx) {
      await handleApiError(error, ctx);
    }
    
    return null;
  }
}

/**
 * Проверка доступности API
 */
async function checkApiHealth(apiUrl, apiKey) {
  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(5000), // 5 секунд таймаут
    });

    return response.ok;
  } catch (error) {
    console.error('API Health Check Failed:', error);
    return false;
  }
}

module.exports = {
  BotError,
  handleApiError,
  handleTelegramError,
  safeExecute,
  checkApiHealth,
};
