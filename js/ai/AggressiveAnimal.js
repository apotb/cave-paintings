/**
 * Neutral animal: wanders until damaged by the player (or a same-species packmate is),
 * then sprints in, claims a melee orbit slot (with queue behind), reshuffles,
 * and plants when at the anchor. Staggered give-up if far or idle too long.
 */
class NeutralAnimalAI extends DoofusAI {
    constructor(mob) {
        super(mob);
        this.hostile = false;
        this.timeSinceHitPlayer = 0;
        this.LEASH_TILES = 10;
        this.GIVE_UP_MS = 9000;
        this.MELEE_RESUME_PAD = 10;
        // Arrive/resume hysteresis — a single threshold flickers walk↔idle every frame
        this.ANCHOR_ARRIVE = 6;
        this.ANCHOR_RESUME = 14;
        this.RESHUFFLE_MS = 700;
        this._meleeHold = false;
        this._slotHold = false;
        this._slotClaim = null;
        this._reshuffleTimer = 0;
        this._deaggroTimer = 0;
        // Per-mob stagger so packs don't all calm down on the same frame
        this._deaggroDelay = Phaser.Math.Between(200, 2200);
        this._leashBonus = Phaser.Math.FloatBetween(0, 2);
        this._giveUpBonus = Phaser.Math.Between(0, 2500);
        /** Sticky sidestep sign when skirting trees/rocks (−1 / +1). */
        this._avoidSide = Math.random() < 0.5 ? -1 : 1;
        this._stuckMs = 0;
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
        if (source && source === this.mob.scene?.player) {
            this.hostile = true;
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

    _slots() {
        return this.mob.scene?.meleeSlots || null;
    }

    _releaseSlot() {
        const slots = this._slots();
        if (slots && this.mob) slots.release(this.mob);
        this._slotClaim = null;
    }

    _clearCombatMove() {
        this._meleeHold = false;
        this._slotHold = false;
        this._releaseSlot();
        this._deaggroTimer = 0;
        this.mob.isSprinting = false;
        this.mob.anims.timeScale = 1;
    }

    _tryGiveUp(distTiles, delta) {
        const leash = this.LEASH_TILES + this._leashBonus;
        const giveUp = this.GIVE_UP_MS + this._giveUpBonus;
        if (distTiles > leash || this.timeSinceHitPlayer > giveUp) {
            this._deaggroTimer += delta;
            if (this._deaggroTimer >= this._deaggroDelay) {
                this.hostile = false;
                this._clearCombatMove();
                this._beginIdle();
                // Fresh stagger next fight
                this._deaggroDelay = Phaser.Math.Between(200, 2200);
                this._leashBonus = Phaser.Math.FloatBetween(0, 2);
                this._giveUpBonus = Phaser.Math.Between(0, 2500);
                return true;
            }
        } else {
            this._deaggroTimer = 0;
        }
        return false;
    }

    update(delta) {
        const mob = this.mob;
        if (!mob?.active || mob.isBodyDead?.()) return;

        // LivingMob.update already built capacities for this frame
        if (!mob.capacities) mob.capacities = new Capacities(mob.anatomy);

        if (mob.isIncapacitated?.()) {
            this._clearCombatMove();
            mob.setVelocity(0, 0);
            return;
        }

        const immobilized = mob.capacities.isImmobile();

        if (!this.hostile) {
            this._clearCombatMove();
            if (immobilized) {
                mob.setVelocity(0, 0);
                return;
            }
            super.update(delta);
            return;
        }

        const player = mob.scene.player;
        if (!player || player.isBodyDead?.()) {
            this.hostile = false;
            this._clearCombatMove();
            this._beginIdle();
            return;
        }

        const ts = mob.scene.tileSize || 16;
        const distTiles = Math.hypot(
            (mob.x - player.x) / ts,
            (mob.y - player.y) / ts
        );

        this.timeSinceHitPlayer += delta;
        if (this._tryGiveUp(distTiles, delta)) return;

        if (immobilized) {
            this._clearCombatMove();
            mob.setVelocity(0, 0);
            return;
        }

        const mc = typeof mob.bodyCenter === "function"
            ? mob.bodyCenter()
            : { x: mob.x, y: mob.y };
        const pc = typeof player.bodyCenter === "function"
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

        const slots = this._slots();
        const releaseR = slots?.releaseRadius(reach) ?? 72;

        // Claim for the whole leash-in ring (not only when already on top of the player)
        // so approach aims at an orbit point instead of ramming the body center.
        if (distPlayer > releaseR) {
            this._releaseSlot();
            this._slotHold = false;
        } else if (slots) {
            this._reshuffleTimer -= delta;
            if (!this._slotClaim) {
                this._slotClaim = slots.claim(mob, reach);
                this._reshuffleTimer = this.RESHUFFLE_MS;
            } else if (this._reshuffleTimer <= 0) {
                this._slotClaim = slots.reshuffle(mob, reach) || slots.findClaim(mob);
                this._reshuffleTimer = this.RESHUFFLE_MS;
            } else {
                // Keep queueIndex fresh after promotions in front
                this._slotClaim = slots.findClaim(mob) || this._slotClaim;
            }
        }

        if (inReach) this._meleeHold = true;
        else if (edgeDist > reach + this.MELEE_RESUME_PAD) this._meleeHold = false;

        // Only primary ring (queueIndex 0) swings; queue waits for a spot
        const isPrimary = !this._slotClaim || this._slotClaim.queueIndex === 0;
        // Same gate as the player: tryMeleeAttack refuses while attackTimer > 0
        // (duration from meleeAttackDurationMs). No extra AI cooldown on top.
        if (
            isPrimary &&
            !swinging &&
            atk &&
            inReach &&
            mob.capacities.canManipulate?.()
        ) {
            mob.tryMeleeAttack?.(player, atk);
        }

        const base = Number(mob.def?.speed) || Number(player.speed) || 3.5;
        const sprintFactor = Number(mob.def?.sprintFactor) || Number(player.sprintFactor) || 1.5;
        const livingLegs = mob.anatomy?.livingLegs?.() ?? 2;
        const legsNeeded = mob.capacities?.isQuadrupedHoofed?.() ? 3 : 2;
        const moveMul = Math.max(0.05, Math.min(1.5, mob.capacities.moving()));
        const terrain = mob.scene.terrainSpeedMult?.(mob.x, mob.y - 1) ?? 1;
        const walk = base * ts * moveMul * terrain;

        let tx = pc.x;
        let ty = pc.y;
        let distAnchor = distPlayer;
        let hasAnchor = false;
        if (this._slotClaim && slots) {
            const anchor = slots.anchor(
                this._slotClaim.slotIndex,
                this._slotClaim.queueIndex,
                reach
            );
            if (anchor) {
                tx = anchor.x;
                ty = anchor.y;
                distAnchor = Math.hypot(anchor.x - mc.x, anchor.y - mc.y);
                hasAnchor = true;
                if (distAnchor <= this.ANCHOR_ARRIVE) this._slotHold = true;
                else if (distAnchor > this.ANCHOR_RESUME) this._slotHold = false;
            }
        } else {
            this._slotHold = false;
        }

        // Primaries only plant in fist range (slots are spacing, not a stop-out-of-range).
        // Queue holds at their waiting mark until promoted.
        // If a primary reached the orbit but still can't hit, step in toward the player.
        if (isPrimary && hasAnchor && this._slotHold && !this._meleeHold) {
            tx = pc.x;
            ty = pc.y;
            this._slotHold = false;
        }

        const plant =
            (isPrimary && this._meleeHold) ||
            (!isPrimary && hasAnchor && this._slotHold);

        if (plant) {
            mob.isSprinting = false;
            mob.setVelocity(0, 0);
            mob.anims.timeScale = 1;
            if (!swinging) mob.playAnim?.(`idle-${mob.facing}`);
            return;
        }

        const dx = tx - mc.x;
        const dy = ty - mc.y;
        const len = Math.hypot(dx, dy) || 1;
        let nx = dx / len;
        let ny = dy / len;

        // Skirt static things (trees/rocks) instead of bee-lining into trunks
        const steered = this._steerAroundObstacles(mob, nx, ny, delta);
        nx = steered.nx;
        ny = steered.ny;

        // Sprint until near the slot; ease to walk on final approach
        const slotR = slots?.radiusFor(reach) ?? 10;
        const nearSlot = hasAnchor && distAnchor <= Math.max(slotR, this.ANCHOR_RESUME);
        const canSprint = livingLegs >= legsNeeded && !swinging && !nearSlot;
        mob.isSprinting = canSprint;
        const speed = walk * (canSprint ? sprintFactor : 1);
        mob.setVelocity(nx * speed, ny * speed);
        // Same rule as player/Doofus: walk anim authored for ~human walk speed
        const ref = Number(this.mob.scene.getMob?.("human")?.speed) || 3.5;
        const tilesPerSec = speed / ts;
        mob.anims.timeScale = Phaser.Math.Clamp(tilesPerSec / ref, 0.2, 2.5);
        if (!swinging) mob.playAnim?.(`walk-${mob.facing}`);
    }

    /**
     * Short multi-probe steering around nearby `_things`. Prefers a sticky side so
     * packs don't flicker left/right every frame on the same trunk.
     */
    _steerAroundObstacles(mob, nx, ny, delta = 16) {
        // Prefer physics contact — free when clear, skip world scan
        const touching = this._blockedInDir(mob.body, nx, ny);
        const needAvoid = touching || this._probeBlocked(mob, nx, ny);

        if (!needAvoid) {
            this._stuckMs = 0;
            return { nx, ny };
        }

        const side = this._avoidSide || 1;
        // Fewer angles: physics already separates; probes only pick a slide
        const angles = [0.55, 1.1, 1.65].flatMap((a) => [a * side, -a * side]);
        for (const ang of angles) {
            const c = Math.cos(ang);
            const s = Math.sin(ang);
            const rx = nx * c - ny * s;
            const ry = nx * s + ny * c;
            const len = Math.hypot(rx, ry) || 1;
            const sx = rx / len;
            const sy = ry / len;
            if (!this._blockedInDir(mob.body, sx, sy) && !this._probeBlocked(mob, sx, sy)) {
                this._avoidSide = Math.sign(ang) || side;
                this._stuckMs = 0;
                return { nx: sx, ny: sy };
            }
        }

        // Axis slides as last resort
        if (Math.abs(nx) >= Math.abs(ny)) {
            if (!this._probeBlocked(mob, Math.sign(nx) || 1, 0)) {
                return { nx: Math.sign(nx) || 1, ny: 0 };
            }
            if (!this._probeBlocked(mob, 0, this._avoidSide)) {
                return { nx: 0, ny: this._avoidSide };
            }
        } else {
            if (!this._probeBlocked(mob, 0, Math.sign(ny) || 1)) {
                return { nx: 0, ny: Math.sign(ny) || 1 };
            }
            if (!this._probeBlocked(mob, this._avoidSide, 0)) {
                return { nx: this._avoidSide, ny: 0 };
            }
        }

        // Truly stuck: flip preferred side and shove sideways briefly
        this._stuckMs += delta;
        if (this._stuckMs > 280) {
            this._avoidSide *= -1;
            this._stuckMs = 0;
            return { nx: this._avoidSide, ny: this._avoidSide * 0.35 };
        }
        return { nx, ny };
    }

    _blockedInDir(body, nx, ny) {
        if (!body) return false;
        const b = body.blocked;
        const t = body.touching;
        if (nx < -0.25 && (b.left || t.left)) return true;
        if (nx > 0.25 && (b.right || t.right)) return true;
        if (ny < -0.25 && (b.up || t.up)) return true;
        if (ny > 0.25 && (b.down || t.down)) return true;
        return false;
    }

    /** True if a short step along (nx,ny) overlaps a nearby static thing body. */
    _probeBlocked(mob, nx, ny) {
        const scene = mob.scene;
        const body = mob.body;
        if (!body || !scene?._things) return false;

        const probeDist = Math.max(8, (mob.hitboxSize || 8) * 1.25);
        const half = Math.max(2, (mob.hitboxSize || 8) * 0.4);
        const ax = body.center.x + nx * probeDist;
        const ay = body.center.y + ny * probeDist;
        const left = ax - half;
        const right = ax + half;
        const top = ay - half;
        const bottom = ay + half;
        // Broad-phase: ignore trunks far from the probe (full-world scan was a fight spike)
        const cull = 28;

        const things = scene._things.getChildren();
        for (let i = 0; i < things.length; i++) {
            const t = things[i];
            const tb = t?.body;
            if (!tb || !tb.enable) continue;
            const tcx = (tb.left + tb.right) * 0.5;
            const tcy = (tb.top + tb.bottom) * 0.5;
            if (Math.abs(tcx - ax) > cull || Math.abs(tcy - ay) > cull) continue;
            if (right > tb.left && left < tb.right && bottom > tb.top && top < tb.bottom) {
                return true;
            }
        }
        return false;
    }

    _distToHurtbox(ax, ay, target) {
        const box = typeof target.hurtbox === "function" ? target.hurtbox(0) : null;
        if (!box) {
            const pc = typeof target.bodyCenter === "function"
                ? target.bodyCenter()
                : { x: target.x, y: target.y };
            return Math.max(0, Math.hypot(pc.x - ax, pc.y - ay) - 8);
        }
        const cx = Phaser.Math.Clamp(ax, box.left, box.right);
        const cy = Phaser.Math.Clamp(ay, box.top, box.bottom);
        return Math.hypot(ax - cx, ay - cy);
    }
}

/**
 * Always-hostile aggressive: same combat as neutral, but aggroes on sight.
 */
class AggressiveAnimalAI extends NeutralAnimalAI {
    constructor(mob) {
        super(mob);
        this.SIGHT_TILES = 8;
    }

    update(delta) {
        if (!this.hostile) this._trySightAggro();
        super.update(delta);
    }

    _trySightAggro() {
        const mob = this.mob;
        if (!mob?.active || mob.isBodyDead?.()) return;
        if (mob.isIncapacitated?.() || mob.isImmobile?.()) return;
        const player = mob.scene?.player;
        if (!player || player.isBodyDead?.()) return;
        const ts = mob.scene.tileSize || 16;
        const distTiles = Math.hypot(
            (mob.x - player.x) / ts,
            (mob.y - player.y) / ts
        );
        const sight = this.SIGHT_TILES + (this._leashBonus || 0) * 0.25;
        if (distTiles > sight) return;
        this.hostile = true;
        this.timeSinceHitPlayer = 0;
        this._deaggroTimer = 0;
        this._atkCache = null;
        this._atkCacheMs = 0;
    }
}

/** AI id → constructor */
const MobAI = {
    doofus: DoofusAI,
    scaredAnimal: ScaredAnimalAI,
    neutralAnimal: NeutralAnimalAI,
    aggressiveAnimal: AggressiveAnimalAI,
    // aliases
    animal: ScaredAnimalAI
};
