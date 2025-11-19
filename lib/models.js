// lib/models.js

// Каталог моделей "Dream Team" 2025
const GPT_MODELS = [
  // --- 🟢 FREE TIER (Бесплатные) ---
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
    vision: true // Видит картинки!
  },

  // --- 🔒 PREMIUM TIER (Платные) ---
  { 
    key: "gpt4o", 
    pmodel: "openai/gpt-4o", 
    label: { ru: "GPT-4 Omni", en: "GPT-4 Omni", ro: "GPT-4 Omni" }, 
    tier: "pro",
    vision: true 
  },
  { 
    key: "gpt5mini", 
    pmodel: "openai/gpt-5-image-mini", // Тот самый дешевый для генерации, но дорогой на вход
    label: { ru: "GPT-5 Image Mini", en: "GPT-5 Image Mini", ro: "GPT-5 Image Mini" }, 
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
    key: "grok", 
    pmodel: "x-ai/grok-2-1212", 
    label: { ru: "Grok 2 (Fun)", en: "Grok 2 (Fun)", ro: "Grok 2 (Fun)" }, 
    tier: "pro",
    vision: false 
  },
  
  // --- 🌐 WEB & TOOLS (Спецзадачи) ---
  { 
    key: "sonar", 
    pmodel: "perplexity/sonar-reasoning", 
    label: { ru: "Web Search (Sonar)", en: "Web Search (Sonar)", ro: "Web Search (Sonar)" }, 
    tier: "pro",
    vision: false 
  },
  { 
    key: "flux", 
    pmodel: "black-forest-labs/flux-schnell", 
    label: { ru: "Flux Gen (Image)", en: "Flux Gen (Image)", ro: "Flux Gen (Image)" }, 
    tier: "free", // Можно ограничить лимитами позже
    vision: false 
  }
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

function premiumMsg(lang) {
  if (lang === "ro") return "Acest model este disponibil în Premium. Cumpără /premium.";
  if (lang === "en") return "This model is Premium only. Purchase /premium.";
  return "Эта модель доступна в премиум‑подписке. Оформите /premium.";
}

function gptKeyboard(lang, selectedKey, hasPremiumFn) {
  const buttons = [];
  const perRow = 2; 

  function getLabel(item) {
    const base = item.label[lang] || item.label.en || item.key;
    // Замок ставим только если это PRO и у юзера НЕТ премиума
    const locked = item.tier === "pro" && (hasPremiumFn && !hasPremiumFn());
    
    if (selectedKey === item.key) return `✅ ${base}`;
    if (locked) return `🔒 ${base}`;
    return base;
  }

  let currentRow = [];
  for (let i = 0; i < GPT_MODELS.length; i++) {
    const item = GPT_MODELS[i];
    currentRow.push({
      text: getLabel(item),
      callback_data: `model_${item.key}`
    });

    if (currentRow.length === perRow || i === GPT_MODELS.length - 1) {
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
  isVisionModel, // Экспортируем новую функцию
  premiumMsg,
  gptKeyboard
};
