const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadDefs, DataStore, GameMath } = require("./helpers/load");
const { Body } = require("../shared/body/Body");
const Hediffs = require("../shared/body/Hediff");
const BodyHealing = require("../shared/body/Healing");
const BodyCombat = require("../shared/body/Combat");
const Sleep = require("../shared/sleep");
const { createPlayerCreature } = require("../shared/sim/SimCreature");

loadDefs();

test("ported infection asserts", () => {
function assert(cond, msg) {
    if (!cond) throw new Error(msg || "assert failed");
}

function almost(a, b, eps = 1e-6) {
    assert(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
}

function makeOwner(opts = {}) {
    const ctx = { data: DataStore, math: GameMath, combatLog: null };
    const owner = {
        kind: opts.kind || "player",
        name: opts.name || "Tester",
        _resting: !!opts.resting,
        _malnutritionFed: true,
        _dead: false,
        isBodyDead() {
            return this._dead;
        },
        onBodyFatal(_part, reason) {
            this._dead = true;
            this._fatalReason = reason;
        }
    };
    owner.anatomy = new Body(ctx, "human", owner);
    return owner;
}

function addCut(owner, partName, extra = {}) {
    const part = owner.anatomy.part(partName) || owner.anatomy.core;
    const inj = {
        id: "cut",
        name: "Cut",
        severity: 4,
        permanent: false,
        bleeding: true,
        bleedRate: 0.06,
        painPerSeverity: 0.0125,
        tended: false,
        tendQuality: 0,
        infectionChance: 0.15,
        infectInMinutes: null,
        infectBedFactor: null,
        ...extra
    };
    part.injure(inj);
    return inj;
}

const cutDef = DataStore.getInjuryDefs().cut;
const biteDef = DataStore.getInjuryDefs().bite;
assert(cutDef && Math.abs(cutDef.infectionChance - 0.15) < 1e-9, "cut infectionChance");
assert(biteDef && Math.abs(biteDef.infectionChance - 0.3) < 1e-9, "bite infectionChance");
assert(DataStore.getHediffDefs().infection?.local, "infection hediff");
assert(DataStore.getBodyPlan("human").unarmedAttacks.bite.injury === "bite", "human bite injury");
assert(DataStore.getBodyPlan("boar").unarmedAttacks.bite.injury === "bite", "boar bite injury");

almost(Hediffs.tendInfectionFactor(0), 0.85);
almost(Hediffs.tendInfectionFactor(1), 0.05);
almost(Hediffs.tendInfectionFactor(0.4), 0.85 - 0.8 * 0.4);
almost(Hediffs.animalInfectionFactor({ kind: "mob" }), 0.2);
almost(Hediffs.animalInfectionFactor({ kind: "player" }), 1);

GameMath.setRng(() => 0.99);
{
    const owner = makeOwner();
    const inj = addCut(owner, "Left Arm");
    const armed = Hediffs.armInfecter(inj, owner, GameMath);
    assert(!armed && inj.infectInMinutes == null, "stage A fail never infects");
}

GameMath.setRng(() => 0);
{
    const owner = makeOwner();
    const inj = addCut(owner, "Left Arm");
    const armed = Hediffs.armInfecter(inj, owner, GameMath);
    assert(armed, "stage A pass");
    assert(
        inj.infectInMinutes >= Hediffs.INFECT_MINUTES_MIN
            && inj.infectInMinutes <= Hediffs.INFECT_MINUTES_MAX,
        "infect timer range"
    );
}

GameMath.setRng(() => 0);
{
    const animal = makeOwner({ kind: "mob" });
    const inj = addCut(animal, "Torso");
    inj.infectionChance = 0.15;
    GameMath.setRng(() => 0.05);
    const armed = Hediffs.armInfecter(inj, animal, GameMath);
    assert(!armed, "animal 20% of 15% fails at 5%");
}

{
    const inj = { tended: false, tendQuality: 0 };
    almost(Hediffs.stageBChance(inj, { _resting: false }), 1);
    almost(Hediffs.stageBChance(inj, { _resting: true }), 0.5);
    const tended = { tended: true, tendQuality: 0.4, infectBedFactor: 1 };
    almost(Hediffs.stageBChance(tended, { _resting: true }), 0.85 - 0.8 * 0.4);
    const bedded = { tended: true, tendQuality: 0.4, infectBedFactor: 0.5 };
    almost(Hediffs.stageBChance(bedded, {}), (0.85 - 0.8 * 0.4) * 0.5);
}

{
    const owner = makeOwner();
    const inj = addCut(owner, "Left Arm");
    inj.infectInMinutes = 2;
    inj.permanent = true;
    Hediffs._tickInfecters(owner, owner.anatomy, owner.anatomy.ctx);
    assert(inj.infectInMinutes == null, "scar cancels infect timer");
}

{
    const owner = makeOwner();
    const inj = addCut(owner, "Left Arm");
    inj.infectInMinutes = 3;
    const part = owner.anatomy.part("Left Arm");
    const idx = part.injuries.indexOf(inj);
    part.injuries.splice(idx, 1);
    Hediffs._tickInfecters(owner, owner.anatomy, owner.anatomy.ctx);
    assert(!Hediffs.hasInfections(owner.anatomy), "healed wound cannot infect");
}

GameMath.setRng(() => 0);
{
    const owner = makeOwner();
    Hediffs.startInfection(owner, owner.anatomy, "Left Arm", owner.anatomy.ctx);
    Hediffs.startInfection(owner, owner.anatomy, "Right Arm", owner.anatomy.ctx);
    const list = Hediffs.infectionsOf(owner.anatomy);
    assert(list.length === 2, "two local infections");
    list[0].luck = 1;
    for (let i = 0; i < 100; i++) Hediffs.minuteTick(owner, owner.anatomy.ctx);
    const imm = Hediffs.immunityOf(owner.anatomy);
    assert(imm > 0, "shared immunity rises");
    almost(list[0].severity, list[1].severity, 1e-6);
}

{
    const owner = makeOwner();
    const h = Hediffs.startInfection(owner, owner.anatomy, "Left Arm", owner.anatomy.ctx);
    BodyHealing.applyTend(owner.anatomy, { hediff: h }, 0.4);
    assert(h.tended && h.tendMinutesLeft === 12 * 60, "infection tend duration");
    assert(!Hediffs.infectionNeedsTend(h), "tended infection");
    h.tendMinutesLeft = 1;
    Hediffs._tickInfections(owner, owner.anatomy, owner.anatomy.ctx);
    assert(Hediffs.infectionNeedsTend(h), "tend expiry");
    const pick = BodyHealing.pickTendTarget(owner.anatomy);
    assert(pick && pick.hediff === h, "pickTendTarget infection");
}

{
    const owner = makeOwner();
    addCut(owner, "Left Arm");
    const h = Hediffs.startInfection(owner, owner.anatomy, "Right Arm", owner.anatomy.ctx);
    h.tended = false;
    const batch = BodyHealing.pickTendTargets(owner.anatomy, { batchSeverity: 20 });
    assert(batch.length === 1 && batch[0].inj, "do not batch infection with wounds when wound is first");
}

{
    const owner = makeOwner();
    owner.anatomy.part("Left Arm").destroy();
    assert(
        !Hediffs.startInfection(owner, owner.anatomy, "Left Arm", owner.anatomy.ctx),
        "cannot start infection on destroyed part"
    );
}

{
    const owner = makeOwner();
    Hediffs.startInfection(owner, owner.anatomy, "Left Arm", owner.anatomy.ctx);
    assert(owner.anatomy.localHediff("infection", "Left Arm"), "infection on arm");
    owner.anatomy.part("Left Arm").destroy();
    assert(!owner.anatomy.localHediff("infection", "Left Arm"), "part destroy removes infection");
}

{
    const q = BodyHealing.rollTendQuality(0.4, 0.7, { floatBetween: () => 1, clamp: GameMath.clamp }, { selfTend: true });
    almost(q, 0.4 * 0.7);
    const q2 = BodyHealing.rollTendQuality(0.4, 0.7, { floatBetween: () => 1, clamp: GameMath.clamp }, { selfTend: false });
    almost(q2, 0.4);
}

{
    const owner = makeOwner({ resting: true });
    const inj = addCut(owner, "Left Arm");
    BodyHealing.applyTend(owner.anatomy, { part: owner.anatomy.part("Left Arm"), inj }, 0.4);
    almost(inj.infectBedFactor, 0.5);
}

{
    const owner = makeOwner();
    Hediffs.startInfection(owner, owner.anatomy, "Torso", owner.anatomy.ctx);
    assert(Sleep.injuredForAutofill(owner.anatomy), "infection counts as injured");
}

{
    const owner = makeOwner();
    const h = Hediffs.startInfection(owner, owner.anatomy, "Torso", owner.anatomy.ctx);
    h.luck = 1;
    owner.anatomy.immunities.infection = 0;
    for (let i = 0; i < 1800 && !owner._dead; i++) {
        Hediffs.minuteTick(owner, owner.anatomy.ctx);
    }
    assert(owner._dead && owner._fatalReason === "infection", "untreated infection kills");
}

{
    const owner = makeOwner({ resting: true });
    const h = Hediffs.startInfection(owner, owner.anatomy, "Torso", owner.anatomy.ctx);
    h.luck = 1;
    owner.anatomy.immunities.infection = 0;
    BodyHealing.applyTend(owner.anatomy, { hediff: h }, 0.4);
    for (let i = 0; i < 2500 && !owner._dead; i++) {
        if (Hediffs.infectionNeedsTend(h)) {
            BodyHealing.applyTend(owner.anatomy, { hediff: h }, 0.4);
        }
        Hediffs.minuteTick(owner, owner.anatomy.ctx);
    }
    assert(!owner._dead, "tended + rest survives");
    assert(Hediffs.isImmune(owner.anatomy) || !Hediffs.hasInfections(owner.anatomy), "immunity won");
}

GameMath.setRng(() => 0.5);
{
    const player = createPlayerCreature(
        {
            id: "p-inf",
            name: "Bitten",
            x: 0,
            y: 0,
            facing: "right",
            inventory: [null, null, null, null, null],
            hotbarIndex: 0
        },
        DataStore,
        { worldMinuteIndex: () => 100 }
    );
    const attacker = createPlayerCreature(
        {
            id: "p-bite",
            name: "Biter",
            x: 0,
            y: 0,
            inventory: [null, null, null, null, null],
            hotbarIndex: 0
        },
        DataStore,
        { worldMinuteIndex: () => 100 }
    );
    player.anatomy.rollLimb = () => player.anatomy.part("Torso") || player.anatomy.core;
    BodyCombat.applyHit(attacker, player, {
        damage: 5,
        type: "sharp",
        verb: "sunk",
        unarmed: true,
        def: { variance: 0, injury: "bite" },
        name: "Bite"
    });
    const bites = [];
    for (const part of Object.values(player.anatomy.parts())) {
        for (const inj of part.injuries || []) {
            if (inj.id === "bite") bites.push(inj);
        }
    }
    assert(bites.length >= 1, "bite injury from attack.def.injury");
    assert(Math.abs((bites[0].infectionChance || 0) - 0.3) < 1e-9, "bite infectionChance on wound");
}

{
    const owner = makeOwner();
    Hediffs.startInfection(owner, owner.anatomy, "Left Arm", owner.anatomy.ctx);
    const json = owner.anatomy.toJSON();
    const round = new Body({ data: DataStore, math: GameMath }, "human", owner);
    round.loadJSON(json);
    assert(round.localHediff("infection", "Left Arm"), "serialize local infection");
    assert((Number(round.immunities.infection) || 0) >= 0, "serialize immunities");
}



});

function malnourishedOwner(lines, fed) {
    const ctx = {
        data: DataStore,
        math: GameMath,
        combatLog: { push(text) { lines.push(text); } }
    };
    const owner = {
        kind: "player",
        name: "Ada",
        _malnutritionFed: !!fed,
        kc: fed ? 400 : 0,
        saturation: 0,
        _dead: false,
        isBodyDead() { return this._dead; },
        onBodyFatal() { this._dead = true; }
    };
    owner.anatomy = new Body(ctx, "human", owner);
    owner.anatomy.malnutritionRatePerDay = 0.45;
    return owner;
}

test("malnutrition chat waits until the minor stage", () => {
    const lines = [];
    const owner = malnourishedOwner(lines, false);
    const ctx = owner.anatomy.ctx;
    Hediffs._tickMalnutrition(owner, owner.anatomy, ctx);
    const h = owner.anatomy.hediff("malnutrition");
    assert.equal(Hediffs.stageFor(h, ctx).label, "trivial");
    assert.equal(h.announced, false);
    assert.deepEqual(lines, []);

    h.severity = Hediffs.malnutritionNotableMin(ctx) - 0.0001;
    Hediffs._tickMalnutrition(owner, owner.anatomy, ctx);
    assert.equal(Hediffs.stageFor(h, ctx).label, "minor");
    assert.equal(lines.filter((t) => t === "Ada is malnourished").length, 1);
    assert.equal(lines.some((t) => t.includes("now minor")), false);

    lines.length = 0;
    h.severity = 0.3999;
    Hediffs._tickMalnutrition(owner, owner.anatomy, ctx);
    assert.equal(lines.some((t) => t.includes("now moderate")), true);
    assert.equal(lines.some((t) => t === "Ada is malnourished"), false);
});

test("clearing initial malnutrition does not say they recovered", () => {
    const lines = [];
    const owner = malnourishedOwner(lines, false);
    Hediffs._tickMalnutrition(owner, owner.anatomy, owner.anatomy.ctx);
    owner._malnutritionFed = true;
    owner.anatomy.hediff("malnutrition").severity = 0.00001;
    Hediffs._tickMalnutrition(owner, owner.anatomy, owner.anatomy.ctx);
    assert.equal(owner.anatomy.hediff("malnutrition"), null);
    assert.deepEqual(lines, []);
});

test("recovering from minor malnutrition announces it", () => {
    const lines = [];
    const owner = malnourishedOwner(lines, false);
    const h = owner.anatomy.addHediff("malnutrition", 0.25);
    Hediffs._tickMalnutrition(owner, owner.anatomy, owner.anatomy.ctx);
    assert.equal(h.announced, true);
    assert.equal(lines.includes("Ada is malnourished"), true);
    lines.length = 0;
    owner._malnutritionFed = true;
    h.severity = 0.00001;
    Hediffs._tickMalnutrition(owner, owner.anatomy, owner.anatomy.ctx);
    assert.equal(lines.includes("Ada is no longer malnourished"), true);
});

test("an old malnutrition save does not repeat the onset line", () => {
    const lines = [];
    const owner = malnourishedOwner(lines, false);
    const h = owner.anatomy.addHediff("malnutrition", 0.4);
    delete h.announced;
    Hediffs._tickMalnutrition(owner, owner.anatomy, owner.anatomy.ctx);
    assert.equal(h.announced, true);
    assert.equal(lines.some((t) => t.includes("malnourished")), false);
});

test("malnutrition announced flag round-trips", () => {
    const owner = malnourishedOwner([], true);
    const h = owner.anatomy.addHediff("malnutrition", 0.05);
    assert.equal(h.announced, false);
    const json = owner.anatomy.toJSON();
    assert.equal(json.hediffs.find((row) => row.id === "malnutrition").announced, false);
    const clone = new Body(owner.anatomy.ctx, "human", owner);
    clone.loadJSON(json);
    assert.equal(clone.hediff("malnutrition").announced, false);
    delete json.hediffs.find((row) => row.id === "malnutrition").announced;
    const legacy = new Body(owner.anatomy.ctx, "human", owner);
    legacy.loadJSON(json);
    assert.equal(legacy.hediff("malnutrition").announced, undefined);
});
