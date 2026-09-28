const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Scaffold = require("../shared/mods/scaffold");
const modList = require("../electron/modList");

function fields(extra) {
    return {
        name: "Example Mod",
        author: "Cave Paintings",
        version: "1.0.0",
        description: "A short line",
        gameVersion: ">=0.3.2",
        ...extra
    };
}

function readZipEntry(buf) {
    assert.equal(buf.readUInt32LE(0), 0x04034b50);
    assert.equal(buf.readUInt16LE(8), 0);
    const crc = buf.readUInt32LE(14);
    const size = buf.readUInt32LE(18);
    assert.equal(buf.readUInt32LE(22), size);
    const nameLen = buf.readUInt16LE(26);
    const extra = buf.readUInt16LE(28);
    const name = buf.slice(30, 30 + nameLen).toString("utf8");
    const data = buf.slice(30 + nameLen + extra, 30 + nameLen + extra + size);
    assert.equal(Scaffold.crc32(data), crc);
    let entries = 0;
    for (let i = 0; i < buf.length - 3; i++) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            entries = buf.readUInt16LE(i + 10);
            break;
        }
    }
    assert.equal(entries, 1);
    return { name, text: data.toString("utf8") };
}

describe("mod create", () => {
    test("slug, rejection, and manifest", () => {
        assert.equal(Scaffold.suggestId("Cave Paintings", "Example Mod"), "cavepaintings.examplemod");
        assert.equal(Scaffold.suggestId("Cave_Paintings", "Example Mod"), "cavepaintings.examplemod");
        assert.equal(Scaffold.suggestId("", ""), "");
        assert.equal(Scaffold.idProblem("2cool.mod"), Scaffold.REASONS.idDigit);
        assert.equal(Scaffold.formProblem(fields({ name: "  " })), Scaffold.REASONS.name);
        assert.equal(Scaffold.formProblem(fields({ author: "" })), Scaffold.REASONS.author);
        assert.equal(Scaffold.formProblem(fields({ version: "" })), Scaffold.REASONS.version);
        assert.equal(Scaffold.formProblem(fields({ author: "2 Cool" })), Scaffold.REASONS.idDigit);
        assert.equal(Scaffold.resolvedId(fields({ internal: "  " })), "cavepaintings.examplemod");
        assert.equal(Scaffold.resolvedId(fields({ internal: "Custom.Mod" })), "Custom.Mod");
        assert.equal(Scaffold.formProblem(fields({ internal: "Custom.Mod" })), Scaffold.REASONS.idShape);

        const manifest = Scaffold.buildManifest(fields({ id: "cavepaintings.examplemod" }));
        assert.deepEqual(Object.keys(manifest), [
            "id", "name", "author", "description", "version", "gameVersion", "dependencies", "loadPriority"
        ]);
        assert.equal(manifest.description, "A short line");
        assert.deepEqual(manifest.dependencies, []);
        const bare = Scaffold.buildManifest(fields({
            id: "cavepaintings.examplemod",
            description: "  \n  "
        }));
        assert.equal(bare.description, undefined);
        assert.equal(Scaffold.cleanDescription("x".repeat(200)).length, 160);
        assert.equal(Scaffold.gameVersionSpec("0.3.2"), ">=0.3.2");
        assert.equal(Scaffold.gameVersionSpec("nope"), "");
        assert.equal(Scaffold.crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
    });

    test("zip contains one mod.json", () => {
        const manifest = Scaffold.buildManifest(fields({ id: "cavepaintings.examplemod" }));
        const entry = readZipEntry(Buffer.from(Scaffold.modZip(manifest)));
        assert.equal(entry.name, "cavepaintings.examplemod/mod.json");
        assert.equal(entry.text, Scaffold.manifestText(manifest));
        assert.deepEqual(JSON.parse(entry.text), manifest);
    });

    test("disk create writes only mod.json and refuses a second create", () => {
        const user = fs.mkdtempSync(path.join(os.tmpdir(), "cp-mod-create-"));
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-mod-repo-"));
        const first = modList.createUserMod(fs, {
            userMods: user,
            roots: [repo, user],
            ...fields()
        });
        assert.equal(first.ok, true);
        assert.equal(first.id, "cavepaintings.examplemod");
        const dir = path.join(user, first.id);
        assert.deepEqual(fs.readdirSync(dir), ["mod.json"]);
        assert.deepEqual(fs.readdirSync(user), [first.id]);
        const file = path.join(dir, "mod.json");
        const written = fs.readFileSync(file, "utf8");
        assert.equal(JSON.parse(written).id, first.id);
        fs.appendFileSync(file, "\n");
        const second = modList.createUserMod(fs, {
            userMods: user,
            roots: [repo, user],
            ...fields()
        });
        assert.equal(second.ok, false);
        assert.equal(second.reason, Scaffold.REASONS.duplicateId);
        assert.equal(fs.readFileSync(file, "utf8"), written + "\n");

        const empty = path.join(user, "example.empty");
        fs.mkdirSync(empty);
        const folder = modList.createUserMod(fs, {
            userMods: user,
            roots: [user],
            ...fields({ name: "Empty", author: "Example" })
        });
        assert.equal(folder.ok, false);
        assert.equal(folder.reason, Scaffold.REASONS.duplicateDir);

        const other = path.join(repo, "other.folder");
        fs.mkdirSync(other);
        fs.writeFileSync(path.join(other, "mod.json"), JSON.stringify({
            id: "other.taken",
            name: "Taken",
            version: "1.0.0",
            gameVersion: ">=0.3.2",
            dependencies: []
        }));
        const clash = modList.createUserMod(fs, {
            userMods: user,
            roots: [repo, user],
            ...fields({ name: "Taken", author: "Other", internal: "other.taken" })
        });
        assert.equal(clash.ok, false);
        assert.equal(clash.reason, Scaffold.REASONS.duplicateId);
        assert.equal(fs.existsSync(path.join(user, "other.taken")), false);
    });
});
