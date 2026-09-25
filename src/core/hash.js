// POSIX `cksum` CRC, so state paths and spoken session colours stay identical
// to the bash version (which shelled out to cksum). Not a security hash.
const TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i << 24;
  for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  TABLE[i] = c >>> 0;
}

export function cksum(str) {
  const bytes = Buffer.from(String(str), 'utf8');
  let crc = 0;
  const feed = (b) => { crc = ((crc << 8) ^ TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0; };
  for (const b of bytes) feed(b);
  for (let n = bytes.length; n > 0; n = Math.floor(n / 256)) feed(n & 0xff);
  return (~crc) >>> 0;
}
