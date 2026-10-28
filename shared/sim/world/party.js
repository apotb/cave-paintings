/**
 * SimWorld prototype methods (party).
 * Installed onto SimWorld.prototype. Method bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SimWorldMixins = root.SimWorldMixins || {};
        root.SimWorldMixins.party = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    "use strict";
    const {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    } = ctx;
    return {

    _thingDef(id) {
        return thingDefs().get(id);
    },

    _itemDef(id) {
        return itemDefs().get(id);
    },

    /** Drop the cached uid map so the next lookup rebuilds it. */
    _invalidateUidIndex() {
        this._uidBuiltGen = -1;
    },

    /**
     * push/splice are how things appear and disappear. Wrapping those keeps the
     * uid map honest without walking every explored chunk every frame.
     */
    _watchThingList(chunk, key) {
        const list = chunk && chunk[key];
        if (!Array.isArray(list) || list._uidWatch) return;
        const world = this;
        const push = list.push;
        const splice = list.splice;
        list.push = function () {
            const n = push.apply(this, arguments);
            world._invalidateUidIndex();
            world._bumpChunkCollision(chunk);
            return n;
        };
        list.splice = function () {
            const removed = splice.apply(this, arguments);
            world._invalidateUidIndex();
            world._bumpChunkCollision(chunk);
            return removed;
        };
        Object.defineProperty(list, "_uidWatch", { value: true });
    },

    _watchChunkThings(chunk) {
        this._watchThingList(chunk, "things");
        this._watchThingList(chunk, "lootableThings");
    },

    _buildUidIndex() {
        const map = new Map();
        for (const c of this.chunks.values()) {
            for (const t of c.things || []) {
                if (t?.uid != null) map.set(String(t.uid), { chunk: c, entry: t });
            }
            for (const t of c.lootableThings || []) {
                if (t?.uid != null) map.set(String(t.uid), { chunk: c, entry: t });
            }
        }
        this._uidIndex = map;
        return map;
    },

    /** True when the indexed object is still in that chunk's live lists. */
    _uidEntryLive(hit, want) {
        const entry = hit?.entry;
        const chunk = hit?.chunk;
        if (!entry || !chunk || String(entry.uid) !== want) return false;
        const things = chunk.things;
        if (Array.isArray(things)) {
            for (let i = 0; i < things.length; i++) {
                if (things[i] === entry) return true;
            }
        }
        const loot = chunk.lootableThings;
        if (Array.isArray(loot)) {
            for (let i = 0; i < loot.length; i++) {
                if (loot[i] === entry) return true;
            }
        }
        return false;
    },

    _findThingByUid(uid) {
        if (uid == null || uid === "") return null;
        const want = String(uid);
        const map = this._uidIndex;
        const hit = map && map.get(want);
        if (hit && this._uidEntryLive(hit, want)) return hit;
        if (hit && map) map.delete(want);
        // One full walk of the explored map per tick, and only after a miss.
        // Steady settler lookups stay on the map built last time something moved.
        const gen = this._queryGen | 0;
        if (map && this._uidBuiltGen === gen) return null;
        const built = this._buildUidIndex();
        this._uidBuiltGen = gen;
        const again = built.get(want);
        return again && this._uidEntryLive(again, want) ? again : null;
    },

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
    },

    /** Names already carried by a living player, companion, settler, or wanderer. */
    _livingNames() {
        const names = [];
        const add = (pawn) => {
            if (!pawn || pawn.dead) return;
            const name = pawn.name || pawn.pawnName;
            if (name) names.push(name);
        };
        if (this.players && typeof this.players.values === "function") {
            for (const p of this.players.values()) {
                add(p);
                for (const m of p?.party || []) add(m);
            }
        }
        for (const s of this.settlers || []) add(s);
        if (this.wanderers && typeof this.wanderers.values === "function") {
            for (const w of this.wanderers.values()) add(w);
        }
        return names;
    },

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
    },

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
    },

    _pawnVomiting(pawn) {
        if (this._isVomiting(pawn)) return true;
        const c = pawn?.creature || this.creatures.get(pawn?.id);
        return Number(c?._vomitRemainingMs) > 0;
    },

    _handleRecruit(p, action) {
        const wid = action.wandererId;
        const w = this.wanderers.get(wid);
        if (!w || w.hostile || w.recruitLocked || w.band) return;
        const control = (p.party || []).find((m) => m.id === p.controlId) || p;
        if (!Party.inInteractRange(control, w, TS)) return;
        // Party list is companions only. Headcount includes the leader.
        const head = (p.party || []).length + 1;
        const full = !Settlement.partyHasRoom(head, Party.CAP);
        const camp = Settlement.sharedCamp(
            this._ownedSettlements(p.id),
            control.x, control.y,
            w.x, w.y,
            TS,
            p.id
        );
        // A full party cannot recruit. Inside your own camp, they join as a settler.
        if (full && !camp) return;
        const refused = w.refusedBy || [];
        if (refused.includes(p.id)) return;
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
            bio: w.bio,
            x: w.x,
            y: w.y,
            facing: w.facing,
            inventory: w.inventory,
            kc: Party.rollRoughKc(() => this.rng()),
            body: w.body || null
        });
        const park = full ? camp : null;
        if (park) {
            rec.role = "settler";
            rec.homeSettlementId = park.id;
            rec.ownerId = p.id;
            Settlement.bindPawnJobs(park, rec);
            Settlement.bindPawnSchedule(park, rec);
            this.settlers.push(rec);
            this._ensureSettlerCreature(rec);
            this._syncJobOrder(park);
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
            to: p.id,
            settled: !!park,
            settlementId: park ? park.id : null,
            settlementName: park ? (park.name || "") : null
        });
    },

    /**
     * Send one of your companions or settlers away. Gear is destroyed, not dropped.
     * They walk off and will not accept another recruit.
     */
    _handleBanish(p, action) {
        const id = action?.pawnId;
        if (!p || !id || id === p.id) return;
        let rec = null;
        let partyIndex = -1;
        const party = p.party || [];
        for (let i = 0; i < party.length; i++) {
            if (party[i] && party[i].id === id && !party[i].dead) {
                rec = party[i];
                partyIndex = i;
                break;
            }
        }
        if (!rec) {
            rec = (this.settlers || []).find((s) => s && s.id === id && s.ownerId === p.id && !s.dead) || null;
        }
        if (!rec) return;
        if (p.controlId === id) this._setControlId(p, p.id, { allowDead: true });
        this._cancelChannels(rec);
        const creature = rec.creature || this.creatures.get(rec.id);
        if (!Number.isFinite(Number(rec.x)) && creature) rec.x = creature.x;
        if (!Number.isFinite(Number(rec.y)) && creature) rec.y = creature.y;
        const empty = emptyInv(Math.max(5, Array.isArray(rec.inventory) ? rec.inventory.length : 5));
        const eq = this._emptyEquipment();
        rec.inventory = empty;
        rec.overflow = [];
        rec.equipment = eq;
        rec.hotbarIndex = 0;
        if (creature) {
            creature.inventory = empty;
            creature.overflow = [];
            creature.equipment = eq;
            creature.hotbarIndex = 0;
        }
        if (partyIndex >= 0) party.splice(partyIndex, 1);
        else this.settlers = (this.settlers || []).filter((s) => s !== rec);
        const ox = Number(rec.x);
        const oy = Number(rec.y);
        let hx = (Number.isFinite(ox) ? ox : 0) - (Number(p.x) || 0);
        let hy = (Number.isFinite(oy) ? oy : 0) - (Number(p.y) || 0);
        if (Math.hypot(hx, hy) < 0.01) {
            hx = 1;
            hy = 0;
        }
        this._releaseSettlerAsWanderer(rec, { x: hx, y: hy });
        const gone = this.wanderers.get(rec.id);
        if (gone) {
            gone.recruitLocked = true;
            gone.inventory = empty;
            gone.overflow = [];
            gone.equipment = eq;
        }
        const name = rec.name || "Someone";
        this._youDirty.add(p.id);
        this.pushEvent({
            kind: "banish",
            pawnId: id,
            name,
            heading: gone?.heading || { x: hx, y: hy },
            to: p.id
        });
        this.pushEvent({
            kind: "combat_log",
            text: `${name} has been banished`,
            feed: true,
            to: p.id
        });
    },

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
    },

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
    },

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
    },

    _beginPawnEat(eater, pick) {
        if (!eater || eater.dead || this._pawnVomiting(eater) || eater.eatChannel) return false;
        const from = pick?.pawn || pick?.from || eater;
        const session = this._sessionOfPawn(eater);
        const controlId = session?.controlId || session?.id;
        if (controlId && from?.id === controlId && eater.id !== controlId) return false;
        const slot = Number(pick?.slot);
        const bag = this._normBag(pick?.bag);
        const stack = pick?.stack || this._pawnBag(from, bag)?.[slot];
        if (!stack || !Number.isInteger(slot) || slot < 0) return false;
        const food = this._foodForEat(stack);
        if (!(Number(food.kc) > 0)) return false;
        const isMeal = this._isPartialFood(stack);
        const room = (Number(eater.stomach) || 0) - (Number(eater.kc) || 0);
        if (isMeal && !(room > 0)) return false;
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
        const poison = Number(food.foodPoisonChance ?? 0) > 0;
        eater._eatSitting = {
            until: poison ? (Number(eater.kc) || 0) + 1 : (Party.AUTO_EAT_UNTIL || 1400),
            poisonStop: poison
        };
        this._pushEatChannelEvent(eater);
        this._dirtyPawnOwner(eater);
        return true;
    },

    _eatChannelSnap(ch) {
        if (!ch || !(Number(ch.max) > 0)) return null;
        return {
            progress: Math.max(0, Math.min(1, 1 - (Number(ch.remaining) || 0) / ch.max)),
            itemId: ch.itemId || null
        };
    },

    _fishSnap(pawn) {
        const ch = pawn?.fishChannel;
        if (!ch || !Number.isFinite(Number(ch.waterTx)) || !Number.isFinite(Number(ch.waterTy))) return null;
        return { waterTx: ch.waterTx | 0, waterTy: ch.waterTy | 0 };
    },

    _pushEatChannelEvent(pawn, extra = {}) {
        if (!pawn) return;
        const session = this._sessionOfPawn(pawn);
        const ch = pawn.eatChannel;
        let progress = extra.progress;
        if (progress == null) {
            const snap = this._eatChannelSnap(ch);
            progress = snap ? snap.progress : 0;
        }
        this.pushEvent({
            kind: "channel",
            playerId: session?.id || pawn.id,
            pawnId: pawn.id,
            channel: "eat",
            itemId: extra.itemId || ch?.itemId || null,
            progress: Math.max(0, Math.min(1, Number(progress) || 0)),
            ...(extra.done ? { done: true } : {}),
            ...(extra.cancelled ? { cancelled: true } : {})
        });
    },

    _tickEatChannel(pawn, dtMs) {
        if (!pawn?.eatChannel) return;
        if (this._pawnVomiting?.(pawn)) {
            this._clearEatChannel(pawn);
            return;
        }
        const session = this._sessionOfPawn(pawn);
        const controlId = session?.controlId || session?.id;
        if (controlId && pawn.eatChannel.fromId === controlId && pawn.id !== controlId) {
            this._clearEatChannel(pawn);
            return;
        }
        pawn.eatChannel.remaining -= dtMs;
        this._pushEatChannelEvent(pawn);
        if (pawn.eatChannel.remaining <= 0) this._finishEat(pawn);
    },

    _tendChannelSnap(ch) {
        if (!ch || !(Number(ch.max) > 0)) return null;
        return {
            progress: Math.max(0, Math.min(1, 1 - (Number(ch.remaining) || 0) / ch.max)),
            itemId: ch.itemId || null,
            patientId: ch.patientId || null,
            patientName: ch.patientName || null
        };
    },

    /** Hover line while a pawn tends, or walks over to tend, someone else. */
    _pawnTendActivity(pawn) {
        if (!pawn || pawn.dead) return null;
        if (this._pawnVomiting?.(pawn)) return "Vomiting";
        const selfId = pawn.id;
        const named = (id, name) => {
            if (!id || id === selfId) return null;
            const n = this._findOwnedPawn(id)?.name || name || null;
            return n ? `Tending ${n}` : "Tending";
        };
        const ch = pawn.tendChannel;
        if (ch && Number(ch.max) > 0) {
            return named(ch.patientId, ch.patientName) || "Tending";
        }
        const seek = pawn.creature?.ai?.tendSeek
            || this.creatures.get(pawn.id)?.ai?.tendSeek;
        if (seek) {
            return named(seek.id, seek.name || seek.pawnName) || "Tending";
        }
        return null;
    },

    _pushTendChannelEvent(pawn, extra = {}) {
        if (!pawn) return;
        const session = this._sessionOfPawn(pawn);
        const ch = pawn.tendChannel;
        let progress = extra.progress;
        if (progress == null) {
            const snap = this._tendChannelSnap(ch);
            progress = snap ? snap.progress : 0;
        }
        this.pushEvent({
            kind: "channel",
            playerId: session?.id || pawn.id,
            pawnId: pawn.id,
            channel: "tend",
            itemId: extra.itemId || ch?.itemId || null,
            patientId: extra.patientId || ch?.patientId || null,
            patientName: extra.patientName || ch?.patientName || null,
            progress: Math.max(0, Math.min(1, Number(progress) || 0)),
            ...(extra.done ? { done: true } : {}),
            ...(extra.cancelled ? { cancelled: true } : {})
        });
    },

    _pawnCapacities(p) {
        if (!p) return null;
        const session = this._sessionOfPawn(p);
        const creature = this._creatureForPawn(session, p)
            || p.creature
            || this.creatures.get(p.id);
        if (!creature?.anatomy) return null;
        creature.refreshCapacities?.();
        return creature.capacities || new Capacities(creature.anatomy);
    },

    _eatingDurationScale(p) {
        try {
            const scale = Number(this._pawnCapacities(p)?.eatingDurationScale?.());
            return Number.isFinite(scale) && scale > 0 ? scale : 1;
        } catch (_) {
            return 1;
        }
    },

    _manipulationDurationScale(p) {
        try {
            const scale = Number(this._pawnCapacities(p)?.manipulationDurationScale?.());
            return Number.isFinite(scale) && scale > 0 ? scale : 1;
        } catch (_) {
            return 1;
        }
    },

    _clearTendChannel(pawn, extra = {}) {
        if (!pawn?.tendChannel && !extra.force) return;
        const ch = pawn.tendChannel;
        pawn.tendChannel = null;
        pawn.tending = false;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (c) c._tending = false;
        if (ch || extra.cancelled) {
            this._pushTendChannelEvent(pawn, {
                progress: extra.progress ?? 0,
                done: true,
                cancelled: extra.cancelled !== false,
                itemId: extra.itemId || ch?.itemId || null
            });
            this._dirtyPawnOwner(pawn);
        }
    },

    _tendChannelStillValid(tender, ch) {
        if (!tender || !ch) return false;
        if (tender.dead || this._pawnVomiting(tender) || tender.eatChannel) return false;
        const from = (ch.fromId && this._findOwnedPawn(ch.fromId)) || tender;
        const bag = this._normBag(ch.bag);
        const slot = Number(ch.slot);
        const held = this._pawnBag(from, bag)?.[slot];
        if (!held?.id || (ch.itemId && held.id !== ch.itemId)) return false;
        if (!itemDefs().get(held.id)?.bandage) return false;
        const patient = (ch.patientId && this._findOwnedPawn(ch.patientId)) || tender;
        if (!patient || patient.dead) return false;
        if (patient.id !== tender.id && !Party.inInteractRange(tender, patient, TS)) return false;
        const c = tender.creature || this.creatures.get(tender.id);
        if (c?.isIncapacitated?.() || c?.isAttacking?.()) return false;
        return true;
    },

    _beginPawnTend(tender, pick) {
        if (!tender || tender.dead || this._pawnVomiting(tender) || tender.eatChannel || tender.tendChannel) {
            return false;
        }
        const patient = pick?.patient || tender;
        const from = pick?.source || pick?.pawn || tender;
        const slot = Number(pick?.slot);
        const bag = this._normBag(pick?.bag);
        const stack = pick?.stack || this._pawnBag(from, bag)?.[slot];
        if (!stack || !Number.isInteger(slot) || slot < 0) return false;
        const meta = itemDefs().get(stack.id);
        if (!meta?.bandage) return false;
        const session = this._sessionOfPawn(tender);
        const patientC = this._creatureForPawn(session, patient)
            || patient.creature
            || this.creatures.get(patient.id);
        const anatomy = patientC?.anatomy;
        if (!anatomy) return false;
        const tenderC = tender.creature || this.creatures.get(tender.id);
        tenderC?.refreshCapacities?.();
        if (tenderC?.isIncapacitated?.() || !tenderC?.capacities?.canManipulate?.()) return false;
        const self = patient === tender || patient.id === tender.id;
        if (!self && !Party.inInteractRange(tender, patient, TS)) return false;
        const budget = Number(meta.bandage.batchSeverity);
        let targets = BodyHealing.pickTendTargets?.(anatomy, { batchSeverity: budget }) || [];
        if (!targets.length) {
            const one = pick?.target || BodyHealing.pickTendTarget?.(anatomy);
            if (one) targets = [one];
        }
        if (!targets.length) return false;
        const skills = this._skillsApi?.();
        if (skills && tender.bio && skills.incapable(tender.bio, "medical")) return false;
        const seconds = Number(meta.bandage.channelSeconds) || 5;
        const med = skills && tender.bio ? skills.effectiveLevel(tender.bio, "medical") : null;
        const tendRate = med == null ? 1 : skills.jobRate(tender, "tend", skills.workOpts?.(this, tender));
        const max = seconds * 1000 / tendRate;
        tender.tendChannel = {
            remaining: max,
            max,
            slot,
            bag,
            fromId: from.id,
            patientId: patient.id,
            patientName: patient.name || patient.pawnName || null,
            itemId: stack.id,
            targetHints: targets.map((t) => BodyHealing.tendTargetHint?.(t)).filter(Boolean)
        };
        tender.tending = true;
        if (tenderC) tenderC._tending = true;
        this._pushTendChannelEvent(tender);
        this._dirtyPawnOwner(tender);
        return true;
    },

    _tickTendChannel(pawn, dtMs) {
        if (!pawn?.tendChannel) return;
        if (!this._tendChannelStillValid(pawn, pawn.tendChannel)) {
            this._clearTendChannel(pawn, { cancelled: true });
            return;
        }
        pawn.tendChannel.remaining -= dtMs;
        this._pushTendChannelEvent(pawn);
        if (pawn.tendChannel.remaining <= 0) this._finishTend(pawn);
    },

    _finishTend(pawn) {
        const ch = pawn.tendChannel;
        pawn.tendChannel = null;
        pawn.tending = false;
        const c = pawn.creature || this.creatures.get(pawn.id);
        if (c) c._tending = false;
        if (!ch) return;
        this._pushTendChannelEvent(pawn, { progress: 1, done: true, itemId: ch.itemId || null });
        const session = this._sessionOfPawn(pawn);
        this._tryTend(session || pawn, {
            pawnId: pawn.id,
            patientId: ch.patientId,
            fromPawnId: ch.fromId,
            slot: ch.slot,
            bag: ch.bag,
            itemId: ch.itemId,
            targets: ch.targetHints
        });
    },

    _partyTendBusy(patient, members, except) {
        if (!patient) return false;
        const pid = patient.id;
        for (const m of members || []) {
            if (!m || m === except || m.id === except?.id) continue;
            if (m.tendChannel && m.tendChannel.patientId === pid) return true;
            const mc = m.creature || this.creatures.get(m.id);
            const seek = mc?.ai?.tendSeek;
            if (seek && (seek === patient || seek === patient.creature || seek.id === pid)) return true;
        }
        return false;
    },

    _handlePartyEat(p, action) {
        const eater = this._ownedPawns(p).find((m) => m.id === action.eaterId);
        const from = this._ownedPawns(p).find((m) => m.id === action.fromPawnId) || eater;
        if (!eater || !from) return;
        this._beginPawnEat(eater, { pawn: from, slot: action.slot, bag: action.bag });
    },

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
    },

    _publicWanderer(w) {
        if (!w) return null;
        const c = w.creature || this.creatures.get(w.id);
        const attacking = !!(c?.attackTimer > 0 || w.attackTimer > 0);
        const prone = this._creatureIsProne(c) || !!w.prone;
        return {
            id: w.id,
            name: w.name,
            look: w.look,
            bio: w.bio || null,
            x: w.x,
            y: w.y,
            facing: prone ? "right" : w.facing,
            inventory: w.inventory,
            hostile: !!w.hostile,
            recruitLocked: !!w.recruitLocked,
            band: !!w.band,
            refusedBy: Array.isArray(w.refusedBy)
                ? w.refusedBy
                : [...(w.refusedBy || [])],
            heading: this._wandererHeading(w.heading),
            moving: prone || !(this._wandererTimeScale() > 0) ? false : !!w._moved,
            prone,
            body: w.body || c?.anatomy?.toJSON?.() || null,
            attacking: prone ? false : attacking,
            attackAngle: attacking && !prone ? (c?.attackAngle ?? w.attackAngle ?? null) : null,
            attackArt: attacking && !prone ? (c?.attackArt || w.attackArt || null) : null
        };
    },

    _creatureIsProne(c) {
        if (!c || c._dead) return false;
        return !!(c._prone || c.isImmobile?.() || c.isIncapacitated?.());
    },

    _headingLive(h) {
        const x = Number(h?.x);
        const y = Number(h?.y);
        return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) + Math.abs(y) > 0;
    },

    _wandererHeading(h) {
        if (this._headingLive(h)) return { x: Number(h.x), y: Number(h.y) };
        return { x: 1, y: 0 };
    },

    _wandererRecordFromSnap(snap) {
        if (!snap?.id || snap.dead) return null;
        const x = Number(snap.x);
        const y = Number(snap.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const rec = {
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
            band: !!snap.band,
            refusedBy: Array.isArray(snap.refusedBy) ? snap.refusedBy : [],
            body: snap.body || null,
            bio: snap.bio || null,
            dead: false,
            _avoidSide: 1
        };
        this._ensureBio?.(rec);
        return rec;
    },

    _mobTimeScale() {
        return Party.mobTimeScale
            ? Party.mobTimeScale(this.tickSpeed)
            : Party.wandererTimeScale(this.tickSpeed);
    },

    _wandererTimeScale() {
        return this._mobTimeScale();
    },

    _settlerTimeScale() {
        return Party.settlerTimeScale
            ? Party.settlerTimeScale(this.tickSpeed)
            : this._mobTimeScale();
    },

    _settlerDtMs(dtMs) {
        return dtMs * this._settlerTimeScale();
    },

    _tickWandererDirector(dtMs) {
        const speed = Number.isFinite(this.tickSpeed) && this.tickSpeed >= 0 ? this.tickSpeed : 1;
        const online = [...this.players.values()].some((p) => p.connected && !p.dead);
        if (!online) return;
        this._cullDistantWanderers();
        const moveScale = this._wandererTimeScale();
        const moveDt = dtMs * moveScale;
        for (const w of [...this.wanderers.values()]) {
            if (!w || w.dead) continue;
            if (Number.isFinite(w.x) && Number.isFinite(w.y)) {
                const { cx, cy } = worldToChunk(w.x, w.y);
                if (w._loadCx !== cx || w._loadCy !== cy) {
                    w._loadCx = cx;
                    w._loadCy = cy;
                    this._interestLoad(w.x, w.y, 1);
                }
            }
            this._ensureWandererCreature(w);
            // A killing blow often lands after this director (settler / wildlife
            // melee). The next pass used to rebuild a live body from the
            // pre-fatal snapshot and the punch that followed finished them.
            if (w.dead || w.creature?.isBodyDead?.()) {
                this._finishWandererDeath(w, w.creature?._lastHitBy || null);
                continue;
            }
            if (moveScale > 0) {
                if (w.hostile) this._stepHostileWanderer(w, moveDt);
                else this._stepWanderer(w, moveDt);
            } else {
                const c = w.creature;
                if (c) {
                    c.setDesiredVel?.(0, 0);
                    c.vx = 0;
                    c.vy = 0;
                }
                w._moved = false;
            }
            if (w.creature) {
                w.creature.x = w.x;
                w.creature.y = w.y;
            }
        }
        const live = [...this.players.values()].filter((p) => p.connected && !p.dead);
        const step = (dtMs / 1000) * speed;
        for (const p of live) {
            this._ensureDirectorCd(p.id, (p.party?.length || 0) + 1);
            this._setDirectorCd(p.id, this._directorCdLeft(p.id) - step);
        }
        const clusters = this._playerClusters();
        for (const group of clusters) {
            const anchor = group[0];
            if (!anchor) continue;
            if (!group.some((p) => this._directorCdLeft(p.id) <= 0)) continue;
            const nearby = [...this.wanderers.values()].some((w) =>
                w && !w.hostile && !w.dead
                && Math.hypot(w.x - anchor.x, w.y - anchor.y) < 36 * TS
            );
            if (nearby) continue;
            if (!this._spawnWandererNear(anchor)) {
                this._setDirectorCd(anchor.id, 3);
                continue;
            }
            const wait = Party.directorCooldown((anchor.party?.length || 0) + 1, () => this.rng());
            for (const p of group) this._setDirectorCd(p.id, wait);
        }
    },

    _directorCdLeft(playerId) {
        const n = Number(this._directorCd.get(playerId));
        return Number.isFinite(n) ? n : 0;
    },

    _setDirectorCd(playerId, seconds) {
        if (!playerId) return;
        const n = Number(seconds);
        this._directorCd.set(playerId, Number.isFinite(n) ? Math.max(0, n) : 0);
    },

    _ensureDirectorCd(playerId, partyCount) {
        if (!playerId || this._directorCd.has(playerId)) return;
        const wait = Party.directorCooldown(partyCount, () => this.rng());
        this._directorCd.set(playerId, wait);
    },

    _directorCdToSave() {
        const out = {};
        for (const [id, v] of this._directorCd) {
            const n = Number(v);
            if (!id || !Number.isFinite(n)) continue;
            out[id] = Math.max(0, n);
        }
        return out;
    },

    _loadDirectorCd(raw) {
        this._directorCd = new Map();
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
        for (const [id, v] of Object.entries(raw)) {
            const n = Number(v);
            if (!id || !Number.isFinite(n)) continue;
            this._directorCd.set(id, Math.max(0, n));
        }
    },

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
    },

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
    },

    _ensureWandererCreature(w) {
        if (!w?.id) return null;
        w.heading = this._wandererHeading(w.heading);
        let creature = this.creatures.get(w.id);
        // A dead passerby stays dead until _finishWandererDeath. Replacing
        // them here reloaded the pre-fatal body and cleared the kill.
        if (creature && !creature._dead && creature.role !== "wanderer") {
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
        creature.bio = w.bio || null;
        creature.role = "wanderer";
        creature.ownerId = null;
        creature.faction = Party.FACTION_WANDERERS;
        creature.x = w.x;
        creature.y = w.y;
        creature.inventory = w.inventory;
        if (w.dead || creature._dead) {
            creature._dead = true;
            creature.active = false;
            if (creature.anatomy) w.body = creature.anatomy.toJSON();
            return creature;
        }
        creature._dead = false;
        creature.active = true;
        if (w.hostile) this._ensureHostileWandererAI(w, creature);
        return creature;
    },

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
    },

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
        this._ejectOverlappingPose(w, c);
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
        w.x = c.x;
        w.y = c.y;
        c.applyDesiredVel(dtMs);
        const ox = w.x;
        const oy = w.y;
        this._integrateWandererPose(w, c, dtMs);
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
        if (!wasSwinging && c.isAttacking?.() && !c._prone) {
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
    },

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
        const nearCamp = Settlement.wandererBandAt(
            this.settlements, this.settlers, p.x, p.y, TS
        );
        const pack = Party.wandererPackSize(partyN, () => this.rng(), { band: nearCamp });
        const full = Party.isPartyFull(partyN);
        const line = Party.wandererPackOffsets(pack, inward, TS * 1.35);
        const probe = { hitboxSize: 8, width: 16, height: 16 };
        const spawnBlocked = (px, py) =>
            this.isBlocked(px, py)
            || this._partyPoseBlocked(probe, px, py, 0, { load: false });
        let spawned = 0;
        const made = [];
        for (const off of line) {
            let sx = x + off.x;
            let sy = y + off.y;
            this._interestLoad(sx, sy, 1);
            if (spawnBlocked(sx, sy)) {
                let placed = false;
                const jogs = [
                    { x: TS, y: 0 }, { x: -TS, y: 0 }, { x: 0, y: TS }, { x: 0, y: -TS },
                    { x: TS, y: TS }, { x: -TS, y: TS }, { x: TS, y: -TS }, { x: -TS, y: -TS }
                ];
                for (const j of jogs) {
                    const jx = x + j.x;
                    const jy = y + j.y;
                    this._interestLoad(jx, jy, 1);
                    if (spawnBlocked(jx, jy)) continue;
                    sx = jx;
                    sy = jy;
                    placed = true;
                    break;
                }
                if (!placed) {
                    sx = x;
                    sy = y;
                    if (spawnBlocked(sx, sy)) continue;
                }
            }
            const inventory = Party.rollWandererInventory(() => this.rng(), {
                fullParty: full,
                x: sx,
                y: sy,
                tileSize: TS
            });
            const id = uuid();
            const h = inward;
            const bio = this._skillsApi()?.generate(() => this.rng()) || null;
            this.wanderers.set(id, {
                id,
                name: CavemanNames.generate(() => this.rng(), { avoid: this._livingNames() }),
                look: Look.randomLook(),
                bio,
                x: sx,
                y: sy,
                facing: h.x > 0 ? "right" : h.x < 0 ? "left" : h.y > 0 ? "down" : "up",
                heading: h,
                inventory,
                hostile: false,
                recruitLocked: false,
                band: false,
                refusedBy: [],
                _avoidSide: this.rng() < 0.5 ? -1 : 1
            });
            made.push(id);
            spawned++;
        }
        if (made.length >= 2) {
            for (const id of made) {
                const w = this.wanderers.get(id);
                if (w) w.band = true;
            }
        }
        return spawned;
    },

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
            || Math.hypot(w.x - dest.x, w.y - dest.y) < 4 * TS
        ) {
            w._walkDest = { x: w.x + hx * 10 * TS, y: w.y + hy * 10 * TS };
        }
        c.x = w.x;
        c.y = w.y;
        c.facing = w.facing || c.facing;
        c.heading = w.heading;
        c.walkDest = w._walkDest;
        if (!(c.ai instanceof WandererStrollAI)) c.ai = new WandererStrollAI(c);
        this._ejectOverlappingPose(w, c);
        const world = this._aiWorld();
        c.refreshCapacities?.();
        const ox = w.x;
        const oy = w.y;
        c.ai.update(dtMs, world);
        w.x = c.x;
        w.y = c.y;
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
        this._integrateWandererPose(w, c, dtMs);
        w.facing = c.facing || w.facing;
        w._moved = Math.hypot(w.x - ox, w.y - oy) > 0.15
            || Math.hypot(c.vx || 0, c.vy || 0) > 2;
        c.x = w.x;
        c.y = w.y;
    },

    /**
     * Collision samples stay small even when /tick (or sleep 12×) inflates dt.
     * A 20× step used to skip through trees, look stuck, then teleport.
     */
    _integrateWandererPose(w, c, dtMs) {
        const total = Math.max(0, Number(dtMs) || 0);
        const vx = c.vx || 0;
        const vy = c.vy || 0;
        const sliceMs = 48;
        let left = total;
        while (left > 0) {
            const slice = Math.min(left, sliceMs);
            const dt = slice / 1000;
            const swim = this._feetSpeedMult(c);
            const nx = w.x + vx * dt * swim;
            const ny = w.y + vy * dt * swim;
            if (!this._partyPoseBlocked(c, nx, c.y)) c.x = nx;
            if (!this._partyPoseBlocked(c, c.x, ny)) c.y = ny;
            w.x = c.x;
            w.y = c.y;
            left -= slice;
        }
        this._ejectOverlappingPose(w, c);
    },

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
        const swim = this._feetSpeedMult(w);
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
    },

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
    },

    _idHash(id) {
        const s = String(id || "");
        let n = 0;
        for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) | 0;
        return ((n >>> 0) / 4294967296) * Math.PI * 2;
    },

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
    },

    /**
     * Things in this chunk (or a neighbor, whose rects are copied in) changed.
     * The next collision query rebuilds those indexes; untouched forest stays.
     */
    _bumpChunkCollision(chunk) {
        if (!chunk) return;
        chunk._colRev = (chunk._colRev | 0) + 1;
        const cx = chunk.cx | 0;
        const cy = chunk.cy | 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const n = this.chunks.get(chunkKey(cx + dx, cy + dy));
                if (n) n._stampGen = -1;
            }
        }
    },

    /**
     * Stamp of this chunk plus the eight around it. Cached until something
     * in that neighborhood is added, removed, or edited.
     */
    _collisionStamp(cx, cy) {
        const home = this.chunks.get(chunkKey(cx, cy));
        const gen = this._queryGen | 0;
        if (home && home._stampGen === gen) return home._stamp;
        const parts = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const c = this.chunks.get(chunkKey(cx + dx, cy + dy));
                const things = c && c.things;
                const loot = c && c.lootableThings;
                parts.push(
                    c ? (c._colRev | 0) : -1,
                    things ? things.length : 0,
                    loot ? loot.length : 0
                );
            }
        }
        const s = parts.join(",");
        if (home) {
            home._stampGen = gen;
            home._stamp = s;
        }
        return s;
    },

    _thingRect(t) {
        if (!t || t.gone) return null;
        const x = t.x;
        const y = t.y;
        const rot = t.rot || 0;
        const id = t.id;
        let cache = this._solidRects;
        if (!cache) cache = this._solidRects = new WeakMap();
        const hit = cache.get(t);
        if (hit && hit.x === x && hit.y === y && hit.rot === rot && hit.id === id) return hit.rect;
        const def = thingDefs().get(t.id);
        // A 1px pad welds adjacent stations into one wall. Gap furniture
        // keeps the raw box the player walks, so the space between them fits.
        const pad = (def && Place.isGapFurniture?.(def)) ? 0 : 1;
        const gapSqueeze = Place.gapSqueeze?.(def) || 0;
        let rect = null;
        if (typeof Place !== "undefined" && Place.collisionWorldRect) {
            const raw = Place.collisionWorldRect(t, def, TS);
            if (raw) {
                rect = {
                    t,
                    left: raw.left - pad,
                    right: raw.right + pad,
                    top: raw.top - pad,
                    bottom: raw.bottom + pad,
                    r: Math.max(raw.right - raw.left, raw.bottom - raw.top) * 0.5 + pad
                };
                if (gapSqueeze > 0) rect.gapSqueeze = gapSqueeze;
            }
        }
        const hs = Number(def?.hitboxSize);
        if (!rect && hs > 0) {
            const hx = hs * 0.5;
            rect = {
                t,
                left: t.x - hx - pad,
                right: t.x + hx + pad,
                top: t.y - hs - pad,
                bottom: t.y + pad,
                r: hx + pad
            };
            if (gapSqueeze > 0) rect.gapSqueeze = gapSqueeze;
        }
        cache.set(t, { x, y, rot, id, rect });
        return rect;
    },

    _tileBlocked(wx, wy, opts = {}) {
        const { cx, cy } = worldToChunk(wx, wy);
        const c = opts.load === false
            ? this.chunks.get(chunkKey(cx, cy))
            : this._ensureChunk(cx, cy);
        if (!c) return true;
        const lx = Math.floor((wx - cx * CHUNK_PX) / TS);
        const ly = Math.floor((wy - cy * CHUNK_PX) / TS);
        if (lx < 0 || ly < 0 || lx >= CS || ly >= CS) return true;
        const tile = c.tiles[lx + ly * CS];
        if (!tile || !BLOCKED.has(tile)) return false;
        if (tile === "water" && opts.swim) return false;
        if (tile === "ice" && opts.swim && opts.crossIce !== false) return false;
        return true;
    },

    /**
     * Move speed scale when the feet hitbox overlaps water.
     * Ice is not slowed. Missing chunks count as dry, same as a point sample.
     */
    _feetSpeedMult(entity) {
        if (!entity) return 1;
        if (typeof Place === "undefined" || !Place.walkBodyOverlapsTile) {
            return this._terrainSpeedMult(entity.x, entity.y - 1);
        }
        const wet = Place.walkBodyOverlapsTile(
            entity.x, entity.y,
            entity.width, entity.height, entity.hitboxSize,
            TS,
            (tx, ty) => {
                const wx = tx * TS + TS * 0.5;
                const wy = ty * TS + TS * 0.5;
                const { cx, cy } = worldToChunk(wx, wy);
                const c = this.chunks.get(chunkKey(cx, cy));
                if (!c) return false;
                const lx = tx - cx * CS;
                const ly = ty - cy * CS;
                if (lx < 0 || ly < 0 || lx >= CS || ly >= CS) return false;
                return c.tiles[lx + ly * CS] === "water";
            }
        );
        return wet ? 0.5 : 1;
    },

    /** Move speed scale for a world point in water (ice is not slowed). */
    _terrainSpeedMult(wx, wy) {
        const { cx, cy } = worldToChunk(wx, wy);
        const c = this.chunks.get(chunkKey(cx, cy));
        if (!c) return 1;
        const lx = Math.floor((wx - cx * CHUNK_PX) / TS);
        const ly = Math.floor((wy - cy * CHUNK_PX) / TS);
        if (lx < 0 || ly < 0 || lx >= CS || ly >= CS) return 1;
        return c.tiles[lx + ly * CS] === "water" ? 0.5 : 1;
    },

    /** Lower half of the sprite. AI routes use this; the steered pawn bumps on the feet. */
    _creatureBodyAt(creature, x, y) {
        const hs = Number(creature?.hitboxSize) || 8;
        const w = Number(creature?.width) || 16;
        const h = Number(creature?.height) || 16;
        const left = x + (w - hs) * 0.5;
        const top = y - h + hs;
        return { left, right: left + hs, top, bottom: top + hs };
    },

    _chunkThingRects(cx, cy) {
        return this._chunkThingIndex(cx, cy).list;
    },

    _chunkThingIndex(cx, cy) {
        const key = chunkKey(cx, cy);
        const cache = this._chunkRectCache || (this._chunkRectCache = new Map());
        const stamp = this._collisionStamp(cx, cy);
        const hit = cache.get(key);
        if (hit && hit.stamp === stamp) return hit.packed;
        const list = [];
        const bins = [];
        const extra = [];
        const sleep = [];
        const ox = cx * CHUNK_PX;
        const oy = cy * CHUNK_PX;
        const bounds = {
            left: ox,
            right: ox + CS * TS,
            top: oy,
            bottom: oy + CS * TS
        };
        const overlapsChunk = (rect) => rect.right > bounds.left && rect.left < bounds.right
            && rect.bottom > bounds.top && rect.top < bounds.bottom;
        const addThing = (t, foreign) => {
            if (!t || t.gone) return;
            const def = thingDefs().get(t.id);
            if (!foreign && Place.isSleepThing?.(def, t) && !def?.sleep?.interior) {
                const fp = Place.footprintWorldRect?.(t, def, TS);
                if (fp) {
                    sleep.push({
                        t,
                        left: fp.left,
                        right: fp.right,
                        top: fp.top,
                        bottom: fp.bottom
                    });
                }
            }
            // Same raw box as the player. The extra pixel welds a station row shut.
            const pad = (def && Place.isGapFurniture?.(def)) ? 0 : 1;
            const gapSqueeze = Place.gapSqueeze?.(def) || 0;
            const raw = (typeof Place !== "undefined" && Place.collisionWorldRects)
                ? Place.collisionWorldRects(t, def, TS)
                : [];
            const rects = [];
            if (raw.length) {
                for (let ri = 0; ri < raw.length; ri++) {
                    const src = raw[ri];
                    const rect = {
                        t,
                        left: src.left - pad,
                        right: src.right + pad,
                        top: src.top - pad,
                        bottom: src.bottom + pad,
                        r: Math.max(src.right - src.left, src.bottom - src.top) * 0.5 + pad
                    };
                    if (gapSqueeze > 0) rect.gapSqueeze = gapSqueeze;
                    rects.push(rect);
                }
            } else {
                const one = this._thingRect(t);
                if (one) rects.push(one);
            }
            for (let ri = 0; ri < rects.length; ri++) {
                const rect = rects[ri];
                if (foreign) {
                    if (overlapsChunk(rect)) extra.push(rect);
                    continue;
                }
                list.push(rect);
                const x0 = Math.max(0, Math.floor((rect.left - ox) / TS));
                const x1 = Math.min(CS - 1, Math.floor((rect.right - 1e-3 - ox) / TS));
                const y0 = Math.max(0, Math.floor((rect.top - oy) / TS));
                const y1 = Math.min(CS - 1, Math.floor((rect.bottom - 1e-3 - oy) / TS));
                let binned = false;
                for (let ty = y0; ty <= y1; ty++) {
                    for (let tx = x0; tx <= x1; tx++) {
                        binned = true;
                        const i = tx + ty * CS;
                        (bins[i] || (bins[i] = [])).push(rect);
                    }
                }
                // A wall can sit in the next chunk while the thing is stored here.
                if (!binned) extra.push(rect);
            }
        };
        const take = (chunk, foreign) => {
            if (!chunk) return;
            for (const things of [chunk.things, chunk.lootableThings]) {
                for (const t of things || []) addThing(t, foreign);
            }
        };
        take(this.chunks.get(key), false);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (!dx && !dy) continue;
                take(this.chunks.get(chunkKey(cx + dx, cy + dy)), true);
            }
        }
        const packed = { list, bins, extra, sleep };
        cache.set(key, { stamp, packed });
        return packed;
    },

    _thingRectsNear(wx, wy, radius = 64) {
        const r = Number(radius) || 64;
        const { cx, cy } = worldToChunk(wx, wy);
        const chunkR = Math.max(1, Math.ceil(r / CHUNK_PX));
        const out = [];
        for (let dx = -chunkR; dx <= chunkR; dx++) {
            for (let dy = -chunkR; dy <= chunkR; dy++) {
                const rects = this._chunkThingRects(cx + dx, cy + dy);
                for (let i = 0; i < rects.length; i++) {
                    const rect = rects[i];
                    const tcx = (rect.left + rect.right) * 0.5;
                    const tcy = (rect.top + rect.bottom) * 0.5;
                    if (Math.abs(tcx - wx) > r || Math.abs(tcy - wy) > r) continue;
                    out.push(rect);
                }
            }
        }
        return out;
    },

    /**
     * Arc boxes overlap the doorway and the floor. A query that misses the
     * solid ring is not a hit, even when it overlaps one of those boxes.
     */
    _ringBoxMisses(thing, left, right, top, bottom) {
        const def = thingDefs().get(thing?.id);
        if (!def?.ring || !Place.ringWorld || !Place.rectHitsRing) return false;
        const ring = Place.ringWorld(thing, def, TS);
        if (!ring) return false;
        return !Place.rectHitsRing(ring, left, right, top, bottom);
    },

    /**
     * A fat path link is wider than a hut door. Callers pass this to planPath
     * so only a segment whose midpoint is in the doorway may use a tighter fat.
     */
    _doorSlackNear(x, y, radius) {
        if (!Place.inDoorApproach) return null;
        const rects = this._thingRectsNear(x, y, radius);
        const seen = new Set();
        const doors = [];
        for (let i = 0; i < rects.length; i++) {
            const t = rects[i] && rects[i].t;
            const uid = t && t.uid;
            if (!uid || seen.has(uid)) continue;
            const def = thingDefs().get(t.id);
            if (!def || !def.doorClear) continue;
            seen.add(uid);
            doors.push({ t, def });
        }
        if (!doors.length) return null;
        // Path samples are feet (origin 0, 1). The door strip is about the
        // body, which sits 8px right and 4px up from those feet.
        return (px, py) => {
            const bx = px + 8;
            const by = py - 4;
            for (let i = 0; i < doors.length; i++) {
                if (Place.inDoorApproach(doors[i].t, doors[i].def, bx, by, TS)) return true;
            }
            return false;
        };
    },

    _aabbHitsThing(left, right, top, bottom, nearX, nearY, cull = 64, creature = null, collect = null) {
        const r = Number(cull) || 64;
        const { cx, cy } = worldToChunk(nearX, nearY);
        const chunkR = Math.max(1, Math.ceil(r / CHUNK_PX));
        const ignoreUid = creature?._pathIgnoreUid || creature?._chopIgnoreUid;
        const hits = (tb) => {
            if (creature && Sleep.ignoresThingCollision?.(creature, tb.t)) return false;
            if (ignoreUid && tb.t?.uid && String(tb.t.uid) === String(ignoreUid)) return false;
            if (!(right > tb.left && left < tb.right && bottom > tb.top && top < tb.bottom)) {
                return false;
            }
            // Ring boxes are a broad phase. A hut door is open in the circle
            // even when an arc's box spills across it.
            return !this._ringBoxMisses(tb.t, left, right, top, bottom);
        };
        const take = (tb) => {
            if (!hits(tb)) return null;
            if (!collect) return tb;
            collect.push(tb);
            return null;
        };
        for (let dx = -chunkR; dx <= chunkR; dx++) {
            for (let dy = -chunkR; dy <= chunkR; dy++) {
                const ncx = cx + dx;
                const ncy = cy + dy;
                const index = this._chunkThingIndex(ncx, ncy);
                const list = index.list;
                const extra = index.extra;
                if (extra && extra.length) {
                    for (let i = 0; i < extra.length; i++) {
                        const hit = take(extra[i]);
                        if (hit) return hit;
                    }
                }
                if (!list.length) continue;
                if (list.length <= 8) {
                    for (let i = 0; i < list.length; i++) {
                        const tb = list[i];
                        const tcx = (tb.left + tb.right) * 0.5;
                        const tcy = (tb.top + tb.bottom) * 0.5;
                        if (Math.abs(tcx - nearX) > r || Math.abs(tcy - nearY) > r) continue;
                        const hit = take(tb);
                        if (hit) return hit;
                    }
                    continue;
                }
                const ox = ncx * CHUNK_PX;
                const oy = ncy * CHUNK_PX;
                const tx0 = Math.max(0, Math.floor((left - ox) / TS));
                const tx1 = Math.min(CS - 1, Math.floor((right - 1e-3 - ox) / TS));
                const ty0 = Math.max(0, Math.floor((top - oy) / TS));
                const ty1 = Math.min(CS - 1, Math.floor((bottom - 1e-3 - oy) / TS));
                if (tx1 < 0 || ty1 < 0 || tx0 >= CS || ty0 >= CS) continue;
                const bins = index.bins;
                for (let ty = ty0; ty <= ty1; ty++) {
                    for (let tx = tx0; tx <= tx1; tx++) {
                        const bin = bins[tx + ty * CS];
                        if (!bin) continue;
                        for (let i = 0; i < bin.length; i++) {
                            const hit = take(bin[i]);
                            if (hit) return hit;
                        }
                    }
                }
            }
        }
        return collect && collect.length ? collect[0] : null;
    },

    /**
     * Pathing grows the body so settlers don't kiss trunks. That same margin
     * seals a hut door: the 8×8 body fits, the padded one does not. Only the
     * doorway gets that pass. A pose against any other interior wall stays
     * blocked, so settlers cannot skim or step through it.
     */
    _interiorDoorMargin(creature, body, pad, x, y) {
        if (!(pad > 0)) return false;
        if (this._aabbHitsThing(
            body.left, body.right, body.top, body.bottom, x, y, 64, creature
        )) return false;
        const hits = [];
        this._aabbHitsThing(
            body.left - pad, body.right + pad, body.top - pad, body.bottom + pad,
            x, y, 64, creature, hits
        );
        if (!hits.length) return false;
        const cx = (body.left + body.right) * 0.5;
        const cy = (body.top + body.bottom) * 0.5;
        for (let i = 0; i < hits.length; i++) {
            const thing = hits[i].t;
            const def = thingDefs().get(thing?.id);
            if (!def?.sleep?.interior) return false;
            if (!Place.inDoorApproach?.(thing, def, cx, cy, TS)) return false;
        }
        return true;
    },

    /**
     * Pathing grows the body so settlers don't kiss trunks. Campfires,
     * drying racks, and wicker baskets leave a gap the body can take, and
     * the same margin seals the row into a wall they pace along. The opening
     * includes the approach, not only the feet already between the
     * stations — otherwise the walker slides along the face and waits
     * before stepping through. A shallow clip of the side still counts
     * as the gap. The face and the middle stay solid, so holding into a
     * basket does not bounce. A skinworking bench is not part of that opening.
     */
    _gapClear(creature, body, pad) {
        const p = Math.max(0, Number(pad) || 0);
        const hits = [];
        this._aabbHitsThing(
            body.left - p, body.right + p, body.top - p, body.bottom + p,
            (body.left + body.right) * 0.5, (body.top + body.bottom) * 0.5,
            64, creature, hits
        );
        if (!hits.length || !Place.furnitureGapAxis || !Place.gapSideClip) return false;
        const feetX = body.left - 4;
        const feetY = body.bottom;
        const near = this._thingRectsNear(feetX, feetY, 40);
        const stations = [];
        const seen = new Set();
        for (let i = 0; i < near.length; i++) {
            const rect = near[i];
            const uid = rect && rect.t && rect.t.uid;
            if (!uid || seen.has(uid)) continue;
            const def = thingDefs().get(rect.t.id);
            if (!def || !Place.isGapFurniture?.(def)) continue;
            seen.add(uid);
            stations.push(rect);
        }
        const axis = Place.furnitureGapAxis(stations, body);
        if (!axis) return false;
        for (let i = 0; i < hits.length; i++) {
            const tb = hits[i];
            const def = thingDefs().get(tb.t?.id);
            if (!def || !Place.isGapFurniture?.(def)) return false;
            const squeeze = Place.gapSqueeze?.(def) || Place.GAP_SQUEEZE || 2;
            // A front-face graze is solid. Only the side facing the neighbor
            // may clip, or holding into a basket bounces on the threshold.
            if (!Place.gapSideClip(body, tb, axis, squeeze)) return false;
        }
        return true;
    },

    /**
     * The pathing pad overlaps a campfire or drying rack, and the body
     * itself does not. Sliding on that margin is the sideways shuffle
     * in front of the gap. Trunks and real overlaps still slide.
     */
    _gapMarginOnly(creature, x, y) {
        if (this._partyPoseBlocked(creature, x, y, 0, {
            load: false,
            sleepFootprint: false
        })) return false;
        const body = this._creatureBodyAt(creature, x, y);
        const hits = [];
        this._aabbHitsThing(
            body.left - 2, body.right + 2, body.top - 2, body.bottom + 2,
            x, y, 64, creature, hits
        );
        if (!hits.length) return false;
        for (let i = 0; i < hits.length; i++) {
            const def = thingDefs().get(hits[i].t?.id);
            if (!def || !Place.isGapFurniture?.(def)) return false;
        }
        return true;
    },

    /**
     * Feet positions that fit between neighboring stations. Passed to
     * planPath as slack so the fat corridor may use the gap instead of
     * routing around the whole row.
     */
    _rackGapNear(x, y, radius) {
        if (typeof Path === "undefined" || !Path.gapLanes || !Path.inGapLane) return null;
        const rects = this._thingRectsNear(x, y, radius);
        const seen = new Set();
        const racks = [];
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            const t = rect && rect.t;
            const uid = t && t.uid;
            if (!uid || seen.has(uid)) continue;
            const def = thingDefs().get(t.id);
            if (!def || !Place.isGapFurniture?.(def)) continue;
            seen.add(uid);
            racks.push(rect);
        }
        if (racks.length < 2) return null;
        const squeeze = ((Place.GAP_SQUEEZE || 2) * 2);
        const lanes = Path.gapLanes(racks, { squeeze });
        if (!lanes.length) return null;
        return (px, py) => Path.inGapLane(lanes, px, py, 20);
    },

    _partyPoseBlocked(creature, x, y, pad = 0, opts = {}) {
        // Feet origin (0, 1). A pose on a tile's bottom edge belongs to that
        // tile, matching Path.cellOf and the client.
        if (this._tileBlocked(x, y - 1, {
            swim: !!Party.traversesWater?.(creature),
            crossIce: creature?.role === "wanderer",
            load: opts.load
        })) return true;
        const body = this._creatureBodyAt(creature, x, y);
        const p = Math.max(0, Number(pad) || 0);
        if (this._aabbHitsThing(
            body.left - p, body.right + p, body.top - p, body.bottom + p, x, y, 64, creature
        ) && !this._interiorDoorMargin(creature, body, p, x, y)
            && !this._gapClear(creature, body, p)) return true;
        if (opts.sleepFootprint === false || opts.sleepNav === false) return false;
        return this._sleepFootprintHits(creature, body, p, x, y);
    },

    /**
     * Sleep furniture rects near a pose, reused for every A* cell this tick.
     */
    _sleepRectsAround(nearX, nearY) {
        const { cx, cy } = worldToChunk(nearX, nearY);
        const key = chunkKey(cx, cy);
        const cache = this._sleepRectCache || (this._sleepRectCache = new Map());
        const hit = cache.get(key);
        if (hit) return hit;
        const r = 64;
        const chunkR = Math.max(1, Math.ceil(r / CHUNK_PX));
        const rects = [];
        for (let dx = -chunkR; dx <= chunkR; dx++) {
            for (let dy = -chunkR; dy <= chunkR; dy++) {
                const sleep = this._chunkThingIndex(cx + dx, cy + dy).sleep || [];
                for (let i = 0; i < sleep.length; i++) {
                    const rect = sleep[i];
                    const t = rect.t;
                    if (!t || t.gone) continue;
                    rects.push({ t, rect });
                }
            }
        }
        cache.set(key, rects);
        return rects;
    },

    /**
     * Wanderers (and other humanoid AI) treat the whole bunk as solid so they
     * path around instead of walking the laying spot into the wooden back.
     */
    _sleepFootprintHits(creature, body, pad, nearX, nearY) {
        if (!Sleep.navAroundBeds?.(creature)) return false;
        const r = 64;
        const left = body.left - pad;
        const right = body.right + pad;
        const top = body.top - pad;
        const bottom = body.bottom + pad;
        const beds = this._sleepRectsAround(nearX, nearY);
        let hit = false;
        for (let i = 0; i < beds.length; i++) {
            const t = beds[i].t;
            const rect = beds[i].rect;
            if (Sleep.ignoresThingCollision?.(creature, t)) continue;
            const tcx = (rect.left + rect.right) * 0.5;
            const tcy = (rect.top + rect.bottom) * 0.5;
            if (Math.abs(tcx - nearX) > r || Math.abs(tcy - nearY) > r) continue;
            if (right > rect.left && left < rect.right
                && bottom > rect.top && top < rect.bottom) {
                hit = true;
                break;
            }
        }
        return hit;
    },

    /** Nearest stand pose whose body is clear of solids and blocked tiles. */
    _findFreeCreaturePose(creature, ox, oy, maxR = 24, opts = {}) {
        if (!creature || !Number.isFinite(ox) || !Number.isFinite(oy)) return null;
        const blocked = (x, y) => this._partyPoseBlocked(creature, x, y, 1, {
            load: false,
            sleepFootprint: opts.sleepFootprint,
            sleepNav: opts.sleepNav
        });
        const step = 8;
        const reach = Math.min(32, Math.max(step, Number(maxR) || 24));
        let probes = 0;
        const probeCap = 24;
        for (let r = step; r <= reach; r += step) {
            const n = 8;
            for (let i = 0; i < n; i++) {
                if (++probes > probeCap) return null;
                const a = (i / n) * Math.PI * 2;
                const x = ox + Math.cos(a) * r;
                const y = oy + Math.sin(a) * r;
                if (!blocked(x, y)) return { x, y };
            }
        }
        return null;
    },

    /**
     * If the body is inside a solid (or on a blocked tile), teleport to the
     * nearest open stand. Sleeping in a lean-to is allowed; the controlled
     * pawn is not yanked while you steer them.
     *
     * Laying-spot / bunk *nav* is not a reason to teleport — that expansion
     * exists so AI paths around beds, not so we yank someone working beside one.
     */
    _ejectOverlappingPose(entity, creature) {
        const c = creature || entity?.creature || entity;
        if (!c || c._dead || entity?.dead) return false;
        if (c._resting || entity?._resting) return false;
        const id = c.id || entity?.id;
        if (id) {
            for (const p of this.players.values()) {
                if (!p.connected) continue;
                if ((p.controlId || p.id) === id) return false;
            }
        }
        const x = Number(entity?.x ?? c.x);
        const y = Number(entity?.y ?? c.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const now = (typeof performance !== "undefined" && performance.now)
            ? performance.now()
            : Date.now();
        if (c._ejectCalmUntil && now < c._ejectCalmUntil) return false;
        const blockOpts = { load: false, sleepFootprint: false, sleepNav: false };
        if (!this._partyPoseBlocked(c, x, y, 0, blockOpts)) return false;
        const commit = (px, py) => {
            c.x = px;
            c.y = py;
            if (entity && entity !== c) {
                entity.x = px;
                entity.y = py;
            }
            const ai = c.ai;
            if (ai) {
                ai._path = null;
                ai._pathGoalX = null;
                ai._pathGoalY = null;
                ai._stuckMs = 0;
                ai._jamMs = 0;
            }
            return true;
        };
        const step = 6;
        const dirs = [
            [step, 0], [-step, 0], [0, step], [0, -step],
            [step, step], [step, -step], [-step, step], [-step, -step]
        ];
        for (let i = 0; i < dirs.length; i++) {
            const px = x + dirs[i][0];
            const py = y + dirs[i][1];
            if (!this._partyPoseBlocked(c, px, py, 0, blockOpts)) return commit(px, py);
        }
        const free = this._findFreeCreaturePose(c, x, y, 24, {
            sleepFootprint: false,
            sleepNav: false
        });
        if (!free || (free.x === x && free.y === y)) {
            c._ejectCalmUntil = now + 400;
            return false;
        }
        return commit(free.x, free.y);
    },

    /** Pop out of real solids only — not while walking or using a station. */
    _maybeEjectIdleOverlap(rec, cc) {
        if (!rec || !cc) return false;
        if (rec._pathIgnoreUid || rec._chopIgnoreUid || rec._workChannel || rec._paintChannel) {
            return false;
        }
        if (Math.hypot(cc._desiredVx || 0, cc._desiredVy || 0) > 4) return false;
        return this._ejectOverlappingPose(rec, cc);
    },

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
    },

    _solidThingOverlapping(entity) {
        if (!entity) return null;
        const x = Number(entity.x) || 0;
        const y = Number(entity.y) || 0;
        const creature = entity.creature && entity.creature.width
            ? entity.creature
            : (entity.width ? entity : null);
        if (creature) {
            const body = this._creatureBodyAt(creature, x, y);
            return this._aabbHitsThing(
                body.left, body.right, body.top, body.bottom, x, y, 64, creature
            );
        }
        return this._solidThingAt(x, y);
    },

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
    },

    _reapDeadWanderers() {
        for (const w of [...this.wanderers.values()]) {
            if (!w || w.dead) continue;
            const wc = w.creature || this.creatures.get(w.id);
            if (!wc?.isBodyDead?.()) continue;
            this._finishWandererDeath(w, wc._lastHitBy || null);
        }
    },

    _finishWandererDeath(w, killer) {
        if (!w || w.dead) return;
        w.dead = true;
        const creature = w.creature || this.creatures.get(w.id);
        if (creature) {
            creature.x = w.x;
            creature.y = w.y;
        }
        const loot = [];
        for (const s of w.inventory || []) {
            if (s) loot.push(this._cloneStackForWorld(s));
        }
        const c = creature?.bodyCenter?.()
            || (typeof feetToBodyCenter === "function"
                ? feetToBodyCenter(w.x, w.y, creature?.width, creature?.height)
                : { x: w.x + 8, y: w.y - 8 });
        this._pushCorpse({
            x: c.x,
            y: c.y,
            key: "human",
            look: w.look || null,
            frame: 7,
            name: w.name || "Wanderer",
            bio: w.bio || creature?.bio || null,
            loot: loot.filter(Boolean),
            body: creature?.anatomy?.toJSON?.() || w.body || null,
            bodyPlan: "human",
            mobId: "human",
            playerCorpse: false,
            sourceUid: w.id
        });
        this.wanderers.delete(w.id);
        this.creatures.delete(w.id);
        if (creature) {
            creature._dead = true;
            creature.active = false;
        }
    },
    };
});
