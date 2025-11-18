/**
 * Webhook handler для Telegram бота
 * ОБНОВЛЁННАЯ ВЕРСИЯ с модульной структурой
 */

const { Telegraf } = require('telegraf');
const content = require('../content.json');
const store = require('../lib/store');

// Импортируем handlers
const {
  handleTextMessage,
  handleClearCommand,
  handleModelCommand,
  handleModelCallback,
} = require('./handlers/text');

// Инициализация бота
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

/**
 * Команда /start
 */
bot.command('start', async (ctx) => {
  const userId = ctx.from.id.toString();
  
  // Инициализируем пользователя с дефолтной моделью
  const currentModel = await store.getUserModel(userId);
  if (!currentModel) {
    await store.setUserModel(userId, 'gpt-4o-mini');
  }

  await ctx.reply(content.welcome, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🤖 AI Chat', callback_data: 'menu_gpt' },
          { text: '🎨 AI Design', callback_data: 'menu_design' },
        ],
        [
          { text: '🎵 AI Audio', callback_data: 'menu_audio' },
          { text: '🎬 AI Video', callback_data: 'menu_video' },
        ],
        [
          { text: '⚙️ Setări', callback_data: 'menu_settings' },
          { text: '❓ Ajutor', callback_data: 'menu_help' },
        ],
      ],
    },
  });
});

/**
 * Команда /menu - главное меню
 */
bot.command('menu', async (ctx) => {
  await ctx.reply('📋 *Meniu principal*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🤖 AI Chat', callback_data: 'menu_gpt' },
          { text: '🎨 AI Design', callback_data: 'menu_design' },
        ],
        [
          { text: '🎵 AI Audio', callback_data: 'menu_audio' },
          { text: '🎬 AI Video', callback_data: 'menu_video' },
        ],
        [
          { text: '🔍 Căutare Internet', callback_data: 'menu_search' },
          { text: '📚 Documente', callback_data: 'menu_docs' },
        ],
        [
          { text: '⚙️ Setări', callback_data: 'menu_settings' },
          { text: '❓ Ajutor', callback_data: 'menu_help' },
        ],
      ],
    },
  });
});

/**
 * Команда /gpt - AI Chat меню
 */
bot.command('gpt', async (ctx) => {
  await ctx.reply(content.gpt_menu || '🤖 *AI Chat*\n\nScrie-mi orice și voi răspunde folosind modele AI avansate.', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔄 Schimbă modelul', callback_data: 'action_model' },
          { text: '🗑️ Șterge istoric', callback_data: 'action_clear' },
        ],
        [
          { text: '◀️ Înapoi la meniu', callback_data: 'menu_main' },
        ],
      ],
    },
  });
});

/**
 * Команда /design - AI Design меню (заглушка)
 */
bot.command('design', async (ctx) => {
  await ctx.reply('🎨 *AI Design*\n\n🚧 În dezvoltare...\n\nCurând vei putea genera imagini cu DALL-E 3, Midjourney și Flux!', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '◀️ Înapoi la meniu', callback_data: 'menu_main' }],
      ],
    },
  });
});

/**
 * Команда /audio - AI Audio меню (заглушка)
 */
bot.command('audio', async (ctx) => {
  await ctx.reply('🎵 *AI Audio*\n\n🚧 În dezvoltare...\n\nCurând vei putea genera muzică cu Suno!', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '◀️ Înapoi la meniu', callback_data: 'menu_main' }],
      ],
    },
  });
});

/**
 * Команда /video - AI Video меню (заглушка)
 */
bot.command('video', async (ctx) => {
  await ctx.reply('🎬 *AI Video*\n\n🚧 În dezvoltare...\n\nCurând vei putea genera video cu Kling și RunwayML!', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '◀️ Înapoi la meniu', callback_data: 'menu_main' }],
      ],
    },
  });
});

/**
 * Команда /help
 */
bot.command('help', async (ctx) => {
  await ctx.reply(content.help || '❓ *Ajutor*\n\nComenzile disponibile:\n\n/start - Pornește botul\n/menu - Meniu principal\n/gpt - AI Chat\n/model - Schimbă modelul\n/clear - Șterge istoric\n/help - Ajutor', {
    parse_mode: 'Markdown',
  });
});

/**
 * Команда /model - выбор модели
 */
bot.command('model', handleModelCommand);

/**
 * Команда /clear - очистка истории
 */
bot.command('clear', handleClearCommand);

/**
 * Обработка callback запросов (кнопки)
 */
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  try {
    // Меню навигация
    if (data === 'menu_main') {
      await ctx.editMessageText('📋 *Meniu principal*', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🤖 AI Chat', callback_data: 'menu_gpt' },
              { text: '🎨 AI Design', callback_data: 'menu_design' },
            ],
            [
              { text: '🎵 AI Audio', callback_data: 'menu_audio' },
              { text: '🎬 AI Video', callback_data: 'menu_video' },
            ],
            [
              { text: '🔍 Căutare', callback_data: 'menu_search' },
              { text: '❓ Ajutor', callback_data: 'menu_help' },
            ],
          ],
        },
      });
      await ctx.answerCbQuery();
      return;
    }

    if (data === 'menu_gpt') {
      await ctx.editMessageText('🤖 *AI Chat*\n\nScrie-mi orice și voi răspunde!', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Schimbă modelul', callback_data: 'action_model' },
              { text: '🗑️ Șterge istoric', callback_data: 'action_clear' },
            ],
            [{ text: '◀️ Înapoi', callback_data: 'menu_main' }],
          ],
        },
      });
      await ctx.answerCbQuery();
      return;
    }

    if (data === 'menu_design') {
      await ctx.editMessageText('🎨 *AI Design*\n\n🚧 În dezvoltare...', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Înapoi', callback_data: 'menu_main' }]],
        },
      });
      await ctx.answerCbQuery();
      return;
    }

    if (data === 'menu_audio') {
      await ctx.editMessageText('🎵 *AI Audio*\n\n🚧 În dezvoltare...', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Înapoi', callback_data: 'menu_main' }]],
        },
      });
      await ctx.answerCbQuery();
      return;
    }

    if (data === 'menu_video') {
      await ctx.editMessageText('🎬 *AI Video*\n\n🚧 În dezvoltare...', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Înapoi', callback_data: 'menu_main' }]],
        },
      });
      await ctx.answerCbQuery();
      return;
    }

    if (data === 'menu_help') {
      await ctx.editMessageText(content.help || '❓ *Ajutor*\n\nComenzile disponibile...', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Înapoi', callback_data: 'menu_main' }]],
        },
      });
      await ctx.answerCbQuery();
      return;
    }

    // Действия
    if (data === 'action_model') {
      await handleModelCommand(ctx);
      await ctx.answerCbQuery();
      return;
    }

    if (data === 'action_clear') {
      const chatId = ctx.chat.id.toString();
      await store.clearHistory(chatId);
      await ctx.answerCbQuery('✅ Istoric șters!');
      await ctx.editMessageText('🗑️ Istoricul a fost șters cu succes!', {
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Înapoi', callback_data: 'menu_gpt' }]],
        },
      });
      return;
    }

    // Выбор модели
    if (data.startsWith('model_')) {
      await handleModelCallback(ctx);
      return;
    }

    // Неизвестный callback
    await ctx.answerCbQuery('🤷‍♂️ Acțiune necunoscută');

  } catch (error) {
    console.error('Callback query error:', error);
    await ctx.answerCbQuery('❌ Eroare');
  }
});

/**
 * Обработка текстовых сообщений
 */
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  
  // Игнорируем команды (они обрабатываются отдельно)
  if (text.startsWith('/')) {
    return;
  }

  await handleTextMessage(ctx, text);
});

/**
 * Обработка ошибок
 */
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('❌ A apărut o eroare. Te rog încearcă din nou.').catch(console.error);
});

/**
 * Vercel serverless функция
 */
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } else {
      res.status(200).json({ status: 'Bot is running' });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Экспортируем бот для использования в других модулях
module.exports.bot = bot;
