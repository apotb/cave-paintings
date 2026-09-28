const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Content = require("../shared/mods/content");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "test", "fixtures", "phase7");
const PEBBLES = "example.phase7.pebbles";

Content.boot({ root: ROOT, modsDir: FIXTURE });

const WorldGen = require("../shared/sim/WorldGen");

function thingByUid(chunk) {
    const out = new Map();
    for (const row of chunk.things || []) out.set(row.uid, row);
    return out;
}

describe("phase 7 scatters", { concurrency: false }, () => {
    test("boot registers the fixture scatter and a duplicate names both mods", () => {
        const doc = Content.simDocument().scatters;
        assert.deepEqual(doc, [{
            id: PEBBLES,
            tiles: ["grass"],
            thingId: "rock",
            chance: 1,
            salt: 11
        }]);
        const blank = { tiles: ["grass"], thingId: "rock", chance: 0.5, salt: 3 };
        assert.throws(
            () => WorldGen.addScatter({ id: PEBBLES, ...blank }, "example.other"),
            /Duplicate scatter "example\.phase7\.pebbles" \(example\.phase7 and example\.other\)/
        );
        WorldGen.addScatter({ id: "example.phase7.zeta", ...blank, salt: 4 }, "example.phase7");
        WorldGen.addScatter({ id: "example.phase7.alpha", ...blank, salt: 5 }, "example.alpha");
        assert.deepEqual(
            Content.simDocument().scatters.map((row) => row.id),
            ["example.phase7.alpha", PEBBLES, "example.phase7.zeta"]
        );
    });

    test("the same seed, scatter, and coordinate repeat, and other coordinates do not", () => {
        const seed = 42;
        const salt = 11;
        const tx = 6 * WorldGen.CHUNK_PX;
        const ty = -8 * WorldGen.CHUNK_PX;
        const roll = WorldGen.scatterRoll(tx, ty, seed, salt);
        assert.equal(WorldGen.scatterRoll(tx, ty, seed, salt), roll);
        assert.notEqual(WorldGen.scatterRoll(tx + WorldGen.TS, ty, seed, salt), roll);
        assert.notEqual(WorldGen.scatterRoll(tx, ty + WorldGen.TS, seed, salt), roll);
        assert.notEqual(WorldGen.scatterRoll(tx, ty, seed + 1, salt), roll);
        assert.notEqual(WorldGen.scatterRoll(tx, ty, seed, salt + 1), roll);

        const first = WorldGen.generateChunk(6, -8, seed);
        const second = WorldGen.generateChunk(6, -8, seed);
        assert.deepEqual(second, first);
        const rocks = first.things.filter((row) => row.id === "rock").length;
        assert.ok(rocks > 1);
    });

    test("a mod scatter does not consume the chunk stream or move built-in results", () => {
        const seed = 42;
        assert.equal(WorldGen.removeScatter(PEBBLES), true);
        assert.equal(WorldGen.removeScatter("example.phase7.alpha"), true);
        assert.equal(WorldGen.removeScatter("example.phase7.zeta"), true);
        const plain = WorldGen.generateChunk(6, -8, seed);
        WorldGen.addScatter({
            id: PEBBLES,
            tiles: ["grass"],
            thingId: "rock",
            chance: 1,
            salt: 11
        }, "example.phase7");
        const withScatter = WorldGen.generateChunk(6, -8, seed);
        assert.deepEqual(withScatter.tiles, plain.tiles);
        assert.deepEqual(withScatter.mobs, plain.mobs);
        const plainThings = thingByUid(plain);
        for (const [uid, row] of plainThings) {
            assert.deepEqual(thingByUid(withScatter).get(uid), row);
        }
        assert.ok(withScatter.things.length > plain.things.length);

        WorldGen.removeScatter(PEBBLES);
        const removed = WorldGen.generateChunk(6, -8, seed);
        assert.deepEqual(removed.tiles, plain.tiles);
        assert.deepEqual(removed.mobs, plain.mobs);
        assert.deepEqual(removed.things, plain.things);
        assert.deepEqual(removed.lootableThings, plain.lootableThings);

        WorldGen.addScatter({
            id: "example.phase7.later",
            tiles: ["grass"],
            thingId: "bush",
            chance: 1,
            salt: 99
        }, "example.later");
        WorldGen.addScatter({
            id: "example.phase7.earlier",
            tiles: ["grass"],
            thingId: "tree",
            chance: 1,
            salt: 98
        }, "example.earlier");
        const forward = WorldGen.generateChunk(6, -8, seed);
        const at = new Map();
        forward.things.forEach((row, index) => {
            const key = `${row.x},${row.y}`;
            if (!at.has(key)) at.set(key, {});
            at.get(key)[row.id] = index;
        });
        const both = [...at.values()].find((row) => row.tree != null && row.bush != null);
        assert.ok(both, "both scatters place on a grass tile");
        assert.ok(both.tree < both.bush);
        const again = WorldGen.generateChunk(6, -8, seed);
        assert.deepEqual(again.tiles, forward.tiles);
        assert.deepEqual(again.mobs, forward.mobs);
        assert.deepEqual(again.things, forward.things);

        WorldGen.removeScatter("example.phase7.earlier");
        WorldGen.removeScatter("example.phase7.later");
        WorldGen.addScatter({
            id: "example.phase7.later",
            tiles: ["grass"],
            thingId: "bush",
            chance: 1,
            salt: 99
        }, "example.later");
        WorldGen.addScatter({
            id: "example.phase7.earlier",
            tiles: ["grass"],
            thingId: "tree",
            chance: 1,
            salt: 98
        }, "example.earlier");
        const reversed = WorldGen.generateChunk(6, -8, seed);
        assert.deepEqual(reversed.things, forward.things);
        assert.deepEqual(reversed.mobs, forward.mobs);
        assert.deepEqual(reversed.tiles, forward.tiles);
    });
});
