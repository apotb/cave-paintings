const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");

const Phaser = { Math: { Clamp: (v, a, b) => Math.min(b, Math.max(a, v)) } };
const Stone = require("../shared/stone");
const context = { Phaser, Stone };
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(require.resolve("../js/Knapping.js"), "utf8") + "\nthis.Knapping = Knapping;\n",
    context
);
const Knapping = context.Knapping;

function gridFrom(cells) {
    const g = Knapping.emptyGrid();
    for (const [x, y] of cells) g[y][x] = true;
    return g;
}

/** Even bar, 2 cells thick. dir 0 = upright, 1 = diagonal staircase. */
function bar(len, dir) {
    const cells = [];
    for (let i = 0; i < len; i++) {
        if (dir) {
            cells.push([i, i], [i, i + 1]);
        } else {
            cells.push([i, 4], [i, 5]);
        }
    }
    return gridFrom(cells);
}

test("upright thin bar is a spear tip", () => {
    const r = Knapping.classify(bar(12, 0));
    assert.equal(r.toolClass, "spear_tip");
});

test("diagonal thin bar is a spear tip", () => {
    const r = Knapping.classify(bar(12, 1));
    assert.equal(r.toolClass, "spear_tip");
});

test("short diagonal spear from the knapping well is a spear tip", () => {
    const rows = [
        "................",
        "................",
        "................",
        "................",
        "..........##....",
        ".........###....",
        ".......#####....",
        "......#####.....",
        ".....#####......",
        "......##........",
        "......#.........",
        "................",
        "................",
        "................",
        "................",
        "................"
    ];
    const g = Knapping.emptyGrid();
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) g[y][x] = rows[y][x] === "#";
    }
    assert.equal(Knapping.classify(g).toolClass, "spear_tip");
});

test("filled block is not read as a spear tip", () => {
    const cells = [];
    for (let y = 2; y < 10; y++) {
        for (let x = 2; x < 10; x++) cells.push([x, y]);
    }
    const r = Knapping.classify(gridFrom(cells));
    assert.notEqual(r.toolClass, "spear_tip");
    assert.ok(r.elong < 2.15);
});

/** Fat oval: symmetric, edged, thick enough not to be a flake. */
function biface() {
    const cells = [];
    const cx = 7.5;
    const cy = 7.5;
    for (let y = 2; y <= 13; y++) {
        for (let x = 3; x <= 12; x++) {
            const dx = (x - cx) / 4.2;
            const dy = (y - cy) / 5.4;
            if (dx * dx + dy * dy <= 1) cells.push([x, y]);
        }
    }
    return gridFrom(cells);
}

test("symmetric flint biface is a hand-axe", () => {
    const r = Knapping.classify(biface(), "flint");
    assert.equal(r.toolClass, "hand_axe", JSON.stringify({
        toolClass: r.toolClass,
        mass: r.mass,
        elong: r.elong,
        taper: r.taper,
        tip: r.tip,
        edge: r.edge,
        thickness: r.thickness,
        fill: r.fill,
        fork: r.fork,
        preview: r.preview
    }));
    assert.match(r.preview, /hand-axe/);
    assert.match(r.name, /Flint Hand-axe/);
    const stack = Knapping.makeToolStack(r);
    assert.equal(stack.id, "stone_tool");
    assert.equal(stack.knapMaterial, "flint");
    assert.equal(stack.toolClass, "hand_axe");
});

/** 10×12 block. Bigger than a real blank; still a cleaver, and a hand-axe if locked. */
function straightBit() {
    const cells = [];
    for (let y = 2; y <= 13; y++) {
        for (let x = 3; x <= 12; x++) cells.push([x, y]);
    }
    return gridFrom(cells);
}

/** Largest solid block inside the flint sprite (7×6). */
function flintBlock() {
    const cells = [];
    for (let y = 4; y <= 9; y++) {
        for (let x = 6; x <= 12; x++) cells.push([x, y]);
    }
    return gridFrom(cells);
}

/** Largest solid block inside a filled pebble (9×4). */
function pebbleBlock() {
    const cells = [];
    for (let y = 9; y <= 12; y++) {
        for (let x = 3; x <= 11; x++) cells.push([x, y]);
    }
    return gridFrom(cells);
}

test("straight flint bit is a cleaver", () => {
    const r = Knapping.classify(flintBlock(), "flint");
    assert.equal(r.toolClass, "cleaver", JSON.stringify({
        toolClass: r.toolClass,
        bit: r.bit,
        tip: r.tip,
        thickness: r.thickness,
        preview: r.preview
    }));
    assert.match(r.preview, /cleaver/);
    assert.match(r.name, /Flint Cleaver/);
    const meta = Knapping.weaponMetaFromStack(
        { id: "stone_tool", name: "tool" },
        { toolClass: "cleaver", knapQuality: "rough", knapMaterial: "flint" }
    );
    assert.equal(meta.weapon.attacks.length, 1);
    assert.equal(meta.weapon.attacks[0].id, "knap_cleaver_chop");
    assert.equal(meta.weapon.attacks[0].type, "sharp");
    assert.equal(meta.weapon.attacks[0].cooldown, 2.4);
    assert.equal(meta.weapon.attacks[0].damage, Math.round(9 * 1.4 * 0.95 * 10) / 10);
});

test("a flint-sized flat block is a cleaver", () => {
    const r = Knapping.classify(flintBlock(), "flint");
    assert.equal(r.toolClass, "cleaver", JSON.stringify({
        toolClass: r.toolClass, mass: r.mass, elong: r.elong, bit: r.bit, preview: r.preview
    }));
});

test("a pebble-sized flat block is a cleaver", () => {
    const r = Knapping.classify(pebbleBlock(), "flint");
    assert.equal(r.toolClass, "cleaver", JSON.stringify({
        toolClass: r.toolClass, mass: r.mass, elong: r.elong, bit: r.bit, preview: r.preview
    }));
});

test("a flint-sized block stays a scraper when cleaver is locked", () => {
    const unlocked = {
        knife: true, scraper: true, chopper: true, awl: true, spear_tip: true,
        hand_axe: true, cleaver: false
    };
    const r = Knapping.classify(flintBlock(), "flint", unlocked);
    assert.equal(r.toolClass, "scraper");
    assert.equal(/cleaver/i.test(r.preview), false);
});

test("diorite straight bit is a cleaver", () => {
    const r = Knapping.classify(flintBlock(), "diorite");
    assert.equal(r.toolClass, "cleaver");
    assert.match(r.name, /Diorite Cleaver/);
});

test("a soft flint-sized block is still a scraper", () => {
    const r = Knapping.classify(flintBlock(), "pebble");
    assert.equal(r.toolClass, "scraper");
    assert.equal(r.reject, null);
    assert.equal(/cleaver/i.test(r.preview), false);
});

test("a brittle flint-sized block is still a scraper", () => {
    const r = Knapping.classify(flintBlock(), "granite");
    assert.equal(r.toolClass, "scraper");
    assert.equal(r.reject, null);
    assert.equal(/cleaver/i.test(r.preview), false);
});

/** 6×13 bar. A cleaver, and too long and wide for a spear, knife, or scraper. */
function loneCleaver() {
    const cells = [];
    for (let y = 1; y <= 13; y++) {
        for (let x = 1; x <= 6; x++) cells.push([x, y]);
    }
    return gridFrom(cells);
}

test("a long flint bar is a cleaver", () => {
    const r = Knapping.classify(loneCleaver(), "flint");
    assert.equal(r.toolClass, "cleaver", JSON.stringify({
        toolClass: r.toolClass, mass: r.mass, elong: r.elong, bit: r.bit, preview: r.preview
    }));
});

test("the same long bar in pebble is a chopper that is too soft for a cleaver", () => {
    const r = Knapping.classify(loneCleaver(), "pebble");
    assert.equal(r.toolClass, "chopper");
    assert.equal(r.preview, "Too soft for a cleaver");
});

test("a brittle long bar names the cleaver", () => {
    const r = Knapping.classify(loneCleaver(), "granite");
    assert.equal(r.toolClass, "chopper");
    assert.equal(r.preview, "Too brittle for a cleaver");
});

test("a locked cleaver technique stays a hand-axe", () => {
    const unlocked = {
        knife: true, scraper: true, chopper: true, awl: true, spear_tip: true,
        hand_axe: true, cleaver: false
    };
    const r = Knapping.classify(straightBit(), "flint", unlocked);
    assert.equal(r.toolClass, "hand_axe");
    assert.equal(r.reject, null);
    assert.match(r.preview, /hand-axe/);
    assert.equal(/cleaver/i.test(r.preview), false);
});

test("the same biface in pebble is a chopper that is too soft", () => {
    const r = Knapping.classify(biface(), "pebble");
    assert.equal(r.toolClass, "chopper");
    assert.equal(r.preview, "Too soft for a hand-axe");
    assert.match(r.name, /Andesite Chopper/);
});

test("a locked hand-axe technique stays a chopper with no mention of it", () => {
    const unlocked = {
        knife: true, scraper: true, chopper: true, awl: true, spear_tip: true, hand_axe: false
    };
    const r = Knapping.classify(biface(), "flint", unlocked);
    assert.equal(r.toolClass, "chopper");
    assert.equal(r.reject, null);
    assert.match(r.preview, /chopper/);
});

test("a lumpy core stays a chopper", () => {
    const cells = [];
    for (let y = 3; y <= 12; y++) {
        for (let x = 4; x <= 11; x++) cells.push([x, y]);
    }
    for (let y = 3; y <= 8; y++) {
        for (let x = 4; x <= 6; x++) {
            const i = cells.findIndex((c) => c[0] === x && c[1] === y);
            if (i >= 0) cells.splice(i, 1);
        }
    }
    const r = Knapping.classify(gridFrom(cells), "flint");
    assert.equal(r.toolClass, "chopper");
    assert.match(r.preview, /chopper/);
});

test("flint_tool rewrites to a flint stone_tool", () => {
    const Hide = require("../shared/hide");
    const stack = { id: "flint_tool", toolClass: "chopper" };
    Hide.migrateStackItemId(stack);
    assert.equal(stack.id, "stone_tool");
    assert.equal(stack.knapMaterial, "flint");
    const spear = { id: "flint_spear" };
    Hide.migrateStackItemId(spear);
    assert.equal(spear.id, "stone_spear");
    assert.equal(spear.knapMaterial, "flint");
});

test("a spear with no rock keeps the Stone Spear name", () => {
    const Stone = require("../shared/stone");
    assert.equal(Stone.displayName({ id: "stone_spear" }), null);
    assert.equal(Stone.displayName({ id: "stone_spear", knapMaterial: "pebble" }), "Andesite Spear");
    assert.equal(Stone.displayName({ id: "stone_spear", knapMaterial: "flint" }), "Flint Spear");
});

test("weapon damage and spear stab follow the rock", () => {
    const Stone = require("../shared/stone");
    const chopper = Stone.toolDamage({
        toolClass: "chopper",
        knapQuality: "rough",
        knapMaterial: "flint"
    });
    const axe = Stone.toolDamage({
        toolClass: "hand_axe",
        knapQuality: "rough",
        knapMaterial: "flint"
    });
    assert.equal(chopper, Math.round(9 * 1.4 * 0.95 * 10) / 10);
    assert.equal(axe, Math.round(12 * 1.4 * 0.95 * 10) / 10);
    const spear = Stone.spearDamage(
        { id: "stone_spear", knapMaterial: "flint", knapQuality: "rough" },
        { weapon: { attacks: [{ id: "point_stab", damage: 11 }, { id: "shaft_poke", damage: 4 }] } }
    );
    assert.equal(spear, Math.round(11 * 1.4 * 0.95 * 10) / 10);
    assert.equal(Stone.props("pebble").hardness, 5);
    assert.equal(Stone.props("flint").toughness, 0.6);
    assert.equal(Stone.handAxeGate("pebble"), "soft");
    assert.equal(Stone.handAxeGate("flint"), null);
    assert.deepEqual(Stone.requirementStatus("hand_axe", "pebble"), [
        { stat: "hardness", min: 6, met: false, label: "Hardness ≥ 6" },
        { stat: "toughness", min: 0.5, met: false, label: "Toughness ≥ 50%" }
    ]);
    assert.deepEqual(Stone.requirementStatus("hand_axe", "flint").map((r) => r.met), [true, true]);
    assert.deepEqual(Stone.requirementStatus("cleaver", "pebble"), [
        { stat: "hardness", min: 6, met: false, label: "Hardness ≥ 6" },
        { stat: "toughness", min: 0.5, met: false, label: "Toughness ≥ 50%" }
    ]);
    assert.deepEqual(Stone.requirementStatus("cleaver", "flint").map((r) => r.met), [true, true]);
    assert.equal(Stone.toolDamage({
        toolClass: "cleaver",
        knapQuality: "rough",
        knapMaterial: "flint"
    }), Math.round(9 * 1.4 * 0.95 * 10) / 10);
    assert.deepEqual(Stone.requirementStatus("knife", "pebble"), []);
    assert.equal(Stone.handAxeGate("flint", () => ({
        knapping: { hardness: 7, toughness: 0.2, tipColor: "#111111" }
    })), "brittle");
    assert.equal(Knapping.previewLine("chopper", "rough", "brittle"), "Too brittle for a hand-axe");
    assert.deepEqual(Stone.statLines({
        knapping: { hardness: 5, toughness: 0.4 }
    }), ["Hardness: 5", "Toughness: 40%"]);
    assert.deepEqual(Stone.statLinesFor(
        { id: "stone_tool", toolClass: "chopper", knapMaterial: "flint" },
        { id: "stone_tool" }
    ), []);
    assert.deepEqual(Stone.statLinesFor(
        { id: "stone_spear", knapMaterial: "flint" },
        { id: "stone_spear" }
    ), []);
    assert.deepEqual(Stone.statLinesFor(
        { id: "pebble" },
        { id: "pebble", knapping: { hardness: 5, toughness: 0.4 } }
    ), ["Hardness: 5", "Toughness: 40%"]);
});

function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function fullBlank() {
    const g = Knapping.emptyGrid();
    for (let y = 0; y < Knapping.SIZE; y++) {
        for (let x = 0; x < Knapping.SIZE; x++) g[y][x] = true;
    }
    return g;
}

/** Today's bite, before toughness scaling: 78% one, 19% two, 3% three or four. */
function legacyBite(rng) {
    const roll = rng();
    if (roll >= 0.97) return 3 + Math.floor(rng() * 2);
    if (roll >= 0.78) return 2;
    return 1;
}

test("andesite chip sizes match today's roll, and limestone flakes bigger than flint", () => {
    const n = 2000;
    const seed0 = 0x51e7;
    const andesite = Stone.props("andesite").toughness;
    const limestone = Stone.props("limestone").toughness;
    const flint = Stone.props("flint").toughness;
    let limeBig = 0;
    let flintBig = 0;
    const buckets = { 1: 0, 2: 0, big: 0 };

    for (let i = 0; i < n; i++) {
        const seed = (seed0 + i) >>> 0;
        const expected = legacyBite(mulberry32(seed));
        const blank = Knapping.chip(fullBlank(), 0, 0, mulberry32(seed));
        const named = Knapping.chip(fullBlank(), 0, 0, mulberry32(seed), andesite);
        assert.equal(blank.removed, expected);
        assert.equal(named.removed, expected);
        assert.ok(blank.removed >= 1 && blank.removed <= 4);
        if (expected === 1) buckets[1]++;
        else if (expected === 2) buckets[2]++;
        else buckets.big++;

        const soft = Knapping.chip(fullBlank(), 0, 0, mulberry32(seed), limestone);
        const hard = Knapping.chip(fullBlank(), 0, 0, mulberry32(seed), flint);
        assert.ok(soft.removed <= 4 && hard.removed <= 4);
        if (soft.removed >= 3) limeBig++;
        if (hard.removed >= 3) flintBig++;
    }

    assert.equal(buckets[1] + buckets[2] + buckets.big, n);
    assert.ok(limeBig > flintBig);
});

test("settler silhouettes classify as that exact class", () => {
    const KnapShapes = require("../shared/knapShapes");
    const unlocked = {
        knife: true, scraper: true, chopper: true, awl: true,
        spear_tip: true, hand_axe: true, cleaver: true
    };
    for (const cls of Object.keys(KnapShapes.SHAPES)) {
        const material = cls === "hand_axe" || cls === "cleaver" ? "flint" : "pebble";
        const got = Knapping.classify(KnapShapes.grid(cls), material, unlocked);
        assert.equal(got.toolClass, cls, cls);
        assert.equal(got.reject, null, cls);
    }
});
