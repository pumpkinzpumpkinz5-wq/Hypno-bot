// Serves the app and relays live sessions. No dependencies: `node server.js`
// PORT (default 8080) and HOST (default 127.0.0.1; use 0.0.0.0 to let other devices join).
// Rooms live in memory: the host posts its state and files, viewers get the state over
// Server-Sent Events. Everything is gone when the server stops.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const MAX_ROOM_BYTES = 1024 ** 3; // uploaded files per room
const MAX_STATE_BYTES = 1024 ** 2;
const ROOM_TTL = 2 * 60 * 60 * 1000; // dropped after 2h without word from the host
const ROOM_NAME = /^[a-z0-9][a-z0-9-]{1,31}$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

// id -> { key, state, stateAt, clients: Set<res>, files: Map<id, { type, buf }>, bytes, touched }
const rooms = new Map();
const newId = bytes => crypto.randomBytes(bytes).toString('hex');

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
const json = (res, obj) => send(res, 200, JSON.stringify(obj), 'application/json');

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Too big'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const event = room => `data: {"age":${Date.now() - room.stateAt},"state":${room.state}}\n\n`;

function closeRoom(id) {
  const room = rooms.get(id);
  if (!room) return;
  for (const res of room.clients) res.end('event: end\ndata: {}\n\n');
  rooms.delete(id);
}

setInterval(() => {
  for (const [id, room] of rooms) if (Date.now() - room.touched > ROOM_TTL) closeRoom(id);
}, 10 * 60 * 1000).unref();

async function handleLive(req, res, parts) {
  const [id, action, fileId] = parts;
  if (id === 'ping' && !action) return send(res, 200, 'ok');
  if (!id && req.method === 'POST') {
    // Optional { name, key }: a named room can be taken back with the key it was given
    const body = String(await readBody(req, 1024));
    const { name, key } = body ? JSON.parse(body) : {};
    let roomId = newId(5);
    if (name) {
      if (!ROOM_NAME.test(name) || name === 'live') return send(res, 400, 'Room names are 2-32 lowercase letters, numbers or dashes.');
      const existing = rooms.get(name);
      if (existing) {
        if (existing.key !== key) return send(res, 409, 'That room name is taken.');
        existing.touched = Date.now();
        return json(res, { id: name, key });
      }
      roomId = name;
    }
    const room = { key: newId(16), state: null, stateAt: 0, clients: new Set(), files: new Map(), bytes: 0, touched: Date.now() };
    rooms.set(roomId, room);
    return json(res, { id: roomId, key: room.key });
  }
  const room = rooms.get(id);
  if (!room) return send(res, 404, 'No such live session');
  const isHost = req.headers['x-key'] === room.key;

  if (action === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    if (room.state) res.write(event(room));
    room.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); room.clients.delete(res); });
    return;
  }
  if (action === 'file' && fileId && req.method === 'GET') {
    const file = room.files.get(fileId);
    if (!file) return send(res, 404, 'No such file');
    res.writeHead(200, { 'content-type': file.type, 'content-length': file.buf.length, 'cache-control': 'private, max-age=86400' });
    return res.end(file.buf);
  }

  if (!isHost) return send(res, 403, 'Only the host can do that');
  room.touched = Date.now();
  if (!action && req.method === 'DELETE') {
    closeRoom(id);
    return json(res, {});
  }
  if (action === 'state' && req.method === 'POST') {
    // Re-serialized so it's a single line, which SSE needs
    room.state = JSON.stringify(JSON.parse(await readBody(req, MAX_STATE_BYTES)));
    room.stateAt = Date.now();
    const msg = event(room);
    for (const c of room.clients) c.write(msg);
    return json(res, { viewers: room.clients.size });
  }
  if (action === 'file' && !fileId && req.method === 'POST') {
    const buf = await readBody(req, MAX_ROOM_BYTES - room.bytes);
    const fid = newId(8);
    room.files.set(fid, { type: req.headers['content-type'] || 'application/octet-stream', buf });
    room.bytes += buf.length;
    return json(res, { url: `live/${id}/file/${fid}` });
  }
  send(res, 404, 'Not found');
}

function serveStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  // "/" and room links like "/my-room" (one segment, no dot) get the app
  const rel = /^\/[^/.]*$/.test(urlPath) ? '/index.html' : decodeURIComponent(urlPath);
  const file = path.join(ROOT, rel);
  // Stay inside the app folder and skip dot files (.git etc.)
  if (!file.startsWith(ROOT + path.sep) || rel.split('/').some(p => p.startsWith('.'))) return send(res, 404, 'Not found');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'live') await handleLive(req, res, parts.slice(1));
    else serveStatic(req, res, pathname);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 400, e.status ? e.message : 'Bad request');
  }
}).listen(PORT, HOST, () => console.log(`Hypp running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
