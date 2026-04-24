/**
 * routes.js — HTTP REST API
 *
 * Registers all Express routes for local CRUD operations.
 * Receives `broadcast` from ws.js so that HTTP mutations
 * push live updates to every connected WebSocket client.
 *
 * Endpoints:
 *   GET    /api/info           — node identity
 *   GET    /api/records        — list all records
 *   POST   /api/records        — create a record  { name, value }
 *   PUT    /api/records/:id    — update a record  { name, value }
 *   DELETE /api/records/:id    — delete a record
 */

const path = require('path');
const db   = require('./db');

function register(app, broadcast) {
  // ── Node info ───────────────────────────────────────────────────────────────
  app.get('/api/info', (_req, res) => {
    res.json({
      nodeId: db.NODE_ID,
      dbFile: path.basename(db.DB_FILE),
    });
  });

  // ── Read all ────────────────────────────────────────────────────────────────
  app.get('/api/records', (_req, res) => {
    res.json(db.getAll());
  });

  // ── Create ──────────────────────────────────────────────────────────────────
  app.post('/api/records', (req, res) => {
    const { name, value } = req.body;
    if (!name) return res.status(400).json({ error: '"name" is required' });

    const record = db.insertRecord(name, value ?? '');
    broadcast({ type: 'change', action: 'create', record });
    console.log(`[${db.NODE_ID}] HTTP CREATE  id=${record.id.slice(0, 8)} name="${name}"`);
    res.status(201).json(record);
  });

  // ── Update ──────────────────────────────────────────────────────────────────
  app.put('/api/records/:id', (req, res) => {
    const { id } = req.params;
    const { name, value } = req.body;
    if (!name) return res.status(400).json({ error: '"name" is required' });
    if (!db.getById(id)) return res.status(404).json({ error: 'Record not found' });

    const record = db.updateRecord(id, name, value ?? '');
    broadcast({ type: 'change', action: 'update', record });
    console.log(`[${db.NODE_ID}] HTTP UPDATE  id=${id.slice(0, 8)}`);
    res.json(record);
  });

  // ── Delete ──────────────────────────────────────────────────────────────────
  app.delete('/api/records/:id', (req, res) => {
    const { id } = req.params;
    if (!db.getById(id)) return res.status(404).json({ error: 'Record not found' });

    db.deleteRecord(id);
    broadcast({ type: 'change', action: 'delete', id });
    console.log(`[${db.NODE_ID}] HTTP DELETE  id=${id.slice(0, 8)}`);
    res.json({ success: true, id });
  });
}

module.exports = { register };
