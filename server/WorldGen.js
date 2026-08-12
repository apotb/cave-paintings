/**
 * Server-side terrain gen matching js/World.js (perlin elevation / temperature / river).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { mulberry32, hash2D } = require("../shared/rng");

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

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} worldSeed
 */
function generateChunk(cx, cy, worldSeed) {
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

    // Natural deer packs (mirrors Mobs.json deer.spawn roughly)
    const mobs = [];
    const allow = new Set(["grass", "grass_hill"]);
    const candidates = [];
    for (let i = 0; i < CS * CS; i++) {
        if (!allow.has(tiles[i])) continue;
        const lx = i % CS;
        const ly = (i / CS) | 0;
        candidates.push({ lx, ly });
    }
    if (candidates.length >= 4 && rand() < 0.08) {
        const pack = 2 + Math.floor(rand() * 2);
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const t = candidates[i];
            candidates[i] = candidates[j];
            candidates[j] = t;
        }
        for (let n = 0; n < Math.min(pack, candidates.length); n++) {
            const { lx, ly } = candidates[n];
            const x = cx * CHUNK_PX + lx * TS;
            const y = cy * CHUNK_PX + ly * TS + TS;
            mobs.push({
                id: "deer",
                x,
                y,
                homeX: x,
                homeY: y
            });
        }
    }

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
    octaveNoise2D
};
