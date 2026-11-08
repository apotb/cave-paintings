const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function loadPanelClass() {
    const sandbox = { console };
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(ROOT, "js", "CampfirePanel.js"), "utf8");
    vm.runInContext(source + "\nthis.CampfirePanel = CampfirePanel;\n", sandbox);
    return sandbox.CampfirePanel;
}

function harness(CampfirePanel, { hearthOpen = false, settlementId = null, hearthSettleId = "camp" } = {}) {
    const calls = [];
    const hearth = { entry: { id: "hearth", uid: "stone", settlementId: hearthSettleId } };
    const campfire = { entry: { id: "campfire", uid: "pit" } };
    const panel = Object.create(CampfirePanel.prototype);
    panel.visible = hearthOpen;
    panel.campfire = hearthOpen ? hearth : null;
    panel.scene = {
        simAuth: () => false,
        hideTooltip() {},
        settlementPanel: {
            visible: !!settlementId,
            settle: settlementId ? { id: settlementId } : null
        },
        settlementSys: {
            byStoneUid: () => ({ id: hearthSettleId }),
            byId: () => ({ id: hearthSettleId }),
            openPanel: (settle) => {
                calls.push("open:" + settle.id);
                panel.scene.settlementPanel.visible = true;
                panel.scene.settlementPanel.settle = settle;
            },
            closePanel: () => {
                calls.push("close");
                panel.scene.settlementPanel.visible = false;
                panel.scene.settlementPanel.settle = null;
            }
        }
    };
    panel.open = (target) => {
        calls.push("hearth-open");
        panel.visible = true;
        panel.campfire = target;
    };
    panel.close = () => {
        calls.push("hearth-close");
        panel.visible = false;
        panel.campfire = null;
    };
    return { panel, hearth, campfire, calls };
}

test("clicking a hearth opens its settlement menu", () => {
    const CampfirePanel = loadPanelClass();
    const { panel, hearth, calls } = harness(CampfirePanel);
    panel.toggle(hearth);
    assert.deepEqual(calls, ["hearth-open", "open:camp"]);
    assert.equal(panel.visible, true);
    assert.equal(panel.scene.settlementPanel.visible, true);
});

test("clicking the hearth again closes both menus", () => {
    const CampfirePanel = loadPanelClass();
    const { panel, hearth, calls } = harness(CampfirePanel, {
        hearthOpen: true,
        settlementId: "camp"
    });
    panel.toggle(hearth);
    assert.deepEqual(calls, ["hearth-close", "close"]);
    assert.equal(panel.visible, false);
    assert.equal(panel.scene.settlementPanel.visible, false);
});

test("walking away closes the hearth menu and leaves the settlement menu open", () => {
    const CampfirePanel = loadPanelClass();
    const { panel, hearth } = harness(CampfirePanel, {
        hearthOpen: true,
        settlementId: "camp"
    });
    // Out-of-range update uses close(), not the click toggle.
    delete panel.close;
    panel.container = { setVisible() {} };
    panel.cookBarBg = { clear() {} };
    panel.cookBarFill = { clear() {} };
    hearth.active = true;
    hearth.inRange = () => false;
    panel.update();
    assert.equal(panel.visible, false);
    assert.equal(panel.campfire, null);
    assert.equal(panel.scene.settlementPanel.visible, true);
    assert.equal(panel.scene.settlementPanel.settle.id, "camp");
});

test("closing the settlement menu leaves the hearth menu open", () => {
    const CampfirePanel = loadPanelClass();
    const { panel, calls } = harness(CampfirePanel, {
        hearthOpen: true,
        settlementId: "camp"
    });
    panel.scene.settlementSys.closePanel();
    assert.deepEqual(calls, ["close"]);
    assert.equal(panel.visible, true);
    assert.equal(panel.campfire.entry.id, "hearth");
});

test("a campfire click does not open the settlement menu", () => {
    const CampfirePanel = loadPanelClass();
    const { panel, campfire, calls } = harness(CampfirePanel);
    panel.toggle(campfire);
    assert.deepEqual(calls, ["hearth-open"]);
    assert.equal(panel.scene.settlementPanel.visible, false);
});

test("clicking the hearth again does not close a different settlement", () => {
    const CampfirePanel = loadPanelClass();
    const { panel, hearth, calls } = harness(CampfirePanel, {
        hearthOpen: true,
        settlementId: "other",
        hearthSettleId: "camp"
    });
    panel.toggle(hearth);
    assert.deepEqual(calls, ["hearth-close"]);
    assert.equal(panel.scene.settlementPanel.visible, true);
    assert.equal(panel.scene.settlementPanel.settle.id, "other");
});
