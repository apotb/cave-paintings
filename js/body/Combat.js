/**
 * Thin shim — BodyCombat provided by shared/body/Combat.js (loaded first).
 */
(function () {
    if (typeof BodyCombat === "undefined") {
        console.error("js/body/Combat.js: load shared/body/Combat.js first");
    }
})();
