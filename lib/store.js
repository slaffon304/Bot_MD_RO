import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
export const redis = (url && token) ? new Redis({ url, token }) : null;

// Контекст диалога
const HIST_TTL = 60 * 60 * 24 * 7; // 7 дней
const HIST_LIMIT = 14;

export async function getHistory(chatId) {
  if (!redis) return [];
  const key = `hist:${chatId}`;
  const arr = await redis.get(key);
  return Array.isArray(arr) ? arr : [];
}
export async function saveHistory(chatId, messages) {
  if (!redis) return;
  const key = `hist:${chatId}`;
  await redis.set(key, messages);
  await redis.expire(key, HIST_TTL);
}
export async function pushMessage(chatId, message) {
  const hist = await getHistory(chatId);
  hist.push(message);
  if (hist.length > HIST_LIMIT) {
    const extra = hist.length - HIST_LIMIT;
    hist.splice(0, extra);
  }
  await saveHistory(chatId, hist);
}
export async function clearHistory(chatId) {
  if (!redis) return;
  await redis.del(`hist:${chatId}`);
}

// Модель пользователя
export async function getUserModel(userId) {
  if (!redis) return null;
  return await redis.get(`model:${userId}`);
}
export async function setUserModel(userId, model) {
  if (!redis) return;
  await redis.set(`model:${userId}`, model);
  await redis.expire(`model:${userId}`, 60 * 60 * 24 * 30); // 30 дней
}

// Язык
export async function setUserLang(userId, lang) {
  if (!redis) return;
  await redis.set(`lang:${userId}`, lang);
}
export async function getUserLang(userId) {
  if (!redis) return null;
  return await redis.get(`lang:${userId}`);
}

// Город (lat/lon)
export async function setUserCity(userId, cityObj) {
  if (!redis) return;
  await redis.set(`city:${userId}`, cityObj); // { name, lat, lon }
}
export async function getUserCity(userId) {
  if (!redis) return null;
  return await redis.get(`city:${userId}`);
}

// Подписки (утренний прогноз)
export async function subscribeWeather(userId) {
  if (!redis) return;
  await redis.sadd("subs:weather", String(userId));
}
export async function unsubscribeWeather(userId) {
  if (!redis) return;
  await redis.srem("subs:weather", String(userId));
}
export async function getWeatherSubscribers() {
  if (!redis) return [];
  return await redis.smembers("subs:weather");
  }
