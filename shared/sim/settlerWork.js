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
    const releaseStaleNightScan = (...args) => ctx.releaseStaleNightScan(...args);
    const setSettlerAct = (...args) => ctx.setSettlerAct(...args);
    const markPathIgnore = (...args) => ctx.markPathIgnore(...args);
    const jobsOn = (...args) => ctx.jobsOn(...args);
    const workJobOn = (...args) => ctx.workJobOn(...args);
    const channelStillValid = (...args) => ctx.channelStillValid(...args);
    const clearWorkChannel = (...args) => ctx.clearWorkChannel(...args);
    const endWorkHold = (...args) => ctx.endWorkHold(...args);
    const workChannelLabel = (...args) => ctx.workChannelLabel(...args);
    const haltAtRack = (...args) => ctx.haltAtRack(...args);
    const haltAtBench = (...args) => ctx.haltAtBench(...args);
    const reservesOf = (...args) => ctx.reservesOf(...args);
    const eatReserveBroken = (...args) => ctx.eatReserveBroken(...args);
    const releaseFoodReserve = (...args) => ctx.releaseFoodReserve(...args);
    const halt = (...args) => ctx.halt(...args);
    const clearChopApproach = (...args) => ctx.clearChopApproach(...args);
    const chopTargetLive = (...args) => ctx.chopTargetLive(...args);
    const dropChopTarget = (...args) => ctx.dropChopTarget(...args);
    const claimsFor = (...args) => ctx.claimsFor(...args);
    const leatherJobKey = (...args) => ctx.leatherJobKey(...args);
    const stationKey = (...args) => ctx.stationKey(...args);
    const thingKey = (...args) => ctx.thingKey(...args);
    const dropKey = (...args) => ctx.dropKey(...args);
    const stashKey = (...args) => ctx.stashKey(...args);
    const settlersOf = (...args) => ctx.settlersOf(...args);
    const scanWork = (...args) => ctx.scanWork(...args);
    const isWorkHold = (...args) => ctx.isWorkHold(...args);
    const keepGearOpts = (...args) => ctx.keepGearOpts(...args);
    const stashScan = (...args) => ctx.stashScan(...args);
    const doEat = (...args) => ctx.doEat(...args);
    const eatAct = (...args) => ctx.eatAct(...args);
    const returnPreparedFood = (...args) => ctx.returnPreparedFood(...args);
    const returnSurplusHides = (...args) => ctx.returnSurplusHides(...args);
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
    const doRescue = (...args) => ctx.doRescue(...args);
    const basketsOf = (...args) => ctx.basketsOf(...args);
    const goOrWalk = (...args) => ctx.goOrWalk(...args);
    const depositKeepGear = (...args) => ctx.depositKeepGear(...args);
    const doStash = (...args) => ctx.doStash(...args);
    const jobsApi = (...args) => ctx.jobsApi(...args);
    const doGather = (...args) => ctx.doGather(...args);
    const doDig = (...args) => ctx.doDig(...args);
    const doFish = (...args) => ctx.doFish(...args);
    const doChop = (...args) => ctx.doChop(...args);
    const doResearch = (...args) => ctx.doResearch(...args);
    const doMerge = (...args) => ctx.doMerge(...args);
    const doHaul = (...args) => ctx.doHaul(...args);
    const haulTargetMissing = (...args) => ctx.haulTargetMissing(...args);
    const abandonHaul = (...args) => ctx.abandonHaul(...args);
    const doLightFire = (...args) => ctx.doLightFire(...args);
    const doStokeFire = (...args) => ctx.doStokeFire(...args);
    const doCook = (...args) => ctx.doCook(...args);
    const doLeather = (...args) => ctx.doLeather(...args);
    const doRock = (...args) => ctx.doRock(...args);


function savedHaulKey(job) {
    if (!job) return null;
    if (job.claimKey) return job.claimKey;
    if (job.kind && StorageFilter?.mergeClaimKey) {
        const key = StorageFilter.mergeClaimKey(job);
        if (key) return key;
    }
    return dropKey(job);
}

/** The live scan target for a job saved across rejoin, or null if it is gone. */
function savedWorkTarget(saved, scan) {
    if (!saved?.type || !scan) return null;
    const claim = saved.claim || null;
    const same = (key) => !claim || key === claim;
    if (saved.type === "leather") {
        const job = scan.leatherWork;
        if (!job || !same(leatherJobKey(job))) return null;
        return job;
    }
    if (saved.type === "cook") {
        const job = scan.cookBill;
        if (!job || !same(stationKey(job.fire || job.entry || job))) return null;
        return job;
    }
    if (saved.type === "cook_light") {
        const job = scan.unlitFire;
        if (!job || !same(stationKey(job))) return null;
        return job;
    }
    if (saved.type === "cook_stoke") {
        const job = scan.stokeFire;
        if (!job || !same(stationKey(job))) return null;
        return job;
    }
    if (saved.type === "craft") {
        const job = scan.rockWork;
        if (!job || !same(stationKey(job.station || job.entry || job))) return null;
        return job;
    }
    if (saved.type === "chop") {
        const job = scan.chopTree;
        if (!job || !same(thingKey(job))) return null;
        return job;
    }
    if (saved.type === "gather") {
        const job = scan.gatherThing;
        if (!job || !same(thingKey(job))) return null;
        return job;
    }
    if (saved.type === "dig") return scan.digThing || null;
    if (saved.type === "haul") {
        if (scan.haulDrop && same(savedHaulKey(scan.haulDrop))) return scan.haulDrop;
        if (scan.haulMerge && same(savedHaulKey(scan.haulMerge))) return scan.haulMerge;
        return null;
    }
    if (saved.type === "doctor") {
        const id = saved.pawnId;
        if (!id) return null;
        return (scan.patients || []).find((p) => p && p.id === id) || null;
    }
    if (saved.type === "rescue") {
        const id = saved.pawnId;
        if (!id) return null;
        return (scan.rescues || []).find((p) => p && p.id === id) || null;
    }
    if (saved.type === "research") {
        const job = scan.researchCircle;
        if (!job || !same(thingKey(job))) return null;
        return job;
    }
    if (saved.type === "stash") {
        const job = scan.stash?.basket;
        if (!job || !same(stashKey(job))) return null;
        return job;
    }
    return null;
}

/** Keep the station claimed before the first search, including during a channel. */
function applySavedClaim(world, rec, settle) {
    const saved = rec?._savedWork;
    if (!saved || saved.claimed) return;
    if (saved.claim) claimsFor(world, settle)?.claim(saved.claim, rec.id);
    saved.claimed = true;
}

/**
 * Point the saved job at this tick's live station. A copied bench from the
 * save would cook and sew on an object the world no longer ticks.
 */
function rebindSavedWork(world, rec, settle, scan) {
    const saved = rec?._savedWork;
    if (!saved || !scan) return;
    const target = savedWorkTarget(saved, scan);
    rec._savedWork = null;
    if (!target) {
        rec._resumeWork = false;
        if (!rec._workChannel) {
            claimsFor(world, settle)?.release(rec.id);
            endWorkHold(rec);
        }
        return;
    }
    rec._workHold = true;
    rec._resumeWork = true;
    rec._busyJob = { type: saved.type, target };
    if (saved.type === "research" && !rec._resumePaint) {
        rec._resumePaint = {
            uid: target.uid || null,
            painted: Math.max(0, Math.floor(Number(target.painted) || 0))
        };
    }
}

/** At most a couple of full job searches per sim tick, so a camp of twenty doesn't all search on the same frame. */
function allowSettlerScan(world) {
    if (!world || !world._simTickLive) return true;
    if (!(world._scanLeft > 0)) return false;
    world._scanLeft--;
    return true;
}

function hideReturnWalk(world, rec, mob, settle) {
    const back = returnSurplusHides(world, rec, settle);
    if (!back) return null;
    claimsFor(world, settle)?.release(rec.id);
    endWorkHold(rec);
    rec._settlerPlan = "stash";
    setSettlerAct(rec, mob, Settlement.actLabel({ type: "stash" }, actCtx(world, rec, {
        stashStack: rec._returnHideStack || null
    })));
    return back;
}

function tick(world, mob, delta) {
    beginSettleQueries(world);
    const rec = findRec(world, mob);
    if (!rec || rec.dead) return null;
    if (rec._groundSleep || mob?._groundSleep) {
        mob?.setDesiredVel?.(0, 0);
        setSettlerAct(rec, mob, "Exhausted");
        return halt();
    }
    if (world._isVomiting?.(rec) || mob?.isVomiting?.()) {
        setSettlerAct(rec, mob, "Vomiting");
        return halt();
    }
    releaseStaleNightScan(world, rec, mob);
    const settle = findSettle(world, rec);
    if (rec.role === "companion" || rec.role === "player") {
        endWorkHold(rec);
        setSettlerAct(rec, mob, "Idle");
        return null;
    }
    if (!settle) {
        const leftBed = maybeLeaveBed(world, rec, mob);
        if (leftBed) return leftBed;
        setSettlerAct(rec, mob, "Idle");
        return null;
    }

    rec._wadeWater = !!rec._wadeWater;
    if (mob) mob._wadeWater = !!rec._wadeWater;
    applySavedClaim(world, rec, settle);
    markPathIgnore(rec, rec.creature || mob, null, world);

    const leftBed = maybeLeaveBed(world, rec, mob);
    if (leftBed) return leftBed;

    const liveJobs = jobsOn(settle, rec);
    if (rec._workChannel) {
        const chJob = Settlement.channelJob
            ? Settlement.channelJob(rec._workChannel)
            : rec._workChannel.kind;
        const jobOff = !workJobOn(settle, rec, chJob);
        if (jobOff || !channelStillValid(world, rec, rec._workChannel)) {
            clearWorkChannel(world, rec, rec._workChannel, jobOff ? "job" : "invalid");
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
            if ((ch.kind === "craft" || ch.kind === "rock" || ch.kind === "knap") && ch.uid) {
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
            if (tree && !chopTargetLive(world, tree)) dropChopTarget(rec, tree, world, settle);
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

    if (eatReserveBroken(world, rec, settle)) {
        releaseFoodReserve(world, rec, settle);
        if (!rec._savedWork) {
            endWorkHold(rec);
            rec._settlerPlan = null;
            rec._settlerScan = scanWork(world, rec, settle, claims);
            rec._settlerScanMs = 0;
        }
    }

    rec._settlerScanMs = (rec._settlerScanMs || 0) + (Number(delta) || 16);
    // Someone else took the pile. Drop the haul and rescan for the next job
    // instead of walking to where it used to be.
    if (haulTargetMissing(world, rec)) abandonHaul(world, rec, settle);
    const wantScan = !rec._settlerScan || rec._settlerScanMs >= SCAN_MS;
    if (wantScan && allowSettlerScan(world)) {
        rec._settlerScanMs = 0;
        rec._settlerScan = scanWork(world, rec, settle, claims);
    }
    rebindSavedWork(world, rec, settle, rec._settlerScan);
    if (rec._resumeWork && rec._resumePaint && rec._busyJob?.type === "research") {
        const uid = rec._resumePaint.uid || rec._busyJob.target?.uid;
        const painted = Math.floor(Number(world._findThingByUid?.(uid)?.entry?.painted) || 0);
        if (painted > rec._resumePaint.painted) {
            rec._resumeWork = false;
            rec._resumePaint = null;
        }
    }
    // The search has not run yet. Stay on the saved job. Planning now would
    // walk them off onto haul, food, or bed, and a sleep locks out the rebind.
    if (rec._savedWork && isWorkHold(rec) && rec._busyJob?.type !== "research") {
        if (!workJobOn(settle, rec, rec._busyJob.type)) {
            rec._savedWork = null;
            rec._resumeWork = false;
            endWorkHold(rec);
        } else {
            setSettlerAct(rec, mob, Settlement.actLabel(rec._busyJob, actCtx(world, rec, {})));
            return halt();
        }
    }
    const researchHold = isWorkHold(rec) && rec._busyJob?.type === "research";
    if (researchHold) rec._researchPoll = (rec._researchPoll || 0) + 1;
    else rec._researchPoll = 0;
    const pollDue = researchHold
        && rec._researchPoll >= (Settlement.RESEARCH_NEEDS_TICKS || 10);
    if (pollDue && allowSettlerScan(world)) {
        rec._settlerScan = scanWork(world, rec, settle, claims);
        rec._settlerScanMs = 0;
    }
    // Sleep and other jobs share this poll. Both wait until a search has
    // run, so a rejoin does not walk off the circle on an empty scan.
    const pollNeeds = pollDue && !!rec._settlerScan;
    const scan = rec._settlerScan || {};
    const keepOpts = keepGearOpts({
        keepBandage: !!scan.keepBandage,
        keepPigment: !!scan.keepPigment,
        isPigment: scan.isPigment || null,
        keepPreds: scan.keepPreds || null
    });
    const jobMatsOpts = () => {
        const extra = scan.jobKeepPreds;
        if (!Array.isArray(extra) || !extra.length) return keepOpts;
        return keepGearOpts({
            keepBandage: !!keepOpts.keepBandage,
            keepPigment: !!keepOpts.keepPigment,
            isPigment: keepOpts.isPigment || null,
            keepPreds: [...(keepOpts.keepPreds || []), ...extra]
        });
    };
    // Last search found nothing to do. Replanning every idle person every
    // frame is what pegs a slow laptop at 30 fps inside a camp.
    if (
        rec._settlerPlan === "idle"
        && rec._settlerScan
        && rec._settlerScanMs > 0
        && rec._settlerScanMs < SCAN_MS
        && !rec._haulDestUid
        && !rec._haulMergeOnly
        && !rec._returnFood
        && !rec._returnHides
        && !isWorkHold(rec)
    ) {
        const careNow = Settlement.jobEnabled(liveJobs, "doctor", rec) && (scan.critical || []).length;
        const eat = careNow ? null : doEat(world, rec, settle, keepOpts);
        if (eat) {
            rec._researchPoll = 0;
            endWorkHold(rec);
            setSettlerAct(rec, mob, eatAct(world, rec, eat));
            return eat;
        }
        if (rec._settlerAct !== "Idle") setSettlerAct(rec, mob, "Idle");
        return null;
    }
    const reuseHold = isWorkHold(rec)
        && rec._busyJob?.type
        && rec._busyJob.type !== "research"
        && Settlement.jobEnabled(liveJobs, rec._busyJob.type, rec)
        && rec._settlerScan
        && rec._settlerScanMs > 0
        && rec._settlerScanMs < SCAN_MS
        && !rec._haulDestUid
        && !rec._haulMergeOnly
        && !rec._returnFood
        && !rec._returnHides;
    let stash;
    let delivering = false;
    let plan;
    if (reuseHold) {
        stash = scan.stash || { basket: null, has: false, urgent: false, hasFood: false };
        plan = rec._busyJob;
    } else {
        stash = stashScan(world, rec, settle, keepOpts);
        let stashUnneeded = false;
        if (stash.has && !scan.leatherWork) {
            const extra = scan.jobKeepPreds;
            stashUnneeded = !Array.isArray(extra) || !extra.length
                || stashScan(world, rec, settle, jobMatsOpts()).has;
        }
        const haulOn = Settlement.enabledJobs(liveJobs).includes("haul");
        delivering = !!(rec._haulDestUid && (stash.has || rec._haulMergeOnly)
            && (haulOn || rec._busyJob?.type === "stash"));
        if (rec._haulDestUid && !delivering) {
            rec._haulDestUid = null;
            rec._haulMergeOnly = false;
            if (rec._busyJob?.type === "haul" || rec._busyJob?.type === "stash") endWorkHold(rec);
        }

        const hold = isWorkHold(rec) || delivering;
        const careNow = Settlement.jobEnabled(liveJobs, "doctor", rec) && (scan.critical || []).length;
        if (!hold && !careNow) {
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
        if (rec._returnHides) {
            const back = hideReturnWalk(world, rec, mob, settle);
            if (back) return back;
        }

        const planOpts = () => ({
            kc: rec.kc,
            autoEatBelow: AUTO_EAT,
            canEat: false,
            isNight: scan.night,
            assignment: scan.assignment,
            injured: scan.injured,
            downed: !!scan.downed,
            isOrphan: false,
            bed: scan.bed || null,
            jobs: liveJobs,
            patients: scan.patients || [],
            critical: scan.critical || [],
            rescues: scan.rescues || [],
            unlitFire: scan.unlitFire,
            light: scan.light,
            cookBill: scan.cookBill,
            stokeFire: scan.stokeFire,
            leatherWork: scan.leatherWork,
            rockWork: scan.rockWork,
            haulDrop: scan.haulDrop,
            haulOutput: scan.haulOutput,
            haulMerge: scan.haulMerge,
            gatherThing: scan.gatherThing,
            digThing: scan.digThing,
            chopTree: scan.chopTree,
            fishSpot: scan.fishSpot,
            researchCircle: scan.researchCircle,
            stashBasket: stash.basket,
            hasStash: stash.has,
            hasFoodStash: stash.hasFood,
            stashUrgent: stash.urgent,
            stashUnneeded,
            carryRoom: !!scan.carryRoom,
            mergeNeedsRoom: mergeNeedsRoom(rec, scan.haulMerge),
            busy: hold,
            busyJob: rec._busyJob || null,
            keepResume: !!(rec._resumeWork && hold),
            reconsiderNeeds: pollNeeds,
            world,
            rec
        });

        plan = Settlement.planWork(planOpts());
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

        if (rec._resumeWork && plan.type !== rec._busyJob?.type) rec._resumeWork = false;
        if (!delivering && plan.type === "leather") {
            rec._hideKeepJob = plan.target;
            const back = hideReturnWalk(world, rec, mob, settle);
            if (back) return back;
        }
        if (Settlement.isBusyWork(plan.type)) beginWorkHold(rec, plan);
        else if (!delivering && plan.type !== "chop") endWorkHold(rec);
        rec._settlerPlan = delivering ? "stash" : plan.type;
    }

    const ctx = actCtx(world, rec, {
        stashStack: firstStashable(rec, keepOpts),
        haulWhat: rec._haulWhat
    });
    let label = Settlement.actLabel(plan, ctx);
    if (delivering) label = Settlement.actLabel({ type: "stash" }, ctx);
    if (plan.type !== "chop" && plan.type !== "dig" && plan.type !== "fish") clearChopApproach(rec, rec.creature || mob);
    if (plan.type !== "research") clearPaintBar(rec);
    setSettlerAct(rec, mob, label);

    if (plan.type === "sleep" && plan.target) return doSleep(world, rec, plan.target);
    if (plan.type === "rescue" && plan.target) return doRescue(world, rec, settle, plan.target);
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
        return doStash(world, rec, settle, plan.target, plan.keepJobMats ? jobMatsOpts() : keepOpts);
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
            runDig: () => doDig(world, rec, settle, plan.target, delta),
            runFish: () => doFish(world, rec, settle, plan.target)
        });
    }
    if (plan.type === "chop" && plan.target) return doChop(world, rec, settle, plan.target, delta);
    if (plan.type === "research" && plan.target) return doResearch(world, rec, settle, plan.target, delta);
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
    if (plan.type === "craft" && plan.target) return doRock(world, rec, settle, plan.target);

    return null;
}
    ctx.tick = tick;

    return { tick, releaseWork: ctx.releaseWork, interruptForCombat: ctx.interruptForCombat, interruptForVomit: ctx.interruptForVomit, tickChannel: ctx.tickChannel, publicChannel: ctx.publicChannel, bumpWork: ctx.bumpWork };
});
