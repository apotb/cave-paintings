class Thing extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, id, entry = null) {
        const meta = scene.getThing(id);
        super(scene, x, y, Thing.textureKeyFor(scene, meta, entry?.rot));
        this.meta = meta;
        this.scene = scene;
        this.entry = entry || null;
        this._inStaticGroup = false;
        this.setOrigin(0.5, 1);
        this.setDepth(this.y);
        scene.mainLayer.add(this);
        this.setup(meta.hitboxSize);
        this.applyVisual();
    }

    static textureKeyFor(scene, meta, rot) {
        if (!meta?.key) return "";
        if (typeof Place !== "undefined" && Array.isArray(meta.rotations) && meta.rotations.length) {
            const tex = Place.rotationTextureKey(meta.key, rot);
            if (scene?.textures?.exists(tex)) return tex;
        }
        return meta.key;
    }

    toJSON() {
        return {
            id: this.meta.id,
            x: this.x,
            y: this.y
        };
    }

    animKey() {
        return `${this.meta.key}-anim`;
    }

    ensureAnim() {
        const a = this.meta.anim;
        if (!a) return null;
        const key = this.animKey();
        const texKey = this.meta.key;
        const tex = this.scene.textures?.get?.(texKey);
        // frameTotal includes __BASE; a 4-frame sheet reports 5.
        const sheetFrames = Math.max(0, (Number(tex?.frameTotal) || 0) - 1);
        const existing = this.scene.anims.get(key);
        if (existing && sheetFrames >= 2 && (existing.frames?.length || 0) < 2) {
            this.scene.anims.remove(key);
        }
        if (!this.scene.anims.exists(key)) {
            this.scene.anims.create({
                key,
                frames: this.scene.anims.generateFrameNumbers(texKey),
                frameRate: a.frameRate ?? 8,
                repeat: a.repeat ?? -1
            });
        }
        return key;
    }

    _animIsLive(key) {
        const st = this.anims;
        return !!(
            st?.isPlaying
            && !st.isPaused
            && st.currentAnim?.key === key
        );
    }

    applyVisual() {
        if (this.meta.anim) {
            const key = this.ensureAnim();
            if (key) {
                // Layer add / static physics can drop sprites off the Scene update
                // list, which is what actually advances Phaser animations.
                this.addToUpdateList?.();
                if (!this._animIsLive(key)) this.play(key);
            }
            if (this.body) this._positionBody();
            this._syncInteractMark();
            return;
        }
        if (this.anims?.isPlaying) this.stop();
        if (typeof Place !== "undefined" && Array.isArray(this.meta.rotations) && this.meta.rotations.length) {
            const tex = Place.rotationTextureKey(this.meta.key, this.entry?.rot);
            if (this.scene.textures.exists(tex)) {
                this.setTexture(tex);
                if (this.body) this._positionBody();
                this._syncInteractMark();
                return;
            }
        }
        this.setTexture(this.meta.key);
        if (this.body) this._positionBody();
        this._syncInteractMark();
    }

    setup(hitboxSize=0) {
        this.hitboxSize = hitboxSize;
        if (hitboxSize > 0) {
            if (!this.body) this.createCollision();
            else this._positionBody();
        } else if (this.body) this.disableCollision();
    }

    createCollision() {
        if (this.body && this.body.physicsType !== Phaser.Physics.Arcade.STATIC_BODY) {
            this.scene.physics.world.remove(this.body);
            this.body.destroy?.();
            this.body = null;
        }
        if (!this.body) this.scene.physics.add.existing(this, true);
        this.refreshBody = () => {
            this._positionBody();
            return this;
        };
        this.body.enable = true;
        if (!this._inStaticGroup) {
            this.scene._things.add(this);
            this._inStaticGroup = true;
            if (!this._cellDestroyBound) {
                this._cellDestroyBound = true;
                this.once("destroy", () => {
                    if (typeof unindexThingSprite === "function") unindexThingSprite(this.scene, this);
                });
            }
        }
        this._positionBody();
    }

    _positionBody() {
        if (!this.body) return;
        const ts = this.scene?.tileSize || 16;
        // Do not call the Phaser refreshBody() — it copies the full sprite.
        if (typeof Place !== "undefined" && this.entry && Place.collisionWorldRect) {
            const rect = Place.collisionWorldRect(this.entry, this.meta, ts);
            if (rect) {
                const bw = rect.right - rect.left;
                const bh = rect.bottom - rect.top;
                const ox = rect.left - (this.x - this.displayOriginX);
                const oy = rect.top - (this.y - this.displayOriginY);
                this._applyStaticSize(bw, bh, ox, oy);
                return;
            }
        }
        const hs = this.hitboxSize;
        this._applyStaticSize(hs, hs, (this.width - hs) * 0.5, this.height - hs);
    }

    _syncInteractMark() {
        const ts = this.scene?.tileSize || 16;
        const tile = typeof Place !== "undefined" && this.entry
            ? Place.interactTileOf?.(this.entry, ts, this.meta)
            : null;
        const show = !!(tile && this.scene?._stationInteractVisible?.(this));
        if (!show) {
            if (this._interactMark) this._interactMark.setVisible(false);
            return;
        }
        if (!this.scene?.add?.graphics) return;
        const cx = tile.tx * ts + ts / 2;
        const cy = tile.ty * ts + ts / 2;
        let g = this._interactMark;
        if (!g || !g.active) {
            g = this.scene.add.graphics();
            this.scene.mainLayer?.add(g);
            this._interactMark = g;
            if (!this._interactMarkBound) {
                this._interactMarkBound = true;
                this.once("destroy", () => this._destroyInteractMark());
            }
        }
        g.clear();
        g.fillStyle(0xffffff, 0.18);
        g.fillCircle(0, 0, ts * 0.28);
        g.lineStyle(1, 0xffffff, 0.9);
        g.strokeCircle(0, 0, ts * 0.28);
        g.setPosition(cx, cy);
        g.setDepth(cy - ts);
        g.setVisible(true);
    }

    _destroyInteractMark() {
        if (this._interactMark) {
            this._interactMark.destroy();
            this._interactMark = null;
        }
    }

    _applyStaticSize(bw, bh, ox, oy) {
        const body = this.body;
        if (!body) return;
        const w = Math.max(1, Number(bw) || 1);
        const h = Math.max(1, Number(bh) || 1);
        // Third arg false: StaticBody.setSize defaults to centering on the sprite.
        if (typeof body.setSize === "function") body.setSize(w, h, false);
        else {
            body.width = w;
            body.height = h;
        }
        if (typeof body.setOffset === "function") body.setOffset(ox, oy);
        else {
            body.offset.x = ox;
            body.offset.y = oy;
        }
        if (typeof body.reset === "function") body.reset(this.x, this.y);
        else if (typeof body.updateCenter === "function") body.updateCenter();
        if (typeof indexThingSprite === "function" && this._inStaticGroup) {
            indexThingSprite(this.scene, this);
        }
    }

    disableCollision() {
        this.scene.physics.world.disable(this);
        this.body = null;
        if (this._inStaticGroup) {
            if (typeof unindexThingSprite === "function") unindexThingSprite(this.scene, this);
            this.scene._things.remove(this, false, false);
            this._inStaticGroup = false;
        }
    }

    morph(id) {
        const thing = this.scene.getThing(id);
        if (!thing) {
            this.destroy();
            return;
        }
        this.meta = thing;
        this.applyVisual();
        this.setup(thing.hitboxSize);
    }
}

/**
 * World lootable. `entry` is the object in chunk.meta.lootableThings (mutated for save).
 */
class LootableThing extends Thing {
    /**
     * @param {Phaser.Scene} scene
     * @param {{ x: number, y: number, id: string, gone?: boolean, regrowAt?: number, regrowId?: string }} entry
     * @param {Chunk} [chunk]
     */
    constructor(scene, entry, chunk = null) {
        super(scene, entry.x, entry.y, entry.id);
        this.entry = entry;
        this.chunk = chunk;

        this.on("pointerdown", (pointer) => {
            if (this.scene.pointerOverWorldUi?.(pointer)) return;
            if (this.scene.partySys?.pointerBlocksLoot?.(pointer)) return;
            if (this.canPickup()) this.pickUp();
        });
        this.on("pointerover", (pointer) => {
            if (!this.meta.lootable) return;
            const itemMeta = this.scene.getItem(this.meta.lootable.item);
            const stack = { id: itemMeta?.id, quantity: this.meta.lootable.yield ?? 1 };
            this.scene.showTooltip(
                () => this.scene.formatItemTooltip(itemMeta, stack.quantity),
                pointer.x,
                pointer.y,
                this
            );
        });
        this.on("pointerout", () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) this.scene.hideTooltip();
        });

        if (!this.meta.lootable) this.disableInteractive();
    }

    setup(hitboxSize = 0) {
        super.setup(hitboxSize);
        if (this.meta?.lootable) this.setInteractive({ cursor: "pointer" });
    }

    morph(id) {
        super.morph(id);
        if (this.meta.lootable) {
            this.setInteractive({ cursor: "pointer" });
        } else {
            this.disableInteractive();
        }
    }

    canPickup() {
        if (!this.meta?.lootable || this.entry?.gone) return false;
        const dx = this.x - this.scene.player.x;
        const dy = this.y - this.scene.player.y;
        const d2 = dx * dx + dy * dy;
        const r = this.scene.tileSize * this.scene.player.interactionRange;
        return d2 <= r * r;
    }

    _removeEntry() {
        const list = this.chunk?.meta?.lootableThings;
        if (!list || !this.entry) return;
        const i = list.indexOf(this.entry);
        if (i >= 0) list.splice(i, 1);
    }

    pickUp() {
        this.pickUpBy(this.scene.player);
    }

    pickUpBy(pawn) {
        const loot = this.meta?.lootable;
        if (!loot || !this.entry || !pawn) return;

        // Dedicated MP: server owns lootables + inventory (YOU).
        if (this.scene.simAuth()) {
            if (pawn !== this.scene.player) return;
            this.scene._netSendMove?.(true);
            this.scene.net.sendAction({
                type: NetProtocol.Actions.HARVEST,
                uid: this.entry?.uid || null,
                id: this.meta?.id || this.entry?.id || null,
                x: this.x,
                y: this.y,
                pawnId: pawn?.pawnId
            });
            return;
        }

        const harvestedId = this.meta.id;
        const item = this.scene.getItem(loot.item);
        const remaining = pawn.gainItem(item, loot.yield);
        if (remaining > 0) DroppedItem.spawn(this.scene, this.x, this.y, item, remaining);
        if (pawn === this.scene.player) this.scene.hideTooltip();

        const transform = loot.transform;
        const regrowMinutes = Number(loot.regrowMinutes);
        const canRegrow = regrowMinutes > 0 && typeof this.scene.jitteredRegrowAt === "function";

        if (transform) {
            this.entry.id = transform;
            if (canRegrow) {
                this.entry.regrowId = harvestedId;
                this.entry.regrowAt = this.scene.jitteredRegrowAt(regrowMinutes);
            } else {
                delete this.entry.regrowId;
                delete this.entry.regrowAt;
                delete this.entry.gone;
            }
            this.morph(transform);
            return;
        }

        // Debris: vanish; optionally leave a gone stub for later respawn
        if (canRegrow) {
            this.entry.gone = true;
            this.entry.regrowId = harvestedId;
            this.entry.regrowAt = this.scene.jitteredRegrowAt(regrowMinutes);
            this.destroy();
            return;
        }

        this._removeEntry();
        this.destroy();
    }
}

/**
 * Player-placed campfire. `entry` is the object in chunk.meta.things (mutated in place for save).
 */
class Campfire extends Thing {
    constructor(scene, entry) {
        super(scene, entry.x, entry.y, entry.id);
        this.entry = entry;
        if (!Array.isArray(entry.fuel)) entry.fuel = [null, null];
        while (entry.fuel.length < 2) entry.fuel.push(null);
        if (entry.cook === undefined) entry.cook = null;
        if (entry.catalyst === undefined) entry.catalyst = null;
        if (!Array.isArray(entry.simmer)) entry.simmer = [null, null, null, null];
        while (entry.simmer.length < 4) entry.simmer.push(null);
        if (entry.simmer.length > 4) entry.simmer.length = 4;
        if (typeof Fire !== "undefined") {
            Fire.migrateEntry(entry, (id) => scene.getItem(id));
        } else {
            if (entry.cookProgress == null) entry.cookProgress = 0;
            if (entry.burnRemaining == null) {
                entry.burnRemaining = 0;
                delete entry.burnProgress;
            }
        }

        this.setInteractive({ cursor: 'pointer' });
        this.on('pointerover', (pointer) => {
            this.scene.showTooltip(
                () => this.tooltipText(),
                pointer.x,
                pointer.y,
                this
            );
        });
        this.on('pointerout', () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) this.scene.hideTooltip();
        });
        this.on('pointerdown', (pointer) => {
            if (pointer.rightButtonDown()) return;
            if (this.scene.pointerOverWorldUi?.(pointer)) return;
            if (this.scene.restBlocksWorldUi?.()) return;
            if (!this.inRange()) return;
            this.scene.campfirePanel?.toggle(this);
        });
        this.on('destroy', () => {
            this._destroySmokeVisual();
            if (this.scene.campfirePanel?.campfire === this) {
                this.scene.campfirePanel.close();
            }
            this.scene.markLightDirty?.();
        });
        // setInteractive after play() can leave the sprite on a still frame;
        // kick the burn loop again now that the sprite is fully wired.
        this.applyVisual();
        this.applySmokeVisual();
    }

    isLit() {
        if (this.entry?.id === "unlit_campfire") return false;
        if (this.entry?.id === "campfire") return true;
        return !!this.meta?.lit;
    }

    inRange(pawn) {
        const p = pawn || this.scene.player;
        if (!p) return false;
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        const r = this.scene.tileSize * (p.interactionRange || 4);
        return dx * dx + dy * dy <= r * r;
    }

    tooltipContents() {
        const items = [];
        const cat = this.getCatalyst();
        if (cat?.id) items.push(cat);
        const cook = this.getCook();
        if (cook?.id) items.push(cook);
        for (const s of this.entry?.simmer || []) {
            if (s?.id) items.push(s);
        }
        return items;
    }

    tooltipText() {
        const lines = [this.meta.name];
        const getItem = (id) => this.scene.getItem(id);
        const now = this.scene.worldMinuteIndex?.();
        if (typeof Fire !== "undefined") {
            const band = Fire.displayBand(this.entry, now);
            const deg = Math.round(Number(this.entry.pitTemp) || Fire.AMBIENT_TEMP);
            lines.push(Fire.formatTemp(deg));
            if (this.isLit()) {
                const mins = Fire.burnMinutes(this.entry, getItem);
                if (mins <= 0) lines.push("Burn time: <1h");
                else lines.push(`Burn time: ${formatHours(Math.floor(mins / 60))}`);
            } else if (!this.hasFuel() || band === "cold") {
                // Unlit empty pits always need fuel, even hot coals that would relight.
                lines.push(this.hasFuel() ? "Needs firestarter" : "Needs fuel");
            }
        } else if (this.isLit()) {
            const mins = campfireBurnMinutes(getItem, this.entry.fuel, this.entry.burnRemaining);
            if (mins <= 0) lines.push("Burn time: <1h");
            else lines.push(`Burn time: ${formatHours(Math.floor(mins / 60))}`);
        } else {
            lines.push(this.hasFuel() ? "Needs firestarter" : "Needs fuel");
        }
        const text = lines.join("\n");
        const contents = this.tooltipContents();
        return contents.length ? { text, rows: [contents] } : text;
    }

    /** Fuel still sitting in the input slots (not the unit already in the fire). */
    hasFuel() {
        return this.entry.fuel.some(s => s && s.quantity > 0);
    }

    setKind(id) {
        const def = this.scene.getThing(id);
        if (!def) return;
        const scene = this.scene;
        const wasHover = scene._hoverTarget === this || scene._tooltipTarget === this;
        this.entry.id = id;
        this.meta = def;
        this.applyVisual();
        this.setup(def.hitboxSize);
        this.applySmokeVisual();
        if (!this.input?.enabled) this.setInteractive({ cursor: 'pointer' });
        if (!this.isLit()) this.entry.burnRemaining = 0;
        scene.markLightDirty?.();
        // play()/setInteractive drops Phaser's over-state and hides the tip without a
        // mouse move, so pointerover never fires again until you leave and re-enter.
        if (wasHover) {
            scene._hoverTarget = null;
            const pointer = scene.input?.activePointer;
            if (pointer && !scene.player?.blocksTooltips?.()) {
                scene.showTooltip(() => this.tooltipText(), pointer.x, pointer.y, this);
                scene._hoverTarget = this;
            }
        } else if (scene.tooltip?.visible && scene._tooltipTarget === this) {
            scene.refreshTooltip();
        }
        scene.campfirePanel?.refresh();
    }

    _getItem(id) {
        return this.scene.getItem(id);
    }

    _syncKind() {
        const id = this.entry?.id;
        if (!id || this.meta?.id === id) return;
        this.setKind(id);
    }

    /** If unlit with nothing actively burning, pull the next fuel unit and light. */
    ensureBurning() {
        if (typeof Fire === "undefined") return false;
        const ok = Fire.lightPit(this.entry, (id) => this._getItem(id));
        this._syncKind();
        if (ok) this.scene.markLightDirty?.();
        this.scene.campfirePanel?.refresh();
        if (this.scene.tooltip?.visible && this.scene._tooltipTarget === this) {
            this.scene.refreshTooltip();
        }
        return ok;
    }

    /**
     * Burn, heat, smolder, and cook one game minute.
     * Returns true if the night-veil light band or lit visual changed.
     */
    burnMinute() {
        if (typeof Fire === "undefined") return false;
        const getItem = (id) => this._getItem(id);
        const now = this.scene.worldMinuteIndex?.();
        const pit = Fire.tickPit(this.entry, getItem, now);
        const cook = Fire.tickCook(this.entry, getItem, {
            worldMinute: now,
            makeResult: (meta, qty, at) => makeWorldItemStack(meta, qty, undefined, at),
            finishSimmer: (entry) => this._finishSimmerMeal(entry)
        });
        if (cook.rate > 0 && cook.method === "stick_roast") {
            this._wearRoastCatalyst(cook.rate);
        }
        if (pit.litChanged) this._syncKind();
        else {
            this.scene.campfirePanel?.refresh();
            if (this.scene.tooltip?.visible && this.scene._tooltipTarget === this) {
                this.scene.refreshTooltip();
            }
        }
        this.applySmokeVisual();
        return !!(pit.lightChanged || pit.litChanged);
    }

    getFuel(index) {
        return this.entry.fuel[index] || null;
    }

    setFuel(index, stack) {
        this.entry.fuel[index] = stack;
        if (typeof Fire !== "undefined") {
            Fire.tryAutoIgnite(
                this.entry,
                (id) => this._getItem(id),
                this.scene.worldMinuteIndex?.()
            );
            this._syncKind();
        }
        this.scene.campfirePanel?.refresh();
        if (this.scene.tooltip?.visible && this.scene._tooltipTarget === this) {
            this.scene.refreshTooltip();
        }
    }

    getCook() {
        return this.entry.cook || null;
    }

    setCook(stack) {
        const prevId = this.entry.cook?.id;
        this.entry.cook = stack;
        if (typeof Fire !== "undefined") Fire.onCookChanged(this.entry, prevId);
        else if (!stack || stack.id !== prevId) this.entry.cookProgress = 0;
        this.scene.campfirePanel?.refresh();
        this.applySmokeVisual();
        if (this.scene.tooltip?.visible && this.scene._tooltipTarget === this) {
            this.scene.refreshTooltip();
        }
    }

    getCatalyst() {
        return this.entry.catalyst || null;
    }

    setCatalyst(stack) {
        const prevMethod = this.getCatalystMethod();
        this.entry.catalyst = stack;
        if (!stack) this.entry.catalystReserved = false;
        const nextMethod = this.getCatalystMethod();
        // Only wipe progress when switching between different cook methods
        // (stick roast ↔ shell simmer). Removing/replacing the same tool pauses.
        if (prevMethod && nextMethod && prevMethod !== nextMethod) {
            this.entry.cookProgress = 0;
        }
        this.scene.campfirePanel?.refresh();
        this.scene.campfirePanel?.layout?.();
        this.applySmokeVisual();
        if (this.scene.tooltip?.visible && this.scene._tooltipTarget === this) {
            this.scene.refreshTooltip();
        }
    }

    /** cook.method from the tool in the catalyst slot, or null. */
    getCatalystMethod() {
        const stack = this.getCatalyst();
        if (!stack) return null;
        return this.scene.getItem(stack.id)?.cook?.method || null;
    }

    getSimmer(index) {
        return this.entry.simmer[index] || null;
    }

    setSimmer(index, stack) {
        this.entry.simmer[index] = stack;
        this.scene.campfirePanel?.refresh();
        if (this.scene.tooltip?.visible && this.scene._tooltipTarget === this) {
            this.scene.refreshTooltip();
        }
    }

    simmerFilledCount() {
        return this.entry.simmer.filter(s => s && isSimmerIngredient(s.id)).length;
    }

    /** Any item still sitting in simmer slots (including rot/junk). */
    hasSimmerContents() {
        return this.entry.simmer.some(s => !!s);
    }

    clearSimmer() {
        this.entry.simmer = [null, null, null, null];
    }

    _wearRoastCatalyst(rate = 1) {
        if (this.scene.simAuth()) return;
        if (typeof Durability === "undefined") return;
        const stack = this.entry.catalyst;
        if (!stack) return;
        const def = this.scene.getItem(stack.id);
        const result = Durability.applyDurabilityUse(
            stack,
            Durability.COOK_WEAR_PER_MINUTE * Math.max(0, Number(rate) || 0),
            def
        );
        if (!result.broke) return;
        const name = Durability.stackDisplayName(stack, def);
        const cook = this.entry.cook;
        if (cook?.id) {
            const item = this.scene.getItem(cook.id);
            if (item && typeof DroppedItem !== "undefined") {
                const extras = typeof mealStackExtras === "function" ? mealStackExtras(cook) : null;
                const spoilAt = typeof spoilAtForWorld === "function"
                    ? spoilAtForWorld(cook, this.scene.worldMinuteIndex?.())
                    : cook.spoilAt;
                DroppedItem.spawn(
                    this.scene,
                    this.x,
                    this.y + 12,
                    item,
                    cook.quantity || 1,
                    spoilAt,
                    extras
                );
            }
            this.entry.cook = null;
            this.entry.cookProgress = 0;
            delete this.entry.roastBarMinutes;
        }
        this.entry.catalyst = null;
        this.entry.catalystReserved = false;
        const weapon = (typeof CombatLog !== "undefined" && CombatLog.COLOR_WEAPON) || "#f0a040";
        const chat = Durability.breakChat(name, { world: true, weaponColor: weapon });
        this.scene.combatLog?.push(chat.text, { segments: chat.segments });
        this.scene.campfirePanel?.refresh?.();
        if (this.scene.hotbar) this.scene.hotbar.dirty = true;
    }

    applySmokeVisual() {
        const method = this.getCatalystMethod();
        const hangKey = "drying_rack_hanging";
        if (method === "smoke_hide" && this.scene.textures.exists(hangKey)) {
            if (!this._smokeRackSpr || this._smokeRackKey !== hangKey) {
                this._smokeRackSpr?.destroy();
                this._smokeRackSpr = this.scene.add.image(this.x, this.y, hangKey);
                this._smokeRackKey = hangKey;
                this.scene.mainLayer?.add(this._smokeRackSpr);
            }
            this._smokeRackSpr.setOrigin(0.5, 1);
            this._smokeRackSpr.setPosition(this.x, this.y);
            this._smokeRackSpr.setDepth(this.y + 0.4);
            this._smokeRackSpr.setVisible(true);
        } else {
            this._destroySmokeRack();
        }

        const cook = this.getCook();
        const hideMeta = cook ? this.scene.getItem(cook.id) : null;
        const hideTex = hideMeta?.key || cook?.id;
        if (method === "smoke_hide" && cook && hideTex && this.scene.textures.exists(hideTex)) {
            if (!this._smokeHideSpr || this._smokeHideKey !== hideTex) {
                this._smokeHideSpr?.destroy();
                this._smokeHideSpr = this.scene.add.image(this.x, this.y, hideTex);
                this._smokeHideKey = hideTex;
                this.scene.mainLayer?.add(this._smokeHideSpr);
            }
            this._smokeHideSpr.setOrigin(0.5, 0);
            this._smokeHideSpr.setScale(0.5);
            const rodY = this.y - (this.height || 16) + 6;
            this._smokeHideSpr.setPosition(this.x, rodY);
            this._smokeHideSpr.setDepth(this.y + 0.5);
            this._smokeHideSpr.setVisible(true);
        } else {
            this._destroySmokeHide();
        }
    }

    _destroySmokeRack() {
        if (this._smokeRackSpr) {
            this._smokeRackSpr.destroy();
            this._smokeRackSpr = null;
        }
        this._smokeRackKey = null;
    }

    _destroySmokeHide() {
        if (this._smokeHideSpr) {
            this._smokeHideSpr.destroy();
            this._smokeHideSpr = null;
        }
        this._smokeHideKey = null;
    }

    _destroySmokeVisual() {
        this._destroySmokeRack();
        this._destroySmokeHide();
    }

    isRoastAdvancing() {
        if (typeof Fire === "undefined") return false;
        const method = this.getCatalystMethod();
        if (method === "shell_simmer") return false;
        return Fire.isCookAdvancing(this.entry, (id) => this._getItem(id));
    }

    _simmerCanAdvance() {
        if (typeof Fire === "undefined") return false;
        return Fire.simmerCanAdvance(this.entry, (id) => this._getItem(id));
    }

    isSimmerAdvancing() {
        if (typeof Fire === "undefined") return false;
        return Fire.isCookAdvancing(this.entry, (id) => this._getItem(id))
            && (this.getCatalystMethod() === "shell_simmer" || this.hasSimmerContents());
    }

    _finishSimmerMeal(entry) {
        const ids = (entry?.simmer || [])
            .filter((s) => s && isSimmerIngredient(s.id))
            .map((s) => s.id);
        const coconutMeta = this.scene.getItem(entry?.catalyst?.id);
        const meal = makeCoconutMealStack(
            (id) => this.scene.getItem(id),
            ids,
            coconutMeta,
            this.scene.worldMinuteIndex?.()
        );
        this.clearSimmer();
        this.setCatalyst(meal);
    }
}

/**
 * Player-placed storage. `entry` lives in chunk.meta.things (mutated in place for save).
 */
class Storage extends Thing {
    constructor(scene, entry) {
        super(scene, entry.x, entry.y, entry.id, entry);
        const def = scene.getThing(entry.id);
        if (typeof Place !== "undefined") Place.ensureStorageEntry(entry, def);
        else {
            if (!Array.isArray(entry.slots)) entry.slots = [null, null, null, null, null, null];
            if (entry.rot == null) entry.rot = 0;
        }
        this.applyVisual();

        this.setInteractive({ cursor: "pointer" });
        this.on("pointerover", (pointer) => {
            if (this.scene.storagePanel?.visible && this.scene.storagePanel.storage === this
                && this.scene.pointerOverWorldUi?.(pointer)) return;
            this.scene.showTooltip(
                () => this.tooltipText(),
                pointer.x,
                pointer.y,
                this
            );
        });
        this.on("pointerout", () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) this.scene.hideTooltip();
        });
        this.on("pointerdown", (pointer) => {
            if (pointer.rightButtonDown()) return;
            if (this.scene.pointerOverWorldUi?.(pointer)) return;
            if (this.scene.restBlocksWorldUi?.()) return;
            if (!this.inRange()) return;
            if (this.onInteract(pointer)) return;
            this.scene.storagePanel?.toggle(this);
        });
        this.on("destroy", () => {
            if (this.scene.storagePanel?.storage === this) {
                this.scene.storagePanel.close();
            }
        });
    }

    inRange(pawn) {
        const p = pawn || this.scene.player;
        if (!p) return false;
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        const r = this.scene.tileSize * (p.interactionRange || 4);
        return dx * dx + dy * dy <= r * r;
    }

    _slotCount() {
        const slots = this.entry?.slots || [];
        if (typeof Place !== "undefined") {
            return Place.storageSlotCount(this.meta, this.entry) || slots.length || 8;
        }
        return slots.length || 8;
    }

    /** Occupied stacks, wrapped like the storage grid (basket 8 → two rows of 4). */
    storageTooltipRows() {
        const slots = this.entry?.slots || [];
        const total = this._slotCount();
        const cols = typeof Place !== "undefined"
            ? Place.storageLayoutCols(total)
            : Math.min(4, Math.max(1, total));
        const items = [];
        for (let i = 0; i < total; i++) {
            const s = slots[i];
            if (s?.id && (s.quantity == null || s.quantity > 0)) items.push(s);
        }
        if (!items.length) return [];
        const rows = [];
        for (let i = 0; i < items.length; i += cols) {
            rows.push(items.slice(i, i + cols));
        }
        return rows;
    }

    tooltipText() {
        const name = this.meta?.name || "Storage";
        const total = this._slotCount();
        const slots = this.entry?.slots || [];
        let used = 0;
        for (let i = 0; i < total; i++) {
            const s = slots[i];
            if (s && s.quantity > 0) used++;
        }
        const text = `${name} (${used}/${total})`;
        const rows = this.storageTooltipRows();
        return rows.length ? { text, rows } : text;
    }

    getSlot(index) {
        const slots = this.entry?.slots;
        if (!Array.isArray(slots)) return null;
        return slots[index] || null;
    }

    setSlot(index, stack) {
        this.entry.slots[index] = stack;
        this.scene.storagePanel?.refresh();
        if (this.scene.tooltip?.visible && this.scene._tooltipTarget === this) {
            this.scene.refreshTooltip();
        }
    }

    isEmpty() {
        if (typeof Place !== "undefined") return Place.isStorageEmpty(this.entry);
        return (this.entry.slots || []).every((s) => !s || !(s.quantity > 0));
    }

    onInteract(_pointer) {
        return false;
    }

    static create(scene, entry) {
        const def = scene.getThing(entry?.id);
        if (typeof Hide !== "undefined" && Hide.isDryingRack(def, entry)) {
            return new DryingRack(scene, entry);
        }
        if (typeof Research !== "undefined" && Research.isPaintingCircle?.(def, entry)) {
            return new PaintingCircle(scene, entry);
        }
        return new Storage(scene, entry);
    }
}

class DryingRack extends Storage {
    constructor(scene, entry) {
        super(scene, entry);
        this.on("destroy", () => this._destroyHang());
    }

    hangingKey() {
        if (typeof Hide !== "undefined") return Hide.hangingTextureKey(this.meta);
        return `${this.meta?.key || "drying_rack"}_hanging`;
    }

    hangingStack() {
        const stack = this.getSlot(0);
        if (!stack || !(stack.quantity > 0)) return null;
        return stack;
    }

    applyVisual() {
        const stack = this.hangingStack();
        const hangKey = this.hangingKey();
        if (stack) {
            if (this.anims?.isPlaying) this.stop();
            if (this.scene.textures.exists(hangKey)) this.setTexture(hangKey);
            else super.applyVisual();
        } else {
            super.applyVisual();
        }
        this._syncHang(stack);
    }

    setSlot(index, stack) {
        super.setSlot(index, stack);
        this.applyVisual();
    }

    onInteract(_pointer) {
        if (this.scene.player?.beginFlesh?.(this)) return true;
        if (this.scene.player?.beginBrain?.(this)) return true;
        if (this.scene.storagePanel?.tryHangHeldHide?.(this)) return true;
        return false;
    }

    tooltipText() {
        const name = this.meta?.name || "Drying Rack";
        const stack = this.hangingStack();
        if (!stack) return `${name} (empty)`;
        const meta = this.scene.getItem(stack.id);
        const hideName = meta?.name || stack.id;
        let text = `${name} (${hideName})`;
        if (typeof Hide !== "undefined" && Hide.isFleshedHide(meta)) {
            const prog = Hide.dryProgressOf(stack);
            const max = Hide.DRY_MINUTES || 1440;
            const pct = Math.max(0, Math.min(100, Math.floor((prog / max) * 100)));
            text = `${name} (${hideName}, ${pct}% dry)`;
        }
        return { text, rows: [[stack]] };
    }

    _syncHang(stack) {
        if (!stack) {
            this._destroyHang();
            return;
        }
        const meta = this.scene.getItem(stack.id);
        const tex = meta?.key || stack.id;
        if (!tex || !this.scene.textures.exists(tex)) {
            this._destroyHang();
            return;
        }
        // Recreate when the hide stage changes — Layer images can keep the
        // previous GPU texture after setTexture (truecolor raw vs paletted later stages).
        if (!this._hangSpr || this._hangKey !== tex) {
            this._destroyHang();
            this._hangSpr = this.scene.add.image(this.x, this.y, tex);
            this._hangKey = tex;
            this.scene.mainLayer?.add(this._hangSpr);
        }
        // Top of the hide sits on the rod so the pelt hangs below it (not centered on it).
        this._hangSpr.setOrigin(0.5, 0);
        this._hangSpr.setScale(0.5);
        const rodY = this.y - (this.height || 16) + 6;
        this._hangSpr.setPosition(this.x, rodY);
        this._hangSpr.setDepth(this.y + 0.5);
        this._hangSpr.setVisible(true);
    }

    _destroyHang() {
        if (this._hangSpr) {
            this._hangSpr.destroy();
            this._hangSpr = null;
        }
        this._hangKey = null;
    }
}

class CraftStation extends Thing {
    constructor(scene, entry) {
        super(scene, entry.x, entry.y, entry.id, entry);
        if (typeof Place !== "undefined") Place.ensureCraftStationEntry(entry);
        this.applyVisual();
        scene.wireCraftStation?.(this);
    }

    inRange(pawn) {
        const p = pawn || this.scene.player;
        if (!p) return false;
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        const r = this.scene.tileSize * (p.interactionRange || 4);
        return dx * dx + dy * dy <= r * r;
    }

    tooltipText() {
        return this.meta?.name || "Craft";
    }

    isEmpty() {
        return true;
    }
}

class LeanTo extends Thing {
    constructor(scene, entry) {
        const def = scene.getThing(entry.id);
        if (typeof Place !== "undefined") Place.ensureSleepEntry(entry, def);
        const ts = scene.tileSize || 16;
        const origin = typeof Place !== "undefined"
            ? Place.originTileOf(entry, ts)
            : { tx: 0, ty: 0 };
        const pos = typeof Place !== "undefined"
            ? Place.footprintWorldPos(origin.tx, origin.ty, entry.rot, Place.footprintSize(def), ts)
            : { x: entry.x, y: entry.y };
        super(scene, pos.x, pos.y, entry.id, entry);
        this.applyVisual();
        this.refreshCollision();
        this.setInteractive({ cursor: "pointer" });
        this.on("pointerover", (pointer) => {
            this.scene.showTooltip(
                () => this.tooltipText(),
                pointer.x,
                pointer.y,
                this
            );
        });
        this.on("pointerout", (pointer) => {
            const scene = this.scene;
            const p = pointer || scene?.input?.activePointer;
            if (p && this._pointerStillOver(p)) return;
            if (scene._hoverTarget === this) scene._hoverTarget = null;
            if (scene._tooltipTarget === this) scene.hideTooltip();
        });
        this.on("pointerdown", (pointer) => {
            if (pointer.rightButtonDown()) return;
            if (this.scene.pointerOverWorldUi?.(pointer)) return;
            this.scene.openLeanToPanel?.(this, pointer);
        });
        this.on("destroy", () => {
            this._destroyFrame();
            const scene = this.scene;
            if (scene?.leanToPanel?.leanTo === this) scene.leanToPanel.close();
            if (scene?._hoverTarget === this) scene._hoverTarget = null;
            if (scene?._tooltipTarget === this) scene.hideTooltip();
        });
    }

    applyVisual() {
        let tex = this.meta?.key;
        if (typeof Place !== "undefined" && Array.isArray(this.meta?.rotations) && this.meta.rotations.length) {
            const rotTex = Place.rotationTextureKey(this.meta.key, this.entry?.rot);
            if (this.scene.textures.exists(rotTex)) tex = rotTex;
        }
        if (this.meta?.anim || !tex || this.texture?.key !== tex) {
            super.applyVisual();
        }
        this.setDepth(this._floorDepth());
        this._syncFrame();
    }

    _pointerStillOver(pointer) {
        const scene = this.scene;
        if (!scene?.cameras?.main || !pointer) return false;
        const b = this.getBounds?.();
        if (!b) return false;
        const wpt = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(b, wpt.x, wpt.y);
    }

    _floorDepth() {
        const h = this.displayHeight || this.height || 16;
        return (Number(this.y) || 0) - h - 1;
    }

    frameTextureKey() {
        if (typeof Place === "undefined") return "";
        return Place.rotationFrameTextureKey(this.meta?.key, this.entry?.rot);
    }

    _syncFrame() {
        const tex = this.frameTextureKey();
        if (!tex || !this.scene.textures.exists(tex)) {
            this._destroyFrame();
            return;
        }
        if (!this._frameSpr || this._frameKey !== tex) {
            this._destroyFrame();
            this._frameSpr = this.scene.add.image(this.x, this.y, tex);
            this._frameKey = tex;
            this.scene.mainLayer?.add(this._frameSpr);
        }
        this._frameSpr.setOrigin(0.5, 1);
        this._frameSpr.setPosition(this.x, this.y);
        this._frameSpr.setDepth(this.y + 2);
        this._frameSpr.setVisible(true);
    }

    _destroyFrame() {
        if (this._frameSpr) {
            this._frameSpr.destroy();
            this._frameSpr = null;
        }
        this._frameKey = null;
    }

    refreshCollision() {
        if (this.hitboxSize > 0 || this.meta?.sleep) {
            if (!this.body) this.createCollision();
            else this._positionBody();
        }
    }

    inRange() {
        const p = this.scene.player;
        if (!p) return false;
        if (typeof Sleep !== "undefined") {
            return Sleep.inHarvestRange(
                p.x, p.y, this.entry,
                this.scene.tileSize,
                p.interactionRange,
                this.meta
            );
        }
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        const r = this.scene.tileSize * p.interactionRange;
        return dx * dx + dy * dy <= r * r;
    }

    slotAtPointer(pointer) {
        const scene = this.scene;
        if (!scene?.cameras?.main || !pointer) return 0;
        const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const ts = this.scene.tileSize || 16;
        if (typeof Place !== "undefined" && Place.entryFootprintTiles) {
            const tiles = Place.entryFootprintTiles(this.entry, ts, this.meta);
            if (tiles.length) {
                let best = 0;
                let bestD = Infinity;
                for (let i = 0; i < tiles.length; i++) {
                    const cx = tiles[i].tx * ts + ts / 2;
                    const cy = tiles[i].ty * ts + ts / 2;
                    const dx = world.x - cx;
                    const dy = world.y - cy;
                    const d = dx * dx + dy * dy;
                    if (d < bestD) {
                        bestD = d;
                        best = i;
                    }
                }
                return best;
            }
        }
        if (typeof Sleep === "undefined") return 0;
        const { tx, ty } = scene.worldToTile(world.x, world.y);
        const slot = Sleep.slotIndexFromTile(
            this.entry, tx, ty, ts, this.meta
        );
        return slot >= 0 ? slot : 0;
    }

    occupantPawn(slot) {
        const id = this.entry?.occupants?.[slot];
        if (!id) return null;
        const scene = this.scene;
        return (scene.party || []).find((p) => p.pawnId === id)
            || (scene.settlers || []).find((p) => p.pawnId === id)
            || scene.partySys?.wanderers?.find?.((p) => p.pawnId === id)
            || null;
    }

    occupantName(slot) {
        const pawn = this.occupantPawn(slot);
        if (pawn) {
            const name = pawn.displayName?.() || pawn.pawnName;
            if (name) return name;
        }
        const id = this.entry?.occupants?.[slot];
        if (!id) return "Empty";
        for (const rp of this.scene.remotePlayers?.values?.() || []) {
            if (rp.id === id) return rp.displayName || "Empty";
        }
        return "Occupied";
    }

    tooltipText(pointer) {
        if (!this.scene || !this.active) return "";
        const p = pointer || this.scene.input?.activePointer;
        const slot = p ? this.slotAtPointer(p) : 0;
        const pawn = this.occupantPawn(slot);
        if (pawn && pawn.role !== "wanderer") {
            const inParty = pawn.role === "companion"
                || pawn.role === "leader"
                || (this.scene.party || []).includes(pawn);
            const parked = pawn.role === "settler"
                || !!pawn.homeSettlementId
                || (this.scene.settlers || []).includes(pawn);
            if (inParty || parked) {
                const tip = this.scene.partySys?.hoverTooltip?.(pawn);
                if (tip) return tip;
            }
        }
        const who = this.occupantName(slot);
        const name = this.meta?.name || "Lean-to";
        return `${name}\n${who}`;
    }
}

class SettlingStone extends Thing {
    constructor(scene, entry) {
        super(scene, entry.x, entry.y, entry.id || "settling_stone", entry);
        if (typeof Place !== "undefined") Place.ensureSettlementEntry(entry);
        this.setInteractive({ cursor: "pointer" });
        this.on("pointerover", (pointer) => {
            scene.showTooltip(() => this.tooltipText(), pointer.x, pointer.y, this);
        });
        this.on("pointerout", () => {
            if (scene._hoverTarget === this) scene._hoverTarget = null;
            if (scene._tooltipTarget === this) scene.hideTooltip();
        });
        this.on("pointerdown", (pointer) => {
            if (pointer.rightButtonDown()) return;
            if (scene.pointerOverWorldUi?.(pointer)) return;
            if (scene.restBlocksWorldUi?.()) return;
            if (!this.inRange()) return;
            if (scene.knappingPanel?.tryOpenAtRock?.(this)) return;
            scene.settlementSys?.openFromStone?.(this);
        });
        this.on("destroy", () => {
            if (scene.settlementPanel?.stone === this) scene.settlementPanel.close();
        });
    }

    inRange() {
        const p = this.scene.player;
        if (!p) return false;
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        const r = this.scene.tileSize * (p.interactionRange || 4);
        return dx * dx + dy * dy <= r * r;
    }

    tooltipText() {
        const knap = this.scene._rockKnapTooltipText?.();
        if (knap) return knap;
        const settle = this.scene.settlementSys?.byStoneUid?.(this.entry?.uid);
        return settle?.name || this.meta?.name || "Settling Stone";
    }
}

class PaintingCircle extends Thing {
    constructor(scene, entry) {
        super(scene, entry.x, entry.y, entry.id, entry);
        this.entry = entry;
        if (typeof Research !== "undefined") Research.ensureEntry(this.entry, this.meta);
        if (!this._paintOverlays) this._paintOverlays = [];
        this.setInteractive({ cursor: "pointer" });
        this.on("pointerover", (pointer) => {
            if (this.scene.paintingCirclePanel?.visible && this.scene.paintingCirclePanel.circle === this
                && this.scene.pointerOverWorldUi?.(pointer)) return;
            this.scene.showTooltip(
                () => this.tooltipText(),
                pointer.x,
                pointer.y,
                this
            );
        });
        this.on("pointerout", () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) this.scene.hideTooltip();
        });
        this.on("pointerdown", (pointer) => {
            if (pointer.rightButtonDown()) return;
            if (this.scene.pointerOverWorldUi?.(pointer)) return;
            if (this.scene.restBlocksWorldUi?.()) return;
            if (!this.inRange()) return;
            if (this.scene.tryInstallTallyStick?.(this)) {
                this.scene.paintingCirclePanel?.open(this);
                return;
            }
            this.scene.paintingCirclePanel?.toggle(this);
        });
        this.on("destroy", () => {
            this._destroyOverlays();
            this._destroyPaintFx();
            if (this.scene.paintingCirclePanel?.circle === this) {
                this.scene.paintingCirclePanel.close();
            }
        });
        this.applyVisual();
    }

    inRange(pawn) {
        const p = pawn || this.scene.player;
        if (!p) return false;
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        const r = this.scene.tileSize * (p.interactionRange || 4);
        return dx * dx + dy * dy <= r * r;
    }

    _destroyOverlays() {
        for (const img of this._paintOverlays || []) img?.destroy?.();
        this._paintOverlays = [];
        this._tallySpr?.destroy?.();
        this._tallySpr = null;
        this._ghostSpr?.destroy?.();
        this._ghostSpr = null;
    }

    _destroyPaintFx() {
        const st = this._paintBurst;
        if (st) {
            for (const b of st.bits || []) {
                try { b.obj?.destroy?.(); } catch (_) {}
            }
        }
        this._paintBurst = null;
        this._ghostSpr?.destroy?.();
        this._ghostSpr = null;
    }

    _ensureGhost() {
        if (this._ghostSpr?.active) return this._ghostSpr;
        const spr = this.scene.add.image(this.x, this.y, "slot")
            .setOrigin(0.5, 1)
            .setVisible(false)
            .setAlpha(0);
        this._ghostSpr = spr;
        const layer = this.scene.groundLayer;
        if (layer) layer.add(spr);
        spr.setDepth(0.57);
        return spr;
    }

    pulseGhost() {
        this._ghostPulse = 1;
    }

    _burstPaintFlecks(index) {
        const R = typeof Research !== "undefined" ? Research : null;
        if (!R || typeof spawnPaintFleck !== "function") return;
        const getItem = (id) => this.scene.getItem?.(id);
        const tint = R.overlayTint
            ? R.overlayTint(this.entry, index, getItem)
            : 0xffffff;
        const facing = R.workFacingForIndex
            ? R.workFacingForIndex(index)
            : "up";
        const wall = R.paintWallLocal?.(facing) || { x: 0, y: -14 };
        if (!this._paintBurst) this._paintBurst = { bits: [] };
        const cx = this.x;
        const cy = this.y - 8;
        const n = 5 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) {
            const kind = R.pickPaintFleckKind?.(Math.random) || "base";
            const color = R.paintFleckTint ? R.paintFleckTint(tint, kind) : tint;
            const tx = this.x + wall.x + (Math.random() * 2.4 - 1.2);
            const ty = this.y + wall.y + (Math.random() * 2.4 - 1.2);
            spawnPaintFleck(this.scene, this._paintBurst, {
                x0: cx + (Math.random() * 2 - 1),
                y0: cy + (Math.random() * 2 - 1),
                x1: tx,
                y1: ty,
                color,
                size: Math.random() < 0.4 ? 2 : 1,
                life: 420 + Math.random() * 220,
                depth: Math.round(this.y) + 2
            });
        }
    }

    tickPaintFx(delta) {
        if (!this.active) return;
        const R = typeof Research !== "undefined" ? Research : null;
        if (!R) return;
        R.ensureEntry(this.entry, this.meta);
        const n = R.paintedCount(this.entry);
        if (this._fxPainted == null) this._fxPainted = n;
        else if (n > this._fxPainted) {
            this._burstPaintFlecks(n - 1);
            this._fxPainted = n;
        } else {
            this._fxPainted = n;
        }

        const dt = Math.max(0, Number(delta) || 16);
        this._ghostPulse = Math.max(0, (this._ghostPulse || 0) - dt / 180);
        if (this._paintBurst) {
            if (typeof _tickPaintFleckBits === "function") _tickPaintFleckBits(this._paintBurst, dt);
            if (!this._paintBurst.bits?.length) this._paintBurst = null;
        }

        const inProg = R.inProgress(this.entry) && n < ((R.PAINT_MAX) || 6);
        if (!inProg) {
            if (this._ghostSpr) this._ghostSpr.setVisible(false);
            return;
        }
        const ghost = this._ensureGhost();
        const keyBase = this.meta?.key || "painting_circle";
        const tex = R.overlayKey(n + 1, keyBase);
        if (!this.scene.textures.exists(tex)) {
            ghost.setVisible(false);
            return;
        }
        const getItem = (id) => this.scene.getItem?.(id);
        const pigmentId = R.currentPigmentId?.(this.entry) || this.entry?.paintPigment;
        const tint = R.pigmentTint?.(getItem?.(pigmentId), { id: pigmentId }) || 0xffffff;
        const prog = Number(this.entry?.paintProgress) || 0;
        const pulse = this._ghostPulse || 0;
        const now = this.scene.time?.now || 0;
        const alpha = R.ghostOverlayAlpha
            ? R.ghostOverlayAlpha(prog, now, pulse)
            : 0.2 + 0.4 * prog;
        ghost.setTexture(tex);
        ghost.setTint(tint);
        ghost.setPosition(this.x, this.y);
        ghost.setScale(1 + 0.04 * pulse);
        ghost.setAlpha(alpha);
        ghost.setVisible(true);
        const layer = this.scene.groundLayer;
        if (layer && ghost.displayList !== layer) layer.add(ghost);
        ghost.setDepth(0.57);
    }

    /** Floor decal: always under creatures (mainLayer), over tiles, under drops. */
    _toFloorLayer() {
        const layer = this.scene.groundLayer;
        if (layer && this.displayList !== layer) layer.add(this);
        this.setDepth(0.5);
        for (let i = 0; i < (this._paintOverlays || []).length; i++) {
            const img = this._paintOverlays[i];
            if (!img) continue;
            if (layer && img.displayList !== layer) layer.add(img);
            img.setDepth(0.5 + (i + 1) * 0.01);
        }
        if (this._tallySpr?.active) {
            if (layer && this._tallySpr.displayList !== layer) layer.add(this._tallySpr);
            this._tallySpr.setDepth(0.505);
        }
        if (this._ghostSpr?.active) {
            if (layer && this._ghostSpr.displayList !== layer) layer.add(this._ghostSpr);
            this._ghostSpr.setDepth(0.57);
        }
    }

    applyVisual() {
        super.applyVisual();
        if (typeof Research !== "undefined") Research.ensureEntry(this.entry, this.meta);
        const n = typeof Research !== "undefined" ? Research.paintedCount(this.entry) : 0;
        const keyBase = this.meta?.key || "painting_circle";
        if (!this._paintOverlays) this._paintOverlays = [];
        while (this._paintOverlays.length < 6) {
            const img = this.scene.add.image(this.x, this.y, "slot")
                .setOrigin(0.5, 1)
                .setVisible(false);
            this._paintOverlays.push(img);
        }
        for (let i = 0; i < 6; i++) {
            const img = this._paintOverlays[i];
            if (!img) continue;
            img.setPosition(this.x, this.y);
            const tex = typeof Research !== "undefined"
                ? Research.overlayKey(i + 1, keyBase)
                : `${keyBase}_${i + 1}`;
            if (i < n && this.scene.textures.exists(tex)) {
                img.setTexture(tex).setVisible(true);
                const tint = typeof Research !== "undefined" && Research.overlayTint
                    ? Research.overlayTint(this.entry, i, (id) => this.scene.getItem?.(id))
                    : 0xffffff;
                img.setTint(tint);
            } else {
                img.clearTint();
                img.setVisible(false);
            }
        }
        const tallyKey = typeof Research !== "undefined" && Research.tallyOverlayKey
            ? Research.tallyOverlayKey(keyBase)
            : "painting_circle_upgrade_stick";
        const showTally = typeof Research !== "undefined" && Research.hasTally?.(this.entry)
            && this.scene.textures.exists(tallyKey);
        if (showTally) {
            if (!this._tallySpr?.active) {
                this._tallySpr?.destroy?.();
                this._tallySpr = this.scene.add.image(this.x, this.y, tallyKey)
                    .setOrigin(0.5, 1)
                    .setVisible(true);
            } else {
                this._tallySpr.setTexture(tallyKey);
                this._tallySpr.setPosition(this.x, this.y);
                this._tallySpr.setVisible(true);
            }
        } else if (this._tallySpr) {
            this._tallySpr.setVisible(false);
        }
        this._toFloorLayer();
        if (this.body) this._positionBody();
        this._syncInteractMark();
    }

    tooltipText() {
        if (typeof Research !== "undefined") Research.ensureEntry(this.entry, this.meta);
        const painted = typeof Research !== "undefined" ? Research.paintedCount(this.entry) : 0;
        const max = (typeof Research !== "undefined" && Research.PAINT_MAX) || 6;
        const name = this.meta?.name || "Painting Circle";
        const lines = [`${name} (${painted}/${max})`];
        const prog = Number(this.entry?.paintProgress) || 0;
        if (this.entry?.paintStarted || prog > 0) {
            const num = painted + 1;
            lines.push(`Painting ${num} (${Math.floor(prog * 100)}%)`);
        }
        const pigmentId = typeof Research !== "undefined" ? Research.currentPigmentId(this.entry) : this.entry?.paintPigment;
        if (pigmentId) {
            const name = this.scene.getItem?.(pigmentId)?.name || pigmentId;
            lines.push(`Pigment: ${name}`);
        } else if (typeof Research === "undefined" || Research.hasRoom(this.entry)) {
            lines.push("Pigment: empty");
        }
        if (typeof Research !== "undefined" && Research.hasTally?.(this.entry)) {
            lines.push("Tally Stick");
        }
        return lines.join("\n");
    }
}