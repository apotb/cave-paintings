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

    eff(name) {
        const p = this.body.part(name);
        return p ? p.efficiency() : 0;
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
            for (const n of names) s += this.eff(side + n);
        }
        return s;
    }

    fingersSum() {
        const names = ["Thumb", "Index Finger", "Middle Finger", "Ring Finger", "Pinky Finger"];
        let s = 0;
        for (const side of ["Left ", "Right "]) {
            for (const n of names) s += this.eff(side + n);
        }
        return s;
    }

    pain() {
        let pain = 0;
        for (const part of Object.values(this.body.parts())) {
            if (part.isDead()) continue;
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
        return Phaser.Math.Clamp(pain, 0, 1);
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
        return Phaser.Math.Clamp(
            (this.eff("Left Kidney") + this.eff("Right Kidney")) * 0.5 * this.eff("Liver"),
            0,
            1
        );
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
        const bf = this.bloodFiltration();
        const pain = this.pain();

        const bpF = 1 + (Math.min(bp, 1) - 1) * 0.2;
        const brF = 1 + (Math.min(br, 1) - 1) * 0.2;
        const bfF = 1 + (Math.min(bf, 1) - 1) * 0.1;
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

        return Phaser.Math.Clamp(c, 0, 1);
    }

    legEfficiency() {
        const legs = this.pairAvg("Leg");
        const tibias = this.pairAvg("Tibia");
        const femurs = this.pairAvg("Femur");
        const feet = this.pairAvg("Foot");
        const toes = this.toesSum() * 0.04 + 0.6;
        return legs * tibias * femurs * feet * toes * this.eff("Pelvis") * this.eff("Spine");
    }

    armEfficiency() {
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
        return Phaser.Math.Clamp(consF * bpF * brF * this.legEfficiency(), 0, 2);
    }

    manipulation() {
        const cons = this.consciousness();
        return Phaser.Math.Clamp(cons * this.armEfficiency(), 0, 2);
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
        return Phaser.Math.Clamp(
            this.consciousness() * this.eff("Jaw") * this.eff("Tongue"),
            0,
            1
        );
    }

    eating() {
        return Phaser.Math.Clamp(this.consciousness() * this.eff("Jaw"), 0, 1);
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

    /** Part line for tooltips if damaged; null if full HP / missing. */
    _partFactor(name) {
        const p = this.body.part(name);
        if (!p) return null;
        if (p.isDead()) return `${name} destroyed`;
        const frac = p.mhp > 0 ? p.hp() / p.mhp : 0;
        if (frac >= 0.999) return null;
        return `${name} ${Math.round(frac * 100)}%`;
    }

    _collectPartFactors(names) {
        const out = [];
        for (const n of names) {
            const line = this._partFactor(n);
            if (line) out.push(line);
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
                ]));
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
                parts.push(...this._collectPartFactors([
                    "Left Leg", "Right Leg",
                    "Left Tibia", "Right Tibia",
                    "Left Femur", "Right Femur",
                    "Left Foot", "Right Foot",
                    ...this._toeNames(),
                    "Pelvis", "Spine"
                ]));
                pushUp("Consciousness", this.consciousness());
                pushUp("Blood Pumping", this.bloodPumping());
                pushUp("Breathing", this.breathing());
                break;
            case "manipulation":
                parts.push(...this._collectPartFactors([
                    "Left Arm", "Right Arm",
                    "Left Shoulder", "Right Shoulder",
                    "Left Clavicle", "Right Clavicle",
                    "Left Humerus", "Right Humerus",
                    "Left Radius", "Right Radius",
                    "Left Hand", "Right Hand",
                    ...this._fingerNames()
                ]));
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
                parts.push(...this._collectPartFactors(["Jaw", "Tongue"]));
                pushUp("Consciousness", this.consciousness());
                break;
            case "eating":
                parts.push(...this._collectPartFactors(["Jaw"]));
                pushUp("Consciousness", this.consciousness());
                break;
            default:
                return [];
        }

        const lines = [...parts, ...upstream];
        if (!lines.length) return ["Reduced by multiple minor factors"];
        return lines;
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
}
