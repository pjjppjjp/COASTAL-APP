/**
 * COASTAL place search. Saved localities are starting locations, never approved
 * planting sites. Online results: Open-Meteo Geocoding / GeoNames.
 * https://open-meteo.com/en/docs/geocoding-api
 * No key is required for the provider's non-commercial public service.
 */
export const PRESET_SITES = Object.freeze([
  Object.freeze({ id: 'samae-san', name: 'Samae San', detail: 'Chon Buri, Thailand · starting location', lat: 12.57252, lng: 100.95142, source: 'GeoNames 1606734 via Open-Meteo · saved locality' }),
  Object.freeze({ id: 'ban-phe', name: 'Ban Phe', detail: 'Rayong, Thailand · starting location', lat: 12.62824, lng: 101.43757, source: 'GeoNames 1614288 via Open-Meteo · saved locality' }),
  Object.freeze({ id: 'pak-meng', name: 'Pak Meng', detail: 'Trang, Thailand · starting location', lat: 7.47106, lng: 99.33664, source: 'GeoNames 1155422 via Open-Meteo · saved locality' }),
  Object.freeze({ id: 'phuket', name: 'Phuket', detail: 'Phuket, Thailand · starting location', lat: 7.89059, lng: 98.3981, source: 'GeoNames 1151254 via Open-Meteo · saved locality' }),
]);

const ALIASES = {
  'samae-san': ['samae san', 'samaesan', 'samae san island', 'koh samae san', 'ko samae san', 'แสมสาร', 'เกาะแสมสาร'],
  'ban-phe': ['ban phe', 'banphe', 'baan phe', 'บ้านเพ', 'บ้านเพ ระยอง'],
  'pak-meng': ['pak meng', 'pakmeng', 'ban pak meng', 'pak meng beach', 'hat pak meng', 'trang', 'trang coast', 'ปากเมง', 'หาดปากเมง', 'ตรัง'],
  phuket: ['phuket', 'phuket island', 'ภูเก็ต'],
};
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();
let networkQueue = Promise.resolve();
let lastNetworkStart = 0;

function normalize(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[,_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Latitude first; accepts a comma, semicolon, slash or whitespace separator. */
export function parseCoordinates(query) {
  if (typeof query !== 'string') return null;
  const text = query.trim().replace(/^\(\s*|\s*\)$/g, '');
  const match = text.match(/^([+-]?\d{1,3}(?:\.\d+)?)\s*°?\s*([NS])?\s*(?:[,;/]|\s)\s*([+-]?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!match) return null;
  let lat = Number(match[1]);
  let lng = Number(match[3]);
  if (match[2]) lat = Math.abs(lat) * (match[2].toUpperCase() === 'S' ? -1 : 1);
  if (match[4]) lng = Math.abs(lng) * (match[4].toUpperCase() === 'W' ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 80 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
    }
    previous = current;
  }
  return previous[b.length];
}

function localMatches(query) {
  const q = normalize(query).replace(/\s+(?:thailand|ไทย)$/, '');
  return PRESET_SITES.map(site => {
    let score = Infinity;
    for (const alias of ALIASES[site.id]) {
      const a = normalize(alias);
      if (a === q) score = 0;
      else if (q.length >= 3 && a.startsWith(q)) score = Math.min(score, 1);
      else if (q.length >= 5) {
        const distance = editDistance(q, a);
        if (distance <= (q.length >= 10 ? 2 : 1)) score = Math.min(score, 2 + distance);
      }
    }
    return { site, score };
  }).filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score)
    .slice(0, 6).map(({ site }) => ({ ...site }));
}

function abortError() {
  const error = new Error('Location search cancelled.');
  error.name = 'AbortError';
  return error;
}
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function wait(milliseconds, signal) {
  checkAbort(signal);
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestLocations(query, signal) {
  await wait(Math.max(0, 1000 - (Date.now() - lastNetworkStart)), signal);
  checkAbort(signal);
  lastNetworkStart = Date.now();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 9000);
  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' }).toString();
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit' });
    if (!response.ok) {
      if (response.status === 429) throw new Error('Place search is busy. Please try again shortly, choose a saved coast, or enter latitude, longitude.');
      throw new Error(`Place search is unavailable (${response.status}). Choose a saved coast or enter latitude, longitude.`);
    }
    const data = await response.json();
    if (data.error) throw new Error('The place service could not understand this search. Try a town name or latitude, longitude.');
    const results = Array.isArray(data.results) ? data.results : [];
    return results.filter(result => typeof result.name === 'string' && Number.isFinite(result.latitude) && Number.isFinite(result.longitude)
      && Math.abs(result.latitude) <= 80 && Math.abs(result.longitude) <= 180).map(result => ({
      id: `geonames-${result.id}`,
      name: result.name.slice(0, 120),
      detail: [...new Set([result.admin1, result.country].filter(value => typeof value === 'string' && value.trim()))].join(', '),
      lat: result.latitude,
      lng: result.longitude,
      source: 'Open-Meteo · GeoNames',
    }));
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new Error('Place search took too long. Choose a saved coast, enter latitude, longitude, or try again.');
    if (error instanceof TypeError) throw new Error('Could not connect to place search. Check your internet connection; saved coasts and coordinates still work.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Called on explicit search submission. Local names and coordinates work offline.
 * Provider calls are serialized at >= 1-second intervals and cached in memory.
 */
export async function geocode(query, { signal } = {}) {
  checkAbort(signal);
  if (typeof query !== 'string' || query.trim().length < 2) throw new Error('Enter a place name or latitude, longitude.');
  const text = query.trim();
  if (text.length > 120) throw new Error('Please shorten the place name to 120 characters or fewer.');
  const coordinates = parseCoordinates(text);
  if (coordinates) return [{ name: `${coordinates[0].toFixed(5)}, ${coordinates[1].toFixed(5)}`, detail: 'Your coordinates · site survey needed', lat: coordinates[0], lng: coordinates[1], source: 'User-entered coordinates' }];
  if (/^\(?[+-]?\d+(?:\.\d+)?\s*°?\s*[NS]?\s*[,;/]\s*[+-]?\d/i.test(text)) {
    throw new Error('Use latitude from −80 to 80 and longitude from −180 to 180, in that order.');
  }
  const local = localMatches(text);
  if (local.length) return local;
  const key = normalize(text);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results.map(result => ({ ...result }));
  if (hit) cache.delete(key);
  const pending = networkQueue.then(async () => {
    checkAbort(signal);
    const queuedHit = cache.get(key);
    if (queuedHit && Date.now() - queuedHit.at < CACHE_TTL_MS) return queuedHit.results.map(result => ({ ...result }));
    const results = await requestLocations(text, signal);
    cache.set(key, { at: Date.now(), results });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return results.map(result => ({ ...result }));
  });
  networkQueue = pending.catch(() => undefined);
  return pending;
}
