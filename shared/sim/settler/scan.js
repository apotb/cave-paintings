/**
 * Settler work functions (scan).
 * Installed into the settlerWork closure. Function bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SettlerWorkParts = root.SettlerWorkParts || {};
        root.SettlerWorkParts.scan = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    const Settlement = ctx.Settlement;
    const Chop = ctx.Chop;
    const Dig = ctx.Dig;
    const Research = ctx.Research;
    const Place = ctx.Place;
    const Sleep = ctx.Sleep;
    const BodyHealing = ctx.BodyHealing;
    const Fire = ctx.Fire;
    const FuelFilter = ctx.FuelFilter;
    const Hide = ctx.Hide;
    const Carry = ctx.Carry;
    const StorageFilter = ctx.StorageFilter;
    const TS = ctx.TS;
    const dropsOf = (...args) => ctx.dropsOf(...args);
    const leaveHaulDrop = (...args) => ctx.leaveHaulDrop(...args);
    const dropAsStack = (...args) => ctx.dropAsStack(...args);
    const canCarry = (...args) => ctx.canCarry(...args);
    const haulDropQty = (...args) => ctx.haulDropQty(...args);
    const pickBasket = (...args) => ctx.pickBasket(...args);
    const dropKey = (...args) => ctx.dropKey(...args);
    const claimedByOther = (...args) => ctx.claimedByOther(...args);
    const isSkipped = (...args) => ctx.isSkipped(...args);
    const lootablesOf = (...args) => ctx.lootablesOf(...args);
    const countItem = (...args) => ctx.countItem(...args);
    const countBillHave = (...args) => ctx.countBillHave(...args);
    const thingKey = (...args) => ctx.thingKey(...args);
    const findStack = (...args) => ctx.findStack(...args);
    const findBestChopStack = (...args) => ctx.findBestChopStack(...args);
    const choppablesOf = (...args) => ctx.choppablesOf(...args);
    const researchHolder = (...args) => ctx.researchHolder(...args);
    const getItem = (...args) => ctx.getItem(...args);
    const diggablesOf = (...args) => ctx.diggablesOf(...args);
    const settleChunks = (...args) => ctx.settleChunks(...args);
    const inRange = (...args) => ctx.inRange(...args);
    const bedKey = (...args) => ctx.bedKey(...args);
    const skipJob = (...args) => ctx.skipJob(...args);
    const pawnWorkKey = (...args) => ctx.pawnWorkKey(...args);
    const findSettle = (...args) => ctx.findSettle(...args);
    const reservesOf = (...args) => ctx.reservesOf(...args);
    const claimsFor = (...args) => ctx.claimsFor(...args);
    const endWorkHold = (...args) => ctx.endWorkHold(...args);
    const setSettlerAct = (...args) => ctx.setSettlerAct(...args);
    const listMedicineSources = (...args) => ctx.listMedicineSources(...args);
    const sourceAvail = (...args) => ctx.sourceAvail(...args);
    const settlersOf = (...args) => ctx.settlersOf(...args);
    const stationsOf = (...args) => ctx.stationsOf(...args);
    const stationKey = (...args) => ctx.stationKey(...args);
    const basketsOf = (...args) => ctx.basketsOf(...args);
    const settleQ = (...args) => ctx.settleQ(...args);
    const emitEntry = (...args) => ctx.emitEntry(...args);
    const takeOffFire = (...args) => ctx.takeOffFire(...args);
    const workJobOn = (...args) => ctx.workJobOn(...args);
    const benchHasWork = (...args) => ctx.benchHasWork(...args);
    const rockBillReady = (...args) => ctx.rockBillReady(...args);
    const leatherJobKey = (...args) => ctx.leatherJobKey(...args);
    const jobOn = (...args) => ctx.jobOn(...args);
    const researchCircle = (...args) => ctx.researchCircle(...args);
    const pigmentPred = (...args) => ctx.pigmentPred(...args);
    const keepGearOpts = (...args) => ctx.keepGearOpts(...args);
    const stashScan = (...args) => ctx.stashScan(...args);
    const canGivePawn = (...args) => ctx.canGivePawn(...args);
    const simmerWillFill = (...args) => ctx.simmerWillFill(...args);


function haulMergeJob(world, rec, settle, claims) {
    const q = settleQ(world, settle);
    if (!q.mergeJobs) {
        q.mergeJobs = StorageFilter.listMergeJobs(basketsOf(world, settle), getItem);
    }
    const reserves = reservesOf(world, settle);
    return StorageFilter.pickMergeJob(q.mergeJobs, rec.x, rec.y, {
        isClaimed: (key) => {
            if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) return true;
            const move = /^merge:(.+):(\d+)$/.exec(String(key || ""));
            if (!move) return false;
            const basket = basketsOf(world, settle).find((b) => String(b.uid) === move[1]);
            const index = Number(move[2]);
            const stack = basket?.slots?.[index];
            if (!stack) return false;
            return !(reserves.available(`basket:${basket.uid}:${index}`, stack.quantity, rec.id) > 0);
        }
    });
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
    if (!findBestChopStack(world, rec, settle)) return null;
    const have = countItem(world, settle, "log");
    const want = Settlement.stockTarget(settle, "log");
    if (!Settlement.gatherShouldWork(have, want)) return null;
    const list = choppablesOf(world, settle);
    const mine = claims?.held(rec.id);
    if (mine && mine.startsWith("thing:")) {
        const held = list.find((t) => thingKey(t.entry) === mine);
        if (held && !isSkipped(rec, mine)) return held.entry;
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

function depositWantsDig(world, settle, def) {
    const item = def?.diggable?.item;
    if (!item) return false;
    return Settlement.gatherShouldWork(
        countItem(world, settle, item),
        Settlement.stockTarget(settle, item)
    );
}

function digThing(world, rec, settle, claims) {
    if (!Dig || !Research?.hasTech?.(researchHolder(world, rec, settle), "digging")) return null;
    if (!findStack(world, rec, settle, (s) => Dig.isDigger(s, getItem))) return null;
    const list = diggablesOf(world, settle);
    let best = null;
    let bestD = Infinity;
    for (const t of list) {
        if (!depositWantsDig(world, settle, t.def)) continue;
        const key = thingKey(t.entry);
        if (isSkipped(rec, key)) continue;
        const d = Math.hypot(rec.x - t.entry.x, rec.y - t.entry.y);
        if (d < bestD) {
            bestD = d;
            best = t.entry;
        }
    }
    return best;
}

function fishMod() {
    if (typeof Fish !== "undefined" && Fish.measure) return Fish;
    try { return ctx.require?.("../fish"); } catch (_) { return null; }
    return null;
}

function worldGenMod() {
    if (typeof WorldGen !== "undefined" && WorldGen.tileKeyAt) return WorldGen;
    try { return ctx.require?.("./WorldGen"); } catch (_) { return null; }
    return null;
}

/** Another settler is already standing here to fish. */
function fishStandHeld(world, stx, sty, pawnId) {
    const tx = stx | 0;
    const ty = sty | 0;
    for (const s of world?.settlers || []) {
        if (!s || s.dead || s.id === pawnId) continue;
        const t = s._busyJob?.type === "fish" ? s._busyJob.target : null;
        if (!t) continue;
        if ((t.standTx | 0) === tx && (t.standTy | 0) === ty) return true;
    }
    return false;
}

function fishSpot(world, rec, settle, claims) {
    const Fish = fishMod();
    const WorldGen = worldGenMod();
    if (!Fish || !WorldGen?.tileKeyAt || !world?._fishMeasure) return null;
    if (!Research?.hasTech?.(researchHolder(world, rec, settle), "fishing")) return null;
    if (!Settlement.gatherShouldWork(
        countItem(world, settle, Fish.FISH_ID),
        Settlement.stockTarget(settle, Fish.FISH_ID)
    )) return null;
    if (!findStack(world, rec, settle, (s) => s.id === Fish.ROD_ID)) return null;
    if (!findStack(world, rec, settle, (s) => s.id === Fish.GRUB_ID)) return null;
    const ts = TS || 16;
    const r = Number(settle.radiusTiles) > 0 ? Number(settle.radiusTiles) : (Settlement.RADIUS_TILES || 32);
    const minTx = Math.floor((Number(settle.x) - r * ts) / ts);
    const maxTx = Math.ceil((Number(settle.x) + r * ts) / ts);
    const minTy = Math.floor((Number(settle.y) - r * ts) / ts);
    const maxTy = Math.ceil((Number(settle.y) + r * ts) / ts);
    const waters = [];
    for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
            const wx = (tx + 0.5) * ts;
            const wy = (ty + 0.5) * ts;
            if (!inRange(settle, wx, wy, ts)) continue;
            if (WorldGen.tileKeyAt(tx, ty) !== "water") continue;
            waters.push({ tx, ty, d: Math.hypot(wx - rec.x, wy - rec.y) });
        }
    }
    waters.sort((a, b) => a.d - b.d);
    const fisheries = world.fisheries;
    for (const w of waters) {
        const measured = world._fishMeasure(w.tx, w.ty);
        if (!Fish.fishable(measured, fisheries)) continue;
        if (world._bobberOn?.(w.tx, w.ty, rec.id)) continue;
        if (claimedByOther(claims, `fish:water:${w.tx},${w.ty}`, rec.id)) continue;
        let stand = null;
        let standD = Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const stx = w.tx + dx;
            const sty = w.ty + dy;
            const ground = WorldGen.tileKeyAt(stx, sty);
            if (ground === "water" || ground === "ice") continue;
            const sx = (stx + 0.5) * ts;
            const sy = (sty + 0.5) * ts;
            if (!inRange(settle, sx, sy, ts)) continue;
            if (fishStandHeld(world, stx, sty, rec.id)) continue;
            const d = Math.hypot(sx - rec.x, sy - rec.y);
            if (d < standD) {
                standD = d;
                stand = {
                    uid: `water:${w.tx},${w.ty}`,
                    x: sx,
                    y: sy,
                    standTx: stx,
                    standTy: sty,
                    waterTx: w.tx,
                    waterTy: w.ty
                };
            }
        }
        if (stand) return stand;
    }
    return null;
}

/**
 * Rod and one bait stack stay in hand while this camp still wants fish.
 * A rejoin drops the cast, and without this the haul job walks the rod
 * to a basket and the next cast picks it straight back up.
 */
function fishGearPreds(world, rec, settle) {
    const Fish = fishMod();
    if (!Fish?.ROD_ID) return null;
    const fishing = !!rec?.fishChannel;
    if (!fishing && !Settlement.gatherShouldWork(
        countItem(world, settle, Fish.FISH_ID),
        Settlement.stockTarget(settle, Fish.FISH_ID)
    )) return null;
    const rodId = Fish.ROD_ID;
    const grubId = Fish.GRUB_ID;
    return [
        (s) => s?.id === rodId,
        (s) => !!(grubId && s?.id === grubId)
    ];
}

function freeBed(world, rec, settle, claims, opts = {}) {
    const medical = !!opts.medical;
    const candidates = [];
    for (const c of settleChunks(world, settle)) {
        if (!Array.isArray(c.things)) continue;
        for (const e of c.things) {
            if (!world._isSleepEntry(e)) continue;
            if (!inRange(settle, e.x, e.y)) continue;
            const def = world._sleepDef(e);
            Place.ensureSleepEntry(e, def);
            const n = Sleep.slotCount(def, e);
            const heal = Sleep.healBonus ? Sleep.healBonus(def) : 8;
            for (let i = 0; i < n; i++) {
                if (world._sleepSlotClaimed(e, i, rec.id)) continue;
                const key = bedKey({ entry: e, slot: i });
                if (claimedByOther(claims, key, rec.id)) continue;
                candidates.push({ entry: e, slot: i, x: e.x, y: e.y, heal, def });
            }
        }
    }
    return Sleep.pickSleepSlot
        ? Sleep.pickSleepSlot(candidates, { x: rec.x, y: rec.y }, medical)
        : (candidates[0] || null);
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
    const settle = findSettle(world, rec);
    if (settle) {
        reservesOf(world, settle).release(rec.id);
        claimsFor(world, settle)?.release(rec.id);
    }
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

function pawnDowned(world, pawn) {
    if (!pawn || pawn.dead) return false;
    const c = pawnCreature(world, pawn);
    return !!(pawn.prone || pawn._downed || c?._prone || c?.isIncapacitated?.() || c?.isImmobile?.());
}

function pawnInBed(pawn) {
    return !!(pawn && (pawn._resting || pawn.resting));
}

/**
 * A medical bunk, otherwise any free bed. The possessed pawn is bandaged
 * where they stand unless they are already walking into one.
 * Party members only count a bunk inside camp range, which is as far as they walk.
 */
function patientWaitsForBed(world, settle, claims, patient) {
    if (!patient || patient.dead || pawnInBed(patient)) return false;
    if (patient._restWalk) return true;
    const owner = world.players?.get?.(patient.ownerId);
    const controlId = owner?.controlId || owner?.id;
    if (controlId && patient.id === controlId) return false;
    if (patient.homeSettlementId && settle) {
        return !!freeBed(world, patient, settle, claims, { medical: true });
    }
    const tiles = (Sleep && Sleep.CAMP_TILES) || 12;
    return !!world._rescueBedFor?.(patient, { medical: true, maxTiles: tiles });
}

function bleedMinutes(world, pawn) {
    const c = pawnCreature(world, pawn);
    const body = c?.anatomy;
    if (!body || !BodyHealing?.minutesToBleedOut) return null;
    const mins = BodyHealing.minutesToBleedOut(body);
    return mins == null ? null : mins;
}

function medicineFor(world, rec, settle, patient, claims) {
    const sources = listMedicineSources(world, rec, settle, patient, claims);
    return sources.some((s) => sourceAvail(world, rec, settle, s, rec.id) > 0);
}

/**
 * Bleeding patients (any walker or downed person in camp) and downed people
 * who are not bleeding. Bleeding is sorted by time left, then distance.
 */
function settlerCare(world, rec, settle, claims) {
    const rows = [];
    const consider = (p) => {
        if (!p || p === rec || p.id === rec.id || p.dead) return;
        if (!inRange(settle, p.x, p.y)) return;
        if (pawnInBed(p) && !bleedMinutes(world, p)) return;
        const key = pawnWorkKey(p, "rescue");
        const tendKey = pawnWorkKey(p, "tend");
        if (claimedByOther(claims, key, rec.id) || claimedByOther(claims, tendKey, rec.id)) return;
        if (isSkipped(rec, key) || isSkipped(rec, tendKey)) return;
        if (p._carriedBy && p._carriedBy !== rec.id) return;
        const downed = pawnDowned(world, p);
        const inBed = pawnInBed(p);
        const mins = bleedMinutes(world, p);
        if (!downed && mins == null) return;
        if (downed && inBed && mins == null) return;
        const waits = patientWaitsForBed(world, settle, claims, p);
        // Walkers with a bunk lie down first. Tend them once they are in it.
        if (!downed && waits) return;
        const canTend = medicineFor(world, rec, settle, p, claims);
        const hasBed = waits;
        rows.push({
            pawn: p,
            downed,
            inBed,
            mins,
            canTend,
            hasBed,
            dist: Math.hypot((rec.x || 0) - (p.x || 0), (rec.y || 0) - (p.y || 0))
        });
    };
    for (const s of settlersOf(world, settle)) consider(s);
    const owner = world.players.get(rec.ownerId);
    if (owner) {
        consider(owner);
        for (const m of owner.party || []) consider(m);
    }
    const blocksHunger = (r) => {
        if (r.mins == null) return false;
        if (r.downed && !r.inBed && r.hasBed) return true;
        if (r.canTend) return true;
        return false;
    };
    const critical = rows.filter(blocksHunger).sort((a, b) => {
        if (a.mins !== b.mins) return a.mins - b.mins;
        return a.dist - b.dist;
    });
    const rescues = rows
        .filter((r) => r.downed && !r.inBed && r.mins == null && r.hasBed)
        .sort((a, b) => a.dist - b.dist)
        .map((r) => r.pawn);
    return { critical, rescues };
}

function settlerPatients(world, rec, settle, claims) {
    const out = [];
    const consider = (p) => {
        if (!p || p === rec || p.id === rec.id || p.dead) return;
        if (!inRange(settle, p.x, p.y)) return;
        const key = pawnWorkKey(p, "tend");
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) return;
        if (!patientNeedsTend(world, p)) return;
        if (patientWaitsForBed(world, settle, claims, p)) return;
        const sources = listMedicineSources(world, rec, settle, p, claims);
        if (!sources.some((s) => sourceAvail(world, rec, settle, s, rec.id) > 0)) return;
        out.push(p);
    };
    for (const s of settlersOf(world, settle)) consider(s);
    const owner = world.players.get(rec.ownerId);
    if (owner) {
        consider(owner);
        for (const m of owner.party || []) consider(m);
    }
    return out;
}

function fireNeedsLight(fire) {
    if (!fire) return false;
    if (Fire.isBurning(fire)) return false;
    if (fire.id === "campfire" && ((Number(fire.burnRemaining) > 0) || (Number(fire.pitTemp) > 0))) {
        return false;
    }
    return true;
}

/** Fuel already in the pit, or a stack this fire's filter will accept. */
function fireCanFuel(world, rec, settle, fire) {
    if (!fire) return false;
    if (world._campfireHasFuel(fire)) return true;
    if (!FuelFilter?.findFuelTake) return false;
    return !!FuelFilter.findFuelTake(
        fire.fuelFilter,
        fuelSources(world, rec, settle),
        fire,
        getItem
    );
}

function unlitFire(world, rec, settle, claims) {
    if (Research?.techUnlocked && !Research.techUnlocked("fire", researchHolder(world, rec, settle))) return null;
    for (const f of stationsOf(world, settle, "campfire")) {
        if (!fireNeedsLight(f)) continue;
        if (!fireCanFuel(world, rec, settle, f)) continue;
        const key = stationKey(f);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        return f;
    }
    return null;
}

function fuelSources(world, rec, settle) {
    const sources = [{ slots: rec.inventory, at: rec }];
    const reserves = reservesOf(world, settle);
    for (const b of basketsOf(world, settle)) {
        const uid = b.uid;
        const slots = (b.slots || []).map((s, i) => {
            if (!s) return s;
            if (!uid) return s;
            const avail = reserves.available(`basket:${uid}:${i}`, s.quantity, rec.id);
            if (!(avail > 0)) return null;
            if (avail === (Number(s.quantity) || 1)) return s;
            return { ...s, quantity: avail };
        });
        sources.push({ slots, at: b, entry: b });
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
    let starterHeld = false;
    let storedStarter = null;
    const scan = (slots, held) => {
        for (const s of slots || []) {
            if (!Settlement.isFirestarter(s, getItem)) continue;
            hasFirestarter = true;
            if (held) starterHeld = true;
            else if (!storedStarter) storedStarter = s;
        }
    };
    scan(rec.inventory, true);
    scan(rec.overflow, true);
    for (const b of basketsOf(world, settle)) scan(b.slots, false);
    // A starter in a basket does no good when the hotbar cannot take it.
    // Cook would otherwise stand on "Lighting fire" and never ignite.
    let starterNeedsRoom = false;
    if (hasFirestarter && !starterHeld && storedStarter) {
        starterNeedsRoom = !canGivePawn(rec, { ...storedStarter, quantity: 1 });
    }
    let hasFuel = false;
    for (const f of stationsOf(world, settle, "campfire")) {
        if (fireCanFuel(world, rec, settle, f)) hasFuel = true;
    }
    return {
        hasFirestarter,
        hasFuel,
        hasGroundRecipe: false,
        starterNeedsRoom,
        knowsFire: !Research?.techUnlocked || Research.techUnlocked("fire", researchHolder(world, rec, settle))
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

/** Lit, fueled, or fuel this settler can load. A warm empty pit is not. */
function pitCanCook(world, rec, settle, fire) {
    if (Fire.isBurning(fire)) return true;
    if (Number(fire?.burnRemaining) > 0) return true;
    if (world._campfireHasFuel?.(fire)) return true;
    return fireCanFuel(world, rec, settle, fire);
}

function cookHasWork(world, rec, settle, fire, bill, opts = {}) {
    const method = bill.method || "stick_roast";
    const skipInputIds = opts.skipInputIds;
    if (method === "shell_simmer") {
        const cat = fire.catalyst;
        if (Settlement.cookOutputReady(getItem, cat, bill)) return true;
        const hasTool = Settlement.isCookTool(getItem, cat, method)
            || !!findStack(world, rec, settle, (s) => Settlement.isCookTool(getItem, s, method));
        // One ingredient never becomes a meal. Start only when the pot plus
        // what they can haul will fill at least two slots.
        const minSlots = Settlement.SIMMER_MIN_SLOTS || 2;
        if (!(hasTool && simmerWillFill(world, rec, settle, fire, bill) >= minSlots)) return false;
        if (fireNeedsLight(fire) && !fireCanFuel(world, rec, settle, fire)) return false;
        return true;
    }
    if (fire.cook && Settlement.cookFitsBill(getItem, fire.cook, bill)) {
        if (Settlement.cookOutputReady(getItem, fire.cook, bill)) return true;
        return pitCanCook(world, rec, settle, fire);
    }
    const hasTool = Settlement.isCookTool(getItem, fire.catalyst, method)
        || !!findCookTool(world, rec, settle, method);
    const hasFood = !!findCookFood(world, rec, settle, bill, skipInputIds);
    if (hasTool && hasFood) return pitCanCook(world, rec, settle, fire);
    if (opts.ignoreLeftover || (skipInputIds && skipInputIds.size)) return false;
    return shouldTakeLeftoverStick(world, rec, settle, fire, bill);
}

/** Brained hide or finished leather on the cook slot. Roast and simmer leave it. */
function smokeOccupiesFire(fire) {
    const cook = fire?.cook;
    if (!cook?.id) return false;
    const bill = leftoverSmokeBill();
    return Settlement.cookInputReady(getItem, cook, bill)
        || Settlement.cookOutputReady(getItem, cook, bill);
}

/** Burning, fuel in the slots, or burn time left. A cold empty pit is not. */
function smokePitLive(world, fire) {
    if (!fire) return false;
    if (Fire.isBurning(fire)) return true;
    if (Number(fire.burnRemaining) > 0) return true;
    if (world._campfireHasFuel?.(fire)) return true;
    return false;
}

function smokePitOut(world, fire) {
    return !smokePitLive(world, fire);
}

/** Fuel they can load, and a starter when the pit actually needs lighting. */
function smokeCanTend(world, rec, settle, fire) {
    if (!smokePitOut(world, fire)) return false;
    if (!fireCanFuel(world, rec, settle, fire)) return false;
    if (fireNeedsLight(fire)) {
        return !!findStack(world, rec, settle, (s) => Settlement.isFirestarter(s, getItem));
    }
    return true;
}

function pickCookJob(world, rec, settle, f) {
    if (!f) return null;
    if (smokeOccupiesFire(f)) return null;
    const haveMemo = Object.create(null);
    const have = (id) => {
        const k = String(id || "");
        if (haveMemo[k] == null) haveMemo[k] = countBillHave(world, settle, k);
        return haveMemo[k];
    };
    const canLeather = workJobOn(settle, rec, "leather");
    const bills = Settlement.billsOf(settle, f.uid);
    for (let i = 0; i < bills.length; i++) {
        const bill = bills[i];
        if (bill.kind === "make") continue;
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
    let bill = null;
    for (const b of bills) {
        if (b?.kind === "make") continue;
        if (!Settlement.billIsActive(b, have, settle)) continue;
        bill = b;
        break;
    }
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
        if (haveMemo[k] == null) haveMemo[k] = countBillHave(world, settle, k);
        return haveMemo[k];
    };
    const active = [];
    for (const bill of Settlement.billsOf(settle, f.uid)) {
        if (bill?.kind === "make") continue;
        if (!Settlement.billIsActive(bill, have, settle)) continue;
        active.push(bill);
    }
    for (const bill of active) {
        if (bill.method !== "smoke_hide") continue;
        if (f.cook && Settlement.cookOutputReady(getItem, f.cook, bill)) {
            return smokeJob(f, bill, { pri: 0, phase: "take" });
        }
    }
    for (const bill of active) {
        if (bill.method !== "smoke_hide") continue;
        if (!(f.cook && Settlement.cookInputReady(getItem, f.cook, bill))) continue;
        // The hide smokes on its own. Come back only when the pit is out.
        if (smokeCanTend(world, rec, settle, f)) {
            return smokeJob(f, bill, { pri: 1, phase: "tend" });
        }
        return null;
    }
    for (const bill of active) {
        const method = bill.method || "stick_roast";
        if (method === "smoke_hide") {
            if (cookHasWork(world, rec, settle, f, bill)) return smokeJob(f, bill, { phase: "load" });
            continue;
        }
        if (smokeOccupiesFire(f)) continue;
        if (method === "stick_roast" || method === "shell_simmer") {
            if (cookHasWork(world, rec, settle, f, bill, { ignoreLeftover: true })) return null;
        }
    }
    return null;
}

/** Finished leather on an active smoke bill. Haulers take it; a smoking hide stays. */
function haulSmokeLeather(world, rec, settle, claims) {
    const haveMemo = Object.create(null);
    const have = (id) => {
        const k = String(id || "");
        if (haveMemo[k] == null) haveMemo[k] = countBillHave(world, settle, k);
        return haveMemo[k];
    };
    let best = null;
    let bestD = Infinity;
    for (const f of stationsOf(world, settle, "campfire")) {
        const key = stationKey(f);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        const cook = f.cook;
        if (!cook?.id) continue;
        let bill = null;
        for (const b of Settlement.billsOf(settle, f.uid)) {
            if (b?.method !== "smoke_hide") continue;
            if (!Settlement.billIsActive(b, have, settle)) continue;
            if (!Settlement.cookOutputReady(getItem, cook, b)) continue;
            bill = b;
            break;
        }
        if (!bill) continue;
        if (!canCarry(rec, cook, 1)) continue;
        if (!pickBasket(world, rec, settle, cook)) continue;
        const d = Math.hypot(rec.x - f.x, rec.y - f.y);
        if (d < bestD) {
            bestD = d;
            best = {
                kind: "smoke_out",
                id: cook.id,
                quantity: cook.quantity || 1,
                x: f.x,
                y: f.y,
                uid: f.uid,
                fire: f,
                bill,
                claimKey: key
            };
        }
    }
    return best;
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
    const have = (id) => countBillHave(world, settle, id);
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

function rockWork(world, rec, settle, claims) {
    const have = (id) => countBillHave(world, settle, id);
    const jobs = [];
    for (const rock of stationsOf(world, settle, "rock")) {
        for (const bill of Settlement.billsOf(settle, rock.uid)) {
            if (!Settlement.billIsActive(bill, have, settle)) continue;
            if (!rockBillReady(world, rec, settle, bill)) continue;
            jobs.push({
                kind: bill.kind === "knap" ? "knap" : "make",
                station: rock,
                bill,
                entry: rock
            });
            break;
        }
    }
    for (const fire of stationsOf(world, settle, "campfire")) {
        if (fire.id !== "campfire") continue;
        for (const bill of Settlement.billsOf(settle, fire.uid)) {
            if (bill?.kind !== "make") continue;
            if (!Settlement.billIsActive(bill, have, settle)) continue;
            if (!rockBillReady(world, rec, settle, bill)) continue;
            jobs.push({
                kind: "make",
                station: fire,
                bill,
                entry: fire
            });
            break;
        }
    }
    if (!jobs.length) return null;
    const mine = claims?.held(rec.id);
    if (mine) {
        const held = jobs.find((j) => stationKey(j.station) === mine);
        if (held && !isSkipped(rec, mine)) return held;
    }
    let best = null;
    let bestD = Infinity;
    for (const job of jobs) {
        const key = stationKey(job.station);
        if (claimedByOther(claims, key, rec.id) || isSkipped(rec, key)) continue;
        const d = Math.hypot(rec.x - job.station.x, rec.y - job.station.y);
        if (d < bestD) {
            bestD = d;
            best = job;
        }
    }
    return best;
}

/** Inputs and tools a live cook or craft bill will spend. Surplus stays unneeded. */
function jobCargoPreds(world, cookJob, rockJob) {
    const preds = [];
    const bill = cookJob?.bill;
    if (bill) {
        preds.push((s) => Settlement.cookInputReady(getItem, s, bill));
        const method = bill.method || "stick_roast";
        preds.push((s) => Settlement.isCookTool(getItem, s, method));
    }
    const rb = rockJob?.bill;
    if (!rb) return preds;
    if (rb.kind === "knap" || rb.toolClass) {
        preds.push((s) => Settlement.blankMatchesBill(rb, s));
    }
    const recipe = rb.recipeId && typeof world?._parseRecipe === "function"
        ? world._parseRecipe(rb.recipeId)
        : null;
    for (const ing of recipe?.ingredients || []) {
        if (!ing) continue;
        if (ing.hideStage) {
            const stage = ing.hideStage;
            preds.push((s) => Settlement.hideStageOf(getItem(s?.id), s?.id) === stage);
        } else if (ing.id && ing.id !== "ANY_HIDE" && ing.id !== "ANY_LEATHER") {
            const id = ing.id;
            preds.push((s) => s?.id === id);
        }
    }
    const toolClass = recipe?.requireTool?.toolClass;
    if (toolClass) {
        preds.push((s) => !!(s?.id) && Carry.stackToolClass(s, getItem(s.id)) === toolClass);
    }
    return preds;
}

function scanWork(world, rec, settle, claims) {
    const jobs = Settlement.jobsFor(settle, rec.id);
    const enabled = new Set(Settlement.enabledJobs(jobs));
    const doctorOn = jobOn(enabled, "doctor");
    const patients = doctorOn ? settlerPatients(world, rec, settle, claims) : [];
    const care = doctorOn ? settlerCare(world, rec, settle, claims) : { critical: [], rescues: [] };
    const keepBandage = false;
    const circle = jobOn(enabled, "research") ? researchCircle(world, rec, settle, claims) : null;
    const keepPigment = !!(circle && Research?.needsPigment?.(circle));
    const keepTally = !!(circle && Research?.needsTallyInstall?.(settle, circle));
    const pigmentPredFn = keepPigment ? pigmentPred(circle) : null;
    const isPigment = (keepPigment || keepTally)
        ? (s) => (keepTally && s?.id === (Research.TALLY_ITEM_ID || "tally_stick"))
            || !!(pigmentPredFn && pigmentPredFn(s))
        : null;
    const keepFish = jobOn(enabled, "fish") || !!rec.fishChannel;
    const keepPreds = [];
    if (keepFish) {
        const fishPreds = fishGearPreds(world, rec, settle);
        if (Array.isArray(fishPreds)) keepPreds.push(...fishPreds);
    }
    const carryPreds = rec._carryRoom?.keepPreds;
    if (Array.isArray(carryPreds)) keepPreds.push(...carryPreds);
    const keepOpts = keepGearOpts({
        keepBandage,
        keepPigment: keepPigment || keepTally,
        isPigment,
        keepPreds
    });
    const assignment = Settlement.assignmentAt(
        Settlement.scheduleFor(settle, rec.id),
        world.gameMinutes
    );
    const night = assignment === "sleep";
    const c = rec.creature || world.creatures.get(rec.id);
    const injured = Sleep.injuredForAutofill ? Sleep.injuredForAutofill(c?.anatomy) : false;
    const downed = pawnDowned(world, rec);
    const stash = stashScan(world, rec, settle, keepOpts);
    const cookJob = jobOn(enabled, "cook") ? cookBill(world, rec, settle, claims) : null;
    const hideWork = jobOn(enabled, "leather") ? leatherWork(world, rec, settle, claims) : null;
    const rockJob = jobOn(enabled, "craft") ? rockWork(world, rec, settle, claims) : null;
    // Tailoring already keeps what the bill spends and walks the rest back.
    const jobKeepPreds = hideWork ? [] : jobCargoPreds(world, cookJob, rockJob);
    return {
        unlitFire: jobOn(enabled, "cook") ? unlitFire(world, rec, settle, claims) : null,
        light: jobOn(enabled, "cook") ? lightOpts(world, rec, settle) : {
            hasFirestarter: false, hasFuel: false, hasGroundRecipe: false
        },
        cookBill: cookJob,
        stokeFire: jobOn(enabled, "cook") ? stokeFire(world, rec, settle, claims) : null,
        leatherWork: hideWork,
        rockWork: rockJob,
        haulDrop: jobOn(enabled, "haul") ? haulDrop(world, rec, settle, claims) : null,
        haulOutput: jobOn(enabled, "haul") ? haulSmokeLeather(world, rec, settle, claims) : null,
        haulMerge: jobOn(enabled, "haul") ? haulMergeJob(world, rec, settle, claims) : null,
        gatherThing: jobOn(enabled, "gather") ? gatherThing(world, rec, settle, claims) : null,
        digThing: jobOn(enabled, "gather") ? digThing(world, rec, settle, claims) : null,
        chopTree: jobOn(enabled, "chop") ? chopTree(world, rec, settle, claims) : null,
        fishSpot: jobOn(enabled, "fish") ? fishSpot(world, rec, settle, claims) : null,
        researchCircle: circle,
        patients,
        critical: care.critical,
        rescues: care.rescues,
        keepBandage,
        keepPigment: keepPigment || keepTally,
        isPigment,
        keepPreds: keepPreds.length ? keepPreds : null,
        jobKeepPreds: jobKeepPreds.length ? jobKeepPreds : null,
        carryRoom: !!rec._carryRoom,
        bed: (night || injured) ? freeBed(world, rec, settle, claims, { medical: !!injured }) : null,
        stash,
        night,
        assignment,
        injured,
        downed,
        jobs
    };
}
    ctx.depositWantsDig = depositWantsDig;
    ctx.haulDrop = haulDrop;
    ctx.gatherThing = gatherThing;
    ctx.chopTree = chopTree;
    ctx.digThing = digThing;
    ctx.freeBed = freeBed;
    ctx.pawnCreature = pawnCreature;
    ctx.patientNeedsTend = patientNeedsTend;
    ctx.patientWaitsForBed = patientWaitsForBed;
    ctx.dropPatient = dropPatient;
    ctx.settlerPatients = settlerPatients;
    ctx.settlerCare = settlerCare;
    ctx.pawnDowned = pawnDowned;
    ctx.fireNeedsLight = fireNeedsLight;
    ctx.fireCanFuel = fireCanFuel;
    ctx.unlitFire = unlitFire;
    ctx.fuelSources = fuelSources;
    ctx.stokeFire = stokeFire;
    ctx.lightOpts = lightOpts;
    ctx.leftoverCookBill = leftoverCookBill;
    ctx.hasRoastInput = hasRoastInput;
    ctx.isRoastCookBill = isRoastCookBill;
    ctx.catalystReserved = catalystReserved;
    ctx.markCatalystReserved = markCatalystReserved;
    ctx.clearCatalystReserved = clearCatalystReserved;
    ctx.reserveRoastCatalyst = reserveRoastCatalyst;
    ctx.shouldTakeLeftoverStick = shouldTakeLeftoverStick;
    ctx.takeFireCatalyst = takeFireCatalyst;
    ctx.cookNeedsCleanup = cookNeedsCleanup;
    ctx.cookInputPred = cookInputPred;
    ctx.findSmokeHang = findSmokeHang;
    ctx.findCookTool = findCookTool;
    ctx.findCookFood = findCookFood;
    ctx.reservedSimmerInputIds = reservedSimmerInputIds;
    ctx.cookHasWork = cookHasWork;
    ctx.pickCookJob = pickCookJob;
    ctx.leftoverSmokeBill = leftoverSmokeBill;
    ctx.smokeJob = smokeJob;
    ctx.pickSmokeJob = pickSmokeJob;
    ctx.smokeOccupiesFire = smokeOccupiesFire;
    ctx.smokePitLive = smokePitLive;
    ctx.smokeCanTend = smokeCanTend;
    ctx.haulSmokeLeather = haulSmokeLeather;
    ctx.cookBill = cookBill;
    ctx.rackHang = rackHang;
    ctx.soakReadyDrop = soakReadyDrop;
    ctx.soakWater = soakWater;
    ctx.rackBillJob = rackBillJob;
    ctx.leatherWork = leatherWork;
    ctx.scanWork = scanWork;
});
