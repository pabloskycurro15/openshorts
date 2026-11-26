import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../registry';

/** Códigos meteorológicos de la OMM → texto en español. */
const WMO: Record<number, string> = {
  0: 'despejado', 1: 'casi despejado', 2: 'parcialmente nublado', 3: 'nublado', 45: 'niebla', 48: 'niebla con escarcha',
  51: 'llovizna débil', 53: 'llovizna', 55: 'llovizna intensa', 61: 'lluvia débil', 63: 'lluvia', 65: 'lluvia intensa',
  66: 'lluvia helada', 67: 'lluvia helada intensa', 71: 'nieve débil', 73: 'nieve', 75: 'nieve intensa', 77: 'granizo fino',
  80: 'chubascos débiles', 81: 'chubascos', 82: 'chubascos fuertes', 85: 'chubascos de nieve', 86: 'chubascos de nieve fuertes',
  95: 'tormenta', 96: 'tormenta con granizo', 99: 'tormenta fuerte con granizo',
};

/** El tiempo con Open-Meteo: gratis, sin clave ni cuenta. Solo se envía el nombre del lugar. */
export function createWeatherTool(f: typeof fetch = (...a) => fetch(...a)): ToolDefinition {
  return defineTool({
    name: 'weather.forecast',
    description: 'El tiempo ahora y la previsión de hoy y mañana en un lugar (ciudad o pueblo).',
    parameters: z.object({ place: z.string().min(2).max(100) }),
    permissions: ['weather.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Lugar, temperatura actual, cielo, máximas/mínimas y probabilidad de lluvia.',
    async execute({ place }) {
      const g = await f(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&format=json&name=${encodeURIComponent(place)}`);
      if (!g.ok) throw new Error(`Servicio del tiempo no disponible (HTTP ${g.status})`);
      const loc = ((await g.json()) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] }).results?.[0];
      if (!loc) throw new Error(`No encuentro «${place}»`);
      const qs = new URLSearchParams({ latitude: String(loc.latitude), longitude: String(loc.longitude), timezone: 'auto', forecast_days: '2',
        current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' });
      const r = await f(`https://api.open-meteo.com/v1/forecast?${qs}`);
      if (!r.ok) throw new Error(`Servicio del tiempo no disponible (HTTP ${r.status})`);
      const w = (await r.json()) as { current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number }; daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] } };
      const day = (i: number) => ({ date: w.daily.time[i], sky: WMO[w.daily.weather_code[i]!] ?? 'variable', max: Math.round(w.daily.temperature_2m_max[i]!), min: Math.round(w.daily.temperature_2m_min[i]!), rainChance: w.daily.precipitation_probability_max[i] ?? null });
      return {
        place: [loc.name, loc.admin1, loc.country].filter(Boolean).join(', '),
        now: { temp: Math.round(w.current.temperature_2m), feelsLike: Math.round(w.current.apparent_temperature), sky: WMO[w.current.weather_code] ?? 'variable', windKmh: Math.round(w.current.wind_speed_10m) },
        today: day(0), tomorrow: day(1), source: 'Open-Meteo',
      };
    },
  });
}
