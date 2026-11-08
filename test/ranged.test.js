const { test } = require("node:test");
const assert = require("node:assert/strict");
const Ranged = require("../shared/ranged");
const Durability = require("../shared/durability");
const Stone = require("../shared/stone");

test("arrow stacks match only the same stone and blade grade", () => {
    const a = { id: "arrow", knapMaterial: "pebble", stone: "flint", knapQuality: "rough" };
    const same = { id: "arrow", knapMaterial: "pebble", stone: "flint", knapQuality: "rough" };
    const otherGrade = { id: "arrow", knapMaterial: "pebble", stone: "flint", knapQuality: "fine" };
    const otherStone = { id: "arrow", knapMaterial: "pebble", stone: "andesite", knapQuality: "rough" };
    assert.equal(Ranged.sameArrow(a, same), true);
    assert.equal(Ranged.sameArrow(a, otherGrade), false);
    assert.equal(Ranged.sameArrow(a, otherStone), false);
    assert.equal(Ranged.sameArrow(a, { id: "stick" }), false);
});

test("the first arrow is hotbar order, then the backpack", () => {
    const hotbar = [null, { id: "shortbow", quantity: 1 }, { id: "arrow", quantity: 2, knapQuality: "rough" }];
    const pack = [{ id: "arrow", quantity: 4, knapQuality: "fine" }];
    const found = Ranged.firstArrow(hotbar, pack);
    assert.equal(found.stack.knapQuality, "rough");
    const spent = Ranged.spendArrow(found);
    assert.equal(spent.quantity, 1);
    assert.equal(hotbar[2].quantity, 1);
    hotbar[2] = null;
    const next = Ranged.firstArrow(hotbar, pack);
    assert.equal(next.stack.knapQuality, "fine");
});

test("a rough shortbow and a rough andesite point land near a spear stab", () => {
    const dmg = Ranged.shotDamage(
        { id: "shortbow", knapQuality: "rough" },
        { id: "arrow", knapMaterial: "pebble", stone: "andesite", knapQuality: "rough" }
    );
    assert.ok(Math.abs(dmg - 10.8) < 0.05, dmg);
    const flint = Ranged.shotDamage(
        { id: "shortbow", knapQuality: "fine" },
        { id: "arrow", knapMaterial: "flint", knapQuality: "fine" }
    );
    assert.ok(flint > dmg, flint);
});

test("a longbow hits harder than a shortbow of the same grade", () => {
    const arrow = { id: "arrow", knapMaterial: "pebble", stone: "andesite", knapQuality: "rough" };
    const short = Ranged.shotDamage({ id: "shortbow", knapQuality: "rough" }, arrow);
    const long = Ranged.shotDamage({ id: "longbow", knapQuality: "rough" }, arrow);
    assert.ok(Math.abs(short - 10.8) < 0.05, short);
    assert.ok(Math.abs(long - 16.2) < 0.05, long);
    assert.equal(Ranged.aimMs({ id: "shortbow" }), 0);
    assert.equal(Ranged.aimMs({ id: "longbow" }), Ranged.AIM_MS);
    assert.equal(Ranged.rangeTiles({ id: "shortbow" }), 14);
    assert.equal(Ranged.rangeTiles({ id: "longbow" }), 20);
});

test("bow quality does not change how many draws it has", () => {
    const def = { durability: 80, quality: true, weapon: { type: "ranged" } };
    assert.equal(Durability.maxDurability({ id: "shortbow", knapQuality: "fine" }, def), 80);
    assert.equal(Durability.maxDurability({ id: "shortbow", knapQuality: "crude" }, def), 80);
    assert.equal(Durability.maxDurability({ id: "longbow", knapQuality: "fine" }, def), 80);
    assert.equal(Durability.maxDurability({ id: "longbow", knapQuality: "crude" }, def), 80);
});

test("shooting practice is a body on the aim or within a tile of it", () => {
    const foe = { id: "foe", x: 40, y: 0, hitboxSize: 8 };
    const self = { id: "self", x: 0, y: 0, hitboxSize: 8 };
    assert.equal(Ranged.aimedNear([foe, self], 40, 0, self, 16), foe);
    assert.equal(Ranged.aimedNear([foe], 40, 18, null, 16), foe);
    assert.equal(Ranged.aimedNear([foe], 40, 40, null, 16), null);
    assert.equal(Ranged.aimedNear([self], 0, 0, self, 16), null);
    const corpse = { id: "corpse", x: 40, y: 0, hitboxSize: 8, dead: true };
    assert.equal(Ranged.aimedNear([corpse], 40, 0, null, 16), null);
});

test("flight time matches the distance and stays between 70 and 280 ms", () => {
    assert.equal(Ranged.flightMs(0), 70);
    assert.equal(Ranged.flightMs(10), 70);
    assert.equal(Ranged.flightMs(20), 120);
    assert.equal(Ranged.flightMs(100), 280);
});

test("the aim point clamps to the bow's reach", () => {
    const aim = Ranged.clampAim(0, 0, 1000, 0, Ranged.RANGE_TILES, 16);
    assert.equal(aim.x, 14 * 16);
    assert.equal(aim.y, 0);
    const far = Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 1000,
        aimY: 0,
        tile: 16,
        rangeTiles: Ranged.LONG_RANGE_TILES,
        rng: () => 0,
        accuracyAt: () => 0
    });
    assert.equal(far.aim.x, 20 * 16);
    const near = Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 1000,
        aimY: 0,
        tile: 16,
        rangeTiles: Ranged.rangeTiles({ id: "shortbow" }),
        rng: () => 0,
        accuracyAt: () => 0
    });
    assert.equal(near.aim.x, 14 * 16);
});

test("a solid stops a shot short of the body it was aimed at", () => {
    const foe = { id: "foe", x: 80, y: 0, hitboxSize: 8, faction: "wild" };
    const shot = Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 80,
        aimY: 0,
        shooter: { x: 0, y: 0, faction: "player" },
        bodies: [foe],
        tile: 16,
        rng: () => 0,
        accuracyAt: () => 1,
        blocked: (x) => x >= 40
    });
    assert.equal(shot.target, null);
    assert.ok(shot.to.x < 40);
    assert.equal(shot.to.stopped, true);
});

test("a miss cannot hit the body under the aim, and spares a nearby ally", () => {
    const aimed = { id: "aimed", x: 48, y: 0, hitboxSize: 16, faction: "wild" };
    const ally = { id: "ally", x: 20, y: 0, hitboxSize: 16, faction: "player" };
    const far = { id: "far", x: 70, y: 0, hitboxSize: 16, faction: "wild" };
    const rolls = [0.99, 0, 0];
    let i = 0;
    const shot = Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 48,
        aimY: 0,
        shooter: { x: 0, y: 0, faction: "player" },
        bodies: [aimed, ally, far],
        tile: 16,
        rng: () => rolls[Math.min(i++, rolls.length - 1)],
        accuracyAt: () => 0,
        spare: (body) => Ranged.spareAlly({ x: 0, y: 0, faction: "player" }, body, 16)
    });
    assert.equal(shot.hitRoll, false);
    assert.equal(shot.target, far);
});

test("a deliberate aim still selects an ally standing inside the safe pocket", () => {
    const ally = { id: "ally", x: 32, y: 0, hitboxSize: 16, faction: "player" };
    const shot = Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 32,
        aimY: 0,
        shooter: { x: 0, y: 0, faction: "player" },
        bodies: [ally],
        tile: 16,
        rng: () => 0,
        accuracyAt: () => 1,
        spare: (body) => Ranged.spareAlly({ x: 0, y: 0, faction: "player" }, body, 16)
    });
    assert.equal(shot.target, ally);
    assert.equal(Ranged.spareAlly({ x: 0, y: 0, faction: "player" }, ally, 16), true);
});

test("an arrow aimed at a human's head hits the body, not the empty air above the torso circle", () => {
    const human = {
        id: "h",
        kind: "player",
        role: "wanderer",
        x: 48,
        y: 32,
        facing: "left",
        width: 16,
        height: 16,
        hitboxSize: 8,
        bodyCenter() { return { x: this.x + 8, y: this.y - 8 }; }
    };
    const shot = Ranged.release({
        from: { x: 0, y: 18 },
        aimX: 56,
        aimY: 18,
        bodies: [human],
        tile: 16,
        rng: () => 0,
        accuracyAt: () => 1
    });
    assert.equal(shot.aimed, human);
    assert.equal(shot.target, human);
});

test("a body on the ground is an execution up close and half as likely past four tiles", () => {
    assert.equal(Ranged.postureFactor(3, true), Ranged.EXECUTION_FACTOR);
    assert.equal(Ranged.postureFactor(3.5, true), 1);
    assert.equal(Ranged.postureFactor(4, true), 1);
    assert.equal(Ranged.postureFactor(8, true), Ranged.LYING_FACTOR);
    assert.equal(Ranged.postureFactor(1, false), 1);

    const downed = { id: "foe", x: 32, y: 0, hitboxSize: 8, _prone: true };
    const close = Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 32,
        aimY: 0,
        bodies: [downed],
        tile: 16,
        rng: () => 0.5,
        accuracyAt: () => 0.2
    });
    assert.equal(close.tiles, 2);
    assert.equal(close.accuracy, 1);
    assert.equal(close.hitRoll, true);
    assert.equal(close.target, downed);

    const sleeper = { id: "sleep", x: 32, y: 0, hitboxSize: 8, _resting: true };
    const nap = Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 32,
        aimY: 0,
        bodies: [sleeper],
        tile: 16,
        rng: () => 0.9,
        accuracyAt: () => 0.2
    });
    assert.equal(nap.accuracy, 1);
    assert.equal(nap.hitRoll, true);

    const farBody = { id: "far", x: 80, y: 0, hitboxSize: 8, _downed: true };
    const far = Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 80,
        aimY: 0,
        bodies: [farBody],
        tile: 16,
        rng: () => 0.6,
        accuracyAt: () => 1
    });
    assert.equal(far.tiles, 5);
    assert.equal(far.accuracy, 0.5);
    assert.equal(far.hitRoll, false);

    const standing = { id: "up", x: 80, y: 0, hitboxSize: 8 };
    const up = Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 80,
        aimY: 0,
        bodies: [standing],
        tile: 16,
        rng: () => 0.6,
        accuracyAt: () => 1
    });
    assert.equal(up.accuracy, 1);
    assert.equal(up.hitRoll, true);
    assert.equal(up.target, standing);
});

test("pitch black keeps a fifth of the hit chance and daylight keeps all of it", () => {
    const shot = (brightness, roll) => Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 64,
        aimY: 0,
        tile: 16,
        rng: () => roll,
        accuracyAt: () => 0.8,
        brightness
    });
    assert.equal(Ranged.lightFactor(0), 0.2);
    assert.equal(Ranged.lightFactor(1), 1);
    assert.ok(Math.abs(Ranged.lightFactor(0.5) - 0.6) < 1e-9);
    const dark = shot(0, 0.2);
    assert.ok(Math.abs(dark.accuracy - 0.16) < 1e-9, dark.accuracy);
    assert.equal(dark.hitRoll, false);
    const lit = shot(1, 0.5);
    assert.equal(lit.accuracy, 0.8);
    assert.equal(lit.hitRoll, true);
});

test("night on the aim cuts the shot, and a fire there gives the chance back", () => {
    const night = {
        gameMinutes: 0,
        tileSize: 16,
        _chunksNear: () => []
    };
    const loose = (world) => Ranged.release({
        from: { x: 0, y: 0 },
        aimX: 64,
        aimY: 0,
        tile: 16,
        rng: () => 0,
        accuracyAt: () => 0.8,
        world
    });
    const dark = loose(night);
    assert.ok(Math.abs(dark.accuracy - 0.8 * (0.2 + 0.8 * 0.06)) < 0.001, dark.accuracy);
    const day = loose({ ...night, gameMinutes: 12 * 60 });
    assert.ok(Math.abs(day.accuracy - 0.8) < 0.001, day.accuracy);
    const lit = loose({
        ...night,
        getCampfires: () => [{
            x: 64,
            y: 0,
            entry: { id: "campfire", burnRemaining: 5, pitTemp: 600 }
        }]
    });
    assert.ok(lit.accuracy > 0.75, lit.accuracy);
});

test("arrow names carry the stone and the blade grade", () => {
    assert.equal(
        Stone.displayName({ id: "arrow", knapMaterial: "pebble", stone: "andesite", knapQuality: "rough" }),
        "Andesite Arrow (rough)"
    );
    assert.equal(
        Stone.displayName({ id: "arrow", knapMaterial: "flint", knapQuality: "fine" }),
        "Flint Arrow (fine)"
    );
    const bow = (id) => ({
        id,
        name: id === "longbow" ? "Longbow" : "Shortbow",
        quality: true
    });
    assert.equal(Stone.displayName({ id: "shortbow", knapQuality: "crude" }, bow), "Shortbow (crude)");
    assert.equal(Stone.displayName({ id: "longbow", knapQuality: "fine" }, bow), "Longbow (fine)");
});
