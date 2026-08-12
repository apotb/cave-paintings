/**
 * Thin shim — Body / BodyPart provided by shared/body/Body.js (loaded first).
 */
(function () {
    if (typeof Body === "undefined" || typeof BodyPart === "undefined") {
        console.error("js/body/Body.js: load shared/body/Body.js first");
    }
})();
