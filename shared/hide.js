/**
 * Animal hide processing — rack accept, fleshing, drying, hang spoilage freeze.
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Hide = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const FLESH_SECONDS = 10;
    const DRY_MINUTES = 1440;

    function hideInfo(itemDef) {
        return itemDef?.hide && typeof itemDef.hide === "object" ? itemDef.hide : null;
    }

    function isHide(itemDef) {
        return !!hideInfo(itemDef);
    }

    function hideStage(itemDef) {
        const stage = hideInfo(itemDef)?.stage;
        return typeof stage === "string" && stage ? stage : null;
    }

    function isRawHide(itemDef) {
        return hideStage(itemDef) === "raw";
    }

    function isFleshedHide(itemDef) {
        return hideStage(itemDef) === "fleshed";
    }

    function isDriedHide(itemDef) {
        return hideStage(itemDef) === "dried";
    }

    function animalId(itemDef) {
        const a = hideInfo(itemDef)?.animal;
        return typeof a === "string" && a ? a : "deer";
    }

    function scrapeResultId(itemDef) {
        if (!isRawHide(itemDef)) return null;
        return `${animalId(itemDef)}_hide_fleshed`;
    }

    function dryResultId(itemDef) {
        if (!isFleshedHide(itemDef)) return null;
        return `${animalId(itemDef)}_hide_dry`;
    }

    function isDryingRack(thingDef, entry) {
        if (thingDef?.dryingRack) return true;
        const id = String(thingDef?.id || entry?.id || "");
        return id === "drying_rack";
    }

    function hangingTextureKey(thingDef) {
        if (thingDef?.hangingKey) return String(thingDef.hangingKey);
        const key = thingDef?.key || "drying_rack";
        return `${key}_hanging`;
    }

    function slotMax(thingDef) {
        const n = Math.floor(Number(thingDef?.storage?.maxPerSlot) || 0);
        return n > 0 ? n : 0;
    }

    function slotAccepts(thingDef, itemDef) {
        const accept = thingDef?.storage?.accept;
        if (accept === "hide") return isHide(itemDef);
        if (isDryingRack(thingDef)) return isHide(itemDef);
        return true;
    }

    function dryProgressOf(stack) {
        const n = Math.floor(Number(stack?.dryProgress) || 0);
        return n > 0 ? n : 0;
    }

    function freezeSpoil(stack, now) {
        if (!stack) return stack;
        let left = null;
        if (stack.spoilLeft != null) left = Math.max(0, Math.round(Number(stack.spoilLeft)));
        else if (stack.spoilAt != null && now != null) {
            left = Math.max(0, Math.round(Number(stack.spoilAt)) - Math.round(Number(now)));
        }
        if (left != null) stack.spoilLeft = left;
        delete stack.spoilAt;
        return stack;
    }

    function hangStack(stack, now, getItem) {
        if (!stack) return stack;
        const def = typeof getItem === "function" ? getItem(stack.id) : null;
        if (!isFleshedHide(def)) delete stack.dryProgress;
        else if (!(dryProgressOf(stack) > 0)) delete stack.dryProgress;
        freezeSpoil(stack, now);
        const max = 1;
        if (stack.quantity > max) stack.quantity = max;
        return stack;
    }

    function fleshedStackFrom(rawStack, getItem, now) {
        const rawDef = typeof getItem === "function" ? getItem(rawStack?.id) : null;
        const resultId = scrapeResultId(rawDef);
        const resultDef = resultId && typeof getItem === "function" ? getItem(resultId) : null;
        if (!resultId || !resultDef) return null;
        const hours = Number(resultDef.food?.spoil) || 0;
        const stack = {
            id: resultId,
            quantity: 1
        };
        if (hours > 0) stack.spoilLeft = Math.round(hours * 60);
        return hangStack(stack, now, getItem);
    }

    function tickDryMinute(stack, getItem) {
        if (!stack) return { stack, changed: false };
        const def = typeof getItem === "function" ? getItem(stack.id) : null;
        if (!isFleshedHide(def)) return { stack, changed: false };
        const next = dryProgressOf(stack) + 1;
        if (next < DRY_MINUTES) {
            stack.dryProgress = next;
            return { stack, changed: true };
        }
        const resultId = dryResultId(def);
        const resultDef = resultId && typeof getItem === "function" ? getItem(resultId) : null;
        if (!resultId || !resultDef) {
            stack.dryProgress = next;
            return { stack, changed: true };
        }
        return {
            stack: { id: resultId, quantity: Math.max(1, Math.floor(Number(stack.quantity) || 1)) },
            changed: true,
            converted: true
        };
    }

    function tickRackEntry(entry, getItem) {
        if (!entry || !Array.isArray(entry.slots)) return { changed: false };
        let changed = false;
        let converted = false;
        for (let i = 0; i < entry.slots.length; i++) {
            const slot = entry.slots[i];
            if (!slot) continue;
            const result = tickDryMinute(slot, getItem);
            if (!result.changed) continue;
            entry.slots[i] = result.stack;
            changed = true;
            if (result.converted) converted = true;
        }
        return { changed, converted };
    }

    return {
        FLESH_SECONDS,
        DRY_MINUTES,
        hideInfo,
        isHide,
        hideStage,
        isRawHide,
        isFleshedHide,
        isDriedHide,
        animalId,
        scrapeResultId,
        dryResultId,
        isDryingRack,
        hangingTextureKey,
        slotMax,
        slotAccepts,
        dryProgressOf,
        freezeSpoil,
        hangStack,
        fleshedStackFrom,
        tickDryMinute,
        tickRackEntry
    };
});
