/**
 * One-off: split assets/mobs/human.png into grayscale tintable part sheets.
 * Fill → white, shadows scaled by original max-channel ratio, eyes → white.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "assets/mobs/human.png");
const OUT = path.join(ROOT, "assets/player");

const PARTS = {
    head: { fill: 0xff00ee, shadow: 0xbf00b3 },
    eyes: { fill: 0x000000 },
    arms: { fill: 0xff8900, shadow: 0xbb6500 },
    shirt: { fill: 0x006cff },
    pants: { fill: 0xff0000 },
    shoes: { fill: 0x7a6c47 }
};

function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}

function writePNG(file, w, h, pixels) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
        const o = y * (w * 4 + 1);
        raw[o] = 0;
        pixels[y].copy(raw, o + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const out = Buffer.concat([
        sig,
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0))
    ]);
    fs.writeFileSync(file, out);
}

function readPNG(file) {
    const buf = fs.readFileSync(file);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error("not png");
    let off = 8;
    let w = 0;
    let h = 0;
    let bit = 0;
    let color = 0;
    const idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        off += 4;
        const type = buf.toString("ascii", off, off + 4);
        off += 4;
        const data = buf.slice(off, off + len);
        off += len + 4;
        if (type === "IHDR") {
            w = data.readUInt32BE(0);
            h = data.readUInt32BE(4);
            bit = data[8];
            color = data[9];
        }
        if (type === "IDAT") idat.push(data);
        if (type === "IEND") break;
    }
    const infl = zlib.inflateSync(Buffer.concat(idat));
    if (bit !== 8 || (color !== 2 && color !== 6)) {
        throw new Error(`unsupported png ${bit}/${color}`);
    }
    const bpp = color === 6 ? 4 : 3;
    const stride = w * bpp;
    const pixels = [];
    let i = 0;
    for (let y = 0; y < h; y++) {
        const filter = infl[i++];
        const row = Buffer.from(infl.slice(i, i + stride));
        i += stride;
        if (filter === 1) {
            for (let x = 0; x < stride; x++) {
                row[x] = (row[x] + (x >= bpp ? row[x - bpp] : 0)) & 255;
            }
        } else if (filter === 2) {
            const prev = pixels[y - 1];
            for (let x = 0; x < stride; x++) {
                row[x] = (row[x] + (prev ? prev[x] : 0)) & 255;
            }
        } else if (filter === 3) {
            const prev = pixels[y - 1];
            for (let x = 0; x < stride; x++) {
                const a = x >= bpp ? row[x - bpp] : 0;
                const b = prev ? prev[x] : 0;
                row[x] = (row[x] + Math.floor((a + b) / 2)) & 255;
            }
        } else if (filter === 4) {
            const prev = pixels[y - 1];
            for (let x = 0; x < stride; x++) {
                const a = x >= bpp ? row[x - bpp] : 0;
                const b = prev ? prev[x] : 0;
                const c = prev && x >= bpp ? prev[x - bpp] : 0;
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                row[x] = (row[x] + pr) & 255;
            }
        } else if (filter !== 0) {
            throw new Error("filter " + filter);
        }
        if (bpp === 4) {
            pixels.push(row);
        } else {
            const rgba = Buffer.alloc(w * 4);
            for (let x = 0; x < w; x++) {
                rgba[x * 4] = row[x * 3];
                rgba[x * 4 + 1] = row[x * 3 + 1];
                rgba[x * 4 + 2] = row[x * 3 + 2];
                rgba[x * 4 + 3] = 255;
            }
            pixels.push(rgba);
        }
    }
    return { w, h, pixels };
}

function rgb(n) {
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function maxCh(n) {
    const [r, g, b] = rgb(n);
    return Math.max(r, g, b);
}

function grayFor(part, color) {
    const fill = part.fill;
    const shadow = part.shadow;
    if (color === fill) return 255;
    if (shadow != null && color === shadow) {
        const m = maxCh(fill);
        const s = maxCh(shadow);
        return m > 0 ? Math.max(1, Math.round(255 * (s / m))) : 128;
    }
    return 255;
}

function pack(r, g, b) {
    return ((r << 16) | (g << 8) | b) >>> 0;
}

const src = readPNG(SRC);
fs.mkdirSync(OUT, { recursive: true });

for (const [name, part] of Object.entries(PARTS)) {
    const want = new Set([part.fill, part.shadow].filter((n) => n != null));
    const rows = [];
    let count = 0;
    for (let y = 0; y < src.h; y++) {
        const row = Buffer.alloc(src.w * 4);
        const srcRow = src.pixels[y];
        for (let x = 0; x < src.w; x++) {
            const o = x * 4;
            const a = srcRow[o + 3];
            const c = pack(srcRow[o], srcRow[o + 1], srcRow[o + 2]);
            if (a < 16 || !want.has(c)) continue;
            const g = grayFor(part, c);
            row[o] = g;
            row[o + 1] = g;
            row[o + 2] = g;
            row[o + 3] = 255;
            count++;
        }
        rows.push(row);
    }
    const dest = path.join(OUT, `${name}.png`);
    writePNG(dest, src.w, src.h, rows);
    console.log(`${name}: ${count} px → ${path.relative(ROOT, dest)}`);
}
