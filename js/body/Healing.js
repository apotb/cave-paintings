/**
 * Thin shim — BodyHealing provided by shared/body/Healing.js (loaded first).
 */
(function () {
    if (typeof BodyHealing === "undefined") {
        console.error("js/body/Healing.js: load shared/body/Healing.js first");
    }
})();
