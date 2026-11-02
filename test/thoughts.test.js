const { test } = require("node:test");
const assert = require("node:assert/strict");
const Thoughts = require("../shared/thoughts");
const Needs = require("../shared/needs");
const Sleep = require("../shared/sleep");
const { createTestWorld, originChunk } = require("./helpers/simWorld");
const Settlement = require("../shared/settlement");

function pawn(extra = {}) {
    return {
        id: extra.id || "ada",
        name: extra.name || "Ada",
        x: extra.x ?? 32,
        y: extra.y ?? 32,
        kc: extra.kc ?? 1600,
        stomach: extra.stomach ?? 1600,
        needs: { rest: extra.rest ?? 1, mood: 0.5 },
        bio: { traits: extra.traits || [] },
        role: extra.role || "settler",
        ownerId: extra.ownerId || "leader",
        ...extra
    };
}

function offsets(p) {
    return (p.thoughts?.lines || []).map((row) => `${row.offset}:${row.label}${row.count > 1 ? "x" + row.count : ""}`);
}

test("mood is 50 plus the thought sum, and the stage words match the bands", () => {
    const p = pawn();
    Thoughts.refresh(p, 0);
    assert.equal(p.needs.mood, 0.5);
    assert.equal(Thoughts.stage(0.5), "content");
    assert.equal(Thoughts.stage(0.04), "miserable");
    assert.equal(Thoughts.stage(0.05), "unhappy");
    assert.equal(Thoughts.stage(0.24), "unhappy");
    assert.equal(Thoughts.stage(0.25), "stressed");
    assert.equal(Thoughts.stage(0.34), "stressed");
    assert.equal(Thoughts.stage(0.35), "content");
    assert.equal(Thoughts.stage(0.64), "content");
    assert.equal(Thoughts.stage(0.65), "happy");
    assert.equal(Thoughts.stage(0.89), "happy");
    assert.equal(Thoughts.stage(0.9), "elated");
    Thoughts.noteSleep(p, "hut", 0);
    Thoughts.noteMeal(p, "cooked", 0);
    Thoughts.refresh(p, 0);
    assert.equal(Math.round(p.needs.mood * 100), 54);
});

test("a hut is a small bonus and a lean-to or the ground is outdoors", () => {
    const hut = pawn();
    Thoughts.noteSleep(hut, "hut", 10);
    Thoughts.refresh(hut, 10);
    assert.deepEqual(offsets(hut), ["1:Slept in a hut"]);
    const ground = pawn({ id: "bo" });
    Thoughts.noteSleep(ground, "outdoors", 10);
    Thoughts.refresh(ground, 10);
    assert.deepEqual(offsets(ground), ["-4:Slept outdoors"]);
    Thoughts.noteSleep(ground, "hut", 20);
    Thoughts.refresh(ground, 20);
    assert.deepEqual(offsets(ground), ["1:Slept in a hut"]);
});

test("raw meat, human flesh, and a cooked meal do not stack on the same bite", () => {
    const raw = pawn();
    Thoughts.noteMeal(raw, "raw", 0);
    Thoughts.refresh(raw, 0);
    assert.equal(raw.thoughts.lines[0].offset, -7);
    const flesh = pawn({ id: "cy" });
    Thoughts.noteMeal(flesh, "human", 0);
    Thoughts.refresh(flesh, 0);
    assert.deepEqual(offsets(flesh), ["-15:Ate human flesh"]);
    const meal = pawn({ id: "dee" });
    Thoughts.noteMeal(meal, "cooked", 0);
    Thoughts.refresh(meal, 0);
    assert.equal(meal.thoughts.lines[0].offset, 3);
});

test("austere ignores shelter, man-eater ignores bodies and flesh, and both still feel a death in the camp", () => {
    const austere = pawn({ traits: ["austere"] });
    Thoughts.noteSleep(austere, "hut", 0);
    Thoughts.refresh(austere, 0);
    assert.equal(austere.thoughts.memories.length, 0);
    Thoughts.noteSleep(austere, "outdoors", 1);
    Thoughts.refresh(austere, 1);
    assert.deepEqual(offsets(austere), ["3:Slept under the stars"]);
    Thoughts.noteSleep(austere, "hut", 2);
    Thoughts.refresh(austere, 2);
    assert.equal(austere.thoughts.memories.length, 0);
    assert.equal(austere.needs.mood, 0.5);

    const eater = pawn({ id: "eat", traits: ["man_eater"] });
    Thoughts.noteMeal(eater, "human", 0);
    Thoughts.witness(eater, 0);
    Thoughts.seeCorpse(eater, "c1", 0);
    Thoughts.loseSomeone(eater, "Bo", 0);
    Thoughts.refresh(eater, 0);
    assert.deepEqual(offsets(eater), ["-5:Bo died"]);

    const stillRaw = pawn({ id: "raw", traits: ["man_eater"] });
    Thoughts.noteMeal(stillRaw, "raw", 0);
    Thoughts.refresh(stillRaw, 0);
    assert.equal(stillRaw.thoughts.lines[0].label, "Ate raw meat");
});

test("a psychopath skips deaths and still hates human flesh unless they are also a man-eater", () => {
    const psycho = pawn({ traits: ["psychopath"] });
    Thoughts.noteMeal(psycho, "human", 0);
    assert.equal(Thoughts.witness(psycho, 0), false);
    assert.equal(Thoughts.seeCorpse(psycho, "c1", 0), false);
    assert.equal(Thoughts.loseSomeone(psycho, "Bo", 0), false);
    Thoughts.refresh(psycho, 0);
    assert.deepEqual(offsets(psycho), ["-15:Ate human flesh"]);

    const both = pawn({ id: "both", traits: ["psychopath", "man_eater"] });
    Thoughts.noteMeal(both, "human", 0);
    Thoughts.refresh(both, 0);
    assert.equal(both.thoughts.lines.length, 0);
});

test("murderous people like a kill and sour after four and eight dry days", () => {
    const now = 20 * Thoughts.DAY;
    const killer = pawn({ traits: ["murderous"] });
    Thoughts.noteKill(killer, now);
    Thoughts.refresh(killer, now);
    assert.equal(killer.thoughts.lines[0].offset, 8);
    assert.equal(killer.thoughts.lines[0].label, "Killed");
    assert.equal(Thoughts.witness(killer, now), false);
    assert.equal(Thoughts.loseSomeone(killer, "Bo", now), false);

    const dry = pawn({ id: "dry", traits: ["murderous"] });
    Thoughts.apply(dry, { appeared: now - 4 * Thoughts.DAY, lastKill: null, memories: [] });
    Thoughts.refresh(dry, now);
    assert.equal(dry.thoughts.lines[0].offset, -6);
    assert.equal(dry.thoughts.lines[0].label, "Wants to kill");

    Thoughts.apply(dry, { appeared: now - 8 * Thoughts.DAY, lastKill: null, memories: [] });
    Thoughts.refresh(dry, now);
    assert.equal(dry.thoughts.lines[0].offset, -12);
});

test("austere still ranks a hut above a lean-to", () => {
    const origin = { x: 0, y: 0 };
    const picked = Sleep.pickSleepSlot([
        { entry: { id: "lean_to" }, slot: 0, x: 16, y: 0, heal: 8, def: { sleep: {} } },
        { entry: { id: "hut" }, slot: 0, x: 64, y: 0, heal: 12, def: { sleep: { healBonus: 12 } } }
    ], origin, false);
    assert.equal(picked.entry.id, "hut");
});

test("hunger, rest, pain, and food poisoning are situational", () => {
    const p = pawn({ kc: 0, rest: 0 });
    p.anatomy = {
        hediff(id) {
            if (id === "malnutrition") return { severity: 0.2 };
            if (id === "food_poisoning") return { severity: 0.1 };
            return null;
        }
    };
    p.capacities = { pain: () => 0.8 };
    Thoughts.refresh(p, 0);
    const labels = p.thoughts.lines.map((row) => row.label);
    assert.ok(labels.includes("Starving"));
    assert.ok(labels.includes("Malnourished"));
    assert.equal(p.thoughts.lines.find((row) => row.label === "Malnourished").quote, "So... hungry...");
    assert.ok(labels.includes("Exhausted"));
    assert.ok(labels.includes("Agony"));
    assert.ok(labels.includes("Food poisoning"));
});

test("a wimp feels pain sooner and a tough person skips the mild ache", () => {
    const wimp = pawn({ traits: ["wimp"], capacities: { pain: () => 0.1 } });
    Thoughts.refresh(wimp, 0);
    assert.deepEqual(offsets(wimp), ["-5:In pain"]);
    wimp.capacities = { pain: () => 0.4 };
    Thoughts.refresh(wimp, 0);
    assert.deepEqual(offsets(wimp), ["-18:Agony"]);

    const tough = pawn({ id: "bo", traits: ["tough"], capacities: { pain: () => 0.2 } });
    Thoughts.refresh(tough, 0);
    assert.equal(tough.thoughts.lines.some((row) => row.label === "In pain" || row.label === "Agony"), false);
    tough.capacities = { pain: () => 0.4 };
    Thoughts.refresh(tough, 0);
    assert.deepEqual(offsets(tough), ["-10:In pain"]);
});

test("an infection makes them sick, and hunger or bad food does not", () => {
    const infected = pawn({
        anatomy: { hediffs: [{ id: "infection", partName: "Left Arm", severity: 0.4 }, { id: "infection", partName: "Torso", severity: 0.1 }] }
    });
    Thoughts.refresh(infected, 0);
    assert.deepEqual(offsets(infected), ["-8:Sick"]);
    assert.equal(infected.thoughts.lines[0].quote, "I feel ill.");

    const hungry = pawn({
        id: "bo",
        anatomy: { hediffs: [{ id: "malnutrition", severity: 0.5 }, { id: "food_poisoning", severity: 0.4 }] }
    });
    Thoughts.refresh(hungry, 0);
    assert.equal(hungry.thoughts.lines.some((row) => row.label === "Sick"), false);
});

test("the tooltip sorts bonuses first and grays the quotes", () => {
    const p = pawn({ kc: 900 });
    Thoughts.noteSleep(p, "hut", 0);
    Thoughts.refresh(p, 0);
    const text = Thoughts.tooltip(p);
    assert.match(text, /^Mood: \{g\}49% \(content\)\{\/g\}/);
    assert.match(text, /How this person is feeling right now\./);
    assert.match(text, /Keep settlers happy or they might abandon you\./);
    const hutAt = text.indexOf("{p}+1{/p} Slept in a hut");
    const peckAt = text.indexOf("{n}-2{/n} Peckish");
    assert.ok(hutAt >= 0 && peckAt > hutAt);
    assert.match(text, /\{m\}"I slept with walls around me\."\{\/m\}/);
    assert.match(text, /\{m\}"I could eat\."\{\/m\}/);

    const stacked = pawn({ id: "stack" });
    Thoughts.witness(stacked, 0);
    Thoughts.witness(stacked, 1);
    Thoughts.witness(stacked, 2);
    Thoughts.witness(stacked, 3);
    Thoughts.refresh(stacked, 3);
    assert.match(Thoughts.tooltip(stacked), /\{n\}-18\{\/n\} Witnessed a death x3/);
});

test("strain fills by band, sulk and strike reset it, and miserable leaves even during a sulk", () => {
    const now = 1000;
    const stressed = pawn();
    Thoughts.witness(stressed, now);
    Thoughts.witness(stressed, now);
    Thoughts.witness(stressed, now);
    Thoughts.refresh(stressed, now);
    assert.equal(Thoughts.stage(stressed.needs.mood), "stressed");
    const before = stressed.thoughts.strain;
    const slow = Thoughts.tick(stressed, now, { eligible: true });
    assert.equal(slow.logs.length, 0);
    assert.ok(Math.abs(stressed.thoughts.strain - (before + 1 / (2 * Thoughts.DAY))) < 1e-9);

    stressed.thoughts.strain = 1 - 1 / (2 * Thoughts.DAY);
    const sulk = Thoughts.tick(stressed, now + 1, { eligible: true });
    assert.deepEqual(sulk.logs, ["sulk"]);
    assert.equal(stressed._moodJob, "sulk");
    assert.equal(stressed.thoughts.strain, 0);
    assert.equal(stressed.thoughts.lines.some((row) => row.label === "Let it out"), true);
    const held = stressed.thoughts.strain;
    Thoughts.tick(stressed, now + 2, { eligible: true });
    assert.equal(stressed.thoughts.strain, held);

    const unhappy = pawn({ id: "un" });
    for (let i = 0; i < 3; i++) Thoughts.witness(unhappy, now);
    for (let i = 0; i < 5; i++) Thoughts.seeCorpse(unhappy, `c${i}`, now);
    Thoughts.refresh(unhappy, now);
    assert.equal(Thoughts.stage(unhappy.needs.mood), "unhappy");
    unhappy.thoughts.strain = 0.4995;
    const warn = Thoughts.tick(unhappy, now, { eligible: true });
    assert.deepEqual(warn.logs, ["thinking"]);
    unhappy.thoughts.strain = 0.999;
    const strike = Thoughts.tick(unhappy, now + 1, { eligible: true });
    assert.deepEqual(strike.logs, ["strike"]);
    assert.equal(unhappy._moodJob, "strike");

    const gone = pawn({ id: "gone" });
    Thoughts.noteMeal(gone, "human", now);
    for (let i = 0; i < 3; i++) Thoughts.witness(gone, now);
    for (let i = 0; i < 5; i++) Thoughts.seeCorpse(gone, `g${i}`, now);
    Thoughts.apply(gone, { ...Thoughts.toJSON(gone), strain: 0.999, episode: { kind: "sulk", until: now + 50 } });
    Thoughts.refresh(gone, now);
    assert.equal(Thoughts.stage(gone.needs.mood), "miserable");
    const leave = Thoughts.tick(gone, now, { eligible: true });
    assert.equal(leave.abandon, true);
    assert.equal(gone._moodJob, null);

    const asleep = pawn({ id: "zzz" });
    Thoughts.witness(asleep, now);
    Thoughts.witness(asleep, now);
    Thoughts.witness(asleep, now);
    asleep.thoughts.strain = 0.4;
    const paused = Thoughts.tick(asleep, now, { eligible: true, asleep: true });
    assert.equal(paused.logs.length, 0);
    assert.equal(asleep.thoughts.strain, 0.4);

    const leader = pawn({ id: "you", role: "player" });
    leader.thoughts = Thoughts.ensure(leader);
    leader.thoughts.strain = 0.2;
    Thoughts.tick(leader, now, { eligible: false });
    assert.equal(leader.thoughts.strain, 0.2);
    assert.equal(Thoughts.allowsWork({ _moodJob: "sulk", kc: 0 }, "doctor"), true);
    assert.equal(Thoughts.allowsWork({ _moodJob: "sulk", kc: 400 }, "haul"), false);
    assert.equal(Thoughts.allowsWork({ _moodJob: "strike", kc: 0 }, "eat"), true);
    assert.equal(Thoughts.allowsWork({ _moodJob: "strike", kc: 10 }, "eat"), false);
    assert.equal(Thoughts.allowsWork({ _moodJob: "strike", kc: 0 }, "doctor"), false);
    assert.equal(Thoughts.allowsWork({ _moodJob: "strike", kc: 0 }, "sleep"), true);
});

test("waking, eating, a nearby death, and a corpse write thoughts onto the pawn", () => {
    const { world, pawn: leader } = createTestWorld();
    const chunk = originChunk(world);
    chunk.things.push({ uid: "hut-1", id: "hut", x: 48, y: 32, occupants: [leader.id] });
    leader._resting = true;
    leader.lastSleep = { uid: "hut-1", slot: 0 };
    world._wakePawn(leader, leader, { manual: true });
    assert.equal(leader.thoughts.lines[0].label, "Slept in a hut");

    leader._groundSleep = true;
    leader.needs.rest = 0.3;
    world._clearGroundSleep(leader, { stand: true });
    assert.equal(leader.thoughts.lines[0].label, "Slept outdoors");

    const lean = pawn({ id: "lean" });
    world.players.set(lean.id, lean);
    chunk.things.push({ uid: "lean-1", id: "lean_to", x: 80, y: 32, occupants: [lean.id] });
    lean._resting = true;
    lean.lastSleep = { uid: "lean-1", slot: 0 };
    world._wakePawn(lean, lean, { manual: true });
    assert.equal(lean.thoughts.lines[0].label, "Slept outdoors");

    leader.kc = 0;
    leader.stomach = 1600;
    leader.inventory[0] = { id: "raw_venison", quantity: 1 };
    leader.eatChannel = { remaining: 0, max: 1, slot: 0, itemId: "raw_venison" };
    world._finishEat(leader);
    assert.ok(leader.thoughts.lines.some((row) => row.label === "Ate raw meat"));

    leader.inventory[0] = { id: "raw_human_flesh", quantity: 1 };
    leader.eatChannel = { remaining: 0, max: 1, slot: 0, itemId: "raw_human_flesh" };
    world._finishEat(leader);
    assert.ok(leader.thoughts.lines.some((row) => row.label === "Ate human flesh"));
    assert.equal(leader.thoughts.lines.filter((row) => row.label === "Ate raw meat").length, 1);

    const settler = world._settlerFromSnap({
        id: "settler-ada",
        name: "Ada",
        x: leader.x + 16,
        y: leader.y,
        ownerId: leader.id,
        homeSettlementId: null,
        kc: 1600,
        inventory: [null, null, null, null, null]
    });
    settler.bio = { traits: ["psychopath"] };
    world.settlers.push(settler);
    const far = world._settlerFromSnap({
        id: "settler-far",
        name: "Far",
        x: leader.x + 16 * 40,
        y: leader.y,
        ownerId: leader.id,
        kc: 1600,
        inventory: [null, null, null, null, null]
    });
    world.settlers.push(far);
    const buddy = {
        id: "buddy",
        name: "Bo",
        x: leader.x + 8,
        y: leader.y,
        dead: false,
        ownerId: leader.id,
        inventory: [null, null, null, null, null],
        overflow: [],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] }
    };
    leader.party = [buddy];
    world._killCompanion(leader, buddy, null);
    assert.ok(leader.thoughts.lines.some((row) => row.label === "Witnessed a death"));
    assert.equal(settler.thoughts.lines.some((row) => row.label === "Witnessed a death"), false);
    assert.equal(settler.thoughts.lines.some((row) => row.label === "Bo died"), false);
    assert.ok(leader.thoughts.lines.some((row) => row.label === "Bo died"));
    assert.equal(far.thoughts.lines.some((row) => row.label === "Witnessed a death"), false);
    assert.ok(far.thoughts.lines.some((row) => row.label === "Bo died"));

    const body = chunk.corpses.find((row) => row && row.name === "Bo");
    assert.ok(body);
    const looker = world._settlerFromSnap({
        id: "settler-look",
        name: "Look",
        x: body.x,
        y: body.y,
        ownerId: "someone-else",
        kc: 1600,
        inventory: [null, null, null, null, null]
    });
    world.settlers.push(looker);
    world._tickHumanNeeds(looker);
    assert.ok(looker.thoughts.lines.some((row) => row.label === "Saw a corpse"));
    world._tickHumanNeeds(looker);
    assert.equal(looker.thoughts.lines.filter((row) => row.label === "Saw a corpse").length, 1);

    const round = Thoughts.toJSON(leader);
    const copy = pawn({ id: "copy" });
    Thoughts.apply(copy, round);
    assert.equal(copy.thoughts.lines.some((row) => row.label === "Slept outdoors"), true);
});

test("darkness is a penalty, and a night owl is glad of it", () => {
    const p = pawn();
    Thoughts.tick(p, 0, { dark: "dark", eligible: false });
    assert.deepEqual(offsets(p), ["-4:Darkness"]);
    assert.equal(p.thoughts.lines[0].quote, "I can't see a thing.");
    Thoughts.tick(p, 1, { dark: "joy", eligible: false });
    assert.deepEqual(offsets(p), ["3:Darkness"]);
    assert.equal(p.thoughts.lines[0].quote, "The dark is quiet.");
    Thoughts.tick(p, 2, { dark: null, eligible: false });
    assert.deepEqual(offsets(p), []);
});

test("a destroyed part is remembered for a long time, and the pieces under it are not", () => {
    const arm = { name: "Left Arm", baseId: "Arm", dead: true, cut: false, def: {}, isDead() { return this.dead; }, isCutOff() { return this.cut; } };
    const hand = { name: "Left Hand", baseId: "Hand", dead: false, cut: true, def: {}, isDead() { return this.dead; }, isCutOff() { return this.cut; } };
    const finger = { name: "Left Thumb", baseId: "Thumb", dead: true, cut: false, def: {}, isDead() { return this.dead; }, isCutOff() { return this.cut; } };
    const heart = { name: "Heart", baseId: "Heart", dead: true, cut: false, def: { fatal: true }, isDead() { return this.dead; }, isCutOff() { return this.cut; } };
    const parts = [arm, hand, finger, heart];
    const body = {
        parts() { return parts; },
        part(name) { return parts.find((row) => row.name === name) || null; }
    };
    const p = pawn({ anatomy: body });
    Thoughts.refresh(p, 0);
    Thoughts.refresh(p, 1);
    assert.deepEqual(offsets(p).sort(), ["-12:Left Arm is gone", "-3:Left Thumb is gone"]);
    assert.equal(p.thoughts.lines[0].quote, "A piece of me is missing.");

    const span = Thoughts.DEFS.lost_major.duration;
    Thoughts.refresh(p, span);
    assert.equal(p.thoughts.lines.some((row) => row.label === "Left Arm is gone"), false);
    Thoughts.refresh(p, span + 1);
    assert.equal(p.thoughts.lines.some((row) => row.label === "Left Arm is gone"), false);

    arm.dead = false;
    Thoughts.refresh(p, span + 2);
    arm.dead = true;
    Thoughts.refresh(p, span + 3);
    assert.ok(p.thoughts.lines.some((row) => row.label === "Left Arm is gone"));
});

test("night is dark, a fire lifts it, and a blind person does not notice", () => {
    const { world, pawn: leader } = createTestWorld();
    world.gameMinutes = 22 * 60;
    world._tickHumanNeeds(leader);
    assert.ok(leader.thoughts.lines.some((row) => row.label === "Darkness" && row.offset === -4));

    leader.bio = { traits: ["night_owl"] };
    world._tickHumanNeeds(leader);
    assert.ok(leader.thoughts.lines.some((row) => row.label === "Darkness" && row.offset === 3));

    leader.bio = { traits: [] };
    leader.capacities = { sight() { return 0; } };
    world._tickHumanNeeds(leader);
    assert.equal(leader.thoughts.lines.some((row) => row.label === "Darkness"), false);

    leader.capacities = null;
    const chunk = originChunk(world);
    chunk.things.push({
        id: "campfire",
        x: leader.x,
        y: leader.y,
        burnRemaining: 100
    });
    world._tickHumanNeeds(leader);
    assert.equal(leader.thoughts.lines.some((row) => row.label === "Darkness"), false);
});

test("a miserable settler abandons, and a sulk refuses ordinary work", () => {
    const { world, pawn: leader } = createTestWorld();
    const settle = Settlement.createSettlement({ x: 64, y: 64, ownerId: leader.id });
    world.settlements.push(settle);
    const rec = world._settlerFromSnap({
        id: "settler-mood",
        name: "Mood",
        x: 64,
        y: 64,
        ownerId: leader.id,
        homeSettlementId: settle.id,
        kc: 1600,
        stomach: 1600,
        inventory: [null, null, null, null, null]
    });
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    const now = world.worldMinuteIndex();
    Thoughts.noteMeal(rec, "human", now);
    for (let i = 0; i < 3; i++) Thoughts.witness(rec, now);
    for (let i = 0; i < 5; i++) Thoughts.seeCorpse(rec, `body${i}`, now);
    rec.thoughts.strain = 0.999;
    world._tickHumanNeeds(rec);
    world._flushAbandonQueue();
    assert.equal(world.settlers.includes(rec), false);
    assert.equal(world.wanderers.get(rec.id)?.recruitLocked, true);
    const left = (world._events || []).filter((ev) => ev.kind === "combat_log").map((ev) => ev.text);
    assert.ok(left.some((text) => text === "Mood has abandoned you."));

    const worker = world._settlerFromSnap({
        id: "settler-work",
        name: "Work",
        x: 80,
        y: 64,
        ownerId: leader.id,
        homeSettlementId: settle.id,
        kc: 400,
        stomach: 1600,
        inventory: [null, null, null, null, null]
    });
    settle.jobs = {};
    settle.jobs[worker.id] = Settlement.defaultJobs();
    world.settlers.push(worker);
    const mob = world._ensureSettlerCreature(worker);
    worker._moodJob = "sulk";
    worker._workChannel = { kind: "haul", remaining: 10, max: 10, slot: 0 };
    world._tickSettlerWork(mob, 50);
    assert.equal(worker._workChannel, null);
    assert.equal(worker._settlerAct, "Sulk");
    worker._moodJob = "strike";
    worker.kc = 0;
    assert.equal(Thoughts.allowsWork(worker, "eat"), true);
    worker.kc = 400;
    assert.equal(Thoughts.allowsWork(worker, "doctor"), false);
});
