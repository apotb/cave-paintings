const { test } = require("node:test");
const assert = require("node:assert/strict");
const Protocol = require("../shared/protocol");
const Hunger = require("../shared/hunger");
const Carry = require("../shared/carry");

test("no client-authored action list — SimWorld owns all play verbs", () => {
    assert.equal(Protocol.ClientAuthoredActions, undefined);
    for (const key of [
        "PICKUP", "DROP", "SPAWN_DROP", "PLACE", "STORAGE", "SLEEP",
        "HARVEST", "CRAFT", "ATTACK", "TEND", "EQUIP", "CORPSE_TAKE",
        "CORPSE_SKIN", "CAMPFIRE"
    ]) {
        assert.ok(Protocol.Actions[key], key);
    }
});

test("hunger helper is the single drain implementation", () => {
    assert.equal(typeof Hunger.minuteDrain, "function");
    assert.equal(typeof Carry.encumbrance, "function");
    const idle = Hunger.minuteDrain({ hunger: 2000 });
    const sprintEnc = Hunger.minuteDrain({
        hunger: 2000,
        sprinting: true,
        encumbranceHungerRate: Carry.encumbrance(30, 15).hungerRate
    });
    assert.ok(sprintEnc > idle);
});
