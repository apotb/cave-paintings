/**
 * SimWorld prototype methods (combat).
 * Installed onto SimWorld.prototype. Method bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SimWorldMixins = root.SimWorldMixins || {};
        root.SimWorldMixins.combat = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    "use strict";
    const {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    } = ctx;
    return {

    pushEvent(ev) {
        this._events.push(ev);
    },

    _wildHuntEntity(ent) {
        if (!ent) return false;
        return ent.kind === "mob" || ent.role === "wanderer";
    },

    _lockHuntOn(session, wild, source) {
        if (!session || !wild) return;
        session.lastHitMob = wild;
        session.lastHitAt = Date.now();
        Party.setWildAggroOwner?.(wild, source);
        const rec = this.wanderers.get(wild.id) || this.mobs.get(wild.id);
        if (rec && rec !== wild) Party.setWildAggroOwner?.(rec, source);
    },

    _partySetAssist(session, enemy) {
        if (!session || !enemy) return;
        const controlId = session.controlId || session.id;
        for (const p of this._livingPartyOf(session)) {
            if (p.id === controlId) continue;
            const c = p.creature || this.creatures.get(p.id);
            c?.ai?.setAssist?.(enemy);
        }
    },

    _connectedOwnerIdsExcept(ownerId) {
        const out = new Set();
        for (const p of this.players.values()) {
            if (!p?.connected || !p.id || p.id === ownerId) continue;
            out.add(p.id);
        }
        return out;
    },

    /**
     * Hitting wildlife / passersby so party AI chases fleeing prey, not only
     * hostiles already in the duel pool. Being mauled also locks chase.
     */
    _noteHuntHit(attacker, victim) {
        if (!attacker || !victim || attacker === victim) return;
        if (Party.sameFaction?.(attacker, victim)) return;
        if (this._wildHuntEntity(victim)) {
            const session = this.players.get(attacker.ownerId)
                || this._sessionOfPawn(attacker)
                || this.players.get(attacker.id);
            if (!session) return;
            this._lockHuntOn(session, victim, attacker);
            this._wakeAbleResters(session, victim, session);
            this._partySetAssist(session, victim);
            return;
        }
        if (!this._wildHuntEntity(attacker)) return;
        const session = this.players.get(victim.ownerId)
            || this._sessionOfPawn(victim)
            || this.players.get(victim.id);
        if (!session) return;
        this._lockHuntOn(session, attacker, victim);
        this._wakeAbleResters(session, attacker, victim);
        this._partySetAssist(session, attacker);
    },

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
    },

    /**
     * Hostile wildlife / wanderers inside the settlement circle. Sleepers and
     * workers drop what they're doing to fight these.
     */
    _settlerDefenseTarget(mob) {
        if (!mob || mob.isBodyDead?.()) return null;
        if (mob.isIncapacitated?.() || mob.isImmobile?.() || mob.isVomiting?.()) return null;
        if (typeof Sleep !== "undefined" && Sleep.capableToFight && !Sleep.capableToFight(mob)) {
            return null;
        }
        const settle = (this.settlements || []).find((s) => s && s.id === mob.homeSettlementId);
        if (!settle) return null;
        const raider = this._settlementRaider(settle, mob);
        if (raider) return raider;
        const duel = this._duelMap?.get(Party.pawnIdOf(mob) || mob.id);
        if (duel && !duel.isBodyDead?.() && this._hostileInSettlement(settle, duel, mob)) {
            return duel;
        }
        return this._nearestHostileInSettlement(settle, mob);
    },

    _hostileInSettlement(settle, ent, settler) {
        if (!ent || !settle) return false;
        if (ent.isBodyDead?.() || ent._dead || ent.dead) return false;
        if (Party.sameFaction?.(settler, ent)) return false;
        if (!Settlement.inRange(settle, ent.x, ent.y, TS)) return false;
        const owner = Party.ownerIdOf(ent);
        if (owner && this.players.has(owner)) return false;
        return !!Party.wildIsHostile?.(ent)
            || !!(ent.hostile || ent.ai?.hostile || (Number(ent.ai?.panicMs) || 0) > 0);
    },

    _nearestHostileInSettlement(settle, settler) {
        let best = null;
        let bestD = Infinity;
        const consider = (ent) => {
            if (!this._hostileInSettlement(settle, ent, settler)) return;
            const d = Math.hypot((ent.x || 0) - (settler.x || 0), (ent.y || 0) - (settler.y || 0));
            if (d >= bestD) return;
            bestD = d;
            best = ent;
        };
        for (const mob of this.mobs.values()) consider(mob);
        for (const w of this.wanderers.values()) {
            if (!w || w.dead) continue;
            consider(this._ensureWandererCreature(w) || w);
        }
        return best;
    },

    /** Name shown while a settler is chasing someone. */
    _attackingAct(target) {
        const name = target?.displayName?.() || target?.name || "";
        const who = String(name).trim();
        return who ? `Attacking ${who}` : "Attacking";
    },

    /** Different owners always count, even if a faction string was rewritten. */
    _ownersDiffer(a, b) {
        const ao = Party.ownerIdOf?.(a) || a?.ownerId || null;
        const bo = Party.ownerIdOf?.(b) || b?.ownerId || null;
        return !!(ao && bo && ao !== bo);
    },

    _pointInSettlement(settle, x, y, padTiles = 0) {
        if (!settle || !Number.isFinite(x) || !Number.isFinite(y)) return false;
        const base = Number(settle.radiusTiles) > 0
            ? Number(settle.radiusTiles)
            : (Settlement.RADIUS_TILES || 32);
        const r = base + (Number(padTiles) || 0);
        return Math.hypot(x - Number(settle.x) || 0, y - Number(settle.y) || 0) / TS <= r + 0.05;
    },

    /**
     * Feet the camp should measure. The creature pose can lag the session
     * the player is actually standing on.
     */
    _attackerInside(settle, ent) {
        if (!ent || !settle) return false;
        const pts = [];
        if (Number.isFinite(ent.x) && Number.isFinite(ent.y)) pts.push(ent.x, ent.y);
        const session = this.players.get(ent.id)
            || (ent.ownerId ? this.players.get(ent.ownerId) : null);
        if (session && !session.dead) {
            const controlId = session.controlId || session.id;
            if (session.id === ent.id || controlId === ent.id) {
                if (Number.isFinite(session.x) && Number.isFinite(session.y)) {
                    pts.push(session.x, session.y);
                }
            } else {
                const mem = (session.party || []).find((m) => m && m.id === ent.id);
                if (mem && Number.isFinite(mem.x) && Number.isFinite(mem.y)) {
                    pts.push(mem.x, mem.y);
                }
            }
        }
        // A swing can land a step past the circle while you're still on the camp.
        for (let i = 0; i < pts.length; i += 2) {
            if (this._pointInSettlement(settle, pts[i], pts[i + 1], 1.25)) return true;
        }
        return false;
    },

    /**
     * A hit on one settler turns the whole camp onto that attacker.
     * They keep chasing only while the attacker stays inside the settlement.
     */
    _aggroSettlement(victim, attacker) {
        if (!victim || !attacker || attacker === victim) return;
        if (attacker.isBodyDead?.() || attacker._dead || attacker.dead) return;
        if (!this._ownersDiffer(victim, attacker) && Party.sameFaction?.(victim, attacker)) return;
        const homeId = victim.homeSettlementId
            || this._findOwnedPawn(victim.id)?.homeSettlementId;
        if (!homeId) return;
        const settle = (this.settlements || []).find((s) => s && s.id === homeId);
        if (!settle) return;
        if (!attacker.id) return;
        if (!this._settlementAggro) this._settlementAggro = new Map();
        this._settlementAggro.set(settle.id, attacker.id);
        const label = this._attackingAct(attacker);
        for (const rec of this.settlers || []) {
            if (!rec || rec.dead || rec.homeSettlementId !== settle.id) continue;
            const cc = this._ensureSettlerCreature(rec);
            if (!cc || cc.isBodyDead?.()) continue;
            if (typeof Sleep !== "undefined" && Sleep.capableToFight && !Sleep.capableToFight(cc)) {
                continue;
            }
            SettlerWork.interruptForCombat(this, rec);
            cc.ai?.setAssist?.(attacker);
            cc._settlerAct = label;
            rec._settlerAct = label;
        }
    },

    /** Camp is chasing someone, so their names read as enemies. */
    _settlerCampHostile(rec) {
        const id = rec?.homeSettlementId && this._settlementAggro?.get(rec.homeSettlementId);
        if (!id) return false;
        const ent = this.creatures.get(id);
        return !!(ent && !ent.isBodyDead?.() && !ent._dead && !ent.dead);
    },

    /** Attacker this camp is chasing, or null once they leave or die. */
    _settlementRaider(settle, settler) {
        const id = this._settlementAggro?.get(settle?.id);
        if (!id) return null;
        const ent = this.creatures.get(id)
            || this._ensurePlayerCreature(this.players.get(id));
        const friendly = ent && !this._ownersDiffer(settler, ent) && Party.sameFaction?.(settler, ent);
        const drop = !ent
            || ent.isBodyDead?.()
            || ent._dead
            || ent.dead
            || friendly
            || !this._attackerInside(settle, ent);
        if (drop) {
            this._settlementAggro.delete(settle.id);
            return null;
        }
        return ent;
    },

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
    },

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
    },

    /**
     * Player parties only fight each other after a PvP hit.
     * Wildlife / wanderers auto-duel a nearby party unless another connected
     * session already owns the aggro.
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
    },

    _ownerEngagedWithWild(ownerId, wild) {
        const p = this.players.get(ownerId);
        if (!p || p.dead) return false;
        return !!Party.ownerEngagedWithWild?.(ownerId, wild, {
            lastHitMob: p.lastHitMob,
            otherOwnerIds: this._connectedOwnerIdsExcept(ownerId)
        });
    },

    _claimDuelAggro() {
        if (!this._duelMap) return;
        for (const [id, ent] of this._duelMap) {
            if (!ent || Party.ownerIdOf(ent)) continue;
            const fighter = this.creatures.get(id);
            const oid = Party.ownerIdOf(fighter);
            if (!oid || !this.players.has(oid)) continue;
            Party.setWildAggroOwner?.(ent, fighter);
            const rec = this.wanderers.get(ent.id) || this.mobs.get(ent.id);
            if (rec && rec !== ent) Party.setWildAggroOwner?.(rec, fighter);
        }
    },

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
    },

    /** World chat line every connected player sees (join, death, settlement news). */
    _announceWorld(text, extra = {}) {
        const msg = String(text || extra.text || "");
        if (!msg) return;
        const ev = { kind: "chat", text: msg, system: true };
        if (Array.isArray(extra.segments) && extra.segments.length) ev.segments = extra.segments;
        this.pushEvent(ev);
    },

    drainEvents() {
        const e = this._events;
        this._events = [];
        return e;
    },

    drainYouDirty() {
        const ids = [...this._youDirty];
        this._youDirty.clear();
        return ids;
    },

    _isPartialFood(stack) {
        return !!(stack?.customName || stack?.ingredients?.length);
    },

    /** Match client Player._eatSecondsFor — explicit eatSeconds, else kcal formula. */
    _eatSecondsFor(food, isMeal) {
        const explicit = Number(food?.eatSeconds);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        const kc = Math.max(0, Number(food?.kc) || 0);
        if (isMeal) return Math.min(8, Math.max(2, 1.5 + kc / 150));
        return Math.min(6, Math.max(1, 1 + kc / 120));
    },

    _foodForEat(stack) {
        const meta = itemDefs().get(stack?.id);
        const food = { ...(meta?.food || {}) };
        if (stack?.food && typeof stack.food === "object") Object.assign(food, stack.food);
        return food;
    },

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
            itemId: held.id,
            food: { ...food },
            isMeal
        };
        this._pushEatChannelEvent(p);
        this._dirtyPawnOwner(p);
    },

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
    },

    /**
     * Finish a bandage channel (client runs the bar; server applies tend + consume).
     */
    _tryTend(p, action = {}) {
        if (!p) return;
        const owned = this._ownedPawns(p);
        const findPawn = (id) => {
            if (!id) return null;
            return owned.find((m) => m.id === id) || this._findOwnedPawn(id);
        };
        const tender = findPawn(action.pawnId) || p;
        if (!tender || tender.dead) return;
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
    },

    _satietyRatio(food, isMeal = false) {
        const n = Number(food?.satietyRatio);
        if (Number.isFinite(n) && n >= 0) return n;
        return isMeal ? 0.3 : 0.1;
    },

    _finishEat(p) {
        const ch = p.eatChannel;
        p.eatChannel = null;
        if (!ch) return;
        this._pushEatChannelEvent(p, { progress: 1, done: true, itemId: ch.itemId || null });
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
    },

    _findOwnedPawn(id) {
        if (!id) return null;
        for (const pl of this.players.values()) {
            if (pl.id === id) return pl;
            const m = (pl.party || []).find((x) => x.id === id);
            if (m) return m;
        }
        return (this.settlers || []).find((s) => s && s.id === id) || null;
    },

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
    },

    _dirtyPawnOwner(pawn) {
        const session = this._sessionOfPawn(pawn);
        if (session) this._youDirty.add(session.id);
    },

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
    },

    _pawnRecordForCreature(p, creature) {
        if (!p || !creature) return null;
        if (creature === p.creature || creature.id === p.id) return p;
        return (p.party || []).find((m) => m.id === creature.id) || null;
    },

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
    },

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
    },

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
    },

    _facingFromAngle(a) {
        const ang = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (ang >= Math.PI * 0.25 && ang < Math.PI * 0.75) return "down";
        if (ang >= Math.PI * 0.75 && ang < Math.PI * 1.25) return "left";
        if (ang >= Math.PI * 1.25 && ang < Math.PI * 1.75) return "up";
        return "right";
    },

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
    },

    _kill(p, killer, action = {}) {
        if (!p) return;
        const alreadyDead = !!p.dead;
        p.dead = true;
        p.hp = 0;
        p._knapSession = null;
        p._formSession = null;
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
            const c = creature?.bodyCenter?.()
                || feetToBodyCenter(p.x, p.y, creature?.width, p.height);
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
        if (alreadyDead) {
            // The client already showed a corpse under its own id. Loot uses that id.
            this._retargetPlayerCorpse(p, action);
            return;
        }
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
    },

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
        const c = creature?.bodyCenter?.()
            || feetToBodyCenter(mem.x, mem.y, creature?.width, mem.height);
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
    },

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
    },

    /** @param {number} dtMs */
    tick(dtMs) {
        this._simTickLive = true;
        this._aiStuckDt = Number(dtMs) > 0 ? dtMs : 16;
        this._queryGen = (this._queryGen || 0) + 1;
        this._chunkRectCache = new Map();
        this._sleepRectCache = new Map();
        this._uidIndex = null;
        const dt = dtMs / 1000;
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            if (p.attackTimer > 0) p.attackTimer -= dtMs;
            this._tickPlayerVomit(p, dtMs);
            this._tickEatChannel(p, dtMs);
            this._tickTendChannel(p, dtMs);
            for (const m of p.party || []) this._tickEatChannel(m, dtMs);
            for (const m of p.party || []) this._tickTendChannel(m, dtMs);
            for (const m of p.party || []) {
                if (m && this._isVomiting(m)) this._tickPlayerVomit(m, dtMs);
            }
        }
        for (const rec of this.settlers || []) {
            if (!rec || rec.dead) continue;
            const sdt = this._settlerDtMs(dtMs);
            this._tickEatChannel(rec, sdt);
            this._tickTendChannel(rec, sdt);
            if (rec._workChannel) SettlerWork.tickChannel(this, rec, sdt);
            if (this._isVomiting(rec)) this._tickPlayerVomit(rec, sdt);
        }
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            this._loadPlayerInterest(p);
        }

        this._tickWandererDirector(dtMs);
        this._pinSettlements();
        this._tickCreatures(dtMs, dt);
        this._applyRestClock(dtMs);
        // Scale with /tick like the world clock (paused at 0×)
        this._tickDropDespawn(dtMs * (Number(this.tickSpeed) || 0));

        this._minuteAcc += dtMs * this.tickSpeed;
        while (this._minuteAcc >= 1000) {
            this._minuteAcc -= 1000;
            this._worldMinute();
        }
        this._simTickLive = false;
    },

    _sessionPartyCombat(session, uncontrolled) {
        if (this._chaseTarget(session)) return true;
        if (session.attackTimer > 0) return true;
        const control = this._actionPawn(session, { pawnId: session.controlId });
        if (control?.creature?.isAttacking?.()) return true;
        if (this._duelMap) {
            for (const pawn of this._livingPartyOf(session)) {
                const t = this._duelMap.get(pawn.id);
                if (t && !t.isBodyDead?.()) return true;
            }
        }
        for (const row of uncontrolled || []) {
            const c = row.creature;
            if (!c) continue;
            if (c._resting || c._downed || c.isIncapacitated?.() || c.isImmobile?.()) continue;
            if (c.isAttacking?.()) return true;
            const t = c.ai?.assistTarget;
            if (t && t.active !== false && !t.isBodyDead?.()) return true;
        }
        return false;
    },

    _pickPartyAutoEat(eater, members, control) {
        return Party.pickAutoEat(eater, members, {
            tileSize: TS,
            allowPoison: Party.isStarving(eater),
            skipPawnId: control?.id || null,
            skipHeld: control ? { id: control.id, slot: control.hotbarIndex ?? 0 } : null,
            getItem: (id) => itemDefs().get(id),
            getFood: (stack) => this._foodForEat(stack)
        });
    },

    _pawnHasBandage(m, skipHeld = null) {
        if (!m) return null;
        const bags = [
            { bag: "hotbar", slots: m.inventory || [], source: m, at: m },
            { bag: "overflow", slots: m.overflow || [], source: m, at: m }
        ];
        return BodyHealing.pickBestBandage(bags, (id) => itemDefs().get(id), (bag, i) => {
            if (!skipHeld) return false;
            return m.id === skipHeld.id && bag.bag === "hotbar" && i === skipHeld.slot;
        });
    },

    _partyNeedsAutoTend(session) {
        const members = this._ownedPawns(session).filter((m) => m && !m.dead);
        if (!members.some((m) => this._pawnHasBandage(m))) return false;
        for (const m of members) {
            const c = m.creature || this.creatures.get(m.id);
            if (c?.anatomy && BodyHealing.pickTendTarget?.(c.anatomy)) return true;
        }
        return false;
    },

    _pawnIsLyingDown(rec) {
        if (!rec || rec.dead) return false;
        if (rec._resting) return true;
        const c = rec.creature || this.creatures.get(rec.id);
        return !!(rec.prone || c?._downed || c?._prone || c?._resting || c?.isIncapacitated?.());
    },

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
        if (pawn.eatChannel || c?.ai?.eatSeek) return true;
        const below = Party.AUTO_EAT_BELOW || 1000;
        const kc = Number(pawn.kc) || 0;
        const mal = !!anatomy?.hediff?.("malnutrition");
        const sitting = pawn._eatSitting;
        const stillHungry = sitting ? kc < sitting.until : (mal || kc < below);
        if (stillHungry && this._pickPartyAutoEat(pawn, members, control)) return true;
        return false;
    },

    /** Stand a resting companion so they can eat, then `_wokeFromRest` sends them back. */
    _wakeRestingHungry(session, rec, members, control) {
        if (!session || !rec || rec.dead) return false;
        const c = rec.creature || this.creatures.get(rec.id);
        if (!c || c.isIncapacitated?.() || c.isImmobile?.() || c.isVomiting?.()) return false;
        c.refreshCapacities?.();
        if (!c.capacities?.canManipulate?.()) return false;
        const below = Party.AUTO_EAT_BELOW || 1000;
        const kc = Number(rec.kc) || 0;
        const mal = !!c.anatomy?.hediff?.("malnutrition");
        const sitting = rec._eatSitting;
        if (!sitting && !mal && kc >= below) return false;
        if (sitting && kc >= sitting.until) return false;
        if (!this._pickPartyAutoEat(rec, members, control)) return false;
        if (rec._resting) this._wakePawn(session, rec, { help: true });
        else if (rec._restWalk) {
            rec._restWalk = null;
            rec._wokeFromRest = true;
            c._restWalk = null;
            c._wokeFromRest = true;
        }
        return true;
    },

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
    },

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
            if (this._partyTendBusy(p, members, tender)) continue;
            const target = BodyHealing.pickTendTarget(anatomy);
            if (!target) continue;
            const skipFor = (patient) => {
                if (control && patient && (patient.id === control.id || patient === control)) return null;
                return skipHeld;
            };
            const bleeding = !!(target.inj?.bleeding || target.destroyed);
            if (p === tender || p.id === tender.id) {
                const bandage = this._pawnHasBandage(tender, skipFor(p));
                if (bandage) selfJob = { patient: p, bleeding, inRange: true, ...bandage, target };
                continue;
            }
            const dist = Math.hypot((Number(p.x) || 0) - (Number(tender.x) || 0),
                (Number(p.y) || 0) - (Number(tender.y) || 0));
            if (dist > seek) continue;
            const skip = skipFor(p);
            const a = this._pawnHasBandage(tender, skip);
            const b = this._pawnHasBandage(p, skip);
            const score = (pick) => pick
                ? BodyHealing.bandageScore(itemDefs().get(pick.stack?.id))
                : -1;
            const bandage = score(a) >= score(b) ? a : b;
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
    },

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
            if (Party.beyondFollowLeash(rec, control, TS)) {
                if (cc.ai) cc.ai.tendSeek = null;
                continue;
            }
            cc.x = rec.x;
            cc.y = rec.y;
            this._bindPartyAI(cc);
            if (rec.tendChannel) {
                cc.ai.tendSeek = null;
                cc._tending = true;
                rec.tending = true;
                continue;
            }
            if (
                combat
                || rec.eatChannel
                || rec.dead
                || this._pawnVomiting(rec)
            ) {
                cc.ai.tendSeek = null;
                continue;
            }
            cc.refreshCapacities?.();
            if (cc.isIncapacitated?.() || !cc.capacities?.canManipulate?.() || cc.isAttacking?.()) {
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
            if (!pick?.patient) {
                cc.ai.tendSeek = null;
                continue;
            }
            const to = pick.patient;
            const self = to === rec || to.id === rec.id;
            if (self || pick.inRange) {
                cc.ai.tendSeek = null;
                this._beginPawnTend(rec, pick);
                continue;
            }
            const toC = to.creature || this.creatures.get(to.id);
            if (toC) {
                toC.x = to.x;
                toC.y = to.y;
            }
            cc.ai.tendSeek = toC || to;
        }
    },

    _assignPartyEatSeeks(session, uncontrolled, controlId) {
        const members = [];
        if (!session.dead) members.push(session);
        for (const m of session.party || []) {
            if (!m.dead) members.push(m);
        }
        const control = members.find((m) => m.id === controlId) || session;
        const combat = this._sessionPartyCombat(session, uncontrolled);
        const below = Party.AUTO_EAT_BELOW || 1000;
        for (const row of uncontrolled || []) {
            const rec = row.rec;
            const cc = row.creature;
            if (!cc) continue;
            if (Party.beyondFollowLeash(rec, control, TS)) {
                if (cc.ai) cc.ai.eatSeek = null;
                continue;
            }
            cc.x = rec.x;
            cc.y = rec.y;
            this._bindPartyAI(cc);
            if (rec.eatChannel) {
                cc.ai.eatSeek = null;
                continue;
            }
            if (
                combat
                || rec.dead
                || this._pawnVomiting(rec)
                || rec.tendChannel
                || cc.ai.tendSeek
            ) {
                cc.ai.eatSeek = null;
                continue;
            }
            if (rec._resting || rec._restWalk) {
                if (!this._wakeRestingHungry(session, rec, members, control)) {
                    cc.ai.eatSeek = null;
                    continue;
                }
            }
            const kc = Number(rec.kc) || 0;
            const sitting = rec._eatSitting;
            if (sitting && kc >= sitting.until) {
                rec._eatSitting = null;
                cc.ai.eatSeek = null;
                continue;
            }
            if (!sitting && kc >= below) {
                cc.ai.eatSeek = null;
                continue;
            }
            const pick = this._pickPartyAutoEat(rec, members, control);
            if (!pick) {
                rec._eatSitting = null;
                cc.ai.eatSeek = null;
                continue;
            }
            if (pick.poison && sitting?.poisonStop) {
                cc.ai.eatSeek = null;
                continue;
            }
            if (pick.inRange) {
                cc.ai.eatSeek = null;
                this._beginPawnEat(rec, pick);
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
    },

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
            for (const row of rows) {
                row.creature._tending = !!row.rec.tendChannel;
                row.creature._eatChannel = row.rec.eatChannel || null;
                row.creature._tendChannel = row.rec.tendChannel || null;
                row.creature._beingTended = false;
            }
            for (const row of rows) {
                const pid = row.rec.tendChannel?.patientId;
                if (!pid || pid === row.rec.id) continue;
                const hit = rows.find((r) => r.rec.id === pid);
                if (hit?.creature) hit.creature._beingTended = true;
            }
            const controlRec = rows.find((row) => row.rec.id === controlId)?.rec || p;
            for (const row of uncontrolled) {
                const cc = row.creature;
                const rec = row.rec;
                cc.x = rec.x;
                cc.y = rec.y;
                cc.facing = rec.facing || cc.facing;
                cc._restWalk = rec._restWalk || null;
                cc._resting = !!rec._resting;
                cc._wokeFromRest = !!rec._wokeFromRest;
                this._sharePawnGear(rec, cc);
                cc.hotbarIndex = rec.hotbarIndex ?? 0;
                cc.kc = rec.kc;
                cc.ownerId = p.id;
                cc.role = rec.role === "settler" ? "companion" : (rec.role || "companion");
                cc.homeSettlementId = rec.homeSettlementId || null;
                this._bindPartyAI(cc);
                if (Party.beyondFollowLeash(rec, controlRec, TS)) {
                    cc.setDesiredVel?.(0, 0);
                    cc.vx = 0;
                    cc.vy = 0;
                    rec.vx = 0;
                    rec.vy = 0;
                    rec.sprint = false;
                    continue;
                }
                this._ejectOverlappingPose(rec, cc);
                const wasSwinging = !!cc.isAttacking?.();
                cc.refreshCapacities?.();
                cc.ai.update(dtMs, world);
                rec.hotbarIndex = cc.hotbarIndex ?? rec.hotbarIndex;
                cc.applyDesiredVel(dtMs);
                const ox = rec.x;
                const oy = rec.y;
                const nx = cc.x + (cc.vx || 0) * dt;
                const ny = cc.y + (cc.vy || 0) * dt;
                if (!this._partyPoseBlocked(cc, nx, cc.y, 0, { load: false, sleepFootprint: false })) {
                    cc.x = nx;
                }
                if (!this._partyPoseBlocked(cc, cc.x, ny, 0, { load: false, sleepFootprint: false })) {
                    cc.y = ny;
                }
                rec.x = cc.x;
                rec.y = cc.y;
                this._maybeEjectIdleOverlap(rec, cc);
                rec.vx = cc.vx || 0;
                rec.vy = cc.vy || 0;
                rec.sprint = !!cc.isSprinting;
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
                if (!wasSwinging && cc.isAttacking?.() && !cc._prone) {
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
    },

    _tickSettlerAI(dtMs, world) {
        const scale = this._settlerTimeScale();
        const sdtMs = dtMs * scale;
        const dt = sdtMs / 1000;
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
            this._sharePawnGear(rec, cc);
            cc.kc = rec.kc;
            cc._eatChannel = rec.eatChannel || null;
            cc._tendChannel = rec.tendChannel || null;
            cc._tending = !!rec.tendChannel;
            cc.homeSettlementId = rec.homeSettlementId;
            cc.role = "settler";
            cc._chopIgnoreUid = rec._chopIgnoreUid || null;
            cc._pathIgnoreUid = rec._pathIgnoreUid || null;
            this._bindPartyAI(cc);
            cc.refreshCapacities?.();
            if (!(scale > 0)) {
                cc.setDesiredVel?.(0, 0);
                cc.vx = 0;
                cc.vy = 0;
                rec.vx = 0;
                rec.vy = 0;
                continue;
            }
            const wasSwinging = !!cc.isAttacking?.();
            cc.ai.update(sdtMs, world);
            cc._chopIgnoreUid = rec._chopIgnoreUid || null;
            cc._pathIgnoreUid = rec._pathIgnoreUid || null;
            if (!wasSwinging && cc.isAttacking?.() && !cc._prone) {
                this.pushEvent({
                    kind: "attack",
                    playerId: rec.ownerId || rec.id,
                    pawnId: rec.id,
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
            if (cc._settlerAct) rec._settlerAct = cc._settlerAct;
            cc.applyDesiredVel(sdtMs);
            const ox = cc.x;
            const oy = cc.y;
            const nx = cc.x + (cc.vx || 0) * dt;
            const ny = cc.y + (cc.vy || 0) * dt;
            if (!this._partyPoseBlocked(cc, nx, cc.y)) cc.x = nx;
            if (!this._partyPoseBlocked(cc, cc.x, ny)) cc.y = ny;
            rec.x = cc.x;
            rec.y = cc.y;
            this._maybeEjectIdleOverlap(rec, cc);
            rec.vx = cc.vx || 0;
            rec.vy = cc.vy || 0;
            rec.facing = cc.facing || rec.facing;
            rec.attackTimer = cc.attackTimer;
            rec.attackAngle = cc.attackAngle;
            rec.attackArt = cc.attackArt;
            rec.attackMax = cc.attackMax;
            if (
                !rec._chopIgnoreUid
                && Math.hypot(rec.x - ox, rec.y - oy) < 0.2
                && (Math.abs(cc.vx) > 4 || Math.abs(cc.vy) > 4)
            ) {
                const clipped = !rec._workChannel && !rec._paintChannel
                    && this._partyPoseBlocked(cc, cc.x, cc.y, 0, {
                        load: false, sleepFootprint: false, sleepNav: false
                    });
                if (clipped) {
                    this._ejectOverlappingPose(rec, cc);
                } else if (this._escapeOverlappingThing(rec)) {
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
    },

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
            if (!this._inSimRange(mob.x, mob.y)) continue;
            liveMobs.push(mob);
        }

        const meleeTargets = [...playerCreatures, ...liveMobs];
        const mobScale = this._mobTimeScale();
        const mobDtMs = dtMs * mobScale;
        const mobDt = dt * mobScale;

        this._rebuildDuelAssignments();
        this._claimDuelAggro();
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
            wc.refreshCapacities?.();
            wc.tickMelee(mobDtMs, meleeTargets);
            w.prone = this._creatureIsProne(wc);
            if (w.prone) {
                wc.vx = 0;
                wc.vy = 0;
                wc.setDesiredVel?.(0, 0);
                wc.facing = "right";
                w.facing = "right";
                w._moved = false;
            } else {
                w.facing = wc.facing || w.facing;
            }
            w.attackTimer = wc.attackTimer;
            w.attackMax = wc.attackMax;
            w.attackAngle = wc.attackAngle;
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
            sc.tickMelee(this._settlerDtMs(dtMs), meleeTargets);
            rec.prone = this._creatureIsProne(sc);
            if (rec.prone) {
                sc.facing = "right";
                rec.facing = "right";
            } else {
                rec.facing = sc.facing || rec.facing;
            }
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
            if (!(mobScale > 0)) {
                mob.setDesiredVel?.(0, 0);
                mob.vx = 0;
                mob.vy = 0;
                if (mob.entry) {
                    mob.entry.x = mob.x;
                    mob.entry.y = mob.y;
                    mob.entry.facing = mob.facing;
                }
                continue;
            }
            const nearest = aiWorld.getDuelTarget(mob) || aiWorld.getNearestPlayer(mob);
            mob.ctx.player = nearest || null;
            mob.refreshCapacities?.();
            const wasSwinging = !!mob.isAttacking?.();
            mob.ai?.update?.(mobDtMs, aiWorld);
            if (!wasSwinging && mob.isAttacking?.() && !mob._prone) {
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
    },
    };
});
