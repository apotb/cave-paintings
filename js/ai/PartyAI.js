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
        this._noProgressMs = 0;
        this._lastPx = null;
        this._lastPy = null;
        this._escapeKey = null;
        this._path = null;
        this._pathMs = 0;
        this._pathGoalX = null;
        this._pathGoalY = null;
        this._unstick = null;
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
        const overlapping = !!this._overlappingThing(pawn);
        const jammedOnThing = overlapping || this._anyArcadeHit(pawn.body);
        const closeEnough = distPlayer <= idleR
            || (this._holdFollow && distPlayer < catchR && !jammedOnThing)
            || (this._noProgressMs > 280 && distPlayer < catchR && !jammedOnThing);

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
        this._noProgressMs = 0;
        this._escapeKey = null;
        this._path = null;
        this._pathMs = 0;
        this._pathGoalX = null;
        this._pathGoalY = null;
        this._unstick = null;
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
        const from = pawn.body?.center || pawn;
        if (this._pointBlocked(from.x + wx * 10, from.y + wy * 10, pawn)) return false;
        pawn.isSprinting = false;
        this._applyWalk(pawn, wx, wy, false);
        return true;
    }

    _walkToward(pawn, tx, ty, ts, sprint, delta) {
        this._noteProgress(pawn, delta);
        const body = pawn.body;
        const from = body?.center
            ? { x: body.center.x, y: body.center.y }
            : { x: pawn.x, y: pawn.y };
        // Callers pass a feet-origin target; collide/path at the body center.
        const want = {
            x: tx + (from.x - pawn.x),
            y: ty + (from.y - pawn.y)
        };
        const open = this._openPoint(want.x, want.y, ts, pawn);
        const overlap = this._overlappingThing(pawn);
        if (overlap && !this._keepPathOnOverlap) {
            this._path = null;
            nudgePawnOutOfThing?.(pawn, overlap);
            if (this._overlappingThing(pawn)) {
                const around = this._exitDir(pawn, overlap);
                pawn.isSprinting = !!sprint && pawn.kc > 0 && !pawn.getEncumbrance?.().cannotSprint;
                this._applyWalk(pawn, around.nx, around.ny, pawn.isSprinting);
                return;
            }
        }
        this._escapeKey = null;

        const stalled = this._noProgressMs > 140;
        const look = Math.max(8, this._clearance(pawn) + 4);
        const odx = open.x - from.x;
        const ody = open.y - from.y;
        const olen = Math.hypot(odx, ody) || 1;
        const blockedAhead = olen > 4 && !this._losPoints(
            from.x,
            from.y,
            from.x + (odx / olen) * look,
            from.y + (ody / olen) * look,
            pawn
        );
        const los = !stalled && !this._unstick && !blockedAhead
            && this._losPoints(from.x, from.y, open.x, open.y, pawn);
        const goalDrift = this._pathGoalX == null
            || Math.hypot(open.x - this._pathGoalX, open.y - this._pathGoalY) > 28;
        if (los) {
            this._path = null;
            this._pathMs = 0;
        } else if (!this._path || !this._path.length || goalDrift || stalled
            || this._pathMs > (this._pathRefreshMs || 800)) {
            this._path = this._planPath(pawn, open.x, open.y, ts);
            this._pathGoalX = open.x;
            this._pathGoalY = open.y;
            this._pathMs = 0;
        } else {
            this._pathMs += delta;
        }

        if (this._path && this._path.length) {
            while (
                this._path.length
                && Math.hypot(from.x - this._path[0].x, from.y - this._path[0].y) < 10
            ) {
                this._path.shift();
            }
        }

        let gx = open.x;
        let gy = open.y;
        if (this._path && this._path.length) {
            gx = this._path[0].x;
            gy = this._path[0].y;
        } else if (los) {
            const sep = this._separation(pawn, ts);
            gx += sep.sx * ts * 0.5;
            gy += sep.sy * ts * 0.5;
        } else {
            const corner = this._escapeCorner(pawn, open.x, open.y, ts);
            if (corner) {
                gx = corner.x;
                gy = corner.y;
            }
        }

        let dx = gx - from.x;
        let dy = gy - from.y;
        let dist = Math.hypot(dx, dy) || 1;
        let nx = dx / dist;
        let ny = dy / dist;
        const jammed = stalled || this._blockedInDir(body, nx, ny);
        if (this._unstick && Math.hypot(from.x - this._unstick.x, from.y - this._unstick.y) < 10) {
            this._unstick = null;
        }
        if (jammed || this._unstick) {
            const corner = this._unstick || this._escapeCorner(pawn, open.x, open.y, ts);
            if (corner) {
                dx = corner.x - from.x;
                dy = corner.y - from.y;
                dist = Math.hypot(dx, dy) || 1;
                nx = dx / dist;
                ny = dy / dist;
            }
        }

        if (stalled) {
            const slid = slidePawnAroundThings?.(
                pawn, nx, ny, 4, this._noProgressMs > 400, this._avoidSide
            );
            if (slid) {
                nx = slid.nx;
                ny = slid.ny;
                this._avoidSide = nx !== 0 ? Math.sign(nx) : (ny || 1);
            } else {
                const free = findFreePawnPose?.(pawn, 80);
                if (free) {
                    teleportPawnPose?.(pawn, free.x, free.y);
                    this._noProgressMs = 0;
                    this._path = null;
                    this._unstick = null;
                }
            }
        }

        pawn.isSprinting = !!sprint && pawn.kc > 0 && !pawn.getEncumbrance?.().cannotSprint;
        this._applyWalk(pawn, nx, ny, pawn.isSprinting);
    }

    _clearance(pawn) {
        const body = pawn?.body;
        if (body && body.right > body.left) {
            const hw = (body.right - body.left) * 0.5;
            const hh = (body.bottom - body.top) * 0.5;
            return Math.max(hw, hh) + 3;
        }
        return Math.max(6, (pawn?.hitboxSize || 8) * 0.5 + 3);
    }

    _cellCenter(cx, cy, cell) {
        return { x: cx * cell + cell * 0.5, y: cy * cell + cell * 0.5 };
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

    _touchingThing(pawn) {
        const scene = pawn?.scene;
        const body = pawn?.body;
        if (!body || !scene?._things) return null;
        const pad = 3;
        const things = scene._things.getChildren();
        let best = null;
        let bestD = Infinity;
        for (let i = 0; i < things.length; i++) {
            const t = things[i];
            const tb = t?.body;
            if (!tb || !tb.enable || pawnIgnoresThing?.(pawn, t)) continue;
            if (!(body.right + pad > tb.left && body.left - pad < tb.right
                && body.bottom + pad > tb.top && body.top - pad < tb.bottom)) {
                continue;
            }
            const tcx = (tb.left + tb.right) * 0.5;
            const tcy = (tb.top + tb.bottom) * 0.5;
            const d = Math.hypot(body.center.x - tcx, body.center.y - tcy);
            if (d < bestD) {
                bestD = d;
                best = t;
            }
        }
        return best;
    }

    _escapeCorner(pawn, destX, destY, ts) {
        const from = pawn.body?.center || pawn;
        if (this._unstick) {
            const u = this._unstick;
            if (Math.hypot(from.x - u.x, from.y - u.y) >= 10 && !this._pointBlocked(u.x, u.y, pawn)) {
                return u;
            }
        }
        const thing = this._overlappingThing(pawn) || this._touchingThing(pawn);
        const tb = thing?.body;
        const pad = this._clearance(pawn) + 6;
        const corners = [];
        if (tb) {
            corners.push(
                { x: tb.left - pad, y: tb.top - pad },
                { x: tb.right + pad, y: tb.top - pad },
                { x: tb.left - pad, y: tb.bottom + pad },
                { x: tb.right + pad, y: tb.bottom + pad }
            );
        } else {
            const side = this._avoidSide || 1;
            corners.push(
                { x: from.x + side * (ts || 16), y: from.y },
                { x: from.x, y: from.y + side * (ts || 16) },
                { x: from.x - side * (ts || 16), y: from.y },
                { x: from.x, y: from.y - side * (ts || 16) }
            );
        }
        let best = null;
        let bestCost = Infinity;
        for (const c of corners) {
            if (this._pointBlocked(c.x, c.y, pawn)) continue;
            const cost =
                Math.hypot(c.x - from.x, c.y - from.y)
                + Math.hypot(c.x - destX, c.y - destY) * 0.7;
            if (cost < bestCost) {
                bestCost = cost;
                best = c;
            }
        }
        if (best) this._unstick = best;
        return best;
    }

    _nearbyBodies(pawn, radius) {
        const scene = pawn?.scene;
        const body = pawn?.body;
        if (!body || !scene?._things) return [];
        const cx = body.center.x;
        const cy = body.center.y;
        const out = [];
        const things = scene._things.getChildren();
        for (let i = 0; i < things.length; i++) {
            const t = things[i];
            const tb = t?.body;
            if (!tb || !tb.enable || pawnIgnoresThing?.(pawn, t)) continue;
            const tcx = (tb.left + tb.right) * 0.5;
            const tcy = (tb.top + tb.bottom) * 0.5;
            if (Math.abs(tcx - cx) > radius || Math.abs(tcy - cy) > radius) continue;
            out.push(tb);
        }
        return out;
    }

    _planPath(pawn, destX, destY, ts) {
        const cell = ts || 16;
        const from = pawn.body?.center
            ? { x: pawn.body.center.x, y: pawn.body.center.y }
            : { x: pawn.x, y: pawn.y };
        const solids = this._nearbyBodies(pawn, cell * 13);
        const half = this._clearance(pawn);
        const blockedAt = (wx, wy) => {
            for (let i = 0; i < solids.length; i++) {
                const tb = solids[i];
                if (wx + half > tb.left && wx - half < tb.right
                    && wy + half > tb.top && wy - half < tb.bottom) {
                    return true;
                }
            }
            return false;
        };
        const sx = Math.floor(from.x / cell);
        const sy = Math.floor(from.y / cell);
        const gx = Math.floor(destX / cell);
        const gy = Math.floor(destY / cell);
        if (sx === gx && sy === gy) return [{ x: destX, y: destY }];

        const keyOf = (cx, cy) => `${cx},${cy}`;
        const came = new Map();
        came.set(keyOf(sx, sy), null);
        const q = [[sx, sy]];
        let found = null;
        let best = [sx, sy];
        let bestH = Math.abs(gx - sx) + Math.abs(gy - sy);
        const maxR = this._pathRange || 12;
        const dirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        let steps = 0;
        while (q.length && steps < 280) {
            const cur = q.shift();
            const cx = cur[0];
            const cy = cur[1];
            steps++;
            const h = Math.abs(gx - cx) + Math.abs(gy - cy);
            if (h < bestH) {
                bestH = h;
                best = cur;
            }
            if (cx === gx && cy === gy) {
                found = cur;
                break;
            }
            for (let d = 0; d < dirs.length; d++) {
                const nx = cx + dirs[d][0];
                const ny = cy + dirs[d][1];
                if (Math.abs(nx - sx) > maxR || Math.abs(ny - sy) > maxR) continue;
                const k = keyOf(nx, ny);
                if (came.has(k)) continue;
                const goalCell = nx === gx && ny === gy;
                const pos = this._cellCenter(nx, ny, cell);
                if (!goalCell && blockedAt(pos.x, pos.y)) continue;
                const dx = dirs[d][0];
                const dy = dirs[d][1];
                if (dx && dy) {
                    const sideX = this._cellCenter(cx + dx, cy, cell);
                    const sideY = this._cellCenter(cx, cy + dy, cell);
                    if (blockedAt(sideX.x, sideX.y) || blockedAt(sideY.x, sideY.y)) {
                        continue;
                    }
                }
                came.set(k, cur);
                q.push([nx, ny]);
            }
        }
        const end = found || best;
        if (!end || (end[0] === sx && end[1] === sy)) return null;
        const cells = [];
        let cur = end;
        const seen = new Set();
        while (cur && !seen.has(keyOf(cur[0], cur[1]))) {
            seen.add(keyOf(cur[0], cur[1]));
            cells.push(cur);
            cur = came.get(keyOf(cur[0], cur[1]));
        }
        cells.reverse();
        const pts = [];
        for (let i = 1; i < cells.length; i++) {
            const p = this._cellCenter(cells[i][0], cells[i][1], cell);
            pts.push(p);
        }
        if (found) pts.push({ x: destX, y: destY });
        return this._stringPull(pawn, pts);
    }

    _stringPull(pawn, pts) {
        if (!pts || pts.length <= 1) return pts;
        const from = pawn.body?.center
            ? { x: pawn.body.center.x, y: pawn.body.center.y }
            : { x: pawn.x, y: pawn.y };
        const out = [];
        let ax = from.x;
        let ay = from.y;
        let i = 0;
        while (i < pts.length) {
            let j = pts.length - 1;
            while (j > i && !this._losPoints(ax, ay, pts[j].x, pts[j].y, pawn)) j--;
            out.push(pts[j]);
            ax = pts[j].x;
            ay = pts[j].y;
            i = j + 1;
        }
        return out;
    }

    _losPoints(x0, y0, x1, y1, pawn) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const dist = Math.hypot(dx, dy);
        if (!(dist > 4)) return true;
        const half = this._clearance(pawn);
        const stepPx = Math.max(3, half * 0.5);
        const ts = pawn?.scene?.tileSize || 16;
        const maxDist = Math.min(dist, ts * 14);
        const steps = Math.max(2, Math.ceil(maxDist / stepPx));
        const solids = this._nearbyBodies(pawn, maxDist + 48);
        for (let i = 1; i <= steps; i++) {
            const f = ((maxDist * i) / steps) / dist;
            const ax = x0 + dx * f;
            const ay = y0 + dy * f;
            for (let s = 0; s < solids.length; s++) {
                const tb = solids[s];
                if (ax + half > tb.left && ax - half < tb.right
                    && ay + half > tb.top && ay - half < tb.bottom) {
                    return false;
                }
            }
        }
        return true;
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
        const arrive = (typeof Party !== "undefined" && Party.DUEL_STAND_ARRIVE_PX) || 8;
        const standDist = Math.hypot(stand.x - mc.x, stand.y - mc.y);
        const atStand = !stand.flanking || standDist <= arrive;

        if (canLand && atStand) this._meleeHold = true;
        else if (!atStand || edgeDist > reach + this.MELEE_RESUME_PAD) this._meleeHold = false;

        if (
            !swinging &&
            atk &&
            canLand &&
            atStand &&
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
        this._walkCombatToward(pawn, stand.x, stand.y, ts, sprint);
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
     * Combat close: go straight at the stand/hurtbox. Follow pathfinding
     * (open-point hops, tree corners) looks like teleporting in a scrap.
     */
    _walkCombatToward(pawn, tx, ty, ts, sprint) {
        this._path = null;
        this._unstick = null;
        const from = pawn.bodyCenter?.()
            || pawn.body?.center
            || { x: pawn.x, y: pawn.y };
        let dx = tx - from.x;
        let dy = ty - from.y;
        const dist = Math.hypot(dx, dy) || 1;
        let nx = dx / dist;
        let ny = dy / dist;
        const rep = typeof Party !== "undefined" && Party.duelRepulse
            ? Party.duelRepulse(pawn, pawn.scene?.partySys?._duelEntities)
            : null;
        if (rep && (rep.rx || rep.ry)) {
            nx += rep.rx * 0.7;
            ny += rep.ry * 0.7;
            const nlen = Math.hypot(nx, ny) || 1;
            nx /= nlen;
            ny /= nlen;
        }
        const overlap = this._overlappingThing(pawn);
        if (overlap) {
            nudgePawnOutOfThing?.(pawn, overlap);
            if (this._overlappingThing(pawn)) {
                const around = this._exitDir(pawn, overlap);
                pawn.isSprinting = !!sprint && pawn.kc > 0 && !pawn.getEncumbrance?.().cannotSprint;
                this._applyWalk(pawn, around.nx, around.ny, pawn.isSprinting);
                return;
            }
        }
        if (this._blockedInDir(pawn.body, nx, ny) || this._arcadeJammed(pawn.body)) {
            const sx = Math.sign(dx) || 0;
            const sy = Math.sign(dy) || 0;
            if (sx && !this._blockedInDir(pawn.body, sx, 0) && Math.abs(dx) > 2) {
                nx = sx;
                ny = 0;
            } else if (sy && !this._blockedInDir(pawn.body, 0, sy) && Math.abs(dy) > 2) {
                nx = 0;
                ny = sy;
            } else {
                const slid = slidePawnAroundThings?.(pawn, nx, ny, 4, false, this._avoidSide);
                if (slid) {
                    nx = slid.nx;
                    ny = slid.ny;
                    this._avoidSide = nx !== 0 ? Math.sign(nx) : (ny || 1);
                }
            }
        }
        pawn.isSprinting = !!sprint && pawn.kc > 0 && !pawn.getEncumbrance?.().cannotSprint;
        this._applyWalk(pawn, nx, ny, pawn.isSprinting);
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

    _noteProgress(pawn, delta) {
        if (this._lastPx == null) {
            this._lastPx = pawn.x;
            this._lastPy = pawn.y;
            this._noProgressMs = 0;
            return;
        }
        const moved = Math.hypot(pawn.x - this._lastPx, pawn.y - this._lastPy);
        if (moved > 5) {
            this._lastPx = pawn.x;
            this._lastPy = pawn.y;
            this._noProgressMs = 0;
        } else {
            this._noProgressMs += delta;
        }
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
        const scene = mob?.scene;
        const body = mob?.body;
        if (!body || !scene?._things) return null;
        const things = scene._things.getChildren();
        for (let i = 0; i < things.length; i++) {
            const t = things[i];
            const tb = t?.body;
            if (!tb || !tb.enable || pawnIgnoresThing?.(mob, t)) continue;
            if (body.right > tb.left && body.left < tb.right && body.bottom > tb.top && body.top < tb.bottom) {
                return t;
            }
        }
        return null;
    }

    _pointBlocked(x, y, pawn = this.pawn) {
        const scene = pawn?.scene;
        if (!scene?._things) return false;
        const half = this._clearance(pawn);
        return this._aabbHitsThing(x, y, half, scene);
    }

    _aabbHitsThing(ax, ay, half, scene) {
        const left = ax - half;
        const right = ax + half;
        const top = ay - half;
        const bottom = ay + half;
        const cull = 52;
        const things = scene._things.getChildren();
        for (let i = 0; i < things.length; i++) {
            const t = things[i];
            const tb = t?.body;
            if (!tb || !tb.enable || pawnIgnoresThing?.(this.pawn, t)) continue;
            const tcx = (tb.left + tb.right) * 0.5;
            const tcy = (tb.top + tb.bottom) * 0.5;
            if (Math.abs(tcx - ax) > cull || Math.abs(tcy - ay) > cull) continue;
            if (right > tb.left && left < tb.right && bottom > tb.top && top < tb.bottom) {
                return true;
            }
        }
        return false;
    }

    _openPoint(x, y, ts, pawn = this.pawn) {
        if (!this._pointBlocked(x, y, pawn)) return { x, y };
        const step = Math.max(8, ts * 0.55);
        const bias = this._avoidSide >= 0 ? 0.2 : -0.2;
        for (let r = 1; r <= 6; r++) {
            for (let a = 0; a < 8; a++) {
                const ang = (a / 8) * Math.PI * 2 + bias;
                const px = x + Math.cos(ang) * step * r;
                const py = y + Math.sin(ang) * step * r;
                if (!this._pointBlocked(px, py, pawn)) return { x: px, y: py };
            }
        }
        return { x, y };
    }
}
