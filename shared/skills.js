/**
 * Bios, skills, passions, backstories, and traits.
 * Node + browser UMD. Catalogs come from DataStore when loaded.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Skills = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const SKILL_IDS = [
        "melee", "shooting", "cooking", "plants",
        "animals", "crafting", "medical", "social", "intellectual"
    ];
    const SKILL_LABELS = {
        shooting: "Shooting",
        melee: "Melee",
        cooking: "Cooking",
        plants: "Plants",
        animals: "Animals",
        crafting: "Crafting",
        medical: "Medical",
        social: "Social",
        intellectual: "Intellectual"
    };
    const SKILL_BLURBS = {
        shooting: "Accuracy with ranged weapons",
        melee: "Chance to land or dodge a blow",
        cooking: "Quality and speed of meals",
        plants: "Gathering speed and efficiency",
        animals: "Catching speed and efficiency",
        crafting: "Crafting speed and quality",
        medical: "Tending speed and quality",
        social: "Diplomacy and negotiation",
        intellectual: "Painting, writing, and research speed"
    };
    const LEVEL_TITLES = [
        "Never heard of it", "Complete beginer", "Newbie", "Novice", "Apprentice",
        "Advanced apprentice", "Skilled Apprentice", "Practioner", "Advanced practioner", "Skilled practioner",
        "Journeyman", "Advanced journeyman", "Skilled journeyman", "Master journeyman", "Master",
        "Renowned master", "Master of masters", "Legendary master", "Legend of legends", "Greatest in the world",
        "Greatest of all time"
    ];
    const XP_NEXT = [
        1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
        12000, 14000, 16000, 18000, 20000, 22000, 24000, 26000, 28000, 30000, 32000
    ];
    const DECAY = {
        10: 30, 11: 60, 12: 120, 13: 180, 14: 300, 15: 540,
        16: 840, 17: 1200, 18: 1800, 19: 2400, 20: 3600
    };
    const HIT = [0.50, 0.53, 0.56, 0.59, 0.62, 0.65, 0.68, 0.71, 0.74, 0.77, 0.80, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.90];
    const DODGE = [0, 0, 0, 0, 0, 0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.26, 0.28, 0.30];
    const SHOOT = [0.89, 0.91, 0.93, 0.935, 0.94, 0.945, 0.95, 0.955, 0.96, 0.965, 0.97, 0.9725, 0.975, 0.9775, 0.98, 0.98167, 0.98333, 0.985, 0.98666, 0.98833, 0.99];
    const XP_MINUTE = 40;
    const XP_HIT = 80;
    const XP_CATCH = 80;
    const XP_TEND = 150;
    const XP_HARVEST = 40;
    const DAY_CAP = 4000;
    const JOB_SKILL = {
        doctor: "medical",
        cook: "cooking",
        chop: "plants",
        gather: "plants",
        fish: "animals",
        craft: "crafting",
        leather: "crafting",
        research: "intellectual"
    };

    function clamp(n, lo, hi) {
        return Math.max(lo, Math.min(hi, n));
    }

    function catalogs() {
        let ds = typeof DataStore !== "undefined" ? DataStore : null;
        if (!ds) {
            try { ds = require("./DataStore"); } catch (_) { ds = null; }
        }
        const store = ds && ds._store;
        return {
            backstories: store?.backstoriesList || [],
            traits: store?.traitsList || []
        };
    }

    function useCatalogs(extra) {
        if (extra && (extra.backstories || extra.traits)) return extra;
        return catalogs();
    }

    function byId(list) {
        const map = Object.create(null);
        for (const row of list || []) {
            if (row?.id) map[row.id] = row;
        }
        return map;
    }

    function defOf(list, id) {
        if (!id) return null;
        return byId(list)[id] || null;
    }

    function linear(level, base, bonus) {
        const lv = clamp(Math.floor(Number(level) || 0), 0, 20);
        return base + lv * bonus;
    }

    function passionMult(passion) {
        const p = Math.floor(Number(passion) || 0);
        if (p >= 2) return 1.5;
        if (p === 1) return 1;
        return 0.35;
    }

    function xpToNext(level) {
        const lv = clamp(Math.floor(Number(level) || 0), 0, 20);
        return XP_NEXT[lv];
    }

    /** Share of the 0–20 bar: the shown level, plus XP toward the next trained level. */
    function levelProgress(shownLevel, trainedLevel, xp) {
        const shown = clamp(Math.floor(Number(shownLevel) || 0), 0, 20);
        if (shown >= 20) return 1;
        const trained = clamp(Math.floor(Number(trainedLevel) || 0), 0, 19);
        const need = xpToNext(trained);
        const into = need > 0 ? clamp((Number(xp) || 0) / need, 0, 1) : 0;
        return clamp((shown + into) / 20, 0, 1);
    }

    function emptySkills() {
        const skills = {};
        for (const id of SKILL_IDS) skills[id] = { level: 0, xp: 0, passion: 0 };
        return skills;
    }

    function clone(bio) {
        try {
            return JSON.parse(JSON.stringify(bio));
        } catch (_) {
            return null;
        }
    }

    function activeDefs(bio, cat) {
        const c = useCatalogs(cat);
        const rows = [];
        const child = defOf(c.backstories, bio?.childhood);
        const adult = defOf(c.backstories, bio?.adulthood);
        if (child) rows.push(child);
        if (adult) rows.push(adult);
        const traits = byId(c.traits);
        for (const id of bio?.traits || []) {
            if (traits[id]) rows.push(traits[id]);
        }
        return rows;
    }

    function offsetOf(bio, skillId, cat) {
        let n = 0;
        for (const row of activeDefs(bio, cat)) {
            const v = row.skills && row.skills[skillId];
            if (Number.isFinite(Number(v))) n += Number(v);
        }
        return n;
    }

    function incapable(bio, skillId, cat) {
        if (!bio || !SKILL_IDS.includes(skillId)) return false;
        for (const row of activeDefs(bio, cat)) {
            if (Array.isArray(row.disable) && row.disable.includes(skillId)) return true;
        }
        return false;
    }

    function effectiveLevel(bio, skillId, cat) {
        if (incapable(bio, skillId, cat)) return null;
        const trained = Math.floor(Number(bio?.skills?.[skillId]?.level) || 0);
        return clamp(trained + offsetOf(bio, skillId, cat), 0, 20);
    }

    function learningFactor(bio, cat) {
        let n = 1;
        for (const row of activeDefs(bio, cat)) {
            if (Number.isFinite(Number(row.learning))) n += Number(row.learning);
        }
        return Math.max(0, n);
    }

    function labelOf(skillId) {
        return SKILL_LABELS[skillId] || skillId;
    }

    function genderLabel(gender) {
        return gender === "male" ? "Male" : "Female";
    }

    function titleOf(list, id) {
        const row = defOf(list, id);
        return row?.title || (id ? "Unknown" : "None");
    }

    function formatSigned(n) {
        const v = Number(n);
        const text = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
        return v > 0 ? `+${text}` : text;
    }

    function passionCount(row, skillId) {
        if (!row?.passions || !Object.prototype.hasOwnProperty.call(row.passions, skillId)) return 0;
        const v = Number(row.passions[skillId]);
        if (!Number.isFinite(v) || v === 0) return 0;
        return clamp(Math.floor(v), 0, 2);
    }

    /** One or two star marks, then the skill name. `{s}` is drawn as a gold star. */
    function passionLine(skillId, count) {
        const n = clamp(Math.floor(Number(count) || 0), 1, 2);
        const stars = Array.from({ length: n }, () => "{s}*{/s}").join(" ");
        return `${stars} ${labelOf(skillId)}`;
    }

    /** Skill offsets, then passions, then learning and disables a trait shows. */
    function effectLines(row) {
        if (!row) return [];
        const lines = [];
        const passions = [];
        for (const id of SKILL_IDS) {
            const v = row.skills && row.skills[id];
            if (Number.isFinite(Number(v)) && Number(v) !== 0) {
                lines.push(`${labelOf(id)} ${formatSigned(v)}`);
            }
            const passion = passionCount(row, id);
            if (passion) passions.push(passionLine(id, passion));
        }
        lines.push(...passions);
        if (Number.isFinite(Number(row.learning)) && Number(row.learning) !== 0) {
            lines.push(`Learning rate ${formatSigned(Math.round(Number(row.learning) * 100))}%`);
        }
        for (const id of row.disable || []) lines.push(`Incapable of ${labelOf(id)}`);
        return lines;
    }

    function levelTitle(level) {
        const lv = clamp(Math.floor(Number(level) || 0), 0, 20);
        return LEVEL_TITLES[lv];
    }

    /**
     * "Progress to next learned level: xp / need".
     * A line longer than the tip width wraps before the last number so it stays in the box.
     */
    function progressTip(trained, xp) {
        const head = "Progress to next learned level:";
        if (trained >= 20) return `${head} ${markTip("g", "maxed")}`;
        const value = `${Math.round(Number(xp) || 0)} / ${xpToNext(trained)}`;
        if (`${head} ${value}`.length <= 42) return `${head} ${markTip("g", value)}`;
        const cut = value.lastIndexOf(" ");
        if (cut <= 0) return `${head} ${markTip("g", value)}`;
        return `${head} ${markTip("g", value.slice(0, cut))}\n${markTip("g", value.slice(cut + 1))}`;
    }

    function pctText(n) {
        const v = Math.round(Number(n) * 1000) / 10;
        return `${v}%`;
    }

    function markTip(kind, text) {
        return `{${kind}}${text}{/${kind}}`;
    }

    /** Titles of backstories and traits that change this skill, in bio order. */
    function skillOffsetLines(bio, skillId, cat) {
        const lines = [];
        for (const row of activeDefs(bio, cat)) {
            const v = row.skills && row.skills[skillId];
            if (!Number.isFinite(Number(v)) || Number(v) === 0) continue;
            lines.push(`- ${row.title || "Unknown"}: ${formatSigned(v)}`);
        }
        return lines;
    }

    /** Skill hover: name, blurb, level split into learned plus offsets, progress, and learning. */
    function skillTip(bio, skillId, cat) {
        const label = labelOf(skillId);
        const blurb = SKILL_BLURBS[skillId] || "";
        const lines = [markTip("g", label)];
        if (blurb) lines.push(markTip("m", blurb));
        lines.push("");
        const row = bio?.skills?.[skillId] || { level: 0, xp: 0, passion: 0 };
        const trained = clamp(Math.floor(Number(row.level) || 0), 0, 20);
        if (incapable(bio, skillId, cat)) {
            lines.push(markTip("g", "Incapable"));
            const cause = incapableTip(bio, skillId, cat);
            if (cause) lines.push(cause);
            lines.push("");
            lines.push(progressTip(trained, row.xp));
            return lines.join("\n");
        }
        const shown = effectiveLevel(bio, skillId, cat);
        lines.push(`Skill level: ${markTip("g", `${shown} - ${levelTitle(shown)}`)}`);
        const offsets = skillOffsetLines(bio, skillId, cat);
        if (offsets.length) {
            lines.push(markTip("m", `- Learned level: ${trained}`));
            for (const line of offsets) lines.push(markTip("m", line));
        }
        lines.push("");
        lines.push(progressTip(trained, row.xp));
        lines.push("");
        const interest = passionMult(passionOf(bio, skillId, cat));
        const base = learningFactor(bio, cat);
        lines.push(`Learning speed: ${markTip("g", pctText(interest * base))}`);
        lines.push(markTip("m", `- Base value: ${pctText(base)}`));
        lines.push(markTip("m", `- Passion: x${pctText(interest)}`));
        return lines.join("\n");
    }

    function blankLike(text) {
        return String(text || "").replace(/[^\n]/g, " ");
    }

    /** Pixel star. A smooth polygon at this size reads as a circle in the pixel font. */
    function tipStarSvg() {
        const rows = [
            ".......#.......",
            ".......#.......",
            "......###......",
            "......###......",
            "...#########...",
            "###############",
            ".#############.",
            "...#########...",
            "....#######....",
            "....#######....",
            "....#######....",
            "...#########...",
            "...###...###...",
            "...#.......#..."
        ];
        const rects = [];
        for (let y = 0; y < rows.length; y++) {
            for (let x = 0; x < rows[y].length; x++) {
                if (rows[y][x] === "#") rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
            }
        }
        return `<svg class="tip-star" viewBox="0 0 15 14" width="0.9375em" height="0.875em" aria-hidden="true" style="display:inline-block;vertical-align:middle;shape-rendering:crispEdges" fill="#e6c15a">${rects.join("")}</svg>`;
    }

    /** Split {m}, {g}, {o}, {c}, and {s} marks into aligned copies. `{s}` is a star. */
    function tipLayers(text) {
        const src = String(text || "");
        if (!/\{[mgcos]\}/.test(src)) return null;
        const re = /\{(m|g|c|o|s)\}([\s\S]*?)\{\/\1\}/g;
        let plain = "";
        let gold = "";
        let muted = "";
        let center = "";
        let orange = "";
        let stars = "";
        let last = 0;
        let match;
        const pushGap = (chunk) => {
            const gap = blankLike(chunk);
            plain += chunk;
            gold += gap;
            muted += gap;
            center += gap;
            orange += gap;
            stars += gap;
        };
        while ((match = re.exec(src))) {
            pushGap(src.slice(last, match.index));
            const body = match[2];
            const gap = blankLike(body);
            plain += body;
            gold += match[1] === "g" ? body : gap;
            muted += match[1] === "m" ? body : gap;
            center += match[1] === "c" ? body : gap;
            orange += match[1] === "o" ? body : gap;
            stars += match[1] === "s" ? body : gap;
            last = match.index + match[0].length;
        }
        pushGap(src.slice(last));
        return { plain, gold, muted, center, orange, stars };
    }

    function escapeTip(text) {
        return String(text || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    /** HTML for the menu hover, with the description gray and the values gold. */
    function tipHtml(text) {
        const src = String(text || "");
        if (!/\{[mgcos]\}/.test(src)) return null;
        const re = /\{(m|g|c|o|s)\}([\s\S]*?)\{\/\1\}/g;
        const colors = { g: "#e6c15a", m: "#a0a0a0", o: "#f0a040" };
        let html = "";
        let last = 0;
        let match;
        while ((match = re.exec(src))) {
            let chunk = src.slice(last, match.index);
            if (match[1] === "c") chunk = chunk.replace(/\n$/, "");
            html += escapeTip(chunk);
            if (match[1] === "c") {
                html += `<div style="text-align:center">${escapeTip(match[2])}</div>`;
            } else if (match[1] === "s") {
                const n = Math.max(1, [...match[2]].filter((ch) => ch !== " ").length);
                html += Array.from({ length: n }, tipStarSvg).join("");
            } else {
                html += `<span style="color:${colors[match[1]]}">${escapeTip(match[2])}</span>`;
            }
            last = match.index + match[0].length;
        }
        html += escapeTip(src.slice(last));
        return html;
    }

    function wrapWords(text, limit) {
        const words = String(text || "").trim().split(/\s+/).filter(Boolean);
        const lines = [];
        let line = "";
        for (const word of words) {
            if (!line) {
                line = word;
                continue;
            }
            if (line.length + 1 + word.length > limit) {
                lines.push(line);
                line = word;
            } else {
                line += ` ${word}`;
            }
        }
        if (line) lines.push(line);
        return lines.join("\n");
    }

    /** Story first, then each skill change as "Cooking: +6". */
    function backstoryTip(row, name) {
        if (!row) return "Unknown";
        const who = String(name || "").trim() || "They";
        const desc = wrapWords(
            String(row.desc || "").replace(/<name>/g, `\u0001${who}\u0002`),
            42
        ).replace(/\u0001([\s\S]*?)\u0002/g, (_, body) => markTip("o", body));
        const lines = [];
        const passions = [];
        for (const id of SKILL_IDS) {
            const v = row.skills && row.skills[id];
            if (Number.isFinite(Number(v)) && Number(v) !== 0) {
                lines.push(`${labelOf(id)}: ${formatSigned(v)}`);
            }
            const passion = passionCount(row, id);
            if (passion) passions.push(passionLine(id, passion));
        }
        lines.push(...passions);
        for (const id of row.disable || []) lines.push(`Incapable of ${labelOf(id)}`);
        if (desc && lines.length) return `${desc}\n\n${lines.join("\n")}`;
        return desc || lines.join("\n") || row.title || "Unknown";
    }

    function traitTip(row, name) {
        if (!row) return "Unknown";
        const who = String(name || "").trim();
        let desc = String(row.desc || "");
        if (who) desc = desc.replace(/<name>/g, who);
        desc = wrapWords(desc, 42);
        const effects = effectLines(row).map((line) => `  ${line}`);
        if (desc && effects.length) return `${desc}\n\n${effects.join("\n")}`;
        return desc || effects.join("\n") || row.title || "Unknown";
    }

    function causeLine(row) {
        const title = row?.title || "Unknown";
        if (row?.slot === "child") return `Childhood: ${title}`;
        if (row?.slot === "adult") return `Adulthood: ${title}`;
        return `Trait: ${title}`;
    }

    /** Backstories and traits that disable this skill. */
    function incapableTip(bio, skillId, cat) {
        const causes = activeDefs(bio, cat).filter(
            (row) => Array.isArray(row.disable) && row.disable.includes(skillId)
        );
        if (!causes.length) return "";
        return causes.map(causeLine).join("\n");
    }

    function researchSpeed(level) { return linear(level, 0.08, 0.115); }
    function plantWorkSpeed(level) { return linear(level, 0.08, 0.115); }
    function plantHarvestYield(level) { return linear(level, 0.6, 0.05); }
    function cookSpeed(level) { return linear(level, 0.4, 0.06); }
    function tendQualityFactor(level) { return linear(level, 0.2, 0.1); }
    function tendSpeed(level) { return linear(level, 0.4, 0.06); }
    function fishSpeed(level) { return linear(level, 0.75, 0.025); }

    function tableAt(table, level) {
        const lv = clamp(Math.floor(Number(level) || 0), 0, table.length - 1);
        return table[lv];
    }

    function meleeHitChance(level) { return tableAt(HIT, level); }
    function meleeDodgeChance(level) { return tableAt(DODGE, level); }
    function shootingAccuracy(level) { return tableAt(SHOOT, level); }

    function roll(rng) {
        const n = typeof rng === "function" ? Number(rng()) : Math.random();
        return Number.isFinite(n) ? n : Math.random();
    }

    function pick(rng, list) {
        if (!list.length) return null;
        return list[Math.floor(roll(rng) * list.length) % list.length];
    }

    function weighted(rng, list, weightOf) {
        let sum = 0;
        const rows = [];
        for (const row of list) {
            const w = Math.max(0, Number(weightOf(row)) || 0);
            if (!(w > 0)) continue;
            sum += w;
            rows.push({ row, w });
        }
        if (!rows.length) return null;
        let n = roll(rng) * sum;
        for (const entry of rows) {
            n -= entry.w;
            if (n <= 0) return entry.row;
        }
        return rows[rows.length - 1].row;
    }

    /** True when this trait is already chosen or conflicts with one of the others. */
    function traitConflicts(row, otherIds, traits) {
        if (!row?.id) return false;
        const have = new Set((otherIds || []).filter(Boolean));
        if (have.has(row.id)) return true;
        if ((row.conflicts || []).some((id) => have.has(id))) return true;
        const known = byId(traits);
        for (const id of have) {
            if ((known[id]?.conflicts || []).includes(row.id)) return true;
        }
        return false;
    }

    function conflictsWith(row, have, cat) {
        const traits = byId(useCatalogs(cat).traits);
        const ids = new Set(have);
        for (const id of row.conflicts || []) {
            if (ids.has(id)) return true;
        }
        for (const id of have) {
            const other = traits[id];
            if (other?.conflicts?.includes(row.id)) return true;
        }
        return false;
    }

    function disablesOverlap(row, bio, cat) {
        for (const skillId of row.disable || []) {
            if (incapable(bio, skillId, cat)) return true;
        }
        return false;
    }

    /** Rolled passion, then each current backstory and trait overwrites its own skills. */
    function passionOf(bio, skillId, cat) {
        const stored = bio?.skills?.[skillId];
        let passion = clamp(Math.floor(Number(stored?.passion) || 0), 0, 2);
        for (const row of activeDefs(bio, cat)) {
            if (!row?.passions || !Object.prototype.hasOwnProperty.call(row.passions, skillId)) continue;
            const v = Number(row.passions[skillId]);
            if (!Number.isFinite(v)) continue;
            passion = clamp(Math.floor(v), 0, 2);
        }
        return passion;
    }

    function generate(rng, cat) {
        const c = useCatalogs(cat);
        const rand = typeof rng === "function" ? rng : Math.random;
        const children = (c.backstories || []).filter((row) => row && row.slot === "child");
        const adults = (c.backstories || []).filter((row) => row && row.slot === "adult");
        const childhood = pick(rand, children);
        const adulthood = pick(rand, adults);
        const skills = emptySkills();
        for (const id of SKILL_IDS) {
            const u = roll(rand);
            const level = u < 0.85
                ? Math.floor(roll(rand) * 9)
                : 9 + Math.floor(roll(rand) * 6);
            let passion = 0;
            const p = roll(rand);
            if (p < 0.08) passion = 2;
            else if (p < 0.30) passion = 1;
            skills[id] = { level, xp: 0, passion };
        }
        const passionate = SKILL_IDS.filter((id) => skills[id].passion > 0);
        while (passionate.length > 4) {
            const i = Math.floor(roll(rand) * passionate.length);
            skills[passionate[i]].passion = 0;
            passionate.splice(i, 1);
        }
        const bio = {
            gender: roll(rand) < 0.5 ? "male" : "female",
            age: 16 + Math.floor(roll(rand) * 40),
            childhood: childhood?.id || null,
            adulthood: adulthood?.id || null,
            traits: [],
            skills,
            xpDay: { day: 0, gross: {} }
        };
        const forced = [];
        for (const row of [childhood, adulthood]) {
            for (const id of row?.traits || []) {
                const trait = defOf(c.traits, id);
                if (!trait || forced.includes(trait.id)) continue;
                if (conflictsWith(trait, forced, c)) continue;
                forced.push(trait.id);
            }
        }
        bio.traits = forced.slice();
        const count = 1 + Math.floor(roll(rand) * 3);
        const pool = (c.traits || []).filter((row) => row && row.id);
        let guard = 0;
        while (bio.traits.length < count && guard < 40) {
            guard += 1;
            const trait = weighted(rand, pool.filter((row) => !bio.traits.includes(row.id)), (row) => row.commonality ?? 1);
            if (!trait) break;
            if (conflictsWith(trait, bio.traits, c)) continue;
            if (disablesOverlap(trait, bio, c)) continue;
            bio.traits.push(trait.id);
        }
        return bio;
    }

    function rngFromId(id) {
        let state = 2166136261;
        const text = String(id || "pawn");
        for (let i = 0; i < text.length; i++) {
            state ^= text.charCodeAt(i);
            state = Math.imul(state, 16777619);
        }
        state >>>= 0;
        if (!state) state = 1;
        return function () {
            state = (state + 0x6D2B79F5) >>> 0;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function normalize(bio) {
        const src = bio && typeof bio === "object" ? bio : {};
        const skills = emptySkills();
        for (const id of SKILL_IDS) {
            const row = src.skills && src.skills[id];
            skills[id] = {
                level: clamp(Math.floor(Number(row?.level) || 0), 0, 20),
                xp: Number(row?.xp) || 0,
                passion: clamp(Math.floor(Number(row?.passion) || 0), 0, 2)
            };
        }
        const traits = [];
        for (const id of Array.isArray(src.traits) ? src.traits : []) {
            if (typeof id === "string" && id && traits.length < 3 && !traits.includes(id)) traits.push(id);
        }
        const gross = {};
        const srcGross = src.xpDay && src.xpDay.gross;
        if (srcGross && typeof srcGross === "object") {
            for (const id of SKILL_IDS) {
                if (Number.isFinite(Number(srcGross[id]))) gross[id] = Number(srcGross[id]);
            }
        }
        return {
            gender: src.gender === "male" ? "male" : "female",
            age: clamp(Math.floor(Number(src.age) || 16), 14, 70),
            childhood: typeof src.childhood === "string" ? src.childhood : null,
            adulthood: typeof src.adulthood === "string" ? src.adulthood : null,
            traits,
            skills,
            xpDay: {
                day: Math.floor(Number(src.xpDay?.day) || 0),
                gross
            }
        };
    }

    function ensure(bio, id, cat) {
        if (bio && bio.skills && bio.gender) return normalize(bio);
        return generate(rngFromId(id || "pawn"), cat);
    }

    function gainXp(row, amount) {
        let left = amount;
        if (!(left > 0)) return;
        row.xp += left;
        while (row.level < 20 && row.xp >= xpToNext(row.level)) {
            row.xp -= xpToNext(row.level);
            row.level += 1;
        }
    }

    function rollDay(bio, day) {
        if (!bio) return;
        const d = Math.floor(Number(day) || 0);
        if (!bio.xpDay) bio.xpDay = { day: d, gross: {} };
        if (bio.xpDay.day === d) return;
        decayOneDay(bio);
        bio.xpDay = { day: d, gross: {} };
    }

    function award(bio, skillId, base, opts) {
        if (!bio?.skills?.[skillId]) return 0;
        if (incapable(bio, skillId, opts?.catalogs)) return 0;
        const day = opts && Object.prototype.hasOwnProperty.call(opts, "day") ? opts.day : bio.xpDay?.day;
        if (day != null) rollDay(bio, day);
        const row = bio.skills[skillId];
        const learned = Math.max(0, Number(base) || 0) * passionMult(passionOf(bio, skillId, opts?.catalogs)) * learningFactor(bio, opts?.catalogs);
        if (!(learned > 0)) return 0;
        const gross = bio.xpDay.gross[skillId] || 0;
        const room = DAY_CAP - gross;
        let actual = learned;
        if (room <= 0) actual = learned * 0.2;
        else if (learned > room) actual = room + (learned - room) * 0.2;
        bio.xpDay.gross[skillId] = gross + learned;
        gainXp(row, actual);
        return actual;
    }

    function decayOneDay(bio) {
        if (!bio?.skills) return;
        for (const id of SKILL_IDS) {
            const row = bio.skills[id];
            const loss = DECAY[row.level] || 0;
            if (!(loss > 0)) continue;
            row.xp -= loss;
            if (bio.xpDay?.gross) {
                bio.xpDay.gross[id] = (bio.xpDay.gross[id] || 0) - loss;
            }
            while (row.level > 0 && row.xp < -1000) {
                row.level -= 1;
                row.xp += 1000 + xpToNext(row.level);
            }
            if (row.level <= 0 && row.xp < 0) row.xp = 0;
        }
    }

    function yieldCount(baseQty, factor, rng) {
        const base = Math.max(0, Math.floor(Number(baseQty) || 0));
        const f = Math.max(0, Number(factor) || 0);
        if (!(base > 0)) return 0;
        const expected = base * f;
        const whole = Math.floor(expected);
        const frac = expected - whole;
        const extra = roll(rng) < frac ? 1 : 0;
        return whole + extra;
    }

    function knapQuality(level, rng) {
        const shift = (clamp(Math.floor(Number(level) || 0), 0, 20) - 8) * 0.04;
        let fine = Math.max(0.02, 0.1 + shift);
        let broken = Math.max(0.02, 0.2 - shift);
        const rough = 0.3;
        const crude = 0.4;
        const sum = fine + broken + rough + crude;
        fine /= sum;
        broken /= sum;
        const rCrude = crude / sum;
        const rRough = rough / sum;
        const n = roll(rng);
        if (n < rCrude) return "crude";
        if (n < rCrude + rRough) return "rough";
        if (n < rCrude + rRough + broken) return null;
        return "fine";
    }

    function jobSkill(jobId) {
        return JOB_SKILL[jobId] || null;
    }

    function pawnLevel(pawn, skillId, cat) {
        if (!pawn?.bio) return null;
        return effectiveLevel(pawn.bio, skillId, cat);
    }

    return {
        SKILL_IDS,
        SKILL_LABELS,
        SKILL_BLURBS,
        XP_MINUTE,
        XP_HIT,
        XP_CATCH,
        XP_TEND,
        XP_HARVEST,
        DAY_CAP,
        JOB_SKILL,
        catalogs,
        linear,
        passionMult,
        passionOf,
        xpToNext,
        levelProgress,
        offsetOf,
        incapable,
        effectiveLevel,
        learningFactor,
        labelOf,
        genderLabel,
        titleOf,
        effectLines,
        traitConflicts,
        levelTitle,
        skillTip,
        tipLayers,
        tipHtml,
        backstoryTip,
        traitTip,
        incapableTip,
        researchSpeed,
        plantWorkSpeed,
        plantHarvestYield,
        cookSpeed,
        tendQualityFactor,
        tendSpeed,
        fishSpeed,
        meleeHitChance,
        meleeDodgeChance,
        shootingAccuracy,
        generate,
        rngFromId,
        normalize,
        ensure,
        clone,
        rollDay,
        award,
        decayOneDay,
        yieldCount,
        knapQuality,
        jobSkill,
        pawnLevel,
        emptySkills
    };
});
