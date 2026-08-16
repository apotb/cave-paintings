/**
 * RimWorld-style body part tree — Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const GameMath = require("../gameMath");
        const DataStore = require("../DataStore");
        const Hediffs = require("./Hediff");
        module.exports = factory(GameMath, DataStore, Hediffs);
    } else {
        const api = factory(root.GameMath, root.DataStore, root.Hediffs);
        root.BodyPart = api.BodyPart;
        root.Body = api.Body;
        root.isBrainDestroyed = api.isBrainDestroyed;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (GameMath, DataStore, Hediffs) {
    function resolveMath(ctx) {
        return ctx?.math || GameMath;
    }

    function resolveData(ctx) {
        if (ctx?.data) return ctx.data;
        return DataStore;
    }

    /**
     * Accept either a Phaser scene (cache.json) or an explicit ctx
     * `{ data, math, combatLog?, worldMinuteIndex?, tickSpeed? }`.
     * IMPORTANT: Phaser.Scene also has a `.data` DataManager — do not treat that
     * as our DataStore (that was flooring everyone's Moving at 60%).
     */
    function normalizeCtx(ctxOrScene) {
        if (!ctxOrScene) {
            return {
                data: DataStore,
                math: GameMath,
                combatLog: null,
                scene: null
            };
        }

        const looksLikePhaserScene = !!(
            ctxOrScene.cache?.json ||
            ctxOrScene.sys?.settings ||
            (typeof ctxOrScene.add === "object" && typeof ctxOrScene.make === "object")
        );

        // Explicit shared ctx (must have our DataStore API, not Phaser's DataManager)
        const explicitData = ctxOrScene.data;
        const isOurDataStore =
            explicitData &&
            (typeof explicitData.getBodyPlan === "function" ||
                typeof explicitData.initFromPhaserScene === "function");

        if (!looksLikePhaserScene && (isOurDataStore || ctxOrScene.math)) {
            const data = isOurDataStore ? explicitData : DataStore;
            if (
                typeof data.initFromPhaserScene === "function" &&
                ctxOrScene.scene?.cache?.json &&
                !data.isReady?.()
            ) {
                data.initFromPhaserScene(ctxOrScene.scene);
            }
            return {
                data,
                math: ctxOrScene.math || GameMath,
                combatLog: ctxOrScene.combatLog || ctxOrScene.scene?.combatLog || null,
                worldMinuteIndex:
                    ctxOrScene.worldMinuteIndex ||
                    (ctxOrScene.scene?.worldMinuteIndex
                        ? () => ctxOrScene.scene.worldMinuteIndex()
                        : null),
                tickSpeed: ctxOrScene.tickSpeed ?? ctxOrScene.scene?.tickSpeed,
                tileSize: ctxOrScene.tileSize || ctxOrScene.scene?.tileSize || null,
                spawnBloodStain:
                    ctxOrScene.spawnBloodStain ||
                    (ctxOrScene.scene?.spawnBloodStain
                        ? ctxOrScene.scene.spawnBloodStain.bind(ctxOrScene.scene)
                        : null),
                spawnApparelDeflectSpark:
                    ctxOrScene.spawnApparelDeflectSpark ||
                    (ctxOrScene.scene?.spawnApparelDeflectSpark
                        ? ctxOrScene.scene.spawnApparelDeflectSpark.bind(ctxOrScene.scene)
                        : null),
                emitBleedFx: ctxOrScene.emitBleedFx || null,
                time: ctxOrScene.time || ctxOrScene.scene?.time || null,
                player: ctxOrScene.player || ctxOrScene.scene?.player || null,
                scene: ctxOrScene.scene || null
            };
        }

        // Phaser scene (or scene-like)
        if (looksLikePhaserScene || ctxOrScene.cache?.json) {
            if (DataStore && !DataStore.isReady?.()) {
                DataStore.initFromPhaserScene(ctxOrScene);
            }
            return {
                data: DataStore,
                math: GameMath,
                combatLog: ctxOrScene.combatLog || null,
                worldMinuteIndex: () => ctxOrScene.worldMinuteIndex?.(),
                tickSpeed: ctxOrScene.tickSpeed,
                tileSize: ctxOrScene.tileSize || null,
                spawnBloodStain: ctxOrScene.spawnBloodStain
                    ? ctxOrScene.spawnBloodStain.bind(ctxOrScene)
                    : null,
                spawnApparelDeflectSpark: ctxOrScene.spawnApparelDeflectSpark
                    ? ctxOrScene.spawnApparelDeflectSpark.bind(ctxOrScene)
                    : null,
                emitBleedFx: ctxOrScene.emitBleedFx || null,
                time: ctxOrScene.time || null,
                player: ctxOrScene.player || null,
                scene: ctxOrScene
            };
        }

        return {
            data: DataStore,
            math: GameMath,
            combatLog: null,
            scene: null
        };
    }

    class BodyPart {
        /**
         * @param {Body} body
         * @param {string} name
         * @param {Object} def
         * @param {string} side
         * @param {string} baseId
         */
        constructor(body, name, def, side, baseId) {
            this.body = body;
            this.name = name;
            this.baseId = baseId;
            this.side = side || "";
            this.def = def;
            const scale = Number(body?.plan?.healthScale);
            const baseMhp = Number(def.mhp) || 10;
            this.mhp =
                Number.isFinite(scale) && scale > 0
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

        hpFraction() {
            if (this.dead) return 0;
            return this.mhp > 0 ? this.hp() / this.mhp : 0;
        }

        efficiency() {
            if (this.isCutOff()) return 0;
            return this.hpFraction();
        }

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
            const last = this.injuries[this.injuries.length - 1];
            if (last?.sourceLabel) this.destroySource = last.sourceLabel;
            let woundPain = 0;
            for (const inj of this.injuries) {
                if (inj.permanent) continue;
                const pps = Number(inj.painPerSeverity);
                woundPain +=
                    (Number(inj.severity) || 0) * (Number.isFinite(pps) ? pps : 0.0125);
            }
            this.amputationPain = Math.max(0.18, woundPain);
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
            const math = resolveMath(this.body.ctx);
            const coverages = {};
            for (const name of Object.keys(this.limbs)) {
                const limb = this.limbs[name];
                if (!!limb.internal === !!internal && !limb.dead) {
                    coverages[name] = limb.coverage;
                }
            }
            let rnd = math.random();
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
                amputationPain: this.amputationPain || 0,
                injuries: this.injuries.map((i) => ({
                    id: i.id,
                    name: i.name,
                    severity: i.severity,
                    permanent: !!i.permanent,
                    bleeding: i.bleeding !== false && !i.permanent && i.bleedRate > 0,
                    bleedRate: i.bleedRate || 0,
                    tended: !!i.tended,
                    tendQuality: i.tendQuality || 0,
                    painCategory: i.painCategory || null,
                    scarPending: !!i.scarPending,
                    scarSeverity: i.scarSeverity || 0,
                    sourceLabel: i.sourceLabel || null,
                    infectionChance: Number(i.infectionChance) || 0,
                    infectInMinutes: i.infectInMinutes != null ? Number(i.infectInMinutes) : null,
                    infectBedFactor: Number.isFinite(Number(i.infectBedFactor))
                        ? Number(i.infectBedFactor)
                        : null
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
            this.amputationPain = Number(data.amputationPain) || 0;
            this.injuries = (data.injuries || []).map((i) => ({ ...i }));
            for (const [k, v] of Object.entries(data.limbs || {})) {
                if (this.limbs[k]) this.limbs[k].loadJSON(v);
            }
        }
    }

    class Body {
        /**
         * @param {object|Phaser.Scene} ctxOrScene
         * @param {string} planId
         * @param {Object} [owner]
         */
        constructor(ctxOrScene, planId, owner = null) {
            this.ctx = normalizeCtx(ctxOrScene);
            // Compat: existing client code reads body.scene
            this.scene = this.ctx.scene || ctxOrScene;
            this.owner = owner;
            this.planId = planId || "human";
            const data = resolveData(this.ctx);
            this.plan = data?.getBodyPlan?.(this.planId) || null;
            if (!this.plan && this.scene?.cache?.json) {
                this.plan = this.scene.cache.json.get("bodyPlans")?.[this.planId];
            }
            if (!this.plan) {
                console.error("Missing body plan", this.planId);
                this.plan = {
                    parts: { Torso: { mhp: 40, coverage: 1, children: [] } },
                    core: "Torso",
                    fatalParts: ["Torso"]
                };
            }
            this.bloodLoss = 0;
            this.destroyedBleed = [];
            /** @type {{ id: string, severity: number, partName?: string }[]} */
            this.hediffs = [];
            /** @type {Record<string, number>} */
            this.immunities = {};
            const math = resolveMath(this.ctx);
            this.malnutritionRatePerDay = math.floatBetween(0.3624, 0.5436);
            this._dirty = false;
            const coreDef = this.plan.parts[this.plan.core || "Torso"];
            this.core = new BodyPart(
                this,
                this.plan.core || "Torso",
                coreDef,
                "",
                this.plan.core || "Torso"
            );
            this._partIndex = null;
            this.rebuildIndex();
        }

        hediff(id) {
            return (this.hediffs || []).find((h) => h.id === id && !h.partName) || null;
        }

        localHediff(id, partName) {
            if (!partName) return this.hediff(id);
            return (this.hediffs || []).find((h) => h.id === id && h.partName === partName) || null;
        }

        addHediff(id, severity = undefined, opts = null) {
            const def =
                Hediffs && typeof Hediffs.def === "function"
                    ? Hediffs.def(this.ctx, id)
                    : null;
            if (!def && severity === undefined) {
                console.warn("Unknown hediff", id);
            }
            const partName = opts && typeof opts === "object" ? opts.partName || null : null;
            const isLocal = !!(def?.local || partName);
            if (isLocal && !partName) {
                console.warn("Local hediff missing partName", id);
                return null;
            }
            let h = isLocal ? this.localHediff(id, partName) : this.hediff(id);
            const sev =
                severity !== undefined ? Number(severity) : Number(def?.initialSeverity) || 0;
            if (h) {
                h.severity = Number.isFinite(sev) ? sev : 0;
            } else {
                h = {
                    id,
                    severity: Number.isFinite(sev) ? sev : 0,
                    partName: isLocal ? partName : undefined,
                    tended: false,
                    tendQuality: 0,
                    tendMinutesLeft: 0,
                    luck: null
                };
                this.hediffs.push(h);
            }
            this.markDirty();
            return h;
        }

        removeHediff(id, partName = null) {
            const i = (this.hediffs || []).findIndex((h) => {
                if (h.id !== id) return false;
                if (partName) return h.partName === partName;
                return !h.partName;
            });
            if (i < 0) return false;
            this.hediffs.splice(i, 1);
            this.markDirty();
            return true;
        }

        removeLocalHediffsOnPart(part) {
            if (!part || !this.hediffs?.length) return false;
            const names = new Set();
            const walk = (p) => {
                if (!p?.name) return;
                names.add(p.name);
                for (const c of Object.values(p.limbs || {})) walk(c);
            };
            walk(part);
            const before = this.hediffs.length;
            this.hediffs = this.hediffs.filter((h) => !h.partName || !names.has(h.partName));
            if (this.hediffs.length === before) return false;
            this.markDirty();
            return true;
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
            this.removeLocalHediffsOnPart(part);
            this.markDirty();
            const fatals = this.plan.fatalParts || ["Brain", "Heart", "Torso", "Head", "Neck"];
            const coreId = this.plan.core || "Torso";
            const isCore = part === this.core || part.baseId === coreId || part.name === coreId;
            const isFatal =
                isCore ||
                !!part.def?.fatal ||
                fatals.includes(part.baseId) ||
                fatals.includes(part.name);
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
                this._pendingFatalPart = part;
                if (!this._fatalFlushScheduled) {
                    this._fatalFlushScheduled = true;
                    const flush = () => {
                        this._fatalFlushScheduled = false;
                        const fatalPart = this._pendingFatalPart;
                        this._pendingFatalPart = null;
                        if (fatalPart) this.owner?.onBodyFatal?.(fatalPart);
                    };
                    if (typeof queueMicrotask === "function") queueMicrotask(flush);
                    else Promise.resolve().then(flush);
                }
            }
        }

        /** Run deferred fatal callback now (server tick needs sync death → corpse). */
        flushPendingFatal() {
            if (!this._pendingFatalPart && !this._fatalFlushScheduled) return;
            this._fatalFlushScheduled = false;
            const fatalPart = this._pendingFatalPart;
            this._pendingFatalPart = null;
            if (fatalPart) this.owner?.onBodyFatal?.(fatalPart);
        }

        livingLegs() {
            // Quadrupeds (deer): count hoofed limbs
            const quad = [
                "Left Front Leg",
                "Right Front Leg",
                "Left Rear Leg",
                "Right Rear Leg"
            ];
            let quadN = 0;
            let quadSeen = 0;
            for (const id of quad) {
                const p = this.part(id);
                if (!p) continue;
                quadSeen++;
                if (!p.isDead()) quadN++;
            }
            if (quadSeen > 0) return quadN;

            let n = 0;
            if (this.part("Left Leg") && !this.part("Left Leg").isDead()) n++;
            if (this.part("Right Leg") && !this.part("Right Leg").isDead()) n++;
            return n;
        }

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
            this.hediffs = [];
            this.immunities = {};
            const coreDef = this.plan.parts[this.plan.core || "Torso"];
            this.core = new BodyPart(
                this,
                this.plan.core || "Torso",
                coreDef,
                "",
                this.plan.core || "Torso"
            );
            this.rebuildIndex();
            this.markDirty();
        }

        toJSON() {
            return {
                planId: this.planId,
                bloodLoss: this.bloodLoss,
                destroyedBleed: this.destroyedBleed.slice(),
                hediffs: (this.hediffs || []).map((h) => ({
                    id: h.id,
                    severity: Number(h.severity) || 0,
                    partName: h.partName || null,
                    tended: !!h.tended,
                    tendQuality: Number(h.tendQuality) || 0,
                    tendMinutesLeft: Number(h.tendMinutesLeft) || 0,
                    luck: Number.isFinite(Number(h.luck)) ? Number(h.luck) : null
                })),
                immunities: { ...(this.immunities || {}) },
                malnutritionRatePerDay: this.malnutritionRatePerDay,
                core: this.core.toJSON()
            };
        }

        loadJSON(data) {
            if (!data) return;
            this.bloodLoss = Number(data.bloodLoss) || 0;
            this.destroyedBleed = (data.destroyedBleed || []).slice();
            this.hediffs = (data.hediffs || []).map((h) => ({
                id: h.id,
                severity: Number(h.severity) || 0,
                partName: h.partName || undefined,
                tended: !!h.tended,
                tendQuality: Number(h.tendQuality) || 0,
                tendMinutesLeft: Number(h.tendMinutesLeft) || 0,
                luck: Number.isFinite(Number(h.luck)) ? Number(h.luck) : null
            }));
            const imm = data.immunities && typeof data.immunities === "object" ? data.immunities : {};
            this.immunities = {};
            for (const [k, v] of Object.entries(imm)) {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) this.immunities[k] = n;
            }
            const rate = Number(data.malnutritionRatePerDay);
            const math = resolveMath(this.ctx);
            this.malnutritionRatePerDay =
                Number.isFinite(rate) && rate > 0
                    ? rate
                    : math.floatBetween(0.3624, 0.5436);
            if (data.core) this.core.loadJSON(data.core);
            this.rebuildIndex();
            this._dirty = false;
        }
    }

    /**
     * True if the Brain part is destroyed or cut off (head/skull gone).
     * Missing body JSON is treated as intact so old corpses still drop a brain.
     */
    function isBrainDestroyed(bodyJson) {
        const core = bodyJson?.core;
        if (!core) return false;
        let destroyed = false;
        const walk = (node, cutOff) => {
            if (!node || destroyed) return;
            const limbs = node.limbs || {};
            for (const [name, child] of Object.entries(limbs)) {
                if (!child) continue;
                if (name === "Brain" && (child.dead || cutOff)) destroyed = true;
                walk(child, cutOff || !!child.dead);
            }
        };
        walk(core, false);
        return destroyed;
    }

    Body.isBrainDestroyed = isBrainDestroyed;

    return { BodyPart, Body, normalizeCtx, isBrainDestroyed };
});
