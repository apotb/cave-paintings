/**
 * Multiplayer protocol v1 — shared by Node server and browser client.
 * Messages: { v: 1, type: string, payload: object }
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.NetProtocol = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const PROTOCOL_VERSION = 2;

    const Types = {
        AUTH: "auth",
        WELCOME: "welcome",
        REJECT: "reject",
        INPUT_MOVE: "input.move",
        INPUT_ACTION: "input.action",
        SNAPSHOT: "snapshot",
        CHUNK: "chunk",
        EVENT: "event",
        YOU: "you",
        SESSION_END: "session_end",
        PING: "ping",
        PONG: "pong"
    };

    const Actions = {
        CHAT: "chat",
        USE: "use",
        /** Light a campfire from a firestarter (15 sticks + 10 leaves, or relight). */
        LIGHT_FIRE: "light_fire",
        /** Move items between hotbar and a campfire (fuel / cook / utensil), or destroy an unlit one. */
        CAMPFIRE: "campfire",
        /** Place the held placeable item as a world Thing (dedicated MP). */
        PLACE: "place",
        /** Move items between hotbar and a storage Thing, or pick up an empty one. */
        STORAGE: "storage",
        /** Craft a recipe from the crafting menu (dedicated MP). */
        CRAFT: "craft",
        PICKUP: "pickup",
        /** Harvest world lootable (sticks, leaves, bushes, etc.). */
        HARVEST: "harvest",
        /** Debug/admin: spawn a living mob (server-authored in dedicated MP). */
        SPAWN_MOB: "spawn_mob",
        DROP: "drop",
        SPAWN_DROP: "spawn_drop",
        ATTACK: "attack",
        HOTBAR: "hotbar",
        /** Swap / merge two inventory slots (hotbar and/or overflow). Optional fromBag/toBag. */
        INV_SWAP: "inv_swap",
        /** Equip hotbar stack into an equipment slot. */
        EQUIP: "equip",
        /** Unequip a slot into a hotbar index. */
        UNEQUIP: "unequip",
        /** Swap two equipment slots. */
        EQUIP_SWAP: "equip_swap",
        /** Consume a knapping blank / grant the finished tool (dedicated MP). */
        KNAP: "knap",
        RESPAWN: "respawn",
        /** Client anatomy death — server clears gear so YOU cannot restore dumped loot. */
        DIE: "die",
        /** Finish bandaging (dedicated MP; server-authored). */
        TEND: "tend",
        /** Take qty from corpse loot slot (dedicated MP; server-authored). */
        CORPSE_TAKE: "corpse_take",
        /** Finish knife-skinning a corpse (dedicated MP; server-authored). */
        CORPSE_SKIN: "corpse_skin",
        /** Finish scraping a raw hide on a drying rack (dedicated MP; server-authored). */
        RACK_FLESH: "rack_flesh",
        /** Finish rubbing brains into a dehaired hide on a drying rack. */
        RACK_BRAIN: "rack_brain",
        /** Close an empty corpse loot UI — server despawns the corpse. */
        CORPSE_DISMISS: "corpse_dismiss",
        /** Client LivingMob died — server removes chunk mob + authors corpse for remotes. */
        MOB_DEATH: "mob_death",
        COMMAND: "command",
        CANCEL_CHANNEL: "cancel_channel",
        RESYNC: "resync",
        /** Lie down in / wake from / destroy a lean-to. */
        SLEEP: "sleep",
        RECRUIT: "recruit",
        SWITCH_CONTROL: "switch_control",
        PARTY_EAT: "party_eat",
        /** Finish force-feeding a downed party member (dedicated MP). */
        FEED: "feed",
        GIVE_ITEM: "give_item",
        SETTLEMENT: "settlement"
    };

    /**
     * LocalSim SP: the Phaser client already mutated chunk.meta / inventory.
     * Dedicated MP: SimWorld.handleAction owns these verbs.
     */
    const ClientAuthoredActions = Object.freeze([
        Actions.PICKUP,
        Actions.DROP,
        Actions.SPAWN_DROP,
        Actions.PLACE,
        Actions.STORAGE,
        Actions.SLEEP
    ]);

    function msg(type, payload = {}) {
        return { v: PROTOCOL_VERSION, type, payload };
    }

    function parse(raw) {
        let data;
        try {
            data = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {
            return null;
        }
        if (!data || data.v !== PROTOCOL_VERSION || typeof data.type !== "string") return null;
        return data;
    }

    function encode(type, payload) {
        return JSON.stringify(msg(type, payload));
    }

    /** Chat/system death line. Overlay uses first-person separately. */
    function deathMessage(victimName, killerName) {
        const victim = String(victimName || "Player").trim() || "Player";
        const killer = killerName != null ? String(killerName).trim() : "";
        if (killer) return `${victim} was slain by ${killer}`;
        return `${victim} died`;
    }

    return {
        PROTOCOL_VERSION,
        Types,
        Actions,
        ClientAuthoredActions,
        msg,
        parse,
        encode,
        deathMessage,
        DEFAULT_PORT: 21826,
        MAX_PLAYERS: 8,
        SNAPSHOT_HZ: 15,
        MOVE_HZ: 20,
        INTEREST_CHUNKS: 6, // floor; server also uses client-reported view radius
        CHUNK_SIZE: 8,
        TILE_SIZE: 16
    };
});
