const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Stone = require("../shared/stone");

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

test("stone spear quality sits after the name", () => {
    sandbox.Stone = Stone;
    const tip = craft.formatItemTooltip.call(
        {},
        { id: "stone_spear", name: "Stone Spear", weight: 1.2 },
        1,
        null,
        { id: "stone_spear", knapMaterial: "pebble", stone: "andesite", knapQuality: "rough" }
    );
    const lines = tip.split("\n");
    assert.equal(lines[0], "Andesite Spear (rough)");
    assert.equal(lines.includes("Rough"), false);
});

test("a placed bed names its rest effectiveness", () => {
    sandbox.Needs = require("../shared/needs");
    const tip = craft.formatItemTooltip.call(
        {
            getThing(id) {
                if (id === "lean_to") return { sleep: { restEffectiveness: 0.95 } };
                if (id === "hut") return { sleep: { restEffectiveness: 1 } };
                return null;
            }
        },
        {
            id: "hut",
            name: "Hut",
            place: { thing: "hut" },
            tooltip: ["Fits up to 4 people"]
        },
        1,
        null,
        null
    );
    const lines = tip.split("\n");
    assert.equal(lines[0], "Hut");
    assert.ok(lines.includes("Rest effectiveness: 100%"));
    assert.ok(lines.includes("Fits up to 4 people"));
    const lean = craft.formatItemTooltip.call(
        {
            getThing(id) {
                return id === "lean_to" ? { sleep: { restEffectiveness: 0.95 } } : null;
            }
        },
        { id: "lean_to", name: "Lean-to", place: { thing: "lean_to" } },
        1,
        null,
        null
    );
    assert.ok(lean.split("\n").includes("Rest effectiveness: 95%"));
});

test("spear tip quality sits after the name", () => {
    sandbox.Stone = Stone;
    const tip = craft.formatItemTooltip.call(
        {},
        { id: "stone_tool", name: "Stone Tool" },
        1,
        null,
        { id: "stone_tool", toolClass: "spear_tip", knapMaterial: "pebble", stone: "diorite", knapQuality: "fine" }
    );
    const lines = tip.split("\n");
    assert.equal(lines[0], "Diorite Spear Tip (fine)");
    assert.equal(lines.includes("Fine"), false);
});
