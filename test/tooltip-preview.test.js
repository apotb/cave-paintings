const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function loadHud() {
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "scene", "hud.js"), "utf8"), sandbox);
    return sandbox.SceneMainHud;
}

function loadFigurine() {
    const sandbox = {
        console,
        Phaser: { Physics: { Arcade: { Sprite: class Sprite {} } } }
    };
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(ROOT, "js", "Thing.js"), "utf8")
        + "\nthis.ClayFigurine = ClayFigurine;\n";
    vm.runInContext(source, sandbox);
    return sandbox;
}

function chainGfx() {
    const g = {
        clear() { return g; },
        fillStyle() { return g; },
        fillRoundedRect() { return g; },
        lineStyle() { return g; },
        strokeRoundedRect() { return g; },
        setVisible() { return g; },
        setPosition(x, y) { g.x = x; g.y = y; return g; }
    };
    return g;
}

function tipText(w, h) {
    return {
        text: "",
        displayWidth: w,
        displayHeight: h,
        setText(t) { this.text = t; return this; },
        setPadding() { return this; },
        setVisible() { return this; },
        setPosition() { return this; }
    };
}

function previewScene(hud, keys) {
    const images = [];
    const scene = {
        uiScale: 1,
        _tooltipPadding: 6,
        _tooltipDrawn: false,
        _tooltipGearSig: null,
        _tooltipGearW: 0,
        _tooltipGearH: 0,
        _tooltipHungerSig: "",
        _tooltipHungerW: 0,
        _tooltipHungerH: 0,
        _tooltipPreviewKey: "",
        _tooltipPreviewW: 0,
        _tooltipPreviewH: 0,
        tooltipText: tipText(100, 36),
        tooltipSub: tipText(0, 0),
        tooltipHunger: chainGfx(),
        tooltipGear: { setPosition() {}, removeAll() {} },
        tooltipBg: chainGfx(),
        tooltip: { add(img) { this.kids.push(img); }, kids: [] },
        textures: {
            exists: (key) => keys.has(key),
            get() { return { setFilter() {} }; }
        },
        add: {
            image(x, y, key) {
                const img = {
                    scene,
                    x, y, key,
                    originX: 0, originY: 0,
                    visible: true,
                    displayWidth: 0,
                    displayHeight: 0,
                    width: 64,
                    height: 64,
                    setOrigin(ox, oy) { img.originX = ox; img.originY = oy; return img; },
                    setTexture(k) { img.key = k; return img; },
                    setDisplaySize(w, h) { img.displayWidth = w; img.displayHeight = h; return img; },
                    setVisible(v) { img.visible = v; return img; },
                    setPosition(px, py) { img.x = px; img.y = py; return img; }
                };
                images.push(img);
                return img;
            }
        },
        images
    };
    for (const name of Object.keys(hud)) scene[name] = hud[name];
    return scene;
}

test("placed figurine tooltip returns the inventory bake without stamping the entry", () => {
    const sandbox = loadFigurine();
    const entry = {
        id: "clay_figurine",
        customName: "Idol",
        formVoxels: "abc",
        formClass: "deity",
        formColor: 0xc47a6a,
        beauty: 2
    };
    const seen = [];
    sandbox.Stats = {
        tooltipLines(_item, stack) {
            return stack?.beauty ? ["Beauty: +2.0"] : [];
        }
    };
    sandbox.ClayForming = {
        ensureFormTexture(scene, stack) {
            seen.push(stack);
            assert.notEqual(stack, entry);
            assert.equal(stack.formVoxels, "abc");
            assert.equal(stack.formColor, 0xc47a6a);
            return "form_ui2_abc";
        }
    };
    const fig = Object.create(sandbox.ClayFigurine.prototype);
    fig.entry = entry;
    fig.meta = { name: "Clay Figurine" };
    fig.scene = {
        getItem: () => ({ name: "Clay Figurine" }),
        textures: { exists: (key) => key === "form_ui2_abc" }
    };
    const tip = fig.tooltipText();
    assert.equal(String(tip.text), "Idol\nBeauty: +2.0");
    assert.equal(String(tip.preview), "form_ui2_abc");
    assert.equal(entry.formIcon, undefined);
    assert.equal(entry.formPlaceIcon, undefined);
    assert.equal(seen.length, 1);
    fig.entry = { id: "clay_figurine" };
    assert.equal(String(fig.tooltipText()), "Clay Figurine");
});

test("sculpture preview sits under the text and swaps when the bake changes", () => {
    const hud = loadHud();
    const scene = previewScene(hud, new Set(["form_a", "form_b"]));
    scene._tooltipSource = () => ({ text: "Idol\nBeauty: +2.0", preview: "form_a" });
    assert.equal(scene._applyTooltipPayload(), true);
    const img = scene.tooltipPreview;
    assert.equal(img.key, "form_a");
    assert.equal(img.visible, true);
    assert.equal(img.originX, 0);
    assert.equal(img.displayWidth, 64);
    assert.equal(img.displayHeight, 64);
    assert.ok(img.y >= scene.tooltipText.displayHeight);
    assert.equal(img.x, scene._tooltipPadding);
    const withPreview = scene._tooltipBoxH;

    scene._tooltipSource = () => ({ text: "Idol\nBeauty: +2.0", preview: "form_b" });
    scene._applyTooltipPayload();
    assert.equal(img.key, "form_b");
    assert.equal(img.visible, true);

    scene._tooltipSource = () => "Stick";
    scene._applyTooltipPayload();
    assert.equal(img.visible, false);
    assert.equal(scene._tooltipPreviewH, 0);
    assert.ok(scene._tooltipBoxH < withPreview);

    scene._clearTooltipPreview();
    assert.equal(scene._tooltipPreviewKey, "");
    assert.equal(img.visible, false);
});

test("opaque bounds drop the empty margin around a sculpture", () => {
    const hud = loadHud();
    const w = 8;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    const at = (x, y) => (y * w + x) * 4;
    data[at(2, 1) + 3] = 255;
    data[at(3, 1) + 3] = 255;
    const bounds = hud._tooltipOpaqueBounds(data, w, h);
    assert.equal(Number(bounds.x), 1);
    assert.equal(Number(bounds.y), 0);
    assert.equal(Number(bounds.w), 4);
    assert.equal(Number(bounds.h), 3);
});

test("a missing sculpture bake stays text-only", () => {
    const hud = loadHud();
    const scene = previewScene(hud, new Set());
    scene._tooltipSource = () => ({ text: "Lump", preview: "form_missing" });
    assert.equal(scene._applyTooltipPayload(), true);
    assert.equal(scene.tooltipPreview, undefined);
    assert.equal(scene._tooltipPreviewH, 0);
    assert.equal(scene.tooltipText.text, "Lump");
});

test("a destroyed sculpture preview is rebuilt instead of setTexture on the dead image", () => {
    const hud = loadHud();
    const scene = previewScene(hud, new Set(["form_a"]));
    let deadCalls = 0;
    scene.tooltipPreview = {
        scene: null,
        setTexture() { deadCalls += 1; throw new TypeError("Cannot read properties of undefined (reading 'sys')"); },
        setVisible() { deadCalls += 1; }
    };
    scene._tooltipSource = () => ({ text: "Idol", preview: "form_a" });
    assert.equal(scene._applyTooltipPayload(), true);
    assert.equal(deadCalls, 0);
    assert.equal(scene.tooltipPreview.key, "form_a");
    assert.equal(scene.tooltipPreview.scene, scene);
    assert.equal(scene.tooltip.kids.includes(scene.tooltipPreview), true);
});
