const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const Stone = require("../shared/stone");
const Carry = require("../shared/carry");
const Settlement = require("../shared/settlement");

function loadCraft() {
    const sandbox = { console, Stone, Carry, Settlement };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "scene", "craft.js"), "utf8"), sandbox);
    sandbox.ensureStoneTexture = (_scene, kind, variant, stone) => `stone_${kind}_${variant}_${stone}`;
    sandbox.ensurePaintingCircleTexture = (_scene, stone) => `painting_circle_stone_${stone}`;
    sandbox.stuffedStackIconKey = (_scene, stack) => {
        if (stack.id === "pebble") return `stone_pebble_2_${stack.stone || "andesite"}`;
        if (stack.id === "grindstone") return `stone_grindstone_1_${stack.stone || "andesite"}`;
        if (stack.id === "painting_circle") return `painting_circle_stone_${stack.stone || "andesite"}`;
        if (stack.id === "stone_spear" || stack.id === "flint_spear") {
            return `spear_${stack.knapMaterial || "andesite"}`;
        }
        return null;
    };
    sandbox.Place = {
        itemIconKey(def, _getThing, has) {
            const key = def?.key || def?.id;
            return has(key) ? key : "";
        }
    };
    sandbox.Thing = {
        textureKeyFor(_scene, meta) {
            return meta?.rotations ? `${meta.key}_0` : (meta?.key || "");
        }
    };
    sandbox.Knapping = {
        carveShapeIcon(_scene, toolClass, stoneId) {
            return `${toolClass}:${stoneId}`;
        },
        ensureToolTexture(_scene, stack) {
            return `knap_${stack.toolClass}_${stack.knapIconData}`;
        }
    };
    return sandbox.SceneMainCraft;
}

function sceneFor(craft) {
    const textures = new Set([
        "stick", "log", "deer_hide_dry", "deer_leather", "stone_tool",
        "stone_rock_1_andesite", "stone_pebble_1_andesite", "stone_pebble_2_andesite",
        "stone_grindstone_1_andesite", "painting_circle_stone_andesite",
        "skinworking_bench_0", "campfire_1", "spear_andesite",
        "knap_knife_knife:andesite", "knap_scraper_scraper:andesite",
        "knap_awl_awl:andesite", "knap_spear_tip_spear_tip:andesite"
    ]);
    const scene = Object.assign({
        textures: { exists: (key) => textures.has(key) },
        getItem(id) {
            return { id, name: id, key: id };
        },
        getThing(id) {
            if (id === "rock") return { id, name: "Rock", key: "rock" };
            if (id === "skinworking_bench") {
                return { id, name: "Skinworking Bench", key: "skinworking_bench", rotations: [0, 90, 180, 270] };
            }
            if (id === "campfire") return { id, name: "Campfire", key: "campfire", anim: { parts: 2 } };
            return null;
        }
    }, craft);
    scene.formatItemTooltip = () => "Made thing";
    scene._craftPreviewStack = () => null;
    scene._craftIngredientHave = () => 4;
    scene._craftQueuedNeed = () => 1;
    return scene;
}

test("recipe tooltip puts icons on ingredient, rock, and cycling tool rows", () => {
    const craft = loadCraft();
    const scene = sceneFor(craft);
    const tip = scene._craftRecipeTooltip({
        id: "digging_stick",
        quantity: 1,
        ingredients: [
            { id: "stick", qty: 1 },
            { id: "pebble", qty: 1 },
            { id: "andesite", qty: 2 }
        ],
        requireThing: "rock",
        requireTool: { toolClass: ["knife", "scraper"], wear: 5 }
    });
    assert.equal(tip.text, "Made thing\n—");
    assert.equal(tip.lines[0].icon, "stick");
    assert.equal(tip.lines[0].label, "stick");
    assert.equal(tip.lines[0].value, "3/1");
    assert.equal(tip.lines[1].icon, "stone_pebble_2_andesite");
    assert.equal(tip.lines[1].value, "3/1");
    assert.equal(tip.lines[2].icon, "stone_pebble_1_andesite");
    assert.equal(tip.lines[3].icon, "stone_rock_1_andesite");
    assert.equal(tip.lines[3].label, "Requires nearby Rock");
    assert.equal(tip.lines[4].label, "Requires held Knife or Scraper");
    assert.equal(tip.lines[4].icon, "knap_knife_knife:andesite");
    assert.equal(tip.lines[4].icons[0], "knap_knife_knife:andesite");
    assert.equal(tip.lines[4].icons[1], "knap_scraper_scraper:andesite");
    assert.equal(tip.lines[4].icons.length, 2);
});

test("a recipe with nothing required omits the ingredient rule", () => {
    const craft = loadCraft();
    const scene = sceneFor(craft);
    const tip = scene._craftRecipeTooltip({
        id: "crafting_spot",
        quantity: 1,
        ingredients: []
    });
    assert.equal(tip.text, "Made thing");
    assert.equal(tip.lines.length, 0);
});

test("hide and station rows use deer hide and the bench sprite", () => {
    const craft = loadCraft();
    const scene = sceneFor(craft);
    const tip = scene._craftRecipeTooltip({
        id: "hide_pouch",
        quantity: 1,
        ingredients: [{ id: "ANY_HIDE", qty: 1, hideStage: "dried" }],
        requireStation: "skinworking_bench",
        requireTool: { toolClass: "awl", wear: 10 }
    });
    assert.equal(tip.lines[0].icon, "deer_hide_dry");
    assert.equal(tip.lines[0].label, "Any Dried Hide");
    assert.equal(tip.lines[1].icon, "skinworking_bench_0");
    assert.equal(tip.lines[1].label, "Requires Skinworking Bench");
    assert.equal(tip.lines[2].icon, "knap_awl_awl:andesite");
    assert.equal(tip.lines[2].icons, undefined);
    assert.equal(tip.lines[2].label, "Requires held Awl");
});

test("a spear tip ingredient uses the andesite knap picture", () => {
    const craft = loadCraft();
    const scene = sceneFor(craft);
    const tip = scene._craftRecipeTooltip({
        id: "stone_spear",
        quantity: 1,
        ingredients: [{ id: "stone_tool", qty: 1, toolClass: "spear_tip" }, { id: "stone_spear", qty: 1 }]
    });
    assert.equal(tip.lines[0].icon, "knap_spear_tip_spear_tip:andesite");
    assert.equal(tip.lines[0].label, "Spear Tip");
    assert.equal(tip.lines[1].icon, "spear_andesite");
});

function loadHud() {
    const sandbox = {
        console,
        PIXEL_UI_FONT: "font",
        pixelUiFontSize: (n) => n,
        crispUiText: (t) => t
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "scene", "hud.js"), "utf8"), sandbox);
    return sandbox.SceneMainHud;
}

test("several tool icons swap every 0.75s without rebuilding the tip", () => {
    const hud = loadHud();
    const images = [];
    let pending = null;
    const textObj = () => ({
        text: "",
        displayWidth: 40,
        setOrigin() { return this; },
        setPosition() { return this; },
        setVisible() { return this; }
    });
    const scene = {
        uiScale: 1,
        _tooltipPadding: 6,
        _tooltipGearSig: null,
        textures: { exists: () => true },
        tooltipGear: {
            add() {},
            removeAll() { images.length = 0; }
        },
        add: {
            image(_x, _y, key) {
                const img = {
                    scene,
                    active: true,
                    key,
                    setOrigin() { return img; },
                    setTexture(k) { img.key = k; return img; },
                    setDisplaySize() { return img; }
                };
                images.push(img);
                return img;
            },
            text(_x, _y, str) {
                const t = textObj();
                t.text = str;
                return t;
            }
        },
        time: {
            delayedCall(delay, cb) {
                const ev = {
                    delay,
                    removed: false,
                    remove() { ev.removed = true; pending = null; }
                };
                pending = { delay, cb, ev };
                return ev;
            }
        }
    };
    Object.assign(scene, hud);
    const lines = [{ icon: "knife", icons: ["knife", "scraper"], label: "Requires held Knife or Scraper" }];
    scene._syncTooltipLines(lines);
    assert.equal(images[0].key, "knife");
    assert.equal(pending.delay, 750);
    const firstSig = scene._tooltipGearSig;
    pending.cb();
    assert.equal(images[0].key, "scraper");
    assert.equal(scene._tooltipGearSig, firstSig);
    scene._syncTooltipLines(lines);
    assert.equal(images[0].key, "scraper");
    assert.equal(images.length, 1);
    pending.cb();
    assert.equal(images[0].key, "knife");
    scene._clearTooltipGear();
    assert.equal(pending, null);
});
