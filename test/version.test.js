const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

test("version.json matches package.json", () => {
    const root = path.join(__dirname, "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const ver = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf8"));
    assert.equal(ver.version, pkg.version);
    assert.ok(
        pkg.build.files.includes("version.json"),
        "Electron package must ship version.json"
    );
});

test("a hotfix compares newer than the release it patches", () => {
    const root = path.join(__dirname, "..");
    const src = fs.readFileSync(path.join(root, "js", "net", "SceneMenu.js"), "utf8");
    const start = src.indexOf("function parseGameVersion");
    const end = src.indexOf("function fetchLatestGithubRelease");
    const context = {};
    vm.runInNewContext(
        `${src.slice(start, end)}\nthis.compareGameVersions = compareGameVersions;`,
        context
    );
    assert.equal(context.compareGameVersions("0.4.3.1", "0.4.3"), 1);
    assert.equal(context.compareGameVersions("0.4.3", "0.4.3.1"), -1);
    assert.equal(context.compareGameVersions("0.4.3.2", "0.4.3.1"), 1);
    assert.equal(context.compareGameVersions("0.4.4", "0.4.3.9"), 1);
    assert.equal(context.compareGameVersions("v0.4.3.1", "0.4.3.1"), 0);
});
