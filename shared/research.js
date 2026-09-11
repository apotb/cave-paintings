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

    /**
     * Left-to-right RimWorld-style layout: column = prereq depth, trees stacked
     * vertically in ROOTS order. `x`/`y`/`w`/`h` are in the given box units.
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

        const nodes = [];
        const byId = Object.create(null);
        let yBase = 0;
        for (const root of roots) {
            const unitY = Object.create(null);
            const acc = { y: 0 };
            const place = (id) => {
                if (unitY[id] != null) return unitY[id];
                const t = techById(id);
                const kids = (t?.children || []).filter((c) => home[c] === root && techById(c));
                if (!kids.length) {
                    unitY[id] = acc.y;
                    acc.y += 1;
                    return unitY[id];
                }
                const ys = kids.map(place);
                unitY[id] = (Math.min(...ys) + Math.max(...ys)) / 2;
                return unitY[id];
            };
            if (techById(root)) place(root);
            for (const t of techs()) {
                if (home[t.id] === root && unitY[t.id] == null) place(t.id);
            }
            const cols = Object.create(null);
            for (const t of techs()) {
                if (home[t.id] !== root) continue;
                const c = colMemo[t.id] || 0;
                if (!cols[c]) cols[c] = [];
                cols[c].push(t.id);
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

    function _segHitsNode(x0, y0, x1, y1, n) {
        if (!n) return false;
        const left = Math.min(x0, x1);
        const right = Math.max(x0, x1);
        const top = Math.min(y0, y1);
        const bottom = Math.max(y0, y1);
        return right >= n.x && left <= n.x + n.w
            && bottom >= n.y && top <= n.y + n.h;
    }

    function _polyHits(pts, obstacles) {
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            for (const n of obstacles) {
                if (_segHitsNode(a[0], a[1], b[0], b[1], n)) return true;
            }
        }
        return false;
    }

    function _clearBusX(to, y0, y1, obstacles, inset) {
        const x1 = to.x;
        let busX = x1 - inset;
        const yTop = Math.min(y0, y1);
        const yBot = Math.max(y0, y1);
        const blocked = (x) => obstacles.some((n) => (
            x >= n.x && x <= n.x + n.w
            && yBot >= n.y && yTop <= n.y + n.h
        ));
        while (busX < x1 - 2 && blocked(busX)) busX += 1;
        if (blocked(busX) || busX >= x1) busX = x1 - Math.min(inset, 4);
        return busX;
    }

    function _gapYs(x0, x1, obstacles, pad) {
        const left = Math.min(x0, x1);
        const right = Math.max(x0, x1);
        const spans = [];
        for (const n of obstacles || []) {
            if (!n) continue;
            if (n.x + n.w < left || n.x > right) continue;
            spans.push([n.y - pad, n.y + n.h + pad]);
        }
        spans.sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const s of spans) {
            if (!merged.length || s[0] > merged[merged.length - 1][1]) merged.push(s.slice());
            else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], s[1]);
        }
        const ys = [];
        for (let i = 0; i < merged.length - 1; i++) {
            const a = merged[i][1];
            const b = merged[i + 1][0];
            if (b - a > 4) ys.push((a + b) / 2);
        }
        if (merged.length) {
            ys.push(merged[0][0] - 8);
            ys.push(merged[merged.length - 1][1] + 8);
        }
        return ys;
    }

    function _isFarEdge(from, to, inset) {
        const dc = Number(to?.col) - Number(from?.col);
        if (Number.isFinite(dc)) return dc >= 2;
        return (to.x - from.x - from.w) > inset * 3;
    }

    /**
     * Penalize riding the source row across skipped columns. Adjacent hops
     * keep the dest-gutter Z; long hops drop in the source gutter instead.
     */
    function _routeCost(pts, y0, y1) {
        let cost = (pts.length - 1) * 4;
        const destDy = Math.abs(y1 - y0);
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            const dx = Math.abs(b[0] - a[0]);
            const dy = Math.abs(b[1] - a[1]);
            cost += dx + dy;
            if (dy < 0.5 && dx > 100 && destDy > 8) {
                const y = a[1];
                if (Math.abs(y - y0) < 2) cost += dx * 8;
            }
        }
        return cost;
    }

    function _gapAttempts(x0, y0, x1, y1, sx, vx, obstacles) {
        const lo = Math.min(y0, y1);
        const hi = Math.max(y0, y1);
        const slack = Math.max(80, hi - lo);
        const inSpan = [];
        const near = [];
        for (const y of _gapYs(Math.min(sx, vx), Math.max(sx, vx), obstacles, 2)) {
            if (y >= lo - 4 && y <= hi + 4) inSpan.push(y);
            else if (y >= lo - slack && y <= hi + slack) near.push(y);
        }
        inSpan.sort((a, b) => Math.abs(a - y1) - Math.abs(b - y1));
        near.sort((a, b) => Math.abs(a - y1) - Math.abs(b - y1));
        const out = [];
        for (const y of inSpan.concat(near)) {
            out.push([[x0, y0], [sx, y0], [sx, y], [vx, y], [vx, y1], [x1, y1]]);
        }
        return out;
    }

    /**
     * Orthogonal path from (x0,y0) to dest-left (x1,y1). Near edges stay on
     * the dest-gutter bus. Far edges drop in `srcBus` so the long run is at
     * dest Y (or a clear row gap when dest Y is blocked).
     */
    function _routeAround(x0, y0, x1, y1, busX, obstacles, inset, srcBus) {
        const vx = busX;
        const hasSrc = srcBus != null && Number.isFinite(Number(srcBus));
        const sx = hasSrc ? Number(srcBus) : x0 + (vx >= x0 ? inset : -inset);
        const attempts = [];
        if (vx !== x0) attempts.push([[x0, y0], [vx, y0], [vx, y1], [x1, y1]]);
        attempts.push([[x0, y0], [sx, y0], [sx, y1], [vx, y1], [x1, y1]]);
        for (const pts of _gapAttempts(x0, y0, x1, y1, sx, vx, obstacles)) {
            attempts.push(pts);
        }
        let best = null;
        let bestCost = Infinity;
        for (const pts of attempts) {
            if (_polyHits(pts, obstacles)) continue;
            const c = _routeCost(pts, y0, y1);
            if (c < bestCost) {
                bestCost = c;
                best = pts;
            }
        }
        if (best) return best;
        const fallback = [[x0, y0], [x0, y1], [x1, y1]];
        return _polyHits(fallback, obstacles) ? (attempts[0] || fallback) : fallback;
    }

    function _yOverlap(a0, a1, b0, b1) {
        return Math.min(a0, a1) < Math.max(b0, b1) && Math.max(a0, a1) > Math.min(b0, b1);
    }

    function _gutterBounds(from, to, nodes) {
        const maxX = to.x - 2;
        let left = from.x + from.w;
        for (const n of nodes || []) {
            if (!n || n.id === to.id || n.id === from.id) continue;
            const r = n.x + n.w;
            if (r < to.x && r > left) left = r;
        }
        const minX = Math.min(maxX, left + 2);
        return { minX, maxX };
    }

    /** Gap just to the right of `from`'s column, used as a local vertical bus. */
    function _sourceGutterBounds(from, to, nodes) {
        const minX = (from.x + from.w) + 2;
        let maxX = to.x - 2;
        for (const n of nodes || []) {
            if (!n || n.id === from.id || n.id === to.id) continue;
            if (n.x <= from.x + from.w) continue;
            if (n.x >= to.x) continue;
            maxX = Math.min(maxX, n.x - 2);
        }
        if (minX > maxX) return { minX: Math.min(minX, to.x - 4), maxX: to.x - 2 };
        return { minX, maxX };
    }

    function _pickLaneX(job, placed, laneGap, obstacles) {
        const y0 = job.y0;
        const y1 = job.y1;
        if (Math.abs(y1 - y0) < 1) return job.preferredX;
        const hitsLane = (x) => placed.some((p) => (
            p.fromId !== job.fromId
            && Math.abs(p.x - x) < laneGap
            && _yOverlap(y0, y1, p.y0, p.y1)
        ));
        const hitsNode = (x) => (obstacles || []).some((n) => (
            n
            && n.id !== job.fromId
            && n.id !== job.toId
            && x >= n.x && x <= n.x + n.w
            && Math.max(y0, y1) >= n.y && Math.min(y0, y1) <= n.y + n.h
        ));
        const ok = (x) => x >= job.minX && x <= job.maxX && !hitsLane(x) && !hitsNode(x);
        if (ok(job.preferredX)) return job.preferredX;
        for (let k = 1; k <= 48; k++) {
            const left = job.preferredX - k * laneGap;
            const right = job.preferredX + k * laneGap;
            if (ok(left)) return left;
            if (ok(right)) return right;
        }
        return Math.min(job.maxX, Math.max(job.minX, job.preferredX));
    }

    /**
     * Orthogonal prereq path that always enters `to` on the left.
     * Prefers a vertical bus just left of the dest so elbows don't cut through
     * a box sitting between source and dest (Rituals → Afterlife vs Burial).
     */
    function edgePath(from, to, opts = {}) {
        if (!from || !to) return [];
        const inset = Math.max(4, Number(opts.inset) || 20);
        const stroke = opts.stroke;
        const y0 = from.y + from.h * 0.5;
        const y1 = opts.attachY != null ? Number(opts.attachY) : (to.y + to.h * 0.5);
        const x0 = nodeRightX(from, y0, { stroke });
        const x1 = nodeLeftX(to, y1, { stroke });
        const obstacles = (opts.obstacles || []).filter((n) => n && n !== from && n !== to
            && n.id !== from.id && n.id !== to.id);
        const busX = opts.busX != null ? Number(opts.busX) : _clearBusX(to, y0, y1, obstacles, inset);
        let srcBus = opts.srcBus;
        if (srcBus == null && _isFarEdge(from, to, inset)) {
            const g = _sourceGutterBounds(from, to, opts.obstacles || []);
            srcBus = Math.min(g.maxX, Math.max(g.minX, from.x + from.w + Math.min(inset, 12)));
        }
        return _routeAround(x0, y0, x1, y1, busX, obstacles, inset, srcBus);
    }

    /**
     * Paths for every prereq edge. Children of the same parent share one vertical
     * bus; overlapping runs from different parents are offset. Edges that skip a
     * column drop in the source gutter so the long run is at dest Y, which
     * avoids riding the source row across the rest of the tree.
     */
    function layoutEdgePaths(layout, opts = {}) {
        const nodes = layout?.nodes || [];
        const byId = layout?.byId || {};
        const edges = layout?.edges || [];
        const inset = Math.max(4, Number(opts.inset) || 20);
        const laneGap = Math.max(3, Number(opts.laneGap) || 6);
        const stroke = opts.stroke;
        const incoming = new Map();
        for (const e of edges) {
            if (!incoming.has(e.to)) incoming.set(e.to, []);
            incoming.get(e.to).push(e);
        }
        for (const list of incoming.values()) {
            list.sort((e1, e2) => {
                const a = byId[e1.from];
                const b = byId[e2.from];
                return ((a?.y || 0) - (b?.y || 0)) || String(e1.from).localeCompare(e2.from);
            });
        }
        const jobs = [];
        for (const e of edges) {
            const from = byId[e.from];
            const to = byId[e.to];
            if (!from || !to) continue;
            const group = incoming.get(e.to) || [e];
            const idx = Math.max(0, group.indexOf(e));
            const attachY = to.y + to.h * (idx + 1) / (group.length + 1);
            const y0 = from.y + from.h * 0.5;
            const y1 = attachY;
            const x0 = nodeRightX(from, y0, { stroke });
            const x1 = nodeLeftX(to, y1, { stroke });
            const obstacles = nodes.filter((n) => n && n.id !== from.id && n.id !== to.id);
            const destBus = _clearBusX(to, y0, y1, obstacles, inset);
            const far = _isFarEdge(from, to, inset);
            const destGutter = _gutterBounds(from, to, nodes);
            let minX = destGutter.minX;
            let maxX = destGutter.maxX;
            if (minX > maxX) {
                minX = Math.min(destBus, to.x - 4);
                maxX = Math.max(destBus, to.x - 4);
            }
            const srcGutter = far ? _sourceGutterBounds(from, to, nodes) : null;
            jobs.push({
                fromId: from.id,
                toId: to.id,
                destX: to.x,
                x0, y0, x1, y1,
                preferredX: destBus,
                minX,
                maxX,
                far,
                srcPreferredX: srcGutter
                    ? Math.min(srcGutter.maxX, Math.max(srcGutter.minX, from.x + from.w + Math.min(inset, 12)))
                    : null,
                srcMinX: srcGutter ? srcGutter.minX : null,
                srcMaxX: srcGutter ? srcGutter.maxX : null,
                obstacles
            });
        }
        const groups = new Map();
        for (const job of jobs) {
            const key = `${job.fromId}:${job.destX}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(job);
        }
        const placed = [];
        const busOf = new Map();
        const srcBusOf = new Map();
        const placeGroup = (group, preferredKey, minKey, maxKey, store, padFarDest) => {
            let y0 = Math.min(...group.map((j) => Math.min(j.y0, j.y1)));
            let y1 = Math.max(...group.map((j) => Math.max(j.y0, j.y1)));
            if (padFarDest && group.some((j) => j.far)) {
                const pad = Math.max(80, y1 - y0);
                y0 -= pad;
                y1 += pad;
            }
            const proto = {
                fromId: group[0].fromId,
                toId: group[0].toId,
                preferredX: group[0][preferredKey],
                minX: Math.max(...group.map((j) => j[minKey])),
                maxX: Math.min(...group.map((j) => j[maxKey])),
                y0,
                y1
            };
            if (proto.minX > proto.maxX) {
                proto.minX = group[0][minKey];
                proto.maxX = group[0][maxKey];
            }
            const busX = _pickLaneX(proto, placed, laneGap, nodes);
            if (Math.abs(y1 - y0) >= 1) {
                placed.push({ x: busX, y0, y1, fromId: proto.fromId });
            }
            for (const job of group) store.set(job, busX);
        };
        for (const group of groups.values()) {
            placeGroup(group, "preferredX", "minX", "maxX", busOf, true);
        }
        const srcGroups = new Map();
        for (const job of jobs) {
            if (!job.far) continue;
            if (!srcGroups.has(job.fromId)) srcGroups.set(job.fromId, []);
            srcGroups.get(job.fromId).push(job);
        }
        for (const group of srcGroups.values()) {
            placeGroup(group, "srcPreferredX", "srcMinX", "srcMaxX", srcBusOf, false);
        }
        const out = [];
        for (const job of jobs) {
            const busX = busOf.get(job);
            out.push({
                from: job.fromId,
                to: job.toId,
                path: _routeAround(
                    job.x0, job.y0, job.x1, job.y1,
                    busX, job.obstacles, inset,
                    srcBusOf.get(job)
                )
            });
        }
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
        edgePath,
        layoutEdgePaths,
        minuteDelta
    };
});
