const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Hunger = require("../shared/hunger");
const Carry = require("../shared/carry");
const Sleep = require("../shared/sleep");
const Skills = require("../shared/skills");
const DataStore = require("../shared/DataStore");

if (!DataStore.isReady()) DataStore.loadFromDisk(path.resolve(__dirname, ".."));

test("idle drain is hunger over a day", () => {
    assert.equal(Hunger.idlePerMinute(2000), 2000 / (24 * 60));
    assert.equal(Hunger.idlePerMinute(0), Hunger.idlePerMinute(2000));
});

test("sprint, rest, encumbrance, and capacity multiply", () => {
    const idle = Hunger.minuteDrain({ hunger: 2000 });
    const sprint = Hunger.minuteDrain({ hunger: 2000, sprinting: true });
    assert.equal(sprint, idle * Hunger.SPRINT_MULT);
    const rest = Hunger.minuteDrain({ hunger: 2000, resting: true });
    assert.equal(rest, idle * Sleep.hungerMult(true));
    const enc = Carry.encumbrance(22.5, 15);
    const overloaded = Hunger.minuteDrain({
        hunger: 2000,
        encumbranceHungerRate: enc.hungerRate
    });
    assert.ok(Math.abs(overloaded - idle * 1.25) < 1e-9);
    const cap = Hunger.minuteDrain({ hunger: 2000, hungerRateFactor: 2 });
    assert.equal(cap, idle * 2);
});

test("a foodie burns a quarter more idle calories", () => {
    const factor = Skills.calorieFactor({ bio: { traits: ["foodie"] } });
    assert.equal(factor, 1.25);
    const idle = Hunger.minuteDrain({ hunger: 2000 });
    assert.equal(Hunger.minuteDrain({ hunger: 2000, hungerRateFactor: factor }), idle * 1.25);
});

test("applyStarve drains saturation then kc", () => {
    const p = { kc: 10, saturation: 3 };
    Hunger.applyStarve(p, 5);
    assert.equal(p.saturation, 0);
    assert.equal(p.kc, 8);
});
