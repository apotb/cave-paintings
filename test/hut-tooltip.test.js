const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function loadHut() {
    const sandbox = {
        console,
        Phaser: { Physics: { Arcade: { Sprite: class Sprite {} } } },
        Place: require("../shared/place"),
        Needs: require("../shared/needs")
    };
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(ROOT, "js", "Thing.js"), "utf8")
        + "\nthis.Hut = Hut;\nthis.LeanTo = LeanTo;\n";
    vm.runInContext(source, sandbox);
    return sandbox;
}

function sheet() {
    return { has: (frame) => frame === 0 || frame === 1 || frame === "1" };
}

function makeHut(people) {
    const sandbox = loadHut();
    const scene = {
        tileSize: 16,
        party: people.party || [],
        settlers: people.settlers || [],
        player: people.player || null,
        partySys: { wanderers: people.wanderers || [] },
        remotePlayers: { values: () => people.remotes || [] },
        textures: {
            exists: (key) => String(key).endsWith("-look") || key === "human",
            get: () => sheet()
        }
    };
    const hut = Object.create(sandbox.Hut.prototype);
    hut.scene = scene;
    hut.active = true;
    hut.meta = {
        name: "Hut",
        footprint: [2, 2],
        sleep: { restEffectiveness: 1, slots: 4, interior: true }
    };
    hut.entry = {
        uid: "hut-1",
        tx: 0,
        ty: 0,
        rot: 0,
        occupants: people.occupants || [null, null, null, null]
    };
    return { sandbox, hut };
}

function pawn(id, name, x, y, extra) {
    return {
        pawnId: id,
        active: true,
        x,
        y,
        width: 16,
        height: 16,
        texture: { key: `${id}-look` },
        displayName: () => name,
        ...extra
    };
}

test("an empty hut names the shelter and does not say Empty", () => {
    const { hut } = makeHut({});
    const tip = hut.tooltipText();
    assert.equal(tip, "Hut\nRest effectiveness: 100%");
    assert.equal(String(tip).includes("Empty"), false);
});

test("a hut lists people sleeping in it, portrait then name, not anyone standing there", () => {
    const ada = pawn("ada", "Ada", 80, 80, {
        _lieTexKey: "ada-lie",
        _lieSrcKey: "ada-look",
        texture: { key: "ada-lie" },
        _resting: true,
        lastSleep: { uid: "hut-1", slot: 0 }
    });
    const bo = pawn("bo", "Bo", 90, 90, {
        _resting: true,
        lastSleep: { uid: "hut-1", slot: 2 }
    });
    const cal = pawn("cal", "Cal", 8, 16);
    const dee = pawn("dee", "Dee", 80, 16);
    const gone = pawn("dead", "Gone", 8, 16, {
        isBodyDead: () => true,
        _resting: true,
        lastSleep: { uid: "hut-1", slot: 3 }
    });
    const nap = pawn("nap", "Nap", 100, 100, {
        _resting: true,
        lastSleep: { uid: "hut-1", slot: 2 }
    });
    const other = pawn("other", "Other", 100, 100, {
        _resting: true,
        lastSleep: { uid: "hut-2", slot: 0 }
    });
    const woke = pawn("woke", "Woke", 8, 16, {
        lastSleep: { uid: "hut-1", slot: 1 }
    });
    const ren = {
        id: "ren",
        x: 8,
        y: 16,
        width: 16,
        height: 16,
        displayName: "Ren",
        resting: true,
        lastSleep: { uid: "hut-1", slot: 1 },
        spr: { texture: { key: "ren-look" } }
    };
    const { hut } = makeHut({
        occupants: ["ada", "woke", "bo", "dead"],
        party: [ada, bo, cal, dee, gone, nap, other, woke],
        remotes: [ren]
    });
    const tip = hut.tooltipText();
    const lines = Array.from(tip.lines, (line) => ({
        label: line.label,
        icon: line.icon,
        frame: line.frame
    }));
    assert.equal(tip.text, "Hut\nRest effectiveness: 100%");
    assert.deepEqual(lines.map((line) => line.label), ["Ada", "Bo", "Nap", "Ren"]);
    assert.deepEqual(lines.map((line) => line.icon), [
        "ada-look", "bo-look", "nap-look", "ren-look"
    ]);
    assert.deepEqual(lines.map((line) => line.frame), [1, 1, 1, 1]);
    assert.equal(JSON.stringify(tip).includes("Empty"), false);
    assert.equal(JSON.stringify(tip).includes("Cal"), false);
    assert.equal(JSON.stringify(tip).includes("Dee"), false);
    assert.equal(JSON.stringify(tip).includes("Gone"), false);
    assert.equal(JSON.stringify(tip).includes("Other"), false);
    assert.equal(JSON.stringify(tip).includes("Woke"), false);
});

function makeLean(people) {
    const { sandbox } = makeHut({});
    const lean = Object.create(sandbox.LeanTo.prototype);
    lean.scene = {
        tileSize: 16,
        party: people.party || [],
        settlers: [],
        player: null,
        partySys: { wanderers: [] },
        remotePlayers: { values: () => [] },
        textures: {
            exists: (key) => String(key).endsWith("-look") || key === "human",
            get: () => sheet()
        }
    };
    lean.active = true;
    lean.meta = {
        name: "Lean-to",
        footprint: [2, 1],
        sleep: { restEffectiveness: 0.95, slots: 2 }
    };
    lean.entry = {
        uid: "lean-1",
        tx: 0,
        ty: 0,
        rot: 0,
        occupants: people.occupants || [null, null]
    };
    return lean;
}

test("an empty lean-to names the shelter and does not say Empty", () => {
    const tip = makeLean({}).tooltipText();
    assert.equal(tip, "Lean-to\nRest effectiveness: 95%");
    assert.equal(String(tip).includes("Empty"), false);
});

test("a lean-to lists people sleeping on it, portrait then name, not anyone standing there", () => {
    const ada = pawn("ada", "Ada", 80, 80, {
        _resting: true,
        lastSleep: { uid: "lean-1", slot: 0 }
    });
    const bo = pawn("bo", "Bo", 90, 90, {
        _resting: true,
        lastSleep: { uid: "lean-1", slot: 1 }
    });
    const cal = pawn("cal", "Cal", 8, 14);
    const dee = pawn("dee", "Dee", 8, 40);
    const lean = makeLean({
        occupants: ["ada", "bo"],
        party: [ada, bo, cal, dee]
    });
    const tip = lean.tooltipText();
    const lines = Array.from(tip.lines, (line) => ({
        label: line.label,
        icon: line.icon,
        frame: line.frame
    }));
    assert.equal(tip.text, "Lean-to\nRest effectiveness: 95%");
    assert.deepEqual(lines.map((line) => line.label), ["Ada", "Bo"]);
    assert.deepEqual(lines.map((line) => line.icon), ["ada-look", "bo-look"]);
    assert.deepEqual(lines.map((line) => line.frame), [1, 1]);
    assert.equal(JSON.stringify(tip).includes("Empty"), false);
    assert.equal(JSON.stringify(tip).includes("Cal"), false);
    assert.equal(JSON.stringify(tip).includes("Dee"), false);
});

function loadHud() {
    const sandbox = {
        console,
        PIXEL_UI_FONT: "font",
        pixelUiFontSize: (n) => n,
        crispUiText: (t) => t
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "scene", "hud.js"), "utf8"), sandbox);
    return sandbox.SceneMainHud;
}

test("a person row draws that portrait frame beside the name", () => {
    const hud = loadHud();
    const images = [];
    const scene = {
        uiScale: 1,
        _tooltipPadding: 6,
        _tooltipGearSig: null,
        textures: {
            exists: () => true,
            get: () => sheet()
        },
        tooltipGear: { add() {}, removeAll() {} },
        add: {
            image(_x, _y, key, frame) {
                const img = {
                    key,
                    frame,
                    setOrigin() { return img; },
                    setDisplaySize() { return img; }
                };
                images.push(img);
                return img;
            },
            text() {
                return {
                    text: "",
                    displayWidth: 20,
                    setOrigin() { return this; },
                    setPosition() { return this; },
                    setVisible() { return this; }
                };
            }
        }
    };
    Object.assign(scene, hud);
    scene._syncTooltipLines([
        { icon: "ada-look", frame: 1, label: "Ada" },
        { icon: "plain", label: "Bo" }
    ]);
    assert.equal(images.length, 2);
    assert.equal(images[0].key, "ada-look");
    assert.equal(images[0].frame, 1);
    assert.equal(images[1].key, "plain");
    assert.equal(images[1].frame, undefined);
});
