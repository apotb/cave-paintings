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
    const _frontStripCache = new Map();
    const _wallBoxCache = new WeakMap();
    const _figurineRectCache = new WeakMap();
    /** Walk solid is this tall, sitting on the feet. Wider obstacles still use hitboxSize. */
    const WALK_FEET_H = 4;
    const FIGURINE_CELL = 2;
    /** 3 of 4 columns. A one-pixel arm fills only half a cell. */
    const FIGURINE_FILL = 3;

    function formingApi() {
        if (typeof Forming !== "undefined" && Forming.unpack) return Forming;
        if (typeof require === "function") {
            try { return require("./forming"); } catch (_) { return null; }
        }
        return null;
    }

    /**
     * Feet-origin sprite. The solid is `hitboxSize` wide and a short strip
     * at the bottom, so walking up to something stops at the feet.
     */
    function walkBodyAt(x, y, width, height, hitboxSize) {
        const w = Number(width) > 0 ? Number(width) : 16;
        const hs = Number(hitboxSize) > 0 ? Number(hitboxSize) : 8;
        const feetH = Math.min(hs, WALK_FEET_H);
        const left = (Number(x) || 0) + (w - hs) * 0.5;
        const bottom = Number(y) || 0;
        return { left, right: left + hs, top: bottom - feetH, bottom };
    }

    /**
     * True when the feet strip covers a tile `pred(tx, ty)` accepts.
     * Pose (x, y) is the sprite's bottom-left, half a tile left of these
     * feet, so a point sample there counts as wading before the hitbox does.
     * A strip that ends exactly on a tile edge stays in the tile it stands on.
     */
    function walkBodyOverlapsTile(x, y, width, height, hitboxSize, tileSize, pred) {
        if (typeof pred !== "function") return false;
        const box = walkBodyAt(x, y, width, height, hitboxSize);
        const ts = Number(tileSize) > 0 ? Number(tileSize) : 16;
        const x0 = Math.floor(box.left / ts);
        const y0 = Math.floor(box.top / ts);
        const x1 = Math.floor((box.right - 1e-4) / ts);
        const y1 = Math.floor((box.bottom - 1e-4) / ts);
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                if (pred(tx, ty)) return true;
            }
        }
        return false;
    }

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

    function rotationFloorTextureKey(thingKey, rot) {
        return `${thingKey}_floor_${normalizeRot(rot)}`;
    }

    function rotationWallTextureKey(thingKey, rot) {
        return `${thingKey}_wall_${normalizeRot(rot)}`;
    }

    // A lean-to draws a floor and a wall for each facing. A hut bakes those
    // from one floor image and one wall image, so it stays on rotationTextureKey.
    function facingTextureKey(thingDef, rot) {
        const key = thingDef?.key || "";
        if (thingDef?.sleep && !(thingDef.floor && thingDef.wall)) {
            return rotationFloorTextureKey(key, rot);
        }
        return rotationTextureKey(key, rot);
    }

    // Folder is the thing. The file is the texture key with that prefix removed.
    function partFile(folder, textureKey) {
        const name = String(textureKey || "");
        const prefix = `${folder}_`;
        return name.startsWith(prefix) ? name.slice(prefix.length) : name;
    }

    function thingImageLoads(t) {
        if (t?.figurine) return [];
        if (!t?.key) return [];
        if (t.floor && t.wall) {
            return [
                { key: t.floor, path: `assets/things/${t.key}/${partFile(t.key, t.floor)}.png` },
                { key: t.wall, path: `assets/things/${t.key}/${partFile(t.key, t.wall)}.png` }
            ];
        }
        // Recolored variant art (the grindstone) and a drying rack stay in one
        // drawing. They list rotations so the stand tile can turn, and do not
        // ship 0/90/180/270 frames.
        const variantArt = Array.isArray(t.variants) && t.variants.length;
        const spotOnly = !!t.dryingRack;
        if (Array.isArray(t.rotations) && t.rotations.length && !variantArt && !spotOnly) {
            const loads = [];
            const seen = new Set();
            const shelter = !!(t.sleep && !(t.floor && t.wall));
            for (const raw of t.rotations) {
                const rot = normalizeRot(raw);
                if (shelter) {
                    const floorKey = rotationFloorTextureKey(t.key, rot);
                    if (seen.has(floorKey)) continue;
                    seen.add(floorKey);
                    loads.push({
                        key: floorKey,
                        path: `assets/things/${t.key}/floor_${rot}.png`
                    });
                    loads.push({
                        key: rotationWallTextureKey(t.key, rot),
                        path: `assets/things/${t.key}/wall_${rot}.png`
                    });
                    continue;
                }
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
        if (t.paintingCircle) {
            // 1 and 2 are the rock tints. 3 is the untinted leaves.
            // Dye slots are dye_1 through dye_6.
            const loads = [
                { key: `${t.key}_1`, path: `assets/things/${t.key}/1.png` },
                { key: `${t.key}_2`, path: `assets/things/${t.key}/2.png` },
                { key: `${t.key}_3`, path: `assets/things/${t.key}/3.png` }
            ];
            for (let i = 1; i <= 6; i++) {
                loads.push({
                    key: `${t.key}_dye_${i}`,
                    path: `assets/things/${t.key}/dye_${i}.png`
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
                const file = t.variantDir ? partFile(t.variantDir, key) : key;
                loads.push({ key, path: `assets/things/${dir}${file}.png` });
            }
            return loads;
        }
        if (t.anim) {
            const frameWidth = t.anim.frameWidth ?? 16;
            const frameHeight = t.anim.frameHeight ?? 16;
            const parts = Math.floor(Number(t.anim.parts) || 0);
            if (parts >= 2) {
                const loads = [];
                for (let i = 1; i <= parts; i++) {
                    loads.push({
                        key: `${t.key}_${i}`,
                        path: `assets/things/${t.key}/${t.key}_${i}.png`,
                        spritesheet: true,
                        frameWidth,
                        frameHeight
                    });
                }
                return loads;
            }
            return [{
                key: t.key,
                path: `assets/things/${t.key}.png`,
                spritesheet: true,
                frameWidth,
                frameHeight
            }];
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
     * rotatable placeables otherwise use the 0° world sprite (`${thingKey}_0`,
     * or `${thingKey}_floor_0` for a lean-to).
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
                const rot = pick(facingTextureKey(thingDef, 0));
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

    function interactTileOf(entry, tileSize, thingDef, rot) {
        const off = interactOffset(thingDef);
        if (!off || !entry || entry.gone) return null;
        const origin = originTileOf(entry, tileSize);
        const d = rotateTileDelta(off.dx, off.dy, rot == null ? entry.rot : rot);
        return { tx: origin.tx + d.dx, ty: origin.ty + d.dy };
    }

    /**
     * Next facing whose interact tile passes canPlace(tx, ty).
     * Clockwise unless ccw is set. Null when the thing has no stand,
     * or every other facing is blocked.
     */
    function nextSpotRot(entry, tileSize, thingDef, canPlace, ccw) {
        if (!entry || !interactOffset(thingDef) || typeof canPlace !== "function") return null;
        const turn = ccw ? rotateCCW : rotateCW;
        let rot = normalizeRot(entry.rot);
        for (let n = 0; n < 3; n++) {
            rot = turn(rot);
            const tile = interactTileOf(entry, tileSize, thingDef, rot);
            if (tile && canPlace(tile.tx, tile.ty)) return rot;
        }
        return null;
    }

    /** Feet pose at the bottom-center of the interact tile, same as tileCenter. */
    function interactWorldPos(entry, tileSize, thingDef) {
        const t = interactTileOf(entry, tileSize, thingDef);
        if (!t) return null;
        const ts = Number(tileSize) || 16;
        return { x: t.tx * ts + ts / 2, y: t.ty * ts + ts };
    }

    /**
     * Bottom-left feet that put a standing body in the middle of the interact
     * tile. Pose x is the sprite's left edge, not its center.
     */
    function interactStandPose(entry, tileSize, thingDef, body) {
        const spot = interactWorldPos(entry, tileSize, thingDef);
        if (!spot) return null;
        const ts = Number(tileSize) || 16;
        const w = Number(body?.width) > 0 ? Number(body.width) : ts;
        const h = Number(body?.height) > 0 ? Number(body.height) : ts;
        return {
            x: spot.x - w * 0.5,
            y: spot.y - ts * 0.5 + h * 0.5
        };
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
     * Campfires, drying racks, the grindstone, and wicker baskets are small
     * pieces people line up. A body can step between them. The skinworking
     * bench is wider than the tile gap beside it, so a passer runs into the
     * board. Trees and shelters stay solid at the normal margin.
     */
    function isGapFurniture(thingDef) {
        if (!thingDef || thingDef.id === "skinworking_bench") return false;
        if (thingDef.id === "wicker_basket") return true;
        return !!(thingDef.campfire || thingDef.dryingRack || thingDef.craftStation);
    }

    /** How far `body` intrudes into `rect`. Infinity when its center is inside. */
    function gapIntrusion(body, rect) {
        if (!body || !rect) return 0;
        if (!(body.right > rect.left && body.left < rect.right
            && body.bottom > rect.top && body.top < rect.bottom)) return 0;
        const cx = (body.left + body.right) * 0.5;
        const cy = (body.top + body.bottom) * 0.5;
        if (cx > rect.left && cx < rect.right && cy > rect.top && cy < rect.bottom) {
            return Infinity;
        }
        const ox = Math.min(body.right, rect.right) - Math.max(body.left, rect.left);
        const oy = Math.min(body.bottom, rect.bottom) - Math.max(body.top, rect.top);
        return Math.min(ox, oy);
    }

    /** A passer may clip this far into the edge of gap furniture, per side. */
    const GAP_SQUEEZE = 2;
    /**
     * Baskets are wider than a rack, so the opening between two tiles is
     * narrower than a body. A deeper clip keeps that opening walkable.
     * The middle of one basket stays solid.
     */
    const BASKET_GAP_SQUEEZE = 4;

    function gapSqueeze(thingDef) {
        if (!isGapFurniture(thingDef)) return 0;
        if (thingDef.id === "wicker_basket") return BASKET_GAP_SQUEEZE;
        return GAP_SQUEEZE;
    }

    /**
     * "x" when `body` is between a left-right pair, "y" for a column.
     * The span is the centers, so the approach in front of the opening
     * counts. A lone piece returns null.
     */
    function furnitureGapAxis(rects, body) {
        if (!body || !rects) return null;
        const cx = (body.left + body.right) * 0.5;
        const cy = (body.top + body.bottom) * 0.5;
        for (let i = 0; i < rects.length; i++) {
            const a = rects[i];
            if (!a) continue;
            const acx = (a.left + a.right) * 0.5;
            const acy = (a.top + a.bottom) * 0.5;
            for (let j = i + 1; j < rects.length; j++) {
                const b = rects[j];
                if (!b) continue;
                const bcx = (b.left + b.right) * 0.5;
                const bcy = (b.top + b.bottom) * 0.5;
                const dx = Math.abs(acx - bcx);
                const dy = Math.abs(acy - bcy);
                if (dy <= 10 && dx > 0 && dx <= 20
                    && cx > Math.min(acx, bcx) && cx < Math.max(acx, bcx)) {
                    return "x";
                }
                if (dx <= 10 && dy > 0 && dy <= 20
                    && cy > Math.min(acy, bcy) && cy < Math.max(acy, bcy)) {
                    return "y";
                }
            }
        }
        return null;
    }

    /**
     * The overlap is the side that faces the neighbor, not the face being
     * walked into. A shallow front hit used to cancel collision until the
     * squeeze ran out, then the body was thrown back. Holding into a basket
     * shook. No overlap (path margin only) stays allowed. Crossing the mouth
     * of the opening is allowed: the center is still outside the basket, and
     * only a few pixels of the side overlap.
     */
    function gapSideClip(body, rect, axis, squeeze) {
        if (!body || !rect || (axis !== "x" && axis !== "y")) return false;
        if (gapIntrusion(body, rect) === Infinity) return false;
        const ox = Math.min(body.right, rect.right) - Math.max(body.left, rect.left);
        const oy = Math.min(body.bottom, rect.bottom) - Math.max(body.top, rect.top);
        if (!(ox > 0 && oy > 0)) return true;
        const cap = Number(squeeze) > 0 ? Number(squeeze) : GAP_SQUEEZE;
        const cx = (body.left + body.right) * 0.5;
        const cy = (body.top + body.bottom) * 0.5;
        if (axis === "x") {
            if (cx > rect.left && cx < rect.right && oy < ox) return false;
            return ox <= cap;
        }
        if (cy > rect.top && cy < rect.bottom && ox < oy) return false;
        return oy <= cap;
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
     * Y-sort baseline. Sprites sort at the feet anchor. An upward bench or
     * basket is drawn at the north of its tile, so sorting at the anchor
     * paints it over anyone standing in the empty pixels south of the
     * body. Sort that facing at the hitbox bottom.
     */
    function sortDepth(entry, thingDef, tileSize) {
        const y = Number(entry?.y) || 0;
        const id = thingDef?.id;
        if (!entry || (id !== "skinworking_bench" && id !== "wicker_basket")) return y;
        if (normalizeRot(entry.rot) !== 180) return y;
        const rect = collisionWorldRect(entry, thingDef, tileSize);
        // Half a pixel behind the south edge so a pawn standing on that line draws over the sprite.
        return rect ? rect.bottom - 0.5 : y;
    }

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
                // Upward facings share the 0° height, but the drawing hangs
                // below that box: bench legs by one pixel, the basket by two.
                const id = thingDef?.id;
                const drop = id === "skinworking_bench" ? 1
                    : id === "wicker_basket" ? 2
                    : 0;
                return {
                    left: x - hx,
                    right: x + hx,
                    top: y - ts + slack,
                    bottom: y - ts + box.h + drop
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
     * Near-wall slices of a round hut. Each strip sorts at its own south
     * edge. One depth at the sprite bottom paints the bottom corners over
     * a pawn whose feet are still north of that edge.
     * `dy` is added to the sprite anchor. Cached; do not mutate.
     */
    function frontWallStrips(thingDef, rot) {
        const mask = thingDef?.wallMask;
        if (!mask) return null;
        const size = Math.max(1, Math.floor(Number(thingDef.spriteSize) || 32));
        const split = Math.max(0, Math.min(size, Math.floor(Number(thingDef.wallSplit) || 22)));
        const r = normalizeRot(rot);
        const cacheKey = `${size}|${split}|${r}|${mask}`;
        const hit = _frontStripCache.get(cacheKey);
        if (hit) return hit;
        // Baked wall textures rotate clockwise around the sprite center.
        const solidDest = (dx, dy) => {
            let sx = dx;
            let sy = dy;
            if (r === 90) {
                sx = size - 1 - dy;
                sy = dx;
            } else if (r === 180) {
                sx = size - 1 - dx;
                sy = size - 1 - dy;
            } else if (r === 270) {
                sx = dy;
                sy = size - 1 - dx;
            }
            return wallMaskSolid(mask, sx, sy, size);
        };
        const strips = [];
        let runX = -1;
        let runBottom = -1;
        const flush = (x1) => {
            if (runX < 0) return;
            strips.push({
                x: runX,
                y: split,
                w: x1 - runX,
                h: Math.max(1, size - split),
                // Just behind the scanline of the lowest opaque pixel, so a
                // pawn standing on that edge draws in front of this column.
                dy: -(size - 1 - runBottom) - 0.5
            });
            runX = -1;
            runBottom = -1;
        };
        for (let x = 0; x < size; x++) {
            let bottom = -1;
            for (let y = split; y < size; y++) {
                if (solidDest(x, y)) bottom = y;
            }
            if (bottom < 0) {
                flush(x);
                continue;
            }
            if (runX >= 0 && bottom === runBottom) continue;
            flush(x);
            runX = x;
            runBottom = bottom;
        }
        flush(size);
        _frontStripCache.set(cacheKey, strips);
        return strips;
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
     * True when an axis-aligned body covers thatch. Arc boxes bulge into the
     * doorway and the floor; this is the check those boxes are approximating.
     */
    function rectHitsRing(ring, left, right, top, bottom) {
        if (!ring) return false;
        const l = Math.min(Number(left) || 0, Number(right) || 0);
        const rgt = Math.max(Number(left) || 0, Number(right) || 0);
        const tp = Math.min(Number(top) || 0, Number(bottom) || 0);
        const bt = Math.max(Number(top) || 0, Number(bottom) || 0);
        const cx = ring.cx;
        const cy = ring.cy;
        const qx = Math.max(l, Math.min(cx, rgt));
        const qy = Math.max(tp, Math.min(cy, bt));
        if (Math.hypot(qx - cx, qy - cy) > ring.outer) return false;
        let maxR = 0;
        const corners = [l, tp, rgt, tp, l, bt, rgt, bt];
        for (let i = 0; i < corners.length; i += 2) {
            const d = Math.hypot(corners[i] - cx, corners[i + 1] - cy);
            if (d > maxR) maxR = d;
        }
        if (maxR < ring.inner) return false;
        const x0 = Math.floor(l);
        const x1 = Math.ceil(rgt);
        const y0 = Math.floor(tp);
        const y1 = Math.ceil(bt);
        const span = Math.max(x1 - x0, y1 - y0);
        const step = span > 24 ? 2 : 1;
        for (let y = y0; y <= y1; y += step) {
            if (y < tp - 1e-3 || y > bt + 1e-3) continue;
            for (let x = x0; x <= x1; x += step) {
                if (x < l - 1e-3 || x > rgt + 1e-3) continue;
                if (ringWallAt(ring, x, y)) return true;
            }
        }
        return false;
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
     * How far a body reaches from its center along `ang`.
     * One radius is a circle. Passing `radiusY` uses the feet strip
     * (half-width, half-height), so walking up to the thatch stops at the feet.
     */
    function _ringBodyExtent(ang, radius, radiusY) {
        const hx = Math.max(0, Number(radius) || 0);
        if (!Number.isFinite(Number(radiusY))) return hx;
        const hy = Math.max(0, Number(radiusY) || 0);
        return hx * Math.abs(Math.cos(ang)) + hy * Math.abs(Math.sin(ang));
    }

    /**
     * Keep a pawn center from crossing a round wall. A step that starts inside
     * stays inside; one that starts outside stays outside. The doorway is open.
     * A long jump is a teleport and is left alone.
     */
    function clampRingCenter(ring, fromX, fromY, toX, toY, radius, radiusY) {
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
        const skin = 0.15;
        const ang = r > 0.001 ? Math.atan2(dy, dx) : Math.atan2(pdy, pdx);
        const rad = _ringBodyExtent(ang, radius, radiusY);
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
     * Top-down columns of a placed figurine, yawed the same way as the sprite.
     * 1 = clay in that XZ column. Image X = voxel X, image Y = voxel Z.
     */
    function figurineColumnMask(entry) {
        const Forming = formingApi();
        if (!Forming || !entry?.formVoxels) return null;
        const yawed = Forming.rotatePackYaw(entry.formVoxels, entry.rot)
            || Forming.sanitizePack(entry.formVoxels);
        const grid = yawed && Forming.unpack(yawed);
        if (!grid) return null;
        const n = Forming.SIZE || 16;
        const mask = new Uint8Array(n * n);
        for (let x = 0; x < n; x++) {
            const yz = grid[x];
            if (!yz) continue;
            for (let z = 0; z < n; z++) {
                for (let y = 0; y < n; y++) {
                    if (!yz[y]?.[z]) continue;
                    mask[z * n + x] = 1;
                    break;
                }
            }
        }
        return mask;
    }

    /**
     * 2×2 blocks of the clay footprint. A cell counts when at least 3 of its
     * 4 columns are filled, so a one-voxel arm does not snag and the outline
     * stays close to the sculpture. A speck that fills no cell still keeps
     * one block at its densest spot.
     */
    function figurinePixelRects(mask) {
        const n = 16;
        const cell = FIGURINE_CELL;
        const cells = n / cell;
        const counts = new Uint8Array(cells * cells);
        let total = 0;
        let sx = 0;
        let sz = 0;
        for (let z = 0; z < n; z++) {
            const cy = Math.floor(z / cell);
            for (let x = 0; x < n; x++) {
                if (!mask[z * n + x]) continue;
                counts[cy * cells + Math.floor(x / cell)]++;
                total++;
                sx += x;
                sz += z;
            }
        }
        if (!total) return [];
        const solid = new Uint8Array(cells * cells);
        let any = false;
        let bestI = 0;
        let bestC = 0;
        for (let i = 0; i < counts.length; i++) {
            const c = counts[i];
            if (c > bestC) {
                bestC = c;
                bestI = i;
            }
            if (c >= FIGURINE_FILL) {
                solid[i] = 1;
                any = true;
            }
        }
        if (!any) {
            if (bestC >= 2) solid[bestI] = 1;
            else {
                const cx = Math.min(cells - 1, Math.floor((sx / total) / cell));
                const cy = Math.min(cells - 1, Math.floor((sz / total) / cell));
                solid[cy * cells + cx] = 1;
            }
        }
        const runs = [];
        for (let cy = 0; cy < cells; cy++) {
            let cx = 0;
            while (cx < cells) {
                if (!solid[cy * cells + cx]) {
                    cx++;
                    continue;
                }
                let end = cx;
                while (end + 1 < cells && solid[cy * cells + end + 1]) end++;
                runs.push({ cx, end, cy, used: false });
                cx = end + 1;
            }
        }
        const out = [];
        for (let i = 0; i < runs.length; i++) {
            if (runs[i].used) continue;
            const run = runs[i];
            run.used = true;
            let cy1 = run.cy;
            for (;;) {
                let found = -1;
                for (let j = 0; j < runs.length; j++) {
                    const other = runs[j];
                    if (other.used || other.cy !== cy1 + 1) continue;
                    if (other.cx !== run.cx || other.end !== run.end) continue;
                    found = j;
                    break;
                }
                if (found < 0) break;
                runs[found].used = true;
                cy1++;
            }
            out.push({
                left: run.cx * cell,
                right: (run.end + 1) * cell,
                top: run.cy * cell,
                bottom: (cy1 + 1) * cell
            });
        }
        return out;
    }

    /** Sprite origin (0.5, 1). Pixel (0, 0) is the north-west corner. */
    function figurineCollisionRects(entry) {
        if (!entry || entry.gone) return [];
        const sig = `${entry.rot | 0}|${entry.formVoxels || ""}|${entry.x}|${entry.y}`;
        const cached = _figurineRectCache.get(entry);
        if (cached && cached.sig === sig) return cached.rects;
        const mask = figurineColumnMask(entry);
        const pix = mask ? figurinePixelRects(mask) : [];
        const ax = Number(entry.x) || 0;
        const ay = Number(entry.y) || 0;
        const rects = [];
        for (let i = 0; i < pix.length; i++) {
            const r = pix[i];
            rects.push({
                left: ax - 8 + r.left,
                right: ax - 8 + r.right,
                top: ay - 16 + r.top,
                bottom: ay - 16 + r.bottom
            });
        }
        _figurineRectCache.set(entry, { sig, rects });
        return rects;
    }

    /**
     * Walk blockers. A wall mask becomes one rect per meshed run so the
     * interior and doorway stay open. A figurine is coarse blocks of its
     * clay. Other things stay a single rect.
     */
    function collisionWorldRects(entry, thingDef, tileSize) {
        if (isFigurineThing(thingDef, entry)) return figurineCollisionRects(entry);
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
        for (let i = 0; i < entry.slots.length; i++) {
            if (entry.slots[i] && !slotOccupied(entry.slots[i])) entry.slots[i] = null;
        }
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

    /** A slot blocks Take only when it holds a real stack. */
    function slotOccupied(stack) {
        return !!(stack && stack.id && stack.quantity > 0);
    }

    function isStorageEmpty(entry) {
        const slots = entry?.slots;
        if (!Array.isArray(slots)) return true;
        return slots.every((s) => !slotOccupied(s));
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

    /** Pebbles, grindstones, and painting circles share a slot only when the stone matches. Blank is andesite. */
    function depositStonesMatch(dest, stack) {
        if (stack?.id !== "pebble" && stack?.id !== "grindstone" && stack?.id !== "painting_circle") return true;
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
        rotationFloorTextureKey,
        rotationWallTextureKey,
        facingTextureKey,
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
        nextSpotRot,
        interactWorldPos,
        interactStandPose,
        occupyTiles,
        placeOccupyTiles,
        footprintTiles,
        footprintWorldPos,
        entryFootprintTiles,
        footprintWorldRect,
        hitboxWH,
        sortDepth,
        walkBodyAt,
        walkBodyOverlapsTile,
        collisionWorldRect,
        collisionWorldRects,
        isGapFurniture,
        gapIntrusion,
        gapSqueeze,
        furnitureGapAxis,
        gapSideClip,
        GAP_SQUEEZE,
        BASKET_GAP_SQUEEZE,
        figurineCollisionRects,
        spriteAnchor,
        rotateAnchorOffset,
        worldToSpritePixel,
        inDoorApproach,
        ringWorld,
        ringWallAt,
        rectHitsRing,
        clipSpill,
        clipWallSpill,
        wallDiskHits,
        clampRingCenter,
        wallMaskSolid,
        frontWallStrips,
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
        slotOccupied,
        isStorageEmpty,
        isStorageThing,
        itemIdForThing,
        planStorageDeposits,
        parseSlotIndex
    };
});
