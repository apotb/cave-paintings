/**
 * Item / pawn stats. Values are authored on item defs; most have no gameplay
 * effect yet beyond tooltips.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Stats = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const DEFS = {
        beauty: { key: "beauty", label: "Beauty", digits: 1 }
    };

    function valueOf(item, key, stack) {
        const fromStack = Number(stack?.[key]);
        if (Number.isFinite(fromStack) && fromStack !== 0) return fromStack;
        if (stack && key in (stack || {}) && Number.isFinite(fromStack)) return fromStack;
        const n = Number(item?.[key]);
        return Number.isFinite(n) ? n : 0;
    }

    function formatSigned(n, digits = 1) {
        const v = Number(n);
        if (!Number.isFinite(v)) return (0).toFixed(digits);
        const s = v.toFixed(digits);
        return v > 0 ? `+${s}` : s;
    }

    function tooltipLines(item, stack) {
        const lines = [];
        const beauty = valueOf(item, "beauty", stack);
        if (beauty !== 0) {
            lines.push(`${DEFS.beauty.label}: ${formatSigned(beauty, DEFS.beauty.digits)}`);
        }
        return lines;
    }

    return {
        DEFS,
        valueOf,
        formatSigned,
        tooltipLines
    };
});
