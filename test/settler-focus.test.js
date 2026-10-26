const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { console };
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/Party.js"), "utf8") + "\nthis.PartySystem = PartySystem;\n",
    context
);

function harness(opts = {}) {
    const settler = {
        active: true,
        role: "settler",
        homeSettlementId: "camp",
        pawnId: "ada",
        x: 10,
        y: 20,
        ownerId: "me",
        displayName: () => "Ada",
        ...opts.settler
    };
    const logs = [];
    const tended = [];
    const fed = [];
    const scene = {
        settlers: [settler],
        party: [{}],
        leader: { ownerId: "me" },
        characterId: "me",
        tileSize: 16,
        player: {
            pawnId: "me",
            getHeldItem: () => opts.held || null,
            beginTend: (p) => { tended.push(p); return true; },
            beginEat: (item, eat) => { fed.push(eat.patient); return true; }
        },
        getItem: (id) => opts.items?.[id] || null,
        input: { hitTestPointer: () => opts.hits || [] },
        _livingSettlerAt: () => (opts.miss ? null : settler),
        _buildingHover: (obj) => !!obj.building,
        _isUiTooltipTarget: (obj) => !!obj.ui,
        combatLog: { push: (line) => logs.push(line) },
        focusPawn: null,
        bioPanel: {
            visible: false,
            _sig: "x",
            open() { this.visible = true; },
            close() { this.visible = false; },
            refresh() { this.refreshed = true; }
        },
        healthPanel: {
            visible: false,
            inspecting: false,
            isInspecting() { return this.inspecting; },
            close() { this.visible = false; this.closed = true; }
        },
        syncs: 0,
        syncCameraToPlayer() { this.syncs += 1; },
        shifts: 0,
        _clearCameraPanelShift() { this.shifts += 1; },
        settlementSys: opts.settlementSys || null
    };
    const sys = new context.PartySystem(scene);
    return { scene, sys, settler, logs, tended, fed };
}

test("clicking a settler on open ground opens their bio and follows them", () => {
    const { scene, sys, settler } = harness();
    const pointer = { downTime: 1 };
    assert.equal(sys.handleSettlerClick(pointer), true);
    assert.equal(scene.focusPawn, settler);
    assert.equal(scene.bioPanel.visible, true);
    assert.equal(scene.syncs, 1);
    assert.equal(sys.handleSettlerClick(pointer), true);
    assert.equal(scene.syncs, 1);
});

test("a station under the body still selects the settler", () => {
    const { scene, sys } = harness({
        hits: [{ active: true, building: true, input: { enabled: true } }]
    });
    assert.ok(sys.settlerOwnsPointer({}));
    assert.equal(sys.handleSettlerClick({ downTime: 2 }), true);
    assert.equal(scene.bioPanel.visible, true);
});

test("a sleeping settler in a hut opens their bio instead of the hut", () => {
    const { scene, sys, settler } = harness({
        settler: { _resting: true },
        hits: [{ active: true, building: true, input: { enabled: true } }],
        miss: true
    });
    scene._pointerOnCreature = (_pointer, pawn) => pawn === settler;
    assert.equal(sys.settlerOwnsPointer({}), settler);
    assert.equal(sys.handleSettlerClick({ downTime: 7 }), true);
    assert.equal(scene.focusPawn, settler);
    assert.equal(scene.bioPanel.visible, true);
});

test("clicking a sleeping party member switches to them", () => {
    const { scene, sys } = harness({ miss: true });
    const ally = {
        active: true,
        role: "companion",
        _resting: true,
        x: 4,
        y: 4,
        displayName: () => "Bo"
    };
    scene.party = [scene.player, ally];
    scene.input.hitTestPointer = () => [
        { active: true, building: true, input: { enabled: true } }
    ];
    scene._pointerOnCreature = (_pointer, pawn) => pawn === ally;
    let switched = null;
    sys.switchControl = (pawn) => {
        switched = pawn;
        return true;
    };
    assert.equal(sys.settlerOwnsPointer({}), null);
    assert.equal(sys.handleSettlerClick({ downTime: 8 }), false);
    assert.equal(sys.tryAllyClick(ally), true);
    assert.equal(switched, ally);
    assert.equal(scene.focusPawn, null);
    assert.equal(scene.bioPanel.visible, false);
});

test("a tree still beats a sleeping settler", () => {
    const { scene, sys } = harness({
        settler: { _resting: true },
        hits: [{ active: true, input: { enabled: true }, meta: { choppable: true } }],
        miss: true
    });
    scene._pointerOnCreature = () => true;
    assert.equal(sys.settlerOwnsPointer({}), null);
    assert.equal(sys.handleSettlerClick({ downTime: 9 }), false);
    assert.equal(scene.focusPawn, null);
});

test("a tree under the body keeps the click", () => {
    const { scene, sys } = harness({
        hits: [{ active: true, input: { enabled: true }, meta: { choppable: true } }]
    });
    assert.equal(sys.settlerOwnsPointer({}), null);
    assert.equal(sys.handleSettlerClick({ downTime: 3 }), false);
    assert.equal(scene.focusPawn, null);
    assert.equal(scene.bioPanel.visible, false);
});

test("bandage and a far bandage attempt beat the bio", () => {
    context.Party = { inInteractRange: () => true, CAP: 6 };
    const near = harness({
        held: { id: "bandage" },
        items: { bandage: { bandage: { channelSeconds: 1 } } }
    });
    assert.equal(near.sys.handleSettlerClick({ downTime: 4 }), true);
    assert.equal(near.tended.length, 1);
    assert.equal(near.scene.bioPanel.visible, false);

    context.Party.inInteractRange = () => false;
    const far = harness({
        held: { id: "bandage" },
        items: { bandage: { bandage: {} } }
    });
    assert.equal(far.sys.handleSettlerClick({ downTime: 5 }), true);
    assert.deepEqual(far.logs, ["Ada is too far away"]);
    assert.equal(far.scene.focusPawn, null);
    delete context.Party;
});

test("an in-range orphan is recruited instead of opened", () => {
    let picked = 0;
    context.Party = { inInteractRange: () => true, CAP: 6 };
    const { scene, sys } = harness({
        settler: { homeSettlementId: null },
        settlementSys: { pickOrphan: () => { picked += 1; return true; } }
    });
    assert.equal(sys.handleSettlerClick({ downTime: 6 }), true);
    assert.equal(picked, 1);
    assert.equal(scene.focusPawn, null);
    delete context.Party;
});

test("closing bio or health releases the follow unless the tabs are swapping", () => {
    const { scene, sys, settler } = harness();
    sys.focusSettler(settler);
    scene._retainFocus = true;
    sys.releaseSettlerFocus();
    assert.equal(scene.focusPawn, settler);

    scene._retainFocus = false;
    sys.releaseSettlerFocus();
    assert.equal(scene.focusPawn, null);
    assert.equal(scene.bioPanel.visible, false);
    assert.ok(scene.syncs >= 2);
});

test("a dead followed settler is dropped without leaving the panel open", () => {
    const { scene, sys, settler } = harness();
    sys.focusSettler(settler);
    settler.isBodyDead = () => true;
    scene.bioPanel.visible = true;
    sys.clearSettlerFocus();
    assert.equal(scene.focusPawn, null);
    assert.equal(scene.bioPanel.visible, false);
});
