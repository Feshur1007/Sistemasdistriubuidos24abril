/**
 * db.js — Database layer
 *
 * Initialises a sql.js (pure WASM) SQLite database, persists it to disk
 * after every write, and exports all query helpers used by routes and ws.
 */

const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');

const NODE_ID = process.env.NODE_ID || `node-${Math.random().toString(36).slice(2, 8)}`;
const DB_FILE = path.join(__dirname, '..', `db_${NODE_ID}.sqlite`);

let db; // sql.js Database instance, set in init()

async function init() {
  const SQL = await initSqlJs();

  let fileBuffer = null;
  try { fileBuffer = fs.readFileSync(DB_FILE); } catch { /* first run — no file yet */ }

  db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS records (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      value      TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  persist();
}

// Write the in-memory database back to disk
function persist() {
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

// ── Query helpers ─────────────────────────────────────────────────────────────

function getAll() {
  const stmt = db.prepare('SELECT * FROM records ORDER BY created_at DESC');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function getById(id) {
  const stmt = db.prepare('SELECT * FROM records WHERE id = ?');
  stmt.bind([id]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function insertRecord(name, value) {
  const id = uuidv4();
  db.run('INSERT INTO records (id, name, value) VALUES (?, ?, ?)', [id, name, value]);
  persist();
  return getById(id);
}

function updateRecord(id, name, value) {
  db.run(
    "UPDATE records SET name=?, value=?, updated_at=datetime('now') WHERE id=?",
    [name, value, id]
  );
  persist();
  return getById(id);
}

function deleteRecord(id) {
  db.run('DELETE FROM records WHERE id=?', [id]);
  persist();
}

module.exports = {
  init,
  NODE_ID,
  DB_FILE,
  getAll,
  getById,
  insertRecord,
  updateRecord,
  deleteRecord,
};
