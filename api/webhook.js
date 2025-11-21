/**
 * Webhook handler
 * UPD: Динамические данные в /account + Живое меню
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

// --- ТЕКСТЫ ---
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
    
    en: `Hello! 👋 This bot gives you access to the best neural networks.
    
Free: GPT 5 mini and Gemini 2.5 Flash.

The Chatbot can:
• Write and translate texts 📝
• Generate images and videos 🌅🎬
• Work with documents 🗂
• Create music and songs 🎸

📝 TEXT: just write a question (/model).
🌅 IMAGES: /imagine + description
🎬 VIDEO: /video
🎸 MUSIC: /music
📚 HELP: /help`,

    ro: `Salut! 👋 Acest bot îți oferă acces la cele mai bune rețele neuronale.

Gratuit: GPT 5 mini și Gemini 2.5 Flash.

Chatbot-ul poate:
• Scrie și traduce texte 📝
• Genera imagini și video 🌅🎬
• Lucra cu documente 🗂
• Crea muzică și cântece 🎸

📝 TEXT: scrie întrebarea (/model).
🌅 IMAGINI: /imagine + descriere
🎬 VIDEO: /video
🎸 MUZICĂ: /music
📚 AJUTOR: /help`
  }
};

// --- СПИСОК КОМАНД ---
const COMMANDS_LIST = {
    en: [
        { command: "start", description: "🔄 Restart Bot" },
        { command: "info", description: "🤖 What bot can do" },
        { command: "account", description: "👤 My Account" },
        { command: "premium", description: "⭐️ Premium Subscription" },
        { command: "clear", description: "🗑️ Delete Context" },
        { command: "image", description: "🖼️ Image Generation" },
        { command: "suno", description: "🎸 Create Music" },
        { command: "video", description: "🎬 Create Video" },
        { command: "academic", description: "📚 Academic Service" },
        { command: "search", description: "🌐 Internet Search" },
        { command: "settings", description: "⚙️ Bot Settings" },
        { command: "help", description: "⌨️ Main Commands" },
        { command: "terms", description: "📜 User Agreement" }
    ],
    ru: [
        { command: "start", description: "🔄 Перезапуск" },
        { command: "info", description: "🤖 Что умеет бот" },
        { command: "account", description: "👤 Мой аккаунт" },
        { command: "premium", description: "⭐️ Премиум подписка" },
        { command: "clear", description: "🗑️ Сброс контекста" },
        { command: "image", description: "🖼️ Генерация фото" },
        { command: "suno", description: "🎸 Создать музыку" },
        { command: "video", description: "🎬 Создать видео" },
        { command: "academic", description: "📚 Учеба и Рефераты" },
        { command: "search", description: "🌐 Поиск в интернете" },
        { command: "settings", description: "⚙️ Настройки" },
        { command: "help", description: "⌨️ Главные команды" },
        { command: "terms", description: "📜 Соглашение" }
    ],
    ro: [
        { command: "start", description: "🔄 Repornire" },
        { command: "info", description: "🤖 Ce poate botul" },
        { command: "account", description: "👤 Contul meu" },
        { command: "premium", description: "⭐️ Abonament Premium" },
        { command: "clear", description: "🗑️ Șterge context" },
        { command: "image", description: "🖼️ Generare foto" },
        { command: "suno", description: "🎸 Creează muzică" },
        { command: "video", description: "🎬 Creează video" },
        { command: "academic", description: "📚 Studii și Referate" },
        { command: "search", description: "🌐 Căutare web" },
        { command: "settings", description: "⚙️ Setări" },
        { command: "help", description: "⌨️ Comenzi principale" },
        { command: "terms", description: "📜 Termeni" }
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

// --- INFO ---
bot.command('info', async (ctx) => {
    const userId = ctx.from.id.toString();
    let lang = 'en';
    try { if (store.getUserLang) lang = await store.getUserLang(userId) || 'en'; } catch(e) {}
    const text = MESSAGES.info[lang] || MESSAGES.info.en;
    await ctx.reply(text);
});

// --- ACCOUNT (ДИНАМИЧЕСКИЙ) ---
bot.command('account', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    // 1. СБОР ДАННЫХ (ИЗ REDIS/STORE)
    let lang = 'en';
    let modelKey = 'deepseek';
    let history = [];
    let stats = {
        text_usage: 0,
        image_left: 0,
        claude_tokens: 0,
        suno_left: 0,
        video_left: 0,
        academic_left: 0
    };
    
    try { 
        if (store.getUserLang) lang = await store.getUserLang(userId) || 'en'; 
        if (store.getUserModel) modelKey = await store.getUserModel(userId) || 'deepseek';
        if (store.getHistory) history = await store.getHistory(userId) || [];
        
        // Пытаемся достать реальную статистику (если store.redis доступен)
        if (store.redis) {
            const [txt, img, claude, suno, vid] = await Promise.all([
                store.redis.get(`usage:text:${userId}`),
                store.redis.get(`limit:image:${userId}`),
                store.redis.get(`limit:claude:${userId}`),
                store.redis.get(`limit:suno:${userId}`),
                store.redis.get(`limit:video:${userId}`)
            ]);
            stats.text_usage = txt || 0;
            stats.image_left = img || 5; // Дефолт 5
            stats.claude_tokens = claude || 0;
            stats.suno_left = suno || 0;
            stats.video_left = vid || 0;
        }
    } catch(e) {}

    // Определяем название модели
    let modelName = modelKey;
    if (GPT_MODELS) {
       const m = GPT_MODELS.find(x => x.key === modelKey);
       if (m) modelName = m.label[lang] || m.label.en || modelKey;
    }

    // Статус контекста
    const contextStatus = (history.length > 0) ? "✅" : "❌";
    const contextText = (history.length > 0) ? (lang === 'ru' ? "Вкл" : "On") : (lang === 'ru' ? "Выкл (Пусто)" : "Off (Empty)");

    // Формируем текст (УДАЛИТЕ ЛИШНИЕ СТРОКИ ЗДЕСЬ)
    let text = "";
    
    if (lang === 'ru') {
        text = `👤 ID Пользователя: \`${userId}\`
⭐ Тип подписки: 🆓 Free
📆 Действует до: -
💳 Метод оплаты: -
---------------------------
⌨️ Текстовые генерации (24 ч): ${stats.text_usage}
🖼️ Картинок осталось: ${stats.image_left}
🧠 Claude токены: ${stats.claude_tokens} /claude
🎸 Suno песни: ${stats.suno_left}
🎬 Видео: ${stats.video_left}
📚 Академические запросы: ${stats.academic_left} /academic
---------------------------
🤖 GPT модель: ${modelName} /model
🎭 GPT-Роль: Обычный 🔁
💬 Стиль общения: 🔁 Обычный (?)
🎨 Креативность: Высокий
📝 Контекст: ${contextStatus} ${contextText}
🔉 Голосовой ответ: ❌ Выкл
⚙️ Настройки бота: /settings`;

    } else if (lang === 'ro') {
        text = `👤 ID Utilizator: \`${userId}\`
⭐ Tip abonament: 🆓 Free
---------------------------
⌨️ Generări text (24h): ${stats.text_usage}
🖼️ Imagini rămase: ${stats.image_left}
🧠 Token-uri Claude: ${stats.claude_tokens}
🎸 Piese Suno: ${stats.suno_left}
🎬 Video: ${stats.video_left}
---------------------------
🤖 Model GPT: ${modelName} /model
📝 Context: ${contextStatus} ${contextText}
⚙️ Setări bot: /settings`;

    } else {
        text = `👤 User ID: \`${userId}\`
⭐ Subscription: 🆓 Free
---------------------------
⌨️ Text generations (24h): ${stats.text_usage}
🖼️ Images left: ${stats.image_left}
🧠 Claude tokens: ${stats.claude_tokens}
🎸 Suno songs: ${stats.suno_left}
🎬 Video: ${stats.video_left}
---------------------------
🤖 GPT Model: ${modelName} /model
📝 Context: ${contextStatus} ${contextText}
⚙️ Bot settings: /settings`;
    }

    const btnSettings = lang === 'ro' ? '⚙️ Setări' : (lang === 'ru' ? '⚙️ Настройки' : '⚙️ Settings');
    const btnPremium = lang === 'ro' ? '🚀 Cumpără Premium' : (lang === 'ru' ? '🚀 Купить Премиум' : '🚀 Buy Premium');

    await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: btnSettings, callback_data: 'menu_settings' }],
                [{ text: btnPremium, callback_data: 'menu_premium' }]
            ]
        }
    });
});

// --- ЯЗЫК ---
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

// --- MENU FORCE UPDATE ---
bot.command('setup_menu', async (ctx) => {
    await ctx.reply('⏳ Updating Telegram menu...');
    const success = await setBotCommands();
    if (success) await ctx.reply('✅ Menu updated!');
});

// --- MENU ---
bot.command('menu', async (ctx) => {
    const userId = ctx.from.id.toString();
    let lang = 'en';
    try { if (store.getUserLang) lang = await store.getUserLang(userId) || 'en'; } catch(e) {}

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
      try { if (store.getUserLang) userLang = await store.getUserLang(userId) || 'ru'; } catch(e) {}
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
  } catch (error) { console.error('Callback Error:', error); }
});

// --- OTHER COMMANDS ---
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
          
