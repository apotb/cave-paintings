(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory;
    else root.__cpPendingClientFactory = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function (api) {
    function ExampleMarker(scene, entry) {
        return new Thing(scene, entry.x, entry.y, entry.id, entry);
    }
    api.registerThingKind({
        id: "marker",
        panelId: "panel",
        clientClass: ExampleMarker,
        initEntry(def, x, y) {
            return { id: def.id, x, y };
        }
    });
    api.registerPanel({
        id: "panel",
        open(scene) {
            scene.combatLog?.push?.("Example panel.");
        }
    });
    api.registerTexture({
        key: "token",
        url: "assets/items/token.png"
    });
    api.onEvent("chat", function () {});
});
