/**
 * RimWorld-inspired capacity calculations — Phaser-free UMD.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const GameMath = require("../gameMath");
        const Hediffs = require("./Hediff");
        module.exports = factory(GameMath, Hediffs);
    } else {
        root.Capacities = factory(root.GameMath, root.Hediffs);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (GameMath, HediffsMod) {
    function mathOf(body) {
        return body?.ctx?.math || GameMath;
    }

    function hediffsApi() {
        if (HediffsMod) return HediffsMod;
        if (typeof Hediffs !== "undefined") return Hediffs;
        return null;
    }

    function healingApi() {
        if (typeof BodyHealing !== "undefined") return BodyHealing;
        try {
            if (typeof module === "object" && module.exports) {
                return require("./Healing");
            }
        } catch (_) {
            /* optional */
        }
        return null;
    }

    class Capacities {
        /** @param {Body} body */
        constructor(body) {
            this.body = body;
        }

        eff(name) {
            const p = this.body.part(name);
            if (!p) return 1;
            return p.efficiency();
        }

        hasPart(name) {
            return !!this.body.part(name);
        }

        isQuadrupedHoofed() {
            return this.hasPart("Left Front Leg") || this.hasPart("Left Rear Leg");
        }

        pairAvg(base) {
            return (this.eff(`Left ${base}`) + this.eff(`Right ${base}`)) * 0.5;
        }

        toesSum() {
            const names = [
                "Big Toe",
                "Second Toe",
                "Middle Toe",
                "Fourth Toe",
                "Little Toe"
            ];
            let s = 0;
            let n = 0;
            for (const side of ["Left ", "Right "]) {
                for (const name of names) {
                    const p = this.body.part(side + name);
                    if (!p) continue;
                    s += p.efficiency();
                    n++;
                }
            }
            return { sum: s, count: n };
        }

        fingersSum() {
            const names = [
                "Thumb",
                "Index Finger",
                "Middle Finger",
                "Ring Finger",
                "Pinky Finger"
            ];
            let s = 0;
            let n = 0;
            for (const side of ["Left ", "Right "]) {
                for (const name of names) {
                    const p = this.body.part(side + name);
                    if (!p) continue;
                    s += p.efficiency();
                    n++;
                }
            }
            return { sum: s, count: n };
        }

        pain() {
            const math = mathOf(this.body);
            let pain = 0;
            for (const part of Object.values(this.body.parts())) {
                if (part.isDead()) {
                    pain += Number(part.amputationPain) || 0.18;
                    continue;
                }
                for (const inj of part.injuries) {
                    const pps = Number(inj.painPerSeverity);
                    if (inj.permanent) {
                        const cat = inj.painCategory;
                        if (cat === "high") pain += 0.05;
                        else if (cat === "medium") pain += 0.025;
                        else if (cat === "low") pain += 0.01;
                    } else {
                        pain +=
                            (Number(inj.severity) || 0) *
                            (Number.isFinite(pps) ? pps : 0.0125);
                    }
                }
            }
            pain += this._hediffPainOffset();
            return math.clamp(pain, 0, 1);
        }

        _hediffPainOffset() {
            const H = hediffsApi();
            let sum = 0;
            const ctx = this.body.ctx || this.body.scene;
            for (const h of this.body.hediffs || []) {
                const stage = H ? H.stageFor(h, ctx) : null;
                if (stage?.painOffset) sum += Number(stage.painOffset) || 0;
            }
            return sum;
        }

        _applyHediffCap(key, value, clampMax = 1) {
            const math = mathOf(this.body);
            const H = hediffsApi();
            let v = value;
            let maxCap = null;
            const ctx = this.body.ctx || this.body.scene;
            for (const h of this.body.hediffs || []) {
                const stage = H ? H.stageFor(h, ctx) : null;
                if (!stage) continue;
                const off = stage.capacityOffsets?.[key];
                if (off != null) v += Number(off) || 0;
                const fac = stage.capacityFactors?.[key];
                if (fac != null && Number.isFinite(Number(fac))) v *= Number(fac);
                const mx = stage.capacityMax?.[key];
                if (mx != null && Number.isFinite(Number(mx))) {
                    maxCap = maxCap == null ? Number(mx) : Math.min(maxCap, Number(mx));
                }
            }
            if (maxCap != null) v = Math.min(v, maxCap);
            return math.clamp(v, 0, clampMax);
        }

        hungerRateFactor() {
            const H = hediffsApi();
            let f = 1;
            const ctx = this.body.ctx || this.body.scene;
            for (const h of this.body.hediffs || []) {
                const stage = H ? H.stageFor(h, ctx) : null;
                const hf = Number(stage?.hungerRateFactor);
                if (Number.isFinite(hf) && hf > 0) f *= hf;
            }
            return f;
        }

        bloodPumping() {
            const math = mathOf(this.body);
            return math.clamp(this.eff("Heart"), 0, 1.9);
        }

        breathing() {
            const math = mathOf(this.body);
            const lungs = (this.eff("Left Lung") + this.eff("Right Lung")) * 0.5;
            return math.clamp(
                lungs * this.eff("Neck") * this.eff("Ribcage") * this.eff("Sternum"),
                0,
                1.2
            );
        }

        bloodFiltration() {
            const math = mathOf(this.body);
            const base = math.clamp(
                (this.eff("Left Kidney") + this.eff("Right Kidney")) *
                    0.5 *
                    this.eff("Liver"),
                0,
                1
            );
            return this._applyHediffCap("bloodFiltration", base, 1);
        }

        digestion() {
            const math = mathOf(this.body);
            return math.clamp(this.eff("Stomach") * 0.5 + this.eff("Liver") * 0.5, 0, 1);
        }

        consciousness() {
            const math = mathOf(this.body);
            const brain = this.eff("Brain");
            const bp = this.bloodPumping();
            const br = this.breathing();
            const bfRaw = math.clamp(
                (this.eff("Left Kidney") + this.eff("Right Kidney")) *
                    0.5 *
                    this.eff("Liver"),
                0,
                1
            );
            const pain = this.pain();

            const bpF = 1 + (Math.min(bp, 1) - 1) * 0.2;
            const brF = 1 + (Math.min(br, 1) - 1) * 0.2;
            const bfF = 1 + (Math.min(bfRaw, 1) - 1) * 0.1;
            let painF = 1;
            if (pain > 0.1) {
                painF = 1 - (pain - 0.1) / 2.25;
            }
            let c = brain * bpF * brF * bfF * Math.max(0, painF);

            const bl = this.body.bloodLoss || 0;
            if (bl >= 0.9) c = Math.min(c, 0.1);
            else if (bl >= 0.7) c -= 0.4;
            else if (bl >= 0.5) c -= 0.2;
            else if (bl >= 0.3) c -= 0.1;

            return this._applyHediffCap("consciousness", c, 1);
        }

        legEfficiency() {
            if (this.isQuadrupedHoofed()) {
                const limbs = [
                    ["Left Front Leg", "Left Front Hoof"],
                    ["Right Front Leg", "Right Front Hoof"],
                    ["Left Rear Leg", "Left Rear Hoof"],
                    ["Right Rear Leg", "Right Rear Hoof"]
                ];
                let sum = 0;
                for (const [leg, hoof] of limbs) {
                    sum += this.eff(leg) * this.eff(hoof);
                }
                return (sum / limbs.length) * this.eff("Spine");
            }
            const legs = this.pairAvg("Leg");
            const tibias = this.pairAvg("Tibia");
            const femurs = this.pairAvg("Femur");
            const feet = this.pairAvg("Foot");
            // RW-ish: 0.6 + 0.04×toeEff when toes exist. Missing toes (bad plan load)
            // must not floor everyone at 60% moving.
            const toe = this.toesSum();
            const toes = toe.count > 0 ? toe.sum * 0.04 + 0.6 : 1;
            return (
                legs *
                tibias *
                femurs *
                feet *
                toes *
                this.eff("Pelvis") *
                this.eff("Spine")
            );
        }

        armEfficiency() {
            if (!this.hasPart("Left Arm") && !this.hasPart("Right Arm")) {
                return this.eff("Jaw");
            }
            const arms = this.pairAvg("Arm");
            const shoulders = this.pairAvg("Shoulder");
            const clav = this.pairAvg("Clavicle");
            const hum = this.pairAvg("Humerus");
            const rad = this.pairAvg("Radius");
            const hands = this.pairAvg("Hand");
            const fin = this.fingersSum();
            const fingers = fin.count > 0 ? fin.sum * 0.08 + 0.2 : 1;
            return arms * shoulders * clav * hum * rad * hands * fingers;
        }

        moving() {
            const math = mathOf(this.body);
            const cons = this.consciousness();
            const consF = cons < 1 ? cons : 1;
            const bp = this.bloodPumping();
            const br = this.breathing();
            const bpF = 1 + (bp - 1) * 0.2;
            const brF = 1 + (br - 1) * 0.2;
            const base = math.clamp(consF * bpF * brF * this.legEfficiency(), 0, 2);
            return this._applyHediffCap("moving", base, 2);
        }

        manipulation() {
            const math = mathOf(this.body);
            const cons = this.consciousness();
            const base = math.clamp(cons * this.armEfficiency(), 0, 2);
            return this._applyHediffCap("manipulation", base, 2);
        }

        sight() {
            const math = mathOf(this.body);
            return math.clamp(
                this.consciousness() * (this.eff("Left Eye") + this.eff("Right Eye")) * 0.5,
                0,
                1
            );
        }

        hearing() {
            const math = mathOf(this.body);
            return math.clamp(
                this.consciousness() * (this.eff("Left Ear") + this.eff("Right Ear")) * 0.5,
                0,
                1
            );
        }

        talking() {
            const math = mathOf(this.body);
            const base = math.clamp(
                this.consciousness() * this.eff("Jaw") * this.eff("Tongue"),
                0,
                1
            );
            return this._applyHediffCap("talking", base, 1);
        }

        eating() {
            const math = mathOf(this.body);
            const base = math.clamp(this.consciousness() * this.eff("Jaw"), 0, 1);
            return this._applyHediffCap("eating", base, 1);
        }

        all() {
            return {
                pain: this.pain(),
                consciousness: this.consciousness(),
                moving: this.moving(),
                manipulation: this.manipulation(),
                breathing: this.breathing(),
                bloodPumping: this.bloodPumping(),
                bloodFiltration: this.bloodFiltration(),
                digestion: this.digestion(),
                sight: this.sight(),
                hearing: this.hearing(),
                talking: this.talking(),
                eating: this.eating(),
                bloodLoss: this.body.bloodLoss || 0
            };
        }

        _destroyedAncestor(part) {
            const coreId = this.body?.plan?.core;
            for (let q = part?.parent; q; q = q.parent) {
                if (!q.dead) continue;
                if (coreId && (q.baseId === coreId || q.name === coreId)) continue;
                return q;
            }
            return null;
        }

        _collectPartFactors(names) {
            const nameSet = new Set(names);
            const out = [];
            const emitted = new Set();

            for (const n of names) {
                const p = this.body.part(n);
                if (!p) continue;

                if (p.isDead()) {
                    if (!emitted.has(n)) {
                        emitted.add(n);
                        out.push(`${n} destroyed`);
                    }
                    continue;
                }

                const anc = this._destroyedAncestor(p);
                if (anc) {
                    let report = null;
                    for (let q = p.parent; q; q = q.parent) {
                        if (q.dead && nameSet.has(q.name)) {
                            report = q;
                            break;
                        }
                    }
                    if (report) {
                        if (!emitted.has(report.name)) {
                            emitted.add(report.name);
                            out.push(`${report.name} destroyed`);
                        }
                        continue;
                    }
                    const line = `${n} missing (${anc.name} destroyed)`;
                    if (!emitted.has(line)) {
                        emitted.add(line);
                        out.push(line);
                    }
                    continue;
                }

                const frac = p.mhp > 0 ? p.hp() / p.mhp : 0;
                if (frac >= 0.999) continue;
                out.push(`${n} ${Math.round(frac * 100)}%`);
            }
            return out;
        }

        _upstreamFactor(label, value) {
            if (!(value < 0.999)) return null;
            return `${label} ${Math.round(value * 100)}%`;
        }

        _toeNames() {
            const names = [
                "Big Toe",
                "Second Toe",
                "Middle Toe",
                "Fourth Toe",
                "Little Toe"
            ];
            const out = [];
            for (const side of ["Left ", "Right "]) {
                for (const n of names) out.push(side + n);
            }
            return out;
        }

        _fingerNames() {
            const names = [
                "Thumb",
                "Index Finger",
                "Middle Finger",
                "Ring Finger",
                "Pinky Finger"
            ];
            const out = [];
            for (const side of ["Left ", "Right "]) {
                for (const n of names) out.push(side + n);
            }
            return out;
        }

        explain(key) {
            const parts = [];
            const upstream = [];

            const pushUp = (label, value) => {
                const line = this._upstreamFactor(label, value);
                if (line) upstream.push(line);
            };

            switch (key) {
                case "bloodPumping":
                    parts.push(...this._collectPartFactors(["Heart"]));
                    break;
                case "breathing":
                    parts.push(
                        ...this._collectPartFactors(
                            ["Left Lung", "Right Lung", "Neck", "Ribcage", "Sternum"].filter(
                                (n) => this.hasPart(n)
                            )
                        )
                    );
                    break;
                case "bloodFiltration":
                    parts.push(
                        ...this._collectPartFactors(["Left Kidney", "Right Kidney", "Liver"])
                    );
                    break;
                case "digestion":
                    parts.push(...this._collectPartFactors(["Stomach", "Liver"]));
                    break;
                case "consciousness":
                    parts.push(...this._collectPartFactors(["Brain"]));
                    pushUp("Blood Pumping", this.bloodPumping());
                    pushUp("Breathing", this.breathing());
                    pushUp("Blood Filtration", this.bloodFiltration());
                    {
                        const bl = this.body.bloodLoss || 0;
                        if (bl > 0) upstream.push(`Blood Loss ${Math.round(bl * 100)}%`);
                    }
                    break;
                case "moving":
                    if (this.isQuadrupedHoofed()) {
                        parts.push(
                            ...this._collectPartFactors([
                                "Left Front Leg",
                                "Right Front Leg",
                                "Left Rear Leg",
                                "Right Rear Leg",
                                "Left Front Hoof",
                                "Right Front Hoof",
                                "Left Rear Hoof",
                                "Right Rear Hoof",
                                "Spine"
                            ])
                        );
                    } else {
                        parts.push(
                            ...this._collectPartFactors([
                                "Left Leg",
                                "Right Leg",
                                "Left Tibia",
                                "Right Tibia",
                                "Left Femur",
                                "Right Femur",
                                "Left Foot",
                                "Right Foot",
                                ...this._toeNames(),
                                "Pelvis",
                                "Spine"
                            ])
                        );
                    }
                    pushUp("Consciousness", this.consciousness());
                    pushUp("Blood Pumping", this.bloodPumping());
                    pushUp("Breathing", this.breathing());
                    break;
                case "manipulation":
                    if (!this.hasPart("Left Arm") && !this.hasPart("Right Arm")) {
                        parts.push(...this._collectPartFactors(["Jaw"]));
                    } else {
                        parts.push(
                            ...this._collectPartFactors([
                                "Left Arm",
                                "Right Arm",
                                "Left Shoulder",
                                "Right Shoulder",
                                "Left Clavicle",
                                "Right Clavicle",
                                "Left Humerus",
                                "Right Humerus",
                                "Left Radius",
                                "Right Radius",
                                "Left Hand",
                                "Right Hand",
                                ...this._fingerNames()
                            ])
                        );
                    }
                    pushUp("Consciousness", this.consciousness());
                    break;
                case "sight":
                    parts.push(...this._collectPartFactors(["Left Eye", "Right Eye"]));
                    pushUp("Consciousness", this.consciousness());
                    break;
                case "hearing":
                    parts.push(...this._collectPartFactors(["Left Ear", "Right Ear"]));
                    pushUp("Consciousness", this.consciousness());
                    break;
                case "talking":
                    parts.push(
                        ...this._collectPartFactors(
                            ["Jaw", "Tongue"].filter((n) => this.hasPart(n))
                        )
                    );
                    pushUp("Consciousness", this.consciousness());
                    break;
                case "eating":
                    parts.push(...this._collectPartFactors(["Jaw"]));
                    pushUp("Consciousness", this.consciousness());
                    break;
                case "pain":
                    return this._explainPain();
                case "bloodLoss":
                    return this._explainBloodLoss();
                default:
                    return [];
            }

            const lines = [...parts, ...upstream, ...this._hediffExplainLines(key)];
            if (!lines.length) {
                // Avoid "minor factors" when the capacity is actually fine
                const cur = this.all()?.[key];
                if (cur == null || cur >= 0.999) return [];
                return ["Reduced by multiple minor factors"];
            }
            return lines;
        }

        _hediffExplainLines(key) {
            const lines = [];
            const H = hediffsApi();
            if (!H) return lines;
            const ctx = this.body.ctx || this.body.scene;
            for (const h of this.body.hediffs || []) {
                const stage = H.stageFor(h, ctx);
                if (!stage) continue;
                const label = H.displayLabel(h, ctx);
                const off = stage.capacityOffsets?.[key];
                if (off != null && Number(off) !== 0) {
                    const n = Number(off) || 0;
                    const sign = n >= 0 ? "+" : "";
                    lines.push(`${label}: ${sign}${Math.round(n * 100)}%`);
                }
                const fac = stage.capacityFactors?.[key];
                if (fac != null && Number.isFinite(Number(fac)) && Number(fac) !== 1) {
                    lines.push(`${label}: ×${fac}`);
                }
                const mx = stage.capacityMax?.[key];
                if (mx != null && Number.isFinite(Number(mx))) {
                    lines.push(`${label}: max ${Math.round(Number(mx) * 100)}%`);
                }
            }
            return lines;
        }

        _explainPain() {
            const lines = [];
            const H = hediffsApi();
            const ctx = this.body.ctx || this.body.scene;
            if (H) {
                for (const h of this.body.hediffs || []) {
                    const stage = H.stageFor(h, ctx);
                    const off = Number(stage?.painOffset) || 0;
                    if (!(off > 0)) continue;
                    lines.push(`${H.displayLabel(h, ctx)}: +${Math.round(off * 100)}%`);
                }
            }
            const hediffPain = this._hediffPainOffset();
            const total = this.pain();
            if (total > hediffPain + 0.001) {
                lines.push("Injuries / missing parts");
            }
            return lines.length ? lines : ["No pain sources"];
        }

        _explainBloodLoss() {
            const body = this.body;
            const bl = body.bloodLoss || 0;
            if (bl >= 1 || body.dead || body.isDead?.()) {
                return ["Dead"];
            }

            const Healing = healingApi();
            const perDay = Healing ? Healing.bleedPerDay(body) : 0;
            const minutes = Healing ? Healing.minutesToBleedOut(body) : null;

            if (perDay > 0 && minutes != null) {
                const pctDay = Math.round(perDay * 100);
                return [
                    `Bleeding: ${pctDay}%/day`,
                    `~${this._formatBleedEta(minutes)} until death`
                ];
            }

            const lines = ["Not bleeding"];
            if (bl > 0) {
                const recPerMin = Healing ? Healing.BLOOD_RECOVERY_PER_MINUTE : 0.00035;
                const day = Healing ? Healing.MINUTES_PER_DAY : 1440;
                const recPct = Math.round(recPerMin * day * 100);
                lines.push(`Recovering: ~${recPct}%/day`);
            }
            return lines;
        }

        _formatBleedEta(minutes) {
            if (!(minutes > 0) || !Number.isFinite(minutes)) return "moments";
            if (minutes < 60) {
                return `${Math.max(1, Math.round(minutes))} minutes`;
            }
            const hours = minutes / 60;
            if (hours < 10) return `${hours.toFixed(1)} hours`;
            return `${Math.round(hours)} hours`;
        }

        isPainShock() {
            const t = Number(this.body.plan?.painShockThreshold) || 0.8;
            return this.pain() >= t;
        }

        isUnconscious() {
            return this.consciousness() < 0.3;
        }

        isImmobile() {
            return this.moving() <= 0.15;
        }

        canManipulate() {
            return this.manipulation() >= 0.15;
        }

        isDeadFromCapacities() {
            return (
                this.consciousness() <= 0 ||
                this.breathing() <= 0 ||
                this.bloodPumping() <= 0 ||
                this.bloodFiltration() <= 0 ||
                this.digestion() <= 0 ||
                (this.body.bloodLoss || 0) >= 1
            );
        }

        /** Channel / melee length vs Manipulation (higher manip → faster). */
        actionDurationScale() {
            return this.manipulationDurationScale();
        }

        /** Same as actionDurationScale — named to match eatingDurationScale. */
        manipulationDurationScale() {
            return 1 / Math.max(0.05, this.manipulation());
        }

        /** Eat channel length vs Eating capacity (higher eating → faster). */
        eatingDurationScale() {
            return 1 / Math.max(0.05, this.eating());
        }
    }

    return Capacities;
});
