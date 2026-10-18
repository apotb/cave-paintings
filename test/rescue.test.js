const { test } = require("node:test");
const assert = require("node:assert/strict");
const Sleep = require("../shared/sleep");
const Settlement = require("../shared/settlement");
const BodyCombat = require("../shared/body/Combat");
const { PartyAI } = require("../shared/ai/headless");
const { createTestWorld, originChunk } = require("./helpers/simWorld");
const { loadDefs } = require("./helpers/load");

loadDefs();

function slot(id, x, y, extra = {}) {
    return {
        entry: { uid: id, id, x, y, medical: !!extra.medical, occupants: [] },
        slot: extra.slot || 0,
        x,
        y,
        heal: extra.heal
    };
}

test("medical bed ranking prefers the mark, then heal, then distance", () => {
    const origin = { x: 0, y: 0 };
    const nearLean = slot("lean", 16, 0, { heal: 8 });
    const farHut = slot("hut", 200, 0, { heal: 12 });
    const markedLean = slot("med", 400, 0, { heal: 8, medical: true });
    const injured = Sleep.pickSleepSlot([nearLean, farHut, markedLean], origin, true);
    assert.equal(injured.entry.uid, "med");
    const unmarked = Sleep.pickSleepSlot([nearLean, farHut], origin, true);
    assert.equal(unmarked.entry.uid, "hut");
    const healthy = Sleep.pickSleepSlot([nearLean, farHut, markedLean], origin, false);
    assert.equal(healthy.entry.uid, "hut");
    const onlyMarked = Sleep.pickSleepSlot([markedLean], origin, false);
    assert.equal(onlyMarked, null);
});

test("planWork carries a bleeding patient before eating or sleeping", () => {
    const pawn = { id: "hurt" };
    const jobs = Settlement.defaultJobs();
    const bleeding = Settlement.planWork({
        kc: 200,
        isNight: true,
        bed: { slot: 0 },
        jobs,
        critical: [{ pawn, downed: true, inBed: false, hasBed: true, canTend: true, mins: 2 }]
    });
    assert.equal(bleeding.type, "rescue");
    assert.equal(bleeding.target, pawn);
    const eaten = Settlement.planWork({
        kc: 200,
        jobs,
        rescues: [pawn]
    });
    assert.equal(eaten.type, "eat");
    const haul = Settlement.planWork({
        kc: 2000,
        isNight: true,
        bed: { slot: 0 },
        jobs,
        rescues: [pawn]
    });
    assert.equal(haul.type, "rescue");
});

test("a downed settler is put in the better bed and a walking one is not carried", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const lean = {
        uid: "lean",
        id: "lean_to",
        x: pawn.x + 16,
        y: pawn.y,
        occupants: [null, null]
    };
    const hut = {
        uid: "hut",
        id: "hut",
        x: pawn.x + 80,
        y: pawn.y,
        occupants: [null, null, null, null]
    };
    chunk.things.push(lean, hut);
    const patient = {
        id: "down",
        name: "Down",
        x: pawn.x + 8,
        y: pawn.y,
        dead: false,
        prone: true,
        ownerId: pawn.id,
        party: []
    };
    pawn.party.push(patient);
    world._ensureCompanionCreature(pawn, patient);
    patient.creature = world.creatures.get(patient.id);
    if (patient.creature) {
        patient.creature.isIncapacitated = () => true;
        patient.creature.isImmobile = () => true;
        patient.creature._prone = true;
    }
    const bed = world._pickFreeSleepSlot(patient, null, { medical: true });
    assert.equal(bed.entry.uid, "hut");
    assert.equal(world._beginCarry(pawn, patient, bed), true);
    pawn.x = bed.entry.x;
    pawn.y = bed.entry.y;
    assert.equal(world._finishCarry(pawn), true);
    assert.equal(hut.occupants.includes(patient.id), true);
    assert.equal(patient._resting, true);
    assert.equal(pawn._carryPawnId, null);
    const walker = {
        id: "walk",
        x: pawn.x,
        y: pawn.y,
        dead: false,
        prone: false
    };
    assert.equal(world._pawnIsDowned(walker), false);
    assert.equal(world._pawnIsDowned(patient), true);
});

test("marking a hut medical wakes a healthy sleeper and leaves a manual rest", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const hut = {
        uid: "hut",
        id: "hut",
        x: pawn.x,
        y: pawn.y,
        medical: false,
        occupants: [pawn.id, null, null, null]
    };
    chunk.things.push(hut);
    pawn._resting = true;
    pawn.resting = true;
    pawn.lastSleep = { uid: "hut", slot: 0, rot: 0 };
    pawn._manualRest = false;
    world._evictHealthyFromMedical(hut);
    // flag is still false, evict checks the entry flag via lastSleep lookup
    hut.medical = true;
    world._evictOneHealthyMedical(pawn);
    assert.equal(pawn._resting, false);
    pawn._resting = true;
    pawn.resting = true;
    pawn._manualRest = true;
    pawn.lastSleep = { uid: "hut", slot: 0, rot: 0 };
    hut.occupants[0] = pawn.id;
    world._evictOneHealthyMedical(pawn);
    assert.equal(pawn._resting, true);
});

function parkDoctor(world, pawn, opts = {}) {
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    const rec = world._settlerFromSnap({
        id: opts.id || "doc",
        name: "Doc",
        x: opts.x ?? pawn.x,
        y: opts.y ?? pawn.y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        kc: opts.kc ?? 1600,
        inventory: opts.inventory || [{ id: "leaf_cord", quantity: 2 }, null, null, null, null]
    });
    settle.jobs = {};
    settle.jobs[rec.id] = Settlement.defaultJobs();
    world.settlements.push(settle);
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    return { settle, rec };
}

function addPatient(world, settle, opts = {}) {
    const patient = world._settlerFromSnap({
        id: opts.id || "pat",
        name: opts.name || "Ugg",
        x: opts.x,
        y: opts.y,
        ownerId: settle.ownerId,
        homeSettlementId: settle.id,
        kc: 1600,
        inventory: [null, null, null, null, null]
    });
    settle.jobs[patient.id] = { doctor: 0, cook: 0, chop: 0, leather: 0, gather: 0, haul: 0 };
    world.settlers.push(patient);
    const creature = world._ensureSettlerCreature(patient);
    if (opts.downed) {
        patient.prone = true;
        creature._prone = true;
    }
    if (opts.bleed) {
        const part = creature.anatomy.part("Left Arm") || creature.anatomy.core;
        part.injure({
            id: "cut",
            severity: 8,
            bleeding: true,
            bleedRate: opts.bleed,
            tended: false
        });
        if (opts.bloodLoss) creature.anatomy.bloodLoss = opts.bloodLoss;
    }
    return patient;
}

function addHut(world, x, y, uid = "hut") {
    const chunk = originChunk(world);
    const hut = {
        uid,
        id: "hut",
        x,
        y,
        occupants: [null, null, null, null]
    };
    chunk.things.push(hut);
    return hut;
}

function workOnce(world, rec) {
    const mob = world._ensureSettlerCreature(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = 280;
    return world._tickSettlerWork(mob, 300);
}

test("a doctor carries the closer-to-death patient before eating, then bandages", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec: doctor } = parkDoctor(world, pawn, { kc: 200 });
    const worse = addPatient(world, settle, {
        id: "worse",
        x: doctor.x + 64,
        y: doctor.y,
        downed: true,
        bleed: 0.2,
        bloodLoss: 0.5
    });
    addPatient(world, settle, {
        id: "slower",
        x: doctor.x + 16,
        y: doctor.y,
        downed: true,
        bleed: 0.02
    });
    const hut = addHut(world, doctor.x + 48, doctor.y + 48);
    workOnce(world, doctor);
    assert.equal(doctor._busyJob?.type, "rescue");
    assert.equal(doctor._busyJob?.target?.id, "worse");
    assert.equal(doctor.eatChannel || null, null);
    const bed = world._rescueBedFor(worse, { medical: true, settle });
    assert.equal(world._beginCarry(doctor, worse, bed), true);
    const stand = world._carryStand(doctor);
    doctor.x = stand.x;
    doctor.y = stand.y;
    workOnce(world, doctor);
    assert.equal(worse._resting, true);
    assert.equal(hut.occupants.includes(worse.id), true);
    workOnce(world, doctor);
    assert.equal(doctor._busyJob?.type, "doctor");
    assert.equal(doctor._busyJob?.target?.id, "worse");
});

test("a hungry doctor eats before hauling someone downed who is not bleeding", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec: doctor } = parkDoctor(world, pawn, {
        kc: 200,
        inventory: [
            { id: "leaf_cord", quantity: 1 },
            { id: "apple", quantity: 1 },
            null, null, null
        ]
    });
    addPatient(world, settle, {
        id: "asleep",
        x: doctor.x + 16,
        y: doctor.y,
        downed: true
    });
    addHut(world, doctor.x + 40, doctor.y);
    workOnce(world, doctor);
    assert.notEqual(doctor._busyJob?.type, "rescue");
    assert.ok(doctor.eatChannel || /Eat/.test(doctor._settlerAct || ""));
});

test("a second doctor does not take a claimed patient, and a walker is not carried", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec: first } = parkDoctor(world, pawn, { id: "doc1" });
    const second = world._settlerFromSnap({
        id: "doc2",
        name: "Doc2",
        x: first.x + 8,
        y: first.y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        kc: 1600,
        inventory: [{ id: "leaf_cord", quantity: 1 }, null, null, null, null]
    });
    settle.jobs[second.id] = Settlement.defaultJobs();
    world.settlers.push(second);
    world._ensureSettlerCreature(second);
    const downed = addPatient(world, settle, {
        id: "down",
        x: first.x + 20,
        y: first.y,
        downed: true,
        bleed: 0.06
    });
    const walker = addPatient(world, settle, {
        id: "walk",
        x: first.x + 24,
        y: first.y,
        bleed: 0.06
    });
    addHut(world, first.x + 48, first.y);
    workOnce(world, first);
    workOnce(world, second);
    assert.equal(first._busyJob?.type, "rescue");
    assert.equal(first._busyJob?.target, downed);
    assert.notEqual(second._busyJob?.target, downed);
    assert.equal(first._carryPawnId === walker.id, false);
    const noBed = createTestWorld();
    const parked = parkDoctor(noBed.world, noBed.pawn);
    const stuck = addPatient(noBed.world, parked.settle, {
        id: "stuck",
        x: parked.rec.x,
        y: parked.rec.y,
        downed: true,
        bleed: 0.06
    });
    workOnce(noBed.world, parked.rec);
    assert.equal(parked.rec._busyJob?.type, "doctor");
    assert.equal(parked.rec._busyJob?.target, stuck);
    assert.equal(parked.rec._carryPawnId || null, null);
});

test("party rescue stays inside 12 tiles and skips the controlled pawn", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const mate = {
        id: "mate",
        name: "Mate",
        x: pawn.x + 32,
        y: pawn.y,
        dead: false,
        prone: true,
        ownerId: pawn.id,
        party: []
    };
    const helper = {
        id: "help",
        name: "Help",
        x: pawn.x + 48,
        y: pawn.y,
        dead: false,
        prone: false,
        kc: 1600,
        ownerId: pawn.id,
        party: []
    };
    pawn.party = [mate, helper];
    world._ensureCompanionCreature(pawn, mate);
    world._ensureCompanionCreature(pawn, helper);
    mate.creature = world.creatures.get(mate.id);
    helper.creature = world.creatures.get(helper.id);
    mate.creature._prone = true;
    const near = {
        uid: "near",
        id: "lean_to",
        x: mate.x + 64,
        y: mate.y,
        occupants: [null, null]
    };
    originChunk(world).things.push(near);
    const rows = [
        { rec: helper, creature: helper.creature }
    ];
    world._assignPartyRescues(pawn, rows, pawn.id);
    assert.ok(helper.creature.ai.rescueSeek);
    assert.equal(helper.creature.ai.rescueSeek.pawn, mate);
    assert.equal(pawn.creature?.ai?.rescueSeek || null, null);
    near.x = mate.x + 20 * 16;
    world._assignPartyRescues(pawn, rows, pawn.id);
    assert.equal(helper.creature.ai.rescueSeek, null);
});

test("a party carry drops when anyone is fighting; a doctor does not", () => {
    const { world, pawn } = createTestWorld();
    const helper = {
        id: "help",
        x: pawn.x,
        y: pawn.y,
        dead: false,
        ownerId: pawn.id
    };
    const mate = {
        id: "mate",
        x: pawn.x + 8,
        y: pawn.y,
        dead: false,
        prone: true,
        ownerId: pawn.id
    };
    pawn.party = [helper, mate];
    world._ensureCompanionCreature(pawn, helper);
    world._ensureCompanionCreature(pawn, mate);
    helper.creature = world.creatures.get(helper.id);
    mate.creature = world.creatures.get(mate.id);
    mate.creature._prone = true;
    const lean = {
        uid: "lean",
        id: "lean_to",
        x: pawn.x + 32,
        y: pawn.y,
        occupants: [null, null]
    };
    originChunk(world).things.push(lean);
    const bed = world._rescueBedFor(mate, { medical: true, maxTiles: 12 });
    assert.equal(world._beginCarry(helper, mate, bed), true);
    pawn.attackTimer = 200;
    world._tickCarries();
    assert.equal(helper._carryPawnId, null);
    assert.equal(mate._carriedBy, null);

    const { settle, rec: doctor } = parkDoctor(world, pawn, { id: "doc" });
    const patient = addPatient(world, settle, {
        id: "pat",
        x: doctor.x + 8,
        y: doctor.y,
        downed: true
    });
    const hut = addHut(world, doctor.x + 40, doctor.y, "hut2");
    const docBed = world._rescueBedFor(patient, { medical: true, settle });
    assert.equal(world._beginCarry(doctor, patient, docBed), true);
    world._tickCarries();
    assert.equal(doctor._carryPawnId, patient.id);
    assert.equal(hut.occupants.includes(patient.id), false);
});

test("carrying does not stop either person from being hit", () => {
    const { world, pawn } = createTestWorld();
    const { rec: doctor } = parkDoctor(world, pawn);
    const patient = addPatient(world, world.settlements[0], {
        id: "pat",
        x: doctor.x,
        y: doctor.y,
        downed: true
    });
    const carrier = world._ensureSettlerCreature(doctor);
    const carried = world._ensureSettlerCreature(patient);
    doctor._carryPawnId = patient.id;
    patient._carriedBy = doctor.id;
    carrier._carryPawnId = patient.id;
    carried._carriedBy = doctor.id;
    const boar = world._spawnMobAt("boar", doctor.x + 20, doctor.y);
    const attacker = world.mobs.get(boar.uid);
    attacker.hostile = true;
    const attack = BodyCombat.pickAttack(attacker);
    attack.def = { ...(attack.def || {}), variance: 0 };
    const beforeC = carrier.anatomy.bloodLoss || 0;
    const beforeP = carried.anatomy.bloodLoss || 0;
    const hitC = BodyCombat.applyHit(attacker, carrier, attack);
    const hitP = BodyCombat.applyHit(attacker, carried, attack);
    assert.ok(hitC);
    assert.ok(hitP);
    // A blow that destroys a finger clears that part's injury list, so a
    // missing part counts as being hit the same way a wound or a death does.
    const hurt = (who, before) => Object.values(who.anatomy.parts()).some((part) =>
        (part.injuries || []).length || part.dead
    ) || (who.anatomy.bloodLoss || 0) > before
        || who.isBodyDead?.();
    assert.equal(hurt(carrier, beforeC), true);
    assert.equal(hurt(carried, beforeP), true);
});

test("a walking patient holds still within 4 tiles of a tender", () => {
    const { world, pawn } = createTestWorld();
    const helper = {
        id: "help",
        x: pawn.x + 32,
        y: pawn.y,
        dead: false,
        prone: false,
        ownerId: pawn.id
    };
    pawn.party = [helper];
    const patient = world._ensurePlayerCreature(pawn);
    world._ensureCompanionCreature(pawn, helper);
    const tender = world.creatures.get(helper.id);
    tender.ai = tender.ai || {};
    tender.ai.tendSeek = patient;
    world._refreshTendHolds();
    assert.equal(pawn._tendHold, true);
    const x0 = pawn.x;
    world.setMove(pawn.id, { x: 1, y: 0, px: pawn.x + 40, py: pawn.y });
    assert.equal(pawn.moveX, 0);
    assert.equal(pawn.x, x0);
    helper.x = pawn.x + 96;
    tender.x = helper.x;
    world._refreshTendHolds();
    assert.equal(pawn._tendHold, false);
    tender.ai.tendSeek = patient;
    helper.x = pawn.x + 16;
    tender.x = helper.x;
    world._refreshTendHolds();
    assert.equal(pawn._tendHold, true);
    tender.ai.tendSeek = null;
    world._refreshTendHolds();
    assert.equal(pawn._tendHold, false);
});

test("setMedical persists for the owner and wakes a healthy sleeper", () => {
    const { world, pawn } = createTestWorld();
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const sleeper = {
        id: "sleep",
        x: pawn.x,
        y: pawn.y,
        dead: false,
        _resting: true,
        resting: true,
        _manualRest: false,
        role: "settler",
        homeSettlementId: settle.id,
        ownerId: pawn.id,
        lastSleep: { uid: "hut", slot: 0, rot: 0 }
    };
    world.settlers.push(sleeper);
    const hut = {
        uid: "hut",
        id: "hut",
        x: pawn.x,
        y: pawn.y,
        medical: false,
        occupants: [sleeper.id, pawn.id, null, null]
    };
    originChunk(world).things.push(hut);
    pawn._resting = true;
    pawn.resting = true;
    pawn._manualRest = true;
    pawn.lastSleep = { uid: "hut", slot: 1, rot: 0 };
    world._handleSettlement(pawn, {
        op: "setMedical",
        settlementId: settle.id,
        uid: "hut",
        medical: true
    });
    assert.equal(hut.medical, true);
    assert.equal(sleeper._resting, false);
    assert.equal(pawn._resting, true);
    world._handleSettlement(pawn, {
        op: "setMedical",
        settlementId: settle.id,
        uid: "hut",
        medical: false
    });
    assert.equal(hut.medical, false);
    settle.ownerId = "someone-else";
    world._handleSettlement(pawn, {
        op: "setMedical",
        settlementId: settle.id,
        uid: "hut",
        medical: true
    });
    assert.equal(hut.medical, false);
});

test("a settlement doctor drops a carry only for a threat close enough to defend", () => {
    const mob = {
        id: "doc",
        x: 0,
        y: 0,
        role: "settler",
        homeSettlementId: "camp",
        _carryPawnId: "pat",
        setDesiredVel() {},
        isBodyDead() { return false; }
    };
    const ai = new PartyAI(mob);
    ai._tickCombat = () => {};
    let dropped = 0;
    const home = { id: "camp", x: 0, y: 0 };
    const world = {
        isControlled: () => false,
        getSettlement: () => home,
        dropCarry() { dropped += 1; },
        interruptSettlerForCombat() {},
        tickSettler: () => ({ halt: true })
    };
    world.getAssistTarget = () => ({ x: 800, y: 0, isBodyDead() { return false; } });
    ai.update(0.1, world);
    assert.equal(dropped, 0);
    world.getAssistTarget = () => ({ x: 16, y: 0, isBodyDead() { return false; } });
    ai.update(0.1, world);
    assert.equal(dropped, 1);
});

test("carry speed is half of walk", () => {
    const mob = {
        id: "help",
        x: 0,
        y: 0,
        kc: 0,
        setDesiredVel(x, y) { this._spd = Math.hypot(x, y); },
        isBodyDead() { return false; }
    };
    const ai = new PartyAI(mob);
    ai._walk(1, 0, false);
    const walk = mob._spd;
    mob._carryPawnId = "pat";
    ai._walk(1, 0, false);
    assert.ok(walk > 0);
    assert.ok(Math.abs(mob._spd - walk * 0.5) < 0.5);
});
