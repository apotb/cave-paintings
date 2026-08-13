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
     * Rotated placeables use the 0° world sprite (`${thingKey}_0`).
     */
    function itemIconKey(itemDef, getThing) {
        const fallback = itemDef?.key || itemDef?.id || "";
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

    function entryOnTile(entry, tx, ty, tileSize) {
        if (!entry || entry.gone) return false;
        const ts = Number(tileSize) || 16;
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
        const lists = [opts.things, opts.lootables];
        for (const list of lists) {
            if (!Array.isArray(list)) continue;
            for (const e of list) {
                if (entryOnTile(e, tx, ty, ts)) return false;
            }
        }
        return true;
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
        thingImageLoads,
        canRotate,
        isCraftStation,
        itemIconKey,
        ensureCraftStationEntry,
        inPlaceRange,
        entryOnTile,
        canPlaceOnTile,
        emptySlots,
        storageSlotCount,
        ensureStorageEntry,
        isStorageEmpty,
        isStorageThing,
        itemIdForThing,
        parseSlotIndex
    };
});
