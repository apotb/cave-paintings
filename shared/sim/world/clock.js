/**
 * SimWorld prototype methods (clock).
 * Installed onto SimWorld.prototype. Method bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SimWorldMixins = root.SimWorldMixins || {};
        root.SimWorldMixins.clock = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    "use strict";
    const {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    } = ctx;
    return {

    _pawnCannotSprint(pawn) {
        if (!pawn) return true;
        const getDef = (id) => itemDefs().get(id);
        const enc = Carry.encumbrance(
            Carry.gearMass(pawn.inventory, pawn.equipment, getDef, pawn.overflow),
            Carry.strengthFromEquip(pawn.equipment, getDef)
        );
        if (enc.cannotSprint) return true;
        const c = pawn.creature || this.creatures.get(pawn.id);
        const legs = c?.anatomy?.livingLegs?.();
        if (Number.isFinite(legs) && legs < 2) return true;
        return false;
    },

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
    },

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
            if (!this._inSimRange(mob.x, mob.y)) continue;
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
        const simChunks = this._simChunks();
        this._tickSoakDrops(simChunks);
        this._tickLootableRegrows(simChunks);
        this._tickCampfires(simChunks);
        this._tickDryingRacks(simChunks);
        this._tickWorldSpoil(simChunks);
        this._tickCorpseDecay(simChunks);
        if (Apparel.isDayBoundary(this.worldMinuteIndex())) {
            for (const p of this.players.values()) {
                if (!p.connected || p.dead) continue;
                this._tickApparelDailyWear(p);
                for (const mem of p.party || []) {
                    if (!mem.dead) this._tickApparelDailyWear(mem);
                }
            }
        }
    },

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
    },

    /** Corpse → carcass after 12h, carcass → gone after 30d. Runs for all chunks. */
    _tickCorpseDecay(chunks) {
        const now = this.worldMinuteIndex();
        const src = chunks || this.chunks.values();
        for (const c of src) {
            if (!Array.isArray(c.corpses) || !c.corpses.length) continue;
            for (let i = c.corpses.length - 1; i >= 0; i--) {
                const entry = c.corpses[i];
                if (!entry) continue;
                CorpseDecay.ensureDiedAt(entry, now);
                const next = CorpseDecay.stageFor(entry.diedAt, now);
                if (next === "gone") {
                    const id = entry.id;
                    if (!id || !this._eraseCorpse(id)) c.corpses.splice(i, 1);
                    // Erase can drop more than this slot. Rescan the chunk.
                    i = c.corpses.length;
                    continue;
                }
                if (next === "carcass" && entry.stage !== "carcass") {
                    this._convertCorpseToCarcass(entry, now);
                }
            }
        }
    },

    /** Respawn due world lootables (sticks, bushes, …). */
    _tickLootableRegrows(chunks) {
        const now = this.worldMinuteIndex();
        const src = chunks || this.chunks.values();
        for (const c of src) {
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
    },

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
    },

    _mobBeginIdle(mob) {
        mob.state = "idle";
        mob.dirX = 0;
        mob.dirY = 0;
        mob.vx = 0;
        mob.vy = 0;
        mob.timer = 1000 + this.rng() * 2000;
    },

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
    },

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
    },

    _weightedPick(items, weights) {
        let total = 0;
        for (const w of weights) total += w;
        let r = this.rng() * total;
        for (let i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
        }
        return items[items.length - 1];
    },

    /** Move mob along dirX/dirY at speed px/s; update facing/vx/vy. */
    _mobStep(mob, dt, speedPx) {
        if (this.isBlocked(mob.x, mob.y, { load: false, swim: true })) {
            for (let r = 4; r <= 48; r += 4) {
                let freed = false;
                for (let i = 0; i < 8; i++) {
                    const a = (i / 8) * Math.PI * 2;
                    const x = mob.x + Math.cos(a) * r;
                    const y = mob.y + Math.sin(a) * r;
                    if (this.isBlocked(x, y, { load: false, swim: true })) continue;
                    mob.x = x;
                    mob.y = y;
                    freed = true;
                    break;
                }
                if (freed) break;
            }
        }
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
    },

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
    },

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
            ? this._partyPoseBlocked(mob, x, y, 0, { load: false })
            : this.isBlocked(x, y, { load: false });
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
    },

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
    },

    /**
     * Ground loot despawn — same 15 real minutes as client DroppedItem.
     * Only ticks in chunks inside any connected player's interest radius
     * (server analogue of a loaded chunk).
     */
    _tickDropDespawn(dtMs) {
        if (!(dtMs > 0)) return;
        const loaded = new Set();
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            for (const c of this._viewChunks(p)) loaded.add(c);
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
    },

    _chunksNear(wx, wy, r, opts = {}) {
        let { cx, cy } = worldToChunk(wx, wy);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
            cx = 0;
            cy = 0;
        }
        const rad = Math.max(0, Math.floor(Number(r) || 0));
        const load = opts.load !== false;
        const out = [];
        for (let x = cx - rad; x <= cx + rad; x++) {
            for (let y = cy - rad; y <= cy + rad; y++) {
                const c = load ? this._ensureChunk(x, y) : this.chunks.get(chunkKey(x, y));
                if (c) out.push(c);
            }
        }
        return out;
    },

    _interestLoad(wx, wy, radius = INTEREST) {
        const { cx, cy } = worldToChunk(wx, wy);
        const r = Math.max(1, Math.floor(Number(radius) || INTEREST));
        for (let x = cx - r; x <= cx + r; x++) {
            for (let y = cy - r; y <= cy + r; y++) {
                this._ensureChunk(x, y);
            }
        }
    },

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
    },

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
    },

    /** Absolute in-game minute index — same formula as the client. */
    worldMinuteIndex() {
        return (Number(this.gameDay) || 1) * 1440 + (Number(this.gameMinutes) || 0);
    },

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
    },

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
    },

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
    },

    _spoilChunkContents(c, opts = {}) {
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
                    const isRack = Hide.isDryingRack(def, t);
                    let changed = false;
                    for (let i = 0; i < t.slots.length; i++) {
                        const stack = t.slots[i];
                        if (!stack) continue;
                        if (isRack && Hide.pausesRackSpoil(itemDefs().get(stack.id))) continue;
                        const beforeTemp = stack.temp;
                        const beforeId = stack.id;
                        if (isRack) {
                            Spoil.migrateToSpoilAt(
                                stack,
                                this.worldMinuteIndex(),
                                (id) => itemDefs().get(id)
                            );
                        }
                        if (Fire.tickStackTemp(stack)) changed = true;
                        this._spoilStackIfDue(stack);
                        if (stack.temp !== beforeTemp || stack.id !== beforeId) changed = true;
                    }
                    if (changed && opts.emit) this._emitStorage(c, t);
                }
            }
        }
    },

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
    },

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
    },

    /**
     * Chunk keys to stream to a session: the view around the control pawn,
     * plus a 1-chunk pad around nearby (not map-split) party members.
     */
    viewChunkKeys(p) {
        const keys = new Set();
        if (!p) return keys;
        const control = this._actionPawn(p, { pawnId: p.controlId || p.id }) || p;
        if (!Number.isFinite(control.x) || !Number.isFinite(control.y)) return keys;
        const add = (wx, wy, r) => {
            if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
            for (const k of this.interestChunkKeys(wx, wy, r)) keys.add(k);
        };
        add(control.x, control.y, this.interestRadius(p));
        const padNear = (wx, wy) => {
            if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
            if (Party.beyondFollowLeash({ x: wx, y: wy }, control, TS)) return;
            add(wx, wy, 1);
        };
        padNear(p.x, p.y);
        for (const m of p.party || []) padNear(m.x, m.y);
        return keys;
    },

    /** Existing chunks covered by viewChunkKeys (no worldgen). */
    _viewChunks(p) {
        const out = [];
        for (const key of this.viewChunkKeys(p)) {
            const c = this.chunks.get(key);
            if (c) out.push(c);
        }
        return out;
    },

    _poseMotion(rec, session = null) {
        if (rec?.dead || rec?.prone || rec?._resting || rec?.creature?._prone || rec?.creature?._resting) {
            return { vx: 0, vy: 0, moving: false };
        }
        const vx = Number(rec?.vx) || Number(rec?.creature?.vx) || 0;
        const vy = Number(rec?.vy) || Number(rec?.creature?.vy) || 0;
        // WASD lives on the session. Only the pawn currently under control
        // should count stick input — otherwise the idle leader walks in place
        // while you steer a companion.
        let stick = 0;
        if (session) {
            const controlId = session.controlId || session.id;
            if (rec && rec.id === controlId) {
                stick = Math.hypot(session.moveX || 0, session.moveY || 0);
            }
        } else {
            stick = Math.hypot(rec?.moveX || 0, rec?.moveY || 0);
        }
        const moving = Math.hypot(vx, vy) > 2 || stick > 0.01;
        return { vx, vy, moving };
    },

    snapshotFor(viewerId) {
        const viewer = this.players.get(viewerId);
        if (!viewer) return null;
        // Always include all connected players (max 8) — do not distance-cull remotes
        const players = [];
        for (const p of this.players.values()) {
            if (!p.connected) continue;
            const motion = this._poseMotion(p, p);
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
                eatChannel: this._eatChannelSnap(p.eatChannel),
                tendChannel: this._tendChannelSnap(p.tendChannel),
                activity: this._pawnTendActivity(p),
                attacking: !p.prone && !p.dead && p.attackTimer > 0,
                attackAngle: !p.prone && !p.dead && p.attackTimer > 0 ? (p.attackAngle ?? null) : null,
                attackProgress: !p.prone && !p.dead && p.attackTimer > 0 && p.attackMax > 0
                    ? 1 - p.attackTimer / p.attackMax
                    : 0,
                attackArt: !p.prone && !p.dead && p.attackTimer > 0 ? (p.attackArt || null) : null,
                look: p.look || Look.normalizeLook(null),
                party: (p.party || []).map((m) => {
                    const mm = this._poseMotion(m, p);
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
                        eatChannel: this._eatChannelSnap(m.eatChannel),
                        tendChannel: this._tendChannelSnap(m.tendChannel),
                        activity: this._pawnTendActivity(m),
                        attacking: !(m.dead || m.prone || m.creature?._prone || m._resting)
                            && (m.attackTimer || 0) > 0,
                        attackAngle: !(m.dead || m.prone || m.creature?._prone || m._resting)
                            && (m.attackTimer || 0) > 0
                            ? (m.attackAngle ?? null)
                            : null,
                        attackArt: !(m.dead || m.prone || m.creature?._prone || m._resting)
                            && (m.attackTimer || 0) > 0
                            ? (m.attackArt || null)
                            : null
                    };
                })
            });
        }
        // Snapshot the camera pawn's neighborhood. Using the session leader
        // made camp drops vanish when you possessed a companion far away.
        // Non-finite pose would make viewChunkKeys skip every add() and
        // clients would briefly think every corpse vanished (sparkle storm).
        const control = this._actionPawn(viewer, { pawnId: viewer.controlId || viewer.id }) || viewer;
        const vx = Number.isFinite(control.x) ? control.x : (Number.isFinite(viewer.x) ? viewer.x : 0);
        const vy = Number.isFinite(control.y) ? control.y : (Number.isFinite(viewer.y) ? viewer.y : 0);
        const { cx, cy } = worldToChunk(vx, vy);
        let near = this._viewChunks(viewer);
        if (!near.length) {
            near = this._chunksNear(vx, vy, this.interestRadius(viewer), { load: false });
        }
        const drops = [];
        const corpses = [];
        const campfires = [];
        const storages = [];
        for (const c of near) {
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
        for (const mob of this.mobs.values()) {
            if (!mob || mob.isBodyDead()) continue;
            if (!this._inSimRange(mob.x, mob.y)) continue;
            const frozen = !(this._mobTimeScale() > 0);
            const moving = !frozen && Math.hypot(mob.vx || 0, mob.vy || 0) > 2;
            const row = {
                id: mob.id,
                kind: mob.def?.id || mob.entry?.id || "deer",
                name: mob.def?.name || mob.name,
                x: mob.x,
                y: mob.y,
                facing: mob.facing || "down",
                vx: frozen ? 0 : (mob.vx || 0),
                vy: frozen ? 0 : (mob.vy || 0),
                moving,
                panic: !!(mob.panicMs > 0 || mob.ai?.panicMs > 0),
                hostile: !!mob.hostile,
                prone: !!mob._prone,
                attacking: !!(!mob._prone && mob.attackTimer > 0),
                attackAngle: !mob._prone && Number.isFinite(mob.attackAngle) ? mob.attackAngle : null,
                attackArt: !mob._prone && mob.attackTimer > 0 ? (mob.attackArt || null) : null
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
            settlements: this._publicSettlements(),
            chunkCursor: { cx, cy },
            youId: viewerId
        };
        return out;
    },

    youPayload(playerId) {
        const p = this.players.get(playerId);
        if (!p) return null;
        this._migrateOwnerResearch(playerId);
        _research()?.ensureTechs?.(p);
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
            quarantine: Array.isArray(p.quarantine) ? p.quarantine.slice() : [],
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
            eatChannel: this._eatChannelSnap(p.eatChannel),
            tendChannel: this._tendChannelSnap(p.tendChannel),
            vomit: this._isVomiting(p)
                ? { remainingMs: Math.max(0, Number(p.vomitRemainingMs) || 0) }
                : null,
            party: (p.party || []).map((m) => {
                const c = m.creature || this.creatures.get(m.id);
                return {
                    id: m.id,
                    name: m.name,
                    look: m.look,
                    kc: m.kc,
                    saturation: m.saturation,
                    stomach: m.stomach,
                    inventory: this._clonePersistSlots(
                        this._slotsWithItems(m.inventory, c?.inventory) || emptyInv(5),
                        5
                    ),
                    overflow: this._clonePersistSlots(
                        this._slotsWithItems(m.overflow, c?.overflow)
                    ),
                    equipment: this._clonePersistEquipment(
                        this._equipmentWithItems(m.equipment, c?.equipment)
                    ),
                    quarantine: Array.isArray(m.quarantine) ? m.quarantine.slice() : [],
                    hotbarIndex: m.hotbarIndex,
                    body: m.body || c?.anatomy?.toJSON?.() || null,
                    hp: m.hp,
                    mhp: m.mhp,
                    x: m.x,
                    y: m.y,
                    facing: m.facing,
                    dead: !!m.dead,
                    prone: !!(m.dead || m.prone || c?._prone || m._resting),
                    resting: !!m._resting,
                    restRot: m.lastSleep?.rot,
                    lastSleep: m.lastSleep || null,
                    eatChannel: this._eatChannelSnap(m.eatChannel),
                    tendChannel: this._tendChannelSnap(m.tendChannel),
                    activity: this._pawnTendActivity(m)
                };
            }),
            controlId: p.controlId || p.id,
            techs: p.techs && typeof p.techs === "object" ? { ...p.techs } : {},
            techGrantRev: p.techGrantRev ?? 0,
            researchSpent: this._researchSpent(p.id),
            settlements: this._ownedSettlements(p.id),
            settlers: (this.settlers || [])
                .filter((s) => s && !s.dead && s.ownerId === p.id)
                .map((s) => this._persistSettler(s))
        };
    },
    };
});
