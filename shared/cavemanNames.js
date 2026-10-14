/**
 * Syllabic caveman names (Og, Brak, Ulla, Grokka, Taro). Max 24 chars.
 * Shared by the browser client and the Node sim.
 *
 * Chunks are written to be pronounceable, then glued into a short name,
 * a begin+end name, or a begin+middle+end name. Callers can pass names
 * already in use so a nearby person is not given the same one.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.CavemanNames = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const SHORTS = [
        "Og", "Uk", "Ak", "Ek", "Mog", "Tuk", "Rek", "Nak", "Kog", "Rog",
        "Brak", "Grok", "Krak", "Drek", "Vog", "Zuk", "Wog", "Thok", "Nok", "Muk",
        "Ulla", "Taro", "Kora", "Brek", "Gruk", "Rok", "Lok", "Tok", "Vek", "Zog"
    ];
    const BEGINS = [
        "Bra", "Bre", "Bro", "Gro", "Gra", "Gre", "Kra", "Kre", "Kro",
        "Ula", "Ulo", "Ta", "Te", "Ka", "Ke", "Ko", "Mu", "Na", "Ne", "No",
        "Re", "Ra", "Ro", "Tho", "Thu", "Vu", "Va", "Zo", "Za", "Wi", "Du", "Bo", "Bu"
    ];
    // Consonant middles only sit in front of a vowel ending (Grokka, Braka).
    const CONS_MIDDLES = ["k", "r", "n", "l", "kk", "rr"];
    const VOWEL_ENDS = ["a", "o"];
    // Syllable middles end in a vowel, so the ending starts with a consonant.
    const SYL_MIDDLES = ["lo", "ra", "na", "ro", "la", "to"];
    const CONS_ENDS = ["k", "g", "n", "r", "t", "na", "ra", "ko", "la", "ta", "ro", "ka"];
    const TRIES = 20;

    function roll(rng) {
        return typeof rng === "function" ? rng() : Math.random();
    }

    function pick(rng, list) {
        return list[Math.floor(roll(rng) * list.length) % list.length];
    }

    function cap(s) {
        if (!s) return "Og";
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }

    function pronounceable(raw) {
        if (!raw || raw.length < 2 || raw.length > 12) return false;
        if (/([aeiou])\1/i.test(raw)) return false;
        if (/([bcdfghjklmnpqrstvwxyz])\1\1/i.test(raw)) return false;
        return true;
    }

    function rollOnce(rng) {
        for (let i = 0; i < 12; i++) {
            const shape = roll(rng);
            let raw;
            if (shape < 0.25) raw = pick(rng, SHORTS);
            else if (shape < 0.70) raw = pick(rng, BEGINS) + pick(rng, CONS_ENDS);
            else if (roll(rng) < 0.5) raw = pick(rng, BEGINS) + pick(rng, CONS_MIDDLES) + pick(rng, VOWEL_ENDS);
            else raw = pick(rng, BEGINS) + pick(rng, SYL_MIDDLES) + pick(rng, CONS_ENDS);
            raw = String(raw || "").replace(/[^a-zA-Z]/g, "");
            if (pronounceable(raw)) return cap(raw).slice(0, 24);
        }
        return cap(pick(rng, SHORTS));
    }

    function avoidSet(avoid) {
        const set = new Set();
        if (!avoid) return set;
        const list = typeof avoid === "string" ? [avoid] : avoid;
        for (const name of list) {
            const key = String(name || "").trim().toLowerCase();
            if (key) set.add(key);
        }
        return set;
    }

    /**
     * @param {function(): number} [rng]
     * @param {{ avoid?: Iterable<string> }} [opts]
     */
    function generate(rng, opts) {
        const taken = avoidSet(opts && opts.avoid);
        let last = "Og";
        const tries = taken.size ? TRIES : 1;
        for (let i = 0; i < tries; i++) {
            last = rollOnce(rng);
            if (!taken.has(last.toLowerCase())) return last;
        }
        return last;
    }

    return { generate };
});
