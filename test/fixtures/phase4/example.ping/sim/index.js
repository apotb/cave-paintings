(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory;
    else root.__cpPendingSimFactory = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function (api) {
    globalThis.__cpScriptOrder = globalThis.__cpScriptOrder || [];
    globalThis.__cpScriptOrder.push(api.modId);
    api.registerAction({
        type: "example.ping",
        handle(world, session, action) {
            if (action && action.boom) throw new Error("ping failed");
            world.__ping = (world.__ping || 0) + 1;
            world.__pingSessionId = session && session.id;
        }
    });
    api.registerAction({
        type: "example.ping_ok",
        handle(world) {
            world.__pingOk = (world.__pingOk || 0) + 1;
        }
    });
});
