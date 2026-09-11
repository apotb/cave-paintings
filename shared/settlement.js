/**
 * Settlement claim, range, jobs, bills, stock — Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Settlement = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const RADIUS_TILES = 32;
    const WALK_TRANSFER_TILES = 96;
    const IDLE_ROAM_SOFT = 4;
    const IDLE_ROAM_HARD = 7;
    const IDLE_ROAM_MIN = 1.4;
    const IDLE_ROAM_MAX = 4.6;
    const IDLE_STAND_MIN_MS = 2000;
    const IDLE_STAND_MAX_MS = 6000;
    const NAME_MAX = 24;
    function researchMod() {
        if (typeof Research !== "undefined") return Research;
        try {
            if (typeof require === "function") return require("./research");
        } catch (_) { /* optional */ }
        return null;
    }
    const JOBS = ["doctor", "cook", "chop", "leather", "gather", "haul", "research"];
    const JOB_LABELS = {
        doctor: "Doc",
        cook: "Cook",
        leather: "Tail",
        haul: "Haul",
        gather: "Get",
        chop: "Chop",
        research: "Res"
    };
    const JOB_NAMES = {
        doctor: "Doctor",
        cook: "Cook",
        leather: "Tailoring",
        haul: "Haul",
        gather: "Gather",
        chop: "Chop",
        research: "Research"
    };
    /** Work inside each column. Station bills are one line; order is the bill list. */
    const JOB_WORK = {
        doctor: ["Tend the wounded"],
        cook: [
            "Work at Campfire",
            "Light campfires",
            "Stoke fires"
        ],
        chop: ["Chop trees"],
        leather: [
            "Work at Drying Rack",
            "Soak hides in water",
            "Take soaked hides from the ground",
            "Smoke leather",
            "Work at Skinworking Bench"
        ],
        gather: ["Harvest plants", "Gather resources"],
        haul: [
            "Pick up ground items",
            "Stash carried items",
            "Restack storage",
            "Move items between storage"
        ],
        research: [
            "Install tally stick",
            "Fetch pigment",
            "Work at Painting Circle"
        ]
    };
    const STOCK_ITEMS = [
        "stick", "leaf", "log", "blueberry", "apple", "coconut",
        "pebble", "flint", "cactus_flower"
    ];
    const STOCK_DEFAULTS = { stick: 30, leaf: 20, log: 12 };
    /** Harvested forms that still mean the fruit/flower will return. */
    const STOCK_REGROW_ALWAYS = {
        cactus: "cactus_flower",
        flowering_cactus: "cactus_flower",
        blueberry_bush: "blueberry",
        apple_tree: "apple",
        coconut_tree: "coconut",
        palm_tree: "coconut"
    };
    const STOCK_REGROW_IF_PLANTED = {
        bush: "blueberry",
        tree: "apple"
    };
    const BILL_MODES = ["count", "until", "forever"];
    const SIMMER_INGREDIENT_IDS = ["apple", "blueberry", "raw_human_flesh", "raw_venison", "raw_pork"];
    const SIMMER_RESULT = "coconut_meal";
    const SIMMER_MIN_SLOTS = 2;
    const SIMMER_SLOTS = 4;
    const HIDE_ANIMALS = ["deer", "boar"];
    const HIDE_STEPS = {
        flesh_hide: { inputStage: "raw", outputStage: "fleshed" },
        dry_hide: { inputStage: "fleshed", outputStage: "dried" },
        soak_hide: { inputStage: "fleshed", outputStage: "soaked" },
        dehair_hide: { inputStage: "soaked", outputStage: "dehaired" },
        brain_hide: { inputStage: "dehaired", outputStage: "brained" }
    };
    const BENCH_RECIPES = [
        { id: "hide_pouch", name: "Hide Pouch", hideStage: "dried" },
        { id: "hide_bundle", name: "Hide Bundle", hideStage: "dried" },
        { id: "hide_tunic", name: "Hide Tunic", hideStage: "dried" },
        { id: "hide_loincloth", name: "Hide Loincloth", hideStage: "dried" },
        { id: "leather_pouch", name: "Leather Pouch", hideStage: "leather" },
        { id: "leather_pack", name: "Leather Pack", hideStage: "leather" },
        { id: "leather_tunic", name: "Leather Tunic", hideStage: "leather" },
        { id: "leather_kilt", name: "Leather Kilt", hideStage: "leather" }
    ];
    const BILL_RECIPES = {
        campfire: [
            { id: "roast", name: "Roast", kind: "cook", method: "stick_roast" },
            { id: "simmer", name: "Simmer", kind: "cook", method: "shell_simmer" },
            { id: "smoke", name: "Smoke leather", kind: "cook", method: "smoke_hide" }
        ],
        rack: [
            { id: "flesh_hide", name: "Flesh hides", kind: "hide", method: "flesh_hide" },
            { id: "dry_hide", name: "Dry hides", kind: "hide", method: "dry_hide" },
            { id: "soak_hide", name: "Soak hides", kind: "hide", method: "soak_hide" },
            { id: "dehair_hide", name: "Dehair hides", kind: "hide", method: "dehair_hide" },
            { id: "brain_hide", name: "Brain-tan hides", kind: "hide", method: "brain_hide" }
        ],
        craft: BENCH_RECIPES.map((r) => ({
            id: r.id,
            name: r.name,
            kind: "craft",
            outputId: r.id,
            hideStage: r.hideStage
        }))
    };
    const BILL_STATION_THING = {
        campfire: "campfire",
        rack: "drying_rack",
        craft: "skinworking_bench"
    };
    const ADDABLE = {
        campfire: true,
        unlit_campfire: true,
        skinworking_bench: true,
        drying_rack: true,
        wicker_basket: true
    };

    function uid() {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
        return `st-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
    }

    function clampName(name) {
        const s = String(name || "").trim().slice(0, NAME_MAX);
        return s || "Camp";
    }

    function renameChat(oldName, newName, color) {
        const from = clampName(oldName);
        const to = clampName(newName);
        const paint = color || "#7ec8ff";
        return {
            text: `${from} was renamed to ${to}`,
            segments: [
                { text: from, color: paint },
                { text: "was renamed to" },
                { text: to, color: paint }
            ]
        };
    }

    function defaultJobs() {
        const row = {};
        for (const j of JOBS) row[j] = 3;
        return row;
    }

    function normalizeJobs(raw) {
        const row = defaultJobs();
        if (!raw || typeof raw !== "object") return row;
        for (const j of JOBS) {
            const n = Math.floor(Number(raw[j]));
            if (n >= 1 && n <= 4) row[j] = n;
            else if (raw[j] == null || raw[j] === "" || raw[j] === 0 || raw[j] === false) row[j] = 0;
        }
        return row;
    }

    function cyclePriority(v) {
        const n = Math.floor(Number(v) || 0);
        if (n < 1) return 1;
        if (n >= 4) return 0;
        return n + 1;
    }

    /** Lower number is higher priority. Off (0) enables at 4. 1 wraps to off. */
    function raisePriority(v) {
        const n = Math.floor(Number(v) || 0);
        if (n < 1) return 4;
        if (n <= 1) return 0;
        return n - 1;
    }

    /** Lowest number among enabled jobs wins; 0 is off. */
    function pickJob(row) {
        const jobs = normalizeJobs(row);
        let best = null;
        let bestP = 99;
        for (const j of JOBS) {
            const p = jobs[j];
            if (!(p >= 1 && p <= 4)) continue;
            if (p < bestP) {
                bestP = p;
                best = j;
            }
        }
        return best;
    }

    function enabledJobs(row) {
        const jobs = normalizeJobs(row);
        return JOBS.filter((j) => jobs[j] >= 1).sort((a, b) => jobs[a] - jobs[b]);
    }

    function defaultStock() {
        const stock = {};
        for (const id of STOCK_ITEMS) stock[id] = STOCK_DEFAULTS[id] || 0;
        return stock;
    }

    function normalizeStock(raw) {
        const stock = defaultStock();
        if (!raw || typeof raw !== "object") return stock;
        for (const id of STOCK_ITEMS) {
            const n = Math.floor(Number(raw[id]));
            stock[id] = n > 0 ? n : 0;
        }
        for (const [k, v] of Object.entries(raw)) {
            if (stock[k] != null) continue;
            const n = Math.floor(Number(v));
            if (n > 0) stock[k] = n;
        }
        return stock;
    }

    /** Stock item ids a world thing can supply (gather loot, harvest cycle, or chop drops). */
    function stockItemsFromThing(def, entry) {
        const ids = [];
        const add = (id) => {
            if (id && !ids.includes(id)) ids.push(id);
        };
        if (!def) return ids;
        const thingId = def.id || def.key || entry?.id;
        if (def.lootable?.item) add(def.lootable.item);
        add(STOCK_REGROW_ALWAYS[thingId]);
        if (entry?.regrowAt) add(STOCK_REGROW_IF_PLANTED[thingId]);
        if (def.choppable) {
            add("log");
            add("stick");
            add("leaf");
        }
        return ids;
    }

    function filterStockItems(present) {
        const set = present instanceof Set ? present : new Set(present || []);
        return STOCK_ITEMS.filter((id) => set.has(id));
    }

    function distTiles(ax, ay, bx, by, tileSize) {
        const ts = Number(tileSize) > 0 ? Number(tileSize) : 16;
        return Math.hypot((Number(ax) - Number(bx)) / ts, (Number(ay) - Number(by)) / ts);
    }

    function inRange(settle, x, y, tileSize) {
        if (!settle) return false;
        const r = Number(settle.radiusTiles) > 0 ? Number(settle.radiusTiles) : RADIUS_TILES;
        return distTiles(settle.x, settle.y, x, y, tileSize) <= r + 0.05;
    }

    function circlesOverlap(a, b, tileSize) {
        if (!a || !b) return false;
        const ra = Number(a.radiusTiles) > 0 ? Number(a.radiusTiles) : RADIUS_TILES;
        const rb = Number(b.radiusTiles) > 0 ? Number(b.radiusTiles) : RADIUS_TILES;
        return distTiles(a.x, a.y, b.x, b.y, tileSize) < ra + rb - 0.01;
    }

    function canPlace(list, x, y, tileSize, exceptId) {
        const probe = { x, y, radiusTiles: RADIUS_TILES };
        for (const s of list || []) {
            if (!s || s.id === exceptId) continue;
            if (circlesOverlap(probe, s, tileSize)) return false;
        }
        return true;
    }

    function isAddableId(id) {
        return !!ADDABLE[String(id || "")];
    }

    function stationKind(id) {
        if (id === "campfire" || id === "unlit_campfire") return "campfire";
        if (id === "skinworking_bench") return "craft";
        if (id === "drying_rack") return "rack";
        if (id === "wicker_basket") return "storage";
        return null;
    }

    function ensureSettlement(raw, opts = {}) {
        const s = raw && typeof raw === "object" ? { ...raw } : {};
        s.id = s.id || uid();
        s.name = clampName(s.name);
        s.ownerId = s.ownerId || opts.ownerId || null;
        s.x = Number(s.x) || 0;
        s.y = Number(s.y) || 0;
        s.tx = Number.isInteger(s.tx) ? s.tx : Math.floor(s.x / 16);
        s.ty = Number.isInteger(s.ty) ? s.ty : Math.floor((s.y - 1) / 16);
        s.radiusTiles = RADIUS_TILES;
        s.stationUids = Array.isArray(s.stationUids) ? s.stationUids.filter(Boolean) : [];
        s.bills = s.bills && typeof s.bills === "object" && !Array.isArray(s.bills) ? s.bills : {};
        s.stock = normalizeStock(s.stock);
        s.jobs = s.jobs && typeof s.jobs === "object" ? s.jobs : {};
        const R = researchMod();
        if (R?.ensureTechs) R.ensureTechs(s);
        else if (!s.techs || typeof s.techs !== "object" || Array.isArray(s.techs)) s.techs = {};
        return s;
    }

    function createSettlement(opts = {}) {
        return ensureSettlement({
            id: opts.id || uid(),
            name: opts.name,
            ownerId: opts.ownerId,
            x: opts.x,
            y: opts.y,
            tx: opts.tx,
            ty: opts.ty,
            stock: defaultStock()
        });
    }

    function unlinkStation(list, uid) {
        if (!uid) return [];
        const hit = [];
        for (const s of list || []) {
            if (!s) continue;
            const uids = s.stationUids || [];
            if (!uids.includes(uid)) continue;
            s.stationUids = uids.filter((u) => u !== uid);
            if (s.bills) delete s.bills[uid];
            hit.push(s);
        }
        return hit;
    }

    /** Drop from the settlement without forgetting bills (pickup/move still uses unlinkStation). */
    function removeStation(settle, uid) {
        if (!settle || !uid) return false;
        const uids = settle.stationUids || [];
        if (!uids.includes(uid)) return false;
        settle.stationUids = uids.filter((u) => u !== uid);
        return true;
    }

    function isNight(gameMinutes) {
        const m = ((Math.floor(Number(gameMinutes) || 0) % 1440) + 1440) % 1440;
        return m >= 1230 || m < 360;
    }

    function stackQty(stack) {
        if (!stack || !(Number(stack.quantity) > 0)) return 0;
        return Math.floor(Number(stack.quantity) || 0);
    }

    function countInSlots(slots, itemId) {
        let n = 0;
        for (const s of slots || []) {
            if (s?.id === itemId) n += stackQty(s);
        }
        return n;
    }

    function countStock(baskets, itemId) {
        let n = 0;
        for (const b of baskets || []) {
            n += countInSlots(b?.slots || b, itemId);
        }
        return n;
    }

    function countPawnStock(pawns, itemId) {
        let n = 0;
        for (const p of pawns || []) {
            if (!p) continue;
            n += countInSlots(p.inventory, itemId);
            n += countInSlots(p.overflow, itemId);
        }
        return n;
    }

    function dropItemId(drop) {
        if (!drop) return null;
        if (drop.item?.id) return drop.item.id;
        if (typeof drop.id === "string" && drop.id) return drop.id;
        if (typeof drop.itemId === "string" && drop.itemId) return drop.itemId;
        return null;
    }

    function countDropStock(drops, itemId) {
        let n = 0;
        for (const d of drops || []) {
            if (dropItemId(d) !== itemId) continue;
            n += stackQty(d);
        }
        return n;
    }

    function stockTarget(settle, itemId) {
        const n = Math.floor(Number(settle?.stock?.[itemId]) || 0);
        return n > 0 ? n : 0;
    }

    function stockShort(settle, baskets, itemId, pawns, drops) {
        const want = stockTarget(settle, itemId);
        if (!(want > 0)) return 0;
        return Math.max(0, want
            - countStock(baskets, itemId)
            - countPawnStock(pawns, itemId)
            - countDropStock(drops, itemId));
    }

    function billRecipesFor(stationKind, settle) {
        const list = (BILL_RECIPES[stationKind] || []).slice();
        if (arguments.length < 2) return list;
        return list.filter((r) => billRecipeUnlocked(r, settle));
    }

    function billRecipeUnlocked(billOrRec, settle) {
        const R = researchMod();
        if (!R?.billUnlocked) return true;
        return R.billUnlocked(billOrRec, settle);
    }

    function billRecipeById(recipeId) {
        for (const list of Object.values(BILL_RECIPES)) {
            const hit = (list || []).find((r) => r && r.id === recipeId);
            if (hit) return hit;
        }
        return null;
    }

    function billStationKindOf(recipeId) {
        for (const [kind, list] of Object.entries(BILL_RECIPES)) {
            if ((list || []).some((r) => r && r.id === recipeId)) return kind;
        }
        return null;
    }

    function billStationThingId(kind) {
        return BILL_STATION_THING[kind] || null;
    }

    function cookInputsForMethod(items, method) {
        const out = [];
        if (!method) return out;
        for (const it of items || []) {
            if (!it?.id) continue;
            const rec = it.cook?.[method];
            if (!rec?.result || !(Number(rec.minutes) > 0)) continue;
            out.push({
                id: it.id,
                name: it.name || it.id,
                result: rec.result,
                key: it.key || it.id
            });
        }
        return out;
    }

    function hideItemId(animal, stage) {
        const a = String(animal || "").trim();
        if (!a) return null;
        if (stage === "raw") return `${a}_hide`;
        if (stage === "dried") return `${a}_hide_dry`;
        if (stage === "leather") return `${a}_leather`;
        if (!stage) return `${a}_hide`;
        return `${a}_hide_${stage}`;
    }

    function hideStepOf(method) {
        return HIDE_STEPS[method] || null;
    }

    function hideAnimalOf(itemDef, itemId) {
        const a = itemDef?.hide?.animal;
        if (typeof a === "string" && a) return a;
        const id = String(itemId || itemDef?.id || "");
        for (const animal of HIDE_ANIMALS) {
            if (id === `${animal}_hide` || id.startsWith(`${animal}_hide_`) || id === `${animal}_leather`) {
                return animal;
            }
        }
        return null;
    }

    function hideStageOf(itemDef, itemId) {
        const stage = itemDef?.hide?.stage;
        if (typeof stage === "string" && stage) return stage;
        const id = String(itemId || itemDef?.id || "");
        if (id.endsWith("_leather")) return "leather";
        if (id.endsWith("_hide_dry")) return "dried";
        if (id.endsWith("_hide")) return "raw";
        const m = id.match(/_hide_([a-z]+)$/);
        return m ? m[1] : null;
    }

    function simmerInputsFromItems(items) {
        const out = [];
        const seen = new Set();
        const list = Array.isArray(items) ? items : [];
        for (const id of SIMMER_INGREDIENT_IDS) {
            const it = list.find((m) => m && m.id === id);
            out.push({
                id,
                name: it?.name || id,
                result: SIMMER_RESULT,
                key: it?.key || id
            });
            seen.add(id);
        }
        return out;
    }

    function hideInputsForStep(items, method) {
        const step = hideStepOf(method);
        if (!step) return [];
        const list = Array.isArray(items) ? items : [];
        const byAnimal = new Map();
        for (const it of list) {
            if (!it?.id || !it.hide) continue;
            if (hideStageOf(it, it.id) !== step.inputStage) continue;
            const animal = hideAnimalOf(it, it.id);
            if (!animal || byAnimal.has(animal)) continue;
            byAnimal.set(animal, {
                id: it.id,
                name: it.name || it.id,
                animal,
                result: hideItemId(animal, step.outputStage),
                key: it.key || it.id
            });
        }
        if (!byAnimal.size) {
            for (const animal of HIDE_ANIMALS) {
                const id = hideItemId(animal, step.inputStage);
                byAnimal.set(animal, {
                    id,
                    name: id,
                    animal,
                    result: hideItemId(animal, step.outputStage),
                    key: id
                });
            }
        }
        return [...byAnimal.values()];
    }

    function craftHideInputs(items, hideStage) {
        const stage = String(hideStage || "");
        if (!stage) return [];
        const list = Array.isArray(items) ? items : [];
        const out = [];
        const seen = new Set();
        for (const it of list) {
            if (!it?.id || hideStageOf(it, it.id) !== stage) continue;
            if (seen.has(it.id)) continue;
            seen.add(it.id);
            out.push({
                id: it.id,
                name: it.name || it.id,
                key: it.key || it.id
            });
        }
        if (!out.length) {
            for (const animal of HIDE_ANIMALS) {
                const id = hideItemId(animal, stage);
                out.push({ id, name: id, key: id });
            }
        }
        return out;
    }

    function billInputsFor(recipe, items) {
        if (!recipe) return [];
        if (recipe.method === "shell_simmer") return simmerInputsFromItems(items);
        if (hideStepOf(recipe.method)) return hideInputsForStep(items, recipe.method);
        if (recipe.hideStage || recipe.kind === "craft") {
            return craftHideInputs(items, recipe.hideStage);
        }
        if (recipe.method) return cookInputsForMethod(items, recipe.method);
        return [];
    }

    function billAllowsInput(bill, itemId) {
        if (!itemId) return false;
        const allowed = bill?.allowedIds;
        if (!Array.isArray(allowed) || !allowed.length) return true;
        const want = canonItemId(itemId);
        return allowed.some((id) => canonItemId(id) === want);
    }

    const RECIPE_SKIP = {
        QUANTITY: true,
        REQUIRE_THING: true,
        REQUIRE_STATION: true,
        CRAFT_SECONDS: true,
        REQUIRE_TOOL: true
    };

    function billCraftNeeds(bill, getItem) {
        const id = bill?.outputId || bill?.recipeId;
        const def = typeof getItem === "function" ? getItem(id) : null;
        const raw = def?.recipe;
        if (!raw || typeof raw !== "object") return null;
        const out = [];
        for (const [k, v] of Object.entries(raw)) {
            if (RECIPE_SKIP[k]) continue;
            if (v && typeof v === "object") {
                out.push({
                    id: k,
                    qty: Math.max(1, Math.floor(Number(v.qty) || 1)),
                    hideStage: v.hideStage ? String(v.hideStage) : null
                });
            } else {
                const qty = Math.max(1, Math.floor(Number(v) || 0));
                if (qty > 0) out.push({ id: k, qty, hideStage: null });
            }
        }
        return out.length ? out : null;
    }

    function countBillInputs(bill, items, countItem, pred = null) {
        const rec = billRecipeById(bill?.recipeId) || bill;
        const inputs = billInputsFor(rec, items);
        let n = 0;
        const count = typeof countItem === "function" ? countItem : () => 0;
        for (const inp of inputs) {
            if (!inp?.id || !billAllowsInput(bill, inp.id)) continue;
            if (pred && !pred(inp)) continue;
            n += Math.max(0, Number(count(inp.id)) || 0);
        }
        return n;
    }

    function billHasMaterials(bill, opts = {}) {
        if (!bill) return false;
        const countItem = typeof opts.countItem === "function" ? opts.countItem : () => 0;
        const getItem = opts.getItem;
        const items = opts.items || [];
        const rec = billRecipeById(bill.recipeId) || bill;
        const needs = billCraftNeeds(bill, getItem);
        if (needs) {
            for (const need of needs) {
                if (need.hideStage) {
                    const n = countBillInputs(bill, items, countItem, (inp) => {
                        const def = typeof getItem === "function" ? getItem(inp.id) : null;
                        return hideStageOf(def, inp.id) === need.hideStage;
                    });
                    if (n < need.qty) return false;
                    continue;
                }
                if (need.id === "ANY_HIDE" || need.id === "ANY_LEATHER") {
                    if (countBillInputs(bill, items, countItem) < need.qty) return false;
                    continue;
                }
                if ((Number(countItem(need.id)) || 0) < need.qty) return false;
            }
            return true;
        }
        const have = countBillInputs(bill, items, countItem);
        const method = bill.method || rec?.method;
        if (method === "shell_simmer") return have >= SIMMER_MIN_SLOTS;
        return have >= 1;
    }

    function billWantsMaterials(bill, haveOutput) {
        if (!bill) return false;
        if (bill.mode === "count") return (Number(bill.remaining) || 0) > 0;
        if (bill.mode === "until") {
            const need = Math.max(1, Math.floor(Number(bill.n) || 1));
            return untilHave(bill, haveOutput) < need;
        }
        return true;
    }

    function hideAllowsStack(bill, stack, getItem) {
        if (!stack?.id || !bill) return false;
        const step = hideStepOf(bill.method);
        if (!step) return false;
        const def = typeof getItem === "function" ? getItem(stack.id) : null;
        if (hideStageOf(def, stack.id) !== step.inputStage) return false;
        const animal = hideAnimalOf(def, stack.id);
        if (!animal) return false;
        const allowed = bill.allowedIds;
        if (!Array.isArray(allowed) || !allowed.length) return true;
        for (const id of allowed) {
            const meta = typeof getItem === "function" ? getItem(id) : null;
            if (hideAnimalOf(meta, id) === animal) return true;
            if (id === stack.id) return true;
        }
        return false;
    }

    function hideResultIdsForBill(bill, getItem) {
        const step = hideStepOf(bill?.method);
        if (!step) return [];
        const ids = [];
        const inputs = Array.isArray(bill.allowedIds) && bill.allowedIds.length
            ? bill.allowedIds
            : hideInputsForStep(null, bill.method).map((i) => i.id);
        for (const id of inputs) {
            const def = typeof getItem === "function" ? getItem(id) : null;
            const animal = hideAnimalOf(def, id);
            const out = hideItemId(animal, step.outputStage);
            if (out && !ids.includes(out)) ids.push(out);
        }
        return ids;
    }

    function hideToolNeed(method) {
        if (method === "flesh_hide" || method === "dehair_hide") return "scraper";
        if (method === "brain_hide") return "brain";
        return null;
    }

    function hideSoakHasWork(opts = {}) {
        if (opts.hasReadySoaked) return true;
        if (!opts.hasWater) return false;
        return !!opts.hasFleshed;
    }

    function nearestWaterPoint(settle, fromX, fromY, tileSize, isWaterAt) {
        if (!settle || typeof isWaterAt !== "function") return null;
        const ts = Number(tileSize) > 0 ? Number(tileSize) : 16;
        const r = Number(settle.radiusTiles) > 0 ? Number(settle.radiusTiles) : RADIUS_TILES;
        const minTx = Math.floor((Number(settle.x) - r * ts) / ts) - 1;
        const maxTx = Math.ceil((Number(settle.x) + r * ts) / ts) + 1;
        const minTy = Math.floor((Number(settle.y) - r * ts) / ts) - 1;
        const maxTy = Math.ceil((Number(settle.y) + r * ts) / ts) + 1;
        let best = null;
        let bestD = Infinity;
        const ox = Number(fromX);
        const oy = Number(fromY);
        for (let ty = minTy; ty <= maxTy; ty++) {
            for (let tx = minTx; tx <= maxTx; tx++) {
                const wx = (tx + 0.5) * ts;
                const wy = (ty + 0.5) * ts;
                if (!inRange(settle, wx, wy, ts)) continue;
                if (!isWaterAt(wx, wy)) continue;
                const d = Math.hypot(wx - ox, wy - oy);
                if (d < bestD) {
                    bestD = d;
                    best = { x: wx, y: wy, tx, ty };
                }
            }
        }
        return best;
    }

    function canonItemId(id) {
        if (typeof Hide !== "undefined" && Hide.canonicalItemId) return Hide.canonicalItemId(id);
        if (id === "raw_beef") return "raw_human_flesh";
        if (id === "roast_beef" || id === "roast_human_flesh") return "roasted_human_flesh";
        return id;
    }

    function isSimmerIngredientId(itemId) {
        return SIMMER_INGREDIENT_IDS.includes(canonItemId(itemId));
    }

    function isCookTool(getItem, stack, method) {
        if (!stack?.id || !method) return false;
        const meta = typeof getItem === "function" ? getItem(stack.id) : null;
        return meta?.cook?.method === method;
    }

    function simmerSlotsOf(fire) {
        const slots = fire?.simmer || fire?.entry?.simmer;
        return Array.isArray(slots) ? slots : [];
    }

    function simmerEmptyCount(fire) {
        const slots = simmerSlotsOf(fire);
        let n = 0;
        for (let i = 0; i < SIMMER_SLOTS; i++) {
            if (!slots[i]) n++;
        }
        return n;
    }

    function countPredQty(slots, pred) {
        let n = 0;
        for (const s of slots || []) {
            if (!s || (pred && !pred(s))) continue;
            n += Math.max(1, Math.floor(Number(s.quantity) || 1));
        }
        return n;
    }

    function cookAllowsInput(bill, itemId, getItem) {
        if (billAllowsInput(bill, itemId)) return true;
        if (bill?.method !== "smoke_hide") return false;
        const allowed = bill.allowedIds;
        if (!Array.isArray(allowed) || !allowed.length) return true;
        const animal = hideAnimalOf(typeof getItem === "function" ? getItem(itemId) : null, itemId);
        if (!animal) return false;
        return allowed.some((id) => (
            hideAnimalOf(typeof getItem === "function" ? getItem(id) : null, id) === animal
        ));
    }

    function cookResultIds(bill, getItem) {
        if (Array.isArray(bill?.resultIds) && bill.resultIds.length) return bill.resultIds.slice();
        if (bill?.method === "shell_simmer") return [SIMMER_RESULT];
        if (bill?.method === "smoke_hide") {
            const inputs = Array.isArray(bill.allowedIds) && bill.allowedIds.length
                ? bill.allowedIds
                : HIDE_ANIMALS.map((a) => hideItemId(a, "brained"));
            const outs = [];
            for (const id of inputs) {
                const def = typeof getItem === "function" ? getItem(id) : null;
                const r = def?.cook?.smoke_hide?.result
                    || hideItemId(hideAnimalOf(def, id), "leather");
                if (r && !outs.includes(r)) outs.push(r);
            }
            return outs;
        }
        const inputs = Array.isArray(bill?.allowedIds) ? bill.allowedIds : [];
        const outs = [];
        if (typeof getItem !== "function") return outs;
        for (const id of inputs) {
            const r = getItem(id)?.cook?.[bill.method]?.result;
            if (r && !outs.includes(r)) outs.push(r);
        }
        return outs;
    }

    function cookInputReady(getItem, stack, bill) {
        if (!stack?.id || !bill?.method) return false;
        if (bill.method === "shell_simmer") {
            if (!isSimmerIngredientId(stack.id)) return false;
            return billAllowsInput(bill, stack.id);
        }
        if (!cookAllowsInput(bill, stack.id, getItem)) return false;
        const rec = typeof getItem === "function" ? getItem(stack.id)?.cook?.[bill.method] : null;
        return !!(rec?.result && Number(rec.minutes) > 0);
    }

    function cookOutputReady(getItem, stack, bill) {
        if (!stack?.id || !bill) return false;
        if (bill.method === "shell_simmer") return stack.id === SIMMER_RESULT;
        if (cookInputReady(getItem, stack, bill)) return false;
        const results = cookResultIds(bill, getItem);
        if (results.length) return results.includes(canonItemId(stack.id));
        if ((bill.method || "stick_roast") === "stick_roast") {
            const def = typeof getItem === "function" ? getItem(stack.id) : null;
            if (def?.hide) return false;
            if (isCookTool(getItem, stack, "stick_roast") || isCookTool(getItem, stack, "smoke_hide")) {
                return false;
            }
            return !!(def?.food);
        }
        if (bill.method === "smoke_hide") {
            const def = typeof getItem === "function" ? getItem(stack.id) : null;
            return hideStageOf(def, stack.id) === "leather";
        }
        return false;
    }

    function cookFitsBill(getItem, stack, bill) {
        return cookInputReady(getItem, stack, bill) || cookOutputReady(getItem, stack, bill);
    }

    function billRecipeTitle(rec) {
        if (!rec) return "Bill";
        if (rec.kind === "craft" && rec.name) {
            const n = String(rec.name);
            if (/^make\s/i.test(n)) return n;
            return `Make ${n}`;
        }
        return rec.name || rec.id || "Bill";
    }

    function billTitle(bill) {
        if (!bill) return "Bill";
        const custom = String(bill.name || "").trim();
        if (custom) return custom.slice(0, NAME_MAX);
        const rec = billRecipeById(bill.recipeId);
        if (rec) return billRecipeTitle(rec);
        if (bill.kind === "craft" && bill.outputId) {
            return billRecipeTitle({ kind: "craft", name: String(bill.outputId), outputId: bill.outputId });
        }
        if (bill.method === "stick_roast") return "Roast";
        if (bill.method === "shell_simmer") return "Simmer";
        if (bill.method === "smoke_hide") return "Smoke leather";
        if (bill.recipeId) return String(bill.recipeId);
        if (bill.kind === "cook") return "Cook";
        if (bill.kind === "hide") return "Hidework";
        return "Bill";
    }

    function cycleBillMode(mode) {
        const i = BILL_MODES.indexOf(mode);
        const idx = i < 0 ? 0 : (i + 1) % BILL_MODES.length;
        return BILL_MODES[idx];
    }

    function billModeLabel(mode) {
        if (mode === "forever") return "Do forever";
        if (mode === "count") return "Do X times";
        return "Do until you have X";
    }

    function billQtyLabel(bill, haveOutput) {
        if (!bill || bill.mode === "forever") return "Forever";
        if (bill.mode === "count") {
            return `${Math.max(0, Math.floor(Number(bill.remaining ?? bill.n) || 0))}x`;
        }
        const need = Math.max(1, Math.floor(Number(bill.n) || 1));
        if (typeof haveOutput === "function") {
            const have = Math.max(0, Math.floor(Number(untilHave(bill, haveOutput)) || 0));
            return `${have}/${need}`;
        }
        return `${need}x`;
    }

    function billIsComplete(bill, haveOutput) {
        if (!bill) return false;
        if (bill.mode === "count") return (Number(bill.remaining) || 0) <= 0;
        if (bill.mode === "until") {
            const need = Math.max(1, Math.floor(Number(bill.n) || 1));
            return untilHave(bill, haveOutput) >= need;
        }
        return false;
    }

    function moveBill(list, billId, dir) {
        const src = Array.isArray(list) ? list.slice() : [];
        const i = src.findIndex((b) => b && b.id === billId);
        const j = i + (dir < 0 ? -1 : 1);
        if (i < 0 || j < 0 || j >= src.length) return src;
        const row = src[i];
        src[i] = src[j];
        src[j] = row;
        return src;
    }

    function removeBill(list, billId) {
        return (Array.isArray(list) ? list : []).filter((b) => b && b.id !== billId);
    }

    function syncBillResults(bill, getItem) {
        if (!bill) return bill;
        if (bill.outputId) {
            bill.resultIds = [bill.outputId];
            return bill;
        }
        if (bill.method === "shell_simmer") {
            bill.resultIds = [SIMMER_RESULT];
            return bill;
        }
        if (hideStepOf(bill.method)) {
            bill.resultIds = hideResultIdsForBill(bill, getItem);
            return bill;
        }
        if (bill.method && typeof getItem === "function") {
            const inputs = Array.isArray(bill.allowedIds) ? bill.allowedIds : [];
            const outs = [];
            for (const id of inputs) {
                const r = getItem(id)?.cook?.[bill.method]?.result;
                if (r && !outs.includes(r)) outs.push(r);
            }
            bill.resultIds = outs;
            return bill;
        }
        if (bill.recipeId) bill.resultIds = [bill.recipeId];
        return bill;
    }

    function makeBill(opts = {}) {
        const rec = opts.recipeId ? billRecipeById(opts.recipeId) : null;
        const mode = BILL_MODES.includes(opts.mode) ? opts.mode : "count";
        const allowed = Array.isArray(opts.allowedIds)
            ? opts.allowedIds.map((id) => String(id || "")).filter(Boolean)
            : null;
        const bill = {
            id: opts.id || uid(),
            kind: opts.kind || rec?.kind || "craft",
            recipeId: opts.recipeId || rec?.id || null,
            method: opts.method || rec?.method || null,
            outputId: opts.outputId || rec?.outputId || null,
            mode,
            n: Math.max(1, Math.floor(Number(opts.n) || 1)),
            paused: opts.paused == null ? true : !!opts.paused,
            remaining: mode === "count"
                ? Math.max(1, Math.floor(Number(opts.remaining ?? opts.n) || 1))
                : 0,
            allowedIds: allowed && allowed.length ? allowed : null,
            resultIds: Array.isArray(opts.resultIds) ? opts.resultIds.filter(Boolean) : null,
            name: String(opts.name || "").trim().slice(0, NAME_MAX) || null
        };
        return bill;
    }

    function billsOf(settle, stationUid) {
        const list = settle?.bills?.[stationUid];
        return Array.isArray(list) ? list : [];
    }

    function setBills(settle, stationUid, list) {
        if (!settle.bills) settle.bills = {};
        settle.bills[stationUid] = Array.isArray(list) ? list : [];
        return settle.bills[stationUid];
    }

    function addBill(settle, stationUid, bill) {
        const list = billsOf(settle, stationUid).slice();
        list.push(makeBill(bill));
        return setBills(settle, stationUid, list);
    }

    function untilHave(bill, haveOutput) {
        const ids = (bill?.resultIds && bill.resultIds.length)
            ? bill.resultIds
            : [bill?.outputId || bill?.recipeId].filter(Boolean);
        if (typeof haveOutput !== "function") return Number(haveOutput) || 0;
        if (!ids.length) return Number(haveOutput()) || 0;
        let n = 0;
        for (const id of ids) n += Number(haveOutput(id)) || 0;
        return n;
    }

    function billIsActive(bill, haveOutput, settle) {
        if (!bill || bill.paused) return false;
        if (bill.mode === "forever") return true;
        if (bill.mode === "count") return (Number(bill.remaining) || 0) > 0;
        if (bill.mode === "until") {
            const need = Math.max(1, Math.floor(Number(bill.n) || 1));
            return untilHave(bill, haveOutput) < need;
        }
        return false;
    }

    function activeBill(settle, stationUid, haveOutput) {
        for (const b of billsOf(settle, stationUid)) {
            if (billIsActive(b, haveOutput, settle)) return b;
        }
        return null;
    }

    function noteBillCrafted(bill) {
        if (!bill || bill.mode !== "count") return bill;
        bill.remaining = Math.max(0, (Number(bill.remaining) || 0) - 1);
        return bill;
    }

    function jobLabel(job) {
        return JOB_LABELS[job] || String(job || "");
    }

    function jobTooltip(job) {
        const name = JOB_NAMES[job] || jobLabel(job);
        const work = JOB_WORK[job] || [];
        return [name, ...work.map((line) => `- ${line}`)].join("\n");
    }

    function jobsFor(settle, pawnId) {
        return normalizeJobs(settle?.jobs?.[pawnId]);
    }

    function setJob(settle, pawnId, job, pri) {
        if (!settle.jobs) settle.jobs = {};
        const row = normalizeJobs(settle.jobs[pawnId]);
        if (JOBS.includes(job)) {
            const n = Math.floor(Number(pri));
            row[job] = n >= 1 && n <= 4 ? n : 0;
        }
        settle.jobs[pawnId] = row;
        return row;
    }

    function ownedOf(list, ownerId) {
        return (list || []).filter((s) => s && s.ownerId === ownerId);
    }

    function atPoint(list, x, y, tileSize, ownerId) {
        const hits = [];
        for (const s of list || []) {
            if (ownerId && s.ownerId !== ownerId) continue;
            if (inRange(s, x, y, tileSize)) hits.push(s);
        }
        hits.sort((a, b) => distTiles(a.x, a.y, x, y, tileSize) - distTiles(b.x, b.y, x, y, tileSize));
        return hits[0] || null;
    }

    function chunkKeysFor(settle, tileSize, chunkSize) {
        const ts = Number(tileSize) > 0 ? Number(tileSize) : 16;
        const cs = Number(chunkSize) > 0 ? Number(chunkSize) : 8;
        const r = Number(settle?.radiusTiles) > 0 ? Number(settle.radiusTiles) : RADIUS_TILES;
        const pad = Math.ceil(r / cs) + 1;
        const cx = Math.floor((Number(settle?.x) || 0) / (cs * ts));
        const cy = Math.floor((Number(settle?.y) || 0) / (cs * ts));
        const keys = [];
        for (let y = cy - pad; y <= cy + pad; y++) {
            for (let x = cx - pad; x <= cx + pad; x++) keys.push(`${x},${y}`);
        }
        return keys;
    }

    function fruitTreeId(id) {
        return id === "apple_tree" || id === "coconut_tree";
    }

    /** Chop job leaves fruiting trees for gather (apple, coconut, later lootable woods). */
    function chopSkipsTree(id, def, entry) {
        if (fruitTreeId(id || def?.id || entry?.id)) return true;
        if (def && def.lootable) return true;
        // Picked fruit: apple_tree → tree, coconut_tree → palm_tree, waiting to respawn.
        if (entry?.regrowId || entry?.regrowAt != null) return true;
        return false;
    }

    function canDropOff(pawn, leader) {
        if (!pawn) return false;
        if (pawn === leader) return false;
        if (pawn.role === "leader") return false;
        const pid = pawn.id || pawn.pawnId;
        const lid = leader?.id || leader?.pawnId;
        if (pid && lid && pid === lid) return false;
        return true;
    }

    function partyHasRoom(partyLen, cap) {
        const n = Math.max(0, Math.floor(Number(partyLen) || 0));
        const c = Math.max(1, Math.floor(Number(cap) || 6));
        return n < c;
    }

    function recruitParksWhenFull(partyLen, inOwnedRange, cap) {
        return !partyHasRoom(partyLen, cap) && !!inOwnedRange;
    }

    function transferMode(distTiles, walkMax) {
        const d = Number(distTiles) || 0;
        const max = Number(walkMax) > 0 ? Number(walkMax) : WALK_TRANSFER_TILES;
        return d <= max + 0.05 ? "walk" : "teleport";
    }

    function shouldPin(settle, settlerCount) {
        if (!settle) return false;
        if ((Number(settlerCount) || 0) > 0) return true;
        if ((settle.stationUids || []).length > 0) return true;
        return false;
    }

    function gatherShouldWork(have, target) {
        const want = Math.floor(Number(target) || 0);
        if (!(want > 0)) return false;
        return (Math.floor(Number(have) || 0) < want);
    }

    /**
     * How many of a ground drop to haul. No stock target means take the stack.
     * Otherwise take only what still fits under the limit (baskets + settlers,
     * not other piles on the ground).
     */
    function haulTakeQty(have, target, qty) {
        const n = Math.max(1, Math.floor(Number(qty) || 1));
        const want = Math.floor(Number(target) || 0);
        if (!(want > 0)) return n;
        const room = want - Math.floor(Number(have) || 0);
        if (room <= 0) return 0;
        return Math.min(n, room);
    }

    /** Night or untreated injury: stay in / go to a lean-to. Dawn + healthy: get up. */
    function settlerShouldSleep(isNight, injured) {
        return !!(isNight || injured);
    }

    /** How often a long research stand re-checks jobs, eat, and sleep. */
    const RESEARCH_NEEDS_TICKS = 10;

    function isBusyWork(type) {
        return type === "chop" || type === "gather" || type === "haul" || type === "stash"
            || type === "cook" || type === "cook_light" || type === "cook_stoke"
            || type === "leather" || type === "doctor" || type === "research";
    }

    /** Job column for a plan / channel type, or null if it is not a settler job. */
    function jobForWork(type) {
        const t = String(type || "");
        if (t === "cook" || t === "cook_light" || t === "cook_stoke") return "cook";
        if (t === "stash") return "haul";
        if (t === "tend") return "doctor";
        if (t === "flesh" || t === "brain" || t === "craft" || t === "skin") return "leather";
        if (t === "chop" || t === "gather" || t === "haul" || t === "leather"
            || t === "doctor" || t === "research") return t;
        return null;
    }

    function jobEnabled(row, typeOrName) {
        const name = JOBS.includes(typeOrName) ? typeOrName : jobForWork(typeOrName);
        if (!name) return true;
        return normalizeJobs(row)[name] >= 1;
    }

    function sameCookJob(held, next) {
        if (!held || !next) return false;
        const hb = held.bill || null;
        const nb = next.bill || null;
        const fireA = held.fire?.uid || held.fire?.entry?.uid || held.entry?.uid || held.uid;
        const fireB = next.fire?.uid || next.fire?.entry?.uid || next.entry?.uid || next.uid;
        if (fireA && fireB && fireA !== fireB) return false;
        if (hb?.id && nb?.id) return hb.id === nb.id;
        if (hb?.leftover || nb?.leftover) {
            return !!hb?.leftover && !!nb?.leftover
                && (hb.method || "stick_roast") === (nb.method || "stick_roast");
        }
        return (hb?.recipeId || hb?.method || "") === (nb?.recipeId || nb?.method || "");
    }

    function isFirestarter(stack, getItem) {
        if (!stack?.id) return false;
        const meta = typeof getItem === "function" ? getItem(stack.id) : null;
        return (stack.use || meta?.use) === "light_fire";
    }

    function cookCanLight(opts = {}) {
        if (opts.knowsFire === false) return false;
        if (!opts.hasFirestarter) return false;
        return !!(opts.hasFuel || opts.hasGroundRecipe);
    }

    /** Melee damage for "keep the best weapon" while stashing. Matches Party.meleeDamageOf. */
    function weaponDamage(stack, getItem) {
        if (!stack?.id) return 0;
        const knap = stack.toolClass && Number(stack.knapDamage);
        if (Number.isFinite(knap) && knap > 0) return knap;
        const meta = typeof getItem === "function" ? getItem(stack.id) : null;
        const dmg = Number(meta?.weapon?.melee?.damage ?? meta?.weapon?.damage);
        if (meta?.weapon?.type === "melee" && dmg > 0) return dmg;
        if (stack.toolClass && Number(meta?.weapon?.melee?.damage) > 0) {
            return Number(meta.weapon.melee.damage);
        }
        const attacks = meta?.weapon?.attacks;
        if (meta?.weapon?.type === "melee" && Array.isArray(attacks)) {
            let best = 0;
            for (const a of attacks) {
                if (a?.unarmed || a?.source === "otherHand") continue;
                const ad = Number(a.damage) || 0;
                if (ad > best) best = ad;
            }
            if (best > 0) return best;
        }
        return 0;
    }

    /**
     * Inventory indices settlers should keep on them: best melee, optionally
     * one bandage while a doctor job has patients, and one pigment while a
     * painting circle still needs it. Worn equipment is not inventory.
     */
    function keepIndices(inventory, getItem, opts = {}) {
        const keep = new Set();
        const inv = Array.isArray(inventory) ? inventory : [];
        let bestI = -1;
        let bestD = 0;
        for (let i = 0; i < inv.length; i++) {
            const d = weaponDamage(inv[i], getItem);
            if (d > bestD) {
                bestD = d;
                bestI = i;
            }
        }
        if (bestD > 0 && bestI >= 0) keep.add(bestI);
        if (opts.keepBandage) {
            for (let i = 0; i < inv.length; i++) {
                if (keep.has(i)) continue;
                const s = inv[i];
                if (!s?.id) continue;
                const meta = typeof getItem === "function" ? getItem(s.id) : null;
                if (meta?.bandage) {
                    keep.add(i);
                    break;
                }
            }
        }
        if (opts.keepPigment) {
            const pred = typeof opts.isPigment === "function"
                ? opts.isPigment
                : (s) => {
                    const R = researchMod();
                    const meta = typeof getItem === "function" ? getItem(s?.id) : null;
                    return !!(s && R?.isPigment?.(meta, s));
                };
            for (let i = 0; i < inv.length; i++) {
                if (keep.has(i)) continue;
                const s = inv[i];
                if (s?.id && pred(s)) {
                    keep.add(i);
                    break;
                }
            }
        }
        return keep;
    }

    function hasStashable(inventory, overflow, getItem, canStore, opts = {}) {
        const keep = keepIndices(inventory, getItem, opts);
        const store = typeof canStore === "function" ? canStore : () => true;
        const check = (slots, skipKeep) => {
            for (let i = 0; i < (slots || []).length; i++) {
                if (skipKeep && keep.has(i)) continue;
                const s = slots[i];
                if (s && store(s)) return true;
            }
            return false;
        };
        return check(inventory, true) || check(overflow, false);
    }

    function stackFoodKc(stack, getItem) {
        if (!stack?.id) return 0;
        const meta = typeof getItem === "function" ? getItem(stack.id) : null;
        const food = {
            ...(meta?.food || {}),
            ...(stack.food && typeof stack.food === "object" ? stack.food : {})
        };
        return Number(food.kc) || 0;
    }

    /** Edible leftover that a basket will take — dump before painting so others can eat. */
    function hasStashableFood(inventory, overflow, getItem, canStore, opts = {}) {
        const keep = keepIndices(inventory, getItem, opts);
        const store = typeof canStore === "function" ? canStore : () => true;
        const check = (slots, skipKeep) => {
            for (let i = 0; i < (slots || []).length; i++) {
                if (skipKeep && keep.has(i)) continue;
                const s = slots[i];
                if (s && stackFoodKc(s, getItem) > 0 && store(s)) return true;
            }
            return false;
        };
        return check(inventory, true) || check(overflow, false);
    }

    /** Full pockets or overflow that a basket will take — dump before more work. */
    function stashIsUrgent(inventory, overflow, getItem, canStore, opts = {}) {
        if (!hasStashable(inventory, overflow, getItem, canStore, opts)) return false;
        const store = typeof canStore === "function" ? canStore : () => true;
        for (const s of overflow || []) {
            if (s && store(s)) return true;
        }
        const inv = inventory || [];
        const empty = inv.filter((s) => !s).length;
        return empty === 0;
    }

    function storageLayoutCols(n) {
        const count = Math.max(1, Math.floor(Number(n) || 1));
        return Math.min(4, count);
    }

    /** Colony food in pockets — return it before painting so others can eat. */
    function stashFoodInsteadOfResearch(state) {
        if (state.hasFoodStash && state.stashBasket) {
            return { type: "stash", target: state.stashBasket };
        }
        return null;
    }

    /**
     * Painting is leftover work. If haul is at least as important, leave the
     * circle for dumps, ground piles, and wrong-bin stacks.
     */
    function haulInsteadOfResearch(row, state) {
        const jobs = normalizeJobs(row);
        if (!(jobs.haul >= 1)) return null;
        if (jobs.research >= 1 && jobs.haul > jobs.research) return null;
        if (state.stashUrgent && state.stashBasket) {
            return { type: "stash", target: state.stashBasket };
        }
        const haulReason = state.haulMerge?.reason;
        const haulWrong = !!state.haulMerge
            && (haulReason === "wrong" || haulReason === "better");
        if (haulWrong && state.mergeNeedsRoom && state.stashBasket) {
            return { type: "stash", target: state.stashBasket };
        }
        if (haulWrong) return { type: "haul", target: state.haulMerge };
        if (state.haulDrop || state.haulOutput || state.haulMerge) {
            return { type: "haul", target: state.haulDrop || state.haulOutput || state.haulMerge };
        }
        if (state.hasStash && state.stashBasket) {
            return { type: "stash", target: state.stashBasket };
        }
        return null;
    }

    /**
     * Painting is leftover work. If tailoring is at least as important, leave
     * the circle to tan, smoke, or sew.
     */
    function leatherInsteadOfResearch(row, state) {
        const jobs = normalizeJobs(row);
        if (!(jobs.leather >= 1)) return null;
        if (jobs.research >= 1 && jobs.leather > jobs.research) return null;
        if (state.leatherWork || state.benchBill) {
            return { type: "leather", target: state.leatherWork || state.benchBill };
        }
        return null;
    }

    /**
     * Highest-priority next action for a parked settler. Phaser-free so tests
     * and both LocalSim / dedicated AI share one policy.
     */
    function planWork(state = {}) {
        const AUTO = Number(state.autoEatBelow) > 0 ? Number(state.autoEatBelow) : 1000;
        const busy = !!state.busy;
        const row = state.jobs || defaultJobs();
        const night = !!state.isNight;
        const injured = !!state.injured;
        const busyJob = state.busyJob && isBusyWork(state.busyJob.type) && jobEnabled(row, state.busyJob.type)
            ? state.busyJob
            : null;
        const poll = !!(busy && busyJob && state.reconsiderNeeds && busyJob.type === "research");
        if (busy && busyJob && !poll) {
            if (busyJob.type === "research") {
                const foodFirst = stashFoodInsteadOfResearch(state);
                if (foodFirst) return foodFirst;
                const haulFirst = haulInsteadOfResearch(row, state);
                if (haulFirst) return haulFirst;
                const leatherFirst = leatherInsteadOfResearch(row, state);
                if (leatherFirst) return leatherFirst;
            }
            // A finished count/until bill leaves a leather hold pointing at the bench.
            // Don't keep sewing just because the previous scan still had that job.
            // Same for cook: a paused or reordered bill must drop the roast hold.
            const keepLeather = busyJob.type !== "leather" || state.leatherWork || state.benchBill;
            const keepCook = busyJob.type !== "cook" || sameCookJob(busyJob.target, state.cookBill);
            if (keepLeather && keepCook) return busyJob;
        }
        if (!busy && (Number(state.kc) || 0) < AUTO && state.canEat !== false) return { type: "eat" };
        if (state.isOrphan) return { type: "idle" };
        if (!busy && settlerShouldSleep(night, injured) && state.bed) {
            return { type: "sleep", target: state.bed };
        }
        const haulOn = enabledJobs(row).includes("haul");
        if (haulOn && state.stashUrgent && state.stashBasket) {
            return { type: "stash", target: state.stashBasket };
        }
        const haulReason = state.haulMerge?.reason;
        const haulWrong = haulOn && state.haulMerge
            && (haulReason === "wrong" || haulReason === "better");
        // Free a hotbar slot before carrying a mis-stored stack.
        if (haulWrong && state.mergeNeedsRoom && state.stashBasket) {
            return { type: "stash", target: state.stashBasket };
        }
        if (haulWrong) return { type: "haul", target: state.haulMerge };
        if (!busy && settlerShouldSleep(night, injured)) return { type: "idle" };
        for (const job of enabledJobs(row)) {
            if (job === "doctor" && (state.patients || []).length) {
                return { type: "doctor", target: state.patients[0] };
            }
            if (job === "cook") {
                if (state.unlitFire && cookCanLight(state.light || {})) {
                    return { type: "cook_light", target: state.unlitFire };
                }
                if (state.cookBill) return { type: "cook", target: state.cookBill };
                if (state.stokeFire) return { type: "cook_stoke", target: state.stokeFire };
            }
            if (job === "leather" && (state.leatherWork || state.benchBill)) {
                return { type: "leather", target: state.leatherWork || state.benchBill };
            }
            if (job === "haul") {
                if (state.haulDrop || state.haulOutput || state.haulMerge) {
                    return { type: "haul", target: state.haulDrop || state.haulOutput || state.haulMerge };
                }
                if (state.hasStash && state.stashBasket) {
                    return { type: "stash", target: state.stashBasket };
                }
            }
            if (job === "gather" && state.gatherThing) return { type: "gather", target: state.gatherThing };
            if (job === "chop" && state.chopTree) return { type: "chop", target: state.chopTree };
            if (job === "research" && state.researchCircle) {
                if (poll) {
                    if ((Number(state.kc) || 0) < AUTO && state.canEat !== false) {
                        return { type: "eat" };
                    }
                    if (settlerShouldSleep(night, injured)) {
                        if (state.bed) return { type: "sleep", target: state.bed };
                        return { type: "idle" };
                    }
                }
                const foodFirst = stashFoodInsteadOfResearch(state);
                if (foodFirst) return foodFirst;
                return { type: "research", target: state.researchCircle };
            }
        }
        if (haulOn && state.hasStash && state.stashBasket) {
            return { type: "stash", target: state.stashBasket };
        }
        if (poll) {
            if ((Number(state.kc) || 0) < AUTO && state.canEat !== false) return { type: "eat" };
            if (settlerShouldSleep(night, injured)) {
                if (state.bed) return { type: "sleep", target: state.bed };
                return { type: "idle" };
            }
        }
        return { type: "idle" };
    }

    function _lc(s) {
        return String(s || "").trim().toLowerCase();
    }

    function _an(s) {
        const n = _lc(s);
        if (!n) return n;
        return ("aeiou".includes(n[0]) ? "an " : "a ") + n;
    }

    function _itemName(stackOrId, getItem) {
        if (stackOrId == null) return "";
        if (typeof stackOrId === "string") return getItem?.(stackOrId)?.name || stackOrId;
        if (stackOrId.customName) return stackOrId.customName;
        const nested = stackOrId.item;
        if (nested?.name) return nested.name;
        const id = stackOrId.id || nested?.id;
        const meta = id ? getItem?.(id) : null;
        return meta?.name || nested?.name || id || "";
    }

    function _haulNoun(stack, getItem) {
        const name = _itemName(stack, getItem);
        if (!name) return "";
        const low = _lc(name);
        const n = Math.max(1, Number(stack?.quantity) || 1);
        if (n > 1 && !low.endsWith("s")) return `${low}s`;
        return low;
    }

    function _thingName(thing, getThing) {
        if (!thing) return "";
        if (thing.meta?.name) return thing.meta.name;
        const id = thing.entry?.id || thing.id;
        return getThing?.(id)?.name || id || "";
    }

    function _lootable(thing, getThing) {
        if (thing?.meta?.lootable) return thing.meta.lootable;
        const nested = thing?.entry;
        if (nested?.lootable) return nested.lootable;
        const id = nested?.id || thing?.id;
        return getThing?.(id)?.lootable || null;
    }

    function _billFoods(bill, getItem) {
        const ids = Array.isArray(bill?.allowedIds) ? bill.allowedIds : [];
        if (!ids.length) return "";
        const names = [];
        for (const id of ids) {
            const n = _lc(_itemName(id, getItem));
            if (n && !names.includes(n)) names.push(n);
            if (names.length >= 3) break;
        }
        if (!names.length) return "";
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} or ${names[1]}`;
        return `${names[0]}, ${names[1]}…`;
    }

    function _hideTypeNoun(stackOrId, getItem) {
        const id = typeof stackOrId === "string"
            ? stackOrId
            : (stackOrId?.id || stackOrId?.item?.id);
        if (!id) return "";
        const def = typeof getItem === "function" ? getItem(id) : null;
        const animal = hideAnimalOf(def, id);
        return animal ? `${animal} hide` : "hide";
    }

    function _billHideNoun(bill, getItem) {
        const ids = Array.isArray(bill?.allowedIds) ? bill.allowedIds : [];
        const animals = [];
        for (const id of ids) {
            const def = typeof getItem === "function" ? getItem(id) : null;
            const animal = hideAnimalOf(def, id);
            if (animal && !animals.includes(animal)) animals.push(animal);
        }
        if (animals.length === 1) return `${animals[0]} hide`;
        return "hide";
    }

    function _hideJobNoun(job, getItem) {
        const hang = job?.station?.slots?.[0]
            || job?.entry?.slots?.[0]
            || job?.drop;
        return _hideTypeNoun(hang, getItem) || _billHideNoun(job?.bill, getItem);
    }

    function _dropAsStack(drop) {
        if (!drop) return null;
        const id = drop.item?.id || (typeof drop.id === "string" ? drop.id : null);
        if (!id && !drop.item) return null;
        return {
            id,
            item: drop.item,
            quantity: drop.quantity || 1,
            customName: drop.customName
        };
    }

    function _fireEntry(fire) {
        return fire?.entry || fire;
    }

    function _fireCook(fire) {
        if (typeof fire?.getCook === "function") return fire.getCook();
        return _fireEntry(fire)?.cook || null;
    }

    function _fireCatalyst(fire) {
        if (typeof fire?.getCatalyst === "function") return fire.getCatalyst();
        return _fireEntry(fire)?.catalyst || null;
    }

    function _fireIsLit(fire) {
        if (typeof fire?.isLit === "function") return !!fire.isLit();
        const id = _fireEntry(fire)?.id;
        if (id === "unlit_campfire") return false;
        if (id === "campfire") return true;
        return false;
    }

    function _fireHasFuel(fire) {
        if (typeof fire?.hasFuel === "function") return !!fire.hasFuel();
        const fuel = _fireEntry(fire)?.fuel;
        if (Array.isArray(fuel)) return fuel.some((s) => s && s.quantity > 0);
        return !!fuel;
    }

    function _simmerFilled(fire) {
        if (typeof fire?.simmerFilledCount === "function") return fire.simmerFilledCount() || 0;
        const slots = _fireEntry(fire)?.simmerSlots;
        if (Array.isArray(slots)) return slots.filter(Boolean).length;
        return 0;
    }

    function _cookActLabel(job, getItem) {
        const fire = job?.fire;
        const bill = job?.bill;
        const title = billTitle(bill) || "meal";
        const method = bill?.method || "stick_roast";
        const cat = _fireCatalyst(fire);
        if (method === "shell_simmer" && cookOutputReady(getItem, cat, bill)) {
            const n = _itemName(cat, getItem);
            return n ? `Taking ${_lc(n)}` : "Taking a meal";
        }
        const cook = _fireCook(fire);
        if (cook) {
            const n = _itemName(cook, getItem);
            if (n) {
                if (cookOutputReady(getItem, cook, bill)) return `Taking ${_lc(n)}`;
                if (bill?.leftover) return `Taking ${_lc(n)}`;
                if (method === "smoke_hide") return `Smoking ${_hideTypeNoun(cook, getItem)}`;
                const roast = method === "stick_roast" || title === "Roast";
                return `${roast ? "Roasting" : "Cooking"} ${_lc(n)}`;
            }
        }
        if (fire && !_fireIsLit(fire)) return "Lighting a fire";
        if (fire && !_fireHasFuel(fire)) return "Stoking the fire";
        if (method === "shell_simmer") {
            if (_simmerFilled(fire) > 0) return "Simmering a meal";
            return "Simmering";
        }
        if (fire && !isCookTool(getItem, cat, method)) {
            if (method === "stick_roast") return "Getting a Sharp Stick";
            if (method === "smoke_hide") return "Getting a Drying Rack";
            return "Getting a cooking tool";
        }
        if (method === "stick_roast" && isCookTool(getItem, cat, method) && !cook && bill?.leftover) {
            return "Taking a Sharp Stick";
        }
        const foods = _billFoods(bill, getItem);
        if (method === "smoke_hide") {
            return `Smoking ${_billHideNoun(bill, getItem)}`;
        }
        if (foods) return `Cooking ${_lc(title)} (${foods})`;
        return `Cooking ${_lc(title)}`;
    }

    function _leatherActLabel(job, getItem, getThing) {
        const station = job?.station || job?.entry || job;
        const bill = job?.bill;
        const method = bill?.method;
        const stationId = station?.entry?.id || station?.id;
        if (job?.kind === "bench" || stationId === "skinworking_bench") {
            const title = billTitle(bill);
            if (title) return title.startsWith("Make ") ? title : `Sewing ${_lc(title)}`;
            const name = _thingName(station, getThing);
            return name ? `Working at ${_an(name)}` : "Working hides";
        }
        const hide = _hideJobNoun(job, getItem);
        const typed = hide && hide !== "hide";
        if (method === "flesh_hide") return typed ? `Fleshing ${hide}` : "Fleshing hides";
        if (method === "dry_hide") return typed ? `Drying ${hide}` : "Drying hides";
        if (method === "soak_hide") {
            if (job?.kind === "soak_pickup") {
                return typed ? `Taking soaked ${hide}` : "Taking soaked hides";
            }
            return typed ? `Soaking ${hide}` : "Soaking hides";
        }
        if (method === "dehair_hide") return typed ? `Dehairing ${hide}` : "Dehairing hides";
        if (method === "brain_hide") return typed ? `Brain-tanning ${hide}` : "Brain-tanning hides";
        if (method === "smoke_hide" || job?.kind === "smoke") return _cookActLabel(job, getItem);
        if (stationId === "drying_rack") return typed ? `Working ${hide}` : "Working hides";
        return typed ? `Working ${hide}` : "Working hides";
    }

    /**
     * Human-readable settler job line for tooltips. Phaser-free so sim
     * snapshots and client AI share one string.
     */
    function actLabel(plan, ctx = {}) {
        const getItem = ctx.getItem || (() => null);
        const getThing = ctx.getThing || (() => null);
        const t = plan?.type;
        if (t === "fight") return "Fighting";
        if (t === "eat") return "Getting food";
        if (t === "cook_light") return "Lighting a fire";
        if (t === "cook_stoke") return "Stoking the fire";
        if (t === "flesh") return "Fleshing hides";
        if (t === "brain") return "Brain-tanning hides";
        if (t === "craft") return "Crafting";
        if (t === "tend" || t === "doctor") {
            const who = ctx.patientName != null ? ctx.patientName : pawnDisplayName(plan?.target);
            return who && who !== "Someone" ? `Tending ${who}` : "Tending";
        }
        if (t === "cook") return _cookActLabel(plan.target, getItem);
        if (t === "haul") {
            if (plan.target?.kind === "pack") return "Stacking storage";
            if (plan.target?.kind === "move") {
                const noun = _haulNoun({ id: plan.target.stackId }, getItem);
                if (plan.target.reason === "merge") {
                    return noun ? `Stacking ${noun}` : "Stacking storage";
                }
                return noun ? `Hauling ${noun}` : "Hauling";
            }
            const noun = _haulNoun(_dropAsStack(plan.target), getItem) || ctx.haulWhat;
            return noun ? `Hauling ${noun}` : "Hauling";
        }
        if (t === "stash") {
            const noun = _haulNoun(ctx.stashStack, getItem) || ctx.haulWhat;
            return noun ? `Hauling ${noun}` : "Hauling";
        }
        if (t === "gather") {
            const thing = plan.target;
            const loot = _lootable(thing, getThing);
            const lootId = loot?.item;
            const lootName = _itemName(lootId, getItem);
            if (lootName) {
                const yieldN = Math.max(1, Number(loot.yield) || 1);
                return `Gathering ${_haulNoun({ id: lootId, quantity: yieldN }, getItem)}`;
            }
            const plant = _thingName(thing, getThing);
            return plant ? `Gathering from ${_an(plant)}` : "Gathering";
        }
        if (t === "chop") {
            const tree = _thingName(plan.target, getThing);
            return tree ? `Chopping ${_an(tree)}` : "Chopping";
        }
        if (t === "research") return "Painting";
        if (t === "leather") return _leatherActLabel(plan.target, getItem, getThing);
        if (t === "sleep") {
            const bed = plan.target?.entry || plan.target;
            const name = ctx.bedName || getThing(bed?.id)?.name;
            if (ctx.asleep) {
                return name ? `Sleeping in ${_an(name)}` : "Sleeping";
            }
            return name ? `Going to sleep in ${_an(name)}` : "Going to sleep";
        }
        if (t === "idle" || !t) return "Idle";
        return "Idle";
    }

    function cardinalHeading(rng) {
        const dirs = [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 }
        ];
        const roll = typeof rng === "function" ? rng() : Math.random();
        const i = Math.min(dirs.length - 1, Math.max(0, Math.floor(roll * dirs.length)));
        const d = dirs[i];
        return { x: d.x, y: d.y };
    }

    function pawnDisplayName(p) {
        if (!p) return "Someone";
        if (typeof p.displayName === "function") {
            const n = p.displayName();
            if (n) return String(n);
        }
        return p.pawnName || p.name || "Someone";
    }

    /** Copy for the destroy-stone confirmation overlay. */
    function destroyConfirmCopy(settleName, peopleNames) {
        const name = clampName(settleName) || "Camp";
        const names = (peopleNames || []).map((n) => String(n || "").trim()).filter(Boolean);
        return {
            question: `Are you sure you'd like to destroy ${name}?`,
            peopleLead: names.length ? "The following people will become wanderers:" : "",
            names
        };
    }

    function idleHome(settle) {
        return { x: settle?.x || 0, y: (settle?.y || 0) + 8 };
    }

    function idleStandMs(rng) {
        const roll = typeof rng === "function" ? rng : Math.random;
        return IDLE_STAND_MIN_MS + roll() * (IDLE_STAND_MAX_MS - IDLE_STAND_MIN_MS);
    }

    function idleRoamDistTiles(settle, x, y, ts) {
        const h = idleHome(settle);
        const cell = ts || 16;
        return Math.hypot((x || 0) - h.x, (y || 0) - h.y) / cell;
    }

    /** Random chill-spot around the stone, a short walk from `from` when given. */
    function idleRoamPoint(settle, rng, ts, from) {
        const h = idleHome(settle);
        const cell = ts || 16;
        const roll = typeof rng === "function" ? rng : Math.random;
        let x = h.x;
        let y = h.y;
        for (let i = 0; i < 8; i++) {
            const ang = roll() * Math.PI * 2;
            const r = cell * (IDLE_ROAM_MIN + roll() * (IDLE_ROAM_MAX - IDLE_ROAM_MIN));
            x = h.x + Math.cos(ang) * r;
            y = h.y + Math.sin(ang) * r;
            if (!from || Math.hypot(x - from.x, y - from.y) > cell * 1.25) break;
        }
        return { x, y };
    }

    /**
     * Exclusive settler jobs (one cook per campfire, one chopper per tree, …).
     * Not persisted — runtime only.
     */
    function createWorkClaims() {
        const byKey = new Map();
        const byPawn = new Map();
        return {
            claimedBy(key) {
                if (!key) return null;
                return byKey.get(key) || null;
            },
            held(pawnId) {
                if (!pawnId) return null;
                return byPawn.get(pawnId) || null;
            },
            isFree(key, pawnId) {
                if (!key) return true;
                const who = byKey.get(key);
                return !who || who === pawnId;
            },
            claim(key, pawnId) {
                if (!pawnId) return false;
                const prev = byPawn.get(pawnId);
                if (prev && prev !== key && byKey.get(prev) === pawnId) byKey.delete(prev);
                if (!key) {
                    byPawn.delete(pawnId);
                    return true;
                }
                const who = byKey.get(key);
                if (who && who !== pawnId) return false;
                byKey.set(key, pawnId);
                byPawn.set(pawnId, key);
                return true;
            },
            release(pawnId) {
                if (!pawnId) return;
                const key = byPawn.get(pawnId);
                byPawn.delete(pawnId);
                if (key && byKey.get(key) === pawnId) byKey.delete(key);
            },
            prune(aliveIds) {
                const live = aliveIds instanceof Set ? aliveIds : new Set(aliveIds || []);
                for (const [pid, key] of [...byPawn]) {
                    if (live.has(pid)) continue;
                    byPawn.delete(pid);
                    if (key && byKey.get(key) === pid) byKey.delete(key);
                }
            }
        };
    }

    return {
        RADIUS_TILES,
        WALK_TRANSFER_TILES,
        IDLE_ROAM_SOFT,
        IDLE_ROAM_HARD,
        IDLE_STAND_MIN_MS,
        IDLE_STAND_MAX_MS,
        NAME_MAX,
        JOBS,
        JOB_LABELS,
        JOB_NAMES,
        JOB_WORK,
        STOCK_ITEMS,
        STOCK_DEFAULTS,
        BILL_MODES,
        BILL_RECIPES,
        BILL_STATION_THING,
        SIMMER_INGREDIENT_IDS,
        SIMMER_RESULT,
        SIMMER_MIN_SLOTS,
        SIMMER_SLOTS,
        HIDE_ANIMALS,
        HIDE_STEPS,
        BENCH_RECIPES,
        ADDABLE,
        uid,
        clampName,
        renameChat,
        defaultJobs,
        normalizeJobs,
        cyclePriority,
        raisePriority,
        pickJob,
        enabledJobs,
        defaultStock,
        normalizeStock,
        stockItemsFromThing,
        filterStockItems,
        distTiles,
        inRange,
        circlesOverlap,
        canPlace,
        isAddableId,
        stationKind,
        ensureSettlement,
        createSettlement,
        isNight,
        stackQty,
        countInSlots,
        countStock,
        countPawnStock,
        countDropStock,
        dropItemId,
        stockTarget,
        stockShort,
        makeBill,
        billsOf,
        setBills,
        addBill,
        billRecipesFor,
        billRecipeUnlocked,
        billRecipeById,
        billStationKindOf,
        billStationThingId,
        cookInputsForMethod,
        billInputsFor,
        billAllowsInput,
        billHasMaterials,
        billWantsMaterials,
        hideItemId,
        hideStepOf,
        hideAnimalOf,
        hideStageOf,
        hideInputsForStep,
        hideAllowsStack,
        hideResultIdsForBill,
        hideToolNeed,
        hideSoakHasWork,
        nearestWaterPoint,
        isSimmerIngredientId,
        isCookTool,
        simmerEmptyCount,
        countPredQty,
        cookInputReady,
        cookOutputReady,
        cookFitsBill,
        sameCookJob,
        billTitle,
        billRecipeTitle,
        cycleBillMode,
        billModeLabel,
        billQtyLabel,
        billIsComplete,
        moveBill,
        removeBill,
        syncBillResults,
        untilHave,
        billIsActive,
        activeBill,
        noteBillCrafted,
        jobLabel,
        jobTooltip,
        jobsFor,
        setJob,
        ownedOf,
        atPoint,
        unlinkStation,
        removeStation,
        chunkKeysFor,
        fruitTreeId,
        chopSkipsTree,
        canDropOff,
        partyHasRoom,
        recruitParksWhenFull,
        transferMode,
        shouldPin,
        gatherShouldWork,
        haulTakeQty,
        settlerShouldSleep,
        RESEARCH_NEEDS_TICKS,
        isBusyWork,
        jobForWork,
        jobEnabled,
        isFirestarter,
        cookCanLight,
        weaponDamage,
        keepIndices,
        hasStashable,
        hasStashableFood,
        stashIsUrgent,
        storageLayoutCols,
        planWork,
        actLabel,
        idleHome,
        idleStandMs,
        idleRoamDistTiles,
        idleRoamPoint,
        createWorkClaims,
        cardinalHeading,
        pawnDisplayName,
        destroyConfirmCopy
    };
});
