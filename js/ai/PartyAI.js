/**
 * Uncontrolled party member: follow the controlled pawn, or melee-assist.
 */
class PartyAI {
    constructor(pawn) {
        this.pawn = pawn;
        this.assistTarget = null;
        this._meleeHold = false;
        this._avoidSide = Math.random() < 0.5 ? -1 : 1;
        this._stuckMs = 0;
        this._jamMs = 0;
        this._stillMs = 0;
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
        this._atkCache = null;
        this._atkCacheMs = 0;
        this._holdFollow = true;
        this._prevFx = null;
        this._prevFy = null;
        this.eatSeek = null;
        this.tendSeek = null;
        this._workScanMs = Math.random() * 280;
        this._workScan = null;
        this._skipUntil = new Map();
        this.LEASH_TILES = (typeof Party !== "undefined" && Party.COMBAT_LEASH) || 10;
        this.MELEE_RESUME_PAD = 3;
    }

    clearCombat() {
        this.assistTarget = null;
        this._clearCombatMove();
        this.eatSeek = null;
        this.tendSeek = null;
    }

    /** Drop settlement work so a newly adopted companion can follow right away. */
    stopWork() {
        const pawn = this.pawn;
        const scene = pawn?.scene;
        this.clearCombat();
        this._workScan = null;
        this._workScanMs = 0;
        this._chopStand = null;
        this._chopStandKey = null;
        this._chopArrived = false;
        this._sidestepAt = 0;
        this._nearKey = null;
        this._nearLatched = false;
        this._approach = null;
        this._approachKey = null;
        this._haulDest = null;
        this._haulWhat = null;
        this._haulMergeOnly = false;
        this._haulMergeFrom = null;
        this._haulMergeId = null;
        this._settlerAct = null;
        this._path = null;
        this._pathGoalX = null;
        this._pathGoalY = null;
        this._idleWanderState = null;
        this._idleWanderDest = null;
        this._fireStand = null;
        this._fireStandKey = null;
        scene?._cancelPawnChannels?.(pawn);
        pawn?._cancelSkin?.();
        pawn?._cancelFlesh?.();
        pawn?._cancelBrain?.();
        if (pawn?.isAttacking?.()) pawn._endAttack?.();
        pawn?._clearChopBar?.();
        this._releaseWorkClaim();
        this._halt(pawn);
    }

    _clearCombatMove() {
        this._meleeHold = false;
        const pawn = this.pawn;
        if (pawn) pawn.isSprinting = false;
    }

    _pickBestWeapon() {
        const pawn = this.pawn;
        const scene = pawn?.scene;
        if (!pawn || typeof Party === "undefined") return;
        const getItem = (id) => scene.getItem?.(id);
        const slot = Party.bestMeleeSlot(pawn.inventory, getItem, pawn.hotbarIndex || 0);
        if (slot !== pawn.hotbarIndex) {
            pawn.hotbarIndex = slot;
            this._atkCache = null;
            this._atkCacheMs = 0;
        }
    }

    setAssist(target) {
        if (target && target !== this.assistTarget) {
            this._clearAvoid();
        }
        this.assistTarget = target && !target.isBodyDead?.() ? target : null;
        if (!this.assistTarget) this._clearCombatMove();
    }

    update(delta) {
        const pawn = this.pawn;
        const scene = pawn?.scene;
        if (!pawn?.active || pawn.isBodyDead?.() || scene?._gamePaused) {
            if (pawn?.isBodyDead?.()) this._releaseWorkClaim();
            pawn?.setVelocity?.(0, 0);
            return;
        }
        if (pawn.isControlled?.()) return;

        pawn.capacities = new Capacities(pawn.anatomy);
        pawn._refreshDownedState?.();
        if (pawn._bodyDead) {
            this._releaseWorkClaim();
            return;
        }

        if (pawn._resting) {
            this.setAssist(null);
            this._releaseWorkClaim();
            pawn.setVelocity(0, 0);
            if (typeof pinRestingCreature === "function") pinRestingCreature(pawn, scene);
            else {
                const spec = pawn.lastSleep;
                setCreatureRest?.(pawn, true, spec?.rot);
                pawn.syncSortDepth?.();
            }
            if (this._isSettler() && this._settlerShouldWake()) {
                scene._wakePawn?.(pawn, { manual: true });
            }
            if (pawn._resting) return;
        }

        if (pawn.isIncapacitated?.() || pawn.isImmobile?.() || pawn.isVomiting?.()) {
            this.setAssist(null);
            this.tendSeek = null;
            this._releaseWorkClaim();
            pawn.setVelocity(0, 0);
            if (pawn.body) pawn.body.moves = false;
            setCreatureProne?.(pawn, true);
            return;
        }
        if (pawn.body && !pawn._resting) pawn.body.moves = true;
        setCreatureProne?.(pawn, false);

        const controlled = scene?.player;
        const ts = scene?.tileSize || 16;

        if (pawn._restWalk) {
            this.setAssist(null);
            return;
        }

        this._clearWadeIfAshore();

        if (this._isSettler()) {
            const dedicated = !!(scene.isNet && scene.net?.connected && !scene.net.isLocal);
            if (dedicated) {
                pawn.setVelocity?.(0, 0);
                return;
            }
            this._tickSettler(delta, ts);
            return;
        }

        this._refreshAssist(scene, controlled, ts);
        if (this.assistTarget && !this.assistTarget.active) this.setAssist(null);
        if (this.assistTarget?.isBodyDead?.()) this.setAssist(null);

        if (this.assistTarget) {
            const ch = pawn._tendChannel;
            if (ch && !ch.corpse) pawn._cancelTend?.();
            this._tickCombat(delta, ts);
            return;
        }

        if (pawn._wokeFromRest) {
            if (scene.partySys?._shouldDelaySleep?.(pawn)) {
                if (this._shouldHoldForTend(pawn)) {
                    pawn.setVelocity(0, 0);
                    pawn.isSprinting = false;
                    this._playIdle(pawn);
                    return;
                }
            } else {
                scene._tryReturnToBed?.(pawn);
                return;
            }
        }

        if (this._shouldHoldForTend(pawn)) {
            pawn.setVelocity(0, 0);
            pawn.isSprinting = false;
            this._playIdle(pawn);
            return;
        }

        if (this._tickTendSeek(delta, ts)) return;

        if (this._tickEatSeek(delta, ts)) return;

        this._tickFollow(delta, ts, controlled);
    }

    setEatSeek(target) {
        this.eatSeek = target && !target.isBodyDead?.() ? target : null;
    }

    setTendSeek(target) {
        this.tendSeek = target && !target.isBodyDead?.() ? target : null;
    }

    _tickTendSeek(delta, ts) {
        const pawn = this.pawn;
        const target = this.tendSeek;
        if (!target || target.isBodyDead?.() || !target.active) {
            this.tendSeek = null;
            return false;
        }
        if (pawn._tendChannel && !pawn._tendChannel.corpse) {
            pawn.setVelocity(0, 0);
            pawn.isSprinting = false;
            this._playIdle(pawn);
            return true;
        }
        const P = typeof Party !== "undefined" ? Party : null;
        if (P?.inInteractRange?.(pawn, target, ts)) {
            pawn.setVelocity(0, 0);
            pawn.isSprinting = false;
            this._playIdle(pawn);
            return true;
        }
        const dist = Math.hypot((pawn.x || 0) - (target.x || 0), (pawn.y || 0) - (target.y || 0));
        const sprint = dist > ts * 6;
        this._walkToward(pawn, target.x, target.y, ts, sprint, delta);
        return true;
    }

    _tickEatSeek(delta, ts) {
        const pawn = this.pawn;
        const target = this.eatSeek;
        if (!target || target.isBodyDead?.() || target.active === false) {
            this.eatSeek = null;
            return false;
        }
        if (pawn._eatChannel) {
            pawn.setVelocity(0, 0);
            pawn.isSprinting = false;
            this._playIdle(pawn);
            return true;
        }
        if (this._isSettler()) {
            if (this._goToTarget(target, ts, delta)) return true;
            if ((this._stillMs || 0) >= 1400 || (this._jamMs || 0) >= 900) {
                this.eatSeek = null;
                this._halt(pawn);
                return false;
            }
            return true;
        }
        const P = typeof Party !== "undefined" ? Party : null;
        if (P?.inInteractRange?.(pawn, target, ts)) {
            pawn.setVelocity(0, 0);
            pawn.isSprinting = false;
            this._playIdle(pawn);
            return true;
        }
        const dist = Math.hypot((pawn.x || 0) - (target.x || 0), (pawn.y || 0) - (target.y || 0));
        const sprint = dist > ts * 6;
        this._walkToward(pawn, target.x, target.y, ts, sprint, delta);
        return true;
    }

    _shouldHoldForTend(pawn) {
        const ch = pawn._tendChannel;
        if (ch && !ch.corpse) return true;
        return !!pawn.scene?.partySys?._isTendTargeted?.(pawn)
            || !!pawn.scene?.partySys?._isBeingTended?.(pawn);
    }

    _refreshAssist(scene, controlled, ts) {
        const P = typeof Party !== "undefined" ? Party : null;
        const leash = P?.COMBAT_LEASH ?? 10;
        const pawn = this.pawn;
        const inLeash = (t) => {
            if (!t || t.isBodyDead?.()) return false;
            if (t.active === false) return false;
            if (!controlled || controlled.isBodyDead?.()) return false;
            const dCtrl = Math.hypot(
                (t.x - controlled.x) / ts,
                (t.y - controlled.y) / ts
            );
            const dSelf = Math.hypot(
                (t.x - pawn.x) / ts,
                (t.y - pawn.y) / ts
            );
            const oid = t.ownerId || t._remote?.ownerId;
            const pvp = !!(oid && scene.partySys?.pvpAggro?.has(oid));
            return pvp || dCtrl <= leash || dSelf <= 3;
        };

        const sys = scene?.partySys;
        let hunted = null;
        const now = scene?.time?.now || 0;
        if (sys?.lastHitMob && now - (sys.lastHitAt || 0) < 8000) {
            hunted = sys._resolveAssistTarget?.(sys.lastHitMob);
        }
        const next = sys?.duelTargetFor?.(this.pawn) || hunted;
        if (next && inLeash(next)) {
            if (next !== this.assistTarget) this.setAssist(next);
            return;
        }
        this.setAssist(null);
    }

    _tickFollow(delta, ts, controlled) {
        const pawn = this.pawn;
        const P = typeof Party !== "undefined" ? Party : null;

        if (!controlled || controlled.isBodyDead?.()) {
            pawn.setVelocity(0, 0);
            this._playIdle(pawn);
            pawn.scene?._tryInjuredRest?.(pawn);
            return;
        }

        const distPlayer = Math.hypot(pawn.x - controlled.x, pawn.y - controlled.y);
        const idleR = (P?.FOLLOW_IDLE ?? 2.6) * ts;
        const catchR = (P?.FOLLOW_CATCH ?? 4.8) * ts;
        const overlap = this._overlappingThing(pawn);
        this._nudgeIfDue(pawn, overlap);
        const jammedOnThing = !!this._overlappingThing(pawn) || this._anyArcadeHit(pawn.body);
        const closeEnough = distPlayer <= idleR
            || (this._holdFollow && distPlayer < catchR && !jammedOnThing)
            || (this._stuckMs > 280 && distPlayer < catchR && !jammedOnThing);

        if (closeEnough) {
            this._holdFollow = true;
            this._pathRange = null;
            this._pathOpenRadius = null;
            if (this._unstickFromMates(pawn, controlled, ts, idleR)) return;
            this._idleFollow(pawn);
            if (!this._leaderMoving(controlled)) pawn.scene?._tryInjuredRest?.(pawn);
            return;
        }
        this._holdFollow = false;

        const sprintCatch =
            (!!controlled.isSprinting && distPlayer > catchR)
            || distPlayer > ts * 6;
        this._walkToward(pawn, controlled.x, controlled.y, ts, sprintCatch, delta);
    }

    _leaderMoving(controlled) {
        const vx = controlled.body?.velocity?.x ?? controlled.vx ?? 0;
        const vy = controlled.body?.velocity?.y ?? controlled.vy ?? 0;
        if (Math.hypot(vx, vy) > 18) {
            this._prevFx = controlled.x;
            this._prevFy = controlled.y;
            return true;
        }
        const moved = this._prevFx != null
            && Math.hypot(controlled.x - this._prevFx, controlled.y - this._prevFy) > 0.7;
        this._prevFx = controlled.x;
        this._prevFy = controlled.y;
        return moved;
    }

    _idleFollow(pawn) {
        pawn.setVelocity(0, 0);
        pawn.isSprinting = false;
        this._playIdle(pawn);
        this._clearAvoid();
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
    }

    _separation(pawn, ts, wantTiles) {
        const scene = pawn.scene;
        let sx = 0;
        let sy = 0;
        const want = (wantTiles ?? (this.assistTarget ? 1.35 : 1.05)) * ts;
        const others = [
            ...(scene?.party || []),
            ...(scene?.settlers || [])
        ];
        for (const other of others) {
            if (!other || other === pawn) continue;
            if (typeof Party !== "undefined" && Party.walkThrough?.(other)) continue;
            if (other.isBodyDead?.()) continue;
            const dx = pawn.x - other.x;
            const dy = pawn.y - other.y;
            const d = Math.hypot(dx, dy);
            if (!(d > 0.01)) {
                const h = this._idHash(pawn.pawnId || pawn.x);
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

    /** Step aside if stacked on a mate, without walking away from the player. */
    _unstickFromMates(pawn, follow, ts, idleR) {
        if (this._overlappingThing(pawn)) return false;
        const sep = this._separation(pawn, ts, 0.5);
        const sl = Math.hypot(sep.sx, sep.sy);
        if (!(sl > 0.45)) return false;
        let wx = sep.sx / sl;
        let wy = sep.sy / sl;
        const fx = follow.x - pawn.x;
        const fy = follow.y - pawn.y;
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
        if (pawnPoseBlocked?.(pawn, pawn.x + wx * 10, pawn.y + wy * 10, 1)) return false;
        pawn.isSprinting = false;
        this._applyWalk(pawn, wx, wy, false);
        return true;
    }

    _nudgeIfDue(pawn, overlap) {
        if (!overlap || !pawn) return false;
        const now = pawn.scene?.time?.now || 0;
        if (now - (Number(pawn._nudgeAt) || 0) < 400) return false;
        pawn._nudgeAt = now;
        return !!nudgePawnOutOfThing?.(pawn, overlap);
    }

    _clearWadeIfAshore() {
        const pawn = this.pawn;
        if (!pawn?._wadeWater) return;
        const scene = pawn.scene;
        if (scene?._isWaterAt?.(pawn.x, pawn.y - 1) || scene?._isWaterAt?.(pawn.x, pawn.y)) return;
        pawn._wadeWater = false;
    }

    _walkToward(pawn, tx, ty, ts, sprint, delta, opts) {
        const settler = this._isSettler();
        const now = pawn.scene?.time?.now || 0;
        let overlap = this._overlappingThing(pawn);
        if (this._nudgeIfDue(pawn, overlap)) overlap = this._overlappingThing(pawn);
        const from = { x: pawn.x, y: pawn.y };
        const to = { x: tx, y: ty };
        const blocked = (x, y) => (typeof pawnPoseBlocked === "function"
            ? pawnPoseBlocked(pawn, x, y, settler ? 2 : 1)
            : false);
        const nav = typeof Path !== "undefined" ? Path : null;
        if (!nav?.steerToward) return;
        const destDistTiles = Math.hypot(tx - pawn.x, ty - pawn.y) / (ts || 16);
        let maxRange = this._pathRange || 12;
        let openRadius = (opts && Object.prototype.hasOwnProperty.call(opts, "openRadius"))
            ? opts.openRadius
            : this._pathOpenRadius;
        if (opts?.wade) {
            pawn._wadeWater = true;
            if (openRadius == null) openRadius = 0;
        }
        // Don't A* the whole camp for a two-tile stroll — that hitch is what
        // you feel when walking around while settlers are working.
        const local = Math.min(40, Math.max(8, Math.ceil(destDistTiles) + 6));
        if (settler) {
            maxRange = local;
            if (openRadius == null) openRadius = 2;
        } else if (destDistTiles > maxRange) {
            maxRange = Math.max(maxRange, local);
            if (openRadius == null) openRadius = 2;
        }
        const farLook = settler || destDistTiles > 12;
        const allowReplan = !this._planAt || now - this._planAt >= 220;
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
            dt: delta,
            overlapping: false,
            lookPx: farLook ? (ts || 16) * 4 : undefined,
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
        const dirBlocked = this._blockedInDir(pawn.body, nx, ny);
        const snagged = !!overlap || dirBlocked || this._anyArcadeHit(pawn.body);
        const step = this._jamPx != null
            ? Math.hypot(pawn.x - this._jamPx, pawn.y - this._jamPy)
            : 99;
        this._jamPx = pawn.x;
        this._jamPy = pawn.y;
        if (snagged && step < 0.55) {
            this._stillMs = (this._stillMs || 0) + (delta || 16);
            this._jamMs = (this._jamMs || 0) + (delta || 16);
        } else if (!snagged) {
            this._stillMs = 0;
            this._jamMs = 0;
        } else {
            this._stillMs = (this._stillMs || 0) + (delta || 16) * 0.6;
            this._jamMs = (this._jamMs || 0) + (delta || 16);
        }
        if (typeof slidePawnAroundThings === "function" && snagged && this._stillMs > 120) {
            const commit = now - (this._slideAt || 0) > 280;
            const slide = slidePawnAroundThings(
                pawn, nx, ny, settler ? 8 : 6,
                commit && this._stillMs > 400,
                this._avoidSide,
                commit
            );
            if (slide) {
                nx = slide.nx;
                ny = slide.ny;
                if (commit) this._slideAt = now;
            }
        }
        if (snagged && this._stillMs > 900) {
            const nowUnstick = pawn.scene?.time?.now || 0;
            if (nowUnstick - (this._unstuckAt || 0) > 1600) {
                this._unstuckAt = nowUnstick;
                const free = typeof findFreePawnPose === "function"
                    ? findFreePawnPose(pawn, 48)
                    : null;
                if (free && Math.hypot(free.x - pawn.x, free.y - pawn.y) > 2) {
                    teleportPawnPose?.(pawn, free.x, free.y);
                    this._stillMs = 0;
                    this._jamMs = 0;
                    this._path = null;
                    this._pathGoalX = null;
                    this._pathGoalY = null;
                    return;
                }
            }
        }
        if (steered.arrived) {
            this._halt(pawn);
            return;
        }
        if (!this._path || !this._path.length) {
            if (!(settler && this._anyArcadeHit(pawn.body))) {
                const sep = this._separation(pawn, ts);
                const sl = Math.hypot(sep.sx, sep.sy);
                if (sl > 0.15) {
                    nx += (sep.sx / sl) * 0.35;
                    ny += (sep.sy / sl) * 0.35;
                    const nlen = Math.hypot(nx, ny) || 1;
                    nx /= nlen;
                    ny /= nlen;
                }
            }
        }
        pawn.isSprinting = !!sprint && pawn.kc > 0 && !pawn.getEncumbrance?.().cannotSprint;
        this._applyWalk(pawn, nx, ny, pawn.isSprinting);
    }

    _anyArcadeHit(body) {
        if (!body) return false;
        const b = body.blocked;
        const t = body.touching;
        return !!(b?.left || b?.right || b?.up || b?.down
            || t?.left || t?.right || t?.up || t?.down);
    }

    _arcadeJammed(body) {
        if (!body) return false;
        const b = body.blocked;
        const t = body.touching;
        const xHit = !!(b?.left || b?.right || t?.left || t?.right);
        const yHit = !!(b?.up || b?.down || t?.up || t?.down);
        return xHit && yHit;
    }

    _blockedInDir(body, nx, ny) {
        if (!body) return false;
        const b = body.blocked;
        const t = body.touching;
        if (nx < -0.25 && (b?.left || t?.left)) return true;
        if (nx > 0.25 && (b?.right || t?.right)) return true;
        if (ny < -0.25 && (b?.up || t?.up)) return true;
        if (ny > 0.25 && (b?.down || t?.down)) return true;
        return false;
    }

    _tickCombat(delta, ts) {
        const pawn = this.pawn;
        const target = this.assistTarget;
        if (!target) return;

        this._pickBestWeapon();

        const mc = pawn.bodyCenter?.() || { x: pawn.x, y: pawn.y };
        const pc = target.bodyCenter?.() || { x: target.x, y: target.y };
        const toX = pc.x - mc.x;
        const toY = pc.y - mc.y;
        const distT = Math.hypot(toX, toY) || 1;
        const fnx = toX / distT;
        const fny = toY / distT;
        if (Math.abs(fnx) > Math.abs(fny)) pawn.facing = fnx > 0 ? "right" : "left";
        else pawn.facing = fny > 0 ? "down" : "up";

        this._atkCacheMs -= delta;
        if (!this._atkCache || this._atkCacheMs <= 0) {
            this._atkCache = BodyCombat.pickAttack(pawn);
            this._atkCacheMs = 250;
        }
        const atk = this._atkCache;
        const reach = atk?.range || 4;
        const swinging = !!pawn.isAttacking?.();
        const aim = Math.atan2(toY, toX);
        const edgeDist = this._distToHurtbox(mc.x, mc.y, target);
        const inReach = edgeDist <= reach;
        const canLand = inReach && this._canLandMelee(mc, target, reach, aim, atk);

        const sys = pawn.scene?.partySys;
        const stand = typeof Party !== "undefined" && Party.duelStandPoint
            ? Party.duelStandPoint(pawn, target, sys?._duelMap, {
                standPx: Math.max(16, reach + 6),
                occupy: pawn.scene?.player,
                entities: sys?._duelEntities
            })
            : { x: pc.x, y: pc.y, flanking: false };
        if (canLand) this._meleeHold = true;
        else if (edgeDist > reach + this.MELEE_RESUME_PAD) this._meleeHold = false;

        if (
            !swinging &&
            atk &&
            canLand &&
            pawn.capacities?.canManipulate?.()
        ) {
            pawn.tryMeleeAttack?.(target, atk);
        }

        if (this._meleeHold || swinging) {
            pawn.isSprinting = false;
            pawn.setVelocity(0, 0);
            if (!swinging) this._playIdle(pawn);
            return;
        }

        const sprint = distT > ts * 2 && pawn.kc > 0;
        this._walkCombatToward(pawn, stand.x, stand.y, ts, sprint, delta);
    }

    _distToHurtbox(x, y, target) {
        if (typeof MeleeMath !== "undefined" && MeleeMath.meleeEdgeDist) {
            return MeleeMath.meleeEdgeDist(x, y, target);
        }
        const box = typeof target?.hurtbox === "function" ? target.hurtbox(0) : null;
        if (!box) {
            const c = target?.bodyCenter?.() || { x: target?.x, y: target?.y };
            const hs = Number(target?.hitboxSize) || 8;
            return Math.max(0, Math.hypot(c.x - x, c.y - y) - hs * 0.5);
        }
        const cx = Math.max(box.left, Math.min(box.right, x));
        const cy = Math.max(box.top, Math.min(box.bottom, y));
        return Math.hypot(x - cx, y - cy);
    }

    _canLandMelee(mc, target, reach, angle, atk) {
        const hit = typeof MeleeMath !== "undefined" && MeleeMath.meleeSwingWouldHit
            ? MeleeMath.meleeSwingWouldHit
            : (typeof meleeSwingWouldHit === "function" ? meleeSwingWouldHit : null);
        if (hit) {
            return hit(mc.x, mc.y, angle, reach, target, {
                radius: atk?.unarmed === false ? 3 : 4
            });
        }
        return this._distToHurtbox(mc.x, mc.y, target) <= reach;
    }

    /** Walk so the body center (not feet origin) approaches tx, ty. */
    _walkBodyToward(pawn, tx, ty, ts, sprint, delta) {
        const c = pawn.bodyCenter?.() || { x: pawn.x, y: pawn.y };
        this._walkToward(pawn, tx - (c.x - pawn.x), ty - (c.y - pawn.y), ts, sprint, delta);
    }

    /**
     * Approach the stand with the same grid path as follow. Bee-line when the
     * line is clear; keep a short path when a tree/rock sits in the way.
     */
    _walkCombatToward(pawn, tx, ty, ts, sprint, delta) {
        this._pathRange = 16;
        this._pathOpenRadius = 2;
        this._walkBodyToward(pawn, tx, ty, ts, sprint, delta);
        this._pathOpenRadius = null;
    }

    _applyWalk(pawn, nx, ny, sprint) {
        const scene = pawn.scene;
        const enc = pawn.getEncumbrance?.() || { speedMultiplier: 1 };
        const moveMul = Math.max(0.05, Math.min(1.5, pawn.capacities?.moving?.() || 1));
        let mul = 1;
        if (pawn._eatChannel || pawn._tendChannel || pawn._skinChannel
            || pawn._fleshChannel || pawn._brainChannel || pawn._craftChannel) mul *= 0.5;
        if (pawn.isAttacking?.()) mul *= 0.5;
        const speed =
            (pawn.speed || 3.5) *
            (scene.tileSize || 16) *
            (sprint ? pawn.sprintFactor || 1.5 : 1) *
            enc.speedMultiplier *
            (pawn.equipSpeedMultiplier || 1) *
            moveMul *
            mul *
            (this._strollMul != null ? this._strollMul : 1) *
            (scene.terrainSpeedMult?.(pawn.x, pawn.y - 1) ?? 1);
        applyEntityVelocity?.(pawn, nx * speed, ny * speed, scene.game?.loop?.delta || 16, scene);
        if (Math.abs(nx) > Math.abs(ny)) pawn.facing = nx > 0 ? "right" : "left";
        else if (ny !== 0) pawn.facing = ny > 0 ? "down" : "up";
        const tilesPerSec = speed / (scene.tileSize || 16);
        pawn.anims.timeScale = typeof Party !== "undefined" && Party.walkAnimTimeScale
            ? Party.walkAnimTimeScale(tilesPerSec)
            : (sprint ? 1.5 : 1);
        if (typeof PlayerLook !== "undefined") PlayerLook.play(pawn, pawn.facing, true);
        pawn.setDepth(pawn.y | 0);
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
        this._playIdle(pawn);
    }

    _isSettler() {
        const p = this.pawn;
        return !!(p && (p.role === "settler" || p.homeSettlementId));
    }

    _settlerShouldWake() {
        const pawn = this.pawn;
        const scene = pawn?.scene;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const night = S ? S.isNight(scene?.gameMinutes) : false;
        const injured = typeof Sleep !== "undefined" && Sleep.injuredForAutofill
            ? Sleep.injuredForAutofill(pawn.anatomy)
            : false;
        return S ? !S.settlerShouldSleep(night, injured) : (!night && !injured);
    }

    _settlement() {
        const scene = this.pawn?.scene;
        const id = this.pawn?.homeSettlementId;
        return scene?.settlementSys?.byId?.(id) || null;
    }

    _workerId() {
        return this.pawn?.pawnId || this.pawn?.id || null;
    }

    _claims(settle) {
        return this.pawn?.scene?.settlementSys?.workClaims?.(settle) || null;
    }

    _myClaim(settle) {
        const id = this._workerId();
        const c = this._claims(settle);
        return (id && c?.held?.(id)) || null;
    }

    _claimedByOther(settle, key) {
        if (!key) return false;
        const who = this._claims(settle)?.claimedBy?.(key);
        const id = this._workerId();
        return !!(who && id && who !== id);
    }

    _stationKey(spr) {
        const uid = spr?.entry?.uid || spr?.uid;
        return uid ? `station:${uid}` : null;
    }

    _thingKey(t) {
        if (!t) return null;
        const uid = t.entry?.uid || t.uid;
        if (uid) return `thing:${uid}`;
        const id = t.entry?.id || t.meta?.id || "";
        return `thing:${Math.round(Number(t.x) || 0)}:${Math.round(Number(t.y) || 0)}:${id}`;
    }

    _dropKey(d) {
        if (!d) return null;
        const uid = d.uid || d.entry?.uid;
        if (uid) return `drop:${uid}`;
        const id = d.item?.id || d.id || "";
        return `drop:${Math.round(d.x || 0)}:${Math.round(d.y || 0)}:${id}`;
    }

    _pawnWorkKey(p, kind) {
        const id = p?.pawnId || p?.id;
        return id ? `${kind}:${id}` : null;
    }

    _bedKey(bed) {
        const uid = bed?.entry?.uid;
        if (!uid) return null;
        return `bed:${uid}:${bed.slot ?? 0}`;
    }

    _leatherJobKey(job) {
        if (!job) return null;
        if (job.drop) return this._dropKey(job.drop);
        if (job.station) return this._stationKey(job.station);
        return this._stationKey(job);
    }

    _planClaimKey(plan) {
        if (!plan) return null;
        const t = plan.type;
        if (t === "cook" || t === "cook_light") {
            return this._stationKey(plan.target?.fire || plan.target);
        }
        if (t === "leather") return this._leatherJobKey(plan.target);
        if (t === "gather" || t === "chop") return this._thingKey(plan.target);
        if (t === "haul") {
            if (plan.target?.claimKey) return plan.target.claimKey;
            const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
            if (plan.target?.kind && SF?.mergeClaimKey) return SF.mergeClaimKey(plan.target);
            return this._dropKey(plan.target);
        }
        if (t === "doctor") return this._pawnWorkKey(plan.target, "tend");
        if (t === "sleep") return this._bedKey(plan.target);
        return null;
    }

    _adoptClaim(settle, key) {
        const id = this._workerId();
        const sys = this.pawn?.scene?.settlementSys;
        if (!id || !sys) return true;
        if (this._claimSettleId && settle?.id && this._claimSettleId !== settle.id) {
            sys.releaseWork(id, this._claimSettleId);
        }
        if (!settle?.id || !key) {
            if (this._claimSettleId) sys.releaseWork(id, this._claimSettleId);
            this._claimSettleId = null;
            return true;
        }
        const c = sys.workClaims(settle);
        if (!c) return true;
        if (!c.claim(key, id)) {
            sys.releaseWork(id, settle.id);
            this._claimSettleId = null;
            return false;
        }
        this._claimSettleId = settle.id;
        return true;
    }

    _lockWork(settle, plan) {
        const key = this._planClaimKey(plan);
        if (!key) return this._adoptClaim(settle, null);
        if (this._claimedByOther(settle, key)) return false;
        return this._adoptClaim(settle, key);
    }

    _voidPlanTarget(scan, plan) {
        if (!scan || !plan) return;
        const t = plan.type;
        if (t === "haul") {
            scan.haulDrop = null;
            scan.haulMerge = null;
        }
        else if (t === "gather") scan.gatherThing = null;
        else if (t === "chop") scan.chopTree = null;
        else if (t === "leather") scan.leatherWork = null;
        else if (t === "cook") scan.cookBill = null;
        else if (t === "cook_light") scan.unlitFire = null;
        else if (t === "sleep") scan.bed = null;
        else if (t === "doctor") {
            const p = plan.target;
            scan.patients = (scan.patients || []).filter((x) => x !== p);
        }
    }

    _releaseWorkClaim() {
        const id = this._workerId();
        const sid = this._claimSettleId || this.pawn?.homeSettlementId;
        if (id && sid) this.pawn?.scene?.settlementSys?.releaseWork?.(id, sid);
        this._claimSettleId = null;
    }

    _pruneWorkClaims(settle) {
        const c = this._claims(settle);
        if (!c) return;
        const ids = [];
        for (const p of this.pawn.scene.settlementSys?.settlersOf(settle.id) || []) {
            const id = p?.pawnId || p?.id;
            if (id) ids.push(id);
        }
        c.prune(ids);
    }

    _lc(s) {
        return String(s || "").trim().toLowerCase();
    }

    _an(s) {
        const n = this._lc(s);
        if (!n) return n;
        return ("aeiou".includes(n[0]) ? "an " : "a ") + n;
    }

    _itemName(stackOrId) {
        if (stackOrId == null) return "";
        if (typeof stackOrId === "string") {
            return this.pawn.scene.getItem?.(stackOrId)?.name || stackOrId;
        }
        if (stackOrId.customName) return stackOrId.customName;
        const nested = stackOrId.item;
        if (nested?.name) return nested.name;
        const id = stackOrId.id || nested?.id;
        const meta = id ? this.pawn.scene.getItem?.(id) : null;
        return meta?.name || nested?.name || id || "";
    }

    _thingName(thing) {
        if (!thing) return "";
        return thing.meta?.name
            || this.pawn.scene.getThing?.(thing.entry?.id)?.name
            || thing.entry?.id
            || "";
    }

    _haulNoun(stack) {
        const name = this._itemName(stack);
        if (!name) return "";
        const low = this._lc(name);
        const n = Math.max(1, Number(stack?.quantity) || 1);
        if (n > 1 && !low.endsWith("s")) return `${low}s`;
        return low;
    }

    _firstStashable(settle, keepBandage) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const pawn = this.pawn;
        if (!S?.keepIndices) return null;
        const getItem = (id) => pawn.scene.getItem?.(id);
        const opts = { keepBandage: !!keepBandage };
        const keep = S.keepIndices(pawn.inventory, getItem, opts);
        const take = (s) => (s && this._pickHaulBasket(settle, s) ? s : null);
        for (let i = 0; i < (pawn.inventory || []).length; i++) {
            if (keep.has(i)) continue;
            const s = take(pawn.inventory[i]);
            if (s) return s;
        }
        for (const s of pawn.overflow || []) {
            const hit = take(s);
            if (hit) return hit;
        }
        return null;
    }

    _haulCarryLabel(settle, keepBandage) {
        const noun = this._haulNoun(this._firstStashable(settle, keepBandage)) || this._haulWhat;
        return noun ? `Hauling ${noun}` : "Hauling";
    }

    _billIngredientPhrase(bill) {
        const ids = Array.isArray(bill?.allowedIds) ? bill.allowedIds : [];
        if (!ids.length) return "";
        const names = [];
        for (const id of ids) {
            const n = this._lc(this._itemName(id));
            if (n && !names.includes(n)) names.push(n);
            if (names.length >= 3) break;
        }
        if (!names.length) return "";
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} or ${names[1]}`;
        return `${names[0]}, ${names[1]}…`;
    }

    _cookActLabel(job) {
        const fire = job?.fire;
        const bill = job?.bill;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const getItem = (id) => this.pawn.scene.getItem?.(id);
        const title = S?.billTitle?.(bill) || "meal";
        const method = bill?.method || "stick_roast";
        const cat = fire?.getCatalyst?.();
        if (method === "shell_simmer" && S?.cookOutputReady?.(getItem, cat, bill)) {
            const n = this._itemName(cat);
            return n ? `Taking ${this._lc(n)}` : "Taking a meal";
        }
        const cook = fire?.getCook?.();
        if (cook) {
            const n = this._itemName(cook);
            if (n) {
                if (S?.cookOutputReady?.(getItem, cook, bill)) return `Taking ${this._lc(n)}`;
                if (method === "smoke_hide") return `Smoking ${this._lc(n)}`;
                const roast = method === "stick_roast" || title === "Roast";
                return `${roast ? "Roasting" : "Cooking"} ${this._lc(n)}`;
            }
        }
        if (fire && !fire.isLit?.()) return "Lighting a fire";
        if (fire && !fire.hasFuel?.()) return "Stoking the fire";
        if (method === "shell_simmer") {
            if (fire?.simmerFilledCount?.() > 0) return "Simmering a meal";
            return "Simmering";
        }
        if (fire && !S?.isCookTool?.(getItem, cat, method)) {
            if (method === "stick_roast") return "Getting a roasting stick";
            if (method === "smoke_hide") return "Getting a drying rack";
            return "Getting a cooking tool";
        }
        const foods = this._billIngredientPhrase(bill);
        if (method === "smoke_hide") {
            return foods ? `Smoking leather (${foods})` : "Smoking leather";
        }
        if (foods) return `Cooking ${this._lc(title)} (${foods})`;
        return `Cooking ${this._lc(title)}`;
    }

    _leatherActLabel(job) {
        const station = job?.station || job;
        const bill = job?.bill;
        const method = bill?.method;
        if (job?.kind === "bench" || station?.entry?.id === "skinworking_bench") {
            const title = (typeof Settlement !== "undefined" && Settlement.billTitle)
                ? Settlement.billTitle(bill)
                : null;
            if (title) return title.startsWith("Make ") ? title : `Sewing ${this._lc(title)}`;
            const name = this._thingName(station);
            return name ? `Working at ${this._an(name)}` : "Working hides";
        }
        if (method === "flesh_hide") return "Fleshing hides";
        if (method === "dry_hide") return "Drying hides";
        if (method === "soak_hide") {
            if (job?.kind === "soak_pickup") return "Taking soaked hides";
            return "Soaking hides";
        }
        if (method === "dehair_hide") return "Dehairing hides";
        if (method === "brain_hide") return "Brain-tanning hides";
        const id = station?.entry?.id || station?.meta?.id || "";
        if (id === "drying_rack") return "Working hides";
        return "Working hides";
    }

    _actLabel(plan, settle, keepBandage) {
        const t = plan?.type;
        if (t === "cook") return this._cookActLabel(plan.target);
        if (t === "cook_light") return "Lighting a fire";
        if (t === "haul") {
            if (plan.target?.kind === "pack") return "Stacking storage";
            if (plan.target?.kind === "move") {
                const noun = this._haulNoun({ id: plan.target.stackId });
                return noun ? `Stacking ${noun}` : "Stacking storage";
            }
            const noun = this._haulNoun(this._dropAsStack(plan.target)) || this._haulWhat;
            return noun ? `Hauling ${noun}` : "Hauling";
        }
        if (t === "stash") return this._haulCarryLabel(settle, keepBandage);
        if (t === "gather") {
            const thing = plan.target;
            const lootId = thing?.meta?.lootable?.item;
            const loot = this._itemName(lootId);
            if (loot) {
                const yieldN = Math.max(1, Number(thing.meta.lootable.yield) || 1);
                return `Gathering ${this._haulNoun({ id: lootId, quantity: yieldN })}`;
            }
            const plant = this._thingName(thing);
            return plant ? `Gathering from ${this._an(plant)}` : "Gathering";
        }
        if (t === "chop") {
            const tree = this._thingName(plan.target);
            return tree ? `Chopping ${this._an(tree)}` : "Chopping";
        }
        if (t === "leather") return this._leatherActLabel(plan.target);
        if (t === "doctor") {
            const who = plan.target?.displayName?.() || "ally";
            return `Tending ${who}`;
        }
        if (t === "sleep") {
            const bed = plan.target?.entry;
            const name = this.pawn.scene.getThing?.(bed?.id)?.name;
            return name ? `Sleeping in ${this._an(name)}` : "Sleeping";
        }
        if (t === "eat") return "Getting food";
        return "Idle";
    }

    _tickSettler(delta, ts) {
        const pawn = this.pawn;
        const scene = pawn.scene;
        const settle = this._settlement();
        const S = typeof Settlement !== "undefined" ? Settlement : null;

        this._refreshSettlerAssist(scene, settle, ts);
        if (this.assistTarget && !this.assistTarget.active) this.setAssist(null);
        if (this.assistTarget?.isBodyDead?.()) this.setAssist(null);
        if (this.assistTarget) {
            this._adoptClaim(settle, null);
            this._settlerAct = "Fighting";
            this._tickCombat(delta, ts);
            return;
        }

        if (pawn.isAttacking?.()) {
            this._halt(pawn);
            return;
        }

        if (pawn._tendChannel && !pawn._tendChannel.corpse) {
            this._halt(pawn);
            const who = pawn._tendChannel.patient;
            this._adoptClaim(settle, this._pawnWorkKey(who, "tend"));
            this._settlerAct = this._actLabel({ type: "doctor", target: who }, settle, true);
            return;
        }

        this.tendSeek = null;
        if (pawn._eatChannel) {
            this._halt(pawn);
            this._adoptClaim(settle, null);
            this._settlerAct = "Getting food";
            return;
        }
        if (this._tickEatSeek(delta, ts)) {
            this._adoptClaim(settle, null);
            this._settlerAct = "Getting food";
            return;
        }

        const night = S ? S.isNight(scene.gameMinutes) : false;
        const injured = typeof Sleep !== "undefined" && Sleep.injuredForAutofill
            ? Sleep.injuredForAutofill(pawn.anatomy)
            : false;
        this._workScanMs = (this._workScanMs || 0) + delta;
        const jobs = (S && settle && pawn.pawnId) ? S.jobsFor(settle, pawn.pawnId) : null;
        if (!this._workScan || this._workScanMs >= 280) {
            this._workScanMs = 0;
            if (settle) this._pruneWorkClaims(settle);
            const patients = settle ? this._settlerPatients(settle) : [];
            const doctorOn = !!(S && jobs && S.enabledJobs(jobs).includes("doctor"));
            const keepBandage = !!(doctorOn && patients.length);
            this._workScan = {
                unlitFire: settle ? this._unlitFire(settle) : null,
                light: settle ? this._lightOpts(settle) : {},
                cookBill: settle ? this._cookBill(settle) : null,
                leatherWork: settle ? this._leatherWork(settle) : null,
                haulDrop: settle ? this._haulDrop(settle) : null,
                haulMerge: settle ? this._haulMerge(settle) : null,
                gatherThing: settle ? this._gatherThing(settle) : null,
                chopTree: settle ? this._chopTree(settle) : null,
                patients,
                keepBandage,
                bed: (settle && (night || injured)) ? this._freeBed(settle) : null,
                stash: settle ? this._stashScan(settle, keepBandage) : {
                    basket: null, has: false, urgent: false
                }
            };
        }
        const scan = this._workScan || {};
        if (settle) this._repairScanClaims(settle, scan);
        const keepBandage = !!scan.keepBandage;
        const stash = scan.stash || { basket: null, has: false, urgent: false };
        const planOpts = () => ({
            kc: pawn.kc,
            autoEatBelow: (typeof Party !== "undefined" && Party.AUTO_EAT_BELOW) || 1000,
            canEat: false,
            isNight: night,
            injured,
            isOrphan: !settle,
            bed: scan.bed || null,
            jobs,
            patients: scan.patients || [],
            unlitFire: scan.unlitFire,
            light: scan.light,
            cookBill: scan.cookBill,
            leatherWork: scan.leatherWork,
            haulDrop: scan.haulDrop,
            haulMerge: scan.haulMerge,
            gatherThing: scan.gatherThing,
            chopTree: scan.chopTree,
            stashBasket: stash.basket,
            hasStash: stash.has,
            stashUrgent: stash.urgent
        });
        let plan = S ? S.planWork(planOpts()) : { type: "idle" };
        const delivering = !!(this._haulDest && this._haulHasCargo(settle, keepBandage)
            && plan.type !== "sleep" && plan.type !== "doctor");
        if (this._haulDest && !delivering && plan.type !== "sleep" && plan.type !== "doctor") {
            this._haulDest = null;
            this._haulWhat = null;
            this._haulMergeOnly = false;
            this._haulMergeFrom = null;
            this._haulMergeId = null;
        }
        if (!delivering && !this._lockWork(settle, plan)) {
            this._voidPlanTarget(scan, plan);
            plan = S ? S.planWork(planOpts()) : { type: "idle" };
            if (!this._lockWork(settle, plan)) {
                this._voidPlanTarget(scan, plan);
                plan = { type: "idle" };
                this._adoptClaim(settle, null);
            }
        }
        this._settlerAct = this._actLabel(plan, settle, keepBandage);

        if (plan.type && plan.type !== "idle") {
            this._idleWanderState = null;
            this._idleWanderDest = null;
        }

        if (plan.type === "sleep" && plan.target) {
            scene._orderRest?.(pawn, plan.target.entry, plan.target.slot, { autofill: false });
            return;
        }
        if (plan.type === "doctor" && plan.target) {
            this._doDoctor(plan.target, settle, ts, delta);
            return;
        }
        if (this._haulDest && this._haulHasCargo(settle, keepBandage)) {
            this._adoptClaim(settle, `haul-carry:${this._workerId()}`);
            this._settlerAct = this._haulCarryLabel(settle, keepBandage);
            if (this._haulMergeOnly) {
                this._doMergeDeliver(this._haulDest, settle, ts, delta);
                if (!this._mergeDestWants(this._haulDest)
                    || this._jobSkipped(this._stashKey(this._haulDest))) {
                    this._haulMergeOnly = false;
                    this._haulMergeFrom = null;
                    this._haulMergeId = null;
                    const next = this._stashScan(settle, keepBandage).basket;
                    this._haulDest = next;
                    if (!next) this._haulWhat = null;
                }
            } else {
                this._doStash(this._haulDest, settle, ts, delta, keepBandage);
            }
            if (this._haulHasCargo(settle, keepBandage)) {
                if (!this._haulMergeOnly) {
                    const next = this._stashScan(settle, keepBandage).basket;
                    if (next) this._haulDest = next;
                }
            } else {
                this._haulDest = null;
                this._haulWhat = null;
                this._haulMergeOnly = false;
                this._haulMergeFrom = null;
                this._haulMergeId = null;
            }
            return;
        }
        if (plan.type === "stash" && plan.target) {
            this._doStash(plan.target, settle, ts, delta, keepBandage);
            return;
        }
        if (plan.type === "gather" && plan.target) {
            this._doGather(plan.target, settle, ts, delta);
            return;
        }
        if (plan.type === "chop" && plan.target) {
            this._doChop(plan.target, settle, ts, delta);
            return;
        }
        if (plan.type === "haul" && plan.target) {
            if (plan.target.kind === "pack" || plan.target.kind === "move") {
                this._doHaulMerge(plan.target, settle, ts, delta);
            } else {
                this._doHaul(plan.target, settle, ts, delta);
            }
            return;
        }
        if (plan.type === "cook_light" && plan.target) {
            this._doLightFire(plan.target, settle, ts, delta);
            return;
        }
        if (plan.type === "cook" && plan.target) {
            this._doCook(plan.target, settle, ts, delta);
            return;
        }
        if (plan.type === "leather" && plan.target) {
            this._doLeather(plan.target, settle, ts, delta);
            return;
        }

        this._idleNearHome(settle, ts, delta);
    }

    _repairScanClaims(settle, scan) {
        if (!scan) return;
        // Drop stolen targets; the next 280ms scan picks replacements.
        if (this._claimedByOther(settle, this._stationKey(scan.unlitFire))
            || this._jobSkipped(this._stationKey(scan.unlitFire))) {
            scan.unlitFire = null;
        }
        if (this._claimedByOther(settle, this._stationKey(scan.cookBill?.fire))
            || this._jobSkipped(this._stationKey(scan.cookBill?.fire))) {
            scan.cookBill = null;
        }
        if (this._claimedByOther(settle, this._leatherJobKey(scan.leatherWork))
            || this._jobSkipped(this._leatherJobKey(scan.leatherWork))) {
            scan.leatherWork = null;
        }
        if (this._claimedByOther(settle, this._dropKey(scan.haulDrop))
            || this._jobSkipped(this._dropKey(scan.haulDrop))) {
            scan.haulDrop = null;
        }
        if (scan.haulMerge) {
            const key = this._mergeJobKey(scan.haulMerge);
            if (this._claimedByOther(settle, key) || this._jobSkipped(key)) scan.haulMerge = null;
        }
        if (this._claimedByOther(settle, this._thingKey(scan.gatherThing))
            || this._jobSkipped(this._thingKey(scan.gatherThing))) {
            scan.gatherThing = null;
        }
        if (this._claimedByOther(settle, this._thingKey(scan.chopTree))
            || this._jobSkipped(this._thingKey(scan.chopTree))) {
            scan.chopTree = null;
        }
        if (this._claimedByOther(settle, this._bedKey(scan.bed))) scan.bed = null;
        if (scan.patients) {
            scan.patients = scan.patients.filter((p) => {
                if (!p || p.isBodyDead?.()) return false;
                const k = this._pawnWorkKey(p, "tend");
                return !this._claimedByOther(settle, k) && !this._jobSkipped(k);
            });
            if (!scan.patients.length) scan.keepBandage = false;
        }
    }

    _refreshSettlerAssist(scene, settle, ts) {
        const pawn = this.pawn;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const leash = settle?.radiusTiles || S?.RADIUS_TILES || 32;
        const inLeash = (t) => {
            if (!t || t.isBodyDead?.()) return false;
            if (t.active === false) return false;
            const ox = settle ? settle.x : pawn.x;
            const oy = settle ? settle.y : pawn.y;
            const dHome = Math.hypot((t.x - ox) / ts, (t.y - oy) / ts);
            const dSelf = Math.hypot((t.x - pawn.x) / ts, (t.y - pawn.y) / ts);
            return dHome <= leash + 1 || dSelf <= 3;
        };
        const sys = scene?.partySys;
        let hunted = sys?._resolveAssistTarget?.(sys.lastHitMob);
        const next = sys?.duelTargetFor?.(this.pawn) || hunted;
        if (next && inLeash(next)) {
            if (next !== this.assistTarget) this.setAssist(next);
            return;
        }
        this.setAssist(null);
    }

    _freeBed(settle) {
        const scene = this.pawn.scene;
        if (!scene?.forEachSleepEntry) return null;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        let best = null;
        let bestD = Infinity;
        scene.forEachSleepEntry((e, def) => {
            if (settle && S && !S.inRange(settle, e.x, e.y, scene.tileSize || 16)) return;
            const n = typeof Sleep !== "undefined" ? Sleep.slotCount(def, e) : 2;
            for (let i = 0; i < n; i++) {
                if (scene._sleepSlotClaimed?.(e, i, this.pawn.pawnId)) continue;
                if (this._claimedByOther(settle, this._bedKey({ entry: e, slot: i }))) continue;
                const d = Math.hypot(this.pawn.x - e.x, this.pawn.y - e.y);
                if (d < bestD) {
                    bestD = d;
                    best = { entry: e, slot: i };
                }
            }
        });
        return best;
    }

    _jobNow() {
        return this.pawn?.scene?.time?.now || Date.now();
    }

    _jobSkipped(key) {
        if (!key) return false;
        const until = this._skipUntil?.get(key) || 0;
        return this._jobNow() < until;
    }

    _skipJob(key, ms = 4500) {
        if (!key) return;
        if (!this._skipUntil) this._skipUntil = new Map();
        this._skipUntil.set(key, this._jobNow() + ms);
    }

    _giveUpJob(settle, key) {
        this._skipJob(key);
        this._stuckMs = 0;
        this._jamMs = 0;
        this._stillMs = 0;
        this._path = null;
        this._adoptClaim(settle, null);
        this._halt(this.pawn);
    }

    _abortIfStuck(settle, key) {
        if ((this._stillMs || 0) < 1400
            && (this._jamMs || 0) < 900
            && (this._stuckMs || 0) < 2200) {
            return false;
        }
        this._giveUpJob(settle, key);
        return true;
    }

    _goOrAbort(target, settle, key, ts, delta) {
        if (this._goToTarget(target, ts, delta)) return true;
        this._abortIfStuck(settle, key);
        return false;
    }

    _stashKey(b) {
        const uid = b?.uid || b?.entry?.uid;
        return uid ? `stash:${uid}` : null;
    }

    _mergeJobKey(job) {
        if (!job) return null;
        if (job.claimKey) return job.claimKey;
        const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
        return SF?.mergeClaimKey?.(job) || null;
    }

    _patientNeedsTend(p) {
        if (!p || p.isBodyDead?.()) return false;
        return !!(this.pawn.scene?.partySys?._pawnNeedsTend?.(p)
            || (typeof BodyHealing !== "undefined" && BodyHealing.pickTendTarget?.(p.anatomy)));
    }

    _dropPatient(patient, skip = true) {
        const key = this._pawnWorkKey(patient, "tend");
        if (skip) this._skipJob(key);
        if (this._workScan?.patients) {
            this._workScan.patients = this._workScan.patients.filter((p) => p !== patient);
            if (!this._workScan.patients.length) this._workScan.keepBandage = false;
        }
    }

    _failHaul(settle, key) {
        this._giveUpJob(settle, key);
        const scan = this._workScan;
        if (!scan) return;
        if (this._dropKey(scan.haulDrop) === key) scan.haulDrop = null;
        if (this._mergeJobKey(scan.haulMerge) === key) scan.haulMerge = null;
    }

    _settlerPatients(settle) {
        const scene = this.pawn.scene;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const ts = scene.tileSize || 16;
        if (!this._findStack(settle, (s) => !!scene.getItem?.(s.id)?.bandage)) return [];
        const out = [];
        const consider = (p) => {
            if (!p || p === this.pawn || p.isBodyDead?.()) return;
            if (!S.inRange(settle, p.x, p.y, ts)) return;
            const tendKey = this._pawnWorkKey(p, "tend");
            if (this._claimedByOther(settle, tendKey) || this._jobSkipped(tendKey)) return;
            if (this._patientNeedsTend(p)) out.push(p);
        };
        for (const p of scene.settlementSys?.settlersOf(settle.id) || []) consider(p);
        for (const p of scene.party || []) consider(p);
        return out;
    }

    _unlitFire(settle) {
        const fires = this.pawn.scene.settlementSys?.addedStations(settle, "campfire") || [];
        return fires.find((f) => f && !f.isLit?.()
            && !this._claimedByOther(settle, this._stationKey(f))
            && !this._jobSkipped(this._stationKey(f))) || null;
    }

    _lightOpts(settle) {
        const scene = this.pawn.scene;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const getItem = (id) => scene.getItem?.(id);
        let hasFirestarter = false;
        let hasFuel = false;
        const scan = (slots) => {
            for (const s of slots || []) {
                if (S?.isFirestarter(s, getItem)) hasFirestarter = true;
                const meta = s ? getItem(s.id) : null;
                if (meta?.fuel || s?.id === "stick" || s?.id === "log") hasFuel = true;
            }
        };
        for (const b of scene.settlementSys.addedBaskets(settle)) scan(b.slots);
        scan(this.pawn.inventory);
        const fire = this._unlitFire(settle);
        if (fire?.hasFuel?.()) hasFuel = true;
        return { hasFirestarter, hasFuel, hasGroundRecipe: false };
    }

    _cookBill(settle) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S) return null;
        const fires = this.pawn.scene.settlementSys?.addedStations(settle, "campfire") || [];
        const tryFire = (f) => {
            if (!f) return null;
            const uid = f.entry?.uid;
            const bill = S.activeBill(settle, uid, (id) => this.pawn.scene.settlementSys.countItem(settle, id));
            if (bill && this._cookHasWork(f, bill, settle, S)) return { fire: f, bill };
            return null;
        };
        const mine = this._myClaim(settle);
        if (mine && mine.startsWith("station:")) {
            const held = fires.find((f) => this._stationKey(f) === mine);
            const job = tryFire(held);
            if (job) return job;
        }
        for (const f of fires) {
            if (this._claimedByOther(settle, this._stationKey(f))) continue;
            const job = tryFire(f);
            if (job) return job;
        }
        return null;
    }

    _cookHasWork(fire, bill, settle, S) {
        const getItem = (id) => this.pawn.scene.getItem?.(id);
        const method = bill.method || "stick_roast";
        if (method === "shell_simmer") {
            const cat = fire.getCatalyst?.();
            if (S.cookOutputReady(getItem, cat, bill)) return true;
            const filled = fire.simmerFilledCount?.() || 0;
            if (filled >= (S.SIMMER_MIN_SLOTS || 2) && S.isCookTool(getItem, cat, method)) return true;
            const hasTool = S.isCookTool(getItem, cat, method)
                || !!this._findStack(settle, (s) => S.isCookTool(getItem, s, method));
            let n = filled;
            const countInv = (slots) => {
                for (const s of slots || []) {
                    if (!s || !S.cookInputReady(getItem, s, bill)) continue;
                    n += Math.max(1, Number(s.quantity) || 1);
                }
            };
            countInv(this.pawn.inventory);
            for (const b of this.pawn.scene.settlementSys?.addedBaskets(settle) || []) {
                countInv(b.slots);
            }
            return !!(hasTool && n >= (S.SIMMER_MIN_SLOTS || 2));
        }
        if (fire.getCook?.()) return true;
        const hasTool = S.isCookTool(getItem, fire.getCatalyst?.(), method)
            || !!this._findStack(settle, (s) => S.isCookTool(getItem, s, method));
        const hasFood = !!this._findStack(settle, (s) => S.cookInputReady(getItem, s, bill));
        return !!(hasTool && hasFood);
    }

    _leatherWork(settle) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S) return null;
        const jobs = this._leatherJobs(settle, S);
        if (!jobs.length) return null;
        const mine = this._myClaim(settle);
        if (mine) {
            const held = jobs.find((j) => this._leatherJobKey(j) === mine);
            if (held && !this._jobSkipped(mine)) return held;
        }
        let best = null;
        let bestP = 99;
        let bestD = Infinity;
        for (const job of jobs) {
            const key = this._leatherJobKey(job);
            if (this._claimedByOther(settle, key) || this._jobSkipped(key)) continue;
            const pri = Number(job.pri) || 50;
            const t = job.station || job.drop || job.water;
            const d = t ? Math.hypot(this.pawn.x - t.x, this.pawn.y - t.y) : 0;
            if (pri < bestP || (pri === bestP && d < bestD)) {
                bestP = pri;
                bestD = d;
                best = job;
            }
        }
        return best;
    }

    _leatherJobs(settle, S) {
        const out = [];
        const scene = this.pawn.scene;
        const have = (id) => scene.settlementSys?.countItem?.(settle, id) || 0;
        const racks = scene.settlementSys?.addedStations(settle, "rack") || [];
        for (const rack of racks) {
            if (!rack?.active) continue;
            const uid = rack.entry?.uid;
            const bill = S.activeBill(settle, uid, have);
            if (!bill) continue;
            const job = this._rackBillJob(rack, bill, settle, S);
            if (job) out.push(job);
        }
        const benches = scene.settlementSys?.addedStations(settle, "craft") || [];
        for (const bench of benches) {
            if (!bench?.active) continue;
            const uid = bench.entry?.uid;
            const bill = S.activeBill(settle, uid, have);
            if (!bill) continue;
            if (!this._benchHasWork(bill, settle, S)) continue;
            out.push({ kind: "bench", station: bench, bill, pri: 8 });
        }
        return out;
    }

    _rackHang(rack) {
        return rack?.getSlot?.(0) || rack?.hangingStack?.() || null;
    }

    _rackBillJob(rack, bill, settle, S) {
        const getItem = (id) => this.pawn.scene.getItem?.(id);
        const method = bill.method;
        const step = S.hideStepOf?.(method);
        if (!step) return null;
        const hang = this._rackHang(rack);
        const hangStage = hang ? S.hideStageOf(getItem(hang.id), hang.id) : null;

        if (method === "soak_hide") {
            const ready = this._soakReadyDrop(bill, settle, S);
            if (ready) return { kind: "soak_pickup", station: rack, bill, drop: ready, pri: 1 };
            const water = this._soakWater(settle, S);
            const fleshedHang = hang && S.hideAllowsStack?.(bill, hang, getItem);
            const fleshedStore = this._findStack(settle, (s) => S.hideAllowsStack?.(bill, s, getItem));
            if ((fleshedHang || fleshedStore) && water) {
                return {
                    kind: "soak_drop",
                    station: rack,
                    bill,
                    water,
                    fromRack: !!fleshedHang,
                    pri: fleshedHang ? 3 : 6
                };
            }
            return null;
        }

        if (hang && hangStage === step.outputStage) {
            return { kind: "unload", station: rack, bill, pri: 0 };
        }
        if (hang && S.hideAllowsStack?.(bill, hang, getItem)) {
            if (method === "dry_hide") return null;
            const need = S.hideToolNeed?.(method);
            if (need === "scraper" && !this._findHideTool(settle, "scraper")) return null;
            if (need === "brain" && !this._findBrain(settle)) return null;
            return { kind: "work", station: rack, bill, pri: 2 };
        }
        if (hang) return null;
        const input = this._findStack(settle, (s) => S.hideAllowsStack?.(bill, s, getItem));
        if (!input) return null;
        const need = S.hideToolNeed?.(method);
        if (need === "scraper" && !this._findHideTool(settle, "scraper")) return null;
        if (need === "brain" && !this._findBrain(settle)) return null;
        return { kind: "hang", station: rack, bill, pri: 4 };
    }

    _findHideTool(settle, toolClass) {
        return this._findStack(settle, (s) => {
            if (!s) return false;
            const def = this.pawn.scene.getItem?.(s.id);
            const cls = typeof Carry !== "undefined" && Carry.stackToolClass
                ? Carry.stackToolClass(s, def)
                : (s.toolClass || def?.toolClass);
            return cls === toolClass;
        });
    }

    _findBrain(settle) {
        return this._findStack(settle, (s) => {
            const def = this.pawn.scene.getItem?.(s.id);
            return typeof Hide !== "undefined" ? Hide.isBrainItem(def) : !!(def?.brain);
        });
    }

    _soakWater(settle, S) {
        const scene = this.pawn.scene;
        if (!S.nearestWaterPoint) return null;
        return S.nearestWaterPoint(
            settle,
            this.pawn.x,
            this.pawn.y,
            scene.tileSize || 16,
            (wx, wy) => !!scene._isWaterAt?.(wx, wy)
        );
    }

    _soakReadyDrop(bill, settle, S) {
        const scene = this.pawn.scene;
        const now = scene.worldMinuteIndex?.();
        const getItem = (id) => scene.getItem?.(id);
        const step = S.hideStepOf?.(bill.method);
        const drops = scene.droppedItems?.getChildren?.() || [];
        let best = null;
        let bestD = Infinity;
        for (const d of drops) {
            if (!d?.active) continue;
            if (settle && S && !S.inRange(settle, d.x, d.y, scene.tileSize || 16)) continue;
            const id = d.item?.id || d.id;
            if (!id) continue;
            const def = getItem(id);
            const stage = S.hideStageOf(def, id);
            if (stage !== step?.outputStage) continue;
            const animal = S.hideAnimalOf(def, id);
            const allowed = bill.allowedIds;
            if (Array.isArray(allowed) && allowed.length) {
                const ok = allowed.some((aid) => S.hideAnimalOf(getItem(aid), aid) === animal);
                if (!ok) continue;
            }
            if (d.soakDoneAt != null && now != null && Number(d.soakDoneAt) > Number(now)) continue;
            const dist = Math.hypot(this.pawn.x - d.x, this.pawn.y - d.y);
            if (dist < bestD) {
                bestD = dist;
                best = d;
            }
        }
        return best;
    }

    _benchHasWork(bill, settle, S) {
        const scene = this.pawn.scene;
        const rec = this._benchRecipe(bill, scene);
        if (!rec) return false;
        if (!this._findHideTool(settle, rec.requireTool?.toolClass || "awl")) return false;
        for (const ing of rec.ingredients || []) {
            if (ing.hideStage) {
                const n = this._countAllowedHide(settle, bill, ing.hideStage, S);
                if (n < (ing.qty || 1)) return false;
                continue;
            }
            if (!ing.id || ing.id === "ANY_HIDE" || ing.id === "ANY_LEATHER") continue;
            const found = this._findStack(settle, (s) => s?.id === ing.id);
            if (!found) return false;
        }
        return true;
    }

    _benchRecipe(bill, scene) {
        const list = scene?.getKnownRecipes?.("skinworking_bench") || [];
        return list.find((r) => r && r.id === bill?.recipeId) || null;
    }

    _hideAllowed(bill, stack, S) {
        if (!stack?.id) return false;
        const getItem = (id) => this.pawn.scene.getItem?.(id);
        const def = getItem(stack.id);
        if (!Array.isArray(bill.allowedIds) || !bill.allowedIds.length) return true;
        if (bill.allowedIds.includes(stack.id)) return true;
        const animal = S.hideAnimalOf(def, stack.id);
        return bill.allowedIds.some((id) => S.hideAnimalOf(getItem(id), id) === animal);
    }

    _countAllowedHide(settle, bill, hideStage, S) {
        const getItem = (id) => this.pawn.scene.getItem?.(id);
        const match = (s) => {
            if (!s?.id) return false;
            if (S.hideStageOf(getItem(s.id), s.id) !== hideStage) return false;
            return this._hideAllowed(bill, s, S);
        };
        let n = 0;
        const add = (slots) => {
            for (const s of slots || []) {
                if (match(s)) n += Math.max(1, Number(s.quantity) || 1);
            }
        };
        add(this.pawn.inventory);
        add(this.pawn.overflow);
        for (const b of this.pawn.scene.settlementSys?.addedBaskets(settle) || []) add(b.slots);
        return n;
    }

    _countPawnHide(pawn, bill, hideStage, S) {
        const getItem = (id) => pawn.scene.getItem?.(id);
        let n = 0;
        for (const s of pawn.inventory || []) {
            if (!s?.id) continue;
            if (S.hideStageOf(getItem(s.id), s.id) !== hideStage) continue;
            if (!this._hideAllowed(bill, s, S)) continue;
            n += Math.max(1, Number(s.quantity) || 1);
        }
        return n;
    }

    _gatherThing(settle) {
        const scene = this.pawn.scene;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const list = scene.settlementSys?.lootablesInRange?.(settle) || [];
        const haveById = new Map();
        const haveOf = (itemId) => {
            if (!haveById.has(itemId)) {
                haveById.set(itemId, scene.settlementSys.countBaskets(settle, itemId));
            }
            return haveById.get(itemId);
        };
        let best = null;
        let bestD = Infinity;
        const mine = this._myClaim(settle);
        if (mine && mine.startsWith("thing:")) {
            const held = list.find((t) => this._thingKey(t) === mine);
            if (held?.active && !held.entry?.gone && held.meta?.lootable
                && !this._jobSkipped(mine)) {
                const itemId = held.meta.lootable.item || held.meta.id;
                if (S.gatherShouldWork(haveOf(itemId), S.stockTarget(settle, itemId))
                    && this._settlerCanTakeLoot(held)) {
                    return held;
                }
            }
        }
        for (const t of list) {
            if (!t?.active || t.entry?.gone || !t.meta?.lootable) continue;
            if (this._claimedByOther(settle, this._thingKey(t))) continue;
            if (this._jobSkipped(this._thingKey(t))) continue;
            const itemId = t.meta.lootable.item || t.meta.id;
            const have = haveOf(itemId);
            const want = S.stockTarget(settle, itemId);
            if (!S.gatherShouldWork(have, want)) continue;
            if (!this._settlerCanTakeLoot(t)) continue;
            const d = Math.hypot(this.pawn.x - t.x, this.pawn.y - t.y);
            if (d < bestD) {
                bestD = d;
                best = t;
            }
        }
        return best;
    }

    _settlerCanTake(stack, want = 1) {
        if (!stack?.id) return false;
        const n = Math.max(1, Math.floor(Number(want) || 1));
        const space = this.pawn.countLootSpace?.(stack, n);
        if (space == null) return true;
        return space >= 1;
    }

    _settlerCanTakeLoot(thing) {
        const loot = thing?.meta?.lootable;
        if (!loot) return false;
        return this._settlerCanTake({
            id: loot.item || thing.meta?.id,
            quantity: loot.yield || 1
        }, 1);
    }

    _dropIsSoakingFleshed(drop) {
        if (!drop || typeof Hide === "undefined" || !Hide.leaveHaulInWater) return false;
        const scene = this.pawn?.scene;
        const def = drop.item || scene?.getItem?.(drop.id);
        const onWater = !!scene?._dropIsOnWater?.(drop);
        return Hide.leaveHaulInWater(def, onWater);
    }

    _settlerCanTakeDrop(drop) {
        const item = drop?.item;
        if (!item?.id) return false;
        if (this._dropIsSoakingFleshed(drop)) return false;
        const special = typeof isSpecialStack === "function"
            ? isSpecialStack(drop)
            : !!(drop.customName || drop.food || drop.ingredients || drop.toolClass);
        const stack = {
            id: item.id,
            quantity: drop.quantity || 1,
            ...(drop.customName ? { customName: drop.customName } : {}),
            ...(drop.food ? { food: drop.food } : {}),
            ...(drop.ingredients ? { ingredients: drop.ingredients } : {}),
            ...(drop.toolClass ? { toolClass: drop.toolClass } : {}),
            ...(drop.knapMaterial ? { knapMaterial: drop.knapMaterial } : {}),
            ...(drop.stackWeight != null ? { weight: drop.stackWeight } : {})
        };
        const want = special ? Math.max(1, Number(drop.quantity) || 1) : 1;
        if (special) return (this.pawn.countLootSpace?.(stack, want) ?? 0) >= want;
        return this._settlerCanTake(stack, 1);
    }

    _chopTree(settle) {
        const scene = this.pawn.scene;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!this._findChopper(settle)) return null;
        const have = scene.settlementSys.countBaskets(settle, "log");
        const want = S.stockTarget(settle, "log");
        const billNeeds = this._billNeedsLogs(settle);
        if (!billNeeds && !S.gatherShouldWork(have, want)) return null;
        const list = scene.settlementSys?.choppablesInRange?.(settle) || [];
        const mine = this._myClaim(settle);
        if (mine && mine.startsWith("thing:")) {
            const held = list.find((t) => this._thingKey(t) === mine);
            if (this._chopTargetValid(held) && !this._jobSkipped(mine)) return held;
        }
        let best = null;
        let bestD = Infinity;
        for (const t of list) {
            if (!t?.active || t.entry?.gone) continue;
            if (this._claimedByOther(settle, this._thingKey(t))) continue;
            if (this._jobSkipped(this._thingKey(t))) continue;
            if (!this._chopTargetValid(t)) continue;
            const d = Math.hypot(this.pawn.x - t.x, this.pawn.y - t.y);
            if (d < bestD) {
                bestD = d;
                best = t;
            }
        }
        return best;
    }

    _billNeedsLogs(settle) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        for (const uid of settle.stationUids || []) {
            for (const b of S.billsOf(settle, uid)) {
                if (!b || b.paused) continue;
                if (b.recipeId === "log" || b.outputId === "log") return true;
            }
        }
        return false;
    }

    _workInteractTiles() {
        const P = typeof Party !== "undefined" ? Party : null;
        const base = Number(this.pawn?.interactionRange) || P?.INTERACT_TILES || 4;
        // Tight enough not to work across the camp, wide enough to use a
        // stand point just outside a basket/tree hitbox.
        if (this.pawn?.role === "settler") return Math.max(1.75, base * 0.45);
        return base;
    }

    _near(target, ts) {
        if (!target) return false;
        const pawn = this.pawn;
        const cell = ts || 16;
        const tiles = this._workInteractTiles();
        const dist = Math.hypot(pawn.x - target.x, pawn.y - target.y) / cell;
        const enter = tiles + 0.12;
        const leave = tiles + 0.65;
        const id = target.entry?.uid || target.pawnId || target.uid
            || `${Math.round(Number(target.x) || 0)}:${Math.round(Number(target.y) || 0)}`;
        if (this._nearKey === id && this._nearLatched) {
            if (dist > leave) {
                this._nearLatched = false;
                this._nearKey = null;
                return false;
            }
            return true;
        }
        if (dist <= enter) {
            this._nearKey = id;
            this._nearLatched = true;
            return true;
        }
        return false;
    }

    // Stand just outside the hitbox, still inside interact range, so settlers
    // don't walk into solids and get teleported around every frame.
    _approachPoint(target, ts) {
        const pawn = this.pawn;
        const cell = ts || 16;
        const tiles = this._workInteractTiles();
        const tx = Number(target?.x) || 0;
        const ty = Number(target?.y) || 0;
        const uid = target?.entry?.uid || target?.pawnId || target?.uid
            || `${Math.round(tx)}:${Math.round(ty)}`;
        if (this._approachKey === uid && this._approach) {
            const s = this._approach;
            if (Math.hypot(s.tx - tx, s.ty - ty) < cell * 0.6) return s;
        }
        const hs = Number(target?.hitboxSize || target?.meta?.hitboxSize) || 6;
        const pad = Math.max(2, (Number(pawn.hitboxSize) || 8) * 0.4);
        const minDist = hs * 0.5 + pad + 1;
        const maxDist = Math.max(minDist, tiles * cell * 0.92);
        const dist = Math.min(Math.max(minDist, tiles * cell * 0.82), maxDist);
        let dx = pawn.x - tx;
        let dy = pawn.y - ty;
        let radial = Math.hypot(dx, dy);
        if (radial < 0.5) { dx = 0; dy = 1; radial = 1; }
        else { dx /= radial; dy /= radial; }
        const blocked = (px, py) => pawnPoseBlocked?.(pawn, px, py, this._isSettler() ? 2 : 1);
        const tryDir = (nx, ny) => {
            const x = tx + nx * dist;
            const y = ty + ny * dist;
            if (!blocked(x, y)) return { x, y, tx, ty };
            return null;
        };
        let pick = tryDir(dx, dy);
        if (!pick) {
            const side = this._avoidSide >= 0 ? 1 : -1;
            const base = Math.atan2(dy, dx);
            for (let a = 1; a <= 8; a++) {
                const ang = base + side * a * (Math.PI / 8);
                pick = tryDir(Math.cos(ang), Math.sin(ang));
                if (pick) break;
            }
        }
        pick = pick || { x: tx + dx * dist, y: ty + dy * dist, tx, ty };
        this._approach = pick;
        this._approachKey = uid;
        return pick;
    }

    _storageEntry(target) {
        if (!target) return null;
        if (Array.isArray(target.slots)) return target;
        if (Array.isArray(target.entry?.slots)) return target.entry;
        return target;
    }

    _goToTarget(target, ts, delta) {
        if (!target) return false;
        const pawn = this.pawn;
        const cell = ts || 16;
        const distTiles = Math.hypot(pawn.x - target.x, pawn.y - target.y) / cell;
        // openRadius-2 stand points sit ~2 tiles out. Do not path onto the
        // hitbox (openRadius 0) — that replans A* every frame and hitchs FPS.
        if (this._near(target, ts) || distTiles <= 2.4) {
            this._halt(pawn);
            return true;
        }
        const p = this._approachPoint(target, ts);
        this._walkToward(
            pawn, p.x, p.y, ts, false, delta,
            pawn._wadeWater ? { wade: true } : undefined
        );
        return false;
    }

    _doGather(thing, settle, ts, delta) {
        if (!thing?.active || thing.entry?.gone || !thing.meta?.lootable) {
            this._halt(this.pawn);
            return;
        }
        const key = this._thingKey(thing);
        if (!this._goOrAbort(thing, settle, key, ts, delta)) return;
        if (!this._settlerCanTakeLoot(thing)) {
            this._skipJob(key);
            if (this._workScan) this._workScan.gatherThing = null;
            this._adoptClaim(settle, null);
            this._halt(this.pawn);
            return;
        }
        if (thing.pickUpBy) thing.pickUpBy(this.pawn);
        else thing.pickUp?.();
    }

    _isChopper(stack) {
        return typeof Chop !== "undefined" && !!Chop.isChopper?.(stack);
    }

    _findChopper(settle) {
        return this._findStack(settle, (s) => this._isChopper(s));
    }

    _chopDef(thing) {
        const scene = this.pawn?.scene;
        return scene?.getThing?.(thing?.entry?.id) || thing?.meta || null;
    }

    _chopTargetValid(thing) {
        if (!thing?.active || thing.entry?.gone) return false;
        if (typeof Chop === "undefined") return false;
        const def = this._chopDef(thing);
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (S?.chopSkipsTree?.(thing.entry?.id || def?.id, def)) return false;
        return !!Chop.stillChoppable?.(def, thing.entry);
    }

    _forgetChopTarget() {
        if (this._workScan) this._workScan.chopTree = null;
        this._chopStand = null;
        this._chopStandKey = null;
        this._chopArrived = false;
        this.pawn?.scene?.settlementSys?.bumpWorkCache?.();
    }

    _doChop(thing, settle, ts, delta) {
        const pawn = this.pawn;
        if (!this._chopTargetValid(thing)) {
            this._halt(pawn);
            this._forgetChopTarget();
            return;
        }
        if (pawn.isAttacking?.()) {
            this._halt(pawn);
            return;
        }
        if (!this._equipChopTool()) {
            const found = this._findChopper(settle);
            if (!found) {
                this._halt(pawn);
                return;
            }
            this._fetchStack(found, ts, delta);
            return;
        }
        if (this._chopWouldHit(thing)) {
            this._halt(pawn);
            this._chopArrived = true;
            const chop = (typeof Chop !== "undefined" && typeof BodyCombat !== "undefined")
                ? Chop.pickChopFromAttacks(BodyCombat.collectAttacks(pawn))
                : null;
            if (!chop) return;
            pawn.tryMeleeAttack?.(thing, chop);
            return;
        }
        const stand = this._chopStandPoint(thing, ts);
        const c = pawn.bodyCenter?.() || { x: pawn.x, y: pawn.y };
        const dAim = Math.hypot(c.x - stand.aimX, c.y - stand.aimY);
        const enter = Math.max(5, (ts || 16) * 0.4);
        const leave = enter + 4;
        if (this._chopArrived && dAim > leave) this._chopArrived = false;
        if (!this._chopArrived && dAim <= enter) this._chopArrived = true;
        if (!this._chopArrived) {
            this._walkBodyToward(pawn, stand.aimX, stand.aimY, ts, false, delta);
            if (this._abortIfStuck(settle, this._thingKey(thing))) this._forgetChopTarget();
            return;
        }
        // On the ring but the swing still misses — halt, then sidestep slowly.
        // Clearing arrived every miss made them dash in and out of the trunk.
        this._halt(pawn);
        const now = pawn.scene?.time?.now || 0;
        if (now - (this._sidestepAt || 0) < 350) return;
        this._sidestepAt = now;
        this._walkBodyToward(
            pawn,
            stand.aimX - stand.ny * 8,
            stand.aimY + stand.nx * 8,
            ts,
            false,
            delta
        );
    }

    _chopWouldHit(thing) {
        if (!thing || typeof Chop === "undefined") return false;
        const pawn = this.pawn;
        const c = pawn.bodyCenter?.() || { x: pawn.x, y: pawn.y };
        const angle = Math.atan2(thing.y - c.y, thing.x - c.x);
        const hs = thing.hitboxSize || thing.meta?.hitboxSize || 5;
        if (typeof Chop.aimHitsTrunk === "function") {
            return Chop.aimHitsTrunk(c.x, c.y, angle, thing.x, thing.y, hs);
        }
        const seg = Chop.aimSegment(c.x, c.y, angle, Chop.AIM_REACH);
        return Chop.trunkHitsSegment(seg, thing.x, thing.y, hs, Chop.HIT_RADIUS);
    }

    _chopStandPoint(thing, ts) {
        const pawn = this.pawn;
        const c = pawn.bodyCenter?.() || { x: pawn.x, y: pawn.y };
        const hs = thing.hitboxSize || thing.meta?.hitboxSize || 5;
        const pad = Math.max(3, (Number(pawn.hitboxSize) || 8) * 0.5);
        if (typeof Chop !== "undefined" && Chop.ringStand) {
            return Chop.ringStand(c.x, c.y, thing.x, thing.y, hs, pad);
        }
        const dist = Math.max(7, hs * 0.5 + 5) + pad;
        let dx = c.x - thing.x;
        let dy = c.y - thing.y;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d;
        dy /= d;
        return { aimX: thing.x + dx * dist, aimY: thing.y + dy * dist, dist, radial: d, nx: dx, ny: dy };
    }

    _equipChopTool() {
        const pawn = this.pawn;
        for (let i = 0; i < (pawn.inventory || []).length; i++) {
            const s = pawn.inventory[i];
            if (s && this._isChopper(s)) {
                pawn.hotbarIndex = i;
                return true;
            }
        }
        return false;
    }

    _dropAsStack(drop) {
        if (!drop) return null;
        const id = drop.item?.id || (typeof drop.id === "string" ? drop.id : null);
        if (!id && !drop.item) return null;
        return {
            id,
            item: drop.item,
            quantity: drop.quantity || 1,
            toolClass: drop.toolClass,
            customName: drop.customName,
            food: drop.food,
            ingredients: drop.ingredients
        };
    }

    _haulBaskets(settle) {
        const list = this.pawn.scene.settlementSys?.addedBaskets(settle) || [];
        return list.filter((b) => {
            const uid = b?.uid || b?.entry?.uid;
            return !this._jobSkipped(uid ? `stash:${uid}` : null);
        });
    }

    _pickHaulBasket(settle, stack) {
        const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
        const baskets = this._haulBaskets(settle);
        const getItem = (id) => this.pawn.scene.getItem?.(id);
        if (SF?.pickBasket) {
            return SF.pickBasket(baskets, stack, getItem, this.pawn.x, this.pawn.y);
        }
        return baskets[0] || null;
    }

    _haulDrop(settle) {
        const scene = this.pawn.scene;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const ts = scene.tileSize || 16;
        let best = null;
        let bestD = Infinity;
        const drops = scene.settlementSys?.dropsInRange?.(settle) || [];
        const mine = this._myClaim(settle);
        if (mine && mine.startsWith("drop:")) {
            const held = drops.find((d) => d?.active && this._dropKey(d) === mine);
            if (held && this._settlerCanTakeDrop(held)) {
                const stack = this._dropAsStack(held);
                if (stack && this._pickHaulBasket(settle, stack)) return held;
            }
        }
        for (const d of drops) {
            if (!d?.active) continue;
            if (!S?.inRange(settle, d.x, d.y, ts)) continue;
            if (this._claimedByOther(settle, this._dropKey(d))) continue;
            if (this._jobSkipped(this._dropKey(d))) continue;
            if (!this._settlerCanTakeDrop(d)) continue;
            const stack = this._dropAsStack(d);
            if (!stack || !this._pickHaulBasket(settle, stack)) continue;
            const dist = Math.hypot(this.pawn.x - d.x, this.pawn.y - d.y);
            if (dist < bestD) {
                bestD = dist;
                best = d;
            }
        }
        return best;
    }

    _haulMerge(settle) {
        const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
        if (!SF?.findMergeJob) return null;
        const baskets = this._haulBaskets(settle);
        const getItem = (id) => this.pawn.scene.getItem?.(id);
        const mine = this._myClaim(settle);
        if (mine && mine.startsWith("merge:") && !this._jobSkipped(mine)) {
            const held = SF.findMergeJob(baskets, getItem, this.pawn.x, this.pawn.y, { claimKey: mine });
            if (held) return held;
        }
        return SF.findMergeJob(baskets, getItem, this.pawn.x, this.pawn.y, {
            isClaimed: (key) => this._claimedByOther(settle, key) || this._jobSkipped(key)
        });
    }

    _stackExtras(dest, src, n) {
        const now = this.pawn.scene?.worldMinuteIndex?.() ?? null;
        const destN = Number(dest.quantity) || 1;
        if (typeof mergeSpoilAt === "function") {
            const srcAt = typeof spoilAtForWorld === "function"
                ? spoilAtForWorld(src, now)
                : src.spoilAt;
            dest.spoilAt = mergeSpoilAt(destN, dest.spoilAt, n, srcAt);
            delete dest.spoilLeft;
        }
        if (typeof mergeDryInto === "function") mergeDryInto(dest, destN, n, src.dryProgress);
        if (typeof mergeSoakInto === "function") mergeSoakInto(dest, destN, n, src.soakProgress);
        if (typeof mergeTempInto === "function") mergeTempInto(dest, destN, n, src.temp);
    }

    _compactBasket(entry, getItem) {
        const bag = this._storageEntry(entry);
        const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
        if (!SF?.compactSlots || !bag?.slots) return false;
        return SF.compactSlots(bag.slots, getItem, (d, s, n) => this._stackExtras(d, s, n));
    }

    _mergeDestWants(dest) {
        const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
        if (!SF?.existingStackRoom || !dest) return false;
        const getItem = (id) => this.pawn.scene.getItem?.(id);
        const want = (s) => s && SF.existingStackRoom(dest.slots, s, getItem) > 0;
        return (this.pawn.inventory || []).some(want) || (this.pawn.overflow || []).some(want);
    }

    _doHaulMerge(job, settle, ts, delta) {
        const pawn = this.pawn;
        const getItem = (id) => pawn.scene.getItem?.(id);
        const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
        const key = this._mergeJobKey(job);
        if (!job || !SF) {
            this._halt(pawn);
            return;
        }
        if (job.kind === "pack") {
            const basket = job.basket;
            if (!basket) {
                this._failHaul(settle, key);
                return;
            }
            if (!this._goOrAbort(basket, settle, key, ts, delta)) return;
            const packed = this._compactBasket(basket, getItem);
            if (SF.needsCompact?.(basket.slots, getItem)) this._failHaul(settle, key);
            else if (this._workScan) this._workScan.haulMerge = null;
            if (packed) pawn.scene.settlementSys?.bumpWorkCache?.();
            return;
        }
        const src = job.from;
        const dest = job.to;
        const idx = job.fromIndex;
        const stack = src?.slots?.[idx];
        if (!src || !dest || !stack) {
            this._failHaul(settle, key);
            return;
        }
        if (!this._goOrAbort(src, settle, key, ts, delta)) return;
        const room = SF.existingStackRoom(dest.slots, stack, getItem);
        const n = Math.min(Number(stack.quantity) || 1, room);
        if (!(n > 0)) {
            this._failHaul(settle, key);
            return;
        }
        let carry;
        if (n === (Number(stack.quantity) || 1)) {
            src.slots[idx] = null;
            carry = stack;
        } else if (typeof cloneItemStack === "function") {
            carry = cloneItemStack(stack);
            carry.quantity = n;
            stack.quantity = (Number(stack.quantity) || 1) - n;
        } else {
            carry = { id: stack.id, quantity: n };
            if (stack.spoilAt != null) carry.spoilAt = stack.spoilAt;
            stack.quantity = (Number(stack.quantity) || 1) - n;
        }
        const bag = { slots: pawn.inventory };
        if (!pawn.inventory || !this._insertInEntry(bag, carry, getItem)) {
            if (src.slots[idx]) {
                src.slots[idx].quantity = (Number(src.slots[idx].quantity) || 1)
                    + (Number(carry.quantity) || 1);
            } else {
                src.slots[idx] = carry;
            }
            this._failHaul(settle, key);
            return;
        }
        this._haulDest = dest;
        this._haulMergeFrom = src;
        this._haulMergeOnly = true;
        this._haulMergeId = carry.id;
        this._haulWhat = this._haulNoun(carry);
        pawn.scene.settlementSys?.bumpWorkCache?.();
    }

    _doMergeDeliver(dest, settle, ts, delta) {
        const pawn = this.pawn;
        if (!dest) {
            this._halt(pawn);
            return;
        }
        if (!this._goOrAbort(dest, settle, this._stashKey(dest), ts, delta)) return;
        const getItem = (id) => pawn.scene.getItem?.(id);
        const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
        const extras = (d, s, n) => this._stackExtras(d, s, n);
        const dump = (slots) => {
            if (!slots || !SF?.absorbStack) return;
            for (let i = 0; i < slots.length; i++) {
                const s = slots[i];
                if (!s || !SF.isMergeableStack(s)) continue;
                if (!SF.absorbStack(dest.slots, s, getItem, extras)) continue;
                if (!(Number(s.quantity) > 0)) slots[i] = null;
            }
        };
        dump(pawn.inventory);
        dump(pawn.overflow);
        this._compactBasket(dest, getItem);
        const src = this._haulMergeFrom;
        const mergeId = this._haulMergeId;
        if (src && src !== dest && mergeId) {
            const putBack = (slots) => {
                if (!slots) return;
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    if (!s || s.id !== mergeId) continue;
                    if (SF?.existingStackRoom?.(dest.slots, s, getItem) > 0) continue;
                    if (this._insertInEntry(src, s, getItem)) slots[i] = null;
                }
            };
            putBack(pawn.inventory);
            putBack(pawn.overflow);
        }
        pawn.scene.settlementSys?.bumpWorkCache?.();
    }

    _haulHasCargo(settle, keepBandage) {
        if (!settle) return false;
        return !!this._stashScan(settle, keepBandage).has;
    }

    _doHaul(drop, settle, ts, delta) {
        const pawn = this.pawn;
        const key = this._dropKey(drop);
        if (!drop?.active) {
            this._failHaul(settle, key);
            return;
        }
        if (!this._goOrAbort(drop, settle, key, ts, delta)) return;
        if (!this._settlerCanTakeDrop(drop)) {
            this._depositKeepGear(settle, !!this._workScan?.keepBandage);
        }
        const stack = this._dropAsStack(drop);
        const basket = stack ? this._pickHaulBasket(settle, stack) : null;
        if (!this._settlerCanTakeDrop(drop) || !stack || !basket) {
            this._failHaul(settle, key);
            return;
        }
        const took = typeof drop.tryPickup === "function"
            ? drop.tryPickup(pawn)
            : !!drop.pickUpBy?.(pawn);
        if (!took) {
            this._failHaul(settle, key);
            return;
        }
        this._haulDest = basket;
        this._haulWhat = this._haulNoun(stack);
        this._haulMergeOnly = false;
        pawn.scene.settlementSys?.bumpWorkCache?.();
    }

    _stashScan(settle, keepBandage) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const pawn = this.pawn;
        const getItem = (id) => pawn.scene.getItem?.(id);
        const canStore = (s) => !!this._pickHaulBasket(settle, s);
        const opts = { keepBandage: !!keepBandage };
        if (!S?.hasStashable || !S.hasStashable(pawn.inventory, pawn.overflow, getItem, canStore, opts)) {
            return { basket: null, has: false, urgent: false };
        }
        const keep = S.keepIndices(pawn.inventory, getItem, opts);
        let basket = null;
        const tryPick = (s) => {
            if (!s || basket) return;
            basket = this._pickHaulBasket(settle, s);
        };
        for (let i = 0; i < (pawn.inventory || []).length; i++) {
            if (keep.has(i)) continue;
            tryPick(pawn.inventory[i]);
        }
        for (const s of pawn.overflow || []) tryPick(s);
        return {
            basket,
            has: !!basket,
            urgent: !!S.stashIsUrgent(pawn.inventory, pawn.overflow, getItem, canStore, opts)
        };
    }

    _doStash(basket, settle, ts, delta, keepBandage) {
        const pawn = this.pawn;
        if (!basket) {
            this._halt(pawn);
            return;
        }
        if (!this._goOrAbort(basket, settle, this._stashKey(basket), ts, delta)) return;
        this._depositKeepGear(settle, keepBandage);
        const getItem = (id) => pawn.scene.getItem?.(id);
        this._compactBasket(basket, getItem);
        pawn.scene.settlementSys?.bumpWorkCache?.();
    }

    _doDoctor(patient, settle, ts, delta) {
        const pawn = this.pawn;
        const scene = pawn.scene;
        this.setTendSeek(null);
        const tendKey = this._pawnWorkKey(patient, "tend");
        if (!this._patientNeedsTend(patient)) {
            this._dropPatient(patient, false);
            this._adoptClaim(settle, null);
            this._halt(pawn);
            return;
        }
        const found = this._findStack(settle, (s) => !!scene.getItem?.(s.id)?.bandage);
        if (!found) {
            if (this._workScan) {
                this._workScan.patients = [];
                this._workScan.keepBandage = false;
            }
            this._adoptClaim(settle, null);
            this._halt(pawn);
            return;
        }
        if (found.at !== pawn) {
            if (!this._goOrAbort(found.at, settle, tendKey, ts, delta)) {
                if (this._jobSkipped(tendKey)) this._dropPatient(patient, false);
                return;
            }
            this._depositKeepGear(settle, true);
            if (!this._fetchStack(found, ts, 0)) {
                this._dropPatient(patient);
                this._adoptClaim(settle, null);
                this._halt(pawn);
            }
            return;
        }
        pawn.hotbarIndex = found.index;
        const P = typeof Party !== "undefined" ? Party : null;
        const inRange = P?.inInteractRange
            ? P.inInteractRange(pawn, patient, ts)
            : this._near(patient, ts);
        if (!inRange) {
            if (this._abortIfStuck(settle, tendKey)) {
                this._dropPatient(patient, false);
                return;
            }
            const dist = Math.hypot((pawn.x || 0) - (patient.x || 0), (pawn.y || 0) - (patient.y || 0));
            this._walkToward(pawn, patient.x, patient.y, ts, dist > ts * 6, delta);
            return;
        }
        this._halt(pawn);
        if (pawn._tendChannel && !pawn._tendChannel.corpse) return;
        const started = pawn.beginTend?.(patient, {
            slot: found.index,
            bag: "hotbar",
            sourcePawn: pawn,
            silent: true
        });
        if (!started) {
            this._dropPatient(patient);
            this._adoptClaim(settle, null);
        }
    }

    _depositKeepGear(settle, keepBandage) {
        const pawn = this.pawn;
        const getItem = (id) => pawn.scene.getItem?.(id);
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const keep = S?.keepIndices
            ? S.keepIndices(pawn.inventory, getItem, { keepBandage: !!keepBandage })
            : new Set();
        const dump = (slots, skipKeep) => {
            if (!slots) return;
            for (let i = 0; i < slots.length; i++) {
                if (skipKeep && keep.has(i)) continue;
                const s = slots[i];
                if (!s) continue;
                const b = this._pickHaulBasket(settle, s);
                if (!b) continue;
                if (this._insertInEntry(b, s, getItem)) slots[i] = null;
            }
        };
        dump(pawn.inventory, true);
        dump(pawn.overflow, false);
        this._pickBestWeapon();
    }

    _depositMatching(settle) {
        this._depositKeepGear(settle, false);
    }

    _insertInEntry(entry, stack, getItem) {
        const bag = this._storageEntry(entry);
        if (!bag?.slots || !stack) return false;
        const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
        const slots = bag.slots;
        if (SF?.absorbStack) {
            SF.absorbStack(slots, stack, getItem, (d, s, n) => this._stackExtras(d, s, n));
            if (!(Number(stack.quantity) > 0)) {
                this._compactBasket(bag, getItem);
                return true;
            }
        } else {
            const meta = typeof getItem === "function" ? getItem(stack.id) : null;
            const max = Math.max(1, meta?.maxStack || 99);
            const special = !!(stack.customName || stack.food || stack.ingredients || stack.toolClass);
            if (!special) {
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    if (s && s.id === stack.id && !s.customName && !s.toolClass
                        && (s.quantity || 1) < max) {
                        const space = max - (s.quantity || 1);
                        const n = Math.min(space, stack.quantity || 1);
                        s.quantity = (s.quantity || 1) + n;
                        stack.quantity = (stack.quantity || 1) - n;
                        if (!(stack.quantity > 0)) return true;
                    }
                }
            }
        }
        const empty = slots.findIndex((x) => !x);
        if (empty >= 0) {
            slots[empty] = stack;
            this._compactBasket(bag, getItem);
            return true;
        }
        this._compactBasket(bag, getItem);
        return false;
    }

    _faceToward(pawn, x, y) {
        if (!pawn) return;
        const dx = x - pawn.x;
        const dy = y - pawn.y;
        if (!(dx || dy)) return;
        if (Math.abs(dx) > Math.abs(dy)) pawn.facing = dx > 0 ? "right" : "left";
        else pawn.facing = dy > 0 ? "down" : "up";
    }

    _fireStandPoint(fire, ts) {
        const pawn = this.pawn;
        const cell = ts || 16;
        const fx = fire.x;
        const fy = fire.y;
        const uid = fire.entry?.uid || `${Math.round(fx)}:${Math.round(fy)}`;
        if (this._fireStandKey === uid && this._fireStand) {
            const s = this._fireStand;
            if (Math.hypot(s.x - fx, s.y - fy) < cell * 1.75) return s;
        }
        const dist = cell * 1.15;
        const dirs = [
            { x: fx, y: fy + dist },
            { x: fx - dist, y: fy },
            { x: fx + dist, y: fy },
            { x: fx, y: fy - dist }
        ];
        const blocked = (px, py) => (typeof pawnPoseBlocked === "function"
            ? pawnPoseBlocked(pawn, px, py, 1)
            : false);
        let pick = dirs.find((p) => !blocked(p.x, p.y));
        if (!pick && typeof Path !== "undefined" && Path.openPoint) {
            pick = Path.openPoint(fx, fy + dist, blocked, cell, this._avoidSide, 3);
        }
        pick = pick || dirs[0];
        this._fireStand = pick;
        this._fireStandKey = uid;
        return pick;
    }

    _goToFireStand(fire, ts, delta) {
        const pawn = this.pawn;
        if (this._near(fire, ts)) {
            this._faceToward(pawn, fire.x, fire.y - 8);
            this._halt(pawn);
            return true;
        }
        const stand = this._fireStandPoint(fire, ts);
        this._walkToward(pawn, stand.x, stand.y, ts, false, delta);
        return false;
    }

    _doLightFire(fire, settle, ts, delta) {
        if (!fire?.active) {
            this._halt(this.pawn);
            return;
        }
        if (!this._goToFireStand(fire, ts, delta)) return;
        if (fire.hasFuel?.() || this._stokeFuel(fire, settle)) {
            fire.setKind?.("campfire");
            fire.ensureBurning?.();
            this.pawn.scene.markLightDirty?.();
        }
    }

    _stokeFuel(fire, settle) {
        const take = (slots) => {
            const i = (slots || []).findIndex((s) => s && (s.id === "stick" || s.id === "log"));
            if (i < 0) return null;
            const s = slots[i];
            s.quantity = (s.quantity || 1) - 1;
            if (!(s.quantity > 0)) slots[i] = null;
            return s.id;
        };
        let id = take(this.pawn.inventory);
        if (!id) {
            for (const b of this.pawn.scene.settlementSys.addedBaskets(settle)) {
                id = take(b.slots);
                if (id) break;
            }
        }
        if (!id) return false;
        fire.setFuel?.(0, { id, quantity: 1 });
        return true;
    }

    _findStack(settle, pred) {
        const inv = this.pawn.inventory || [];
        const ii = inv.findIndex((s) => s && pred(s));
        if (ii >= 0) return { slots: inv, index: ii, at: this.pawn };
        return this._findBasketStack(settle, pred);
    }

    _findBasketStack(settle, pred) {
        const sys = this.pawn.scene.settlementSys;
        for (const b of sys?.addedBaskets(settle) || []) {
            const slots = b.slots || [];
            const i = slots.findIndex((s) => s && pred(s));
            if (i < 0) continue;
            const spr = (b.uid && sys.findThingByUid?.(b.uid)) || null;
            return { slots, index: i, at: spr || b };
        }
        return null;
    }

    _givePawn(stack) {
        const inv = this.pawn.inventory || [];
        const empty = inv.findIndex((s) => !s);
        if (empty < 0) return false;
        inv[empty] = stack;
        return true;
    }

    _takeFound(found) {
        if (!found) return null;
        const stack = found.slots[found.index];
        found.slots[found.index] = null;
        return stack || null;
    }

    _fetchStack(found, ts, delta) {
        if (!found) return null;
        if (found.at !== this.pawn && !this._goToTarget(found.at, ts, delta)) return null;
        const stack = this._takeFound(found);
        if (!stack) return null;
        if (found.at !== this.pawn && !this._givePawn(stack)) {
            found.slots[found.index] = stack;
            return null;
        }
        return stack;
    }

    _putInBasket(settle, stack) {
        const getItem = (id) => this.pawn.scene.getItem?.(id);
        const b = this._pickHaulBasket(settle, stack);
        if (b && this._insertInEntry(b, stack, getItem)) return true;
        return this._givePawn(stack);
    }

    _persistBills(settle, fire) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const uid = fire?.entry?.uid;
        if (!S || !settle || !uid) return;
        this.pawn.scene.settlementSys?.sendNet("setBills", {
            settlementId: settle.id,
            stationUid: uid,
            bills: S.billsOf(settle, uid)
        });
    }

    _doCook(job, settle, ts, delta) {
        const fire = job?.fire;
        const bill = job?.bill;
        const pawn = this.pawn;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!fire?.active || !bill || !S) {
            this._halt(pawn);
            return;
        }
        const method = bill.method || "stick_roast";
        if (method === "shell_simmer") {
            this._doSimmer(job, settle, ts, delta);
            return;
        }
        const getItem = (id) => pawn.scene.getItem?.(id);
        const cook = fire.getCook?.();

        if (cook && S.cookOutputReady(getItem, cook, bill)) {
            if (!this._goToFireStand(fire, ts, delta)) return;
            fire.setCook?.(null);
            if (this._putInBasket(settle, cook)) S.noteBillCrafted(bill);
            this._persistBills(settle, fire);
            return;
        }

        if (cook && S.cookInputReady(getItem, cook, bill)) {
            if (!this._goToFireStand(fire, ts, delta)) return;
            if (!fire.isLit?.()) this._doLightFire(fire, settle, ts, delta);
            else if (!fire.hasFuel?.()) this._stokeFuel(fire, settle);
            return;
        }

        if (!fire.isLit?.()) {
            this._doLightFire(fire, settle, ts, delta);
            return;
        }
        if (!fire.hasFuel?.()) {
            if (!this._goToFireStand(fire, ts, delta)) return;
            this._stokeFuel(fire, settle);
            return;
        }

        const cat = fire.getCatalyst?.();
        if (!S.isCookTool(getItem, cat, method)) {
            if (cat && !cook) {
                if (!this._goToFireStand(fire, ts, delta)) return;
                fire.setCatalyst?.(null);
                this._putInBasket(settle, cat);
                return;
            }
            const found = this._findStack(settle, (s) => S.isCookTool(getItem, s, method));
            if (!found) {
                this._halt(pawn);
                return;
            }
            if (found.at !== pawn) {
                this._fetchStack(found, ts, delta);
                return;
            }
            if (!this._goToFireStand(fire, ts, delta)) return;
            fire.setCatalyst?.(this._takeFound(found));
            return;
        }

        if (!cook) {
            const found = this._findStack(settle, (s) => S.cookInputReady(getItem, s, bill));
            if (!found) {
                this._halt(pawn);
                return;
            }
            if (found.at !== pawn) {
                this._fetchStack(found, ts, delta);
                return;
            }
            if (!this._goToFireStand(fire, ts, delta)) return;
            fire.setCook?.(this._takeFound(found));
            return;
        }

        if (!this._goToFireStand(fire, ts, delta)) return;
        if (!fire.hasFuel?.()) this._stokeFuel(fire, settle);
    }

    _simmerEmptyIndex(fire) {
        for (let i = 0; i < 4; i++) {
            if (!fire.getSimmer?.(i)) return i;
        }
        return -1;
    }

    _doSimmer(job, settle, ts, delta) {
        const fire = job?.fire;
        const bill = job?.bill;
        const pawn = this.pawn;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!fire?.active || !bill || !S) {
            this._halt(pawn);
            return;
        }
        const getItem = (id) => pawn.scene.getItem?.(id);
        const method = "shell_simmer";
        const cat = fire.getCatalyst?.();
        const minSlots = S.SIMMER_MIN_SLOTS || 2;

        if (S.cookOutputReady(getItem, cat, bill)) {
            if (!this._goToFireStand(fire, ts, delta)) return;
            fire.setCatalyst?.(null);
            if (this._putInBasket(settle, cat)) S.noteBillCrafted(bill);
            this._persistBills(settle, fire);
            return;
        }

        if (!fire.isLit?.()) {
            this._doLightFire(fire, settle, ts, delta);
            return;
        }
        if (!fire.hasFuel?.()) {
            if (!this._goToFireStand(fire, ts, delta)) return;
            this._stokeFuel(fire, settle);
            return;
        }

        if (!S.isCookTool(getItem, cat, method)) {
            if (cat && !fire.hasSimmerContents?.()) {
                if (!this._goToFireStand(fire, ts, delta)) return;
                fire.setCatalyst?.(null);
                this._putInBasket(settle, cat);
                return;
            }
            if (cat) {
                this._halt(pawn);
                return;
            }
            const found = this._findStack(settle, (s) => S.isCookTool(getItem, s, method));
            if (!found) {
                this._halt(pawn);
                return;
            }
            if (found.at !== pawn) {
                this._fetchStack(found, ts, delta);
                return;
            }
            if (!this._goToFireStand(fire, ts, delta)) return;
            fire.setCatalyst?.(this._takeFound(found));
            return;
        }

        const empty = this._simmerEmptyIndex(fire);
        const filled = fire.simmerFilledCount?.() || 0;
        if (empty >= 0) {
            const found = this._findStack(settle, (s) => S.cookInputReady(getItem, s, bill));
            if (found) {
                if (found.at !== pawn) {
                    this._fetchStack(found, ts, delta);
                    return;
                }
                if (!this._goToFireStand(fire, ts, delta)) return;
                const one = this._takeOne(found);
                if (one) fire.setSimmer?.(empty, one);
                return;
            }
        }
        if (filled >= minSlots) {
            if (!this._goToFireStand(fire, ts, delta)) return;
            if (!fire.hasFuel?.()) this._stokeFuel(fire, settle);
            return;
        }
        this._halt(pawn);
    }

    _takeOne(found) {
        if (!found) return null;
        const stack = found.slots[found.index];
        if (!stack) return null;
        if ((stack.quantity || 1) <= 1) {
            found.slots[found.index] = null;
            return stack;
        }
        stack.quantity -= 1;
        return { ...stack, quantity: 1 };
    }

    _doLeather(job, settle, ts, delta) {
        const pawn = this.pawn;
        if (!job) {
            this._halt(pawn);
            return;
        }
        const kind = job.kind;
        if (kind === "bench") {
            this._doBenchBill(job, settle, ts, delta);
            return;
        }
        if (kind === "soak_pickup") {
            this._doSoakPickup(job, settle, ts, delta);
            return;
        }
        if (kind === "soak_drop") {
            this._doSoakDrop(job, settle, ts, delta);
            return;
        }
        const rack = job.station;
        if (!rack?.active) {
            this._halt(pawn);
            return;
        }
        if (kind === "unload") {
            this._doRackUnload(job, settle, ts, delta);
            return;
        }
        if (kind === "hang") {
            this._doRackHang(job, settle, ts, delta);
            return;
        }
        if (kind === "work") {
            this._doRackWork(job, settle, ts, delta);
            return;
        }
        if (!this._goOrAbort(rack, settle, this._stationKey(rack), ts, delta)) return;
    }

    _holdFound(found) {
        if (!found || found.at !== this.pawn) return false;
        this.pawn.hotbarIndex = found.index;
        return true;
    }

    _doRackUnload(job, settle, ts, delta) {
        const rack = job.station;
        const bill = job.bill;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!this._goOrAbort(rack, settle, this._stationKey(rack), ts, delta)) return;
        const hang = this._rackHang(rack);
        if (!hang) {
            this._halt(this.pawn);
            return;
        }
        rack.setSlot?.(0, null);
        if (this._putInBasket(settle, hang) && S) S.noteBillCrafted(bill);
        this._persistBills(settle, rack);
    }

    _doRackHang(job, settle, ts, delta) {
        const rack = job.station;
        const bill = job.bill;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const getItem = (id) => this.pawn.scene.getItem?.(id);
        if (this._rackHang(rack)) return;
        const found = this._findStack(settle, (s) => S.hideAllowsStack?.(bill, s, getItem));
        if (!found) {
            this._halt(this.pawn);
            return;
        }
        if (found.at !== this.pawn) {
            this._fetchStack(found, ts, delta);
            return;
        }
        if (!this._goOrAbort(rack, settle, this._stationKey(rack), ts, delta)) return;
        const one = this._takeOne(found);
        if (one) rack.setSlot?.(0, one);
    }

    _doRackWork(job, settle, ts, delta) {
        const rack = job.station;
        const bill = job.bill;
        const pawn = this.pawn;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const method = bill.method;
        const need = S.hideToolNeed?.(method);
        if (pawn._fleshChannel || pawn._brainChannel) {
            this._halt(pawn);
            return;
        }
        if (need === "scraper") {
            const tool = this._findHideTool(settle, "scraper");
            if (!tool) {
                this._halt(pawn);
                return;
            }
            if (tool.at !== pawn) {
                this._fetchStack(tool, ts, delta);
                return;
            }
            this._holdFound(tool);
        } else if (need === "brain") {
            const brain = this._findBrain(settle);
            if (!brain) {
                this._halt(pawn);
                return;
            }
            if (brain.at !== pawn) {
                this._fetchStack(brain, ts, delta);
                return;
            }
            this._holdFound(brain);
        }
        if (!this._goOrAbort(rack, settle, this._stationKey(rack), ts, delta)) return;
        this._halt(pawn);
        if (need === "brain") pawn.beginBrain?.(rack);
        else pawn.beginFlesh?.(rack);
    }

    _doSoakPickup(job, settle, ts, delta) {
        const drop = job.drop;
        const bill = job.bill;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!drop?.active) {
            this._halt(this.pawn);
            return;
        }
        this.pawn._wadeWater = true;
        const key = this._dropKey(drop);
        if (!this._goOrAbort(drop, settle, key, ts, delta)) return;
        const took = typeof drop.tryPickup === "function"
            ? drop.tryPickup(this.pawn)
            : !!drop.pickUpBy?.(this.pawn);
        if (!took) {
            this._halt(this.pawn);
            return;
        }
        if (S) S.noteBillCrafted(bill);
        this._persistBills(settle, job.station);
    }

    _doSoakDrop(job, settle, ts, delta) {
        const rack = job.station;
        const bill = job.bill;
        const water = job.water;
        const pawn = this.pawn;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const getItem = (id) => pawn.scene.getItem?.(id);
        const scene = pawn.scene;
        const tsx = scene.tileSize || 16;
        if (!water) {
            this._halt(pawn);
            return;
        }

        let found = this._findStack(settle, (s) => S.hideAllowsStack?.(bill, s, getItem));
        if (!found && job.fromRack && this._rackHang(rack) && S.hideAllowsStack?.(bill, this._rackHang(rack), getItem)) {
            if (!this._goOrAbort(rack, settle, this._stationKey(rack), ts, delta)) return;
            const hang = this._rackHang(rack);
            rack.setSlot?.(0, null);
            if (!this._givePawn(hang)) {
                rack.setSlot?.(0, hang);
                this._halt(pawn);
                return;
            }
            found = this._findStack(settle, (s) => S.hideAllowsStack?.(bill, s, getItem));
        }
        if (!found) {
            this._halt(pawn);
            return;
        }
        if (found.at !== pawn) {
            this._fetchStack(found, ts, delta);
            return;
        }
        const destX = water.x;
        const destY = water.y;
        const inWater = !!scene._isWaterAt?.(pawn.x, pawn.y - 1)
            || !!scene._isWaterAt?.(pawn.x, pawn.y);
        const arrive = Math.max(8, tsx * 0.85);
        if (!inWater || Math.hypot(pawn.x - destX, pawn.y - destY) > arrive) {
            this._walkToward(pawn, destX, destY, ts, false, delta, { wade: true });
            this._abortIfStuck(settle, this._stationKey(rack));
            return;
        }
        this._halt(pawn);
        const one = this._takeOne(found);
        if (!one) return;
        const meta = scene.getItem?.(one.id);
        if (!meta) {
            this._givePawn(one);
            return;
        }
        DroppedItem.spawn(
            scene,
            destX,
            destY,
            meta,
            one.quantity || 1,
            undefined,
            {
                dryProgress: one.dryProgress,
                soakProgress: one.soakProgress,
                soakDoneAt: one.soakDoneAt
            }
        );
    }

    _doBenchBill(job, settle, ts, delta) {
        const bench = job.station;
        const bill = job.bill;
        const pawn = this.pawn;
        const scene = pawn.scene;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const rec = this._benchRecipe(bill, scene);
        if (!rec || !bench?.active) {
            this._halt(pawn);
            return;
        }
        if (pawn._craftChannel) {
            this._halt(pawn);
            return;
        }
        const getItem = (id) => scene.getItem?.(id);
        for (const ing of rec.ingredients || []) {
            if (ing.hideStage) {
                const have = this._countPawnHide(pawn, bill, ing.hideStage, S);
                if (have >= (ing.qty || 1)) continue;
                const found = this._findBasketStack(settle, (s) => {
                    if (!s?.id) return false;
                    if (S.hideStageOf(getItem(s.id), s.id) !== ing.hideStage) return false;
                    return this._hideAllowed(bill, s, S);
                });
                if (found) {
                    this._fetchStack(found, ts, delta);
                    return;
                }
                continue;
            }
            if (!ing.id || ing.id === "ANY_HIDE" || ing.id === "ANY_LEATHER") continue;
            const have = pawn.getNumMatchingItems?.(ing) || 0;
            if (have >= (ing.qty || 1)) continue;
            const found = this._findBasketStack(settle, (s) => s?.id === ing.id);
            if (found) {
                this._fetchStack(found, ts, delta);
                return;
            }
        }
        const awl = this._findHideTool(settle, rec.requireTool?.toolClass || "awl");
        if (!awl) {
            this._halt(pawn);
            return;
        }
        if (awl.at !== pawn) {
            this._fetchStack(awl, ts, delta);
            return;
        }
        this._holdFound(awl);
        if (!this._goOrAbort(bench, settle, this._stationKey(bench), ts, delta)) return;
        this._halt(pawn);
        if (!scene.canCraft?.(rec, pawn)) return;
        const started = pawn.beginCraft?.(rec, bench);
        if (started && S) {
            S.noteBillCrafted(bill);
            this._persistBills(settle, bench);
        }
    }

    _idleNearHome(settle, ts, delta) {
        const pawn = this.pawn;
        if (!settle) {
            this._halt(pawn);
            return;
        }
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const home = S?.idleHome ? S.idleHome(settle) : { x: settle.x, y: settle.y + 8 };
        const distTiles = S?.idleRoamDistTiles
            ? S.idleRoamDistTiles(settle, pawn.x, pawn.y, ts)
            : Math.hypot(pawn.x - home.x, pawn.y - home.y) / (ts || 16);
        const hard = S?.IDLE_ROAM_HARD || 7;
        const wedged = this._overlappingThing(pawn)
            || pawnPoseBlocked?.(pawn, pawn.x, pawn.y, 0);
        if (distTiles >= hard) {
            this._strollMul = 0.5;
            this._walkToward(pawn, home.x, home.y, ts, false, delta);
            this._strollMul = null;
            return;
        }
        if (wedged) {
            this._nudgeIfDue(pawn, this._overlappingThing(pawn));
        }
        if (this._idleWanderState == null) this._beginSettlerIdle();
        this._idleWanderMs = (this._idleWanderMs || 0) - (delta || 16);
        if (this._idleWanderMs <= 0) {
            if (this._idleWanderState === "walk") this._beginSettlerIdle();
            else this._beginSettlerWalk(settle, ts);
        }
        if (this._idleWanderState !== "walk" || !this._idleWanderDest) {
            if (this._unstickFromMates(pawn, home, ts, ts * 2.5)) return;
            this._halt(pawn);
            return;
        }
        const dest = this._idleWanderDest;
        this._strollMul = 0.5;
        this._walkToward(pawn, dest.x, dest.y, ts, false, delta);
        this._strollMul = null;
        if (Math.hypot(pawn.x - dest.x, pawn.y - dest.y) <= (ts || 16) * 0.55) {
            this._beginSettlerIdle();
        }
    }

    _beginSettlerIdle() {
        this._idleWanderState = "idle";
        this._idleWanderDest = null;
        this._idleWanderMs = 1000 + Math.random() * 2000;
        this._path = null;
        this._pathGoalX = null;
        this._pathGoalY = null;
        this._halt(this.pawn);
    }

    _beginSettlerWalk(settle, ts) {
        const pawn = this.pawn;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        this._idleWanderState = "walk";
        this._idleWanderMs = 1000 + Math.random() * 1000;
        let dest = S?.idleRoamPoint
            ? S.idleRoamPoint(settle, Math.random, ts, pawn)
            : { x: settle.x + 12, y: settle.y + 10 };
        const blocked = (px, py) => (typeof pawnPoseBlocked === "function"
            ? pawnPoseBlocked(pawn, px, py, 1)
            : false);
        if (typeof Path !== "undefined" && Path.openPoint) {
            dest = Path.openPoint(dest.x, dest.y, blocked, ts || 16, this._avoidSide, 4);
        }
        this._idleWanderDest = dest;
        this._path = null;
    }

    _exitDir(mob, thing) {
        const tb = thing?.body;
        const body = mob.body;
        if (!tb || !body) return { nx: this._avoidSide || 1, ny: 0 };
        const cx = body.center.x;
        const cy = body.center.y;
        const exits = [
            { nx: -1, ny: 0, d: cx - tb.left, key: "l" },
            { nx: 1, ny: 0, d: tb.right - cx, key: "r" },
            { nx: 0, ny: -1, d: cy - tb.top, key: "u" },
            { nx: 0, ny: 1, d: tb.bottom - cy, key: "d" }
        ];
        exits.sort((a, b) => b.d - a.d);
        const id = thing.uid || `${thing.x}:${thing.y}`;
        if (this._escapeKey && this._escapeKey.startsWith(`${id}:`)) {
            const keep = exits.find((e) => this._escapeKey === `${id}:${e.key}`);
            if (keep && !pawnPoseBlocked?.(mob, mob.x + keep.nx * 8, mob.y + keep.ny * 8, 2)) {
                return keep;
            }
        }
        for (let i = 0; i < exits.length; i++) {
            const e = exits[i];
            if (pawnPoseBlocked?.(mob, mob.x + e.nx * 8, mob.y + e.ny * 8, 2)) continue;
            this._escapeKey = `${id}:${e.key}`;
            this._avoidSide = e.nx !== 0 ? e.nx : (e.ny || 1);
            return e;
        }
        const pick = exits[0];
        this._escapeKey = `${id}:${pick.key}`;
        this._avoidSide = pick.nx !== 0 ? pick.nx : (pick.ny || 1);
        return pick;
    }

    _overlappingThing(mob) {
        return (typeof overlappingThingSprite === "function")
            ? overlappingThingSprite(mob)
            : null;
    }
}
