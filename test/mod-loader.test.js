const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Loader = require("../shared/mods/loader");
const Content = require("../shared/mods/content");
const DataStore = require("../shared/DataStore");
const { resolveGameFile } = require("../electron/modsPath");

const ROOT = path.resolve(__dirname, "..");
const VERSION = "0.3.1";

function emptyStore() {
    const store = {
        itemsList: [{ id: "stick", name: "Stick", _source: "cave-paintings.base" }],
        thingsList: [{ id: "rock", name: "Rock", _source: "cave-paintings.base" }],
        mobsList: [],
        techsList: [{
            id: "knapping",
            name: "Knapping",
            cost: 0,
            startUnlocked: true,
            prereqs: [],
            children: ["hafting"],
            unlocks: { items: [] },
            _source: "cave-paintings.base"
        }],
        bodyPlans: {},
        injuries: {},
        hediffs: {}
    };
    store.itemsById = { stick: store.itemsList[0] };
    store.thingsById = { rock: store.thingsList[0] };
    store.mobsById = {};
    return store;
}

function pack(id, data, extra = {}) {
    return {
        manifest: {
            id,
            name: id,
            version: "1.0.0",
            gameVersion: ">=0.3.1",
            dependencies: extra.dependencies || [],
            loadPriority: extra.loadPriority || 0,
            sim: extra.sim
        },
        data,
        label: extra.label || id,
        textureBase: `mods/${id}`,
        hasScripts: !!extra.hasScripts
    };
}

function writeMod(root, folder, manifest, dataFiles) {
    const dir = path.join(root, folder);
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "mod.json"), JSON.stringify(manifest));
    for (const [name, body] of Object.entries(dataFiles || {})) {
        fs.writeFileSync(path.join(dir, "data", name), JSON.stringify(body));
    }
    return dir;
}

test("boot with mods disabled leaves base ids and skips the example pack", () => {
    Content.boot({ mods: false, root: ROOT });
    assert.equal(DataStore.getItem("stick")?.id, "stick");
    assert.equal(DataStore.getItem("cavepaintings.examplemod.token"), null);
    assert.equal(Content.isFinalized(), true);
});

test("a short name stick does not replace the base stick", () => {
    const store = emptyStore();
    Loader.mergePacks(store, { types: [], lootTables: {} }, [
        pack("example.bad", {
            items: [{ id: "stick", name: "Nope" }]
        })
    ], VERSION);
    assert.equal(store.itemsById.stick.name, "Stick");
    assert.equal(store.itemsById.stick._source, "cave-paintings.base");
    assert.equal(store.itemsById["example.bad.stick"].name, "Nope");
});

test("duplicate mod ids name both folders", () => {
    const store = emptyStore();
    assert.throws(() => Loader.mergePacks(store, { types: [], lootTables: {} }, [
        pack("example.dup", { items: [{ id: "example.dup.a", name: "A" }] }, { label: "/mods/one" }),
        pack("example.dup", { items: [{ id: "example.dup.b", name: "B" }] }, { label: "/mods/two" })
    ], VERSION), /Duplicate mod id "example\.dup" \(\/mods\/one and \/mods\/two\)/);
});

test("an id outside the mod namespace names the mod", () => {
    const store = emptyStore();
    assert.throws(() => Loader.mergePacks(store, { types: [], lootTables: {} }, [
        pack("example.bad", { items: [{ id: "example.other.chip", name: "Loose" }] })
    ], VERSION), /example\.bad: id "example\.other\.chip" is outside the mod namespace/);
});

test("short names are prefixed with the mod id", () => {
    const store = emptyStore();
    const mod = pack("example.bad", {
        items: [{
            id: "token",
            name: "Token",
            key: "token",
            place: { thing: "marker" },
            recipe: { stick: 1 }
        }],
        things: [{ id: "marker", name: "Marker" }],
        techs: [{
            id: "studies",
            name: "Studies",
            prereqs: ["knapping"],
            unlocks: { items: ["token"] }
        }],
        scatters: [{ id: "markers", tiles: ["grass"], thingId: "marker", chance: 0, salt: 1 }]
    });
    Loader.mergePacks(store, { types: [], lootTables: {} }, [mod], VERSION);
    const token = store.itemsById["example.bad.token"];
    assert.equal(token.name, "Token");
    assert.equal(token.key, "example.bad.token");
    assert.equal(token._assetName, "token");
    assert.equal(token._textureUrl, "mods/example.bad/assets/items/token.png");
    assert.equal(token.place.thing, "example.bad.marker");
    assert.equal(token.recipe.stick, 1);
    assert.equal(store.thingsById["example.bad.marker"]._textureUrl, "mods/example.bad/assets/things/marker.png");
    const tech = store.techsList.find((row) => row.id === "example.bad.studies");
    assert.deepEqual(tech.prereqs, ["knapping"]);
    assert.deepEqual(tech.unlocks.items, ["example.bad.token"]);
    assert.equal(mod.data.scatters[0].id, "example.bad.markers");
    assert.equal(mod.data.scatters[0].thingId, "example.bad.marker");
    assert.equal(Loader.qualifyName("example.bad", "token"), "example.bad.token");
    assert.equal(Loader.qualifyName("example.bad", "example.bad.token"), "example.bad.token");
    assert.equal(Loader.qualifyName("example.bad", "other.mod.widget"), "other.mod.widget");
});

test("an invalid mod id throws", () => {
    assert.throws(() => Loader.mergePacks(emptyStore(), { types: [], lootTables: {} }, [
        pack("Nope", { items: [] })
    ], VERSION), /Invalid mod id "Nope"/);
});

test("missing place.thing throws", () => {
    const store = emptyStore();
    assert.throws(() => Loader.mergePacks(store, { types: [], lootTables: {} }, [
        pack("example.bad", {
            items: [{
                id: "example.bad.basket",
                name: "Basket",
                place: { thing: "example.bad.missing" }
            }]
        })
    ], VERSION), /example\.bad: place\.thing "example\.bad\.missing" does not exist/);
});

test("a gameVersion the install does not satisfy throws", () => {
    const store = emptyStore();
    const bad = pack("example.bad", { items: [{ id: "example.bad.chip", name: "Chip" }] });
    bad.manifest.gameVersion = ">=9.0.0";
    assert.throws(() => Loader.mergePacks(store, { types: [], lootTables: {} }, [bad], VERSION), /gameVersion ">=9\.0\.0" does not match 0\.3\.1/);
});

test("a missing dependency throws", () => {
    assert.throws(() => Loader.orderMods([
        { id: "example.child", dependencies: ["example.missing"], loadPriority: 0 }
    ]), /Missing mod dependency "example\.missing"/);
});

test("a dependency cycle throws", () => {
    assert.throws(() => Loader.orderMods([
        { id: "example.a", dependencies: ["example.b"], loadPriority: 0 },
        { id: "example.b", dependencies: ["example.a"], loadPriority: 0 }
    ]), /Mod dependency cycle/);
});

test("a client script is not executed by the data merge", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cp-mods-"));
    const manifest = {
        id: "example.scripted",
        version: "1.0.0",
        gameVersion: ">=0.3.1",
        dependencies: [],
        loadPriority: 0
    };
    const clientDir = writeMod(root, "example.scripted", manifest, {});
    fs.mkdirSync(path.join(clientDir, "client"));
    fs.writeFileSync(path.join(clientDir, "client", "index.js"), "globalThis.__cpClientMergeRan = true;\n");
    globalThis.__cpClientMergeRan = false;
    const clientPacks = Loader.loadPacksFromDisk(root, VERSION);
    Loader.mergePacks(emptyStore(), { types: [], lootTables: {} }, clientPacks, VERSION);
    assert.equal(globalThis.__cpClientMergeRan, false);
    assert.equal(clientPacks[0].clientScriptUrl, "mods/example.scripted/client/index.js");

    fs.rmSync(clientDir, { recursive: true, force: true });
    const simDir = writeMod(root, "example.scripted", manifest, {});
    fs.mkdirSync(path.join(simDir, "sim"));
    fs.writeFileSync(path.join(simDir, "sim", "index.js"), "globalThis.__cpMergeRan = true;\nmodule.exports = function () {};\n");
    globalThis.__cpMergeRan = false;
    const simPacks = Loader.loadPacksFromDisk(root, VERSION);
    Loader.mergePacks(emptyStore(), { types: [], lootTables: {} }, simPacks, VERSION);
    assert.equal(globalThis.__cpMergeRan, false);
    assert.ok(simPacks[0].simScriptBytes instanceof Uint8Array);
});

test("tech children are appended onto the existing parent", () => {
    const store = emptyStore();
    const parent = store.techsList[0];
    Loader.mergePacks(store, { types: [], lootTables: {} }, [
        pack("example.tools", {
            items: [{ id: "example.tools.chip", name: "Chip", maxStack: 10 }],
            techs: [{
                id: "example.tools.working",
                name: "Working",
                cost: 2,
                prereqs: ["knapping"],
                unlocks: { items: ["example.tools.chip"] }
            }]
        })
    ], VERSION);
    assert.equal(store.techsList[0], parent);
    assert.ok(parent.children.includes("hafting"));
    assert.ok(parent.children.includes("example.tools.working"));
});

test("mods path rejects .. and stays outside gameRoot", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cp-modpath-"));
    const gameRoot = path.join(root, "game");
    const userMods = path.join(root, "user", "mods");
    const repoMods = path.join(root, "repo", "mods");
    fs.mkdirSync(path.join(repoMods, "example.flint_tools"), { recursive: true });
    fs.writeFileSync(path.join(repoMods, "example.flint_tools", "mod.json"), "{}\n");
    fs.mkdirSync(gameRoot, { recursive: true });
    const opts = {
        gameRoot,
        scheme: "app",
        packaged: false,
        userMods,
        repoMods
    };
    const url = "app://game/mods/example.flint_tools/mod.json";
    assert.equal(
        resolveGameFile(url, opts),
        path.join(repoMods, "example.flint_tools", "mod.json")
    );
    assert.equal(resolveGameFile("app://game/mods/../../secret", opts), null);
    assert.equal(resolveGameFile("app://game/mods/example.flint_tools/../../secret", opts), null);
    const packed = resolveGameFile(url, { ...opts, packaged: true });
    assert.equal(packed, path.join(userMods, "example.flint_tools", "mod.json"));
    assert.ok(!packed.startsWith(gameRoot));
    assert.equal(
        resolveGameFile("app://game/index.html", opts),
        path.join(gameRoot, "index.html")
    );
});
