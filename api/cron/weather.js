import {
  getWeatherSubs,
  getChatForUser,
  getCity,
  getUserLang,
  wasWeatherSentToday,
  markWeatherSentToday,
} from "../../lib/store.js";

function nowInTZ(tz) {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
  const parts = fmt.formatToParts(d).reduce((a, p) => ((a[p.type] = p.value), a), {});
  return { hh: Number(parts.hour), mm: Number(parts.minute), ymd: `${parts.year}-${parts.month}-${parts.day}` };
}

async function reverseGeocode(lat, lon, lang) {
  try {
    const u = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=${lang || "en"}&count=1`;
    const r = await fetch(u);
    const j = await r.json();
    const g = j?.results?.[0];
    return g ? `${g.name}${g.country ? ", " + g.country : ""}` : null;
  } catch {
    return null;
  }
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,precipitation,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
  const r = await fetch(url);
  return await r.json();
}

function formatWeather(w, lang, place) {
  const t = w?.current_weather?.temperature;
  const ws = w?.current_weather?.windspeed;
  const maxt = w?.daily?.temperature_2m_max?.[0];
  const mint = w?.daily?.temperature_2m_min?.[0];
  const pr = w?.daily?.precipitation_probability_max?.[0];

  const L = {
    ru: () => `Погода: ${place}
• Сейчас: ${t}°C, ветер ${ws} м/с
• Днём: ${maxt}°C, ночью: ${mint}°C
• Вероятность осадков: ${pr}%
Совет: ${pr > 60 ? "зонт пригодится ☔" : "осадки маловероятны"}; ${ws > 8 ? "ветрено, оденьтесь теплее 🌬" : "ветер слабый/умеренный"}`,
    ro: () => `Meteo: ${place}
• Acum: ${t}°C, vânt ${ws} m/s
• Zi: ${maxt}°C, noapte: ${mint}°C
• Prob. precipitații: ${pr}%
Recomandare: ${pr > 60 ? "ia o umbrelă ☔" : "șanse mici de ploaie"}; ${ws > 8 ? "vânt puternic, îmbracă-te mai gros 🌬" : "vânt slab/moderat"}`,
    en: () => `Weather: ${place}
• Now: ${t}°C, wind ${ws} m/s
• Day: ${maxt}°C, night: ${mint}°C
• Precipitation chance: ${pr}%
Tip: ${pr > 60 ? "take an umbrella ☔" : "low chance of rain"}; ${ws > 8 ? "windy, dress warmer 🌬" : "light/moderate wind"}`
  };
  const f = L[lang] || L.en;
  return f();
}

async function sendTG(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

export default async function handler(req, res) {
  // Триггеры по UTC: 03:00 и 04:00. Шлём только когда локально около 06:00.
  const tzs = ["Europe/Chisinau", "Europe/Bucharest"];
  const shouldRun = tzs.some((tz) => {
    const { hh, mm } = nowInTZ(tz);
    return hh === 6 && mm <= 15; // 06:00–06:15
  });
  if (!shouldRun) return res.status(200).json({ ok: true, skipped: true });

  const subs = await getWeatherSubs();
  let sent = 0;

  for (const uid of subs) {
    try {
      const chatId = await getChatForUser(uid);
      const city = await getCity(uid); // { name, lat, lon }
      const lang = (await getUserLang(uid)) || "en";
      if (!chatId || !city?.lat || !city?.lon) continue;

      const { ymd } = nowInTZ("Europe/Chisinau");
      const already = await wasWeatherSentToday(uid, ymd);
      if (already) continue;

      const w = await fetchWeather(city.lat, city.lon);
      const place = city.name || (await reverseGeocode(city.lat, city.lon, lang)) || "—";
      const text = formatWeather(w, lang, place);
      await sendTG(chatId, text);
      await markWeatherSentToday(uid, ymd);
      sent++;

      if (sent >= 100) break; // ограничим рассылку на фритире
    } catch {
      // пропускаем ошибочных
    }
  }

  return res.status(200).json({ ok: true, sent });
}
