/**
 * Dedicated-server settler jobs. Same Settlement.planWork policy as client PartyAI.
 */
const Settlement = require("../shared/settlement");
const StorageFilter = require("../shared/storageFilter");
const Place = require("../shared/place");
const Sleep = require("../shared/sleep");
const Hide = require("../shared/hide");
const Chop = require("../shared/chop");
const Carry = require("../shared/carry");
const Party = require("../shared/party");
const Spoil = require("../shared/spoil");
const Fire = require("../shared/fire");
const BodyHealing = require("../shared/body/Healing");
const DataStore = require("../shared/DataStore");

const TS = 16;
const SCAN_MS = 280;
const INTERACT_TILES = 2.4;
const SKIP_MS = 4500;
const AUTO_EAT = Party.AUTO_EAT_BELOW || 1000;

function getItem(id) {
    return DataStore.getItem(id);
}

function near(px, py, tx, ty) {
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
    return Math.hypot(px - tx, py - ty) / TS <= INTERACT_TILES;
}

function walkTo(x, y, extra = null) {
    return { walkTo: { x, y }, sprint: false, ...(extra || {}) };
}

function halt(extra = null) {
    return { halt: true, ...(extra || {}) };
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

function releaseWork(world, mob) {
    const rec = findRec(world, mob);
    if (!rec) return;
    const settle = findSettle(world, rec);
    const claims = settle ? claimsFor(world, settle) : null;
    claims?.release(rec.id);
    rec._haulDestUid = null;
    rec._haulMergeOnly = false;
    rec._workChannel = null;
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
    if (t === "cook" || t === "cook_light") {
        return stationKey(plan.target?.fire || plan.target?.entry || plan.target);
    }
    if (t === "leather") return leatherJobKey(plan.target);
    if (t === "gather" || t === "chop") return thingKey(plan.target);
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
    else if (t === "leather") scan.leatherWork = null;
    else if (t === "cook") scan.cookBill = null;
    else if (t === "cook_light") scan.unlitFire = null;
    else if (t === "sleep") scan.bed = null;
    else if (t === "doctor") {
        const p = plan.target;
        scan.patients = (scan.patients || []).filter((x) => x !== p);
    }
}

function settleChunks(world, settle) {
    const keys = Settlement.chunkKeysFor(settle, TS, 8) || [];
    const out = [];
    for (const key of keys) {
        const c = world.chunks.get(key);
        if (c) out.push(c);
    }
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
    if (!found) return null;
    const stack = found.slots[found.index];
    if (!stack) return null;
    const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
    if (qty <= 1) {
        found.slots[found.index] = null;
        return stack;
    }
    stack.quantity = qty - 1;
    return { ...stack, quantity: 1 };
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
    const out = [];
    for (const uid of settle.stationUids || []) {
        const found = world._findThingByUid(uid);
        if (!found?.entry) continue;
        if (Settlement.stationKind(found.entry.id) !== "storage") continue;
        Place.ensureStorageEntry(found.entry, world._thingDef(found.entry.id));
        out.push(found.entry);
    }
    return out;
}

function stationsOf(world, settle, kind) {
    const out = [];
    for (const uid of settle.stationUids || []) {
        const found = world._findThingByUid(uid);
        if (!found?.entry) continue;
        const k = Settlement.stationKind(found.entry.id);
        if (kind && k !== kind) continue;
        out.push(found.entry);
    }
    return out;
}

function dropsOf(world, settle) {
    const out = [];
    for (const c of settleChunks(world, settle)) {
        if (!Array.isArray(c.drops)) continue;
        for (const d of c.drops) {
            if (!d || !(Number(d.quantity) > 0)) continue;
            if (!inRange(settle, d.x, d.y)) continue;
            out.push(d);
        }
    }
    return out;
}

function lootablesOf(world, settle) {
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
    return out;
}

function choppablesOf(world, settle) {
    const out = [];
    const consider = (e, chunk, list) => {
        if (!e || e.gone || !e.id) return;
        if (!inRange(settle, e.x, e.y)) return;
        const def = world._thingDef(e.id);
        if (!Chop.isChoppable(def)) return;
        if (Settlement.chopSkipsTree(e.id, def)) return;
        if (!Chop.stillChoppable(def, e)) return;
        out.push({ entry: e, def, chunk, list });
    };
    for (const c of settleChunks(world, settle)) {
        world._ensureLootableUids(c);
        for (const e of c.things || []) consider(e, c, "things");
        for (const e of c.lootableThings || []) consider(e, c, "lootable");
    }
    return out;
}

function settlersOf(world, settle) {
    return (world.settlers || []).filter(
        (s) => s && !s.dead && s.homeSettlementId === settle.id
    );
}

function countItem(world, settle, itemId) {
    let n = Settlement.countStock(basketsOf(world, settle), itemId);
    n += Settlement.countPawnStock(settlersOf(world, settle), itemId);
    n += Settlement.countDropStock(dropsOf(world, settle), itemId);
    return n;
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
    if (ii >= 0) return { slots: inv, index: ii, at: rec, kind: "inv" };
    for (const b of basketsOf(world, settle)) {
        const slots = b.slots || [];
        const i = slots.findIndex((s) => s && pred(s));
        if (i < 0) continue;
        return { slots, index: i, at: b, kind: "basket", entry: b };
    }
    return null;
}

function stashScan(world, rec, settle, keepBandage) {
    const canStore = (s) => !!pickBasket(world, rec, settle, s);
    const opts = { keepBandage: !!keepBandage };
    if (!Settlement.hasStashable(rec.inventory, rec.overflow, getItem, canStore, opts)) {
        return { basket: null, has: false, urgent: false };
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
        urgent: !!Settlement.stashIsUrgent(rec.inventory, rec.overflow, getItem, canStore, opts)
    };
}

function depositKeepGear(world, rec, settle, keepBandage) {
    const keep = Settlement.keepIndices(rec.inventory, getItem, { keepBandage: !!keepBandage });
    const dump = (slots, skipKeep) => {
        if (!slots) return;
        for (let i = 0; i < slots.length; i++) {
            if (skipKeep && keep.has(i)) continue;
            const s = slots[i];
            if (!s) continue;
            const b = pickBasket(world, rec, settle, s);
            if (!b) continue;
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
    const haveOf = (id) => countItem(world, settle, id);
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
    const have = Settlement.countStock(basketsOf(world, settle), "log")
        + Settlement.countPawnStock(settlersOf(world, settle), "log");
    const want = Settlement.stockTarget(settle, "log");
    if (!Settlement.gatherShouldWork(have, want) && !billNeedsLogs(world, settle)) return null;
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

function billNeedsLogs(world, settle) {
    for (const uid of settle.stationUids || []) {
        for (const b of Settlement.billsOf(settle, uid)) {
            if (!b || b.paused) continue;
            if (b.method === "stick_roast" || b.method === "shell_simmer" || b.method === "smoke_hide") {
                return true;
            }
        }
    }
    return false;
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

function patientNeedsTend(world, rec) {
    const c = rec.creature || world.creatures.get(rec.id) || world._ensureSettlerCreature(rec);
    if (!c || c.isBodyDead?.()) return false;
    return !!BodyHealing.pickTendTarget?.(c.anatomy);
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

function lightOpts(world, rec, settle) {
    let hasFirestarter = false;
    let hasFuel = false;
    const scan = (slots) => {
        for (const s of slots || []) {
            if (Settlement.isFirestarter(s, getItem)) hasFirestarter = true;
            const meta = s ? getItem(s.id) : null;
            if (meta?.fuel || s?.id === "stick" || s?.id === "log") hasFuel = true;
        }
    };
    scan(rec.inventory);
    for (const b of basketsOf(world, settle)) scan(b.slots);
    return { hasFirestarter, hasFuel, hasGroundRecipe: false };
}

function cookHasWork(world, rec, settle, fire, bill) {
    const method = bill.method || "stick_roast";
    if (method === "shell_simmer") {
        const cat = fire.catalyst;
        if (Settlement.cookOutputReady(getItem, cat, bill)) return true;
        const filled = (fire.simmer || []).filter(Boolean).length;
        if (filled >= (Settlement.SIMMER_MIN_SLOTS || 2) && Settlement.isCookTool(getItem, cat, method)) {
            return true;
        }
        const hasTool = Settlement.isCookTool(getItem, cat, method)
            || !!findStack(world, rec, settle, (s) => Settlement.isCookTool(getItem, s, method));
        let n = filled;
        const countInv = (slots) => {
            for (const s of slots || []) {
                if (!s || !Settlement.cookInputReady(getItem, s, bill)) continue;
                n += Math.max(1, Number(s.quantity) || 1);
            }
        };
        countInv(rec.inventory);
        for (const b of basketsOf(world, settle)) countInv(b.slots);
        return !!(hasTool && n >= (Settlement.SIMMER_MIN_SLOTS || 2));
    }
    if (fire.cook) return true;
    const hasTool = Settlement.isCookTool(getItem, fire.catalyst, method)
        || !!findStack(world, rec, settle, (s) => Settlement.isCookTool(getItem, s, method));
    const hasFood = !!findStack(world, rec, settle, (s) => Settlement.cookInputReady(getItem, s, bill));
    return !!(hasTool && hasFood);
}

function cookBill(world, rec, settle, claims) {
    const fires = stationsOf(world, settle, "campfire");
    const have = (id) => countItem(world, settle, id);
    const tryFire = (f) => {
        if (!f) return null;
        const bill = Settlement.activeBill(settle, f.uid, have);
        if (bill && cookHasWork(world, rec, settle, f, bill)) return { fire: f, bill, entry: f };
        return null;
    };
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

    if (hang && hangStage === step.outputStage) {
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
        const bill = Settlement.activeBill(settle, rack.uid, have);
        if (!bill) continue;
        const job = rackBillJob(world, rec, settle, rack, bill);
        if (job) jobs.push(job);
    }
    for (const bench of stationsOf(world, settle, "craft")) {
        const bill = Settlement.activeBill(settle, bench.uid, have);
        if (!bill) continue;
        if (!benchHasWork(world, rec, settle, bill)) continue;
        jobs.push({ kind: "bench", station: bench, bill, pri: 8, entry: bench });
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
    const patients = settlerPatients(world, rec, settle, claims);
    const doctorOn = Settlement.enabledJobs(jobs).includes("doctor");
    const keepBandage = !!(doctorOn && patients.length);
    const night = Settlement.isNight(world.gameMinutes);
    const c = rec.creature || world.creatures.get(rec.id);
    const injured = Sleep.injuredForAutofill ? Sleep.injuredForAutofill(c?.anatomy) : false;
    const stash = stashScan(world, rec, settle, keepBandage);
    return {
        unlitFire: unlitFire(world, rec, settle, claims),
        light: lightOpts(world, rec, settle),
        cookBill: cookBill(world, rec, settle, claims),
        leatherWork: leatherWork(world, rec, settle, claims),
        haulDrop: haulDrop(world, rec, settle, claims),
        haulMerge: StorageFilter.findMergeJob(
            basketsOf(world, settle),
            getItem,
            rec.x,
            rec.y,
            { isClaimed: (key) => claimedByOther(claims, key, rec.id) || isSkipped(rec, key) }
        ),
        gatherThing: gatherThing(world, rec, settle, claims),
        chopTree: chopTree(world, rec, settle, claims),
        patients,
        keepBandage,
        bed: (night || injured) ? freeBed(world, rec, settle, claims) : null,
        stash,
        night,
        injured,
        jobs
    };
}

function fetchStack(world, rec, settle, found) {
    if (!found) return halt();
    if (found.at !== rec && found.entry) {
        if (!near(rec.x, rec.y, found.entry.x, found.entry.y)) {
            return walkTo(found.entry.x, found.entry.y);
        }
        const stack = takeFound(found);
        if (!stack) return halt();
        if (!givePawn(rec, stack)) {
            found.slots[found.index] = stack;
            return halt();
        }
        emitEntry(world, found.entry);
        world._dirtyPawnOwner(rec);
        return halt();
    }
    return null;
}

function putInBasket(world, rec, settle, stack) {
    const b = pickBasket(world, rec, settle, stack);
    if (b && insertInEntry(world, b, stack)) {
        emitEntry(world, b);
        return true;
    }
    return givePawn(rec, stack);
}

function persistBills(world, settle, stationUid) {
    const owner = world.players.get(settle.ownerId);
    if (owner) world._youDirty.add(owner.id);
}

function goOrWalk(rec, target) {
    if (!target) return halt();
    if (near(rec.x, rec.y, target.x, target.y)) return null;
    return walkTo(target.x, target.y);
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
    const ch = rec?._workChannel;
    if (!ch || !(ch.max > 0)) return null;
    const prog = 1 - (Number(ch.remaining) || 0) / ch.max;
    return { kind: ch.kind, progress: Math.max(0, Math.min(1, prog)) };
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
            if (found) return fetchStack(world, rec, settle, found) || halt();
            continue;
        }
        if (!ing.id || ing.id === "ANY_HIDE" || ing.id === "ANY_LEATHER") continue;
        const have = countInv(rec, (s) => s.id === ing.id);
        if (have >= (ing.qty || 1)) continue;
        const found = findBasketStack(world, rec, settle, (s) => s.id === ing.id);
        if (found) return fetchStack(world, rec, settle, found) || halt();
    }
    const toolClass = recipe.requireTool?.toolClass || "awl";
    const awl = findStack(world, rec, settle, (s) => Carry.stackToolClass(s, getItem(s.id)) === toolClass);
    if (!awl) return halt();
    if (awl.at !== rec) return fetchStack(world, rec, settle, awl) || halt();
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
        if (!near(rec.x, rec.y, patient.x, patient.y)) return false;
        if (!held?.id || (ch.itemId && held.id !== ch.itemId)) return false;
        return !!getItem(held.id)?.bandage;
    }
    return false;
}

function finishWorkChannel(world, rec, ch) {
    rec._workChannel = null;
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

function tickChannel(world, rec, dtMs) {
    const ch = rec?._workChannel;
    if (!ch) return;
    if (!channelStillValid(world, rec, ch)) {
        rec._workChannel = null;
        return;
    }
    ch.remaining -= Number(dtMs) || 0;
    if (ch.remaining <= 0) finishWorkChannel(world, rec, ch);
}

function doGather(world, rec, target) {
    if (!target) return halt();
    const walked = goOrWalk(rec, target);
    if (walked) return walked;
    world._tryHarvest(rec, { uid: target.uid });
    return halt();
}

function doHaul(world, rec, settle, drop) {
    if (!drop) return halt();
    const key = dropKey(drop);
    const walked = goOrWalk(rec, drop);
    if (walked) return walked;
    if (leaveHaulDrop(world, drop)) {
        skipJob(rec, key);
        rec._haulDestUid = null;
        return halt();
    }
    const stack = dropAsStack(drop);
    const basket = stack ? pickBasket(world, rec, settle, stack) : null;
    if (!stack || !basket) {
        skipJob(rec, key);
        return halt();
    }
    world._tryPickup(rec, { dropId: drop.uid });
    rec._haulDestUid = basket.uid;
    world._dirtyPawnOwner(rec);
    return halt();
}

function doStash(world, rec, settle, basket, keepBandage) {
    if (!basket) return halt();
    const walked = goOrWalk(rec, basket);
    if (walked) return walked;
    depositKeepGear(world, rec, settle, keepBandage);
    StorageFilter.compactSlots(basket.slots, getItem, onMerge);
    emitEntry(world, basket);
    rec._haulDestUid = null;
    return halt();
}

function doMerge(world, rec, settle, job) {
    if (!job) return halt();
    if (job.kind === "pack") {
        const b = job.basket;
        const walked = goOrWalk(rec, b);
        if (walked) return walked;
        StorageFilter.compactSlots(b.slots, getItem, onMerge);
        emitEntry(world, b);
        return halt();
    }
    const src = job.from;
    const dest = job.to;
    if (!src || !dest) return halt();
    const walked = goOrWalk(rec, src);
    if (walked) return walked;
    const stack = src.slots?.[job.fromIndex];
    if (!stack) return halt();
    if (!givePawn(rec, { ...stack })) return halt();
    src.slots[job.fromIndex] = null;
    emitEntry(world, src);
    rec._haulDestUid = dest.uid;
    rec._haulMergeOnly = true;
    world._dirtyPawnOwner(rec);
    return halt();
}

function stokeFuel(world, rec, settle, fire) {
    const take = (slots) => {
        const i = (slots || []).findIndex((s) => s && (s.id === "stick" || s.id === "log"));
        if (i < 0) return null;
        const s = slots[i];
        s.quantity = (s.quantity || 1) - 1;
        if (!(s.quantity > 0)) slots[i] = null;
        return s.id;
    };
    let id = take(rec.inventory);
    let fromBasket = null;
    if (!id) {
        for (const b of basketsOf(world, settle)) {
            id = take(b.slots);
            if (id) {
                fromBasket = b;
                break;
            }
        }
    }
    if (!id) return false;
    if (!Array.isArray(fire.fuel)) fire.fuel = [null, null];
    const slot = fire.fuel[0] && fire.fuel[0].id === id ? 0 : (fire.fuel[0] ? 1 : 0);
    const dest = fire.fuel[slot];
    if (dest && dest.id === id) dest.quantity = (dest.quantity || 1) + 1;
    else fire.fuel[slot] = { id, quantity: 1 };
    if (fromBasket) emitEntry(world, fromBasket);
    emitEntry(world, fire);
    world._dirtyPawnOwner(rec);
    return true;
}

function doLightFire(world, rec, settle, fire) {
    if (!fire) return halt();
    const walked = goOrWalk(rec, fire);
    if (walked) return walked;
    if (world._campfireHasFuel(fire) || stokeFuel(world, rec, settle, fire)) {
        const starter = findStack(world, rec, settle, (s) => Settlement.isFirestarter(s, getItem));
        if (starter && starter.at !== rec) return fetchStack(world, rec, settle, starter) || halt();
        if (starter) rec.hotbarIndex = starter.index;
        world._campfireEnsureBurning(fire);
        if (starter && starter.at === rec) world._wearHeld(rec, 1);
        emitEntry(world, fire);
    }
    return halt();
}

function doCook(world, rec, settle, job) {
    const fire = job?.fire || job?.entry;
    const bill = job?.bill;
    if (!fire || !bill) return halt();
    const method = bill.method || "stick_roast";
    const walked = goOrWalk(rec, fire);
    if (walked) return walked;

    if (method === "shell_simmer") {
        const cat = fire.catalyst;
        if (Settlement.cookOutputReady(getItem, cat, bill)) {
            fire.catalyst = null;
            if (putInBasket(world, rec, settle, cat)) Settlement.noteBillCrafted(bill);
            emitEntry(world, fire);
            persistBills(world, settle, fire.uid);
            return halt();
        }
        if (fire.id !== "campfire" || !(Number(fire.burnRemaining) > 0)) {
            return doLightFire(world, rec, settle, fire);
        }
        if (!world._campfireHasFuel(fire)) {
            stokeFuel(world, rec, settle, fire);
            return halt();
        }
        if (!Settlement.isCookTool(getItem, cat, method)) {
            if (cat) {
                fire.catalyst = null;
                putInBasket(world, rec, settle, cat);
                emitEntry(world, fire);
                return halt();
            }
            const found = findStack(world, rec, settle, (s) => Settlement.isCookTool(getItem, s, method));
            if (!found) return halt();
            if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
            fire.catalyst = takeFound(found);
            emitEntry(world, fire);
            world._dirtyPawnOwner(rec);
            return halt();
        }
        if (!Array.isArray(fire.simmer)) fire.simmer = [null, null, null, null];
        const empty = fire.simmer.findIndex((s) => !s);
        if (empty >= 0) {
            const found = findStack(world, rec, settle, (s) => Settlement.cookInputReady(getItem, s, bill));
            if (!found) return halt();
            if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
            fire.simmer[empty] = takeOne(found);
            emitEntry(world, fire);
            world._dirtyPawnOwner(rec);
        }
        return halt();
    }

    const cook = fire.cook;
    if (cook && Settlement.cookOutputReady(getItem, cook, bill)) {
        fire.cook = null;
        if (putInBasket(world, rec, settle, cook)) Settlement.noteBillCrafted(bill);
        emitEntry(world, fire);
        persistBills(world, settle, fire.uid);
        return halt();
    }
    if (fire.id !== "campfire" || !(Number(fire.burnRemaining) > 0 || Number(fire.pitTemp) > 0)) {
        return doLightFire(world, rec, settle, fire);
    }
    if (!world._campfireHasFuel(fire)) {
        stokeFuel(world, rec, settle, fire);
        return halt();
    }
    const cat = fire.catalyst;
    if (!Settlement.isCookTool(getItem, cat, method)) {
        if (cat && !cook) {
            fire.catalyst = null;
            putInBasket(world, rec, settle, cat);
            emitEntry(world, fire);
            return halt();
        }
        const found = findStack(world, rec, settle, (s) => Settlement.isCookTool(getItem, s, method));
        if (!found) return halt();
        if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
        fire.catalyst = takeFound(found);
        emitEntry(world, fire);
        world._dirtyPawnOwner(rec);
        return halt();
    }
    if (!cook) {
        const found = findStack(world, rec, settle, (s) => Settlement.cookInputReady(getItem, s, bill));
        if (!found) return halt();
        if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
        fire.cook = takeFound(found);
        Fire.onCookChanged?.(fire, null);
        emitEntry(world, fire);
        world._dirtyPawnOwner(rec);
    }
    return halt();
}

function doLeather(world, rec, settle, job) {
    if (!job) return halt();
    if (job.kind === "soak_pickup") {
        const drop = job.drop;
        const walked = goOrWalk(rec, drop);
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
            const walked = goOrWalk(rec, rack);
            if (walked) return walked;
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
        return halt();
    }
    const rack = job.station;
    if (!rack) return halt();
    if (job.kind === "unload") {
        const walked = goOrWalk(rec, rack);
        if (walked) return walked;
        const hang = rackHang(rack);
        if (!hang) return halt();
        rack.slots[0] = null;
        if (putInBasket(world, rec, settle, hang)) Settlement.noteBillCrafted(job.bill);
        emitEntry(world, rack);
        persistBills(world, settle, rack.uid);
        return halt();
    }
    if (job.kind === "hang") {
        if (rackHang(rack)) return halt();
        const found = findStack(world, rec, settle, (s) => Settlement.hideAllowsStack(job.bill, s, getItem));
        if (!found) return halt();
        if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
        const walked = goOrWalk(rec, rack);
        if (walked) return walked;
        const one = takeOne(found);
        if (one) {
            Place.ensureStorageEntry(rack, world._thingDef(rack.id));
            rack.slots[0] = world._hangIfRack(rack, one);
            emitEntry(world, rack);
            world._dirtyPawnOwner(rec);
        }
        return halt();
    }
    if (job.kind === "work") {
        const walked = goOrWalk(rec, rack);
        if (walked) return walked;
        const method = job.bill.method;
        const need = Settlement.hideToolNeed(method);
        const hang = rackHang(rack);
        if (!hang) return halt();
        if (need === "scraper") {
            const tool = findStack(world, rec, settle, (s) => Carry.stackToolClass(s, getItem(s.id)) === "scraper");
            if (!tool) return halt();
            if (tool.at !== rec) return fetchStack(world, rec, settle, tool) || halt();
            rec.hotbarIndex = tool.index;
            const held = rec.inventory[tool.index];
            const seconds = Hide.FLESH_SECONDS || 10;
            const quality = knapQualityDurationScale(held?.knapQuality);
            const max = seconds * 1000 * manipScale(world, rec) * quality;
            rec._workChannel = {
                kind: "flesh",
                remaining: max,
                max,
                slot: tool.index,
                uid: rack.uid
            };
            return halt();
        }
        if (need === "brain") {
            const brain = findStack(world, rec, settle, (s) => Hide.isBrainItem(getItem(s.id)));
            if (!brain) return halt();
            if (brain.at !== rec) return fetchStack(world, rec, settle, brain) || halt();
            rec.hotbarIndex = brain.index;
            const seconds = Hide.BRAIN_SECONDS || 10;
            const max = seconds * 1000 * manipScale(world, rec);
            rec._workChannel = {
                kind: "brain",
                remaining: max,
                max,
                slot: brain.index,
                uid: rack.uid
            };
            return halt();
        }
        return halt();
    }
    if (job.kind === "bench") {
        const bench = job.station;
        const recId = job.bill.recipeId || job.bill.outputId;
        const recipe = recId ? world._parseRecipe(recId) : null;
        if (!recipe) return halt();
        const fetched = fetchBenchMats(world, rec, settle, job.bill, recipe);
        if (fetched) return fetched;
        const walked = goOrWalk(rec, bench);
        if (walked) return walked;
        for (const ing of recipe.ingredients || []) {
            if (world._countMatchingItems(rec, ing) < ing.qty) return halt();
        }
        if (recipe.requireStation && !world._hasNearbyThing(rec, recipe.requireStation)) return halt();
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
        return halt();
    }
    return halt();
}

function doChop(world, rec, settle, tree) {
    if (!tree) return halt();
    const found = findStack(world, rec, settle, (s) => Chop.isChopper(s));
    if (!found) return halt();
    if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
    rec.hotbarIndex = found.index;
    const c = rec.creature || world._ensureSettlerCreature(rec);
    if (c) c.hotbarIndex = rec.hotbarIndex;
    if (c?.isAttacking?.()) return halt();
    const def = world._thingDef(tree.id);
    const hs = Number(def?.hitboxSize) || 5;
    const body = c?.bodyCenter?.() || { x: rec.x, y: rec.y };
    const ang = Math.atan2(tree.y - body.y, tree.x - body.x);
    const hits = Chop.aimHitsTrunk
        ? Chop.aimHitsTrunk(body.x, body.y, ang, tree.x, tree.y, hs)
        : false;
    if (!hits && !near(rec.x, rec.y, tree.x, tree.y)) {
        return walkTo(tree.x, tree.y);
    }
    if (c?.startMeleeAttack) {
        c.inventory = rec.inventory;
        c.hotbarIndex = rec.hotbarIndex;
        c.startMeleeAttack(ang);
    }
    return halt();
}

function doDoctor(world, rec, settle, patient) {
    if (!patient) return halt();
    const found = findStack(world, rec, settle, (s) => !!getItem(s.id)?.bandage);
    if (!found) return halt();
    if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
    rec.hotbarIndex = found.index;
    const walked = goOrWalk(rec, patient);
    if (walked) return walked;
    const owner = world.players.get(rec.ownerId) || rec;
    const patientC = world._creatureForPawn?.(owner, patient)
        || patient.creature
        || world.creatures.get(patient.id);
    const anatomy = patientC?.anatomy;
    if (!anatomy) return halt();
    const stack = rec.inventory[found.index];
    const meta = stack ? getItem(stack.id) : null;
    if (!meta?.bandage) return halt();
    const budget = Number(meta.bandage.batchSeverity);
    let targets = BodyHealing.pickTendTargets?.(anatomy, { batchSeverity: budget }) || [];
    if (!targets.length) {
        const one = BodyHealing.pickTendTarget?.(anatomy);
        if (one) targets = [one];
    }
    if (!targets.length) return halt();
    const seconds = Number(meta.bandage.channelSeconds) || 5;
    const max = seconds * 1000 * manipScale(world, rec);
    rec._workChannel = {
        kind: "tend",
        remaining: max,
        max,
        slot: found.index,
        patientId: patient.id,
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
    return halt();
}

function doEat(world, rec, settle) {
    if (rec.eatChannel) return halt();
    if ((Number(rec.kc) || 0) >= AUTO_EAT) return null;
    const isFood = (s) => Number(world._foodForEat(s)?.kc) > 0;
    const found = findStack(world, rec, settle, isFood);
    if (!found) return null;
    if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
    rec.hotbarIndex = found.index;
    const stack = rec.inventory[found.index];
    const food = world._foodForEat(stack);
    const isMeal = world._isPartialFood(stack);
    const room = (Number(rec.stomach) || 0) - (Number(rec.kc) || 0);
    if (isMeal && !(room > 0)) return null;
    const seconds = world._eatSecondsFor(food, isMeal);
    const max = seconds * 1000 * world._eatingDurationScale(rec);
    rec.eatChannel = {
        remaining: max,
        max,
        slot: found.index,
        bag: "hotbar",
        fromId: rec.id,
        itemId: stack.id,
        itemIndex: found.index,
        isMeal
    };
    return halt();
}

function tick(world, mob, delta) {
    const rec = findRec(world, mob);
    if (!rec || rec.dead) return null;
    const settle = findSettle(world, rec);
    if (!settle) return null;

    rec._wadeWater = !!rec._wadeWater;
    if (mob) mob._wadeWater = !!rec._wadeWater;

    if (rec._workChannel) return halt();
    if (rec.eatChannel) return halt();
    const eat = doEat(world, rec, settle);
    if (eat) return eat;

    const claims = claimsFor(world, settle);
    const alive = new Set(settlersOf(world, settle).map((s) => s.id));
    claims?.prune(alive);

    rec._settlerScanMs = (rec._settlerScanMs || 0) + (Number(delta) || 16);
    if (!rec._settlerScan || rec._settlerScanMs >= SCAN_MS) {
        rec._settlerScanMs = 0;
        rec._settlerScan = scanWork(world, rec, settle, claims);
    }
    const scan = rec._settlerScan || {};
    const stash = scan.stash || { basket: null, has: false, urgent: false };
    const planOpts = () => ({
        kc: rec.kc,
        autoEatBelow: AUTO_EAT,
        canEat: false,
        isNight: scan.night,
        injured: scan.injured,
        isOrphan: false,
        bed: scan.bed || null,
        jobs: scan.jobs,
        patients: scan.patients || [],
        unlitFire: scan.unlitFire,
        light: scan.light,
        cookBill: scan.cookBill,
        leatherWork: scan.leatherWork,
        haulDrop: scan.haulDrop,
        haulMerge: scan.haulMerge,
        gatherThing: scan.gatherThing,
        chopTree: scan.chopTree,
        stashBasket: stash.basket,
        hasStash: stash.has,
        stashUrgent: stash.urgent
    });

    const keepBandage = !!scan.keepBandage;
    const delivering = !!(rec._haulDestUid && stash.has);
    if (rec._haulDestUid && !delivering) rec._haulDestUid = null;

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

    if (plan.type === "sleep" && plan.target) return doSleep(world, rec, plan.target);
    if (plan.type === "doctor" && plan.target) return doDoctor(world, rec, settle, plan.target);

    if (rec._haulDestUid && stash.has) {
        const dest = basketsOf(world, settle).find((b) => b.uid === rec._haulDestUid) || stash.basket;
        if (rec._haulMergeOnly) {
            const walked = goOrWalk(rec, dest);
            if (walked) return walked;
            depositKeepGear(world, rec, settle, keepBandage);
            rec._haulMergeOnly = false;
            rec._haulDestUid = null;
            return halt();
        }
        return doStash(world, rec, settle, dest, keepBandage);
    }

    if (plan.type === "stash" && plan.target) {
        return doStash(world, rec, settle, plan.target, keepBandage);
    }
    if (plan.type === "gather" && plan.target) return doGather(world, rec, plan.target);
    if (plan.type === "chop" && plan.target) return doChop(world, rec, settle, plan.target);
    if (plan.type === "haul" && plan.target) {
        if (plan.target.kind === "pack" || plan.target.kind === "move") {
            return doMerge(world, rec, settle, plan.target);
        }
        return doHaul(world, rec, settle, plan.target);
    }
    if (plan.type === "cook_light" && plan.target) {
        return doLightFire(world, rec, settle, plan.target);
    }
    if (plan.type === "cook" && plan.target) return doCook(world, rec, settle, plan.target);
    if (plan.type === "leather" && plan.target) return doLeather(world, rec, settle, plan.target);

    return null;
}

module.exports = { tick, releaseWork, tickChannel, publicChannel };
