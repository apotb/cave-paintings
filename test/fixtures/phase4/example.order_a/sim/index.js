(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory;
    else root.__cpPendingSimFactory = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function (api) {
    globalThis.__cpScriptOrder = globalThis.__cpScriptOrder || [];
    globalThis.__cpScriptOrder.push(api.modId);
});
