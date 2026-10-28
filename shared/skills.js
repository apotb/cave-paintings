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
        const statLabels = {
            calories: "Daily calories",
            laborSpeed: "General labor speed",
            craftingQuality: "Crafting quality",
            researchSpeed: "Research speed",
            workSpeed: "General work speed",
            meleeHitScore: "Melee hit chance"
        };
        for (const key of Object.keys(statLabels)) {
            const v = row.stats && row.stats[key];
            if (!Number.isFinite(Number(v)) || Number(v) === 0) continue;
            if (key === "meleeHitScore") lines.push(`${statLabels[key]} ${formatSigned(v)}`);
            else lines.push(`${statLabels[key]} ${formatSigned(Math.round(Number(v) * 100))}%`);
        }
        const factorLabels = {
            painThreshold: "Pain threshold",
            incomingDamage: "Damage taken"
        };
        for (const key of Object.keys(factorLabels)) {
            const v = row.factors && row.factors[key];
            if (!Number.isFinite(Number(v)) || Number(v) === 1) continue;
            lines.push(`${factorLabels[key]} ×${Math.round(Number(v) * 100)}%`);
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
    function skillTip(bio, skillId, cat, opts) {
        const finish = (lines) => {
            if (opts?.passionSources) {
                const sources = passionSourceLines(bio, skillId, cat);
                if (sources.length) {
                    lines.push("");
                    lines.push(...sources);
                }
            }
            return lines.join("\n");
        };
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
            return finish(lines);
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
        return finish(lines);
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
        if (who) {
            desc = wrapWords(
                desc.replace(/<name>/g, `\u0001${who}\u0002`),
                42
            ).replace(/\u0001([\s\S]*?)\u0002/g, (_, body) => markTip("o", body));
        } else {
            desc = wrapWords(desc, 42);
        }
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

    const HIT_CURVE = [[-20, 0.05], [-10, 0.10], [0, 0.50], [10, 0.80], [20, 0.90], [40, 0.96], [60, 0.98]];
    const DODGE_CURVE = [[5, 0], [20, 0.30], [60, 0.50]];
    const SHOOT_CURVE = [
        [-20, 0.70], [-10, 0.80], [-6, 0.83], [-4, 0.85], [-2, 0.87],
        [0, 0.89], [2, 0.93], [4, 0.94], [6, 0.95], [8, 0.96], [10, 0.97],
        [12, 0.975], [14, 0.98], [16, 0.98333], [18, 0.98666], [20, 0.99],
        [22, 0.9925], [26, 0.995], [30, 0.9965], [40, 0.998], [60, 0.999]
    ];
    // Share of the shooter's accuracy that remains at each distance.
    const SHOOT_DISTANCE = [
        [5, 0.95], [10, 0.85], [15, 0.72], [20, 0.58],
        [25, 0.45], [30, 0.34], [35, 0.25], [40, 0.18]
    ];
    const COOK_CURVE = [[-20, 0.01], [0, 0.4], [20, 1.6]];
    const TEND_QUALITY_CURVE = [[0, 0], [1, 1], [2, 1.5], [4, 2]];
    const AGE_WORK = [[4, 0.2], [12, 0.8], [18, 1]];
    const GLOW_WORK = [[0, 0.8], [0.3, 1]];
    const PLANT_YIELD = [
        0.60, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 0.975, 1.00,
        1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.09, 1.10, 1.12, 1.13
    ];
    const SKY_DARK = [
        [0, 0.94], [300, 0.94], [360, 0.28], [420, 0.10], [540, 0.02],
        [660, 0], [840, 0], [1020, 0.06], [1050, 0.10], [1080, 0.16],
        [1140, 0.34], [1200, 0.58], [1230, 0.80], [1260, 0.94], [1440, 0.94]
    ];

    function curveAt(points, x) {
        const n = Number(x);
        if (!points.length || !Number.isFinite(n)) return points[0] ? points[0][1] : 0;
        if (n <= points[0][0]) return points[0][1];
        const last = points[points.length - 1];
        if (n >= last[0]) return last[1];
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            if (n <= b[0]) {
                const span = b[0] - a[0];
                const u = span === 0 ? 0 : (n - a[0]) / span;
                return a[1] + (b[1] - a[1]) * u;
            }
        }
        return last[1];
    }

    function isPawn(value) {
        return !!value && typeof value === "object";
    }

    function traitStat(bio, key, cat) {
        let n = 0;
        for (const row of activeDefs(bio, cat)) {
            const v = row.stats && row.stats[key];
            if (Number.isFinite(Number(v))) n += Number(v);
        }
        return n;
    }

    function traitFactor(bio, key, cat) {
        let n = 1;
        for (const row of activeDefs(bio, cat)) {
            const v = row.factors && row.factors[key];
            if (Number.isFinite(Number(v))) n *= Number(v);
        }
        return n;
    }

    function hasTrait(bio, id) {
        return Array.isArray(bio?.traits) && bio.traits.includes(id);
    }

    function capsOf(pawn, opts) {
        if (pawn?.capacities) return pawn.capacities;
        if (pawn?.creature?.capacities) return pawn.creature.capacities;
        const world = opts?.world;
        const found = world?._ensureSettlerCreature?.(pawn) || world?.creatures?.get?.(pawn?.id);
        return found?.capacities || null;
    }

    function capValue(pawn, key, opts) {
        const caps = capsOf(pawn, opts);
        const fn = caps?.[key];
        const n = typeof fn === "function" ? Number(fn.call(caps)) : Number(fn);
        return Number.isFinite(n) ? n : 1;
    }

    function capOffset(cap, scale, max) {
        const c = max == null ? cap : Math.min(cap, max);
        return scale * (c - 1);
    }

    function capFactor(cap, weight, max) {
        const c = max == null ? cap : Math.min(cap, max);
        return 1 - weight + weight * c;
    }

    function skillLevel(pawn, skillId, opts) {
        if (!isPawn(pawn)) return clamp(Math.floor(Number(pawn) || 0), 0, 20);
        const lv = effectiveLevel(pawn.bio, skillId, opts?.cat);
        return lv == null ? 0 : lv;
    }

    function skyDarkness(minutes) {
        const t = ((Number(minutes) % 1440) + 1440) % 1440;
        return curveAt(SKY_DARK, t);
    }

    function lightPunch(dist, radiusPx) {
        if (!(radiusPx > 0)) return 0;
        const u = dist / radiusPx;
        if (u >= 1) return 0;
        if (u <= 0) return 1;
        if (u <= 0.4) return 1 + (0.85 - 1) * (u / 0.4);
        return 0.85 * (1 - (u - 0.4) / 0.6);
    }

    function tileBrightness(opts = {}) {
        if (Number.isFinite(Number(opts.brightness))) {
            return Math.max(0, Math.min(1, Number(opts.brightness)));
        }
        const sky = skyDarkness(opts.minutes);
        if (sky < 0.03) return 1;
        let remain = sky;
        const tile = Number(opts.tileSize) > 0 ? Number(opts.tileSize) : 16;
        const x = Number(opts.x) || 0;
        const y = Number(opts.y) || 0;
        for (const fire of opts.fires || []) {
            const r = (Number(fire.radiusTiles) || 0) * tile;
            if (!(r > 0)) continue;
            const dx = x - (Number(fire.x) || 0);
            const dy = y - (Number(fire.y) || 0);
            remain *= 1 - lightPunch(Math.hypot(dx, dy), r);
        }
        return 1 - remain;
    }

    function fireApi() {
        if (typeof Fire !== "undefined") return Fire;
        try { return require("./fire"); } catch (_) { return null; }
    }

    function workOpts(host, pawn) {
        if (!host || !pawn || host.gameMinutes == null) return { world: host || null };
        const x = Number(pawn.x) || 0;
        const y = Number(pawn.y) || 0;
        const fires = [];
        const FireApi = fireApi();
        const chunks = typeof host._chunksNear === "function" ? host._chunksNear(x, y, 3) : [];
        for (const chunk of chunks || []) {
            for (const thing of chunk?.things || []) {
                if (typeof host._isCampfireEntry === "function" && !host._isCampfireEntry(thing)) continue;
                if (typeof host._isCampfireEntry !== "function" && !thing?.campfire && !thing?.meta?.campfire) continue;
                const entry = thing.entry || thing;
                const radiusTiles = FireApi?.lightRadiusForEntry?.(entry) || 0;
                if (!(radiusTiles > 0)) continue;
                fires.push({
                    x: Number(entry.x ?? thing.x) || 0,
                    y: Number(entry.y ?? thing.y) || 0,
                    radiusTiles
                });
            }
        }
        if (!fires.length && typeof host.getCampfires === "function") {
            for (const fire of host.getCampfires() || []) {
                const entry = fire.entry || fire;
                const radiusTiles = FireApi?.lightRadiusForEntry?.(entry) || 0;
                if (!(radiusTiles > 0)) continue;
                fires.push({ x: Number(fire.x) || 0, y: Number(fire.y) || 0, radiusTiles });
            }
        }
        return {
            world: host,
            minutes: host.gameMinutes,
            x,
            y,
            fires,
            tileSize: Number(host.tileSize) > 0 ? Number(host.tileSize) : 16
        };
    }

    function globalWorkSpeed(pawn, opts) {
        if (!isPawn(pawn)) return 1;
        const base = 1 + traitStat(pawn.bio, "workSpeed", opts?.cat);
        const age = Number(pawn.bio?.age);
        const ageF = Number.isFinite(age) ? curveAt(AGE_WORK, age) : 1;
        let dark = 1;
        const sight = capValue(pawn, "sight", opts);
        if (sight !== 0 && !hasTrait(pawn.bio, "night_owl") && opts && opts.minutes != null) {
            dark = curveAt(GLOW_WORK, tileBrightness(opts));
        }
        return Math.max(0.3, base * ageF * dark);
    }

    function laborSpeed(pawn, opts) {
        if (!isPawn(pawn)) return 1;
        const base = 1 + traitStat(pawn.bio, "laborSpeed", opts?.cat);
        const manip = capFactor(capValue(pawn, "manipulation", opts), 1, null);
        const sight = capFactor(capValue(pawn, "sight", opts), 0.5, 1);
        return Math.max(0.1, base * manip * sight * globalWorkSpeed(pawn, opts));
    }

    function floorSpeed(n) {
        return Math.max(0.1, n);
    }

    function researchSpeed(levelOrPawn, opts) {
        if (!isPawn(levelOrPawn)) return linear(levelOrPawn, 0.08, 0.115);
        const skill = linear(skillLevel(levelOrPawn, "intellectual", opts), 0.08, 0.115);
        const manip = capFactor(capValue(levelOrPawn, "manipulation", opts), 0.5, 1.1);
        const sight = capFactor(capValue(levelOrPawn, "sight", opts), 0.5, 1.1);
        const story = 1 + traitStat(levelOrPawn.bio, "researchSpeed", opts?.cat);
        return floorSpeed(skill * manip * sight * story * globalWorkSpeed(levelOrPawn, opts));
    }

    function plantWorkSpeed(levelOrPawn, opts) {
        if (!isPawn(levelOrPawn)) return linear(levelOrPawn, 0.08, 0.115);
        const skill = linear(skillLevel(levelOrPawn, "plants", opts), 0.08, 0.115);
        const manip = capFactor(capValue(levelOrPawn, "manipulation", opts), 1, null);
        const sight = capFactor(capValue(levelOrPawn, "sight", opts), 0.3, 1);
        return floorSpeed(skill * manip * sight * globalWorkSpeed(levelOrPawn, opts));
    }

    function plantHarvestYield(levelOrPawn, opts) {
        const lv = isPawn(levelOrPawn)
            ? skillLevel(levelOrPawn, "plants", opts)
            : clamp(Math.floor(Number(levelOrPawn) || 0), 0, 20);
        const base = PLANT_YIELD[clamp(lv, 0, 20)];
        if (!isPawn(levelOrPawn)) return base;
        const manip = capFactor(capValue(levelOrPawn, "manipulation", opts), 0.3, null);
        const sight = capFactor(capValue(levelOrPawn, "sight", opts), 0.2, 1);
        return base * manip * sight;
    }

    function cookScore(pawn, opts) {
        return skillLevel(pawn, "cooking", opts)
            + capOffset(capValue(pawn, "manipulation", opts), 16, 1.5)
            + capOffset(capValue(pawn, "sight", opts), 4, 1.5);
    }

    function cookSpeed(levelOrPawn, opts) {
        if (!isPawn(levelOrPawn)) return curveAt(COOK_CURVE, Number(levelOrPawn) || 0);
        return floorSpeed(curveAt(COOK_CURVE, cookScore(levelOrPawn, opts)) * globalWorkSpeed(levelOrPawn, opts));
    }

    function tendQualityRaw(levelOrPawn, opts) {
        if (!isPawn(levelOrPawn)) return linear(levelOrPawn, 0.2, 0.1);
        const skill = linear(skillLevel(levelOrPawn, "medical", opts), 0.2, 0.1);
        const manip = capFactor(capValue(levelOrPawn, "manipulation", opts), 1, 1.4);
        const sight = capFactor(capValue(levelOrPawn, "sight", opts), 0.7, 1.4);
        return skill * manip * sight;
    }

    function tendQualityFactor(levelOrPawn, opts) {
        return curveAt(TEND_QUALITY_CURVE, tendQualityRaw(levelOrPawn, opts));
    }

    function tendSpeed(levelOrPawn, opts) {
        if (!isPawn(levelOrPawn)) return linear(levelOrPawn, 0.4, 0.06);
        const skill = linear(skillLevel(levelOrPawn, "medical", opts), 0.4, 0.06);
        const manip = capFactor(capValue(levelOrPawn, "manipulation", opts), 1, null);
        const sight = capFactor(capValue(levelOrPawn, "sight", opts), 0.8, 1.3);
        return floorSpeed(skill * manip * sight * globalWorkSpeed(levelOrPawn, opts));
    }

    function fishSpeed(levelOrPawn, opts) {
        if (!isPawn(levelOrPawn)) return linear(levelOrPawn, 0.75, 0.025);
        const skill = linear(skillLevel(levelOrPawn, "animals", opts), 0.75, 0.025);
        const manip = capFactor(capValue(levelOrPawn, "manipulation", opts), 0.5, null);
        return floorSpeed(skill * manip * globalWorkSpeed(levelOrPawn, opts));
    }

    function meleeHitScore(pawn, opts) {
        const level = isPawn(pawn) ? skillLevel(pawn, "melee", opts) : (Number(pawn) || 0);
        if (!isPawn(pawn)) return level;
        return level
            + capOffset(capValue(pawn, "manipulation", opts), 12, 1.5)
            + capOffset(capValue(pawn, "sight", opts), 12, 1.5)
            + traitStat(pawn.bio, "meleeHitScore", opts?.cat);
    }

    function meleeHitChance(levelOrPawn, opts) {
        return curveAt(HIT_CURVE, meleeHitScore(levelOrPawn, opts));
    }

    function meleeDodgeScore(pawn, opts) {
        const level = isPawn(pawn) ? skillLevel(pawn, "melee", opts) : (Number(pawn) || 0);
        if (!isPawn(pawn)) return level;
        return level
            + capOffset(capValue(pawn, "moving", opts), 18, null)
            + capOffset(capValue(pawn, "sight", opts), 8, 1.4);
    }

    function meleeDodgeChance(levelOrPawn, opts) {
        return Math.max(0, curveAt(DODGE_CURVE, meleeDodgeScore(levelOrPawn, opts)));
    }

    function shootingScore(pawn, opts) {
        const level = isPawn(pawn) ? skillLevel(pawn, "shooting", opts) : (Number(pawn) || 0);
        if (!isPawn(pawn)) return level;
        return level
            + capOffset(capValue(pawn, "sight", opts), 12, 2)
            + capOffset(capValue(pawn, "manipulation", opts), 8, 1);
    }

    function shootingAccuracy(levelOrPawn, opts) {
        return curveAt(SHOOT_CURVE, shootingScore(levelOrPawn, opts));
    }

    function shootingAccuracyAt(levelOrPawn, tiles, opts) {
        return shootingAccuracy(levelOrPawn, opts) * curveAt(SHOOT_DISTANCE, tiles);
    }

    function painThreshold(pawn) {
        const base = Number(pawn?.anatomy?.plan?.painShockThreshold) || 0.8;
        return Math.max(0.01, base * traitFactor(pawn?.bio, "painThreshold"));
    }

    function incomingDamageFactor(pawn) {
        return traitFactor(pawn?.bio, "incomingDamage");
    }

    function calorieFactor(pawn) {
        let f = 1 + traitStat(pawn?.bio, "calories");
        const hed = pawn?.capacities?.hungerRateFactor?.();
        if (Number.isFinite(Number(hed)) && Number(hed) > 0) f *= Number(hed);
        return f;
    }

    function jobRate(pawn, id, opts) {
        switch (id) {
            case "cook": return cookSpeed(pawn, opts);
            case "tend": return tendSpeed(pawn, opts);
            case "tendQuality": return tendQualityFactor(pawn, opts);
            case "plant": return plantWorkSpeed(pawn, opts);
            case "plantYield": return plantHarvestYield(pawn, opts);
            case "fish": return fishSpeed(pawn, opts);
            case "research": return researchSpeed(pawn, opts);
            case "labor": return laborSpeed(pawn, opts);
            case "work": return globalWorkSpeed(pawn, opts);
            default: return 1;
        }
    }

    function pct(n) {
        const v = Math.round(Number(n) * 1000) / 10;
        return `${v}%`;
    }

    function carryApi() {
        if (typeof Carry !== "undefined") return Carry;
        try { return require("./carry"); } catch (_) { return null; }
    }

    function moveParts(pawn) {
        const moving = capValue(pawn, "moving");
        const move = Math.max(0.05, Math.min(1.5, Number.isFinite(moving) ? moving : 1));
        let enc = 1;
        let gear = 1;
        const CarryApi = carryApi();
        if (CarryApi?.humanMoveSpeed) {
            const got = CarryApi.humanMoveSpeed(pawn, { wantSprint: false, attackSlow: false });
            enc = Number(got?.encumbrance?.speedMultiplier);
            if (!Number.isFinite(enc) || enc <= 0) enc = 1;
            const tile = 16;
            const base = 3.5 * tile * move;
            const speed = Number(got?.speed) || base;
            gear = base * enc > 0 ? speed / (base * enc) : 1;
            if (!Number.isFinite(gear) || gear <= 0) gear = 1;
        }
        const tiles = 3.5 * move * enc * gear;
        return { move, enc, gear, tiles };
    }

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

    /** Rolled passion, plus each current backstory and trait, capped at two stars. */
    function passionOf(bio, skillId, cat) {
        let passion = 0;
        for (const source of passionParts(bio, skillId, cat)) passion += source.count;
        return clamp(passion, 0, 2);
    }

    function passionParts(bio, skillId, cat) {
        const parts = [];
        const base = Math.floor(Number(bio?.skills?.[skillId]?.passion) || 0);
        if (base > 0) parts.push({ label: "Base", count: base });
        for (const row of activeDefs(bio, cat)) {
            if (!row?.passions || !Object.prototype.hasOwnProperty.call(row.passions, skillId)) continue;
            const count = Math.floor(Number(row.passions[skillId]) || 0);
            if (!(count > 0)) continue;
            parts.push({ label: row.title || "Unknown", count });
        }
        return parts;
    }

    function passionSourceLines(bio, skillId, cat) {
        return passionParts(bio, skillId, cat).map((part) => {
            const n = clamp(part.count, 1, 2);
            const stars = Array.from({ length: n }, () => "{s}*{/s}").join(" ");
            return `${stars} ${part.label}`;
        });
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

    function knapBands(level) {
        const shift = (clamp(Math.floor(Number(level) || 0), 0, 20) - 8) * 0.04;
        let fine = Math.max(0.02, 0.1 + shift);
        let broken = Math.max(0.02, 0.2 - shift);
        const rough = 0.3;
        const crude = 0.4;
        const sum = fine + broken + rough + crude;
        return {
            crude: crude / sum,
            rough: rough / sum,
            broken: broken / sum,
            fine: fine / sum
        };
    }

    function shatterChance(level) {
        return knapBands(level).broken;
    }

    function knapCenter(level, offset) {
        return clamp(Math.floor(Number(level) || 0), 0, 20) / 20 + (Number(offset) || 0);
    }

    function knapGrade(sample) {
        if (sample < 0.45) return "crude";
        if (sample < 0.7) return "rough";
        return "fine";
    }

    /**
     * The first roll uses the old crude, rough, broken, fine bands.
     * A broken band is a failed blank. Any other band survives, and the
     * gaussian then picks crude, rough, or fine.
     */
    function knapQuality(level, rng, offset = 0) {
        const bands = knapBands(level);
        const n = roll(rng);
        const roughEnd = bands.crude + bands.rough;
        if (n >= roughEnd && n < roughEnd + bands.broken) return null;
        let u = roll(rng);
        const v = roll(rng);
        if (!(u > 0)) u = 1e-9;
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        const center = knapCenter(level, offset);
        return knapGrade(center + z * (z < 0 ? 0.12 : 0.16));
    }

    function statSentence(id) {
        const text = {
            meleeDps: "Damage per second of the attacks this pawn can use, weighted by how often each is picked.",
            meleeHit: "Chance a melee blow lands before the target tries to dodge.",
            meleeDodge: "Chance to avoid a melee blow that would otherwise land.",
            shooting: "Chance to hit a target at each distance, before cover and the target's size.",
            incomingDamage: "Amount of damage taken after armor calculations.",
            painThreshold: "Pain threshold before collapsing from pain shock.",
            moveSpeed: "Default walk speed when not sprinting, performing an action, or encumbered.",
            calories: "Base rate of calorie consumption when not sprinting or resting.",
            learning: "Base rate of skill XP gain before passion multipliers.",
            workSpeed: "Multiplier on all timed work.",
            laborSpeed: "Multplier on labor work, such as crafting, tailoring, and smithing.",
            craftingQuality: "Shifts the calculation of quality to favor a better outcome.",
            cook: "How fast cooking jobs are completed.",
            tend: "How fast tending is completed.",
            tendQuality: "Quality multiplier of a tend after the medicine's own roll.",
            plant: "How fast plants cutting and harvesting is completed.",
            plantYield: "Multiplier on how much a plant's harvest yields.",
            fish: "How fast a bite comes when fishing.",
            research: "How fast research tasks are completed."
        };
        return text[id] || "";
    }

    function describeStat(pawn, id, opts) {
        const o = opts || {};
        const lines = [];
        const push = (label, value) => lines.push({ label, value });
        let final = 0;
        let valueText = "";
        if (id === "meleeHit") {
            const level = isPawn(pawn) ? skillLevel(pawn, "melee", o) : (Number(pawn) || 0);
            push("Melee skill", String(level));
            if (isPawn(pawn)) {
                push("Manipulation", formatSigned(Math.round(capOffset(capValue(pawn, "manipulation", o), 12, 1.5) * 10) / 10));
                push("Sight", formatSigned(Math.round(capOffset(capValue(pawn, "sight", o), 12, 1.5) * 10) / 10));
                const extra = traitStat(pawn.bio, "meleeHitScore", o.cat);
                if (extra) push("Brawler", formatSigned(extra));
            }
            push("Skill factor", pct(meleeHitChance(pawn, o)));
            final = meleeHitChance(pawn, o);
            valueText = pct(final);
        } else if (id === "meleeDodge") {
            const level = isPawn(pawn) ? skillLevel(pawn, "melee", o) : (Number(pawn) || 0);
            push("Melee skill", String(level));
            if (isPawn(pawn)) {
                push("Moving", formatSigned(Math.round(capOffset(capValue(pawn, "moving", o), 18, null) * 10) / 10));
                push("Sight", formatSigned(Math.round(capOffset(capValue(pawn, "sight", o), 8, 1.4) * 10) / 10));
            }
            push("Skill factor", pct(meleeDodgeChance(pawn, o)));
            final = meleeDodgeChance(pawn, o);
            valueText = pct(final);
        } else if (id === "shooting") {
            const level = isPawn(pawn) ? skillLevel(pawn, "shooting", o) : (Number(pawn) || 0);
            push("Shooting skill", String(level));
            if (isPawn(pawn)) {
                push("Sight", formatSigned(Math.round(capOffset(capValue(pawn, "sight", o), 12, 2) * 10) / 10));
                push("Manipulation", formatSigned(Math.round(capOffset(capValue(pawn, "manipulation", o), 8, 1) * 10) / 10));
            }
            const acc = shootingAccuracy(pawn, o);
            push("Skill factor", pct(acc));
            lines.push({ blank: true });
            for (const [tiles] of SHOOT_DISTANCE) {
                push(`${tiles} tiles`, pct(shootingAccuracyAt(pawn, tiles, o)));
            }
            final = shootingAccuracyAt(pawn, SHOOT_DISTANCE[0][0], o);
            valueText = pct(final);
        } else if (id === "incomingDamage") {
            const factor = isPawn(pawn) ? incomingDamageFactor(pawn) : 1;
            push("After armor", "100%");
            if (factor !== 1) push("Tough", `×${Math.round(factor * 100)}%`);
            final = factor;
            valueText = pct(final);
        } else if (id === "painThreshold") {
            const base = Number(pawn?.anatomy?.plan?.painShockThreshold) || 0.8;
            push("Body", pct(base));
            const factor = isPawn(pawn) ? traitFactor(pawn.bio, "painThreshold") : 1;
            if (factor !== 1) push("Wimp", `×${Math.round(factor * 100)}%`);
            final = isPawn(pawn) ? painThreshold(pawn) : base;
            valueText = pct(final);
        } else if (id === "moveSpeed") {
            const parts = moveParts(isPawn(pawn) ? pawn : {});
            push("Base", "3.5 tiles");
            push("Moving", `×${pct(parts.move)}`);
            push("Encumbrance", `×${pct(parts.enc)}`);
            push("Worn gear", `×${pct(parts.gear)}`);
            final = parts.tiles;
            valueText = `${Math.round(final * 100) / 100} tiles/s`;
        } else if (id === "calories") {
            const hunger = Number(pawn?.hunger);
            const base = Number.isFinite(hunger) && hunger > 0 ? hunger : 2000;
            push("Base", `${Math.round(base)} kcal`);
            const food = isPawn(pawn) ? traitStat(pawn.bio, "calories") : 0;
            if (food) push("Foodie", formatSigned(Math.round(food * 100)) + "%");
            const hed = pawn?.capacities?.hungerRateFactor?.();
            if (Number.isFinite(Number(hed)) && Number(hed) !== 1) push("Body", `×${pct(hed)}`);
            final = base * (isPawn(pawn) ? calorieFactor(pawn) : 1);
            valueText = `${Math.round(final)} kcal/day`;
        } else if (id === "learning") {
            const base = isPawn(pawn) ? learningFactor(pawn.bio, o.cat) : 1;
            push("Base", pct(base));
            final = base;
            valueText = pct(final);
        } else if (id === "workSpeed") {
            const add = isPawn(pawn) ? traitStat(pawn.bio, "workSpeed", o.cat) : 0;
            push("Base", pct(1 + add));
            const age = Number(pawn?.bio?.age);
            const ageF = Number.isFinite(age) ? curveAt(AGE_WORK, age) : 1;
            push("Age", `×${pct(ageF)}`);
            let dark = 1;
            if (isPawn(pawn) && capValue(pawn, "sight", o) !== 0 && !hasTrait(pawn.bio, "night_owl") && o.minutes != null) {
                dark = curveAt(GLOW_WORK, tileBrightness(o));
            }
            push("Light", `×${pct(dark)}`);
            final = isPawn(pawn) ? globalWorkSpeed(pawn, o) : 1;
            valueText = pct(final);
        } else if (id === "laborSpeed") {
            const add = isPawn(pawn) ? traitStat(pawn.bio, "laborSpeed", o.cat) : 0;
            push("Base", pct(1 + add));
            if (isPawn(pawn)) {
                push("Manipulation", `×${pct(capFactor(capValue(pawn, "manipulation", o), 1, null))}`);
                push("Sight", `×${pct(capFactor(capValue(pawn, "sight", o), 0.5, 1))}`);
                push("Work speed", `×${pct(globalWorkSpeed(pawn, o))}`);
            }
            final = isPawn(pawn) ? laborSpeed(pawn, o) : 1;
            valueText = pct(final);
        } else if (id === "craftingQuality") {
            const add = isPawn(pawn) ? traitStat(pawn.bio, "craftingQuality", o.cat) : 0;
            const level = isPawn(pawn) ? skillLevel(pawn, "crafting", o) : 0;
            push("Crafting skill", String(level));
            push("Center", String(Math.round(knapCenter(level, add) * 100) / 100));
            if (add) push("Trait", formatSigned(Math.round(add * 100)) + "%");
            final = 1 + add;
            valueText = pct(final);
        } else if (id === "cook") {
            const level = isPawn(pawn) ? skillLevel(pawn, "cooking", o) : (Number(pawn) || 0);
            push("Cooking skill", String(level));
            if (isPawn(pawn)) {
                push("Manipulation", formatSigned(Math.round(capOffset(capValue(pawn, "manipulation", o), 16, 1.5) * 10) / 10));
                push("Sight", formatSigned(Math.round(capOffset(capValue(pawn, "sight", o), 4, 1.5) * 10) / 10));
            }
            const cookPoints = isPawn(pawn) ? cookScore(pawn, o) : (Number(pawn) || 0);
            push("Skill factor", pct(curveAt(COOK_CURVE, cookPoints)));
            push("Work speed", `×${pct(isPawn(pawn) ? globalWorkSpeed(pawn, o) : 1)}`);
            final = cookSpeed(pawn, o);
            valueText = pct(final);
        } else if (id === "tend") {
            if (isPawn(pawn)) {
                const level = skillLevel(pawn, "medical", o);
                push("Medical skill", String(level));
                push("Skill factor", pct(linear(level, 0.4, 0.06)));
                push("Manipulation", `×${pct(capFactor(capValue(pawn, "manipulation", o), 1, null))}`);
                push("Sight", `×${pct(capFactor(capValue(pawn, "sight", o), 0.8, 1.3))}`);
            }
            push("Work speed", `×${pct(isPawn(pawn) ? globalWorkSpeed(pawn, o) : 1)}`);
            final = tendSpeed(pawn, o);
            valueText = pct(final);
        } else if (id === "tendQuality") {
            if (isPawn(pawn)) {
                const level = skillLevel(pawn, "medical", o);
                push("Medical skill", String(level));
                push("Skill factor", pct(linear(level, 0.2, 0.1)));
                push("Manipulation", `×${pct(capFactor(capValue(pawn, "manipulation", o), 1, 1.4))}`);
                push("Sight", `×${pct(capFactor(capValue(pawn, "sight", o), 0.7, 1.4))}`);
                push("Raw", pct(tendQualityRaw(pawn, o)));
            }
            final = tendQualityFactor(pawn, o);
            valueText = pct(final);
        } else if (id === "plant") {
            if (isPawn(pawn)) {
                const level = skillLevel(pawn, "plants", o);
                push("Plants skill", String(level));
                push("Skill factor", pct(linear(level, 0.08, 0.115)));
                push("Manipulation", `×${pct(capFactor(capValue(pawn, "manipulation", o), 1, null))}`);
                push("Sight", `×${pct(capFactor(capValue(pawn, "sight", o), 0.3, 1))}`);
            }
            push("Work speed", `×${pct(isPawn(pawn) ? globalWorkSpeed(pawn, o) : 1)}`);
            final = plantWorkSpeed(pawn, o);
            valueText = pct(final);
        } else if (id === "plantYield") {
            const lv = isPawn(pawn) ? skillLevel(pawn, "plants", o) : clamp(Math.floor(Number(pawn) || 0), 0, 20);
            push("Plants skill", String(lv));
            push("Skill factor", pct(PLANT_YIELD[clamp(lv, 0, 20)]));
            if (isPawn(pawn)) {
                push("Manipulation", `×${pct(capFactor(capValue(pawn, "manipulation", o), 0.3, null))}`);
                push("Sight", `×${pct(capFactor(capValue(pawn, "sight", o), 0.2, 1))}`);
            }
            final = plantHarvestYield(pawn, o);
            valueText = pct(final);
        } else if (id === "fish") {
            if (isPawn(pawn)) {
                const level = skillLevel(pawn, "animals", o);
                push("Animals skill", String(level));
                push("Skill factor", pct(linear(level, 0.75, 0.025)));
                push("Manipulation", `×${pct(capFactor(capValue(pawn, "manipulation", o), 0.5, null))}`);
            }
            push("Work speed", `×${pct(isPawn(pawn) ? globalWorkSpeed(pawn, o) : 1)}`);
            final = fishSpeed(pawn, o);
            valueText = pct(final);
        } else if (id === "research") {
            if (isPawn(pawn)) {
                const level = skillLevel(pawn, "intellectual", o);
                push("Intellectual skill", String(level));
                push("Skill factor", pct(linear(level, 0.08, 0.115)));
                push("Manipulation", `×${pct(capFactor(capValue(pawn, "manipulation", o), 0.5, 1.1))}`);
                push("Sight", `×${pct(capFactor(capValue(pawn, "sight", o), 0.5, 1.1))}`);
                const story = traitStat(pawn.bio, "researchSpeed", o.cat);
                if (story) push("Storyteller", formatSigned(Math.round(story * 100)) + "%");
            }
            push("Work speed", `×${pct(isPawn(pawn) ? globalWorkSpeed(pawn, o) : 1)}`);
            final = researchSpeed(pawn, o);
            valueText = pct(final);
        } else if (id === "meleeDps") {
            const hit = meleeHitChance(pawn, o);
            const attacks = o.attacks || [];
            let sumW = 0;
            const rows = [];
            for (const attack of attacks) {
                const damage = Math.max(0, Number(attack.damage) || 0);
                const cooldown = Math.max(0.2, Number(attack.cooldown) || 2);
                const mult = Number(attack.weightMultiplier);
                const weight = damage * damage * (Number.isFinite(mult) ? mult : 1);
                if (!(weight > 0) || !(cooldown > 0)) continue;
                sumW += weight;
                const part = damage * hit / cooldown;
                rows.push({ attack, weight, part });
                push(attack.name || "Attack", `${Math.round(damage * 10) / 10} × ${pct(hit)} / ${cooldown}`);
            }
            final = 0;
            if (sumW > 0) {
                for (const row of rows) final += (row.weight / sumW) * row.part;
            }
            valueText = `${Math.round(final * 100) / 100}`;
        }
        return {
            id,
            sentence: statSentence(id),
            lines,
            final,
            valueText,
            rangeTable: id === "shooting"
        };
    }

    const STAT_ROWS = [
        { group: "Combat", id: "meleeDps", label: "Melee DPS" },
        { group: "Combat", id: "meleeHit", label: "Melee hit chance" },
        { group: "Combat", id: "meleeDodge", label: "Melee dodge chance" },
        { group: "Combat", id: "shooting", label: "Shooting accuracy" },
        { group: "Combat", id: "incomingDamage", label: "Damage taken" },
        { group: "Body", id: "painThreshold", label: "Pain threshold" },
        { group: "Body", id: "moveSpeed", label: "Move speed" },
        { group: "Hunger", id: "calories", label: "Calories" },
        { group: "Work", id: "learning", label: "Learning rate" },
        { group: "Work", id: "workSpeed", label: "General work speed" },
        { group: "Work", id: "laborSpeed", label: "General labor speed" },
        { group: "Work", id: "craftingQuality", label: "Crafting quality" },
        { group: "Work", id: "cook", label: "Cooking speed" },
        { group: "Work", id: "tend", label: "Medical tend speed" },
        { group: "Work", id: "tendQuality", label: "Medical tend quality" },
        { group: "Work", id: "plant", label: "Plant work speed" },
        { group: "Work", id: "plantYield", label: "Plant harvest yield" },
        { group: "Work", id: "fish", label: "Fishing speed" },
        { group: "Work", id: "research", label: "Research speed" }
    ];

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
        shootingAccuracyAt,
        traitStat,
        traitFactor,
        hasTrait,
        globalWorkSpeed,
        laborSpeed,
        jobRate,
        workOpts,
        tileBrightness,
        skyDarkness,
        painThreshold,
        incomingDamageFactor,
        calorieFactor,
        shatterChance,
        knapCenter,
        knapGrade,
        describeStat,
        STAT_ROWS,
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
