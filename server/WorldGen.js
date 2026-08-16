/**
 * Server-side terrain gen matching js/World.js (perlin elevation / temperature / river).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { mulberry32, hash2D } = require("../shared/rng");
const Structures = require("../shared/structures");

const NOISE_SCALE = 6000;
const CS = 8;
const TS = 16;
const CHUNK_PX = CS * TS;

let _noise = null;
function noiseApi() {
    if (_noise) return _noise;
    const code = fs.readFileSync(
        path.join(__dirname, "..", "js", "noisejs-master", "perlin.js"),
        "utf8"
    );
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    _noise = sandbox.noise;
    if (!_noise) throw new Error("Failed to load perlin noise module");
    return _noise;
}

function octaveNoise2D(x, y, octaves = 1, persistence = 1.0, lacunarity = 1.0, seed = 0) {
    const noise = noiseApi();
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    const rand = mulberry32(seed);
    x += rand() * 1337;
    y += rand() * 1337;
    for (let i = 0; i < octaves; i++) {
        total += noise.perlin2(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    return total / maxValue;
}

/** Pick a world seed where origin is a valid plains-ish spawn (same loop as World.js). */
function pickWorldSeed(start = Date.now()) {
    noiseApi();
    let worldSeed = start;
    for (let i = 0; i < 50000; i++) {
        noiseApi().seed(worldSeed);
        const elevation = octaveNoise2D(0, 0, 2, 0.5, 2.5, 0);
        const river = Math.abs(octaveNoise2D(0, 0, 3, 1.2, 0.7, 2));
        if (elevation > -0.2 && elevation < 0.25 && river > 0.005) return worldSeed;
        worldSeed++;
    }
    return start;
}

function applySeed(seed) {
    noiseApi().seed(seed);
}

function generateTileKey(tx, ty, rand) {
    const inv = 1 / NOISE_SCALE;
    const nx = tx * inv;
    const ny = ty * inv;
    const elevation = octaveNoise2D(nx, ny, 2, 0.5, 2.5, 0);
    const temperature = octaveNoise2D(nx, ny, 3, 0.2, 4.2, 1);
    const river = Math.abs(octaveNoise2D(nx, ny, 3, 1.2, 0.7, 2));
    const randValue = rand();

    if (river < 0.005) return { key: "water", things: [], loot: [] };
    if (elevation < -0.2) {
        return { key: temperature < -0.4 ? "ice" : "water", things: [], loot: [] };
    }
    if (river < 0.0065 && elevation < 0.14) {
        const loot = [];
        if (randValue < 0.03) loot.push("flint");
        return { key: "gravel", things: [], loot };
    }
    if (elevation < -0.19) {
        if (river < 0.005) return { key: "water", things: [], loot: [] };
        if (river < 0.0065) {
            const loot = [];
            if (randValue < 0.03) loot.push("flint");
            return { key: "gravel", things: [], loot };
        }
        if (temperature < -0.25) return { key: "snow_beach", things: [], loot: [] };
        const things = [];
        const loot = [];
        if (randValue < 0.05) things.push("palm_tree");
        else if (randValue < 0.065) loot.push("coconut_tree");
        else if (randValue < 0.07) loot.push("sticks");
        return { key: "sand", things, loot };
    }
    if (elevation < 0.15) {
        if (temperature < -0.25) {
            const things = [];
            const loot = [];
            if (randValue < 0.1) things.push("snow_tree");
            else if (randValue < 0.12) loot.push("sticks");
            else if (randValue < 0.14) things.push("snow_bush");
            else if (randValue < 0.145) things.push("rock");
            return { key: "snow", things, loot };
        }
        if (temperature < 0.25) {
            const things = [];
            const loot = [];
            if (randValue < 0.1) things.push("tree");
            else if (randValue < 0.15) things.push("bush");
            else if (randValue < 0.18) loot.push("sticks");
            else if (randValue < 0.185) things.push("rock");
            else if (randValue < 0.19) loot.push("blueberry_bush");
            else if (randValue < 0.21) loot.push("leaves");
            else if (randValue < 0.212) loot.push("apple_tree");
            return { key: "grass", things, loot };
        }
        const things = [];
        const loot = [];
        if (randValue < 0.05) things.push("cactus");
        else if (randValue < 0.055) loot.push("flowering_cactus");
        else if (randValue < 0.056) things.push("rock");
        return { key: "sand", things, loot };
    }
    if (elevation < 0.25) {
        const things = [];
        const loot = [];
        if (randValue < 0.07) things.push("rock");
        if (temperature < -0.25) {
            if (randValue >= 0.07) {
                if (randValue < 0.13) things.push("snow_tree");
                else if (randValue < 0.14) loot.push("sticks");
                else if (randValue < 0.144) loot.push("pebbles");
                else if (randValue < 0.1455) loot.push("flint");
            }
            return { key: "snow_hill", things, loot };
        }
        if (temperature < 0.25) {
            if (randValue >= 0.07) {
                if (randValue < 0.15) things.push("tree");
                else if (randValue < 0.165) loot.push("sticks");
                else if (randValue < 0.175) loot.push("leaves");
                else if (randValue < 0.205) things.push("bush");
                else if (randValue < 0.2075) loot.push("blueberry_bush");
                else if (randValue < 0.211) loot.push("pebbles");
                else if (randValue < 0.2125) loot.push("flint");
            }
            return { key: "grass_hill", things, loot };
        }
        if (randValue >= 0.07 && randValue < 0.12) loot.push("cactus");
        else if (randValue >= 0.12 && randValue < 0.125) loot.push("flowering_cactus");
        else if (randValue >= 0.125 && randValue < 0.13) loot.push("pebbles");
        else if (randValue >= 0.13 && randValue < 0.1315) loot.push("flint");
        return { key: "sand_hill", things, loot };
    }
    if (elevation < 0.55) {
        let key = "mountain";
        if (temperature < -0.25) key = "snow_mountain";
        else if (temperature >= 0.25) key = "mesa";
        const things = [];
        const loot = [];
        if (randValue < 0.05) things.push("rock");
        else if (randValue < 0.06) loot.push("pebbles");
        else if (randValue < 0.064) loot.push("flint");
        return { key, things, loot };
    }
    if (elevation < 0.7) {
        const loot = [];
        if (randValue < 0.012) loot.push("pebbles");
        else if (randValue < 0.016) loot.push("flint");
        return { key: "mountain", things: [], loot };
    }
    {
        const loot = [];
        if (randValue < 0.012) loot.push("pebbles");
        else if (randValue < 0.016) loot.push("flint");
        return { key: "snow_mountain", things: [], loot };
    }
}

function tileKeyAt(tileIx, tileIy) {
    return generateTileKey(tileIx * TS, tileIy * TS, () => 1).key;
}

function pushDecor(list, tx, ty, id) {
    if (tx === 0 && ty === 0) return;
    const x = tx + TS / 2;
    const y = ty + TS;
    list.push({
        x,
        y,
        id,
        uid: `lt_${Math.round(x)}_${Math.round(y)}_${id}`
    });
}

let _mobSpawnRules = null;
function mobSpawnRules() {
    if (_mobSpawnRules) return _mobSpawnRules;
    const raw = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "data", "Mobs.json"), "utf8")
    );
    _mobSpawnRules = (raw || []).filter((m) => m?.id && m.spawn);
    return _mobSpawnRules;
}

/** Pack wildlife from Mobs.json spawn rules (mirrors js/World.js populateNaturalMobs). */
function populateNaturalMobs(cx, cy, tiles, things, lootableThings, stamped, rand) {
    const rules = mobSpawnRules();
    const mobs = [];
    if (!rules.length) return mobs;

    const blocked = new Set();
    const markBlocked = (entry) => {
        if (!entry) return;
        const chunkOx = cx * CHUNK_PX;
        const chunkOy = cy * CHUNK_PX;
        const lx = Math.round((entry.x - TS / 2 - chunkOx) / TS);
        const ly = Math.round((entry.y - TS - chunkOy) / TS);
        if (lx >= 0 && ly >= 0 && lx < CS && ly < CS) blocked.add(`${lx},${ly}`);
    };
    for (const t of things || []) markBlocked(t);
    for (const t of lootableThings || []) markBlocked(t);

    for (const def of rules) {
        const sp = def.spawn || {};
        const allow = new Set(sp.tiles || []);
        const minCand = Math.max(1, Math.floor(Number(sp.minCandidates) || 4));
        const chance = Number(sp.chunkChance);
        if (!(chance > 0) || !allow.size) continue;

        const candidates = [];
        for (let i = 0; i < CS * CS; i++) {
            if (!allow.has(tiles[i])) continue;
            const lx = i % CS;
            const ly = (i / CS) | 0;
            if (blocked.has(`${lx},${ly}`)) continue;
            const wx = cx * CS + lx;
            const wy = cy * CS + ly;
            if (stamped?.footprints?.has(`${wx},${wy}`)) continue;
            candidates.push({ lx, ly });
        }
        if (candidates.length < minCand) continue;
        if (rand() >= chance) continue;

        let packMin = Math.max(1, Math.floor(Number(sp.packMin) || 1));
        let packMax = Math.max(packMin, Math.floor(Number(sp.packMax) || packMin));
        packMax = Math.min(packMax, candidates.length);
        packMin = Math.min(packMin, packMax);
        const pack = packMin + Math.floor(rand() * (packMax - packMin + 1));
        const packRadius = Math.max(1, Math.floor(Number(sp.packRadius) || 2));

        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const tmp = candidates[i];
            candidates[i] = candidates[j];
            candidates[j] = tmp;
        }
        const picks = [];
        const anchor = candidates[0];
        picks.push(anchor);
        const rest = candidates.slice(1).map((c) => ({
            c,
            d: Math.abs(c.lx - anchor.lx) + Math.abs(c.ly - anchor.ly)
        }));
        rest.sort((a, b) => a.d - b.d || a.c.lx - b.c.lx || a.c.ly - b.c.ly);
        const used = new Set([`${anchor.lx},${anchor.ly}`]);
        for (const e of rest) {
            if (picks.length >= pack) break;
            if (e.d > packRadius) continue;
            picks.push(e.c);
            used.add(`${e.c.lx},${e.c.ly}`);
        }
        for (const e of rest) {
            if (picks.length >= pack) break;
            const k = `${e.c.lx},${e.c.ly}`;
            if (used.has(k)) continue;
            picks.push(e.c);
            used.add(k);
        }

        for (const { lx, ly } of picks) {
            const x = cx * CHUNK_PX + lx * TS;
            const y = cy * CHUNK_PX + ly * TS + TS;
            mobs.push({
                id: def.id,
                x,
                y,
                homeX: x,
                homeY: y
            });
            blocked.add(`${lx},${ly}`);
        }
    }
    return mobs;
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} worldSeed
 */
function generateChunk(cx, cy, worldSeed, opts = {}) {
    applySeed(worldSeed);
    const seed = hash2D(cx, cy, worldSeed);
    const rand = mulberry32(seed);
    const tiles = new Array(CS * CS);
    const things = [];
    const lootableThings = [];
    const drops = [];

    for (let i = 0; i < CS * CS; i++) {
        const lx = i % CS;
        const ly = (i / CS) | 0;
        const tx = cx * CHUNK_PX + lx * TS;
        const ty = cy * CHUNK_PX + ly * TS;
        const { key, things: th, loot } = generateTileKey(tx, ty, rand);
        tiles[i] = key;
        for (const id of th) pushDecor(things, tx, ty, id);
        for (const id of loot) pushDecor(lootableThings, tx, ty, id);
    }

    const getGeneratedChunk = opts.getGeneratedChunk;
    const stamped = Structures.stampChunk({
        cx,
        cy,
        worldSeed,
        tileSize: TS,
        things,
        lootableThings,
        getGeneratedChunk,
        tileKeyAt: (tx, ty) => {
            const pcx = Math.floor(tx / CS);
            const pcy = Math.floor(ty / CS);
            if (pcx === cx && pcy === cy) {
                const lx = tx - cx * CS;
                const ly = ty - cy * CS;
                return tiles[lx + ly * CS];
            }
            const n = getGeneratedChunk?.(pcx, pcy);
            if (n?.tiles) {
                const lx = tx - pcx * CS;
                const ly = ty - pcy * CS;
                if (lx >= 0 && ly >= 0 && lx < CS && ly < CS) return n.tiles[lx + ly * CS];
            }
            return tileKeyAt(tx, ty);
        }
    });

    const mobs = populateNaturalMobs(
        cx, cy, tiles, things, lootableThings, stamped, rand
    );

    return {
        cx,
        cy,
        tiles,
        things,
        lootableThings,
        drops,
        mobs,
        corpses: [],
        bloodStains: [],
        generated: true
    };
}

const BLOCKED = new Set(["water", "ice"]);

module.exports = {
    NOISE_SCALE,
    CS,
    TS,
    CHUNK_PX,
    BLOCKED,
    pickWorldSeed,
    applySeed,
    generateChunk,
    octaveNoise2D,
    tileKeyAt
};
