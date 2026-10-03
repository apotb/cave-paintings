/**
 * Settler work functions (needs).
 * Installed into the settlerWork closure. Function bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SettlerWorkParts = root.SettlerWorkParts || {};
        root.SettlerWorkParts.needs = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    const BodyHealing = ctx.BodyHealing;
    const Settlement = ctx.Settlement;
    const Party = ctx.Party;
    const StorageFilter = ctx.StorageFilter;
    const TS = ctx.TS;
    const INTERACT_TILES = ctx.INTERACT_TILES;
    const SCAN_MS = ctx.SCAN_MS;
    const AUTO_EAT = ctx.AUTO_EAT;
    const AUTO_EAT_UNTIL = ctx.AUTO_EAT_UNTIL;
    const dropPatient = (...args) => ctx.dropPatient(...args);
    const halt = (...args) => ctx.halt(...args);
    const patientNeedsTend = (...args) => ctx.patientNeedsTend(...args);
    const pawnCreature = (...args) => ctx.pawnCreature(...args);
    const claimsFor = (...args) => ctx.claimsFor(...args);
    const listMedicineSources = (...args) => ctx.listMedicineSources(...args);
    const sourceAvail = (...args) => ctx.sourceAvail(...args);
    const poulticeBatch = (...args) => ctx.poulticeBatch(...args);
    const cordBatch = (...args) => ctx.cordBatch(...args);
    const assignMedicineTakes = (...args) => ctx.assignMedicineTakes(...args);
    const pickDoctorBandage = (...args) => ctx.pickDoctorBandage(...args);
    const medicineKey = (...args) => ctx.medicineKey(...args);
    const isSkipped = (...args) => ctx.isSkipped(...args);
    const heldBandageCount = (...args) => ctx.heldBandageCount(...args);
    const reservesOf = (...args) => ctx.reservesOf(...args);
    const fetchMedicineTake = (...args) => ctx.fetchMedicineTake(...args);
    const goOrWalk = (...args) => ctx.goOrWalk(...args);
    const getItem = (...args) => ctx.getItem(...args);
    const manipScale = (...args) => ctx.manipScale(...args);
    const basketsOf = (...args) => ctx.basketsOf(...args);
    const hasCarryRoom = (...args) => ctx.hasCarryRoom(...args);
    const canCarry = (...args) => ctx.canCarry(...args);
    const keepGearOpts = (...args) => ctx.keepGearOpts(...args);
    const insertInEntry = (...args) => ctx.insertInEntry(...args);
    const emitEntry = (...args) => ctx.emitEntry(...args);
    const actCtx = (...args) => ctx.actCtx(...args);
    const heldPrepared = (...args) => ctx.heldPrepared(...args);
    const fetchEatStack = (...args) => ctx.fetchEatStack(...args);


function doDoctor(world, rec, settle, patient) {
    if (!patient || patient.dead) {
        dropPatient(world, rec, patient, false);
        return halt();
    }
    if (!patientNeedsTend(world, patient)) {
        dropPatient(world, rec, patient, false);
        return halt();
    }
    const owner = world.players.get(rec.ownerId) || rec;
    const patientC = world._creatureForPawn?.(owner, patient)
        || pawnCreature(world, patient);
    const anatomy = patientC?.anatomy;
    if (!anatomy) {
        dropPatient(world, rec, patient, true);
        return halt();
    }
    const claims = claimsFor(world, settle);
    const sources = listMedicineSources(world, rec, settle, patient, claims);
    const poulticeHave = sources
        .filter((s) => s.id === "poultice")
        .reduce((n, s) => n + sourceAvail(world, rec, settle, s, rec.id), 0);
    const plan = BodyHealing.planMedicineTakes(anatomy, poulticeHave, {
        poulticeBatch: poulticeBatch(),
        cordBatch: cordBatch()
    });
    const pTakes = assignMedicineTakes(world, rec, settle, sources, "poultice", plan.poultice);
    const cTakes = assignMedicineTakes(world, rec, settle, sources, "leaf_cord", plan.cord);
    const allTakes = pTakes.concat(cTakes);
    if (!allTakes.length && !pickDoctorBandage(rec)) {
        if (rec._settlerScan) {
            rec._settlerScan.patients = [];
            rec._settlerScan.keepBandage = false;
        }
        const gaveUp = sources.some((s) => {
            const key = medicineKey(s);
            return key && isSkipped(rec, key);
        });
        dropPatient(world, rec, patient, gaveUp);
        return halt();
    }
    const heldP = heldBandageCount(rec, "poultice");
    const heldC = heldBandageCount(rec, "leaf_cord");
    const next = (heldP < plan.poultice || heldC < plan.cord)
        ? allTakes.find((t) => t.kind !== "inv")
        : null;
    if (next) {
        const reserveEntries = allTakes
            .filter((t) => t.key)
            .map((t) => ({ key: t.key, qty: t.qty }));
        reservesOf(world, settle).set(rec.id, reserveEntries);
        return fetchMedicineTake(world, rec, settle, next) || halt();
    }
    reservesOf(world, settle).release(rec.id);

    const found = pickDoctorBandage(rec);
    if (!found) {
        dropPatient(world, rec, patient, false);
        return halt();
    }
    rec.hotbarIndex = found.bag === "hotbar" ? found.slot : rec.hotbarIndex;
    const walked = goOrWalk(world, rec, patient);
    if (walked) {
        const c = rec.creature || world._ensureSettlerCreature?.(rec);
        const ai = c?.ai;
        if ((ai?._jamMs || 0) > 900 || (ai?._stuckMs || 0) > 1800) {
            dropPatient(world, rec, patient, true);
            return halt();
        }
        return walked;
    }
    const stack = found.stack;
    const meta = stack ? getItem(stack.id) : null;
    if (!meta?.bandage) {
        dropPatient(world, rec, patient, false);
        return halt();
    }
    const budget = Number(meta.bandage.batchSeverity);
    let targets = BodyHealing.pickTendTargets?.(anatomy, { batchSeverity: budget }) || [];
    if (!targets.length) {
        const one = BodyHealing.pickTendTarget?.(anatomy);
        if (one) targets = [one];
    }
    if (!targets.length) {
        dropPatient(world, rec, patient, false);
        return halt();
    }
    const seconds = Number(meta.bandage.channelSeconds) || 5;
    const max = seconds * 1000 * manipScale(world, rec);
    rec._workChannel = {
        kind: "tend",
        remaining: max,
        max,
        slot: found.slot,
        bag: found.bag,
        patientId: patient.id,
        patientName: patient.name || patient.pawnName || null,
        itemId: stack.id,
        targetHints: targets.map((t) => BodyHealing.tendTargetHint?.(t)).filter(Boolean)
    };
    return halt();
}

function doSleep(world, rec, bed) {
    if (!bed?.entry) return halt();
    const session = world.players.get(rec.ownerId) || null;
    world._orderRest(session, rec, bed.entry, bed.slot, { autofill: false });
    const c = rec.creature || world.creatures.get(rec.id);
    if (c) c._restWalk = rec._restWalk;
    if (rec._restWalk) world._stepRestWalk?.(session, rec, 0);
    return halt();
}

function eatExtraBags(world, rec, settle) {
    const bags = [];
    for (const b of basketsOf(world, settle)) {
        bags.push({
            x: b.x,
            y: b.y,
            slots: b.slots || [],
            bag: "basket",
            host: b,
            entry: b
        });
    }
    return bags;
}

function foundFromEatPick(rec, pick) {
    if (!pick) return null;
    if (pick.extra) {
        const entry = pick.extra.entry || pick.extra.host || pick.pawn;
        const slots = pick.extra.slots || entry?.slots || [];
        return {
            slots,
            index: pick.slot,
            at: entry,
            kind: "basket",
            entry,
            bag: "basket"
        };
    }
    const bag = pick.bag === "overflow" ? "overflow" : "hotbar";
    const slots = bag === "overflow" ? (rec.overflow || []) : (rec.inventory || []);
    return {
        slots,
        index: pick.slot,
        at: rec,
        kind: bag === "overflow" ? "overflow" : "inv",
        bag
    };
}

function eatSeekOpts(world, rec, settle, extraBags) {
    const seekTiles = Number(settle?.radiusTiles) > 0
        ? Number(settle.radiusTiles)
        : (Settlement.RADIUS_TILES || 32);
    const opts = {
        tileSize: TS,
        seekTiles,
        interactTiles: INTERACT_TILES,
        allowPoison: Party.isStarving(rec),
        getItem,
        getFood: (s) => world._foodForEat(s)
    };
    if (extraBags) opts.extraBags = extraBags;
    return opts;
}

function pickEatStack(world, rec, settle) {
    const pick = Party.pickAutoEat(
        rec,
        [rec],
        eatSeekOpts(world, rec, settle, eatExtraBags(world, rec, settle))
    );
    return foundFromEatPick(rec, pick);
}

/** True when at least one of `stack` can land in pockets or overflow. */
function canTakeEatPiece(rec, stack) {
    if (!stack?.id) return false;
    const one = { ...stack, quantity: 1 };
    return hasCarryRoom(rec, one) && canCarry(rec, one, 1);
}

function carriedDumpCandidates(rec, keepOpts) {
    const keep = Settlement.keepIndices(rec.inventory, getItem, keepGearOpts(keepOpts));
    const out = [];
    const push = (slots, keptAt) => {
        for (let i = 0; i < (slots || []).length; i++) {
            const stack = slots[i];
            if (!stack?.id) continue;
            out.push({ slots, index: i, stack, kept: !!keptAt(i) });
        }
    };
    push(rec.inventory, (i) => keep.has(i));
    push(rec.overflow, () => false);
    return out;
}

/** Whole stack must leave the pocket. A partial merge does not free the slot. */
function stackFullyFits(slots, stack) {
    if (!stack?.id || !Array.isArray(slots)) return false;
    const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
    if (StorageFilter.existingStackRoom(slots, stack, getItem) >= qty) return true;
    return slots.some((s) => !s);
}

/**
 * Nearest storage that can take a carried stack outright.
 * Non-kept gear first so a weapon stays in hand when something else will do.
 */
function nearestEatDump(world, rec, settle, keepOpts) {
    const items = carriedDumpCandidates(rec, keepOpts);
    const baskets = basketsOf(world, settle);
    const pick = (allowKept) => {
        let best = null;
        let bestD = Infinity;
        for (const b of baskets) {
            if (!b) continue;
            const d = Math.hypot(
                (Number(rec.x) || 0) - (Number(b.x) || 0),
                (Number(rec.y) || 0) - (Number(b.y) || 0)
            );
            if (d > bestD) continue;
            let fit = null;
            for (const item of items) {
                if (item.kept && !allowKept) continue;
                if (!StorageFilter.allows(b.storageFilter, item.stack, getItem)) continue;
                if (!stackFullyFits(b.slots, item.stack)) continue;
                fit = item;
                break;
            }
            if (!fit) continue;
            if (d === bestD && best) continue;
            best = { basket: b, item: fit };
            bestD = d;
        }
        return best;
    };
    return pick(false) || pick(true);
}

function makeRoomForEat(world, rec, settle, keepOpts) {
    const dump = nearestEatDump(world, rec, settle, keepOpts);
    if (!dump?.basket || !dump.item?.stack) return null;
    const labelStack = dump.item.stack;
    const walked = goOrWalk(world, rec, dump.basket);
    if (walked) return { ...walked, eatHaul: labelStack };
    const slots = dump.item.slots;
    const live = slots?.[dump.item.index];
    if (!live?.id || live.id !== labelStack.id) return null;
    const before = Math.max(1, Number(live.quantity) || 1);
    const ok = insertInEntry(world, dump.basket, live);
    if (ok || !(Number(live.quantity) > 0)) slots[dump.item.index] = null;
    else if ((Number(live.quantity) || 0) >= before) return null;
    emitEntry(world, dump.basket);
    world._dirtyPawnOwner?.(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = SCAN_MS;
    return halt({ eatHaul: labelStack });
}

function eatFromHand(world, rec, settle) {
    return foundFromEatPick(rec, Party.pickAutoEat(rec, [rec], eatSeekOpts(world, rec, settle)));
}

function eatAct(world, rec, result) {
    if (rec.eatChannel) return "Eating";
    if (result?.eatHaul) {
        return Settlement.actLabel({ type: "stash" }, actCtx(world, rec, {
            stashStack: result.eatHaul
        }));
    }
    return "Getting food";
}

function doEat(world, rec, settle, keepOpts) {
    if (rec.eatChannel) return halt();
    const kc = Number(rec.kc) || 0;
    const sitting = rec._eatSitting;
    if (sitting && kc >= sitting.until) {
        rec._eatSitting = null;
        if (heldPrepared(rec).length) rec._returnFood = true;
        return null;
    }
    if (!sitting && kc >= AUTO_EAT) return null;
    let found = pickEatStack(world, rec, settle);
    if (!found) {
        rec._eatSitting = null;
        if (heldPrepared(rec).length) rec._returnFood = true;
        return null;
    }
    if (found.at !== rec) {
        const stack = found.slots?.[found.index];
        const fetched = stack && canTakeEatPiece(rec, stack)
            ? fetchEatStack(world, rec, settle, found)
            : { eatBlocked: true };
        if (fetched?.eatBlocked) {
            const room = makeRoomForEat(world, rec, settle, keepOpts);
            if (room) return room;
            const held = eatFromHand(world, rec, settle);
            if (!held || held.at !== rec) return null;
            found = held;
        } else {
            return fetched || halt();
        }
    }
    const bag = found.bag === "overflow" ? "overflow" : "hotbar";
    const stack = found.slots[found.index];
    if (!stack) return null;
    const food = world._foodForEat(stack);
    const poison = Number(food.foodPoisonChance ?? 0) > 0;
    if (poison && sitting?.poisonStop) return null;
    if (bag === "hotbar") rec.hotbarIndex = found.index;
    const isMeal = world._isPartialFood(stack);
    const room = (Number(rec.stomach) || 0) - (Number(rec.kc) || 0);
    if (isMeal && !(room > 0)) return null;
    const seconds = world._eatSecondsFor(food, isMeal);
    const max = seconds * 1000 * world._eatingDurationScale(rec);
    rec.eatChannel = {
        remaining: max,
        max,
        slot: found.index,
        bag,
        fromId: rec.id,
        itemId: stack.id,
        itemIndex: found.index,
        isMeal
    };
    rec._eatSitting = {
        until: poison ? kc + 1 : AUTO_EAT_UNTIL,
        poisonStop: poison
    };
    const session = world._sessionOfPawn?.(rec);
    world.pushEvent?.({
        kind: "channel",
        playerId: session?.id || rec.ownerId || rec.id,
        channel: "eat",
        pawnId: rec.id,
        itemId: stack.id,
        progress: 0
    });
    world._dirtyPawnOwner?.(rec);
    return halt();
}
    ctx.doDoctor = doDoctor;
    ctx.doSleep = doSleep;
    ctx.eatExtraBags = eatExtraBags;
    ctx.foundFromEatPick = foundFromEatPick;
    ctx.eatSeekOpts = eatSeekOpts;
    ctx.pickEatStack = pickEatStack;
    ctx.canTakeEatPiece = canTakeEatPiece;
    ctx.carriedDumpCandidates = carriedDumpCandidates;
    ctx.stackFullyFits = stackFullyFits;
    ctx.nearestEatDump = nearestEatDump;
    ctx.makeRoomForEat = makeRoomForEat;
    ctx.eatFromHand = eatFromHand;
    ctx.eatAct = eatAct;
    ctx.doEat = doEat;
});
