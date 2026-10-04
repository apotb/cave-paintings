/**
 * Phaser-free authoritative sim (singleplayer host + dedicated server).
 * Handles players, chunks, drops, anatomy combat, hunger, channels.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const Protocol = require("../protocol");
        const Look = require("../look");
        const rng = require("../rng");
        const Spoil = require("../spoil");
        const Durability = require("../durability");
        const Apparel = require("../apparel");
        const Chop = require("../chop");
        const Place = require("../place");
        const Sleep = require("../sleep");
        const Hunger = require("../hunger");
        const Path = require("../path");
        const Hide = require("../hide");
        const Carry = require("../carry");
        const Fire = require("../fire");
        const Party = require("../party");
        const Settlement = require("../settlement");
        const StorageFilter = require("../storageFilter");
        const FuelFilter = require("../fuelFilter");
        const CavemanNames = require("../cavemanNames");
        const CorpseDecay = require("../corpseDecay");
        const GameMath = require("../gameMath");
        const DataStore = require("../DataStore");
        const BodyHealing = require("../body/Healing");
        const Hediffs = require("../body/Hediff");
        const BodyCombat = require("../body/Combat");
        const BodyMod = require("../body/Body");
        const Capacities = require("../body/Capacities");
        const HeadlessAI = require("../ai/headless");
        const SimCreatureMod = require("./SimCreature");
        const WorldGen = require("./WorldGen");
        const SettlerWork = require("./settlerWork");
        module.exports = factory(
            Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger,
            Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames,
            CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod,
            Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork,
            [
            require("./world/creatures"),
            require("./world/players"),
            require("./world/settlement"),
            require("./world/party"),
            require("./world/commands"),
            require("./world/gear"),
            require("./world/campfire"),
            require("./world/structures"),
            require("./world/combat"),
            require("./world/clock")
            ]
        );
    } else {
        const api = factory(
            root.NetProtocol, root.Look, root.NetRng, root.Spoil || root.NetSpoil, root.Durability, root.Apparel,
            root.Chop, root.Place, root.Sleep, root.Hunger, root.Path, root.Hide, root.Carry,
            root.Fire, root.Party, root.Settlement, root.StorageFilter, root.FuelFilter, root.CavemanNames,
            root.CorpseDecay, root.GameMath, root.DataStore, root.BodyHealing, root.Hediffs,
            root.BodyCombat, { Body: root.Body }, root.Capacities, root.HeadlessAI,
            root.SimCreatureAPI, root.WorldGen, root.SettlerWork,
            [
                root.SimWorldMixins && root.SimWorldMixins.creatures,
                root.SimWorldMixins && root.SimWorldMixins.players,
                root.SimWorldMixins && root.SimWorldMixins.settlement,
                root.SimWorldMixins && root.SimWorldMixins.party,
                root.SimWorldMixins && root.SimWorldMixins.commands,
                root.SimWorldMixins && root.SimWorldMixins.gear,
                root.SimWorldMixins && root.SimWorldMixins.campfire,
                root.SimWorldMixins && root.SimWorldMixins.structures,
                root.SimWorldMixins && root.SimWorldMixins.combat,
                root.SimWorldMixins && root.SimWorldMixins.clock
            ]
        );
        root.SimWorldAPI = api;
        root.SimWorld = api.SimWorld;
        root.chunkKey = api.chunkKey;
        root.worldToChunk = api.worldToChunk;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
    Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger,
    Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames,
    CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod,
    Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork,
    mixinFactories
) {
    const { mulberry32, hash2D, uuid } = rng;
    const { Body } = BodyMod;
    const { createAI, PartyAI, WandererStrollAI, NeutralAnimalAI } = HeadlessAI;
    const { createPlayerCreature, createMobCreature, feetToBodyCenter } = SimCreatureMod;

const CS = WorldGen.CS;
const TS = WorldGen.TS;
const CHUNK_PX = WorldGen.CHUNK_PX;
const SPEED = 56; // px/s — matches client Player speed 3.5 tiles/s * 16
const SPRINT = 1.5;
const MELEE_RANGE = 28;
const INTEREST = Protocol.INTEREST_CHUNKS;
/** Wildlife AI + snapshot puppets: on-screen ring, not the full interest stream. */
const SIM_CHUNKS = 4;
/** Matches client DroppedItem — 15 real minutes while the chunk is "loaded". */
const DROP_LIFE_MS = 15 * 60 * 1000;
/** Matches client Player.interactionRange (tiles). */
const HARVEST_RANGE_TILES = 4;

const BLOCKED = WorldGen.BLOCKED;

function _research() {
    if (typeof Research !== "undefined") return Research;
    try {
        if (typeof require === "function") return require("../research");
    } catch (_) { /* optional */ }
    return null;
}

function _contentApi() {
    if (typeof Content !== "undefined") return Content;
    try {
        if (typeof require === "function") return require("../mods/content");
    } catch (_) { /* optional */ }
    return null;
}

function _actionsApi() {
    if (typeof ModActions !== "undefined") return ModActions;
    try {
        if (typeof require === "function") return require("../mods/actions");
    } catch (_) { /* optional */ }
    return null;
}

function _kindsApi() {
    if (typeof ModKinds !== "undefined") return ModKinds;
    try {
        if (typeof require === "function") return require("../mods/kinds");
    } catch (_) { /* optional */ }
    return null;
}

function _forming() {
    if (typeof Forming !== "undefined") return Forming;
    try {
        if (typeof require === "function") return require("../forming");
    } catch (_) { /* optional */ }
    return null;
}

function _dig() {
    if (typeof Dig !== "undefined") return Dig;
    try {
        if (typeof require === "function") return require("../dig");
    } catch (_) { /* optional */ }
    return null;
}

function _defGeneration() {
    return Number(DataStore.generation) || 0;
}

let _thingDefs = null;
let _thingDefsGen = -1;
function thingDefs() {
    const gen = _defGeneration();
    if (_thingDefs && _thingDefsGen === gen) return _thingDefs;
    _thingDefs = null;
    const map = new Map();
    const list = DataStore._store?.thingsList;
    if (Array.isArray(list)) {
        for (const t of list) {
            if (t?.id) map.set(t.id, t);
        }
    }
    if (map.size) {
        _thingDefs = map;
        _thingDefsGen = gen;
    }
    return map;
}

let _mobDefs = null;
let _mobDefsGen = -1;
function mobDefs() {
    const gen = _defGeneration();
    if (_mobDefs && _mobDefsGen === gen) return _mobDefs;
    _mobDefs = null;
    const map = new Map();
    const list = DataStore._store?.mobsList;
    if (Array.isArray(list)) {
        for (const m of list) {
            if (m?.id) map.set(m.id, m);
        }
    }
    if (map.size) {
        _mobDefs = map;
        _mobDefsGen = gen;
    }
    return map;
}

let _itemDefs = null;
let _itemDefsGen = -1;
function itemDefs() {
    const gen = _defGeneration();
    if (_itemDefs && _itemDefsGen === gen) return _itemDefs;
    _itemDefs = null;
    const raw = DataStore._store?.itemsList;
    if (!Array.isArray(raw) || !raw.length) return new Map();
    Carry.resolveCraftedWeights?.(raw);
    Carry.resolveCraftedFuel?.(raw);
    const map = new Map();
    for (const it of raw) {
        if (it?.id) map.set(it.id, it);
    }
    for (const [from, to] of [["deer_brain", "brain"], ["wood_spear", "wooden_spear"]]) {
        if (map.has(to) && !map.has(from)) map.set(from, map.get(to));
    }
    _itemDefs = map;
    _itemDefsGen = gen;
    return map;
}

function chunkKey(cx, cy) {
    return `${cx},${cy}`;
}

function worldToChunk(wx, wy) {
    return {
        cx: Math.floor(wx / CHUNK_PX),
        cy: Math.floor(wy / CHUNK_PX)
    };
}

function emptyInv(size = 5) {
    return Array.from({ length: size }, () => null);
}

/** One corpse id per world. A second copy of the same death used to survive dismiss and reload. */
function dedupeCorpses(list, seen) {
    const ids = seen || new Set();
    const out = [];
    for (const corpse of list || []) {
        if (!corpse) continue;
        const id = corpse.id;
        if (id && ids.has(id)) continue;
        if (id) ids.add(id);
        out.push(corpse);
    }
    return out;
}

class SimWorld {
    /**
     * @param {{ root?: string, worldName?: string, props?: object, persist?: { load?: Function, save?: Function, clearPlayers?: Function } }} opts
     */
    constructor(opts) {
        opts = opts || {};
        this.root = opts.root;
        this.worldName = opts.worldName;
        this.props = opts.props || {};
        this.persist = opts.persist || null;
        this.seed = WorldGen.pickWorldSeed();
        this.gameDay = 1;
        this.gameMinutes = 8 * 60;
        this.tickSpeed = 1;
        this.baseTickSpeed = 1;
        this._restSpeedElapsedMs = 0;
        this.genVersion = 2;
        this.chunks = new Map(); // key -> chunk meta
        this.players = new Map(); // id -> pawn
        /** @type {Map<string, import("./SimCreature").SimCreature>} uid -> wildlife */
        this.mobs = new Map();
        /** @type {Map<string, import("./SimCreature").SimCreature>} playerId -> creature */
        this.creatures = new Map();
        /** @type {Map<string, object>} wandererId -> passerby */
        this.wanderers = new Map();
        this.settlements = [];
        this.settlers = [];
        this.researchSpentByOwner = Object.create(null);
        /** Mod-owned save blob. Not part of the sim hash. */
        this.modData = {};
        /** Load-time save warnings. Not a join REJECT. */
        this.contentWarnings = [];
        /** @type {Map<string, number>} playerId -> seconds until next passerby pack */
        this._directorCd = new Map();
        this._duelMap = new Map();
        this._duelIds = new Map();
        this._duelEntities = [];
        /** @type {Record<string, { x: number, y: number, facing?: string }>} */
        this.poses = {};
        this.spawn = { x: TS * 2, y: TS * 2 };
        this._minuteAcc = 0;
        this._events = []; // broadcast queue
        this._youDirty = new Set();
        this._chunkRectCache = null;
        this._uidIndex = null;
        this.dataStore = DataStore;
        if (!DataStore.isReady() && typeof DataStore.loadFromDisk === "function") {
            DataStore.loadFromDisk();
        }
        this.rng = mulberry32(this.seed >>> 0);
        GameMath.setRng(() => this.rng());
        this._combatLog = {
            push: (msg, opts = null) => {
                const o = opts || {};
                const recipients = this._combatLogRecipients(o);
                if (!recipients.length) {
                    // No player audience (mob vs mob, etc.) — do not spam the world
                    return;
                }
                for (const id of recipients) {
                    const segments = this._combatLogSegmentsForViewer(o, id) || o.segments || null;
                    this.pushEvent({
                        kind: "combat_log",
                        text: msg,
                        combat: !!o.combat,
                        segments,
                        color: o.color || null,
                        deflected: !!o.deflected,
                        spark: o.spark || null,
                        to: id
                    });
                }
            }
        };
        WorldGen.applySeed(this.seed);
        this._pickSpawn();
    }

    static createNew(opts) {
        const w = new SimWorld(opts);
        w._ensureChunk(0, 0);
        w._ensureChunk(0, -1);
        w._ensureChunk(-1, 0);
        w._ensureChunk(-1, -1);
        w._findSpawnClearing();
        return w;
    }

    static loadOrCreate(opts) {
        const persist = opts?.persist;
        const data = persist?.load?.() ?? null;
        if (!data || data.genVersion !== 2) {
            const cleared = persist?.clearPlayers?.() ?? 0;
            const w = SimWorld.createNew(opts);
            persist?.save?.(w.toSaveData());
            if (typeof console !== "undefined" && console.log) {
                console.log(
                    `[world] regenerated "${opts.worldName}" with perlin gen (was ${data ? `v${data.genVersion ?? 1}` : "missing"}; cleared ${cleared} player file(s))`
                );
            }
            return w;
        }
        return SimWorld.loadFromData(data, opts);
    }

    static loadFromData(data, opts) {
        const w = new SimWorld(opts);
        if (!data || typeof data !== "object") return w;
        w.seed = data.seed || w.seed;
        w.gameDay = data.clock?.gameDay ?? 1;
        w.gameMinutes = data.clock?.gameMinutes ?? 8 * 60;
        w.tickSpeed = data.clock?.tickSpeed != null ? Number(data.clock.tickSpeed) : 1;
        if (!Number.isFinite(w.tickSpeed) || w.tickSpeed < 0) w.tickSpeed = 1;
        w.baseTickSpeed = data.clock?.baseTickSpeed != null
            ? Number(data.clock.baseTickSpeed)
            : w.tickSpeed;
        if (!Number.isFinite(w.baseTickSpeed) || w.baseTickSpeed < 0) w.baseTickSpeed = w.tickSpeed;
        w.tickSpeed = w.baseTickSpeed;
        w.spawn = data.spawn || w.spawn;
        w.poses = (data.poses && typeof data.poses === "object") ? { ...data.poses } : {};
        w._loadDirectorCd(data.directorCd);
        w.rng = mulberry32(w.seed >>> 0);
        GameMath.setRng(() => w.rng());
        WorldGen.applySeed(w.seed);
        const removedList = Array.isArray(data.removedCorpseIds)
            ? data.removedCorpseIds.filter((id) => typeof id === "string" && id).slice(-4000)
            : [];
        w._removedCorpseIds = removedList;
        w._removedCorpseSet = new Set(removedList);
        const seenCorpseIds = new Set();
        for (const [key, meta] of Object.entries(data.chunks || {})) {
            const cx = meta.x ?? meta.cx;
            const cy = meta.y ?? meta.cy;
            let drops = meta.drops || [];
            if (Math.abs(cx) <= 1 && Math.abs(cy) <= 1) {
                drops = drops.filter((d) => d?.id !== "apple");
            }
            for (const d of drops) Hide.migrateStackItemId(d);
            for (const corpse of meta.corpses || []) {
                if (!Array.isArray(corpse?.loot)) continue;
                for (const s of corpse.loot) Hide.migrateStackItemId(s);
            }
            const migrateThingStacks = (t) => {
                if (!t) return;
                Hide.migrateStackItemId(t.cook);
                Hide.migrateStackItemId(t.catalyst);
                for (const s of t.fuel || []) Hide.migrateStackItemId(s);
                for (const s of t.simmer || []) Hide.migrateStackItemId(s);
                for (const s of t.slots || []) Hide.migrateStackItemId(s);
            };
            for (const t of meta.things || []) migrateThingStacks(t);
            for (const t of meta.lootableThings || []) migrateThingStacks(t);
            const chunk = {
                cx,
                cy,
                tiles: meta.tiles,
                things: meta.things || [],
                lootableThings: meta.lootableThings || [],
                drops,
                mobs: meta.mobs || [],
                corpses: dedupeCorpses(meta.corpses, seenCorpseIds)
                    .filter((c) => !c?.id || !w._removedCorpseSet.has(c.id)),
                bloodStains: meta.bloodStains || [],
                generated: true
            };
            w.chunks.set(key, chunk);
            w._ensureLootableUids(chunk);
            w._registerChunkMobs(chunk);
        }
        if (!w.chunks.size) w._findSpawnClearing();
        for (const snap of data.wanderers || []) {
            const rec = w._wandererRecordFromSnap(snap);
            if (rec) w.wanderers.set(rec.id, rec);
        }
        w.settlements = (data.settlements || []).map((s) => Settlement.ensureSettlement(s));
        const spentRaw = data.researchSpentByOwner;
        w.researchSpentByOwner = (spentRaw && typeof spentRaw === "object" && !Array.isArray(spentRaw))
            ? { ...spentRaw }
            : Object.create(null);
        w.settlers = [];
        for (const snap of data.settlers || []) {
            const rec = w._settlerFromSnap(snap);
            if (rec) w.settlers.push(rec);
        }
        w.modData = data.modData && typeof data.modData === "object" && !Array.isArray(data.modData)
            ? { ...data.modData }
            : {};
        w.contentWarnings = w._contentLoadWarnings(data);
        for (const line of w.contentWarnings) {
            if (typeof console !== "undefined" && console.warn) console.warn(line);
        }
        return w;
    }
}

    const ctx = {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    };
    for (let mixinIndex = 0; mixinIndex < mixinFactories.length; mixinIndex++) {
        const installMixin = mixinFactories[mixinIndex];
        if (typeof installMixin !== "function") {
            throw new Error("SimWorld mixin missing at index " + mixinIndex);
        }
        const methods = installMixin(ctx);
        for (const name of Object.keys(methods)) {
            if (name === "constructor" || Object.prototype.hasOwnProperty.call(SimWorld.prototype, name)) {
                throw new Error("SimWorld method already defined: " + name);
            }
            Object.defineProperty(SimWorld.prototype, name, {
                value: methods[name],
                writable: true,
                configurable: true,
                enumerable: false
            });
        }
    }


    return { SimWorld, chunkKey, worldToChunk, CHUNK_PX, CS, TS };
});
