/**
 * Orbit slots around the player so hostile melee mobs fan out instead of stacking.
 * 6 primary slots (fixed world angles); extras fill ring 2 across all rays before
 * ring 3, etc. Odd rings are angle-offset so reserves sit between primaries.
 */
class MeleeSlots {
    constructor(scene, count = 6) {
        this.scene = scene;
        this.count = count;
        this.queueSpacing = 14;
        this.claimPad = 20;
        this.releasePad = 36;
        this.debug = false;
        this._gfx = null;
        this.slots = [];
        for (let i = 0; i < count; i++) {
            this.slots.push({
                index: i,
                angle: (Math.PI * 2 * i) / count,
                owners: []
            });
        }
    }

    radiusFor(reach = 4) {
        // Center distance so a mob at the mark can still touch a ~16px hurtbox
        // (half-extent ~8). Keep this ≤ reach + ~4 or arrive hysteresis leaves them short.
        const r = Number(reach) || 4;
        return Math.max(r + 2, 6);
    }

    claimRadius(reach = 4) {
        return this.radiusFor(reach) + this.claimPad;
    }

    releaseRadius(reach = 4) {
        return this.claimRadius(reach) + this.releasePad;
    }

    playerCenter() {
        const p = this.scene.player;
        if (!p) return null;
        return typeof p.bodyCenter === "function"
            ? p.bodyCenter()
            : { x: p.x, y: p.y };
    }

    _mobCenter(mob) {
        return typeof mob.bodyCenter === "function"
            ? mob.bodyCenter()
            : { x: mob.x, y: mob.y };
    }

    /** Angle for a ring depth (odd rings sit between primary rays). */
    _angleFor(slotIndex, queueIndex = 0) {
        const slot = this.slots[slotIndex];
        if (!slot) return 0;
        const ring = Math.max(0, queueIndex | 0);
        const offset = ring % 2 === 1 ? Math.PI / this.count : 0;
        return slot.angle + offset;
    }

    /** World anchor for slot + queue depth. */
    anchor(slotIndex, queueIndex = 0, reach = 4) {
        const pc = this.playerCenter();
        const slot = this.slots[slotIndex];
        if (!pc || !slot) return null;
        const ring = Math.max(0, queueIndex | 0);
        const r = this.radiusFor(reach) + this.queueSpacing * ring;
        const ang = this._angleFor(slotIndex, ring);
        return {
            x: pc.x + Math.cos(ang) * r,
            y: pc.y + Math.sin(ang) * r
        };
    }

    findClaim(mob) {
        for (const s of this.slots) {
            const qi = s.owners.indexOf(mob);
            if (qi >= 0) return { slotIndex: s.index, queueIndex: qi };
        }
        return null;
    }

    _nearestFreeSlot(mob, reach) {
        const mc = this._mobCenter(mob);
        let best = null;
        let bestDist = Infinity;
        for (const s of this.slots) {
            if (s.owners.length > 0) continue;
            const a = this.anchor(s.index, 0, reach);
            if (!a) continue;
            const d = Math.hypot(a.x - mc.x, a.y - mc.y);
            if (d < bestDist) {
                bestDist = d;
                best = s;
            }
        }
        return best;
    }

    /**
     * Among rays, pick the shortest queue (fill ring 2 before 3); nearest wins ties.
     * @returns {{ slot: object, dist: number } | null}
     */
    _shortestQueueSlot(mob, reach, { excludeSlotIndex = -1, maxQueueIndex = Infinity } = {}) {
        const mc = this._mobCenter(mob);
        let best = null;
        let bestLen = Infinity;
        let bestDist = Infinity;
        for (const s of this.slots) {
            if (s.index === excludeSlotIndex) continue;
            const len = s.owners.length; // queue index we'd receive
            if (len > maxQueueIndex) continue;
            const a = this.anchor(s.index, len, reach);
            if (!a) continue;
            const d = Math.hypot(a.x - mc.x, a.y - mc.y);
            if (len < bestLen || (len === bestLen && d < bestDist)) {
                bestLen = len;
                bestDist = d;
                best = s;
            }
        }
        return best ? { slot: best, dist: bestDist, queueIndex: bestLen } : null;
    }

    /**
     * Claim nearest free primary slot, or join the shortest reserve ring.
     * @returns {{ slotIndex: number, queueIndex: number } | null}
     */
    claim(mob, reach = 4) {
        if (!mob) return null;
        const existing = this.findClaim(mob);
        if (existing) return existing;

        const free = this._nearestFreeSlot(mob, reach);
        if (free) {
            free.owners.push(mob);
            return { slotIndex: free.index, queueIndex: 0 };
        }

        const pick = this._shortestQueueSlot(mob, reach);
        if (!pick) return null;
        pick.slot.owners.push(mob);
        return { slotIndex: pick.slot.index, queueIndex: pick.slot.owners.length - 1 };
    }

    /**
     * Promote queue → free primaries, rebalance reserves onto thinner rings,
     * or switch primary to a clearly closer free slot.
     * @returns {{ slotIndex: number, queueIndex: number } | null}
     */
    reshuffle(mob, reach = 4) {
        if (!mob) return null;
        let cur = this.findClaim(mob);
        if (!cur) return this.claim(mob, reach);

        const free = this._nearestFreeSlot(mob, reach);
        if (free) {
            const mc = this._mobCenter(mob);
            const freeA = this.anchor(free.index, 0, reach);
            if (freeA) {
                if (cur.queueIndex > 0) {
                    this.release(mob);
                    free.owners.push(mob);
                    return { slotIndex: free.index, queueIndex: 0 };
                }
                const curA = this.anchor(cur.slotIndex, 0, reach);
                if (curA) {
                    const dFree = Math.hypot(freeA.x - mc.x, freeA.y - mc.y);
                    const dCur = Math.hypot(curA.x - mc.x, curA.y - mc.y);
                    if (dFree + 10 < dCur) {
                        this.release(mob);
                        free.owners.push(mob);
                        return { slotIndex: free.index, queueIndex: 0 };
                    }
                }
            }
        }

        // Reserves: leave an overstuffed ray for any ray that still has a shallower ring open
        if (cur.queueIndex > 0) {
            const pick = this._shortestQueueSlot(mob, reach, {
                excludeSlotIndex: cur.slotIndex,
                maxQueueIndex: cur.queueIndex - 1
            });
            if (pick) {
                this.release(mob);
                pick.slot.owners.push(mob);
                return {
                    slotIndex: pick.slot.index,
                    queueIndex: pick.slot.owners.length - 1
                };
            }
        }

        return cur;
    }

    release(mob) {
        if (!mob) return;
        for (const s of this.slots) {
            const i = s.owners.indexOf(mob);
            if (i >= 0) {
                s.owners.splice(i, 1);
                return;
            }
        }
    }

    setDebug(on) {
        this.debug = !!on;
        if (!this.debug) {
            this._gfx?.clear();
            this._gfx?.setVisible(false);
            return;
        }
        this.drawDebug();
    }

    /**
     * Draw in the player's fxRoot (local space). Parent shares player.x/y so
     * roundPixels cannot jitter the overlay relative to the player sprite.
     */
    drawDebug(reach = 4) {
        if (!this.debug) return;
        const player = this.scene.player;
        if (!player?.ensureFxRoot) return;

        const root = player.ensureFxRoot();
        player.syncFxRoot();

        if (!this._gfx) {
            this._gfx = this.scene.add.graphics();
            root.add(this._gfx);
        } else if (this._gfx.parentContainer !== root) {
            root.add(this._gfx);
        }
        this._gfx.setPosition(0, 0).setVisible(true);

        const g = this._gfx;
        g.clear();
        const pc = this.playerCenter();
        if (!pc) return;

        const lx = (wx) => wx - player.x;
        const ly = (wy) => wy - player.y;
        const pcx = lx(pc.x);
        const pcy = ly(pc.y);

        const r0 = this.radiusFor(reach);
        let maxRing = 1;
        for (const s of this.slots) {
            maxRing = Math.max(maxRing, s.owners.length);
        }

        for (let ring = 0; ring < maxRing; ring++) {
            g.lineStyle(1, ring === 0 ? 0xffffff : 0x888888, ring === 0 ? 0.25 : 0.18);
            g.strokeCircle(pcx, pcy, r0 + this.queueSpacing * ring);
        }

        for (const s of this.slots) {
            const depth = Math.max(1, s.owners.length);
            for (let q = 0; q < depth; q++) {
                const a = this.anchor(s.index, q, reach);
                if (!a) continue;
                const ax = lx(a.x);
                const ay = ly(a.y);
                const filled = q < s.owners.length;
                const color = q === 0
                    ? (filled ? 0x33ff99 : 0x666666)
                    : (filled ? 0xffcc33 : 0x444444);
                g.lineStyle(1, color, 0.85);
                g.lineBetween(pcx, pcy, ax, ay);
                g.fillStyle(color, filled ? 0.9 : 0.35);
                g.fillCircle(ax, ay, q === 0 ? 3 : 2);
            }
        }
    }
}
