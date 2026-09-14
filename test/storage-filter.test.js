const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadDefs } = require("./helpers/load");
const SF = require("../shared/storageFilter");

function items() {
    return loadDefs()._store.itemsList;
}

function getItem(id) {
    return loadDefs().getItem(id);
}

function tree() {
    return SF.buildTree(items());
}

test("default filter allows everything", () => {
    const f = SF.emptyFilter();
    assert.equal(SF.allows(f, { id: "stick" }, getItem), true);
    assert.equal(SF.allows(null, { id: "rot" }, getItem), true);
    assert.equal(SF.allows(undefined, { id: "wooden_spear" }, getItem), true);
    assert.equal(SF.isEmpty(f), true);
    assert.equal(SF.persist(f), null);
});

test("deny category then item exception", () => {
    const t = tree();
    let f = SF.toggleCategory(SF.emptyFilter(), t, "food");
    assert.equal(SF.categoryState(f, t, "food"), "off");
    assert.equal(SF.allows(f, { id: "apple" }, getItem), false);
    assert.equal(SF.allows(f, { id: "stick" }, getItem), true);
    f = SF.toggleItem(f, t, "apple");
    assert.equal(SF.itemState(f, t, "apple"), "on");
    assert.equal(SF.allows(f, { id: "apple" }, getItem), true);
    assert.equal(SF.allows(f, { id: "blueberry" }, getItem), false);
    assert.equal(SF.categoryState(f, t, "food"), "mixed");
});

test("parent toggle sets descendants and clears exceptions", () => {
    const t = tree();
    let f = SF.toggleCategory(SF.emptyFilter(), t, "food");
    f = SF.toggleItem(f, t, "apple");
    assert.ok(f.onItems.includes("apple"));
    f = SF.toggleCategory(f, t, "food");
    assert.equal(SF.categoryState(f, t, "food"), "on");
    assert.equal(f.onItems.includes("apple"), false);
    assert.equal(SF.allows(f, { id: "apple" }, getItem), true);
    f = SF.toggleCategory(f, t, "food");
    assert.equal(SF.categoryState(f, t, "food"), "off");
    assert.equal(SF.allows(f, { id: "roasted_apple" }, getItem), false);
});

test("priority order critical > important > preferred > normal > low", () => {
    const ranks = SF.PRIORITIES.map((p) => SF.priorityRank(p));
    assert.deepEqual(ranks, [0, 1, 2, 3, 4]);
    assert.ok(SF.priorityRank("critical") > SF.priorityRank("important"));
    assert.ok(SF.priorityRank("important") > SF.priorityRank("preferred"));
    assert.ok(SF.priorityRank("preferred") > SF.priorityRank("normal"));
    assert.ok(SF.priorityRank("normal") > SF.priorityRank("low"));
    assert.equal(SF.cyclePriority("normal", 1), "preferred");
    assert.equal(SF.cyclePriority("critical", 1), "low");
    assert.equal(SF.cyclePriority("normal", -1), "low");
});

test("knapped stack uses toolClass key not unique silhouette", () => {
    const def = getItem("stone_tool");
    const knap = { id: "stone_tool", toolClass: "chopper", knapIconData: { unique: true }, quantity: 1 };
    const awl = { id: "stone_tool", toolClass: "awl", quantity: 1 };
    const tip = { id: "stone_tool", toolClass: "spear_tip", quantity: 1 };
    const flake = { id: "stone_tool", toolClass: "blank", quantity: 1 };
    const flintFlake = { id: "flint_tool", toolClass: "blank", quantity: 1 };
    assert.equal(SF.filterKey(knap, def), "tool:chopper");
    assert.equal(SF.filterKey(awl, def), "tool:awl");
    assert.equal(SF.filterKey(tip, def), "tool:spear_tip");
    assert.equal(SF.filterKey(flake, def), "tool:blank");
    assert.equal(SF.filterKey(flintFlake, getItem("flint_tool")), "tool:blank");
    assert.equal(SF.filterKey({ id: "stone_tool" }, def), "tool:blank");
    assert.equal(SF.filterKey({ id: "bone" }, getItem("bone")), "bone");
    const t = tree();
    const tools = SF.findNode(t, "tools");
    const ids = (tools.items || []).map((it) => it.id);
    assert.deepEqual(ids, [
        "tool:awl", "bone", "tool:chopper", "digging_stick",
        "tool:knife", "tool:scraper"
    ]);
    assert.equal(ids.includes("stone_tool"), false);
    assert.equal(ids.includes("flint_tool"), false);
    assert.equal(SF.filterKey({ id: "digging_stick", toolClass: "digger" }, getItem("digging_stick")), "digging_stick");
    const stoneIds = (SF.findNode(t, "materials/stone").items || []).map((it) => it.id);
    assert.ok(stoneIds.includes("tool:spear_tip"));
    assert.ok(stoneIds.includes("tool:blank"));
    assert.equal(stoneIds.includes("tool:chopper"), false);
    const junkIds = (SF.findNode(t, "junk").items || []).map((it) => it.id);
    assert.equal(junkIds.includes("tool:blank"), false);
    let f = SF.toggleItem(SF.emptyFilter(), t, "tool:chopper");
    assert.equal(SF.allows(f, knap, getItem), false);
    assert.equal(SF.allows(f, { id: "bone" }, getItem), true);
    f = SF.toggleItem(SF.emptyFilter(), t, "tool:awl");
    assert.equal(SF.allows(f, awl, getItem), false);
    assert.equal(SF.allows(f, { id: "bone" }, getItem), true);
    f = SF.toggleItem(SF.emptyFilter(), t, "bone");
    assert.equal(SF.allows(f, { id: "bone" }, getItem), false);
    assert.equal(SF.allows(f, awl, getItem), true);
    f = SF.toggleItem(SF.emptyFilter(), t, "tool:spear_tip");
    assert.equal(SF.allows(f, tip, getItem), false);
    assert.equal(SF.allows(f, knap, getItem), true);
    assert.equal(SF.allows(f, flake, getItem), true);
    f = SF.toggleItem(SF.emptyFilter(), t, "tool:blank");
    assert.equal(SF.allows(f, flake, getItem), false);
    assert.equal(SF.allows(f, flintFlake, getItem), false);
    assert.equal(SF.allows(f, knap, getItem), true);
    f = SF.toggleCategory(SF.emptyFilter(), t, "materials/stone");
    assert.equal(SF.allows(f, tip, getItem), false);
    assert.equal(SF.allows(f, flake, getItem), false);
    assert.equal(SF.allows(f, flintFlake, getItem), false);
    assert.equal(SF.allows(f, { id: "pebble" }, getItem), false);
    assert.equal(SF.allows(f, knap, getItem), true);
    f = SF.toggleCategory(SF.emptyFilter(), t, "tools");
    assert.equal(SF.allows(f, tip, getItem), true);
    assert.equal(SF.allows(f, knap, getItem), false);
    assert.equal(SF.allows(f, flake, getItem), true);
    f = SF.toggleCategory(SF.emptyFilter(), t, "junk");
    assert.equal(SF.allows(f, flake, getItem), true);
    assert.equal(SF.allows(f, flintFlake, getItem), true);
    assert.equal(SF.allows(f, knap, getItem), true);
});

test("figurine stack uses formClass art leaf", () => {
    const def = getItem("clay_figurine");
    const animal = { id: "clay_figurine", formClass: "animal", quantity: 1 };
    const lump = { id: "clay_figurine", formClass: "lump", formVoxels: "x", quantity: 1 };
    assert.equal(SF.filterKey(animal, def), "art:animal");
    assert.equal(SF.filterKey(lump, def), "art:lump");
    const t = tree();
    const art = SF.findNode(t, "art");
    const ids = (art.items || []).map((it) => it.id);
    assert.ok(ids.includes("art:animal"));
    assert.ok(ids.includes("art:human"));
    assert.ok(ids.includes("art:deity"));
    assert.ok(ids.includes("art:lump"));
    assert.equal(ids.includes("clay_figurine"), false);
    assert.equal((art.items || []).find((it) => it.id === "art:lump")?.key, "clay");
    assert.equal((art.items || []).find((it) => it.id === "art:animal")?.key, null);
    assert.equal((art.items || []).find((it) => it.id === "art:human")?.key, null);
    assert.equal((art.items || []).find((it) => it.id === "art:deity")?.key, null);
    let f = SF.toggleItem(SF.emptyFilter(), t, "art:animal");
    assert.equal(SF.allows(f, animal, getItem), false);
    assert.equal(SF.allows(f, lump, getItem), true);
    f = SF.toggleCategory(SF.emptyFilter(), t, "art");
    assert.equal(SF.allows(f, animal, getItem), false);
    assert.equal(SF.allows(f, lump, getItem), false);
    assert.equal(SF.allows(f, { id: "stick" }, getItem), true);
});

test("hides nest by processing stage not animal", () => {
    const t = tree();
    assert.equal(SF.leafCategory(getItem("deer_hide"), null), "materials/hides/raw");
    assert.equal(SF.leafCategory(getItem("boar_hide"), null), "materials/hides/raw");
    assert.equal(SF.leafCategory(getItem("deer_hide_fleshed"), null), "materials/hides/fleshed");
    assert.equal(SF.leafCategory(getItem("deer_hide_dry"), null), "materials/hides/dried");
    assert.equal(SF.leafCategory(getItem("deer_hide_soaked"), null), "materials/hides/soaked");
    assert.equal(SF.leafCategory(getItem("deer_hide_dehaired"), null), "materials/hides/dehaired");
    assert.equal(SF.leafCategory(getItem("deer_hide_brained"), null), "materials/hides/brained");
    assert.equal(SF.leafCategory(getItem("deer_leather"), null), "materials/leather");
    assert.equal(SF.leafCategory(getItem("boar_leather"), null), "materials/leather");
    const rawIds = (SF.findNode(t, "materials/hides/raw").items || []).map((it) => it.id);
    assert.ok(rawIds.includes("deer_hide"));
    assert.ok(rawIds.includes("boar_hide"));
    const driedIds = (SF.findNode(t, "materials/hides/dried").items || []).map((it) => it.id);
    assert.ok(driedIds.includes("deer_hide_dry"));
    assert.ok(driedIds.includes("boar_hide_dry"));
    const leatherIds = (SF.findNode(t, "materials/leather").items || []).map((it) => it.id);
    assert.ok(leatherIds.includes("deer_leather"));
    assert.ok(leatherIds.includes("boar_leather"));
    assert.equal(leatherIds.includes("deer_hide"), false);
    const hidesNode = SF.findNode(t, "materials/hides");
    assert.equal((hidesNode.items || []).length, 0);
    let f = SF.toggleCategory(SF.emptyFilter(), t, "materials/hides/dried");
    assert.equal(SF.allows(f, { id: "deer_hide_dry" }, getItem), false);
    assert.equal(SF.allows(f, { id: "boar_hide_dry" }, getItem), false);
    assert.equal(SF.allows(f, { id: "deer_hide" }, getItem), true);
    assert.equal(SF.allows(f, { id: "deer_leather" }, getItem), true);
    f = SF.toggleCategory(SF.emptyFilter(), t, "materials/hides");
    assert.equal(SF.allows(f, { id: "deer_hide" }, getItem), false);
    assert.equal(SF.allows(f, { id: "deer_hide_brained" }, getItem), false);
    assert.equal(SF.allows(f, { id: "deer_leather" }, getItem), true);
    f = SF.toggleCategory(SF.emptyFilter(), t, "materials/leather");
    assert.equal(SF.allows(f, { id: "deer_leather" }, getItem), false);
    assert.equal(SF.allows(f, { id: "deer_hide_dry" }, getItem), true);
});

test("allows for sprite-like stacks with numeric id", () => {
    const sprite = { id: 42, item: getItem("stick"), quantity: 3 };
    assert.equal(SF.stackId(sprite), "stick");
    assert.equal(SF.allows(null, sprite, getItem), true);
    const t = tree();
    const f = SF.toggleCategory(SF.emptyFilter(), t, "materials/wood");
    assert.equal(SF.allows(f, sprite, getItem), false);
});

test("every item lands in exactly one leaf", () => {
    const list = items();
    const t = tree();
    const seen = new Set();
    const walk = (nodes) => {
        for (const n of nodes || []) {
            for (const it of n.items || []) {
                assert.equal(seen.has(it.id), false, `duplicate ${it.id}`);
                seen.add(it.id);
            }
            walk(n.children);
        }
    };
    walk(t);
    assert.ok(seen.has("tool:blank"));
    for (const def of list) {
        if (!def?.id) continue;
        const leaf = SF.leafCategory(def, SF.roastResultIds(list));
        assert.ok(leaf, def.id);
        if (def.toolClass) {
            assert.equal(leaf, "tools");
            if (SF.TOOL_CLASSES.some((t) => t.cls === def.toolClass)) {
                assert.ok(seen.has(`tool:${def.toolClass}`), def.id);
            }
        }
        if (def.id === "stone_tool" || def.id === "flint_tool" || def.id === "clay_figurine") {
            assert.equal(seen.has(def.id), false, `${def.id} should be hidden from tree`);
            continue;
        }
        assert.ok(seen.has(def.id), `${def.id} missing from tree (leaf ${leaf})`);
    }
    assert.equal(SF.leafCategory(getItem("cactus_flower"), null), "apparel/clothing");
    assert.equal(SF.leafCategory(getItem("leaf_wrap"), null), "apparel/clothing");
    assert.equal(SF.leafCategory(getItem("leaf_pouch"), null), "apparel/equipment");
    assert.equal(SF.leafCategory(getItem("hide_bundle"), null), "apparel/equipment");
    assert.equal(SF.leafCategory(getItem("leather_pack"), null), "apparel/equipment");
    assert.equal(SF.leafCategory(getItem("coconut_meal"), null), "food/meals");
    assert.equal(SF.isPreparedFood({ id: "coconut_meal" }, getItem("coconut_meal")), true);
    assert.equal(SF.isPreparedFood({ id: "roasted_apple" }, getItem("roasted_apple")), true);
    assert.equal(SF.isPreparedFood({
        id: "coconut_meal",
        customName: "Simmered Meal",
        ingredients: ["apple"]
    }, getItem("coconut_meal")), true);
    assert.equal(SF.isPreparedFood({ id: "apple" }, getItem("apple")), false);
    assert.equal(SF.isPreparedFood({ id: "blueberry" }, getItem("blueberry")), false);
    assert.equal(SF.isPreparedFood({ id: "raw_venison" }, getItem("raw_venison")), false);
    assert.equal(SF.leafCategory(getItem("rot"), null), "junk");
    assert.equal(SF.leafCategory(getItem("brain"), null), "junk");
    assert.equal(SF.leafCategory(getItem("lean_to"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("wicker_basket"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("drying_rack"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("skinworking_bench"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("settling_stone"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("tally_stick"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("leaf_cord"), null), "medicine");
    assert.equal(SF.leafCategory(getItem("poultice"), null), "medicine");
    assert.equal(SF.leafCategory(getItem("digging_stick"), null), "tools");
    assert.equal(SF.leafCategory(getItem("stick_frame"), null), "materials/wood");
    assert.equal(SF.leafCategory(getItem("stick"), null), "materials/wood");
    assert.equal(SF.leafCategory(getItem("clay"), null), "materials");
    const materialKids = (SF.findNode(t, "materials").children || []).map((n) => n.id);
    assert.deepEqual(materialKids, [
        "materials/hides", "materials/leather", "materials/stone", "materials/wood"
    ]);
    const hideKids = (SF.findNode(t, "materials/hides").children || []).map((n) => n.id);
    assert.deepEqual(hideKids, [
        "materials/hides/raw", "materials/hides/fleshed", "materials/hides/dried",
        "materials/hides/soaked", "materials/hides/dehaired", "materials/hides/brained"
    ]);
    assert.equal(SF.findNode(t, "materials/clay"), null);
    assert.equal(SF.findNode(t, "materials/fuel"), null);
    const materialIds = (SF.findNode(t, "materials").items || []).map((it) => it.id);
    assert.deepEqual(materialIds, ["clay"]);
    let clayFilt = SF.toggleCategory(SF.emptyFilter(), t, "materials");
    assert.equal(SF.allows(clayFilt, { id: "clay" }, getItem), false);
    clayFilt = SF.toggleCategory(SF.emptyFilter(), t, "materials/stone");
    assert.equal(SF.allows(clayFilt, { id: "clay" }, getItem), true);
    clayFilt = SF.toggleCategory(SF.emptyFilter(), t, "junk");
    assert.equal(SF.allows(clayFilt, { id: "clay" }, getItem), true);
    const woodIds = (SF.findNode(t, "materials/wood").items || []).map((it) => it.id);
    assert.ok(woodIds.includes("stick_frame"));
    assert.ok(woodIds.includes("stick"));
    assert.ok(woodIds.includes("log"));
    const buildings = SF.findNode(t, "buildings");
    assert.ok((buildings.items || []).some((it) => it.id === "wicker_basket"));
    assert.ok((buildings.items || []).some((it) => it.id === "tally_stick"));
    const medicine = SF.findNode(t, "medicine");
    assert.deepEqual((medicine.items || []).map((it) => it.id), ["leaf_cord", "poultice"]);
    const apparelKids = (SF.findNode(t, "apparel").children || []).map((n) => n.id);
    assert.deepEqual(apparelKids, ["apparel/clothing", "apparel/equipment"]);
    assert.equal(SF.findNode(t, "apparel/armor"), null);
    assert.ok((SF.findNode(t, "apparel/clothing").items || []).some((it) => it.id === "cactus_flower"));
    assert.ok((SF.findNode(t, "apparel/equipment").items || []).some((it) => it.id === "leaf_pouch"));
});

test("pickBasket prefers higher priority then nearest", () => {
    const stack = { id: "stick", quantity: 1 };
    const empty = () => [null, null];
    const low = { x: 0, y: 0, slots: empty(), storageFilter: { priority: "low" } };
    const critFar = { x: 100, y: 0, slots: empty(), storageFilter: { priority: "critical" } };
    const critNear = { x: 10, y: 0, slots: empty(), storageFilter: { priority: "critical" } };
    const pick = SF.pickBasket([low, critFar, critNear], stack, getItem, 0, 0);
    assert.equal(pick, critNear);
    const denied = {
        x: 0, y: 0, slots: empty(),
        storageFilter: { priority: "critical", offCategories: ["materials"] }
    };
    const normal = { x: 50, y: 0, slots: empty(), storageFilter: { priority: "normal" } };
    assert.equal(SF.pickBasket([denied, normal], stack, getItem, 0, 0), normal);
    const full = { x: 0, y: 0, slots: [{ id: "apple", quantity: 1 }, { id: "rot", quantity: 1 }] };
    assert.equal(SF.pickBasket([full], stack, getItem, 0, 0), null);
    const sprite = {
        x: 4, y: 0,
        entry: { x: 4, y: 0, slots: empty(), storageFilter: { priority: "preferred" } }
    };
    assert.equal(SF.pickBasket([sprite], stack, getItem, 0, 0), sprite);
});

test("compactSlots merges partial stacks in one basket", () => {
    const slots = [
        { id: "stick", quantity: 40 },
        { id: "apple", quantity: 2 },
        { id: "stick", quantity: 15 },
        null
    ];
    assert.equal(SF.needsCompact(slots, getItem), true);
    assert.equal(SF.compactSlots(slots, getItem), true);
    assert.equal(slots[0].quantity, 55);
    assert.equal(slots[1].id, "apple");
    assert.equal(slots[2], null);
    assert.equal(SF.needsCompact(slots, getItem), false);
    const fullish = [{ id: "stick", quantity: 99 }, { id: "stick", quantity: 20 }];
    assert.equal(SF.needsCompact(fullish, getItem), false);
    assert.equal(SF.compactSlots(fullish, getItem), false);
    assert.equal(fullish[0].quantity, 99);
    assert.equal(fullish[1].quantity, 20);
});

test("findMergeJob packs a basket or moves between same-priority storage", () => {
    const a = {
        uid: "a", x: 0, y: 0,
        slots: [{ id: "stick", quantity: 10 }, { id: "stick", quantity: 8 }, null],
        storageFilter: { priority: "normal" }
    };
    const intra = SF.findMergeJob([a], getItem, 0, 0);
    assert.equal(intra.kind, "pack");
    assert.equal(intra.basket, a);

    const src = {
        uid: "src", x: 0, y: 0,
        slots: [{ id: "stick", quantity: 12 }, null],
        storageFilter: { priority: "normal" }
    };
    const dest = {
        uid: "dest", x: 40, y: 0,
        slots: [{ id: "stick", quantity: 20 }, { id: "apple", quantity: 1 }],
        storageFilter: { priority: "normal" }
    };
    const move = SF.findMergeJob([src, dest], getItem, 0, 0);
    assert.equal(move.kind, "move");
    assert.equal(move.from, src);
    assert.equal(move.to, dest);
    assert.equal(move.stackId, "stick");

    const crit = {
        uid: "crit", x: 8, y: 0,
        slots: [{ id: "stick", quantity: 5 }, null],
        storageFilter: { priority: "critical" }
    };
    const acrossPri = SF.findMergeJob([src, crit], getItem, 0, 0);
    assert.equal(acrossPri.kind, "move");
    assert.equal(acrossPri.to, crit);

    const denied = {
        uid: "no", x: 8, y: 0,
        slots: [{ id: "stick", quantity: 20 }, null],
        storageFilter: { priority: "normal", offCategories: ["materials"] }
    };
    const outOfDenied = SF.findMergeJob([src, denied], getItem, 0, 0);
    assert.equal(outOfDenied.kind, "move");
    assert.equal(outOfDenied.from, denied);
    assert.equal(outOfDenied.to, src);
    assert.equal(outOfDenied.reason, "wrong");
});

test("findMergeJob takes disallowed items to a basket that wants them", () => {
    const apparel = {
        uid: "apparel", x: 0, y: 0,
        slots: [
            { id: "leaf_wrap", quantity: 1 },
            { id: "stick", quantity: 8 },
            { id: "pebble", quantity: 3 },
            null
        ],
        storageFilter: { priority: "normal", offCategories: ["materials", "food", "tools", "weapons", "junk", "buildings", "medicine", "art"] }
    };
    const wood = {
        uid: "wood", x: 40, y: 0,
        slots: [null, null, null, null],
        storageFilter: { priority: "normal", offCategories: ["apparel", "food", "tools", "weapons", "junk", "buildings", "medicine", "art"] }
    };
    const job = SF.findMergeJob([apparel, wood], getItem, 0, 0);
    assert.ok(job);
    assert.equal(job.kind, "move");
    assert.equal(job.reason, "wrong");
    assert.equal(job.from, apparel);
    assert.equal(job.to, wood);
    assert.equal(job.stackId, "stick");
});

test("findMergeJob spreads from an unfiltered dump into a category basket", () => {
    const dump = {
        uid: "dump", x: 0, y: 0,
        slots: [
            { id: "leaf_wrap", quantity: 1 },
            { id: "stick", quantity: 6 },
            null, null
        ],
        storageFilter: { priority: "normal" }
    };
    const clothes = {
        uid: "clothes", x: 32, y: 0,
        slots: [null, null, null, null],
        storageFilter: { priority: "normal", offCategories: ["materials", "food", "tools", "weapons", "junk", "buildings", "medicine", "art"] }
    };
    const job = SF.findMergeJob([dump, clothes], getItem, 0, 0);
    assert.ok(job);
    assert.equal(job.kind, "move");
    assert.equal(job.reason, "better");
    assert.equal(job.from, dump);
    assert.equal(job.to, clothes);
    assert.equal(job.stackId, "leaf_wrap");
});

test("pickBasket prefers existing stacks at the same priority", () => {
    const stack = { id: "stick", quantity: 2 };
    const nearEmpty = {
        x: 0, y: 0, uid: "empty",
        slots: [null, null],
        storageFilter: { priority: "normal" }
    };
    const farStack = {
        x: 80, y: 0, uid: "stack",
        slots: [{ id: "stick", quantity: 3 }, null],
        storageFilter: { priority: "normal" }
    };
    assert.equal(SF.pickBasket([nearEmpty, farStack], stack, getItem, 0, 0), farStack);
    const critEmpty = {
        x: 0, y: 0, uid: "crit",
        slots: [null, null],
        storageFilter: { priority: "critical" }
    };
    assert.equal(SF.pickBasket([farStack, critEmpty], stack, getItem, 0, 0), critEmpty);
});
