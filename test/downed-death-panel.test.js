const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const Party = require("../shared/party.js");
const context = { console, Party };
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/CorpsePanel.js"), "utf8")
        + "\nthis.CorpsePanel = CorpsePanel;\n"
        + fs.readFileSync(path.join(__dirname, "../js/Party.js"), "utf8")
        + "\nthis.PartySystem = PartySystem;\n",
    context
);

vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/BioPanel.js"), "utf8")
        + "\nthis.BioPanel = BioPanel;\n",
    context
);

const { CorpsePanel, PartySystem, BioPanel } = context;

function downedView(over = {}) {
    return {
        active: false,
        lootId: "og",
        x: 40,
        y: 24,
        entry: { downedLiving: true, name: "Og", id: "downed:og" },
        inRange: () => true,
        subjectDied: () => true,
        ...over
    };
}

function corpseAt(over = {}) {
    return {
        active: true,
        x: 40,
        y: 24,
        entry: { name: "Og", id: "c1", sourceUid: "og", loot: [] },
        inRange: () => true,
        ...over
    };
}

function harness(view, corpses, now = 1000) {
    const closed = [];
    const panel = Object.create(CorpsePanel.prototype);
    panel.visible = true;
    panel.corpse = view;
    panel._deathHoldUntil = 0;
    panel.scene = {
        tileSize: 16,
        time: { now },
        corpses: { getChildren: () => corpses },
        netCorpses: null,
        healthPanel: { visible: true },
        bioPanel: { visible: false }
    };
    panel.layout = () => { panel.laidOut = (panel.laidOut || 0) + 1; };
    panel.close = function () {
        closed.push(this.corpse);
        this.visible = false;
        this._deathHoldUntil = 0;
    };
    panel.followOntoCorpse = function (next) {
        this.corpse = next;
        this.followed = next;
        this._deathHoldUntil = 0;
        return true;
    };
    return { panel, closed };
}

test("a death corpse is matched by who died, not a nearer namesake", () => {
    const view = downedView();
    const nearer = corpseAt({ x: 40, y: 24, entry: { name: "Og", id: "other", sourceUid: "someone-else" } });
    const theirs = corpseAt({ x: 80, y: 80, entry: { name: "Og", id: "c-og", sourceUid: "og" } });
    assert.equal(CorpsePanel.findDeathCorpse(view, [nearer, theirs], 16), theirs);
});

test("without an id, the nearest same-name corpse is the body", () => {
    const view = downedView({ lootId: "" });
    const far = corpseAt({ x: 100, y: 100, entry: { name: "Og", id: "far" } });
    const near = corpseAt({ x: 48, y: 24, entry: { name: "Og", id: "near" } });
    const other = corpseAt({ x: 40, y: 24, entry: { name: "Boar", id: "boar" } });
    assert.equal(CorpsePanel.findDeathCorpse(view, [far, other, near], 16), near);
});

test("killing a selected downed enemy keeps the panel on their corpse", () => {
    const view = downedView();
    const body = corpseAt();
    const { panel, closed } = harness(view, [body]);
    panel.update();
    assert.equal(closed.length, 0);
    assert.equal(panel.visible, true);
    assert.equal(panel.followed, body);
    assert.equal(panel.corpse, body);
});

test("the panel waits for the corpse instead of closing the health tab", () => {
    const view = downedView();
    const { panel, closed } = harness(view, [], 5000);
    panel.update();
    assert.equal(closed.length, 0);
    assert.equal(panel.visible, true);
    assert.equal(panel.corpse, view);
    assert.equal(panel.laidOut, 1);

    panel.scene.time.now = 5000 + CorpsePanel.DEATH_HOLD_MS + 1;
    panel.update();
    assert.equal(closed.length, 1);
    assert.equal(panel.visible, false);
});

test("standing up still closes, and leaving range does not wait", () => {
    const stood = downedView({ subjectDied: () => false });
    const stoodRun = harness(stood, []);
    stoodRun.panel.update();
    assert.equal(stoodRun.closed.length, 1);

    const gone = downedView({ inRange: () => false });
    const goneRun = harness(gone, [corpseAt()]);
    goneRun.panel.update();
    assert.equal(goneRun.closed.length, 1);
    assert.equal(goneRun.panel.followed, undefined);
});

test("a still-downed enemy is not swapped onto a nearby corpse", () => {
    const view = downedView({ active: true });
    const { panel, closed } = harness(view, [corpseAt()]);
    panel.update();
    assert.equal(closed.length, 0);
    assert.equal(panel.corpse, view);
    assert.equal(panel.followed, undefined);
});

test("following the corpse retargets health and leaves bio open", () => {
    const bio = {
        visible: true,
        refresh() { this.refreshed = true; }
    };
    let shown = null;
    const panel = Object.create(CorpsePanel.prototype);
    panel.visible = true;
    panel.corpse = downedView();
    panel.scene = { healthPanel: { visible: true }, bioPanel: bio };
    panel.container = { setDepth() {} };
    panel._rebuildSlots = () => {};
    panel.layout = () => {};
    panel.refresh = () => {};
    panel._showCorpseHealth = (opts) => { shown = opts; };
    const body = corpseAt();
    assert.equal(panel.followOntoCorpse(body), true);
    assert.equal(panel.corpse, body);
    assert.equal(shown && shown.retarget, true);
    assert.equal(bio.visible, true);
    assert.equal(bio.refreshed, true);
});

test("a removed downed mob is dead, and standing back up is not", () => {
    const scene = {
        netMobs: new Map(),
        player: { x: 0, y: 0, interactionRange: 4 },
        tileSize: 16,
        simAuth() { return false; }
    };
    const entry = {
        id: "mob1",
        prone: true,
        resting: false,
        dead: false,
        x: 10,
        y: 20,
        name: "Boar",
        inventory: []
    };
    scene.netMobs.set("mob1", entry);
    const sys = new PartySystem(scene);
    const view = sys._downedLootView({
        id: "mob1",
        netMob: true,
        holder: entry,
        name: "Boar",
        sprite: {},
        bodyPlan: "boar"
    });
    assert.equal(view.active, true);
    assert.equal(view.subjectDied(), false);

    entry.prone = false;
    assert.equal(view.active, false);
    assert.equal(view.subjectDied(), false);

    entry.prone = true;
    scene.netMobs.delete("mob1");
    assert.equal(view.active, false);
    assert.equal(view.subjectDied(), true);

    const pawn = {
        active: true,
        x: 0,
        y: 0,
        _downed: true,
        inventory: [],
        isBodyDead() { return this._dead; }
    };
    const person = sys._downedLootView({
        id: "og",
        holder: pawn,
        name: "Og",
        sprite: pawn
    });
    assert.equal(person.active, true);
    assert.equal(person.subjectDied(), false);
    pawn._dead = true;
    assert.equal(person.active, false);
    assert.equal(person.subjectDied(), true);
    pawn._dead = false;
    pawn._downed = false;
    assert.equal(person.subjectDied(), false);
});

test("bio stays on a downed human after their view goes inactive", () => {
    const view = downedView();
    const bio = Object.create(BioPanel.prototype);
    bio.scene = { corpsePanel: { visible: true, corpse: view } };
    assert.equal(bio._selectedCorpse(), view);
});

test("a destroyed downed human keeps the open tab on their corpse", () => {
    context.spriteFrameCenter = (spr) => ({ x: spr.x, y: spr.y });
    const pawn = {
        scene: {},
        x: 400,
        y: 400,
        originX: 0.5,
        originY: 0.5,
        active: true,
        _downed: true,
        _bodyDead: false,
        inventory: [],
        isBodyDead() { return !!this._bodyDead; }
    };
    const player = {
        x: 400,
        y: 400,
        interactionRange: 4,
        bodyCenter: () => ({ x: 408, y: 392 })
    };
    const scene = {
        tileSize: 16,
        player,
        simAuth() { return false; }
    };
    const sys = new PartySystem(scene);
    const view = sys._downedLootView({
        id: "og",
        holder: pawn,
        name: "Og",
        sprite: pawn
    });
    assert.equal(view.x, 400);
    assert.equal(view.y, 400);
    pawn._bodyDead = true;
    pawn.active = false;
    pawn.scene = null;
    pawn.x = 0;
    pawn.y = 0;
    const body = corpseAt({ x: 400, y: 400 });
    const { panel, closed } = harness(view, [body]);
    panel.update();
    assert.equal(closed.length, 0);
    assert.equal(panel.visible, true);
    assert.equal(panel.followed, body);
});

test("killing a followed downed human keeps bio and health open", () => {
    context.Body = class {
        loadJSON() {}
    };
    const pawn = {
        active: true,
        role: "settler",
        _downed: true,
        pawnId: "ada",
        x: 10,
        y: 20,
        displayName: () => "Ada",
        bio: { age: 30 },
        anatomy: {
            planId: "human",
            toJSON() { return { planId: "human" }; }
        },
        isBodyDead() { return true; }
    };
    let inspected = null;
    const scene = {
        focusPawn: pawn,
        player: { pawnId: "me" },
        leader: { pawnId: "me" },
        tileSize: 16,
        time: { now: 1 },
        corpses: { getChildren: () => [] },
        bioPanel: {
            visible: true,
            _selectedCorpse() { return null; },
            pinCorpse(corpse) { this.pinned = corpse; },
            close() { this.visible = false; }
        },
        healthPanel: {
            visible: true,
            isInspecting() { return false; },
            openInspect(_body, title) { inspected = title; this.visible = true; },
            close() { this.visible = false; }
        }
    };
    const sys = new PartySystem(scene);
    sys._preserveDownedInspect(pawn);
    assert.equal(scene._keepDeathPanels, true);
    assert.equal(scene.bioPanel.pinned.entry.name, "Ada");
    assert.equal(inspected, "Ada (downed)");
    sys.clearSettlerFocus();
    assert.equal(scene.focusPawn, null);
    assert.equal(scene.bioPanel.visible, true);
    assert.equal(scene.healthPanel.visible, true);

    const standing = { ...pawn, _downed: false, _prone: false, _netProne: false, _resting: false };
    scene.focusPawn = standing;
    scene._keepDeathPanels = false;
    scene.bioPanel.pinned = null;
    sys._preserveDownedInspect(standing);
    assert.equal(scene._keepDeathPanels, false);
    sys.clearSettlerFocus();
    assert.equal(scene.bioPanel.visible, false);
});
