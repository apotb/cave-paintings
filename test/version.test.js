const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("version.json matches package.json", () => {
    const root = path.join(__dirname, "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const ver = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf8"));
    assert.equal(ver.version, pkg.version);
});
