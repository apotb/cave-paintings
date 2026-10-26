const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Skills = require("../shared/skills");
const DataStore = require("../shared/DataStore");
const Loader = require("../shared/mods/loader");
const Settlement = require("../shared/settlement");
const BodyHealing = require("../shared/body/Healing");

const ROOT = path.resolve(__dirname, "..");
const GAME = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version;

if (!DataStore.isReady()) DataStore.loadFromDisk(ROOT);

function seqRng(values) {
    let i = 0;
    return () => {
        const n = values[i] ?? values[values.length - 1] ?? 0;
        i += 1;
        return n;
    };
}

test("a new bio rolls gender, age, both backstories, traits, and skills", () => {
    const bio = Skills.generate(seqRng([0.1, 0.2, 0.4, 0.9, 0.5, 0.1, 0.05, 0.2, 0.8, 0.4]));
    assert.ok(bio.gender === "male" || bio.gender === "female");
    assert.ok(bio.age >= 16 && bio.age <= 55);
    assert.ok(bio.childhood);
    assert.ok(bio.adulthood);
    assert.ok(bio.traits.length >= 1 && bio.traits.length <= 3);
    for (const id of Skills.SKILL_IDS) {
        assert.ok(bio.skills[id].level >= 0 && bio.skills[id].level <= 14);
        assert.ok(bio.skills[id].passion >= 0 && bio.skills[id].passion <= 2);
    }
    const passionate = Skills.SKILL_IDS.filter((id) => bio.skills[id].passion > 0);
    assert.ok(passionate.length <= 4);
});

test("a trait menu blocks conflicts", () => {
    const traits = DataStore._store.traitsList;
    const byId = (id) => traits.find((row) => row.id === id);
    const slow = byId("slow_learner");
    const fast = byId("fast_learner");
    const brawler = byId("brawler");
    assert.ok(slow && fast && brawler);
    assert.equal(Skills.traitConflicts(slow, ["fast_learner"], traits), true);
    assert.equal(Skills.traitConflicts(fast, ["slow_learner"], traits), true);
    assert.equal(Skills.traitConflicts(fast, ["fast_learner"], traits), true);
    assert.equal(Skills.traitConflicts(fast, [], traits), false);
    assert.equal(Skills.traitConflicts(brawler, ["fast_learner"], traits), false);
});

test("a backstory passion shows while that story is selected", () => {
    const stories = DataStore._store.backstoriesList;
    const story = stories.find((row) => row.slot === "child" && row.passions && Object.keys(row.passions).length);
    assert.ok(story);
    const skillId = Object.keys(story.passions)[0];
    const granted = Math.max(0, Math.min(2, Math.floor(Number(story.passions[skillId]))));
    const bio = Skills.normalize({
        gender: "female",
        age: 20,
        childhood: story.id,
        adulthood: null,
        traits: [],
        skills: { [skillId]: { level: 3, xp: 0, passion: 0 }, melee: { level: 1, xp: 0, passion: 2 } }
    });
    assert.equal(Skills.passionOf(bio, skillId), granted);
    assert.equal(Skills.passionOf(bio, "melee"), story.passions.melee == null ? 2 : Math.max(0, Math.min(2, Math.floor(Number(story.passions.melee)))));
    bio.childhood = null;
    assert.equal(Skills.passionOf(bio, skillId), 0);
    assert.equal(Skills.passionOf(bio, "melee"), 2);
});

test("a skill bar fills across levels 0 through 20", () => {
    assert.equal(Skills.levelProgress(0, 0, 0), 0);
    assert.equal(Skills.levelProgress(10, 10, 0), 0.5);
    assert.equal(Skills.levelProgress(20, 20, 500), 1);
    assert.equal(Skills.levelProgress(9, 3, 0), 0.45);
    const into = 2000 / Skills.xpToNext(5);
    assert.equal(Skills.levelProgress(8, 5, 2000), (8 + into) / 20);
});

test("social sits between medical and intellectual", () => {
    const ids = Skills.SKILL_IDS;
    assert.deepEqual(
        ids.slice(ids.indexOf("medical"), ids.indexOf("intellectual") + 1),
        ["medical", "social", "intellectual"]
    );
    const old = Skills.normalize({
        gender: "female",
        age: 30,
        skills: { medical: { level: 2, xp: 1, passion: 0 } }
    });
    assert.equal(old.skills.social.level, 0);
    assert.equal(old.skills.social.passion, 0);
    assert.equal(old.skills.medical.level, 2);
    const stories = DataStore._store.backstoriesList;
    const trader = stories.find((row) => row.skills && Number(row.skills.social));
    assert.ok(trader);
    const raw = Skills.backstoryTip(trader, "Og");
    const tip = (Skills.tipLayers(raw) || { plain: raw }).plain;
    let last = -1;
    for (const id of Skills.SKILL_IDS) {
        const v = trader.skills?.[id];
        if (!Number.isFinite(Number(v)) || Number(v) === 0) continue;
        const at = tip.indexOf(`${Skills.labelOf(id)}:`);
        assert.ok(at > last);
        last = at;
    }
    const shut = stories.find((row) => (row.disable || []).includes("social"));
    if (shut) assert.match(Skills.backstoryTip(shut, "Og"), /Incapable of Social/);
    const shown = Skills.tipLayers(Skills.skillTip(old, "social")).plain;
    assert.match(shown, new RegExp(`^Social\\n${Skills.SKILL_BLURBS.social}`));
});

test("a trait lists the stat changes it makes", () => {
    assert.deepEqual(Skills.effectLines({ skills: { melee: -2, medical: 3 } }), ["Melee -2", "Medical +3"]);
    assert.deepEqual(Skills.effectLines({ learning: 0.5 }), ["Learning rate +50%"]);
    assert.deepEqual(Skills.effectLines({ learning: -0.5 }), ["Learning rate -50%"]);
    assert.deepEqual(Skills.effectLines({ disable: ["medical"] }), ["Incapable of Medical"]);
    const soft = Skills.traitTip({
        desc: "Good with a bandage, poor with a club.",
        skills: { melee: -2, medical: 3 }
    });
    assert.equal(Skills.tipLayers(soft), null);
    assert.match(soft, /Good with a bandage, poor with a club\.\n\n {2}Melee -2\n {2}Medical \+3/);
    const study = Skills.traitTip({
        desc: "<name> learns quickly.",
        learning: 0.5
    }, "Mog");
    assert.match(study, /Mog learns quickly\.\n\n {2}Learning rate \+50%/);
    const brawler = Skills.traitTip({
        desc: "Fights up close.",
        skills: { melee: 4 },
        passions: { melee: 2, shooting: 1 },
        disable: ["shooting"]
    });
    const layers = Skills.tipLayers(brawler);
    assert.match(layers.plain, /Fights up close\.\n\n {2}Melee \+4\n {2}\* \* Melee\n {2}\* Shooting\n {2}Incapable of Shooting/);
    assert.equal((layers.stars.match(/\*/g) || []).length, 3);
    assert.equal(/passion/i.test(layers.plain), false);
    assert.equal((Skills.tipHtml(brawler).match(/class="tip-star"/g) || []).length, 3);
    assert.match(Skills.tipHtml(brawler), /width="0\.9375em"/);
    assert.deepEqual(Skills.effectLines({
        skills: { melee: 4 },
        passions: { melee: 2 },
        disable: ["shooting"]
    }), ["Melee +4", "{s}*{/s} {s}*{/s} Melee", "Incapable of Shooting"]);
});

test("a backstory tip is the story, then each skill change", () => {
    const stories = DataStore._store.backstoriesList;
    const hearth = stories.find((row) => row.id === "hearth_tender");
    const tip = Skills.backstoryTip(hearth, "Og");
    assert.equal(tip.includes("<name>"), false);
    assert.match(tip, /\{o\}Og\{\/o\} learned to cook/);
    const layers = Skills.tipLayers(tip);
    assert.match(layers.plain, /Og learned to cook/);
    assert.equal(layers.orange.replace(/Og/g, "").trim(), "");
    assert.match(Skills.tipHtml(tip), /color:#f0a040[^>]*>Og</);
    const cookStars = Math.max(1, Math.min(2, Math.floor(Number(hearth.passions?.cooking) || 0)));
    const cookMark = Array.from({ length: cookStars }, () => "\\*").join(" ");
    assert.match(layers.plain, new RegExp(
        `Cooking: \\+${hearth.skills.cooking}\\nPlants: ${hearth.skills.plants}\\n${cookMark} Cooking`
    ));
    const veteran = stories.find((row) => row.id === "veteran");
    const veteranTip = Skills.backstoryTip(veteran, "Og");
    assert.match(Skills.tipLayers(veteranTip).plain, /Og has spent years/);
    assert.match(veteranTip, /Incapable of Medical/);
    assert.equal(Skills.backstoryTip(null, "Og"), "Unknown");
});

test("an incapable skill names the backstory or trait that caused it", () => {
    const bio = Skills.normalize({
        gender: "female",
        age: 40,
        childhood: null,
        adulthood: "veteran",
        traits: ["brawler"],
        skills: Skills.emptySkills()
    });
    assert.equal(Skills.incapableTip(bio, "medical"), "Adulthood: Veteran");
    assert.equal(Skills.incapableTip(bio, "shooting"), "Trait: Brawler");
    assert.equal(Skills.incapableTip(bio, "melee"), "");
});

test("a skill tip splits the shown level from what was learned", () => {
    const bio = Skills.normalize({
        gender: "female",
        age: 30,
        childhood: null,
        adulthood: "herbalist",
        traits: ["fast_learner"],
        skills: {
            medical: { level: 5, xp: 5750, passion: 1 },
            melee: { level: 10, xp: 10, passion: 0 },
            crafting: { level: 20, xp: 0, passion: 2 }
        }
    });
    const medical = Skills.tipLayers(Skills.skillTip(bio, "medical")).plain;
    assert.match(medical, new RegExp(`^Medical\\n${Skills.SKILL_BLURBS.medical}`));
    assert.match(medical, new RegExp(`Skill level: 7 - ${Skills.levelTitle(7)}`));
    assert.match(medical, /- Learned level: 5\n- Herbalist: \+2/);
    assert.match(medical, /Progress to next learned level: 5750 \/\n6000/);
    assert.match(medical, /Learning speed: 150%/);
    assert.match(medical, /- Base value: 150%/);
    assert.match(medical, /- Passion: x100%/);
    assert.equal(medical.includes("Forgetting"), false);
    const melee = Skills.tipLayers(Skills.skillTip(bio, "melee")).plain;
    assert.match(melee, new RegExp(`Skill level: 10 - ${Skills.levelTitle(10)}`));
    assert.equal(melee.includes("Learned level"), false);
    assert.match(melee, /Learning speed: 52.5%/);
    assert.match(melee, /- Passion: x35%/);
    const crafting = Skills.tipLayers(Skills.skillTip(bio, "crafting")).plain;
    assert.equal(crafting.includes("Learned level"), false);
    assert.match(crafting, /Progress to next learned level: maxed/);
    assert.match(crafting, /Learning speed: 225%/);
    assert.match(crafting, /- Passion: x150%/);
    const blocked = Skills.normalize({
        gender: "male",
        age: 40,
        childhood: null,
        adulthood: "veteran",
        traits: ["brawler"],
        skills: Skills.emptySkills()
    });
    const off = Skills.tipLayers(Skills.skillTip(blocked, "medical")).plain;
    assert.match(off, /Incapable/);
    assert.match(off, /Adulthood: Veteran/);
    assert.equal(off.includes("Skill level"), false);
    const shot = Skills.tipLayers(Skills.skillTip(blocked, "shooting")).plain;
    assert.match(shot, /Incapable/);
    assert.match(shot, /Trait: Brawler/);
    assert.match(shot, /Progress to next learned level: 0 \/ 1000/);
    const html = Skills.tipHtml(Skills.skillTip(bio, "medical"));
    assert.match(html, /color:#e6c15a/);
    assert.match(html, /color:#a0a0a0/);
    assert.equal(Skills.tipLayers("plain text"), null);
});

test("the same id rolls the same bio", () => {
    const a = Skills.ensure(null, "pawn-old");
    const b = Skills.ensure(null, "pawn-old");
    assert.deepEqual(a.gender, b.gender);
    assert.equal(a.age, b.age);
    assert.equal(a.childhood, b.childhood);
    assert.equal(a.adulthood, b.adulthood);
});

test("backstory offsets stay live", () => {
    const bio = Skills.normalize({
        gender: "female",
        age: 30,
        childhood: "hearth_tender",
        adulthood: "forager",
        traits: [],
        skills: { cooking: { level: 4, xp: 0, passion: 0 }, plants: { level: 4, xp: 0, passion: 0 } }
    });
    const book = DataStore._store.backstoriesList.find((row) => row.id === "hearth_tender");
    const forager = DataStore._store.backstoriesList.find((row) => row.id === "forager");
    assert.equal(Skills.effectiveLevel(bio, "cooking"), 4 + book.skills.cooking);
    assert.equal(Skills.effectiveLevel(bio, "plants"), 4 + book.skills.plants + forager.skills.plants);
    const prev = book.skills.cooking;
    book.skills.cooking = prev + 2;
    try {
        assert.equal(Skills.effectiveLevel(bio, "cooking"), 4 + prev + 2);
    } finally {
        book.skills.cooking = prev;
    }
});

test("a disabled skill keeps its level and does no work", () => {
    const bio = Skills.normalize({
        gender: "male",
        age: 40,
        childhood: "den_child",
        adulthood: "veteran",
        traits: ["squeamish"],
        skills: { medical: { level: 6, xp: 10, passion: 1 } }
    });
    assert.equal(bio.skills.medical.level, 6);
    assert.equal(Skills.effectiveLevel(bio, "medical"), null);
    assert.equal(Skills.incapable(bio, "medical"), true);
    assert.equal(Skills.award(bio, "medical", 100, { day: 1 }), 0);
    assert.equal(bio.skills.medical.xp, 10);
});

test("passion and learning scale experience", () => {
    assert.equal(Skills.passionMult(0), 0.35);
    assert.equal(Skills.passionMult(1), 1);
    assert.equal(Skills.passionMult(2), 1.5);
    const traits = DataStore._store.traitsList;
    const fast = traits.find((row) => Number(row.learning) > 0 && !(row.passions && row.passions.plants));
    const factor = fast ? 1 + Number(fast.learning) : 1;
    const bio = Skills.normalize({
        gender: "female",
        age: 20,
        childhood: null,
        adulthood: null,
        traits: fast ? [fast.id] : [],
        skills: { plants: { level: 1, xp: 0, passion: 2 } }
    });
    const gained = Skills.award(bio, "plants", 100, { day: 1 });
    assert.equal(gained, 100 * 1.5 * factor);
    assert.equal(bio.skills.plants.xp, gained);
    const stories = DataStore._store.backstoriesList;
    const granting = stories.find((row) => row.passions && Number(row.passions.plants) > 0);
    if (!granting) return;
    const granted = Math.max(0, Math.min(2, Math.floor(Number(granting.passions.plants))));
    const lived = Skills.normalize({
        gender: "female",
        age: 20,
        childhood: granting.slot === "child" ? granting.id : null,
        adulthood: granting.slot === "adult" ? granting.id : null,
        traits: [],
        skills: { plants: { level: 1, xp: 0, passion: 0 } }
    });
    assert.equal(Skills.award(lived, "plants", 100, { day: 2 }), 100 * Skills.passionMult(granted));
});

test("daily experience past 4000 is cut to a fifth, and decay counts against that", () => {
    const bio = Skills.normalize({
        gender: "male",
        age: 22,
        childhood: "den_child",
        adulthood: "forager",
        traits: [],
        skills: { melee: { level: 2, xp: 0, passion: 1 } }
    });
    Skills.award(bio, "melee", 4500, { day: 3 });
    assert.equal(bio.xpDay.gross.melee, 4500);
    assert.ok(bio.skills.melee.xp < 4500);
    bio.skills.melee.level = 12;
    bio.skills.melee.xp = 0;
    Skills.decayOneDay(bio);
    assert.equal(bio.skills.melee.level, 12);
    assert.equal(bio.skills.melee.xp, -120);
    assert.equal(bio.xpDay.gross.melee, 4500 - 120);
    bio.skills.melee.xp = -1001;
    Skills.decayOneDay(bio);
    assert.ok(bio.skills.melee.level < 12);
});

test("melee and tend factors match the curves", () => {
    assert.equal(Skills.meleeHitChance(0), 0.5);
    assert.equal(Skills.meleeHitChance(8), 0.74);
    assert.equal(Skills.meleeHitChance(20), 0.9);
    assert.equal(Skills.meleeDodgeChance(5), 0);
    assert.equal(Skills.meleeDodgeChance(6), 0.02);
    assert.equal(Skills.meleeDodgeChance(20), 0.3);
    assert.equal(Skills.tendQualityFactor(8), 1);
    assert.equal(Skills.tendSpeed(10), 1);
    const plain = BodyHealing.rollTendQuality(0.4, 1, { floatBetween: () => 1, clamp: (n, a, b) => Math.max(a, Math.min(b, n)) });
    const skilled = BodyHealing.rollTendQuality(0.4, 1, { floatBetween: () => 1, clamp: (n, a, b) => Math.max(a, Math.min(b, n)) }, { medicalLevel: 0 });
    assert.ok(skilled < plain);
    assert.equal(Skills.fishSpeed(10), 1);
    assert.equal(Skills.fishSpeed(0), 0.75);
});

test("a doctor plan skips a medically incapable pawn", () => {
    const patient = { pawn: { id: "hurt", dead: false }, canTend: true, inBed: true };
    const open = Settlement.planWork({
        jobs: { doctor: 3 },
        rec: { id: "doc", dead: false, bio: Skills.normalize({
            gender: "female",
            age: 28,
            childhood: "den_child",
            adulthood: "forager",
            traits: [],
            skills: {}
        }) },
        critical: [patient],
        assignment: "work"
    });
    assert.equal(open?.type, "doctor");
    const skipped = Settlement.planWork({
        jobs: { doctor: 3 },
        rec: { id: "doc", dead: false, bio: Skills.normalize({
            gender: "female",
            age: 28,
            childhood: "den_child",
            adulthood: "veteran",
            traits: [],
            skills: {}
        }) },
        critical: [patient],
        assignment: "work"
    });
    assert.notEqual(skipped?.type, "doctor");
});

test("a mod can add a backstory and a trait", () => {
    const store = {
        itemsList: DataStore._store.itemsList.slice(),
        thingsList: DataStore._store.thingsList.slice(),
        mobsList: DataStore._store.mobsList.slice(),
        techsList: DataStore._store.techsList.slice(),
        backstoriesList: DataStore._store.backstoriesList.slice(),
        traitsList: DataStore._store.traitsList.slice(),
        bodyPlans: DataStore._store.bodyPlans,
        injuries: DataStore._store.injuries,
        hediffs: DataStore._store.hediffs,
        itemsById: DataStore._store.itemsById,
        thingsById: DataStore._store.thingsById,
        mobsById: DataStore._store.mobsById
    };
    Loader.stampCore(store, { types: [], lootTables: {} });
    const pack = {
        manifest: {
            id: "test.bio_mod",
            name: "Bio",
            version: "1.0.0",
            gameVersion: `>=${GAME}`,
            dependencies: []
        },
        data: {
            backstories: [{
                id: "cave_kid",
                slot: "child",
                title: "Cave kid",
                desc: "Lived in a cave.",
                skills: { plants: 1 },
                traits: ["night_owl"]
            }],
            traits: [{
                id: "night_owl",
                title: "Night owl",
                desc: "Stays up.",
                commonality: 1,
                conflicts: ["night_owl"]
            }]
        }
    };
    Loader.mergePacks(store, { types: [], lootTables: {} }, [pack], GAME);
    const book = store.backstoriesList.find((row) => row.id === "test.bio_mod.cave_kid");
    const trait = store.traitsList.find((row) => row.id === "test.bio_mod.night_owl");
    assert.ok(book);
    assert.equal(book.traits[0], "test.bio_mod.night_owl");
    assert.ok(trait);
    assert.throws(() => Loader.mergePacks(store, { types: [], lootTables: {} }, [pack], GAME));
});

test("a spawned human keeps a wanderer bio on its corpse", () => {
    const { createTestWorld } = require("./helpers/simWorld");
    const { world } = createTestWorld();
    const deer = world._spawnMobAt("deer", 40, 40);
    assert.ok(deer);
    assert.equal(deer.bio, undefined);
    const entry = world._spawnMobAt("human", 80, 96);
    assert.ok(entry);
    assert.ok(entry.name && entry.name !== "Human");
    assert.ok(entry.look);
    assert.equal(entry.bio.gender === "male" || entry.bio.gender === "female", true);
    assert.equal(typeof entry.bio.age, "number");
    assert.ok(entry.bio.childhood);
    assert.equal(typeof entry.bio.skills.melee.level, "number");
    const mob = world.mobs.get(entry.uid);
    assert.equal(mob.name, entry.name);
    assert.equal(mob.bio, entry.bio);
    world._finishMobDeath(mob, null);
    let corpse = null;
    for (const chunk of world.chunks.values()) {
        corpse = (chunk.corpses || []).find((row) => row && row.sourceUid === entry.uid) || corpse;
    }
    assert.ok(corpse);
    assert.equal(corpse.name, entry.name);
    assert.equal(corpse.look, entry.look);
    assert.notEqual(corpse.bio, entry.bio);
    assert.equal(corpse.bio.childhood, entry.bio.childhood);
    assert.equal(corpse.bio.skills.melee.level, entry.bio.skills.melee.level);
});
