const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/AssignPanel.js"), "utf8") + "\nthis.AssignPanel = AssignPanel;\n",
    sandbox
);

function sheetTextures(keys) {
    const set = new Set(keys);
    return {
        exists: (key) => set.has(key),
        get: (key) => ({
            has: (frame) => set.has(key) && (frame === 0 || frame === 1 || frame === 7
                || frame === "0" || frame === "1" || frame === "7")
        })
    };
}

function panel(keys) {
    const p = Object.create(sandbox.AssignPanel.prototype);
    p.scene = { textures: sheetTextures(keys), uiScale: 1 };
    p.settle = { assigns: {}, policies: {} };
    p._bodyW = 400;
    return p;
}

test("a sleeping settler faces down even when the bed marks them prone", () => {
    const p = panel(["ada-look", "ada-look__lieq1__7"]);
    const pawn = {
        texture: { key: "ada-look__lieq1__7" },
        _lieTexKey: "ada-look__lieq1__7",
        _lieSrcKey: "ada-look",
        _resting: true,
        _prone: true,
        _netProne: true,
        _downed: true,
        isIncapacitated: () => true,
        capacities: { moving: () => 1, isImmobile: () => false }
    };
    const pose = p._portraitPose(pawn);
    assert.equal(pose.key, "ada-look");
    assert.equal(pose.frame, 1);
    assert.equal(pose.rotation, 0);
});

test("a settler lays down only when Moving is at or below 15%", () => {
    const p = panel(["ada-look"]);
    const still = {
        texture: { key: "ada-look" },
        _downed: true,
        capacities: { moving: () => 0.16, isImmobile: () => false }
    };
    const up = p._portraitPose(still);
    assert.equal(up.frame, 1);
    assert.equal(up.rotation, 0);
    const stuck = {
        texture: { key: "ada-look" },
        _resting: true,
        capacities: { moving: () => 0.15, isImmobile: () => true }
    };
    const pose = p._portraitPose(stuck);
    assert.equal(pose.key, "ada-look");
    assert.equal(pose.frame, 7);
    assert.equal(pose.rotation, -Math.PI / 2);
});

test("the assign list rebuilds when Moving drops to immobile", () => {
    const p = panel(["ada-look", "ada-look__lieq1__7"]);
    const cap = { moving: () => 1, isImmobile: () => false };
    const pawn = {
        pawnId: "ada",
        texture: { key: "ada-look__lieq1__7" },
        _lieTexKey: "ada-look__lieq1__7",
        _lieSrcKey: "ada-look",
        _resting: true,
        _netProne: true,
        capacities: cap
    };
    p._people = () => [pawn];
    const asleep = p._signature();
    cap.moving = () => 0.15;
    cap.isImmobile = () => true;
    assert.notEqual(p._signature(), asleep);
});
