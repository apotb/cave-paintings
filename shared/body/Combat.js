/**
 * Attack selection + hit resolution for body combat — Phaser-free UMD.
 * combatLog / FX are optional hooks on owner.scene or body.ctx.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const GameMath = require("../gameMath");
        const DataStore = require("../DataStore");
        const BodyHealing = require("./Healing");
        const Party = require("../party");
        const Apparel = require("../apparel");
        const Durability = require("../durability");
        module.exports = factory(GameMath, DataStore, BodyHealing, Party, Apparel, Durability);
    } else {
        root.BodyCombat = factory(
            root.GameMath,
            root.DataStore,
            root.BodyHealing,
            root.Party,
            root.Apparel,
            root.Durability
        );
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
    GameMath,
    DataStore,
    BodyHealing,
    Party,
    Apparel,
    Durability
) {
    function mathOf(ownerOrCtx) {
        return (
            ownerOrCtx?.anatomy?.ctx?.math ||
            ownerOrCtx?.ctx?.math ||
            ownerOrCtx?.math ||
            GameMath
        );
    }

    function hostOf(owner) {
        return owner?.anatomy?.ctx || owner?.scene || null;
    }

    function injuryDefs(host) {
        if (host?.data?.getInjuryDefs) return host.data.getInjuryDefs() || {};
        if (DataStore?.getInjuryDefs) return DataStore.getInjuryDefs() || {};
        return host?.cache?.json?.get?.("injuries") || host?.scene?.cache?.json?.get?.("injuries") || {};
    }

    function itemOf(host, id) {
        if (host?.data?.getItem) return host.data.getItem(id);
        if (DataStore?.getItem) return DataStore.getItem(id);
        if (typeof host?.getItem === "function") return host.getItem(id);
        if (typeof host?.scene?.getItem === "function") return host.scene.getItem(id);
        return null;
    }

    function hitPoint(target) {
        if (typeof target?.bodyCenter === "function") return target.bodyCenter();
        return { x: Number(target?.x) || 0, y: Number(target?.y) || 0 };
    }

    function combatLogColors() {
        if (typeof CombatLog !== "undefined") {
            return {
                you: CombatLog.COLOR_YOU,
                enemy: CombatLog.COLOR_ENEMY,
                weapon: CombatLog.COLOR_WEAPON
            };
        }
        return { you: "#7ec8ff", enemy: "#ff9a7a", weapon: "#ffe08a" };
    }

    function hediffsApi() {
        if (typeof Hediffs !== "undefined") return Hediffs;
        try {
            if (typeof module === "object" && module.exports) return require("./Hediff");
        } catch (_) {
            /* optional */
        }
        return null;
    }

    /** Fatal part destroy is deferred via microtask — flush so death lands now. */
    function finishFatal(target, part) {
        if (!target) return;
        target.anatomy?.flushPendingFatal?.();
        if (target.isBodyDead?.()) return;
        if (target.anatomy?.core?.isDead?.()) target.onBodyFatal?.(part);
    }

    const BodyCombat = {
        injuryDefs(sceneOrCtx) {
            return injuryDefs(sceneOrCtx);
        },

        meleeWeaponAverageDps(weapon) {
            if (!weapon?.attacks?.length) return null;
            let list = weapon.attacks.filter((a) => !a.unarmed && a.source !== "otherHand");
            if (!list.length) list = weapon.attacks.slice();
            let sumW = 0;
            const rows = [];
            for (const a of list) {
                const damage = Math.max(0, Number(a.damage) || 0);
                const cooldown = Math.max(0.2, Number(a.cooldown) || 2);
                const wMult = Number(a.weightMultiplier);
                const weight = damage * damage * (Number.isFinite(wMult) ? wMult : 1);
                if (!(weight > 0)) continue;
                sumW += weight;
                rows.push({ damage, cooldown, weight, type: a.type || weapon.type || "melee" });
            }
            if (!(sumW > 0) || !rows.length) return null;
            let avgDmg = 0;
            let avgCd = 0;
            let bestType = rows[0].type;
            let bestW = 0;
            for (const r of rows) {
                const p = r.weight / sumW;
                avgDmg += r.damage * p;
                avgCd += r.cooldown * p;
                if (r.weight > bestW) {
                    bestW = r.weight;
                    bestType = r.type;
                }
            }
            if (!(avgCd > 0)) return null;
            return { dps: avgDmg / avgCd, type: bestType };
        },

        collectAttacks(owner) {
            const body = owner.anatomy;
            if (!body) return [];
            const attacks = [];

            const weaponMeta =
                typeof owner.getHeldWeaponMeta === "function"
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
                    const weight = ((damage * source.hp()) / cooldown) * wMult;
                    const fist = !!a.unarmed || a.source === "otherHand";
                    const range =
                        Number(a.range) ||
                        (fist ? 4 : Number(weaponMeta.weapon.range) || 12);
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
                        unarmed: fist,
                        weaponName: fist ? null : weaponMeta.name || weaponMeta.id || null
                    });
                }
                return attacks;
            }

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
                    const weight = ((damage * part.hp()) / cooldown) * wMult;
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
            const math = mathOf(owner);
            const list = this.collectAttacks(owner);
            if (!list.length) return null;
            const bound = Math.max(...list.map((a) => a.weight));
            const best = list.filter((a) => a.weight >= 0.9 * bound);
            const mid = list.filter(
                (a) => a.weight >= 0.25 * bound && a.weight < 0.9 * bound
            );
            let category = best;
            if (math.random() < 0.25 && mid.length) category = mid;
            if (!category.length) category = best.length ? best : list;
            return math.pick(category);
        },

        sourceLabelFor(attacker, attack) {
            if (!attacker || !attack) return null;
            const tool = !attack.unarmed && attack.weaponName
                ? attack.weaponName
                : attack.sourcePart?.name || "body";
            const who =
                attacker.displayName?.() ||
                attacker.def?.name ||
                attacker.name ||
                "Someone";
            return `${who}'s ${tool}`;
        },

        applyHit(attacker, target, attack, opts = null) {
            if (!target?.anatomy || !attack) return null;
            if (attacker && attacker !== target && Party?.sameFaction?.(attacker, target)) {
                return null;
            }
            // Destroyed core is fatal, but isCutOff skips it so later rolls still
            // land on a dead torso and never kill. Finish death instead of stacking.
            if (target.anatomy.core?.isDead?.()) {
                finishFatal(target, target.anatomy.core);
                return null;
            }
            const host = hostOf(target);
            const math = mathOf(target);
            const defs = injuryDefs(host);
            let victimPart = target.anatomy.rollLimb();
            if (!victimPart || victimPart.isDead()) {
                victimPart = target.anatomy.core;
            }

            let damage = attack.damage;
            const variance = Number(attack.def?.variance ?? 0.05);
            const lo = Math.floor(100 * (1 - variance));
            const hi = Math.floor(100 * (1 + variance));
            damage *= math.between(lo, hi) / 100;
            damage = Math.round(damage * 10) / 10;
            if (!(damage > 0)) return null;

            const armorPen = Number(attack.armorPen ?? attack.def?.armorPen) || 0;
            let armor = null;
            if (Apparel && target.equipment) {
                armor = Apparel.resolveHit({
                    equipment: target.equipment,
                    getItem: (id) => itemOf(host, id),
                    part: victimPart,
                    damage,
                    damageType: attack.type === "sharp" ? "sharp" : "blunt",
                    armorPen,
                    random: () => math.random()
                });
                damage = armor.damage;
            }

            const brokeApparel = (armor && Durability)
                ? Apparel.applyRolledWear(
                    target.equipment,
                    armor.rolled,
                    (id) => itemOf(host, id),
                    Durability
                )
                : [];
            if (brokeApparel.length) target.afterApparelWear?.();

            const log =
                host?.combatLog ||
                target.scene?.combatLog ||
                attacker?.scene?.combatLog ||
                null;
            const player = host?.player || target.scene?.player;
            const vicIsYou = target === player;
            const colors = combatLogColors();
            const sparkAt = hitPoint(target);

            if (brokeApparel.length && typeof log?.push === "function") {
                for (const piece of brokeApparel) {
                    const who = vicIsYou
                        ? "Your"
                        : `${target.displayName?.() || target.def?.name || "Their"}'s`;
                    log.push(`${who} ${piece.name} fell apart`, {
                        combat: true,
                        attacker,
                        target
                    });
                }
            }

            if (armor?.deflected) {
                const first = (armor.rolled || []).find((r) => r.outcome === "deflect");
                const itemName = first?.def?.name || first?.stack?.id || "apparel";
                if (typeof log?.push === "function") {
                    log.push(null, {
                        combat: true,
                        attacker,
                        target,
                        attack,
                        victimPartName: victimPart.name,
                        damage: 0,
                        destroyed: false,
                        deflected: true,
                        deflectName: itemName,
                        spark: sparkAt,
                        segments: [
                            { text: vicIsYou ? "Your" : "The", color: vicIsYou ? colors.you : colors.enemy },
                            { text: itemName, color: colors.weapon },
                            { text: "deflected the blow" }
                        ]
                    });
                }
                const sparkFn = host?.spawnApparelDeflectSpark
                    || target.scene?.spawnApparelDeflectSpark;
                sparkFn?.(sparkAt.x, sparkAt.y);
                const result = {
                    damage: 0,
                    part: victimPart,
                    destroyed: false,
                    injury: null,
                    attack,
                    deflected: true,
                    glanced: false,
                    brokeApparel
                };
                target.onBodyDamaged?.(attacker, result);
                return result;
            }

            if (!(damage > 0)) {
                const result = {
                    damage: 0,
                    part: victimPart,
                    destroyed: false,
                    injury: null,
                    attack,
                    deflected: false,
                    glanced: !!armor?.glanced,
                    brokeApparel
                };
                target.onBodyDamaged?.(attacker, result);
                return result;
            }

            const hitType = armor?.damageType || (attack.type === "sharp" ? "sharp" : "blunt");
            const isSharp = hitType === "sharp";
            const injuryKey = attack.def?.injury || attack.injury;
            let idef = (injuryKey && defs[injuryKey]) || (isSharp ? defs.cut : defs.bruise);
            if (victimPart.baseId === "Brain" || victimPart.name === "Brain") {
                idef = defs.brain_cut || idef;
            }
            idef = idef || {
                id: "bruise",
                name: "Injury",
                painPerSeverity: 0.0125,
                bleedRate: 0,
                canScar: false
            };

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
                sourceLabel: this.sourceLabelFor(attacker, attack),
                infectionChance: Number(idef.infectionChance) || 0,
                infectInMinutes: null,
                infectBedFactor: null
            };

            const alwaysScar =
                idef.alwaysScar || victimPart.def?.alwaysScar || victimPart.baseId === "Brain";
            const delicate = idef.delicate || victimPart.def?.delicate;
            if (idef.canScar !== false && hitType !== "blunt") {
                let odds = 0;
                if (alwaysScar) odds = 1;
                else if (damage >= 5) {
                    odds = 0.02 * math.clamp((damage - 4) / 10, 0, 1);
                    if (delicate) odds *= 3;
                }
                if (math.random() < odds) {
                    injury.scarPending = true;
                    injury.scarSeverity = math.between(1, Math.max(1, Math.floor(damage / 2)));
                    const r = math.random();
                    injury.painCategory =
                        r < 0.5 ? "painless" : r < 0.7 ? "low" : r < 0.9 ? "medium" : "high";
                }
            }

            victimPart.injure(injury);
            if (!victimPart.isDead()) {
                hediffsApi()?.armInfecter?.(injury, target, math);
            }

            const destroyed = victimPart.isDead();
            const result = {
                damage,
                part: victimPart,
                destroyed,
                injury,
                attack,
                deflected: false,
                glanced: !!armor?.glanced,
                brokeApparel
            };

            if (injury.bleeding) {
                BodyHealing.spawnHitBleedBurst?.(target, host, injury, victimPart, destroyed);
            }

            if (typeof log?.push === "function") {
                const isYou = attacker === player;
                const subj = isYou
                    ? "You"
                    : attacker?.displayName?.() || attacker?.def?.name || "Someone";
                const verb = attack.verb || "hit";
                const weaponName =
                    !attack.unarmed && attack.weaponName
                        ? attack.weaponName
                        : attack.sourcePart?.name || attack.weaponName || "blow";
                const vicPossessive = vicIsYou
                    ? "your"
                    : `${target.def?.name || target.displayName?.() || "foe"}'s`;
                const dmgStr = armor?.glanced
                    ? `(${Number(damage).toFixed(1)}, glanced)`
                    : `(${Number(damage).toFixed(1)})`;
                const logOpts = {
                    combat: true,
                    attacker,
                    target,
                    attack,
                    victimPartName: victimPart.name,
                    damage,
                    destroyed: false,
                    glanced: !!armor?.glanced
                };
                log.push(null, {
                    ...logOpts,
                    segments: [
                        { text: subj, color: isYou ? colors.you : colors.enemy },
                        { text: verb },
                        { text: weaponName, color: colors.weapon },
                        { text: "into" },
                        { text: vicPossessive, color: vicIsYou ? colors.you : colors.enemy },
                        { text: victimPart.name },
                        { text: dmgStr, color: colors.weapon }
                    ]
                });
                if (destroyed) {
                    const who = vicIsYou
                        ? "Your"
                        : `${target.def?.name || target.displayName?.() || "Their"}'s`;
                    log.push(null, {
                        ...logOpts,
                        destroyed: true,
                        segments: [
                            { text: who, color: vicIsYou ? colors.you : colors.enemy },
                            { text: `${victimPart.name} was destroyed!` }
                        ]
                    });
                }
            }

            target.onBodyDamaged?.(attacker, result);
            if (result.destroyed) finishFatal(target, victimPart);
            return result;
        }
    };

    return BodyCombat;
});
