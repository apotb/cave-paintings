/**
 * RimWorld-style whole-body hediffs — Phaser-free UMD.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const GameMath = require("../gameMath");
        const DataStore = require("../DataStore");
        module.exports = factory(GameMath, DataStore);
    } else {
        root.Hediffs = factory(root.GameMath, root.DataStore);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (GameMath, DataStore) {
    function resolveData(ctxOrScene) {
        if (ctxOrScene?.data?.getHediffDefs) return ctxOrScene.data;
        if (DataStore?.isReady?.() || DataStore?.getHediffDefs) return DataStore;
        return null;
    }

    function resolveMath(ctxOrScene) {
        return ctxOrScene?.math || GameMath;
    }

    function combatLogOf(ctxOrScene) {
        return (
            ctxOrScene?.combatLog ||
            ctxOrScene?.scene?.combatLog ||
            (ctxOrScene?.cache ? ctxOrScene.combatLog : null) ||
            null
        );
    }

    const Hediffs = {
        MINUTES_PER_DAY: 1440,

        defs(ctxOrScene) {
            const data = resolveData(ctxOrScene);
            if (data) return data.getHediffDefs() || {};
            return ctxOrScene?.cache?.json?.get?.("hediffs") || {};
        },

        def(ctxOrScene, id) {
            return this.defs(ctxOrScene)[id] || null;
        },

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

        stageFor(hediff, ctxOrScene) {
            const def = hediff.def || this.def(ctxOrScene || hediff.scene, hediff.id);
            return this.stageForDef(def, hediff.severity);
        },

        displayLabel(hediff, ctxOrScene) {
            const def = hediff.def || this.def(ctxOrScene, hediff.id);
            const name = def?.name || hediff.id;
            const stage = this.stageForDef(def, hediff.severity);
            const label = stage?.label;
            return label ? `${name} (${label})` : name;
        },

        mtbChancePerMinute(mtbDays) {
            const mtb = Number(mtbDays);
            if (!(mtb > 0)) return 0;
            return 1 / (mtb * this.MINUTES_PER_DAY);
        },

        /**
         * Roll food-poison chance after a successful eat.
         * First hit → severity 1.0 (initial). Re-poison while already sick restarts
         * the clock but never eases you out of major: if past initial, jump to peak
         * major (~0.799) instead of resetting to mild initial.
         * @returns {{ message: string }|null}
         */
        tryFoodPoison(body, food, meta = null, rng = null) {
            const chance = Number(food?.foodPoisonChance ?? meta?.food?.foodPoisonChance ?? 0);
            if (!(chance > 0) || !body?.addHediff) return null;
            const roll = typeof rng === "function" ? rng() : Math.random();
            if (roll >= chance) return null;

            const existing = body.hediff?.("food_poisoning");
            const INITIAL_MIN = 0.8;
            const MAJOR_PEAK = INITIAL_MIN - 0.001;
            let sev = 1;
            let message = "You have food poisoning.";
            if (existing) {
                const cur = Number(existing.severity) || 0;
                sev = cur >= INITIAL_MIN ? 1 : Math.max(cur, MAJOR_PEAK);
                message = "Your food poisoning got worse.";
            }
            body.addHediff("food_poisoning", sev);
            return { message };
        },

        /**
         * Once per game minute on a living owner with anatomy.
         * @param {Object} owner
         * @param {object|Phaser.Scene} ctxOrScene
         */
        minuteTick(owner, ctxOrScene) {
            const body = owner?.anatomy;
            if (!body || owner.isBodyDead?.()) return;
            const ctx = body.ctx || ctxOrScene;

            // Players track hunger (client Player.hungerTick, or dedicated SimCreature kind).
            // Mobs must not gain malnutrition.
            if (this._ownerTracksHunger(owner)) {
                this._tickMalnutrition(owner, body, ctx);
                if (owner.isBodyDead?.()) return;
            }
            this._tickSeverityAndVomit(owner, body, ctx);
        },

        _ownerTracksHunger(owner) {
            if (!owner) return false;
            if (typeof owner.hungerTick === "function") return true;
            return owner.kind === "player";
        },

        _tickMalnutrition(owner, body, ctx) {
            const def = this.def(ctx, "malnutrition");
            if (!def) return;
            const log = combatLogOf(ctx);

            const rate = Number(body.malnutritionRatePerDay);
            const gainPerMin =
                (Number.isFinite(rate) && rate > 0 ? rate : 0.45) / this.MINUTES_PER_DAY;
            const recoverPerMin = gainPerMin * 2;
            const empty =
                owner._malnutritionFed === undefined
                    ? !(Number(owner.kc) > 0 || Number(owner.saturation) > 0)
                    : !owner._malnutritionFed;
            let h = body.hediff("malnutrition");

            if (empty) {
                if (!h) {
                    h = body.addHediff("malnutrition", 0);
                    if (!h) return;
                    log?.push?.("You are malnourished.", { owner });
                }
                const prev = this.stageFor(h, ctx)?.label;
                h.severity = Math.min(1, (Number(h.severity) || 0) + gainPerMin);
                body.markDirty?.();
                const next = this.stageFor(h, ctx)?.label;
                if (next && next !== prev && prev) {
                    log?.push?.(`Malnutrition is now ${next}.`, { owner });
                }
                const lethal = def.lethalSeverity != null ? Number(def.lethalSeverity) : 1;
                if ((Number(h.severity) || 0) >= lethal - 1e-9) {
                    log?.push?.("You starved to death.", { owner });
                    owner.onBodyFatal?.(null, "starvation");
                }
                return;
            }

            if (!h) return;
            const prev = this.stageFor(h, ctx)?.label;
            h.severity = (Number(h.severity) || 0) - recoverPerMin;
            if (h.severity <= 0) {
                body.removeHediff("malnutrition");
                log?.push?.("You are no longer malnourished.", { owner });
                return;
            }
            body.markDirty?.();
            const next = this.stageFor(h, ctx)?.label;
            if (next && next !== prev) {
                log?.push?.(`Malnutrition is now ${next}.`, { owner });
            }
        },

        _tickSeverityAndVomit(owner, body, ctx) {
            const math = resolveMath(ctx);
            const log = combatLogOf(ctx);
            const list = body.hediffs || [];
            for (let i = list.length - 1; i >= 0; i--) {
                const h = list[i];
                if (h.id === "malnutrition") continue;
                const def = this.def(ctx, h.id);
                if (!def) continue;

                const spd = Number(def.severityPerDay);
                if (Number.isFinite(spd) && spd !== 0) {
                    h.severity = (Number(h.severity) || 0) + spd / this.MINUTES_PER_DAY;
                    body.markDirty?.();
                }

                if ((Number(h.severity) || 0) <= 0) {
                    body.removeHediff(h.id);
                    if (h.id === "food_poisoning") {
                        log?.push?.("You recovered from food poisoning.", { owner });
                    }
                    continue;
                }

                if (h.id === "food_poisoning" && typeof owner.startVomit === "function") {
                    const stage = this.stageFor(h, ctx);
                    const mtb = Number(stage?.vomitMtbDays);
                    if (mtb > 0 && math.random() < this.mtbChancePerMinute(mtb)) {
                        owner.startVomit();
                    }
                }
            }
        },

        tooltipFor(hediff, ctxOrScene) {
            const stage = this.stageFor(hediff, ctxOrScene);
            if (!stage) return null;
            const lines = [];
            if (stage.painOffset) {
                lines.push(`Pain: +${Math.round(stage.painOffset * 100)}%`);
            }
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

    return Hediffs;
});
