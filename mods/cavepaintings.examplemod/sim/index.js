(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory;
    else root.__cpPendingSimFactory = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function (api) {
    api.registerAction({
        type: "ping",
        handle() {}
    });
    api.registerJob({
        id: "note",
        label: "Ex",
        name: "Example",
        defaultPriority: 0,
        plan() { return null; },
        perform() { return { halt: true }; },
        actLabel() { return "Example"; }
    });
});
