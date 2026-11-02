/**
 * SAVE PATCH settlingStoneToHearth
 * Rewrites placed Settling Stones into unlit empty Hearths, and item stacks
 * id "settling_stone" into "hearth".
 * Delete this file and its registry line when pre-hearth saves are unsupported.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SavePatch_settlingStoneToHearth = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const FROM = "settling_stone";
    const TO = "hearth";

    function convertStack(stack) {
        if (stack && stack.id === FROM) stack.id = TO;
    }

    function walkLists(host) {
        if (!host || typeof host !== "object") return;
        for (const key of ["inventory", "overflow", "quarantine", "slots", "fuel", "simmer"]) {
            if (!Array.isArray(host[key])) continue;
            for (const stack of host[key]) convertStack(stack);
        }
        convertStack(host.cook);
        convertStack(host.catalyst);
        const eq = host.equipment;
        if (eq && typeof eq === "object") {
            for (const key of ["head", "torso", "legs", "feet", "back"]) convertStack(eq[key]);
            if (Array.isArray(eq.waist)) {
                for (const stack of eq.waist) convertStack(stack);
            }
        }
        if (Array.isArray(host.loot)) {
            for (const stack of host.loot) convertStack(stack);
        }
        if (Array.isArray(host.party)) {
            for (const member of host.party) walkLists(member);
        }
    }

    function convertThing(entry) {
        if (!entry) return;
        walkLists(entry);
        if (entry.id !== FROM) return;
        entry.id = TO;
        entry.lit = false;
        entry.fuel = [null, null];
        entry.cook = null;
        entry.catalyst = null;
        entry.simmer = [null, null, null, null];
        if (entry.cookProgress == null) entry.cookProgress = 0;
        if (entry.burnRemaining == null) entry.burnRemaining = 0;
    }

    function walkPawn(pawn) {
        walkLists(pawn);
    }

    function applyWorld(data) {
        if (!data || typeof data !== "object") return data;
        const chunks = data.chunks;
        if (chunks && typeof chunks === "object") {
            for (const meta of Object.values(chunks)) {
                if (!meta || typeof meta !== "object") continue;
                for (const drop of meta.drops || []) convertStack(drop);
                for (const corpse of meta.corpses || []) {
                    for (const stack of corpse?.loot || []) convertStack(stack);
                }
                for (const entry of meta.things || []) convertThing(entry);
                for (const entry of meta.lootableThings || []) convertThing(entry);
            }
        }
        for (const snap of data.wanderers || []) walkPawn(snap);
        for (const snap of data.settlers || []) walkPawn(snap);
        const players = data.players;
        if (Array.isArray(players)) {
            for (const pawn of players) walkPawn(pawn);
        } else if (players && typeof players === "object") {
            for (const pawn of Object.values(players)) walkPawn(pawn);
        }
        return data;
    }

    function applyCharacter(character) {
        walkPawn(character);
        return character;
    }

    return {
        id: "settlingStoneToHearth",
        applyWorld,
        applyCharacter
    };
});
