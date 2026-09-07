const { test } = require("node:test");
const assert = require("node:assert/strict");
const Carry = require("../shared/carry");
const { loadDefs, DataStore } = require("./helpers/load");

loadDefs();

test("carryCap is strength times 2", () => {
    assert.equal(Carry.carryCap(15), 30);
    assert.equal(Carry.carryCap(0), 0);
});

test("settler pickupCap stops at strength so they stay unencumbered", () => {
    assert.equal(Carry.pickupCap(15, "settler"), 15);
    assert.equal(Carry.pickupCap(15, "leader"), 30);
    assert.equal(Carry.pickupCap(15, "companion"), 30);
    assert.equal(Carry.countFit(10, 2, 14, Carry.pickupCap(15, "settler")), 0);
    assert.equal(Carry.countFit(10, 2, 14, Carry.pickupCap(15, "leader")), 8);
    assert.equal(Carry.countFit(1, 0.3, 14.7, Carry.pickupCap(15, "settler")), 1);
});

test("countFit weightless vs over cap", () => {
    assert.equal(Carry.countFit(9, 0, 0, 10), 9);
    assert.equal(Carry.countFit(9, 5, 28, 30), 0);
    assert.equal(Carry.countFit(9, 1, 28, 30), 2);
});

test("knapped stack uses def.weight", () => {
    const def = { weight: 1.5 };
    const knap = { id: "blank", toolClass: "chopper", weight: 99 };
    assert.equal(Carry.unitWeight(knap, def), 1.5);
});

test("encumbrance matches Player formula", () => {
    const none = Carry.encumbrance(10, 15);
    assert.equal(none.hungerRate, 1);
    assert.equal(none.cannotSprint, false);
    const mid = Carry.encumbrance(22.5, 15);
    assert.ok(Math.abs(mid.hungerRate - 1.25) < 1e-9);
    assert.equal(mid.cannotSprint, true);
    const max = Carry.encumbrance(40, 15);
    assert.ok(Math.abs(max.hungerRate - 1.5) < 1e-9);
});

test("humanMoveSpeed refuses sprint when encumbered", () => {
    const getDef = (id) => DataStore.getItem(id);
    const light = {
        inventory: [],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
        overflow: [],
        kc: 800,
        anatomy: { livingLegs: () => 2 },
        capacities: { moving: () => 1 }
    };
    const heavy = {
        ...light,
        inventory: [{ id: "log", quantity: 12 }]
    };
    const walk = Carry.humanMoveSpeed(light, { getDef, wantSprint: false, tileSize: 16 });
    const sprint = Carry.humanMoveSpeed(light, { getDef, wantSprint: true, tileSize: 16 });
    const laden = Carry.humanMoveSpeed(heavy, { getDef, wantSprint: true, tileSize: 16 });
    assert.equal(walk.sprinting, false);
    assert.equal(sprint.sprinting, true);
    assert.ok(sprint.speed > walk.speed);
    assert.equal(laden.canSprint, false);
    assert.equal(laden.sprinting, false);
    assert.ok(laden.speed < walk.speed);
    assert.equal(laden.speed, walk.speed * laden.encumbrance.speedMultiplier);
});

test("humanMoveSpeed halves walk when eating even if _tending is false", () => {
    const pawn = {
        inventory: [],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
        overflow: [],
        kc: 800,
        anatomy: { livingLegs: () => 2 },
        capacities: { moving: () => 1 },
        _tending: false,
        _eatChannel: { remaining: 1000, max: 1000 }
    };
    const idle = Carry.humanMoveSpeed(pawn, { wantSprint: true, tileSize: 16 });
    pawn._eatChannel = null;
    const free = Carry.humanMoveSpeed(pawn, { wantSprint: true, tileSize: 16 });
    assert.equal(idle.sprinting, false);
    assert.equal(free.sprinting, true);
    assert.ok(idle.speed < free.speed * 0.6);
});

test("resolveCraftedWeights hide-stage averaging", () => {
    const cord = DataStore.getItem("leaf_cord");
    assert.ok(cord);
    assert.ok(Math.abs(cord.weight - 0.05) < 1e-9);
});

test("resolveCraftedFuel derives kj and max temp from ingredients", () => {
    const cord = DataStore.getItem("leaf_cord");
    assert.equal(cord.fuel.kj, 5);
    assert.equal(cord.fuel.temp, 400);
    const frame = DataStore.getItem("stick_frame");
    assert.ok(frame.fuel.kj > 0);
    assert.equal(frame.fuel.temp, 600);
    const log = DataStore.getItem("log");
    assert.equal(log.fuel.temp, 800);
});
