(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory;
    else root.__cpPendingSimFactory = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function (api) {
    api.registerAction({
        type: "example.pile.chip",
        handle(world, session, action) {
            world.__pileChips = (world.__pileChips || 0) + 1;
            world.__pileThing = action && action.thingId;
            world.__pileSession = session && session.id;
        }
    });
});
