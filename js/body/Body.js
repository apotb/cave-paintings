/**
 * RimWorld-style body part tree built from BodyPlans.json.
 */
class BodyPart {
    /**
     * @param {Body} body
     * @param {string} name  display name e.g. "Left Arm"
     * @param {Object} def   part def from plan
     * @param {string} side  "" | "Left " | "Right "
     * @param {string} baseId plan key e.g. "Arm"
     */
    constructor(body, name, def, side, baseId) {
        this.body = body;
        this.name = name;
        this.baseId = baseId;
        this.side = side || "";
        this.def = def;
        const scale = Number(body?.plan?.healthScale);
        const baseMhp = Number(def.mhp) || 10;
        this.mhp = Number.isFinite(scale) && scale > 0
            ? Math.round(baseMhp * scale * 10) / 10
            : baseMhp;
        this.coverage = Number(def.coverage) || 0;
        this.internal = !!def.internal;
        this.dead = false;
        this.injuries = [];
        this.limbs = {};
        /** @type {BodyPart|null} */
        this.parent = null;
        this._initChildren();
    }

    _initChildren() {
        const plan = this.body.plan;
        for (const childId of this.def.children || []) {
            const cdef = plan.parts[childId];
            if (!cdef) continue;
            const childName = this.side + childId;
            const child = new BodyPart(this.body, childName, cdef, this.side, childId);
            child.parent = this;
            this.limbs[childName] = child;
        }
        for (const childId of this.def.pairChildren || []) {
            const cdef = plan.parts[childId];
            if (!cdef) continue;
            for (const side of ["Left ", "Right "]) {
                const childName = side + childId;
                const child = new BodyPart(this.body, childName, cdef, side, childId);
                child.parent = this;
                this.limbs[childName] = child;
            }
        }
    }

    hp() {
        if (this.dead) return 0;
        let dmg = 0;
        for (const inj of this.injuries) dmg += Number(inj.severity) || 0;
        return Math.max(0, this.mhp - dmg);
    }

    /**
     * True if this part is destroyed, or cut off by a destroyed parent.
     * Core (Torso) destruction is fatal but does not amputate the rest of the
     * tree — limbs/organs keep their own HP for UI and capacity factors.
     * Neck/Head/limb destruction still zeros children (brain, toes, etc.).
     */
    isCutOff() {
        if (this.dead) return true;
        const coreId = this.body?.plan?.core;
        for (let p = this.parent; p; p = p.parent) {
            if (!p.dead) continue;
            if (coreId && (p.baseId === coreId || p.name === coreId)) continue;
            return true;
        }
        return false;
    }

    /** HP remaining on this part alone (ignores destroyed parents). For UI overlays. */
    hpFraction() {
        if (this.dead) return 0;
        return this.mhp > 0 ? this.hp() / this.mhp : 0;
    }

    /** Functional efficiency for capacities — 0 if cut off from the body. */
    efficiency() {
        if (this.isCutOff()) return 0;
        return this.hpFraction();
    }

    /** Total non-scar damage severity (for overlay colors). */
    damageSeverity() {
        let s = 0;
        for (const inj of this.injuries) {
            if (!inj.permanent) s += Number(inj.severity) || 0;
        }
        return s;
    }

    refresh() {
        if (this.hp() <= 0 && !this.dead) this.destroy();
    }

    destroy() {
        if (this.dead) return;
        this.dead = true;
        // Remember killing blow source for UI (injury list is cleared below)
        const last = this.injuries[this.injuries.length - 1];
        if (last?.sourceLabel) this.destroySource = last.sourceLabel;
        // Wounds on this part are replaced by stump bleed; keep child limbs
        // in the tree so the rest of the body picture still makes sense.
        this.injuries = [];
        this.body.markDirty?.();
        this.body._onPartDestroyed?.(this);
    }

    isDead() {
        return this.dead;
    }

    injure(injury) {
        this.injuries.push(injury);
        this.body.markDirty?.();
        this.refresh();
    }

    rollLimb(internal = false) {
        const coverages = {};
        for (const name of Object.keys(this.limbs)) {
            const limb = this.limbs[name];
            if (!!limb.internal === !!internal && !limb.dead) {
                coverages[name] = limb.coverage;
            }
        }
        let rnd = Math.random();
        for (const name of Object.keys(coverages)) {
            rnd -= coverages[name];
            if (rnd < 0) {
                const limb = this.limbs[name];
                if (limb.internal && Object.keys(limb.limbs).length === 0) return limb;
                return limb.rollLimb();
            }
        }
        if (!internal) return this.rollLimb(true);
        return this;
    }

    toJSON() {
        return {
            dead: this.dead,
            destroySource: this.destroySource || null,
            injuries: this.injuries.map(i => ({
                id: i.id,
                name: i.name,
                severity: i.severity,
                permanent: !!i.permanent,
                bleeding: i.bleeding !== false && !i.permanent && (i.bleedRate > 0),
                bleedRate: i.bleedRate || 0,
                tended: !!i.tended,
                tendQuality: i.tendQuality || 0,
                painCategory: i.painCategory || null,
                scarPending: !!i.scarPending,
                scarSeverity: i.scarSeverity || 0,
                sourceLabel: i.sourceLabel || null
            })),
            limbs: Object.fromEntries(
                Object.entries(this.limbs).map(([k, v]) => [k, v.toJSON()])
            )
        };
    }

    loadJSON(data) {
        if (!data) return;
        this.dead = !!data.dead;
        this.destroySource = data.destroySource || null;
        this.injuries = (data.injuries || []).map(i => ({ ...i }));
        for (const [k, v] of Object.entries(data.limbs || {})) {
            if (this.limbs[k]) this.limbs[k].loadJSON(v);
        }
    }
}

class Body {
    /**
     * @param {Phaser.Scene} scene
     * @param {string} planId
     * @param {Object} [owner] Player or LivingMob
     */
    constructor(scene, planId, owner = null) {
        this.scene = scene;
        this.owner = owner;
        this.planId = planId || "human";
        this.plan = scene.cache.json.get("bodyPlans")?.[this.planId];
        if (!this.plan) {
            console.error("Missing body plan", this.planId);
            this.plan = { parts: { Torso: { mhp: 40, coverage: 1, children: [] } }, core: "Torso", fatalParts: ["Torso"] };
        }
        this.bloodLoss = 0;
        this.destroyedBleed = []; // { partName, mhp, bleedMult, tended }
        /** When true, LivingMob should re-serialize body into chunk meta. */
        this._dirty = false;
        const coreDef = this.plan.parts[this.plan.core || "Torso"];
        this.core = new BodyPart(this, this.plan.core || "Torso", coreDef, "", this.plan.core || "Torso");
        this._partIndex = null;
        this.rebuildIndex();
    }

    markDirty() {
        this._dirty = true;
    }

    rebuildIndex() {
        this._partIndex = {};
        const walk = (part) => {
            this._partIndex[part.name] = part;
            for (const child of Object.values(part.limbs)) walk(child);
        };
        walk(this.core);
    }

    parts() {
        if (!this._partIndex) this.rebuildIndex();
        return this._partIndex;
    }

    part(name) {
        return this.parts()[name] || null;
    }

    rollLimb() {
        return this.core.rollLimb();
    }

    _onPartDestroyed(part) {
        this.rebuildIndex();
        this.markDirty();
        const fatals = this.plan.fatalParts || ["Brain", "Heart", "Torso", "Head", "Neck"];
        const isFatal = fatals.includes(part.baseId) || fatals.includes(part.name);
        // Destroyed parts keep bleeding until tended (RW-style), except the
        // killing blow on a fatal part — you're already dead.
        if (!isFatal) {
            const mult = Number(part.def?.bleedMult) || 1;
            this.destroyedBleed.push({
                partName: part.name,
                mhp: part.mhp,
                bleedMult: mult,
                tended: false
            });
        }
        if (isFatal) {
            // Defer: Combat.applyHit logs the blow after injure(); if we kill
            // synchronously, "You died." appears above the killing hit in chat.
            this._pendingFatalPart = part;
            if (!this._fatalFlushScheduled) {
                this._fatalFlushScheduled = true;
                queueMicrotask(() => {
                    this._fatalFlushScheduled = false;
                    const fatalPart = this._pendingFatalPart;
                    this._pendingFatalPart = null;
                    if (fatalPart) this.owner?.onBodyFatal?.(fatalPart);
                });
            }
        }
    }

    /** Living legs count (for sprint). */
    livingLegs() {
        let n = 0;
        if (this.part("Left Leg") && !this.part("Left Leg").isDead()) n++;
        if (this.part("Right Leg") && !this.part("Right Leg").isDead()) n++;
        return n;
    }

    /** Prefer Right Hand, else Left Hand for wielding. */
    primaryHand() {
        const r = this.part("Right Hand");
        if (r && !r.isDead()) return r;
        const l = this.part("Left Hand");
        if (l && !l.isDead()) return l;
        return null;
    }

    otherHand(primary) {
        if (!primary) return this.primaryHand();
        const name = primary.name.startsWith("Right") ? "Left Hand" : "Right Hand";
        const h = this.part(name);
        return h && !h.isDead() ? h : null;
    }

    fullHeal() {
        this.bloodLoss = 0;
        this.destroyedBleed = [];
        const coreDef = this.plan.parts[this.plan.core || "Torso"];
        this.core = new BodyPart(this, this.plan.core || "Torso", coreDef, "", this.plan.core || "Torso");
        this.rebuildIndex();
        this.markDirty();
    }

    toJSON() {
        return {
            planId: this.planId,
            bloodLoss: this.bloodLoss,
            destroyedBleed: this.destroyedBleed.slice(),
            core: this.core.toJSON()
        };
    }

    loadJSON(data) {
        if (!data) return;
        this.bloodLoss = Number(data.bloodLoss) || 0;
        this.destroyedBleed = (data.destroyedBleed || []).slice();
        if (data.core) this.core.loadJSON(data.core);
        this.rebuildIndex();
        this._dirty = false;
    }
}
