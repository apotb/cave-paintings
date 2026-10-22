/**
 * Settler work functions (act).
 * Installed into the settlerWork closure. Function bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SettlerWorkParts = root.SettlerWorkParts || {};
        root.SettlerWorkParts.act = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    const StorageFilter = ctx.StorageFilter;
    const Party = ctx.Party;
    const Place = ctx.Place;
    const Settlement = ctx.Settlement;
    const DataStore = ctx.DataStore;
    const Carry = ctx.Carry;
    const Hide = ctx.Hide;
    const FuelFilter = ctx.FuelFilter;
    const Fire = ctx.Fire;
    const Research = ctx.Research;
    const AUTO_EAT_UNTIL = ctx.AUTO_EAT_UNTIL;
    const SCAN_MS = ctx.SCAN_MS;
    const TS = ctx.TS;
    const hasCarryRoom = (...args) => ctx.hasCarryRoom(...args);
    const canCarry = (...args) => ctx.canCarry(...args);
    const halt = (...args) => ctx.halt(...args);
    const takeFound = (...args) => ctx.takeFound(...args);
    const givePawn = (...args) => ctx.givePawn(...args);
    const emitEntry = (...args) => ctx.emitEntry(...args);
    const stackIsSpecial = (...args) => ctx.stackIsSpecial(...args);
    const takeOne = (...args) => ctx.takeOne(...args);
    const takeToPawn = (...args) => ctx.takeToPawn(...args);
    const takeQty = (...args) => ctx.takeQty(...args);
    const getItem = (...args) => ctx.getItem(...args);
    const pickBasket = (...args) => ctx.pickBasket(...args);
    const stashScan = (...args) => ctx.stashScan(...args);
    const storageNear = (...args) => ctx.storageNear(...args);
    const insertInEntry = (...args) => ctx.insertInEntry(...args);
    const beginWorkHold = (...args) => ctx.beginWorkHold(...args);
    const bumpWork = (...args) => ctx.bumpWork(...args);
    const basketsOf = (...args) => ctx.basketsOf(...args);
    const endWorkHold = (...args) => ctx.endWorkHold(...args);
    const paintStandOf = (...args) => ctx.paintStandOf(...args);
    const facePaint = (...args) => ctx.facePaint(...args);
    const walkTo = (...args) => ctx.walkTo(...args);
    const faceToward = (...args) => ctx.faceToward(...args);
    const near = (...args) => ctx.near(...args);
    const keepGearOpts = (...args) => ctx.keepGearOpts(...args);
    const findStack = (...args) => ctx.findStack(...args);
    const equipHand = (...args) => ctx.equipHand(...args);
    const freeHandSlot = (...args) => ctx.freeHandSlot(...args);
    const canGivePawn = (...args) => ctx.canGivePawn(...args);
    const findNearestStored = (...args) => ctx.findNearestStored(...args);
    const rackHang = (...args) => ctx.rackHang(...args);
    const patientNeedsTend = (...args) => ctx.patientNeedsTend(...args);
    const findSettle = (...args) => ctx.findSettle(...args);
    const dropKey = (...args) => ctx.dropKey(...args);
    const goToDrop = (...args) => ctx.goToDrop(...args);
    const leaveHaulDrop = (...args) => ctx.leaveHaulDrop(...args);
    const skipJob = (...args) => ctx.skipJob(...args);
    const dropAsStack = (...args) => ctx.dropAsStack(...args);
    const haulDropQty = (...args) => ctx.haulDropQty(...args);
    const reservesOf = (...args) => ctx.reservesOf(...args);
    const foundAvail = (...args) => ctx.foundAvail(...args);
    const releaseFoodReserve = (...args) => ctx.releaseFoodReserve(...args);
    const haulDropLive = (...args) => ctx.haulDropLive(...args);
    const abandonHaul = (...args) => ctx.abandonHaul(...args);
    const depositKeepGear = (...args) => ctx.depositKeepGear(...args);
    const onMerge = (...args) => ctx.onMerge(...args);
    const fuelSources = (...args) => ctx.fuelSources(...args);
    const faceFire = (...args) => ctx.faceFire(...args);
    const researchHolder = (...args) => ctx.researchHolder(...args);
    const fireCanFuel = (...args) => ctx.fireCanFuel(...args);
    const stationKey = (...args) => ctx.stationKey(...args);


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
    if (!(foundAvail(world, rec, settle, found) > 0)) return halt();
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
    const avail = foundAvail(world, rec, settle, found);
    const cap = Math.min(Math.max(1, Math.floor(Number(want) || 1)), avail);
    if (!(cap > 0)) return halt();
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

function isPreparedStack(stack) {
    if (!stack?.id) return false;
    return !!StorageFilter.isPreparedFood?.(stack, getItem(stack.id));
}

function heldPrepared(rec) {
    const out = [];
    const scan = (slots) => {
        for (let i = 0; i < (slots || []).length; i++) {
            if (slots[i] && isPreparedStack(slots[i])) out.push({ slots, index: i });
        }
    };
    scan(rec?.inventory);
    scan(rec?.overflow);
    return out;
}

/** Put leftover meals and roasts back so the next job doesn't walk off with them. */
function returnPreparedFood(world, rec, settle) {
    const held = heldPrepared(rec);
    if (!held.length) {
        rec._returnFood = false;
        return null;
    }
    let target = null;
    for (const h of held) {
        target = pickBasket(world, rec, settle, h.slots[h.index]);
        if (target) break;
    }
    if (!target) {
        rec._returnFood = false;
        return null;
    }
    const walked = goOrWalk(world, rec, target);
    if (walked) return walked;
    for (const h of heldPrepared(rec)) {
        const stack = h.slots[h.index];
        if (!stack) continue;
        const b = pickBasket(world, rec, settle, stack);
        if (!b) continue;
        if (b !== target && !storageNear(rec, b)) continue;
        if (!insertInEntry(world, b, stack)) continue;
        h.slots[h.index] = null;
        emitEntry(world, b);
    }
    rec._returnFood = false;
    world._dirtyPawnOwner(rec);
    return null;
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
        return { eatBlocked: true };
    }
    const left = (Number(piece.quantity) || 1) - got;
    if (left > 0) restorePiece(found, { ...piece, quantity: left });
    releaseFoodReserve(world, rec, settle);
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
            // The scan that picked this up still names the station. Leave it
            // and the next tick plans "do that again" and drops the basket.
            bumpWork(world, rec);
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

/** One unit will fit in a pocket, a backpack slot, or onto a stack they already carry. */
function acceptsOne(rec, stack) {
    if (!stack?.id) return false;
    const one = { ...stack, quantity: 1 };
    if (!canCarry(rec, one, 1)) return false;
    if (canGivePawn(rec, one)) return true;
    return hasCarryRoom(rec, one);
}

/**
 * The take failed because their hands are full. Stash something else, then
 * try again. If nothing can be put away, drop the station instead of
 * standing on "Taking …" forever.
 */
function pocketFail(world, rec, settle, key, keepPreds) {
    endWorkHold(rec);
    const preds = Array.isArray(keepPreds) ? keepPreds.filter((p) => typeof p === "function") : [];
    const opts = keepGearOpts({ keepPreds: preds.length ? preds : null });
    const stash = stashScan(world, rec, settle, opts);
    if (stash.has && stash.basket) {
        rec._carryRoom = { keepPreds: preds };
        rec._settlerScan = null;
        rec._settlerScanMs = SCAN_MS;
        return halt();
    }
    rec._carryRoom = null;
    if (key) skipJob(rec, key);
    rec._settlerScan = null;
    rec._settlerScanMs = SCAN_MS;
    return halt();
}

/** One piece from storage. A full pile stays put when only one hide is needed. */
function fetchOneOrRoom(world, rec, settle, found, key, keepPreds) {
    if (!found || found.at === rec) return null;
    if (!acceptsOne(rec, found.slots?.[found.index])) {
        return pocketFail(world, rec, settle, key, keepPreds);
    }
    return fetchCookPiece(world, rec, settle, found) || halt();
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
    // Walk collision uses a pad. A point that is clear at pad 0 but inside
    // that pad gets replaced by a far "open" cell, and the settler jiggles
    // there instead of using the chest.
    const free = (aimX, aimY) => {
        const feetX = aimX + ((Number(rec.x) || 0) - body.x);
        const feetY = aimY + ((Number(rec.y) || 0) - body.y);
        if (typeof world?._partyPoseBlocked === "function" && c) {
            return !world._partyPoseBlocked(c, feetX, feetY, 2, { load: false });
        }
        return true;
    };
    if (free(preferX, preferY)) return pack(preferX, preferY);
    const tx = Number(target.x) || 0;
    const ty = Number(target.y) || 0;
    let best = null;
    let bestD = Infinity;
    for (const r of [dist, dist + 8]) {
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            const aimX = tx + Math.cos(a) * r;
            const aimY = ty + Math.sin(a) * r;
            if (!free(aimX, aimY)) continue;
            const d = Math.hypot(body.x - aimX, body.y - aimY);
            if (d < bestD) {
                bestD = d;
                best = { aimX, aimY };
            }
        }
        if (best) return pack(best.aimX, best.aimY);
    }
    return pack(preferX, preferY);
}

/**
 * The settler's 8×8 body is in the hut, clear of the walls.
 */
function bodyInsideHut(world, c, entry, def, x, y) {
    if (!c || !entry || !def || !Place?.footprintWorldRect) return false;
    const rect = Place.footprintWorldRect(entry, def, TS);
    const body = world?._creatureBodyAt?.(c, x, y);
    if (!rect || !body) return false;
    if (body.left < rect.left + 1 || body.right > rect.right - 1
        || body.top < rect.top + 1 || body.bottom > rect.bottom - 1) return false;
    if (typeof world._partyPoseBlocked === "function" && world._partyPoseBlocked(c, x, y, 0, { load: false })) {
        return false;
    }
    return true;
}

function bodyCenter(world, c, x, y) {
    const body = world?._creatureBodyAt?.(c, x, y);
    if (!body) return { x, y };
    return { x: (body.left + body.right) * 0.5, y: (body.top + body.bottom) * 0.5 };
}

/**
 * A wall rect crosses the line from the doctor's body to the patient. Feet
 * sit left of the body, so a feet-to-bed line can cut a door jamb the body
 * itself has already cleared.
 */
function wallBetween(world, c, x0, y0, x1, y1) {
    if (!c || typeof world?._aabbHitsThing !== "function") return false;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (!(dist > 6)) return false;
    const steps = Math.max(2, Math.ceil(dist / 3));
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = x0 + dx * t;
        const y = y0 + dy * t;
        if (world._aabbHitsThing(x - 1, x + 1, y - 1, y + 1, x, y, 64, c)) return true;
    }
    return false;
}

/**
 * The patient is resting in an interior hut, or null. `out` is a clear pose
 * just outside the door; `inn` is one just inside where the whole body fits.
 */
function interiorRest(world, rec, c, target) {
    if (!target || !rec || target === rec || target.id === rec.id) return null;
    if (!target._resting && !target.resting) return null;
    const uid = target.lastSleep?.uid;
    if (!uid || typeof world?._findSleepByUid !== "function") return null;
    const found = world._findSleepByUid(uid, target);
    const entry = found?.entry;
    if (!entry) return null;
    const def = world._thingDef?.(entry.id) || world._sleepDef?.(entry);
    if (!def?.sleep?.interior || !def.doorClear || !Place?.spriteAnchor) return null;
    const s = Number(def.spriteSize) || 32;
    const d = def.doorClear;
    const cx = (Number(d.x) || 0) + (Number(d.w) || 0) * 0.5;
    const anchor = Place.spriteAnchor(entry, def, TS);
    const feet = (px, py) => {
        const off = Place.rotateAnchorOffset(px - s * 0.5, py - s, entry.rot, s);
        return { x: anchor.x + off.dx - 8, y: anchor.y + off.dy + 4 };
    };
    const clear = (x, y) => !c || typeof world._partyPoseBlocked !== "function"
        || !world._partyPoseBlocked(c, x, y, 0, { load: false });
    let out = null;
    for (const py of [40, 36, 34, 32]) {
        const f = feet(cx, py);
        if (clear(f.x, f.y)) { out = f; break; }
    }
    // Pathing treats 2px as arrived (Path ARRIVE_PX). A stand only 1px
    // inside the floor makes that early stop miss the hut, so the tend
    // never starts. Keep a pose that is still inside after that slack,
    // and whose body can see the patient.
    const ARRIVE_PX = 2;
    const patientX = Number(target.x) || 0;
    const patientY = Number(target.y) || 0;
    let inn = null;
    let fallback = null;
    for (const py of [d.y - 2, d.y - 6, d.y - 10, 22]) {
        const f = feet(cx, py);
        if (!bodyInsideHut(world, c, entry, def, f.x, f.y)) continue;
        fallback = f;
        if (out) {
            const dx = out.x - f.x;
            const dy = out.y - f.y;
            const dist = Math.hypot(dx, dy) || 1;
            const slack = bodyInsideHut(
                world, c, entry, def,
                f.x + (dx / dist) * ARRIVE_PX,
                f.y + (dy / dist) * ARRIVE_PX
            );
            if (!slack) continue;
        }
        const center = bodyCenter(world, c, f.x, f.y);
        if (wallBetween(world, c, center.x, center.y, patientX, patientY)) continue;
        inn = f;
        break;
    }
    return { entry, def, out, inn: inn || fallback };
}

function goOrWalk(world, rec, target) {
    if (!target) return halt();
    const c = rec.creature || world?._ensureSettlerCreature?.(rec);
    if (rec) rec._pathIgnoreUid = null;
    if (c) c._pathIgnoreUid = null;
    const interior = interiorRest(world, rec, c, target);
    if (interior) {
        const px = Number(rec.x) || 0;
        const py = Number(rec.y) || 0;
        const tx = Number(target.x) || 0;
        const ty = Number(target.y) || 0;
        const center = bodyCenter(world, c, px, py);
        const inside = bodyInsideHut(world, c, interior.entry, interior.def, px, py);
        // The body has to be in the room, with no wall between them.
        if (inside && near(px, py, tx, ty) && !wallBetween(world, c, center.x, center.y, tx, ty)) {
            faceToward(rec, tx, ty - 8);
            return null;
        }
        // Cross the doorway on the open line. A path to the bedside cuts
        // the corner and walks through the wall.
        const mouth = interior.out;
        if (!inside && mouth && Math.hypot(px - mouth.x, py - mouth.y) > 8) {
            return walkTo(mouth.x, mouth.y, { openRadius: 0 });
        }
        if (interior.inn) return walkTo(interior.inn.x, interior.inn.y, { openRadius: 0 });
        return halt();
    }
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
    // Baskets and stations stay solid. Work from interact range when the
    // line is clear. If the thing itself is in the way, stand beside it
    // instead of walking into the sprite. Already overlapping still counts
    // so a settler who spawned on a basket can use it, then pathing gets
    // them out once the job is something else.
    const tx = Number(target.x) || 0;
    const ty = Number(target.y) || 0;
    const overlapping = !!(c && world?._partyPoseBlocked?.(c, rec.x, rec.y, 0));
    if (overlapping && near(rec.x, rec.y, tx, ty)) {
        faceToward(rec, tx, ty - 8);
        return null;
    }
    if (!overlapping && near(rec.x, rec.y, tx, ty)
        && !blockedToward(world, rec, c, tx, ty, target.uid)) {
        faceToward(rec, tx, ty - 8);
        return null;
    }
    const pose = stationStandFeet(world, rec, c, target);
    if (!overlapping && Math.hypot((Number(rec.x) || 0) - pose.feetX, (Number(rec.y) || 0) - pose.feetY) <= 10) {
        faceToward(rec, tx, ty - 8);
        return null;
    }
    return walkTo(pose.feetX, pose.feetY, { openRadius: 0 });
}

function blockedToward(world, rec, c, tx, ty, ignoreUid, pad = 2) {
    if (!c || typeof world?._partyPoseBlocked !== "function") return false;
    const px = Number(rec.x) || 0;
    const py = Number(rec.y) || 0;
    const dx = tx - px;
    const dy = ty - py;
    const dist = Math.hypot(dx, dy);
    if (!(dist > 4)) return false;
    const prev = c._pathIgnoreUid;
    if (ignoreUid) c._pathIgnoreUid = ignoreUid;
    const steps = Math.max(2, Math.ceil(dist / 4));
    let hit = false;
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (world._partyPoseBlocked(c, px + dx * t, py + dy * t, pad, { load: false })) {
            hit = true;
            break;
        }
    }
    c._pathIgnoreUid = prev || null;
    return hit;
}

function knapQualityDurationScale(quality) {
    return { crude: 1.25, rough: 1.0, fine: 0.8 }[quality] || 1;
}

function knapMaterialDurationScale(material) {
    if (typeof Stone !== "undefined" && Stone.durationScale) {
        return Stone.durationScale(material, (id) => DataStore?.getItem?.(id));
    }
    const def = DataStore?.getItem?.(material === "flint" ? "flint" : "pebble");
    const h = Number(def?.knapping?.hardness);
    const hardness = Number.isFinite(h) && h > 0 ? h : (material === "flint" ? 7 : 5);
    return 5 / hardness;
}

function manipScale(world, rec) {
    const c = rec?.creature || world?._ensureSettlerCreature?.(rec) || world?.creatures?.get(rec?.id);
    const cap = c?.capacities;
    if (typeof cap?.manipulationDurationScale === "function") return cap.manipulationDurationScale();
    return 1;
}

function publicChannel(rec) {
    const fish = rec?.fishChannel;
    if (fish && fish.max > 0) {
        const prog = 1 - (Number(fish.remaining) || 0) / fish.max;
        return {
            kind: "fish",
            ...(fish.hook ? { hook: true, bite: !!fish.bite } : {
                progress: Math.max(0, Math.min(1, prog))
            }),
            facing: fish.facing || null,
            waterTx: fish.waterTx,
            waterTy: fish.waterTy
        };
    }
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
    if (ch.kind === "rock" || ch.kind === "knap") {
        const rock = ch.uid ? world._findThingByUid(ch.uid)?.entry : null;
        return Settlement.actLabel({ type: "craft", target: rock }, actCtx(world, rec));
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

function countCarried(rec, pred) {
    let n = countInv(rec, pred);
    for (const s of rec.overflow || []) {
        if (s && pred(s)) n += Math.max(1, Number(s.quantity) || 1);
    }
    return n;
}

/** Keep the mats and tool this bill still needs so a stash does not put them back. */
function craftKeepPreds(bill, recipe) {
    const preds = [];
    for (const ing of recipe?.ingredients || []) {
        if (ing.hideStage) {
            preds.push((s) => {
                if (!s?.id) return false;
                if (Settlement.hideStageOf(getItem(s.id), s.id) !== ing.hideStage) return false;
                return hideAllowed(bill, s);
            });
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

function rockBillReady(world, rec, settle, bill) {
    if (!bill) return false;
    const recId = bill.recipeId;
    const recipeDef = Settlement.billRecipeById(recId) || bill;
    if (recipeDef.kind === "knap" || bill.kind === "knap") {
        return !!findNearestStored(world, rec, settle, (s) => Settlement.blankMatchesBill(bill, s));
    }
    const recipe = recId ? world._parseRecipe(recId) : null;
    if (!recipe) return false;
    for (const ing of recipe.ingredients || []) {
        let n = countSettle(world, rec, settle, (s) => s.id === ing.id);
        for (const s of rec.overflow || []) {
            if (s?.id === ing.id) n += Math.max(1, Number(s.quantity) || 1);
        }
        if (n < (ing.qty || 1)) return false;
    }
    const classes = Carry.recipeToolClasses?.(recipe.requireTool) || [];
    if (classes.length && !findNearestStored(world, rec, settle, (s) => {
        return classes.includes(Carry.stackToolClass(s, getItem(s.id)));
    })) return false;
    return true;
}

function fetchOrBlock(world, rec, settle, found) {
    if (!found) return { blocked: true, halt: true };
    if (found.at === rec) return null;
    const stack = found.slots?.[found.index];
    if (!canGivePawn(rec, stack)) return { needsRoom: true };
    return fetchStack(world, rec, settle, found) || halt();
}

/** Take up to `want` from storage. A heavy stack used to refuse the whole pile. */
function fetchCraftNeed(world, rec, settle, found, want, keepPreds) {
    if (!found) return { blocked: true };
    if (found.at === rec) return null;
    const stack = found.slots?.[found.index];
    if (!acceptsOne(rec, stack)) return { needsRoom: true, keepPreds };
    const n = Math.max(1, Math.floor(Number(want) || 1));
    return fetchCookQty(world, rec, settle, found, n) || halt();
}

function fetchBenchMats(world, rec, settle, bill, recipe) {
    const keepPreds = craftKeepPreds(bill, recipe);
    for (const ing of recipe.ingredients || []) {
        if (ing.hideStage) {
            const pred = (s) => {
                if (Settlement.hideStageOf(getItem(s.id), s.id) !== ing.hideStage) return false;
                return hideAllowed(bill, s);
            };
            const need = Math.max(1, Math.floor(Number(ing.qty) || 1));
            const have = countCarried(rec, pred);
            if (have >= need) continue;
            const found = findBasketStack(world, rec, settle, pred);
            return fetchCraftNeed(world, rec, settle, found, need - have, keepPreds);
        }
        if (!ing.id || ing.id === "ANY_HIDE" || ing.id === "ANY_LEATHER") continue;
        const pred = (s) => s.id === ing.id;
        const need = Math.max(1, Math.floor(Number(ing.qty) || 1));
        const have = countCarried(rec, pred);
        if (have >= need) continue;
        const found = findBasketStack(world, rec, settle, pred);
        return fetchCraftNeed(world, rec, settle, found, need - have, keepPreds);
    }
    const toolClass = recipe.requireTool?.toolClass || "awl";
    const awl = findStack(world, rec, settle, (s) => Carry.stackToolClass(s, getItem(s.id)) === toolClass);
    if (!awl) return { blocked: true, halt: true };
    if (awl.at !== rec) {
        const stack = awl.slots?.[awl.index];
        if (!canGivePawn(rec, stack) && !(freeHandSlot(rec) && canGivePawn(rec, stack))) {
            return { needsRoom: true, keepPreds };
        }
        const got = fetchOrBlock(world, rec, settle, awl);
        if (got?.needsRoom) return { needsRoom: true, keepPreds };
        return got;
    }
    if (!equipHand(rec, awl)) return { blocked: true, halt: true };
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
    const tendOverflow = ch.kind === "tend" && ch.bag === "overflow";
    if (!tendOverflow && rec.hotbarIndex !== ch.slot) return false;
    const held = tendOverflow
        ? (rec.overflow?.[ch.slot] || null)
        : (rec.inventory?.[ch.slot] || null);
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
    if (ch.kind === "rock" || ch.kind === "knap") {
        const rock = world._findThingByUid(ch.uid)?.entry;
        if (!rock || !near(rec.x, rec.y, rock.x, rock.y)) return false;
        if (ch.kind === "knap") {
            return (rec.inventory || []).some((s) => Settlement.blankMatchesBill(ch.bill, s));
        }
        if (ch.toolClasses?.length) {
            const cls = Carry.stackToolClass(held, held ? getItem(held.id) : null);
            if (!ch.toolClasses.includes(cls)) return false;
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
    if (ch.kind === "craft" || ch.kind === "rock") {
        const owner = world.players.get(rec.ownerId) || rec;
        world._tryCraft(owner, { id: ch.recipeId, pawnId: rec.id });
        return;
    }
    if (ch.kind === "knap") {
        ctx.finishSettlerKnap(world, rec, ch);
        return;
    }
    if (ch.kind === "tend") {
        const owner = world.players.get(rec.ownerId) || rec;
        world._tryTend(owner, {
            pawnId: rec.id,
            patientId: ch.patientId,
            fromPawnId: rec.id,
            slot: ch.slot,
            bag: ch.bag,
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

/**
 * A flesh/brain channel that cannot run has to let the rack go. Restarting
 * it every tick kept the station claimed while the settler stood still.
 */
function clearWorkChannel(world, rec, ch, reason) {
    rec._workChannel = null;
    endWorkHold(rec);
    if (reason !== "invalid") return;
    if (!ch || (ch.kind !== "flesh" && ch.kind !== "brain") || !ch.uid) return;
    skipJob(rec, stationKey({ uid: ch.uid }));
    rec._settlerScan = null;
    rec._settlerScanMs = SCAN_MS;
}

function tickChannel(world, rec, dtMs) {
    const ch = rec?._workChannel;
    if (!ch) return;
    const settle = findSettle(world, rec);
    const jobName = Settlement.channelJob ? Settlement.channelJob(ch) : ch.kind;
    const jobOff = !!(settle && !workJobOn(settle, rec, jobName));
    if (jobOff || !channelStillValid(world, rec, ch)) {
        clearWorkChannel(world, rec, ch, jobOff ? "job" : "invalid");
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
    if (!haulDropLive(world, drop)) {
        abandonHaul(world, rec, settle);
        return halt();
    }
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
    rec._carryRoom = null;
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
    const key = StorageFilter.mergeClaimKey(job) || job.claimKey;
    const reservedAvail = () => {
        const stack = src.slots?.[job.fromIndex];
        if (!stack || src.uid == null) return 0;
        return reservesOf(world, settle).available(
            `basket:${src.uid}:${job.fromIndex}`,
            stack.quantity,
            rec.id
        );
    };
    if (!(reservedAvail() > 0)) {
        skipJob(rec, key);
        endWorkHold(rec);
        if (rec._settlerScan) rec._settlerScan.haulMerge = null;
        return halt();
    }
    const walked = goOrWalk(world, rec, src);
    if (walked) return walked;
    const stack = src.slots?.[job.fromIndex];
    if (!stack || (job.stackId && stack.id !== job.stackId)) {
        skipJob(rec, key);
        endWorkHold(rec);
        return halt();
    }
    const want = Math.min(Math.max(1, Math.floor(Number(stack.quantity) || 1)), reservedAvail());
    if (!(want > 0)) {
        skipJob(rec, key);
        endWorkHold(rec);
        if (rec._settlerScan) rec._settlerScan.haulMerge = null;
        return halt();
    }
    const took = takeToPawn(world, rec, { ...stack, quantity: want });
    if (!(took > 0)) {
        skipJob(rec, key);
        endWorkHold(rec);
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

function liveFuelSlots(take, rec) {
    const src = take?.src;
    if (src?.entry && Array.isArray(src.entry.slots)) return src.entry.slots;
    if (src?.at === rec) return rec.inventory;
    if (src?.at && Array.isArray(src.at.slots)) return src.at.slots;
    return take?.slots;
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
    const slots = liveFuelSlots(take, rec);
    const stack = slots?.[take.index];
    if (!stack?.id) return false;
    stack.quantity = (Number(stack.quantity) || 1) - 1;
    if (!(stack.quantity > 0)) slots[take.index] = null;
    const slot = FuelFilter.addFuelUnit(fire, take.id);
    if (slot < 0) {
        stack.quantity = (Number(stack.quantity) || 0) + 1;
        slots[take.index] = stack;
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

function markStarterNeedsRoom(rec) {
    if (!rec._settlerScan) return;
    const light = rec._settlerScan.light || {};
    rec._settlerScan.light = { ...light, starterNeedsRoom: true };
}

function holdFirestarter(rec, starter) {
    if (!starter || starter.at !== rec) return false;
    if (starter.kind === "inv") {
        rec.hotbarIndex = starter.index;
        return true;
    }
    if (starter.kind !== "overflow") return false;
    const inv = rec.inventory || [];
    const empty = inv.findIndex((s) => !s);
    if (empty < 0) return false;
    inv[empty] = starter.slots[starter.index];
    starter.slots[starter.index] = null;
    rec.hotbarIndex = empty;
    return true;
}

function doLightFire(world, rec, settle, fire) {
    if (Research?.techUnlocked && !Research.techUnlocked("fire", researchHolder(world, rec, settle))) {
        endWorkHold(rec);
        return halt();
    }
    if (!fire) return halt();
    if (!fireCanFuel(world, rec, settle, fire)) {
        endWorkHold(rec);
        return halt();
    }
    const starter = findStack(world, rec, settle, (s) => Settlement.isFirestarter(s, getItem));
    if (!starter) {
        endWorkHold(rec);
        skipJob(rec, stationKey(fire));
        return halt();
    }
    // Fetch the starter before loading fuel. A full hotbar used to dump sticks
    // into a cold pit, fail to pick up the drill, and stand there forever.
    if (starter.at !== rec) {
        const stack = starter.slots?.[starter.index];
        if (!canGivePawn(rec, stack && { ...stack, quantity: 1 })) {
            endWorkHold(rec);
            markStarterNeedsRoom(rec);
            if (!firstStashable(rec, keepGearOpts())) skipJob(rec, stationKey(fire));
            return halt();
        }
        return fetchStack(world, rec, settle, starter) || halt();
    }
    const walked = goOrWalk(world, rec, fire);
    if (walked) return walked;
    const facing = faceFire(rec, fire);
    const face = facing ? { facing } : null;
    if (!(world._campfireHasFuel(fire) || stokeUntilKeep(world, rec, settle, fire))) {
        endWorkHold(rec);
        return halt(face);
    }
    const wear = holdFirestarter(rec, starter);
    const lit = world._campfireEnsureBurning(fire);
    if (!lit) {
        endWorkHold(rec);
        skipJob(rec, stationKey(fire));
        return halt(face);
    }
    if (wear) world._wearHeld(rec, 1);
    emitEntry(world, fire);
    return halt(face);
}
    ctx.mergeNeedsRoom = mergeNeedsRoom;
    ctx.fetchTarget = fetchTarget;
    ctx.walkToFound = walkToFound;
    ctx.fetchStack = fetchStack;
    ctx.restorePiece = restorePiece;
    ctx.fetchCookPiece = fetchCookPiece;
    ctx.fetchCookQty = fetchCookQty;
    ctx.isPreparedStack = isPreparedStack;
    ctx.heldPrepared = heldPrepared;
    ctx.returnPreparedFood = returnPreparedFood;
    ctx.fetchEatStack = fetchEatStack;
    ctx.putInBasket = putInBasket;
    ctx.walkHaulDest = walkHaulDest;
    ctx.finishPut = finishPut;
    ctx.takeOffFire = takeOffFire;
    ctx.acceptsOne = acceptsOne;
    ctx.pocketFail = pocketFail;
    ctx.fetchOneOrRoom = fetchOneOrRoom;
    ctx.persistBills = persistBills;
    ctx.markPathIgnore = markPathIgnore;
    ctx.stationStandDist = stationStandDist;
    ctx.stationStandDistFor = stationStandDistFor;
    ctx.stationStandFeet = stationStandFeet;
    ctx.goOrWalk = goOrWalk;
    ctx.blockedToward = blockedToward;
    ctx.knapQualityDurationScale = knapQualityDurationScale;
    ctx.knapMaterialDurationScale = knapMaterialDurationScale;
    ctx.manipScale = manipScale;
    ctx.publicChannel = publicChannel;
    ctx.setSettlerAct = setSettlerAct;
    ctx.firstStashable = firstStashable;
    ctx.actCtx = actCtx;
    ctx.workChannelLabel = workChannelLabel;
    ctx.countInv = countInv;
    ctx.countSettle = countSettle;
    ctx.findBasketStack = findBasketStack;
    ctx.hideAllowed = hideAllowed;
    ctx.benchHasWork = benchHasWork;
    ctx.rockBillReady = rockBillReady;
    ctx.fetchOrBlock = fetchOrBlock;
    ctx.fetchBenchMats = fetchBenchMats;
    ctx.findChannelPatient = findChannelPatient;
    ctx.channelStillValid = channelStillValid;
    ctx.clearWorkChannel = clearWorkChannel;
    ctx.finishWorkChannel = finishWorkChannel;
    ctx.jobsOn = jobsOn;
    ctx.workJobOn = workJobOn;
    ctx.tickChannel = tickChannel;
    ctx.doGather = doGather;
    ctx.doHaul = doHaul;
    ctx.doStash = doStash;
    ctx.doMerge = doMerge;
    ctx.liveFuelSlots = liveFuelSlots;
    ctx.stokeFuel = stokeFuel;
    ctx.stokeUntilKeep = stokeUntilKeep;
    ctx.doStokeFire = doStokeFire;
    ctx.doLightFire = doLightFire;
});
