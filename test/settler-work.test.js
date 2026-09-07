const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTestWorld, originChunk } = require("./helpers/simWorld");
const { loadDefs, restoreRng } = require("./helpers/load");
const Settlement = require("../shared/settlement");
const Place = require("../shared/place");
const Hide = require("../shared/hide");
const Sleep = require("../shared/sleep");
const Chop = require("../shared/chop");
const Fire = require("../shared/fire");
const FuelFilter = require("../shared/fuelFilter");
const Protocol = require("../shared/protocol");
const Party = require("../shared/party");

loadDefs();
test.after(() => restoreRng());

function parkSettler(world, pawn, opts = {}) {
    const x = opts.x ?? pawn.x;
    const y = opts.y ?? pawn.y;
    const settle = Settlement.createSettlement({
        x,
        y,
        ownerId: pawn.id
    });
    const rec = world._settlerFromSnap({
        id: opts.id || "settler1",
        name: "Parked",
        x,
        y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        inventory: opts.inventory || [null, null, null, null, null]
    });
    settle.jobs = settle.jobs || {};
    settle.jobs[rec.id] = Settlement.defaultJobs();
    world.settlements.push(settle);
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    return { settle, rec };
}

function spawnHostileBoar(world, x, y) {
    const entry = world._spawnMobAt("boar", x, y);
    const boar = world.mobs.get(entry.uid);
    assert.ok(boar, "boar should spawn");
    boar.hostile = true;
    if (boar.ai) boar.ai.hostile = true;
    return boar;
}

function addBasket(world, settle, x, y, uid = "basket1") {
    const chunk = originChunk(world);
    const def = world._thingDef("wicker_basket");
    const entry = { uid, id: "wicker_basket", x, y };
    Place.ensureStorageEntry(entry, def);
    entry.uid = uid;
    chunk.things.push(entry);
    if (!settle.stationUids) settle.stationUids = [];
    if (!settle.stationUids.includes(uid)) settle.stationUids.push(uid);
    return entry;
}

function addStation(world, settle, id, x, y, uid) {
    const chunk = originChunk(world);
    const def = world._thingDef(id);
    const entry = { uid, id, x, y, rot: 0 };
    Place.ensureStorageEntry(entry, def);
    entry.uid = uid;
    chunk.things.push(entry);
    if (!settle.stationUids) settle.stationUids = [];
    if (!settle.stationUids.includes(uid)) settle.stationUids.push(uid);
    return entry;
}

/** Snap the settler onto the south interact tile of a 0° skinworking bench. */
function addBenchInFront(world, settle, rec, uid) {
    const ts = 16;
    const tx = Math.floor(Number(rec.x) / ts);
    const ty = Math.floor((Number(rec.y) - 1) / ts);
    rec.x = tx * ts + ts / 2;
    rec.y = ty * ts + ts;
    const c = world._ensureSettlerCreature(rec);
    if (c) {
        c.x = rec.x;
        c.y = rec.y;
    }
    const bench = addStation(world, settle, "skinworking_bench", rec.x, rec.y - ts, uid);
    bench.rot = 0;
    return bench;
}

function addLitFire(world, settle, rec, uid = "fire1") {
    const fire = addStation(world, settle, "campfire", rec.x, rec.y, uid);
    fire.fuel = [{ id: "stick", quantity: 8 }, null];
    fire.cook = null;
    fire.catalyst = { id: "sharp_stick", quantity: 1 };
    fire.simmer = [null, null, null, null];
    fire.cookProgress = 0;
    fire.burnRemaining = 30;
    fire.pitTemp = 400;
    return fire;
}

function workOnce(world, rec) {
    const mob = world._ensureSettlerCreature(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = 280;
    return world._tickSettlerWork(mob, 300);
}

test("public settler snapshot includes Idle so world hover can show it", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    workOnce(world, rec);
    assert.equal(rec._settlerAct, "Idle");
    assert.equal(world._publicSettler(rec).activity, "Idle");
});

test("dedicated settler harvests a lootable in range", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    const chunk = originChunk(world);
    chunk.lootableThings.push({ uid: "lt1", id: "sticks", x: rec.x, y: rec.y });
    workOnce(world, rec);
    assert.ok(
        rec.inventory.some((s) => s && s.id === "stick")
        || chunk.drops.some((d) => d.id === "stick"),
        "settler should harvest sticks"
    );
    assert.match(rec._settlerAct || "", /Gathering/i);
    assert.equal(world._publicSettler(rec).activity, rec._settlerAct);
    const lt = chunk.lootableThings.find((e) => e.uid === "lt1");
    assert.ok(!lt || lt.gone || lt.id !== "sticks" || lt.regrowAt != null);
    const pub = world._publicSettler(rec);
    const recIds = (rec.inventory || []).map((s) => s && s.id);
    assert.deepEqual((pub.inventory || []).map((s) => s && s.id), recIds);
});

test("public settler snapshot includes carried gear", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, {
        inventory: [{ id: "stick", quantity: 2 }, null, null, null, null]
    });
    rec.overflow = [{ id: "apple", quantity: 1 }];
    rec.equipment = {
        head: null,
        torso: { id: "leaf_wrap", quantity: 1 },
        legs: null,
        feet: null,
        back: null,
        waist: []
    };
    rec.hotbarIndex = 0;
    const pub = world._publicSettler(rec);
    assert.equal(pub.kc, rec.kc);
    assert.equal(pub.saturation, rec.saturation);
    assert.equal(pub.stomach, rec.stomach);
    assert.equal(pub.inventory[0]?.id, "stick");
    assert.equal(pub.inventory[0]?.quantity, 2);
    assert.equal(pub.overflow[0]?.id, "apple");
    assert.equal(pub.equipment?.torso?.id, "leaf_wrap");
    assert.equal(pub.hotbarIndex, 0);
});

test("public settler eat channel includes the food id", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, {
        inventory: [{ id: "blueberry", quantity: 4 }, null, null, null, null]
    });
    rec.kc = 200;
    workOnce(world, rec);
    assert.ok(rec.eatChannel, "settler should start eating");
    assert.equal(rec.eatChannel.itemId, "blueberry");
    const ch = world._publicSettler(rec).channel;
    assert.equal(ch?.kind, "eat");
    assert.equal(ch?.itemId, "blueberry");
});

test("dedicated settler stashes cargo into a matching basket", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [{ id: "stick", quantity: 4 }, null, null, null, null]
    });
    const basket = addBasket(world, settle, rec.x, rec.y);
    workOnce(world, rec);
    workOnce(world, rec);
    assert.equal(rec.inventory[0], null);
    assert.ok(
        (basket.slots || []).some((s) => s && s.id === "stick" && s.quantity >= 4),
        "basket should hold the sticks"
    );
    const pub = world._publicSettler(rec);
    assert.ok(
        Array.isArray(pub.inventory),
        "stash dump is an explicit empty inventory array, not omitted gear"
    );
    assert.equal(
        pub.inventory.some((s) => s && s.id),
        false,
        "client must apply this empty snapshot or hover stays full until relog"
    );
});

test("settler snapshot includes gather activity while walking to a plant", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    const chunk = originChunk(world);
    chunk.lootableThings.push({ uid: "lt-far", id: "sticks", x: rec.x + 80, y: rec.y });
    workOnce(world, rec);
    assert.match(rec._settlerAct || "", /Gathering/i);
    assert.notEqual(rec._settlerAct, "Idle");
    assert.equal(world._publicSettler(rec).activity, rec._settlerAct);
});

test("settler movement and channels scale with tick speed", () => {
    const Party = require("../shared/party");
    assert.equal(Party.settlerTimeScale(0), 0);
    assert.equal(Party.settlerTimeScale(8), 8);

    function walkDist(tickSpeed) {
        const { world, pawn } = createTestWorld();
        world.tickSpeed = tickSpeed;
        world.baseTickSpeed = tickSpeed;
        const { rec } = parkSettler(world, pawn);
        rec.kc = 1600;
        const chunk = originChunk(world);
        chunk.lootableThings.push({ uid: "lt-far", id: "sticks", x: rec.x + 160, y: rec.y });
        const x0 = rec.x;
        for (let i = 0; i < 8; i++) world.tick(40);
        return Math.abs(rec.x - x0);
    }

    const d1 = walkDist(1);
    const d8 = walkDist(8);
    assert.ok(d1 > 1, `settler should walk at 1× (moved ${d1})`);
    assert.ok(d8 > d1 * 4, `8× should travel much farther (1×=${d1.toFixed(1)}, 8×=${d8.toFixed(1)})`);
});

test("tick speed 0 freezes settler pose", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    rec.kc = 1600;
    originChunk(world).lootableThings.push({ uid: "lt-far", id: "sticks", x: rec.x + 160, y: rec.y });
    world.tickSpeed = 1;
    world.baseTickSpeed = 1;
    for (let i = 0; i < 4; i++) world.tick(40);
    const x1 = rec.x;
    world.tickSpeed = 0;
    world.baseTickSpeed = 0;
    world.tick(40);
    assert.equal(rec.x, x1);
    assert.equal(rec.vx, 0);
    assert.equal(rec.vy, 0);
});

test("settler eat channel chews faster at high tick speed", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    rec.eatChannel = {
        remaining: 1000,
        max: 1000,
        slot: 0,
        bag: "hotbar",
        fromId: rec.id,
        itemId: "blueberry"
    };
    world.tickSpeed = 8;
    world.baseTickSpeed = 8;
    world.tick(40);
    const elapsed = 1000 - rec.eatChannel.remaining;
    assert.ok(elapsed > 200, `8× eat should chew ~320ms in 40ms wall time (got ${elapsed})`);
});

test("public settler snapshot keeps activity while a chop swing is in progress", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    rec._settlerAct = "Chopping trees";
    rec.attackTimer = 180;
    rec.attackMax = 1000;
    const pub = world._publicSettler(rec);
    assert.equal(pub.attacking, true);
    assert.equal(pub.activity, "Chopping trees");
    assert.ok(pub.attackProgress > 0 && pub.attackProgress < 1);
});

test("dedicated settler chops a nearby tree", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        kc: 1200,
        inventory: [{
            id: "blank",
            quantity: 1,
            toolClass: "chopper",
            knapQuality: "rough",
            knapDamage: 8
        }, null, null, null, null]
    });
    rec.hotbarIndex = 0;
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 1, leather: 0, gather: 0, haul: 0 };
    const chunk = originChunk(world);
    const tree = { uid: "tree-chop", id: "tree", x: rec.x + 40, y: rec.y, chopProgress: 0 };
    chunk.things.push(tree);
    let swung = false;
    let chipped = false;
    for (let i = 0; i < 120; i++) {
        world.tick(50);
        if ((rec.attackTimer || 0) > 0 || rec.creature?.isAttacking?.()) swung = true;
        if ((Number(tree.chopProgress) || 0) > 0) {
            chipped = true;
            break;
        }
    }
    assert.equal(swung, true, "settler should start a chop swing");
    assert.equal(chipped, true, "settler chop should raise tree chopProgress");
    const c = rec.creature?.bodyCenter?.() || { x: rec.x, y: rec.y };
    const d = Math.hypot(c.x - tree.x, c.y - tree.y);
    const want = Chop.standDist(5);
    assert.ok(
        d <= want + 6,
        `settler should stand near the trunk (d=${d.toFixed(1)}, standDist=${want})`
    );
    assert.equal(rec._chopIgnoreUid, "tree-chop");
    const afterX = rec.x;
    const afterY = rec.y;
    for (let i = 0; i < 8; i++) world.tick(50);
    assert.ok(
        Math.hypot(rec.x - afterX, rec.y - afterY) < 6,
        "chopper should stay planted between thrusts"
    );
    const pub = world._publicSettler(rec);
    assert.match(pub.activity || "", /Chopping/i);
});

test("chopper walks around a stump blocking the preferred stand", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        kc: 1200,
        inventory: [{
            id: "blank",
            quantity: 1,
            toolClass: "chopper",
            knapQuality: "rough",
            knapDamage: 8
        }, null, null, null, null]
    });
    rec.hotbarIndex = 0;
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 1, leather: 0, gather: 0, haul: 0 };
    const chunk = originChunk(world);
    const hs = 5;
    const dist = Chop.standDist(hs, 0);
    const tree = { uid: "tree-gap", id: "tree", x: rec.x + 48, y: rec.y, chopProgress: 0 };
    chunk.things.push(tree);
    chunk.things.push({
        uid: "stump-west",
        id: "tree_stump",
        x: tree.x - dist,
        y: tree.y
    });
    let chipped = false;
    let farChopping = 0;
    for (let i = 0; i < 240; i++) {
        world.tick(50);
        if ((Number(tree.chopProgress) || 0) > 0) {
            chipped = true;
            break;
        }
        const c = rec.creature?.bodyCenter?.() || { x: rec.x, y: rec.y };
        const d = Math.hypot(c.x - tree.x, c.y - tree.y);
        if (/Chopping/i.test(rec._settlerAct || "") && d > dist + 18) farChopping++;
    }
    assert.equal(chipped, true, "should chop from another side of the trunk");
    assert.ok(
        farChopping < 24,
        `must not idle in open ground labeled Chopping (farTicks=${farChopping})`
    );
    const body = rec.creature?.bodyCenter?.() || { x: rec.x, y: rec.y };
    const dTree = Math.hypot(body.x - tree.x, body.y - tree.y);
    assert.ok(
        dTree <= dist + 10,
        `chopper should stand on the ring, not in a clearing (d=${dTree.toFixed(1)})`
    );
});

test("dedicated settler finishes chopping before eating", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        kc: 1600,
        inventory: [{
            id: "blank",
            quantity: 1,
            toolClass: "chopper",
            knapQuality: "rough",
            knapDamage: 8
        }, { id: "apple", quantity: 2 }, null, null, null]
    });
    rec.hotbarIndex = 0;
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 1, leather: 0, gather: 0, haul: 0 };
    const chunk = originChunk(world);
    const tree = { uid: "tree-eat", id: "tree", x: rec.x + 40, y: rec.y, chopProgress: 0 };
    chunk.things.push(tree);
    let started = false;
    for (let i = 0; i < 120; i++) {
        world.tick(50);
        if (rec._chopIgnoreUid === "tree-eat") {
            started = true;
            break;
        }
    }
    assert.equal(started, true, "should start chopping");
    rec.kc = 200;
    rec._eatSitting = null;
    rec.eatChannel = null;
    for (let i = 0; i < 40; i++) {
        world.tick(50);
        assert.equal(!!rec.eatChannel, false, "should not eat mid-chop");
        if (tree.id === "tree_stump") break;
        assert.equal(rec._chopIgnoreUid, "tree-eat");
    }
    assert.ok(
        rec._chopIgnoreUid === "tree-eat" || tree.id === "tree_stump",
        "should keep the tree or finish it"
    );
});

test("dedicated settler finishes hauling before going to sleep", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 0, leather: 0, gather: 0, haul: 1 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    const chunk = originChunk(world);
    chunk.drops.push({ uid: "night-haul", id: "stick", quantity: 3, x: rec.x, y: rec.y });
    workOnce(world, rec);
    assert.ok(rec._haulDestUid || rec.inventory.some((s) => s && s.id === "stick"), "should pick up the haul");
    const entry = { uid: "lt-haul", id: "lean_to", x: rec.x + 96, y: rec.y, tx: 8, ty: 2, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 } });
    chunk.things.push(entry);
    world.gameMinutes = 1300;
    rec._settlerScan = null;
    rec._settlerScanMs = 280;
    workOnce(world, rec);
    assert.equal(!!rec._restWalk, false, "should not walk to bed while hauling");
    assert.equal(!!rec._resting, false);
    const inBasket = (basket.slots || []).some((s) => s && s.id === "stick");
    const inInv = rec.inventory.some((s) => s && s.id === "stick");
    assert.ok(inBasket || inInv, "haul should still be in progress or delivered");
    if (!inBasket) workOnce(world, rec);
    assert.ok((basket.slots || []).some((s) => s && s.id === "stick"), "should finish the haul");
    assert.equal(!!rec._resting, false);
    workOnce(world, rec);
    assert.ok(rec._restWalk || rec._resting, "should sleep after the haul");
});

test("dedicated settler stops chopping after the tree is a stump", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, {
        kc: 1200,
        inventory: [{
            id: "blank",
            quantity: 1,
            toolClass: "chopper",
            knapQuality: "rough",
            knapDamage: 8
        }, null, null, null, null]
    });
    rec.hotbarIndex = 0;
    const settle = world.settlements.find((s) => s.id === rec.homeSettlementId);
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 1, leather: 0, gather: 0, haul: 0 };
    const chunk = originChunk(world);
    const tree = { uid: "tree-stump", id: "tree", x: rec.x + 40, y: rec.y, chopProgress: 0.96 };
    chunk.things.push(tree);
    let fell = false;
    for (let i = 0; i < 200; i++) {
        world.tick(50);
        if (tree.id === "tree_stump") {
            fell = true;
            break;
        }
    }
    assert.equal(fell, true, "tree should fall");
    assert.equal(tree.id, "tree_stump");
    for (let i = 0; i < 40; i++) {
        world.tick(50);
        if (!(rec.attackTimer > 0) && !rec.creature?.isAttacking?.()) break;
    }
    let extraSwings = 0;
    for (let i = 0; i < 40; i++) {
        world.tick(50);
        if ((rec.attackTimer || 0) > 0 || rec.creature?.isAttacking?.()) extraSwings++;
    }
    assert.equal(extraSwings, 0, "settler should not keep swinging at the stump");
    assert.notEqual(rec._chopIgnoreUid, "tree-stump");
});

test("dedicated settler does not chop past the log stock target", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, {
        kc: 1200,
        inventory: [{
            id: "blank",
            quantity: 1,
            toolClass: "chopper",
            knapQuality: "rough",
            knapDamage: 8
        }, null, null, null, null]
    });
    rec.hotbarIndex = 0;
    const settle = world.settlements.find((s) => s.id === rec.homeSettlementId);
    settle.stock = Settlement.normalizeStock({ log: 4, stick: 0, leaf: 0 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 1, leather: 0, gather: 0, haul: 0 };
    const fire = addStation(world, settle, "campfire", rec.x + 16, rec.y, "fire-cap");
    Settlement.addBill(settle, fire.uid, {
        recipeId: "roast",
        mode: "forever",
        allowedIds: ["apple"],
        paused: false
    });
    const chunk = originChunk(world);
    chunk.drops.push({ uid: "logpile", id: "log", quantity: 4, x: rec.x, y: rec.y });
    const tree = { uid: "tree-cap", id: "tree", x: rec.x + 40, y: rec.y, chopProgress: 0 };
    chunk.things.push(tree);
    for (let i = 0; i < 60; i++) world.tick(50);
    assert.equal(tree.id, "tree");
    assert.equal(Number(tree.chopProgress) || 0, 0);
});

test("dedicated settler hauls a ground drop into a basket", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    const basket = addBasket(world, settle, rec.x, rec.y);
    const chunk = originChunk(world);
    chunk.drops.push({ uid: "d1", id: "stick", quantity: 3, x: rec.x, y: rec.y });
    workOnce(world, rec);
    if (rec.inventory.some((s) => s && s.id === "stick")) {
        assert.ok(
            (world._publicSettler(rec).inventory || []).some((s) => s && s.id === "stick"),
            "carried haul should be on the public settler snapshot"
        );
    }
    workOnce(world, rec);
    assert.equal(chunk.drops.some((d) => d.uid === "d1"), false);
    const inInv = rec.inventory.some((s) => s && s.id === "stick");
    const inBasket = (basket.slots || []).some((s) => s && s.id === "stick");
    assert.ok(inInv || inBasket, "sticks should leave the ground");
});

test("dedicated settler does not haul when haul is off", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        kc: 1600,
        inventory: [{ id: "stick", quantity: 3 }, null, null, null, null]
    });
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    const chunk = originChunk(world);
    chunk.drops.push({ uid: "d-off", id: "leaf", quantity: 2, x: rec.x, y: rec.y });
    workOnce(world, rec);
    workOnce(world, rec);
    workOnce(world, rec);
    assert.ok(chunk.drops.some((d) => d.uid === "d-off"), "ground drop stays when haul is off");
    assert.ok(rec.inventory.some((s) => s && s.id === "stick"), "carried sticks stay on the settler");
    assert.ok(!(basket.slots || []).some((s) => s && (s.id === "stick" || s.id === "leaf")));
    assert.equal(rec._settlerAct, "Idle");
});

test("dedicated settler loads one roast ingredient, not the whole stack", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        kc: 1600,
        inventory: [{ id: "apple", quantity: 5 }, null, null, null, null]
    });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const fire = addLitFire(world, settle, rec);
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "forever", paused: false });
    workOnce(world, rec);
    workOnce(world, rec);
    assert.equal(fire.cook?.id, "apple");
    assert.equal(fire.cook?.quantity, 1);
    const left = rec.inventory.find((s) => s && s.id === "apple");
    assert.equal(left?.quantity, 4);
});

test("dedicated settler faces the campfire while cooking", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        kc: 1600,
        inventory: [{ id: "apple", quantity: 2 }, null, null, null, null]
    });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const fire = addLitFire(world, settle, rec);
    rec.x = fire.x;
    rec.y = fire.y + 16;
    rec.facing = "down";
    const mob = world._ensureSettlerCreature(rec);
    mob.x = rec.x;
    mob.y = rec.y;
    mob.facing = "down";
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.equal(rec.facing, "up");
    assert.equal(mob.facing, "up");
});

test("dedicated settler walks up to the campfire instead of stopping at interact range", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        kc: 1600,
        inventory: [{ id: "apple", quantity: 2 }, null, null, null, null]
    });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const fire = addLitFire(world, settle, rec);
    rec.x = fire.x;
    rec.y = fire.y + 48;
    const mob = world._ensureSettlerCreature(rec);
    mob.x = rec.x;
    mob.y = rec.y;
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "forever", paused: false });
    const act = workOnce(world, rec);
    assert.ok(act?.walkTo, "should walk closer to the fire");
    const standD = Math.hypot(act.walkTo.x - fire.x, act.walkTo.y - fire.y);
    assert.ok(
        standD <= 24,
        `stand should be next to the fire, dist=${standD.toFixed(1)}`
    );
});

test("dedicated settler faces the drying rack while fleshing", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [
            { id: "pebble", toolClass: "scraper", knapQuality: "rough", quantity: 1 },
            null, null, null, null
        ]
    });
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 0, leather: 1, gather: 0, haul: 0 };
    const rack = addStation(world, settle, "drying_rack", rec.x, rec.y, "rack-face");
    rack.slots[0] = { id: "deer_hide", quantity: 1 };
    rec.x = rack.x;
    rec.y = rack.y + 16;
    rec.facing = "down";
    const mob = world._ensureSettlerCreature(rec);
    mob.x = rec.x;
    mob.y = rec.y;
    mob.facing = "down";
    Settlement.addBill(settle, rack.uid, { recipeId: "flesh_hide", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.equal(rec._workChannel?.kind, "flesh");
    assert.equal(rec.facing, "up");
    assert.equal(mob.facing, "up");
});

function settlerHas(rec, basket, id) {
    const slots = [...(rec.inventory || []), ...(rec.overflow || []), ...(basket?.slots || [])];
    return slots.some((s) => s && s.id === id);
}

test("dedicated settler takes the finished roast and leftover sharp stick", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    const fire = addLitFire(world, settle, rec);
    fire.cook = { id: "roasted_apple", quantity: 1 };
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "until", n: 1, paused: false });
    workOnce(world, rec);
    assert.equal(fire.cook, null);
    assert.equal(fire.catalyst, null);
    assert.equal(settlerHas(rec, basket, "roasted_apple"), true);
    assert.equal(settlerHas(rec, basket, "sharp_stick"), true);
});

test("dedicated settler keeps the roasting stick when more food remains", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        kc: 1600,
        inventory: [{ id: "apple", quantity: 2 }, null, null, null, null]
    });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    const fire = addLitFire(world, settle, rec);
    fire.cook = { id: "roasted_apple", quantity: 1 };
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.equal(settlerHas(rec, basket, "roasted_apple"), true);
    assert.equal(fire.catalyst?.id, "sharp_stick");
});

test("dedicated settler keeps a reserved roasting stick while ingredients are still inbound", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x + 80, rec.y, "food");
    basket.slots[0] = { id: "apple", quantity: 2 };
    const fire = addLitFire(world, settle, rec);
    fire.cook = null;
    fire.catalystReserved = true;
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.equal(fire.catalyst?.id, "sharp_stick");
    assert.equal(fire.catalystReserved, true);
});

test("dedicated settler takes a reserved roasting stick when the roast has no food left", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    const fire = addLitFire(world, settle, rec);
    fire.cook = null;
    fire.catalystReserved = true;
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.equal(fire.catalyst, null);
    assert.equal(fire.catalystReserved, false);
    assert.equal(settlerHas(rec, basket, "sharp_stick"), true);
});

test("dedicated settler does not yank a roasting stick for simmer while food is on the spit", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    basket.slots[0] = { id: "cracked_coconut", quantity: 1 };
    basket.slots[1] = { id: "raw_pork", quantity: 3 };
    const fire = addLitFire(world, settle, rec);
    fire.cook = { id: "apple", quantity: 1 };
    fire.cookProgress = 4;
    fire.catalystReserved = true;
    Settlement.addBill(settle, fire.uid, {
        recipeId: "simmer",
        mode: "forever",
        allowedIds: ["raw_pork"],
        paused: false
    });
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.equal(fire.catalyst?.id, "sharp_stick");
    assert.equal(fire.cook?.id, "apple");
});

test("dedicated settler reserves the roasting stick before hauling roast food", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x + 80, rec.y, "food");
    basket.slots[0] = { id: "apple", quantity: 2 };
    const fire = addLitFire(world, settle, rec);
    fire.cook = null;
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.equal(fire.catalyst?.id, "sharp_stick");
    assert.equal(fire.catalystReserved, true);
    workOnce(world, rec);
    assert.equal(fire.catalyst?.id, "sharp_stick");
});

test("dedicated settler takes leftover sharp stick after the roast bill is done", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    basket.slots[0] = { id: "roasted_apple", quantity: 1 };
    const fire = addLitFire(world, settle, rec);
    fire.cook = null;
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "until", n: 1, paused: false });
    workOnce(world, rec);
    assert.equal(fire.catalyst, null);
    assert.equal(settlerHas(rec, basket, "sharp_stick"), true);
});

test("dedicated settler loads a drying rack from a basket for smoke leather", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    basket.slots[0] = { id: "drying_rack", quantity: 1 };
    basket.slots[1] = { id: "deer_hide_brained", quantity: 1 };
    const fire = addLitFire(world, settle, rec);
    fire.catalyst = null;
    Settlement.addBill(settle, fire.uid, { recipeId: "smoke", mode: "forever", paused: false });
    workOnce(world, rec);
    workOnce(world, rec);
    workOnce(world, rec);
    workOnce(world, rec);
    assert.equal(fire.catalyst?.id, "drying_rack", "should prop a drying rack on the fire");
    assert.equal(fire.cook?.id, "deer_hide_brained");
});

test("dedicated settler smokes brained boar hide even when a roast bill is first", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    basket.slots[0] = { id: "drying_rack", quantity: 1 };
    basket.slots[1] = { id: "boar_hide_brained", quantity: 1 };
    const fire = addLitFire(world, settle, rec);
    fire.catalyst = null;
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "forever", paused: false });
    Settlement.addBill(settle, fire.uid, {
        recipeId: "smoke",
        mode: "forever",
        paused: false,
        allowedIds: ["deer_hide_brained", "boar_hide_brained"]
    });
    for (let i = 0; i < 8; i++) workOnce(world, rec);
    assert.equal(fire.catalyst?.id, "drying_rack");
    assert.equal(fire.cook?.id, "boar_hide_brained");
});

test("dedicated settler takes a drying rack from a basket when the hide is still hanging", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    basket.slots[0] = { id: "drying_rack", quantity: 1 };
    const hangRack = addStation(world, settle, "drying_rack", rec.x + 16, rec.y, "hang-rack");
    hangRack.slots[0] = { id: "deer_hide_brained", quantity: 1 };
    const fire = addLitFire(world, settle, rec);
    fire.catalyst = null;
    Settlement.addBill(settle, fire.uid, { recipeId: "smoke", mode: "forever", paused: false });
    for (let i = 0; i < 8; i++) workOnce(world, rec);
    assert.equal(fire.catalyst?.id, "drying_rack", "should take the spare rack from storage");
    assert.equal(fire.cook?.id, "deer_hide_brained");
    assert.equal(hangRack.slots[0], null);
});

test("dedicated settler does not pick up an empty placed drying rack to smoke leather", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    basket.slots[0] = { id: "deer_hide_brained", quantity: 1 };
    addStation(world, settle, "drying_rack", rec.x, rec.y, "empty-rack");
    const fire = addLitFire(world, settle, rec);
    fire.catalyst = null;
    Settlement.addBill(settle, fire.uid, { recipeId: "smoke", mode: "forever", paused: false });
    for (let i = 0; i < 8; i++) workOnce(world, rec);
    assert.notEqual(fire.catalyst?.id, "drying_rack");
    assert.ok(world._findThingByUid("empty-rack")?.entry);
});

test("dedicated settler loads one simmer ingredient per slot", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        kc: 1600,
        inventory: [{ id: "apple", quantity: 6 }, null, null, null, null]
    });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const fire = addLitFire(world, settle, rec);
    fire.catalyst = { id: "cracked_coconut", quantity: 1 };
    Settlement.addBill(settle, fire.uid, { recipeId: "simmer", mode: "forever", paused: false });
    workOnce(world, rec);
    workOnce(world, rec);
    workOnce(world, rec);
    const filled = (fire.simmer || []).filter((s) => s && s.id === "apple");
    assert.ok(filled.length >= 1, "should load at least one simmer ingredient");
    for (const s of filled) assert.equal(s.quantity, 1);
    const used = filled.length;
    const left = rec.inventory.find((s) => s && s.id === "apple");
    assert.equal(left?.quantity, 6 - used);
});

function simmeringPork(rec, fire) {
    const coconutOn = fire.catalyst?.id === "cracked_coconut";
    const porkInPot = (fire.simmer || []).some((s) => s && s.id === "raw_pork");
    const carrying = [...(rec.inventory || []), ...(rec.overflow || [])].some(
        (s) => s && (s.id === "cracked_coconut" || s.id === "raw_pork")
    );
    return coconutOn || porkInPot || carrying;
}

test("dedicated settler skips a roast bill with no apples and simmers pork", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    basket.slots[0] = { id: "cracked_coconut", quantity: 1 };
    basket.slots[1] = { id: "raw_pork", quantity: 3 };
    const fire = addLitFire(world, settle, rec);
    Settlement.addBill(settle, fire.uid, {
        recipeId: "roast",
        mode: "forever",
        allowedIds: ["apple"],
        paused: false
    });
    Settlement.addBill(settle, fire.uid, {
        recipeId: "simmer",
        mode: "forever",
        allowedIds: ["raw_pork"],
        paused: false
    });
    for (let i = 0; i < 24; i++) workOnce(world, rec);
    assert.notEqual(fire.cook?.id, "raw_pork");
    assert.ok(simmeringPork(rec, fire), "should load coconut or pork for simmer");
});

test("dedicated settler simmers pork instead of roasting it when simmer is queued", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { kc: 1600 });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const basket = addBasket(world, settle, rec.x, rec.y);
    basket.slots[0] = { id: "cracked_coconut", quantity: 1 };
    basket.slots[1] = { id: "raw_pork", quantity: 3 };
    const fire = addLitFire(world, settle, rec);
    Settlement.addBill(settle, fire.uid, { recipeId: "roast", mode: "forever", paused: false });
    Settlement.addBill(settle, fire.uid, {
        recipeId: "simmer",
        mode: "forever",
        allowedIds: ["raw_pork"],
        paused: false
    });
    for (let i = 0; i < 24; i++) workOnce(world, rec);
    assert.notEqual(fire.cook?.id, "raw_pork", "pork should not go on the roasting stick");
    assert.ok(simmeringPork(rec, fire), "should load coconut or pork for simmer");
});

test("dedicated settler hauls forbidden items into a matching basket", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    const apparel = addBasket(world, settle, rec.x, rec.y, "apparel");
    const wood = addBasket(world, settle, rec.x + 8, rec.y, "wood");
    apparel.storageFilter = {
        priority: "normal",
        offCategories: ["materials", "food", "tools", "weapons", "junk", "buildings", "medicine"]
    };
    wood.storageFilter = {
        priority: "normal",
        offCategories: ["apparel", "food", "tools", "weapons", "junk", "buildings", "medicine"]
    };
    apparel.slots[0] = { id: "leaf_wrap", quantity: 1 };
    apparel.slots[1] = { id: "stick", quantity: 5 };
    workOnce(world, rec);
    workOnce(world, rec);
    workOnce(world, rec);
    const sticksInApparel = (apparel.slots || []).some((s) => s && s.id === "stick");
    const sticksInWood = (wood.slots || []).some((s) => s && s.id === "stick");
    const wrapKept = (apparel.slots || []).some((s) => s && s.id === "leaf_wrap")
        || rec.inventory.some((s) => s && s.id === "leaf_wrap");
    assert.equal(sticksInApparel, false, "sticks should leave the apparel basket");
    assert.ok(sticksInWood || rec.inventory.some((s) => s && s.id === "stick"), "sticks should be hauled toward wood storage");
    assert.ok(wrapKept, "clothing should stay allowed in the apparel basket");
});

test("idle settler hauls a late deposit without another job first", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    rec.kc = 1600;
    const apparel = addBasket(world, settle, rec.x, rec.y, "apparel");
    const wood = addBasket(world, settle, rec.x + 8, rec.y, "wood");
    apparel.storageFilter = {
        priority: "normal",
        offCategories: ["materials", "food", "tools", "weapons", "junk", "buildings", "medicine"]
    };
    wood.storageFilter = {
        priority: "normal",
        offCategories: ["apparel", "food", "tools", "weapons", "junk", "buildings", "medicine"]
    };
    workOnce(world, rec);
    assert.equal(rec._settlerAct, "Idle");
    apparel.slots[0] = { id: "leaf_wrap", quantity: 1 };
    apparel.slots[1] = { id: "stick", quantity: 5 };
    world._emitStorage(originChunk(world), apparel);
    const mob = world._ensureSettlerCreature(rec);
    for (let i = 0; i < 8; i++) world._tickSettlerWork(mob, 300);
    const sticksInApparel = (apparel.slots || []).some((s) => s && s.id === "stick");
    const sticksInWood = (wood.slots || []).some((s) => s && s.id === "stick");
    assert.equal(sticksInApparel, false, "sticks should leave the apparel basket");
    assert.ok(
        sticksInWood || rec.inventory.some((s) => s && s.id === "stick")
            || (rec.overflow || []).some((s) => s && s.id === "stick"),
        "sticks should be hauled toward wood storage"
    );
});

test("full-pocket settler stashes then hauls forbidden items", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [
            { id: "pebble", quantity: 1 },
            { id: "flint", quantity: 1 },
            { id: "leaf", quantity: 1 },
            { id: "log", quantity: 1 },
            { id: "apple", quantity: 1 }
        ]
    });
    rec.kc = 1600;
    const apparel = addBasket(world, settle, rec.x, rec.y, "apparel");
    const wood = addBasket(world, settle, rec.x + 8, rec.y, "wood");
    apparel.storageFilter = {
        priority: "normal",
        offCategories: ["materials", "food", "tools", "weapons", "junk", "buildings", "medicine"]
    };
    wood.storageFilter = {
        priority: "normal",
        offCategories: ["apparel", "food", "tools", "weapons", "junk", "buildings", "medicine"]
    };
    apparel.slots[0] = { id: "stick", quantity: 4 };
    for (let i = 0; i < 10; i++) workOnce(world, rec);
    const sticksInApparel = (apparel.slots || []).some((s) => s && s.id === "stick");
    const sticksInWood = (wood.slots || []).some((s) => s && s.id === "stick");
    assert.equal(sticksInApparel, false, "sticks should leave the apparel basket");
    assert.ok(
        sticksInWood || rec.inventory.some((s) => s && s.id === "stick")
            || (rec.overflow || []).some((s) => s && s.id === "stick"),
        "sticks should be hauled toward wood storage"
    );
});

test("dedicated settler does not haul a fleshed hide soaking in water", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    addBasket(world, settle, rec.x, rec.y);
    const chunk = originChunk(world);
    chunk.tiles = Array.from({ length: 64 }, () => "water");
    chunk.drops.push({
        uid: "hide1",
        id: "deer_hide_fleshed",
        quantity: 1,
        x: rec.x,
        y: rec.y
    });
    const fleshed = world._itemDef("deer_hide_fleshed");
    assert.ok(Hide.leaveHaulInWater(fleshed, world._dropIsOnWater(chunk.drops[0])));
    workOnce(world, rec);
    workOnce(world, rec);
    assert.ok(chunk.drops.some((d) => d.uid === "hide1"), "soaking hide stays on the water");
    assert.ok(!rec.inventory.some((s) => s && s.id === "deer_hide_fleshed"));
});

test("dedicated settler fleshes a hang over the scrape channel", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [
            { id: "pebble", toolClass: "scraper", knapQuality: "rough", quantity: 1 },
            null, null, null, null
        ]
    });
    const rack = addStation(world, settle, "drying_rack", rec.x, rec.y, "rack1");
    rack.slots[0] = { id: "deer_hide", quantity: 1 };
    Settlement.addBill(settle, rack.uid, { recipeId: "flesh_hide", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.equal(rack.slots[0]?.id, "deer_hide", "hide stays raw until the channel finishes");
    assert.equal(rec._workChannel?.kind, "flesh");
    assert.match(rec._settlerAct || "", /Flesh/i);
    assert.equal(world._publicSettler(rec).activity, rec._settlerAct);
    const fleshCh = world._publicSettler(rec).channel;
    assert.equal(fleshCh?.kind, "flesh");
    assert.equal(fleshCh?.uid, "rack1");
    world.tick(100);
    assert.equal(rack.slots[0]?.id, "deer_hide");
    world.tick(11000);
    const onRack = rack.slots[0]?.id === "deer_hide_fleshed";
    const inInv = rec.inventory.some((s) => s && s.id === "deer_hide_fleshed");
    assert.ok(onRack || inInv, "hide should be fleshed after ~10s");
    assert.notEqual(rack.slots[0]?.id, "deer_hide");
    assert.equal(rec._workChannel, null);
});

test("dedicated settler leaves fleshed hide on the rack instead of stashing it", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [
            { id: "pebble", toolClass: "scraper", knapQuality: "rough", quantity: 1 },
            null, null, null, null
        ]
    });
    const rack = addStation(world, settle, "drying_rack", rec.x, rec.y, "rack-leave");
    addBasket(world, settle, rec.x + 16, rec.y, "basket-leave");
    rack.slots[0] = { id: "deer_hide", quantity: 1 };
    Settlement.addBill(settle, rack.uid, { recipeId: "flesh_hide", mode: "forever", paused: false });
    workOnce(world, rec);
    world.tick(11000);
    assert.equal(rack.slots[0]?.id, "deer_hide_fleshed");
    workOnce(world, rec);
    workOnce(world, rec);
    assert.equal(rack.slots[0]?.id, "deer_hide_fleshed", "fleshed hide stays hanging");
    assert.ok(!rec.inventory.some((s) => s && s.id === "deer_hide_fleshed"));
    const basket = world._findThingByUid("basket-leave")?.entry;
    assert.ok(!(basket?.slots || []).some((s) => s && s.id === "deer_hide_fleshed"));
});

test("dedicated settler unloads dried hide from the rack into a basket", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [null, null, null, null, null]
    });
    const rack = addStation(world, settle, "drying_rack", rec.x, rec.y, "rack-dry");
    const basket = addBasket(world, settle, rec.x + 16, rec.y, "basket-dry");
    rack.slots[0] = { id: "deer_hide_dry", quantity: 1 };
    Settlement.addBill(settle, rack.uid, { recipeId: "dry_hide", mode: "forever", paused: false });
    workOnce(world, rec);
    workOnce(world, rec);
    assert.equal(rack.slots[0], null);
    const inBasket = (basket.slots || []).some((s) => s && s.id === "deer_hide_dry");
    const inInv = rec.inventory.some((s) => s && s.id === "deer_hide_dry");
    assert.ok(inBasket || inInv, "dried hide should leave the rack");
});

test("leather unload walks to a distant basket instead of teleporting the hide", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [null, null, null, null, null]
    });
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 0, leather: 1, gather: 0, haul: 0 };
    const rack = addStation(world, settle, "drying_rack", rec.x, rec.y, "rack-far");
    const basket = addBasket(world, settle, rec.x + 16 * 8, rec.y, "basket-far");
    rack.slots[0] = { id: "deer_hide_dry", quantity: 1 };
    Settlement.addBill(settle, rack.uid, { recipeId: "dry_hide", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.equal(rack.slots[0], null, "should take the hide off the rack");
    assert.equal(
        (basket.slots || []).some((s) => s && s.id === "deer_hide_dry"),
        false,
        "must not teleport the hide 8 tiles into storage"
    );
    assert.ok(rec.inventory.some((s) => s && s.id === "deer_hide_dry"), "should carry the hide");
    assert.equal(rec._haulDestUid, basket.uid);
    const startX = rec.x;
    let delivered = false;
    for (let i = 0; i < 400; i++) {
        world.tick(16);
        if ((basket.slots || []).some((s) => s && s.id === "deer_hide_dry")) {
            delivered = true;
            break;
        }
    }
    assert.equal(delivered, true, "should walk the hide to the basket");
    assert.ok(rec.x > startX + 24, `should have walked toward storage, x=${rec.x} start=${startX}`);
});

test("dedicated settler crafts at a bench over craftSeconds", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [
            { id: "deer_hide_dry", quantity: 1 },
            { id: "leaf_cord", quantity: 4 },
            { id: "bone", quantity: 1 },
            null, null
        ]
    });
    const bench = addBenchInFront(world, settle, rec, "bench1");
    Settlement.addBill(settle, bench.uid, { recipeId: "hide_pouch", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.ok(!rec.inventory.some((s) => s && s.id === "hide_pouch"));
    assert.equal(rec._workChannel?.kind, "craft");
    world.tick(100);
    assert.ok(!rec.inventory.some((s) => s && s.id === "hide_pouch"));
    world.tick(13000);
    assert.ok(
        rec.inventory.some((s) => s && s.id === "hide_pouch"),
        "pouch should exist after CRAFT_SECONDS"
    );
    assert.equal(rec._workChannel, null);
});

test("dedicated settler stands on the bench interact tile and faces north", () => {
    const { world, pawn } = createTestWorld();
    fillGrass(world);
    const { settle, rec } = parkSettler(world, pawn, {
        x: 72,
        y: 80,
        inventory: [
            { id: "deer_hide_dry", quantity: 1 },
            { id: "leaf_cord", quantity: 4 },
            { id: "bone", quantity: 1 },
            null, null
        ]
    });
    const bench = addStation(world, settle, "skinworking_bench", rec.x, rec.y, "bench-spot");
    const def = world._thingDef("skinworking_bench");
    const stand = Place.interactWorldPos(bench, 16, def);
    Settlement.addBill(settle, bench.uid, { recipeId: "hide_pouch", mode: "forever", paused: false });
    workOnce(world, rec);
    let arrived = false;
    for (let i = 0; i < 240; i++) {
        world.tick(16);
        if (Math.hypot(rec.x - stand.x, rec.y - stand.y) <= 5) {
            arrived = true;
            break;
        }
    }
    assert.equal(
        arrived,
        true,
        `should stand on the interact tile, at ${rec.x},${rec.y} want ${stand.x},${stand.y}`
    );
    for (let i = 0; i < 12; i++) world.tick(16);
    assert.equal(rec.facing, "up");
    assert.equal(rec._workChannel?.kind, "craft");
});

function countId(world, rec, id) {
    let n = 0;
    const add = (slots) => {
        for (const s of slots || []) {
            if (s?.id === id) n += Math.max(1, Number(s.quantity) || 1);
        }
    };
    add(rec.inventory);
    add(rec.overflow);
    for (const c of world.chunks.values()) add(c.drops);
    return n;
}

test("dedicated settler does not craft an extra item after a count-1 bench bill", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [
            { id: "deer_hide_dry", quantity: 2 },
            { id: "leaf_cord", quantity: 8 },
            { id: "bone", quantity: 2 },
            null, null
        ]
    });
    const bench = addBenchInFront(world, settle, rec, "bench-count");
    Settlement.addBill(settle, bench.uid, {
        recipeId: "hide_pouch",
        mode: "count",
        n: 1,
        paused: false
    });
    workOnce(world, rec);
    assert.equal(rec._workChannel?.kind, "craft");
    world.tick(13000);
    assert.equal(rec._workChannel, null);
    assert.equal(countId(world, rec, "hide_pouch"), 1);
    for (let i = 0; i < 8; i++) workOnce(world, rec);
    world.tick(13000);
    assert.equal(countId(world, rec, "hide_pouch"), 1, "count-1 bill must not start a second craft");
    assert.equal(rec._workChannel, null);
    assert.notEqual(rec._busyJob?.type, "leather");
});

test("dedicated settler idles after a bench bill when pockets are full and storage will not take the output", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [
            { id: "deer_hide_dry", quantity: 1 },
            { id: "leaf_cord", quantity: 8 },
            { id: "bone", quantity: 2 },
            { id: "apple", quantity: 1 },
            { id: "pebble", quantity: 1 }
        ]
    });
    settle.jobs[rec.id].gather = 0;
    settle.jobs[rec.id].chop = 0;
    const bench = addBenchInFront(world, settle, rec, "bench-full");
    Settlement.addBill(settle, bench.uid, { recipeId: "hide_pouch", mode: "forever", paused: false });
    workOnce(world, rec);
    assert.equal(rec._workChannel?.kind, "craft");
    world.tick(13000);
    assert.equal(countId(world, rec, "hide_pouch"), 1);
    const hides = addBasket(world, settle, rec.x + 16, rec.y, "hides");
    hides.storageFilter = {
        priority: "normal",
        offCategories: [
            "apparel", "food", "tools", "weapons", "junk", "buildings", "medicine",
            "materials/leather", "materials/stone", "materials/wood"
        ]
    };
    hides.slots[0] = { id: "deer_hide_dry", quantity: 1 };
    for (let i = 0; i < 6; i++) workOnce(world, rec);
    assert.equal(rec._workChannel, null);
    assert.equal(countId(world, rec, "hide_pouch"), 1, "must not keep crafting into the ground");
    assert.equal(rec._settlerAct, "Idle");
    assert.notEqual(rec._busyJob?.type, "leather");
    assert.equal(rec._workHold, false);
});

function fillGrass(world) {
    for (const c of world.chunks.values()) {
        c.tiles = Array.from({ length: 8 * 8 }, () => "grass");
    }
}

test("dedicated founding and destroying a settlement announces in world chat", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    pawn.inventory[0] = { id: "settling_stone", quantity: 1 };
    pawn.hotbarIndex = 0;
    const { tx, ty } = world._tileOf(pawn.x, pawn.y);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "found",
        tx,
        ty,
        rot: 0,
        name: "River Camp"
    });
    const founded = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(
        founded.some((e) => e.text === "River Camp has been founded" && e.system && !e.to),
        "founding should broadcast"
    );
    assert.equal(world.settlements.length, 1);
    const settle = world.settlements[0];
    world._destroySettlement(settle);
    const wrecked = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(
        wrecked.some((e) => e.text === "River Camp has been destroyed!" && e.system && !e.to),
        "destruction should broadcast"
    );
    assert.equal(world.settlements.length, 0);
});

test("dedicated rename announces old and new names in settler blue", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    pawn.inventory[0] = { id: "settling_stone", quantity: 1 };
    pawn.hotbarIndex = 0;
    const { tx, ty } = world._tileOf(pawn.x, pawn.y);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "found",
        tx,
        ty,
        rot: 0,
        name: "River Camp"
    });
    world.drainEvents();
    const settle = world.settlements[0];
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "rename",
        settlementId: settle.id,
        name: "Hill Camp"
    });
    const chats = world.drainEvents().filter((e) => e.kind === "chat");
    const line = chats.find((e) => e.system && e.text === "River Camp was renamed to Hill Camp");
    assert.ok(line, "rename should broadcast");
    assert.equal(settle.name, "Hill Camp");
    const blue = Party.COLOR_SETTLER || "#7ec8ff";
    assert.deepEqual(line.segments, [
        { text: "River Camp", color: blue },
        { text: "was renamed to" },
        { text: "Hill Camp", color: blue }
    ]);
});

test("picking up a settler makes them follow instead of idling at the stone", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { x: 32, y: 32 });
    pawn.x = 200;
    pawn.y = 32;
    const leader = world._ensurePlayerCreature(pawn);
    leader.x = pawn.x;
    leader.y = pawn.y;
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "pick",
        pawnId: rec.id,
        settlementId: settle.id
    });
    assert.equal((world.settlers || []).some((s) => s.id === rec.id), false);
    assert.ok((pawn.party || []).some((m) => m.id === rec.id), "should join the traveling party");
    const cc = rec.creature || world.creatures.get(rec.id);
    assert.equal(cc.role, "companion");
    assert.equal(cc.homeSettlementId || null, null);
    const startDist = Math.hypot(rec.x - pawn.x, rec.y - pawn.y);
    for (let i = 0; i < 90; i++) world.tick(16);
    const endDist = Math.hypot(rec.x - pawn.x, rec.y - pawn.y);
    assert.ok(
        endDist < startDist - 20,
        `should follow the leader (start ${startDist.toFixed(1)} end ${endDist.toFixed(1)})`
    );
});

test("dropping a companion at a settlement starts settler work instead of standing still", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const mem = world._companionFromSnap(pawn, {
        id: "drop1",
        name: "Parked",
        x: pawn.x,
        y: pawn.y
    });
    pawn.party = [mem];
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "drop",
        pawnId: mem.id,
        settlementId: settle.id
    });
    assert.equal((pawn.party || []).some((m) => m.id === mem.id), false);
    assert.ok((world.settlers || []).some((s) => s.id === mem.id), "should park at the camp");
    assert.equal(mem.role, "settler");
    assert.equal(mem.homeSettlementId, settle.id);
    const cc = mem.creature || world.creatures.get(mem.id);
    assert.equal(cc.role, "settler");
    assert.equal(cc.homeSettlementId, settle.id);

    const chunk = originChunk(world);
    chunk.lootableThings.push({ uid: "lt-drop", id: "sticks", x: mem.x + 80, y: mem.y });
    const startX = mem.x;
    const startY = mem.y;
    for (let i = 0; i < 180; i++) world.tick(16);
    const moved = Math.hypot(mem.x - startX, mem.y - startY) > 8;
    const harvested = mem.inventory.some((s) => s && s.id === "stick")
        || chunk.drops.some((d) => d.id === "stick");
    assert.ok(
        moved || harvested,
        `dropped settler should mill or gather (moved ${Math.hypot(mem.x - startX, mem.y - startY).toFixed(1)})`
    );
});

test("drop-off still parks when settlementId is stale", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const mem = world._companionFromSnap(pawn, {
        id: "drop2",
        name: "Parked",
        x: pawn.x,
        y: pawn.y
    });
    pawn.party = [mem];
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "drop",
        pawnId: mem.id,
        settlementId: "missing-camp"
    });
    assert.ok((world.settlers || []).some((s) => s.id === mem.id));
    assert.equal(mem.homeSettlementId, settle.id);
});

function addLeanTo(world, x, y, tx, ty, rot = 0) {
    const chunk = originChunk(world);
    const entry = { uid: "lean1", id: "lean_to", x, y, tx, ty, rot };
    chunk.things.push(entry);
    return entry;
}

function stepSettlerWalk(world, rec, tx, ty, dt = 16) {
    const cc = world._ensureSettlerCreature(rec);
    const aiWorld = world._aiWorld();
    cc.x = rec.x;
    cc.y = rec.y;
    cc.role = "settler";
    cc.homeSettlementId = rec.homeSettlementId;
    cc.ai._walkToward(tx, ty, false, aiWorld, dt);
    cc.applyDesiredVel(dt);
    const sec = dt / 1000;
    const nx = cc.x + (cc.vx || 0) * sec;
    const ny = cc.y + (cc.vy || 0) * sec;
    if (!world._partyPoseBlocked(cc, nx, cc.y)) cc.x = nx;
    if (!world._partyPoseBlocked(cc, cc.x, ny)) cc.y = ny;
    rec.x = cc.x;
    rec.y = cc.y;
}

test("dedicated settler walks around a lean-to instead of sticking to it", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, { x: 40, y: 96 });
    addLeanTo(world, 40, 48, 2, 2);
    const dest = { x: 40, y: 16 };
    const startY = rec.y;
    let overlappedMs = 0;
    for (let i = 0; i < 240; i++) {
        const cc = world._ensureSettlerCreature(rec);
        stepSettlerWalk(world, rec, dest.x, dest.y, 16);
        if (world._partyPoseBlocked(cc, rec.x, rec.y)) overlappedMs += 16;
    }
    assert.ok(overlappedMs < 400, `stuck overlapping lean-to for ${overlappedMs}ms`);
    assert.ok(rec.y < startY - 20, `should walk north around the lean-to, y=${rec.y}`);
    const cc = world._ensureSettlerCreature(rec);
    assert.equal(world._partyPoseBlocked(cc, rec.x, rec.y), false);
});

test("dedicated settler walks around a vertical lean-to to a dest on the west", () => {
    const { world, pawn } = createTestWorld();
    const ts = 16;
    const tx = 6;
    const ty = 4;
    const def = world._thingDef("lean_to");
    const pos = Place.footprintWorldPos(tx, ty, 90, def.footprint, ts);
    addLeanTo(world, pos.x, pos.y, tx, ty, 90);
    const { rec } = parkSettler(world, pawn, { x: pos.x, y: pos.y + 40 });
    const dest = { x: pos.x - 48, y: pos.y - 8 };
    const box = Place.collisionWorldRect(
        { id: "lean_to", tx, ty, rot: 90, x: pos.x, y: pos.y },
        def,
        ts
    );
    for (let i = 0; i < 280; i++) {
        stepSettlerWalk(world, rec, dest.x, dest.y, 16);
    }
    const cc = world._ensureSettlerCreature(rec);
    assert.equal(world._partyPoseBlocked(cc, rec.x, rec.y), false);
    assert.ok(
        rec.x < box.left - 4,
        `should finish west of the lean-to, x=${rec.x} box.left=${box.left}`
    );
    assert.ok(
        Math.hypot(dest.x - rec.x, dest.y - rec.y) < 28,
        `should reach the west dest, ended ${rec.x.toFixed(1)},${rec.y.toFixed(1)}`
    );
});

test("dedicated settler walks around a campfire beside a vertical lean-to", () => {
    const { world, pawn } = createTestWorld();
    const ts = 16;
    const tx = 6;
    const ty = 4;
    const def = world._thingDef("lean_to");
    const pos = Place.footprintWorldPos(tx, ty, 90, def.footprint, ts);
    addLeanTo(world, pos.x, pos.y, tx, ty, 90);
    const fireX = pos.x - 20;
    const fireY = pos.y - 8;
    originChunk(world).things.push({
        uid: "fire1",
        id: "campfire",
        x: fireX,
        y: fireY,
        tx: Math.floor(fireX / ts),
        ty: Math.floor((fireY - 1) / ts)
    });
    const { rec } = parkSettler(world, pawn, { x: pos.x, y: pos.y + 40 });
    const box = Place.collisionWorldRect(
        { id: "lean_to", tx, ty, rot: 90, x: pos.x, y: pos.y },
        def,
        ts
    );
    for (let i = 0; i < 320; i++) {
        stepSettlerWalk(world, rec, fireX, fireY, 16);
    }
    const cc = world._ensureSettlerCreature(rec);
    assert.equal(world._partyPoseBlocked(cc, rec.x, rec.y), false);
    assert.ok(rec.y < box.bottom + 6, `should not stay south of the lean-to, y=${rec.y} bottom=${box.bottom}`);
    assert.ok(
        Math.hypot(fireX - rec.x, fireY - rec.y) < 36,
        `should reach the fire, ended ${rec.x.toFixed(1)},${rec.y.toFixed(1)}`
    );
});

test("settler walks around a lean-to to brain-tan at a rack", () => {
    const { world, pawn } = createTestWorld();
    const ts = 16;
    const tx = 6;
    const ty = 4;
    const def = world._thingDef("lean_to");
    const pos = Place.footprintWorldPos(tx, ty, 90, def.footprint, ts);
    addLeanTo(world, pos.x, pos.y, tx, ty, 90);
    const box = Place.collisionWorldRect(
        { id: "lean_to", tx, ty, rot: 90, x: pos.x, y: pos.y },
        def,
        ts
    );
    const { settle, rec } = parkSettler(world, pawn, {
        x: pos.x,
        y: box.bottom + 28,
        inventory: [{ id: "brain", quantity: 2 }, null, null, null, null]
    });
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 0, leather: 1, gather: 0, haul: 0 };
    const rack = addStation(
        world, settle, "drying_rack",
        pos.x, box.top - 18,
        "rack-brain"
    );
    rack.slots[0] = { id: "deer_hide_dehaired", quantity: 1 };
    Settlement.addBill(settle, rack.uid, { recipeId: "brain_hide", mode: "forever", paused: false });
    let started = false;
    for (let i = 0; i < 400; i++) {
        world.tick(16);
        if (rec._workChannel?.kind === "brain") {
            started = true;
            break;
        }
    }
    assert.equal(started, true, "should reach the rack and start brain-tanning");
    assert.ok(
        rec.y < box.bottom + 4,
        `must not idle south of the lean-to, y=${rec.y.toFixed(1)} bottom=${box.bottom}`
    );
    const d = Math.hypot(rec.x - rack.x, rec.y - rack.y);
    assert.ok(d < 40, `should stand by the rack, d=${d.toFixed(1)}`);
});

test("cook walks around a lean-to to fetch brained hides for smoking", () => {
    const { world, pawn } = createTestWorld();
    const ts = 16;
    const tx = 6;
    const ty = 4;
    const def = world._thingDef("lean_to");
    const pos = Place.footprintWorldPos(tx, ty, 90, def.footprint, ts);
    addLeanTo(world, pos.x, pos.y, tx, ty, 90);
    const box = Place.collisionWorldRect(
        { id: "lean_to", tx, ty, rot: 90, x: pos.x, y: pos.y },
        def,
        ts
    );
    const { settle, rec } = parkSettler(world, pawn, {
        x: pos.x,
        y: box.bottom + 28,
        inventory: [null, null, null, null, null]
    });
    settle.jobs[rec.id] = { doctor: 0, cook: 1, chop: 0, leather: 0, gather: 0, haul: 0 };
    const fire = addLitFire(world, settle, rec, "smoke-fire");
    fire.catalyst = { id: "drying_rack", quantity: 1 };
    const rack = addStation(
        world, settle, "drying_rack",
        pos.x, box.top - 18,
        "rack-smoke"
    );
    rack.slots[0] = { id: "deer_hide_brained", quantity: 1 };
    Settlement.addBill(settle, fire.uid, { recipeId: "smoke", mode: "forever", paused: false });
    let loaded = false;
    let northOfLean = false;
    for (let i = 0; i < 500; i++) {
        world.tick(16);
        if (rec.y < box.bottom + 4) northOfLean = true;
        if (fire.cook?.id === "deer_hide_brained") {
            loaded = true;
            break;
        }
    }
    assert.equal(loaded, true, "should fetch the hide and hang it on the fire");
    assert.equal(northOfLean, true, "must walk north around the lean-to, not idle at the fire");
    assert.equal(rack.slots[0], null);
});

test("dedicated settler pops out when standing inside a lean-to", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, { x: 40, y: 40 });
    addLeanTo(world, 40, 48, 2, 2);
    const cc = world._ensureSettlerCreature(rec);
    assert.equal(world._partyPoseBlocked(cc, rec.x, rec.y), true);
    for (let i = 0; i < 30; i++) {
        stepSettlerWalk(world, rec, 40, 96, 16);
    }
    assert.equal(world._partyPoseBlocked(cc, rec.x, rec.y), false);
});

test("healthy settlers get up at 6:00", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    rec.kc = 1600;
    rec._resting = true;
    rec.resting = true;
    world.gameMinutes = 200;
    const nightMob = world._ensureSettlerCreature(rec);
    world._tickSettlerAI(300, world._aiWorld());
    assert.equal(!!rec._resting, true);

    world.gameMinutes = 360;
    rec._settlerScan = null;
    rec._settlerScanMs = 280;
    world._tickSettlerAI(300, world._aiWorld());
    assert.equal(!!rec._resting, false);
    assert.equal(!!nightMob._resting, false);
});

test("injured settlers stay in bed after dawn", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    rec.kc = 1600;
    rec._resting = true;
    const mob = world._ensureSettlerCreature(rec);
    const part = mob.anatomy?.part?.("torso") || Object.values(mob.anatomy?.parts?.() || {})[0];
    if (part) {
        part.injuries = part.injuries || [];
        part.injuries.push({ id: "cut", permanent: false });
    }
    world.gameMinutes = 360;
    rec._settlerScan = null;
    rec._settlerScanMs = 280;
    world._tickSettlerAI(300, world._aiWorld());
    assert.equal(!!rec._resting, true);
    assert.equal(world._publicSettler(rec).injured, true);
    if (part) part.injuries.length = 0;
    assert.equal(world._publicSettler(rec).injured, false);
});

test("sleeping settler gets up to fight a hostile in the settlement", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    rec.kc = 1600;
    rec._resting = true;
    rec.resting = true;
    world.gameMinutes = 200;
    const cc = world._ensureSettlerCreature(rec);
    cc._resting = true;
    const boar = spawnHostileBoar(world, rec.x + 12, rec.y);
    for (let i = 0; i < 10; i++) world.tick(50);
    assert.equal(!!rec._resting, false, "settler should leave the bunk");
    assert.equal(cc.ai?.assistTarget, boar);
    assert.equal(cc._settlerAct, "Fighting");
});

test("eating settler drops the meal to fight a hostile in camp", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, {
        inventory: [{ id: "blueberry", quantity: 4 }, null, null, null, null]
    });
    rec.kc = 200;
    const cc = world._ensureSettlerCreature(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = 280;
    world._tickSettlerWork(cc, 300);
    assert.ok(rec.eatChannel, "settler should start eating");
    const boar = spawnHostileBoar(world, rec.x + 12, rec.y);
    for (let i = 0; i < 10; i++) world.tick(50);
    assert.equal(rec.eatChannel, null, "eating should cancel");
    assert.equal(cc.ai?.assistTarget, boar);
    assert.equal(cc._settlerAct, "Fighting");
});

test("sleeping settler ignores hostiles outside the settlement radius", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    settle.radiusTiles = 4;
    rec.kc = 1600;
    rec._resting = true;
    rec.resting = true;
    world.gameMinutes = 200;
    const cc = world._ensureSettlerCreature(rec);
    cc._resting = true;
    spawnHostileBoar(world, rec.x + 120, rec.y);
    world._tickSettlerAI(300, world._aiWorld());
    assert.equal(!!rec._resting, true, "still night and the boar is outside camp");
    assert.equal(cc.ai?.assistTarget || null, null);
});

test("settler rest-walk occupies the lean-to instead of standing beside it", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    const chunk = originChunk(world);
    const entry = { uid: "lt-settler", id: "lean_to", x: rec.x, y: rec.y, tx: 2, ty: 2, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 } });
    chunk.things.push(entry);
    const def = { sleep: { slots: 2 } };
    const stand = Sleep.restWalkStand(entry, 0, 16, def);
    rec.x = stand.x;
    rec.y = stand.y;
    world._orderRest(pawn, rec, entry, 0, { autofill: false });
    assert.ok(rec._restWalk, "should start walking to the bunk");
    world._tickSleepWalks(16);
    assert.equal(rec._resting, true);
    assert.equal(rec._restWalk, null);
    assert.equal(entry.occupants[0], rec.id);
    const pub = world._publicSettler(rec);
    assert.equal(pub.resting, true);
    assert.equal(pub.lastSleep?.uid, "lt-settler");
});

test("settler walking to a lean-to is Going to sleep, not Idle", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    const chunk = originChunk(world);
    const entry = { uid: "lt-go", id: "lean_to", x: rec.x + 80, y: rec.y, tx: 7, ty: 2, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 } });
    chunk.things.push(entry);
    world.gameMinutes = 1300;
    rec.kc = 1600;
    workOnce(world, rec);
    assert.ok(rec._restWalk, "should start walking to the bunk");
    assert.equal(!!rec._resting, false);
    assert.equal(rec._settlerAct, "Going to sleep in a lean-to");
    assert.equal(world._publicSettler(rec).activity, "Going to sleep in a lean-to");
    rec.x = Sleep.restWalkStand(entry, rec._restWalk.slot, 16, { sleep: { slots: 2 } }).x;
    rec.y = Sleep.restWalkStand(entry, rec._restWalk.slot, 16, { sleep: { slots: 2 } }).y;
    world._tickSleepWalks(16);
    assert.equal(rec._resting, true);
    workOnce(world, rec);
    assert.equal(rec._settlerAct, "Sleeping in a lean-to");
    assert.equal(world._publicSettler(rec).activity, "Sleeping in a lean-to");
});

test("picking up a sleeping settler wakes them so they can follow", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { x: 32, y: 32 });
    const chunk = originChunk(world);
    const entry = { uid: "lt-pick", id: "lean_to", x: rec.x, y: rec.y, tx: 2, ty: 2, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 } });
    chunk.things.push(entry);
    rec._settlerAct = "Sleeping";
    world._orderRest(pawn, rec, entry, 0, { autofill: false });
    rec.x = Sleep.restWalkStand(entry, 0, 16, { sleep: { slots: 2 } }).x;
    rec.y = Sleep.restWalkStand(entry, 0, 16, { sleep: { slots: 2 } }).y;
    world._tickSleepWalks(16);
    assert.equal(rec._resting, true);

    pawn.x = 200;
    pawn.y = 32;
    const leader = world._ensurePlayerCreature(pawn);
    leader.x = pawn.x;
    leader.y = pawn.y;
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "pick",
        pawnId: rec.id,
        settlementId: settle.id
    });
    assert.equal(!!rec._resting, false);
    assert.equal(rec._restWalk, null);
    assert.equal(rec._settlerAct, null);
    const startDist = Math.hypot(rec.x - pawn.x, rec.y - pawn.y);
    for (let i = 0; i < 90; i++) world.tick(16);
    const endDist = Math.hypot(rec.x - pawn.x, rec.y - pawn.y);
    assert.ok(
        endDist < startDist - 20,
        `should follow the leader (start ${startDist.toFixed(1)} end ${endDist.toFixed(1)})`
    );
});

function cookOnlyJobs(settle, rec) {
    settle.jobs[rec.id] = {
        doctor: 0, cook: 1, leather: 0, haul: 0, gather: 0, chop: 0
    };
}

function addKeepFire(world, settle, rec, uid = "fire-fuel") {
    const fire = addStation(world, settle, "campfire", rec.x + 16, rec.y, uid);
    fire.id = "campfire";
    fire.fuel = [null, null];
    fire.burnRemaining = 10;
    fire.pitTemp = 600;
    fire.maxTemp = 600;
    return fire;
}

function workN(world, rec, n = 8) {
    for (let i = 0; i < n; i++) workOnce(world, rec);
}

test("always-on campfire is stoked to at least 12 hours of fuel", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    rec.kc = 1600;
    cookOnlyJobs(settle, rec);
    const fire = addKeepFire(world, settle, rec);
    const basket = addBasket(world, settle, rec.x, rec.y, "fuel-basket");
    basket.slots[0] = { id: "log", quantity: 10 };
    workN(world, rec);
    const getItem = (id) => world._itemDef(id);
    assert.ok(
        Fire.burnMinutes(fire, getItem) >= FuelFilter.KEEP_MINUTES,
        `expected >= 720 min, got ${Fire.burnMinutes(fire, getItem)}`
    );
    assert.equal(fire.fuel[0]?.id, "log");
    assert.equal((basket.slots[0]?.quantity || 0) < 10, true);
    const logsLeft = basket.slots[0]?.id === "log" ? (basket.slots[0].quantity || 0) : 0;
    workN(world, rec);
    const logsAfter = basket.slots[0]?.id === "log" ? (basket.slots[0].quantity || 0) : 0;
    assert.equal(logsAfter, logsLeft);
});

test("always-on off does not top up a fire that already has fuel", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    rec.kc = 1600;
    cookOnlyJobs(settle, rec);
    const fire = addKeepFire(world, settle, rec);
    fire.fuel[0] = { id: "stick", quantity: 1 };
    FuelFilter.applyToEntry(fire, { alwaysOn: false, preferLogs: true });
    const basket = addBasket(world, settle, rec.x, rec.y, "fuel-basket");
    basket.slots[0] = { id: "log", quantity: 8 };
    workN(world, rec);
    assert.equal(fire.fuel[0]?.id, "stick");
    assert.equal(fire.fuel[0]?.quantity, 1);
    assert.equal(basket.slots[0]?.quantity, 8);
});

test("prefer logs takes logs before sticks", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    rec.kc = 1600;
    cookOnlyJobs(settle, rec);
    const fire = addKeepFire(world, settle, rec);
    fire.fuel = [null, null];
    fire.burnRemaining = 0;
    const basket = addBasket(world, settle, rec.x, rec.y, "fuel-basket");
    basket.slots[0] = { id: "stick", quantity: 20 };
    basket.slots[1] = { id: "log", quantity: 8 };
    workN(world, rec);
    assert.equal(fire.fuel[0]?.id, "log");
});

test("fuel filter can deny logs so settlers use sticks", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    rec.kc = 1600;
    cookOnlyJobs(settle, rec);
    const fire = addKeepFire(world, settle, rec);
    fire.fuel = [null, null];
    fire.burnRemaining = 0;
    FuelFilter.applyToEntry(fire, { alwaysOn: true, preferLogs: true, offItems: ["log"] });
    const basket = addBasket(world, settle, rec.x, rec.y, "fuel-basket");
    basket.slots[0] = { id: "stick", quantity: 20 };
    basket.slots[1] = { id: "log", quantity: 8 };
    workN(world, rec);
    assert.equal(fire.fuel[0]?.id, "stick");
    assert.equal(basket.slots[1]?.quantity, 8);
});

test("setFuelFilter persists on a settlement campfire", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    const fire = addStation(world, settle, "campfire", rec.x, rec.y, "fire-filt");
    fire.fuel = [null, null];
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "setFuelFilter",
        settlementId: settle.id,
        uid: fire.uid,
        filter: { alwaysOn: false, preferLogs: false, offItems: ["leaf"] }
    });
    assert.equal(fire.fuelFilter?.alwaysOn, false);
    assert.equal(fire.fuelFilter?.preferLogs, false);
    assert.ok(fire.fuelFilter?.offItems?.includes("leaf"));
    const pub = world._campfirePublic(fire, originChunk(world));
    assert.equal(pub.fuelFilter?.alwaysOn, false);
    assert.equal(pub.fuelFilter?.preferLogs, false);
});

test("dedicated doctor stops when the patient has no injuries", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec: doctor } = parkSettler(world, pawn, {
        id: "doc",
        inventory: [{ id: "leaf_cord", quantity: 2 }, null, null, null, null]
    });
    doctor.kc = 1600;
    settle.jobs[doctor.id] = { doctor: 1, cook: 0, chop: 0, leather: 0, gather: 0, haul: 0 };
    const patient = world._settlerFromSnap({
        id: "pat",
        name: "Ugg",
        x: doctor.x,
        y: doctor.y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        kc: 1600,
        inventory: [null, null, null, null, null]
    });
    settle.jobs[patient.id] = { doctor: 0, cook: 0, chop: 0, leather: 0, gather: 0, haul: 0 };
    world.settlers.push(patient);
    world._ensureSettlerCreature(patient);
    doctor._workHold = true;
    doctor._busyJob = { type: "doctor", target: patient };
    workOnce(world, doctor);
    assert.notEqual(doctor._busyJob?.type, "doctor");
    assert.equal(!!doctor._workChannel, false);
    assert.equal(/Tending/.test(doctor._settlerAct || "Idle"), false);
});

test("dedicated doctor drops a healed patient instead of tending forever", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec: doctor } = parkSettler(world, pawn, {
        id: "doc",
        inventory: [{ id: "leaf_cord", quantity: 2 }, null, null, null, null]
    });
    doctor.kc = 1600;
    settle.jobs[doctor.id] = { doctor: 1, cook: 0, chop: 0, leather: 0, gather: 0, haul: 0 };
    const patient = world._settlerFromSnap({
        id: "pat",
        name: "Ugg",
        x: doctor.x,
        y: doctor.y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        kc: 1600,
        inventory: [null, null, null, null, null]
    });
    settle.jobs[patient.id] = { doctor: 0, cook: 0, chop: 0, leather: 0, gather: 0, haul: 0 };
    world.settlers.push(patient);
    const creature = world._ensureSettlerCreature(patient);
    const part = creature.anatomy.part("Left Arm") || creature.anatomy.core;
    part.injure({
        id: "cut",
        severity: 8,
        bleeding: true,
        bleedRate: 0.06,
        tended: false
    });
    workOnce(world, doctor);
    assert.equal(doctor._workChannel?.kind, "tend");
    part.injuries.length = 0;
    doctor._settlerScan = null;
    workOnce(world, doctor);
    assert.equal(doctor._workChannel, null);
    assert.notEqual(doctor._busyJob?.type, "doctor");
    assert.equal(/Tending/.test(doctor._settlerAct || "Idle"), false);
});

test("settler tool break names the settler in blue and the tool in orange", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    const { rec } = parkSettler(world, pawn, {
        name: "Keka",
        inventory: [{ id: "sharp_stick", quantity: 1, durability: 1 }, null, null, null, null]
    });
    rec.name = "Keka";
    rec.hotbarIndex = 0;
    world.drainEvents();
    const result = world._wearHeld(rec, 1);
    assert.equal(result.broke, true);
    const logs = world.drainEvents().filter((e) => e.kind === "combat_log");
    assert.ok(logs.length, "expected a break combat log");
    const line = logs[0];
    assert.equal(line.text, "Keka's Sharp Stick broke");
    assert.ok(!/^Your /.test(line.text));
    assert.equal(line.to, pawn.id);
    const who = line.segments.find((s) => s.text === "Keka's");
    const tool = line.segments.find((s) => s.text === "Sharp Stick");
    assert.ok(who, "expected settler possessive segment");
    assert.equal(who.color, Party.COLOR_SETTLER || "#7ec8ff");
    assert.ok(tool, "expected tool name segment");
    assert.equal(tool.color, "#f0a040");
});

test("player tool break says Your and colors the tool orange", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    pawn.inventory = [{ id: "sharp_stick", quantity: 1, durability: 1 }, null, null, null, null];
    pawn.hotbarIndex = 0;
    world.drainEvents();
    const result = world._wearHeld(pawn, 1);
    assert.equal(result.broke, true);
    const logs = world.drainEvents().filter((e) => e.kind === "combat_log");
    assert.ok(logs.length, "expected a break combat log");
    const line = logs[0];
    assert.equal(line.text, "Your Sharp Stick broke");
    const tool = line.segments.find((s) => s.text === "Sharp Stick");
    assert.ok(tool);
    assert.equal(tool.color, "#f0a040");
});

test("settler rest-walks around a basket instead of running into it", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { x: 80, y: 96, kc: 1600 });
    addBasket(world, settle, 80, 64);
    const chunk = originChunk(world);
    const entry = { uid: "lt-basket", id: "lean_to", x: 80, y: 32, tx: 4, ty: 1, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 } });
    chunk.things.push(entry);
    rec._pathIgnoreUid = "basket1";
    world.gameMinutes = 1300;
    workOnce(world, rec);
    assert.ok(rec._restWalk, "should start walking to bed");
    assert.equal(rec._pathIgnoreUid, null, "must not keep ignoring the basket after depositing");
    const startY = rec.y;
    let overlappedMs = 0;
    for (let i = 0; i < 280; i++) {
        const cc = world._ensureSettlerCreature(rec);
        cc._restWalk = rec._restWalk;
        const dest = world._aiWorld().getRestWalkDest(cc);
        if (!dest || rec._resting) break;
        if (world._partyPoseBlocked(cc, rec.x, rec.y)) overlappedMs += 16;
        stepSettlerWalk(world, rec, dest.x, dest.y, 16);
    }
    assert.ok(overlappedMs < 500, `stuck overlapping the basket for ${overlappedMs}ms`);
    assert.ok(rec.y < startY - 24, `should walk north around the basket, y=${rec.y}`);
});

test("settler gathers blueberries around two baskets instead of walking into them", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    chunk.lootableThings = [];
    chunk.things = [];
    chunk.drops = [];
    const ensure = world._ensureChunk.bind(world);
    world._ensureChunk = function (cx, cy) {
        const c = ensure(cx, cy);
        if (c && (cx !== 0 || cy !== 0)) c.lootableThings = [];
        return c;
    };
    const { settle, rec } = parkSettler(world, pawn, { x: 80, y: 88, kc: 1600 });
    settle.stock = { blueberry: 40 };
    settle.jobs[rec.id] = { doctor: 0, cook: 0, chop: 0, leather: 0, gather: 1, haul: 0 };
    addBasket(world, settle, 72, 64, "b-left");
    addBasket(world, settle, 88, 64, "b-right");
    chunk.lootableThings.push({ uid: "bb1", id: "blueberry_bush", x: 80, y: 40 });
    let overlappedMs = 0;
    let harvested = false;
    for (let i = 0; i < 360; i++) {
        for (const c of world.chunks.values()) {
            if (c !== chunk) c.lootableThings = [];
        }
        world.tick(16);
        const cc = world._ensureSettlerCreature(rec);
        if (world._partyPoseBlocked(cc, rec.x, rec.y)) overlappedMs += 16;
        if ((rec.inventory || []).some((s) => s && s.id === "blueberry")) {
            harvested = true;
            break;
        }
    }
    assert.equal(harvested, true, `should pick the bush, ended ${rec.x.toFixed(1)},${rec.y.toFixed(1)} act ${rec._settlerAct}`);
    assert.ok(overlappedMs < 400, `stuck overlapping a basket for ${overlappedMs}ms`);
    assert.ok(rec.y < 64, `should finish north of the baskets, y=${rec.y.toFixed(1)}`);
});

