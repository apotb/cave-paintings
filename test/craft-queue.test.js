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

test("a queue click takes one, five, ten, or the whole stack", () => {
    const count = (pointer, have, keys) => craft._craftQueueClickCount.call({
        player: { keys: keys || {} }
    }, pointer, have);
    const left = { event: {}, rightButtonDown() { return false; } };
    assert.equal(count(left, 8), 1);
    assert.equal(count({ event: {}, button: 2 }, 8), 5);
    assert.equal(count({ event: {}, rightButtonDown() { return true; } }, 3), 3);
    assert.equal(count({ event: { ctrlKey: true }, button: 2 }, 12), 10);
    assert.equal(count({ event: { metaKey: true } }, 4), 4);
    assert.equal(count({ event: { shiftKey: true, ctrlKey: true }, button: 2 }, 12), 12);
    assert.equal(count(left, 6, { SHIFT: { isDown: true } }), 6);
    assert.equal(count(left, 20, { CTRL: { isDown: true } }), 10);
});

test("clicking a queue stack refunds from the end and leaves the one crafting", () => {
    const refunded = [];
    const ctx = {
        _craftQueue: [
            { recipe: { id: "cord" }, taken: true },
            { recipe: { id: "cord" }, taken: true },
            { recipe: { id: "cord" }, taken: true },
            { recipe: { id: "cord" }, taken: true },
            { recipe: { id: "spear" }, taken: true }
        ],
        _craftQueueLive: true,
        player: { _craftChannel: { fromQueue: true } },
        simAuth() { return false; },
        _refundCraftJob(_who, job) { refunded.push(job.recipe.id); },
        _pumpCraftQueue() { this.pumped = true; },
        _layoutCraftQueue() {},
        refreshCraftMenu() {},
        refreshTooltip() {},
        hotbar: {}
    };
    ctx._craftQueueSame = craft._craftQueueSame;
    ctx._craftQueueGroups = craft._craftQueueGroups;
    assert.equal(craft._unqueueCraftGroup.call(ctx, 0, 1), 1);
    assert.deepEqual(ctx._craftQueue.map((j) => j.recipe.id), ["cord", "cord", "cord", "spear"]);
    assert.deepEqual(refunded, ["cord"]);
    assert.ok(ctx.player._craftChannel);
    assert.equal(ctx.pumped, undefined);

    craft._unqueueCraftGroup.call(ctx, 1, 5);
    assert.deepEqual(ctx._craftQueue.map((j) => j.recipe.id), ["cord", "cord", "cord"]);
    assert.deepEqual(refunded, ["cord", "spear"]);
    assert.ok(ctx.player._craftChannel);

    craft._unqueueCraftGroup.call(ctx, 0, 99);
    assert.equal(ctx._craftQueue.length, 0);
    assert.equal(ctx.player._craftChannel, null);
    assert.equal(ctx._craftQueueLive, false);
    assert.equal(ctx.pumped, true);
    assert.deepEqual(refunded, ["cord", "spear", "cord", "cord", "cord"]);
});

test("a queue click refunds that stack on the server, not the oldest hold", () => {
    const sent = [];
    const ctx = {
        _craftQueue: [
            { recipe: { id: "cord" }, taken: true },
            { recipe: { id: "spear" }, taken: true },
            { recipe: { id: "spear" }, taken: true }
        ],
        _craftQueueLive: true,
        player: { _craftChannel: { fromQueue: true } },
        simAuth() { return true; },
        _sendCraftAction(action) { sent.push(action); },
        _pumpCraftQueue() {},
        _layoutCraftQueue() {},
        refreshCraftMenu() {},
        refreshTooltip() {},
        hotbar: {}
    };
    ctx._craftQueueSame = craft._craftQueueSame;
    ctx._craftQueueGroups = craft._craftQueueGroups;
    craft._unqueueCraftGroup.call(ctx, 1, 2);
    assert.equal(ctx._craftQueue.map((j) => j.recipe.id).join(","), "cord");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].op, "refund");
    assert.equal(sent[0].index, 1);
    assert.equal(sent[0].count, 2);
    assert.ok(ctx.player._craftChannel);
});

test("a click during a reserve hides the craft and returns it when the server accepts", () => {
    const sent = [];
    const ctx = {
        _craftQueue: [
            { recipe: { id: "cord" }, taken: true },
            { recipe: { id: "cord" }, taken: false },
            { recipe: { id: "cord" }, taken: false }
        ],
        _craftReserveAsks: [2],
        simAuth() { return true; },
        _sendCraftAction(action) { sent.push(action); },
        _pumpCraftQueue() {},
        _layoutCraftQueue() {},
        refreshCraftMenu() {},
        refreshTooltip() {}
    };
    ctx._craftQueueSame = craft._craftQueueSame;
    ctx._craftQueueGroups = craft._craftQueueGroups;
    craft._unqueueCraftGroup.call(ctx, 0, 1);
    assert.equal(ctx._craftQueue[2].void, true);
    assert.equal(craft._craftQueueGroups.call(ctx)[0].count, 2);
    assert.deepEqual(sent, []);

    craft._onCraftReserve.call(ctx, 2);
    assert.equal(ctx._craftQueue.length, 2);
    assert.equal(ctx._craftQueue[0].taken, true);
    assert.equal(ctx._craftQueue[1].taken, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].op, "refund");
    assert.equal(sent[0].index, 2);
    assert.equal(sent[0].count, 1);
});

test("a queued grindstone keeps the stone it was paid with", () => {
    sandbox.ensureStoneTexture = (_scene, kind, _variant, stone) => `${kind}_${stone}`;
    const ctx = {
        textures: { exists: () => true },
        _craftPreviewStack() {
            return { id: "grindstone", stone: "andesite" };
        }
    };
    assert.equal(
        craft._craftRecipeIconKey.call(ctx, { id: "grindstone" }),
        "grindstone_andesite"
    );
    assert.equal(
        craft._craftRecipeIconKey.call(ctx, { id: "grindstone" }, { id: "grindstone", stone: "granite" }),
        "grindstone_granite"
    );
    const groups = craft._craftQueueGroups.call({
        _craftQueueSame: craft._craftQueueSame,
        _craftFaceKey: craft._craftFaceKey
    }, [
        { recipe: { id: "grindstone" }, paid: { pebbleStone: "granite" } },
        { recipe: { id: "grindstone" }, paid: { pebbleStone: "granite" } },
        { recipe: { id: "grindstone" }, paid: { pebbleStone: "diorite" } }
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].face.pebbleStone, "granite");
    assert.equal(groups[1].count, 1);
    assert.equal(groups[1].face.pebbleStone, "diorite");
    assert.equal(craft._craftQueueStack(groups[0].recipe, groups[0].face).stone, "granite");
    assert.equal(craft._craftQueueStack(groups[1].recipe, groups[1].face).stone, "diorite");
    const spear = craft._craftQueueStack({ id: "stone_spear" }, {
        tipMaterial: "pebble",
        tipStone: "diorite",
        tipQuality: "rough"
    });
    assert.equal(spear.knapMaterial, "pebble");
    assert.equal(spear.stone, "diorite");
    assert.equal(spear.knapQuality, "rough");
});

test("queue tooltip names the paid stone, not the pebble still in the bag", () => {
    sandbox.crispUiText = (text) => text;
    sandbox.pixelUiFontSize = (n) => n;
    sandbox.PIXEL_UI_FONT = "font";
    const seen = [];
    const view = craft._makeCraftQueueView.call({
        add: {
            image: () => uiObj(),
            text: () => uiObj()
        },
        getItem: (id) => ({ id, name: "Grindstone" }),
        formatItemTooltip(_item, _qty, _spoil, stack) {
            seen.push(stack);
            return "tip";
        },
        showTooltip(fn) { fn(); },
        hideTooltip() {},
        _craftPreviewStack() {
            return { id: "grindstone", stone: "andesite" };
        }
    }, { add() {} });
    view.recipe = { id: "grindstone", quantity: 1 };
    view.stack = { id: "grindstone", stone: "granite" };
    view.slot.visible = true;
    view.slot.emit("pointerover", { x: 0, y: 0 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].stone, "granite");
});

test("a second stone needs its own queue box", () => {
    const waiting = [
        { pebbleStone: "granite", refund: [] },
        { pebbleStone: "diorite", refund: [] }
    ];
    let pays = 0;
    const ctx = {
        _craftQueue: [],
        _craftMenuData: { slotW: 64, slotH: 64, pad: 4, gridW: 200, gridH: 36 },
        craftContainer: { y: 0 },
        _craftQueueAfford() { return 99; },
        _pumpCraftQueue() {},
        _layoutCraftQueue() {},
        _craftPayPreview() {
            return { pebbleStone: waiting[0]?.pebbleStone || null };
        },
        _payCraftLocal() {
            pays += 1;
            return waiting.shift() || null;
        }
    };
    ctx._craftQueueGeom = craft._craftQueueGeom;
    ctx._craftQueueLimit = craft._craftQueueLimit;
    ctx._craftQueueSame = craft._craftQueueSame;
    ctx._craftQueueGroups = craft._craftQueueGroups;
    ctx._craftQueueRoom = craft._craftQueueRoom;
    ctx._craftFaceKey = craft._craftFaceKey;
    ctx._craftQueueJobFits = craft._craftQueueJobFits;
    assert.equal(craft._enqueueCrafts.call(ctx, { id: "grindstone" }, 2), 1);
    assert.equal(pays, 1);
    assert.equal(ctx._craftQueue.length, 1);
    assert.equal(ctx._craftQueue[0].paid.pebbleStone, "granite");
    assert.equal(waiting[0].pebbleStone, "diorite");
});

test("two grindstones of one stone still share a box", () => {
    const waiting = [
        { pebbleStone: "granite", refund: [] },
        { pebbleStone: "granite", refund: [] }
    ];
    const ctx = {
        _craftQueue: [],
        _craftMenuData: { slotW: 64, slotH: 64, pad: 4, gridW: 200, gridH: 36 },
        craftContainer: { y: 0 },
        _craftQueueAfford() { return 99; },
        _pumpCraftQueue() {},
        _layoutCraftQueue() {},
        _craftPayPreview() {
            return { pebbleStone: waiting[0]?.pebbleStone || null };
        },
        _payCraftLocal() { return waiting.shift() || null; }
    };
    ctx._craftQueueGeom = craft._craftQueueGeom;
    ctx._craftQueueLimit = craft._craftQueueLimit;
    ctx._craftQueueSame = craft._craftQueueSame;
    ctx._craftQueueGroups = craft._craftQueueGroups;
    ctx._craftQueueRoom = craft._craftQueueRoom;
    ctx._craftFaceKey = craft._craftFaceKey;
    ctx._craftQueueJobFits = craft._craftQueueJobFits;
    assert.equal(craft._enqueueCrafts.call(ctx, { id: "grindstone" }, 2), 2);
    assert.equal(ctx._craftQueue.length, 2);
    const groups = craft._craftQueueGroups.call(ctx);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].face.pebbleStone, "granite");
});

test("a reserved grindstone remembers each stone before the pebbles are spent", () => {
    const Stone = require("../shared/stone");
    sandbox.Stone = Stone;
    const recipe = { id: "grindstone", ingredients: [{ id: "pebble", qty: 3 }] };
    const ctx = {
        _craftFaceFromStack: craft._craftFaceFromStack,
        _craftStuffBags() {
            return [[
                { id: "pebble", quantity: 3, stone: "granite" },
                { id: "pebble", quantity: 3, stone: "diorite" }
            ], [], []];
        },
        _craftPendingRecipes() { return []; }
    };
    const faces = craft._forecastCraftFaces.call(ctx, recipe, 2);
    assert.equal(faces.length, 2);
    assert.equal(faces[0].pebbleStone, "granite");
    assert.equal(faces[1].pebbleStone, "diorite");
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
