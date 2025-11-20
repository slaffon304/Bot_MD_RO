/**
 * Webhook handler
 * UPD: Добавлена установка меню команд (Menu Button) + Медиа
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

// --- INIT COMMANDS (Настройка меню) ---
const setBotCommands = async () => {
    try {
        // Проверка на всякий случай, если content.commands еще не загрузился
        if (!content.commands) return;

        await bot.telegram.setMyCommands(content.commands.en, { language_code: 'en' });
        await bot.telegram.setMyCommands(content.commands.ru, { language_code: 'ru' });
        await bot.telegram.setMyCommands(content.commands.ro, { language_code: 'ro' });
        
        // Дефолтное (для всех остальных языков ставим английский)
        await bot.telegram.setMyCommands(content.commands.en);
        console.log('Bot commands updated');
    } catch (e) {
        console.error('Failed to set commands:', e);
    }
};

// --- START ---
bot.command('start', async (ctx) => {
  // Обновляем меню команд при старте
  setBotCommands();

  await ctx.reply(content.lang_select, Markup.inlineKeyboard([
    [
      Markup.button.callback('🇹🇩 Română', 'set_lang_ro'),
      Markup.button.callback('🇺🇸 English', 'set_lang_en'),
      Markup.button.callback('🇷🇺 Русский', 'set_lang_ru')
    ]
  ]));
});

// --- SETUP LANGUAGE ---
const setupLanguage = async (ctx, langCode) => {
  const userId = ctx.from.id.toString();
  
  try {
    if (store.setUserLang) await store.setUserLang(userId, langCode);
    
    let currentModel = null;
    if (store.getUserModel) currentModel = await store.getUserModel(userId);
    
    // Дефолт: DeepSeek
    if (!currentModel && store.setUserModel) {
        await store.setUserModel(userId, 'deepseek');
    }
  } catch (e) {
      console.error("Setup Lang DB Error:", e);
  }

  const welcomeText = content.welcome[langCode] || content.welcome.en;
  
  try { await ctx.deleteMessage().catch(() => {}); } catch (e) {}

  await ctx.reply(welcomeText, {
    reply_markup: {
        inline_keyboard: [
          [
            { text: '🤖 AI Chat', callback_data: `menu_gpt_${langCode}` }, 
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
};

bot.action('set_lang_ro', (ctx) => setupLanguage(ctx, 'ro'));
bot.action('set_lang_en', (ctx) => setupLanguage(ctx, 'en'));
bot.action('set_lang_ru', (ctx) => setupLanguage(ctx, 'ru'));

bot.command('menu', async (ctx) => {
    await ctx.reply('📋 *Menu*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🤖 AI Chat', callback_data: 'menu_gpt_ru' }], 
        [{ text: '❓ Help', callback_data: 'menu_help' }],
      ],
    },
  });
});

// --- CALLBACKS ---
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith('set_lang_')) return;

  try {
    const userId = ctx.from.id.toString();
    
    // 1. AIChat Menu
    if (data.startsWith('menu_gpt')) {
      const lang = data.split('_')[2] || 'ru'; 
      let currentModel = 'deepseek'; // Default
      try {
          if (store.getUserModel) {
            const m = await store.getUserModel(userId);
            if (m) currentModel = m;
          }
      } catch (e) {}

      const menuText = content.gpt_menu[lang] || content.gpt_menu.en;
      const keyboard = gptKeyboard(lang, currentModel, () => false);

      await ctx.editMessageText(menuText, {
        parse_mode: 'Markdown', 
        reply_markup: keyboard 
      });
      await ctx.answerCbQuery();
      return;
    }

    // 2. Model Selection
    if (data.startsWith('model_')) {
      let userLang = 'ru';
      try {
          if (store.getUserLang) {
            const l = await store.getUserLang(userId);
            if (l) userLang = l;
          }
      } catch(e) {}

      await handleModelCallback(ctx, userLang); 
      return;
    }

    if (data === 'menu_main') {
        await ctx.editMessageText('📋 Menu', {
            reply_markup: { inline_keyboard: [[{text: '🤖 AI Chat', callback_data: 'menu_gpt_ru'}]] }
        });
    }
    
    await ctx.answerCbQuery();

  } catch (error) {
    console.error('Callback Error:', error);
    if (error.description && error.description.includes('message to edit not found')) {
       await ctx.reply('Session expired. /menu');
    }
  }
});

// --- COMMANDS ---
bot.command('gpt', async (ctx) => ctx.reply('🤖 Use /menu'));
bot.command('model', handleModelCommand);
bot.command('help', async (ctx) => ctx.reply(content.welcome.en));
bot.command('clear', handleClearCommand);

bot.command('debug', async (ctx) => {
    await handleTextMessage(ctx, '/debug');
});

// --- ОБРАБОТКА ВСЕХ ФАЙЛОВ (Media Router) ---
// Добавили voice, audio, video, photo, document
bot.on(['photo', 'document', 'voice', 'audio', 'video'], async (ctx) => {
    // Передаем caption (подпись) или пустую строку
    const text = ctx.message.caption || ''; 
    // Весь объект сообщения (ctx) уйдет в text.js, где мы достанем ссылки на файлы
    await handleTextMessage(ctx, text);
});

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
    console.error("Webhook Error:", error);
    res.status(500).json({ error: 'Error' });
  }
};
      
