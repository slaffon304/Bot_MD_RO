// lib/models.js

// Каталог моделей "Dream Team" 2025
const GPT_MODELS = [
  // ==============================================
  // 🔒 PREMIUM TIER (С ЗАМОЧКОМ)
  // ==============================================
  { 
    key: "gpt5mini", 
    pmodel: "openai/gpt-5-image-mini", 
    label: { ru: "GPT-5.1", en: "GPT-5.1", ro: "GPT-5.1" }, 
    tier: "pro",
    vision: true 
  },
  { 
    key: "claude", 
    pmodel: "anthropic/claude-3.5-sonnet", // ID пока 3.5, но лейбл ставим как ты просил
    label: { ru: "Claude 4.5 Sonnet", en: "Claude 4.5 Sonnet", ro: "Claude 4.5 Sonnet" }, 
    tier: "pro",
    vision: true 
  },
  { 
    key: "sonar_reasoning", 
    pmodel: "perplexity/sonar-reasoning", 
    label: { ru: "Sonar (Web Search)", en: "Sonar (Web Search)", ro: "Sonar (Web Search)" }, 
    tier: "pro",
    vision: false 
  },
  { 
    key: "gemini3_pro", 
    pmodel: "google/gemini-2.0-pro-exp-02-05:free", // Используем самую новую Pro версию как базу
    label: { ru: "Gemini 3 Pro", en: "Gemini 3 Pro", ro: "Gemini 3 Pro" }, 
    tier: "pro",
    vision: true 
  },

  // ==============================================
  // 🟢 FREE TIER (БЕСПЛАТНЫЕ)
  // ==============================================
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
    label: { ru: "DeepSeek R1", en: "DeepSeek R1", ro: "DeepSeek R1" }, 
    tier: "free",
    vision: false 
  },
  { 
    key: "grok_fast", 
    pmodel: "x-ai/grok-4", 
    label: { ru: "Grok 4 Fast", en: "Grok 4 Fast", ro: "Grok 4 Fast" }, 
    tier: "free", 
    vision: false 
  },
  { 
    key: "gemini_flash", 
    pmodel: "google/gemini-2.0-flash-exp:free", 
    label: { ru: "Gemini 2.5 Flash", en: "Gemini 2.5 Flash", ro: "Gemini 2.5 Flash" }, 
    tier: "free",
    vision: true 
  },

  // ==============================================
  // ⚙️ BACKGROUND MODELS (СКРЫТЫЕ / ТЕХНИЧЕСКИЕ)
  // ==============================================
  
  // Документы
  { key: "gemini_lite", pmodel: "google/gemini-2.0-flash-lite-preview-02-05", tier: "free", isHidden: true },
  
  // Аудио
  { key: "voxtral", pmodel: "mistralai/mistral-voxtral-24b", tier: "free", isHidden: true },
  
  // Видео Анализ
  { key: "nematron", pmodel: "nvidia/nematron-nano-12b", tier: "free", isHidden: true, vision: true },

  // Генерация Картинок
  { key: "nanobanana", pmodel: "google/gemini-2.5-flash-image-nano-banana", tier: "free", isHidden: true },
  { key: "qwen_img", pmodel: "qwen/qwen-vl-max", tier: "free", isHidden: true },

  // Генерация Видео
  { key: "ovi", pmodel: "ovi/ovi-1", tier: "free", isHidden: true },
  { key: "wan", pmodel: "wan/wan-2.5", tier: "free", isHidden: true },
  { key: "kling", pmodel: "kling/kling-2.5-turbo", tier: "pro", isHidden: true }
];


// --- ФУНКЦИИ ---

function resolvePModelByKey(key) {
  return GPT_MODELS.find(x => x.key === key)?.pmodel || null;
}

function findKeyByPModel(pmodel) {
  return GPT_MODELS.find(x => x.pmodel === pmodel)?.key || null;
}

function isProKey(key) {
  return GPT_MODELS.find(x => x.key === key)?.tier === "pro";
}

function isVisionModel(key) {
  return GPT_MODELS.find(x => x.key === key)?.vision === true;
}

function getModelForTask(task) {
    if (task === 'audio_input') return 'voxtral';
    if (task === 'video_input') return 'nematron';
    if (task === 'doc_heavy') return 'gemini_lite';
    if (task === 'image_gen') return 'nanobanana';
    if (task === 'video_gen') return 'ovi';
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

  // Фильтруем скрытые
  const visibleModels = GPT_MODELS.filter(m => !m.isHidden);

  function getLabel(item) {
    const base = item.label[lang] || item.label.en || item.key;
    // Замок ставим только если это PRO и у юзера НЕТ премиума
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

  return { inline_keyboard: buttons };
}

module.exports = {
  GPT_MODELS,
  resolvePModelByKey,
  findKeyByPModel,
  isProKey,
  isVisionModel,
  getModelForTask,
  premiumMsg,
  gptKeyboard
};
  
