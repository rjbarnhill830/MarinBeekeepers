// Historical/forecast weather from Open-Meteo (https://open-meteo.com): free for
// non-commercial use, no API key, and callable straight from the browser.
//
// Weather is looked up for the apiary's *town* (not an exact location), falling back to
// central Marin, so no private coordinates are ever stored or sent anywhere.

import { daysSince } from './records.js';

const MARIN = { latitude: 37.9735, longitude: -122.5311, label: 'central Marin' };
const TZ = 'America/Los_Angeles';

// WMO weather interpretation codes → short descriptions.
const WMO = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow', 80: 'Rain showers', 81: 'Rain showers',
  82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

const towns = new Map();

async function locate(town) {
  const name = town?.trim();
  if (!name) return MARIN;
  if (!towns.has(name)) {
    towns.set(name, (async () => {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?count=10&country_code=US&name=${encodeURIComponent(name)}`;
        const { results = [] } = await (await fetch(url)).json();
        const ca = results.filter(r => r.admin1 === 'California');
        const hit = ca.find(r => /Marin/.test(r.admin2 ?? '')) ?? ca[0];
        return hit ? { latitude: hit.latitude, longitude: hit.longitude, label: hit.name } : MARIN;
      } catch {
        return MARIN;
      }
    })());
  }
  return towns.get(name);
}

/**
 * Weather at the apiary's town for a date (YYYY-MM-DD) and optional time (HH:MM).
 * Resolves to { temp_f, humidity, wind_mph, conditions, place }; throws with a
 * member-friendly message when no data exists for that moment.
 */
export async function weatherAt(town, date, time) {
  const ago = daysSince(date);
  if (ago < -15) throw new Error('Weather is only available up to two weeks ahead.');
  const place = await locate(town);
  // The forecast API also serves the last ~3 months; older dates come from the archive.
  const base = ago > 60 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const params = new URLSearchParams({
    latitude: place.latitude, longitude: place.longitude, start_date: date, end_date: date, timezone: TZ,
    hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph',
  });
  let data;
  try {
    const res = await fetch(`${base}?${params}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.reason || res.statusText);
  } catch (e) {
    throw new Error(`Couldn't reach the weather service (${e.message}).`);
  }
  // Round to the nearest hour; no time given → midday.
  let hour = 12;
  if (time) {
    const [h, m] = time.split(':').map(Number);
    hour = Math.min(23, h + (m >= 30 ? 1 : 0));
  }
  const h = data.hourly ?? {};
  const i = (h.time ?? []).indexOf(`${date}T${String(hour).padStart(2, '0')}:00`);
  if (i < 0 || h.temperature_2m[i] == null) throw new Error('No weather data for that date yet.');
  return {
    temp_f: Math.round(h.temperature_2m[i]),
    humidity: h.relative_humidity_2m[i] == null ? null : Math.round(h.relative_humidity_2m[i]),
    wind_mph: h.wind_speed_10m[i] == null ? null : Math.round(h.wind_speed_10m[i]),
    conditions: WMO[h.weather_code[i]] ?? null,
    place: place.label,
  };
}
