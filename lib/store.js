const { Redis } = require("@upstash/redis");

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = (url && token) ? new Redis({ url, token }) : null;

const HIST_TTL = 60 * 60 * 24 * 7; // 7 дней
const HIST_LIMIT = 10; // Храним 10 последних сообщений (5 пар)

// --- ФУНКЦИИ ---

async function getHistory(chatId) {
  if (!redis) return [];
  const key = `hist:${chatId}`;
  try {
      const raw = await redis.get(key);
      
      // Проверка: если пусто
      if (!raw) return [];
      
      // Проверка: если это массив, возвращаем его
      if (Array.isArray(raw)) return raw;
      
      // Проверка: если это объект (иногда бывает), пробуем превратить в массив
      if (typeof raw === 'object') return [raw];

      return [];
  } catch (e) {
      console.error(`[Store] Get History Error for ${chatId}:`, e);
      return [];
  }
}

// Сохраняет сразу пару сообщений (User + AI)
async function updateConversation(chatId, userMsg, aiMsg) {
  if (!redis) return;
  const key = `hist:${chatId}`;
  
  try {
      // 1. Берем старую историю
      let hist = await getHistory(chatId);
      
      // 2. Добавляем новые сообщения
      if (userMsg) hist.push(userMsg);
      if (aiMsg) hist.push(aiMsg);
      
      // 3. Обрезаем лишнее (оставляем последние N)
      if (hist.length > HIST_LIMIT) {
        hist = hist.slice(hist.length - HIST_LIMIT);
      }
      
      // 4. Сохраняем
      await redis.set(key, hist);
      await redis.expire(key, HIST_TTL);
      
      console.log(`[Store] Saved history for ${chatId}. New length: ${hist.length}`);
  } catch (e) {
      console.error("[Store] Save Error:", e);
  }
}

async function clearHistory(chatId) {
  if (!redis) return;
  await redis.del(`hist:${chatId}`);
}

// --- ПОЛЬЗОВАТЕЛЬ ---
// (Остальные функции без изменений, но для надежности дублирую)

async function getUserLang(userId) {
  if (!redis) return null;
  return await redis.get(`lang:${userId}`);
}

async function setUserLang(userId, lang) {
  if (!redis) return;
  await redis.set(`lang:${userId}`, lang);
}

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

module.exports = {
    getHistory,
    updateConversation,
    clearHistory,
    getUserLang,
    setUserLang,
    getUserModel,
    setUserModel,
    redis
};
