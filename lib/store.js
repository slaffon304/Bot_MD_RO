const { Redis } = require("@upstash/redis");

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = (url && token) ? new Redis({ url, token }) : null;

const HIST_TTL = 60 * 60 * 24 * 7; // 7 дней
const HIST_LIMIT = 12; // Храним 12 сообщений (6 пар вопрос-ответ)

// --- ФУНКЦИИ ---

async function getHistory(chatId) {
  if (!redis) return [];
  const key = `hist:${chatId}`;
  try {
      const arr = await redis.get(key);
      return Array.isArray(arr) ? arr : [];
  } catch (e) {
      console.error("Redis Get Error:", e);
      return [];
  }
}

// Новая функция: Сохраняет сразу пару сообщений
async function updateConversation(chatId, userMsg, aiMsg) {
  if (!redis) return;
  const key = `hist:${chatId}`;
  
  try {
      // 1. Берем старую историю
      let hist = await getHistory(chatId);
      
      // 2. Добавляем новые сообщения
      hist.push(userMsg);
      if (aiMsg) hist.push(aiMsg);
      
      // 3. Обрезаем, если слишком длинная
      if (hist.length > HIST_LIMIT) {
        hist = hist.slice(hist.length - HIST_LIMIT);
      }
      
      // 4. Сохраняем обратно
      await redis.set(key, hist);
      await redis.expire(key, HIST_TTL);
      
      console.log(`[DB] History updated for ${chatId}. Length: ${hist.length}`);
  } catch (e) {
      console.error("Redis Save Error:", e);
  }
}

async function clearHistory(chatId) {
  if (!redis) return;
  await redis.del(`hist:${chatId}`);
}

// --- ПОЛЬЗОВАТЕЛЬ ---
async function getUserModel(userId) {
  if (!redis) return null;
  return await redis.get(`model:${userId}`);
}

async function setUserModel(userId, model) {
  if (!redis) return;
  const key = `model:${userId}`;
  await redis.set(key, model);
  await redis.expire(key, 60 * 60 * 24 * 30);
}

async function getUserLang(userId) {
  if (!redis) return null;
  return await redis.get(`lang:${userId}`);
}

async function setUserLang(userId, lang) {
  if (!redis) return;
  await redis.set(`lang:${userId}`, lang);
}

module.exports = {
    getHistory,
    updateConversation, // Используем эту новую функцию
    clearHistory,
    getUserModel,
    setUserModel,
    getUserLang,
    setUserLang,
    redis
};
  
