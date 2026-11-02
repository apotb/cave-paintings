/**
 * SAVE PATCHES
 * One registry for load-time save rewrites. Delete a patch file, its line
 * below, and these apply calls when that save shape is no longer loaded.
 */
(function (root, factory) {
    const list = typeof module === "object" && module.exports
        ? [require("./settlingStoneToHearth")]
        : [root.SavePatch_settlingStoneToHearth].filter(Boolean);
    const api = factory(list);
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.Patches = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (PATCHES) {
    function applyWorld(data) {
        if (!data) return data;
        for (const patch of PATCHES) patch?.applyWorld?.(data);
        return data;
    }

    function applyCharacter(character) {
        if (!character) return character;
        for (const patch of PATCHES) patch?.applyCharacter?.(character);
        return character;
    }

    return { applyWorld, applyCharacter, PATCHES };
});
