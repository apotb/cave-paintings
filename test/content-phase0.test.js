const { test } = require("node:test");
const assert = require("node:assert/strict");
const DataStore = require("../shared/DataStore");
const Content = require("../shared/mods/content");
const { createTestWorld } = require("./helpers/simWorld");

function fakeJson(initial) {
    const store = { ...initial };
    return {
        get(key) { return store[key]; },
        exists(key) { return Object.prototype.hasOwnProperty.call(store, key); },
        has(key) { return this.exists(key); },
        remove(key) { delete store[key]; },
        add(key, value) { store[key] = value; },
        _store: store
    };
}

function fakeScene(jsonInitial) {
    const queued = [];
    return {
        cache: { json: fakeJson(jsonInitial || {}) },
        textures: { exists() { return false; } },
        load: {
            image(key, url) { queued.push({ key, url }); },
            spritesheet(key, url) { queued.push({ key, url, sheet: true }); }
        },
        _queued: queued
    };
}

test("boot({ mods: false }) finalizes core and does not load mods", () => {
    assert.equal(Content.isFinalized(), true);
    assert.ok(DataStore.generation >= 1);
    assert.equal(DataStore.getItem("stick")?.id, "stick");
    assert.equal(DataStore.getItem("cavepaintings.examplemod.token"), null);
    assert.equal(Content.boot({ mods: false }), DataStore);
});

test("generation bump is visible to item defs", () => {
    const { world } = createTestWorld();
    const id = "phase0_gen_item";
    world._itemDef("stick");
    DataStore._store.itemsList.push({ id, name: "Gen Item", maxStack: 1 });
    DataStore._store.itemsById[id] = DataStore._store.itemsList[DataStore._store.itemsList.length - 1];
    assert.equal(world._itemDef(id), undefined);
    const before = DataStore.generation;
    DataStore.bumpGeneration();
    assert.equal(DataStore.generation, before + 1);
    assert.equal(world._itemDef(id)?.id, id);
});

test("initFromPhaserScene after finalize does not drop a merged item", () => {
    const id = "phase0_merged";
    const item = { id, name: "Merged Spear", maxStack: 1 };
    DataStore._store.itemsList.push(item);
    DataStore._store.itemsById[id] = item;
    const stick = DataStore.getItem("stick");
    const scene = fakeScene({
        bodyPlans: { human: { id: "human", core: "Torso" } },
        injuries: {},
        hediffs: {},
        items: [{ id: "stick", name: "Not Stick" }],
        mobs: [],
        things: [],
        techs: []
    });
    DataStore.initFromPhaserScene(scene);
    assert.equal(DataStore.getItem(id)?.name, "Merged Spear");
    assert.equal(DataStore.getItem("stick"), stick);
});

test("publishToScene writes the item and later cache edits do not change DataStore", () => {
    const id = "phase0_merged";
    const scene = fakeScene({});
    Content.publishToScene(scene);
    const published = scene.cache.json.get("items");
    assert.ok(published.some((it) => it?.id === id));
    assert.equal(scene.cache.json.get("structures")?.types?.length > 0, true);
    scene.cache.json.remove("items");
    scene.cache.json.add("items", [{ id: "stick", name: "Cache Stick" }]);
    assert.equal(DataStore.getItem(id)?.name, "Merged Spear");
    assert.notEqual(DataStore.getItem("stick")?.name, "Cache Stick");
});

test("queueTextures queues a resolved item texture that is not in the cache", () => {
    const item = DataStore.getItem("phase0_merged");
    item._textureUrl = "assets/items/phase0_merged.png";
    item.key = "phase0_merged";
    const scene = fakeScene({});
    Content.queueTextures(scene);
    assert.ok(scene._queued.some((q) => q.key === "phase0_merged" && q.url === item._textureUrl));
    delete item._textureUrl;
    delete item.key;
});
