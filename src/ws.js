/**
 * ws.js — WebSocket server
 *
 * Attaches a WebSocket server to the existing HTTP server.
 * Two kinds of clients connect here:
 *   1. This node's own browser tab — for live push updates (read-only listener).
 *   2. Remote browsers pointing at this node — to read/write/delete records.
 *
 * Exported message protocol (remote client → this node):
 *   ping                              → pong
 *   read                              → read_response  { records }
 *   write  { data: {name, value} }    → write_response { record }
 *   update { id, data: {name,value} } → update_response{ record }
 *   delete { id }                     → delete_response{ id }
 */

const WebSocket = require('ws');
const db        = require('./db');

function attach(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const origin = req.headers['origin'] ?? req.socket.remoteAddress;
    console.log(`[${db.NODE_ID}] WS CONNECT    from ${origin}`);

    // Tell the connecting client which node it reached
    send(ws, { type: 'welcome', nodeId: db.NODE_ID });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); }
      catch { return send(ws, { type: 'error', message: 'Invalid JSON' }); }

      console.log(`[${db.NODE_ID}] WS MSG        type=${msg.type}`);
      handleMessage(ws, msg);
    });

    ws.on('close', () => console.log(`[${db.NODE_ID}] WS DISCONNECT from ${origin}`));
    ws.on('error', (err) => console.error(`[${db.NODE_ID}] WS ERROR:`, err.message));
  });

  // ── Message handler ─────────────────────────────────────────────────────────
  function handleMessage(ws, msg) {
    switch (msg.type) {

      case 'ping':
        send(ws, { type: 'pong', nodeId: db.NODE_ID });
        break;

      case 'read':
        send(ws, { type: 'read_response', nodeId: db.NODE_ID, records: db.getAll() });
        break;

      case 'write': {
        const { name, value } = msg.data ?? {};
        if (!name) return send(ws, { type: 'error', message: '"name" is required' });

        const record = db.insertRecord(name, value ?? '');
        broadcast({ type: 'change', action: 'create', record });
        send(ws, { type: 'write_response', nodeId: db.NODE_ID, success: true, record });
        console.log(`[${db.NODE_ID}] WS WRITE     id=${record.id.slice(0, 8)} name="${name}"`);
        break;
      }

      case 'update': {
        const { id } = msg;
        const { name, value } = msg.data ?? {};
        if (!id || !name) return send(ws, { type: 'error', message: '"id" and "name" are required' });
        if (!db.getById(id)) return send(ws, { type: 'error', message: 'Record not found' });

        const record = db.updateRecord(id, name, value ?? '');
        broadcast({ type: 'change', action: 'update', record });
        send(ws, { type: 'update_response', nodeId: db.NODE_ID, success: true, record });
        console.log(`[${db.NODE_ID}] WS UPDATE    id=${id.slice(0, 8)}`);
        break;
      }

      case 'delete': {
        const { id } = msg;
        if (!id) return send(ws, { type: 'error', message: '"id" is required' });
        if (!db.getById(id)) return send(ws, { type: 'error', message: 'Record not found' });

        db.deleteRecord(id);
        broadcast({ type: 'change', action: 'delete', id });
        send(ws, { type: 'delete_response', nodeId: db.NODE_ID, success: true, id });
        console.log(`[${db.NODE_ID}] WS DELETE    id=${id.slice(0, 8)}`);
        break;
      }

      default:
        send(ws, { type: 'error', message: `Unknown message type: "${msg.type}"` });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }

  return { wss, broadcast };
}

module.exports = { attach };
