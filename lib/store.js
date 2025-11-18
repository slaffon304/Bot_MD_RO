// Используем require вместо import
const { Redis } = require("@upstash/redis");

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

// Создаем подключение, если есть ключи
const redis = (url && token) ? new Redis({ url, token }) : null;

const HIST_TTL = 60 * 60 * 24 * 7; // 7 дней
const HIST_LIMIT = 14; 

// --- ФУНКЦИИ ---

async function getHistory(chatId) {
  if (!redis) return [];
  const key = `hist:${chatId}`;
  const arr = await redis.get(key);
  return Array.isArray(arr) ? arr : [];
}

async function saveHistory(chatId, messages) {
  if (!redis) return;
  const key = `hist:${chatId}`;
  await redis.set(key, messages);
  await redis.expire(key, HIST_TTL);
}

async function pushMessage(chatId, message) {
  const hist = await getHistory(chatId);
  hist.push(message);
  if (hist.length > HIST_LIMIT) {
    const extra = hist.length - HIST_LIMIT;
    hist.splice(0, extra);
  }
  await saveHistory(chatId, hist);
}

async function clearHistory(chatId) {
  if (!redis) return;
  await redis.del(`hist:${chatId}`);
}

async function getUserModel(userId) {
  if (!redis) return null;
  return await redis.get(`model:${userId}`);
}

async function setUserModel(userId, model) {
  if (!redis) return;
  const key = `model:${userId}`;
  await redis.set(key, model);
  await redis.expire(key, 60 * 60 * 24 * 30); // 30 дней
}

async function getUserLang(userId) {
  if (!redis) return null;
  return await redis.get(`lang:${userId}`);
}

async function setUserLang(userId, lang) {
  if (!redis) return;
  await redis.set(`lang:${userId}`, lang);
}

// --- ЭКСПОРТ (Главное изменение) ---
module.exports = {
    getHistory,
    saveHistory,
    pushMessage,
    clearHistory,
    getUserModel,
    setUserModel,
    getUserLang,
    setUserLang,
    redis
};
