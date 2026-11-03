const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../js/scene/craft.js"), "utf8");
const sandbox = {};
vm.runInNewContext(src, sandbox);
const craft = sandbox.SceneMainCraft;

function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x;
        const yi = poly[i].y;
        const xj = poly[j].x;
        const yj = poly[j].y;
        const hit = (yi > y) !== (yj > y)
            && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
        if (hit) inside = !inside;
    }
    return inside;
}

test("recipes without a time default to half a second", () => {
    const recipes = craft.getKnownRecipes.call({
        items() {
            return [
                { id: "twig", name: "Twig", key: "twig", recipe: { stick: 1 } },
                { id: "slow", name: "Slow", key: "slow", recipe: { stick: 1, CRAFT_SECONDS: 4 } },
                { id: "instant", name: "Instant", key: "instant", recipe: { stick: 1, CRAFT_SECONDS: 0 } }
            ];
        },
        _isRecipeMetaKey: craft._isRecipeMetaKey,
        textures: { exists: () => false },
        getThing() { return null; }
    });
    assert.equal(recipes.find((r) => r.id === "twig").craftSeconds, 0.5);
    assert.equal(recipes.find((r) => r.id === "slow").craftSeconds, 4);
    assert.equal(recipes.find((r) => r.id === "instant").craftSeconds, 0);
});

test("a timed click joins the queue", () => {
    const queued = [];
    const ok = craft.doCraft.call({
        _enqueueCrafts(recipe, n) {
            queued.push([recipe.id, n]);
            return n;
        },
        simAuth() { return false; },
        canCraft() { return true; },
        _finishCraft() { throw new Error("queued crafts wait their turn"); }
    }, { id: "cord", craftSeconds: 0.5 }, 3);
    assert.equal(ok, true);
    assert.deepEqual(queued, [["cord", 3]]);
});

test("an explicit zero-second recipe still finishes immediately", () => {
    let finished = 0;
    craft.doCraft.call({
        _enqueueCrafts() { throw new Error("instant craft should not queue"); },
        simAuth() { return false; },
        canCraft() { return true; },
        _finishCraft() { finished += 1; }
    }, { id: "cord", craftSeconds: 0 }, 2);
    assert.equal(finished, 2);
});

test("the higher queue box is the one crafting", () => {
    const ctx = {
        _craftQueue: [],
        _craftMenuData: { slotW: 64, slotH: 64, pad: 4, gridW: 200, gridH: 300 },
        _craftQueueAfford() { return 9; },
        _craftQueueRoom() { return 9; },
        _pumpCraftQueue() {},
        _layoutCraftQueue() {}
    };
    ctx._craftQueueGeom = craft._craftQueueGeom;
    craft._enqueueCrafts.call(ctx, { id: "cord" }, 1);
    craft._enqueueCrafts.call(ctx, { id: "spear" }, 2);
    assert.deepEqual(ctx._craftQueue.map((j) => j.recipe.id), ["cord", "spear", "spear"]);
    ctx._craftQueueSame = craft._craftQueueSame;
    ctx._craftQueueGroups = craft._craftQueueGroups;
    const groups = craft._craftQueueGroups.call(ctx);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].recipe.id, "cord");
    assert.equal(groups[0].count, 1);
    assert.equal(groups[1].recipe.id, "spear");
    assert.equal(groups[1].count, 2);
    const first = craft._craftQueueSlotPos.call(ctx, 0);
    const below = craft._craftQueueSlotPos.call(ctx, 1);
    assert.equal(first.w, 32);
    assert.equal(first.h, 32);
    assert.equal(first.x, 204);
    assert.equal(first.y, 0);
    assert.ok(below.y > first.y);
});

test("adjacent crafts of the same item share one box", () => {
    const ctx = { _craftQueueSame: craft._craftQueueSame };
    const groups = craft._craftQueueGroups.call(ctx, [
        { recipe: { id: "cord" } },
        { recipe: { id: "cord" } },
        { recipe: { id: "spear" } },
        { recipe: { id: "cord" } },
        { recipe: { id: "cord" } },
        { recipe: { id: "cord" } }
    ]);
    assert.equal(groups.length, 3);
    assert.equal(groups[0].recipe.id, "cord");
    assert.equal(groups[0].count, 2);
    assert.equal(groups[1].recipe.id, "spear");
    assert.equal(groups[1].count, 1);
    assert.equal(groups[2].recipe.id, "cord");
    assert.equal(groups[2].count, 3);
});

test("a run of the same item only spends one queue box", () => {
    const ctx = {
        _craftQueue: [],
        _craftMenuData: { slotW: 64, slotH: 64, pad: 4, gridW: 200, gridH: 36 },
        craftContainer: { y: 0 },
        _craftQueueAfford() { return 99; },
        _pumpCraftQueue() {},
        _layoutCraftQueue() {}
    };
    ctx._craftQueueGeom = craft._craftQueueGeom;
    ctx._craftQueueLimit = craft._craftQueueLimit;
    ctx._craftQueueSame = craft._craftQueueSame;
    ctx._craftQueueGroups = craft._craftQueueGroups;
    ctx._craftQueueRoom = craft._craftQueueRoom;
    assert.equal(craft._enqueueCrafts.call(ctx, { id: "cord" }, 4), 4);
    assert.equal(ctx._craftQueue.length, 4);
    assert.equal(craft._enqueueCrafts.call(ctx, { id: "spear" }, 1), 0);
});

test("a taken queue job is already spent", () => {
    const ctx = {
        _craftQueue: [
            { taken: true, recipe: { ingredients: [{ id: "stick", qty: 2 }] } },
            { recipe: { ingredients: [{ id: "stick", qty: 1 }] } }
        ],
        _craftIngredientsMatch: craft._craftIngredientsMatch
    };
    assert.equal(craft._craftQueuedNeed.call(ctx, { id: "stick" }), 1);
});

test("queueing spends ingredients and cancelling gives them back", () => {
    const inv = [{ id: "leaf", quantity: 10 }];
    const ctx = {
        player: {
            inventory: inv,
            loseMatchingItems(match, into) {
                const take = Math.min(inv[0].quantity, match.qty);
                inv[0].quantity -= take;
                if (into && take > 0) into.push({ id: "leaf", quantity: take });
                return take;
            },
            gainItem(_item, qty) {
                inv[0].quantity += qty;
                return 0;
            }
        },
        canCraft() { return true; },
        _craftPayPreview() {
            return { id: "cord", tipQuality: null, tipMaterial: null, tipStone: null, pebbleStone: null };
        },
        _openCraftStorage() { return null; },
        _loseCraftSlots() { return 0; },
        getItem(id) { return { id }; },
        hotbar: { dirty: false },
        _layoutCraftQueue() {},
        simAuth() { return false; }
    };
    ctx._takeCraftIngredients = craft._takeCraftIngredients;
    ctx._refundCraftPiece = craft._refundCraftPiece;
    ctx._refundCraftJob = craft._refundCraftJob;
    const paid = craft._payCraftLocal.call(ctx, {
        id: "cord",
        ingredients: [{ id: "leaf", qty: 5 }]
    });
    assert.equal(inv[0].quantity, 5);
    assert.equal(paid.refund[0].quantity, 5);
    ctx._craftQueue = [{ recipe: { id: "cord" }, taken: true, paid }];
    craft._refundOpenCraftQueue.call(ctx);
    assert.equal(inv[0].quantity, 10);
    assert.equal(ctx._craftQueue.length, 0);
});

test("queued crafts reserve ingredients", () => {
    const ctx = {
        _craftQueue: [
            { recipe: { ingredients: [{ id: "stick", qty: 2 }] } },
            { recipe: { ingredients: [{ id: "leaf", qty: 1 }] } }
        ],
        _craftIngredientHave(ing) { return ing.id === "stick" ? 5 : 0; },
        _craftToolRepeats() { return null; },
        hasNearbyThing() { return true; },
        _findNearbyCraftStation() { return {}; },
        _heldMatchesCraftTool() { return true; }
    };
    ctx._craftQueuedNeed = craft._craftQueuedNeed;
    ctx._craftIngredientsMatch = craft._craftIngredientsMatch;
    ctx._craftToolKey = craft._craftToolKey;
    ctx._craftQueuedToolUses = craft._craftQueuedToolUses;
    assert.equal(craft._craftQueueAfford.call(ctx, {
        ingredients: [{ id: "stick", qty: 1 }]
    }), 3);
});

function uiObj() {
    const handlers = {};
    const obj = {
        setOrigin() { return obj; },
        setScale() { return obj; },
        setInteractive() { return obj; },
        setVisible() { return obj; },
        setColor() { return obj; },
        setStroke() { return obj; },
        setFontSize() { return obj; },
        setStrokeStyle() { return obj; },
        on(ev, fn) {
            (handlers[ev] = handlers[ev] || []).push(fn);
            return obj;
        },
        emit(ev, arg) {
            for (const fn of handlers[ev] || []) fn(arg);
        }
    };
    return obj;
}

test("crafting spot leads the menu only inside your settlement and places instead of granting", () => {
    sandbox.pixelUiFontSize = () => 16;
    sandbox.PIXEL_UI_FONT = "font";
    sandbox.crispUiText = (t) => t;
    sandbox.Phaser = { Math: { Clamp: (v, a, b) => Math.min(b, Math.max(a, v)) } };
    const items = [
        { id: "leaf_cord", name: "Leaf Cord", key: "leaf_cord", recipe: { leaf: 5 } },
        { id: "crafting_spot", name: "Crafting Spot", key: "crafting_spot", recipe: {} }
    ];
    function scene(here) {
        const calls = [];
        const ctx = {
            items: () => items,
            _isRecipeMetaKey: craft._isRecipeMetaKey,
            textures: {
                exists: () => false,
                get: () => ({ getSourceImage: () => ({ width: 32, height: 32 }) })
            },
            getThing() { return null; },
            settlementSys: { here: () => here },
            player: {},
            craftContainer: { list: [], removeAll() { this.list = []; }, add() {} },
            nearbyCraftStationIds: () => [],
            uiScale: 1,
            _craftPage: 0,
            add: {
                image: () => uiObj(),
                text: () => uiObj(),
                rectangle: () => uiObj()
            },
            tweens: { killTweensOf() {}, addCounter() { return { stop() {} }; } },
            showTooltip() {},
            positionCraftMenu() {},
            _layoutCraftTakeButton() {},
            _layoutCraftSettle() {},
            _layoutCraftQueue() {},
            _detachCraftQueueLayer() {},
            _attachCraftQueueLayer() {},
            closeCraftMenu() { calls.push("close"); },
            beginCraftingSpotPlace() { calls.push("place"); },
            doCraft() { calls.push("craft"); return true; },
            gainItem() { calls.push("gain"); },
            canCraft() { return true; },
            _craftRecipeIconKey() { return "slot"; },
            _restoreCraftTooltip() {}
        };
        ctx.getKnownRecipes = craft.getKnownRecipes;
        ctx.refreshCraftMenu = craft.refreshCraftMenu;
        ctx._craftMenuLayoutSig = craft._craftMenuLayoutSig;
        ctx._addCraftPager = craft._addCraftPager;
        ctx._addCraftNavArrow = craft._addCraftNavArrow;
        ctx._craftHoverRecipeId = craft._craftHoverRecipeId;
        return { ctx, calls };
    }

    const away = scene(null);
    assert.equal(craft.getKnownRecipes.call(away.ctx).some((r) => r.id === "crafting_spot"), false);

    const home = scene({});
    craft.refreshCraftMenu.call(home.ctx);
    assert.equal(home.ctx._data[0].recipe.id, "crafting_spot");
    assert.equal(home.ctx._data[1].recipe.id, "leaf_cord");
    home.ctx._data[0].slot.emit("pointerdown", { shiftKey: true, ctrlKey: true });
    assert.deepEqual(home.calls, ["close", "place"]);
});

test("the sweep is a clockwise trail from the top", () => {
    const poly = (p) => craft._craftSweepPoly(0, 0, 100, 100, p);
    assert.equal(poly(0).length, 0);
    const early = poly(0.1);
    const earlyEnd = early[early.length - 1];
    assert.ok(earlyEnd.y < 1, "a short sweep still ends on the top edge");
    assert.ok(earlyEnd.x > 50, "clockwise moves toward the right");
    const q1 = poly(0.25);
    assert.equal(pointInPoly(70, 20, q1), true);
    assert.equal(pointInPoly(70, 70, q1), false);
    assert.equal(pointInPoly(20, 20, q1), false);
    const half = poly(0.5);
    assert.equal(pointInPoly(75, 20, half), true);
    assert.equal(pointInPoly(75, 80, half), true);
    assert.equal(pointInPoly(20, 50, half), false);
    const q3 = poly(0.75);
    assert.equal(pointInPoly(20, 20, q3), false);
    assert.equal(pointInPoly(20, 75, q3), true);
    assert.equal(pointInPoly(75, 20, q3), true);
    const full = poly(1);
    assert.equal(pointInPoly(20, 20, full), true);
    assert.equal(pointInPoly(80, 80, full), true);
});
