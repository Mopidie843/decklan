'use strict';
// Météo via Open-Meteo (gratuit, sans clé). Ville -> coordonnées -> température actuelle.
const CODES = [
  [[0], '☀️'], [[1, 2], '🌤️'], [[3], '☁️'], [[45, 48], '🌫️'], [[51, 53, 55, 56, 57], '🌦️'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️'],
  [[71, 73, 75, 77, 85, 86], '❄️'], [[95, 96, 99], '⛈️'],
];
const iconFor = (code) => { for (const [list, icon] of CODES) if (list.includes(code)) return icon; return '🌡️'; };

async function getJson(url, f) {
  const res = await f(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Retourne { t: 18, icon: '☀️', city: 'Cavaillon' } ; geo est mis en cache par l'appelant.
async function fetchWeather(city, geo, f = fetch) {
  let g = geo;
  if (!g || g.city !== city) {
    const r = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr`, f);
    const hit = r && r.results && r.results[0];
    if (!hit) throw new Error('Ville introuvable : ' + city);
    g = { city, lat: hit.latitude, lon: hit.longitude, name: hit.name };
  }
  const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&current=temperature_2m,weather_code`, f);
  const cur = w && w.current;
  if (!cur) throw new Error('Réponse météo invalide');
  return { geo: g, weather: { t: Math.round(cur.temperature_2m), icon: iconFor(cur.weather_code), city: g.name } };
}

module.exports = { fetchWeather, iconFor };
