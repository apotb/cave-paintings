/**
 * Animal hide processing — rack accept, fleshing, drying, soak, brain-tan.
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
    const BRAIN_SECONDS = 10;
    const DRY_MINUTES = 1440;
    const SOAK_MINUTES = 720;

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

    function isSoakedHide(itemDef) {
        return hideStage(itemDef) === "soaked";
    }

    function isDehairedHide(itemDef) {
        return hideStage(itemDef) === "dehaired";
    }

    function isBrainedHide(itemDef) {
        return hideStage(itemDef) === "brained";
    }

    function isLeather(itemDef) {
        return hideStage(itemDef) === "leather";
    }

    function isBrainItem(itemDef) {
        return !!itemDef?.brain;
    }

    function canonicalItemId(id) {
        if (id === "deer_brain") return "brain";
        if (id === "wood_spear") return "wooden_spear";
        return id;
    }

    function migrateStackItemId(stack) {
        if (!stack?.id) return stack;
        const next = canonicalItemId(stack.id);
        if (next !== stack.id) stack.id = next;
        return stack;
    }

    function stackIsHideStage(stack, stage, getItem) {
        if (!stack || !stage) return false;
        const def = typeof getItem === "function" ? getItem(stack.id) : null;
        return hideStage(def) === stage;
    }

    function animalId(itemDef) {
        const a = hideInfo(itemDef)?.animal;
        return typeof a === "string" && a ? a : "deer";
    }

    function scrapeResultId(itemDef) {
        if (isRawHide(itemDef)) return `${animalId(itemDef)}_hide_fleshed`;
        if (isSoakedHide(itemDef)) return `${animalId(itemDef)}_hide_dehaired`;
        return null;
    }

    function canScrape(itemDef) {
        return !!scrapeResultId(itemDef);
    }

    function dryResultId(itemDef) {
        if (!isFleshedHide(itemDef)) return null;
        return `${animalId(itemDef)}_hide_dry`;
    }

    function soakResultId(itemDef) {
        if (!isFleshedHide(itemDef)) return null;
        return `${animalId(itemDef)}_hide_soaked`;
    }

    function brainResultId(itemDef) {
        if (!isDehairedHide(itemDef)) return null;
        return `${animalId(itemDef)}_hide_brained`;
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

    function dryPercent(stack) {
        const max = DRY_MINUTES;
        if (!(max > 0)) return 0;
        return Math.max(0, Math.min(100, Math.floor((dryProgressOf(stack) / max) * 100)));
    }

    function soakProgressOf(stack) {
        const n = Math.floor(Number(stack?.soakProgress) || 0);
        return n > 0 ? n : 0;
    }

    function soakPercent(stack, now) {
        const max = SOAK_MINUTES;
        if (!(max > 0)) return 0;
        let prog = soakProgressOf(stack);
        if (stack?.soakDoneAt != null && now != null) {
            const left = Math.max(0, Math.round(Number(stack.soakDoneAt)) - Math.round(Number(now)));
            prog = Math.max(0, max - left);
        }
        return Math.max(0, Math.min(100, Math.floor((prog / max) * 100)));
    }

    /** Quantity-weighted average of dryProgress (missing = 0), same as spoil merge. */
    function mergeDryProgress(countA, progA, countB, progB) {
        const a = Math.max(0, Math.floor(Number(progA) || 0));
        const b = Math.max(0, Math.floor(Number(progB) || 0));
        const ca = Math.max(0, Number(countA) || 0);
        const cb = Math.max(0, Number(countB) || 0);
        const total = ca + cb;
        if (total <= 0) return a;
        return Math.round((ca * a + cb * b) / total);
    }

    function applyMergedDryProgress(dest, destCount, addCount, addProgress) {
        if (!dest) return dest;
        const merged = mergeDryProgress(destCount, dest.dryProgress, addCount, addProgress);
        if (merged > 0) dest.dryProgress = merged;
        else delete dest.dryProgress;
        return dest;
    }

    function applyMergedSoakProgress(dest, destCount, addCount, addProgress) {
        if (!dest) return dest;
        const merged = mergeDryProgress(destCount, dest.soakProgress, addCount, addProgress);
        if (merged > 0) dest.soakProgress = merged;
        else delete dest.soakProgress;
        return dest;
    }

    function mergeSoakDoneAt(countA, doneA, countB, doneB) {
        const ca = Math.max(0, Number(countA) || 0);
        const cb = Math.max(0, Number(countB) || 0);
        const total = ca + cb;
        if (doneA == null && doneB == null) return null;
        if (doneA == null) return doneB;
        if (doneB == null) return doneA;
        if (total <= 0) return doneA;
        return Math.round((ca * Number(doneA) + cb * Number(doneB)) / total);
    }

    function soakMergeBlocked(existing, incoming) {
        const a = existing?.soakDoneAt != null;
        const b = incoming?.soakDoneAt != null;
        return a !== b;
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
        delete stack.soakDoneAt;
        freezeSpoil(stack, now);
        const max = 1;
        if (stack.quantity > max) stack.quantity = max;
        return stack;
    }

    function _stageStackFrom(srcStack, resultId, getItem, now) {
        const resultDef = resultId && typeof getItem === "function" ? getItem(resultId) : null;
        if (!resultId || !resultDef) return null;
        const hours = Number(resultDef.food?.spoil) || 0;
        const qty = Math.max(1, Math.floor(Number(srcStack?.quantity) || 1));
        const stack = {
            id: resultId,
            quantity: qty
        };
        if (hours > 0) stack.spoilLeft = Math.round(hours * 60);
        return hangStack(stack, now, getItem);
    }

    function scrapeStackFrom(srcStack, getItem, now) {
        const def = typeof getItem === "function" ? getItem(srcStack?.id) : null;
        return _stageStackFrom(srcStack, scrapeResultId(def), getItem, now);
    }

    function fleshedStackFrom(rawStack, getItem, now) {
        return scrapeStackFrom(rawStack, getItem, now);
    }

    function brainedStackFrom(srcStack, getItem, now) {
        const def = typeof getItem === "function" ? getItem(srcStack?.id) : null;
        return _stageStackFrom(srcStack, brainResultId(def), getItem, now);
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

    function dropSamplePoint(x, y, tileSize) {
        const ts = Number(tileSize) > 0 ? Number(tileSize) : 16;
        const w = ts * 0.7;
        return {
            x: Number(x) + w * 0.5,
            y: Number(y) - 1
        };
    }

    function beginSoak(stack, now) {
        if (!stack || now == null) return stack;
        if (stack.soakDoneAt != null) {
            freezeSpoil(stack, now);
            return stack;
        }
        const done = soakProgressOf(stack);
        const left = Math.max(1, SOAK_MINUTES - done);
        stack.soakDoneAt = Math.round(Number(now)) + left;
        delete stack.soakProgress;
        freezeSpoil(stack, now);
        return stack;
    }

    function pickupSoak(stack, now) {
        if (!stack) return stack;
        if (stack.soakDoneAt != null && now != null) {
            const left = Math.max(0, Math.round(Number(stack.soakDoneAt)) - Math.round(Number(now)));
            const prog = Math.max(0, SOAK_MINUTES - left);
            if (prog > 0 && prog < SOAK_MINUTES) stack.soakProgress = prog;
            else delete stack.soakProgress;
            delete stack.soakDoneAt;
        }
        return stack;
    }

    function pausesDropDespawn(stack, itemDef, onWater) {
        if (!onWater || !stack) return false;
        if (isFleshedHide(itemDef) || isSoakedHide(itemDef)) return true;
        return false;
    }

    /** Fleshed hides in water are soaking — haulers must not scoop them back up. */
    function leaveHaulInWater(itemDef, onWater) {
        return !!onWater && isFleshedHide(itemDef);
    }

    function tickSoakDrop(entry, now, getItem, onWater) {
        if (!entry) return { changed: false };
        const def = typeof getItem === "function" ? getItem(entry.id) : null;
        if (!onWater) {
            const had = entry.soakDoneAt != null;
            pickupSoak(entry, now);
            return { changed: had && entry.soakDoneAt == null };
        }
        if (isSoakedHide(def)) {
            freezeSpoil(entry, now);
            if (entry.soakDoneAt != null || entry.soakProgress != null) {
                delete entry.soakDoneAt;
                delete entry.soakProgress;
                return { changed: true };
            }
            return { changed: false };
        }
        if (!isFleshedHide(def)) {
            const had = entry.soakDoneAt != null;
            pickupSoak(entry, now);
            return { changed: had && entry.soakDoneAt == null };
        }
        beginSoak(entry, now);
        if (now == null || entry.soakDoneAt == null) return { changed: true };
        if (Math.round(Number(now)) < Math.round(Number(entry.soakDoneAt))) {
            return { changed: true };
        }
        const resultId = soakResultId(def);
        const resultDef = resultId && typeof getItem === "function" ? getItem(resultId) : null;
        if (!resultId || !resultDef) return { changed: true };
        const qty = Math.max(1, Math.floor(Number(entry.quantity) || 1));
        entry.id = resultId;
        entry.quantity = qty;
        delete entry.soakDoneAt;
        delete entry.soakProgress;
        delete entry.dryProgress;
        const hours = Number(resultDef.food?.spoil) || 0;
        if (hours > 0) entry.spoilLeft = Math.round(hours * 60);
        else delete entry.spoilLeft;
        delete entry.spoilAt;
        freezeSpoil(entry, now);
        return { changed: true, converted: true };
    }

    return {
        FLESH_SECONDS,
        BRAIN_SECONDS,
        DRY_MINUTES,
        SOAK_MINUTES,
        hideInfo,
        isHide,
        hideStage,
        isRawHide,
        isFleshedHide,
        isDriedHide,
        isSoakedHide,
        isDehairedHide,
        isBrainedHide,
        isLeather,
        isBrainItem,
        canonicalItemId,
        migrateStackItemId,
        stackIsHideStage,
        animalId,
        scrapeResultId,
        canScrape,
        dryResultId,
        soakResultId,
        brainResultId,
        isDryingRack,
        hangingTextureKey,
        slotMax,
        slotAccepts,
        dryProgressOf,
        dryPercent,
        soakProgressOf,
        soakPercent,
        mergeDryProgress,
        applyMergedDryProgress,
        applyMergedSoakProgress,
        mergeSoakDoneAt,
        soakMergeBlocked,
        freezeSpoil,
        hangStack,
        scrapeStackFrom,
        fleshedStackFrom,
        brainedStackFrom,
        tickDryMinute,
        tickRackEntry,
        dropSamplePoint,
        beginSoak,
        pickupSoak,
        pausesDropDespawn,
        leaveHaulInWater,
        tickSoakDrop
    };
});
