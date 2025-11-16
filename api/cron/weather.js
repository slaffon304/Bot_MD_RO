// Ежедневная рассылка прогноза в 06:00 по времени RO/MD.
// Защищено секретом SETUP_SECRET (как у set-webhook).
export default async function handler(req, res) {
  try {
    const secret = process.env.SETUP_SECRET || "";
    if (secret && req.query.secret !== secret) {
      return res.status(403).json({ ok:false, error:"FORBIDDEN" });
    }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(200).json({ ok:false, error:"NO_BOT_TOKEN" });

    // Проверка локального времени Europe/Bucharest == Europe/Chisinau
    const hourLocal = Number(new Date().toLocaleString("en-GB", { hour:"2-digit", hour12:false, timeZone:"Europe/Bucharest" }));
    if (hourLocal !== 6) {
      return res.status(200).json({ ok:true, skipped:true, hourLocal });
    }

    const { getWeatherSubscribers, getUserCity, getUserLang } = await import("../../lib/store.js");
    // Мелкая функция погоды
    async function weather(lat, lon) {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`);
      if (!r.ok) return null;
      const j = await r.json();
      return j.current_weather ? { t:j.current_weather.temperature, wind:j.current_weather.windspeed, code:j.current_weather.weathercode } : null;
    }
    function codeText(code, lang="ru") {
      const map = { 0:{ru:"ясно",ro:"senin",en:"clear"}, 1:{ru:"в осн. ясно",ro:"mai mult senin",en:"mainly clear"},
        2:{ru:"перем. облачность",ro:"parțial noros",en:"partly cloudy"}, 3:{ru:"пасмурно",ro:"înnorat",en:"overcast"},
        61:{ru:"дождь",ro:"ploaie",en:"rain"}, 63:{ru:"дождь",ro:"ploaie",en:"rain"}, 65:{ru:"ливень",ro:"ploaie put.",en:"heavy rain"},
        80:{ru:"ливни",ro:"averse",en:"showers"}, 95:{ru:"гроза",ro:"furtună",en:"thunderstorm"} };
      return (map[code]?.[lang]) || (map[code]?.en) || "—";
    }

    const subs = await getWeatherSubscribers();
    let sent = 0, prompts = 0;
    for (const uid of subs) {
      try {
        const city = await getUserCity(uid);
        const lc = (await getUserLang(uid)) || "ru";
        if (!city) {
          // напомнить указать город
          const text = lc==="ro"
            ? "Setează orașul cu /setcity sau trimite locația în chat, ca să-ți trimit prognoza la 06:00."
            : lc==="en"
              ? "Set your city with /setcity or send location, so I can send the 06:00 forecast."
              : "Укажи город через /setcity или отправь геолокацию, чтобы я присылал прогноз в 06:00.";
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method:"POST", headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({ chat_id: uid, text })
          });
          prompts++;
          continue;
        }
        const w = await weather(city.lat, city.lon);
        if (!w) continue;
        const txt = lc==="ro"
          ? `Prognoză la 06:00 pentru ${city.name}:\n• ${w.t}°C, vânt ${w.wind} m/s, ${codeText(w.code,"ro")}\nZi bună!`
          : lc==="en"
            ? `06:00 forecast for ${city.name}:\n• ${w.t}°C, wind ${w.wind} m/s, 
