/**
 * Simulation identity. Copies an explicit allowlist into simDocument.
 * Does not enumerate a live def with Object.keys and then drop cosmetic fields.
 * _source and _textureUrl are never read.
 * Node + browser UMD. scripts are raw-byte SHA-256 entries.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.ModHash = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const RECIPE_SPECIAL = {
        REQUIRE_THING: true,
        REQUIRE_STATION: true,
        REQUIRE_TOOL: true,
        ANY_HIDE: true,
        QUANTITY: true
    };

    function failNonFinite() {
        throw new Error("simDocument: non-finite number");
    }

    function scalar(value) {
        if (value == null) return value;
        const t = typeof value;
        if (t === "number") {
            if (!Number.isFinite(value)) failNonFinite();
            return value;
        }
        if (t === "string" || t === "boolean") return value;
        return undefined;
    }

    function has(obj, key) {
        return !!obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
    }

    function take(obj, key) {
        if (!has(obj, key)) return undefined;
        return scalar(obj[key]);
    }

    function list(value) {
        if (!Array.isArray(value)) return undefined;
        return value.map((entry) => {
            if (Array.isArray(entry)) return list(entry);
            const copied = scalar(entry);
            if (copied === undefined && entry != null && typeof entry === "object") {
                throw new Error("simDocument: unexpected object in list");
            }
            return copied;
        });
    }

    function put(out, key, value) {
        if (value !== undefined) out[key] = value;
    }

    function pick(obj, keys) {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
        const out = {};
        for (const key of keys) put(out, key, take(obj, key));
        return Object.keys(out).length ? out : undefined;
    }

    function pickList(obj, key) {
        if (!has(obj, key)) return undefined;
        return list(obj[key]);
    }

    function numberMap(obj) {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
        const out = {};
        for (const key of Object.keys(obj)) {
            if (obj[key] === undefined) continue;
            const copied = scalar(obj[key]);
            if (copied === undefined) continue;
            out[key] = copied;
        }
        return Object.keys(out).length ? out : undefined;
    }

    function copyRecipe(recipe) {
        if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return undefined;
        const out = {};
        for (const key of Object.keys(recipe)) {
            if (!RECIPE_SPECIAL[key] && /^[A-Z0-9_]+$/.test(key)) continue;
            if (key === "REQUIRE_TOOL") {
                const tool = recipe.REQUIRE_TOOL;
                const copied = tool && typeof tool === "object"
                    ? {
                        ...(has(tool, "id") ? { id: scalar(tool.id) } : {}),
                        ...(has(tool, "class") ? { class: scalar(tool.class) } : {}),
                        ...(has(tool, "toolClass") ? { toolClass: Array.isArray(tool.toolClass) ? list(tool.toolClass) : scalar(tool.toolClass) } : {}),
                        ...(has(tool, "wear") ? { wear: scalar(tool.wear) } : {})
                    }
                    : undefined;
                if (copied && Object.keys(copied).length) out.REQUIRE_TOOL = copied;
                continue;
            }
            if (key === "ANY_HIDE") {
                const hide = pick(recipe.ANY_HIDE, ["qty", "hideStage"]);
                if (hide) out.ANY_HIDE = hide;
                continue;
            }
            const copied = scalar(recipe[key]);
            if (copied !== undefined) out[key] = copied;
        }
        return Object.keys(out).length ? out : undefined;
    }

    function copyCook(cook) {
        if (!cook || typeof cook !== "object" || Array.isArray(cook)) return undefined;
        const keys = Object.keys(cook);
        const short = keys.every((key) => key === "method" || key === "temp");
        if (short) return pick(cook, ["method", "temp"]);
        const out = {};
        for (const name of keys) {
            const row = cook[name];
            if (!row || typeof row !== "object" || Array.isArray(row)) continue;
            const copied = pick(row, ["result", "minutes", "temp"]);
            if (copied) out[name] = copied;
        }
        return Object.keys(out).length ? out : undefined;
    }

    function copyWeapon(weapon) {
        if (!weapon || typeof weapon !== "object") return undefined;
        const out = {};
        put(out, "type", take(weapon, "type"));
        put(out, "range", take(weapon, "range"));
        put(out, "hitStart", take(weapon, "hitStart"));
        put(out, "hitEnd", take(weapon, "hitEnd"));
        if (Array.isArray(weapon.attacks)) {
            out.attacks = weapon.attacks.map((atk) => pick(atk, [
                "id", "name", "damage", "type", "verb", "cooldown",
                "weightMultiplier", "source", "unarmed", "range"
            ]) || {});
        }
        return Object.keys(out).length ? out : undefined;
    }

    function copyEquip(equip) {
        if (!equip || typeof equip !== "object") return undefined;
        const out = {};
        put(out, "slot", take(equip, "slot"));
        put(out, "layer", take(equip, "layer"));
        if (equip.effects && typeof equip.effects === "object") {
            const effects = {};
            put(effects, "strength", take(equip.effects, "strength"));
            put(effects, "speed", take(equip.effects, "speed"));
            const slots = pickList(equip.effects, "addSlot");
            if (slots) effects.addSlot = slots;
            if (Object.keys(effects).length) out.effects = effects;
        }
        return Object.keys(out).length ? out : undefined;
    }

    function copyItem(item) {
        const out = {};
        put(out, "id", take(item, "id"));
        put(out, "name", take(item, "name"));
        put(out, "maxStack", take(item, "maxStack"));
        put(out, "weight", take(item, "weight"));
        put(out, "durability", take(item, "durability"));
        put(out, "use", take(item, "use"));
        put(out, "pigment", take(item, "pigment"));
        put(out, "fillColor", take(item, "fillColor"));
        put(out, "beauty", take(item, "beauty"));
        put(out, "fuel", pick(item.fuel, ["kj", "temp"]));
        put(out, "food", pick(item.food, ["kc", "spoil", "eatSeconds", "satietyRatio", "foodPoisonChance", "autoEat"]));
        put(out, "cook", copyCook(item.cook));
        put(out, "recipe", copyRecipe(item.recipe));
        put(out, "weapon", copyWeapon(item.weapon));
        put(out, "equip", copyEquip(item.equip));
        put(out, "place", pick(item.place, ["thing"]));
        put(out, "bandage", pick(item.bandage, ["tendQuality", "tendQualityMax", "channelSeconds", "batchSeverity"]));
        put(out, "knapping", pick(item.knapping, ["material"]));
        put(out, "hide", pick(item.hide, ["animal", "stage"]));
        return out;
    }

    function copyThing(thing) {
        const out = {};
        put(out, "id", take(thing, "id"));
        put(out, "name", take(thing, "name"));
        put(out, "hitboxSize", take(thing, "hitboxSize"));
        put(out, "hitbox", pickList(thing, "hitbox"));
        put(out, "lootable", pick(thing.lootable, ["item", "yield", "transform", "regrowMinutes"]));
        put(out, "choppable", pick(thing.choppable, ["stump"]));
        put(out, "diggable", pick(thing.diggable, ["item", "yield"]));
        put(out, "campfire", take(thing, "campfire"));
        put(out, "lit", take(thing, "lit"));
        put(out, "lightLevel", take(thing, "lightLevel"));
        put(out, "lightKind", take(thing, "lightKind"));
        put(out, "storage", pick(thing.storage, ["slots", "accept", "maxPerSlot"]));
        put(out, "dryingRack", take(thing, "dryingRack"));
        put(out, "craftStation", take(thing, "craftStation"));
        put(out, "interactOffset", pickList(thing, "interactOffset"));
        put(out, "rotations", pickList(thing, "rotations"));
        put(out, "sleep", pick(thing.sleep, ["slots"]));
        put(out, "footprint", pickList(thing, "footprint"));
        put(out, "settlement", take(thing, "settlement"));
        put(out, "paintingCircle", take(thing, "paintingCircle"));
        put(out, "figurine", take(thing, "figurine"));
        return out;
    }

    function copyTech(tech) {
        const out = {};
        put(out, "id", take(tech, "id"));
        put(out, "name", take(tech, "name"));
        put(out, "cost", take(tech, "cost"));
        put(out, "era", take(tech, "era"));
        put(out, "startUnlocked", take(tech, "startUnlocked"));
        put(out, "wip", take(tech, "wip"));
        put(out, "prereqs", pickList(tech, "prereqs"));
        put(out, "children", pickList(tech, "children"));
        if (tech.unlocks && typeof tech.unlocks === "object") {
            const unlocks = {};
            const items = pickList(tech.unlocks, "items");
            const jobs = pickList(tech.unlocks, "jobs");
            const bills = pickList(tech.unlocks, "bills");
            if (items) unlocks.items = items;
            if (jobs) unlocks.jobs = jobs;
            if (bills) unlocks.bills = bills;
            if (Object.keys(unlocks).length) out.unlocks = unlocks;
        }
        return out;
    }

    function copyMob(mob) {
        const out = {};
        put(out, "id", take(mob, "id"));
        put(out, "name", take(mob, "name"));
        put(out, "bodyPlan", take(mob, "bodyPlan"));
        put(out, "speed", take(mob, "speed"));
        put(out, "wanderSpeed", take(mob, "wanderSpeed"));
        put(out, "hitboxSize", take(mob, "hitboxSize"));
        put(out, "ai", take(mob, "ai"));
        put(out, "anim", pick(mob.anim, ["frameWidth", "frameHeight"]));
        if (Array.isArray(mob.attacks)) out.attacks = list(mob.attacks) || [];
        if (Array.isArray(mob.drops)) {
            out.drops = mob.drops.map((drop) => pick(drop, ["item", "min", "max", "quantity"]) || {});
        }
        put(out, "spawn", spawnOf(mob.spawn));
        return out;
    }

    function spawnOf(spawn) {
        if (!spawn || typeof spawn !== "object") return undefined;
        const out = {};
        put(out, "tiles", pickList(spawn, "tiles"));
        put(out, "chunkChance", take(spawn, "chunkChance"));
        put(out, "packMin", take(spawn, "packMin"));
        put(out, "packMax", take(spawn, "packMax"));
        put(out, "packRadius", take(spawn, "packRadius"));
        put(out, "minCandidates", take(spawn, "minCandidates"));
        return Object.keys(out).length ? out : undefined;
    }

    function copyPart(part) {
        const out = {};
        put(out, "mhp", take(part, "mhp"));
        put(out, "coverage", take(part, "coverage"));
        put(out, "internal", take(part, "internal"));
        put(out, "delicate", take(part, "delicate"));
        put(out, "alwaysScar", take(part, "alwaysScar"));
        put(out, "bleedMult", take(part, "bleedMult"));
        put(out, "fatal", take(part, "fatal"));
        put(out, "attacks", pickList(part, "attacks"));
        put(out, "children", pickList(part, "children"));
        put(out, "pairChildren", pickList(part, "pairChildren"));
        return out;
    }

    function copyAttack(atk) {
        return pick(atk, [
            "name", "damage", "type", "verb", "cooldown", "weightMultiplier", "range", "injury"
        ]) || {};
    }

    function copyBodyPlan(plan) {
        const out = {};
        put(out, "id", take(plan, "id"));
        put(out, "name", take(plan, "name"));
        put(out, "healRate", take(plan, "healRate"));
        put(out, "painShockThreshold", take(plan, "painShockThreshold"));
        put(out, "healthScale", take(plan, "healthScale"));
        put(out, "core", take(plan, "core"));
        put(out, "fatalParts", pickList(plan, "fatalParts"));
        if (plan.parts && typeof plan.parts === "object") {
            const parts = {};
            for (const name of Object.keys(plan.parts)) {
                const part = plan.parts[name];
                if (!part || typeof part !== "object") continue;
                parts[name] = copyPart(part);
            }
            out.parts = parts;
        }
        if (plan.unarmedAttacks && typeof plan.unarmedAttacks === "object") {
            const attacks = {};
            for (const name of Object.keys(plan.unarmedAttacks)) {
                const atk = plan.unarmedAttacks[name];
                if (!atk || typeof atk !== "object") continue;
                attacks[name] = copyAttack(atk);
            }
            out.unarmedAttacks = attacks;
        }
        return out;
    }

    function copyInjury(injury) {
        const out = {};
        put(out, "id", take(injury, "id"));
        put(out, "name", take(injury, "name"));
        put(out, "type", take(injury, "type"));
        put(out, "painPerSeverity", take(injury, "painPerSeverity"));
        put(out, "bleedRate", take(injury, "bleedRate"));
        put(out, "canScar", take(injury, "canScar"));
        put(out, "delicate", take(injury, "delicate"));
        put(out, "alwaysScar", take(injury, "alwaysScar"));
        put(out, "infectionChance", take(injury, "infectionChance"));
        return out;
    }

    function copyStage(stage) {
        const out = {};
        put(out, "minSeverity", take(stage, "minSeverity"));
        put(out, "painOffset", take(stage, "painOffset"));
        put(out, "capacityFactors", numberMap(stage.capacityFactors));
        put(out, "capacityOffsets", numberMap(stage.capacityOffsets));
        put(out, "capacityMax", numberMap(stage.capacityMax));
        put(out, "vomitMtbDays", take(stage, "vomitMtbDays"));
        put(out, "lifeThreatening", take(stage, "lifeThreatening"));
        return out;
    }

    function copyHediff(hediff) {
        const out = {};
        put(out, "id", take(hediff, "id"));
        put(out, "name", take(hediff, "name"));
        put(out, "initialSeverity", take(hediff, "initialSeverity"));
        put(out, "severityPerDay", take(hediff, "severityPerDay"));
        put(out, "lethalSeverity", take(hediff, "lethalSeverity"));
        put(out, "local", take(hediff, "local"));
        put(out, "isInfection", take(hediff, "isInfection"));
        put(out, "tendable", take(hediff, "tendable"));
        put(out, "baseTendDurationHours", take(hediff, "baseTendDurationHours"));
        put(out, "severityPerDayNotImmune", take(hediff, "severityPerDayNotImmune"));
        put(out, "severityPerDayTended", take(hediff, "severityPerDayTended"));
        put(out, "immunityPerDaySick", take(hediff, "immunityPerDaySick"));
        put(out, "severityPerDayImmune", take(hediff, "severityPerDayImmune"));
        put(out, "immunityPerDayNotSick", take(hediff, "immunityPerDayNotSick"));
        if (Array.isArray(hediff.stages)) {
            out.stages = hediff.stages.map((stage) => copyStage(stage || {}));
        }
        return out;
    }

    function copyPiece(piece) {
        const out = {};
        put(out, "id", take(piece, "id"));
        put(out, "kind", take(piece, "kind"));
        put(out, "dx", take(piece, "dx"));
        put(out, "dy", take(piece, "dy"));
        put(out, "rot", take(piece, "rot"));
        put(out, "footprint", pickList(piece, "footprint"));
        put(out, "loot", take(piece, "loot"));
        put(out, "chance", take(piece, "chance"));
        return out;
    }

    function copyStructureType(row) {
        const out = {};
        put(out, "id", take(row, "id"));
        put(out, "salt", take(row, "salt"));
        put(out, "cellChunks", take(row, "cellChunks"));
        put(out, "attemptChance", take(row, "attemptChance"));
        put(out, "innerChebyshev", take(row, "innerChebyshev"));
        put(out, "pad", take(row, "pad"));
        const pieces = row.template?.pieces;
        if (Array.isArray(pieces)) {
            out.template = { pieces: pieces.map((piece) => copyPiece(piece || {})) };
        }
        return out;
    }

    function copyLootTable(table) {
        const out = {};
        if (Array.isArray(table?.stackCount)) {
            out.stackCount = table.stackCount.map((row) => pick(row, ["n", "weight"]) || {});
        }
        if (Array.isArray(table?.junk)) {
            out.junk = table.junk.map((row) => pick(row, ["id", "weight", "min", "max"]) || {});
        }
        if (Array.isArray(table?.weapons)) {
            out.weapons = table.weapons.map((row) => {
                const copied = pick(row, ["id", "chance", "durability"]) || {};
                const frac = pickList(row, "durabilityFrac");
                if (frac) copied.durabilityFrac = frac;
                return copied;
            });
        }
        return out;
    }

    function copyStructures(structures) {
        const types = Array.isArray(structures?.types) ? structures.types : [];
        const tables = structures?.lootTables && typeof structures.lootTables === "object"
            ? structures.lootTables
            : {};
        const lootTables = {};
        for (const key of Object.keys(tables)) {
            if (!tables[key] || typeof tables[key] !== "object") continue;
            lootTables[key] = copyLootTable(tables[key]);
        }
        return {
            types: byId(types).map(copyStructureType),
            lootTables
        };
    }

    function copyScatter(row) {
        const out = {};
        put(out, "id", take(row, "id"));
        put(out, "tiles", pickList(row, "tiles"));
        put(out, "thingId", take(row, "thingId"));
        put(out, "chance", take(row, "chance"));
        put(out, "salt", take(row, "salt"));
        return out;
    }

    function byId(list) {
        return (Array.isArray(list) ? list : [])
            .filter((row) => row && typeof row === "object" && !Array.isArray(row) && row.id)
            .slice()
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    function mapOf(table, copy) {
        const out = {};
        if (!table || typeof table !== "object") return out;
        for (const key of Object.keys(table)) {
            const row = table[key];
            if (!row || typeof row !== "object" || Array.isArray(row)) continue;
            out[key] = copy(row);
        }
        return out;
    }

    function copyMods(mods) {
        return (Array.isArray(mods) ? mods : [])
            .filter((row) => row && row.id)
            .map((row) => ({ id: String(row.id), version: String(row.version == null ? "" : row.version) }))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    function copyScripts(scripts) {
        return (Array.isArray(scripts) ? scripts : [])
            .filter((row) => row && row.modId && row.sha256)
            .map((row) => ({ modId: String(row.modId), sha256: String(row.sha256) }))
            .sort((a, b) => (a.modId < b.modId ? -1 : a.modId > b.modId ? 1 : 0));
    }

    function simDocument(source) {
        const src = source || {};
        return {
            v: 1,
            mods: copyMods(src.mods),
            items: byId(src.items).map(copyItem),
            things: byId(src.things).map(copyThing),
            techs: byId(src.techs).map(copyTech),
            mobs: byId(src.mobs).map(copyMob),
            bodyPlans: mapOf(src.bodyPlans, copyBodyPlan),
            injuries: mapOf(src.injuries, copyInjury),
            hediffs: mapOf(src.hediffs, copyHediff),
            structures: copyStructures(src.structures),
            scatters: byId(src.scatters).map(copyScatter),
            scripts: copyScripts(src.scripts)
        };
    }

    function canonicalString(value) {
        if (value === null) return "null";
        if (Array.isArray(value)) {
            return "[" + value.map(canonicalString).join(",") + "]";
        }
        const t = typeof value;
        if (t === "number") {
            if (!Number.isFinite(value)) failNonFinite();
            return JSON.stringify(value);
        }
        if (t === "string" || t === "boolean") return JSON.stringify(value);
        if (t !== "object") throw new Error("simDocument: unsupported value");
        const keys = Object.keys(value).sort();
        return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalString(value[key])).join(",") + "}";
    }

    function nodeCrypto() {
        if (typeof process !== "undefined" && process.versions?.node && typeof require === "function") {
            return require("crypto");
        }
        return null;
    }

    function rotr(n, x) {
        return (x >>> n) | (x << (32 - n));
    }

    /** Sync SHA-256. The browser has no `require("crypto")`; world saves hash content on this path. */
    function sha256BytesSync(bytes) {
        const K = new Uint32Array([
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ]);
        const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const bitLen = src.length * 8;
        const paddedLen = ((src.length + 9 + 63) >> 6) << 6;
        const padded = new Uint8Array(paddedLen);
        padded.set(src);
        padded[src.length] = 0x80;
        const view = new DataView(padded.buffer);
        view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));
        view.setUint32(paddedLen - 4, bitLen >>> 0);

        let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
        let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
        const w = new Uint32Array(64);
        for (let i = 0; i < paddedLen; i += 64) {
            for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
            for (let t = 16; t < 64; t++) {
                const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
                const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
                w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
            }
            let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
            for (let t = 0; t < 64; t++) {
                const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
                const ch = (e & f) ^ (~e & g);
                const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
                const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const temp2 = (S0 + maj) >>> 0;
                h = g;
                g = f;
                f = e;
                e = (d + temp1) >>> 0;
                d = c;
                c = b;
                b = a;
                a = (temp1 + temp2) >>> 0;
            }
            h0 = (h0 + a) >>> 0;
            h1 = (h1 + b) >>> 0;
            h2 = (h2 + c) >>> 0;
            h3 = (h3 + d) >>> 0;
            h4 = (h4 + e) >>> 0;
            h5 = (h5 + f) >>> 0;
            h6 = (h6 + g) >>> 0;
            h7 = (h7 + h) >>> 0;
        }
        return [h0, h1, h2, h3, h4, h5, h6, h7]
            .map((n) => n.toString(16).padStart(8, "0"))
            .join("");
    }

    function sha256Hex(canonical) {
        const crypto = nodeCrypto();
        if (crypto) return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
        return sha256BytesSync(new TextEncoder().encode(String(canonical)));
    }

    function rawBytes(input) {
        if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) return input;
        if (input instanceof Uint8Array) {
            if (typeof Buffer !== "undefined") {
                return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
            }
            return input;
        }
        throw new Error("sha256Bytes requires raw bytes");
    }

    /** SHA-256 of the exact bytes. Do not decode as text first. */
    function sha256Bytes(input) {
        const crypto = nodeCrypto();
        const bytes = rawBytes(input);
        if (crypto) return crypto.createHash("sha256").update(bytes).digest("hex");
        return sha256BytesSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    }

    function hexOf(buf) {
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    async function sha256Subtle(canonical) {
        const subtle = globalThis.crypto?.subtle;
        if (!subtle) throw new Error("crypto.subtle is not available");
        const bytes = new TextEncoder().encode(canonical);
        const buf = await subtle.digest("SHA-256", bytes);
        return hexOf(buf);
    }

    async function sha256BytesSubtle(input) {
        const subtle = globalThis.crypto?.subtle;
        if (!subtle) throw new Error("crypto.subtle is not available");
        const view = input instanceof Uint8Array
            ? input
            : new Uint8Array(input);
        const buf = await subtle.digest("SHA-256", view);
        return hexOf(buf);
    }

    function simHash(source) {
        return sha256Hex(canonicalString(simDocument(source)));
    }

    function idOf(row) {
        return String(row?.id || "");
    }

    function versionOf(row) {
        return String(row?.version == null ? "" : row.version);
    }

    /**
     * @param {Array<{id: string, version: string}>} hostMods
     * @param {Array<{id: string, version: string}>} clientMods
     */
    function modsCompatible(hostMods, clientMods) {
        const host = copyMods(hostMods);
        const client = copyMods(clientMods);
        const clientById = new Map(client.map((row) => [row.id, row]));
        const hostById = new Map(host.map((row) => [row.id, row]));
        const missing = [];
        const extra = [];
        const version = [];
        for (const row of host) {
            const other = clientById.get(row.id);
            if (!other) missing.push(`${idOf(row)}@${versionOf(row)}`);
            else if (other.version !== row.version) {
                version.push(`${row.id} host ${row.version} client ${other.version}`);
            }
        }
        for (const row of client) {
            if (!hostById.has(row.id)) extra.push(`${idOf(row)}@${versionOf(row)}`);
        }
        if (!missing.length && !extra.length && !version.length) {
            return { ok: true, reason: "" };
        }
        const parts = ["Mod mismatch."];
        if (missing.length) parts.push(`Missing: ${missing.join(", ")}.`);
        if (extra.length) parts.push(`Extra: ${extra.join(", ")}.`);
        if (version.length) parts.push(`Version: ${version.join(", ")}.`);
        return { ok: false, reason: parts.join(" ") };
    }

    return {
        simDocument,
        canonicalString,
        sha256Hex,
        sha256Bytes,
        sha256BytesSync,
        sha256Subtle,
        sha256BytesSubtle,
        simHash,
        modsCompatible
    };
});
