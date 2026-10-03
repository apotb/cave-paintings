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
    const takeOffFire = (...args) => ctx.takeOffFire(...args);
    const emitEntry = (...args) => ctx.emitEntry(...args);
    const persistBills = (...args) => ctx.persistBills(...args);
    const finishPut = (...args) => ctx.finishPut(...args);
    const endWorkHold = (...args) => ctx.endWorkHold(...args);
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
    const rackHang = (...args) => ctx.rackHang(...args);
    const faceRack = (...args) => ctx.faceRack(...args);
    const givePawn = (...args) => ctx.givePawn(...args);
    const fetchStack = (...args) => ctx.fetchStack(...args);
    const walkTo = (...args) => ctx.walkTo(...args);
    const takeOne = (...args) => ctx.takeOne(...args);
    const haltAtRack = (...args) => ctx.haltAtRack(...args);
    const putInBasket = (...args) => ctx.putInBasket(...args);
    const knapQualityDurationScale = (...args) => ctx.knapQualityDurationScale(...args);
    const manipScale = (...args) => ctx.manipScale(...args);
    const countItem = (...args) => ctx.countItem(...args);
    const stopLeather = (...args) => ctx.stopLeather(...args);
    const fetchBenchMats = (...args) => ctx.fetchBenchMats(...args);
    const canReceiveCraft = (...args) => ctx.canReceiveCraft(...args);
    const knapMaterialDurationScale = (...args) => ctx.knapMaterialDurationScale(...args);
    const haltAtBench = (...args) => ctx.haltAtBench(...args);


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
        // The unit already burning has left the slot. Keep cooking through it.
        if (!world._campfireHasFuel(fire) && !(Number(fire.burnRemaining) > 0)) return halt();
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
    // The unit already burning has left the slot. Keep cooking through it.
    if (!world._campfireHasFuel(fire) && !(Number(fire.burnRemaining) > 0)) return halt();
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
    ctx.doCook = doCook;
    ctx.doLeather = doLeather;
});
