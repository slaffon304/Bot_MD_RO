/**
 * Webhook handler для Telegram бота
 * FIX: Исправлено отображение кнопок моделей (reply_markup)
 */

const { Telegraf, Markup } = require('telegraf');
const content = require('../content.json');
const store = require('../lib/store');
const { gptKeyboard } = require('../lib/models');

const {
  handleTextMessage,
  handleClearCommand,
  handleModelCommand,
  handleModelCallback,
} = require('./handlers/text');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// --- START ---
bot.command('start', async (ctx) => {
  await ctx.reply(content.lang_select, Markup.inlineKeyboard([
    [
      Markup.button.callback('🇹🇩 Română', 'set_lang_ro'),
      Markup.button.callback('🇺🇸 English', 'set_lang_en'),
      Markup.button.callback('🇷🇺 Русский', 'set_lang_ru')
    ]
  ]));
});

// --- ЛОГИКА ЯЗЫКА ---
const setupLanguage = async (ctx, langCode) => {
  const userId = ctx.from.id.toString();
  
  try {
    if (store.updateUser) await store.updateUser(userId, { language: langCode });
    const currentModel = await store.getUserModel(userId);
    if (!currentModel) await store.setUserModel(userId, 'gpt5mini');
  } catch (e) {
    console.error('Store error:', e);
  }

  const welcomeText = content.welcome[langCode] || content.welcome.en;
  
  try {
    await ctx.deleteMessage().catch(() => {}); 
  } catch (e) {}

  try {
      await ctx.reply(welcomeText, {
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
          }
      });
  } catch (err) {
      console.error('Reply Error:', err);
      await ctx.reply('❌ Error loading menu. Type /menu');
  }
};

bot.action('set_lang_ro', (ctx) => setupLanguage(ctx, 'ro'));
bot.action('set_lang_en', (ctx) => setupLanguage(ctx, 'en'));
bot.action('set_lang_ru', (ctx) => setupLanguage(ctx, 'ru'));

// --- МЕНЮ ---
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

// --- GPT MENU & CALLBACKS ---
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith('set_lang_')) return;

  try {
    // Главное меню
    if (data === 'menu_main') {
      await ctx.editMessageText('📋 *Menu*', {
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

    // AIChat Меню (ИСПРАВЛЕНО)
    if (data === 'menu_gpt') {
      const userId = ctx.from.id.toString();
      const currentModel = await store.getUserModel(userId) || 'gpt5mini';
      
      // TODO: Брать язык из базы
      const lang = 'ro'; 
      const hasPremiumFn = () => false; 

      const menuText = content.gpt_menu[lang] || content.gpt_menu.en;
      const keyboard = gptKeyboard(lang, currentModel, hasPremiumFn);

      // ВОТ ТУТ БЫЛА ОШИБКА. Теперь мы явно указываем reply_markup
      await ctx.editMessageText(menuText, {
        parse_mode: 'Markdown', 
        reply_markup: keyboard // <--- Исправлено
      });
      
      await ctx.answerCbQuery();
      return;
    }

    // Обработка выбора модели
    if (data.startsWith('model_')) {
      await handleModelCallback(ctx);
      return;
    }

    // Заглушки
    if (['menu_design', 'menu_audio', 'menu_video'].includes(data)) {
        await ctx.answerCbQuery('🚧 Coming soon...');
        return;
    }
    
    await ctx.answerCbQuery();

  } catch (error) {
    console.error('Callback Error:', error);
    if (error.description && error.description.includes('message to edit not found')) {
        await ctx.reply('⚠️ Session expired. Type /menu');
    } else {
        // Игнорируем ошибку "message is not modified", если юзер жмет одну и ту же кнопку
        if (!error.description.includes('message is not modified')) {
             console.log('Error editing message:', error.description);
        }
    }
  }
});

// --- COMMANDS ---
bot.command('gpt', async (ctx) => ctx.reply('🤖 Use menu'));
bot.command('help', async (ctx) => ctx.reply(content.welcome.en));
bot.command('model', handleModelCommand);
bot.command('clear', handleClearCommand);

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  await handleTextMessage(ctx, ctx.message.text);
});

bot.catch((err) => console.error('Global Error:', err));

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } else {
      res.status(200).json({ status: 'Running' });
    }
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ error: 'Error' });
  }
};
    
