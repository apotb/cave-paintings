/**
 * RimWorld-style apparel coverage, occupancy, and armor resolve.
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Apparel = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const MINUTES_PER_DAY = 1440;
    const HIT_WEAR_DIVISOR = 4;
    const DEATH_WEAR_MIN = 0.15;
    const DEATH_WEAR_MAX = 0.4;
    const DAILY_WEAR_CHANCE = 0.4;
    const DAILY_WEAR_HP = 1;

    /** Outer → inner for combat. belt/pack are occupancy-only. */
    const ARMOR_LAYER_ORDER = ["eyes", "headgear", "outer", "middle", "skin"];
    const LAYER_RANK = Object.create(null);
    ARMOR_LAYER_ORDER.forEach((id, i) => {
        LAYER_RANK[id] = i;
    });

    const GROUP_LABELS = {
        torso: "torso",
        neck: "neck",
        shoulders: "shoulders",
        right_shoulder: "right shoulder",
        left_shoulder: "left shoulder",
        arms: "arms",
        hands: "hands",
        legs: "legs",
        feet: "feet",
        toes: "toes",
        full_head: "head",
        upper_head: "upper head",
        eyes: "eyes"
    };

    /** baseId membership (Left/Right prefix stripped). */
    const GROUP_BASE = {
        torso: {
            Torso: true,
            Clavicle: true,
            Sternum: true,
            Ribcage: true,
            Pelvis: true,
            Spine: true,
            Stomach: true,
            Heart: true,
            Lung: true,
            Kidney: true,
            Liver: true
        },
        neck: { Neck: true },
        shoulders: { Shoulder: true },
        arms: { Arm: true, Humerus: true, Radius: true },
        hands: {
            Hand: true,
            Thumb: true,
            "Index Finger": true,
            "Middle Finger": true,
            "Ring Finger": true,
            "Pinky Finger": true
        },
        legs: { Leg: true, Femur: true, Tibia: true },
        feet: { Foot: true },
        toes: {
            "Big Toe": true,
            "Second Toe": true,
            "Middle Toe": true,
            "Fourth Toe": true,
            "Little Toe": true
        },
        full_head: {
            Head: true,
            Skull: true,
            Brain: true,
            Eye: true,
            Ear: true,
            Nose: true,
            Jaw: true,
            Tongue: true
        },
        upper_head: { Head: true, Skull: true, Brain: true, Ear: true },
        eyes: { Eye: true }
    };

    const SLOT_KEYS = ["head", "torso", "legs", "feet", "back"];

    function partInfo(partOrName) {
        if (partOrName && typeof partOrName === "object") {
            const name = String(partOrName.name || "");
            const baseId = String(partOrName.baseId || "");
            return { name, baseId: baseId || name };
        }
        const name = String(partOrName || "");
        const m = name.match(/^(Left|Right) (.+)$/);
        return { name, baseId: m ? m[2] : name };
    }

    function groupContains(groupId, partOrName) {
        const info = partInfo(partOrName);
        if (groupId === "right_shoulder") return info.name === "Right Shoulder";
        if (groupId === "left_shoulder") return info.name === "Left Shoulder";
        const set = GROUP_BASE[groupId];
        if (!set) return false;
        return !!(set[info.baseId] || set[info.name]);
    }

    function groupsForPart(partOrName) {
        const out = [];
        for (const id of Object.keys(GROUP_LABELS)) {
            if (groupContains(id, partOrName)) out.push(id);
        }
        return out;
    }

    function layerOf(def) {
        const raw = String(def?.equip?.layer || "").toLowerCase();
        return raw || null;
    }

    function coversOf(def) {
        const list = def?.equip?.covers;
        if (!Array.isArray(list)) return [];
        return list.map((g) => String(g || "")).filter(Boolean);
    }

    function isArmorLayer(layer) {
        return layer != null && Object.prototype.hasOwnProperty.call(LAYER_RANK, layer);
    }

    function armorRating(def, damageType) {
        const armor = def?.equip?.armor;
        if (!armor || typeof armor !== "object") return 0;
        const key = damageType === "sharp" ? "sharp" : "blunt";
        const n = Number(armor[key]) || 0;
        return n > 0 ? n : 0;
    }

    function hasArmor(def) {
        return armorRating(def, "sharp") > 0 || armorRating(def, "blunt") > 0;
    }

    function itemCoversPart(def, partOrName) {
        const covers = coversOf(def);
        for (const g of covers) {
            if (groupContains(g, partOrName)) return true;
        }
        return false;
    }

    function occupancyConflict(defA, defB) {
        if (!defA || !defB) return false;
        const la = layerOf(defA);
        const lb = layerOf(defB);
        if (!la || !lb || la !== lb) return false;
        const ca = coversOf(defA);
        const cb = coversOf(defB);
        for (const g of ca) {
            if (cb.indexOf(g) >= 0) return true;
        }
        return false;
    }

    function wornSlots(equipment) {
        if (!equipment || typeof equipment !== "object") return [];
        const out = [];
        for (const key of SLOT_KEYS) {
            const stack = equipment[key];
            if (stack?.id) out.push({ key, stack });
        }
        const waist = Array.isArray(equipment.waist) ? equipment.waist : [];
        for (let i = 0; i < waist.length; i++) {
            const stack = waist[i];
            if (stack?.id) out.push({ key: `waist:${i}`, stack });
        }
        return out;
    }

    function setSlot(equipment, key, stack) {
        if (!equipment) return;
        if (String(key).startsWith("waist:")) {
            const i = parseInt(String(key).slice(6), 10);
            if (!Array.isArray(equipment.waist)) equipment.waist = [];
            if (Number.isInteger(i) && i >= 0) {
                while (equipment.waist.length <= i) equipment.waist.push(null);
                equipment.waist[i] = stack;
            }
            return;
        }
        equipment[key] = stack;
    }

    function coveringPieces(equipment, getItem, partOrName) {
        const out = [];
        const seen = new Set();
        for (const row of wornSlots(equipment)) {
            const def = typeof getItem === "function" ? getItem(row.stack.id) : null;
            if (!def || !hasArmor(def)) continue;
            const layer = layerOf(def);
            if (!isArmorLayer(layer)) continue;
            if (!itemCoversPart(def, partOrName)) continue;
            if (seen.has(row.stack)) continue;
            seen.add(row.stack);
            out.push({ key: row.key, stack: row.stack, def, layer });
        }
        out.sort((a, b) => (LAYER_RANK[a.layer] || 0) - (LAYER_RANK[b.layer] || 0));
        return out;
    }

    /**
     * Resolve armor against a rolled body part.
     * @returns {{ damage: number, damageType: string, deflected: boolean, glanced: boolean, rolled: object[] }}
     */
    function resolveHit(opts) {
        const damage0 = Math.max(0, Number(opts?.damage) || 0);
        const type0 = opts?.damageType === "sharp" ? "sharp" : "blunt";
        const ap = Number(opts?.armorPen) || 0;
        const random = typeof opts?.random === "function" ? opts.random : Math.random;
        let remaining = damage0;
        let fleshType = type0;
        let deflected = false;
        let glanced = false;
        const rolled = [];
        const pieces = coveringPieces(opts?.equipment, opts?.getItem, opts?.part);
        for (const piece of pieces) {
            if (!(remaining > 0)) break;
            const rating = armorRating(piece.def, type0);
            const A = (rating - ap) * 100;
            const rng = random() * 100;
            let outcome = "none";
            const reached = remaining;
            if (A > 0) {
                if (rng < A / 2) {
                    outcome = "deflect";
                    remaining = 0;
                    deflected = true;
                } else if (rng < A) {
                    outcome = "half";
                    remaining = remaining * 0.5;
                    glanced = true;
                    if (type0 === "sharp") fleshType = "blunt";
                }
            }
            rolled.push({
                key: piece.key,
                stack: piece.stack,
                def: piece.def,
                layer: piece.layer,
                outcome,
                wear: reached / HIT_WEAR_DIVISOR,
                reached
            });
            if (outcome === "deflect") break;
        }
        remaining = Math.round(remaining * 10) / 10;
        return {
            damage: remaining,
            damageType: remaining > 0 ? fleshType : type0,
            deflected,
            glanced,
            rolled
        };
    }

    function applyRolledWear(equipment, rolled, getItem, Durability) {
        const broke = [];
        if (!equipment || !Array.isArray(rolled) || !Durability) return broke;
        for (const row of rolled) {
            const stack = row?.stack;
            if (!stack?.id) continue;
            const def = row.def || (typeof getItem === "function" ? getItem(stack.id) : null);
            const amount = Number(row.wear) || 0;
            if (!(amount > 0)) continue;
            const result = Durability.applyDurabilityUse(stack, amount, def);
            if (result.broke) {
                setSlot(equipment, row.key, null);
                broke.push({
                    key: row.key,
                    name: Durability.stackDisplayName(stack, def),
                    id: stack.id
                });
            }
        }
        return broke;
    }

    function piecesWithHp(equipment, getItem, Durability) {
        const out = [];
        if (!Durability) return out;
        for (const row of wornSlots(equipment)) {
            const def = typeof getItem === "function" ? getItem(row.stack.id) : null;
            if (!def) continue;
            if (!(Durability.maxDurability(row.stack, def) > 0)) continue;
            out.push({ key: row.key, stack: row.stack, def });
        }
        return out;
    }

    function applyDeathWear(equipment, getItem, random, Durability) {
        const rng = typeof random === "function" ? random : Math.random;
        const broke = [];
        if (!Durability) return broke;
        for (const row of piecesWithHp(equipment, getItem, Durability)) {
            const rem = Durability.remainingDurability(row.stack, row.def);
            if (!(rem > 0)) continue;
            const frac = DEATH_WEAR_MIN + rng() * (DEATH_WEAR_MAX - DEATH_WEAR_MIN);
            const amount = rem * frac;
            const result = Durability.applyDurabilityUse(row.stack, amount, row.def);
            if (result.broke) {
                setSlot(equipment, row.key, null);
                broke.push({
                    key: row.key,
                    name: Durability.stackDisplayName(row.stack, row.def),
                    id: row.stack.id
                });
            }
        }
        return broke;
    }

    function applyDailyWear(equipment, getItem, random, Durability) {
        const rng = typeof random === "function" ? random : Math.random;
        const broke = [];
        if (!Durability) return broke;
        for (const row of piecesWithHp(equipment, getItem, Durability)) {
            if (!(rng() < DAILY_WEAR_CHANCE)) continue;
            const result = Durability.applyDurabilityUse(row.stack, DAILY_WEAR_HP, row.def);
            if (result.broke) {
                setSlot(equipment, row.key, null);
                broke.push({
                    key: row.key,
                    name: Durability.stackDisplayName(row.stack, row.def),
                    id: row.stack.id
                });
            }
        }
        return broke;
    }

    function isDayBoundary(worldMinuteIndex) {
        const n = Number(worldMinuteIndex);
        if (!Number.isFinite(n) || n <= 0) return false;
        return n % MINUTES_PER_DAY === 0;
    }

    function armorTooltipLines(def) {
        const lines = [];
        if (!def?.equip) return lines;
        const sharp = armorRating(def, "sharp");
        const blunt = armorRating(def, "blunt");
        if (sharp > 0 || blunt > 0) {
            lines.push(
                `Armor: ${Math.round(sharp * 100)}% sharp / ${Math.round(blunt * 100)}% blunt`
            );
        }
        const covers = coversOf(def);
        if (covers.length) {
            const labels = covers.map((g) => GROUP_LABELS[g] || g);
            lines.push(`Covers: ${labels.join(", ")}`);
        }
        return lines;
    }

    function coveringTooltipLines(equipment, getItem, partOrName) {
        const pieces = coveringPieces(equipment, getItem, partOrName);
        if (!pieces.length) return [];
        return pieces.map((p) => {
            const name = p.def?.name || p.stack?.id || "Apparel";
            const sharp = Math.round(armorRating(p.def, "sharp") * 100);
            const blunt = Math.round(armorRating(p.def, "blunt") * 100);
            return `${name} — ${sharp}% sharp / ${blunt}% blunt`;
        });
    }

    return {
        MINUTES_PER_DAY,
        HIT_WEAR_DIVISOR,
        DEATH_WEAR_MIN,
        DEATH_WEAR_MAX,
        DAILY_WEAR_CHANCE,
        ARMOR_LAYER_ORDER,
        GROUP_LABELS,
        partInfo,
        groupContains,
        groupsForPart,
        layerOf,
        coversOf,
        isArmorLayer,
        armorRating,
        hasArmor,
        itemCoversPart,
        occupancyConflict,
        wornSlots,
        setSlot,
        coveringPieces,
        resolveHit,
        applyRolledWear,
        applyDeathWear,
        applyDailyWear,
        isDayBoundary,
        armorTooltipLines,
        coveringTooltipLines
    };
});
