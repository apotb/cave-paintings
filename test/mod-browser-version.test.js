const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MOD_ID = "test.version_mod";

const CORE_FILES = [
    "BodyPlans.json",
    "Injuries.json",
    "Hediffs.json",
    "Items.json",
    "Mobs.json",
    "Things.json",
    "Techs.json",
    "Backstories.json",
    "Traits.json",
    "Structures.json"
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
            return body;
        }
    };
}

const manifest = {
    id: MOD_ID,
    name: "Version",
    version: "1.0.0",
    gameVersion: ">=0.4.0",
    dependencies: [],
    loadPriority: 0
};

function installFetch() {
    const table = {};
    for (const name of CORE_FILES) {
        table[`data/${name}`] = httpJson(readJson(path.join("data", name)));
    }
    table["mods/catalog.json"] = httpJson({
        mods: [{ id: MOD_ID, dir: MOD_ID }]
    });
    table[`mods/${MOD_ID}/mod.json`] = httpJson(manifest);
    table[`mods/${MOD_ID}/data/items.json`] = httpJson([
        { id: `${MOD_ID}.pebble`, key: `${MOD_ID}.pebble` }
    ]);
    const hits = [];
    global.fetch = async (url) => {
        const key = String(url).replace(/^\//, "");
        hits.push(key);
        return table[key] || httpError(404);
    };
    return hits;
}

test("browser boot uses the Electron app version when version.json is missing", async () => {
    global.window = {};
    const Content = require("../shared/mods/content");
    const hits = installFetch();

    await assert.rejects(
        () => Content.boot({ enabledIds: [MOD_ID] }),
        /Failed to load version\.json/
    );
    assert.equal(Content.isFinalized(), false);
    assert.ok(hits.includes("version.json"));

    hits.length = 0;
    global.cavePaintings = { getVersion: () => "0.4.0" };
    await Content.boot({ enabledIds: [MOD_ID] });
    assert.equal(Content.isFinalized(), true);
    assert.equal(hits.includes("version.json"), false);
    assert.equal(require("../shared/DataStore").getItem(`${MOD_ID}.pebble`)?.id, `${MOD_ID}.pebble`);
});
