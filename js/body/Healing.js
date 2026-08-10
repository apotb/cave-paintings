/**
 * Bleed, blood loss, natural healing, tending helpers.
 */
const BodyHealing = {
    /** Severity healed per game day at plan healRate (RimWorld-ish). */
    BASE_HEAL_RATE: 11.52,
    MINUTES_PER_DAY: 1440,
    /** Blood volume recovered per game minute while not bleeding (~33.3%/day, RW). */
    BLOOD_RECOVERY_PER_MINUTE: 1 / 3 / 1440,
    /** Default cut bleedRate used for stump bleed (Injuries.json cut). */
    STUMP_BLEED_RATE: 0.06,

    /**
     * RW-ish: severity × bleedRate × partMult = fraction of blood volume lost per day.
     * (Old code also ×0.01 and applied that every minute → ~144× too fast.)
     */
    injuryBleedPerDay(inj, part) {
        if (!inj || inj.permanent || inj.tended || !inj.bleeding) return 0;
        const mult = Number(part?.def?.bleedMult) || 1;
        return (Number(inj.severity) || 0) * (Number(inj.bleedRate) || 0) * mult;
    },

    /** Per-minute bloodLoss from one injury. */
    injuryBleedPerMinute(inj, part) {
        return this.injuryBleedPerDay(inj, part) / this.MINUTES_PER_DAY;
    },

    /** Destroyed part: bleed as 2×mhp cut until tended. */
    stumpBleedPerDay(d) {
        if (!d || d.tended) return 0;
        return d.mhp * 2 * this.STUMP_BLEED_RATE * (d.bleedMult || 1);
    },

    stumpBleedPerMinute(d) {
        return this.stumpBleedPerDay(d) / this.MINUTES_PER_DAY;
    },

    /**
     * True for amputated limbs/digits (stump); false for organs, bones, face, etc.
     * @param {BodyPart|null|undefined} part
     */
    isStumpPart(part) {
        if (!part || part.internal) return false;
        const id = part.baseId || part.name || "";
        return /Arm|Leg|Hand|Foot|Shoulder|Finger|Toe|Hoof|Thumb/i.test(id);
    },

    /**
     * Injury-list subline under "Part: Destroyed".
     * @param {Body|null|undefined} body
     * @param {string} partName
     */
    destroyedBleedLabel(body, partName) {
        const part = body?.part?.(partName);
        return this.isStumpPart(part) ? "stump (bleeding)" : "missing (bleeding)";
    },

    /** Bleed contribution per game-minute tick → bloodLoss delta. */
    bleedRateTotal(body) {
        let rate = 0;
        // Dead parts skip injury bleed — stump entry covers them (no double count)
        for (const part of Object.values(body.parts())) {
            if (part.isDead()) continue;
            for (const inj of part.injuries) {
                rate += this.injuryBleedPerMinute(inj, part);
            }
        }
        for (const d of body.destroyedBleed || []) {
            rate += this.stumpBleedPerMinute(d);
        }
        return rate;
    },

    /** Fraction of blood volume lost per game day at current bleed rate. */
    bleedPerDay(body) {
        return this.bleedRateTotal(body) * this.MINUTES_PER_DAY;
    },

    /**
     * Game minutes until bloodLoss reaches 1.0 at the current bleed rate.
     * @returns {number|null}
     */
    minutesToBleedOut(body) {
        const perMin = this.bleedRateTotal(body);
        if (!(perMin > 0)) return null;
        const remaining = Math.max(0, 1 - (body.bloodLoss || 0));
        return remaining / perMin;
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
            body.bloodLoss = Math.max(0, body.bloodLoss - this.BLOOD_RECOVERY_PER_MINUTE);
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

        // Natural healing follows the world clock (scales with /tick)
        this.healGameMinute(owner, scene);

        // Whole-body hediffs (player hunger drives malnutrition; any body can decay hediffs)
        if (typeof Hediffs !== "undefined") {
            Hediffs.minuteTick(owner, scene);
        }
    },

    /**
     * Place N stains in a ring around the owner (nearby drips merge into pools).
     * @param {Number} n
     * @param {Number} [minDistTiles=0.08]
     * @param {Number} [maxDistTiles=0.5]
     */
    _scatterStains(owner, scene, n, minDistTiles = 0.08, maxDistTiles = 0.5) {
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
        // Lighter drip rate — merges turn repeats into growing pools
        let n = Math.floor(bleed * 40);
        if (Math.random() < Math.min(0.75, 0.2 + bleed * 25)) n += 1;
        if (bleed > 0.02 && Math.random() < 0.35) n += 1;
        n = Phaser.Math.Clamp(n, 0, 2);
        if (n <= 0 || !scene?.time?.delayedCall) return;

        if (owner._bleedDripPhase == null) {
            owner._bleedDripPhase = Math.random();
        }
        const minuteMs = Math.max(80, 1000 / Math.max(0.05, Number(scene.tickSpeed) || 1));
        const phase = owner._bleedDripPhase * minuteMs;

        for (let i = 0; i < n; i++) {
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
        let n = 1 + Math.floor(score * 5);
        if (score > 1) n += 1;
        if (destroyed) n += 1;
        n = Phaser.Math.Clamp(n, 1, 4);
        this._scatterStains(owner, scene, n, 0.06, 0.65);
    },

    /**
     * RimWorld heal tick on our clock: every 10 game minutes (= RW's ~10s at 1×),
     * heal ONE random non-permanent wound by healRate × 0.01.
     * Tend bonus (+4 + 8×quality) applies only when that wound is picked.
     */
    healGameMinute(owner, scene) {
        const body = owner.anatomy;
        if (!body) return;
        // Align to absolute world minutes so day rollover stays on cadence
        const worldMin = scene?.worldMinuteIndex?.();
        if (worldMin != null && worldMin % 10 !== 0) return;

        const wounds = [];
        for (const part of Object.values(body.parts())) {
            if (part.isDead()) continue;
            for (const inj of part.injuries) {
                if (!inj.permanent) wounds.push({ part, inj });
            }
        }
        if (!wounds.length) return;

        const pick = Phaser.Utils.Array.GetRandom(wounds);
        const { part, inj } = pick;
        const base = Number(body.plan?.healRate) || this.BASE_HEAL_RATE;
        let healRate = base;
        if (inj.tended) {
            const q = Phaser.Math.Clamp(Number(inj.tendQuality) || 0, 0, 1);
            healRate += 4 + q * 8;
        }
        // RW: each heal tick applies healRate × 0.01
        inj.severity = Math.max(0, (Number(inj.severity) || 0) - healRate * 0.01);

        if (inj.scarPending && inj.severity <= (inj.scarSeverity || 0)) {
            inj.permanent = true;
            inj.severity = inj.scarSeverity || 1;
            inj.bleeding = false;
            inj.scarPending = false;
            inj.name = (inj.name || "Injury") + " scar";
        } else if (inj.severity <= 0.05 && !inj.scarPending) {
            const idx = part.injuries.indexOf(inj);
            if (idx >= 0) part.injuries.splice(idx, 1);
        } else if (inj.severity <= 0 && inj.scarPending) {
            inj.permanent = true;
            inj.severity = inj.scarSeverity || 1;
            inj.bleeding = false;
            inj.scarPending = false;
            inj.name = (inj.name || "Injury") + " scar";
        }

        body.markDirty?.();
    },

    /** True if a previously picked tend target is still on the body and untended. */
    isTendTargetValid(body, target) {
        if (!body || !target) return false;
        if (target.destroyed) {
            const d = target.destroyed;
            return !d.tended && (body.destroyedBleed || []).includes(d);
        }
        const { part, inj } = target;
        if (!part || !inj || inj.permanent || inj.tended) return false;
        return Array.isArray(part.injuries) && part.injuries.includes(inj);
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

    /**
     * Tend quality roll: base × random(0..1.25), clamped to [0, max].
     * Floor is 0% (no bare-hand tend in this game — worst bandage can fail).
     * @param {Number} base  typical quality for this medicine (e.g. 0.4 leaf cord)
     * @param {Number} [max=0.7]  medicine ceiling (herbal-like default)
     */
    rollTendQuality(base = 0.4, max = 0.7) {
        const b = Math.max(0, Number(base) || 0);
        const cap = Math.max(0, Number(max) || 0.7);
        const rolled = b * Phaser.Math.FloatBetween(0, 1.25);
        return Phaser.Math.Clamp(rolled, 0, cap);
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
