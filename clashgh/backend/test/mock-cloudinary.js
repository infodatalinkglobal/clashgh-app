/**
 * Local Cloudinary mock (Module 3D) — lets the LIVE cloudinary code path
 * run with zero real credentials, exactly like test/mock-paystack.js.
 *
 *   CLOUDINARY_API_URL=http://127.0.0.1:4011 SCREENSHOT_STORAGE=cloudinary \
 *   CLOUDINARY_CLOUD_NAME=demo CLOUDINARY_API_KEY=key CLOUDINARY_API_SECRET=secret npm run dev
 *
 * It VERIFIES the upload signature the same way Cloudinary does (sha1 of
 * sorted "k=v&…" + api_secret), so a signing bug fails here, not in prod.
 * Uploaded bytes are kept in memory and served at /img/<public_id>.jpg.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 4011);
const SECRET = process.env.CLOUDINARY_API_SECRET || 'secret';
const store = new Map();

function parseMultipart(buf, boundary) {
  const parts = {};
  const sep = Buffer.from(`--${boundary}`);
  let i = buf.indexOf(sep) + sep.length + 2;
  while (i < buf.length) {
    const end = buf.indexOf(sep, i);
    if (end < 0) break;
    const part = buf.subarray(i, end - 2);
    const hdrEnd = part.indexOf('\r\n\r\n');
    const hdr = part.subarray(0, hdrEnd).toString();
    const name = /name="([^"]+)"/.exec(hdr)?.[1];
    const body = part.subarray(hdrEnd + 4);
    parts[name] = /filename=/.test(hdr) ? body : body.toString();
    i = end + sep.length + 2;
  }
  return parts;
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (req.method === 'POST' && /\/image\/upload$/.test(req.url)) {
      const boundary = /boundary=(.+)$/.exec(req.headers['content-type'] || '')?.[1];
      const p = parseMultipart(buf, boundary);
      const { file, api_key, signature, ...params } = p;
      const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
      const expected = crypto.createHash('sha1').update(toSign + SECRET).digest('hex');
      if (signature !== expected) return json(401, { error: { message: `Invalid Signature ${signature}. String to sign - '${toSign}'.` } });
      if (Math.abs(Date.now() / 1000 - Number(params.timestamp)) > 3600) return json(400, { error: { message: 'Stale request - timestamp too old' } });
      if (!Buffer.isBuffer(file) || file.length < 3 || file[0] !== 0xff) return json(400, { error: { message: 'Invalid image file' } });
      const public_id = `${params.folder}/${params.public_id}`;
      if (params.overwrite === 'false' && store.has(public_id)) return json(400, { error: { message: 'public_id already exists (overwrite=false)' } });
      store.set(public_id, { file, created_at: new Date().toISOString(), tags: (params.tags || '').split(',') });
      console.log(`[mock-cloudinary] upload ok ${public_id} ${file.length}B tags=${params.tags} transformation=${params.transformation}`);
      return json(200, { public_id, secure_url: `http://127.0.0.1:${PORT}/img/${public_id}.jpg`, bytes: file.length, format: 'jpg' });
    }
    if (req.method === 'GET' && /\/ping$/.test(req.url)) {
      const ok = (req.headers.authorization || '').endsWith(Buffer.from(`key:${SECRET}`).toString('base64'));
      return json(ok ? 200 : 401, ok ? { status: 'ok' } : { error: { message: 'Invalid credentials' } });
    }
    if (req.method === 'GET' && req.url.includes('/resources/image/tags/')) {
      const tag = decodeURIComponent(req.url.split('/tags/')[1].split('?')[0]);
      const resources = [...store.entries()].filter(([, v]) => v.tags.includes(tag)).map(([public_id, v]) => ({ public_id, created_at: v.created_at }));
      return json(200, { resources });
    }
    if (req.method === 'DELETE' && /\/resources\/image\/upload$/.test(req.url)) {
      const ids = new URLSearchParams(buf.toString()).getAll('public_ids[]');
      const deleted = {};
      for (const id of ids) { deleted[id] = store.delete(id) ? 'deleted' : 'not_found'; }
      console.log(`[mock-cloudinary] deleted ${ids.length}`);
      return json(200, { deleted });
    }
    if (req.method === 'GET' && req.url.startsWith('/img/')) {
      const id = decodeURIComponent(req.url.slice(5).replace(/\.jpg$/, ''));
      const r = store.get(id);
      if (!r) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(r.file);
    }
    // test hook: backdate everything so the purge has something to delete
    if (req.method === 'POST' && req.url === '/__age') {
      for (const v of store.values()) v.created_at = new Date(Date.now() - 200 * 86_400_000).toISOString();
      return json(200, { aged: store.size });
    }
    json(404, { error: { message: 'not found' } });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`[mock-cloudinary] listening on 127.0.0.1:${PORT}`));
