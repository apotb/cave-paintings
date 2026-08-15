/**
 * Weapon/tool durability and slot-bar helpers (client + server).
 * Remaining uses are stored on the stack; missing field means 100%.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Durability = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const COOK_WEAR_PER_MINUTE = 0.4;
    const NO_DURABILITY_CLASS = { spear_tip: true, blank: true };

    function knapQualityMult(quality) {
        return { crude: 0.65, rough: 0.95, fine: 1.35 }[quality] || 1;
    }

    function maxDurability(stack, itemDef) {
        if (NO_DURABILITY_CLASS[stack?.toolClass]) return 0;
        const base = Number(itemDef?.durability);
        if (!(base > 0)) return 0;
        const q = stack?.knapQuality;
        const max = q ? base * knapQualityMult(q) : base;
        return max > 0 ? max : 0;
    }

    function remainingDurability(stack, itemDef) {
        const max = maxDurability(stack, itemDef);
        if (!(max > 0)) return 0;
        if (stack?.durability == null) return max;
        const n = Number(stack.durability);
        if (!Number.isFinite(n)) return max;
        return Math.max(0, Math.min(max, n));
    }

    function durabilityFraction(stack, itemDef) {
        const max = maxDurability(stack, itemDef);
        if (!(max > 0)) return 1;
        return remainingDurability(stack, itemDef) / max;
    }

    /**
     * Subtract uses. Writes stack.durability when worn.
     * @returns {{ broke: boolean }}
     */
    function applyDurabilityUse(stack, amount, itemDef) {
        if (!stack) return { broke: false };
        const max = maxDurability(stack, itemDef);
        if (!(max > 0) || !(amount > 0)) return { broke: false };
        const next = remainingDurability(stack, itemDef) - amount;
        if (next <= 1e-6) {
            delete stack.durability;
            return { broke: true };
        }
        if (next >= max - 1e-6) {
            delete stack.durability;
            return { broke: false };
        }
        stack.durability = next;
        return { broke: false };
    }

    /**
     * Re-knap: keep absolute remaining; clamp down if the new max is lower.
     * Unused tools (no durability field) stay 100% of the new max.
     */
    function carryDurabilityAfterRework(oldStack, newStack, oldDef, newDef) {
        if (!newStack) return newStack;
        if (oldStack?.durability == null) {
            delete newStack.durability;
            return newStack;
        }
        const remaining = remainingDurability(oldStack, oldDef);
        const newMax = maxDurability(newStack, newDef);
        if (!(newMax > 0)) {
            delete newStack.durability;
            return newStack;
        }
        const carried = Math.min(remaining, newMax);
        if (carried >= newMax - 1e-6) delete newStack.durability;
        else newStack.durability = carried;
        return newStack;
    }

    function cloneStackLite(stack) {
        if (!stack) return null;
        const out = { ...stack };
        if (stack.food) out.food = { ...stack.food };
        if (Array.isArray(stack.ingredients)) out.ingredients = stack.ingredients.slice();
        return out;
    }

    /**
     * Wear the stack in inventory[index]. Splits qty>1 so only one instance is used.
     * @returns {{ broke: boolean, leftover: object|null, name: string }}
     */
    function wearInventorySlot(inventory, index, amount, getItem) {
        if (!Array.isArray(inventory) || index < 0) {
            return { broke: false, leftover: null, name: "item" };
        }
        const stack = inventory[index];
        if (!stack) return { broke: false, leftover: null, name: "item" };
        const def = typeof getItem === "function" ? getItem(stack.id) : null;
        const name = stackDisplayName(stack, def);
        if (!(maxDurability(stack, def) > 0)) {
            return { broke: false, leftover: null, name };
        }

        let leftover = null;
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        if (qty > 1) {
            leftover = cloneStackLite(stack);
            leftover.quantity = qty - 1;
            delete leftover.durability;
            stack.quantity = 1;
        }

        const result = applyDurabilityUse(stack, amount, def);
        if (result.broke) inventory[index] = null;
        return { broke: !!result.broke, leftover, name };
    }

    function stackDisplayName(stack, itemDef) {
        return stack?.customName || itemDef?.name || stack?.id || "item";
    }

    function breakMessage(name, held) {
        const n = name || "item";
        return held ? `Your ${n} broke` : `The ${n} broke`;
    }

    /** Slot fill 0–1, or null when the bar should be hidden (100% / none). */
    function slotBarFraction(stack, itemDef) {
        if (!stack) return null;
        const food = stack.food;
        if (food && Number(food.kcFull) > 0) {
            const kc = Number(food.kc);
            const full = Number(food.kcFull);
            if (!Number.isFinite(kc) || !(full > 0)) return null;
            const frac = kc / full;
            if (!(frac < 1)) return null;
            return Math.max(0, Math.min(1, frac));
        }
        const max = maxDurability(stack, itemDef);
        if (!(max > 0)) return null;
        const frac = remainingDurability(stack, itemDef) / max;
        if (!(frac < 1)) return null;
        return Math.max(0, Math.min(1, frac));
    }

    function lerpColor(a, b, u) {
        const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
        const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        const r = Math.round(ar + (br - ar) * u);
        const g = Math.round(ag + (bg - ag) * u);
        const bl = Math.round(ab + (bb - ab) * u);
        return (r << 16) | (g << 8) | bl;
    }

    /** Same red→green ramp as the tend/eat channel bar. */
    function rampBarFillColor(frac) {
        const t = Math.max(0, Math.min(1, Number(frac) || 0));
        const red = 0xD24A43;
        const orange = 0xE67A00;
        const yellow = 0xE6C200;
        const green = 0x3CB043;
        if (t < 0.25) return red;
        if (t < 0.5) return lerpColor(red, orange, (t - 0.25) / 0.25);
        if (t < 0.75) return lerpColor(orange, yellow, (t - 0.5) / 0.25);
        if (t < 0.9) return lerpColor(yellow, green, (t - 0.75) / 0.15);
        return green;
    }

    return {
        COOK_WEAR_PER_MINUTE,
        knapQualityMult,
        maxDurability,
        remainingDurability,
        durabilityFraction,
        applyDurabilityUse,
        carryDurabilityAfterRework,
        wearInventorySlot,
        stackDisplayName,
        breakMessage,
        slotBarFraction,
        rampBarFillColor
    };
});
