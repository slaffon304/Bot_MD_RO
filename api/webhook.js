/**
 * Webhook handler
 * UPD: Полное меню команд (/menu) + Жесткое обновление системного меню
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

// --- СПИСОК КОМАНД (HARDCODED) ---
const COMMANDS_LIST = {
    en: [
        { command: "start", description: "Restart Bot" },
        { command: "info", description: "What bot can do" },
        { command: "account", description: "My Account" },
        { command: "premium", description: "Premium Subscription" },
        { command: "clear", description: "Delete Context" },
        { command: "image", description: "Image Generation" },
        { command: "suno", description: "Create Music" },
        { command: "video", description: "Create Video" },
        { command: "academic", description: "Academic Service" },
        { command: "search", description: "Internet Search" },
        { command: "settings", description: "Bot Settings" },
        { command: "help", description: "Main Commands" },
        { command: "terms", description: "User Agreement" }
    ],
    ru: [
        { command: "start", description: "Перезапуск" },
        { command: "info", description: "Что умеет бот" },
        { command: "account", description: "Мой аккаунт" },
        { command: "premium", description: "Премиум подписка" },
        { command: "clear", description: "Сброс контекста" },
        { command: "image", description: "Генерация фото" },
        { command: "suno", description: "Создать музыку" },
        { command: "video", description: "Создать видео" },
        { command: "academic", description: "Учеба и Рефераты" },
        { command: "search", description: "Поиск в интернете" },
        { command: "settings", description: "Настройки" },
        { command: "help", description: "Главные команды" },
        { command: "terms", description: "Соглашение" }
    ],
    ro: [
        { command: "start", description: "Repornire" },
        { command: "info", description: "Ce poate botul" },
        { command: "account", description: "Contul meu" },
        { command: "premium", description: "Abonament Premium" },
        { command: "clear", description: "Șterge context" },
        { command: "image", description: "Generare foto" },
        { command: "suno", description: "Creează muzică" },
        { command: "video", description: "Creează video" },
        { command: "academic", description: "Studii și Referate" },
        { command: "search", description: "Căutare web" },
        { command: "settings", description: "Setări" },
        { command: "help", description: "Comenzi principale" },
        { command: "terms", description: "Termeni" }
    ]
};

// --- INIT COMMANDS ---
const setBotCommands = async () => {
    try {
        await bot.telegram.setMyCommands(COMMANDS_LIST.en);
        await bot.telegram.setMyCommands(COMMANDS_LIST.en, { language_code: 'en' });
        await bot.telegram.setMyCommands(COMMANDS_LIST.ru, { language_code: 'ru' });
        await bot.telegram.setMyCommands(COMMANDS_LIST.ro, { language_code: 'ro' });
        console.log('Bot commands updated HARD');
        return true;
    } catch (e) {
        console.error('Failed to set commands:', e);
        return false;
    }
};

// --- START ---
bot.command('start', async (ctx) => {
  // Обновляем меню при каждом старте
  setBotCommands();

  await ctx.reply(content.lang_select, Markup.inlineKeyboard([
    [
      Markup.button.callback('🇹🇩 Română', 'set_lang_ro'),
      Markup.button.callback('🇺🇸 English', 'set_lang_en'),
      Markup.button.callback('🇷🇺 Русский', 'set_lang_ru')
    ]
  ]));
});

// --- SETUP MENU (FORCE) ---
bot.command('setup_menu', async (ctx) => {
    await ctx.reply('⏳ Updating Telegram menu...');
    const success = await setBotCommands();
    if (success) {
        await ctx.reply('✅ Menu updated! Restart Telegram app.');
    } else {
        await ctx.reply('❌ Error updating menu.');
    }
});

// --- HANDLERS FOR MENU BUTTONS (НОВЫЕ) ---
// Добавил заглушки, чтобы кнопки работали. Позже заменим на логику.
bot.command('info', (ctx) => ctx.reply("🤖 *Info*\nЯ могу искать информацию, генерировать фото, музыку и код.", { parse_mode: 'Markdown' }));
bot.command('account', (ctx) => ctx.reply(`👤 *Account*\nID: \`${ctx.from.id}\`\nStatus: Free User`, { parse_mode: 'Markdown' }));
bot.command('premium', (ctx) => ctx.reply("💎 *Premium*\nСкоро здесь будет оплата.", { parse_mode: 'Markdown' }));
bot.command('image', (ctx) => ctx.reply("🎨 *Image Gen*\nНапиши описание картинки...", { parse_mode: 'Markdown' }));
bot.command('suno', (ctx) => ctx.reply("🎵 *Music*\nФункция в разработке.", { parse_mode: 'Markdown' }));
bot.command('video', (ctx) => ctx.reply("🎬 *Video*\nФункция в разработке.", { parse_mode: 'Markdown' }));
bot.command('academic', (ctx) => ctx.reply("🎓 *Academic*\nРежим для учебы включен.", { parse_mode: 'Markdown' }));
bot.command('search', (ctx) => ctx.reply("🔍 *Search*\nНапиши запрос для поиска...", { parse_mode: 'Markdown' }));
bot.command('settings', (ctx) => ctx.reply("⚙️ *Settings*\nИспользуй кнопку меню для настроек.", { parse_mode: 'Markdown' }));
bot.command('settingsbot', (ctx) => ctx.reply("⚙️ *Settings*\nИспользуй кнопку меню для настроек.", { parse_mode: 'Markdown' }));
bot.command('terms', (ctx) => ctx.reply("📄 *Terms*\nПравила использования.", { parse_mode: 'Markdown' }));


// --- SETUP LANGUAGE ---
const setupLanguage = async (ctx, langCode) => {
  const userId = ctx.from.id.toString();
  try {
    if (store.setUserLang) await store.setUserLang(userId, langCode);
    let currentModel = null;
    if (store.getUserModel) currentModel = await store.getUserModel(userId);
    if (!currentModel && store.setUserModel) await store.setUserModel(userId, 'deepseek');
  } catch (e) { console.error("Setup Lang DB Error:", e); }

  const welcomeText = content.welcome[langCode] || content.welcome.en;
  try { await ctx.deleteMessage().catch(() => {}); } catch (e) {}

  // FULL KEYBOARD
  await ctx.reply(welcomeText, {
    reply_markup: {
        inline_keyboard: [
          [
            { text: '🤖 AI Chat', callback_data: `menu_gpt_${langCode}` }, 
            { text: '🎨 AI Design', callback_data: 'menu_design' }
          ],
          [
            { text: '🎵 AI Audio', callback_data: 'menu_audio' },
            { text: '🎬 AI Video', callback_data: 'menu_video' }
          ],
          [
            { text: '⚙️ Settings', callback_data: 'menu_settings' },
            { text: '❓ Help', callback_data: 'menu_help' }
          ],
        ],
      }
  });
};

bot.action('set_lang_ro', (ctx) => setupLanguage(ctx, 'ro'));
bot.action('set_lang_en', (ctx) => setupLanguage(ctx, 'en'));
bot.action('set_lang_ru', (ctx) => setupLanguage(ctx, 'ru'));

// --- MENU COMMAND (FULL KEYBOARD FIX) ---
bot.command('menu', async (ctx) => {
    const userId = ctx.from.id.toString();
    let lang = 'en';
    try {
        if (store.getUserLang) lang = await store.getUserLang(userId) || 'en';
    } catch(e) {}

    await ctx.reply('📋 *Menu*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
          [
            { text: '🤖 AI Chat', callback_data: `menu_gpt_${lang}` }, 
            { text: '🎨 AI Design', callback_data: 'menu_design' }
          ],
          [
            { text: '🎵 AI Audio', callback_data: 'menu_audio' },
            { text: '🎬 AI Video', callback_data: 'menu_video' }
          ],
          [
            { text: '⚙️ Settings', callback_data: 'menu_settings' },
            { text: '❓ Help', callback_data: 'menu_help' }
          ],
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
    
    if (data.startsWith('menu_gpt')) {
      const lang = data.split('_')[2] || 'ru'; 
      let currentModel = 'deepseek'; 
      try {
          if (store.getUserModel) {
            const m = await store.getUserModel(userId);
            if (m) currentModel = m;
          }
      } catch (e) {}

      const menuText = content.gpt_menu[lang] || content.gpt_menu.en;
      const keyboard = gptKeyboard(lang, currentModel, () => false);

      await ctx.editMessageText(menuText, { parse_mode: 'Markdown', reply_markup: keyboard });
      await ctx.answerCbQuery();
      return;
    }

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
        let lang = 'en';
        try { if (store.getUserLang) lang = await store.getUserLang(userId) || 'en'; } catch(e) {}
        
        await ctx.editMessageText('📋 *Menu*', {
            parse_mode: 'Markdown',
            reply_markup: { 
                inline_keyboard: [
                  [
                    { text: '🤖 AI Chat', callback_data: `menu_gpt_${lang}` }, 
                    { text: '🎨 AI Design', callback_data: 'menu_design' }
                  ],
                  [
                    { text: '🎵 AI Audio', callback_data: 'menu_audio' },
                    { text: '🎬 AI Video', callback_data: 'menu_video' }
                  ],
                  [
                    { text: '⚙️ Settings', callback_data: 'menu_settings' },
                    { text: '❓ Help', callback_data: 'menu_help' }
                  ],
                ] 
            }
        });
    }
    
    await ctx.answerCbQuery();

  } catch (error) {
    console.error('Callback Error:', error);
  }
});

// --- COMMANDS ---
bot.command('gpt', async (ctx) => ctx.reply('🤖 Use /menu -> AI Chat'));
bot.command('model', handleModelCommand);
bot.command('help', async (ctx) => ctx.reply(content.welcome.en));
bot.command('clear', handleClearCommand);
bot.command('debug', async (ctx) => { await handleTextMessage(ctx, '/debug'); });

// --- MEDIA ROUTER ---
bot.on(['photo', 'document', 'voice', 'audio', 'video'], async (ctx) => {
    const text = ctx.message.caption || ''; 
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
      
