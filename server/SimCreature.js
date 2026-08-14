/**
 * Headless server creature with shared Body anatomy + melee.
 * Used for both players and mobs in dedicated MP.
 */
const path = require("path");
const GameMath = require("../shared/gameMath");
const DataStore = require("../shared/DataStore");
const Spoil = require("../shared/spoil");
const { Body } = require("../shared/body/Body");
const Capacities = require("../shared/body/Capacities");
const BodyCombat = require("../shared/body/Combat");
const MeleeMath = require("../shared/melee");
const Party = require("../shared/party");

const TILE = 16;

/** Quality multipliers for tipped spears (matches js/Utils.knapQualityMult). */
function knapQualityMult(quality) {
    return { crude: 0.65, rough: 0.95, fine: 1.35 }[quality] || 1;
}

/** Scale tip stab damage by knapQuality (matches js/Utils.weaponMetaWithKnapQuality). */
function weaponMetaWithKnapQuality(meta, stack) {
    if (!meta?.weapon || !stack?.knapQuality) return meta;
    const mult = knapQualityMult(stack.knapQuality);
    if (mult === 1) return meta;
    const attacks = (meta.weapon.attacks || []).map((a) => {
        if (a.id !== "point_stab") return { ...a };
        const dmg = Math.round((Number(a.damage) || 0) * mult * 10) / 10;
        return { ...a, damage: dmg };
    });
    return { ...meta, weapon: { ...meta.weapon, attacks } };
}

/** Synthetic melee meta for knapped tools (matches js/Knapping.weaponMetaFromStack). */
function knapWeaponMetaFromStack(baseMeta, stack) {
    if (!stack || !baseMeta) return null;
    const cls = stack.toolClass;
    const dmg = Number(stack.knapDamage) || 0;
    if (!["knife", "scraper", "chopper", "awl"].includes(cls) || !(dmg > 0)) {
        return null;
    }
    const r = (n) => Math.round(n * 10) / 10;
    let attacks;
    if (cls === "knife") {
        attacks = [
            { id: "knap_knife_slash", name: "Slash", damage: dmg, type: "sharp", verb: "cut", cooldown: 2.0, weightMultiplier: 1, source: "hand" },
            { id: "knap_knife_stab", name: "Stab", damage: r(dmg * 0.85), type: "sharp", verb: "stabbed", cooldown: 1.7, weightMultiplier: 0.65, source: "hand" }
        ];
    } else if (cls === "scraper") {
        attacks = [
            { id: "knap_scraper_edge", name: "Scrape", damage: dmg, type: "sharp", verb: "scraped", cooldown: 2.0, weightMultiplier: 1, source: "hand" },
            { id: "knap_scraper_hack", name: "Hack", damage: r(dmg * 0.75), type: "sharp", verb: "hacked", cooldown: 2.3, weightMultiplier: 0.55, source: "hand" }
        ];
    } else if (cls === "chopper") {
        attacks = [
            { id: "knap_chopper_chop", name: "Chop", damage: dmg, type: "sharp", verb: "chopped", cooldown: 2.4, weightMultiplier: 1, source: "hand" },
            { id: "knap_chopper_bash", name: "Bash", damage: r(dmg * 0.7), type: "blunt", verb: "bashed", cooldown: 2.2, weightMultiplier: 0.5, source: "hand" }
        ];
    } else {
        attacks = [
            { id: "knap_awl_pierce", name: "Pierce", damage: dmg, type: "sharp", verb: "pierced", cooldown: 1.6, weightMultiplier: 1, source: "hand" },
            { id: "knap_awl_poke", name: "Poke", damage: r(dmg * 0.7), type: "sharp", verb: "poked", cooldown: 1.4, weightMultiplier: 0.6, source: "hand" }
        ];
    }
    return {
        ...baseMeta,
        name: stack.customName || baseMeta.name,
        key: stack.knapIcon || baseMeta.key,
        weapon: {
            type: "melee",
            range: 2.8,
            hitStart: 0.3,
            hitEnd: 0.65,
            knapSilhouette: true,
            attacks
        }
    };
}

function ensureData(dataStore) {
    const ds = dataStore || DataStore;
    if (!ds.isReady?.()) {
        ds.loadFromDisk(path.resolve(__dirname, ".."));
    }
    return ds;
}

function makeCtx(dataStore, extras = {}) {
    const data = ensureData(dataStore);
    return {
        data,
        math: GameMath,
        combatLog: extras.combatLog || null,
        worldMinuteIndex: extras.worldMinuteIndex || null,
        tickSpeed: extras.tickSpeed ?? 1,
        player: extras.player || null,
        tileSize: TILE,
        ...extras
    };
}

class SimCreature {
    /**
     * @param {object} opts
     */
    constructor(opts) {
        const data = ensureData(opts.dataStore);
        this.id = opts.id;
        this.kind = opts.kind; // "player" | "mob"
        this.name = opts.name || opts.kind || "Creature";
        this.x = Number(opts.x) || 0;
        this.y = Number(opts.y) || 0;
        this.facing = opts.facing || "down";
        this.width = Number(opts.width) || 16;
        this.height = Number(opts.height) || 16;
        this.hitboxSize = Number(opts.hitboxSize) || Number(opts.def?.hitboxSize) || 8;
        this.vx = 0;
        this.vy = 0;
        this._desiredVx = 0;
        this._desiredVy = 0;
        this._prone = !!opts.prone;
        this._dead = false;
        this.active = true;

        this.def = opts.def || null;
        this.aiType = opts.aiType || opts.def?.ai || null;
        this.homeX = opts.homeX ?? opts.entry?.homeX ?? null;
        this.homeY = opts.homeY ?? opts.entry?.homeY ?? null;
        this.hostile = !!opts.hostile;
        this.targetId = opts.targetId || null;
        this.panicMs = 0;
        this.entry = opts.entry || null;

        // Player gear
        this.inventory = opts.inventory || null;
        this.equipment = opts.equipment || null;
        this.hotbarIndex = opts.hotbarIndex ?? 0;

        this.ctx = makeCtx(data, opts.ctx || {});
        // Compat for BodyCombat hostOf / combat log player ref
        this.scene = this.ctx;
        this.ctx.scene = this.ctx;

        const planId =
            opts.planId ||
            opts.def?.bodyPlan ||
            (this.kind === "player" ? "human" : "human");
        this.anatomy = new Body(this.ctx, planId, this);
        if (opts.bodyJson) this.anatomy.loadJSON(opts.bodyJson);
        this.capacities = new Capacities(this.anatomy);

        this.attackTimer = 0;
        this.attackMax = 0;
        this.attackAngle = 0;
        this.currentAttack = null;
        this.attackWeapon = null;
        this.attackHitSet = null;
        this.isSprinting = false;
        this._lastHitBy = null;
        this._vomitRemainingMs = 0;
        this._vomitDripAccMs = 0;

        this.ai = null;
    }

    bodyCenter() {
        // Net/sim pose is always feet / bottom-left, even while downed.
        return {
            x: this.x + this.width * 0.5,
            y: this.y - this.height * 0.5
        };
    }

    hurtbox(pad = 0) {
        if (this._prone) {
            const c = this.bodyCenter();
            const hw = this.width * 0.35;
            const hh = this.height * 0.35;
            return {
                left: c.x - hw - pad,
                top: c.y - hh - pad,
                right: c.x + hw + pad,
                bottom: c.y + hh + pad
            };
        }
        if (this.kind === "player") {
            const insetX = Math.max(2, Math.floor(this.width * 0.2));
            const insetTop = Math.max(1, Math.floor(this.height * 0.12));
            const insetBottom = Math.max(1, Math.floor(this.height * 0.06));
            return {
                left: this.x + insetX - pad,
                top: this.y - this.height + insetTop - pad,
                right: this.x + this.width - insetX + pad,
                bottom: this.y - insetBottom + pad
            };
        }
        const inset = 1;
        return {
            left: this.x + inset - pad,
            top: this.y - this.height + inset - pad,
            right: this.x + this.width - inset + pad,
            bottom: this.y - inset + pad
        };
    }

    displayName() {
        if (this.kind === "player") return this.name || "Player";
        return this.def?.name || this.def?.id || this.name || "Someone";
    }

    getHeldItem() {
        if (!this.inventory) return null;
        const idx = this.hotbarIndex | 0;
        return this.inventory[idx] || null;
    }

    getHeldWeaponMeta() {
        const stack = this.getHeldItem();
        if (!stack) return null;
        const meta = this.ctx.data.getItem(stack.id);
        if (stack.toolClass && Number(stack.knapDamage) > 0) {
            const knap = knapWeaponMetaFromStack(meta || { id: stack.id, name: stack.customName || stack.id }, stack);
            if (knap?.weapon?.type === "melee") return knap;
        }
        if (meta?.weapon?.type === "melee") {
            if (stack.knapQuality) return weaponMetaWithKnapQuality(meta, stack);
            return meta;
        }
        return null;
    }

    /**
     * Client-facing swing art for remotes (fist vs spear/knap tool).
     * Mirrors Player.startMeleeAttack useWeaponArt rules.
     */
    getAttackArt() {
        const attack = this.currentAttack;
        const meta = this.getHeldWeaponMeta();
        const stack = this.getHeldItem();
        const useWeaponArt = !!(
            meta?.weapon?.type === "melee" &&
            attack &&
            !attack.unarmed &&
            (meta.key || meta.id || stack?.knapIcon)
        );
        if (!useWeaponArt) {
            return {
                unarmed: true,
                range: Number(attack?.range) || 4,
                max: this.attackMax || 0
            };
        }
        return {
            unarmed: false,
            key: stack?.knapIcon || meta.key || meta.id || null,
            itemId: stack?.id || meta.id || null,
            range: Number(meta.weapon.range) || Number(attack.range) || 12,
            knapSilhouette: !!meta.weapon.knapSilhouette,
            knapIconData: stack?.knapIconData || null,
            max: this.attackMax || 0
        };
    }

    isBodyDead() {
        return this._dead;
    }

    isIncapacitated() {
        this.capacities = this.capacities || new Capacities(this.anatomy);
        return this.capacities.isPainShock() || this.capacities.isUnconscious();
    }

    isImmobile() {
        this.capacities = this.capacities || new Capacities(this.anatomy);
        return !!this.capacities.isImmobile?.();
    }

    isAttacking() {
        return this.attackTimer > 0;
    }

    setDesiredVel(vx, vy) {
        this._desiredVx = Number(vx) || 0;
        this._desiredVy = Number(vy) || 0;
    }

    applyDesiredVel(dtMs = 16) {
        void dtMs;
        if (this._dead || this.isImmobile() || this.isIncapacitated()) {
            this.vx = 0;
            this.vy = 0;
            return;
        }
        let vx = this._desiredVx;
        let vy = this._desiredVy;
        if (this.isAttacking()) {
            vx *= 0.5;
            vy *= 0.5;
        }
        this.vx = vx;
        this.vy = vy;
    }

    displayName() {
        return this.name || this.def?.name || "Creature";
    }

    onBodyDamaged(source, _result) {
        if (source && source !== this) this._lastHitBy = source;
        this.ctx?.sim?._notePvpHit?.(source, this);
        this.ctx?.sim?._noteHuntHit?.(source, this);
        this.capacities = new Capacities(this.anatomy);
        this._prone = this.isImmobile() || this.isIncapacitated();
        if (this._dead) return;
        if (this.capacities.isDeadFromCapacities()) {
            this.onBodyFatal(null, "capacity");
            return;
        }
        this.ai?.onDamaged?.(source);
        if (this.kind === "mob") this.ctx?.sim?.alertNearbyMobs?.(this, source);
        if (this.role === "wanderer" && this.ctx?.sim?.wanderers) {
            const w = this.ctx.sim.wanderers.get(this.id);
            if (w) {
                w.hostile = true;
                w.recruitLocked = true;
            }
            const partyHit = source
                && source !== this
                && source.role !== "wanderer"
                && (source.kind === "player" || source.isPlayer);
            if (partyHit) this.ctx.sim.alertNearbyWanderers?.(this, source);
        }
    }

    isVomiting() {
        return Number(this._vomitRemainingMs) > 0;
    }

    /**
     * Hediffs.minuteTick calls this on food-poisoning rolls.
     */
    startVomit() {
        if (this.kind !== "player" || this._dead || this.isVomiting()) return;
        const math = this.ctx?.math;
        const ms = typeof math?.between === "function"
            ? math.between(5000, 15000)
            : 5000 + Math.floor(Math.random() * 10001);
        this._vomitRemainingMs = ms;
        this._vomitDripAccMs = 0;
        this.vx = 0;
        this.vy = 0;
        this.setDesiredVel?.(0, 0);
        this._endAttack?.();
        this.ctx?.sim?._beginPlayerVomit?.(this, ms);
    }

    onBodyFatal(_part = null, _reason = null) {
        if (this._dead) return;
        // Players: mark dead only — SimWorld._kill dumps gear into the corpse.
        if (this.kind === "player") {
            this._dead = true;
            this.active = false;
            this.vx = 0;
            this.vy = 0;
            this.setDesiredVel(0, 0);
            this._endAttack();
            return;
        }
        this.die();
    }

    takeDamage(amount, source = null, opts = null) {
        if (this._dead) return 0;
        if (opts?.attack) {
            const result = BodyCombat.applyHit(source, this, opts.attack, opts);
            return result?.damage || 0;
        }
        const fake = {
            damage: Number(amount) || 1,
            type: "blunt",
            verb: "struck",
            sourcePart: { name: "blow" },
            def: { variance: 0.05 },
            name: "Hit"
        };
        const result = BodyCombat.applyHit(source, this, fake, opts);
        return result?.damage || 0;
    }

    facingFromAngle(angle) {
        const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (a >= Math.PI * 0.25 && a < Math.PI * 0.75) return "down";
        if (a >= Math.PI * 0.75 && a < Math.PI * 1.25) return "left";
        if (a >= Math.PI * 1.25 && a < Math.PI * 1.75) return "up";
        return "right";
    }

    /**
     * Begin a melee swing toward `angle` (radians). Picks attack via BodyCombat.
     * @returns {boolean}
     */
    startMeleeAttack(angle) {
        if (this._dead || this.isAttacking() || this.isIncapacitated()) return false;
        this.capacities = new Capacities(this.anatomy);
        if (!this.capacities.canManipulate()) return false;

        let ang = Number(angle);
        if (!Number.isFinite(ang)) ang = 0;
        const attack = this.kind === "player"
            ? (this.ctx.sim?._pickPlayerAttack?.(this, ang) || BodyCombat.pickAttack(this))
            : BodyCombat.pickAttack(this);
        if (!attack) return false;

        const scale = this.capacities.actionDurationScale();
        const durationMs = MeleeMath.meleeAttackDurationMs(attack.cooldown || 2, scale);

        this.currentAttack = attack;
        const heldMeta = this.getHeldWeaponMeta();
        const useWeaponArt = !!(heldMeta?.weapon?.type === "melee" && !attack.unarmed);
        this.attackWeapon = useWeaponArt
            ? { ...heldMeta.weapon }
            : {
                type: "melee",
                range: Number(attack.range) || 4,
                hitStart: 0.25,
                hitEnd: 0.75
            };
        this.attackMax = durationMs;
        this.attackTimer = durationMs;
        this.attackAngle = ang;
        this.attackHitSet = new Set();
        this._attackWoreHeld = false;
        this._attackChoppedTree = false;
        this.facing = this.facingFromAngle(ang);
        this.attackArt = this.getAttackArt();
        return true;
    }

    /**
     * Mob AI entry: aim at target and start swing if possible.
     */
    tryMeleeAttack(target, attack = null) {
        if (!target || this._dead || this.isIncapacitated() || this.isAttacking()) {
            return false;
        }
        this.capacities = new Capacities(this.anatomy);
        if (!this.capacities.canManipulate()) return false;

        const atk = attack || BodyCombat.pickAttack(this);
        if (!atk) return false;

        const c = this.bodyCenter();
        const tc =
            typeof target.bodyCenter === "function"
                ? target.bodyCenter()
                : { x: target.x, y: target.y };
        const ang = Math.atan2(tc.y - c.y, tc.x - c.x);
        const scale = this.capacities.actionDurationScale();
        const durationMs = MeleeMath.meleeAttackDurationMs(atk.cooldown || 2, scale);

        this.currentAttack = atk;
        const heldMeta = this.getHeldWeaponMeta();
        const useWeaponArt = !!(heldMeta?.weapon?.type === "melee" && !atk.unarmed);
        this.attackWeapon = useWeaponArt
            ? { ...heldMeta.weapon }
            : {
                type: "melee",
                range: Number(atk.range) || 4,
                hitStart: 0.25,
                hitEnd: 0.75
            };
        this.attackMax = durationMs;
        this.attackTimer = durationMs;
        this.attackAngle = ang;
        this.attackHitSet = new Set();
        this.facing = this.facingFromAngle(ang);
        this.attackArt = this.getAttackArt();
        return true;
    }

    _attackProgress() {
        if (this.attackMax <= 0) return 1;
        return 1 - this.attackTimer / this.attackMax;
    }

    _meleeHitCheck(progress, targets) {
        const w = this.attackWeapon;
        const attack = this.currentAttack;
        if (!w || !attack || !this.attackHitSet) return;
        const start = Number(w.hitStart ?? 0.25);
        const end = Number(w.hitEnd ?? 0.75);
        if (progress < start || progress > end) return;

        const c = this.bodyCenter();
        const range = Number(w.range) || Number(attack.range) || 4;
        const seg = MeleeMath.unarmedHitSegmentAt(
            c.x,
            c.y,
            this.attackAngle,
            range,
            progress
        );
        const radius = attack.unarmed === false ? 3 : 4;
        const list = targets || [];

        for (const target of list) {
            if (!target || target === this || target.isBodyDead?.()) continue;
            if (this.attackHitSet.has(target)) continue;
            if (Party?.sameFaction?.(this, target)) continue;
            const rad = target.role === "wanderer" ? radius + 8 : radius;
            if (!MeleeMath.meleeSegmentHitsTarget(seg.a, seg.b, rad, target)) continue;

            this.attackHitSet.add(target);
            BodyCombat.applyHit(this, target, attack);
            if (!attack.unarmed && this.kind === "player") {
                this.ctx.sim?._wearPlayerHeld?.(this.id, 1);
                this._attackWoreHeld = true;
            }
            // Fatal part destroy is deferred via microtask — flush so SimWorld
            // sees isBodyDead() in the same tick and can spawn the corpse.
            target.anatomy?.flushPendingFatal?.();
            this.ai?.onDealtHit?.(target);
        }

        if (this.kind === "player") {
            this.ctx.sim?._tryChopFromMelee?.(this, seg, radius);
        }
    }

    _endAttack() {
        this.attackTimer = 0;
        this.attackMax = 0;
        this.attackWeapon = null;
        this.attackHitSet = null;
        this.currentAttack = null;
        this.attackArt = null;
    }

    /**
     * Advance melee timer and resolve hits against `targets`.
     * @param {number} dtMs
     * @param {SimCreature[]} targets
     */
    tickMelee(dtMs, targets = []) {
        if (!this.isAttacking()) return;
        const progress = this._attackProgress();
        this._meleeHitCheck(progress, targets);
        const dt = Number(dtMs);
        this.attackTimer -= Number.isFinite(dt) ? dt : 16;
        if (this.attackTimer <= 0) this._endAttack();
    }

    /**
     * @returns {object|null} corpse payload for SimWorld
     */
    die() {
        if (this._dead && this._corpsePayload) return this._corpsePayload;
        if (this._dead) return null;
        this._dead = true;
        this.active = false;
        this.vx = 0;
        this.vy = 0;
        this.setDesiredVel(0, 0);
        this._endAttack();

        const data = this.ctx.data;
        const now =
            typeof this.ctx.worldMinuteIndex === "function"
                ? this.ctx.worldMinuteIndex()
                : this.ctx.worldMinuteIndex;
        const loot = [];
        const drops = this.def?.drops || [];
        for (const drop of drops) {
            const item = data.getItem(drop.item);
            if (!item) continue;
            let qty;
            if (drop.min != null || drop.max != null) {
                const lo = Math.max(0, Math.floor(Number(drop.min ?? drop.max) || 0));
                const hi = Math.max(lo, Math.floor(Number(drop.max ?? drop.min) || 0));
                qty = GameMath.between(lo, hi);
            } else {
                qty = Number(drop.quantity) || 1;
            }
            if (qty > 0) {
                const stack = {
                    id: item.id,
                    quantity: qty,
                    name: item.name,
                    key: item.key
                };
                const spoilAt = Spoil.defaultSpoilAt(item, now);
                if (spoilAt != null) stack.spoilAt = spoilAt;
                loot.push(stack);
            }
        }

        const c = this.bodyCenter();
        this._corpsePayload = {
            id: `c_${Date.now().toString(36)}_${GameMath.between(1000, 9999)}`,
            x: c.x,
            y: c.y,
            key: this.def?.key || (this.kind === "player" ? "human" : "human"),
            look: this.look || null,
            frame: 7,
            name: this.def?.name || this.name || "Corpse",
            loot,
            body: this.anatomy?.toJSON?.(),
            bodyPlan: this.def?.bodyPlan || this.anatomy?.planId || "human",
            mobId: this.def?.id || (this.kind === "player" ? "human" : null),
            kind: this.kind,
            creatureId: this.id
        };
        return this._corpsePayload;
    }

    refreshCapacities() {
        this.capacities = new Capacities(this.anatomy);
        if (!this._dead && this.capacities.isDeadFromCapacities()) {
            this.onBodyFatal(null, "capacity");
        }
        this._prone = !this._dead && (this.isImmobile() || this.isIncapacitated());
        return this.capacities;
    }
}

function createPlayerCreature(p, dataStore, extras = {}) {
    const data = ensureData(dataStore);
    const creature = new SimCreature({
        id: p.id || p.playerId,
        kind: "player",
        name: p.name || p.displayName || "Player",
        x: p.x,
        y: p.y,
        facing: p.facing || "down",
        width: 16,
        height: 16,
        hitboxSize: 8,
        planId: "human",
        bodyJson: p.body || null,
        inventory: p.inventory || null,
        equipment: p.equipment || null,
        hotbarIndex: p.hotbarIndex ?? 0,
        dataStore: data,
        ctx: extras
    });
        creature.look = p.look || null;
        creature.role = p.role || extras.role || "leader";
        if (creature.role === "wanderer") {
            creature.ownerId = null;
            creature.faction = Party.FACTION_WANDERERS;
        } else {
            creature.ownerId = p.ownerId || p.id || extras.ownerId;
            creature.faction = Party.partyFactionId(creature.ownerId);
        }
        return creature;
}

function createMobCreature(entry, def, dataStore, extras = {}) {
    const data = ensureData(dataStore);
    const d = def || data.getMob(entry?.id || entry?.kind) || null;
    const creature = new SimCreature({
        id: entry?.uid || entry?.id || `mob_${GameMath.between(1, 1e9)}`,
        kind: "mob",
        name: d?.name || entry?.id || "Mob",
        x: entry?.x ?? 0,
        y: entry?.y ?? 0,
        facing: entry?.facing || "down",
        width: Number(d?.anim?.frameWidth) || 16,
        height: Number(d?.anim?.frameHeight) || 16,
        def: d,
        aiType: d?.ai || "doofus",
        homeX: entry?.homeX ?? entry?.x,
        homeY: entry?.homeY ?? entry?.y,
        hostile: !!entry?.hostile,
        planId: d?.bodyPlan || "human",
        bodyJson: entry?.body || null,
        entry,
        dataStore: data,
        ctx: extras
    });
    creature.faction = Party.FACTION_WILDLIFE;
    return creature;
}

module.exports = {
    SimCreature,
    createPlayerCreature,
    createMobCreature,
    ensureData,
    makeCtx,
    BodyCombat,
    Capacities,
    Body,
    GameMath,
    DataStore,
    MeleeMath
};
