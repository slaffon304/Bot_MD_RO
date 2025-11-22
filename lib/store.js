const { Redis } = require("@upstash/redis");

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = (url && token) ? new Redis({ url, token }) : null;

const HIST_TTL = 60 * 60 * 24 * 7; // 7 дней
const HIST_LIMIT = 60; 

// --- ФУНКЦИИ ИСТОРИИ ---

async function getHistory(chatId) {
  if (!redis) return [];
  const key = `hist:${chatId}`;
  try {
      const data = await redis.get(key);
      if (!data) return [];
      if (Array.isArray(data)) return data;
      if (typeof data === 'object') return [data];
      return [];
  } catch (e) {
      console.error(`[Store] Get Error:`, e);
      return [];
  }
}

async function updateConversation(chatId, userMsg, aiMsg) {
  if (!redis) return;
  const key = `hist:${chatId}`;
  try {
      let hist = await getHistory(chatId);
      if (userMsg) hist.push(userMsg);
      if (aiMsg) hist.push(aiMsg);
      if (hist.length > HIST_LIMIT) hist = hist.slice(hist.length - HIST_LIMIT);
      
      await redis.set(key, hist);
      await redis.expire(key, HIST_TTL);
  } catch (e) {
      console.error("[Store] Save Error:", e);
  }
}

async function clearHistory(chatId) {
  if (!redis) return;
  await redis.del(`hist:${chatId}`);
}

// --- ПОЛЬЗОВАТЕЛЬСКИЕ НАСТРОЙКИ ---

async function getUserModel(userId) {
  if (!redis) return null;
  return await redis.get(`model:${userId}`);
}

async function setUserModel(userId, model) {
  if (!redis) return;
  await redis.set(`model:${userId}`, model);
}

async function getUserLang(userId) {
  if (!redis) return null;
  return await redis.get(`lang:${userId}`);
}

async function setUserLang(userId, lang) {
  if (!redis) return;
  await redis.set(`lang:${userId}`, lang);
}

// --- НОВЫЕ ФУНКЦИИ: РЕЖИМЫ (Chat / Image) ---
async function getUserMode(userId) {
  if (!redis) return 'chat'; // По умолчанию обычный чат
  return await redis.get(`mode:${userId}`) || 'chat';
}

async function setUserMode(userId, mode) {
  if (!redis) return;
  // mode: 'chat', 'image', 'video', 'suno'
  await redis.set(`mode:${userId}`, mode);
}

// --- DEBUG ---
async function getDebugData(userId) {
    if (!redis) return "Redis not connected";
    const model = await getUserModel(userId);
    const lang = await getUserLang(userId);
    const mode = await getUserMode(userId); // Видим режим в отладке
    const hist = await getHistory(userId);
    return JSON.stringify({ 
        mode,
        model, 
        lang, 
        historyLength: hist.length, 
        lastMessage: hist.length > 0 ? hist[hist.length - 1] : "None" 
    }, null, 2);
}

module.exports = {
    getHistory,
    updateConversation,
    clearHistory,
    getUserModel,
    setUserModel,
    getUserLang,
    setUserLang,
    getUserMode, // Экспорт новой функции
    setUserMode, // Экспорт новой функции
    getDebugData,
    redis
};
  
