/**
 * SimWorld prototype methods (campfire).
 * Installed onto SimWorld.prototype. Method bodies are unchanged.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory;
    } else {
        root.SimWorldMixins = root.SimWorldMixins || {};
        root.SimWorldMixins.campfire = factory;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ctx) {
    "use strict";
    const {
        Protocol, Look, rng, Spoil, Durability, Apparel, Chop, Place, Sleep, Hunger, Path, Hide, Carry, Fire, Party, Settlement, StorageFilter, FuelFilter, CavemanNames, CorpseDecay, GameMath, DataStore, BodyHealing, Hediffs, BodyCombat, BodyMod, Capacities, HeadlessAI, SimCreatureMod, WorldGen, SettlerWork, mulberry32, hash2D, uuid, Body, createAI, PartyAI, WandererStrollAI, NeutralAnimalAI, createPlayerCreature, createMobCreature, feetToBodyCenter, CS, TS, CHUNK_PX, SPEED, SPRINT, MELEE_RANGE, INTEREST, SIM_CHUNKS, DROP_LIFE_MS, HARVEST_RANGE_TILES, BLOCKED, _research, _contentApi, _actionsApi, _kindsApi, _forming, _dig, _defGeneration, thingDefs, mobDefs, itemDefs, chunkKey, worldToChunk, emptyInv, dedupeCorpses
    } = ctx;
    return {

    /**
     * Harvest a world lootable (sticks, leaves, bushes, fruit trees, …).
     * @param {object} p
     * @param {{ x?: number, y?: number }} action  optional click world pose
     */
    _tryHarvest(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const range = TS * HARVEST_RANGE_TILES;
        const range2 = range * range;
        const wantUid = action.uid ? String(action.uid) : null;
        const wantId = action.id ? String(action.id) : null;
        const aimX = Number.isFinite(action.x) ? Number(action.x) : p.x;
        const aimY = Number.isFinite(action.y) ? Number(action.y) : p.y;
        // Clicked sprite — do not silently harvest a neighbor (was the blueberry/leaves desync)
        const exact2 = 10 * 10;

        let best = null;
        let bestChunk = null;
        let bestIdx = -1;
        let bestAim = Infinity;
        for (const c of this._chunksNear(p.x, p.y, 1)) {
            if (!Array.isArray(c.lootableThings)) continue;
            this._ensureLootableUids(c);
            for (let i = 0; i < c.lootableThings.length; i++) {
                const e = c.lootableThings[i];
                if (!e || e.gone || !e.id) continue;
                const def = thingDefs().get(e.id);
                if (!def?.lootable) continue;
                const dx = e.x - p.x;
                const dy = e.y - p.y;
                if (dx * dx + dy * dy > range2) continue;
                if (wantUid) {
                    if (e.uid !== wantUid) continue;
                    best = e;
                    bestChunk = c;
                    bestIdx = i;
                    bestAim = 0;
                    break;
                }
                if (wantId && e.id !== wantId) continue;
                const adx = e.x - aimX;
                const ady = e.y - aimY;
                const aim = adx * adx + ady * ady;
                if (aim > exact2) continue;
                if (aim < bestAim) {
                    bestAim = aim;
                    best = e;
                    bestChunk = c;
                    bestIdx = i;
                }
            }
            if (wantUid && best) break;
        }
        if (!best || !bestChunk) return;

        const def = thingDefs().get(best.id);
        const loot = def?.lootable;
        if (!loot?.item) return;

        const harvestedId = best.id;
        const qty = Math.max(1, Math.floor(Number(loot.yield) || 1));
        const left = this._give(p, loot.item, qty);
        if (left > 0) {
            this._pushDrop(best.x, best.y, { id: loot.item, quantity: left });
        }

        const transform = loot.transform || null;
        const regrowMinutes = Number(loot.regrowMinutes) || 0;
        const canRegrow = regrowMinutes > 0;
        const regrowAt = canRegrow
            ? GameMath.jitteredRegrowAt(regrowMinutes, this.worldMinuteIndex(), () => this.rng())
            : null;

        // Use the owning chunk, not worldToChunk(feet) — south-row lootables sit on the next chunk's edge
        const baseEv = {
            kind: "lootable",
            cx: bestChunk.cx,
            cy: bestChunk.cy,
            x: best.x,
            y: best.y,
            uid: best.uid || null,
            playerId: p.id
        };

        if (transform) {
            best.id = transform;
            if (canRegrow) {
                best.regrowId = harvestedId;
                best.regrowAt = regrowAt;
            } else {
                delete best.regrowId;
                delete best.regrowAt;
                delete best.gone;
            }
            this.pushEvent({
                ...baseEv,
                id: best.id,
                gone: false,
                regrowId: best.regrowId,
                regrowAt: best.regrowAt
            });
            return;
        }

        if (canRegrow) {
            best.gone = true;
            best.regrowId = harvestedId;
            best.regrowAt = regrowAt;
            this.pushEvent({
                ...baseEv,
                id: harvestedId,
                gone: true,
                regrowId: harvestedId,
                regrowAt
            });
            return;
        }

        bestChunk.lootableThings.splice(bestIdx, 1);
        this.pushEvent({
            ...baseEv,
            id: harvestedId,
            removed: true
        });
    },

    _tryDrop(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const amount = Math.max(1, Math.floor(Number(action.amount) || 1));
        const held = this._held(p);
        if (!held?.id) return;

        const qty = Math.min(amount, held.quantity || 1);
        if (qty <= 0) return;

        const worldStack = this._cloneStackForWorld({ ...held, quantity: qty });
        held.quantity = (held.quantity || 1) - qty;
        if (held.quantity <= 0) p.inventory[p.hotbarIndex] = null;

        const dx = Number.isFinite(action.x) ? Number(action.x) : p.x;
        const dy = Number.isFinite(action.y) ? Number(action.y) : p.y;
        p.x = dx;
        p.y = dy;
        const creature = p.creature || this.creatures.get(p.id);
        if (creature) {
            creature.x = dx;
            creature.y = dy;
        }
        if (worldStack) this._pushDrop(dx, dy, worldStack);
        this._dirtyPawnOwner(p);
    },

    _tileOf(wx, wy) {
        return {
            tx: Math.floor(Number(wx) / TS),
            ty: Math.floor(Number(wy) / TS)
        };
    },

    _tileCenter(tx, ty) {
        return { x: tx * TS + TS / 2, y: ty * TS + TS };
    },

    _isCampfireEntry(t) {
        if (!t) return false;
        if (t.id === "campfire" || t.id === "unlit_campfire") return true;
        return Array.isArray(t.fuel);
    },

    _campfireHasFuel(entry) {
        return !!(entry?.fuel || []).some((s) => s && s.quantity > 0);
    },

    _campfireEnsureBurning(entry) {
        if (!entry) return false;
        return Fire.lightPit(entry, (id) => itemDefs().get(id));
    },

    _campfirePublic(entry, chunk = null) {
        if (!entry) return null;
        if (!entry.uid) {
            entry.uid = `cf_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        const cloneSlot = (s) => (s?.id ? this._cloneStackForWorld(s) : null);
        const fuel = Array.isArray(entry.fuel) ? entry.fuel : [null, null];
        const simmer = Array.isArray(entry.simmer) ? entry.simmer : [null, null, null, null];
        return {
            uid: entry.uid,
            id: entry.id,
            x: entry.x,
            y: entry.y,
            cx: chunk?.cx,
            cy: chunk?.cy,
            rev: Number(entry.rev) || 0,
            fuel: [cloneSlot(fuel[0]), cloneSlot(fuel[1])],
            cook: cloneSlot(entry.cook),
            catalyst: cloneSlot(entry.catalyst),
            simmer: [cloneSlot(simmer[0]), cloneSlot(simmer[1]), cloneSlot(simmer[2]), cloneSlot(simmer[3])],
            cookProgress: entry.cookProgress || 0,
            burnRemaining: entry.burnRemaining || 0,
            roastBarMinutes: entry.roastBarMinutes || 0,
            simmerBarMinutes: (entry.simmerBarMinutes > 0) ? entry.simmerBarMinutes : undefined,
            pitTemp: entry.pitTemp,
            cookTemp: entry.cookTemp,
            maxTemp: entry.maxTemp,
            canIgniteFuel: !!entry.canIgniteFuel,
            smolderAt: entry.smolderAt,
            fuelFilter: FuelFilter ? FuelFilter.persist(entry.fuelFilter) : (entry.fuelFilter || null),
            catalystReserved: !!entry.catalystReserved
        };
    },

    _bumpCampfire(entry) {
        if (!entry) return;
        entry.rev = (Number(entry.rev) || 0) + 1;
    },

    _emitCampfire(chunk, entry) {
        if (!chunk || !entry) return;
        this._bumpCampfire(entry);
        const pub = this._campfirePublic(entry, chunk);
        this.pushEvent({
            kind: "campfire",
            cx: chunk.cx,
            cy: chunk.cy,
            uid: pub.uid,
            rev: pub.rev,
            entry: pub
        });
    },

    _clearPlayerCampfireAttend(playerId) {
        if (!playerId) return;
        for (const c of this.chunks.values()) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isCampfireEntry(t) || !t.attend) continue;
                delete t.attend[playerId];
            }
        }
    },

    _fuelSignature(entry) {
        const fuel = entry?.fuel || [];
        return fuel.map((s) => (s?.id ? `${s.id}:${s.quantity || 0}` : "")).join("|");
    },

    _tickCampfireBurn(entry) {
        const pit = Fire.tickPit(entry, (id) => itemDefs().get(id), this.worldMinuteIndex());
        return !!(pit.changed || pit.litChanged);
    },

    _simmerFilledCount(entry) {
        let n = 0;
        for (const s of entry?.simmer || []) {
            if (s && this._isSimmerIngredient(s.id)) n += 1;
        }
        return n;
    },

    _simmerCanAdvance(entry, lit) {
        if (!lit) return false;
        if (this._campfireMethod(entry) !== "shell_simmer") return false;
        let filled = 0;
        for (const s of entry?.simmer || []) {
            if (!s) continue;
            if (!this._isSimmerIngredient(s.id)) return false;
            filled += 1;
        }
        return filled >= 2;
    },

    _makeSimmerMeal(entry) {
        const ids = (entry?.simmer || [])
            .filter((s) => s && this._isSimmerIngredient(s.id))
            .map((s) => Hide.canonicalItemId(s.id));
        const unique = [...new Set(ids)];
        let kind = "mash";
        let name = "Simmered Meal";
        let spoilHours = 24;
        const meats = [];
        if (unique.includes("raw_human_flesh")) meats.push("Human");
        if (unique.includes("raw_venison")) meats.push("Venison");
        if (unique.includes("raw_pork")) meats.push("Pork");
        const hasMeat = meats.length > 0;
        const hasApple = unique.includes("apple");
        const hasBlue = unique.includes("blueberry");
        if (hasMeat) {
            kind = "stew";
            spoilHours = 36;
            const meatLabel = meats.length > 1 ? "Meat" : meats[0];
            if (hasApple && hasBlue) name = "Hunter's Stew";
            else if (hasApple) name = `Apple and ${meatLabel} Stew`;
            else if (hasBlue) {
                name = `Blueberry and ${meatLabel} Stew`;
                spoilHours = 24;
            } else name = `${meatLabel} Stew`;
        } else if (unique.length === 1 && unique[0] === "blueberry") {
            kind = "mash";
            name = "Blueberry Mash";
            spoilHours = 12;
        } else if (unique.length === 1 && unique[0] === "apple") {
            kind = "simmered";
            name = "Simmered Apples";
            spoilHours = 48;
        } else if (hasBlue && hasApple) {
            kind = "tart";
            name = "Blueberry-Apple Tart";
            spoilHours = 24;
        }
        const coconut = itemDefs().get(entry?.catalyst?.id);
        const mealMeta = itemDefs().get("coconut_meal");
        let kc = 0;
        let weight = Number(coconut?.weight ?? 0);
        for (const id of ids) {
            const meta = itemDefs().get(id);
            kc += Number(meta?.food?.kc ?? 0) * 1.5;
            weight += Number(meta?.weight ?? 0) * 0.5;
        }
        kc += Number(coconut?.food?.kc ?? 0);
        const now = this.worldMinuteIndex();
        const stack = {
            id: mealMeta?.id || "coconut_meal",
            quantity: 1,
            customName: name,
            food: {
                kc: Math.round(kc),
                kcFull: Math.round(kc),
                spoil: spoilHours,
                satietyRatio: Number(mealMeta?.food?.satietyRatio) || 0.3
            },
            weight: Math.round(weight * 100) / 100,
            kind,
            ingredients: ids.slice()
        };
        if (spoilHours > 0) {
            stack.spoilAt = Math.round(now) + Math.round(spoilHours * 60);
        }
        return stack;
    },

    _tickCampfireCook(entry) {
        const getItem = (id) => itemDefs().get(id);
        const cook = Fire.tickCook(entry, getItem, {
            worldMinute: this.worldMinuteIndex(),
            makeResult: (meta, qty, at) => Spoil.makeWorldItemStack(meta, qty, undefined, at),
            finishSimmer: (e) => {
                const meal = this._makeSimmerMeal(e);
                e.simmer = [null, null, null, null];
                e.catalyst = meal;
            }
        });
        if (cook.rate > 0 && cook.method === "stick_roast") {
            this._wearRoastCatalyst(entry, cook.rate);
            return true;
        }
        return !!(cook.changed || cook.converted);
    },

    _dropCampfireCookBeside(entry) {
        const cook = entry?.cook;
        if (!cook?.id) return;
        const world = this._cloneStackForWorld(cook);
        entry.cook = null;
        entry.cookProgress = 0;
        delete entry.roastBarMinutes;
        if (!world) return;
        const x = Number(entry.x) || 0;
        const y = (Number(entry.y) || 0) + 12;
        this._pushDrop(x, y, world);
    },

    _wearRoastCatalyst(entry, rate = 1) {
        const stack = entry?.catalyst;
        if (!stack) return false;
        const def = itemDefs().get(stack.id);
        const result = Durability.applyDurabilityUse(
            stack,
            Durability.COOK_WEAR_PER_MINUTE * Math.max(0, Number(rate) || 0),
            def
        );
        if (!result.broke) return stack.durability != null;
        const name = Durability.stackDisplayName(stack, def);
        this._dropCampfireCookBeside(entry);
        entry.catalyst = null;
        entry.catalystReserved = false;
        const attend = entry.attend;
        const chat = Durability.breakChat(name, { world: true, weaponColor: "#f0a040" });
        if (attend && typeof attend === "object") {
            for (const id of Object.keys(attend)) {
                if (!this.players.has(id)) continue;
                this.pushEvent({
                    kind: "combat_log",
                    text: chat.text,
                    segments: chat.segments,
                    to: id
                });
            }
        }
        return true;
    },

    _tickOneCampfire(entry) {
        if (!this._isCampfireEntry(entry)) return false;
        Fire.migrateEntry(entry, (id) => itemDefs().get(id));
        const idBefore = entry.id;
        const fuelBefore = this._fuelSignature(entry);
        const cookId = entry.cook?.id || "";
        const catId = entry.catalyst?.id || "";
        const tempBefore = entry.pitTemp;
        const cookTempBefore = entry.cookTemp;
        let slotDirty = this._tickCampfireBurn(entry);
        slotDirty = this._tickCampfireCook(entry) || slotDirty;
        if (entry.id !== idBefore) slotDirty = true;
        if (this._fuelSignature(entry) !== fuelBefore) slotDirty = true;
        if ((entry.cook?.id || "") !== cookId) slotDirty = true;
        if ((entry.catalyst?.id || "") !== catId) slotDirty = true;
        if (entry.pitTemp !== tempBefore) slotDirty = true;
        if (entry.cookTemp !== cookTempBefore) slotDirty = true;
        return slotDirty;
    },

    _tickCampfires(chunks) {
        const src = chunks || this.chunks.values();
        for (const c of src) {
            if (!Array.isArray(c.things)) continue;
            for (const entry of c.things) {
                if (!this._isCampfireEntry(entry)) continue;
                if (this._tickOneCampfire(entry)) this._emitCampfire(c, entry);
            }
        }
    },

    _tickDryingRacks(chunks) {
        const getItem = (id) => itemDefs().get(id);
        const src = chunks || this.chunks.values();
        for (const c of src) {
            if (!Array.isArray(c.things)) continue;
            for (const entry of c.things) {
                const def = thingDefs().get(entry?.id);
                if (!Hide.isDryingRack(def, entry)) continue;
                Place.ensureStorageEntry(entry, def);
                const { changed } = Hide.tickRackEntry(entry, getItem);
                if (changed) this._emitStorage(c, entry);
            }
        }
    },

    _tickWorldSpoil(chunks) {
        const src = chunks || this.chunks.values();
        for (const c of src) this._spoilChunkContents(c, { emit: true });
    },

    _dropIsOnWater(drop) {
        if (!drop) return false;
        const pt = Hide.dropSamplePoint(drop.x, drop.y, TS);
        const { tx, ty } = this._tileOf(pt.x, pt.y);
        return this._tileKeyAt(tx, ty) === "water";
    },

    _stampDropSoak(entry) {
        if (!entry) return;
        const def = itemDefs().get(entry.id);
        if (!Hide.isFleshedHide(def) || !this._dropIsOnWater(entry)) return;
        Hide.beginSoak(entry, this.worldMinuteIndex());
    },

    _soakChunkDrops(c) {
        if (!c || !Array.isArray(c.drops)) return;
        const now = this.worldMinuteIndex();
        const getItem = (id) => itemDefs().get(id);
        for (const d of c.drops) {
            if (!d) continue;
            Hide.tickSoakDrop(d, now, getItem, this._dropIsOnWater(d));
        }
    },

    _tickSoakDrops(chunks) {
        const src = chunks || this.chunks.values();
        for (const c of src) this._soakChunkDrops(c);
    },

    _nearbyDropPiles(wx, wy, itemId) {
        const range2 = (TS * HARVEST_RANGE_TILES) * (TS * HARVEST_RANGE_TILES);
        const out = [];
        for (const c of this._chunksNear(wx, wy, 1)) {
            if (!Array.isArray(c.drops)) continue;
            for (let i = 0; i < c.drops.length; i++) {
                const d = c.drops[i];
                if (!d || d.id !== itemId) continue;
                const dx = d.x - wx;
                const dy = d.y - wy;
                if (dx * dx + dy * dy > range2) continue;
                out.push({ chunk: c, idx: i, drop: d, dist: dx * dx + dy * dy });
            }
        }
        out.sort((a, b) => a.dist - b.dist);
        return out;
    },

    _countDropPiles(piles) {
        let n = 0;
        for (const pile of piles) n += Math.max(0, Math.floor(Number(pile.drop?.quantity) || 0));
        return n;
    },

    _consumeDropPiles(piles, need) {
        let left = Math.max(0, Math.floor(Number(need) || 0));
        const emptied = [];
        for (const pile of piles) {
            if (left <= 0) break;
            const qty = Math.max(0, Math.floor(Number(pile.drop.quantity) || 0));
            const take = Math.min(qty, left);
            if (!(take > 0)) continue;
            pile.drop.quantity = qty - take;
            left -= take;
            if (!(pile.drop.quantity > 0)) emptied.push(pile);
        }
        emptied.sort((a, b) => {
            if (a.chunk !== b.chunk) return 0;
            return b.idx - a.idx;
        });
        for (const pile of emptied) {
            const list = pile.chunk.drops;
            if (!Array.isArray(list)) continue;
            if (list[pile.idx] === pile.drop) list.splice(pile.idx, 1);
            else {
                const i = list.indexOf(pile.drop);
                if (i >= 0) list.splice(i, 1);
            }
        }
        return left <= 0;
    },

    _findCampfireOnTile(tx, ty) {
        const pos = this._tileCenter(tx, ty);
        for (const c of this._chunksNear(pos.x, pos.y - 1, 1)) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isCampfireEntry(t)) continue;
                const ft = this._tileOf(t.x, t.y - 1);
                if (ft.tx === tx && ft.ty === ty) return { chunk: c, entry: t };
            }
        }
        return null;
    },

    /** Match client DroppedItem: origin (0, 1), scale 0.7, 16px frames. */
    _dropTile(d) {
        const half = TS * 0.7 * 0.5;
        return this._tileOf(Number(d.x) + half, Number(d.y) - 1);
    },

    _pickDropNearAim(piles, aimX, aimY) {
        if (!piles.length) return null;
        if (!Number.isFinite(aimX) || !Number.isFinite(aimY)) return piles[0]?.drop;
        let best = piles[0];
        let bestD = Infinity;
        for (const pile of piles) {
            const d = pile.drop;
            const dx = Number(d.x) - aimX;
            const dy = Number(d.y) - aimY;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) {
                bestD = d2;
                best = pile;
            }
        }
        return best?.drop;
    },

    _tryLightFire(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const held = this._held(p);
        const meta = held?.id ? itemDefs().get(held.id) : null;
        if (meta?.use !== "light_fire") return;
        const R = _research();
        if (R?.techUnlocked) {
            const holder = this._researchHolder(p.ownerId || session.id);
            if (!R.techUnlocked("fire", holder)) return;
        }

        const range = TS * HARVEST_RANGE_TILES;
        const range2 = range * range;

        let best = null;
        let bestD = Infinity;
        for (const c of this._chunksNear(p.x, p.y, 1)) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isCampfireEntry(t)) continue;
                if (t.id === "campfire") continue;
                if (!this._campfireHasFuel(t)) continue;
                const dx = t.x - p.x;
                const dy = t.y - p.y;
                const d2 = dx * dx + dy * dy;
                if (d2 <= range2 && d2 < bestD) {
                    bestD = d2;
                    best = { chunk: c, entry: t };
                }
            }
        }
        if (best) {
            if (!this._campfireEnsureBurning(best.entry)) return;
            this._emitCampfire(best.chunk, best.entry);
            this._wearHeld(p, 1);
            return;
        }

        const sticks = this._nearbyDropPiles(p.x, p.y, "stick");
        const leaves = this._nearbyDropPiles(p.x, p.y, "leaf");
        if (this._countDropPiles(sticks) < 15 || this._countDropPiles(leaves) < 10) return;

        const aimX = Number(action?.x);
        const aimY = Number(action?.y);
        const anchor = this._pickDropNearAim(leaves, aimX, aimY)
            || this._pickDropNearAim(sticks, aimX, aimY);
        if (!anchor) return;
        const { tx, ty } = this._dropTile(anchor);
        if (this._findCampfireOnTile(tx, ty)) return;
        if (!this._consumeDropPiles(sticks, 15)) return;
        if (!this._consumeDropPiles(leaves, 10)) return;

        const { x, y } = this._tileCenter(tx, ty);
        const { cx, cy } = worldToChunk(x, y - 1);
        const chunk = this._ensureChunk(cx, cy);
        if (!Array.isArray(chunk.things)) chunk.things = [];
        const entry = {
            uid: `cf_${Math.round(x)}_${Math.round(y)}`,
            id: "campfire",
            x,
            y,
            fuel: [
                { id: "leaf", quantity: 10 },
                { id: "stick", quantity: 15 }
            ],
            cook: null,
            catalyst: null,
            simmer: [null, null, null, null],
            cookProgress: 0,
            burnRemaining: 0
        };
        this._campfireEnsureBurning(entry);
        chunk.things.push(entry);
        this._emitCampfire(chunk, entry);
        this._wearHeld(p, 1);
    },

    _parseCampfireSlot(key) {
        const k = String(key || "");
        if (k === "cook" || k === "catalyst") return { kind: k };
        if (k === "fuel:0" || k === "fuel:1") return { kind: "fuel", i: Number(k.slice(5)) };
        if (/^simmer:[0-3]$/.test(k)) return { kind: "simmer", i: Number(k.slice(7)) };
        return null;
    },

    _campfireGetSlot(entry, key) {
        const slot = this._parseCampfireSlot(key);
        if (!entry || !slot) return undefined;
        if (slot.kind === "cook") return entry.cook || null;
        if (slot.kind === "catalyst") return entry.catalyst || null;
        if (slot.kind === "fuel") {
            if (!Array.isArray(entry.fuel)) entry.fuel = [null, null];
            return entry.fuel[slot.i] || null;
        }
        if (!Array.isArray(entry.simmer)) entry.simmer = [null, null, null, null];
        return entry.simmer[slot.i] || null;
    },

    _campfireSetSlot(entry, key, stack) {
        const slot = this._parseCampfireSlot(key);
        if (!entry || !slot) return;
        if (slot.kind === "cook") {
            const prevId = entry.cook?.id;
            entry.cook = stack || null;
            Fire.onCookChanged(entry, prevId);
            return;
        }
        if (slot.kind === "catalyst") {
            entry.catalyst = stack || null;
            if (!stack) entry.catalystReserved = false;
            return;
        }
        if (slot.kind === "fuel") {
            if (!Array.isArray(entry.fuel)) entry.fuel = [null, null];
            entry.fuel[slot.i] = stack || null;
            Fire.tryAutoIgnite(entry, (id) => itemDefs().get(id), this.worldMinuteIndex());
            return;
        }
        if (!Array.isArray(entry.simmer)) entry.simmer = [null, null, null, null];
        entry.simmer[slot.i] = stack || null;
    },

    _campfireMethod(entry) {
        const id = entry?.catalyst?.id;
        if (!id) return null;
        return itemDefs().get(id)?.cook?.method || null;
    },

    _campfireHasSimmer(entry) {
        return !!(entry?.simmer || []).some((s) => !!s);
    },

    _campfireCookOpen(entry) {
        const method = this._campfireMethod(entry);
        if (method === "shell_simmer") return false;
        if (entry?.cook) return true;
        return method === "stick_roast" || method === "smoke_hide";
    },

    _campfireCookAccepts(entry, itemId) {
        const method = this._campfireMethod(entry);
        if (!method || !itemId) return false;
        const recipe = itemDefs().get(itemId)?.cook?.[method];
        return !!(recipe?.result && recipe.minutes > 0);
    },

    _campfireSimmerOpen(entry) {
        return this._campfireMethod(entry) === "shell_simmer" || this._campfireHasSimmer(entry);
    },

    _campfireCatalystLocked(entry) {
        return !!(entry?.cook || this._campfireHasSimmer(entry));
    },

    _isSimmerIngredient(id) {
        const canon = Hide.canonicalItemId(String(id || ""));
        return ["apple", "blueberry", "raw_human_flesh", "raw_venison", "raw_pork"].includes(canon);
    },

    _findPlayerCampfire(p, action = {}) {
        if (!p) return null;
        const range2 = (TS * HARVEST_RANGE_TILES) * (TS * HARVEST_RANGE_TILES);
        const wantUid = action.uid ? String(action.uid) : null;
        const ax = Number(action.x);
        const ay = Number(action.y);
        let best = null;
        let bestD = Infinity;
        for (const c of this._chunksNear(p.x, p.y, 1)) {
            if (!Array.isArray(c.things)) continue;
            for (const t of c.things) {
                if (!this._isCampfireEntry(t)) continue;
                const dx = t.x - p.x;
                const dy = t.y - p.y;
                const d2 = dx * dx + dy * dy;
                if (d2 > range2) continue;
                if (wantUid && t.uid === wantUid) return { chunk: c, entry: t };
                if (Number.isFinite(ax) && Number.isFinite(ay)) {
                    if (Math.abs(t.x - ax) < 1.5 && Math.abs(t.y - ay) < 1.5) {
                        return { chunk: c, entry: t };
                    }
                }
                if (d2 < bestD) {
                    bestD = d2;
                    best = { chunk: c, entry: t };
                }
            }
        }
        return wantUid || (Number.isFinite(ax) && Number.isFinite(ay)) ? null : best;
    },

    _splitInvToWorld(p, index, amount, bag = "hotbar") {
        const inv = this._pawnBag(p, bag);
        const held = inv?.[index];
        if (!held?.id) return null;
        const qty = Math.max(1, Math.floor(Number(held.quantity) || 1));
        const take = Math.min(qty, Math.max(1, Math.floor(Number(amount) || 1)));
        if (!(take > 0)) return null;
        const piece = this._cloneStackForWorld({ ...held, quantity: take });
        held.quantity = qty - take;
        if (!(held.quantity > 0)) inv[index] = null;
        this._youDirty.add(p.id);
        return piece;
    },

    _returnWorldToInv(p, worldStack, preferIndex = -1, bag = "hotbar") {
        if (!p || !worldStack?.id) return false;
        const now = this.worldMinuteIndex();
        const qty = Math.max(1, Math.floor(Number(worldStack.quantity) || 1));
        const extras = this._stackExtrasFrom(worldStack) || {};
        const left = Spoil.spoilLeftForCharacter(worldStack, now);
        if (left != null) extras.spoilLeft = left;
        delete extras.spoilAt;
        const prefer = Math.floor(Number(preferIndex));
        const toBag = this._normBag(bag);
        if (Number.isInteger(prefer) && prefer >= 0) {
            this._ensureEquipment(p);
            if (toBag === "overflow") this._syncOverflowSize(p);
            else this._syncPlayerInvSize(p);
            const inv = this._pawnBag(p, toBag);
            const cap = toBag === "overflow" ? this._overflowBonus(p) : inv.length;
            if (prefer < cap) {
                while (inv.length <= prefer) inv.push(null);
                const dest = inv[prefer];
                if (!dest) {
                    const slot = { id: worldStack.id, quantity: qty };
                    this._applyStackExtras(slot, extras);
                    if (left != null) slot.spoilLeft = left;
                    inv[prefer] = slot;
                    this._youDirty.add(p.id);
                    this._enforceCarryCap(p);
                    return true;
                }
                if (dest.id === worldStack.id && !this._stackIsSpecial(dest) && !this._stackIsSpecial(worldStack)) {
                    const meta = itemDefs().get(dest.id);
                    const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
                    const space = Math.max(0, maxStack - (dest.quantity || 1));
                    const moved = Math.min(space, qty);
                    if (moved > 0) {
                        dest.spoilLeft = Spoil.mergeSpoilLeft(
                            dest.quantity || 1, dest.spoilLeft,
                            moved, left
                        );
                        delete dest.spoilAt;
                        Hide.applyMergedDryProgress(dest, dest.quantity || 1, moved, extras.dryProgress);
                        Hide.applyMergedSoakProgress(dest, dest.quantity || 1, moved, extras.soakProgress);
                        Fire.applyMergedStackTemp(dest, dest.quantity || 1, moved, extras.temp);
                        dest.quantity = (dest.quantity || 1) + moved;
                        this._youDirty.add(p.id);
                        if (moved >= qty) {
                            this._enforceCarryCap(p);
                            return true;
                        }
                        worldStack = { ...worldStack, quantity: qty - moved };
                    }
                }
            }
        }
        const leftover = this._give(p, worldStack.id, worldStack.quantity || qty, extras);
        if (leftover > 0) {
            this._pushDrop(p.x, p.y, this._cloneStackForWorld({
                ...worldStack,
                quantity: leftover
            }));
        }
        this._enforceCarryCap(p);
        return leftover < (worldStack.quantity || qty);
    },

    /**
     * Put a world stack into a specific bag slot (empty or merge). Returns leftover qty.
     * Does not drop leftovers — caller keeps them (e.g. corpse loot).
     */
    _placeInBagSlot(p, worldStack, index, bag = "hotbar") {
        if (!p || !worldStack?.id) return Math.max(1, Math.floor(Number(worldStack?.quantity) || 1));
        const now = this.worldMinuteIndex();
        const qty = Math.max(1, Math.floor(Number(worldStack.quantity) || 1));
        const extras = this._stackExtrasFrom(worldStack) || {};
        const spoilLeft = Spoil.spoilLeftForCharacter(worldStack, now);
        if (spoilLeft != null) extras.spoilLeft = spoilLeft;
        delete extras.spoilAt;
        this._ensureEquipment(p);
        const toBag = this._normBag(bag);
        if (toBag === "overflow") this._syncOverflowSize(p);
        else this._syncPlayerInvSize(p);
        const inv = this._pawnBag(p, toBag);
        const cap = toBag === "overflow" ? this._overflowBonus(p) : inv.length;
        if (!Number.isInteger(index) || index < 0 || index >= cap) return qty;
        while (inv.length <= index) inv.push(null);
        const dest = inv[index];
        if (!dest) {
            const slot = { id: worldStack.id, quantity: qty };
            this._applyStackExtras(slot, extras);
            if (spoilLeft != null) slot.spoilLeft = spoilLeft;
            inv[index] = slot;
            this._dirtyPawnOwner(p);
            this._enforceCarryCap(p);
            return 0;
        }
        if (dest.id === worldStack.id && !this._stackIsSpecial(dest) && !this._stackIsSpecial(worldStack)) {
            const meta = itemDefs().get(dest.id);
            const maxStack = Math.max(1, Math.floor(Number(meta?.maxStack) || 99));
            const space = Math.max(0, maxStack - (dest.quantity || 1));
            const moved = Math.min(space, qty);
            if (!(moved > 0)) return qty;
            dest.spoilLeft = Spoil.mergeSpoilLeft(
                dest.quantity || 1, dest.spoilLeft,
                moved, spoilLeft
            );
            delete dest.spoilAt;
            Hide.applyMergedDryProgress(dest, dest.quantity || 1, moved, extras.dryProgress);
            Hide.applyMergedSoakProgress(dest, dest.quantity || 1, moved, extras.soakProgress);
            Fire.applyMergedStackTemp(dest, dest.quantity || 1, moved, extras.temp);
            dest.quantity = (dest.quantity || 1) + moved;
            this._dirtyPawnOwner(p);
            this._enforceCarryCap(p);
            return qty - moved;
        }
        return qty;
    },

    _tryCampfire(session, action = {}) {
        const p = this._actionPawn(session, action);
        if (!p || p.dead) return;
        const found = this._findPlayerCampfire(p, action);
        if (!found) return;
        const { chunk, entry } = found;
        if (!entry.uid) {
            entry.uid = `cf_${Math.round(Number(entry.x) || 0)}_${Math.round(Number(entry.y) || 0)}`;
        }
        const op = String(action.op || "");
        if (op === "attend") {
            if (!entry.attend) entry.attend = {};
            entry.attend[p.id] = true;
            return;
        }
        if (op === "leave") {
            if (entry.attend) delete entry.attend[p.id];
            return;
        }
        if (op === "destroy") {
            this._destroyCampfire(chunk, entry);
            return;
        }
        if (op === "inv_to_slot") this._campfireInvToSlot(p, entry, action);
        else if (op === "slot_to_inv") this._campfireSlotToInv(p, entry, action);
        else if (op === "slot_to_slot") this._campfireSlotToSlot(entry, action);
        else return;
        this._emitCampfire(chunk, entry);
        this._dirtyPawnOwner(p);
    },

    _campfireContentStacks(entry) {
        const stacks = [];
        const push = (s) => {
            if (s?.id && s.quantity > 0) stacks.push(s);
        };
        for (const s of entry?.fuel || []) push(s);
        push(entry?.cook);
        push(entry?.catalyst);
        for (const s of entry?.simmer || []) push(s);
        return stacks;
    },

    _unlinkStationUid(uid) {
        if (!uid) return;
        const hit = Settlement.unlinkStation(this.settlements, uid);
        for (const s of hit) {
            if (s.ownerId) this._youDirty.add(s.ownerId);
        }
    },

    _destroyCampfire(chunk, entry) {
        if (!chunk || !entry) return;
        if (entry.id === "campfire") return;
        const x = Number(entry.x) || 0;
        const y = Number(entry.y) || 0;
        for (const stack of this._campfireContentStacks(entry)) {
            const world = this._cloneStackForWorld(stack);
            if (world) this._pushDrop(x, y, world);
        }
        this._unlinkStationUid(entry.uid);
        const i = chunk.things.indexOf(entry);
        if (i >= 0) chunk.things.splice(i, 1);
        this._emitCampfireRemoved(chunk, entry);
    },

    _emitCampfireRemoved(chunk, entry) {
        if (!chunk || !entry) return;
        this.pushEvent({
            kind: "campfire",
            removed: true,
            uid: entry.uid,
            id: entry.id,
            x: entry.x,
            y: entry.y,
            cx: chunk.cx,
            cy: chunk.cy
        });
    },
    };
});
