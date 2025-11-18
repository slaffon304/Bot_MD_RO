/**
 * Webhook handler
 * FIX: Жесткая привязка языка к кнопкам (чтобы не слетал на Vercel)
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

// --- START (Выбор языка) ---
bot.command('start', async (ctx) => {
  await ctx.reply(content.lang_select, Markup.inlineKeyboard([
    [
      Markup.button.callback('🇹🇩 Română', 'set_lang_ro'),
      Markup.button.callback('🇺🇸 English', 'set_lang_en'),
      Markup.button.callback('🇷🇺 Русский', 'set_lang_ru')
    ]
  ]));
});

// --- УСТАНОВКА ЯЗЫКА ---
const setupLanguage = async (ctx, langCode) => {
  const userId = ctx.from.id.toString();
  
  // Пытаемся сохранить (но на Vercel это может не работать долго)
  try {
    if (store.updateUser) await store.updateUser(userId, { language: langCode });
    const currentModel = await store.getUserModel(userId);
    if (!currentModel) await store.setUserModel(userId, 'gpt5mini');
  } catch (e) {}

  const welcomeText = content.welcome[langCode] || content.welcome.en;
  
  // Удаляем кнопки выбора языка
  try { await ctx.deleteMessage().catch(() => {}); } catch (e) {}

  // Шлем приветствие
  // ВАЖНО: В кнопках menu_gpt теперь зашит код языка (menu_gpt_ru), чтобы он не терялся
  await ctx.reply(welcomeText, {
    reply_markup: {
        inline_keyboard: [
          [
            { text: '🤖 AI Chat', callback_data: `menu_gpt_${langCode}` }, // <-- ПЕРЕДАЕМ ЯЗЫК ДАЛЬШЕ
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

// --- МЕНЮ ---
bot.command('menu', async (ctx) => {
    // По дефолту открываем меню (тут язык может потеряться, если store не работает)
    // Для надежности лучше использовать /start
    await ctx.reply('📋 *Menu*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🤖 AI Chat', callback_data: 'menu_gpt_ru' }], // Дефолт RU для теста
        [{ text: '❓ Help', callback_data: 'menu_help' }],
      ],
    },
  });
});

// --- ОБРАБОТКА КНОПОК ---
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith('set_lang_')) return;

  try {
    const userId = ctx.from.id.toString();
    
    // Пытаемся достать модель
    let currentModel = 'gpt5mini';
    try {
        const m = await store.getUserModel(userId);
        if (m) currentModel = m;
    } catch (e) {}

    // 1. AIChat Меню (Ловим язык из кнопки menu_gpt_ru)
    if (data.startsWith('menu_gpt')) {
      // Вытаскиваем язык из data (menu_gpt_ru -> ru)
      const lang = data.split('_')[2] || 'ru'; 
      
      const menuText = content.gpt_menu[lang] || content.gpt_menu.en;
      const keyboard = gptKeyboard(lang, currentModel, () => false);

      // Редактируем сообщение (превращаем приветствие в меню моделей)
      await ctx.editMessageText(menuText, {
        parse_mode: 'Markdown', 
        reply_markup: keyboard.reply_markup // <-- Явно берем reply_markup
      });
      
      await ctx.answerCbQuery();
      return;
    }

    // 2. Выбор модели (model_gpt5_ru)
    // Теперь модель передает и язык тоже, если мы настроим это в models.js, 
    // но пока берем язык из Store или дефолт.
    if (data.startsWith('model_')) {
      // Передаем управление в handlers/text.js
      // ВАЖНО: Нам нужно знать язык здесь. Пока возьмем 'ru' как fallback, 
      // так как в callback кнопки модели язык не зашит (это сложно менять в models.js сейчас).
      // Но мы можем попробовать достать из store.
      let userLang = 'ru';
      try {
          const u = await store.getUser(userId);
          if(u && u.language) userLang = u.language;
      } catch(e) {}

      await handleModelCallback(ctx, userLang); 
      return;
    }

    // 3. Заглушки
    if (data === 'menu_main') {
        await ctx.editMessageText('📋 Menu', {
            reply_markup: { inline_keyboard: [[{text: '🤖 AI Chat', callback_data: 'menu_gpt_ru'}]] }
        });
    }
    
    await ctx.answerCbQuery();

  } catch (error) {
    console.error('Callback Error:', error);
    await ctx.answerCbQuery('❌ Error');
  }
});

// --- КОМАНДЫ ---
bot.command('gpt', async (ctx) => ctx.reply('🤖 Use /menu'));
bot.command('model', handleModelCommand); // <-- Это теперь работает через text.js
bot.command('help', async (ctx) => ctx.reply(content.welcome.en));
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
    res.status(500).json({ error: 'Error' });
  }
};
    
