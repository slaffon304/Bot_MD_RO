/**
 * Webhook handler
 * UPD: Живые команды /info и /account с кнопками
 */

const { Telegraf, Markup } = require('telegraf');
const content = require('../content.json');
const store = require('../lib/store'); 
const { gptKeyboard, GPT_MODELS } = require('../lib/models');

const {
  handleTextMessage,
  handleClearCommand,
  handleModelCommand,
  handleModelCallback,
} = require('./handlers/text');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// --- ТЕКСТЫ СООБЩЕНИЙ ---
const MESSAGES = {
  info: {
    ru: `Привет! 👋 Этот бот даёт вам доступ к лучшим нейросетям для создания текста, изображений, видео и песен.

Доступны новые модели: OpenAI o3, o4 mini, GPT 4o, DeepSeek, Claude 4.5, /Midjourney, /StableDiffusion, Flux, Kling, /Suno, Perplexity и другие.

Бесплатно: GPT 5 mini и Gemini 2.5 Flash.

Чатбот умеет:
• Писать и переводить тексты 📝
• Генерировать картинки и видео 🌅🎬
• Работать с документами 🗂
• Писать и править код ⌨
• Решать математические задачи 🧮
• Создавать музыку и песни 🎸
• Редактировать и распознавать фото 🖌
• Писать полноценные дипломы, курсовые, эссе, рефераты, книги и презентации 🎓
• Озвучивать текст и распознавать аудио 🎙

📝 ТЕКСТ: просто напишите вопрос или отправьте голосовое сообщение (выбор нейросети в /model).
• /i + вопрос – поиск в интернете

🌅 ИЗОБРАЖЕНИЯ: введите команду /imagine и описание (/Midjourney, /StableDiffusion, Flux и DALL•E 3 доступны в /premium).

🎬 ВИДЕО: /video – создание роликов (доступно в /Kling).

🎸 МУЗЫКА: /music – выберите жанр и добавьте текст песни (доступно в /Suno).

➡️ РАБОТА С РЕПОСТАМИ: перешлите сообщение боту для анализа, переписывания, создания статей и др.

👨‍👩‍👧‍👦 РАБОТА В ГРУППАХ: добавьте бота в группу и используйте команду /ask + ваш запрос.

📚 ПОМОЩЬ: /help — полный список возможностей, команд и инструкций.`,
    
    en: `Hello! 👋 This bot gives you access to the best neural networks for creating text, images, video, and songs.

Available models: OpenAI o3, o4 mini, GPT 4o, DeepSeek, Claude 4.5, /Midjourney, /StableDiffusion, Flux, Kling, /Suno, Perplexity and others.

Free: GPT 5 mini and Gemini 2.5 Flash.

The Chatbot can:
• Write and translate texts 📝
• Generate images and videos 🌅🎬
• Work with documents 🗂
• Write and fix code ⌨
• Solve math problems 🧮
• Create music and songs 🎸
• Edit and recognize photos 🖌
• Write full diplomas, essays, books 🎓
• Voice text and recognize audio 🎙

📝 TEXT: just write a question (select model in /model).
• /i + question – internet search

🌅 IMAGES: /imagine + description (/Midjourney, /StableDiffusion, Flux in /premium).

🎬 VIDEO: /video – create clips (/Kling).

🎸 MUSIC: /music – create songs (/Suno).

📚 HELP: /help — full list of commands.`,

    ro: `Salut! 👋 Acest bot îți oferă acces la cele mai bune rețele neuronale pentru creare de text, imagini, video și muzică.

Modele disponibile: OpenAI o3, o4 mini, GPT 4o, DeepSeek, Claude 4.5, /Midjourney, /StableDiffusion, Flux, Kling, /Suno, Perplexity și altele.

Gratuit: GPT 5 mini și Gemini 2.5 Flash.

Chatbot-ul poate:
• Scrie și traduce texte 📝
• Genera imagini și video 🌅🎬
• Lucra cu documente 🗂
• Scrie și corecta cod ⌨
• Rezolva probleme matematice 🧮
• Crea muzică și cântece 🎸
• Recunoaște fotografii 🖌
• Scrie teze, referate, cărți 🎓

📝 TEXT: scrie întrebarea (alege modelul în /model).
• /i + întrebare – căutare pe internet

🌅 IMAGINI: /imagine + descriere (/Midjourney, /StableDiffusion în /premium).

🎬 VIDEO: /video – creare clipuri (/Kling).

🎸 MUZICĂ: /music – creare muzică (/Suno).

📚 AJUTOR: /help — lista completă de comenzi.`
  }
};

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
  setBotCommands();
  await ctx.reply(content.lang_select, Markup.inlineKeyboard([
    [
      Markup.button.callback('🇹🇩 Română', 'set_lang_ro'),
      Markup.button.callback('🇺🇸 English', 'set_lang_en'),
      Markup.button.callback('🇷🇺 Русский', 'set_lang_ru')
    ]
  ]));
});

// --- COMMAND: /INFO ---
bot.command('info', async (ctx) => {
    const userId = ctx.from.id.toString();
    let lang = 'en';
    try { if (store.getUserLang) lang = await store.getUserLang(userId) || 'en'; } catch(e) {}

    const text = MESSAGES.info[lang] || MESSAGES.info.en;
    await ctx.reply(text);
});

// --- COMMAND: /ACCOUNT ---
bot.command('account', async (ctx) => {
    const userId = ctx.from.id.toString();
    let lang = 'en';
    let modelKey = 'deepseek'; 
    
    // Получаем данные из базы
    try { 
        if (store.getUserLang) lang = await store.getUserLang(userId) || 'en'; 
        if (store.getUserModel) modelKey = await store.getUserModel(userId) || 'deepseek';
    } catch(e) {}

    // Ищем красивое название модели
    let modelName = modelKey;
    // Пробуем найти в списке моделей
    if (GPT_MODELS) {
       const m = GPT_MODELS.find(x => x.key === modelKey);
       if (m) modelName = m.label[lang] || m.label.en || modelKey;
    }

    // Текстовки для разных языков (структура сохранена как в запросе)
    let text = "";
    if (lang === 'ru') {
        text = `👤 ID Пользователя: ${userId}
⭐ Тип подписки: 🆓 Free
📆 Действует до: -
💳 Метод оплаты: -
---------------------------
⌨️ Текстовые генерации (24 ч): 10
🖼️ Картинок осталось (мес): 1
🧠 Claude токены: 0 /claude
🎸 Suno песни (мес): 0
🎬 Видео: 0
📚 Академические запросы: 0 /academic
---------------------------
⌨️ Доп. текстовые генерации: 0
🌅 Доп. запросы изображений: 0
🎸 Доп. Suno песни: 0
🎬 Доп. видео: 0
---------------------------
🤖 GPT модель: ${modelName} /model
🎭 GPT-Роль: Обычный 🔁
💬 Стиль общения: 🔁 Обычный (?)
🎨 Креативность: Высокий
📝 Контекст: ✅ Вкл
🔉 Голосовой ответ: ❌ Выкл
⚙️ Настройки бота: /settings`;
    } else if (lang === 'ro') {
        text = `👤 ID Utilizator: ${userId}
⭐ Tip abonament: 🆓 Free
---------------------------
⌨️ Generări text (24h): 10
🖼️ Imagini rămase (lună): 1
🧠 Token-uri Claude: 0 /claude
🎸 Piese Suno (lună): 0
🎬 Video: 0
📚 Cereri academice: 0 /academic
---------------------------
🤖 Model GPT: ${modelName} /model
⚙️ Setări bot: /settings`;
    } else {
        text = `👤 User ID: ${userId}
⭐ Subscription: 🆓 Free
---------------------------
⌨️ Text generations (24h): 10
🖼️ Images left (mo): 1
🧠 Claude tokens: 0 /claude
🎸 Suno songs (mo): 0
🎬 Video: 0
📚 Academic req: 0 /academic
---------------------------
🤖 GPT Model: ${modelName} /model
⚙️ Bot settings: /settings`;
    }

    // Кнопки
    const btnSettings = lang === 'ro' ? '⚙️ Setări' : (lang === 'ru' ? '⚙️ Настройки' : '⚙️ Settings');
    const btnPremium = lang === 'ro' ? '🚀 Cumpără Premium' : (lang === 'ru' ? '🚀 Купить Премиум' : '🚀 Buy Premium');

    await ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback(btnSettings, 'menu_settings')],
        [Markup.button.callback(btnPremium, 'menu_premium')]
    ]));
});

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

// --- MENU COMMAND ---
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

// --- OTHER COMMANDS STUBS ---
bot.command('premium', (ctx) => ctx.reply("💎 *Premium*\nСкоро здесь будет оплата.", { parse_mode: 'Markdown' }));
bot.command('image', (ctx) => ctx.reply("🎨 *Image Gen*\nНапиши описание картинки...", { parse_mode: 'Markdown' }));
bot.command('suno', (ctx) => ctx.reply("🎵 *Music*\nФункция в разработке.", { parse_mode: 'Markdown' }));
bot.command('video', (ctx) => ctx.reply("🎬 *Video*\nФункция в разработке.", { parse_mode: 'Markdown' }));
bot.command('academic', (ctx) => ctx.reply("🎓 *Academic*\nРежим для учебы включен.", { parse_mode: 'Markdown' }));
bot.command('search', (ctx) => ctx.reply("🔍 *Search*\nНапиши запрос для поиска...", { parse_mode: 'Markdown' }));
bot.command('settings', (ctx) => ctx.reply("⚙️ *Settings*\nИспользуй кнопку меню для настроек.", { parse_mode: 'Markdown' }));
bot.command('settingsbot', (ctx) => ctx.reply("⚙️ *Settings*\nИспользуй кнопку меню для настроек.", { parse_mode: 'Markdown' }));
bot.command('terms', (ctx) => ctx.reply("📄 *Terms*\nПравила использования.", { parse_mode: 'Markdown' }));
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
          
