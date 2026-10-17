const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTestWorld, originChunk, chunkKey } = require("./helpers/simWorld");
const { loadDefs, DataStore, restoreRng } = require("./helpers/load");
const Settlement = require("../shared/settlement");
const Research = require("../shared/research");
const Place = require("../shared/place");
const Dig = require("../shared/dig");
const Spoil = require("../shared/spoil");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

loadDefs();
test.after(() => restoreRng());

const CS = 8;

function fillTiles(world, key) {
    const n = CS * CS;
    for (const c of world.chunks.values()) c.tiles = Array(n).fill(key);
}

function setTile(world, tx, ty, key) {
    const cx = Math.floor(tx / CS);
    const cy = Math.floor(ty / CS);
    const c = world.chunks.get(chunkKey(cx, cy));
    const lx = tx - cx * CS;
    const ly = ty - cy * CS;
    c.tiles[lx + ly * CS] = key;
}

function qty(slots, id) {
    return (slots || []).reduce((n, s) => n + (s?.id === id ? (s.quantity || 1) : 0), 0);
}

function qtyWorld(pawn, chunk, id) {
    const drops = (chunk?.drops || []).reduce((n, d) => n + (d?.id === id ? (d.quantity || 1) : 0), 0);
    return qty(pawn.inventory, id) + qty(pawn.overflow, id) + drops;
}

function holdPit(pawn, n = 1) {
    pawn.inventory[0] = { id: "storage_pit", quantity: n };
    pawn.hotbarIndex = 0;
}

function placeAt(world, pawn, tx, ty) {
    world.handleAction(pawn.id, { type: "place", tx, ty });
}

function pits(world) {
    return (originChunk(world).things || []).filter((t) => t.id === "storage_pit");
}

function insertPit(world, x, y, opts = {}) {
    const def = world._thingDef("storage_pit");
    const entry = {
        uid: opts.uid || "pit1",
        id: "storage_pit",
        x,
        y,
        digProgress: opts.digProgress ?? 0,
        digTaken: opts.digTaken || 0,
        fillId: opts.fillId || "dirt"
    };
    Place.ensureStorageEntry(entry, def);
    entry.uid = opts.uid || entry.uid;
    if (opts.slots) entry.slots = opts.slots;
    originChunk(world).things.push(entry);
    return entry;
}

function storageAct(world, pawn, entry, op, extra = {}) {
    world.handleAction(pawn.id, {
        type: "storage",
        op,
        uid: entry.uid,
        x: entry.x,
        y: entry.y,
        ...extra
    });
}

function armDigger(world, pawn) {
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    Research.unlock(pawn, "digging");
    pawn.inventory[0] = { id: "digging_stick", quantity: 1, durability: 50 };
    pawn.hotbarIndex = 0;
    return settle;
}

function swing(world, creature) {
    creature.currentAttack = { id: "dig_thrust", def: { id: "dig_thrust" } };
    creature.attackAngle = 0;
    creature._attackDugPatch = false;
    creature._attackWoreHeld = false;
    creature.attackHitSet = new Set();
    world._tryDigFromMelee(creature, null);
}

function digOut(world, pawn, fillId) {
    armDigger(world, pawn);
    const pit = insertPit(world, pawn.x + 8, pawn.y, { fillId, uid: `pit-${fillId}` });
    const creature = world.creatures.get(pawn.id);
    const def = DataStore.getThing("storage_pit");
    let hits = 0;
    while (Dig.stillDiggable(def, pit) && hits < 40) {
        swing(world, creature);
        hits++;
    }
    return { pit, hits, chunk: originChunk(world) };
}

function parkSettler(world, pawn) {
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    const rec = world._settlerFromSnap({
        id: "settler1",
        name: "Parked",
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        inventory: [null, null, null, null, null],
        kc: 1600
    });
    settle.jobs = settle.jobs || {};
    settle.jobs[rec.id] = Settlement.defaultJobs();
    world.settlements.push(settle);
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    return { settle, rec };
}

function workOnce(world, rec) {
    const mob = world._ensureSettlerCreature(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = 280;
    return world._tickSettlerWork(mob, 300);
}

test("storage pit, dirt, and snow are real items and Storage is researchable", () => {
    const pit = DataStore.getItem("storage_pit");
    const thing = DataStore.getThing("storage_pit");
    assert.deepEqual(pit.tooltip, [
        "Preserves food underground",
        "Requires digging to complete"
    ]);
    assert.equal(pit.recipe.stick_frame, 2);
    assert.equal(pit.recipe.stick, 10);
    assert.equal(pit.recipe.leaf_cord, 2);
    const ids = DataStore._store.itemsList.filter(Boolean).map((it) => it.id);
    assert.ok(ids.indexOf("wicker_basket") < ids.indexOf("storage_pit"));
    assert.equal(pit.place.thing, "storage_pit");
    assert.equal(thing.hitboxSize, 0);
    assert.equal(thing.storage.slots, 8);
    assert.equal(thing.storage.spoilScale, 0.5);
    assert.deepEqual(thing.diggable, { health: 1, yield: 25 });
    assert.equal(Dig.isDeposit(thing), false);
    assert.equal(DataStore.getItem("dirt").maxStack, 99);
    assert.equal(DataStore.getItem("dirt").weight, 0.8);
    assert.equal(DataStore.getItem("snow").key, "snow_pile");
    assert.equal(DataStore.getItem("snow").weight, 0.2);
    assert.equal(DataStore.getItem("dirt").storageCategory, "junk");
    assert.equal(DataStore.getItem("snow").storageCategory, "junk");
    assert.equal(Research.techIsWip("storage"), false);
    assert.deepEqual(Research.techById("storage").prereqs, ["digging", "basic_furniture"]);
    assert.deepEqual(Research.techById("storage").unlocks.items, ["storage_pit"]);
    const loads = Place.thingImageLoads(thing).map((s) => s.key);
    assert.ok(loads.includes("storage_pit"));
    assert.ok(loads.includes("hole"));
    const holder = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p" });
    Research.unlockChain(holder, "storage");
    assert.equal(Research.recipeUnlocked("storage_pit", holder), true);
    assert.equal(
        Place.pitBlueprintTooltip(thing, { id: "storage_pit", digProgress: 0 }),
        "Storage Pit (Blueprint)\nRequires digging to complete"
    );
    assert.equal(Place.pitBlueprintTooltip(thing, { id: "storage_pit", digProgress: 1 }), null);
});

test("storage pit places only on grass and snow, and remembers the fill", () => {
    const { world, pawn } = createTestWorld();
    fillTiles(world, "grass");
    const cases = [
        { tx: 2, ty: 1, tile: "sand", ok: false },
        { tx: 3, ty: 2, tile: "gravel", ok: false },
        { tx: 1, ty: 2, tile: "rock", ok: false },
        { tx: 2, ty: 2, tile: "grass", ok: true, fill: "dirt" },
        { tx: 1, ty: 1, tile: "grass_hill", ok: true, fill: "dirt" },
        { tx: 3, ty: 1, tile: "snow", ok: true, fill: "snow" },
        { tx: 1, ty: 3, tile: "snow_hill", ok: true, fill: "snow" }
    ];
    holdPit(pawn, cases.length);
    for (const c of cases) setTile(world, c.tx, c.ty, c.tile);
    for (const c of cases) {
        const before = pawn.inventory[0].quantity;
        placeAt(world, pawn, c.tx, c.ty);
        const after = pawn.inventory[0]?.quantity || 0;
        if (c.ok) assert.equal(after, before - 1, c.tile);
        else assert.equal(after, before, c.tile);
    }
    const placed = pits(world);
    assert.equal(placed.length, 4);
    for (const c of cases.filter((c) => c.ok)) {
        const { x, y } = world._tileCenter(c.tx, c.ty);
        const pit = placed.find((t) => t.x === x && t.y === y);
        assert.ok(pit, c.tile);
        assert.equal(pit.digProgress, 0, c.tile);
        assert.equal(pit.fillId, c.fill, c.tile);
        assert.equal(pit.slots.length, 8, c.tile);
        assert.equal(world.isBlocked(pit.x, pit.y), false, c.tile);
    }
});

test("a grass pit takes 25 thrusts and a snow pit takes 10, both yielding 25", () => {
    for (const fillId of ["dirt", "snow"]) {
        const { world, pawn } = createTestWorld();
        const { pit, hits, chunk } = digOut(world, pawn, fillId);
        const expectHits = fillId === "snow" ? 10 : 25;
        assert.equal(hits, expectHits, fillId);
        assert.equal(pit.gone, undefined, fillId);
        assert.equal(chunk.things.includes(pit), true, fillId);
        assert.equal(pit.digProgress, 1, fillId);
        assert.equal(qty(pawn.inventory, fillId) + qty(pawn.overflow, fillId), 25, fillId);
        assert.equal(qtyWorld(pawn, chunk, fillId === "dirt" ? "snow" : "dirt"), 0, fillId);
        assert.equal(pawn.inventory[0].id, "digging_stick");
        assert.equal(pawn.inventory[0].durability, 50 - expectHits, fillId);
    }
});

test("a settler at strength drops dug clay on the tile", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    Research.unlock(pawn, "digging");
    rec.inventory[0] = { id: "digging_stick", quantity: 1, durability: 50 };
    rec.inventory[1] = { id: "log", quantity: 7 };
    rec.hotbarIndex = 0;
    const creature = world._ensureSettlerCreature(rec);
    const patch = { uid: "clay-heavy", id: "clay_patch", x: rec.x + 8, y: rec.y, digProgress: 0 };
    originChunk(world).things.push(patch);
    swing(world, creature);
    assert.equal(qty(rec.inventory, "clay") + qty(rec.overflow, "clay"), 0);
    const pile = originChunk(world).drops.find((d) => d.id === "clay");
    assert.ok(pile);
    assert.equal(pile.quantity, 1);
    assert.equal(pile.x, patch.x);
    assert.equal(pile.y, patch.y);
});

test("a full inventory drops the dug pile at the pit", () => {
    const { world, pawn } = createTestWorld();
    armDigger(world, pawn);
    for (let i = 1; i < pawn.inventory.length; i++) {
        pawn.inventory[i] = { id: "log", quantity: 99 };
    }
    const pit = insertPit(world, pawn.x + 8, pawn.y, { fillId: "dirt", uid: "full-pit" });
    const creature = world.creatures.get(pawn.id);
    const def = DataStore.getThing("storage_pit");
    let hits = 0;
    while (Dig.stillDiggable(def, pit) && hits < 40) {
        swing(world, creature);
        hits++;
    }
    assert.equal(hits, 25);
    assert.equal(qty(pawn.inventory, "dirt") + qty(pawn.overflow, "dirt"), 0);
    const pile = originChunk(world).drops.find((d) => d.id === "dirt");
    assert.ok(pile);
    assert.equal(pile.quantity, 25);
    assert.equal(pile.x, pit.x);
    assert.equal(pile.y, pit.y);
    assert.equal(originChunk(world).things.includes(pit), true);
});

test("unfinished pit takes nothing and Destroy returns the item for free", () => {
    const { world, pawn } = createTestWorld();
    const pit = insertPit(world, pawn.x, pawn.y, { digProgress: 0, fillId: "dirt", uid: "open-pit" });
    pawn.inventory[1] = { id: "stick", quantity: 2 };
    pawn.inventory[2] = { id: "dirt", quantity: 3 };
    storageAct(world, pawn, pit, "inv_to_slot", { slot: "0", inv: 1, amount: 1 });
    assert.equal(qty(pawn.inventory, "stick"), 2);
    assert.ok((pit.slots || []).every((s) => !s));
    storageAct(world, pawn, pit, "pickup");
    assert.equal(originChunk(world).things.includes(pit), false);
    assert.equal(qty(pawn.inventory, "storage_pit") + qty(pawn.overflow, "storage_pit"), 1);
    assert.equal(qty(pawn.inventory, "dirt"), 3);
});

test("filling a half-dug pit spends the dirt already dug", () => {
    const { world, pawn } = createTestWorld();
    const pit = insertPit(world, pawn.x, pawn.y, {
        digProgress: 0.52, digTaken: 13, fillId: "dirt", uid: "half-pit"
    });
    pawn.inventory[1] = { id: "dirt", quantity: 12 };
    world.drainEvents();
    storageAct(world, pawn, pit, "pickup");
    assert.equal(originChunk(world).things.includes(pit), true);
    assert.ok(world.drainEvents().some((e) => e.kind === "combat_log" && e.text === "Need 13 dirt"));
    pawn.inventory[1].quantity = 13;
    storageAct(world, pawn, pit, "pickup");
    assert.equal(originChunk(world).things.includes(pit), false);
    assert.equal(qty(pawn.inventory, "dirt"), 0);
    assert.equal(qty(pawn.inventory, "storage_pit") + qty(pawn.overflow, "storage_pit"), 1);
});

test("Destroy spends the matching pile only when the finished pit is empty", () => {
    const { world, pawn } = createTestWorld();
    const pit = insertPit(world, pawn.x, pawn.y, { digProgress: 1, digTaken: 25, fillId: "dirt", uid: "done-pit" });
    pit.slots[0] = { id: "apple", quantity: 1 };
    pawn.inventory[0] = { id: "dirt", quantity: 2 };
    storageAct(world, pawn, pit, "pickup");
    assert.equal(originChunk(world).things.includes(pit), true);
    assert.equal(pit.slots[0].id, "apple");
    assert.equal(qty(pawn.inventory, "dirt"), 2);

    pit.slots[0] = null;
    pawn.inventory[0] = null;
    world.drainEvents();
    storageAct(world, pawn, pit, "pickup");
    assert.equal(originChunk(world).things.includes(pit), true);
    const logs = world.drainEvents().filter((e) => e.kind === "combat_log");
    assert.ok(logs.some((e) => e.text === "Need 25 dirt"));

    pawn.inventory[0] = { id: "snow", quantity: 25 };
    world.drainEvents();
    storageAct(world, pawn, pit, "pickup");
    assert.equal(originChunk(world).things.includes(pit), true);
    assert.equal(qty(pawn.inventory, "snow"), 25);
    assert.ok(world.drainEvents().some((e) => e.kind === "combat_log" && e.text === "Need 25 dirt"));

    pawn.inventory[1] = { id: "dirt", quantity: 25 };
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    settle.stationUids = [pit.uid];
    world.settlements.push(settle);
    storageAct(world, pawn, pit, "pickup");
    assert.equal(originChunk(world).things.includes(pit), false);
    assert.equal(qty(pawn.inventory, "dirt"), 0);
    assert.equal(qty(pawn.inventory, "storage_pit") + qty(pawn.overflow, "storage_pit"), 1);
    assert.equal((settle.stationUids || []).includes(pit.uid), false);
});

test("a snow pit will not fill with dirt", () => {
    const { world, pawn } = createTestWorld();
    const pit = insertPit(world, pawn.x, pawn.y, {
        digProgress: 1, digTaken: 25, fillId: "snow", uid: "snow-pit"
    });
    pawn.inventory[0] = { id: "dirt", quantity: 25 };
    world.drainEvents();
    storageAct(world, pawn, pit, "pickup");
    assert.equal(originChunk(world).things.includes(pit), true);
    assert.equal(qty(pawn.inventory, "dirt"), 25);
    assert.ok(world.drainEvents().some((e) => e.kind === "combat_log" && e.text === "Need 25 snow"));
    pawn.inventory[1] = { id: "snow", quantity: 25 };
    storageAct(world, pawn, pit, "pickup");
    assert.equal(originChunk(world).things.includes(pit), false);
    assert.equal(qty(pawn.inventory, "snow"), 0);
    assert.equal(qty(pawn.inventory, "dirt"), 25);
    assert.ok(qty(pawn.inventory, "storage_pit") + qty(pawn.overflow, "storage_pit") >= 1);
});

test("settlers do not dig a storage pit", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    Research.unlock(pawn, "digging");
    rec.inventory[0] = { id: "digging_stick", quantity: 1, durability: 50 };
    rec.hotbarIndex = 0;
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 0, leather: 0, gather: 1, haul: 0, research: 0 };
    settle.stock = Settlement.normalizeStock({ clay: 25, stick: 0, leaf: 0, log: 0 });
    const pit = insertPit(world, rec.x, rec.y, { digProgress: 0, uid: "ignore-pit" });
    for (let i = 0; i < 80; i++) world.tick(50);
    assert.equal(Number(pit.digProgress) || 0, 0);
    assert.equal(originChunk(world).things.includes(pit), true);
    assert.equal(Dig.isDeposit(DataStore.getThing("storage_pit")), false);
});

test("an unfinished pit cannot be added, and a finished pit takes a haul", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    const pit = insertPit(world, rec.x, rec.y, { digProgress: 0, uid: "haul-pit" });
    world.handleAction(pawn.id, {
        type: "settlement",
        op: "addStation",
        settlementId: settle.id,
        uid: pit.uid
    });
    assert.equal((settle.stationUids || []).includes(pit.uid), false);

    settle.stationUids = [pit.uid];
    originChunk(world).drops.push({ uid: "d-early", id: "stick", quantity: 3, x: rec.x, y: rec.y });
    workOnce(world, rec);
    workOnce(world, rec);
    assert.ok((pit.slots || []).every((s) => !s || s.id !== "stick"));

    pit.digProgress = 1;
    world.handleAction(pawn.id, {
        type: "settlement",
        op: "addStation",
        settlementId: settle.id,
        uid: pit.uid
    });
    assert.equal(settle.stationUids.includes(pit.uid), true);

    pit.storageFilter = { priority: "normal", offItems: ["stick"] };
    for (let i = 0; i < 4; i++) workOnce(world, rec);
    assert.ok((pit.slots || []).every((s) => !s || s.id !== "stick"));

    delete pit.storageFilter;
    rec._settlerScan = null;
    for (let i = 0; i < 6; i++) workOnce(world, rec);
    assert.ok((pit.slots || []).every((s) => !s || s.id !== "stick"), "default pit filter leaves the stick");
    assert.equal(originChunk(world).drops.some((d) => d.uid === "d-early"), true);

    pit.storageFilter = { priority: "normal", offCategories: [], offItems: [], onItems: [] };
    rec._settlerScan = null;
    for (let i = 0; i < 6; i++) workOnce(world, rec);
    assert.ok((pit.slots || []).some((s) => s && s.id === "stick"), "Set All still accepts a stick");
    assert.equal(originChunk(world).drops.some((d) => d.uid === "d-early"), false);
});

test("food in a finished pit loses one spoil minute across two world minutes", () => {
    const { world, pawn } = createTestWorld();
    const start = world.worldMinuteIndex();
    const spoilAt = start + 100;
    const pit = insertPit(world, pawn.x, pawn.y, { digProgress: 1, uid: "spoil-pit" });
    const raw = insertPit(world, pawn.x + 16, pawn.y, { digProgress: 0, uid: "raw-pit" });
    const basket = {
        uid: "spoil-basket",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y + 16
    };
    Place.ensureStorageEntry(basket, world._thingDef("wicker_basket"));
    originChunk(world).things.push(basket);
    pit.slots[0] = { id: "apple", quantity: 1, spoilAt };
    raw.slots[0] = { id: "apple", quantity: 1, spoilAt };
    basket.slots[0] = { id: "apple", quantity: 1, spoilAt };
    world._worldMinute();
    world._worldMinute();
    assert.equal(pit.slots[0].id, "apple");
    assert.equal(pit.slots[0].spoilAt, spoilAt + 1);
    assert.equal(raw.slots[0].spoilAt, spoilAt);
    assert.equal(basket.slots[0].spoilAt, spoilAt);
    assert.equal(world.worldMinuteIndex(), start + 2);
});

test("a finished pit's spoil tooltip matches the minutes until the food rots", () => {
    function ticksUntilRot(startOdd) {
        const { world, pawn } = createTestWorld();
        if (startOdd) world.gameMinutes += 1;
        const start = world.worldMinuteIndex();
        assert.equal(start & 1, startOdd ? 1 : 0);
        const left = 4;
        const pit = insertPit(world, pawn.x, pawn.y, {
            digProgress: 1,
            uid: startOdd ? "odd-spoil" : "even-spoil"
        });
        pit.slots[0] = { id: "apple", quantity: 1, spoilAt: start + left };
        const predicted = Spoil.spoilMinutesAtScale(left, 0.5, start);
        let ticks = 0;
        while (pit.slots[0].id === "apple" && ticks < 30) {
            world._worldMinute();
            ticks++;
        }
        assert.equal(pit.slots[0].id, "rot");
        assert.equal(ticks, predicted);
    }
    ticksUntilRot(false);
    ticksUntilRot(true);
});

test("storage slot tooltip stretches spoil time only in a finished pit", () => {
    const src = fs.readFileSync(path.join(__dirname, "../js/scene/craft.js"), "utf8");
    const sandbox = {
        remainingSpoilMinutes: Spoil.remainingSpoilMinutes,
        spoilMinutesAtScale: Spoil.spoilMinutesAtScale,
        spoilDurationMinutes: Spoil.spoilDurationMinutes,
        formatHours(hours) {
            const h = Math.max(0, Math.floor(hours));
            if (h === 0) return "<1h";
            const d = Math.floor(h / 24);
            const remH = h % 24;
            if (d > 0) return `${d}d${remH ? ` ${remH}h` : ""}`;
            return `${remH}h`;
        }
    };
    vm.runInNewContext(src, sandbox);
    const item = { name: "Apple", food: { kc: 80, spoil: 2, satietyRatio: 0.15 } };
    const tip = (now, opts) => sandbox.SceneMainCraft.formatItemTooltip.call({
        worldMinuteIndex: () => now
    }, item, 1, now + 120, { id: "apple", quantity: 1, spoilAt: now + 120 }, opts);

    assert.match(tip(10, null), /Spoils in: 2h/);
    assert.match(tip(10, { spoilScale: 0.5 }), /Spoils in: 4h/);
    assert.match(tip(11, { spoilScale: 0.5 }), /Spoils in: 3h/);
    assert.match(tip(10, { spoilPaused: true, spoilScale: 0.5 }), /Spoils: paused/);

    const def = DataStore.getThing("storage_pit");
    assert.equal(Place.pitSlowsSpoil(def, { id: "storage_pit", digProgress: 1 }), true);
    assert.equal(Place.pitSlowsSpoil(def, { id: "storage_pit", digProgress: 0 }), false);
    assert.equal(Place.pitSlowsSpoil(DataStore.getThing("wicker_basket"), { id: "wicker_basket" }), false);
});

test("a new pit prefers perishable hauls, and an old Normal default is lifted", () => {
    const { world, pawn } = createTestWorld();
    const fresh = insertPit(world, pawn.x, pawn.y, { uid: "prio-pit" });
    assert.equal(fresh.storageFilter.priority, "preferred");

    const prior = insertPit(world, pawn.x + 16, pawn.y, { uid: "old-prio" });
    prior.storageFilter = {
        ...prior.storageFilter,
        priority: "normal",
        offCategories: prior.storageFilter.offCategories.slice(),
        offItems: prior.storageFilter.offItems.slice(),
        onItems: prior.storageFilter.onItems.slice()
    };
    Place.ensureStorageEntry(prior, world._thingDef("storage_pit"));
    assert.equal(prior.storageFilter.priority, "preferred");
});
