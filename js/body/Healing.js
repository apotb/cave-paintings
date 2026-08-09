/**
 * Bleed, blood loss, natural healing, tending helpers.
 */
const BodyHealing = {
    HEAL_INTERVAL_MS: 10000,
    BASE_HEAL_RATE: 11.52,

    /** Bleed contribution per game-minute tick → bloodLoss delta. */
    bleedRateTotal(body) {
        let rate = 0;
        for (const part of Object.values(body.parts())) {
            if (part.isDead()) continue;
            const mult = Number(part.def?.bleedMult) || 1;
            for (const inj of part.injuries) {
                if (inj.permanent || inj.tended || !inj.bleeding) continue;
                // RW-ish: bleed% related to severity * bleedRate factor
                rate += (Number(inj.severity) || 0) * (Number(inj.bleedRate) || 0) * 0.01 * mult;
            }
        }
        for (const d of body.destroyedBleed || []) {
            if (d.tended) continue;
            // Destroyed part: 2 * mhp * bleed factor
            rate += d.mhp * 2 * 0.06 * 0.01 * (d.bleedMult || 1);
        }
        return rate;
    },

    /**
     * Called once per game minute.
     * @param {Object} owner player or mob with .body and .capacities
     */
    minuteTick(owner, scene) {
        const body = owner.anatomy;
        if (!body) return;

        const bleed = this.bleedRateTotal(body);
        if (bleed > 0) {
            body.bloodLoss = Math.min(1, (body.bloodLoss || 0) + bleed);
            body.markDirty?.();
            // Visual drips are staggered (bloodLoss still applies on the minute)
            if (scene?.spawnBloodStain) {
                this._spawnBleedStains(owner, scene, bleed);
            }
        } else if ((body.bloodLoss || 0) > 0) {
            // Slow recovery while not bleeding (severe / RW-like)
            body.bloodLoss = Math.max(0, body.bloodLoss - 0.00035);
            body.markDirty?.();
        }

        if ((body.bloodLoss || 0) >= 1) {
            owner.onBodyFatal?.(null, "bloodLoss");
            return;
        }

        owner.capacities = owner.capacities || new Capacities(body);
        if (owner.capacities.isDeadFromCapacities()) {
            owner.onBodyFatal?.(null, "capacity");
        }
    },

    /**
     * Place N stains in a ring around the owner (not stacked on one pixel).
     * @param {Number} n
     * @param {Number} [minDistTiles=0.08]
     * @param {Number} [maxDistTiles=0.55]
     */
    _scatterStains(owner, scene, n, minDistTiles = 0.08, maxDistTiles = 0.55) {
        if (!scene?.spawnBloodStain || !(n > 0)) return;
        const ts = scene.tileSize || 16;
        const c = typeof owner.bodyCenter === "function"
            ? owner.bodyCenter()
            : { x: owner.x, y: owner.y };
        const span = Math.max(0.05, maxDistTiles - minDistTiles);

        for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2;
            const dist = (minDistTiles + Math.random() * span) * ts;
            const jx = (Math.random() - 0.5) * 2;
            const jy = (Math.random() - 0.5) * 2;
            scene.spawnBloodStain(
                c.x + Math.cos(ang) * dist + jx,
                c.y + Math.sin(ang) * dist + jy
            );
        }
    },

    /**
     * Schedule 0–N drip stains across the coming game-minute.
     * Per-owner phase + random gaps so packs don't all splash on the same frame.
     * @param {Number} bleed  per-minute bloodLoss delta
     */
    _spawnBleedStains(owner, scene, bleed) {
        // Heavier bleeding → more spatters (roughly 0–6 / game minute; light bleeds often skip)
        let n = Math.floor(bleed * 80);
        if (Math.random() < Math.min(0.9, 0.25 + bleed * 35)) n += 1;
        if (bleed > 0.015 && Math.random() < 0.5) n += 1;
        if (bleed > 0.04 && Math.random() < 0.45) n += 1;
        n = Phaser.Math.Clamp(n, 0, 6);
        if (n <= 0 || !scene?.time?.delayedCall) return;

        // Stable-ish phase per bleeder so a pack doesn't share one drip clock
        if (owner._bleedDripPhase == null) {
            owner._bleedDripPhase = Math.random();
        }
        const minuteMs = Math.max(80, 1000 / Math.max(0.05, Number(scene.tickSpeed) || 1));
        const phase = owner._bleedDripPhase * minuteMs;

        for (let i = 0; i < n; i++) {
            // Spread drips through the minute; jitter so they don't land on a grid
            const slot = (phase + ((i + 0.5) / n) * minuteMs) % minuteMs;
            const delay = Phaser.Math.Clamp(
                slot + (Math.random() - 0.5) * (minuteMs / Math.max(2, n)),
                0,
                minuteMs - 1
            );
            scene.time.delayedCall(delay, () => {
                if (!owner?.active || owner.isBodyDead?.()) return;
                if (!owner.anatomy || this.bleedRateTotal(owner.anatomy) <= 0) return;
                this._scatterStains(owner, scene, 1);
            });
        }
    },

    /**
     * Instant spatter when a hit opens/worsens a bleeding wound.
     * Scales with severity × bleedRate × part bleedMult (+ extra if destroyed).
     */
    spawnHitBleedBurst(owner, scene, injury, part, destroyed = false) {
        if (!injury?.bleeding || !scene?.spawnBloodStain) return;
        const severity = Number(injury.severity) || 0;
        const bleedRate = Number(injury.bleedRate) || 0;
        if (!(severity > 0) || !(bleedRate > 0)) return;

        const mult = Number(part?.def?.bleedMult) || 1;
        const score = severity * bleedRate * mult;
        // Graphics mesh can take denser bursts; keep a sane cap for spawn storms
        let n = 2 + Math.floor(score * 10);
        if (score > 0.5) n += 1;
        if (score > 1.2) n += 2;
        if (destroyed) n += 3 + Math.floor((Number(part?.mhp) || 10) * 0.12);
        n = Phaser.Math.Clamp(n, 2, 12);
        // Slightly wider burst than drip stains
        this._scatterStains(owner, scene, n, 0.06, 0.75);
    },

    /** Heal one random wound every 10s (real). */
    healTick(owner) {
        const body = owner.anatomy;
        if (!body) return;
        const wounds = [];
        for (const part of Object.values(body.parts())) {
            if (part.isDead()) continue;
            for (const inj of part.injuries) {
                if (!inj.permanent) wounds.push({ part, inj });
            }
        }
        if (!wounds.length) return;

        const pick = Phaser.Utils.Array.GetRandom(wounds);
        body.markDirty?.();
        let healRate = Number(body.plan?.healRate) || this.BASE_HEAL_RATE;
        // Tend quality bonus to daily heal rate (RW simplified): +4 + 0.08*% at quality
        if (pick.inj.tended) {
            const q = Phaser.Math.Clamp(Number(pick.inj.tendQuality) || 0, 0, 1);
            healRate += 4 + q * 8;
        }
        const amount = healRate * 0.01;
        pick.inj.severity = Math.max(0, (Number(pick.inj.severity) || 0) - amount);

        // Reveal scar when wound heals down to scar severity
        if (pick.inj.scarPending && pick.inj.severity <= (pick.inj.scarSeverity || 0)) {
            pick.inj.permanent = true;
            pick.inj.severity = pick.inj.scarSeverity || 1;
            pick.inj.bleeding = false;
            pick.inj.scarPending = false;
            pick.inj.name = (pick.inj.name || "Injury") + " scar";
        } else if (pick.inj.severity <= 0.05 && !pick.inj.scarPending) {
            // Remove healed wound
            const idx = pick.part.injuries.indexOf(pick.inj);
            if (idx >= 0) pick.part.injuries.splice(idx, 1);
        } else if (pick.inj.severity <= 0 && pick.inj.scarPending) {
            pick.inj.permanent = true;
            pick.inj.severity = pick.inj.scarSeverity || 1;
            pick.inj.bleeding = false;
            pick.inj.scarPending = false;
            pick.inj.name = (pick.inj.name || "Injury") + " scar";
        }

        // Low severity stops bleed naturally
        if (!pick.inj.permanent && pick.inj.severity < 1) {
            // keep bleeding flag until tended or fully gone; RW stops with tend primarily
        }
    },

    /** Pick next wound to tend: worst bleed first, else highest severity. */
    pickTendTarget(body) {
        const bleeding = [];
        const other = [];
        for (const part of Object.values(body.parts())) {
            if (part.isDead()) continue;
            for (const inj of part.injuries) {
                if (inj.permanent) continue;
                if (inj.bleeding && !inj.tended) {
                    bleeding.push({
                        part,
                        inj,
                        score: (Number(inj.severity) || 0) * (Number(inj.bleedRate) || 0) * (part.def?.bleedMult || 1)
                    });
                } else if (!inj.tended) {
                    other.push({ part, inj, score: Number(inj.severity) || 0 });
                }
            }
        }
        for (const d of body.destroyedBleed || []) {
            if (!d.tended) {
                bleeding.push({
                    destroyed: d,
                    score: d.mhp * 2 * 0.06 * (d.bleedMult || 1)
                });
            }
        }
        if (bleeding.length) {
            bleeding.sort((a, b) => b.score - a.score);
            return bleeding[0];
        }
        if (other.length) {
            other.sort((a, b) => b.score - a.score);
            return other[0];
        }
        return null;
    },

    applyTend(body, target, quality = 0.4) {
        if (!target) return false;
        if (target.destroyed) {
            target.destroyed.tended = true;
            body?.markDirty?.();
            return true;
        }
        const inj = target.inj;
        if (!inj) return false;
        inj.tended = true;
        inj.tendQuality = quality;
        inj.bleeding = false;
        body?.markDirty?.();
        return true;
    }
};
