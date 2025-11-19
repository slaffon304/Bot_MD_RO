const { Redis } = require("@upstash/redis");

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = (url && token) ? new Redis({ url, token }) : null;

const HIST_TTL = 60 * 60 * 24 * 7; // 7 дней
const HIST_LIMIT = 10; 

// --- ФУНКЦИИ ---

async function getHistory(chatId) {
  if (!redis) return [];
  const key = `hist:${chatId}`;
  try {
      // Получаем данные
      const data = await redis.get(key);
      
      // Если данных нет
      if (!data) return [];
      
      // Если Upstash вернул уже объект (массив)
      if (Array.isArray(data)) return data;
      
      // Если Upstash вернул объект-обертку (редкий случай)
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
      
      // Добавляем новые
      if (userMsg) hist.push(userMsg);
      if (aiMsg) hist.push(aiMsg);
      
      // Обрезаем
      if (hist.length > HIST_LIMIT) {
        hist = hist.slice(hist.length - HIST_LIMIT);
      }
      
      // ВАЖНО: Upstash REST клиент сам умеет сериализовать JSON.
      // Мы просто перезаписываем ключ.
      await redis.set(key, hist);
      await redis.expire(key, HIST_TTL);
      
      console.log(`[Store] Saved ${hist.length} msgs for ${chatId}`);
  } catch (e) {
      console.error("[Store] Save Error:", e);
  }
}

async function clearHistory(chatId) {
  if (!redis) return;
  await redis.del(`hist:${chatId}`);
}

// --- User settings ---

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

// --- Debug Function ---
async function getDebugData(userId) {
    if (!redis) return "Redis not connected";
    const model = await getUserModel(userId);
    const lang = await getUserLang(userId);
    const hist = await getHistory(userId);
    return JSON.stringify({ 
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
    getDebugData, // Новая функция
    redis
};
