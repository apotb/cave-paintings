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
