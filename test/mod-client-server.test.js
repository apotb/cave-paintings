const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Content = require("../shared/mods/content");

const ROOT = path.resolve(__dirname, "..");

test("dedicated server boot does not execute client/index.js", () => {
    const modsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-phase5-client-"));
    const dir = path.join(modsDir, "example.client_eval");
    fs.mkdirSync(path.join(dir, "client"), { recursive: true });
    fs.mkdirSync(path.join(dir, "sim"), { recursive: true });
    fs.writeFileSync(path.join(dir, "mod.json"), JSON.stringify({
        id: "example.client_eval",
        name: "Client Eval",
        version: "1.0.0",
        gameVersion: ">=0.3.1",
        dependencies: [],
        loadPriority: 0
    }));
    fs.writeFileSync(
        path.join(dir, "client", "index.js"),
        "globalThis.__cpClientRan = true;\n"
    );
    fs.writeFileSync(
        path.join(dir, "sim", "index.js"),
        "globalThis.__cpSimRan = true;\nmodule.exports = function () { globalThis.__cpSimFactory = true; };\n"
    );
    globalThis.__cpClientRan = false;
    globalThis.__cpSimRan = false;
    globalThis.__cpSimFactory = false;
    Content.boot({ root: ROOT, modsDir });
    assert.equal(globalThis.__cpClientRan, false);
    assert.equal(globalThis.__cpSimRan, false);
    Content.loadSimScripts();
    assert.equal(globalThis.__cpClientRan, false);
    assert.equal(globalThis.__cpSimFactory, true);
    const server = fs.readFileSync(path.join(ROOT, "server", "index.js"), "utf8");
    const content = fs.readFileSync(path.join(ROOT, "shared", "mods", "content.js"), "utf8");
    assert.equal(server.includes("client/index.js"), false);
    assert.equal(content.includes("client/index.js"), true);
    assert.equal(/_compile\([^)]*client/.test(content), false);
});
