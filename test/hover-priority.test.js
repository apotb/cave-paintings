const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

class LeanTo {}
class Storage {}
class Campfire {}
class CraftStation {}
class SettlingStone {}
class PaintingCircle {}

function loadHoverScene() {
    const sandbox = {
        console,
        Phaser: {
            Geom: { Rectangle: { Contains: () => false } },
            Math: { Clamp: (v, a, b) => Math.max(a, Math.min(b, v)) },
            Textures: { FilterMode: { NEAREST: 0 } }
        },
        LeanTo,
        Storage,
        Campfire,
        CraftStation,
        SettlingStone,
        PaintingCircle
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "Utils.js"), "utf8"), sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "scene", "tooltip.js"), "utf8"), sandbox);

    const chain = () => {
        const o = {
            width: 8,
            height: 8,
            style: { fontFamily: "PrimaryFont", resolution: 1 },
            setAlpha() { return o; },
            setVisible() { return o; },
            setText() { return o; },
            setPosition() { return o; },
            setDepth() { return o; },
            add() {},
            clearMask() {}
        };
        return o;
    };
    const scene = {
        settlers: [],
        party: [],
        _hits: [],
        _tooltipStatCss: () => "#aaaaaa",
        _isUiTooltipTarget: (obj) => !!obj?._ui,
        add: {
            container: chain,
            graphics: chain,
            text: chain
        },
        tooltipLayer: { add() {}, bringToTop() {} },
        input: {
            on() {},
            hitTestPointer() { return scene._hits; },
            activePointer: { x: 8, y: 8 },
            setDefaultCursor() {}
        },
        cameras: { main: { getWorldPoint: (x, y) => ({ x, y }) } },
        scale: { width: 800, height: 600 },
        events: { on() {} },
        _applyTooltipPayload() { return true; }
    };
    sandbox.SceneMainTooltip.createTooltip.call(scene);
    return scene;
}

function hit(meta, proto) {
    const obj = {
        active: true,
        input: { enabled: true },
        meta
    };
    if (proto) Object.setPrototypeOf(obj, proto);
    return obj;
}

function settler(extra = {}) {
    return {
        active: true,
        role: "settler",
        homeSettlementId: "camp",
        x: 0,
        y: 16,
        originX: 0,
        originY: 1,
        input: { enabled: false },
        ...extra
    };
}

test("settler body wins hover over hut, pit, and other stations", () => {
    const scene = loadHoverScene();
    const person = settler();
    scene.settlers = [person];
    const pointer = { x: 8, y: 8 };
    const buildings = [
        hit({ name: "Hut", sleep: { slots: 4 }, floor: "hut_floor" }, LeanTo.prototype),
        hit({ name: "Storage Pit", storage: { slots: 6 } }, Storage.prototype),
        hit({ name: "Wicker Basket", storage: { slots: 8 } }, Storage.prototype),
        hit({ name: "Drying Rack", dryingRack: true, storage: { slots: 1 } }, Storage.prototype),
        hit({ name: "Campfire", campfire: true }, Campfire.prototype),
        hit({ name: "Skinworking Bench", craftStation: true }, CraftStation.prototype),
        hit({ name: "Settling Stone", settlement: true }, SettlingStone.prototype),
        hit({ name: "Painting Circle", paintingCircle: true }, PaintingCircle.prototype)
    ];
    for (const building of buildings) {
        scene._hits = [building];
        assert.equal(scene._pickHoverTarget(pointer), person, building.meta.name);
    }
});

test("building hover stays when the cursor is not on a settler", () => {
    const scene = loadHoverScene();
    scene.settlers = [settler()];
    const hut = hit({ name: "Hut", sleep: { slots: 4 }, floor: "hut_floor" }, LeanTo.prototype);
    scene._hits = [hut];
    assert.equal(scene._pickHoverTarget({ x: 40, y: 40 }), hut);
});

test("a sleeping settler does not cover the shelter tip", () => {
    const scene = loadHoverScene();
    scene.settlers = [settler({ _resting: true })];
    const hut = hit({ name: "Hut", sleep: { slots: 4 }, floor: "hut_floor" }, LeanTo.prototype);
    scene._hits = [hut];
    assert.equal(scene._pickHoverTarget({ x: 8, y: 8 }), hut);
});

test("trees and loose hits still beat a settler standing on them", () => {
    const scene = loadHoverScene();
    const person = settler();
    scene.settlers = [person];
    const tree = hit({ name: "Tree", choppable: { stump: "tree_stump" } });
    scene._hits = [tree];
    assert.equal(scene._pickHoverTarget({ x: 8, y: 8 }), tree);
});

test("a building pointerover cannot replace a settler tip", () => {
    const scene = loadHoverScene();
    const person = settler();
    const hut = hit({ name: "Hut", sleep: {}, floor: "hut_floor" }, LeanTo.prototype);
    scene._hoverTarget = person;
    scene.input.activePointer = { x: 8, y: 8 };
    scene.showTooltip("Hut", 8, 8, hut);
    assert.equal(scene._tooltipTarget, null);
    scene.showTooltip("Ada", 8, 8, person);
    assert.equal(scene._tooltipTarget, person);
});
