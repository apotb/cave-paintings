(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory;
    else root.__cpPendingClientFactory = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function (api) {
    globalThis.__cpClientOrder = globalThis.__cpClientOrder || [];
    globalThis.__cpClientOrder.push(api.modId);
});
