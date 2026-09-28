const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Content = require("../shared/mods/content");
const DataStore = require("../shared/DataStore");
const Research = require("../shared/research");
const Actions = require("../shared/mods/actions");
const Jobs = require("../shared/mods/jobs");

const ROOT = path.resolve(__dirname, "..");

test("cavepaintings.examplemod loads through generic data", () => {
    Content.boot({ root: ROOT, modsDir: path.join(ROOT, "mods") });
    const token = DataStore.getItem("cavepaintings.examplemod.token");
    const marker = DataStore.getThing("cavepaintings.examplemod.marker");
    assert.equal(token?.name, "Example Token");
    assert.equal(token?.maxStack, 99);
    assert.equal(token?.recipe?.stick, 1);
    assert.equal(token?.place?.thing, "cavepaintings.examplemod.marker");
    assert.equal(token?.key, "cavepaintings.examplemod.token");
    assert.match(token?._textureUrl, /mods\/cavepaintings\.examplemod\/assets\/items\/token\.png$/);
    assert.equal(marker?.key, "cavepaintings.examplemod.marker");
    assert.match(marker?._textureUrl, /mods\/cavepaintings\.examplemod\/assets\/things\/marker\.png$/);
    assert.equal(marker?.name, "Example Marker");
    assert.equal(marker?._source, "cavepaintings.examplemod");
    assert.equal(DataStore.getMob("cavepaintings.examplemod.critter")?.bodyPlan, "cavepaintings.examplemod.body");
    assert.equal(DataStore.getBodyPlan("cavepaintings.examplemod.body")?.core, "Torso");
    assert.equal(DataStore.getInjuryDefs()["cavepaintings.examplemod.nick"]?.name, "Example Nick");
    assert.equal(DataStore.getHediffDefs()["cavepaintings.examplemod.chill"]?.name, "Example Chill");
    assert.equal(Content.structures.types.some((row) => row.id === "cavepaintings.examplemod.site"), true);
    assert.equal(Content.structures.types.find((row) => row.id === "cavepaintings.examplemod.site").attemptChance, 0);
    assert.deepEqual(Content.simDocument().scatters, [{
        id: "cavepaintings.examplemod.markers",
        tiles: ["grass"],
        thingId: "cavepaintings.examplemod.marker",
        chance: 0,
        salt: 7
    }]);

    const gathering = Research.techs().find((t) => t.id === "gathering");
    const tech = Research.techs().find((t) => t.id === "cavepaintings.examplemod.studies");
    assert.equal(tech?.name, "Example Studies");
    assert.equal(tech?.quote, "An example of research");
    assert.deepEqual(tech?.prereqs, ["gathering"]);
    assert.ok(gathering.children.includes("cavepaintings.examplemod.studies"));
    assert.ok(tech.unlocks.items.includes("cavepaintings.examplemod.token"));
    assert.equal(Research.recipeUnlocked("cavepaintings.examplemod.token", null), false);

    Content.loadSimScripts();
    assert.equal(Actions.has("cavepaintings.examplemod.ping"), true);
    assert.equal(Jobs.get("cavepaintings.examplemod.note")?.name, "Example");
    assert.equal(Jobs.get("cavepaintings.examplemod.note")?.defaultPriority, 0);

    const sceneMain = fs.readFileSync(path.join(ROOT, "js/SceneMain.js"), "utf8");
    const simWorld = fs.readFileSync(path.join(ROOT, "shared/sim/SimWorld.js"), "utf8");
    const settler = fs.readFileSync(path.join(ROOT, "shared/sim/settlerWork.js"), "utf8");
    assert.equal(sceneMain.includes("cavepaintings.examplemod"), false);
    assert.equal(simWorld.includes("cavepaintings.examplemod"), false);
    assert.equal(settler.includes("cavepaintings.examplemod"), false);
});
