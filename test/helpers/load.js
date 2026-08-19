/**
 * Shared Node test setup: defs from disk, seeded GameMath RNG.
 */
const path = require("path");
const GameMath = require("../../shared/gameMath");
const { mulberry32 } = require("../../shared/rng");
const DataStore = require("../../shared/DataStore");

const ROOT = path.resolve(__dirname, "../..");

let loaded = false;

function loadDefs() {
    if (!loaded) {
        DataStore.loadFromDisk(ROOT);
        const Carry = require("../../shared/carry");
        Carry.resolveCraftedWeights(DataStore._store.itemsList);
        Carry.resolveCraftedFuel(DataStore._store.itemsList);
        loaded = true;
    }
    return DataStore;
}

function seedRng(seed = 12345) {
    const rng = mulberry32(seed >>> 0);
    GameMath.setRng(rng);
    return rng;
}

function restoreRng() {
    GameMath.setRng(null);
}

function bodyCtx() {
    loadDefs();
    return { data: DataStore, math: GameMath, combatLog: null };
}

module.exports = {
    ROOT,
    loadDefs,
    seedRng,
    restoreRng,
    bodyCtx,
    DataStore,
    GameMath
};
