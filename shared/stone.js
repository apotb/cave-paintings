/**
 * Rock stats for knapped tools and stone spears.
 * Hardness is Mohs. Toughness is a 0–1 rating (tooltip shows a percent).
 * Pebble stacks carry a stone id. A missing stone is andesite.
 * Flint still reads its item def so a data change updates flint tools.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Stone = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const DEFAULTS = {
        pebble: { hardness: 5, toughness: 0.4, tipColor: "#717171", name: "Pebble" },
        flint: { hardness: 7, toughness: 0.6, tipColor: "#333333", name: "Flint" }
    };
    /** Shared sprite grays. Lighter is primary, darker is the shade. */
    const SOURCE_PRIMARY = [0x71, 0x71, 0x71];
    const SOURCE_SECONDARY = [0x4d, 0x4d, 0x4d];
    const DEFAULT_STONE = "andesite";
    /** Preferred stone owns this much of the noise range. The rest is smaller patches. */
    const WIDE_BAND = 0.62;
    const TYPES = {
        limestone: { name: "Limestone", hardness: 3, toughness: 0.25, primary: "#D8CFB2", secondary: "#A09478" },
        sandstone: { name: "Sandstone", hardness: 4, toughness: 0.35, primary: "#C9A36A", secondary: "#8C6838" },
        andesite: { name: "Andesite", hardness: 5, toughness: 0.4, primary: "#717171", secondary: "#4d4d4d" },
        granite: { name: "Granite", hardness: 6.5, toughness: 0.45, primary: "#C4A99A", secondary: "#8A6A62" },
        diorite: { name: "Diorite", hardness: 6, toughness: 0.55, primary: "#E6E2DC", secondary: "#8E8A84" }
    };
    const TYPE_ORDER = ["limestone", "sandstone", "andesite", "diorite", "granite"];
    /** Stuffable ids that can be flint. Pebbles, grindstones, painting circles, and rocks stay world stones. */
    const FLINT_STUFF = { stone_spear: true };
    const CLASS_DAMAGE = {
        knife: 7,
        scraper: 4,
        chopper: 9,
        awl: 3,
        spear_tip: 0,
        blank: 2,
        hand_axe: 12,
        cleaver: 9
    };
    const CLASS_NAME = {
        knife: "Knife",
        scraper: "Scraper",
        chopper: "Chopper",
        awl: "Awl",
        spear_tip: "Spear Tip",
        blank: "Flake",
        hand_axe: "Hand-axe",
        cleaver: "Cleaver"
    };
    const QUALITY_NAME = { crude: "Crude", rough: "Rough", fine: "Fine" };
    const QUALITY_MULT = { crude: 0.65, rough: 0.95, fine: 1.35 };
    const KNAP_CLASSES = {
        knife: true,
        scraper: true,
        chopper: true,
        awl: true,
        spear_tip: true,
        blank: true,
        hand_axe: true,
        cleaver: true
    };
    const HAND_AXE_HARDNESS = 6;
    const HAND_AXE_TOUGHNESS = 0.5;
    const TOOL_DURABILITY = 150;
    const SPEAR_DURABILITY = 120;
    const PEBBLE_TOUGHNESS = 0.4;

    function liveItem(id) {
        if (!id) return null;
        try {
            let ds = (typeof DataStore !== "undefined" && DataStore.getItem) ? DataStore : null;
            if (!ds && typeof module === "object" && module.exports) {
                ds = require("./DataStore");
            }
            if (!ds?.isReady?.() || typeof ds.getItem !== "function") return null;
            return ds.getItem(id) || null;
        } catch (_) {
            return null;
        }
    }

    function materialId(stack, fallback) {
        const m = stack?.knapMaterial;
        if (m === "flint" || m === "pebble") return m;
        const id = stack?.id;
        if (id === "flint" || id === "flint_tool" || id === "flint_spear") return "flint";
        if (id === "pebble" || id === "stone_tool" || id === "stone_spear") return fallback || "pebble";
        return fallback || null;
    }

    function isFlintStack(stack) {
        if (!stack) return false;
        if (stack.knapMaterial === "flint") return true;
        const id = stack.id;
        return id === "flint" || id === "flint_tool" || id === "flint_spear";
    }

    function normalizeStone(id) {
        if (TYPES[id]) return id;
        if (id === "pebble") return DEFAULT_STONE;
        return null;
    }

    function tokenId(raw) {
        return String(raw || "").trim().toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
    }

    /** A stone id or display name from a chat command. "pebble" and "flint" are not world stones. */
    function fromToken(raw) {
        const id = tokenId(raw);
        if (TYPES[id]) return id;
        const name = id.replace(/_/g, " ");
        for (const key of TYPE_ORDER) {
            if (TYPES[key].name.toLowerCase() === name) return key;
        }
        return null;
    }

    /**
     * Stone type for a stuff token. Flint counts only when this id can be flint.
     * @returns {string|null}
     */
    function stuffId(ownerId, raw) {
        const stone = fromToken(raw);
        if (stone) return stone;
        if (FLINT_STUFF[ownerId] && tokenId(raw) === "flint") return "flint";
        return null;
    }

    /** Items that keep a stone (or flint, for a spear). Pebbles are the raw stuff. */
    function isStuffableItem(id) {
        return id === "pebble" || id === "grindstone" || id === "painting_circle"
            || id === "stone_spear" || id === "flint_spear";
    }

    /** Stacks split by stone. A blank field is andesite. Spears do not. */
    function splitsByStone(id) {
        return id === "pebble" || id === "grindstone" || id === "painting_circle";
    }

    /** A crafted item copies its stuff from an ingredient. Raw pebbles do not. */
    function craftTakesStuff(id) {
        return id === "flint_spear" || (isStuffableItem(id) && id !== "pebble");
    }

    /** Knapped pieces and stone items are what a stuffed craft copies from. */
    function ingredientSuppliesStuff(ing) {
        if (!ing || ing.hideStage) return false;
        if (ing.toolClass) return true;
        return isStuffableItem(ing.id);
    }

    function stackMatchesIngredient(stack, ing) {
        if (!stack || !ing || !(Number(stack.quantity) > 0)) return false;
        if (stack.id !== ing.id) return false;
        if (ing.toolClass && stack.toolClass !== ing.toolClass) return false;
        return true;
    }

    /**
     * Stack a stuffed craft copies from. Bags are hotbar, then pack, then an open basket.
     * The leftmost stack of the first stuff ingredient wins. No such stack means no stuff yet.
     */
    function firstStuffStack(recipe, bags) {
        if (!craftTakesStuff(recipe?.id)) return null;
        for (const ing of recipe.ingredients || []) {
            if (!ingredientSuppliesStuff(ing)) continue;
            for (const bag of bags || []) {
                if (!Array.isArray(bag)) continue;
                for (const stack of bag) {
                    if (stackMatchesIngredient(stack, ing)) return stack;
                }
            }
            return null;
        }
        return null;
    }

    /**
     * Preview stack for a stuffed recipe. Null keeps the plain item name
     * (Stone Spear, Grindstone) and the andesite icon.
     */
    function craftPreviewStack(recipe, bags) {
        const id = recipe?.id;
        if (!craftTakesStuff(id)) return null;
        const src = firstStuffStack(recipe, bags);
        if (!src) return null;
        if (id === "stone_spear" || id === "flint_spear") {
            const mat = src.knapMaterial;
            if (mat !== "flint" && mat !== "pebble") return null;
            const stack = { id, knapMaterial: mat };
            if (src.stone) stack.stone = src.stone;
            if (src.knapQuality) stack.knapQuality = src.knapQuality;
            return stack;
        }
        const stone = normalizeStone(src.stone) || stoneOf(src) || DEFAULT_STONE;
        return { id, stone };
    }

    /** Andesite when a pebble, grindstone, or pebble tool has a blank field. Null for flint. */
    function stoneOf(stack) {
        if (!stack || isFlintStack(stack)) return null;
        const named = normalizeStone(stack.stone);
        if (named) return named;
        const id = stack.id;
        if (id === "pebble" || id === "grindstone" || id === "painting_circle"
            || id === "stone_tool" || id === "stone_spear" || stack.knapMaterial === "pebble") {
            return DEFAULT_STONE;
        }
        return null;
    }

    /** Missing and andesite are the same pile. Other items always match. */
    function sameStone(a, b) {
        const typed = (s) => splitsByStone(s?.id);
        if (!typed(a) && !typed(b)) return true;
        return (stoneOf(a) || DEFAULT_STONE) === (stoneOf(b) || DEFAULT_STONE);
    }

    function stoneKey(stack) {
        return normalizeStone(stack?.stone) || DEFAULT_STONE;
    }

    function typeProps(id) {
        const t = TYPES[id] || TYPES[DEFAULT_STONE];
        return {
            id: TYPES[id] ? id : DEFAULT_STONE,
            name: t.name,
            hardness: t.hardness,
            toughness: t.toughness,
            tipColor: t.primary,
            primary: t.primary,
            secondary: t.secondary
        };
    }

    function props(material, getItem) {
        const stone = normalizeStone(material);
        if (stone) return typeProps(stone);
        const id = material === "flint" ? "flint" : "pebble";
        if (id === "pebble") return typeProps(DEFAULT_STONE);
        const d = DEFAULTS.flint;
        let def = null;
        if (typeof getItem === "function") {
            try { def = getItem(id) || null; } catch (_) { def = null; }
        }
        if (!def) def = liveItem(id);
        const k = def?.knapping || {};
        const hardness = Number(k.hardness);
        const toughness = Number(k.toughness);
        return {
            id,
            name: def?.name || d.name,
            hardness: Number.isFinite(hardness) && hardness > 0 ? hardness : d.hardness,
            toughness: Number.isFinite(toughness) && toughness > 0 ? toughness : d.toughness,
            tipColor: (typeof k.tipColor === "string" && k.tipColor) ? k.tipColor : d.tipColor,
            primary: (typeof k.tipColor === "string" && k.tipColor) ? k.tipColor : d.tipColor,
            secondary: d.tipColor
        };
    }

    function propsOf(stack, getItem) {
        if (isFlintStack(stack)) return props("flint", getItem);
        const stone = stoneOf(stack);
        if (stone) return props(stone, getItem);
        return props(materialId(stack, "pebble"), getItem);
    }

    function parseHex(hex) {
        const h = String(hex || "").replace("#", "");
        if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
        return [
            parseInt(h.slice(0, 2), 16),
            parseInt(h.slice(2, 4), 16),
            parseInt(h.slice(4, 6), 16)
        ];
    }

    /** Map the two template grays onto a stone. Transparent pixels stay put. */
    function recolorImageData(data, stoneId) {
        if (!data) return data;
        const t = typeProps(normalizeStone(stoneId) || DEFAULT_STONE);
        const primary = parseHex(t.primary);
        const secondary = parseHex(t.secondary);
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) continue;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const dp = (r - SOURCE_PRIMARY[0]) ** 2
                + (g - SOURCE_PRIMARY[1]) ** 2
                + (b - SOURCE_PRIMARY[2]) ** 2;
            const ds = (r - SOURCE_SECONDARY[0]) ** 2
                + (g - SOURCE_SECONDARY[1]) ** 2
                + (b - SOURCE_SECONDARY[2]) ** 2;
            const c = dp <= ds ? primary : secondary;
            data[i] = c[0];
            data[i + 1] = c[1];
            data[i + 2] = c[2];
        }
        return data;
    }

    /**
     * Black in these 1-bit sprites is transparent, including the dark pixels
     * inside the silhouette. Fill those enclosed gaps with the secondary color.
     * Transparency that touches the sprite edge stays clear.
     */
    function fillEnclosedTransparent(data, width, height, stoneId) {
        const w = width | 0;
        const h = height | 0;
        if (!data || w < 1 || h < 1 || data.length < w * h * 4) return data;
        const secondary = parseHex(typeProps(normalizeStone(stoneId) || DEFAULT_STONE).secondary);
        const n = w * h;
        const outside = new Uint8Array(n);
        const stack = [];
        const empty = (p) => data[p * 4 + 3] === 0;
        for (let x = 0; x < w; x++) {
            stack.push(x, (h - 1) * w + x);
        }
        for (let y = 0; y < h; y++) {
            stack.push(y * w, y * w + (w - 1));
        }
        while (stack.length) {
            const p = stack.pop();
            if (p < 0 || p >= n || outside[p] || !empty(p)) continue;
            outside[p] = 1;
            const x = p % w;
            if (x > 0) stack.push(p - 1);
            if (x + 1 < w) stack.push(p + 1);
            if (p >= w) stack.push(p - w);
            if (p + w < n) stack.push(p + w);
        }
        for (let p = 0; p < n; p++) {
            if (!empty(p) || outside[p]) continue;
            const o = p * 4;
            data[o] = secondary[0];
            data[o + 1] = secondary[1];
            data[o + 2] = secondary[2];
            data[o + 3] = 255;
        }
        return data;
    }

    /**
     * Opaque pixels in mask are shade marks (rock_2 / pebble_2). Paint them
     * with the secondary color on top of a body that was already recolored.
     */
    function stampSecondary(dest, mask, stoneId) {
        if (!dest || !mask) return dest;
        const secondary = parseHex(typeProps(normalizeStone(stoneId) || DEFAULT_STONE).secondary);
        const n = Math.min(dest.length, mask.length);
        for (let i = 0; i < n; i += 4) {
            if (mask[i + 3] === 0) continue;
            dest[i] = secondary[0];
            dest[i + 1] = secondary[1];
            dest[i + 2] = secondary[2];
            dest[i + 3] = 255;
        }
        return dest;
    }

    function preferenceWeights(elevation, temperature, tileKey) {
        const w = {
            limestone: 0.25,
            sandstone: 0.25,
            andesite: 1,
            diorite: 0.25,
            granite: 0.25
        };
        const key = tileKey || "";
        const elev = Number(elevation) || 0;
        const temp = Number(temperature) || 0;
        const hot = temp >= 0.25;
        const cold = temp < -0.25;
        const beach = key === "snow_beach" || key === "gravel"
            || (key === "sand" && !hot)
            || (elev < -0.19 && !hot);
        const dry = hot && (
            key === "sand" || key === "sand_hill" || key === "mesa" || elev >= -0.19
        );
        const snowy = cold && !beach;
        const peak = !hot && !cold && (
            key === "mountain" || (elev >= 0.25 && key !== "mesa" && key !== "snow_mountain")
        );
        const hill = key === "grass_hill" || (!hot && !cold && elev >= 0.15 && elev < 0.25);
        if (beach) w.limestone += 5;
        if (dry) w.sandstone += 5;
        if (snowy) w.diorite += 5;
        if (peak) w.granite += 5;
        if (hill) {
            w.andesite += 4;
            w.granite += 1.5;
        }
        if (!beach && !dry && !snowy && !peak) w.andesite += 3;
        return w;
    }

    /**
     * noise01 is 0–1 from the stone noise map. The heaviest weight owns the wide band.
     * @param {string} [tileKey]
     */
    function pickStone(elevation, temperature, noise01, tileKey) {
        const w = preferenceWeights(elevation, temperature, tileKey);
        let pref = DEFAULT_STONE;
        let best = -1;
        for (const id of TYPE_ORDER) {
            if (w[id] > best) {
                best = w[id];
                pref = id;
            }
        }
        const t = Math.min(0.999999, Math.max(0, Number(noise01) || 0));
        if (t < WIDE_BAND) return pref;
        const rest = TYPE_ORDER.filter((id) => id !== pref);
        let sum = 0;
        for (const id of rest) sum += w[id];
        let u = (t - WIDE_BAND) / (1 - WIDE_BAND);
        let acc = 0;
        for (const id of rest) {
            acc += (sum > 0 ? w[id] / sum : 1 / rest.length);
            if (u <= acc) return id;
        }
        return rest[rest.length - 1];
    }

    function rockLabel(entry) {
        const id = normalizeStone(entry?.stone) || DEFAULT_STONE;
        return `${TYPES[id].name} Rock`;
    }

    function hardnessFactor(hardness) {
        const h = Number(hardness);
        return (Number.isFinite(h) && h > 0 ? h : DEFAULTS.pebble.hardness) / 5;
    }

    function toughnessFactor(toughness) {
        const t = Number(toughness);
        const pct = Math.round((Number.isFinite(t) && t > 0 ? t : PEBBLE_TOUGHNESS) * 100);
        const base = Math.round(PEBBLE_TOUGHNESS * 100);
        return pct / base;
    }

    function qualityMult(quality) {
        return QUALITY_MULT[quality] || 1;
    }

    const TECHNIQUE_GATES = {
        hand_axe: [
            { stat: "hardness", min: HAND_AXE_HARDNESS, label: "Hardness" },
            { stat: "toughness", min: HAND_AXE_TOUGHNESS, label: "Toughness" }
        ],
        cleaver: [
            { stat: "hardness", min: HAND_AXE_HARDNESS, label: "Hardness" },
            { stat: "toughness", min: HAND_AXE_TOUGHNESS, label: "Toughness" }
        ]
    };

    function gateLabel(gate) {
        if (gate.stat === "toughness") {
            return `${gate.label} ≥ ${Math.round(gate.min * 100)}%`;
        }
        return `${gate.label} ≥ ${formatHardness(gate.min)}`;
    }

    /** Per-stat pass/fail for the knapping help marks. Empty when the shape has no gate. */
    function requirementStatus(toolClass, material, getItem) {
        const gates = TECHNIQUE_GATES[toolClass];
        if (!gates) return [];
        const p = props(material || "pebble", getItem);
        return gates.map((g) => {
            const value = g.stat === "toughness" ? p.toughness : p.hardness;
            return { stat: g.stat, min: g.min, met: value >= g.min, label: gateLabel(g) };
        });
    }

    /** "soft" | "brittle" | null. Hardness is checked first. */
    function handAxeGate(material, getItem) {
        const p = props(material, getItem);
        if (!(p.hardness >= HAND_AXE_HARDNESS)) return "soft";
        if (!(p.toughness >= HAND_AXE_TOUGHNESS)) return "brittle";
        return null;
    }

    function formatHardness(h) {
        if (Number.isInteger(h)) return String(h);
        return String(Math.round(h * 10) / 10);
    }

    function statLines(itemDef) {
        const k = itemDef?.knapping;
        if (!k) return [];
        const lines = [];
        const h = Number(k.hardness);
        const t = Number(k.toughness);
        if (Number.isFinite(h)) lines.push(`Hardness: ${formatHardness(h)}`);
        if (Number.isFinite(t)) lines.push(`Toughness: ${Math.round(t * 100)}%`);
        return lines;
    }

    function linesFromProps(p) {
        if (!p) return [];
        return [
            `Hardness: ${formatHardness(p.hardness)}`,
            `Toughness: ${Math.round(p.toughness * 100)}%`
        ];
    }

    /** Raw knapping stones only. Finished tools and grindstones keep stone stats out of the tooltip. */
    function statLinesFor(stack, itemDef) {
        if (stack?.toolClass || stack?.id === "stone_spear" || stack?.id === "flint_spear"
            || stack?.id === "grindstone" || stack?.id === "painting_circle") return [];
        if (stack?.id === "pebble" || normalizeStone(stack?.stone)) return linesFromProps(propsOf(stack));
        return statLines(itemDef);
    }

    function displayName(stack, getItem) {
        if (!stack) return null;
        if (stack.id === "pebble") {
            return `${propsOf(stack, getItem).name} Pebble`;
        }
        if (stack.id === "grindstone") {
            return `${propsOf(stack, getItem).name} Grindstone`;
        }
        if (stack.id === "painting_circle") {
            return `${propsOf(stack, getItem).name} Painting Circle`;
        }
        if (stack.id === "stone_spear" || stack.id === "flint_spear") {
            const m = stack.knapMaterial;
            if (m !== "flint" && m !== "pebble" && !normalizeStone(stack.stone)) return null;
            const matName = isFlintStack(stack)
                ? props("flint", getItem).name
                : propsOf(stack, getItem).name;
            return withQuality(`${matName} Spear`, stack.knapQuality);
        }
        const cls = CLASS_NAME[stack.toolClass];
        if (!cls) return null;
        const matName = propsOf(stack, getItem).name;
        // Flakes stay unnamed by quality. Spear tips and finished tools put it after the name.
        const quality = stack.toolClass === "blank" ? null : stack.knapQuality;
        return withQuality(`${matName} ${cls}`, quality);
    }

    /** "Andesite Chopper (fine)". Unknown bands stay off the name. */
    function withQuality(base, quality) {
        return QUALITY_NAME[quality] ? `${base} (${quality})` : base;
    }

    /** Class base × hardness/5 × quality. Null when this stack is not a knapped class. */
    function toolDamage(stack, getItem) {
        const base = CLASS_DAMAGE[stack?.toolClass];
        if (base == null) return null;
        if (!(base > 0)) return 0;
        const factor = hardnessFactor(propsOf(stack, getItem).hardness);
        return Math.round(base * factor * qualityMult(stack?.knapQuality) * 10) / 10;
    }

    /** Point stab: authored damage × hardness/5 × quality. Shaft attacks stay put. */
    function spearDamage(stack, itemDef) {
        if (stack?.id !== "stone_spear" && stack?.id !== "flint_spear") return null;
        let base = 11;
        const attacks = itemDef?.weapon?.attacks;
        if (Array.isArray(attacks)) {
            const stab = attacks.find((a) => a && a.id === "point_stab");
            if (stab && Number(stab.damage) > 0) base = Number(stab.damage);
        }
        const factor = hardnessFactor(propsOf(stack).hardness);
        return Math.round(base * factor * qualityMult(stack?.knapQuality) * 10) / 10;
    }

    function durationScale(material, getItem) {
        const p = props(material || "pebble", getItem);
        const h = p.hardness > 0 ? p.hardness : DEFAULTS.pebble.hardness;
        return 5 / h;
    }

    function isKnappedTool(stack) {
        return !!KNAP_CLASSES[stack?.toolClass];
    }

    function isStoneSpear(stack) {
        return stack?.id === "stone_spear" || stack?.id === "flint_spear";
    }

    /** Max uses before quality. Spear tips and flakes stay undurable. */
    function durabilityBase(stack) {
        if (!stack || stack.toolClass === "spear_tip" || stack.toolClass === "blank") return null;
        if (isKnappedTool(stack)) {
            return TOOL_DURABILITY * toughnessFactor(propsOf(stack).toughness);
        }
        if (isStoneSpear(stack)) {
            return SPEAR_DURABILITY * toughnessFactor(propsOf(stack).toughness);
        }
        return null;
    }

    return {
        DEFAULTS,
        TYPES,
        WIDE_BAND,
        CLASS_DAMAGE,
        HAND_AXE_HARDNESS,
        HAND_AXE_TOUGHNESS,
        materialId,
        normalizeStone,
        fromToken,
        stuffId,
        isStuffableItem,
        splitsByStone,
        craftTakesStuff,
        firstStuffStack,
        craftPreviewStack,
        stoneOf,
        stoneKey,
        sameStone,
        props,
        propsOf,
        recolorImageData,
        fillEnclosedTransparent,
        stampSecondary,
        pickStone,
        rockLabel,
        hardnessFactor,
        toughnessFactor,
        qualityMult,
        handAxeGate,
        requirementStatus,
        statLines,
        statLinesFor,
        displayName,
        toolDamage,
        spearDamage,
        durationScale,
        isKnappedTool,
        isStoneSpear,
        durabilityBase
    };
});
