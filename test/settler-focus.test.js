const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { console, performance };
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

function followHarness(opts = {}) {
    const base = harness({ held: opts.held, items: opts.items });
    const { scene, sys, settler } = base;
    const tended = [];
    const fed = [];
    const leader = {
        active: true,
        role: "leader",
        pawnId: "lead",
        pawnName: "Ash",
        displayName: () => "Ash"
    };
    const mate = {
        active: true,
        role: "companion",
        pawnId: "bo",
        pawnName: "Bo",
        displayName: () => "Bo"
    };
    const care = (pawn) => {
        pawn.getHeldItem = () => opts.held || null;
        pawn.beginTend = (p) => { tended.push(p); return true; };
        pawn.beginEat = (_item, eat) => { fed.push(eat.patient); return true; };
    };
    care(leader);
    care(mate);
    leader.isControlled = () => scene.player === leader;
    mate.isControlled = () => scene.player === mate;
    scene.leader = leader;
    scene.player = opts.asMate ? mate : leader;
    scene.party = [leader, mate];
    scene.simAuth = () => false;
    scene._followFocusedSettler = true;
    scene.focusPawn = settler;
    scene.bioPanel.visible = true;
    scene.bioPanel.refreshed = false;
    scene.healthPanel.visible = true;
    scene.healthPanel.refreshed = false;
    scene.healthPanel.refresh = () => { scene.healthPanel.refreshed = true; };
    scene._pointerOnCreature = (_pointer, pawn) => pawn === (opts.hit || leader);
    scene.statsPanel = {
        visible: !!opts.stats,
        pawn: opts.stats ? settler : null,
        open(pawn) { this.pawn = pawn; this.visible = true; }
    };
    return { scene, sys, settler, leader, mate, tended, fed };
}

test("camera follow hides the settler tag and crowns the leader", () => {
    const { sys, settler, leader, mate } = followHarness();
    assert.equal(sys.nameViewpoint(), settler);
    assert.equal(sys.nameTagHidden(settler), true);
    assert.equal(sys.nameTagHidden(leader), false);
    assert.equal(sys.showLeaderCrown(leader), true);
    assert.equal(sys.nameTagHidden(mate), false);
    assert.equal(sys.showLeaderCrown(mate), false);
});

test("camera follow shows the companion you still control", () => {
    const { sys, settler, leader, mate } = followHarness({ asMate: true });
    assert.equal(sys.nameViewpoint(), settler);
    assert.equal(sys.nameTagHidden(mate), false);
    assert.equal(sys.nameTagHidden(settler), true);
    assert.equal(sys.showLeaderCrown(leader), true);
});

test("releasing the camera restores name tags while the sheet stays", () => {
    const { scene, sys, settler, leader } = followHarness();
    scene._followFocusedSettler = false;
    assert.equal(scene.focusPawn, settler);
    assert.equal(sys.nameViewpoint(), leader);
    assert.equal(sys.nameTagHidden(leader), true);
    assert.equal(sys.showLeaderCrown(leader), false);
    assert.equal(sys.nameTagHidden(settler), false);
});

test("clicking the crowned leader switches to them and keeps the sheets open", () => {
    const { scene, sys, leader } = followHarness({ asMate: true, stats: true });
    assert.equal(sys.tryLeaderFollowClick({ downTime: 11 }), true);
    assert.equal(scene.player, leader);
    assert.equal(scene.focusPawn, null);
    assert.equal(scene._followFocusedSettler, false);
    assert.equal(scene.bioPanel.visible, true);
    assert.equal(scene.healthPanel.visible, true);
    assert.equal(scene.bioPanel.refreshed, true);
    assert.equal(scene.healthPanel.refreshed, true);
    assert.equal(scene.bioPanel._sig, "");
    assert.equal(scene.statsPanel.pawn, leader);
    assert.equal(sys.tryLeaderFollowClick({ downTime: 11 }), true);
    assert.equal(scene.player, leader);
});

test("a bandage click on the crowned leader does not switch", () => {
    context.Party = { inInteractRange: () => true };
    const { scene, sys, mate, tended } = followHarness({
        asMate: true,
        held: { id: "bandage" },
        items: { bandage: { bandage: {} } }
    });
    assert.equal(sys.tryLeaderFollowClick({ downTime: 12 }), true);
    assert.equal(scene.player, mate);
    assert.equal(tended.length, 1);
    assert.equal(scene.focusPawn, null);
    assert.equal(scene.bioPanel.visible, true);
    assert.equal(scene.healthPanel.visible, true);
    delete context.Party;
});

test("a force-feed click on the crowned leader does not switch", () => {
    context.Party = { inInteractRange: () => true };
    const { scene, sys, leader, mate, fed } = followHarness({
        asMate: true,
        held: { id: "meat", food: { kc: 10 } }
    });
    leader._downed = true;
    assert.equal(sys.tryLeaderFollowClick({ downTime: 16 }), true);
    assert.equal(scene.player, mate);
    assert.equal(fed[0], leader);
    assert.equal(scene.focusPawn, null);
    assert.equal(scene.bioPanel.visible, true);
    delete context.Party;
});

test("clicking the leader you already control only returns the sheet", () => {
    const { scene, sys, leader } = followHarness();
    const handlers = {};
    scene.input.on = (ev, fn) => { handlers[ev] = fn; };
    sys._pointerBound = false;
    sys._bindWorldPointer();
    let formed = 0;
    scene.clayFormingPanel = {
        visible: false,
        canOpenHeld: () => true,
        tryOpen() { formed += 1; return true; }
    };
    scene.player.getHeldItem = () => ({ id: "clay", quantity: 1 });
    handlers.pointerdown({ downTime: 13 });
    assert.equal(formed, 0);
    assert.equal(scene.player, leader);
    assert.equal(scene.focusPawn, null);
    assert.equal(scene._followFocusedSettler, false);
    assert.equal(scene.bioPanel.visible, true);
    assert.equal(scene.healthPanel.visible, true);
});
