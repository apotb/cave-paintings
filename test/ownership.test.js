const { test } = require("node:test");
const assert = require("node:assert/strict");
const Protocol = require("../shared/protocol");
const Hunger = require("../shared/hunger");
const Carry = require("../shared/carry");

test("ClientAuthoredActions matches the SP/MP ownership split", () => {
    const expected = [
        Protocol.Actions.PICKUP,
        Protocol.Actions.DROP,
        Protocol.Actions.SPAWN_DROP,
        Protocol.Actions.PLACE,
        Protocol.Actions.STORAGE,
        Protocol.Actions.SLEEP
    ];
    assert.deepEqual([...Protocol.ClientAuthoredActions], expected);
    for (const t of expected) {
        assert.equal(typeof t, "string");
        assert.ok(Object.values(Protocol.Actions).includes(t));
    }
});

test("dedicated-MP verbs still exist on Protocol.Actions", () => {
    for (const key of [
        "HARVEST", "CRAFT", "ATTACK", "TEND", "EQUIP", "CORPSE_TAKE",
        "CORPSE_SKIN", "PICKUP", "DROP", "PLACE", "CAMPFIRE"
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
