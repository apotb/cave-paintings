/**
 * Placeable buildings — occupancy, range, rotation, texture keys.
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Place = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const BLOCKED = { water: true, ice: true };

    function placeThingId(itemDef) {
        const id = itemDef?.place?.thing;
        return typeof id === "string" && id ? id : null;
    }

    function normalizeRot(rot) {
        let n = Math.round(Number(rot) || 0);
        n = ((n % 360) + 360) % 360;
        n = Math.round(n / 90) * 90;
        if (n === 360) n = 0;
        return n;
    }

    function rotateCW(rot) {
        return normalizeRot(normalizeRot(rot) + 90);
    }

    function rotateCCW(rot) {
        return normalizeRot(normalizeRot(rot) - 90);
    }

    function rotationTextureKey(thingKey, rot) {
        return `${thingKey}_${normalizeRot(rot)}`;
    }

    function rotationFrameTextureKey(thingKey, rot) {
        return `${thingKey}_frame_${normalizeRot(rot)}`;
    }

    function thingImageLoads(t) {
        if (!t?.key) return [];
        if (Array.isArray(t.rotations) && t.rotations.length) {
            const loads = [];
            const seen = new Set();
            for (const raw of t.rotations) {
                const rot = normalizeRot(raw);
                const key = rotationTextureKey(t.key, rot);
                if (seen.has(key)) continue;
                seen.add(key);
                loads.push({
                    key,
                    path: `assets/things/${t.key}/${rot}.png`
                });
                if (t.sleep) {
                    loads.push({
                        key: rotationFrameTextureKey(t.key, rot),
                        path: `assets/things/${t.key}/frame_${rot}.png`
                    });
                }
            }
            return loads;
        }
        if (t.paintingCircle) {
            const loads = [{
                key: t.key,
                path: `assets/things/${t.key}/${t.key}.png`
            }];
            for (let i = 1; i <= 6; i++) {
                loads.push({
                    key: `${t.key}_${i}`,
                    path: `assets/things/${t.key}/${i}.png`
                });
            }
            loads.push({
                key: `${t.key}_upgrade_stick`,
                path: `assets/things/${t.key}/upgrade_stick.png`
            });
            return loads;
        }
        if (t.anim) {
            return [{
                key: t.key,
                path: `assets/things/${t.key}.png`,
                spritesheet: true,
                frameWidth: t.anim.frameWidth ?? 16,
                frameHeight: t.anim.frameHeight ?? 16
            }];
        }
        const loads = [{ key: t.key, path: `assets/things/${t.key}.png` }];
        if (t.dryingRack) {
            const hangKey = t.hangingKey || `${t.key}_hanging`;
            loads.push({ key: hangKey, path: `assets/things/${hangKey}.png` });
        }
        return loads;
    }

    function canRotate(thingDef) {
        return Array.isArray(thingDef?.rotations) && thingDef.rotations.length > 0;
    }

    function isCraftStation(thingDef) {
        return !!thingDef?.craftStation;
    }

    function isSettlementThing(thingDef, entry) {
        if (thingDef?.settlement) return true;
        return entry?.id === "settling_stone" || !!entry?.settlementId;
    }

    /** Nearby-requirement match: a settling stone counts as a rock. */
    function countsAsThing(haveId, needId) {
        if (!needId || !haveId) return false;
        if (haveId === needId) return true;
        return needId === "rock" && haveId === "settling_stone";
    }

    function ensureSettlementEntry(entry) {
        if (!entry) return entry;
        if (!entry.uid) {
            entry.uid = `ss_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        entry.rot = normalizeRot(entry.rot);
        return entry;
    }

    /**
     * Inventory / craft / hotbar texture for an item.
     * Dedicated item art (`itemDef.key`) wins when that texture exists;
     * rotatable placeables otherwise use the 0° world sprite (`${thingKey}_0`).
     */
    function itemIconKey(itemDef, getThing, hasTexture) {
        const fallback = itemDef?.key || itemDef?.id || "";
        if (fallback && typeof hasTexture === "function" && hasTexture(fallback)) {
            return fallback;
        }
        const thingId = placeThingId(itemDef);
        if (!thingId) return fallback;
        const thingDef = typeof getThing === "function" ? getThing(thingId) : getThing;
        if (canRotate(thingDef) && thingDef.key) {
            return rotationTextureKey(thingDef.key, 0);
        }
        return fallback;
    }

    function ensureCraftStationEntry(entry) {
        if (!entry) return entry;
        entry.rot = normalizeRot(entry.rot);
        if (!entry.uid) {
            entry.uid = `cs_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        const o = originTileOf(entry, 16);
        if (!Number.isInteger(entry.tx)) entry.tx = o.tx;
        if (!Number.isInteger(entry.ty)) entry.ty = o.ty;
        return entry;
    }

    function inPlaceRange(px, py, wx, wy, tileSize, interactionRange) {
        const r = Number(tileSize) * Number(interactionRange);
        if (!(r > 0)) return false;
        const dx = Number(wx) - Number(px);
        const dy = Number(wy) - Number(py);
        return dx * dx + dy * dy <= r * r;
    }

    function footprintSize(thingDef) {
        const fp = thingDef?.footprint;
        if (Array.isArray(fp) && fp.length >= 2) {
            const w = Math.max(1, Math.floor(Number(fp[0]) || 1));
            const h = Math.max(1, Math.floor(Number(fp[1]) || 1));
            return [w, h];
        }
        return [1, 1];
    }

    function originTileOf(entry, tileSize) {
        const ts = Number(tileSize) || 16;
        if (Number.isInteger(entry?.tx) && Number.isInteger(entry?.ty)) {
            return { tx: entry.tx, ty: entry.ty };
        }
        return {
            tx: Math.floor(Number(entry?.x) / ts),
            ty: Math.floor((Number(entry?.y) - 1) / ts)
        };
    }

    /** Tile step from the origin to the work/stand spot at rot 0. South is [0, 1]. */
    function interactOffset(thingDef) {
        const o = thingDef?.interactOffset;
        if (!Array.isArray(o) || o.length < 2) return null;
        const dx = Math.round(Number(o[0]) || 0);
        const dy = Math.round(Number(o[1]) || 0);
        if (!dx && !dy) return null;
        return { dx, dy };
    }

    /** Rotate a tile delta with y-down (0° south stays south). */
    function rotateTileDelta(dx, dy, rot) {
        const r = normalizeRot(rot);
        if (r === 90) return { dx: -dy, dy: dx };
        if (r === 180) return { dx: -dx, dy: -dy };
        if (r === 270) return { dx: dy, dy: -dx };
        return { dx, dy };
    }

    function interactTileOf(entry, tileSize, thingDef) {
        const off = interactOffset(thingDef);
        if (!off || !entry || entry.gone) return null;
        const origin = originTileOf(entry, tileSize);
        const d = rotateTileDelta(off.dx, off.dy, entry.rot);
        return { tx: origin.tx + d.dx, ty: origin.ty + d.dy };
    }

    /** Feet pose at the bottom-center of the interact tile, same as tileCenter. */
    function interactWorldPos(entry, tileSize, thingDef) {
        const t = interactTileOf(entry, tileSize, thingDef);
        if (!t) return null;
        const ts = Number(tileSize) || 16;
        return { x: t.tx * ts + ts / 2, y: t.ty * ts + ts };
    }

    function appendUniqueTile(tiles, extra) {
        if (!extra) return tiles;
        if (tiles.some((t) => t.tx === extra.tx && t.ty === extra.ty)) return tiles;
        tiles.push(extra);
        return tiles;
    }

    /** Footprint plus interact tile — occupancy for placement, not walk collision. */
    function occupyTiles(entry, tileSize, thingDef) {
        const tiles = entryFootprintTiles(entry, tileSize, thingDef);
        return appendUniqueTile(tiles, interactTileOf(entry, tileSize, thingDef));
    }

    function placeOccupyTiles(tx, ty, rot, thingDef) {
        const fp = footprintSize(thingDef);
        const tiles = footprintTiles(tx, ty, rot, fp);
        const off = interactOffset(thingDef);
        if (!off) return tiles;
        const d = rotateTileDelta(off.dx, off.dy, rot);
        return appendUniqueTile(tiles, { tx: tx + d.dx, ty: ty + d.dy });
    }

    /**
     * Tiles covered by a footprint whose origin is (tx, ty).
     * 0° east, 90° south, 180° west, 270° north.
     */
    function footprintTiles(tx, ty, rot, footprint) {
        const [fw, fh] = Array.isArray(footprint) && typeof footprint[0] === "number"
            ? footprint
            : footprintSize(footprint);
        const r = normalizeRot(rot);
        const along = Math.max(fw, fh);
        const dx = r === 0 ? 1 : r === 180 ? -1 : 0;
        const dy = r === 90 ? 1 : r === 270 ? -1 : 0;
        const tiles = [];
        const n = Math.max(1, along);
        for (let i = 0; i < n; i++) {
            tiles.push({ tx: tx + i * dx, ty: ty + i * dy });
        }
        return tiles;
    }

    function footprintWorldPos(tx, ty, rot, footprint, tileSize) {
        const ts = Number(tileSize) || 16;
        const tiles = footprintTiles(tx, ty, rot, footprint);
        let minX = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const t of tiles) {
            const cx = t.tx * ts + ts / 2;
            const by = t.ty * ts + ts;
            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (by > maxY) maxY = by;
        }
        return {
            x: (minX + maxX) / 2,
            y: maxY
        };
    }

    function entryFootprintTiles(entry, tileSize, thingDef) {
        if (!entry || entry.gone) return [];
        const ts = Number(tileSize) || 16;
        const origin = originTileOf(entry, ts);
        const fp = footprintSize(thingDef);
        if (fp[0] <= 1 && fp[1] <= 1) {
            return [{ tx: origin.tx, ty: origin.ty }];
        }
        return footprintTiles(origin.tx, origin.ty, entry.rot, fp);
    }

    /** Axis-aligned world box covering every footprint tile (beds included). */
    function footprintWorldRect(entry, thingDef, tileSize) {
        const ts = Number(tileSize) || 16;
        const tiles = entryFootprintTiles(entry, ts, thingDef);
        if (!tiles.length) return null;
        let minTx = Infinity;
        let maxTx = -Infinity;
        let minTy = Infinity;
        let maxTy = -Infinity;
        for (const t of tiles) {
            if (t.tx < minTx) minTx = t.tx;
            if (t.tx > maxTx) maxTx = t.tx;
            if (t.ty < minTy) minTy = t.ty;
            if (t.ty > maxTy) maxTy = t.ty;
        }
        return {
            left: minTx * ts,
            right: (maxTx + 1) * ts,
            top: minTy * ts,
            bottom: (maxTy + 1) * ts
        };
    }

    /**
     * Axis-aligned hitbox in pixels. `hitbox` may be `[w, h]` (swapped on 90/270)
     * or `[[w0, h0], [w90, h90]]` for 0/180 vs 90/270. Falls back to `hitboxSize`.
     */
    function hitboxWH(thingDef, rot) {
        const r = normalizeRot(rot);
        const spec = thingDef?.hitbox;
        if (Array.isArray(spec) && spec.length) {
            if (Array.isArray(spec[0])) {
                const use90 = r === 90 || r === 270;
                const row = (use90 && spec[1]) ? spec[1] : spec[0];
                const w = Math.max(1, Number(row?.[0]) || 1);
                const h = Math.max(1, Number(row?.[1]) || w);
                return { w, h, oriented: true };
            }
            const w0 = Math.max(1, Number(spec[0]) || 1);
            const h0 = Math.max(1, Number(spec[1]) || w0);
            if (r === 90 || r === 270) return { w: h0, h: w0, oriented: true };
            return { w: w0, h: h0, oriented: true };
        }
        const hs = Number(thingDef?.hitboxSize);
        if (!(hs > 0)) return null;
        return { w: hs, h: hs, oriented: false };
    }

    /**
     * Empty/handle pixels on the north of 1×1 furniture (baskets, benches).
     * Opaque AABBs include the rim; walking this far into the sprite nests
     * against the body instead of stopping in the sand above it.
     */
    const FURNITURE_NORTH_SLACK = 3;

    /**
     * Walk collision in world pixels.
     * 1×1: hs×hs at the feet, or a rotation-aware AABB from `hitbox`.
     * Sleep: footprint minus the open/bedding side (walk onto the laying spot).
     * Other multi-tile: a strip `hitboxSize` thick on the closed side.
     */
    function collisionWorldRect(entry, thingDef, tileSize) {
        const ts = Number(tileSize) || 16;
        const box = hitboxWH(thingDef, entry?.rot);
        if (!box || !entry || entry.gone) return null;
        const fp = footprintSize(thingDef);
        if (fp[0] <= 1 && fp[1] <= 1) {
            const x = Number(entry.x) || 0;
            const y = Number(entry.y) || 0;
            const hx = box.w * 0.5;
            const r = normalizeRot(entry.rot);
            const slack = box.oriented
                ? Math.min(FURNITURE_NORTH_SLACK, Math.max(0, box.h - 1))
                : 0;
            if (box.oriented && r === 180) {
                return {
                    left: x - hx,
                    right: x + hx,
                    top: y - ts + slack,
                    bottom: y - ts + box.h
                };
            }
            return {
                left: x - hx,
                right: x + hx,
                top: y - box.h + slack,
                bottom: y
            };
        }
        const tiles = entryFootprintTiles(entry, ts, thingDef);
        if (!tiles.length) return null;
        let minTx = Infinity;
        let maxTx = -Infinity;
        let minTy = Infinity;
        let maxTy = -Infinity;
        for (const t of tiles) {
            if (t.tx < minTx) minTx = t.tx;
            if (t.tx > maxTx) maxTx = t.tx;
            if (t.ty < minTy) minTy = t.ty;
            if (t.ty > maxTy) maxTy = t.ty;
        }
        let left = minTx * ts;
        let right = (maxTx + 1) * ts;
        let top = minTy * ts;
        let bottom = (maxTy + 1) * ts;
        const hs = box.h;
        if (thingDef?.sleep) {
            const r = normalizeRot(entry.rot);
            const along = (r === 0 || r === 180) ? (right - left) : (bottom - top);
            const pad = Math.min(2, Math.max(0, Math.floor((along - 12) / 2)));
            if (r === 0 || r === 180) {
                left += pad;
                right -= pad;
            } else {
                top += pad;
                bottom -= pad;
            }
            const cross = (r === 0 || r === 180) ? (bottom - top) : (right - left);
            const wall = Math.max(3, Math.min(hs, cross - 1));
            const want = Number(thingDef.sleep.openInset);
            const open = Math.min(
                Math.max(0, Number.isFinite(want) ? want : Math.floor(ts * 0.5)),
                Math.max(0, cross - wall)
            );
            if (r === 0) bottom -= open;
            else if (r === 180) top += open;
            else if (r === 90) left += open;
            else right -= open;
            return { left, right, top, bottom };
        }
        const thick = Math.min(hs, Math.max(1, right - left), Math.max(1, bottom - top));
        const r = normalizeRot(entry.rot);
        if (r === 0) return { left, right, top, bottom: top + thick };
        if (r === 180) return { left, right, top: bottom - thick, bottom };
        if (r === 90) return { left: right - thick, right, top, bottom };
        return { left, right: left + thick, top, bottom };
    }

    function entryOnTile(entry, tx, ty, tileSize, thingDef) {
        if (!entry || entry.gone) return false;
        const ts = Number(tileSize) || 16;
        return occupyTiles(entry, ts, thingDef).some((t) => t.tx === tx && t.ty === ty);
    }

    function canPlaceOnTile(opts) {
        const tileKey = opts?.tileKey;
        if (!tileKey || BLOCKED[tileKey]) return false;
        const tx = opts.tx;
        const ty = opts.ty;
        const ts = opts.tileSize || 16;
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
        const getThing = opts.getThing;
        const lists = [opts.things, opts.lootables];
        for (const list of lists) {
            if (!Array.isArray(list)) continue;
            for (const e of list) {
                const def = typeof getThing === "function" ? getThing(e?.id) : null;
                if (entryOnTile(e, tx, ty, ts, def)) return false;
            }
        }
        return true;
    }

    function canPlaceOnTiles(tiles, occForTile) {
        if (!Array.isArray(tiles) || !tiles.length) return false;
        for (const t of tiles) {
            const occ = typeof occForTile === "function" ? occForTile(t.tx, t.ty) : occForTile;
            if (!canPlaceOnTile({
                ...occ,
                tx: t.tx,
                ty: t.ty
            })) return false;
        }
        return true;
    }

    function isSleepThing(thingDef, entry) {
        if (thingDef?.sleep) return true;
        return Array.isArray(entry?.occupants) && !thingDef?.storage && !thingDef?.craftStation;
    }

    function sleepSlotCount(thingDef, entry) {
        const n = Math.floor(Number(thingDef?.sleep?.slots) || 0);
        if (Array.isArray(entry?.occupants) && entry.occupants.length) return entry.occupants.length;
        return n > 0 ? n : 2;
    }

    function ensureSleepEntry(entry, thingDef) {
        if (!entry) return entry;
        entry.rot = normalizeRot(entry.rot);
        const n = Math.max(1, sleepSlotCount(thingDef, entry));
        if (!Array.isArray(entry.occupants)) entry.occupants = emptySlots(n);
        while (entry.occupants.length < n) entry.occupants.push(null);
        if (entry.occupants.length > n) entry.occupants.length = n;
        if (!entry.uid) {
            entry.uid = `sl_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        const ts = 16;
        if (!Number.isInteger(entry.tx) || !Number.isInteger(entry.ty)) {
            const o = originTileOf(entry, ts);
            entry.tx = o.tx;
            entry.ty = o.ty;
        }
        return entry;
    }

    function emptySlots(count) {
        const n = Math.max(0, Math.floor(Number(count) || 0));
        return Array.from({ length: n }, () => null);
    }

    function storageSlotCount(thingDef, entry) {
        const fromDef = Math.floor(Number(thingDef?.storage?.slots) || 0);
        const fromEntry = Array.isArray(entry?.slots) ? entry.slots.length : 0;
        if (fromDef > 0) return Math.max(fromDef, fromEntry);
        return fromEntry;
    }

    /** Basket 8 → 2×4; drying rack 1 → single slot. */
    function storageLayoutCols(n) {
        const count = Math.max(1, Math.floor(Number(n) || 1));
        return Math.min(4, count);
    }

    function ensureStorageEntry(entry, thingDef) {
        if (!entry) return entry;
        const n = Math.max(1, storageSlotCount(thingDef, entry) || Math.floor(Number(thingDef?.storage?.slots) || 6));
        if (!Array.isArray(entry.slots)) entry.slots = emptySlots(n);
        while (entry.slots.length < n) entry.slots.push(null);
        if (entry.slots.length > n) entry.slots.length = n;
        entry.rot = normalizeRot(entry.rot);
        if (!entry.uid) {
            entry.uid = `st_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        return entry;
    }

    function isStorageEmpty(entry) {
        const slots = entry?.slots;
        if (!Array.isArray(slots)) return true;
        return slots.every((s) => !s || !(s.quantity > 0));
    }

    function isStorageThing(thingDef, entry) {
        if (thingDef?.storage) return true;
        return Array.isArray(entry?.slots);
    }

    function itemIdForThing(thingId, items) {
        if (!thingId) return null;
        if (items && typeof items.get === "function") {
            for (const meta of items.values()) {
                if (meta?.place?.thing === thingId) return meta.id;
            }
            if (items.get(thingId)) return thingId;
        } else if (Array.isArray(items)) {
            for (const meta of items) {
                if (meta?.place?.thing === thingId) return meta.id;
            }
        }
        return thingId;
    }

    /**
     * Shift-click deposit plan: fill matching stacks first, then empty slots.
     * @returns {{ index: number, amount: number }[]}
     */
    function planStorageDeposits(slots, stack, want, opts = {}) {
        if (!stack?.id || !Array.isArray(slots)) return [];
        const qty = Math.max(0, Math.floor(Number(stack.quantity) || 0));
        let remaining = Math.min(qty, Math.max(0, Math.floor(Number(want) || 0)));
        if (!(remaining > 0)) return [];
        const maxStack = Math.max(1, Math.floor(Number(opts.maxStack) || 1));
        const slotMax = Math.max(0, Math.floor(Number(opts.slotMax) || 0));
        const cap = slotMax > 0 ? Math.min(maxStack, slotMax) : maxStack;
        const special = !!opts.special;
        const destSpecial = typeof opts.destSpecial === "function" ? opts.destSpecial : null;
        const plan = [];

        if (!special) {
            for (let i = 0; i < slots.length && remaining > 0; i++) {
                const dest = slots[i];
                if (!dest || dest.id !== stack.id) continue;
                if (destSpecial?.(dest, i)) continue;
                const have = Math.max(0, Math.floor(Number(dest.quantity) || 0));
                const space = Math.max(0, cap - have);
                if (!(space > 0)) continue;
                const take = Math.min(space, remaining);
                plan.push({ index: i, amount: take });
                remaining -= take;
            }
        }
        for (let i = 0; i < slots.length && remaining > 0; i++) {
            if (slots[i]) continue;
            const take = Math.min(cap, remaining);
            if (!(take > 0)) continue;
            plan.push({ index: i, amount: take });
            remaining -= take;
        }
        return plan;
    }

    function parseSlotIndex(slotKey, slotCount) {
        const n = Math.max(0, Math.floor(Number(slotCount) || 0));
        let idx;
        if (typeof slotKey === "number") idx = slotKey;
        else {
            const s = String(slotKey || "");
            const m = s.match(/(\d+)\s*$/);
            idx = m ? parseInt(m[1], 10) : parseInt(s, 10);
        }
        if (!Number.isInteger(idx) || idx < 0 || (n > 0 && idx >= n)) return -1;
        return idx;
    }

    return {
        BLOCKED,
        placeThingId,
        normalizeRot,
        rotateCW,
        rotateCCW,
        rotationTextureKey,
        rotationFrameTextureKey,
        thingImageLoads,
        canRotate,
        isCraftStation,
        isSettlementThing,
        countsAsThing,
        ensureSettlementEntry,
        itemIconKey,
        ensureCraftStationEntry,
        inPlaceRange,
        entryOnTile,
        canPlaceOnTile,
        canPlaceOnTiles,
        footprintSize,
        originTileOf,
        interactOffset,
        rotateTileDelta,
        interactTileOf,
        interactWorldPos,
        occupyTiles,
        placeOccupyTiles,
        footprintTiles,
        footprintWorldPos,
        entryFootprintTiles,
        footprintWorldRect,
        hitboxWH,
        collisionWorldRect,
        isSleepThing,
        sleepSlotCount,
        ensureSleepEntry,
        emptySlots,
        storageSlotCount,
        storageLayoutCols,
        ensureStorageEntry,
        isStorageEmpty,
        isStorageThing,
        itemIdForThing,
        planStorageDeposits,
        parseSlotIndex
    };
});
