const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Protocol = require("../shared/protocol");
const Content = require("../shared/mods/content");
const SaveIO = require("../server/SaveIO");
const { GameServer } = require("../server/index");

const ROOT = path.resolve(__dirname, "..");
const WORLD = "phase2-base-join";

Content.boot({ mods: false, root: ROOT });

function fakeWs() {
    return {
        readyState: 1,
        sent: [],
        closed: false,
        send(raw) { this.sent.push(JSON.parse(raw)); },
        close() { this.closed = true; }
    };
}

test("an unmodded host accepts a client that omits content", () => {
    const server = new GameServer({
        worldName: WORLD,
        props: { password: "", "max-players": 8, motd: "" }
    });
    try {
        assert.equal(server.sim.toSaveData().v, 1);
        assert.deepEqual(Content.simMods(), []);
        const ws = fakeWs();
        const meta = { playerId: null, authed: false, knownChunks: new Set(), lastMoveMs: 0 };
        server.clients.set(ws, meta);
        let added = 0;
        const orig = server.session.addPlayer;
        server.session.addPlayer = function (...args) {
            added += 1;
            return orig.apply(this, args);
        };
        server.handleAuth(ws, meta, {
            protocol: Protocol.PROTOCOL_VERSION,
            characterId: "oldclient00001",
            displayName: "Old"
        });
        assert.equal(added, 1);
        assert.equal(ws.closed, false);
        const welcome = ws.sent.find((msg) => msg.type === "welcome");
        assert.ok(welcome);
        assert.deepEqual(welcome.payload.mods, []);
        assert.equal(welcome.payload.contentHash, Content.simHash());
        assert.equal(Protocol.PROTOCOL_VERSION, 2);
    } finally {
        SaveIO.deleteWorld(ROOT, WORLD);
    }
});
