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
        const Carry = require("../carry");
        const Party = require("../party");
        const Spoil = require("../spoil");
        const Fire = require("../fire");
        const BodyHealing = require("../body/Healing");
        const BodyCombat = require("../body/Combat");
        const DataStore = require("../DataStore");
        const Research = require("../research");
        module.exports = factory(
            Settlement, StorageFilter, FuelFilter, Place, Sleep, Hide, Chop, Carry, Party,
            Spoil, Fire, BodyHealing, BodyCombat, DataStore, Research
        );
    } else {
        root.SettlerWork = factory(
            root.Settlement, root.StorageFilter, root.FuelFilter, root.Place, root.Sleep, root.Hide,
            root.Chop, root.Carry, root.Party, root.Spoil || root.NetSpoil, root.Fire,
            root.BodyHealing, root.BodyCombat, root.DataStore, root.Research
        );
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
    Settlement, StorageFilter, FuelFilter, Place, Sleep, Hide, Chop, Carry, Party,
    Spoil, Fire, BodyHealing, BodyCombat, DataStore, Research
) {

const TS = 16;
const SCAN_MS = 280;
const INTERACT_TILES = 2.4;
/** Matches SimWorld._tryPickup when a dropId is given. */
const PICKUP_TILES = 3;
const SKIP_MS = 4500;
const AUTO_EAT = Party.AUTO_EAT_BELOW || 1000;
const AUTO_EAT_UNTIL = Party.AUTO_EAT_UNTIL || 1400;

function getItem(id) {
    return DataStore.getItem(id);
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
    return (world.settlers || []).filter(
        (s) => s && !s.dead && s.homeSettlementId === settle.id
    );
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
    return Settlement.haulTakeQty(
        countStored(world, settle, stack.id),
        Settlement.stockTarget(settle, stack.id),
        stack.quantity
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

function haulDrop(world, rec, settle, claims) {
    const drops = dropsOf(world, settle);
    const mine = claims?.held(rec.id);
    const consider = (d) => {
        if (!d) return false;
        if (leaveHaulDrop(world, d)) return false;
        const stack = dropAsStack(d);
        if (!stack || !canCarry(rec, stack, 1)) return false;
        if (!(haulDropQty(world, rec, settle, d) > 0)) return false;
        return !!pickBasket(world, rec, settle, stack);
    };
    if (mine && mine.startsWith("drop:")) {
        const held = drops.find((d) => dropKey(d) === mine);
        if (held && consider(held)) return held;
    }
    let best = null;
    let bestD = Infinity;
    for (const d of drops) {
        if (claimedByOther(claims, dropKey(d), rec.id) || isSkipped(rec, dropKey(d))) continue;
        if (!consider(d)) continue;
        const dist = Math.hypot(rec.x - d.x, rec.y - d.y);
        if (dist < bestD) {
            bestD = dist;
            best = d;
        }
    }
    return best;
}

function gatherThing(world, rec, settle, claims) {
    const list = lootablesOf(world, settle);
    const haveMemo = Object.create(null);
    const haveOf = (id) => {
        const k = String(id || "");
        if (haveMemo[k] == null) haveMemo[k] = countItem(world, settle, k);
        return haveMemo[k];
    };
    const mine = claims?.held(rec.id);
    if (mine && mine.startsWith("thing:")) {
        const held = list.find((t) => thingKey(t.entry) === mine);
        if (held) {
            const itemId = held.def.lootable.item || held.def.id;
            if (Settlement.gatherShouldWork(haveOf(itemId), Settlement.stockTarget(settle, itemId))
                && canCarry(rec, { id: itemId, quantity: held.def.lootable.yield || 1 })) {
                return held.entry;
            }
        }
    }
    let best = null;
    let bestD = Infinity;
    for (const t of list) {
        const key = thingKey(t.entry);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        const itemId = t.def.lootable.item || t.def.id;
        if (!Settlement.gatherShouldWork(haveOf(itemId), Settlement.stockTarget(settle, itemId))) continue;
        if (!canCarry(rec, { id: itemId, quantity: t.def.lootable.yield || 1 })) continue;
        const d = Math.hypot(rec.x - t.entry.x, rec.y - t.entry.y);
        if (d < bestD) {
            bestD = d;
            best = t.entry;
        }
    }
    return best;
}

function chopTree(world, rec, settle, claims) {
    if (!findStack(world, rec, settle, (s) => Chop.isChopper(s))) return null;
    const have = countItem(world, settle, "log");
    const want = Settlement.stockTarget(settle, "log");
    if (!Settlement.gatherShouldWork(have, want)) return null;
    const list = choppablesOf(world, settle);
    const mine = claims?.held(rec.id);
    if (mine && mine.startsWith("thing:")) {
        const held = list.find((t) => thingKey(t.entry) === mine);
        if (held) return held.entry;
    }
    let best = null;
    let bestD = Infinity;
    for (const t of list) {
        const key = thingKey(t.entry);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        const d = Math.hypot(rec.x - t.entry.x, rec.y - t.entry.y);
        if (d < bestD) {
            bestD = d;
            best = t.entry;
        }
    }
    return best;
}

function freeBed(world, rec, settle, claims) {
    let best = null;
    let bestD = Infinity;
    for (const c of settleChunks(world, settle)) {
        if (!Array.isArray(c.things)) continue;
        for (const e of c.things) {
            if (!world._isSleepEntry(e)) continue;
            if (!inRange(settle, e.x, e.y)) continue;
            const def = world._sleepDef(e);
            Place.ensureSleepEntry(e, def);
            const n = Sleep.slotCount(def, e);
            for (let i = 0; i < n; i++) {
                if (world._sleepSlotClaimed(e, i, rec.id)) continue;
                const key = bedKey({ entry: e, slot: i });
                if (claimedByOther(claims, key, rec.id)) continue;
                const d = Math.hypot(rec.x - e.x, rec.y - e.y);
                if (d < bestD) {
                    bestD = d;
                    best = { entry: e, slot: i };
                }
            }
        }
    }
    return best;
}

function pawnCreature(world, pawn) {
    if (!pawn) return null;
    if (pawn.creature) return pawn.creature;
    const live = world?.creatures?.get?.(pawn.id);
    if (live) return live;
    if (pawn.role === "settler" || pawn.homeSettlementId) {
        return world?._ensureSettlerCreature?.(pawn) || null;
    }
    return null;
}

function patientNeedsTend(world, pawn) {
    const c = pawnCreature(world, pawn);
    if (!c || c.isBodyDead?.()) return false;
    return !!BodyHealing.pickTendTarget?.(c.anatomy);
}

function dropPatient(world, rec, patient, skip = false) {
    if (skip && patient) skipJob(rec, pawnWorkKey(patient, "tend"));
    if (rec?._settlerScan?.patients) {
        const id = patient?.id;
        rec._settlerScan.patients = rec._settlerScan.patients.filter(
            (p) => p && p !== patient && p.id !== id
        );
        if (!rec._settlerScan.patients.length) rec._settlerScan.keepBandage = false;
    }
    endWorkHold(rec);
    setSettlerAct(rec, rec?.creature, "Idle");
}

function settlerPatients(world, rec, settle, claims) {
    if (!findStack(world, rec, settle, (s) => !!getItem(s.id)?.bandage)) return [];
    const out = [];
    const consider = (p) => {
        if (!p || p === rec || p.id === rec.id || p.dead) return;
        if (!inRange(settle, p.x, p.y)) return;
        const key = pawnWorkKey(p, "tend");
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) return;
        if (patientNeedsTend(world, p)) out.push(p);
    };
    for (const s of settlersOf(world, settle)) consider(s);
    const owner = world.players.get(rec.ownerId);
    if (owner) {
        consider(owner);
        for (const m of owner.party || []) consider(m);
    }
    return out;
}

function unlitFire(world, rec, settle, claims) {
    if (Research?.techUnlocked && !Research.techUnlocked("fire", settle)) return null;
    for (const f of stationsOf(world, settle, "campfire")) {
        if (f.id === "campfire" && world._campfireHasFuel(f) && (f.burnRemaining > 0 || f.pitTemp > 0)) {
            continue;
        }
        if (f.id === "campfire" && Fire.isBurning(f)) continue;
        const key = stationKey(f);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        return f;
    }
    return null;
}

function fuelSources(world, rec, settle) {
    const sources = [{ slots: rec.inventory, at: rec }];
    for (const b of basketsOf(world, settle)) {
        sources.push({ slots: b.slots, at: b, entry: b });
    }
    return sources;
}

function stokeFire(world, rec, settle, claims) {
    if (!FuelFilter) return null;
    const keep = FuelFilter.KEEP_MINUTES;
    for (const f of stationsOf(world, settle, "campfire")) {
        const filt = FuelFilter.normalize(f.fuelFilter);
        if (!filt.alwaysOn) continue;
        if (Fire.burnMinutes(f, getItem) >= keep) continue;
        if (!FuelFilter.findFuelTake(filt, fuelSources(world, rec, settle), f, getItem)) continue;
        const key = stationKey(f);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        return f;
    }
    return null;
}

function lightOpts(world, rec, settle) {
    let hasFirestarter = false;
    let hasFuel = false;
    const scan = (slots) => {
        for (const s of slots || []) {
            if (Settlement.isFirestarter(s, getItem)) hasFirestarter = true;
            const meta = s ? getItem(s.id) : null;
            if (meta?.fuel || FuelFilter?.isFuelStack?.(s, getItem) || s?.id === "stick" || s?.id === "log") {
                hasFuel = true;
            }
        }
    };
    scan(rec.inventory);
    for (const b of basketsOf(world, settle)) scan(b.slots);
    return {
        hasFirestarter,
        hasFuel,
        hasGroundRecipe: false,
        knowsFire: !Research?.techUnlocked || Research.techUnlocked("fire", settle)
    };
}

function leftoverCookBill(fire) {
    if (Settlement.cookOutputReady(getItem, fire?.catalyst, { method: "shell_simmer" })) {
        return { method: "shell_simmer", leftover: true };
    }
    return { method: "stick_roast", leftover: true };
}

function hasRoastInput(world, rec, settle, bill) {
    const b = bill && bill.method ? bill : leftoverCookBill(null);
    return !!findCookFood(world, rec, settle, b);
}

function isRoastCookBill(bill) {
    const m = bill?.method || "stick_roast";
    return m === "stick_roast" || m === "smoke_hide";
}

function catalystReserved(fire) {
    return !!fire?.catalystReserved;
}

function markCatalystReserved(fire) {
    if (fire) fire.catalystReserved = true;
}

function clearCatalystReserved(fire) {
    if (fire) fire.catalystReserved = false;
}

/** Stick is claimed for an in-progress roast, including while hauling ingredients. */
function reserveRoastCatalyst(world, rec, settle, fire, bill) {
    if (!fire || bill?.leftover || !isRoastCookBill(bill)) return;
    if (!Settlement.isCookTool(getItem, fire.catalyst, bill.method || "stick_roast")) return;
    const cook = fire.cook;
    if (cook && Settlement.cookOutputReady(getItem, cook, bill)) return;
    if (cook || hasRoastInput(world, rec, settle, bill)) {
        const was = catalystReserved(fire);
        markCatalystReserved(fire);
        if (!was) emitEntry(world, fire);
        return;
    }
    if (catalystReserved(fire)) {
        clearCatalystReserved(fire);
        emitEntry(world, fire);
    }
}

function shouldTakeLeftoverStick(world, rec, settle, fire, bill) {
    if ((bill?.method || "stick_roast") !== "stick_roast") return false;
    if (!Settlement.isCookTool(getItem, fire?.catalyst, "stick_roast")) return false;
    if (fire?.cook) return false;
    if (bill?.leftover) return true;
    return !hasRoastInput(world, rec, settle, bill);
}

function takeFireCatalyst(world, rec, settle, fire) {
    const stick = fire?.catalyst;
    if (!stick) {
        clearCatalystReserved(fire);
        return true;
    }
    const wasReserved = catalystReserved(fire);
    fire.catalyst = null;
    clearCatalystReserved(fire);
    if (!takeOffFire(world, rec, settle, stick)) {
        fire.catalyst = stick;
        if (wasReserved) markCatalystReserved(fire);
        return false;
    }
    emitEntry(world, fire);
    return true;
}

function cookNeedsCleanup(world, rec, settle, fire, bill) {
    const roastBill = bill && bill.method === "stick_roast" ? bill : leftoverCookBill(fire);
    const simmerBill = bill && bill.method === "shell_simmer" ? bill : { method: "shell_simmer" };
    if (fire?.cook && (bill?.leftover || Settlement.cookOutputReady(getItem, fire.cook, roastBill))) {
        return true;
    }
    if (Settlement.cookOutputReady(getItem, fire?.catalyst, simmerBill)) return true;
    return shouldTakeLeftoverStick(world, rec, settle, fire, bill || leftoverCookBill(fire));
}

function cookInputPred(bill, skipInputIds) {
    return (s) => {
        if (!Settlement.cookInputReady(getItem, s, bill)) return false;
        if (skipInputIds && skipInputIds.size && skipInputIds.has(s.id)) return false;
        return true;
    };
}

function findSmokeHang(world, rec, settle, bill) {
    let best = null;
    let bestD = Infinity;
    for (const rack of stationsOf(world, settle, "rack")) {
        Place.ensureStorageEntry(rack, world._thingDef(rack.id));
        const hang = rackHang(rack);
        if (!hang || !Settlement.cookInputReady(getItem, hang, bill)) continue;
        const d = Math.hypot(rec.x - rack.x, rec.y - rack.y);
        if (d < bestD) {
            bestD = d;
            best = { slots: rack.slots, index: 0, at: rack, kind: "rack", entry: rack };
        }
    }
    return best;
}

function findCookTool(world, rec, settle, method) {
    return findStack(world, rec, settle, (s) => Settlement.isCookTool(getItem, s, method));
}

function findCookFood(world, rec, settle, bill, skipInputIds) {
    const held = findStack(world, rec, settle, cookInputPred(bill, skipInputIds));
    if (held) return held;
    if (bill?.method !== "smoke_hide") return null;
    return findSmokeHang(world, rec, settle, bill);
}

function reservedSimmerInputIds(world, rec, settle, fire, bills, roastIndex, have) {
    const skip = new Set();
    const roast = bills[roastIndex];
    if ((roast?.method || "stick_roast") !== "stick_roast") return skip;
    for (let j = roastIndex + 1; j < bills.length; j++) {
        const later = bills[j];
        if (!Settlement.billIsActive(later, have, settle)) continue;
        if (later.method !== "shell_simmer") continue;
        if (!cookHasWork(world, rec, settle, fire, later)) continue;
        const ids = Array.isArray(later.allowedIds) && later.allowedIds.length
            ? later.allowedIds
            : Settlement.SIMMER_INGREDIENT_IDS;
        for (const id of ids) {
            if (Settlement.isSimmerIngredientId(id)) skip.add(id);
        }
    }
    return skip;
}

function cookHasWork(world, rec, settle, fire, bill, opts = {}) {
    const method = bill.method || "stick_roast";
    const skipInputIds = opts.skipInputIds;
    if (method === "shell_simmer") {
        const cat = fire.catalyst;
        if (Settlement.cookOutputReady(getItem, cat, bill)) return true;
        const filled = (fire.simmer || []).filter(Boolean).length;
        if (filled >= (Settlement.SIMMER_MIN_SLOTS || 2) && Settlement.isCookTool(getItem, cat, method)) {
            return true;
        }
        const hasTool = Settlement.isCookTool(getItem, cat, method)
            || !!findStack(world, rec, settle, (s) => Settlement.isCookTool(getItem, s, method));
        let stock = 0;
        const countInv = (slots) => {
            for (const s of slots || []) {
                if (!s || !Settlement.cookInputReady(getItem, s, bill)) continue;
                stock += Math.max(1, Number(s.quantity) || 1);
            }
        };
        countInv(rec.inventory);
        countInv(rec.overflow);
        for (const b of basketsOf(world, settle)) countInv(b.slots);
        return !!(hasTool && stock >= 1);
    }
    if (fire.cook && Settlement.cookFitsBill(getItem, fire.cook, bill)) return true;
    const hasTool = Settlement.isCookTool(getItem, fire.catalyst, method)
        || !!findCookTool(world, rec, settle, method);
    const hasFood = !!findCookFood(world, rec, settle, bill, skipInputIds);
    if (hasTool && hasFood) return true;
    if (opts.ignoreLeftover || (skipInputIds && skipInputIds.size)) return false;
    return shouldTakeLeftoverStick(world, rec, settle, fire, bill);
}

function pickCookJob(world, rec, settle, f) {
    if (!f) return null;
    const haveMemo = Object.create(null);
    const have = (id) => {
        const k = String(id || "");
        if (haveMemo[k] == null) haveMemo[k] = countItem(world, settle, k);
        return haveMemo[k];
    };
    const canLeather = workJobOn(settle, rec, "leather");
    const bills = Settlement.billsOf(settle, f.uid);
    for (let i = 0; i < bills.length; i++) {
        const bill = bills[i];
        if (!Settlement.billIsActive(bill, have, settle)) continue;
        if (bill.method === "smoke_hide") {
            if (canLeather && cookHasWork(world, rec, settle, f, bill)) return null;
            continue;
        }
        const skipInputIds = reservedSimmerInputIds(world, rec, settle, f, bills, i, have);
        if (cookHasWork(world, rec, settle, f, bill, { skipInputIds })) {
            return { fire: f, bill, entry: f, skipInputIds };
        }
    }
    const bill = Settlement.activeBill(settle, f.uid, have);
    if (bill?.method === "smoke_hide") return null;
    if (cookNeedsCleanup(world, rec, settle, f, bill)) {
        return { fire: f, bill: bill || leftoverCookBill(f), entry: f };
    }
    return null;
}

function leftoverSmokeBill() {
    return { method: "smoke_hide", leftover: true };
}

function smokeJob(f, bill, extra) {
    return { kind: "smoke", fire: f, bill, station: f, pri: 5, entry: f, ...extra };
}

function pickSmokeJob(world, rec, settle, f) {
    if (!f) return null;
    const haveMemo = Object.create(null);
    const have = (id) => {
        const k = String(id || "");
        if (haveMemo[k] == null) haveMemo[k] = countItem(world, settle, k);
        return haveMemo[k];
    };
    const bills = Settlement.billsOf(settle, f.uid);
    for (let i = 0; i < bills.length; i++) {
        const bill = bills[i];
        if (!Settlement.billIsActive(bill, have, settle)) continue;
        const method = bill.method || "stick_roast";
        if (method === "smoke_hide") {
            if (cookHasWork(world, rec, settle, f, bill)) return smokeJob(f, bill);
            continue;
        }
        if (method === "stick_roast" || method === "shell_simmer") {
            if (cookHasWork(world, rec, settle, f, bill, { ignoreLeftover: true })) return null;
        }
    }
    const leftover = leftoverSmokeBill();
    if (f.cook && (
        Settlement.cookInputReady(getItem, f.cook, leftover)
        || Settlement.cookOutputReady(getItem, f.cook, leftover)
    )) {
        return smokeJob(f, leftover);
    }
    return null;
}

function cookBill(world, rec, settle, claims) {
    const fires = stationsOf(world, settle, "campfire");
    const tryFire = (f) => pickCookJob(world, rec, settle, f);
    const mine = claims?.held(rec.id);
    if (mine && mine.startsWith("station:")) {
        const held = fires.find((f) => stationKey(f) === mine);
        const job = tryFire(held);
        if (job) return job;
    }
    for (const f of fires) {
        if (claimedByOther(claims, stationKey(f), rec.id)) continue;
        const job = tryFire(f);
        if (job) return job;
    }
    return null;
}

function rackHang(entry) {
    return (entry?.slots && entry.slots[0]) || null;
}

function soakReadyDrop(world, rec, settle, bill) {
    const now = world.worldMinuteIndex();
    const step = Settlement.hideStepOf(bill.method);
    let best = null;
    let bestD = Infinity;
    for (const d of dropsOf(world, settle)) {
        const def = getItem(d.id);
        const stage = Settlement.hideStageOf(def, d.id);
        if (stage !== step?.outputStage) continue;
        const animal = Settlement.hideAnimalOf(def, d.id);
        const allowed = bill.allowedIds;
        if (Array.isArray(allowed) && allowed.length) {
            const ok = allowed.some((aid) => Settlement.hideAnimalOf(getItem(aid), aid) === animal);
            if (!ok) continue;
        }
        if (d.soakDoneAt != null && Number(d.soakDoneAt) > Number(now)) continue;
        const dist = Math.hypot(rec.x - d.x, rec.y - d.y);
        if (dist < bestD) {
            bestD = dist;
            best = d;
        }
    }
    return best;
}

function soakWater(world, settle, rec) {
    return Settlement.nearestWaterPoint(
        settle,
        rec.x,
        rec.y,
        TS,
        (wx, wy) => {
            const { tx, ty } = world._tileOf(wx, wy);
            return world._tileKeyAt(tx, ty) === "water";
        }
    );
}

function rackBillJob(world, rec, settle, rack, bill) {
    const method = bill.method;
    const step = Settlement.hideStepOf(method);
    if (!step) return null;
    const hang = rackHang(rack);
    const hangStage = hang ? Settlement.hideStageOf(getItem(hang.id), hang.id) : null;

    if (method === "soak_hide") {
        const ready = soakReadyDrop(world, rec, settle, bill);
        if (ready) return { kind: "soak_pickup", station: rack, bill, drop: ready, pri: 1, entry: rack };
        const water = soakWater(world, settle, rec);
        const fleshedHang = hang && Settlement.hideAllowsStack(bill, hang, getItem);
        const fleshedStore = findStack(world, rec, settle, (s) => Settlement.hideAllowsStack(bill, s, getItem));
        if ((fleshedHang || fleshedStore) && water) {
            return {
                kind: "soak_drop",
                station: rack,
                bill,
                water,
                fromRack: !!fleshedHang,
                pri: fleshedHang ? 3 : 6,
                entry: rack
            };
        }
        return null;
    }

    if (hang && hangStage === step.outputStage && Hide.canTakeFromRack(getItem(hang.id))) {
        return { kind: "unload", station: rack, bill, pri: 0, entry: rack };
    }
    if (hang && Settlement.hideAllowsStack(bill, hang, getItem)) {
        if (method === "dry_hide") return null;
        const need = Settlement.hideToolNeed(method);
        if (need === "scraper" && !findStack(world, rec, settle, (s) => {
            const def = getItem(s.id);
            return Carry.stackToolClass(s, def) === "scraper";
        })) return null;
        if (need === "brain" && !findStack(world, rec, settle, (s) => Hide.isBrainItem(getItem(s.id)))) {
            return null;
        }
        return { kind: "work", station: rack, bill, pri: 2, entry: rack };
    }
    if (hang) return null;
    const input = findStack(world, rec, settle, (s) => Settlement.hideAllowsStack(bill, s, getItem));
    if (!input) return null;
    const need = Settlement.hideToolNeed(method);
    if (need === "scraper" && !findStack(world, rec, settle, (s) => {
        const def = getItem(s.id);
        return Carry.stackToolClass(s, def) === "scraper";
    })) return null;
    if (need === "brain" && !findStack(world, rec, settle, (s) => Hide.isBrainItem(getItem(s.id)))) {
        return null;
    }
    return { kind: "hang", station: rack, bill, pri: 4, entry: rack };
}

function leatherWork(world, rec, settle, claims) {
    const have = (id) => countItem(world, settle, id);
    const jobs = [];
    for (const rack of stationsOf(world, settle, "rack")) {
        for (const bill of Settlement.billsOf(settle, rack.uid)) {
            if (!Settlement.billIsActive(bill, have, settle)) continue;
            const job = rackBillJob(world, rec, settle, rack, bill);
            if (job) {
                jobs.push(job);
                break;
            }
        }
    }
    for (const fire of stationsOf(world, settle, "campfire")) {
        const job = pickSmokeJob(world, rec, settle, fire);
        if (job) jobs.push(job);
    }
    for (const bench of stationsOf(world, settle, "craft")) {
        for (const bill of Settlement.billsOf(settle, bench.uid)) {
            if (!Settlement.billIsActive(bill, have, settle)) continue;
            if (!benchHasWork(world, rec, settle, bill)) continue;
            jobs.push({ kind: "bench", station: bench, bill, pri: 8, entry: bench });
            break;
        }
    }
    if (!jobs.length) return null;
    const mine = claims?.held(rec.id);
    if (mine) {
        const held = jobs.find((j) => leatherJobKey(j) === mine);
        if (held && !isSkipped(rec, mine)) return held;
    }
    let best = null;
    let bestP = 99;
    let bestD = Infinity;
    for (const job of jobs) {
        const key = leatherJobKey(job);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        const pri = Number(job.pri) || 50;
        const t = job.station || job.drop || job.water;
        const d = t ? Math.hypot(rec.x - t.x, rec.y - t.y) : 0;
        if (pri < bestP || (pri === bestP && d < bestD)) {
            bestP = pri;
            bestD = d;
            best = job;
        }
    }
    return best;
}

function scanWork(world, rec, settle, claims) {
    const jobs = Settlement.jobsFor(settle, rec.id);
    const enabled = new Set(Settlement.enabledJobs(jobs));
    const patients = jobOn(enabled, "doctor") ? settlerPatients(world, rec, settle, claims) : [];
    const doctorOn = enabled.has("doctor");
    const keepBandage = !!(doctorOn && patients.length);
    const circle = jobOn(enabled, "research") ? researchCircle(world, rec, settle, claims) : null;
    const keepPigment = !!(circle && Research?.needsPigment?.(circle));
    const keepTally = !!(circle && Research?.needsTallyInstall?.(settle, circle));
    const pigmentPredFn = keepPigment ? pigmentPred(circle) : null;
    const isPigment = (keepPigment || keepTally)
        ? (s) => (keepTally && s?.id === (Research.TALLY_ITEM_ID || "tally_stick"))
            || !!(pigmentPredFn && pigmentPredFn(s))
        : null;
    const keepOpts = keepGearOpts({ keepBandage, keepPigment: keepPigment || keepTally, isPigment });
    const night = Settlement.isNight(world.gameMinutes);
    const c = rec.creature || world.creatures.get(rec.id);
    const injured = Sleep.injuredForAutofill ? Sleep.injuredForAutofill(c?.anatomy) : false;
    const stash = stashScan(world, rec, settle, keepOpts);
    return {
        unlitFire: jobOn(enabled, "cook") ? unlitFire(world, rec, settle, claims) : null,
        light: jobOn(enabled, "cook") ? lightOpts(world, rec, settle) : {
            hasFirestarter: false, hasFuel: false, hasGroundRecipe: false
        },
        cookBill: jobOn(enabled, "cook") ? cookBill(world, rec, settle, claims) : null,
        stokeFire: jobOn(enabled, "cook") ? stokeFire(world, rec, settle, claims) : null,
        leatherWork: jobOn(enabled, "leather") ? leatherWork(world, rec, settle, claims) : null,
        haulDrop: jobOn(enabled, "haul") ? haulDrop(world, rec, settle, claims) : null,
        haulMerge: jobOn(enabled, "haul") ? StorageFilter.findMergeJob(
            basketsOf(world, settle),
            getItem,
            rec.x,
            rec.y,
            { isClaimed: (key) => claimedByOther(claims, key, rec.id) || isSkipped(rec, key) }
        ) : null,
        gatherThing: jobOn(enabled, "gather") ? gatherThing(world, rec, settle, claims) : null,
        chopTree: jobOn(enabled, "chop") ? chopTree(world, rec, settle, claims) : null,
        researchCircle: circle,
        patients,
        keepBandage,
        keepPigment: keepPigment || keepTally,
        isPigment,
        bed: (night || injured) ? freeBed(world, rec, settle, claims) : null,
        stash,
        night,
        injured,
        jobs
    };
}

function mergeNeedsRoom(rec, job) {
    if (!job || job.kind !== "move") return false;
    const stack = job.from?.slots?.[job.fromIndex];
    if (!stack?.id) return false;
    if (hasCarryRoom(rec, stack) && canCarry(rec, stack, 1)) return false;
    return true;
}

function fetchTarget(found, rec) {
    if (!found || found.at === rec) return null;
    return found.entry || found.at || null;
}

function walkToFound(world, rec, found) {
    const target = fetchTarget(found, rec);
    if (!target) return null;
    return goOrWalk(world, rec, target);
}

function fetchStack(world, rec, settle, found) {
    if (!found) return halt();
    if (found.at === rec) return null;
    const walked = walkToFound(world, rec, found);
    if (walked) return walked;
    const stack = takeFound(found);
    if (!stack) return halt();
    if (!givePawn(rec, stack)) {
        found.slots[found.index] = stack;
        return halt();
    }
    if (found.entry) emitEntry(world, found.entry);
    world._dirtyPawnOwner(rec);
    return halt();
}

function restorePiece(found, piece) {
    if (!found || !piece) return;
    const cur = found.slots[found.index];
    if (!cur) {
        found.slots[found.index] = piece;
        return;
    }
    if (cur.id === piece.id && !stackIsSpecial(cur) && !stackIsSpecial(piece)) {
        cur.quantity = (Number(cur.quantity) || 1) + (Number(piece.quantity) || 1);
    }
}

function fetchCookPiece(world, rec, settle, found) {
    if (!found) return halt();
    if (found.at === rec) return null;
    const walked = walkToFound(world, rec, found);
    if (walked) return walked;
    const stack = takeOne(found);
    if (!stack) return halt();
    if (takeToPawn(world, rec, stack) <= 0) {
        restorePiece(found, stack);
        return halt();
    }
    if (found.entry) emitEntry(world, found.entry);
    world._dirtyPawnOwner(rec);
    return halt();
}

function fetchCookQty(world, rec, settle, found, want) {
    if (!found) return halt();
    if (found.at === rec) return null;
    const walked = walkToFound(world, rec, found);
    if (walked) return walked;
    const cap = Math.max(1, Math.floor(Number(want) || 1));
    const stack = takeQty(found, cap);
    if (!stack) return halt();
    const qty = Math.max(1, Number(stack.quantity) || 1);
    const got = takeToPawn(world, rec, stack);
    if (got < qty) restorePiece(found, { ...stack, quantity: qty - got });
    if (got <= 0) return halt();
    if (found.entry) emitEntry(world, found.entry);
    world._dirtyPawnOwner(rec);
    return halt();
}

function fetchEatStack(world, rec, settle, found) {
    if (!found) return halt();
    if (found.at === rec) return null;
    const walked = walkToFound(world, rec, found);
    if (walked) return walked;
    const stack = found.slots[found.index];
    if (!stack) return halt();
    const food = world._foodForEat(stack);
    const isMeal = world._isPartialFood(stack);
    const sitting = rec._eatSitting;
    const until = sitting?.until || AUTO_EAT_UNTIL;
    const want = Party.eatTakeQty(rec.kc, until, food?.kc, stack.quantity, {
        stomach: rec.stomach,
        isMeal
    });
    const piece = takeQty(found, want);
    if (!piece) return halt();
    const got = takeToPawn(world, rec, piece);
    if (got <= 0) {
        restorePiece(found, piece);
        return halt();
    }
    const left = (Number(piece.quantity) || 1) - got;
    if (left > 0) restorePiece(found, { ...piece, quantity: left });
    if (found.entry) emitEntry(world, found.entry);
    world._dirtyPawnOwner(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = SCAN_MS;
    return halt();
}

function putInBasket(world, rec, settle, stack) {
    const b = pickBasket(world, rec, settle, stack);
    if (b && storageNear(rec, b) && insertInEntry(world, b, stack)) {
        emitEntry(world, b);
        rec._haulDestUid = null;
        rec._haulMergeOnly = false;
        return true;
    }
    if (takeToPawn(world, rec, stack) > 0) {
        if (b && !storageNear(rec, b)) {
            rec._haulDestUid = b.uid;
            rec._haulMergeOnly = false;
            beginWorkHold(rec, { type: "stash", target: b });
        }
        world._dirtyPawnOwner(rec);
        return true;
    }
    return false;
}

function walkHaulDest(world, rec, settle) {
    const uid = rec?._haulDestUid;
    if (!uid) return null;
    const dest = basketsOf(world, settle).find((b) => b.uid === uid);
    if (!dest) return null;
    return goOrWalk(world, rec, dest);
}

function finishPut(world, rec, settle, extraHalt) {
    const walked = walkHaulDest(world, rec, settle);
    if (walked) return walked;
    endWorkHold(rec);
    return halt(extraHalt);
}

function takeOffFire(world, rec, settle, stack) {
    if (!stack) return true;
    return putInBasket(world, rec, settle, stack);
}

function persistBills(world, settle, stationUid) {
    const owner = world.players.get(settle.ownerId);
    if (owner) world._youDirty.add(owner.id);
}

function markPathIgnore(rec, c, target, world) {
    const uid = target?.uid || null;
    if (rec) rec._pathIgnoreUid = uid || null;
    if (c) c._pathIgnoreUid = uid || null;
}

function stationStandDist(hs) {
    const hit = Math.max(1, Number(hs) || 5);
    return Math.max(10, hit * 0.5 + 8);
}

function stationStandDistFor(world, target) {
    const def = world?._thingDef?.(target?.id);
    const rect = typeof Place !== "undefined" && Place.collisionWorldRect
        ? Place.collisionWorldRect(target, def, TS)
        : null;
    if (rect) {
        const rw = rect.right - rect.left;
        const rh = rect.bottom - rect.top;
        return Math.max(12, Math.max(rw, rh) * 0.5 + 10);
    }
    return stationStandDist(Number(def?.hitboxSize ?? target?.hitboxSize) || 5);
}

function stationStandFeet(world, rec, c, target) {
    const body = c?.bodyCenter?.() || { x: rec.x, y: rec.y };
    const dist = stationStandDistFor(world, target);
    const pack = (aimX, aimY) => {
        const feetX = aimX + ((Number(rec.x) || 0) - body.x);
        const feetY = aimY + ((Number(rec.y) || 0) - body.y);
        return { feetX, feetY, aimX, aimY };
    };
    const free = (aimX, aimY) => {
        const feetX = aimX + ((Number(rec.x) || 0) - body.x);
        const feetY = aimY + ((Number(rec.y) || 0) - body.y);
        if (typeof world?._partyPoseBlocked === "function" && c) {
            return !world._partyPoseBlocked(c, feetX, feetY, 0);
        }
        return true;
    };
    let dx = body.x - (Number(target.x) || 0);
    let dy = body.y - (Number(target.y) || 0);
    const radial = Math.hypot(dx, dy);
    if (radial < 1) {
        dx = 0;
        dy = 1;
    } else {
        dx /= radial;
        dy /= radial;
    }
    const preferX = (Number(target.x) || 0) + dx * dist;
    const preferY = (Number(target.y) || 0) + dy * dist;
    if (free(preferX, preferY)) return pack(preferX, preferY);
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const aimX = (Number(target.x) || 0) + Math.cos(a) * dist;
        const aimY = (Number(target.y) || 0) + Math.sin(a) * dist;
        if (!free(aimX, aimY)) continue;
        const d = Math.hypot(body.x - aimX, body.y - aimY);
        if (d < bestD) {
            bestD = d;
            best = { aimX, aimY };
        }
    }
    if (best) return pack(best.aimX, best.aimY);
    return pack(preferX, preferY);
}

function goOrWalk(world, rec, target) {
    if (!target) return halt();
    const c = rec.creature || world?._ensureSettlerCreature?.(rec);
    markPathIgnore(rec, c, target, world);
    const def = world?._thingDef?.(target.id);
    const paintStand = paintStandOf(target);
    if (paintStand) {
        const slack = 3;
        const px = Number(rec.x) || 0;
        const py = Number(rec.y) || 0;
        if (Math.hypot(px - paintStand.x, py - paintStand.y) <= slack) {
            facePaint(rec, target);
            rec.x = paintStand.x;
            rec.y = paintStand.y;
            if (c) {
                c.x = paintStand.x;
                c.y = paintStand.y;
                c.vx = 0;
                c.vy = 0;
                c.setDesiredVel?.(0, 0);
            }
            return null;
        }
        return walkTo(paintStand.x, paintStand.y, { openRadius: 0 });
    }
    const stand = typeof Place !== "undefined" && Place.interactWorldPos
        ? Place.interactWorldPos(target, TS, def)
        : null;
    if (stand) {
        const slack = 4;
        const px = Number(rec.x) || 0;
        const py = Number(rec.y) || 0;
        if (Math.hypot(px - stand.x, py - stand.y) <= slack) {
            faceToward(rec, target.x, (Number(target.y) || 0) - 8);
            return null;
        }
        return walkTo(stand.x, stand.y, { openRadius: 0 });
    }
    // Benches/circles have a real stand tile. Everything else is usable from
    // INTERACT_TILES. Do not chase a ring pose "just outside the hitbox":
    // that dest often lands in the next fire/stump and they run back and forth.
    // If another solid sits on the line, keep walking around it; once the
    // line is clear or they are within a tile, work.
    const tx = Number(target.x) || 0;
    const ty = Number(target.y) || 0;
    const dist = Math.hypot((Number(rec.x) || 0) - tx, (Number(rec.y) || 0) - ty);
    if (near(rec.x, rec.y, tx, ty)
        && (!blockedToward(world, rec, c, tx, ty) || dist <= TS)) {
        faceToward(rec, tx, ty - 8);
        return null;
    }
    return walkTo(tx, ty);
}

function blockedToward(world, rec, c, tx, ty) {
    if (!c || typeof world?._partyPoseBlocked !== "function") return false;
    const px = Number(rec.x) || 0;
    const py = Number(rec.y) || 0;
    const dx = tx - px;
    const dy = ty - py;
    const dist = Math.hypot(dx, dy);
    if (!(dist > 4)) return false;
    const steps = Math.max(2, Math.ceil(dist / 4));
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (world._partyPoseBlocked(c, px + dx * t, py + dy * t, 2)) return true;
    }
    return false;
}

function knapQualityDurationScale(quality) {
    return { crude: 1.25, rough: 1.0, fine: 0.8 }[quality] || 1;
}

function knapMaterialDurationScale(material) {
    return material === "flint" ? 0.8 : 1;
}

function manipScale(world, rec) {
    const c = rec?.creature || world?._ensureSettlerCreature?.(rec) || world?.creatures?.get(rec?.id);
    const cap = c?.capacities;
    if (typeof cap?.manipulationDurationScale === "function") return cap.manipulationDurationScale();
    return 1;
}

function publicChannel(rec) {
    const eat = rec?.eatChannel;
    if (eat && eat.max > 0) {
        const prog = 1 - (Number(eat.remaining) || 0) / eat.max;
        return {
            kind: "eat",
            progress: Math.max(0, Math.min(1, prog)),
            itemId: eat.itemId || null
        };
    }
    const ch = rec?._workChannel;
    if (ch && ch.max > 0) {
        const prog = 1 - (Number(ch.remaining) || 0) / ch.max;
        const out = {
            kind: ch.kind,
            progress: Math.max(0, Math.min(1, prog)),
            itemId: ch.itemId || null
        };
        if (ch.uid) out.uid = ch.uid;
        if (ch.kind === "tend") {
            out.patientId = ch.patientId || null;
            out.patientName = ch.patientName || null;
        }
        return out;
    }
    const paint = rec?._paintChannel;
    if (paint && typeof paint.progress === "number") {
        const out = {
            kind: "paint",
            progress: Math.max(0, Math.min(1, Number(paint.progress) || 0))
        };
        if (paint.uid) out.uid = paint.uid;
        if (paint.pigmentId) out.pigmentId = paint.pigmentId;
        return out;
    }
    return null;
}

function setSettlerAct(rec, mob, label) {
    const s = label || "Idle";
    rec._settlerAct = s;
    if (mob) mob._settlerAct = s;
}

function firstStashable(rec, keepBandageOrOpts) {
    const keep = Settlement.keepIndices(rec.inventory, getItem, keepGearOpts(keepBandageOrOpts));
    for (let i = 0; i < (rec.inventory || []).length; i++) {
        if (keep.has(i)) continue;
        const s = rec.inventory[i];
        if (s?.id) return s;
    }
    for (const s of rec.overflow || []) {
        if (s?.id) return s;
    }
    return null;
}

function actCtx(world, rec, extra = {}) {
    return {
        getItem,
        getThing: (id) => DataStore.getThing(id) || world?._thingDef?.(id) || null,
        stashStack: extra.stashStack,
        haulWhat: extra.haulWhat || rec?._haulWhat,
        patientName: extra.patientName
    };
}

function workChannelLabel(world, rec) {
    const ch = rec?._workChannel;
    if (!ch) return "Idle";
    if (ch.kind === "tend") {
        const patient = findChannelPatient(world, rec, ch.patientId);
        if (patient && patient.id !== rec.id) {
            return Settlement.actLabel({ type: "tend", target: patient }, actCtx(world, rec));
        }
        return "Tending";
    }
    if (ch.kind === "craft") {
        const recipe = world._parseRecipe?.(ch.recipeId);
        if (recipe?.name) {
            const n = String(recipe.name);
            return /^make\s/i.test(n) ? n : `Crafting ${n}`;
        }
        return "Crafting";
    }
    return Settlement.actLabel({ type: ch.kind }, actCtx(world, rec));
}

function countInv(rec, pred) {
    let n = 0;
    for (const s of rec.inventory || []) {
        if (s && pred(s)) n += Math.max(1, Number(s.quantity) || 1);
    }
    return n;
}

function countSettle(world, rec, settle, pred) {
    let n = countInv(rec, pred);
    for (const b of basketsOf(world, settle)) {
        for (const s of b.slots || []) {
            if (s && pred(s)) n += Math.max(1, Number(s.quantity) || 1);
        }
    }
    return n;
}

function findBasketStack(world, rec, settle, pred) {
    for (const b of basketsOf(world, settle)) {
        const slots = b.slots || [];
        const i = slots.findIndex((s) => s && pred(s));
        if (i < 0) continue;
        return { slots, index: i, at: b, kind: "basket", entry: b };
    }
    return null;
}

function hideAllowed(bill, stack) {
    if (!stack?.id) return false;
    if (!Array.isArray(bill?.allowedIds) || !bill.allowedIds.length) return true;
    if (bill.allowedIds.includes(stack.id)) return true;
    const animal = Settlement.hideAnimalOf(getItem(stack.id), stack.id);
    return bill.allowedIds.some((id) => Settlement.hideAnimalOf(getItem(id), id) === animal);
}

function benchHasWork(world, rec, settle, bill) {
    const recId = bill?.recipeId || bill?.outputId;
    const recipe = recId ? world._parseRecipe(recId) : null;
    if (!recipe) return false;
    const toolClass = recipe.requireTool?.toolClass || "awl";
    if (!findStack(world, rec, settle, (s) => Carry.stackToolClass(s, getItem(s.id)) === toolClass)) {
        return false;
    }
    for (const ing of recipe.ingredients || []) {
        if (ing.hideStage) {
            const n = countSettle(world, rec, settle, (s) => {
                if (Settlement.hideStageOf(getItem(s.id), s.id) !== ing.hideStage) return false;
                return hideAllowed(bill, s);
            });
            if (n < (ing.qty || 1)) return false;
            continue;
        }
        if (!ing.id || ing.id === "ANY_HIDE" || ing.id === "ANY_LEATHER") continue;
        const n = countSettle(world, rec, settle, (s) => s.id === ing.id);
        if (n < (ing.qty || 1)) return false;
    }
    return true;
}

function fetchOrBlock(world, rec, settle, found) {
    if (!found) return { blocked: true, halt: true };
    if (found.at === rec) return null;
    const stack = found.slots?.[found.index];
    if (!canGivePawn(rec, stack)) return { blocked: true, halt: true };
    return fetchStack(world, rec, settle, found) || halt();
}

function fetchBenchMats(world, rec, settle, bill, recipe) {
    for (const ing of recipe.ingredients || []) {
        if (ing.hideStage) {
            const have = countInv(rec, (s) => {
                if (Settlement.hideStageOf(getItem(s.id), s.id) !== ing.hideStage) return false;
                return hideAllowed(bill, s);
            });
            if (have >= (ing.qty || 1)) continue;
            const found = findBasketStack(world, rec, settle, (s) => {
                if (Settlement.hideStageOf(getItem(s.id), s.id) !== ing.hideStage) return false;
                return hideAllowed(bill, s);
            });
            return fetchOrBlock(world, rec, settle, found);
        }
        if (!ing.id || ing.id === "ANY_HIDE" || ing.id === "ANY_LEATHER") continue;
        const have = countInv(rec, (s) => s.id === ing.id);
        if (have >= (ing.qty || 1)) continue;
        const found = findBasketStack(world, rec, settle, (s) => s.id === ing.id);
        return fetchOrBlock(world, rec, settle, found);
    }
    const toolClass = recipe.requireTool?.toolClass || "awl";
    const awl = findStack(world, rec, settle, (s) => Carry.stackToolClass(s, getItem(s.id)) === toolClass);
    if (!awl) return { blocked: true, halt: true };
    if (awl.at !== rec) return fetchOrBlock(world, rec, settle, awl);
    rec.hotbarIndex = awl.index;
    return null;
}

function findChannelPatient(world, rec, id) {
    if (!id) return null;
    if (rec.id === id) return rec;
    const owner = world.players.get(rec.ownerId);
    if (owner?.id === id) return owner;
    const mem = (owner?.party || []).find((m) => m && m.id === id);
    if (mem) return mem;
    return (world.settlers || []).find((s) => s && s.id === id) || null;
}

function channelStillValid(world, rec, ch) {
    if (!ch) return false;
    if (rec.hotbarIndex !== ch.slot) return false;
    const held = rec.inventory?.[ch.slot] || null;
    if (ch.kind === "flesh") {
        const rack = world._findThingByUid(ch.uid)?.entry;
        if (!rack || !near(rec.x, rec.y, rack.x, rack.y)) return false;
        const hang = rackHang(rack);
        const meta = hang ? getItem(hang.id) : null;
        if (!Hide.canScrape(meta)) return false;
        return Carry.stackToolClass(held, held ? getItem(held.id) : null) === "scraper";
    }
    if (ch.kind === "brain") {
        const rack = world._findThingByUid(ch.uid)?.entry;
        if (!rack || !near(rec.x, rec.y, rack.x, rack.y)) return false;
        const hang = rackHang(rack);
        const meta = hang ? getItem(hang.id) : null;
        if (!Hide.isDehairedHide(meta)) return false;
        return Hide.isBrainItem(held ? getItem(held.id) : null);
    }
    if (ch.kind === "craft") {
        const bench = world._findThingByUid(ch.uid)?.entry;
        if (!bench || !near(rec.x, rec.y, bench.x, bench.y)) return false;
        const recipe = world._parseRecipe(ch.recipeId);
        if (!recipe) return false;
        const want = ch.toolClass || recipe.requireTool?.toolClass;
        if (want) {
            if (Carry.stackToolClass(held, held ? getItem(held.id) : null) !== want) return false;
        }
        return true;
    }
    if (ch.kind === "tend") {
        const patient = findChannelPatient(world, rec, ch.patientId);
        if (!patient || patient.dead) return false;
        if (!patientNeedsTend(world, patient)) return false;
        if (!near(rec.x, rec.y, patient.x, patient.y)) return false;
        if (!held?.id || (ch.itemId && held.id !== ch.itemId)) return false;
        return !!getItem(held.id)?.bandage;
    }
    return false;
}

function finishWorkChannel(world, rec, ch) {
    rec._workChannel = null;
    endWorkHold(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = SCAN_MS;
    if (ch.kind === "flesh") {
        world._tryRackFlesh(rec, { uid: ch.uid, pawnId: rec.id });
        return;
    }
    if (ch.kind === "brain") {
        world._tryRackBrain(rec, { uid: ch.uid, pawnId: rec.id });
        return;
    }
    if (ch.kind === "craft") {
        const owner = world.players.get(rec.ownerId) || rec;
        world._tryCraft(owner, { id: ch.recipeId, pawnId: rec.id });
        return;
    }
    if (ch.kind === "tend") {
        const owner = world.players.get(rec.ownerId) || rec;
        world._tryTend(owner, {
            pawnId: rec.id,
            patientId: ch.patientId,
            fromPawnId: rec.id,
            slot: ch.slot,
            itemId: ch.itemId,
            targets: ch.targetHints
        });
    }
}

function jobsOn(settle, rec) {
    return Settlement.jobsFor(settle, rec?.id);
}

function workJobOn(settle, rec, type) {
    return Settlement.jobEnabled(jobsOn(settle, rec), type);
}

function tickChannel(world, rec, dtMs) {
    const ch = rec?._workChannel;
    if (!ch) return;
    const settle = findSettle(world, rec);
    if ((settle && !workJobOn(settle, rec, ch.kind)) || !channelStillValid(world, rec, ch)) {
        rec._workChannel = null;
        endWorkHold(rec);
        return;
    }
    ch.remaining -= Number(dtMs) || 0;
    if (ch.remaining <= 0) finishWorkChannel(world, rec, ch);
}

function doGather(world, rec, target) {
    if (!target) {
        endWorkHold(rec);
        return halt();
    }
    const walked = goOrWalk(world, rec, target);
    if (walked) return walked;
    world._tryHarvest(rec, { uid: target.uid });
    endWorkHold(rec);
    return halt();
}

function doHaul(world, rec, settle, drop) {
    if (!drop) return halt();
    const key = dropKey(drop);
    const walked = goToDrop(world, rec, drop);
    if (walked) return walked;
    if (leaveHaulDrop(world, drop)) {
        skipJob(rec, key);
        rec._haulDestUid = null;
        endWorkHold(rec);
        return halt();
    }
    const stack = dropAsStack(drop);
    const take = stack ? haulDropQty(world, rec, settle, drop) : 0;
    const basket = take > 0 ? pickBasket(world, rec, settle, stack) : null;
    if (!stack || !basket) {
        skipJob(rec, key);
        endWorkHold(rec);
        return halt();
    }
    world._tryPickup(rec, { dropId: drop.uid, quantity: take });
    rec._haulDestUid = basket.uid;
    world._dirtyPawnOwner(rec);
    return halt();
}

function doStash(world, rec, settle, basket, keepBandageOrOpts) {
    if (!basket) return halt();
    const walked = goOrWalk(world, rec, basket);
    if (walked) return walked;
    depositKeepGear(world, rec, settle, keepBandageOrOpts);
    StorageFilter.compactSlots(basket.slots, getItem, onMerge);
    emitEntry(world, basket);
    rec._haulDestUid = null;
    endWorkHold(rec);
    return halt();
}

function doMerge(world, rec, settle, job) {
    if (!job) return halt();
    if (job.kind === "pack") {
        const b = job.basket;
        const walked = goOrWalk(world, rec, b);
        if (walked) return walked;
        StorageFilter.compactSlots(b.slots, getItem, onMerge);
        emitEntry(world, b);
        endWorkHold(rec);
        return halt();
    }
    const src = job.from;
    const dest = job.to;
    if (!src || !dest) return halt();
    const walked = goOrWalk(world, rec, src);
    if (walked) return walked;
    const stack = src.slots?.[job.fromIndex];
    if (!stack) return halt();
    const key = StorageFilter.mergeClaimKey(job) || job.claimKey;
    const took = takeToPawn(world, rec, stack);
    if (!(took > 0)) {
        skipJob(rec, key);
        return halt();
    }
    const left = Math.max(0, (Number(stack.quantity) || 1) - took);
    if (left > 0) stack.quantity = left;
    else src.slots[job.fromIndex] = null;
    emitEntry(world, src);
    rec._haulDestUid = dest.uid;
    rec._haulMergeOnly = true;
    world._dirtyPawnOwner(rec);
    return halt();
}

function stokeFuel(world, rec, settle, fire) {
    if (!fire || !FuelFilter) return false;
    const take = FuelFilter.findFuelTake(
        fire.fuelFilter,
        fuelSources(world, rec, settle),
        fire,
        getItem
    );
    if (!take) return false;
    const stack = take.slots[take.index];
    stack.quantity = (Number(stack.quantity) || 1) - 1;
    if (!(stack.quantity > 0)) take.slots[take.index] = null;
    const slot = FuelFilter.addFuelUnit(fire, take.id);
    if (slot < 0) {
        stack.quantity = (Number(stack.quantity) || 0) + 1;
        take.slots[take.index] = stack;
        return false;
    }
    if (take.src?.entry || take.src?.at) {
        const basket = take.src.entry || (take.src.at !== rec ? take.src.at : null);
        if (basket && basket !== rec) emitEntry(world, basket);
    }
    emitEntry(world, fire);
    world._dirtyPawnOwner(rec);
    return true;
}

function stokeUntilKeep(world, rec, settle, fire) {
    if (!fire) return false;
    const filt = FuelFilter ? FuelFilter.normalize(fire.fuelFilter) : { alwaysOn: true };
    if (!filt.alwaysOn) {
        if (world._campfireHasFuel(fire)) return true;
        return stokeFuel(world, rec, settle, fire);
    }
    const keep = FuelFilter.KEEP_MINUTES;
    let n = 0;
    while (Fire.burnMinutes(fire, getItem) < keep && n < 99) {
        if (!stokeFuel(world, rec, settle, fire)) break;
        n++;
    }
    return n > 0 || world._campfireHasFuel(fire) || Fire.burnMinutes(fire, getItem) > 0;
}

function doStokeFire(world, rec, settle, fire) {
    if (!fire) return halt();
    const walked = goOrWalk(world, rec, fire);
    if (walked) return walked;
    const facing = faceFire(rec, fire);
    stokeUntilKeep(world, rec, settle, fire);
    return halt(facing ? { facing } : null);
}

function doLightFire(world, rec, settle, fire) {
    if (Research?.techUnlocked && !Research.techUnlocked("fire", settle)) return halt();
    if (!fire) return halt();
    const walked = goOrWalk(world, rec, fire);
    if (walked) return walked;
    const facing = faceFire(rec, fire);
    if (world._campfireHasFuel(fire) || stokeUntilKeep(world, rec, settle, fire)) {
        const starter = findStack(world, rec, settle, (s) => Settlement.isFirestarter(s, getItem));
        if (starter && starter.at !== rec) return fetchStack(world, rec, settle, starter) || halt();
        if (starter) rec.hotbarIndex = starter.index;
        world._campfireEnsureBurning(fire);
        if (starter && starter.at === rec) world._wearHeld(rec, 1);
        emitEntry(world, fire);
    }
    return halt(facing ? { facing } : null);
}

function doCook(world, rec, settle, job) {
    const fire = job?.fire || job?.entry;
    const bill = job?.bill;
    if (!fire || !bill) return halt();
    const method = bill.method || "stick_roast";

    if (method === "shell_simmer") {
        const cat = fire.catalyst;
        if (cat && (bill.leftover || Settlement.cookOutputReady(getItem, cat, bill))) {
            const walked = goOrWalk(world, rec, fire);
            if (walked) return walked;
            fire.catalyst = null;
            if (!takeOffFire(world, rec, settle, cat)) {
                fire.catalyst = cat;
                return halt();
            }
            if (!bill.leftover) Settlement.noteBillCrafted(bill);
            emitEntry(world, fire);
            persistBills(world, settle, fire.uid);
            return finishPut(world, rec, settle);
        }
        if (bill.leftover) {
            endWorkHold(rec);
            return halt();
        }
        if (fire.id !== "campfire" || !(Number(fire.burnRemaining) > 0)) {
            return doLightFire(world, rec, settle, fire);
        }
        stokeUntilKeep(world, rec, settle, fire);
        if (!world._campfireHasFuel(fire)) return halt();
        if (fire.cook) {
            const walked = goOrWalk(world, rec, fire);
            if (walked) return walked;
            const spit = fire.cook;
            fire.cook = null;
            if (!takeOffFire(world, rec, settle, spit)) {
                fire.cook = spit;
                return halt();
            }
            emitEntry(world, fire);
            return finishPut(world, rec, settle);
        }
        if (!Settlement.isCookTool(getItem, cat, method)) {
            if (cat) {
                const walked = goOrWalk(world, rec, fire);
                if (walked) return walked;
                if (!takeFireCatalyst(world, rec, settle, fire)) return halt();
                return halt();
            }
        }
        if (!Array.isArray(fire.simmer)) fire.simmer = [null, null, null, null];
        const toolPred = (s) => Settlement.isCookTool(getItem, s, method);
        const ingPred = (s) => Settlement.cookInputReady(getItem, s, bill);
        const needTool = !Settlement.isCookTool(getItem, fire.catalyst, method);
        if (needTool && !findHeld(rec, toolPred)) {
            const found = findStored(world, rec, settle, toolPred);
            if (!found) {
                endWorkHold(rec);
                return halt();
            }
            return fetchCookPiece(world, rec, settle, found) || halt();
        }
        const empty = Settlement.simmerEmptyCount(fire);
        const heldIng = heldPredQty(rec, ingPred);
        if (empty > heldIng) {
            const stored = findStored(world, rec, settle, ingPred);
            if (stored) {
                return fetchCookQty(world, rec, settle, stored, empty - heldIng) || halt();
            }
        }
        if (needTool) {
            const held = findHeld(rec, toolPred);
            if (!held) {
                endWorkHold(rec);
                return halt();
            }
            const walked = goOrWalk(world, rec, fire);
            if (walked) return walked;
            fire.catalyst = takeCookPiece(held);
            emitEntry(world, fire);
            world._dirtyPawnOwner(rec);
        }
        if (Settlement.simmerEmptyCount(fire) > 0 && heldPredQty(rec, ingPred) > 0) {
            const walked = goOrWalk(world, rec, fire);
            if (walked) return walked;
            let placed = 0;
            while (Settlement.simmerEmptyCount(fire) > 0) {
                const found = findHeld(rec, ingPred);
                if (!found) break;
                const slot = fire.simmer.findIndex((s) => !s);
                if (slot < 0) break;
                fire.simmer[slot] = takeCookPiece(found);
                placed++;
            }
            if (placed) {
                emitEntry(world, fire);
                world._dirtyPawnOwner(rec);
            }
        } else if (empty > 0 && heldIng <= 0 && !findStored(world, rec, settle, ingPred)) {
            if (!(fire.simmer || []).some((s) => s) && !needTool) endWorkHold(rec);
        }
        const facing = faceFire(rec, fire);
        return halt(facing ? { facing } : null);
    }

    const cook = fire.cook;
    reserveRoastCatalyst(world, rec, settle, fire, bill);
    if (cook && (bill.leftover || Settlement.cookOutputReady(getItem, cook, bill))) {
        const walked = goOrWalk(world, rec, fire);
        if (walked) return walked;
        fire.cook = null;
        if (!takeOffFire(world, rec, settle, cook)) {
            fire.cook = cook;
            return halt();
        }
        if (!bill.leftover) Settlement.noteBillCrafted(bill);
        emitEntry(world, fire);
        persistBills(world, settle, fire.uid);
        if (!hasRoastInput(world, rec, settle, bill)) clearCatalystReserved(fire);
        if (shouldTakeLeftoverStick(world, rec, settle, fire, bill)) {
            takeFireCatalyst(world, rec, settle, fire);
        } else if (isRoastCookBill(bill) && Settlement.isCookTool(getItem, fire.catalyst, method)) {
            markCatalystReserved(fire);
            emitEntry(world, fire);
        }
        return finishPut(world, rec, settle);
    }
    if (cook && !Settlement.cookFitsBill(getItem, cook, bill)) {
        const walked = goOrWalk(world, rec, fire);
        if (walked) return walked;
        fire.cook = null;
        if (!takeOffFire(world, rec, settle, cook)) {
            fire.cook = cook;
            return halt();
        }
        emitEntry(world, fire);
        return finishPut(world, rec, settle);
    }
    if (shouldTakeLeftoverStick(world, rec, settle, fire, bill)) {
        const walked = goOrWalk(world, rec, fire);
        if (walked) return walked;
        takeFireCatalyst(world, rec, settle, fire);
        return finishPut(world, rec, settle);
    }
    if (bill.leftover) {
        endWorkHold(rec);
        return halt();
    }
    if (fire.id !== "campfire" || !(Number(fire.burnRemaining) > 0 || Number(fire.pitTemp) > 0)) {
        return doLightFire(world, rec, settle, fire);
    }
    stokeUntilKeep(world, rec, settle, fire);
    if (!world._campfireHasFuel(fire)) return halt();
    const cat = fire.catalyst;
    if (!Settlement.isCookTool(getItem, cat, method)) {
        if (cook) {
            const walked = goOrWalk(world, rec, fire);
            if (walked) return walked;
            fire.cook = null;
            if (!takeOffFire(world, rec, settle, cook)) {
                fire.cook = cook;
                return halt();
            }
            emitEntry(world, fire);
            return finishPut(world, rec, settle);
        }
        if (cat) {
            const walked = goOrWalk(world, rec, fire);
            if (walked) return walked;
            if (!takeFireCatalyst(world, rec, settle, fire)) return halt();
        }
        const found = findCookTool(world, rec, settle, method);
        if (!found) {
            endWorkHold(rec);
            return halt();
        }
        if (found.at !== rec) return fetchCookPiece(world, rec, settle, found) || halt();
        const walked = goOrWalk(world, rec, fire);
        if (walked) return walked;
        fire.catalyst = takeCookPiece(found);
        if (isRoastCookBill(bill)) markCatalystReserved(fire);
        emitEntry(world, fire);
        world._dirtyPawnOwner(rec);
        return halt();
    }
    reserveRoastCatalyst(world, rec, settle, fire, bill);
    if (!cook) {
        const found = findCookFood(world, rec, settle, bill, job.skipInputIds);
        if (!found) {
            if (!hasRoastInput(world, rec, settle, bill) && shouldTakeLeftoverStick(world, rec, settle, fire, bill)) {
                const walked = goOrWalk(world, rec, fire);
                if (walked) return walked;
                takeFireCatalyst(world, rec, settle, fire);
                return finishPut(world, rec, settle);
            } else if (!hasRoastInput(world, rec, settle, bill) && catalystReserved(fire)) {
                clearCatalystReserved(fire);
                emitEntry(world, fire);
            }
            endWorkHold(rec);
            return halt();
        }
        if (found.at !== rec) {
            markCatalystReserved(fire);
            emitEntry(world, fire);
            return fetchCookPiece(world, rec, settle, found) || halt();
        }
        const walked = goOrWalk(world, rec, fire);
        if (walked) return walked;
        fire.cook = takeCookPiece(found);
        Fire.onCookChanged?.(fire, null);
        markCatalystReserved(fire);
        emitEntry(world, fire);
        world._dirtyPawnOwner(rec);
    }
    const walked = goOrWalk(world, rec, fire);
    if (walked) return walked;
    stokeUntilKeep(world, rec, settle, fire);
    const facing = faceFire(rec, fire);
    return halt(facing ? { facing } : null);
}

function doLeather(world, rec, settle, job) {
    if (!job) return halt();
    if (job.kind === "smoke" || job.bill?.method === "smoke_hide") {
        return doCook(world, rec, settle, job);
    }
    if (job.kind === "soak_pickup") {
        const drop = job.drop;
        const walked = goToDrop(world, rec, drop);
        if (walked) return walked;
        world._tryPickup(rec, { dropId: drop.uid });
        rec._haulDestUid = pickBasket(world, rec, settle, dropAsStack(drop))?.uid || null;
        return halt();
    }
    if (job.kind === "soak_drop") {
        const water = job.water;
        const rack = job.station;
        let found = findStack(world, rec, settle, (s) => Settlement.hideAllowsStack(job.bill, s, getItem));
        if (!found && job.fromRack && rackHang(rack)) {
            const walked = goOrWalk(world, rec, rack);
            if (walked) return walked;
            faceRack(rec, rack);
            const hang = rackHang(rack);
            rack.slots[0] = null;
            if (!givePawn(rec, hang)) {
                rack.slots[0] = hang;
                return halt();
            }
            emitEntry(world, rack);
            found = findStack(world, rec, settle, (s) => Settlement.hideAllowsStack(job.bill, s, getItem));
        }
        if (!found) return halt();
        if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
        rec._wadeWater = true;
        const c = rec.creature || world.creatures.get(rec.id);
        if (c) c._wadeWater = true;
        const arrive = Math.max(8, TS * 0.85);
        const inWater = world._tileKeyAt(world._tileOf(rec.x, rec.y - 1).tx, world._tileOf(rec.x, rec.y - 1).ty) === "water"
            || world._tileKeyAt(world._tileOf(rec.x, rec.y).tx, world._tileOf(rec.x, rec.y).ty) === "water";
        if (!inWater || Math.hypot(rec.x - water.x, rec.y - water.y) > arrive) {
            return walkTo(water.x, water.y);
        }
        const one = takeOne(found);
        if (one) world._pushDrop(water.x, water.y, world._cloneStackForWorld(one));
        rec._wadeWater = false;
        if (c) c._wadeWater = false;
        world._dirtyPawnOwner(rec);
        endWorkHold(rec);
        return halt();
    }
    const rack = job.station;
    if (!rack) return halt();
    if (job.kind === "unload") {
        const walked = goOrWalk(world, rec, rack);
        if (walked) return walked;
        const hang = rackHang(rack);
        if (!hang) return haltAtRack(rec, rack);
        if (!Hide.canTakeFromRack(getItem(hang.id))) return haltAtRack(rec, rack);
        rack.slots[0] = null;
        if (!putInBasket(world, rec, settle, hang)) {
            rack.slots[0] = hang;
            return haltAtRack(rec, rack);
        }
        Settlement.noteBillCrafted(job.bill);
        emitEntry(world, rack);
        persistBills(world, settle, rack.uid);
        const facing = faceRack(rec, rack);
        return finishPut(world, rec, settle, facing ? { facing } : null);
    }
    if (job.kind === "hang") {
        if (rackHang(rack)) return halt();
        const found = findStack(world, rec, settle, (s) => Settlement.hideAllowsStack(job.bill, s, getItem));
        if (!found) return halt();
        if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
        const walked = goOrWalk(world, rec, rack);
        if (walked) return walked;
        const one = takeOne(found);
        if (one) {
            Place.ensureStorageEntry(rack, world._thingDef(rack.id));
            rack.slots[0] = world._hangIfRack(rack, one);
            emitEntry(world, rack);
            world._dirtyPawnOwner(rec);
        }
        endWorkHold(rec);
        return haltAtRack(rec, rack);
    }
    if (job.kind === "work") {
        const method = job.bill.method;
        const need = Settlement.hideToolNeed(method);
        // Fetch the tool/brain first. Walking to the rack first made them
        // arrive, then path to a basket, then re-approach the rack every
        // tick — a north/south jiggle on the interact-range boundary.
        if (need === "scraper") {
            const tool = findStack(world, rec, settle, (s) => Carry.stackToolClass(s, getItem(s.id)) === "scraper");
            if (!tool) return halt();
            if (tool.at !== rec) return fetchStack(world, rec, settle, tool) || halt();
            rec.hotbarIndex = tool.index;
        } else if (need === "brain") {
            const brain = findStack(world, rec, settle, (s) => Hide.isBrainItem(getItem(s.id)));
            if (!brain) return halt();
            if (brain.at !== rec) return fetchStack(world, rec, settle, brain) || halt();
            rec.hotbarIndex = brain.index;
        }
        const walked = goOrWalk(world, rec, rack);
        if (walked) return walked;
        const hang = rackHang(rack);
        if (!hang) return haltAtRack(rec, rack);
        if (need === "scraper") {
            const held = rec.inventory[rec.hotbarIndex];
            const seconds = Hide.FLESH_SECONDS || 10;
            const quality = knapQualityDurationScale(held?.knapQuality);
            const max = seconds * 1000 * manipScale(world, rec) * quality;
            rec._workChannel = {
                kind: "flesh",
                remaining: max,
                max,
                slot: rec.hotbarIndex,
                uid: rack.uid
            };
            Settlement.noteBillCrafted(job.bill);
            persistBills(world, settle, rack.uid);
            return haltAtRack(rec, rack);
        }
        if (need === "brain") {
            const seconds = Hide.BRAIN_SECONDS || 10;
            const max = seconds * 1000 * manipScale(world, rec);
            rec._workChannel = {
                kind: "brain",
                remaining: max,
                max,
                slot: rec.hotbarIndex,
                uid: rack.uid
            };
            Settlement.noteBillCrafted(job.bill);
            persistBills(world, settle, rack.uid);
            return haltAtRack(rec, rack);
        }
        return haltAtRack(rec, rack);
    }
    if (job.kind === "bench") {
        const bench = job.station;
        const recId = job.bill.recipeId || job.bill.outputId;
        const recipe = recId ? world._parseRecipe(recId) : null;
        const have = (id) => countItem(world, settle, id);
        if (!recipe || (job.bill && !Settlement.billIsActive(job.bill, have, settle))) {
            stopLeather(world, rec, job, false);
            return halt();
        }
        const fetched = fetchBenchMats(world, rec, settle, job.bill, recipe);
        if (fetched?.blocked) {
            stopLeather(world, rec, job, true);
            return halt();
        }
        if (fetched) return fetched;
        const walked = goOrWalk(world, rec, bench);
        if (walked) return walked;
        for (const ing of recipe.ingredients || []) {
            if (world._countMatchingItems(rec, ing) < ing.qty) {
                stopLeather(world, rec, job, true);
                return halt();
            }
        }
        if (recipe.requireStation && !world._hasNearbyThing(rec, recipe.requireStation)) {
            stopLeather(world, rec, job, true);
            return halt();
        }
        if (!canReceiveCraft(world, rec, settle, recipe, job.bill)) {
            stopLeather(world, rec, job, true);
            return halt();
        }
        const held = rec.inventory[rec.hotbarIndex];
        const seconds = Math.max(0.1, Number(recipe.craftSeconds) || 1);
        const quality = knapQualityDurationScale(held?.knapQuality);
        const material = knapMaterialDurationScale(held?.knapMaterial);
        const max = seconds * 1000 * manipScale(world, rec) * quality * material;
        rec._workChannel = {
            kind: "craft",
            remaining: max,
            max,
            slot: rec.hotbarIndex,
            uid: bench.uid,
            recipeId: recId,
            toolClass: recipe.requireTool?.toolClass || null
        };
        Settlement.noteBillCrafted(job.bill);
        persistBills(world, settle, bench.uid);
        rec._settlerScan = null;
        rec._settlerScanMs = SCAN_MS;
        return haltAtBench(rec, bench);
    }
    return halt();
}

function chopStandFeet(world, rec, c, tree, hs) {
    const body = c?.bodyCenter?.() || { x: rec.x, y: rec.y };
    const dist = Chop.standDist(hs, 0);
    const pack = (aimX, aimY) => {
        const feetX = aimX + ((Number(rec.x) || 0) - body.x);
        const feetY = aimY + ((Number(rec.y) || 0) - body.y);
        return {
            body,
            stand: { aimX, aimY },
            feetX,
            feetY,
            dAim: Math.hypot(body.x - aimX, body.y - aimY)
        };
    };
    const free = (aimX, aimY) => {
        const feetX = aimX + ((Number(rec.x) || 0) - body.x);
        const feetY = aimY + ((Number(rec.y) || 0) - body.y);
        if (typeof world?._partyPoseBlocked === "function" && c) {
            return !world._partyPoseBlocked(c, feetX, feetY, 0);
        }
        return true;
    };
    const prefer = Chop.ringStand(body.x, body.y, tree.x, tree.y, hs, 0);
    if (free(prefer.aimX, prefer.aimY)) return pack(prefer.aimX, prefer.aimY);
    let best = null;
    let bestD = Infinity;
    const start = rec._chopOrbit || 0;
    for (let i = 0; i < 8; i++) {
        const a = ((start + i) / 8) * Math.PI * 2;
        const aimX = tree.x + Math.cos(a) * dist;
        const aimY = tree.y + Math.sin(a) * dist;
        if (!free(aimX, aimY)) continue;
        const d = Math.hypot(body.x - aimX, body.y - aimY);
        if (d < bestD) {
            bestD = d;
            best = { aimX, aimY };
        }
    }
    if (best) return pack(best.aimX, best.aimY);
    return pack(prefer.aimX, prefer.aimY);
}

function clearChopApproach(rec, c) {
    if (rec) {
        rec._chopArrived = false;
        rec._chopIgnoreUid = null;
        rec._chopSidestep = false;
        rec._chopOrbit = 0;
        rec._chopMissMs = 0;
        if (rec._busyJob?.type === "chop") endWorkHold(rec);
    }
    if (c) c._chopIgnoreUid = null;
}

function chopTargetLive(world, tree) {
    if (!tree || tree.gone) return false;
    const def = world._thingDef(tree.id);
    if (!Chop.stillChoppable(def, tree)) return false;
    if (Settlement.chopSkipsTree(tree.id, def, tree)) return false;
    return true;
}

function dropChopTarget(rec, tree) {
    clearChopApproach(rec, rec.creature);
    if (rec._settlerScan) rec._settlerScan.chopTree = null;
    rec._settlerScanMs = SCAN_MS;
    if (tree) skipJob(rec, thingKey(tree));
}

function markChopTarget(rec, c, tree) {
    const uid = tree?.uid || null;
    rec._chopIgnoreUid = uid;
    if (c) c._chopIgnoreUid = uid;
}

function pigmentPred(entry) {
    return (s) => Research.isPigment(getItem(s.id), s) && Research.allowsPigment(entry, s, getItem);
}

function doResearch(world, rec, settle, circle) {
    const entry = circle?.entry || circle;
    if (!entry || !Research) {
        endWorkHold(rec);
        return halt();
    }
    const def = world._thingDef(entry.id);
    Research.ensureEntry(entry, def);
    if (!Research.isEnabled(entry)) {
        endWorkHold(rec);
        return halt();
    }
    const tallyId = Research.TALLY_ITEM_ID || "tally_stick";
    if (Research.needsTallyInstall?.(settle, entry)) {
        const found = findStack(world, rec, settle, (s) => s?.id === tallyId);
        if (found) {
            if (found.at !== rec) {
                clearPaintBar(rec);
                return fetchStack(world, rec, settle, found) || halt();
            }
            const walked = goOrWalk(world, rec, entry);
            if (walked) {
                clearPaintBar(rec);
                return walked;
            }
            const piece = takeOne(found);
            if (piece && Research.installTally(entry)) {
                emitEntry(world, entry);
                world._dirtyPawnOwner(rec);
                const facing = facePaint(rec, entry);
                return halt(facing ? { facing } : null);
            } else if (piece) {
                restorePiece(found, piece);
            }
        } else {
            const drop = (dropsOf(world, settle) || []).find((d) => d && d.id === tallyId);
            if (drop) {
                clearPaintBar(rec);
                const walked = goToDrop(world, rec, drop);
                if (walked) return walked;
                world._tryPickup?.(rec, { dropId: drop.uid, quantity: 1 });
                world._dirtyPawnOwner(rec);
                return halt();
            }
        }
    }
    if (!Research.hasRoom(entry) && !Research.inProgress(entry)) {
        endWorkHold(rec);
        return halt();
    }
    if (Research.needsPigment(entry)) {
        const found = findStack(world, rec, settle, pigmentPred(entry));
        if (!found) {
            endWorkHold(rec);
            return halt();
        }
        if (found.at !== rec) {
            clearPaintBar(rec);
            return fetchCookPiece(world, rec, settle, found) || halt();
        }
        const walked = goOrWalk(world, rec, entry);
        if (walked) {
            clearPaintBar(rec);
            return walked;
        }
        const piece = takeOne(found);
        if (!piece || !Research.startPaint(entry, piece.id)) {
            if (piece) restorePiece(found, piece);
            endWorkHold(rec);
            return halt();
        }
        emitEntry(world, entry);
        world._dirtyPawnOwner(rec);
    }
    const walked = goOrWalk(world, rec, entry);
    if (walked) {
        clearPaintBar(rec);
        return walked;
    }
    const now = world.gameMinutes;
    if (rec._paintTickMin == null) rec._paintTickMin = now;
    let elapsed = Research.minuteDelta(now, rec._paintTickMin);
    if (elapsed > 60) elapsed = 1;
    rec._paintTickMin = now;
    if (elapsed > 0 && Research.inProgress(entry)) {
        const r = Research.addPaintMinutes(entry, elapsed);
        if (r.changed) emitEntry(world, entry);
    }
    setPaintBar(rec, entry);
    const facing = facePaint(rec, entry);
    return halt(facing ? { facing } : null);
}

function doChop(world, rec, settle, tree, delta) {
    if (!chopTargetLive(world, tree)) {
        dropChopTarget(rec, tree);
        return halt();
    }
    const found = findStack(world, rec, settle, (s) => Chop.isChopper(s));
    if (!found) {
        clearChopApproach(rec, rec.creature);
        return halt();
    }
    if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
    rec.hotbarIndex = found.index;
    const c = rec.creature || world._ensureSettlerCreature(rec);
    if (c) {
        c.inventory = rec.inventory;
        c.hotbarIndex = rec.hotbarIndex;
    }
    markChopTarget(rec, c, tree);
    if (c?.isAttacking?.()) return halt();
    const def = world._thingDef(tree.id);
    const hs = Number(def?.hitboxSize) || 5;
    const body = c?.bodyCenter?.() || { x: rec.x, y: rec.y };
    const ang = Math.atan2(tree.y - body.y, tree.x - body.x);
    const hits = !!(Chop.aimHitsTrunk && Chop.aimHitsTrunk(body.x, body.y, ang, tree.x, tree.y, hs));
    const pose = chopStandFeet(world, rec, c, tree, hs);
    const enter = 6;
    const leave = 10;
    if (rec._chopArrived && pose.dAim > leave) rec._chopArrived = false;
    if (!rec._chopArrived && pose.dAim <= enter) rec._chopArrived = true;
    const ai = c?.ai;
    if ((ai?._jamMs || 0) > 900 || (ai?._stuckMs || 0) > 1800) {
        dropChopTarget(rec, tree);
        return halt();
    }
    if (hits && rec._chopArrived) {
        rec._chopMissMs = 0;
        const chop = Chop.pickChopFromAttacks?.(BodyCombat.collectAttacks(c)) || null;
        if (chop && c?.tryMeleeAttack) c.tryMeleeAttack(tree, chop);
        else if (c?.startMeleeAttack) c.startMeleeAttack(ang);
        return halt();
    }
    if (!rec._chopArrived) {
        rec._chopMissMs = 0;
        return walkTo(pose.feetX, pose.feetY, { openRadius: 0 });
    }
    const dt = Number(delta) > 0 ? Number(delta) : 16;
    rec._chopMissMs = (rec._chopMissMs || 0) + dt;
    if (rec._chopMissMs > 900) {
        dropChopTarget(rec, tree);
        return halt();
    }
    return halt();
}

function doDoctor(world, rec, settle, patient) {
    if (!patient || patient.dead) {
        dropPatient(world, rec, patient, false);
        return halt();
    }
    if (!patientNeedsTend(world, patient)) {
        dropPatient(world, rec, patient, false);
        return halt();
    }
    const found = findStack(world, rec, settle, (s) => !!getItem(s.id)?.bandage);
    if (!found) {
        if (rec._settlerScan) {
            rec._settlerScan.patients = [];
            rec._settlerScan.keepBandage = false;
        }
        dropPatient(world, rec, patient, false);
        return halt();
    }
    if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
    rec.hotbarIndex = found.index;
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
    const owner = world.players.get(rec.ownerId) || rec;
    const patientC = world._creatureForPawn?.(owner, patient)
        || pawnCreature(world, patient);
    const anatomy = patientC?.anatomy;
    if (!anatomy) {
        dropPatient(world, rec, patient, true);
        return halt();
    }
    const stack = rec.inventory[found.index];
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
        slot: found.index,
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

function isAutoEatFood(world, rec, stack) {
    const food = world._foodForEat(stack);
    if (!(Number(food?.kc) > 0)) return false;
    const starving = Party.isStarving(rec);
    const poison = Number(food.foodPoisonChance ?? 0) > 0;
    if (poison && !starving) return false;
    if (Party.isReservedAutoEat(stack, food) && !starving) return false;
    return true;
}

function doEat(world, rec, settle) {
    if (rec.eatChannel) return halt();
    const kc = Number(rec.kc) || 0;
    const sitting = rec._eatSitting;
    if (sitting && kc >= sitting.until) {
        rec._eatSitting = null;
        return null;
    }
    if (!sitting && kc >= AUTO_EAT) return null;
    const found = findStack(world, rec, settle, (s) => isAutoEatFood(world, rec, s));
    if (!found) {
        rec._eatSitting = null;
        return null;
    }
    if (found.at !== rec) return fetchEatStack(world, rec, settle, found) || halt();
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
        pawnId: rec.id,
        channel: "eat",
        itemId: stack.id,
        progress: 0
    });
    world._dirtyPawnOwner?.(rec);
    return halt();
}

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
        const eat = doEat(world, rec, settle);
        if (eat) {
            rec._researchPoll = 0;
            endWorkHold(rec);
            setSettlerAct(rec, mob, rec.eatChannel ? "Eating" : "Getting food");
            return eat;
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
        chopTree: scan.chopTree,
        researchCircle: scan.researchCircle,
        stashBasket: stash.basket,
        hasStash: stash.has,
        hasFoodStash: stash.hasFood,
        stashUrgent: stash.urgent,
        mergeNeedsRoom: mergeNeedsRoom(rec, scan.haulMerge),
        busy: hold,
        busyJob: rec._busyJob || null,
        reconsiderNeeds: pollNeeds
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
        const eat = doEat(world, rec, settle);
        if (eat) {
            endWorkHold(rec);
            setSettlerAct(rec, mob, rec.eatChannel ? "Eating" : "Getting food");
            return eat;
        }
    }

    if (Settlement.isBusyWork(plan.type)) beginWorkHold(rec, plan);
    else if (!delivering && plan.type !== "chop") endWorkHold(rec);

    const ctx = actCtx(world, rec, {
        stashStack: firstStashable(rec, keepOpts),
        haulWhat: rec._haulWhat
    });
    let label = Settlement.actLabel(plan, ctx);
    if (delivering) label = Settlement.actLabel({ type: "stash" }, ctx);
    if (plan.type !== "chop") clearChopApproach(rec, rec.creature || mob);
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
    if (plan.type === "gather" && plan.target) return doGather(world, rec, plan.target);
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

    return { tick, releaseWork, interruptForCombat, tickChannel, publicChannel, bumpWork };
});
