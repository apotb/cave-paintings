/**
 * SimWorld prototype methods (commands).
 * Installed onto SimWorld.prototype. Method bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SimWorldMixins = root.SimWorldMixins || {};
        root.SimWorldMixins.commands = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    "use strict";
    const {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    } = ctx;
    return {

    setMove(playerId, { x = 0, y = 0, sprint = false, facing = null, px = null, py = null, viewChunks = null, pawnId = null, partyPoses = null } = {}) {
        const p = this.players.get(playerId);
        if (!p) return;
        this._setControlId(p, pawnId);
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
            p.sprint = !!sprint && (Number(control.kc) > 0) && !this._pawnCannotSprint(control);
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
            m.tending = tendLock.has(m.id) || !!m.tendChannel;
            const cc = m.creature || this.creatures.get(m.id);
            if (cc) cc._tending = !!m.tending;
        }
        if (p.creature) p.creature._tending = false;
        if (Number.isFinite(viewChunks)) {
            const v = Math.floor(Number(viewChunks));
            if (v >= 1 && v <= 24) p.viewChunks = v;
        }
    },

    /** Chunk Chebyshev radius to generate/stream around a player. */
    interestRadius(p = null) {
        const floor = INTEREST;
        const view = p?.viewChunks != null ? Math.floor(Number(p.viewChunks)) : floor;
        // +1 so edges stay filled while moving between snapshot syncs
        return Math.max(floor, Math.min(24, view + 1));
    },

    _chunkChebyshev(ax, ay, bx, by) {
        const a = worldToChunk(ax, ay);
        const b = worldToChunk(bx, by);
        if (!Number.isFinite(a.cx) || !Number.isFinite(b.cx)) return Infinity;
        return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy));
    },

    /**
     * Stream and generate around the controlled pawn, plus a 1-chunk pad
     * around nearby party members so their ground stays filled. Far members
     * wait in place and do not keep a second neighborhood.
     */
    _loadPlayerInterest(p) {
        if (!p) return;
        const control = this._actionPawn(p, { pawnId: p.controlId || p.id }) || p;
        if (!Number.isFinite(control.x) || !Number.isFinite(control.y)) return;
        this._interestLoad(control.x, control.y, this.interestRadius(p));
        const padNear = (wx, wy) => {
            if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
            if (Party.beyondFollowLeash({ x: wx, y: wy }, control, TS)) return;
            this._interestLoad(wx, wy, 1);
        };
        padNear(p.x, p.y);
        for (const m of p.party || []) padNear(m.x, m.y);
    },

    /** True if (wx, wy) is within SIM_CHUNKS of a connected player's control pawn. */
    _inSimRange(wx, wy, radius = SIM_CHUNKS) {
        const r = Math.max(1, Math.floor(Number(radius) || SIM_CHUNKS));
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            const control = this._actionPawn(p, { pawnId: p.controlId || p.id }) || p;
            if (this._chunkChebyshev(wx, wy, control.x, control.y) <= r) return true;
        }
        return false;
    },

    /** Chunks around every connected control pawn. Spoil/fires use absolute
     *  world minutes, so far map can wait until you walk back. */
    _simChunks() {
        const list = [];
        const seen = new Set();
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            const control = this._actionPawn(p, { pawnId: p.controlId || p.id }) || p;
            const { cx, cy } = worldToChunk(control.x, control.y);
            for (let dx = -SIM_CHUNKS; dx <= SIM_CHUNKS; dx++) {
                for (let dy = -SIM_CHUNKS; dy <= SIM_CHUNKS; dy++) {
                    const key = chunkKey(cx + dx, cy + dy);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const c = this.chunks.get(key);
                    if (c) list.push(c);
                }
            }
        }
        return list;
    },

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
            if (this._setControlId(p, action.pawnId, { allowDead: true })) {
                this._loadPlayerInterest(p);
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
        if (type === Protocol.Actions.FORM) {
            this._tryForm(p, action);
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
            return;
        }
        _actionsApi()?.dispatch?.(this, p, action);
    },

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
            this.announceCmd("Fully healed", { to: p.id });
            return;
        }
        if (cmd === "/wanderer") {
            const n = this._spawnWandererNear(p) || 0;
            if (n > 0) {
                this._setDirectorCd(p.id, Party.directorCooldown((p.party?.length || 0) + 1, () => this.rng()));
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
        if (cmd === "/kill" || cmd === "/kms") {
            this._kill(p, null);
            this.announceCmd(`${p.name} used ${cmd}`, { except: p.id });
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
            const usage = "Usage: /set <thing>/null";
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
    },

    _playerTile(p) {
        return {
            tx: Math.floor((Number(p.x) + TS / 2) / TS),
            ty: Math.floor(Number(p.y) / TS)
        };
    },

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
        const custom = _kindsApi()?.applyInitEntry?.(def, x, y);
        if (custom) return custom;
        return { lootable: false, entry: { id: def.id, x, y } };
    },

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
    },

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
    },

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
            this.persist?.clearPlayers?.();
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
    },

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
    },

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
    },

    /** Strip world-drop fields (uid, lifeMs, Arcade weight) so they can't zero item mass. */
    _giveExtras(extras) {
        if (!extras || typeof extras !== "object") return null;
        if (extras.uid || extras.lifeMs != null || extras.x != null || extras.y != null) {
            return this._stackExtrasFrom(extras);
        }
        return this._stackExtrasFrom(extras) || extras;
    },

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
    },

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
                requireTool = Carry.parseRequireTool
                    ? Carry.parseRequireTool(v)
                    : {
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
    },

    _stackMatchesCraft(s, match) {
        if (!s || !match) return false;
        if (match.hideStage) {
            return Hide.stackIsHideStage(s, match.hideStage, (id) => itemDefs().get(id));
        }
        if (!s.id || s.id !== match.id) return false;
        if (match.toolClass && s.toolClass !== match.toolClass) return false;
        return true;
    },

    _countMatchingInSlots(slots, match) {
        const hideStage = match?.hideStage || null;
        const id = match?.id;
        const wantClass = match?.toolClass || null;
        if ((!hideStage && !id) || !Array.isArray(slots)) return 0;
        let sum = 0;
        for (const s of slots) {
            if (!this._stackMatchesCraft(s, hideStage ? { hideStage } : { id, toolClass: wantClass })) continue;
            sum += Math.max(0, Math.floor(Number(s.quantity) || 0));
        }
        return sum;
    },

    _countMatchingItems(p, match, extraSlots) {
        return this._countMatchingInSlots(p?.inventory, match)
            + this._countMatchingInSlots(extraSlots, match);
    },

    _loseMatchingFromSlots(slots, match) {
        let remaining = Math.max(0, Math.floor(Number(match?.qty) || 1));
        const hideStage = match?.hideStage || null;
        const id = match?.id;
        const wantClass = match?.toolClass || null;
        if ((!hideStage && !id) || !(remaining > 0) || !Array.isArray(slots)) {
            return { lost: 0, knapQuality: null };
        }
        let lost = 0;
        let knapQuality = null;
        const takeFrom = (requireClass) => {
            for (let i = 0; i < slots.length && remaining > 0; i++) {
                const s = slots[i];
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
                if (!(s.quantity > 0)) slots[i] = null;
            }
        };
        if (hideStage) takeFrom(null);
        else if (wantClass) takeFrom(wantClass);
        else takeFrom(null);
        return { lost, knapQuality };
    },

    _loseMatchingItems(p, match, extraSlots) {
        const fromInv = this._loseMatchingFromSlots(p?.inventory, match);
        const qty = Math.max(0, Math.floor(Number(match?.qty) || 1));
        const left = Math.max(0, qty - fromInv.lost);
        let fromStorage = false;
        let knapQuality = fromInv.knapQuality;
        let lost = fromInv.lost;
        if (left > 0 && extraSlots) {
            const rest = this._loseMatchingFromSlots(extraSlots, { ...match, qty: left });
            lost += rest.lost;
            fromStorage = rest.lost > 0;
            if (knapQuality == null) knapQuality = rest.knapQuality;
        }
        return { lost, knapQuality, fromStorage };
    },

    _craftStorageFromAction(p, action = {}) {
        const uid = action.storageUid != null && action.storageUid !== ""
            ? String(action.storageUid)
            : null;
        if (!p || !uid) return null;
        const found = this._findPlayerStorage(p, { uid });
        if (!found) return null;
        if (!this._isStorageEntry(found.entry) || this._isCraftStationEntry(found.entry)) return null;
        return found;
    },

    _hasNearbyThing(p, thingId) {
        if (!p || !thingId) return false;
        const range2 = (TS * HARVEST_RANGE_TILES) * (TS * HARVEST_RANGE_TILES);
        for (const c of this._chunksNear(p.x, p.y, 1)) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!t || !Place.countsAsThing(t.id, thingId)) continue;
                const dx = t.x - p.x;
                const dy = t.y - p.y;
                if (dx * dx + dy * dy <= range2) return true;
            }
        }
        return false;
    },

    _tryCraft(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const id = String(action.id || "").slice(0, 64);
        const recipe = this._parseRecipe(id);
        if (!recipe) return;
        const R = _research();
        if (R?.recipeUnlocked) {
            const holder = this._researchHolder(p.ownerId || session.id);
            if (!R.recipeUnlocked(id, holder)) return;
        }
        const store = this._craftStorageFromAction(p, action);
        const extra = store?.entry?.slots || null;
        for (const ing of recipe.ingredients) {
            if (this._countMatchingItems(p, ing, extra) < ing.qty) return;
        }
        if (recipe.requireThing && !this._hasNearbyThing(p, recipe.requireThing)) return;
        if (recipe.requireStation && !this._hasNearbyThing(p, recipe.requireStation)) return;
        if (Carry.recipeToolClasses?.(recipe.requireTool)?.length) {
            const held = this._held(p);
            const def = held ? itemDefs().get(held.id) : null;
            if (!Carry.heldMatchesRecipeTool(held, def, recipe.requireTool)) return;
        }

        let tipQuality = null;
        let storageDirty = false;
        for (const ing of recipe.ingredients) {
            const { knapQuality, fromStorage } = this._loseMatchingItems(p, ing, extra);
            if (ing.toolClass === "spear_tip" && knapQuality) tipQuality = knapQuality;
            if (fromStorage) storageDirty = true;
        }
        if (storageDirty && store) this._emitStorage(store.chunk, store.entry);

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
    },

    _held(p) {
        if (!p?.inventory) return null;
        return p.inventory[p.hotbarIndex] || null;
    },

    _consumeCraftTool(p, recipe) {
        if (!(Carry.recipeToolClasses?.(recipe.requireTool)?.length)) return;
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
    },

    _wearPlayerHeld(creatureId, amount) {
        const pawn = this._findOwnedPawn(creatureId);
        if (!pawn) return { broke: false };
        return this._wearHeld(pawn, amount);
    },

    _wearHeld(p, amount) {
        if (!p || !Array.isArray(p.inventory)) return { broke: false };
        const result = Durability.wearInventorySlot(
            p.inventory,
            p.hotbarIndex | 0,
            amount,
            (id) => itemDefs().get(id)
        );
        if (result.leftover) this._insertUniqueStack(p, result.leftover);
        if (result.broke) this._pushToolBroke(p, result.name);
        this._dirtyPawnOwner(p);
        return result;
    },

    _pushToolBroke(p, name) {
        const to = this._sessionOfPawn(p)?.id || p.id;
        const you = this._isViewerActingPawn(p, to);
        const settler = this._isViewerSettler(p, to);
        const actorName = (typeof p.displayName === "function" ? p.displayName() : null)
            || p.name || p.pawnName || "Someone";
        const chat = Durability.breakChat(name, {
            you,
            actorName: you ? null : actorName,
            actorColor: settler
                ? (Party.COLOR_SETTLER || "#7ec8ff")
                : (Party.COLOR_ALLY || "#80e080"),
            weaponColor: "#f0a040"
        });
        this.pushEvent({
            kind: "combat_log",
            text: chat.text,
            segments: chat.segments,
            to
        });
    },

    _pickPlayerAttack(creature, angle) {
        if (!creature) return null;
        const held = creature.getHeldItem?.();
        const getItem = (id) => itemDefs().get(id);
        const DigApi = _dig();
        if (DigApi?.isDigger?.(held, getItem) && this._pawnHasDigging(creature)) {
            const dig = DigApi.pickDigFromAttacks(BodyCombat.collectAttacks(creature));
            if (dig && this._aimHitsDiggable(creature, angle)) return dig;
        }
        if (Chop.chopFraction(held) > 0) {
            const chop = Chop.pickChopFromAttacks(BodyCombat.collectAttacks(creature));
            if (chop && this._aimHitsChoppable(creature, angle)) return chop;
        }
        return BodyCombat.pickAttack(creature);
    },

    _pawnHasDigging(creature) {
        const R = _research();
        if (!R?.hasTech || !creature) return false;
        const holder = this._researchHolder(creature.ownerId || creature.id);
        return !!(holder && R.hasTech(holder, "digging"));
    },

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
    },

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
                    if (!Chop.stillChoppable(def, e)) continue;
                    const dx = (Number(e.x) || 0) - wx;
                    const dy = (Number(e.y) || 0) - wy;
                    if (dx * dx + dy * dy > r2) continue;
                    fn(e, def, c, name);
                }
            }
        }
    },

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
            lastChopAt: result.felled ? null : (best.lastChopAt || Date.now()),
            felled: !!result.felled,
            list: bestList === "lootable" ? "lootable" : "things"
        });
    },

    _aimHitsDiggable(creature, angle) {
        const DigApi = _dig();
        if (!creature || !DigApi) return false;
        const c = creature.bodyCenter?.() || { x: creature.x, y: creature.y };
        const seg = DigApi.aimSegment(c.x, c.y, angle, DigApi.AIM_REACH);
        let hit = false;
        this._eachNearbyDiggable(creature.x, creature.y, (e) => {
            if (hit) return;
            if (DigApi.trunkHitsSegment(seg, e.x, e.y, DigApi.HITBOX, DigApi.HIT_RADIUS)) hit = true;
        });
        return hit;
    },

    _eachNearbyDiggable(wx, wy, fn) {
        const DigApi = _dig();
        if (!DigApi) return;
        const range = (DigApi.AIM_REACH || 20) + 16;
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
                    if (!DigApi.stillDiggable(def, e)) continue;
                    const dx = (Number(e.x) || 0) - wx;
                    const dy = (Number(e.y) || 0) - wy;
                    if (dx * dx + dy * dy > r2) continue;
                    fn(e, def, c, name);
                }
            }
        }
    },

    _removeThingEntry(chunk, entry) {
        if (!chunk || !entry) return;
        entry.gone = true;
        for (const name of ["things", "lootableThings"]) {
            const i = (chunk[name] || []).indexOf(entry);
            if (i >= 0) chunk[name].splice(i, 1);
        }
    },

    _tryDigFromMelee(creature, swingSeg) {
        if (!creature || creature.kind !== "player") return;
        if (creature._attackDugPatch) return;
        const DigApi = _dig();
        if (!DigApi?.isDigAttack?.(creature.currentAttack)) return;
        if (!this._pawnHasDigging(creature)) return;
        const held = creature.getHeldItem?.();
        const getItem = (id) => itemDefs().get(id);
        const frac = DigApi.digFraction(held, getItem);
        if (!(frac > 0)) return;
        const c = creature.bodyCenter?.() || { x: creature.x, y: creature.y };
        const digSeg = DigApi.aimSegment(c.x, c.y, creature.attackAngle, DigApi.AIM_REACH);
        let best = null;
        let bestDef = null;
        let bestChunk = null;
        let bestD = Infinity;
        this._eachNearbyDiggable(creature.x, creature.y, (e, def, chunk) => {
            if (creature.attackHitSet?.has(e)) return;
            const hit = DigApi.trunkHitsSegment(digSeg, e.x, e.y, DigApi.HITBOX, DigApi.HIT_RADIUS)
                || (swingSeg && DigApi.trunkHitsSegment(swingSeg, e.x, e.y, DigApi.HITBOX, DigApi.HIT_RADIUS));
            if (!hit) return;
            const dx = e.x - creature.x;
            const dy = e.y - creature.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
                best = e;
                bestDef = def;
                bestChunk = chunk;
                bestD = d;
            }
        });
        if (!best || !bestChunk) return;
        if (!creature.attackHitSet) creature.attackHitSet = new Set();
        creature.attackHitSet.add(best);
        creature._attackDugPatch = true;
        const result = DigApi.applyDig(best, bestDef, frac);
        if (!creature._attackWoreHeld) {
            this._wearPlayerHeld(creature.id, 1);
            creature._attackWoreHeld = true;
        }
        const itemId = bestDef?.diggable?.item;
        if (itemId && result.give > 0) {
            this._pushDrop(best.x, best.y, { id: itemId, quantity: result.give });
        }
        if (result.done) {
            const drops = DigApi.rollDrops?.(bestDef, () => this.rng()) || [];
            const piles = DigApi.scatterDrops?.(drops, best.x, best.y, () => this.rng())
                || Chop.scatterFellPiles?.(drops, best.x, best.y, () => this.rng())
                || [];
            for (const p of piles) {
                this._pushDrop(p.x, p.y, { id: p.id, quantity: p.quantity }, { noMerge: true });
            }
            this._removeThingEntry(bestChunk, best);
        }
        this.pushEvent({
            kind: "dig",
            playerId: creature.id,
            cx: bestChunk.cx,
            cy: bestChunk.cy,
            x: best.x,
            y: best.y,
            uid: best.uid || null,
            id: best.id,
            digProgress: result.done ? 1 : result.progress,
            digTaken: best.digTaken || 0,
            lastDigAt: best.lastDigAt || Date.now(),
            give: result.give,
            dug: !!result.done
        });
    },

    _stackIsSpecial(s) {
        return !!(s && (
            s.customName || s.food || s.ingredients?.length || s.toolClass
            || s.knapIconData || s.knapDamage != null || s.knapQuality
            || s.durability != null
            || s.formClass || s.formVoxels
        ));
    },

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
        if (src.knapIconData) {
            const icon = this._sanitizeKnapIconData(src.knapIconData);
            if (icon) out.knapIconData = icon;
        }
        if (src.formClass) {
            const Forming = _forming();
            out.formClass = Forming ? Forming.sanitizeClass(src.formClass) : src.formClass;
        }
        if (src.formVoxels) {
            const pack = _forming()?.sanitizePack(src.formVoxels);
            if (pack) out.formVoxels = pack;
        }
        if (src.formStartMass != null) {
            const n = Math.floor(Number(src.formStartMass));
            if (Number.isFinite(n) && n > 0) {
                const Forming = _forming();
                const min = Forming?.MIN_MASS || 12;
                out.formStartMass = Math.min(4096, Math.max(min, n));
            }
        }
        if (src.beauty != null) {
            const b = Number(src.beauty);
            if (Number.isFinite(b)) out.beauty = b;
        }
        if (src.formCustom) out.formCustom = true;
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
    },

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
        if (extras.formClass) slot.formClass = extras.formClass;
        if (extras.formVoxels) slot.formVoxels = extras.formVoxels;
        if (extras.formStartMass != null) slot.formStartMass = extras.formStartMass;
        if (extras.beauty != null) {
            const b = Number(extras.beauty);
            if (Number.isFinite(b)) slot.beauty = b;
        }
        if (extras.formCustom) slot.formCustom = true;
        else delete slot.formCustom;
        if (extras.weight != null) {
            const w = Number(extras.weight);
            if (Number.isFinite(w) && w > 0) slot.weight = w;
        }
        if (extras.spoilLeft != null) slot.spoilLeft = extras.spoilLeft;
        if (extras.spoilAt != null) slot.spoilAt = extras.spoilAt;
        if (extras.durability != null) slot.durability = extras.durability;
        if (extras.dryProgress != null) slot.dryProgress = extras.dryProgress;
        if (extras.soakProgress != null) slot.soakProgress = extras.soakProgress;
        if (extras.soakDoneAt != null) slot.soakDoneAt = extras.soakDoneAt;
        if (extras.temp != null) Fire.applyStackTemp(slot, extras.temp);
        return slot;
    },

    /** Snapshot/public wire shape for a ground drop (includes tip quality, knap fields). */
    _publicDrop(d, c) {
        if (!d) return null;
        Hide.migrateStackItemId(d);
        if (!d.uid) d.uid = uuid();
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
    },

    _sanitizeKnapIconData(raw) {
        if (typeof raw !== "string") return null;
        if (raw.length < 8 || raw.length > 4096) return null;
        return raw;
    },

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
    },

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
    },

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
    },

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
    },

    _sanitizeFormStack(raw, startMass, idolatry, prev = null) {
        const Forming = _forming();
        if (!Forming || !raw || typeof raw !== "object") return null;
        const pack = Forming.sanitizePack(raw.formVoxels);
        if (!pack) return null;
        const grid = Forming.unpack(pack);
        if (!grid) return null;
        const fail = Forming.shatterCheck(grid);
        if (fail.shattered) return null;
        const result = Forming.classify(grid, { idolatry: !!idolatry });
        const stack = Forming.makeStack(result.formClass, grid, startMass);
        return Forming.applyFinishName(stack, {
            prev,
            pendingName: raw.customName,
            pendingCustom: raw.formCustom
        });
    },

    _tryForm(session, action = {}) {
        const Forming = _forming();
        if (!Forming) return;
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const op = String(action.op || "");
        const slot = Math.floor(Number(action.slot));
        const inv = p.inventory;
        if (!Array.isArray(inv)) return;

        if (op === "consume") {
            if (p._formSession) return;
            if (!Number.isInteger(slot) || slot < 0 || slot >= inv.length) return;
            const held = inv[slot];
            if (!held || !(held.quantity > 0)) return;
            const R = _research();
            const holder = this._researchHolder(p.ownerId || session.id);
            if (R?.techUnlocked && !R.techUnlocked("clay_forming", holder)) return;
            const wantId = action.id ? String(action.id) : held.id;
            if (held.id !== wantId) return;
            const reworkPack = held.id === "clay_figurine"
                ? Forming.sanitizePack(held.formVoxels)
                : null;
            const rework = !!reworkPack;
            if (!rework && held.id !== "clay") return;
            const original = rework ? this._cloneGearStack(held, 1) : null;
            held.quantity = (held.quantity || 1) - 1;
            if (held.quantity <= 0) inv[slot] = null;
            const startMass = Math.max(
                Forming.MIN_MASS,
                Math.min(4096, Math.floor(
                    Number(action.startMass) || Number(held.formStartMass) || Forming.MIN_MASS
                ))
            );
            p._formSession = { slot, startMass, rework, original };
            this._youDirty.add(p.id);
            return;
        }

        if (op === "addClay") {
            if (!p._formSession) return;
            if (!this._takeOneItem(p, "clay")) return;
            this._youDirty.add(p.id);
            return;
        }

        if (op === "abort") {
            const form = p._formSession;
            p._formSession = null;
            if (form?.rework && form.original) {
                this._insertUniqueStack(p, form.original, form.slot);
            }
            return;
        }

        if (op === "finish") {
            const form = p._formSession;
            if (!form) return;
            p._formSession = null;
            const R = _research();
            const holder = this._researchHolder(p.ownerId || session.id);
            const idolatry = !!(R?.techUnlocked && R.techUnlocked("idolatry", holder));
            const stack = this._sanitizeFormStack(action.stack, form.startMass, idolatry, form.original);
            if (!stack) return;
            this._insertUniqueStack(p, stack, form.slot);
        }
    },
    };
});
