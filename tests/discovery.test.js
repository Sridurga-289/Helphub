const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const searchPoint = { latitude: 17.4239, longitude: 78.4204 };
let fixtureServer;
let appProcess;
let appPort;
let fixturePort;
let failOverpass = false;
let appOutput = '';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function fixtureElements() {
  const records = [
    { type: 'node', id: 1, lat: 17.424, lon: 78.421, tags: { name: 'Test Care Centre', amenity: 'clinic', phone: '+91 40 1234 5678', opening_hours: 'Mo-Su 00:00-23:59' } },
    { type: 'node', id: 2, lat: 17.42401, lon: 78.42101, tags: { name: 'Test Care Centre', amenity: 'clinic' } },
    { type: 'node', id: 3, lat: 17.424, lon: 78.46, tags: { name: 'Test Care Centre', amenity: 'clinic' } },
    { type: 'node', id: 4, lat: 17.425, lon: 78.422, tags: { office: 'ngo' } }
  ];
  for (let index = 0; index < 29; index += 1) {
    records.push({
      type: 'node',
      id: 100 + index,
      lat: 17.43 + index * 0.00015,
      lon: 78.425 + index * 0.00013,
      tags: { name: `Community Group ${String(index + 1).padStart(2, '0')}`, office: 'ngo', ...(index === 0 ? { 'addr:suburb': 'Test locality' } : {}) }
    });
  }
  return records;
}

function readRequestBody(request) {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => resolve(body));
  });
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  return { response, payload: await response.json() };
}

async function waitForServer(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* The child process has not started listening yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`HelpHub did not start. ${appOutput}`);
}

test.before(async () => {
  fixtureServer = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/search') {
      response.end(JSON.stringify([{ lat: '17.4239', lon: '78.4204', name: 'Madhapur', display_name: 'Madhapur, Hyderabad', address: { suburb: 'Madhapur' } }]));
      return;
    }
    if (url.pathname === '/reverse') {
      response.end(JSON.stringify({ name: 'Madhapur', display_name: 'Madhapur, Hyderabad', address: { suburb: 'Madhapur' } }));
      return;
    }
    if (url.pathname === '/interpreter') {
      await readRequestBody(request);
      if (failOverpass) {
        response.writeHead(503);
        response.end(JSON.stringify({ error: 'fixture unavailable' }));
        return;
      }
      response.end(JSON.stringify({ elements: fixtureElements() }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'fixture route missing' }));
  });
  fixturePort = await listen(fixtureServer);
  const reserveServer = http.createServer();
  appPort = await listen(reserveServer);
  await new Promise((resolve) => reserveServer.close(resolve));
  appProcess = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(appPort),
      MONGODB_URI: '',
      ADMIN_TOKEN: 'helphub-tests-only',
      OVERPASS_URL: `http://127.0.0.1:${fixturePort}/interpreter`,
      NOMINATIM_URL: `http://127.0.0.1:${fixturePort}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  appProcess.stdout.on('data', (chunk) => { appOutput += chunk.toString(); });
  appProcess.stderr.on('data', (chunk) => { appOutput += chunk.toString(); });
  await waitForServer(`http://127.0.0.1:${appPort}/`);
});

test.after(async () => {
  if (appProcess && !appProcess.killed) {
    appProcess.kill();
    await new Promise((resolve) => appProcess.once('exit', resolve));
  }
  if (fixtureServer?.listening) await new Promise((resolve) => fixtureServer.close(resolve));
});

test('manual location search resolves an Indian locality and reverse lookup names coordinates', async () => {
  const { response: searchResponse, payload: place } = await requestJson(`http://127.0.0.1:${appPort}/api/location/search?q=Madhapur`);
  assert.equal(searchResponse.status, 200);
  assert.deepEqual([place.latitude, place.longitude, place.label], [17.4239, 78.4204, 'Madhapur']);
  const { response, payload } = await requestJson(`http://127.0.0.1:${appPort}/api/location/reverse?lat=17.4239&lon=78.4204`);
  assert.equal(response.status, 200);
  assert.equal(payload.label, 'Madhapur');
});

test('database health does not report preview mode as a successful MongoDB connection', async () => {
  const { response, payload } = await requestJson(`http://127.0.0.1:${appPort}/api/health`);
  assert.equal(response.status, 503);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, 'preview');
  assert.equal(payload.configured, false);
});

test('nearby search combines sources, calculates distances, deduplicates branches, and paginates', async () => {
  const base = `http://127.0.0.1:${appPort}/api/discovery?lat=${searchPoint.latitude}&lon=${searchPoint.longitude}&radius=10`;
  const { response, payload } = await requestJson(base);
  assert.equal(response.status, 200);
  assert.equal(payload.sources.openStreetMap, 'available');
  assert.equal(payload.total > payload.pageSize, true);
  assert.equal(payload.results.length, payload.pageSize);
  assert.equal(payload.hasMore, true);
  assert.equal(payload.results.some((item) => item.source === 'HelpHub sample event'), true);
  const careCentreCount = payload.results.filter((item) => item.name === 'Test Care Centre').length;
  assert.equal(careCentreCount, 1);
  const careCentre = payload.results.find((item) => item.name === 'Test Care Centre');
  assert.equal(careCentre.phone, '+91 40 1234 5678');
  assert.equal(Number.isFinite(careCentre.distanceKm), true);
  assert.equal(careCentre.distanceKm < 1, true);
  assert.equal(careCentre.openingHours, 'Mo-Su 00:00-23:59');
  const { payload: secondPage } = await requestJson(`${base}&page=2`);
  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.results.length > 0, true);
  assert.equal([...payload.results, ...secondPage.results].filter((item) => item.name === 'Test Care Centre').length, 2);
  assert.equal(payload.counts['Volunteer Events'] > 0, true);
});

test('category and keyword filters use returned source fields', async () => {
  const base = `http://127.0.0.1:${appPort}/api/discovery?lat=${searchPoint.latitude}&lon=${searchPoint.longitude}&radius=10`;
  const { payload: category } = await requestJson(`${base}&category=NGOs%20%26%20Charities`);
  assert.equal(category.results.length > 0, true);
  assert.equal(category.results.every((item) => item.category === 'NGOs & Charities'), true);
  const { payload: query } = await requestJson(`${base}&q=Test%20Care%20Centre`);
  assert.equal(query.total, 2);
  assert.equal(query.results.every((item) => item.name === 'Test Care Centre'), true);
});

test('location discovery rejects missing coordinates, invalid radius, and unknown filters', async () => {
  const base = `http://127.0.0.1:${appPort}/api/discovery`;
  assert.equal((await fetch(base)).status, 400);
  assert.equal((await fetch(`${base}?lat=17&lon=78&radius=7`)).status, 400);
  assert.equal((await fetch(`${base}?lat=17&lon=78&category=Made-up`)).status, 400);
});

test('source failure is reported while mapped HelpHub results remain available', async () => {
  failOverpass = true;
  const { response, payload } = await requestJson(`http://127.0.0.1:${appPort}/api/discovery?lat=12.9716&lon=77.5946&radius=10`);
  failOverpass = false;
  assert.equal(response.status, 200);
  assert.equal(payload.sources.openStreetMap, 'unavailable');
  assert.match(payload.warning, /temporarily unavailable/);
  assert.equal(payload.total, 0);
});

test('organizer organization records require a token and are discoverable by coordinates', async () => {
  const url = `http://127.0.0.1:${appPort}/api/admin/organizations`;
  const organization = { name: 'HelpHub Test Support Centre', category: 'Community Services', latitude: searchPoint.latitude, longitude: searchPoint.longitude, address: 'Test locality, Hyderabad' };
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(organization) })).status, 401);
  const { response, payload } = await requestJson(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer helphub-tests-only', 'Content-Type': 'application/json' },
    body: JSON.stringify(organization)
  });
  assert.equal(response.status, 201);
  assert.equal(payload.name, organization.name);
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer helphub-tests-only', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...organization, latitude: 200 }) })).status, 400);
  const { payload: discovery } = await requestJson(`http://127.0.0.1:${appPort}/api/discovery?lat=${searchPoint.latitude}&lon=${searchPoint.longitude}&radius=5&q=${encodeURIComponent(organization.name)}`);
  assert.equal(discovery.total, 1);
  assert.equal(discovery.results[0].source, 'HelpHub database');
});

test('existing volunteer registration rejects duplicates and updates upcoming activities', async () => {
  const events = await fetch(`http://127.0.0.1:${appPort}/api/events`).then((response) => response.json());
  const event = events[0];
  const body = { name: 'Discovery Test Volunteer', email: 'discovery-test@example.test', phone: '+1 555 222 3333', eventId: event.id };
  const register = () => fetch(`http://127.0.0.1:${appPort}/api/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await register()).status, 201);
  assert.equal((await register()).status, 409);
  assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) })).status, 400);
  const volunteer = await fetch(`http://127.0.0.1:${appPort}/api/volunteer?email=${encodeURIComponent(body.email)}`).then((response) => response.json());
  assert.equal(volunteer.registrations.length, 1);
  assert.equal(volunteer.totalHours, event.volunteerHours);
});
