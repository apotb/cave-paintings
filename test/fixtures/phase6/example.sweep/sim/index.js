(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory;
    else root.__cpPendingSimFactory = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function (api) {
    api.registerJob({
        id: "example.sweep.tidy",
        label: "Sweep",
        name: "Sweep",
        defaultPriority: 1,
        busy: true,
        plan(state) {
            if (!state.world?.__sweep) return null;
            return { type: "example.sweep.tidy", target: { id: "yard" } };
        },
        perform(ctx) {
            ctx.world.__swept = (ctx.world.__swept || 0) + 1;
            ctx.world.__sweepTarget = ctx.plan && ctx.plan.target && ctx.plan.target.id;
            return { halt: true };
        },
        actLabel() {
            return "Sweeping";
        }
    });
});
