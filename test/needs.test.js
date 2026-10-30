const { test } = require("node:test");
const assert = require("node:assert/strict");
const Needs = require("../shared/needs");

function pawnAt(rest) {
    return { needs: { rest, recreation: 1, beauty: 1, comfort: 1 } };
}

function minutesUntil(start, done, opts) {
    const pawn = pawnAt(start);
    let n = 0;
    while (n < 8000 && !done(pawn.needs.rest)) {
        Needs.tickRest(pawn, opts);
        n++;
    }
    return n;
}

test("awake rest crosses into drowsy after about 18.2 hours", () => {
    const minutes = minutesUntil(1, (r) => r < 0.28, { asleep: false, sleepFallRate: 1 });
    const hours = minutes / 60;
    assert.ok(hours > 18.15 && hours < 18.25, `got ${hours}h (${minutes} min)`);
});

test("a normal hut refills empty rest in 10.5 hours", () => {
    const minutes = minutesUntil(0, (r) => r >= 1, {
        asleep: true,
        effectiveness: 1,
        restRateMultiplier: 1
    });
    assert.equal(minutes, 10.5 * 60);
});

test("lean-to and ground refill slower than a hut", () => {
    const hut = 10.5 * 60;
    const lean = minutesUntil(0, (r) => r >= 1, {
        asleep: true,
        effectiveness: Needs.effectivenessFor({ sleep: { restEffectiveness: 0.95 } }, false),
        restRateMultiplier: 1
    });
    const ground = minutesUntil(0, (r) => r >= 1, {
        asleep: true,
        effectiveness: Needs.effectivenessFor(null, true),
        restRateMultiplier: 1
    });
    assert.ok(lean > hut && lean < hut / 0.95 + 1);
    assert.ok(ground > lean);
    assert.equal(Needs.GROUND_EFFECTIVENESS, 0.8);
    assert.ok(Math.abs(ground - hut / 0.8) <= 1);
});

test("blood pumping raises the rest rate by 30% of the surplus", () => {
    assert.equal(Needs.restRateMultiplier({ bloodPumping: 1, digestion: 1, breathing: 1 }), 1);
    assert.ok(Math.abs(Needs.restRateMultiplier({
        bloodPumping: 1.25,
        digestion: 1,
        breathing: 1
    }) - 1.075) < 1e-9);
    assert.equal(Needs.restRateMultiplier(null), 1);
});

test("immunity follows the rest bands", () => {
    assert.equal(Needs.immunityFactor(1), 1);
    assert.equal(Needs.immunityFactor(0.28), 1);
    assert.equal(Needs.immunityFactor(0.279), 0.96);
    assert.equal(Needs.immunityFactor(0.14), 0.96);
    assert.equal(Needs.immunityFactor(0.011), 0.92);
    assert.equal(Needs.immunityFactor(0.01), 0.8);
    assert.equal(Needs.immunityFactor(0), 0.8);
});

test("hitting empty collapses once, and sitting there does not collapse again", () => {
    const pawn = pawnAt(0.0002);
    const first = Needs.tickRest(pawn, { asleep: false, sleepFallRate: 1 });
    assert.equal(first.hitZero, true);
    assert.equal(pawn.needs.rest, 0);
    const second = Needs.tickRest(pawn, { asleep: false, sleepFallRate: 1 });
    assert.equal(second.hitZero, false);
    assert.equal(pawn.needs.rest, 0);
});

test("only a controlled pawn or damage can leave the ground early", () => {
    assert.equal(Needs.canWakeFromGround({ controlled: false, damage: false }), false);
    assert.equal(Needs.canWakeFromGround({ controlled: true, damage: false }), true);
    assert.equal(Needs.canWakeFromGround({ controlled: false, damage: true }), true);
});

test("recreation, beauty, and comfort stay full while rest moves", () => {
    const pawn = pawnAt(0.5);
    Needs.tickRest(pawn, { asleep: false, sleepFallRate: 1 });
    assert.ok(pawn.needs.rest < 0.5);
    assert.equal(pawn.needs.recreation, 1);
    assert.equal(pawn.needs.beauty, 1);
    assert.equal(pawn.needs.comfort, 1);
});

test("old saves without needs start full", () => {
    const pawn = {};
    Needs.ensure(pawn);
    assert.deepEqual(pawn.needs, Needs.fresh());
});

test("hut and lean-to name their rest effectiveness", () => {
    assert.equal(
        Needs.effectivenessLine({ sleep: { restEffectiveness: 1 } }),
        "Rest effectiveness: 100%"
    );
    assert.equal(
        Needs.effectivenessLine({ sleep: { restEffectiveness: 0.95 } }),
        "Rest effectiveness: 95%"
    );
    assert.equal(Needs.effectivenessLine({ id: "grindstone" }), "");
    assert.equal(Needs.effectivenessLine({ sleep: {} }), "Rest effectiveness: 100%");
});

test("rest tooltip names the band", () => {
    const text = Needs.tooltip({ rest: 0.72, recreation: 1, beauty: 1, comfort: 1 }, "rest");
    assert.match(text, /^Rest: 72% \(Rested\)/);
    const later = Needs.tooltip({ rest: 1, recreation: 1, beauty: 1, comfort: 1 }, "beauty");
    assert.match(later, /^Beauty: 100%/);
    assert.match(later, /Art, nature, and clean floors will raise beauty/);
});

test("leaving and rejoining keeps the leader's rest", () => {
    const { loadDefs } = require("./helpers/load");
    loadDefs();
    const { SimWorld } = require("../shared/sim/SimWorld");
    const world = SimWorld.createNew({ worldName: "needs-rejoin", seed: 1 });
    const needs = { rest: 0.37, recreation: 1, beauty: 1, comfort: 1 };
    const id = "needsrejoin0001";
    const first = world.addPlayer(id, "Needs", { needs }, { silentJoin: true });
    assert.equal(first.needs.rest, 0.37);
    world.removePlayer(id);
    const again = world.addPlayer(id, "Needs", null, { silentJoin: true });
    assert.equal(again.needs.rest, 0.37);
});
