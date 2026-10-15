const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../js/scene/craft.js"), "utf8");
const sandbox = {};
vm.runInNewContext(src, sandbox);
const craft = sandbox.SceneMainCraft;

function count(recipe, pointer, ctx) {
    return craft._craftClickCount.call({
        simAuth: () => true,
        player: { keys: {} },
        _maxCraftRepeats() { return ctx?.max ?? 999; },
        ...ctx
    }, recipe, pointer);
}

test("plain click crafts once", () => {
    assert.equal(count({ quantity: 1 }, { event: {} }), 1);
});

test("ctrl-click crafts enough times to make 10 items", () => {
    assert.equal(count({ quantity: 1 }, { event: { ctrlKey: true } }), 10);
    assert.equal(count({ quantity: 2 }, { event: { ctrlKey: true } }), 5);
    assert.equal(count({ quantity: 3 }, { event: { metaKey: true } }), 4);
});

test("shift-click asks for as many crafts as ingredients allow", () => {
    assert.equal(count({ quantity: 1 }, { event: { shiftKey: true } }), 999);
    assert.equal(count(
        { quantity: 1, craftSeconds: 8 },
        { event: { shiftKey: true } },
        { max: 6 }
    ), 6);
});

test("shift wins when ctrl is also held", () => {
    assert.equal(count(
        { quantity: 1 },
        { event: { shiftKey: true, ctrlKey: true } }
    ), 999);
});

test("held keyboard modifiers count when the pointer event does not", () => {
    assert.equal(count(
        { quantity: 1 },
        null,
        { player: { keys: { CTRL: { isDown: true } } } }
    ), 10);
    assert.equal(count(
        { quantity: 1, craftSeconds: 12 },
        null,
        { max: 3, player: { keys: { SHIFT: { isDown: true } } } }
    ), 3);
});
