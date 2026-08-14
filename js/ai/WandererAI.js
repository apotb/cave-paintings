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
            setCreatureProne?.(pawn, true);
            return;
        }
        setCreatureProne?.(pawn, false);

        if (pawn.hostile && this.combat) {
            this.combat.update(delta);
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
        const steered0 = this._steer(pawn, nx, ny, delta);
        const steered = this._unstickFromPack(pawn, steered0.nx, steered0.ny);
        const stroll = (typeof Party !== "undefined" && Party.WANDER_WALK_MULT) || 0.28;
        const speed =
            (pawn.speed || 3.5) *
            stroll *
            (scene.tileSize || 16) *
            Math.max(0.05, Math.min(1.5, pawn.capacities?.moving?.() || 1)) *
            (scene.terrainSpeedMult?.(pawn.x, pawn.y - 1) ?? 1);
        applyEntityVelocity?.(
            pawn,
            steered.nx * speed,
            steered.ny * speed,
            delta || 16,
            scene
        );
        if (Math.abs(steered.nx) > Math.abs(steered.ny)) {
            pawn.facing = steered.nx > 0 ? "right" : "left";
        } else if (steered.ny !== 0) {
            pawn.facing = steered.ny > 0 ? "down" : "up";
        }
        pawn.anims.timeScale = 0.45;
        if (typeof PlayerLook !== "undefined") PlayerLook.play(pawn, pawn.facing, true);
        pawn.setDepth(pawn.y | 0);
        pawn.syncNameLabel?.();
        pawn.syncFxRoot?.();
    }

    _steer(mob, nx, ny, delta) {
        const touching = this._blockedInDir(mob.body, nx, ny);
        if (!touching && !this._probeBlocked(mob, nx, ny)) {
            this._stuckMs = 0;
            return { nx, ny };
        }
        this._stuckMs += delta;
        const left = { nx: -ny, ny: nx };
        const right = { nx: ny, ny: -nx };
        const order = this._avoidSide > 0 ? [right, left] : [left, right];
        for (const c of order) {
            if (!this._blockedInDir(mob.body, c.nx, c.ny) && !this._probeBlocked(mob, c.nx, c.ny)) {
                this._avoidSide = c === right ? 1 : -1;
                return c;
            }
        }
        if (this._stuckMs > 500) {
            this._avoidSide *= -1;
            this._stuckMs = 0;
        }
        return { nx, ny };
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
        const probeDist = Math.max(8, (mob.hitboxSize || 8) * 1.25);
        const half = Math.max(2, (mob.hitboxSize || 8) * 0.4);
        const ax = body.center.x + nx * probeDist;
        const ay = body.center.y + ny * probeDist;
        const left = ax - half;
        const right = ax + half;
        const top = ay - half;
        const bottom = ay + half;
        const things = scene._things.getChildren();
        for (let i = 0; i < things.length; i++) {
            const t = things[i];
            const tb = t?.body;
            if (!tb || !tb.enable) continue;
            if (right > tb.left && left < tb.right && bottom > tb.top && top < tb.bottom) {
                return true;
            }
        }
        return false;
    }
}
