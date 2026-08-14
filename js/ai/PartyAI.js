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
        this._lastPx = null;
        this._lastPy = null;
        this._escapeKey = null;
        this._path = null;
        this._pathGoalX = null;
        this._pathGoalY = null;
        this._pathRange = null;
        this._pathOpenRadius = null;
        this._atkCache = null;
        this._atkCacheMs = 0;
        this._holdFollow = true;
        this._prevFx = null;
        this._prevFy = null;
        this.eatSeek = null;
        this.LEASH_TILES = (typeof Party !== "undefined" && Party.COMBAT_LEASH) || 10;
        this.MELEE_RESUME_PAD = 3;
    }

    clearCombat() {
        this.assistTarget = null;
        this._clearCombatMove();
        this.eatSeek = null;
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
            pawn?.setVelocity?.(0, 0);
            return;
        }
        if (pawn.isControlled?.()) return;

        pawn.capacities = new Capacities(pawn.anatomy);
        pawn._refreshDownedState?.();
        if (pawn._bodyDead) return;

        if (pawn._resting) {
            this.setAssist(null);
            pawn.setVelocity(0, 0);
            if (typeof pinRestingCreature === "function") pinRestingCreature(pawn, scene);
            else {
                const spec = pawn.lastSleep;
                setCreatureRest?.(pawn, true, spec?.rot);
                pawn.syncSortDepth?.();
            }
            return;
        }

        if (pawn.isIncapacitated?.() || pawn.isImmobile?.() || pawn.isVomiting?.()) {
            this._clearCombatMove();
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

        if (this._tickEatSeek(delta, ts)) return;

        this._tickFollow(delta, ts, controlled);
    }

    setEatSeek(target) {
        this.eatSeek = target && !target.isBodyDead?.() ? target : null;
    }

    _tickEatSeek(delta, ts) {
        const pawn = this.pawn;
        const target = this.eatSeek;
        if (!target || target.isBodyDead?.() || !target.active) {
            this.eatSeek = null;
            return false;
        }
        if (pawn._eatChannel) {
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

    _shouldHoldForTend(pawn) {
        const ch = pawn._tendChannel;
        if (ch && !ch.corpse) return true;
        return !!pawn.scene?.partySys?._isBeingTended?.(pawn);
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
        if (overlap) nudgePawnOutOfThing?.(pawn, overlap);
        const overlapping = !!overlap;
        const jammedOnThing = overlapping || this._anyArcadeHit(pawn.body);
        const closeEnough = distPlayer <= idleR
            || (this._holdFollow && distPlayer < catchR && !jammedOnThing)
            || (this._stuckMs > 280 && distPlayer < catchR && !jammedOnThing);

        if (closeEnough && !overlapping) {
            this._holdFollow = true;
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
        this._escapeKey = null;
        this._path = null;
        this._pathGoalX = null;
        this._pathGoalY = null;
        this._pathOpenRadius = null;
        this._lastPx = null;
        this._lastPy = null;
        this._lastWpDist = null;
    }

    _separation(pawn, ts, wantTiles) {
        const scene = pawn.scene;
        let sx = 0;
        let sy = 0;
        const want = (wantTiles ?? (this.assistTarget ? 1.35 : 1.05)) * ts;
        for (const other of scene?.party || []) {
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

    _walkToward(pawn, tx, ty, ts, sprint, delta) {
        const overlap = this._overlappingThing(pawn);
        if (overlap) nudgePawnOutOfThing?.(pawn, overlap);
        const from = { x: pawn.x, y: pawn.y };
        const to = { x: tx, y: ty };
        const blocked = (x, y) => (typeof pawnPoseBlocked === "function"
            ? pawnPoseBlocked(pawn, x, y, 1)
            : false);
        const nav = typeof Path !== "undefined" ? Path : null;
        if (!nav?.steerToward) return;
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
            maxRange: this._pathRange || 12,
            dt: delta,
            overlapping: !!overlap,
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
            pawn.setVelocity?.(0, 0);
            return;
        }
        let nx = steered.nx;
        let ny = steered.ny;
        if (!this._path || !this._path.length) {
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
        if (pawn._eatChannel || pawn._tendChannel) mul *= 0.5;
        if (pawn.isAttacking?.()) mul *= 0.5;
        const speed =
            (pawn.speed || 3.5) *
            (scene.tileSize || 16) *
            (sprint ? pawn.sprintFactor || 1.5 : 1) *
            enc.speedMultiplier *
            (pawn.equipSpeedMultiplier || 1) *
            moveMul *
            mul *
            (scene.terrainSpeedMult?.(pawn.x, pawn.y - 1) ?? 1);
        applyEntityVelocity?.(pawn, nx * speed, ny * speed, scene.game?.loop?.delta || 16, scene);
        if (Math.abs(nx) > Math.abs(ny)) pawn.facing = nx > 0 ? "right" : "left";
        else if (ny !== 0) pawn.facing = ny > 0 ? "down" : "up";
        pawn.anims.timeScale = sprint ? 1.5 : 1;
        if (typeof PlayerLook !== "undefined") PlayerLook.play(pawn, pawn.facing, true);
        pawn.setDepth(pawn.y | 0);
        pawn.syncFxRoot?.();
    }

    _playIdle(pawn) {
        pawn.anims.timeScale = 1;
        if (typeof PlayerLook !== "undefined") PlayerLook.play(pawn, pawn.facing, false);
        pawn.syncFxRoot?.();
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
