/**
 * Seed-stable world structures (abandoned camps, later ruins).
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const Place = require("./place");
        const rng = require("./rng");
        module.exports = factory(Place, rng);
    } else {
        root.Structures = factory(root.Place, root.NetRng);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Place, rng) {
    const mulberry32 = rng?.mulberry32;
    const hash2D = rng?.hash2D;
    const CS = 8;
    const TS = 16;
    const LOOT_SALT = 0x51ed1007;

    const ALLOWED_PLACE = {
        grass: true,
        grass_hill: true,
        sand: true,
        sand_hill: true,
        snow: true,
        snow_hill: true
    };
    const YARD_EDIT = {
        grass: true,
        grass_hill: true,
        sand: true,
        sand_hill: true,
        snow: true,
        snow_hill: true,
        gravel: true,
        snow_beach: true
    };
    const BLOCKED = { water: true, ice: true };
    const STUMP_OF = {
        tree: "tree_stump",
        apple_tree: "tree_stump",
        snow_tree: "snow_tree_stump",
        palm_tree: "coconut_tree_stump",
        coconut_tree: "coconut_tree_stump"
    };
    const VANISH_SOLID = {
        bush: true,
        snow_bush: true,
        cactus: true,
        flowering_cactus: true,
        blueberry_bush: true
    };
    const KIND_DEFS = {
        campfire: { campfire: true },
        sleep: { sleep: { slots: 2 }, footprint: [2, 1] },
        storage: { storage: { slots: 6 } },
        craft: { craftStation: true }
    };

    let _config = null;

    function loadConfig(cfg) {
        if (cfg && typeof cfg === "object") _config = cfg;
        return _config;
    }

    function getConfig(scene) {
        if (_config) return _config;
        if (scene?.cache?.json?.exists?.("structures")) {
            _config = scene.cache.json.get("structures");
            return _config;
        }
        if (typeof require === "function" && typeof process !== "undefined") {
            const fs = require("fs");
            const path = require("path");
            _config = JSON.parse(
                fs.readFileSync(path.join(__dirname, "..", "data", "Structures.json"), "utf8")
            );
        }
        return _config;
    }

    function typesInOrder(cfg) {
        return Array.isArray(cfg?.types) ? cfg.types : [];
    }

    function typeById(cfg, id) {
        return typesInOrder(cfg).find((t) => t?.id === id) || null;
    }

    function cellTiles(type) {
        const n = Math.max(1, Math.floor(Number(type?.cellChunks) || 16));
        return n * CS;
    }

    function rotateDelta(dx, dy, rot) {
        const r = Place ? Place.normalizeRot(rot) : (rot || 0);
        if (r === 90) return { dx: -dy, dy: dx };
        if (r === 180) return { dx: -dx, dy: -dy };
        if (r === 270) return { dx: dy, dy: -dx };
        return { dx, dy };
    }

    function pieceDef(piece) {
        const base = KIND_DEFS[piece?.kind] || {};
        const fp = Array.isArray(piece?.footprint) ? piece.footprint : base.footprint;
        return {
            id: piece.id,
            ...base,
            footprint: fp || [1, 1]
        };
    }

    function footprintOf(tx, ty, rot, piece) {
        const def = pieceDef(piece);
        if (!Place) return [{ tx, ty }];
        return Place.footprintTiles(tx, ty, rot, def.footprint);
    }

    function openSideTiles(tx, ty, rot, piece) {
        const tiles = footprintOf(tx, ty, rot, piece);
        const r = Place ? Place.normalizeRot(rot) : (rot || 0);
        let ox = 0;
        let oy = 0;
        if (r === 0) oy = 1;
        else if (r === 90) ox = -1;
        else if (r === 180) oy = -1;
        else ox = 1;
        return tiles.map((t) => ({ tx: t.tx + ox, ty: t.ty + oy }));
    }

    function isPlaceLand(key) {
        return !!ALLOWED_PLACE[key];
    }

    function isWalkLand(key) {
        return !!(key && !BLOCKED[key]);
    }

    function isYardEdit(key) {
        return !!YARD_EDIT[key];
    }

    function tileKey(tileKeyAt, tx, ty) {
        if (typeof tileKeyAt !== "function") return null;
        return tileKeyAt(tx, ty);
    }

    function coversOrigin(tiles) {
        return tiles.some((t) => t.tx === 0 && t.ty === 0);
    }

    function pickWeighted(rand, rows) {
        let sum = 0;
        for (const row of rows) sum += Math.max(0, Number(row.weight) || 0);
        if (!(sum > 0)) return rows[0] || null;
        let x = rand() * sum;
        for (const row of rows) {
            x -= Math.max(0, Number(row.weight) || 0);
            if (x <= 0) return row;
        }
        return rows[rows.length - 1];
    }

    function randInt(rand, min, max) {
        const a = Math.floor(Number(min) || 0);
        const b = Math.floor(Number(max) || a);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return lo + Math.floor(rand() * (hi - lo + 1));
    }

    function fillBasketSlots(table, rand) {
        const slots = [null, null, null, null, null, null];
        if (!table) return slots;
        const countRow = pickWeighted(rand, table.stackCount || [{ n: 1, weight: 1 }]);
        const n = Math.max(1, Math.min(6, Math.floor(Number(countRow?.n) || 1)));
        const idxs = [0, 1, 2, 3, 4, 5];
        for (let i = idxs.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const t = idxs[i];
            idxs[i] = idxs[j];
            idxs[j] = t;
        }
        const chosen = idxs.slice(0, n);
        const weapons = Array.isArray(table.weapons) ? table.weapons : [];
        const junk = Array.isArray(table.junk) ? table.junk : [];
        for (const slot of chosen) {
            let stack = null;
            const roll = rand();
            let acc = 0;
            for (const w of weapons) {
                acc += Number(w.chance) || 0;
                if (roll < acc) {
                    const frac = w.durabilityFrac || [0.25, 0.55];
                    const f = Number(frac[0]) + rand() * (Number(frac[1]) - Number(frac[0]));
                    const max = Number(w.durability) || 100;
                    stack = {
                        id: w.id,
                        quantity: 1,
                        durability: Math.max(1, max * f)
                    };
                    break;
                }
            }
            if (!stack) {
                const row = pickWeighted(rand, junk);
                if (row?.id) {
                    stack = {
                        id: row.id,
                        quantity: randInt(rand, row.min, row.max)
                    };
                }
            }
            slots[slot] = stack;
        }
        return slots;
    }

    function worldPos(tx, ty, rot, piece, ts) {
        const def = pieceDef(piece);
        if (Place && (def.footprint[0] > 1 || def.footprint[1] > 1)) {
            return Place.footprintWorldPos(tx, ty, rot, def.footprint, ts);
        }
        return { x: tx * ts + ts / 2, y: ty * ts + ts };
    }

    function makeEntry(piece, tx, ty, rot, worldSeed, ts, lootTables) {
        const def = pieceDef(piece);
        const pos = worldPos(tx, ty, rot, piece, ts);
        const entry = {
            id: piece.id,
            x: pos.x,
            y: pos.y,
            rot
        };
        if (piece.kind === "campfire") {
            entry.uid = `cf_${Math.round(pos.x)}_${Math.round(pos.y)}`;
            entry.fuel = [null, null];
            entry.cook = null;
            entry.catalyst = null;
            entry.simmer = [null, null, null, null];
            entry.cookProgress = 0;
            entry.burnRemaining = 0;
            return entry;
        }
        if (piece.kind === "sleep") {
            entry.tx = tx;
            entry.ty = ty;
            if (Place) Place.ensureSleepEntry(entry, def);
            return entry;
        }
        if (piece.kind === "storage") {
            if (piece.loot && lootTables?.[piece.loot]) {
                const lootRand = mulberry32(hash2D(tx, ty, (worldSeed ^ LOOT_SALT) >>> 0));
                entry.slots = fillBasketSlots(lootTables[piece.loot], lootRand);
            }
            if (Place) Place.ensureStorageEntry(entry, def);
            return entry;
        }
        if (piece.kind === "craft") {
            if (Place) Place.ensureCraftStationEntry(entry);
            return entry;
        }
        return entry;
    }

    /**
     * Resolve one structure type in one cell. Returns null if no spawn.
     * Layout RNG is independent of loot RNG.
     */
    function resolveTypeCell(type, cellX, cellY, worldSeed, tileKeyAt) {
        if (!type || !mulberry32 || !hash2D) return null;
        const ct = cellTiles(type);
        const salt = (Number(type.salt) || 0) >>> 0;
        const rand = mulberry32(hash2D(cellX | 0, cellY | 0, (worldSeed ^ salt) >>> 0));
        if (rand() >= (Number(type.attemptChance) || 0)) return null;
        const campRot = [0, 90, 180, 270][Math.floor(rand() * 4)];
        const originTx = (cellX | 0) * ct + (ct >> 1);
        const originTy = (cellY | 0) * ct + (ct >> 1);
        const piecesIn = type.template?.pieces;
        if (!Array.isArray(piecesIn) || !piecesIn.length) return null;

        const spawned = [];
        for (const piece of piecesIn) {
            let include = true;
            if (piece.chance != null) include = rand() < Number(piece.chance);
            const d = rotateDelta(Number(piece.dx) || 0, Number(piece.dy) || 0, campRot);
            const rot = Place
                ? Place.normalizeRot((Number(piece.rot) || 0) + campRot)
                : ((Number(piece.rot) || 0) + campRot) % 360;
            const tx = originTx + d.dx;
            const ty = originTy + d.dy;
            const foot = footprintOf(tx, ty, rot, piece);
            const required = piece.chance == null;
            if (!include) continue;
            if (coversOrigin(foot)) {
                if (required) return null;
                continue;
            }
            let ok = true;
            for (const t of foot) {
                if (!isPlaceLand(tileKey(tileKeyAt, t.tx, t.ty))) {
                    ok = false;
                    break;
                }
            }
            if (ok && piece.kind === "sleep") {
                const open = openSideTiles(tx, ty, rot, piece);
                ok = open.length > 0 && open.every((t) => isWalkLand(tileKey(tileKeyAt, t.tx, t.ty)));
            }
            if (!ok) {
                if (required) return null;
                continue;
            }
            spawned.push({ piece, tx, ty, rot, foot });
        }

        for (const piece of piecesIn) {
            if (piece.chance != null) continue;
            if (!spawned.some((s) => s.piece === piece)) return null;
        }
        const fire = spawned.find((s) => s.piece.kind === "campfire");
        const lean = spawned.find((s) => s.piece.kind === "sleep" && s.piece.chance == null);
        if (!fire || !lean) return null;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const hasApproach = dirs.some(([dx, dy]) =>
            isWalkLand(tileKey(tileKeyAt, fire.tx + dx, fire.ty + dy))
        );
        if (!hasApproach) return null;

        let minTx = Infinity, maxTx = -Infinity, minTy = Infinity, maxTy = -Infinity;
        const footprints = [];
        const approach = [];
        for (const s of spawned) {
            for (const t of s.foot) {
                footprints.push(t);
                if (t.tx < minTx) minTx = t.tx;
                if (t.tx > maxTx) maxTx = t.tx;
                if (t.ty < minTy) minTy = t.ty;
                if (t.ty > maxTy) maxTy = t.ty;
            }
            if (s.piece.kind === "sleep") {
                for (const t of openSideTiles(s.tx, s.ty, s.rot, s.piece)) {
                    if (isWalkLand(tileKey(tileKeyAt, t.tx, t.ty))) approach.push(t);
                }
            }
        }
        for (const [dx, dy] of dirs) {
            const t = { tx: fire.tx + dx, ty: fire.ty + dy };
            if (isWalkLand(tileKey(tileKeyAt, t.tx, t.ty))) approach.push(t);
        }
        const pad = Math.max(0, Math.floor(Number(type.pad) || 1));
        const innerR = Math.max(1, Math.floor(Number(type.innerChebyshev) || 3));
        return {
            typeId: type.id,
            fireTx: fire.tx,
            fireTy: fire.ty,
            innerR,
            pad,
            minTx: minTx - pad,
            maxTx: maxTx + pad,
            minTy: minTy - pad,
            maxTy: maxTy + pad,
            spawned,
            footprints,
            approach
        };
    }

    function yardsOverlap(a, b) {
        if (!a || !b) return false;
        return !(a.maxTx < b.minTx || b.maxTx < a.minTx || a.maxTy < b.minTy || b.maxTy < a.minTy);
    }

    function typeReach(type) {
        let r = 1;
        const pieces = type?.template?.pieces;
        if (Array.isArray(pieces)) {
            for (const p of pieces) {
                const extra = Array.isArray(p.footprint) ? Math.max(p.footprint[0] || 1, p.footprint[1] || 1) : 1;
                r = Math.max(r, Math.abs(Number(p.dx) || 0) + extra, Math.abs(Number(p.dy) || 0) + extra);
            }
        }
        return r + Math.max(0, Math.floor(Number(type?.pad) || 1));
    }

    function cellMightOverlapChunk(type, cellX, cellY, cx, cy) {
        const ct = cellTiles(type);
        const ox = (cellX | 0) * ct + (ct >> 1);
        const oy = (cellY | 0) * ct + (ct >> 1);
        const r = typeReach(type);
        const t0 = cx * CS;
        const t1 = t0 + CS - 1;
        const u0 = cy * CS;
        const u1 = u0 + CS - 1;
        return !(ox + r < t0 || ox - r > t1 || oy + r < u0 || oy - r > u1);
    }

    function instancesOverlappingChunk(cx, cy, worldSeed, tileKeyAt, cfg) {
        const types = typesInOrder(cfg);
        const out = [];
        for (const type of types) {
            const n = Math.max(1, Math.floor(Number(type.cellChunks) || 16));
            const cellX = Math.floor(cx / n);
            const cellY = Math.floor(cy / n);
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = cellX + dx;
                    const ny = cellY + dy;
                    if (!cellMightOverlapChunk(type, nx, ny, cx, cy)) continue;
                    const inst = resolveTypeCell(type, nx, ny, worldSeed, tileKeyAt);
                    if (!inst) continue;
                    const t0 = cx * CS;
                    const t1 = t0 + CS - 1;
                    const u0 = cy * CS;
                    const u1 = u0 + CS - 1;
                    if (inst.maxTx < t0 || inst.minTx > t1 || inst.maxTy < u0 || inst.minTy > u1) continue;
                    out.push(inst);
                }
            }
        }
        const kept = [];
        for (const inst of out) {
            const earlier = kept.find((k) => {
                const ki = types.findIndex((t) => t.id === k.typeId);
                const ii = types.findIndex((t) => t.id === inst.typeId);
                return ki < ii && yardsOverlap(k, inst);
            });
            if (earlier) continue;
            kept.push(inst);
        }
        return kept;
    }

    function keyOf(tx, ty) {
        return `${tx},${ty}`;
    }

    function entryTile(entry, ts) {
        const x = Number(entry?.x) || 0;
        const y = Number(entry?.y) || 0;
        return {
            tx: Math.floor(x / ts),
            ty: Math.floor((y - 1) / ts)
        };
    }

    function inChunk(tx, ty, cx, cy) {
        return tx >= cx * CS && tx < cx * CS + CS && ty >= cy * CS && ty < cy * CS + CS;
    }

    function chunkOf(t) {
        return Math.floor(Number(t) / CS);
    }

    function fireChunkOf(inst) {
        return { cx: chunkOf(inst.fireTx), cy: chunkOf(inst.fireTy) };
    }

    function applyYard(inst, chunk, tileKeyAt) {
        const ts = chunk.tileSize || TS;
        const cx = chunk.cx;
        const cy = chunk.cy;
        const foot = new Set(inst.footprints.map((t) => keyOf(t.tx, t.ty)));
        const appr = new Set(inst.approach.map((t) => keyOf(t.tx, t.ty)));
        const clearHard = new Set([...foot, ...appr]);

        const filterList = (list, lootable) => {
            if (!Array.isArray(list)) return;
            for (let i = list.length - 1; i >= 0; i--) {
                const e = list[i];
                const { tx, ty } = entryTile(e, ts);
                if (!inChunk(tx, ty, cx, cy)) continue;
                if (tx < inst.minTx || tx > inst.maxTx || ty < inst.minTy || ty > inst.maxTy) continue;
                const tk = tileKey(tileKeyAt, tx, ty);
                if (!isYardEdit(tk)) continue;
                const k = keyOf(tx, ty);
                const id = e?.id;
                if (
                    id === "unlit_campfire"
                    || id === "campfire"
                    || id === "lean_to"
                    || id === "wicker_basket"
                    || id === "skinworking_bench"
                ) {
                    continue;
                }
                if (clearHard.has(k)) {
                    list.splice(i, 1);
                    continue;
                }
                if (lootable) {
                    if (STUMP_OF[id]) {
                        e.id = STUMP_OF[id];
                        delete e.lootable;
                        delete e.uid;
                        chunk.things.push(e);
                        list.splice(i, 1);
                        continue;
                    }
                    list.splice(i, 1);
                    continue;
                }
                if (STUMP_OF[id]) {
                    e.id = STUMP_OF[id];
                    continue;
                }
                if (VANISH_SOLID[id] || id === "blueberry_bush") {
                    list.splice(i, 1);
                    continue;
                }
                if (id === "rock") {
                    const cheb = Math.max(Math.abs(tx - inst.fireTx), Math.abs(ty - inst.fireTy));
                    if (cheb <= inst.innerR) list.splice(i, 1);
                }
            }
        };

        filterList(chunk.lootableThings, true);
        filterList(chunk.things, false);
    }

    function hasPieceEntry(list, piece, tx, ty, rot, ts) {
        const pos = worldPos(tx, ty, rot, piece, ts);
        return (list || []).some((e) =>
            e
            && e.id === piece.id
            && Math.abs(Number(e.x) - pos.x) < 0.75
            && Math.abs(Number(e.y) - pos.y) < 0.75
        );
    }

    function stampInstance(inst, chunk, worldSeed, cfg) {
        const ts = chunk.tileSize || TS;
        const cx = chunk.cx;
        const cy = chunk.cy;
        const lootTables = cfg?.lootTables || {};
        if (!Array.isArray(chunk.things)) chunk.things = [];
        for (const s of inst.spawned) {
            if (!inChunk(s.tx, s.ty, cx, cy)) continue;
            if (hasPieceEntry(chunk.things, s.piece, s.tx, s.ty, s.rot, ts)) continue;
            chunk.things.push(makeEntry(s.piece, s.tx, s.ty, s.rot, worldSeed, ts, lootTables));
        }
    }

    function applyInstance(inst, chunk, worldSeed, cfg, tileKeyAt) {
        applyYard(inst, chunk, tileKeyAt);
        stampInstance(inst, chunk, worldSeed, cfg);
    }

    function chunkHasCampfire(chunk) {
        const list = chunk?.things;
        if (!Array.isArray(list)) return false;
        return list.some((e) => e && (e.id === "unlit_campfire" || e.id === "campfire"));
    }

    function remoteChunksOf(inst, exceptCx, exceptCy) {
        const seen = new Set();
        const out = [];
        const add = (tx, ty) => {
            const rcx = chunkOf(tx);
            const rcy = chunkOf(ty);
            if (rcx === exceptCx && rcy === exceptCy) return;
            const k = `${rcx},${rcy}`;
            if (seen.has(k)) return;
            seen.add(k);
            out.push({ cx: rcx, cy: rcy });
        };
        for (const s of inst.spawned || []) add(s.tx, s.ty);
        add(inst.minTx, inst.minTy);
        add(inst.maxTx, inst.minTy);
        add(inst.minTx, inst.maxTy);
        add(inst.maxTx, inst.maxTy);
        return out;
    }

    const _pending = new Map();

    function pendingKey(worldSeed, cx, cy) {
        return `${worldSeed >>> 0}:${cx},${cy}`;
    }

    function clearPending(worldSeed) {
        if (worldSeed == null) {
            _pending.clear();
            return;
        }
        const prefix = `${worldSeed >>> 0}:`;
        for (const k of [..._pending.keys()]) {
            if (k.startsWith(prefix)) _pending.delete(k);
        }
    }

    function enqueuePending(worldSeed, cx, cy, inst) {
        const k = pendingKey(worldSeed, cx, cy);
        const list = _pending.get(k) || [];
        list.push(inst);
        _pending.set(k, list);
    }

    function takePending(worldSeed, cx, cy) {
        const k = pendingKey(worldSeed, cx, cy);
        const list = _pending.get(k) || [];
        _pending.delete(k);
        return list;
    }

    /**
     * Fire-chunk coords for camps that overlap (cx, cy) but whose fire is elsewhere.
     * Generate those first so a satellite chunk cannot stamp a basket without a fire.
     */
    function parentFireChunks(cx, cy, worldSeed, tileKeyAt, cfg) {
        cfg = cfg || getConfig();
        const insts = instancesOverlappingChunk(cx, cy, worldSeed, tileKeyAt, cfg);
        const out = [];
        const seen = new Set();
        for (const inst of insts) {
            const f = fireChunkOf(inst);
            if (f.cx === cx && f.cy === cy) continue;
            const k = `${f.cx},${f.cy}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(f);
        }
        return out;
    }

    /**
     * Stamp overlapping structures into a generated chunk (after natural decor).
     * The chunk that owns the fire is authoritative: satellites only stamp if that
     * fire already exists (or is being stamped in this call).
     * @returns {{ yard: Set<string>, footprints: Set<string>, mutated: {cx:number,cy:number}[] }}
     */
    function stampChunk(opts) {
        const yard = new Set();
        const footprints = new Set();
        const mutated = [];
        const cfg = opts?.config || getConfig(opts?.scene);
        if (!cfg) return { yard, footprints, mutated };
        const cx = opts.cx | 0;
        const cy = opts.cy | 0;
        const worldSeed = (opts.worldSeed || 0) >>> 0;
        const rawKeyAt = opts.tileKeyAt;
        const getGeneratedChunk = opts.getGeneratedChunk;
        const onChunkMutated = opts.onChunkMutated;
        const keyCache = new Map();
        const tileKeyAt = typeof rawKeyAt === "function"
            ? (tx, ty) => {
                const k = `${tx},${ty}`;
                if (keyCache.has(k)) return keyCache.get(k);
                const v = rawKeyAt(tx, ty);
                keyCache.set(k, v);
                return v;
            }
            : rawKeyAt;
        const chunk = {
            cx,
            cy,
            tileSize: opts.tileSize || TS,
            things: opts.things,
            lootableThings: opts.lootableThings
        };

        const markYard = (inst) => {
            for (let ty = inst.minTy; ty <= inst.maxTy; ty++) {
                for (let tx = inst.minTx; tx <= inst.maxTx; tx++) {
                    if (inChunk(tx, ty, cx, cy)) yard.add(keyOf(tx, ty));
                }
            }
            for (const t of inst.footprints) {
                if (inChunk(t.tx, t.ty, cx, cy)) footprints.add(keyOf(t.tx, t.ty));
            }
        };

        const applyHere = (inst) => {
            applyInstance(inst, chunk, worldSeed, cfg, tileKeyAt);
            markYard(inst);
        };

        const neighborKeyAt = (n) => (tx, ty) => {
            if (n?.tiles) {
                const lx = tx - n.cx * CS;
                const ly = ty - n.cy * CS;
                if (lx >= 0 && ly >= 0 && lx < CS && ly < CS) return n.tiles[lx + ly * CS];
            }
            return tileKeyAt(tx, ty);
        };

        const applyRemote = (n, inst) => {
            if (!n || (n.cx === cx && n.cy === cy)) return;
            applyInstance(
                inst,
                {
                    cx: n.cx,
                    cy: n.cy,
                    tileSize: n.tileSize || TS,
                    things: n.things,
                    lootableThings: n.lootableThings
                },
                worldSeed,
                cfg,
                neighborKeyAt(n)
            );
            mutated.push({ cx: n.cx, cy: n.cy });
            onChunkMutated?.(n.cx, n.cy);
        };

        for (const inst of takePending(worldSeed, cx, cy)) applyHere(inst);

        const insts = instancesOverlappingChunk(cx, cy, worldSeed, tileKeyAt, cfg);
        for (const inst of insts) {
            const fire = fireChunkOf(inst);
            if (fire.cx === cx && fire.cy === cy) {
                applyHere(inst);
                for (const remote of remoteChunksOf(inst, cx, cy)) {
                    const n = getGeneratedChunk?.(remote.cx, remote.cy);
                    if (n) applyRemote(n, inst);
                    else enqueuePending(worldSeed, remote.cx, remote.cy, inst);
                }
                continue;
            }
            if (chunkHasCampfire(getGeneratedChunk?.(fire.cx, fire.cy))) applyHere(inst);
        }
        return { yard, footprints, mutated };
    }

    return {
        CS,
        TS,
        loadConfig,
        getConfig,
        typesInOrder,
        typeById,
        resolveTypeCell,
        instancesOverlappingChunk,
        stampChunk,
        parentFireChunks,
        clearPending,
        chunkOf,
        isPlaceLand,
        isWalkLand,
        isYardEdit
    };
});
