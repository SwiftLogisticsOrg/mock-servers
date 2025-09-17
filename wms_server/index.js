// index.js
// WMS Mock Server (TCP JSON-lines + Express admin API)
// Run: node index.js
import net from 'net';
import express from 'express';
import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';

// --------- Configuration (env or defaults) ----------
const WMS_TCP_PORT = parseInt(process.env.WMS_TCP_PORT || '3008', 10);
const WMS_HTTP_PORT = parseInt(process.env.WMS_HTTP_PORT || '3009', 10);
const DEFAULT_DELAY_MS = parseInt(process.env.WMS_DEFAULT_DELAY_MS || '3000', 10); // base processing delay
const PACKAGE_READY_EXTRA_MS = parseInt(process.env.WMS_READY_EXTRA_MS || '1000', 10); // extra after received
const DEFAULT_LOAD_DELAY_MS = parseInt(process.env.WMS_LOAD_DELAY_MS || '2000', 10);
const ERROR_RATE = parseFloat(process.env.WMS_ERROR_RATE || '0.0'); // 0.0 = no random errors

// ---------- In-memory stores ----------
const adapters = new Map(); // adapterId -> { socket, capabilities, lastSeen, buffer }
const packages = new Map(); // packageId -> packageObj
let errorMode = false; // when true, simulate failure responses for demo

// ---------- Helpers ----------
function shortId() {
  return uuidv4().split('-')[0].toUpperCase();
}
function makePackageId() {
  return 'pkg-' + shortId();
}
function nowISO() {
  return new Date().toISOString();
}
function sendLine(socket, obj) {
  if (!socket || socket.destroyed) return;
  try {
    socket.write(JSON.stringify(obj) + '\n');
  } catch (e) {
    console.error('Failed to write to socket:', e.message);
  }
}
function broadcastToAdapters(obj) {
  for (const [, info] of adapters) {
    sendLine(info.socket, obj);
  }
}
function sendToAdapterById(adapterId, obj) {
  const info = adapters.get(adapterId);
  if (info) sendLine(info.socket, obj);
}

// safe parse per-line
function tryParseJson(line) {
  try {
    return JSON.parse(line);
  } catch (e) {
    return null;
  }
}

// ---------- TCP server logic ----------
const tcpServer = net.createServer((socket) => {
  socket.setEncoding('utf8');
  let buffer = '';
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[TCP] New connection from ${remote}`);

  // no adapterId until register very likely
  let adapterId = null;

  socket.on('data', (chunk) => {
    buffer += chunk;
    // split by newline
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const msg = tryParseJson(line);
      if (!msg) {
        console.warn('[TCP] Received non-json line:', line);
        sendLine(socket, { type: 'error', message: 'invalid_json' });
        continue;
      }
      handleTcpMessage(socket, msg);
    }
  });

  socket.on('close', () => {
    console.log(`[TCP] Connection closed: ${remote} (adapter ${adapterId || 'unknown'})`);
    if (adapterId && adapters.has(adapterId)) {
      adapters.delete(adapterId);
    }
  });

  socket.on('error', (err) => {
    console.warn(`[TCP] Socket error from ${remote}:`, err.message);
  });

  // handle messages
  function handleTcpMessage(sock, msg) {
    const t = msg.type;
    if (!t) {
      sendLine(sock, { type: 'error', message: 'missing_type' });
      return;
    }

    if (t === 'register_adapter') {
      adapterId = msg.adapterId || 'adapter-' + shortId();
      adapters.set(adapterId, {
        socket: sock,
        capabilities: msg.capabilities || [],
        lastSeen: Date.now()
      });
      console.log(`[TCP] Adapter registered: ${adapterId} capabilities=${JSON.stringify(msg.capabilities||[])}`);
      sendLine(sock, { type: 'register_ack', adapterId, status: 'ok', timestamp: nowISO() });
      return;
    }

    // If not registered but other messages come, still process but warn
    if (!adapterId) {
      console.warn('[TCP] Message from unregistered socket, processing anyway:', msg);
    }

    switch (t) {
      case 'receive_package':
        handleReceivePackage(sock, msg, adapterId);
        break;
      case 'scan_package':
        handleScanPackage(sock, msg, adapterId);
        break;
      case 'load_package':
        handleLoadPackage(sock, msg, adapterId);
        break;
      case 'simulate_error':
        // direct simulate error for a package
        if (msg.packageId && packages.has(msg.packageId)) {
          const p = packages.get(msg.packageId);
          p.status = 'error';
          p.timestamps.error = nowISO();
          sendLine(sock, { type: 'error', packageId: msg.packageId, message: msg.error || 'simulated_error' });
          // also broadcast to all adapters for visibility
          broadcastToAdapters({ type: 'error', packageId: msg.packageId, message: msg.error || 'simulated_error' });
        } else {
          sendLine(sock, { type: 'error', message: 'package_not_found' });
        }
        break;
      default:
        console.warn('[TCP] Unknown message type:', t);
        sendLine(sock, { type: 'error', message: 'unknown_type', received: t });
    }
  }
});

// ---------- Handlers ----------
function handleReceivePackage(sock, msg, adapterId) {
  // Validate minimal fields
  if (!msg.orderId) {
    return sendLine(sock, { type: 'error', message: 'missing_orderId' });
  }

  // random failure simulation
  if (errorMode || Math.random() < ERROR_RATE) {
    console.log('[WMS] Simulating failure on receive_package for', msg.orderId);
    return sendLine(sock, { type: 'error', message: 'simulated_receive_failure', orderId: msg.orderId });
  }

  const packageId = makePackageId();
  const pkg = {
    packageId,
    orderId: msg.orderId,
    clientOrderRef: msg.clientOrderRef || null,
    items: msg.items || [],
    pickup: msg.pickup || null,
    delivery: msg.delivery || null,
    contact: msg.contact || null,
    status: 'received',
    assignedVehicle: null,
    timestamps: {
      received: nowISO()
    },
    meta: msg.callbackMeta || {}
  };
  packages.set(packageId, pkg);

  // send immediate ack
  sendLine(sock, { type: 'ack', messageId: 'm-' + shortId(), status: 'received', packageId, orderId: msg.orderId });

  // schedule package_received (slight delay) then package_ready
  setTimeout(() => {
    pkg.status = 'received';
    pkg.timestamps.received = nowISO();
    const ev = { type: 'package_received', packageId, orderId: pkg.orderId, status: 'received', timestamp: pkg.timestamps.received };
    sendLine(sock, ev);
    // optionally broadcast
    // broadcastToAdapters(ev);

    // after extra time, ready
    setTimeout(() => {
      if (errorMode || Math.random() < ERROR_RATE) {
        pkg.status = 'error';
        pkg.timestamps.error = nowISO();
        const errEv = { type: 'error', packageId, orderId: pkg.orderId, message: 'simulated_processing_error' };
        sendLine(sock, errEv);
        return;
      }
      pkg.status = 'ready_for_loading';
      pkg.timestamps.ready = nowISO();
      const readyEv = { type: 'package_ready', packageId, orderId: pkg.orderId, status: 'ready_for_loading', timestamp: pkg.timestamps.ready };
      sendLine(sock, readyEv);
    }, PACKAGE_READY_EXTRA_MS);
  }, DEFAULT_DELAY_MS);
}

function handleScanPackage(sock, msg, adapterId) {
  if (!msg.packageId) return sendLine(sock, { type: 'error', message: 'missing_packageId' });
  const pkg = packages.get(msg.packageId);
  if (!pkg) return sendLine(sock, { type: 'error', message: 'package_not_found' });

  pkg.status = 'scanned';
  pkg.timestamps.scanned = nowISO();
  const ev = { type: 'package_scanned', packageId: pkg.packageId, orderId: pkg.orderId, scanPoint: msg.scanPoint || 'unknown', timestamp: pkg.timestamps.scanned };
  sendLine(sock, ev);
}

function handleLoadPackage(sock, msg, adapterId) {
  if (!msg.packageId) return sendLine(sock, { type: 'error', message: 'missing_packageId' });
  const pkg = packages.get(msg.packageId);
  if (!pkg) return sendLine(sock, { type: 'error', message: 'package_not_found' });
  const vehicleId = msg.vehicleId || ('v-' + shortId());

  // simulate load delay
  setTimeout(() => {
    if (errorMode || Math.random() < ERROR_RATE) {
      pkg.status = 'error';
      pkg.timestamps.error = nowISO();
      const errEv = { type: 'error', packageId: pkg.packageId, orderId: pkg.orderId, message: 'simulated_load_error' };
      sendLine(sock, errEv);
      return;
    }
    pkg.status = 'loaded';
    pkg.assignedVehicle = vehicleId;
    pkg.timestamps.loaded = nowISO();
    const ev = { type: 'package_loaded', packageId: pkg.packageId, orderId: pkg.orderId, vehicleId, status: 'loaded', timestamp: pkg.timestamps.loaded };
    sendLine(sock, ev);
  }, DEFAULT_LOAD_DELAY_MS);
}

// ---------- Start TCP server ----------
// tcpServer.on('error', (err) => {
//   console.error('[TCP] Server error:', err);
// });
tcpServer.on('connection', (socket) => {
  console.log('[TCP] connection callback — remote:', socket.remoteAddress, socket.remotePort);
});
tcpServer.on('listening', () => {
  const addr = tcpServer.address();
  console.log(`[WMS MOCK] TCP server listening on ${addr.address}:${addr.port} (family=${addr.family})`);
});
tcpServer.on('error', (err) => {
  console.error('[TCP] Server error event:', err && err.message);
});
tcpServer.listen(WMS_TCP_PORT, '127.0.0.1', () => {
  console.log(`[WMS MOCK] TCP server listening on port ${WMS_TCP_PORT} (JSON-lines).`);
});

// ---------- Express admin API ----------
// const app = express();
// app.use(morgan('dev'));
// app.use(express.json());

// // GET all packages
// app.get('/api/packages', (req, res) => {
//   res.json(Array.from(packages.values()));
// });

// // GET package by orderId or packageId
// app.get('/api/packages/:id', (req, res) => {
//   const id = req.params.id;
//   // try packageId
//   if (packages.has(id)) return res.json(packages.get(id));
//   // try find by orderId
//   const found = Array.from(packages.values()).find((p) => p.orderId === id || p.clientOrderRef === id);
//   if (found) return res.json(found);
//   return res.status(404).json({ error: 'not_found' });
// });

// // advance package status manually: { "to": "loaded" }
// app.post('/api/simulate/:packageId/advance', (req, res) => {
//   const pid = req.params.packageId;
//   if (!packages.has(pid)) return res.status(404).json({ error: 'package_not_found' });
//   const to = req.body?.to;
//   const p = packages.get(pid);
//   if (!to) return res.status(400).json({ error: 'missing_to' });

//   const allowed = ['received', 'ready_for_loading', 'scanned', 'loaded', 'error'];
//   if (!allowed.includes(to)) return res.status(400).json({ error: 'invalid_target_status', allowed });

//   p.status = to;
//   p.timestamps[to === 'loaded' ? 'loaded' : to] = nowISO();
//   // notify all adapters about the manual change for visibility
//   const ev = { type: `package_${to === 'ready_for_loading' ? 'ready' : to}`, packageId: p.packageId, orderId: p.orderId, status: p.status, timestamp: nowISO() };
//   broadcastToAdapters(ev);

//   return res.json({ ok: true, package: p });
// });

// // toggle failure mode: {"fail":true}
// app.post('/api/simulate/fail', (req, res) => {
//   const fail = req.body?.fail;
//   if (typeof fail !== 'boolean') return res.status(400).json({ error: 'missing_boolean_fail_field' });
//   errorMode = fail;
//   return res.json({ ok: true, errorMode });
// });

// // status endpoint
// app.get('/api/status', (req, res) => {
//   return res.json({
//     tcpPort: WMS_TCP_PORT,
//     httpPort: WMS_HTTP_PORT,
//     adapters: Array.from(adapters.keys()),
//     packageCount: packages.size,
//     errorMode,
//     defaultDelayMs: DEFAULT_DELAY_MS
//   });
// });

// // health
// app.get('/api/health', (req, res) => res.json({ status: 'ok', time: nowISO() }));

// app.listen(WMS_HTTP_PORT, () => {
//   console.log(`[WMS MOCK] HTTP admin API listening on http://localhost:${WMS_HTTP_PORT}/api`);
// });

// ---------- Graceful shutdown ----------
function shutdown() {
  console.log('[WMS MOCK] Shutting down...');
  tcpServer.close();
  //app.close?.();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
