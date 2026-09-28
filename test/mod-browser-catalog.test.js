const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SPEAR = "example.mod.token";
const BASKET = "example.mod.marker";

const CORE_FILES = [
    ["bodyPlans", "BodyPlans.json"],
    ["injuries", "Injuries.json"],
    ["hediffs", "Hediffs.json"],
    ["items", "Items.json"],
    ["mobs", "Mobs.json"],
    ["things", "Things.json"],
    ["techs", "Techs.json"],
    ["structures", "Structures.json"]
];

function readJson(rel) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function httpError(status) {
    return {
        ok: false,
        status,
        async json() {
            throw new Error(`HTTP ${status}`);
        }
    };
}

function httpJson(body) {
    return {
        ok: true,
        status: 200,
        async json() {
            if (typeof body === "string") return JSON.parse(body);
            return body;
        }
    };
}

function installFetch(routes) {
    const table = {
        "version.json": httpJson(readJson("version.json"))
    };
    for (const [, name] of CORE_FILES) {
        table[`data/${name}`] = httpJson(readJson(path.join("data", name)));
    }
    Object.assign(table, routes);
    global.fetch = async (url) => {
        const key = String(url).replace(/^\//, "");
        return table[key] || httpError(404);
    };
}

const keptManifest = {
    id: "test.kept_mod",
    name: "Kept",
    version: "1.0.0",
    gameVersion: ">=0.3.1",
    dependencies: [],
    loadPriority: 0
};

describe("browser catalog missing mod", { concurrency: false }, () => {
    test("a missing catalog mod.json does not block boot or the saved world", async () => {
        global.window = {};
        const Content = require("../shared/mods/content");

        installFetch({
            "mods/catalog.json": httpJson({
                mods: [{ id: "broken.mod", dir: "broken.mod" }]
            }),
            "mods/broken.mod/mod.json": httpJson("{")
        });
        await assert.rejects(() => Content.boot(), SyntaxError);

        installFetch({
            "mods/catalog.json": httpJson({
                mods: [{ id: "broken.mod", dir: "broken.mod" }]
            }),
            "mods/broken.mod/mod.json": httpJson({ id: "nope" })
        });
        await assert.rejects(() => Content.boot(), /Invalid mod id/);
        assert.equal(Content.isFinalized(), false);

        installFetch({
            "mods/catalog.json": httpJson({
                mods: [
                    { id: "example.mod", dir: "example.mod" },
                    { id: "test.kept_mod", dir: "test.kept_mod" }
                ]
            }),
            "mods/test.kept_mod/mod.json": httpJson(keptManifest),
            "mods/test.kept_mod/data/items.json": httpJson([
                { id: "test.kept_mod.pebble", key: "test.kept_mod.pebble" }
            ])
        });
        await Content.boot();
        assert.equal(Content.isFinalized(), true);
        assert.deepEqual(Content.simMods(), [{ id: "test.kept_mod", version: "1.0.0" }]);
        assert.equal(require("../shared/DataStore").getItem("test.kept_mod.pebble")?.id, "test.kept_mod.pebble");
        assert.equal(require("../shared/DataStore").getItem(SPEAR), null);

        const { SimWorld } = require("../shared/sim/SimWorld");
        const loaded = SimWorld.loadFromData({
            v: 1,
            genVersion: 2,
            seed: 9,
            mods: [{ id: "example.mod", version: "1.0.0" }],
            contentHash: "not-the-live-hash",
            chunks: {
                "0,0": {
                    x: 0,
                    y: 0,
                    things: [{
                        id: "wicker_basket",
                        uid: "chest1",
                        x: 24,
                        y: 24,
                        slots: [{ id: SPEAR, quantity: 1 }, null, null, null, null, null, null, null]
                    }, {
                        id: BASKET,
                        uid: "basket1",
                        x: 40,
                        y: 24
                    }],
                    lootableThings: [],
                    drops: [],
                    mobs: [],
                    corpses: []
                }
            }
        }, { worldName: "browser-missing-mod" });
        assert.deepEqual(loaded.contentWarnings, [
            "Missing mod example.mod@1.0.0. World content from that mod is left in place."
        ]);
        const chunk = loaded.chunks.get("0,0");
        assert.equal(chunk.things[0].slots[0].id, SPEAR);
        assert.equal(chunk.things[1].id, BASKET);
    });
});
