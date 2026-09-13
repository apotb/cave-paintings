/**
 * Freeform 16³ clay forming: occupancy, pack, rotate, classify, shatter.
 * Phaser-free so node tests can run it.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Forming = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const SIZE = 16;
    const MIN_MASS = 12;
    const UNDO_MAX = 20;
    const CLAY_WEIGHT = 0.8;
    const PACK_BYTES = (SIZE * SIZE * SIZE) / 8;
    const PIVOT = 7.5;
    const FORM_CLASSES = ["animal", "human", "deity", "lump"];
    const NAMES = {
        animal: "Clay Animal Figurine",
        human: "Clay Human Figurine",
        deity: "Clay Deity Figurine",
        lump: "Clay Lump"
    };
    const FLAVOR = {
        animal: "Resembles a four-legged friend",
        human: "Resembles someone we know",
        deity: "Resembles a figure of worship",
        lump: "Resembles a lump of clay"
    };
    const BEAUTY = { animal: 1, human: 1, deity: 2, lump: 0 };
    const NAME_MAX = 24;

    function emptyGrid() {
        const n = SIZE;
        const g = new Array(n);
        for (let x = 0; x < n; x++) {
            g[x] = new Array(n);
            for (let y = 0; y < n; y++) {
                g[x][y] = new Array(n).fill(false);
            }
        }
        return g;
    }

    function cloneGrid(grid) {
        const n = SIZE;
        const g = emptyGrid();
        if (!grid) return g;
        for (let x = 0; x < n; x++) {
            for (let y = 0; y < n; y++) {
                for (let z = 0; z < n; z++) {
                    g[x][y][z] = !!grid[x]?.[y]?.[z];
                }
            }
        }
        return g;
    }

    function inBounds(x, y, z) {
        return x >= 0 && y >= 0 && z >= 0 && x < SIZE && y < SIZE && z < SIZE;
    }

    function mass(grid) {
        let n = 0;
        forEachVoxel(grid, () => { n++; });
        return n;
    }

    function forEachVoxel(grid, fn) {
        if (!grid) return;
        const n = SIZE;
        for (let x = 0; x < n; x++) {
            const yz = grid[x];
            if (!yz) continue;
            for (let y = 0; y < n; y++) {
                const row = yz[y];
                if (!row) continue;
                for (let z = 0; z < n; z++) {
                    if (row[z]) fn(x, y, z);
                }
            }
        }
    }

    function indexOf(x, y, z) {
        return x + SIZE * (y + SIZE * z);
    }

    function pack(grid) {
        const bytes = new Uint8Array(PACK_BYTES);
        forEachVoxel(grid, (x, y, z) => {
            const i = indexOf(x, y, z);
            bytes[i >> 3] |= 1 << (i & 7);
        });
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
            return Buffer.from(bytes).toString("base64");
        }
        if (typeof btoa === "function") return btoa(bin);
        throw new Error("no base64");
    }

    function unpack(raw) {
        const s = sanitizePack(raw);
        if (!s) return null;
        let bytes;
        try {
            if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
                bytes = Uint8Array.from(Buffer.from(s, "base64"));
            } else if (typeof atob === "function") {
                const bin = atob(s);
                bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            } else {
                return null;
            }
        } catch (_) {
            return null;
        }
        if (bytes.length !== PACK_BYTES) return null;
        const grid = emptyGrid();
        for (let i = 0; i < SIZE * SIZE * SIZE; i++) {
            if (bytes[i >> 3] & (1 << (i & 7))) {
                const x = i % SIZE;
                const y = Math.floor(i / SIZE) % SIZE;
                const z = Math.floor(i / (SIZE * SIZE));
                grid[x][y][z] = true;
            }
        }
        return grid;
    }

    function sanitizePack(raw) {
        if (typeof raw !== "string") return null;
        const s = raw.trim();
        if (s.length < 8 || s.length > 1024) return null;
        if (!/^[A-Za-z0-9+/]+=*$/.test(s)) return null;
        return s;
    }

    function neighbors6(x, y, z) {
        return [
            [x + 1, y, z], [x - 1, y, z],
            [x, y + 1, z], [x, y - 1, z],
            [x, y, z + 1], [x, y, z - 1]
        ];
    }

    function components(grid) {
        const seen = emptyGrid();
        const comps = [];
        forEachVoxel(grid, (sx, sy, sz) => {
            if (seen[sx][sy][sz]) return;
            const cells = [];
            const stack = [[sx, sy, sz]];
            seen[sx][sy][sz] = true;
            while (stack.length) {
                const [x, y, z] = stack.pop();
                cells.push([x, y, z]);
                for (const [nx, ny, nz] of neighbors6(x, y, z)) {
                    if (!inBounds(nx, ny, nz)) continue;
                    if (!grid[nx][ny][nz] || seen[nx][ny][nz]) continue;
                    seen[nx][ny][nz] = true;
                    stack.push([nx, ny, nz]);
                }
            }
            comps.push(cells);
        });
        comps.sort((a, b) => b.length - a.length);
        return comps;
    }

    function largestComponent(grid) {
        return components(grid)[0] || [];
    }

    function aabbOf(cells) {
        if (!cells.length) {
            return { minX: 0, minY: 0, minZ: 0, maxX: -1, maxY: -1, maxZ: -1, w: 0, h: 0, d: 0 };
        }
        let minX = SIZE, minY = SIZE, minZ = SIZE;
        let maxX = -1, maxY = -1, maxZ = -1;
        for (const [x, y, z] of cells) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
        }
        return {
            minX, minY, minZ, maxX, maxY, maxZ,
            w: maxX - minX + 1,
            h: maxY - minY + 1,
            d: maxZ - minZ + 1
        };
    }

    function gridFromCells(cells) {
        const g = emptyGrid();
        for (const [x, y, z] of cells) {
            if (inBounds(x, y, z)) g[x][y][z] = true;
        }
        return g;
    }

    function supportsAtBottom(cells) {
        if (!cells.length) return 0;
        const box = aabbOf(cells);
        const y0 = box.minY;
        const seen = Object.create(null);
        const key = (x, z) => `${x},${z}`;
        const onFloor = [];
        for (const [x, y, z] of cells) {
            if (y === y0) onFloor.push([x, z]);
        }
        let n = 0;
        for (const [sx, sz] of onFloor) {
            const k0 = key(sx, sz);
            if (seen[k0]) continue;
            n++;
            const stack = [[sx, sz]];
            seen[k0] = true;
            while (stack.length) {
                const [x, z] = stack.pop();
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = x + dx;
                    const nz = z + dz;
                    const k = key(nx, nz);
                    if (seen[k]) continue;
                    if (!onFloor.some(([ox, oz]) => ox === nx && oz === nz)) continue;
                    seen[k] = true;
                    stack.push([nx, nz]);
                }
            }
        }
        return n;
    }

    function sliceComponents(cells, pred) {
        const picked = cells.filter(pred);
        const seen = Object.create(null);
        const keyOf = (c) => `${c[0]},${c[1]},${c[2]}`;
        const set = new Set(picked.map(keyOf));
        const comps = [];
        for (const start of picked) {
            const k0 = keyOf(start);
            if (seen[k0]) continue;
            const blob = [];
            const stack = [start];
            seen[k0] = true;
            while (stack.length) {
                const c = stack.pop();
                blob.push(c);
                for (const [nx, ny, nz] of neighbors6(c[0], c[1], c[2])) {
                    const k = `${nx},${ny},${nz}`;
                    if (!set.has(k) || seen[k]) continue;
                    seen[k] = true;
                    stack.push([nx, ny, nz]);
                }
            }
            comps.push(blob);
        }
        comps.sort((a, b) => b.length - a.length);
        return comps;
    }

    function hasHorns(cells, box) {
        if (box.h < 4) return false;
        const crown = box.maxY;
        const spikes = sliceComponents(cells, (c) => c[1] >= crown);
        return spikes.length >= 2 && spikes.every((b) => b.length <= 4);
    }

    function hasSecondHead(cells, box) {
        const cut = box.minY + Math.floor(box.h * 0.66);
        const top = sliceComponents(cells, (c) => c[1] >= cut);
        const heads = top.filter((b) => b.length >= 3);
        return heads.length >= 2;
    }

    function hasYPose(cells, box) {
        if (box.w < 3) return false;
        const headY = box.minY + Math.floor(box.h * 0.7);
        let left = false;
        let right = false;
        for (const [x, y] of cells) {
            if (y < headY) continue;
            if (x <= box.minX + 1) left = true;
            if (x >= box.maxX - 1) right = true;
        }
        return left && right && box.w >= 4;
    }

    function deityExtras(cells, box) {
        return hasHorns(cells, box) || hasSecondHead(cells, box) || hasYPose(cells, box);
    }

    function isUpright(box) {
        const base = Math.max(box.w, box.d, 1);
        return box.h >= base && box.h / base >= 1.35;
    }

    function classify(grid, opts = {}) {
        const cells = largestComponent(grid);
        const m = cells.length;
        const box = aabbOf(cells);
        const legs = supportsAtBottom(cells);
        const idolatry = !!opts.idolatry;
        let formClass = "lump";
        if (m >= MIN_MASS) {
            const horiz = Math.max(box.w, box.d);
            if (horiz > box.h && legs >= 3) {
                formClass = "animal";
            } else if (isUpright(box) && legs >= 1 && legs <= 2 && deityExtras(cells, box) && idolatry) {
                formClass = "deity";
            } else if (isUpright(box) && legs >= 1 && legs <= 2) {
                formClass = "human";
            }
        }
        return {
            formClass,
            name: NAMES[formClass],
            preview: previewLine(formClass),
            mass: m,
            box,
            legs,
            beauty: BEAUTY[formClass],
            flavor: FLAVOR[formClass]
        };
    }

    function previewLine(formClass) {
        switch (formClass) {
            case "animal": return "Looks like an animal figurine…";
            case "human": return "Looks like a human figurine…";
            case "deity": return "Looks like a deity figurine…";
            default: return "Looks like a lump of clay…";
        }
    }

    function helpLines(unlocked) {
        const lines = [];
        if (unlocked.animal) {
            lines.push("Animal — long body, four legs");
        }
        if (unlocked.human) {
            lines.push("Human — upright, head and two legs");
        }
        if (unlocked.deity) {
            lines.push("Deity — human-like with horns, extra head, or raised arms");
        }
        return lines;
    }

    function techniquesFor(holder, hasTechFn) {
        const has = typeof hasTechFn === "function"
            ? (id) => !!hasTechFn(holder, id)
            : () => false;
        const clay = has("clay_forming");
        return {
            animal: clay,
            human: clay,
            deity: clay && has("idolatry")
        };
    }

    /**
     * Clockwise from above around the vertical center of the 16³ box.
     * dir > 0 = CW, dir < 0 = CCW. Returns null if any voxel would leave the box.
     */
    function rotateY(grid, dir) {
        const cw = dir >= 0;
        const next = emptyGrid();
        let ok = true;
        forEachVoxel(grid, (x, y, z) => {
            const nx = cw ? Math.round(PIVOT - (z - PIVOT)) : Math.round(PIVOT + (z - PIVOT));
            const nz = cw ? Math.round(PIVOT + (x - PIVOT)) : Math.round(PIVOT - (x - PIVOT));
            if (!inBounds(nx, y, nz)) {
                ok = false;
                return;
            }
            next[nx][y][nz] = true;
        });
        return ok ? next : null;
    }

    function yawQuarterTurns(rot) {
        let n = Math.round(Number(rot) || 0);
        n = ((n % 360) + 360) % 360;
        n = Math.round(n / 90);
        return ((n % 4) + 4) % 4;
    }

    /** Yaw a packed figurine by place-rot (0/90/180/270). Null if a step would leave the cube. */
    function rotatePackYaw(raw, rot) {
        const s = sanitizePack(raw);
        if (!s) return null;
        const turns = yawQuarterTurns(rot);
        if (!turns) return s;
        let grid = unpack(s);
        if (!grid) return null;
        for (let i = 0; i < turns; i++) {
            const next = rotateY(grid, 1);
            if (!next) return null;
            grid = next;
        }
        return pack(grid);
    }

    /**
     * Older places baked yaw into voxels. Undo that once; `rot` stays a place-only pose.
     * New entries set `formPose` so this is a no-op.
     */
    function detachLegacyPlaceYaw(entry) {
        if (!entry || entry.formPose) return entry;
        entry.formPose = 1;
        const turns = yawQuarterTurns(entry.rot);
        if (!turns || !entry.formVoxels) return entry;
        const restored = rotatePackYaw(entry.formVoxels, (4 - turns) * 90);
        if (restored) entry.formVoxels = restored;
        return entry;
    }

    function shatterCheck(grid, opts = {}) {
        const g = cloneGrid(grid);
        if (opts.holding && inBounds(opts.holding.x, opts.holding.y, opts.holding.z)) {
            g[opts.holding.x][opts.holding.y][opts.holding.z] = true;
        }
        const m = mass(g);
        if (m <= 0) {
            return { shattered: true, reason: "It crumbled to dust" };
        }
        const largest = largestComponent(g);
        if (largest.length < MIN_MASS) {
            return { shattered: true, reason: "It crumbled to bits" };
        }
        return { shattered: false, reason: null };
    }

    /**
     * Side-view heap → 3D mound. Image X = world X, Y-from-bottom = height,
     * depth falls off from the centerline.
     */
    function moundFromPixels(pixels, width, height) {
        const grid = emptyGrid();
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        if (!pixels || pixels.length < w * h * 4) {
            return ensureMinMass(grid);
        }
        const opaque = (ix, iy) => {
            if (ix < 0 || iy < 0 || ix >= w || iy >= h) return false;
            return pixels[(iy * w + ix) * 4 + 3] > 80;
        };
        const colTop = new Array(SIZE).fill(SIZE);
        const colBot = new Array(SIZE).fill(-1);
        for (let x = 0; x < SIZE; x++) {
            const ix = Math.min(w - 1, Math.floor((x + 0.5) * w / SIZE));
            for (let iy = 0; iy < h; iy++) {
                if (!opaque(ix, iy)) continue;
                const wy = Math.round((h - 1 - iy) * (SIZE - 1) / Math.max(1, h - 1));
                if (wy < colTop[x]) colTop[x] = wy;
                if (wy > colBot[x]) colBot[x] = wy;
            }
        }
        for (let x = 0; x < SIZE; x++) {
            if (colBot[x] < 0) continue;
            const heightV = Math.max(1, colBot[x] - colTop[x] + 1);
            for (let y = 0; y < heightV && y < SIZE; y++) {
                const t = heightV <= 1 ? 1 : 1 - y / heightV;
                const half = Math.max(1, Math.round(t * 3));
                for (let dz = -half; dz <= half; dz++) {
                    const z = 8 + dz;
                    if (inBounds(x, y, z)) grid[x][y][z] = true;
                }
            }
        }
        return ensureMinMass(grid);
    }

    function ensureMinMass(grid) {
        if (mass(grid) >= MIN_MASS) return grid;
        const cx = 8, cy = 2, cz = 8;
        for (let x = cx - 2; x <= cx + 2; x++) {
            for (let y = 0; y <= cy + 2; y++) {
                for (let z = cz - 2; z <= cz + 2; z++) {
                    if (inBounds(x, y, z)) grid[x][y][z] = true;
                }
            }
        }
        return grid;
    }

    function fallbackMound() {
        return ensureMinMass(emptyGrid());
    }

    function averageColor(pixels) {
        if (!pixels || pixels.length < 4) return 0xc47a6a;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] <= 80) continue;
            r += pixels[i];
            g += pixels[i + 1];
            b += pixels[i + 2];
            n++;
        }
        if (!n) return 0xc47a6a;
        return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0;
    }

    function weightFor(gridVoxels, startMass) {
        const n = Math.max(1, Number(startMass) || 1);
        const v = Math.max(0, Number(gridVoxels) || 0);
        return Math.round((CLAY_WEIGHT * v / n) * 100) / 100;
    }

    function makeStack(formClass, grid, startMass) {
        const cls = FORM_CLASSES.includes(formClass) ? formClass : "lump";
        const voxels = mass(grid);
        const stack = {
            id: "clay_figurine",
            quantity: 1,
            formClass: cls,
            formVoxels: pack(grid),
            formStartMass: Math.max(MIN_MASS, Number(startMass) || MIN_MASS),
            tooltipExtra: FLAVOR[cls],
            weight: weightFor(voxels, startMass),
            beauty: BEAUTY[cls]
        };
        return stack;
    }

    function sanitizeClass(raw) {
        const s = String(raw || "");
        return FORM_CLASSES.includes(s) ? s : "lump";
    }

    function clampName(raw) {
        return String(raw || "").trim().slice(0, NAME_MAX);
    }

    function defaultNameFor(cls) {
        return NAMES[sanitizeClass(cls)] || NAMES.lump;
    }

    function hasAssignedName(stack) {
        return !!clampName(stack?.customName);
    }

    function isCustomName(stack) {
        if (!stack) return false;
        if (stack.formCustom) return true;
        const n = clampName(stack.customName);
        if (!n) return false;
        for (const c of FORM_CLASSES) {
            if (n === NAMES[c]) return false;
        }
        return true;
    }

    /**
     * Apply finish naming: custom names stick; class defaults update on defined
     * finishes (and on any later finish once a name was assigned). First clay
     * finished as a lump stays unnamed.
     */
    function applyFinishName(stack, opts = {}) {
        if (!stack) return stack;
        const cls = sanitizeClass(stack.formClass);
        stack.formClass = cls;
        const pending = clampName(opts.pendingName);
        const prevName = clampName(opts.prev?.customName);
        const hadName = !!(pending || prevName);
        let custom;
        if (opts.pendingCustom === true) custom = true;
        else if (opts.pendingCustom === false) custom = false;
        else {
            custom = isCustomName({
                customName: pending || prevName,
                formCustom: opts.prev?.formCustom
            });
        }
        if (custom) {
            const keep = pending || prevName;
            if (keep) {
                stack.customName = keep;
                stack.formCustom = true;
            } else {
                delete stack.customName;
                delete stack.formCustom;
            }
            return stack;
        }
        if (hadName || canPlaceClass(cls)) {
            stack.customName = defaultNameFor(cls);
            delete stack.formCustom;
        } else {
            delete stack.customName;
            delete stack.formCustom;
        }
        return stack;
    }

    /** Finished sculptures (not lumps or raw clay) can be placed in the world. */
    function canPlaceClass(cls) {
        const s = sanitizeClass(cls);
        return s === "animal" || s === "human" || s === "deity";
    }

    function isAdjacentFilled(grid, x, y, z) {
        for (const [nx, ny, nz] of neighbors6(x, y, z)) {
            if (inBounds(nx, ny, nz) && grid[nx][ny][nz]) return true;
        }
        return false;
    }

    /** Remove every voxel sharing this XZ (world-up column). Returns how many were filled. */
    function clearColumn(grid, x, z) {
        if (!grid || !inBounds(x, 0, z)) return 0;
        let n = 0;
        for (let y = 0; y < SIZE; y++) {
            if (!grid[x][y][z]) continue;
            grid[x][y][z] = false;
            n++;
        }
        return n;
    }

    /**
     * 16×16 top-down occupancy: 1 XZ column = 1 pixel (image X = voxel X, Y = voxel Z).
     * Taller columns are brighter; empty columns stay transparent.
     */
    function topDownRgba(grid, color = 0xc47a6a) {
        const n = SIZE;
        const data = new Uint8ClampedArray(n * n * 4);
        if (!grid) return data;
        const base = color >>> 0;
        const br = (base >> 16) & 255;
        const bg = (base >> 8) & 255;
        const bb = base & 255;
        const tops = new Int8Array(n * n);
        tops.fill(-1);
        for (let x = 0; x < n; x++) {
            const yz = grid[x];
            for (let z = 0; z < n; z++) {
                let top = -1;
                if (yz) {
                    for (let y = n - 1; y >= 0; y--) {
                        if (yz[y]?.[z]) {
                            top = y;
                            break;
                        }
                    }
                }
                tops[z * n + x] = top;
            }
        }
        const denom = n - 1;
        for (let x = 0; x < n; x++) {
            for (let z = 0; z < n; z++) {
                const top = tops[z * n + x];
                if (top < 0) continue;
                let occ = 0;
                if (x > 0 && tops[z * n + (x - 1)] >= 0) occ++;
                if (x + 1 < n && tops[z * n + (x + 1)] >= 0) occ++;
                if (z > 0 && tops[(z - 1) * n + x] >= 0) occ++;
                if (z + 1 < n && tops[(z + 1) * n + x] >= 0) occ++;
                const h = 0.62 + 0.38 * (top / denom);
                const ao = 1 - 0.22 * (occ / 4);
                const t = h * ao;
                const i = (z * n + x) * 4;
                data[i] = Math.round(br * t);
                data[i + 1] = Math.round(bg * t);
                data[i + 2] = Math.round(bb * t);
                data[i + 3] = 255;
            }
        }
        return data;
    }

    return {
        SIZE,
        MIN_MASS,
        NAME_MAX,
        UNDO_MAX,
        CLAY_WEIGHT,
        FORM_CLASSES,
        NAMES,
        FLAVOR,
        BEAUTY,
        emptyGrid,
        cloneGrid,
        inBounds,
        mass,
        forEachVoxel,
        pack,
        unpack,
        sanitizePack,
        components,
        largestComponent,
        aabbOf,
        gridFromCells,
        supportsAtBottom,
        classify,
        previewLine,
        helpLines,
        techniquesFor,
        rotateY,
        rotatePackYaw,
        detachLegacyPlaceYaw,
        yawQuarterTurns,
        shatterCheck,
        moundFromPixels,
        ensureMinMass,
        fallbackMound,
        averageColor,
        weightFor,
        makeStack,
        sanitizeClass,
        clampName,
        defaultNameFor,
        hasAssignedName,
        isCustomName,
        applyFinishName,
        canPlaceClass,
        isAdjacentFilled,
        clearColumn,
        topDownRgba,
        neighbors6
    };
});
