const { test } = require("node:test");
const assert = require("node:assert/strict");
const Settlement = require("../shared/settlement");
const Place = require("../shared/place");
const Sleep = require("../shared/sleep");
const Party = require("../shared/party");

test("settlement circles cannot overlap", () => {
    const a = Settlement.createSettlement({ x: 0, y: 0 });
    const ok = Settlement.canPlace([a], 64 * 16, 0, 16);
    const bad = Settlement.canPlace([a], 63 * 16, 0, 16);
    assert.equal(ok, true);
    assert.equal(bad, false);
    assert.equal(Settlement.circlesOverlap(a, { x: 32 * 16, y: 0, radiusTiles: 32 }, 16), true);
});

test("drop-off / pick-up cap and leader cannot park", () => {
    assert.equal(Settlement.canDropOff({ id: "a" }, { id: "leader" }), true);
    assert.equal(Settlement.canDropOff({ id: "leader" }, { id: "leader" }), false);
    assert.equal(Settlement.partyHasRoom(5, 6), true);
    assert.equal(Settlement.partyHasRoom(6, 6), false);
});

test("left click raises job priority; right click cycles the old way", () => {
    assert.equal(Settlement.raisePriority(3), 2);
    assert.equal(Settlement.raisePriority(2), 1);
    assert.equal(Settlement.raisePriority(1), 0);
    assert.equal(Settlement.raisePriority(0), 4);
    assert.equal(Settlement.raisePriority(4), 3);
    assert.equal(Settlement.cyclePriority(0), 1);
    assert.equal(Settlement.cyclePriority(1), 2);
    assert.equal(Settlement.cyclePriority(4), 0);
});

test("recruit parks into settlement when travel is full", () => {
    assert.equal(Settlement.recruitParksWhenFull(6, true, 6), true);
    assert.equal(Settlement.recruitParksWhenFull(6, false, 6), false);
    assert.equal(Settlement.recruitParksWhenFull(5, true, 6), false);
});

test("campfire bills catalog is Roast, Simmer, and Smoke leather", () => {
    const recipes = Settlement.billRecipesFor("campfire");
    assert.equal(recipes.length, 3);
    assert.equal(recipes[0].id, "roast");
    assert.equal(recipes[0].method, "stick_roast");
    assert.equal(recipes[1].id, "simmer");
    assert.equal(recipes[1].method, "shell_simmer");
    assert.equal(recipes[2].id, "smoke");
    assert.equal(recipes[2].method, "smoke_hide");
    const items = [
        { id: "apple", name: "Apple", cook: { stick_roast: { result: "roasted_apple", minutes: 10 } } },
        { id: "raw_beef", name: "Raw Beef", cook: { stick_roast: { result: "roast_beef", minutes: 15 } } },
        { id: "stick", name: "Stick" }
    ];
    const inputs = Settlement.cookInputsForMethod(items, "stick_roast");
    assert.deepEqual(inputs.map((i) => i.id), ["apple", "raw_beef"]);
    const simmer = Settlement.billInputsFor(recipes[1], items);
    assert.ok(simmer.some((i) => i.id === "apple"));
    assert.ok(simmer.some((i) => i.id === "blueberry"));
    const settle = Settlement.createSettlement({ x: 0, y: 0 });
    Settlement.addBill(settle, "fire1", {
        recipeId: "roast",
        mode: "forever",
        allowedIds: ["apple"]
    });
    const bill = Settlement.billsOf(settle, "fire1")[0];
    assert.equal(Settlement.billTitle(bill), "Roast");
    assert.equal(bill.kind, "cook");
    assert.equal(bill.method, "stick_roast");
    Settlement.syncBillResults(bill, (id) => items.find((it) => it.id === id));
    assert.deepEqual(bill.resultIds, ["roasted_apple"]);
    Settlement.addBill(settle, "fire1", { recipeId: "simmer", mode: "forever" });
    const simmerBill = Settlement.billsOf(settle, "fire1")[1];
    Settlement.syncBillResults(simmerBill, () => null);
    assert.deepEqual(simmerBill.resultIds, ["coconut_meal"]);
    assert.equal(Settlement.cookInputReady(() => null, { id: "blueberry" }, simmerBill), true);
    assert.equal(Settlement.cookOutputReady(() => null, { id: "coconut_meal" }, simmerBill), true);
    assert.equal(Settlement.cycleBillMode("forever"), "until");
    assert.equal(Settlement.billModeLabel("until"), "Do until you have X");
    const moved = Settlement.moveBill(Settlement.billsOf(settle, "fire1"), bill.id, 1);
    assert.equal(moved.length, 2);
});

test("rack bills are per hide step with animal allowlists", () => {
    const recipes = Settlement.billRecipesFor("rack");
    assert.deepEqual(recipes.map((r) => r.id), [
        "flesh_hide", "dry_hide", "soak_hide", "dehair_hide", "brain_hide"
    ]);
    const items = [
        { id: "deer_hide", name: "Deer Hide", hide: { animal: "deer", stage: "raw" } },
        { id: "boar_hide", name: "Boar Hide", hide: { animal: "boar", stage: "raw" } },
        { id: "deer_hide_fleshed", name: "Fleshed Deer Hide", hide: { animal: "deer", stage: "fleshed" } }
    ];
    const getItem = (id) => items.find((it) => it.id === id) || { id, hide: { animal: id.startsWith("boar") ? "boar" : "deer" } };
    const flesh = Settlement.billInputsFor(recipes[0], items);
    assert.deepEqual(flesh.map((i) => i.id).sort(), ["boar_hide", "deer_hide"]);
    const settle = Settlement.createSettlement({ x: 0, y: 0 });
    Settlement.addBill(settle, "rack1", {
        recipeId: "flesh_hide",
        mode: "until",
        n: 2,
        allowedIds: ["deer_hide"]
    });
    const bill = Settlement.billsOf(settle, "rack1")[0];
    assert.equal(Settlement.billTitle(bill), "Flesh hides");
    Settlement.syncBillResults(bill, getItem);
    assert.deepEqual(bill.resultIds, ["deer_hide_fleshed"]);
    assert.equal(Settlement.hideAllowsStack(bill, { id: "deer_hide" }, getItem), true);
    assert.equal(Settlement.hideAllowsStack(bill, { id: "boar_hide" }, getItem), false);
    assert.equal(Settlement.hideAllowsStack(bill, { id: "deer_hide_fleshed" }, getItem), false);
    assert.equal(Settlement.hideToolNeed("flesh_hide"), "scraper");
    assert.equal(Settlement.hideToolNeed("brain_hide"), "brain");
    assert.equal(Settlement.hideToolNeed("dry_hide"), null);
});

test("soak bill has no work without water; prefers nearest water", () => {
    assert.equal(Settlement.hideSoakHasWork({ hasFleshed: true, hasWater: false }), false);
    assert.equal(Settlement.hideSoakHasWork({ hasFleshed: true, hasWater: true }), true);
    assert.equal(Settlement.hideSoakHasWork({ hasReadySoaked: true, hasWater: false }), true);
    const settle = Settlement.createSettlement({ x: 0, y: 0 });
    const wet = new Set(["2,0"]);
    const hit = Settlement.nearestWaterPoint(settle, 0, 0, 16, (wx, wy) => {
        const tx = Math.floor(wx / 16);
        const ty = Math.floor(wy / 16);
        return wet.has(`${tx},${ty}`);
    });
    assert.ok(hit);
    assert.equal(hit.tx, 2);
    assert.equal(hit.ty, 0);
    const dry = Settlement.nearestWaterPoint(settle, 0, 0, 16, () => false);
    assert.equal(dry, null);
});

test("settlers only traverse water while wading to soak", () => {
    assert.equal(Party.traversesWater({ role: "settler" }), false);
    assert.equal(Party.traversesWater({ role: "settler", _wadeWater: true }), true);
    assert.equal(Party.traversesWater({ role: "wanderer" }), true);
    assert.equal(Party.traversesWater({ role: "companion" }), false);
});

test("bench bills catalog sewn hide and leather goods", () => {
    const recipes = Settlement.billRecipesFor("craft");
    assert.ok(recipes.some((r) => r.id === "hide_pouch"));
    assert.ok(recipes.some((r) => r.id === "leather_tunic"));
    const pouch = recipes.find((r) => r.id === "hide_pouch");
    assert.equal(pouch.hideStage, "dried");
    const items = [
        { id: "deer_hide_dry", name: "Dried Deer Hide", hide: { animal: "deer", stage: "dried" } },
        { id: "boar_hide_dry", name: "Dried Boar Hide", hide: { animal: "boar", stage: "dried" } }
    ];
    const inputs = Settlement.billInputsFor(pouch, items);
    assert.deepEqual(inputs.map((i) => i.id).sort(), ["boar_hide_dry", "deer_hide_dry"]);
    const settle = Settlement.createSettlement({ x: 0, y: 0 });
    Settlement.addBill(settle, "bench1", { recipeId: "hide_pouch", mode: "until", n: 1 });
    const bill = Settlement.billsOf(settle, "bench1")[0];
    assert.equal(bill.outputId, "hide_pouch");
    Settlement.syncBillResults(bill, () => null);
    assert.deepEqual(bill.resultIds, ["hide_pouch"]);
    assert.equal(Settlement.billTitle(bill), "Make Hide Pouch");
    assert.equal(Settlement.billRecipeTitle(pouch), "Make Hide Pouch");
});

test("bill until-you-have counts across baskets", () => {
    const settle = Settlement.createSettlement({ x: 0, y: 0 });
    const baskets = [{ slots: [{ id: "stick", quantity: 4 }, { id: "stick", quantity: 3 }] }];
    Settlement.addBill(settle, "fire1", { mode: "until", n: 10, outputId: "stick" });
    const bill = Settlement.activeBill(settle, "fire1", (id) => Settlement.countStock(baskets, id));
    assert.ok(bill);
    const done = Settlement.activeBill(settle, "fire1", () => 12);
    assert.equal(done, null);
});

test("interest keys cover settlement chunks when player is far", () => {
    const settle = Settlement.createSettlement({ x: 800, y: 800 });
    const keys = Settlement.chunkKeysFor(settle, 16, 8);
    assert.ok(keys.length > 4);
    assert.ok(keys.includes("6,6"));
    assert.ok(keys.length <= 13 * 13);
    assert.equal(Settlement.shouldPin(settle, 1), true);
    assert.equal(Settlement.shouldPin(settle, 0), false);
    settle.stationUids = ["b1"];
    assert.equal(Settlement.shouldPin(settle, 0), true);
});

test("basket slot count 8; 6-slot entries pad to 8; layout is 2x4", () => {
    const def = { storage: { slots: 8 } };
    const entry = { slots: [null, null, null, null, null, null] };
    assert.equal(Place.storageSlotCount(def, entry), 8);
    Place.ensureStorageEntry(entry, def);
    assert.equal(entry.slots.length, 8);
    assert.equal(Place.storageLayoutCols(8), 4);
    assert.equal(Place.storageLayoutCols(1), 1);
    assert.equal(Settlement.storageLayoutCols(8), 4);
});

test("picking up a station unlinks it so a same-tile re-place is not auto-added", () => {
    const settle = Settlement.createSettlement({ x: 0, y: 0 });
    settle.stationUids = ["st_8_8"];
    settle.bills = { "st_8_8": [{ id: "b1" }] };
    const hit = Settlement.unlinkStation([settle], "st_8_8");
    assert.equal(hit.length, 1);
    assert.deepEqual(settle.stationUids, []);
    assert.equal(settle.bills["st_8_8"], undefined);
    const entry = { id: "wicker_basket", x: 8, y: 8 };
    Place.ensureStorageEntry(entry, { storage: { slots: 8 } });
    assert.equal(entry.uid, "st_8_8");
    assert.equal(settle.stationUids.includes(entry.uid), false);
});

test("owner-only station add including abandoned-camp ids", () => {
    assert.equal(Settlement.isAddableId("unlit_campfire"), true);
    assert.equal(Settlement.isAddableId("wicker_basket"), true);
    assert.equal(Settlement.isAddableId("skinworking_bench"), true);
    assert.equal(Settlement.isAddableId("drying_rack"), true);
    assert.equal(Settlement.isAddableId("lean_to"), false);
    const list = [
        Settlement.createSettlement({ ownerId: "a", x: 0, y: 0 }),
        Settlement.createSettlement({ ownerId: "b", x: 2000, y: 0 })
    ];
    const hit = Settlement.atPoint(list, 10, 10, 16, "a");
    assert.equal(hit.ownerId, "a");
    assert.equal(Settlement.atPoint(list, 10, 10, 16, "b"), null);
});

test("traveling party ignored by settler job assignment; leader cannot drop", () => {
    const settle = Settlement.createSettlement({ x: 0, y: 0 });
    Settlement.setJob(settle, "settler-1", "haul", 1);
    assert.equal(Settlement.pickJob(Settlement.jobsFor(settle, "settler-1")), "haul");
    assert.equal(Settlement.pickJob(Settlement.jobsFor(settle, "traveler")), "doctor");
    assert.equal(Settlement.canDropOff({ role: "leader" }, {}), false);
});

test("transfer settler walk vs teleport", () => {
    assert.equal(Settlement.transferMode(90, 96), "walk");
    assert.equal(Settlement.transferMode(97, 96), "teleport");
});

test("settler death removes them from roster conceptually", () => {
    const settlers = [{ id: "s1", dead: false }, { id: "s2", dead: true }];
    const live = settlers.filter((s) => !s.dead);
    assert.equal(live.length, 1);
    assert.equal(live[0].id, "s1");
});

test("settlers sleeping at night does not change player tick speed", () => {
    const base = 1;
    const partyResting = false;
    const speed = Sleep.effectiveTickSpeed(base, partyResting);
    assert.equal(speed, base);
    const allTravelResting = Sleep.effectiveTickSpeed(base, true);
    assert.ok(allTravelResting > base);
});

test("stock list only includes resources from local plants and trees", () => {
    const cactus = Settlement.stockItemsFromThing({ id: "cactus" });
    assert.ok(cactus.includes("cactus_flower"));
    assert.ok(!cactus.includes("blueberry"));
    const flower = Settlement.stockItemsFromThing({
        id: "flowering_cactus",
        lootable: { item: "cactus_flower" }
    });
    assert.ok(flower.includes("cactus_flower"));
    const grassTree = Settlement.stockItemsFromThing({ id: "tree", choppable: { stump: "tree_stump" } });
    assert.ok(grassTree.includes("log"));
    assert.ok(grassTree.includes("stick"));
    assert.ok(!grassTree.includes("apple"));
    const harvestedApple = Settlement.stockItemsFromThing(
        { id: "tree", choppable: { stump: "tree_stump" } },
        { regrowAt: 1 }
    );
    assert.ok(harvestedApple.includes("apple"));
    const bush = Settlement.stockItemsFromThing({ id: "bush" });
    assert.ok(!bush.includes("blueberry"));
    const harvestedBush = Settlement.stockItemsFromThing({ id: "bush" }, { regrowAt: 99 });
    assert.ok(harvestedBush.includes("blueberry"));
    assert.deepEqual(
        Settlement.filterStockItems(new Set(["cactus_flower", "stick", "log"])),
        ["stick", "log", "cactus_flower"]
    );
});

test("gather/chop stop at stock targets in added baskets", () => {
    const settle = Settlement.createSettlement({ x: 0, y: 0 });
    settle.stock = Settlement.normalizeStock({ stick: 10, log: 12, leaf: 0 });
    const baskets = [{ slots: [{ id: "stick", quantity: 10 }, { id: "log", quantity: 5 }] }];
    assert.equal(Settlement.gatherShouldWork(Settlement.countStock(baskets, "stick"), settle.stock.stick), false);
    assert.equal(Settlement.gatherShouldWork(Settlement.countStock(baskets, "log"), settle.stock.log), true);
    assert.equal(Settlement.gatherShouldWork(0, 0), false);
});

test("chop job skips fruiting resource trees", () => {
    assert.equal(Settlement.fruitTreeId("apple_tree"), true);
    assert.equal(Settlement.fruitTreeId("coconut_tree"), true);
    assert.equal(Settlement.fruitTreeId("palm_tree"), false);
    assert.equal(Settlement.fruitTreeId("tree"), false);
    assert.equal(Settlement.chopSkipsTree("apple_tree", { lootable: { item: "apple" } }), true);
    assert.equal(Settlement.chopSkipsTree("coconut_tree", { lootable: { item: "coconut" } }), true);
    assert.equal(Settlement.chopSkipsTree("palm_tree", { choppable: { stump: "coconut_tree_stump" } }), false);
    assert.equal(Settlement.chopSkipsTree("tree", { choppable: { stump: "tree_stump" } }), false);
    assert.equal(Settlement.chopSkipsTree("snow_tree", { choppable: { stump: "snow_tree_stump" } }), false);
});

test("stock counts settler inventories so gather/chop stop before deposit", () => {
    const settle = Settlement.createSettlement({ x: 0, y: 0 });
    settle.stock = Settlement.normalizeStock({ log: 10, stick: 8 });
    const baskets = [{ slots: [{ id: "log", quantity: 4 }] }];
    const pawns = [
        { inventory: [{ id: "log", quantity: 3 }, { id: "stick", quantity: 8 }], overflow: [] },
        { inventory: [{ id: "log", quantity: 3 }], overflow: [{ id: "log", quantity: 1 }] }
    ];
    const logs = Settlement.countStock(baskets, "log") + Settlement.countPawnStock(pawns, "log");
    const sticks = Settlement.countStock(baskets, "stick") + Settlement.countPawnStock(pawns, "stick");
    assert.equal(logs, 11);
    assert.equal(sticks, 8);
    assert.equal(Settlement.gatherShouldWork(logs, settle.stock.log), false);
    assert.equal(Settlement.stockShort(settle, baskets, "log", pawns), 0);
    assert.equal(Settlement.gatherShouldWork(Settlement.countStock(baskets, "log"), settle.stock.log), true);
});

test("stock counts ground drops in range so chop/gather stop", () => {
    const settle = Settlement.createSettlement({ x: 0, y: 0 });
    settle.stock = Settlement.normalizeStock({ log: 10, stick: 8 });
    const baskets = [{ slots: [{ id: "log", quantity: 4 }] }];
    const pawns = [{ inventory: [{ id: "log", quantity: 2 }], overflow: [] }];
    const drops = [
        { id: "log", quantity: 4, x: 8, y: 8 },
        { item: { id: "stick" }, quantity: 8, x: 4, y: 4 },
        { id: "log", quantity: 3, x: 9999, y: 9999 }
    ];
    const inRange = drops.filter((d) => Settlement.inRange(settle, d.x, d.y, 16));
    const logs = Settlement.countStock(baskets, "log")
        + Settlement.countPawnStock(pawns, "log")
        + Settlement.countDropStock(inRange, "log");
    const sticks = Settlement.countDropStock(inRange, "stick");
    assert.equal(logs, 10);
    assert.equal(sticks, 8);
    assert.equal(Settlement.stockShort(settle, baskets, "log", pawns, inRange), 0);
    assert.equal(Settlement.gatherShouldWork(logs, settle.stock.log), false);
    assert.equal(Settlement.dropItemId({ item: { id: "leaf" }, quantity: 2 }), "leaf");
    assert.equal(Settlement.dropItemId({ id: 47, item: { id: "log" }, quantity: 1 }), "log");
});

test("roast cook helpers tell input from output and the stick", () => {
    const items = {
        apple: { cook: { stick_roast: { result: "roasted_apple", minutes: 10 } } },
        roasted_apple: {},
        sharp_stick: { cook: { method: "stick_roast" } },
        blueberry: {}
    };
    const getItem = (id) => items[id] || null;
    const bill = Settlement.makeBill({
        recipeId: "roast",
        mode: "forever",
        allowedIds: ["apple"]
    });
    assert.equal(Settlement.billAllowsInput(bill, "apple"), true);
    assert.equal(Settlement.billAllowsInput(bill, "blueberry"), false);
    assert.equal(Settlement.cookInputReady(getItem, { id: "apple" }, bill), true);
    assert.equal(Settlement.cookInputReady(getItem, { id: "roasted_apple" }, bill), false);
    assert.equal(Settlement.cookOutputReady(getItem, { id: "roasted_apple" }, bill), true);
    assert.equal(Settlement.isCookTool(getItem, { id: "sharp_stick" }, "stick_roast"), true);
    assert.equal(Settlement.isCookTool(getItem, { id: "apple" }, "stick_roast"), false);
});

test("cook can light/relight when a firestarter is in storage", () => {
    const getItem = (id) => (id === "fire_drill" ? { use: "light_fire" } : {});
    assert.equal(Settlement.isFirestarter({ id: "fire_drill" }, getItem), true);
    assert.equal(Settlement.cookCanLight({ hasFirestarter: true, hasFuel: true }), true);
    assert.equal(Settlement.cookCanLight({ hasFirestarter: false, hasFuel: true }), false);
});

test("destroy confirm lists people who will wander off together", () => {
    const copy = Settlement.destroyConfirmCopy("River Camp", ["Og", "Bo"]);
    assert.equal(copy.question, "Are you sure you'd like to destroy River Camp?");
    assert.equal(copy.peopleLead, "The following people will become wanderers:");
    assert.deepEqual(copy.names, ["Og", "Bo"]);
    assert.equal(Settlement.destroyConfirmCopy("Camp", []).peopleLead, "");
    assert.deepEqual(Settlement.cardinalHeading(() => 0), { x: 1, y: 0 });
    const a = Settlement.cardinalHeading(() => 0.1);
    const b = Settlement.cardinalHeading(() => 0.1);
    assert.deepEqual(a, b);
    assert.equal(Settlement.partyHasRoom(6, 6), false);
    assert.equal(Settlement.partyHasRoom(5, 6), true);
});

test("dedicated MP pins settler chunks while owner is offline", () => {
    const settle = Settlement.createSettlement({ ownerId: "gone", x: 0, y: 0 });
    assert.equal(Settlement.shouldPin(settle, 2), true);
    const keys = Settlement.chunkKeysFor(settle, 16, 8);
    assert.ok(keys.includes("0,0"));
});

test("other players cannot open settlement UI (owner-only atPoint)", () => {
    const list = [Settlement.createSettlement({ ownerId: "owner", x: 0, y: 0 })];
    assert.ok(Settlement.atPoint(list, 0, 0, 16, "owner"));
    assert.equal(Settlement.atPoint(list, 0, 0, 16, "intruder"), null);
});

test("idle home stand does not overlap the stone hitbox", () => {
    const settle = { x: 100, y: 200 };
    const home = Settlement.idleHome(settle);
    const hs = 5;
    const stone = {
        left: settle.x - hs / 2,
        right: settle.x + hs / 2,
        top: settle.y - hs,
        bottom: settle.y
    };
    const body = {
        left: home.x - 4,
        right: home.x + 4,
        top: home.y - 8,
        bottom: home.y
    };
    const overlap = body.right > stone.left && body.left < stone.right
        && body.bottom > stone.top && body.top < stone.bottom;
    assert.equal(overlap, false);
});

test("idle roam points stay near the stone", () => {
    const settle = Settlement.createSettlement({ ownerId: "o", x: 100, y: 200 });
    let i = 0;
    const rng = () => {
        i += 1;
        return (i * 0.17) % 1;
    };
    for (let n = 0; n < 24; n++) {
        const p = Settlement.idleRoamPoint(settle, rng, 16, { x: 100, y: 208 });
        const d = Settlement.idleRoamDistTiles(settle, p.x, p.y, 16);
        assert.ok(d >= 1.2 && d <= 5, `roam ${d} tiles from stone`);
    }
    assert.ok(Settlement.idleRoamDistTiles(settle, 100 + 16 * 10, 208, 16) > Settlement.IDLE_ROAM_HARD);
});

test("job tooltip lists work inside the column", () => {
    assert.equal(Settlement.jobLabel("gather"), "Get");
    const cook = Settlement.jobTooltip("cook");
    assert.match(cook, /^Cook\n/);
    assert.match(cook, /^- Light campfire$/m);
    assert.match(cook, /^- Roast at campfire$/m);
    assert.match(cook, /^- Simmer at campfire$/m);
    assert.match(cook, /^- Smoke leather$/m);
    const hide = Settlement.jobTooltip("leather");
    assert.match(hide, /Flesh hides/);
    assert.match(hide, /Soak hides/);
    assert.match(hide, /Brain-tan hides/);
    assert.match(hide, /skinworking bench/);
});

test("planWork: eat, night sleep, jobs, orphan idle", () => {
    assert.equal(Settlement.planWork({ kc: 200 }).type, "eat");
    assert.equal(Settlement.planWork({ kc: 200, canEat: false }).type, "idle");
    assert.equal(Settlement.planWork({ kc: 2000, isNight: true, bed: { slot: 0 } }).type, "sleep");
    assert.equal(Settlement.planWork({ kc: 2000, isNight: true }).type, "idle");
    assert.equal(Settlement.planWork({ kc: 2000, isOrphan: true }).type, "idle");
    assert.equal(Settlement.planWork({
        kc: 2000,
        isNight: true,
        isOrphan: true,
        bed: { slot: 0 }
    }).type, "idle");
    assert.equal(Settlement.planWork({
        kc: 2000,
        injured: true,
        isOrphan: true,
        bed: { slot: 0 }
    }).type, "idle");
    const jobs = Settlement.defaultJobs();
    jobs.gather = 1;
    jobs.doctor = 0;
    jobs.cook = 0;
    jobs.leather = 0;
    jobs.haul = 0;
    jobs.chop = 0;
    assert.equal(Settlement.planWork({
        kc: 2000,
        jobs,
        gatherThing: { id: "stick_bush" }
    }).type, "gather");
    const haulJobs = Settlement.defaultJobs();
    haulJobs.doctor = 0;
    haulJobs.cook = 0;
    haulJobs.leather = 0;
    haulJobs.gather = 0;
    haulJobs.chop = 0;
    const merge = { kind: "pack", basket: { uid: "b1" } };
    const mergePlan = Settlement.planWork({ kc: 2000, jobs: haulJobs, haulMerge: merge });
    assert.equal(mergePlan.type, "haul");
    assert.equal(mergePlan.target, merge);
    const drop = { id: "stick-drop" };
    assert.equal(Settlement.planWork({
        kc: 2000,
        jobs: haulJobs,
        haulDrop: drop,
        haulMerge: merge
    }).target, drop);
    assert.equal(Settlement.settlerShouldSleep(true, false), true);
    assert.equal(Settlement.settlerShouldSleep(false, true), true);
    assert.equal(Settlement.settlerShouldSleep(false, false), false);
});

test("settlers keep the best weapon (and a bandage while tending) when stashing", () => {
    const getItem = (id) => ({
        stick: { id: "stick" },
        spear: { id: "spear", weapon: { type: "melee", melee: { damage: 10 } } },
        pebble_blade: { id: "pebble_blade", weapon: { type: "melee", melee: { damage: 3 } } },
        leaf_cord: { id: "leaf_cord", bandage: { tendQuality: 0.4 } }
    }[id]);
    const inv = [
        { id: "stick", quantity: 4 },
        { id: "pebble_blade", toolClass: "blade", knapDamage: 3 },
        { id: "spear", quantity: 1 },
        { id: "leaf_cord", quantity: 2 },
        { id: "stick", quantity: 1 }
    ];
    const keep = Settlement.keepIndices(inv, getItem);
    assert.equal(keep.has(2), true);
    assert.equal(keep.size, 1);
    const withBandage = Settlement.keepIndices(inv, getItem, { keepBandage: true });
    assert.equal(withBandage.has(2), true);
    assert.equal(withBandage.has(3), true);
    assert.equal(withBandage.size, 2);
    const canStore = () => true;
    assert.equal(Settlement.hasStashable(inv, [], getItem, canStore), true);
    assert.equal(Settlement.hasStashable(
        [{ id: "spear", quantity: 1 }, null, null, null, null],
        [],
        getItem,
        canStore
    ), false);
    assert.equal(Settlement.stashIsUrgent(inv, [], getItem, canStore), true);
    assert.equal(Settlement.stashIsUrgent(
        [{ id: "stick", quantity: 1 }, { id: "spear", quantity: 1 }, null, null, null],
        [],
        getItem,
        canStore
    ), false);
    assert.equal(Settlement.stashIsUrgent(
        [{ id: "spear", quantity: 1 }, null, null, null, null],
        [{ id: "stick", quantity: 3 }],
        getItem,
        canStore
    ), true);
});

test("planWork dumps full pockets before other jobs, leftovers before idle", () => {
    const jobs = Settlement.defaultJobs();
    const basket = { x: 8, y: 8, slots: [] };
    assert.equal(Settlement.planWork({
        kc: 2000,
        jobs,
        gatherThing: { id: "stick_bush" },
        stashBasket: basket,
        hasStash: true,
        stashUrgent: true
    }).type, "stash");
    assert.equal(Settlement.planWork({
        kc: 2000,
        jobs,
        patients: [{ id: "hurt" }],
        stashBasket: basket,
        hasStash: true,
        stashUrgent: true
    }).type, "stash");
    assert.equal(Settlement.planWork({
        kc: 2000,
        jobs,
        patients: [{ id: "hurt" }],
        stashBasket: basket,
        hasStash: true,
        stashUrgent: false
    }).type, "doctor");
    assert.equal(Settlement.planWork({
        kc: 2000,
        jobs,
        gatherThing: { id: "stick_bush" },
        stashBasket: basket,
        hasStash: true,
        stashUrgent: false
    }).type, "gather");
    const idleJobs = Settlement.defaultJobs();
    idleJobs.doctor = 0;
    idleJobs.cook = 0;
    idleJobs.leather = 0;
    idleJobs.haul = 0;
    idleJobs.gather = 0;
    idleJobs.chop = 0;
    assert.equal(Settlement.planWork({
        kc: 2000,
        jobs: idleJobs,
        stashBasket: basket,
        hasStash: true,
        stashUrgent: false
    }).type, "stash");
});

test("pickAutoEat extraBags from settlement baskets, not traveling party", () => {
    const eater = { id: "s", x: 0, y: 0, inventory: [], overflow: [] };
    const party = [{
        id: "leader",
        x: 0,
        y: 0,
        inventory: [{ id: "apple", quantity: 1, food: { kc: 200 } }],
        overflow: []
    }];
    const fromParty = Party.pickAutoEat(eater, [eater], {
        getFood: (s) => s.food,
        extraBags: []
    });
    assert.equal(fromParty, null);
    const fromBasket = Party.pickAutoEat(eater, [eater], {
        getFood: (s) => s.food,
        extraBags: [{
            x: 0,
            y: 0,
            slots: [{ id: "blueberry", quantity: 2, food: { kc: 80 } }],
            bag: "basket"
        }]
    });
    assert.equal(fromBasket.stack.id, "blueberry");
    assert.equal(fromBasket.inRange, true);
    const farBasket = Party.pickAutoEat(eater, [eater], {
        tileSize: 16,
        seekTiles: 32,
        interactTiles: 1,
        getFood: (s) => s.food,
        extraBags: [{
            x: 16 * 10,
            y: 0,
            slots: [{ id: "apple", quantity: 1, food: { kc: 200 } }],
            bag: "basket",
            host: { x: 16 * 10, y: 0, active: true }
        }]
    });
    assert.equal(farBasket.stack.id, "apple");
    assert.equal(farBasket.inRange, false);
    const skipLeader = Party.pickAutoEat(eater, party, {
        skipPawnId: "leader",
        getFood: (s) => s.food
    });
    assert.equal(skipLeader, null);
});

test("night check matches veil clock", () => {
    assert.equal(Settlement.isNight(1230), true);
    assert.equal(Settlement.isNight(200), true);
    assert.equal(Settlement.isNight(800), false);
});

test("work claims are exclusive and move with the pawn", () => {
    const c = Settlement.createWorkClaims();
    assert.equal(c.claim("station:a", "p1"), true);
    assert.equal(c.claim("station:a", "p2"), false);
    assert.equal(c.claimedBy("station:a"), "p1");
    assert.equal(c.isFree("station:a", "p1"), true);
    assert.equal(c.isFree("station:a", "p2"), false);
    assert.equal(c.held("p1"), "station:a");
    assert.equal(c.claim("station:b", "p1"), true);
    assert.equal(c.claimedBy("station:a"), null);
    assert.equal(c.claimedBy("station:b"), "p1");
    assert.equal(c.claim("station:b", "p2"), false);
    c.release("p1");
    assert.equal(c.claim("station:a", "p2"), true);
    c.prune(["p2"]);
    assert.equal(c.claimedBy("station:a"), "p2");
    c.prune([]);
    assert.equal(c.claimedBy("station:a"), null);

    assert.equal(c.claim("thing:oak", "a"), true);
    assert.equal(c.claim("thing:oak", "b"), false);
    assert.equal(c.claim("drop:log1", "b"), true);
    assert.equal(c.claim("drop:log1", "a"), false);
    assert.equal(c.claim("tend:p9", "a"), true);
    assert.equal(c.claim("tend:p9", "b"), false);
    assert.equal(c.claim("bed:lean:0", "b"), true);
    assert.equal(c.claim("bed:lean:0", "a"), false);
});
