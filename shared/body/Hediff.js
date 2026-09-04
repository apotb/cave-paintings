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
        INFECT_MINUTES_MIN: 360,
        INFECT_MINUTES_MAX: 1080,
        ANIMAL_INFECTION_FACTOR: 0.2,
        SELF_TEND_FACTOR: 0.7,
        BED_INFECTION_FACTOR: 0.5,
        INFECTION_LUCK_MIN: 0.8,
        INFECTION_LUCK_MAX: 1.2,
        REST_IGS_FACTOR: 1.1,

        defs(ctxOrScene) {
            const data = resolveData(ctxOrScene);
            if (data) return data.getHediffDefs() || {};
            return ctxOrScene?.cache?.json?.get?.("hediffs") || {};
        },

        def(ctxOrScene, id) {
            return this.defs(ctxOrScene)[id] || null;
        },

        injuryDefs(ctxOrScene) {
            const data = resolveData(ctxOrScene);
            if (data?.getInjuryDefs) return data.getInjuryDefs() || {};
            return ctxOrScene?.cache?.json?.get?.("injuries") || {};
        },

        isAnimal(owner) {
            return !!(owner && owner.kind === "mob");
        },

        animalInfectionFactor(owner) {
            return this.isAnimal(owner) ? this.ANIMAL_INFECTION_FACTOR : 1;
        },

        tendInfectionFactor(tendQuality) {
            const q = Math.max(0, Math.min(1, Number(tendQuality) || 0));
            return 0.85 - 0.8 * q;
        },

        stageBChance(injury, owner) {
            if (!injury) return 0;
            const tendFactor = injury.tended
                ? this.tendInfectionFactor(injury.tendQuality)
                : 1;
            let bed = 1;
            if (injury.tended) {
                const snap = Number(injury.infectBedFactor);
                bed = Number.isFinite(snap) && snap > 0 ? snap : 1;
            } else if (owner?._resting) {
                bed = this.BED_INFECTION_FACTOR;
            }
            return tendFactor * bed;
        },

        infectionNeedsTend(hediff) {
            if (!hediff || hediff.id !== "infection") return false;
            if (!hediff.tended) return true;
            return !(Number(hediff.tendMinutesLeft) > 0);
        },

        hasInfections(body) {
            return (body?.hediffs || []).some((h) => h.id === "infection");
        },

        infectionsOf(body) {
            return (body?.hediffs || []).filter((h) => h.id === "infection");
        },

        immunityOf(body, key = "infection") {
            const n = Number(body?.immunities?.[key]);
            return Number.isFinite(n) ? n : 0;
        },

        isImmune(body, key = "infection") {
            return this.immunityOf(body, key) >= 1 - 1e-9;
        },

        /**
         * Stage A: if this fails, the wound never infects.
         */
        armInfecter(injury, owner, math) {
            if (!injury || injury.permanent) return false;
            const base = Number(injury.infectionChance);
            if (!(base > 0)) return false;
            const m = math || resolveMath(owner?.anatomy?.ctx || owner?.ctx || owner?.scene);
            const p = base * this.animalInfectionFactor(owner);
            if (m.random() >= p) {
                injury.infectInMinutes = null;
                return false;
            }
            injury.infectInMinutes = m.between(this.INFECT_MINUTES_MIN, this.INFECT_MINUTES_MAX);
            return true;
        },

        _bloodFiltration(owner, body, ctx) {
            const eff = (name) => {
                const p = body?.part?.(name);
                return p && typeof p.efficiency === "function" ? p.efficiency() : 1;
            };
            const math = resolveMath(ctx || body?.ctx);
            let bf = math.clamp(
                (eff("Left Kidney") + eff("Right Kidney")) * 0.5 * eff("Liver"),
                0,
                1
            );
            for (const h of body?.hediffs || []) {
                const stage = this.stageFor(h, ctx || body?.ctx);
                if (!stage) continue;
                const off = stage.capacityOffsets?.bloodFiltration;
                if (off != null) bf += Number(off) || 0;
                const fac = stage.capacityFactors?.bloodFiltration;
                if (fac != null && Number.isFinite(Number(fac))) bf *= Number(fac);
                const mx = stage.capacityMax?.bloodFiltration;
                if (mx != null && Number.isFinite(Number(mx))) bf = Math.min(bf, Number(mx));
            }
            return math.clamp(bf, 0, 1);
        },

        immunityGainSpeed(owner, body, ctx) {
            const bf = this._bloodFiltration(owner, body, ctx);
            let igs = bf * 0.5 + 0.5;
            if (owner?._resting) igs *= this.REST_IGS_FACTOR;
            return igs;
        },

        infectionOnsetMessage(owner, partName, ctx) {
            const part = partName ? String(partName) : "a wound";
            if (this._logIsYou(owner, ctx)) return `You have an infection (${part})`;
            return `${this._logName(owner)} has an infection (${part})`;
        },

        infectionRecoveredMessage(owner, ctx) {
            return this._logIsYou(owner, ctx)
                ? "You recovered from an infection"
                : `${this._logName(owner)} recovered from an infection`;
        },

        infectionDiedMessage(owner, ctx) {
            return this._logIsYou(owner, ctx)
                ? "You died of infection"
                : `${this._logName(owner)} died of infection`;
        },

        startInfection(owner, body, partName, ctx) {
            if (!body?.addHediff || !partName) return null;
            const part = body.part?.(partName);
            if (!part || part.isDead?.()) return null;
            if (body.localHediff?.("infection", partName)) return null;
            const had = this.hasInfections(body);
            const h = body.addHediff("infection", 0.001, { partName });
            if (!h) return null;
            if (!had) {
                body.immunities = body.immunities || {};
                body.immunities.infection = 0;
                const math = resolveMath(ctx || body.ctx);
                h.luck = math.floatBetween(this.INFECTION_LUCK_MIN, this.INFECTION_LUCK_MAX);
            }
            const log = combatLogOf(ctx || body.ctx);
            log?.push?.(this.infectionOnsetMessage(owner, partName, ctx), { owner });
            return h;
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

        /** Combat-log “You” vs pawn name (controlled pawn only). */
        _logIsYou(owner, ctx) {
            if (!owner) return true;
            if (typeof owner.isControlled === "function") return !!owner.isControlled();
            const host = ctx || owner.ctx || owner.scene;
            if (typeof host?.isControlled === "function") return !!host.isControlled(owner);
            if (host?.player) return host.player === owner;
            const sim = host?.sim;
            if (sim?.players) {
                const pid = owner.id || owner.pawnId;
                for (const p of sim.players.values()) {
                    if (!p.connected) continue;
                    if ((p.controlId || p.id) === pid) return true;
                }
                return false;
            }
            return false;
        },

        _logName(owner) {
            if (!owner) return "Someone";
            if (typeof owner.displayName === "function") {
                const n = owner.displayName();
                if (n) return n;
            }
            return owner.pawnName || owner.name || "Someone";
        },

        foodPoisonMessage(owner, worse, ctx) {
            if (this._logIsYou(owner, ctx)) {
                return worse ? "Your food poisoning got worse" : "You have food poisoning";
            }
            const name = this._logName(owner);
            return worse
                ? `${name}'s food poisoning got worse`
                : `${name} has food poisoning`;
        },

        malnutritionOnsetMessage(owner, ctx) {
            return this._logIsYou(owner, ctx)
                ? "You are malnourished"
                : `${this._logName(owner)} is malnourished`;
        },

        malnutritionRecoveredMessage(owner, ctx) {
            return this._logIsYou(owner, ctx)
                ? "You are no longer malnourished"
                : `${this._logName(owner)} is no longer malnourished`;
        },

        malnutritionStageMessage(owner, stageLabel, ctx) {
            if (this._logIsYou(owner, ctx)) {
                return `Your malnutrition is now ${stageLabel}`;
            }
            return `${this._logName(owner)}'s malnutrition is now ${stageLabel}`;
        },

        malnutritionStarvedMessage(owner, ctx) {
            return this._logIsYou(owner, ctx)
                ? "You starved to death"
                : `${this._logName(owner)} starved to death`;
        },

        /**
         * Roll food-poison chance after a successful eat.
         * First hit → severity 1.0 (initial). Re-poison while already sick restarts
         * the clock but never eases you out of major: if past initial, jump to peak
         * major (~0.799) instead of resetting to mild initial.
         * @returns {{ message: string, worse: boolean }|null}
         */
        tryFoodPoison(body, food, meta = null, rng = null, who = null) {
            const chance = Number(food?.foodPoisonChance ?? meta?.food?.foodPoisonChance ?? 0);
            if (!(chance > 0) || !body?.addHediff) return null;
            const roll = typeof rng === "function" ? rng() : Math.random();
            if (roll >= chance) return null;

            const existing = body.hediff?.("food_poisoning");
            const INITIAL_MIN = 0.8;
            const MAJOR_PEAK = INITIAL_MIN - 0.001;
            let sev = 1;
            const worse = !!existing;
            if (existing) {
                const cur = Number(existing.severity) || 0;
                sev = cur >= INITIAL_MIN ? 1 : Math.max(cur, MAJOR_PEAK);
            }
            body.addHediff("food_poisoning", sev);
            return { message: this.foodPoisonMessage(who, worse), worse };
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

            this._tickInfecters(owner, body, ctx);
            if (owner.isBodyDead?.()) return;
            this._tickInfections(owner, body, ctx);
            if (owner.isBodyDead?.()) return;

            // Players track hunger (client Player.hungerTick, or dedicated SimCreature kind).
            // Mobs must not gain malnutrition.
            if (this._ownerTracksHunger(owner)) {
                this._tickMalnutrition(owner, body, ctx);
                if (owner.isBodyDead?.()) return;
            }
            this._tickSeverityAndVomit(owner, body, ctx);
        },

        _tickInfecters(owner, body, ctx) {
            const math = resolveMath(ctx);
            for (const part of Object.values(body.parts() || {})) {
                if (!part || part.isDead?.()) continue;
                for (const inj of part.injuries || []) {
                    if (!inj) continue;
                    if (inj.permanent) {
                        if (inj.infectInMinutes != null) inj.infectInMinutes = null;
                        continue;
                    }
                    const left = Number(inj.infectInMinutes);
                    if (!Number.isFinite(left) || left <= 0) continue;
                    inj.infectInMinutes = left - 1;
                    body.markDirty?.();
                    if (inj.infectInMinutes > 0) continue;
                    inj.infectInMinutes = null;
                    if (body.localHediff?.("infection", part.name)) continue;
                    if (math.random() >= this.stageBChance(inj, owner)) continue;
                    this.startInfection(owner, body, part.name, ctx);
                }
            }
        },

        _tickInfections(owner, body, ctx) {
            const infections = this.infectionsOf(body);
            const immMap = body.immunities || (body.immunities = {});
            const log = combatLogOf(ctx);

            if (!infections.length) {
                const cur = Number(immMap.infection) || 0;
                if (cur > 0) {
                    immMap.infection = cur - 0.4 / this.MINUTES_PER_DAY;
                    if (immMap.infection <= 0) delete immMap.infection;
                    body.markDirty?.();
                }
                return;
            }

            const def = this.def(ctx, "infection");
            const oldest = infections[0];
            const luckN = Number(oldest.luck);
            const luck = Number.isFinite(luckN) && luckN > 0 ? luckN : 1;
            const igs = this.immunityGainSpeed(owner, body, ctx);
            const immune = (Number(immMap.infection) || 0) >= 1 - 1e-9;
            if (!immune) {
                const perDay = (Number(def?.immunityPerDaySick) || 0.6441) * igs * luck;
                immMap.infection = Math.min(
                    1,
                    (Number(immMap.infection) || 0) + perDay / this.MINUTES_PER_DAY
                );
                body.markDirty?.();
            }

            const nowImmune = (Number(immMap.infection) || 0) >= 1 - 1e-9;
            const sevNotImmune = Number(def?.severityPerDayNotImmune) || 0.84;
            const sevTended = Number(def?.severityPerDayTended) || -0.53;
            const sevImmune = Number(def?.severityPerDayImmune) || -0.7;
            const lethal = def?.lethalSeverity != null ? Number(def.lethalSeverity) : 1;

            for (let i = infections.length - 1; i >= 0; i--) {
                const h = infections[i];
                if (h.tended && Number(h.tendMinutesLeft) > 0) {
                    h.tendMinutesLeft -= 1;
                    if (h.tendMinutesLeft <= 0) {
                        h.tendMinutesLeft = 0;
                        h.tended = false;
                    }
                    body.markDirty?.();
                } else if (h.tended && !(Number(h.tendMinutesLeft) > 0)) {
                    h.tended = false;
                    h.tendMinutesLeft = 0;
                    body.markDirty?.();
                }

                let delta;
                if (nowImmune) {
                    delta = sevImmune / this.MINUTES_PER_DAY;
                } else {
                    delta = sevNotImmune / this.MINUTES_PER_DAY;
                    if (h.tended) {
                        const q = Math.max(0, Math.min(1, Number(h.tendQuality) || 0));
                        delta += (sevTended * q) / this.MINUTES_PER_DAY;
                    }
                }
                h.severity = (Number(h.severity) || 0) + delta;
                body.markDirty?.();

                if ((Number(h.severity) || 0) >= lethal - 1e-9) {
                    log?.push?.(this.infectionDiedMessage(owner, ctx), { owner });
                    owner.onBodyFatal?.(null, "infection");
                    return;
                }
                if ((Number(h.severity) || 0) <= 0) {
                    body.removeHediff(h.id, h.partName);
                    log?.push?.(this.infectionRecoveredMessage(owner, ctx), { owner });
                }
            }
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
                    log?.push?.(this.malnutritionOnsetMessage(owner, ctx), { owner });
                }
                const prev = this.stageFor(h, ctx)?.label;
                h.severity = Math.min(1, (Number(h.severity) || 0) + gainPerMin);
                body.markDirty?.();
                const next = this.stageFor(h, ctx)?.label;
                if (next && next !== prev && prev) {
                    log?.push?.(this.malnutritionStageMessage(owner, next, ctx), { owner });
                }
                const lethal = def.lethalSeverity != null ? Number(def.lethalSeverity) : 1;
                if ((Number(h.severity) || 0) >= lethal - 1e-9) {
                    log?.push?.(this.malnutritionStarvedMessage(owner, ctx), { owner });
                    owner.onBodyFatal?.(null, "starvation");
                }
                return;
            }

            if (!h) return;
            const prev = this.stageFor(h, ctx)?.label;
            h.severity = (Number(h.severity) || 0) - recoverPerMin;
            if (h.severity <= 0) {
                body.removeHediff("malnutrition");
                log?.push?.(this.malnutritionRecoveredMessage(owner, ctx), { owner });
                return;
            }
            body.markDirty?.();
            const next = this.stageFor(h, ctx)?.label;
            if (next && next !== prev) {
                log?.push?.(this.malnutritionStageMessage(owner, next, ctx), { owner });
            }
        },

        _tickSeverityAndVomit(owner, body, ctx) {
            const math = resolveMath(ctx);
            const log = combatLogOf(ctx);
            const list = body.hediffs || [];
            for (let i = list.length - 1; i >= 0; i--) {
                const h = list[i];
                if (!h || h.id === "malnutrition" || h.id === "infection") continue;
                const def = this.def(ctx, h.id);
                if (!def || def.local) continue;

                const spd = Number(def.severityPerDay);
                if (Number.isFinite(spd) && spd !== 0) {
                    h.severity = (Number(h.severity) || 0) + spd / this.MINUTES_PER_DAY;
                    body.markDirty?.();
                }

                if ((Number(h.severity) || 0) <= 0) {
                    body.removeHediff(h.id);
                    if (h.id === "food_poisoning") {
                        const recovered = this._logIsYou(owner, ctx)
                            ? "You recovered from food poisoning"
                            : `${this._logName(owner)} recovered from food poisoning`;
                        log?.push?.(recovered);
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

        tooltipFor(hediff, ctxOrScene, body = null) {
            const stage = this.stageFor(hediff, ctxOrScene);
            if (!stage && hediff?.id !== "infection") return null;
            const lines = [];
            if (stage?.painOffset) {
                lines.push(`Pain: +${Math.round(stage.painOffset * 100)}%`);
            }
            const off = stage?.capacityOffsets || {};
            for (const [k, v] of Object.entries(off)) {
                const sign = v >= 0 ? "+" : "";
                lines.push(`${this._capLabel(k)}: ${sign}${Math.round(v * 100)}%`);
            }
            const fac = stage?.capacityFactors || {};
            for (const [k, v] of Object.entries(fac)) {
                lines.push(`${this._capLabel(k)}: ×${v}`);
            }
            const mx = stage?.capacityMax || {};
            for (const [k, v] of Object.entries(mx)) {
                lines.push(`${this._capLabel(k)}: max ${Math.round(v * 100)}%`);
            }
            if (stage?.hungerRateFactor && stage.hungerRateFactor !== 1) {
                lines.push(`Hunger rate: ×${stage.hungerRateFactor}`);
            }
            if (stage?.vomitMtbDays) {
                lines.push(`Vomit MTB: ${stage.vomitMtbDays} days`);
            }
            if (hediff?.id === "infection") {
                const sev = Number(hediff.severity);
                if (Number.isFinite(sev)) {
                    lines.push(`Severity: ${Math.round(sev * 100)}%`);
                }
                const immBody = body || ctxOrScene?.anatomy || null;
                const imm = this.immunityOf(immBody, "infection");
                lines.push(`Immunity: ${Math.round(imm * 100)}%`);
                if (hediff.tended && Number(hediff.tendMinutesLeft) > 0) {
                    const q = Math.max(0, Math.min(1, Number(hediff.tendQuality) || 0));
                    lines.push(`Tend quality: ${Math.round(q * 100)}%`);
                    const mins = Math.max(0, Math.round(Number(hediff.tendMinutesLeft) || 0));
                    const h = Math.floor(mins / 60);
                    const m = mins % 60;
                    lines.push(h > 0 ? `Tended: ${h}h ${m}m left` : `Tended: ${m}m left`);
                } else {
                    lines.push("Needs treatment");
                }
                if (stage?.lifeThreatening) lines.push("Life-threatening");
                return lines.length ? lines.join("\n") : null;
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
