/**
 * SimWorld prototype methods (gear).
 * Installed onto SimWorld.prototype. Method bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SimWorldMixins = root.SimWorldMixins || {};
        root.SimWorldMixins.gear = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    "use strict";
    const {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    } = ctx;
    return {

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
    },

    _ensureEquipment(p) {
        if (!p.equipment || typeof p.equipment !== "object") {
            p.equipment = { head: null, torso: null, legs: null, feet: null, back: null, waist: [] };
        }
        if (p.equipment.back === undefined) p.equipment.back = null;
        if (!Array.isArray(p.equipment.waist)) p.equipment.waist = [];
        if (!Array.isArray(p.overflow)) p.overflow = [];
        return p.equipment;
    },

    _equipSlotName(itemId) {
        const meta = itemDefs().get(itemId);
        return meta?.equip?.slot || null;
    },

    _waistGrant(itemId) {
        const add = itemDefs().get(itemId)?.equip?.effects?.addSlot;
        if (!Array.isArray(add)) return 0;
        let n = 0;
        for (const s of add) if (s === "waist") n++;
        return n;
    },

    _waistCapacity(p) {
        this._ensureEquipment(p);
        let n = 0;
        for (const key of ["head", "torso", "legs", "feet", "back"]) {
            const stack = p.equipment[key];
            if (stack?.id) n += this._waistGrant(stack.id);
        }
        return n;
    },

    _waistOccupied(p) {
        this._ensureEquipment(p);
        let n = 0;
        for (const s of p.equipment.waist) if (s) n++;
        return n;
    },

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
    },

    _afterApparelWear(creature) {
        const pawn = this._findOwnedPawn(creature?.id);
        if (!pawn) return;
        this._syncWaistSlots(pawn);
        this._syncPlayerInvSize(pawn);
        if (creature) creature.equipment = pawn.equipment;
        this._dirtyPawnOwner(pawn);
    },

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
    },

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
    },

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
    },

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
    },

    _normBag(bag) {
        return String(bag || "hotbar") === "overflow" ? "overflow" : "hotbar";
    },

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
    },

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
    },

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
    },

    _getEquipStack(p, slotKey) {
        this._ensureEquipment(p);
        if (String(slotKey).startsWith("waist:")) {
            const i = parseInt(String(slotKey).slice(6), 10);
            if (!Number.isInteger(i) || i < 0) return null;
            return p.equipment.waist[i] || null;
        }
        if (!["head", "torso", "legs", "feet", "back"].includes(slotKey)) return null;
        return p.equipment[slotKey] || null;
    },

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
    },

    _canChangeBodySlot(p, slotName, incomingId) {
        if (slotName === "waist" || String(slotName).startsWith("waist:")) return true;
        const current = p.equipment?.[slotName];
        const oldGrant = current?.id ? this._waistGrant(current.id) : 0;
        const newGrant = incomingId ? this._waistGrant(incomingId) : 0;
        const newCap = this._waistCapacity(p) - oldGrant + newGrant;
        return this._waistOccupied(p) <= newCap;
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    /** Character → world stack (spoilLeft → spoilAt). */
    _cloneStackForWorld(stack) {
        if (!stack?.id) return null;
        const out = {
            id: Hide.canonicalItemId(stack.id),
            quantity: Math.max(1, Math.floor(Number(stack.quantity) || 1))
        };
        this._applyStackExtras(out, this._stackExtrasFrom(stack));
        const now = this.worldMinuteIndex();
        const spoilAt = Spoil.spoilAtForWorld(stack, now);
        if (spoilAt != null) out.spoilAt = spoilAt;
        delete out.spoilLeft;
        return out;
    },

    _corpseIdGone(id) {
        if (!id) return false;
        if (!this._removedCorpseSet && Array.isArray(this._removedCorpseIds)) {
            this._removedCorpseSet = new Set(this._removedCorpseIds);
        }
        return !!this._removedCorpseSet?.has(id);
    },

    /** Remember a removed corpse id so a stale chunk copy cannot revive it on load. */
    _rememberRemovedCorpse(id) {
        if (!id || this._corpseIdGone(id)) return;
        if (!Array.isArray(this._removedCorpseIds)) this._removedCorpseIds = [];
        if (!this._removedCorpseSet) this._removedCorpseSet = new Set(this._removedCorpseIds);
        this._removedCorpseSet.add(id);
        this._removedCorpseIds.push(id);
        while (this._removedCorpseIds.length > 4000) {
            const old = this._removedCorpseIds.shift();
            this._removedCorpseSet.delete(old);
        }
    },

    /**
     * Drop every copy of a corpse id. One death used to leave a second copy in another chunk.
     * `aliasId` is the id the client clicked when it did not match the saved body.
     */
    _eraseCorpse(id, aliasId = null) {
        if (!id) return false;
        let removed = false;
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.corpses)) continue;
            for (let i = c.corpses.length - 1; i >= 0; i--) {
                if (c.corpses[i]?.id === id) {
                    c.corpses.splice(i, 1);
                    removed = true;
                }
            }
        }
        if (!removed) return false;
        this._rememberRemovedCorpse(id);
        this.pushEvent({ kind: "corpse", op: "remove", id });
        if (aliasId && aliasId !== id && !this._findCorpse(aliasId)) {
            this._rememberRemovedCorpse(aliasId);
            this.pushEvent({ kind: "corpse", op: "remove", id: aliasId });
        }
        return true;
    },

    /**
     * Exactly one corpse within `radius` px, optionally filtered.
     * Used when the client clicked a local body whose id the sim never stored.
     */
    _soleCorpseNear(x, y, radius, pred) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const r2 = radius * radius;
        let found = null;
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.corpses)) continue;
            for (let i = 0; i < c.corpses.length; i++) {
                const e = c.corpses[i];
                if (!e) continue;
                if (pred && !pred(e)) continue;
                const dx = (Number(e.x) || 0) - x;
                const dy = (Number(e.y) || 0) - y;
                if (dx * dx + dy * dy > r2) continue;
                if (found) return null;
                found = { chunk: c, index: i, entry: e };
            }
        }
        return found;
    },

    _resolveCorpse(action = {}) {
        const byId = action.corpseId ? this._findCorpse(action.corpseId) : null;
        if (byId) return byId;
        const x = Number(action.corpseX);
        const y = Number(action.corpseY);
        return this._soleCorpseNear(x, y, 24, null);
    },

    /**
     * Client authored a corpse id before the sim did (or after, with a different id).
     * Point the sim body at the client's id so a loot click removes the saved one.
     */
    _retargetCorpseId(found, newId, sourceUid = null) {
        if (!found?.entry?.id || !newId || found.entry.id === newId) return found?.entry || null;
        if (this._corpseIdGone(newId) || this._findCorpse(newId)) return found.entry;
        const oldId = found.entry.id;
        found.entry.id = newId;
        if (sourceUid) found.entry.sourceUid = sourceUid;
        this._rememberRemovedCorpse(oldId);
        this.pushEvent({ kind: "corpse", op: "remove", id: oldId });
        this.pushEvent({
            kind: "corpse",
            op: "add",
            cx: found.chunk.cx,
            cy: found.chunk.cy,
            entry: found.entry
        });
        return found.entry;
    },

    _retargetPlayerCorpse(p, action = {}) {
        const newId = typeof action?.corpseId === "string" ? action.corpseId.slice(0, 48) : "";
        if (!newId || !p || this._corpseIdGone(newId) || this._findCorpse(newId)) return;
        const x = Number(action.x);
        const y = Number(action.y);
        const found = this._soleCorpseNear(x, y, 96, (e) => !!e.playerCorpse);
        this._retargetCorpseId(found, newId, null);
    },

    _pushCorpse(opts) {
        const wx = Number(opts.x);
        const wy = Number(opts.y);
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
        if (opts.id && this._corpseIdGone(opts.id)) return null;
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
            stage: opts.stage === "carcass" ? "carcass" : "corpse",
            sourceUid: opts.sourceUid || null
        };
        const existing = entry.id
            ? c.corpses.find((e) => e && e.id === entry.id)
            : null;
        if (existing) {
            existing.x = entry.x;
            existing.y = entry.y;
            existing.key = entry.key;
            existing.look = entry.look;
            existing.frame = entry.frame;
            existing.name = entry.name;
            existing.loot = entry.loot;
            existing.body = entry.body;
            existing.bodyPlan = entry.bodyPlan;
            existing.mobId = entry.mobId;
            existing.skinned = entry.skinned;
            existing.playerCorpse = entry.playerCorpse;
            existing.diedAt = entry.diedAt;
            existing.stage = entry.stage;
            if (entry.sourceUid) existing.sourceUid = entry.sourceUid;
            this.pushEvent({ kind: "corpse", op: "add", cx, cy, entry: existing });
            return existing;
        }
        c.corpses.push(entry);
        this.pushEvent({ kind: "corpse", op: "add", cx, cy, entry });
        return entry;
    },

    _findCorpse(corpseId) {
        if (!corpseId) return null;
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.corpses)) continue;
            const index = c.corpses.findIndex((e) => e?.id === corpseId);
            if (index >= 0) return { chunk: c, index, entry: c.corpses[index] };
        }
        return null;
    },

    _meleeDamage(p) {
        const held = this._held(p);
        const meta = held ? itemDefs().get(held.id) : null;
        const atk = meta?.weapon?.attacks?.[0];
        const base = Number(atk?.damage);
        const dmg = Number.isFinite(base) && base > 0 ? base : 8;
        return dmg + this.rng() * (dmg * 0.35);
    },

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
    },

    _removeMobFromChunks(mobOrUid, _wx = null, _wy = null) {
        const uid = typeof mobOrUid === "string" ? mobOrUid : mobOrUid?.id || mobOrUid?.chunkUid;
        if (!uid) return null;
        // The chunk entry stays in the spawn chunk while x/y follow the mob.
        // A nearby-chunk search misses anything that walked more than one chunk
        // away, and that leftover entry becomes a new corpse on the next join.
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.mobs)) continue;
            const i = c.mobs.findIndex((m) => m && m.uid === uid);
            if (i >= 0) {
                const [entry] = c.mobs.splice(i, 1);
                return entry;
            }
        }
        return null;
    },

    _killMob(mob, killer) {
        if (!mob) return;
        this._finishMobDeath(mob, killer);
    },

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
    },

    _reapDeadPlayers() {
        for (const p of this.players.values()) {
            if (!p.connected || p.dead) continue;
            const creature = p.creature || this.creatures.get(p.id);
            if (!creature?.isBodyDead?.()) continue;
            p.body = creature.anatomy?.toJSON?.() || p.body;
            this._kill(p, creature._lastHitBy || null);
        }
    },

    /**
     * Fatal anatomy hits schedule onBodyFatal via queueMicrotask, so `_dead` often
     * flips AFTER the combat loop's death checks. Those mobs were then skipped by
     * liveMobs forever (no corpse). Reap any dead SimCreatures still in the map.
     */
    _reapDeadMobs() {
        for (const mob of [...this.mobs.values()]) {
            if (mob?.isBodyDead?.()) this._finishMobDeath(mob, mob._lastHitBy || null);
        }
    },

    /**
     * Wildlife death is authored here, but the client may already be showing a
     * corpse under its own id. Remember that id so loot removes the saved body.
     */
    _tryMobDeath(_p, action = {}) {
        const uid = action.uid ? String(action.uid).slice(0, 64) : "";
        const corpseId = typeof action.corpse?.id === "string" ? action.corpse.id.slice(0, 48) : "";
        if (!uid || !corpseId || this._corpseIdGone(corpseId)) return;
        const live = this.mobs.get(uid);
        if (live && !live.isBodyDead()) {
            if (!this._pendingMobCorpse) this._pendingMobCorpse = new Map();
            this._pendingMobCorpse.set(uid, {
                id: corpseId,
                x: Number(action.x),
                y: Number(action.y)
            });
            return;
        }
        let found = null;
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.corpses)) continue;
            for (let i = 0; i < c.corpses.length; i++) {
                if (c.corpses[i]?.sourceUid === uid) {
                    found = { chunk: c, index: i, entry: c.corpses[i] };
                    break;
                }
            }
            if (found) break;
        }
        if (!found) found = this._soleCorpseNear(Number(action.x), Number(action.y), 24, (e) => !e.playerCorpse);
        this._retargetCorpseId(found, corpseId, uid);
    },

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
        const pending = this._pendingMobCorpse?.get(uid) || null;
        this._pendingMobCorpse?.delete(uid);
        if (corpse) {
            const pendingId = pending?.id && !this._corpseIdGone(pending.id) ? pending.id : null;
            const px = Number(pending?.x);
            const py = Number(pending?.y);
            this._pushCorpse({
                id: pendingId || corpse.id,
                x: Number.isFinite(px) ? px : corpse.x,
                y: Number.isFinite(py) ? py : corpse.y,
                key: corpse.key,
                look: corpse.look || null,
                frame: corpse.frame != null ? corpse.frame : 7,
                name: corpse.name,
                loot: corpse.loot || [],
                body: corpse.body || null,
                bodyPlan: corpse.bodyPlan || "human",
                mobId: corpse.mobId || null,
                skinned: !!corpse.skinned,
                sourceUid: uid
            });
        }
    },

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
                { id: "raw_human_flesh", min: 2, max: 4 },
                { id: "brain", min: 1, max: 1 },
                { id: "bone", min: 1, max: 2 }
            ];
            return Body.isBrainDestroyed?.(bodyJson) ? loot.filter((d) => d.id !== "brain") : loot;
        }
        return [{ id: "bone", min: 1, max: 2 }];
    },

    _tryCorpseSkin(session, action = {}) {
        const p = this._actionPawn(session, action) || session;
        if (!p || p.dead) return;
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            p.x = action.x;
            p.y = action.y;
            if (p === session) session.poseAuth = true;
        }
        const held = this._held(p);
        const heldDef = held ? itemDefs().get(held.id) : null;
        if (!held || Carry.stackToolClass(held, heldDef) !== "knife") return;
        const found = this._resolveCorpse(action);
        if (!found) return;
        const { entry } = found;
        if (!CorpseDecay.canSkin(entry, this.worldMinuteIndex())) return;
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
        this._youDirty.add(session.id);
        this.pushEvent({
            kind: "corpse",
            op: "skin",
            entry: {
                id: entry.id,
                x: entry.x,
                y: entry.y,
                skinned: true,
                loot: entry.loot
            }
        });
    },

    _tryRackFlesh(session, action = {}) {
        const p = this._actionPawn(session, action) || session;
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
    },

    _tryRackBrain(session, action = {}) {
        const p = this._actionPawn(session, action) || session;
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
    },

    _tryCorpseTake(p, action = {}) {
        const actor = this._actionPawn(p, action) || p;
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            actor.x = action.x;
            actor.y = action.y;
            if (actor === p) p.poseAuth = true;
        }
        const found = this._resolveCorpse(action);
        if (!found) return;
        const { entry } = found;
        const dest = action.toPawnId ? this._partyGiveDest(p, action, actor) : actor;
        if (action.toPawnId && !dest) return;
        const receiver = dest || actor;
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
                    this._eraseCorpse(entry.id, this._requestedCorpseId(action));
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
                : this._give(receiver, stack.id, takeQty, this._stackExtrasFrom(stack)));
        const taken = takeQty - left;
        if (taken <= 0) {
            this._youDirty.add(p.id);
            return;
        }
        stack.quantity = (Math.floor(Number(stack.quantity) || 1)) - taken;
        if (!(stack.quantity > 0)) entry.loot.splice(slot, 1);
        this._youDirty.add(p.id);
        if (!entry.loot.filter(Boolean).length) {
            this._eraseCorpse(entry.id, this._requestedCorpseId(action));
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
    },

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
    },

    /** Empty corpse closed in the loot UI — same as SP removeForever. */
    _tryCorpseDismiss(p, action = {}) {
        const actor = this._actionPawn(p, action) || p;
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
            actor.x = action.x;
            actor.y = action.y;
            if (actor === p) p.poseAuth = true;
        }
        const found = this._resolveCorpse(action);
        if (!found) return;
        const { entry } = found;
        const dx = entry.x - actor.x;
        const dy = entry.y - actor.y;
        const r = TS * (HARVEST_RANGE_TILES + 2);
        if (dx * dx + dy * dy > r * r) return;
        const loot = Array.isArray(entry.loot) ? entry.loot.filter(Boolean) : [];
        if (loot.length) return;
        this._eraseCorpse(entry.id, this._requestedCorpseId(action));
    },

    _requestedCorpseId(action) {
        return typeof action?.corpseId === "string" ? action.corpseId.slice(0, 48) : "";
    },

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
    },

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
        const have = best.quantity || 1;
        const cap = Math.floor(Number(action.quantity) || 0);
        const want = cap > 0 ? Math.min(have, cap) : have;
        const leftWhole = this._give(p, best.id, want, this._stackExtrasFrom(best));
        const left = leftWhole + (have - want);
        if (left >= have) return; // nothing fit — leave drop
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
    },
    };
});
