/**
 * SimWorld prototype methods (structures).
 * Installed onto SimWorld.prototype. Method bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SimWorldMixins = root.SimWorldMixins || {};
        root.SimWorldMixins.structures = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    "use strict";
    const {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    } = ctx;
    return {

    _isCraftStationEntry(t) {
        if (!t) return false;
        const def = thingDefs().get(t.id);
        return !!def?.craftStation;
    },

    _isStorageEntry(t) {
        if (!t) return false;
        if (this._isCraftStationEntry(t)) return false;
        const def = thingDefs().get(t.id);
        if (_research()?.isPaintingCircle?.(def, t)) return false;
        if (Place.isFigurineThing(def, t)) return false;
        if (Array.isArray(t.slots)) return true;
        return !!def?.storage;
    },

    _isSleepEntry(t) {
        if (!t) return false;
        const def = thingDefs().get(t.id);
        return Place.isSleepThing(def, t);
    },

    _isPlaceableEntry(t) {
        const def = thingDefs().get(t?.id);
        return this._isStorageEntry(t) || this._isCraftStationEntry(t) || this._isSleepEntry(t)
            || Place.isSettlementThing(def, t)
            || Place.isFigurineThing(def, t)
            || !!_research()?.isPaintingCircle?.(def, t);
    },

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
        const R = _research();
        if (R?.isPaintingCircle?.(def, entry)) {
            R.ensureEntry(entry, def);
            return {
                uid: entry.uid,
                id: entry.id,
                x: entry.x,
                y: entry.y,
                cx: chunk?.cx,
                cy: chunk?.cy,
                rev: Number(entry.rev) || 0,
                rot: Place.normalizeRot(entry.rot),
                painted: entry.painted,
                paintProgress: entry.paintProgress,
                paintStarted: !!entry.paintStarted,
                paintPigment: entry.paintPigment || null,
                paintPigments: Array.isArray(entry.paintPigments) ? entry.paintPigments.slice() : [],
                paintEnabled: entry.paintEnabled !== false,
                tallyStick: !!entry.tallyStick,
                paintFilter: R.persistPaintFilter ? R.persistPaintFilter(entry.paintFilter) : (entry.paintFilter || null)
            };
        }
        if (Place.isFigurineThing(def, entry)) {
            Place.ensureFigurineEntry(entry);
            _forming()?.detachLegacyPlaceYaw?.(entry);
            const extras = this._stackExtrasFrom(entry) || {};
            return {
                uid: entry.uid,
                id: entry.id,
                x: entry.x,
                y: entry.y,
                cx: chunk?.cx,
                cy: chunk?.cy,
                rev: Number(entry.rev) || 0,
                rot: Place.normalizeRot(entry.rot),
                figurine: true,
                ...extras
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
            slots: (entry.slots || []).map((s) => (s?.id ? this._cloneStackForWorld(s) : null)),
            storageFilter: entry.storageFilter || null
        };
    },

    _bumpStorage(entry) {
        if (!entry) return;
        entry.rev = (Number(entry.rev) || 0) + 1;
    },

    _emitStorage(chunk, entry, extra = {}) {
        if (!chunk || !entry) return;
        SettlerWork.bumpWork?.(this);
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
    },

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
    },

    _tileKeyAt(tx, ty) {
        const { x, y } = this._tileCenter(tx, ty);
        const { cx, cy } = worldToChunk(x, y - 1);
        const c = this._ensureChunk(cx, cy);
        const lx = tx - c.cx * CS;
        const ly = ty - c.cy * CS;
        if (lx < 0 || ly < 0 || lx >= CS || ly >= CS) return null;
        return c.tiles[lx + ly * CS] || null;
    },

    _tryPlace(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead || p._resting) return;
        const invIndex = Math.floor(Number(p.hotbarIndex) || 0);
        const held = p.inventory?.[invIndex];
        if (!held?.id || !(held.quantity > 0)) return;
        const itemDef = itemDefs().get(held.id);
        const thingId = Place.heldPlaceThingId(itemDef, held);
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
        const tiles = Place.placeOccupyTiles
            ? Place.placeOccupyTiles(tx, ty, rot, thingDef)
            : Place.footprintTiles(tx, ty, rot, fp);
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
        const Research = _research();
        if (Research?.isPaintingCircle?.(thingDef)) {
            const hit = Settlement.atPoint(this._ownedSettlements(session.id), x, y, TS, session.id);
            if (!hit) {
                this.pushEvent({
                    kind: "combat_log",
                    text: "Must be placed in your settlement",
                    to: session.id
                });
                return;
            }
        }
        const figExtras = Place.isFigurineThing(thingDef) ? this._stackExtrasFrom(held) : null;
        if (Place.isFigurineThing(thingDef) && (!figExtras?.formVoxels || !Place.canPlaceFigurine(held))) {
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
                ownerName: session.name,
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

        if (Research?.isPaintingCircle?.(thingDef)) {
            const entry = {
                id: thingId,
                x,
                y,
                rot,
                uid: `pc_${Math.round(x)}_${Math.round(y)}`
            };
            Research.ensureEntry(entry, thingDef);
            chunk.things.push(entry);
            this._emitStorage(chunk, entry);
            return;
        }

        if (Place.isFigurineThing(thingDef)) {
            const entry = {
                id: thingId,
                x,
                y,
                rot,
                formPose: 1
            };
            Place.ensureFigurineEntry(entry);
            this._applyStackExtras(entry, figExtras);
            chunk.things.push(entry);
            this._emitStorage(chunk, entry);
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
        _research()?.ensureEntry?.(entry, thingDef);
        chunk.things.push(entry);
        this._emitStorage(chunk, entry);
    },

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
    },

    _trySleep(session, action = {}) {
        const op = String(action.op || "");
        if (op === "rest") this._sleepRest(session, action);
        else if (op === "wake") this._sleepWake(session, action);
        else if (op === "destroy") this._sleepDestroy(session, action);
    },

    _sleepLog(session, text) {
        if (!session || !text) return;
        this.pushEvent({
            kind: "combat_log",
            text: String(text),
            to: session.id
        });
    },

    _livingPartyOf(session) {
        const out = [];
        if (!session) return out;
        if (!session.dead) out.push(session);
        for (const m of session.party || []) {
            if (m && !m.dead) out.push(m);
        }
        return out;
    },

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
    },

    _sleepDef(entry) {
        return thingDefs().get(entry?.id);
    },

    _cancelRestWalksTo(uid) {
        for (const session of this.players.values()) {
            for (const pawn of this._ownedPawns(session)) {
                if (!pawn || pawn.dead || pawn._restWalk?.uid !== uid) continue;
                pawn._restWalk = null;
                const c = pawn.creature || this.creatures.get(pawn.id);
                if (c) c._restWalk = null;
                this._sleepLog(session, `${pawn.name || "They"} can't rest there`);
            }
        }
    },

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
        pawn.resting = false;
        pawn._restWalk = null;
        const c = pawn.creature || this.creatures.get(pawn.id);
        const downed = !!(c?.isImmobile?.() || c?.isIncapacitated?.());
        if (!downed) pawn.prone = false;
        if (c) {
            c._resting = false;
            c._restWalk = null;
            if (!downed) c._prone = false;
        }
    },

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
    },

    _orderRest(session, pawn, entry, slot, opts = {}) {
        if (!pawn || !entry) return false;
        if (this._sleepSlotClaimed(entry, slot, pawn.id)) {
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
    },

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
    },

    _occupySlot(session, pawn, entry, slot) {
        if (!pawn || !entry) return false;
        Place.ensureSleepEntry(entry, this._sleepDef(entry));
        if (entry.occupants[slot] && entry.occupants[slot] !== pawn.id) {
            this._sleepLog(session, "That spot is taken");
            pawn._restWalk = null;
            const stand = Sleep.restWalkStand
                ? Sleep.restWalkStand(entry, slot, TS, this._sleepDef(entry))
                : Sleep.besideWorldPos(entry, TS, this._sleepDef(entry));
            pawn.x = stand.x;
            pawn.y = stand.y;
            const c = pawn.creature || this.creatures.get(pawn.id);
            if (c) {
                c.x = stand.x;
                c.y = stand.y;
                c._restWalk = null;
                c.setDesiredVel?.(0, 0);
            }
            return false;
        }
        this._vacatePawn(pawn);
        entry.occupants[slot] = pawn.id;
        pawn._restWalk = null;
        pawn._resting = true;
        pawn.resting = true;
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
    },

    _wakePawn(session, pawn, opts = {}) {
        if (!pawn) return;
        const last = pawn.lastSleep;
        this._vacatePawn(pawn);
        pawn._resting = false;
        pawn.resting = false;
        pawn._restWalk = null;
        pawn._settlerAct = null;
        const c = pawn.creature || this.creatures.get(pawn.id);
        const downed = !!(c?.isImmobile?.() || c?.isIncapacitated?.());
        if (!downed) pawn.prone = false;
        if (c) {
            c._resting = false;
            c._restWalk = null;
            c._settlerAct = null;
            if (!downed) c._prone = false;
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
    },

    _sleepWake(session, action) {
        const pawn = this._actionPawn(session, action);
        if (!pawn || !pawn._resting) return;
        this._wakePawn(session, pawn, { manual: true });
    },

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
    },

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
        if (this._sleepSlotClaimed(entry, spec.slot, pawn.id)) {
            const next = this._pickFreeSleepSlot(pawn, entry);
            if (next) {
                pawn._restWalk = { uid: next.entry.uid, slot: next.slot };
                pawn.lastSleep = { uid: next.entry.uid, slot: next.slot, rot: next.entry.rot };
                const c = pawn.creature || this.creatures.get(pawn.id);
                if (c) {
                    c._restWalk = pawn._restWalk;
                    c.lastSleep = pawn.lastSleep;
                }
                return;
            }
            const stand = Sleep.restWalkStand
                ? Sleep.restWalkStand(entry, spec.slot, TS, def)
                : Sleep.besideWorldPos(entry, TS, def);
            pawn.x = stand.x;
            pawn.y = stand.y;
            pawn._restWalk = null;
            const c = pawn.creature || this.creatures.get(pawn.id);
            if (c) {
                c.x = stand.x;
                c.y = stand.y;
                c._restWalk = null;
                c.setDesiredVel?.(0, 0);
            }
            this._sleepLog(session, "That spot is taken");
            return;
        }
        const stand = Sleep.restWalkStand
            ? Sleep.restWalkStand(entry, spec.slot, TS, def)
            : null;
        const pos = Sleep.sleeperWorldPos(entry, spec.slot, TS, def);
        const arrive = Sleep.ARRIVE_PX || 16;
        let close = false;
        if (stand) {
            close = Math.hypot(Number(pawn.x) - stand.x, Number(pawn.y) - stand.y) < arrive;
        }
        if (!close) {
            const cx = Number(pawn.x) + TS * 0.5;
            const cy = Number(pawn.y) - TS * 0.5;
            close = Math.hypot(cx - pos.x, cy - pos.y) < arrive;
        }
        if (close) {
            this._occupySlot(session, pawn, entry, spec.slot);
            return;
        }
        // No session: the owner is offline. Camp settlers still walk themselves.
        if (!session) return;
        const controlId = session.controlId || session.id;
        if (pawn.id === controlId) return;
        // Uncontrolled rest-walk is PartyAI._walkToward (same as SP).
    },

    _tickSleepWalks(dtMs) {
        const dt = dtMs / 1000;
        const stepped = new Set();
        for (const session of this.players.values()) {
            if (!session.connected) continue;
            const traveling = new Set(
                this._livingPartyOf(session).map((p) => p && p.id).filter(Boolean)
            );
            for (const pawn of this._ownedPawns(session)) {
                if (!pawn || pawn.dead) continue;
                stepped.add(pawn.id);
                if (pawn._restWalk) this._stepRestWalk(session, pawn, dt);
                else if (pawn._resting) {
                    pawn.vx = 0;
                    pawn.vy = 0;
                    const c = pawn.creature || this.creatures.get(pawn.id);
                    if (c) {
                        c.x = pawn.x;
                        c.y = pawn.y;
                        c.vx = 0;
                        c.vy = 0;
                        c.setDesiredVel?.(0, 0);
                        c._resting = true;
                    }
                } else if (pawn._wokeFromRest && traveling.has(pawn.id)) {
                    const assist = pawn.creature?.ai?.assistTarget;
                    if (!assist && !this._shouldDelaySleep(session, pawn)) {
                        this._tryReturnToBed(session, pawn);
                    }
                }
            }
        }
        // Camp settlers keep walking to bed after their owner logs off.
        for (const rec of this.settlers || []) {
            if (!rec || rec.dead || stepped.has(rec.id)) continue;
            if (rec._restWalk) this._stepRestWalk(null, rec, dt);
            else if (rec._resting || rec.resting) {
                rec.vx = 0;
                rec.vy = 0;
                const c = rec.creature || this.creatures.get(rec.id);
                if (c) {
                    c.x = rec.x;
                    c.y = rec.y;
                    c.vx = 0;
                    c.vy = 0;
                    c.setDesiredVel?.(0, 0);
                    c._resting = true;
                }
            }
        }
    },

    _sleepSlotClaimed(entry, slot, exceptId) {
        if (!entry) return true;
        const occ = entry.occupants?.[slot];
        if (occ && occ !== exceptId) return true;
        for (const p of this.players.values()) {
            for (const pawn of this._livingPartyOf(p)) {
                if (pawn.id === exceptId) continue;
                if (pawn._restWalk?.uid === entry.uid && pawn._restWalk.slot === slot) return true;
                if (pawn._resting && pawn.lastSleep?.uid === entry.uid
                    && (pawn.lastSleep.slot || 0) === slot) {
                    return true;
                }
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
    },

    _pickFreeSleepSlot(pawn, preferEntry = null) {
        if (!pawn) return null;
        const consider = (e) => {
            if (!this._isSleepEntry(e)) return null;
            Place.ensureSleepEntry(e, this._sleepDef(e));
            if (!Sleep.inCampRange(pawn.x, pawn.y, e.x, e.y, TS)) return null;
            const n = Sleep.slotCount(this._sleepDef(e), e);
            let best = null;
            let bestD = Infinity;
            for (let i = 0; i < n; i++) {
                if (this._sleepSlotClaimed(e, i, pawn.id)) continue;
                const d = Math.hypot(pawn.x - e.x, pawn.y - e.y) + i * 0.01;
                if (d < bestD) {
                    bestD = d;
                    best = { entry: e, slot: i };
                }
            }
            return best;
        };
        if (preferEntry) {
            const hit = consider(preferEntry);
            if (hit) return hit;
        }
        let best = null;
        let bestD = Infinity;
        for (const ch of this._chunksNear(pawn.x, pawn.y, 2)) {
            if (!Array.isArray(ch.things)) continue;
            for (const e of ch.things) {
                const hit = consider(e);
                if (!hit) continue;
                const d = Math.hypot(pawn.x - hit.entry.x, pawn.y - hit.entry.y) + hit.slot * 0.01;
                if (d < bestD) {
                    bestD = d;
                    best = hit;
                }
            }
        }
        return best;
    },

    _tryInjuredRest(session, pawn) {
        if (!session || !pawn || pawn._resting || pawn._restWalk || pawn._wokeFromRest) return;
        const controlId = session.controlId || session.id;
        if (pawn.id === controlId) return;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (!Sleep.injuredForAutofill(c?.anatomy)) return;
        if (c?.isIncapacitated?.() || c?.isImmobile?.() || pawn.prone) return;
        if (c?.ai?.assistTarget) return;
        if (c?._tending || c?.ai?.tendSeek) return;
        if (this._shouldDelaySleep(session, pawn)) return;
        if (this._partyNeedsAutoTend(session)) return;
        if (session.lastHitMob && Date.now() - (Number(session.lastHitAt) || 0) < 8000) return;
        const control = this._actionPawn(session, { pawnId: controlId });
        if (control && Math.hypot(control.vx || 0, control.vy || 0) > 8) return;
        this._tryReturnToBed(session, pawn);
    },

    _tryReturnToBed(session, pawn) {
        if (!pawn || pawn._resting || pawn._restWalk) return;
        const controlId = session?.controlId || session?.id;
        if (controlId && pawn.id === controlId) return;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (!Sleep.capableToFight(c || pawn)) {
            pawn._wokeFromRest = false;
            return;
        }
        const last = pawn.lastSleep;
        let picked = null;
        if (last?.uid) {
            const found = this._findSleepByUid(last.uid, pawn);
            const entry = found?.entry || null;
            const slot = last.slot || 0;
            if (entry && !this._sleepSlotClaimed(entry, slot, pawn.id)) {
                picked = { entry, slot };
            }
        }
        if (!picked) picked = this._pickFreeSleepSlot(pawn);
        pawn._wokeFromRest = false;
        if (picked) this._orderRest(session, pawn, picked.entry, picked.slot, { autofill: false });
    },

    _everyoneLying() {
        const sessions = [...this.players.values()].filter((p) => p.connected);
        if (!sessions.length) return false;
        for (const p of sessions) {
            for (const pawn of this._livingPartyOf(p)) {
                if (!pawn._resting) return false;
            }
        }
        return true;
    },

    _applyRestClock(dtMs = 0) {
        const base = Number.isFinite(this.baseTickSpeed) ? this.baseTickSpeed : (this.tickSpeed || 1);
        this.baseTickSpeed = base;
        const everyone = this._everyoneLying();
        if (!everyone) this._restSpeedElapsedMs = 0;
        else {
            this._restSpeedElapsedMs = (this._restSpeedElapsedMs || 0)
                + Math.max(0, Number(dtMs) || 0);
        }
        this.tickSpeed = Sleep.effectiveTickSpeed(base, everyone, this._restSpeedElapsedMs || 0);
    },

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
    },

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
    },

    _onSleepCombatHit(victimCreature, attacker) {
        if (!victimCreature || victimCreature.isBodyDead?.()) return;
        if (attacker && Party.sameFaction?.(victimCreature, attacker)) return;
        if (!attacker || attacker === victimCreature) return;
        const victim = this._findOwnedPawn(victimCreature.id);
        if (!victim) return;
        if (victim.homeSettlementId || victimCreature.homeSettlementId || victimCreature.role === "settler") {
            this._aggroSettlement(victimCreature, attacker);
        }
        const session = this._sessionOfPawn(victim);
        this._wakeAbleResters(session, attacker, victim);
        this._partySetAssist(session, attacker);
        if (!victim._resting) victimCreature.ai?.setAssist?.(attacker);
    },

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
    },

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
    },

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
    },

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
    },

    _findPlayerStorage(p, action = {}) {
        if (!p) return null;
        const range2 = (TS * HARVEST_RANGE_TILES) * (TS * HARVEST_RANGE_TILES);
        const wantUid = action.uid != null && action.uid !== "" ? String(action.uid) : null;
        const ax = Number(action.x);
        const ay = Number(action.y);
        const wantXy = Number.isFinite(ax) && Number.isFinite(ay);
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
                if (wantUid) {
                    if (t.uid != null && String(t.uid) === wantUid) return { chunk: c, entry: t };
                    continue;
                }
                if (wantXy && Math.abs(t.x - ax) < 1.5 && Math.abs(t.y - ay) < 1.5) {
                    return { chunk: c, entry: t };
                }
                if (d2 < bestD) {
                    bestD = d2;
                    best = { chunk: c, entry: t };
                }
            }
        }
        return wantUid || wantXy ? null : best;
    },

    _storageGetSlot(entry, key) {
        const def = thingDefs().get(entry?.id);
        Place.ensureStorageEntry(entry, def);
        const idx = Place.parseSlotIndex(key, entry.slots.length);
        if (idx < 0) return undefined;
        return entry.slots[idx] || null;
    },

    _storageSetSlot(entry, key, stack) {
        const def = thingDefs().get(entry?.id);
        Place.ensureStorageEntry(entry, def);
        const idx = Place.parseSlotIndex(key, entry.slots.length);
        if (idx < 0) return;
        entry.slots[idx] = stack || null;
    },

    _tryStorage(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const found = this._findPlayerStorage(p, action);
        if (!found) return;
        const { chunk, entry } = found;
        const def = thingDefs().get(entry.id);
        const op = String(action.op || "");
        if (op === "attend" || op === "leave") return;
        const R = _research();
        if (R?.isPaintingCircle?.(def, entry)) {
            if (op !== "pickup") return;
            this._tryPickupPaintingCircle(p, chunk, entry);
            return;
        }
        if (Place.isFigurineThing(def, entry)) {
            if (op !== "pickup") return;
            this._tryPickupFigurine(p, chunk, entry);
            return;
        }
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
    },

    _coveringSettlements(entry) {
        const out = [];
        if (!entry) return out;
        for (const s of this.settlements || []) {
            if (s && Settlement.inRange(s, entry.x, entry.y, TS)) out.push(s);
        }
        return out;
    },

    _tryPickupPaintingCircle(p, chunk, entry) {
        const R = _research();
        if (!p || !chunk || !entry || !R) return;
        R.ensureEntry(entry, this._thingDef(entry.id));
        const covering = this._coveringSettlements(entry);
        for (const settle of covering) {
            const oid = settle.ownerId;
            const holder = this._researchHolder(oid);
            const circles = this._ownerResearchCircles(oid);
            if (!R.canRemoveCircle(holder, circles, entry, this._researchExtra(oid))) return;
        }
        const pigmentId = R.currentPigmentId(entry);
        if (pigmentId) this._pushDrop(entry.x, entry.y, { id: pigmentId, quantity: 1 });
        if (R.hasTally?.(entry)) {
            this._pushDrop(entry.x, entry.y, { id: R.TALLY_ITEM_ID || "tally_stick", quantity: 1 });
        }
        const itemId = Place.itemIdForThing(entry.id, itemDefs());
        const leftover = this._give(p, itemId, 1);
        if (leftover > 0) {
            this._pushDrop(p.x, p.y, { id: itemId, quantity: leftover });
        }
        this._unlinkStationUid(entry.uid);
        const i = chunk.things.indexOf(entry);
        if (i >= 0) chunk.things.splice(i, 1);
        this._emitStorageRemoved(chunk, entry);
        for (const settle of covering) {
            this._youDirty.add(settle.ownerId);
        }
        this._dirtyPawnOwner(p);
    },

    _tryPickupFigurine(p, chunk, entry) {
        if (!p || !chunk || !entry) return;
        _forming()?.detachLegacyPlaceYaw?.(entry);
        const extras = this._stackExtrasFrom(entry);
        const stack = { id: "clay_figurine", quantity: 1 };
        this._applyStackExtras(stack, extras);
        this._insertUniqueStack(p, stack);
        const i = chunk.things.indexOf(entry);
        if (i >= 0) chunk.things.splice(i, 1);
        this._emitStorageRemoved(chunk, entry);
        this._dirtyPawnOwner(p);
    },

    _hangIfRack(entry, stack) {
        if (!stack) return stack;
        const def = thingDefs().get(entry?.id);
        if (!Hide.isDryingRack(def, entry)) return stack;
        return Hide.hangStack(stack, this.worldMinuteIndex(), (id) => itemDefs().get(id));
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },
    };
});
