// lib/models.js

// Каталог моделей: key — внутренний ключ кнопки, pmodel — реальное имя модели у провайдера
const GPT_MODELS = [
  { key: "chatgpt5",    label: { ru: "ChatGPT 5",        ro: "ChatGPT 5",        en: "ChatGPT 5" },        pmodel: "openai/gpt-4o",                  tier: "pro"  },
  { key: "gpt5_0",      label: { ru: "GPT 5.0",          ro: "GPT 5.0",          en: "GPT 5.0" },          pmodel: "openai/gpt-4o",                  tier: "pro"  },
  { key: "gpt4o",       label: { ru: "GPT 4o",           ro: "GPT 4o",           en: "GPT 4o" },           pmodel: "openai/gpt-4o",                  tier: "pro"  },

  { key: "o3",          label: { ru: "OpenAI o3",        ro: "OpenAI o3",        en: "OpenAI o3" },        pmodel: "openai/gpt-4o",                  tier: "pro"  },
  { key: "o4mini",      label: { ru: "OpenAI o4 mini",   ro: "OpenAI o4 mini",   en: "OpenAI o4 mini" },   pmodel: "openai/gpt-4o-mini",             tier: "pro"  },

  { key: "gpt5mini",    label: { ru: "GPT 5 mini",       ro: "GPT 5 mini",       en: "GPT 5 mini" },       pmodel: "openai/gpt-4o-mini",             tier: "free" },
  { key: "gpt41",       label: { ru: "GPT 4.1",          ro: "GPT 4.1",          en: "GPT 4.1" },          pmodel: "openai/gpt-4o",                  tier: "pro"  },

  { key: "deepseek",    label: { ru: "DeepSeek V3.2",    ro: "DeepSeek V3.2",    en: "DeepSeek V3.2" },    pmodel: "deepseek/deepseek-chat",         tier: "free" },
  { key: "deepthink",   label: { ru: "DeepSeek Thinking",ro: "DeepSeek Thinking",en: "DeepSeek Thinking" },pmodel: "deepseek/deepseek-reasoner",     tier: "pro"  },

  { key: "claude_s",    label: { ru: "Claude 4.5 Sonnet",ro: "Claude 4.5 Sonnet",en: "Claude 4.5 Sonnet" },pmodel: "anthropic/claude-3.5-sonnet",     tier: "free" },
  { key: "claude_t",    label: { ru: "Claude 4.5 Thinking",ro:"Claude 4.5 Thinking",en:"Claude 4.5 Thinking"},pmodel:"anthropic/claude-3.5-sonnet",     tier: "pro"  },

  { key: "gemini_pro",  label: { ru: "Gemini 2.5 Pro",   ro: "Gemini 2.5 Pro",   en: "Gemini 2.5 Pro" },   pmodel: "google/gemini-1.5-pro-latest",   tier: "pro"  },
  { key: "gemini_flash",label: { ru: "Gemini 2.5 Flash", ro: "Gemini 2.5 Flash", en: "Gemini 2.5 Flash" }, pmodel: "google/gemini-1.5-flash-latest",  tier: "free" }
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
    // Проверка на блокировку (если есть функция проверки премиума)
    const locked = item.tier === "pro" && (hasPremiumFn && !hasPremiumFn());
    
    if (selectedKey === item.key) return `✅ ${base}`;
    if (locked) return `🔒 ${base}`;
    return base;
  }

  // Формируем сетку кнопок
  let currentRow = [];
  for (let i = 0; i < GPT_MODELS.length; i++) {
    const item = GPT_MODELS[i];
    currentRow.push({
      text: getLabel(item),
      callback_data: `model_${item.key}` // ВАЖНО: префикс model_ нужен для webhook.js
    });

    if (currentRow.length === perRow || i === GPT_MODELS.length - 1) {
      buttons.push(currentRow);
      currentRow = [];
    }
  }

  // Кнопка назад
  const backText = lang === "ro" ? "⬅️ Înapoi" : lang === "en" ? "⬅️ Back" : "⬅️ Назад";
  buttons.push([{ text: backText, callback_data: "menu_gpt" }]); // menu_gpt вернет в меню чата

  // Возвращаем объект клавиатуры для Telegraf
  return {
    inline_keyboard: buttons
  };
}

// Экспорт для CommonJS (Node.js)
module.exports = {
  GPT_MODELS,
  resolvePModelByKey,
  findKeyByPModel,
  isProKey,
  premiumMsg,
  gptKeyboard
};
        
