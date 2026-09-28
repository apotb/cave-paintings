const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("node:child_process");
const Loader = require("../shared/mods/loader");
const ModStore = require("../js/net/ModStore");
const modList = require("../electron/modList");

const ALL = "test/fixtures/picker/all";
const MIXED = "test/fixtures/picker/mixed";
const HELPER = path.join(__dirname, "helpers", "boot-report.js");

function bootReport(env) {
    const res = spawnSync(process.execPath, [HELPER], {
        env: { ...process.env, ...env },
        encoding: "utf8"
    });
    if (res.status !== 0) {
        throw new Error(res.stderr || res.stdout || `boot-report exit ${res.status}`);
    }
    return JSON.parse(res.stdout);
}

function manifest(id, extra) {
    return {
        id,
        name: id,
        version: "1.0.0",
        gameVersion: ">=0.3.1",
        dependencies: [],
        loadPriority: 0,
        ...extra
    };
}

function file(rel, text) {
    return { path: rel, bytes: Buffer.from(text) };
}

describe("mod picker", { concurrency: false }, () => {
    test("enabled, disabled, empty, and omitted boots", () => {
        const none = bootReport({ CP_MODS_DIR: ALL, CP_ENABLED: "[]" });
        const base = bootReport({ CP_MODS_DIR: ALL, CP_ENABLED: "mods-false" });
        const onlyA = bootReport({ CP_MODS_DIR: ALL, CP_ENABLED: JSON.stringify(["example.picker_a"]) });
        const all = bootReport({ CP_MODS_DIR: ALL });
        assert.deepEqual(none.items, []);
        assert.deepEqual(none.mods, []);
        assert.deepEqual(none.clientScripts, []);
        assert.equal(none.simBytes["example.picker_a"], 0);
        assert.equal(none.hash, base.hash);
        assert.deepEqual(onlyA.items, ["example.picker_a.token"]);
        assert.deepEqual(onlyA.mods, [{ id: "example.picker_a", version: "1.0.0" }]);
        assert.deepEqual(onlyA.clientScripts, ["example.picker_a"]);
        assert.equal(onlyA.simBytes["example.picker_b"], 0);
        assert.ok(onlyA.simBytes["example.picker_a"] > 0);
        assert.notEqual(onlyA.hash, none.hash);
        assert.equal(onlyA.scripts.length, 1);
        assert.equal(onlyA.scripts[0].modId, "example.picker_a");
        assert.match(onlyA.scripts[0].sha256, /^[a-f0-9]{64}$/);
        assert.deepEqual(all.mods.map((row) => row.id), ["example.picker_a", "example.picker_b"]);
        assert.deepEqual(all.items.slice().sort(), ["example.picker_a.token", "example.picker_b.token"]);
    });

    test("a disabled mod with broken data is not read", () => {
        const selected = bootReport({
            CP_MODS_DIR: MIXED,
            CP_ENABLED: JSON.stringify(["example.picker_ok"])
        });
        assert.deepEqual(selected.items, ["example.picker_ok.token"]);
        assert.throws(() => bootReport({ CP_MODS_DIR: MIXED }), /items\.json/);
    });

    test("sim scripts run only for the enabled mod on the host", () => {
        const quiet = bootReport({
            CP_MODS_DIR: ALL,
            CP_ENABLED: JSON.stringify(["example.picker_a"])
        });
        assert.equal(quiet.ran, null);
        assert.ok(quiet.simBytes["example.picker_a"] > 0);
        const ran = bootReport({
            CP_MODS_DIR: ALL,
            CP_ENABLED: JSON.stringify(["example.picker_a"]),
            CP_EXEC: "1"
        });
        assert.deepEqual(ran.ran, ["example.picker_a"]);
    });

    test("a second boot ignores a different enabled list", () => {
        const body = bootReport({
            CP_MODS_DIR: ALL,
            CP_ENABLED: JSON.stringify(["example.picker_a"]),
            CP_AGAIN: JSON.stringify(["example.picker_a", "example.picker_b"])
        });
        assert.equal(body.sameHash, true);
        assert.equal(body.sameMods, true);
        assert.deepEqual(body.items, ["example.picker_a.token"]);
    });

    test("an installed-but-disabled mod fails the existing join check", () => {
        const client = bootReport({ CP_MODS_DIR: ALL, CP_ENABLED: "[]" });
        const host = bootReport({
            CP_MODS_DIR: ALL,
            CP_ENABLED: JSON.stringify(["example.picker_a"]),
            CP_CLIENT_HASH: client.hash,
            CP_CLIENT_MODS: JSON.stringify(client.mods)
        });
        assert.equal(host.accept.ok, false);
        assert.match(host.accept.reason, /Mod mismatch/);
        assert.match(host.accept.reason, /example\.picker_a@1\.0\.0/);
    });

    test("enabled ids persist across a new store, and a rejected toggle does not write", async () => {
        const mem = ModStore.memoryAdapter();
        const store = ModStore.create({ adapter: mem, gameVersion: "0.3.1" });
        const rows = [
            { id: "example.picker_a", name: "A", version: "1.0.0", gameVersion: ">=0.3.1", dependencies: [], source: "installed", error: "" },
            { id: "example.picker_b", name: "B", version: "1.0.0", gameVersion: ">=0.3.1", dependencies: ["example.picker_a"], source: "installed", error: "" }
        ];
        const missing = store.trySetEnabled(rows, [], "example.picker_b", true);
        assert.equal(missing.ok, false);
        assert.match(missing.reason, /example\.picker_a/);
        assert.deepEqual(missing.ids, []);
        assert.deepEqual((await store.enabled()).ids, []);
        const onA = store.trySetEnabled(rows, [], "example.picker_a", true);
        assert.equal(onA.ok, true);
        const blocked = store.trySetEnabled(rows, ["example.picker_a", "example.picker_b"], "example.picker_a", false);
        assert.equal(blocked.ok, false);
        assert.match(blocked.reason, /example\.picker_b/);
        await store.setEnabled(["example.picker_a", "example.picker_b"]);
        const again = ModStore.create({ adapter: mem, gameVersion: "0.3.1" });
        assert.deepEqual((await again.enabled()).ids, ["example.picker_a", "example.picker_b"]);
        await again.setEnabled([]);
        const empty = ModStore.create({ adapter: mem, gameVersion: "0.3.1" });
        assert.deepEqual((await empty.enabled()).ids, []);
    });

    test("dependency order does not follow enable order", () => {
        const a = { id: "example.picker_a", label: "a", loadPriority: 0, dependencies: [] };
        const b = { id: "example.picker_b", label: "b", loadPriority: 0, dependencies: ["example.picker_a"] };
        assert.deepEqual(
            Loader.orderMods([b, a]).map((row) => row.id),
            Loader.orderMods([a, b]).map((row) => row.id)
        );
        const cycle = ModStore.preflight([
            { id: "example.cycle_a", dependencies: ["example.cycle_b"], error: "" },
            { id: "example.cycle_b", dependencies: ["example.cycle_a"], error: "" }
        ], ["example.cycle_a", "example.cycle_b"]);
        assert.equal(cycle.ok, false);
        assert.match(cycle.reason, /cycle/i);
    });

    test("invalid uploads are rejected without execution and a valid upload persists", async () => {
        const mem = ModStore.memoryAdapter();
        const store = ModStore.create({ adapter: mem, gameVersion: "0.3.1" });
        const sim = "(function (root, factory) {\n"
            + "if (typeof module === \"object\" && module.exports) module.exports = factory;\n"
            + "else root.__cpPendingSimFactory = factory;\n"
            + "})(typeof globalThis !== \"undefined\" ? globalThis : this, function () {\n"
            + "globalThis.__cpUploadRan = true;\n"
            + "});\n";
        await assert.rejects(() => store.addUpload([file("mod.json", "{")]), /mod\.json/);
        await assert.rejects(() => store.addUpload([
            file("mod.json", JSON.stringify(manifest("Nope")))
        ]), /Invalid mod id/);
        await assert.rejects(() => store.addUpload([
            file("mod.json", JSON.stringify(manifest("example.upload", { gameVersion: ">=99.0.0" })))
        ]), /gameVersion/);
        await assert.rejects(() => store.addUpload([
            file("mod.json", JSON.stringify(manifest("example.upload"))),
            file("sim/index.js", sim)
        ], [{ id: "example.upload", dir: "example.upload", source: "installed" }]), /Duplicate mod id "example\.upload"/);
        await assert.rejects(() => store.addUpload([file("readme.txt", "hi")]), /one mod\.json/);
        assert.equal(globalThis.__cpPendingSimFactory, undefined);
        assert.equal(globalThis.__cpUploadRan, undefined);
        const pkg = await store.addUpload([
            file("mod.json", JSON.stringify(manifest("example.upload"))),
            file("data/items.json", JSON.stringify([
                { id: "example.upload.token", name: "Up", key: "example.upload.token" }
            ])),
            file("sim/index.js", sim)
        ]);
        assert.equal(pkg.id, "example.upload");
        const reopened = ModStore.create({ adapter: mem, gameVersion: "0.3.1" });
        const listed = await reopened.discover();
        assert.equal(listed.some((row) => row.id === "example.upload" && row.source === "uploaded"), true);
        const packs = await reopened.packsForBoot(["example.upload"]);
        assert.equal(packs.length, 1);
        const extra = packs.map((pack) => ({
            ...pack,
            simScriptBytesB64: Buffer.from(pack.simScriptBytes).toString("base64"),
            simScriptBytes: undefined
        }));
        const loaded = bootReport({
            CP_MODS_DIR: ALL,
            CP_ENABLED: "[]",
            CP_EXTRA: JSON.stringify(extra)
        });
        assert.deepEqual(loaded.items, ["example.upload.token"]);
        assert.ok(loaded.simBytes["example.upload"] > 0);
        assert.equal(loaded.simBytes["example.picker_a"], 0);
        await reopened.remove("example.upload");
        const gone = ModStore.create({ adapter: mem, gameVersion: "0.3.1" });
        assert.equal((await gone.discover()).some((row) => row.id === "example.upload"), false);
        assert.deepEqual((await gone.enabled()).ids, []);
    });

    test("changing the selection before a world asks for a reload", async () => {
        const mem = ModStore.memoryAdapter();
        const store = ModStore.create({ adapter: mem, gameVersion: "0.3.1" });
        assert.equal(store.needsReload(["example.picker_a"]), false);
        assert.deepEqual((await store.enabled()).ids, []);
        const saved = await store.setEnabled(["example.picker_a"]);
        assert.equal(saved.reloadRequired, true);
        assert.equal(store.needsReload(["example.picker_a"]), true);
        assert.equal(store.needsReload([]), false);
    });

    test("changing the selection after boot saves it and asks for a reload", async () => {
        const mem = ModStore.memoryAdapter();
        const store = ModStore.create({ adapter: mem, gameVersion: "0.3.1" });
        store.noteBoot(["example.picker_a"]);
        const saved = await store.setEnabled(["example.picker_b"]);
        assert.equal(saved.reloadRequired, true);
        assert.deepEqual((await store.enabled()).ids, ["example.picker_b"]);
        const Content = require("../shared/mods/content");
        assert.equal(Content.isFinalized(), false);
        assert.equal(store.needsReload(["example.picker_b"]), true);
        assert.equal(store.needsReload(["example.picker_a"]), false);
    });

    test("electron discovery keeps a valid mod beside a broken one, and the enabled file persists", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cp-mods-"));
        const good = path.join(root, "example.good");
        const bad = path.join(root, "example.bad");
        fs.mkdirSync(good);
        fs.mkdirSync(bad);
        fs.writeFileSync(path.join(good, "mod.json"), JSON.stringify(manifest("example.good_mod")));
        fs.writeFileSync(path.join(bad, "mod.json"), "{");
        const rows = modList.scanModRoots([root], fs);
        const valid = rows.find((row) => row.id === "example.good_mod");
        const broken = rows.find((row) => row.dir === "example.bad");
        assert.ok(valid);
        assert.equal(valid.error, "");
        assert.match(broken.error, /mod\.json/);
        const dupA = path.join(root, "example.dup_a");
        const dupB = path.join(root, "example.dup_b");
        fs.mkdirSync(dupA);
        fs.mkdirSync(dupB);
        fs.writeFileSync(path.join(dupA, "mod.json"), JSON.stringify(manifest("example.dup_mod")));
        fs.writeFileSync(path.join(dupB, "mod.json"), JSON.stringify(manifest("example.dup_mod")));
        const dups = modList.scanModRoots([root], fs).filter((row) => row.id === "example.dup_mod");
        assert.equal(dups.length, 2);
        assert.match(dups[0].error, /Duplicate mod id "example\.dup_mod"/);
        assert.match(dups[1].error, /example\.dup_a and example\.dup_b|example\.dup_b and example\.dup_a/);
        const file = path.join(root, "mods-enabled.json");
        assert.deepEqual(modList.readEnabledFile(fs, file).ids, []);
        modList.writeEnabledFile(fs, file, { ids: ["example.good_mod", 3, "example.good_mod"] });
        assert.deepEqual(modList.readEnabledFile(fs, file), { ids: ["example.good_mod", "example.good_mod"] });
    });
});
