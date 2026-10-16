const { test } = require("node:test");
const assert = require("node:assert/strict");
const WorldGen = require("../shared/sim/WorldGen");
const { hash2D } = require("../shared/rng");
const DataStore = require("../shared/DataStore");
const Chop = require("../shared/chop");
const Place = require("../shared/place");
const { loadDefs } = require("./helpers/load");
const { createTestWorld, originChunk } = require("./helpers/simWorld");

loadDefs();

const TS = 16;
const CHUNK = 128;

function tileOrigin(entry) {
    return { x: entry.x - TS / 2, y: entry.y - TS };
}

function tileSteps(a, b) {
    const ao = tileOrigin(a);
    const bo = tileOrigin(b);
    return Math.max(Math.abs(ao.x - bo.x), Math.abs(ao.y - bo.y)) / TS;
}

function lists(chunk) {
    return [...(chunk.things || []), ...(chunk.lootableThings || [])];
}

function parentOf(chunks, uid) {
    for (const chunk of chunks) {
        const hit = lists(chunk).find((row) => row && row.uid === uid);
        if (hit) return hit;
    }
    return null;
}

function generateMap(pairs, seed) {
    const store = new Map();
    const getGeneratedChunk = (x, y) => {
        const chunk = store.get(`${x},${y}`);
        if (!chunk?.tiles) return null;
        return {
            cx: chunk.cx,
            cy: chunk.cy,
            tiles: chunk.tiles,
            things: chunk.things,
            lootableThings: chunk.lootableThings,
            yardKeys: chunk.yardKeys
        };
    };
    for (const [x, y] of pairs) {
        store.set(`${x},${y}`, WorldGen.generateChunk(x, y, seed, { getGeneratedChunk }));
    }
    return store;
}

function linkedKeys(store) {
    const out = [];
    for (const chunk of store.values()) {
        for (const entry of chunk.lootableThings || []) {
            if (!entry?.parentUid) continue;
            out.push(`${entry.uid}|${entry.parentUid}|${entry.stone || ""}|${entry.variant || ""}`);
        }
    }
    out.sort();
    return out;
}

test("sticks and leaves only spawn beside a parent, and one parent can have two piles", () => {
    const chunks = [];
    for (let cy = -8; cy <= 8; cy++) {
        for (let cx = -8; cx <= 8; cx++) chunks.push(WorldGen.generateChunk(cx, cy, 42));
    }
    let doubles = 0;
    for (const chunk of chunks) {
        for (const entry of chunk.lootableThings || []) {
            if (entry.id !== "sticks" && entry.id !== "leaves") continue;
            assert.ok(entry.parentUid, `${entry.id} at ${entry.x},${entry.y} has no parent`);
            const parent = parentOf(chunks, entry.parentUid);
            assert.ok(parent, `${entry.id} parent ${entry.parentUid} is missing`);
            const spawns = DataStore.getThing(parent.id)?.spawns || [];
            assert.ok(spawns.some((row) => row.thing === entry.id), `${parent.id} does not spawn ${entry.id}`);
            assert.ok(tileSteps(entry, parent) === 1, `${entry.id} is ${tileSteps(entry, parent)} tiles from ${parent.id}`);
        }
    }
    const counts = new Map();
    for (const chunk of chunks) {
        for (const entry of chunk.lootableThings || []) {
            if (entry.id !== "sticks" || !entry.parentUid) continue;
            counts.set(entry.parentUid, (counts.get(entry.parentUid) || 0) + 1);
        }
    }
    for (const n of counts.values()) if (n >= 2) doubles += 1;
    assert.ok(doubles > 0, "a parent should be able to grow two stick piles");
});

function spawnRoll(nx, ny, originX, originY, salt) {
    return hash2D(nx | 0, ny | 0, hash2D(originX | 0, originY | 0, salt >>> 0)) % 1000;
}

test("leaves keep a tile that sticks also rolled", () => {
    const chunks = [];
    for (let cy = -8; cy <= 8; cy++) {
        for (let cx = -8; cx <= 8; cx++) chunks.push(WorldGen.generateChunk(cx, cy, 42));
    }
    let wins = 0;
    for (const chunk of chunks) {
        for (const parent of lists(chunk)) {
            if (parent.id !== "tree" && parent.id !== "apple_tree") continue;
            const originX = parent.x - TS / 2;
            const originY = parent.y - TS;
            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    if (ox === 0 && oy === 0) continue;
                    const nx = originX + ox * TS;
                    const ny = originY + oy * TS;
                    if (spawnRoll(nx, ny, originX, originY, 7845) >= 50) continue;
                    if (spawnRoll(nx, ny, originX, originY, 22300) >= 75) continue;
                    const pile = chunks.flatMap((row) => row.lootableThings || []).find((entry) =>
                        entry.parentUid === parent.uid
                        && entry.x - TS / 2 === nx
                        && entry.y - TS === ny
                    );
                    if (!pile) continue;
                    assert.equal(pile.id, "leaves");
                    wins += 1;
                }
            }
        }
    }
    assert.ok(wins > 0, "a shared roll should leave a leaf pile");
});

test("edge and corner piles match whichever chunk is generated first", () => {
    const seed = 42;
    let edge = null;
    let corner = null;
    for (let cy = -5; cy <= 5 && (!edge || !corner); cy++) {
        for (let cx = -5; cx <= 5 && (!edge || !corner); cx++) {
            const chunk = WorldGen.generateChunk(cx, cy, seed);
            for (const entry of lists(chunk)) {
                const spawns = DataStore.getThing(entry.id)?.spawns;
                if (!spawns?.length) continue;
                const lx = Math.round((entry.x - TS / 2 - chunk.cx * CHUNK) / TS);
                const ly = Math.round((entry.y - TS - chunk.cy * CHUNK) / TS);
                if (!edge && lx === 7) edge = { cx, cy };
                if (!corner && lx === 7 && ly === 7) corner = { cx, cy };
            }
        }
    }
    assert.ok(edge, "an east-edge parent exists");
    assert.ok(corner, "a corner parent exists");
    const edgeA = generateMap([[edge.cx, edge.cy], [edge.cx + 1, edge.cy]], seed);
    const edgeB = generateMap([[edge.cx + 1, edge.cy], [edge.cx, edge.cy]], seed);
    assert.deepEqual(linkedKeys(edgeA), linkedKeys(edgeB));
    const cornerA = generateMap([[corner.cx, corner.cy], [corner.cx + 1, corner.cy + 1]], seed);
    const cornerB = generateMap([[corner.cx + 1, corner.cy + 1], [corner.cx, corner.cy]], seed);
    assert.deepEqual(linkedKeys(cornerA), linkedKeys(cornerB));
    const spilled = [...edgeA.values()].some((chunk) =>
        (chunk.lootableThings || []).some((entry) => entry.parentUid && chunk.cx === edge.cx + 1)
    );
    assert.ok(spilled, "an east-edge parent places a pile in the next chunk");
});

test("linked sticks regrow while the tree stands and stop after it is felled", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const neighbor = world.chunks.get("1,0");
    chunk.things.push({ id: "tree", uid: "tree1", x: 40, y: 48 });
    chunk.lootableThings.push({ id: "sticks", uid: "live", parentUid: "tree1", x: pawn.x, y: pawn.y });
    world.handleAction(pawn.id, { type: Protocol.Actions.HARVEST, uid: "live" });
    const waiting = chunk.lootableThings.find((entry) => entry.uid === "live");
    assert.equal(waiting.gone, true);
    assert.ok(waiting.regrowAt > world.worldMinuteIndex());

    const felled = createTestWorld();
    const home = originChunk(felled.world);
    const side = felled.world.chunks.get("1,0");
    home.things.push({ id: "tree", uid: "tree2", x: 40, y: 48 });
    side.lootableThings.push({
        id: "sticks",
        uid: "hidden",
        parentUid: "tree2",
        gone: true,
        regrowAt: 10,
        x: 136,
        y: 32
    });
    side.lootableThings.push({ id: "sticks", uid: "showing", parentUid: "tree2", x: 152, y: 32 });
    const tree = home.things[0];
    Chop.fellToStump(tree, DataStore.getThing("tree"));
    felled.world._severSpawnChildren(tree);
    assert.equal(side.lootableThings.some((entry) => entry.uid === "hidden"), false);
    assert.ok(side.lootableThings.some((entry) => entry.uid === "showing"));
    felled.pawn.x = 152;
    felled.pawn.y = 32;
    felled.world.handleAction(felled.pawn.id, { type: Protocol.Actions.HARVEST, uid: "showing" });
    assert.equal(side.lootableThings.some((entry) => entry.uid === "showing"), false);

    const loose = createTestWorld();
    const looseChunk = originChunk(loose.world);
    looseChunk.lootableThings.push({ id: "sticks", uid: "old", x: loose.pawn.x, y: loose.pawn.y });
    loose.world.handleAction(loose.pawn.id, { type: Protocol.Actions.HARVEST, uid: "old" });
    const old = looseChunk.lootableThings.find((entry) => entry.uid === "old");
    assert.equal(old.gone, true);
    assert.ok(old.regrowAt > loose.world.worldMinuteIndex());
});

test("picking fruit keeps a linked pile regrowing", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    chunk.lootableThings.push({ id: "apple_tree", uid: "apple", x: pawn.x, y: pawn.y });
    chunk.lootableThings.push({ id: "sticks", uid: "under", parentUid: "apple", x: pawn.x + 16, y: pawn.y });
    world.handleAction(pawn.id, { type: Protocol.Actions.HARVEST, uid: "apple" });
    assert.equal(chunk.lootableThings.find((entry) => entry.uid === "apple").id, "tree");
    world.handleAction(pawn.id, { type: Protocol.Actions.HARVEST, uid: "under" });
    const pile = chunk.lootableThings.find((entry) => entry.uid === "under");
    assert.equal(pile.gone, true);
    assert.ok(pile.regrowAt > world.worldMinuteIndex());
});

test("a lean-to freezes a waiting pile under either tile", () => {
    const { world } = createTestWorld();
    const chunk = originChunk(world);
    chunk.things.push({ id: "tree", uid: "tree1", x: 8 + 16 * 5, y: 16 + 16 * 5 });
    const now = world.worldMinuteIndex();
    chunk.lootableThings.push({
        id: "sticks",
        uid: "wait",
        parentUid: "tree1",
        gone: true,
        regrowAt: now + 40,
        x: 8 + 16 * 2,
        y: 16 + 16
    });
    chunk.things.push({ id: "lean_to", uid: "bed", x: 8 + 16, y: 16 + 16, tx: 1, ty: 1, rot: 0 });
    world._tickLootableRegrows([chunk]);
    const pile = chunk.lootableThings.find((entry) => entry.uid === "wait");
    assert.equal(pile.gone, true);
    assert.equal(pile.regrowPaused, true);
    assert.ok(pile.regrowLeft > 0);
    chunk.things = chunk.things.filter((entry) => entry.uid !== "bed");
    world._tickLootableRegrows([chunk]);
    assert.equal(pile.regrowPaused, undefined);
    assert.ok(pile.regrowAt > world.worldMinuteIndex());

    pile.gone = true;
    pile.regrowPaused = true;
    pile.regrowLeft = 0;
    delete pile.regrowAt;
    chunk.things.push({ id: "lean_to", uid: "bed", x: 8 + 16, y: 16 + 16, tx: 1, ty: 1, rot: 0 });
    world._tickLootableRegrows([chunk]);
    assert.equal(pile.regrowPaused, true);
    chunk.things = chunk.things.filter((entry) => entry.uid !== "bed");
    world._tickLootableRegrows([chunk]);
    assert.equal(pile.gone, undefined);
    assert.equal(pile.id, "sticks");
});

test("visible piles block placement, and /set on a tree unlinks its hidden piles", () => {
    const getThing = (id) => DataStore.getThing(id);
    assert.equal(Place.canPlaceOnTile({
        tileKey: "grass",
        things: [],
        lootables: [{ id: "sticks", x: 24, y: 32 }],
        tx: 1,
        ty: 1,
        tileSize: 16,
        getThing
    }), false);
    assert.equal(Place.canPlaceOnTile({
        tileKey: "grass",
        things: [],
        lootables: [{ id: "sticks", x: 24, y: 32, gone: true, regrowAt: 5 }],
        tx: 1,
        ty: 1,
        tileSize: 16,
        getThing
    }), true);

    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    chunk.things.push({ id: "tree", uid: "tree1", x: 40, y: 48 });
    chunk.lootableThings.push({
        id: "sticks",
        uid: "hidden",
        parentUid: "tree1",
        gone: true,
        regrowAt: 20,
        x: 56,
        y: 48
    });
    pawn.x = 32;
    pawn.y = 32;
    world.handleAction(pawn.id, { type: Protocol.Actions.COMMAND, text: "/set null" });
    assert.equal(chunk.things.some((entry) => entry.uid === "tree1"), false);
    assert.equal(chunk.lootableThings.some((entry) => entry.uid === "hidden"), false);
});
