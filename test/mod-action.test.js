const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Hash = require("../shared/mods/hash");
const Content = require("../shared/mods/content");
const Actions = require("../shared/mods/actions");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "test", "fixtures", "phase4");

Content.boot({ root: ROOT, modsDir: FIXTURE });

const { SimWorld } = require("../shared/sim/SimWorld");

function hexTail(hex) {
    return hex.endsWith("a") ? "b" : "a";
}

describe("phase 4 sim scripts", { concurrency: false }, () => {
    test("raw bytes hash non-ASCII and 0xFF the same way in Node and the browser digest", async () => {
        const accent = Buffer.from("example.ping é", "utf8");
        const accentFlipped = Buffer.from(accent);
        accentFlipped[accentFlipped.length - 1] ^= 0x01;
        assert.ok(accent.includes(0xc3));
        assert.notEqual(Hash.sha256Bytes(accent), Hash.sha256Bytes(accentFlipped));

        const raw = Uint8Array.from([0x68, 0x69, 0xff]);
        const changed = Uint8Array.from([0x68, 0x69, 0x00]);
        const replaced = new TextEncoder().encode("hi\uFFFD");
        const rawHex = Hash.sha256Bytes(raw);
        assert.notEqual(rawHex, Hash.sha256Bytes(changed));
        assert.notEqual(rawHex, Hash.sha256Bytes(replaced));
        assert.equal(rawHex, await Hash.sha256BytesSubtle(raw));
        assert.equal(Hash.sha256Bytes(accent), await Hash.sha256BytesSubtle(accent));

        const snap = Content.snapshot();
        const changedScripts = {
            ...snap,
            scripts: snap.scripts.map((row) => ({
                ...row,
                sha256: row.sha256.slice(0, -1) + hexTail(row.sha256)
            }))
        };
        assert.notEqual(Hash.simHash(changedScripts), Content.simHash());
        assert.deepEqual(changedScripts.mods.map((mod) => mod.version), snap.mods.map((mod) => mod.version));
    });

    test("scripts register before SimWorld, and a thrown handler does not stop the next action", () => {
        const net = fs.readFileSync(path.join(ROOT, "js", "net", "NetClient.js"), "utf8");
        const menu = fs.readFileSync(path.join(ROOT, "js", "net", "SceneMenu.js"), "utf8");
        assert.equal(net.includes("loadSimScripts"), false);
        assert.equal(menu.includes("loadSimScripts"), false);

        const bytes = Content.readSimScriptBytes("example.ping");
        assert.ok(bytes instanceof Uint8Array);
        assert.equal(globalThis.__cpScriptOrder, undefined);
        assert.equal(Actions.has("example.ping"), false);
        const hashed = Hash.sha256Bytes(bytes);
        const recorded = Content.simDocument().scripts.find((row) => row.modId === "example.ping");
        assert.equal(recorded.sha256, hashed);

        Actions.registerAction("example.one", {
            type: "example.shared",
            handle() {}
        });
        assert.throws(
            () => Actions.registerAction("example.two", { type: "example.shared", handle() {} }),
            /Duplicate action "example\.shared" \(example\.one and example\.two\)/
        );
        assert.throws(
            () => Actions.registerAction("example.bad", { type: "chat", handle() {} }),
            /example\.bad: action "chat" collides with a built-in protocol action/
        );
        Actions.reset();

        let constructed = false;
        Content.loadSimScripts();
        assert.deepEqual(globalThis.__cpScriptOrder, [
            "example.order_a",
            "example.order_c",
            "example.ping",
            "example.order_b"
        ]);
        assert.equal(Actions.has("example.ping"), true);
        assert.equal(constructed, false);

        const world = SimWorld.createNew({ worldName: "phase4" });
        constructed = true;
        const pawn = world.addPlayer("ping0000000001", "Ping", null, { silentJoin: true });
        assert.doesNotThrow(() => {
            world.handleAction(pawn.id, { type: "example.ping", boom: true });
            world.handleAction(pawn.id, { type: "example.ping_ok" });
            world.handleAction(pawn.id, { type: "example.ping" });
            world.handleAction(pawn.id, { type: "no.such.action" });
            world.handleAction(pawn.id, { type: "chat", text: "still here" });
        });
        assert.equal(world.__pingOk, 1);
        assert.equal(world.__ping, 1);
        assert.equal(world.__pingSessionId, pawn.id);
        assert.ok(world._events.some((ev) => ev.kind === "chat" && String(ev.text).includes("still here")));
        assert.equal(constructed, true);
    });
});
