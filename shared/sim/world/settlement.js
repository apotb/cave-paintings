/**
 * SimWorld prototype methods (settlement).
 * Installed onto SimWorld.prototype. Method bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SimWorldMixins = root.SimWorldMixins || {};
        root.SimWorldMixins.settlement = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    "use strict";
    const {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    } = ctx;
    return {

    _ownedSettlements(ownerId) {
        return Settlement.ownedOf(this.settlements, ownerId);
    },

    _researchHolder(ownerId) {
        if (!ownerId) return null;
        const p = this.players.get(ownerId);
        if (!p) return null;
        this._migrateOwnerResearch(ownerId);
        _research()?.ensureTechs?.(p);
        return p;
    },

    _migrateOwnerResearch(ownerId) {
        if (!ownerId) return;
        if (!this.researchSpentByOwner || typeof this.researchSpentByOwner !== "object") {
            this.researchSpentByOwner = Object.create(null);
        }
        const p = this.players.get(ownerId);
        const R = _research();
        if (!p || !R?.adoptSettlementTechs) return;
        const adopted = R.adoptSettlementTechs(p, this._ownedSettlements(ownerId));
        if (this.researchSpentByOwner[ownerId] == null) {
            this.researchSpentByOwner[ownerId] = adopted;
        }
    },

    _researchSpent(ownerId) {
        const n = this.researchSpentByOwner?.[ownerId];
        return Math.max(0, Math.floor(Number(n) || 0));
    },

    _addResearchSpent(ownerId, n) {
        if (!ownerId) return;
        this._migrateOwnerResearch(ownerId);
        const add = Math.max(0, Math.floor(Number(n) || 0));
        if (!(add > 0)) return;
        this.researchSpentByOwner[ownerId] = this._researchSpent(ownerId) + add;
    },

    _researchExtra(ownerId) {
        return {
            spent: this._researchSpent(ownerId),
            settle: this._researchHolder(ownerId)
        };
    },

    _ownerResearchCircles(ownerId) {
        const out = [];
        const seen = new Set();
        for (const s of this._ownedSettlements(ownerId)) {
            for (const e of this._paintingCirclesInRange(s)) {
                const k = e.uid || `${e.x},${e.y}`;
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(e);
            }
        }
        return out;
    },

    _researchPoints(ownerId) {
        const R = _research();
        if (!R?.pointsBreakdown) return { paintings: 0, tallies: 0, spent: 0, produced: 0, available: 0, total: 0 };
        this._migrateOwnerResearch(ownerId);
        return R.pointsBreakdown(this._ownerResearchCircles(ownerId), this._researchExtra(ownerId));
    },

    _paintingCirclesInRange(settle) {
        const R = _research();
        if (!R || !settle) return [];
        const keys = Settlement.chunkKeysFor(settle, TS, 8) || [];
        const out = [];
        for (const key of keys) {
            const c = this.chunks.get(key);
            if (!c || !Array.isArray(c.things)) continue;
            for (const e of c.things) {
                if (!e || e.gone) continue;
                if (!R.isPaintingCircle(this._thingDef(e.id), e)) continue;
                if (!Settlement.inRange(settle, e.x, e.y, TS)) continue;
                R.ensureEntry(e, this._thingDef(e.id));
                out.push(e);
            }
        }
        return out;
    },

    _unlockTech(settle, techId) {
        const R = _research();
        const ownerId = settle?.ownerId;
        const holder = this._researchHolder(ownerId);
        if (!R || !holder) return false;
        const id = String(techId || "");
        const tech = R.techById(id);
        if (!tech) return false;
        const pts = this._researchPoints(ownerId);
        if (!R.canUnlock(holder, id, pts.available ?? pts.total)) return false;
        const cost = R.remainingUnlockCost(holder, id);
        if (R.unlockChain) R.unlockChain(holder, id);
        else R.unlock(holder, id);
        this._addResearchSpent(ownerId, cost);
        this._youDirty.add(ownerId);
        return true;
    },

    _tallyItemId() {
        return _research()?.TALLY_ITEM_ID || "tally_stick";
    },

    _takeOneItem(p, itemId) {
        if (!p || !itemId) return false;
        const heldIdx = p.hotbarIndex ?? 0;
        const held = p.inventory?.[heldIdx];
        if (held?.id === itemId) {
            held.quantity = (held.quantity || 1) - 1;
            if (!(held.quantity > 0)) p.inventory[heldIdx] = null;
            this._dirtyPawnOwner(p);
            return true;
        }
        for (const inv of [p.inventory, p.overflow]) {
            if (!Array.isArray(inv)) continue;
            const i = inv.findIndex((s) => s && s.id === itemId);
            if (i < 0) continue;
            const stack = inv[i];
            stack.quantity = (stack.quantity || 1) - 1;
            if (!(stack.quantity > 0)) inv[i] = null;
            this._dirtyPawnOwner(p);
            return true;
        }
        return false;
    },

    _tryTallyOp(p, settle, action, op) {
        const R = _research();
        const uid = String(action.uid || "");
        const found = uid ? this._findThingByUid(uid) : null;
        if (!found || !R?.isPaintingCircle?.(this._thingDef(found.entry?.id), found.entry)) return;
        if (!Settlement.inRange(settle, found.entry.x, found.entry.y, TS)) return;
        R.ensureEntry(found.entry, this._thingDef(found.entry.id));
        const actor = this._actionPawn(p, action) || p;
        const itemId = this._tallyItemId();
        if (op === "installTally") {
            if (R.hasTally?.(found.entry)) return;
            if (!this._takeOneItem(actor, itemId)) return;
            if (!R.installTally(found.entry)) {
                const left = this._give(actor, itemId, 1);
                if (left > 0) this._pushDrop(actor.x, actor.y, { id: itemId, quantity: left });
                return;
            }
            this._emitStorage(found.chunk, found.entry);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "removeTally") {
            const oid = settle.ownerId;
            const holder = this._researchHolder(oid);
            const circles = this._ownerResearchCircles(oid);
            if (R.tallyRemoveBlockedReason?.(holder, circles, found.entry, this._researchExtra(oid))) return;
            if (!R.removeTally(found.entry)) return;
            const left = this._give(actor, itemId, 1);
            if (left > 0) this._pushDrop(actor.x, actor.y, { id: itemId, quantity: left });
            this._emitStorage(found.chunk, found.entry);
            this._youDirty.add(p.id);
        }
    },

    _handleSettlement(p, action = {}) {
        const op = String(action.op || "");
        if (op === "found") {
            this._tryPlace(p, { ...action, name: action.name });
            return;
        }
        const settle = this.settlements.find((s) => s.id === action.settlementId) || null;
        if (op === "rename" && settle && settle.ownerId === p.id) {
            const from = Settlement.clampName(settle.name);
            const to = Settlement.clampName(action.name);
            if (from === to) return;
            settle.name = to;
            this._youDirty.add(p.id);
            const camp = Party.COLOR_SETTLER || "#7ec8ff";
            const line = Settlement.renameChat(from, to, camp);
            this._announceWorld(line.text, { segments: line.segments });
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
            this._syncJobOrder(dropSettle);
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
            const fromId = rec.homeSettlementId;
            this.settlers = this.settlers.filter((s) => s !== rec);
            rec.role = "companion";
            rec.homeSettlementId = null;
            const from = fromId ? this.settlements.find((s) => s.id === fromId) : null;
            if (from) this._syncJobOrder(from);
            if (rec._resting || rec.resting || rec._restWalk) {
                this._wakePawn(p, rec, { manual: true });
            }
            rec._settlerAct = null;
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
            if (from) this._syncJobOrder(from);
            this._syncJobOrder(dest);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "addStation" && settle && settle.ownerId === p.id) {
            const uid = String(action.uid || "");
            if (!uid) return;
            const taken = this.settlements.some((s) => s.id !== settle.id
                && (s.stationUids || []).some((u) => String(u) === uid));
            if (taken) return;
            if (!settle.stationUids) settle.stationUids = [];
            if (!settle.stationUids.some((u) => String(u) === uid)) settle.stationUids.push(uid);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "removeStation" && settle && settle.ownerId === p.id) {
            Settlement.removeStation(settle, action.uid);
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
            if (!uid || !(settle.stationUids || []).some((u) => String(u) === uid)) return;
            const found = this._findThingByUid(uid);
            if (!found) return;
            if (Settlement.stationKind(found.entry?.id) !== "storage") return;
            StorageFilter.applyToEntry(found.entry, action.filter);
            this._emitStorage(found.chunk, found.entry);
            return;
        }
        if (op === "setFuelFilter" && settle && settle.ownerId === p.id) {
            const uid = String(action.uid || "");
            if (!uid || !(settle.stationUids || []).includes(uid)) return;
            const found = this._findThingByUid(uid);
            if (!found) return;
            if (Settlement.stationKind(found.entry?.id) !== "campfire") return;
            FuelFilter.applyToEntry(found.entry, action.filter);
            this._emitCampfire(found.chunk, found.entry);
            return;
        }
        if (op === "setPaintFilter" && settle && settle.ownerId === p.id) {
            const uid = String(action.uid || "");
            const found = uid ? this._findThingByUid(uid) : null;
            const R = _research();
            if (!found || !R?.isPaintingCircle?.(this._thingDef(found.entry?.id), found.entry)) return;
            if (!Settlement.inRange(settle, found.entry.x, found.entry.y, TS)) return;
            R.applyPaintFilter(found.entry, action.filter);
            this._emitStorage(found.chunk, found.entry);
            return;
        }
        if (op === "setPaintEnabled" && settle && settle.ownerId === p.id) {
            const uid = String(action.uid || "");
            const found = uid ? this._findThingByUid(uid) : null;
            const R = _research();
            if (!found || !R?.isPaintingCircle?.(this._thingDef(found.entry?.id), found.entry)) return;
            if (!Settlement.inRange(settle, found.entry.x, found.entry.y, TS)) return;
            R.setEnabled(found.entry, action.enabled !== false);
            this._emitStorage(found.chunk, found.entry);
            return;
        }
        if ((op === "installTally" || op === "removeTally") && settle && settle.ownerId === p.id) {
            this._tryTallyOp(p, settle, action, op);
            return;
        }
        if (op === "setJobs" && settle && settle.ownerId === p.id) {
            settle.jobs = settle.jobs || {};
            settle.jobs[action.pawnId] = Settlement.normalizeJobs(action.jobs);
            SettlerWork.bumpWork?.(this);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "setJobOrder" && settle && settle.ownerId === p.id) {
            settle.jobOrder = Array.isArray(action.jobOrder) ? action.jobOrder : [];
            this._syncJobOrder(settle);
            SettlerWork.bumpWork?.(this);
            this._youDirty.add(p.id);
            return;
        }
        if (op === "unlockTech" && settle && settle.ownerId === p.id) {
            this._unlockTech(settle, action.techId);
            return;
        }
        if (op === "setStock" && settle && settle.ownerId === p.id) {
            settle.stock = Settlement.normalizeStock(action.stock);
            this._youDirty.add(p.id);
            return;
        }
    },

    _syncJobOrder(settle) {
        if (!settle || !Settlement?.normalizeJobOrder) return;
        const ids = (this.settlers || [])
            .filter((s) => s && !s.dead && s.homeSettlementId === settle.id)
            .map((s) => s.id);
        Settlement.normalizeJobOrder(settle, ids);
        if (Settlement.applyJobOrderToList) {
            this.settlers = Settlement.applyJobOrderToList(
                this.settlers || [],
                settle.id,
                settle.jobOrder,
                { idOf: (s) => s.id }
            );
        }
    },

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
    },

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
    },

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
    },

    _tickSettlerWork(mob, delta) {
        return SettlerWork.tick(this, mob, delta);
    },
    };
});
