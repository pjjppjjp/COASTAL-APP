/**
 * COASTAL location search. Call searchLocations only on an explicit submission.
 *
 * Photon public-service terms and API:
 * https://github.com/komoot/photon#demo-server
 * https://github.com/komoot/photon/blob/master/docs/api-v1.md
 * Fair project usage is permitted; the public service has no uptime guarantee.
 * Deployments with substantial traffic should use their own Photon endpoint.
 *
 * Result strings are data: render them with textContent, never as unescaped HTML.
 * The bundled places locate towns/islands/regions, not suitable planting sites.
 */

export const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';

// Place centers verified against Photon/OpenStreetMap on 2026-11-04.
// Source object identifiers are retained so the references can be checked.
const places = [
  {
    id: 'local-samae-san', name: 'Samae San',
    detail: 'Sattahip, Chon Buri, Thailand · municipality reference',
    lat: 12.6014027, lng: 100.9592806, osm: 'node/13980101988',
    aliases: ['samae san', 'samaesan', 'samae sarn', 'samae san thailand', 'samaesan thailand', 'แสมสาร', 'ตำบลแสมสาร', 'แสมสาร ชลบุรี'],
  },
  {
    id: 'local-ban-phe', name: 'Ban Phe',
    detail: 'Rayong, Thailand · town reference',
    lat: 12.6240252, lng: 101.4304708, osm: 'node/1822828209',
    aliases: ['ban phe', 'banphe', 'ban phe thailand', 'ban phe rayong', 'บ้านเพ', 'บ้านเพ ระยอง'],
  },
  {
    id: 'local-koh-mak', name: 'Koh Mak',
    detail: 'Trat, Thailand · island reference',
    lat: 11.815254, lng: 102.467972, osm: 'way/26690559',
    aliases: ['koh mak', 'ko mak', 'koh mak thailand', 'ko mak thailand', 'koh mak trat', 'เกาะหมาก', 'เกาะหมาก ตราด'],
  },
  {
    id: 'local-trang', name: 'Trang Province',
    detail: 'Thailand · province reference; pan to the coast',
    lat: 7.5892935, lng: 99.5032004, osm: 'relation/1908828',
    aliases: ['trang', 'trang thailand', 'trang province', 'ตรัง', 'จังหวัดตรัง'],
  },
  {
    id: 'local-phuket', name: 'Phuket',
    detail: 'Thailand · island reference',
    lat: 7.9790847, lng: 98.3355238, osm: 'relation/1162697',
    aliases: ['phuket', 'ko phuket', 'koh phuket', 'phuket thailand', 'phuket island', 'ภูเก็ต', 'เกาะภูเก็ต', 'จังหวัดภูเก็ต'],
  },
];

export const COASTAL_LOCATIONS = Object.freeze(places.map(({ aliases, osm, ...place }) =>
  Object.freeze({ ...place, source: 'Local place reference' })));

export const LOCATION_REFERENCES = Object.freeze(places.map(({ id, osm }) =>
  Object.freeze({ id, url: `https://www.openstreetmap.org/${osm}` })));

export class GeocodingError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GeocodingError';
    this.code = code;
  }
}

function normalize(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[.,()[\]_-]/g, ' ').replace(/\s+/g, ' ').trim();
}

const decimal = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const coordinatePattern = new RegExp(`^\\(?\\s*(${decimal})\\s*°?\\s*([NS])?\\s*(?:[,;]\\s*|\\s+)(${decimal})\\s*°?\\s*([EW])?\\s*\\)?$`, 'i');

function coordinateParts(query) {
  if (typeof query !== 'string') return null;
  return query.trim().replace(/−/g, '-').match(coordinatePattern);
}

/** Decimal degrees in latitude, longitude order; optional N/S and E/W suffixes. */
export function parseCoordinates(query) {
  const match = coordinateParts(query);
  if (!match) return null;
  let lat = Number(match[1]);
  let lng = Number(match[3]);
  const northSouth = match[2]?.toUpperCase();
  const eastWest = match[4]?.toUpperCase();
  // A negative number with a hemisphere suffix is ambiguous; require one convention.
  if ((northSouth && lat < 0) || (eastWest && lng < 0)) return null;
  if (northSouth === 'S') lat = -lat;
  if (eastWest === 'W') lng = -lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: lat || 0, lng: lng || 0 };
}

function abortError() {
  return new DOMException('Location search canceled.', 'AbortError');
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const cancel = () => { cleanup(); reject(abortError()); };
    const cleanup = () => signal.removeEventListener('abort', cancel);
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); },
    );
  });
}

function delay(ms, signal) {
  if (ms <= 0) { checkAbort(signal); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    checkAbort(signal);
    const cancel = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function cloneResults(results) { return results.map(result => ({ ...result })); }

function localMatches(query) {
  const key = normalize(query);
  const exact = places.findIndex(place => place.aliases.some(alias => normalize(alias) === key));
  if (exact !== -1) return { exact: true, results: [{ ...COASTAL_LOCATIONS[exact] }] };
  const matches = places.flatMap((place, index) =>
    place.aliases.some(alias => normalize(alias).includes(key)) ? [{ ...COASTAL_LOCATIONS[index] }] : []);
  return { exact: false, results: matches };
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '';
}

function resultFromFeature(feature) {
  if (feature?.geometry?.type !== 'Point') return null;
  if (!Array.isArray(feature.geometry.coordinates)) return null;
  const [lng, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const p = feature.properties || {};
  const name = [p.name, p.street, p.city, p.county, p.state, p.country].map(cleanText).find(Boolean) || 'Map location';
  const details = [p.city, p.county, p.state, p.country].map(cleanText).filter(Boolean);
  const unique = [...new Set(details)].filter(value => normalize(value) !== normalize(name));
  const osmId = /^[NWR]$/.test(p.osm_type) && /^\d+$/.test(String(p.osm_id)) ? `${p.osm_type}${p.osm_id}` : `${lat.toFixed(7)},${lng.toFixed(7)}`;
  return {
    id: `photon-${osmId}`, name, detail: unique.join(' · ') || 'Map place reference',
    lat, lng, source: 'Photon · OpenStreetMap',
  };
}

function mergeResults(local, remote, limit) {
  const seen = new Set();
  return [...local, ...remote].filter(result => {
    const key = `${normalize(result.name)}:${result.lat.toFixed(4)}:${result.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

/**
 * Create an isolated search client, optionally pointing at a hosted Photon instance.
 * All outgoing requests are serialized and start at least minIntervalMs apart.
 * Cancellation rejects immediately with AbortError. Timeouts reject with code TIMEOUT.
 * The cache is memory-only (64 queries, 24-hour TTL); names never persist to storage.
 */
export function createGeocoder({ endpoint = PHOTON_ENDPOINT, fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 10000, minIntervalMs = 1000 } = {}) {
  const serviceUrl = new URL(endpoint);
  if (serviceUrl.protocol !== 'https:' && !(serviceUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(serviceUrl.hostname))) {
    throw new TypeError('The location-search endpoint must use HTTPS.');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000) throw new RangeError('Search timeout must be 10–30,000 ms.');
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 1000) throw new RangeError('Search requests must be at least 1,000 ms apart.');
  const cache = new Map();
  let queue = Promise.resolve();
  let lastStarted = -Infinity;

  function readCache(key) {
    const item = cache.get(key);
    if (!item) return null;
    if (Date.now() - item.savedAt > 86400000) { cache.delete(key); return null; }
    cache.delete(key); cache.set(key, item);
    return cloneResults(item.results);
  }

  async function request(query, limit, signal) {
    // Timers can fire slightly early; recheck rather than exceeding the rate limit.
    let remaining = minIntervalMs - (Date.now() - lastStarted);
    while (remaining > 0) {
      await delay(remaining, signal);
      remaining = minIntervalMs - (Date.now() - lastStarted);
    }
    checkAbort(signal);
    lastStarted = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const url = new URL(serviceUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('lang', 'en');
    try {
      const response = await abortable(fetchImpl(url.href, {
        signal: controller.signal, credentials: 'omit', mode: 'cors', headers: { Accept: 'application/json' },
      }), controller.signal);
      if (!response.ok) {
        if (response.status === 429) throw new GeocodingError('Location search is busy. Wait a moment, or enter latitude, longitude.', 'RATE_LIMIT');
        throw new GeocodingError(`Location search is unavailable (HTTP ${response.status}). Try again or enter coordinates.`, 'HTTP');
      }
      let payload;
      try { payload = await abortable(response.json(), controller.signal); }
      catch (error) {
        if (controller.signal.aborted) throw error;
        throw new GeocodingError('The location service returned an unreadable response. Try again or enter coordinates.', 'INVALID_RESPONSE', error);
      }
      if (!payload || !Array.isArray(payload.features)) throw new GeocodingError('The location service returned an invalid response. Try again or enter coordinates.', 'INVALID_RESPONSE');
      const results = payload.features.slice(0, 50).map(resultFromFeature).filter(Boolean);
      if (payload.features.length && !results.length) throw new GeocodingError('The location service returned no valid coordinates. Try again or enter coordinates.', 'INVALID_RESPONSE');
      checkAbort(controller.signal);
      return results;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (timedOut) throw new GeocodingError('Location search timed out. Try again or enter latitude, longitude.', 'TIMEOUT', error);
      if (error instanceof GeocodingError) throw error;
      throw new GeocodingError('Location search is unavailable. Check your connection or enter latitude, longitude.', 'NETWORK', error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  return async function search(query, { signal, limit = 6 } = {}) {
    if (typeof query !== 'string') throw new TypeError('Enter a place name or latitude, longitude.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new RangeError('Search limit must be an integer from 1 to 10.');
    if (signal && typeof signal.addEventListener !== 'function') throw new TypeError('signal must be an AbortSignal.');
    checkAbort(signal);
    const text = query.trim().replace(/\s+/g, ' ');
    if (!text || text.length < 2) return [];
    if (text.length > 160) throw new RangeError('Use a place name shorter than 161 characters.');
    const coordinates = parseCoordinates(text);
    if (coordinates) return [{
      id: `coordinates:${coordinates.lat},${coordinates.lng}`,
      name: `${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)}`,
      detail: 'Latitude, longitude · entered coordinates', ...coordinates, source: 'Entered coordinates',
    }];
    if (coordinateParts(text)) throw new RangeError('Use valid latitude (−90 to 90) and longitude (−180 to 180). Use either signed values or hemisphere letters.');
    const local = localMatches(text);
    if (local.exact) return local.results.slice(0, limit);
    const key = `${limit}:${normalize(text)}`;
    const cached = readCache(key);
    if (cached) return cached;
    const operation = queue.then(async () => {
      checkAbort(signal);
      const queuedCache = readCache(key);
      if (queuedCache) return queuedCache;
      let remote;
      try { remote = await request(text, limit, signal); }
      catch (error) {
        // A known reference is a real local match, never a fabricated remote result.
        if (error.name !== 'AbortError' && local.results.length) return local.results.slice(0, limit);
        throw error;
      }
      const results = mergeResults(local.results, remote, limit);
      cache.set(key, { savedAt: Date.now(), results: cloneResults(results) });
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      return results;
    });
    // Rejections never poison the queue; aborted queued requests are skipped before fetch.
    queue = operation.catch(() => {});
    return abortable(operation, signal);
  };
}

export const searchLocations = createGeocoder();
