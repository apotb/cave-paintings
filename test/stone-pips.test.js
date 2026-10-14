const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadSystem() {
    const sandbox = { console, Party: { COLOR_SETTLER: "#7ec8ff" } };
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(__dirname, "../js/Settlement.js"), "utf8");
    vm.runInContext(`${src}\nthis.SettlementSystem = SettlementSystem;`, sandbox);
    return sandbox.SettlementSystem;
}

function makeScene(extra = {}) {
    const created = [];
    const scene = {
        characterId: "me",
        tileSize: 16,
        uiScale: 1,
        cameras: {
            main: {
                worldView: { x: 0, y: 0 },
                zoom: 1,
                width: 800,
                height: 600,
                x: 0,
                y: 0
            }
        },
        uiLayer: { add() {} },
        add: {
            triangle(_x, _y, _x1, _y1, _x2, _y2, _x3, _y3, color, alpha) {
                const pip = {
                    color,
                    alpha,
                    visible: true,
                    x: 0,
                    y: 0,
                    rot: 0,
                    scale: 1,
                    dead: false,
                    setScrollFactor() { return pip; },
                    setDepth() { return pip; },
                    setVisible(v) { pip.visible = v; return pip; },
                    setPosition(x, y) { pip.x = x; pip.y = y; return pip; },
                    setRotation(r) { pip.rot = r; return pip; },
                    setScale(s) { pip.scale = s; return pip; },
                    destroy() { pip.dead = true; }
                };
                created.push(pip);
                return pip;
            }
        },
        ...extra
    };
    return { scene, created };
}

test("offscreen owned settling stones get a settler-blue edge arrow", () => {
    const SettlementSystem = loadSystem();
    const { scene, created } = makeScene();
    const sys = new SettlementSystem(scene);
    sys.list = [
        { id: "mine", ownerId: "me", x: 5000, y: 5000 },
        { id: "theirs", ownerId: "other", x: -4000, y: 200 }
    ];
    sys.updateStonePips();
    assert.equal(created.length, 1);
    assert.equal(created[0].visible, true);
    assert.equal(created[0].color, 0x7ec8ff);
    assert.equal(created[0].alpha, 0.9);
    assert.ok(created[0].y > 560, "arrow sits on the bottom edge");
    assert.ok(created[0].x > 400 && created[0].x < 788);
});

test("an on-screen stone hides its arrow, and a solo player still sees far ones", () => {
    const SettlementSystem = loadSystem();
    const { scene, created } = makeScene();
    scene.party = [{ pawnId: "only-me" }];
    scene.partyPanel = { visible: false };
    const sys = new SettlementSystem(scene);
    sys.list = [
        { id: "here", ownerId: "me", x: 400, y: 300 },
        { id: "west", ownerId: "me", x: -2000, y: 300 }
    ];
    sys.updateStonePips();
    assert.equal(created.length, 2);
    assert.equal(created[0].visible, false);
    assert.equal(created[1].visible, true);
    assert.ok(created[1].x < 40, "west stone pins the arrow to the left edge");
});

test("losing a settlement removes its arrow", () => {
    const SettlementSystem = loadSystem();
    const { scene, created } = makeScene();
    const sys = new SettlementSystem(scene);
    sys.list = [{ id: "mine", ownerId: "me", x: 5000, y: 100 }];
    sys.updateStonePips();
    sys.list = [];
    sys.updateStonePips();
    assert.equal(created[0].dead, true);
    assert.equal(sys._stonePips.length, 0);
});

test("arrows stay hidden while the world is still booting", () => {
    const SettlementSystem = loadSystem();
    const { scene, created } = makeScene({ _worldBooting: true });
    const sys = new SettlementSystem(scene);
    sys.list = [{ id: "mine", ownerId: "me", x: 5000, y: 5000 }];
    sys.updateStonePips();
    assert.equal(created.length, 0);
});
