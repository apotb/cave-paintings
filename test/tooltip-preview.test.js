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

function trackVisible(text) {
    text.visible = false;
    text.setVisible = (v) => { text.visible = v; return text; };
    return text;
}

test("stat lines gray, and spoil time turns light red at 6h", () => {
    const hud = loadHud();
    const scene = previewScene(hud, new Set());
    const tip = [
        "Berry",
        "Weight: 0.1 kg",
        "Food: 40 kcal",
        "Satiety: ×1.5",
        "Spoils in: 2d 3h",
        "Fuel: 40 kj, 200°C",
        "DPS: 1.5 melee",
        "Dig: +4%",
        "Chop: +12%",
        "Stack total: 0.4 kg, 80 kj",
        "Attack trees to chop them down"
    ].join("\n");
    assert.equal(scene._tooltipStatColor("Weight: 0.2 kg"), "muted");
    assert.equal(scene._tooltipStatColor("Fuel: 40 kj"), "muted");
    assert.equal(scene._tooltipStatColor("DPS: 1.5 melee"), "muted");
    assert.equal(scene._tooltipStatColor("Dig: +4%"), "muted");
    assert.equal(scene._tooltipStatColor("Chop: +12%"), "muted");
    assert.equal(scene._tooltipStatColor("Food: 40 kcal"), "muted");
    assert.equal(scene._tooltipStatColor("Satiety: ×1.5"), "muted");
    assert.equal(scene._tooltipStatColor("Spoils: paused"), "muted");
    assert.equal(scene._tooltipStatColor("Spoils in: 7h"), "muted");
    assert.equal(scene._tooltipStatColor("Spoils in: 1d"), "muted");
    assert.equal(scene._tooltipStatColor("Spoils in: 6h"), "warn");
    assert.equal(scene._tooltipStatColor("Spoils in: <1h"), "warn");
    assert.equal(scene._tooltipStatColor("Spoils in: 1h"), "warn");
    assert.equal(scene._tooltipStatColor("Satiety: 40"), "");
    assert.equal(scene._tooltipStatColor("Hardness: 5"), "muted");
    assert.equal(scene._tooltipStatColor("Toughness: 40%"), "muted");
    assert.equal(scene._tooltipStatColor("Beauty: +2.0"), "muted");
    assert.equal(scene._tooltipStatColor("Beauty: -1.0"), "muted");
    assert.equal(scene._tooltipStatColor("Beauty: 100%"), "");
    assert.equal(scene._tooltipStatColor("Stack total: 0.4 kg"), "muted");
    assert.equal(scene._tooltipStatColor("Tend quality: 35%"), "muted");
    assert.equal(scene._tooltipStatColor("Rest effectiveness: 95%"), "muted");
    assert.equal(scene._tooltipStatColor("Rest effectiveness: 100%"), "muted");
    assert.equal(scene._tooltipStatColor("Stick"), "");
    assert.equal(scene._tooltipStatColor("Slot: back"), "equip");
    assert.equal(scene._tooltipStatColor("+ 2 pack slots"), "equip");
    assert.equal(scene._tooltipStatColor("+ 4 kg carry"), "equip");
    assert.equal(scene._tooltipStatColor("+ 10% speed"), "equip");
    assert.equal(scene._tooltipStatColor("Armor: 12% sharp / 8% blunt"), "equip");
    assert.equal(scene._tooltipStatColor("Covers: torso, right shoulder"), "equip");
    assert.equal(scene._tooltipStatCss("muted"), "#a0a0a0");
    assert.equal(scene._tooltipStatCss("warn"), "#f0a0a0");
    assert.equal(scene._tooltipStatCss("equip"), "#f0a050");
    assert.equal(
        scene._tooltipColorOverlay("Basket\nSlot: back\n+ 2 pack slots\nWear on your back", "equip"),
        "\nSlot: back\n+ 2 pack slots\n"
    );
    assert.equal(
        scene._tooltipMutedOverlay(tip),
        "\nWeight: 0.1 kg\nFood: 40 kcal\nSatiety: ×1.5\nSpoils in: 2d 3h\nFuel: 40 kj, 200°C\nDPS: 1.5 melee\nDig: +4%\nChop: +12%\nStack total: 0.4 kg, 80 kj\n"
    );
    assert.equal(scene._tooltipColorOverlay(tip, "warn"), "");
    assert.equal(
        scene._tooltipColorOverlay("Berry\nSpoils in: 6h\nSpoils in: <1h", "warn"),
        "\nSpoils in: 6h\nSpoils in: <1h"
    );
    assert.equal(scene._tooltipMutedOverlay("Stick"), "");

    scene.tooltipMuted = trackVisible(tipText(0, 0));
    scene.tooltipWarn = trackVisible(tipText(0, 0));
    scene.tooltipEquip = trackVisible(tipText(0, 0));
    scene._tooltipSource = () => "Berry\nFood: 40 kcal\nSpoils in: 5h";
    assert.equal(scene._applyTooltipPayload(), true);
    assert.equal(scene.tooltipMuted.text, "\nFood: 40 kcal\n");
    assert.equal(scene.tooltipMuted.visible, true);
    assert.equal(scene.tooltipWarn.text, "\n\nSpoils in: 5h");
    assert.equal(scene.tooltipWarn.visible, true);

    scene._tooltipDrawn = false;
    scene._tooltipSource = () => "Pebble";
    scene._applyTooltipPayload();
    assert.equal(scene.tooltipMuted.text, "");
    assert.equal(scene.tooltipMuted.visible, false);
    assert.equal(scene.tooltipWarn.text, "");
    assert.equal(scene.tooltipWarn.visible, false);
    assert.equal(scene.tooltipEquip.text, "");
    assert.equal(scene.tooltipEquip.visible, false);
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

function loadParty() {
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, "js", "Party.js"), "utf8") + "\nthis.PartySystem = PartySystem;\n",
        sandbox
    );
    return sandbox;
}

function loadStarHud() {
    const sandbox = {
        console,
        pixelUiFontSize: (px) => px,
        Phaser: { Math: { Clamp: (v, a, b) => Math.min(b, Math.max(a, v)) } }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "SettlementPanel.js"), "utf8"), sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "scene", "hud.js"), "utf8"), sandbox);
    return sandbox;
}

function starGfx() {
    const g = {
        visible: false,
        x: 0,
        y: 0,
        rects: 0,
        clear() { g.rects = 0; return g; },
        fillStyle() { return g; },
        fillRect() { g.rects += 1; return g; },
        setVisible(v) { g.visible = !!v; return g; },
        setPosition(x, y) { g.x = x; g.y = y; return g; }
    };
    return g;
}

function padText(w, h) {
    const t = tipText(w, h);
    t.pad = null;
    t.setPadding = (p) => { t.pad = p; return t; };
    return t;
}

test("a band of wanderers cannot be recruited", () => {
    const { PartySystem } = loadParty();
    const scene = {
        party: [{}],
        player: { getHeldItem: () => ({ id: "apple", food: { kc: 40 } }) },
        getItem: () => ({ food: { kc: 40 } })
    };
    const sys = new PartySystem(scene);
    const band = {
        role: "wanderer",
        pawnName: "Og",
        displayName: () => "Og",
        hostile: false,
        recruitLocked: false,
        band: true
    };
    assert.equal(sys.recruitTooltip(band), "Og\nCannot be recruited");
    scene.party = [{}, {}, {}, {}, {}, {}];
    assert.equal(sys.recruitTooltip(band), "Og\nCannot be recruited");

    const solo = { ...band, band: false };
    scene.party = [{}];
    assert.equal(sys.recruitTooltip(solo), "Og\nClick to recruit\nThey look interested");
});

test("camera follow gives the controlled leader the ally hover tip", () => {
    const { PartySystem } = loadParty();
    const settler = {
        active: true,
        role: "settler",
        pawnName: "Ada",
        displayName: () => "Ada",
        homeSettlementId: "camp"
    };
    const scene = {
        player: null,
        leader: null,
        party: [],
        settlers: [settler],
        focusPawn: null,
        _followFocusedSettler: false
    };
    const leader = {
        role: "leader",
        pawnName: "Ash",
        displayName: () => "Ash",
        inventory: [{ id: "spear", quantity: 1 }],
        inventorySize: 1,
        isControlled: () => scene.player === leader
    };
    scene.player = leader;
    scene.leader = leader;
    scene.party = [leader];
    const sys = new PartySystem(scene);
    assert.equal(sys.hoverTooltip(leader), "Ash\nWaiting");
    scene.focusPawn = settler;
    scene._followFocusedSettler = true;
    const followed = sys.hoverTooltip(leader);
    assert.equal(followed.text, "Ash\nWaiting");
    assert.equal(followed.rows.length, 1);
    const settlerTip = sys.hoverTooltip(settler);
    const settlerText = typeof settlerTip === "object" ? settlerTip.text : settlerTip;
    assert.equal(settlerText.split("\n")[0], "Ada");
    scene._followFocusedSettler = false;
    assert.equal(sys.hoverTooltip(leader), "Ash\nWaiting");
});

test("favorited settler and party tooltips flag a star beside the name", () => {
    const { PartySystem } = loadParty();
    const scene = { party: [], settlers: [] };
    const sys = new PartySystem(scene);
    const settler = {
        role: "settler",
        favorite: true,
        pawnName: "Ugg",
        displayName: () => "Ugg",
        kc: 40,
        saturation: 0,
        stomach: 100,
        homeSettlementId: "camp"
    };
    const tipped = sys.hoverTooltip(settler);
    assert.equal(tipped.star, true);
    assert.equal(tipped.text.split("\n")[0], "Ugg");
    settler.favorite = false;
    const plain = sys.hoverTooltip(settler);
    assert.equal(plain.star, undefined);

    const mate = {
        role: "companion",
        favorite: true,
        pawnName: "Aka",
        displayName: () => "Aka"
    };
    scene.party = [mate];
    const partyTip = sys.hoverTooltip(mate);
    assert.equal(partyTip.star, true);
    assert.equal(partyTip.text.split("\n")[0], "Aka");
    const card = sys.withHeldTooltip(mate, "Aka\nWaiting");
    assert.equal(card.star, true);

    const hint = sys.withFavoriteStar(mate, "Click yourself to form clay");
    assert.equal(hint, "Click yourself to form clay");
    mate.favorite = false;
    assert.equal(sys.hoverTooltip(mate).star, undefined);
});

test("a favorite star sits in the margin of the tooltip name", () => {
    const { SceneMainHud } = loadStarHud();
    const scene = previewScene(SceneMainHud, new Set());
    scene.tooltipText = padText(100, 22);
    scene.tooltipSub = padText(80, 16);
    scene.tooltipHunger = starGfx();
    scene.tooltipStar = starGfx();
    scene._tooltipSource = () => ({ text: "Ugg\nIdle", star: true });
    assert.equal(scene._applyTooltipPayload(), true);
    assert.equal(scene.tooltipText.text, "Ugg");
    assert.equal(scene.tooltipSub.text, "Idle");
    assert.equal(scene.tooltipText.pad.left, 24);
    assert.equal(scene.tooltipText.pad.bottom, 0);
    assert.equal(scene.tooltipSub.pad.left, 6);
    assert.equal(scene.tooltipSub.pad.top, 0);
    assert.equal(scene.tooltipStar.visible, true);
    assert.equal(scene.tooltipStar.rects > 0, true);
    assert.equal(scene.tooltipStar.x, 13.5);
    assert.equal(scene.tooltipStar.y, 14);

    scene.tooltipText.displayHeight = 24;
    scene._tooltipSource = () => ({
        text: "Ugg\nChopping",
        hunger: { kc: 10, sat: 0, stomach: 100 },
        star: true
    });
    scene._applyTooltipPayload();
    assert.equal(scene.tooltipText.text, "Ugg");
    assert.equal(scene.tooltipSub.text, "Chopping");
    assert.equal(scene.tooltipText.pad.left, 24);
    assert.equal(scene.tooltipSub.pad.left, 6);

    scene.tooltipText.displayHeight = 22;
    scene._tooltipSource = () => ({ text: "Ugg\nIdle" });
    scene._applyTooltipPayload();
    assert.equal(scene.tooltipText.text, "Ugg\nIdle");
    assert.equal(scene.tooltipText.pad.left, 6);
    assert.equal(scene.tooltipSub.text, "");
    assert.equal(scene.tooltipStar.visible, false);
});
