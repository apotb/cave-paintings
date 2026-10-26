const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

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

test("browser boot does not need a game version when no mods load", async () => {
    global.window = {};
    const Content = require("../shared/mods/content");
    const hits = [];
    global.fetch = async (url) => {
        const key = String(url).replace(/^\//, "");
        hits.push(key);
        if (key === "mods/catalog.json") return httpJson({ mods: [] });
        if (key.startsWith("data/")) {
            return httpJson(readJson(path.join("data", key.slice("data/".length))));
        }
        return httpError(404);
    };

    await Content.boot({ enabledIds: [] });
    assert.equal(Content.isFinalized(), true);
    assert.equal(hits.includes("version.json"), false);
    assert.ok(CORE_FILES.every((name) => hits.includes(`data/${name}`)));
});
