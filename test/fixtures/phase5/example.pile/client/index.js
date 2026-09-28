(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory;
    else root.__cpPendingClientFactory = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function (api) {
    function PileThing(scene, entry) {
        this.scene = scene;
        this.entry = entry;
        this.clientKind = true;
        this.listeners = {};
        this.on = (name, fn) => {
            this.listeners[name] = fn;
        };
        this.setInteractive = () => {};
    }
    api.registerThingKind({
        id: "example.pile.station",
        panelId: "example.pile.panel",
        clientClass: PileThing,
        initEntry(def, x, y) {
            return { id: def.id, x, y, pile: true };
        }
    });
    api.registerPanel({
        id: "example.pile.panel",
        open(scene, target) {
            scene.openedPile = target;
        }
    });
    api.registerTexture({
        key: "example.pile.flint_pile",
        url: "mods/example.pile/assets/things/example.pile.flint_pile.png"
    });
    globalThis.__cpClientOrder = globalThis.__cpClientOrder || [];
    globalThis.__cpClientOrder.push(api.modId);
});
