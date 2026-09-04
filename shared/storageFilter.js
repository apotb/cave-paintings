/**
 * RimWorld-style storage filters for settlement baskets. Phaser-free.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.StorageFilter = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const PRIORITIES = ["low", "normal", "preferred", "important", "critical"];
    const PRIORITY_LABELS = {
        low: "Low",
        normal: "Normal",
        preferred: "Preferred",
        important: "Important",
        critical: "Critical"
    };
    const TOOL_CLASSES = [
        { id: "tool:awl", name: "Awl", cls: "awl" },
        { id: "tool:chopper", name: "Chopper", cls: "chopper" },
        { id: "tool:knife", name: "Knife", cls: "knife" },
        { id: "tool:scraper", name: "Scraper", cls: "scraper" },
        { id: "tool:spear_tip", name: "Spear Tip", cls: "spear_tip" }
    ];
    const WOOD_IDS = { log: true, stick: true, leaf: true };
    const STONE_IDS = { pebble: true, flint: true };
    const RAW_FRUIT_IDS = {
        blueberry: true,
        coconut: true,
        apple: true
    };
    const MEAL_IDS = { coconut_meal: true };
    const BLANK_TOOL_IDS = { stone_tool: true, flint_tool: true };

    const CATEGORY_TREE = [
        {
            id: "apparel",
            name: "Apparel",
            children: [
                { id: "apparel/clothing", name: "Clothing" },
                { id: "apparel/equipment", name: "Equipment" },
                { id: "apparel/armor", name: "Armor" }
            ]
        },
        { id: "buildings", name: "Buildings" },
        {
            id: "food",
            name: "Food",
            children: [
                { id: "food/meals", name: "Meals" },
                { id: "food/raw", name: "Raw food" },
                { id: "food/roasted", name: "Roasted food" }
            ]
        },
        { id: "junk", name: "Junk" },
        {
            id: "materials",
            name: "Materials",
            children: [
                { id: "materials/fuel", name: "Fuel" },
                { id: "materials/hides", name: "Hides" },
                { id: "materials/leather", name: "Leather" },
                { id: "materials/stone", name: "Stone" },
                { id: "materials/wood", name: "Wood" }
            ]
        },
        { id: "medicine", name: "Medicine" },
        { id: "tools", name: "Tools" },
        { id: "weapons", name: "Weapons" }
    ];

    function sortByName(a, b) {
        return String(a.name || a.id || "").localeCompare(String(b.name || b.id || ""), undefined, {
            sensitivity: "base"
        });
    }

    function cloneTree(nodes) {
        return (nodes || []).map((n) => ({
            id: n.id,
            name: n.name,
            children: n.children ? cloneTree(n.children) : undefined,
            items: []
        }));
    }

    function findNode(nodes, id) {
        for (const n of nodes || []) {
            if (n.id === id) return n;
            const hit = findNode(n.children, id);
            if (hit) return hit;
        }
        return null;
    }

    function ancestorIds(nodes, id, trail = []) {
        for (const n of nodes || []) {
            const next = trail.concat(n.id);
            if (n.id === id) return next;
            const hit = ancestorIds(n.children, id, next);
            if (hit) return hit;
        }
        return null;
    }

    function collectDescendants(node, cats, keys) {
        if (!node) return;
        cats.push(node.id);
        for (const it of node.items || []) keys.push(it.id);
        for (const ch of node.children || []) collectDescendants(ch, cats, keys);
    }

    function roastResultIds(items) {
        const set = new Set();
        for (const it of items || []) {
            const cook = it?.cook;
            if (!cook || typeof cook !== "object") continue;
            for (const [k, v] of Object.entries(cook)) {
                if (k === "method") continue;
                if (v && typeof v === "object" && v.result) set.add(v.result);
            }
        }
        return set;
    }

    function stackId(stack) {
        if (!stack) return null;
        if (typeof stack.id === "string" && stack.id) return stack.id;
        if (stack.item?.id) return stack.item.id;
        return null;
    }

    function defOf(stack, getItem) {
        const id = stackId(stack);
        if (stack && typeof stack === "object" && stack.food && stack.cook) return stack;
        return typeof getItem === "function" ? getItem(id) : null;
    }

    function filterKey(stack, def) {
        // Knapped class lives on the stack (chopper, knife, scraper, awl, spear tip).
        // Item-def classes (bone as a single-use awl) stay their own item.
        const cls = stack?.toolClass;
        if (cls && TOOL_CLASSES.some((t) => t.cls === cls)) return `tool:${cls}`;
        return stackId(stack) || def?.id || null;
    }

    function leafCategory(def, roastIds) {
        if (!def) return "junk";
        if (typeof def.storageCategory === "string" && def.storageCategory) return def.storageCategory;
        const id = def.id;
        if (def.place?.thing) return "buildings";
        if (def.bandage) return "medicine";
        if (def.toolClass || BLANK_TOOL_IDS[id]) return "tools";
        if (def.weapon) return "weapons";
        if (def.equip) {
            const layer = String(def.equip.layer || "");
            if (layer === "belt" || layer === "pack") return "apparel/equipment";
            return "apparel/clothing";
        }
        if (RAW_FRUIT_IDS[id]) return "food/raw";
        const hideStage = def.hide?.stage;
        if (hideStage === "leather" || (id && String(id).endsWith("_leather"))) return "materials/leather";
        if (def.hide) return "materials/hides";
        if (WOOD_IDS[id]) return "materials/wood";
        if (STONE_IDS[id]) return "materials/stone";
        if (MEAL_IDS[id] || (def.ingredients && def.ingredients.length) || def.food?.ingredients) {
            return "food/meals";
        }
        if ((roastIds && roastIds.has(id)) || (id && /^roast/i.test(id))) return "food/roasted";
        if (def.food && (def.cook || Number(def.food.kc) > 0 || RAW_FRUIT_IDS[id])) return "food/raw";
        if (def.fuel) return "materials/fuel";
        return "junk";
    }

    function emptyFilter() {
        return {
            priority: "normal",
            offCategories: [],
            offItems: [],
            onItems: []
        };
    }

    function uniqStrings(list) {
        const out = [];
        const seen = new Set();
        for (const v of list || []) {
            const s = String(v || "");
            if (!s || seen.has(s)) continue;
            seen.add(s);
            out.push(s);
        }
        return out;
    }

    function normalize(raw) {
        const base = emptyFilter();
        if (!raw || typeof raw !== "object") return base;
        const p = String(raw.priority || "normal");
        base.priority = PRIORITIES.includes(p) ? p : "normal";
        base.offCategories = uniqStrings(raw.offCategories);
        base.offItems = uniqStrings(raw.offItems);
        base.onItems = uniqStrings(raw.onItems).filter((id) => !base.offItems.includes(id));
        return base;
    }

    function isEmpty(filter) {
        const f = normalize(filter);
        return f.priority === "normal"
            && !f.offCategories.length
            && !f.offItems.length
            && !f.onItems.length;
    }

    function persist(filter) {
        const f = normalize(filter);
        if (isEmpty(f)) return null;
        return f;
    }

    function applyToEntry(entry, filter) {
        if (!entry) return entry;
        const saved = persist(filter);
        if (!saved) delete entry.storageFilter;
        else entry.storageFilter = saved;
        return entry;
    }

    function keyAllowed(filter, key, ancestors) {
        const f = normalize(filter);
        if (!key) return true;
        if (f.onItems.includes(key)) return true;
        if (f.offItems.includes(key)) return false;
        for (const a of ancestors || []) {
            if (f.offCategories.includes(a)) return false;
        }
        return true;
    }

    function allows(filter, stack, getItem) {
        const def = defOf(stack, getItem) || (typeof getItem === "function" ? getItem(stackId(stack)) : null);
        const key = filterKey(stack, def);
        if (!key) return true;
        const leafId = leafCategory(def, null);
        const ancestors = ancestorIds(CATEGORY_TREE, leafId) || [leafId];
        return keyAllowed(filter, key, ancestors);
    }

    function buildTree(items) {
        const list = (items || []).filter((it) => it && it.id);
        const roast = roastResultIds(list);
        const root = cloneTree(CATEGORY_TREE);
        for (const def of list) {
            const leafId = leafCategory(def, roast);
            const node = findNode(root, leafId) || findNode(root, "junk");
            if (!node) continue;
            node.items.push({ id: def.id, name: def.name || def.id, key: def.key || null });
        }
        const tools = findNode(root, "tools");
        if (tools) {
            for (const row of TOOL_CLASSES) {
                tools.items.push({ id: row.id, name: row.name, key: null });
            }
        }
        const sortNode = (n) => {
            (n.items || []).sort(sortByName);
            for (const ch of n.children || []) sortNode(ch);
        };
        root.sort(sortByName);
        for (const n of root) sortNode(n);
        return root;
    }

    function itemAncestors(tree, key) {
        const walk = (nodes, trail) => {
            for (const n of nodes || []) {
                const next = trail.concat(n.id);
                if ((n.items || []).some((it) => it.id === key)) return next;
                const hit = walk(n.children, next);
                if (hit) return hit;
            }
            return null;
        };
        return walk(tree, []) || [];
    }

    function categoryState(filter, tree, categoryId) {
        const node = findNode(tree || CATEGORY_TREE, categoryId);
        if (!node) return "on";
        const keys = [];
        const cats = [];
        collectDescendants(node, cats, keys);
        if (!keys.length) {
            return normalize(filter).offCategories.includes(categoryId) ? "off" : "on";
        }
        let on = 0;
        let off = 0;
        for (const key of keys) {
            const anc = itemAncestors(tree || CATEGORY_TREE, key);
            if (keyAllowed(filter, key, anc)) on++;
            else off++;
        }
        if (on && off) return "mixed";
        if (off) return "off";
        return "on";
    }

    function itemState(filter, tree, key) {
        const anc = itemAncestors(tree || CATEGORY_TREE, key);
        return keyAllowed(filter, key, anc) ? "on" : "off";
    }

    function toggleItem(filter, tree, key) {
        const f = normalize(filter);
        const anc = itemAncestors(tree, key);
        const on = keyAllowed(f, key, anc);
        f.onItems = f.onItems.filter((id) => id !== key);
        f.offItems = f.offItems.filter((id) => id !== key);
        if (on) {
            const parentOff = anc.some((a) => f.offCategories.includes(a));
            if (!parentOff) f.offItems.push(key);
        } else {
            const parentOff = anc.some((a) => f.offCategories.includes(a));
            if (parentOff) f.onItems.push(key);
        }
        return f;
    }

    function toggleCategory(filter, tree, categoryId) {
        const f = normalize(filter);
        const node = findNode(tree, categoryId);
        if (!node) return f;
        const state = categoryState(f, tree, categoryId);
        const cats = [];
        const keys = [];
        collectDescendants(node, cats, keys);
        const turnOn = state !== "on";
        f.offCategories = f.offCategories.filter((id) => !cats.includes(id));
        f.offItems = f.offItems.filter((id) => !keys.includes(id));
        f.onItems = f.onItems.filter((id) => !keys.includes(id));
        if (turnOn) {
            const trail = ancestorIds(CATEGORY_TREE, categoryId) || [categoryId];
            const parentOff = trail.some((id) => id !== categoryId && f.offCategories.includes(id));
            if (parentOff) {
                for (const key of keys) f.onItems.push(key);
            }
        } else {
            f.offCategories.push(categoryId);
        }
        return f;
    }

    function priorityRank(priority) {
        const i = PRIORITIES.indexOf(String(priority || "normal"));
        return i < 0 ? PRIORITIES.indexOf("normal") : i;
    }

    function cyclePriority(priority, dir) {
        const i = priorityRank(priority);
        const n = PRIORITIES.length;
        const next = (i + (dir < 0 ? -1 : 1) + n) % n;
        return PRIORITIES[next];
    }

    function isMergeableStack(stack) {
        if (!stack || !(Number(stack.quantity) > 0)) return false;
        if (stack.customName || stack.food || stack.ingredients || stack.toolClass) return false;
        return true;
    }

    function stacksMatch(a, b) {
        return !!(a && b && a.id && a.id === b.id && isMergeableStack(a) && isMergeableStack(b));
    }

    function stackMax(stack, getItem) {
        const def = typeof getItem === "function" ? getItem(stackId(stack)) : null;
        return Math.max(1, Number(def?.maxStack) || 99);
    }

    function stackRoom(stack, getItem) {
        if (!isMergeableStack(stack)) return 0;
        return Math.max(0, stackMax(stack, getItem) - (Number(stack.quantity) || 1));
    }

    function canDepositMerge(dest, src, getItem) {
        return stacksMatch(dest, src) && stackRoom(dest, getItem) > 0;
    }

    /** Storage-to-storage: do not pull from a stack that is already full. */
    function canStorageMerge(dest, src, getItem) {
        return canDepositMerge(dest, src, getItem) && stackRoom(src, getItem) > 0;
    }

    function existingStackRoom(slots, stack, getItem) {
        if (!isMergeableStack(stack)) return 0;
        let room = 0;
        for (const s of slots || []) {
            if (!canDepositMerge(s, stack, getItem)) continue;
            room += stackRoom(s, getItem);
        }
        return room;
    }

    function mergeQty(dest, src, n, onMerge) {
        const amt = Math.max(0, Math.floor(Number(n) || 0));
        if (amt <= 0) return 0;
        if (typeof onMerge === "function") onMerge(dest, src, amt);
        dest.quantity = (Number(dest.quantity) || 1) + amt;
        src.quantity = (Number(src.quantity) || 1) - amt;
        return amt;
    }

    function absorbStack(slots, stack, getItem, onMerge) {
        if (!isMergeableStack(stack) || !(Number(stack.quantity) > 0)) return false;
        const list = slots || [];
        const order = [];
        for (let i = 0; i < list.length; i++) {
            if (list[i]) order.push(i);
        }
        order.sort((a, b) => (Number(list[b].quantity) || 1) - (Number(list[a].quantity) || 1));
        let moved = false;
        for (const i of order) {
            const dest = list[i];
            if (!canDepositMerge(dest, stack, getItem)) continue;
            const n = Math.min(stackRoom(dest, getItem), Number(stack.quantity) || 1);
            if (n <= 0) continue;
            mergeQty(dest, stack, n, onMerge);
            moved = true;
            if (!(Number(stack.quantity) > 0)) break;
        }
        return moved;
    }

    function needsCompact(slots, getItem) {
        const list = slots || [];
        for (let i = 0; i < list.length; i++) {
            for (let j = 0; j < list.length; j++) {
                if (i === j) continue;
                if (canStorageMerge(list[i], list[j], getItem)) return true;
            }
        }
        return false;
    }

    function compactSlots(slots, getItem, onMerge) {
        const list = slots || [];
        let changed = false;
        for (let guard = 0; guard < 64; guard++) {
            let step = false;
            for (let i = 0; i < list.length; i++) {
                const dest = list[i];
                if (!isMergeableStack(dest) || stackRoom(dest, getItem) <= 0) continue;
                for (let j = 0; j < list.length; j++) {
                    if (i === j) continue;
                    const src = list[j];
                    if (!canStorageMerge(dest, src, getItem)) continue;
                    const n = Math.min(stackRoom(dest, getItem), Number(src.quantity) || 1);
                    if (n <= 0) continue;
                    mergeQty(dest, src, n, onMerge);
                    if (!(Number(src.quantity) > 0)) list[j] = null;
                    changed = true;
                    step = true;
                    break;
                }
                if (step) break;
            }
            if (!step) break;
        }
        return changed;
    }

    function basketUid(b) {
        return b?.uid || b?.entry?.uid || null;
    }

    function mergeClaimKey(job) {
        if (!job) return null;
        if (job.kind === "pack") {
            const uid = basketUid(job.basket);
            return uid ? `merge:${uid}` : null;
        }
        if (job.kind === "move") {
            const uid = basketUid(job.from);
            if (!uid || job.fromIndex == null) return null;
            return `merge:${uid}:${job.fromIndex}`;
        }
        return null;
    }

    function findMergeJob(baskets, getItem, fromX, fromY, opts = {}) {
        const claimed = typeof opts.isClaimed === "function" ? opts.isClaimed : () => false;
        const fx = Number(fromX) || 0;
        const fy = Number(fromY) || 0;
        let best = null;
        let bestD = Infinity;
        const consider = (job, x, y, distScale) => {
            const key = mergeClaimKey(job);
            if (!key) return;
            job.claimKey = key;
            if (opts.claimKey) {
                if (key !== opts.claimKey) return;
            } else if (claimed(key)) return;
            const d = Math.hypot((Number(x) || 0) - fx, (Number(y) || 0) - fy) * (distScale || 1);
            if (d < bestD) {
                bestD = d;
                best = job;
            }
        };
        const list = (baskets || []).filter(Boolean);
        for (const b of list) {
            if (!needsCompact(b.slots, getItem)) continue;
            consider({ kind: "pack", basket: b }, b.x, b.y, 0.5);
        }
        for (let a = 0; a < list.length; a++) {
            const src = list[a];
            const srcPri = normalize(src.storageFilter).priority;
            const slots = src.slots || [];
            for (let i = 0; i < slots.length; i++) {
                const stack = slots[i];
                if (!isMergeableStack(stack) || stackRoom(stack, getItem) <= 0) continue;
                if (!allows(src.storageFilter, stack, getItem)) continue;
                for (let b = 0; b < list.length; b++) {
                    if (a === b) continue;
                    const dest = list[b];
                    if (normalize(dest.storageFilter).priority !== srcPri) continue;
                    if (!allows(dest.storageFilter, stack, getItem)) continue;
                    if (existingStackRoom(dest.slots, stack, getItem) <= 0) continue;
                    consider({
                        kind: "move",
                        from: src,
                        fromIndex: i,
                        to: dest,
                        stackId: stack.id
                    }, src.x, src.y, 1);
                }
            }
        }
        return best;
    }

    function stackFits(slots, stack, getItem) {
        if (!stack || !(Number(stack.quantity) > 0)) return false;
        const list = slots || [];
        if (existingStackRoom(list, stack, getItem) > 0) return true;
        return list.some((s) => !s);
    }

    function pickBasket(baskets, stack, getItem, fromX, fromY) {
        let best = null;
        let bestRank = -1;
        let bestMerge = false;
        let bestD = Infinity;
        const fx = Number(fromX) || 0;
        const fy = Number(fromY) || 0;
        for (const b of baskets || []) {
            if (!b) continue;
            if (!allows(b.storageFilter || b.entry?.storageFilter, stack, getItem)) continue;
            const slots = b.slots || b.entry?.slots;
            if (!stackFits(slots, stack, getItem)) continue;
            const rank = priorityRank(normalize(b.storageFilter || b.entry?.storageFilter).priority);
            const hasMerge = existingStackRoom(slots, stack, getItem) > 0;
            const d = Math.hypot(
                (Number(b.x) || Number(b.entry?.x) || 0) - fx,
                (Number(b.y) || Number(b.entry?.y) || 0) - fy
            );
            const better = rank > bestRank
                || (rank === bestRank && hasMerge && !bestMerge)
                || (rank === bestRank && hasMerge === bestMerge && d < bestD);
            if (better) {
                best = b;
                bestRank = rank;
                bestMerge = hasMerge;
                bestD = d;
            }
        }
        return best;
    }

    return {
        PRIORITIES,
        PRIORITY_LABELS,
        TOOL_CLASSES,
        CATEGORY_TREE,
        emptyFilter,
        normalize,
        persist,
        applyToEntry,
        isEmpty,
        filterKey,
        stackId,
        leafCategory,
        roastResultIds,
        allows,
        buildTree,
        categoryState,
        itemState,
        toggleItem,
        toggleCategory,
        priorityRank,
        cyclePriority,
        isMergeableStack,
        stacksMatch,
        stackRoom,
        canStorageMerge,
        existingStackRoom,
        absorbStack,
        compactSlots,
        needsCompact,
        mergeClaimKey,
        findMergeJob,
        stackFits,
        pickBasket,
        ancestorIds,
        findNode
    };
});
