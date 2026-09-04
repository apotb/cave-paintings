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
    assert.equal(SF.filterKey(knap, def), "tool:chopper");
    assert.equal(SF.filterKey(awl, def), "tool:awl");
    assert.equal(SF.filterKey(tip, def), "tool:spear_tip");
    assert.equal(SF.filterKey({ id: "bone" }, getItem("bone")), "bone");
    const t = tree();
    const tools = SF.findNode(t, "tools");
    const ids = (tools.items || []).map((it) => it.id);
    assert.deepEqual(ids, [
        "tool:awl", "bone", "tool:chopper", "flint_tool", "tool:knife",
        "tool:scraper", "tool:spear_tip", "stone_tool"
    ]);
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
    assert.equal(SF.allows(f, { id: "stone_tool" }, getItem), true);
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
    for (const def of list) {
        if (!def?.id) continue;
        const leaf = SF.leafCategory(def, SF.roastResultIds(list));
        assert.ok(leaf, def.id);
        if (def.toolClass) {
            assert.equal(leaf, "tools");
            assert.ok(seen.has(`tool:${def.toolClass}`), def.id);
        }
        assert.ok(seen.has(def.id), `${def.id} missing from tree (leaf ${leaf})`);
    }
    assert.equal(SF.leafCategory(getItem("cactus_flower"), null), "apparel/clothing");
    assert.equal(SF.leafCategory(getItem("leaf_wrap"), null), "apparel/clothing");
    assert.equal(SF.leafCategory(getItem("leaf_pouch"), null), "apparel/equipment");
    assert.equal(SF.leafCategory(getItem("hide_bundle"), null), "apparel/equipment");
    assert.equal(SF.leafCategory(getItem("leather_pack"), null), "apparel/equipment");
    assert.equal(SF.leafCategory(getItem("coconut_meal"), null), "food/meals");
    assert.equal(SF.leafCategory(getItem("rot"), null), "junk");
    assert.equal(SF.leafCategory(getItem("brain"), null), "junk");
    assert.equal(SF.leafCategory(getItem("lean_to"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("wicker_basket"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("drying_rack"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("skinworking_bench"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("settling_stone"), null), "buildings");
    assert.equal(SF.leafCategory(getItem("leaf_cord"), null), "medicine");
    const buildings = SF.findNode(t, "buildings");
    assert.ok((buildings.items || []).some((it) => it.id === "wicker_basket"));
    const medicine = SF.findNode(t, "medicine");
    assert.deepEqual((medicine.items || []).map((it) => it.id), ["leaf_cord"]);
    const apparelKids = (SF.findNode(t, "apparel").children || []).map((n) => n.id);
    assert.deepEqual(apparelKids, ["apparel/clothing", "apparel/equipment", "apparel/armor"]);
    assert.equal((SF.findNode(t, "apparel/armor").items || []).length, 0);
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
    assert.equal(acrossPri, null);

    const denied = {
        uid: "no", x: 8, y: 0,
        slots: [{ id: "stick", quantity: 20 }, null],
        storageFilter: { priority: "normal", offCategories: ["materials"] }
    };
    assert.equal(SF.findMergeJob([src, denied], getItem, 0, 0), null);
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
