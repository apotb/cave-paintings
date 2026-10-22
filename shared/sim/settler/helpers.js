/**
 * Settler work functions (helpers).
 * Installed into the settlerWork closure. Function bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SettlerWorkParts = root.SettlerWorkParts || {};
        root.SettlerWorkParts.helpers = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    const DataStore = ctx.DataStore;
    const Research = ctx.Research;
    const Settlement = ctx.Settlement;
    const Sleep = ctx.Sleep;
    const StorageFilter = ctx.StorageFilter;
    const require = ctx.require;
    const Spoil = ctx.Spoil;
    const Hide = ctx.Hide;
    const Fire = ctx.Fire;
    const Carry = ctx.Carry;
    const Place = ctx.Place;
    const Chop = ctx.Chop;
    const Dig = ctx.Dig;
    const BodyHealing = ctx.BodyHealing;
    const TS = ctx.TS;
    const INTERACT_TILES = ctx.INTERACT_TILES;
    const PICKUP_TILES = ctx.PICKUP_TILES;
    const SCAN_MS = ctx.SCAN_MS;
    const SKIP_MS = ctx.SKIP_MS;
    const markPathIgnore = (...args) => ctx.markPathIgnore(...args);
    const setSettlerAct = (...args) => ctx.setSettlerAct(...args);
    const actCtx = (...args) => ctx.actCtx(...args);
    const clearChopApproach = (...args) => ctx.clearChopApproach(...args);
    const hideAllowed = (...args) => ctx.hideAllowed(...args);
    const goOrWalk = (...args) => ctx.goOrWalk(...args);
    const walkToFound = (...args) => ctx.walkToFound(...args);
    const restorePiece = (...args) => ctx.restorePiece(...args);
function getItem(id) {
    return DataStore.getItem(id);
}

function researchHolder(world, rec, settle) {
    const oid = rec?.ownerId || rec?.leaderId || settle?.ownerId;
    if (world && typeof world._researchHolder === "function" && oid) {
        const h = world._researchHolder(oid);
        if (h) return h;
    }
    return rec || settle || null;
}

/**
 * Share chunk/station/loot scans among settlers in one SimWorld.tick.
 * Tests call tick() without that wrapper, so bump the gen each time.
 */
function beginSettleQueries(world) {
    if (!world) return;
    if (!world._simTickLive) {
        world._queryGen = (world._queryGen || 0) + 1;
        world._uidIndex = null;
        world._scanLeft = 99;
        return;
    }
    // One budget for the whole tick. beginSettleQueries runs once per settler.
    const gen = world._queryGen | 0;
    if (world._scanGen !== gen) {
        world._scanGen = gen;
        world._scanLeft = 2;
    }
}

function settleQ(world, settle) {
    const gen = world._queryGen | 0;
    const id = settle && settle.id != null ? String(settle.id) : "";
    let bag = world._settleQ;
    if (!bag || bag.gen !== gen) {
        bag = { gen, byId: new Map() };
        world._settleQ = bag;
    }
    let q = bag.byId.get(id);
    if (!q) {
        q = {};
        bag.byId.set(id, q);
    }
    return q;
}

function jobOn(enabled, name) {
    return !enabled || enabled.has(name);
}

function near(px, py, tx, ty) {
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
    return Math.hypot(px - tx, py - ty) / TS <= INTERACT_TILES;
}

function dropNear(rec, drop) {
    if (!rec || !drop) return false;
    if (!Number.isFinite(drop.x) || !Number.isFinite(drop.y)) return false;
    return Math.hypot(rec.x - drop.x, rec.y - drop.y) / TS <= PICKUP_TILES;
}

/**
 * Ground piles have no collision of their own, but they often sit against
 * stumps/trees. Furniture stand-poses never arrive there, so walk at the
 * drop and pick up once in pickup range.
 */
function goToDrop(world, rec, drop) {
    if (!drop) return halt();
    if (dropNear(rec, drop)) return null;
    const c = rec.creature || world?._ensureSettlerCreature?.(rec);
    markPathIgnore(rec, c, drop, world);
    return walkTo(drop.x, drop.y);
}

function storageNear(rec, entry) {
    return !!(entry && near(rec.x, rec.y, entry.x, entry.y));
}

function setFacing(rec, facing) {
    if (!rec || !facing) return null;
    rec.facing = facing;
    const c = rec.creature;
    if (c) c.facing = facing;
    return facing;
}

function faceToward(rec, x, y) {
    if (!rec || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const dx = x - rec.x;
    const dy = y - rec.y;
    if (!(dx || dy)) return rec.facing || null;
    const facing = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? "right" : "left")
        : (dy > 0 ? "down" : "up");
    return setFacing(rec, facing);
}

function paintStandOf(target) {
    if (!Research?.isPaintingCircle || !Research.standWorldPos) return null;
    const entry = target?.entry || target;
    if (!Research.isPaintingCircle(null, entry)) return null;
    return Research.standWorldPos(entry) || Research.standWorldPos(target);
}

function facePaint(rec, target) {
    const entry = target?.entry || target;
    return setFacing(rec, Research?.workFacing?.(entry));
}

/** Campfire art sits above the origin, same offset as PartyAI._goToFireStand. */
function faceFire(rec, fire) {
    if (!fire) return null;
    return faceToward(rec, fire.x, (Number(fire.y) || 0) - 8);
}

/** Rack sprite origin is the feet; the frame sits above it. */
function faceRack(rec, rack) {
    if (!rack) return null;
    return faceToward(rec, rack.x, (Number(rack.y) || 0) - 8);
}

function haltAtRack(rec, rack) {
    const facing = faceRack(rec, rack);
    return halt(facing ? { facing } : null);
}

function haltAtBench(rec, bench) {
    const facing = faceToward(rec, bench.x, (Number(bench.y) || 0) - 8);
    return halt(facing ? { facing } : null);
}

function walkTo(x, y, extra = null) {
    return { walkTo: { x, y }, sprint: false, ...(extra || {}) };
}

function halt(extra = null) {
    return { halt: true, ...(extra || {}) };
}

function beginWorkHold(rec, plan) {
    if (!rec) return;
    rec._workHold = true;
    rec._busyJob = plan && plan.type
        ? { type: plan.type, target: plan.target }
        : rec._busyJob;
}

function endWorkHold(rec) {
    if (!rec) return;
    rec._workHold = false;
    rec._busyJob = null;
    rec._resumeWork = false;
    rec._resumePaint = null;
    rec._savedWork = null;
    rec._researchMissMs = 0;
    rec._researchPx = null;
    rec._researchPy = null;
    clearPaintBar(rec);
}

function clearPaintBar(rec) {
    if (!rec) return;
    rec._paintChannel = null;
    rec._paintTickMin = null;
}

function setPaintBar(rec, entry) {
    if (!rec) return;
    if (entry && Research.inProgress(entry)) {
        rec._paintChannel = {
            progress: Math.max(0, Math.min(1, Number(entry.paintProgress) || 0)),
            uid: entry.uid || null,
            pigmentId: entry.paintPigment ? String(entry.paintPigment) : null
        };
        return;
    }
    rec._paintChannel = null;
}

function isWorkHold(rec) {
    return !!(rec && rec._workHold && rec._busyJob);
}

function settlerWantsBed(world, rec, mob) {
    const night = Settlement.isNight(world.gameMinutes);
    const c = rec.creature || world.creatures.get(rec.id) || mob;
    const injured = Sleep.injuredForAutofill ? Sleep.injuredForAutofill(c?.anatomy) : false;
    return Settlement.settlerShouldSleep(night, injured);
}

/**
 * Sleep freezes the job search, so `scan.night` is still set when the clock
 * jumps to morning. The tick that gets them up would otherwise order them
 * straight back to bed. Waking vacates every chunk, and a whole camp doing
 * that every frame is the stall that lasts until you leave and rejoin.
 */
function releaseStaleNightScan(world, rec, mob) {
    const scan = rec?._settlerScan;
    if (!scan?.night) return;
    if (settlerWantsBed(world, rec, mob)) return;
    scan.night = false;
    scan.bed = null;
    scan.injured = false;
}

function leaveBed(world, rec, mob) {
    const session = world._sessionOfPawn?.(rec)
        || world.players.get(rec.ownerId)
        || null;
    world._wakePawn?.(session, rec, { manual: true });
    rec._resting = false;
    rec.resting = false;
    rec._restWalk = null;
    if (mob) {
        mob._resting = false;
        mob._restWalk = null;
    }
    setSettlerAct(rec, mob, "Idle");
    return halt();
}

function sleepBedEntry(world, rec) {
    const uid = rec?._restWalk?.uid || rec?.lastSleep?.uid;
    if (!uid) return null;
    return world._findSleepByUid?.(uid, rec)?.entry || null;
}

function setSleepAct(world, rec, mob, asleep) {
    const bed = sleepBedEntry(world, rec);
    setSettlerAct(rec, mob, Settlement.actLabel(
        { type: "sleep", target: bed },
        { ...actCtx(world, rec), asleep: !!asleep }
    ));
}

function maybeLeaveBed(world, rec, mob) {
    if (!rec._resting && !rec.resting && !rec._restWalk) return null;
    if (settlerWantsBed(world, rec, mob)) {
        if (rec._resting || rec.resting) {
            setSleepAct(world, rec, mob, true);
            return halt();
        }
        setSleepAct(world, rec, mob, false);
        return halt();
    }
    return leaveBed(world, rec, mob);
}

function claimsFor(world, settle) {
    if (!world._settlerClaims) world._settlerClaims = new Map();
    const id = settle?.id;
    if (!id) return null;
    let c = world._settlerClaims.get(id);
    if (!c) {
        c = Settlement.createWorkClaims();
        world._settlerClaims.set(id, c);
    }
    return c;
}

/**
 * A basket, bill, or job change used to wipe every settler's cached search
 * and make the whole camp scan on the next tick. With a full camp that hitch
 * is most of the frame. Shared lists already rebuild once per tick; each
 * person picks a new job on their own timer. Pass one record to refresh just
 * that person (a job edit should not wait).
 */
function bumpWork(world, rec) {
    if (!rec) return;
    rec._settlerScan = null;
    rec._settlerScanMs = SCAN_MS;
}

function releaseWork(world, mob) {
    const rec = findRec(world, mob);
    if (!rec) return;
    const settle = findSettle(world, rec);
    const claims = settle ? claimsFor(world, settle) : null;
    claims?.release(rec.id);
    if (settle) reservesOf(world, settle).release(rec.id);
    rec._haulDestUid = null;
    rec._haulMergeOnly = false;
    rec._workChannel = null;
    rec._workHold = false;
    rec._busyJob = null;
    rec._resumeWork = false;
    rec._resumePaint = null;
    rec._savedWork = null;
    rec._researchPoll = 0;
    clearPaintBar(rec);
}

/** Drop sleep, eating, and jobs so the settler can fight. */
function interruptForCombat(world, recOrMob) {
    const rec = recOrMob && (world?.settlers || []).includes(recOrMob)
        ? recOrMob
        : findRec(world, recOrMob);
    if (!rec) return;
    const mob = rec.creature || recOrMob;
    const session = world._sessionOfPawn?.(rec) || world.players?.get?.(rec.ownerId) || null;
    if (rec._resting || rec.resting || rec._restWalk) {
        world._wakePawn?.(session, rec, { help: true });
    }
    rec._restWalk = null;
    if (mob) {
        mob._resting = false;
        mob._restWalk = null;
    }
    if (rec.eatChannel) world._clearEatChannel?.(rec);
    if (rec.tendChannel) world._clearTendChannel?.(rec, { cancelled: true });
    if (mob) {
        mob._eatChannel = null;
        mob._tendChannel = null;
        mob._tending = false;
    }
    clearChopApproach(rec, rec.creature || mob);
    rec._chopIgnoreUid = null;
    if (mob) mob._chopIgnoreUid = null;
    releaseWork(world, rec);
}

/**
 * Drop the job the way a fight does, but stay in bed and keep whatever
 * they are already carrying. Partial tend, craft, and swing progress is lost.
 */
function interruptForVomit(world, recOrMob) {
    const rec = recOrMob && (world?.settlers || []).includes(recOrMob)
        ? recOrMob
        : findRec(world, recOrMob);
    if (!rec) return;
    const mob = rec.creature || recOrMob;
    if (rec.eatChannel) world._clearEatChannel?.(rec);
    if (rec.tendChannel) world._clearTendChannel?.(rec, { cancelled: true });
    rec.pendingAttackAngle = null;
    rec.attackTimer = 0;
    rec.attackArt = null;
    if (mob) {
        mob._eatChannel = null;
        mob._tendChannel = null;
        mob._tending = false;
        mob._endAttack?.();
        mob.setDesiredVel?.(0, 0);
        mob.vx = 0;
        mob.vy = 0;
        if (mob.ai) {
            mob.ai.eatSeek = null;
            mob.ai.tendSeek = null;
        }
    }
    clearChopApproach(rec, rec.creature || mob);
    rec._chopIgnoreUid = null;
    if (mob) mob._chopIgnoreUid = null;
    releaseWork(world, rec);
    ctx.setSettlerAct?.(rec, mob, "Vomiting");
}

function findRec(world, mob) {
    const id = mob?.id;
    if (!id) return null;
    return (world.settlers || []).find((s) => s && s.id === id) || null;
}

function findSettle(world, rec) {
    const id = rec?.homeSettlementId;
    if (!id) return null;
    return (world.settlements || []).find((s) => s && s.id === id) || null;
}

function skipUntil(rec) {
    if (!rec._settlerSkip) rec._settlerSkip = new Map();
    return rec._settlerSkip;
}

function isSkipped(rec, key) {
    if (!key) return false;
    return Date.now() < (skipUntil(rec).get(key) || 0);
}

function skipJob(rec, key, ms = SKIP_MS) {
    if (!key) return;
    skipUntil(rec).set(key, Date.now() + ms);
}

function claimedByOther(claims, key, pawnId) {
    if (!claims || !key) return false;
    const who = claims.claimedBy(key);
    return !!(who && who !== pawnId);
}

function thingKey(entry) {
    if (!entry) return null;
    if (entry.uid) return `thing:${entry.uid}`;
    return `thing:${Math.round(entry.x || 0)}:${Math.round(entry.y || 0)}:${entry.id || ""}`;
}

function dropKey(d) {
    if (!d) return null;
    if (d.uid) return `drop:${d.uid}`;
    return `drop:${Math.round(d.x || 0)}:${Math.round(d.y || 0)}:${d.id || ""}`;
}

function stationKey(entry) {
    return entry?.uid ? `station:${entry.uid}` : null;
}

function stashKey(entry) {
    return entry?.uid ? `stash:${entry.uid}` : null;
}

function bedKey(bed) {
    const uid = bed?.entry?.uid;
    if (!uid) return null;
    return `bed:${uid}:${bed.slot ?? 0}`;
}

function pawnWorkKey(p, kind) {
    const id = p?.id;
    return id ? `${kind}:${id}` : null;
}

function leatherJobKey(job) {
    if (!job) return null;
    if (job.drop) return dropKey(job.drop);
    return stationKey(job.station || job.entry);
}

function planClaimKey(plan) {
    if (!plan) return null;
    const t = plan.type;
    if (t === "cook" || t === "cook_light" || t === "cook_stoke") {
        return stationKey(plan.target?.fire || plan.target?.entry || plan.target);
    }
    if (t === "leather") return leatherJobKey(plan.target);
    if (t === "craft") return stationKey(plan.target?.station || plan.target);
    if (t === "gather" || t === "chop" || t === "research") return thingKey(plan.target);
    if (t === "dig") return null;
    if (t === "haul") {
        if (plan.target?.claimKey) return plan.target.claimKey;
        if (plan.target?.kind && StorageFilter.mergeClaimKey) {
            return StorageFilter.mergeClaimKey(plan.target);
        }
        return dropKey(plan.target);
    }
    if (t === "doctor") return pawnWorkKey(plan.target, "tend");
    if (t === "rescue") return pawnWorkKey(plan.target, "rescue");
    if (t === "sleep") return bedKey(plan.target);
    if (t === "stash") return stashKey(plan.target);
    const owned = jobsApi().forType(t);
    const claimId = plan.target?.uid || plan.target?.id;
    if (owned && claimId) return `${t}:${claimId}`;
    return null;
}

function jobsApi() {
    if (typeof ModJobs !== "undefined") return ModJobs;
    try {
        if (typeof require === "function") return require("../mods/jobs");
    } catch (_) { /* optional */ }
    return null;
}

function lockWork(claims, pawnId, plan) {
    const key = planClaimKey(plan);
    if (!claims || !pawnId) return true;
    if (!key) {
        claims.release(pawnId);
        return true;
    }
    if (claimedByOther(claims, key, pawnId)) return false;
    return claims.claim(key, pawnId);
}

function voidPlan(scan, plan) {
    if (!scan || !plan) return;
    const t = plan.type;
    if (t === "haul") {
        scan.haulDrop = null;
        scan.haulOutput = null;
        scan.haulMerge = null;
    } else if (t === "gather") scan.gatherThing = null;
    else if (t === "dig") scan.digThing = null;
    else if (t === "chop") scan.chopTree = null;
    else if (t === "research") scan.researchCircle = null;
    else if (t === "leather") scan.leatherWork = null;
    else if (t === "craft") scan.rockWork = null;
    else if (t === "cook") scan.cookBill = null;
    else if (t === "cook_light") scan.unlitFire = null;
    else if (t === "cook_stoke") scan.stokeFire = null;
    else if (t === "sleep") scan.bed = null;
    else if (t === "doctor") {
        const p = plan.target;
        scan.patients = (scan.patients || []).filter((x) => x !== p);
        scan.critical = (scan.critical || []).filter((x) => (x.pawn || x) !== p);
    } else if (t === "rescue") {
        const p = plan.target;
        scan.rescues = (scan.rescues || []).filter((x) => x !== p);
        scan.critical = (scan.critical || []).filter((x) => (x.pawn || x) !== p);
    }
}

function settleChunks(world, settle) {
    const q = settleQ(world, settle);
    if (q.chunks) return q.chunks;
    const keys = Settlement.chunkKeysFor(settle, TS, 8) || [];
    const out = [];
    for (const key of keys) {
        const c = world.chunks.get(key);
        if (c) out.push(c);
    }
    q.chunks = out;
    return out;
}

function inRange(settle, x, y) {
    return Settlement.inRange(settle, x, y, TS);
}

function onMerge(dest, src, n) {
    const destN = Number(dest.quantity) || 1;
    dest.spoilAt = Spoil.mergeSpoilAt(destN, dest.spoilAt, n, src.spoilAt);
    Hide.applyMergedDryProgress(dest, destN, n, src.dryProgress);
    Hide.applyMergedSoakProgress(dest, destN, n, src.soakProgress);
    Fire.applyMergedStackTemp(dest, destN, n, src.temp);
}

function canCarry(rec, stack, want = 1) {
    if (!stack?.id) return false;
    const n = Math.max(1, Math.floor(Number(want) || 1));
    const meta = getItem(stack.id);
    const unitW = Carry.unitWeight(stack, meta);
    const cap = Carry.carryCap(Carry.strengthFromEquip(rec.equipment, getItem));
    const fit = Carry.countFit(
        n,
        unitW,
        Carry.gearMass(rec.inventory, rec.equipment, getItem, rec.overflow),
        cap
    );
    return fit >= 1;
}

function giveStack(world, rec, stack) {
    if (!stack?.id) return false;
    const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
    const left = world._give(rec, stack.id, qty, world._stackExtrasFrom(stack));
    return left < qty;
}

function takeOne(found) {
    return takeQty(found, 1);
}

function takeQty(found, want) {
    if (!found) return null;
    const stack = found.slots[found.index];
    if (!stack) return null;
    const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
    const n = Math.max(1, Math.min(qty, Math.floor(Number(want) || 1)));
    if (n >= qty) {
        found.slots[found.index] = null;
        return stack;
    }
    stack.quantity = qty - n;
    return { ...stack, quantity: n };
}

/** Player cook/simmer/catalyst slots only hold one item. */
function takeCookPiece(found) {
    const one = takeOne(found);
    if (one) one.quantity = 1;
    return one;
}

function takeFound(found) {
    if (!found) return null;
    const stack = found.slots[found.index];
    found.slots[found.index] = null;
    return stack || null;
}

function givePawn(rec, stack) {
    if (!stack) return false;
    const inv = rec.inventory || [];
    const empty = inv.findIndex((s) => !s);
    if (empty < 0) return false;
    inv[empty] = stack;
    return true;
}

/** Park one hotbar stack in an empty backpack slot so a tool can be held. */
function freeHandSlot(rec) {
    const inv = rec?.inventory || [];
    if (inv.some((s) => !s)) return true;
    const over = rec?.overflow || [];
    const empty = over.findIndex((s) => !s);
    const from = inv.findIndex((s) => s && s.id);
    if (empty < 0 || from < 0) return false;
    over[empty] = inv[from];
    inv[from] = null;
    return true;
}

/**
 * Select `found` on the hotbar. A backpack stack is moved into the hand,
 * swapping a hotbar stack into that pocket when the bar is full.
 */
function equipHand(rec, found) {
    if (!found || found.at !== rec) return false;
    if (found.kind !== "overflow") {
        rec.hotbarIndex = found.index;
        return true;
    }
    const piece = takeOne(found);
    if (!piece) return false;
    if (givePawn(rec, piece)) {
        const idx = (rec.inventory || []).indexOf(piece);
        if (idx >= 0) rec.hotbarIndex = idx;
        return true;
    }
    const inv = rec.inventory || [];
    const swap = inv.findIndex((s) => s && s.id);
    const hole = found.index;
    const left = found.slots[hole];
    if (swap < 0) {
        if (!left) found.slots[hole] = piece;
        else left.quantity = (Number(left.quantity) || 1) + (Number(piece.quantity) || 1);
        return false;
    }
    if (!left) {
        found.slots[hole] = inv[swap];
        inv[swap] = piece;
        rec.hotbarIndex = swap;
        return true;
    }
    const over = found.slots;
    const empty = over.findIndex((s) => !s);
    if (empty < 0) {
        left.quantity = (Number(left.quantity) || 1) + (Number(piece.quantity) || 1);
        return false;
    }
    over[empty] = inv[swap];
    inv[swap] = piece;
    rec.hotbarIndex = swap;
    return true;
}

function canGivePawn(rec, stack) {
    if (!stack?.id) return false;
    if (!(rec.inventory || []).some((s) => !s)) return false;
    return canCarry(rec, stack, Math.max(1, Number(stack.quantity) || 1));
}

function craftFreesInvSlot(rec, recipe, bill) {
    const inv = rec.inventory || [];
    const needTool = recipe?.requireTool?.toolClass;
    for (const s of inv) {
        if (!s?.id) continue;
        const qty = Math.max(1, Number(s.quantity) || 1);
        for (const ing of recipe?.ingredients || []) {
            let match = false;
            if (ing.hideStage) {
                if (Settlement.hideStageOf(getItem(s.id), s.id) !== ing.hideStage) continue;
                match = hideAllowed(bill, s);
            } else if (ing.id && ing.id !== "ANY_HIDE" && ing.id !== "ANY_LEATHER" && s.id === ing.id) {
                match = true;
            }
            if (match && qty <= (ing.qty || 1)) return true;
        }
        if (needTool && qty <= 1 && Carry.isSingleUseTool(s, getItem(s.id))
            && Carry.stackToolClass(s, getItem(s.id)) === needTool) {
            return true;
        }
    }
    return false;
}

function canReceiveCraft(world, rec, settle, recipe, bill) {
    if (!recipe?.id) return false;
    const stack = { id: recipe.id, quantity: Math.max(1, Number(recipe.quantity) || 1) };
    if (hasCarryRoom(rec, stack) && canCarry(rec, stack, stack.quantity)) return true;
    if (pickBasket(world, rec, settle, stack)) return true;
    return craftFreesInvSlot(rec, recipe, bill);
}

function stopLeather(world, rec, job, skip) {
    if (skip) skipJob(rec, leatherJobKey(job));
    endWorkHold(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = SCAN_MS;
    setSettlerAct(rec, rec.creature, "Idle");
}

function stackIsSpecial(stack) {
    return !!(stack?.customName || stack?.food || stack?.ingredients || stack?.toolClass);
}

function bagHasRoom(slots, stack) {
    if (!stack?.id || !Array.isArray(slots)) return false;
    if (slots.some((s) => !s)) return true;
    if (stackIsSpecial(stack)) return false;
    const meta = getItem(stack.id);
    const max = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
    return slots.some((s) => {
        if (!s || s.id !== stack.id || stackIsSpecial(s)) return false;
        if ((Number(s.quantity) || 1) >= max) return false;
        if ((stack.id === "pebble" || stack.id === "grindstone" || stack.id === "painting_circle") && typeof Stone !== "undefined" && Stone.stoneKey) {
            return Stone.stoneKey(s) === Stone.stoneKey(stack);
        }
        return true;
    });
}

function hasCarryRoom(rec, stack) {
    if (!stack?.id) return false;
    if (bagHasRoom(rec.inventory, stack)) return true;
    return bagHasRoom(rec.overflow, stack);
}

function takeToPawn(world, rec, stack) {
    if (!stack?.id) return 0;
    const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
    if (typeof world._give === "function") {
        const left = world._give(rec, stack.id, qty, world._stackExtrasFrom?.(stack));
        return Math.max(0, qty - Math.max(0, Number(left) || 0));
    }
    if (!givePawn(rec, { ...stack, quantity: qty })) return 0;
    return qty;
}

function insertInEntry(world, entry, stack) {
    if (!entry || !stack) return false;
    const def = world._thingDef(entry.id);
    if (Place.isStoragePit?.(def, entry) && !Place.pitFinished(entry)) return false;
    Place.ensureStorageEntry(entry, def);
    const slots = entry.slots;
    if (!Array.isArray(slots) || !stack) return false;
    StorageFilter.absorbStack(slots, stack, getItem, onMerge);
    if (!(Number(stack.quantity) > 0)) {
        StorageFilter.compactSlots(slots, getItem, onMerge);
        return true;
    }
    const empty = slots.findIndex((x) => !x);
    if (empty >= 0) {
        slots[empty] = stack;
        StorageFilter.compactSlots(slots, getItem, onMerge);
        return true;
    }
    StorageFilter.compactSlots(slots, getItem, onMerge);
    return false;
}

function emitEntry(world, entry) {
    const found = world._findThingByUid(entry?.uid);
    if (found) {
        if (world._isCampfireEntry(found.entry)) world._emitCampfire(found.chunk, found.entry);
        else world._emitStorage(found.chunk, found.entry);
    }
}

function basketsOf(world, settle) {
    const q = settleQ(world, settle);
    if (q.baskets) return q.baskets;
    const out = [];
    for (const uid of settle.stationUids || []) {
        const found = world._findThingByUid(uid);
        if (!found?.entry) continue;
        if (Settlement.stationKind(found.entry.id) !== "storage") continue;
        const def = world._thingDef(found.entry.id);
        if (Place.isStoragePit?.(def, found.entry) && !Place.pitFinished(found.entry)) continue;
        Place.ensureStorageEntry(found.entry, def);
        out.push(found.entry);
    }
    q.baskets = out;
    return out;
}

function stationsOf(world, settle, kind) {
    const q = settleQ(world, settle);
    const key = kind || "*";
    if (!q.stations) q.stations = Object.create(null);
    if (q.stations[key]) return q.stations[key];
    const out = [];
    for (const uid of settle.stationUids || []) {
        const found = world._findThingByUid(uid);
        if (!found?.entry) continue;
        const k = Settlement.stationKind(found.entry.id);
        if (kind && k !== kind) continue;
        out.push(found.entry);
    }
    q.stations[key] = out;
    return out;
}

function dropsOf(world, settle) {
    const q = settleQ(world, settle);
    if (q.drops) return q.drops;
    const out = [];
    for (const c of settleChunks(world, settle)) {
        if (!Array.isArray(c.drops)) continue;
        for (const d of c.drops) {
            if (!d || !(Number(d.quantity) > 0)) continue;
            if (!inRange(settle, d.x, d.y)) continue;
            out.push(d);
        }
    }
    q.drops = out;
    return out;
}

function lootablesOf(world, settle) {
    const q = settleQ(world, settle);
    if (q.lootables) return q.lootables;
    const out = [];
    for (const c of settleChunks(world, settle)) {
        world._ensureLootableUids(c);
        if (!Array.isArray(c.lootableThings)) continue;
        for (const e of c.lootableThings) {
            if (!e || e.gone || !e.id) continue;
            if (!inRange(settle, e.x, e.y)) continue;
            const def = world._thingDef(e.id);
            if (!def?.lootable) continue;
            out.push({ entry: e, def, chunk: c });
        }
    }
    q.lootables = out;
    return out;
}

function choppablesOf(world, settle) {
    const q = settleQ(world, settle);
    if (q.choppables) return q.choppables;
    const out = [];
    const consider = (e, chunk, list) => {
        if (!e || e.gone || !e.id) return;
        if (!inRange(settle, e.x, e.y)) return;
        const def = world._thingDef(e.id);
        if (!Chop.isChoppable(def)) return;
        if (Settlement.chopSkipsTree(e.id, def, e)) return;
        if (!Chop.stillChoppable(def, e)) return;
        out.push({ entry: e, def, chunk, list });
    };
    for (const c of settleChunks(world, settle)) {
        world._ensureLootableUids(c);
        for (const e of c.things || []) consider(e, c, "things");
        for (const e of c.lootableThings || []) consider(e, c, "lootable");
    }
    q.choppables = out;
    return out;
}

function diggablesOf(world, settle) {
    const q = settleQ(world, settle);
    if (q.diggables) return q.diggables;
    const out = [];
    if (!Dig) return out;
    for (const c of settleChunks(world, settle)) {
        for (const e of c.things || []) {
            if (!e || e.gone || !e.id) continue;
            if (!inRange(settle, e.x, e.y)) continue;
            const def = world._thingDef(e.id);
            if (!Dig.isDeposit(def) || !Dig.stillDiggable(def, e)) continue;
            out.push({ entry: e, def, chunk: c });
        }
    }
    q.diggables = out;
    return out;
}

function paintingCirclesOf(world, settle) {
    const q = settleQ(world, settle);
    if (q.paintCircles) return q.paintCircles;
    const out = [];
    if (!Research?.isPaintingCircle) return out;
    for (const c of settleChunks(world, settle)) {
        for (const e of c.things || []) {
            if (!e || e.gone || !e.id) continue;
            if (!inRange(settle, e.x, e.y)) continue;
            const def = world._thingDef(e.id);
            if (!Research.isPaintingCircle(def, e)) continue;
            Research.ensureEntry(e, def);
            if (!Research.isEnabled(e)) continue;
            if (!Research.hasRoom(e) && !Research.inProgress(e)
                && !Research.needsTallyInstall?.(settle, e)) continue;
            out.push(e);
        }
    }
    q.paintCircles = out;
    return out;
}

function pigmentOk(entry, stack) {
    if (!stack?.id || !(Number(stack.quantity) > 0) || !Research) return false;
    return Research.isPigment(getItem(stack.id), stack)
        && Research.allowsPigment(entry, stack, getItem);
}

function canHoldOne(rec, stack) {
    if (!stack?.id) return false;
    const one = { id: stack.id, quantity: 1 };
    return canCarry(rec, one, 1) && hasCarryRoom(rec, one);
}

/** Nearest ground pile this settler can pick up. */
function findSupplyDrop(world, rec, settle, pred) {
    const claims = claimsFor(world, settle);
    let best = null;
    let bestD = Infinity;
    for (const d of dropsOf(world, settle) || []) {
        if (!d || !pred(d)) continue;
        if (leaveHaulDrop(world, d)) continue;
        const key = dropKey(d);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        const qty = Math.max(0, Math.floor(Number(d.quantity) || 0));
        if (!(reservesOf(world, settle).available(key, qty, rec.id) > 0)) continue;
        if (!canHoldOne(rec, d)) continue;
        const dist = dist2(rec, d);
        if (dist < bestD) {
            bestD = dist;
            best = d;
        }
    }
    return best;
}

function findHeldOrStored(world, rec, settle, pred) {
    const found = findStack(world, rec, settle, pred);
    if (!found) return null;
    if (found.at === rec) return { found };
    if (!canHoldOne(rec, found.slots?.[found.index])) return null;
    return { found };
}

function findTally(world, rec, settle) {
    const id = Research?.TALLY_ITEM_ID || "tally_stick";
    const pred = (s) => s?.id === id && Number(s.quantity) > 0;
    const held = findHeldOrStored(world, rec, settle, pred);
    if (held) return held;
    const drop = findSupplyDrop(world, rec, settle, pred);
    return drop ? { drop } : null;
}

function findPigment(world, rec, settle, entry) {
    const pred = (s) => pigmentOk(entry, s);
    const held = findHeldOrStored(world, rec, settle, pred);
    if (held) return held;
    const drop = findSupplyDrop(world, rec, settle, pred);
    return drop ? { drop } : null;
}

/**
 * A circle is work only when this settler can do something with it.
 * Selecting one with no dye, no tally, and no painting in progress made
 * them halt every tick while the label stayed "Painting".
 */
function circleWorkable(world, rec, settle, entry) {
    if (!entry || entry.gone || !Research?.isEnabled?.(entry)) return false;
    const holder = researchHolder(world, rec, settle);
    const needsTally = !!Research.needsTallyInstall?.(holder, entry);
    const tally = needsTally && !!findTally(world, rec, settle);
    if (!Research.hasRoom(entry) && !Research.inProgress(entry)) return tally;
    if (Research.inProgress(entry)) return true;
    // A tally goes in before the first dye. Dye alone is enough when the stick
    // is already there, or when counting is not known yet.
    if (tally) return true;
    if (Research.needsPigment(entry)) return !!findPigment(world, rec, settle, entry);
    return false;
}

function researchCircle(world, rec, settle, claims) {
    const list = paintingCirclesOf(world, settle);
    if (!list.length) return null;
    const mine = claims?.held(rec.id);
    if (mine && mine.startsWith("thing:")) {
        const held = list.find((e) => thingKey(e) === mine);
        if (held && !isSkipped(rec, mine) && circleWorkable(world, rec, settle, held)) return held;
    }
    let best = null;
    let bestD = Infinity;
    for (const e of list) {
        const key = thingKey(e);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        if (!circleWorkable(world, rec, settle, e)) continue;
        const d = Math.hypot(rec.x - e.x, rec.y - e.y);
        if (d < bestD) {
            bestD = d;
            best = e;
        }
    }
    return best;
}

function settlersOf(world, settle) {
    const q = settleQ(world, settle);
    if (q.settlers) return q.settlers;
    const list = (world.settlers || []).filter(
        (s) => s && !s.dead && s.homeSettlementId === settle.id
    );
    const sorted = (Settlement?.sortByJobOrder && settle)
        ? Settlement.sortByJobOrder(settle, list, (s) => s.id)
        : list;
    q.settlers = sorted;
    return sorted;
}

function countStored(world, settle, itemId) {
    let n = Settlement.countStock(basketsOf(world, settle), itemId);
    n += Settlement.countPawnStock(settlersOf(world, settle), itemId);
    return n;
}

function countItem(world, settle, itemId) {
    return countStored(world, settle, itemId)
        + Settlement.countDropStock(dropsOf(world, settle), itemId);
}

function haulDropQty(world, rec, settle, drop) {
    const stack = dropAsStack(drop);
    if (!stack) return 0;
    const key = dropKey(drop);
    const avail = reservesOf(world, settle).available(key, stack.quantity, rec.id);
    if (!(avail > 0)) return 0;
    return Settlement.haulTakeQty(
        countStored(world, settle, stack.id),
        Settlement.stockTarget(settle, stack.id),
        avail
    );
}

function pickBasket(world, rec, settle, stack) {
    return StorageFilter.pickBasket(basketsOf(world, settle), stack, getItem, rec.x, rec.y);
}

function dropAsStack(drop) {
    if (!drop?.id) return null;
    return {
        id: drop.id,
        quantity: drop.quantity || 1,
        toolClass: drop.toolClass,
        customName: drop.customName,
        food: drop.food,
        ingredients: drop.ingredients,
        spoilAt: drop.spoilAt,
        dryProgress: drop.dryProgress,
        soakProgress: drop.soakProgress,
        soakDoneAt: drop.soakDoneAt
    };
}

/** Same reach as lighting a ground fire (HARVEST_RANGE_TILES). */
const HAUL_HOLD_TILES = 4;

function findHaulHoldOwner(world, id) {
    if (!world || !id) return null;
    const players = world.players;
    if (players && typeof players.get === "function") {
        const session = players.get(id);
        if (session) return session.dead ? null : session;
        if (typeof players.values === "function") {
            for (const p of players.values()) {
                const mem = (p?.party || []).find((m) => m && m.id === id);
                if (mem) return mem.dead ? null : mem;
            }
        }
    }
    const creature = world.creatures?.get?.(id);
    if (creature) return creature.dead ? null : creature;
    return null;
}

/**
 * Player-laid sticks and leaves stay put while the dropper is still in
 * fire-lighting range. Leaving clears the hold for good.
 */
function haulHoldBlocks(world, drop) {
    const id = drop?.haulHoldOwner;
    if (!id) return false;
    const owner = findHaulHoldOwner(world, id);
    const ox = Number(owner?.x);
    const oy = Number(owner?.y);
    const dx = Number(drop.x);
    const dy = Number(drop.y);
    const range = (TS || 16) * HAUL_HOLD_TILES;
    const near = owner && !owner.dead
        && Number.isFinite(ox) && Number.isFinite(oy)
        && Number.isFinite(dx) && Number.isFinite(dy)
        && (ox - dx) * (ox - dx) + (oy - dy) * (oy - dy) <= range * range;
    if (near) return true;
    delete drop.haulHoldOwner;
    return false;
}

function leaveHaulDrop(world, drop) {
    if (haulHoldBlocks(world, drop)) return true;
    const def = getItem(drop?.id);
    return Hide.leaveHaulInWater(def, world._dropIsOnWater(drop));
}

/** Ground pile a haul job walks to. Basket merges are not piles. */
function groundHaulDrop(job) {
    if (!job || job.type !== "haul") return null;
    const drop = job.target;
    if (!drop?.uid || !drop.id) return null;
    if (drop.kind === "pack" || drop.kind === "move" || drop.kind === "smoke_out") return null;
    return drop;
}

function chunkHasDrop(chunk, uid) {
    const list = chunk?.drops;
    if (!Array.isArray(list)) return false;
    for (const d of list) {
        if (d && d.uid === uid && Number(d.quantity) > 0) return true;
    }
    return false;
}

/** True while this pile is still on the ground. Uid-less piles are left to pickup. */
function haulDropLive(world, drop) {
    if (!drop?.id || !(Number(drop.quantity) > 0)) return false;
    if (!drop.uid) return true;
    const x = Number(drop.x) || 0;
    const y = Number(drop.y) || 0;
    const near = world?._chunksNear?.(x, y, 0, { load: false });
    if (Array.isArray(near)) {
        for (const c of near) {
            if (chunkHasDrop(c, drop.uid)) return true;
        }
        return false;
    }
    const all = world?.chunks;
    if (all && typeof all.values === "function") {
        for (const c of all.values()) {
            if (chunkHasDrop(c, drop.uid)) return true;
        }
    }
    return false;
}

/**
 * The haul they are walking to (or the cached pile they are about to take)
 * was picked up. Carrying it to storage is not this case.
 */
function haulTargetMissing(world, rec) {
    if (!rec || rec._haulDestUid) return false;
    const busy = groundHaulDrop(rec._busyJob);
    if (busy) return !haulDropLive(world, busy);
    if (rec._busyJob?.type === "haul") return false;
    const scanned = groundHaulDrop({ type: "haul", target: rec._settlerScan?.haulDrop });
    return !!(scanned && !haulDropLive(world, scanned));
}

/** Forget a haul whose pile is gone so the next scan can pick another job. */
function abandonHaul(world, rec, settle) {
    if (!rec) return;
    if (settle) claimsFor(world, settle)?.release(rec.id);
    endWorkHold(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = SCAN_MS;
    if (settle) {
        const q = settleQ(world, settle);
        if (q) q.drops = null;
    }
}

/** Highest chop percent across hotbar, overflow, and baskets. Ties keep that scan order. */
function findBestChopStack(world, rec, settle) {
    if (typeof Chop === "undefined" || !Chop.chopFraction) return null;
    let best = null;
    let bestFrac = 0;
    const consider = (slots, index, at, kind, extra) => {
        const frac = Chop.chopFraction(slots[index]);
        if (!(frac > bestFrac)) return;
        bestFrac = frac;
        best = { slots, index, at, kind, ...extra };
    };
    const inv = rec?.inventory || [];
    for (let i = 0; i < inv.length; i++) {
        if (inv[i]) consider(inv, i, rec, "inv", { bag: "hotbar" });
    }
    const overflow = rec?.overflow || [];
    for (let i = 0; i < overflow.length; i++) {
        if (overflow[i]) consider(overflow, i, rec, "overflow", { bag: "overflow" });
    }
    for (const b of basketsOf(world, settle)) {
        const slots = b.slots || [];
        for (let i = 0; i < slots.length; i++) {
            if (!slots[i]) continue;
            const avail = reservesOf(world, settle).available(
                `basket:${b.uid}:${i}`,
                slots[i].quantity,
                rec.id
            );
            if (!(avail > 0)) continue;
            consider(slots, i, b, "basket", { entry: b });
        }
    }
    return best;
}

/** Closest storage pile. Carried stacks count as distance 0 and win ties.
 *  `storageOnly` skips pockets so a short backpack stack does not hide a basket. */
function findNearestStored(world, rec, settle, pred, opts) {
    let best = null;
    let bestD = Infinity;
    const consider = (slots, index, at, kind, extra, dist) => {
        if (!(dist < bestD)) return;
        const stack = slots[index];
        if (!stack || !pred(stack)) return;
        if (kind === "basket") {
            const avail = reservesOf(world, settle).available(
                `basket:${extra.entry.uid}:${index}`,
                stack.quantity,
                rec.id
            );
            if (!(avail > 0)) return;
        }
        bestD = dist;
        best = { slots, index, at, kind, ...extra };
    };
    if (!opts?.storageOnly) {
        const inv = rec?.inventory || [];
        for (let i = 0; i < inv.length; i++) {
            if (inv[i]) consider(inv, i, rec, "inv", { bag: "hotbar" }, 0);
        }
        const overflow = rec?.overflow || [];
        for (let i = 0; i < overflow.length; i++) {
            if (overflow[i]) consider(overflow, i, rec, "overflow", { bag: "overflow" }, 0);
        }
    }
    for (const b of basketsOf(world, settle)) {
        const slots = b.slots || [];
        const dist = dist2(rec, b);
        for (let i = 0; i < slots.length; i++) {
            if (!slots[i]) continue;
            consider(slots, i, b, "basket", { entry: b }, dist);
        }
    }
    return best;
}

function countToolClass(world, settle, toolClass) {
    return Settlement.countToolClassStock(
        basketsOf(world, settle),
        settlersOf(world, settle),
        dropsOf(world, settle),
        toolClass
    );
}

function findStack(world, rec, settle, pred) {
    const inv = rec.inventory || [];
    const ii = inv.findIndex((s) => s && pred(s));
    if (ii >= 0) return { slots: inv, index: ii, at: rec, kind: "inv", bag: "hotbar" };
    const overflow = rec.overflow || [];
    const oi = overflow.findIndex((s) => s && pred(s));
    if (oi >= 0) return { slots: overflow, index: oi, at: rec, kind: "overflow", bag: "overflow" };
    for (const b of basketsOf(world, settle)) {
        const slots = b.slots || [];
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (!s || !pred(s)) continue;
            const avail = reservesOf(world, settle).available(
                `basket:${b.uid}:${i}`,
                s.quantity,
                rec.id
            );
            if (!(avail > 0)) continue;
            return { slots, index: i, at: b, kind: "basket", entry: b };
        }
    }
    return null;
}

function dist2(a, b) {
    return Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.y) || 0) - (Number(b?.y) || 0));
}

const FOOD_RESERVE_KIND = "food";

function reservesOf(world, settle) {
    return Settlement.medicineReservesFor(world, settle?.id);
}

function releaseFoodReserve(world, rec, settle) {
    if (!rec || !settle) return;
    reservesOf(world, settle).releaseKind(rec.id, FOOD_RESERVE_KIND);
}

function reserveKeyQty(world, settle, key) {
    const basket = /^basket:(.+):(\d+)$/.exec(String(key || ""));
    if (basket) {
        const entry = basketsOf(world, settle).find((b) => String(b.uid) === basket[1]);
        const stack = entry?.slots?.[Number(basket[2])];
        return Math.max(0, Math.floor(Number(stack?.quantity) || 0));
    }
    if (String(key || "").startsWith("drop:")) {
        const drop = (dropsOf(world, settle) || []).find((d) => dropKey(d) === key);
        return Math.max(0, Math.floor(Number(drop?.quantity) || 0));
    }
    return 0;
}

/** True when someone took units this pawn had claimed for a meal. */
function eatReserveBroken(world, rec, settle) {
    if (!rec || !settle) return false;
    const rows = reservesOf(world, settle).held(rec.id, FOOD_RESERVE_KIND);
    for (let i = 0; i < rows.length; i++) {
        if (reserveKeyQty(world, settle, rows[i].key) < rows[i].qty) return true;
    }
    return false;
}

function foundAvail(world, rec, settle, found) {
    const stack = found?.slots?.[found.index];
    const qty = Math.max(0, Math.floor(Number(stack?.quantity) || 0));
    if (!found || found.at === rec || found.kind === "inv" || found.kind === "overflow") return qty;
    const key = medicineKey(found);
    if (!key) return qty;
    return reservesOf(world, settle).available(key, qty, rec.id);
}

function medicineKey(found) {
    if (!found) return null;
    if (found.kind === "drop" && found.drop) return dropKey(found.drop);
    if (found.kind === "basket" && found.entry?.uid != null) {
        return `basket:${found.entry.uid}:${found.index}`;
    }
    return null;
}

function poulticeBatch() {
    const n = Number(getItem("poultice")?.bandage?.batchSeverity);
    return Number.isFinite(n) ? n : 20;
}

function cordBatch() {
    const n = Number(getItem("leaf_cord")?.bandage?.batchSeverity);
    return Number.isFinite(n) ? n : 0;
}

function sourceAvail(world, rec, settle, found, pawnId) {
    const stack = found?.slots?.[found.index] || found?.stack;
    const qty = Math.max(0, Math.floor(Number(stack?.quantity) || 0));
    if (!(qty > 0)) return 0;
    const key = medicineKey(found);
    if (!key) return qty;
    const claims = claimsFor(world, settle);
    if (found.kind === "drop" && found.drop && claimedByOther(claims, dropKey(found.drop), pawnId)) {
        return 0;
    }
    return reservesOf(world, settle).available(key, qty, pawnId);
}

function listMedicineSources(world, rec, settle, patient, claims) {
    const out = [];
    const addPawn = (pawn, kind) => {
        if (!pawn) return;
        const add = (slots, bag) => {
            for (let i = 0; i < (slots || []).length; i++) {
                const s = slots[i];
                if (!s?.id || !getItem(s.id)?.bandage) continue;
                out.push({
                    slots,
                    index: i,
                    at: pawn,
                    kind,
                    bag,
                    stack: s,
                    id: s.id,
                    entry: null,
                    drop: null
                });
            }
        };
        add(pawn.inventory, "hotbar");
        add(pawn.overflow, "overflow");
    };
    addPawn(rec, "inv");
    if (patient && patient !== rec && patient.id !== rec.id) addPawn(patient, "patient");
    const baskets = (basketsOf(world, settle) || []).slice()
        .sort((a, b) => dist2(rec, a) - dist2(rec, b));
    for (const b of baskets) {
        const slots = b.slots || [];
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (!s?.id || !getItem(s.id)?.bandage) continue;
            out.push({
                slots,
                index: i,
                at: b,
                kind: "basket",
                bag: "basket",
                stack: s,
                id: s.id,
                entry: b,
                drop: null
            });
        }
    }
    const drops = (dropsOf(world, settle) || [])
        .filter((d) => d?.id && getItem(d.id)?.bandage)
        .sort((a, b) => dist2(rec, a) - dist2(rec, b));
    for (const d of drops) {
        if (claimedByOther(claims, dropKey(d), rec.id)) continue;
        const stack = dropAsStack(d);
        out.push({
            slots: [stack],
            index: 0,
            at: d,
            kind: "drop",
            bag: "drop",
            stack,
            id: d.id,
            entry: null,
            drop: d
        });
    }
    return out;
}

function assignMedicineTakes(world, rec, settle, sources, itemId, wantQty) {
    let left = Math.max(0, Math.floor(Number(wantQty) || 0));
    const takes = [];
    if (!(left > 0) || !itemId) return takes;
    for (const src of sources) {
        if (left <= 0) break;
        if (src.id !== itemId) continue;
        const key = medicineKey(src);
        if (key && isSkipped(rec, key)) continue;
        const avail = sourceAvail(world, rec, settle, src, rec.id);
        if (avail <= 0) continue;
        const n = Math.min(avail, left);
        takes.push({ ...src, qty: n, key });
        left -= n;
    }
    return takes;
}

function heldBandageCount(rec, itemId) {
    let n = 0;
    for (const s of rec.inventory || []) {
        if (s?.id === itemId) n += Math.max(1, Number(s.quantity) || 1);
    }
    for (const s of rec.overflow || []) {
        if (s?.id === itemId) n += Math.max(1, Number(s.quantity) || 1);
    }
    return n;
}

function pickDoctorBandage(rec) {
    return BodyHealing.pickBestBandage(
        [
            { slots: rec.inventory || [], bag: "hotbar", at: rec, kind: "inv", source: rec },
            { slots: rec.overflow || [], bag: "overflow", at: rec, kind: "overflow", source: rec }
        ],
        getItem
    );
}

function abandonMedicineTake(world, rec, settle, take) {
    if (!take?.key) return;
    reservesOf(world, settle).reduce(rec.id, take.key, take.qty);
    skipJob(rec, take.key);
}

function medicineWalkStuck(world, rec) {
    const c = rec.creature || world.creatures?.get?.(rec.id);
    const ai = c?.ai;
    return (ai?._jamMs || 0) > 900 || (ai?._stuckMs || 0) > 1800;
}

function fetchMedicineTake(world, rec, settle, take) {
    if (!take || take.kind === "inv") return null;
    if (take.kind === "drop") {
        const walked = goToDrop(world, rec, take.drop);
        if (walked) {
            if (medicineWalkStuck(world, rec)) {
                abandonMedicineTake(world, rec, settle, take);
                return halt();
            }
            return walked;
        }
        const before = heldBandageCount(rec, take.id);
        world._tryPickup?.(rec, { dropId: take.drop.uid, quantity: take.qty });
        const got = Math.max(0, heldBandageCount(rec, take.id) - before);
        if (got > 0) {
            if (take.key) reservesOf(world, settle).reduce(rec.id, take.key, got);
            world._queryGen = (world._queryGen || 0) + 1;
            world._dirtyPawnOwner(rec);
        } else {
            abandonMedicineTake(world, rec, settle, take);
        }
        return halt();
    }
    const walked = take.kind === "patient"
        ? goOrWalk(world, rec, take.at)
        : walkToFound(world, rec, take);
    if (walked) {
        if (medicineWalkStuck(world, rec)) {
            abandonMedicineTake(world, rec, settle, take);
            return halt();
        }
        return walked;
    }
    const piece = takeQty(take, take.qty);
    if (!piece) {
        abandonMedicineTake(world, rec, settle, take);
        return halt();
    }
    const got = takeToPawn(world, rec, piece);
    if (!(got > 0)) {
        restorePiece(take, piece);
        abandonMedicineTake(world, rec, settle, take);
        return halt();
    }
    if (got < (Number(piece.quantity) || 1)) {
        restorePiece(take, { ...piece, quantity: (Number(piece.quantity) || 1) - got });
    }
    if (take.entry) emitEntry(world, take.entry);
    if (take.key) reservesOf(world, settle).reduce(rec.id, take.key, got);
    world._dirtyPawnOwner(rec);
    if (take.kind === "patient" && take.at) world._dirtyPawnOwner(take.at);
    return halt();
}

function findHeld(rec, pred) {
    const inv = rec.inventory || [];
    const ii = inv.findIndex((s) => s && pred(s));
    if (ii >= 0) return { slots: inv, index: ii, at: rec, kind: "inv", bag: "hotbar" };
    const overflow = rec.overflow || [];
    const oi = overflow.findIndex((s) => s && pred(s));
    if (oi >= 0) return { slots: overflow, index: oi, at: rec, kind: "overflow", bag: "overflow" };
    return null;
}

function findStored(world, rec, settle, pred) {
    for (const b of basketsOf(world, settle)) {
        const slots = b.slots || [];
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (!s || !pred(s)) continue;
            const avail = reservesOf(world, settle).available(
                `basket:${b.uid}:${i}`,
                s.quantity,
                rec.id
            );
            if (!(avail > 0)) continue;
            return { slots, index: i, at: b, kind: "basket", entry: b };
        }
    }
    return null;
}

function heldPredQty(rec, pred) {
    return Settlement.countPredQty(rec.inventory, pred)
        + Settlement.countPredQty(rec.overflow, pred);
}

function keepGearOpts(keepBandageOrOpts) {
    const preds = Array.isArray(keepBandageOrOpts?.keepPreds)
        ? keepBandageOrOpts.keepPreds.filter((p) => typeof p === "function")
        : null;
    if (keepBandageOrOpts && typeof keepBandageOrOpts === "object") {
        return {
            keepBandage: !!keepBandageOrOpts.keepBandage,
            keepPigment: !!keepBandageOrOpts.keepPigment,
            isPigment: typeof keepBandageOrOpts.isPigment === "function"
                ? keepBandageOrOpts.isPigment
                : null,
            keepPreds: preds && preds.length ? preds : null
        };
    }
    return {
        keepBandage: !!keepBandageOrOpts,
        keepPigment: false,
        isPigment: null,
        keepPreds: null
    };
}

function stashScan(world, rec, settle, keepBandageOrOpts) {
    const canStore = (s) => !!pickBasket(world, rec, settle, s);
    const opts = keepGearOpts(keepBandageOrOpts);
    if (!Settlement.hasStashable(rec.inventory, rec.overflow, getItem, canStore, opts)) {
        return { basket: null, has: false, urgent: false, hasFood: false };
    }
    const keep = Settlement.keepIndices(rec.inventory, getItem, opts);
    let basket = null;
    const tryPick = (s) => {
        if (!s || basket) return;
        basket = pickBasket(world, rec, settle, s);
    };
    for (let i = 0; i < (rec.inventory || []).length; i++) {
        if (keep.has(i)) continue;
        tryPick(rec.inventory[i]);
    }
    for (const s of rec.overflow || []) tryPick(s);
    return {
        basket,
        has: !!basket,
        urgent: !!Settlement.stashIsUrgent(rec.inventory, rec.overflow, getItem, canStore, opts),
        hasFood: !!Settlement.hasStashableFood(rec.inventory, rec.overflow, getItem, canStore, opts)
    };
}

function depositKeepGear(world, rec, settle, keepBandageOrOpts, dest = null) {
    const keep = Settlement.keepIndices(rec.inventory, getItem, keepGearOpts(keepBandageOrOpts));
    const dump = (slots, skipKeep) => {
        if (!slots) return;
        for (let i = 0; i < slots.length; i++) {
            if (skipKeep && keep.has(i)) continue;
            const s = slots[i];
            if (!s) continue;
            if (
                dest
                && storageNear(rec, dest)
                && StorageFilter.allows(dest.storageFilter, s, getItem)
                && insertInEntry(world, dest, s)
            ) {
                slots[i] = null;
                emitEntry(world, dest);
                continue;
            }
            const b = pickBasket(world, rec, settle, s);
            if (!b || !storageNear(rec, b)) continue;
            if (insertInEntry(world, b, s)) {
                slots[i] = null;
                emitEntry(world, b);
            }
        }
    };
    dump(rec.inventory, true);
    dump(rec.overflow, false);
    world._dirtyPawnOwner(rec);
}
    ctx.getItem = getItem;
    ctx.researchHolder = researchHolder;
    ctx.beginSettleQueries = beginSettleQueries;
    ctx.settleQ = settleQ;
    ctx.jobOn = jobOn;
    ctx.near = near;
    ctx.dropNear = dropNear;
    ctx.goToDrop = goToDrop;
    ctx.storageNear = storageNear;
    ctx.setFacing = setFacing;
    ctx.faceToward = faceToward;
    ctx.paintStandOf = paintStandOf;
    ctx.facePaint = facePaint;
    ctx.faceFire = faceFire;
    ctx.faceRack = faceRack;
    ctx.haltAtRack = haltAtRack;
    ctx.haltAtBench = haltAtBench;
    ctx.walkTo = walkTo;
    ctx.halt = halt;
    ctx.beginWorkHold = beginWorkHold;
    ctx.endWorkHold = endWorkHold;
    ctx.clearPaintBar = clearPaintBar;
    ctx.setPaintBar = setPaintBar;
    ctx.isWorkHold = isWorkHold;
    ctx.settlerWantsBed = settlerWantsBed;
    ctx.releaseStaleNightScan = releaseStaleNightScan;
    ctx.leaveBed = leaveBed;
    ctx.sleepBedEntry = sleepBedEntry;
    ctx.setSleepAct = setSleepAct;
    ctx.maybeLeaveBed = maybeLeaveBed;
    ctx.claimsFor = claimsFor;
    ctx.bumpWork = bumpWork;
    ctx.releaseWork = releaseWork;
    ctx.interruptForCombat = interruptForCombat;
    ctx.interruptForVomit = interruptForVomit;
    ctx.findRec = findRec;
    ctx.findSettle = findSettle;
    ctx.skipUntil = skipUntil;
    ctx.isSkipped = isSkipped;
    ctx.skipJob = skipJob;
    ctx.claimedByOther = claimedByOther;
    ctx.thingKey = thingKey;
    ctx.dropKey = dropKey;
    ctx.stationKey = stationKey;
    ctx.stashKey = stashKey;
    ctx.bedKey = bedKey;
    ctx.pawnWorkKey = pawnWorkKey;
    ctx.leatherJobKey = leatherJobKey;
    ctx.planClaimKey = planClaimKey;
    ctx.jobsApi = jobsApi;
    ctx.lockWork = lockWork;
    ctx.voidPlan = voidPlan;
    ctx.settleChunks = settleChunks;
    ctx.inRange = inRange;
    ctx.onMerge = onMerge;
    ctx.canCarry = canCarry;
    ctx.giveStack = giveStack;
    ctx.takeOne = takeOne;
    ctx.takeQty = takeQty;
    ctx.takeCookPiece = takeCookPiece;
    ctx.takeFound = takeFound;
    ctx.givePawn = givePawn;
    ctx.freeHandSlot = freeHandSlot;
    ctx.equipHand = equipHand;
    ctx.canGivePawn = canGivePawn;
    ctx.walkStuck = medicineWalkStuck;
    ctx.craftFreesInvSlot = craftFreesInvSlot;
    ctx.canReceiveCraft = canReceiveCraft;
    ctx.stopLeather = stopLeather;
    ctx.stackIsSpecial = stackIsSpecial;
    ctx.bagHasRoom = bagHasRoom;
    ctx.hasCarryRoom = hasCarryRoom;
    ctx.takeToPawn = takeToPawn;
    ctx.insertInEntry = insertInEntry;
    ctx.emitEntry = emitEntry;
    ctx.basketsOf = basketsOf;
    ctx.stationsOf = stationsOf;
    ctx.dropsOf = dropsOf;
    ctx.haulDropLive = haulDropLive;
    ctx.haulTargetMissing = haulTargetMissing;
    ctx.abandonHaul = abandonHaul;
    ctx.lootablesOf = lootablesOf;
    ctx.choppablesOf = choppablesOf;
    ctx.diggablesOf = diggablesOf;
    ctx.paintingCirclesOf = paintingCirclesOf;
    ctx.researchCircle = researchCircle;
    ctx.findTally = findTally;
    ctx.findPigment = findPigment;
    ctx.pigmentOk = pigmentOk;
    ctx.settlersOf = settlersOf;
    ctx.countStored = countStored;
    ctx.countItem = countItem;
    ctx.haulDropQty = haulDropQty;
    ctx.pickBasket = pickBasket;
    ctx.dropAsStack = dropAsStack;
    ctx.leaveHaulDrop = leaveHaulDrop;
    ctx.findStack = findStack;
    ctx.findNearestStored = findNearestStored;
    ctx.countToolClass = countToolClass;
    ctx.findBestChopStack = findBestChopStack;
    ctx.dist2 = dist2;
    ctx.reservesOf = reservesOf;
    ctx.releaseFoodReserve = releaseFoodReserve;
    ctx.eatReserveBroken = eatReserveBroken;
    ctx.foundAvail = foundAvail;
    ctx.medicineKey = medicineKey;
    ctx.poulticeBatch = poulticeBatch;
    ctx.cordBatch = cordBatch;
    ctx.sourceAvail = sourceAvail;
    ctx.listMedicineSources = listMedicineSources;
    ctx.assignMedicineTakes = assignMedicineTakes;
    ctx.heldBandageCount = heldBandageCount;
    ctx.pickDoctorBandage = pickDoctorBandage;
    ctx.abandonMedicineTake = abandonMedicineTake;
    ctx.medicineWalkStuck = medicineWalkStuck;
    ctx.fetchMedicineTake = fetchMedicineTake;
    ctx.findHeld = findHeld;
    ctx.findStored = findStored;
    ctx.heldPredQty = heldPredQty;
    ctx.keepGearOpts = keepGearOpts;
    ctx.stashScan = stashScan;
    ctx.depositKeepGear = depositKeepGear;
});
