const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createTestWorld } = require("./helpers/simWorld");
const { loadDefs, bodyCtx } = require("./helpers/load");
const { Body } = require("../shared/body/Body");
const Settlement = require("../shared/settlement");

loadDefs();

function injurySeverities(body) {
    const found = [];
    const walk = (node) => {
        if (!node || typeof node !== "object") return;
        for (const inj of node.injuries || []) found.push(Number(inj.severity) || 0);
        if (node.core) walk(node.core);
        for (const limb of Object.values(node.limbs || {})) walk(limb);
    };
    walk(body);
    return found;
}

test("a parked settler's wounds shrink and YOU carries the new severity", () => {
    const { world, pawn } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    const rec = world._settlerFromSnap({
        id: "settler1",
        name: "Parked",
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        inventory: [null, null, null, null, null]
    });
    world.settlements.push(settle);
    world.settlers.push(rec);
    const cc = world._ensureSettlerCreature(rec);
    const part = cc.anatomy.part("Left Arm");
    part.injure({
        id: "cut",
        name: "Cut",
        severity: 20,
        bleeding: false,
        bleedRate: 0,
        tended: false,
        permanent: false
    });
    world._youDirty.clear();
    for (let i = 0; i < 100; i++) world._worldMinute();
    assert.ok(part.injuries[0].severity < 20);
    assert.equal(world._youDirty.has(pawn.id), true);
    const row = (world.youPayload(pawn.id).settlers || []).find((s) => s.id === "settler1");
    const sev = injurySeverities(row.body);
    assert.equal(sev.length, 1);
    assert.ok(sev[0] < 20);
    assert.ok(Math.abs(sev[0] - part.injuries[0].severity) < 1e-9);
});

test("the health tab body follows a healed settler YOU", () => {
    const context = { console };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, "../js/scene/session.js"), "utf8"),
        context
    );
    const { SceneMainSession } = context;
    const shown = new Body(bodyCtx(), "human", {});
    const sim = new Body(bodyCtx(), "human", {});
    const arm = sim.part("Left Arm");
    arm.injure({
        id: "cut",
        name: "Cut",
        severity: 6,
        bleeding: false,
        bleedRate: 0,
        permanent: false
    });
    const pawn = { pawnId: "settler1", anatomy: shown, role: "settler" };
    let refreshed = 0;
    const scene = {
        healthPanel: {
            visible: true,
            isInspecting: () => false,
            _subjectPawn: () => pawn,
            refresh: () => { refreshed += 1; }
        }
    };
    const body = sim.toJSON();
    assert.equal(SceneMainSession._applyNetBody.call(scene, pawn, body), true);
    assert.equal(injurySeverities(shown.toJSON())[0], 6);
    assert.equal(refreshed, 1);
    assert.equal(SceneMainSession._applyNetBody.call(scene, pawn, body), false);
    assert.equal(refreshed, 1);
});
