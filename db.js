const path = require('node:path');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');

dotenv.config({ path: path.join(__dirname, '.env') });

const connection = { client: null, database: null, status: 'not-configured' };

function isPlaceholder(uri) {
  return /<\s*(?:username|password|cluster-url)\s*>/i.test(uri);
}

async function connectDatabase(seedEvents = []) {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri || isPlaceholder(uri)) {
    connection.status = 'preview';
    console.warn('MongoDB is not connected. Set MONGODB_URI in .env to enable persistent storage.');
    return null;
  }

  connection.status = 'connecting';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const database = client.db(process.env.MONGODB_DATABASE || 'helphub');
    await database.command({ ping: 1 });
    await database.collection('registrations').createIndex({ eventId: 1, email: 1 }, { unique: true });
    await database.collection('registrations').createIndex({ email: 1 });
    await database.collection('organizations').createIndex({ location: '2dsphere' });
    await database.collection('events').createIndex({ geoLocation: '2dsphere' });

    const eventCount = await database.collection('events').countDocuments();
    if (eventCount === 0 && seedEvents.length) {
      await database.collection('events').insertMany(seedEvents.map(({ id, ...event }) => event));
    } else if (eventCount > 0) {
      await Promise.all(seedEvents.map((event) => database.collection('events').updateOne(
        { title: event.title, location: event.location, date: event.date, geoLocation: { $exists: false } },
        { $set: { geoLocation: event.geoLocation, coordinates: event.coordinates, sampleData: true } }
      )));
    }

    connection.client = client;
    connection.database = database;
    connection.status = 'connected';
    console.log(`MongoDB connected: ${database.databaseName}`);
    return database;
  } catch (error) {
    await client.close().catch(() => {});
    connection.status = 'failed';
    throw new Error(`MongoDB connection failed (${error.name}). Check the Atlas URI, database user, and Network Access allowlist.`);
  }
}

async function checkDatabaseHealth() {
  if (!connection.database || connection.status !== 'connected') {
    return { ok: false, status: connection.status, database: null };
  }
  try {
    await connection.database.command({ ping: 1 });
    return { ok: true, status: 'connected', database: connection.database.databaseName };
  } catch {
    connection.status = 'failed';
    return { ok: false, status: 'failed', database: connection.database.databaseName };
  }
}

function getConnectionStatus() {
  return connection.status;
}

async function closeDatabase() {
  if (connection.client) await connection.client.close();
  connection.client = null;
  connection.database = null;
  if (connection.status === 'connected') connection.status = 'closed';
}

module.exports = { connectDatabase, checkDatabaseHealth, getConnectionStatus, closeDatabase };
