const { test } = require("node:test");
const assert = require("node:assert/strict");
const Dig = require("../shared/dig");
const Carry = require("../shared/carry");
const WorldGen = require("../shared/sim/WorldGen");
const { loadDefs, DataStore } = require("./helpers/load");

loadDefs();

test("digFraction and Dig: +4% line", () => {
    const stick = { id: "digging_stick", digPower: 0.04, toolClass: "digger" };
    assert.equal(Dig.digFraction(stick), 0.04);
    assert.equal(Dig.isDigger(stick), true);
    assert.equal(Dig.digPercentLine(stick), "Dig: +4%");
    assert.equal(Dig.digFraction({ id: "stick" }), 0);
    assert.equal(Dig.isDigger({ toolClass: "knife" }), false);
    assert.equal(Dig.isDigAttack({ id: "dig_thrust" }), true);
    assert.equal(Dig.isDigAttack({ def: { id: "dig_thrust" } }), true);
    assert.equal(Dig.isDigAttack({ id: "point_stab" }), false);
});

test("applyDig pays one clay per thrust and finishes in 25 hits", () => {
    const def = { diggable: { item: "clay", yield: 25 } };
    const entry = { id: "clay_patch", digProgress: 0 };
    let total = 0;
    for (let i = 0; i < 24; i++) {
        const r = Dig.applyDig(entry, def, 0.04, 1000);
        assert.equal(r.done, false);
        assert.equal(r.give, 1);
        total += r.give;
        assert.equal(entry.digTaken, total);
        assert.equal(Dig.tooltipName(def, entry), "Clay Deposit");
        assert.equal(Dig.barVisible(entry, 1000 + 500), true);
        assert.equal(Dig.barVisible(entry, 1000 + 4000), false);
    }
    const last = Dig.applyDig(entry, def, 0.04, 2000);
    total += last.give;
    assert.equal(last.give, 1);
    assert.equal(last.done, true);
    assert.equal(total, 25);
    assert.equal(entry.digProgress, 1);
    assert.equal(Dig.stillDiggable(def, entry), false);
});

test("snow pit accrues 2.5 and pays 2 then 3 across 10 thrusts", () => {
    const def = { id: "storage_pit", diggable: { health: 1, yield: 25 } };
    const entry = { id: "storage_pit", fillId: "snow", digProgress: 0 };
    assert.equal(Dig.healthOf(def, entry), 0.4);
    assert.equal(Dig.isDeposit(def), false);
    const gives = [];
    for (let i = 0; i < 10; i++) {
        const r = Dig.applyDig(entry, def, 0.04, 1000);
        gives.push(r.give);
    }
    assert.deepEqual(gives, [2, 3, 2, 3, 2, 3, 2, 3, 2, 3]);
    assert.equal(entry.digTaken, 25);
    assert.equal(entry.digProgress, 1);
});

test("an in-progress pit does not pay the old empty portion", () => {
    const def = { id: "storage_pit", diggable: { health: 1, yield: 25 } };
    const entry = { id: "storage_pit", fillId: "dirt", digProgress: 0.52, digTaken: 0 };
    const r = Dig.applyDig(entry, def, 0.04, 1000);
    assert.equal(entry.digSettled, 13);
    assert.equal(r.give, 1);
    assert.equal(entry.digTaken, 1);
});

test("deposit tooltip only when the held stack has dig power", () => {
    const def = { name: "Clay Deposit", diggable: { item: "clay", yield: 25 } };
    const getItem = (id) => DataStore.getItem(id);
    assert.equal(Dig.depositTooltip(def, {}, { id: "stick" }, getItem), "");
    assert.equal(Dig.depositTooltip(def, {}, { id: "knife" }, getItem), "");
    assert.equal(Dig.depositTooltip(def, {}, null, getItem), "");
    assert.equal(Dig.depositTooltip(def, {}, { id: "digging_stick" }, getItem), "Clay Deposit");
    const damaged = { digTaken: 10, digProgress: 0.4 };
    assert.equal(Dig.depositTooltip(def, damaged, { id: "digging_stick" }, getItem), "Clay Deposit");
    assert.equal(Dig.depositTooltip(def, damaged, { id: "log" }, getItem), "");
});

test("diggable tile uses a 16px hit box even when walkable", () => {
    assert.equal(Dig.hitboxSize(), 16);
    const def = { hitboxSize: 0, diggable: { item: "clay", yield: 25 } };
    assert.equal(Dig.isDiggable(def), true);
    assert.equal(Dig.stillDiggable(def, { id: "clay_patch" }), true);
    assert.equal(Dig.tooltipName({ name: "Clay Deposit", diggable: { yield: 25 } }, {}), "Clay Deposit");
});

test("stumps take half clay health and drop nothing", () => {
    const clay = DataStore.getThing("clay_patch");
    const stump = DataStore.getThing("tree_stump");
    const snow = DataStore.getThing("snow_tree_stump");
    const palm = DataStore.getThing("coconut_tree_stump");
    assert.equal(Dig.healthOf(clay), 1);
    assert.equal(Dig.isDeposit(clay), true);
    assert.equal(Dig.healthOf(stump), 0.4);
    assert.equal(Dig.isDeposit(stump), false);
    assert.equal(Dig.isDiggable(stump), true);
    assert.equal(Dig.healthOf(snow), 0.4);
    assert.equal(Dig.healthOf(palm), 0.4);
    const getItem = (id) => DataStore.getItem(id);
    const stick = { id: "digging_stick" };
    assert.equal(Dig.depositTooltip(stump, {}, stick, getItem), "");
    const entry = { id: "tree_stump", digProgress: 0 };
    const frac = Dig.digFraction(stick, getItem);
    let hits = 0;
    let last = null;
    while (Dig.stillDiggable(stump, entry) && hits < 40) {
        last = Dig.applyDig(entry, stump, frac, 1000);
        hits++;
        assert.equal(last.give, 0);
        assert.equal(Dig.depositTooltip(stump, entry, stick, getItem), "");
    }
    assert.equal(hits, 10);
    assert.equal(last.done, true);
    assert.equal(entry.digProgress, 1);
    assert.equal(Dig.stillDiggable(stump, entry), false);
    const Place = require("../shared/place");
    assert.equal(Place.thingImageLoads(stump).some((l) => l.key === "hole"), false);
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

test("WorldGen clay stays near water and beats flint", () => {
    const seed = 1;
    WorldGen.applySeed(seed);
    const hosts = new Set();
    let clay = 0;
    let grassClay = 0;
    let flintWithClay = 0;
    let dryClay = 0;
    let shoreTiles = 0;
    let clayOnShore = 0;
    const TS = WorldGen.TS;
    const reach = WorldGen.CLAY_WATER_REACH;
    const R = 70;
    const tiles = new Map();
    for (let ix = -R; ix <= R; ix++) {
        for (let iy = -R; iy <= R; iy++) {
            tiles.set(`${ix},${iy}`, WorldGen.generateTileKey(ix * TS, iy * TS, () => 0.01));
        }
    }
    const wet = (ix, iy) => {
        for (let dy = -reach; dy <= reach; dy++) {
            for (let dx = -reach; dx <= reach; dx++) {
                const key = tiles.get(`${ix + dx},${iy + dy}`)?.key;
                if (key === "water" || key === "ice") return true;
            }
        }
        return false;
    };
    for (let ix = -R + reach; ix <= R - reach; ix++) {
        for (let iy = -R + reach; iy <= R - reach; iy++) {
            const t = tiles.get(`${ix},${iy}`);
            const hasClay = (t.things || []).includes("clay_patch");
            const near = wet(ix, iy);
            if (t.key === "grass" && hasClay) grassClay++;
            if (hasClay) {
                clay++;
                hosts.add(t.key);
                if ((t.loot || []).includes("flint")) flintWithClay++;
                if (!near) dryClay++;
            }
            if (near && WorldGen.CLAY_HOST[t.key]) {
                shoreTiles++;
                if (hasClay) clayOnShore++;
            }
        }
    }
    assert.equal(grassClay, 0, "clay must never spawn on grass");
    assert.equal(flintWithClay, 0, "clay overrides flint on the same tile");
    assert.equal(dryClay, 0, "clay must sit within reach of water");
    assert.ok(clay > 20, `expected clay banks near water, got ${clay}`);
    assert.ok(shoreTiles > 0, "need shoreline or gravel tiles");
    for (const k of hosts) {
        assert.ok(WorldGen.CLAY_HOST[k], `clay on unexpected tile ${k}`);
    }
    const frac = clayOnShore / shoreTiles;
    assert.ok(frac > 0.08, `clay should form medium banks on wet host tiles, got ${frac}`);
    assert.ok(frac < 0.75, `clay should not cover every wet host tile, got ${frac}`);

    WorldGen.applySeed(424242);
    let desertClay = 0;
    for (let ix = -40; ix <= 40; ix++) {
        for (let iy = -40; iy <= 40; iy++) {
            const t = WorldGen.generateTileKey(ix * TS, iy * TS, () => 0.01);
            if ((t.things || []).includes("clay_patch")) desertClay++;
        }
    }
    assert.equal(desertClay, 0, "a dry inland sand region must not spawn clay");
});

test("bushes including snow take a quarter of clay health and drop sticks and leaves", () => {
    const getItem = (id) => DataStore.getItem(id);
    const stick = { id: "digging_stick" };
    const frac = Dig.digFraction(stick, getItem);
    const ids = ["bush", "snow_bush", "blueberry_bush"];
    for (const id of ids) {
        const def = DataStore.getThing(id);
        assert.equal(Dig.healthOf(def), 0.2, id);
        assert.equal(Dig.isDeposit(def), false, id);
        assert.equal(Dig.isDiggable(def), true, id);
        assert.equal(Dig.depositTooltip(def, {}, stick, getItem), "");
        const entry = { id, digProgress: 0 };
        let hits = 0;
        let last = null;
        while (Dig.stillDiggable(def, entry) && hits < 40) {
            last = Dig.applyDig(entry, def, frac, 1000);
            hits++;
            assert.equal(last.give, 0);
        }
        assert.equal(hits, 5, id);
        assert.equal(last.done, true, id);
        const drops = Dig.rollDrops(def, () => 0);
        const byId = Object.fromEntries(drops.map((d) => [d.id, d.quantity]));
        assert.equal(byId.stick, 3, id);
        assert.equal(byId.leaf, 8, id);
        assert.equal(byId.log, undefined, id);
        if (id === "blueberry_bush") assert.equal(byId.blueberry, 5);
        else assert.equal(byId.blueberry, undefined, id);
        const Place = require("../shared/place");
        assert.equal(Place.thingImageLoads(def).some((l) => l.key === "hole"), false, id);
    }
});

test("grub_nest loads as a two-frame sheet and does not queue the hole", () => {
    const fs = require("fs");
    const path = require("path");
    const Place = require("../shared/place");
    const def = DataStore.getThing("grub_nest");
    assert.equal(def.anim.frameWidth, 16);
    assert.equal(def.anim.frameHeight, 16);
    assert.equal(def.anim.frameRate, 2);
    assert.equal(def.anim.repeat, -1);
    const png = fs.readFileSync(path.join(__dirname, "../assets/things/grub_nest.png"));
    assert.equal(png.readUInt32BE(16), 32);
    assert.equal(png.readUInt32BE(20), 16);
    const loads = Place.thingImageLoads(def);
    const sheet = loads.find((l) => l.key === "grub_nest");
    assert.equal(sheet.spritesheet, true);
    assert.equal(sheet.frameWidth, 16);
    assert.equal(sheet.frameHeight, 16);
    assert.equal(loads.some((l) => l.key === "hole"), false);
});

test("clay_patch loads the hole overlay sprite", () => {
    const Place = require("../shared/place");
    const def = DataStore.getThing("clay_patch");
    const loads = Place.thingImageLoads(def);
    assert.ok(loads.some((l) => l.key === "clay_patch"));
    assert.ok(loads.some((l) => l.key === "hole" && l.path === "assets/things/hole.png"));
});
