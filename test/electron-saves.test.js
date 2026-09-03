const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const saves = require("../electron/saves");

describe("electron/saves", () => {
    let root;

    before(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cp-saves-"));
    });

    after(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("rejects path-traversal ids", async () => {
        await assert.rejects(() => saves.put(root, "characters", { id: "../x", name: "no" }));
        await assert.rejects(() => saves.put(root, "worlds", { id: "a/b", name: "no" }));
        await assert.rejects(() => saves.put(root, "nope", { id: "ok" }));
    });

    it("writes and lists character json", async () => {
        const row = { id: "c-test-1", name: "Ugg", favorite: true, updatedAt: 2 };
        await saves.put(root, "characters", row);
        const got = await saves.get(root, "characters", "c-test-1");
        assert.equal(got.name, "Ugg");
        const list = await saves.list(root, "characters");
        assert.equal(list.length, 1);
        assert.equal(list[0].id, "c-test-1");
        await saves.remove(root, "characters", "c-test-1");
        assert.equal(await saves.get(root, "characters", "c-test-1"), null);
    });

    it("overwrites a world atomically", async () => {
        const id = "w-test-1";
        await saves.put(root, "worlds", { id, name: "A", chunks: { "0,0": { x: 0 } } });
        await saves.put(root, "worlds", { id, name: "B", chunks: {} });
        const got = await saves.get(root, "worlds", id);
        assert.equal(got.name, "B");
        assert.deepEqual(got.chunks, {});
    });

    it("writes options.json", async () => {
        const next = await saves.writeOptions(root, { guiScale: 2, musicVolume: 40 });
        assert.equal(next.guiScale, 2);
        assert.equal(next.musicVolume, 40);
        assert.equal(next.fullscreen, false);
        const got = saves.readOptions(root);
        assert.deepEqual(got, next);
        const fs = await saves.writeOptions(root, { guiScale: 2, musicVolume: 40, fullscreen: true });
        assert.equal(fs.fullscreen, true);
    });

    it("migrates legacy characters/worlds into save/", async () => {
        const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cp-legacy-"));
        const saveRoot = path.join(userData, "save");
        fs.mkdirSync(path.join(userData, "characters"), { recursive: true });
        fs.writeFileSync(path.join(userData, "characters", "c1.json"), JSON.stringify({ id: "c1" }));
        await saves.ensureRoot(saveRoot);
        assert.equal(fs.existsSync(path.join(saveRoot, "characters", "c1.json")), true);
        assert.equal(fs.existsSync(path.join(userData, "characters")), false);
        assert.equal(fs.existsSync(path.join(saveRoot, "options.json")), true);
        fs.rmSync(userData, { recursive: true, force: true });
    });
});
