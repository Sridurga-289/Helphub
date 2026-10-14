const state = {
  events: [],
  adminToken: sessionStorage.getItem('helphub-admin-token') || '',
  adminEvents: [],
  adminRegistrations: [],
  adminSummary: null,
  adminPane: 'events',
  editingId: null,
  toastTimer: null,
  location: null,
  discoveryResults: [],
  discoveryCounts: {},
  discoveryPage: 1,
  discoveryTotal: 0,
  discoveryHasMore: false,
  selectedCategory: '',
  discoveryController: null,
  discoveryTimer: null,
  map: null,
  markerLayer: null,
  locationMarker: null,
  mobileView: 'list'
};

const categoryMarks = {
  Environment: '✳',
  Education: '⌁',
  'Animal Welfare': '♡',
  'Food Donation': '◒',
  'Community Service': '✴',
  'NGOs & Charities': '✳',
  'Child Welfare': '⌂',
  'Elder Care': '♡',
  'Food Support': '◒',
  'Health & Blood': '+',
  'Community Services': '⌂',
  'Shelter & Relief': '⌂',
  'Volunteer Events': '↗'
};

const serviceCategories = [
  'NGOs & Charities', 'Child Welfare', 'Elder Care', 'Food Support', 'Health & Blood',
  'Animal Welfare', 'Environment', 'Education', 'Community Services', 'Shelter & Relief',
  'Volunteer Events'
];

const $ = (selector, parent = document) => parent.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const safeImage = (value) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
};

async function api(url, options = {}, token = '') {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function formatDate(date, options = { month: 'short', day: 'numeric' }) {
  if (!date) return 'Date to be confirmed';
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('en', options).format(parsed);
}

function formatTime(time) {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hours, minutes));
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3400);
}

function serviceMarkerColor(service) {
  if (service.serviceType === 'event') return 'marker-saffron';
  if (service.source === 'HelpHub database') return 'marker-navy';
  return 'marker-green';
}

function renderCategoryChips() {
  const entries = [['', 'All services', state.discoveryTotal], ...serviceCategories.map((category) => [category, category, state.discoveryCounts[category] || 0])];
  $('#category-chips').innerHTML = entries.map(([value, label, count]) => `<button class="category-chip-button ${state.selectedCategory === value ? 'selected' : ''}" data-category="${escapeHtml(value)}" aria-pressed="${state.selectedCategory === value}">${escapeHtml(label)}<span>${count}</span></button>`).join('');
  $('#category-filter').value = state.selectedCategory;
}

function eventForService(service) {
  return service.serviceType === 'event' ? state.events.find((event) => event.id === service.id) : null;
}

function renderServiceCard(service, index) {
  const event = eventForService(service);
  const image = safeImage(service.image);
  const coordinates = service.coordinates;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${coordinates[1]},${coordinates[0]}`)}`;
  const address = service.address ? `<p class="service-address"><span aria-hidden="true">⌖</span>${escapeHtml(service.address)}</p>` : '';
  const phone = service.phone ? `<a class="service-contact" href="tel:${escapeHtml(service.phone.replace(/[^+\d]/g, ''))}">☎ ${escapeHtml(service.phone)}</a>` : '';
  const hours = service.openingHours ? `<span class="service-hours ${service.openNow === true ? 'hours-open' : ''}">${service.openNow === true ? 'Open now · ' : ''}${escapeHtml(service.openingHours)}</span>` : '';
  const eventMeta = event ? `<div class="event-service-meta"><span>${escapeHtml(formatDate(service.date, { weekday: 'short', month: 'short', day: 'numeric' }))}${service.time ? ` · ${escapeHtml(formatTime(service.time))}` : ''}</span>${service.organizer ? `<span>By ${escapeHtml(service.organizer)}</span>` : ''}<span>${Number(service.availableSlots)} spots · ${Number(service.volunteerHours)} hrs</span></div>` : '';
  return `<article class="service-card" style="--card-index:${index}">
    <div class="service-card-media ${image ? '' : 'no-service-image'}">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : `<span class="service-icon" aria-hidden="true">${escapeHtml(categoryMarks[service.category] || '✳')}</span>`}<span class="service-category">${escapeHtml(categoryMarks[service.category] || '✳')} ${escapeHtml(service.category)}</span><span class="source-tag ${serviceMarkerColor(service)}">${escapeHtml(service.source)}</span></div>
    <div class="service-card-body"><div class="service-heading-row"><h3>${escapeHtml(service.name)}</h3><span class="distance-badge">${Number(service.distanceKm).toFixed(1)} km</span></div>
      ${address}${eventMeta}${service.description ? `<p class="service-description">${escapeHtml(service.description)}</p>` : ''}
      <div class="service-extra">${phone}${hours}</div>
      <div class="service-actions"><button class="text-link" data-service-details="${escapeHtml(service.id)}" data-service-type="${service.serviceType}">View details <span aria-hidden="true">↗</span></button><a class="directions-link" href="${escapeHtml(directions)}" target="_blank" rel="noopener noreferrer" aria-label="Get directions to ${escapeHtml(service.name)}">Directions ↗</a>${event ? `<button class="button button-dark register-service-button" data-register-event="${escapeHtml(service.id)}" ${Number(service.availableSlots) < 1 ? 'disabled' : ''}>${Number(service.availableSlots) > 0 ? 'Register now' : 'Fully booked'} <span aria-hidden="true">↗</span></button>` : ''}</div>
    </div>
  </article>`;
}

function renderDiscoveryResults(append = false) {
  const list = $('#service-list');
  if (state.discoveryResults.length) {
    list.innerHTML = `${append ? list.innerHTML : ''}${state.discoveryResults.slice(append ? (state.discoveryPage - 1) * 24 : 0).map(renderServiceCard).join('')}`;
  } else list.innerHTML = '';
  $('#empty-state').hidden = state.loadingDiscovery || state.discoveryResults.length > 0 || !state.location;
  $('#result-count').textContent = state.location ? `${state.discoveryTotal} ${state.discoveryTotal === 1 ? 'service' : 'services'} found` : 'Choose a location to begin';
  $('#location-summary').textContent = state.location ? `Near ${state.location.label} · ${$('#radius-select').value} km radius` : '';
  $('#load-more').hidden = !state.discoveryHasMore || state.loadingDiscovery;
  renderCategoryChips();
  renderMapMarkers(append);
}

function ensureMap() {
  if (state.map || !window.L || !$('#discovery-map')) return;
  state.map = L.map('discovery-map', { scrollWheelZoom: false, zoomControl: true }).setView([22.5, 79], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
  }).addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
}

function renderMapMarkers(append = false) {
  ensureMap();
  if (!state.map) {
    $('#discovery-map').innerHTML = '<div class="map-unavailable">The map tiles could not load. Service results are still available in the list.</div>';
    return;
  }
  if (!append) state.markerLayer.clearLayers();
  if (state.location && !state.locationMarker) {
    state.locationMarker = L.circleMarker([state.location.latitude, state.location.longitude], { radius: 8, color: '#ffffff', weight: 3, fillColor: '#1d4266', fillOpacity: 1 }).addTo(state.map).bindPopup('Your selected search location');
  } else if (state.location && state.locationMarker) {
    state.locationMarker.setLatLng([state.location.latitude, state.location.longitude]);
  }
  for (const service of (append ? state.discoveryResults.slice((state.discoveryPage - 1) * 24) : state.discoveryResults)) {
    const [longitude, latitude] = service.coordinates;
    const marker = L.marker([latitude, longitude], { icon: L.divIcon({ className: `service-marker ${serviceMarkerColor(service)}`, html: `<span>${escapeHtml(categoryMarks[service.category] || '✳')}</span>`, iconSize: [32, 32], iconAnchor: [16, 16] }) });
    marker.bindPopup(`<strong>${escapeHtml(service.name)}</strong><br>${escapeHtml(service.category)} · ${Number(service.distanceKm).toFixed(1)} km`);
    marker.addTo(state.markerLayer);
  }
  if (state.location) {
    const zoom = Number($('#radius-select').value) <= 5 ? 14 : Number($('#radius-select').value) <= 10 ? 13 : 11;
    state.map.setView([state.location.latitude, state.location.longitude], zoom);
    state.map.invalidateSize();
  }
}

function renderSkeletons() {
  $('#service-list').innerHTML = Array.from({ length: 4 }, () => '<article class="service-skeleton"><div></div><section><i></i><i></i><i></i></section></article>').join('');
  $('#empty-state').hidden = true;
  $('#load-more').hidden = true;
}

async function loadEvents() {
  try { state.events = await api('/api/events'); }
  catch { state.events = []; }
}

async function loadDiscovery({ reset = true, append = false } = {}) {
  if (!state.location) {
    $('#result-count').textContent = 'Choose a location to begin';
    return;
  }
  if (state.discoveryController) state.discoveryController.abort();
  const controller = new AbortController();
  state.discoveryController = controller;
  if (reset) {
    state.discoveryPage = 1;
    state.discoveryResults = [];
    state.loadingDiscovery = true;
    renderSkeletons();
  }
  const params = new URLSearchParams({
    lat: state.location.latitude,
    lon: state.location.longitude,
    radius: $('#radius-select').value,
    page: String(reset ? 1 : state.discoveryPage),
    sort: $('#sort-select').value
  });
  if ($('#search-input').value.trim()) params.set('q', $('#search-input').value.trim());
  if (state.selectedCategory) params.set('category', state.selectedCategory);
  if ($('#open-now-filter').checked) params.set('openNow', 'true');
  try {
    const data = await api(`/api/discovery?${params}`, { signal: controller.signal });
    if (controller.signal.aborted) return;
    state.discoveryTotal = data.total;
    state.discoveryCounts = data.counts || {};
    state.discoveryHasMore = data.hasMore;
    state.discoveryResults = reset ? data.results : [...state.discoveryResults, ...data.results];
    $('#source-warning').hidden = !data.warning;
    $('#source-warning').textContent = data.warning || '';
    $('#data-disclaimer').textContent = data.disclaimer;
    const openCount = state.discoveryResults.filter((item) => typeof item.openNow === 'boolean').length;
    $('#open-now-filter').disabled = openCount === 0;
    $('#open-filter-note').textContent = openCount ? `${openCount} result${openCount === 1 ? '' : 's'} with supported hours` : 'No supported open status in these results';
    state.loadingDiscovery = false;
    renderDiscoveryResults(append);
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.loadingDiscovery = false;
    $('#service-list').innerHTML = `<div class="discovery-error"><span class="error-symbol">!</span><h3>Nearby results couldn’t load.</h3><p>${escapeHtml(error.message)}</p><button class="button button-dark" id="retry-discovery">Try again <span aria-hidden="true">↻</span></button></div>`;
    $('#result-count').textContent = 'Search unavailable';
    $('#empty-state').hidden = true;
    $('#load-more').hidden = true;
  }
}

function scheduleDiscovery() {
  clearTimeout(state.discoveryTimer);
  state.discoveryTimer = setTimeout(() => loadDiscovery(), 320);
}

function setLocation(latitude, longitude, label, method) {
  state.location = { latitude, longitude, label: label || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, method };
  $('#location-status').textContent = `Searching near ${state.location.label}`;
  $('#location-status').classList.remove('location-error');
  $('#location-summary').textContent = `Near ${state.location.label} · ${$('#radius-select').value} km radius`;
  loadDiscovery();
    if (method === 'device') {
      api(`/api/location/reverse?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`).then((place) => {
        if (!state.location || state.location.latitude !== latitude || state.location.longitude !== longitude) return;
        state.location.label = place.label || state.location.label;
        $('#location-status').textContent = `Searching near ${state.location.label}`;
        $('#location-summary').textContent = `Near ${state.location.label} · ${$('#radius-select').value} km radius`;
      }).catch(() => {});
    }
}

function showLocationError(message) {
  $('#location-status').textContent = message;
  $('#location-status').classList.add('location-error');
  $('#manual-location').focus({ preventScroll: true });
}

function detectLocation() {
  if (!navigator.geolocation) return showLocationError('Location detection is not available in this browser. Search for a city, area or PIN code instead.');
  $('#location-status').textContent = 'Checking your location…';
  $('#location-status').classList.remove('location-error');
  $('#detect-location').disabled = true;
  navigator.geolocation.getCurrentPosition((position) => {
    $('#detect-location').disabled = false;
    setLocation(position.coords.latitude, position.coords.longitude, '', 'device');
  }, (error) => {
    $('#detect-location').disabled = false;
    const message = error.code === 1
      ? 'Location permission was denied. Search by city, area or PIN code instead.'
      : error.code === 2
        ? 'Your location is unavailable right now. Search by city, area or PIN code instead.'
        : 'Location took too long. Try again or search by city, area or PIN code.';
    showLocationError(message);
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
}

async function submitManualLocation(query) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return showLocationError('Enter a city, area or PIN code to search.');
  $('#location-status').textContent = 'Finding that place…';
  $('#location-status').classList.remove('location-error');
  try {
    const place = await api(`/api/location/search?q=${encodeURIComponent(trimmed)}`);
    setLocation(place.latitude, place.longitude, place.label || trimmed, 'manual');
  } catch (error) { showLocationError(error.message); }
}

function serviceDetails(service) {
  const image = safeImage(service.image);
  const [longitude, latitude] = service.coordinates;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${latitude},${longitude}`)}`;
  $('#detail-content').innerHTML = `<div class="service-detail-layout"><div class="service-detail-image">${image ? `<img src="${escapeHtml(image)}" alt="">` : `<span>${escapeHtml(categoryMarks[service.category] || '✳')}</span>`}</div><div class="detail-copy"><p class="eyebrow">${escapeHtml(service.source)}</p><span class="service-category detail-category">${escapeHtml(categoryMarks[service.category] || '✳')} ${escapeHtml(service.category)}</span><h2 id="detail-title">${escapeHtml(service.name)}</h2><div class="detail-facts">${service.address ? `<span><b>⌖</b>${escapeHtml(service.address)}</span>` : ''}<span><b>⌖</b>${Number(service.distanceKm).toFixed(1)} km from your selected location</span>${service.phone ? `<span><b>☎</b><a href="tel:${escapeHtml(service.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(service.phone)}</a></span>` : ''}${service.openingHours ? `<span><b>◷</b>${escapeHtml(service.openingHours)}${typeof service.openNow === 'boolean' ? ` · ${service.openNow ? 'Open now' : 'Not currently open'}` : ''}</span>` : ''}${service.organizer ? `<span><b>✳</b>Organized by ${escapeHtml(service.organizer)}</span>` : ''}${service.date ? `<span><b>◷</b>${escapeHtml(formatDate(service.date, { weekday: 'long', month: 'long', day: 'numeric' }))}${service.time ? ` · ${escapeHtml(formatTime(service.time))}` : ''}</span>` : ''}${service.availableSlots !== undefined ? `<span><b>✳</b>${Number(service.availableSlots)} spots · ${Number(service.volunteerHours)} volunteer hours</span>` : ''}</div>${service.description ? `<p class="detail-description">${escapeHtml(service.description)}</p>` : ''}<p class="source-note">Source: ${escapeHtml(service.source)}${service.sourceUrl ? ` · <a href="${escapeHtml(service.sourceUrl)}" target="_blank" rel="noopener noreferrer">View map record ↗</a>` : ''}</p><div class="service-detail-actions"><a class="button button-dark" href="${escapeHtml(directions)}" target="_blank" rel="noopener noreferrer">Get directions <span aria-hidden="true">↗</span></a>${service.serviceType === 'event' && event ? `<button class="button button-saffron" data-register-event="${escapeHtml(event.id)}">Register now <span aria-hidden="true">↗</span></button>` : ''}</div></div></div>`;
  $('#event-dialog').showModal();
}

async function loadStats() {
  try {
    const stats = await api('/api/stats');
    $('#impact-events').textContent = stats.eventCount;
    $('#impact-volunteers').textContent = stats.volunteerCount;
    $('#impact-hours').textContent = stats.hours;
    if (stats.volunteerCount) $('#hero-volunteer-count').textContent = `${stats.volunteerCount} local volunteer${stats.volunteerCount === 1 ? '' : 's'}`;
  } catch { /* The opportunity list remains useful while metrics are unavailable. */ }
}

function openEvent(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return;
  const image = safeImage(event.image);
  $('#detail-content').innerHTML = `<div class="detail-layout">
    <div class="detail-image-wrap">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(event.title)}">` : '<span class="image-fallback">✳</span>'}<span class="category-chip">${escapeHtml(categoryMarks[event.category] || '✳')} ${escapeHtml(event.category)}</span></div>
    <div class="detail-copy"><p class="eyebrow">AN OPPORTUNITY TO SHOW UP</p><h2 id="detail-title">${escapeHtml(event.title)}</h2>
      <div class="detail-facts"><span><b>◷</b>${escapeHtml(formatDate(event.date, { weekday: 'long', month: 'long', day: 'numeric' }))}<br>${escapeHtml(formatTime(event.time))}</span><span><b>⌖</b>${escapeHtml(event.location)}</span><span><b>✳</b>${Number(event.volunteerHours) || 1} volunteer hours · ${Number(event.availableSlots) || 0} spots left</span></div>
      <p class="detail-description">${escapeHtml(event.description)}</p><p class="organizer-line">Hosted by <strong>${escapeHtml(event.organizer)}</strong></p>
      <button class="button button-dark detail-register" data-register-event="${escapeHtml(event.id)}" ${Number(event.availableSlots) < 1 ? 'disabled' : ''}>${Number(event.availableSlots) < 1 ? 'Fully booked' : 'Register for this one'} <span aria-hidden="true">↗</span></button>
    </div></div>`;
  $('#event-dialog').showModal();
}

function openRegistration(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event || Number(event.availableSlots) < 1) return showToast('This opportunity is fully booked.', true);
  const profile = JSON.parse(localStorage.getItem('helphub-volunteer') || '{}');
  $('#registration-content').innerHTML = `<p class="eyebrow">COUNT ME IN</p><h2 id="registration-title">A little time.<br><em>A real difference.</em></h2><p class="form-event-name">${escapeHtml(event.title)} <span>· ${escapeHtml(formatDate(event.date))}</span></p>
    <form id="registration-form" class="stack-form"><input type="hidden" name="eventId" value="${escapeHtml(event.id)}"><label>Your name<input required name="name" autocomplete="name" minlength="2" maxlength="120" placeholder="Name you go by" value="${escapeHtml(profile.name || '')}"></label><label>Email address<input required name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${escapeHtml(profile.email || '')}"></label><label>Phone number<input required name="phone" type="tel" autocomplete="tel" minlength="7" maxlength="40" placeholder="+91 98765 43210" value="${escapeHtml(profile.phone || '')}"></label><p class="form-note">We’ll only use your details to coordinate this opportunity.</p><button class="button button-dark" type="submit">Save my spot <span aria-hidden="true">↗</span></button><p class="form-feedback" aria-live="polite"></p></form>`;
  $('#event-dialog').close();
  $('#registration-dialog').showModal();
}

function renderVolunteerForm(message = '') {
  const profile = JSON.parse(localStorage.getItem('helphub-volunteer') || '{}');
  $('#dashboard-content').innerHTML = `<p class="eyebrow">YOUR GOOD WORK, IN ONE PLACE</p><h2 id="dashboard-title">My <em>activity.</em></h2><p class="dashboard-lede">Enter the email you used to register and we’ll find your activities.</p><form class="stack-form compact-form" id="volunteer-lookup"><label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@example.com" value="${escapeHtml(profile.email || '')}"></label><button class="button button-dark">Find my activities <span aria-hidden="true">↗</span></button><p class="form-feedback">${escapeHtml(message)}</p></form>`;
}

async function loadVolunteer(email) {
  $('#dashboard-content').innerHTML = '<div class="dashboard-loading">Finding your good work<span>✳</span></div>';
  try {
    const data = await api(`/api/volunteer?email=${encodeURIComponent(email)}`);
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = data.registrations.filter((item) => item.eventDate >= today);
    const completed = data.registrations.filter((item) => item.eventDate < today);
    $('#dashboard-content').innerHTML = `<p class="eyebrow">YOUR GOOD WORK, IN ONE PLACE</p><div class="dashboard-title-row"><h2 id="dashboard-title">My <em>activity.</em></h2><button class="text-link" data-change-email>Change email ↗</button></div>
      <div class="dashboard-stats"><div><strong>${data.registrations.length}</strong><span>registered</span></div><div><strong>${upcoming.length}</strong><span>upcoming</span></div><div><strong>${data.totalHours}</strong><span>hours pledged</span></div></div>
      <div class="dashboard-section-head"><h3>Coming up</h3><span>${upcoming.length} ${upcoming.length === 1 ? 'activity' : 'activities'}</span></div>
      ${upcoming.length ? `<div class="activity-list">${upcoming.map((item) => `<article class="activity-row"><div class="activity-date"><strong>${escapeHtml(formatDate(item.eventDate).split(' ')[1] || formatDate(item.eventDate))}</strong><span>${escapeHtml(formatDate(item.eventDate).split(' ')[0] || '')}</span></div><div class="activity-info"><h4>${escapeHtml(item.eventTitle)}</h4><span>${escapeHtml(item.location)}</span></div><span class="activity-hours">${Number(item.volunteerHours)} hrs</span></article>`).join('')}</div>` : '<p class="dashboard-empty">Nothing on the calendar yet. Your next good thing is waiting.</p>'}
      ${completed.length ? `<div class="dashboard-section-head completed-head"><h3>Already showed up</h3><span>${completed.length}</span></div><div class="activity-list">${completed.map((item) => `<article class="activity-row completed-row"><div class="activity-date"><strong>${escapeHtml(formatDate(item.eventDate).split(' ')[1] || formatDate(item.eventDate))}</strong><span>${escapeHtml(formatDate(item.eventDate).split(' ')[0] || '')}</span></div><div class="activity-info"><h4>${escapeHtml(item.eventTitle)}</h4><span>${escapeHtml(item.location)}</span></div><span class="activity-hours">Done ✓</span></article>`).join('')}</div>` : ''}`;
  } catch (error) {
    renderVolunteerForm(error.message);
  }
}

function openVolunteerDashboard() {
  const email = JSON.parse(localStorage.getItem('helphub-volunteer') || '{}').email;
  if (email) loadVolunteer(email);
  else renderVolunteerForm();
  $('#dashboard-dialog').showModal();
}

function adminRequest(url, options = {}) {
  return api(url, options, state.adminToken);
}

async function loadAdminData() {
  const [summary, events, registrations] = await Promise.all([
    adminRequest('/api/admin/summary'),
    adminRequest('/api/events'),
    adminRequest('/api/admin/registrations')
  ]);
  state.adminSummary = summary;
  state.adminEvents = events;
  state.adminRegistrations = registrations;
}

function renderAdminLogin(message = '') {
  $('#dashboard-content').innerHTML = `<p class="eyebrow">THE ORGANIZER’S DESK</p><h2 id="dashboard-title">Make good <em>happen.</em></h2><p class="dashboard-lede">Enter your organizer access token to manage opportunities and registrations.</p><form class="stack-form compact-form" id="admin-login"><label>Organizer token<input name="token" type="password" required autocomplete="current-password" placeholder="Your admin token"></label><button class="button button-dark">Open organizer dashboard <span aria-hidden="true">↗</span></button><p class="form-feedback">${escapeHtml(message)}</p></form>`;
}

function adminEventForm(event = null) {
  const value = (field, fallback = '') => escapeHtml(event?.[field] ?? fallback);
    const coordinates = event?.geoLocation?.coordinates || event?.coordinates || [];
  return `<form class="admin-event-form" id="admin-event-form"><h3>${event ? 'Edit opportunity' : 'Add an opportunity'}</h3>
    <label>Title<input name="title" required maxlength="180" value="${value('title')}" placeholder="A clear, inviting name"></label>
    <div class="form-pair"><label>Cause<select name="category" required>${['Environment', 'Education', 'Animal Welfare', 'Food Donation', 'Community Service'].map((item) => `<option ${event?.category === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label><label>Date<input name="date" type="date" required value="${value('date')}"></label></div>
    <div class="form-pair"><label>Start time<input name="time" type="time" required value="${value('time', '09:00')}"></label><label>Available spots<input name="availableSlots" type="number" min="0" max="500" required value="${value('availableSlots', '10')}"></label></div>
    <label>Location<input name="location" required maxlength="180" value="${value('location')}" placeholder="Neighbourhood, city"></label>
      <div class="form-pair"><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" value="${coordinates[1] ?? ''}" placeholder="Optional"></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" value="${coordinates[0] ?? ''}" placeholder="Optional"></label></div>
    <label>Organizer<input name="organizer" required maxlength="180" value="${value('organizer')}" placeholder="Community group or organization"></label>
    <label>Image URL<input name="image" type="url" required value="${value('image', 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1200&q=85')}" placeholder="https://..."></label>
    <div class="form-pair"><label>Volunteer hours<input name="volunteerHours" type="number" min="1" max="24" required value="${value('volunteerHours', '2')}"></label><span></span></div>
    <label>What will volunteers do?<textarea name="description" required maxlength="2000" rows="3" placeholder="A few sentences about the activity">${value('description')}</textarea></label>
    <div class="admin-form-actions"><button type="button" class="text-link" data-cancel-edit>Cancel</button><button class="button button-dark">${event ? 'Save changes' : 'Publish opportunity'} <span aria-hidden="true">↗</span></button></div><p class="form-feedback" aria-live="polite"></p></form>`;
}

function renderAdminDashboard() {
  const summary = state.adminSummary;
  const eventPane = state.adminPane === 'events';
  const editing = state.adminEvents.find((event) => event.id === state.editingId);
  $('#dashboard-content').innerHTML = `<p class="eyebrow">THE ORGANIZER’S DESK</p><div class="dashboard-title-row"><h2 id="dashboard-title">Make good <em>happen.</em></h2><button class="text-link" data-admin-logout>Sign out ↗</button></div>
    <div class="dashboard-stats admin-stats"><div><strong>${summary.eventCount}</strong><span>opportunities</span></div><div><strong>${summary.volunteerCount}</strong><span>volunteers</span></div><div><strong>${summary.registrationCount}</strong><span>registrations</span></div></div>
    <div class="admin-tabs" role="tablist"><button role="tab" aria-selected="${eventPane}" data-admin-pane="events">Opportunities <span>${state.adminEvents.length}</span></button><button role="tab" aria-selected="${!eventPane}" data-admin-pane="registrations">Registrations <span>${state.adminRegistrations.length}</span></button></div>
    ${eventPane ? `<div class="admin-content-grid"><div class="admin-event-list"><div class="dashboard-section-head"><h3>All opportunities</h3><button class="small-add-button" data-add-event aria-label="Add opportunity">+</button></div>${state.adminEvents.length ? state.adminEvents.map((event) => `<article class="admin-event-row"><div><h4>${escapeHtml(event.title)}</h4><span>${escapeHtml(formatDate(event.date))} · ${Number(event.availableSlots)} spots · ${escapeHtml(event.category)}</span></div><div class="row-actions"><button data-edit-event="${escapeHtml(event.id)}" aria-label="Edit ${escapeHtml(event.title)}">Edit</button><button class="delete-action" data-delete-event="${escapeHtml(event.id)}" aria-label="Delete ${escapeHtml(event.title)}">Delete</button></div></article>`).join('') : '<p class="dashboard-empty">No opportunities yet. Add the first one.</p>'}</div>${adminEventForm(editing)}</div>` : `<div class="admin-registration-list"><div class="dashboard-section-head"><h3>Volunteer registrations</h3><span>${state.adminRegistrations.length} total</span></div>${state.adminRegistrations.length ? `<div class="table-wrap"><table><thead><tr><th>Volunteer</th><th>Opportunity</th><th>Email</th><th>Registered</th></tr></thead><tbody>${state.adminRegistrations.map((item) => `<tr><td>${escapeHtml(item.volunteerName)}</td><td>${escapeHtml(item.eventTitle)}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(formatDate(item.registrationDate?.slice(0, 10)))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dashboard-empty">No registrations yet.</p>'}</div>`}`;
}

async function openAdminDashboard() {
  $('#dashboard-dialog').showModal();
  if (!state.adminToken) return renderAdminLogin();
  $('#dashboard-content').innerHTML = '<div class="dashboard-loading">Opening the organizer’s desk<span>✳</span></div>';
  try {
    await loadAdminData();
    renderAdminDashboard();
  } catch (error) {
    sessionStorage.removeItem('helphub-admin-token');
    state.adminToken = '';
    renderAdminLogin(error.message);
  }
}

async function submitRegistration(form) {
  const feedback = $('.form-feedback', form);
  const button = $('button[type="submit"]', form);
  const payload = Object.fromEntries(new FormData(form));
  button.disabled = true;
  feedback.textContent = 'Saving your spot…';
  try {
    const result = await api('/api/registrations', { method: 'POST', body: JSON.stringify(payload) });
    localStorage.setItem('helphub-volunteer', JSON.stringify({ name: payload.name, email: payload.email.trim().toLowerCase(), phone: payload.phone }));
    $('#registration-dialog').close();
    showToast(result.message);
    await Promise.all([loadEvents(), loadStats(), loadDiscovery()]);
  } catch (error) {
    feedback.textContent = error.message;
    feedback.classList.add('feedback-error');
    button.disabled = false;
  }
}

$('#search-input').addEventListener('input', scheduleDiscovery);
$('#category-filter').addEventListener('change', (event) => {
  state.selectedCategory = event.currentTarget.value;
  loadDiscovery();
});
$('#radius-select').addEventListener('change', () => loadDiscovery());
$('#sort-select').addEventListener('change', () => loadDiscovery());
$('#open-now-filter').addEventListener('change', () => loadDiscovery());
$('#manual-location-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitManualLocation($('#manual-location').value);
});
$('#detect-location').addEventListener('click', detectLocation);
$('#refresh-discovery').addEventListener('click', () => loadDiscovery());
$('#load-more').addEventListener('click', () => {
  if (!state.discoveryHasMore) return;
  state.discoveryPage += 1;
  $('#load-more').disabled = true;
  loadDiscovery({ reset: false, append: true }).finally(() => { $('#load-more').disabled = false; });
});
$('#clear-filters').addEventListener('click', () => {
  $('#search-input').value = '';
  $('#category-filter').value = '';
  $('#open-now-filter').checked = false;
  state.selectedCategory = '';
  loadDiscovery();
});
$('#list-view-button').addEventListener('click', () => {
  state.mobileView = 'list';
  $('.discovery-layout').classList.remove('map-mobile');
  $('#list-view-button').setAttribute('aria-pressed', 'true');
  $('#map-view-button').setAttribute('aria-pressed', 'false');
});
$('#map-view-button').addEventListener('click', () => {
  state.mobileView = 'map';
  $('.discovery-layout').classList.add('map-mobile');
  $('#list-view-button').setAttribute('aria-pressed', 'false');
  $('#map-view-button').setAttribute('aria-pressed', 'true');
  ensureMap();
  state.map?.invalidateSize();
});
$('[data-scroll-opportunities]').addEventListener('click', () => $('#opportunities').scrollIntoView({ behavior: 'smooth' }));

$('.menu-button').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const expanded = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!expanded));
  $('.main-nav').classList.toggle('nav-open', !expanded);
});

$('.main-nav').addEventListener('click', (event) => {
  const link = event.target.closest('[data-view]');
  if (!link) return;
  $('.main-nav').classList.remove('nav-open');
  $('.menu-button').setAttribute('aria-expanded', 'false');
  $$('.nav-link').forEach((item) => item.classList.toggle('active', item === link));
  if (link.dataset.view === 'volunteer') {
    event.preventDefault();
    openVolunteerDashboard();
  } else if (link.dataset.view === 'admin') {
    event.preventDefault();
    openAdminDashboard();
  }
});

function $$(selector, parent = document) { return [...parent.querySelectorAll(selector)]; }

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.hasAttribute('data-close-dialog')) target.closest('dialog').close();
  if (target.hasAttribute('data-reload-events')) loadDiscovery();
  if (target.dataset.openEvent) openEvent(target.dataset.openEvent);
  if (target.dataset.serviceDetails) {
    const service = state.discoveryResults.find((item) => item.id === target.dataset.serviceDetails);
    if (service) serviceDetails(service);
  }
  if (target.dataset.category !== undefined) {
    state.selectedCategory = target.dataset.category;
    $('#category-filter').value = state.selectedCategory;
    loadDiscovery();
  }
  if (target.id === 'retry-discovery') loadDiscovery();
  if (target.dataset.registerEvent) openRegistration(target.dataset.registerEvent);
  if (target.hasAttribute('data-change-email')) renderVolunteerForm();
  if (target.hasAttribute('data-admin-logout')) {
    state.adminToken = '';
    sessionStorage.removeItem('helphub-admin-token');
    renderAdminLogin();
  }
  if (target.dataset.adminPane) {
    state.adminPane = target.dataset.adminPane;
    state.editingId = null;
    renderAdminDashboard();
  }
  if (target.hasAttribute('data-add-event')) {
    state.editingId = null;
    renderAdminDashboard();
    $('#admin-event-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('input[name="title"]', $('#admin-event-form'))?.focus();
  }
  if (target.dataset.editEvent) {
    state.editingId = target.dataset.editEvent;
    renderAdminDashboard();
    $('#admin-event-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (target.hasAttribute('data-cancel-edit')) {
    state.editingId = null;
    renderAdminDashboard();
  }
  if (target.dataset.deleteEvent && window.confirm('Remove this opportunity? Existing registration records will remain in the dashboard.')) {
    try {
      await adminRequest(`/api/admin/events/${encodeURIComponent(target.dataset.deleteEvent)}`, { method: 'DELETE' });
      await loadAdminData();
      renderAdminDashboard();
      await loadEvents();
      showToast('Opportunity removed.');
    } catch (error) { showToast(error.message, true); }
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'registration-form') {
    event.preventDefault();
    await submitRegistration(form);
  }
  if (form.id === 'volunteer-lookup') {
    event.preventDefault();
    const email = new FormData(form).get('email').trim().toLowerCase();
    localStorage.setItem('helphub-volunteer', JSON.stringify({ email }));
    await loadVolunteer(email);
  }
  if (form.id === 'admin-login') {
    event.preventDefault();
    const token = new FormData(form).get('token');
    state.adminToken = token;
    try {
      await loadAdminData();
      sessionStorage.setItem('helphub-admin-token', token);
      state.adminPane = 'events';
      renderAdminDashboard();
    } catch (error) {
      state.adminToken = '';
      $('.form-feedback', form).textContent = error.message;
      $('.form-feedback', form).classList.add('feedback-error');
    }
  }
  if (form.id === 'admin-event-form') {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    const editingId = state.editingId;
    try {
      await adminRequest(editingId ? `/api/admin/events/${encodeURIComponent(editingId)}` : '/api/admin/events', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.editingId = null;
      await loadAdminData();
      renderAdminDashboard();
      await loadEvents();
      showToast(editingId ? 'Opportunity updated.' : 'Opportunity published.');
    } catch (error) {
      $('.form-feedback', form).textContent = error.message;
      $('.form-feedback', form).classList.add('feedback-error');
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    $('#search-input').focus();
  }
  if (event.key === 'Escape') $('.main-nav').classList.remove('nav-open');
});

async function initializeDiscovery() {
  ensureMap();
  renderCategoryChips();
  await Promise.all([loadEvents(), loadStats()]);
  detectLocation();
}

initializeDiscovery();
