// The exact Open-Meteo requests the app makes. Shared by the app and the
// daily live check, so the live check tests what the app really calls.
export const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
export const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const ENSEMBLE_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';

export const WEATHER_HOURLY = [
  'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation',
  'weather_code', 'visibility', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
];
export const MARINE_HOURLY = [
  'wave_height', 'wave_direction', 'wave_period', 'swell_wave_height', 'swell_wave_period',
  'sea_surface_temperature', 'sea_level_height_msl', 'ocean_current_velocity', 'ocean_current_direction',
];
export const FORECAST_DAYS = 4;

export function forecastUrls(lat, lon) {
  const common = `latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=${FORECAST_DAYS}`;
  return {
    weather: `${WEATHER_URL}?${common}&wind_speed_unit=kn&hourly=${WEATHER_HOURLY.join(',')}&daily=sunrise,sunset`,
    marine: `${MARINE_URL}?${common}&hourly=${MARINE_HOURLY.join(',')}`,
    // ECMWF ensemble (about 50 runs) for forecast confidence. Optional.
    ensemble: `${ENSEMBLE_URL}?${common}&wind_speed_unit=kn&models=ecmwf_ifs025&hourly=wind_speed_10m`,
  };
}

export function geocodeUrl(query) {
  return `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=20&language=en&format=json`;
}
