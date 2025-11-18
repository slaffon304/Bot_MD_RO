/**
 * Webhook handler для Telegram бота
 * Логика: Выбор языка -> Приветствие -> Умные ответы
 */

const { Telegraf, Markup } = require('telegraf');
const content = require('../content.json');
const store = require('../lib/store');

// Импорт хендлеров
const {
  handleTextMessage,
  handleClearCommand,
  handleModelCommand,
  handleModelCallback,
} = require('./handlers/text');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// --- ЛОГИКА ВЫБОРА ЯЗЫКА ---

// Команда /start
bot.command('start', async (ctx) => {
  // Предлагаем выбрать язык
  await ctx.reply(content.lang_select, Markup.inlineKeyboard([
    [
      Markup.button.callback('🇹🇩 Română', 'set_lang_ro'),
      Markup.button.callback('🇺🇸 English', 'set_lang_en'),
      Markup.button.callback('🇷🇺 Русский', 'set_lang_ru')
    ]
  ]));
});

// Обработка выбора языка
const setupLanguage = async (ctx, langCode) => {
  const userId = ctx.from.id.toString();
  
  // 1. Сохраняем язык пользователя и дефолтную модель (если нет)
  // ВАЖНО: Убедись, что в store.js есть метод setUserData или update, иначе добавь его.
  // Здесь мы используем существующий setUserModel, предполагая расширение,
  // или просто сохраняем контекст сессии, если базы нет.
  
  try {
    // Попытка сохранить язык (если store поддерживает)
    if (store.updateUser) {
        await store.updateUser(userId, { language: langCode });
    }
    // Установка модели по умолчанию, если юзер новый
    const currentModel = await store.getUserModel(userId);
    if (!currentModel) {
      await store.setUserModel(userId, 'gpt-4o-mini');
    }
  } catch (e) {
    console.error('Error saving user data:', e);
  }

  // 2. Отправляем приветственное сообщение на выбранном языке
  const welcomeText = content.welcome[langCode];
  
  // Главное меню тоже можно локализовать, но пока оставим универсальные кнопки
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

// Слушатели кнопок языка
bot.action('set_lang_ro', (ctx) => setupLanguage(ctx, 'ro'));
bot.action('set_lang_en', (ctx) => setupLanguage(ctx, 'en'));
bot.action('set_lang_ru', (ctx) => setupLanguage(ctx, 'ru'));


// --- ОСТАЛЬНЫЕ КОМАНДЫ ---

bot.command('menu', async (ctx) => {
    // Тут можно добавить проверку языка юзера, чтобы выдавать меню на нужном языке
    // Пока оставим дефолтное на румынском/английском
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
            { text: '🔍 Search', callback_data: 'menu_search' },
            { text: '📚 Docs', callback_data: 'menu_docs' },
          ],
        ],
      },
    });
  });

bot.command('gpt', async (ctx) => {
  await ctx.reply('🤖 *AI Chat*\n\nType anything...', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Model', callback_data: 'action_model' }, { text: '🗑️ Clear', callback_data: 'action_clear' }],
        [{ text: '◀️ Menu', callback_data: 'menu_main' }],
      ],
    },
  });
});

// Заглушки для других команд
bot.command('design', async (ctx) => ctx.reply('🎨 *AI Design*\n\nComing soon...'));
bot.command('audio', async (ctx) => ctx.reply('🎵 *AI Audio*\n\nComing soon...'));
bot.command('video', async (ctx) => ctx.reply('🎬 *AI Video*\n\nComing soon...'));

// Хендлеры логики (модели, очистка)
bot.command('help', async (ctx) => ctx.reply(content.welcome.en)); // По дефолту EN или можно брать из базы
bot.command('model', handleModelCommand);
bot.command('clear', handleClearCommand);

// Обработка Callback-ов
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  // Если это выбор языка - мы уже обработали выше через bot.action, 
  // но если попадет сюда, игнорируем или обрабатываем.
  if (data.startsWith('set_lang_')) return; 

  try {
    if (data === 'menu_main') {
        await ctx.deleteMessage(); // Или edit
        await ctx.reply('📋 Menu', { /* Клавиатура меню */ }); 
        return;
    }
    
    // ... (Тут твой код обработки остальных меню: gpt, design, video и т.д.)
    // Я сократил для примера, вставь сюда свои if (data === 'menu_gpt') и т.д. из старого файла
    
    // Обработка выбора модели
    if (data.startsWith('model_')) {
      await handleModelCallback(ctx);
      return;
    }
    
    // Действия
    if (data === 'action_model') {
        await handleModelCommand(ctx);
        return;
    }

    if (    // В начале файла добавь импорт, если его нет:
    const { gptKeyboard } = require('../lib/models'); 

    // ... внутри bot.on('callback_query') ...

    if (data === 'menu_gpt') {
      const userId = ctx.from.id.toString();
      
      // 1. Получаем данные пользователя (язык и модель)
      let userData = { language: 'ro', model: 'gpt5mini' }; // Дефолт
      try {
        if (store.getUser) {
           const stored = await store.getUser(userId);
           if (stored) userData = { ...userData, ...stored };
        }
      } catch (e) { console.error(e); }

      const lang = userData.language || 'ro';
      const currentModel = userData.model || 'gpt5mini';

      // 2. Проверка премиума (заглушка, пока реализуй как false или подключи базу)
      const hasPremium = false; // Поставь true для теста, если хочешь видеть все открытым
      const hasPremiumFn = () => hasPremium; 

      // 3. Отправляем меню с моделями
      // Используем editMessageText, чтобы заменить главное меню на меню GPT
      await ctx.editMessageText(content.gpt_menu[lang], {
        parse_mode: 'Markdown',
        ...gptKeyboard(lang, currentModel, hasPremiumFn)
      });
      
      await ctx.answerCbQuery();
      return;
    }
) {
        await handleModelCommand(ctx);
        return;
    }

    await ctx.answerCbQuery();

  } catch (error) {
    console.error('Callback error:', error);
    await ctx.answerCbQuery('Error');
  }
});


// --- ОБРАБОТКА ТЕКСТА (ГЛАВНАЯ ФИШКА) ---

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  // ВАЖНО: Чтобы бот отвечал на языке запроса, это нужно делать НЕ здесь,
  // а в файле, который отправляет запрос к AI (обычно lib/api/openrouter.js).
  // Но мы передадим это намерение через handleTextMessage.
  
  // Мы предполагаем, что handleTextMessage вызывает AI.
  // Логика "отвечай на языке запроса" должна быть в System Prompt.
  
  await handleTextMessage(ctx, text); 
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } else {
      res.status(200).json({ status: 'Bot is running' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
};
  
