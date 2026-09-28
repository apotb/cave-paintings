const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Content = require("../shared/mods/content");
const Jobs = require("../shared/mods/jobs");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "test", "fixtures", "phase6");

Content.boot({ root: ROOT, modsDir: FIXTURE });
Content.loadSimScripts();

const Settlement = require("../shared/settlement");
const { createTestWorld } = require("./helpers/simWorld");

function offJobs() {
    const jobs = Settlement.defaultJobs();
    for (const id of Settlement.JOBS) jobs[id] = 0;
    return jobs;
}

describe("phase 6 jobs", { concurrency: false }, () => {
    test("registerJob stores plan, perform, and actLabel, and a duplicate names both mods", () => {
        const sweep = Jobs.get("example.sweep.tidy");
        assert.equal(sweep.modId, "example.sweep");
        assert.equal(typeof sweep.plan, "function");
        assert.equal(typeof sweep.perform, "function");
        assert.equal(typeof sweep.actLabel, "function");
        assert.equal(sweep.label, "Sweep");
        const blank = {
            plan() { return null; },
            perform() { return { halt: true }; },
            actLabel() { return "Nope"; }
        };
        assert.throws(
            () => Jobs.registerJob("example.other", { id: "example.sweep.tidy", ...blank }),
            /Duplicate job "example\.sweep\.tidy" \(example\.sweep and example\.other\)/
        );
        assert.throws(
            () => Jobs.registerJob("example.other", { id: "gather", ...blank }),
            /Duplicate job "gather" \(core and example\.other\)/
        );
        assert.equal(Jobs.get("example.sweep.tidy").modId, "example.sweep");
        assert.equal(Jobs.get("gather").modId, "core");
    });

    test("built-in gather is registered and planWork still uses it", () => {
        const gather = Jobs.get("gather");
        assert.equal(gather.modId, "core");
        assert.deepEqual(gather.planTypes, ["gather", "dig"]);
        assert.equal(typeof gather.plan, "function");
        assert.equal(typeof gather.perform, "function");
        assert.equal(typeof gather.actLabel, "function");

        let plans = 0;
        const orig = gather.plan;
        gather.plan = function (state) {
            plans += 1;
            return orig(state);
        };
        const jobs = offJobs();
        jobs.gather = 1;
        const bush = { id: "sticks", uid: "bush1" };
        try {
            const planned = Settlement.planWork({
                kc: 2000,
                jobs,
                gatherThing: bush
            });
            assert.equal(plans, 1);
            assert.equal(planned.type, "gather");
            assert.equal(planned.target, bush);
            const dug = Settlement.planWork({
                kc: 2000,
                jobs,
                digThing: { id: "clay_patch", uid: "clay1" }
            });
            assert.equal(dug.type, "dig");
        } finally {
            gather.plan = orig;
        }

        const saved = Settlement.normalizeJobs({ gather: 1 });
        assert.equal(saved.gather, 1);
        assert.equal(Settlement.jobEnabled(saved, "gather"), true);
        assert.equal(Settlement.normalizeJobs({ gather: 1, madeup: 2 }).madeup, undefined);
        const kept = Settlement.normalizeJobs({ gather: 1, "example.sweep.tidy": 2 });
        assert.equal(kept["example.sweep.tidy"], 2);
        assert.equal(kept.madeup, undefined);

        let harvested = 0;
        let dug = 0;
        assert.equal(gather.perform({
            plan: { type: "gather", target: { uid: "bush1" } },
            runGather() { harvested += 1; return { halt: true }; },
            runDig() { dug += 1; return { halt: true }; }
        }).halt, true);
        assert.equal(gather.perform({
            plan: { type: "dig", target: { uid: "clay1" } },
            runGather() { harvested += 1; return { halt: true }; },
            runDig() { dug += 1; return { halt: true }; }
        }).halt, true);
        assert.equal(harvested, 1);
        assert.equal(dug, 1);

        const ctx = {
            getItem: (id) => ({ stick: { name: "Stick" } }[id]),
            getThing: (id) => ({ sticks: { name: "Sticks", lootable: { item: "stick", yield: 3 } } }[id])
        };
        assert.equal(
            Settlement.actLabel({ type: "gather", target: { id: "sticks" } }, ctx),
            "Gathering stick"
        );
        assert.equal(Settlement.actLabel({ type: "dig" }, ctx), "Digging clay");
        assert.equal(Settlement.jobLabel("gather"), "Get");
    });

    test("a mod job plans, performs, and labels through the settler tick", () => {
        const { world, pawn } = createTestWorld({ worldName: "phase6" });
        world.gameMinutes = 600;
        world.__sweep = true;
        const settle = Settlement.createSettlement({
            x: pawn.x,
            y: pawn.y,
            ownerId: pawn.id
        });
        const rec = world._settlerFromSnap({
            id: "sweeper1",
            name: "Sweeper",
            x: pawn.x,
            y: pawn.y,
            ownerId: pawn.id,
            homeSettlementId: settle.id,
            inventory: [null, null, null, null, null]
        });
        const jobs = offJobs();
        jobs["example.sweep.tidy"] = 1;
        settle.jobs = { [rec.id]: jobs };
        world.settlements.push(settle);
        world.settlers.push(rec);
        const mob = world._ensureSettlerCreature(rec);
        const result = world._tickSettlerWork(mob, 50);
        assert.equal(result.halt, true);
        assert.equal(world.__swept, 1);
        assert.equal(world.__sweepTarget, "yard");
        assert.equal(rec._settlerAct, "Sweeping");
        assert.equal(
            Settlement.actLabel({ type: "example.sweep.tidy" }, {}),
            "Sweeping"
        );
        const before = world.__swept;
        Settlement.actLabel({ type: "example.sweep.tidy" }, {});
        assert.equal(world.__swept, before);

        const net = fs.readFileSync(path.join(ROOT, "js", "net", "NetClient.js"), "utf8");
        const client = fs.readFileSync(path.join(ROOT, "js", "mods", "client.js"), "utf8");
        const server = fs.readFileSync(path.join(ROOT, "server", "index.js"), "utf8");
        assert.equal(net.includes("SettlerWork"), false);
        assert.equal(net.includes("registerJob"), false);
        assert.equal(client.includes("registerJob"), false);
        assert.equal(server.includes("loadSimScripts"), true);
        assert.equal(server.includes("_tickSettlerWork") || fs.readFileSync(path.join(ROOT, "shared", "sim", "SimWorld.js"), "utf8").includes("SettlerWork.tick"), true);
    });
});
