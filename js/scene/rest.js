/**
 * SceneMain prototype methods (rest).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainRest = {

    findLeanToByUid(uid) {
        if (!uid) return null;
        for (const chunk of Object.values(this.chunks || {})) {
            for (const t of chunk.things?.getChildren?.() || []) {
                if (t instanceof LeanTo && t.entry?.uid === uid) return t;
            }
        }
        return null;
    },

    forEachSleepEntry(fn) {
        for (const chunk of Object.values(this.chunks || {})) {
            const list = chunk.meta?.things;
            if (!Array.isArray(list)) continue;
            for (const entry of list) {
                const def = this.getThing(entry?.id);
                if (!entry || !(def?.sleep || Array.isArray(entry.occupants))) continue;
                fn(entry, def, chunk);
            }
        }
    },

    _sleepPawnById(id) {
        if (!id) return null;
        return (this.party || []).find((p) => p && p.pawnId === id)
            || (this.settlers || []).find((p) => p && p.pawnId === id)
            || null;
    },

    _reconcileSleepOccupants(entry) {
        if (!entry || !Array.isArray(entry.occupants)) return;
        const dedicated = !!(this.simAuth());
        for (let i = 0; i < entry.occupants.length; i++) {
            const id = entry.occupants[i];
            if (!id) continue;
            const pawn = this._sleepPawnById(id);
            if (!pawn || pawn.isBodyDead?.()) {
                if (!dedicated) entry.occupants[i] = null;
                continue;
            }
            // Occupancy is "in this bed now", not "slept here once".
            if (!pawn._resting) {
                if (!dedicated) entry.occupants[i] = null;
                continue;
            }
            this._occupySlot(pawn, entry, i);
        }
        for (const pawn of [...(this.party || []), ...(this.settlers || [])]) {
            if (!pawn?._resting || pawn.isBodyDead?.()) continue;
            const last = pawn.lastSleep;
            if (last?.uid !== entry.uid) continue;
            const slot = last.slot || 0;
            if (entry.occupants[slot] && entry.occupants[slot] !== pawn.pawnId) {
                this._wakePawn(pawn, { manual: true });
                const def = this.getThing(entry.id);
                const pos = typeof Sleep !== "undefined"
                    ? Sleep.besideWorldPos(entry, this.tileSize, def)
                    : { x: entry.x, y: entry.y };
                pawn.x = pos.x;
                pawn.y = pos.y;
            }
        }
    },

    _findPawnSleepBed(pawn) {
        const id = pawn?.pawnId;
        const pose = this.net?.world?.poses?.[id];
        const hint = pawn?.lastSleep || pose?.lastSleep;
        if (id) {
            let occ = null;
            this.forEachSleepEntry((entry) => {
                if (occ || !Array.isArray(entry.occupants)) return;
                const slot = entry.occupants.indexOf(id);
                if (slot >= 0) occ = { entry, slot };
            });
            if (occ) return occ;
        }
        if (hint?.uid) {
            const lean = this.findLeanToByUid(hint.uid);
            if (lean?.entry) return { entry: lean.entry, slot: hint.slot || 0, lean };
        }
        return null;
    },

    _clearPawnSleepOccupancy(pawn) {
        const id = pawn?.pawnId;
        if (!id) return;
        this.forEachSleepEntry((e) => {
            if (!Array.isArray(e.occupants)) return;
            for (let i = 0; i < e.occupants.length; i++) {
                if (e.occupants[i] === id) e.occupants[i] = null;
            }
        });
    },

    _restorePartySleep() {
        const dedicated = !!(this.simAuth());
        const poses = this.net?.world?.poses || {};
        for (const pawn of this.party || []) {
            if (!pawn || pawn.isBodyDead?.()) continue;
            const pose = poses[pawn.pawnId];
            if (pose?.lastSleep) pawn.lastSleep = pose.lastSleep;
            // Per-world logout pose wins. A pose without `resting` is treated as
            // awake so lastSleep (remembered bunk) cannot put people back to bed.
            const wantRest = pose && typeof pose.resting === "boolean"
                ? !!pose.resting
                : (pose ? false : !!pawn._resting);
            pawn._resting = wantRest;
            if (!wantRest) {
                if (!dedicated) this._clearPawnSleepOccupancy(pawn);
                setCreatureRest?.(pawn, false);
                continue;
            }
            const bed = this._findPawnSleepBed(pawn);
            if (bed?.entry) {
                const slot = bed.slot || 0;
                if (typeof Sleep !== "undefined"
                    && Sleep.isSlotOccupied(bed.entry, slot)
                    && bed.entry.occupants[slot] !== pawn.pawnId) {
                    const def = this.getThing(bed.entry.id);
                    const pos = Sleep.besideWorldPos(bed.entry, this.tileSize, def);
                    pawn.x = pos.x;
                    pawn.y = pos.y;
                    setCreatureRest?.(pawn, false);
                    pawn._resting = false;
                    continue;
                }
                this._occupySlot(pawn, bed.entry, slot);
                continue;
            }
            // Dedicated: chunks may not have arrived yet; YOU.resting is authoritative.
            if (pawn._resting && !dedicated) this._wakePawn(pawn, { manual: true });
        }
    },

    openLeanToPanel(leanTo, pointer) {
        const switchAlly = this.partySys?.worldSwitchTarget?.(pointer);
        if (switchAlly) {
            this.partySys.tryAllyClick(switchAlly);
            return;
        }
        const slot = leanTo.slotAtPointer?.(pointer) ?? 0;
        const occ = leanTo.entry?.occupants?.[slot];
        const ally = (this.party || []).find((p) => p && p.pawnId === occ && p !== this.player);
        if (ally && !ally.isBodyDead?.()) {
            const cam = this.cameras?.main;
            const world = cam && pointer ? cam.getWorldPoint(pointer.x, pointer.y) : null;
            const onAlly = !world || typeof creaturePointerHit !== "function"
                || creaturePointerHit(ally, world.x, world.y);
            if (onAlly) {
                this.partySys?.tryAllyClick?.(ally);
                return;
            }
        }
        if (!leanTo?.inRange?.()) return;
        if (this.restBlocksWorldUi?.()) {
            const uid = this.player?.lastSleep?.uid;
            if (!uid || leanTo.entry?.uid !== uid) return;
        }
        this.leanToPanel?.toggle(leanTo, slot);
    },

    _sleepLog(msg) {
        this.combatLog?.push?.(msg);
    },

    _cancelPawnChannels(pawn) {
        if (!pawn) return;
        pawn._cancelEat?.();
        if (pawn._tendChannel && !pawn._tendChannel.corpse) pawn._cancelTend?.();
        pawn._cancelKnap?.();
        pawn._cancelCraft?.();
    },

    _intendedSleep() {
        if (!this._sleepIntended) this._sleepIntended = new Map();
        return this._sleepIntended;
    },

    tryLeanToRest(leanTo, slot) {
        const pawn = this.player;
        if (!pawn || pawn.isBodyDead?.()) return false;
        const entry = leanTo?.entry;
        if (!entry) return false;
        if (typeof Sleep !== "undefined" && Sleep.isSlotOccupied(entry, slot) && entry.occupants[slot] !== pawn.pawnId) {
            this._sleepLog("That spot is taken");
            return false;
        }
        if (pawn._downed || pawn.isIncapacitated?.() || pawn.isImmobile?.()) {
            const pos = typeof Sleep !== "undefined"
                ? Sleep.sleeperWorldPos(entry, slot, this.tileSize, leanTo.meta)
                : { x: leanTo.x, y: leanTo.y };
            const onTile = Math.hypot(pawn.x - pos.x, pawn.y - pos.y) < (this.tileSize || 16);
            if (!onTile) {
                this._sleepLog("They can't walk to the lean-to");
                return false;
            }
        }
        this._cancelPawnChannels(pawn);
        if (this.simAuth()) {
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.SLEEP,
                op: "rest",
                uid: entry.uid,
                slot,
                pawnId: pawn.pawnId
            });
            this._orderRest(pawn, entry, slot, { autofill: false });
            this.leanToPanel?.close();
            return true;
        }
        this._orderRest(pawn, entry, slot, { autofill: true });
        this.leanToPanel?.close();
        return true;
    },

    tryLeanToWake(leanTo, slot) {
        const pawn = this.player;
        const occ = leanTo?.entry?.occupants?.[slot];
        if (!pawn || occ !== pawn.pawnId) return false;
        if (this.simAuth()) {
            this.net.sendAction({
                type: NetProtocol.Actions.SLEEP,
                op: "wake",
                pawnId: pawn.pawnId
            });
        }
        this._wakePawn(pawn, { manual: true });
        this.leanToPanel?.close();
        this.applyRestClock?.();
        return true;
    },

    tryDestroyLeanTo(leanTo) {
        const entry = leanTo?.entry;
        if (!entry || (typeof Sleep !== "undefined" && !Sleep.isEmpty(entry))) return false;
        if (!leanTo.inRange?.()) return false;
        if (this.simAuth()) {
            this.net.sendAction({
                type: NetProtocol.Actions.SLEEP,
                op: "destroy",
                uid: entry.uid,
                pawnId: this.player?.pawnId
            });
            this.leanToPanel?.close();
            return true;
        }
        this._cancelRestWalksTo(entry.uid);
        const itemDef = this.getItem(typeof Place !== "undefined"
            ? Place.itemIdForThing(entry.id, this.items())
            : "lean_to");
        const stacks = typeof Sleep !== "undefined"
            ? Sleep.salvageStacks(itemDef?.recipe)
            : [];
        const tiles = typeof Place !== "undefined"
            ? Place.entryFootprintTiles(entry, this.tileSize, leanTo.meta)
            : null;
        const piles = typeof Sleep !== "undefined"
            ? Sleep.scatterSalvagePiles(stacks, tiles, this.tileSize)
            : stacks.map((s) => ({ ...s, x: leanTo.x, y: leanTo.y }));
        for (const pile of piles) {
            const meta = this.getItem(pile.id);
            if (!meta || !(pile.quantity > 0)) continue;
            DroppedItem.spawn(this, pile.x, pile.y, meta, pile.quantity);
        }
        this._removeLeanToThing(leanTo);
        this.leanToPanel?.close();
        return true;
    },

    _removeLeanToThing(leanTo) {
        if (!leanTo) return;
        const entry = leanTo.entry;
        const uid = entry?.uid;
        const dropFrom = (chunk) => {
            const list = chunk?.meta?.things;
            if (!Array.isArray(list)) return;
            for (let i = list.length - 1; i >= 0; i--) {
                const e = list[i];
                if (e === entry || (uid && e?.uid === uid)) list.splice(i, 1);
            }
        };
        const ox = Number.isFinite(entry?.x) ? entry.x : leanTo.x;
        const oy = Number.isFinite(entry?.y) ? entry.y : leanTo.y;
        const home = this.getChunkAtWorld(ox, oy - 1)
            || this.getChunkAtWorld(leanTo.x, leanTo.y - 1);
        dropFrom(home);
        if (home) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    dropFrom(this.getChunk(home.x + dx, home.y + dy));
                }
            }
        }
        if (this.leanToPanel?.leanTo === leanTo) this.leanToPanel.close();
        leanTo.destroy();
    },

    _cancelRestWalksTo(uid) {
        const intended = this._intendedSleep();
        for (const [id, spec] of [...intended.entries()]) {
            if (spec?.uid !== uid) continue;
            intended.delete(id);
            const pawn = (this.party || []).find((p) => p.pawnId === id);
            if (pawn) {
                pawn._restWalk = null;
                this._sleepLog(`${pawn.pawnName || "They"} can't rest there`);
            }
        }
    },

    _orderRest(pawn, entry, slot, opts = {}) {
        if (!pawn || !entry) return false;
        const id = pawn.pawnId;
        if (pawn._resting && pawn.lastSleep?.uid === entry.uid && pawn.lastSleep?.slot === slot) {
            return true;
        }
        if (typeof Sleep !== "undefined" && this._sleepSlotClaimed(entry, slot, id)) {
            this._sleepLog("That spot is taken");
            return false;
        }
        this._cancelPawnChannels(pawn);
        if (pawn._resting) this._wakePawn(pawn, { moving: true });
        pawn._restWalk = { uid: entry.uid, slot };
        pawn.lastSleep = { uid: entry.uid, slot };
        this._intendedSleep().set(id, { uid: entry.uid, slot });
        if (opts.autofill) this._autofillInjured(entry);
        return true;
    },

    _autofillInjured(originEntry) {
        const originSpr = this.findLeanToByUid(originEntry.uid);
        const ox = originSpr?.x ?? originEntry.x;
        const oy = originSpr?.y ?? originEntry.y;
        const ts = this.tileSize;
        const intended = this._intendedSleep();
        const taken = new Set();
        for (const spec of intended.values()) taken.add(`${spec.uid}:${spec.slot}`);
        this.forEachSleepEntry((e) => {
            (e.occupants || []).forEach((id, i) => {
                if (id) taken.add(`${e.uid}:${i}`);
            });
        });
        const slots = [];
        this.forEachSleepEntry((e, def, chunk) => {
            const spr = this.findLeanToByUid(e.uid);
            const x = spr?.x ?? e.x;
            const y = spr?.y ?? e.y;
            if (typeof Sleep !== "undefined" && !Sleep.inCampRange(ox, oy, x, y, ts)) return;
            const n = typeof Sleep !== "undefined" ? Sleep.slotCount(def, e) : 2;
            for (let i = 0; i < n; i++) {
                const key = `${e.uid}:${i}`;
                if (taken.has(key)) continue;
                slots.push({ entry: e, def, slot: i, x, y });
            }
        });
        const injured = (this.party || []).filter((p) => {
            if (!p || p === this.player || p.isBodyDead?.()) return false;
            if (p._resting || p._restWalk) return false;
            if (p._downed || p.isIncapacitated?.() || p.isImmobile?.()) return false;
            return typeof Sleep !== "undefined" ? Sleep.injuredForAutofill(p.anatomy) : false;
        });
        for (const pawn of injured) {
            const next = slots.shift();
            if (!next) break;
            taken.add(`${next.entry.uid}:${next.slot}`);
            this._orderRest(pawn, next.entry, next.slot, { autofill: false });
        }
    },

    _occupySlot(pawn, entry, slot) {
        if (!pawn || !entry) return false;
        if (!Array.isArray(entry.occupants)) entry.occupants = [null, null];
        if (entry.occupants[slot] && entry.occupants[slot] !== pawn.pawnId) {
            this._sleepLog("That spot is taken");
            pawn._restWalk = null;
            this._intendedSleep().delete(pawn.pawnId);
            return false;
        }
        const already = entry.occupants[slot] === pawn.pawnId && pawn._resting
            && pawn.lastSleep?.uid === entry.uid
            && (pawn.lastSleep?.slot || 0) === slot;
        this.forEachSleepEntry((e) => {
            if (!Array.isArray(e.occupants)) return;
            for (let i = 0; i < e.occupants.length; i++) {
                if (e.occupants[i] === pawn.pawnId) e.occupants[i] = null;
            }
        });
        entry.occupants[slot] = pawn.pawnId;
        pawn._restWalk = null;
        pawn._resting = true;
        pawn.lastSleep = { uid: entry.uid, slot, rot: entry.rot };
        this._intendedSleep().delete(pawn.pawnId);
        pawn.setVelocity?.(0, 0);
        if (typeof pinRestingCreature === "function") pinRestingCreature(pawn, this);
        else {
            const pos = typeof Sleep !== "undefined"
                ? Sleep.sleeperWorldPos(entry, slot, this.tileSize, def)
                : { x: entry.x, y: entry.y };
            setCreatureRest?.(pawn, true, entry.rot);
            pawn.setPosition?.(pos.x, pos.y);
            pawn.syncSortDepth?.();
        }
        this.applyRestClock();
        if (!already) this.leanToPanel?.refresh?.();
        if (!already && pawn === this.player) {
            this._closeWorldUisForRest();
            this._netSendMove?.(true);
        }
        return true;
    },

    _wakePawn(pawn, opts = {}) {
        if (!pawn) return;
        const id = pawn.pawnId;
        const last = pawn.lastSleep;
        this.forEachSleepEntry((e) => {
            if (!Array.isArray(e.occupants)) return;
            for (let i = 0; i < e.occupants.length; i++) {
                if (e.occupants[i] === id) e.occupants[i] = null;
            }
        });
        pawn._restWalk = null;
        this._intendedSleep().delete(id);
        setCreatureRest?.(pawn, false);
        pawn._resting = false;
        if (!(pawn._downed || pawn.isIncapacitated?.() || pawn.isImmobile?.())) {
            pawn._netProne = false;
        }
        pawn._settlerAct = null;
        if (pawn.partyAI) pawn.partyAI._settlerAct = null;
        this._placePawnAtWakePos(pawn, last);
        pawn._skipMove = true;
        if (opts.help) pawn._wokeFromRest = true;
        if (opts.manual) pawn._wokeFromRest = false;
        this.applyRestClock();
        this.leanToPanel?.refresh?.();
    },

    /** Standing pose just outside the open side — same tile the Wake button uses. */
    _placePawnAtWakePos(pawn, last = null) {
        const spec = last || pawn?.lastSleep;
        if (!pawn || !spec?.uid || typeof Sleep === "undefined") return false;
        const lean = this.findLeanToByUid(spec.uid);
        const entry = lean?.entry;
        if (!entry) return false;
        const pos = Sleep.besideWorldPos(entry, this.tileSize, lean.meta);
        if (typeof ensureStandingFeetOrigin === "function") ensureStandingFeetOrigin(pawn);
        if (typeof pawn.teleport === "function") pawn.teleport(pos.x, pos.y);
        else pawn.setPosition?.(pos.x, pos.y);
        pawn.setVelocity?.(0, 0);
        pawn._physX = pos.x;
        pawn._physY = pos.y;
        if (pawn.body) {
            pawn.body.setVelocity?.(0, 0);
            if (typeof syncPawnPhysicsPose === "function") syncPawnPhysicsPose(pawn);
            else pawn.body.reset?.(pos.x, pos.y);
        }
        pawn._wakeIframes = 2;
        return true;
    },

    applyRestClock() {
        if (this.simAuth()) return this.tickSpeed;
        const base = Number.isFinite(this._baseTickSpeed) ? this._baseTickSpeed : (this.tickSpeed || 1);
        const speed = this.setTickSpeed(base);
        this.updateClockText?.();
        return speed;
    },

    _tickSleepZzz(delta) {
        const seen = new Set();
        const tick = (host) => {
            if (typeof tickSleepZzz === "function") tickSleepZzz(host, this, delta);
            if (typeof tickSleepHealFx === "function") tickSleepHealFx(host, this, delta);
        };
        for (const p of this.party || []) {
            if (!p || seen.has(p)) continue;
            seen.add(p);
            tick(p);
        }
        for (const p of this.settlers || []) {
            if (!p || seen.has(p)) continue;
            seen.add(p);
            tick(p);
        }
        if (this.player && !seen.has(this.player)) tick(this.player);
        for (const entry of this.remotePlayers?.values?.() || []) tick(entry);
    },

    _tickPaintFx(delta) {
        const seen = new Set();
        const tickPawn = (host) => {
            if (!host || seen.has(host)) return;
            seen.add(host);
            if (typeof tickPaintFlecks === "function") tickPaintFlecks(host, this, delta);
        };
        for (const p of this.party || []) tickPawn(p);
        for (const p of this.settlers || []) tickPawn(p);
        if (this.player) tickPawn(this.player);
        this.settlementSys?._forEachThing?.((t) => {
            if (t && typeof t.tickPaintFx === "function") t.tickPaintFx(delta);
        });
    },

    _tryWakePlayer() {
        const pawn = this.player;
        if (!pawn?._resting) return;
        if (this.simAuth()) {
            this.net.sendAction({
                type: NetProtocol.Actions.SLEEP,
                op: "wake",
                pawnId: pawn.pawnId
            });
        }
        this._wakePawn(pawn, { manual: true });
    },

    _sleepSlotClaimed(entry, slot, exceptId) {
        if (!entry) return true;
        const occ = entry.occupants?.[slot];
        if (occ && occ !== exceptId) return true;
        for (const [id, spec] of this._intendedSleep()) {
            if (id === exceptId) continue;
            if (spec?.uid === entry.uid && spec.slot === slot) return true;
        }
        for (const p of [...(this.party || []), ...(this.settlers || [])]) {
            if (!p || p.pawnId === exceptId) continue;
            if (p._restWalk?.uid === entry.uid && p._restWalk.slot === slot) return true;
            if (p._resting && p.lastSleep?.uid === entry.uid && (p.lastSleep.slot || 0) === slot) {
                return true;
            }
        }
        return false;
    },

    _tryInjuredRest(pawn) {
        if (!pawn || pawn === this.player || pawn.isControlled?.()) return;
        if (pawn._resting || pawn._restWalk || pawn._wokeFromRest) return;
        if (pawn.partyAI?.assistTarget) return;
        if (this.partySys?._shouldDelaySleep?.(pawn)) return;
        if (pawn._downed || pawn.isIncapacitated?.() || pawn.isImmobile?.()) return;
        if (typeof Sleep === "undefined" || !Sleep.injuredForAutofill(pawn.anatomy)) return;
        this._tryReturnToBed(pawn);
    },

    _tryReturnToBed(pawn) {
        if (!pawn || pawn._resting || pawn._restWalk) return;
        if (pawn.role === "settler" && !pawn.homeSettlementId) {
            pawn._wokeFromRest = false;
            return;
        }
        if (!Sleep.capableToFight(pawn) && (pawn._downed || pawn.isIncapacitated?.())) {
            pawn._wokeFromRest = false;
            return;
        }
        const id = pawn.pawnId;
        const last = pawn.lastSleep;
        let entry = null;
        let slot = 0;
        if (last?.uid) {
            const lean = this.findLeanToByUid(last.uid);
            entry = lean?.entry;
            slot = last.slot || 0;
            if (entry && this._sleepSlotClaimed(entry, slot, id)) entry = null;
        }
        if (!entry) {
            const ox = pawn.x;
            const oy = pawn.y;
            let best = null;
            let bestD = Infinity;
            this.forEachSleepEntry((e, def) => {
                const spr = this.findLeanToByUid(e.uid);
                const x = spr?.x ?? e.x;
                const y = spr?.y ?? e.y;
                if (!Sleep.inCampRange(ox, oy, x, y, this.tileSize)) return;
                const n = Sleep.slotCount(def, e);
                for (let i = 0; i < n; i++) {
                    if (this._sleepSlotClaimed(e, i, id)) continue;
                    const d = Math.hypot(ox - x, oy - y);
                    if (d < bestD) {
                        bestD = d;
                        best = { entry: e, slot: i };
                    }
                }
            });
            if (best) {
                entry = best.entry;
                slot = best.slot;
            }
        }
        pawn._wokeFromRest = false;
        if (entry) this._orderRest(pawn, entry, slot, { autofill: false });
    },

    _isLocalPartyPawn(pawn) {
        return !!(pawn && (this.party?.includes(pawn) || pawn === this.player || pawn === this.leader));
    },

    /** Stand capable resters in camp so they can defend, then return to bed after. */
    nearbyDrops() {
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;
        return this.droppedItems.getChildren()
            .filter(d => d.active)
            .map(d => ({
                drop: d,
                dist: Phaser.Math.Distance.Between(px, py, d.x, d.y)
            }))
            .filter(e => e.dist * e.dist <= r2)
            .sort((a, b) => a.dist - b.dist)
            .map(e => e.drop);
    },

    consumeNearbyDrops(requirements) {
        // requirements: { stick: 15, leaf: 10 }
        const drops = this.nearbyDrops();

        const available = {};
        for (const id of Object.keys(requirements)) available[id] = 0;
        for (const d of drops) {
            const id = d.item?.id;
            if (id in available) available[id] += d.quantity;
        }
        for (const [id, need] of Object.entries(requirements)) {
            if ((available[id] || 0) < need) return false;
        }

        for (const [id, need] of Object.entries(requirements)) {
            let left = need;
            for (const d of drops) {
                if (left <= 0) break;
                if (d.item?.id !== id || !d.active) continue;
                const take = Math.min(d.quantity, left);
                d.quantity -= take;
                left -= take;
                if (d.quantity <= 0) d.destroy();
                else d.syncToEntry?.();
            }
        }
        return true;
    },

    /** Pointer world position for firestarter aim, or null. */
    _firestarterAimWorld() {
        const pointer = this.input?.activePointer;
        if (!pointer || !this.cameras?.main) return null;
        return this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    },

    /**
     * Tile under a ground drop's sprite. Drops use origin (0, 1), so the stored
     * x,y is the bottom-left — using that directly often picks the tile to the
     * left of the visible pile.
     */
    _dropVisualTile(drop) {
        if (!drop) return null;
        const b = drop.getBounds?.();
        if (b && Number.isFinite(b.centerX) && Number.isFinite(b.centerY)) {
            return this.worldToTile(b.centerX, b.centerY);
        }
        const w = Number(drop.displayWidth) || this.tileSize * 0.7;
        return this.worldToTile(Number(drop.x) + w * 0.5, Number(drop.y) - 1);
    },

    /** True when a ground drop (sprite or meta entry) sits on a water tile. */
    _dropIsOnWater(drop) {
        if (!drop) return false;
        if (typeof Hide !== "undefined") {
            const pt = Hide.dropSamplePoint(
                drop.x ?? drop.entry?.x,
                drop.y ?? drop.entry?.y,
                this.tileSize
            );
            if (this._isWaterAt(pt.x, pt.y)) return true;
        }
        const t = drop.getBounds ? this._dropVisualTile(drop) : null;
        if (!t) return false;
        const c = this.tileCenter(t.tx, t.ty);
        return this._isWaterAt(c.x, c.y - 1);
    },

    _pickDropNearAim(drops, aim, itemId) {
        const list = drops.filter(d => d.item?.id === itemId);
        if (!list.length) return null;
        if (!aim) return list[0];
        const aimR2 = (this.tileSize * 1.25) * (this.tileSize * 1.25);
        let aimed = null;
        let nearest = list[0];
        let nearestD = Infinity;
        for (const d of list) {
            const dx = d.x - aim.x;
            const dy = d.y - aim.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < nearestD) {
                nearestD = d2;
                nearest = d;
            }
            const b = d.getBounds?.();
            const underCursor = d2 <= aimR2
                || !!(b && Phaser.Geom.Rectangle.Contains(b, aim.x, aim.y));
            if (underCursor && !aimed) aimed = d;
        }
        return aimed || nearest;
    },

    /**
     * Tile for a new campfire from ground sticks/leaves.
     * Prefer the leaf pile under the cursor (else nearest leaf to aim);
     * fall back to sticks only if there are no leaves.
     */
    campfireTileFromDrops(drops, aim = null) {
        const anchor = this._pickDropNearAim(drops, aim, "leaf")
            || this._pickDropNearAim(drops, aim, "stick");
        if (!anchor) return null;
        return this._dropVisualTile(anchor);
    },

    /**
     * Character whose techs apply to the local player.
     */
    _playerResearchHolder() {
        const pl = this.leader || this.player;
        if (!pl) return null;
        const R = typeof Research !== "undefined" ? Research : null;
        R?.ensureTechs?.(pl);
        return pl;
    },

    _playerResearchSpent() {
        const pl = this.leader || this.player;
        return Math.max(0, Math.floor(Number(pl?.researchSpent) || 0));
    },

    _ownerResearchCircles() {
        const sys = this.settlementSys;
        if (!sys?.researchCircleEntries) return [];
        const owned = sys.owned?.() || [];
        const out = [];
        const seen = new Set();
        for (const s of owned) {
            for (const e of sys.researchCircleEntries(s) || []) {
                const k = e?.uid || `${e?.x},${e?.y}`;
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(e);
            }
        }
        return out;
    },

    _playerResearchExtra() {
        return {
            spent: this._playerResearchSpent(),
            settle: this._playerResearchHolder()
        };
    },

    /**
     * Settlement whose camp menu is in range (standing in one, else home).
     */
    _playerResearchSettle() {
        return this.settlementSys?.here?.(this.player)
            || this.settlementSys?.owned?.()?.[0]
            || null;
    },

    knowsFire() {
        const R = typeof Research !== "undefined" ? Research : null;
        if (!R?.techUnlocked) return true;
        return R.techUnlocked("fire", this._playerResearchHolder());
    },

    /**
     * True when Space + firestarter should light instead of attack:
     * cursor on/near an in-range unlit fueled campfire, or on/near stick/leaf
     * piles with enough materials in interaction range for a new fire.
     */
    canUseFirestarter() {
        if (!this.knowsFire()) return false;
        const pointer = this.input?.activePointer;
        if (!pointer || !this.player) return false;
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;
        const aimR = this.tileSize * 1.25;
        const aimR2 = aimR * aimR;

        const nearAim = (x, y, spr = null) => {
            const dx = x - world.x;
            const dy = y - world.y;
            if (dx * dx + dy * dy <= aimR2) return true;
            const b = spr?.getBounds?.();
            return !!(b && Phaser.Geom.Rectangle.Contains(b, world.x, world.y));
        };

        for (const fire of this.getCampfires()) {
            if (!fire?.active || fire.isLit() || !fire.hasFuel()) continue;
            const dx = fire.x - px;
            const dy = fire.y - py;
            if (dx * dx + dy * dy > r2) continue;
            if (nearAim(fire.x, fire.y, fire)) return true;
        }

        const drops = this.nearbyDrops();
        let sticks = 0;
        let leaves = 0;
        let aimAtMaterial = false;
        for (const d of drops) {
            const id = d.item?.id;
            if (id === "stick") sticks += d.quantity;
            else if (id === "leaf") leaves += d.quantity;
            if ((id === "stick" || id === "leaf") && nearAim(d.x, d.y, d)) {
                aimAtMaterial = true;
            }
        }
        if (!aimAtMaterial || sticks < 15 || leaves < 10) return false;
        const tile = this.campfireTileFromDrops(drops, world);
        if (!tile) return false;
        if (this.findCampfireOnTile(tile.tx, tile.ty)) return false;
        return true;
    },

    tryUseFirestarter() {
        if (!this.knowsFire()) return false;
        if (this.player?._resting) return false;
        if (this.simAuth()) {
            this._netSendMove?.(true);
            const aim = this._firestarterAimWorld();
            this.net.sendAction({
                type: NetProtocol.Actions.LIGHT_FIRE,
                x: aim?.x,
                y: aim?.y
            });
            return true;
        }
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;

        // Relight nearest fueled unlit campfire
        let best = null;
        let bestD = Infinity;
        for (const fire of this.getCampfires()) {
            if (fire.isLit() || !fire.hasFuel()) continue;
            const dx = fire.x - px;
            const dy = fire.y - py;
            const d2 = dx * dx + dy * dy;
            if (d2 <= r2 && d2 < bestD) {
                bestD = d2;
                best = fire;
            }
        }
        if (best) {
            best.setKind('campfire');
            best.ensureBurning();
            this.markLightDirty();
            this.updateLightVeil();
            this.player?.wearHeld?.(1);
            return true;
        }

        // Ground recipe: 15 sticks + 10 leaves — spawn on the leaves' tile
        // (the pile under the cursor, else nearest leaf to aim).
        const drops = this.nearbyDrops();
        const tile = this.campfireTileFromDrops(drops, this._firestarterAimWorld());
        if (!tile) return false;
        const { tx, ty } = tile;
        if (this.findCampfireOnTile(tx, ty)) return false;
        if (!this.consumeNearbyDrops({ stick: 15, leaf: 10 })) return false;

        const stick = this.getItem('stick');
        const leaf = this.getItem('leaf');
        const fire = this.placeCampfire(
            tx,
            ty,
            makeItemStack(leaf, 10, undefined, this.worldMinuteIndex()),
            makeItemStack(stick, 15, undefined, this.worldMinuteIndex())
        );
        if (fire) fire.ensureBurning();
        if (fire) {
            this.markLightDirty();
            this.updateLightVeil();
            this.player?.wearHeld?.(1);
        }
        return !!fire;
    },

    updateClockText() {
        if (!this.clockText?.active || !this.clockText.scene) return;
        const h = Math.floor(this.gameMinutes / 60);
        const m = this.gameMinutes % 60;
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        this.clockText.setText(`Day ${this.gameDay}  ${hh}:${mm}`);
        crispUiText(this.clockText);
        const s = this.uiScale || 1;
        placeUiText(this.clockText, this.scale.width / 2, Math.round(8 * s), 0.5, 0);
    },

    /**
     * Debug: change how fast the world clock ticks.
     * @param {Number} mult  1 = normal (1 game min / real sec), 60 ≈ 1 game hour/sec, 0 = pause
     */
    setTickSpeed(mult, opts = {}) {
        const m = Number(mult);
        if (!Number.isFinite(m) || m < 0) return this.tickSpeed;
        if (!opts.fromRest) this._baseTickSpeed = m;
        this.tickSpeed = m;
        return this.tickSpeed;
    },

    /** Absolute in-game minute index (for regrow timers). */
    worldMinuteIndex() {
        return (Number(this.gameDay) || 1) * 1440 + (Number(this.gameMinutes) || 0);
    },

    /** Roll regrowAt = now + base * (0.85..1.15). */
    jitteredRegrowAt(baseMinutes) {
        return GameMath.jitteredRegrowAt(baseMinutes, this.worldMinuteIndex());
    },

    /**
     * If entry.regrowAt is due, restore id / clear gone flags (no sprites).
     * @returns {boolean} true if entry was updated
     */
    _forEachHungerPawn(fn) {
        const seen = new Set();
        const visit = (p) => {
            if (!p || seen.has(p) || p.isBodyDead?.()) return;
            seen.add(p);
            fn(p);
        };
        visit(this.player);
        for (const p of this.party || []) visit(p);
        for (const p of this.settlers || []) visit(p);
    },

    tickBodySystems() {
        // Dedicated: server owns bleed/heal/hediffs. Blood VFX arrives via "bleed" events.
        // Running minuteTick here double-applied bloodLoss and only dripped on one client.
        if (this.simAuth()) {
            this.healthPanel?.refresh?.();
            return;
        }
        if (this.player && !this.player.isBodyDead?.()) {
            BodyHealing.minuteTick(this.player, this);
        }
        for (const p of this.party || []) {
            if (p && p !== this.player && p.active && !p.isBodyDead?.()) {
                BodyHealing.minuteTick(p, this);
            }
        }
        for (const w of this.partySys?.wanderers || []) {
            if (w?.active && !w.isBodyDead?.()) BodyHealing.minuteTick(w, this);
        }
        for (const s of this.settlers || []) {
            if (s?.active && !s.isBodyDead?.()) BodyHealing.minuteTick(s, this);
        }
        for (const mob of this.mobs?.getChildren?.() || []) {
            if (mob?.active && !mob.isBodyDead?.()) BodyHealing.minuteTick(mob, this);
        }
        this.healthPanel?.refresh?.();
    },

    /** Debug: when false, skip spawning/painting blood stains. */
    setBloodDraw(on) {
        this.bloodDraw = !!on;
        for (const chunk of Object.values(this.chunks || {})) {
            if (!chunk?.isLoaded) continue;
            if (this.bloodDraw) this.rebuildBloodGfx(chunk);
            else {
                const rt = chunk._bloodRt;
                if (rt?.active) {
                    rt.clear();
                    rt.setVisible(false);
                }
                chunk._bloodGfx?.clear?.();
                chunk._bloodGfx?.setVisible?.(false);
            }
        }
        return this.bloodDraw;
    },

    /** Small yellow/white puff when apparel fully deflects a blow. No sound. */
    spawnApparelDeflectSpark(x, y) {
        if (!this.add || !(Number.isFinite(x) && Number.isFinite(y))) return;
        const n = Phaser.Math.Between(6, 9);
        const colors = [0xfff4c0, 0xffe08a, 0xffffff, 0xf0d070, 0xd8c070];
        const baseAngle = Math.random() * Math.PI * 2;
        for (let i = 0; i < n; i++) {
            const size = Phaser.Math.Between(1, 2);
            const p = this.add.rectangle(x, y, size, size, colors[i % colors.length], 1)
                .setDepth((y || 0) + 32);
            this.mainLayer?.add(p);
            const angle = baseAngle + (i / n) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.12, 0.12);
            const dist = Phaser.Math.FloatBetween(4, 9);
            const tx = x + Math.cos(angle) * dist;
            const ty = y + Math.sin(angle) * dist;
            const dur = Phaser.Math.Between(220, 380);
            this.tweens.add({
                targets: p,
                x: tx,
                y: ty,
                alpha: 0,
                duration: dur,
                ease: "Sine.easeOut",
                onComplete: () => p.destroy()
            });
        }
    },

    spawnBloodStain(x, y, opts = null) {
        if (this.bloodDraw === false) return;
        // No blood pools on water (ice is fine)
        if (this._isWaterAt(x, y - 1)) return;
        const chunk = LivingMob.ensureChunkAt(this, x, y);
        if (!chunk) return;
        if (!chunk.meta.bloodStains) chunk.meta.bloodStains = [];
        const list = chunk.meta.bloodStains;
        const kind = opts?.kind || "blood";
        const isVomit = kind === "vomit";
        const color = opts?.color != null
            ? opts.color
            : (isVomit ? 0x7a9e28 : 0x6b1010);
        const rMin = opts?.radiusMin != null
            ? opts.radiusMin
            : (isVomit ? 0.7 : SceneMain.BLOOD_RADIUS_MIN);
        const rMax = opts?.radiusMax != null
            ? opts.radiusMax
            : (isVomit ? 1.8 : Math.min(2.4, SceneMain.BLOOD_RADIUS_MAX));
        const rCap = opts?.radiusCap != null
            ? opts.radiusCap
            : (isVomit ? 4.5 : SceneMain.BLOOD_RADIUS_MAX);
        const grow = opts?.grow != null
            ? opts.grow
            : (isVomit ? 0.35 : SceneMain.BLOOD_MERGE_GROW);
        const alpha = opts?.alpha != null
            ? opts.alpha
            : (isVomit ? 0.7 : 0.55);
        const mergeDist = opts?.merge === false
            ? 0
            : (opts?.mergeDist != null
                ? Number(opts.mergeDist)
                : (isVomit ? SceneMain.BLOOD_MERGE_DIST * 1.35 : SceneMain.BLOOD_MERGE_DIST));
        const mergeDistSq = mergeDist * mergeDist;

        // Grow a nearby pool of the same kind instead of adding another circle
        let best = null;
        let bestD = mergeDistSq;
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if ((e.kind || "blood") !== kind) continue;
            const dx = e.x - x;
            const dy = e.y - y;
            const d = dx * dx + dy * dy;
            if (d <= bestD) {
                bestD = d;
                best = e;
            }
        }
        if (best) {
            best.radius = Math.min(
                rCap,
                (Number(best.radius) || rMin) + grow
            );
            // Pull pool slightly toward the new drip
            best.x = best.x * 0.75 + x * 0.25;
            best.y = best.y * 0.75 + y * 0.25;
            best.lifeMinutes = SceneMain.BLOOD_LIFE_MINUTES;
            best.color = color;
            best.kind = kind;
            best.alpha = alpha;
            if (chunk.isLoaded) this._paintBloodStain(chunk, best);
            return;
        }

        let needsRebuild = false;
        while (list.length >= SceneMain.BLOOD_STAINS_MAX) {
            list.shift();
            needsRebuild = true;
        }
        const entry = {
            x,
            y,
            kind,
            color,
            alpha,
            radius: Phaser.Math.FloatBetween(rMin, Math.min(rMax, rCap)),
            lifeMinutes: SceneMain.BLOOD_LIFE_MINUTES
        };
        list.push(entry);
        if (!chunk.isLoaded) return;
        if (needsRebuild) this.rebuildBloodGfx(chunk);
        else this._paintBloodStain(chunk, entry);
    },

    /**
     * Projectile bile spray: staggered elongated droplets fly from the mouth
     * in a cone, then leave small puddle stains on impact.
     * @param {number} x mouth / origin x
     * @param {number} y mouth / origin y
     * @param {{ facing?: string }} [opts]
     */
    spawnVomitStain(x, y, opts = null) {
        const facing = opts?.facing || "down";
        let fx = 0;
        let fy = 1;
        if (facing === "right") { fx = 1; fy = 0; }
        else if (facing === "left") { fx = -1; fy = 0; }
        else if (facing === "up") { fx = 0; fy = -1; }
        const px = -fy;
        const py = fx;

        // Sickly bile / olive / mustard — not neon highlighter green
        const palette = [
            0x6b8f22, 0x7a9e28, 0x9bb83a, 0xa8a030,
            0xc2c84a, 0x5a7a1c, 0x8a6e20, 0x4e6818
        ];

        const count = Phaser.Math.Between(14, 22);
        for (let i = 0; i < count; i++) {
            const delay = i * Phaser.Math.Between(10, 26);
            // Mix short dribbles with longer projectiles
            const roll = Math.random();
            const dist = roll < 0.25
                ? Phaser.Math.FloatBetween(4, 10)
                : roll < 0.7
                    ? Phaser.Math.FloatBetween(10, 22)
                    : Phaser.Math.FloatBetween(20, 34);
            const cone = 2.5 + dist * 0.32;
            const spread = (Math.random() - 0.5) * 2 * cone;
            const jx = (Math.random() - 0.5) * 1.5;
            const jy = (Math.random() - 0.5) * 1.5;
            const landX = x + fx * dist + px * spread + jx;
            const landY = y + fy * dist + py * spread + jy;
            const color = Phaser.Utils.Array.GetRandom(palette);
            const size = Phaser.Math.FloatBetween(0.55, 1.55);
            const flightMs = Phaser.Math.Clamp(
                110 + dist * 7 + Phaser.Math.Between(0, 60),
                120,
                380
            );

            this.time.delayedCall(delay, () => {
                if (!this.sys?.isActive?.()) return;
                this._spawnVomitDroplet(x, y, landX, landY, {
                    color,
                    size,
                    flightMs,
                    fx,
                    fy,
                    px,
                    py
                });
            });
        }
    },

    /**
     * One flying vomit droplet; leaves ground stains on impact.
     * @param {number} sx
     * @param {number} sy
     * @param {number} lx
     * @param {number} ly
     * @param {{ color: number, size: number, flightMs: number, fx: number, fy: number, px: number, py: number }} opts
     */
    _spawnVomitDroplet(sx, sy, lx, ly, opts) {
        const dx = lx - sx;
        const dy = ly - sy;
        const len = Math.hypot(dx, dy) || 1;
        const angle = Math.atan2(dy, dx);
        const color = opts.color;
        const r = opts.size;

        // Elongated blob stretched along flight direction
        const blob = this.add.circle(sx, sy, r, color, 0.92);
        this.mainLayer?.add(blob);
        blob.setDepth(sy + 28);
        blob.setRotation(angle);
        const stretchX = Phaser.Math.FloatBetween(1.7, 2.6);
        const stretchY = Phaser.Math.FloatBetween(0.4, 0.65);
        blob.setScale(stretchX, stretchY);

        // Loft the path slightly (screen-up) so it reads as a spray arc in top-down
        const loft = Phaser.Math.FloatBetween(3, 8);
        const sideWobble = (Math.random() - 0.5) * 3;
        const midX = (sx + lx) * 0.5 + opts.px * sideWobble;
        const midY = (sy + ly) * 0.5 + opts.py * sideWobble - loft;

        const state = { t: 0 };
        this.tweens.add({
            targets: state,
            t: 1,
            duration: opts.flightMs,
            ease: "Cubic.easeOut",
            onUpdate: () => {
                if (!blob.active) return;
                const t = state.t;
                const omt = 1 - t;
                // Quadratic Bezier mouth → loft → land
                blob.x = omt * omt * sx + 2 * omt * t * midX + t * t * lx;
                blob.y = omt * omt * sy + 2 * omt * t * midY + t * t * ly;
                const bulge = 1 + Math.sin(t * Math.PI) * 0.4;
                blob.setScale(stretchX * bulge, stretchY * bulge);
                blob.setAlpha(0.95 - t * 0.12);
                blob.setDepth(blob.y + 28);

                // Occasional mid-air drip trail
                if (t > 0.2 && t < 0.85 && Math.random() < 0.04) {
                    this.spawnBloodStain(blob.x, blob.y, {
                        kind: "vomit",
                        color,
                        alpha: Phaser.Math.FloatBetween(0.35, 0.55),
                        radiusMin: 0.35,
                        radiusMax: 0.8,
                        radiusCap: 2.2,
                        grow: 0.2
                    });
                }
            },
            onComplete: () => {
                if (blob.active) blob.destroy();
                // Primary splat
                this.spawnBloodStain(lx, ly, {
                    kind: "vomit",
                    color,
                    alpha: Phaser.Math.FloatBetween(0.55, 0.8),
                    radiusMin: 0.7,
                    radiusMax: 1.9,
                    radiusCap: 4.2,
                    grow: 0.4
                });
                // Satellite flecks
                const flecks = Phaser.Math.Between(1, 3);
                for (let i = 0; i < flecks; i++) {
                    const ang = Math.random() * Math.PI * 2;
                    const d = Phaser.Math.FloatBetween(1.5, 5);
                    this.spawnBloodStain(
                        lx + Math.cos(ang) * d,
                        ly + Math.sin(ang) * d,
                        {
                            kind: "vomit",
                            color: Phaser.Utils.Array.GetRandom([
                                color, 0x5a7a1c, 0x8a6e20
                            ]),
                            alpha: Phaser.Math.FloatBetween(0.4, 0.65),
                            radiusMin: 0.35,
                            radiusMax: 0.9,
                            radiusCap: 2.5,
                            grow: 0.2
                        }
                    );
                }
            }
        });
    },

    _bloodStampGfx() {
        if (!this._bloodStamp || !this._bloodStamp.active) {
            this._bloodStamp = this.make.graphics({ x: 0, y: 0, add: false });
        }
        return this._bloodStamp;
    },

    /** Chunk-local blood RT — one texture, stamp circles (no growing command list). */
    _ensureBloodRt(chunk) {
        if (chunk._bloodRt?.active) return chunk._bloodRt;
        const size = chunk.px();
        const rt = this.make.renderTexture({
            x: chunk.x * size,
            y: chunk.y * size,
            width: size,
            height: size,
            add: false
        }).setOrigin(0).setDepth(0.5);
        this.groundLayer.add(rt);
        chunk._bloodRt = rt;
        // Drop legacy Graphics mesh if present
        chunk._bloodGfx?.destroy?.();
        chunk._bloodGfx = null;
        return rt;
    },

    _paintBloodStain(chunk, entry) {
        if (this.bloodDraw === false) return;
        const isVomit = (entry.kind || "blood") === "vomit";
        const rCap = isVomit ? 4.5 : SceneMain.BLOOD_RADIUS_MAX;
        const rMin = isVomit ? 0.55 : SceneMain.BLOOD_RADIUS_MIN;
        const r = Phaser.Math.Clamp(
            Number(entry.radius) || rMin,
            rMin,
            rCap
        );
        entry.radius = r;
        const rt = this._ensureBloodRt(chunk);
        rt.setVisible(true);
        const size = chunk.px();
        const lx = entry.x - chunk.x * size;
        const ly = entry.y - chunk.y * size;
        const stamp = this._bloodStampGfx();
        stamp.clear();
        const color = entry.color != null ? entry.color : (isVomit ? 0x7a9e28 : 0x6b1010);
        const alpha = entry.alpha != null ? entry.alpha : (isVomit ? 0.7 : 0.55);

        if (isVomit) {
            // Irregular small puddle — lobes stay subtle so it doesn't read as big circles
            stamp.fillStyle(color, alpha);
        stamp.fillCircle(0, 0, r);
            stamp.fillStyle(color, Math.min(1, alpha + 0.05));
            stamp.fillCircle(r * 0.4, r * 0.15, r * 0.45);
            stamp.fillCircle(-r * 0.35, r * 0.25, r * 0.38);
            // Darker sludge fleck
            stamp.fillStyle(0x3d5210, alpha * 0.5);
            stamp.fillCircle(-r * 0.15, -r * 0.1, r * 0.22);
            // Dull highlight (not neon)
            stamp.fillStyle(0xc5c85a, alpha * 0.28);
            stamp.fillCircle(r * 0.08, r * 0.02, r * 0.18);
        } else {
            stamp.fillStyle(color, alpha);
            stamp.fillCircle(0, 0, r);
        }
        rt.draw(stamp, lx, ly);
    },

    /** Full redraw (after expiry / eviction / chunk load). */
    rebuildBloodGfx(chunk) {
        if (!chunk) return;
        if (this.bloodDraw === false) {
            if (chunk._bloodRt?.active) {
                chunk._bloodRt.clear();
                chunk._bloodRt.setVisible(false);
            }
            return;
        }
        const rt = this._ensureBloodRt(chunk);
        rt.clear().setVisible(true);
        for (const entry of chunk.meta?.bloodStains || []) {
            this._paintBloodStain(chunk, entry);
        }
    },

    /** @deprecated use rebuildBloodGfx — kept for Chunk.makeBloodStains call sites */
    _ensureBloodStainSprite(chunk, _entry) {
        this.rebuildBloodGfx(chunk);
    },

    tickBloodStains() {
        for (const chunk of Object.values(this.chunks || {})) {
            const list = chunk.meta?.bloodStains;
            if (!list?.length) continue;
            let removed = false;
            for (let i = list.length - 1; i >= 0; i--) {
                const e = list[i];
                e.lifeMinutes = (e.lifeMinutes || 0) - 1;
                if (e.lifeMinutes <= 0) {
                    list.splice(i, 1);
                    removed = true;
                }
            }
            if (removed && chunk.isLoaded) this.rebuildBloodGfx(chunk);
        }
    },

    /** Live sprite for a chunk corpse entry, if the chunk is loaded. */
    _liveCorpseSprite(chunk, entry) {
        if (!entry) return null;
        const groups = [chunk?.corpses, this.corpses];
        for (const g of groups) {
            const kids = g?.getChildren?.() || [];
            const hit = kids.find((c) => c?.active && c.entry === entry);
            if (hit) return hit;
        }
        if (entry.id && this.netCorpses?.has(entry.id)) return this.netCorpses.get(entry.id);
        return null;
    },

    _convertCorpseToCarcass(chunk, entry, now) {
        const Decay = typeof CorpseDecay !== "undefined" ? CorpseDecay : null;
        if (!Decay || !entry) return;
        const getItem = (id) => this.getItem(id);
        const { dump } = Decay.applyCarcassConversion(entry, {
            getItem,
            now,
            rng: () => Math.random(),
            makeStack: (item, qty, at) => makeWorldItemStack(item, qty, undefined, at)
        });
        for (const stack of dump) {
            const meta = getItem(stack.id);
            if (!meta) continue;
            const extras = typeof mealStackExtras === "function" ? mealStackExtras(stack) : null;
            const spoilAt = typeof spoilAtForWorld === "function"
                ? spoilAtForWorld(stack, now)
                : stack.spoilAt;
            DroppedItem.spawn(this, entry.x, entry.y, meta, stack.quantity, spoilAt, extras);
        }

        const spr = this._liveCorpseSprite(chunk, entry);
        if (spr) {
            spr.applyStageAppearance?.();
            if (this.player?._skinChannel?.corpse === spr) {
                this.player._cancelSkin?.();
            }
            const panel = this.corpsePanel;
            if (panel?.visible && panel.corpse === spr) {
                panel.syncFromEntry?.();
                panel._showCorpseHealth?.();
            }
        }
        this.refreshTooltip?.();
    },

    _decayRemoveCorpse(chunk, entry) {
        const spr = this._liveCorpseSprite(chunk, entry);
        if (spr?.removeForever) {
            spr.removeForever();
            return;
        }
        const list = chunk?.meta?.corpses;
        if (!Array.isArray(list) || !entry) return;
        const i = list.indexOf(entry);
        if (i >= 0) list.splice(i, 1);
    },

    /**
     * Corpse → carcass after 12h, carcass → gone after 30d.
     * Dedicated MP: server owns this (events + snapshots).
     */
    migrateWorldSpoilAt() {
        const now = this.worldMinuteIndex();
        const getItem = (id) => this.getItem(id);
        for (const chunk of Object.values(this.chunks || {})) {
            for (const entry of chunk.meta?.drops || []) {
                if (entry) migrateToSpoilAt(entry, now, getItem);
            }
            for (const corpse of chunk.meta?.corpses || []) {
                for (const stack of corpse?.loot || []) {
                    if (stack) migrateToSpoilAt(stack, now, getItem);
                }
            }
            for (const entry of chunk.meta?.things || []) {
                if (!entry) continue;
                if (entry.cook) migrateToSpoilAt(entry.cook, now, getItem);
                if (entry.catalyst) migrateToSpoilAt(entry.catalyst, now, getItem);
                for (const s of entry.simmer || []) {
                    if (s) migrateToSpoilAt(s, now, getItem);
                }
                for (const s of entry.slots || []) {
                    if (!s) continue;
                    const rack = typeof Hide !== "undefined"
                        && Hide.isDryingRack(this.getThing?.(entry.id), entry);
                    const itemDef = getItem(s.id);
                    if (rack && Hide.pausesRackSpoil(itemDef)) continue;
                    migrateToSpoilAt(s, now, getItem);
                }
            }
        }
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
