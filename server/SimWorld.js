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
const Durability = require("../shared/durability");
const Apparel = require("../shared/apparel");
const Chop = require("../shared/chop");
const Place = require("../shared/place");
const Sleep = require("../shared/sleep");
const Hunger = require("../shared/hunger");
const Path = require("../shared/path");
const Hide = require("../shared/hide");
const Carry = require("../shared/carry");
const Fire = require("../shared/fire");
const Party = require("../shared/party");
const Settlement = require("../shared/settlement");
const StorageFilter = require("../shared/storageFilter");
const CavemanNames = require("../shared/cavemanNames");
const CorpseDecay = require("../shared/corpseDecay");
const GameMath = require("../shared/gameMath");
const DataStore = require("../shared/DataStore");
const BodyHealing = require("../shared/body/Healing");
const Hediffs = require("../shared/body/Hediff");
const BodyCombat = require("../shared/body/Combat");
const { Body } = require("../shared/body/Body");
const Capacities = require("../shared/body/Capacities");
const { createAI, PartyAI, WandererStrollAI, NeutralAnimalAI } = require("../shared/ai/headless");
const {
    createPlayerCreature,
    createMobCreature
} = require("./SimCreature");
const SaveIO = require("./SaveIO");
const WorldGen = require("./WorldGen");
const SettlerWork = require("./settlerWork");

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
    Carry.resolveCraftedWeights(raw);
    Carry.resolveCraftedFuel(raw);
    const map = new Map();
    for (const it of raw) {
        if (it?.id) map.set(it.id, it);
    }
    for (const [from, to] of [["deer_brain", "brain"], ["wood_spear", "wooden_spear"]]) {
        if (map.has(to) && !map.has(from)) map.set(from, map.get(to));
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
        this.baseTickSpeed = 1;
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
        this._directorCd = 0;
        this._duelMap = new Map();
        this._duelIds = new Map();
        this._duelEntities = [];
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
     * Hitting one passerby pulls nearby unrecruited wanderers onto the party.
     * One hop only — matches client PartySystem.alertNearbyWanderers.
     */
    alertNearbyWanderers(victim, source) {
        if (!victim || !source) return;
        const tiles = Party.WANDERER_ALERT_TILES || 10;
        const rangeSq = (TS * tiles) * (TS * tiles);
        const vx = victim.x;
        const vy = victim.y;
        const vid = victim.id;
        for (const w of this.wanderers.values()) {
            if (!w || w.id === vid || w.dead) continue;
            const dx = w.x - vx;
            const dy = w.y - vy;
            if (dx * dx + dy * dy > rangeSq) continue;
            w.hostile = true;
            w.recruitLocked = true;
            Party.setWildAggroOwner?.(w, source);
            const c = this._ensureWandererCreature(w);
            if (!c) continue;
            if (!c.ai) createAI(c, "neutralAnimal");
            Party.setWildAggroOwner?.(c, source);
            if (c.ai) {
                c.ai.hostile = true;
                c.ai.onDamaged?.(source);
            }
            c.hostile = true;
        }
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

    /** Session player id that should receive events for this pawn/creature. */
    _playerIdOf(entity) {
        if (!entity) return null;
        if (typeof entity === "string") {
            if (this.players.has(entity)) return entity;
            return this._sessionOfPawn({ id: entity })?.id || null;
        }
        const session = this._sessionOfPawn(entity);
        if (session) return session.id;
        const ownerId = entity.ownerId || entity.leaderId || entity.playerId;
        if (ownerId && this.players.has(ownerId)) return ownerId;
        const id = entity.id || entity.pawnId || null;
        return id && this.players.has(id) ? id : null;
    }

    _viewerControlId(viewerId) {
        const p = this.players.get(viewerId);
        return (p && (p.controlId || p.id)) || viewerId;
    }

    /** True if `entity` is the pawn this viewer is currently controlling. */
    _isViewerActingPawn(entity, viewerId) {
        if (!entity || !viewerId) return false;
        const cid = this._viewerControlId(viewerId);
        const pid = entity.pawnId || entity.id;
        return !!cid && pid === cid;
    }

    _combatLogRecipients(opts = {}) {
        const ids = new Set();
        const add = (v) => {
            if (!v) return;
            if (typeof v === "string") {
                const id = this._playerIdOf(v);
                if (id) ids.add(id);
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
        const isYou = this._isViewerActingPawn(attacker, viewerId);
        const vicIsYou = this._isViewerActingPawn(target, viewerId);

        if (opts.destroyed) {
            const who = vicIsYou
                ? "Your"
                : `${target.def?.name || target.displayName?.() || "Their"}'s`;
            return [
                { text: who, color: vicIsYou ? YOU : ENEMY },
                { text: `${partName} was destroyed!` }
            ];
        }

        if (opts.deflected) {
            const itemName = opts.deflectName || "apparel";
            return [
                { text: vicIsYou ? "Your" : "The", color: vicIsYou ? YOU : ENEMY },
                { text: itemName, color: WEAPON },
                { text: "deflected the blow" }
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
        const dmgStr = opts.glanced
            ? `(${Number(opts.damage).toFixed(1)}, glanced)`
            : `(${Number(opts.damage).toFixed(1)})`;
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
                const prefer = Party.wildAggroOwnerId?.(mob);
                let best = null;
                let bestD = Infinity;
                for (const c of self.creatures.values()) {
                    if (!c || c.kind !== "player" || c.isBodyDead()) continue;
                    if (c === mob || c.role === "wanderer") continue;
                    if (prefer && Party.ownerIdOf(c) !== prefer) continue;
                    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
                    if (d < bestD) {
                        bestD = d;
                        best = c;
                    }
                }
                return best;
            },
            getDuelTarget(mob) {
                if (!mob || !self._duelMap) return null;
                const id = Party.pawnIdOf(mob) || mob.id;
                const t = self._duelMap.get(id);
                return t && !t.isBodyDead?.() ? t : null;
            },
            getDuelMap() {
                return self._duelMap;
            },
            getDuelEntities() {
                return self._duelEntities || [];
            },
            get players() {
                return [...self.creatures.values()].filter(
                    (c) => c && c.kind === "player" && !c.isBodyDead()
                );
            },
            isBlocked: (x, y) => self.isBlocked(x, y),
            tileBlocked: (x, y) => self._tileBlocked(x, y),
            poseBlocked: (creature, x, y, pad) => self._partyPoseBlocked(creature, x, y, pad),
            terrainSpeedMult: (x, y) => self._terrainSpeedMult(x, y),
            getRestWalkDest(mob) {
                const spec = mob?._restWalk;
                if (!spec?.uid) return null;
                const found = self._findSleepByUid(spec.uid, mob);
                if (!found?.entry) return null;
                const pos = Sleep.sleeperWorldPos(
                    found.entry, spec.slot, TS, self._sleepDef(found.entry)
                );
                return { x: pos.x - TS * 0.5, y: pos.y + TS * 0.5 };
            },
            solidThingAt: (x, y) => self._solidThingAt(x, y),
            thingRectsNear: (x, y, radius) => self._thingRectsNear(x, y, radius),
            getItem: (id) => itemDefs().get(id),
            alertNearbyMobs: (victim, source) => self.alertNearbyMobs(victim, source),
            isControlled(mob) {
                if (!mob) return false;
                for (const p of self.players.values()) {
                    if (!p.connected) continue;
                    if ((p.controlId || p.id) === mob.id) return true;
                }
                return false;
            },
            leaderDead(mob) {
                const owner = self.players.get(mob?.ownerId);
                if (!owner) return true;
                const cid = owner.controlId || owner.id;
                if (cid !== owner.id) return false;
                return !!owner.dead;
            },
            getFollowTarget(mob) {
                const owner = self.players.get(mob?.ownerId);
                if (!owner || !owner.connected) return null;
                const cid = owner.controlId || owner.id;
                if (cid === owner.id) {
                    return owner.creature || self.creatures.get(owner.id);
                }
                const mem = (owner.party || []).find((m) => m.id === cid);
                return mem?.creature || self.creatures.get(cid) || owner.creature;
            },
            getPartyMates(mob) {
                const owner = self.players.get(mob?.ownerId);
                const out = [];
                const add = (rec) => {
                    if (!rec || rec.dead) return;
                    const c = rec.creature || self.creatures.get(rec.id);
                    if (c && !c.isBodyDead()) out.push(c);
                };
                if (owner) {
                    add(owner);
                    for (const m of owner.party || []) add(m);
                }
                if (mob?.role === "settler") {
                    const homeId = mob.homeSettlementId;
                    for (const rec of self.settlers || []) {
                        if (!rec || rec.dead || rec.id === mob.id) continue;
                        if (homeId && rec.homeSettlementId !== homeId) continue;
                        add(rec);
                    }
                }
                return out;
            },
            isPvpTarget(mob, target) {
                const owner = self.players.get(mob?.ownerId);
                const tid = target?.ownerId;
                if (!owner?.pvpAggro || !tid || !owner.pvpAggro.has(tid)) return false;
                const other = self.players.get(tid);
                return !other?.dead;
            },
            getAssistTarget(mob) {
                const duel = this.getDuelTarget(mob);
                if (duel) return duel;
                const owner = self.players.get(mob?.ownerId);
                return self._chaseTarget(owner);
            },
            shouldDelaySleep(mob) {
                const pawn = self._findOwnedPawn(mob?.id);
                if (!pawn) return false;
                const session = self._sessionOfPawn(pawn);
                return self._shouldDelaySleep(session, pawn);
            },
            tryReturnToBed(mob) {
                const pawn = self._findOwnedPawn(mob?.id);
                if (!pawn) return;
                const session = self._sessionOfPawn(pawn);
                self._tryReturnToBed(session, pawn);
            },
            tryInjuredRest(mob) {
                const pawn = self._findOwnedPawn(mob?.id);
                if (!pawn) return;
                const session = self._sessionOfPawn(pawn);
                self._tryInjuredRest(session, pawn);
            },
            getSettlement(mob) {
                const id = mob?.homeSettlementId;
                return (self.settlements || []).find((s) => s.id === id) || null;
            },
            tickSettler(mob, delta) {
                return self._tickSettlerWork?.(mob, delta);
            },
            releaseSettlerWork(mob) {
                SettlerWork.releaseWork(self, mob);
            }
        };
    }

    _rebuildDuelAssignments() {
        const entries = [];
        const seen = new Set();
        const add = (entity, extra = {}) => {
            if (!entity || entity.isBodyDead?.()) return;
            const id = Party.pawnIdOf(entity) || entity.id;
            if (!id || seen.has(id)) return;
            seen.add(id);
            entries.push({ entity, ...extra });
        };
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            const controlId = p.controlId || p.id;
            const chase = this._chaseTarget(p);
            if (!p.dead) {
                const c = p.creature || this.creatures.get(p.id) || this._ensurePlayerCreature(p);
                if (c && !c.isBodyDead()) {
                    add(c, {
                        occupyOnly: controlId === p.id,
                        preferredTarget: controlId === p.id ? chase : null
                    });
                }
            }
            for (const m of p.party || []) {
                if (m.dead) continue;
                const cc = m.creature || this.creatures.get(m.id) || this._ensureCompanionCreature(p, m);
                if (!cc || cc.isBodyDead()) continue;
                add(cc, {
                    occupyOnly: m.id === controlId,
                    preferredTarget: m.id === controlId ? chase : null
                });
            }
            if (chase) add(chase);
        }
        for (const w of this.wanderers.values()) {
            if (!w?.hostile || w.dead) continue;
            const c = this._ensureWandererCreature(w);
            add(c);
        }
        for (const mob of this.mobs.values()) {
            if (!mob || mob.isBodyDead()) continue;
            if (!(mob.ai?.hostile || mob.hostile || (mob.ai?.panicMs || 0) > 0)) continue;
            add(mob);
        }
        const map = Party.assignDuels(entries, this._duelIds, {
            tileSize: TS,
            canFight: (a, b) => this._playerCanFight(a, b)
        });
        this._duelMap = map;
        const ids = new Map();
        for (const [id, ent] of map) {
            const tid = Party.pawnIdOf(ent) || ent.id;
            if (tid) ids.set(id, tid);
        }
        this._duelIds = ids;
        this._duelEntities = entries.map((e) => e.entity);
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
        creature.ownerId = p.id;
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
        creature._vomitRemainingMs = Number(p.vomitRemainingMs) || 0;
        creature._resting = !!p._resting;
        creature._restWalk = p._restWalk || null;
        creature.lastSleep = p.lastSleep || null;
        return creature;
    }

    _resetPlayerAnatomy(p) {
        this._resetPawnAnatomy(p, p);
    }

    /** Fresh body for the leader or a companion (used by /heal). */
    _resetPawnAnatomy(session, pawn) {
        if (!session || !pawn) return;
        const isLeader = pawn === session || pawn.id === session.id;
        const creature = isLeader
            ? this._ensurePlayerCreature(session)
            : this._ensureCompanionCreature(session, pawn);
        if (!creature) return;
        creature.anatomy = new Body(creature.ctx, "human", creature);
        creature.capacities = new Capacities(creature.anatomy);
        creature._dead = false;
        creature.active = true;
        creature._prone = false;
        creature._corpsePayload = null;
        pawn.body = creature.anatomy.toJSON();
        pawn.dead = false;
        pawn.prone = false;
        pawn.hp = pawn.mhp;
        this._clearVomit(pawn);
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
        w.baseTickSpeed = data.clock?.baseTickSpeed != null
            ? Number(data.clock.baseTickSpeed)
            : w.tickSpeed;
        if (!Number.isFinite(w.baseTickSpeed) || w.baseTickSpeed < 0) w.baseTickSpeed = w.tickSpeed;
        w.tickSpeed = w.baseTickSpeed;
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
            for (const d of drops) Hide.migrateStackItemId(d);
            for (const corpse of meta.corpses || []) {
                if (!Array.isArray(corpse?.loot)) continue;
                for (const s of corpse.loot) Hide.migrateStackItemId(s);
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
        for (const snap of data.wanderers || []) {
            const rec = w._wandererRecordFromSnap(snap);
            if (rec) w.wanderers.set(rec.id, rec);
        }
        w.settlements = (data.settlements || []).map((s) => Settlement.ensureSettlement(s));
        w.settlers = [];
        for (const snap of data.settlers || []) {
            const rec = w._settlerFromSnap(snap);
            if (rec) w.settlers.push(rec);
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
            clock: {
                gameDay: this.gameDay,
                gameMinutes: this.gameMinutes,
                tickSpeed: Number.isFinite(this.baseTickSpeed) ? this.baseTickSpeed : this.tickSpeed
            },
            poses: this.poses || {},
            wanderers: [...this.wanderers.values()]
                .filter((w) => w && !w.dead)
                .map((w) => this._publicWanderer(w)),
            settlements: this.settlements || [],
            settlers: (this.settlers || []).filter((s) => s && !s.dead).map((s) => this._publicSettler(s)),
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
            overflow: p.overflow,
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
        const existing = this.players.get(playerId);
        if (existing) {
            if (character && typeof character === "object") {
                this._applyCharacterSnapshot(existing, character);
            }
            existing.connected = true;
            existing.poseAuth = false;
            existing._joinGraceUntil = Date.now() + 4000;
            this._ensurePlayerCreature(existing);
            this._placeNewCompanionsNearLeader(existing);
            this._interestLoad(existing.x, existing.y, this.interestRadius(existing));
            this._restorePawnSleep(existing, existing);
            for (const m of existing.party || []) this._restorePawnSleep(existing, m);
            this._sanitizeSleepOccupants();
            this._applyRestClock();
            this._youDirty.add(playerId);
            return existing;
        }
        const p = this._freshPawn(playerId, displayName);
        if (character && typeof character === "object") {
            this._applyCharacterSnapshot(p, character);
        }
        // Occupied sleepers are snapped to the bunk in `_restorePawnSleep`.
        this._restoreLogoutPose(p);
        this._placeNewCompanionsNearLeader(p);
        p.connected = true;
        p.poseAuth = false;
        p._joinGraceUntil = Date.now() + 4000;
        this.players.set(playerId, p);
        this._ensurePlayerCreature(p);
        this._interestLoad(p.x, p.y, this.interestRadius(p));
        this._restorePawnSleep(p, p);
        for (const m of p.party || []) this._restorePawnSleep(p, m);
        this._sanitizeSleepOccupants();
        this._applyRestClock();
        this._youDirty.add(playerId);
        this.pushEvent({ kind: "chat", text: `${p.name} joined`, system: true });
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
        if (this.isBlocked(x, y) && !saved.resting) {
            const near = this._findOpenNear(x, y, 6);
            if (near) {
                x = near.x;
                y = near.y;
            }
        }
        p.x = x;
        p.y = y;
        if (typeof saved.facing === "string" && saved.facing) p.facing = saved.facing;
        if (saved.lastSleep) p.lastSleep = saved.lastSleep;
        if (typeof saved.resting === "boolean") p._resting = !!saved.resting;
    }

    /**
     * Character-saved companion x,y is the last world, not this one.
     * Keep this-world logout poses; cluster anyone new beside the leader.
     */
    _placeNewCompanionsNearLeader(p) {
        if (!p) return;
        Party.placeJoinParty(p, p.party, this.poses, {
            tileSize: TS,
            findOpen: (x, y) => this._findOpenNear(x, y, 4)
        });
        for (const m of p.party || []) {
            if (m?.creature) {
                m.creature.x = m.x;
                m.creature.y = m.y;
            }
        }
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
                facing: p.facing || "down",
                resting: !!p._resting,
                lastSleep: p.lastSleep || null
            };
            for (const m of p.party || []) {
                if (!m?.id || !Number.isFinite(m.x)) continue;
                this.poses[m.id] = {
                    x: m.x,
                    y: m.y,
                    facing: m.facing || "down",
                    resting: !!m._resting,
                    lastSleep: m.lastSleep || null
                };
            }
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
            facing: p.facing || "down",
            resting: !!p._resting,
            lastSleep: p.lastSleep || null
        };
        for (const m of p.party || []) {
            if (!m?.id || !Number.isFinite(m.x)) continue;
            this.poses[m.id] = {
                x: m.x,
                y: m.y,
                facing: m.facing || "down",
                resting: !!m._resting,
                lastSleep: m.lastSleep || null
            };
        }
    }

    _applyCharacterSnapshot(p, character) {
        if (character.name) p.name = String(character.name).slice(0, 24);
        if (typeof character.kc === "number") p.kc = character.kc;
        if (typeof character.saturation === "number") p.saturation = character.saturation;
        if (typeof character.stomach === "number") p.stomach = character.stomach;
        if (Array.isArray(character.inventory)) {
            p.inventory = character.inventory.slice(0, 40);
            while (p.inventory.length < 5) p.inventory.push(null);
            for (const s of p.inventory) Hide.migrateStackItemId(s);
        }
        if (character.equipment && typeof character.equipment === "object") {
            p.equipment = {
                head: character.equipment.head ?? null,
                torso: character.equipment.torso ?? null,
                legs: character.equipment.legs ?? null,
                feet: character.equipment.feet ?? null,
                back: character.equipment.back ?? null,
                waist: Array.isArray(character.equipment.waist)
                    ? character.equipment.waist.slice()
                    : []
            };
        }
        if (Array.isArray(character.overflow)) {
            p.overflow = character.overflow.slice(0, 16);
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
        if (Array.isArray(character.party)) {
            p.party = character.party.map((m) => this._companionFromSnap(p, m));
        }
        if (character.controlId) p.controlId = character.controlId;
        if (character.lastSleep) p.lastSleep = character.lastSleep;
        if (typeof character.resting === "boolean") p._joinRestHint = !!character.resting;
        if (p.hp <= 0) {
            p.dead = true;
        }
        this._migratePlayerSpoilLeft(p);
        for (const m of p.party || []) this._migratePlayerSpoilLeft(m);
        this._ensureEquipment(p);
        this._syncPlayerInvSize(p);
        this._enforceCarryCap(p);
        for (const m of p.party || []) {
            this._ensureEquipment(m);
            this._syncPlayerInvSize(m);
            this._enforceCarryCap(m);
        }
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
            overflow: [],
            equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
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
            vomitRemainingMs: 0,
            vomitDripAccMs: 0,
            connected: true,
            viewChunks: INTEREST,
            poseAuth: false,
            lastInputMs: 0,
            look: Look.normalizeLook(null),
            party: [],
            controlId: id,
            ownerId: id
        };
    }

    _companionFromSnap(owner, m) {
        const id = m.id || uuid();
        const rec = {
            id,
            name: m.name || CavemanNames.generate(),
            x: Number.isFinite(m.x) ? m.x : owner.x + 16,
            y: Number.isFinite(m.y) ? m.y : owner.y,
            facing: m.facing || "down",
            kc: m.kc ?? 800,
            saturation: m.saturation ?? 0,
            stomach: m.stomach ?? 1600,
            inventory: Array.isArray(m.inventory) ? m.inventory : emptyInv(5),
            overflow: Array.isArray(m.overflow) ? m.overflow : [],
            equipment: m.equipment || { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
            hotbarIndex: m.hotbarIndex || 0,
            hp: m.hp ?? 100,
            mhp: m.mhp ?? 100,
            body: m.body || null,
            look: Look.normalizeLook(m.look),
            dead: false,
            ownerId: owner.id,
            leaderId: owner.id,
            role: "companion",
            lastSleep: m.lastSleep || null,
            _resting: false,
            _joinRestHint: !!m.resting
        };
        this._restoreLogoutPose(rec);
        this._ensureCompanionCreature(owner, rec);
        return rec;
    }

    _ensureCompanionCreature(owner, rec) {
        if (!rec) return null;
        let creature = this.creatures.get(rec.id);
        if (!creature) {
            creature = createPlayerCreature(
                {
                    id: rec.id,
                    name: rec.name,
                    x: rec.x,
                    y: rec.y,
                    facing: rec.facing,
                    inventory: rec.inventory,
                    equipment: rec.equipment,
                    hotbarIndex: rec.hotbarIndex,
                    body: rec.body,
                    look: rec.look
                },
                this.dataStore,
                this._creatureCtx()
            );
            creature.ownerId = owner.id;
            creature.leaderId = owner.id;
            creature.role = "companion";
            creature.faction = Party.partyFactionId(owner.id);
            this.creatures.set(rec.id, creature);
        }
        rec.creature = creature;
        creature.x = rec.x;
        creature.y = rec.y;
        creature.inventory = rec.inventory;
        creature.equipment = rec.equipment;
        creature.hotbarIndex = rec.hotbarIndex ?? 0;
        creature.ownerId = owner.id;
        creature.leaderId = owner.id;
        creature.role = "companion";
        creature.homeSettlementId = rec.homeSettlementId || null;
        creature.faction = Party.partyFactionId(owner.id);
        this._bindPartyAI(creature);
        if (!creature.homeSettlementId && creature.ai) {
            creature.ai._idleWanderState = null;
            creature.ai._idleWanderDest = null;
            creature.ai._path = null;
        }
        return creature;
    }

    /**
     * WandererStrollAI extends PartyAI, so `instanceof PartyAI` stays true after
     * recruit and they keep strolling until relog. Require the exact class.
     */
    _bindPartyAI(creature) {
        if (!creature) return null;
        if (creature.ai && creature.ai.constructor === PartyAI) return creature.ai;
        creature.walkDest = null;
        creature.setDesiredVel?.(0, 0);
        creature.vx = 0;
        creature.vy = 0;
        creature.ai = new PartyAI(creature);
        return creature.ai;
    }

    _settlerFromSnap(snap) {
        if (!snap?.id) return null;
        return {
            id: snap.id,
            name: snap.name,
            look: snap.look,
            x: snap.x,
            y: snap.y,
            facing: snap.facing || "down",
            kc: snap.kc ?? 1200,
            saturation: snap.saturation ?? 0,
            stomach: snap.stomach ?? 1600,
            inventory: Array.isArray(snap.inventory) ? snap.inventory : [null, null, null, null, null],
            overflow: Array.isArray(snap.overflow) ? snap.overflow : [],
            equipment: snap.equipment || { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
            hotbarIndex: snap.hotbarIndex || 0,
            body: snap.body || null,
            hp: snap.hp ?? 100,
            mhp: snap.mhp ?? 100,
            ownerId: snap.ownerId || null,
            homeSettlementId: snap.homeSettlementId || null,
            role: "settler",
            lastSleep: snap.lastSleep || null,
            resting: !!snap.resting,
            _resting: !!snap.resting
        };
    }

    _publicSettler(s) {
        if (!s) return null;
        const c = s.creature || this.creatures.get(s.id);
        const motion = this._poseMotion(s);
        return {
            id: s.id,
            name: s.name,
            x: s.x,
            y: s.y,
            facing: s.facing,
            vx: motion.vx,
            vy: motion.vy,
            moving: motion.moving,
            look: s.look,
            ownerId: s.ownerId,
            homeSettlementId: s.homeSettlementId,
            role: "settler",
            dead: !!s.dead,
            prone: !!(s.dead || s.prone || s._resting),
            resting: !!s._resting,
            attacking: (s.attackTimer || 0) > 0,
            attackAngle: s.attackAngle ?? null,
            attackArt: (s.attackTimer || 0) > 0 ? (s.attackArt || null) : null,
            channel: SettlerWork.publicChannel?.(s) || null
        };
    }

    _ensureSettlerCreature(rec) {
        if (!rec) return null;
        let creature = this.creatures.get(rec.id);
        if (!creature) {
            creature = createPlayerCreature(
                {
                    id: rec.id,
                    name: rec.name,
                    x: rec.x,
                    y: rec.y,
                    facing: rec.facing,
                    inventory: rec.inventory,
                    equipment: rec.equipment,
                    hotbarIndex: rec.hotbarIndex,
                    body: rec.body,
                    look: rec.look
                },
                this.dataStore,
                this._creatureCtx()
            );
            this.creatures.set(rec.id, creature);
        }
        rec.creature = creature;
        creature.x = rec.x;
        creature.y = rec.y;
        creature.inventory = rec.inventory;
        creature.equipment = rec.equipment;
        creature.hotbarIndex = rec.hotbarIndex ?? 0;
        creature.ownerId = rec.ownerId;
        creature.leaderId = rec.ownerId;
        creature.role = "settler";
        creature.homeSettlementId = rec.homeSettlementId;
        creature.faction = Party.partyFactionId(rec.ownerId);
        creature._resting = !!(rec._resting || rec.resting);
        creature._restWalk = rec._restWalk || null;
        creature._wadeWater = !!rec._wadeWater;
        creature.lastSleep = rec.lastSleep || creature.lastSleep;
        this._bindPartyAI(creature);
        return creature;
    }

    _ownedSettlements(ownerId) {
        return Settlement.ownedOf(this.settlements, ownerId);
    }

    _handleSettlement(p, action = {}) {
        const op = String(action.op || "");
        if (op === "found") {
            this._tryPlace(p, { ...action, name: action.name });
            return;
        }
        const settle = this.settlements.find((s) => s.id === action.settlementId) || null;
        if (op === "rename" && settle && settle.ownerId === p.id) {
            settle.name = Settlement.clampName(action.name);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "destroy" && settle && settle.ownerId === p.id) {
            this._destroySettlement(settle);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "drop") {
            const mem = (p.party || []).find((m) => String(m.id) === String(action.pawnId));
            let dropSettle = settle && settle.ownerId === p.id ? settle : null;
            if (!dropSettle && mem) {
                dropSettle = Settlement.atPoint(
                    this._ownedSettlements(p.id),
                    mem.x,
                    mem.y,
                    TS,
                    p.id
                ) || Settlement.atPoint(
                    this._ownedSettlements(p.id),
                    p.x,
                    p.y,
                    TS,
                    p.id
                );
            }
            if (!mem || mem.id === p.id || !dropSettle || dropSettle.ownerId !== p.id) return;
            if ((p.controlId || p.id) === mem.id) p.controlId = p.id;
            p.party = p.party.filter((m) => m !== mem);
            mem.role = "settler";
            mem.homeSettlementId = dropSettle.id;
            mem.ownerId = p.id;
            if (!dropSettle.jobs) dropSettle.jobs = {};
            dropSettle.jobs[mem.id] = Settlement.defaultJobs();
            this.settlers.push(mem);
            SettlerWork.releaseWork(this, mem);
            const cc = this._ensureSettlerCreature(mem);
            if (cc?.ai) {
                cc.ai._path = null;
                cc.ai._pathGoalX = null;
                cc.ai._pathGoalY = null;
                cc.ai._holdFollow = false;
                cc.ai.assistTarget = null;
                cc.ai.eatSeek = null;
                cc.ai.tendSeek = null;
                cc.ai._idleWanderState = null;
                cc.ai._idleWanderDest = null;
            }
            this._youDirty.add(p.id);
            return;
        }
        if (op === "pick" || op === "pickOrphan") {
            const rec = this.settlers.find((s) => s.id === action.pawnId);
            if (!rec || rec.ownerId !== p.id) return;
            if ((p.party || []).length + 1 >= Party.CAP) return;
            this.settlers = this.settlers.filter((s) => s !== rec);
            rec.role = "companion";
            rec.homeSettlementId = null;
            SettlerWork.releaseWork(this, rec);
            if (!p.party) p.party = [];
            p.party.push(rec);
            this._ensureCompanionCreature(p, rec);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "transfer" && settle && settle.ownerId === p.id) {
            const rec = this.settlers.find((s) => s.id === action.pawnId);
            const dest = this.settlements.find((s) => s.id === action.destId);
            if (!rec || !dest || dest.ownerId !== p.id) return;
            const from = this.settlements.find((s) => s.id === rec.homeSettlementId);
            rec.homeSettlementId = dest.id;
            const d = from ? Settlement.distTiles(from.x, from.y, dest.x, dest.y, TS) : 999;
            if (Settlement.transferMode(d) === "teleport") {
                rec.x = dest.x + 12;
                rec.y = dest.y + 8;
            }
            this._youDirty.add(p.id);
            return;
        }
        if (op === "addStation" && settle && settle.ownerId === p.id) {
            const uid = action.uid;
            if (!uid) return;
            if (this.settlements.some((s) => s.id !== settle.id && (s.stationUids || []).includes(uid))) return;
            if (!settle.stationUids) settle.stationUids = [];
            if (!settle.stationUids.includes(uid)) settle.stationUids.push(uid);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "removeStation" && settle && settle.ownerId === p.id) {
            settle.stationUids = (settle.stationUids || []).filter((u) => u !== action.uid);
            if (settle.bills) delete settle.bills[action.uid];
            this._youDirty.add(p.id);
            return;
        }
        if (op === "setBills" && settle && settle.ownerId === p.id) {
            Settlement.setBills(settle, action.stationUid, action.bills);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "setStorageFilter" && settle && settle.ownerId === p.id) {
            const uid = String(action.uid || "");
            if (!uid || !(settle.stationUids || []).includes(uid)) return;
            const found = this._findThingByUid(uid);
            if (!found) return;
            if (Settlement.stationKind(found.entry?.id) !== "storage") return;
            StorageFilter.applyToEntry(found.entry, action.filter);
            this._emitStorage(found.chunk, found.entry);
            return;
        }
        if (op === "setJobs" && settle && settle.ownerId === p.id) {
            settle.jobs = settle.jobs || {};
            settle.jobs[action.pawnId] = Settlement.normalizeJobs(action.jobs);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "setStock" && settle && settle.ownerId === p.id) {
            settle.stock = Settlement.normalizeStock(action.stock);
            this._youDirty.add(p.id);
            return;
        }
    }

    _destroySettlement(settle) {
        if (!settle) return;
        const name = Settlement.clampName(settle.name) || "Camp";
        const heading = Settlement.cardinalHeading(() => this.rng());
        const keep = [];
        for (const rec of this.settlers) {
            if (rec.homeSettlementId !== settle.id) {
                keep.push(rec);
                continue;
            }
            this._ensureSettlerCreature(rec);
            if (rec._resting || rec.resting) this._wakePawn(null, rec, { manual: true });
            else this._vacatePawn(rec);
            this._releaseSettlerAsWanderer(rec, heading);
        }
        this.settlers = keep;
        this.settlements = this.settlements.filter((s) => s.id !== settle.id);
        if (settle.stoneUid) {
            for (const c of this.chunks.values()) {
                const list = c.things;
                if (!Array.isArray(list)) continue;
                const i = list.findIndex((t) => t?.uid === settle.stoneUid);
                if (i >= 0) {
                    const entry = list[i];
                    list.splice(i, 1);
                    this._emitStorageRemoved(c, entry);
                    break;
                }
            }
        }
        this._announceWorld(`${name} has been destroyed!`);
    }

    _releaseSettlerAsWanderer(rec, heading) {
        if (!rec?.id) return;
        const h = this._wandererHeading(heading);
        const c = rec.creature || this.creatures.get(rec.id);
        if (c) {
            c.role = "wanderer";
            c.ownerId = null;
            c.leaderId = null;
            c.homeSettlementId = null;
            c.faction = Party.FACTION_WANDERERS;
            c._resting = false;
            c._restWalk = null;
            c.ai = null;
        }
        if (this.wanderers.has(rec.id)) return;
        this.wanderers.set(rec.id, {
            id: rec.id,
            name: rec.name,
            look: rec.look,
            x: rec.x,
            y: rec.y,
            facing: h.x > 0 ? "right" : h.x < 0 ? "left" : h.y > 0 ? "down" : "up",
            heading: h,
            inventory: rec.inventory,
            body: rec.body || c?.anatomy?.toJSON?.() || null,
            hostile: false,
            recruitLocked: false,
            refusedBy: [],
            kc: rec.kc,
            overflow: rec.overflow,
            equipment: rec.equipment
        });
    }

    _pinSettlements() {
        for (const settle of this.settlements || []) {
            const n = (this.settlers || []).filter((s) => s && !s.dead && s.homeSettlementId === settle.id).length;
            if (!Settlement.shouldPin(settle, n)) continue;
            for (const key of Settlement.chunkKeysFor(settle, TS, CS)) {
                const [cx, cy] = key.split(",").map(Number);
                this._ensureChunk(cx, cy);
            }
        }
        for (const rec of this.settlers || []) {
            if (!rec || rec.dead || rec.homeSettlementId) continue;
            if (Number.isFinite(rec.x)) this._interestLoad(rec.x, rec.y, 1);
        }
    }

    _tickSettlerWork(mob, delta) {
        return SettlerWork.tick(this, mob, delta);
    }

    _thingDef(id) {
        return thingDefs().get(id);
    }

    _itemDef(id) {
        return itemDefs().get(id);
    }

    _findThingByUid(uid) {
        if (!uid) return null;
        const want = String(uid);
        for (const c of this.chunks.values()) {
            const list = c.things;
            if (!Array.isArray(list)) continue;
            for (const t of list) {
                if (t?.uid === want) return { chunk: c, entry: t };
            }
        }
        return null;
    }

    _ownedPawns(p) {
        if (!p) return [];
        const out = [p, ...(p.party || [])].filter(Boolean);
        const seen = new Set(out.map((x) => x.id));
        for (const s of this.settlers || []) {
            if (!s || s.dead || s.ownerId !== p.id || seen.has(s.id)) continue;
            out.push(s);
            seen.add(s.id);
        }
        return out;
    }

    /** Party member to receive a dragged stack, or `from` when toPawnId is omitted. */
    _partyGiveDest(session, action, from) {
        const id = action?.toPawnId;
        if (!id) return from;
        const to = this._ownedPawns(session).find((m) => m.id === id);
        if (!to || to.dead) return null;
        if (to === from) return from;
        const dist = Math.hypot(from.x - to.x, from.y - to.y) / TS;
        if (dist > Party.INTERACT_TILES + 0.2) return null;
        return to;
    }

    /** Pawn that should perform an action (controlled companion, else leader). */
    _actionPawn(p, action = {}) {
        if (!p) return null;
        const id = action?.pawnId || p.controlId || p.id;
        if (id && id !== p.id) {
            const mem = (p.party || []).find((m) => m.id === id);
            if (mem && !mem.dead) return mem;
            const rec = (this.settlers || []).find(
                (s) => s && s.id === id && s.ownerId === p.id && !s.dead
            );
            if (rec) return rec;
        }
        return p;
    }

    _pawnVomiting(pawn) {
        if (this._isVomiting(pawn)) return true;
        const c = pawn?.creature || this.creatures.get(pawn?.id);
        return Number(c?._vomitRemainingMs) > 0;
    }

    _handleRecruit(p, action) {
        const wid = action.wandererId;
        const w = this.wanderers.get(wid);
        if (!w || w.hostile || w.recruitLocked) return;
        if ((p.party || []).length + 1 >= Party.CAP) {
            const actor = (p.party || []).find((m) => m.id === p.controlId) || p;
            const settle = Settlement.atPoint(this.settlements, actor.x, actor.y, TS, p.id);
            if (settle) {
                // fall through after checks by parking as settler
            } else return;
        }
        const refused = w.refusedBy || [];
        if (refused.includes(p.id)) return;
        const control = (p.party || []).find((m) => m.id === p.controlId) || p;
        if (!Party.inInteractRange(control, w, TS)) return;
        const held = control.inventory?.[control.hotbarIndex];
        const meta = held ? itemDefs().get(held.id) : null;
        const food = held?.food || meta?.food;
        const holdingFood = !!(food && Number(food.kc ?? 0) > 0);
        const chance = Party.recruitChance(holdingFood);
        if (holdingFood) this._consumeOfferedFood(control);
        if (this.rng() >= chance) {
            w.refusedBy = [...refused, p.id];
            this.pushEvent({
                kind: "recruit",
                wandererId: wid,
                accepted: false,
                name: w.name,
                to: p.id
            });
            return;
        }
        const rec = this._companionFromSnap(p, {
            id: w.id,
            name: w.name,
            look: w.look,
            x: w.x,
            y: w.y,
            facing: w.facing,
            inventory: w.inventory,
            kc: Party.rollRoughKc(() => this.rng()),
            body: w.body || null
        });
        const actor = (p.party || []).find((m) => m.id === p.controlId) || p;
        const park = Settlement.atPoint(this.settlements, actor.x, actor.y, TS, p.id);
        const full = (p.party || []).length + 1 >= Party.CAP;
        if (full && park) {
            rec.role = "settler";
            rec.homeSettlementId = park.id;
            rec.ownerId = p.id;
            if (!park.jobs) park.jobs = {};
            park.jobs[rec.id] = Settlement.defaultJobs();
            this.settlers.push(rec);
            this._ensureSettlerCreature(rec);
        } else {
            if (!p.party) p.party = [];
            p.party.push(rec);
        }
        const inj = Party.rollRoughInjury(() => this.rng());
        if (inj && rec.creature?.anatomy?.part) {
            const part = rec.creature.anatomy.part(inj.partName);
            if (part && !part.isDead?.()) {
                part.injure(inj);
                rec.body = rec.creature.anatomy.toJSON();
            }
        }
        this.wanderers.delete(wid);
        this._youDirty.add(p.id);
        this.pushEvent({
            kind: "recruit",
            wandererId: wid,
            accepted: true,
            name: rec.name,
            to: p.id
        });
    }

    /** Spend one held food (or leftover meal) as a recruit gift. */
    _consumeOfferedFood(pawn) {
        if (!pawn?.inventory) return;
        const slot = pawn.hotbarIndex ?? 0;
        const held = pawn.inventory[slot];
        if (!held) return;
        const meta = itemDefs().get(held.id);
        const food = held.food || meta?.food;
        if (!(Number(food?.kc ?? 0) > 0)) return;
        held.quantity = (held.quantity || 1) - 1;
        if (!(held.quantity > 0)) pawn.inventory[slot] = null;
        this._youDirty.add(pawn.ownerId || pawn.id);
    }

    _handleGiveItem(p, action) {
        const from = this._ownedPawns(p).find((m) => m.id === (action.fromPawnId || p.controlId || p.id)) || p;
        const to = this._ownedPawns(p).find((m) => m.id === action.toPawnId);
        if (!from || !to || from === to) return;
        const slot = Number(action.fromSlot);
        const fromBag = this._normBag(action.fromBag);
        const fromInv = this._pawnBag(from, fromBag);
        const stack = fromInv?.[slot];
        if (!stack) return;
        const dist = Math.hypot(from.x - to.x, from.y - to.y) / TS;
        if (dist > Party.INTERACT_TILES + 0.2) return;
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        fromInv[slot] = null;
        const left = this._giveOwnedStack(to, { ...stack, quantity: qty });
        if (left > 0) {
            stack.quantity = left;
            fromInv[slot] = stack;
        }
        this._youDirty.add(p.id);
    }

    /** Equip one into an empty slot if possible, then inventory. Returns leftover qty. */
    _giveOwnedStack(to, stack) {
        if (!to || !stack?.id) return Math.max(1, Math.floor(Number(stack?.quantity) || 1));
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        const extras = this._stackExtrasFrom(stack);
        this._ensureEquipment(to);
        let remaining = qty;
        const equipKey = this._emptyEquipSlotForItem(to, stack.id);
        if (equipKey && !this._stackIsSpecial(stack)) {
            this._setEquipStack(to, equipKey, this._cloneGearStack(stack, 1));
            this._syncWaistSlots(to);
            this._syncPlayerInvSize(to);
            remaining = qty - 1;
        }
        if (remaining <= 0) {
            this._youDirty.add(to.ownerId || to.id);
            return 0;
        }
        return this._give(to, stack.id, remaining, extras);
    }

    _handlePartyEat(p, action) {
        const eater = this._ownedPawns(p).find((m) => m.id === action.eaterId);
        const from = this._ownedPawns(p).find((m) => m.id === action.fromPawnId) || eater;
        if (!eater || !from) return;
        if (eater.dead || this._pawnVomiting(eater) || eater.eatChannel) return;
        const slot = Number(action.slot);
        const bag = this._normBag(action.bag);
        const stack = this._pawnBag(from, bag)?.[slot];
        if (!stack) return;
        const food = this._foodForEat(stack);
        if (!(Number(food.kc) > 0)) return;
        const isMeal = this._isPartialFood(stack);
        const room = (Number(eater.stomach) || 0) - (Number(eater.kc) || 0);
        if (isMeal && !(room > 0)) return;
        const seconds = this._eatSecondsFor(food, isMeal);
        const max = seconds * 1000 * this._eatingDurationScale(eater);
        eater.eatChannel = {
            remaining: max,
            max,
            slot,
            bag,
            fromId: from.id,
            itemId: stack.id,
            itemIndex: slot,
            isMeal
        };
        this._youDirty.add(p.id);
    }

    _handleFeed(p, action) {
        const owned = this._ownedPawns(p);
        const feeder = owned.find((m) => m.id === (action.fromPawnId || p.controlId || p.id)) || p;
        const patient = owned.find((m) => m.id === action.patientId);
        if (!feeder || !patient || feeder === patient) return;
        if (patient.dead) return;
        const dist = Math.hypot(feeder.x - patient.x, feeder.y - patient.y) / TS;
        if (dist > Party.INTERACT_TILES + 0.2) return;
        const slot = Number(action.slot);
        const bag = this._normBag(action.bag);
        const held = this._pawnBag(feeder, bag)?.[slot];
        const wantId = action.itemId ? String(action.itemId) : null;
        if (!held?.id || (wantId && held.id !== wantId)) return;
        const food = this._foodForEat(held);
        const total = Number(food.kc) || 0;
        if (!(total > 0)) return;
        const room = Math.max(0, (Number(patient.stomach) || 0) - (Number(patient.kc) || 0));
        const isMeal = this._isPartialFood(held);
        if (isMeal) {
            const consumed = Math.min(total, room);
            if (!(consumed > 0)) return;
            patient.kc += consumed;
            patient.saturation += consumed * this._satietyRatio(food, true);
            this._tryFoodPoison(patient, food);
            if (consumed < total) {
                if (!held.food) held.food = { ...food };
                if (held.food.kcFull == null) held.food.kcFull = Math.round(total);
                held.food.kc = Math.max(0, Math.round(total - consumed));
                if (!(held.food.kc > 0)) this._pawnBag(feeder, bag)[slot] = null;
            } else {
                held.quantity = (held.quantity || 1) - 1;
                if (!(held.quantity > 0)) this._pawnBag(feeder, bag)[slot] = null;
            }
        } else {
            patient.kc += Math.min(total, room);
            patient.saturation += total * this._satietyRatio(food, false);
            this._tryFoodPoison(patient, food);
            held.quantity = (held.quantity || 1) - 1;
            if (!(held.quantity > 0)) this._pawnBag(feeder, bag)[slot] = null;
        }
        this._youDirty.add(p.id);
    }

    _publicWanderer(w) {
        if (!w) return null;
        const c = w.creature;
        const attacking = !!(c?.attackTimer > 0 || w.attackTimer > 0);
        return {
            id: w.id,
            name: w.name,
            look: w.look,
            x: w.x,
            y: w.y,
            facing: w.facing,
            inventory: w.inventory,
            hostile: !!w.hostile,
            recruitLocked: !!w.recruitLocked,
            refusedBy: Array.isArray(w.refusedBy)
                ? w.refusedBy
                : [...(w.refusedBy || [])],
            heading: this._wandererHeading(w.heading),
            moving: !!w._moved,
            body: w.body || c?.anatomy?.toJSON?.() || null,
            attacking,
            attackAngle: attacking ? (c?.attackAngle ?? w.attackAngle ?? null) : null,
            attackArt: attacking ? (c?.attackArt || w.attackArt || null) : null
        };
    }

    _headingLive(h) {
        const x = Number(h?.x);
        const y = Number(h?.y);
        return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) + Math.abs(y) > 0;
    }

    _wandererHeading(h) {
        if (this._headingLive(h)) return { x: Number(h.x), y: Number(h.y) };
        return { x: 1, y: 0 };
    }

    _wandererRecordFromSnap(snap) {
        if (!snap?.id || snap.dead) return null;
        const x = Number(snap.x);
        const y = Number(snap.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
            id: snap.id,
            name: snap.name,
            look: snap.look || null,
            x,
            y,
            facing: snap.facing || "down",
            heading: this._wandererHeading(snap.heading),
            inventory: snap.inventory || null,
            hostile: !!snap.hostile,
            recruitLocked: !!snap.recruitLocked,
            refusedBy: Array.isArray(snap.refusedBy) ? snap.refusedBy : [],
            body: snap.body || null,
            dead: false,
            _avoidSide: 1
        };
    }

    _mobTimeScale() {
        return Party.mobTimeScale
            ? Party.mobTimeScale(this.tickSpeed)
            : Party.wandererTimeScale(this.tickSpeed);
    }

    _wandererTimeScale() {
        return this._mobTimeScale();
    }

    _tickWandererDirector(dtMs) {
        const speed = Number.isFinite(this.tickSpeed) && this.tickSpeed >= 0 ? this.tickSpeed : 1;
        const online = [...this.players.values()].some((p) => p.connected && !p.dead);
        if (!online) return;
        this._cullDistantWanderers();
        this._rebuildDuelAssignments();
        const moveScale = this._wandererTimeScale();
        const moveDt = dtMs * moveScale;
        for (const w of [...this.wanderers.values()]) {
            if (!w || w.dead) continue;
            if (Number.isFinite(w.x) && Number.isFinite(w.y)) {
                this._interestLoad(w.x, w.y, 1);
            }
            this._ensureWandererCreature(w);
            if (w.hostile) this._stepHostileWanderer(w, moveDt);
            else this._stepWanderer(w, moveDt);
            if (w.creature) {
                w.creature.x = w.x;
                w.creature.y = w.y;
            }
        }
        this._directorCd -= (dtMs / 1000) * speed;
        if (this._directorCd > 0) return;
        const clusters = this._playerClusters();
        for (const group of clusters) {
            const anchor = group[0];
            if (!anchor) continue;
            const nearby = [...this.wanderers.values()].some((w) =>
                w && !w.hostile && !w.dead
                && Math.hypot(w.x - anchor.x, w.y - anchor.y) < 36 * TS
            );
            if (nearby) continue;
            if (!this._spawnWandererNear(anchor)) {
                this._directorCd = 3;
                continue;
            }
            this._directorCd = Party.directorCooldown((anchor.party?.length || 0) + 1, () => this.rng());
            return;
        }
    }

    /** Drop passersby who have walked out of play so they don't occupy the spawn slot. */
    _cullDistantWanderers() {
        const players = [...this.players.values()].filter((p) => p.connected && !p.dead);
        if (!players.length) return;
        const maxD = 36 * TS;
        const now = Date.now();
        const anchors = [];
        for (const p of players) {
            if (p._joinGraceUntil && now < p._joinGraceUntil) continue;
            if (Number.isFinite(p.x) && Number.isFinite(p.y)) anchors.push({ x: p.x, y: p.y });
        }
        const poses = this.poses && typeof this.poses === "object" ? this.poses : {};
        for (const pose of Object.values(poses)) {
            if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) continue;
            anchors.push({ x: pose.x, y: pose.y });
        }
        if (!anchors.length) return;
        const nearAny = (w) => anchors.some((a) => Math.hypot(w.x - a.x, w.y - a.y) < maxD);
        for (const w of [...this.wanderers.values()]) {
            if (!w || w.dead || w.hostile) continue;
            if (nearAny(w)) continue;
            this.wanderers.delete(w.id);
            this.creatures.delete(w.id);
        }
    }

    _playerClusters() {
        const players = [...this.players.values()].filter((p) => p.connected && !p.dead);
        const used = new Set();
        const clusters = [];
        const R = 48 * TS;
        for (const p of players) {
            if (used.has(p.id)) continue;
            const group = [p];
            used.add(p.id);
            for (const q of players) {
                if (used.has(q.id)) continue;
                if (Math.hypot(q.x - p.x, q.y - p.y) < R) {
                    group.push(q);
                    used.add(q.id);
                }
            }
            clusters.push(group);
        }
        return clusters;
    }

    _ensureWandererCreature(w) {
        if (!w?.id) return null;
        w.heading = this._wandererHeading(w.heading);
        let creature = this.creatures.get(w.id);
        if (creature && (creature._dead || creature.role !== "wanderer")) {
            this.creatures.delete(w.id);
            creature = null;
        }
        if (!creature) {
            creature = createPlayerCreature(
                {
                    id: w.id,
                    name: w.name,
                    x: w.x,
                    y: w.y,
                    facing: w.facing,
                    inventory: w.inventory,
                    look: w.look,
                    body: w.body || null,
                    role: "wanderer",
                    ownerId: null
                },
                this.dataStore,
                this._creatureCtx()
            );
            if (w.aggroOwnerId && !creature.aggroOwnerId) creature.aggroOwnerId = w.aggroOwnerId;
            this.creatures.set(w.id, creature);
        }
        w.creature = creature;
        creature._dead = false;
        creature.active = true;
        creature.role = "wanderer";
        creature.ownerId = null;
        creature.faction = Party.FACTION_WANDERERS;
        creature.x = w.x;
        creature.y = w.y;
        creature.inventory = w.inventory;
        if (w.hostile) this._ensureHostileWandererAI(w, creature);
        return creature;
    }

    /**
     * Stroll AI is attached while they walk in. Hitting them sets hostile but
     * leaves that AI in place unless we swap to NeutralAnimalAI.
     */
    _ensureHostileWandererAI(w, c) {
        if (!c) return null;
        if (!(c.ai instanceof NeutralAnimalAI)) {
            const aggro = w?.aggroOwnerId || c.aggroOwnerId || c.ai?.aggroOwnerId || null;
            const source = c._lastHitBy || null;
            createAI(c, "neutralAnimal");
            if (aggro) {
                if (w && !w.aggroOwnerId) w.aggroOwnerId = aggro;
                if (!c.aggroOwnerId) c.aggroOwnerId = aggro;
                if (c.ai && !c.ai.aggroOwnerId) c.ai.aggroOwnerId = aggro;
            }
            if (source) c.ai?.onDamaged?.(source);
        }
        if (c.ai) {
            c.ai.hostile = true;
            c.hostile = true;
        }
        return c.ai;
    }

    _stepHostileWanderer(w, dtMs) {
        const world = this._aiWorld();
        const c = this._ensureWandererCreature(w);
        this._ensureHostileWandererAI(w, c);
        if (!c?.ai) {
            this._stepWanderer(w, dtMs);
            return;
        }
        c.x = w.x;
        c.y = w.y;
        c.ai.hostile = true;
        c.refreshCapacities?.();
        const wasSwinging = !!c.isAttacking?.();
        c.ai.update?.(dtMs, world);
        if (!c.ai.hostile) {
            w.hostile = false;
            Party.clearWildAggroOwner?.(w);
            Party.clearWildAggroOwner?.(c);
            this._stepWanderer(w, dtMs);
            return;
        }
        c.applyDesiredVel(dtMs);
        const dt = dtMs / 1000;
        const ox = w.x;
        const oy = w.y;
        const swim = this._terrainSpeedMult(w.x, w.y - 1);
        const nx = w.x + (c.vx || 0) * dt * swim;
        const ny = w.y + (c.vy || 0) * dt * swim;
        if (!this.isBlocked(nx, w.y, { swim: true })) w.x = nx;
        if (!this.isBlocked(w.x, ny, { swim: true })) w.y = ny;
        w._moved = Math.hypot(w.x - ox, w.y - oy) > 0.15
            || Math.hypot(c.vx || 0, c.vy || 0) > 2;
        c.x = w.x;
        c.y = w.y;
        w.facing = c.facing || w.facing;
        const vx = c.vx || 0;
        const vy = c.vy || 0;
        if (Math.hypot(vx, vy) > 4) {
            w.heading = { x: vx, y: vy };
        }
        w.attackTimer = c.attackTimer;
        w.attackMax = c.attackMax;
        w.attackAngle = c.attackAngle;
        w.attackArt = c.attackTimer > 0 ? (c.attackArt || null) : null;
        if (!wasSwinging && c.isAttacking?.()) {
            this.pushEvent({
                kind: "attack",
                wandererId: w.id,
                uid: w.id,
                x: w.x,
                y: w.y,
                angle: c.attackAngle,
                facing: c.facing || w.facing,
                art: c.attackArt || {
                    unarmed: true,
                    range: 4,
                    max: c.attackMax || 833
                }
            });
        }
    }

    _spawnWandererNear(p, opts = {}) {
        const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
        for (let i = dirs.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            const tmp = dirs[i];
            dirs[i] = dirs[j];
            dirs[j] = tmp;
        }
        let x = 0;
        let y = 0;
        let inward = dirs[0];
        let found = false;
        const dist0 = Party.wandererApproachDist
            ? Party.wandererApproachDist(TS, 40 * TS, 24 * TS)
            : 26 * TS;
        for (const dir of dirs) {
            for (let n = 0; n < 10 && !found; n++) {
                // Past a typical zoom-3 view so they walk in from offscreen.
                const dist = dist0 + n * TS;
                const jitter = (this.rng() - 0.5) * TS * 4;
                const px = p.x + dir.x * dist + (dir.x === 0 ? jitter : 0);
                const py = p.y + dir.y * dist + (dir.y === 0 ? jitter : 0);
                this._interestLoad(px, py, 2);
                if (this.isBlocked(px, py)) continue;
                x = px;
                y = py;
                inward = { x: -dir.x, y: -dir.y };
                found = true;
            }
        }
        if (!found) return false;
        const partyN = (p.party?.length || 0) + 1;
        const pack = Party.wandererPackSize(partyN, () => this.rng());
        const full = Party.isPartyFull(partyN);
        const line = Party.wandererPackOffsets(pack, inward, TS * 1.35);
        let spawned = 0;
        for (const off of line) {
            let sx = x + off.x;
            let sy = y + off.y;
            this._interestLoad(sx, sy, 1);
            if (this.isBlocked(sx, sy)) {
                let placed = false;
                const jogs = [
                    { x: TS, y: 0 }, { x: -TS, y: 0 }, { x: 0, y: TS }, { x: 0, y: -TS },
                    { x: TS, y: TS }, { x: -TS, y: TS }, { x: TS, y: -TS }, { x: -TS, y: -TS }
                ];
                for (const j of jogs) {
                    const jx = x + j.x;
                    const jy = y + j.y;
                    this._interestLoad(jx, jy, 1);
                    if (this.isBlocked(jx, jy)) continue;
                    sx = jx;
                    sy = jy;
                    placed = true;
                    break;
                }
                if (!placed) {
                    sx = x;
                    sy = y;
                    if (this.isBlocked(sx, sy)) continue;
                }
            }
            const inventory = Party.rollWandererInventory(() => this.rng(), { fullParty: full });
            const id = uuid();
            const h = inward;
            this.wanderers.set(id, {
                id,
                name: CavemanNames.generate(() => this.rng()),
                look: Look.randomLook(),
                x: sx,
                y: sy,
                facing: h.x > 0 ? "right" : h.x < 0 ? "left" : h.y > 0 ? "down" : "up",
                heading: h,
                inventory,
                hostile: false,
                recruitLocked: false,
                refusedBy: [],
                _avoidSide: this.rng() < 0.5 ? -1 : 1
            });
            spawned++;
        }
        return spawned;
    }

    _stepWanderer(w, dtMs) {
        const c = this._ensureWandererCreature(w);
        if (!c) return;
        w.heading = this._wandererHeading(w.heading);
        const hlen = Math.hypot(w.heading.x, w.heading.y) || 1;
        const hx = w.heading.x / hlen;
        const hy = w.heading.y / hlen;
        const dest = w._walkDest;
        if (
            !dest
            || !Number.isFinite(dest.x)
            || Math.hypot(w.x - dest.x, w.y - dest.y) < 8 * TS
        ) {
            w._walkDest = { x: w.x + hx * 48 * TS, y: w.y + hy * 48 * TS };
        }
        c.x = w.x;
        c.y = w.y;
        c.facing = w.facing || c.facing;
        c.heading = w.heading;
        c.walkDest = w._walkDest;
        if (!(c.ai instanceof WandererStrollAI)) c.ai = new WandererStrollAI(c);
        const world = this._aiWorld();
        c.refreshCapacities?.();
        const ox = w.x;
        const oy = w.y;
        c.ai.update(dtMs, world);
        c.applyDesiredVel(dtMs);
        let vx = c.vx || 0;
        let vy = c.vy || 0;
        const vlen = Math.hypot(vx, vy);
        const onPath = !!(c.ai?._path && c.ai._path.length);
        if (vlen > 0.5 && !onPath) {
            const sep = this._unstickWandererFromPack(w, vx / vlen, vy / vlen);
            vx = sep.nx * vlen;
            vy = sep.ny * vlen;
            c.vx = vx;
            c.vy = vy;
        }
        const dt = dtMs / 1000;
        const swim = this._terrainSpeedMult(w.x, w.y - 1);
        const nx = w.x + vx * dt * swim;
        const ny = w.y + vy * dt * swim;
        if (!this._partyPoseBlocked(c, nx, c.y)) c.x = nx;
        if (!this._partyPoseBlocked(c, c.x, ny)) c.y = ny;
        w.x = c.x;
        w.y = c.y;
        w.facing = c.facing || w.facing;
        w._moved = Math.hypot(w.x - ox, w.y - oy) > 0.15
            || Math.hypot(c.vx || 0, c.vy || 0) > 2;
        c.x = w.x;
        c.y = w.y;
    }

    /**
     * Same mover as wildlife: hold a heading, axis-slide with `isBlocked`,
     * and only pick a new direction when both axes are stuck.
     * Per-frame skirt/detour was the jitter (tree vs rock ping-pong).
     */
    _moveWanderer(w, speedPx, dtMs) {
        const dt = dtMs / 1000;
        w.heading = this._wandererHeading(w.heading);
        const hlen = Math.hypot(w.heading.x, w.heading.y) || 1;
        let hx = w.heading.x / hlen;
        let hy = w.heading.y / hlen;
        if (w._nudgeMs > 0) {
            w._nudgeMs -= dtMs;
            const nx = Number(w._nudgeVx) || 0;
            const ny = Number(w._nudgeVy) || 0;
            const n = Math.hypot(nx, ny);
            if (n > 0) {
                hx = nx / n;
                hy = ny / n;
            }
        } else {
            const sep = this._unstickWandererFromPack(w, hx, hy);
            hx = sep.nx;
            hy = sep.ny;
        }
        const ox = w.x;
        const oy = w.y;
        const swim = this._terrainSpeedMult(w.x, w.y - 1);
        const nx = w.x + hx * speedPx * dt * swim;
        const ny = w.y + hy * speedPx * dt * swim;
        let movedX = false;
        let movedY = false;
        if (!this.isBlocked(nx, w.y, { swim: true })) {
            w.x = nx;
            movedX = true;
        }
        if (!this.isBlocked(w.x, ny, { swim: true })) {
            w.y = ny;
            movedY = true;
        }
        w._moved = movedX || movedY;
        if (!movedX && !movedY) {
            w._stuckMs = (w._stuckMs || 0) + dtMs;
            if (!(w._nudgeMs > 0) && w._stuckMs > 220) {
                this._wandererUnstick(w);
                w._stuckMs = 0;
            }
        } else {
            w._stuckMs = 0;
        }
        const faceX = movedX ? w.x - ox : hx;
        const faceY = movedY ? w.y - oy : hy;
        if (Math.abs(faceX) >= Math.abs(faceY)) w.facing = faceX >= 0 ? "right" : "left";
        else w.facing = faceY >= 0 ? "down" : "up";
    }

    /** Hold one open 8-way step briefly, same as `_mobUnstick`. */
    _wandererUnstick(w) {
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
            const nx = w.x + (dx / dlen) * step;
            const ny = w.y + (dy / dlen) * step;
            const canX = !this.isBlocked(nx, w.y, { swim: true });
            const canY = !this.isBlocked(w.x, ny, { swim: true });
            if (!canX && !canY) continue;
            w._nudgeVx = dx / dlen;
            w._nudgeVy = dy / dlen;
            w._nudgeMs = 320;
            w._moved = true;
            return;
        }
        for (let r = 8; r <= 48; r += 8) {
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                const x = w.x + Math.cos(a) * r;
                const y = w.y + Math.sin(a) * r;
                if (this.isBlocked(x, y, { swim: true })) continue;
                w.x = x;
                w.y = y;
                w._moved = true;
                w._nudgeMs = 0;
                return;
            }
        }
    }

    _idHash(id) {
        const s = String(id || "");
        let n = 0;
        for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) | 0;
        return ((n >>> 0) / 4294967296) * Math.PI * 2;
    }

    /** Step apart if two passersby occupy the same tile, without dropping the pack heading. */
    _unstickWandererFromPack(w, nx, ny) {
        const want = TS * 0.8;
        let sx = 0;
        let sy = 0;
        for (const other of this.wanderers.values()) {
            if (!other || other === w || other.dead) continue;
            const dx = w.x - other.x;
            const dy = w.y - other.y;
            const d = Math.hypot(dx, dy);
            if (!(d > 0.01)) {
                const h = this._idHash(w.id);
                sx += Math.cos(h);
                sy += Math.sin(h);
                continue;
            }
            if (d >= want) continue;
            const wt = (want - d) / want;
            sx += (dx / d) * wt;
            sy += (dy / d) * wt;
        }
        const sl = Math.hypot(sx, sy);
        if (!(sl > 0.2)) return { nx, ny };
        const sepW = Math.min(0.8, 0.4 + sl * 0.35);
        let wx = nx * (1 - sepW) + (sx / sl) * sepW;
        let wy = ny * (1 - sepW) + (sy / sl) * sepW;
        const n = Math.hypot(wx, wy) || 1;
        wx /= n;
        wy /= n;
        if (this.isBlocked(w.x + wx * 8, w.y + wy * 8, { swim: true })) return { nx, ny };
        return { nx: wx, ny: wy };
    }

    /**
     * Client Thing origin is (0.5, 1): hs×hs body sits on the feet, not
     * centered on (x, y). 1px pad matches Arcade body slop.
     */
    _thingRect(t) {
        if (!t || t.gone) return null;
        const def = thingDefs().get(t.id);
        const pad = 1;
        const fp = typeof Place !== "undefined" ? Place.footprintSize(def) : [1, 1];
        if (
            (fp[0] > 1 || fp[1] > 1)
            && typeof Place !== "undefined"
            && Place.collisionWorldRect
        ) {
            const rect = Place.collisionWorldRect(t, def, TS);
            if (rect) {
                return {
                    t,
                    left: rect.left - pad,
                    right: rect.right + pad,
                    top: rect.top - pad,
                    bottom: rect.bottom + pad,
                    r: Math.max(rect.right - rect.left, rect.bottom - rect.top) * 0.5 + pad
                };
            }
        }
        const hs = Number(def?.hitboxSize);
        if (!(hs > 0)) return null;
        const hx = hs * 0.5;
        return {
            t,
            left: t.x - hx - pad,
            right: t.x + hx + pad,
            top: t.y - hs - pad,
            bottom: t.y + pad,
            r: hx + pad
        };
    }

    _tileBlocked(wx, wy, opts = {}) {
        const { cx, cy } = worldToChunk(wx, wy);
        const c = this._ensureChunk(cx, cy);
        const lx = Math.floor((wx - cx * CHUNK_PX) / TS);
        const ly = Math.floor((wy - cy * CHUNK_PX) / TS);
        if (lx < 0 || ly < 0 || lx >= CS || ly >= CS) return true;
        const tile = c.tiles[lx + ly * CS];
        if (!tile || !BLOCKED.has(tile)) return false;
        if (opts.swim && (tile === "water" || tile === "ice")) return false;
        return true;
    }

    /** Move speed scale for standing in water (ice is not slowed). */
    _terrainSpeedMult(wx, wy) {
        const { cx, cy } = worldToChunk(wx, wy);
        const c = this.chunks.get(chunkKey(cx, cy));
        if (!c) return 1;
        const lx = Math.floor((wx - cx * CHUNK_PX) / TS);
        const ly = Math.floor((wy - cy * CHUNK_PX) / TS);
        if (lx < 0 || ly < 0 || lx >= CS || ly >= CS) return 1;
        return c.tiles[lx + ly * CS] === "water" ? 0.5 : 1;
    }

    _creatureBodyAt(creature, x, y) {
        const hs = Number(creature?.hitboxSize) || 8;
        const w = Number(creature?.width) || 16;
        const h = Number(creature?.height) || 16;
        const left = x + (w - hs) * 0.5;
        const top = y - h + hs;
        return { left, right: left + hs, top, bottom: top + hs };
    }

    _thingRectsNear(wx, wy, radius = 64) {
        const r = Number(radius) || 64;
        const { cx, cy } = worldToChunk(wx, wy);
        const chunkR = Math.max(1, Math.ceil(r / CHUNK_PX));
        const out = [];
        for (let dx = -chunkR; dx <= chunkR; dx++) {
            for (let dy = -chunkR; dy <= chunkR; dy++) {
                const c = this.chunks.get(chunkKey(cx + dx, cy + dy));
                if (!c) continue;
                for (const list of [c.things, c.lootableThings]) {
                    for (const t of list || []) {
                        const rect = this._thingRect(t);
                        if (!rect) continue;
                        const tcx = (rect.left + rect.right) * 0.5;
                        const tcy = (rect.top + rect.bottom) * 0.5;
                        if (Math.abs(tcx - wx) > r || Math.abs(tcy - wy) > r) continue;
                        out.push(rect);
                    }
                }
            }
        }
        return out;
    }

    _aabbHitsThing(left, right, top, bottom, nearX, nearY, cull = 64, creature = null) {
        const rects = this._thingRectsNear(nearX, nearY, cull);
        for (let i = 0; i < rects.length; i++) {
            const tb = rects[i];
            if (creature && Sleep.ignoresThingCollision?.(creature, tb.t)) continue;
            if (right > tb.left && left < tb.right && bottom > tb.top && top < tb.bottom) {
                return tb;
            }
        }
        return null;
    }

    _partyPoseBlocked(creature, x, y, pad = 0) {
        if (this._tileBlocked(x, y, { swim: Party.traversesWater?.(creature) })) return true;
        const body = this._creatureBodyAt(creature, x, y);
        const p = Math.max(0, Number(pad) || 0);
        return !!this._aabbHitsThing(
            body.left - p, body.right + p, body.top - p, body.bottom + p, x, y, 64, creature
        );
    }

    _solidThingAt(wx, wy) {
        const rects = this._thingRectsNear(wx, wy, 48);
        let best = null;
        let bestD = Infinity;
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            if (wx <= rect.left || wx >= rect.right || wy <= rect.top || wy >= rect.bottom) {
                continue;
            }
            const tcx = (rect.left + rect.right) * 0.5;
            const tcy = (rect.top + rect.bottom) * 0.5;
            const d = Math.hypot(tcx - wx, tcy - wy);
            if (d < bestD) {
                bestD = d;
                best = rect;
            }
        }
        return best;
    }

    _solidThingOverlapping(entity) {
        if (!entity) return null;
        const x = Number(entity.x) || 0;
        const y = Number(entity.y) || 0;
        const creature = entity.creature && entity.creature.width
            ? entity.creature
            : (entity.width ? entity : null);
        if (creature) {
            const body = this._creatureBodyAt(creature, x, y);
            return this._aabbHitsThing(body.left, body.right, body.top, body.bottom, x, y);
        }
        return this._solidThingAt(x, y);
    }

    _escapeOverlappingThing(w) {
        const hit = this._solidThingOverlapping(w) || this._solidThingAt(w.x, w.y);
        if (!hit) {
            w._escapeThingKey = null;
            return false;
        }
        const t = hit.t;
        const key = t.uid || `${t.id}:${t.x}:${t.y}`;
        const exits = [
            { d: w.x - hit.left, h: { x: -1, y: 0 } },
            { d: hit.right - w.x, h: { x: 1, y: 0 } },
            { d: w.y - hit.top, h: { x: 0, y: -1 } },
            { d: hit.bottom - w.y, h: { x: 0, y: 1 } }
        ];
        exits.sort((a, b) => {
            const hx = Number(w.heading?.x) || 0;
            const hy = Number(w.heading?.y) || 0;
            const da = a.h.x * hx + a.h.y * hy;
            const db = b.h.x * hx + b.h.y * hy;
            if (db !== da) return db - da;
            return a.d - b.d;
        });
        if (w._escapeThingKey === key && w._escapeH) {
            const keep = exits.find((e) => e.h.x === w._escapeH.nx && e.h.y === w._escapeH.ny);
            if (keep) return true;
        }
        w._escapeThingKey = key;
        w._escapeH = { nx: exits[0].h.x, ny: exits[0].h.y };
        return true;
    }

    _finishWandererDeath(w, killer) {
        if (!w || w.dead) return;
        w.dead = true;
        const creature = w.creature || this.creatures.get(w.id);
        const loot = [];
        for (const s of w.inventory || []) {
            if (s) loot.push(this._cloneStackForWorld(s));
        }
        this._pushCorpse({
            x: w.x,
            y: w.y - 8,
            key: "human",
            look: w.look || null,
            frame: 7,
            name: w.name || "Wanderer",
            loot: loot.filter(Boolean),
            body: w.body || creature?.anatomy?.toJSON?.() || null,
            bodyPlan: "human",
            mobId: "human",
            playerCorpse: false
        });
        this.wanderers.delete(w.id);
        this.creatures.delete(w.id);
        if (creature) {
            creature._dead = true;
            creature.active = false;
        }
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
            overflow: Array.isArray(saved.overflow) ? saved.overflow : [],
            equipment: saved.equipment || { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
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
        this._vacatePawn(p);
        for (const m of p.party || []) this._vacatePawn(m);
        this._sanitizeSleepOccupants();
        this._applyRestClock();
        this._saveLogoutPose(p);
        const finalYou = this.youPayload(playerId);
        this._clearPlayerCampfireAttend(playerId);
        this._clearPvpOwner(p.id);
        this.players.delete(playerId);
        this.creatures.delete(playerId);
        for (const m of p.party || []) {
            this.creatures.delete(m.id);
        }
        if (p.creature) p.creature = null;
        this.pushEvent({ kind: "chat", text: `${p.name} left`, system: true });
        // Persist pose immediately so rejoin works before the next autosave.
        try {
            this.saveAll();
        } catch (e) {
            console.warn("[world] logout pose save failed", e);
        }
        return finalYou;
    }

    _cancelChannels(p) {
        if (!p) return;
        const wasEating = !!p.eatChannel;
        p.eatChannel = null;
        p._workChannel = null;
        p.attackTimer = 0;
        p.attackArt = null;
        if (wasEating) {
            const session = this._sessionOfPawn(p);
            this.pushEvent({
                kind: "channel",
                playerId: session?.id || p.id,
                pawnId: p.id,
                channel: "eat",
                progress: 0,
                done: true,
                cancelled: true
            });
            this._dirtyPawnOwner(p);
        }
    }

    _isVomiting(p) {
        return Number(p?.vomitRemainingMs) > 0;
    }

    _clearVomit(p) {
        if (!p) return;
        p.vomitRemainingMs = 0;
        p.vomitDripAccMs = 0;
        const creature = p.creature || this.creatures.get(p.id);
        if (creature) {
            creature._vomitRemainingMs = 0;
            creature._vomitDripAccMs = 0;
        }
    }

    _starvePlayer(p, kc) {
        if (!p) return;
        const lose = Math.max(0, Number(kc) || 0);
        if (!(lose > 0)) return;
        p.saturation = Number(p.saturation) || 0;
        p.kc = Number(p.kc) || 0;
        p.saturation -= lose;
        if (p.saturation < 0) {
            p.kc = Math.max(0, p.kc + p.saturation);
            p.saturation = 0;
        }
    }

    _vomitOrigin(p) {
        const creature = p?.creature || this.creatures.get(p?.id);
        const c = creature?.bodyCenter?.() || { x: p.x, y: p.y };
        const ts = TS;
        let dx = 0;
        let dy = 0;
        if (p.facing === "right") dx = 1;
        else if (p.facing === "left") dx = -1;
        else if (p.facing === "down") dy = 1;
        else dy = -1;
        const dist = ts * 0.4;
        return {
            x: c.x + dx * dist,
            y: c.y + dy * dist - (dy === 0 ? ts * 0.15 : 0),
            facing: p.facing || "down"
        };
    }

    _beginPlayerVomit(creature, remainingMs) {
        const pawn = this._findOwnedPawn(creature?.id);
        if (!pawn || pawn.dead) return;
        pawn.eatChannel = null;
        pawn.pendingAttackAngle = null;
        pawn.vomitRemainingMs = Math.max(1, Number(remainingMs) || 8000);
        pawn.vomitDripAccMs = 0;
        const session = this._sessionOfPawn(pawn);
        if (session && pawn === session) {
            session.moveX = 0;
            session.moveY = 0;
            session.sprint = false;
        }
        this._vomitDrip(pawn, { start: true });
        this._dirtyPawnOwner(pawn);
    }

    _vomitDrip(p, opts = {}) {
        this._starvePlayer(p, 0.04 * (Number(p.stomach) || 1600));
        const origin = this._vomitOrigin(p);
        this.pushEvent({
            kind: "vomit",
            playerId: this._sessionOfPawn(p)?.id || p.id,
            pawnId: p.id,
            x: origin.x,
            y: origin.y,
            facing: origin.facing,
            remainingMs: Math.max(0, Number(p.vomitRemainingMs) || 0),
            drip: !opts.start
        });
        this._dirtyPawnOwner(p);
    }

    _tickPlayerVomit(p, dtMs) {
        if (!this._isVomiting(p)) return;
        p.vomitRemainingMs -= dtMs;
        p.vomitDripAccMs = (Number(p.vomitDripAccMs) || 0) + dtMs;
        while (p.vomitDripAccMs >= 2500) {
            p.vomitDripAccMs -= 2500;
            if (p.vomitRemainingMs > 0) this._vomitDrip(p);
        }
        if (!(p.vomitRemainingMs > 0)) {
            this._clearVomit(p);
            this._youDirty.add(p.id);
        }
    }

    pushEvent(ev) {
        this._events.push(ev);
    }

    /**
     * Hitting wildlife / passersby so party AI chases fleeing prey, not only
     * hostiles already in the duel pool.
     */
    _noteHuntHit(attacker, victim) {
        if (!attacker || !victim || attacker === victim) return;
        if (victim.kind !== "mob" && victim.role !== "wanderer") return;
        if (Party.sameFaction?.(attacker, victim)) return;
        const session = this.players.get(attacker.ownerId)
            || this._sessionOfPawn(attacker)
            || this.players.get(attacker.id);
        if (!session) return;
        session.lastHitMob = victim;
        session.lastHitAt = Date.now();
        Party.setWildAggroOwner?.(victim, attacker);
        const rec = this.wanderers.get(victim.id) || this.mobs.get(victim.id);
        if (rec && rec !== victim) Party.setWildAggroOwner?.(rec, attacker);
        this._wakeAbleResters(session, victim, session);
    }

    _chaseTarget(p) {
        const hit = p?.lastHitMob;
        if (!hit) return null;
        if (hit.isBodyDead?.() || hit._dead || hit.dead) {
            p.lastHitMob = null;
            return null;
        }
        if (Date.now() - (Number(p.lastHitAt) || 0) > 8000) {
            p.lastHitMob = null;
            return null;
        }
        return hit;
    }

    /**
     * Hitting another session's pawn (leader or companion) aggroes both parties.
     */
    _notePvpHit(attacker, victim) {
        const aOwner = attacker?.ownerId;
        const vOwner = victim?.ownerId;
        if (!aOwner || !vOwner || aOwner === vOwner) return;
        if (!this.players.has(aOwner) || !this.players.has(vOwner)) return;
        const aP = this.players.get(aOwner);
        const vP = this.players.get(vOwner);
        if (aP?.dead || vP?.dead) return;
        const ev = {
            kind: "pvp_hit",
            attackerOwnerId: aOwner,
            attackerId: attacker.id,
            victimOwnerId: vOwner,
            victimId: victim.id
        };
        this.pushEvent({ ...ev, to: aOwner });
        this.pushEvent({ ...ev, to: vOwner });
        if (aP) {
            if (!aP.pvpAggro) aP.pvpAggro = new Set();
            aP.pvpAggro.add(vOwner);
        }
        if (vP) {
            if (!vP.pvpAggro) vP.pvpAggro = new Set();
            vP.pvpAggro.add(aOwner);
        }
    }

    /** Drop PvP flags for this owner on every session so death/logout ends the scrap. */
    _clearPvpOwner(ownerId) {
        if (!ownerId) return;
        const self = this.players.get(ownerId);
        if (self?.pvpAggro) self.pvpAggro.clear();
        if (self) self.lastHitMob = null;
        for (const other of this.players.values()) {
            if (other === self) continue;
            if (other.pvpAggro) other.pvpAggro.delete(ownerId);
            const hit = other.lastHitMob;
            if (hit && (hit.ownerId === ownerId || hit.id === ownerId)) {
                other.lastHitMob = null;
            }
        }
        this.pushEvent({ kind: "pvp_clear", ownerId });
    }

    /**
     * Player parties only fight each other after a PvP hit.
     * Wildlife / wanderers only auto-duel the party that pulled them — a
     * neighboring tribe does not pile into someone else's hunt.
     */
    _playerCanFight(a, b) {
        if (a?.role === "wanderer" && b?.role === "wanderer") return false;
        const oa = Party.ownerIdOf(a);
        const ob = Party.ownerIdOf(b);
        const aSess = !!(oa && this.players.has(oa));
        const bSess = !!(ob && this.players.has(ob));
        if (aSess && bSess) {
            if (oa === ob) return false;
            const pa = this.players.get(oa);
            const pb = this.players.get(ob);
            if (pa?.dead || pb?.dead) return false;
            return !!(pa?.pvpAggro?.has(ob) || pb?.pvpAggro?.has(oa));
        }
        if (aSess && !bSess) return this._ownerEngagedWithWild(oa, b);
        if (bSess && !aSess) return this._ownerEngagedWithWild(ob, a);
        return true;
    }

    _ownerEngagedWithWild(ownerId, wild) {
        const p = this.players.get(ownerId);
        if (!p || p.dead) return false;
        return !!Party.ownerEngagedWithWild?.(ownerId, wild, { lastHitMob: p.lastHitMob });
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

    /** World chat line every connected player sees (join, death, settlement news). */
    _announceWorld(text) {
        const msg = String(text || "");
        if (!msg) return;
        this.pushEvent({ kind: "chat", text: msg, system: true });
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

    setMove(playerId, { x = 0, y = 0, sprint = false, facing = null, px = null, py = null, viewChunks = null, pawnId = null, partyPoses = null } = {}) {
        const p = this.players.get(playerId);
        if (!p) return;
        if (pawnId === p.id || (p.party || []).some((m) => m.id === pawnId && !m.dead)) {
            p.controlId = pawnId;
        }
        const control = this._actionPawn(p, { pawnId: p.controlId });
        if (!control || control.dead) return;
        const leaderLocked = !!p.dead && control !== p;
        if (this._pawnVomiting(control)) {
            p.moveX = 0;
            p.moveY = 0;
            p.sprint = false;
        } else if (!leaderLocked) {
            const len = Math.hypot(x, y);
            if (!(len > 0)) {
                p.moveX = 0;
                p.moveY = 0;
            } else {
                p.moveX = x / len;
                p.moveY = y / len;
            }
            p.sprint = !!sprint && (Number(control.kc) > 0);
        }
        if (facing) control.facing = facing;
        const cc = control.creature || this.creatures.get(control.id);
        let justWoke = false;
        if (
            control._resting
            && Math.hypot(x, y) > 0.01
            && !control.dead
            && !cc?.isImmobile?.()
            && !cc?.isIncapacitated?.()
            && !this._pawnVomiting(control)
        ) {
            this._wakePawn(p, control, { manual: true });
            justWoke = true;
        }
        const poseLocked = !!(
            control.dead
            || control._resting
            || control.prone
            || cc?._prone
            || cc?.isImmobile?.()
            || cc?.isIncapacitated?.()
            || this._pawnVomiting(control)
        );
        if (!poseLocked && control._restWalk && (Math.hypot(x, y) > 0.01)) {
            control._restWalk = null;
            if (cc) cc._restWalk = null;
            this._sleepLog(p, `${control.name || "They"} can't rest there`);
        }
        if (poseLocked || justWoke) {
            p.moveX = 0;
            p.moveY = 0;
            p.sprint = false;
        }
        if (Number.isFinite(px) && Number.isFinite(py) && !poseLocked && !justWoke) {
            const jump = Math.hypot(px - control.x, py - control.y);
            const joinGrace = !!(p._joinGraceUntil && Date.now() < p._joinGraceUntil);
            // Relog used to send spawn (0,0) before YOU applied; that teleported
            // the pawn and cull deleted nearby passersby.
            if (joinGrace && !p.poseAuth && jump > 8 * TS) {
                // keep server logout pose
            } else {
                control.x = px;
                control.y = py;
                if (control === p) p.poseAuth = true;
                if (cc) {
                    cc.x = control.x;
                    cc.y = control.y;
                    cc.facing = control.facing || cc.facing;
                }
            }
        } else if (cc) {
            cc.facing = control.facing || cc.facing;
        }
        // Uncontrolled party poses are server-authored (PartyAI). Ignore client
        // copies so other players see the same hitboxes the sim uses — except a
        // tend lock so they finish bandaging before follow pulls them.
        const tendLock = new Set();
        if (Array.isArray(partyPoses)) {
            for (const pose of partyPoses) {
                if (pose?.id && pose.tending) tendLock.add(pose.id);
            }
        }
        for (const m of p.party || []) {
            if (!m) continue;
            m.tending = tendLock.has(m.id);
            const cc = m.creature || this.creatures.get(m.id);
            if (cc) cc._tending = !!m.tending;
        }
        if (p.creature) p.creature._tending = false;
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
                this._runCommand(p, text, action);
                return;
            }
            this.pushEvent({ kind: "chat", text: `<${p.name}> ${text}`, from: p.id });
            return;
        }
        if (type === Protocol.Actions.DIE) {
            this._kill(p, null, action);
            return;
        }
        if (p.dead && type === Protocol.Actions.RESPAWN) {
            this.respawn(p);
            return;
        }
        if (p.dead && type !== Protocol.Actions.SWITCH_CONTROL) {
            const actor = this._actionPawn(p, action);
            if (!actor || actor === p || actor.dead) return;
        }
        if (type === Protocol.Actions.CANCEL_CHANNEL) {
            this._cancelChannels(this._actionPawn(p, action));
            return;
        }
        if (type === Protocol.Actions.HOTBAR) {
            const pawn = this._actionPawn(p, action);
            const i = Number(action.index);
            if (pawn && Number.isInteger(i) && i >= 0 && i < (pawn.inventory?.length || 0)) {
                if (pawn.eatChannel && pawn.eatChannel.itemIndex !== i) {
                    pawn.eatChannel = null;
                    this.pushEvent({
                        kind: "channel",
                        playerId: p.id,
                        pawnId: pawn.id,
                        channel: "eat",
                        progress: 0,
                        done: true,
                        cancelled: true
                    });
                }
                pawn.hotbarIndex = i;
                if (pawn.creature) pawn.creature.hotbarIndex = i;
            }
            this._youDirty.add(p.id);
            return;
        }
        if (type === Protocol.Actions.SWITCH_CONTROL) {
            const id = action.pawnId;
            if (id === p.id || (p.party || []).some((m) => m.id === id)) {
                p.controlId = id;
                this._youDirty.add(p.id);
            }
            return;
        }
        if (type === Protocol.Actions.RECRUIT) {
            this._handleRecruit(p, action);
            return;
        }
        if (type === Protocol.Actions.GIVE_ITEM) {
            this._handleGiveItem(p, action);
            return;
        }
        if (type === Protocol.Actions.PARTY_EAT) {
            this._handlePartyEat(p, action);
            return;
        }
        if (type === Protocol.Actions.FEED) {
            this._handleFeed(p, action);
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
            this._tryPickup(p, action);
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
        if (type === Protocol.Actions.RACK_FLESH) {
            this._tryRackFlesh(p, action);
            return;
        }
        if (type === Protocol.Actions.RACK_BRAIN) {
            this._tryRackBrain(p, action);
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
            this._tryUse(p, action);
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
        if (type === Protocol.Actions.PLACE) {
            this._tryPlace(p, action);
            return;
        }
        if (type === Protocol.Actions.SETTLEMENT) {
            this._handleSettlement(p, action);
            return;
        }
        if (type === Protocol.Actions.SLEEP) {
            this._trySleep(p, action);
            return;
        }
        if (type === Protocol.Actions.STORAGE) {
            this._tryStorage(p, action);
            return;
        }
        if (type === Protocol.Actions.CRAFT) {
            this._tryCraft(p, action);
            return;
        }
        if (type === Protocol.Actions.ATTACK) {
            this._tryAttack(p, Number(action.angle) || 0, action.pawnId);
            return;
        }
        if (type === Protocol.Actions.COMMAND) {
            this._runCommand(p, String(action.text || ""), action);
        }
    }

    _runCommand(p, text, action = {}) {
        const parts = text.trim().split(/\s+/);
        const cmd = (parts[0] || "").toLowerCase();
        if (cmd === "/heal" || cmd === "/h") {
            const pawn = this._actionPawn(p, action) || p;
            pawn.hp = pawn.mhp;
            pawn.dead = false;
            pawn.kc = pawn.stomach;
            this._resetPawnAnatomy(p, pawn);
            this._youDirty.add(p.id);
            return;
        }
        if (cmd === "/party") {
            if ((p.party || []).length + 1 >= Party.CAP) {
                this.announceCmd("Party is full", { to: p.id });
                return;
            }
            const rec = this._companionFromSnap(p, {
                name: CavemanNames.generate(() => this.rng()),
                look: Look.randomLook(),
                x: p.x + 16,
                y: p.y,
                kc: Party.rollRoughKc(() => this.rng())
            });
            if (!p.party) p.party = [];
            p.party.push(rec);
            this._youDirty.add(p.id);
            this.announceCmd(`${rec.name} joins you`, { to: p.id });
            return;
        }
        if (cmd === "/wanderer") {
            const n = this._spawnWandererNear(p) || 0;
            if (n > 0) {
                this._directorCd = Party.directorCooldown((p.party?.length || 0) + 1, () => this.rng());
            }
            this.announceCmd(
                n > 1
                    ? `${n} wanderers approach`
                    : n === 1
                        ? "A wanderer approaches"
                        : "No room to spawn a wanderer",
                { to: p.id }
            );
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
            const pawn = this._actionPawn(p) || p;
            const left = this._give(pawn, meta.id, qty, extras);
            if (left > 0) {
                this._pushDrop(pawn.x, pawn.y, { id: meta.id, quantity: left });
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
            this.announceCmd(`${p.name} used /kill`, { except: p.id });
            return;
        }
        if (cmd === "/regen") {
            const now = Date.now();
            const armed = this._regenArmed?.get(p.id) || 0;
            if (!(armed > 0) || now - armed > 10000) {
                if (!this._regenArmed) this._regenArmed = new Map();
                this._regenArmed.set(p.id, now);
                this.announceCmd(
                    "Type /regen again within 10 seconds to regenerate the world.",
                    { to: p.id }
                );
                return;
            }
            this._regenArmed.delete(p.id);
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
            this.baseTickSpeed = m;
            this._minuteAcc = 0;
            this._applyRestClock();
            this.announceCmd(`${p.name} set tick speed to ${this.tickSpeed}×`);
            return;
        }
        if (cmd === "/time") {
            if (parts.length < 2) {
                const h = Math.floor(this.gameMinutes / 60);
                const m = this.gameMinutes % 60;
                this.announceCmd(
                    `Day ${this.gameDay}  ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
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
        if (cmd === "/set") {
            const usage = "Usage: /set <thing>|null";
            const rawId = parts.slice(1).join(" ").trim();
            if (!rawId) {
                this.announceCmd(usage, { to: p.id });
                return;
            }
            const needle = rawId.toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
            const { tx, ty } = this._playerTile(p);
            if (needle === "null" || needle === "none" || needle === "clear") {
                this._setThingOnTile(tx, ty, null);
                this.announceCmd("Cleared thing", { to: p.id });
                return;
            }
            const def = thingDefs().get(needle)
                || [...thingDefs().values()].find((t) =>
                    (t.name || "").toLowerCase().replace(/\s+/g, "_") === needle
                    || (t.name || "").toLowerCase() === rawId.toLowerCase().replace(/_/g, " ")
                );
            if (!def?.id) {
                this.announceCmd(`Unknown thing "${rawId}".`, { to: p.id });
                return;
            }
            const made = this._makeThingEntry(def, tx, ty);
            if (!made?.entry) {
                this.announceCmd(`Failed to set ${def.name || def.id}.`, { to: p.id });
                return;
            }
            this._setThingOnTile(tx, ty, made.entry, { lootable: made.lootable });
            this.announceCmd(`Set ${def.name || def.id}`, { to: p.id });
            return;
        }
        this.announceCmd(`Unknown command: ${cmd}`, { to: p.id });
    }

    _playerTile(p) {
        return {
            tx: Math.floor((Number(p.x) + TS / 2) / TS),
            ty: Math.floor(Number(p.y) / TS)
        };
    }

    _makeThingEntry(def, tx, ty) {
        if (!def?.id) return null;
        const { x, y } = this._tileCenter(tx, ty);
        if (def.lootable) {
            return {
                lootable: true,
                entry: {
                    x, y,
                    id: def.id,
                    uid: `lt_${Math.round(x)}_${Math.round(y)}_${def.id}`
                }
            };
        }
        if (def.campfire) {
            return {
                lootable: false,
                entry: {
                    id: def.id,
                    x, y,
                    uid: `cf_${Math.round(x)}_${Math.round(y)}`,
                    fuel: [null, null],
                    cook: null,
                    catalyst: null,
                    simmer: [null, null, null, null],
                    cookProgress: 0,
                    burnRemaining: 0
                }
            };
        }
        if (def.storage) {
            const entry = {
                id: def.id,
                x, y,
                rot: 0,
                slots: Place.emptySlots(def.storage.slots || 6)
            };
            Place.ensureStorageEntry(entry, def);
            return { lootable: false, entry };
        }
        return { lootable: false, entry: { id: def.id, x, y } };
    }

    _clearTileThings(tx, ty) {
        const { x, y } = this._tileCenter(tx, ty);
        const { cx, cy } = worldToChunk(x, y - 1);
        const chunk = this._ensureChunk(cx, cy);
        const onTile = (entry) => {
            if (!entry) return false;
            const etx = Math.floor(Number(entry.x) / TS);
            const ety = Math.floor((Number(entry.y) - 1) / TS);
            return etx === tx && ety === ty;
        };
        if (Array.isArray(chunk.things)) {
            chunk.things = chunk.things.filter((t) => !onTile(t));
        }
        if (Array.isArray(chunk.lootableThings)) {
            chunk.lootableThings = chunk.lootableThings.filter((t) => !onTile(t));
        }
        return chunk;
    }

    _setThingOnTile(tx, ty, entry, opts = {}) {
        const chunk = this._clearTileThings(tx, ty);
        const lootable = !!opts.lootable;
        if (entry?.id) {
            if (lootable) {
                if (!Array.isArray(chunk.lootableThings)) chunk.lootableThings = [];
                chunk.lootableThings.push(entry);
            } else {
                if (!Array.isArray(chunk.things)) chunk.things = [];
                chunk.things.push(entry);
            }
        }
        this.pushEvent({
            kind: "thing_set",
            tx, ty,
            cx: chunk.cx,
            cy: chunk.cy,
            lootable,
            entry: entry?.id ? entry : null
        });
        return chunk;
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
        this._ensureEquipment(p);
        const incomingUnique = this._stackIsSpecial(extras);
        const extraFields = this._giveExtras(extras);
        const getDef = (id) => itemDefs().get(id);
        const unitW = Carry.unitWeight({ id: itemId, ...(extraFields || {}) }, meta);
        const cap = Carry.carryCap(Carry.strengthFromEquip(p.equipment, getDef));
        const fitNow = () => Carry.countFit(
            remaining,
            unitW,
            Carry.gearMass(p.inventory, p.equipment, getDef, p.overflow),
            cap
        );
        if (fitNow() <= 0 && unitW > 0) return remaining;
        for (let i = 0; i < p.inventory.length && remaining > 0; i++) {
            const s = p.inventory[i];
            if (!s || s.id !== itemId || this._stackIsSpecial(s) || incomingUnique) continue;
            const space = Math.max(0, maxStack - (s.quantity || 1));
            if (space <= 0) continue;
            const add = Math.min(space, remaining, fitNow());
            if (!(add > 0)) break;
            if (incomingLeft != null) {
                s.spoilLeft = Spoil.mergeSpoilLeft(
                    s.quantity || 1, s.spoilLeft,
                    add, incomingLeft
                );
                delete s.spoilAt;
            }
            Hide.applyMergedDryProgress(s, s.quantity || 1, add, extraFields?.dryProgress);
            Hide.applyMergedSoakProgress(s, s.quantity || 1, add, extraFields?.soakProgress);
            Fire.applyMergedStackTemp(s, s.quantity || 1, add, extraFields?.temp);
            s.quantity = (s.quantity || 1) + add;
            remaining -= add;
        }
        for (let i = 0; i < p.inventory.length && remaining > 0; i++) {
            if (p.inventory[i]) continue;
            const add = Math.min(maxStack, remaining, fitNow());
            if (!(add > 0)) break;
            const slot = { id: itemId, quantity: add };
            this._applyStackExtras(slot, extraFields);
            if (incomingLeft != null) slot.spoilLeft = incomingLeft;
            p.inventory[i] = slot;
            remaining -= add;
        }
        this._syncOverflowSize(p);
        const over = p.overflow || [];
        for (let i = 0; i < over.length && remaining > 0; i++) {
            const s = over[i];
            if (!s || s.id !== itemId || this._stackIsSpecial(s) || incomingUnique) continue;
            const space = Math.max(0, maxStack - (s.quantity || 1));
            if (space <= 0) continue;
            const add = Math.min(space, remaining, fitNow());
            if (!(add > 0)) break;
            if (incomingLeft != null) {
                s.spoilLeft = Spoil.mergeSpoilLeft(
                    s.quantity || 1, s.spoilLeft,
                    add, incomingLeft
                );
                delete s.spoilAt;
            }
            Hide.applyMergedDryProgress(s, s.quantity || 1, add, extraFields?.dryProgress);
            Hide.applyMergedSoakProgress(s, s.quantity || 1, add, extraFields?.soakProgress);
            Fire.applyMergedStackTemp(s, s.quantity || 1, add, extraFields?.temp);
            s.quantity = (s.quantity || 1) + add;
            remaining -= add;
        }
        for (let i = 0; i < over.length && remaining > 0; i++) {
            if (over[i]) continue;
            const add = Math.min(maxStack, remaining, fitNow());
            if (!(add > 0)) break;
            const slot = { id: itemId, quantity: add };
            this._applyStackExtras(slot, extraFields);
            if (incomingLeft != null) slot.spoilLeft = incomingLeft;
            over[i] = slot;
            remaining -= add;
        }
        this._enforceCarryCap(p);
        if (remaining < tookStart) this._dirtyPawnOwner(p);
        return remaining;
    }

    /** Strip world-drop fields (uid, lifeMs, Arcade weight) so they can't zero item mass. */
    _giveExtras(extras) {
        if (!extras || typeof extras !== "object") return null;
        if (extras.uid || extras.lifeMs != null || extras.x != null || extras.y != null) {
            return this._stackExtrasFrom(extras);
        }
        return this._stackExtrasFrom(extras) || extras;
    }

    /**
     * Peel inventory until mass ≤ cap.
     * @param {{ drop?: boolean }} [opts] drop=false returns peeled qty (caller drops).
     * @returns {number} units removed
     */
    _enforceCarryCap(p, opts = {}) {
        if (!p || !Array.isArray(p.inventory)) return 0;
        const drop = opts.drop !== false;
        const getDef = (id) => itemDefs().get(id);
        const cap = Carry.carryCap(Carry.strengthFromEquip(p.equipment, getDef));
        const mass = () => Carry.gearMass(p.inventory, p.equipment, getDef, p.overflow);
        let dumped = 0;
        while (mass() > cap + 1e-6) {
            let idx = -1;
            for (let i = p.inventory.length - 1; i >= 0; i--) {
                const s = p.inventory[i];
                if (!s?.id) continue;
                if (Carry.unitWeight(s, getDef(s.id)) > 0) {
                    idx = i;
                    break;
                }
            }
            if (idx < 0) break;
            const s = p.inventory[idx];
            const qty = Math.max(1, Math.floor(Number(s.quantity) || 1));
            if (drop) {
                const piece = this._cloneStackForWorld({ ...s, quantity: 1 });
                if (piece) this._pushDrop(p.x, p.y, piece);
            }
            s.quantity = qty - 1;
            if (!(s.quantity > 0)) p.inventory[idx] = null;
            dumped += 1;
            this._youDirty.add(p.id);
        }
        return dumped;
    }

    _parseRecipe(itemId) {
        const meta = itemDefs().get(itemId);
        if (!meta?.recipe || typeof meta.recipe !== "object") return null;
        const ingredients = [];
        let requireThing = null;
        let requireStation = null;
        let requireTool = null;
        let craftSeconds = 0;
        let quantity = 1;
        for (const [k, v] of Object.entries(meta.recipe)) {
            if (k === "QUANTITY") quantity = Math.max(1, Math.floor(Number(v) || 1));
            else if (k === "REQUIRE_THING") requireThing = String(v || "") || null;
            else if (k === "REQUIRE_STATION") requireStation = String(v || "") || null;
            else if (k === "CRAFT_SECONDS") craftSeconds = Math.max(0, Number(v) || 0);
            else if (k === "REQUIRE_TOOL") {
                requireTool = {
                    toolClass: v?.toolClass ? String(v.toolClass) : null,
                    wear: Math.max(0, Number(v?.wear) || 0)
                };
            } else if (typeof Carry !== "undefined" && Carry.isRecipeMetaKey && Carry.isRecipeMetaKey(k)) {
                continue;
            } else if (v && typeof v === "object") {
                ingredients.push({
                    id: k,
                    qty: Math.max(1, Math.floor(Number(v.qty) || 1)),
                    toolClass: v.toolClass ? String(v.toolClass) : null,
                    hideStage: v.hideStage ? String(v.hideStage) : null
                });
            } else {
                ingredients.push({
                    id: k,
                    qty: Math.max(1, Math.floor(Number(v) || 1)),
                    toolClass: null,
                    hideStage: null
                });
            }
        }
        if (!ingredients.length) return null;
        return {
            id: meta.id,
            ingredients,
            quantity,
            requireThing,
            requireStation,
            requireTool,
            craftSeconds
        };
    }

    _stackMatchesCraft(s, match) {
        if (!s || !match) return false;
        if (match.hideStage) {
            return Hide.stackIsHideStage(s, match.hideStage, (id) => itemDefs().get(id));
        }
        if (!s.id || s.id !== match.id) return false;
        if (match.toolClass && s.toolClass !== match.toolClass) return false;
        return true;
    }

    _countMatchingItems(p, match) {
        const hideStage = match?.hideStage || null;
        const id = match?.id;
        const wantClass = match?.toolClass || null;
        if ((!hideStage && !id) || !Array.isArray(p?.inventory)) return 0;
        let sum = 0;
        for (const s of p.inventory) {
            if (!this._stackMatchesCraft(s, hideStage ? { hideStage } : { id, toolClass: wantClass })) continue;
            sum += Math.max(0, Math.floor(Number(s.quantity) || 0));
        }
        return sum;
    }

    _loseMatchingItems(p, match) {
        let remaining = Math.max(0, Math.floor(Number(match?.qty) || 1));
        const hideStage = match?.hideStage || null;
        const id = match?.id;
        const wantClass = match?.toolClass || null;
        if ((!hideStage && !id) || !(remaining > 0) || !Array.isArray(p?.inventory)) {
            return { lost: 0, knapQuality: null };
        }
        let lost = 0;
        let knapQuality = null;
        const takeFrom = (requireClass) => {
            for (let i = 0; i < p.inventory.length && remaining > 0; i++) {
                const s = p.inventory[i];
                if (!this._stackMatchesCraft(s, hideStage ? { hideStage } : { id })) continue;
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
        if (hideStage) takeFrom(null);
        else if (wantClass) takeFrom(wantClass);
        else takeFrom(null);
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

    _tryCraft(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const id = String(action.id || "").slice(0, 64);
        const recipe = this._parseRecipe(id);
        if (!recipe) return;
        for (const ing of recipe.ingredients) {
            if (this._countMatchingItems(p, ing) < ing.qty) return;
        }
        if (recipe.requireThing && !this._hasNearbyThing(p, recipe.requireThing)) return;
        if (recipe.requireStation && !this._hasNearbyThing(p, recipe.requireStation)) return;
        if (recipe.requireTool?.toolClass) {
            const held = this._held(p);
            const def = held ? itemDefs().get(held.id) : null;
            if (Carry.stackToolClass(held, def) !== recipe.requireTool.toolClass) return;
        }

        let tipQuality = null;
        for (const ing of recipe.ingredients) {
            const { knapQuality } = this._loseMatchingItems(p, ing);
            if (ing.toolClass === "spear_tip" && knapQuality) tipQuality = knapQuality;
        }

        this._consumeCraftTool(p, recipe);

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
        this._dirtyPawnOwner(p);
    }

    _held(p) {
        if (!p?.inventory) return null;
        return p.inventory[p.hotbarIndex] || null;
    }

    _consumeCraftTool(p, recipe) {
        if (!recipe.requireTool?.toolClass) return;
        const held = this._held(p);
        const def = held ? itemDefs().get(held.id) : null;
        if (Carry.isSingleUseTool(held, def)) {
            const idx = p.hotbarIndex | 0;
            const s = p.inventory[idx];
            if (!s) return;
            const qty = Math.max(0, Math.floor(Number(s.quantity) || 0));
            if (qty <= 1) p.inventory[idx] = null;
            else s.quantity = qty - 1;
            return;
        }
        const wear = Number(recipe.requireTool.wear) || 0;
        if (wear > 0) this._wearHeld(p, wear);
    }

    _wearPlayerHeld(creatureId, amount) {
        const pawn = this._findOwnedPawn(creatureId);
        if (!pawn) return { broke: false };
        return this._wearHeld(pawn, amount);
    }

    _wearHeld(p, amount) {
        if (!p || !Array.isArray(p.inventory)) return { broke: false };
        const result = Durability.wearInventorySlot(
            p.inventory,
            p.hotbarIndex | 0,
            amount,
            (id) => itemDefs().get(id)
        );
        if (result.leftover) this._insertUniqueStack(p, result.leftover);
        if (result.broke) {
            this.pushEvent({
                kind: "combat_log",
                text: Durability.breakMessage(result.name, true),
                to: this._sessionOfPawn(p)?.id || p.id
            });
        }
        this._dirtyPawnOwner(p);
        return result;
    }

    _pickPlayerAttack(creature, angle) {
        if (!creature) return null;
        const held = creature.getHeldItem?.();
        if (Chop.chopFraction(held) > 0) {
            const chop = Chop.pickChopFromAttacks(BodyCombat.collectAttacks(creature));
            if (chop && this._aimHitsChoppable(creature, angle)) return chop;
        }
        return BodyCombat.pickAttack(creature);
    }

    _aimHitsChoppable(creature, angle) {
        if (!creature) return false;
        const c = creature.bodyCenter?.() || { x: creature.x, y: creature.y };
        const seg = Chop.aimSegment(c.x, c.y, angle, Chop.AIM_REACH);
        let hit = false;
        this._eachNearbyChoppable(creature.x, creature.y, (e, def) => {
            if (hit) return;
            const hs = Number(def.hitboxSize) || 5;
            if (Chop.trunkHitsSegment(seg, e.x, e.y, hs, Chop.HIT_RADIUS)) hit = true;
        });
        return hit;
    }

    _eachNearbyChoppable(wx, wy, fn) {
        const range = Chop.AIM_REACH + 16;
        const r2 = range * range;
        for (const c of this._chunksNear(wx, wy, 1)) {
            const lists = [
                { name: "things", arr: c.things },
                { name: "lootable", arr: c.lootableThings }
            ];
            for (const { name, arr } of lists) {
                if (!Array.isArray(arr)) continue;
                for (const e of arr) {
                    if (!e || e.gone || !e.id) continue;
                    const def = thingDefs().get(e.id);
                    if (!Chop.isChoppable(def)) continue;
                    const dx = (Number(e.x) || 0) - wx;
                    const dy = (Number(e.y) || 0) - wy;
                    if (dx * dx + dy * dy > r2) continue;
                    fn(e, def, c, name);
                }
            }
        }
    }

    _tryChopFromMelee(creature, swingSeg) {
        if (!creature || creature.kind !== "player") return;
        if (creature._attackChoppedTree) return;
        if (!Chop.isChopAttack(creature.currentAttack)) return;
        const held = creature.getHeldItem?.();
        const frac = Chop.chopFraction(held);
        if (!(frac > 0)) return;
        const c = creature.bodyCenter?.() || { x: creature.x, y: creature.y };
        const chopSeg = Chop.aimSegment(c.x, c.y, creature.attackAngle, Chop.AIM_REACH);
        let best = null;
        let bestDef = null;
        let bestChunk = null;
        let bestList = null;
        let bestD = Infinity;
        this._eachNearbyChoppable(creature.x, creature.y, (e, def, chunk, listName) => {
            if (creature.attackHitSet?.has(e)) return;
            const hs = Number(def.hitboxSize) || 5;
            const hit = Chop.trunkHitsSegment(chopSeg, e.x, e.y, hs, Chop.HIT_RADIUS)
                || (swingSeg && Chop.trunkHitsSegment(swingSeg, e.x, e.y, hs, Chop.HIT_RADIUS));
            if (!hit) return;
            const dx = e.x - creature.x;
            const dy = e.y - creature.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
                best = e;
                bestDef = def;
                bestChunk = chunk;
                bestList = listName;
                bestD = d;
            }
        });
        if (!best || !bestChunk) return;
        if (!creature.attackHitSet) creature.attackHitSet = new Set();
        creature.attackHitSet.add(best);
        creature._attackChoppedTree = true;
        const result = Chop.applyChop(best, frac);
        if (!creature._attackWoreHeld) {
            this._wearPlayerHeld(creature.id, 1);
            creature._attackWoreHeld = true;
        }
        if (result.felled) {
            const drops = Chop.rollDrops(bestDef, () => this.rng());
            const piles = Chop.scatterFellPiles(drops, best.x, best.y, () => this.rng());
            Chop.fellToStump(best, bestDef);
            for (const p of piles) {
                this._pushDrop(p.x, p.y, { id: p.id, quantity: p.quantity }, { noMerge: true });
            }
        }
        this.pushEvent({
            kind: "chop",
            playerId: creature.id,
            cx: bestChunk.cx,
            cy: bestChunk.cy,
            x: best.x,
            y: best.y,
            uid: best.uid || null,
            id: best.id,
            chopProgress: result.felled ? null : result.progress,
            felled: !!result.felled,
            list: bestList === "lootable" ? "lootable" : "things"
        });
    }

    _stackIsSpecial(s) {
        return !!(s && (
            s.customName || s.food || s.ingredients || s.toolClass
            || s.knapIconData || s.knapDamage != null || s.knapQuality
            || s.durability != null
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
        if (src.weight != null) {
            const w = Number(src.weight);
            if (Number.isFinite(w) && w > 0) out.weight = w;
        }
        if (src.durability != null) {
            const n = Number(src.durability);
            if (Number.isFinite(n) && n >= 0) out.durability = Math.min(10000, n);
        }
        if (src.dryProgress != null) {
            const n = Math.floor(Number(src.dryProgress) || 0);
            if (n > 0) out.dryProgress = n;
        }
        if (src.soakProgress != null) {
            const n = Math.floor(Number(src.soakProgress) || 0);
            if (n > 0) out.soakProgress = n;
        }
        if (src.soakDoneAt != null) {
            const n = Math.round(Number(src.soakDoneAt));
            if (Number.isFinite(n)) out.soakDoneAt = n;
        }
        if (src.temp != null && Number(src.temp) > Fire.AMBIENT_TEMP) {
            out.temp = Number(src.temp);
        }
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
        if (extras.durability != null) slot.durability = extras.durability;
        if (extras.dryProgress != null) slot.dryProgress = extras.dryProgress;
        if (extras.soakProgress != null) slot.soakProgress = extras.soakProgress;
        if (extras.soakDoneAt != null) slot.soakDoneAt = extras.soakDoneAt;
        if (extras.temp != null) Fire.applyStackTemp(slot, extras.temp);
        return slot;
    }

    /** Snapshot/public wire shape for a ground drop (includes tip quality, knap fields). */
    _publicDrop(d, c) {
        if (!d) return null;
        Hide.migrateStackItemId(d);
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
        this._syncOverflowSize(p);
        const over = p.overflow || [];
        for (let i = 0; i < over.length; i++) {
            if (over[i]) continue;
            over[i] = clone;
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

    _tryKnap(session, action = {}) {
        const p = this._actionPawn(session, action);
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
            p._knapSession = {
                slot,
                id: held.id,
                material,
                rework: !!rework,
                durability: held.durability,
                knapQuality: held.knapQuality || null,
                toolClass: held.toolClass || null
            };
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
            if (session.rework && session.durability != null) {
                Durability.carryDurabilityAfterRework(
                    {
                        durability: session.durability,
                        knapQuality: session.knapQuality,
                        toolClass: session.toolClass,
                        id: session.id
                    },
                    stack,
                    itemDefs().get(session.id),
                    itemDefs().get(stack.id)
                );
            }
            this._insertUniqueStack(p, stack, session.slot);
        }
    }

    /** Swap or merge two bag slots (hotbar and/or overflow). */
    _tryInvSwap(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const from = Math.floor(Number(action.from));
        const to = Math.floor(Number(action.to));
        const fromBag = this._normBag(action.fromBag);
        const toBag = this._normBag(action.toBag);
        const fromInv = this._pawnBag(p, fromBag);
        const toInv = this._pawnBag(p, toBag);
        if (!Number.isInteger(from) || !Number.isInteger(to)) return;
        if (fromBag === toBag && from === to) return;
        if (from < 0 || to < 0 || from >= fromInv.length || to >= toInv.length) return;
        const a = fromInv[from];
        if (!a?.id) return;
        const b = toInv[to];
        const qty = Math.max(1, Math.floor(Number(a.quantity) || 1));
        let want = Math.floor(Number(action.amount));
        if (!Number.isFinite(want) || want < 1) want = qty;
        want = Math.min(want, qty);
        if (b && a.id === b.id && !this._stackIsSpecial(a) && !this._stackIsSpecial(b)) {
            const meta = itemDefs().get(a.id);
            const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
            const space = Math.max(0, maxStack - (b.quantity || 1));
            if (space > 0) {
                const moved = Math.min(space, want);
                b.spoilLeft = Spoil.mergeSpoilLeft(
                    b.quantity || 1, b.spoilLeft,
                    moved, a.spoilLeft
                );
                delete b.spoilAt;
                Hide.applyMergedDryProgress(b, b.quantity || 1, moved, a.dryProgress);
                Hide.applyMergedSoakProgress(b, b.quantity || 1, moved, a.soakProgress);
                Fire.applyMergedStackTemp(b, b.quantity || 1, moved, a.temp);
                b.quantity = (b.quantity || 1) + moved;
                a.quantity = qty - moved;
                if (!(a.quantity > 0)) fromInv[from] = null;
            } else if (want >= qty) {
                fromInv[from] = b;
                toInv[to] = a;
            } else {
                return;
            }
        } else if (!b) {
            if (want >= qty) {
                toInv[to] = a;
                fromInv[from] = null;
            } else {
                const piece = this._cloneGearStack(a, want);
                a.quantity = qty - want;
                toInv[to] = piece;
            }
        } else if (want >= qty) {
            toInv[to] = a;
            fromInv[from] = b || null;
        } else {
            return;
        }
        if (toBag === "hotbar") {
            p.hotbarIndex = to;
            if (p.creature) p.creature.hotbarIndex = to;
        }
        this._dirtyPawnOwner(p);
    }

    _ensureEquipment(p) {
        if (!p.equipment || typeof p.equipment !== "object") {
            p.equipment = { head: null, torso: null, legs: null, feet: null, back: null, waist: [] };
        }
        if (p.equipment.back === undefined) p.equipment.back = null;
        if (!Array.isArray(p.equipment.waist)) p.equipment.waist = [];
        if (!Array.isArray(p.overflow)) p.overflow = [];
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
        for (const key of ["head", "torso", "legs", "feet", "back"]) {
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
        if (w.length > cap) {
            for (let i = cap; i < w.length; i++) {
                const s = w[i];
                if (s?.id) this._pushDrop(p.x, p.y, this._cloneStackForWorld(s));
            }
            w.length = cap;
        }
    }

    _afterApparelWear(creature) {
        const pawn = this._findOwnedPawn(creature?.id);
        if (!pawn) return;
        this._syncWaistSlots(pawn);
        this._syncPlayerInvSize(pawn);
        if (creature) creature.equipment = pawn.equipment;
        this._dirtyPawnOwner(pawn);
    }

    _applyApparelDeathWear(p) {
        if (!p?.equipment) return;
        Apparel.applyDeathWear(
            p.equipment,
            (id) => DataStore.getItem(id),
            () => this.rng(),
            Durability
        );
        this._syncWaistSlots(p);
        this._syncPlayerInvSize(p);
    }

    _tickApparelDailyWear(p) {
        if (!p?.equipment || p.dead) return;
        const broke = Apparel.applyDailyWear(
            p.equipment,
            (id) => DataStore.getItem(id),
            () => this.rng(),
            Durability
        );
        if (broke.length) {
            this._syncWaistSlots(p);
            this._syncPlayerInvSize(p);
            const creature = p.creature || this.creatures.get(p.id);
            if (creature) creature.equipment = p.equipment;
            const self = !p.ownerId || p.ownerId === p.id;
            for (const piece of broke) {
                this.pushEvent({
                    kind: "combat_log",
                    text: self
                        ? `Your ${piece.name} fell apart`
                        : `${p.name || "Someone"}'s ${piece.name} fell apart`,
                    to: p.ownerId || p.id
                });
            }
            this._dirtyPawnOwner(p);
        }
    }

    _hotbarBonus(p) {
        this._ensureEquipment(p);
        let n = 0;
        const pieces = [
            p.equipment.head,
            p.equipment.torso,
            p.equipment.legs,
            p.equipment.feet,
            p.equipment.back,
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

    _overflowBonus(p) {
        this._ensureEquipment(p);
        let n = 0;
        const pieces = [
            p.equipment.head,
            p.equipment.torso,
            p.equipment.legs,
            p.equipment.feet,
            p.equipment.back,
            ...p.equipment.waist
        ];
        for (const stack of pieces) {
            if (!stack?.id) continue;
            const add = itemDefs().get(stack.id)?.equip?.effects?.addSlot;
            if (!Array.isArray(add)) continue;
            for (const s of add) if (s === "overflow") n++;
        }
        return n;
    }

    _normBag(bag) {
        return String(bag || "hotbar") === "overflow" ? "overflow" : "hotbar";
    }

    _pawnBag(p, bag) {
        this._ensureEquipment(p);
        if (this._normBag(bag) === "overflow") {
            if (!Array.isArray(p.overflow)) p.overflow = [];
            const size = Math.max(0, this._overflowBonus(p));
            while (p.overflow.length < size) p.overflow.push(null);
            return p.overflow;
        }
        if (!Array.isArray(p.inventory)) p.inventory = [];
        return p.inventory;
    }

    _syncOverflowSize(p) {
        const size = Math.max(0, this._overflowBonus(p));
        if (!Array.isArray(p.overflow)) p.overflow = [];
        while (p.overflow.length < size) p.overflow.push(null);
        if (p.overflow.length > size) {
            for (let i = size; i < p.overflow.length; i++) {
                const s = p.overflow[i];
                if (s?.id) this._pushDrop(p.x, p.y, this._cloneStackForWorld(s));
            }
            p.overflow.length = size;
        }
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
        this._syncOverflowSize(p);
    }

    _getEquipStack(p, slotKey) {
        this._ensureEquipment(p);
        if (String(slotKey).startsWith("waist:")) {
            const i = parseInt(String(slotKey).slice(6), 10);
            if (!Number.isInteger(i) || i < 0) return null;
            return p.equipment.waist[i] || null;
        }
        if (!["head", "torso", "legs", "feet", "back"].includes(slotKey)) return null;
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
        if (!["head", "torso", "legs", "feet", "back"].includes(slotKey)) return false;
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
        if (["head", "torso", "legs", "feet", "back"].includes(key)) {
            return { key, body: key, waist: false, index: -1 };
        }
        if (key.startsWith("waist:")) {
            const i = parseInt(key.slice(6), 10);
            if (!Number.isInteger(i) || i < 0 || i > 16) return null;
            return { key, body: "waist", waist: true, index: i };
        }
        return null;
    }

    _tryEquip(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const from = Math.floor(Number(action.from));
        const parsed = this._parseEquipSlot(action.slot);
        if (!parsed || !Number.isInteger(from) || from < 0) return;
        const fromBag = this._normBag(action.fromBag);
        const inv = this._pawnBag(p, fromBag);
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
        this._dirtyPawnOwner(p);
    }

    _tryUnequip(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const parsed = this._parseEquipSlot(action.slot);
        const to = Math.floor(Number(action.to));
        if (!parsed || !Number.isInteger(to) || to < 0) return;
        const equipped = this._getEquipStack(p, parsed.key);
        if (!equipped?.id) return;
        if (!parsed.waist && !this._canChangeBodySlot(p, parsed.key, null)) return;
        const toBag = this._normBag(action.toBag);
        if (toBag === "overflow" && parsed.key === "back") return;
        const inv = this._pawnBag(p, toBag);
        if (!Array.isArray(inv)) return;
        if (toBag === "overflow" && to >= this._overflowBonus(p)) return;
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
            Hide.applyMergedDryProgress(dest, dest.quantity || 1, eqQty, equipped.dryProgress);
            Hide.applyMergedSoakProgress(dest, dest.quantity || 1, eqQty, equipped.soakProgress);
            Fire.applyMergedStackTemp(dest, dest.quantity || 1, eqQty, equipped.temp);
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
        this._dirtyPawnOwner(p);
    }

    _tryEquipSwap(session, action = {}) {
        const p = this._actionPawn(session, action);
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
        this._dirtyPawnOwner(p);
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

    _pushDrop(wx, wy, drop, opts = null) {
        if (!drop?.id) return null;
        let remaining = Math.max(1, Math.floor(Number(drop.quantity) || 1));
        const meta = itemDefs().get(drop.id);
        const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
        const incomingSpecial = this._stackIsSpecial(drop);
        const maxDist2 = TS * TS;
        let last = null;
        const noMerge = !!(opts && opts.noMerge);
        const soakProbe = {
            id: drop.id,
            soakProgress: drop.soakProgress,
            soakDoneAt: drop.soakDoneAt,
            x: wx,
            y: wy
        };
        this._stampDropSoak(soakProbe);
        if (soakProbe.soakDoneAt != null) drop.soakDoneAt = soakProbe.soakDoneAt;

        // Same as client DroppedItem.spawn: fill nearby plain piles first
        if (!incomingSpecial && !noMerge) {
            const nearby = [];
            for (const c of this._chunksNear(wx, wy, 1)) {
                if (!Array.isArray(c.drops)) continue;
                for (const pile of c.drops) {
                    if (!pile || pile.id !== drop.id) continue;
                    if (this._stackIsSpecial(pile)) continue;
                    if (Hide.soakMergeBlocked(pile, drop)) continue;
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
                Hide.applyMergedDryProgress(pile, qty, add, drop.dryProgress);
                Hide.applyMergedSoakProgress(pile, qty, add, drop.soakProgress);
                Fire.applyMergedStackTemp(pile, qty, add, drop.temp);
                const mergedDone = Hide.mergeSoakDoneAt(qty, pile.soakDoneAt, add, drop.soakDoneAt);
                if (mergedDone != null) pile.soakDoneAt = mergedDone;
                else delete pile.soakDoneAt;
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
            this._stampDropSoak(entry);
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
            playerCorpse: !!opts.playerCorpse,
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

    _skinLootTable(mobId, bodyJson) {
        const id = String(mobId || "");
        if (id === "deer") {
            const loot = [
                { id: "raw_venison", min: 2, max: 4 },
                { id: "deer_hide", min: 1, max: 1 },
                { id: "brain", min: 1, max: 1 },
                { id: "bone", min: 2, max: 4 }
            ];
            return Body.isBrainDestroyed?.(bodyJson) ? loot.filter((d) => d.id !== "brain") : loot;
        }
        if (id === "boar") {
            const loot = [
                { id: "raw_pork", min: 3, max: 5 },
                { id: "boar_hide", min: 1, max: 1 },
                { id: "brain", min: 1, max: 1 },
                { id: "bone", min: 2, max: 4 }
            ];
            return Body.isBrainDestroyed?.(bodyJson) ? loot.filter((d) => d.id !== "brain") : loot;
        }
        if (id === "human") {
            const loot = [
                { id: "raw_beef", min: 2, max: 4 },
                { id: "brain", min: 1, max: 1 },
                { id: "bone", min: 1, max: 2 }
            ];
            return Body.isBrainDestroyed?.(bodyJson) ? loot.filter((d) => d.id !== "brain") : loot;
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
        for (const drop of this._skinLootTable(entry.mobId, entry.body)) {
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
                Hide.applyMergedDryProgress(slot, slot.quantity || 1, add, 0);
                Fire.applyMergedStackTemp(slot, slot.quantity || 1, add, null);
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
        this._wearHeld(p, 1);
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

    _tryRackFlesh(p, action = {}) {
        if (!p || p.dead) return;
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            p.x = action.x;
            p.y = action.y;
            p.poseAuth = true;
        }
        const held = this._held(p);
        const heldDef = held ? itemDefs().get(held.id) : null;
        if (!held || Carry.stackToolClass(held, heldDef) !== "scraper") return;
        const found = this._findPlayerStorage(p, action);
        if (!found) return;
        const { chunk, entry } = found;
        const def = thingDefs().get(entry.id);
        if (!Hide.isDryingRack(def, entry)) return;
        Place.ensureStorageEntry(entry, def);
        const stack = this._storageGetSlot(entry, "0");
        const meta = stack ? itemDefs().get(stack.id) : null;
        if (!Hide.canScrape(meta)) return;
        const now = this.worldMinuteIndex();
        const next = Hide.scrapeStackFrom(stack, (id) => itemDefs().get(id), now);
        if (!next) return;
        this._storageSetSlot(entry, "0", next);
        this._wearHeld(p, 1);
        this._emitStorage(chunk, entry);
        this._youDirty.add(p.id);
    }

    _tryRackBrain(p, action = {}) {
        if (!p || p.dead) return;
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            p.x = action.x;
            p.y = action.y;
            p.poseAuth = true;
        }
        const held = this._held(p);
        const heldDef = held ? itemDefs().get(held.id) : null;
        if (!held || !Hide.isBrainItem(heldDef)) return;
        const found = this._findPlayerStorage(p, action);
        if (!found) return;
        const { chunk, entry } = found;
        const def = thingDefs().get(entry.id);
        if (!Hide.isDryingRack(def, entry)) return;
        Place.ensureStorageEntry(entry, def);
        const stack = this._storageGetSlot(entry, "0");
        const meta = stack ? itemDefs().get(stack.id) : null;
        if (!Hide.isDehairedHide(meta)) return;
        const now = this.worldMinuteIndex();
        const next = Hide.brainedStackFrom(stack, (id) => itemDefs().get(id), now);
        if (!next) return;
        this._storageSetSlot(entry, "0", next);
        const qty = Math.max(1, Math.floor(Number(held.quantity) || 1));
        held.quantity = qty - 1;
        const inv = p.inventory;
        const idx = Math.floor(Number(p.hotbarIndex) || 0);
        if (!(held.quantity > 0) && Array.isArray(inv) && inv[idx] === held) inv[idx] = null;
        this._youDirty.add(p.id);
        this._emitStorage(chunk, entry);
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
        const actor = this._actionPawn(p, action) || p;
        const dest = action.toPawnId ? this._partyGiveDest(p, action, actor) : p;
        if (action.toPawnId && !dest) return;
        const receiver = dest || p;
        const dx = entry.x - actor.x;
        const dy = entry.y - actor.y;
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
            const equipKey = this._emptyEquipSlotForItem(receiver, stack.id);
            if (equipKey) {
                const one = this._cloneGearStack(stack, 1);
                this._setEquipStack(receiver, equipKey, one);
                stack.quantity = (Math.floor(Number(stack.quantity) || 1)) - 1;
                if (!(stack.quantity > 0)) entry.loot.splice(slot, 1);
                this._syncWaistSlots(receiver);
                this._syncPlayerInvSize(receiver);
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
        const prefer = Math.floor(Number(action.inv));
        const bag = this._normBag(action.bag);
        const left = action.toPawnId
            ? this._giveOwnedStack(receiver, { ...stack, quantity: takeQty })
            : (Number.isInteger(prefer) && prefer >= 0
                ? this._placeInBagSlot(receiver, { ...stack, quantity: takeQty }, prefer, bag)
                : this._give(p, stack.id, takeQty, this._stackExtrasFrom(stack)));
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

    _tryPickup(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const dropId = action.dropId || (typeof action === "string" ? action : null);
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
        const now = this.worldMinuteIndex();
        Hide.pickupSoak(best, now);
        const want = best.quantity || 1;
        const left = this._give(p, best.id, want, this._stackExtrasFrom(best));
        if (left >= want) return; // nothing fit — leave drop
        if (left > 0) best.quantity = left;
        else bestChunk.drops.splice(bestIdx, 1);
        this._dirtyPawnOwner(p);
        this.pushEvent({
            kind: "pickup",
            playerId: this._sessionOfPawn(p)?.id || p.id,
            pawnId: p.id,
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
    _tryHarvest(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
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
            ? GameMath.jitteredRegrowAt(regrowMinutes, this.worldMinuteIndex(), () => this.rng())
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

    _tryDrop(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const amount = Math.max(1, Math.floor(Number(action.amount) || 1));
        const held = this._held(p);
        if (!held?.id) return;

        const qty = Math.min(amount, held.quantity || 1);
        if (qty <= 0) return;

        const worldStack = this._cloneStackForWorld({ ...held, quantity: qty });
        held.quantity = (held.quantity || 1) - qty;
        if (held.quantity <= 0) p.inventory[p.hotbarIndex] = null;

        const dx = Number.isFinite(action.x) ? Number(action.x) : p.x;
        const dy = Number.isFinite(action.y) ? Number(action.y) : p.y;
        p.x = dx;
        p.y = dy;
        const creature = p.creature || this.creatures.get(p.id);
        if (creature) {
            creature.x = dx;
            creature.y = dy;
        }
        if (worldStack) this._pushDrop(dx, dy, worldStack);
        this._dirtyPawnOwner(p);
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
        return Fire.lightPit(entry, (id) => itemDefs().get(id));
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
            simmerBarMinutes: (entry.simmerBarMinutes > 0) ? entry.simmerBarMinutes : undefined,
            pitTemp: entry.pitTemp,
            cookTemp: entry.cookTemp,
            maxTemp: entry.maxTemp,
            canIgniteFuel: !!entry.canIgniteFuel,
            smolderAt: entry.smolderAt
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
        const pit = Fire.tickPit(entry, (id) => itemDefs().get(id), this.worldMinuteIndex());
        return !!(pit.changed || pit.litChanged);
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
        const meats = [];
        if (unique.includes("raw_beef")) meats.push("Beef");
        if (unique.includes("raw_venison")) meats.push("Venison");
        if (unique.includes("raw_pork")) meats.push("Pork");
        const hasMeat = meats.length > 0;
        const hasApple = unique.includes("apple");
        const hasBlue = unique.includes("blueberry");
        if (hasMeat) {
            kind = "stew";
            spoilHours = 36;
            const meatLabel = meats.length > 1 ? "Meat" : meats[0];
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

    _tickCampfireCook(entry) {
        const getItem = (id) => itemDefs().get(id);
        const cook = Fire.tickCook(entry, getItem, {
            worldMinute: this.worldMinuteIndex(),
            makeResult: (meta, qty, at) => Spoil.makeWorldItemStack(meta, qty, undefined, at),
            finishSimmer: (e) => {
                const meal = this._makeSimmerMeal(e);
                e.simmer = [null, null, null, null];
                e.catalyst = meal;
            }
        });
        if (cook.rate > 0 && cook.method === "stick_roast") {
            this._wearRoastCatalyst(entry, cook.rate);
            return true;
        }
        return !!(cook.changed || cook.converted);
    }

    _wearRoastCatalyst(entry, rate = 1) {
        const stack = entry?.catalyst;
        if (!stack) return false;
        const def = itemDefs().get(stack.id);
        const result = Durability.applyDurabilityUse(
            stack,
            Durability.COOK_WEAR_PER_MINUTE * Math.max(0, Number(rate) || 0),
            def
        );
        if (!result.broke) return stack.durability != null;
        const name = Durability.stackDisplayName(stack, def);
        entry.catalyst = null;
        const attend = entry.attend;
        if (attend && typeof attend === "object") {
            for (const id of Object.keys(attend)) {
                if (!this.players.has(id)) continue;
                this.pushEvent({
                    kind: "combat_log",
                    text: Durability.breakMessage(name, false),
                    to: id
                });
            }
        }
        return true;
    }

    _tickOneCampfire(entry) {
        if (!this._isCampfireEntry(entry)) return false;
        Fire.migrateEntry(entry, (id) => itemDefs().get(id));
        const idBefore = entry.id;
        const fuelBefore = this._fuelSignature(entry);
        const cookId = entry.cook?.id || "";
        const catId = entry.catalyst?.id || "";
        const tempBefore = entry.pitTemp;
        const cookTempBefore = entry.cookTemp;
        let slotDirty = this._tickCampfireBurn(entry);
        slotDirty = this._tickCampfireCook(entry) || slotDirty;
        if (entry.id !== idBefore) slotDirty = true;
        if (this._fuelSignature(entry) !== fuelBefore) slotDirty = true;
        if ((entry.cook?.id || "") !== cookId) slotDirty = true;
        if ((entry.catalyst?.id || "") !== catId) slotDirty = true;
        if (entry.pitTemp !== tempBefore) slotDirty = true;
        if (entry.cookTemp !== cookTempBefore) slotDirty = true;
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

    _tickDryingRacks() {
        const getItem = (id) => itemDefs().get(id);
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.things)) continue;
            for (const entry of c.things) {
                const def = thingDefs().get(entry?.id);
                if (!Hide.isDryingRack(def, entry)) continue;
                Place.ensureStorageEntry(entry, def);
                const { changed } = Hide.tickRackEntry(entry, getItem);
                if (changed) this._emitStorage(c, entry);
            }
        }
    }

    _dropIsOnWater(drop) {
        if (!drop) return false;
        const pt = Hide.dropSamplePoint(drop.x, drop.y, TS);
        const { tx, ty } = this._tileOf(pt.x, pt.y);
        return this._tileKeyAt(tx, ty) === "water";
    }

    _stampDropSoak(entry) {
        if (!entry) return;
        const def = itemDefs().get(entry.id);
        if (!Hide.isFleshedHide(def) || !this._dropIsOnWater(entry)) return;
        Hide.beginSoak(entry, this.worldMinuteIndex());
    }

    _soakChunkDrops(c) {
        if (!c || !Array.isArray(c.drops)) return;
        const now = this.worldMinuteIndex();
        const getItem = (id) => itemDefs().get(id);
        for (const d of c.drops) {
            if (!d) continue;
            Hide.tickSoakDrop(d, now, getItem, this._dropIsOnWater(d));
        }
    }

    _tickSoakDrops() {
        for (const c of this.chunks.values()) this._soakChunkDrops(c);
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

    _tryLightFire(session, action = {}) {
        const p = this._actionPawn(session, action);
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
            this._wearHeld(p, 1);
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
        this._wearHeld(p, 1);
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
            const prevId = entry.cook?.id;
            entry.cook = stack || null;
            Fire.onCookChanged(entry, prevId);
            return;
        }
        if (slot.kind === "catalyst") {
            entry.catalyst = stack || null;
            return;
        }
        if (slot.kind === "fuel") {
            if (!Array.isArray(entry.fuel)) entry.fuel = [null, null];
            entry.fuel[slot.i] = stack || null;
            Fire.tryAutoIgnite(entry, (id) => itemDefs().get(id), this.worldMinuteIndex());
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
        return method === "stick_roast" || method === "smoke_hide";
    }

    _campfireCookAccepts(entry, itemId) {
        const method = this._campfireMethod(entry);
        if (!method || !itemId) return false;
        const recipe = itemDefs().get(itemId)?.cook?.[method];
        return !!(recipe?.result && recipe.minutes > 0);
    }

    _campfireSimmerOpen(entry) {
        return this._campfireMethod(entry) === "shell_simmer" || this._campfireHasSimmer(entry);
    }

    _campfireCatalystLocked(entry) {
        return !!(entry?.cook || this._campfireHasSimmer(entry));
    }

    _isSimmerIngredient(id) {
        return ["apple", "blueberry", "raw_beef", "raw_venison", "raw_pork"].includes(String(id || ""));
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

    _splitInvToWorld(p, index, amount, bag = "hotbar") {
        const inv = this._pawnBag(p, bag);
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

    _returnWorldToInv(p, worldStack, preferIndex = -1, bag = "hotbar") {
        if (!p || !worldStack?.id) return false;
        const now = this.worldMinuteIndex();
        const qty = Math.max(1, Math.floor(Number(worldStack.quantity) || 1));
        const extras = this._stackExtrasFrom(worldStack) || {};
        const left = Spoil.spoilLeftForCharacter(worldStack, now);
        if (left != null) extras.spoilLeft = left;
        delete extras.spoilAt;
        const prefer = Math.floor(Number(preferIndex));
        const toBag = this._normBag(bag);
        if (Number.isInteger(prefer) && prefer >= 0) {
            this._ensureEquipment(p);
            if (toBag === "overflow") this._syncOverflowSize(p);
            else this._syncPlayerInvSize(p);
            const inv = this._pawnBag(p, toBag);
            const cap = toBag === "overflow" ? this._overflowBonus(p) : inv.length;
            if (prefer < cap) {
                while (inv.length <= prefer) inv.push(null);
                const dest = inv[prefer];
                if (!dest) {
                    const slot = { id: worldStack.id, quantity: qty };
                    this._applyStackExtras(slot, extras);
                    if (left != null) slot.spoilLeft = left;
                    inv[prefer] = slot;
                    this._youDirty.add(p.id);
                    this._enforceCarryCap(p);
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
                        Hide.applyMergedDryProgress(dest, dest.quantity || 1, moved, extras.dryProgress);
                        Hide.applyMergedSoakProgress(dest, dest.quantity || 1, moved, extras.soakProgress);
                        Fire.applyMergedStackTemp(dest, dest.quantity || 1, moved, extras.temp);
                        dest.quantity = (dest.quantity || 1) + moved;
                        this._youDirty.add(p.id);
                        if (moved >= qty) {
                            this._enforceCarryCap(p);
                            return true;
                        }
                        worldStack = { ...worldStack, quantity: qty - moved };
                    }
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
        this._enforceCarryCap(p);
        return leftover < (worldStack.quantity || qty);
    }

    /**
     * Put a world stack into a specific bag slot (empty or merge). Returns leftover qty.
     * Does not drop leftovers — caller keeps them (e.g. corpse loot).
     */
    _placeInBagSlot(p, worldStack, index, bag = "hotbar") {
        if (!p || !worldStack?.id) return Math.max(1, Math.floor(Number(worldStack?.quantity) || 1));
        const now = this.worldMinuteIndex();
        const qty = Math.max(1, Math.floor(Number(worldStack.quantity) || 1));
        const extras = this._stackExtrasFrom(worldStack) || {};
        const spoilLeft = Spoil.spoilLeftForCharacter(worldStack, now);
        if (spoilLeft != null) extras.spoilLeft = spoilLeft;
        delete extras.spoilAt;
        this._ensureEquipment(p);
        const toBag = this._normBag(bag);
        if (toBag === "overflow") this._syncOverflowSize(p);
        else this._syncPlayerInvSize(p);
        const inv = this._pawnBag(p, toBag);
        const cap = toBag === "overflow" ? this._overflowBonus(p) : inv.length;
        if (!Number.isInteger(index) || index < 0 || index >= cap) return qty;
        while (inv.length <= index) inv.push(null);
        const dest = inv[index];
        if (!dest) {
            const slot = { id: worldStack.id, quantity: qty };
            this._applyStackExtras(slot, extras);
            if (spoilLeft != null) slot.spoilLeft = spoilLeft;
            inv[index] = slot;
            this._youDirty.add(p.id);
            this._enforceCarryCap(p);
            return 0;
        }
        if (dest.id === worldStack.id && !this._stackIsSpecial(dest) && !this._stackIsSpecial(worldStack)) {
            const meta = itemDefs().get(dest.id);
            const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
            const space = Math.max(0, maxStack - (dest.quantity || 1));
            const moved = Math.min(space, qty);
            if (!(moved > 0)) return qty;
            dest.spoilLeft = Spoil.mergeSpoilLeft(
                dest.quantity || 1, dest.spoilLeft,
                moved, spoilLeft
            );
            delete dest.spoilAt;
            Hide.applyMergedDryProgress(dest, dest.quantity || 1, moved, extras.dryProgress);
            Hide.applyMergedSoakProgress(dest, dest.quantity || 1, moved, extras.soakProgress);
            Fire.applyMergedStackTemp(dest, dest.quantity || 1, moved, extras.temp);
            dest.quantity = (dest.quantity || 1) + moved;
            this._youDirty.add(p.id);
            this._enforceCarryCap(p);
            return qty - moved;
        }
        return qty;
    }

    _tryCampfire(session, action = {}) {
        const p = this._actionPawn(session, action);
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
        if (op === "destroy") {
            this._destroyCampfire(chunk, entry);
            return;
        }
        if (op === "inv_to_slot") this._campfireInvToSlot(p, entry, action);
        else if (op === "slot_to_inv") this._campfireSlotToInv(p, entry, action);
        else if (op === "slot_to_slot") this._campfireSlotToSlot(entry, action);
        else return;
        this._emitCampfire(chunk, entry);
        this._youDirty.add(p.id);
    }

    _campfireContentStacks(entry) {
        const stacks = [];
        const push = (s) => {
            if (s?.id && s.quantity > 0) stacks.push(s);
        };
        for (const s of entry?.fuel || []) push(s);
        push(entry?.cook);
        push(entry?.catalyst);
        for (const s of entry?.simmer || []) push(s);
        return stacks;
    }

    _unlinkStationUid(uid) {
        if (!uid) return;
        const hit = Settlement.unlinkStation(this.settlements, uid);
        for (const s of hit) {
            if (s.ownerId) this._youDirty.add(s.ownerId);
        }
    }

    _destroyCampfire(chunk, entry) {
        if (!chunk || !entry) return;
        if (entry.id === "campfire") return;
        const x = Number(entry.x) || 0;
        const y = Number(entry.y) || 0;
        for (const stack of this._campfireContentStacks(entry)) {
            const world = this._cloneStackForWorld(stack);
            if (world) this._pushDrop(x, y, world);
        }
        this._unlinkStationUid(entry.uid);
        const i = chunk.things.indexOf(entry);
        if (i >= 0) chunk.things.splice(i, 1);
        this._emitCampfireRemoved(chunk, entry);
    }

    _emitCampfireRemoved(chunk, entry) {
        if (!chunk || !entry) return;
        this.pushEvent({
            kind: "campfire",
            removed: true,
            uid: entry.uid,
            id: entry.id,
            x: entry.x,
            y: entry.y,
            cx: chunk.cx,
            cy: chunk.cy
        });
    }

    _isCraftStationEntry(t) {
        if (!t) return false;
        const def = thingDefs().get(t.id);
        return !!def?.craftStation;
    }

    _isStorageEntry(t) {
        if (!t) return false;
        if (this._isCraftStationEntry(t)) return false;
        if (Array.isArray(t.slots)) return true;
        const def = thingDefs().get(t.id);
        return !!def?.storage;
    }

    _isSleepEntry(t) {
        if (!t) return false;
        const def = thingDefs().get(t.id);
        return Place.isSleepThing(def, t);
    }

    _isPlaceableEntry(t) {
        const def = thingDefs().get(t?.id);
        return this._isStorageEntry(t) || this._isCraftStationEntry(t) || this._isSleepEntry(t)
            || Place.isSettlementThing(def, t);
    }

    _storagePublic(entry, chunk = null) {
        if (!entry) return null;
        const def = thingDefs().get(entry.id);
        if (def?.craftStation) {
            Place.ensureCraftStationEntry(entry);
            return {
                uid: entry.uid,
                id: entry.id,
                x: entry.x,
                y: entry.y,
                cx: chunk?.cx,
                cy: chunk?.cy,
                rev: Number(entry.rev) || 0,
                rot: Place.normalizeRot(entry.rot),
                craftStation: true
            };
        }
        if (Place.isSleepThing(def, entry)) {
            Place.ensureSleepEntry(entry, def);
            return {
                uid: entry.uid,
                id: entry.id,
                x: entry.x,
                y: entry.y,
                tx: entry.tx,
                ty: entry.ty,
                cx: chunk?.cx,
                cy: chunk?.cy,
                rev: Number(entry.rev) || 0,
                rot: Place.normalizeRot(entry.rot),
                sleep: true,
                occupants: Array.isArray(entry.occupants) ? entry.occupants : [null, null]
            };
        }
        if (Place.isSettlementThing(def, entry)) {
            Place.ensureSettlementEntry(entry);
            return {
                uid: entry.uid,
                id: entry.id,
                x: entry.x,
                y: entry.y,
                cx: chunk?.cx,
                cy: chunk?.cy,
                rev: Number(entry.rev) || 0,
                rot: Place.normalizeRot(entry.rot),
                settlement: true,
                settlementId: entry.settlementId || null
            };
        }
        Place.ensureStorageEntry(entry, def);
        return {
            uid: entry.uid,
            id: entry.id,
            x: entry.x,
            y: entry.y,
            cx: chunk?.cx,
            cy: chunk?.cy,
            rev: Number(entry.rev) || 0,
            rot: Place.normalizeRot(entry.rot),
            slots: entry.slots || [],
            storageFilter: entry.storageFilter || null
        };
    }

    _bumpStorage(entry) {
        if (!entry) return;
        entry.rev = (Number(entry.rev) || 0) + 1;
    }

    _emitStorage(chunk, entry, extra = {}) {
        if (!chunk || !entry) return;
        this._bumpStorage(entry);
        const pub = this._storagePublic(entry, chunk);
        this.pushEvent({
            kind: "storage",
            cx: chunk.cx,
            cy: chunk.cy,
            uid: pub.uid,
            ...pub,
            ...extra
        });
    }

    _emitStorageRemoved(chunk, entry) {
        if (!chunk || !entry) return;
        this.pushEvent({
            kind: "storage",
            removed: true,
            uid: entry.uid,
            id: entry.id,
            x: entry.x,
            y: entry.y,
            cx: chunk.cx,
            cy: chunk.cy
        });
    }

    _tileKeyAt(tx, ty) {
        const { x, y } = this._tileCenter(tx, ty);
        const { cx, cy } = worldToChunk(x, y - 1);
        const c = this._ensureChunk(cx, cy);
        const lx = tx - c.cx * CS;
        const ly = ty - c.cy * CS;
        if (lx < 0 || ly < 0 || lx >= CS || ly >= CS) return null;
        return c.tiles[lx + ly * CS] || null;
    }

    _tryPlace(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead || p._resting) return;
        const invIndex = Math.floor(Number(p.hotbarIndex) || 0);
        const held = p.inventory?.[invIndex];
        if (!held?.id || !(held.quantity > 0)) return;
        const itemDef = itemDefs().get(held.id);
        const thingId = Place.placeThingId(itemDef);
        if (!thingId) return;
        const thingDef = thingDefs().get(thingId);
        if (!thingDef) return;
        const tx = Math.floor(Number(action.tx));
        const ty = Math.floor(Number(action.ty));
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
        const rot = Place.normalizeRot(action.rot);
        const { x, y } = this._tileCenter(tx, ty);
        if (!Place.inPlaceRange(p.x, p.y, x, y, TS, HARVEST_RANGE_TILES)) return;
        const fp = Place.footprintSize(thingDef);
        const tiles = Place.footprintTiles(tx, ty, rot, fp);
        const getThing = (id) => thingDefs().get(id);
        for (const t of tiles) {
            const occ = this._placeOccForTile(t.tx, t.ty);
            if (!Place.canPlaceOnTile({
                tileKey: occ.tileKey,
                things: occ.things,
                lootables: occ.lootables,
                tx: t.tx,
                ty: t.ty,
                tileSize: TS,
                getThing
            })) return;
        }
        if ((thingDef.settlement || Place.isSettlementThing(thingDef))
            && !Settlement.canPlace(this.settlements, x, y, TS)) {
            this.pushEvent({
                kind: "combat_log",
                text: "Too close to another settlement",
                to: session.id
            });
            return;
        }

        held.quantity = Math.max(0, Math.floor(Number(held.quantity) || 1) - 1);
        if (!(held.quantity > 0)) p.inventory[invIndex] = null;
        this._dirtyPawnOwner(p);

        const { cx, cy } = worldToChunk(x, y - 1);
        const chunk = this._ensureChunk(cx, cy);
        if (!Array.isArray(chunk.things)) chunk.things = [];
        if (!Array.isArray(chunk.lootableThings)) chunk.lootableThings = [];

        if (thingDef.sleep) {
            const entry = {
                id: thingId,
                x,
                y,
                tx,
                ty,
                rot
            };
            Place.ensureSleepEntry(entry, thingDef);
            chunk.things.push(entry);
            this._emitStorage(chunk, entry);
            return;
        }

        if (thingDef.craftStation) {
            const entry = {
                id: thingId,
                x,
                y,
                rot
            };
            Place.ensureCraftStationEntry(entry);
            chunk.things.push(entry);
            this._emitStorage(chunk, entry);
            return;
        }

        if (thingDef.settlement || Place.isSettlementThing(thingDef)) {
            const name = Settlement.clampName(action.name);
            if (!Settlement.canPlace(this.settlements, x, y, TS)) return;
            const entry = { id: thingId, x, y, tx, ty, rot };
            Place.ensureSettlementEntry(entry);
            chunk.things.push(entry);
            const settle = Settlement.createSettlement({
                name,
                ownerId: session.id,
                x, y, tx, ty
            });
            settle.stoneUid = entry.uid;
            entry.settlementId = settle.id;
            this.settlements.push(settle);
            this._emitStorage(chunk, entry);
            this._youDirty.add(session.id);
            this._announceWorld(`${settle.name} has been founded`);
            return;
        }

        const entry = {
            id: thingId,
            x,
            y,
            rot,
            uid: `st_${Math.round(x)}_${Math.round(y)}`,
            slots: Place.emptySlots(thingDef.storage?.slots || 1)
        };
        Place.ensureStorageEntry(entry, thingDef);
        chunk.things.push(entry);
        this._emitStorage(chunk, entry);
    }

    _placeOccForTile(tx, ty) {
        const { x, y } = this._tileCenter(tx, ty);
        const { cx, cy } = worldToChunk(x, y - 1);
        const things = [];
        const lootables = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const c = this.chunks.get(chunkKey(cx + dx, cy + dy));
                if (!c) continue;
                if (Array.isArray(c.things)) things.push(...c.things);
                if (Array.isArray(c.lootableThings)) lootables.push(...c.lootableThings);
            }
        }
        return {
            tileKey: this._tileKeyAt(tx, ty),
            things,
            lootables
        };
    }

    _trySleep(session, action = {}) {
        const op = String(action.op || "");
        if (op === "rest") this._sleepRest(session, action);
        else if (op === "wake") this._sleepWake(session, action);
        else if (op === "destroy") this._sleepDestroy(session, action);
    }

    _sleepLog(session, text) {
        if (!session || !text) return;
        this.pushEvent({
            kind: "combat_log",
            text: String(text),
            to: session.id
        });
    }

    _livingPartyOf(session) {
        const out = [];
        if (!session) return out;
        if (!session.dead) out.push(session);
        for (const m of session.party || []) {
            if (m && !m.dead) out.push(m);
        }
        return out;
    }

    _findSleepByUid(uid, near = null) {
        if (!uid) return null;
        const scan = (chunks) => {
            for (const c of chunks) {
                if (!Array.isArray(c.things)) continue;
                for (const t of c.things) {
                    if (t?.uid === uid && this._isSleepEntry(t)) return { chunk: c, entry: t };
                }
            }
            return null;
        };
        if (near && Number.isFinite(near.x) && Number.isFinite(near.y)) {
            const hit = scan(this._chunksNear(near.x, near.y, 2));
            if (hit) return hit;
        }
        return scan(this.chunks.values());
    }

    _sleepDef(entry) {
        return thingDefs().get(entry?.id);
    }

    _cancelRestWalksTo(uid) {
        for (const session of this.players.values()) {
            for (const pawn of this._livingPartyOf(session)) {
                if (pawn._restWalk?.uid !== uid) continue;
                pawn._restWalk = null;
                const c = pawn.creature || this.creatures.get(pawn.id);
                if (c) c._restWalk = null;
                this._sleepLog(session, `${pawn.name || "They"} can't rest there`);
            }
        }
    }

    _vacatePawn(pawn) {
        if (!pawn) return;
        const id = pawn.id;
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isSleepEntry(t) || !Array.isArray(t.occupants)) continue;
                let changed = false;
                for (let i = 0; i < t.occupants.length; i++) {
                    if (t.occupants[i] === id) {
                        t.occupants[i] = null;
                        changed = true;
                    }
                }
                if (changed) this._emitStorage(c, t);
            }
        }
        pawn._resting = false;
        pawn._restWalk = null;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (c) {
            c._resting = false;
            c._restWalk = null;
        }
    }

    _sleepRest(session, action) {
        const pawn = this._actionPawn(session, action);
        if (!pawn || pawn.dead) return;
        const found = this._findSleepByUid(action.uid, pawn);
        if (!found) {
            this._sleepLog(session, "They can't rest there");
            return;
        }
        const { entry } = found;
        const def = this._sleepDef(entry);
        Place.ensureSleepEntry(entry, def);
        const slot = Math.max(0, Math.floor(Number(action.slot) || 0));
        if (!Sleep.inHarvestRange(pawn.x, pawn.y, entry, TS, HARVEST_RANGE_TILES, def)
            && !(pawn._resting && pawn.lastSleep?.uid === entry.uid)) {
            // Allow the walk from farther than harvest once Rest is issued; only the click needs range.
        }
        const occ = entry.occupants[slot];
        if (occ && occ !== pawn.id) {
            this._sleepLog(session, "That spot is taken");
            return;
        }
        const pos = Sleep.sleeperWorldPos(entry, slot, TS, def);
        const downed = !!(pawn.prone || pawn.creature?._prone || pawn.creature?.isIncapacitated?.()
            || pawn.creature?.isImmobile?.());
        if (downed) {
            const onTile = Math.hypot(pawn.x - pos.x, pawn.y - pos.y) < TS;
            if (!onTile) {
                this._sleepLog(session, "They can't walk to the lean-to");
                return;
            }
        }
        this._cancelChannels(pawn);
        this._orderRest(session, pawn, entry, slot, { autofill: true });
    }

    _orderRest(session, pawn, entry, slot, opts = {}) {
        if (!pawn || !entry) return false;
        if (entry.occupants?.[slot] && entry.occupants[slot] !== pawn.id) {
            this._sleepLog(session, "That spot is taken");
            return false;
        }
        if (pawn._resting) this._wakePawn(session, pawn, { moving: true });
        pawn._restWalk = { uid: entry.uid, slot };
        pawn.lastSleep = { uid: entry.uid, slot, rot: entry.rot };
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (c) {
            c._restWalk = pawn._restWalk;
            c.lastSleep = pawn.lastSleep;
        }
        if (opts.autofill) this._autofillInjured(session, entry);
        return true;
    }

    _autofillInjured(session, originEntry) {
        const ox = originEntry.x;
        const oy = originEntry.y;
        const taken = new Set();
        for (const p of this.players.values()) {
            for (const pawn of this._livingPartyOf(p)) {
                if (pawn._restWalk) taken.add(`${pawn._restWalk.uid}:${pawn._restWalk.slot}`);
            }
        }
        const slots = [];
        for (const c of this._chunksNear(ox, oy, 2)) {
            if (!Array.isArray(c.things)) continue;
            for (const e of c.things) {
                if (!this._isSleepEntry(e)) continue;
                Place.ensureSleepEntry(e, this._sleepDef(e));
                if (!Sleep.inCampRange(ox, oy, e.x, e.y, TS)) continue;
                const n = Sleep.slotCount(this._sleepDef(e), e);
                for (let i = 0; i < n; i++) {
                    const key = `${e.uid}:${i}`;
                    if (e.occupants[i] || taken.has(key)) continue;
                    slots.push({ entry: e, slot: i });
                    taken.add(key);
                }
            }
        }
        const injured = this._livingPartyOf(session).filter((p) => {
            if (p === session && session.controlId && p.id === session.controlId) return false;
            const control = this._actionPawn(session, { pawnId: session.controlId });
            if (p === control) return false;
            if (p._resting || p._restWalk) return false;
            const c = p.creature || this.creatures.get(p.id);
            if (c?.isIncapacitated?.() || c?.isImmobile?.() || p.prone) return false;
            return Sleep.injuredForAutofill(c?.anatomy);
        });
        for (const pawn of injured) {
            const next = slots.shift();
            if (!next) break;
            this._orderRest(session, pawn, next.entry, next.slot, { autofill: false });
        }
    }

    _occupySlot(session, pawn, entry, slot) {
        if (!pawn || !entry) return false;
        Place.ensureSleepEntry(entry, this._sleepDef(entry));
        if (entry.occupants[slot] && entry.occupants[slot] !== pawn.id) {
            this._sleepLog(session, "That spot is taken");
            pawn._restWalk = null;
            return false;
        }
        this._vacatePawn(pawn);
        entry.occupants[slot] = pawn.id;
        pawn._restWalk = null;
        pawn._resting = true;
        pawn.lastSleep = { uid: entry.uid, slot, rot: entry.rot };
        const def = this._sleepDef(entry);
        const pos = Sleep.sleeperWorldPos(entry, slot, TS, def);
        pawn.x = pos.x;
        pawn.y = pos.y;
        pawn.vx = 0;
        pawn.vy = 0;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (c) {
            c.x = pos.x;
            c.y = pos.y;
            c.vx = 0;
            c.vy = 0;
            c.setDesiredVel?.(0, 0);
            c._resting = true;
            c._restWalk = null;
            c.lastSleep = pawn.lastSleep;
            c._prone = true;
        }
        const found = this._findSleepByUid(entry.uid, pawn);
        if (found) this._emitStorage(found.chunk, entry);
        this._applyRestClock();
        this._dirtyPawnOwner(pawn);
        return true;
    }

    _wakePawn(session, pawn, opts = {}) {
        if (!pawn) return;
        const last = pawn.lastSleep;
        this._vacatePawn(pawn);
        pawn._resting = false;
        pawn._restWalk = null;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (c) {
            c._resting = false;
            c._restWalk = null;
            if (!(c.isImmobile?.() || c.isIncapacitated?.())) c._prone = false;
        }
        const found = last?.uid ? this._findSleepByUid(last.uid, pawn) : null;
        if (found?.entry) {
            const pos = Sleep.besideWorldPos(found.entry, TS, this._sleepDef(found.entry));
            pawn.x = pos.x;
            pawn.y = pos.y;
            pawn.vx = 0;
            pawn.vy = 0;
            if (c) {
                c.x = pos.x;
                c.y = pos.y;
                c.vx = 0;
                c.vy = 0;
                c.setDesiredVel?.(0, 0);
            }
        }
        if (opts.help) {
            pawn._wokeFromRest = true;
            if (c) c._wokeFromRest = true;
        }
        if (opts.manual) {
            pawn._wokeFromRest = false;
            if (c) c._wokeFromRest = false;
        }
        this._applyRestClock();
        this._dirtyPawnOwner(pawn);
    }

    _sleepWake(session, action) {
        const pawn = this._actionPawn(session, action);
        if (!pawn || !pawn._resting) return;
        this._wakePawn(session, pawn, { manual: true });
    }

    _sleepDestroy(session, action) {
        const pawn = this._actionPawn(session, action);
        if (!pawn || pawn.dead) return;
        const found = this._findSleepByUid(action.uid, pawn);
        if (!found) return;
        const { chunk, entry } = found;
        const def = this._sleepDef(entry);
        if (!Sleep.isEmpty(entry)) return;
        if (!Sleep.inHarvestRange(pawn.x, pawn.y, entry, TS, HARVEST_RANGE_TILES, def)) return;
        this._cancelRestWalksTo(entry.uid);
        const itemId = Place.itemIdForThing(entry.id, itemDefs());
        const itemDef = itemDefs().get(itemId);
        const stacks = Sleep.salvageStacks(itemDef?.recipe, () => this.rng());
        const tiles = Place.entryFootprintTiles(entry, TS, def);
        const piles = Sleep.scatterSalvagePiles(stacks, tiles, TS, () => this.rng());
        for (const pile of piles) {
            this._pushDrop(pile.x, pile.y, { id: pile.id, quantity: pile.quantity });
        }
        const i = chunk.things.indexOf(entry);
        if (i >= 0) chunk.things.splice(i, 1);
        this._emitStorageRemoved(chunk, entry);
    }

    _stepRestWalk(session, pawn, dt) {
        const spec = pawn._restWalk;
        if (!spec) return;
        const found = this._findSleepByUid(spec.uid, pawn);
        if (!found) {
            pawn._restWalk = null;
            this._sleepLog(session, `${pawn.name || "They"} can't rest there`);
            return;
        }
        const { entry } = found;
        const def = this._sleepDef(entry);
        const pos = Sleep.sleeperWorldPos(entry, spec.slot, TS, def);
        const cx = Number(pawn.x) + TS * 0.5;
        const cy = Number(pawn.y) - TS * 0.5;
        const d = Math.hypot(cx - pos.x, cy - pos.y);
        const arrive = Sleep.ARRIVE_PX || 16;
        if (d < arrive) {
            this._occupySlot(session, pawn, entry, spec.slot);
            return;
        }
        const controlId = session.controlId || session.id;
        if (pawn.id === controlId) return;
        // Uncontrolled rest-walk is PartyAI._walkToward (same as SP).
    }

    _tickSleepWalks(dtMs) {
        const dt = dtMs / 1000;
        for (const session of this.players.values()) {
            if (!session.connected) continue;
            for (const pawn of this._livingPartyOf(session)) {
                if (pawn._restWalk) this._stepRestWalk(session, pawn, dt);
                else if (pawn._resting) {
                    pawn.vx = 0;
                    pawn.vy = 0;
                    const c = pawn.creature || this.creatures.get(pawn.id);
                    if (c) {
                        c.vx = 0;
                        c.vy = 0;
                        c.setDesiredVel?.(0, 0);
                        c._resting = true;
                    }
                } else if (pawn._wokeFromRest) {
                    const assist = pawn.creature?.ai?.assistTarget;
                    if (!assist && !this._shouldDelaySleep(session, pawn)) {
                        this._tryReturnToBed(session, pawn);
                    }
                }
            }
        }
    }

    _sleepSlotClaimed(entry, slot, exceptId) {
        if (!entry) return true;
        const occ = entry.occupants?.[slot];
        if (occ && occ !== exceptId) return true;
        for (const p of this.players.values()) {
            for (const pawn of this._livingPartyOf(p)) {
                if (pawn.id === exceptId) continue;
                if (pawn._restWalk?.uid === entry.uid && pawn._restWalk.slot === slot) return true;
            }
        }
        for (const rec of this.settlers || []) {
            if (!rec || rec.id === exceptId || rec.dead) continue;
            if (rec._restWalk?.uid === entry.uid && rec._restWalk.slot === slot) return true;
            if ((rec._resting || rec.resting)
                && rec.lastSleep?.uid === entry.uid
                && (rec.lastSleep.slot || 0) === slot) {
                return true;
            }
        }
        return false;
    }

    _tryInjuredRest(session, pawn) {
        if (!session || !pawn || pawn._resting || pawn._restWalk || pawn._wokeFromRest) return;
        const controlId = session.controlId || session.id;
        if (pawn.id === controlId) return;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (!Sleep.injuredForAutofill(c?.anatomy)) return;
        if (c?.isIncapacitated?.() || c?.isImmobile?.() || pawn.prone) return;
        if (c?.ai?.assistTarget) return;
        if (c?._tending || c?.ai?.tendSeek) return;
        if (this._partyNeedsAutoTend(session)) return;
        if (session.lastHitMob && Date.now() - (Number(session.lastHitAt) || 0) < 8000) return;
        const control = this._actionPawn(session, { pawnId: controlId });
        if (control && Math.hypot(control.vx || 0, control.vy || 0) > 8) return;
        this._tryReturnToBed(session, pawn);
    }

    _tryReturnToBed(session, pawn) {
        if (!pawn || pawn._resting || pawn._restWalk) return;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (!Sleep.capableToFight(c || pawn)) {
            pawn._wokeFromRest = false;
            return;
        }
        const last = pawn.lastSleep;
        let entry = null;
        let slot = 0;
        if (last?.uid) {
            const found = this._findSleepByUid(last.uid, pawn);
            entry = found?.entry || null;
            slot = last.slot || 0;
            if (entry && this._sleepSlotClaimed(entry, slot, pawn.id)) entry = null;
        }
        if (!entry) {
            let best = null;
            let bestD = Infinity;
            for (const ch of this._chunksNear(pawn.x, pawn.y, 2)) {
                if (!Array.isArray(ch.things)) continue;
                for (const e of ch.things) {
                    if (!this._isSleepEntry(e)) continue;
                    Place.ensureSleepEntry(e, this._sleepDef(e));
                    if (!Sleep.inCampRange(pawn.x, pawn.y, e.x, e.y, TS)) continue;
                    const n = Sleep.slotCount(this._sleepDef(e), e);
                    for (let i = 0; i < n; i++) {
                        if (this._sleepSlotClaimed(e, i, pawn.id)) continue;
                        const d = Math.hypot(pawn.x - e.x, pawn.y - e.y);
                        if (d < bestD) {
                            bestD = d;
                            best = { entry: e, slot: i };
                        }
                    }
                }
            }
            if (best) {
                entry = best.entry;
                slot = best.slot;
            }
        }
        pawn._wokeFromRest = false;
        if (entry) this._orderRest(session, pawn, entry, slot, { autofill: false });
    }

    _everyoneLying() {
        const sessions = [...this.players.values()].filter((p) => p.connected);
        if (!sessions.length) return false;
        for (const p of sessions) {
            for (const pawn of this._livingPartyOf(p)) {
                if (!pawn._resting) return false;
            }
        }
        return true;
    }

    _applyRestClock() {
        const base = Number.isFinite(this.baseTickSpeed) ? this.baseTickSpeed : (this.tickSpeed || 1);
        this.baseTickSpeed = base;
        this.tickSpeed = Sleep.effectiveTickSpeed(base, this._everyoneLying());
    }

    _sleepLiveIds() {
        const ids = new Set();
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            if (!p.dead) ids.add(p.id);
            for (const m of p.party || []) {
                if (m && !m.dead) ids.add(m.id);
            }
        }
        for (const s of this.settlers || []) {
            if (s && !s.dead && s.id) ids.add(s.id);
        }
        return ids;
    }

    _sanitizeSleepOccupants() {
        const live = this._sleepLiveIds();
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isSleepEntry(t) || !Array.isArray(t.occupants)) continue;
                let changed = false;
                for (let i = 0; i < t.occupants.length; i++) {
                    const id = t.occupants[i];
                    if (id && !live.has(id)) {
                        t.occupants[i] = null;
                        changed = true;
                    }
                }
                if (changed) this._emitStorage(c, t);
            }
        }
    }

    _onSleepCombatHit(victimCreature, attacker) {
        if (!victimCreature || victimCreature.isBodyDead?.()) return;
        if (attacker && Party.sameFaction?.(victimCreature, attacker)) return;
        if (!attacker || attacker === victimCreature) return;
        const victim = this._findOwnedPawn(victimCreature.id);
        if (!victim) return;
        const session = this._sessionOfPawn(victim);
        this._wakeAbleResters(session, attacker, victim);
        if (!victim._resting) victimCreature.ai?.setAssist?.(attacker);
    }

    _wakeAbleResters(session, enemy, origin) {
        if (!session || !enemy || enemy.isBodyDead?.()) return;
        const from = origin || session;
        const camp = Sleep.CAMP_TILES * TS;
        const ox = Number(from.x) || 0;
        const oy = Number(from.y) || 0;
        for (const p of this._livingPartyOf(session)) {
            if (!p._resting) continue;
            const pc = p.creature || this.creatures.get(p.id);
            if (!Sleep.capableToFight(pc || p)) continue;
            if (Math.hypot(p.x - ox, p.y - oy) > camp) continue;
            this._wakePawn(session, p, { help: true });
            pc?.ai?.setAssist?.(enemy);
        }
        session.lastHitMob = enemy;
        session.lastHitAt = Date.now();
    }

    _findSleepByOccupant(pawnId) {
        if (!pawnId) return null;
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isSleepEntry(t) || !Array.isArray(t.occupants)) continue;
                const slot = t.occupants.indexOf(pawnId);
                if (slot >= 0) return { chunk: c, entry: t, slot };
            }
        }
        return null;
    }

    _clearPawnRest(pawn) {
        if (!pawn) return;
        pawn._resting = false;
        pawn._restWalk = null;
        pawn._joinRestHint = false;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (c) {
            c._resting = false;
            c._restWalk = null;
        }
    }

    _restorePawnSleep(session, pawn) {
        if (!pawn) return;
        const pose = this.poses?.[pawn.id];
        const byOcc = this._findSleepByOccupant(pawn.id);
        let found = byOcc;
        let slot = byOcc?.slot || 0;
        const hint = pose?.lastSleep || pawn.lastSleep;
        const tryUid = !!(byOcc || pose?.resting || pawn._joinRestHint || pawn._resting);
        if (!found && tryUid && hint?.uid) {
            found = this._findSleepByUid(hint.uid, pawn);
            slot = hint.slot || 0;
        }
        if (found?.entry) {
            if (!Sleep.isSlotOccupied(found.entry, slot) || found.entry.occupants[slot] === pawn.id) {
                this._occupySlot(session, pawn, found.entry, slot);
                pawn._joinRestHint = false;
                return;
            }
            const pos = Sleep.besideWorldPos(found.entry, TS, this._sleepDef(found.entry));
            pawn.x = pos.x;
            pawn.y = pos.y;
        }
        this._clearPawnRest(pawn);
    }

    _findPlayerStorage(p, action = {}) {
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
                if (!this._isPlaceableEntry(t) || this._isSleepEntry(t)) continue;
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

    _storageGetSlot(entry, key) {
        const def = thingDefs().get(entry?.id);
        Place.ensureStorageEntry(entry, def);
        const idx = Place.parseSlotIndex(key, entry.slots.length);
        if (idx < 0) return undefined;
        return entry.slots[idx] || null;
    }

    _storageSetSlot(entry, key, stack) {
        const def = thingDefs().get(entry?.id);
        Place.ensureStorageEntry(entry, def);
        const idx = Place.parseSlotIndex(key, entry.slots.length);
        if (idx < 0) return;
        entry.slots[idx] = stack || null;
    }

    _tryStorage(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const found = this._findPlayerStorage(p, action);
        if (!found) return;
        const { chunk, entry } = found;
        const def = thingDefs().get(entry.id);
        const op = String(action.op || "");
        if (op === "attend" || op === "leave") return;
        if (def?.craftStation) {
            if (op !== "pickup") return;
            const itemId = Place.itemIdForThing(entry.id, itemDefs());
            const leftover = this._give(p, itemId, 1);
            if (leftover > 0) {
                this._pushDrop(p.x, p.y, { id: itemId, quantity: leftover });
            }
            this._unlinkStationUid(entry.uid);
            const i = chunk.things.indexOf(entry);
            if (i >= 0) chunk.things.splice(i, 1);
            this._emitStorageRemoved(chunk, entry);
            this._dirtyPawnOwner(p);
            return;
        }
        Place.ensureStorageEntry(entry, def);
        if (op === "pickup") {
            if (!Place.isStorageEmpty(entry)) return;
            const itemId = Place.itemIdForThing(entry.id, itemDefs());
            const leftover = this._give(p, itemId, 1);
            if (leftover > 0) {
                this._pushDrop(p.x, p.y, { id: itemId, quantity: leftover });
            }
            this._unlinkStationUid(entry.uid);
            const i = chunk.things.indexOf(entry);
            if (i >= 0) chunk.things.splice(i, 1);
            this._emitStorageRemoved(chunk, entry);
            this._dirtyPawnOwner(p);
            return;
        }
        if (op === "inv_to_slot") this._storageInvToSlot(p, entry, action);
        else if (op === "slot_to_inv") this._storageSlotToInv(p, entry, action);
        else if (op === "slot_to_slot") this._storageSlotToSlot(entry, action);
        else return;
        this._emitStorage(chunk, entry);
        this._youDirty.add(p.id);
    }

    _hangIfRack(entry, stack) {
        if (!stack) return stack;
        const def = thingDefs().get(entry?.id);
        if (!Hide.isDryingRack(def, entry)) return stack;
        return Hide.hangStack(stack, this.worldMinuteIndex(), (id) => itemDefs().get(id));
    }

    _storageInvToSlot(p, entry, action) {
        const slotKey = String(action.slot ?? "");
        const dest = this._storageGetSlot(entry, slotKey);
        if (dest === undefined) return;
        const invIndex = Math.floor(Number(action.inv));
        const bag = this._normBag(action.bag);
        const held = this._pawnBag(p, bag)?.[invIndex];
        if (!held?.id) return;
        const thingDef = thingDefs().get(entry.id);
        const meta = itemDefs().get(held.id);
        if (!Hide.slotAccepts(thingDef, meta)) return;
        let amount = Math.max(1, Math.floor(Number(action.amount) || held.quantity || 1));
        const slotMax = Hide.slotMax(thingDef);
        if (slotMax > 0) amount = Math.min(amount, slotMax);
        const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));

        if (!dest) {
            const piece = this._splitInvToWorld(p, invIndex, amount, bag);
            if (piece) this._storageSetSlot(entry, slotKey, this._hangIfRack(entry, piece));
            return;
        }
        if (dest.id === held.id && !this._stackIsSpecial(dest) && !this._stackIsSpecial(held)) {
            let space = Math.max(0, maxStack - (dest.quantity || 1));
            if (slotMax > 0) space = Math.min(space, Math.max(0, slotMax - (dest.quantity || 1)));
            const take = Math.min(space, amount, held.quantity || 1);
            if (!(take > 0)) return;
            const piece = this._splitInvToWorld(p, invIndex, take, bag);
            if (!piece) return;
            dest.spoilAt = Spoil.mergeSpoilAt(
                dest.quantity || 1, dest.spoilAt,
                piece.quantity, piece.spoilAt
            );
            Hide.applyMergedDryProgress(dest, dest.quantity || 1, piece.quantity, piece.dryProgress);
            Hide.applyMergedSoakProgress(dest, dest.quantity || 1, piece.quantity, piece.soakProgress);
            Fire.applyMergedStackTemp(dest, dest.quantity || 1, piece.quantity, piece.temp);
            dest.quantity = (dest.quantity || 1) + piece.quantity;
            this._storageSetSlot(entry, slotKey, this._hangIfRack(entry, dest));
            return;
        }
        if (amount < (held.quantity || 1)) return;
        if (slotMax > 0 && (held.quantity || 1) > slotMax) return;
        const incoming = this._splitInvToWorld(p, invIndex, held.quantity, bag);
        if (!incoming) return;
        if (!this._returnWorldToInv(p, dest, invIndex, bag)) {
            this._pawnBag(p, bag)[invIndex] = this._worldStackToInv(incoming);
            this._youDirty.add(p.id);
            return;
        }
        this._storageSetSlot(entry, slotKey, this._hangIfRack(entry, incoming));
    }

    _worldStackToInv(worldStack) {
        const now = this.worldMinuteIndex();
        const slot = {
            id: worldStack.id,
            quantity: Math.max(1, Math.floor(Number(worldStack.quantity) || 1))
        };
        this._applyStackExtras(slot, this._stackExtrasFrom(worldStack));
        const left = Spoil.spoilLeftForCharacter(worldStack, now);
        if (left != null) slot.spoilLeft = left;
        delete slot.spoilAt;
        return slot;
    }

    _storageSlotToInv(p, entry, action) {
        const slotKey = String(action.slot ?? "");
        const stack = this._storageGetSlot(entry, slotKey);
        if (!stack?.id) return;
        const amount = Math.max(1, Math.floor(Number(action.amount) || stack.quantity || 1));
        const take = Math.min(amount, stack.quantity || 1);
        const piece = this._cloneStackForWorld({ ...stack, quantity: take });
        const prefer = Math.floor(Number(action.inv));
        const dest = action.toPawnId ? this._partyGiveDest(p, action, p) : p;
        if (action.toPawnId && !dest) return;
        if (action.toPawnId) {
            const left = this._giveOwnedStack(dest, piece);
            const taken = take - left;
            if (!(taken > 0)) return;
            stack.quantity = (stack.quantity || 1) - taken;
            this._storageSetSlot(entry, slotKey, stack.quantity > 0 ? stack : null);
            return;
        }
        if (!this._returnWorldToInv(p, piece, prefer, this._normBag(action.bag))) return;
        stack.quantity = (stack.quantity || 1) - take;
        this._storageSetSlot(entry, slotKey, stack.quantity > 0 ? stack : null);
    }

    _storageSlotToSlot(entry, action) {
        const fromKey = String(action.from ?? "");
        const toKey = String(action.to ?? "");
        if (fromKey === toKey) return;
        const a = this._storageGetSlot(entry, fromKey);
        if (!a?.id) return;
        const b = this._storageGetSlot(entry, toKey);
        if (b === undefined) return;
        if (!b) {
            this._storageSetSlot(entry, toKey, a);
            this._storageSetSlot(entry, fromKey, null);
            return;
        }
        if (a.id === b.id && !this._stackIsSpecial(a) && !this._stackIsSpecial(b)) {
            const meta = itemDefs().get(a.id);
            const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
            const space = Math.max(0, maxStack - (b.quantity || 1));
            if (space <= 0) {
                this._storageSetSlot(entry, fromKey, b);
                this._storageSetSlot(entry, toKey, a);
                return;
            }
            const moved = Math.min(space, a.quantity || 1);
            b.spoilAt = Spoil.mergeSpoilAt(b.quantity || 1, b.spoilAt, moved, a.spoilAt);
            Hide.applyMergedDryProgress(b, b.quantity || 1, moved, a.dryProgress);
            Hide.applyMergedSoakProgress(b, b.quantity || 1, moved, a.soakProgress);
            Fire.applyMergedStackTemp(b, b.quantity || 1, moved, a.temp);
            b.quantity = (b.quantity || 1) + moved;
            a.quantity = (a.quantity || 1) - moved;
            this._storageSetSlot(entry, toKey, b);
            this._storageSetSlot(entry, fromKey, a.quantity > 0 ? a : null);
            return;
        }
        this._storageSetSlot(entry, fromKey, b);
        this._storageSetSlot(entry, toKey, a);
    }

    _campfireInvToSlot(p, entry, action) {
        const slotKey = String(action.slot || "");
        const parsed = this._parseCampfireSlot(slotKey);
        if (!parsed) return;
        const invIndex = Math.floor(Number(action.inv));
        const bag = this._normBag(action.bag);
        const held = this._pawnBag(p, bag)?.[invIndex];
        if (!held?.id) return;
        const meta = itemDefs().get(held.id);
        const dest = this._campfireGetSlot(entry, slotKey);
        const qty = Math.max(1, Math.floor(Number(held.quantity) || 1));
        let want = Math.floor(Number(action.amount));
        if (!Number.isFinite(want) || want < 1) want = qty;

        if (parsed.kind === "fuel") {
            if (!meta?.fuel) return;
            if (!dest) {
                const piece = this._splitInvToWorld(p, invIndex, Math.min(want, qty), bag);
                if (piece) this._campfireSetSlot(entry, slotKey, piece);
                return;
            }
            if (dest.id === held.id && !this._stackIsSpecial(dest) && !this._stackIsSpecial(held)) {
                const maxStack = Math.max(1, Math.floor(Number(meta.maxStack) || 99));
                const space = Math.max(0, maxStack - (dest.quantity || 1));
                const moved = Math.min(space, want, qty);
                if (!(moved > 0)) return;
                const piece = this._splitInvToWorld(p, invIndex, moved, bag);
                if (!piece) return;
                dest.spoilAt = Spoil.mergeSpoilAt(
                    dest.quantity || 1, dest.spoilAt,
                    piece.quantity, piece.spoilAt
                );
                Hide.applyMergedDryProgress(dest, dest.quantity || 1, piece.quantity, piece.dryProgress);
                Hide.applyMergedSoakProgress(dest, dest.quantity || 1, piece.quantity, piece.soakProgress);
                Fire.applyMergedStackTemp(dest, dest.quantity || 1, piece.quantity, piece.temp);
                dest.quantity = (dest.quantity || 1) + piece.quantity;
                this._campfireSetSlot(entry, slotKey, dest);
                return;
            }
            if (want < qty) return;
            const incoming = this._splitInvToWorld(p, invIndex, qty, bag);
            if (!incoming) return;
            this._campfireSetSlot(entry, slotKey, incoming);
            this._returnWorldToInv(p, dest, invIndex, bag);
            return;
        }

        if (parsed.kind === "catalyst") {
            if (!meta?.cook?.method) return;
            if (dest && this._campfireCatalystLocked(entry)) return;
            if (dest && dest.id === held.id) return;
            const incoming = this._splitInvToWorld(p, invIndex, 1, bag);
            if (!incoming) return;
            this._campfireSetSlot(entry, slotKey, incoming);
            if (dest) this._returnWorldToInv(p, dest, invIndex, bag);
            return;
        }

        if (parsed.kind === "cook") {
            if (!this._campfireCookOpen(entry)) return;
            if (!this._campfireCookAccepts(entry, held.id)) return;
            if (dest && dest.id === held.id) return;
            const incoming = this._splitInvToWorld(p, invIndex, 1, bag);
            if (!incoming) return;
            this._campfireSetSlot(entry, slotKey, incoming);
            if (dest) this._returnWorldToInv(p, dest, invIndex, bag);
            return;
        }

        if (parsed.kind === "simmer") {
            if (!this._campfireSimmerOpen(entry)) return;
            if (this._campfireMethod(entry) !== "shell_simmer") return;
            if (!this._isSimmerIngredient(held.id)) return;
            if (dest) return;
            const incoming = this._splitInvToWorld(p, invIndex, 1, bag);
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
        const dest = action.toPawnId ? this._partyGiveDest(p, action, p) : p;
        if (action.toPawnId && !dest) {
            stack.quantity = qty;
            this._campfireSetSlot(entry, slotKey, stack);
            return;
        }
        if (action.toPawnId) {
            const left = this._giveOwnedStack(dest, piece);
            if (left > 0) {
                stack.quantity = (stack.quantity || 0) + left;
                this._campfireSetSlot(entry, slotKey, stack);
            }
        } else {
            this._returnWorldToInv(p, piece, action.inv, this._normBag(action.bag));
        }
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
            if (!this._campfireCookAccepts(entry, a.id)) return;
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
            Hide.applyMergedDryProgress(b, b.quantity || 1, moved, a.dryProgress);
            Hide.applyMergedSoakProgress(b, b.quantity || 1, moved, a.soakProgress);
            Fire.applyMergedStackTemp(b, b.quantity || 1, moved, a.temp);
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

    _tryUse(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        if (p.eatChannel || this._pawnVomiting(p)) return;
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
        this.pushEvent({
            kind: "channel",
            playerId: this._sessionOfPawn(p)?.id || p.id,
            pawnId: p.id,
            channel: "eat",
            progress: 0
        });
        this._dirtyPawnOwner(p);
    }

    _creatureForPawn(session, pawn) {
        if (!pawn) return null;
        if (session && pawn.id === session.id) {
            return this._syncPlayerCreature(session) || this._ensurePlayerCreature(session);
        }
        if (session && (session.party || []).some((m) => m.id === pawn.id)) {
            return this._ensureCompanionCreature(session, pawn);
        }
        if (pawn.role === "settler" || pawn.homeSettlementId) {
            return this._ensureSettlerCreature(pawn);
        }
        return pawn.creature || this.creatures.get(pawn.id) || null;
    }

    /**
     * Finish a bandage channel (client runs the bar; server applies tend + consume).
     */
    _tryTend(p, action = {}) {
        if (!p || p.dead) return;
        const owned = this._ownedPawns(p);
        const findPawn = (id) => {
            if (!id) return null;
            return owned.find((m) => m.id === id) || this._findOwnedPawn(id);
        };
        const tender = findPawn(action.pawnId) || p;
        const patientPawn = findPawn(action.patientId) || tender;
        const from = findPawn(action.fromPawnId) || tender;
        const slot = Number.isInteger(Number(action.slot))
            ? Number(action.slot)
            : (from.hotbarIndex ?? tender.hotbarIndex ?? 0);
        const bag = this._normBag(action.bag);
        const controlId = p.controlId || p.id;
        const tenderIsYou = tender.id === controlId;
        const patientIsYou = patientPawn.id === controlId;
        const fromInv = this._pawnBag(from, bag);
        const held = fromInv?.[slot];
        const wantId = action.itemId ? String(action.itemId) : null;
        if (!held?.id || (wantId && held.id !== wantId)) {
            const who = tenderIsYou ? "You" : (tender.name || "They");
            const verb = tenderIsYou ? "need" : "needs";
            this.pushEvent({
                kind: "combat_log",
                text: `${who} ${verb} a bandage to finish tending`,
                to: p.id
            });
            return;
        }
        const meta = itemDefs().get(held.id);
        if (!meta?.bandage) {
            const who = tenderIsYou ? "You" : (tender.name || "They");
            const verb = tenderIsYou ? "need" : "needs";
            this.pushEvent({
                kind: "combat_log",
                text: `${who} ${verb} a bandage to finish tending`,
                to: p.id
            });
            return;
        }

        const patientCreature = this._creatureForPawn(p, patientPawn);
        if (!patientCreature?.anatomy) return;

        const parseHint = (src) => ({
            partName: src?.partName ? String(src.partName) : null,
            injuryIndex: Number.isInteger(Number(src?.injuryIndex))
                ? Number(src.injuryIndex)
                : -1,
            inj: {
                id: src?.injuryId != null ? src.injuryId : undefined,
                name: src?.injuryName ? String(src.injuryName) : undefined,
                severity: Number(src?.injurySeverity)
            },
            destroyedPartName: src?.destroyedPartName
                ? String(src.destroyedPartName)
                : null,
            hediffId: src?.hediffId ? String(src.hediffId) : null
        });
        const rawHints = Array.isArray(action.targets) && action.targets.length
            ? action.targets
            : [action];
        const hints = rawHints.map(parseHint);
        const hinted = hints.some((h) => h.partName || h.inj.id != null || h.inj.name || h.destroyedPartName || h.hediffId);
        const applied = [];
        for (const hint of hints) {
            const t = BodyHealing.resolveTendTarget?.(patientCreature.anatomy, hint);
            if (t) applied.push(t);
        }
        if (!applied.length && !hinted) {
            const batch = BodyHealing.pickTendTargets?.(patientCreature.anatomy, {
                batchSeverity: Number(meta.bandage.batchSeverity)
            }) || [];
            applied.push(...batch);
        }
        if (!applied.length) {
            const healer = tenderIsYou ? "you" : (tender.name || "they");
            this.pushEvent({
                kind: "combat_log",
                text: `The wound healed before ${healer} finished`,
                to: p.id
            });
            this._youDirty.add(p.id);
            return;
        }

        const quality = BodyHealing.rollTendQuality(
            Number(meta.bandage.tendQuality) || 0.4,
            Number(meta.bandage.tendQualityMax) || 0.7,
            undefined,
            { selfTend: tender.id === patientPawn.id }
        );
        for (const t of applied) BodyHealing.applyTend(patientCreature.anatomy, t, quality);

        held.quantity = Math.max(0, Math.floor(Number(held.quantity) || 1) - 1);
        if (!(held.quantity > 0)) fromInv[slot] = null;

        patientPawn.body = patientCreature.anatomy.toJSON();
        patientCreature.anatomy._dirty = false;
        this._youDirty.add(p.id);

        const who = tenderIsYou ? "You" : (tender.name || "Someone");
        const poss = patientIsYou
            ? "your"
            : (patientPawn.name ? `${patientPawn.name}'s` : "their");
        const text = BodyHealing.tendLogLine?.(who, poss, quality, applied, patientCreature.anatomy)
            || `${who} finished bandaging (${Math.round(quality * 100)}%)`;
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
        const from = (ch.fromId && this._findOwnedPawn(ch.fromId)) || p;
        const idx = ch.slot ?? ch.itemIndex ?? from.hotbarIndex ?? 0;
        const bag = this._normBag(ch.bag);
        const inv = this._pawnBag(from, bag);
        const held = inv?.[idx];
        if (!held) return;
        const food = this._foodForEat(held);
        const total = Number(food.kc) || 0;
        if (!(total > 0)) return;
        const room = Math.max(0, (Number(p.stomach) || 0) - (Number(p.kc) || 0));
        const isMeal = ch.isMeal || this._isPartialFood(held);

        if (isMeal) {
            const consumed = Math.min(total, room);
            if (!(consumed > 0)) {
                this._dirtyPawnOwner(p);
                return;
            }
            p.kc += consumed;
            p.saturation += consumed * this._satietyRatio(food, true);
            this._tryFoodPoison(p, food);
            if (consumed < total) {
                if (!held.food) held.food = { ...food };
                if (held.food.kcFull == null) held.food.kcFull = Math.round(total);
                held.food.kc = Math.max(0, Math.round(total - consumed));
                if (!(held.food.kc > 0)) inv[idx] = null;
            } else {
                held.quantity = (held.quantity || 1) - 1;
                if (!(held.quantity > 0)) inv[idx] = null;
            }
        } else {
            p.kc += Math.min(total, room);
            p.saturation += total * this._satietyRatio(food, false);
            this._tryFoodPoison(p, food);
            held.quantity = (held.quantity || 1) - 1;
            if (!(held.quantity > 0)) inv[idx] = null;
        }
        this._dirtyPawnOwner(p);
        const session = this._sessionOfPawn(p);
        this.pushEvent({
            kind: "channel",
            playerId: session?.id || p.id,
            pawnId: p.id,
            channel: "eat",
            progress: 1,
            done: true
        });
    }

    _findOwnedPawn(id) {
        if (!id) return null;
        for (const pl of this.players.values()) {
            if (pl.id === id) return pl;
            const m = (pl.party || []).find((x) => x.id === id);
            if (m) return m;
        }
        return (this.settlers || []).find((s) => s && s.id === id) || null;
    }

    _sessionOfPawn(pawn) {
        if (!pawn) return null;
        if (this.players.has(pawn.id)) return this.players.get(pawn.id);
        for (const pl of this.players.values()) {
            if ((pl.party || []).some((m) => m.id === pawn.id)) return pl;
        }
        const ownerId = pawn.ownerId
            || (this.settlers || []).find((s) => s && (s === pawn || s.id === pawn.id))?.ownerId;
        if (ownerId && this.players.has(ownerId)) return this.players.get(ownerId);
        return null;
    }

    _dirtyPawnOwner(pawn) {
        const session = this._sessionOfPawn(pawn);
        if (session) this._youDirty.add(session.id);
    }

    _tryFoodPoison(p, food) {
        let creature = p.creature || this.creatures.get(p.id);
        if (!creature) {
            const session = this._sessionOfPawn(p);
            creature = session
                ? (this._syncPlayerCreature(session) || this._ensurePlayerCreature(session))
                : null;
        }
        if (!creature?.anatomy) return;
        const session = this._sessionOfPawn(p);
        const you = !!(session && (session.controlId || session.id) === p.id);
        const result = Hediffs.tryFoodPoison(
            creature.anatomy,
            food,
            null,
            () => this.rng(),
            {
                isControlled: () => you,
                displayName: () => p.name || creature.displayName?.() || "Someone"
            }
        );
        if (!result) return;
        p.body = creature.anatomy.toJSON();
        creature.anatomy._dirty = false;
        this.pushEvent({ kind: "combat_log", text: result.message, to: session?.id || p.id });
    }

    _pawnRecordForCreature(p, creature) {
        if (!p || !creature) return null;
        if (creature === p.creature || creature.id === p.id) return p;
        return (p.party || []).find((m) => m.id === creature.id) || null;
    }

    _tryAttack(p, angle, pawnId = null) {
        const actor = this._actionPawn(p, { pawnId });
        if (!actor || actor.dead || actor._resting) return;
        if (actor.eatChannel || this._pawnVomiting(actor)) return;
        let creature = actor === p
            ? (this._syncPlayerCreature(p) || this._ensurePlayerCreature(p))
            : this._ensureCompanionCreature(p, actor);
        if (!creature || creature.isBodyDead()) return;
        let ang = Number(angle);
        if (!Number.isFinite(ang)) ang = 0;
        // Client autofire often arrives a few ms before the server swing ends (RTT).
        // Queue one pending strike on THIS pawn instead of dropping the input.
        if (creature.isAttacking()) {
            creature.pendingAttackAngle = ang;
            return;
        }
        this._beginPlayerAttack(p, creature, ang);
    }

    _beginPlayerAttack(p, creature, angle) {
        if (!creature?.startMeleeAttack?.(angle)) return false;
        creature.pendingAttackAngle = null;
        const rec = this._pawnRecordForCreature(p, creature);
        const art = creature.attackArt || { unarmed: true, range: 4, max: creature.attackMax };
        if (rec === p) {
        p.pendingAttackAngle = null;
        p.attackTimer = creature.attackTimer;
        p.attackMax = creature.attackMax;
        p.attackAngle = creature.attackAngle;
        p.facing = creature.facing;
            p.attackArt = art;
        } else if (rec) {
            rec.attackTimer = creature.attackTimer;
            rec.attackMax = creature.attackMax;
            rec.attackAngle = creature.attackAngle;
            rec.facing = creature.facing || rec.facing;
            rec.attackArt = art;
        }
        const pose = rec || p;
        this.pushEvent({
            kind: "attack",
            playerId: p.id,
            pawnId: creature.id,
            x: pose.x,
            y: pose.y,
            angle,
            facing: creature.facing || pose.facing,
            art
        });
        return true;
    }

    /** Start a queued autofire swing once the current one ends. */
    _flushPendingAttack(p, creature) {
        if (!p || !creature) return;
        const rec = this._pawnRecordForCreature(p, creature);
        if (!rec || rec.dead) return;
        if (rec === p && (p.dead || p.eatChannel || this._isVomiting(p))) return;
        if (creature.pendingAttackAngle == null) return;
        if (creature.isBodyDead() || creature.isAttacking()) return;
        const ang = creature.pendingAttackAngle;
        creature.pendingAttackAngle = null;
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
        this._clearVomit(p);
        p.pendingAttackAngle = null;
        const creature = p.creature || this.creatures.get(p.id);
        if (creature) {
            creature.pendingAttackAngle = null;
            creature._dead = true;
            creature.active = false;
            creature._endAttack?.();
            if (creature.anatomy) p.body = creature.anatomy.toJSON();
        }
        if (!alreadyDead) {
            this._vacatePawn(p);
            this._applyRestClock();
            if (killer) {
                this._applyApparelDeathWear(p);
            }
            const loot = [];
            for (const key of ["head", "torso", "legs", "feet", "back"]) {
                const s = p.equipment?.[key];
                if (s) loot.push(this._cloneStackForWorld(s));
            }
            for (const s of p.equipment?.waist || []) {
                if (s) loot.push(this._cloneStackForWorld(s));
            }
            for (const s of p.overflow || []) {
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
                mobId: "human",
                playerCorpse: true
            });
        }
        // Empty gear so YOU cannot restore dumped loot after death.
        p.inventory = emptyInv(5);
        p.overflow = [];
        p.equipment = { head: null, torso: null, legs: null, feet: null, back: null, waist: [] };
        p.hotbarIndex = 0;
        if (creature) {
            creature.inventory = p.inventory;
            creature.equipment = p.equipment;
            creature.hotbarIndex = 0;
        }
        this._youDirty.add(p.id);
        if (alreadyDead) return;
        for (const m of p.party || []) {
            const cc = m.creature || this.creatures.get(m.id);
            if (cc) {
                cc.pendingAttackAngle = null;
                cc._endAttack?.();
            }
            m.attackTimer = 0;
            m.attackArt = null;
        }
        const killerName = this._killerLabel(killer);
        const msg = Protocol.deathMessage(p.name, killerName);
        this.pushEvent({ kind: "death", playerId: p.id, text: msg });
        this._clearPvpOwner(p.id);
        this.pushEvent({ kind: "chat", text: msg, system: true });
    }

    _killCompanion(owner, mem, killer) {
        if (!owner || !mem || mem.dead) return;
        mem.dead = true;
        mem.hp = 0;
        mem.eatChannel = null;
        mem.attackTimer = 0;
        mem.attackArt = null;
        const creature = mem.creature || this.creatures.get(mem.id);
        if (creature) {
            creature.pendingAttackAngle = null;
            creature._dead = true;
            creature.active = false;
            creature._endAttack?.();
            if (creature.anatomy) mem.body = creature.anatomy.toJSON();
        }
        if (killer) this._applyApparelDeathWear(mem);
        const loot = [];
        for (const key of ["head", "torso", "legs", "feet", "back"]) {
            const s = mem.equipment?.[key];
            if (s) loot.push(this._cloneStackForWorld(s));
        }
        for (const s of mem.equipment?.waist || []) {
            if (s) loot.push(this._cloneStackForWorld(s));
        }
        for (const s of mem.overflow || []) {
            if (s) loot.push(this._cloneStackForWorld(s));
        }
        for (const s of mem.inventory || []) {
            if (s) loot.push(this._cloneStackForWorld(s));
        }
        const c = creature?.bodyCenter?.() || { x: mem.x, y: mem.y - 8 };
        this._pushCorpse({
            x: c.x,
            y: c.y,
            key: "human",
            look: mem.look || null,
            frame: 7,
            name: mem.name || "Companion",
            loot: loot.filter(Boolean),
            body: mem.body || creature?.anatomy?.toJSON?.() || null,
            bodyPlan: "human",
            mobId: "human",
            playerCorpse: true
        });
        mem.inventory = emptyInv(5);
        mem.overflow = [];
        mem.equipment = { head: null, torso: null, legs: null, feet: null, back: null, waist: [] };
        mem.hotbarIndex = 0;
        this.creatures.delete(mem.id);
        mem.creature = null;
        const killerName = this._killerLabel(killer);
        const msg = Protocol.deathMessage(mem.name, killerName);
        this.pushEvent({
            kind: "party_death",
            playerId: owner.id,
            pawnId: mem.id,
            text: msg
        });
        this.pushEvent({ kind: "chat", text: msg, system: true });
        this._youDirty.add(owner.id);
    }

    _reapDeadCompanions() {
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            const remain = [];
            let changed = false;
            for (const m of p.party || []) {
                const cc = m.creature || this.creatures.get(m.id);
                if (m.dead || cc?.isBodyDead?.()) {
                    this._killCompanion(p, m, cc?._lastHitBy || null);
                    changed = true;
                    continue;
                }
                remain.push(m);
            }
            if (!changed) continue;
            p.party = remain;
            if (p.controlId !== p.id && !remain.some((m) => m.id === p.controlId)) {
                p.controlId = p.id;
            }
            this._youDirty.add(p.id);
        }
    }

    /** @param {number} dtMs */
    tick(dtMs) {
        const dt = dtMs / 1000;
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            if (p.attackTimer > 0) p.attackTimer -= dtMs;
            this._tickPlayerVomit(p, dtMs);
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
            for (const m of p.party || []) {
                if (!m?.eatChannel) continue;
                m.eatChannel.remaining -= dtMs;
                if (m.eatChannel.remaining <= 0) this._finishEat(m);
            }
            for (const m of p.party || []) {
                if (m && this._isVomiting(m)) this._tickPlayerVomit(m, dtMs);
            }
        }
        for (const rec of this.settlers || []) {
            if (!rec || rec.dead) continue;
            if (rec.eatChannel) {
                rec.eatChannel.remaining -= dtMs;
                if (rec.eatChannel.remaining <= 0) this._finishEat(rec);
            }
            if (rec._workChannel) SettlerWork.tickChannel(this, rec, dtMs);
            if (this._isVomiting(rec)) this._tickPlayerVomit(rec, dtMs);
        }
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            if (p.dead) {
                this._interestLoad(p.x, p.y, this.interestRadius(p));
                for (const m of p.party || []) {
                    if (Number.isFinite(m.x)) this._interestLoad(m.x, m.y, this.interestRadius(p));
            }
                continue;
            }
            this._interestLoad(p.x, p.y, this.interestRadius(p));
            for (const m of p.party || []) {
                if (Number.isFinite(m.x)) this._interestLoad(m.x, m.y, this.interestRadius(p));
            }
        }

        this._tickWandererDirector(dtMs);
        this._pinSettlements();
        this._tickCreatures(dtMs, dt);
        // Scale with /tick like the world clock (paused at 0×)
        this._tickDropDespawn(dtMs * (Number(this.tickSpeed) || 0));

        this._minuteAcc += dtMs * this.tickSpeed;
        while (this._minuteAcc >= 1000) {
            this._minuteAcc -= 1000;
            this._worldMinute();
        }
    }

    _sessionPartyCombat(session, uncontrolled) {
        if (this._chaseTarget(session)) return true;
        if (session.attackTimer > 0) return true;
        const control = this._actionPawn(session, { pawnId: session.controlId });
        if (control?.creature?.isAttacking?.()) return true;
        for (const row of uncontrolled || []) {
            const c = row.creature;
            if (!c) continue;
            if (c._resting || c._downed || c.isIncapacitated?.() || c.isImmobile?.()) continue;
            if (c.isAttacking?.()) return true;
            const t = c.ai?.assistTarget;
            if (t && t.active !== false && !t.isBodyDead?.()) return true;
        }
        return false;
    }

    _pickPartyAutoEat(eater, members, control) {
        const mal = !!eater.creature?.anatomy?.hediff?.("malnutrition");
        return Party.pickAutoEat(eater, members, {
            tileSize: TS,
            allowPoison: mal,
            skipPawnId: control?.id || null,
            skipHeld: control ? { id: control.id, slot: control.hotbarIndex ?? 0 } : null,
            getFood: (stack) => this._foodForEat(stack)
        });
    }

    _pawnHasBandage(m, skipHeld = null) {
        if (!m) return null;
        const bags = [
            { bag: "hotbar", slots: m.inventory || [] },
            { bag: "overflow", slots: m.overflow || [] }
        ];
        for (const { bag, slots } of bags) {
            for (let i = 0; i < slots.length; i++) {
                const stack = slots[i];
                if (!stack?.id) continue;
                if (skipHeld && m.id === skipHeld.id && bag === "hotbar" && i === skipHeld.slot) continue;
                if (itemDefs().get(stack.id)?.bandage) {
                    return { source: m, slot: i, bag, stack };
                }
            }
        }
        return null;
    }

    _partyNeedsAutoTend(session) {
        const members = this._ownedPawns(session).filter((m) => m && !m.dead);
        if (!members.some((m) => this._pawnHasBandage(m))) return false;
        for (const m of members) {
            const c = m.creature || this.creatures.get(m.id);
            if (c?.anatomy && BodyHealing.pickTendTarget?.(c.anatomy)) return true;
        }
        return false;
    }

    _pawnIsLyingDown(rec) {
        if (!rec || rec.dead) return false;
        if (rec._resting) return true;
        const c = rec.creature || this.creatures.get(rec.id);
        return !!(rec.prone || c?._downed || c?._prone || c?._resting || c?.isIncapacitated?.());
    }

    _shouldDelaySleep(session, pawn) {
        if (!session || !pawn || pawn._resting || pawn._restWalk) return false;
        const members = this._ownedPawns(session).filter((m) => m && !m.dead);
        const control = this._actionPawn(session, { pawnId: session.controlId });
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (c?.ai?.assistTarget) return true;
        if (pawn.tending || c?._tending) return true;
        if (c?.ai?.tendSeek) return true;
        for (const m of members) {
            if (!m || m === pawn) continue;
            const mc = m.creature || this.creatures.get(m.id);
            const seek = mc?.ai?.tendSeek;
            if (seek && (seek === c || seek === pawn || seek.id === pawn.id)) return true;
        }
        if (this._pickPartyAutoTend(pawn, members, control)) return true;
        const anatomy = c?.anatomy;
        if (anatomy && BodyHealing.pickTendTarget?.(anatomy)
            && members.some((m) => this._pawnHasBandage(m))) {
            return true;
        }
        return false;
    }

    /** Stand a resting doctor so they can tend a lying ally, then return to bed. */
    _wakeRestingTender(session, rec, members, control) {
        if (!session || !rec || rec.dead) return false;
        const c = rec.creature || this.creatures.get(rec.id);
        if (!c || c.isIncapacitated?.() || c.isImmobile?.() || c.isVomiting?.()) return false;
        c.refreshCapacities?.();
        if (!c.capacities?.canManipulate?.()) return false;
        const pick = this._pickPartyAutoTend(rec, members, control, { lyingOnly: true });
        if (!pick?.patient || pick.patient === rec || pick.patient.id === rec.id) return false;
        if (rec._resting) this._wakePawn(session, rec, { help: true });
        else if (rec._restWalk) {
            rec._restWalk = null;
            rec._wokeFromRest = true;
            c._restWalk = null;
            c._wokeFromRest = true;
        }
        return true;
    }

    _pickPartyAutoTend(tender, members, control, opts = {}) {
        const skipHeld = control ? { id: control.id, slot: control.hotbarIndex ?? 0 } : null;
        const seek = (Party.FOLLOW_DETACH || 12) * TS;
        const inRangeOthers = [];
        const seekOthers = [];
        let selfJob = null;
        const anatomyOf = (m) => (m.creature || this.creatures.get(m.id))?.anatomy;
        for (const p of members || []) {
            if (!p || p.dead) continue;
            if (opts.lyingOnly) {
                if (p === tender || p.id === tender.id) continue;
                if (!this._pawnIsLyingDown(p)) continue;
            }
            const anatomy = anatomyOf(p);
            if (!anatomy) continue;
            const target = BodyHealing.pickTendTarget(anatomy);
            if (!target) continue;
            const bleeding = !!(target.inj?.bleeding || target.destroyed);
            if (p === tender || p.id === tender.id) {
                const bandage = this._pawnHasBandage(tender, skipHeld);
                if (bandage) selfJob = { patient: p, bleeding, inRange: true, ...bandage, target };
                continue;
            }
            const dist = Math.hypot((Number(p.x) || 0) - (Number(tender.x) || 0),
                (Number(p.y) || 0) - (Number(tender.y) || 0));
            if (dist > seek) continue;
            const bandage = this._pawnHasBandage(tender, skipHeld) || this._pawnHasBandage(p, skipHeld);
            if (!bandage) continue;
            const inRange = Party.inInteractRange(tender, p, TS);
            const job = { patient: p, bleeding, dist, inRange, ...bandage, target };
            (inRange ? inRangeOthers : seekOthers).push(job);
        }
        const byNeed = (a, b) => {
            if (a.bleeding !== b.bleeding) return a.bleeding ? -1 : 1;
            return (a.dist || 0) - (b.dist || 0);
        };
        inRangeOthers.sort(byNeed);
        seekOthers.sort(byNeed);
        if (inRangeOthers[0]?.bleeding) return inRangeOthers[0];
        if (selfJob?.bleeding) return selfJob;
        if (seekOthers[0]?.bleeding) return seekOthers[0];
        if (inRangeOthers.length) return inRangeOthers[0];
        if (selfJob) return selfJob;
        return seekOthers[0] || null;
    }

    _assignPartyTendSeeks(session, uncontrolled, controlId) {
        const members = [];
        if (!session.dead) members.push(session);
        for (const m of session.party || []) {
            if (!m.dead) members.push(m);
        }
        const control = members.find((m) => m.id === controlId) || session;
        const combat = this._sessionPartyCombat(session, uncontrolled);
        for (const row of uncontrolled || []) {
            const rec = row.rec;
            const cc = row.creature;
            if (!cc) continue;
            cc.x = rec.x;
            cc.y = rec.y;
            this._bindPartyAI(cc);
            if (
                combat
                || rec.eatChannel
                || rec.dead
                || rec.tending
                || this._pawnVomiting(rec)
            ) {
                cc.ai.tendSeek = null;
                continue;
            }
            if (rec._resting || rec._restWalk) {
                if (!this._wakeRestingTender(session, rec, members, control)) {
                    cc.ai.tendSeek = null;
                    continue;
                }
            }
            const pick = this._pickPartyAutoTend(rec, members, control);
            const to = pick?.patient;
            if (!to || to === rec || to.id === rec.id) {
                cc.ai.tendSeek = null;
                continue;
            }
            const toC = to.creature || this.creatures.get(to.id);
            if (toC) {
                toC.x = to.x;
                toC.y = to.y;
            }
            cc.ai.tendSeek = toC || to;
        }
    }

    _assignPartyEatSeeks(session, uncontrolled, controlId) {
        const members = [];
        if (!session.dead) members.push(session);
        for (const m of session.party || []) {
            if (!m.dead) members.push(m);
        }
        const control = members.find((m) => m.id === controlId) || session;
        const combat = this._sessionPartyCombat(session, uncontrolled);
        for (const row of uncontrolled || []) {
            const rec = row.rec;
            const cc = row.creature;
            if (!cc) continue;
            cc.x = rec.x;
            cc.y = rec.y;
            this._bindPartyAI(cc);
            if (
                combat
                || rec.eatChannel
                || rec._resting
                || rec._restWalk
                || rec.dead
                || this._pawnVomiting(rec)
                || cc.ai.tendSeek
            ) {
                cc.ai.eatSeek = null;
                continue;
            }
            if ((Number(rec.kc) || 0) >= Party.AUTO_EAT_BELOW) {
                cc.ai.eatSeek = null;
                continue;
            }
            const pick = this._pickPartyAutoEat(rec, members, control);
            if (!pick || pick.inRange) {
                cc.ai.eatSeek = null;
                continue;
            }
            const from = pick.pawn;
            const fromC = from.creature || this.creatures.get(from.id);
            if (fromC) {
                fromC.x = from.x;
                fromC.y = from.y;
            }
            cc.ai.eatSeek = fromC || from;
        }
    }

    _tickPartyAI(dtMs, world) {
        const dt = dtMs / 1000;
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            const controlId = p.controlId || p.id;
            const rows = [];
            if (!p.dead) {
                const c = p.creature || this._ensurePlayerCreature(p);
                if (c && !c.isBodyDead()) rows.push({ rec: p, creature: c });
            }
            for (const m of p.party || []) {
                if (m.dead) continue;
                const cc = this._ensureCompanionCreature(p, m);
                if (cc && !cc.isBodyDead()) rows.push({ rec: m, creature: cc });
            }
            const uncontrolled = rows.filter((row) => row.rec.id !== controlId);
            this._assignPartyTendSeeks(p, uncontrolled, controlId);
            this._assignPartyEatSeeks(p, uncontrolled, controlId);
            for (const row of uncontrolled) {
                const cc = row.creature;
                const rec = row.rec;
                cc.x = rec.x;
                cc.y = rec.y;
                cc.facing = rec.facing || cc.facing;
                cc._restWalk = rec._restWalk || null;
                cc._resting = !!rec._resting;
                cc._wokeFromRest = !!rec._wokeFromRest;
                cc.inventory = rec.inventory;
                cc.equipment = rec.equipment;
                cc.hotbarIndex = rec.hotbarIndex ?? 0;
                cc.kc = rec.kc;
                cc.role = rec.role || "companion";
                cc.homeSettlementId = rec.homeSettlementId || null;
                this._bindPartyAI(cc);
                const wasSwinging = !!cc.isAttacking?.();
                cc.refreshCapacities?.();
                cc.ai.update(dtMs, world);
                rec.hotbarIndex = cc.hotbarIndex ?? rec.hotbarIndex;
                cc.applyDesiredVel(dtMs);
                const ox = rec.x;
                const oy = rec.y;
                const nx = cc.x + (cc.vx || 0) * dt;
                const ny = cc.y + (cc.vy || 0) * dt;
                if (!this._partyPoseBlocked(cc, nx, cc.y)) cc.x = nx;
                if (!this._partyPoseBlocked(cc, cc.x, ny)) cc.y = ny;
                rec.x = cc.x;
                rec.y = cc.y;
                rec.vx = cc.vx || 0;
                rec.vy = cc.vy || 0;
                rec.facing = cc.facing || rec.facing;
                rec._wokeFromRest = !!cc._wokeFromRest;
                if (
                    Math.hypot(rec.x - ox, rec.y - oy) < 0.2
                    && (Math.abs(cc.vx) > 4 || Math.abs(cc.vy) > 4)
                ) {
                    rec.heading = rec.heading || {
                        x: Math.abs(cc.vx) >= Math.abs(cc.vy) ? Math.sign(cc.vx) || 0 : 0,
                        y: Math.abs(cc.vy) > Math.abs(cc.vx) ? Math.sign(cc.vy) || 0 : 0
                    };
                    if (this._escapeOverlappingThing(rec)) {
                        const step = 3.5 * TS * dt;
                        const hx = rec.heading.x || 0;
                        const hy = rec.heading.y || 0;
                        if (hx && !this.isBlocked(rec.x + hx * step, rec.y)) rec.x += hx * step;
                        if (hy && !this.isBlocked(rec.x, rec.y + hy * step)) rec.y += hy * step;
                        cc.x = rec.x;
                        cc.y = rec.y;
                    }
                }
                if (!wasSwinging && cc.isAttacking?.()) {
                    this.pushEvent({
                        kind: "attack",
                        playerId: p.id,
                        pawnId: cc.id,
                        x: rec.x,
                        y: rec.y,
                        angle: cc.attackAngle,
                        facing: cc.facing || rec.facing,
                        art: cc.attackArt || {
                            unarmed: true,
                            range: 4,
                            max: cc.attackMax || 833
                        }
                    });
                }
            }
        }
        this._tickSettlerAI(dtMs, world);
    }

    _tickSettlerAI(dtMs, world) {
        const dt = dtMs / 1000;
        for (const rec of this.settlers || []) {
            if (!rec || rec.dead) continue;
            const cc = this._ensureSettlerCreature(rec);
            if (!cc || cc.isBodyDead()) continue;
            cc.x = rec.x;
            cc.y = rec.y;
            cc.facing = rec.facing || cc.facing;
            cc._resting = !!rec._resting;
            cc._restWalk = rec._restWalk || null;
            cc._wadeWater = !!rec._wadeWater;
            cc.inventory = rec.inventory;
            cc.kc = rec.kc;
            cc.homeSettlementId = rec.homeSettlementId;
            cc.role = "settler";
            this._bindPartyAI(cc);
            cc.refreshCapacities?.();
            cc.ai.update(dtMs, world);
            cc.applyDesiredVel(dtMs);
            const ox = cc.x;
            const oy = cc.y;
            const nx = cc.x + (cc.vx || 0) * dt;
            const ny = cc.y + (cc.vy || 0) * dt;
            if (!this._partyPoseBlocked(cc, nx, cc.y)) cc.x = nx;
            if (!this._partyPoseBlocked(cc, cc.x, ny)) cc.y = ny;
            rec.x = cc.x;
            rec.y = cc.y;
            rec.vx = cc.vx || 0;
            rec.vy = cc.vy || 0;
            rec.facing = cc.facing || rec.facing;
            rec.attackTimer = cc.attackTimer;
            rec.attackAngle = cc.attackAngle;
            rec.attackArt = cc.attackArt;
            if (
                Math.hypot(rec.x - ox, rec.y - oy) < 0.2
                && (Math.abs(cc.vx) > 4 || Math.abs(cc.vy) > 4)
            ) {
                if (this._escapeOverlappingThing(rec)) {
                    const step = 3.5 * TS * dt;
                    const hx = rec._escapeH?.nx || 0;
                    const hy = rec._escapeH?.ny || 0;
                    if (hx && !this._partyPoseBlocked(cc, rec.x + hx * step, rec.y)) {
                        rec.x += hx * step;
                    }
                    if (hy && !this._partyPoseBlocked(cc, rec.x, rec.y + hy * step)) {
                        rec.y += hy * step;
                    }
                    cc.x = rec.x;
                    cc.y = rec.y;
                } else {
                    this._mobUnstick(cc);
                }
            }
            if (cc.isBodyDead()) {
                rec.dead = true;
                this.settlers = this.settlers.filter((s) => s !== rec);
            }
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
            for (const m of p.party || []) {
                const cc = this._ensureCompanionCreature(p, m);
                if (cc && !m.dead && !cc.isBodyDead()) playerCreatures.push(cc);
            }
        }
        for (const w of this.wanderers.values()) {
            const wc = this._ensureWandererCreature(w);
            if (wc && !w.dead && !wc.isBodyDead()) playerCreatures.push(wc);
        }
        for (const rec of this.settlers || []) {
            const sc = this._ensureSettlerCreature(rec);
            if (sc && !rec.dead && !sc.isBodyDead()) playerCreatures.push(sc);
        }

        const liveMobs = [];
        for (const mob of this.mobs.values()) {
            if (!mob || mob.isBodyDead()) continue;
            liveMobs.push(mob);
        }

        const meleeTargets = [...playerCreatures, ...liveMobs];
        const mobScale = this._mobTimeScale();
        const mobDtMs = dtMs * mobScale;
        const mobDt = dt * mobScale;

        this._rebuildDuelAssignments();
        this._tickPartyAI(dtMs, aiWorld);
        this._tickSleepWalks(dtMs);

        for (const p of this.players.values()) {
            if (!p.connected) continue;
            if (!p.dead) {
            const creature = p.creature;
                if (creature && !creature.isBodyDead()) {
            creature.refreshCapacities?.();
            p.prone = !p.dead && !!creature._prone;
            if (p.prone) creature.facing = "right";
            creature.tickMelee(dtMs, meleeTargets);
            p.attackTimer = creature.attackTimer;
            p.attackMax = creature.attackMax;
            p.attackAngle = creature.attackAngle;
            p.facing = p.prone ? "right" : (creature.facing || p.facing);
            p.attackArt = creature.attackTimer > 0 ? (creature.attackArt || null) : null;
                    if (!creature.isAttacking()) this._flushPendingAttack(p, creature);
            if (creature.anatomy?._dirty) {
                p.body = creature.anatomy.toJSON();
                creature.anatomy._dirty = false;
                creature.refreshCapacities?.();
                p.prone = !p.dead && !!creature._prone;
                this._youDirty.add(p.id);
                    }
                }
            }
            for (const m of p.party || []) {
                const cc = m.creature || this.creatures.get(m.id);
                if (!cc || m.dead || cc.isBodyDead()) continue;
                cc.x = m.x;
                cc.y = m.y;
                cc.refreshCapacities?.();
                cc.tickMelee(dtMs, meleeTargets);
                m.attackTimer = cc.attackTimer;
                m.attackMax = cc.attackMax;
                m.attackAngle = cc.attackAngle;
                m.prone = !m.dead && !!cc._prone;
                if (m.prone) {
                    cc.facing = "right";
                    m.facing = "right";
                } else {
                    m.facing = cc.facing || m.facing;
                }
                m.attackArt = cc.attackTimer > 0 ? (cc.attackArt || null) : null;
                if (!cc.isAttacking()) this._flushPendingAttack(p, cc);
                if (cc.anatomy?._dirty) {
                    m.body = cc.anatomy.toJSON();
                    cc.anatomy._dirty = false;
                    this._youDirty.add(p.id);
                }
            }
        }

        for (const w of [...this.wanderers.values()]) {
            const wc = w.creature || this.creatures.get(w.id);
            if (!wc) continue;
            if (wc.isBodyDead()) {
                this._finishWandererDeath(w, wc._lastHitBy || null);
                continue;
            }
            wc.tickMelee(mobDtMs, meleeTargets);
            w.attackTimer = wc.attackTimer;
            w.attackMax = wc.attackMax;
            w.attackAngle = wc.attackAngle;
            w.facing = wc.facing || w.facing;
            w.attackArt = wc.attackTimer > 0 ? (wc.attackArt || null) : null;
            if (wc.anatomy?._dirty) {
                w.body = wc.anatomy.toJSON();
                wc.anatomy._dirty = false;
            }
        }

        for (const rec of this.settlers || []) {
            if (!rec || rec.dead) continue;
            const sc = rec.creature || this.creatures.get(rec.id);
            if (!sc || sc.isBodyDead()) continue;
            sc.x = rec.x;
            sc.y = rec.y;
            sc.inventory = rec.inventory;
            sc.hotbarIndex = rec.hotbarIndex ?? 0;
            sc._wadeWater = !!rec._wadeWater;
            sc.refreshCapacities?.();
            sc.tickMelee(dtMs, meleeTargets);
            rec.attackTimer = sc.attackTimer;
            rec.attackMax = sc.attackMax;
            rec.attackAngle = sc.attackAngle;
            rec.attackArt = sc.attackTimer > 0 ? (sc.attackArt || null) : null;
            if (sc.anatomy?._dirty) {
                rec.body = sc.anatomy.toJSON();
                sc.anatomy._dirty = false;
            }
        }

        for (const mob of liveMobs) {
            if (mob.isBodyDead()) {
                // Killed during a player swing earlier this tick
                this._finishMobDeath(mob, mob._lastHitBy || null);
                continue;
            }
            const nearest = aiWorld.getDuelTarget(mob) || aiWorld.getNearestPlayer(mob);
            mob.ctx.player = nearest || null;
            mob.refreshCapacities?.();
            const wasSwinging = !!mob.isAttacking?.();
            mob.ai?.update?.(mobDtMs, aiWorld);
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
            const onNav = !!(mob.ai?._nav?.path && mob.ai._nav.path.length)
                || !!(mob.ai?._path && mob.ai._path.length);
            if (mob._nudgeMs > 0 && !onNav) {
                mob.setDesiredVel(mob._nudgeVx || 0, mob._nudgeVy || 0);
                mob._nudgeMs -= mobDtMs;
            }
            mob.applyDesiredVel(mobDtMs);
            const wantVx = mob.vx || 0;
            const wantVy = mob.vy || 0;
            const nx = mob.x + wantVx * mobDt;
            const ny = mob.y + wantVy * mobDt;
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
                const speed = Math.hypot(wantVx, wantVy) || 1;
                const navState = mob.ai?._nav || {};
                let escaped = false;
                if (Path?.steerToward) {
                    const steered = Path.steerToward({
                        from: { x: mob.x, y: mob.y },
                        to: {
                            x: mob.x + (wantVx / speed) * 6 * TS,
                            y: mob.y + (wantVy / speed) * 6 * TS
                        },
                        blocked: (px, py) => this.isBlocked(px, py),
                        cellSize: TS,
                        side: navState.side,
                        path: navState.path,
                        pathGoal: navState.pathGoal,
                        stuckMs: navState.stuckMs,
                        lastFrom: navState.lastFrom,
                        lastWpDist: navState.lastWpDist,
                        maxRange: 6,
                        dt: mobDtMs
                    });
                    if (mob.ai) mob.ai._nav = steered;
                    if (!steered.arrived && (steered.nx || steered.ny)) {
                        const nxx = mob.x + steered.nx * speed * mobDt;
                        const nyy = mob.y + steered.ny * speed * mobDt;
                        if (!this.isBlocked(nxx, mob.y)) {
                            mob.x = nxx;
                            escaped = true;
                        }
                        if (!this.isBlocked(mob.x, nyy)) {
                            mob.y = nyy;
                            escaped = true;
                        }
                        if (escaped) {
                            mob.vx = steered.nx * speed;
                            mob.vy = steered.ny * speed;
                        }
                    }
                }
                if (!escaped && (!mob._blockRetry || mob._blockRetry <= 0)) {
                    mob._blockRetry = 400 + this.rng() * 350;
                    this._mobUnstick(mob);
                }
            }
            if (mob._blockRetry > 0) mob._blockRetry -= mobDtMs;
            if (mob.entry) {
                mob.entry.x = mob.x;
                mob.entry.y = mob.y;
                mob.entry.facing = mob.facing;
                if (mob.anatomy?._dirty) {
                    mob.entry.body = mob.anatomy.toJSON();
                }
            }
            mob.tickMelee(mobDtMs, meleeTargets);

            if (mob.isBodyDead()) {
                this._finishMobDeath(mob, mob._lastHitBy || null);
            }
        }

        this._reapDeadPlayers();
        this._reapDeadCompanions();
        // Sync capacity deaths are handled above; fatal-part microtasks may still
        // be pending until after this call returns — next tick's reap catches them.
        this._reapDeadMobs();
    }

    _hungerDrainForPawn(pawn, creature) {
        if (!pawn) return 0;
        const getDef = (id) => itemDefs().get(id);
        const enc = Carry.encumbrance(
            Carry.gearMass(pawn.inventory, pawn.equipment, getDef, pawn.overflow),
            Carry.strengthFromEquip(pawn.equipment, getDef)
        );
        return Hunger.minuteDrain({
            hunger: pawn.hunger,
            sprinting: !!pawn.sprint,
            encumbranceHungerRate: enc.hungerRate,
            hungerRateFactor: creature?.capacities?.hungerRateFactor?.() || 1,
            resting: pawn._resting
        });
    }

    _worldMinute() {
        this.gameMinutes += 1;
        if (this.gameMinutes >= 24 * 60) {
            this.gameMinutes = 0;
            this.gameDay += 1;
        }
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            if (!p.dead) {
            const creature = p.creature || this.creatures.get(p.id);
            // Snapshot before drain — same as Player.hungerTick (fed minute still recovers)
            const fed = (Number(p.kc) > 0) || (Number(p.saturation) > 0);
            const tick = this._hungerDrainForPawn(p, creature);
            Hunger.applyStarve(p, tick);
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
                }
            }
            this._youDirty.add(p.id);
        }
            for (const mem of p.party || []) {
                if (mem.dead) continue;
                this._tickPlayerSpoilLeft(mem);
                const mFed = (Number(mem.kc) > 0) || (Number(mem.saturation) > 0);
                const mcPre = mem.creature || this.creatures.get(mem.id);
                Hunger.applyStarve(mem, this._hungerDrainForPawn(mem, mcPre));
                const mc = mem.creature || this.creatures.get(mem.id);
                if (mc && !mc.isBodyDead() && BodyHealing?.minuteTick) {
                    mc._malnutritionFed = mFed;
                    mc.kc = mem.kc;
                    BodyHealing.minuteTick(mc, mc.ctx);
                    if (mc.isBodyDead()) {
                        mem.body = mc.anatomy?.toJSON?.() || mem.body;
                    }
                }
            }
        }
        for (const rec of this.settlers || []) {
            if (!rec || rec.dead) continue;
            const cc = rec.creature || this.creatures.get(rec.id);
            const fed = (Number(rec.kc) > 0) || (Number(rec.saturation) > 0);
            Hunger.applyStarve(rec, this._hungerDrainForPawn(rec, cc));
            if (cc && !cc.isBodyDead?.()) {
                cc._malnutritionFed = fed;
                cc.kc = rec.kc;
                cc.saturation = rec.saturation;
                if (BodyHealing?.minuteTick) {
                    BodyHealing.minuteTick(cc, cc.ctx);
                    if (cc.isBodyDead()) {
                        rec.body = cc.anatomy?.toJSON?.() || rec.body;
                        rec.dead = true;
                    } else if (cc.anatomy?._dirty) {
                        rec.body = cc.anatomy.toJSON();
                        cc.anatomy._dirty = false;
                    }
                }
            }
        }
        this._reapDeadCompanions();
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
        this._tickSoakDrops();
        this._tickLootableRegrows();
        this._tickCampfires();
        this._tickDryingRacks();
        this._tickCorpseDecay();
        if (Apparel.isDayBoundary(this.worldMinuteIndex())) {
            for (const p of this.players.values()) {
                if (!p.connected || p.dead) continue;
                this._tickApparelDailyWear(p);
                for (const mem of p.party || []) {
                    if (!mem.dead) this._tickApparelDailyWear(mem);
                }
            }
        }
    }

    _convertCorpseToCarcass(entry, now) {
        if (!entry) return;
        const { dump } = CorpseDecay.applyCarcassConversion(entry, {
            getItem: (id) => itemDefs().get(id),
            now,
            rng: () => this.rng(),
            makeStack: (item, qty, at) => Spoil.makeWorldItemStack(item, qty, undefined, at)
        });
        for (const stack of dump) {
            const world = this._cloneStackForWorld(stack);
            if (world) this._pushDrop(entry.x, entry.y, world);
        }
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
        const usePose = mob.role === "settler" || mob.role === "companion" || mob.kind === "player";
        const blocked = (x, y) => usePose
            ? this._partyPoseBlocked(mob, x, y)
            : this.isBlocked(x, y);
        for (const [dx, dy] of dirs) {
            const dlen = Math.hypot(dx, dy) || 1;
            const nx = mob.x + (dx / dlen) * step;
            const ny = mob.y + (dy / dlen) * step;
            const canX = !blocked(nx, mob.y);
            const canY = !blocked(mob.x, ny);
            if (!canX && !canY) continue;
            mob._nudgeVx = (dx / dlen) * speed;
            mob._nudgeVy = (dy / dlen) * speed;
            mob._nudgeMs = 280;
            mob.setDesiredVel(mob._nudgeVx, mob._nudgeVy);
            return;
        }
    }

    isBlocked(wx, wy, opts = {}) {
        if (this._tileBlocked(wx, wy, opts)) return true;

        // Match client Thing.setup: only hitboxSize > 0 is solid (bushes/debris are not).
        const { cx, cy } = worldToChunk(wx, wy);
        const c = this.chunks.get(chunkKey(cx, cy));
        if (!c) return false;
        const solidAt = (list) => {
            for (const t of list || []) {
                if (!t || t.gone) continue;
                if (opts.thingR != null) {
                    const def = thingDefs().get(t.id);
                    const hs = Number(def?.hitboxSize);
                    if (!(hs > 0)) continue;
                    if (Math.abs(t.x - wx) < opts.thingR && Math.abs(t.y - wy) < opts.thingR) {
                        return true;
                    }
                    continue;
                }
                const rect = this._thingRect(t);
                if (!rect) continue;
                if (wx > rect.left && wx < rect.right && wy > rect.top && wy < rect.bottom) {
                    return true;
                }
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
                const onWater = this._dropIsOnWater(d);
                const def = itemDefs().get(d.id);
                if (Hide.pausesDropDespawn(d, def, onWater)) {
                    continue;
                }
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
        if (typeof Structures !== "undefined" && Structures.parentFireChunks) {
            const parents = Structures.parentFireChunks(cx, cy, this.seed, WorldGen.tileKeyAt);
            for (const p of parents) {
                if (p.cx === cx && p.cy === cy) continue;
                this._ensureChunk(p.cx, p.cy);
            }
            c = this.chunks.get(key);
            if (c) return c;
        }
        c = WorldGen.generateChunk(cx, cy, this.seed, {
            getGeneratedChunk: (ncx, ncy) => {
                const n = this.chunks.get(chunkKey(ncx, ncy));
                if (!n?.tiles) return null;
                return {
                    cx: ncx,
                    cy: ncy,
                    tileSize: 16,
                    things: n.things,
                    lootableThings: n.lootableThings,
                    tiles: n.tiles
                };
            }
        });
        this.chunks.set(key, c);
        this._ensureLootableUids(c);
        this._registerChunkMobs(c);
        return c;
    }

    chunkPayload(cx, cy) {
        const c = this._ensureChunk(cx, cy);
        this._soakChunkDrops(c);
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
        if (Array.isArray(p.overflow)) {
            Spoil.migrateCharacterStacks(p.overflow, now);
        }
        const eq = p.equipment;
        if (!eq) return;
        for (const key of ["head", "torso", "legs", "feet", "back"]) {
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
            Fire.tickStackTemp(stack);
            this._spoilStackIfDue(stack);
        };
        if (Array.isArray(p.inventory)) {
            for (let i = 0; i < p.inventory.length; i++) tick(p.inventory[i]);
        }
        if (Array.isArray(p.overflow)) {
            for (let i = 0; i < p.overflow.length; i++) tick(p.overflow[i]);
        }
        const eq = p.equipment;
        if (!eq) return;
        for (const key of ["head", "torso", "legs", "feet", "back"]) tick(eq[key]);
        if (Array.isArray(eq.waist)) {
            for (let i = 0; i < eq.waist.length; i++) tick(eq.waist[i]);
        }
    }

    _spoilChunkContents(c) {
        if (!c) return;
        if (Array.isArray(c.drops)) {
            for (const d of c.drops) {
                if (!d) continue;
                const def = itemDefs().get(d.id);
                Fire.tickStackTemp(d);
                if (Hide.pausesDropDespawn(d, def, this._dropIsOnWater(d))) continue;
                this._spoilStackIfDue(d);
            }
        }
        if (Array.isArray(c.corpses)) {
            for (const corpse of c.corpses) {
                if (!Array.isArray(corpse?.loot)) continue;
                for (let i = 0; i < corpse.loot.length; i++) {
                    if (corpse.loot[i]) {
                        Fire.tickStackTemp(corpse.loot[i]);
                        this._spoilStackIfDue(corpse.loot[i]);
                    }
                }
            }
        }
        if (Array.isArray(c.things)) {
            for (const t of c.things) {
                if (t?.cook) this._spoilStackIfDue(t.cook);
                if (t?.catalyst) {
                    this._spoilStackIfDue(t.catalyst);
                }
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
                if (Array.isArray(t?.slots)) {
                    const def = thingDefs().get(t.id);
                    if (!Hide.isDryingRack(def, t)) {
                        for (let i = 0; i < t.slots.length; i++) {
                            if (t.slots[i]) {
                                Fire.tickStackTemp(t.slots[i]);
                                this._spoilStackIfDue(t.slots[i]);
                            }
                        }
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
        if (Array.isArray(p.overflow)) {
            for (let i = 0; i < p.overflow.length; i++) {
                if (p.overflow[i]) this._spoilStackIfDue(p.overflow[i]);
            }
        }
        const eq = p.equipment;
        if (!eq) return;
        for (const key of ["head", "torso", "legs", "feet", "back"]) {
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

    _poseMotion(rec) {
        if (rec?.dead || rec?.prone || rec?._resting || rec?.creature?._prone || rec?.creature?._resting) {
            return { vx: 0, vy: 0, moving: false };
        }
        const vx = Number(rec?.vx) || Number(rec?.creature?.vx) || 0;
        const vy = Number(rec?.vy) || Number(rec?.creature?.vy) || 0;
        const moving = Math.hypot(vx, vy) > 2
            || Math.hypot(rec?.moveX || 0, rec?.moveY || 0) > 0.01;
        return { vx, vy, moving };
    }

    snapshotFor(viewerId) {
        const viewer = this.players.get(viewerId);
        if (!viewer) return null;
        // Always include all connected players (max 8) — do not distance-cull remotes
        const players = [];
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            const motion = this._poseMotion(p);
            players.push({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                facing: p.facing,
                vx: motion.vx,
                vy: motion.vy,
                moving: motion.moving,
                sprint: p.sprint,
                dead: p.dead,
                prone: !!(p.dead || p.prone || p._resting),
                resting: !!p._resting,
                injured: !!(typeof Sleep !== "undefined" && Sleep.injuredForAutofill
                    ? Sleep.injuredForAutofill(p.creature?.anatomy || p.anatomy)
                    : false),
                restRot: p.lastSleep?.rot,
                lastSleep: p.lastSleep || null,
                eating: !!p.eatChannel,
                attacking: p.attackTimer > 0,
                attackAngle: p.attackAngle ?? null,
                attackProgress: p.attackTimer > 0 && p.attackMax > 0
                    ? 1 - p.attackTimer / p.attackMax
                    : 0,
                attackArt: p.attackTimer > 0 ? (p.attackArt || null) : null,
                look: p.look || Look.normalizeLook(null),
                party: (p.party || []).map((m) => {
                    const mm = this._poseMotion(m);
                    return {
                        id: m.id,
                        name: m.name,
                        x: m.x,
                        y: m.y,
                        facing: m.facing,
                        vx: mm.vx,
                        vy: mm.vy,
                        moving: mm.moving,
                        dead: !!m.dead,
                        prone: !!(m.dead || m.prone || m.creature?._prone || m._resting),
                        resting: !!m._resting,
                        injured: !!(typeof Sleep !== "undefined" && Sleep.injuredForAutofill
                            ? Sleep.injuredForAutofill(m.creature?.anatomy || m.anatomy)
                            : false),
                        restRot: m.lastSleep?.rot,
                        lastSleep: m.lastSleep || null,
                        look: m.look || Look.normalizeLook(null),
                        attacking: (m.attackTimer || 0) > 0,
                        attackAngle: m.attackAngle ?? null,
                        attackArt: (m.attackTimer || 0) > 0 ? (m.attackArt || null) : null
                    };
                })
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
        const storages = [];
        for (const c of this._chunksNear(vx, vy, interest)) {
            this._soakChunkDrops(c);
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
                    playerCorpse: !!corpse.playerCorpse,
                    diedAt: corpse.diedAt,
                    stage: corpse.stage || "corpse",
                    cx: c.cx,
                    cy: c.cy
                });
            }
            for (const t of c.things || []) {
                if (this._isCampfireEntry(t)) campfires.push(this._campfirePublic(t, c));
                else if (this._isPlaceableEntry(t)) storages.push(this._storagePublic(t, c));
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
        const out = {
            clock: {
                gameDay: this.gameDay,
                gameMinutes: this.gameMinutes,
                tickSpeed: this.tickSpeed,
                baseTickSpeed: Number.isFinite(this.baseTickSpeed) ? this.baseTickSpeed : this.tickSpeed
            },
            players,
            drops,
            corpses,
            campfires,
            storages,
            mobs,
            wanderers: [...this.wanderers.values()].map((w) => this._publicWanderer(w)),
            settlers: (this.settlers || []).filter((s) => s && !s.dead).map((s) => this._publicSettler(s)),
            settlements: this.settlements || [],
            chunkCursor: { cx, cy },
            youId: viewerId
        };
        return out;
    }

    youPayload(playerId) {
        const p = this.players.get(playerId);
        if (!p) return null;
        this._spoilPlayerGear(p);
        for (const m of p.party || []) {
            if (!m?.dead) this._spoilPlayerGear(m);
        }
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
            overflow: p.overflow,
            equipment: p.equipment,
            hotbarIndex: p.hotbarIndex,
            body,
            hp: p.hp,
            mhp: p.mhp,
            dead: p.dead,
            prone: !!(p.dead || p.prone || creature?._prone || p._resting),
            resting: !!p._resting,
            restRot: p.lastSleep?.rot,
            lastSleep: p.lastSleep || null,
            look: p.look || Look.normalizeLook(null),
            eatChannel: p.eatChannel
                ? { progress: 1 - p.eatChannel.remaining / p.eatChannel.max }
                : null,
            vomit: this._isVomiting(p)
                ? { remainingMs: Math.max(0, Number(p.vomitRemainingMs) || 0) }
                : null,
            party: (p.party || []).map((m) => ({
                id: m.id,
                name: m.name,
                look: m.look,
                kc: m.kc,
                saturation: m.saturation,
                stomach: m.stomach,
                inventory: m.inventory,
                overflow: m.overflow,
                equipment: m.equipment,
                hotbarIndex: m.hotbarIndex,
                body: m.body || m.creature?.anatomy?.toJSON?.() || null,
                hp: m.hp,
                mhp: m.mhp,
                x: m.x,
                y: m.y,
                facing: m.facing,
                dead: !!m.dead,
                prone: !!(m.dead || m.prone || m.creature?._prone || m._resting),
                resting: !!m._resting,
                restRot: m.lastSleep?.rot,
                lastSleep: m.lastSleep || null,
                eatChannel: m.eatChannel
                    ? { progress: 1 - m.eatChannel.remaining / m.eatChannel.max }
                    : null
            })),
            controlId: p.controlId || p.id,
            settlements: this._ownedSettlements(p.id),
            settlers: (this.settlers || [])
                .filter((s) => s && !s.dead && s.ownerId === p.id)
                .map((s) => this._publicSettler(s))
        };
    }
}

module.exports = { SimWorld, chunkKey, worldToChunk, CHUNK_PX, CS, TS };
