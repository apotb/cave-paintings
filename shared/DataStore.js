/**
 * Shared game data (BodyPlans, Injuries, Hediffs, Items, Mobs).
 * Node: loadFromDisk(root) via fs. Browser: initFromPhaserScene(scene).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.DataStore = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const store = {
        bodyPlans: null,
        injuries: null,
        hediffs: null,
        itemsById: null,
        mobsById: null,
        itemsList: null,
        mobsList: null,
        _ready: false
    };

    function _indexById(list) {
        const map = Object.create(null);
        if (!Array.isArray(list)) return map;
        for (const row of list) {
            if (row?.id) map[row.id] = row;
        }
        return map;
    }

    function _setAll(payload) {
        store.bodyPlans = payload.bodyPlans || {};
        store.injuries = payload.injuries || {};
        store.hediffs = payload.hediffs || {};
        store.itemsList = Array.isArray(payload.items) ? payload.items : [];
        store.mobsList = Array.isArray(payload.mobs) ? payload.mobs : [];
        store.itemsById = _indexById(store.itemsList);
        store.mobsById = _indexById(store.mobsList);
        const planCount = store.bodyPlans ? Object.keys(store.bodyPlans).length : 0;
        store._ready = planCount > 0;
        return store;
    }

    /**
     * Browser: pull from Phaser cache.json keys used by SceneBase.
     * Safe to call multiple times; ignores empty/missing cache.
     * @param {Phaser.Scene} scene
     */
    function initFromPhaserScene(scene) {
        const json = scene?.cache?.json;
        if (!json) {
            console.warn("DataStore.initFromPhaserScene: no cache.json");
            return store;
        }
        const bodyPlans = json.get("bodyPlans") || {};
        if (!bodyPlans || !Object.keys(bodyPlans).length) {
            console.warn("DataStore.initFromPhaserScene: bodyPlans not in cache yet");
            return store;
        }
        return _setAll({
            bodyPlans,
            injuries: json.get("injuries") || {},
            hediffs: json.get("hediffs") || {},
            items: json.get("items") || [],
            mobs: json.get("mobs") || []
        });
    }

    /**
     * Node: load data/*.json relative to project root.
     * @param {string} [rootDir]
     */
    function loadFromDisk(rootDir) {
        const fs = require("fs");
        const path = require("path");
        const root = rootDir || path.resolve(__dirname, "..");
        const read = (name) =>
            JSON.parse(fs.readFileSync(path.join(root, "data", name), "utf8"));
        return _setAll({
            bodyPlans: read("BodyPlans.json"),
            injuries: read("Injuries.json"),
            hediffs: read("Hediffs.json"),
            items: read("Items.json"),
            mobs: read("Mobs.json")
        });
    }

    /** Manual inject (tests / preloaded payloads). */
    function initFromData(payload) {
        return _setAll(payload || {});
    }

    function isReady() {
        return !!store._ready;
    }

    function getBodyPlan(id) {
        if (!store.bodyPlans) return null;
        return store.bodyPlans[id] || null;
    }

    function getInjuryDefs() {
        return store.injuries || {};
    }

    function getHediffDefs() {
        return store.hediffs || {};
    }

    function getItem(id) {
        if (!id || !store.itemsById) return null;
        if (store.itemsById[id]) return store.itemsById[id];
        const want = (typeof Hide !== "undefined" && Hide.canonicalItemId)
            ? Hide.canonicalItemId(id)
            : (id === "deer_brain" ? "brain" : id === "wood_spear" ? "wooden_spear" : id);
        return store.itemsById[want] || null;
    }

    function getMob(id) {
        if (!id || !store.mobsById) return null;
        return store.mobsById[id] || null;
    }

    function getUnarmedAttacks(planId) {
        const plan = getBodyPlan(planId);
        return plan?.unarmedAttacks || {};
    }

    return {
        initFromPhaserScene,
        loadFromDisk,
        initFromData,
        isReady,
        getBodyPlan,
        getInjuryDefs,
        getHediffDefs,
        getItem,
        getMob,
        getUnarmedAttacks,
        /** Internal snapshot (tests). */
        _store: store
    };
});
