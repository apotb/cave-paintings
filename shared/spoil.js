/**
 * Spoilage helpers — character stacks use spoilLeft (remaining game minutes);
 * world stacks (drops, corpses, campfires) use absolute spoilAt.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        const api = factory();
        root.NetSpoil = api;
        Object.assign(root, api);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function spoilDurationMinutes(item) {
        const hours = item?.food?.spoil;
        if (!hours || hours <= 0) return null;
        return Math.round(hours * 60);
    }

    /** @deprecated Use spoilDurationMinutes */
    function defaultSpoilMinutes(item) {
        return spoilDurationMinutes(item);
    }

    /** Fresh remaining minutes for a character stack. */
    function defaultSpoilLeft(item) {
        const dur = spoilDurationMinutes(item);
        if (dur != null) return dur;
        if (item?.food?.spoil > 0) return Math.round(item.food.spoil * 60);
        return null;
    }

    /** Absolute world-minute when a fresh world stack should spoil. */
    function defaultSpoilAt(item, now) {
        const dur = spoilDurationMinutes(item);
        if (dur == null || now == null) return null;
        return Math.round(now) + dur;
    }

    function remainingSpoilMinutes(spoilAt, now) {
        if (spoilAt == null || now == null) return null;
        return Math.max(0, Math.round(spoilAt) - Math.round(now));
    }

    function spoilAtFromLeft(spoilLeft, now) {
        if (spoilLeft == null || now == null) return null;
        return Math.round(now) + Math.max(0, Math.round(spoilLeft));
    }

    function spoilLeftFromAt(spoilAt, now) {
        if (spoilAt == null || now == null) return null;
        return Math.max(0, Math.round(spoilAt) - Math.round(now));
    }

    /** Absolute spoilAt for depositing a character stack into the world. */
    function spoilAtForWorld(stack, now) {
        if (!stack) return null;
        if (stack.spoilLeft != null) return spoilAtFromLeft(stack.spoilLeft, now);
        if (stack.spoilAt != null) return Math.round(stack.spoilAt);
        return null;
    }

    /** Remaining spoilLeft for taking a world stack into a character. */
    function spoilLeftForCharacter(stack, now) {
        if (!stack) return null;
        if (stack.spoilLeft != null) return Math.max(0, Math.round(stack.spoilLeft));
        if (stack.spoilAt != null) return spoilLeftFromAt(stack.spoilAt, now);
        return null;
    }

    function mergeSpoilAt(countA, atA, countB, atB) {
        if (atA == null && atB == null) return null;
        if (atA == null) return atB;
        if (atB == null) return atA;
        const total = countA + countB;
        if (total <= 0) return Math.round(atA);
        return Math.round((countA * atA + countB * atB) / total);
    }

    /** Quantity-weighted average of remaining spoilLeft values. */
    function mergeSpoilLeft(countA, leftA, countB, leftB) {
        return mergeSpoilAt(countA, leftA, countB, leftB);
    }

    /** @deprecated Use mergeSpoilAt / mergeSpoilLeft */
    function mergeSpoilMinutes(countA, minutesA, countB, minutesB) {
        return mergeSpoilAt(countA, minutesA, countB, minutesB);
    }

    /**
     * Character inventory/equipment stack — uses spoilLeft.
     * @param {number|null|undefined} spoilLeft  remaining minutes; omit for fresh duration
     */
    function makeItemStack(item, quantity, spoilLeft = undefined, _now = null) {
        const stack = { id: item.id, quantity };
        let left = spoilLeft;
        if (left === undefined) left = defaultSpoilLeft(item);
        if (left != null) stack.spoilLeft = Math.max(0, Math.round(left));
        return stack;
    }

    /** World drop/loot/campfire stack — uses spoilAt. */
    function makeWorldItemStack(item, quantity, spoilAt = undefined, now = null) {
        const stack = { id: item.id, quantity };
        let at = spoilAt;
        if (at === undefined) {
            at = defaultSpoilAt(item, now);
            if (at == null && now != null && item?.food?.spoil > 0) {
                at = Math.round(now) + Math.round(item.food.spoil * 60);
            }
        }
        if (at != null) stack.spoilAt = Math.round(at);
        return stack;
    }

    function _foodSpoilHours(stack, meta) {
        return stack?.food?.spoil ?? meta?.food?.spoil;
    }

    /** Character: prefer spoilLeft; migrate spoilAt / spoilMinutes. */
    function migrateToSpoilLeft(stack, now, getItem = null) {
        if (!stack) return stack;
        if (stack.spoilLeft != null) {
            stack.spoilLeft = Math.max(0, Math.round(stack.spoilLeft));
            delete stack.spoilAt;
            delete stack.spoilMinutes;
            return stack;
        }
        if (stack.spoilAt != null && now != null) {
            stack.spoilLeft = spoilLeftFromAt(stack.spoilAt, now);
            delete stack.spoilAt;
            delete stack.spoilMinutes;
            return stack;
        }
        if (stack.spoilMinutes != null) {
            stack.spoilLeft = Math.max(0, Math.round(stack.spoilMinutes));
            delete stack.spoilMinutes;
            return stack;
        }
        if (now == null) return stack;
        const meta = getItem ? getItem(stack.id) : null;
        const foodSpoil = _foodSpoilHours(stack, meta);
        if (foodSpoil > 0) {
            stack.spoilLeft = Math.round(foodSpoil * 60);
        }
        return stack;
    }

    /** World: prefer spoilAt; migrate spoilLeft / spoilMinutes. */
    function migrateToSpoilAt(stack, now, getItem = null) {
        if (!stack || now == null) return stack;
        if (stack.spoilLeft != null) {
            stack.spoilAt = spoilAtFromLeft(stack.spoilLeft, now);
            delete stack.spoilLeft;
            delete stack.spoilMinutes;
            return stack;
        }
        if (stack.spoilAt != null) {
            if (stack.spoilMinutes != null) delete stack.spoilMinutes;
            return stack;
        }
        if (stack.spoilMinutes != null) {
            stack.spoilAt = Math.round(now) + Math.round(stack.spoilMinutes);
            delete stack.spoilMinutes;
            return stack;
        }
        const meta = getItem ? getItem(stack.id) : null;
        const foodSpoil = _foodSpoilHours(stack, meta);
        if (foodSpoil > 0) {
            stack.spoilAt = Math.round(now) + Math.round(foodSpoil * 60);
        }
        return stack;
    }

    /** @deprecated Prefer migrateToSpoilAt (world) or migrateToSpoilLeft (character). */
    function migrateStackSpoil(stack, now, getItem = null) {
        return migrateToSpoilAt(stack, now, getItem);
    }

    /** Decrement character spoilLeft by one game minute. */
    function tickSpoilLeft(stack) {
        if (!stack || stack.spoilLeft == null) return false;
        stack.spoilLeft = Math.max(0, Math.round(stack.spoilLeft) - 1);
        return true;
    }

    /**
     * If due, convert to rot (or strip timer).
     * Character: spoilLeft <= 0. World: now >= spoilAt.
     */
    function spoilStackIfDue(stack, now, rotItem) {
        if (!stack) return { stack, changed: false };
        let due = false;
        if (stack.spoilLeft != null) {
            due = Math.round(stack.spoilLeft) <= 0;
        } else if (stack.spoilAt != null) {
            if (now == null) return { stack, changed: false };
            due = Math.round(now) >= Math.round(stack.spoilAt);
        } else {
            return { stack, changed: false };
        }
        if (!due) return { stack, changed: false };
        if (!rotItem) {
            delete stack.spoilAt;
            delete stack.spoilLeft;
            delete stack.spoilMinutes;
            return { stack, changed: true };
        }
        return { stack: { id: rotItem.id, quantity: stack.quantity }, changed: true };
    }

    function migrateCharacterStacks(stacks, now, getItem = null) {
        if (!stacks) return;
        for (const stack of stacks) {
            if (stack) migrateToSpoilLeft(stack, now, getItem);
        }
    }

    return {
        spoilDurationMinutes,
        defaultSpoilMinutes,
        defaultSpoilLeft,
        defaultSpoilAt,
        remainingSpoilMinutes,
        spoilAtFromLeft,
        spoilLeftFromAt,
        spoilAtForWorld,
        spoilLeftForCharacter,
        mergeSpoilAt,
        mergeSpoilLeft,
        mergeSpoilMinutes,
        makeItemStack,
        makeWorldItemStack,
        migrateToSpoilLeft,
        migrateToSpoilAt,
        migrateStackSpoil,
        tickSpoilLeft,
        spoilStackIfDue,
        migrateCharacterStacks
    };
});
