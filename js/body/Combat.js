/**
 * Attack selection + hit resolution for body combat.
 */
const BodyCombat = {
    injuryDefs(scene) {
        return scene.cache.json.get("injuries") || {};
    },

    /**
     * Build weighted attack list for an owner (player/mob).
     * @returns {Array<{def, sourcePart, weight, damage, type, verb, cooldown, name}>}
     */
    collectAttacks(owner) {
        const body = owner.anatomy;
        if (!body) return [];
        const scene = owner.scene;
        const attacks = [];

        // Equipped melee weapon replaces unarmed pool
        const weaponMeta = typeof owner.getHeldWeaponMeta === "function"
            ? owner.getHeldWeaponMeta()
            : null;
        const wAttacks = weaponMeta?.weapon?.attacks;

        if (wAttacks?.length) {
            const primary = body.primaryHand();
            const other = body.otherHand(primary);
            for (const a of wAttacks) {
                let source = primary;
                if (a.source === "otherHand") {
                    source = other;
                    if (!source) continue;
                } else if (!source) {
                    continue;
                }
                const cooldown = Math.max(0.2, Number(a.cooldown) || 2);
                const damage = Number(a.damage) || 1;
                const wMult = Number(a.weightMultiplier) || 1;
                const weight = (damage * source.hp() / cooldown) * wMult;
                // Fist / offhand unarmed while holding a weapon stays short — not weapon reach
                const fist = !!a.unarmed || a.source === "otherHand";
                const range = Number(a.range)
                    || (fist ? 4 : (Number(weaponMeta.weapon.range) || 12));
                attacks.push({
                    def: a,
                    sourcePart: source,
                    weight,
                    damage,
                    type: a.type || "blunt",
                    verb: a.verb || "hit",
                    cooldown,
                    name: a.name || a.id || "Attack",
                    range,
                    unarmed: fist
                });
            }
            return attacks;
        }

        // Unarmed from living parts
        const plan = body.plan;
        const uAtk = plan.unarmedAttacks || {};
        for (const part of Object.values(body.parts())) {
            if (part.isDead()) continue;
            for (const key of part.def.attacks || []) {
                const a = uAtk[key];
                if (!a) continue;
                const cooldown = Math.max(0.2, Number(a.cooldown) || 2);
                const damage = Number(a.damage) || 1;
                const wMult = Number(a.weightMultiplier) || 1;
                const weight = (damage * part.hp() / cooldown) * wMult;
                attacks.push({
                    def: a,
                    sourcePart: part,
                    weight,
                    damage,
                    type: a.type || "blunt",
                    verb: a.verb || "hit",
                    cooldown,
                    name: a.name || key,
                    range: Number(a.range) || 4,
                    unarmed: true
                });
            }
        }
        return attacks;
    },

    pickAttack(owner) {
        const list = this.collectAttacks(owner);
        if (!list.length) return null;
        const bound = Math.max(...list.map(a => a.weight));
        const best = list.filter(a => a.weight >= 0.9 * bound);
        const mid = list.filter(a => a.weight >= 0.25 * bound && a.weight < 0.9 * bound);
        let category = best;
        if (Math.random() < 0.25 && mid.length) category = mid;
        if (!category.length) category = best.length ? best : list;
        return Phaser.Utils.Array.GetRandom(category);
    },

    /**
     * Apply a resolved melee hit to target's body.
     * @returns {{ damage, part, destroyed, injury }|null}
     */
    applyHit(attacker, target, attack, opts = null) {
        if (!target?.anatomy || !attack) return null;
        const scene = target.scene;
        const defs = this.injuryDefs(scene);
        let victimPart = target.anatomy.rollLimb();
        if (!victimPart || victimPart.isDead()) {
            victimPart = target.anatomy.core;
        }

        let damage = attack.damage;
        const variance = Number(attack.def?.variance ?? 0.05);
        const lo = Math.floor(100 * (1 - variance));
        const hi = Math.floor(100 * (1 + variance));
        damage *= Phaser.Math.Between(lo, hi) / 100;
        damage = Math.round(damage * 10) / 10;
        if (!(damage > 0)) return null;

        const isSharp = attack.type === "sharp";
        let idef = isSharp ? defs.cut : defs.bruise;
        if (victimPart.baseId === "Brain" || victimPart.name === "Brain") {
            idef = defs.brain_cut || idef;
        }
        idef = idef || { id: "bruise", name: "Injury", painPerSeverity: 0.0125, bleedRate: 0, canScar: false };

        const injury = {
            id: idef.id,
            name: idef.name || "Injury",
            severity: damage,
            permanent: false,
            bleeding: (Number(idef.bleedRate) || 0) > 0,
            bleedRate: Number(idef.bleedRate) || 0,
            painPerSeverity: Number(idef.painPerSeverity) || 0.0125,
            tended: false,
            tendQuality: 0,
            scarPending: false,
            scarSeverity: 0,
            painCategory: null,
            sourceLabel: attacker
                ? `${attacker.displayName?.() || attacker.def?.name || attacker.name || "Someone"}'s ${attack.sourcePart?.name || "body"}`
                : null
        };

        // Scar roll at injury time (RW-ish); bruises never scar
        const alwaysScar = idef.alwaysScar || victimPart.def?.alwaysScar || victimPart.baseId === "Brain";
        const delicate = idef.delicate || victimPart.def?.delicate;
        if (idef.canScar !== false && attack.type !== "blunt") {
            let odds = 0;
            if (alwaysScar) odds = 1;
            else if (damage >= 5) {
                odds = 0.02 * Phaser.Math.Clamp((damage - 4) / 10, 0, 1);
                if (delicate) odds *= 3;
            }
            if (Math.random() < odds) {
                injury.scarPending = true;
                injury.scarSeverity = Phaser.Math.Between(1, Math.max(1, Math.floor(damage / 2)));
                const r = Math.random();
                injury.painCategory = r < 0.5 ? "painless" : r < 0.7 ? "low" : r < 0.9 ? "medium" : "high";
            }
        }

        victimPart.injure(injury);

        const destroyed = victimPart.isDead();
        const result = { damage, part: victimPart, destroyed, injury, attack };

        if (injury.bleeding) {
            BodyHealing.spawnHitBleedBurst?.(target, scene, injury, victimPart, destroyed);
        }

        if (typeof scene.combatLog?.push === "function") {
            const isYou = attacker === scene.player;
            const subj = isYou
                ? "You"
                : (attacker?.displayName?.() || attacker?.def?.name || "Someone");
            const verb = attack.verb || "hit";
            const weaponName = attack.name || attack.sourcePart?.name || "blow";
            const vicPossessive = target === scene.player
                ? "your"
                : `${target.def?.name || target.displayName?.() || "foe"}'s`;
            scene.combatLog.push(
                `${subj} ${verb} ${weaponName} into ${vicPossessive} ${victimPart.name} (${Number(damage).toFixed(1)})`
            );
            if (destroyed) {
                const who = target === scene.player
                    ? "Your"
                    : `${target.def?.name || "Their"}`;
                scene.combatLog.push(`${who} ${victimPart.name} was destroyed!`);
            }
        }

        target.onBodyDamaged?.(attacker, result);
        return result;
    }
};
