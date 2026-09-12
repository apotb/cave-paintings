/**
 * Painting Circle progress, pigment, and per-settlement tech tree.
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Research = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const PAINT_MAX = 6;
    const PAINT_MINUTES = 720;
    const TALLY_ITEM_ID = "tally_stick";
    const TALLY_MULT_NUM = 3;
    const TALLY_MULT_DEN = 2;
    /** 16×16 circle, origin south-center. Pawns use feet-left (0, 1). */
    const PAWN_W = 16;
    /** 1st painting north, 2–3 east, 4th south, 5–6 west. */
    const WORK_FACING = ["up", "right", "right", "down", "left", "left"];
    const ROOTS = ["gathering", "fire", "knapping", "tanning", "culture"];
    const ERAS = ["Paleolithic", "Mesolithic", "Neolithic", "Chalcolithic"];
    const FOG_COPY = "Your tribe isn't advanced enough to comprehend this.";
    const ERA_ICONS = {
        paleolithic: "campfire",
        mesolithic: "null",
        neolithic: "null",
        chalcolithic: "null"
    };
    /** Cave-paint red from `assets/ui/title` silhouettes. */
    const UI_PAINT_TINT = 0xaa1100;
    const UI_ICON_KEY = "painting_circle_ui";
    /** Spent-points row in the research breakdown (`assets/ui/science.png`). */
    const UI_SCIENCE_KEY = "science";
    /** Culture node: cave-paint hand from `assets/ui/title/hand.png`. */
    const UI_TITLE_HAND_KEY = "title-hand";
    const UI_CULTURE_HAND_KEY = "culture_hand";
    /** Research tab currencies. `icon` is an item id, or `"null"` for the missing-item placeholder. */
    const CURRENCIES = [
        { id: "paintings", name: "Paintings", icon: "painting_circle" },
        { id: "tallies", name: "Tallies", icon: "tally_stick" },
        { id: "tokens", name: "Tokens", icon: "null" },
        { id: "books", name: "Books", icon: "null" }
    ];

    function currencies() {
        return CURRENCIES;
    }

    /** Hover tip for the research-tree header: one line per currency count. */
    function pointsTip(pts) {
        const p = pts || {};
        const spent = Math.max(0, Math.floor(Number(p.spent) || 0));
        return currencies()
            .map((row) => `${row.name}  ${formatPoints(p[row.id] ?? 0)}`)
            .concat([`Research  -${spent}`])
            .join("\n");
    }

    /** Strip trailing .0; keep halves as 4.5. */
    function formatPoints(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return "0";
        const snapped = Math.round(v * TALLY_MULT_DEN) / TALLY_MULT_DEN;
        if (Object.is(snapped, -0) || snapped === 0) return "0";
        return Number.isInteger(snapped) ? String(snapped) : snapped.toFixed(1);
    }

    /** Right-aligned spent count: digits match the lines above; minus hangs left. */
    function spentTipValue(n) {
        return `-${Math.max(0, Math.floor(Number(n) || 0))}`;
    }

    function isFreeTech(tech) {
        const t = tech || {};
        if (t.startUnlocked) return true;
        return !(Math.max(0, Math.floor(Number(t.cost) || 0)) > 0);
    }

    /** "Free" for starter techs, otherwise "3 pts" even after unlock. */
    function techCostLabel(tech) {
        if (isFreeTech(tech)) return "Free";
        const cost = Math.max(0, Math.floor(Number(tech?.cost) || 0));
        return `${cost} pt${cost === 1 ? "" : "s"}`;
    }

    /** Node hover: "Name / 3 pts / Era" (or Free), then quote / missing prereqs. */
    function techTip(tech, opts = {}) {
        const t = tech || {};
        const unlocked = !!opts.unlocked;
        const parts = [t.name || t.id || "", techCostLabel(t)];
        if (t.era) parts.push(t.era);
        const lines = [parts.filter(Boolean).join(" / ")];
        if (t.quote) lines.push(`'${t.quote}'`);
        const miss = opts.missingNames;
        if (!unlocked && Array.isArray(miss) && miss.length) {
            lines.push(`Needs ${miss.join(", ")}`);
        }
        return lines.join("\n");
    }

    /** Jobs, rituals, techniques — not missing items. No `null.png` placeholder. */
    function isActionUnlock(label) {
        const s = String(label || "").trim();
        if (!s) return true;
        if (/\b(job|jobs|knapping|ritual|forming|sowing)\b/i.test(s)) return true;
        if (/^(sow|tame|train|smoke)\b/i.test(s)) return true;
        return false;
    }

    /** World thing id to show next to a text unlock, or null for no icon. */
    function unlockTextIcon(label) {
        if (/\bknapping\b/i.test(String(label || ""))) return "rock";
        return null;
    }

    let _techs = null;
    let _byId = null;
    let _itemTech = null;
    let _billTech = null;

    function _dataStore() {
        if (typeof DataStore !== "undefined") return DataStore;
        try {
            if (typeof require === "function") return require("./DataStore");
        } catch (_) { /* browser */ }
        return null;
    }

    function setTechs(list) {
        _techs = Array.isArray(list) ? list.filter((t) => t && t.id) : [];
        _byId = Object.create(null);
        _itemTech = Object.create(null);
        _billTech = Object.create(null);
        for (const t of _techs) {
            _byId[t.id] = t;
            const items = t.unlocks?.items || [];
            for (const id of items) {
                if (id && !_itemTech[id]) _itemTech[id] = t.id;
            }
            const bills = t.unlocks?.bills || [];
            for (const id of bills) {
                if (id && !_billTech[id]) _billTech[id] = t.id;
            }
        }
        return _techs;
    }

    function techs() {
        if (_techs) return _techs;
        const store = _dataStore();
        const list = store?._store?.techsList;
        if (Array.isArray(list) && list.length) setTechs(list);
        return _techs || [];
    }

    function techById(id) {
        techs();
        return (id && _byId && _byId[id]) || null;
    }

    function startUnlockedIds() {
        return techs().filter((t) => t.startUnlocked || !(Number(t.cost) > 0)).map((t) => t.id);
    }

    function isPaintingCircle(thingDef, entry) {
        if (thingDef?.paintingCircle) return true;
        const id = entry?.id || thingDef?.id;
        return id === "painting_circle";
    }

    /**
     * Align the 16×16 pawn sprite with the 16×16 circle.
     * Circle origin is south-center; pawn origin is feet-left. Putting feet on
     * the tile's visual center (y - 8) leaves the body in the northern half.
     */
    function standWorldPos(entry) {
        if (!entry) return null;
        const x = Number(entry.x);
        const y = Number(entry.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x: x - PAWN_W / 2, y };
    }

    /** Facing for the painting being worked (painted count is the next index). */
    function workFacingForIndex(i) {
        const n = WORK_FACING.length;
        if (!(n > 0)) return "up";
        const idx = Math.max(0, Math.min(n - 1, Math.floor(Number(i) || 0)));
        return WORK_FACING[idx];
    }

    function workFacing(entry) {
        return workFacingForIndex(paintedCount(entry));
    }

    /** Pixel offset from the circle origin (south-center) to the rim being painted. */
    function paintWallLocal(facing) {
        const dir = String(facing || "up");
        if (dir === "right") return { x: 6, y: -8 };
        if (dir === "down") return { x: 0, y: -3 };
        if (dir === "left") return { x: -6, y: -8 };
        return { x: 0, y: -14 };
    }

    function mixRgb(a, b, t) {
        const k = Math.max(0, Math.min(1, Number(t) || 0));
        const av = (Number(a) || 0) >>> 0;
        const bv = (Number(b) || 0) >>> 0;
        const ar = (av >> 16) & 255;
        const ag = (av >> 8) & 255;
        const ab = av & 255;
        const br = (bv >> 16) & 255;
        const bg = (bv >> 8) & 255;
        const bb = bv & 255;
        const r = Math.round(ar + (br - ar) * k);
        const g = Math.round(ag + (bg - ag) * k);
        const bl = Math.round(ab + (bb - ab) * k);
        return ((r & 255) << 16) | ((g & 255) << 8) | (bl & 255);
    }

    function paintFleckTint(base, kind) {
        const c = (Number(base) || 0) >>> 0;
        if (kind === "light") return mixRgb(c, 0xffffff, 0.25);
        if (kind === "dirt") return mixRgb(c, 0x2a1810, 0.4);
        return c;
    }

    function pickPaintFleckKind(rng) {
        const r = typeof rng === "function" ? Number(rng()) : Math.random();
        if (r < 0.6) return "base";
        if (r < 0.85) return "light";
        return "dirt";
    }

    function ghostOverlayAlpha(progress, now, pulse) {
        const p = Math.max(0, Math.min(1, Number(progress) || 0));
        const breath = 0.5 + 0.5 * Math.sin((Number(now) || 0) / 700);
        const pul = Math.max(0, Math.min(1, Number(pulse) || 0));
        return Math.max(0.08, Math.min(0.85, 0.12 + 0.35 * p + 0.05 * breath + 0.14 * pul));
    }

    function overlayKey(i, thingKey) {
        const key = thingKey || "painting_circle";
        return `${key}_${i}`;
    }

    function tallyOverlayKey(thingKey) {
        const key = thingKey || "painting_circle";
        return `${key}_upgrade_stick`;
    }

    function clampPainted(n) {
        const v = Math.floor(Number(n) || 0);
        return Math.max(0, Math.min(PAINT_MAX, v));
    }

    function _storageFilter() {
        if (typeof StorageFilter !== "undefined") return StorageFilter;
        try {
            if (typeof require === "function") return require("./storageFilter");
        } catch (_) { /* browser */ }
        return null;
    }

    function emptyPaintFilter() {
        return { offCategories: [], offItems: [], onItems: [] };
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

    function normalizePaintFilter(raw) {
        const base = emptyPaintFilter();
        if (!raw || typeof raw !== "object") return base;
        if (Array.isArray(raw.offCategories)) base.offCategories = uniqStrings(raw.offCategories);
        if (Array.isArray(raw.offItems)) base.offItems = uniqStrings(raw.offItems);
        if (Array.isArray(raw.onItems)) base.onItems = uniqStrings(raw.onItems);
        base.onItems = base.onItems.filter((id) => !base.offItems.includes(id));
        return base;
    }

    function isDefaultPaintFilter(filter) {
        const f = normalizePaintFilter(filter);
        const d = emptyPaintFilter();
        return sameSet(f.offCategories, d.offCategories)
            && sameSet(f.offItems, d.offItems)
            && sameSet(f.onItems, d.onItems);
    }

    function persistPaintFilter(filter) {
        const f = normalizePaintFilter(filter);
        if (isDefaultPaintFilter(f)) return null;
        return f;
    }

    function applyPaintFilter(entry, filter) {
        if (!entry) return entry;
        const saved = persistPaintFilter(filter);
        if (!saved) delete entry.paintFilter;
        else entry.paintFilter = saved;
        return entry;
    }

    function paintStorageSlice(filter) {
        const f = normalizePaintFilter(filter);
        return {
            priority: "normal",
            offCategories: f.offCategories,
            offItems: f.offItems,
            onItems: f.onItems
        };
    }

    function pruneEmptyTree(nodes) {
        const out = [];
        for (const n of nodes || []) {
            const children = pruneEmptyTree(n.children);
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

    function listPigments(items) {
        const out = [];
        const seen = new Set();
        for (const it of items || []) {
            const id = it?.id ? String(it.id) : "";
            if (!id || seen.has(id)) continue;
            if (id.startsWith("tool:")) continue;
            if (!isPigment(it, it)) continue;
            seen.add(id);
            out.push({ id, name: it.name || id, key: it.key || null });
        }
        out.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
        return out;
    }

    function buildPigmentTree(items) {
        const SF = _storageFilter();
        const pigments = (items || []).filter((it) => isPigment(it, it));
        if (!SF?.buildTree) return [];
        const root = SF.buildTree(pigments).map((n) => ({
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
        return pruneEmptyTree(root);
    }

    function paintCategoryState(filter, tree, categoryId) {
        const SF = _storageFilter();
        if (!SF?.categoryState) return "on";
        return SF.categoryState(paintStorageSlice(filter), tree, categoryId);
    }

    function paintItemState(filter, tree, key) {
        const SF = _storageFilter();
        if (!SF?.itemState) return "on";
        return SF.itemState(paintStorageSlice(filter), tree, key);
    }

    function togglePaintItem(filter, tree, key) {
        const SF = _storageFilter();
        if (!SF?.toggleItem) return normalizePaintFilter(filter);
        return normalizePaintFilter(SF.toggleItem(paintStorageSlice(filter), tree, key));
    }

    function togglePaintCategory(filter, tree, categoryId) {
        const SF = _storageFilter();
        if (!SF?.toggleCategory) return normalizePaintFilter(filter);
        return normalizePaintFilter(SF.toggleCategory(paintStorageSlice(filter), tree, categoryId));
    }

    function allowsPigment(entry, stack, getItem) {
        if (!isPigment(typeof getItem === "function" ? getItem(stack?.id) : null, stack)) return false;
        const SF = _storageFilter();
        if (!SF?.allows) return true;
        return SF.allows(paintStorageSlice(entry?.paintFilter), stack, getItem);
    }

    function isEnabled(entry) {
        return entry?.paintEnabled !== false;
    }

    function setEnabled(entry, on) {
        if (!entry) return entry;
        entry.paintEnabled = !!on;
        return entry;
    }

    function ensureEntry(entry, thingDef) {
        if (!entry) return entry;
        if (Array.isArray(entry.slots)) delete entry.slots;
        entry.painted = clampPainted(entry.painted);
        if (entry.locked != null) delete entry.locked;
        let prog = Number(entry.paintProgress);
        if (!Number.isFinite(prog) || prog < 0) prog = 0;
        if (prog > 1) prog = 1;
        entry.paintProgress = prog;
        entry.paintStarted = !!(entry.paintStarted || prog > 0);
        if (!inProgress(entry)) entry.paintPigment = null;
        else if (entry.paintPigment) entry.paintPigment = String(entry.paintPigment);
        if (entry.paintEnabled == null) entry.paintEnabled = true;
        else entry.paintEnabled = !!entry.paintEnabled;
        applyPaintFilter(entry, entry.paintFilter);
        _syncPaintPigments(entry);
        entry.tallyStick = !!entry.tallyStick;
        if (!entry.uid) {
            entry.uid = `pc_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        return entry;
    }

    function paintedCount(entry) {
        return clampPainted(entry?.painted);
    }

    function hasTally(entry) {
        return !!entry?.tallyStick;
    }

    function circlePoints(entry) {
        const n = paintedCount(entry);
        if (!hasTally(entry)) return n;
        return (n * TALLY_MULT_NUM) / TALLY_MULT_DEN;
    }

    function circlePointsTotal(entries) {
        let n = 0;
        for (const e of entries || []) n += circlePoints(e);
        return n;
    }

    function tallyBonus(entries) {
        let n = 0;
        for (const e of entries || []) {
            if (hasTally(e)) n += paintedCount(e) / TALLY_MULT_DEN;
        }
        return n;
    }

    function needsTallyInstall(settle, entry) {
        if (!entry) return false;
        if (hasTally(entry)) return false;
        if (settle && !hasTech(settle, "counting")) return false;
        return true;
    }

    function installTally(entry) {
        if (!entry || hasTally(entry)) return false;
        ensureEntry(entry);
        entry.tallyStick = true;
        return true;
    }

    function removeTally(entry) {
        if (!hasTally(entry)) return false;
        entry.tallyStick = false;
        return true;
    }

    function _sameCircle(a, b) {
        const uid = b?.uid != null ? String(b.uid) : "";
        if (uid && String(a?.uid || "") === uid) return true;
        if (!uid && a === b) return true;
        return false;
    }

    function lockedCount(entry) {
        return 0;
    }

    /** This circle's contribution to the settlement pool (finished paintings). */
    function availableOn(entry) {
        return circlePoints(entry);
    }

    function hasRoom(entry) {
        return paintedCount(entry) < PAINT_MAX;
    }

    function inProgress(entry) {
        return !!(entry?.paintStarted || Number(entry?.paintProgress) > 0);
    }

    function needsPigment(entry) {
        if (!entry || !hasRoom(entry)) return false;
        return !inProgress(entry);
    }

    function isPigment(itemDef, stack) {
        if (itemDef?.pigment) return true;
        const id = stack?.id || itemDef?.id;
        return id === "blueberry" || id === "cactus_flower";
    }

    function currentPigmentId(entry) {
        if (!inProgress(entry) || !entry?.paintPigment) return null;
        return String(entry.paintPigment);
    }

    function startPaint(entry, pigmentId) {
        if (!entry) return false;
        if (inProgress(entry)) return true;
        if (!pigmentId) return false;
        entry.paintStarted = true;
        entry.paintPigment = String(pigmentId);
        if (!(Number(entry.paintProgress) > 0)) entry.paintProgress = 0;
        return true;
    }

    function parseFillColor(c) {
        if (typeof c === "number" && Number.isFinite(c)) return c >>> 0;
        if (typeof c === "string") {
            const hex = c.trim().replace(/^#/, "");
            if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
        }
        return null;
    }

    function pigmentTint(itemDef, stack) {
        const v = parseFillColor(itemDef?.fillColor);
        if (v != null) return v;
        const id = stack?.id || itemDef?.id;
        if (id === "blueberry") return 0x3b6fe0;
        if (id === "cactus_flower") return 0xd666d4;
        return 0xffffff;
    }

    function _syncPaintPigments(entry) {
        const n = paintedCount(entry);
        const raw = Array.isArray(entry?.paintPigments) ? entry.paintPigments : [];
        const list = [];
        for (let i = 0; i < n; i++) {
            const id = raw[i];
            list.push(id ? String(id) : null);
        }
        entry.paintPigments = list;
        return list;
    }

    function overlayTint(entry, index, getItem) {
        const i = Math.floor(Number(index) || 0);
        const id = (entry?.paintPigments || [])[i];
        if (!id) return 0xffffff;
        const def = typeof getItem === "function" ? getItem(id) : null;
        return pigmentTint(def, { id });
    }

    function consumePigment(entry, getItem, stack) {
        if (!entry) return false;
        if (inProgress(entry)) return true;
        if (!stack?.id) return false;
        const def = typeof getItem === "function" ? getItem(stack.id) : null;
        if (!isPigment(def, stack) || !allowsPigment(entry, stack, getItem)) return false;
        const qty = Math.max(0, Math.floor(Number(stack.quantity) || 0));
        if (qty < 1) return false;
        stack.quantity = qty - 1;
        return startPaint(entry, stack.id);
    }

    function addPaintMinutes(entry, minutes) {
        if (!entry) return { changed: false, completed: false };
        ensureEntry(entry);
        if (!hasRoom(entry) || !inProgress(entry)) return { changed: false, completed: false };
        const add = Math.max(0, Number(minutes) || 0);
        if (!(add > 0)) return { changed: false, completed: false };
        const next = Math.min(1, (Number(entry.paintProgress) || 0) + add / PAINT_MINUTES);
        entry.paintProgress = next;
        if (next + 1e-9 >= 1) {
            const pigmentId = entry.paintPigment ? String(entry.paintPigment) : null;
            entry.painted = clampPainted(entry.painted + 1);
            entry.paintProgress = 0;
            entry.paintStarted = false;
            entry.paintPigment = null;
            _syncPaintPigments(entry);
            if (entry.paintPigments.length) {
                entry.paintPigments[entry.paintPigments.length - 1] = pigmentId;
            }
            return { changed: true, completed: true };
        }
        return { changed: true, completed: false };
    }

    function lockOn(entry, n) {
        return 0;
    }

    function lockPaintings(entries, n) {
        const want = Math.max(0, Math.floor(Number(n) || 0));
        return paintedTotal(entries) >= want;
    }

    function availableTotal(entries, settle) {
        if (!settle) return circlePointsTotal(entries);
        return availablePoints(entries, { settle });
    }

    /**
     * Settlement pool: painting circles (and later tokens/books) add points;
     * unlocked tech costs subtract. Circles are not spent individually.
     * `total` is what you can still spend. Pass `extra.settle` or `extra.spent`.
     */
    function pointsBreakdown(entries, extra = {}) {
        const paintings = paintedTotal(entries);
        const tallies = tallyBonus(entries);
        const tokens = Math.max(0, Math.floor(Number(extra?.tokens) || 0));
        const books = Math.max(0, Math.floor(Number(extra?.books ?? extra?.tablets) || 0));
        const produced = paintings + tallies + tokens + 5 * books;
        const settle = extra?.settle;
        const spent = settle
            ? spentPoints(settle)
            : Math.max(0, Math.floor(Number(extra?.spent) || 0));
        return {
            paintings,
            tallies,
            tokens,
            books,
            spent,
            produced,
            total: Math.max(0, produced - spent)
        };
    }

    function availablePoints(entries, extra) {
        return pointsBreakdown(entries, extra).total;
    }

    /** Sum of unlocked tech costs (the paintings you must keep). */
    function spentPoints(settle) {
        ensureTechs(settle);
        let n = 0;
        for (const t of techs()) {
            if (!hasTech(settle, t.id)) continue;
            n += Math.max(0, Math.floor(Number(t.cost) || 0));
        }
        return n;
    }

    function paintedTotal(entries) {
        let n = 0;
        for (const e of entries || []) n += paintedCount(e);
        return n;
    }

    function remainingAfterRemove(entries, entry) {
        let n = 0;
        for (const e of entries || []) {
            if (_sameCircle(e, entry)) continue;
            n += circlePoints(e);
        }
        return n;
    }

    function remainingAfterUninstallTally(entries, entry) {
        let n = 0;
        for (const e of entries || []) {
            n += _sameCircle(e, entry) ? paintedCount(e) : circlePoints(e);
        }
        return n;
    }

    function removeShortfall(settle, entries, entry) {
        const spent = spentPoints(settle);
        if (!(spent > 0)) return 0;
        return Math.max(0, spent - remainingAfterRemove(entries, entry));
    }

    function tallyRemoveShortfall(settle, entries, entry) {
        const spent = spentPoints(settle);
        if (!(spent > 0) || !hasTally(entry)) return 0;
        return Math.max(0, spent - remainingAfterUninstallTally(entries, entry));
    }

    function canRemoveCircle(settle, entries, entry) {
        if (!entry) return false;
        return removeShortfall(settle, entries, entry) === 0;
    }

    function canRemoveTally(settle, entries, entry) {
        if (!entry || !hasTally(entry)) return false;
        return tallyRemoveShortfall(settle, entries, entry) === 0;
    }

    function _shortfallReason(need) {
        if (!(need > 0)) return null;
        const label = formatPoints(need);
        return `Need ${label} extra research point${need === 1 ? "" : "s"} to maintain research`;
    }

    function removeBlockedReason(settle, entries, entry) {
        if (!entry) return null;
        return _shortfallReason(removeShortfall(settle, entries, entry));
    }

    function tallyRemoveBlockedReason(settle, entries, entry) {
        if (!entry) return null;
        if (!hasTally(entry)) return null;
        return _shortfallReason(tallyRemoveShortfall(settle, entries, entry));
    }

    function removeConfirmCopy(painted) {
        const n = Math.max(0, Math.floor(Number(painted) || 0));
        return {
            question: "Are you sure you'd like to remove this Painting Circle?",
            loseLead: n > 0 ? "You'll lose:" : "",
            paintings: n
        };
    }

    /** Pool is derived from remaining providers minus spent techs; nothing to relock. */
    function relockToSpent() {
        return false;
    }

    function defaultTechs() {
        const out = Object.create(null);
        for (const id of startUnlockedIds()) out[id] = true;
        return out;
    }

    /** Strip techs that used to be free at camp found. Bump when adding another revoke. */
    const TECH_GRANT_REV = 1;

    function _revokeStaleStartUnlocks(next) {
        const t = techById("hafting");
        if (!t || t.startUnlocked || !(Number(t.cost) > 0)) return;
        if (next.hafting) next.hafting = false;
    }

    function ensureTechs(settle) {
        if (!settle) return null;
        const next = settle.techs && typeof settle.techs === "object" && !Array.isArray(settle.techs)
            ? settle.techs
            : Object.create(null);
        for (const id of startUnlockedIds()) {
            if (next[id] == null) next[id] = true;
        }
        const rev = Math.floor(Number(settle.techGrantRev) || 0);
        if (rev < TECH_GRANT_REV) {
            _revokeStaleStartUnlocks(next);
            settle.techGrantRev = TECH_GRANT_REV;
        }
        settle.techs = next;
        return next;
    }

    function hasTech(settle, id) {
        if (!id) return false;
        const techsMap = ensureTechs(settle) || {};
        return !!techsMap[id];
    }

    function missingPrereqs(settle, tech) {
        const t = typeof tech === "string" ? techById(tech) : tech;
        if (!t) return ["?"];
        const miss = [];
        for (const id of t.prereqs || []) {
            if (!hasTech(settle, id)) miss.push(id);
        }
        return miss;
    }

    function _techCost(t) {
        return Math.max(0, Math.floor(Number(t?.cost) || 0));
    }

    /**
     * Techs still needed to own `techId`, ancestors first. Already-owned nodes
     * (and shared diamonds) are skipped.
     */
    function remainingUnlockIds(settle, techId, seen) {
        const t = typeof techId === "string" ? techById(techId) : techId;
        if (!t?.id) return [];
        seen = seen || new Set();
        if (seen.has(t.id)) return [];
        seen.add(t.id);
        if (settle && hasTech(settle, t.id)) return [];
        const out = [];
        for (const p of t.prereqs || []) out.push(...remainingUnlockIds(settle, p, seen));
        out.push(t.id);
        return out;
    }

    function remainingUnlockCost(settle, techId) {
        if (settle) ensureTechs(settle);
        let n = 0;
        for (const id of remainingUnlockIds(settle, techId)) n += _techCost(techById(id));
        return n;
    }

    function remainingCostLabel(settle, tech) {
        const t = typeof tech === "string" ? techById(tech) : tech;
        if (!t) return "0";
        if (!settle || hasTech(settle, t.id)) return techCostLabel(t);
        const n = remainingUnlockCost(settle, t.id);
        if (!(n > 0)) return "Free";
        return `${n} pt${n === 1 ? "" : "s"}`;
    }

    function _chainFogged(settle, techId) {
        for (const id of remainingUnlockIds(settle, techId)) {
            if (techFogged(settle, id)) return true;
        }
        return false;
    }

    function canUnlock(settle, techId, available) {
        const t = techById(techId);
        if (!t || !settle) return false;
        if (hasTech(settle, t.id)) return false;
        if (_chainFogged(settle, t.id)) return false;
        return (Number(available) || 0) >= remainingUnlockCost(settle, t.id);
    }

    /** Disabled Research-button copy, or null if the tech can be bought (or is already done). */
    function unlockBlockedReason(settle, techId, available) {
        const t = techById(techId);
        if (!t || !settle) return null;
        if (hasTech(settle, t.id)) return null;
        if (_chainFogged(settle, t.id)) return FOG_COPY;
        const cost = remainingUnlockCost(settle, t.id);
        if ((Number(available) || 0) < cost) return "Not enough research points";
        return null;
    }

    function _eraKey(era) {
        return String(era || "").toLowerCase();
    }

    function eraIndex(era) {
        const key = _eraKey(era);
        const i = ERAS.findIndex((e) => _eraKey(e) === key);
        return i;
    }

    function techsInEra(era) {
        const key = _eraKey(era);
        return techs().filter((t) => _eraKey(t.era) === key);
    }

    function eraProgress(settle, era) {
        const list = techsInEra(era);
        let done = 0;
        for (const t of list) {
            if (hasTech(settle, t.id)) done++;
        }
        const total = list.length;
        const pct = total > 0 ? Math.round((100 * done) / total) : 0;
        return { era, done, total, pct };
    }

    function qualifiesForEra(settle, index) {
        const i = Math.floor(Number(index) || 0);
        if (i <= 0) return true;
        if (i >= ERAS.length) return false;
        const cur = eraProgress(settle, ERAS[i]);
        const needHalf = Math.ceil((cur.total || 0) * 0.5);
        if (cur.total > 0 && cur.done >= needHalf) return true;
        const prev = eraProgress(settle, ERAS[i - 1]);
        if (prev.total > 0 && prev.done >= prev.total) return true;
        return false;
    }

    /** Highest era the settlement qualifies for. Always at least Paleolithic. */
    function currentAge(settle) {
        if (settle) ensureTechs(settle);
        let best = 0;
        for (let i = 0; i < ERAS.length; i++) {
            if (qualifiesForEra(settle, i)) best = i;
        }
        return ERAS[best];
    }

    function currentAgeIndex(settle) {
        const name = currentAge(settle);
        const i = eraIndex(name);
        return i < 0 ? 0 : i;
    }

    function eraVisible(settle, era) {
        const i = eraIndex(era);
        if (i < 0) return true;
        return i <= currentAgeIndex(settle) + 1;
    }

    function techFogged(settle, tech) {
        const t = typeof tech === "string" ? techById(tech) : tech;
        if (!t || !settle) return false;
        return !eraVisible(settle, t.era);
    }

    function eraIcon(era) {
        return ERA_ICONS[_eraKey(era)] || "null";
    }

    function visibleEras(settle) {
        const cap = currentAgeIndex(settle) + 1;
        return ERAS.filter((_, i) => i <= cap);
    }

    function ageBreakdown(settle) {
        if (settle) ensureTechs(settle);
        return visibleEras(settle).map((era) => {
            const p = eraProgress(settle, era);
            return {
                era,
                name: era,
                done: p.done,
                total: p.total,
                pct: p.pct,
                icon: eraIcon(era)
            };
        });
    }

    function ageTip(settle) {
        return ageBreakdown(settle)
            .map((r) => `${r.era}  ${r.done}/${r.total}  ${r.pct}%`)
            .join("\n");
    }

    function unlock(settle, techId) {
        if (!settle || !techId) return false;
        ensureTechs(settle);
        settle.techs[techId] = true;
        return true;
    }

    /** Unlock `techId` and every still-missing ancestor, prereqs first. */
    function unlockChain(settle, techId) {
        if (!settle || !techId) return false;
        const ids = remainingUnlockIds(settle, techId);
        if (!ids.length) return false;
        let any = false;
        for (const id of ids) {
            if (unlock(settle, id)) any = true;
        }
        return any;
    }

    function recipeTechId(itemId) {
        techs();
        return (itemId && _itemTech && _itemTech[itemId]) || null;
    }

    /**
     * Start-unlocked / free techs count with no settlement. Otherwise `hasTech`.
     */
    function techUnlocked(techId, settle) {
        if (!techId) return true;
        const t = techById(techId);
        if (!t) return true;
        if (!settle) return !!(t.startUnlocked || !(Number(t.cost) > 0));
        return hasTech(settle, techId);
    }

    /**
     * Items listed on a tech require that tech on `settle`.
     * Unlisted items are always known. With no settlement, only startUnlocked techs count.
     */
    function recipeUnlocked(itemId, settle) {
        const techId = recipeTechId(itemId);
        if (!techId) return true;
        return techUnlocked(techId, settle);
    }

    function tooltipLines(item, settle) {
        const lines = Array.isArray(item?.tooltip) ? item.tooltip : [];
        const techId = item?.tooltipTech || null;
        if (techId && !techUnlocked(techId, settle)) return [];
        return lines.filter((line) => typeof line === "string" && line);
    }

    function billTechId(billId) {
        techs();
        return (billId && _billTech && _billTech[billId]) || null;
    }

    /**
     * Craft bills follow their output item. Bills listed on a tech (`unlocks.bills`)
     * require that tech. Unlisted bills (Roast, rack steps) stay available.
     */
    function billUnlocked(idOrRec, settle) {
        if (idOrRec == null) return true;
        if (typeof idOrRec === "string") {
            if (recipeTechId(idOrRec)) return recipeUnlocked(idOrRec, settle);
            const techId = billTechId(idOrRec);
            if (!techId) return true;
            return techUnlocked(techId, settle);
        }
        const rec = idOrRec;
        const recipeId = rec.recipeId || rec.id || null;
        const outputId = rec.outputId || (rec.kind === "craft" ? (rec.recipeId || rec.outputId) : null);
        if (outputId && recipeTechId(outputId)) return recipeUnlocked(outputId, settle);
        if (recipeId && recipeTechId(recipeId)) return recipeUnlocked(recipeId, settle);
        return billUnlocked(recipeId, settle);
    }

    function treeRows() {
        const rows = [];
        const walk = (id, depth, seen) => {
            if (!id || seen.has(id)) return;
            const t = techById(id);
            if (!t) return;
            seen.add(id);
            rows.push({ tech: t, depth });
            for (const child of t.children || []) walk(child, depth + 1, seen);
        };
        const seen = new Set();
        for (const id of ROOTS) walk(id, 0, seen);
        for (const t of techs()) {
            if (!seen.has(t.id)) walk(t.id, 0, seen);
        }
        return rows;
    }

    function _homeTree() {
        const home = Object.create(null);
        const walk = (id, root) => {
            if (!id || home[id]) return;
            if (!techById(id)) return;
            home[id] = root;
            for (const child of techById(id).children || []) walk(child, root);
        };
        for (const root of ROOTS) walk(root, root);
        for (const t of techs()) {
            if (!home[t.id]) walk(t.id, t.id);
        }
        return home;
    }

    function _prereqCol(id, memo, stack) {
        if (memo[id] != null) return memo[id];
        if (stack.has(id)) return 0;
        stack.add(id);
        const t = techById(id);
        let col = 0;
        for (const p of t?.prereqs || []) {
            const n = _prereqCol(p, memo, stack) + 1;
            if (n > col) col = n;
        }
        stack.delete(id);
        memo[id] = col;
        return col;
    }

    function _layerPos(layers) {
        const col = Object.create(null);
        const pos = Object.create(null);
        for (let c = 0; c < layers.length; c++) {
            for (let i = 0; i < layers[c].length; i++) {
                col[layers[c][i]] = c;
                pos[layers[c][i]] = i;
            }
        }
        return { col, pos };
    }

    function _treeRankMap(layers, blockOf) {
        const rank = Object.create(null);
        let n = 0;
        for (const layer of layers) {
            for (const id of layer) {
                const b = blockOf[id] || id;
                if (rank[b] == null) rank[b] = n++;
            }
        }
        return rank;
    }

    function _insertDummyInLayer(layer, dummy, tree, blockOf, treeRank) {
        const tr = treeRank[tree];
        let pos = 0;
        for (let i = 0; i < layer.length; i++) {
            const r = treeRank[blockOf[layer[i]] || layer[i]];
            if (r == null || (tr != null && r <= tr) || (tr == null && r == null)) pos = i + 1;
        }
        layer.splice(pos, 0, dummy);
    }

    function _withDummies(layers, edges, blockOfIn) {
        const blockOf = Object.create(null);
        for (const id of Object.keys(blockOfIn || {})) blockOf[id] = blockOfIn[id];
        const L = (layers || []).map((layer) => layer.slice());
        const { col } = _layerPos(L);
        const treeRank = _treeRankMap(L, blockOf);
        const proper = [];
        const dummyIds = new Set();
        let dummyN = 0;
        for (const e of edges || []) {
            const c0 = col[e.from];
            const c1 = col[e.to];
            if (c0 == null || c1 == null) continue;
            if (c1 === c0 + 1) {
                proper.push({ from: e.from, to: e.to });
                continue;
            }
            if (c1 <= c0) continue;
            const destBlock = blockOf[e.to] || e.to;
            let prev = e.from;
            for (let c = c0 + 1; c < c1; c++) {
                const d = `__d${dummyN++}`;
                dummyIds.add(d);
                blockOf[d] = destBlock;
                if (treeRank[destBlock] == null) treeRank[destBlock] = Object.keys(treeRank).length;
                _insertDummyInLayer(L[c], d, destBlock, blockOf, treeRank);
                col[d] = c;
                proper.push({ from: prev, to: d });
                prev = d;
            }
            proper.push({ from: prev, to: e.to });
        }
        return { layers: L, adj: proper, dummyIds, blockOf };
    }

    function _adjMaps(adj) {
        const down = Object.create(null);
        const up = Object.create(null);
        for (const e of adj) {
            (down[e.from] || (down[e.from] = [])).push(e.to);
            (up[e.to] || (up[e.to] = [])).push(e.from);
        }
        return { down, up };
    }

    function _countLayerCrossings(left, right, adj) {
        const lPos = Object.create(null);
        const rPos = Object.create(null);
        for (let i = 0; i < left.length; i++) lPos[left[i]] = i;
        for (let i = 0; i < right.length; i++) rPos[right[i]] = i;
        const pairs = [];
        for (const e of adj) {
            if (lPos[e.from] == null || rPos[e.to] == null) continue;
            pairs.push([lPos[e.from], rPos[e.to]]);
        }
        let n = 0;
        for (let i = 0; i < pairs.length; i++) {
            for (let j = i + 1; j < pairs.length; j++) {
                if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) n++;
            }
        }
        return n;
    }

    function _countCrossings(layers, adj) {
        let n = 0;
        for (let c = 0; c < layers.length - 1; c++) {
            n += _countLayerCrossings(layers[c], layers[c + 1], adj);
        }
        return n;
    }

    function _blockRuns(layer, blockOf) {
        const hasBlocks = (layer || []).some((id) => blockOf[id]);
        if (!hasBlocks) return [{ block: "_", ids: (layer || []).slice() }];
        const runs = [];
        for (const id of layer) {
            const block = blockOf[id] || id;
            if (!runs.length || runs[runs.length - 1].block !== block) {
                runs.push({ block, ids: [id] });
            } else {
                runs[runs.length - 1].ids.push(id);
            }
        }
        return runs;
    }

    function _sortRunByBary(ids, neighborPos, neigh, freeze) {
        const bary = (id, i) => {
            const ns = neigh[id] || [];
            let s = 0;
            let k = 0;
            for (const n of ns) {
                if (neighborPos[n] != null) {
                    s += neighborPos[n];
                    k++;
                }
            }
            return k ? s / k : i;
        };
        const frozen = [];
        const movable = [];
        ids.forEach((id, i) => {
            if (freeze.has(id)) frozen.push({ id, i });
            else movable.push({ id, i, b: bary(id, i) });
        });
        movable.sort((a, b) => (a.b - b.b) || (a.i - b.i) || String(a.id).localeCompare(String(b.id)));
        const slot = new Array(ids.length);
        for (const f of frozen) slot[f.i] = f.id;
        let m = 0;
        for (let i = 0; i < slot.length; i++) {
            if (slot[i] == null) slot[i] = movable[m++].id;
        }
        return slot;
    }

    function _sortLayerByBary(layer, neighborPos, neigh, blockOf, freeze) {
        const out = [];
        for (const run of _blockRuns(layer, blockOf)) {
            out.push(..._sortRunByBary(run.ids, neighborPos, neigh, freeze));
        }
        return out;
    }

    function _transpose(layers, adj, blockOf, freeze) {
        let moved = true;
        let guard = 0;
        while (moved && guard++ < 24) {
            moved = false;
            for (let c = 0; c < layers.length; c++) {
                const layer = layers[c];
                for (let i = 0; i < layer.length - 1; i++) {
                    const a = layer[i];
                    const b = layer[i + 1];
                    if (freeze.has(a) && freeze.has(b)) continue;
                    const ba = blockOf[a];
                    const bb = blockOf[b];
                    if (ba && bb && ba !== bb) continue;
                    const left = c > 0 ? layers[c - 1] : null;
                    const right = c < layers.length - 1 ? layers[c + 1] : null;
                    let before = 0;
                    if (left) before += _countLayerCrossings(left, layer, adj);
                    if (right) before += _countLayerCrossings(layer, right, adj);
                    layer[i] = b;
                    layer[i + 1] = a;
                    let after = 0;
                    if (left) after += _countLayerCrossings(left, layer, adj);
                    if (right) after += _countLayerCrossings(layer, right, adj);
                    if (after < before) moved = true;
                    else {
                        layer[i] = a;
                        layer[i + 1] = b;
                    }
                }
            }
        }
    }

    /**
     * Sugiyama crossing reduction. `layers[c]` is top-to-bottom ids in column c.
     * Nodes with the same `blockOf` stay in contiguous bands; `freeze` ids keep
     * their index inside a band. Long edges get dummy vertices, then stripped.
     */
    function orderLayers(layers, edges, opts = {}) {
        const freeze = new Set(opts.freeze || []);
        const seedBlocks = opts.blockOf || Object.create(null);
        const sweeps = Math.max(1, Number(opts.sweeps) || 12);
        const packed = _withDummies(layers, edges, seedBlocks);
        const { adj, dummyIds } = packed;
        const blockOf = packed.blockOf;
        const { up, down } = _adjMaps(adj);
        let L = packed.layers;
        let best = L.map((layer) => layer.slice());
        let bestC = _countCrossings(best, adj);
        for (let s = 0; s < sweeps && bestC > 0; s++) {
            for (let c = 1; c < L.length; c++) {
                const pos = Object.create(null);
                L[c - 1].forEach((id, i) => { pos[id] = i; });
                L[c] = _sortLayerByBary(L[c], pos, up, blockOf, freeze);
            }
            _transpose(L, adj, blockOf, freeze);
            let cr = _countCrossings(L, adj);
            if (cr < bestC) {
                bestC = cr;
                best = L.map((layer) => layer.slice());
            }
            for (let c = L.length - 2; c >= 0; c--) {
                const pos = Object.create(null);
                L[c + 1].forEach((id, i) => { pos[id] = i; });
                L[c] = _sortLayerByBary(L[c], pos, down, blockOf, freeze);
            }
            _transpose(L, adj, blockOf, freeze);
            cr = _countCrossings(L, adj);
            if (cr < bestC) {
                bestC = cr;
                best = L.map((layer) => layer.slice());
            }
        }
        return best.map((layer) => layer.filter((id) => !dummyIds.has(id)));
    }

    function _seedTreeIds(root, home) {
        const order = [];
        const seen = new Set();
        const walk = (id) => {
            if (!id || seen.has(id) || home[id] !== root) return;
            if (!techById(id)) return;
            seen.add(id);
            order.push(id);
            for (const child of techById(id).children || []) walk(child);
        };
        walk(root);
        for (const t of techs()) {
            if (home[t.id] === root && !seen.has(t.id)) walk(t.id);
        }
        return order;
    }

    function _layoutRoots(home) {
        const roots = [];
        const seenRoot = new Set();
        for (const id of ROOTS) {
            if (techById(id) && !seenRoot.has(id)) {
                seenRoot.add(id);
                roots.push(id);
            }
        }
        for (const t of techs()) {
            if (home[t.id] === t.id && !seenRoot.has(t.id)) {
                seenRoot.add(t.id);
                roots.push(t.id);
            }
        }
        return roots;
    }

    /**
     * Left-to-right RimWorld-style layout: column = prereq depth, trees stacked
     * vertically in ROOTS order. `x`/`y`/`w`/`h` are in the given box units.
     * Order inside a band is crossing-reduced; nodes do not change trees.
     */
    function treeLayout(opts = {}) {
        techs();
        const boxW = Math.max(1, Number(opts.boxW) || 1);
        const boxH = Math.max(1, Number(opts.boxH) || 1);
        const colGap = Math.max(0, Number(opts.colGap) || 0);
        const rowGap = Math.max(0, Number(opts.rowGap) || 0);
        const treeGap = Math.max(0, Number(opts.treeGap) || 0);
        const pad = Math.max(0, Number(opts.pad) || 0);
        const home = _homeTree();
        const colMemo = Object.create(null);
        const stack = new Set();
        for (const t of techs()) _prereqCol(t.id, colMemo, stack);
        const roots = _layoutRoots(home);

        let maxCol = 0;
        for (const t of techs()) {
            const c = colMemo[t.id] || 0;
            if (c > maxCol) maxCol = c;
        }
        const layers = [];
        for (let c = 0; c <= maxCol; c++) layers.push([]);
        const blockOf = Object.create(null);
        for (const root of roots) {
            for (const id of _seedTreeIds(root, home)) {
                blockOf[id] = root;
                layers[colMemo[id] || 0].push(id);
            }
        }
        const prereqEdges = [];
        for (const t of techs()) {
            for (const p of t.prereqs || []) {
                if (techById(p)) prereqEdges.push({ from: p, to: t.id });
            }
        }
        const ordered = orderLayers(layers, prereqEdges, {
            freeze: roots,
            blockOf
        });
        const rank = Object.create(null);
        for (const layer of ordered) {
            let prev = null;
            let i = 0;
            for (const id of layer) {
                const b = blockOf[id] || id;
                if (b !== prev) {
                    i = 0;
                    prev = b;
                }
                rank[id] = i++;
            }
        }

        const nodes = [];
        const byId = Object.create(null);
        let yBase = 0;
        for (const root of roots) {
            const unitY = Object.create(null);
            const cols = Object.create(null);
            for (const t of techs()) {
                if (home[t.id] !== root) continue;
                const c = colMemo[t.id] || 0;
                if (!cols[c]) cols[c] = [];
                cols[c].push(t.id);
            }
            for (const key of Object.keys(cols)) {
                const list = cols[key].sort((a, b) =>
                    ((rank[a] || 0) - (rank[b] || 0)) || String(a).localeCompare(String(b))
                );
                for (let i = 0; i < list.length; i++) unitY[list[i]] = i;
            }
            const kids = (techById(root)?.children || []).filter((c) => home[c] === root && techById(c));
            if (kids.length && unitY[root] != null) {
                const ys = kids.map((id) => unitY[id]).filter((y) => y != null);
                if (ys.length) unitY[root] = (Math.min(...ys) + Math.max(...ys)) / 2;
            }
            for (const key of Object.keys(cols)) {
                const list = cols[key].sort((a, b) =>
                    (unitY[a] - unitY[b]) || String(a).localeCompare(String(b))
                );
                for (let i = 1; i < list.length; i++) {
                    const minY = unitY[list[i - 1]] + 1;
                    if (unitY[list[i]] < minY) unitY[list[i]] = minY;
                }
            }
            let maxUnit = 0;
            for (const t of techs()) {
                if (home[t.id] !== root) continue;
                const col = colMemo[t.id] || 0;
                const uy = Number(unitY[t.id]) || 0;
                if (uy > maxUnit) maxUnit = uy;
                const node = {
                    id: t.id,
                    tech: t,
                    col,
                    tree: root,
                    x: pad + col * (boxW + colGap),
                    y: pad + yBase + uy * (boxH + rowGap),
                    w: boxW,
                    h: boxH,
                    shape: eraShape(t.era)
                };
                nodes.push(node);
                byId[t.id] = node;
            }
            yBase += (maxUnit + 1) * (boxH + rowGap) + treeGap;
        }

        const edges = [];
        for (const n of nodes) {
            for (const p of n.tech.prereqs || []) {
                if (byId[p]) edges.push({ from: p, to: n.id });
            }
        }
        let width = pad;
        let height = pad;
        for (const n of nodes) {
            width = Math.max(width, n.x + n.w + pad);
            height = Math.max(height, n.y + n.h + pad);
        }
        return { nodes, edges, byId, width, height };
    }

    function eraShape(era) {
        const key = _eraKey(era);
        if (key === "paleolithic") return "oval";
        if (key === "neolithic") return "hex";
        if (key === "chalcolithic") return "trap";
        return "rect";
    }

    function hexCap(h, sw) {
        return Math.max(8, Math.round((Number(h) - (Number(sw) || 0)) * 0.3));
    }

    function trapCap(h, sw) {
        return hexCap(h, sw);
    }

    /** Left outline X of a node at world `y` (pill / hex / rect). */
    function nodeLeftX(node, y, opts = {}) {
        if (!node) return 0;
        const sw = Math.max(0, Number(opts.stroke) || 0);
        const inset = sw * 0.5;
        const x = Number(node.x) || 0;
        const h = Math.max(1, Number(node.h) || 1);
        const top = Number(node.y) || 0;
        const shape = node.shape || eraShape(node.tech?.era);
        const ny = Number(y);
        if (shape === "oval") {
            const r = Math.max(1, (h - sw) * 0.5);
            const cy = top + h * 0.5;
            const dy = ny - cy;
            const inside = r * r - dy * dy;
            if (inside <= 0) return x + inset + r;
            return x + h * 0.5 - Math.sqrt(inside);
        }
        if (shape === "hex") {
            const cap = hexCap(h, sw);
            const mid = top + h * 0.5;
            const span = Math.max(1, h * 0.5 - inset);
            const t = Math.min(1, Math.abs(ny - mid) / span);
            return x + inset + cap * t;
        }
        if (shape === "trap") {
            const cap = trapCap(h, sw);
            const y0 = top + inset;
            const y1 = top + h - inset;
            const span = Math.max(1, y1 - y0);
            const t = Math.max(0, Math.min(1, (ny - y0) / span));
            return x + inset + cap * (1 - t);
        }
        return x;
    }

    /** Right outline X of a node at world `y`. */
    function nodeRightX(node, y, opts = {}) {
        if (!node) return 0;
        const sw = Math.max(0, Number(opts.stroke) || 0);
        const inset = sw * 0.5;
        const x = Number(node.x) || 0;
        const w = Math.max(1, Number(node.w) || 1);
        const h = Math.max(1, Number(node.h) || 1);
        const top = Number(node.y) || 0;
        const shape = node.shape || eraShape(node.tech?.era);
        const ny = Number(y);
        if (shape === "oval") {
            const r = Math.max(1, (h - sw) * 0.5);
            const cy = top + h * 0.5;
            const dy = ny - cy;
            const inside = r * r - dy * dy;
            if (inside <= 0) return x + w - inset - r;
            return x + w - h * 0.5 + Math.sqrt(inside);
        }
        if (shape === "hex") {
            const cap = hexCap(h, sw);
            const mid = top + h * 0.5;
            const span = Math.max(1, h * 0.5 - inset);
            const t = Math.min(1, Math.abs(ny - mid) / span);
            return x + w - inset - cap * t;
        }
        if (shape === "trap") {
            const cap = trapCap(h, sw);
            const y0 = top + inset;
            const y1 = top + h - inset;
            const span = Math.max(1, y1 - y0);
            const t = Math.max(0, Math.min(1, (ny - y0) / span));
            return x + w - inset - cap * (1 - t);
        }
        return x + w;
    }

    function _mergeSpans(spans) {
        const list = (spans || []).slice().sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const s of list) {
            if (!merged.length || s[0] > merged[merged.length - 1][1]) merged.push(s.slice());
            else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], s[1]);
        }
        return merged;
    }

    function _gapYs(colNodes, pad) {
        const p = Math.max(0, Number(pad) || 0);
        const merged = _mergeSpans((colNodes || []).map((n) => [n.y - p, n.y + n.h + p]));
        const ys = [];
        if (!merged.length) return ys;
        ys.push(merged[0][0] - 8);
        ys.push(merged[merged.length - 1][1] + 8);
        for (let i = 0; i < merged.length - 1; i++) {
            const a = merged[i][1];
            const b = merged[i + 1][0];
            if (b - a > 1) ys.push((a + b) / 2);
        }
        return ys;
    }

    function _yBlocked(colNodes, y, pad, ignoreIds) {
        const p = Math.max(0, Number(pad) || 0);
        const ignore = ignoreIds || new Set();
        return (colNodes || []).some((n) => (
            n && !ignore.has(n.id)
            && y > n.y - p && y < n.y + n.h + p
        ));
    }

    function _pickGapY(colNodes, targetY, pad, used, ignoreIds) {
        const ty = Number(targetY) || 0;
        const taken = (y) => (used || []).some((u) => Math.abs(u - y) < 1);
        if (!_yBlocked(colNodes, ty, pad, ignoreIds) && !taken(ty)) return ty;
        const cands = _gapYs(colNodes, pad);
        if (!cands.length) return ty;
        const open = cands.filter((y) => !taken(y));
        const pool = open.length ? open : cands;
        let best = pool[0];
        let bestD = Math.abs(best - ty);
        for (let i = 1; i < pool.length; i++) {
            const d = Math.abs(pool[i] - ty);
            if (d < bestD) {
                bestD = d;
                best = pool[i];
            }
        }
        return best;
    }

    function _leftEdge(intervals) {
        const order = (intervals || []).map((_, i) => i).sort((a, b) => {
            const la = intervals[a].last ? 0 : 1;
            const lb = intervals[b].last ? 0 : 1;
            if (la !== lb) return la - lb;
            const ay = Math.min(intervals[a].lo, intervals[a].hi);
            const by = Math.min(intervals[b].lo, intervals[b].hi);
            return (ay - by) || (a - b);
        });
        const tracks = [];
        const color = new Array(intervals.length).fill(0);
        for (const i of order) {
            const lo = Math.min(intervals[i].lo, intervals[i].hi);
            const hi = Math.max(intervals[i].lo, intervals[i].hi);
            let t = 0;
            for (; t < tracks.length; t++) {
                if (tracks[t] < lo) break;
            }
            if (t === tracks.length) tracks.push(hi);
            else tracks[t] = hi;
            color[i] = t;
        }
        return color;
    }

    function _channelBounds(nodes, col, pad) {
        const p = Math.max(2, Number(pad) || 2);
        let geoMin = -Infinity;
        let geoMax = Infinity;
        for (const n of nodes || []) {
            if (n.col === col) geoMin = Math.max(geoMin, n.x + n.w + p);
            if (n.col === col + 1) geoMax = Math.min(geoMax, n.x - p);
        }
        if (!Number.isFinite(geoMin) || !Number.isFinite(geoMax)) {
            for (const n of nodes || []) {
                if (n.col === col && !Number.isFinite(geoMin)) geoMin = n.x + n.w + p;
                if (n.col === col + 1 && !Number.isFinite(geoMax)) geoMax = n.x - p;
            }
        }
        if (!Number.isFinite(geoMin)) geoMin = 0;
        if (!Number.isFinite(geoMax)) geoMax = geoMin + 24;
        if (geoMin > geoMax) {
            const mid = (geoMin + geoMax) / 2;
            geoMin = mid - 4;
            geoMax = mid + 4;
        }
        const minX = geoMin + (geoMax - geoMin) * 0.4;
        return { minX, maxX: geoMax, geoMin, geoMax };
    }

    function _trackX(track, minX, maxX, laneGap, nTracks) {
        const n = Math.max(1, nTracks | 0);
        const span = Math.max(0, maxX - minX);
        const want = Math.max(3, Number(laneGap) || 6);
        const gap = n > 1 && (n - 1) * want > span ? span / Math.max(1, n - 1) : want;
        return Math.max(minX, Math.min(maxX, maxX - track * gap));
    }

    function _dedupePath(pts) {
        const out = [];
        for (const p of pts || []) {
            if (!out.length) {
                out.push([p[0], p[1]]);
                continue;
            }
            const q = out[out.length - 1];
            if (Math.abs(q[0] - p[0]) < 0.05 && Math.abs(q[1] - p[1]) < 0.05) continue;
            if (out.length >= 2) {
                const r = out[out.length - 2];
                if ((Math.abs(q[0] - r[0]) < 0.05 && Math.abs(q[0] - p[0]) < 0.05)
                    || (Math.abs(q[1] - r[1]) < 0.05 && Math.abs(q[1] - p[1]) < 0.05)) {
                    out[out.length - 1] = [p[0], p[1]];
                    continue;
                }
            }
            out.push([p[0], p[1]]);
        }
        return out;
    }

    function _clusterThresh(nodes) {
        let h = 52;
        if (nodes && nodes[0]) h = Number(nodes[0].h) || h;
        const gaps = [];
        const byCol = Object.create(null);
        for (const n of nodes || []) {
            const c = n.col;
            if (!byCol[c]) byCol[c] = [];
            byCol[c].push(n.y);
        }
        for (const list of Object.values(byCol)) {
            list.sort((a, b) => a - b);
            for (let i = 1; i < list.length; i++) {
                const g = list[i] - list[i - 1] - h;
                if (g > 0 && g < h * 3) gaps.push(g);
            }
        }
        let gap = 18;
        if (gaps.length) {
            gaps.sort((a, b) => a - b);
            gap = gaps[Math.floor(gaps.length / 2)];
        }
        return { h, gap, clusterAt: 2 * (h + gap) };
    }

    function _overlap1d(a0, a1, b0, b1) {
        return Math.min(a0, a1) < Math.max(b0, b1) && Math.max(a0, a1) > Math.min(b0, b1);
    }

    function _attachY(to, idx, count, avoidYs, laneGap) {
        const n = Math.max(1, count);
        const lo = to.y + 6;
        const hi = to.y + to.h - 6;
        const cands = [to.y + to.h * (idx + 1) / (n + 1)];
        for (const t of [0.28, 0.72, 0.22, 0.78, 0.38, 0.62, 0.5]) {
            cands.push(to.y + to.h * t);
        }
        const clear = (y) => (avoidYs || []).every((a) => Math.abs(a - y) >= laneGap);
        for (const y of cands) {
            if (y >= lo && y <= hi && clear(y)) return y;
        }
        return Math.max(lo, Math.min(hi, cands[0]));
    }

    /**
     * Push apart remaining collinear strokes from different parents.
     */
    function _separateCollinear(routed, opts = {}) {
        const gap = Math.max(4, Number(opts.gap) || 6);
        const nodes = opts.nodes || [];
        const pad = Math.max(0, Number(opts.pad) || 0);
        const stroke = opts.stroke;
        const byId = Object.create(null);
        for (const n of nodes) {
            if (n?.id) byId[n.id] = n;
        }
        const hitsNode = (x0, y0, x1, y1, fromId, toId) => nodes.some((n) => (
            n && n.id !== fromId && n.id !== toId
            && Math.max(x0, x1) > n.x - pad && Math.min(x0, x1) < n.x + n.w + pad
            && Math.max(y0, y1) > n.y - pad && Math.min(y0, y1) < n.y + n.h + pad
        ));
        for (let round = 0; round < 8; round++) {
            const verts = [];
            const hors = [];
            for (const r of routed || []) {
                const path = r.path || [];
                for (let i = 1; i < path.length; i++) {
                    const a = path[i - 1];
                    const b = path[i];
                    const first = i === 1;
                    const last = i === path.length - 1;
                    if (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) >= 1) {
                        verts.push({
                            r, i, x: a[0],
                            y0: Math.min(a[1], b[1]),
                            y1: Math.max(a[1], b[1]),
                            from: r.from,
                            to: r.to
                        });
                    } else if (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[0] - b[0]) >= 1) {
                        hors.push({
                            r, i, y: a[1],
                            x0: Math.min(a[0], b[0]),
                            x1: Math.max(a[0], b[0]),
                            from: r.from,
                            to: r.to,
                            pinned: first || last
                        });
                    }
                }
            }
            let moved = false;
            verts.sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0));
            for (const a of verts) {
                const hit = verts.some((b) => (
                    b !== a
                    && a.from !== b.from
                    && Math.abs(a.x - b.x) < gap
                    && _overlap1d(a.y0, a.y1, b.y0, b.y1)
                ));
                if (!hit) continue;
                let chosen = null;
                for (let k = 1; k <= 24 && chosen == null; k++) {
                    for (const x of [a.x - k * gap, a.x + k * gap]) {
                        if (hitsNode(x, a.y0, x, a.y1, a.from, a.to)) continue;
                        if (verts.some((b) => (
                            b !== a
                            && a.from !== b.from
                            && Math.abs(x - b.x) < gap
                            && _overlap1d(a.y0, a.y1, b.y0, b.y1)
                        ))) continue;
                        chosen = x;
                        break;
                    }
                }
                if (chosen == null) continue;
                a.r.path[a.i - 1][0] = chosen;
                a.r.path[a.i][0] = chosen;
                a.x = chosen;
                moved = true;
            }
            hors.sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0));
            for (const a of hors) {
                if (a.pinned) continue;
                const hit = hors.some((b) => (
                    b !== a
                    && a.from !== b.from
                    && Math.abs(a.y - b.y) < gap
                    && _overlap1d(a.x0, a.x1, b.x0, b.x1)
                ));
                if (!hit) continue;
                let chosen = null;
                for (let k = 1; k <= 24 && chosen == null; k++) {
                    for (const y of [a.y - k * gap, a.y + k * gap]) {
                        if (hitsNode(a.x0, y, a.x1, y, a.from, a.to)) continue;
                        if (hors.some((b) => (
                            b !== a
                            && a.from !== b.from
                            && Math.abs(y - b.y) < gap
                            && _overlap1d(a.x0, a.x1, b.x0, b.x1)
                        ))) continue;
                        chosen = y;
                        break;
                    }
                }
                if (chosen == null) continue;
                a.r.path[a.i - 1][1] = chosen;
                a.r.path[a.i][1] = chosen;
                a.y = chosen;
                moved = true;
            }
            for (const a of hors) {
                const last = a.i === a.r.path.length - 1;
                if (!last) continue;
                const dest = byId[a.to];
                if (!dest) continue;
                const incoming = (routed || []).filter((r) => r.to === a.to).length;
                if (incoming <= 1) continue;
                const hit = hors.some((b) => (
                    b !== a
                    && a.from !== b.from
                    && Math.abs(a.y - b.y) < gap
                    && _overlap1d(a.x0, a.x1, b.x0, b.x1)
                ));
                if (!hit) continue;
                const yMin = dest.y + 6;
                const yMax = dest.y + dest.h - 6;
                let chosen = null;
                for (let k = 1; k <= 12 && chosen == null; k++) {
                    for (const y of [a.y - k * gap, a.y + k * gap]) {
                        if (y < yMin || y > yMax) continue;
                        if (hors.some((b) => (
                            b !== a
                            && a.from !== b.from
                            && Math.abs(y - b.y) < gap
                            && _overlap1d(a.x0, a.x1, b.x0, b.x1)
                        ))) continue;
                        chosen = y;
                        break;
                    }
                }
                if (chosen == null) continue;
                a.r.path[a.i - 1][1] = chosen;
                a.r.path[a.i][1] = chosen;
                a.r.path[a.i][0] = nodeLeftX(dest, chosen, { stroke });
                a.y = chosen;
                moved = true;
            }
            if (!moved) break;
        }
        for (const r of routed || []) r.path = _dedupePath(r.path);
    }

    /**
     * Orthogonal prereq path that always enters `to` on the left.
     */
    function edgePath(from, to, opts = {}) {
        if (!from || !to) return [];
        const nodes = opts.obstacles || [from, to];
        const byId = Object.create(null);
        for (const n of nodes) {
            if (n?.id) byId[n.id] = n;
        }
        byId[from.id] = from;
        byId[to.id] = to;
        const routed = layoutEdgePaths({
            nodes,
            byId,
            edges: [{ from: from.id, to: to.id }]
        }, opts);
        return (routed[0] && routed[0].path) || [];
    }

    /**
     * Layered orthogonal routing. Every edge goes right out of the source,
     * verticals live in the dest-side of each column gutter (left-edge
     * interval coloring), skip-column hops travel in row gaps, and dest is
     * always entered from the left.
     */
    function layoutEdgePaths(layout, opts = {}) {
        const nodes = layout?.nodes || [];
        const byId = layout?.byId || {};
        const edges = layout?.edges || [];
        const laneGap = Math.max(3, Number(opts.laneGap) || 6);
        const stroke = opts.stroke;
        const sw = Math.max(2, Number(stroke) || 2);
        const boxPad = Math.max(8, sw + 6);
        const { clusterAt } = _clusterThresh(nodes);
        const incoming = new Map();
        for (const e of edges) {
            if (!incoming.has(e.to)) incoming.set(e.to, []);
            incoming.get(e.to).push(e);
        }
        for (const list of incoming.values()) {
            list.sort((e1, e2) => {
                const a = byId[e1.from];
                const b = byId[e2.from];
                return ((a?.y || 0) - (b?.y || 0)) || String(e1.from).localeCompare(String(e2.from));
            });
        }
        const byCol = Object.create(null);
        for (const n of nodes) {
            const c = Number(n.col) || 0;
            if (!byCol[c]) byCol[c] = [];
            byCol[c].push(n);
        }
        const jobs = [];
        const usedByCol = Object.create(null);
        for (const e of edges) {
            const from = byId[e.from];
            const to = byId[e.to];
            if (!from || !to) continue;
            const group = incoming.get(e.to) || [e];
            const idx = Math.max(0, group.indexOf(e));
            const y0 = from.y + from.h * 0.5;
            let c0 = Number(from.col);
            let c1 = Number(to.col);
            if (!Number.isFinite(c0) || !Number.isFinite(c1) || c1 <= c0) {
                c0 = 0;
                c1 = 1;
            }
            const avoid = (byCol[c1 - 1] || [])
                .filter((n) => n.id !== from.id)
                .map((n) => n.y + n.h * 0.5);
            const y1 = opts.attachY != null
                ? Number(opts.attachY)
                : (edges.length === 1 || group.length === 1
                    ? to.y + to.h * 0.5
                    : _attachY(to, idx, group.length, avoid, laneGap));
            const ys = [y0];
            const ignore = new Set([from.id, to.id]);
            for (let c = c0 + 1; c < c1; c++) {
                if (!usedByCol[c]) usedByCol[c] = [];
                const col = byCol[c] || [];
                let y;
                if (!_yBlocked(col, y0, boxPad, ignore)) y = y0;
                else if (!_yBlocked(col, y1, boxPad, ignore)) y = y1;
                else y = _pickGapY(col, y0, boxPad, usedByCol[c], ignore);
                if (Math.abs(y - y0) >= 1 && Math.abs(y - y1) >= 1) usedByCol[c].push(y);
                ys.push(y);
            }
            ys.push(y1);
            const job = {
                fromId: from.id,
                toId: to.id,
                from,
                to,
                c0,
                c1,
                ys,
                x0: nodeRightX(from, y0, { stroke }),
                x1: nodeLeftX(to, y1, { stroke }),
                verts: []
            };
            for (let c = c0; c < c1; c++) {
                const k = c - c0;
                const ya = ys[k];
                const yb = ys[k + 1];
                if (Math.abs(yb - ya) < 1 && c < c1 - 1) continue;
                job.verts.push({
                    ch: c,
                    y0: ya,
                    y1: yb,
                    fromId: from.id,
                    last: c === c1 - 1
                });
            }
            jobs.push(job);
        }
        const groups = new Map();
        for (const job of jobs) {
            for (const v of job.verts) {
                const key = `${v.fromId}:${v.ch}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(v);
            }
        }
        const intervalsByCh = new Map();
        const owner = new Map();
        for (const group of groups.values()) {
            group.sort((a, b) => Math.min(a.y0, a.y1) - Math.min(b.y0, b.y1));
            let cur = [group[0]];
            const flush = () => {
                const lo = Math.min(...cur.map((v) => Math.min(v.y0, v.y1)));
                const hi = Math.max(...cur.map((v) => Math.max(v.y0, v.y1)));
                const ch = cur[0].ch;
                if (!intervalsByCh.has(ch)) intervalsByCh.set(ch, []);
                const iv = { lo, hi, ch, last: cur.some((v) => v.last) };
                intervalsByCh.get(ch).push(iv);
                for (const v of cur) owner.set(v, iv);
            };
            for (let i = 1; i < group.length; i++) {
                const prev = cur[cur.length - 1];
                const destGap = Math.abs(
                    Math.max(group[i].y0, group[i].y1) - Math.max(prev.y0, prev.y1)
                );
                if (destGap > clusterAt) {
                    flush();
                    cur = [group[i]];
                } else cur.push(group[i]);
            }
            flush();
        }
        const xOf = new Map();
        const boundsOf = new Map();
        for (const [ch, list] of intervalsByCh) {
            const colors = _leftEdge(list);
            const bounds = _channelBounds(nodes, ch, boxPad);
            boundsOf.set(ch, bounds);
            let nTracks = 1;
            for (const t of colors) nTracks = Math.max(nTracks, t + 1);
            for (let i = 0; i < list.length; i++) {
                xOf.set(list[i], _trackX(colors[i], bounds.minX, bounds.maxX, laneGap, nTracks));
            }
        }
        const stub = Math.max(laneGap, 8);
        const horiz = [];
        for (const job of jobs) {
            for (let k = 1; k < job.ys.length - 1; k++) {
                const left = job.verts[k - 1];
                const right = job.verts[k];
                const x0 = xOf.get(owner.get(left));
                const x1 = xOf.get(owner.get(right));
                if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
                horiz.push({
                    job,
                    k,
                    y: job.ys[k],
                    lo: Math.min(x0, x1),
                    hi: Math.max(x0, x1),
                    fromId: job.fromId,
                    col: job.c0 + k
                });
            }
        }
        const hGroups = new Map();
        for (const h of horiz) {
            const key = `${h.col}:${Math.round(h.y)}`;
            if (!hGroups.has(key)) hGroups.set(key, []);
            hGroups.get(key).push(h);
        }
        for (const list of hGroups.values()) {
            const byParent = new Map();
            for (const h of list) {
                if (!byParent.has(h.fromId)) byParent.set(h.fromId, []);
                byParent.get(h.fromId).push(h);
            }
            const ivs = [];
            const members = [];
            for (const bunch of byParent.values()) {
                ivs.push({
                    lo: Math.min(...bunch.map((h) => h.lo)),
                    hi: Math.max(...bunch.map((h) => h.hi))
                });
                members.push(bunch);
            }
            if (ivs.length < 2) continue;
            const colors = _leftEdge(ivs);
            const colNodes = byCol[list[0].col] || [];
            const cands = _gapYs(colNodes, boxPad);
            for (let i = 0; i < members.length; i++) {
                if (colors[i] === 0) continue;
                const prefer = members[i][0].y;
                const taken = list.map((h) => h.y);
                const y = cands.length
                    ? _pickGapY(colNodes, prefer, boxPad, taken)
                    : prefer + colors[i] * laneGap;
                for (const h of members[i]) {
                    h.job.ys[h.k] = y;
                    h.y = y;
                    if (h.job.verts[h.k - 1]) h.job.verts[h.k - 1].y1 = y;
                    if (h.job.verts[h.k]) h.job.verts[h.k].y0 = y;
                }
            }
        }
        const out = [];
        for (const job of jobs) {
            const pts = [[job.x0, job.ys[0]]];
            for (const v of job.verts) {
                const bounds = boundsOf.get(v.ch);
                let x = xOf.get(owner.get(v));
                if (!Number.isFinite(x)) x = job.x0 + stub;
                if (v === job.verts[0]) {
                    x = Math.max(x, job.x0 + stub);
                    if (bounds) x = Math.min(bounds.maxX, Math.max(bounds.minX, x));
                }
                pts.push([x, v.y0]);
                pts.push([x, v.y1]);
            }
            pts.push([job.x1, job.ys[job.ys.length - 1]]);
            out.push({ from: job.fromId, to: job.toId, path: _dedupePath(pts) });
        }
        _separateCollinear(out, { gap: laneGap, pad: boxPad, nodes, stroke });
        return out;
    }

    function minuteDelta(now, last) {
        const a = ((Math.floor(Number(now) || 0) % 1440) + 1440) % 1440;
        const b = ((Math.floor(Number(last) || 0) % 1440) + 1440) % 1440;
        return (a - b + 1440) % 1440;
    }

    return {
        PAINT_MAX,
        PAINT_MINUTES,
        TALLY_ITEM_ID,
        ROOTS,
        ERAS,
        FOG_COPY,
        UI_PAINT_TINT,
        UI_ICON_KEY,
        UI_SCIENCE_KEY,
        UI_TITLE_HAND_KEY,
        UI_CULTURE_HAND_KEY,
        currencies,
        pointsTip,
        formatPoints,
        spentTipValue,
        isFreeTech,
        techCostLabel,
        remainingUnlockIds,
        remainingUnlockCost,
        remainingCostLabel,
        techTip,
        isActionUnlock,
        unlockTextIcon,
        setTechs,
        techs,
        techById,
        startUnlockedIds,
        isPaintingCircle,
        standWorldPos,
        workFacing,
        workFacingForIndex,
        paintWallLocal,
        paintFleckTint,
        pickPaintFleckKind,
        ghostOverlayAlpha,
        overlayKey,
        tallyOverlayKey,
        parseFillColor,
        pigmentTint,
        overlayTint,
        ensureEntry,
        isEnabled,
        setEnabled,
        emptyPaintFilter,
        normalizePaintFilter,
        persistPaintFilter,
        applyPaintFilter,
        allowsPigment,
        listPigments,
        buildPigmentTree,
        paintCategoryState,
        paintItemState,
        togglePaintItem,
        togglePaintCategory,
        paintedCount,
        hasTally,
        circlePoints,
        circlePointsTotal,
        tallyBonus,
        needsTallyInstall,
        installTally,
        removeTally,
        lockedCount,
        availableOn,
        hasRoom,
        inProgress,
        needsPigment,
        isPigment,
        currentPigmentId,
        startPaint,
        consumePigment,
        addPaintMinutes,
        lockOn,
        lockPaintings,
        availableTotal,
        pointsBreakdown,
        availablePoints,
        spentPoints,
        paintedTotal,
        remainingAfterRemove,
        remainingAfterUninstallTally,
        canRemoveCircle,
        canRemoveTally,
        removeBlockedReason,
        tallyRemoveBlockedReason,
        removeConfirmCopy,
        relockToSpent,
        defaultTechs,
        ensureTechs,
        hasTech,
        missingPrereqs,
        canUnlock,
        unlockBlockedReason,
        eraIndex,
        techsInEra,
        eraProgress,
        qualifiesForEra,
        currentAge,
        currentAgeIndex,
        eraVisible,
        techFogged,
        eraIcon,
        visibleEras,
        ageBreakdown,
        ageTip,
        unlock,
        unlockChain,
        recipeTechId,
        recipeUnlocked,
        techUnlocked,
        tooltipLines,
        billTechId,
        billUnlocked,
        eraShape,
        hexCap,
        trapCap,
        nodeLeftX,
        nodeRightX,
        treeRows,
        treeLayout,
        orderLayers,
        edgePath,
        layoutEdgePaths,
        minuteDelta
    };
});
