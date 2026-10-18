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
    const _maskBytes = new Map();
    const _wallBoxCache = new WeakMap();

    function placeThingId(itemDef) {
        const id = itemDef?.place?.thing;
        return typeof id === "string" && id ? id : null;
    }

    function isFigurineThing(thingDef, entry) {
        return !!(thingDef?.figurine || thingDef?.id === "clay_figurine" || entry?.id === "clay_figurine");
    }

    /** Sculptures and unclassified lumps. Raw clay has no figurine stack. */
    function canPlaceFigurine(held) {
        const cls = String(held?.formClass || "");
        return cls === "" || cls === "lump" || cls === "animal" || cls === "human" || cls === "deity";
    }

    function heldPlaceThingId(itemDef, held) {
        const id = placeThingId(itemDef);
        if (id === "clay_figurine" || held?.id === "clay_figurine") {
            return canPlaceFigurine(held) ? "clay_figurine" : null;
        }
        return id;
    }

    function ensureFigurineEntry(entry) {
        if (!entry) return entry;
        entry.rot = normalizeRot(entry.rot);
        if (!entry.uid) {
            entry.uid = `fg_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        return entry;
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
        if (t?.figurine) return [];
        if (!t?.key) return [];
        if (t.floor && t.wall) {
            return [
                { key: t.floor, path: `assets/things/${t.key}/${t.floor}.png` },
                { key: t.wall, path: `assets/things/${t.key}/${t.wall}.png` }
            ];
        }
        // Recolored variant art (the grindstone) stays in one drawing. It lists
        // rotations so the stand tile can turn, and does not ship 0/90/180/270 frames.
        const variantArt = Array.isArray(t.variants) && t.variants.length;
        if (Array.isArray(t.rotations) && t.rotations.length && !variantArt) {
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
        if (Array.isArray(t.variants) && t.variants.length) {
            const loads = [];
            const seen = new Set();
            const dir = t.variantDir ? `${t.variantDir}/` : "";
            for (const raw of t.variants) {
                const key = String(raw || "");
                if (!key || seen.has(key)) continue;
                seen.add(key);
                loads.push({ key, path: `assets/things/${dir}${key}.png` });
            }
            return loads;
        }
        if (t.anim) {
            const loads = [{
                key: t.key,
                path: `assets/things/${t.key}.png`,
                spritesheet: true,
                frameWidth: t.anim.frameWidth ?? 16,
                frameHeight: t.anim.frameHeight ?? 16
            }];
            return loads;
        }
        const loads = [{ key: t.key, path: `assets/things/${t.key}.png` }];
        if (t.dryingRack) {
            const hangKey = t.hangingKey || `${t.key}_hanging`;
            loads.push({ key: hangKey, path: `assets/things/${hangKey}.png` });
        }
        if (t.diggable?.item || t.id === "storage_pit") {
            loads.push({ key: "hole", path: "assets/things/hole.png" });
        }
        return loads;
    }

    function canRotate(thingDef) {
        if (isFigurineThing(thingDef)) return true;
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
     * Missing art uses `null`.
     */
    function itemIconKey(itemDef, getThing, hasTexture) {
        const pick = (key) => {
            if (!key) return "";
            if (typeof hasTexture !== "function") return key;
            return hasTexture(key) ? key : "";
        };
        const fallback = itemDef?.key || itemDef?.id || "";
        const owned = pick(fallback);
        if (owned) return owned;
        const thingId = placeThingId(itemDef);
        if (thingId) {
            const thingDef = typeof getThing === "function" ? getThing(thingId) : getThing;
            if (canRotate(thingDef) && thingDef.key) {
                const rot = pick(rotationTextureKey(thingDef.key, 0));
                if (rot) return rot;
            }
        }
        return pick("null") || fallback;
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
        if (fw > 1 && fh > 1) {
            const tiles = [];
            for (let iy = 0; iy < fh; iy++) {
                for (let ix = 0; ix < fw; ix++) {
                    const d = rotateTileDelta(ix, -iy, r);
                    tiles.push({ tx: tx + d.dx, ty: ty + d.dy });
                }
            }
            return tiles;
        }
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
     * Horizontal lean-to (rot 0 / 180). The thatch is drawn north of the posts,
     * so a full-tile box stops you at the eave. This pulls the north edge south
     * enough to stand slightly under the roof. The frame sprite sorts at the
     * shelter's feet, above anyone tucked into that lip. The south edge stays
     * flush — that side is the posts and the opening.
     */
    const SLEEP_HORIZONTAL_NORTH_SLACK = 6;

    /**
     * Walk collision in world pixels.
     * 1×1: hs×hs at the feet, or a rotation-aware AABB from `hitbox`.
     * Sleep 90/270: footprint minus the open/bedding side (walk onto the laying spot).
     * Sleep 0/180: the footprint, with the north edge inset under the roof.
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
            // Horizontal frames face the camera: roof to the north, posts at
            // the south. Inset only the north edge so you can tuck under the
            // thatch; the frame sprite draws above that overlap.
            if (r === 0 || r === 180) {
                const slack = Math.min(
                    SLEEP_HORIZONTAL_NORTH_SLACK,
                    Math.max(0, bottom - top - 4)
                );
                return { left, right, top: top + slack, bottom };
            }
            const along = bottom - top;
            const pad = Math.min(2, Math.max(0, Math.floor((along - 12) / 2)));
            top += pad;
            bottom -= pad;
            const cross = right - left;
            const wall = Math.max(3, Math.min(hs, cross - 1));
            const want = Number(thingDef.sleep.openInset);
            const open = Math.min(
                Math.max(0, Number.isFinite(want) ? want : Math.floor(ts * 0.5)),
                Math.max(0, cross - wall)
            );
            if (r === 90) left += open;
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

    /** Feet anchor of a placed sprite: bottom-center of its footprint. */
    function spriteAnchor(entry, thingDef, tileSize) {
        const ts = Number(tileSize) || 16;
        if (!entry) return { x: 0, y: 0 };
        const origin = originTileOf(entry, ts);
        return footprintWorldPos(
            origin.tx, origin.ty, entry.rot, footprintSize(thingDef), ts
        );
    }

    /**
     * Rotate an offset from the sprite anchor (bottom-center) clockwise on
     * screen. The pivot is the sprite center, 16px north of the anchor.
     */
    function rotateAnchorOffset(dx, dy, rot, spriteSize) {
        const s = Number(spriteSize) || 32;
        const r = normalizeRot(rot);
        let x = Number(dx) || 0;
        let y = (Number(dy) || 0) + s * 0.5;
        if (r === 90) {
            const nx = -y;
            y = x;
            x = nx;
        } else if (r === 180) {
            x = -x;
            y = -y;
        } else if (r === 270) {
            const nx = y;
            y = -x;
            x = nx;
        }
        return { dx: x, dy: y - s * 0.5 };
    }

    function decodeMask(b64) {
        const key = String(b64 || "");
        const hit = _maskBytes.get(key);
        if (hit) return hit;
        let bytes;
        if (typeof Buffer !== "undefined") {
            bytes = Uint8Array.from(Buffer.from(key, "base64"));
        } else {
            const bin = atob(key);
            bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        }
        _maskBytes.set(key, bytes);
        return bytes;
    }

    /** Opaque bit of a row-major MSB-first mask. */
    function wallMaskSolid(mask, x, y, size) {
        const s = Number(size) || 32;
        if (x < 0 || y < 0 || x >= s || y >= s) return false;
        const bytes = decodeMask(mask);
        const i = y * s + x;
        const byte = bytes[i >> 3];
        if (byte == null) return false;
        return ((byte >> (7 - (i & 7))) & 1) === 1;
    }

    /**
     * Inverse of rotateAnchorOffset. Sprite pixel under a world point.
     */
    function worldToSpritePixel(entry, thingDef, wx, wy, tileSize) {
        const anchor = spriteAnchor(entry, thingDef, tileSize);
        const s = Number(thingDef?.spriteSize) || 32;
        const rot = normalizeRot(entry?.rot);
        const rx = (Number(wx) || 0) - anchor.x;
        const ry = (Number(wy) || 0) - anchor.y + s * 0.5;
        let sx = rx;
        let sy = ry;
        if (rot === 90) {
            sx = ry;
            sy = -rx;
        } else if (rot === 180) {
            sx = -rx;
            sy = -ry;
        } else if (rot === 270) {
            sx = -ry;
            sy = rx;
        }
        return { x: sx + s * 0.5, y: sy + s * 0.5 };
    }

    /**
     * The doorway plus one step outside it. Path padding may overlap the
     * jambs here. The rest of an interior wall stays solid.
     */
    function inDoorApproach(entry, thingDef, wx, wy, tileSize) {
        const d = thingDef?.doorClear;
        if (!d || !entry) return false;
        const s = Number(thingDef.spriteSize) || 32;
        const p = worldToSpritePixel(entry, thingDef, wx, wy, tileSize);
        const x0 = Number(d.x) || 0;
        const x1 = x0 + (Number(d.w) || 0);
        const y0 = (Number(d.y) || 0) - 8;
        const y1 = s + 8;
        return p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1;
    }

    function doorClearsPixel(thingDef, x, y) {
        const d = thingDef?.doorClear;
        if (!d) return false;
        const dx = Number(d.x) || 0;
        const dy = Number(d.y) || 0;
        const dw = Number(d.w) || 0;
        const dh = Number(d.h) || 0;
        return x >= dx && x < dx + dw && y >= dy && y < dy + dh;
    }

    /** Greedy horizontal runs, merged with the run directly above. */
    function meshAlphaBoxes(width, height, solidAt) {
        const w = Math.max(1, Math.floor(Number(width) || 1));
        const h = Math.max(1, Math.floor(Number(height) || 1));
        const boxes = [];
        let active = new Map();
        for (let y = 0; y < h; y++) {
            const next = new Map();
            let x = 0;
            while (x < w) {
                if (!solidAt(x, y)) {
                    x++;
                    continue;
                }
                let x1 = x + 1;
                while (x1 < w && solidAt(x1, y)) x1++;
                const rw = x1 - x;
                const key = `${x},${rw}`;
                const prev = active.get(key);
                if (prev && prev.y + prev.h === y) {
                    prev.h += 1;
                    next.set(key, prev);
                } else {
                    const box = { x, y, w: rw, h: 1 };
                    boxes.push(box);
                    next.set(key, box);
                }
                x = x1;
            }
            active = next;
        }
        return boxes;
    }

    /**
     * A round wall with a wedge cut out for the door. Coarse arc boxes, not
     * the thatch pixels, so walking the ring does not snag on every sprite.
     */
    function ringBoxesFor(thingDef) {
        const ring = thingDef?.ring;
        if (!ring) return null;
        const hit = _wallBoxCache.get(ring);
        if (hit) return hit;
        const cx = Number(ring.cx) || 0;
        const cy = Number(ring.cy) || 0;
        const inner = Number(ring.inner) || 0;
        const outer = Number(ring.outer) || 0;
        const door = Array.isArray(ring.door) ? ring.door : [0, 0];
        const d0 = (Number(door[0]) || 0) * Math.PI / 180;
        const d1 = (Number(door[1]) || 0) * Math.PI / 180;
        const two = Math.PI * 2;
        const norm = (a) => ((a % two) + two) % two;
        const a0 = norm(d0);
        const a1 = norm(d1);
        const inDoor = (a) => {
            const x = norm(a);
            if (a0 <= a1) return x >= a0 && x <= a1;
            return x >= a0 || x <= a1;
        };
        const step = 10 * Math.PI / 180;
        const boxes = [];
        for (let a = 0; a < two - 1e-8; a += step) {
            const aEnd = Math.min(a + step, two);
            if (inDoor(a + 0.002) || inDoor(aEnd - 0.002) || inDoor((a + aEnd) * 0.5)) continue;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let i = 0; i <= 4; i++) {
                const ang = a + (aEnd - a) * (i / 4);
                for (let r = inner; r <= outer; r += Math.max(1, (outer - inner) * 0.5)) {
                    const x = cx + Math.cos(ang) * r;
                    const y = cy + Math.sin(ang) * r;
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
            if (!(maxX > minX) || !(maxY > minY)) continue;
            boxes.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
        }
        _wallBoxCache.set(ring, boxes);
        return boxes;
    }

    /** World-space ring for a placed hut, door angles included. */
    function ringWorld(entry, thingDef, tileSize) {
        const ring = thingDef?.ring;
        if (!ring || !entry) return null;
        const s = Number(thingDef.spriteSize) || 32;
        const anchor = spriteAnchor(entry, thingDef, tileSize);
        const off = rotateAnchorOffset(
            (Number(ring.cx) || 0) - s * 0.5,
            (Number(ring.cy) || 0) - s,
            entry.rot,
            s
        );
        const rot = normalizeRot(entry.rot) * Math.PI / 180;
        const door = Array.isArray(ring.door) ? ring.door : [0, 0];
        return {
            cx: anchor.x + off.dx,
            cy: anchor.y + off.dy,
            inner: Number(ring.inner) || 0,
            outer: Number(ring.outer) || 0,
            door0: (Number(door[0]) || 0) * Math.PI / 180 + rot,
            door1: (Number(door[1]) || 0) * Math.PI / 180 + rot
        };
    }

    function _angleInDoor(a, door0, door1) {
        const two = Math.PI * 2;
        const norm = (v) => ((v % two) + two) % two;
        const x = norm(a);
        const a0 = norm(door0);
        const a1 = norm(door1);
        if (a0 <= a1) return x >= a0 && x <= a1;
        return x >= a0 || x <= a1;
    }

    /** True when a point sits in the solid part of a round wall. */
    function ringWallAt(ring, x, y) {
        if (!ring) return false;
        const dx = x - ring.cx;
        const dy = y - ring.cy;
        const r = Math.hypot(dx, dy);
        if (r < ring.inner || r > ring.outer) return false;
        return !_angleInDoor(Math.atan2(dy, dx), ring.door0, ring.door1);
    }

    /**
     * Keep a ground spill on the side of a hut wall it started on. `margin`
     * is the drawn radius, so the pool itself cannot cross the thatch. The
     * doorway stays open. A start already embedded in the wall still counts
     * as inside.
     */
    function clipSpill(fromX, fromY, toX, toY, rings, margin) {
        let x1 = Number(toX) || 0;
        let y1 = Number(toY) || 0;
        const x0 = Number(fromX) || 0;
        const y0 = Number(fromY) || 0;
        const pad = Math.max(0, Number(margin) || 0);
        const list = rings || [];
        for (let i = 0; i < list.length; i++) {
            const ring = list[i];
            if (!ring) continue;
            const held = _clipSpillRing(ring, x0, y0, x1, y1, pad);
            x1 = held.x;
            y1 = held.y;
        }
        return { x: x1, y: y1 };
    }

    function _clipSpillRing(ring, x0, y0, x1, y1, pad) {
        const dx = x1 - ring.cx;
        const dy = y1 - ring.cy;
        const r = Math.hypot(dx, dy);
        const pr = Math.hypot(x0 - ring.cx, y0 - ring.cy);
        const ang = r > 0.001
            ? Math.atan2(dy, dx)
            : Math.atan2(y0 - ring.cy, x0 - ring.cx);
        if (_angleInDoor(ang, ring.door0, ring.door1)) return { x: x1, y: y1 };
        if (pr <= ring.outer) {
            const limit = ring.inner - pad - 0.05;
            if (!(r > limit)) return { x: x1, y: y1 };
            const keep = Math.max(0, limit);
            return {
                x: ring.cx + Math.cos(ang) * keep,
                y: ring.cy + Math.sin(ang) * keep
            };
        }
        const limit = ring.outer + pad + 0.05;
        if (!(r < limit)) return { x: x1, y: y1 };
        return {
            x: ring.cx + Math.cos(ang) * limit,
            y: ring.cy + Math.sin(ang) * limit
        };
    }

    /**
     * Keep a pawn center from crossing a round wall. A step that starts inside
     * stays inside; one that starts outside stays outside. The doorway is open.
     * A long jump is a teleport and is left alone.
     */
    function clampRingCenter(ring, fromX, fromY, toX, toY, radius) {
        const x1 = Number(toX) || 0;
        const y1 = Number(toY) || 0;
        if (!ring) return { x: x1, y: y1 };
        const x0 = Number(fromX) || 0;
        const y0 = Number(fromY) || 0;
        if (Math.hypot(x1 - x0, y1 - y0) > 24) return { x: x1, y: y1 };
        const dx = x1 - ring.cx;
        const dy = y1 - ring.cy;
        const r = Math.hypot(dx, dy);
        const pdx = x0 - ring.cx;
        const pdy = y0 - ring.cy;
        const pr = Math.hypot(pdx, pdy);
        const rad = Math.max(0, Number(radius) || 0);
        const skin = 0.15;
        const ang = r > 0.001 ? Math.atan2(dy, dx) : Math.atan2(pdy, pdx);
        if (_angleInDoor(ang, ring.door0, ring.door1)) return { x: x1, y: y1 };
        const mid = (ring.inner + ring.outer) * 0.5;
        if (pr <= mid) {
            const keep = Math.max(0, ring.inner - rad - skin);
            if (!(r > keep)) return { x: x1, y: y1 };
            return { x: ring.cx + Math.cos(ang) * keep, y: ring.cy + Math.sin(ang) * keep };
        }
        const keep = ring.outer + rad + skin;
        if (!(r < keep)) return { x: x1, y: y1 };
        return { x: ring.cx + Math.cos(ang) * keep, y: ring.cy + Math.sin(ang) * keep };
    }

    function _spritePixelWorld(entry, thingDef, tileSize, px, py) {
        const s = Number(thingDef?.spriteSize) || 32;
        const anchor = spriteAnchor(entry, thingDef, tileSize);
        const off = rotateAnchorOffset(px - s * 0.5, py - s, entry?.rot, s);
        return { x: anchor.x + off.dx, y: anchor.y + off.dy };
    }

    /** True when a disk covers any thatch pixel. The doorway hole stays clear. */
    function wallDiskHits(entry, thingDef, tileSize, wx, wy, pad) {
        const mask = thingDef?.wallMask;
        if (!mask || !entry) return false;
        const s = Number(thingDef.spriteSize) || 32;
        const p = worldToSpritePixel(entry, thingDef, wx, wy, tileSize);
        const rad = Math.max(0, Number(pad) || 0);
        const r = Math.ceil(rad);
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > rad * rad + 1e-6) continue;
                if (wallMaskSolid(mask, Math.floor(p.x + dx), Math.floor(p.y + dy), s)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Stop a spill where its disk would touch the thatch. A path through the
     * drawn doorway is left alone.
     */
    function clipWallSpill(entry, thingDef, tileSize, x0, y0, x1, y1, margin) {
        const dest = { x: Number(x1) || 0, y: Number(y1) || 0 };
        if (!thingDef?.wallMask || !entry) return dest;
        const pad = Math.max(0, Number(margin) || 0);
        const blocked = (x, y) => wallDiskHits(entry, thingDef, tileSize, x, y, pad);
        const s = Number(thingDef.spriteSize) || 32;
        const c = _spritePixelWorld(entry, thingDef, tileSize, s * 0.5, s * 0.5);
        let sx = Number(x0) || 0;
        let sy = Number(y0) || 0;
        // A sleeper's body-center shift sits a few pixels outside the thatch.
        // Pull that back inside. Someone actually standing outside is farther.
        if (!blocked(sx, sy)) {
            const cdx = c.x - sx;
            const cdy = c.y - sy;
            const cd = Math.hypot(cdx, cdy);
            if (cd > 1) {
                const n = Math.ceil(cd);
                let saw = false;
                let shallow = false;
                for (let i = 1; i <= n; i++) {
                    const t = i / n;
                    const x = sx + cdx * t;
                    const y = sy + cdy * t;
                    const onThatch = wallDiskHits(entry, thingDef, tileSize, x, y, 0);
                    if (onThatch) saw = true;
                    else if (saw && !shallow) {
                        shallow = Math.hypot(x - sx, y - sy) <= 7;
                        if (!shallow) break;
                    }
                    if (shallow && !blocked(x, y)) {
                        sx = x;
                        sy = y;
                        break;
                    }
                }
            }
        } else {
            const cdx = c.x - sx;
            const cdy = c.y - sy;
            const cd = Math.hypot(cdx, cdy) || 1;
            const n = Math.max(1, Math.ceil(cd));
            for (let i = 1; i <= n; i++) {
                const t = i / n;
                const x = sx + cdx * t;
                const y = sy + cdy * t;
                if (!blocked(x, y)) {
                    sx = x;
                    sy = y;
                    break;
                }
            }
        }
        const dx = dest.x - sx;
        const dy = dest.y - sy;
        const dist = Math.hypot(dx, dy);
        if (!(dist > 0.01)) return { x: sx, y: sy };
        const steps = Math.max(2, Math.ceil(dist));
        let prevX = sx;
        let prevY = sy;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = sx + dx * t;
            const y = sy + dy * t;
            if (blocked(x, y)) return { x: prevX, y: prevY };
            prevX = x;
            prevY = y;
        }
        return dest;
    }

    function wallBoxesFor(thingDef) {
        if (!thingDef?.wallMask) return null;
        const hit = _wallBoxCache.get(thingDef);
        if (hit) return hit;
        const size = Number(thingDef.spriteSize) || 32;
        const boxes = meshAlphaBoxes(size, size, (x, y) => {
            if (doorClearsPixel(thingDef, x, y)) return false;
            return wallMaskSolid(thingDef.wallMask, x, y, size);
        });
        _wallBoxCache.set(thingDef, boxes);
        return boxes;
    }

    function wallBoxWorldRect(box, anchor, rot, spriteSize) {
        const s = Number(spriteSize) || 32;
        const corners = [
            [box.x, box.y],
            [box.x + box.w, box.y],
            [box.x, box.y + box.h],
            [box.x + box.w, box.y + box.h]
        ];
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        for (let i = 0; i < corners.length; i++) {
            const off = rotateAnchorOffset(
                corners[i][0] - s * 0.5,
                corners[i][1] - s,
                rot,
                s
            );
            const wx = anchor.x + off.dx;
            const wy = anchor.y + off.dy;
            if (wx < left) left = wx;
            if (wx > right) right = wx;
            if (wy < top) top = wy;
            if (wy > bottom) bottom = wy;
        }
        return { left, right, top, bottom };
    }

    /**
     * Walk blockers. A wall mask becomes one rect per meshed run so the
     * interior and doorway stay open. Other things stay a single rect.
     */
    function collisionWorldRects(entry, thingDef, tileSize) {
        const boxes = ringBoxesFor(thingDef) || wallBoxesFor(thingDef);
        if (boxes && boxes.length && entry && !entry.gone) {
            const anchor = spriteAnchor(entry, thingDef, tileSize);
            const size = Number(thingDef.spriteSize) || 32;
            const rot = entry.rot;
            const out = [];
            for (let i = 0; i < boxes.length; i++) {
                out.push(wallBoxWorldRect(boxes[i], anchor, rot, size));
            }
            return out;
        }
        const one = collisionWorldRect(entry, thingDef, tileSize);
        return one ? [one] : [];
    }

    function entryOnTile(entry, tx, ty, tileSize, thingDef) {
        if (!entry || entry.gone) return false;
        const ts = Number(tileSize) || 16;
        return occupyTiles(entry, ts, thingDef).some((t) => t.tx === tx && t.ty === ty);
    }

    function isStoragePit(thingDef, entry) {
        return thingDef?.id === "storage_pit" || entry?.id === "storage_pit";
    }

    function pitFinished(entry) {
        return (Number(entry?.digProgress) || 0) >= 1 - 1e-6;
    }

    /** Hover label for a pit that still needs digging. Null once it is finished. */
    function pitBlueprintTooltip(thingDef, entry) {
        if (!isStoragePit(thingDef, entry) || pitFinished(entry)) return null;
        const name = thingDef?.name || "Storage Pit";
        return `${name} (Blueprint)\nRequires digging to complete`;
    }

    /** Grass and grass hills yield dirt. Snow and snow hills yield snow. */
    function pitFillForTile(tileKey) {
        if (tileKey === "snow" || tileKey === "snow_hill") return "snow";
        if (tileKey === "grass" || tileKey === "grass_hill") return "dirt";
        return null;
    }

    function tileAllowsThing(thingDef, tileKey) {
        const tiles = thingDef?.placeTiles;
        if (!Array.isArray(tiles) || !tiles.length) return true;
        return tiles.indexOf(tileKey) >= 0;
    }

    /** Finished pits keep food for twice as long. Unfinished pits do not. */
    function pitSlowsSpoil(thingDef, entry) {
        if (!isStoragePit(thingDef, entry) || !pitFinished(entry)) return false;
        const scale = Number(thingDef?.storage?.spoilScale);
        return scale > 0 && scale < 1;
    }

    function canPlaceOnTile(opts) {
        const tileKey = opts?.tileKey;
        if (!tileKey || BLOCKED[tileKey]) return false;
        if (opts.placeDef && !tileAllowsThing(opts.placeDef, tileKey)) return false;
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
        if (fromDef > 0) return fromDef;
        return Array.isArray(entry?.slots) ? entry.slots.length : 0;
    }

    /** Basket 8 → 2×4; pit 6 → 2×3; drying rack 1 → single slot. */
    function storageLayoutCols(n) {
        const count = Math.max(1, Math.floor(Number(n) || 1));
        if (count > 4 && count % 3 === 0 && count % 4 !== 0) return 3;
        return Math.min(4, count);
    }

    /**
     * Cut slots down to n. Stacks past the cap fill empty holes first.
     * Whatever still does not fit is returned so the caller can drop it.
     */
    function ejectExtraSlots(entry, n) {
        if (!Array.isArray(entry?.slots) || entry.slots.length <= n) return [];
        const extra = [];
        for (let i = n; i < entry.slots.length; i++) {
            const stack = entry.slots[i];
            if (stack && !(stack.quantity <= 0)) extra.push(stack);
        }
        entry.slots.length = n;
        const ejected = [];
        for (const stack of extra) {
            const hole = entry.slots.findIndex((s) => !s || s.quantity <= 0);
            if (hole >= 0) entry.slots[hole] = stack;
            else ejected.push(stack);
        }
        return ejected;
    }

    function ensureStorageEntry(entry, thingDef) {
        if (!entry) return entry;
        const n = Math.max(1, storageSlotCount(thingDef, entry) || Math.floor(Number(thingDef?.storage?.slots) || 6));
        if (!Array.isArray(entry.slots)) entry.slots = emptySlots(n);
        const ejected = ejectExtraSlots(entry, n);
        if (ejected.length) entry.ejected = (entry.ejected || []).concat(ejected);
        while (entry.slots.length < n) entry.slots.push(null);
        entry.rot = normalizeRot(entry.rot);
        if (!entry.uid) {
            entry.uid = `st_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        // A missing filter on a pit is the perishable default. An explicit
        // object, including Set All, is the player's choice and stays put.
        if (thingDef?.id === "storage_pit" || entry.id === "storage_pit") {
            const SF = storageFilterApi();
            const items = loadedItemDefs();
            const fresh = SF?.perishableDefault && items ? SF.perishableDefault(items) : null;
            if (fresh && entry.storageFilter == null) entry.storageFilter = fresh;
            else if (fresh && isPriorPerishableDefault(entry.storageFilter, fresh)) {
                entry.storageFilter.priority = fresh.priority;
            }
        }
        return entry;
    }

    function storageFilterApi() {
        if (typeof StorageFilter !== "undefined") return StorageFilter;
        if (typeof require === "function") {
            try { return require("./storageFilter"); } catch (_) { return null; }
        }
        return null;
    }

    function sameIdSet(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        const set = new Set(a);
        return b.every((id) => set.has(id));
    }

    /** The first pit default used Normal. Lift that exact filter to Preferred. */
    function isPriorPerishableDefault(filter, fresh) {
        if (!filter || filter.priority !== "normal") return false;
        return sameIdSet(filter.offCategories, fresh.offCategories)
            && sameIdSet(filter.offItems, fresh.offItems)
            && sameIdSet(filter.onItems, fresh.onItems);
    }

    function loadedItemDefs() {
        let DS = typeof DataStore !== "undefined" ? DataStore : null;
        if (!DS && typeof require === "function") {
            try { DS = require("./DataStore"); } catch (_) { DS = null; }
        }
        const list = DS?._store?.itemsList;
        return Array.isArray(list) ? list.filter(Boolean) : null;
    }

    function isStorageEmpty(entry) {
        const slots = entry?.slots;
        if (!Array.isArray(slots)) return true;
        return slots.every((s) => !s || !(s.quantity > 0));
    }

    /**
     * Hover-tip view of a container. Slots are read left to right, top to
     * bottom (index 0 is the top-left cell). Stacks the game treats as the
     * same item become one icon at the cell where that item first appears,
     * and the quantity is the sum, past a full stack of 99.
     * Copies only — the stored slots stay separate.
     */
    function storageTooltipStacks(slots, slotCount) {
        const list = Array.isArray(slots) ? slots : [];
        const limit = slotCount == null
            ? list.length
            : Math.max(0, Math.floor(Number(slotCount) || 0));
        const SF = storageFilterApi();
        const match = typeof SF?.stacksMatch === "function"
            ? (a, b) => SF.stacksMatch(a, b)
            : (a, b) => !!(a?.id && a.id === b?.id);
        const out = [];
        for (let i = 0; i < limit; i++) {
            const s = list[i];
            if (!s?.id) continue;
            const qty = s.quantity == null ? 1 : Math.floor(Number(s.quantity) || 0);
            if (!(qty > 0)) continue;
            let dest = null;
            for (let j = 0; j < out.length; j++) {
                if (match(out[j], s)) {
                    dest = out[j];
                    break;
                }
            }
            if (!dest) {
                out.push(Object.assign({}, s, { quantity: qty }));
                continue;
            }
            dest.quantity += qty;
        }
        return out;
    }

    /** Combined stacks wrapped to the container's own row width. */
    function storageTooltipRows(slots, slotCount) {
        const n = slotCount == null
            ? (Array.isArray(slots) ? slots.length : 0)
            : Math.max(0, Math.floor(Number(slotCount) || 0));
        const items = storageTooltipStacks(slots, n);
        if (!items.length) return [];
        const cols = storageLayoutCols(Math.max(1, n));
        const rows = [];
        for (let i = 0; i < items.length; i += cols) {
            rows.push(items.slice(i, i + cols));
        }
        return rows;
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

    /** Pebbles and grindstones share a slot only when the stone matches. Blank is andesite. */
    function depositStonesMatch(dest, stack) {
        if (stack?.id !== "pebble" && stack?.id !== "grindstone") return true;
        let api = typeof Stone !== "undefined" ? Stone : null;
        if (!api && typeof require === "function") {
            try { api = require("./stone"); } catch (_) { api = null; }
        }
        if (typeof api?.sameStone === "function") return api.sameStone(dest, stack);
        return (dest?.stone || "andesite") === (stack?.stone || "andesite");
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
                if (!depositStonesMatch(dest, stack)) continue;
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
        heldPlaceThingId,
        canPlaceFigurine,
        isFigurineThing,
        ensureFigurineEntry,
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
        isStoragePit,
        pitFinished,
        pitBlueprintTooltip,
        pitFillForTile,
        tileAllowsThing,
        pitSlowsSpoil,
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
        collisionWorldRects,
        spriteAnchor,
        rotateAnchorOffset,
        worldToSpritePixel,
        inDoorApproach,
        ringWorld,
        ringWallAt,
        clipSpill,
        clipWallSpill,
        wallDiskHits,
        clampRingCenter,
        wallMaskSolid,
        doorClearsPixel,
        meshAlphaBoxes,
        isSleepThing,
        sleepSlotCount,
        ensureSleepEntry,
        emptySlots,
        storageSlotCount,
        storageLayoutCols,
        storageTooltipStacks,
        storageTooltipRows,
        ensureStorageEntry,
        isStorageEmpty,
        isStorageThing,
        itemIdForThing,
        planStorageDeposits,
        parseSlotIndex
    };
});
