// lib/models.js

// Каталог моделей: key — внутренний ключ кнопки, pmodel — реальное имя модели у провайдера
const GPT_MODELS = [
  // OpenAI
  { key: "o3",          label: { ru: "OpenAI o3", en: "OpenAI o3", ro: "OpenAI o3" },             tier: "pro" },
  { key: "o4mini",      label: { ru: "OpenAI o4 mini", en: "OpenAI o4 mini", ro: "OpenAI o4 mini" }, tier: "pro" },
  
  { key: "chatgpt5",    label: { ru: "ChatGPT 5", en: "ChatGPT 5", ro: "ChatGPT 5" },             tier: "pro" },
  { key: "gpt5",        label: { ru: "GPT 5", en: "GPT 5", ro: "GPT 5" },                         tier: "pro" },
  { key: "gpt5mini",    label: { ru: "GPT 5 mini", en: "GPT 5 mini", ro: "GPT 5 mini" },          tier: "free" }, // FREE
  
  { key: "gpt4o",       label: { ru: "GPT 4o", en: "GPT 4o", ro: "GPT 4o" },                      tier: "pro" },
  { key: "gpt41",       label: { ru: "GPT 4.1", en: "GPT 4.1", ro: "GPT 4.1" },                   tier: "pro" },

  // Anthropic
  { key: "claude_s",    label: { ru: "Claude 4.5 Sonnet", en: "Claude 4.5 Sonnet", ro: "Claude 4.5 Sonnet" }, tier: "pro" },
  { key: "claude_t",    label: { ru: "Claude 4.5 Thinking", en: "Claude 4.5 Thinking", ro: "Claude 4.5 Think" }, tier: "pro" },

  // DeepSeek
  { key: "deepseek",    label: { ru: "DeepSeek V3.2", en: "DeepSeek V3.2", ro: "DeepSeek V3.2" }, tier: "free" }, // FREE
  { key: "deepthink",   label: { ru: "DeepSeek Reasoner", en: "DeepSeek Reasoner", ro: "DeepSeek Reasoner" }, tier: "pro" },

  // Google
  { key: "gemini_pro",  label: { ru: "Gemini 2.5 Pro", en: "Gemini 2.5 Pro", ro: "Gemini 2.5 Pro" }, tier: "pro" },
  { key: "gemini_flash",label: { ru: "Gemini 2.5 Flash", en: "Gemini 2.5 Flash", ro: "Gemini 2.5 Flash" }, tier: "free" } // FREE
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
        
