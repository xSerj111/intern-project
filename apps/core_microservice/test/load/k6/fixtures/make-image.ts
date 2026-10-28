// Generates fixtures/perf-image.png, the upload used by key-endpoints.js
// (contracts/perf-tooling.md: 512 KB-1 MB PNG). Output is byte-for-byte
// reproducible: a valid RGB PNG whose pixels are LCG noise stored in
// uncompressed deflate blocks, so size is exact and no zlib version matters.
//
// Usage: cd apps/core_microservice && npx ts-node test/load/k6/fixtures/make-image.ts [outPath]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZE_PX = 450;
const SEED = 20261020;
const BLOCK_MAX = 65535;

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) {
    c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

export function buildPng(): Uint8Array {
  const w = SIZE_PX;
  const h = SIZE_PX;
  const stride = 1 + w * 3;
  const raw = new Uint8Array(h * stride);
  let seed = SEED;
  for (let i = 0; i < raw.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; // LCG
    raw[i] = seed >>> 24;
  }
  for (let y = 0; y < h; y++) raw[y * stride] = 0; // filter type: none

  const blocks = Math.ceil(raw.length / BLOCK_MAX);
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78;
  z[1] = 0x01;
  let pos = 2;
  for (let off = 0; off < raw.length; off += BLOCK_MAX) {
    const len = Math.min(BLOCK_MAX, raw.length - off);
    z[pos++] = off + len >= raw.length ? 1 : 0;
    z[pos++] = len & 0xff;
    z[pos++] = len >>> 8;
    z[pos++] = ~len & 0xff;
    z[pos++] = (~len >>> 8) & 0xff;
    z.set(raw.subarray(off, off + len), pos);
    pos += len;
  }
  new DataView(z.buffer).setUint32(pos, adler32(raw));

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB

  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', z),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

if (require.main === module) {
  const out = process.argv[2] ?? join(__dirname, 'perf-image.png');
  const png = buildPng();
  writeFileSync(out, png);
  console.log(`${out}: ${png.length} bytes`);
}
