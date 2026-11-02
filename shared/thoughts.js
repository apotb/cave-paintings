/**
 * Thoughts set a mood target. The bar eases toward it, the way RimWorld does,
 * so a new thought does not yank the bar across the screen.
 * Memories expire. Conditions are rebuilt whenever the list is refreshed.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Thoughts = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const DAY = 24 * 60;
    /** Below this, and still above Hungry, they are peckish. Meals start at 1000 kcal. */
    const PECKISH = 600;

    /**
     * Every line the mood tooltip can show. Edit the wording here.
     * A thought is [label, quote]. {name} in namedDeath is the person who died.
     * {name} in joined is the main character who accepted them.
     * {part} in lost_part is the body part, such as "Left Arm".
     */
    const TEXT = {
        stage: {
            miserable: "miserable",
            unhappy: "unhappy",
            stressed: "stressed",
            content: "content",
            happy: "happy",
            elated: "elated"
        },
        tip: {
            title: "Mood",
            target: "Target",
            feeling: "How this person is feeling right now.",
            warning: "Keep them happy, lest they grow resentful.",
            average: "Average happiness",
            settlers: "The average happiness of all your settlers.",
            none: "No settlers.",
            complaints: "Top complaints"
        },
        someoneDied: "Someone died",
        namedDeath: "{name} died",
        thought: {
            slept_hut: ["Slept in a hut", "I slept with walls around me."],
            slept_outdoors: ["Slept outdoors", "I slept in the brutal outdoors."],
            slept_stars: ["Slept under the stars", "The night sky was beautiful."],
            ate_raw: ["Ate raw meat", "I consumed raw meat."],
            ate_human: ["Ate human flesh", "That was once a person..."],
            ate_cooked: ["Ate a cooked meal", "Food is better when it is prepared."],
            witnessed_death: ["Witnessed a death", "Life is so fleeting."],
            saw_corpse: ["Saw a corpse", "The leftovers of a person..."],
            lost_someone: ["Lost an ally", "One of our own has died."],
            killed: ["Killed someone", "The adrenaline... IT'S SO GOOD!!"],
            let_it_out: ["Catharsis", "I had to get those feelings out."],
            starving: ["Starving", "I'm so hungry, I feel like I could pass out."],
            hungry: ["Hungry", "My stomach is growling."],
            peckish: ["Peckish", "I could go for some food."],
            malnutrition_minor: ["Malnourished", "So... hungry..."],
            malnutrition_moderate: ["Malnourished", "I'm slowly wasting away..."],
            malnutrition_severe: ["Malnourished", "I'm so weak, I can't think about anything but food."],
            malnutrition_extreme: ["Malnourished", "Am I still alive? When will my suffering end?"],
            drowsy: ["Drowsy", "I need to lie down."],
            tired: ["Tired", "I'm worn out."],
            exhausted: ["Exhausted", "I can't keep my eyes open."],
            pain_minor: ["In pain", "That hurts a little."],
            pain_serious: ["In pain", "The pain is pretty bad."],
            pain_agony: ["Agony", "AGHH!! It hurts!"],
            food_poisoning: ["Food poisoning", "My guts are turning inside-out."],
            sick: ["Sick", "I'm under the weather. I hope I get well soon."],
            wants_kill: ["Wants to kill", "I need to end someone's life."],
            wants_kill_long: ["Wants to kill", "Someone is going to die soon."],
            darkness: ["Darkness", "I can't see a thing."],
            darkness_joy: ["Darkness", "The darkness surrounds me like a blanket. It comforts me."],
            hearth_extinguished: ["Hearth extinguished", "The hearth is not burning. The flame's presence was comforting."],
            lost_part: ["{part} is gone", "A part of my body, gone forever..."],
            began: ["Initial optimism", "This is the beginning of something wonderful."],
            joined: ["Joined the tribe", "I've been accepted into {name}'s tribe"]
        }
    };

    function thoughtLine(id) {
        const row = TEXT.thought[id];
        return { label: row[0], quote: row[1] };
    }

    function def(id, rule) {
        return Object.assign({ id }, thoughtLine(id), rule);
    }

    /** A lost part stays on the mind for this many days, then fades. */
    const PART_DAYS = 15;
    /** Copies of one stacked thought a single settler keeps. */
    const STACK_MAX = 5;
    /** Each extra copy, and each extra settler, is worth this much of the last. */
    const STACK_RATIO = 0.75;

    function lostDef(id, offset) {
        const line = thoughtLine("lost_part");
        return {
            id,
            label: line.label,
            quote: line.quote,
            offset,
            duration: PART_DAYS * DAY,
            stackLimit: STACK_MAX
        };
    }

    const DEFS = {
        slept_hut: def("slept_hut", {
            offset: 1,
            duration: DAY,
            group: "sleep",
            nullifiedBy: ["austere"]
        }),
        slept_outdoors: def("slept_outdoors", {
            offset: -4,
            duration: DAY,
            group: "sleep",
            nullifiedBy: ["austere"]
        }),
        slept_stars: def("slept_stars", {
            offset: 3,
            duration: DAY,
            group: "sleep"
        }),
        ate_raw: def("ate_raw", {
            offset: -7,
            duration: DAY,
            refresh: true
        }),
        ate_human: def("ate_human", {
            offset: -15,
            duration: DAY,
            refresh: true,
            nullifiedBy: ["man_eater"]
        }),
        ate_cooked: def("ate_cooked", {
            offset: 3,
            duration: DAY,
            refresh: true
        }),
        witnessed_death: def("witnessed_death", {
            offset: -6,
            duration: 2 * DAY,
            stackLimit: STACK_MAX,
            nullifiedBy: ["man_eater", "murderous", "psychopath"]
        }),
        saw_corpse: def("saw_corpse", {
            offset: -4,
            duration: DAY,
            stackLimit: STACK_MAX,
            nullifiedBy: ["man_eater", "murderous", "psychopath"]
        }),
        lost_someone: def("lost_someone", {
            offset: -5,
            duration: 3 * DAY,
            stackLimit: STACK_MAX,
            nullifiedBy: ["murderous", "psychopath"]
        }),
        killed: def("killed", {
            offset: 8,
            duration: 2 * DAY,
            refresh: true
        }),
        let_it_out: def("let_it_out", {
            offset: 8,
            duration: DAY / 2,
            refresh: true
        }),
        darkness: def("darkness", { offset: -4 }),
        darkness_joy: def("darkness_joy", { offset: 3 }),
        hearth_extinguished: def("hearth_extinguished", { offset: -1 }),
        lost_small: lostDef("lost_small", -3),
        lost_mid: lostDef("lost_mid", -8),
        lost_major: lostDef("lost_major", -12),
        began: def("began", {
            offset: 10,
            duration: 10 * DAY,
            stackLimit: 1
        }),
        joined: def("joined", {
            offset: 5,
            duration: 5 * DAY,
            stackLimit: 1
        })
    };

    /** Brightness below this is dark enough to slow work. Matches the work-light curve. */
    const DARK_BELOW = 0.3;

    const FATAL_PARTS = { Brain: true, Heart: true, Torso: true, Head: true, Neck: true };

    /** baseId of a destroyed part, ignoring pieces that only vanished with a parent. */
    const PART_TIER = {
        Thumb: "lost_small",
        "Index Finger": "lost_small",
        "Middle Finger": "lost_small",
        "Ring Finger": "lost_small",
        "Pinky Finger": "lost_small",
        "Big Toe": "lost_small",
        "Second Toe": "lost_small",
        "Middle Toe": "lost_small",
        "Fourth Toe": "lost_small",
        "Little Toe": "lost_small",
        Ear: "lost_small",
        Nose: "lost_small",
        Eye: "lost_mid",
        Jaw: "lost_mid",
        Hand: "lost_mid",
        Foot: "lost_mid",
        Arm: "lost_major",
        Leg: "lost_major",
        Shoulder: "lost_major",
        Lung: "lost_major",
        Kidney: "lost_major"
    };

    /** Stage edges on the mood bar: miserable, unhappy, stressed, content, happy. */
    const MARKS = [0.05, 0.25, 0.35, 0.65, 0.9];

    const SULK_MIN = 3 * 60;
    const STRIKE_MIN = 8 * 60;
    const COOLDOWN_MIN = 6 * 60;
    const DRAIN_MIN = 6 * 60;
    const FILL = { stressed: 2 * DAY, unhappy: 12 * 60, miserable: 3 * 60 };
    /**
     * RimWorld moves the mood bar toward its target at +12 per in-game hour
     * when rising and −8 per hour when falling. An hour here is 60 minutes.
     */
    const RISE_PER_HOUR = 12;
    const FALL_PER_HOUR = 8;
    const RISE_PER_MIN = (RISE_PER_HOUR / 100) / 60;
    const FALL_PER_MIN = (FALL_PER_HOUR / 100) / 60;

    function clamp01(value, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(1, Math.max(0, n));
    }

    function hasTrait(pawn, id) {
        return Array.isArray(pawn?.bio?.traits) && pawn.bio.traits.includes(id);
    }

    function nullified(pawn, def) {
        const list = def?.nullifiedBy || [];
        for (let i = 0; i < list.length; i++) {
            if (hasTrait(pawn, list[i])) return true;
        }
        return false;
    }

    function blank() {
        return {
            memories: [],
            seen: [],
            lost: [],
            dark: null,
            hearthOut: false,
            lastKill: null,
            appeared: null,
            strain: 0,
            cooldownUntil: 0,
            episode: null,
            warned: false,
            lines: []
        };
    }

    function ensure(pawn) {
        if (!pawn) return null;
        if (!pawn.thoughts || typeof pawn.thoughts !== "object" || Array.isArray(pawn.thoughts)) {
            pawn.thoughts = blank();
        }
        const state = pawn.thoughts;
        const memories = Array.isArray(state.memories) ? state.memories : [];
        const kept = [];
        for (let i = 0; i < memories.length; i++) {
            const row = memories[i];
            if (!row || !DEFS[row.id]) continue;
            const expires = Math.floor(Number(row.expires));
            if (!Number.isFinite(expires)) continue;
            const keptRow = {
                id: row.id,
                label: typeof row.label === "string" && row.label ? row.label.slice(0, 48) : DEFS[row.id].label,
                expires
            };
            if (typeof row.part === "string" && row.part) keptRow.part = row.part.slice(0, 48);
            if (typeof row.name === "string" && row.name) keptRow.name = row.name.slice(0, 24);
            kept.push(keptRow);
        }
        state.memories = kept;
        const seen = Array.isArray(state.seen) ? state.seen : [];
        const seenKept = [];
        for (let i = 0; i < seen.length && seenKept.length < 64; i++) {
            if (typeof seen[i] === "string" && seen[i]) seenKept.push(seen[i].slice(0, 64));
        }
        state.seen = seenKept;
        const lost = Array.isArray(state.lost) ? state.lost : [];
        const lostKept = [];
        for (let i = 0; i < lost.length && lostKept.length < 48; i++) {
            if (typeof lost[i] === "string" && lost[i]) lostKept.push(lost[i].slice(0, 48));
        }
        state.lost = lostKept;
        state.dark = state.dark === "dark" || state.dark === "joy" ? state.dark : null;
        state.hearthOut = !!state.hearthOut;
        const lastKill = state.lastKill == null ? null : Number(state.lastKill);
        state.lastKill = lastKill != null && Number.isFinite(lastKill) ? lastKill : null;
        const appeared = state.appeared == null ? null : Number(state.appeared);
        state.appeared = appeared != null && Number.isFinite(appeared) ? appeared : null;
        state.strain = clamp01(state.strain, 0);
        const cool = Number(state.cooldownUntil);
        state.cooldownUntil = Number.isFinite(cool) ? cool : 0;
        if (state.episode && (state.episode.kind === "sulk" || state.episode.kind === "strike")) {
            const until = Number(state.episode.until);
            state.episode = Number.isFinite(until) ? { kind: state.episode.kind, until } : null;
        } else {
            state.episode = null;
        }
        state.warned = !!state.warned;
        if (!Array.isArray(state.lines)) state.lines = [];
        const moodAt = state.moodAt == null ? null : Number(state.moodAt);
        state.moodAt = moodAt != null && Number.isFinite(moodAt) ? moodAt : null;
        if (state.episode) pawn._moodJob = state.episode.kind;
        return state;
    }

    function toJSON(pawn) {
        const src = ensure(pawn);
        if (!src) return null;
        return {
            memories: src.memories.map((row) => ({
                id: row.id,
                label: row.label,
                expires: row.expires,
                part: row.part || null,
                name: row.name || null
            })),
            seen: src.seen.slice(),
            lost: src.lost.slice(),
            dark: src.dark,
            hearthOut: src.hearthOut,
            lastKill: src.lastKill,
            appeared: src.appeared,
            strain: src.strain,
            cooldownUntil: src.cooldownUntil,
            episode: src.episode ? { kind: src.episode.kind, until: src.episode.until } : null,
            warned: src.warned,
            moodAt: src.moodAt,
            lines: Array.isArray(src.lines) ? src.lines.map((row) => {
                const line = {
                    offset: row.offset,
                    label: row.label,
                    quote: row.quote,
                    count: row.count
                };
                const expires = Math.floor(Number(row.expires));
                if (Number.isFinite(expires)) line.expires = expires;
                return line;
            }) : []
        };
    }

    function apply(pawn, raw) {
        if (!pawn) return null;
        if (raw && typeof raw === "object") pawn.thoughts = raw;
        else if (!pawn.thoughts) pawn.thoughts = blank();
        return ensure(pawn);
    }

    function stage(mood) {
        const p = clamp01(mood, 0.5) * 100;
        if (p < 5) return "miserable";
        if (p < 25) return "unhappy";
        if (p < 35) return "stressed";
        if (p < 65) return "content";
        if (p < 90) return "happy";
        return "elated";
    }

    function dropExpired(state, now) {
        const t = Number(now) || 0;
        state.memories = state.memories.filter((row) => row.expires > t);
    }

    function dropNullified(pawn, state) {
        state.memories = state.memories.filter((row) => !nullified(pawn, DEFS[row.id]));
    }

    function rememberSeen(state, id) {
        if (!id) return;
        const key = String(id).slice(0, 64);
        if (!key || state.seen.includes(key)) return;
        state.seen.push(key);
        if (state.seen.length > 64) state.seen.splice(0, state.seen.length - 64);
    }

    function hasSeen(pawn, id) {
        const state = pawn?.thoughts;
        if (!state || !id) return false;
        return state.seen.includes(String(id));
    }

    function memoryRow(id, label, expires, extra) {
        const row = { id, label, expires };
        if (typeof extra?.name === "string" && extra.name) row.name = extra.name.slice(0, 24);
        return row;
    }

    function addMemory(pawn, id, now, label, extra) {
        const def = DEFS[id];
        if (!def || nullified(pawn, def)) return false;
        const state = ensure(pawn);
        const expires = (Number(now) || 0) + def.duration;
        const name = typeof label === "string" && label ? label.slice(0, 48) : def.label;
        if (def.group) {
            state.memories = state.memories.filter((row) => DEFS[row.id]?.group !== def.group);
        }
        if (def.refresh || def.stackLimit === 1) {
            state.memories = state.memories.filter((row) => row.id !== id || row.label !== name);
            state.memories.push(memoryRow(id, name, expires, extra));
            return true;
        }
        const same = state.memories.filter((row) => row.id === id);
        const limit = def.stackLimit || 1;
        if (same.length >= limit) {
            let oldest = same[0];
            for (let i = 1; i < same.length; i++) {
                if (same[i].expires < oldest.expires) oldest = same[i];
            }
            state.memories = state.memories.filter((row) => row !== oldest);
        }
        state.memories.push(memoryRow(id, name, expires, extra));
        return true;
    }

    /** First moment of a new main character. One copy, and it does not restart. */
    function noteBegan(pawn, now) {
        if (!pawn) return false;
        const state = ensure(pawn);
        if (state.memories.some((row) => row.id === "began")) return false;
        return addMemory(pawn, "began", now);
    }

    /** Accepted into the main character's tribe. The quote keeps that name. */
    function noteJoined(pawn, leaderName, now) {
        if (!pawn) return false;
        const name = String(leaderName || "").trim().slice(0, 24);
        if (!name) return false;
        ensure(pawn);
        return addMemory(pawn, "joined", now, null, { name });
    }

    function filledQuote(def, mem) {
        const quote = def?.quote || "";
        if (!quote.includes("{name}")) return quote;
        const name = typeof mem?.name === "string" && mem.name ? mem.name : "someone";
        return quote.replace("{name}", name);
    }

    function noteSleep(pawn, place, now) {
        if (!pawn) return;
        const state = ensure(pawn);
        if (hasTrait(pawn, "austere")) {
            if (place !== "hut") {
                addMemory(pawn, "slept_stars", now);
                return;
            }
            state.memories = state.memories.filter((row) => DEFS[row.id]?.group !== "sleep");
            return;
        }
        addMemory(pawn, place === "hut" ? "slept_hut" : "slept_outdoors", now);
    }

    function noteMeal(pawn, kind, now) {
        if (!pawn) return;
        ensure(pawn);
        if (kind === "human") {
            if (hasTrait(pawn, "man_eater")) return;
            addMemory(pawn, "ate_human", now);
            return;
        }
        if (kind === "raw") addMemory(pawn, "ate_raw", now);
        else if (kind === "cooked") addMemory(pawn, "ate_cooked", now);
    }

    function noteKill(pawn, now) {
        if (!pawn || !hasTrait(pawn, "murderous")) return;
        const state = ensure(pawn);
        state.lastKill = Number(now) || 0;
        if (state.appeared == null) state.appeared = state.lastKill;
        addMemory(pawn, "killed", now);
    }

    function witness(pawn, now) {
        if (!pawn) return false;
        ensure(pawn);
        return addMemory(pawn, "witnessed_death", now);
    }

    function seeCorpse(pawn, corpseId, now) {
        if (!pawn || !corpseId) return false;
        const state = ensure(pawn);
        if (state.seen.includes(String(corpseId))) return false;
        const ok = addMemory(pawn, "saw_corpse", now);
        rememberSeen(state, corpseId);
        return ok;
    }

    function markSeen(pawn, id) {
        if (!pawn || !id) return;
        rememberSeen(ensure(pawn), id);
    }

    function loseSomeone(pawn, name, now) {
        if (!pawn) return false;
        ensure(pawn);
        const label = name ? TEXT.namedDeath.replace("{name}", name) : TEXT.someoneDied;
        return addMemory(pawn, "lost_someone", now, label);
    }

    function hediff(pawn, id) {
        const body = pawn?.anatomy || pawn?.creature?.anatomy;
        if (!body || typeof body.hediff !== "function") return null;
        return body.hediff(id) || null;
    }

    function painOf(pawn) {
        const caps = pawn?.capacities || pawn?.creature?.capacities;
        if (!caps || typeof caps.pain !== "function") return 0;
        const n = Number(caps.pain());
        return Number.isFinite(n) ? n : 0;
    }

    /**
     * Same bands as a normal person, pulled forward by a wimp's lower pain threshold.
     * A tough person skips the mild band and still feels the worse ones.
     */
    function painCuts(pawn) {
        const scale = hasTrait(pawn, "wimp") ? 0.5 : 1;
        return {
            minor: 0.15 * scale,
            serious: 0.4 * scale,
            agony: 0.8 * scale,
            skipMinor: hasTrait(pawn, "tough")
        };
    }

    /** Malnutrition and food poisoning already have their own lines. */
    function isIllness(row) {
        if (!row || typeof row.id !== "string" || !row.id) return false;
        if (row.id === "malnutrition" || row.id === "food_poisoning") return false;
        if (row.id === "infection") return true;
        let def = null;
        try {
            const api = typeof Hediffs !== "undefined" ? Hediffs : null;
            if (api && typeof api.def === "function") def = api.def(null, row.id);
        } catch (_) { def = null; }
        return !!(def && (def.illness || def.isInfection));
    }

    function isSick(pawn) {
        const body = pawn?.anatomy || pawn?.creature?.anatomy;
        const list = body?.hediffs;
        if (!Array.isArray(list)) return false;
        for (let i = 0; i < list.length; i++) {
            if (isIllness(list[i])) return true;
        }
        return false;
    }

    function situational(pawn, now) {
        const rows = [];
        const push = (id, offset, lineId) => {
            const line = thoughtLine(lineId || id);
            rows.push({ id, offset, label: line.label, quote: line.quote, count: 1 });
        };
        const kc = Number(pawn?.kc) || 0;
        const stomach = Number(pawn?.stomach) > 0 ? Number(pawn.stomach) : 1600;
        const quarter = stomach * 0.25;
        if (kc <= 0) push("starving", -12);
        else if (kc < quarter) push("hungry", -6);
        else if (kc < PECKISH) push("peckish", -2);

        const mal = hediff(pawn, "malnutrition");
        const sev = Number(mal?.severity) || 0;
        if (mal && sev >= 0.8) push("malnutrition", -25, "malnutrition_extreme");
        else if (mal && sev >= 0.6) push("malnutrition", -15, "malnutrition_severe");
        else if (mal && sev >= 0.4) push("malnutrition", -8, "malnutrition_moderate");
        else if (mal && sev >= 0.2) push("malnutrition", -3, "malnutrition_minor");

        const rest = clamp01(pawn?.needs?.rest, 1);
        if (rest <= 0.01) push("exhausted", -12);
        else if (rest < 0.14) push("tired", -6);
        else if (rest < 0.28) push("drowsy", -3);

        const pain = painOf(pawn);
        const cuts = painCuts(pawn);
        if (pain >= cuts.agony) push("pain", -18, "pain_agony");
        else if (pain >= cuts.serious) push("pain", -10, "pain_serious");
        else if (!cuts.skipMinor && pain >= cuts.minor) push("pain", -5, "pain_minor");

        if (hediff(pawn, "food_poisoning")) push("food_poisoning", -8);
        if (isSick(pawn)) push("sick", -8);

        const moodDark = ensure(pawn).dark;
        if (moodDark === "joy") push("darkness_joy", DEFS.darkness_joy.offset);
        else if (moodDark === "dark") push("darkness", DEFS.darkness.offset);
        if (ensure(pawn).hearthOut) push("hearth_extinguished", DEFS.hearth_extinguished.offset);

        if (hasTrait(pawn, "murderous")) {
            const state = ensure(pawn);
            const t = Number(now) || 0;
            if (state.appeared == null) state.appeared = t;
            const since = state.lastKill == null ? state.appeared : state.lastKill;
            const dry = t - since;
            if (dry >= 8 * DAY) push("wants_kill", -12, "wants_kill_long");
            else if (dry >= 4 * DAY) push("wants_kill", -6);
        }
        return rows;
    }

    function partTier(part) {
        if (!part || !part.isDead?.() || part.isCutOff?.()) return null;
        const base = part.baseId || part.name;
        if (!base || FATAL_PARTS[base] || part.def?.fatal) return null;
        return PART_TIER[base] || null;
    }

    function lostLabel(name) {
        return thoughtLine("lost_part").label.replace("{part}", name);
    }

    /** Remember each destroyed part once. The memory fades, and a healed part can be lost again. */
    function noteLostParts(pawn, now) {
        const body = pawn?.anatomy || pawn?.creature?.anatomy;
        if (!body || typeof body.parts !== "function") return;
        const state = ensure(pawn);
        for (const part of Object.values(body.parts())) {
            const tier = partTier(part);
            if (!tier || !part.name) continue;
            if (state.lost.includes(part.name)) continue;
            const label = lostLabel(part.name);
            if (!addMemory(pawn, tier, now, label)) continue;
            const mem = state.memories[state.memories.length - 1];
            if (mem && mem.label === label) mem.part = part.name;
            if (!state.lost.includes(part.name)) state.lost.push(part.name);
        }
        const still = [];
        for (let i = 0; i < state.lost.length; i++) {
            const name = state.lost[i];
            const part = typeof body.part === "function" ? body.part(name) : null;
            if (!part || (part.isDead?.() && !part.isCutOff?.())) {
                still.push(name);
                continue;
            }
            const label = lostLabel(name);
            state.memories = state.memories.filter((row) => row.part !== name && row.label !== label);
        }
        state.lost = still;
    }

    function groupedMemories(pawn, state) {
        const rows = [];
        for (let i = 0; i < state.memories.length; i++) {
            const mem = state.memories[i];
            const def = DEFS[mem.id];
            if (!def || nullified(pawn, def)) continue;
            rows.push({
                id: mem.id,
                label: mem.label || def.label,
                quote: filledQuote(def, mem),
                offset: def.offset,
                expires: mem.expires
            });
        }
        return rows;
    }

    function moodletTotal(p, n) {
        const base = Number(p) || 0;
        const count = Math.max(0, Math.floor(Number(n) || 0));
        if (!count || !base) return 0;
        return base * (1 - Math.pow(STACK_RATIO, count)) / (1 - STACK_RATIO);
    }

    /** A fraction counts as a whole point in the direction of the thought. */
    function shownOffset(n) {
        if (!Number.isFinite(n) || n === 0) return 0;
        const nearest = Math.round(n);
        if (Math.abs(n - nearest) < 1e-9) return nearest;
        return n > 0 ? Math.ceil(n) : Math.floor(n);
    }

    function formatTotal(n) {
        if (!Number.isFinite(n)) return "0";
        return String(Math.round(n * 10000) / 10000);
    }

    /** Same base uses the closed series. Mixed offsets diminish from the strongest. */
    function stackedEffect(offsets) {
        const rows = [];
        for (let i = 0; i < offsets.length; i++) {
            const n = Number(offsets[i]) || 0;
            if (n) rows.push(n);
        }
        if (!rows.length) return { p: 0, n: 0, t: 0 };
        let same = true;
        for (let i = 1; i < rows.length; i++) {
            if (rows[i] !== rows[0]) { same = false; break; }
        }
        if (same) return { p: rows[0], n: rows.length, t: moodletTotal(rows[0], rows.length) };
        rows.sort((a, b) => Math.abs(b) - Math.abs(a) || a - b);
        let t = 0;
        for (let i = 0; i < rows.length; i++) t += rows[i] * Math.pow(STACK_RATIO, i);
        return { p: rows[0], n: rows.length, t };
    }

    function summary(pawns) {
        const people = Array.isArray(pawns) ? pawns.filter(Boolean) : [];
        let sum = 0;
        const byLabel = new Map();
        for (let i = 0; i < people.length; i++) {
            const pawn = people[i];
            sum += moodOf(pawn);
            const lines = pawn.thoughts?.lines || [];
            const seen = new Set();
            for (let j = 0; j < lines.length; j++) {
                const row = lines[j];
                const offset = Number(row.offset) || 0;
                if (offset >= 0) continue;
                const label = row.label || "";
                if (!label || seen.has(label)) continue;
                seen.add(label);
                let bucket = byLabel.get(label);
                if (!bucket) {
                    bucket = { label, offsets: [] };
                    byLabel.set(label, bucket);
                }
                bucket.offsets.push(offset);
            }
        }
        const complaints = [];
        for (const bucket of byLabel.values()) {
            const scored = stackedEffect(bucket.offsets);
            complaints.push({
                label: bucket.label,
                p: scored.p,
                n: scored.n,
                t: scored.t
            });
        }
        complaints.sort((a, b) => a.t - b.t || String(a.label).localeCompare(String(b.label)));
        const mood = people.length ? sum / people.length : null;
        let pct = null;
        let word = null;
        if (mood != null) {
            pct = Math.max(0, Math.min(100, Math.round(mood * 100)));
            word = stage(pct / 100);
        }
        return {
            count: people.length,
            mood,
            pct,
            stage: word,
            complaints: complaints.slice(0, 4)
        };
    }

    function settlementTip(pawns, debug) {
        const board = summary(pawns);
        if (!board.count) return [TEXT.tip.none, TEXT.tip.warning].join("\n");
        const mark = stageMark(board.stage);
        const lines = [
            `${TEXT.tip.average}: {${mark}}${board.pct}% (${TEXT.stage[board.stage]}){/${mark}}`,
            TEXT.tip.settlers,
            TEXT.tip.warning
        ];
        if (board.complaints.length) {
            lines.push("");
            lines.push(`{g}${TEXT.tip.complaints}{/g}`);
            for (let i = 0; i < board.complaints.length; i++) {
                const row = board.complaints[i];
                const body = debug
                    ? `${row.label}  P=${row.p} N=${row.n} T=${formatTotal(row.t)}`
                    : row.label;
                lines.push(`{n}${body}{/n}`);
            }
        }
        return lines.join("\n");
    }

    function groupLines(rows) {
        const groups = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const key = `${row.id}\0${row.label}`;
            let found = null;
            for (let g = 0; g < groups.length; g++) {
                if (groups[g].key === key) { found = groups[g]; break; }
            }
            if (!found) {
                found = {
                    key,
                    base: Number(row.offset) || 0,
                    label: row.label,
                    quote: row.quote,
                    count: 0,
                    expires: null
                };
                groups.push(found);
            }
            found.count += 1;
            const exp = Number(row.expires);
            if (Number.isFinite(exp)) {
                found.expires = found.expires == null ? exp : Math.min(found.expires, exp);
            }
        }
        const lines = groups.map((g) => {
            const line = {
                offset: shownOffset(moodletTotal(g.base, g.count)),
                label: g.label,
                quote: g.quote,
                count: g.count
            };
            if (g.expires != null) line.expires = g.expires;
            return line;
        });
        lines.sort((a, b) => b.offset - a.offset || String(a.label).localeCompare(String(b.label)));
        return lines;
    }

    function sumLines(lines) {
        let n = 0;
        for (let i = 0; i < lines.length; i++) n += Number(lines[i].offset) || 0;
        return n;
    }

    function refresh(pawn, now) {
        if (!pawn) return null;
        const state = ensure(pawn);
        const t = Number(now) || 0;
        dropExpired(state, t);
        dropNullified(pawn, state);
        noteLostParts(pawn, t);
        if (hasTrait(pawn, "murderous") && state.appeared == null) state.appeared = t;
        const rows = groupedMemories(pawn, state).concat(situational(pawn, t));
        state.lines = groupLines(rows);
        if (!pawn.needs || typeof pawn.needs !== "object") pawn.needs = {};
        const target = clamp01(0.5 + sumLines(state.lines) / 100, 0.5);
        pawn.needs.moodTarget = target;
        // A new pawn starts on the target. After that the bar only eases toward it.
        if (state.moodAt == null) {
            pawn.needs.mood = target;
            state.moodAt = t;
        }
        if (state.episode && state.episode.until > t) pawn._moodJob = state.episode.kind;
        else pawn._moodJob = null;
        state.viewAt = t;
        return state;
    }

    function tick(pawn, now, opts = {}) {
        const primed = ensure(pawn);
        if (primed && Object.prototype.hasOwnProperty.call(opts, "dark")) {
            primed.dark = opts.dark === "joy" || opts.dark === "dark" ? opts.dark : null;
        }
        if (primed && Object.prototype.hasOwnProperty.call(opts, "hearthOut")) {
            primed.hearthOut = !!opts.hearthOut;
        }
        const state = refresh(pawn, now);
        const logs = [];
        let abandon = false;
        let started = null;
        if (!state) return { logs, abandon, started };
        const t = Number(now) || 0;
        if (state.episode && state.episode.until <= t) state.episode = null;
        driftMood(pawn, state, t, opts);
        const paused = !!(opts.asleep || opts.downed || !opts.eligible);
        const band = stage(pawn.needs.mood);
        if (!paused) {
            const miserable = band === "miserable";
            const blocked = state.cooldownUntil > t || !!state.episode;
            const low = band === "stressed" || band === "unhappy" || miserable;
            if (!low) {
                state.strain = Math.max(0, state.strain - 1 / DRAIN_MIN);
                if (state.strain < 0.5) state.warned = false;
            } else if (miserable || !blocked) {
                const span = FILL[band] || FILL.stressed;
                const before = state.strain;
                state.strain = Math.min(1, state.strain + 1 / span);
                if (
                    !state.warned
                    && before < 0.5
                    && state.strain >= 0.5
                    && (band === "unhappy" || miserable)
                ) {
                    state.warned = true;
                    logs.push("thinking");
                }
                if (state.strain >= 1 - 1e-12) {
                    state.strain = 0;
                    state.warned = false;
                    if (miserable) {
                        state.episode = null;
                        abandon = true;
                    } else if (band === "unhappy") {
                        state.episode = { kind: "strike", until: t + STRIKE_MIN };
                        state.cooldownUntil = state.episode.until + COOLDOWN_MIN;
                        addMemory(pawn, "let_it_out", t);
                        started = "strike";
                        logs.push("strike");
                    } else {
                        state.episode = { kind: "sulk", until: t + SULK_MIN };
                        state.cooldownUntil = state.episode.until + COOLDOWN_MIN;
                        addMemory(pawn, "let_it_out", t);
                        started = "sulk";
                        logs.push("sulk");
                    }
                    refresh(pawn, t);
                }
            }
        }
        if (state.episode && state.episode.until > t) pawn._moodJob = state.episode.kind;
        else pawn._moodJob = null;
        return { logs, abandon, started };
    }

    function moodOf(pawn) {
        return clamp01(pawn?.needs?.mood, 0.5);
    }

    /** Instant thought total, on the same 0–1 scale as the bar. */
    function targetOf(pawn) {
        if (pawn?.thoughts && Array.isArray(pawn.thoughts.lines)) {
            return clamp01(0.5 + sumLines(pawn.thoughts.lines) / 100, 0.5);
        }
        if (pawn?.needs && pawn.needs.moodTarget != null) return clamp01(pawn.needs.moodTarget, 0.5);
        return moodOf(pawn);
    }

    /**
     * Move the bar toward the target. Asleep or downed pawns hold still, and
     * the missed time is not applied when they wake.
     */
    function driftMood(pawn, state, t, opts) {
        if (!pawn?.needs) return;
        const target = clamp01(pawn.needs.moodTarget, 0.5);
        const prev = state.moodAt;
        if (prev == null || !Number.isFinite(prev)) {
            pawn.needs.mood = target;
            state.moodAt = t;
            return;
        }
        const dt = t - prev;
        state.moodAt = t;
        if (!(dt > 0) || opts.asleep || opts.downed) return;
        const current = clamp01(pawn.needs.mood, target);
        if (current < target) pawn.needs.mood = Math.min(target, current + RISE_PER_MIN * dt);
        else if (current > target) pawn.needs.mood = Math.max(target, current - FALL_PER_MIN * dt);
    }

    /** Header tint for the mood percent. Bonuses and penalties use their own marks. */
    function stageMark(word) {
        if (word === "happy" || word === "elated") return "p";
        if (word === "stressed") return "o";
        if (word === "unhappy" || word === "miserable") return "n";
        return "g";
    }

    /** Hours left, matching spoil tips: "3d 23h", "2h", or "<1h". */
    function formatRemain(minutes) {
        const h = Math.max(0, Math.floor((Number(minutes) || 0) / 60));
        if (h === 0) return "<1h";
        const d = Math.floor(h / 24);
        const remH = h % 24;
        if (d > 0) return remH ? `${d}d ${remH}h` : `${d}d`;
        return `${h}h`;
    }

    /** Last time the list was rebuilt, or the mood clock after a load. */
    function clockOf(pawn) {
        const state = pawn?.thoughts;
        const view = Number(state?.viewAt);
        if (Number.isFinite(view)) return view;
        const at = Number(state?.moodAt);
        return Number.isFinite(at) ? at : null;
    }

    /** Blue clock for a memory. A stack shows the next copy to fade. Conditions have none. */
    function remainMark(pawn, expires) {
        const exp = Number(expires);
        const now = clockOf(pawn);
        if (!Number.isFinite(exp) || now == null) return "";
        const left = exp - now;
        if (!(left > 0)) return "";
        return ` {b}(${formatRemain(left)}){/b}`;
    }

    function tooltip(pawn) {
        const mood = moodOf(pawn);
        const pct = Math.round(mood * 100);
        const word = stage(mood);
        const mark = stageMark(word);
        const lines = [
            `${TEXT.tip.title}: {${mark}}${pct}% (${TEXT.stage[word]}){/${mark}}`,
            TEXT.tip.feeling,
            TEXT.tip.warning
        ];
        const targetPct = Math.round(targetOf(pawn) * 100);
        if (targetPct !== pct) lines.splice(1, 0, `${TEXT.tip.target}: ${targetPct}%`);
        const rows = pawn?.thoughts?.lines || [];
        if (rows.length) lines.push("");
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const n = Number(row.offset) || 0;
            const num = n > 0 ? `+${n}` : String(n);
            const stack = row.count > 1 ? ` x${row.count}` : "";
            const offset = n > 0 ? `{p}${num}{/p}` : (n < 0 ? `{n}${num}{/n}` : num);
            const clock = remainMark(pawn, row.expires);
            lines.push(`${offset} ${row.label}${stack}${clock}`);
            if (row.quote) lines.push(`{m}"${row.quote}"{/m}`);
        }
        return lines.join("\n");
    }

    function sig(pawn) {
        const rows = pawn?.thoughts?.lines || [];
        const now = clockOf(pawn);
        const parts = [Math.round(moodOf(pawn) * 1000)];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            parts.push(row.offset, row.count, row.label);
            const exp = Number(row.expires);
            if (Number.isFinite(exp) && Number.isFinite(now)) {
                parts.push(Math.floor(Math.max(0, exp - now) / 60));
            }
        }
        const job = pawn?._moodJob || "";
        parts.push(job);
        return parts.join("|");
    }

    /** Sulk still eats, sleeps, doctors, and rescues. Strike keeps sleep, and food only at an empty stomach. */
    function allowsWork(pawn, kind) {
        const mode = pawn?._moodJob;
        if (mode !== "sulk" && mode !== "strike") return true;
        if (kind === "sleep" || kind === "idle" || kind === "fight") return true;
        if (kind === "eat") {
            if (mode !== "strike") return true;
            return !(Number(pawn?.kc) > 0);
        }
        if (mode === "sulk" && (kind === "doctor" || kind === "rescue" || kind === "tend")) return true;
        return false;
    }

    return {
        DAY,
        DARK_BELOW,
        MARKS,
        PECKISH,
        DEFS,
        SULK_MIN,
        STRIKE_MIN,
        COOLDOWN_MIN,
        FILL,
        RISE_PER_HOUR,
        FALL_PER_HOUR,
        ensure,
        toJSON,
        apply,
        stage,
        hasSeen,
        noteSleep,
        noteMeal,
        noteBegan,
        noteJoined,
        noteKill,
        witness,
        seeCorpse,
        markSeen,
        loseSomeone,
        refresh,
        tick,
        moodOf,
        targetOf,
        tooltip,
        sig,
        allowsWork,
        hasTrait,
        moodletTotal,
        shownOffset,
        summary,
        settlementTip,
        stageMark
    };
});
