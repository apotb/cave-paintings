/**
 * SimWorld prototype methods (creatures).
 * Installed onto SimWorld.prototype. Method bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SimWorldMixins = root.SimWorldMixins || {};
        root.SimWorldMixins.creatures = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    "use strict";
    const {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    } = ctx;
    return {

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
    },

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
    },

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
    },

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
    },

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
    },

    _viewerControlId(viewerId) {
        const p = this.players.get(viewerId);
        return (p && (p.controlId || p.id)) || viewerId;
    },

    /** True if `entity` is the pawn this viewer is currently controlling. */
    _isViewerActingPawn(entity, viewerId) {
        if (!entity || !viewerId) return false;
        const cid = this._viewerControlId(viewerId);
        const pid = entity.pawnId || entity.id;
        return !!cid && pid === cid;
    },

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
    },

    _entityLogIds(entity) {
        const ids = new Set();
        if (!entity) return ids;
        if (typeof entity === "string") {
            ids.add(entity);
            return ids;
        }
        if (entity.id) ids.add(entity.id);
        if (entity.pawnId) ids.add(entity.pawnId);
        if (entity.uid) ids.add(entity.uid);
        return ids;
    },

    _isViewerSettler(entity, viewerId) {
        if (!entity || !viewerId) return false;
        const ids = this._entityLogIds(entity);
        for (const rec of this.settlers || []) {
            if (!rec || rec.ownerId !== viewerId) continue;
            if (ids.has(rec.id) || entity === rec || entity === rec.creature) return true;
        }
        if (entity.role === "settler" && this._playerIdOf(entity) === viewerId) return true;
        return false;
    },

    _isViewerPartyMember(entity, viewerId) {
        if (!entity || !viewerId || this._isViewerSettler(entity, viewerId)) return false;
        const session = this.players.get(viewerId);
        if (!session) return false;
        const ids = this._entityLogIds(entity);
        if (ids.has(session.id) || entity === session || entity === session.creature) return true;
        return (session.party || []).some((m) =>
            m && (ids.has(m.id) || entity === m || entity === m.creature)
        );
    },

    /** Party green, your settlers blue, everyone else combat-log red. */
    _combatLogNameColor(entity, viewerId) {
        const YOU = Party.COLOR_ALLY || "#80e080";
        const SETTLER = Party.COLOR_SETTLER || "#7ec8ff";
        const ENEMY = "#ef5a5a";
        if (this._isViewerPartyMember(entity, viewerId) || this._isViewerActingPawn(entity, viewerId)) {
            return YOU;
        }
        if (this._isViewerSettler(entity, viewerId)) return SETTLER;
        return ENEMY;
    },

    /** Rebuild hit/destroy segments from the receiving player's point of view. */
    _combatLogSegmentsForViewer(opts, viewerId) {
        if (!opts?.combat || !opts.attacker || !opts.target || !opts.attack) return null;
        const attack = opts.attack;
        const attacker = opts.attacker;
        const target = opts.target;
        const partName = opts.victimPartName;
        if (!partName) return null;

        const WEAPON = "#f0a040";
        const atkColor = this._combatLogNameColor(attacker, viewerId);
        const vicColor = this._combatLogNameColor(target, viewerId);
        const isYou = this._isViewerActingPawn(attacker, viewerId);
        const vicIsYou = this._isViewerActingPawn(target, viewerId);

        if (opts.destroyed) {
            const who = vicIsYou
                ? "Your"
                : `${target.def?.name || target.displayName?.() || "Their"}'s`;
            return [
                { text: who, color: vicColor },
                { text: `${partName} was destroyed!` }
            ];
        }

        if (opts.deflected) {
            const itemName = opts.deflectName || "apparel";
            return [
                { text: vicIsYou ? "Your" : "The", color: vicColor },
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
            { text: subj, color: atkColor },
            { text: verb },
            { text: weaponName, color: WEAPON },
            { text: "into" },
            { text: vicPossessive, color: vicColor },
            { text: partName },
            { text: dmgStr, color: WEAPON }
        ];
    },

    /** Session that owns this creature: traveling leader, or a companion via ownerId. */
    _sessionOwnerOf(mob) {
        if (!mob) return null;
        if (mob.ownerId != null) {
            const byOwner = this.players.get(mob.ownerId);
            if (byOwner) return byOwner;
        }
        if (mob.id != null) return this.players.get(mob.id) || null;
        return null;
    },

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
            isBlocked: (x, y) => self.isBlocked(x, y, { load: false }),
            tileBlocked: (x, y) => self._tileBlocked(x, y, { load: false }),
            poseBlocked: (creature, x, y, pad, opts) => self._partyPoseBlocked(
                creature, x, y, pad, Object.assign({ load: false }, opts)
            ),
            terrainSpeedMult: (x, y) => self._terrainSpeedMult(x, y),
            getRestWalkDest(mob) {
                const spec = mob?._restWalk;
                if (!spec?.uid) return null;
                const found = self._findSleepByUid(spec.uid, mob);
                if (!found?.entry) return null;
                const def = self._sleepDef(found.entry);
                if (Sleep.restWalkStand) {
                    return Sleep.restWalkStand(found.entry, spec.slot, TS, def);
                }
                const pos = Sleep.sleeperWorldPos(found.entry, spec.slot, TS, def);
                return { x: pos.x - TS * 0.5, y: pos.y + TS * 0.5 };
            },
            solidThingAt: (x, y) => self._solidThingAt(x, y),
            thingRectsNear: (x, y, radius) => self._thingRectsNear(x, y, radius),
            getItem: (id) => itemDefs().get(id),
            stuckDt: Number(self._aiStuckDt) > 0 ? self._aiStuckDt : 16,
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
                const owner = self._sessionOwnerOf(mob);
                if (!owner) return true;
                const cid = owner.controlId || owner.id;
                if (cid !== owner.id) return false;
                return !!owner.dead;
            },
            getFollowTarget(mob) {
                const owner = self._sessionOwnerOf(mob);
                if (!owner || !owner.connected) return null;
                const cid = owner.controlId || owner.id;
                if (cid === owner.id) {
                    return owner.creature || self.creatures.get(owner.id);
                }
                const mem = (owner.party || []).find((m) => m.id === cid);
                return mem?.creature || self.creatures.get(cid) || owner.creature;
            },
            followSprinting(mob) {
                const owner = self._sessionOwnerOf(mob);
                if (!owner || !owner.connected) return false;
                const cid = owner.controlId || owner.id;
                if (cid === owner.id) return !!owner.sprint;
                const mem = (owner.party || []).find((m) => m.id === cid);
                return !!(mem?.sprint || mem?.creature?.isSprinting);
            },
            getPartyMates(mob) {
                const owner = self._sessionOwnerOf(mob);
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
                const owner = self._sessionOwnerOf(mob);
                const tid = target?.ownerId;
                if (!owner?.pvpAggro || !tid || !owner.pvpAggro.has(tid)) return false;
                const other = self.players.get(tid);
                return !other?.dead;
            },
            getAssistTarget(mob) {
                if (mob?.role === "settler" || mob?.homeSettlementId) {
                    return self._settlerDefenseTarget(mob);
                }
                const duel = this.getDuelTarget(mob);
                if (duel) return duel;
                const owner = self._sessionOwnerOf(mob);
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
            },
            interruptSettlerForCombat(mob) {
                SettlerWork.interruptForCombat(self, mob);
            }
        };
    },

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
        for (const rec of this.settlers || []) {
            if (!rec || rec.dead) continue;
            const cc = rec.creature || this.creatures.get(rec.id) || this._ensureSettlerCreature(rec);
            if (!cc || cc.isBodyDead()) continue;
            if (!this._inSimRange(rec.x, rec.y)) continue;
            add(cc);
        }
        for (const w of this.wanderers.values()) {
            if (!w?.hostile || w.dead) continue;
            if (!this._inSimRange(w.x, w.y)) continue;
            const c = this._ensureWandererCreature(w);
            add(c);
        }
        for (const mob of this.mobs.values()) {
            if (!mob || mob.isBodyDead()) continue;
            if (!this._inSimRange(mob.x, mob.y)) continue;
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
    },

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
    },

    _syncPlayerCreature(p) {
        const creature = p?.creature || this.creatures.get(p?.id);
        if (!creature || !p) return null;
        creature.x = p.x;
        creature.y = p.y;
        creature.facing = p.facing || creature.facing;
        creature.inventory = p.inventory;
        creature.equipment = p.equipment;
        creature.hotbarIndex = p.hotbarIndex ?? 0;
        creature.ownerId = p.id;
        if (p.dead) {
            creature._dead = true;
            creature.active = false;
        }
        creature._vomitRemainingMs = Number(p.vomitRemainingMs) || 0;
        creature._resting = !!p._resting;
        creature._restWalk = p._restWalk || null;
        creature.lastSleep = p.lastSleep || null;
        return creature;
    },

    _resetPlayerAnatomy(p) {
        this._resetPawnAnatomy(p, p);
    },

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
    },
    };
});
