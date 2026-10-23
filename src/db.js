const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL fehlt (siehe README)');
}

const isLocal = /@(localhost|127\.0\.0\.1)[:/]|host=\/tmp/.test(process.env.DATABASE_URL);

// Auf Vercel läuft jede Funktion mit eigenem Pool, deshalb klein halten
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 3,
});

async function query(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

async function one(text, params) {
  return (await query(text, params))[0] || null;
}

// Führt fn(client) in einer Transaktion aus
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, tx };
