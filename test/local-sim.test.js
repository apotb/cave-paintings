const { test } = require("node:test");
const assert = require("node:assert/strict");
const Protocol = require("../shared/protocol");
const Hunger = require("../shared/hunger");
const LocalSim = require("../js/net/LocalSim");
const { loadDefs } = require("./helpers/load");

loadDefs();

function makeSim(pawnExtra = {}) {
    const sim = new LocalSim({
        world: {
            clock: { gameDay: 1, gameMinutes: 8 * 60, tickSpeed: 1 },
            chunks: {}
        },
        character: { id: "p1", name: "Tester" }
    });
    sim.connected = true;
    sim._pawn = {
        id: "p1",
        name: "Tester",
        x: 32,
        y: 32,
        facing: "down",
        inventory: [{ id: "stick", quantity: 2 }, null, null, null, null],
        overflow: [],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
        hotbarIndex: 0,
        kc: 1200,
        saturation: 10,
        hunger: 2000,
        sprint: false,
        dead: false,
        hp: 100,
        mhp: 100,
        ...pawnExtra
    };
    return sim;
}

test("ClientAuthoredActions are no-ops on LocalSim", () => {
    const sim = makeSim();
    const before = JSON.stringify(sim._pawn.inventory);
    for (const type of Protocol.ClientAuthoredActions) {
        sim.sendAction({ type, dropId: "x", amount: 1 });
    }
    assert.equal(JSON.stringify(sim._pawn.inventory), before);
    assert.equal(sim._pawn.dead, false);
});

test("HOTBAR updates index", () => {
    const sim = makeSim();
    sim.sendAction({ type: Protocol.Actions.HOTBAR, index: 2 });
    assert.equal(sim._pawn.hotbarIndex, 2);
});

test("DIE clears gear; RESPAWN revives", () => {
    const sim = makeSim();
    sim.sendAction({ type: Protocol.Actions.DIE });
    assert.equal(sim._pawn.dead, true);
    assert.ok(sim._pawn.inventory.every((s) => !s));
    sim.sendAction({ type: Protocol.Actions.RESPAWN });
    assert.equal(sim._pawn.dead, false);
    assert.equal(sim._pawn.hp, sim._pawn.mhp);
});

test("_tick hunger uses the shared drain helper", () => {
    const sim = makeSim({ saturation: 50, kc: 1200, sprint: false });
    const before = sim._pawn.saturation;
    const expect = Hunger.minuteDrain({
        hunger: 2000,
        sprinting: false,
        encumbranceHungerRate: 1,
        hungerRateFactor: 1,
        resting: false
    });
    sim._minuteAcc = 1000;
    sim._lastTick = performance.now();
    sim._tick();
    assert.ok(Math.abs((before - sim._pawn.saturation) - expect) < 1e-6);
});
