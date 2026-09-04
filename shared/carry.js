/**
 * Inventory mass and carry cap (strength × 2). Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Carry = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const RECIPE_META_KEYS = {
        QUANTITY: true,
        REQUIRE_THING: true,
        REQUIRE_STATION: true,
        CRAFT_SECONDS: true,
        REQUIRE_TOOL: true
    };

    function isRecipeMetaKey(k) {
        return !!RECIPE_META_KEYS[k];
    }

    /** Knapped tools store class on the stack; stackable tools (bone awl) use the item def. */
    function stackToolClass(stack, def) {
        return (stack && stack.toolClass) || def?.toolClass || null;
    }

    /** Stackable def tools are consumed 1× per craft instead of durability wear. */
    function isSingleUseTool(stack, def) {
        if (!stack) return false;
        if (stack.knapMaterial || stack.knapIconData || stack.knapDamage != null) return false;
        if (!stackToolClass(stack, def)) return false;
        return Math.max(1, Number(def?.maxStack) || 1) > 1;
    }

    function hideStageOf(v) {
        if (!v || typeof v !== "object" || !v.hideStage) return null;
        return {
            stage: String(v.hideStage),
            qty: Math.max(0, Number(v.qty) || 1)
        };
    }

    /** Raw hide/leather defs at a processing stage (no recipe of their own). */
    function hideStageMaterials(items, stage) {
        const out = [];
        if (!stage) return out;
        for (const item of items || []) {
            if (item?.hide?.stage === stage && !item.recipe) out.push(item);
        }
        return out;
    }

    function avgHideStageWeight(items, stage) {
        const mats = hideStageMaterials(items, stage);
        if (!mats.length) return 0;
        let sum = 0;
        for (const m of mats) sum += Number(m.weight) || 0;
        return sum / mats.length;
    }

    function avgHideStageFuelKj(items, stage) {
        const mats = hideStageMaterials(items, stage);
        if (!mats.length) return 0;
        let sum = 0;
        for (const m of mats) sum += Number(m.fuel?.kj) || 0;
        return sum / mats.length;
    }

    function maxHideStageFuelTemp(items, stage) {
        const mats = hideStageMaterials(items, stage);
        let maxT = 0;
        for (const m of mats) {
            const t = Number(m.fuel?.temp) || 0;
            if (t > maxT) maxT = t;
        }
        return maxT;
    }

    const BASE_STRENGTH = 15;

    function unitWeight(stack, def) {
        const knap = !!(stack?.toolClass || stack?.knapMaterial);
        if (knap) return Math.max(0, Number(def?.weight) || 0);
        // Meals carry a computed mass. Never trust stack.weight on world drops
        // (Phaser Arcade `weight` is 0/1 and was zeroing / undercounting logs).
        const meal = !!(stack?.food || (stack?.ingredients && stack.ingredients.length));
        if (meal) {
            const override = Number(stack?.weight);
            if (Number.isFinite(override) && override > 0) return override;
        }
        return Math.max(0, Number(def?.weight) || 0);
    }

    function stackMass(stack, def) {
        if (!stack?.id) return 0;
        const qty = Number(stack.quantity);
        const n = Number.isFinite(qty) ? Math.max(0, qty) : 1;
        if (!n) return 0;
        return unitWeight(stack, def) * n;
    }

    function wornPieces(equipment) {
        if (!equipment || typeof equipment !== "object") return [];
        return [
            equipment.head,
            equipment.torso,
            equipment.legs,
            equipment.feet,
            equipment.back,
            ...(Array.isArray(equipment.waist) ? equipment.waist : [])
        ];
    }

    function gearMass(inventory, equipment, getDef, overflow) {
        const defOf = (id) => (typeof getDef === "function" ? getDef(id) : null);
        let total = 0;
        for (const s of inventory || []) {
            if (s?.id) total += stackMass(s, defOf(s.id));
        }
        for (const s of overflow || []) {
            if (s?.id) total += stackMass(s, defOf(s.id));
        }
        for (const s of wornPieces(equipment)) {
            if (s?.id) total += stackMass(s, defOf(s.id));
        }
        return Math.round(total * 100) / 100;
    }

    function strengthFromEquip(equipment, getDef, base = BASE_STRENGTH) {
        let str = Number(base) || BASE_STRENGTH;
        const defOf = (id) => (typeof getDef === "function" ? getDef(id) : null);
        for (const s of wornPieces(equipment)) {
            if (!s?.id) continue;
            str += Number(defOf(s.id)?.equip?.effects?.strength || 0);
        }
        return str;
    }

    function carryCap(strength) {
        return (Number(strength) || 0) * 2;
    }

    /**
     * Mass a pawn may pick up to. Players/companions may fill to 2×strength
     * (encumbered). Settlers stop at strength so they never enter that state.
     */
    function pickupCap(strength, role) {
        const s = Number(strength) || 0;
        if (role === "settler") return s;
        return carryCap(s);
    }

    /**
     * Over-strength mass: m in 0..1 when weight is between strength and 2×strength.
     * Matches Player.getEncumbrance (hungerRate 1 + 0.5m, cannot sprint if m > 0).
     */
    function encumbrance(weight, strength) {
        const s = Number(strength);
        const capStr = Number.isFinite(s) && s > 0 ? s : BASE_STRENGTH;
        const w = Math.max(0, Number(weight) || 0);
        const m = Math.min(Math.max(w - capStr, 0), capStr) / capStr;
        return {
            speedMultiplier: 1.0 - 0.6 * m,
            hungerRate: 1.0 + 0.5 * m,
            cannotSprint: m > 0
        };
    }

    /**
     * How many units of `unitW` fit without exceeding cap.
     * Weightless items are not limited here (caller still slot-limits).
     */
    function countFit(want, unitW, currentMass, cap) {
        const n = Math.max(0, Math.floor(Number(want) || 0));
        if (!n) return 0;
        const w = Number(unitW) || 0;
        if (!(w > 0)) return n;
        const cur = Number(currentMass) || 0;
        const max = Number(cap) || 0;
        if (cur + w > max + 1e-8) return 0;
        const room = max - cur;
        return Math.min(n, Math.floor((room + 1e-8) / w));
    }

    /**
     * Fill in recipe-derived weights (mutates items). Same rules as the client.
     */
    function resolveCraftedWeights(items) {
        if (!Array.isArray(items)) return;
        const byId = new Map();
        for (const item of items) {
            if (item?.id) byId.set(item.id, item);
        }
        const resolving = new Set();
        const resolved = new Map();

        function weightOf(id) {
            if (resolved.has(id)) return resolved.get(id);
            const item = byId.get(id);
            if (!item) {
                resolved.set(id, 0);
                return 0;
            }
            if (!item.recipe || item.weightFixed) {
                const w = Number(item.weight) || 0;
                resolved.set(id, w);
                return w;
            }
            if (resolving.has(id)) {
                const w = Number(item.weight) || 0;
                resolved.set(id, w);
                return w;
            }
            resolving.add(id);
            let quantity = 1;
            let sum = 0;
            for (const [k, v] of Object.entries(item.recipe)) {
                if (k === "QUANTITY") {
                    quantity = +v || 1;
                    continue;
                }
                if (isRecipeMetaKey(k)) continue;
                const hide = hideStageOf(v);
                if (hide) {
                    sum += avgHideStageWeight(items, hide.stage) * hide.qty;
                    continue;
                }
                const qty = (v && typeof v === "object") ? (+v.qty || 1) : (+v || 1);
                sum += weightOf(k) * qty;
            }
            resolving.delete(id);
            const w = Math.round((sum / Math.max(1, quantity)) * 100) / 100;
            item.weight = w;
            resolved.set(id, w);
            return w;
        }

        for (const item of items) {
            if (item?.id) weightOf(item.id);
        }
    }

    /**
     * Fill in recipe-derived fuel.kj (mutates items). Same rules as the client.
     */
    function resolveCraftedFuel(items) {
        if (!Array.isArray(items)) return;
        const byId = new Map();
        for (const item of items) {
            if (item?.id) byId.set(item.id, item);
        }
        const resolving = new Set();
        const resolved = new Map();

        function hasKjOverride(item) {
            return !!(item.fuelFixed || (item.fuel && Object.prototype.hasOwnProperty.call(item.fuel, "kj")));
        }

        function fuelKjOf(id) {
            if (resolved.has(id)) return resolved.get(id);
            const item = byId.get(id);
            if (!item) {
                resolved.set(id, 0);
                return 0;
            }
            if (!item.recipe || hasKjOverride(item)) {
                const kj = Number(item.fuel?.kj) || 0;
                resolved.set(id, kj);
                return kj;
            }
            if (resolving.has(id)) {
                const kj = Number(item.fuel?.kj) || 0;
                resolved.set(id, kj);
                return kj;
            }
            resolving.add(id);
            let quantity = 1;
            let sum = 0;
            for (const [k, v] of Object.entries(item.recipe)) {
                if (k === "QUANTITY") {
                    quantity = +v || 1;
                    continue;
                }
                if (isRecipeMetaKey(k)) continue;
                const hide = hideStageOf(v);
                if (hide) {
                    sum += avgHideStageFuelKj(items, hide.stage) * hide.qty;
                    continue;
                }
                const qty = (v && typeof v === "object") ? (+v.qty || 1) : (+v || 1);
                sum += fuelKjOf(k) * qty;
            }
            resolving.delete(id);
            const kj = Math.round(sum / Math.max(1, quantity));
            if (kj > 0) {
                if (!item.fuel) item.fuel = {};
                item.fuel.kj = kj;
            }
            resolved.set(id, kj);
            return kj;
        }

        const tempResolved = new Map();
        const tempResolving = new Set();

        function hasTempOverride(item) {
            return !!(item.fuelFixed || (item.fuel && Object.prototype.hasOwnProperty.call(item.fuel, "temp")));
        }

        function fuelTempOf(id) {
            if (tempResolved.has(id)) return tempResolved.get(id);
            const item = byId.get(id);
            if (!item) {
                tempResolved.set(id, 0);
                return 0;
            }
            if (!item.recipe || hasTempOverride(item)) {
                const t = Number(item.fuel?.temp) || 0;
                tempResolved.set(id, t);
                return t;
            }
            if (tempResolving.has(id)) {
                const t = Number(item.fuel?.temp) || 0;
                tempResolved.set(id, t);
                return t;
            }
            tempResolving.add(id);
            let maxT = 0;
            for (const [k, v] of Object.entries(item.recipe)) {
                if (k === "QUANTITY") continue;
                if (isRecipeMetaKey(k)) continue;
                const hide = hideStageOf(v);
                if (hide) {
                    const t = maxHideStageFuelTemp(items, hide.stage);
                    if (t > maxT) maxT = t;
                    continue;
                }
                const t = fuelTempOf(k);
                if (t > maxT) maxT = t;
            }
            tempResolving.delete(id);
            if (maxT > 0) {
                if (!item.fuel) item.fuel = {};
                item.fuel.temp = maxT;
            }
            tempResolved.set(id, maxT);
            return maxT;
        }

        for (const item of items) {
            if (item?.id) fuelKjOf(item.id);
        }
        for (const item of items) {
            if (item?.id) fuelTempOf(item.id);
        }
    }

    return {
        BASE_STRENGTH,
        RECIPE_META_KEYS,
        isRecipeMetaKey,
        stackToolClass,
        isSingleUseTool,
        unitWeight,
        stackMass,
        wornPieces,
        gearMass,
        strengthFromEquip,
        carryCap,
        pickupCap,
        encumbrance,
        countFit,
        resolveCraftedWeights,
        resolveCraftedFuel
    };
});
