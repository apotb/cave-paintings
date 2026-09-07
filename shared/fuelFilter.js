/**
 * Campfire fuel allow-list (Storage-filter tree) plus Always on / Prefer logs.
 * Phaser-free.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./storageFilter"));
    } else {
        root.FuelFilter = factory(root.StorageFilter);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (StorageFilter) {
    /** 1 kj ≈ 1 game minute; Always on keeps at least this much burn time. */
    const KEEP_HOURS = 12;
    const KEEP_MINUTES = KEEP_HOURS * 60;
    const FUEL_SLOTS = 2;
    const DEFAULT_ON_ITEMS = ["stick", "log"];

    function defaultOffCategories() {
        return (StorageFilter?.CATEGORY_TREE || []).map((n) => n.id);
    }

    function emptyFilter() {
        return {
            alwaysOn: true,
            preferLogs: true,
            offCategories: defaultOffCategories(),
            offItems: [],
            onItems: DEFAULT_ON_ITEMS.slice()
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

    function sameSet(a, b) {
        if ((a || []).length !== (b || []).length) return false;
        const sb = new Set(b || []);
        return (a || []).every((x) => sb.has(x));
    }

    function normalize(raw) {
        const base = emptyFilter();
        if (!raw || typeof raw !== "object") return base;
        if ("alwaysOn" in raw) base.alwaysOn = !!raw.alwaysOn;
        if ("preferLogs" in raw) base.preferLogs = !!raw.preferLogs;
        if (Array.isArray(raw.offCategories)) base.offCategories = uniqStrings(raw.offCategories);
        if (Array.isArray(raw.offItems)) base.offItems = uniqStrings(raw.offItems);
        if (Array.isArray(raw.onItems)) base.onItems = uniqStrings(raw.onItems);
        base.onItems = base.onItems.filter((id) => !base.offItems.includes(id));
        return base;
    }

    function isDefault(filter) {
        const f = normalize(filter);
        const d = emptyFilter();
        return f.alwaysOn === d.alwaysOn
            && f.preferLogs === d.preferLogs
            && sameSet(f.offCategories, d.offCategories)
            && sameSet(f.offItems, d.offItems)
            && sameSet(f.onItems, d.onItems);
    }

    function persist(filter) {
        const f = normalize(filter);
        if (isDefault(f)) return null;
        return f;
    }

    function applyToEntry(entry, filter) {
        if (!entry) return entry;
        const saved = persist(filter);
        if (!saved) delete entry.fuelFilter;
        else entry.fuelFilter = saved;
        return entry;
    }

    function fuelKj(def) {
        return Number(def?.fuel?.kj) || 0;
    }

    function defOf(stack, getItem) {
        if (!stack) return null;
        if (stack.fuel && fuelKj(stack) > 0 && stack.id) return stack;
        const id = stack.id || stack.item?.id;
        return typeof getItem === "function" ? getItem(id) : null;
    }

    function isFuelItem(def) {
        return !!(def && def.id && fuelKj(def) > 0);
    }

    function isFuelStack(stack, getItem) {
        return isFuelItem(defOf(stack, getItem));
    }

    function storageSlice(filter) {
        const f = normalize(filter);
        return {
            priority: "normal",
            offCategories: f.offCategories,
            offItems: f.offItems,
            onItems: f.onItems
        };
    }

    function allows(filter, stack, getItem) {
        if (!isFuelStack(stack, getItem)) return false;
        if (!StorageFilter?.allows) return true;
        return StorageFilter.allows(storageSlice(filter), stack, getItem);
    }

    function pruneEmpty(nodes) {
        const out = [];
        for (const n of nodes || []) {
            const children = pruneEmpty(n.children);
            const items = n.items || [];
            if (!children.length && !items.length) continue;
            out.push({
                id: n.id,
                name: n.name,
                children: children.length ? children : undefined,
                items
            });
        }
        return out;
    }

    function buildTree(items) {
        const fuels = (items || []).filter(isFuelItem);
        if (!StorageFilter?.CATEGORY_TREE) return [];
        const root = StorageFilter.buildTree(fuels).map((n) => ({
            id: n.id,
            name: n.name,
            children: n.children,
            items: n.items
        }));
        const stripTools = (nodes) => {
            for (const n of nodes || []) {
                n.items = (n.items || []).filter((it) => !String(it.id || "").startsWith("tool:"));
                if (n.children) stripTools(n.children);
            }
        };
        stripTools(root);
        return pruneEmpty(root);
    }

    function categoryState(filter, tree, categoryId) {
        return StorageFilter.categoryState(storageSlice(filter), tree, categoryId);
    }

    function itemState(filter, tree, key) {
        return StorageFilter.itemState(storageSlice(filter), tree, key);
    }

    function withFlags(filter, next) {
        const f = normalize(filter);
        return normalize({
            alwaysOn: f.alwaysOn,
            preferLogs: f.preferLogs,
            offCategories: next.offCategories,
            offItems: next.offItems,
            onItems: next.onItems
        });
    }

    function toggleItem(filter, tree, key) {
        return withFlags(filter, StorageFilter.toggleItem(storageSlice(filter), tree, key));
    }

    function toggleCategory(filter, tree, categoryId) {
        return withFlags(filter, StorageFilter.toggleCategory(storageSlice(filter), tree, categoryId));
    }

    function fuelHasRoom(entry, id, getItem) {
        if (!id) return false;
        const def = typeof getItem === "function" ? getItem(id) : null;
        const max = Math.max(1, Number(def?.maxStack) || 99);
        const fuel = Array.isArray(entry?.fuel) ? entry.fuel : [];
        for (let i = 0; i < FUEL_SLOTS; i++) {
            const s = fuel[i];
            if (!s || !(Number(s.quantity) > 0)) return true;
            if (s.id === id && (Number(s.quantity) || 1) < max) return true;
        }
        return false;
    }

    function addFuelUnit(entry, id) {
        if (!entry || !id) return -1;
        if (!Array.isArray(entry.fuel)) entry.fuel = [null, null];
        while (entry.fuel.length < FUEL_SLOTS) entry.fuel.push(null);
        let slot = -1;
        for (let i = 0; i < FUEL_SLOTS; i++) {
            const s = entry.fuel[i];
            if (s && s.id === id && Number(s.quantity) > 0) {
                slot = i;
                break;
            }
        }
        if (slot < 0) {
            for (let i = 0; i < FUEL_SLOTS; i++) {
                const s = entry.fuel[i];
                if (!s || !(Number(s.quantity) > 0)) {
                    slot = i;
                    break;
                }
            }
        }
        if (slot < 0) return -1;
        const dest = entry.fuel[slot];
        if (dest && dest.id === id) dest.quantity = (Number(dest.quantity) || 1) + 1;
        else entry.fuel[slot] = { id, quantity: 1 };
        return slot;
    }

    function pickFuelId(filter, stacks, entry, getItem) {
        const f = normalize(filter);
        const allowed = [];
        for (const s of stacks || []) {
            if (!s || !allows(f, s, getItem)) continue;
            if (!fuelHasRoom(entry, s.id, getItem)) continue;
            allowed.push(s);
        }
        if (!allowed.length) return null;
        if (f.preferLogs) {
            const log = allowed.find((s) => s.id === "log");
            if (log) return "log";
        }
        return allowed[0].id;
    }

    function findFuelTake(filter, sources, entry, getItem) {
        const all = [];
        for (const src of sources || []) {
            for (const s of src.slots || []) {
                if (s) all.push(s);
            }
        }
        const id = pickFuelId(filter, all, entry, getItem);
        if (!id) return null;
        for (const src of sources || []) {
            const slots = src.slots || [];
            const index = slots.findIndex((s) => s && s.id === id);
            if (index >= 0) return { slots, index, id, src };
        }
        return null;
    }

    function belowKeepMinutes(entry, getItem, burnMinutesFn) {
        const mins = typeof burnMinutesFn === "function"
            ? burnMinutesFn(entry, getItem)
            : 0;
        return mins < KEEP_MINUTES;
    }

    return {
        KEEP_HOURS,
        KEEP_MINUTES,
        FUEL_SLOTS,
        emptyFilter,
        normalize,
        persist,
        applyToEntry,
        isDefault,
        fuelKj,
        isFuelItem,
        isFuelStack,
        allows,
        buildTree,
        categoryState,
        itemState,
        toggleItem,
        toggleCategory,
        fuelHasRoom,
        addFuelUnit,
        pickFuelId,
        findFuelTake,
        belowKeepMinutes
    };
});
