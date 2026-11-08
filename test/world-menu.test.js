const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function loadWorldMenus() {
    const sandbox = {};
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(ROOT, "js", "scene", "world.js"), "utf8");
    vm.runInContext(source, sandbox);
    const api = sandbox.SceneMainWorld || sandbox.globalThis?.SceneMainWorld;
    assert.ok(api?.closeOtherWorldMenus, "world menu helpers loaded");
    return api;
}

const menus = loadWorldMenus();

function harness() {
    const scene = {
        _craftFromStation: false,
        _craftStationThing: null,
        _rockStationThing: null,
        equipmentPanel: { visible: true, closed: false, close() { this.closed = true; this.visible = false; } },
        closedCraft: 0,
        closedRock: 0
    };
    scene.registerWorldMenu = menus.registerWorldMenu;
    scene.closeOtherWorldMenus = menus.closeOtherWorldMenus;
    scene._closeForeignSideMenus = menus._closeForeignSideMenus;
    scene.closeCraftStationMenu = function () {
        this.closedCraft += 1;
        this._craftFromStation = false;
        this._craftStationThing = null;
    };
    scene._closeRockStation = function () {
        this.closedRock += 1;
        this._rockStationThing = null;
    };
    const side = (thing) => ({
        visible: !!thing,
        thing: thing || null,
        close() {
            this.visible = false;
            this.thing = null;
        }
    });
    scene.billsPanel = side(null);
    scene.storageFilterPanel = side(null);
    scene.fuelFilterPanel = side(null);
    scene.pigmentFilterPanel = side(null);

    const panel = (name) => {
        const p = {
            name,
            visible: false,
            scene,
            close() {
                this.visible = false;
                this.closed = (this.closed || 0) + 1;
            },
            open(thing) {
                this.scene.closeOtherWorldMenus(this, thing);
                this.subject = thing;
                this.visible = true;
            }
        };
        scene.registerWorldMenu(p);
        return p;
    };

    return {
        scene,
        storage: panel("storage"),
        spot: panel("craftingSpot"),
        sleep: panel("sleep"),
        extra: panel("future")
    };
}

test("opening a storage closes the crafting spot, and the reverse", () => {
    const { storage, spot } = harness();
    const place = { id: "spot" };
    const basket = { id: "basket" };
    spot.open(place);
    storage.open(basket);
    assert.equal(spot.visible, false);
    assert.equal(storage.visible, true);
    spot.open(place);
    assert.equal(storage.visible, false);
    assert.equal(spot.visible, true);
});

test("a later world menu is exclusive without its own close list", () => {
    const { storage, spot, sleep, extra } = harness();
    spot.open({ id: "spot" });
    sleep.open({ id: "bed" });
    extra.open({ id: "new" });
    assert.equal(spot.visible, false);
    assert.equal(sleep.visible, false);
    assert.equal(extra.visible, true);
    storage.open({ id: "basket" });
    assert.equal(extra.visible, false);
    assert.equal(storage.visible, true);
});

test("opening a world menu closes station chrome and foreign bills", () => {
    const { scene, storage, spot } = harness();
    const place = { id: "spot" };
    const basket = { id: "basket" };
    spot.open(place);
    scene.billsPanel.visible = true;
    scene.billsPanel.thing = place;
    scene._craftFromStation = true;
    scene._craftStationThing = { id: "bench" };
    scene._rockStationThing = { id: "rock" };
    storage.open(basket);
    assert.equal(spot.visible, false);
    assert.equal(scene.billsPanel.visible, false);
    assert.equal(scene.closedCraft, 1);
    assert.equal(scene.closedRock, 1);
    assert.equal(scene.equipmentPanel.visible, true);
});

test("bills for the menu being opened stay open", () => {
    const { scene, storage } = harness();
    const basket = { id: "basket" };
    scene.billsPanel.visible = true;
    scene.billsPanel.thing = basket;
    storage.open(basket);
    assert.equal(scene.billsPanel.visible, true);
    assert.equal(scene.billsPanel.thing, basket);
});

test("closing a world menu from inside close does not recurse", () => {
    const { scene, storage, spot } = harness();
    spot.close = function () {
        this.scene.closeOtherWorldMenus(null);
        this.visible = false;
    };
    spot.visible = true;
    storage.open({ id: "basket" });
    assert.equal(spot.visible, false);
    assert.equal(storage.visible, true);
    assert.equal(scene._closingWorldMenus, false);
});
