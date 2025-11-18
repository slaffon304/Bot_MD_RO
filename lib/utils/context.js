/**
 * Управление контекстом диалога
 */

const MAX_CONTEXT_MESSAGES = 20; // Последние 20 сообщений
const MAX_TOKENS_ESTIMATE = 8000; // Примерный лимит токенов

/**
 * Обрезка контекста до последних N сообщений
 */
function trimContext(messages, maxMessages = MAX_CONTEXT_MESSAGES) {
  if (!messages || messages.length === 0) {
    return [];
  }

  // Всегда оставляем system message (если есть)
  const systemMessage = messages[0]?.role === 'system' ? messages[0] : null;
  const userMessages = systemMessage ? messages.slice(1) : messages;

  // Берём последние N сообщений
  const trimmedMessages = userMessages.slice(-maxMessages);

  // Возвращаем с system message в начале
  return systemMessage 
    ? [systemMessage, ...trimmedMessages] 
    : trimmedMessages;
}

/**
 * Оценка количества токенов (примерная)
 * 1 токен ≈ 4 символа для английского, ≈ 2 для румынского
 */
function estimateTokens(messages) {
  let totalChars = 0;
  
  for (const msg of messages) {
    if (msg.content) {
      totalChars += msg.content.length;
    }
  }

  // Консервативная оценка: 2 символа = 1 токен
  return Math.ceil(totalChars / 2);
}

/**
 * Умное обрезание контекста по токенам
 */
function trimContextByTokens(messages, maxTokens = MAX_TOKENS_ESTIMATE) {
  if (!messages || messages.length === 0) {
    return [];
  }

  const systemMessage = messages[0]?.role === 'system' ? messages[0] : null;
  const userMessages = systemMessage ? messages.slice(1) : messages;

  let result = [];
  let currentTokens = 0;

  // Идём с конца (последние сообщения важнее)
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const msg = userMessages[i];
    const msgTokens = estimateTokens([msg]);

    if (currentTokens + msgTokens > maxTokens) {
      break;
    }

    result.unshift(msg);
    currentTokens += msgTokens;
  }

  return systemMessage ? [systemMessage, ...result] : result;
}

/**
 * Создание system prompt для разных режимов
 */
function createSystemPrompt(mode = 'default') {
  const prompts = {
    default: 'Ești un asistent AI util și prietenos. Răspunzi clar și concis în limba română.',
    
    academic: 'Ești un asistent academic expert. Oferă răspunsuri detaliate, bine structurate și științifice. Citează surse când este posibil.',
    
    creative: 'Ești un asistent creativ și imaginativ. Folosește un stil expresiv și captivant. Gândește în afara cutiei.',
    
    code: 'Ești un expert în programare. Oferă cod curat, bine comentat și explică soluțiile pas cu pas.',
    
    translate: 'Ești un traducător profesionist. Păstrează sensul, tonul și nuanțele textului original.',
    
    summarize: 'Ești un expert în sintetizare. Extrage cele mai importante idei și prezintă-le clar și concis.',
  };

  return prompts[mode] || prompts.default;
}

/**
 * Добавление system message в начало контекста
 */
function addSystemMessage(messages, mode = 'default') {
  const systemPrompt = createSystemPrompt(mode);
  
  // Проверяем есть ли уже system message
  if (messages.length > 0 && messages[0].role === 'system') {
    // Заменяем существующий
    return [
      { role: 'system', content: systemPrompt },
      ...messages.slice(1)
    ];
  }

  // Добавляем новый
  return [
    { role: 'system', content: systemPrompt },
    ...messages
  ];
}

/**
 * Подготовка контекста для отправки в API
 */
function prepareContext(messages, options = {}) {
  const {
    mode = 'default',
    maxMessages = MAX_CONTEXT_MESSAGES,
    maxTokens = MAX_TOKENS_ESTIMATE,
    useSystemPrompt = true,
  } = options;

  let context = [...messages];

  // Обрезаем по количеству сообщений
  context = trimContext(context, maxMessages);

  // Обрезаем по токенам
  context = trimContextByTokens(context, maxTokens);

  // Добавляем system prompt
  if (useSystemPrompt) {
    context = addSystemMessage(context, mode);
  }

  return context;
}

/**
 * Форматирование истории для отображения пользователю
 */
function formatContextSummary(messages) {
  const messageCount = messages.length;
  const estimatedTokens = estimateTokens(messages);
  
  return `📊 Istoric conversație:
• Mesaje: ${messageCount}
• Tokeni (estimare): ~${estimatedTokens}`;
}

module.exports = {
  trimContext,
  trimContextByTokens,
  estimateTokens,
  createSystemPrompt,
  addSystemMessage,
  prepareContext,
  formatContextSummary,
  MAX_CONTEXT_MESSAGES,
  MAX_TOKENS_ESTIMATE,
};
