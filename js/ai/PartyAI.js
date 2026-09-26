/**
 * Client party pawn state and pathing.
 * SimWorld owns follow, combat, and settler jobs. This object keeps the
 * fields the HUD writes, plus the walk helpers the controlled pawn uses
 * on the way to a bed.
 */
class PartyAI {
    constructor(pawn) {
        this.pawn = pawn;
        this.assistTarget = null;
        this.eatSeek = null;
        this.tendSeek = null;
        this._settlerAct = null;
        this._meleeHold = false;
        this._avoidSide = Math.random() < 0.5 ? -1 : 1;
        this._stuckMs = 0;
        this._jamMs = 0;
        this._stillMs = 0;
        this._heldSlide = null;
        this._jamPx = null;
        this._jamPy = null;
        this._lastPx = null;
        this._lastPy = null;
        this._escapeKey = null;
        this._path = null;
        this._pathGoalX = null;
        this._pathGoalY = null;
        this._pathRange = null;
        this._planAt = 0;
        this._pathOpenRadius = null;
        this._holdFollow = true;
    }

    /** Uncontrolled pawns are puppets. Pathing is called directly. */
    update() {}

    clearCombat() {
        this.assistTarget = null;
        this._clearCombatMove();
        this.eatSeek = null;
        this.tendSeek = null;
    }

    /** Drop leftover work state so a newly adopted companion can follow. */
    stopWork() {
        const pawn = this.pawn;
        const scene = pawn?.scene;
        this.clearCombat();
        this._settlerAct = null;
        if (pawn) pawn._settlerAct = null;
        this._clearAvoid();
        scene?._cancelPawnChannels?.(pawn);
        pawn?._cancelSkin?.();
        pawn?._cancelFlesh?.();
        pawn?._cancelBrain?.();
        if (pawn?.isAttacking?.()) pawn._endAttack?.();
        pawn?._clearChopBar?.();
        this._halt(pawn);
    }

    _clearCombatMove() {
        this._meleeHold = false;
        const pawn = this.pawn;
        if (pawn) pawn.isSprinting = false;
    }
    setAssist(target) {
        if (target && target !== this.assistTarget) {
            this._clearAvoid();
        }
        this.assistTarget = target && !target.isBodyDead?.() ? target : null;
        if (!this.assistTarget) this._clearCombatMove();
    }
    setEatSeek(target) {
        this.eatSeek = target && !target.isBodyDead?.() ? target : null;
    }
    setTendSeek(target) {
        this.tendSeek = target && !target.isBodyDead?.() ? target : null;
    }
    _clearAvoid() {
        this._stuckMs = 0;
        this._jamMs = 0;
        this._stillMs = 0;
        this._jamPx = null;
        this._jamPy = null;
        this._escapeKey = null;
        this._path = null;
        this._pathGoalX = null;
        this._pathGoalY = null;
        this._pathOpenRadius = null;
        this._lastPx = null;
        this._lastPy = null;
        this._lastWpDist = null;
        this._slideAt = 0;
        this._planAt = 0;
        this._heldSlide = null;
        this._unstuckAt = 0;
    }
    _isSettler() {
        const p = this.pawn;
        return !!(p && (p.role === "settler" || p.homeSettlementId));
    }
    _poseBlocked(pawn, x, y, pad) {
        if (pawn?.body && typeof pawnPoseBlocked === "function") {
            return pawnPoseBlocked(pawn, x, y, pad);
        }
        const pose = pawn?.scene?.poseBlocked;
        if (typeof pose === "function") return !!pose(pawn, x, y, pad);
        return false;
    }
    _stuckClockDt(pawn, delta) {
        const wall = Number(pawn?.scene?.game?.loop?.delta);
        if (wall > 0) return wall;
        const d = Number(delta);
        return d > 0 ? d : 16;
    }

    /** Phaser body when the pawn has one; otherwise the sim's poseBlocked. */
    _nudgeIfDue(pawn, overlap) {
        if (!pawn) return false;
        const embedded = !!overlap
            || (typeof pawnPoseBlocked === "function" && pawnPoseBlocked(pawn, pawn.x, pawn.y, 0));
        if (!embedded) return false;
        if (overlap && nudgePawnOutOfThing?.(pawn, overlap, true)) return true;
        const free = typeof findFreePawnPose === "function"
            ? findFreePawnPose(pawn, 80)
            : null;
        if (!free || Math.hypot(free.x - pawn.x, free.y - pawn.y) < 1) return false;
        teleportPawnPose?.(pawn, free.x, free.y);
        this._path = null;
        this._pathGoalX = null;
        this._pathGoalY = null;
        this._stuckMs = 0;
        this._stillMs = 0;
        this._jamMs = 0;
        return true;
    }
    _overlappingThing(mob) {
        if (typeof overlappingThingSprite === "function") {
            const hit = overlappingThingSprite(mob);
            if (hit) return hit;
        }
        const pose = mob?.scene?.poseBlocked;
        const tile = mob?.scene?.tileBlocked;
        if (typeof pose !== "function") return null;
        if (typeof tile === "function" && tile(mob.x, mob.y)) return null;
        if (pose(mob, mob.x, mob.y, 0, { sleepFootprint: false, sleepNav: false })) {
            return { sim: true };
        }
        return null;
    }

    _walkToward(pawn, tx, ty, ts, sprint, delta, opts) {
        const settler = this._isSettler();
        const now = pawn.scene?.time?.now || 0;
        let overlap = this._overlappingThing(pawn);
        if (this._nudgeIfDue(pawn, overlap)) overlap = this._overlappingThing(pawn);
        const from = { x: pawn.x, y: pawn.y };
        const blocked = (x, y) => this._poseBlocked(pawn, x, y, settler ? 2 : 1);
        const nav = typeof Path !== "undefined" ? Path : null;
        if (!nav?.steerToward) return;
        const cell = ts || 16;
        const destDistTiles = Math.hypot(tx - pawn.x, ty - pawn.y) / cell;
        let maxRange = this._pathRange || 12;
        let openRadius = (opts && Object.prototype.hasOwnProperty.call(opts, "openRadius"))
            ? opts.openRadius
            : this._pathOpenRadius;
        if (opts?.wade) {
            pawn._wadeWater = true;
            if (openRadius == null) openRadius = 0;
        }
        // Local window only — a long haul must not A* the whole 32-tile camp
        // every replan (that hitchs FPS when several settlers walk at once).
        const local = Math.min(16, Math.max(8, Math.ceil(destDistTiles) + 6));
        if (settler) {
            maxRange = local;
            if (openRadius == null) openRadius = 2;
        } else if (destDistTiles > maxRange) {
            maxRange = Math.max(maxRange, local);
            if (openRadius == null) openRadius = 2;
        }
        const to = { x: tx, y: ty };
        const farLook = settler || destDistTiles > 12;
        const allowReplan = !this._planAt || now - this._planAt >= 400;
        const stuckDt = this._stuckClockDt(pawn, delta);
        const steered = nav.steerToward({
            from,
            to,
            blocked,
            cellSize: ts || 16,
            side: this._avoidSide,
            path: this._path,
            pathGoal: this._pathGoalX != null ? { x: this._pathGoalX, y: this._pathGoalY } : null,
            stuckMs: this._stuckMs,
            lastFrom: this._lastPx != null ? { x: this._lastPx, y: this._lastPy } : null,
            lastWpDist: this._lastWpDist,
            maxRange,
            dt: stuckDt,
            stuckDt,
            overlapping: !!overlap,
            lookPx: farLook ? (ts || 16) * 2 : undefined,
            openRadius,
            allowReplan
        });
        this._path = steered.path;
        this._pathGoalX = steered.pathGoal ? steered.pathGoal.x : null;
        this._pathGoalY = steered.pathGoal ? steered.pathGoal.y : null;
        if (steered.replanned) this._planAt = now;
        this._avoidSide = steered.side;
        this._stuckMs = steered.stuckMs;
        this._lastPx = steered.lastFrom?.x;
        this._lastPy = steered.lastFrom?.y;
        this._lastWpDist = steered.lastWpDist;
        let nx = steered.nx;
        let ny = steered.ny;
        const step = this._jamPx != null
            ? Math.hypot(pawn.x - this._jamPx, pawn.y - this._jamPy)
            : 99;
        this._jamPx = pawn.x;
        this._jamPy = pawn.y;
        const minStep = Math.max(0.12, stuckDt * 0.025);
        if (step >= minStep) {
            this._stillMs = 0;
            this._jamMs = 0;
        } else if (!steered.arrived) {
            this._stillMs = (this._stillMs || 0) + stuckDt;
            this._jamMs = (this._jamMs || 0) + stuckDt;
        } else {
            this._stillMs = 0;
            this._jamMs = 0;
        }
        if (steered.arrived) {
            this._halt(pawn);
            return;
        }
        const look = 4;
        const poseHit = (px, py) => typeof pawnPoseBlocked === "function"
            && pawnPoseBlocked(pawn, px, py, 0);
        const shoreDx = this._shoreX != null ? pawn.x - this._shoreX : 0;
        const shoreDy = this._shoreY != null ? pawn.y - this._shoreY : 0;
        this._shoreX = pawn.x;
        this._shoreY = pawn.y;
        if (Math.abs(shoreDx) > 0.2 || Math.abs(shoreDy) > 0.2) {
            const prev = this._shorePrefer || {};
            this._shorePrefer = {
                x: Math.abs(shoreDx) > 0.2 ? Math.sign(shoreDx) : (prev.x || 0),
                y: Math.abs(shoreDy) > 0.2 ? Math.sign(shoreDy) : (prev.y || 0)
            };
        }
        const slid = nav.commitWallSlide?.(
            from, nx, ny, poseHit, { bank: this._bankSlide },
            { look, goal: to, cell: ts || 16, prefer: this._shorePrefer }
        );
        if (slid) {
            nx = slid.nx;
            ny = slid.ny;
            this._bankSlide = slid.bank;
            if (slid.bank) {
                this._heldSlide = null;
                this._bankTravel = (this._bankTravel || 0) + Math.hypot(shoreDx, shoreDy);
                const cell = ts || 16;
                if (!this._bankFlipped && this._bankTravel > cell * 12) {
                    slid.bank.dir *= -1;
                    if (slid.bank.axis === "y") ny = slid.bank.dir;
                    else nx = slid.bank.dir;
                    this._bankFlipped = true;
                    this._bankTravel = 0;
                }
            } else {
                this._bankTravel = 0;
                this._bankFlipped = false;
            }
        } else if (poseHit(pawn.x + nx * look, pawn.y + ny * look)) {
            this._bankSlide = null;
            this._bankTravel = 0;
            this._bankFlipped = false;
            const held = this._heldSlide;
            const heldOk = held && !poseHit(pawn.x + held.nx * look, pawn.y + held.ny * look);
            if (heldOk) {
                nx = held.nx;
                ny = held.ny;
            } else if (typeof slidePawnAroundThings === "function") {
                const slide = slidePawnAroundThings(
                    pawn, nx, ny, 6, false, this._avoidSide, false
                );
                if (slide) {
                    this._heldSlide = slide;
                    nx = slide.nx;
                    ny = slide.ny;
                } else {
                    nx = 0;
                    ny = 0;
                }
            } else {
                nx = 0;
                ny = 0;
            }
        } else {
            this._heldSlide = null;
            this._bankSlide = null;
            this._bankTravel = 0;
            this._bankFlipped = false;
        }
        if (!nx && !ny) {
            this._halt(pawn);
            return;
        }
        pawn.isSprinting = !!sprint && pawn.kc > 0 && !pawn.getEncumbrance?.().cannotSprint;
        this._applyWalk(pawn, nx, ny, pawn.isSprinting);
    }
    _walkBodyToward(pawn, tx, ty, ts, sprint, delta, opts) {
        const c = pawn.bodyCenter?.() || { x: pawn.x, y: pawn.y };
        this._walkToward(pawn, tx - (c.x - pawn.x), ty - (c.y - pawn.y), ts, sprint, delta, opts);
    }

    /**
     * Approach the stand with the same grid path as follow. Bee-line when the
     * line is clear; keep a short path when a tree/rock sits in the way.
     */
    _applyWalk(pawn, nx, ny, sprint) {
        const scene = pawn.scene;
        const getDef = (id) => scene?.getItem?.(id);
        const moved = typeof Carry !== "undefined" && Carry.humanMoveSpeed
            ? Carry.humanMoveSpeed(pawn, {
                getDef,
                wantSprint: sprint,
                attacking: !!pawn.isAttacking?.(),
                tileSize: scene.tileSize || 16,
                walkTiles: pawn.speed || 3.5,
                sprintFactor: pawn.sprintFactor || 1.5,
                equipSpeedMultiplier: pawn.equipSpeedMultiplier,
                strength: pawn.strength,
                strollMul: this._strollMul != null ? this._strollMul : 1,
                terrainMult: scene.terrainSpeedMult?.(pawn.x, pawn.y - 1) ?? 1
            })
            : null;
        const enc = pawn.getEncumbrance?.() || { speedMultiplier: 1 };
        const moveMul = Math.max(0.05, Math.min(1.5, pawn.capacities?.moving?.() || 1));
        let mul = 1;
        if (pawn._eatChannel || pawn._tendChannel || pawn._skinChannel
            || pawn._fleshChannel || pawn._brainChannel || pawn._craftChannel) mul *= 0.5;
        if (pawn.isAttacking?.()) mul *= 0.5;
        const speed = moved
            ? moved.speed
            : (pawn.speed || 3.5) *
            (scene.tileSize || 16) *
            (sprint ? pawn.sprintFactor || 1.5 : 1) *
            enc.speedMultiplier *
            (pawn.equipSpeedMultiplier || 1) *
            moveMul *
            mul *
            (this._strollMul != null ? this._strollMul : 1) *
            (scene.terrainSpeedMult?.(pawn.x, pawn.y - 1) ?? 1);
        if (moved) pawn.isSprinting = moved.sprinting;
        applyEntityVelocity?.(pawn, nx * speed, ny * speed, scene.game?.loop?.delta || 16, scene);
        const ax = Math.abs(nx);
        const ay = Math.abs(ny);
        if (ax > ay + 0.22) pawn.facing = nx > 0 ? "right" : "left";
        else if (ay > ax + 0.22) pawn.facing = ny > 0 ? "down" : "up";
        const tilesPerSec = speed / (scene.tileSize || 16);
        pawn.anims.timeScale = typeof Party !== "undefined" && Party.walkAnimTimeScale
            ? Party.walkAnimTimeScale(tilesPerSec)
            : (pawn.isSprinting ? 1.5 : 1);
        if (typeof PlayerLook !== "undefined") PlayerLook.play(pawn, pawn.facing, true);
        if (typeof applyCreatureSortDepth === "function") applyCreatureSortDepth(pawn);
        else pawn.setDepth(pawn.y | 0);
        pawn.syncFxRoot?.();
    }
    _playIdle(pawn) {
        pawn.anims.timeScale = 1;
        if (typeof PlayerLook !== "undefined") PlayerLook.play(pawn, pawn.facing, false);
        pawn.syncFxRoot?.();
    }
    _halt(pawn) {
        if (!pawn) return;
        pawn.setVelocity?.(0, 0);
        pawn.isSprinting = false;
        this._stuckMs = 0;
        this._jamMs = 0;
        this._stillMs = 0;
        this._heldSlide = null;
        this._playIdle(pawn);
    }
}
