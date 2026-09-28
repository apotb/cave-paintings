/**
 * Settler job registry. Planning and perform run on the authoritative sim.
 * Duplicate ids throw and name both sources. No last-write-wins.
 * Node + browser UMD.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.ModJobs = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const jobs = new Map();
    const byType = new Map();
    const CORE_IDS = ["doctor", "cook", "chop", "leather", "gather", "haul", "research"];

    function registerJob(modId, spec) {
        const source = String(modId || "");
        const id = spec?.id;
        if (typeof id !== "string" || !id) {
            throw new Error(`${source}: registerJob requires an id`);
        }
        if (typeof spec.plan !== "function") {
            throw new Error(`${source}: job "${id}" requires a plan function`);
        }
        if (typeof spec.perform !== "function") {
            throw new Error(`${source}: job "${id}" requires a perform function`);
        }
        if (typeof spec.actLabel !== "function") {
            throw new Error(`${source}: job "${id}" requires an actLabel function`);
        }
        const prev = jobs.get(id);
        if (prev) {
            throw new Error(`Duplicate job "${id}" (${prev.modId} and ${source})`);
        }
        if (CORE_IDS.includes(id) && source !== "core") {
            throw new Error(`Duplicate job "${id}" (core and ${source})`);
        }
        const planTypes = Array.isArray(spec.planTypes) && spec.planTypes.length
            ? spec.planTypes.map((type) => String(type))
            : [id];
        for (const type of planTypes) {
            const owner = byType.get(type);
            if (owner) {
                throw new Error(`Duplicate job "${type}" (${owner.modId} and ${source})`);
            }
        }
        const pri = Math.floor(Number(spec.defaultPriority));
        const row = {
            modId: source,
            id,
            label: typeof spec.label === "string" && spec.label ? spec.label : id,
            name: typeof spec.name === "string" && spec.name ? spec.name : (spec.label || id),
            work: Array.isArray(spec.work) ? spec.work.slice() : [],
            defaultPriority: pri >= 0 && pri <= 4 ? pri : 3,
            busy: spec.busy !== false,
            plan: spec.plan,
            perform: spec.perform,
            actLabel: spec.actLabel,
            planTypes
        };
        jobs.set(id, row);
        for (const type of planTypes) byType.set(type, row);
        return row;
    }

    function get(id) {
        return jobs.get(id) || null;
    }

    function forType(type) {
        return byType.get(type) || null;
    }

    function list() {
        return [...jobs.values()];
    }

    function reset() {
        jobs.clear();
        byType.clear();
    }

    return {
        CORE_IDS,
        registerJob,
        get,
        forType,
        list,
        reset
    };
});
