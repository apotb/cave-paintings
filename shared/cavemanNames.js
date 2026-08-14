/**
 * Syllabic caveman names (Og, Brak, Ulla, Grokka, Taro). Max 24 chars.
 * Shared by the browser client and the Node sim.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.CavemanNames = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const ONSETS = [
        "", "B", "Br", "D", "G", "Gr", "K", "Kr", "M", "N", "R", "T", "Th", "U", "V", "W", "Z"
    ];
    const NUCLEI = ["a", "e", "i", "o", "u"];
    const CODAS = ["", "g", "k", "kk", "n", "nk", "r", "rk", "t"];
    const TAILS = ["", "a", "o", "ka", "ko", "la", "na", "ra", "ro", "ta"];

    function pick(rng, list) {
        const r = typeof rng === "function" ? rng() : Math.random();
        return list[Math.floor(r * list.length) % list.length];
    }

    function cap(s) {
        if (!s) return "Og";
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }

    /**
     * Mix of short (Og) and slightly longer (Grokka, Taro) names.
     * @param {function(): number} [rng]
     */
    function generate(rng) {
        const roll = typeof rng === "function" ? rng() : Math.random();
        let raw;
        if (roll < 0.32) {
            const onset = pick(rng, ["", "B", "G", "K", "M", "N", "R", "T", "U", "Og"]);
            if (onset === "Og") raw = "Og";
            else raw = onset + pick(rng, ["og", "uk", "ak", "um", "ek", "ib"]);
        } else if (roll < 0.78) {
            raw = pick(rng, ONSETS) + pick(rng, NUCLEI) + pick(rng, CODAS);
            if (raw.length < 3) raw += pick(rng, TAILS) || "o";
        } else {
            raw =
                pick(rng, ONSETS) +
                pick(rng, NUCLEI) +
                pick(rng, ["g", "k", "kk", "n", "r"]) +
                pick(rng, TAILS);
        }
        raw = String(raw || "Og").replace(/[^a-zA-Z]/g, "");
        if (raw.length < 2) raw = "Og";
        return cap(raw).slice(0, 24);
    }

    return { generate };
});
