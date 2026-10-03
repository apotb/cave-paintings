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

function bumpWork(world) {
    for (const rec of world?.settlers || []) {
        if (!rec) continue;
        rec._settlerScan = null;
        rec._settlerScanMs = SCAN_MS;
    }
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
        scan.haulMerge = null;
    } else if (t === "gather") scan.gatherThing = null;
    else if (t === "dig") scan.digThing = null;
    else if (t === "chop") scan.chopTree = null;
    else if (t === "research") scan.researchCircle = null;
    else if (t === "leather") scan.leatherWork = null;
    else if (t === "cook") scan.cookBill = null;
    else if (t === "cook_light") scan.unlitFire = null;
    else if (t === "cook_stoke") scan.stokeFire = null;
    else if (t === "sleep") scan.bed = null;
    else if (t === "doctor") {
        const p = plan.target;
        scan.patients = (scan.patients || []).filter((x) => x !== p);
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
    return slots.some((s) => s && s.id === stack.id && !stackIsSpecial(s) && (Number(s.quantity) || 1) < max);
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
    Place.ensureStorageEntry(entry, world._thingDef(entry.id));
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
        Place.ensureStorageEntry(found.entry, world._thingDef(found.entry.id));
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

function researchCircle(world, rec, settle, claims) {
    const list = paintingCirclesOf(world, settle);
    if (!list.length) return null;
    const mine = claims?.held(rec.id);
    if (mine && mine.startsWith("thing:")) {
        const held = list.find((e) => thingKey(e) === mine);
        if (held && !isSkipped(rec, mine)) return held;
    }
    let best = null;
    let bestD = Infinity;
    for (const e of list) {
        const key = thingKey(e);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        const d = Math.hypot(rec.x - e.x, rec.y - e.y);
        if (d < bestD) {
            bestD = d;
            best = e;
        }
    }
    return best;
}

function settlersOf(world, settle) {
    const list = (world.settlers || []).filter(
        (s) => s && !s.dead && s.homeSettlementId === settle.id
    );
    if (Settlement?.sortByJobOrder && settle) {
        return Settlement.sortByJobOrder(settle, list, (s) => s.id);
    }
    return list;
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

function leaveHaulDrop(world, drop) {
    const def = getItem(drop?.id);
    return Hide.leaveHaulInWater(def, world._dropIsOnWater(drop));
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
        const i = slots.findIndex((s) => s && pred(s));
        if (i < 0) continue;
        return { slots, index: i, at: b, kind: "basket", entry: b };
    }
    return null;
}

function dist2(a, b) {
    return Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.y) || 0) - (Number(b?.y) || 0));
}

function reservesOf(world, settle) {
    return Settlement.medicineReservesFor(world, settle?.id);
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
        const i = slots.findIndex((s) => s && pred(s));
        if (i < 0) continue;
        return { slots, index: i, at: b, kind: "basket", entry: b };
    }
    return null;
}

function heldPredQty(rec, pred) {
    return Settlement.countPredQty(rec.inventory, pred)
        + Settlement.countPredQty(rec.overflow, pred);
}

function keepGearOpts(keepBandageOrOpts) {
    if (keepBandageOrOpts && typeof keepBandageOrOpts === "object") {
        return {
            keepBandage: !!keepBandageOrOpts.keepBandage,
            keepPigment: !!keepBandageOrOpts.keepPigment,
            isPigment: typeof keepBandageOrOpts.isPigment === "function"
                ? keepBandageOrOpts.isPigment
                : null
        };
    }
    return {
        keepBandage: !!keepBandageOrOpts,
        keepPigment: false,
        isPigment: null
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
    ctx.leaveBed = leaveBed;
    ctx.sleepBedEntry = sleepBedEntry;
    ctx.setSleepAct = setSleepAct;
    ctx.maybeLeaveBed = maybeLeaveBed;
    ctx.claimsFor = claimsFor;
    ctx.bumpWork = bumpWork;
    ctx.releaseWork = releaseWork;
    ctx.interruptForCombat = interruptForCombat;
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
    ctx.canGivePawn = canGivePawn;
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
    ctx.lootablesOf = lootablesOf;
    ctx.choppablesOf = choppablesOf;
    ctx.diggablesOf = diggablesOf;
    ctx.paintingCirclesOf = paintingCirclesOf;
    ctx.researchCircle = researchCircle;
    ctx.settlersOf = settlersOf;
    ctx.countStored = countStored;
    ctx.countItem = countItem;
    ctx.haulDropQty = haulDropQty;
    ctx.pickBasket = pickBasket;
    ctx.dropAsStack = dropAsStack;
    ctx.leaveHaulDrop = leaveHaulDrop;
    ctx.findStack = findStack;
    ctx.dist2 = dist2;
    ctx.reservesOf = reservesOf;
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
