/**
 * Settler work functions (craft).
 * Installed into the settlerWork closure. Function bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SettlerWorkParts = root.SettlerWorkParts || {};
        root.SettlerWorkParts.craft = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    const Settlement = ctx.Settlement;
    const Fire = ctx.Fire;
    const Hide = ctx.Hide;
    const Place = ctx.Place;
    const Carry = ctx.Carry;
    const TS = ctx.TS;
    const SCAN_MS = ctx.SCAN_MS;
    const halt = (...args) => ctx.halt(...args);
    const getItem = (...args) => ctx.getItem(...args);
    const goOrWalk = (...args) => ctx.goOrWalk(...args);
    const approachStation = (...args) => ctx.approachStation(...args);
    const takeOffFire = (...args) => ctx.takeOffFire(...args);
    const emitEntry = (...args) => ctx.emitEntry(...args);
    const persistBills = (...args) => ctx.persistBills(...args);
    const finishPut = (...args) => ctx.finishPut(...args);
    const endWorkHold = (...args) => ctx.endWorkHold(...args);
    const beginWorkHold = (...args) => ctx.beginWorkHold(...args);
    const bumpWork = (...args) => ctx.bumpWork(...args);
    const strengthRoomQty = (...args) => ctx.strengthRoomQty(...args);
    const doLightFire = (...args) => ctx.doLightFire(...args);
    const stokeUntilKeep = (...args) => ctx.stokeUntilKeep(...args);
    const takeFireCatalyst = (...args) => ctx.takeFireCatalyst(...args);
    const findHeld = (...args) => ctx.findHeld(...args);
    const findStored = (...args) => ctx.findStored(...args);
    const fetchCookPiece = (...args) => ctx.fetchCookPiece(...args);
    const heldPredQty = (...args) => ctx.heldPredQty(...args);
    const fetchCookQty = (...args) => ctx.fetchCookQty(...args);
    const takeCookPiece = (...args) => ctx.takeCookPiece(...args);
    const faceFire = (...args) => ctx.faceFire(...args);
    const reserveRoastCatalyst = (...args) => ctx.reserveRoastCatalyst(...args);
    const hasRoastInput = (...args) => ctx.hasRoastInput(...args);
    const clearCatalystReserved = (...args) => ctx.clearCatalystReserved(...args);
    const shouldTakeLeftoverStick = (...args) => ctx.shouldTakeLeftoverStick(...args);
    const isRoastCookBill = (...args) => ctx.isRoastCookBill(...args);
    const markCatalystReserved = (...args) => ctx.markCatalystReserved(...args);
    const findCookTool = (...args) => ctx.findCookTool(...args);
    const findCookFood = (...args) => ctx.findCookFood(...args);
    const catalystReserved = (...args) => ctx.catalystReserved(...args);
    const goToDrop = (...args) => ctx.goToDrop(...args);
    const pickBasket = (...args) => ctx.pickBasket(...args);
    const dropAsStack = (...args) => ctx.dropAsStack(...args);
    const findStack = (...args) => ctx.findStack(...args);
    const findNearestStored = (...args) => ctx.findNearestStored(...args);
    const skipJob = (...args) => ctx.skipJob(...args);
    const stationKey = (...args) => ctx.stationKey(...args);
    const rackHang = (...args) => ctx.rackHang(...args);
    const faceRack = (...args) => ctx.faceRack(...args);
    const givePawn = (...args) => ctx.givePawn(...args);
    const fetchStack = (...args) => ctx.fetchStack(...args);
    const walkTo = (...args) => ctx.walkTo(...args);
    const takeOne = (...args) => ctx.takeOne(...args);
    const haltAtRack = (...args) => ctx.haltAtRack(...args);
    const equipHand = (...args) => ctx.equipHand(...args);
    const canGivePawn = (...args) => ctx.canGivePawn(...args);
    const freeHandSlot = (...args) => ctx.freeHandSlot(...args);
    const walkStuck = (...args) => ctx.walkStuck(...args);
    const near = (...args) => ctx.near(...args);
    const putInBasket = (...args) => ctx.putInBasket(...args);
    const knapQualityDurationScale = (...args) => ctx.knapQualityDurationScale(...args);
    const manipScale = (...args) => ctx.manipScale(...args);
    const countBillHave = (...args) => ctx.countBillHave(...args);
    const stopLeather = (...args) => ctx.stopLeather(...args);
    const fetchBenchMats = (...args) => ctx.fetchBenchMats(...args);
    const canReceiveCraft = (...args) => ctx.canReceiveCraft(...args);
    const knapMaterialDurationScale = (...args) => ctx.knapMaterialDurationScale(...args);
    const haltAtBench = (...args) => ctx.haltAtBench(...args);
    const pocketFail = (...args) => ctx.pocketFail(...args);
    const fetchOneOrRoom = (...args) => ctx.fetchOneOrRoom(...args);
    const acceptsOne = (...args) => ctx.acceptsOne(...args);
    const cookInputPred = (...args) => ctx.cookInputPred(...args);
    const smokePitLive = (...args) => ctx.smokePitLive(...args);
    const fireNeedsLight = (...args) => ctx.fireNeedsLight(...args);
    const simmerWillFill = (...args) => ctx.simmerWillFill(...args);


function pawnItemQty(rec, id) {
    let n = 0;
    const add = (slots) => {
        for (const s of slots || []) {
            if (s?.id === id) n += Math.max(1, Math.floor(Number(s.quantity) || 1));
        }
    };
    add(rec?.inventory);
    add(rec?.overflow);
    return n;
}

function refuseTake(world, rec, settle, fire) {
    return pocketFail(world, rec, settle, stationKey(fire), null);
}

/** Hide is on the rack. Top the fire up, light it if it is out, then leave. */
function leaveSmokingHide(world, rec, settle, fire) {
    if (!Fire.isBurning(fire)) {
        if (fireNeedsLight(fire)) {
            const step = doLightFire(world, rec, settle, fire);
            if (Fire.isBurning(fire)) {
                endWorkHold(rec);
                return halt();
            }
            return step;
        }
        const walked = approachStation(world, rec, fire);
        if (walked) return walked;
        stokeUntilKeep(world, rec, settle, fire);
        if (typeof world._campfireEnsureBurning === "function") world._campfireEnsureBurning(fire);
        emitEntry(world, fire);
        endWorkHold(rec);
        return halt();
    }
    stokeUntilKeep(world, rec, settle, fire);
    endWorkHold(rec);
    return halt();
}

function doCook(world, rec, settle, job) {
    const fire = job?.fire || job?.entry;
    const bill = job?.bill;
    if (!fire || !bill) return halt();
    const method = bill.method || "stick_roast";

    if (method === "shell_simmer") {
        const cat = fire.catalyst;
        if (cat && (bill.leftover || Settlement.cookOutputReady(getItem, cat, bill))) {
            const walked = approachStation(world, rec, fire);
            if (walked) return walked;
            fire.catalyst = null;
            if (!takeOffFire(world, rec, settle, cat)) {
                fire.catalyst = cat;
                return refuseTake(world, rec, settle, fire);
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
        // Don't light, fetch a shell, or load the pot until two ingredients
        // are already in it or on the way into it.
        const minSlots = Settlement.SIMMER_MIN_SLOTS || 2;
        if (simmerWillFill(world, rec, settle, fire, bill) < minSlots) {
            endWorkHold(rec);
            return halt();
        }
        if (fire.id !== "campfire" || !(Number(fire.burnRemaining) > 0)) {
            return doLightFire(world, rec, settle, fire);
        }
        stokeUntilKeep(world, rec, settle, fire);
        // The unit already burning has left the slot. Keep cooking through it.
        if (!world._campfireHasFuel(fire) && !(Number(fire.burnRemaining) > 0)) return halt();
        if (fire.cook) {
            const walked = approachStation(world, rec, fire);
            if (walked) return walked;
            const spit = fire.cook;
            fire.cook = null;
            if (!takeOffFire(world, rec, settle, spit)) {
                fire.cook = spit;
                return refuseTake(world, rec, settle, fire);
            }
            emitEntry(world, fire);
            return finishPut(world, rec, settle);
        }
        if (!Settlement.isCookTool(getItem, cat, method)) {
            if (cat) {
                const walked = goOrWalk(world, rec, fire);
                if (walked) return walked;
                if (!takeFireCatalyst(world, rec, settle, fire)) {
                    return refuseTake(world, rec, settle, fire);
                }
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
        const walked = approachStation(world, rec, fire);
        if (walked) return walked;
        fire.cook = null;
        if (!takeOffFire(world, rec, settle, cook)) {
            fire.cook = cook;
            return refuseTake(world, rec, settle, fire);
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
        const walked = approachStation(world, rec, fire);
        if (walked) return walked;
        fire.cook = null;
        if (!takeOffFire(world, rec, settle, cook)) {
            fire.cook = cook;
            return refuseTake(world, rec, settle, fire);
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
    // The unit already burning has left the slot. Keep cooking through it.
    // A dead pit with nothing to burn used to halt in place and keep the
    // smoke job, so they froze wherever they stood.
    if (!world._campfireHasFuel(fire) && !(Number(fire.burnRemaining) > 0)) {
        endWorkHold(rec);
        return halt();
    }
    const cat = fire.catalyst;
    if (!Settlement.isCookTool(getItem, cat, method)) {
        if (cook) {
            const walked = approachStation(world, rec, fire);
            if (walked) return walked;
            fire.cook = null;
            if (!takeOffFire(world, rec, settle, cook)) {
                fire.cook = cook;
                return refuseTake(world, rec, settle, fire);
            }
            emitEntry(world, fire);
            return finishPut(world, rec, settle);
        }
        if (cat) {
            const walked = goOrWalk(world, rec, fire);
            if (walked) return walked;
            if (!takeFireCatalyst(world, rec, settle, fire)) {
                return refuseTake(world, rec, settle, fire);
            }
        }
        const found = findCookTool(world, rec, settle, method);
        if (!found) {
            endWorkHold(rec);
            return halt();
        }
        if (found.at !== rec) {
            return fetchOneOrRoom(world, rec, settle, found, stationKey(fire), [
                (s) => Settlement.isCookTool(getItem, s, method)
            ]) || halt();
        }
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
            const keep = [cookInputPred(bill, job.skipInputIds)];
            if (isRoastCookBill(bill)) {
                keep.push((s) => Settlement.isCookTool(getItem, s, method));
            }
            // Hands full: stash something else, then come back. Taking the
            // piece anyway halted on the rack with the smoke job forever.
            if (acceptsOne(rec, found.slots?.[found.index])) {
                markCatalystReserved(fire);
                emitEntry(world, fire);
            }
            return fetchOneOrRoom(world, rec, settle, found, stationKey(fire), keep) || halt();
        }
        const walked = goOrWalk(world, rec, fire);
        if (walked) return walked;
        fire.cook = takeCookPiece(found);
        Fire.onCookChanged?.(fire, null);
        markCatalystReserved(fire);
        emitEntry(world, fire);
        world._dirtyPawnOwner(rec);
    }
    if (method === "smoke_hide"
        && fire.cook
        && Settlement.cookInputReady(getItem, fire.cook, bill)) {
        return leaveSmokingHide(world, rec, settle, fire);
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
        if (!drop?.id) return halt();
        const walked = goToDrop(world, rec, drop);
        if (walked) return walked;
        const stack = dropAsStack(drop);
        // The whole pile used to come along, then the basket walk was dropped
        // unless Haul was on. Take what still fits under strength and stash it.
        const qty = strengthRoomQty(rec, stack, stack?.quantity || 1);
        if (!(qty > 0)) {
            stopLeather(world, rec, job, true);
            return halt();
        }
        const had = pawnItemQty(rec, drop.id);
        world._tryPickup(rec, { dropId: drop.uid, quantity: qty });
        if (!(pawnItemQty(rec, drop.id) > had)) {
            stopLeather(world, rec, job, true);
            return halt();
        }
        const basket = pickBasket(world, rec, settle, stack);
        if (basket) {
            rec._haulDestUid = basket.uid;
            rec._haulMergeOnly = false;
            beginWorkHold(rec, { type: "stash", target: basket });
            bumpWork(world, rec);
        }
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
                return pocketFail(world, rec, settle, stationKey(rack), null);
            }
            emitEntry(world, rack);
            found = findStack(world, rec, settle, (s) => Settlement.hideAllowsStack(job.bill, s, getItem));
        }
        if (!found) return halt();
        const soaked = fetchOneOrRoom(world, rec, settle, found, stationKey(rack), [
            (s) => Settlement.hideAllowsStack(job.bill, s, getItem)
        ]);
        if (soaked) return soaked;
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
            return pocketFail(world, rec, settle, stationKey(rack), null);
        }
        Settlement.noteBillCrafted(job.bill);
        emitEntry(world, rack);
        persistBills(world, settle, rack.uid);
        const facing = faceRack(rec, rack);
        return finishPut(world, rec, settle, facing ? { facing } : null);
    }
    if (job.kind === "hang") {
        // Hide is already up. Holding this hang order past the search that
        // should switch to fleshing leaves them standing on the rack forever.
        if (rackHang(rack)) {
            endWorkHold(rec);
            rec._settlerScan = null;
            return halt();
        }
        const found = findStack(world, rec, settle, (s) => Settlement.hideAllowsStack(job.bill, s, getItem));
        if (!found) return halt();
        const hung = fetchOneOrRoom(world, rec, settle, found, stationKey(rack), [
            (s) => Settlement.hideAllowsStack(job.bill, s, getItem)
        ]);
        if (hung) return hung;
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
        const pred = need === "scraper"
            ? (s) => Carry.stackToolClass(s, getItem(s.id)) === "scraper"
            : (need === "brain" ? (s) => Hide.isBrainItem(getItem(s.id)) : null);
        if (pred) {
            const tool = findStack(world, rec, settle, pred);
            if (!tool) {
                stopLeather(world, rec, job, true);
                return halt();
            }
            if (tool.at !== rec) {
                const stack = tool.slots?.[tool.index];
                // One brain tans one hide. Hauling the whole stack left the
                // rest in their pockets and emptied the basket.
                const carry = need === "brain" && stack ? { ...stack, quantity: 1 } : stack;
                if (!canGivePawn(rec, carry) && !(freeHandSlot(rec) && canGivePawn(rec, carry))) {
                    return pocketFail(world, rec, settle, stationKey(rack), [pred]);
                }
                if (need === "brain") return fetchCookPiece(world, rec, settle, tool) || halt();
                return fetchStack(world, rec, settle, tool) || halt();
            }
            // A backpack index is not a hotbar slot. Selecting it starts a
            // scrape that the next tick throws out, and the rack stays claimed.
            if (!equipHand(rec, tool)) {
                stopLeather(world, rec, job, true);
                return halt();
            }
        }
        const walked = goOrWalk(world, rec, rack);
        if (walked) {
            if (walkStuck(world, rec)) {
                stopLeather(world, rec, job, true);
                return halt();
            }
            return walked;
        }
        if (!near(rec.x, rec.y, rack.x, rack.y)) {
            if (walkStuck(world, rec)) {
                stopLeather(world, rec, job, true);
                return halt();
            }
            return walkTo(rack.x, rack.y, { openRadius: 0 });
        }
        const hang = rackHang(rack);
        if (!hang) {
            endWorkHold(rec);
            rec._settlerScan = null;
            return halt();
        }
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
        const have = (id) => countBillHave(world, settle, id);
        if (!recipe || (job.bill && !Settlement.billIsActive(job.bill, have, settle))) {
            stopLeather(world, rec, job, false);
            return halt();
        }
        const fetched = fetchBenchMats(world, rec, settle, job.bill, recipe);
        if (fetched?.needsRoom) {
            return pocketFail(world, rec, settle, stationKey(bench), fetched.keepPreds);
        }
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
        const material = knapMaterialDurationScale(held?.stone || held?.knapMaterial);
        const max = seconds * 1000 * manipScale(world, rec) * quality * material;
        rec._workChannel = {
            kind: "craft",
            job: "leather",
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

const KNAP_SECONDS = 20;

function stoneMod() {
    if (typeof Stone !== "undefined" && Stone.toolDamage) return Stone;
    try {
        if (typeof require === "function") return require("../../stone");
    } catch (_) { /* optional */ }
    return null;
}

function stopRock(rec, job, skip) {
    if (skip && job?.station) skipJob(rec, stationKey(job.station));
    endWorkHold(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = SCAN_MS;
}

function invQty(rec, pred) {
    let n = 0;
    for (const s of rec.inventory || []) {
        if (s && pred(s)) n += Math.max(1, Number(s.quantity) || 1);
    }
    return n;
}

/** Hotbar plus backpack. Rock crafts spend both, same as a player craft. */
function carriedCraftQty(rec, id) {
    let n = invQty(rec, (s) => s.id === id);
    for (const s of rec.overflow || []) {
        if (s?.id === id) n += Math.max(1, Number(s.quantity) || 1);
    }
    return n;
}

function holdTool(rec, found, classes) {
    if (!equipHand(rec, found)) return false;
    const held = rec.inventory?.[rec.hotbarIndex];
    const cls = Carry.stackToolClass(held, held ? getItem(held.id) : null);
    return classes.includes(cls);
}

/** 40% crude, 30% rough, 20% break, 10% fine. Null is a shattered blank. */
function settlerKnapQuality(world) {
    const roll = typeof world.rng === "function" ? world.rng() : Math.random();
    if (roll < 0.4) return "crude";
    if (roll < 0.7) return "rough";
    if (roll < 0.9) return null;
    return "fine";
}

function settlerKnapStack(world, toolClass, blank) {
    const StoneApi = stoneMod();
    const quality = settlerKnapQuality(world);
    if (!quality) return null;
    const flint = blank?.id === "flint";
    const stack = {
        toolClass,
        knapQuality: quality,
        knapMaterial: flint ? "flint" : "pebble",
        sharpness: quality === "fine" ? 0.85 : quality === "rough" ? 0.55 : 0.3
    };
    if (!flint) stack.stone = StoneApi?.stoneOf?.(blank) || blank?.stone || "andesite";
    const named = { id: "stone_tool", ...stack };
    const name = StoneApi?.displayName?.(named);
    if (name) stack.customName = name;
    const dmg = StoneApi?.toolDamage?.(named);
    if (dmg != null) stack.knapDamage = dmg;
    if (toolClass === "knife") stack.tooltipExtra = "'Mr. Stabby'";
    else if (toolClass === "chopper") stack.tooltipExtra = "Slow but heavy";
    else if (toolClass === "awl") stack.tooltipExtra = "For sewing hides";
    return stack;
}

function finishSettlerKnap(world, rec, ch) {
    const inv = rec.inventory || [];
    let index = -1;
    for (let i = 0; i < inv.length; i++) {
        if (inv[i] && Settlement.blankMatchesBill(ch.bill, inv[i])) {
            index = i;
            break;
        }
    }
    if (index < 0) return;
    const blank = takeOne({ slots: inv, index });
    if (!blank) return;
    const tool = settlerKnapStack(world, ch.toolClass, blank);
    if (!tool) {
        world._dirtyPawnOwner?.(rec);
        return;
    }
    const left = world._give(rec, "stone_tool", 1, tool);
    if (left > 0) {
        world._pushDrop(rec.x, rec.y, { id: "stone_tool", quantity: left, ...tool });
    }
    world._dirtyPawnOwner?.(rec);
}

function canReceiveTool(world, rec, settle) {
    const stack = { id: "stone_tool", quantity: 1, toolClass: "knife" };
    if (ctx.hasCarryRoom(rec, stack) && ctx.canCarry(rec, stack, 1)) return true;
    if (pickBasket(world, rec, settle, stack)) return true;
    return (rec.inventory || []).some((s) => {
        if (!s || (s.id !== "pebble" && s.id !== "flint")) return false;
        return (Number(s.quantity) || 1) <= 1;
    });
}

function doRock(world, rec, settle, job) {
    const rock = job?.station;
    const bill = job?.bill;
    if (!rock || !bill) return halt();
    const have = (id) => countBillHave(world, settle, id);
    if (!Settlement.billIsActive(bill, have, settle)) {
        stopRock(rec, job, false);
        return halt();
    }
    const recipeDef = Settlement.billRecipeById(bill.recipeId) || bill;
    if (recipeDef.kind === "knap" || bill.kind === "knap") {
        const blank = findNearestStored(world, rec, settle, (s) => Settlement.blankMatchesBill(bill, s));
        if (!blank) {
            stopRock(rec, job, true);
            return halt();
        }
        if (blank.at !== rec) return fetchStack(world, rec, settle, blank) || halt();
        const walked = goOrWalk(world, rec, rock);
        if (walked) return walked;
        if (!canReceiveTool(world, rec, settle)) {
            stopRock(rec, job, true);
            return halt();
        }
        const max = KNAP_SECONDS * 1000 * manipScale(world, rec);
        rec._workChannel = {
            kind: "knap",
            job: "craft",
            remaining: max,
            max,
            slot: rec.hotbarIndex,
            uid: rock.uid,
            toolClass: bill.toolClass || recipeDef.toolClass,
            bill
        };
        Settlement.noteBillCrafted(bill);
        persistBills(world, settle, rock.uid);
        rec._settlerScan = null;
        rec._settlerScanMs = SCAN_MS;
        return haltAtBench(rec, rock);
    }
    const recipe = bill.recipeId ? world._parseRecipe(bill.recipeId) : null;
    if (!recipe) {
        stopRock(rec, job, true);
        return halt();
    }
    for (const ing of recipe.ingredients || []) {
        const need = Math.max(1, Math.floor(Number(ing.qty) || 1));
        const have = carriedCraftQty(rec, ing.id);
        if (have >= need) continue;
        // Pockets are already counted. Searching them here would hide a basket
        // behind a short backpack stack and cancel the bill.
        const found = findNearestStored(
            world, rec, settle, (s) => s.id === ing.id, { storageOnly: true }
        );
        if (!found) {
            stopRock(rec, job, true);
            return halt();
        }
        return fetchCookQty(world, rec, settle, found, need - have) || halt();
    }
    const classes = Carry.recipeToolClasses?.(recipe.requireTool) || [];
    if (classes.length) {
        const held = rec.inventory?.[rec.hotbarIndex];
        const heldCls = Carry.stackToolClass(held, held ? getItem(held.id) : null);
        if (!classes.includes(heldCls)) {
            const tool = findNearestStored(world, rec, settle, (s) => {
                return classes.includes(Carry.stackToolClass(s, getItem(s.id)));
            });
            if (!tool) {
                stopRock(rec, job, true);
                return halt();
            }
            if (tool.at !== rec) return fetchStack(world, rec, settle, tool) || halt();
            if (!holdTool(rec, tool, classes)) {
                stopRock(rec, job, true);
                return halt();
            }
        }
    }
    const walked = goOrWalk(world, rec, rock);
    if (walked) return walked;
    for (const ing of recipe.ingredients || []) {
        const need = Math.max(1, Math.floor(Number(ing.qty) || 1));
        if (carriedCraftQty(rec, ing.id) < need) {
            stopRock(rec, job, true);
            return halt();
        }
    }
    if (recipe.requireThing && !world._hasNearbyThing(rec, recipe.requireThing)) {
        stopRock(rec, job, true);
        return halt();
    }
    if (!canReceiveCraft(world, rec, settle, recipe, bill)) {
        stopRock(rec, job, true);
        return halt();
    }
    const seconds = Math.max(0.1, Number(recipe.craftSeconds) || 1);
    const max = seconds * 1000 * manipScale(world, rec);
    rec._workChannel = {
        kind: "rock",
        job: "craft",
        remaining: max,
        max,
        slot: rec.hotbarIndex,
        uid: rock.uid,
        recipeId: recipe.id,
        toolClasses: classes,
        bill
    };
    Settlement.noteBillCrafted(bill);
    persistBills(world, settle, rock.uid);
    rec._settlerScan = null;
    rec._settlerScanMs = SCAN_MS;
    return haltAtBench(rec, rock);
}
    ctx.doCook = doCook;
    ctx.doLeather = doLeather;
    ctx.doRock = doRock;
    ctx.finishSettlerKnap = finishSettlerKnap;
});
