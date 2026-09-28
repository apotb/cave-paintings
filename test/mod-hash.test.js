const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Protocol = require("../shared/protocol");
const Content = require("../shared/mods/content");
const DataStore = require("../shared/DataStore");
const Hash = require("../shared/mods/hash");
const Loader = require("../shared/mods/loader");
const LocalSim = require("../js/net/LocalSim");
const SaveIO = require("../server/SaveIO");
const { GameServer } = require("../server/index");

const ROOT = path.resolve(__dirname, "..");
const WORLD = "phase2-mod-join";
const GAME = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version;
const EXAMPLE = "cavepaintings.examplemod";

Content.boot({ root: ROOT, modsDir: path.join(ROOT, "mods") });

function readJson(name) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "data", name), "utf8"));
}

function freshMerged(extraPacks) {
    const store = {
        itemsList: readJson("Items.json"),
        thingsList: readJson("Things.json"),
        mobsList: readJson("Mobs.json"),
        techsList: readJson("Techs.json"),
        bodyPlans: readJson("BodyPlans.json"),
        injuries: readJson("Injuries.json"),
        hediffs: readJson("Hediffs.json")
    };
    const structures = readJson("Structures.json");
    Loader.stampCore(store, structures);
    const packs = Loader.loadPacksFromDisk(path.join(ROOT, "mods"), GAME).concat(extraPacks || []);
    const next = Loader.mergePacks(store, structures, packs, GAME);
    const scripts = [];
    const scatters = [];
    for (const pack of packs) {
        const manifest = pack.manifest || {};
        if (manifest.id && manifest.clientOnly !== true && pack.simScriptBytes != null) {
            scripts.push({
                id: String(manifest.id),
                label: pack.label || manifest.id,
                loadPriority: Number(manifest.loadPriority) || 0,
                dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies : [],
                sha256: Hash.sha256Bytes(pack.simScriptBytes)
            });
        }
        const rows = pack.data && pack.data.scatters;
        if (Array.isArray(rows)) scatters.push(...rows);
    }
    const orderedScripts = scripts.length
        ? Loader.orderMods(scripts).map((row) => ({ modId: row.id, sha256: row.sha256 }))
        : [];
    return Hash.simDocument({
        items: store.itemsList,
        things: store.thingsList,
        techs: store.techsList,
        mobs: store.mobsList,
        bodyPlans: store.bodyPlans,
        injuries: store.injuries,
        hediffs: store.hediffs,
        structures: next,
        mods: Loader.simModsFromPacks(packs),
        scatters,
        scripts: orderedScripts
    });
}

function clientOnlyPack() {
    return {
        manifest: {
            id: "example.client_only",
            name: "Client Paint",
            version: "3.2.1",
            gameVersion: ">=0.3.1",
            dependencies: [],
            loadPriority: 0,
            clientOnly: true
        },
        data: {},
        label: "example.client_only",
        textureBase: "mods/example.client_only",
        hasScripts: false
    };
}

function withValue(get, set, next, fn) {
    const prev = get();
    set(next);
    try {
        fn();
    } finally {
        set(prev);
    }
}

describe("phase 2 sim hash", { concurrency: false }, () => {
test("simDocument.v is 1 and is not the protocol version", () => {
    const doc = Content.simDocument();
    assert.equal(doc.v, 1);
    assert.equal(Protocol.PROTOCOL_VERSION, 2);
    assert.notEqual(doc.v, Protocol.PROTOCOL_VERSION);
    assert.deepEqual(doc.scripts.map((row) => row.modId), [EXAMPLE]);
});

test("_source and _textureUrl do not change the hash", () => {
    const apple = DataStore.getItem("apple");
    const before = Content.simHash();
    withValue(() => apple._source, (v) => { apple._source = v; }, "not-a-mod", () => {
        assert.equal(Content.simHash(), before);
    });
    withValue(() => apple._textureUrl, (v) => { apple._textureUrl = v; }, "/tmp/apple.png", () => {
        assert.equal(Content.simHash(), before);
    });
});

test("one allowlisted field changes the hash for every definition kind", () => {
    const before = Content.simHash();
    const apple = DataStore.getItem("apple");
    withValue(() => apple.food.kc, (v) => { apple.food.kc = v; }, apple.food.kc + 1, () => {
        assert.notEqual(Content.simHash(), before);
    });
    const basket = DataStore.getThing("wicker_basket");
    withValue(() => basket.storage.slots, (v) => { basket.storage.slots = v; }, basket.storage.slots + 1, () => {
        assert.notEqual(Content.simHash(), before);
    });
    const tech = DataStore._store.techsList.find((row) => row.id === "gathering");
    withValue(() => tech.cost, (v) => { tech.cost = v; }, tech.cost + 1, () => {
        assert.notEqual(Content.simHash(), before);
    });
    withValue(() => tech.era, (v) => { tech.era = v; }, "Neolithic", () => {
        assert.notEqual(Content.simHash(), before);
    });
    const deer = DataStore.getMob("deer");
    withValue(() => deer.speed, (v) => { deer.speed = v; }, deer.speed + 1, () => {
        assert.notEqual(Content.simHash(), before);
    });
    const human = DataStore._store.bodyPlans.human;
    withValue(() => human.healRate, (v) => { human.healRate = v; }, human.healRate + 1, () => {
        assert.notEqual(Content.simHash(), before);
    });
    const injuryId = Object.keys(DataStore._store.injuries)[0];
    const injury = DataStore._store.injuries[injuryId];
    withValue(() => injury.bleedRate, (v) => { injury.bleedRate = v; }, injury.bleedRate + 1, () => {
        assert.notEqual(Content.simHash(), before);
    });
    const hediff = DataStore._store.hediffs.food_poisoning;
    withValue(() => hediff.severityPerDay, (v) => { hediff.severityPerDay = v; }, hediff.severityPerDay - 1, () => {
        assert.notEqual(Content.simHash(), before);
    });
    const camp = Content.structures.types.find((row) => row.id === "abandoned_camp");
    withValue(() => camp.attemptChance, (v) => { camp.attemptChance = v; }, camp.attemptChance + 0.1, () => {
        assert.notEqual(Content.simHash(), before);
    });
    const scatter = (chance) => ({
        items: [],
        things: [],
        techs: [],
        mobs: [],
        bodyPlans: {},
        injuries: {},
        hediffs: {},
        structures: { types: [], lootTables: {} },
        mods: [{ id: "example.mod", version: "1.0.0" }],
        scatters: [{ id: "berries", tiles: ["grass"], thingId: "bush", chance, salt: 4 }],
        scripts: [{ modId: "example.mod", sha256: "abc" }]
    });
    assert.notEqual(Hash.simHash(scatter(0.1)), Hash.simHash(scatter(0.9)));
    assert.deepEqual(Hash.simDocument(scatter(0.1)).scripts, [
        { modId: "example.mod", sha256: "abc" }
    ]);
    const snap = Content.snapshot();
    const bumped = Content.snapshot();
    bumped.mods = bumped.mods.map((mod) => ({ ...mod, version: "9.9.9" }));
    assert.notEqual(Hash.simHash(bumped), Hash.simHash(snap));
    assert.equal(Content.simHash(), before);
});

test("excluded cosmetic fields do not change the hash", () => {
    const before = Content.simHash();
    const apple = DataStore.getItem("apple");
    withValue(() => apple.key, (v) => { apple.key = v; }, "not_apple", () => {
        assert.equal(Content.simHash(), before);
    });
    withValue(() => apple.tooltip, (v) => { apple.tooltip = v; }, ["painted"], () => {
        assert.equal(Content.simHash(), before);
    });
    const tech = DataStore._store.techsList.find((row) => row.id === "gathering");
    withValue(() => tech.quote, (v) => { tech.quote = v; }, "different quote", () => {
        assert.equal(Content.simHash(), before);
    });
    const human = DataStore._store.bodyPlans.human;
    withValue(() => human.showDoll, (v) => { human.showDoll = v; }, !human.showDoll, () => {
        assert.equal(Content.simHash(), before);
    });
    const stage = DataStore._store.hediffs.food_poisoning.stages[0];
    withValue(() => stage.label, (v) => { stage.label = v; }, "renamed", () => {
        assert.equal(Content.simHash(), before);
    });
});

test("identical merges produce the same document, canonical bytes, and SHA-256", async () => {
    const first = freshMerged();
    const second = freshMerged();
    assert.deepEqual(first, second);
    assert.deepEqual(first, Content.simDocument());
    const canonical = Hash.canonicalString(first);
    assert.equal(canonical, Hash.canonicalString(second));
    assert.equal(canonical.includes("_source"), false);
    assert.equal(canonical.includes("_textureUrl"), false);
    assert.equal(canonical.includes(".png"), false);
    assert.equal(canonical.includes(ROOT), false);
    const utf8 = Buffer.from(canonical, "utf8");
    assert.deepEqual(utf8, Buffer.from(new TextEncoder().encode(canonical)));
    const nodeHex = Hash.sha256Hex(canonical);
    const subtleHex = await Hash.sha256Subtle(canonical);
    assert.equal(nodeHex, subtleHex);
    assert.equal(nodeHex, Content.simHash());
    assert.equal(first.v, 1);
    assert.deepEqual(first.scripts.map((row) => row.modId), [EXAMPLE]);
});

test("a client-only mod does not change the hash", () => {
    const withClient = freshMerged([clientOnlyPack()]);
    const without = freshMerged();
    assert.deepEqual(withClient, without);
    assert.equal(Hash.sha256Hex(Hash.canonicalString(withClient)), Content.simHash());
    assert.equal(
        withClient.mods.some((mod) => mod.id === "example.client_only"),
        false
    );
});

test("modsCompatible rejects a base client against a modded host and accepts base against base", () => {
    const rejected = Hash.modsCompatible(
        [{ id: "example.mod", version: "1.0.0" }],
        []
    );
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "Mod mismatch. Missing: example.mod@1.0.0.");
    const accepted = Hash.modsCompatible([], []);
    assert.equal(accepted.ok, true);
});

test("non-finite copied numbers throw", () => {
    const apple = DataStore.getItem("apple");
    withValue(() => apple.food.kc, (v) => { apple.food.kc = v; }, Number.NaN, () => {
        assert.throws(() => Content.simHash(), /non-finite number/);
    });
});

function fakeWs() {
    return {
        readyState: 1,
        sent: [],
        closed: false,
        send(raw) { this.sent.push(JSON.parse(raw)); },
        close() { this.closed = true; }
    };
}

function driveAuth(server, payload) {
    const ws = fakeWs();
    const meta = { playerId: null, authed: false, knownChunks: new Set(), lastMoveMs: 0 };
    server.clients.set(ws, meta);
    let added = 0;
    const orig = server.session.addPlayer;
    server.session.addPlayer = function (...args) {
        added += 1;
        return orig.apply(this, args);
    };
    try {
        server.handleAuth(ws, meta, payload);
    } finally {
        server.session.addPlayer = orig;
    }
    return { ws, added };
}

test("a modded host rejects a base client before addPlayer and welcomes a match", async () => {
    const server = new GameServer({
        worldName: WORLD,
        props: { password: "", "max-players": 8, motd: "" }
    });
    try {
        assert.equal(server.sim.toSaveData().v, 1);
        const rejected = driveAuth(server, {
            protocol: Protocol.PROTOCOL_VERSION,
            characterId: "baseclient0001",
            displayName: "Old"
        });
        assert.equal(rejected.added, 0);
        assert.equal(rejected.ws.closed, true);
        assert.equal(rejected.ws.sent[0].type, "reject");
        assert.equal(
            rejected.ws.sent[0].payload.reason,
            "Mod mismatch. Missing: cavepaintings.examplemod@1.0.0."
        );
        assert.equal(server.sim.players.has("baseclient0001"), false);
        assert.equal(JSON.stringify(rejected.ws.sent).includes("sim/index.js"), false);

        const auth = await Content.authContent();
        const accepted = driveAuth(server, {
            protocol: Protocol.PROTOCOL_VERSION,
            characterId: "modclient00001",
            displayName: "Matched",
            content: auth
        });
        assert.equal(accepted.added, 1);
        assert.equal(accepted.ws.closed, false);
        const welcome = accepted.ws.sent.find((msg) => msg.type === "welcome");
        assert.equal(welcome.payload.contentHash, Content.simHash());
        assert.deepEqual(welcome.payload.mods, Content.simMods());
        assert.equal(welcome.payload.scripts, undefined);
        assert.equal(JSON.stringify(welcome.payload).includes("_source"), false);
    } finally {
        SaveIO.deleteWorld(ROOT, WORLD);
    }
});

test("LocalSim welcome carries the host mods and content hash", async () => {
    const sim = new LocalSim({
        world: {
            id: "w-phase2",
            name: "Phase2",
            genVersion: 2,
            seed: 1,
            chunks: {},
            clock: { gameDay: 1, gameMinutes: 8 * 60, tickSpeed: 1 },
            poses: {},
            settlements: [],
            settlers: []
        },
        character: { id: "localplayer01", name: "Local" }
    });
    let welcome = null;
    sim.on(Protocol.Types.WELCOME, (payload) => { welcome = payload; });
    try {
        await sim.connect();
        assert.equal(welcome.contentHash, Content.simHash());
        assert.deepEqual(welcome.mods, [{ id: EXAMPLE, version: "1.0.0" }]);
        assert.equal(welcome.scripts, undefined);
    } finally {
        await sim.close();
    }
});
});
