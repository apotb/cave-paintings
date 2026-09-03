/**
 * Neutral passerby: walk a cardinal heading with obstacle skirt.
 * On any damaging hit, lock recruit and fight via NeutralAnimalAI.
 */
class WandererAI {
    constructor(pawn) {
        this.pawn = pawn;
        this.combat = typeof NeutralAnimalAI !== "undefined" ? new NeutralAnimalAI(pawn) : null;
        this._avoidSide = Math.random() < 0.5 ? -1 : 1;
        this._stuckMs = 0;
        this._stuckOrigin = null;
        this._stuckFlipped = false;
        this._detourH = null;
        this._escapeKey = null;
        this._escapeH = null;
        this.fleeFrom = null;
    }

    onDamaged(source) {
        const pawn = this.pawn;
        pawn.hostile = true;
        pawn.recruitLocked = true;
        this.combat?.onDamaged?.(source);
    }

    update(delta) {
        const pawn = this.pawn;
        const scene = pawn?.scene;
        if (!pawn?.active || pawn.isBodyDead?.() || scene?._gamePaused) {
            pawn?.setVelocity?.(0, 0);
            return;
        }
        pawn.capacities = new Capacities(pawn.anatomy);
        pawn._refreshDownedState?.();
        if (pawn._bodyDead) return;
        if (pawn.isIncapacitated?.() || pawn.isImmobile?.()) {
            pawn.setVelocity(0, 0);
            if (pawn.body) pawn.body.moves = false;
            setCreatureProne?.(pawn, true);
            return;
        }
        if (pawn.body) pawn.body.moves = true;
        setCreatureProne?.(pawn, false);

        const tickScale = typeof Party !== "undefined" && Party.mobTimeScale
            ? Party.mobTimeScale(scene.tickSpeed)
            : 1;
        const aiDelta = delta * tickScale;

        if (pawn.hostile && this.combat) {
            this.combat.update(aiDelta);
            if (tickScale !== 1 && pawn.body) {
                pawn.setVelocity(
                    (pawn.body.velocity?.x || 0) * tickScale,
                    (pawn.body.velocity?.y || 0) * tickScale
                );
            }
            this._syncWalkAnim(pawn);
            if (!this.combat.hostile) {
                pawn.hostile = false;
                this.fleeFrom = this.combat._combatTarget || scene.player;
            }
            pawn.syncNameLabel?.();
            pawn.syncFxRoot?.();
            return;
        }

        if (this.fleeFrom && !pawn.hostile) {
            const dx = pawn.x - this.fleeFrom.x;
            const dy = pawn.y - this.fleeFrom.y;
            const dist = Math.hypot(dx, dy) || 1;
            pawn.heading = { x: dx / dist, y: dy / dist };
        }

        const h = pawn.heading || { x: 1, y: 0 };
        let nx = h.x;
        let ny = h.y;
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        pawn.heading = { x: nx, y: ny };
        const ox = pawn.x;
        const oy = pawn.y;
        if (!(tickScale > 0)) {
            pawn.setVelocity?.(0, 0);
            this._syncWalkAnim(pawn, 0);
            pawn.setDepth(pawn.y | 0);
            pawn.syncNameLabel?.();
            pawn.syncFxRoot?.();
            return;
        }
        const ts = scene.tileSize || 16;
        const stroll = (typeof Party !== "undefined" && Party.WANDER_WALK_MULT) || 0.28;
        if (typeof PartyAI !== "undefined") {
            if (!this._pather || this._pather.pawn !== pawn) this._pather = new PartyAI(pawn);
            this._pather._pathRange = 16;
            if (
                !this._walkDest
                || Math.hypot(pawn.x - this._walkDest.x, pawn.y - this._walkDest.y) < 8 * ts
            ) {
                this._walkDest = { x: pawn.x + nx * 48 * ts, y: pawn.y + ny * 48 * ts };
            }
            this._pather._walkToward(pawn, this._walkDest.x, this._walkDest.y, ts, false, aiDelta);
            if (pawn.body) {
                let vx = (pawn.body.velocity?.x || 0) * stroll * tickScale;
                let vy = (pawn.body.velocity?.y || 0) * stroll * tickScale;
                const vlen = Math.hypot(vx, vy);
                const onPath = !!(this._pather._path && this._pather._path.length);
                if (vlen > 0.5 && !onPath) {
                    const sep = this._unstickFromPack(pawn, vx / vlen, vy / vlen);
                    vx = sep.nx * vlen;
                    vy = sep.ny * vlen;
                }
                pawn.setVelocity(vx, vy);
            }
        } else {
            const steered = this._unstickFromPack(pawn, nx, ny);
            const tilesPerSec =
                (pawn.speed || 3.5) *
                stroll *
                tickScale *
                Math.max(0.05, Math.min(1.5, pawn.capacities?.moving?.() || 1)) *
                (scene.terrainSpeedMult?.(pawn.x, pawn.y - 1) ?? 1);
            applyEntityVelocity?.(
                pawn,
                steered.nx * tilesPerSec * ts,
                steered.ny * tilesPerSec * ts,
                aiDelta || 16,
                scene
            );
        }
        const tilesPerSec = Math.hypot(pawn.body?.velocity?.x || 0, pawn.body?.velocity?.y || 0) / ts;
        this._syncWalkAnim(pawn, tilesPerSec);
        pawn.setDepth(pawn.y | 0);
        pawn.syncNameLabel?.();
        pawn.syncFxRoot?.();
        if (!this._stuckOrigin) this._stuckOrigin = { x: ox, y: oy };
        const net = Math.hypot(pawn.x - this._stuckOrigin.x, pawn.y - this._stuckOrigin.y);
        if (net > 12) {
            this._stuckMs = 0;
            this._stuckFlipped = false;
            this._stuckOrigin = { x: pawn.x, y: pawn.y };
        }
    }

    _syncWalkAnim(pawn, tilesPerSec) {
        let tps = tilesPerSec;
        if (tps == null) {
            const ts = pawn.scene?.tileSize || 16;
            const vx = pawn.body?.velocity?.x || 0;
            const vy = pawn.body?.velocity?.y || 0;
            tps = Math.hypot(vx, vy) / ts;
        }
        const moving = tps > 0.05;
        if (pawn.anims) {
            pawn.anims.timeScale = moving && typeof Party !== "undefined" && Party.walkAnimTimeScale
                ? Party.walkAnimTimeScale(tps)
                : moving
                    ? Math.max(0.15, Math.min(8, tps / 3.5))
                    : 1;
        }
        if (typeof PlayerLook !== "undefined") PlayerLook.play(pawn, pawn.facing || "down", moving);
    }

    _steer(mob, nx, ny, _delta) {
        const overlap = typeof overlappingThingSprite === "function"
            ? overlappingThingSprite(mob)
            : null;
        if (overlap) nudgePawnOutOfThing?.(mob, overlap);
        return { nx, ny };
    }

    /** Walk around a Thing on a sticky side without replacing the lasting heading. */
    _skirtPick(mob, nx, ny) {
        const left = { nx: -ny, ny: nx };
        const right = { nx: ny, ny: -nx };
        const fwdR = { nx: nx + right.nx, ny: ny + right.ny };
        const fwdL = { nx: nx + left.nx, ny: ny + left.ny };
        const order = this._avoidSide > 0
            ? [fwdR, right, fwdL, left]
            : [fwdL, left, fwdR, right];
        for (const c of order) {
            const len = Math.hypot(c.nx, c.ny) || 1;
            const cx = c.nx / len;
            const cy = c.ny / len;
            if (this._blockedInDir(mob.body, cx, cy) || this._probeBlocked(mob, cx, cy)) continue;
            if (pawnPoseHitsThing?.(mob, mob.x + cx * 4, mob.y + cy * 4)) continue;
            return { nx: cx, ny: cy };
        }
        return null;
    }

    _stickyExit(mob, thing, hx, hy) {
        const tb = thing?.body;
        const key = thing?.uid || `${thing?.x}:${thing?.y}`;
        if (this._escapeKey === key && this._escapeH) return this._escapeH;
        const side = this._avoidSide >= 0 ? 1 : -1;
        const perp = Math.abs(hx) >= Math.abs(hy)
            ? { nx: 0, ny: side }
            : { nx: side, ny: 0 };
        const raw = [
            { nx: hx + perp.nx, ny: hy + perp.ny },
            perp,
            { nx: hx, ny: hy },
            { nx: hx - perp.nx, ny: hy - perp.ny },
            { nx: -perp.nx, ny: -perp.ny }
        ];
        const scored = [];
        for (let i = 0; i < raw.length; i++) {
            const c = raw[i];
            const len = Math.hypot(c.nx, c.ny);
            if (!(len > 0)) continue;
            const u = { nx: c.nx / len, ny: c.ny / len };
            u.dot = u.nx * hx + u.ny * hy;
            scored.push(u);
        }
        scored.sort((a, b) => b.dot - a.dot);
        for (let i = 0; i < scored.length; i++) {
            const u = scored[i];
            if (this._probeBlocked(mob, u.nx, u.ny)) continue;
            this._escapeKey = key;
            this._escapeH = { nx: u.nx, ny: u.ny };
            return this._escapeH;
        }
        if (!tb) return { nx: hx, ny: hy };
        const cx = mob.body?.center?.x ?? mob.x;
        const cy = mob.body?.center?.y ?? mob.y;
        const exits = [
            { d: cx - tb.left, nx: -1, ny: 0 },
            { d: tb.right - cx, nx: 1, ny: 0 },
            { d: cy - tb.top, nx: 0, ny: -1 },
            { d: tb.bottom - cy, nx: 0, ny: 1 }
        ];
        exits.sort((a, b) => b.d - a.d);
        for (let i = 0; i < exits.length; i++) {
            const e = exits[i];
            if (pawnPoseBlocked?.(mob, mob.x + e.nx * 8, mob.y + e.ny * 8, 2)) continue;
            this._escapeKey = key;
            this._escapeH = { nx: e.nx, ny: e.ny };
            return this._escapeH;
        }
        const pick = { nx: exits[0].nx, ny: exits[0].ny };
        this._escapeKey = key;
        this._escapeH = pick;
        return pick;
    }

    _idHash(id) {
        const s = String(id || "");
        let n = 0;
        for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) | 0;
        return ((n >>> 0) / 4294967296) * Math.PI * 2;
    }

    _unstickFromPack(pawn, nx, ny) {
        const scene = pawn.scene;
        const pack = scene?.partySys?.wanderers || [];
        const ts = scene?.tileSize || 16;
        const want = ts * 0.8;
        let sx = 0;
        let sy = 0;
        for (const other of pack) {
            if (!other || other === pawn || other.isBodyDead?.()) continue;
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
        const sl = Math.hypot(sx, sy);
        if (!(sl > 0.2)) return { nx, ny };
        const sepW = Math.min(0.8, 0.4 + sl * 0.35);
        let wx = nx * (1 - sepW) + (sx / sl) * sepW;
        let wy = ny * (1 - sepW) + (sy / sl) * sepW;
        const n = Math.hypot(wx, wy) || 1;
        wx /= n;
        wy /= n;
        if (this._probeBlocked(pawn, wx, wy) || this._blockedInDir(pawn.body, wx, wy)) {
            return { nx, ny };
        }
        return { nx: wx, ny: wy };
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

    _probeBlocked(mob, nx, ny) {
        const scene = mob.scene;
        const body = mob.body;
        if (!body || !scene?._things) return false;
        const reach = Math.max(8, scene.tileSize || 16);
        const half = Math.max(3, (mob.hitboxSize || 8) * 0.5 + 1);
        const n = Math.max(2, Math.ceil(reach / 4));
        for (let s = 1; s <= n; s++) {
            const d = (reach * s) / n;
            const ax = body.center.x + nx * d;
            const ay = body.center.y + ny * d;
            const left = ax - half;
            const right = ax + half;
            const top = ay - half;
            const bottom = ay + half;
            let hit = false;
            if (typeof forThingsNearAabb === "function") {
                forThingsNearAabb(scene, left, right, top, bottom, (t) => {
                    const tb = t?.body;
                    if (!tb || !tb.enable || pawnIgnoresThing?.(mob, t)) return false;
                    if (right > tb.left && left < tb.right && bottom > tb.top && top < tb.bottom) {
                        hit = true;
                        return true;
                    }
                    return false;
                });
            } else {
                const things = scene._things.getChildren();
                for (let i = 0; i < things.length; i++) {
                    const t = things[i];
                    const tb = t?.body;
                    if (!tb || !tb.enable || pawnIgnoresThing?.(mob, t)) continue;
                    if (right > tb.left && left < tb.right && bottom > tb.top && top < tb.bottom) {
                        hit = true;
                        break;
                    }
                }
            }
            if (hit) return true;
        }
        return false;
    }
}
