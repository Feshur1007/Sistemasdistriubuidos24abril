/**
 * server.js — Entry point
 *
 * Wires together the database, HTTP routes, and WebSocket server,
 * then starts listening. All actual logic lives in:
 *   db.js      → SQLite initialisation and query helpers
 *   routes.js  → Express REST API
 *   ws.js      → WebSocket server and message handling
 */

const express = require('express');
const http    = require('http');
const path    = require('path');

const db     = require('./src/db');
const routes = require('./src/routes');
const ws     = require('./src/ws');

const PORT = process.env.PORT || 3002;

const app    = express();
const server = http.createServer(app);

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Puerto ${PORT} ya está en uso. Usa otro puerto o cierra el proceso que lo usa.`);
    process.exit(1);
  }
  throw err;
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Attach WebSocket server first so `broadcast` is available for routes
const { broadcast } = ws.attach(server);


// Register HTTP routes, passing broadcast so mutations notify WS clients
routes.register(app, broadcast);

// Initialise the database then start listening
db.init().then(() => {
  server.listen(PORT, () => {
    const line = '─'.repeat(48);
    console.log(`\n┌${line}┐`);
    console.log(`│  Distributed DB Node                           │`);
    console.log(`│  ID   : ${db.NODE_ID.padEnd(38)}│`);
    console.log(`│  HTTP : http://localhost:${String(PORT).padEnd(22)}│`);
    console.log(`│  WS   : ws://localhost:${String(PORT).padEnd(24)}│`);
    console.log(`│  DB   : ${path.basename(db.DB_FILE).padEnd(38)}│`);
    console.log(`├${line}┤`);
    console.log(`│  Expose via Ngrok:  ngrok http ${String(PORT).padEnd(16)}│`);
    console.log(`└${line}┘\n`);
  });
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});


