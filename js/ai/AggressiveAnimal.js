/**
 * Neutral animal: wanders until damaged by the player (or a same-species packmate is),
 * then sprints in and plants when in fist range. Staggered give-up if far or idle too long.
 */
class NeutralAnimalAI extends DoofusAI {
    constructor(mob) {
        super(mob);
        this.hostile = false;
        this.timeSinceHitPlayer = 0;
        this.LEASH_TILES = 10;
        this.GIVE_UP_MS = 9000;
        this.MELEE_RESUME_PAD = 10;
        this._meleeHold = false;
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
        if (source && (source === this.mob.scene?.player || this.mob.scene?.party?.includes(source))) {
            this.hostile = true;
            this._combatTarget = source;
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

        const sys = this.mob.scene?.partySys;
        let player = sys?.duelTargetFor?.(mob);
        if (player?.role === "wanderer" || (typeof Party !== "undefined" && Party.sameFaction?.(mob, player))) {
            player = null;
        }
        player = player
            || sys?.nearestParty?.(mob.x, mob.y)
            || mob.scene.player;
        this._combatTarget = player;
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

        if (inReach) this._meleeHold = true;
        else if (edgeDist > reach + this.MELEE_RESUME_PAD) this._meleeHold = false;

        if (
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

        if (this._meleeHold || swinging) {
            mob.isSprinting = false;
            mob.setVelocity(0, 0);
            mob.anims.timeScale = 1;
            if (!swinging) mob.playAnim?.(`idle-${mob.facing}`);
            return;
        }

        const stand = typeof Party !== "undefined" && Party.duelStandPoint
            ? Party.duelStandPoint(mob, player, sys?._duelMap, {
                standPx: Math.max(10, reach)
            })
            : pc;
        const dx = stand.x - mc.x;
        const dy = stand.y - mc.y;
        const len = Math.hypot(dx, dy) || 1;
        let nx = dx / len;
        let ny = dy / len;
        const rep = typeof Party !== "undefined" && Party.duelRepulse
            ? Party.duelRepulse(mob, sys?._duelEntities)
            : null;
        if (rep && (rep.rx || rep.ry)) {
            nx += rep.rx * 0.7;
            ny += rep.ry * 0.7;
            const nlen = Math.hypot(nx, ny) || 1;
            nx /= nlen;
            ny /= nlen;
        }

        const overlap = typeof overlappingThingSprite === "function"
            ? overlappingThingSprite(mob)
            : null;
        if (overlap) nudgePawnOutOfThing?.(mob, overlap);

        const near = edgeDist <= Math.max(reach + 8, 14);
        if (!near) {
            const steered = this._steerAroundObstacles(mob, nx, ny, delta);
            nx = steered.nx;
            ny = steered.ny;
        } else {
            this._nav = null;
        }

        const canSprint = livingLegs >= legsNeeded && !swinging && !near;
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
     * Short sticky detour around nearby solids. Same Path as party/wanderers.
     * Bee-line until ~12px ahead is blocked; then keep a committed path.
     */
    _steerAroundObstacles(mob, nx, ny, delta = 16) {
        if (typeof Path === "undefined" || !Path.steerHeading) return { nx, ny };
        const overlapping = this._blockedInDir(mob.body, nx, ny)
            || this._probeBlocked(mob, nx, ny);
        const blocked = (x, y) => (typeof pawnPoseBlocked === "function"
            ? pawnPoseBlocked(mob, x, y, 1)
            : this._probeBlocked(mob, nx, ny));
        const steered = Path.steerHeading(
            { x: mob.x, y: mob.y },
            nx,
            ny,
            blocked,
            this._nav || { side: this._avoidSide },
            { dt: delta, rangeTiles: 6, cellSize: mob.scene?.tileSize || 16, overlapping }
        );
        this._nav = steered;
        this._avoidSide = steered.side;
        this._stuckMs = steered.stuckMs;
        return { nx: steered.nx, ny: steered.ny };
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
        let hit = false;
        if (typeof forThingsNearAabb === "function") {
            forThingsNearAabb(scene, left, right, top, bottom, (t) => {
                const tb = t?.body;
                if (!tb || !tb.enable) return false;
                if (right > tb.left && left < tb.right && bottom > tb.top && top < tb.bottom) {
                    hit = true;
                    return true;
                }
                return false;
            });
            return hit;
        }
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
 * Territorial aggressive: stares at nearby party pawns, then charges
 * when they step closer. Pack-alerts same-species neighbors on charge.
 */
class AggressiveAnimalAI extends NeutralAnimalAI {
    constructor(mob) {
        super(mob);
        this.STARE_TILES = 8;
        this.AGGRO_TILES = 4;
        this.staring = false;
        this._stareTarget = null;
    }

    onDamaged(source = null, opts = null) {
        super.onDamaged(source, opts);
        if (this.hostile) {
            this.staring = false;
            this._stareTarget = null;
        }
    }

    update(delta) {
        if (!this.hostile) this._tryNotice();
        if (this.staring && !this.hostile) {
            this._updateStare();
            return;
        }
        super.update(delta);
    }

    _findHuntTarget() {
        const mob = this.mob;
        const sys = mob.scene?.partySys;
        let player = sys?.nearestParty?.(mob.x, mob.y) || mob.scene?.player;
        if (!player || player.isBodyDead?.()) return null;
        if (player.role === "wanderer") return null;
        if (typeof Party !== "undefined" && Party.sameFaction?.(mob, player)) return null;
        return player;
    }

    _tryNotice() {
        this.staring = false;
        this._stareTarget = null;
        const mob = this.mob;
        if (!mob?.active || mob.isBodyDead?.()) return;
        if (mob.isIncapacitated?.() || mob.isImmobile?.()) return;
        const player = this._findHuntTarget();
        if (!player) return;
        const ts = mob.scene.tileSize || 16;
        const distTiles = Math.hypot(
            (mob.x - player.x) / ts,
            (mob.y - player.y) / ts
        );
        const stare = this.STARE_TILES + (this._leashBonus || 0) * 0.25;
        if (distTiles <= this.AGGRO_TILES) {
            this._goHostile(player);
            return;
        }
        if (distTiles <= stare) {
            this.staring = true;
            this._stareTarget = player;
        }
    }

    _goHostile(player) {
        if (this.hostile) return;
        this.hostile = true;
        this.staring = false;
        this._stareTarget = null;
        this._combatTarget = player;
        this.timeSinceHitPlayer = 0;
        this._deaggroTimer = 0;
        this._atkCache = null;
        this._atkCacheMs = 0;
        this.mob.alertNearbyMobs?.(player);
    }

    _updateStare() {
        const mob = this.mob;
        const player = this._stareTarget;
        this._clearCombatMove();
        if (!mob || !player) return;
        mob.setVelocity(0, 0);
        mob.isSprinting = false;
        mob.anims.timeScale = 1;
        const dx = player.x - mob.x;
        const dy = player.y - mob.y;
        if (Math.abs(dx) > Math.abs(dy)) mob.facing = dx > 0 ? "right" : "left";
        else if (dy !== 0) mob.facing = dy > 0 ? "down" : "up";
        mob.playAnim?.(`idle-${mob.facing}`);
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
