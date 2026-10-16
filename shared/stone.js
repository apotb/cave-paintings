/**
 * Rock stats for knapped tools and stone spears.
 * Hardness is Mohs. Toughness is a 0–1 rating (tooltip shows a percent).
 * Damage, chop, durability, and work speed are computed from the live item
 * def so a data change updates tools already in a save.
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
    const CLASS_DAMAGE = {
        knife: 7,
        scraper: 4,
        chopper: 9,
        awl: 3,
        spear_tip: 0,
        blank: 2,
        hand_axe: 12
    };
    const CLASS_NAME = {
        knife: "Knife",
        scraper: "Scraper",
        chopper: "Chopper",
        awl: "Awl",
        spear_tip: "Spear Tip",
        blank: "Flake",
        hand_axe: "Hand-axe"
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
        hand_axe: true
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

    function props(material, getItem) {
        const id = material === "flint" ? "flint" : "pebble";
        const d = DEFAULTS[id];
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
            tipColor: (typeof k.tipColor === "string" && k.tipColor) ? k.tipColor : d.tipColor
        };
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

    /** Raw knapping stones only. Finished tools keep the stats in the math, not the tooltip. */
    function statLinesFor(stack, itemDef) {
        if (stack?.toolClass || stack?.id === "stone_spear" || stack?.id === "flint_spear") return [];
        return statLines(itemDef);
    }

    function displayName(stack, getItem) {
        if (!stack) return null;
        if (stack.id === "stone_spear" || stack.id === "flint_spear") {
            return `${props(materialId(stack, "pebble"), getItem).name} Spear`;
        }
        const cls = CLASS_NAME[stack.toolClass];
        if (!cls) return null;
        const matName = props(materialId(stack, "pebble"), getItem).name;
        if (stack.toolClass === "spear_tip" || stack.toolClass === "blank") {
            return `${matName} ${cls}`;
        }
        const q = QUALITY_NAME[stack.knapQuality];
        return q ? `${q} ${matName} ${cls}` : `${matName} ${cls}`;
    }

    /** Class base × hardness/5 × quality. Null when this stack is not a knapped class. */
    function toolDamage(stack, getItem) {
        const base = CLASS_DAMAGE[stack?.toolClass];
        if (base == null) return null;
        if (!(base > 0)) return 0;
        const factor = hardnessFactor(props(materialId(stack, "pebble"), getItem).hardness);
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
        const factor = hardnessFactor(props(materialId(stack, "pebble")).hardness);
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
            return TOOL_DURABILITY * toughnessFactor(props(materialId(stack, "pebble")).toughness);
        }
        if (isStoneSpear(stack)) {
            return SPEAR_DURABILITY * toughnessFactor(props(materialId(stack, "pebble")).toughness);
        }
        return null;
    }

    return {
        DEFAULTS,
        CLASS_DAMAGE,
        HAND_AXE_HARDNESS,
        HAND_AXE_TOUGHNESS,
        materialId,
        props,
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
