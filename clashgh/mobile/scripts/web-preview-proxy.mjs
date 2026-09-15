/**
 * Dev-only single-origin proxy for the Expo WEB preview.
 *
 * A browser on a sandbox/tunnel preview cannot call a second origin: the
 * gateway rejects requests without its access token, and some tunnels
 * strip Authorization. So serve the Metro web bundle AND the API from ONE
 * port (exactly what the admin panel gets from Vite's proxy):
 *   /api/*, /uploads-dev/*  → API   (API_TARGET,   default http://localhost:3000)
 *   everything else         → Metro (METRO_TARGET, default http://localhost:8081)
 * Run Expo with EXPO_PUBLIC_API_URL=/api and open THIS port.
 * Zero dependencies. Native Android/iOS builds never use this.
 */
import http from 'node:http';
import net from 'node:net';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8082);
const API = new URL(process.env.API_TARGET || 'http://localhost:3000');
const METRO = new URL(process.env.METRO_TARGET || 'http://localhost:8081');
const isApi = (p) => p === '/api' || p.startsWith('/api/') || p.startsWith('/uploads-dev/');

const server = http.createServer((req, res) => {
  const target = isApi(req.url) ? API : METRO;
  const headers = { ...req.headers, host: target.host };
  const up = http.request(
    { hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  up.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, data: null, message: `upstream ${target.host} unreachable: ${e.message}` }));
  });
  req.pipe(up);
});

// Metro HMR / dev-client websockets.
server.on('upgrade', (req, socket, head) => {
  const target = isApi(req.url) ? API : METRO;
  const up = net.connect(Number(target.port), target.hostname, () => {
    const hdrs = Object.entries({ ...req.headers, host: target.host })
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${hdrs}\r\n\r\n`);
    if (head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, '0.0.0.0', () =>
  console.log(`web preview proxy on 0.0.0.0:${PORT} → api ${API.host}, metro ${METRO.host}`),
);
