const { test } = require("node:test");
const assert = require("node:assert/strict");

require("../scripts/electron-builder-version");

const semver = require("app-builder-lib/node_modules/semver");
const { AppInfo } = require("app-builder-lib/out/appInfo");

function appInfo(version) {
    return new AppInfo({
        metadata: { version, name: "cave-paintings", description: "Cave Paintings" },
        config: { productName: "Cave Paintings" }
    });
}

test("electron-builder accepts a 4-part hotfix version", () => {
    assert.equal(semver.valid("0.4.3.1"), "0.4.3.1");
    assert.equal(semver.valid("0.4.3.1", true), "0.4.3.1");
    assert.equal(semver.clean("0.4.3.1", true), "0.4.3.1");
    assert.equal(semver.valid("0.4.3"), "0.4.3");
    assert.equal(semver.valid("0.4.3.1.2"), null);
    assert.equal(appInfo("0.4.3.1").getVersionInWeirdWindowsForm(), "0.4.3.1");
    assert.equal(appInfo("0.4.3").getVersionInWeirdWindowsForm(), "0.4.3.0");
});
