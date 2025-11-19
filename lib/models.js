// lib/models.js

// Каталог моделей "Dream Team" 2025
const GPT_MODELS = [
  // --- 🟢 CHAT MODELS (В МЕНЮ / БЕСПЛАТНЫЕ) ---
  { 
    key: "deepseek", 
    pmodel: "deepseek/deepseek-chat", 
    label: { ru: "DeepSeek V3", en: "DeepSeek V3", ro: "DeepSeek V3" }, 
    tier: "free",
    vision: false 
  },
  { 
    key: "deepseek_r1", 
    pmodel: "deepseek/deepseek-r1", 
    label: { ru: "DeepSeek R1 (Logic)", en: "DeepSeek R1 (Logic)", ro: "DeepSeek R1 (Logic)" }, 
    tier: "free",
    vision: false 
  },
  { 
    key: "gemini_flash", 
    pmodel: "google/gemini-2.0-flash-exp:free", 
    label: { ru: "Gemini 2.0 Flash", en: "Gemini 2.0 Flash", ro: "Gemini 2.0 Flash" }, 
    tier: "free",
    vision: true 
  },
  { 
    key: "grok_fast", 
    pmodel: "x-ai/grok-4", // Используем Grok 4 (или fast версию, если появится ID)
    label: { ru: "Grok 4 (Fun)", en: "Grok 4 (Fun)", ro: "Grok 4 (Fun)" }, 
    tier: "free", // Дешевый, можно в Free
    vision: false 
  },

  // --- 🔒 PREMIUM CHAT MODELS (В МЕНЮ / ПЛАТНЫЕ) ---
  { 
    key: "gpt4o", 
    pmodel: "openai/gpt-4o", 
    label: { ru: "GPT-4 Omni", en: "GPT-4 Omni", ro: "GPT-4 Omni" }, 
    tier: "pro",
    vision: true 
  },
  { 
    key: "claude", 
    pmodel: "anthropic/claude-3.5-sonnet", 
    label: { ru: "Claude 3.5 Sonnet", en: "Claude 3.5 Sonnet", ro: "Claude 3.5 Sonnet" }, 
    tier: "pro",
    vision: true 
  },
  { 
    key: "gpt5mini", 
    pmodel: "openai/gpt-5-image-mini", 
    label: { ru: "GPT-5 Image Mini", en: "GPT-5 Image Mini", ro: "GPT-5 Image Mini" }, 
    tier: "pro",
    vision: true 
  },
  { 
    key: "sonar_reasoning", 
    pmodel: "perplexity/sonar-reasoning", 
    label: { ru: "🌐 Web Search", en: "🌐 Web Search", ro: "🌐 Web Search" }, 
    tier: "pro",
    vision: false 
  },

  // --- ⚙️ BACKGROUND MODELS (СКРЫТЫЕ / ТЕХНИЧЕСКИЕ) ---
  // Они нужны для логики, но не нужны кнопками в меню
  
  // Документы (Docs)
  { key: "gemini_lite", pmodel: "google/gemini-2.0-flash-lite-preview-02-05", tier: "free", isHidden: true },
  
  // Аудио (Audio Input)
  { key: "voxtral", pmodel: "mistralai/mistral-voxtral-24b", tier: "free", isHidden: true },
  
  // Видео Анализ (Video Vision)
  { key: "nematron", pmodel: "nvidia/nematron-nano-12b", tier: "free", isHidden: true, vision: true },

  // Генерация Картинок (Image Gen)
  { key: "nanobanana", pmodel: "google/gemini-2.5-flash-image-nano-banana", tier: "free", isHidden: true },
  { key: "qwen_img", pmodel: "qwen/qwen-vl-max", tier: "free", isHidden: true }, // Пример ID для Qwen Image

  // Генерация Видео (Video Gen)
  { key: "ovi", pmodel: "ovi/ovi-1", tier: "free", isHidden: true },
  { key: "wan", pmodel: "wan/wan-2.5", tier: "free", isHidden: true },
  { key: "kling", pmodel: "kling/kling-2.5-turbo", tier: "pro", isHidden: true }
];


// Вспомогательные функции
function resolvePModelByKey(key) {
  return GPT_MODELS.find(x => x.key === key)?.pmodel || null;
}

function findKeyByPModel(pmodel) {
  return GPT_MODELS.find(x => x.pmodel === pmodel)?.key || null;
}

function isProKey(key) {
  return GPT_MODELS.find(x => x.key === key)?.tier === "pro";
}

// Проверка: умеет ли модель видеть картинки
function isVisionModel(key) {
  return GPT_MODELS.find(x => x.key === key)?.vision === true;
}

// Получить модель для конкретной задачи (аудио, видео, доки)
function getModelForTask(task) {
    if (task === 'audio_input') return 'voxtral';
    if (task === 'video_input') return 'nematron';
    if (task === 'doc_heavy') return 'gemini_lite';
    if (task === 'image_gen') return 'nanobanana';
    if (task === 'video_gen') return 'ovi'; // Дефолт эконом
    return null;
}

function premiumMsg(lang) {
  if (lang === "ro") return "Acest model este disponibil în Premium. Cumpără /premium.";
  if (lang === "en") return "This model is Premium only. Purchase /premium.";
  return "Эта модель доступна в премиум‑подписке. Оформите /premium.";
}

function gptKeyboard(lang, selectedKey, hasPremiumFn) {
  const buttons = [];
  const perRow = 2; 

  // Фильтруем: показываем только те, у которых НЕТ флага isHidden
  const visibleModels = GPT_MODELS.filter(m => !m.isHidden);

  function getLabel(item) {
    const base = item.label[lang] || item.label.en || item.key;
    const locked = item.tier === "pro" && (hasPremiumFn && !hasPremiumFn());
    
    if (selectedKey === item.key) return `✅ ${base}`;
    if (locked) return `🔒 ${base}`;
    return base;
  }

  let currentRow = [];
  for (let i = 0; i < visibleModels.length; i++) {
    const item = visibleModels[i];
    currentRow.push({
      text: getLabel(item),
      callback_data: `model_${item.key}`
    });

    if (currentRow.length === perRow || i === visibleModels.length - 1) {
      buttons.push(currentRow);
      currentRow = [];
    }
  }

  const backText = lang === "ro" ? "⬅️ Înapoi" : lang === "en" ? "⬅️ Back" : "⬅️ Назад";
  buttons.push([{ text: backText, callback_data: "menu_gpt" }]);

  return {
    inline_keyboard: buttons
  };
}

module.exports = {
  GPT_MODELS,
  resolvePModelByKey,
  findKeyByPModel,
  isProKey,
  isVisionModel,
  getModelForTask, // Новая функция для роутера
  premiumMsg,
  gptKeyboard
};
  
