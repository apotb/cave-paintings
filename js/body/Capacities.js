/**
 * RimWorld-inspired capacity calculations for a Body.
 */
class Capacities {
    /**
     * @param {Body} body
     */
    constructor(body) {
        this.body = body;
    }

    /**
     * Part efficiency. Missing from this body plan → 1 (not a factor).
     * Present but destroyed → 0.
     */
    eff(name) {
        const p = this.body.part(name);
        if (!p) return 1;
        return p.efficiency();
    }

    /** True if this anatomy has a part (regardless of HP). */
    hasPart(name) {
        return !!this.body.part(name);
    }

    /** Quadruped hoofed bodies (deer, etc.). */
    isQuadrupedHoofed() {
        return this.hasPart("Left Front Leg") || this.hasPart("Left Rear Leg");
    }

    /** Sum efficiency of paired parts (Left/Right X). */
    pairAvg(base) {
        return (this.eff(`Left ${base}`) + this.eff(`Right ${base}`)) * 0.5;
    }

    /** Sum of toe efficiencies (10 toes normal → used as Toes in formula). */
    toesSum() {
        const names = ["Big Toe", "Second Toe", "Middle Toe", "Fourth Toe", "Little Toe"];
        let s = 0;
        for (const side of ["Left ", "Right "]) {
            for (const n of names) {
                const p = this.body.part(side + n);
                if (p) s += p.efficiency();
            }
        }
        return s;
    }

    fingersSum() {
        const names = ["Thumb", "Index Finger", "Middle Finger", "Ring Finger", "Pinky Finger"];
        let s = 0;
        for (const side of ["Left ", "Right "]) {
            for (const n of names) {
                const p = this.body.part(side + n);
                if (p) s += p.efficiency();
            }
        }
        return s;
    }

    pain() {
        let pain = 0;
        for (const part of Object.values(this.body.parts())) {
            if (part.isDead()) {
                // Destroyed parts still hurt (injuries were cleared on destroy)
                pain += Number(part.amputationPain) || 0.18;
                continue;
            }
            for (const inj of part.injuries) {
                const pps = Number(inj.painPerSeverity);
                if (inj.permanent) {
                    // Scar pain categories
                    const cat = inj.painCategory;
                    if (cat === "high") pain += 0.05;
                    else if (cat === "medium") pain += 0.025;
                    else if (cat === "low") pain += 0.01;
                    // painless = 0
                } else {
                    pain += (Number(inj.severity) || 0) * (Number.isFinite(pps) ? pps : 0.0125);
                }
            }
        }
        pain += this._hediffPainOffset();
        return Phaser.Math.Clamp(pain, 0, 1);
    }

    /** Sum of hediff stage painOffset values. */
    _hediffPainOffset() {
        let sum = 0;
        for (const h of this.body.hediffs || []) {
            const stage = typeof Hediffs !== "undefined"
                ? Hediffs.stageFor(h, this.body.scene)
                : null;
            if (stage?.painOffset) sum += Number(stage.painOffset) || 0;
        }
        return sum;
    }

    /**
     * Apply whole-body hediff offsets, post-factors, and max caps to a capacity.
     * @param {string} key
     * @param {number} value
     * @param {number} [clampMax=1]
     */
    _applyHediffCap(key, value, clampMax = 1) {
        let v = value;
        let maxCap = null;
        for (const h of this.body.hediffs || []) {
            const stage = typeof Hediffs !== "undefined"
                ? Hediffs.stageFor(h, this.body.scene)
                : null;
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
        return Phaser.Math.Clamp(v, 0, clampMax);
    }

    /** Combined hunger-rate multiplier from hediffs (malnutrition stages). */
    hungerRateFactor() {
        let f = 1;
        for (const h of this.body.hediffs || []) {
            const stage = typeof Hediffs !== "undefined"
                ? Hediffs.stageFor(h, this.body.scene)
                : null;
            const hf = Number(stage?.hungerRateFactor);
            if (Number.isFinite(hf) && hf > 0) f *= hf;
        }
        return f;
    }

    bloodPumping() {
        return Phaser.Math.Clamp(this.eff("Heart"), 0, 1.9);
    }

    breathing() {
        const lungs = (this.eff("Left Lung") + this.eff("Right Lung")) * 0.5;
        return Phaser.Math.Clamp(
            lungs * this.eff("Neck") * this.eff("Ribcage") * this.eff("Sternum"),
            0,
            1.2
        );
    }

    bloodFiltration() {
        const base = Phaser.Math.Clamp(
            (this.eff("Left Kidney") + this.eff("Right Kidney")) * 0.5 * this.eff("Liver"),
            0,
            1
        );
        return this._applyHediffCap("bloodFiltration", base, 1);
    }

    digestion() {
        return Phaser.Math.Clamp(
            this.eff("Stomach") * 0.5 + this.eff("Liver") * 0.5,
            0,
            1
        );
    }

    /**
     * Consciousness from brain × vital factors × pain.
     * Blood loss applies as offset (RW-ish stages).
     */
    consciousness() {
        const brain = this.eff("Brain");
        const bp = this.bloodPumping();
        const br = this.breathing();
        // Use raw filtration (pre-hediff) for vital factor to avoid feedback loops
        const bfRaw = Phaser.Math.Clamp(
            (this.eff("Left Kidney") + this.eff("Right Kidney")) * 0.5 * this.eff("Liver"),
            0,
            1
        );
        const pain = this.pain();

        const bpF = 1 + (Math.min(bp, 1) - 1) * 0.2;
        const brF = 1 + (Math.min(br, 1) - 1) * 0.2;
        const bfF = 1 + (Math.min(bfRaw, 1) - 1) * 0.1;
        let painF = 1;
        if (pain > 0.1) {
            // IF Pain > 10%: consciousness -= (pain-0.1)/2.25
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
            // Average of four (leg × hoof), times spine — RW hoofed moving
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
        const toes = this.toesSum() * 0.04 + 0.6;
        return legs * tibias * femurs * feet * toes * this.eff("Pelvis") * this.eff("Spine");
    }

    armEfficiency() {
        // No arms → jaw-based manipulation (RW AnimalJaw)
        if (!this.hasPart("Left Arm") && !this.hasPart("Right Arm")) {
            return this.eff("Jaw");
        }
        const arms = this.pairAvg("Arm");
        const shoulders = this.pairAvg("Shoulder");
        const clav = this.pairAvg("Clavicle");
        const hum = this.pairAvg("Humerus");
        const rad = this.pairAvg("Radius");
        const hands = this.pairAvg("Hand");
        const fingers = this.fingersSum() * 0.08 + 0.2;
        return arms * shoulders * clav * hum * rad * hands * fingers;
    }

    moving() {
        const cons = this.consciousness();
        const consF = cons < 1 ? cons : 1;
        const bp = this.bloodPumping();
        const br = this.breathing();
        const bpF = 1 + (bp - 1) * 0.2;
        const brF = 1 + (br - 1) * 0.2;
        const base = Phaser.Math.Clamp(consF * bpF * brF * this.legEfficiency(), 0, 2);
        return this._applyHediffCap("moving", base, 2);
    }

    manipulation() {
        const cons = this.consciousness();
        const base = Phaser.Math.Clamp(cons * this.armEfficiency(), 0, 2);
        return this._applyHediffCap("manipulation", base, 2);
    }

    sight() {
        return Phaser.Math.Clamp(
            this.consciousness() * (this.eff("Left Eye") + this.eff("Right Eye")) * 0.5,
            0,
            1
        );
    }

    hearing() {
        return Phaser.Math.Clamp(
            this.consciousness() * (this.eff("Left Ear") + this.eff("Right Ear")) * 0.5,
            0,
            1
        );
    }

    talking() {
        const base = Phaser.Math.Clamp(
            this.consciousness() * this.eff("Jaw") * this.eff("Tongue"),
            0,
            1
        );
        return this._applyHediffCap("talking", base, 1);
    }

    eating() {
        const base = Phaser.Math.Clamp(this.consciousness() * this.eff("Jaw"), 0, 1);
        return this._applyHediffCap("eating", base, 1);
    }

    /** Snapshot for UI / gameplay. */
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

    /**
     * Nearest destroyed ancestor that actually cuts this part off (skips core).
     * @returns {BodyPart|null}
     */
    _destroyedAncestor(part) {
        const coreId = this.body?.plan?.core;
        for (let q = part?.parent; q; q = q.parent) {
            if (!q.dead) continue;
            if (coreId && (q.baseId === coreId || q.name === coreId)) continue;
            return q;
        }
        return null;
    }

    /**
     * Part lines for capacity tooltips. Collapses whole subtrees: if Left Leg is
     * destroyed, list that once — not every tibia/foot/toe as missing.
     */
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
                // Prefer a destroyed ancestor already in this capacity's part list
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
                // e.g. Brain under destroyed Head (Head not in Consciousness list)
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
        const names = ["Big Toe", "Second Toe", "Middle Toe", "Fourth Toe", "Little Toe"];
        const out = [];
        for (const side of ["Left ", "Right "]) {
            for (const n of names) out.push(side + n);
        }
        return out;
    }

    _fingerNames() {
        const names = ["Thumb", "Index Finger", "Middle Finger", "Ring Finger", "Pinky Finger"];
        const out = [];
        for (const side of ["Left ", "Right "]) {
            for (const n of names) out.push(side + n);
        }
        return out;
    }

    /**
     * Lines explaining why a capacity is below 100%.
     * Damaged parts (HP%) then upstream capacities; no injury detail.
     * @param {string} key capacity key from all()
     * @returns {string[]}
     */
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
                parts.push(...this._collectPartFactors([
                    "Left Lung", "Right Lung", "Neck", "Ribcage", "Sternum"
                ].filter((n) => this.hasPart(n))));
                break;
            case "bloodFiltration":
                parts.push(...this._collectPartFactors([
                    "Left Kidney", "Right Kidney", "Liver"
                ]));
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
                    parts.push(...this._collectPartFactors([
                        "Left Front Leg", "Right Front Leg",
                        "Left Rear Leg", "Right Rear Leg",
                        "Left Front Hoof", "Right Front Hoof",
                        "Left Rear Hoof", "Right Rear Hoof",
                        "Spine"
                    ]));
                } else {
                    parts.push(...this._collectPartFactors([
                        "Left Leg", "Right Leg",
                        "Left Tibia", "Right Tibia",
                        "Left Femur", "Right Femur",
                        "Left Foot", "Right Foot",
                        ...this._toeNames(),
                        "Pelvis", "Spine"
                    ]));
                }
                pushUp("Consciousness", this.consciousness());
                pushUp("Blood Pumping", this.bloodPumping());
                pushUp("Breathing", this.breathing());
                break;
            case "manipulation":
                if (!this.hasPart("Left Arm") && !this.hasPart("Right Arm")) {
                    parts.push(...this._collectPartFactors(["Jaw"]));
                } else {
                    parts.push(...this._collectPartFactors([
                        "Left Arm", "Right Arm",
                        "Left Shoulder", "Right Shoulder",
                        "Left Clavicle", "Right Clavicle",
                        "Left Humerus", "Right Humerus",
                        "Left Radius", "Right Radius",
                        "Left Hand", "Right Hand",
                        ...this._fingerNames()
                    ]));
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
                parts.push(...this._collectPartFactors(
                    ["Jaw", "Tongue"].filter((n) => this.hasPart(n))
                ));
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
        if (!lines.length) return ["Reduced by multiple minor factors"];
        return lines;
    }

    /**
     * Hediff contributions for a capacity tooltip (offsets, ×factors, max caps).
     * @param {string} key
     * @returns {string[]}
     */
    _hediffExplainLines(key) {
        const lines = [];
        if (typeof Hediffs === "undefined") return lines;
        const scene = this.body.scene;
        for (const h of this.body.hediffs || []) {
            const stage = Hediffs.stageFor(h, scene);
            if (!stage) continue;
            const label = Hediffs.displayLabel(h, scene);
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

    /** Pain sources: hediff offsets, plus a catch-all for injury / stump pain. */
    _explainPain() {
        const lines = [];
        if (typeof Hediffs !== "undefined") {
            const scene = this.body.scene;
            for (const h of this.body.hediffs || []) {
                const stage = Hediffs.stageFor(h, scene);
                const off = Number(stage?.painOffset) || 0;
                if (!(off > 0)) continue;
                lines.push(`${Hediffs.displayLabel(h, scene)}: +${Math.round(off * 100)}%`);
            }
        }
        const hediffPain = this._hediffPainOffset();
        const total = this.pain();
        if (total > hediffPain + 0.001) {
            lines.push("Injuries / missing parts");
        }
        return lines.length ? lines : ["No pain sources"];
    }

    /** RW-style bleed rate / time-to-death (or recovery when not bleeding). */
    _explainBloodLoss() {
        const body = this.body;
        const bl = body.bloodLoss || 0;
        if (bl >= 1 || body.dead || body.isDead?.()) {
            return ["Dead"];
        }

        const perDay = typeof BodyHealing !== "undefined"
            ? BodyHealing.bleedPerDay(body)
            : 0;
        const minutes = typeof BodyHealing !== "undefined"
            ? BodyHealing.minutesToBleedOut(body)
            : null;

        if (perDay > 0 && minutes != null) {
            const pctDay = Math.round(perDay * 100);
            return [
                `Bleeding: ${pctDay}%/day`,
                `~${this._formatBleedEta(minutes)} until death`
            ];
        }

        const lines = ["Not bleeding"];
        if (bl > 0) {
            const recPerMin = (typeof BodyHealing !== "undefined"
                ? BodyHealing.BLOOD_RECOVERY_PER_MINUTE
                : 0.00035);
            const day = (typeof BodyHealing !== "undefined"
                ? BodyHealing.MINUTES_PER_DAY
                : 1440);
            const recPct = Math.round(recPerMin * day * 100);
            lines.push(`Recovering: ~${recPct}%/day`);
        }
        return lines;
    }

    /** @param {number} minutes */
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

    /** Too little Moving to walk — go prone (no crawling). */
    isImmobile() {
        return this.moving() <= 0.15;
    }

    /** Too little Manipulation to swing / tend / use hands (or jaw for animals). */
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

    /** Multiplier for action duration: 0.5 manip → 2× time. */
    actionDurationScale() {
        return 1 / Math.max(0.05, this.manipulation());
    }

    /** Multiplier for eating duration: 0.5 Eating → 2× time. */
    eatingDurationScale() {
        return 1 / Math.max(0.05, this.eating());
    }
}
