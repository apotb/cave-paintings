const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadDefs, DataStore } = require("./helpers/load");
const Research = require("../shared/research");
const Settlement = require("../shared/settlement");
const Place = require("../shared/place");

loadDefs();

test("start unlocked techs are on a new settlement", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    assert.equal(Research.hasTech(s, "painting"), true);
    assert.equal(Research.hasTech(s, "gathering"), true);
    assert.equal(Research.hasTech(s, "hafting"), false);
    assert.ok(Number(Research.techById("hafting").cost) > 0);
    assert.equal(!!Research.techById("hafting").startUnlocked, false);
    assert.equal(Research.hasTech(s, "basic_furniture"), false);
    assert.equal(Settlement.jobLabel("research"), "Res");
    assert.equal(Settlement.defaultJobs().research, 3);
    assert.equal(Settlement.isAddableId("painting_circle"), false);
});

test("legacy free Hafting is revoked but can still be researched", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    s.techs.hafting = true;
    s.techGrantRev = 0;
    Research.ensureTechs(s);
    assert.equal(Research.hasTech(s, "hafting"), false);
    Research.unlock(s, "hafting");
    assert.equal(Research.hasTech(s, "hafting"), true);
});

test("painting circle recipe is known; stick frame is gated on Basic Furniture", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    assert.equal(Research.recipeUnlocked("painting_circle", s), true);
    assert.equal(Research.recipeUnlocked("stick", s), true);
    assert.equal(Research.recipeUnlocked("leaf_cord", s), true);
    assert.equal(Research.recipeUnlocked("lean_to", s), true);
    assert.equal(Research.recipeUnlocked("drying_rack", s), true);
    assert.equal(Research.recipeUnlocked("sharp_stick", s), true);
    assert.equal(Research.recipeUnlocked("campfire", s), true);
    assert.equal(Research.recipeUnlocked("stick_frame", s), false);
    assert.equal(Research.recipeUnlocked("wicker_basket", s), false);
    assert.equal(Research.recipeUnlocked("stick_frame", null), false);
    Research.unlock(s, "basic_furniture");
    assert.equal(Research.recipeUnlocked("stick_frame", s), true);
    assert.equal(Research.recipeUnlocked("wicker_basket", s), true);
    assert.equal(Research.recipeUnlocked("wooden_spear", s), true);
    assert.equal(Research.recipeUnlocked("stone_spear", s), false);
    assert.equal(Research.recipeUnlocked("flint_spear", s), false);
    assert.equal(Research.recipeUnlocked("pitch", s), false);
    Research.unlock(s, "hafting");
    assert.equal(Research.recipeUnlocked("pitch", s), true);
    assert.equal(Research.recipeUnlocked("stone_spear", s), true);
    assert.equal(Research.recipeUnlocked("flint_spear", s), true);
});

test("Fire gates campfire and sharp-stick fire tips, not the sharp stick recipe", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    const stick = DataStore.getItem("sharp_stick");
    assert.equal(stick.tooltipTech, "fire");
    assert.equal(Research.tooltipLines(stick, s).length, 2);
    s.techs.fire = false;
    assert.equal(Research.hasTech(s, "fire"), false);
    assert.equal(Research.techUnlocked("fire", s), false);
    assert.equal(Research.recipeUnlocked("campfire", s), false);
    assert.equal(Research.recipeUnlocked("sharp_stick", s), true);
    assert.deepEqual(Research.tooltipLines(stick, s), []);
    s.techs.fire = true;
    assert.equal(Research.recipeUnlocked("campfire", s), true);
    assert.equal(Research.tooltipLines(stick, s).length, 2);
});

test("skinworking bench recipe is gated on Skinworking", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    assert.equal(Research.recipeUnlocked("skinworking_bench", s), false);
    assert.equal(Research.recipeUnlocked("skinworking_bench", null), false);
    Research.unlock(s, "basic_furniture");
    assert.equal(Research.recipeUnlocked("skinworking_bench", s), false);
    Research.unlock(s, "skinworking");
    assert.equal(Research.recipeUnlocked("skinworking_bench", s), true);
    assert.equal(Research.recipeUnlocked("hide_pouch", s), true);
    assert.equal(Research.recipeUnlocked("leather_pouch", s), false);
    Research.unlock(s, "leatherworking");
    assert.equal(Research.recipeUnlocked("leather_pouch", s), true);
});

test("station bills hide until their technology is unlocked", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    assert.equal(Research.billUnlocked("roast", s), true);
    assert.equal(Research.billUnlocked("simmer", s), true);
    assert.equal(Research.billUnlocked("smoke", s), false);
    assert.equal(Research.billUnlocked("smoke", null), false);
    const smokeBill = Settlement.makeBill({ recipeId: "smoke", mode: "forever", paused: false });
    assert.equal(Settlement.billIsActive(smokeBill), true);
    assert.equal(Settlement.billIsActive(smokeBill, () => 0, s), true);
    assert.deepEqual(
        Settlement.billRecipesFor("campfire", s).map((r) => r.id),
        ["roast", "simmer"]
    );
    Research.unlock(s, "smoking");
    assert.equal(Research.billUnlocked("smoke", s), true);
    assert.ok(Settlement.billRecipesFor("campfire", s).some((r) => r.id === "smoke"));

    assert.equal(Research.billUnlocked("hide_pouch", s), false);
    assert.equal(Settlement.billRecipesFor("craft", s).length, 0);
    Research.unlock(s, "basic_furniture");
    Research.unlock(s, "skinworking");
    assert.equal(Research.billUnlocked("hide_pouch", s), true);
    assert.equal(Research.billUnlocked({ id: "hide_pouch", kind: "craft", outputId: "hide_pouch" }, s), true);
    const hideBills = Settlement.billRecipesFor("craft", s);
    assert.ok(hideBills.some((r) => r.id === "hide_pouch"));
    assert.ok(hideBills.some((r) => r.id === "hide_tunic"));
    assert.equal(hideBills.some((r) => r.id === "leather_tunic"), false);
    assert.equal(Research.billUnlocked("leather_tunic", s), false);
    Research.unlock(s, "leatherworking");
    assert.equal(Research.billUnlocked("leather_tunic", s), true);
    assert.ok(Settlement.billRecipesFor("craft", s).some((r) => r.id === "leather_kilt"));
    assert.ok(Settlement.billRecipesFor("rack", s).some((r) => r.id === "flesh_hide"));
});

test("action unlocks are not missing-item placeholders", () => {
    assert.equal(Research.isActionUnlock("Sow trees"), true);
    assert.equal(Research.isActionUnlock("Clay forming"), true);
    assert.equal(Research.isActionUnlock("Feast ritual"), true);
    assert.equal(Research.isActionUnlock("Funeral ritual"), true);
    assert.equal(Research.isActionUnlock("Tame wolves into dogs"), true);
    assert.equal(Research.isActionUnlock("Knife knapping"), true);
    assert.equal(Research.isActionUnlock("Smoke meat"), true);
    assert.equal(Research.isActionUnlock("Microlith knapping"), true);
    assert.equal(Research.isActionUnlock("Pit Kiln"), false);
    assert.equal(Research.isActionUnlock("Clay Pot"), false);
    assert.equal(Research.isActionUnlock("Fence"), false);
    assert.equal(Research.unlockTextIcon("Knife knapping"), "rock");
    assert.equal(Research.unlockTextIcon("Hand-axe knapping"), "rock");
    assert.equal(Research.unlockTextIcon("Microlith knapping"), "rock");
    assert.equal(Research.unlockTextIcon("Sow trees"), null);
    assert.equal(Research.unlockTextIcon("Hut"), null);
});

test("tech unlocks list items, jobs, and planned text", () => {
    const cord = Research.techById("cordage");
    assert.ok(cord.unlocks.items.includes("leaf_cord"));
    assert.ok(cord.unlocks.items.includes("wooden_spear"));
    const gather = Research.techById("gathering");
    assert.ok(gather.unlocks.jobs.includes("gather"));
    const skin = Research.techById("skinworking");
    assert.ok(skin.unlocks.items.includes("skinworking_bench"));
    assert.equal(skin.unlocks.items[0], "skinworking_bench");
    assert.ok(skin.unlocks.items.includes("hide_tunic"));
    assert.equal(skin.unlocks.items.includes("leather_kilt"), false);
    const leather = Research.techById("leatherworking");
    assert.ok(leather.unlocks.items.includes("leather_kilt"));
    assert.ok(leather.unlocks.items.includes("leather_pouch"));
    const herd = Research.techById("herding");
    assert.ok(herd.unlocks.text.includes("Fence"));
    const tan = Research.techById("tanning");
    assert.ok(tan.unlocks.items.includes("drying_rack"));
    assert.ok(tan.unlocks.jobs.includes("leather"));
    const smoke = Research.techById("smoking");
    assert.ok(smoke.unlocks.bills.includes("smoke"));
    assert.equal((smoke.unlocks.text || []).includes("Smoke meat"), false);
    assert.equal(Research.techById("adhesive"), null);
    assert.ok(Research.techById("hafting").unlocks.items.includes("pitch"));
    assert.ok(Research.techById("hafting").unlocks.items.includes("stone_spear"));
    assert.equal(Research.techById("hafting").unlocks.items.includes("wooden_spear"), false);
    assert.equal(Research.techById("traps").unlocks.text.includes("Snare"), true);
    assert.ok(Research.techById("spike_traps").unlocks.text.includes("Spike Trap"));
    assert.equal(Research.techById("counting").quote, "Invent 1, 2 before buckling shoes");
    assert.ok(Research.techById("counting").unlocks.items.includes("tally_stick"));
    assert.equal((Research.techById("counting").unlocks.text || []).includes("Tally Stick"), false);
    assert.equal(Research.techById("mathematics").quote, "We could do a lot with this");
    const fire = Research.techById("fire");
    assert.ok(fire.unlocks.items.includes("campfire"));
    assert.equal(fire.unlocks.items.includes("sharp_stick"), false);
});

test("painting circle has no walk collision", () => {
    const def = DataStore.getThing("painting_circle");
    assert.equal(def.hitboxSize, 0);
    assert.equal(def.storage, undefined);
    assert.equal(Place.hitboxWH(def), null);
    const entry = { id: "painting_circle", x: 8, y: 16 };
    assert.equal(Place.collisionWorldRect(entry, def, 16), null);
});

test("researchers stand in the circle center and face the painting they work", () => {
    const entry = { id: "painting_circle", x: 8, y: 16 };
    Research.ensureEntry(entry);
    assert.deepEqual(Research.standWorldPos(entry), { x: 0, y: 16 });
    assert.equal(Research.workFacing(entry), "up");
    entry.painted = 1;
    assert.equal(Research.workFacing(entry), "right");
    entry.painted = 2;
    assert.equal(Research.workFacing(entry), "right");
    entry.painted = 3;
    assert.equal(Research.workFacing(entry), "down");
    entry.painted = 4;
    assert.equal(Research.workFacing(entry), "left");
    entry.painted = 5;
    assert.equal(Research.workFacing(entry), "left");
    assert.deepEqual(Research.paintWallLocal("up"), { x: 0, y: -14 });
    assert.deepEqual(Research.paintWallLocal("right"), { x: 6, y: -8 });
    const base = Research.pigmentTint(DataStore.getItem("blueberry"));
    assert.equal(Research.paintFleckTint(base, "base"), base);
    assert.notEqual(Research.paintFleckTint(base, "light"), base);
    assert.notEqual(Research.paintFleckTint(base, "dirt"), base);
    assert.ok(Research.ghostOverlayAlpha(1, 0, 0) > Research.ghostOverlayAlpha(0, 0, 0));
    assert.ok(Research.ghostOverlayAlpha(0.4, 0, 1) > Research.ghostOverlayAlpha(0.4, 0, 0));
    assert.equal(Research.workFacingForIndex(0), "up");
    assert.equal(Research.workFacingForIndex(3), "down");
});

test("pigments are berries and flowers, not sticks", () => {
    assert.equal(Research.isPigment(DataStore.getItem("blueberry")), true);
    assert.equal(Research.isPigment(DataStore.getItem("cactus_flower")), true);
    assert.equal(Research.isPigment(DataStore.getItem("stick")), false);
});

test("consume pigment on start and do not charge again on interrupt", () => {
    const entry = { id: "painting_circle", x: 0, y: 0 };
    const def = DataStore.getThing("painting_circle");
    Research.ensureEntry(entry, def);
    const getItem = (id) => DataStore.getItem(id);
    const stack = { id: "blueberry", quantity: 2 };
    assert.equal(Research.consumePigment(entry, getItem, stack), true);
    assert.equal(entry.paintStarted, true);
    assert.equal(entry.paintPigment, "blueberry");
    assert.equal(stack.quantity, 1);
    assert.equal(Research.consumePigment(entry, getItem, stack), true);
    assert.equal(stack.quantity, 1);
    const mid = Research.addPaintMinutes(entry, 10);
    assert.equal(mid.completed, false);
    assert.ok(entry.paintProgress > 0);
    assert.equal(Research.consumePigment(entry, getItem, stack), true);
    assert.equal(stack.quantity, 1);
    const done = Research.addPaintMinutes(entry, Research.PAINT_MINUTES);
    assert.equal(done.completed, true);
    assert.equal(entry.painted, 1);
    assert.equal(entry.paintStarted, false);
    assert.equal(entry.paintPigment, null);
    assert.deepEqual(entry.paintPigments, ["blueberry"]);
    assert.equal(Research.overlayTint(entry, 0, getItem), 0x3b6fe0);
    assert.equal(Research.availableOn(entry), 1);
});

test("paint filter can forbid a pigment", () => {
    const entry = { id: "painting_circle", x: 0, y: 0 };
    Research.ensureEntry(entry);
    const getItem = (id) => DataStore.getItem(id);
    const berry = { id: "blueberry", quantity: 1 };
    const flower = { id: "cactus_flower", quantity: 1 };
    assert.equal(Research.allowsPigment(entry, berry, getItem), true);
    Research.applyPaintFilter(entry, { offItems: ["blueberry"] });
    assert.equal(Research.allowsPigment(entry, berry, getItem), false);
    assert.equal(Research.allowsPigment(entry, flower, getItem), true);
    assert.equal(Research.consumePigment(entry, getItem, berry), false);
    assert.equal(Research.consumePigment(entry, getItem, flower), true);
    assert.equal(entry.paintPigment, "cactus_flower");
});

test("pigment materials list is flat and alphabetical", () => {
    const items = DataStore._store.itemsList;
    const rows = Research.listPigments(items);
    assert.ok(rows.length >= 2);
    const names = rows.map((r) => r.name);
    const sorted = names.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    assert.deepEqual(names, sorted);
    assert.ok(rows.every((r) => Research.isPigment(DataStore.getItem(r.id))));
    assert.equal(rows.some((r) => r.id === "stick"), false);
});

test("disabled painting circle stays off until enabled", () => {
    const entry = { id: "painting_circle", x: 0, y: 0 };
    Research.ensureEntry(entry);
    assert.equal(Research.isEnabled(entry), true);
    Research.setEnabled(entry, false);
    assert.equal(Research.isEnabled(entry), false);
    Research.setEnabled(entry, true);
    assert.equal(Research.isEnabled(entry), true);
});

test("painting overlays tint from pigment fillColor", () => {
    const getItem = (id) => DataStore.getItem(id);
    assert.equal(Research.pigmentTint(getItem("blueberry")), 0x3b6fe0);
    assert.equal(Research.pigmentTint(getItem("cactus_flower")), 0xd666d4);
    assert.equal(getItem("cactus_flower").fillColor, "#D666D4");
    const entry = { id: "painting_circle", painted: 2, paintPigments: ["blueberry", "cactus_flower"] };
    Research.ensureEntry(entry);
    assert.equal(Research.overlayTint(entry, 0, getItem), 0x3b6fe0);
    assert.equal(Research.overlayTint(entry, 1, getItem), 0xd666d4);
});

test("research points are a settlement pool, not per-circle spend", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    const a = { id: "painting_circle", uid: "a", painted: 4 };
    const b = { id: "painting_circle", uid: "b", painted: 2 };
    Research.ensureEntry(a);
    Research.ensureEntry(b);
    const entries = [a, b];
    assert.equal(Research.paintedTotal(entries), 6);
    const open = Research.pointsBreakdown(entries, { settle: s });
    assert.equal(open.paintings, 6);
    assert.equal(open.spent, 0);
    assert.equal(open.total, 6);
    Research.unlock(s, "traps");
    const after = Research.pointsBreakdown(entries, { settle: s });
    assert.equal(after.paintings, 6);
    assert.equal(after.spent, 2);
    assert.equal(after.total, 4);
    assert.equal(a.painted, 4);
    assert.equal(b.painted, 2);
    assert.equal(a.locked, undefined);
    assert.equal(Research.availableTotal(entries, s), 4);
});

test("full painting circles still count toward the settlement pool", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    const full = { id: "painting_circle", uid: "full", painted: Research.PAINT_MAX };
    const a = { id: "painting_circle", uid: "a", painted: 4 };
    const b = { id: "painting_circle", uid: "b", painted: 4 };
    for (const e of [full, a, b]) Research.ensureEntry(e);
    assert.equal(Research.hasRoom(full), false);
    assert.equal(Research.inProgress(full), false);
    const pts = Research.pointsBreakdown([full, a, b], { settle: s });
    assert.equal(pts.paintings, Research.PAINT_MAX + 8);
    assert.equal(pts.total, Research.PAINT_MAX + 8);
});

test("cannot remove a painting circle that would drop below spent research", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    const a = { id: "painting_circle", uid: "a", painted: 6 };
    const b = { id: "painting_circle", uid: "b", painted: 6 };
    const c = { id: "painting_circle", uid: "c", painted: 6 };
    const d = { id: "painting_circle", uid: "d", painted: 6 };
    const all = [a, b, c, d];
    for (const e of all) Research.ensureEntry(e);
    assert.equal(Research.paintedTotal(all), 24);
    assert.equal(Research.remainingAfterRemove(all, a), 18);
    assert.equal(Research.canRemoveCircle(s, all, a), true);
    assert.equal(Research.removeBlockedReason(s, all, a), null);

    Research.unlock(s, "writing");
    Research.unlock(s, "agriculture");
    assert.equal(Research.spentPoints(s), 20);
    assert.equal(Research.canRemoveCircle(s, all, a), false);
    assert.equal(Research.removeBlockedReason(s, all, a), "Need 2 extra research points to maintain research");

    s.techs.writing = false;
    assert.equal(Research.spentPoints(s), 8);
    assert.equal(Research.canRemoveCircle(s, all, a), true);
    const left = [b, c, d];
    assert.equal(Research.paintedTotal(left), 18);
    assert.equal(Research.availableTotal(left, s), 10);

    const copy = Research.removeConfirmCopy(6);
    assert.equal(copy.question, "Are you sure you'd like to remove this Painting Circle?");
    assert.equal(copy.paintings, 6);
    assert.equal(copy.loseLead, "You'll lose:");
});

test("remove tooltip is how many paintings this circle would leave you short", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    const circles = [
        { id: "painting_circle", uid: "x", painted: 1 },
        { id: "painting_circle", uid: "y", painted: 1 },
        { id: "painting_circle", uid: "z", painted: 1 }
    ];
    for (const e of circles) Research.ensureEntry(e);
    Research.unlock(s, "hut");
    assert.equal(Research.spentPoints(s), 4);
    assert.equal(Research.canRemoveCircle(s, circles, circles[0]), false);
    assert.equal(
        Research.removeBlockedReason(s, circles, circles[0]),
        "Need 2 extra research points to maintain research"
    );
});

test("painting circle overlay loads sit next to the base sprite", () => {
    const def = DataStore.getThing("painting_circle");
    const loads = Place.thingImageLoads(def);
    assert.equal(loads[0].path, "assets/things/painting_circle/painting_circle.png");
    assert.equal(loads.length, 8);
    assert.equal(loads[6].key, "painting_circle_6");
    assert.equal(loads[7].key, "painting_circle_upgrade_stick");
    assert.equal(loads[7].path, "assets/things/painting_circle/upgrade_stick.png");
});

test("research currencies use the painting circle icon and empty slots for later items", () => {
    const rows = Research.currencies();
    assert.equal(rows.length, 4);
    assert.equal(rows[0].id, "paintings");
    assert.equal(rows[0].icon, "painting_circle");
    assert.equal(rows[1].id, "tallies");
    assert.equal(rows[1].icon, "tally_stick");
    assert.equal(rows[2].id, "tokens");
    assert.equal(rows[2].icon, "null");
    assert.equal(rows[3].id, "books");
    assert.equal(rows[3].icon, "null");
    assert.equal(Research.UI_PAINT_TINT, 0xaa1100);
    assert.equal(Research.UI_ICON_KEY, "painting_circle_ui");
    assert.equal(Research.UI_SCIENCE_KEY, "science");
    assert.equal(Research.UI_TITLE_HAND_KEY, "title-hand");
    assert.equal(Research.techById("gathering").icon, "blueberry");
    assert.equal(Research.techById("tree_sowing").icon, "tree");
    assert.equal(Research.techById("smoking").icon, "deer_leather");
    assert.equal(Research.techById("culture").icon, "title-hand");
    assert.equal(Research.spentTipValue(5), "-5");
    assert.equal(Research.spentTipValue(0), "-0");
});

test("disabled research button explains missing prereqs or points", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    assert.equal(Research.unlockBlockedReason(s, "painting", 0), null);
    assert.equal(Research.remainingUnlockCost(s, "skinworking"), 4);
    assert.equal(Research.remainingCostLabel(s, "skinworking"), "4 pts");
    assert.equal(Research.unlockBlockedReason(s, "skinworking", 3), "Not enough research points");
    assert.equal(Research.unlockBlockedReason(s, "skinworking", 99), null);
    assert.equal(Research.canUnlock(s, "skinworking", 99), true);
    assert.equal(Research.unlockBlockedReason(s, "traps", 0), "Not enough research points");
    assert.equal(Research.unlockBlockedReason(s, "traps", 2), null);
    assert.equal(Research.canUnlock(s, "traps", 2), true);
});

test("research node tooltip puts cost or Free on the header line", () => {
    const traps = Research.techById("traps");
    assert.equal(
        Research.techTip(traps),
        "Traps / 2 pts / Paleolithic\n'Wait for dinner'"
    );
    assert.equal(
        Research.techTip(traps, { unlocked: true }),
        "Traps / 2 pts / Paleolithic\n'Wait for dinner'"
    );
    const gathering = Research.techById("gathering");
    assert.equal(
        Research.techTip(gathering),
        "Gathering / Free / Paleolithic\n'Use your surroundings'"
    );
    assert.equal(Research.techCostLabel(gathering), "Free");
    assert.equal(Research.techCostLabel(traps), "2 pts");
    const pit = Research.techById("pit_traps");
    assert.equal(
        Research.techTip(pit, { missingNames: ["Traps", "Digging"] }),
        "Pit Traps / 3 pts / Mesolithic\nNeeds Traps, Digging"
    );
});

test("remaining unlock cost includes unfinished prereqs once each", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    assert.equal(Research.remainingUnlockCost(s, "throwing"), 5);
    assert.deepEqual(Research.remainingUnlockIds(s, "throwing"), ["hafting", "throwing"]);
    assert.equal(Research.canUnlock(s, "throwing", 4), false);
    assert.equal(Research.canUnlock(s, "throwing", 5), true);
    assert.equal(Research.unlockChain(s, "throwing"), true);
    assert.equal(Research.hasTech(s, "hafting"), true);
    assert.equal(Research.hasTech(s, "throwing"), true);
    assert.equal(Research.remainingUnlockCost(s, "throwing"), 0);
    assert.equal(Research.remainingCostLabel(s, "throwing"), "3 pts");
    assert.equal(Research.spentPoints(s), 5);
});

test("research points tooltip lists each currency count", () => {
    const a = { id: "painting_circle", uid: "a", painted: 3 };
    Research.ensureEntry(a);
    const pts = Research.pointsBreakdown([a], { tokens: 2, books: 1, spent: 5 });
    assert.equal(pts.paintings, 3);
    assert.equal(pts.produced, 10);
    assert.equal(pts.total, 5);
    assert.equal(Research.pointsTip(pts), "Paintings  3\nTallies  0\nTokens  2\nBooks  1\nResearch  -5");
});

test("research points count paintings now and leave room for tokens and books", () => {
    const a = { id: "painting_circle", uid: "a", painted: 3 };
    Research.ensureEntry(a);
    const pts = Research.pointsBreakdown([a]);
    assert.equal(pts.paintings, 3);
    assert.equal(pts.tokens, 0);
    assert.equal(pts.books, 0);
    assert.equal(pts.total, 3);
    assert.equal(Research.availablePoints([a], { tokens: 1, books: 2 }), 3 + 1 + 10);
});

test("tree layout is left-to-right with prereq edges", () => {
    const layout = Research.treeLayout({
        boxW: 10, boxH: 10, colGap: 10, rowGap: 10, treeGap: 10, pad: 0
    });
    assert.equal(layout.nodes.length, Research.techs().length);
    assert.ok(layout.byId.gathering);
    assert.equal(layout.byId.gathering.col, 0);
    assert.ok(layout.byId.cordage.x > layout.byId.gathering.x);
    assert.ok(layout.byId.pit_traps.col > layout.byId.traps.col);
    assert.ok(layout.edges.some((e) => e.from === "digging" && e.to === "pit_traps"));
    assert.ok(layout.edges.some((e) => e.from === "traps" && e.to === "pit_traps"));
    assert.ok(layout.edges.some((e) => e.from === "cordage" && e.to === "traps"));
    assert.ok(layout.edges.some((e) => e.from === "cordage" && e.to === "fishing"));
    assert.ok(layout.edges.some((e) => e.from === "hafting" && e.to === "fishing"));
    assert.ok(layout.edges.some((e) => e.from === "fishing" && e.to === "nets"));
    assert.ok(layout.edges.some((e) => e.from === "basic_furniture" && e.to === "nets"));
    assert.ok(layout.edges.some((e) => e.from === "digging" && e.to === "agriculture"));
    assert.ok(layout.edges.some((e) => e.from === "storage" && e.to === "agriculture"));
    assert.ok(layout.edges.some((e) => e.from === "herbalism" && e.to === "agriculture"));
    assert.equal(layout.edges.some((e) => e.from === "gathering" && e.to === "agriculture"), false);
    assert.equal(layout.edges.some((e) => e.from === "gathering" && e.to === "traps"), false);
    assert.equal(layout.edges.some((e) => e.from === "gathering" && e.to === "fishing"), false);
    assert.equal(layout.edges.some((e) => e.from === "digging" && e.to === "tree_sowing"), false);
    assert.ok(layout.edges.some((e) => e.from === "agriculture" && e.to === "tree_sowing"));
    assert.ok(layout.edges.some((e) => e.from === "fire" && e.to === "settlements"));
    assert.equal(layout.edges.some((e) => e.from === "cordage" && e.to === "settlements"), false);
    assert.equal(layout.edges.some((e) => e.from === "tanning" && e.to === "settlements"), false);
    assert.ok(layout.edges.some((e) => e.from === "traps" && e.to === "spike_traps"));
    assert.ok(layout.edges.some((e) => e.from === "hafting" && e.to === "spike_traps"));
    assert.ok(layout.edges.some((e) => e.from === "knapping" && e.to === "hafting"));
    assert.ok(layout.edges.some((e) => e.from === "cordage" && e.to === "hafting"));
    assert.equal(layout.edges.some((e) => e.from === "adhesive" && e.to === "hafting"), false);
    assert.ok(layout.edges.some((e) => e.from === "painting" && e.to === "counting"));
    assert.ok(layout.edges.some((e) => e.from === "counting" && e.to === "mathematics"));
    assert.ok(layout.edges.some((e) => e.from === "skinworking" && e.to === "leatherworking"));
    assert.ok(layout.edges.some((e) => e.from === "smoking" && e.to === "leatherworking"));
    assert.ok(layout.edges.some((e) => e.from === "hafting" && e.to === "bows"));
    assert.ok(layout.edges.some((e) => e.from === "microliths" && e.to === "bows"));
    assert.equal(layout.edges.some((e) => e.from === "blades" && e.to === "bows"), false);
    assert.ok(layout.edges.some((e) => e.from === "dogs" && e.to === "husbandry"));
    assert.ok(layout.edges.some((e) => e.from === "hut" && e.to === "herding"));
    assert.ok(layout.edges.some((e) => e.from === "pottery" && e.to === "writing"));
    assert.equal(layout.edges.some((e) => e.from === "basic_furniture" && e.to === "writing"), false);
    assert.equal(layout.byId.writing.shape, "trap");
    assert.equal(layout.byId.fishing.shape, "rect");
    assert.deepEqual(Research.techById("hafting").children, ["throwing"]);
    assert.ok(Research.techById("microliths").children.includes("bows"));
    const ids = new Set(layout.nodes.map((n) => n.id));
    for (const t of Research.techs()) assert.ok(ids.has(t.id), t.id);

    const rituals = layout.byId.rituals;
    const burial = layout.byId.burial;
    const afterlife = layout.byId.afterlife;
    const path = Research.edgePath(rituals, afterlife, {
        inset: 20,
        obstacles: layout.nodes
    });
    assert.ok(path.length >= 2);
    const last = path[path.length - 1];
    const prev = path[path.length - 2];
    assert.equal(last[0], afterlife.x);
    assert.equal(prev[1], last[1]);
    const throughBurial = path.some((p, i) => {
        if (!i) return false;
        const a = path[i - 1];
        const left = Math.min(a[0], p[0]);
        const right = Math.max(a[0], p[0]);
        const top = Math.min(a[1], p[1]);
        const bottom = Math.max(a[1], p[1]);
        return right > burial.x + 1 && left < burial.x + burial.w - 1
            && bottom > burial.y + 1 && top < burial.y + burial.h - 1;
    });
    assert.equal(throughBurial, false);

    const routed = Research.layoutEdgePaths(
        Research.treeLayout({
            boxW: 148, boxH: 52, colGap: 72, rowGap: 18, treeGap: 40, pad: 16
        }),
        { inset: 20, laneGap: 6 }
    );
    const verts = [];
    for (const r of routed) {
        const path = r.path || [];
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1];
            const b = path[i];
            if (a[0] !== b[0] || a[1] === b[1]) continue;
            verts.push({ x: a[0], y0: a[1], y1: b[1], from: r.from, to: r.to });
        }
    }
    const gatherKids = ["cordage", "herbalism", "digging"];
    const gatherXs = new Set();
    for (const v of verts) {
        if (v.from === "gathering" && gatherKids.includes(v.to)) gatherXs.add(v.x);
    }
    assert.equal(gatherXs.size, 1, "Gathering children share one vertical bus");

    const big = Research.treeLayout({
        boxW: 148, boxH: 52, colGap: 72, rowGap: 18, treeGap: 40, pad: 16
    });
    const intoBurial = routed.filter((r) => r.to === "burial");
    assert.ok(intoBurial.length >= 2);
    for (const r of intoBurial) {
        const end = r.path[r.path.length - 1];
        const b = big.byId.burial;
        const expect = Research.nodeLeftX(b, end[1]);
        assert.ok(Math.abs(end[0] - expect) < 0.5, `${r.from} should meet burial's pill`);
        assert.ok(end[0] > b.x + 1);
    }
    const intoPottery = routed.filter((r) => r.to === "pottery");
    assert.ok(intoPottery.length >= 2);
    for (const r of intoPottery) {
        const end = r.path[r.path.length - 1];
        const p = big.byId.pottery;
        const expect = Research.nodeLeftX(p, end[1]);
        assert.ok(Math.abs(end[0] - expect) < 0.5, `${r.from} should meet pottery's hex`);
        assert.ok(end[0] > p.x + 1);
    }
    const intoWriting = routed.filter((r) => r.to === "writing");
    assert.ok(intoWriting.length >= 2);
    for (const r of intoWriting) {
        const end = r.path[r.path.length - 1];
        const w = big.byId.writing;
        const expect = Research.nodeLeftX(w, end[1]);
        assert.ok(Math.abs(end[0] - expect) < 0.5, `${r.from} should meet writing's trapezoid`);
        assert.ok(end[0] > w.x + 1);
    }
    for (let i = 0; i < verts.length; i++) {
        for (let j = i + 1; j < verts.length; j++) {
            const a = verts[i];
            const b = verts[j];
            if (a.from === b.from) continue;
            if (a.x !== b.x) continue;
            const overlap = Math.min(a.y0, a.y1) < Math.max(b.y0, b.y1)
                && Math.max(a.y0, a.y1) > Math.min(b.y0, b.y1);
            assert.equal(
                overlap,
                false,
                `${a.from}->${a.to} overlaps ${b.from}->${b.to} at x=${a.x}`
            );
        }
    }

    const hitsNode = (path, n) => {
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1];
            const b = path[i];
            const left = Math.min(a[0], b[0]);
            const right = Math.max(a[0], b[0]);
            const top = Math.min(a[1], b[1]);
            const bottom = Math.max(a[1], b[1]);
            if (right > n.x + 1 && left < n.x + n.w - 1
                && bottom > n.y + 1 && top < n.y + n.h - 1) {
                return true;
            }
        }
        return false;
    };
    for (const r of routed) {
        for (const n of big.nodes) {
            if (n.id === r.from || n.id === r.to) continue;
            assert.equal(
                hitsNode(r.path, n),
                false,
                `${r.from}->${r.to} goes through ${n.id}`
            );
        }
    }
    const smokeLeather = routed.find((r) => r.from === "smoking" && r.to === "leatherworking");
    assert.ok(smokeLeather);
    assert.equal(hitsNode(smokeLeather.path, big.byId.skinworking), false);

    const herbAgri = routed.find((r) => r.from === "herbalism" && r.to === "agriculture");
    assert.ok(herbAgri);
    const herb = big.byId.herbalism;
    const agri = big.byId.agriculture;
    const herbMid = herb.y + herb.h * 0.5;
    const agriMid = agri.y + agri.h * 0.5;
    let sourceRowSpan = 0;
    let destRowSpan = 0;
    for (let i = 1; i < herbAgri.path.length; i++) {
        const a = herbAgri.path[i - 1];
        const b = herbAgri.path[i];
        if (a[1] !== b[1]) continue;
        const span = Math.abs(b[0] - a[0]);
        if (Math.abs(a[1] - herbMid) < 2) sourceRowSpan += span;
        if (Math.abs(a[1] - agriMid) < agri.h) destRowSpan += span;
    }
    assert.ok(
        sourceRowSpan < destRowSpan || sourceRowSpan < (agri.x - herb.x - herb.w) * 0.4,
        `herbalism→agriculture should not ride herbalism's row across the tree (source=${sourceRowSpan} dest=${destRowSpan})`
    );
});

test("retuned tech costs, names, and eras", () => {
    assert.equal(Research.techById("hut").name, "Huts");
    assert.equal(Research.techById("hut").cost, 4);
    assert.equal(Research.techById("dogs").cost, 3);
    assert.equal(Research.techById("husbandry").cost, 5);
    assert.deepEqual(Research.techById("husbandry").prereqs, ["agriculture", "dogs"]);
    assert.equal(Research.techById("herding").cost, 6);
    assert.deepEqual(Research.techById("herding").prereqs, ["husbandry", "hut"]);
    assert.equal(Research.techById("pottery").cost, 6);
    assert.equal(Research.techById("agriculture").cost, 8);
    assert.deepEqual(Research.techById("agriculture").prereqs, ["storage", "herbalism", "digging"]);
    assert.equal(Research.techById("mathematics").cost, 8);
    assert.ok(Research.techById("mathematics").prereqs.includes("agriculture"));
    assert.equal(Research.techById("writing").name, "Proto-Writing");
    assert.equal(Research.techById("writing").era, "Chalcolithic");
    assert.equal(Research.techById("writing").cost, 12);
    assert.deepEqual(Research.techById("writing").prereqs, ["mathematics", "pottery"]);
    assert.equal(Research.techById("bows").cost, 5);
    assert.deepEqual(Research.techById("bows").prereqs, ["hafting", "microliths"]);
    assert.equal(Research.techById("fishing").cost, 4);
    assert.deepEqual(Research.techById("fishing").prereqs, ["cordage", "hafting"]);
    assert.equal(Research.techById("nets").cost, 4);
    assert.deepEqual(Research.techById("nets").prereqs, ["fishing", "basic_furniture"]);
    assert.equal(Research.techById("hafting").cost, 2);
});

test("era shapes include chalcolithic trapezoid and mesolithic rect", () => {
    assert.equal(Research.eraShape("Paleolithic"), "oval");
    assert.equal(Research.eraShape("Mesolithic"), "rect");
    assert.equal(Research.eraShape("Neolithic"), "hex");
    assert.equal(Research.eraShape("Chalcolithic"), "trap");
    const node = { x: 10, y: 10, w: 100, h: 50, shape: "trap" };
    const top = Research.nodeLeftX(node, 10);
    const bot = Research.nodeLeftX(node, 60);
    assert.ok(top > bot, "trapezoid is inset at the top");
    assert.ok(bot >= node.x);
    const rTop = Research.nodeRightX(node, 10);
    const rBot = Research.nodeRightX(node, 60);
    assert.ok(rTop < rBot, "trapezoid is wider at the base");
});

test("new settlements are Paleolithic and fog later ages", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    assert.equal(Research.currentAge(s), "Paleolithic");
    assert.equal(Research.eraVisible(s, "Paleolithic"), true);
    assert.equal(Research.eraVisible(s, "Mesolithic"), true);
    assert.equal(Research.eraVisible(s, "Neolithic"), false);
    assert.equal(Research.eraVisible(s, "Chalcolithic"), false);
    assert.equal(Research.techFogged(s, "fishing"), false);
    assert.equal(Research.techFogged(s, "agriculture"), true);
    assert.equal(Research.techFogged(s, "writing"), true);
    assert.equal(Research.canUnlock(s, "agriculture", 99), false);
    assert.equal(Research.unlockBlockedReason(s, "agriculture", 99), Research.FOG_COPY);
    const rows = Research.ageBreakdown(s);
    assert.deepEqual(rows.map((r) => r.era), ["Paleolithic", "Mesolithic"]);
    assert.equal(Research.eraIcon("Paleolithic"), "campfire");
    assert.equal(Research.eraIcon("Mesolithic"), "null");
    assert.equal(Research.eraIcon("Neolithic"), "null");
    assert.equal(Research.eraIcon("Chalcolithic"), "null");
    assert.equal(rows[0].icon, "campfire");
    assert.equal(rows[1].icon, "null");
    assert.match(Research.ageTip(s), /^Paleolithic\s+\d+\/\d+\s+\d+%$/m);
    assert.match(Research.ageTip(s), /^Mesolithic\s+\d+\/\d+\s+\d+%$/m);
    assert.equal(Research.ageTip(s).includes("Neolithic"), false);
});

test("age advances at ceil 50% of an era or 100% of the previous", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    const meso = Research.techsInEra("Mesolithic");
    assert.equal(meso.length, 6);
    const need = Math.ceil(meso.length * 0.5);
    assert.equal(need, 3);
    Research.unlock(s, meso[0].id);
    Research.unlock(s, meso[1].id);
    assert.equal(Research.currentAge(s), "Paleolithic");
    Research.unlock(s, meso[2].id);
    assert.equal(Research.currentAge(s), "Mesolithic");
    assert.equal(Research.eraVisible(s, "Neolithic"), true);
    assert.equal(Research.techFogged(s, "agriculture"), false);
    assert.equal(Research.techFogged(s, "writing"), true);
    assert.equal(Research.ageBreakdown(s).some((r) => r.era === "Neolithic"), true);
    assert.equal(Research.ageBreakdown(s).some((r) => r.era === "Chalcolithic"), false);

    for (const t of meso) Research.unlock(s, t.id);
    assert.equal(Research.currentAge(s), "Neolithic");
    assert.equal(Research.eraVisible(s, "Chalcolithic"), true);
    assert.equal(Research.techFogged(s, "writing"), false);

    const neo = Research.techsInEra("Neolithic");
    for (const t of neo) Research.unlock(s, t.id);
    assert.equal(Research.currentAge(s), "Chalcolithic");
});

test("tally stick recipe is gated on Counting and carves bone with a knife", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    const item = DataStore.getItem("tally_stick");
    assert.ok(item);
    assert.equal(item.maxStack, 99);
    assert.equal(item.recipe.bone, 1);
    assert.equal(item.recipe.CRAFT_SECONDS, 8);
    assert.equal(item.recipe.REQUIRE_TOOL.toolClass, "knife");
    assert.equal(item.recipe.REQUIRE_TOOL.wear, 5);
    assert.equal(Research.recipeUnlocked("tally_stick", s), false);
    assert.equal(Research.recipeUnlocked("tally_stick", null), false);
    Research.unlock(s, "counting");
    assert.equal(Research.recipeUnlocked("tally_stick", s), true);
});

test("tally stick multiplies a circle's paintings by 1.5", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    const a = { id: "painting_circle", uid: "a", painted: 3 };
    const b = { id: "painting_circle", uid: "b", painted: 3 };
    Research.ensureEntry(a);
    Research.ensureEntry(b);
    assert.equal(Research.circlePoints(a), 3);
    assert.equal(Research.installTally(a), true);
    assert.equal(a.tallyStick, true);
    assert.equal(Research.circlePoints(a), 4.5);
    assert.equal(Research.installTally(b), true);
    const pts = Research.pointsBreakdown([a, b], { settle: s });
    assert.equal(pts.paintings, 6);
    assert.equal(pts.tallies, 3);
    assert.equal(pts.produced, 9);
    assert.equal(pts.total, 9);
    assert.equal(Research.formatPoints(pts.total), "9");
    assert.equal(Research.formatPoints(4.5), "4.5");
    assert.equal(Research.canUnlock(s, "traps", 4.5), true);
    assert.equal(Research.unlockBlockedReason(s, "traps", 4.5), null);
});

test("uninstalling a tally stick is blocked when spent would exceed remaining points", () => {
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    const a = { id: "painting_circle", uid: "a", painted: 3 };
    Research.ensureEntry(a);
    Research.installTally(a);
    Research.unlock(s, "hut");
    assert.equal(Research.spentPoints(s), 4);
    assert.equal(Research.canRemoveTally(s, [a], a), false);
    assert.equal(
        Research.tallyRemoveBlockedReason(s, [a], a),
        "Need 1 extra research point to maintain research"
    );
    assert.equal(Research.canRemoveCircle(s, [a], a), false);
    assert.equal(Research.hasTally(a), true);
    s.techs.hut = false;
    assert.equal(Research.canRemoveTally(s, [a], a), true);
    assert.equal(Research.removeTally(a), true);
    assert.equal(Research.hasTally(a), false);
    assert.equal(Research.circlePoints(a), 3);
});
