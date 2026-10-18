/**
 * Settler work functions (field).
 * Installed into the settlerWork closure. Function bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SettlerWorkParts = root.SettlerWorkParts || {};
        root.SettlerWorkParts.field = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    const Chop = ctx.Chop;
    const Settlement = ctx.Settlement;
    const Research = ctx.Research;
    const BodyCombat = ctx.BodyCombat;
    const Dig = ctx.Dig;
    const SCAN_MS = ctx.SCAN_MS;
    const endWorkHold = (...args) => ctx.endWorkHold(...args);
    const skipJob = (...args) => ctx.skipJob(...args);
    const thingKey = (...args) => ctx.thingKey(...args);
    const getItem = (...args) => ctx.getItem(...args);
    const halt = (...args) => ctx.halt(...args);
    const researchHolder = (...args) => ctx.researchHolder(...args);
    const findStack = (...args) => ctx.findStack(...args);
    const findBestChopStack = (...args) => ctx.findBestChopStack(...args);
    const clearPaintBar = (...args) => ctx.clearPaintBar(...args);
    const fetchStack = (...args) => ctx.fetchStack(...args);
    const goOrWalk = (...args) => ctx.goOrWalk(...args);
    const takeOne = (...args) => ctx.takeOne(...args);
    const emitEntry = (...args) => ctx.emitEntry(...args);
    const facePaint = (...args) => ctx.facePaint(...args);
    const restorePiece = (...args) => ctx.restorePiece(...args);
    const goToDrop = (...args) => ctx.goToDrop(...args);
    const paintStandOf = (...args) => ctx.paintStandOf(...args);
    const fetchCookPiece = (...args) => ctx.fetchCookPiece(...args);
    const setPaintBar = (...args) => ctx.setPaintBar(...args);
    const setSettlerAct = (...args) => ctx.setSettlerAct(...args);
    const findTally = (...args) => ctx.findTally(...args);
    const findPigment = (...args) => ctx.findPigment(...args);
    const pigmentOk = (...args) => ctx.pigmentOk(...args);
    const paintingCirclesOf = (...args) => ctx.paintingCirclesOf(...args);
    const dropKey = (...args) => ctx.dropKey(...args);
    const walkTo = (...args) => ctx.walkTo(...args);
    const depositWantsDig = (...args) => ctx.depositWantsDig(...args);


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
            return !world._partyPoseBlocked(c, feetX, feetY, 0, { load: false });
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
        if (rec._busyJob?.type === "chop" || rec._busyJob?.type === "dig") endWorkHold(rec);
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

function holdingPigment(rec, entry) {
    const pred = (s) => pigmentOk(entry, s);
    return (rec?.inventory || []).some(pred) || (rec?.overflow || []).some(pred);
}

function holdingTally(rec) {
    const id = Research?.TALLY_ITEM_ID || "tally_stick";
    const has = (s) => s?.id === id && Number(s.quantity) > 0;
    return (rec?.inventory || []).some(has) || (rec?.overflow || []).some(has);
}

/** The circle still standing in camp, not a leftover object from an old scan. */
function liveCircle(world, settle, circle) {
    const entry = circle?.entry || circle;
    if (!entry || entry.gone) return null;
    const list = paintingCirclesOf(world, settle) || [];
    if (entry.uid) {
        const live = list.find((e) => e && !e.gone && String(e.uid) === String(entry.uid));
        if (live) return live;
    }
    return list.includes(entry) ? entry : null;
}

function stopResearch(rec, entry, skip) {
    endWorkHold(rec);
    if (rec?._settlerScan) rec._settlerScan.researchCircle = null;
    if (skip && entry) {
        skipJob(rec, thingKey(entry));
        rec._settlerScanMs = SCAN_MS;
    }
    setSettlerAct(rec, rec?.creature, "Idle");
}

/** Walked for a couple of seconds without moving: the stand or the dye is walled off. */
function researchStalled(rec, delta) {
    const x = Number(rec?.x) || 0;
    const y = Number(rec?.y) || 0;
    const px = rec._researchPx;
    const py = rec._researchPy;
    const dt = Number(delta) > 0 ? Number(delta) : 16;
    rec._researchPx = x;
    rec._researchPy = y;
    if (px == null || Math.hypot(x - px, y - py) > 0.25) {
        rec._researchMissMs = 0;
        return false;
    }
    rec._researchMissMs = (rec._researchMissMs || 0) + dt;
    return rec._researchMissMs > 2000;
}

function walkResearch(world, rec, entry, walked, delta) {
    if (!walked?.walkTo) return walked || null;
    if (researchStalled(rec, delta)) {
        stopResearch(rec, entry, true);
        return halt();
    }
    return walked;
}

function afterFetch(world, rec, entry, walked, delta, haveIt) {
    if (walked?.walkTo) return walkResearch(world, rec, entry, walked, delta);
    if (!haveIt()) {
        stopResearch(rec, entry, true);
        return halt();
    }
    return walked || halt();
}

function doResearch(world, rec, settle, circle, delta) {
    const entry = liveCircle(world, settle, circle);
    if (!entry || !Research) {
        stopResearch(rec, null, false);
        return halt();
    }
    const def = world._thingDef(entry.id);
    Research.ensureEntry(entry, def);
    if (!Research.isEnabled(entry)) {
        stopResearch(rec, null, false);
        return halt();
    }
    if (Research.needsTallyInstall?.(researchHolder(world, rec, settle), entry)) {
        const src = findTally(world, rec, settle);
        if (src?.found) {
            const found = src.found;
            if (found.at !== rec) {
                clearPaintBar(rec);
                const walked = fetchStack(world, rec, settle, found) || halt();
                return afterFetch(world, rec, entry, walked, delta, () => holdingTally(rec));
            }
            const walked = goOrWalk(world, rec, entry);
            if (walked) {
                clearPaintBar(rec);
                return walkResearch(world, rec, entry, walked, delta);
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
        } else if (src?.drop) {
            clearPaintBar(rec);
            const drop = src.drop;
            const walked = goToDrop(world, rec, drop);
            if (walked) return walkResearch(world, rec, entry, walked, delta);
            world._tryPickup?.(rec, { dropId: drop.uid, quantity: 1 });
            world._dirtyPawnOwner(rec);
            if (!holdingTally(rec)) {
                skipJob(rec, dropKey(drop));
                stopResearch(rec, null, false);
            }
            return halt();
        }
    }
    if (!Research.hasRoom(entry) && !Research.inProgress(entry)) {
        stopResearch(rec, null, false);
        return halt();
    }
    if (Research.needsPigment(entry)) {
        const src = findPigment(world, rec, settle, entry);
        if (!src) {
            stopResearch(rec, null, false);
            return halt();
        }
        if (src.drop) {
            clearPaintBar(rec);
            const drop = src.drop;
            const walked = goToDrop(world, rec, drop);
            if (walked) return walkResearch(world, rec, entry, walked, delta);
            world._tryPickup?.(rec, { dropId: drop.uid, quantity: 1 });
            world._dirtyPawnOwner(rec);
            if (!holdingPigment(rec, entry)) {
                skipJob(rec, dropKey(drop));
                stopResearch(rec, null, false);
            }
            return halt();
        }
        const found = src.found;
        if (found.at !== rec) {
            clearPaintBar(rec);
            const walked = fetchCookPiece(world, rec, settle, found) || halt();
            return afterFetch(world, rec, entry, walked, delta, () => holdingPigment(rec, entry));
        }
        const walked = goOrWalk(world, rec, entry);
        if (walked) {
            clearPaintBar(rec);
            return walkResearch(world, rec, entry, walked, delta);
        }
        const piece = takeOne(found);
        if (!piece || !Research.startPaint(entry, piece.id)) {
            if (piece) restorePiece(found, piece);
            stopResearch(rec, null, false);
            return halt();
        }
        emitEntry(world, entry);
        world._dirtyPawnOwner(rec);
    }
    const stand = paintStandOf(entry);
    if (!stand) {
        stopResearch(rec, null, false);
        return halt();
    }
    if (Math.hypot((Number(rec.x) || 0) - stand.x, (Number(rec.y) || 0) - stand.y) > 3) {
        clearPaintBar(rec);
        const walked = goOrWalk(world, rec, entry) || walkTo(stand.x, stand.y, { openRadius: 0 });
        return walkResearch(world, rec, entry, walked, delta);
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
    rec._researchMissMs = 0;
    setPaintBar(rec, entry);
    const facing = facePaint(rec, entry);
    return halt(facing ? { facing } : null);
}

function doChop(world, rec, settle, tree, delta) {
    if (!chopTargetLive(world, tree)) {
        dropChopTarget(rec, tree);
        return halt();
    }
    const found = findBestChopStack(world, rec, settle);
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

function digTargetLive(world, patch) {
    if (!patch || patch.gone) return false;
    if (!Dig) return false;
    const def = world._thingDef(patch.id);
    return Dig.isDeposit(def) && Dig.stillDiggable(def, patch);
}

function dropDigTarget(rec, patch, skip = true) {
    clearChopApproach(rec, rec.creature);
    if (rec._settlerScan) rec._settlerScan.digThing = null;
    rec._settlerScanMs = SCAN_MS;
    if (skip && patch) skipJob(rec, thingKey(patch));
    if (rec._busyJob?.type === "dig") endWorkHold(rec);
}

function doDig(world, rec, settle, patch, delta) {
    if (!digTargetLive(world, patch)) {
        dropDigTarget(rec, patch);
        return halt();
    }
    const digDef = world._thingDef?.(patch.id);
    if (!depositWantsDig(world, settle, digDef)) {
        dropDigTarget(rec, null, false);
        return halt();
    }
    const found = findStack(world, rec, settle, (s) => Dig.isDigger(s, getItem));
    if (!found) {
        dropDigTarget(rec, null, false);
        return halt();
    }
    if (found.at !== rec) return fetchStack(world, rec, settle, found) || halt();
    rec.hotbarIndex = found.index;
    const c = rec.creature || world._ensureSettlerCreature(rec);
    if (c) {
        c.inventory = rec.inventory;
        c.hotbarIndex = rec.hotbarIndex;
        c.homeSettlementId = rec.homeSettlementId;
        c.ownerId = rec.ownerId;
    }
    if (c?.isAttacking?.()) return halt();
    const hs = Dig.hitboxSize();
    const body = c?.bodyCenter?.() || { x: rec.x, y: rec.y };
    const ang = Math.atan2(patch.y - body.y, patch.x - body.x);
    const hits = !!Dig.aimHitsTile(body.x, body.y, ang, patch.x, patch.y);
    const pose = chopStandFeet(world, rec, c, patch, hs);
    const enter = 6;
    const leave = 10;
    if (rec._chopArrived && pose.dAim > leave) rec._chopArrived = false;
    if (!rec._chopArrived && pose.dAim <= enter) rec._chopArrived = true;
    const ai = c?.ai;
    if ((ai?._jamMs || 0) > 900 || (ai?._stuckMs || 0) > 1800) {
        dropDigTarget(rec, patch);
        return halt();
    }
    if (hits && rec._chopArrived) {
        rec._chopMissMs = 0;
        const dig = Dig.pickDigFromAttacks?.(BodyCombat.collectAttacks(c)) || null;
        if (dig && c?.tryMeleeAttack) c.tryMeleeAttack(patch, dig);
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
        dropDigTarget(rec, patch);
        return halt();
    }
    return halt();
}

function doFish(world, rec, settle, spot) {
    if (!spot) {
        endWorkHold(rec);
        return halt();
    }
    if (rec.fishChannel) {
        const face = rec.fishChannel.facing || null;
        if (face) rec.facing = face;
        return halt(face ? { facing: face } : null);
    }
    const rodId = "flimsy_rod";
    const grubId = "grub";
    const rod = findStack(world, rec, settle, (s) => s.id === rodId);
    if (!rod) {
        endWorkHold(rec);
        return halt();
    }
    if (rod.at !== rec) return fetchStack(world, rec, settle, rod) || halt();
    const grub = findStack(world, rec, settle, (s) => s.id === grubId);
    if (!grub) {
        endWorkHold(rec);
        return halt();
    }
    if (grub.at !== rec) return fetchStack(world, rec, settle, grub) || halt();
    const heldRod = (rec.inventory || []).findIndex((s) => s && s.id === rodId);
    if (heldRod >= 0) rec.hotbarIndex = heldRod;
    const c = rec.creature || world._ensureSettlerCreature?.(rec);
    if (c) {
        c.inventory = rec.inventory;
        c.hotbarIndex = rec.hotbarIndex;
        c.homeSettlementId = rec.homeSettlementId;
        c.ownerId = rec.ownerId;
    }
    const ts = 16;
    const feetX = (Number(spot.standTx) + 0.5) * ts;
    const feetY = (Number(spot.standTy) + 0.5) * ts;
    if (Math.hypot(rec.x - feetX, rec.y - feetY) > 6) {
        return walkTo(feetX, feetY, { openRadius: 0 });
    }
    rec.x = feetX;
    rec.y = feetY;
    const fdx = (spot.waterTx | 0) - (spot.standTx | 0);
    const fdy = (spot.waterTy | 0) - (spot.standTy | 0);
    rec.facing = fdx > 0 ? "right" : fdx < 0 ? "left" : fdy > 0 ? "down" : "up";
    if (c) {
        c.x = feetX;
        c.y = feetY;
        c.facing = rec.facing;
    }
    const started = world._tryStartFish?.(rec, { tx: spot.waterTx, ty: spot.waterTy });
    if (!started) {
        endWorkHold(rec);
        return halt();
    }
    const face = rec.fishChannel?.facing || rec.facing;
    if (face) rec.facing = face;
    return halt(face ? { facing: face } : null);
}
    ctx.chopStandFeet = chopStandFeet;
    ctx.clearChopApproach = clearChopApproach;
    ctx.chopTargetLive = chopTargetLive;
    ctx.dropChopTarget = dropChopTarget;
    ctx.markChopTarget = markChopTarget;
    ctx.pigmentPred = pigmentPred;
    ctx.doResearch = doResearch;
    ctx.doChop = doChop;
    ctx.digTargetLive = digTargetLive;
    ctx.dropDigTarget = dropDigTarget;
    ctx.doDig = doDig;
    ctx.doFish = doFish;
});
