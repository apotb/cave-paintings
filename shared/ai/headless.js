/**
 * Headless mob AI for the dedicated server (no anims / Phaser).
 * Ports Doofus / Scared / Neutral / Aggressive behavior onto SimCreature
 * via setDesiredVel + tryMeleeAttack.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const GameMath = require("../gameMath");
        const BodyCombat = require("../body/Combat");
        const Party = require("../party");
        const MeleeMath = require("../melee");
        const Path = require("../path");
        module.exports = factory(GameMath, BodyCombat, Party, MeleeMath, Path);
    } else {
        root.HeadlessAI = factory(
            root.GameMath, root.BodyCombat, root.Party, root.MeleeMath, root.Path
        );
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (GameMath, BodyCombat, Party, MeleeMath, Path) {
    const TILE = 16;

    function clamp(v, a, b) {
        return GameMath.clamp(v, a, b);
    }

    class DoofusAI {
        constructor(mob) {
            this.mob = mob;
            this.state = "idle";
            this.timer = 0;
            this.dirX = 0;
            this.dirY = 0;
            this._beginIdle();
        }

        update(delta, world = null) {
            const mob = this.mob;
            if (world) this._world = world;
            if (!mob || mob.isBodyDead?.() || !mob.active) return;
            if (mob.isImmobile?.() || mob.isIncapacitated?.()) {
                mob.setDesiredVel(0, 0);
                return;
            }

            this.timer -= delta;
            if (this.timer <= 0) {
                if (this.state === "idle") this._beginWalk();
                else this._beginIdle();
            }

            if (this.state === "walk") this._applyWalk(1, delta);
            else mob.setDesiredVel(0, 0);
        }

        _wanderBase() {
            const mob = this.mob;
            const w = Number(mob.def?.wanderSpeed);
            if (Number.isFinite(w) && w > 0) return w;
            return Number(mob.def?.speed) || 1;
        }

        _applyWalk(speedMult, delta = 16) {
            const mob = this.mob;
            const moveMul = mob.capacities?.moving
                ? Math.max(0.05, Math.min(1.5, mob.capacities.moving()))
                : 1;
            const tilesPerSec = this._wanderBase() * speedMult * moveMul;
            const speed = tilesPerSec * TILE;
            let x = this.dirX;
            let y = this.dirY;
            const len = Math.hypot(x, y) || 1;
            x /= len;
            y /= len;
            if (Path?.steerHeading) {
                const world = this._world || this._aiWorldRef;
                const blocked = (px, py) => (world?.poseBlocked
                    ? world.poseBlocked(mob, px, py)
                    : (world?.isBlocked ? world.isBlocked(px, py) : false));
                const steered = Path.steerHeading(
                    { x: mob.x, y: mob.y },
                    x,
                    y,
                    blocked,
                    this._nav || { side: 1 },
                    { dt: delta, rangeTiles: 6 }
                );
                this._nav = steered;
                x = steered.nx;
                y = steered.ny;
            }
            mob.setDesiredVel(x * speed, y * speed);

            if (Math.abs(x) > Math.abs(y)) {
                mob.facing = x > 0 ? "right" : "left";
            } else if (y !== 0) {
                mob.facing = y > 0 ? "down" : "up";
            }
        }

        _beginIdle() {
            this.state = "idle";
            this.dirX = 0;
            this.dirY = 0;
            this.timer = GameMath.between(1000, 3000);
        }

        _beginWalk() {
            this.state = "walk";
            const dirs = [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
                [1, 1],
                [1, -1],
                [-1, 1],
                [-1, -1]
            ];
            const mob = this.mob;
            const homeX = mob.homeX ?? mob.entry?.homeX;
            const homeY = mob.homeY ?? mob.entry?.homeY;
            const SOFT = 4;
            const HARD = 7;

            let pick = null;
            if (homeX != null && homeY != null) {
                const hx = (homeX - mob.x) / TILE;
                const hy = (homeY - mob.y) / TILE;
                const dist = Math.hypot(hx, hy);
                if (dist > 0.15) {
                    const nx = hx / dist;
                    const ny = hy / dist;
                    const forceHome = dist >= HARD || (dist >= SOFT && GameMath.random() < 0.65);
                    if (forceHome) {
                        const weights = dirs.map(([dx, dy]) => {
                            const len = Math.hypot(dx, dy) || 1;
                            const align = (dx / len) * nx + (dy / len) * ny;
                            return Math.max(0.05, align + 1);
                        });
                        pick = this._weightedPickDirs(dirs, weights);
                    }
                }
            }
            if (!pick) pick = GameMath.pick(dirs);
            this.dirX = pick[0];
            this.dirY = pick[1];
            this.timer = GameMath.between(1000, 2000);
        }

        _weightedPickDirs(items, weights) {
            let total = 0;
            for (const w of weights) total += w;
            let r = GameMath.random() * total;
            for (let i = 0; i < items.length; i++) {
                r -= weights[i];
                if (r <= 0) return items[i];
            }
            return items[items.length - 1];
        }
    }

    class ScaredAnimalAI extends DoofusAI {
        constructor(mob) {
            super(mob);
            this.panicMs = 0;
            this.PANIC_DURATION = 10000;
            this.PANIC_PLAYER_RANGE = 5;
            this.PANIC_SPEED_MULT = 3.6;
            this.PANIC_FLEE_CHANCE = 0.75;
        }

        onDamaged(_source = null, _opts = null) {
            this.panicMs = this.PANIC_DURATION;
            this._beginPanicDash();
        }

        update(delta, world = null) {
            const mob = this.mob;
            if (!mob || mob.isBodyDead?.() || !mob.active) return;
            if (mob.isImmobile?.() || mob.isIncapacitated?.()) {
                mob.setDesiredVel(0, 0);
                return;
            }

            if (this.panicMs > 0) {
                this._updatePanic(delta, world);
                return;
            }
            super.update(delta, world);
        }

        _findThreat(world) {
            if (world?.getNearestPlayer) return world.getNearestPlayer(this.mob);
            if (world?.players) {
                let best = null;
                let bestD = Infinity;
                for (const p of world.players) {
                    if (!p || p.isBodyDead?.()) continue;
                    const d = Math.hypot(p.x - this.mob.x, p.y - this.mob.y);
                    if (d < bestD) {
                        bestD = d;
                        best = p;
                    }
                }
                return best;
            }
            return world?.player || null;
        }

        _updatePanic(delta, world) {
            const mob = this.mob;
            if (world) this._world = world;
            const player = this._findThreat(world);

            if (player) {
                const distTiles = Math.hypot(
                    (mob.x - player.x) / TILE,
                    (mob.y - player.y) / TILE
                );
                if (distTiles > this.PANIC_PLAYER_RANGE) this.panicMs -= delta;
            } else {
                this.panicMs -= delta;
            }

            if (this.panicMs <= 0) {
                this.panicMs = 0;
                this._beginIdle();
                return;
            }

            this.timer -= delta;
            if (this.timer <= 0) this._beginPanicDash(world);
            this._applyWalk(this.PANIC_SPEED_MULT, delta);
        }

        _beginPanicDash(world = null) {
            this.state = "walk";
            const dirs = [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
                [1, 1],
                [1, -1],
                [-1, 1],
                [-1, -1]
            ];
            let pick = null;
            const player = this._findThreat(world);
            if (player && GameMath.random() < this.PANIC_FLEE_CHANCE) {
                let fx = this.mob.x - player.x;
                let fy = this.mob.y - player.y;
                const flen = Math.hypot(fx, fy);
                if (flen > 0.001) {
                    fx /= flen;
                    fy /= flen;
                    const weights = dirs.map(([dx, dy]) => {
                        const len = Math.hypot(dx, dy) || 1;
                        const align = (dx / len) * fx + (dy / len) * fy;
                        return Math.max(0.08, align + 1);
                    });
                    pick = this._weightedPickDirs(dirs, weights);
                }
            }
            if (!pick) pick = GameMath.pick(dirs);
            this.dirX = pick[0];
            this.dirY = pick[1];
            this.timer = GameMath.between(120, 350);
        }
    }

    /**
     * Neutral: wander until damaged by a player (or a same-species packmate is),
     * then sprint in and plant in fist range.
     */
    class NeutralAnimalAI extends DoofusAI {
        constructor(mob) {
            super(mob);
            this.hostile = !!mob.hostile;
            this.timeSinceHitPlayer = 0;
            this.LEASH_TILES = 10;
            this.GIVE_UP_MS = 9000;
            this.MELEE_RESUME_PAD = 10;
            this._meleeHold = false;
            this._aiWorldRef = null;
            this._deaggroTimer = 0;
            this._deaggroDelay = GameMath.between(200, 2200);
            this._leashBonus = GameMath.floatBetween(0, 2);
            this._giveUpBonus = GameMath.between(0, 2500);
            this._atkCache = null;
            this._atkCacheMs = 0;
        }

        onDamaged(source = null, opts = null) {
            // Pack alert: only get mad if the victim is the same species
            if (opts?.alert) {
                const mine = String(this.mob?.def?.id || this.mob?.entry?.id || "").toLowerCase();
                const theirs = String(
                    opts.victim?.def?.id || opts.victim?.entry?.id || ""
                ).toLowerCase();
                if (!mine || !theirs || mine !== theirs) return;
            }
            if (source && (source.kind === "player" || source.isPlayer)) {
                this.hostile = true;
                this.mob.hostile = true;
                this.timeSinceHitPlayer = 0;
                this._deaggroTimer = 0;
                Party?.setWildAggroOwner?.(this.mob, source);
                if (!this.aggroOwnerId) this.aggroOwnerId = Party?.ownerIdOf?.(source) || null;
            }
            this._atkCache = null;
            this._atkCacheMs = 0;
        }

        onDealtHit() {
            this.timeSinceHitPlayer = 0;
            this._deaggroTimer = 0;
        }

        _clearCombatMove() {
            this._meleeHold = false;
            this._deaggroTimer = 0;
            this.mob.isSprinting = false;
        }

        _tryGiveUp(distTiles, delta) {
            const leash = this.LEASH_TILES + this._leashBonus;
            const giveUp = this.GIVE_UP_MS + this._giveUpBonus;
            if (distTiles > leash || this.timeSinceHitPlayer > giveUp) {
                this._deaggroTimer += delta;
                if (this._deaggroTimer >= this._deaggroDelay) {
                    this.hostile = false;
                    this.mob.hostile = false;
                    this.aggroOwnerId = null;
                    Party?.clearWildAggroOwner?.(this.mob);
                    this._clearCombatMove();
                    this._beginIdle();
                    this._deaggroDelay = GameMath.between(200, 2200);
                    this._leashBonus = GameMath.floatBetween(0, 2);
                    this._giveUpBonus = GameMath.between(0, 2500);
                    return true;
                }
            } else {
                this._deaggroTimer = 0;
            }
            return false;
        }

        _isHuntTarget(p) {
            if (!p || p === this.mob || p.isBodyDead?.()) return false;
            if (p.role === "wanderer") return false;
            if (Party?.sameFaction?.(this.mob, p)) return false;
            return true;
        }

        _findPlayer(world) {
            if (world?.getDuelTarget) {
                const duel = world.getDuelTarget(this.mob);
                if (this._isHuntTarget(duel)) return duel;
            }
            if (world?.getNearestPlayer) {
                const nearest = world.getNearestPlayer(this.mob);
                if (this._isHuntTarget(nearest)) return nearest;
            }
            if (this.mob.targetId && world?.getCreature) {
                const t = world.getCreature(this.mob.targetId);
                if (t && t.kind === "player" && this._isHuntTarget(t)) return t;
            }
            if (world?.players) {
                const prefer = this.aggroOwnerId
                    || Party?.wildAggroOwnerId?.(this.mob);
                let best = null;
                let bestD = Infinity;
                for (const p of world.players) {
                    if (!this._isHuntTarget(p)) continue;
                    if (prefer && Party?.ownerIdOf?.(p) !== prefer) continue;
                    const d = Math.hypot(p.x - this.mob.x, p.y - this.mob.y);
                    if (d < bestD) {
                        bestD = d;
                        best = p;
                    }
                }
                return best;
            }
            const fallback = world?.player || null;
            return this._isHuntTarget(fallback) ? fallback : null;
        }

        _distToHurtbox(ax, ay, target) {
            const box = typeof target.hurtbox === "function" ? target.hurtbox(0) : null;
            if (!box) {
                const pc =
                    typeof target.bodyCenter === "function"
                        ? target.bodyCenter()
                        : { x: target.x, y: target.y };
                return Math.max(0, Math.hypot(pc.x - ax, pc.y - ay) - 8);
            }
            const cx = clamp(ax, box.left, box.right);
            const cy = clamp(ay, box.top, box.bottom);
            return Math.hypot(ax - cx, ay - cy);
        }

        update(delta, world = null) {
            const mob = this.mob;
            this._aiWorldRef = world || this._aiWorldRef;
            if (!mob || mob.isBodyDead?.() || !mob.active) return;

            if (!mob.capacities && mob.refreshCapacities) mob.refreshCapacities();
            else if (!mob.capacities) {
                /* capacities refreshed by sim tick */
            }

            if (mob.isIncapacitated?.()) {
                this._clearCombatMove();
                mob.setDesiredVel(0, 0);
                return;
            }

            const immobilized = mob.isImmobile?.();

            if (!this.hostile) {
                this._clearCombatMove();
                if (immobilized) {
                    mob.setDesiredVel(0, 0);
                    return;
                }
                super.update(delta, world);
                return;
            }

            const player = this._findPlayer(world);
            if (!player || player.isBodyDead?.()) {
                this.hostile = false;
                this.mob.hostile = false;
                this._clearCombatMove();
                this._beginIdle();
                return;
            }

            const distTiles = Math.hypot(
                (mob.x - player.x) / TILE,
                (mob.y - player.y) / TILE
            );
            this.timeSinceHitPlayer += delta;
            if (this._tryGiveUp(distTiles, delta)) return;

            if (immobilized) {
                this._clearCombatMove();
                mob.setDesiredVel(0, 0);
                return;
            }

            const mc =
                typeof mob.bodyCenter === "function"
                    ? mob.bodyCenter()
                    : { x: mob.x, y: mob.y };
            const pc =
                typeof player.bodyCenter === "function"
                    ? player.bodyCenter()
                    : { x: player.x, y: player.y };
            const toPlayerX = pc.x - mc.x;
            const toPlayerY = pc.y - mc.y;
            const distPlayer = Math.hypot(toPlayerX, toPlayerY) || 1;
            if (Math.abs(toPlayerX) > Math.abs(toPlayerY)) mob.facing = toPlayerX > 0 ? "right" : "left";
            else mob.facing = toPlayerY > 0 ? "down" : "up";

            this._atkCacheMs -= delta;
            if (!this._atkCache || this._atkCacheMs <= 0) {
                this._atkCache = BodyCombat.pickAttack(mob);
                this._atkCacheMs = 250;
            }
            const atk = this._atkCache;
            const reach = Number(atk?.range) || 4;
            // Server pawns don't collide, so plant/strike a bit farther than the
            // 4px fist length or they run in and never start a swing.
            const strikeR = Math.max(reach, 12);
            const swinging = !!mob.isAttacking?.();
            const edgeDist = this._distToHurtbox(mc.x, mc.y, player);
            const inReach = edgeDist <= strikeR;

            if (inReach) this._meleeHold = true;
            else if (edgeDist > strikeR + this.MELEE_RESUME_PAD) this._meleeHold = false;

            if (
                !swinging &&
                atk &&
                inReach &&
                mob.capacities?.canManipulate?.()
            ) {
                mob.tryMeleeAttack?.(player, atk);
            }

            const base = Number(mob.def?.speed) || 3.5;
            const sprintFactor = Number(mob.def?.sprintFactor) || 1.5;
            const livingLegs = mob.anatomy?.livingLegs?.() ?? 2;
            const legsNeeded = mob.capacities?.isQuadrupedHoofed?.() ? 3 : 2;
            const moveMul = Math.max(0.05, Math.min(1.5, mob.capacities?.moving?.() ?? 1));
            const walk = base * TILE * moveMul;

            if (this._meleeHold || swinging) {
                mob.isSprinting = false;
                mob.setDesiredVel(0, 0);
                return;
            }

            const stand = Party?.duelStandPoint
                ? Party.duelStandPoint(mob, player, world?.getDuelMap?.(), {
                    standPx: Math.max(8, strikeR - 2)
                })
                : pc;
            const dx = stand.x - mc.x;
            const dy = stand.y - mc.y;
            const len = Math.hypot(dx, dy) || 1;
            let nx = dx / len;
            let ny = dy / len;
            const rep = Party?.duelRepulse
                ? Party.duelRepulse(mob, world?.getDuelEntities?.())
                : null;
            if (rep && (rep.rx || rep.ry)) {
                nx += rep.rx * 0.7;
                ny += rep.ry * 0.7;
                const nlen = Math.hypot(nx, ny) || 1;
                nx /= nlen;
                ny /= nlen;
            }

            const near = edgeDist <= Math.max(reach + 8, 14);
            if (!near && Path?.steerHeading) {
                const blocked = (px, py) => (world?.poseBlocked
                    ? world.poseBlocked(mob, px, py)
                    : (world?.isBlocked ? world.isBlocked(px, py) : false));
                const steered = Path.steerHeading(
                    { x: mob.x, y: mob.y },
                    nx,
                    ny,
                    blocked,
                    this._nav || { side: 1 },
                    { dt: delta, rangeTiles: 6 }
                );
                this._nav = steered;
                nx = steered.nx;
                ny = steered.ny;
            } else if (near) {
                this._nav = null;
            }
            const canSprint = livingLegs >= legsNeeded && !swinging && !near;
            mob.isSprinting = canSprint;
            const speed = walk * (canSprint ? sprintFactor : 1);
            mob.setDesiredVel(nx * speed, ny * speed);
        }
    }

    class AggressiveAnimalAI extends NeutralAnimalAI {
        constructor(mob) {
            super(mob);
            this.SIGHT_TILES = 8;
        }

        update(delta, world = null) {
            if (!this.hostile) this._trySightAggro(world);
            super.update(delta, world);
        }

        _trySightAggro(world) {
            const mob = this.mob;
            if (!mob || mob.isBodyDead?.() || !mob.active) return;
            if (mob.isIncapacitated?.() || mob.isImmobile?.()) return;
            const player = this._findPlayer(world);
            if (!player || player.isBodyDead?.()) return;
            const distTiles = Math.hypot(
                (mob.x - player.x) / TILE,
                (mob.y - player.y) / TILE
            );
            const sight = this.SIGHT_TILES + (this._leashBonus || 0) * 0.25;
            if (distTiles > sight) return;
            this.hostile = true;
            this.mob.hostile = true;
            Party?.setWildAggroOwner?.(this.mob, player);
            if (!this.aggroOwnerId) this.aggroOwnerId = Party?.ownerIdOf?.(player) || null;
            this.timeSinceHitPlayer = 0;
            this._deaggroTimer = 0;
            this._atkCache = null;
            this._atkCacheMs = 0;
        }
    }

    /**
     * Dedicated-server follow / melee-assist for uncontrolled party pawns.
     * Client puppets poses from the snapshot; this owns hitboxes.
     */
    class PartyAI {
        constructor(mob) {
            this.mob = mob;
            this.assistTarget = null;
            this._holdFollow = true;
            this._prevFx = null;
            this._prevFy = null;
            this._atkCache = null;
            this._atkCacheMs = 0;
            this._meleeHold = false;
            this._avoidSide = Math.random() < 0.5 ? -1 : 1;
            this._stuckMs = 0;
            this._lastPx = null;
            this._lastPy = null;
            this._escapeKey = null;
            this._path = null;
            this._pathGoalX = null;
            this._pathGoalY = null;
            this._pathRange = null;
            this._pathOpenRadius = null;
            this.eatSeek = null;
            this.LEASH_TILES = (Party && Party.COMBAT_LEASH) || 10;
            this.MELEE_RESUME_PAD = 3;
        }

        update(delta, world) {
            const mob = this.mob;
            this._world = world;
            if (!mob || mob.isBodyDead?.()) {
                this._clearCombat();
                mob?.setDesiredVel?.(0, 0);
                return;
            }
            if (world?.isControlled?.(mob)) {
                this._clearCombat();
                mob.setDesiredVel?.(0, 0);
                return;
            }
            if (mob._resting) {
                this._clearCombat();
                mob.setDesiredVel?.(0, 0);
                return;
            }
            if (mob._restWalk) {
                this._clearCombat();
                const dest = world?.getRestWalkDest?.(mob);
                if (dest) this._walkToward(dest.x, dest.y, false, world, delta);
                else mob.setDesiredVel?.(0, 0);
                return;
            }
            if (mob.isIncapacitated?.() || mob.isImmobile?.() || mob.isVomiting?.()) {
                this._clearCombat();
                mob.setDesiredVel?.(0, 0);
                return;
            }
            if (world?.leaderDead?.(mob)) {
                this._clearCombat();
                mob.setDesiredVel?.(0, 0);
                return;
            }
            const follow = world?.getFollowTarget?.(mob);
            if (!follow || follow.isBodyDead?.()) {
                this._clearCombat();
                mob.setDesiredVel?.(0, 0);
                return;
            }

            const next = world?.getAssistTarget?.(mob) || null;
            const ok = next && this._assistStillOk(next, follow, world);
            if (ok) {
                if (next !== this.assistTarget) {
                    this.assistTarget = next;
                    this._path = null;
                    this._escapeKey = null;
                    this._stuckMs = 0;
                }
            } else {
                this._clearCombat();
            }
            if (this.assistTarget) {
                this._tickCombat(delta, world, follow);
                return;
            }
            if (mob._wokeFromRest) {
                world?.tryReturnToBed?.(mob);
                return;
            }
            if (mob._tending) {
                mob.setDesiredVel?.(0, 0);
                return;
            }
            if (this._tickEatSeek(delta, world)) return;
            this._tickFollow(follow, delta);
        }

        _tickEatSeek(delta, world) {
            const mob = this.mob;
            const target = this.eatSeek;
            if (!target || target.isBodyDead?.()) {
                this.eatSeek = null;
                return false;
            }
            if (Party?.inInteractRange?.(mob, target, TILE)) {
                mob.setDesiredVel?.(0, 0);
                return true;
            }
            const dist = Math.hypot((mob.x || 0) - (target.x || 0), (mob.y || 0) - (target.y || 0));
            this._walkToward(target.x, target.y, dist > TILE * 6, world, delta);
            return true;
        }

        _clearCombat() {
            this.assistTarget = null;
            this._meleeHold = false;
        }

        _tickFollow(follow, delta) {
            const mob = this.mob;
            const P = Party || {};
            const dist = Math.hypot(mob.x - follow.x, mob.y - follow.y);
            const idleR = (P.FOLLOW_IDLE ?? 2.6) * TILE;
            const catchR = (P.FOLLOW_CATCH ?? 4.8) * TILE;
            const overlapping = !!this._overlappingThing(this._world);

            // Park in catch range even if a padded tree AABB clips the
            // hitbox. Walking the exit dir here was the tiny pacing circle.
            const closeEnough = dist <= idleR
                || (this._holdFollow && dist < catchR)
                || (overlapping && dist < catchR)
                || (this._stuckMs > 280 && dist < catchR);
            if (closeEnough) {
                this._holdFollow = true;
                const jammed = overlapping || this._stuckMs > 200;
                if (!jammed && this._unstickFromMates(follow, idleR)) return;
                this._idle();
                if (!this._leaderMoving(follow)) this._world?.tryInjuredRest?.(mob);
                return;
            }
            this._holdFollow = false;

            const sprint = dist > TILE * 6;
            this._walkToward(follow.x, follow.y, sprint, this._world, delta);
        }

        _separation() {
            const mob = this.mob;
            const mates = this._world?.getPartyMates?.(mob) || [];
            const want = TILE * 0.5;
            let sx = 0;
            let sy = 0;
            for (const other of mates) {
                if (!other || other === mob || other.id === mob.id) continue;
                if (other._prone || other.isBodyDead?.()) continue;
                const dx = mob.x - other.x;
                const dy = mob.y - other.y;
                const d = Math.hypot(dx, dy);
                if (!(d > 0.01)) {
                    const h = this._idHash(mob.id || 0);
                    sx += Math.cos(h);
                    sy += Math.sin(h);
                    continue;
                }
                if (d >= want) continue;
                const w = (want - d) / want;
                sx += (dx / d) * w;
                sy += (dy / d) * w;
            }
            return { sx, sy };
        }

        _idHash(id) {
            const s = String(id);
            let n = 0;
            for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) | 0;
            return ((n >>> 0) / 4294967296) * Math.PI * 2;
        }

        _unstickFromMates(follow, idleR) {
            if (this._overlappingThing(this._world)) return false;
            const sep = this._separation();
            const sl = Math.hypot(sep.sx, sep.sy);
            if (!(sl > 0.45)) return false;
            const mob = this.mob;
            let wx = sep.sx / sl;
            let wy = sep.sy / sl;
            const fx = follow.x - mob.x;
            const fy = follow.y - mob.y;
            const fd = Math.hypot(fx, fy) || 1;
            const nx = fx / fd;
            const ny = fy / fd;
            const away = wx * -nx + wy * -ny;
            if (fd > idleR * 0.65 && away > 0) {
                wx += nx * (away + 0.4);
                wy += ny * (away + 0.4);
                const n = Math.hypot(wx, wy) || 1;
                wx /= n;
                wy /= n;
            }
            const from = mob;
            if (this._agentBlocked(from.x + wx * 10, from.y + wy * 10, this._world)) return false;
            this._walk(wx, wy, false);
            return true;
        }

        _leaderMoving(follow) {
            const vx = follow.vx || follow.moveX || 0;
            const vy = follow.vy || follow.moveY || 0;
            if (Math.hypot(vx, vy) > 8) {
                this._prevFx = follow.x;
                this._prevFy = follow.y;
                return true;
            }
            const moved = this._prevFx != null
                && Math.hypot(follow.x - this._prevFx, follow.y - this._prevFy) > 0.7;
            this._prevFx = follow.x;
            this._prevFy = follow.y;
            return moved;
        }

        _idle() {
            this.mob.setDesiredVel?.(0, 0);
            this._stuckMs = 0;
            this._escapeKey = null;
            this._path = null;
            this._pathGoalX = null;
            this._pathGoalY = null;
            this._pathOpenRadius = null;
            this._lastWpDist = null;
        }

        _tickCombat(delta, world, follow) {
            const mob = this.mob;
            const target = this.assistTarget;
            if (!target) return;
            this._world = world;
            const P = Party || {};
            const leash = (P.COMBAT_LEASH ?? 10) * TILE;
            const dCtrl = Math.hypot(target.x - follow.x, target.y - follow.y);
            const dSelf = Math.hypot(target.x - mob.x, target.y - mob.y);
            if (dCtrl > leash && dSelf > TILE * 3 && !world?.isPvpTarget?.(mob, target)) {
                this._clearCombat();
                mob.setDesiredVel?.(0, 0);
                return;
            }

            this._pickBestWeapon(world);
            const mc = mob.bodyCenter?.() || { x: mob.x, y: mob.y };
            const pc = target.bodyCenter?.() || { x: target.x, y: target.y };
            const toX = pc.x - mc.x;
            const toY = pc.y - mc.y;
            const distT = Math.hypot(toX, toY) || 1;
            this._face(toX, toY);

            this._atkCacheMs -= delta;
            if (!this._atkCache || this._atkCacheMs <= 0) {
                this._atkCache = BodyCombat.pickAttack(mob);
                this._atkCacheMs = 250;
            }
            const atk = this._atkCache;
            const reach = Number(atk?.range) || 4;
            const swinging = !!mob.isAttacking?.();
            const aim = Math.atan2(toY, toX);
            const edgeDist = this._distToHurtbox(mc.x, mc.y, target);
            const inReach = edgeDist <= reach;
            const canLand = inReach && this._canLandMelee(mc, target, reach, aim, atk);

            const stand = Party?.duelStandPoint
                ? Party.duelStandPoint(mob, target, world?.getDuelMap?.(), {
                    standPx: Math.max(16, reach + 6),
                    occupy: world?.getFollowTarget?.(mob) || world?.getNearestPlayer?.(mob),
                    entities: world?.getDuelEntities?.()
                })
                : { x: pc.x, y: pc.y, flanking: false };
            if (canLand) this._meleeHold = true;
            else if (edgeDist > reach + this.MELEE_RESUME_PAD) this._meleeHold = false;

            if (
                !swinging &&
                atk &&
                canLand &&
                mob.capacities?.canManipulate?.()
            ) {
                mob.tryMeleeAttack?.(target, atk);
            }

            if (this._meleeHold || swinging) {
                mob.setDesiredVel?.(0, 0);
                return;
            }

            this._walkCombatToward(
                stand.x,
                stand.y,
                distT > TILE * 2.5 && !canLand,
                world,
                delta
            );
        }

        _assistStillOk(target, follow, world) {
            if (!target || target.isBodyDead?.()) return false;
            const P = Party || {};
            const leash = (P.COMBAT_LEASH ?? 10) * TILE;
            const dCtrl = Math.hypot(target.x - follow.x, target.y - follow.y);
            const dSelf = Math.hypot(target.x - this.mob.x, target.y - this.mob.y);
            if (dCtrl > leash && dSelf > TILE * 3 && !world?.isPvpTarget?.(this.mob, target)) {
                return false;
            }
            return true;
        }

        _walkCombatToward(tx, ty, sprint, world, delta) {
            const mob = this.mob;
            const c = mob.bodyCenter?.() || { x: mob.x, y: mob.y };
            this._pathRange = 16;
            this._pathOpenRadius = 2;
            this._walkToward(
                tx - (c.x - mob.x),
                ty - (c.y - mob.y),
                sprint,
                world,
                delta
            );
            this._pathOpenRadius = null;
        }

        _distToHurtbox(x, y, target) {
            if (MeleeMath?.meleeEdgeDist) return MeleeMath.meleeEdgeDist(x, y, target);
            const c = target.bodyCenter?.() || { x: target.x, y: target.y };
            const hs = Number(target.hitboxSize) || 8;
            const d = Math.hypot(c.x - x, c.y - y);
            return Math.max(0, d - hs * 0.5);
        }

        _canLandMelee(mc, target, reach, angle, atk) {
            if (MeleeMath?.meleeSwingWouldHit) {
                return MeleeMath.meleeSwingWouldHit(mc.x, mc.y, angle, reach, target, {
                    radius: atk?.unarmed === false ? 3 : 4
                });
            }
            return this._distToHurtbox(mc.x, mc.y, target) <= reach;
        }

        _pickBestWeapon(world) {
            const mob = this.mob;
            const getItem = world?.getItem;
            if (!mob?.inventory || typeof Party?.bestMeleeSlot !== "function") return;
            const slot = Party.bestMeleeSlot(mob.inventory, getItem, mob.hotbarIndex || 0);
            if (slot !== mob.hotbarIndex) {
                mob.hotbarIndex = slot;
                this._atkCache = null;
            }
        }

        _walkToward(tx, ty, sprint, world, delta) {
            const mob = this.mob;
            const from = { x: mob.x, y: mob.y };
            const to = { x: tx, y: ty };
            const blocked = (x, y) => {
                if (world?.poseBlocked) return world.poseBlocked(mob, x, y);
                return this._agentBlocked(x, y, world);
            };
            if (!Path?.steerToward) return;
            const steered = Path.steerToward({
                from,
                to,
                blocked,
                cellSize: TILE,
                side: this._avoidSide,
                path: this._path,
                pathGoal: this._pathGoalX != null ? { x: this._pathGoalX, y: this._pathGoalY } : null,
                stuckMs: this._stuckMs,
                lastFrom: this._lastPx != null ? { x: this._lastPx, y: this._lastPy } : null,
                lastWpDist: this._lastWpDist,
                maxRange: this._pathRange || 12,
                dt: delta,
                overlapping: !!this._overlappingThing(world),
                openRadius: this._pathOpenRadius
            });
            this._path = steered.path;
            this._pathGoalX = steered.pathGoal ? steered.pathGoal.x : null;
            this._pathGoalY = steered.pathGoal ? steered.pathGoal.y : null;
            this._avoidSide = steered.side;
            this._stuckMs = steered.stuckMs;
            this._lastPx = steered.lastFrom?.x;
            this._lastPy = steered.lastFrom?.y;
            this._lastWpDist = steered.lastWpDist;
            if (steered.arrived) {
                mob.setDesiredVel?.(0, 0);
                return;
            }
            this._walk(steered.nx, steered.ny, sprint);
        }

        _bodyRect() {
            const mob = this.mob;
            const hs = Number(mob.hitboxSize) || 8;
            const w = Number(mob.width) || 16;
            const h = Number(mob.height) || 16;
            const left = mob.x + (w - hs) * 0.5;
            const top = mob.y - h + hs;
            return { left, right: left + hs, top, bottom: top + hs };
        }

        _aabbHits(ax, ay, half, solids) {
            const left = ax - half;
            const right = ax + half;
            const top = ay - half;
            const bottom = ay + half;
            for (let i = 0; i < (solids || []).length; i++) {
                const tb = solids[i];
                if (right > tb.left && left < tb.right && bottom > tb.top && top < tb.bottom) {
                    return tb;
                }
            }
            return null;
        }

        _pointBlocked(x, y, world = this._world) {
            if (world?.poseBlocked) return world.poseBlocked(this.mob, x, y);
            if (world?.tileBlocked?.(x, y)) return true;
            if (!world?.tileBlocked && world?.isBlocked?.(x, y)) return true;
            const solids = this._solids || world?.thingRectsNear?.(x, y, TILE * 8) || [];
            const hs = Number(this.mob?.hitboxSize) || 8;
            return !!this._aabbHits(x, y, hs * 0.5 + 1, solids);
        }

        _agentBlocked(x, y, world) {
            if (world?.poseBlocked) return world.poseBlocked(this.mob, x, y);
            return this._pointBlocked(x, y, world);
        }

        _overlappingThing(world = this._world) {
            const body = this._bodyRect();
            const solids = this._solids
                || world?.thingRectsNear?.(this.mob.x, this.mob.y, 48)
                || [];
            for (let i = 0; i < solids.length; i++) {
                const tb = solids[i];
                if (body.right > tb.left && body.left < tb.right
                    && body.bottom > tb.top && body.top < tb.bottom) {
                    return tb;
                }
            }
            return null;
        }

        _walk(nx, ny, sprint) {
            const mob = this.mob;
            const moveMul = mob.capacities?.moving
                ? Math.max(0.05, Math.min(1.5, mob.capacities.moving()))
                : 1;
            let mul = 1;
            if (mob.isAttacking?.()) mul *= 0.5;
            const tiles = 3.5 * (sprint && (Number(mob.kc) > 0) ? 1.5 : 1);
            const speed = tiles * TILE * moveMul * mul;
            mob.setDesiredVel?.(nx * speed, ny * speed);
            this._face(nx, ny);
        }

        _face(x, y) {
            const mob = this.mob;
            if (Math.abs(x) > Math.abs(y)) mob.facing = x > 0 ? "right" : "left";
            else if (y !== 0) mob.facing = y > 0 ? "down" : "up";
        }
    }

    /** Passerby stroll: same A* as party follow, toward a stable point along heading. */
    class WandererStrollAI extends PartyAI {
        constructor(mob) {
            super(mob);
            this._pathRange = 16;
        }

        update(delta, world) {
            const mob = this.mob;
            this._world = world;
            if (!mob || mob.isBodyDead?.()) {
                mob?.setDesiredVel?.(0, 0);
                return;
            }
            if (mob.isIncapacitated?.() || mob.isImmobile?.()) {
                mob.setDesiredVel?.(0, 0);
                return;
            }
            const dest = mob.walkDest;
            const tx = Number(dest?.x);
            const ty = Number(dest?.y);
            if (Number.isFinite(tx) && Number.isFinite(ty)) {
                this._walkToward(tx, ty, false, world, delta);
                return;
            }
            const h = mob.heading || { x: 1, y: 0 };
            const len = Math.hypot(h.x, h.y) || 1;
            this._walkToward(
                mob.x + (h.x / len) * TILE * 40,
                mob.y + (h.y / len) * TILE * 40,
                false,
                world,
                delta
            );
        }

        _walk(nx, ny) {
            const mob = this.mob;
            const moveMul = mob.capacities?.moving
                ? Math.max(0.05, Math.min(1.5, mob.capacities.moving()))
                : 1;
            const tiles = 3.5 * ((Party && Party.WANDER_WALK_MULT) || 0.28);
            const speed = tiles * TILE * moveMul;
            mob.setDesiredVel?.(nx * speed, ny * speed);
            this._face(nx, ny);
        }
    }

    const MobAI = {
        doofus: DoofusAI,
        scaredAnimal: ScaredAnimalAI,
        neutralAnimal: NeutralAnimalAI,
        aggressiveAnimal: AggressiveAnimalAI,
        animal: ScaredAnimalAI
    };

    function createAI(mob, aiType) {
        const key = aiType || mob.aiType || mob.def?.ai || "doofus";
        const Ctor = MobAI[key] || DoofusAI;
        const ai = new Ctor(mob);
        mob.ai = ai;
        return ai;
    }

    return {
        DoofusAI,
        ScaredAnimalAI,
        NeutralAnimalAI,
        AggressiveAnimalAI,
        PartyAI,
        WandererStrollAI,
        MobAI,
        createAI
    };
});
