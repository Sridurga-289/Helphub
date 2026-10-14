const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { connectDatabase, checkDatabaseHealth, getConnectionStatus, closeDatabase } = require('./db');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 1024 * 1024;
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const discoveryCache = new Map();
const locationRequestWindows = new Map();
let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;
const DISCOVERY_PAGE_SIZE = 24;
const SERVICE_CATEGORIES = [
  'NGOs & Charities', 'Child Welfare', 'Elder Care', 'Food Support', 'Health & Blood',
  'Animal Welfare', 'Environment', 'Education', 'Community Services', 'Shelter & Relief',
  'Volunteer Events'
];

const seedEvents = [
  { title: 'Green City Tree Planting', category: 'Environment', date: '2026-10-24', time: '08:30', location: 'KBR Park, Hyderabad', coordinates: [78.4204, 17.4239], availableSlots: 18, volunteerHours: 3, organizer: 'Green Hyderabad Collective', description: 'Help restore a stretch of urban green space. We will plant native saplings, learn how to care for them, and leave the park healthier than we found it.', image: 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1200&q=85', status: 'upcoming', sampleData: true },
  { title: 'Community Pantry Packing Day', category: 'Food Donation', date: '2026-10-26', time: '10:00', location: 'Sundarayya Vignana Kendram, Hyderabad', coordinates: [78.4867, 17.3981], availableSlots: 12, volunteerHours: 4, organizer: 'Share A Meal Hyderabad', description: 'Pack fresh produce and pantry staples into family-sized food parcels. All supplies and a short orientation are provided on arrival.', image: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&w=1200&q=85', status: 'upcoming', sampleData: true },
  { title: 'Saturday Reading Circle', category: 'Education', date: '2026-10-31', time: '09:00', location: 'Banjara Hills Community Library, Hyderabad', coordinates: [78.4482, 17.4156], availableSlots: 8, volunteerHours: 2, organizer: 'Open Pages Foundation', description: 'Spend a morning reading with young learners and helping them find their confidence with books. Telugu and English readers are both welcome.', image: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1200&q=85', status: 'upcoming', sampleData: true },
  { title: 'Second Chances Animal Care', category: 'Animal Welfare', date: '2026-11-02', time: '07:30', location: 'Blue Cross of Hyderabad, Jubilee Hills', coordinates: [78.4098, 17.4315], availableSlots: 6, volunteerHours: 3, organizer: 'Blue Cross of Hyderabad', description: 'Support the shelter team with enrichment, feeding, and tidy-up tasks. A staff member will guide the group, so first-time volunteers are very welcome.', image: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=1200&q=85', status: 'upcoming', sampleData: true },
  { title: 'Musi Riverbank Clean-up', category: 'Community Service', date: '2026-11-08', time: '07:00', location: 'Puranapul Riverside, Hyderabad', coordinates: [78.4741, 17.3712], availableSlots: 24, volunteerHours: 3, organizer: 'Musi Neighbourhood Network', description: 'Join nearby residents for a practical riverbank clean-up. Gloves, collection bags, water, and a safety briefing are provided.', image: 'https://images.unsplash.com/photo-1618477461853-cf6ed80faba5?auto=format&fit=crop&w=1200&q=85', status: 'upcoming', sampleData: true },
  { title: 'Digital Skills for Everyone', category: 'Education', date: '2026-11-14', time: '11:00', location: 'Tarnaka Learning Centre, Hyderabad', coordinates: [78.5386, 17.4281], availableSlots: 10, volunteerHours: 2, organizer: 'Click Forward India', description: 'Help adults build confidence with everyday digital skills, from email basics to safe browsing. Bring your patience; the centre provides the laptops.', image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=85', status: 'upcoming', sampleData: true }
].map((event) => ({ ...event, geoLocation: toGeoPoint(event.coordinates[0], event.coordinates[1]), id: crypto.randomUUID(), createdAt: new Date().toISOString() }));

const store = { client: null, db: null, memoryEvents: seedEvents, memoryUsers: [], memoryRegistrations: [], memoryOrganizations: [] };

function eventDocument(doc) {
  if (!doc) return null;
  return { ...doc, id: String(doc._id || doc.id), _id: undefined };
}

function registrationDocument(doc) {
  if (!doc) return null;
  return { ...doc, id: String(doc._id || doc.id), _id: undefined, eventId: String(doc.eventId) };
}

function toGeoPoint(longitude, latitude) {
  return { type: 'Point', coordinates: [longitude, latitude] };
}

function distanceKm(latitude, longitude, targetLatitude, targetLongitude) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latDelta = radians(targetLatitude - latitude);
  const lonDelta = radians(targetLongitude - longitude);
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(targetLatitude)) * Math.sin(lonDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordinatesOf(item) {
  if (Array.isArray(item.coordinates) && item.coordinates.length === 2) return item.coordinates.map(Number);
  if (item.geoLocation?.type === 'Point' && Array.isArray(item.geoLocation.coordinates)) return item.geoLocation.coordinates.map(Number);
  if (item.location?.type === 'Point' && Array.isArray(item.location.coordinates)) return item.location.coordinates.map(Number);
  return null;
}

function categoryForTags(tags = {}) {
  const text = `${tags.amenity || ''} ${tags.social_facility || ''} ${tags.office || ''} ${tags.healthcare || ''} ${tags.charity || ''} ${tags.name || ''} ${tags.description || ''}`.toLowerCase();
  if (/orphan|child|children|youth|kindergarten/.test(text)) return 'Child Welfare';
  if (/nursing_home|senior|elder|retirement|old.?age/.test(text)) return 'Elder Care';
  if (/food_bank|foodbank|soup_kitchen|community_kitchen|food.?support/.test(text)) return 'Food Support';
  if (/hospital|clinic|doctors|blood|health|pharmacy/.test(text)) return 'Health & Blood';
  if (/animal|veterinary|shelter.*animal|dog|cat/.test(text)) return 'Animal Welfare';
  if (/environment|conservation|forest|tree|nature|park|garden/.test(text)) return 'Environment';
  if (/school|college|university|education|tutoring|library|training/.test(text)) return 'Education';
  if (/shelter|homeless|refugee|disaster|relief|emergency|hostel/.test(text)) return 'Shelter & Relief';
  if (/food|charity|ngo|social|community|welfare/.test(text)) return 'NGOs & Charities';
  return null;
}

function openingStatus(hours, now = new Date()) {
  if (typeof hours !== 'string' || !hours.trim()) return null;
  if (hours.trim() === '24/7') return true;
  const dayCodes = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const clauses = hours.split(';').map((part) => part.trim()).filter(Boolean);
  if (!clauses.length || clauses.some((part) => /\b(PH|SH|sunrise|sunset|week|\+|,\s*off)\b/i.test(part))) return null;
  const weekday = (now.getDay() + 6) % 7;
  const current = now.getHours() * 60 + now.getMinutes();
  let matchedDay = false;
  let supported = true;
  for (const clause of clauses) {
    const match = clause.match(/^(?:(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(?:(\d{1,2}:\d{2})-(\d{1,2}:\d{2})|((?:off|closed)))$/i);
    if (!match) { supported = false; break; }
    const dayExpression = clause.match(/^(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*/)?.[0];
    let days = dayExpression ? [] : dayCodes;
    if (dayExpression) {
      for (const range of dayExpression.split(',')) {
        const [start, end = start] = range.split('-');
        let cursor = dayCodes.indexOf(start);
        const finalDay = dayCodes.indexOf(end);
        while (cursor >= 0) {
          days.push(dayCodes[cursor]);
          if (cursor === finalDay) break;
          cursor = (cursor + 1) % 7;
        }
      }
    }
    if (!days.includes(dayCodes[weekday])) continue;
    matchedDay = true;
    if (match[5]) return false;
    const toMinutes = (value) => {
      const [hour, minute] = value.split(':').map(Number);
      return hour * 60 + minute;
    };
    const start = toMinutes(match[3]);
    const end = toMinutes(match[4]);
    if (start <= end ? current >= start && current < end : current >= start || current < end) return true;
  }
  return supported ? (matchedDay ? false : false) : null;
}

function buildOverpassQuery(latitude, longitude, radiusMeters) {
  const tags = [
    '"office"="ngo"', '"office"="charity"', '"shop"="charity"', '"amenity"="social_facility"',
    '"amenity"="community_centre"', '"amenity"="social_centre"', '"amenity"="shelter"',
    '"amenity"="food_bank"', '"amenity"="soup_kitchen"', '"amenity"="hospital"', '"amenity"="clinic"',
    '"amenity"="blood_donation"', '"healthcare"="hospital"', '"healthcare"="clinic"',
    '"healthcare"="blood_donation"', '"healthcare"="social_facility"', '"social_facility"="shelter"',
    '"social_facility"="nursing_home"', '"social_facility"="orphanage"', '"social_facility"="food_bank"',
    '"social_facility"="community_centre"', '"amenity"="animal_shelter"', '"amenity"="veterinary"',
    '"office"="environmental"', '"amenity"="school"', '"amenity"="library"'
  ];
  const selectors = tags.map((tag) => `nwr(around:${radiusMeters},${latitude},${longitude})[${tag}];`).join('');
  return `[out:json][timeout:25];(${selectors});out center tags;`;
}

function osmService(element, latitude, longitude) {
  const tags = element.tags || {};
  const category = categoryForTags(tags);
  const targetLatitude = Number(element.lat ?? element.center?.lat);
  const targetLongitude = Number(element.lon ?? element.center?.lon);
  const name = (tags.name || tags['name:en'] || '').trim();
  if (!category || !name || !Number.isFinite(targetLatitude) || !Number.isFinite(targetLongitude)) return null;
  const addressParts = [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:city'], tags['addr:postcode']].filter(Boolean);
  const phone = tags.phone || tags['contact:phone'] || '';
  const image = tags.image || (tags.wikimedia_commons ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(tags.wikimedia_commons.replace(/^File:/, ''))}` : '');
  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    category,
    coordinates: [targetLongitude, targetLatitude],
    distanceKm: distanceKm(latitude, longitude, targetLatitude, targetLongitude),
    address: addressParts.join(', '),
    ...(phone ? { phone } : {}),
    ...(tags.opening_hours ? { openingHours: tags.opening_hours } : {}),
    ...(tags.opening_hours ? { openNow: openingStatus(tags.opening_hours) } : {}),
    ...(tags.description || tags['description:en'] ? { description: tags.description || tags['description:en'] } : {}),
    ...(image ? { image } : {}),
    source: 'OpenStreetMap',
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    serviceType: 'organization',
    osmTags: { amenity: tags.amenity, healthcare: tags.healthcare, social_facility: tags.social_facility }
  };
}

function normalizeOrganization(doc, latitude, longitude) {
  const coordinates = coordinatesOf(doc);
  if (!coordinates || !doc.name || !doc.category) return null;
  return {
    id: String(doc._id || doc.id),
    name: doc.name,
    category: doc.category,
    coordinates,
    distanceKm: distanceKm(latitude, longitude, coordinates[1], coordinates[0]),
    ...(doc.address ? { address: doc.address } : {}),
    ...(doc.phone ? { phone: doc.phone } : {}),
    ...(doc.openingHours ? { openingHours: doc.openingHours } : {}),
    ...(doc.openingHours ? { openNow: openingStatus(doc.openingHours) } : {}),
    ...(doc.description ? { description: doc.description } : {}),
    ...(doc.image ? { image: doc.image } : {}),
    source: 'HelpHub database',
    serviceType: 'organization'
  };
}

function normalizeEvent(doc, latitude, longitude) {
  const coordinates = coordinatesOf(doc);
  if (!coordinates) return null;
  return {
    id: String(doc._id || doc.id),
    name: doc.title,
    category: 'Volunteer Events',
    eventCategory: doc.category,
    coordinates,
    distanceKm: distanceKm(latitude, longitude, coordinates[1], coordinates[0]),
    address: doc.location,
    ...(doc.phone ? { phone: doc.phone } : {}),
    ...(doc.description ? { description: doc.description } : {}),
    ...(doc.image ? { image: doc.image } : {}),
    date: doc.date,
    time: doc.time,
    organizer: doc.organizer,
    availableSlots: Number(doc.availableSlots) || 0,
    volunteerHours: Number(doc.volunteerHours) || 0,
    source: doc.sampleData ? 'HelpHub sample event' : 'HelpHub database',
    sampleData: Boolean(doc.sampleData),
    serviceType: 'event'
  };
}

function deduplicateServices(items) {
  const unique = [];
  for (const item of items) {
    const nameKey = item.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const duplicate = unique.find((other) => other.serviceType === item.serviceType && other.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === nameKey && distanceKm(item.coordinates[1], item.coordinates[0], other.coordinates[1], other.coordinates[0]) < 0.08);
    if (duplicate) {
      if (item.source === 'HelpHub database' && duplicate.source === 'OpenStreetMap') unique.splice(unique.indexOf(duplicate), 1, item);
      continue;
    }
    unique.push(item);
  }
  return unique;
}

async function fetchOsmServices(latitude, longitude, radiusKm) {
  const cacheKey = `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${radiusKm}`;
  const cached = discoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.error) throw new Error(cached.error);
    return { services: cached.elements.map((item) => osmService(item, latitude, longitude)).filter(Boolean), error: null };
  }
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'HelpHub student civic-tech project' },
    body: new URLSearchParams({ data: buildOverpassQuery(latitude, longitude, radiusKm * 1000) }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`OpenStreetMap data service returned ${response.status}.`);
  const payload = await response.json();
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const services = elements.map((item) => osmService(item, latitude, longitude)).filter(Boolean);
  discoveryCache.set(cacheKey, { elements, expiresAt: Date.now() + 5 * 60 * 1000 });
  if (discoveryCache.size > 50) discoveryCache.delete(discoveryCache.keys().next().value);
  return { services, error: null };
}

async function discoverServices(searchParams) {
  const rawLatitude = searchParams.get('lat');
  const rawLongitude = searchParams.get('lon');
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  const radiusKm = Number(searchParams.get('radius') || 10);
  const page = Number(searchParams.get('page') || 1);
  if (!rawLatitude || !rawLongitude || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw Object.assign(new Error('A valid latitude and longitude are required. Choose a location to search nearby.'), { status: 400 });
  }
  if (![5, 10, 25, 50].includes(radiusKm) || !Number.isInteger(page) || page < 1 || page > 1000) {
    throw Object.assign(new Error('Choose a supported search radius and page.'), { status: 400 });
  }
  const query = (searchParams.get('q') || '').trim().slice(0, 100).toLowerCase();
  const category = searchParams.get('category') || '';
  if (category && !SERVICE_CATEGORIES.includes(category)) throw Object.assign(new Error('Unknown service category.'), { status: 400 });
  let osmServices = [];
  let osmError = null;
  try {
    ({ services: osmServices } = await fetchOsmServices(latitude, longitude, radiusKm));
  } catch (error) {
    const cacheKey = `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${radiusKm}`;
    discoveryCache.set(cacheKey, { error: error.message, elements: [], expiresAt: Date.now() + 45000 });
    osmError = 'OpenStreetMap places are temporarily unavailable. Showing HelpHub database results where possible.';
    console.warn(`Overpass lookup failed: ${error.message}`);
  }
  let organizations = [];
  let events = [];
  if (store.db) {
    const near = { $near: { $geometry: toGeoPoint(longitude, latitude), $maxDistance: radiusKm * 1000 } };
    [organizations, events] = await Promise.all([
      store.db.collection('organizations').find({ location: near }).limit(5000).toArray(),
      store.db.collection('events').find({ geoLocation: near, date: { $gte: new Date().toISOString().slice(0, 10) } }).limit(2000).toArray()
    ]);
  } else {
    organizations = store.memoryOrganizations.filter((item) => {
      const coords = coordinatesOf(item);
      return coords && distanceKm(latitude, longitude, coords[1], coords[0]) <= radiusKm;
    });
    events = store.memoryEvents.filter((item) => {
      const coords = coordinatesOf(item);
      return coords && item.date >= new Date().toISOString().slice(0, 10) && distanceKm(latitude, longitude, coords[1], coords[0]) <= radiusKm;
    });
  }
  let all = deduplicateServices([
    ...organizations.map((item) => normalizeOrganization(item, latitude, longitude)).filter(Boolean),
    ...osmServices,
    ...events.map((item) => normalizeEvent(item, latitude, longitude)).filter(Boolean)
  ]);
  if (query) all = all.filter((item) => `${item.name} ${item.category} ${item.address || ''} ${item.description || ''} ${item.organizer || ''}`.toLowerCase().includes(query));
  const counts = Object.fromEntries(SERVICE_CATEGORIES.map((item) => [item, all.filter((service) => service.category === item).length]));
  if (category) all = all.filter((item) => item.category === category);
  if (searchParams.get('openNow') === 'true') all = all.filter((item) => item.openNow === true);
  all.sort(searchParams.get('sort') === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => a.distanceKm - b.distanceKm);
  const offset = (page - 1) * DISCOVERY_PAGE_SIZE;
  return {
    results: all.slice(offset, offset + DISCOVERY_PAGE_SIZE),
    total: all.length,
    counts,
    page,
    pageSize: DISCOVERY_PAGE_SIZE,
    hasMore: offset + DISCOVERY_PAGE_SIZE < all.length,
    sources: { openStreetMap: osmError ? 'unavailable' : 'available', helpHubDatabase: store.db ? 'mongodb' : 'preview' },
    warning: osmError,
    disclaimer: 'Results depend on OpenStreetMap coverage and HelpHub records. This search cannot guarantee that every local service has been mapped.'
  };
}

async function reverseGeocode(latitude, longitude) {
  const url = new URL('/reverse', NOMINATIM_URL);
  url.search = new URLSearchParams({ format: 'jsonv2', lat: String(latitude), lon: String(longitude), zoom: '16', addressdetails: '1' });
  const response = await fetchNominatim(url);
  if (!response.ok) throw new Error('Location name lookup is temporarily unavailable.');
  const data = await response.json();
  return { label: data.name || data.address?.suburb || data.address?.neighbourhood || data.address?.city || data.address?.town || data.address?.village || data.display_name || '', displayName: data.display_name || '' };
}

async function searchLocation(query) {
  const url = new URL('/search', NOMINATIM_URL);
  url.search = new URLSearchParams({ format: 'jsonv2', q: query.slice(0, 120), limit: '1', countrycodes: 'in', addressdetails: '1' });
  const response = await fetchNominatim(url);
  if (!response.ok) throw new Error('Location search is temporarily unavailable. Try again in a moment.');
  const results = await response.json();
  const match = results[0];
  if (!match || !Number.isFinite(Number(match.lat)) || !Number.isFinite(Number(match.lon))) throw Object.assign(new Error('We could not find that place in the available map data.'), { status: 404 });
  const address = match.address || {};
  return { latitude: Number(match.lat), longitude: Number(match.lon), label: address.suburb || address.neighbourhood || address.city || address.town || address.village || match.name || query, displayName: match.display_name || '' };
}

function validEvent(input) {
  const fields = ['title', 'category', 'date', 'time', 'location', 'description', 'organizer', 'image'];
  const result = {};
  for (const field of fields) {
    if (typeof input[field] !== 'string' || !input[field].trim()) throw Object.assign(new Error(`${field} is required.`), { status: 400 });
    result[field] = input[field].trim().slice(0, field === 'description' ? 2000 : 180);
  }
  result.availableSlots = Math.max(0, Math.min(500, Number.parseInt(input.availableSlots, 10) || 0));
  result.volunteerHours = Math.max(1, Math.min(24, Number.parseInt(input.volunteerHours, 10) || 1));
  const hasLatitude = String(input.latitude ?? '').trim() !== '';
  const hasLongitude = String(input.longitude ?? '').trim() !== '';
  if (hasLatitude || hasLongitude) {
    if (!hasLatitude || !hasLongitude) throw Object.assign(new Error('Enter both event coordinates or leave both blank.'), { status: 400 });
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw Object.assign(new Error('Enter valid event coordinates or leave both blank.'), { status: 400 });
    result.geoLocation = toGeoPoint(longitude, latitude);
    result.coordinates = [longitude, latitude];
  }
  return result;
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function enforceLocationLimit(request, route, maximum, windowMs = 60000) {
  const key = `${request.socket.remoteAddress || 'unknown'}:${route}`;
  const now = Date.now();
  const recent = (locationRequestWindows.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= maximum) throw Object.assign(new Error('Too many nearby searches. Wait a moment, then try again.'), { status: 429 });
  recent.push(now);
  locationRequestWindows.set(key, recent);
  if (locationRequestWindows.size > 1000) {
    for (const [entry, timestamps] of locationRequestWindows) {
      if (!timestamps.length || now - timestamps[timestamps.length - 1] > windowMs) locationRequestWindows.delete(entry);
    }
  }
}

function fetchNominatim(url) {
  const task = nominatimQueue.then(async () => {
    const waitMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastNominatimRequestAt = Date.now();
    return fetch(url, { headers: { 'User-Agent': 'HelpHub student civic-tech project (location lookup)' }, signal: AbortSignal.timeout(12000) });
  });
  nominatimQueue = task.catch(() => {});
  return task;
}

function requireAdmin(request) {
  const expected = process.env.ADMIN_TOKEN;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  if (!expected) throw Object.assign(new Error('Admin access is not configured. Set ADMIN_TOKEN in .env.'), { status: 503 });
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    throw Object.assign(new Error('Admin token is incorrect.'), { status: 401 });
  }
}

async function listEvents(searchParams) {
  let events = store.db
    ? (await store.db.collection('events').find().sort({ date: 1 }).toArray()).map(eventDocument)
    : [...store.memoryEvents];
  const query = (searchParams.get('q') || '').trim().toLowerCase();
  const category = searchParams.get('category') || '';
  if (query) events = events.filter((event) => `${event.title} ${event.location} ${event.description}`.toLowerCase().includes(query));
  if (category && category !== 'All causes') events = events.filter((event) => event.category === category);
  return events;
}

async function getRegistrations() {
  return store.db
    ? (await store.db.collection('registrations').find().sort({ registrationDate: -1 }).toArray()).map(registrationDocument)
    : [...store.memoryRegistrations];
}

async function handleApi(request, response, url) {
  const { pathname, searchParams } = url;
  const method = request.method;
  if (pathname === '/api/health' && method === 'GET') {
    const health = await checkDatabaseHealth();
    return sendJson(response, health.ok ? 200 : 503, {
      ...health,
      storage: health.ok ? 'mongodb' : 'preview',
      configured: getConnectionStatus() !== 'preview'
    });
  }
  if (pathname === '/api/events' && method === 'GET') return sendJson(response, 200, await listEvents(searchParams));
  if (pathname === '/api/discovery' && method === 'GET') {
    enforceLocationLimit(request, 'discovery', 60);
    return sendJson(response, 200, await discoverServices(searchParams));
  }
  if (pathname === '/api/location/reverse' && method === 'GET') {
    enforceLocationLimit(request, 'reverse', 20);
    const latitude = Number(searchParams.get('lat'));
    const longitude = Number(searchParams.get('lon'));
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return sendJson(response, 400, { error: 'Valid coordinates are required.' });
    try { return sendJson(response, 200, await reverseGeocode(latitude, longitude)); }
    catch (error) { return sendJson(response, 502, { error: error.message }); }
  }
  if (pathname === '/api/location/search' && method === 'GET') {
    enforceLocationLimit(request, 'search', 10);
    const query = (searchParams.get('q') || '').trim();
    if (query.length < 2 || query.length > 120) return sendJson(response, 400, { error: 'Enter a city, area, or PIN code.' });
    try { return sendJson(response, 200, await searchLocation(query)); }
    catch (error) { return sendJson(response, error.status || 502, { error: error.message }); }
  }
  if (pathname === '/api/stats' && method === 'GET') {
    const [events, registrations] = await Promise.all([listEvents(new URLSearchParams()), getRegistrations()]);
    return sendJson(response, 200, {
      eventCount: events.length,
      volunteerCount: new Set(registrations.map((item) => item.email)).size,
      hours: registrations.reduce((total, item) => total + Number(item.volunteerHours || 0), 0)
    });
  }
  if (pathname.startsWith('/api/events/') && method === 'GET') {
    const id = decodeURIComponent(pathname.slice('/api/events/'.length));
    const event = store.db
      ? eventDocument(await store.db.collection('events').findOne({ _id: mongoId(id) }))
      : store.memoryEvents.find((item) => item.id === id);
    return event ? sendJson(response, 200, event) : sendJson(response, 404, { error: 'Opportunity not found.' });
  }
  if (pathname === '/api/registrations' && method === 'POST') {
    const input = await parseBody(request);
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase().slice(0, 254) : '';
    const phone = typeof input.phone === 'string' ? input.phone.trim().slice(0, 40) : '';
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[+\d][\d\s().-]{6,38}$/.test(phone) || typeof input.eventId !== 'string') {
      return sendJson(response, 400, { error: 'Enter a name, valid email, phone number, and opportunity.' });
    }
    const now = new Date().toISOString();
    if (store.db) {
      const event = await store.db.collection('events').findOneAndUpdate(
        { _id: mongoId(input.eventId), availableSlots: { $gt: 0 } },
        { $inc: { availableSlots: -1 } },
        { returnDocument: 'after' }
      );
      if (!event) return sendJson(response, 409, { error: 'This opportunity is full or no longer available.' });
      try {
        await store.db.collection('registrations').insertOne({ volunteerName: name, email, phone, eventId: String(event._id), eventTitle: event.title, eventDate: event.date, location: event.location, volunteerHours: event.volunteerHours, registrationDate: now, status: 'registered' });
        await store.db.collection('users').updateOne({ email }, { $set: { name, phone, updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
      } catch (error) {
        await store.db.collection('events').updateOne({ _id: event._id }, { $inc: { availableSlots: 1 } });
        if (error.code === 11000) return sendJson(response, 409, { error: 'You are already registered for this opportunity.' });
        throw error;
      }
    } else {
      const event = store.memoryEvents.find((item) => item.id === input.eventId);
      if (!event || event.availableSlots < 1) return sendJson(response, 409, { error: 'This opportunity is full or no longer available.' });
      if (store.memoryRegistrations.some((item) => item.eventId === input.eventId && item.email === email)) return sendJson(response, 409, { error: 'You are already registered for this opportunity.' });
      event.availableSlots -= 1;
      store.memoryRegistrations.push({ id: crypto.randomUUID(), volunteerName: name, email, phone, eventId: event.id, eventTitle: event.title, eventDate: event.date, location: event.location, volunteerHours: event.volunteerHours, registrationDate: now, status: 'registered' });
      const user = store.memoryUsers.find((item) => item.email === email);
      if (user) Object.assign(user, { name, phone });
      else store.memoryUsers.push({ name, email, phone });
    }
    return sendJson(response, 201, { message: 'You are on the list. See you there!', email });
  }
  if (pathname === '/api/volunteer' && method === 'GET') {
    const email = (searchParams.get('email') || '').trim().toLowerCase();
    if (!email) return sendJson(response, 400, { error: 'Email is required.' });
    const registrations = (await getRegistrations()).filter((item) => item.email === email);
    const totalHours = registrations.reduce((total, item) => total + Number(item.volunteerHours || 0), 0);
    return sendJson(response, 200, { registrations, totalHours, upcomingCount: registrations.filter((item) => item.eventDate >= new Date().toISOString().slice(0, 10)).length });
  }
  if (pathname.startsWith('/api/admin/')) requireAdmin(request);
  if (pathname === '/api/admin/summary' && method === 'GET') {
    const registrations = await getRegistrations();
    const events = await listEvents(new URLSearchParams());
    return sendJson(response, 200, {
      eventCount: events.length,
      volunteerCount: new Set(registrations.map((item) => item.email)).size,
      registrationCount: registrations.length,
      hours: registrations.reduce((total, item) => total + Number(item.volunteerHours || 0), 0)
    });
  }
  if (pathname === '/api/admin/registrations' && method === 'GET') return sendJson(response, 200, await getRegistrations());
  if (pathname === '/api/admin/organizations' && method === 'POST') {
    const input = await parseBody(request);
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 180) : '';
    const category = typeof input.category === 'string' && SERVICE_CATEGORIES.includes(input.category) ? input.category : '';
    const longitude = Number(input.longitude);
    const latitude = Number(input.latitude);
    if (name.length < 2 || !category || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return sendJson(response, 400, { error: 'Name, supported category, latitude, and longitude are required.' });
    const organization = {
      name,
      category,
      location: toGeoPoint(longitude, latitude),
      ...(typeof input.address === 'string' && input.address.trim() ? { address: input.address.trim().slice(0, 300) } : {}),
      ...(typeof input.phone === 'string' && input.phone.trim() ? { phone: input.phone.trim().slice(0, 50) } : {}),
      ...(typeof input.openingHours === 'string' && input.openingHours.trim() ? { openingHours: input.openingHours.trim().slice(0, 300) } : {}),
      ...(typeof input.description === 'string' && input.description.trim() ? { description: input.description.trim().slice(0, 2000) } : {}),
      ...(typeof input.image === 'string' && /^https?:\/\//i.test(input.image) ? { image: input.image.slice(0, 1000) } : {}),
      source: 'HelpHub database',
      createdAt: new Date().toISOString()
    };
    if (store.db) {
      const result = await store.db.collection('organizations').insertOne(organization);
      organization.id = String(result.insertedId);
    } else {
      organization.id = crypto.randomUUID();
      organization.coordinates = [longitude, latitude];
      store.memoryOrganizations.push(organization);
    }
    return sendJson(response, 201, { ...organization, _id: undefined, location: undefined });
  }
  if (pathname === '/api/admin/events' && method === 'POST') {
    const event = { ...validEvent(await parseBody(request)), createdAt: new Date().toISOString() };
    if (store.db) {
      const result = await store.db.collection('events').insertOne(event);
      event.id = String(result.insertedId);
    } else {
      event.id = crypto.randomUUID();
      store.memoryEvents.push(event);
    }
    return sendJson(response, 201, eventDocument(event));
  }
  const eventMatch = pathname.match(/^\/api\/admin\/events\/([^/]+)$/);
  if (eventMatch && method === 'PUT') {
    const id = decodeURIComponent(eventMatch[1]);
    const changes = validEvent(await parseBody(request));
    const event = store.db
      ? eventDocument(await store.db.collection('events').findOneAndUpdate({ _id: mongoId(id) }, { $set: changes }, { returnDocument: 'after' }))
      : Object.assign(store.memoryEvents.find((item) => item.id === id) || {}, changes);
    if (!event || !event.id) return sendJson(response, 404, { error: 'Opportunity not found.' });
    return sendJson(response, 200, event);
  }
  if (eventMatch && method === 'DELETE') {
    const id = decodeURIComponent(eventMatch[1]);
    const result = store.db
      ? await store.db.collection('events').deleteOne({ _id: mongoId(id) })
      : { deletedCount: store.memoryEvents.filter((item) => item.id === id).length };
    if (!store.db) store.memoryEvents = store.memoryEvents.filter((item) => item.id !== id);
    return result.deletedCount ? sendJson(response, 200, { message: 'Opportunity removed.' }) : sendJson(response, 404, { error: 'Opportunity not found.' });
  }
  return sendJson(response, 404, { error: 'API route not found.' });
}

function mongoId(value) {
  const { ObjectId } = require('mongodb');
  if (!ObjectId.isValid(value)) throw Object.assign(new Error('Invalid opportunity id.'), { status: 404 });
  return new ObjectId(value);
}

function serveFile(request, response, url) {
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const target = path.resolve(PUBLIC_DIR, `.${relative}`);
  if (!target.startsWith(`${PUBLIC_DIR}${path.sep}`) && target !== path.join(PUBLIC_DIR, 'index.html')) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const extension = path.extname(target);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url);
    else if (request.method === 'GET' || request.method === 'HEAD') serveFile(request, response, url);
    else sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
    else response.destroy();
    if (!error.status) console.error(error);
  }
});

connectDatabase(seedEvents).then((database) => {
  store.db = database;
  server.listen(PORT, () => console.log(`HelpHub is ready at http://localhost:${PORT}`));
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

process.on('SIGINT', async () => {
  server.close();
  await closeDatabase();
  process.exit(0);
});
