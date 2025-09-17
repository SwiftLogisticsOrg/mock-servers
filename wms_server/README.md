# WMS Mock — README

A lightweight **WMS (Warehouse Management System) mock** that simulates a proprietary TCP messaging WMS (JSON-lines) and provides a small HTTP admin API for inspection and manual control.
It is designed to be used in your logistics demo so your **WMS Adapter** and other services can integrate and show the full order lifecycle (receive → ready → scanned → loaded).

This README explains what the mock exposes, how it behaves, how to run and test it, message formats, example flows, and troubleshooting tips — written for someone new to the mock server.

---

## Table of contents

- What this mock is for
- What it exposes

  - TCP protocol (primary)
  - HTTP admin API

- Ports & environment variables
- Message formats (JSON-lines over TCP)

  - Incoming commands (adapter → WMS)
  - Outgoing events (WMS → adapter)

- Behavior & timing (default)
- In-memory data model
- Example end-to-end sequence
- Quick start (install & run)
- Manual testing (netcat / curl examples)
- Docker / docker-compose
- Troubleshooting
- Next steps / integration notes

---

## What this mock is for

The WMS mock simulates warehouse behaviour so you can:

- Send `receive_package` commands (from your WMS Adapter) and receive realistic lifecycle events (`ack`, `package_ready`, `package_loaded`, etc.).
- Let your adapter publish `wms.package.*` events to RabbitMQ when WMS events arrive.
- Inspect and manually advance package state via a simple HTTP admin API during development and demos.

It intentionally uses a line-delimited JSON TCP protocol (one JSON object per line, terminated by `\n`) to mimic many proprietary streaming protocols while keeping implementation simple.

---

## What it exposes

### 1) TCP server (primary interaction)

- **Protocol**: **JSON-lines** (each message is a single JSON object followed by `\n`) over plain TCP.
- **Default port**: `5001` (configurable).
- **Purpose**: adapters connect here and exchange messages:

  - Adapter sends commands (`register_adapter`, `receive_package`, `scan_package`, `load_package`, `simulate_error`).
  - WMS mock responds/initiates events (`register_ack`, `ack`, `package_received`, `package_ready`, `package_scanned`, `package_loaded`, `error`).

### 2) HTTP admin API (debug & inspection)

- **Base URL**: `http://<host>:3001/api` (default port `3001`, configurable).
- **Endpoints**:

  - `GET /api/packages` — list all packages stored in memory.
  - `GET /api/packages/:id` — get package by `packageId` or `orderId`/`clientOrderRef`.
  - `POST /api/simulate/:packageId/advance` — advance package manually (body `{ "to":"loaded" }`).
  - `POST /api/simulate/fail` — toggle failure simulation; body `{ "fail": true | false }`.
  - `GET /api/status` — server & adapter connection stats.
  - `GET /api/health` — health check.

---

## Ports & environment variables

Defaults (can be overridden via env):

- `WMS_TCP_PORT` — default `5001` (TCP JSON-lines)
- `WMS_HTTP_PORT` — default `3001` (HTTP admin)
- `WMS_DEFAULT_DELAY_MS` — default `3000` (delay before `package_received` is emitted)
- `WMS_READY_EXTRA_MS` — default `1000` (extra delay before `package_ready`)
- `WMS_LOAD_DELAY_MS` — default `2000` (delay for `package_loaded`)
- `WMS_ERROR_RATE` — default `0.0` (random failure rate; 0.0 disables random failures)

Example (bash):

```bash
export WMS_TCP_PORT=5001
export WMS_HTTP_PORT=3001
export WMS_DEFAULT_DELAY_MS=3000
```

---

## Message formats (JSON-lines)

All TCP messages are single-line JSON objects followed by `\n`.

### A) Incoming commands (adapter → WMS)

1. **register_adapter**

```json
{
  "type": "register_adapter",
  "adapterId": "adp-1",
  "capabilities": ["receive", "scan", "load"]
}
```

2. **receive_package**

```json
{
  "type": "receive_package",
  "orderId": "o123",
  "clientOrderRef": "frontend-001",
  "items": [{ "name": "Phone", "qty": 1 }],
  "pickup": "Warehouse A",
  "delivery": "456 B Ave",
  "contact": "0770000000",
  "callbackMeta": { "correlationId": "..." } // optional
}
```

3. **scan_package**

```json
{ "type": "scan_package", "packageId": "pkg-1001", "scanPoint": "inbound-dock" }
```

4. **load_package**

```json
{ "type": "load_package", "packageId": "pkg-1001", "vehicleId": "v1" }
```

5. **simulate_error** (dev)

```json
{
  "type": "simulate_error",
  "packageId": "pkg-1001",
  "error": "barcode_invalid"
}
```

---

### B) Outgoing events (WMS → adapter)

1. **register_ack**

```json
{
  "type": "register_ack",
  "adapterId": "adp-1",
  "status": "ok",
  "timestamp": "2025-09-17T12:00:00Z"
}
```

2. **ack** (for receive_package)

```json
{
  "type": "ack",
  "messageId": "m-001",
  "status": "received",
  "packageId": "pkg-1001",
  "orderId": "o123"
}
```

3. **package_received**

```json
{
  "type": "package_received",
  "packageId": "pkg-1001",
  "orderId": "o123",
  "status": "received",
  "timestamp": "2025-09-17T12:03:00Z"
}
```

4. **package_ready**

```json
{
  "type": "package_ready",
  "packageId": "pkg-1001",
  "orderId": "o123",
  "status": "ready_for_loading",
  "timestamp": "..."
}
```

5. **package_scanned**

```json
{
  "type": "package_scanned",
  "packageId": "pkg-1001",
  "orderId": "o123",
  "scanPoint": "inbound-dock",
  "timestamp": "..."
}
```

6. **package_loaded**

```json
{
  "type": "package_loaded",
  "packageId": "pkg-1001",
  "orderId": "o123",
  "vehicleId": "v1",
  "status": "loaded",
  "timestamp": "..."
}
```

7. **error**

```json
{ "type": "error", "message": "invalid_payload", "details": "..." }
```

---

## Behavior & timing (default)

When the server receives `receive_package`:

1. Immediately generates a `packageId` (e.g., `pkg-AB12CD`) and replies with an `ack` object containing `packageId` and `orderId`.
2. After `WMS_DEFAULT_DELAY_MS` (default 3000 ms) emits `package_received`.
3. After an extra `WMS_READY_EXTRA_MS` (default 1000 ms) emits `package_ready`.
4. When `load_package` is received, after `WMS_LOAD_DELAY_MS` emits `package_loaded`.
5. `scan_package` triggers `package_scanned` immediately.
6. If `errorMode` is on or `WMS_ERROR_RATE` triggers, the server issues `error` events at configured times (useful for fault-handling demos).

These delays intentionally make transitions visible in a demo or screencast.

---

## In-memory data model

The server keeps simple in-memory maps:

- `packages`: Map keyed by `packageId`, each entry:

```js
{
  packageId: 'pkg-xxxx',
  orderId: 'o123',
  clientOrderRef: 'frontend-001',
  items: [...],
  status: 'received' | 'ready_for_loading' | 'scanned' | 'loaded' | 'error',
  timestamps: { received: '...', ready: '...', scanned: '...', loaded: '...' },
  assignedVehicle: null,
  meta: {}
}
```

- `adapters`: Map keyed by `adapterId` storing the socket and capabilities.

> Note: data is **in-memory only** (not persisted). For longer demos you can extend to persist to disk.

---

## Example end-to-end sequence

1. **Adapter connects** and sends `register_adapter`. WMS replies `register_ack`.
2. Adapter sends `receive_package` for order `o123`.
3. WMS replies immediately with `ack` including `packageId`.
4. After 3s WMS emits `package_received`, then `package_ready`.
5. Adapter publishes `wms.package.ready` to RabbitMQ, order-service updates order to `ready_for_loading`.
6. Adapter or operator sends `load_package`, WMS emits `package_loaded`.
7. Adapter publishes `wms.package.loaded`, order-service marks `in_transit`.

---

## Quick start (install & run)

1. Create folder and files (or clone the provided code).
2. Install:

```bash
npm install
```

3. Run:

```bash
# defaults: TCP 3008, HTTP 3001
node index.js
```

4. Check HTTP admin:

- `GET http://localhost:3001/api/health`
- `GET http://localhost:3001/api/status`

---

## Manual testing (netcat / curl examples)

### Test TCP with `nc` (netcat)

This netcat scene ek not worked for me. so i create a custom node client.js and connect for manual testing

Open TCP connection:

```bash
nc localhost 3008
```

Send registration line (paste and press Enter):

```json
{
  "type": "register_adapter",
  "adapterId": "test-adp",
  "capabilities": ["receive", "scan", "load"]
}
```

Send receive_package:

```json
{
  "type": "receive_package",
  "orderId": "o123",
  "clientOrderRef": "frontend-001",
  "items": [{ "name": "Phone", "qty": 1 }],
  "pickup": "WH-A",
  "delivery": "456 B Ave",
  "contact": "0770000000"
}
```

You should see:

- immediate `ack` line
- after \~3s `package_received`
- after \~1s `package_ready`

### Query packages via HTTP (admin API)

Right now i've commented out this admin API since we will not be working with it.

```bash
curl http://localhost:3001/api/packages
curl http://localhost:3001/api/packages/o123
```

### Manually advance a package to `loaded`

```bash
curl -X POST -H "Content-Type: application/json" -d '{"to":"loaded"}' http://localhost:3001/api/simulate/pkg-<id>/advance
```

Toggle failure mode:

```bash
curl -X POST -H "Content-Type: application/json" -d '{"fail":true}' http://localhost:3001/api/simulate/fail
```

---

## Docker / docker-compose

To containerize the mock. Example `Dockerfile` (simple):

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5001 3001
CMD ["node", "index.js"]
```

Add a service to your `docker-compose.yml` and make sure adapters use the service name (e.g., `wms-mock`) as host.

Example snippet:

```yaml
services:
  wms-mock:
    build: ./wms-mock
    ports:
      - "5001:5001"
      - "3001:3001"
```

---

## Troubleshooting

**I get no response in `nc` after sending a command**

- Ensure the mock is running and listening on `5001` (`ss -lnt` or `netstat`).
- If running in Docker, use the container’s service name (not `localhost`) from other containers.

**Ack arrives but no later events**

- Check server logs. Delays are configurable; default is 3s then 1s.
- Ensure `WMS_READY_EXTRA_MS` and `WMS_DEFAULT_DELAY_MS` env vars are not set too high.

**Adapter doesn’t receive events**

- Adapter may not be connected: ensure adapter socket is open to the same host/port.
- Check the adapter registration log: adapter should send `register_adapter` and receive `register_ack`.

**Random errors occur**

- Check `WMS_ERROR_RATE` and `errorMode` (toggled via admin API). Turn them off for deterministic behavior.

---

## Next steps / integration notes

- Our WMS Adapter should:

  - Open a TCP connection to this mock server and `register_adapter`.
  - Send `receive_package` commands for `order.created` events from RabbitMQ.
  - Listen on the socket for WMS events and publish corresponding `wms.package.*` events to the message bus.

- Frontend should not connect directly to the TCP server. Use order-service / read-model or the admin HTTP API to show package status to the client UI. (right now i've commented out this)
- Consider persisting packages in a real DB for longer demos or adding an option to replay events for recorded demos.

---
