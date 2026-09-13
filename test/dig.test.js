const { test } = require("node:test");
const assert = require("node:assert/strict");
const Dig = require("../shared/dig");
const Carry = require("../shared/carry");
const WorldGen = require("../shared/sim/WorldGen");
const { loadDefs, DataStore } = require("./helpers/load");

loadDefs();

test("digFraction and Dig: +5% line", () => {
    const stick = { id: "digging_stick", digPower: 0.05, toolClass: "digger" };
    assert.equal(Dig.digFraction(stick), 0.05);
    assert.equal(Dig.isDigger(stick), true);
    assert.equal(Dig.digPercentLine(stick), "Dig: +5%");
    assert.equal(Dig.digFraction({ id: "stick" }), 0);
    assert.equal(Dig.isDigger({ toolClass: "knife" }), false);
    assert.equal(Dig.isDigAttack({ id: "dig_thrust" }), true);
    assert.equal(Dig.isDigAttack({ def: { id: "dig_thrust" } }), true);
    assert.equal(Dig.isDigAttack({ id: "point_stab" }), false);
});

test("applyDig merge-yields round(25 * progress) and finishes in 20 hits", () => {
    const def = { diggable: { item: "clay", yield: 25 } };
    const entry = { id: "clay_patch", digProgress: 0 };
    let total = 0;
    for (let i = 0; i < 19; i++) {
        const r = Dig.applyDig(entry, def, 0.05, 1000);
        assert.equal(r.done, false);
        total += r.give;
        assert.equal(entry.digTaken, total);
        assert.equal(Dig.tooltipName(def, entry), `Clay Deposit (${25 - total}/25)`);
        assert.equal(Dig.barVisible(entry, 1000 + 500), true);
        assert.equal(Dig.barVisible(entry, 1000 + 4000), false);
    }
    const last = Dig.applyDig(entry, def, 0.05, 2000);
    total += last.give;
    assert.equal(last.done, true);
    assert.equal(total, 25);
    assert.equal(entry.digProgress, 1);
    assert.equal(Dig.stillDiggable(def, entry), false);
});

test("deposit tooltip only when the held stack has dig power", () => {
    const def = { name: "Clay Deposit", diggable: { yield: 25 } };
    const getItem = (id) => DataStore.getItem(id);
    assert.equal(Dig.depositTooltip(def, {}, { id: "stick" }, getItem), "");
    assert.equal(Dig.depositTooltip(def, {}, { id: "knife" }, getItem), "");
    assert.equal(Dig.depositTooltip(def, {}, null, getItem), "");
    assert.equal(Dig.depositTooltip(def, {}, { id: "digging_stick" }, getItem), "Clay Deposit");
    const damaged = { digTaken: 10, digProgress: 0.4 };
    assert.equal(Dig.depositTooltip(def, damaged, { id: "digging_stick" }, getItem), "Clay Deposit (15/25)");
    assert.equal(Dig.depositTooltip(def, damaged, { id: "log" }, getItem), "");
});

test("diggable tile uses a 16px hit box even when walkable", () => {
    assert.equal(Dig.hitboxSize(), 16);
    const def = { hitboxSize: 0, diggable: { item: "clay", yield: 25 } };
    assert.equal(Dig.isDiggable(def), true);
    assert.equal(Dig.stillDiggable(def, { id: "clay_patch" }), true);
    assert.equal(Dig.tooltipName({ name: "Clay Deposit", diggable: { yield: 25 } }, {}), "Clay Deposit");
});

test("REQUIRE_TOOL accepts knife or scraper", () => {
    const rt = Carry.parseRequireTool({ toolClass: ["knife", "scraper"], wear: 5 });
    assert.deepEqual(rt.toolClasses, ["knife", "scraper"]);
    assert.equal(rt.toolClass, "knife");
    assert.equal(rt.wear, 5);
    assert.equal(Carry.heldMatchesRecipeTool({ toolClass: "knife" }, null, rt), true);
    assert.equal(Carry.heldMatchesRecipeTool({ toolClass: "scraper" }, null, rt), true);
    assert.equal(Carry.heldMatchesRecipeTool({ toolClass: "awl" }, null, rt), false);
    const single = Carry.parseRequireTool({ toolClass: "knife", wear: 5 });
    assert.deepEqual(single.toolClasses, ["knife"]);
    assert.equal(Carry.heldMatchesRecipeTool({ toolClass: "knife" }, null, single), true);
});

test("digging stick stays 0.9 kg with weightFixed", () => {
    const item = DataStore.getItem("digging_stick");
    assert.equal(item.weight, 0.9);
    assert.equal(item.weightFixed, true);
    const log = DataStore.getItem("log");
    assert.equal(log.weight, 2);
});

test("WorldGen clay banks sit on gravel sand snow_beach and beat flint", () => {
    const seed = 424242;
    WorldGen.applySeed(seed);
    const hosts = new Set();
    let clay = 0;
    let grassClay = 0;
    let flintWithClay = 0;
    let hostTiles = 0;
    let clayOnHost = 0;
    const TS = WorldGen.TS;
    for (let ix = -80; ix <= 80; ix++) {
        for (let iy = -80; iy <= 80; iy++) {
            const tx = ix * TS;
            const ty = iy * TS;
            const t = WorldGen.generateTileKey(tx, ty, () => 0.01);
            const hasClay = (t.things || []).includes("clay_patch");
            if (t.key === "grass" && hasClay) grassClay++;
            if (hasClay) {
                clay++;
                hosts.add(t.key);
                if ((t.loot || []).includes("flint")) flintWithClay++;
            }
            if (WorldGen.CLAY_HOST[t.key]) {
                hostTiles++;
                if (hasClay) clayOnHost++;
            }
        }
    }
    assert.equal(grassClay, 0, "clay must never spawn on grass");
    assert.equal(flintWithClay, 0, "clay overrides flint on the same tile");
    assert.ok(clay > 20, `expected medium clay banks, got ${clay}`);
    assert.ok(hostTiles > 0, "need host shoreline/gravel tiles");
    for (const k of hosts) {
        assert.ok(WorldGen.CLAY_HOST[k], `clay on unexpected tile ${k}`);
    }
    assert.ok(clayOnHost / hostTiles > 0.08, "clay should form medium banks on host tiles");
    assert.ok(clayOnHost / hostTiles < 0.75, "clay should not cover every host tile");
});

test("clay_patch loads the hole overlay sprite", () => {
    const Place = require("../shared/place");
    const def = DataStore.getThing("clay_patch");
    const loads = Place.thingImageLoads(def);
    assert.ok(loads.some((l) => l.key === "clay_patch"));
    assert.ok(loads.some((l) => l.key === "hole" && l.path === "assets/things/hole.png"));
});
