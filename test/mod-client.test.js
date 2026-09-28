const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Content = require("../shared/mods/content");
const Kinds = require("../shared/mods/kinds");
const Actions = require("../shared/mods/actions");
const ModClient = require("../js/mods/client");
const DataStore = require("../shared/DataStore");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "test", "fixtures", "phase5");
const ORDER = ["example.client_a", "example.client_c", "example.pile", "example.client_b"];

Content.boot({ root: ROOT, modsDir: FIXTURE });

const { SimWorld } = require("../shared/sim/SimWorld");

function clientFactory(modId) {
    return require(path.join(FIXTURE, modId, "client", "index.js"));
}

function loadSceneClasses() {
    const sandbox = {
        console,
        Phaser: { Scene: class Scene {} },
        ModKinds: Kinds,
        ModClient,
        Content,
        Storage: class Storage {
            static create(scene, entry) {
                return { via: "storage", entry, id: entry.id };
            }
        },
        Thing: class Thing {
            constructor(scene, x, y, id, entry) {
                this.via = "thing";
                this.entry = entry;
                this.id = id;
                this.x = x;
                this.y = y;
            }
        },
        Campfire: class Campfire {
            constructor() { this.via = "campfire"; }
        },
        LeanTo: class LeanTo {
            constructor() { this.via = "lean-to"; }
        },
        CraftStation: class CraftStation {
            constructor() { this.via = "craft"; }
        },
        SettlingStone: class SettlingStone {
            constructor() { this.via = "settlement"; }
        },
        ClayFigurine: class ClayFigurine {
            constructor() { this.via = "figurine"; }
        },
        LootableThing: class LootableThing {
            constructor() { this.via = "lootable"; }
        }
    };
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(ROOT, "js", "SceneBase.js"), "utf8")
        + "\n"
        + fs.readFileSync(path.join(ROOT, "js", "SceneMain.js"), "utf8")
        + "\nthis.SceneBase = SceneBase;\nthis.SceneMain = SceneMain;\n";
    vm.runInContext(source, sandbox);
    return sandbox;
}

function loaderScene(exists) {
    const calls = [];
    const handlers = {};
    const scene = {
        sys: {},
        textures: { exists(key) { return exists(key); } },
        cache: {
            json: { exists: () => true },
            audio: { exists: () => true }
        },
        load: {
            image(key, url) { calls.push({ type: "image", key, url }); },
            audio() {},
            json(key) { calls.push({ type: "json", key }); },
            script(key, url) { calls.push({ type: "script", key, url }); },
            spritesheet() {},
            once(event, fn) { handlers[event] = fn; }
        },
        calls,
        fire(event) { handlers[event]?.(); }
    };
    scene.sys.load = scene.load;
    return scene;
}

describe("phase 5 client mods", { concurrency: false }, () => {
    const scenes = loadSceneClasses();

    test("client scripts are listed in dependency, loadPriority, then id order and are not executed on boot", () => {
        assert.equal(globalThis.__cpClientOrder, undefined);
        assert.deepEqual(Content.clientScripts().map((row) => row.modId), ORDER);
        assert.deepEqual(
            Content.clientScripts().map((row) => row.url),
            ORDER.map((id) => `mods/${id}/client/index.js`)
        );
        assert.deepEqual(Content.simDocument().scripts.map((row) => row.modId), ["example.pile"]);
        Content.loadSimScripts();
        assert.equal(globalThis.__cpClientOrder, undefined);
        assert.equal(Actions.has("example.pile.chip"), true);
        const server = fs.readFileSync(path.join(ROOT, "server", "index.js"), "utf8");
        assert.equal(server.includes("client/index.js"), false);
        assert.equal(server.includes("ModClient"), false);
    });

    test("duplicate thing, panel, and texture registration names both sources", () => {
        Kinds.registerThingKind("example.one", { id: "example.shared.kind", initEntry() { return {}; } });
        assert.throws(
            () => Kinds.registerThingKind("example.two", { id: "example.shared.kind", initEntry() { return {}; } }),
            /Duplicate thing kind "example\.shared\.kind" \(example\.one and example\.two\)/
        );
        Kinds.registerPanel("example.one", { id: "example.shared.panel", open() {} });
        assert.throws(
            () => Kinds.registerPanel("example.two", { id: "example.shared.panel", open() {} }),
            /Duplicate panel "example\.shared\.panel" \(example\.one and example\.two\)/
        );
        Kinds.registerTexture("example.one", { key: "example.shared.tex", url: "a.png" });
        assert.throws(
            () => Kinds.registerTexture("example.two", { key: "example.shared.tex", url: "b.png" }),
            /Duplicate texture "example\.shared\.tex" \(example\.one and example\.two\)/
        );
    });

    test("client scripts load in order and register the pile before it is used", () => {
        const warm = ["null", "title-hand", "grass", "slot"];
        const scene = loaderScene((key) => warm.includes(key));
        scenes.SceneBase.prototype.preload.call(scene);
        assert.equal(scene.calls.some((row) => row.type === "json"), false);
        assert.deepEqual(
            scene.calls.filter((row) => row.type === "script").map((row) => row.key),
            ["cp-client-example.client_a"]
        );
        globalThis.__cpClientOrder = [];
        for (const modId of ORDER) {
            if (modId === "example.pile") {
                assert.equal(Kinds.openPanel("example.pile.panel", {}, {}), false);
            }
            globalThis.__cpPendingClientFactory = clientFactory(modId);
            scene.fire(`filecomplete-script-cp-client-${modId}`);
        }
        assert.deepEqual(globalThis.__cpClientOrder, ORDER);
        assert.equal(scene.calls.filter((row) => row.type === "script").length, ORDER.length);

        const again = loaderScene(() => true);
        scenes.SceneBase.prototype.preload.call(again);
        assert.equal(again.calls.some((row) => row.type === "script"), false);
        assert.deepEqual(globalThis.__cpClientOrder, ORDER);
        assert.equal(Kinds.textureRegistration("example.pile.flint_pile").modId, "example.pile");
    });

    test("built-in thing branches win and the kind is only the fallback", () => {
        const pileDef = DataStore.getThing("example.pile.flint_pile");
        assert.equal(pileDef.kind, "example.pile.station");
        assert.equal(pileDef.storage, undefined);
        const scene = {
            getThing(id) {
                if (id === "example.pile.flint_pile") return pileDef;
                return null;
            }
        };
        const made = scenes.SceneMain.prototype._makeThingEntry.call(scene, pileDef, 4, 9);
        assert.equal(made.entry.pile, true);
        assert.equal(made.entry.x, 4);
        const worldMade = SimWorld.prototype._makeThingEntry.call({
            _tileCenter(tx, ty) { return { x: tx, y: ty }; }
        }, pileDef, 8, 2);
        assert.equal(worldMade.entry.pile, true);
        assert.equal(worldMade.entry.x, 8);

        const chunk = { isLoaded: true, things: { getChildren: () => [], add() {} } };
        const spawned = scenes.SceneMain.prototype._spawnThingSprite.call(scene, chunk, made.entry, false);
        assert.equal(spawned.clientKind, true);
        spawned.listeners.pointerdown({});
        assert.equal(scene.openedPile, spawned);

        const cases = [
            [{ id: "campfire" }, {}, false, "campfire"],
            [{ id: "lean", occupants: [] }, { sleep: true }, false, "lean-to"],
            [{ id: "example.mod.marker", slots: [null] }, { storage: { slots: 4 } }, false, "storage"],
            [{ id: "workbench" }, { craftStation: true }, false, "craft"],
            [{ id: "settling_stone" }, { settlement: true }, false, "settlement"],
            [{ id: "clay_figurine" }, { figurine: true }, false, "figurine"],
            [{ id: "berry_bush" }, { lootable: true }, true, "lootable"]
        ];
        for (const [entry, def, lootable, via] of cases) {
            Kinds.registerThingKind("example.override", {
                id: entry.id,
                clientClass: class ShouldNotRun {},
                initEntry() { throw new Error(`kind ran for ${entry.id}`); }
            });
            const branch = {
                getThing() { return def; }
            };
            const sprite = scenes.SceneMain.prototype._spawnThingSprite.call(
                branch, chunk, entry, lootable
            );
            assert.equal(sprite.via, via, entry.id);
            if (def.storage || def.campfire || def.lootable || def.craftStation || def.settlement) {
                const entryMade = scenes.SceneMain.prototype._makeThingEntry.call(branch, { ...def, id: entry.id }, 1, 1);
                assert.equal(entryMade.entry.pile, undefined);
            }
        }

        const basket = { id: "example.mod.marker", storage: { slots: 4 } };
        const stored = scenes.SceneMain.prototype._spawnThingSprite.call(
            { getThing: () => basket },
            chunk,
            { id: basket.id },
            false
        );
        assert.equal(stored.via, "storage");
        const simStored = SimWorld.prototype._makeThingEntry.call({
            _tileCenter(tx, ty) { return { x: tx, y: ty }; }
        }, basket, 3, 3);
        assert.ok(Array.isArray(simStored.entry.slots));
        assert.equal(simStored.entry.pile, undefined);
        const sceneMain = fs.readFileSync(path.join(ROOT, "js", "SceneMain.js"), "utf8");
        const simWorld = fs.readFileSync(path.join(ROOT, "shared", "sim", "SimWorld.js"), "utf8");
        assert.equal(sceneMain.includes("example.mod"), false);
        assert.equal(sceneMain.includes("flint_basket"), false);
        assert.equal(simWorld.includes("flint_basket"), false);
    });

    test("built-in events run before mod handlers, and a thrown handler does not stop later events", () => {
        const order = [];
        const scene = {
            isNet: true,
            combatLog: { push(text) { order.push(`builtin:${text}`); } },
            _netShowRemoteBubble() { throw new Error("no bubble"); }
        };
        scenes.SceneMain.prototype.onEvent.call(scene, "chat", (ev) => {
            order.push(`mod:${ev.text}`);
            if (ev.text === "one") throw new Error("mod boom");
        });
        scenes.SceneMain.prototype.onEvent.call(scene, "chat", (ev) => {
            order.push(`next:${ev.text}`);
        });
        const errors = [];
        const orig = console.error;
        console.error = (...args) => errors.push(args.join(" "));
        try {
            scenes.SceneMain.prototype._netApplyEvent.call(scene, { kind: "chat", text: "one" });
            scenes.SceneMain.prototype._netApplyEvent.call(scene, { kind: "chat", text: "two" });
        } finally {
            console.error = orig;
        }
        assert.deepEqual(order, [
            "builtin:one",
            "mod:one",
            "next:one",
            "builtin:two",
            "mod:two",
            "next:two"
        ]);
        assert.equal(errors.length, 1);
    });

    test("texture ownership rejects another mod and ignores an existing Phaser cache entry", () => {
        const cachedLoads = [];
        const cached = {
            textures: { exists: (key) => key === "example.cached.mark" },
            load: { image(key, url) { cachedLoads.push({ key, url }); } }
        };
        ModClient.apiFor("example.owner", cached).registerTexture({
            key: "example.cached.mark",
            url: "mods/example.owner/mark.png"
        });
        assert.deepEqual(Kinds.textureRegistration("example.cached.mark"), {
            modId: "example.owner",
            key: "example.cached.mark",
            url: "mods/example.owner/mark.png"
        });
        assert.equal(cachedLoads.length, 0);

        assert.throws(
            () => ModClient.apiFor("example.other", cached).registerTexture({
                key: "example.cached.mark",
                url: "mods/example.other/mark.png"
            }),
            /Duplicate texture "example\.cached\.mark" \(example\.owner and example\.other\)/
        );
        assert.equal(Kinds.textureRegistration("example.cached.mark").modId, "example.owner");
        assert.equal(Kinds.textureRegistration("example.cached.mark").url, "mods/example.owner/mark.png");
        assert.equal(cachedLoads.length, 0);

        const coldLoads = [];
        const cold = {
            textures: { exists: () => false },
            load: {
                image(key, url) { coldLoads.push({ key, url }); },
                spritesheet() {}
            }
        };
        ModClient.apiFor("example.cold", cold).registerTexture({
            key: "example.cold.mark",
            url: "mods/example.cold/mark.png"
        });
        Content.queueTextures(cold);
        const coldMarks = coldLoads.filter((row) => row.key === "example.cold.mark");
        assert.equal(coldMarks.length, 1);
        assert.equal(coldMarks[0].url, "mods/example.cold/mark.png");
        const pile = coldLoads.filter((row) => row.key === "example.pile.flint_pile");
        assert.equal(pile.length, 1);

        const warmLoads = [];
        const warm = {
            textures: {
                exists: (key) => key === "example.cold.mark"
                    || key === "example.cached.mark"
                    || key === "example.pile.flint_pile"
            },
            load: {
                image(key, url) { warmLoads.push({ key, url }); },
                spritesheet() {}
            }
        };
        Content.queueTextures(warm);
        assert.equal(warmLoads.some((row) => row.key === "example.cold.mark"), false);
        assert.equal(warmLoads.some((row) => row.key === "example.cached.mark"), false);
        assert.equal(warmLoads.some((row) => row.key === "example.pile.flint_pile"), false);
        assert.equal(warmLoads.some((row) => row.key === "example.shared.tex"), true);
        assert.equal(Kinds.textureRegistration("example.cold.mark").modId, "example.cold");
        assert.equal(Kinds.textureRegistration("example.cached.mark").modId, "example.owner");
    });

    test("the pile action is a registered sim action, not a basket special case", () => {
        const world = SimWorld.createNew({ worldName: "phase5" });
        const pawn = world.addPlayer("pile0000000001", "Pile", null, { silentJoin: true });
        world.handleAction(pawn.id, { type: "example.pile.chip", thingId: "example.pile.flint_pile" });
        assert.equal(world.__pileChips, 1);
        assert.equal(world.__pileThing, "example.pile.flint_pile");
        assert.equal(world.__pileSession, pawn.id);
    });
});
