#!/usr/bin/env node
/** Precompress web-dist JS/JSON/HTML with gzip + brotli so the server can ship
 * small bytes without a runtime compression dependency. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const root = path.resolve(process.argv[2] || 'web-dist');
let n = 0, before = 0, after = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (!/\.(js|json|html|svg|txt|css)$/.test(e.name)) return;
  const buf = fs.readFileSync(p);
  fs.writeFileSync(p + '.gz', zlib.gzipSync(buf, { level: 9 }));
  fs.writeFileSync(p + '.br', zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
  n += 1; before += buf.length; after += fs.statSync(p + '.br').size;
});
walk(root);
console.log(`precompressed ${n} files: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB brotli`);
