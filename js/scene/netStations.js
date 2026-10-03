/**
 * SceneMain prototype methods (netStations).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainNetStations = {

    _netFindCampfire(src, hint = {}) {
        const x = Number(src?.x);
        const y = Number(src?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { chunk: null, entry: null };
        const keys = [];
        const hcx = Number.isInteger(hint.cx) ? hint.cx : Number.isInteger(src.cx) ? src.cx : null;
        const hcy = Number.isInteger(hint.cy) ? hint.cy : Number.isInteger(src.cy) ? src.cy : null;
        if (hcx != null && hcy != null) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    keys.push(this.getKey(hcx + dx, hcy + dy));
                }
            }
        }
        keys.push(this.getKey(
            Math.floor(x / this.chunkPx()),
            Math.floor((y - 1) / this.chunkPx())
        ));
        const uid = src.uid || hint.uid || null;
        const match = (t) => {
            if (!t) return false;
            if (uid && t.uid && t.uid === uid) return true;
            const camp = t.id === "campfire" || t.id === "unlit_campfire" || Array.isArray(t.fuel);
            if (!camp) return false;
            return Math.abs(Number(t.x) - x) < 1.5 && Math.abs(Number(t.y) - y) < 1.5;
        };
        let chunk = (hcx != null && hcy != null) ? (this.chunks[this.getKey(hcx, hcy)] || null) : null;
        let entry = null;
        for (const k of keys) {
            const c = this.chunks[k];
            const lst = c?.meta?.things;
            if (!Array.isArray(lst)) continue;
            const found = lst.find(match);
            if (found) {
                chunk = c;
                entry = found;
                break;
            }
        }
        if (!chunk) chunk = this.getChunkAtWorld?.(x, y - 1) || null;
        return { chunk, entry, x, y };
    },

    _netCloneCampfireStack(stack) {
        if (!stack?.id) return null;
        if (typeof cloneItemStack === "function") {
            const clone = cloneItemStack(stack);
            if (clone) return clone;
        }
        try {
            return JSON.parse(JSON.stringify(stack));
        } catch (_) {
            return { ...stack };
        }
    },

    _netCloneCampfireList(list, len) {
        const src = Array.isArray(list) ? list : [];
        const out = [];
        for (let i = 0; i < len; i++) out.push(this._netCloneCampfireStack(src[i]));
        return out;
    },

    _netCampfireHeld(_entry) {
        // Campfire transfers wait for the sim event/YOU instead of optimistic
        // slot writes. Always apply server slot state so ghosts cannot stick.
        return false;
    },

    _netApplyCampfirePayload(src, opts = {}) {
        if (!src || !this.simAuth()) return;
        if (src.removed || opts.removed) {
            this._netRemoveCampfire(src, opts);
            return;
        }
        const found = this._netFindCampfire(src, opts);
        let { chunk, entry, x, y } = found;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (!chunk?.meta) return;
        if (!Array.isArray(chunk.meta.things)) chunk.meta.things = [];

        const incomingRev = Number(src.rev ?? opts.rev);
        const curRev = Number(entry?.rev);
        if (entry && Number.isFinite(curRev) && Number.isFinite(incomingRev) && incomingRev < curRev) {
            return;
        }

        const held = entry && this._netCampfireHeld(entry);
        const newer = Number.isFinite(incomingRev) && Number.isFinite(curRev) && incomingRev > curRev;
        const progressOnly = !!(held && opts.snapshot && !newer);

        if (!entry) {
            entry = {
                uid: src.uid || opts.uid || `cf_${Math.round(x)}_${Math.round(y)}`,
                id: src.id || "campfire",
                x,
                y,
                rev: Number.isFinite(incomingRev) ? incomingRev : 0,
                fuel: this._netCloneCampfireList(src.fuel, 2),
                cook: this._netCloneCampfireStack(src.cook),
                catalyst: this._netCloneCampfireStack(src.catalyst),
                simmer: this._netCloneCampfireList(src.simmer, 4),
                cookProgress: src.cookProgress || 0,
                burnRemaining: src.burnRemaining || 0,
                roastBarMinutes: src.roastBarMinutes || 0,
                pitTemp: src.pitTemp,
                cookTemp: src.cookTemp,
                maxTemp: src.maxTemp,
                canIgniteFuel: !!src.canIgniteFuel,
                smolderAt: src.smolderAt,
                catalystReserved: !!src.catalystReserved
            };
            if ((src.simmerBarMinutes || 0) > 0) entry.simmerBarMinutes = src.simmerBarMinutes;
            this._netApplyFuelFilter(entry, src);
            chunk.meta.things.push(entry);
        } else if (progressOnly) {
            const radiusBefore = typeof Fire !== "undefined"
                ? Math.round(Fire.lightRadiusForEntry(entry) * 100)
                : null;
            if (src.id) entry.id = src.id;
            if (src.cookProgress != null) entry.cookProgress = src.cookProgress;
            if (src.burnRemaining != null) entry.burnRemaining = src.burnRemaining;
            if (src.roastBarMinutes != null) entry.roastBarMinutes = src.roastBarMinutes;
            if (src.pitTemp != null) entry.pitTemp = src.pitTemp;
            if (src.cookTemp != null) entry.cookTemp = src.cookTemp;
            if (src.maxTemp != null) entry.maxTemp = src.maxTemp;
            if (src.canIgniteFuel != null) entry.canIgniteFuel = !!src.canIgniteFuel;
            if ("smolderAt" in src) {
                if (src.smolderAt != null) entry.smolderAt = src.smolderAt;
                else delete entry.smolderAt;
            }
            if ((src.simmerBarMinutes || 0) > 0) entry.simmerBarMinutes = src.simmerBarMinutes;
            else delete entry.simmerBarMinutes;
            if ("catalystReserved" in src) entry.catalystReserved = !!src.catalystReserved;
            if (Number.isFinite(incomingRev)) entry.rev = Math.max(curRev || 0, incomingRev);
            this._netSyncCampfireSprite(chunk, entry, src.id || entry.id, x, y);
            this.campfirePanel?.refreshCookBar?.();
            this.campfirePanel?.refreshHeatLabel?.();
            const radiusAfter = typeof Fire !== "undefined"
                ? Math.round(Fire.lightRadiusForEntry(entry) * 100)
                : null;
            if (radiusBefore !== radiusAfter) {
                this.markLightDirty?.();
                this.updateLightVeil?.();
            }
            return;
        } else {
            entry.uid = src.uid || opts.uid || entry.uid;
            if (src.id) entry.id = src.id;
            entry.x = x;
            entry.y = y;
            if (Number.isFinite(incomingRev)) entry.rev = incomingRev;
            if ("fuel" in src) entry.fuel = this._netCloneCampfireList(src.fuel, 2);
            if ("cook" in src) entry.cook = this._netCloneCampfireStack(src.cook);
            if ("catalyst" in src) entry.catalyst = this._netCloneCampfireStack(src.catalyst);
            if ("simmer" in src) entry.simmer = this._netCloneCampfireList(src.simmer, 4);
            if (src.cookProgress != null) entry.cookProgress = src.cookProgress;
            if (src.burnRemaining != null) entry.burnRemaining = src.burnRemaining;
            if (src.roastBarMinutes != null) entry.roastBarMinutes = src.roastBarMinutes;
            else delete entry.roastBarMinutes;
            if ((src.simmerBarMinutes || 0) > 0) entry.simmerBarMinutes = src.simmerBarMinutes;
            else delete entry.simmerBarMinutes;
            if (src.pitTemp != null) entry.pitTemp = src.pitTemp;
            if (src.cookTemp != null) entry.cookTemp = src.cookTemp;
            if (src.maxTemp != null) entry.maxTemp = src.maxTemp;
            if (src.canIgniteFuel != null) entry.canIgniteFuel = !!src.canIgniteFuel;
            if ("smolderAt" in src) {
                if (src.smolderAt != null) entry.smolderAt = src.smolderAt;
                else delete entry.smolderAt;
            }
            this._netApplyFuelFilter(entry, src);
            if ("catalystReserved" in src) entry.catalystReserved = !!src.catalystReserved;
        }
        this._netSyncCampfireSprite(chunk, entry, src.id || entry.id, x, y);
        this.markLightDirty?.();
        this.updateLightVeil?.();
        this.campfirePanel?.refresh?.();
        if (this.fuelFilterPanel?.visible && this.fuelFilterPanel.thing?.entry === entry) {
            this.fuelFilterPanel.refresh();
        }
    },

    _netFindCampfireSprite(entry, x, y) {
        const uid = entry?.uid || null;
        const fires = this.getCampfires();
        let byPos = null;
        for (const fire of fires) {
            if (!fire?.active) continue;
            if (entry && fire.entry === entry) return fire;
            if (uid && fire.entry?.uid && fire.entry.uid === uid) return fire;
            if (
                !byPos
                && Number.isFinite(x) && Number.isFinite(y)
                && Math.abs(fire.x - x) < 1.5
                && Math.abs(fire.y - y) < 1.5
            ) {
                byPos = fire;
            }
        }
        return byPos;
    },

    _netSyncCampfireSprite(chunk, entry, wantId, x, y) {
        if (!entry) return;
        const id = wantId || entry.id;
        const live = this._netFindCampfireSprite(entry, x, y);
        if (live) {
            if (live.entry !== entry) live.entry = entry;
            if (id && typeof live.setKind === "function" && live.meta?.id !== id) {
                live.setKind(id);
            } else {
                live.applyVisual?.();
            }
            live.applySmokeVisual?.();
            this._netDedupeCampfireSprites(entry, x, y, live);
            return;
        }
        if (chunk?.isLoaded) chunk.things.add(new Campfire(this, entry));
    },

    _netDedupeCampfireSprites(entry, x, y, keep) {
        const uid = entry?.uid || keep?.entry?.uid || null;
        for (const fire of this.getCampfires()) {
            if (fire === keep || !fire?.active) continue;
            const sameUid = !!(uid && fire.entry?.uid && fire.entry.uid === uid);
            const samePos = Number.isFinite(x) && Number.isFinite(y)
                && Math.abs(fire.x - x) < 1.5
                && Math.abs(fire.y - y) < 1.5;
            if (!sameUid && !samePos) continue;
            if (this.campfirePanel?.campfire === fire) this.campfirePanel.campfire = keep;
            fire.destroy();
        }
    },

    _netApplyCampfireEvent(ev) {
        if (!ev || !this.simAuth()) return;
        if (ev.removed) {
            this._netRemoveCampfire(ev, {
                cx: ev.cx,
                cy: ev.cy,
                uid: ev.uid
            });
            return;
        }
        const src = ev.entry || ev;
        this._netApplyCampfirePayload(src, {
            snapshot: false,
            cx: ev.cx,
            cy: ev.cy,
            uid: ev.uid || src.uid,
            rev: ev.rev
        });
    },

    _netRemoveCampfire(src, opts = {}) {
        const found = this._netFindCampfire(src, opts);
        const chunk = found.chunk;
        const entry = found.entry;
        const x = Number.isFinite(found.x) ? found.x : Number(src.x);
        const y = Number.isFinite(found.y) ? found.y : Number(src.y);
        const uid = src.uid || opts.uid || entry?.uid;
        const live = this._netFindCampfireSprite(entry || { uid }, x, y);
        if (chunk?.meta?.things && entry) {
            const i = chunk.meta.things.indexOf(entry);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        } else if (chunk?.meta?.things && uid) {
            const i = chunk.meta.things.findIndex((t) => t?.uid === uid);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        }
        if (live) {
            if (this.campfirePanel?.campfire === live) this.campfirePanel.close();
            live.destroy();
        }
        this.settlementSys?.unlinkStation?.(uid, { localOnly: true });
        this.markLightDirty?.();
        this.updateLightVeil?.();
    },

    _netApplyCampfires(list) {
        if (!Array.isArray(list)) return;
        for (const src of list) {
            if (!src) continue;
            this._netApplyCampfirePayload(src, {
                snapshot: true,
                cx: src.cx,
                cy: src.cy,
                uid: src.uid,
                rev: src.rev
            });
        }
    },

    _netFindStorage(src, hint = {}) {
        const x = Number(src?.x);
        const y = Number(src?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { chunk: null, entry: null };
        const keys = [];
        const hcx = Number.isInteger(hint.cx) ? hint.cx : Number.isInteger(src.cx) ? src.cx : null;
        const hcy = Number.isInteger(hint.cy) ? hint.cy : Number.isInteger(src.cy) ? src.cy : null;
        if (hcx != null && hcy != null) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    keys.push(this.getKey(hcx + dx, hcy + dy));
                }
            }
        }
        keys.push(this.getKey(
            Math.floor(x / this.chunkPx()),
            Math.floor((y - 1) / this.chunkPx())
        ));
        const uid = src.uid || hint.uid || null;
        const match = (t) => {
            if (!t) return false;
            if (uid && t.uid && t.uid === uid) return true;
            const store = Array.isArray(t.slots) || this.getThing?.(t.id)?.storage
                || this.getThing?.(t.id)?.craftStation
                || this.getThing?.(t.id)?.sleep
                || this.getThing?.(t.id)?.settlement
                || this.getThing?.(t.id)?.figurine
                || t.id === "settling_stone"
                || t.id === "clay_figurine"
                || Array.isArray(t.occupants);
            if (!store) return false;
            return Math.abs(Number(t.x) - x) < 1.5 && Math.abs(Number(t.y) - y) < 1.5;
        };
        let chunk = (hcx != null && hcy != null) ? (this.chunks[this.getKey(hcx, hcy)] || null) : null;
        let entry = null;
        for (const k of keys) {
            const c = this.chunks[k];
            const lst = c?.meta?.things;
            if (!Array.isArray(lst)) continue;
            const found = lst.find(match);
            if (found) {
                chunk = c;
                entry = found;
                break;
            }
        }
        if (!chunk) chunk = this.getChunkAtWorld?.(x, y - 1) || null;
        return { chunk, entry, x, y };
    },

    _netStorageHeld(entry) {
        if (performance.now() < (this._invSwapGuardUntil || 0)) {
            const open = this.storagePanel?.visible && this.storagePanel.storage?.entry;
            if (open && entry && (open === entry || (open.uid && open.uid === entry.uid))) {
                return true;
            }
        }
        return false;
    },

    _netApplyStoragePayload(src, opts = {}) {
        if (!src || !this.simAuth()) return;
        if (src.removed || opts.removed) {
            this._netRemoveStorage(src, opts);
            return;
        }
        const found = this._netFindStorage(src, opts);
        let { chunk, entry, x, y } = found;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (!chunk?.meta) return;
        if (!Array.isArray(chunk.meta.things)) chunk.meta.things = [];

        const incomingRev = Number(src.rev ?? opts.rev);
        const curRev = Number(entry?.rev);
        if (entry && Number.isFinite(curRev) && Number.isFinite(incomingRev) && incomingRev < curRev) {
            return;
        }
        if (
            opts.snapshot
            && entry
            && Number.isFinite(curRev)
            && Number.isFinite(incomingRev)
            && incomingRev === curRev
        ) {
            return;
        }

        const held = entry && this._netStorageHeld(entry);
        const newer = Number.isFinite(incomingRev) && Number.isFinite(curRev) && incomingRev > curRev;
        if (held && opts.snapshot && !newer) return;

        if (!entry) {
            const def = this.getThing(src.id);
            const isStation = !!(src.craftStation || def?.craftStation);
            const isSleep = !!(src.sleep || def?.sleep || Array.isArray(src.occupants));
            const isSettle = !!(src.settlement || def?.settlement || src.id === "settling_stone");
            const isFig = !!(src.figurine || def?.figurine || src.id === "clay_figurine");
            entry = {
                uid: src.uid || opts.uid || `${isSleep ? "sl" : isStation ? "cs" : isSettle ? "ss" : isFig ? "fg" : "st"}_${Math.round(x)}_${Math.round(y)}`,
                id: src.id || (isSleep ? "lean_to" : isStation ? "skinworking_bench" : isSettle ? "settling_stone" : isFig ? "clay_figurine" : "wicker_basket"),
                x,
                y,
                rot: typeof Place !== "undefined" ? Place.normalizeRot(src.rot) : (src.rot || 0),
                rev: Number.isFinite(incomingRev) ? incomingRev : 0
            };
            if (isSleep) {
                if (Array.isArray(src.occupants)) entry.occupants = src.occupants;
                if (typeof Place !== "undefined") Place.ensureSleepEntry(entry, def);
            } else if (isStation) {
                if (typeof Place !== "undefined") Place.ensureCraftStationEntry(entry);
            } else if (isSettle) {
                if (typeof Place !== "undefined") Place.ensureSettlementEntry(entry);
                if (src.settlementId) entry.settlementId = src.settlementId;
            } else if (typeof Research !== "undefined" && Research.isPaintingCircle?.(def, src)) {
                if (typeof Research.ensureEntry === "function") Research.ensureEntry(entry, def);
            } else if (def?.figurine || src.figurine || src.id === "clay_figurine") {
                if (typeof Place !== "undefined") Place.ensureFigurineEntry(entry);
                this._netApplyFigurineFields(entry, src);
            } else {
                entry.slots = Array.isArray(src.slots) ? src.slots : [null, null, null, null, null, null];
                if (typeof Place !== "undefined") {
                    Place.ensureStorageEntry(entry, this.getThing(entry.id));
                }
                this._netApplyStorageFilter(entry, src);
            }
            chunk.meta.things.push(entry);
        } else {
            entry.uid = src.uid || opts.uid || entry.uid;
            if (src.id) entry.id = src.id;
            entry.x = x;
            entry.y = y;
            if (Number.isFinite(incomingRev)) entry.rev = incomingRev;
            if (src.rot != null) {
                entry.rot = typeof Place !== "undefined" ? Place.normalizeRot(src.rot) : src.rot;
            }
            if (Array.isArray(src.slots)) entry.slots = src.slots;
            if (Array.isArray(src.occupants)) entry.occupants = src.occupants;
            this._netApplyStorageFilter(entry, src);
            this._netApplyFigurineFields(entry, src);
        }
        if (typeof Research !== "undefined" && Research.isPaintingCircle?.(this.getThing(entry.id), entry)) {
            if (src.painted != null) entry.painted = src.painted;
            if (src.paintProgress != null) entry.paintProgress = src.paintProgress;
            if (src.paintStarted != null) entry.paintStarted = !!src.paintStarted;
            if (src.paintPigment !== undefined) entry.paintPigment = src.paintPigment;
            if (Array.isArray(src.paintPigments)) entry.paintPigments = src.paintPigments.slice();
            if (src.paintEnabled != null) entry.paintEnabled = src.paintEnabled !== false;
            if (src.tallyStick != null) entry.tallyStick = !!src.tallyStick;
            this._netApplyPaintFilter(entry, src);
            Research.ensureEntry(entry, this.getThing(entry.id));
        }
        this._netSyncStorageSprite(chunk, entry, x, y);
        const storeP = this.storagePanel;
        if (storeP?.visible) {
            const open = storeP.storage?.entry;
            if (open && (open === entry || (open.uid && open.uid === entry.uid))) {
                storeP.refresh();
            }
        }
        this.leanToPanel?.refresh?.();
        if (this.storageFilterPanel?.visible && this.storageFilterPanel.thing?.entry === entry) {
            this.storageFilterPanel.refresh();
        }
        if (this.pigmentFilterPanel?.visible && this.pigmentFilterPanel.thing?.entry === entry) {
            this.pigmentFilterPanel.refresh();
        }
        if (this.paintingCirclePanel?.visible && this.paintingCirclePanel.circle?.entry === entry) {
            this.paintingCirclePanel.layout();
        }
        this._reconcileSleepOccupants?.(entry);
    },

    _netApplyFigurineFields(entry, src) {
        if (!entry || !src) return;
        const def = this.getThing(entry.id || src.id);
        if (!(def?.figurine || src.figurine || entry.id === "clay_figurine" || src.id === "clay_figurine")) {
            return;
        }
        const extras = typeof mealStackExtras === "function" ? mealStackExtras(src) : null;
        if (extras) Object.assign(entry, extras);
    },

    _netApplyStorageFilter(entry, src) {
        if (!entry || !src || !Object.prototype.hasOwnProperty.call(src, "storageFilter")) return;
        const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
        if (SF) SF.applyToEntry(entry, src.storageFilter);
        else if (src.storageFilter) entry.storageFilter = src.storageFilter;
        else delete entry.storageFilter;
    },

    _netApplyFuelFilter(entry, src) {
        if (!entry || !src || !Object.prototype.hasOwnProperty.call(src, "fuelFilter")) return;
        const FF = typeof FuelFilter !== "undefined" ? FuelFilter : null;
        if (FF) FF.applyToEntry(entry, src.fuelFilter);
        else if (src.fuelFilter) entry.fuelFilter = src.fuelFilter;
        else delete entry.fuelFilter;
    },

    _netApplyPaintFilter(entry, src) {
        if (!entry || !src || !Object.prototype.hasOwnProperty.call(src, "paintFilter")) return;
        const R = typeof Research !== "undefined" ? Research : null;
        if (R?.applyPaintFilter) R.applyPaintFilter(entry, src.paintFilter);
        else if (src.paintFilter) entry.paintFilter = src.paintFilter;
        else delete entry.paintFilter;
    },

    _netSyncStorageSprite(chunk, entry, x, y) {
        if (!entry) return;
        const def = this.getThing(entry.id);
        const isStation = !!(def?.craftStation);
        const isSleep = !!(def?.sleep || Array.isArray(entry.occupants));
        const isSettle = !!(def?.settlement || entry.id === "settling_stone");
        const isFig = !!(def?.figurine || entry.id === "clay_figurine");
        let live = isSleep
            ? this.findLeanToByUid(entry.uid)
            : isStation
            ? this.findCraftStationByUid(entry.uid)
            : isSettle
            ? this.settlementSys?.findThingByUid?.(entry.uid)
            : isFig
            ? this.findFigurineByUid(entry.uid)
            : this.findStorageByUid(entry.uid);
        if (!live) {
            for (const t of chunk?.things?.getChildren?.() || []) {
                const matchType = isSleep
                    ? (t instanceof LeanTo)
                    : isStation ? (t instanceof CraftStation)
                    : isSettle ? (typeof SettlingStone !== "undefined" && t instanceof SettlingStone)
                    : isFig ? (typeof ClayFigurine !== "undefined" && t instanceof ClayFigurine)
                    : (t instanceof Storage || t instanceof PaintingCircle);
                if (!matchType) continue;
                if (t.entry === entry) { live = t; break; }
                if (Math.abs(t.x - x) < 1.5 && Math.abs(t.y - y) < 1.5) { live = t; break; }
            }
        }
        // Chunk load used to spawn a generic Thing (0° / not clickable). Replace it.
        if (!live) {
            for (const t of chunk?.things?.getChildren?.() || []) {
                if (!t?.active) continue;
                if (t instanceof CraftStation || t instanceof Storage || t instanceof LeanTo
                    || t instanceof PaintingCircle
                    || (typeof ClayFigurine !== "undefined" && t instanceof ClayFigurine)
                    || (typeof SettlingStone !== "undefined" && t instanceof SettlingStone)) continue;
                const sameUid = !!(entry.uid && t.entry?.uid === entry.uid);
                const samePos = Number.isFinite(x) && Number.isFinite(y)
                    && Math.abs(t.x - x) < 1.5 && Math.abs(t.y - y) < 1.5
                    && t.meta?.id === entry.id;
                if (sameUid || samePos) t.destroy();
            }
        }
        if (live) {
            if (live.entry !== entry) live.entry = entry;
            if (isSleep) {
                // Occupant-only storage snapshots used to applyVisual every tick.
                // setTexture drops Phaser's over-state and flashes the bunk tooltip.
                const visKey = `${entry.id || ""}:${entry.rot ?? 0}`;
                if (live._sleepVisKey !== visKey) {
                    live.applyVisual?.();
                    live._sleepVisKey = visKey;
                }
                return;
            }
            live.x = x;
            live.y = y;
            live.applyVisual?.();
            return;
        }
        if (chunk?.isLoaded) {
            const spr = isSleep
                ? new LeanTo(this, entry)
                : isStation ? new CraftStation(this, entry)
                : isSettle ? new SettlingStone(this, entry)
                : isFig ? new ClayFigurine(this, entry)
                : Storage.create(this, entry);
            chunk.things.add(spr);
        }
    },

    findFigurineByUid(uid) {
        if (!uid) return null;
        for (const chunk of Object.values(this.chunks || {})) {
            for (const t of chunk.things?.getChildren?.() || []) {
                if (typeof ClayFigurine !== "undefined" && t instanceof ClayFigurine && t.entry?.uid === uid) {
                    return t;
                }
            }
        }
        return null;
    },

    findCraftStationByUid(uid) {
        if (!uid) return null;
        for (const chunk of Object.values(this.chunks || {})) {
            for (const t of chunk.things?.getChildren?.() || []) {
                if (t instanceof CraftStation && t.entry?.uid === uid) return t;
            }
        }
        return null;
    },

    _netRemoveStorage(src, opts = {}) {
        const found = this._netFindStorage(src, opts);
        const { chunk, entry, x, y } = found;
        const uid = src.uid || opts.uid || entry?.uid;
        const live = this.findStorageByUid(uid)
            || this.findCraftStationByUid(uid)
            || this.findLeanToByUid(uid)
            || this.findFigurineByUid(uid)
            || this.settlementSys?.findThingByUid?.(uid)
            || (chunk?.things?.getChildren?.() || []).find((t) =>
                (t instanceof Storage || t instanceof CraftStation || t instanceof LeanTo
                    || t instanceof PaintingCircle
                    || (typeof ClayFigurine !== "undefined" && t instanceof ClayFigurine)) && (
                    t.entry === entry
                    || (Number.isFinite(x) && Math.abs(t.x - x) < 1.5 && Math.abs(t.y - y) < 1.5)
                )
            );
        if (chunk?.meta?.things && entry) {
            const i = chunk.meta.things.indexOf(entry);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        } else if (chunk?.meta?.things && uid) {
            const i = chunk.meta.things.findIndex((t) => t?.uid === uid);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        }
        if (live) {
            if (this.storagePanel?.storage === live) this.storagePanel.close();
            if (this.paintingCirclePanel?.circle === live) this.paintingCirclePanel.close();
            if (this.pigmentFilterPanel?.thing === live) this.pigmentFilterPanel.close();
            if (this._isSameCraftStation(live)) this.closeCraftStationMenu();
            if (this.leanToPanel?.leanTo === live) this.leanToPanel.close();
            live.destroy();
        }
        this.settlementSys?.unlinkStation?.(uid, { localOnly: true });
    },

    _netApplyStorageEvent(ev) {
        if (!ev || !this.simAuth()) return;
        this._netApplyStoragePayload(ev, {
            snapshot: false,
            cx: ev.cx,
            cy: ev.cy,
            uid: ev.uid,
            rev: ev.rev,
            removed: !!ev.removed
        });
    },

    _netApplyStorages(list) {
        if (!Array.isArray(list)) return;
        for (const src of list) {
            if (!src) continue;
            this._netApplyStoragePayload(src, {
                snapshot: true,
                cx: src.cx,
                cy: src.cy,
                uid: src.uid,
                rev: src.rev
            });
        }
    },

    /** Unarmed thrust fill for remotes / net mobs. */
    _netFistColor(entry) {
        const fromArt = entry?.attackArt?.color;
        if (Number.isFinite(fromArt)) return fromArt >>> 0;
        if (entry?.look && typeof PlayerLook !== "undefined") {
            return PlayerLook.fistColor(entry.look);
        }
        const kind = entry?.kind || "";
        if (kind === "human" || kind === "player") return 0xff8900;
        const def = kind && typeof this.getMob === "function" ? this.getMob(kind) : null;
        if (Number.isFinite(def?.fistColor)) return def.fistColor >>> 0;
        return 0x000000;
    },

    _netClearRemoteAttack(entry) {
        if (!entry) return;
        entry.attackTimer = 0;
        entry.attackMax = 0;
        entry.attackArt = null;
        if (entry.fist) entry.fist.setVisible(false);
        if (entry.weapon) entry.weapon.setVisible(false);
    },

    _netStartRemoteAttack(entry, angle, facing = null, art = null) {
        if (!entry || entry.prone || entry.dead) return;
        const a = Number(angle);
        entry.attackAngle = Number.isFinite(a) ? a : 0;
        const resolvedArt = art && typeof art === "object"
            ? { ...art }
            : { unarmed: true, range: 4, max: 833 };
        entry.attackArt = resolvedArt;
        const max = Number(resolvedArt.max);
        entry.attackMax = Number.isFinite(max) && max > 0 ? max : 833;
        entry.attackTimer = entry.attackMax;
        if (facing) entry.facing = facing;
        else if (Number.isFinite(a)) {
            const ang = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            if (ang >= Math.PI * 0.25 && ang < Math.PI * 0.75) entry.facing = "down";
            else if (ang >= Math.PI * 0.75 && ang < Math.PI * 1.25) entry.facing = "left";
            else if (ang >= Math.PI * 1.25 && ang < Math.PI * 1.75) entry.facing = "up";
            else entry.facing = "right";
        }

        const useWeapon = !resolvedArt.unarmed && !!resolvedArt.key;
        if (useWeapon) {
            let texKey = resolvedArt.key;
            if (
                resolvedArt.knapIconData
                && typeof Knapping !== "undefined"
                && typeof Knapping.ensureToolTexture === "function"
            ) {
                try {
                    texKey = Knapping.ensureToolTexture(this, {
                        id: resolvedArt.itemId || "knap",
                        knapIconData: resolvedArt.knapIconData,
                        knapIcon: resolvedArt.key
                    }) || texKey;
                    resolvedArt.key = texKey;
                } catch (_) { /* fall through */ }
            }
            if (!this.textures.exists(texKey)) {
                // Missing texture — fist fallback
                resolvedArt.unarmed = true;
            } else {
                if (!entry.weapon || !entry.weapon.active) {
                    entry.weapon = this.add.image(0, 0, texKey)
                        .setOrigin(0.2, 0.8)
                        .setVisible(false);
                    entry.root.add(entry.weapon);
                } else if (entry.weapon.texture?.key !== texKey) {
                    entry.weapon.setTexture(texKey);
                }
                entry.weapon.setOrigin(0.2, 0.8).setScale(1).setVisible(true).setDepth(1);
                if (entry.fist) entry.fist.setVisible(false);
                this._netUpdateRemoteAttackSprites(entry, 0);
                return;
            }
        }

        if (!entry.fist || !entry.fist.active) {
            const color = this._netFistColor(entry);
            entry.fist = this.add.rectangle(0, 0, 4, 10, color, 1)
                .setOrigin(0.5, 1);
            entry.root.add(entry.fist);
        } else {
            entry.fist.setFillStyle(this._netFistColor(entry), 1);
        }
        entry.fist.setVisible(true);
        if (entry.weapon) entry.weapon.setVisible(false);
        this._netUpdateRemoteAttackSprites(entry, 0);
    },

    /** Animate remote fist / weapon along aim (local coords inside entry.root). */
    _netUpdateRemoteAttackSprites(entry, progress) {
        if (!entry) return;
        const art = entry.attackArt || { unarmed: true, range: 4 };
        const ang = entry.attackAngle || 0;
        const cx = (entry.spr?.width || 16) * 0.5;
        const cy = -(entry.spr?.height || 16) * 0.5;
        const useWeapon = !art.unarmed && entry.weapon?.visible;

        if (useWeapon) {
            const range = Number(art.range) || 12;
            const thrust = typeof meleeThrustCurve === "function"
                ? meleeThrustCurve(progress)
                : progress;
            const hold = art.knapSilhouette ? 5 : 6;
            const anchorDist = hold + range * thrust;
            const ax = cx + Math.cos(ang) * anchorDist;
            const ay = cy + Math.sin(ang) * anchorDist;
            const rot = art.knapSilhouette ? ang + Math.PI / 2 : ang + Math.PI / 4;
            entry.weapon.setRotation(rot);

            const fw = entry.weapon.frame?.width || entry.weapon.width || 16;
            const fh = entry.weapon.frame?.height || entry.weapon.height || 16;
            // Mid-frame local offset (sprite origin 0.2, 0.8)
            const localX = (fw - 1) * 0.5 - entry.weapon.originX * fw;
            const localY = (fh - 1) * 0.5 - entry.weapon.originY * fh;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            const ox = localX * cos - localY * sin;
            const oy = localX * sin + localY * cos;
            entry.weapon.setPosition(ax - ox, ay - oy);
            entry.weapon.setDepth(1);
            return;
        }

        if (entry.fist && typeof placeUnarmedThrustSprite === "function") {
            placeUnarmedThrustSprite(
                entry.fist, cx, cy, ang, Number(art.range) || 4, progress, null
            );
        }
    },

    _netOnWorldRegen(seed) {
        worldSeed = seed;
        noise.seed(worldSeed);
        this.regenChunks();
        for (const entry of this.netMobs.values()) entry.root?.destroy?.(true);
        this.netMobs.clear();
        for (const spr of this.netDrops.values()) {
            if (spr?.active) {
                if (typeof spr.persistDestroy === "function") spr.persistDestroy();
                else spr.destroy();
            }
        }
        this.netDrops.clear();
        if (this.netCorpses) {
            for (const spr of this.netCorpses.values()) {
                if (spr?.active) spr.destroy();
            }
            this.netCorpses.clear();
        }
        this._spawnSignPlaced = false;
        this._spawnSignBusy = false;
        this._netAwaitPoseFromYou = true;
        this.net.sendAction({ type: NetProtocol.Actions.RESYNC });
    },

    _netApplyThingSet(ev) {
        if (!ev || !this.simAuth()) return;
        const tx = Math.floor(Number(ev.tx));
        const ty = Math.floor(Number(ev.ty));
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
        this.setThingOnTile(tx, ty, ev.entry || null, { lootable: !!ev.lootable });
    },

    _netSendMove(force = false) {
        if (!this.isNet || !this.net?.connected || !this.player) return;
        const now = performance.now();
        if (!force && this._netMoveAt && now - this._netMoveAt < 1000 / NetProtocol.MOVE_HZ) return;
        this._netMoveAt = now;

        const p = this.player;
        let x = 0;
        let y = 0;
        const downed = !!(p.isIncapacitated?.() || p.isImmobile?.() || p._downed
            || (p._prone && !p._resting));
        if (
            !this._gamePaused
            && !this._worldSimFrozen
            && !this._worldBooting
            && !this.combatLog?.isComposing?.()
            && !isHudTextOpen(this)
            && !this._sculptUiOpen()
            && !this.researchTreePanel?.visible
            && !downed
            && !p.isVomiting?.()
        ) {
            const left = (p.cursors || this.cursors)?.left?.isDown || (p.keys || this.keys)?.A?.isDown;
            const right = (p.cursors || this.cursors)?.right?.isDown || (p.keys || this.keys)?.D?.isDown;
            const up = (p.cursors || this.cursors)?.up?.isDown || (p.keys || this.keys)?.W?.isDown;
            const down = (p.cursors || this.cursors)?.down?.isDown || (p.keys || this.keys)?.S?.isDown;
            x = (right ? 1 : 0) - (left ? 1 : 0);
            y = (down ? 1 : 0) - (up ? 1 : 0);
        }
        const pose = typeof creatureFeetPose === "function"
            ? creatureFeetPose(p)
            : { x: p.x, y: p.y };
        this.net.sendMove({
            x,
            y,
            sprint: !this._gamePaused && !this._worldSimFrozen && !this._worldBooting && !!p.isSprinting,
            facing: p.facing || "down",
            px: pose.x,
            py: pose.y,
            pawnId: p.pawnId || this._netPlayerId,
            partyPoses: (this.party || [])
                .filter((m) => m && m !== p && !m.isBodyDead?.())
                .map((m) => ({
                    id: m.pawnId,
                    x: m.x,
                    y: m.y,
                    facing: m.facing || "down",
                    sprint: !!m.isSprinting,
                    attacking: !!m.isAttacking?.(),
                    attackAngle: m.attackAngle ?? null,
                    tending: !!(m._tendChannel && !m._tendChannel.corpse)
                        || !!this.partySys?._isTendLocked?.(m)
                })),
            viewChunks: this.genDistance || this.cullDistance || this.renderDistance || 6
        });
    },

    _netUpdateRemotes(delta) {
        const now = this.time?.now || 0;
        for (const entry of this.remotePlayers.values()) {
            const fromX = Number.isFinite(entry.fromX) ? entry.fromX : entry.x;
            const fromY = Number.isFinite(entry.fromY) ? entry.fromY : entry.y;
            const err = Math.hypot((entry.tx - fromX), (entry.ty - fromY));
            if (err > 72 || !Number.isFinite(entry.snapAt)) {
                entry.x = entry.tx;
                entry.y = entry.ty;
            } else {
                const snapDt = entry.snapDt || (1000 / 15);
                const age = performance.now() - entry.snapAt;
                let u = snapDt > 0 ? age / snapDt : 1;
                if (u > 1) u = 1;
                entry.x = fromX + (entry.tx - fromX) * u;
                entry.y = fromY + (entry.ty - fromY) * u;
            }
            entry.root.setPosition(entry.x, entry.y);
            const attacking = entry.attackTimer > 0;
            const prone = !!entry.prone;
            if (prone) {
                entry.x = entry.tx;
                entry.y = entry.ty;
                entry.root.setPosition(entry.x, entry.y);
                this._netClearRemoteAttack(entry);
            }
            if (typeof setPuppetProne === "function") {
                if (entry.resting) {
                    const lean = this.findLeanToByUid?.(entry.lastSleep?.uid);
                    const spec = entry.lastSleep;
                    if (lean?.entry && typeof Sleep !== "undefined") {
                        const pos = Sleep.sleeperWorldPos(
                            lean.entry,
                            spec?.slot || 0,
                            this.tileSize,
                            lean.meta
                        );
                        entry.x = pos.x;
                        entry.y = pos.y;
                        entry.root.setPosition(pos.x, pos.y);
                    }
                    setPuppetProne(entry.spr, true, {
                        feetAnchored: false,
                        resting: true,
                        restRot: entry.restRot ?? lean?.entry?.rot
                    });
                } else {
                    setPuppetProne(entry.spr, prone, { feetAnchored: true });
                }
            }
            this._setRemoteSortDepth(entry);
            const snapDist = Number.isFinite(entry.snapDist) ? entry.snapDist : err;
            const wantWalk = !attacking && !prone
                && (entry.serverMoving === true || snapDist > 1);
            if (wantWalk) {
                entry.moving = true;
                entry.stillMs = 0;
            } else {
                entry.stillMs = (entry.stillMs || 0) + (delta || 16);
                if (entry.stillMs > 100) entry.moving = false;
            }
            if (prone) {
                entry.facing = "right";
            } else if (entry.moving) {
                const dx = entry.tx - fromX;
                const dy = entry.ty - fromY;
                if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
                    entry.facing = Math.abs(dx) > Math.abs(dy)
                        ? (dx > 0 ? "right" : "left")
                        : (dy > 0 ? "down" : "up");
                }
            }
            if (!prone) {
                const facing = entry.facing || "down";
                const key = `${entry.tex || entry.spr?.texture?.key}-${entry.moving ? "walk" : "idle"}-${facing}`;
                if (typeof PlayerLook !== "undefined") {
                    PlayerLook.play(entry.spr, facing, !!entry.moving);
                } else {
                    if (key !== entry.animKey && this.anims.exists(key)) {
                        entry.animKey = key;
                        entry.spr.play(key, true);
                    }
                }
            }

            if (attacking) {
                entry.attackTimer = Math.max(0, entry.attackTimer - delta);
                const progress = entry.attackMax > 0
                    ? 1 - entry.attackTimer / entry.attackMax
                    : 1;
                this._netUpdateRemoteAttackSprites(entry, progress);
                if (entry.attackTimer <= 0) {
                    if (entry.fist) entry.fist.setVisible(false);
                    if (entry.weapon) entry.weapon.setVisible(false);
                    entry.attackArt = null;
                } else {
                    const art = entry.attackArt;
                    const useWeapon = art && !art.unarmed && entry.weapon;
                    if (entry.fist) entry.fist.setVisible(!useWeapon);
                    if (entry.weapon) entry.weapon.setVisible(!!useWeapon);
                }
            } else {
                if (entry.fist?.visible) entry.fist.setVisible(false);
                if (entry.weapon?.visible) entry.weapon.setVisible(false);
            }

            if (entry.bubble.visible) {
                const fadeNow = this._chatFadeNow?.() ?? now;
                if (fadeNow >= entry.bubbleUntil) {
                    entry.bubble.setVisible(false);
                } else {
                    const fadeMs = 2000;
                    const remaining = entry.bubbleUntil - fadeNow;
                    entry.bubble.setAlpha(
                        remaining < fadeMs ? Phaser.Math.Clamp(remaining / fadeMs, 0, 1) : 1
                    );
                }
            }
            this._netLayoutRemoteLabels(entry);
            if (entry.name?.setColor) {
                entry.name.setColor(this.partySys?.nameColorFor?.({
                    ownerId: entry.ownerId,
                    hostile: !!entry.hostile,
                    role: entry.role
                }) || "#ffffff");
            }
        }
    },

    _unbindSceneListeners() {
        if (this._onGameResize && this.scale) {
            this.scale.off("resize", this._onGameResize);
        }
        this._onGameResize = null;
        if (this._onPreUpdate) this.events?.off("preupdate", this._onPreUpdate);
        if (this._onPostUpdate) this.events?.off("postupdate", this._onPostUpdate);
        this._onPreUpdate = null;
        this._onPostUpdate = null;
        this._playReady = false;
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
