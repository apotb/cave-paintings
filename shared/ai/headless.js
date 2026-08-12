/**
 * Headless mob AI for the dedicated server (no anims / Phaser).
 * Ports Doofus / Scared / Neutral / Aggressive behavior onto SimCreature
 * via setDesiredVel + tryMeleeAttack.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const GameMath = require("../gameMath");
        const BodyCombat = require("../body/Combat");
        module.exports = factory(GameMath, BodyCombat);
    } else {
        root.HeadlessAI = factory(root.GameMath, root.BodyCombat);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (GameMath, BodyCombat) {
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

        update(delta) {
            const mob = this.mob;
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

            if (this.state === "walk") this._applyWalk(1);
            else mob.setDesiredVel(0, 0);
        }

        _wanderBase() {
            const mob = this.mob;
            const w = Number(mob.def?.wanderSpeed);
            if (Number.isFinite(w) && w > 0) return w;
            return Number(mob.def?.speed) || 1;
        }

        _applyWalk(speedMult) {
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
            super.update(delta);
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
            this._applyWalk(this.PANIC_SPEED_MULT);
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
     * then chase + melee. Simplified vs client (no MeleeSlots / obstacle steering).
     */
    class NeutralAnimalAI extends DoofusAI {
        constructor(mob) {
            super(mob);
            this.hostile = !!mob.hostile;
            this.timeSinceHitPlayer = 0;
            this.LEASH_TILES = 10;
            this.GIVE_UP_MS = 9000;
            this.MELEE_RESUME_PAD = 10;
            this.ANCHOR_ARRIVE = 6;
            this._meleeHold = false;
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

        _findPlayer(world) {
            if (world?.getNearestPlayer) return world.getNearestPlayer(this.mob);
            if (this.mob.targetId && world?.getCreature) {
                const t = world.getCreature(this.mob.targetId);
                if (t && t.kind === "player" && !t.isBodyDead?.()) return t;
            }
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
                super.update(delta);
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
            const fnx = toPlayerX / distPlayer;
            const fny = toPlayerY / distPlayer;
            if (Math.abs(fnx) > Math.abs(fny)) mob.facing = fnx > 0 ? "right" : "left";
            else mob.facing = fny > 0 ? "down" : "up";

            this._atkCacheMs -= delta;
            if (!this._atkCache || this._atkCacheMs <= 0) {
                this._atkCache = BodyCombat.pickAttack(mob);
                this._atkCacheMs = 250;
            }
            const atk = this._atkCache;
            const reach = atk?.range || 4;
            const swinging = !!mob.isAttacking?.();
            const edgeDist = this._distToHurtbox(mc.x, mc.y, player);
            const inReach = edgeDist <= reach;

            if (inReach) this._meleeHold = true;
            else if (edgeDist > reach + this.MELEE_RESUME_PAD) this._meleeHold = false;

            if (!swinging && atk && inReach && mob.capacities?.canManipulate?.()) {
                mob.tryMeleeAttack?.(player, atk);
            }

            const base = Number(mob.def?.speed) || 3.5;
            const sprintFactor = Number(mob.def?.sprintFactor) || 1.5;
            const livingLegs = mob.anatomy?.livingLegs?.() ?? 2;
            const legsNeeded = mob.capacities?.isQuadrupedHoofed?.() ? 3 : 2;
            const moveMul = Math.max(0.05, Math.min(1.5, mob.capacities?.moving?.() ?? 1));
            const walk = base * TILE * moveMul;

            if (this._meleeHold) {
                mob.isSprinting = false;
                mob.setDesiredVel(0, 0);
                return;
            }

            const canSprint = livingLegs >= legsNeeded && !swinging;
            mob.isSprinting = canSprint;
            const speed = walk * (canSprint ? sprintFactor : 1);
            mob.setDesiredVel(fnx * speed, fny * speed);
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
            this.timeSinceHitPlayer = 0;
            this._deaggroTimer = 0;
            this._atkCache = null;
            this._atkCacheMs = 0;
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
        MobAI,
        createAI
    };
});
