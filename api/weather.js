// api/weather.js
// Live La Quinta weather from Open-Meteo (no API key required), shaped for the dashboard.
// Edge-cached for 10 minutes so page loads stay fast without going stale.

const LAT = 33.6639;
const LON = -116.3108;
const TZ = 'America/Los_Angeles';

const LABELS = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm',
};

function clock(iso) {
  if (!iso) return '';
  const time = iso.includes('T') ? iso.split('T')[1] : iso;
  const [hRaw, mRaw] = time.split(':');
  const h = Number(hRaw);
  const m = mRaw || '00';
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.slice(0, 2)} ${suffix}`;
}

function hourLabel(iso) {
  if (!iso) return '';
  const time = iso.split('T')[1] || '00:00';
  return clock(`T${time}`);
}

function dayLabel(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
}

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m' +
    '&hourly=temperature_2m,weather_code,precipitation_probability' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max' +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' +
    `&timezone=${encodeURIComponent(TZ)}&forecast_days=8`;

  const airUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}` +
    `&current=us_aqi,pm2_5&timezone=${encodeURIComponent(TZ)}`;

  try {
    const [forecastResult, airResult] = await Promise.allSettled([getJSON(forecastUrl), getJSON(airUrl)]);
    if (forecastResult.status !== 'fulfilled') throw forecastResult.reason || new Error('forecast failed');

    const f = forecastResult.value;
    const c = f.current || {};
    const now = new Date();
    const hourlyTimes = f.hourly?.time || [];

    // Open-Meteo returns local wall-clock times; find the first slot at/after the current hour.
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:00`;
    let start = hourlyTimes.findIndex(t => t >= stamp);
    if (start < 0) start = 0;

    const hourly = hourlyTimes.slice(start, start + 12).map((t, i) => {
      const idx = start + i;
      return {
        time: hourLabel(t),
        temp: Math.round(f.hourly.temperature_2m[idx]),
        code: f.hourly.weather_code[idx],
        pop: f.hourly.precipitation_probability?.[idx] ?? 0,
      };
    });

    const daily = (f.daily?.time || []).slice(0, 7).map((d, i) => ({
      day: dayLabel(d),
      date: d,
      code: f.daily.weather_code[i],
      high: Math.round(f.daily.temperature_2m_max[i]),
      low: Math.round(f.daily.temperature_2m_min[i]),
      sunrise: clock(f.daily.sunrise?.[i]),
      sunset: clock(f.daily.sunset?.[i]),
      pop: f.daily.precipitation_probability_max?.[i] ?? 0,
      uv: f.daily.uv_index_max?.[i] ?? null,
    }));

    const air = airResult.status === 'fulfilled' && airResult.value?.current
      ? { aqi: Math.round(airResult.value.current.us_aqi), pm25: airResult.value.current.pm2_5 }
      : null;

    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({
      source: 'open-meteo',
      updated: new Date().toISOString(),
      units: 'imperial',
      location: { name: 'La Quinta, CA', lat: LAT, lon: LON, timezone: TZ },
      current: {
        temp: Math.round(c.temperature_2m),
        feels: Math.round(c.apparent_temperature),
        humidity: c.relative_humidity_2m,
        wind: c.wind_speed_10m,
        windDir: c.wind_direction_10m,
        code: c.weather_code,
        label: LABELS[c.weather_code] || 'Mixed conditions',
        isDay: c.is_day,
        precip: c.precipitation,
      },
      high: Math.round(f.daily.temperature_2m_max[0]),
      low: Math.round(f.daily.temperature_2m_min[0]),
      sunrise: daily[0]?.sunrise || '',
      sunset: daily[0]?.sunset || '',
      hourly,
      daily,
      air,
    });
  } catch (err) {
    console.error('weather failed:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Weather upstream unavailable', detail: err.message });
  }
}
