const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Content = require("../shared/mods/content");
const Actions = require("../shared/mods/actions");

const ROOT = path.resolve(__dirname, "..");

test("a thrown sim factory aborts before SimWorld is constructed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cp-phase4-"));
    const dir = path.join(root, "example.boom");
    fs.mkdirSync(path.join(dir, "sim"), { recursive: true });
    fs.writeFileSync(path.join(dir, "mod.json"), JSON.stringify({
        id: "example.boom",
        name: "Boom",
        version: "1.0.0",
        gameVersion: ">=0.3.1",
        dependencies: [],
        loadPriority: 0
    }));
    fs.writeFileSync(path.join(dir, "sim", "index.js"), `(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory;
    else root.__cpPendingSimFactory = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    throw new Error("sim factory failed");
});
`);
    Content.boot({ root: ROOT, modsDir: root });
    let constructed = false;
    assert.throws(() => {
        Content.loadSimScripts();
        constructed = true;
    }, /sim factory failed/);
    assert.equal(constructed, false);
    assert.equal(Actions.has("example.ping"), false);
});
