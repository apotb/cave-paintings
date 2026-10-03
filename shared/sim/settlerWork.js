/**
 * Settler jobs. Same Settlement.planWork policy as client PartyAI.
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const Settlement = require("../settlement");
        const StorageFilter = require("../storageFilter");
        const FuelFilter = require("../fuelFilter");
        const Place = require("../place");
        const Sleep = require("../sleep");
        const Hide = require("../hide");
        const Chop = require("../chop");
        const Dig = require("../dig");
        const Carry = require("../carry");
        const Party = require("../party");
        const Spoil = require("../spoil");
        const Fire = require("../fire");
        const BodyHealing = require("../body/Healing");
        const BodyCombat = require("../body/Combat");
        const DataStore = require("../DataStore");
        const Research = require("../research");
        module.exports = factory(
            Settlement, StorageFilter, FuelFilter, Place, Sleep, Hide, Chop, Dig, Carry, Party,
            Spoil, Fire, BodyHealing, BodyCombat, DataStore, Research,
            [
                require("./settler/helpers"),
                require("./settler/scan"),
                require("./settler/act"),
                require("./settler/craft"),
                require("./settler/field"),
                require("./settler/needs")
            ]
        );
    } else {
        const parts = root.SettlerWorkParts || {};
        root.SettlerWork = factory(
            root.Settlement, root.StorageFilter, root.FuelFilter, root.Place, root.Sleep, root.Hide,
            root.Chop, root.Dig, root.Carry, root.Party, root.Spoil || root.NetSpoil, root.Fire,
            root.BodyHealing, root.BodyCombat, root.DataStore, root.Research,
            [
                parts.helpers,
                parts.scan,
                parts.act,
                parts.craft,
                parts.field,
                parts.needs
            ]
        );
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
    Settlement, StorageFilter, FuelFilter, Place, Sleep, Hide, Chop, Dig, Carry, Party,
    Spoil, Fire, BodyHealing, BodyCombat, DataStore, Research,
    partInstallers
) {

const TS = 16;
const SCAN_MS = 280;
const INTERACT_TILES = 2.4;
/** Matches SimWorld._tryPickup when a dropId is given. */
const PICKUP_TILES = 3;
const SKIP_MS = 4500;
const AUTO_EAT = Party.AUTO_EAT_BELOW || 1000;
const AUTO_EAT_UNTIL = Party.AUTO_EAT_UNTIL || 1400;
const shellRequire = typeof require === "function" ? require : undefined;


    const ctx = {
        Settlement, StorageFilter, FuelFilter, Place, Sleep, Hide, Chop, Dig, Carry, Party, Spoil, Fire, BodyHealing, BodyCombat, DataStore, Research,
        require: shellRequire,
        TS, SCAN_MS, INTERACT_TILES, PICKUP_TILES, SKIP_MS, AUTO_EAT, AUTO_EAT_UNTIL
    };
    for (let partIndex = 0; partIndex < partInstallers.length; partIndex++) {
        const installPart = partInstallers[partIndex];
        if (typeof installPart !== "function") {
            throw new Error("SettlerWork part missing at index " + partIndex);
        }
        installPart(ctx);
    }
    const beginSettleQueries = (...args) => ctx.beginSettleQueries(...args);
    const findRec = (...args) => ctx.findRec(...args);
    const findSettle = (...args) => ctx.findSettle(...args);
    const maybeLeaveBed = (...args) => ctx.maybeLeaveBed(...args);
    const setSettlerAct = (...args) => ctx.setSettlerAct(...args);
    const markPathIgnore = (...args) => ctx.markPathIgnore(...args);
    const jobsOn = (...args) => ctx.jobsOn(...args);
    const workJobOn = (...args) => ctx.workJobOn(...args);
    const channelStillValid = (...args) => ctx.channelStillValid(...args);
    const endWorkHold = (...args) => ctx.endWorkHold(...args);
    const workChannelLabel = (...args) => ctx.workChannelLabel(...args);
    const haltAtRack = (...args) => ctx.haltAtRack(...args);
    const haltAtBench = (...args) => ctx.haltAtBench(...args);
    const reservesOf = (...args) => ctx.reservesOf(...args);
    const halt = (...args) => ctx.halt(...args);
    const clearChopApproach = (...args) => ctx.clearChopApproach(...args);
    const chopTargetLive = (...args) => ctx.chopTargetLive(...args);
    const dropChopTarget = (...args) => ctx.dropChopTarget(...args);
    const claimsFor = (...args) => ctx.claimsFor(...args);
    const settlersOf = (...args) => ctx.settlersOf(...args);
    const scanWork = (...args) => ctx.scanWork(...args);
    const isWorkHold = (...args) => ctx.isWorkHold(...args);
    const keepGearOpts = (...args) => ctx.keepGearOpts(...args);
    const stashScan = (...args) => ctx.stashScan(...args);
    const doEat = (...args) => ctx.doEat(...args);
    const eatAct = (...args) => ctx.eatAct(...args);
    const returnPreparedFood = (...args) => ctx.returnPreparedFood(...args);
    const heldPrepared = (...args) => ctx.heldPrepared(...args);
    const actCtx = (...args) => ctx.actCtx(...args);
    const mergeNeedsRoom = (...args) => ctx.mergeNeedsRoom(...args);
    const lockWork = (...args) => ctx.lockWork(...args);
    const voidPlan = (...args) => ctx.voidPlan(...args);
    const beginWorkHold = (...args) => ctx.beginWorkHold(...args);
    const firstStashable = (...args) => ctx.firstStashable(...args);
    const clearPaintBar = (...args) => ctx.clearPaintBar(...args);
    const doSleep = (...args) => ctx.doSleep(...args);
    const doDoctor = (...args) => ctx.doDoctor(...args);
    const basketsOf = (...args) => ctx.basketsOf(...args);
    const goOrWalk = (...args) => ctx.goOrWalk(...args);
    const depositKeepGear = (...args) => ctx.depositKeepGear(...args);
    const doStash = (...args) => ctx.doStash(...args);
    const jobsApi = (...args) => ctx.jobsApi(...args);
    const doGather = (...args) => ctx.doGather(...args);
    const doDig = (...args) => ctx.doDig(...args);
    const doChop = (...args) => ctx.doChop(...args);
    const doResearch = (...args) => ctx.doResearch(...args);
    const doMerge = (...args) => ctx.doMerge(...args);
    const doHaul = (...args) => ctx.doHaul(...args);
    const doLightFire = (...args) => ctx.doLightFire(...args);
    const doStokeFire = (...args) => ctx.doStokeFire(...args);
    const doCook = (...args) => ctx.doCook(...args);
    const doLeather = (...args) => ctx.doLeather(...args);


function tick(world, mob, delta) {
    beginSettleQueries(world);
    const rec = findRec(world, mob);
    if (!rec || rec.dead) return null;
    const settle = findSettle(world, rec);
    if (!settle) {
        const leftBed = maybeLeaveBed(world, rec, mob);
        if (leftBed) return leftBed;
        setSettlerAct(rec, mob, "Idle");
        return null;
    }

    rec._wadeWater = !!rec._wadeWater;
    if (mob) mob._wadeWater = !!rec._wadeWater;
    markPathIgnore(rec, rec.creature || mob, null, world);

    const leftBed = maybeLeaveBed(world, rec, mob);
    if (leftBed) return leftBed;

    const liveJobs = jobsOn(settle, rec);
    if (rec._workChannel) {
        if (!workJobOn(settle, rec, rec._workChannel.kind) || !channelStillValid(world, rec, rec._workChannel)) {
            rec._workChannel = null;
            endWorkHold(rec);
        } else {
            setSettlerAct(rec, mob, workChannelLabel(world, rec));
            const ch = rec._workChannel;
            if (ch.uid) {
                const found = world._findThingByUid?.(ch.uid)?.entry;
                markPathIgnore(rec, rec.creature, found || { uid: ch.uid }, world);
            }
            if ((ch.kind === "flesh" || ch.kind === "brain") && ch.uid) {
                const rack = world._findThingByUid(ch.uid)?.entry;
                if (rack) return haltAtRack(rec, rack);
            }
            if (ch.kind === "craft" && ch.uid) {
                const bench = world._findThingByUid(ch.uid)?.entry;
                if (bench) return haltAtBench(rec, bench);
            }
            if (ch.kind === "tend") reservesOf(world, settle).release(rec.id);
            return halt();
        }
    }
    if (rec.eatChannel) {
        setSettlerAct(rec, mob, "Eating");
        return halt();
    }
    const swinging = !!(
        (rec.attackTimer || 0) > 0
        || rec.creature?.isAttacking?.()
        || mob?.isAttacking?.()
    );
    if (swinging && rec._chopIgnoreUid) {
        if (!workJobOn(settle, rec, "chop")) {
            clearChopApproach(rec, rec.creature || mob);
        } else {
            const tree = rec._settlerScan?.chopTree;
            if (tree && !chopTargetLive(world, tree)) dropChopTarget(rec, tree);
            const keep = (typeof rec._settlerAct === "string" && rec._settlerAct && rec._settlerAct !== "Idle")
                ? rec._settlerAct
                : "Chopping";
            setSettlerAct(rec, mob, keep);
            return halt();
        }
    }

    const claims = claimsFor(world, settle);
    const alive = new Set(settlersOf(world, settle).map((s) => s.id));
    claims?.prune(alive);
    reservesOf(world, settle).prune(alive);

    rec._settlerScanMs = (rec._settlerScanMs || 0) + (Number(delta) || 16);
    if (!rec._settlerScan || rec._settlerScanMs >= SCAN_MS) {
        rec._settlerScanMs = 0;
        rec._settlerScan = scanWork(world, rec, settle, claims);
    }
    const researchHold = isWorkHold(rec) && rec._busyJob?.type === "research";
    if (researchHold) rec._researchPoll = (rec._researchPoll || 0) + 1;
    else rec._researchPoll = 0;
    const pollNeeds = researchHold
        && rec._researchPoll >= (Settlement.RESEARCH_NEEDS_TICKS || 10);
    if (pollNeeds) {
        rec._settlerScan = scanWork(world, rec, settle, claims);
        rec._settlerScanMs = 0;
    }
    const scan = rec._settlerScan || {};
    const keepOpts = keepGearOpts({
        keepBandage: !!scan.keepBandage,
        keepPigment: !!scan.keepPigment,
        isPigment: scan.isPigment || null
    });
    const stash = stashScan(world, rec, settle, keepOpts);
    const haulOn = Settlement.enabledJobs(liveJobs).includes("haul");
    const delivering = !!(rec._haulDestUid && (stash.has || rec._haulMergeOnly)
        && (haulOn || rec._busyJob?.type === "stash"));
    if (rec._haulDestUid && !delivering) {
        rec._haulDestUid = null;
        rec._haulMergeOnly = false;
        if (rec._busyJob?.type === "haul" || rec._busyJob?.type === "stash") endWorkHold(rec);
    }

    const hold = isWorkHold(rec) || delivering;
    if (!hold) {
        const eat = doEat(world, rec, settle, keepOpts);
        if (eat) {
            rec._researchPoll = 0;
            endWorkHold(rec);
            setSettlerAct(rec, mob, eatAct(world, rec, eat));
            return eat;
        }
    }
    if (rec._returnFood) {
        const back = returnPreparedFood(world, rec, settle);
        if (back) {
            const meal = heldPrepared(rec)[0];
            setSettlerAct(rec, mob, Settlement.actLabel({ type: "stash" }, actCtx(world, rec, {
                stashStack: meal ? meal.slots[meal.index] : null
            })));
            return back;
        }
    }

    const planOpts = () => ({
        kc: rec.kc,
        autoEatBelow: AUTO_EAT,
        canEat: false,
        isNight: scan.night,
        injured: scan.injured,
        isOrphan: false,
        bed: scan.bed || null,
        jobs: liveJobs,
        patients: scan.patients || [],
        unlitFire: scan.unlitFire,
        light: scan.light,
        cookBill: scan.cookBill,
        stokeFire: scan.stokeFire,
        leatherWork: scan.leatherWork,
        haulDrop: scan.haulDrop,
        haulMerge: scan.haulMerge,
        gatherThing: scan.gatherThing,
        digThing: scan.digThing,
        chopTree: scan.chopTree,
        researchCircle: scan.researchCircle,
        stashBasket: stash.basket,
        hasStash: stash.has,
        hasFoodStash: stash.hasFood,
        stashUrgent: stash.urgent,
        mergeNeedsRoom: mergeNeedsRoom(rec, scan.haulMerge),
        busy: hold,
        busyJob: rec._busyJob || null,
        reconsiderNeeds: pollNeeds,
        world,
        rec
    });

    let plan = Settlement.planWork(planOpts());
    if (!delivering && !lockWork(claims, rec.id, plan)) {
        voidPlan(scan, plan);
        plan = Settlement.planWork(planOpts());
        if (!lockWork(claims, rec.id, plan)) {
            voidPlan(scan, plan);
            plan = { type: "idle" };
            claims?.release(rec.id);
        }
    }
    if (pollNeeds) rec._researchPoll = 0;

    if (pollNeeds && plan.type === "research") {
        const eat = doEat(world, rec, settle, keepOpts);
        if (eat) {
            endWorkHold(rec);
            setSettlerAct(rec, mob, eatAct(world, rec, eat));
            return eat;
        }
    }

    if (plan.type !== "doctor") reservesOf(world, settle).release(rec.id);

    if (Settlement.isBusyWork(plan.type)) beginWorkHold(rec, plan);
    else if (!delivering && plan.type !== "chop") endWorkHold(rec);

    const ctx = actCtx(world, rec, {
        stashStack: firstStashable(rec, keepOpts),
        haulWhat: rec._haulWhat
    });
    let label = Settlement.actLabel(plan, ctx);
    if (delivering) label = Settlement.actLabel({ type: "stash" }, ctx);
    if (plan.type !== "chop" && plan.type !== "dig") clearChopApproach(rec, rec.creature || mob);
    if (plan.type !== "research") clearPaintBar(rec);
    setSettlerAct(rec, mob, label);

    if (plan.type === "sleep" && plan.target) return doSleep(world, rec, plan.target);
    if (plan.type === "doctor" && plan.target) return doDoctor(world, rec, settle, plan.target);

    if (rec._haulDestUid && (stash.has || rec._haulMergeOnly)) {
        const dest = basketsOf(world, settle).find((b) => b.uid === rec._haulDestUid) || stash.basket;
        if (rec._haulMergeOnly) {
            const walked = goOrWalk(world, rec, dest);
            if (walked) return walked;
            depositKeepGear(world, rec, settle, keepOpts, dest);
            rec._haulMergeOnly = false;
            rec._haulDestUid = null;
            endWorkHold(rec);
            return halt();
        }
        return doStash(world, rec, settle, dest, keepOpts);
    }

    if (plan.type === "stash" && plan.target) {
        return doStash(world, rec, settle, plan.target, keepOpts);
    }
    const registeredJob = jobsApi().forType(plan.type);
    if (registeredJob?.perform) {
        return registeredJob.perform({
            world,
            rec,
            settle,
            plan,
            delta,
            runGather: () => doGather(world, rec, plan.target),
            runDig: () => doDig(world, rec, settle, plan.target, delta)
        });
    }
    if (plan.type === "chop" && plan.target) return doChop(world, rec, settle, plan.target, delta);
    if (plan.type === "research" && plan.target) return doResearch(world, rec, settle, plan.target);
    if (plan.type === "haul" && plan.target) {
        if (plan.target.kind === "pack" || plan.target.kind === "move") {
            return doMerge(world, rec, settle, plan.target);
        }
        return doHaul(world, rec, settle, plan.target);
    }
    if (plan.type === "cook_light" && plan.target) {
        const r = doLightFire(world, rec, settle, plan.target);
        if (!r?.walkTo) endWorkHold(rec);
        return r;
    }
    if (plan.type === "cook_stoke" && plan.target) {
        const r = doStokeFire(world, rec, settle, plan.target);
        if (!r?.walkTo) endWorkHold(rec);
        return r;
    }
    if (plan.type === "cook" && plan.target) return doCook(world, rec, settle, plan.target);
    if (plan.type === "leather" && plan.target) return doLeather(world, rec, settle, plan.target);

    return null;
}
    ctx.tick = tick;

    return { tick, releaseWork: ctx.releaseWork, interruptForCombat: ctx.interruptForCombat, tickChannel: ctx.tickChannel, publicChannel: ctx.publicChannel, bumpWork: ctx.bumpWork };
});
