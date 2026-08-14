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

    /**
     * Walk collision in world pixels. 1×1 things: hs×hs at the feet.
     * Sleep: the full footprint (walk around, rest-walk still phases in).
     * Other multi-tile: a strip `hitboxSize` thick on the closed side.
     */
    function collisionWorldRect(entry, thingDef, tileSize) {
        const ts = Number(tileSize) || 16;
        const hs = Number(thingDef?.hitboxSize);
        if (!(hs > 0) || !entry || entry.gone) return null;
        const fp = footprintSize(thingDef);
        if (fp[0] <= 1 && fp[1] <= 1) {
            const x = Number(entry.x) || 0;
            const y = Number(entry.y) || 0;
            const hx = hs * 0.5;
            return { left: x - hx, right: x + hx, top: y - hs, bottom: y };
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
        const left = minTx * ts;
        const right = (maxTx + 1) * ts;
        const top = minTy * ts;
        const bottom = (maxTy + 1) * ts;
        if (thingDef?.sleep) {
            const r = normalizeRot(entry.rot);
            const along = (r === 0 || r === 180) ? (right - left) : (bottom - top);
            const pad = Math.min(4, Math.max(0, Math.floor((along - 8) / 2)));
            if (r === 0 || r === 180) {
                return { left: left + pad, right: right - pad, top, bottom };
            }
            return { left, right, top: top + pad, bottom: bottom - pad };
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
        if (thingDef && (footprintSize(thingDef)[0] > 1 || footprintSize(thingDef)[1] > 1)) {
            return entryFootprintTiles(entry, ts, thingDef).some((t) => t.tx === tx && t.ty === ty);
        }
        const etx = Math.floor(Number(entry.x) / ts);
        const ety = Math.floor((Number(entry.y) - 1) / ts);
        return etx === tx && ety === ty;
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
        if (Array.isArray(entry?.slots) && entry.slots.length) return entry.slots.length;
        return fromDef > 0 ? fromDef : 0;
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
        itemIconKey,
        ensureCraftStationEntry,
        inPlaceRange,
        entryOnTile,
        canPlaceOnTile,
        canPlaceOnTiles,
        footprintSize,
        originTileOf,
        footprintTiles,
        footprintWorldPos,
        entryFootprintTiles,
        collisionWorldRect,
        isSleepThing,
        sleepSlotCount,
        ensureSleepEntry,
        emptySlots,
        storageSlotCount,
        ensureStorageEntry,
        isStorageEmpty,
        isStorageThing,
        itemIdForThing,
        parseSlotIndex
    };
});
