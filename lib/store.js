import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis = (url && token) ? new Redis({ url, token }) : null;

const HIST_TTL = 60 * 60 * 24 * 7; // 7 дней
const HIST_LIMIT = 14; // храним ~7 последних пар сообщений

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

export async function getUserModel(userId) {
  if (!redis) return null;
  return await redis.get(`model:${userId}`);
}

export async function setUserModel(userId, model) {
  if (!redis) return;
  const key = `model:${userId}`;
  await redis.set(key, model);
  await redis.expire(key, 60 * 60 * 24 * 30); // хранить выбор 30 дней
}
