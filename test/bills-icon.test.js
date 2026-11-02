const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadBills(extra = {}) {
    const sandbox = {
        console,
        ensureSpearTexture(_scene, material) {
            return `spear_tip_${material}`;
        },
        Place: {
            itemIconKey(def) {
                return def?.key || def?.id || "";
            }
        },
        Knapping: extra.Knapping
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/BillsPanel.js"), "utf8"), sandbox);
    return vm.runInContext("BillsPanel", sandbox);
}

test("a stone spear bill uses the andesite spear, not the bare shaft", () => {
    const BillsPanel = loadBills();
    const panel = Object.create(BillsPanel.prototype);
    panel.scene = {
        textures: { exists: (key) => key === "spear_tip_andesite" || key === "wooden_spear" },
        getItem: (id) => ({ id, key: id === "stone_spear" ? "wooden_spear" : id })
    };
    assert.equal(panel._itemIconKey("stone_spear"), "spear_tip_andesite");
    assert.equal(panel._billIconKey({
        kind: "make",
        id: "stone_spear",
        outputId: "stone_spear",
        name: "Stone Spear"
    }), "spear_tip_andesite");
});

test("a spear tip ingredient uses the shaded carved shape, not the plain pebble", () => {
    const calls = [];
    const BillsPanel = loadBills({
        Knapping: {
            carveShapeIcon(_scene, toolClass, stoneId, variant) {
                calls.push({ toolClass, stoneId, variant });
                return "packed";
            },
            ensureToolTexture() {
                return "spear_tip_andesite_v2";
            }
        }
    });
    const panel = Object.create(BillsPanel.prototype);
    panel.scene = {
        textures: { exists: (key) => key === "pebble_1" || key === "spear_tip_andesite_v2" },
        getItem: (id) => ({ id, key: id === "stone_tool" ? "pebble_1" : id })
    };
    const key = panel._ingredientIcon({
        id: "andesite",
        itemId: "stone_tool",
        toolClass: "spear_tip",
        stuff: "andesite",
        name: "Andesite Spear Tip"
    });
    assert.equal(key, "spear_tip_andesite_v2");
    assert.deepEqual(calls, [{ toolClass: "spear_tip", stoneId: "andesite", variant: 2 }]);
});

