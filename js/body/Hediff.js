/**
 * RimWorld-style whole-body hediffs (food poisoning, malnutrition, …).
 */
const Hediffs = {
    MINUTES_PER_DAY: 1440,

    /** @param {Phaser.Scene} scene */
    defs(scene) {
        return scene?.cache?.json?.get?.("hediffs") || {};
    },

    /** @param {Phaser.Scene} scene @param {string} id */
    def(scene, id) {
        return this.defs(scene)[id] || null;
    },

    /**
     * Stage with the highest minSeverity that is <= severity.
     * @param {Object} def
     * @param {number} severity
     */
    stageForDef(def, severity) {
        if (!def?.stages?.length) return null;
        const sev = Number(severity) || 0;
        let best = null;
        let bestMin = -Infinity;
        for (const s of def.stages) {
            const min = Number(s.minSeverity) || 0;
            if (sev + 1e-9 >= min && min >= bestMin) {
                best = s;
                bestMin = min;
            }
        }
        return best;
    },

    /**
     * @param {{ id: string, severity: number, def?: Object }} hediff
     * @param {Phaser.Scene} [scene]
     */
    stageFor(hediff, scene) {
        const def = hediff.def || this.def(scene || hediff.scene, hediff.id);
        return this.stageForDef(def, hediff.severity);
    },

    /** Display label e.g. "Food poisoning (major)". */
    displayLabel(hediff, scene) {
        const def = hediff.def || this.def(scene, hediff.id);
        const name = def?.name || hediff.id;
        const stage = this.stageForDef(def, hediff.severity);
        const label = stage?.label;
        return label ? `${name} (${label})` : name;
    },

    /**
     * Mean-time-between in days → per-minute proc chance.
     * @param {number} mtbDays
     */
    mtbChancePerMinute(mtbDays) {
        const mtb = Number(mtbDays);
        if (!(mtb > 0)) return 0;
        return 1 / (mtb * this.MINUTES_PER_DAY);
    },

    /**
     * Once per game minute on a living owner with anatomy.
     * @param {Object} owner Player (or future pawn) with .anatomy, .kc, .scene
     * @param {Phaser.Scene} scene
     */
    minuteTick(owner, scene) {
        const body = owner?.anatomy;
        if (!body || owner.isBodyDead?.()) return;

        // Player-only hunger sim drives malnutrition (mobs have no kc/stomach)
        if (typeof owner.hungerTick === "function") {
            this._tickMalnutrition(owner, body, scene);
            if (owner.isBodyDead?.()) return;
        }
        this._tickSeverityAndVomit(owner, body, scene);
    },

    _tickMalnutrition(owner, body, scene) {
        const def = this.def(scene, "malnutrition");
        if (!def) return;

        const rate = Number(body.malnutritionRatePerDay);
        const gainPerMin = (Number.isFinite(rate) && rate > 0 ? rate : 0.45) / this.MINUTES_PER_DAY;
        // Recovery runs faster than gain — RW is same-rate on paper, but our hunger
        // multipliers make "stay fed" much harder, so 2× clears in ~half the starve time.
        const recoverPerMin = gainPerMin * 2;
        // Prefer pre-drain snapshot from hungerTick (see Player.hungerTick)
        const empty = owner._malnutritionFed === undefined
            ? !(Number(owner.kc) > 0 || Number(owner.saturation) > 0)
            : !owner._malnutritionFed;
        let h = body.hediff("malnutrition");

        if (empty) {
            if (!h) {
                h = body.addHediff("malnutrition", 0);
                if (!h) return;
                scene?.combatLog?.push?.("You are malnourished.");
            }
            const prev = this.stageFor(h, scene)?.label;
            h.severity = Math.min(1, (Number(h.severity) || 0) + gainPerMin);
            body.markDirty?.();
            const next = this.stageFor(h, scene)?.label;
            if (next && next !== prev && prev) {
                scene?.combatLog?.push?.(`Malnutrition is now ${next}.`);
            }
            const lethal = def.lethalSeverity != null ? Number(def.lethalSeverity) : 1;
            if ((Number(h.severity) || 0) >= lethal - 1e-9) {
                scene?.combatLog?.push?.("You starved to death.");
                owner.onBodyFatal?.(null, "starvation");
            }
            return;
        }

        if (!h) return;
        const prev = this.stageFor(h, scene)?.label;
        h.severity = (Number(h.severity) || 0) - recoverPerMin;
        if (h.severity <= 0) {
            body.removeHediff("malnutrition");
            scene?.combatLog?.push?.("You are no longer malnourished.");
            return;
        }
        body.markDirty?.();
        const next = this.stageFor(h, scene)?.label;
        if (next && next !== prev) {
            scene?.combatLog?.push?.(`Malnutrition is now ${next}.`);
        }
    },

    _tickSeverityAndVomit(owner, body, scene) {
        const list = body.hediffs || [];
        for (let i = list.length - 1; i >= 0; i--) {
            const h = list[i];
            if (h.id === "malnutrition") continue;
            const def = this.def(scene, h.id);
            if (!def) continue;

            const spd = Number(def.severityPerDay);
            if (Number.isFinite(spd) && spd !== 0) {
                h.severity = (Number(h.severity) || 0) + spd / this.MINUTES_PER_DAY;
                body.markDirty?.();
            }

            if ((Number(h.severity) || 0) <= 0) {
                body.removeHediff(h.id);
                if (h.id === "food_poisoning") {
                    scene?.combatLog?.push?.("You recovered from food poisoning.");
                }
                continue;
            }

            // Vomit MTB — player only for now
            if (h.id === "food_poisoning" && typeof owner.startVomit === "function") {
                const stage = this.stageFor(h, scene);
                const mtb = Number(stage?.vomitMtbDays);
                if (mtb > 0 && Math.random() < this.mtbChancePerMinute(mtb)) {
                    owner.startVomit();
                }
            }
        }
    },

    /** Tooltip lines for a hediff stage. */
    tooltipFor(hediff, scene) {
        const stage = this.stageFor(hediff, scene);
        if (!stage) return null;
        const lines = [];
        if (stage.painOffset) lines.push(`Pain: +${Math.round(stage.painOffset * 100)}%`);
        const off = stage.capacityOffsets || {};
        for (const [k, v] of Object.entries(off)) {
            const sign = v >= 0 ? "+" : "";
            lines.push(`${this._capLabel(k)}: ${sign}${Math.round(v * 100)}%`);
        }
        const fac = stage.capacityFactors || {};
        for (const [k, v] of Object.entries(fac)) {
            lines.push(`${this._capLabel(k)}: ×${v}`);
        }
        const mx = stage.capacityMax || {};
        for (const [k, v] of Object.entries(mx)) {
            lines.push(`${this._capLabel(k)}: max ${Math.round(v * 100)}%`);
        }
        if (stage.hungerRateFactor && stage.hungerRateFactor !== 1) {
            lines.push(`Hunger rate: ×${stage.hungerRateFactor}`);
        }
        if (stage.vomitMtbDays) {
            lines.push(`Vomit MTB: ${stage.vomitMtbDays} days`);
        }
        const sev = Number(hediff.severity);
        if (Number.isFinite(sev)) {
            lines.push(`Severity: ${Math.round(sev * 100)}%`);
        }
        return lines.length ? lines.join("\n") : null;
    },

    _capLabel(key) {
        const map = {
            consciousness: "Consciousness",
            moving: "Moving",
            manipulation: "Manipulation",
            bloodFiltration: "Blood Filtration",
            talking: "Talking",
            eating: "Eating",
            breathing: "Breathing",
            bloodPumping: "Blood Pumping",
            digestion: "Digestion",
            sight: "Sight",
            hearing: "Hearing"
        };
        return map[key] || key;
    }
};
