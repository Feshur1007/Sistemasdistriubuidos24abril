// ═══════════════════════════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════════════════════════
let nodeId        = '';
let localWs       = null;   // WS to our own server — for live push updates
let remoteWs      = null;   // WS to a remote server
let remoteNodeId  = '';
let remoteRecords = [];

// ═══════════════════════════════════════════════════════════════════════════════
//  Boot
// ═══════════════════════════════════════════════════════════════════════════════
(async () => {
  const info = await apiFetch('/api/info');
  nodeId = info.nodeId;
  document.getElementById('headerNodeId').textContent = nodeId;
  document.getElementById('localNodeId').textContent  = nodeId;
  document.title = `Distributed DB — ${nodeId}`;

  await refreshLocal();
  connectLocalWs();
  log('ws', `Node ${nodeId} ready`);
})();

// ═══════════════════════════════════════════════════════════════════════════════
//  Own WebSocket — receive live pushes when remote peers write to our DB
// ═══════════════════════════════════════════════════════════════════════════════
function connectLocalWs() {
  const wsUrl = location.href.replace(/^http/, 'ws');
  localWs = new WebSocket(wsUrl);

  localWs.onopen = () => {
    document.getElementById('liveDot').classList.remove('disconnected');
    log('ws', 'Local WS connected — live updates active');
  };

  localWs.onclose = () => {
    document.getElementById('liveDot').classList.add('disconnected');
    log('error', 'Local WS closed — reconnecting in 3 s');
    setTimeout(connectLocalWs, 3000);
  };

  localWs.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.type === 'change') applyLocalChange(msg);
  };
}

// Update the local table incrementally when a remote peer mutates our DB
function applyLocalChange(msg) {
  if (msg.action === 'create') {
    log('ws', `Remote peer wrote "${msg.record.name}" into our DB`);
    prependLocalRow(msg.record);
  } else if (msg.action === 'update') {
    log('ws', `Remote peer updated record ${msg.record.id.slice(0, 8)}…`);
    refreshLocal();
  } else if (msg.action === 'delete') {
    log('ws', `Remote peer deleted record ${msg.id.slice(0, 8)}…`);
    document.querySelector(`tr[data-id="${msg.id}"]`)?.remove();
    checkEmptyLocal();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Local CRUD
// ═══════════════════════════════════════════════════════════════════════════════
async function refreshLocal() {
  renderLocalTable(await apiFetch('/api/records'));
}

function renderLocalTable(records) {
  const tbody = document.getElementById('localTable');
  tbody.innerHTML = records.length
    ? records.map(localRow).join('')
    : '<tr><td colspan="5" class="empty-msg">No records yet</td></tr>';
}

function localRow(r) {
  return `<tr data-id="${r.id}">
    <td class="id-cell" title="${r.id}">${r.id.slice(0, 8)}…</td>
    <td>${esc(r.name)}</td>
    <td class="val-cell">${esc(r.value)}</td>
    <td style="color:var(--muted);font-size:11px">${fmtDate(r.updated_at)}</td>
    <td class="actions-cell">
      <button class="btn btn-ghost btn-sm"
              onclick="openEditModal('${r.id}','${esc(r.name)}','${esc(r.value)}')">Edit</button>
      <button class="btn btn-danger btn-sm"
              onclick="localDelete('${r.id}')">Del</button>
    </td>
  </tr>`;
}

function prependLocalRow(record) {
  const tbody = document.getElementById('localTable');
  tbody.querySelector('.empty-msg')?.closest('tr').remove();

  const tr = document.createElement('tr');
  tr.setAttribute('data-id', record.id);
  tr.innerHTML = localRow(record).replace(/^<tr[^>]*>/, '').replace(/<\/tr>$/, '');
  tr.className = 'highlight';
  tbody.prepend(tr);
}

function checkEmptyLocal() {
  const tbody = document.getElementById('localTable');
  if (!tbody.querySelector('tr')) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">No records yet</td></tr>';
  }
}

async function localCreate() {
  const name  = document.getElementById('localName').value.trim();
  const value = document.getElementById('localValue').value.trim();
  if (!name) { alert('Name is required'); return; }

  await apiFetch('/api/records', 'POST', { name, value });
  document.getElementById('localName').value  = '';
  document.getElementById('localValue').value = '';
  await refreshLocal();
  log('local', `Created "${name}"`);
}

function openEditModal(id, name, value) {
  document.getElementById('editId').value    = id;
  document.getElementById('editName').value  = name;
  document.getElementById('editValue').value = value;
  document.getElementById('editModal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('open');
}

async function localUpdate() {
  const id    = document.getElementById('editId').value;
  const name  = document.getElementById('editName').value.trim();
  const value = document.getElementById('editValue').value.trim();
  if (!name) { alert('Name is required'); return; }

  await apiFetch(`/api/records/${id}`, 'PUT', { name, value });
  closeEditModal();
  await refreshLocal();
  log('local', `Updated ${id.slice(0, 8)}… → "${name}"`);
}

async function localDelete(id) {
  if (!confirm('Delete this record?')) return;
  await apiFetch(`/api/records/${id}`, 'DELETE');
  await refreshLocal();
  log('local', `Deleted ${id.slice(0, 8)}…`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Remote WebSocket connection
// ═══════════════════════════════════════════════════════════════════════════════
function toggleConnect() {
  if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
    remoteWs.close();
    return;
  }

  let url = document.getElementById('remoteUrl').value.trim();
  if (!url) { alert('Enter a WebSocket URL'); return; }

  // Auto-convert Ngrok HTTPS/HTTP URLs to wss/ws
  url = url.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
  if (!url.startsWith('ws')) url = 'ws://' + url;

  setStatus('connecting');
  log('ws', `Connecting to ${url}…`);

  remoteWs = new WebSocket(url);

  remoteWs.onopen = () => {
    setStatus('connected');
    log('ws', 'Connected to remote node');
    document.getElementById('connectBtn').textContent = 'Disconnect';
    document.getElementById('remoteWriteCard').style.opacity      = '1';
    document.getElementById('remoteWriteCard').style.pointerEvents = 'auto';
    document.getElementById('readBtn').disabled = false;
    remoteRead(); // auto-fetch on connect
  };

  remoteWs.onmessage = ({ data }) => {
    handleRemoteMessage(JSON.parse(data));
  };

  remoteWs.onclose = () => {
    setStatus('disconnected');
    remoteNodeId = '';
    document.getElementById('remoteNodeBadge').style.display = 'none';
    document.getElementById('connectBtn').textContent = 'Connect';
    document.getElementById('remoteWriteCard').style.opacity      = '0.4';
    document.getElementById('remoteWriteCard').style.pointerEvents = 'none';
    document.getElementById('readBtn').disabled = true;
    renderRemoteTable([]);
    log('ws', 'Remote WS disconnected');
  };

  remoteWs.onerror = () => {
    log('error', 'WS error — check the URL and that the remote node is running');
  };
}

function handleRemoteMessage(msg) {
  switch (msg.type) {
    case 'welcome': {
      remoteNodeId = msg.nodeId;
      const badge = document.getElementById('remoteNodeBadge');
      badge.textContent  = msg.nodeId;
      badge.style.display = '';
      log('ws', `Remote node identified: ${msg.nodeId}`);
      break;
    }
    case 'read_response':
      remoteRecords = msg.records;
      renderRemoteTable(msg.records);
      log('remote', `Read ${msg.records.length} record(s) from ${msg.nodeId}`);
      break;

    case 'write_response':
      if (msg.success) {
        remoteRecords.unshift(msg.record);
        renderRemoteTable(remoteRecords);
        log('remote', `Wrote "${msg.record.name}" → ${msg.nodeId}`);
      }
      break;

    case 'update_response':
      if (msg.success) {
        remoteRecords = remoteRecords.map(r => r.id === msg.record.id ? msg.record : r);
        renderRemoteTable(remoteRecords);
        log('remote', `Updated ${msg.record.id.slice(0, 8)}… on ${msg.nodeId}`);
      }
      break;

    case 'delete_response':
      if (msg.success) {
        remoteRecords = remoteRecords.filter(r => r.id !== msg.id);
        renderRemoteTable(remoteRecords);
        log('remote', `Deleted ${msg.id.slice(0, 8)}… from ${msg.nodeId}`);
      }
      break;

    case 'change':
      // Remote node is broadcasting a mutation (could be from another peer)
      if (msg.action === 'create') {
        remoteRecords.unshift(msg.record);
      } else if (msg.action === 'update') {
        remoteRecords = remoteRecords.map(r => r.id === msg.record.id ? msg.record : r);
      } else if (msg.action === 'delete') {
        remoteRecords = remoteRecords.filter(r => r.id !== msg.id);
      }
      renderRemoteTable(remoteRecords);
      log('ws', `Remote DB changed (${msg.action})`);
      break;

    case 'pong':
      log('ws', `Pong from ${msg.nodeId}`);
      break;

    case 'error':
      log('error', `Remote error: ${msg.message}`);
      break;
  }
}

function remoteRead() {
  if (!remoteWs || remoteWs.readyState !== WebSocket.OPEN) return;
  remoteWs.send(JSON.stringify({ type: 'read' }));
  log('remote', 'Sent READ to remote node');
}

function remoteWrite() {
  if (!remoteWs || remoteWs.readyState !== WebSocket.OPEN) return;
  const name  = document.getElementById('remoteName').value.trim();
  const value = document.getElementById('remoteValue').value.trim();
  if (!name) { alert('Name is required'); return; }

  remoteWs.send(JSON.stringify({ type: 'write', data: { name, value } }));
  document.getElementById('remoteName').value  = '';
  document.getElementById('remoteValue').value = '';
  log('remote', `Sent WRITE "${name}" to remote node`);
}

function openRemoteEditModal(id, name, value) {
  document.getElementById('remoteEditId').value    = id;
  document.getElementById('remoteEditName').value  = name;
  document.getElementById('remoteEditValue').value = value;
  document.getElementById('remoteEditModal').classList.add('open');
}

function closeRemoteEditModal() {
  document.getElementById('remoteEditModal').classList.remove('open');
}

function remoteUpdate() {
  if (!remoteWs || remoteWs.readyState !== WebSocket.OPEN) return;
  const id    = document.getElementById('remoteEditId').value;
  const name  = document.getElementById('remoteEditName').value.trim();
  const value = document.getElementById('remoteEditValue').value.trim();
  if (!name) { alert('Name is required'); return; }

  remoteWs.send(JSON.stringify({ type: 'update', id, data: { name, value } }));
  closeRemoteEditModal();
  log('remote', `Sent UPDATE ${id.slice(0, 8)}… to remote node`);
}

function remoteDelete(id) {
  if (!confirm('Delete this record on the remote node?')) return;
  if (!remoteWs || remoteWs.readyState !== WebSocket.OPEN) return;
  remoteWs.send(JSON.stringify({ type: 'delete', id }));
  log('remote', `Sent DELETE ${id.slice(0, 8)}… to remote node`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Remote table rendering
// ═══════════════════════════════════════════════════════════════════════════════
function renderRemoteTable(records) {
  const tbody  = document.getElementById('remoteTable');
  const isConn = remoteWs && remoteWs.readyState === WebSocket.OPEN;

  if (!records.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-msg">
      ${isConn ? 'Remote DB is empty' : 'Not connected'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(r => `
    <tr data-id="${r.id}">
      <td class="id-cell" title="${r.id}">${r.id.slice(0, 8)}…</td>
      <td>${esc(r.name)}</td>
      <td class="val-cell">${esc(r.value)}</td>
      <td style="color:var(--muted);font-size:11px">${fmtDate(r.updated_at)}</td>
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm"
                onclick="openRemoteEditModal('${r.id}','${esc(r.name)}','${esc(r.value)}')">Edit</button>
        <button class="btn btn-danger btn-sm"
                onclick="remoteDelete('${r.id}')">Del</button>
      </td>
    </tr>`).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Status badge
// ═══════════════════════════════════════════════════════════════════════════════
function setStatus(s) {
  const el = document.getElementById('statusBadge');
  el.className   = `status-badge ${s}`;
  el.textContent = s === 'connected'  ? '● Connected'
                 : s === 'connecting' ? '● Connecting…'
                 :                      '● Disconnected';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Activity log
// ═══════════════════════════════════════════════════════════════════════════════
function log(tag, msg) {
  const container = document.getElementById('log');
  const line      = document.createElement('div');
  line.className  = 'log-line';
  const now = new Date().toLocaleTimeString('en-GB', { hour12: false });
  line.innerHTML = `
    <span class="log-time">${now}</span>
    <span class="log-tag ${tag}">${tag.toUpperCase()}</span>
    <span class="log-msg">${esc(msg)}</span>`;
  container.prepend(line);
  while (container.children.length > 200) container.removeChild(container.lastChild);
}

function clearLog() {
  document.getElementById('log').innerHTML = '';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════════════════════════════════
async function apiFetch(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleString('en-GB', {
      month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return str; }
}

// Close modals when clicking the backdrop
document.getElementById('editModal').addEventListener('click', function (e) {
  if (e.target === this) closeEditModal();
});
document.getElementById('remoteEditModal').addEventListener('click', function (e) {
  if (e.target === this) closeRemoteEditModal();
});
