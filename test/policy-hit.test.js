const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { queueMicrotask };
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/PolicyPanel.js"), "utf8") + "\nthis.PolicyPanel = PolicyPanel;\n",
    sandbox
);

function panel() {
    const p = Object.create(sandbox.PolicyPanel.prototype);
    p.visible = true;
    p._scroll = 0;
    p._editX = 200;
    p._editY = 100;
    p._editW = 300;
    p._editH = 120;
    p._chromeHits = [{ x: 400, y: 20, w: 64, h: 22, fn: () => "close" }];
    p._rowHits = [
        { x: 40, y: 80, w: 160, h: 24, fn: () => "list" },
        { edit: true, x: 0, y: 30, w: 280, h: 26, fn: () => "item" }
    ];
    return p;
}

test("policy clicks use the row under the pointer, not the panel frame", () => {
    const p = panel();
    assert.equal(p._hitAt({ x: 420, y: 30 }).fn(), "close");
    assert.equal(p._hitAt({ x: 50, y: 90 }).fn(), "list");
    assert.equal(p._hitAt({ x: 220, y: 140 }).fn(), "item");
    assert.equal(p._hitAt({ x: 12, y: 12 }), null);
});

test("a scrolled equipment row only hits inside the list window", () => {
    const p = panel();
    p._scroll = 40;
    assert.equal(p._hitAt({ x: 220, y: 95 }), null);
    assert.equal(p._hitAt({ x: 220, y: 110 }).fn(), "item");
});
