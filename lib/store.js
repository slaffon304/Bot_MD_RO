import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
export const redis = (url && token) ? new Redis({ url, token }) : null;

// История чата
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
  await redis.expire(`model:${userId}`, 60 * 60 * 24 * 30);
}

// Язык
export async function getUserLang(userId) {
  if (!redis) return null;
  return await redis.get(`lang:${userId}`);
}
export async function setUserLang(userId, lang) {
  if (!redis) return;
  await redis.set(`lang:${userId}`, lang);
}

// Флаг “язык выбран вручную”
export async function setLangManual(userId, manual) {
  if (!redis) return;
  await redis.set(`langman:${userId}`, manual ? "1" : "0");
}
export async function isLangManual(userId) {
  if (!redis) return false;
  return (await redis.get(`langman:${userId}`)) === "1";
}

// Город
export async function setCity(userId, city) {
  if (!redis) return;
  await redis.set(`city:${userId}`, city); // { name, lat, lon }
}
export async function getCity(userId) {
  if (!redis) return null;
  return await redis.get(`city:${userId}`);
}

// Подписки и чат
export async function subscribeWeather(userId, chatId) {
  if (!redis) return;
  await redis.sadd("subs:weather", String(userId));
  await redis.set(`chat:${userId}`, String(chatId));
}
export async function unsubscribeWeather(userId) {
  if (!redis) return;
  await redis.srem("subs:weather", String(userId));
}
export async function getWeatherSubs() {
  if (!redis) return [];
  const ids = await redis.smembers("subs:weather");
  return Array.isArray(ids) ? ids : [];
}
export async function getChatForUser(userId) {
  if (!redis) return null;
  return await redis.get(`chat:${userId}`);
}

// Метки «уже отправлено сегодня»
export async function wasWeatherSentToday(userId, dateStr) {
  if (!redis) return false;
  return (await redis.get(`wlast:${userId}`)) === dateStr;
}
export async function markWeatherSentToday(userId, dateStr) {
  if (!redis) return;
  await redis.set(`wlast:${userId}`, dateStr);
  await redis.expire(`wlast:${userId}`, 60 * 60 * 24 * 2);
}

// Ожидание ввода города после /setcity (TTL 10 мин)
export async function setAwaitingCity(userId, ttlSec = 600) {
  if (!redis) return;
  await redis.set(`await:city:${userId}`, "1");
  await redis.expire(`await:city:${userId}`, ttlSec);
}
export async function isAwaitingCity(userId) {
  if (!redis) return false;
  return (await redis.get(`await:city:${userId}`)) === "1";
}
export async function clearAwaitingCity(userId) {
  if (!redis) return;
  await redis.del(`await:city:${userId}`);
                              }
