/**
 * Phaser-free authoritative sim for the listen server.
 * Handles players, chunks, drops, anatomy combat, hunger, channels.
 */
const fs = require("fs");
const path = require("path");
const Protocol = require("../shared/protocol");
const Look = require("../shared/look");
const { mulberry32, hash2D, uuid } = require("../shared/rng");
const Spoil = require("../shared/spoil");
const CorpseDecay = require("../shared/corpseDecay");
const GameMath = require("../shared/gameMath");
const DataStore = require("../shared/DataStore");
const BodyHealing = require("../shared/body/Healing");
const { Body } = require("../shared/body/Body");
const Capacities = require("../shared/body/Capacities");
const { createAI } = require("../shared/ai/headless");
const {
    createPlayerCreature,
    createMobCreature
} = require("./SimCreature");
const SaveIO = require("./SaveIO");
const WorldGen = require("./WorldGen");

const CS = WorldGen.CS;
const TS = WorldGen.TS;
const CHUNK_PX = WorldGen.CHUNK_PX;
const SPEED = 56; // px/s — matches client Player speed 3.5 tiles/s * 16
const SPRINT = 1.5;
const MELEE_RANGE = 28;
const INTEREST = Protocol.INTEREST_CHUNKS;
/** Matches client DroppedItem — 5 real minutes while the chunk is "loaded". */
const DROP_LIFE_MS = 5 * 60 * 1000;
/** Matches client Player.interactionRange (tiles). */
const HARVEST_RANGE_TILES = 4;

const BLOCKED = WorldGen.BLOCKED;

let _thingDefs = null;
function thingDefs() {
    if (_thingDefs) return _thingDefs;
    const raw = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "data", "Things.json"), "utf8")
    );
    const map = new Map();
    for (const t of raw) {
        if (t?.id) map.set(t.id, t);
    }
    _thingDefs = map;
    return map;
}

let _mobDefs = null;
function mobDefs() {
    if (_mobDefs) return _mobDefs;
    const raw = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "data", "Mobs.json"), "utf8")
    );
    const map = new Map();
    for (const m of raw) {
        if (m?.id) map.set(m.id, m);
    }
    _mobDefs = map;
    return map;
}

let _itemDefs = null;
function itemDefs() {
    if (_itemDefs) return _itemDefs;
    const raw = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "data", "Items.json"), "utf8")
    );
    const map = new Map();
    for (const it of raw) {
        if (it?.id) map.set(it.id, it);
    }
    _itemDefs = map;
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

class SimWorld {
    /**
     * @param {{ root: string, worldName: string, props: object }} opts
     */
    constructor(opts) {
        this.root = opts.root;
        this.worldName = opts.worldName;
        this.props = opts.props;
        this.seed = WorldGen.pickWorldSeed();
        this.gameDay = 1;
        this.gameMinutes = 8 * 60;
        this.tickSpeed = 1;
        this.genVersion = 2;
        this.chunks = new Map(); // key -> chunk meta
        this.players = new Map(); // id -> pawn
        /** @type {Map<string, import("./SimCreature").SimCreature>} uid -> wildlife */
        this.mobs = new Map();
        /** @type {Map<string, import("./SimCreature").SimCreature>} playerId -> creature */
        this.creatures = new Map();
        /** @type {Record<string, { x: number, y: number, facing?: string }>} */
        this.poses = {};
        this.spawn = { x: TS * 2, y: TS * 2 };
        this._minuteAcc = 0;
        this._events = []; // broadcast queue
        this._youDirty = new Set();
        this.dataStore = DataStore;
        if (!DataStore.isReady()) {
            DataStore.loadFromDisk(path.resolve(__dirname, ".."));
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
                        to: id
                    });
                }
            }
        };
        WorldGen.applySeed(this.seed);
        this._pickSpawn();
    }

    _creatureCtx(extras = {}) {
        return {
            combatLog: this._combatLog,
            emitBleedFx: (payload) => this._emitBleedFx(payload),
            worldMinuteIndex: () => this.worldMinuteIndex(),
            tickSpeed: this.tickSpeed,
            math: GameMath,
            tileSize: TS,
            sim: this,
            ...extras
        };
    }

    /**
     * Hitting one animal triggers nearby AIs (scared flee, same-species pack aggro).
     * One hop only — matches client LivingMob.alertNearbyMobs.
     */
    alertNearbyMobs(victim, source) {
        if (!victim || victim.kind !== "mob" || !source) return;
        const range = TS * 8;
        const rangeSq = range * range;
        for (const other of this.mobs.values()) {
            if (!other || other === victim || other.isBodyDead?.() || !other.active) continue;
            if (typeof other.ai?.onDamaged !== "function") continue;
            const dx = other.x - victim.x;
            const dy = other.y - victim.y;
            if (dx * dx + dy * dy > rangeSq) continue;
            other.ai.onDamaged(source, { alert: true, victim });
        }
    }

    /**
     * Cue clients to paint local blood VFX (patterns are client-random).
     * Does not persist stains on the server.
     */
    _emitBleedFx(payload) {
        if (!payload) return;
        const x = Number(payload.x);
        const y = Number(payload.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const n = Math.max(1, Math.min(4, Math.floor(Number(payload.n) || 1)));
        this.pushEvent({
            kind: "bleed",
            x,
            y,
            n,
            burst: !!payload.burst,
            ownerId: payload.ownerId || null,
            prone: !!payload.prone,
            entityKind: payload.kind || null
        });
    }

    /** Player ids that should see a combat-log line. */
    _playerIdOf(entity) {
        if (!entity) return null;
        const id = entity.id || entity.playerId || null;
        if (!id) return null;
        if (entity.kind === "player") return id;
        if (this.players.has(id)) return id;
        return null;
    }

    _combatLogRecipients(opts = {}) {
        const ids = new Set();
        const add = (v) => {
            if (!v) return;
            if (typeof v === "string") {
                if (this.players.has(v)) ids.add(v);
                return;
            }
            if (Array.isArray(v)) {
                for (const x of v) add(x);
                return;
            }
            const id = this._playerIdOf(v);
            if (id) ids.add(id);
        };
        add(opts.to);
        add(opts.owner);
        add(opts.attacker);
        add(opts.target);
        add(opts.participants);
        return [...ids];
    }

    /** Rebuild hit/destroy segments from the receiving player's point of view. */
    _combatLogSegmentsForViewer(opts, viewerId) {
        if (!opts?.combat || !opts.attacker || !opts.target || !opts.attack) return null;
        const attack = opts.attack;
        const attacker = opts.attacker;
        const target = opts.target;
        const partName = opts.victimPartName;
        if (!partName) return null;

        const YOU = "#6ecf6e";
        const ENEMY = "#ef5a5a";
        const WEAPON = "#f0a040";
        const isYou = this._playerIdOf(attacker) === viewerId;
        const vicIsYou = this._playerIdOf(target) === viewerId;

        if (opts.destroyed) {
            const who = vicIsYou
                ? "Your"
                : `${target.def?.name || target.displayName?.() || "Their"}'s`;
            return [
                { text: who, color: vicIsYou ? YOU : ENEMY },
                { text: `${partName} was destroyed!` }
            ];
        }

        const subj = isYou
            ? "You"
            : attacker?.displayName?.() || attacker?.def?.name || "Someone";
        const verb = attack.verb || "hit";
        const weaponName =
            !attack.unarmed && attack.weaponName
                ? attack.weaponName
                : attack.sourcePart?.name || attack.weaponName || "blow";
        const vicPossessive = vicIsYou
            ? "your"
            : `${target.def?.name || target.displayName?.() || "foe"}'s`;
        const dmgStr = `(${Number(opts.damage).toFixed(1)})`;
        return [
            { text: subj, color: isYou ? YOU : ENEMY },
            { text: verb },
            { text: weaponName, color: WEAPON },
            { text: "into" },
            { text: vicPossessive, color: vicIsYou ? YOU : ENEMY },
            { text: partName },
            { text: dmgStr, color: WEAPON }
        ];
    }

    _aiWorld() {
        const self = this;
        return {
            getNearestPlayer(mob) {
                let best = null;
                let bestD = Infinity;
                for (const c of self.creatures.values()) {
                    if (!c || c.kind !== "player" || c.isBodyDead()) continue;
                    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
                    if (d < bestD) {
                        bestD = d;
                        best = c;
                    }
                }
                return best;
            },
            get players() {
                return [...self.creatures.values()].filter(
                    (c) => c && c.kind === "player" && !c.isBodyDead()
                );
            },
            isBlocked: (x, y) => self.isBlocked(x, y)
        };
    }

    _ensurePlayerCreature(p) {
        if (!p) return null;
        let creature = this.creatures.get(p.id) || p.creature || null;
        if (!creature) {
            creature = createPlayerCreature(
                {
                    id: p.id,
                    name: p.name,
                    x: p.x,
                    y: p.y,
                    facing: p.facing,
                    inventory: p.inventory,
                    equipment: p.equipment,
                    hotbarIndex: p.hotbarIndex,
                    body: p.body
                },
                this.dataStore,
                this._creatureCtx()
            );
            this.creatures.set(p.id, creature);
        } else {
            creature.name = p.name || creature.name;
            creature.inventory = p.inventory;
            creature.equipment = p.equipment;
            creature.hotbarIndex = p.hotbarIndex ?? 0;
            // Do not loadJSON(p.body) here — that would wipe live combat injuries.
        }
        p.creature = creature;
        creature.x = p.x;
        creature.y = p.y;
        creature.facing = p.facing || creature.facing;
        creature._dead = !!p.dead;
        creature.active = !p.dead;
        return creature;
    }

    _syncPlayerCreature(p) {
        const creature = p?.creature || this.creatures.get(p?.id);
        if (!creature || !p) return null;
        creature.x = p.x;
        creature.y = p.y;
        creature.facing = p.facing || creature.facing;
        creature.inventory = p.inventory;
        creature.equipment = p.equipment;
        creature.hotbarIndex = p.hotbarIndex ?? 0;
        if (p.dead) {
            creature._dead = true;
            creature.active = false;
        }
        return creature;
    }

    _resetPlayerAnatomy(p) {
        const creature = this._ensurePlayerCreature(p);
        if (!creature) return;
        creature.anatomy = new Body(creature.ctx, "human", creature);
        creature.capacities = new Capacities(creature.anatomy);
        creature._dead = false;
        creature.active = true;
        creature._corpsePayload = null;
        p.body = null;
        p.dead = false;
        p.hp = p.mhp;
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
        const data = SaveIO.loadWorld(opts.root, opts.worldName);
        // Regen placeholder worlds from the first net prototype
        if (!data || data.genVersion !== 2) {
            const cleared = SaveIO.clearPlayers(opts.root, opts.worldName);
            const w = SimWorld.createNew(opts);
            SaveIO.saveWorld(opts.root, opts.worldName, w.toSaveData());
            console.log(
                `[world] regenerated "${opts.worldName}" with perlin gen (was ${data ? `v${data.genVersion ?? 1}` : "missing"}; cleared ${cleared} player file(s))`
            );
            return w;
        }
        const w = new SimWorld(opts);
        w.seed = data.seed || w.seed;
        w.gameDay = data.clock?.gameDay ?? 1;
        w.gameMinutes = data.clock?.gameMinutes ?? 8 * 60;
        w.tickSpeed = data.clock?.tickSpeed != null ? Number(data.clock.tickSpeed) : 1;
        if (!Number.isFinite(w.tickSpeed) || w.tickSpeed < 0) w.tickSpeed = 1;
        w.spawn = data.spawn || w.spawn;
        w.poses = (data.poses && typeof data.poses === "object") ? { ...data.poses } : {};
        w.rng = mulberry32(w.seed >>> 0);
        GameMath.setRng(() => w.rng());
        WorldGen.applySeed(w.seed);
        for (const [key, meta] of Object.entries(data.chunks || {})) {
            const cx = meta.x;
            const cy = meta.y;
            // Strip legacy net-prototype apple seeding in spawn neighborhood
            let drops = meta.drops || [];
            if (Math.abs(cx) <= 1 && Math.abs(cy) <= 1) {
                drops = drops.filter((d) => d?.id !== "apple");
            }
            const chunk = {
                cx,
                cy,
                tiles: meta.tiles,
                things: meta.things || [],
                lootableThings: meta.lootableThings || [],
                drops,
                mobs: meta.mobs || [],
                corpses: meta.corpses || [],
                bloodStains: meta.bloodStains || [],
                generated: true
            };
            w.chunks.set(key, chunk);
            w._ensureLootableUids(chunk);
            w._registerChunkMobs(chunk);
        }
        return w;
    }

    _pickSpawn() {
        // Origin tile foot — sign goes here; players scatter in radius 4
        this.spawn = { x: TS / 2, y: TS };
    }

    _registerChunkMobs(c) {
        this._ensureMobUids(c);
        if (!c || !Array.isArray(c.mobs)) return;
        for (const entry of c.mobs) {
            if (!entry?.uid || this.mobs.has(entry.uid)) continue;
            const def = mobDefs().get(entry.id) || this.dataStore.getMob(entry.id);
            const creature = createMobCreature(
                entry,
                def,
                this.dataStore,
                this._creatureCtx()
            );
            createAI(creature, creature.aiType);
            this.mobs.set(entry.uid, creature);
        }
    }

    _ensureMobUids(c) {
        if (!c || !Array.isArray(c.mobs)) return;
        for (const m of c.mobs) {
            if (!m || m.uid) continue;
            m.uid = `mob-${c.cx},${c.cy}-${Math.round(m.x)}-${Math.round(m.y)}`;
        }
    }

    _ensureLootableUids(c) {
        if (!c || !Array.isArray(c.lootableThings)) return;
        const seen = new Set();
        for (const e of c.lootableThings) {
            if (!e) continue;
            if (!e.uid) {
                e.uid = `lt_${Math.round(Number(e.x) || 0)}_${Math.round(Number(e.y) || 0)}_${e.id || "x"}`;
            }
            if (seen.has(e.uid)) e.uid = `${e.uid}_${uuid().slice(0, 6)}`;
            seen.add(e.uid);
        }
    }

    /**
     * Persist a mob into chunk meta and spawn an authoritative SimCreature.
     * @returns {object|null} chunk mob entry
     */
    _spawnMobAt(kind, x, y) {
        const idKey = String(kind || "").toLowerCase();
        const def = mobDefs().get(idKey) || this.dataStore.getMob(idKey);
        if (!def) return null;
        const wx = Number(x);
        const wy = Number(y);
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;

        const uid = `mob-${uuid()}`;
        const { cx, cy } = worldToChunk(wx, wy);
        const c = this._ensureChunk(cx, cy);
        if (!Array.isArray(c.mobs)) c.mobs = [];
        const entry = {
            uid,
            id: def.id,
            x: wx,
            y: wy,
            homeX: wx,
            homeY: wy
        };
        c.mobs.push(entry);
        const creature = createMobCreature(
            entry,
            def,
            this.dataStore,
            this._creatureCtx()
        );
        createAI(creature, creature.aiType);
        this.mobs.set(uid, creature);
        this.pushEvent({ kind: "mob", op: "add", entry, cx, cy });
        return entry;
    }

    _trySpawnMob(p, action = {}) {
        const kind = String(action.kind || action.id || "human").toLowerCase();
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            p.x = action.x;
            p.y = action.y;
            p.poseAuth = true;
        }
        const x = Number.isFinite(action.x) ? action.x : p.x;
        const y = Number.isFinite(action.y) ? action.y : p.y;
        const entry = this._spawnMobAt(kind, x, y);
        if (!entry) {
            this.announceCmd(`Unknown mob "${kind}".`, { to: p.id });
            return;
        }
        const label = mobDefs().get(entry.id)?.name || entry.id;
        this.announceCmd(`Spawned ${label}`, { to: p.id });
    }

    _findSpawnClearing() {
        // Keep world spawn anchored at origin (matches client 0,0 sign).
        // Players use _pickRandomSpawnPose for first join / respawn.
        this.spawn = { x: TS / 2, y: TS };
        // Touch neighborhood so tiles/things exist for spawn picks
        for (let ty = -4; ty <= 4; ty++) {
            for (let tx = -4; tx <= 4; tx++) {
                const x = tx * TS + TS / 2;
                const y = ty * TS + TS;
                this.isBlocked(x, y);
            }
        }
    }

    /**
     * Random free tile in [-radius, radius]² around origin (same as SceneMain).
     * Skips water/ice/things and the origin sign tile.
     */
    _pickRandomSpawnPose(radius = 4) {
        const candidates = [];
        for (let ty = -radius; ty <= radius; ty++) {
            for (let tx = -radius; tx <= radius; tx++) {
                if (tx === 0 && ty === 0) continue;
                const x = tx * TS + TS / 2;
                const y = ty * TS + TS;
                if (this.isBlocked(x, y)) continue;
                candidates.push({ x, y });
            }
        }
        if (!candidates.length) {
            return { x: this.spawn.x, y: this.spawn.y };
        }
        return candidates[Math.floor(this.rng() * candidates.length)];
    }

    toSaveData() {
        this._flushOnlinePoses();
        const chunks = {};
        for (const [key, c] of this.chunks) {
            chunks[key] = {
                x: c.cx,
                y: c.cy,
                tiles: c.tiles,
                things: c.things,
                lootableThings: c.lootableThings,
                drops: c.drops,
                mobs: c.mobs,
                corpses: c.corpses,
                bloodStains: c.bloodStains
            };
        }
        return {
            v: 1,
            genVersion: 2,
            seed: this.seed,
            spawn: this.spawn,
            clock: { gameDay: this.gameDay, gameMinutes: this.gameMinutes, tickSpeed: this.tickSpeed },
            poses: this.poses || {},
            chunks
        };
    }

    saveAll() {
        SaveIO.saveWorld(this.root, this.worldName, this.toSaveData());
        // Characters are client-owned — do not persist player gear on the world server
    }

    savePlayer(_p) {
        // no-op: ephemeral sessions
    }

    playerToJSON(p) {
        return {
            id: p.id,
            name: p.name,
            worldSeed: this.seed,
            x: p.x,
            y: p.y,
            facing: p.facing,
            kc: p.kc,
            saturation: p.saturation,
            stomach: p.stomach,
            inventory: p.inventory,
            equipment: p.equipment,
            hotbarIndex: p.hotbarIndex,
            body: p.body || null,
            hp: p.hp,
            mhp: p.mhp
        };
    }

    /**
     * Join with optional client character snapshot (Terraria-style).
     * @param {string} playerId
     * @param {string} displayName
     * @param {object|null} character
     */
    addPlayer(playerId, displayName, character = null) {
        if (this.players.has(playerId)) {
            const existing = this.players.get(playerId);
            // Same character reconnecting — replace session with fresh snapshot if provided
            this.players.delete(playerId);
        }
        const p = this._freshPawn(playerId, displayName);
        if (character && typeof character === "object") {
            this._applyCharacterSnapshot(p, character);
        }
        this._restoreLogoutPose(p);
        p.connected = true;
        this.players.set(playerId, p);
        this._ensurePlayerCreature(p);
        this._interestLoad(p.x, p.y, this.interestRadius(p));
        this._youDirty.add(playerId);
        this.pushEvent({ kind: "chat", text: `${p.name} joined.`, system: true });
        return p;
    }

    /** Rejoin: restore last logout pose for this character on this world. */
    _restoreLogoutPose(p) {
        if (!p?.id || !this.poses) return;
        const saved = this.poses[p.id];
        if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return;
        this._interestLoad(saved.x, saved.y, this.interestRadius(p));
        let x = saved.x;
        let y = saved.y;
        if (this.isBlocked(x, y)) {
            // Prefer a nearby free tile over abandoning the pose (world spawn).
            const near = this._findOpenNear(x, y, 6);
            if (!near) return;
            x = near.x;
            y = near.y;
        }
        p.x = x;
        p.y = y;
        if (typeof saved.facing === "string" && saved.facing) p.facing = saved.facing;
    }

    /** Snapshot every connected pawn into poses so crash/restart keeps rejoin spots. */
    _flushOnlinePoses() {
        if (!this.poses || typeof this.poses !== "object") this.poses = {};
        for (const p of this.players.values()) {
            if (!p?.id || !p.connected) continue;
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            this.poses[p.id] = {
                x: p.x,
                y: p.y,
                facing: p.facing || "down"
            };
        }
    }

    _findOpenNear(wx, wy, radiusTiles = 4) {
        const r = Math.max(1, Math.floor(Number(radiusTiles) || 1));
        for (let rad = 0; rad <= r; rad++) {
            for (let dy = -rad; dy <= rad; dy++) {
                for (let dx = -rad; dx <= rad; dx++) {
                    if (rad > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
                    const x = wx + dx * TS;
                    const y = wy + dy * TS;
                    this._interestLoad(x, y, 1);
                    if (!this.isBlocked(x, y)) return { x, y };
                }
            }
        }
        return null;
    }

    _saveLogoutPose(p) {
        if (!p?.id) return;
        if (!this.poses || typeof this.poses !== "object") this.poses = {};
        this.poses[p.id] = {
            x: p.x,
            y: p.y,
            facing: p.facing || "down"
        };
    }

    _applyCharacterSnapshot(p, character) {
        if (character.name) p.name = String(character.name).slice(0, 24);
        if (typeof character.kc === "number") p.kc = character.kc;
        if (typeof character.saturation === "number") p.saturation = character.saturation;
        if (typeof character.stomach === "number") p.stomach = character.stomach;
        if (Array.isArray(character.inventory)) {
            p.inventory = character.inventory.slice(0, 40);
            while (p.inventory.length < 5) p.inventory.push(null);
        }
        if (character.equipment && typeof character.equipment === "object") {
            p.equipment = {
                head: character.equipment.head ?? null,
                torso: character.equipment.torso ?? null,
                legs: character.equipment.legs ?? null,
                feet: character.equipment.feet ?? null,
                waist: Array.isArray(character.equipment.waist)
                    ? character.equipment.waist.slice()
                    : []
            };
        }
        if (typeof character.hotbarIndex === "number") {
            p.hotbarIndex = Math.max(0, Math.min(p.inventory.length - 1, character.hotbarIndex));
        }
        if (typeof character.hp === "number") p.hp = character.hp;
        if (typeof character.mhp === "number") p.mhp = character.mhp;
        if (character.body !== undefined) p.body = character.body;
        if (character.look) {
            p.look = Look.normalizeLook(character.look);
            if (p.creature) p.creature.look = p.look;
        }
        if (p.hp <= 0) {
            p.dead = true;
        }
        this._migratePlayerSpoilLeft(p);
        if (this.players.has(p.id) || p.creature) {
            this._ensurePlayerCreature(p);
        }
    }

    _freshPawn(id, name) {
        const pose = this._pickRandomSpawnPose(4);
        return {
            id,
            name: name || "Player",
            x: pose.x,
            y: pose.y,
            facing: "down",
            vx: 0,
            vy: 0,
            moveX: 0,
            moveY: 0,
            sprint: false,
            kc: 1200,
            saturation: 0,
            stomach: 1600,
            hunger: 2000,
            inventory: emptyInv(5),
            equipment: { head: null, torso: null, legs: null, feet: null, waist: [] },
            hotbarIndex: 0,
            hp: 100,
            mhp: 100,
            body: null,
            dead: false,
            prone: false,
            attackTimer: 0,
            attackMax: 0,
            attackAngle: 0,
            /** Latest aim while a swing is busy — autofire must not drop attacks to RTT. */
            pendingAttackAngle: null,
            eatChannel: null,
            connected: true,
            viewChunks: INTEREST,
            poseAuth: false,
            lastInputMs: 0,
            look: Look.normalizeLook(null)
        };
    }

    _pawnFromSave(saved, displayName) {
        const p = {
            ...this._freshPawn(saved.id, displayName || saved.name),
            x: saved.x,
            y: saved.y,
            facing: saved.facing || "down",
            kc: saved.kc ?? 1200,
            saturation: saved.saturation ?? 0,
            stomach: saved.stomach ?? 1600,
            inventory: Array.isArray(saved.inventory) ? saved.inventory : emptyInv(5),
            equipment: saved.equipment || { head: null, torso: null, legs: null, feet: null, waist: [] },
            hotbarIndex: saved.hotbarIndex || 0,
            hp: saved.hp ?? 100,
            mhp: saved.mhp ?? 100,
            body: saved.body || null,
            dead: !!(saved.hp != null && saved.hp <= 0)
        };
        // Stale pose from a previous world seed / water / void → random near origin
        const seedMismatch = saved.worldSeed == null || saved.worldSeed !== this.seed;
        if (seedMismatch || this.isBlocked(p.x, p.y)) {
            const pose = this._pickRandomSpawnPose(4);
            p.x = pose.x;
            p.y = pose.y;
            p.dead = false;
            if (p.hp <= 0) p.hp = p.mhp;
        }
        return p;
    }

    removePlayer(playerId, { save = false } = {}) {
        const p = this.players.get(playerId);
        if (!p) return null;
        this._cancelChannels(p);
        p.connected = false;
        this._saveLogoutPose(p);
        const finalYou = this.youPayload(playerId);
        this._clearPlayerCampfireAttend(playerId);
        this.players.delete(playerId);
        this.creatures.delete(playerId);
        if (p.creature) p.creature = null;
        this.pushEvent({ kind: "chat", text: `${p.name} left.`, system: true });
        // Persist pose immediately so rejoin works before the next autosave.
        try {
            this.saveAll();
        } catch (e) {
            console.warn("[world] logout pose save failed", e);
        }
        return finalYou;
    }

    _cancelChannels(p) {
        const wasEating = !!p.eatChannel;
        p.eatChannel = null;
        p.attackTimer = 0;
        p.attackArt = null;
        if (wasEating) {
            this.pushEvent({
                kind: "channel",
                playerId: p.id,
                channel: "eat",
                progress: 0,
                done: true,
                cancelled: true
            });
            this._youDirty.add(p.id);
        }
    }

    pushEvent(ev) {
        this._events.push(ev);
    }

    /**
     * Command / admin feedback: print on the server console and send system chat.
     * @param {string} text
     * @param {{ to?: string, except?: string }} [opts]
     */
    announceCmd(text, opts = {}) {
        const msg = String(text || "");
        if (!msg) return;
        const to = opts.to || null;
        const except = opts.except || null;
        if (to) {
            const name = this.players.get(to)?.name || String(to).slice(0, 8);
            console.log(`[cmd → ${name}] ${msg}`);
        } else {
            console.log(`[cmd] ${msg}`);
        }
        const ev = { kind: "chat", text: msg, system: true, cmd: true };
        if (to) ev.to = to;
        if (except) ev.except = except;
        this.pushEvent(ev);
    }

    drainEvents() {
        const e = this._events;
        this._events = [];
        return e;
    }

    drainYouDirty() {
        const ids = [...this._youDirty];
        this._youDirty.clear();
        return ids;
    }

    setMove(playerId, { x = 0, y = 0, sprint = false, facing = null, px = null, py = null, viewChunks = null } = {}) {
        const p = this.players.get(playerId);
        if (!p || p.dead) return;
        const len = Math.hypot(x, y);
        if (!(len > 0)) {
            p.moveX = 0;
            p.moveY = 0;
        } else {
            p.moveX = x / len;
            p.moveY = y / len;
        }
        p.sprint = !!sprint && p.kc > 0;
        if (facing) p.facing = facing;
        else if (p.moveX !== 0 || p.moveY !== 0) {
            if (Math.abs(p.moveX) > Math.abs(p.moveY)) p.facing = p.moveX > 0 ? "right" : "left";
            else p.facing = p.moveY > 0 ? "down" : "up";
        }
        // Presence mode: trust client world pose so remotes match what each player sees
        if (Number.isFinite(px) && Number.isFinite(py)) {
            p.x = px;
            p.y = py;
            p.poseAuth = true;
        }
        // Client render/cull radius in chunks — keep server gen ahead of the viewport
        if (Number.isFinite(viewChunks)) {
            const v = Math.floor(Number(viewChunks));
            if (v >= 1 && v <= 24) p.viewChunks = v;
        }
    }

    /** Chunk Chebyshev radius to generate/stream around a player. */
    interestRadius(p = null) {
        const floor = INTEREST;
        const view = p?.viewChunks != null ? Math.floor(Number(p.viewChunks)) : floor;
        // +1 so edges stay filled while moving between snapshot syncs
        return Math.max(floor, Math.min(24, view + 1));
    }

    handleAction(playerId, action) {
        const p = this.players.get(playerId);
        if (!p) return;
        const type = action?.type;
        if (type === Protocol.Actions.CHAT) {
            const text = String(action.text || "").slice(0, 200);
            if (!text) return;
            if (text.startsWith("/")) {
                console.log(`[cmd] ${p.name}: ${text}`);
                this._runCommand(p, text);
                return;
            }
            this.pushEvent({ kind: "chat", text: `<${p.name}> ${text}`, from: p.id });
            return;
        }
        if (type === Protocol.Actions.DIE) {
            this._kill(p, null, action);
            return;
        }
        if (p.dead) {
            if (type === Protocol.Actions.RESPAWN) this.respawn(p);
            return;
        }
        if (type === Protocol.Actions.CANCEL_CHANNEL) {
            this._cancelChannels(p);
            return;
        }
        if (type === Protocol.Actions.HOTBAR) {
            const i = Number(action.index);
            if (Number.isInteger(i) && i >= 0 && i < p.inventory.length) p.hotbarIndex = i;
            this._youDirty.add(p.id);
            return;
        }
        if (type === Protocol.Actions.INV_SWAP) {
            this._tryInvSwap(p, action);
            return;
        }
        if (type === Protocol.Actions.EQUIP) {
            this._tryEquip(p, action);
            return;
        }
        if (type === Protocol.Actions.UNEQUIP) {
            this._tryUnequip(p, action);
            return;
        }
        if (type === Protocol.Actions.EQUIP_SWAP) {
            this._tryEquipSwap(p, action);
            return;
        }
        if (type === Protocol.Actions.KNAP) {
            this._tryKnap(p, action);
            return;
        }
        if (type === Protocol.Actions.PICKUP) {
            this._tryPickup(p, action.dropId || null);
            return;
        }
        if (type === Protocol.Actions.CORPSE_TAKE) {
            this._tryCorpseTake(p, action);
            return;
        }
        if (type === Protocol.Actions.CORPSE_SKIN) {
            this._tryCorpseSkin(p, action);
            return;
        }
        if (type === Protocol.Actions.CORPSE_DISMISS) {
            this._tryCorpseDismiss(p, action);
            return;
        }
        if (type === Protocol.Actions.MOB_DEATH) {
            this._tryMobDeath(p, action);
            return;
        }
        if (type === Protocol.Actions.HARVEST) {
            this._tryHarvest(p, action);
            return;
        }
        if (type === Protocol.Actions.SPAWN_MOB) {
            // Debug G-key used to send this. Spawns are /spawn chat only.
            return;
        }
        if (type === Protocol.Actions.DROP) {
            this._tryDrop(p, action);
            return;
        }
        if (type === Protocol.Actions.SPAWN_DROP) {
            this._spawnWorldDrop(p, action);
            return;
        }
        if (type === Protocol.Actions.USE) {
            this._tryUse(p);
            return;
        }
        if (type === Protocol.Actions.TEND) {
            this._tryTend(p, action);
            return;
        }
        if (type === Protocol.Actions.LIGHT_FIRE) {
            this._tryLightFire(p, action);
            return;
        }
        if (type === Protocol.Actions.CAMPFIRE) {
            this._tryCampfire(p, action);
            return;
        }
        if (type === Protocol.Actions.CRAFT) {
            this._tryCraft(p, action);
            return;
        }
        if (type === Protocol.Actions.ATTACK) {
            this._tryAttack(p, Number(action.angle) || 0);
            return;
        }
        if (type === Protocol.Actions.COMMAND) {
            this._runCommand(p, String(action.text || ""));
        }
    }

    _runCommand(p, text) {
        const parts = text.trim().split(/\s+/);
        const cmd = (parts[0] || "").toLowerCase();
        if (cmd === "/heal" || cmd === "/h") {
            p.hp = p.mhp;
            p.dead = false;
            p.kc = p.stomach;
            this._resetPlayerAnatomy(p);
            this._youDirty.add(p.id);
            return;
        }
        if (cmd === "/give") {
            const rawId = String(parts[1] || "").toLowerCase().replace(/-/g, "_");
            if (!rawId) {
                this.announceCmd("Usage: /give <item> [qty]", { to: p.id });
                return;
            }
            let qty = 1;
            if (parts[2] != null && parts[2] !== "") {
                qty = Number(parts[2]);
                if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) {
                    this.announceCmd("Usage: /give <item> [qty]", { to: p.id });
                    return;
                }
                qty = Math.min(9999, Math.floor(qty));
            }
            const meta = itemDefs().get(rawId)
                || [...itemDefs().values()].find((it) =>
                    (it.name || "").toLowerCase().replace(/\s+/g, "_") === rawId
                    || (it.name || "").toLowerCase() === rawId.replace(/_/g, " ")
                );
            if (!meta?.id) {
                this.announceCmd(`Unknown item "${parts[1]}".`, { to: p.id });
                return;
            }
            const spoilLeft = Spoil.defaultSpoilLeft(meta);
            const extras = spoilLeft != null ? { spoilLeft } : null;
            const left = this._give(p, meta.id, qty, extras);
            if (left > 0) {
                this._pushDrop(p.x, p.y, { id: meta.id, quantity: left });
            }
            const label = meta.name || meta.id;
            const out = left > 0
                ? `Gave ${qty}× ${label} (${left} dropped on ground)`
                : `Gave ${qty}× ${label}`;
            this.announceCmd(out, { to: p.id });
            return;
        }
        if (cmd === "/spawn") {
            const kind = (parts[1] || "").toLowerCase();
            if (!kind) {
                this.announceCmd("Usage: /spawn <mob>", { to: p.id });
                return;
            }
            const mob = this._spawnMobAt(kind, p.x, p.y);
            if (!mob) {
                this.announceCmd(`Unknown mob "${kind}".`, { to: p.id });
                return;
            }
            const label = mobDefs().get(mob.id)?.name || mob.id;
            this.announceCmd(`Spawned ${label}`, { to: p.id });
            return;
        }
        if (cmd === "/kill") {
            this._kill(p, null);
            this.announceCmd(`${p.name} used /kill.`, { except: p.id });
            return;
        }
        if (cmd === "/regen") {
            this.regenWorld(p);
            return;
        }
        if (cmd === "/tick") {
            const arg = parts[1];
            if (arg == null || arg === "") {
                this.announceCmd(`Tick speed: ${this.tickSpeed}×`, { to: p.id });
                return;
            }
            const m = Number(arg);
            if (!Number.isFinite(m) || m < 0) {
                this.announceCmd(
                    "Usage: /tick [speed]  (1 = normal, 60 ≈ 1 game hour/sec, 0 = pause)",
                    { to: p.id }
                );
                return;
            }
            this.tickSpeed = m;
            this._minuteAcc = 0;
            this.announceCmd(`${p.name} set tick speed to ${m}×.`);
            return;
        }
        if (cmd === "/time") {
            if (parts.length < 2) {
                const h = Math.floor(this.gameMinutes / 60);
                const m = this.gameMinutes % 60;
                this.announceCmd(
                    `Day ${this.gameDay}  ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${this.tickSpeed}×)`,
                    { to: p.id }
                );
                return;
            }
            const h = Number(parts[1]);
            const m = parts[2] != null ? Number(parts[2]) : 0;
            if (!Number.isFinite(h) || h < 0 || h > 23 || !Number.isFinite(m) || m < 0 || m > 59) {
                this.announceCmd("Usage: /time [HH] [MM]", { to: p.id });
                return;
            }
            this.gameMinutes = Math.floor(h) * 60 + Math.floor(m);
            this._minuteAcc = 0;
            this.announceCmd(
                `${p.name} set the time to ${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor(m)).padStart(2, "0")}`
            );
            return;
        }
        if (cmd === "/tp" || cmd === "/teleport") {
            const usage = "Usage: /tp <x> <y>  (tile coords)";
            if (parts.length < 3) {
                this.announceCmd(usage, { to: p.id });
                return;
            }
            const tx = Number(parts[1]);
            const ty = Number(parts[2]);
            if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
                this.announceCmd(usage, { to: p.id });
                return;
            }
            // Bottom-middle of the 16px human sprite (origin is bottom-left)
            p.x = tx * TS - TS / 2;
            p.y = ty * TS;
            p.poseAuth = true;
            this._interestLoad(p.x, p.y, this.interestRadius(p));
            this._youDirty.add(p.id);
            this.announceCmd(`Teleported to ${tx}, ${ty}`, { to: p.id });
            return;
        }
        this.announceCmd(`Unknown command: ${cmd}`, { to: p.id });
    }

    /**
     * Wipe all chunks/mobs/drops, keep the same seed, reload interest for everyone.
     * Clients apply via world_regen event + RESYNC.
     */
    regenWorld(byPlayer) {
        WorldGen.applySeed(this.seed);
        this.rng = mulberry32(this.seed >>> 0);
        GameMath.setRng(() => this.rng());
        this.chunks.clear();
        this.mobs.clear();
        this.poses = {};
        try {
            SaveIO.clearPlayers(this.root, this.worldName);
        } catch (_) {}
        this._findSpawnClearing();
        for (const pl of this.players.values()) {
            if (!pl.connected) continue;
            // Keep pose if still walkable; otherwise scatter near origin
            if (this.isBlocked(pl.x, pl.y)) {
                const pose = this._pickRandomSpawnPose(4);
                pl.x = pose.x;
                pl.y = pose.y;
            }
            this._interestLoad(pl.x, pl.y, this.interestRadius(pl));
            this._youDirty.add(pl.id);
        }
        this.saveAll();
        this.pushEvent({
            kind: "world_regen",
            seed: this.seed,
            by: byPlayer?.name || "server"
        });
        this.pushEvent({
            kind: "chat",
            text: `${byPlayer?.name || "Server"} regenerated the world.`,
            system: true,
            except: byPlayer?.id || null
        });
        console.log(`[world] /regen by ${byPlayer?.name || "?"} (seed ${this.seed})`);
    }

    respawn(p) {
        p.dead = false;
        p.hp = p.mhp;
        const pose = this._pickRandomSpawnPose(4);
        p.x = pose.x;
        p.y = pose.y;
        p.kc = 1200;
        p.saturation = 0;
        this._cancelChannels(p);
        p.pendingAttackAngle = null;
        this._resetPlayerAnatomy(p);
        this._syncPlayerCreature(p);
        this._interestLoad(p.x, p.y, this.interestRadius(p));
        this._youDirty.add(p.id);
    }

    /**
     * @returns {number} quantity that did not fit
     */
    _give(p, itemId, qty, extras = null) {
        let remaining = Math.max(0, Math.floor(Number(qty) || 0));
        if (!itemId || remaining <= 0) return remaining;
        const meta = itemDefs().get(itemId);
        const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
        const tookStart = remaining;
        const now = this.worldMinuteIndex();
        let incomingLeft = Spoil.spoilLeftForCharacter(extras, now);
        if (incomingLeft == null && meta) {
            incomingLeft = Spoil.defaultSpoilLeft(meta);
        }
        const incomingUnique = this._stackIsSpecial(extras);
        for (let i = 0; i < p.inventory.length && remaining > 0; i++) {
            const s = p.inventory[i];
            if (!s || s.id !== itemId || this._stackIsSpecial(s) || incomingUnique) continue;
            const space = Math.max(0, maxStack - (s.quantity || 1));
            if (space <= 0) continue;
            const add = Math.min(space, remaining);
            if (incomingLeft != null) {
                s.spoilLeft = Spoil.mergeSpoilLeft(
                    s.quantity || 1, s.spoilLeft,
                    add, incomingLeft
                );
                delete s.spoilAt;
            }
            s.quantity = (s.quantity || 1) + add;
            remaining -= add;
        }
        for (let i = 0; i < p.inventory.length && remaining > 0; i++) {
            if (p.inventory[i]) continue;
            const add = Math.min(maxStack, remaining);
            const slot = { id: itemId, quantity: add };
            this._applyStackExtras(slot, extras);
            if (incomingLeft != null) slot.spoilLeft = incomingLeft;
            p.inventory[i] = slot;
            remaining -= add;
        }
        if (remaining < tookStart) this._youDirty.add(p.id);
        return remaining;
    }

    _parseRecipe(itemId) {
        const meta = itemDefs().get(itemId);
        if (!meta?.recipe || typeof meta.recipe !== "object") return null;
        const ingredients = [];
        let requireThing = null;
        let quantity = 1;
        for (const [k, v] of Object.entries(meta.recipe)) {
            if (k === "QUANTITY") quantity = Math.max(1, Math.floor(Number(v) || 1));
            else if (k === "REQUIRE_THING") requireThing = String(v || "") || null;
            else if (v && typeof v === "object") {
                ingredients.push({
                    id: k,
                    qty: Math.max(1, Math.floor(Number(v.qty) || 1)),
                    toolClass: v.toolClass ? String(v.toolClass) : null
                });
            } else {
                ingredients.push({
                    id: k,
                    qty: Math.max(1, Math.floor(Number(v) || 1)),
                    toolClass: null
                });
            }
        }
        if (!ingredients.length) return null;
        return { id: meta.id, ingredients, quantity, requireThing };
    }

    _countMatchingItems(p, match) {
        const id = match?.id;
        const wantClass = match?.toolClass || null;
        if (!id || !Array.isArray(p?.inventory)) return 0;
        let sum = 0;
        for (const s of p.inventory) {
            if (!s || s.id !== id) continue;
            if (wantClass && s.toolClass !== wantClass) continue;
            sum += Math.max(0, Math.floor(Number(s.quantity) || 0));
        }
        return sum;
    }

    _loseMatchingItems(p, match) {
        const id = match?.id;
        let remaining = Math.max(0, Math.floor(Number(match?.qty) || 1));
        const wantClass = match?.toolClass || null;
        if (!id || !(remaining > 0) || !Array.isArray(p?.inventory)) return { lost: 0, knapQuality: null };
        let lost = 0;
        let knapQuality = null;
        const takeFrom = (requireClass) => {
            for (let i = 0; i < p.inventory.length && remaining > 0; i++) {
                const s = p.inventory[i];
                if (!s || s.id !== id) continue;
                if (requireClass && s.toolClass !== requireClass) continue;
                if (!requireClass && wantClass && s.toolClass === wantClass) continue;
                if (knapQuality == null && s.knapQuality) knapQuality = s.knapQuality;
                const have = Math.max(0, Math.floor(Number(s.quantity) || 0));
                const take = Math.min(have, remaining);
                if (!(take > 0)) continue;
                s.quantity = have - take;
                remaining -= take;
                lost += take;
                if (!(s.quantity > 0)) p.inventory[i] = null;
            }
        };
        if (wantClass) takeFrom(wantClass);
        if (!wantClass) takeFrom(null);
        return { lost, knapQuality };
    }

    _hasNearbyThing(p, thingId) {
        if (!p || !thingId) return false;
        const range2 = (TS * HARVEST_RANGE_TILES) * (TS * HARVEST_RANGE_TILES);
        for (const c of this._chunksNear(p.x, p.y, 1)) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!t || t.id !== thingId) continue;
                const dx = t.x - p.x;
                const dy = t.y - p.y;
                if (dx * dx + dy * dy <= range2) return true;
            }
        }
        return false;
    }

    _tryCraft(p, action = {}) {
        if (!p || p.dead) return;
        const id = String(action.id || "").slice(0, 64);
        const recipe = this._parseRecipe(id);
        if (!recipe) return;
        for (const ing of recipe.ingredients) {
            if (this._countMatchingItems(p, ing) < ing.qty) return;
        }
        if (recipe.requireThing && !this._hasNearbyThing(p, recipe.requireThing)) return;

        let tipQuality = null;
        for (const ing of recipe.ingredients) {
            const { knapQuality } = this._loseMatchingItems(p, ing);
            if (ing.toolClass === "spear_tip" && knapQuality) tipQuality = knapQuality;
        }

        const extras = {};
        if (tipQuality && (recipe.id === "stone_spear" || recipe.id === "flint_spear")) {
            extras.knapQuality = tipQuality;
        }
        const left = this._give(p, recipe.id, recipe.quantity, extras);
        if (left > 0) {
            this._pushDrop(p.x, p.y, {
                id: recipe.id,
                quantity: left,
                ...(extras.knapQuality ? { knapQuality: extras.knapQuality } : {})
            });
        }
        this._youDirty.add(p.id);
    }

    _held(p) {
        return p.inventory[p.hotbarIndex] || null;
    }

    _stackIsSpecial(s) {
        return !!(s && (
            s.customName || s.food || s.ingredients || s.toolClass
            || s.knapIconData || s.knapDamage != null || s.knapQuality
        ));
    }

    _stackExtrasFrom(src) {
        if (!src) return null;
        const out = {};
        if (src.customName) out.customName = src.customName;
        if (src.food) out.food = { ...src.food };
        if (src.ingredients) {
            out.ingredients = Array.isArray(src.ingredients)
                ? src.ingredients.slice()
                : { ...src.ingredients };
        }
        if (src.toolClass) out.toolClass = src.toolClass;
        if (src.sharpness != null) out.sharpness = src.sharpness;
        if (src.knapDamage != null) out.knapDamage = src.knapDamage;
        if (src.knapMaterial) out.knapMaterial = src.knapMaterial;
        if (src.knapQuality) out.knapQuality = src.knapQuality;
        if (src.tooltipExtra) out.tooltipExtra = src.tooltipExtra;
        if (src.knapIconData) out.knapIconData = src.knapIconData;
        if (src.spoilLeft != null) out.spoilLeft = src.spoilLeft;
        if (src.spoilAt != null) out.spoilAt = src.spoilAt;
        return Object.keys(out).length ? out : null;
    }

    _applyStackExtras(slot, extras) {
        if (!slot || !extras) return slot;
        if (extras.customName) slot.customName = extras.customName;
        if (extras.food) slot.food = { ...extras.food };
        if (extras.ingredients) {
            slot.ingredients = Array.isArray(extras.ingredients)
                ? extras.ingredients.slice()
                : { ...extras.ingredients };
        }
        if (extras.toolClass) slot.toolClass = extras.toolClass;
        if (extras.sharpness != null) slot.sharpness = extras.sharpness;
        if (extras.knapDamage != null) slot.knapDamage = extras.knapDamage;
        if (extras.knapMaterial) slot.knapMaterial = extras.knapMaterial;
        if (extras.knapQuality) slot.knapQuality = extras.knapQuality;
        if (extras.tooltipExtra) slot.tooltipExtra = extras.tooltipExtra;
        if (extras.knapIconData) slot.knapIconData = extras.knapIconData;
        if (extras.spoilLeft != null) slot.spoilLeft = extras.spoilLeft;
        if (extras.spoilAt != null) slot.spoilAt = extras.spoilAt;
        return slot;
    }

    /** Snapshot/public wire shape for a ground drop (includes tip quality, knap fields). */
    _publicDrop(d, c) {
        if (!d) return null;
        const out = {
            uid: d.uid || null,
            id: d.id,
            quantity: d.quantity || 1,
            x: d.x,
            y: d.y,
            food: d.food || undefined,
            customName: d.customName || undefined,
            spoilAt: d.spoilAt,
            cx: c?.cx,
            cy: c?.cy
        };
        const extras = this._stackExtrasFrom(d);
        if (extras) {
            // World drops use spoilAt; don't also ship spoilLeft
            delete extras.spoilLeft;
            Object.assign(out, extras);
        }
        return out;
    }

    _sanitizeKnapIconData(raw) {
        if (typeof raw !== "string") return null;
        if (raw.length < 8 || raw.length > 4096) return null;
        return raw;
    }

    _sanitizeKnapStack(raw, material) {
        if (!raw || typeof raw !== "object") return null;
        const wantId = material === "flint" ? "flint_tool" : "stone_tool";
        const id = String(raw.id || "");
        if (id !== wantId) return null;
        const classes = new Set(["knife", "scraper", "chopper", "awl", "spear_tip", "blank"]);
        const toolClass = classes.has(raw.toolClass) ? raw.toolClass : "blank";
        const out = { id, quantity: 1, toolClass };
        if (typeof raw.customName === "string" && raw.customName.trim()) {
            out.customName = raw.customName.trim().slice(0, 64);
        }
        const dmg = Number(raw.knapDamage);
        if (Number.isFinite(dmg)) out.knapDamage = Math.max(0, Math.min(100, dmg));
        const sharp = Number(raw.sharpness);
        if (Number.isFinite(sharp)) out.sharpness = Math.max(0, Math.min(2, sharp));
        if (typeof raw.knapQuality === "string") out.knapQuality = raw.knapQuality.slice(0, 24);
        if (typeof raw.tooltipExtra === "string") out.tooltipExtra = raw.tooltipExtra.slice(0, 80);
        out.knapMaterial = material === "flint" ? "flint" : "pebble";
        const icon = this._sanitizeKnapIconData(raw.knapIconData);
        if (icon) out.knapIconData = icon;
        return out;
    }

    /** Place a unique stack (knapped tool). Drops at feet if inventory is full. */
    _insertUniqueStack(p, stack, preferSlot = -1) {
        if (!p || !stack?.id) return false;
        if (!Array.isArray(p.inventory)) p.inventory = [];
        const clone = { id: stack.id, quantity: Math.max(1, Math.floor(Number(stack.quantity) || 1)) };
        this._applyStackExtras(clone, this._stackExtrasFrom(stack));
        const prefer = Math.floor(Number(preferSlot));
        if (Number.isInteger(prefer) && prefer >= 0 && prefer < p.inventory.length && !p.inventory[prefer]) {
            p.inventory[prefer] = clone;
            this._youDirty.add(p.id);
            return true;
        }
        for (let i = 0; i < p.inventory.length; i++) {
            if (p.inventory[i]) continue;
            p.inventory[i] = clone;
            this._youDirty.add(p.id);
            return true;
        }
        this._pushDrop(p.x, p.y, this._cloneStackForWorld(clone));
        this._youDirty.add(p.id);
        return false;
    }

    _knapMaterialOf(stack) {
        if (!stack?.id) return null;
        if (stack.knapMaterial === "flint" || stack.id === "flint_tool" || stack.id === "flint") {
            return "flint";
        }
        if (stack.knapMaterial === "pebble" || stack.id === "stone_tool" || stack.id === "pebble") {
            return "pebble";
        }
        const meta = itemDefs().get(stack.id);
        const mat = meta?.knapping?.material;
        if (mat === "flint" || mat === "pebble") return mat;
        return null;
    }

    _tryKnap(p, action = {}) {
        if (!p || p.dead) return;
        const op = String(action.op || "");
        const slot = Math.floor(Number(action.slot));
        const inv = p.inventory;
        if (!Array.isArray(inv)) return;
        if (!Number.isInteger(slot) || slot < 0 || slot >= inv.length) return;

        if (op === "consume") {
            if (p._knapSession) return;
            const held = inv[slot];
            if (!held?.id || !(held.quantity > 0)) return;
            const wantId = action.id ? String(action.id) : null;
            if (wantId && held.id !== wantId) return;
            const rework = (held.id === "stone_tool" || held.id === "flint_tool") && !!held.knapIconData;
            const meta = itemDefs().get(held.id);
            const blank = !!meta?.knapping?.material;
            if (!rework && !blank) return;
            const material = this._knapMaterialOf(held);
            if (!material) return;
            held.quantity = (held.quantity || 1) - 1;
            if (held.quantity <= 0) inv[slot] = null;
            p._knapSession = { slot, id: held.id, material, rework: !!rework };
            this._youDirty.add(p.id);
            return;
        }

        if (op === "orient") {
            if (p._knapSession) return;
            const held = inv[slot];
            if (!held || (held.id !== "stone_tool" && held.id !== "flint_tool")) return;
            const icon = this._sanitizeKnapIconData(action.knapIconData);
            if (!icon) return;
            held.knapIconData = icon;
            delete held.knapIcon;
            this._youDirty.add(p.id);
            return;
        }

        if (op === "abort") {
            p._knapSession = null;
            return;
        }

        if (op === "finish") {
            const session = p._knapSession;
            if (!session) return;
            const stack = this._sanitizeKnapStack(action.stack, session.material);
            p._knapSession = null;
            if (!stack) return;
            this._insertUniqueStack(p, stack, session.slot);
        }
    }

    /** Swap or merge two hotbar slots (client drag-drop). */
    _tryInvSwap(p, action = {}) {
        if (!p || p.dead) return;
        const from = Math.floor(Number(action.from));
        const to = Math.floor(Number(action.to));
        const inv = p.inventory;
        if (!Array.isArray(inv)) return;
        if (!Number.isInteger(from) || !Number.isInteger(to)) return;
        if (from === to) return;
        if (from < 0 || to < 0 || from >= inv.length || to >= inv.length) return;
        const a = inv[from];
        if (!a?.id) return;
        const b = inv[to];
        if (b && a.id === b.id && !this._stackIsSpecial(a) && !this._stackIsSpecial(b)) {
            const meta = itemDefs().get(a.id);
            const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
            const space = Math.max(0, maxStack - (b.quantity || 1));
            if (space > 0) {
                const moved = Math.min(space, a.quantity || 1);
                b.spoilLeft = Spoil.mergeSpoilLeft(
                    b.quantity || 1, b.spoilLeft,
                    moved, a.spoilLeft
                );
                delete b.spoilAt;
                b.quantity = (b.quantity || 1) + moved;
                a.quantity = (a.quantity || 1) - moved;
                if (!(a.quantity > 0)) inv[from] = null;
            } else {
                inv[from] = b;
                inv[to] = a;
            }
        } else {
            inv[to] = a;
            inv[from] = b || null;
        }
        p.hotbarIndex = to;
        if (p.creature) p.creature.hotbarIndex = to;
        this._youDirty.add(p.id);
    }

    _ensureEquipment(p) {
        if (!p.equipment || typeof p.equipment !== "object") {
            p.equipment = { head: null, torso: null, legs: null, feet: null, waist: [] };
        }
        if (!Array.isArray(p.equipment.waist)) p.equipment.waist = [];
        return p.equipment;
    }

    _equipSlotName(itemId) {
        const meta = itemDefs().get(itemId);
        return meta?.equip?.slot || null;
    }

    _waistGrant(itemId) {
        const add = itemDefs().get(itemId)?.equip?.effects?.addSlot;
        if (!Array.isArray(add)) return 0;
        let n = 0;
        for (const s of add) if (s === "waist") n++;
        return n;
    }

    _waistCapacity(p) {
        this._ensureEquipment(p);
        let n = 0;
        for (const key of ["head", "torso", "legs", "feet"]) {
            const stack = p.equipment[key];
            if (stack?.id) n += this._waistGrant(stack.id);
        }
        return n;
    }

    _waistOccupied(p) {
        this._ensureEquipment(p);
        let n = 0;
        for (const s of p.equipment.waist) if (s) n++;
        return n;
    }

    _syncWaistSlots(p) {
        const cap = this._waistCapacity(p);
        const w = this._ensureEquipment(p).waist;
        while (w.length < cap) w.push(null);
        if (w.length > cap) w.length = cap;
    }

    _hotbarBonus(p) {
        this._ensureEquipment(p);
        let n = 0;
        const pieces = [
            p.equipment.head,
            p.equipment.torso,
            p.equipment.legs,
            p.equipment.feet,
            ...p.equipment.waist
        ];
        for (const stack of pieces) {
            if (!stack?.id) continue;
            const add = itemDefs().get(stack.id)?.equip?.effects?.addSlot;
            if (!Array.isArray(add)) continue;
            for (const s of add) if (s === "hotbar") n++;
        }
        return n;
    }

    _syncPlayerInvSize(p) {
        const size = Math.max(5, 5 + this._hotbarBonus(p));
        if (!Array.isArray(p.inventory)) p.inventory = [];
        while (p.inventory.length < size) p.inventory.push(null);
        if (p.inventory.length > size) {
            for (let i = size; i < p.inventory.length; i++) {
                const s = p.inventory[i];
                if (s?.id) this._pushDrop(p.x, p.y, this._cloneStackForWorld(s));
            }
            p.inventory.length = size;
        }
        if (p.hotbarIndex >= size) p.hotbarIndex = Math.max(0, size - 1);
    }

    _getEquipStack(p, slotKey) {
        this._ensureEquipment(p);
        if (String(slotKey).startsWith("waist:")) {
            const i = parseInt(String(slotKey).slice(6), 10);
            if (!Number.isInteger(i) || i < 0) return null;
            return p.equipment.waist[i] || null;
        }
        if (!["head", "torso", "legs", "feet"].includes(slotKey)) return null;
        return p.equipment[slotKey] || null;
    }

    _setEquipStack(p, slotKey, stack) {
        this._ensureEquipment(p);
        if (String(slotKey).startsWith("waist:")) {
            const i = parseInt(String(slotKey).slice(6), 10);
            if (!Number.isInteger(i) || i < 0 || i > 16) return false;
            while (p.equipment.waist.length <= i) p.equipment.waist.push(null);
            p.equipment.waist[i] = stack;
            return true;
        }
        if (!["head", "torso", "legs", "feet"].includes(slotKey)) return false;
        p.equipment[slotKey] = stack;
        return true;
    }

    _canChangeBodySlot(p, slotName, incomingId) {
        if (slotName === "waist" || String(slotName).startsWith("waist:")) return true;
        const current = p.equipment?.[slotName];
        const oldGrant = current?.id ? this._waistGrant(current.id) : 0;
        const newGrant = incomingId ? this._waistGrant(incomingId) : 0;
        const newCap = this._waistCapacity(p) - oldGrant + newGrant;
        return this._waistOccupied(p) <= newCap;
    }

    _parseEquipSlot(slotKey) {
        const key = String(slotKey || "");
        if (["head", "torso", "legs", "feet"].includes(key)) {
            return { key, body: key, waist: false, index: -1 };
        }
        if (key.startsWith("waist:")) {
            const i = parseInt(key.slice(6), 10);
            if (!Number.isInteger(i) || i < 0 || i > 16) return null;
            return { key, body: "waist", waist: true, index: i };
        }
        return null;
    }

    _tryEquip(p, action = {}) {
        if (!p || p.dead) return;
        const from = Math.floor(Number(action.from));
        const parsed = this._parseEquipSlot(action.slot);
        if (!parsed || !Number.isInteger(from) || from < 0) return;
        const inv = p.inventory;
        if (!Array.isArray(inv) || from >= inv.length) return;
        const stack = inv[from];
        if (!stack?.id) return;
        const want = this._equipSlotName(stack.id);
        if (!want || want !== parsed.body) return;
        if (parsed.waist) {
            if (parsed.index >= this._waistCapacity(p)) return;
        } else if (!this._canChangeBodySlot(p, parsed.key, stack.id)) {
            return;
        }
        const existing = this._getEquipStack(p, parsed.key);
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        if (qty !== 1 && existing) return;
        const one = this._cloneGearStack(stack, 1);
        if (qty > 1) {
            stack.quantity = qty - 1;
            this._setEquipStack(p, parsed.key, one);
            if (existing) {
                const empty = inv.findIndex((s) => !s);
                if (empty !== -1) inv[empty] = existing;
                else {
                    inv.push(existing);
                }
            }
        } else {
            inv[from] = existing || null;
            this._setEquipStack(p, parsed.key, one);
        }
        this._syncWaistSlots(p);
        this._syncPlayerInvSize(p);
        this._youDirty.add(p.id);
    }

    _tryUnequip(p, action = {}) {
        if (!p || p.dead) return;
        const parsed = this._parseEquipSlot(action.slot);
        const to = Math.floor(Number(action.to));
        if (!parsed || !Number.isInteger(to) || to < 0) return;
        const equipped = this._getEquipStack(p, parsed.key);
        if (!equipped?.id) return;
        if (!parsed.waist && !this._canChangeBodySlot(p, parsed.key, null)) return;
        const inv = p.inventory;
        if (!Array.isArray(inv)) return;
        while (inv.length <= to) inv.push(null);
        const dest = inv[to];
        if (!dest) {
            inv[to] = equipped;
            this._setEquipStack(p, parsed.key, null);
        } else if (dest.id === equipped.id && !this._stackIsSpecial(dest) && !this._stackIsSpecial(equipped)) {
            const meta = itemDefs().get(dest.id);
            const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
            const eqQty = Math.max(1, Math.floor(Number(equipped.quantity) || 1));
            if ((dest.quantity || 1) + eqQty > maxStack) return;
            dest.spoilLeft = Spoil.mergeSpoilLeft(
                dest.quantity || 1, dest.spoilLeft,
                eqQty, equipped.spoilLeft
            );
            delete dest.spoilAt;
            dest.quantity = (dest.quantity || 1) + eqQty;
            this._setEquipStack(p, parsed.key, null);
        } else {
            const destWant = this._equipSlotName(dest.id);
            if (!destWant || destWant !== parsed.body) return;
            if (!parsed.waist && !this._canChangeBodySlot(p, parsed.key, dest.id)) return;
            inv[to] = equipped;
            this._setEquipStack(p, parsed.key, this._cloneGearStack(dest, 1));
            const destQty = Math.max(1, Math.floor(Number(dest.quantity) || 1));
            if (destQty > 1) {
                dest.quantity = destQty - 1;
                const empty = inv.findIndex((s) => !s);
                if (empty !== -1) inv[empty] = dest;
                else inv.push(dest);
            }
        }
        this._syncWaistSlots(p);
        this._syncPlayerInvSize(p);
        this._youDirty.add(p.id);
    }

    _tryEquipSwap(p, action = {}) {
        if (!p || p.dead) return;
        const from = this._parseEquipSlot(action.from);
        const to = this._parseEquipSlot(action.to);
        if (!from || !to || from.key === to.key) return;
        const a = this._getEquipStack(p, from.key);
        if (!a?.id) return;
        const aWant = this._equipSlotName(a.id);
        if (aWant !== to.body) return;
        const b = this._getEquipStack(p, to.key);
        if (b?.id) {
            const bWant = this._equipSlotName(b.id);
            if (bWant !== from.body) return;
        }
        if (!from.waist && !this._canChangeBodySlot(p, from.key, b?.id || null)) return;
        if (!to.waist && !this._canChangeBodySlot(p, to.key, a.id)) return;
        this._setEquipStack(p, from.key, b || null);
        this._setEquipStack(p, to.key, a);
        this._syncWaistSlots(p);
        this._syncPlayerInvSize(p);
        this._youDirty.add(p.id);
    }

    _cloneGearStack(stack, qty = null) {
        if (!stack?.id) return null;
        const out = {
            id: stack.id,
            quantity: qty != null ? qty : Math.max(1, Math.floor(Number(stack.quantity) || 1))
        };
        this._applyStackExtras(out, this._stackExtrasFrom(stack));
        if (stack.spoilLeft != null) out.spoilLeft = stack.spoilLeft;
        if (stack.spoilAt != null) out.spoilAt = stack.spoilAt;
        return out;
    }

    _pushDrop(wx, wy, drop) {
        if (!drop?.id) return null;
        let remaining = Math.max(1, Math.floor(Number(drop.quantity) || 1));
        const meta = itemDefs().get(drop.id);
        const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
        const incomingSpecial = this._stackIsSpecial(drop);
        const maxDist2 = TS * TS;
        let last = null;

        // Same as client DroppedItem.spawn: fill nearby plain piles first
        if (!incomingSpecial) {
            const nearby = [];
            for (const c of this._chunksNear(wx, wy, 1)) {
                if (!Array.isArray(c.drops)) continue;
                for (const pile of c.drops) {
                    if (!pile || pile.id !== drop.id) continue;
                    if (this._stackIsSpecial(pile)) continue;
                    const qty = Math.max(1, Math.floor(Number(pile.quantity) || 1));
                    if (qty >= maxStack) continue;
                    const dx = (Number(pile.x) || 0) - wx;
                    const dy = (Number(pile.y) || 0) - wy;
                    if (dx * dx + dy * dy > maxDist2) continue;
                    nearby.push({ pile, dist2: dx * dx + dy * dy });
                }
            }
            nearby.sort((a, b) => a.dist2 - b.dist2);
            for (const { pile } of nearby) {
                if (remaining <= 0) break;
                const qty = Math.max(1, Math.floor(Number(pile.quantity) || 1));
                const add = Math.min(maxStack - qty, remaining);
                if (!(add > 0)) continue;
                pile.spoilAt = Spoil.mergeSpoilAt(qty, pile.spoilAt, add, drop.spoilAt);
                pile.quantity = qty + add;
                // Merged stacks refresh despawn timer (matches client DroppedItem.spawn)
                pile.lifeMs = DROP_LIFE_MS;
                remaining -= add;
                last = pile;
            }
        }

        let usedUid = false;
        while (remaining > 0) {
            const add = Math.min(maxStack, remaining);
            const { cx, cy } = worldToChunk(wx, wy);
            const c = this._ensureChunk(cx, cy);
            if (!Array.isArray(c.drops)) c.drops = [];
            const entry = {
                uid: (!usedUid && drop.uid) ? drop.uid : uuid(),
                id: drop.id,
                quantity: add,
                x: wx,
                y: wy,
                lifeMs: DROP_LIFE_MS
            };
            usedUid = true;
            this._applyStackExtras(entry, this._stackExtrasFrom(drop));
            if (drop.spoilAt != null) entry.spoilAt = drop.spoilAt;
            c.drops.push(entry);
            last = entry;
            remaining -= add;
        }
        return last;
    }

    /** Character → world stack (spoilLeft → spoilAt). */
    _cloneStackForWorld(stack) {
        if (!stack?.id) return null;
        const out = {
            id: stack.id,
            quantity: Math.max(1, Math.floor(Number(stack.quantity) || 1))
        };
        this._applyStackExtras(out, this._stackExtrasFrom(stack));
        const now = this.worldMinuteIndex();
        const spoilAt = Spoil.spoilAtForWorld(stack, now);
        if (spoilAt != null) out.spoilAt = spoilAt;
        delete out.spoilLeft;
        return out;
    }

    _pushCorpse(opts) {
        const wx = Number(opts.x);
        const wy = Number(opts.y);
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
        const { cx, cy } = worldToChunk(wx, wy);
        const c = this._ensureChunk(cx, cy);
        if (!Array.isArray(c.corpses)) c.corpses = [];
        const entry = {
            id: opts.id || `c_${uuid()}`,
            x: wx,
            y: wy,
            key: opts.key || "human",
            look: opts.look || null,
            frame: opts.frame != null ? opts.frame : 7,
            name: opts.name || "Corpse",
            loot: (opts.loot || []).filter(Boolean),
            body: opts.body || null,
            bodyPlan: opts.bodyPlan || "human",
            mobId: opts.mobId || null,
            skinned: !!opts.skinned || opts.stage === "carcass",
            diedAt: opts.diedAt != null && Number.isFinite(Number(opts.diedAt))
                ? Math.round(Number(opts.diedAt))
                : this.worldMinuteIndex(),
            stage: opts.stage === "carcass" ? "carcass" : "corpse"
        };
        c.corpses.push(entry);
        this.pushEvent({ kind: "corpse", op: "add", cx, cy, entry });
        return entry;
    }

    _findCorpse(corpseId) {
        if (!corpseId) return null;
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.corpses)) continue;
            const index = c.corpses.findIndex((e) => e?.id === corpseId);
            if (index >= 0) return { chunk: c, index, entry: c.corpses[index] };
        }
        return null;
    }

    _meleeDamage(p) {
        const held = this._held(p);
        const meta = held ? itemDefs().get(held.id) : null;
        const atk = meta?.weapon?.attacks?.[0];
        const base = Number(atk?.damage);
        const dmg = Number.isFinite(base) && base > 0 ? base : 8;
        return dmg + this.rng() * (dmg * 0.35);
    }

    _lootFromMobDef(kind) {
        const def = mobDefs().get(kind);
        const loot = [];
        const now = this.worldMinuteIndex();
        for (const drop of def?.drops || []) {
            const itemId = drop.item;
            const meta = itemId ? itemDefs().get(itemId) : null;
            if (!meta) continue;
            let qty;
            if (drop.min != null || drop.max != null) {
                const lo = Math.max(0, Math.floor(Number(drop.min ?? drop.max) || 0));
                const hi = Math.max(lo, Math.floor(Number(drop.max ?? drop.min) || 0));
                qty = lo + Math.floor(this.rng() * (hi - lo + 1));
            } else {
                qty = Math.max(0, Math.floor(Number(drop.quantity) || 1));
            }
            if (!(qty > 0)) continue;
            const stack = { id: itemId, quantity: qty };
            const spoilAt = Spoil.defaultSpoilAt(meta, now);
            if (spoilAt != null) stack.spoilAt = spoilAt;
            loot.push(stack);
        }
        return loot;
    }

    _removeMobFromChunks(mobOrUid, wx = null, wy = null) {
        const uid = typeof mobOrUid === "string" ? mobOrUid : mobOrUid?.id || mobOrUid?.chunkUid;
        if (!uid) return null;
        const x = wx ?? mobOrUid?.x;
        const y = wy ?? mobOrUid?.y;
        const near = Number.isFinite(x) && Number.isFinite(y)
            ? this._chunksNear(x, y, 1)
            : this.chunks.values();
        for (const c of near) {
            if (!Array.isArray(c.mobs)) continue;
            const i = c.mobs.findIndex((m) => m && m.uid === uid);
            if (i >= 0) {
                const [entry] = c.mobs.splice(i, 1);
                return entry;
            }
        }
        return null;
    }

    _killMob(mob, killer) {
        if (!mob) return;
        this._finishMobDeath(mob, killer);
    }

    _killerLabel(killer) {
        if (!killer) return null;
        if (typeof killer === "string") {
            const s = killer.trim();
            return s || null;
        }
        const name =
            (typeof killer.displayName === "function" ? killer.displayName() : null) ||
            killer.name ||
            killer.def?.name ||
            null;
        const s = name != null ? String(name).trim() : "";
        return s || null;
    }

    _reapDeadPlayers() {
        for (const p of this.players.values()) {
            if (!p.connected || p.dead) continue;
            const creature = p.creature || this.creatures.get(p.id);
            if (!creature?.isBodyDead?.()) continue;
            p.body = creature.anatomy?.toJSON?.() || p.body;
            this._kill(p, creature._lastHitBy || null);
        }
    }

    /**
     * Fatal anatomy hits schedule onBodyFatal via queueMicrotask, so `_dead` often
     * flips AFTER the combat loop's death checks. Those mobs were then skipped by
     * liveMobs forever (no corpse). Reap any dead SimCreatures still in the map.
     */
    _reapDeadMobs() {
        for (const mob of [...this.mobs.values()]) {
            if (mob?.isBodyDead?.()) this._finishMobDeath(mob, mob._lastHitBy || null);
        }
    }

    /**
     * Client MOB_DEATH is no longer authoritative — server owns wildlife death.
     * Ignore unless the mob is already gone (lag compensate / no-op).
     */
    _tryMobDeath(_p, action = {}) {
        const uid = action.uid ? String(action.uid) : null;
        if (!uid) return;
        const live = this.mobs.get(uid);
        if (live && !live.isBodyDead()) {
            // Client thinks it's dead; server still owns it — ignore.
            return;
        }
        // Already dead/removed server-side: nothing to do.
    }

    _finishMobDeath(mob, killer = null) {
        if (!mob) return;
        const uid = mob.id;
        // Idempotent — microtask + reap / double-hit must not double-corpse
        if (!uid || !this.mobs.has(uid)) return;
        let corpse = mob.die?.() || mob._corpsePayload || null;
        // If die() was skipped somehow, still author a minimal lootable corpse.
        if (!corpse && Number.isFinite(mob.x) && Number.isFinite(mob.y)) {
            const c = typeof mob.bodyCenter === "function" ? mob.bodyCenter() : { x: mob.x, y: mob.y };
            corpse = {
                id: `c_${uuid()}`,
                x: c.x,
                y: c.y,
                key: mob.def?.key || "human",
                frame: 7,
                name: mob.def?.name || mob.name || "Corpse",
                loot: this._lootFromMobDef(mob.def?.id || mob.entry?.id),
                body: mob.anatomy?.toJSON?.() || null,
                bodyPlan: mob.def?.bodyPlan || mob.anatomy?.planId || "human",
                mobId: mob.def?.id || mob.entry?.id || null,
                skinned: false
            };
        }
        this._removeMobFromChunks(uid, mob.x, mob.y);
        this.mobs.delete(uid);
        this.pushEvent({ kind: "mob", op: "remove", uid });
        if (corpse) {
            this._pushCorpse({
                id: corpse.id,
                x: corpse.x,
                y: corpse.y,
                key: corpse.key,
                look: corpse.look || null,
                frame: corpse.frame != null ? corpse.frame : 7,
                name: corpse.name,
                loot: corpse.loot || [],
                body: corpse.body || null,
                bodyPlan: corpse.bodyPlan || "human",
                mobId: corpse.mobId || null,
                skinned: !!corpse.skinned
            });
        }
    }

    _skinLootTable(mobId) {
        const id = String(mobId || "");
        if (id === "deer") {
            return [
                { id: "raw_venison", min: 2, max: 4 },
                { id: "deer_hide", min: 1, max: 1 },
                { id: "bone", min: 2, max: 4 }
            ];
        }
        if (id === "human") {
            return [
                { id: "raw_beef", min: 2, max: 4 },
                { id: "bone", min: 1, max: 2 }
            ];
        }
        return [{ id: "bone", min: 1, max: 2 }];
    }

    _tryCorpseSkin(p, action = {}) {
        if (!p || p.dead) return;
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            p.x = action.x;
            p.y = action.y;
            p.poseAuth = true;
        }
        const held = this._held(p);
        if (!held || held.toolClass !== "knife") return;
        const found = this._findCorpse(action.corpseId);
        if (!found) return;
        const { entry } = found;
        if (entry.skinned || entry.stage === "carcass") return;
        const dx = entry.x - p.x;
        const dy = entry.y - p.y;
        const r = TS * (HARVEST_RANGE_TILES + 2);
        if (dx * dx + dy * dy > r * r) return;

        if (!Array.isArray(entry.loot)) entry.loot = [];
        const now = this.worldMinuteIndex();
        for (const drop of this._skinLootTable(entry.mobId)) {
            const meta = itemDefs().get(drop.id);
            if (!meta) continue;
            const lo = Math.max(0, Math.floor(Number(drop.min ?? 1) || 0));
            const hi = Math.max(lo, Math.floor(Number(drop.max ?? lo) || 0));
            let qty = lo + Math.floor(this.rng() * (hi - lo + 1));
            if (!(qty > 0)) continue;
            const maxStack = Math.max(1, Math.floor(Number(meta.maxStack) || 1));
            for (const slot of entry.loot) {
                if (!(qty > 0) || !slot || slot.id !== meta.id) continue;
                if (this._stackIsSpecial(slot)) continue;
                if ((slot.quantity || 1) >= maxStack) continue;
                const space = maxStack - (slot.quantity || 1);
                const add = Math.min(qty, space);
                const freshAt = Spoil.defaultSpoilAt(meta, now);
                slot.spoilAt = Spoil.mergeSpoilAt(
                    slot.quantity || 1, slot.spoilAt,
                    add, freshAt
                );
                slot.quantity = (slot.quantity || 1) + add;
                qty -= add;
            }
            while (qty > 0) {
                const add = Math.min(qty, maxStack);
                const stack = Spoil.makeWorldItemStack(meta, add, undefined, now);
                entry.loot.push(stack);
                qty -= add;
            }
        }
        entry.skinned = true;
        this.pushEvent({
            kind: "corpse",
            op: "skin",
            entry: {
                id: entry.id,
                skinned: true,
                loot: entry.loot
            }
        });
    }

    _tryCorpseTake(p, action = {}) {
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            p.x = action.x;
            p.y = action.y;
            p.poseAuth = true;
        }
        const found = this._findCorpse(action.corpseId);
        if (!found) return;
        const { chunk, index: corpseIdx, entry } = found;
        const dx = entry.x - p.x;
        const dy = entry.y - p.y;
        // Generous: corpse is body-centered; pose sync can lag a tick
        const r = TS * (HARVEST_RANGE_TILES + 2);
        if (dx * dx + dy * dy > r * r) return;
        if (!Array.isArray(entry.loot)) entry.loot = [];
        const wantId = action.itemId ? String(action.itemId) : null;
        let slot = Math.floor(Number(action.index));
        let stack = Number.isInteger(slot) && slot >= 0 ? entry.loot[slot] : null;
        if (!stack || (wantId && stack.id !== wantId)) {
            slot = entry.loot.findIndex((s) => s && (!wantId || s.id === wantId));
            stack = slot >= 0 ? entry.loot[slot] : null;
        }
        if (!stack?.id) return;

        // Right-click with equipment open: fill an empty equip slot (no swap).
        if (action.equipIfEmpty) {
            const equipKey = this._emptyEquipSlotForItem(p, stack.id);
            if (equipKey) {
                const one = this._cloneGearStack(stack, 1);
                this._setEquipStack(p, equipKey, one);
                stack.quantity = (Math.floor(Number(stack.quantity) || 1)) - 1;
                if (!(stack.quantity > 0)) entry.loot.splice(slot, 1);
                this._syncWaistSlots(p);
                this._syncPlayerInvSize(p);
                this._youDirty.add(p.id);
                if (!entry.loot.filter(Boolean).length) {
                    chunk.corpses.splice(corpseIdx, 1);
                    this.pushEvent({ kind: "corpse", op: "remove", id: entry.id });
                } else {
                    this.pushEvent({
                        kind: "corpse",
                        op: "loot",
                        entry: { id: entry.id, loot: entry.loot }
                    });
                }
                return;
            }
            // Occupied / not equippable — fall through to inventory take
        }

        const want = Math.max(1, Math.floor(Number(action.quantity) || 1));
        const takeQty = Math.min(Math.max(1, Math.floor(Number(stack.quantity) || 1)), want);
        const left = this._give(p, stack.id, takeQty, this._stackExtrasFrom(stack));
        const taken = takeQty - left;
        if (taken <= 0) {
            this._youDirty.add(p.id);
            return;
        }
        stack.quantity = (Math.floor(Number(stack.quantity) || 1)) - taken;
        if (!(stack.quantity > 0)) entry.loot.splice(slot, 1);
        this._youDirty.add(p.id);
        if (!entry.loot.filter(Boolean).length) {
            chunk.corpses.splice(corpseIdx, 1);
            this.pushEvent({ kind: "corpse", op: "remove", id: entry.id });
        } else {
            this.pushEvent({
                kind: "corpse",
                op: "loot",
                entry: {
                    id: entry.id,
                    loot: entry.loot
                }
            });
        }
    }

    /** First empty equipment slot key for item id, or null if none / not gear. */
    _emptyEquipSlotForItem(p, itemId) {
        if (!p || !itemId) return null;
        const want = this._equipSlotName(itemId);
        if (!want) return null;
        this._ensureEquipment(p);
        if (want === "waist") {
            const cap = this._waistCapacity(p);
            for (let i = 0; i < cap; i++) {
                if (!p.equipment.waist[i]) return `waist:${i}`;
            }
            return null;
        }
        if (this._getEquipStack(p, want)) return null;
        if (!this._canChangeBodySlot(p, want, itemId)) return null;
        return want;
    }

    /** Empty corpse closed in the loot UI — same as SP removeForever. */
    _tryCorpseDismiss(p, action = {}) {
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            p.x = action.x;
            p.y = action.y;
            p.poseAuth = true;
        }
        const found = this._findCorpse(action.corpseId);
        if (!found) return;
        const { chunk, index: corpseIdx, entry } = found;
        const dx = entry.x - p.x;
        const dy = entry.y - p.y;
        const r = TS * (HARVEST_RANGE_TILES + 2);
        if (dx * dx + dy * dy > r * r) return;
        const loot = Array.isArray(entry.loot) ? entry.loot.filter(Boolean) : [];
        if (loot.length) return;
        chunk.corpses.splice(corpseIdx, 1);
        this.pushEvent({ kind: "corpse", op: "remove", id: entry.id });
    }

    /** Ground spawn that does not take from inventory (overflow / failed fit). */
    _spawnWorldDrop(p, action = {}) {
        const id = String(action.id || "").slice(0, 64);
        const qty = Math.max(1, Math.min(99, Math.floor(Number(action.quantity) || 1)));
        if (!id) return;
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            p.x = action.x;
            p.y = action.y;
            p.poseAuth = true;
        }
        const x = Number.isFinite(action.x) ? action.x : p.x;
        const y = Number.isFinite(action.y) ? action.y : p.y;
        const drop = {
            id,
            quantity: qty,
            spoilAt: action.spoilAt
        };
        this._applyStackExtras(drop, this._stackExtrasFrom(action));
        this._pushDrop(x, y, drop);
    }

    _tryPickup(p, dropId = null) {
        const r = TS * (dropId ? 3 : 1.5);
        const r2 = r * r;
        let best = null;
        let bestD = r2;
        let bestChunk = null;
        let bestIdx = -1;
        for (const c of this._chunksNear(p.x, p.y, 1)) {
            for (let i = 0; i < c.drops.length; i++) {
                const d = c.drops[i];
                if (dropId && d.uid !== dropId) continue;
                const dx = d.x - p.x;
                const dy = d.y - p.y;
                const dist = dx * dx + dy * dy;
                if (dist > r2) continue;
                if (dist <= bestD) {
                    bestD = dist;
                    best = d;
                    bestChunk = c;
                    bestIdx = i;
                }
            }
        }
        if (!best || !bestChunk) return;
        const want = best.quantity || 1;
        const left = this._give(p, best.id, want, best);
        if (left >= want) return; // nothing fit — leave drop
        if (left > 0) best.quantity = left;
        else bestChunk.drops.splice(bestIdx, 1);
        this._youDirty.add(p.id);
        this.pushEvent({
            kind: "pickup",
            playerId: p.id,
            itemId: best.id,
            dropId: best.uid,
            remaining: left
        });
    }

    /**
     * Harvest a world lootable (sticks, leaves, bushes, fruit trees, …).
     * @param {object} p
     * @param {{ x?: number, y?: number }} action  optional click world pose
     */
    _tryHarvest(p, action = {}) {
        const range = TS * HARVEST_RANGE_TILES;
        const range2 = range * range;
        const wantUid = action.uid ? String(action.uid) : null;
        const wantId = action.id ? String(action.id) : null;
        const aimX = Number.isFinite(action.x) ? Number(action.x) : p.x;
        const aimY = Number.isFinite(action.y) ? Number(action.y) : p.y;
        // Clicked sprite — do not silently harvest a neighbor (was the blueberry/leaves desync)
        const exact2 = 10 * 10;

        let best = null;
        let bestChunk = null;
        let bestIdx = -1;
        let bestAim = Infinity;
        for (const c of this._chunksNear(p.x, p.y, 1)) {
            if (!Array.isArray(c.lootableThings)) continue;
            this._ensureLootableUids(c);
            for (let i = 0; i < c.lootableThings.length; i++) {
                const e = c.lootableThings[i];
                if (!e || e.gone || !e.id) continue;
                const def = thingDefs().get(e.id);
                if (!def?.lootable) continue;
                const dx = e.x - p.x;
                const dy = e.y - p.y;
                if (dx * dx + dy * dy > range2) continue;
                if (wantUid) {
                    if (e.uid !== wantUid) continue;
                    best = e;
                    bestChunk = c;
                    bestIdx = i;
                    bestAim = 0;
                    break;
                }
                if (wantId && e.id !== wantId) continue;
                const adx = e.x - aimX;
                const ady = e.y - aimY;
                const aim = adx * adx + ady * ady;
                if (aim > exact2) continue;
                if (aim < bestAim) {
                    bestAim = aim;
                    best = e;
                    bestChunk = c;
                    bestIdx = i;
                }
            }
            if (wantUid && best) break;
        }
        if (!best || !bestChunk) return;

        const def = thingDefs().get(best.id);
        const loot = def?.lootable;
        if (!loot?.item) return;

        const harvestedId = best.id;
        const qty = Math.max(1, Math.floor(Number(loot.yield) || 1));
        const left = this._give(p, loot.item, qty);
        if (left > 0) {
            this._pushDrop(best.x, best.y, { id: loot.item, quantity: left });
        }

        const transform = loot.transform || null;
        const regrowMinutes = Number(loot.regrowMinutes) || 0;
        const canRegrow = regrowMinutes > 0;
        const regrowAt = canRegrow
            ? this.worldMinuteIndex() + Math.max(
                1,
                Math.floor(regrowMinutes * (0.85 + this.rng() * 0.30))
            )
            : null;

        // Use the owning chunk, not worldToChunk(feet) — south-row lootables sit on the next chunk's edge
        const baseEv = {
            kind: "lootable",
            cx: bestChunk.cx,
            cy: bestChunk.cy,
            x: best.x,
            y: best.y,
            uid: best.uid || null,
            playerId: p.id
        };

        if (transform) {
            best.id = transform;
            if (canRegrow) {
                best.regrowId = harvestedId;
                best.regrowAt = regrowAt;
            } else {
                delete best.regrowId;
                delete best.regrowAt;
                delete best.gone;
            }
            this.pushEvent({
                ...baseEv,
                id: best.id,
                gone: false,
                regrowId: best.regrowId,
                regrowAt: best.regrowAt
            });
            return;
        }

        if (canRegrow) {
            best.gone = true;
            best.regrowId = harvestedId;
            best.regrowAt = regrowAt;
            this.pushEvent({
                ...baseEv,
                id: harvestedId,
                gone: true,
                regrowId: harvestedId,
                regrowAt
            });
            return;
        }

        bestChunk.lootableThings.splice(bestIdx, 1);
        this.pushEvent({
            ...baseEv,
            id: harvestedId,
            removed: true
        });
    }

    _tryDrop(p, action = {}) {
        const amount = Math.max(1, Math.floor(Number(action.amount) || 1));
        const held = this._held(p);
        if (!held?.id) return;

        const qty = Math.min(amount, held.quantity || 1);
        if (qty <= 0) return;

        const worldStack = this._cloneStackForWorld({ ...held, quantity: qty });
        held.quantity = (held.quantity || 1) - qty;
        if (held.quantity <= 0) p.inventory[p.hotbarIndex] = null;

        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            p.x = action.x;
            p.y = action.y;
            p.poseAuth = true;
        }
        if (worldStack) this._pushDrop(p.x, p.y, worldStack);
        this._youDirty.add(p.id);
    }

    _tileOf(wx, wy) {
        return {
            tx: Math.floor(Number(wx) / TS),
            ty: Math.floor(Number(wy) / TS)
        };
    }

    _tileCenter(tx, ty) {
        return { x: tx * TS + TS / 2, y: ty * TS + TS };
    }

    _isCampfireEntry(t) {
        if (!t) return false;
        if (t.id === "campfire" || t.id === "unlit_campfire") return true;
        return Array.isArray(t.fuel);
    }

    _campfireHasFuel(entry) {
        return !!(entry?.fuel || []).some((s) => s && s.quantity > 0);
    }

    _campfireEnsureBurning(entry) {
        if (!entry) return false;
        entry.id = "campfire";
        if ((entry.burnRemaining || 0) > 0) return true;
        if (!Array.isArray(entry.fuel)) entry.fuel = [null, null];
        for (let i = 0; i < 2; i++) {
            const stack = entry.fuel[i];
            if (!stack?.id) continue;
            const meta = itemDefs().get(stack.id);
            const kj = Number(meta?.fuel?.kj ?? 0);
            if (!(kj > 0)) continue;
            stack.quantity = Math.max(0, Math.floor(Number(stack.quantity) || 1) - 1);
            if (!(stack.quantity > 0)) entry.fuel[i] = null;
            entry.burnRemaining = kj;
            return true;
        }
        return false;
    }

    _campfirePublic(entry, chunk = null) {
        if (!entry) return null;
        if (!entry.uid) {
            entry.uid = `cf_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        return {
            uid: entry.uid,
            id: entry.id,
            x: entry.x,
            y: entry.y,
            cx: chunk?.cx,
            cy: chunk?.cy,
            rev: Number(entry.rev) || 0,
            fuel: entry.fuel || [null, null],
            cook: entry.cook ?? null,
            catalyst: entry.catalyst ?? null,
            simmer: entry.simmer || [null, null, null, null],
            cookProgress: entry.cookProgress || 0,
            burnRemaining: entry.burnRemaining || 0,
            roastBarMinutes: entry.roastBarMinutes || 0,
            simmerBarMinutes: entry.simmerBarMinutes || 0
        };
    }

    _bumpCampfire(entry) {
        if (!entry) return;
        entry.rev = (Number(entry.rev) || 0) + 1;
    }

    _emitCampfire(chunk, entry) {
        if (!chunk || !entry) return;
        this._bumpCampfire(entry);
        const pub = this._campfirePublic(entry, chunk);
        this.pushEvent({
            kind: "campfire",
            cx: chunk.cx,
            cy: chunk.cy,
            uid: pub.uid,
            rev: pub.rev,
            entry: pub
        });
    }

    _campfireIsAttended(entry) {
        const attend = entry?.attend;
        if (!attend || typeof attend !== "object") return false;
        for (const id of Object.keys(attend)) {
            const p = this.players.get(id);
            if (p?.connected && !p.dead) return true;
        }
        return false;
    }

    _clearPlayerCampfireAttend(playerId) {
        if (!playerId) return;
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isCampfireEntry(t) || !t.attend) continue;
                delete t.attend[playerId];
            }
        }
    }

    _fuelSignature(entry) {
        const fuel = entry?.fuel || [];
        return fuel.map((s) => (s?.id ? `${s.id}:${s.quantity || 0}` : "")).join("|");
    }

    _tickCampfireBurn(entry) {
        if (!entry || entry.id !== "campfire") return false;
        if ((entry.burnRemaining || 0) > 0) {
            entry.burnRemaining -= 1;
        }
        if ((entry.burnRemaining || 0) > 0) return false;
        if (!Array.isArray(entry.fuel)) entry.fuel = [null, null];
        for (let i = 0; i < 2; i++) {
            const stack = entry.fuel[i];
            if (!stack?.id) continue;
            const meta = itemDefs().get(stack.id);
            const kj = Number(meta?.fuel?.kj ?? 0);
            if (!(kj > 0)) continue;
            stack.quantity = Math.max(0, Math.floor(Number(stack.quantity) || 1) - 1);
            if (!(stack.quantity > 0)) entry.fuel[i] = null;
            entry.burnRemaining = kj;
            return true;
        }
        entry.burnRemaining = 0;
        entry.id = "unlit_campfire";
        return true;
    }

    _simmerFilledCount(entry) {
        let n = 0;
        for (const s of entry?.simmer || []) {
            if (s && this._isSimmerIngredient(s.id)) n += 1;
        }
        return n;
    }

    _simmerCanAdvance(entry, lit) {
        if (!lit) return false;
        if (this._campfireMethod(entry) !== "shell_simmer") return false;
        let filled = 0;
        for (const s of entry?.simmer || []) {
            if (!s) continue;
            if (!this._isSimmerIngredient(s.id)) return false;
            filled += 1;
        }
        return filled >= 2;
    }

    _makeSimmerMeal(entry) {
        const ids = (entry?.simmer || [])
            .filter((s) => s && this._isSimmerIngredient(s.id))
            .map((s) => s.id);
        const unique = [...new Set(ids)];
        let kind = "mash";
        let name = "Simmered Meal";
        let spoilHours = 24;
        const hasBeef = unique.includes("raw_beef");
        const hasVenison = unique.includes("raw_venison");
        const hasMeat = hasBeef || hasVenison;
        const hasApple = unique.includes("apple");
        const hasBlue = unique.includes("blueberry");
        if (hasMeat) {
            kind = "stew";
            spoilHours = 36;
            const meatLabel = hasBeef && hasVenison ? "Meat" : hasVenison ? "Venison" : "Beef";
            if (hasApple && hasBlue) name = "Hunter's Stew";
            else if (hasApple) name = `Apple and ${meatLabel} Stew`;
            else if (hasBlue) {
                name = `Blueberry and ${meatLabel} Stew`;
                spoilHours = 24;
            } else name = `${meatLabel} Stew`;
        } else if (unique.length === 1 && unique[0] === "blueberry") {
            kind = "mash";
            name = "Blueberry Mash";
            spoilHours = 12;
        } else if (unique.length === 1 && unique[0] === "apple") {
            kind = "simmered";
            name = "Simmered Apples";
            spoilHours = 48;
        } else if (hasBlue && hasApple) {
            kind = "tart";
            name = "Blueberry-Apple Tart";
            spoilHours = 24;
        }
        const coconut = itemDefs().get(entry?.catalyst?.id);
        const mealMeta = itemDefs().get("coconut_meal");
        let kc = 0;
        let weight = Number(coconut?.weight ?? 0);
        for (const id of ids) {
            const meta = itemDefs().get(id);
            kc += Number(meta?.food?.kc ?? 0) * 1.5;
            weight += Number(meta?.weight ?? 0) * 0.5;
        }
        kc += Number(coconut?.food?.kc ?? 0);
        const now = this.worldMinuteIndex();
        const stack = {
            id: mealMeta?.id || "coconut_meal",
            quantity: 1,
            customName: name,
            food: {
                kc: Math.round(kc),
                kcFull: Math.round(kc),
                spoil: spoilHours,
                satietyRatio: Number(mealMeta?.food?.satietyRatio) || 0.3
            },
            weight: Math.round(weight * 100) / 100,
            kind,
            ingredients: ids.slice()
        };
        if (spoilHours > 0) {
            stack.spoilAt = Math.round(now) + Math.round(spoilHours * 60);
        }
        return stack;
    }

    _tickShellSimmer(entry, lit) {
        if (!this._simmerCanAdvance(entry, lit)) {
            if ((entry.cookProgress || 0) > 0) {
                entry.cookProgress -= 1;
                if (entry.cookProgress <= 0) {
                    entry.cookProgress = 0;
                    delete entry.simmerBarMinutes;
                }
            } else {
                delete entry.simmerBarMinutes;
            }
            return false;
        }
        const filled = this._simmerFilledCount(entry);
        const need = filled * 5;
        entry.simmerBarMinutes = need;
        entry.cookProgress = (entry.cookProgress || 0) + 1;
        if (entry.cookProgress < need) return false;
        const meal = this._makeSimmerMeal(entry);
        entry.simmer = [null, null, null, null];
        entry.cookProgress = 0;
        delete entry.simmerBarMinutes;
        entry.catalyst = meal;
        return true;
    }

    _tickCampfireCook(entry, lit) {
        const method = this._campfireMethod(entry);
        const simmerActive = method === "shell_simmer"
            || this._campfireHasSimmer(entry)
            || ((entry.cookProgress || 0) > 0 && entry.simmerBarMinutes != null);
        if (simmerActive) return this._tickShellSimmer(entry, lit);

        const cook = entry.cook;
        if (!cook?.id) return false;
        const recipe = method ? itemDefs().get(cook.id)?.cook?.[method] : null;
        const canAdvance = !!(lit && this._campfireIsAttended(entry) && method && recipe?.result && recipe.minutes > 0);
        if (!canAdvance) {
            if ((entry.cookProgress || 0) > 0 && !lit) {
                entry.cookProgress -= 1;
                if (entry.cookProgress <= 0) {
                    entry.cookProgress = 0;
                    delete entry.roastBarMinutes;
                }
            }
            return false;
        }
        entry.roastBarMinutes = recipe.minutes;
        entry.cookProgress = (entry.cookProgress || 0) + 1;
        if (entry.cookProgress < recipe.minutes) return false;
        const resultMeta = itemDefs().get(recipe.result);
        delete entry.roastBarMinutes;
        if (!resultMeta) {
            entry.cookProgress = 0;
            return false;
        }
        entry.cook = Spoil.makeWorldItemStack(
            resultMeta,
            cook.quantity || 1,
            undefined,
            this.worldMinuteIndex()
        );
        entry.cookProgress = 0;
        return true;
    }

    _tickOneCampfire(entry) {
        if (!this._isCampfireEntry(entry)) return false;
        const idBefore = entry.id;
        const fuelBefore = this._fuelSignature(entry);
        const cookId = entry.cook?.id || "";
        const catId = entry.catalyst?.id || "";
        const lit = entry.id === "campfire";
        let slotDirty = false;
        if (lit) slotDirty = this._tickCampfireBurn(entry) || slotDirty;
        slotDirty = this._tickCampfireCook(entry, entry.id === "campfire") || slotDirty;
        if (entry.id !== idBefore) slotDirty = true;
        if (this._fuelSignature(entry) !== fuelBefore) slotDirty = true;
        if ((entry.cook?.id || "") !== cookId) slotDirty = true;
        if ((entry.catalyst?.id || "") !== catId) slotDirty = true;
        return slotDirty;
    }

    _tickCampfires() {
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.things)) continue;
            for (const entry of c.things) {
                if (!this._isCampfireEntry(entry)) continue;
                if (this._tickOneCampfire(entry)) this._emitCampfire(c, entry);
            }
        }
    }

    _nearbyDropPiles(wx, wy, itemId) {
        const range2 = (TS * HARVEST_RANGE_TILES) * (TS * HARVEST_RANGE_TILES);
        const out = [];
        for (const c of this._chunksNear(wx, wy, 1)) {
            if (!Array.isArray(c.drops)) continue;
            for (let i = 0; i < c.drops.length; i++) {
                const d = c.drops[i];
                if (!d || d.id !== itemId) continue;
                const dx = d.x - wx;
                const dy = d.y - wy;
                if (dx * dx + dy * dy > range2) continue;
                out.push({ chunk: c, idx: i, drop: d, dist: dx * dx + dy * dy });
            }
        }
        out.sort((a, b) => a.dist - b.dist);
        return out;
    }

    _countDropPiles(piles) {
        let n = 0;
        for (const pile of piles) n += Math.max(0, Math.floor(Number(pile.drop?.quantity) || 0));
        return n;
    }

    _consumeDropPiles(piles, need) {
        let left = Math.max(0, Math.floor(Number(need) || 0));
        const emptied = [];
        for (const pile of piles) {
            if (left <= 0) break;
            const qty = Math.max(0, Math.floor(Number(pile.drop.quantity) || 0));
            const take = Math.min(qty, left);
            if (!(take > 0)) continue;
            pile.drop.quantity = qty - take;
            left -= take;
            if (!(pile.drop.quantity > 0)) emptied.push(pile);
        }
        emptied.sort((a, b) => {
            if (a.chunk !== b.chunk) return 0;
            return b.idx - a.idx;
        });
        for (const pile of emptied) {
            const list = pile.chunk.drops;
            if (!Array.isArray(list)) continue;
            if (list[pile.idx] === pile.drop) list.splice(pile.idx, 1);
            else {
                const i = list.indexOf(pile.drop);
                if (i >= 0) list.splice(i, 1);
            }
        }
        return left <= 0;
    }

    _findCampfireOnTile(tx, ty) {
        const pos = this._tileCenter(tx, ty);
        for (const c of this._chunksNear(pos.x, pos.y - 1, 1)) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isCampfireEntry(t)) continue;
                const ft = this._tileOf(t.x, t.y - 1);
                if (ft.tx === tx && ft.ty === ty) return { chunk: c, entry: t };
            }
        }
        return null;
    }

    /** Match client DroppedItem: origin (0, 1), scale 0.7, 16px frames. */
    _dropTile(d) {
        const half = TS * 0.7 * 0.5;
        return this._tileOf(Number(d.x) + half, Number(d.y) - 1);
    }

    _pickDropNearAim(piles, aimX, aimY) {
        if (!piles.length) return null;
        if (!Number.isFinite(aimX) || !Number.isFinite(aimY)) return piles[0]?.drop;
        let best = piles[0];
        let bestD = Infinity;
        for (const pile of piles) {
            const d = pile.drop;
            const dx = Number(d.x) - aimX;
            const dy = Number(d.y) - aimY;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) {
                bestD = d2;
                best = pile;
            }
        }
        return best?.drop;
    }

    _tryLightFire(p, action = {}) {
        if (!p || p.dead) return;
        const held = this._held(p);
        const meta = held?.id ? itemDefs().get(held.id) : null;
        if (meta?.use !== "light_fire") return;

        const range = TS * HARVEST_RANGE_TILES;
        const range2 = range * range;

        let best = null;
        let bestD = Infinity;
        for (const c of this._chunksNear(p.x, p.y, 1)) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isCampfireEntry(t)) continue;
                if (t.id === "campfire") continue;
                if (!this._campfireHasFuel(t)) continue;
                const dx = t.x - p.x;
                const dy = t.y - p.y;
                const d2 = dx * dx + dy * dy;
                if (d2 <= range2 && d2 < bestD) {
                    bestD = d2;
                    best = { chunk: c, entry: t };
                }
            }
        }
        if (best) {
            if (!this._campfireEnsureBurning(best.entry)) return;
            this._emitCampfire(best.chunk, best.entry);
            return;
        }

        const sticks = this._nearbyDropPiles(p.x, p.y, "stick");
        const leaves = this._nearbyDropPiles(p.x, p.y, "leaf");
        if (this._countDropPiles(sticks) < 15 || this._countDropPiles(leaves) < 10) return;

        const aimX = Number(action?.x);
        const aimY = Number(action?.y);
        const anchor = this._pickDropNearAim(leaves, aimX, aimY)
            || this._pickDropNearAim(sticks, aimX, aimY);
        if (!anchor) return;
        const { tx, ty } = this._dropTile(anchor);
        if (this._findCampfireOnTile(tx, ty)) return;
        if (!this._consumeDropPiles(sticks, 15)) return;
        if (!this._consumeDropPiles(leaves, 10)) return;

        const { x, y } = this._tileCenter(tx, ty);
        const { cx, cy } = worldToChunk(x, y - 1);
        const chunk = this._ensureChunk(cx, cy);
        if (!Array.isArray(chunk.things)) chunk.things = [];
        const entry = {
            uid: `cf_${Math.round(x)}_${Math.round(y)}`,
            id: "campfire",
            x,
            y,
            fuel: [
                { id: "leaf", quantity: 10 },
                { id: "stick", quantity: 15 }
            ],
            cook: null,
            catalyst: null,
            simmer: [null, null, null, null],
            cookProgress: 0,
            burnRemaining: 0
        };
        this._campfireEnsureBurning(entry);
        chunk.things.push(entry);
        this._emitCampfire(chunk, entry);
    }

    _parseCampfireSlot(key) {
        const k = String(key || "");
        if (k === "cook" || k === "catalyst") return { kind: k };
        if (k === "fuel:0" || k === "fuel:1") return { kind: "fuel", i: Number(k.slice(5)) };
        if (/^simmer:[0-3]$/.test(k)) return { kind: "simmer", i: Number(k.slice(7)) };
        return null;
    }

    _campfireGetSlot(entry, key) {
        const slot = this._parseCampfireSlot(key);
        if (!entry || !slot) return undefined;
        if (slot.kind === "cook") return entry.cook || null;
        if (slot.kind === "catalyst") return entry.catalyst || null;
        if (slot.kind === "fuel") {
            if (!Array.isArray(entry.fuel)) entry.fuel = [null, null];
            return entry.fuel[slot.i] || null;
        }
        if (!Array.isArray(entry.simmer)) entry.simmer = [null, null, null, null];
        return entry.simmer[slot.i] || null;
    }

    _campfireSetSlot(entry, key, stack) {
        const slot = this._parseCampfireSlot(key);
        if (!entry || !slot) return;
        if (slot.kind === "cook") {
            if (!stack || stack.id !== entry.cook?.id) entry.cookProgress = 0;
            entry.cook = stack || null;
            return;
        }
        if (slot.kind === "catalyst") {
            entry.catalyst = stack || null;
            return;
        }
        if (slot.kind === "fuel") {
            if (!Array.isArray(entry.fuel)) entry.fuel = [null, null];
            entry.fuel[slot.i] = stack || null;
            return;
        }
        if (!Array.isArray(entry.simmer)) entry.simmer = [null, null, null, null];
        entry.simmer[slot.i] = stack || null;
    }

    _campfireMethod(entry) {
        const id = entry?.catalyst?.id;
        if (!id) return null;
        return itemDefs().get(id)?.cook?.method || null;
    }

    _campfireHasSimmer(entry) {
        return !!(entry?.simmer || []).some((s) => !!s);
    }

    _campfireCookOpen(entry) {
        const method = this._campfireMethod(entry);
        if (method === "shell_simmer") return false;
        if (entry?.cook) return true;
        return method === "stick_roast";
    }

    _campfireSimmerOpen(entry) {
        return this._campfireMethod(entry) === "shell_simmer" || this._campfireHasSimmer(entry);
    }

    _campfireCatalystLocked(entry) {
        return !!(entry?.cook || this._campfireHasSimmer(entry));
    }

    _isSimmerIngredient(id) {
        return ["apple", "blueberry", "raw_beef", "raw_venison"].includes(String(id || ""));
    }

    _findPlayerCampfire(p, action = {}) {
        if (!p) return null;
        const range2 = (TS * HARVEST_RANGE_TILES) * (TS * HARVEST_RANGE_TILES);
        const wantUid = action.uid ? String(action.uid) : null;
        const ax = Number(action.x);
        const ay = Number(action.y);
        let best = null;
        let bestD = Infinity;
        for (const c of this._chunksNear(p.x, p.y, 1)) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isCampfireEntry(t)) continue;
                const dx = t.x - p.x;
                const dy = t.y - p.y;
                const d2 = dx * dx + dy * dy;
                if (d2 > range2) continue;
                if (wantUid && t.uid === wantUid) return { chunk: c, entry: t };
                if (Number.isFinite(ax) && Number.isFinite(ay)) {
                    if (Math.abs(t.x - ax) < 1.5 && Math.abs(t.y - ay) < 1.5) {
                        return { chunk: c, entry: t };
                    }
                }
                if (d2 < bestD) {
                    bestD = d2;
                    best = { chunk: c, entry: t };
                }
            }
        }
        return wantUid || (Number.isFinite(ax) && Number.isFinite(ay)) ? null : best;
    }

    _splitInvToWorld(p, index, amount) {
        const inv = p.inventory;
        const held = inv?.[index];
        if (!held?.id) return null;
        const qty = Math.max(1, Math.floor(Number(held.quantity) || 1));
        const take = Math.min(qty, Math.max(1, Math.floor(Number(amount) || 1)));
        if (!(take > 0)) return null;
        const piece = this._cloneStackForWorld({ ...held, quantity: take });
        held.quantity = qty - take;
        if (!(held.quantity > 0)) inv[index] = null;
        this._youDirty.add(p.id);
        return piece;
    }

    _returnWorldToInv(p, worldStack, preferIndex = -1) {
        if (!p || !worldStack?.id) return false;
        const now = this.worldMinuteIndex();
        const qty = Math.max(1, Math.floor(Number(worldStack.quantity) || 1));
        const extras = this._stackExtrasFrom(worldStack) || {};
        const left = Spoil.spoilLeftForCharacter(worldStack, now);
        if (left != null) extras.spoilLeft = left;
        delete extras.spoilAt;
        const prefer = Math.floor(Number(preferIndex));
        if (Number.isInteger(prefer) && prefer >= 0) {
            if (!Array.isArray(p.inventory)) p.inventory = [];
            while (p.inventory.length <= prefer) p.inventory.push(null);
            const dest = p.inventory[prefer];
            if (!dest) {
                const slot = { id: worldStack.id, quantity: qty };
                this._applyStackExtras(slot, extras);
                if (left != null) slot.spoilLeft = left;
                p.inventory[prefer] = slot;
                this._youDirty.add(p.id);
                return true;
            }
            if (dest.id === worldStack.id && !this._stackIsSpecial(dest) && !this._stackIsSpecial(worldStack)) {
                const meta = itemDefs().get(dest.id);
                const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
                const space = Math.max(0, maxStack - (dest.quantity || 1));
                const moved = Math.min(space, qty);
                if (moved > 0) {
                    dest.spoilLeft = Spoil.mergeSpoilLeft(
                        dest.quantity || 1, dest.spoilLeft,
                        moved, left
                    );
                    delete dest.spoilAt;
                    dest.quantity = (dest.quantity || 1) + moved;
                    this._youDirty.add(p.id);
                    if (moved >= qty) return true;
                    worldStack = { ...worldStack, quantity: qty - moved };
                }
            }
        }
        const leftover = this._give(p, worldStack.id, worldStack.quantity || qty, extras);
        if (leftover > 0) {
            this._pushDrop(p.x, p.y, this._cloneStackForWorld({
                ...worldStack,
                quantity: leftover
            }));
        }
        return leftover < (worldStack.quantity || qty);
    }

    _tryCampfire(p, action = {}) {
        if (!p || p.dead) return;
        const found = this._findPlayerCampfire(p, action);
        if (!found) return;
        const { chunk, entry } = found;
        if (!entry.uid) {
            entry.uid = `cf_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        const op = String(action.op || "");
        if (op === "attend") {
            if (!entry.attend) entry.attend = {};
            entry.attend[p.id] = true;
            return;
        }
        if (op === "leave") {
            if (entry.attend) delete entry.attend[p.id];
            return;
        }
        if (op === "inv_to_slot") this._campfireInvToSlot(p, entry, action);
        else if (op === "slot_to_inv") this._campfireSlotToInv(p, entry, action);
        else if (op === "slot_to_slot") this._campfireSlotToSlot(entry, action);
        else return;
        this._emitCampfire(chunk, entry);
        this._youDirty.add(p.id);
    }

    _campfireInvToSlot(p, entry, action) {
        const slotKey = String(action.slot || "");
        const parsed = this._parseCampfireSlot(slotKey);
        if (!parsed) return;
        const invIndex = Math.floor(Number(action.inv));
        const held = p.inventory?.[invIndex];
        if (!held?.id) return;
        const meta = itemDefs().get(held.id);
        const dest = this._campfireGetSlot(entry, slotKey);
        const qty = Math.max(1, Math.floor(Number(held.quantity) || 1));
        let want = Math.floor(Number(action.amount));
        if (!Number.isFinite(want) || want < 1) want = qty;

        if (parsed.kind === "fuel") {
            if (!meta?.fuel) return;
            if (!dest) {
                const piece = this._splitInvToWorld(p, invIndex, Math.min(want, qty));
                if (piece) this._campfireSetSlot(entry, slotKey, piece);
                return;
            }
            if (dest.id === held.id && !this._stackIsSpecial(dest) && !this._stackIsSpecial(held)) {
                const maxStack = Math.max(1, Math.floor(Number(meta.maxStack) || 99));
                const space = Math.max(0, maxStack - (dest.quantity || 1));
                const moved = Math.min(space, want, qty);
                if (!(moved > 0)) return;
                const piece = this._splitInvToWorld(p, invIndex, moved);
                if (!piece) return;
                dest.spoilAt = Spoil.mergeSpoilAt(
                    dest.quantity || 1, dest.spoilAt,
                    piece.quantity, piece.spoilAt
                );
                dest.quantity = (dest.quantity || 1) + piece.quantity;
                this._campfireSetSlot(entry, slotKey, dest);
                return;
            }
            if (want < qty) return;
            const incoming = this._splitInvToWorld(p, invIndex, qty);
            if (!incoming) return;
            this._campfireSetSlot(entry, slotKey, incoming);
            this._returnWorldToInv(p, dest, invIndex);
            return;
        }

        if (parsed.kind === "catalyst") {
            if (!meta?.cook?.method) return;
            if (dest && this._campfireCatalystLocked(entry)) return;
            if (dest && dest.id === held.id) return;
            const incoming = this._splitInvToWorld(p, invIndex, 1);
            if (!incoming) return;
            this._campfireSetSlot(entry, slotKey, incoming);
            if (dest) this._returnWorldToInv(p, dest, invIndex);
            return;
        }

        if (parsed.kind === "cook") {
            if (!this._campfireCookOpen(entry)) return;
            if (dest && dest.id === held.id) return;
            const incoming = this._splitInvToWorld(p, invIndex, 1);
            if (!incoming) return;
            this._campfireSetSlot(entry, slotKey, incoming);
            if (dest) this._returnWorldToInv(p, dest, invIndex);
            return;
        }

        if (parsed.kind === "simmer") {
            if (!this._campfireSimmerOpen(entry)) return;
            if (this._campfireMethod(entry) !== "shell_simmer") return;
            if (!this._isSimmerIngredient(held.id)) return;
            if (dest) return;
            const incoming = this._splitInvToWorld(p, invIndex, 1);
            if (incoming) this._campfireSetSlot(entry, slotKey, incoming);
        }
    }

    _campfireSlotToInv(p, entry, action) {
        const slotKey = String(action.slot || "");
        const parsed = this._parseCampfireSlot(slotKey);
        if (!parsed) return;
        if (parsed.kind === "catalyst" && this._campfireCatalystLocked(entry)) return;
        const stack = this._campfireGetSlot(entry, slotKey);
        if (!stack?.id) return;
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        let want = Math.floor(Number(action.amount));
        if (!Number.isFinite(want) || want < 1) want = qty;
        if (parsed.kind !== "fuel") want = Math.min(want, 1);
        const moved = Math.min(qty, want);
        if (!(moved > 0)) return;
        const piece = this._cloneStackForWorld({ ...stack, quantity: moved });
        stack.quantity = qty - moved;
        if (!(stack.quantity > 0)) this._campfireSetSlot(entry, slotKey, null);
        else this._campfireSetSlot(entry, slotKey, stack);
        this._returnWorldToInv(p, piece, action.inv);
    }

    _campfireSlotToSlot(entry, action) {
        const fromKey = String(action.from || "");
        const toKey = String(action.to || "");
        if (fromKey === toKey) return;
        const fromP = this._parseCampfireSlot(fromKey);
        const toP = this._parseCampfireSlot(toKey);
        if (!fromP || !toP) return;
        if (fromP.kind === "catalyst" && this._campfireCatalystLocked(entry)) return;
        if (toP.kind === "catalyst" && this._campfireCatalystLocked(entry)) return;
        const a = this._campfireGetSlot(entry, fromKey);
        if (!a?.id) return;
        const b = this._campfireGetSlot(entry, toKey);
        const aMeta = itemDefs().get(a.id);

        if (toP.kind === "catalyst") {
            if (!aMeta?.cook?.method) return;
            if (b && b.id === a.id) return;
            const one = this._cloneStackForWorld({ ...a, quantity: 1 });
            a.quantity = Math.max(0, Math.floor(Number(a.quantity) || 1) - 1);
            if (!b) {
                this._campfireSetSlot(entry, toKey, one);
                this._campfireSetSlot(entry, fromKey, a.quantity > 0 ? a : null);
            } else if ((a.quantity || 0) <= 0) {
                this._campfireSetSlot(entry, fromKey, b);
                this._campfireSetSlot(entry, toKey, one);
            }
            return;
        }

        if (toP.kind === "simmer") {
            if (!this._campfireSimmerOpen(entry)) return;
            if (fromP.kind !== "simmer" && this._campfireMethod(entry) !== "shell_simmer") return;
            if (!this._isSimmerIngredient(a.id)) return;
            if (b) {
                if (fromP.kind === "simmer" && (a.quantity || 1) <= 1) {
                    this._campfireSetSlot(entry, fromKey, b);
                    this._campfireSetSlot(entry, toKey, a);
                }
                return;
            }
            const one = this._cloneStackForWorld({ ...a, quantity: 1 });
            a.quantity = Math.max(0, Math.floor(Number(a.quantity) || 1) - 1);
            this._campfireSetSlot(entry, toKey, one);
            this._campfireSetSlot(entry, fromKey, a.quantity > 0 ? a : null);
            return;
        }

        if (toP.kind === "cook") {
            if (!this._campfireCookOpen(entry)) return;
            if (b && b.id === a.id) return;
            const one = this._cloneStackForWorld({ ...a, quantity: 1 });
            a.quantity = Math.max(0, Math.floor(Number(a.quantity) || 1) - 1);
            if (!b) {
                this._campfireSetSlot(entry, toKey, one);
                this._campfireSetSlot(entry, fromKey, a.quantity > 0 ? a : null);
            } else if ((a.quantity || 0) <= 0) {
                this._campfireSetSlot(entry, fromKey, b);
                this._campfireSetSlot(entry, toKey, one);
            }
            return;
        }

        // to fuel (or leftover cook/catalyst/simmer → fuel)
        if (!b) {
            this._campfireSetSlot(entry, fromKey, null);
            this._campfireSetSlot(entry, toKey, a);
            return;
        }
        if (b.id === a.id && !this._stackIsSpecial(a) && !this._stackIsSpecial(b)) {
            const meta = itemDefs().get(b.id);
            const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
            const space = Math.max(0, maxStack - (b.quantity || 1));
            if (space <= 0) return;
            const moved = Math.min(space, a.quantity || 1);
            b.spoilAt = Spoil.mergeSpoilAt(
                b.quantity || 1, b.spoilAt,
                moved, a.spoilAt
            );
            b.quantity = (b.quantity || 1) + moved;
            a.quantity = (a.quantity || 1) - moved;
            this._campfireSetSlot(entry, toKey, b);
            this._campfireSetSlot(entry, fromKey, a.quantity > 0 ? a : null);
            return;
        }
        this._campfireSetSlot(entry, fromKey, b);
        this._campfireSetSlot(entry, toKey, a);
    }

    _isPartialFood(stack) {
        return !!(stack?.customName || stack?.ingredients?.length);
    }

    /** Match client Player._eatSecondsFor — explicit eatSeconds, else kcal formula. */
    _eatSecondsFor(food, isMeal) {
        const explicit = Number(food?.eatSeconds);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        const kc = Math.max(0, Number(food?.kc) || 0);
        if (isMeal) return Math.min(8, Math.max(2, 1.5 + kc / 150));
        return Math.min(6, Math.max(1, 1 + kc / 120));
    }

    _foodForEat(stack) {
        const meta = itemDefs().get(stack?.id);
        const food = { ...(meta?.food || {}) };
        if (stack?.food && typeof stack.food === "object") Object.assign(food, stack.food);
        return food;
    }

    _eatingDurationScale(p) {
        const creature = p?.creature || this.creatures.get(p?.id);
        if (!creature?.anatomy) return 1;
        try {
            const caps = creature.capacities || new Capacities(creature.anatomy);
            const scale = Number(caps.eatingDurationScale?.());
            return Number.isFinite(scale) && scale > 0 ? scale : 1;
        } catch (_) {
            return 1;
        }
    }

    _tryUse(p) {
        if (p.eatChannel) return;
        const held = this._held(p);
        if (!held?.id) return;
        const food = this._foodForEat(held);
        if (!(Number(food.kc) > 0)) return;
        const isMeal = this._isPartialFood(held);
        const room = (Number(p.stomach) || 0) - (Number(p.kc) || 0);
        if (isMeal && !(room > 0)) return;
        const seconds = this._eatSecondsFor(food, isMeal);
        const max = seconds * 1000 * this._eatingDurationScale(p);
        p.eatChannel = {
            remaining: max,
            max,
            itemIndex: p.hotbarIndex,
            food: { ...food },
            isMeal
        };
        this.pushEvent({ kind: "channel", playerId: p.id, channel: "eat", progress: 0 });
        this._youDirty.add(p.id);
    }

    /**
     * Finish a bandage channel (client runs the bar; server applies tend + consume).
     */
    _tryTend(p, action = {}) {
        if (!p || p.dead) return;
        const creature = this._syncPlayerCreature(p) || this._ensurePlayerCreature(p);
        if (!creature?.anatomy) return;

        const held = this._held(p);
        const wantId = action.itemId ? String(action.itemId) : null;
        if (!held?.id || (wantId && held.id !== wantId)) {
            this.pushEvent({
                kind: "combat_log",
                text: "You need a bandage in hand to finish tending.",
                to: p.id
            });
            return;
        }
        const meta = itemDefs().get(held.id);
        if (!meta?.bandage) {
            this.pushEvent({
                kind: "combat_log",
                text: "You need a bandage in hand to finish tending.",
                to: p.id
            });
            return;
        }

        const hint = {
            partName: action.partName ? String(action.partName) : null,
            injuryIndex: Number.isInteger(Number(action.injuryIndex))
                ? Number(action.injuryIndex)
                : -1,
            inj: {
                id: action.injuryId != null ? action.injuryId : undefined,
                name: action.injuryName ? String(action.injuryName) : undefined,
                severity: Number(action.injurySeverity)
            },
            destroyedPartName: action.destroyedPartName
                ? String(action.destroyedPartName)
                : null
        };
        let target = BodyHealing.resolveTendTarget?.(creature.anatomy, hint) || null;
        if (!target) target = BodyHealing.pickTendTarget(creature.anatomy);
        if (!target) {
            this.pushEvent({
                kind: "combat_log",
                text: "The wound healed before you finished.",
                to: p.id
            });
            this._youDirty.add(p.id);
            return;
        }

        const quality = BodyHealing.rollTendQuality(
            Number(meta.bandage.tendQuality) || 0.4,
            Number(meta.bandage.tendQualityMax) || 0.7
        );
        BodyHealing.applyTend(creature.anatomy, target, quality);

        held.quantity = Math.max(0, Math.floor(Number(held.quantity) || 1) - 1);
        if (!(held.quantity > 0)) p.inventory[p.hotbarIndex] = null;

        p.body = creature.anatomy.toJSON();
        creature.anatomy._dirty = false;
        this._youDirty.add(p.id);

        const qPct = Math.round(quality * 100);
        let text = `You finished bandaging (${qPct}%).`;
        if (target.part) {
            text = `You bandaged your ${target.part.name} (${qPct}%).`;
        } else if (target.destroyed) {
            const name = target.destroyed.partName;
            const part = name ? creature.anatomy.part?.(name) : null;
            text = BodyHealing.isStumpPart?.(part)
                ? `You bandaged a stump (${qPct}%).`
                : name
                    ? `You packed the wound (${qPct}%).`
                    : `You finished bandaging (${qPct}%).`;
        }
        this.pushEvent({ kind: "combat_log", text, to: p.id });
    }

    _satietyRatio(food, isMeal = false) {
        const n = Number(food?.satietyRatio);
        if (Number.isFinite(n) && n >= 0) return n;
        return isMeal ? 0.3 : 0.1;
    }

    _finishEat(p) {
        const ch = p.eatChannel;
        p.eatChannel = null;
        if (!ch) return;
        const held = p.inventory[ch.itemIndex];
        if (!held) return;
        const food = this._foodForEat(held);
        const total = Number(food.kc) || 0;
        if (!(total > 0)) return;
        const room = Math.max(0, (Number(p.stomach) || 0) - (Number(p.kc) || 0));
        const isMeal = ch.isMeal || this._isPartialFood(held);

        if (isMeal) {
            const consumed = Math.min(total, room);
            if (!(consumed > 0)) {
                this._youDirty.add(p.id);
                this.pushEvent({ kind: "channel", playerId: p.id, channel: "eat", progress: 1, done: true });
                return;
            }
            p.kc += consumed;
            p.saturation += consumed * this._satietyRatio(food, true);
            if (consumed < total) {
                if (!held.food) held.food = { ...food };
                if (held.food.kcFull == null) held.food.kcFull = Math.round(total);
                held.food.kc = Math.max(0, Math.round(total - consumed));
                if (!(held.food.kc > 0)) p.inventory[ch.itemIndex] = null;
            } else {
                held.quantity = (held.quantity || 1) - 1;
                if (!(held.quantity > 0)) p.inventory[ch.itemIndex] = null;
            }
        } else {
            p.kc += Math.min(total, room);
            p.saturation += total * this._satietyRatio(food, false);
            held.quantity = (held.quantity || 1) - 1;
            if (!(held.quantity > 0)) p.inventory[ch.itemIndex] = null;
        }
        this._youDirty.add(p.id);
        this.pushEvent({ kind: "channel", playerId: p.id, channel: "eat", progress: 1, done: true });
    }

    _tryAttack(p, angle) {
        if (p.eatChannel) return;
        if (p.dead) return;
        const creature = this._syncPlayerCreature(p) || this._ensurePlayerCreature(p);
        if (!creature || creature.isBodyDead()) return;
        let ang = Number(angle);
        if (!Number.isFinite(ang)) ang = 0;
        // Client autofire often arrives a few ms before the server swing ends (RTT).
        // Queue one pending strike instead of dropping the input.
        if (creature.isAttacking()) {
            p.pendingAttackAngle = ang;
            return;
        }
        this._beginPlayerAttack(p, creature, ang);
    }

    _beginPlayerAttack(p, creature, angle) {
        if (!creature?.startMeleeAttack?.(angle)) return false;
        p.pendingAttackAngle = null;
        p.attackTimer = creature.attackTimer;
        p.attackMax = creature.attackMax;
        p.attackAngle = creature.attackAngle;
        p.facing = creature.facing;
        p.attackArt = creature.attackArt || { unarmed: true, range: 4, max: p.attackMax };
        this.pushEvent({
            kind: "attack",
            playerId: p.id,
            x: p.x,
            y: p.y,
            angle,
            facing: p.facing,
            art: p.attackArt
        });
        return true;
    }

    /** Start a queued autofire swing once the current one ends. */
    _flushPendingAttack(p) {
        if (!p || p.dead || p.eatChannel) return;
        if (p.pendingAttackAngle == null) return;
        const creature = p.creature || this.creatures.get(p.id);
        if (!creature || creature.isBodyDead() || creature.isAttacking()) return;
        const ang = p.pendingAttackAngle;
        p.pendingAttackAngle = null;
        this._beginPlayerAttack(p, creature, ang);
    }

    _facingFromAngle(a) {
        const ang = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (ang >= Math.PI * 0.25 && ang < Math.PI * 0.75) return "down";
        if (ang >= Math.PI * 0.75 && ang < Math.PI * 1.25) return "left";
        if (ang >= Math.PI * 1.25 && ang < Math.PI * 1.75) return "up";
        return "right";
    }

    _damage(target, amount, attacker) {
        // Legacy flat-HP helper — prefer BodyCombat via SimCreature.
        if (!target || target.dead) return;
        if (target.creature && !target.creature.isBodyDead()) {
            target.creature.takeDamage(amount, attacker?.creature || attacker, null);
            if (target.creature.anatomy) {
                target.body = target.creature.anatomy.toJSON();
                target.creature.anatomy._dirty = false;
            }
            this._youDirty.add(target.id);
            if (target.creature.isBodyDead()) this._kill(target, attacker);
            return;
        }
        target.hp = Math.max(0, target.hp - amount);
        this._youDirty.add(target.id);
        const dmgEv = {
            kind: "damage",
            targetId: target.id,
            amount: Math.round(amount),
            x: target.x,
            y: target.y,
            from: attacker?.id
        };
        const dmgTo = this._combatLogRecipients({
            attacker: attacker?.creature || attacker,
            target: target.creature || target
        });
        if (dmgTo.length) {
            for (const id of dmgTo) this.pushEvent({ ...dmgEv, to: id });
        }
        if (target.hp <= 0) this._kill(target, attacker);
    }

    _kill(p, killer, action = {}) {
        if (!p) return;
        const alreadyDead = !!p.dead;
        p.dead = true;
        p.hp = 0;
        p._knapSession = null;
        this._cancelChannels(p);
        p.pendingAttackAngle = null;
        const creature = p.creature || this.creatures.get(p.id);
        if (creature) {
            creature._dead = true;
            creature.active = false;
            creature._endAttack?.();
            if (creature.anatomy) p.body = creature.anatomy.toJSON();
        }
        if (!alreadyDead) {
            const loot = [];
            for (const key of ["head", "torso", "legs", "feet"]) {
                const s = p.equipment?.[key];
                if (s) loot.push(this._cloneStackForWorld(s));
            }
            for (const s of p.equipment?.waist || []) {
                if (s) loot.push(this._cloneStackForWorld(s));
            }
            for (const s of p.inventory || []) {
                if (s) loot.push(this._cloneStackForWorld(s));
            }
            const c = creature?.bodyCenter?.() || { x: p.x, y: p.y - 8 };
            const ax = Number(action?.x);
            const ay = Number(action?.y);
            const corpseId = typeof action?.corpseId === "string" && action.corpseId
                ? action.corpseId.slice(0, 48)
                : undefined;
            this._pushCorpse({
                id: corpseId,
                x: Number.isFinite(ax) ? ax : c.x,
                y: Number.isFinite(ay) ? ay : c.y,
                key: "human",
                look: p.look || null,
                frame: 7,
                name: p.name || "Player",
                loot: loot.filter(Boolean),
                body: p.body || creature?.anatomy?.toJSON?.() || null,
                bodyPlan: "human",
                mobId: "human"
            });
        }
        // Empty gear so YOU cannot restore dumped loot after death.
        p.inventory = emptyInv(5);
        p.equipment = { head: null, torso: null, legs: null, feet: null, waist: [] };
        p.hotbarIndex = 0;
        if (creature) {
            creature.inventory = p.inventory;
            creature.equipment = p.equipment;
            creature.hotbarIndex = 0;
        }
        this._youDirty.add(p.id);
        if (alreadyDead) return;
        const killerName = this._killerLabel(killer);
        const msg = Protocol.deathMessage(p.name, killerName);
        this.pushEvent({ kind: "death", playerId: p.id, text: msg });
        this.pushEvent({ kind: "chat", text: msg, system: true });
    }

    /** @param {number} dtMs */
    tick(dtMs) {
        const dt = dtMs / 1000;
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            if (p.attackTimer > 0) p.attackTimer -= dtMs;
            if (p.eatChannel) {
                p.eatChannel.remaining -= dtMs;
                const prog = 1 - p.eatChannel.remaining / p.eatChannel.max;
                this.pushEvent({
                    kind: "channel",
                    playerId: p.id,
                    channel: "eat",
                    progress: Math.max(0, Math.min(1, prog))
                });
                if (p.eatChannel.remaining <= 0) this._finishEat(p);
            }
            if (p.dead) {
                // Keep chunks around the corpse in interest so the owner still sees it
                this._interestLoad(p.x, p.y, this.interestRadius(p));
                continue;
            }
            // Client-authored pose (SceneMain presence) — don't double-integrate
            if (p.poseAuth) {
                this._interestLoad(p.x, p.y, this.interestRadius(p));
                continue;
            }
            let speed = SPEED * (p.sprint ? SPRINT : 1);
            if (p.eatChannel) speed *= 0.5;
            const nx = p.x + p.moveX * speed * dt;
            const ny = p.y + p.moveY * speed * dt;
            if (!this.isBlocked(nx, p.y)) p.x = nx;
            if (!this.isBlocked(p.x, ny)) p.y = ny;
            this._interestLoad(p.x, p.y, this.interestRadius(p));
        }

        this._tickCreatures(dtMs, dt);
        // Scale with /tick like the world clock (paused at 0×)
        this._tickDropDespawn(dtMs * (Number(this.tickSpeed) || 0));

        this._minuteAcc += dtMs * this.tickSpeed;
        while (this._minuteAcc >= 1000) {
            this._minuteAcc -= 1000;
            this._worldMinute();
        }
    }

    _tickCreatures(dtMs, dt) {
        // Catch deaths whose onBodyFatal ran as a microtask after the previous tick
        this._reapDeadMobs();

        const aiWorld = this._aiWorld();
        const playerCreatures = [];
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            const creature = this._syncPlayerCreature(p) || this._ensurePlayerCreature(p);
            if (!creature) continue;
            if (!p.dead && !creature.isBodyDead()) playerCreatures.push(creature);
        }

        const liveMobs = [];
        for (const mob of this.mobs.values()) {
            if (!mob || mob.isBodyDead()) continue;
            liveMobs.push(mob);
        }

        const meleeTargets = [...playerCreatures, ...liveMobs];

        for (const p of this.players.values()) {
            if (!p.connected || p.dead) continue;
            const creature = p.creature;
            if (!creature || creature.isBodyDead()) continue;
            creature.refreshCapacities?.();
            p.prone = !p.dead && !!creature._prone;
            creature.tickMelee(dtMs, meleeTargets);
            p.attackTimer = creature.attackTimer;
            p.attackMax = creature.attackMax;
            p.attackAngle = creature.attackAngle;
            p.facing = creature.facing || p.facing;
            p.attackArt = creature.attackTimer > 0 ? (creature.attackArt || null) : null;
            // Autofire: honor swing that arrived during the previous cooldown
            if (!creature.isAttacking()) this._flushPendingAttack(p);
            if (creature.anatomy?._dirty) {
                p.body = creature.anatomy.toJSON();
                creature.anatomy._dirty = false;
                creature.refreshCapacities?.();
                p.prone = !p.dead && !!creature._prone;
                this._youDirty.add(p.id);
            }
        }

        for (const mob of liveMobs) {
            if (mob.isBodyDead()) {
                // Killed during a player swing earlier this tick
                this._finishMobDeath(mob, mob._lastHitBy || null);
                continue;
            }
            const nearest = aiWorld.getNearestPlayer(mob);
            mob.ctx.player = nearest || null;
            mob.refreshCapacities?.();
            const wasSwinging = !!mob.isAttacking?.();
            mob.ai?.update?.(dtMs, aiWorld);
            if (!wasSwinging && mob.isAttacking?.()) {
                this.pushEvent({
                    kind: "attack",
                    uid: mob.id,
                    x: mob.x,
                    y: mob.y,
                    angle: mob.attackAngle,
                    facing: mob.facing,
                    art: mob.attackArt || {
                        unarmed: true,
                        range: 4,
                        max: mob.attackMax || 833
                    }
                });
            }
            // Hold a short unstick velocity so AI bee-lines don't immediately re-wedge
            if (mob._nudgeMs > 0) {
                mob.setDesiredVel(mob._nudgeVx || 0, mob._nudgeVy || 0);
                mob._nudgeMs -= dtMs;
            }
            mob.applyDesiredVel(dtMs);
            const wantVx = mob.vx || 0;
            const wantVy = mob.vy || 0;
            const nx = mob.x + wantVx * dt;
            const ny = mob.y + wantVy * dt;
            let movedX = false;
            let movedY = false;
            if (!this.isBlocked(nx, mob.y)) {
                mob.x = nx;
                movedX = true;
            }
            if (!this.isBlocked(mob.x, ny)) {
                mob.y = ny;
                movedY = true;
            }
            if (
                !movedX
                && !movedY
                && (Math.abs(wantVx) > 1 || Math.abs(wantVy) > 1)
            ) {
                if (!mob._blockRetry || mob._blockRetry <= 0) {
                    mob._blockRetry = 400 + this.rng() * 350;
                    this._mobUnstick(mob);
                }
            }
            if (mob._blockRetry > 0) mob._blockRetry -= dtMs;
            if (mob.entry) {
                mob.entry.x = mob.x;
                mob.entry.y = mob.y;
                mob.entry.facing = mob.facing;
                if (mob.anatomy?._dirty) {
                    mob.entry.body = mob.anatomy.toJSON();
                }
            }
            mob.tickMelee(dtMs, playerCreatures);

            if (mob.isBodyDead()) {
                this._finishMobDeath(mob, mob._lastHitBy || null);
            }
        }

        this._reapDeadPlayers();
        // Sync capacity deaths are handled above; fatal-part microtasks may still
        // be pending until after this call returns — next tick's reap catches them.
        this._reapDeadMobs();
    }

    _worldMinute() {
        this.gameMinutes += 1;
        if (this.gameMinutes >= 24 * 60) {
            this.gameMinutes = 0;
            this.gameDay += 1;
        }
        for (const p of this.players.values()) {
            if (!p.connected || p.dead) continue;
            const creature = p.creature || this.creatures.get(p.id);
            // Snapshot before drain — same as Player.hungerTick (fed minute still recovers)
            const fed = (Number(p.kc) > 0) || (Number(p.saturation) > 0);
            let tick = (Number(p.hunger) > 0 ? p.hunger : 2000) / (24 * 60);
            if (p.sprint && (p.moveX || p.moveY)) tick *= 1.5;
            if (creature?.capacities?.hungerRateFactor) {
                tick *= creature.capacities.hungerRateFactor() || 1;
            }
            p.saturation -= tick;
            if (p.saturation < 0) {
                p.kc = Math.max(0, p.kc + p.saturation);
                p.saturation = 0;
            }
            this._tickPlayerSpoilLeft(p);
            if (creature && !creature.isBodyDead() && BodyHealing?.minuteTick) {
                creature._malnutritionFed = fed;
                creature.kc = p.kc;
                creature.saturation = p.saturation;
                BodyHealing.minuteTick(creature, creature.ctx);
                if (creature.anatomy?._dirty) {
                    p.body = creature.anatomy.toJSON();
                    creature.anatomy._dirty = false;
                }
                if (creature.isBodyDead()) {
                    p.body = creature.anatomy?.toJSON?.() || p.body;
                    this._kill(p, null);
                    continue;
                }
            }
            this._youDirty.add(p.id);
        }
        for (const mob of [...this.mobs.values()]) {
            if (!mob) continue;
            // Already marked dead (e.g. fatal microtask) — finish before healing skip
            if (mob.isBodyDead()) {
                this._finishMobDeath(mob, null);
                continue;
            }
            if (BodyHealing?.minuteTick) {
                BodyHealing.minuteTick(mob, mob.ctx);
            }
            if (mob.isBodyDead()) {
                this._finishMobDeath(mob, null);
            } else if (mob.anatomy?._dirty) {
                if (mob.entry) mob.entry.body = mob.anatomy.toJSON();
                mob.anatomy._dirty = false;
            }
        }
        this._tickLootableRegrows();
        this._tickCampfires();
        this._tickCorpseDecay();
    }

    _convertCorpseToCarcass(entry, now) {
        if (!entry) return;
        const getItem = (id) => itemDefs().get(id);
        const dump = CorpseDecay.lootToDumpOnCarcass(entry.loot, getItem);
        for (const stack of dump) {
            const world = this._cloneStackForWorld(stack);
            if (world) this._pushDrop(entry.x, entry.y, world);
        }
        entry.loot = CorpseDecay.buildCarcassLoot(entry.mobId, {
            getItem,
            now,
            rng: () => this.rng(),
            makeStack: (item, qty, at) => Spoil.makeWorldItemStack(item, qty, undefined, at)
        });
        entry.stage = "carcass";
        entry.skinned = true;
        this.pushEvent({
            kind: "corpse",
            op: "carcass",
            entry: {
                id: entry.id,
                stage: "carcass",
                skinned: true,
                loot: entry.loot,
                diedAt: entry.diedAt
            }
        });
    }

    /** Corpse → carcass after 12h, carcass → gone after 30d. Runs for all chunks. */
    _tickCorpseDecay() {
        const now = this.worldMinuteIndex();
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.corpses) || !c.corpses.length) continue;
            for (let i = c.corpses.length - 1; i >= 0; i--) {
                const entry = c.corpses[i];
                if (!entry) continue;
                CorpseDecay.ensureDiedAt(entry, now);
                const next = CorpseDecay.stageFor(entry.diedAt, now);
                if (next === "gone") {
                    const id = entry.id;
                    c.corpses.splice(i, 1);
                    this.pushEvent({ kind: "corpse", op: "remove", id });
                    continue;
                }
                if (next === "carcass" && entry.stage !== "carcass") {
                    this._convertCorpseToCarcass(entry, now);
                }
            }
        }
    }

    /** Respawn due world lootables (sticks, bushes, …). */
    _tickLootableRegrows() {
        const now = this.worldMinuteIndex();
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.lootableThings)) continue;
            for (const entry of c.lootableThings) {
                if (!entry || entry.regrowAt == null || now < entry.regrowAt) continue;
                const id = entry.regrowId || entry.id;
                if (!id) continue;
                entry.id = id;
                delete entry.gone;
                delete entry.regrowAt;
                delete entry.regrowId;
                this.pushEvent({
                    kind: "lootable",
                    cx: c.cx,
                    cy: c.cy,
                    x: entry.x,
                    y: entry.y,
                    uid: entry.uid || null,
                    id: entry.id,
                    respawn: true
                });
            }
        }
    }

    _tickMobs(dtMs, dt) {
        const aggroR = 120;
        for (const mob of this.mobs.values()) {
            if (mob.hp <= 0) continue;
            if (mob.state == null) {
                mob.state = "idle";
                mob.timer = 400 + this.rng() * 800;
                mob.dirX = 0;
                mob.dirY = 0;
                mob.panicMs = 0;
                mob.facing = mob.facing || "down";
                mob.vx = 0;
                mob.vy = 0;
                mob.wanderSpeed = mob.wanderSpeed || 1.4;
            }
            if (mob.attackTimer > 0) mob.attackTimer -= dtMs;

            let nearest = null;
            let nearestD = Infinity;
            for (const p of this.players.values()) {
                if (!p.connected || p.dead) continue;
                const d = Math.hypot(p.x - mob.x, p.y - mob.y);
                if (d < nearestD) {
                    nearestD = d;
                    nearest = p;
                }
            }

            if (mob.hostile && nearest && nearestD < aggroR) {
                mob.targetId = nearest.id;
                const dx = nearest.x - mob.x;
                const dy = nearest.y - mob.y;
                const len = Math.hypot(dx, dy) || 1;
                const speed = 70;
                mob.dirX = dx / len;
                mob.dirY = dy / len;
                this._mobStep(mob, dt, speed);
                if (nearestD < MELEE_RANGE && mob.attackTimer <= 0) {
                    mob.attackTimer = 1000;
                    this._damage(nearest, 6 + this.rng() * 6, {
                        id: mob.id,
                        name: mob.name
                    });
                }
                continue;
            }

            // ScaredAnimal only: panic flee after being hit
            if ((mob.ai || "scaredAnimal") === "scaredAnimal" && mob.panicMs > 0) {
                const distTiles = nearest ? nearestD / TS : 999;
                if (distTiles > 5) mob.panicMs -= dtMs;
                if (mob.panicMs <= 0) {
                    mob.panicMs = 0;
                    this._mobBeginIdle(mob);
                    continue;
                }
                mob.timer -= dtMs;
                if (mob.timer <= 0) this._mobBeginPanicDash(mob, nearest);
                const tiles = (mob.wanderSpeed || 1.4) * 3.6;
                this._mobStep(mob, dt, tiles * TS);
                continue;
            }

            mob.timer -= dtMs;
            if (mob.timer <= 0) {
                if (mob.state === "idle") this._mobBeginWalk(mob);
                else this._mobBeginIdle(mob);
            }
            if (mob.state === "walk") {
                const tiles = mob.wanderSpeed || 1.4;
                this._mobStep(mob, dt, tiles * TS);
            } else {
                mob.vx = 0;
                mob.vy = 0;
            }
        }
    }

    _mobBeginIdle(mob) {
        mob.state = "idle";
        mob.dirX = 0;
        mob.dirY = 0;
        mob.vx = 0;
        mob.vy = 0;
        mob.timer = 1000 + this.rng() * 2000;
    }

    _mobBeginWalk(mob) {
        mob.state = "walk";
        const dirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        let pick = null;
        const homeX = mob.homeX;
        const homeY = mob.homeY;
        if (homeX != null && homeY != null) {
            const hx = (homeX - mob.x) / TS;
            const hy = (homeY - mob.y) / TS;
            const dist = Math.hypot(hx, hy);
            if (dist > 0.15) {
                const nx = hx / dist;
                const ny = hy / dist;
                const forceHome = dist >= 7 || (dist >= 4 && this.rng() < 0.65);
                if (forceHome) {
                    const weights = dirs.map(([dx, dy]) => {
                        const len = Math.hypot(dx, dy) || 1;
                        const align = (dx / len) * nx + (dy / len) * ny;
                        return Math.max(0.05, align + 1);
                    });
                    pick = this._weightedPick(dirs, weights);
                }
            }
        }
        if (!pick) pick = dirs[Math.floor(this.rng() * dirs.length)];
        mob.dirX = pick[0];
        mob.dirY = pick[1];
        mob.timer = 1000 + this.rng() * 1000;
    }

    _mobBeginPanicDash(mob, threat) {
        mob.state = "walk";
        const dirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        let pick = null;
        if (threat && this.rng() < 0.75) {
            let fx = mob.x - threat.x;
            let fy = mob.y - threat.y;
            const flen = Math.hypot(fx, fy);
            if (flen > 0.001) {
                fx /= flen;
                fy /= flen;
                const weights = dirs.map(([dx, dy]) => {
                    const len = Math.hypot(dx, dy) || 1;
                    const align = (dx / len) * fx + (dy / len) * fy;
                    return Math.max(0.08, align + 1);
                });
                pick = this._weightedPick(dirs, weights);
            }
        }
        if (!pick) pick = dirs[Math.floor(this.rng() * dirs.length)];
        mob.dirX = pick[0];
        mob.dirY = pick[1];
        mob.timer = 200 + this.rng() * 250;
    }

    _weightedPick(items, weights) {
        let total = 0;
        for (const w of weights) total += w;
        let r = this.rng() * total;
        for (let i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
        }
        return items[items.length - 1];
    }

    /** Move mob along dirX/dirY at speed px/s; update facing/vx/vy. */
    _mobStep(mob, dt, speedPx) {
        let x = mob.dirX || 0;
        let y = mob.dirY || 0;
        const len = Math.hypot(x, y) || 1;
        x /= len;
        y /= len;
        const wantVx = x * speedPx;
        const wantVy = y * speedPx;
        const nx = mob.x + wantVx * dt;
        const ny = mob.y + wantVy * dt;
        let movedX = false;
        let movedY = false;
        const hit = { thingR: TS * 0.3 };
        if (!this.isBlocked(nx, mob.y, hit)) {
            mob.x = nx;
            movedX = true;
        }
        if (!this.isBlocked(mob.x, ny, hit)) {
            mob.y = ny;
            movedY = true;
        }

        // Only redirect when fully stuck — single-axis blocks are normal wall slides
        if (!movedX && !movedY) {
            if (!mob._blockRetry || mob._blockRetry <= 0) {
                mob._blockRetry = 450 + this.rng() * 400;
                this._mobNudgeDir(mob);
            }
        }
        if (mob._blockRetry > 0) mob._blockRetry -= dt * 1000;

        mob.vx = movedX ? wantVx : 0;
        mob.vy = movedY ? wantVy : 0;
        // Face intended travel, not residual axis after a slide (avoids flicker)
        if (Math.abs(x) > Math.abs(y)) {
            mob.facing = x > 0 ? "right" : "left";
        } else if (y !== 0) {
            mob.facing = y > 0 ? "down" : "up";
        }
    }

    /** Soft redirect without resetting the walk/panic timer (no spin). */
    _mobNudgeDir(mob) {
        const dirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        // Prefer not reversing immediately
        const curX = mob.dirX || 0;
        const curY = mob.dirY || 0;
        const candidates = dirs.filter(([dx, dy]) => !(dx === -curX && dy === -curY));
        const pool = candidates.length ? candidates : dirs;
        let pick = null;
        if (mob.panicMs > 0) {
            const threat = mob.targetId ? this.players.get(mob.targetId) : null;
            if (threat?.connected) {
                let fx = mob.x - threat.x;
                let fy = mob.y - threat.y;
                const flen = Math.hypot(fx, fy);
                if (flen > 0.001) {
                    fx /= flen;
                    fy /= flen;
                    const weights = pool.map(([dx, dy]) => {
                        const dlen = Math.hypot(dx, dy) || 1;
                        const align = (dx / dlen) * fx + (dy / dlen) * fy;
                        return Math.max(0.08, align + 1);
                    });
                    pick = this._weightedPick(pool, weights);
                }
            }
        } else if (mob.homeX != null && mob.homeY != null) {
            const hx = (mob.homeX - mob.x) / TS;
            const hy = (mob.homeY - mob.y) / TS;
            const dist = Math.hypot(hx, hy);
            if (dist > 0.15) {
                const nx = hx / dist;
                const ny = hy / dist;
                const weights = pool.map(([dx, dy]) => {
                    const dlen = Math.hypot(dx, dy) || 1;
                    const align = (dx / dlen) * nx + (dy / dlen) * ny;
                    return Math.max(0.05, align + 1);
                });
                pick = this._weightedPick(pool, weights);
            }
        }
        if (!pick) pick = pool[Math.floor(this.rng() * pool.length)];
        mob.dirX = pick[0];
        mob.dirY = pick[1];
    }

    /**
     * When a SimCreature is fully wedged (both axes blocked), pick an open
     * direction and hold it briefly so chase AI doesn't re-wedge immediately.
     */
    _mobUnstick(mob) {
        if (!mob) return;
        const speed =
            Math.hypot(mob._desiredVx || 0, mob._desiredVy || 0) || (3.5 * TS);
        const dirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        for (let i = dirs.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            const tmp = dirs[i];
            dirs[i] = dirs[j];
            dirs[j] = tmp;
        }
        const step = TS * 0.6;
        for (const [dx, dy] of dirs) {
            const dlen = Math.hypot(dx, dy) || 1;
            const nx = mob.x + (dx / dlen) * step;
            const ny = mob.y + (dy / dlen) * step;
            const canX = !this.isBlocked(nx, mob.y);
            const canY = !this.isBlocked(mob.x, ny);
            if (!canX && !canY) continue;
            mob._nudgeVx = (dx / dlen) * speed;
            mob._nudgeVy = (dy / dlen) * speed;
            mob._nudgeMs = 280;
            mob.setDesiredVel(mob._nudgeVx, mob._nudgeVy);
            return;
        }
    }

    isBlocked(wx, wy, opts = {}) {
        const { cx, cy } = worldToChunk(wx, wy);
        const c = this._ensureChunk(cx, cy);
        const lx = Math.floor((wx - cx * CHUNK_PX) / TS);
        const ly = Math.floor((wy - cy * CHUNK_PX) / TS);
        if (lx < 0 || ly < 0 || lx >= CS || ly >= CS) return true;
        const tile = c.tiles[lx + ly * CS];
        if (tile && BLOCKED.has(tile)) return true;

        // Match client Thing.setup: only hitboxSize > 0 is solid (bushes/debris are not).
        const defs = thingDefs();
        const solidAt = (list) => {
            for (const t of list || []) {
                if (!t || t.gone) continue;
                const def = defs.get(t.id);
                const hs = Number(def?.hitboxSize);
                if (!(hs > 0)) continue;
                // Client body is hs×hs at the feet; half-extent + 1px pad.
                const r = opts.thingR != null ? opts.thingR : hs * 0.5 + 1;
                if (Math.abs(t.x - wx) < r && Math.abs(t.y - wy) < r) return true;
            }
            return false;
        };
        if (solidAt(c.things)) return true;
        if (solidAt(c.lootableThings)) return true;
        return false;
    }

    /**
     * Ground loot despawn — same 5 real minutes as client DroppedItem.
     * Only ticks in chunks inside any connected player's interest radius
     * (server analogue of a loaded chunk).
     */
    _tickDropDespawn(dtMs) {
        if (!(dtMs > 0)) return;
        const loaded = new Set();
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            const r = this.interestRadius(p);
            for (const c of this._chunksNear(p.x, p.y, r)) {
                loaded.add(c);
            }
        }
        if (!loaded.size) return;

        for (const c of loaded) {
            if (!Array.isArray(c.drops) || !c.drops.length) continue;
            for (let i = c.drops.length - 1; i >= 0; i--) {
                const d = c.drops[i];
                if (!d) {
                    c.drops.splice(i, 1);
                    continue;
                }
                let life = Number(d.lifeMs);
                if (!Number.isFinite(life)) life = DROP_LIFE_MS;
                life -= dtMs;
                if (life <= 0) {
                    c.drops.splice(i, 1);
                    continue;
                }
                d.lifeMs = life;
            }
        }
    }

    _chunksNear(wx, wy, r) {
        let { cx, cy } = worldToChunk(wx, wy);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
            cx = 0;
            cy = 0;
        }
        const rad = Math.max(0, Math.floor(Number(r) || 0));
        const out = [];
        for (let x = cx - rad; x <= cx + rad; x++) {
            for (let y = cy - rad; y <= cy + rad; y++) {
                out.push(this._ensureChunk(x, y));
            }
        }
        return out;
    }

    _interestLoad(wx, wy, radius = INTEREST) {
        const { cx, cy } = worldToChunk(wx, wy);
        const r = Math.max(1, Math.floor(Number(radius) || INTEREST));
        for (let x = cx - r; x <= cx + r; x++) {
            for (let y = cy - r; y <= cy + r; y++) {
                this._ensureChunk(x, y);
            }
        }
    }

    _ensureChunk(cx, cy) {
        const key = chunkKey(cx, cy);
        let c = this.chunks.get(key);
        if (c) return c;
        c = WorldGen.generateChunk(cx, cy, this.seed);
        this.chunks.set(key, c);
        this._ensureLootableUids(c);
        this._registerChunkMobs(c);
        return c;
    }

    chunkPayload(cx, cy) {
        const c = this._ensureChunk(cx, cy);
        this._spoilChunkContents(c);
        return {
            x: c.cx,
            y: c.cy,
            tiles: c.tiles,
            things: c.things,
            lootableThings: c.lootableThings,
            drops: c.drops,
            mobs: c.mobs,
            corpses: c.corpses,
            bloodStains: c.bloodStains
        };
    }

    /** Absolute in-game minute index — same formula as the client. */
    worldMinuteIndex() {
        return (Number(this.gameDay) || 1) * 1440 + (Number(this.gameMinutes) || 0);
    }

    /**
     * Lazy spoil: character spoilLeft <= 0, or world spoilAt vs clock.
     * Mutates stack in place when due.
     * @returns {object|null}
     */
    _spoilStackIfDue(stack) {
        if (!stack) return stack;
        const now = this.worldMinuteIndex();
        let due = false;
        if (stack.spoilLeft != null) {
            due = Math.round(stack.spoilLeft) <= 0;
        } else if (stack.spoilAt != null) {
            due = Math.round(now) >= Math.round(stack.spoilAt);
        } else {
            return stack;
        }
        if (!due) return stack;
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        // Keep pose fields for ground drops; strip meal/food extras.
        const uid = stack.uid;
        const x = stack.x;
        const y = stack.y;
        for (const k of Object.keys(stack)) delete stack[k];
        stack.id = "rot";
        stack.quantity = qty;
        if (uid != null) stack.uid = uid;
        if (Number.isFinite(x)) stack.x = x;
        if (Number.isFinite(y)) stack.y = y;
        return stack;
    }

    _migratePlayerSpoilLeft(p) {
        if (!p) return;
        const now = this.worldMinuteIndex();
        if (Array.isArray(p.inventory)) {
            Spoil.migrateCharacterStacks(p.inventory, now);
        }
        const eq = p.equipment;
        if (!eq) return;
        for (const key of ["head", "torso", "legs", "feet"]) {
            if (eq[key]) Spoil.migrateToSpoilLeft(eq[key], now);
        }
        if (Array.isArray(eq.waist)) {
            Spoil.migrateCharacterStacks(eq.waist, now);
        }
    }

    /** Decrement spoilLeft one game minute, then rot if due. */
    _tickPlayerSpoilLeft(p) {
        if (!p) return;
        const now = this.worldMinuteIndex();
        const tick = (stack) => {
            if (!stack) return;
            Spoil.migrateToSpoilLeft(stack, now);
            Spoil.tickSpoilLeft(stack);
            this._spoilStackIfDue(stack);
        };
        if (Array.isArray(p.inventory)) {
            for (let i = 0; i < p.inventory.length; i++) tick(p.inventory[i]);
        }
        const eq = p.equipment;
        if (!eq) return;
        for (const key of ["head", "torso", "legs", "feet"]) tick(eq[key]);
        if (Array.isArray(eq.waist)) {
            for (let i = 0; i < eq.waist.length; i++) tick(eq.waist[i]);
        }
    }

    _spoilChunkContents(c) {
        if (!c) return;
        if (Array.isArray(c.drops)) {
            for (const d of c.drops) this._spoilStackIfDue(d);
        }
        if (Array.isArray(c.corpses)) {
            for (const corpse of c.corpses) {
                if (!Array.isArray(corpse?.loot)) continue;
                for (let i = 0; i < corpse.loot.length; i++) {
                    if (corpse.loot[i]) this._spoilStackIfDue(corpse.loot[i]);
                }
            }
        }
        if (Array.isArray(c.things)) {
            for (const t of c.things) {
                if (t?.cook) this._spoilStackIfDue(t.cook);
                if (t?.catalyst) this._spoilStackIfDue(t.catalyst);
                if (Array.isArray(t?.fuel)) {
                    for (let i = 0; i < t.fuel.length; i++) {
                        if (t.fuel[i]) this._spoilStackIfDue(t.fuel[i]);
                    }
                }
                if (Array.isArray(t?.simmer)) {
                    for (let i = 0; i < t.simmer.length; i++) {
                        if (t.simmer[i]) this._spoilStackIfDue(t.simmer[i]);
                    }
                }
            }
        }
    }

    _spoilPlayerGear(p) {
        if (!p) return;
        if (Array.isArray(p.inventory)) {
            for (let i = 0; i < p.inventory.length; i++) {
                if (p.inventory[i]) this._spoilStackIfDue(p.inventory[i]);
            }
        }
        const eq = p.equipment;
        if (!eq) return;
        for (const key of ["head", "torso", "legs", "feet"]) {
            if (eq[key]) this._spoilStackIfDue(eq[key]);
        }
        if (Array.isArray(eq.waist)) {
            for (let i = 0; i < eq.waist.length; i++) {
                if (eq.waist[i]) this._spoilStackIfDue(eq.waist[i]);
            }
        }
    }

    interestChunkKeys(wx, wy, radius = INTEREST) {
        const { cx, cy } = worldToChunk(wx, wy);
        const r = Math.max(1, Math.floor(Number(radius) || INTEREST));
        const keys = [];
        for (let x = cx - r; x <= cx + r; x++) {
            for (let y = cy - r; y <= cy + r; y++) {
                keys.push(chunkKey(x, y));
            }
        }
        return keys;
    }

    snapshotFor(viewerId) {
        const viewer = this.players.get(viewerId);
        if (!viewer) return null;
        // Always include all connected players (max 8) — do not distance-cull remotes
        const players = [];
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            players.push({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                facing: p.facing,
                sprint: p.sprint,
                dead: p.dead,
                prone: !!(p.dead || p.prone),
                eating: !!p.eatChannel,
                attacking: p.attackTimer > 0,
                attackAngle: p.attackAngle ?? null,
                attackProgress: p.attackTimer > 0 && p.attackMax > 0
                    ? 1 - p.attackTimer / p.attackMax
                    : 0,
                attackArt: p.attackTimer > 0 ? (p.attackArt || null) : null,
                look: p.look || Look.normalizeLook(null)
            });
        }
        // Non-finite pose would make _chunksNear return [] and clients would
        // briefly think every corpse vanished (sparkle storm on death).
        const vx = Number.isFinite(viewer.x) ? viewer.x : 0;
        const vy = Number.isFinite(viewer.y) ? viewer.y : 0;
        const { cx, cy } = worldToChunk(vx, vy);
        const interest = this.interestRadius(viewer);
        const drops = [];
        const corpses = [];
        const campfires = [];
        for (const c of this._chunksNear(vx, vy, interest)) {
            this._spoilChunkContents(c);
            for (const d of c.drops) {
                drops.push(this._publicDrop(d, c));
            }
            for (const corpse of c.corpses || []) {
                if (!corpse?.id) continue;
                corpses.push({
                    id: corpse.id,
                    x: corpse.x,
                    y: corpse.y,
                    key: corpse.key || "human",
                    look: corpse.look || null,
                    frame: corpse.frame != null ? corpse.frame : 7,
                    name: corpse.name || "Corpse",
                    loot: corpse.loot || [],
                    body: corpse.body || null,
                    bodyPlan: corpse.bodyPlan || "human",
                    mobId: corpse.mobId || null,
                    skinned: !!corpse.skinned,
                    diedAt: corpse.diedAt,
                    stage: corpse.stage || "corpse",
                    cx: c.cx,
                    cy: c.cy
                });
            }
            for (const t of c.things || []) {
                if (!this._isCampfireEntry(t)) continue;
                campfires.push(this._campfirePublic(t, c));
            }
        }
        const mobs = [];
        const nearChunks = new Set(
            this._chunksNear(vx, vy, interest).map((c) => chunkKey(c.cx, c.cy))
        );
        for (const mob of this.mobs.values()) {
            if (!mob || mob.isBodyDead()) continue;
            const pos = worldToChunk(mob.x, mob.y);
            if (!nearChunks.has(chunkKey(pos.cx, pos.cy))) continue;
            const moving = Math.hypot(mob.vx || 0, mob.vy || 0) > 2;
            const row = {
                id: mob.id,
                kind: mob.def?.id || mob.entry?.id || "deer",
                name: mob.def?.name || mob.name,
                x: mob.x,
                y: mob.y,
                facing: mob.facing || "down",
                vx: mob.vx || 0,
                vy: mob.vy || 0,
                moving,
                panic: !!(mob.panicMs > 0 || mob.ai?.panicMs > 0),
                hostile: !!mob.hostile,
                prone: !!mob._prone,
                attacking: !!(mob.attackTimer > 0),
                attackAngle: Number.isFinite(mob.attackAngle) ? mob.attackAngle : null,
                attackArt: mob.attackTimer > 0 ? (mob.attackArt || null) : null
            };
            if (mob.anatomy?._dirty) {
                row.body = mob.anatomy.toJSON();
                mob.anatomy._dirty = false;
                if (mob.entry) mob.entry.body = row.body;
            }
            mobs.push(row);
        }
        return {
            clock: { gameDay: this.gameDay, gameMinutes: this.gameMinutes, tickSpeed: this.tickSpeed },
            players,
            drops,
            corpses,
            campfires,
            mobs,
            chunkCursor: { cx, cy },
            youId: viewerId
        };
    }

    youPayload(playerId) {
        const p = this.players.get(playerId);
        if (!p) return null;
        this._spoilPlayerGear(p);
        const creature = p.creature || this.creatures.get(p.id);
        const body =
            (creature?.anatomy && creature.anatomy.toJSON()) ||
            p.body ||
            null;
        return {
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y,
            facing: p.facing,
            kc: p.kc,
            saturation: p.saturation,
            stomach: p.stomach,
            inventory: p.inventory,
            equipment: p.equipment,
            hotbarIndex: p.hotbarIndex,
            body,
            hp: p.hp,
            mhp: p.mhp,
            dead: p.dead,
            prone: !!(p.dead || p.prone || creature?._prone),
            look: p.look || Look.normalizeLook(null),
            eatChannel: p.eatChannel
                ? { progress: 1 - p.eatChannel.remaining / p.eatChannel.max }
                : null
        };
    }
}

module.exports = { SimWorld, chunkKey, worldToChunk, CHUNK_PX, CS, TS };
