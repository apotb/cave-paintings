const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function loadEquipmentPanel() {
    const sandbox = { console, createIngredientBadges: () => [] };
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(ROOT, "js", "EquipmentPanel.js"), "utf8")
        + "\nthis.EquipmentPanel = EquipmentPanel;\n";
    vm.runInContext(source, sandbox);
    return sandbox.EquipmentPanel;
}

function fakeImage() {
    const handlers = {};
    const img = {
        setOrigin() { return img; },
        setInteractive() { return img; },
        setVisible() { return img; },
        setScale() { return img; },
        on(ev, fn) {
            (handlers[ev] ||= []).push(fn);
            return img;
        },
        emit(ev, ...args) {
            for (const fn of handlers[ev] || []) fn(...args);
        }
    };
    return img;
}

test("right-click unequip refreshes the hover tip to the empty slot name", () => {
    const EquipmentPanel = loadEquipmentPanel();
    const gear = {
        head: { id: "leaf_wrap", quantity: 1, spoilLeft: 10 }
    };
    const scene = {
        tooltip: { visible: false, text: "" },
        _tooltipSource: null,
        _tooltipTarget: null,
        player: {
            getWaistCapacity: () => 0,
            getEquipmentStack(key) { return gear[key] || null; },
            unequipToFirstHotbarSlot(key) {
                gear[key] = null;
                return { ok: true };
            }
        },
        getItem(id) { return { id, name: "Leaf Wrap" }; },
        formatItemTooltip(meta, quantity) {
            return quantity > 1 ? `${meta.name} x${quantity}` : meta.name;
        },
        showTooltip(textOrFn, _x, _y, target) {
            scene._tooltipSource = typeof textOrFn === "function" ? textOrFn : () => textOrFn;
            scene._tooltipTarget = target;
            scene.tooltip.text = scene._tooltipSource();
            scene.tooltip.visible = true;
        },
        refreshTooltip() {
            if (!scene._tooltipSource) return;
            scene.tooltip.text = scene._tooltipSource();
            scene.tooltip.visible = !!scene.tooltip.text;
        },
        hideTooltip() {
            scene._tooltipSource = null;
            scene._tooltipTarget = null;
            scene.tooltip.visible = false;
        },
        add: { image: () => fakeImage() },
        hotbar: { dirty: false },
        uiScale: 1,
        input: { activePointer: { x: 4, y: 4, rightButtonDown: () => true } }
    };

    const panel = Object.create(EquipmentPanel.prototype);
    panel.scene = scene;
    panel.visible = true;
    panel.slotViews = [];
    panel.slotsLayer = { add() {}, removeAll() {} };
    panel._updateIcons = () => {};
    for (const key of ["head", "torso", "back", "legs", "feet"]) panel._addSlotView(key);
    panel._slotKeySig = panel._slotKeys().join(",");

    const head = panel.slotViews.find((v) => v.key === "head");
    head.slot.emit("pointerover", scene.input.activePointer);
    assert.equal(scene.tooltip.text, "Head\nLeaf Wrap");

    head.slot.emit("pointerdown", scene.input.activePointer);
    assert.equal(gear.head, null);
    assert.equal(scene.tooltip.visible, true);
    assert.equal(scene.tooltip.text, "Head");
});
