const { test } = require("node:test");
const assert = require("node:assert/strict");
const Mask = require("../shared/spriteMask");
const Melee = require("../shared/melee");
const Place = require("../shared/place");

test("the steered pawn's walk solid is a short strip on the feet", () => {
    const feet = Place.walkBodyAt(40, 48, 16, 16, 8);
    assert.equal(feet.bottom - feet.top, 4);
    assert.equal(feet.right - feet.left, 8);
    assert.equal(feet.bottom, 48);
    assert.equal(feet.left, 44);
});

test("damage hits opaque body pixels and misses the empty frame", () => {
    const human = {
        kind: "player",
        x: 100,
        y: 200,
        width: 16,
        height: 16,
        facing: "left"
    };
    const pose = Mask.poseOf(human);
    let solid = null;
    let empty = null;
    for (let y = 0; y < 16 && (!solid || !empty); y++) {
        for (let x = 0; x < 16; x++) {
            const on = Mask.opaque(pose.rows, x, y);
            if (on && !solid) solid = { x, y };
            if (!on && x <= 2 && y >= 4 && y <= 12 && !empty) empty = { x, y };
        }
    }
    assert.ok(solid && empty);
    const at = (px, py) => ({
        x: human.x + px + 0.5,
        y: human.y - 16 + py + 0.5
    });
    const s = at(solid.x, solid.y);
    const e = at(empty.x, empty.y);
    assert.equal(Melee.meleeSegmentHitsTarget(s, s, 0, human), true);
    assert.equal(Melee.meleeSegmentHitsTarget(e, e, 0, human), false);

    const box = Mask.bounds(human);
    assert.ok(box.right - box.left < 14, "side view is narrower than the frame");
    assert.ok(box.bottom - box.top < 16, "empty rows above the head are not body");
});

test("a downed body lies on its side", () => {
    const down = {
        kind: "player",
        x: 80,
        y: 80,
        width: 16,
        height: 16,
        facing: "down",
        _prone: true
    };
    const lying = Mask.bounds(down);
    const wide = lying.right - lying.left;
    const tall = lying.bottom - lying.top;
    assert.ok(wide > tall + 4, `lying body should be horizontal (${wide}×${tall})`);
    const standing = Mask.bounds({ ...down, _prone: false, facing: "left" });
    assert.ok(standing.bottom - standing.top > standing.right - standing.left);
});
