/**
 * Webhook handler для Telegram бота
 * FIX: Исправлен импорт gptKeyboard и логика меню
 */

const { Telegraf, Markup } = require('telegraf');
const content = require('../content.json');
const store = require('../lib/store');
// ВАЖНО: Импорт моделей перенесен наверх
const { gptKeyboard } = require('../lib/models');

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
 * Команда /start - Выбор языка
 */
bot.command('start', async (ctx) => {
  await ctx.reply(content.lang_select, Markup.inlineKeyboard([
    [
      Markup.button.callback('🇹🇩 Română', 'set_lang_ro'),
      Markup.button.callback('🇺🇸 English', 'set_lang_en'),
      Markup.button.callback('🇷🇺 Русский', 'set_lang_ru')
    ]
  ]));
});

// Функция установки языка
const setupLanguage = async (ctx, langCode) => {
  const userId = ctx.from.id.toString();
  
  try {
    // Сохраняем язык, если store это поддерживает (если нет - просто идем дальше)
    if (store.updateUser) {
        await store.updateUser(userId, { language: langCode });
    }
    // Устанавливаем дефолтную модель, если её нет
    const currentModel = await store.getUserModel(userId);
    if (!currentModel) {
      await store.setUserModel(userId, 'gpt5mini');
    }
  } catch (e) {
    console.error('Error saving user data:', e);
  }

  const welcomeText = content.welcome[langCode] || content.welcome.en;
  
  await ctx.editMessageText(welcomeText, {
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
            { text: '⚙️ Setări / Settings', callback_data: 'menu_settings' },
            { text: '❓ Help', callback_data: 'menu_help' },
          ],
        ],
      }
  });
};

// Обработчики кнопок языка
bot.action('set_lang_ro', (ctx) => setupLanguage(ctx, 'ro'));
bot.action('set_lang_en', (ctx) => setupLanguage(ctx, 'en'));
bot.action('set_lang_ru', (ctx) => setupLanguage(ctx, 'ru'));

/**
 * Команда /menu
 */
bot.command('menu', async (ctx) => {
  await ctx.reply('📋 *Menu*', {
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
          { text: '⚙️ Settings', callback_data: 'menu_settings' },
          { text: '❓ Help', callback_data: 'menu_help' },
        ],
      ],
    },
  });
});

// Команды-заглушки
bot.command('gpt', async (ctx) => ctx.reply('🤖 Use menu to select model'));
bot.command('design', async (ctx) => ctx.reply('🎨 *AI Design*\n\nComing soon...'));
bot.command('audio', async (ctx) => ctx.reply('🎵 *AI Audio*\n\nComing soon...'));
bot.command('video', async (ctx) => ctx.reply('🎬 *AI Video*\n\nComing soon...'));
bot.command('help', async (ctx) => ctx.reply(content.welcome.en));

bot.command('model', handleModelCommand);
bot.command('clear', handleClearCommand);

/**
 * Обработка Callback запросов (кнопки меню)
 */
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  // Игнорируем выбор языка, так как он обработан выше
  if (data.startsWith('set_lang_')) return;

  try {
    // Главное меню
    if (data === 'menu_main') {
      await ctx.deleteMessage().catch(() => {}); // Удаляем старое или редактируем
      await ctx.reply('📋 *Menu*', {
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
            [{ text: '❓ Help', callback_data: 'menu_help' }],
          ],
        },
      });
      await ctx.answerCbQuery();
      return;
    }

    // --- МЕНЮ GPT (AIChat) ---
    if (data === 'menu_gpt') {
      const userId = ctx.from.id.toString();
      
      // Получаем модель пользователя
      const currentModel = await store.getUserModel(userId) || 'gpt5mini';
      
      // Определяем язык (можно доработать получение из базы, пока берем из сессии или дефолт)
      // Если есть store.getUserLanguage, используй его. Пока поставим заглушку 'ro' или попробуем определить
      // В идеале язык нужно хранить в БД. Пока поставим 'ro' как базу, если неизвестно.
      const lang = 'ro'; 
      
      // Проверка премиума (заглушка)
      const hasPremiumFn = () => false; // Поставь true для теста премиум кнопок

      const menuText = content.gpt_menu[lang] || content.gpt_menu.en;

      // Генерируем клавиатуру из models.js
      const keyboard = gptKeyboard(lang, currentModel, hasPremiumFn);

      await ctx.editMessageText(menuText, {
        parse_mode: 'Markdown',
        ...keyboard
      });
      
      await ctx.answerCbQuery();
      return;
    }

    // Обработка выбора модели (model_...)
    if (data.startsWith('model_')) {
      await handleModelCallback(ctx);
      return;
    }

    // Остальные меню (заглушки)
    if (data === 'menu_design') {
      await ctx.editMessageText('🎨 *AI Design*\n\n🚧 În dezvoltare...', {
        reply_markup: { inline_keyboard: [[{ text: '◀️ Back', callback_data: 'menu_main' }]] }
      });
      await ctx.answerCbQuery();
      return;
    }
    
    // Если ничего не совпало
    await ctx.answerCbQuery();

  } catch (error) {
    console.error('Callback query error:', error);
    await ctx.answerCbQuery('❌ Error');
  }
});

/**
 * Обработка текста
 */
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  await handleTextMessage(ctx, text);
});

/**
 * Обработка ошибок
 */
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

/**
 * Экспорт функции для Vercel
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
              
