# HelpHub

HelpHub connects volunteers with nearby community opportunities. The project uses plain HTML, CSS, and browser JavaScript, a Node.js server built on the native `http` module, and MongoDB for persistence. Express and frontend frameworks are not used.

## Project Description

HelpHub is a social-welfare discovery website. Volunteers can find nearby services and volunteer events, search by name or cause, compare distances, view locations on a map, and register for available events. Organizers can manage events and review registrations. Nearby map listings come from OpenStreetMap; HelpHub events and organization records come from the HelpHub database. Results depend on those sources and are not a complete list of every service in an area.

## Project Files: What Is What

- `public/index.html`: the page structure, navigation, search controls, map container, result list, and dialogs.
- `public/styles.css`: the visual design and layouts for desktop, tablet, and mobile screens.
- `public/app.js`: browser interactions, including location permission, manual place search, filters, map markers, result cards, and event registration.
- `server.js`: the Node.js server. It serves the frontend and handles the JSON API routes for discovery, events, registrations, and organizers.
- `db.js`: loads environment variables, connects to MongoDB using the official driver, creates database indexes, and checks database health.
- `.env.example`: a template showing which settings belong in your private `.env` file. Its values are placeholders, not working credentials.
- `.env`: your private local configuration, including the Atlas URI and admin token. Create it from `.env.example`; do not commit it or share its contents.
- `package.json`: project metadata, dependency list, and commands such as `npm start` and `npm test`.
- `package-lock.json`: exact installed dependency versions so installs are repeatable.
- `.gitignore`: tells Git not to track `.env` or `node_modules/`.
- `tests/discovery.test.js`: automated checks for location lookup, discovery filters, distances, pagination, source failures, and volunteer registration.

## Technologies: What Each One Does

- **HTML** defines the content and controls displayed in the browser.
- **CSS** controls colors, typography, spacing, map/list layouts, and responsive behavior.
- **Browser JavaScript** requests device location when permitted, sends searches to the server, updates results, and connects interface actions to API routes.
- **Node.js `http` module** serves the website and receives API requests without Express.
- **MongoDB Node.js driver** reads and writes events, organizations, volunteers, and registrations in MongoDB Atlas.
- **dotenv** loads private settings from `.env` into the Node.js process. Credentials stay on the server and are not sent to browser JavaScript.
- **Leaflet and OpenStreetMap** provide the interactive map and mapped places. OpenStreetMap results may have incomplete names, addresses, contact details, or opening hours.

## How Location Discovery Works

1. The browser asks permission to read the user's device location. If the user declines or location is unavailable, they can search for a city, area, or PIN code instead.
2. The browser sends latitude, longitude, radius, and selected filters to `GET /api/discovery` on the HelpHub server.
3. The server retrieves matching nearby places from OpenStreetMap and geotagged HelpHub records from MongoDB, then combines, deduplicates, distance-sorts, and paginates the results.
4. The browser displays the results as cards and map markers. Event cards use the existing registration API and save registrations in MongoDB when Atlas is connected.

MongoDB GeoJSON coordinates use `[longitude, latitude]`. Device coordinates and location-search results identify the search center; they do not mean that a service has been verified by HelpHub. A source label on each result indicates where its information came from.

## Run locally

Prerequisites: Node.js 18.17 or newer, npm, and a MongoDB Atlas cluster (or local MongoDB for development).

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell).
3. In MongoDB Atlas, create a cluster and a database user with a password. Add your current client IP under **Network Access**.
4. In Atlas, select **Connect → Drivers → Node.js**, copy the connection string, and replace `<username>`, `<password>`, and `<cluster-url>` in `MONGODB_URI` in `.env`. URL-encode special characters in the password.
5. Set `MONGODB_DATABASE=helphub` and replace `ADMIN_TOKEN` with a long private random value.
6. Start HelpHub: `npm start`
7. Open `http://localhost:3000` and check `http://localhost:3000/api/health`.

When `MONGODB_URI` is blank or still contains the template placeholders, the server starts in preview mode with sample opportunities. Preview data is temporary and is not saved after restart. In preview mode `/api/health` returns HTTP `503` with `status: "preview"`; it does not claim MongoDB is connected. If a configured Atlas connection fails, startup stops with a safe diagnostic rather than silently switching to temporary storage. The organizer dashboard requires `ADMIN_TOKEN` in `.env`.

`db.js` loads `.env`, connects once with the official MongoDB Node.js driver, verifies the connection with `ping`, creates the registration and geospatial indexes, and exposes a health check. The first MongoDB-backed startup adds clearly marked sample opportunities only when `events` is empty. Existing matching sample events receive their sample coordinates if they have no geospatial point yet.

## What you can do

- Search opportunities by name, description, and location; filter by cause.
- Open complete event details and register with name, email, and phone.
- See your registered, upcoming, and completed activities by entering the same email used to register.
- Add, edit, and delete opportunities in the organizer dashboard, and review registrations and summary counts.
- Discover nearby OpenStreetMap results and geotagged HelpHub events and organizations by location.
- Register only once per opportunity. Available spots are decremented on successful registration and restored if a database write fails.

## API overview

- `GET /api/health` (MongoDB `ping`; HTTP 200 only when connected), `GET /api/stats`
- `GET /api/events`, `GET /api/events/:id`
- `GET /api/discovery?lat=...&lon=...&radius=...`
- `GET /api/location/search?q=...`, `GET /api/location/reverse?lat=...&lon=...`
- `POST /api/registrations`
- `GET /api/volunteer?email=...`
- `GET /api/admin/summary`, `GET /api/admin/registrations`
- `POST /api/admin/events`, `PUT /api/admin/events/:id`, `DELETE /api/admin/events/:id`
- `POST /api/admin/organizations` (requires valid name, category, latitude, and longitude)

Admin API calls use `Authorization: Bearer <ADMIN_TOKEN>`. Volunteer dashboards use email lookup for this syllabus project; add account authentication before using it with real personal data.

## Storage

MongoDB collections:

- `users`: volunteer name, email, phone, and timestamps.
- `events`: opportunity details, human-readable address, `geoLocation` GeoJSON point, cause, hours, and available spots. Events need coordinates to appear in nearby discovery.
- `organizations`: organization name, category, optional contact/opening-hours details, and `location` GeoJSON point.
- `registrations`: volunteer details, event snapshot, registration date, and status.

The built-in Node server serves `public/` and handles the JSON API. `.env` and `node_modules/` are ignored by Git. No build step is required. Use `npm run dev` during development and `npm test` for the local fixture-backed discovery and registration tests.

The location UI calls browser geolocation only after the user permits it, with city/area/PIN search as a fallback. Map places come from OpenStreetMap through the server; results depend on source coverage and are not an exhaustive directory. Opening-now filters are limited to supported opening-hours formats. OpenStreetMap data is © its contributors and subject to the ODbL.
