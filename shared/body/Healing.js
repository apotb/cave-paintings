/**
 * Bleed, blood loss, natural healing — Phaser-free UMD.
 * VFX (spawnBloodStain) is a no-op when the host scene lacks it.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const GameMath = require("../gameMath");
        const Capacities = require("./Capacities");
        const Hediffs = require("./Hediff");
        module.exports = factory(GameMath, Capacities, Hediffs);
    } else {
        root.BodyHealing = factory(root.GameMath, root.Capacities, root.Hediffs);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
    GameMath,
    Capacities,
    Hediffs
) {
    function mathOf(ctxOrScene) {
        return ctxOrScene?.math || GameMath;
    }

    function resolveHost(owner, ctxOrScene) {
        return ctxOrScene || owner?.anatomy?.ctx || owner?.scene || null;
    }

    function combatLogOf(ctxOrScene) {
        return (
            ctxOrScene?.combatLog ||
            ctxOrScene?.scene?.combatLog ||
            (ctxOrScene?.cache ? ctxOrScene.combatLog : null) ||
            null
        );
    }

    function isPartyPawn(owner) {
        if (!owner) return false;
        if (owner.kind === "mob") return false;
        if (owner.role === "wanderer") return false;
        if (owner.kind === "player") return true;
        return owner.role === "leader" || owner.role === "companion";
    }

    const BodyHealing = {
        BASE_HEAL_RATE: 11.52,
        MINUTES_PER_DAY: 1440,
        BLOOD_RECOVERY_PER_MINUTE: 1 / 3 / 1440,
        STUMP_BLEED_RATE: 0.06,

        injuryBleedPerDay(inj, part) {
            if (!inj || inj.permanent || inj.tended || !inj.bleeding) return 0;
            const mult = Number(part?.def?.bleedMult) || 1;
            return (Number(inj.severity) || 0) * (Number(inj.bleedRate) || 0) * mult;
        },

        injuryBleedPerMinute(inj, part) {
            return this.injuryBleedPerDay(inj, part) / this.MINUTES_PER_DAY;
        },

        stumpBleedPerDay(d) {
            if (!d || d.tended) return 0;
            return d.mhp * 2 * this.STUMP_BLEED_RATE * (d.bleedMult || 1);
        },

        stumpBleedPerMinute(d) {
            return this.stumpBleedPerDay(d) / this.MINUTES_PER_DAY;
        },

        isStumpPart(part) {
            if (!part || part.internal) return false;
            const id = part.baseId || part.name || "";
            return /Arm|Leg|Hand|Foot|Shoulder|Finger|Toe|Hoof|Thumb/i.test(id);
        },

        destroyedBleedLabel(body, partName) {
            const part = body?.part?.(partName);
            return this.isStumpPart(part) ? "stump (bleeding)" : "missing (bleeding)";
        },

        bleedRateTotal(body) {
            let rate = 0;
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

        bleedPerDay(body) {
            return this.bleedRateTotal(body) * this.MINUTES_PER_DAY;
        },

        minutesToBleedOut(body) {
            const perMin = this.bleedRateTotal(body);
            if (!(perMin > 0)) return null;
            const remaining = Math.max(0, 1 - (body.bloodLoss || 0));
            return remaining / perMin;
        },

        minuteTick(owner, ctxOrScene) {
            const body = owner.anatomy;
            if (!body) return;
            const host = resolveHost(owner, ctxOrScene);

            const bleed = this.bleedRateTotal(body);
            if (bleed > 0) {
                body.bloodLoss = Math.min(1, (body.bloodLoss || 0) + bleed);
                body.markDirty?.();
                this._spawnBleedStains(owner, host, bleed);
            } else if ((body.bloodLoss || 0) > 0) {
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

            if (
                this.healGameMinute(owner, host)
                && isPartyPawn(owner)
                && !owner.isBodyDead?.()
                && !(Hediffs && Hediffs.hasInfections?.(owner.anatomy))
            ) {
                this._announceFullyHealed(owner, host);
            }

            if (Hediffs && typeof Hediffs.minuteTick === "function") {
                Hediffs.minuteTick(owner, host);
            }
        },

        hasHealableInjuries(body) {
            if (!body || typeof body.parts !== "function") return false;
            for (const part of Object.values(body.parts() || {})) {
                if (!part || part.isDead?.()) continue;
                for (const inj of part.injuries || []) {
                    if (inj && !inj.permanent) return true;
                }
            }
            return false;
        },

        fullyHealedMessage(owner, host) {
            const you = Hediffs && typeof Hediffs._logIsYou === "function"
                ? Hediffs._logIsYou(owner, host)
                : !!(typeof owner?.isControlled === "function" && owner.isControlled());
            if (you) return "You are fully healed";
            const name = Hediffs && typeof Hediffs._logName === "function"
                ? Hediffs._logName(owner)
                : (owner?.displayName?.() || owner?.pawnName || owner?.name || "Someone");
            return `${name} is fully healed`;
        },

        _announceFullyHealed(owner, host) {
            const log = combatLogOf(host) || combatLogOf(owner?.scene);
            log?.push?.(this.fullyHealedMessage(owner, host), { owner });
        },

        /**
         * Scatter N stains around an owner, or emit a net FX cue when the host
         * provides emitBleedFx (dedicated server — clients paint locally).
         */
        _scatterStains(owner, host, n, minDistTiles = 0.08, maxDistTiles = 0.5) {
            if (!(n > 0)) return;
            if (typeof host?.emitBleedFx === "function") {
                const c =
                    typeof owner.bodyCenter === "function"
                        ? owner.bodyCenter()
                        : { x: owner.x, y: owner.y };
                host.emitBleedFx({
                    x: c.x,
                    y: c.y,
                    n: Math.max(1, Math.floor(n)),
                    burst: true,
                    ownerId: owner.id || null,
                    prone: !!owner._prone,
                    kind: owner.kind || null
                });
                return;
            }
            if (!host?.spawnBloodStain) return;
            const math = mathOf(host);
            const ts = host.tileSize || host.scene?.tileSize || 16;
            const c =
                typeof owner.bodyCenter === "function"
                    ? owner.bodyCenter()
                    : { x: owner.x, y: owner.y };
            const span = Math.max(0.05, maxDistTiles - minDistTiles);

            for (let i = 0; i < n; i++) {
                const ang = math.random() * Math.PI * 2;
                const dist = (minDistTiles + math.random() * span) * ts;
                const jx = (math.random() - 0.5) * 2;
                const jy = (math.random() - 0.5) * 2;
                host.spawnBloodStain(
                    c.x + Math.cos(ang) * dist + jx,
                    c.y + Math.sin(ang) * dist + jy
                );
            }
        },

        _spawnBleedStains(owner, host, bleed) {
            const math = mathOf(host);
            let n = Math.floor(bleed * 40);
            if (math.random() < Math.min(0.75, 0.2 + bleed * 25)) n += 1;
            if (bleed > 0.02 && math.random() < 0.35) n += 1;
            n = math.clamp(n, 0, 2);
            if (n <= 0) return;

            // Dedicated / headless: cue clients (no Phaser delayedCall)
            if (typeof host?.emitBleedFx === "function") {
                const c =
                    typeof owner.bodyCenter === "function"
                        ? owner.bodyCenter()
                        : { x: owner.x, y: owner.y };
                host.emitBleedFx({
                    x: c.x,
                    y: c.y,
                    n,
                    burst: false,
                    ownerId: owner.id || null,
                    prone: !!owner._prone,
                    kind: owner.kind || null
                });
                return;
            }
            if (!host?.spawnBloodStain || !host?.time?.delayedCall) return;

            if (owner._bleedDripPhase == null) {
                owner._bleedDripPhase = math.random();
            }
            const tickSpeed =
                host.tickSpeed ?? host.scene?.tickSpeed ?? Number(host.ctx?.tickSpeed) ?? 1;
            const minuteMs = Math.max(80, 1000 / Math.max(0.05, Number(tickSpeed) || 1));
            const phase = owner._bleedDripPhase * minuteMs;

            for (let i = 0; i < n; i++) {
                const slot = (phase + ((i + 0.5) / n) * minuteMs) % minuteMs;
                const delay = math.clamp(
                    slot + (math.random() - 0.5) * (minuteMs / Math.max(2, n)),
                    0,
                    minuteMs - 1
                );
                host.time.delayedCall(delay, () => {
                    if (!owner || owner.isBodyDead?.()) return;
                    if (owner.active === false) return;
                    if (!owner.anatomy || this.bleedRateTotal(owner.anatomy) <= 0) return;
                    this._scatterStains(owner, host, 1);
                });
            }
        },

        spawnHitBleedBurst(owner, host, injury, part, destroyed = false) {
            if (!injury?.bleeding) return;
            const math = mathOf(host);
            const severity = Number(injury.severity) || 0;
            const bleedRate = Number(injury.bleedRate) || 0;
            if (!(severity > 0) || !(bleedRate > 0)) return;

            const mult = Number(part?.def?.bleedMult) || 1;
            const score = severity * bleedRate * mult;
            let n = 1 + Math.floor(score * 5);
            if (score > 1) n += 1;
            if (destroyed) n += 1;
            n = math.clamp(n, 1, 4);

            if (typeof host?.emitBleedFx === "function") {
                const c =
                    typeof owner.bodyCenter === "function"
                        ? owner.bodyCenter()
                        : { x: owner.x, y: owner.y };
                host.emitBleedFx({
                    x: c.x,
                    y: c.y,
                    n,
                    burst: true,
                    ownerId: owner.id || null,
                    prone: !!owner._prone,
                    kind: owner.kind || null
                });
                return;
            }
            if (!host?.spawnBloodStain) return;
            this._scatterStains(owner, host, n, 0.06, 0.65);
        },

        /** Client helper: paint a local-only bleed burst/drip at a world point. */
        spawnBleedFxAt(host, x, y, n = 1, burst = true) {
            if (!host?.spawnBloodStain) return;
            const owner = {
                x,
                y,
                bodyCenter: () => ({ x, y })
            };
            const count = Math.max(1, Math.min(4, Math.floor(Number(n) || 1)));
            if (burst) this._scatterStains(owner, host, count, 0.06, 0.65);
            else this._scatterStains(owner, host, count, 0.08, 0.5);
        },

        healGameMinute(owner, ctxOrScene) {
            const body = owner.anatomy;
            if (!body) return false;
            const host = resolveHost(owner, ctxOrScene);
            const math = mathOf(body.ctx || host);

            let worldMin = null;
            if (typeof host?.worldMinuteIndex === "function") {
                worldMin = host.worldMinuteIndex();
            } else if (typeof body.ctx?.worldMinuteIndex === "function") {
                worldMin = body.ctx.worldMinuteIndex();
            }
            if (worldMin != null && worldMin % 10 !== 0) return false;

            const wounds = [];
            for (const part of Object.values(body.parts())) {
                if (part.isDead()) continue;
                for (const inj of part.injuries) {
                    if (!inj.permanent) wounds.push({ part, inj });
                }
            }
            if (!wounds.length) return false;

            const pick = math.pick(wounds);
            const { part, inj } = pick;
            const base = Number(body.plan?.healRate) || this.BASE_HEAL_RATE;
            let healRate = base;
            if (inj.tended) {
                const q = math.clamp(Number(inj.tendQuality) || 0, 0, 1);
                healRate += 4 + q * 8;
            }
            if (owner._resting) healRate += 8;
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
            return !this.hasHealableInjuries(body);
        },

        isTendTargetValid(body, target) {
            if (target?.hediff) {
                return !!(Hediffs && Hediffs.infectionNeedsTend?.(target.hediff));
            }
            return !!this.resolveTendTarget(body, target);
        },

        /**
         * Re-find a tend target after body JSON reloads (MP YOU sync replaces injury objects).
         * @param {object} body
         * @param {object} hint locked target or serializable fields
         */
        resolveTendTarget(body, hint) {
            if (!body || !hint) return null;
            const hediffId = hint.hediffId || hint.hediff?.id || null;
            if (hediffId || hint.hediff) {
                const partName = hint.partName || hint.hediff?.partName || null;
                const h = (body.hediffs || []).find(
                    (x) => x && x.id === (hediffId || "infection") && x.partName === partName
                );
                if (h && Hediffs && Hediffs.infectionNeedsTend?.(h)) return { hediff: h };
                return null;
            }
            const destroyedName = hint.destroyed?.partName || hint.destroyedPartName || null;
            if (destroyedName || hint.destroyed) {
                const name = destroyedName || hint.destroyed?.partName;
                const d = (body.destroyedBleed || []).find(
                    (x) => x && !x.tended && x.partName === name
                );
                return d ? { destroyed: d } : null;
            }
            const partName = hint.part?.name || hint.partName || null;
            const part = partName ? body.part?.(partName) : hint.part || null;
            if (!part || part.isDead?.()) return null;
            const injuries = Array.isArray(part.injuries) ? part.injuries : [];
            const idx = Number(hint.injuryIndex);
            if (Number.isInteger(idx) && idx >= 0 && idx < injuries.length) {
                const inj = injuries[idx];
                if (inj && !inj.permanent && !inj.tended) {
                    const want = hint.inj || hint.injury;
                    if (
                        !want
                        || (want.id != null && inj.id === want.id)
                        || (want.name && inj.name === want.name)
                    ) {
                        return { part, inj };
                    }
                }
            }
            const want = hint.inj || hint.injury || null;
            if (want) {
                const byId = injuries.find(
                    (i) => i && !i.permanent && !i.tended && want.id != null && i.id === want.id
                );
                if (byId) return { part, inj: byId };
                const byName = injuries.find(
                    (i) => i && !i.permanent && !i.tended && want.name && i.name === want.name
                );
                if (byName) return { part, inj: byName };
            }
            // Same object still in the list (SP / no reload)
            if (hint.inj && injuries.includes(hint.inj) && !hint.inj.permanent && !hint.inj.tended) {
                return { part, inj: hint.inj };
            }
            return null;
        },

        /** RimWorld-style: one medicine tend covers up to this much injury severity. */
        BATCH_TEND_SEVERITY: 20,

        tendTargetSeverity(target) {
            if (!target) return 0;
            if (target.destroyed) {
                const mhp = Number(target.destroyed.mhp);
                return Number.isFinite(mhp) && mhp > 0 ? mhp * 2 : this.BATCH_TEND_SEVERITY;
            }
            return Math.max(0, Number(target.inj?.severity) || 0);
        },

        tendTargetHint(target) {
            if (!target) return null;
            if (target.hediff) {
                return {
                    hediffId: target.hediff.id,
                    partName: target.hediff.partName || null
                };
            }
            return {
                partName: target.part?.name || null,
                injuryIndex: target.part && target.inj
                    ? target.part.injuries.indexOf(target.inj)
                    : -1,
                injuryId: target.inj?.id,
                injuryName: target.inj?.name,
                injurySeverity: target.inj?.severity,
                destroyedPartName: target.destroyed?.partName || null
            };
        },

        tendLogLine(who, poss, quality, targets, body) {
            const qPct = Math.round((Number(quality) || 0) * 100);
            const list = (targets || []).filter(Boolean);
            if (list.length === 1 && list[0]?.hediff) {
                const part = list[0].hediff.partName;
                return part
                    ? `${who} treated ${poss} ${part} infection (${qPct}%)`
                    : `${who} treated ${poss} infection (${qPct}%)`;
            }
            if (list.length > 1) return `${who} bandaged ${list.length} wounds (${qPct}%)`;
            const target = list[0];
            if (target?.part) return `${who} bandaged ${poss} ${target.part.name} (${qPct}%)`;
            if (target?.destroyed) {
                const name = target.destroyed.partName;
                const part = name ? body?.part?.(name) : null;
                if (this.isStumpPart(part)) return `${who} bandaged a stump (${qPct}%)`;
                if (name) return `${who} packed the wound (${qPct}%)`;
            }
            return `${who} finished bandaging (${qPct}%)`;
        },

        /**
         * Untreated wounds in tend order: bleeders / stumps first, then the rest.
         */
        listTendCandidates(body, opts = {}) {
            const skip = typeof opts.skip === "function" ? opts.skip : null;
            const bleeding = [];
            const other = [];
            for (const part of Object.values(body.parts() || {})) {
                if (part.isDead()) continue;
                for (const inj of part.injuries) {
                    if (inj.permanent) continue;
                    if (skip?.({ part, inj })) continue;
                    if (inj.bleeding && !inj.tended) {
                        bleeding.push({
                            part,
                            inj,
                            score:
                                (Number(inj.severity) || 0) *
                                (Number(inj.bleedRate) || 0) *
                                (part.def?.bleedMult || 1)
                        });
                    } else if (!inj.tended) {
                        other.push({ part, inj, score: Number(inj.severity) || 0 });
                    }
                }
            }
            for (const d of body.destroyedBleed || []) {
                if (d.tended) continue;
                if (skip?.({ destroyed: d })) continue;
                bleeding.push({
                    destroyed: d,
                    score: d.mhp * 2 * 0.06 * (d.bleedMult || 1)
                });
            }
            bleeding.sort((a, b) => b.score - a.score);
            other.sort((a, b) => b.score - a.score);
            const infections = [];
            if (Hediffs && typeof Hediffs.infectionsOf === "function") {
                for (const h of Hediffs.infectionsOf(body)) {
                    if (!Hediffs.infectionNeedsTend(h)) continue;
                    if (skip?.({ hediff: h, partName: h.partName })) continue;
                    const stage = Hediffs.stageFor(h, body.ctx);
                    const threat = stage?.lifeThreatening ? 1000 : 0;
                    infections.push({
                        hediff: h,
                        score: threat + (Number(h.severity) || 0)
                    });
                }
                infections.sort((a, b) => b.score - a.score);
            }
            return bleeding.concat(infections, other);
        },

        pickTendTarget(body, opts = {}) {
            return this.pickTendTargets(body, { ...opts, batchSeverity: 0 })[0] || null;
        },

        /**
         * One bandage: first wound always, then more until severity reaches batchSeverity
         * (default 20). At most one stump / missing part.
         */
        pickTendTargets(body, opts = {}) {
            if (!body) return [];
            const raw = Number(opts.batchSeverity);
            const budget = Number.isFinite(raw) ? raw : this.BATCH_TEND_SEVERITY;
            const candidates = this.listTendCandidates(body, opts);
            if (candidates[0]?.hediff) return [candidates[0]];
            const out = [];
            let used = 0;
            let tookStump = false;
            for (const t of candidates) {
                if (t.hediff) continue;
                if (t.destroyed && tookStump) continue;
                if (!out.length) {
                    out.push(t);
                    if (t.destroyed) tookStump = true;
                    used += this.tendTargetSeverity(t);
                    if (budget <= 0 || used >= budget) break;
                    continue;
                }
                if (used >= budget) break;
                out.push(t);
                if (t.destroyed) tookStump = true;
                used += this.tendTargetSeverity(t);
            }
            return out;
        },

        rollTendQuality(base = 0.4, max = 0.7, math = GameMath, opts = null) {
            const m = math || GameMath;
            const b = Math.max(0, Number(base) || 0);
            const cap = Math.max(0, Number(max) || 0.7);
            let rolled = b * m.floatBetween(0, 1.25);
            if (opts && opts.selfTend) rolled *= Hediffs?.SELF_TEND_FACTOR || 0.7;
            return m.clamp(rolled, 0, cap);
        },

        applyTend(body, target, quality = 0.4) {
            if (!target) return false;
            if (target.hediff) {
                const h = target.hediff;
                h.tended = true;
                h.tendQuality = quality;
                const def = Hediffs && typeof Hediffs.def === "function"
                    ? Hediffs.def(body?.ctx, h.id)
                    : null;
                const hours = Number(def?.baseTendDurationHours) || 12;
                h.tendMinutesLeft = hours * 60;
                body?.markDirty?.();
                return true;
            }
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
            inj.infectBedFactor = body?.owner?._resting ? 0.5 : 1;
            body?.markDirty?.();
            return true;
        }
    };

    return BodyHealing;
});
