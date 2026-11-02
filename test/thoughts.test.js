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
    assert.equal(Math.round(Thoughts.targetOf(p) * 100), 54);
    assert.equal(Math.round(p.needs.mood * 100), 50);
    assert.equal(Thoughts.tooltip(p).split("\n")[1], "Target: 54%");
});

test("mood rises at 12 per hour and falls at 8, and sleep or a collapse holds it still", () => {
    const rising = pawn();
    Thoughts.refresh(rising, 0);
    Thoughts.noteSleep(rising, "hut", 0);
    Thoughts.noteMeal(rising, "cooked", 0);
    Thoughts.refresh(rising, 0);
    assert.equal(Math.round(rising.needs.mood * 100), 50);
    // Four points at +12 per hour is 20 minutes.
    Thoughts.tick(rising, 20, { eligible: false });
    assert.equal(Math.round(rising.needs.mood * 100), 54);
    Thoughts.tick(rising, 80, { eligible: false });
    assert.equal(Math.round(rising.needs.mood * 100), 54);

    const falling = pawn({ id: "low" });
    Thoughts.refresh(falling, 0);
    falling.needs.mood = 0.8;
    for (let i = 0; i < 3; i++) Thoughts.witness(falling, 0);
    Thoughts.refresh(falling, 0);
    assert.equal(Math.round(Thoughts.targetOf(falling) * 100), 36);
    Thoughts.tick(falling, 60, { eligible: false, asleep: true });
    assert.equal(falling.needs.mood, 0.8);
    Thoughts.tick(falling, 60, { eligible: false, downed: true });
    assert.equal(falling.needs.mood, 0.8);
    Thoughts.tick(falling, 120, { eligible: false });
    const fell = 0.8 - Thoughts.FALL_PER_HOUR / 100;
    assert.ok(Math.abs(falling.needs.mood - fell) < 1e-9);

    const saved = pawn({ id: "saved" });
    Thoughts.refresh(saved, 10);
    saved.needs.mood = 0.62;
    Thoughts.noteMeal(saved, "cooked", 10);
    Thoughts.refresh(saved, 10);
    const copy = pawn({
        id: "saved-copy",
        needs: { mood: saved.needs.mood, moodTarget: saved.needs.moodTarget, rest: 1 }
    });
    Thoughts.apply(copy, Thoughts.toJSON(saved));
    Thoughts.tick(copy, 10, { eligible: false });
    assert.equal(copy.needs.mood, 0.62);
    Thoughts.tick(copy, 70, { eligible: false });
    assert.ok(Math.abs(copy.needs.mood - (0.62 - Thoughts.FALL_PER_HOUR / 100)) < 1e-9);
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
    assert.equal(killer.thoughts.lines[0].label, "Killed someone");
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

test("a brawler who uses a ranged weapon resents it for a day", () => {
    const now = 3 * Thoughts.DAY;
    const brawler = pawn({ traits: ["brawler"] });
    assert.equal(Thoughts.noteRanged(brawler, now), true);
    Thoughts.refresh(brawler, now);
    const line = brawler.thoughts.lines[0];
    assert.equal(line.offset, -10);
    assert.equal(line.label, "Used ranged weapon");
    assert.equal(line.quote, "I despise ranged weaponry.");
    assert.equal(line.expires, now + Thoughts.DAY);

    Thoughts.noteRanged(brawler, now + 10);
    Thoughts.refresh(brawler, now + 10);
    const again = brawler.thoughts.lines.filter((row) => row.label === "Used ranged weapon");
    assert.equal(again.length, 1);
    assert.equal(again[0].expires, now + 10 + Thoughts.DAY);

    const plain = pawn({ id: "plain" });
    assert.equal(Thoughts.noteRanged(plain, now), false);
    Thoughts.refresh(plain, now);
    assert.equal(plain.thoughts.lines.some((row) => row.label === "Used ranged weapon"), false);
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
    assert.equal(infected.thoughts.lines[0].quote, "I'm under the weather. I hope I get well soon.");

    const hungry = pawn({
        id: "bo",
        anatomy: { hediffs: [{ id: "malnutrition", severity: 0.5 }, { id: "food_poisoning", severity: 0.4 }] }
    });
    Thoughts.refresh(hungry, 0);
    assert.equal(hungry.thoughts.lines.some((row) => row.label === "Sick"), false);
});

test("the tooltip sorts bonuses first and grays the quotes", () => {
    const p = pawn({ kc: 500 });
    Thoughts.noteSleep(p, "hut", 0);
    Thoughts.refresh(p, 0);
    const text = Thoughts.tooltip(p);
    assert.match(text, /^Mood: \{g\}49% \(content\)\{\/g\}/);
    assert.match(text, /How this person is feeling right now\./);
    assert.match(text, /Keep them happy, lest they grow resentful\./);
    const hutAt = text.indexOf("{p}+1{/p} Slept in a hut");
    const peckAt = text.indexOf("{n}-2{/n} Peckish");
    assert.ok(hutAt >= 0 && peckAt > hutAt);
    assert.match(text, /\{p\}\+1\{\/p\} Slept in a hut \{b\}\(1d\)\{\/b\}/);
    assert.match(text, /\{n\}-2\{\/n\} Peckish(?! \{b\})/);
    assert.match(text, /\{m\}"I slept with walls around me\."\{\/m\}/);
    assert.match(text, /\{m\}"I could go for some food\."\{\/m\}/);

    const stacked = pawn({ id: "stack" });
    Thoughts.witness(stacked, 0);
    Thoughts.witness(stacked, 1);
    Thoughts.witness(stacked, 2);
    Thoughts.refresh(stacked, 2);
    assert.match(Thoughts.tooltip(stacked), /\{n\}-14\{\/n\} Witnessed a death x3 \{b\}\(1d 23h\)\{\/b\}/);
});

test("memory time sits on the thought name, and a stack shows the next copy to fade", () => {
    const fresh = pawn();
    Thoughts.noteBegan(fresh, 0);
    Thoughts.refresh(fresh, 10 * Thoughts.DAY - (3 * 24 + 23) * 60);
    assert.match(
        Thoughts.tooltip(fresh),
        /\{p\}\+10\{\/p\} Initial optimism \{b\}\(3d 23h\)\{\/b\}/
    );

    const short = pawn({ id: "short" });
    Thoughts.noteSleep(short, "hut", 0);
    Thoughts.refresh(short, Thoughts.DAY - 2 * 60);
    assert.match(Thoughts.tooltip(short), /\{b\}\(2h\)\{\/b\}/);
    Thoughts.refresh(short, Thoughts.DAY - 30);
    assert.match(Thoughts.tooltip(short), /\{b\}\(<1h\)\{\/b\}/);

    const stack = pawn({ id: "fade" });
    Thoughts.witness(stack, 0);
    Thoughts.witness(stack, 100);
    Thoughts.refresh(stack, 2 * Thoughts.DAY - 120);
    assert.match(Thoughts.tooltip(stack), /Witnessed a death x2/);
    assert.match(Thoughts.tooltip(stack), /\{b\}\(2h\)\{\/b\}/);

    const copy = pawn({ id: "kept" });
    Thoughts.apply(copy, Thoughts.toJSON(short));
    assert.equal(copy.thoughts.lines[0].expires, Thoughts.DAY);
});

test("strain fills by band, sulk and strike reset it, and miserable leaves even during a sulk", () => {
    const now = 1000;
    const stressed = pawn();
    Thoughts.noteSleep(stressed, "ground", now);
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
    assert.equal(stressed.thoughts.lines.some((row) => row.label === "Catharsis"), true);
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
    for (let i = 0; i < 5; i++) Thoughts.witness(gone, now);
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

test("a human carcass still counts as seeing a corpse, and an animal carcass does not", () => {
    const { world, pawn: leader } = createTestWorld();
    const chunk = originChunk(world);
    chunk.corpses.push(
        {
            id: "human-carcass",
            x: leader.x,
            y: leader.y,
            key: "human",
            bodyPlan: "human",
            mobId: "human",
            stage: "carcass",
            name: "Ada"
        },
        {
            id: "deer-carcass",
            x: leader.x + 8,
            y: leader.y,
            key: "deer",
            bodyPlan: "deer",
            mobId: "deer",
            stage: "carcass",
            name: "Deer"
        }
    );
    const bones = world._settlerFromSnap({
        id: "settler-bones",
        name: "Bones",
        x: leader.x,
        y: leader.y,
        ownerId: "someone-else",
        kc: 1600,
        inventory: [null, null, null, null, null]
    });
    world.settlers.push(bones);
    world._tickHumanNeeds(bones);
    assert.equal(bones.thoughts.lines.filter((row) => row.label === "Saw a corpse").length, 1);
    world._tickHumanNeeds(bones);
    assert.equal(bones.thoughts.lines.filter((row) => row.label === "Saw a corpse").length, 1);
});

test("darkness is a penalty, and a night owl is glad of it", () => {
    const p = pawn();
    Thoughts.tick(p, 0, { dark: "dark", eligible: false });
    assert.deepEqual(offsets(p), ["-4:Darkness"]);
    assert.equal(p.thoughts.lines[0].quote, "I can't see a thing.");
    Thoughts.tick(p, 1, { dark: "joy", eligible: false });
    assert.deepEqual(offsets(p), ["3:Darkness"]);
    assert.equal(p.thoughts.lines[0].quote, "The darkness surrounds me like a blanket. It comforts me.");
    Thoughts.tick(p, 2, { dark: null, eligible: false });
    assert.deepEqual(offsets(p), []);
});

test("an unlit hearth is a small penalty until the fire is lit again", () => {
    const p = pawn();
    Thoughts.tick(p, 0, { hearthOut: true, eligible: false });
    assert.deepEqual(offsets(p), ["-1:Hearth extinguished"]);
    assert.equal(p.thoughts.lines[0].quote, "The hearth fire has gone out.");
    const copy = pawn({ id: "hearth-copy" });
    Thoughts.apply(copy, Thoughts.toJSON(p));
    Thoughts.refresh(copy, 0);
    assert.deepEqual(offsets(copy), ["-1:Hearth extinguished"]);
    Thoughts.tick(p, 1, { hearthOut: false, eligible: false });
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
    assert.equal(p.thoughts.lines[0].quote, "A part of my body, gone forever...");

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

test("settlers mind an unlit hearth, and a lit one leaves the thought off", () => {
    const { world, pawn: leader, Protocol } = createTestWorld();
    for (const c of world.chunks.values()) {
        c.tiles = Array.from({ length: 8 * 8 }, () => "grass");
    }
    const { tx, ty } = world._tileOf(leader.x, leader.y);
    const { x, y } = world._tileCenter(tx, ty);
    const fire = {
        uid: "cold-hearth",
        id: "unlit_campfire",
        x, y, tx, ty,
        fuel: [null, null],
        cook: null,
        catalyst: null,
        simmer: [null, null, null, null],
        burnRemaining: 0
    };
    originChunk(world).things.push(fire);
    leader.inventory[0] = { id: "hearth", quantity: 1 };
    leader.hotbarIndex = 0;
    world.handleAction(leader.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "found",
        tx, ty, rot: 0,
        name: "Cold Camp"
    });
    const settle = world.settlements[0];
    assert.equal(fire.id, "hearth");
    assert.equal(fire.lit, false);

    const settler = world._settlerFromSnap({
        id: "ember",
        name: "Ember",
        x, y,
        ownerId: leader.id,
        homeSettlementId: settle.id,
        kc: 1600,
        inventory: [null, null, null, null, null]
    });
    world.settlers.push(settler);
    world._tickHumanNeeds(settler);
    world._tickHumanNeeds(leader);
    assert.deepEqual(
        settler.thoughts.lines.filter((row) => row.label === "Hearth extinguished").map((row) => row.offset),
        [-1]
    );
    assert.equal(leader.thoughts.lines.some((row) => row.label === "Hearth extinguished"), false);

    fire.lit = true;
    world._tickHumanNeeds(settler);
    assert.equal(settler.thoughts.lines.some((row) => row.label === "Hearth extinguished"), false);

    const visitor = world._settlerFromSnap({
        id: "guest",
        name: "Guest",
        x, y,
        ownerId: leader.id,
        kc: 1600,
        inventory: [null, null, null, null, null]
    });
    world.settlers.push(visitor);
    fire.lit = false;
    world._tickHumanNeeds(visitor);
    world._tickHumanNeeds(settler);
    assert.equal(visitor.thoughts.lines.some((row) => row.label === "Hearth extinguished"), false);
    assert.equal(settler.thoughts.lines.some((row) => row.label === "Hearth extinguished"), true);
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
    for (let i = 0; i < 5; i++) Thoughts.witness(rec, now);
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

test("stacked thoughts use a diminishing series and cap at 5", () => {
    assert.equal(Thoughts.moodletTotal(100, 1), 100);
    assert.equal(Thoughts.moodletTotal(100, 2), 175);
    assert.equal(Thoughts.moodletTotal(100, 3), 231.25);
    assert.equal(Thoughts.moodletTotal(100, 4), 273.4375);
    assert.equal(Thoughts.moodletTotal(-7, 2), -12.25);
    assert.equal(Thoughts.shownOffset(-13.875), -14);
    assert.equal(Thoughts.shownOffset(13.875), 14);
    assert.equal(Thoughts.shownOffset(-10.5), -11);
    assert.equal(Thoughts.shownOffset(10.5), 11);
    assert.equal(Thoughts.shownOffset(-14), -14);

    const p = pawn({ id: "stack" });
    for (let i = 0; i < 3; i++) Thoughts.witness(p, i);
    Thoughts.refresh(p, 3);
    assert.equal(p.thoughts.lines[0].offset, -14);
    assert.equal(p.thoughts.lines[0].count, 3);
    assert.equal(Math.round(p.needs.mood * 100), 36);
    for (let i = 3; i < 6; i++) Thoughts.witness(p, i);
    Thoughts.refresh(p, 6);
    assert.equal(p.thoughts.lines[0].count, 5);
    assert.equal(p.thoughts.lines[0].offset, -19);
});

test("settlement complaints rank the strongest penalties and hide the score", () => {
    const empty = Thoughts.summary([]);
    assert.equal(empty.count, 0);
    assert.equal(empty.mood, null);
    assert.equal(empty.complaints.length, 0);
    assert.equal(
        Thoughts.settlementTip([]),
        "No settlers.\nKeep them happy, lest they grow resentful."
    );

    const mean = Thoughts.summary([
        { needs: { mood: 0.5 }, thoughts: { lines: [] } },
        { needs: { mood: 0.36 }, thoughts: { lines: [] } }
    ]);
    assert.equal(mean.pct, 43);
    assert.equal(mean.stage, "content");

    const one = {
        needs: { mood: 0.4 },
        thoughts: {
            lines: [
                { offset: 3, label: "Ate a cooked meal", count: 1 },
                { offset: -12, label: "Saw a corpse", count: 3 }
            ]
        }
    };
    const solo = Thoughts.summary([one]);
    assert.equal(solo.complaints.length, 1);
    assert.equal(solo.complaints[0].label, "Saw a corpse");
    assert.equal(solo.complaints[0].n, 1);
    assert.equal(solo.complaints[0].p, -12);
    assert.equal(solo.complaints[0].t, -12);

    const crowd = [];
    for (let i = 0; i < 6; i++) {
        crowd.push({
            needs: { mood: 0.4 },
            thoughts: { lines: [{ offset: -7, label: "Ate raw meat", count: 1 }] }
        });
    }
    const six = Thoughts.summary(crowd);
    assert.equal(six.complaints[0].n, 6);
    assert.equal(six.complaints[0].t, Thoughts.moodletTotal(-7, 6));
    assert.ok(six.complaints[0].t < Thoughts.moodletTotal(-7, 5));

    const mixed = Thoughts.summary([
        { needs: { mood: 0.4 }, thoughts: { lines: [{ offset: -10, label: "In pain", count: 1 }] } },
        { needs: { mood: 0.6 }, thoughts: { lines: [{ offset: -5, label: "In pain", count: 1 }] } }
    ]);
    assert.equal(mixed.complaints[0].p, -10);
    assert.equal(mixed.complaints[0].n, 2);
    assert.equal(mixed.complaints[0].t, -13.75);

    const many = Thoughts.summary([{
        needs: { mood: 0.2 },
        thoughts: {
            lines: [
                { offset: -2, label: "Peckish" },
                { offset: -4, label: "Zebra" },
                { offset: -4, label: "Aardvark" },
                { offset: -6, label: "Hungry" },
                { offset: -7, label: "Ate raw meat" },
                { offset: -15, label: "Ate human flesh" }
            ]
        }
    }]);
    assert.deepEqual(many.complaints.map((row) => row.label), [
        "Ate human flesh",
        "Ate raw meat",
        "Hungry",
        "Aardvark"
    ]);

    const tip = Thoughts.settlementTip(crowd, false);
    assert.match(tip, /Average happiness: \{g\}40% \(content\)\{\/g\}/);
    assert.match(tip, /The average happiness of all your settlers\./);
    assert.match(tip, /\{g\}Top complaints\{\/g\}/);
    assert.match(tip, /\{n\}Ate raw meat\{\/n\}/);
    assert.equal(tip.includes("P="), false);
    const debug = Thoughts.settlementTip(crowd, true);
    assert.match(debug, /\{n\}Ate raw meat  P=-7 N=6 T=/);
});

test("a new main character starts optimistic, and that memory fades after ten days", () => {
    const p = pawn({ id: "founder", name: "Ada", role: "player" });
    assert.equal(Thoughts.noteBegan(p, 0), true);
    assert.equal(Thoughts.noteBegan(p, 100), false);
    Thoughts.refresh(p, 0);
    assert.equal(p.thoughts.lines[0].offset, 10);
    assert.equal(p.thoughts.lines[0].label, "Initial optimism");
    assert.equal(p.thoughts.lines[0].quote, "This is the beginning of something wonderful.");
    assert.equal(Math.round(p.needs.mood * 100), 60);
    Thoughts.refresh(p, 10 * Thoughts.DAY - 1);
    assert.equal(p.thoughts.lines[0].label, "Initial optimism");
    Thoughts.refresh(p, 10 * Thoughts.DAY);
    assert.equal(p.thoughts.lines.some((row) => row.label === "Initial optimism"), false);

    const { SimWorld } = require("../shared/sim/SimWorld");
    const world = SimWorld.createNew({ worldName: "optimism", seed: 2 });
    const fresh = world.addPlayer("freshoptimism01", "Ada", { name: "Ada" }, { silentJoin: true });
    assert.equal(fresh.thoughts.lines[0].label, "Initial optimism");
    assert.equal(fresh.thoughts.lines[0].quote, "This is the beginning of something wonderful.");
    world.removePlayer("freshoptimism01");
    const back = world.addPlayer("freshoptimism01", "Ada", null, { silentJoin: true });
    assert.equal(back.thoughts.lines.filter((row) => row.label === "Initial optimism").length, 1);

    const quiet = pawn({ id: "quiet" });
    const old = world.addPlayer("oldoptimism0001", "Bo", {
        name: "Bo",
        thoughts: Thoughts.toJSON(quiet)
    }, { silentJoin: true });
    assert.equal(old.thoughts.lines.some((row) => row.label === "Initial optimism"), false);
});

test("joining the tribe is a five-day memory that names the main character", () => {
    const p = pawn({ id: "recruit" });
    assert.equal(Thoughts.noteJoined(p, "  Ada  ", 0), true);
    Thoughts.refresh(p, 0);
    assert.equal(p.thoughts.lines[0].offset, 5);
    assert.equal(p.thoughts.lines[0].label, "Joined the tribe");
    assert.equal(p.thoughts.lines[0].quote, "I've been accepted into Ada's tribe");
    const copy = pawn({ id: "copy" });
    Thoughts.apply(copy, Thoughts.toJSON(p));
    Thoughts.refresh(copy, 0);
    assert.equal(copy.thoughts.lines[0].quote, "I've been accepted into Ada's tribe");
    Thoughts.refresh(p, 5 * Thoughts.DAY);
    assert.equal(p.thoughts.lines.some((row) => row.label === "Joined the tribe"), false);

    const { world, pawn: leader, Protocol } = createTestWorld();
    const Party = require("../shared/party");
    leader.name = "Ada";
    world.rng = () => 0;
    world.wanderers.set("w-join-party", {
        id: "w-join-party",
        name: "Og",
        x: leader.x,
        y: leader.y,
        facing: "right",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: false,
        recruitLocked: false,
        refusedBy: []
    });
    world.handleAction(leader.id, { type: Protocol.Actions.RECRUIT, wandererId: "w-join-party" });
    const mate = (leader.party || []).find((m) => m.id === "w-join-party");
    assert.equal(mate.thoughts.lines[0].quote, "I've been accepted into Ada's tribe");

    leader.party = [];
    for (let i = 0; i < Party.CAP - 1; i++) {
        leader.party.push({ id: `mate-${i}`, dead: false, x: 0, y: 0 });
    }
    leader.x = 0;
    leader.y = 0;
    const settle = Settlement.createSettlement({ x: 0, y: 0, ownerId: leader.id, name: "Home" });
    world.settlements.push(settle);
    world.wanderers.set("w-join-camp", {
        id: "w-join-camp",
        name: "Nia",
        x: 16,
        y: 0,
        facing: "right",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: false,
        recruitLocked: false,
        refusedBy: []
    });
    world.handleAction(leader.id, { type: Protocol.Actions.RECRUIT, wandererId: "w-join-camp" });
    const settler = world.settlers.find((s) => s.id === "w-join-camp");
    assert.equal(settler.role, "settler");
    assert.equal(settler.thoughts.lines[0].offset, 5);
    assert.equal(settler.thoughts.lines[0].quote, "I've been accepted into Ada's tribe");

    const parked = world._companionFromSnap(leader, {
        id: "already",
        name: "Already",
        x: 0,
        y: 0
    });
    leader.party = [parked];
    world._handleSettlement(leader, { op: "drop", pawnId: parked.id, settlementId: settle.id });
    const moved = world.settlers.find((s) => s.id === "already");
    assert.equal(moved.role, "settler");
    assert.equal(!!moved.thoughts?.lines?.some((row) => row.label === "Joined the tribe"), false);
});
