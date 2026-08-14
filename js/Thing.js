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
            return;
        }
        if (this.anims?.isPlaying) this.stop();
        if (typeof Place !== "undefined" && Array.isArray(this.meta.rotations) && this.meta.rotations.length) {
            const tex = Place.rotationTextureKey(this.meta.key, this.entry?.rot);
            if (this.scene.textures.exists(tex)) {
                this.setTexture(tex);
                return;
            }
        }
        this.setTexture(this.meta.key);
    }

    setup(hitboxSize=0) {
        this.hitboxSize = hitboxSize;
        if (hitboxSize > 0) {
            if (!this.body) this.createCollision();
            else this._positionBody();
        } else if (this.body) this.disableCollision();
    }

    createCollision() {
        this.scene.physics.add.existing(this, true);
        this._positionBody();
        this.body.enable = true;
        if (!this._inStaticGroup) {
            this.scene._things.add(this);
            this._inStaticGroup = true;
        }
    }

    _positionBody() {
        const ts = this.scene?.tileSize || 16;
        const fp = typeof Place !== "undefined" ? Place.footprintSize(this.meta) : [1, 1];
        // Lean-tos only. Do not call refreshBody() — it copies the full sprite.
        if (
            (fp[0] > 1 || fp[1] > 1)
            && typeof Place !== "undefined"
            && this.entry
            && Place.collisionWorldRect
        ) {
            const rect = Place.collisionWorldRect(this.entry, this.meta, ts);
            if (rect) {
                const bw = rect.right - rect.left;
                const bh = rect.bottom - rect.top;
                const ox = rect.left - (this.x - this.width * 0.5);
                const oy = rect.top - (this.y - this.height);
                this.body.setSize(bw, bh).setOffset(ox, oy);
                return;
            }
        }
        const hs = this.hitboxSize;
        this.body.setSize(hs, hs)
            .setOffset((this.width - hs) * 0.5, this.height - hs);
    }

    disableCollision() {
        this.scene.physics.world.disable(this);
        this.body = null;
        if (this._inStaticGroup) {
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
        const loot = this.meta?.lootable;
        if (!loot || !this.entry) return;

        // Dedicated MP: server owns lootables + inventory (YOU).
        if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
            this.scene._netSendMove?.(true);
            this.scene.net.sendAction({
                type: NetProtocol.Actions.HARVEST,
                uid: this.entry?.uid || null,
                id: this.meta?.id || this.entry?.id || null,
                x: this.x,
                y: this.y,
                pawnId: this.scene.player?.pawnId
            });
            return;
        }

        const harvestedId = this.meta.id;
        const item = this.scene.getItem(loot.item);
        const remaining = this.scene.player.gainItem(item, loot.yield);
        if (remaining > 0) DroppedItem.spawn(this.scene, this.x, this.y, item, remaining);
        this.scene.hideTooltip();

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
        if (entry.cookProgress == null) entry.cookProgress = 0;
        // burnRemaining: minutes left on the unit already in the fire (pulled from a slot)
        if (entry.burnRemaining == null) {
            // Migrate old burnProgress (minutes into current stack item, not yet pulled)
            entry.burnRemaining = 0;
            delete entry.burnProgress;
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

    inRange() {
        const dx = this.x - this.scene.player.x;
        const dy = this.y - this.scene.player.y;
        const r = this.scene.tileSize * this.scene.player.interactionRange;
        return dx * dx + dy * dy <= r * r;
    }

    tooltipText() {
        const lines = [this.meta.name];
        if (this.isLit()) {
            const mins = campfireBurnMinutes(
                (id) => this.scene.getItem(id),
                this.entry.fuel,
                this.entry.burnRemaining
            );
            if (mins <= 0) lines.push('Burn time: <1h');
            else lines.push(`Burn time: ${formatHours(Math.floor(mins / 60))}`);
        } else {
            lines.push(this.hasFuel() ? 'Needs firestarter' : 'Needs fuel');
        }
        return lines.join('\n');
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

    /**
     * Pull one fuel unit from left→right into the fire. Returns kj (minutes) or 0.
     */
    consumeFuelUnit() {
        for (let i = 0; i < 2; i++) {
            const stack = this.entry.fuel[i];
            if (!stack) continue;
            const item = this.scene.getItem(stack.id);
            const kj = Number(item?.fuel?.kj ?? 0);
            if (kj <= 0) continue;

            stack.quantity -= 1;
            if (stack.quantity <= 0) this.entry.fuel[i] = null;
            this.entry.burnRemaining = kj;
            this.scene.campfirePanel?.refresh();
            if (this.scene.tooltip?.visible && this.scene._tooltipTarget === this) {
                this.scene.refreshTooltip();
            }
            return kj;
        }
        return 0;
    }

    /** If lit with nothing actively burning, pull the next fuel unit. */
    ensureBurning() {
        if (!this.isLit()) return false;
        if ((this.entry.burnRemaining || 0) > 0) return true;
        return this.consumeFuelUnit() > 0;
    }

    /**
     * Burn 1 minute off the active unit; pull the next when empty.
     * Removing slot fuel does not snuff the unit already in the fire.
     * Returns true if became unlit.
     */
    burnMinute() {
        if (!this.isLit()) return false;

        if ((this.entry.burnRemaining || 0) > 0) {
            this.entry.burnRemaining -= 1;
        }

        if ((this.entry.burnRemaining || 0) <= 0) {
            if (!this.consumeFuelUnit()) {
                this.entry.burnRemaining = 0;
                this.setKind('unlit_campfire');
                return true;
            }
        }

        this.scene.campfirePanel?.refresh();
        if (this.scene.tooltip?.visible && this.scene._tooltipTarget === this) {
            this.scene.refreshTooltip();
        }
        return false;
    }

    getFuel(index) {
        return this.entry.fuel[index] || null;
    }

    setFuel(index, stack) {
        this.entry.fuel[index] = stack;
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
        if (!stack || stack.id !== prevId) this.entry.cookProgress = 0;
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

    /**
     * Advance cooking by one game minute when conditions allow; otherwise pause.
     * @param {boolean} lit        campfire is burning
     * @param {boolean} attending  this campfire's menu is open (stick-roast only)
     */
    tickCook(lit, attending) {
        const method = this.getCatalystMethod();
        // Keep ticking simmer while vessel is valid, slots still hold leftovers, or progress is draining
        const simmerActive = method === "shell_simmer"
            || this.hasSimmerContents()
            || ((this.entry.cookProgress || 0) > 0 && (this.entry.simmerBarMinutes || 0) > 0);
        if (simmerActive) {
            this._tickShellSimmer(lit);
            return;
        }

        const cook = this.entry.cook;
        if (!cook) {
            this.applySmokeVisual();
            return;
        }

        const recipe = method
            ? getCookRecipe(id => this.scene.getItem(id), cook.id, method)
            : null;
        const smoke = method === "smoke_hide";
        const canAdvance = smoke
            ? !!(lit && method && recipe)
            : !!(lit && attending && method && recipe);

        if (!canAdvance) {
            // Stick-roast drains when the fire is out; smoke pauses.
            if (!smoke && (this.entry.cookProgress || 0) > 0 && !lit) {
                this.entry.cookProgress -= 1;
                if (this.entry.cookProgress <= 0) {
                    this.entry.cookProgress = 0;
                    delete this.entry.roastBarMinutes;
                }
                if (this.scene.campfirePanel?.campfire === this) {
                    this.scene.campfirePanel.refresh();
                }
            } else {
                this.scene.campfirePanel?.refreshCookBar?.();
            }
            this.applySmokeVisual();
            return;
        }

        this.entry.roastBarMinutes = recipe.minutes;
        this.entry.cookProgress = (this.entry.cookProgress || 0) + 1;
        if (!smoke) this._wearRoastCatalyst();
        if (this.entry.cookProgress >= recipe.minutes) {
            const resultMeta = this.scene.getItem(recipe.result);
            delete this.entry.roastBarMinutes;
            if (resultMeta) {
                this.setCook(makeWorldItemStack(resultMeta, cook.quantity || 1, undefined, this.scene.worldMinuteIndex?.()));
            } else {
                this.entry.cookProgress = 0;
                this.scene.campfirePanel?.refresh();
            }
            this.applySmokeVisual();
            return;
        }
        this.scene.campfirePanel?.refresh();
        this.applySmokeVisual();
    }

    _wearRoastCatalyst() {
        if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) return;
        if (typeof Durability === "undefined") return;
        const stack = this.entry.catalyst;
        if (!stack) return;
        const def = this.scene.getItem(stack.id);
        const result = Durability.applyDurabilityUse(
            stack,
            Durability.COOK_WEAR_PER_MINUTE,
            def
        );
        if (!result.broke) return;
        const name = Durability.stackDisplayName(stack, def);
        this.entry.catalyst = null;
        this.scene.combatLog?.push(Durability.breakMessage(name, false));
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
        if (!this.isLit()) return false;
        const cook = this.entry.cook;
        if (!cook) return false;
        const method = this.getCatalystMethod();
        if (!method) return false;
        const open = this.scene.campfirePanel?.visible
            && this.scene.campfirePanel.campfire === this;
        if (!open) return false;
        return !!getCookRecipe(id => this.scene.getItem(id), cook.id, method);
    }

    /** Lit + valid shell vessel + ≥2 valid ingredients + no junk in simmer slots. */
    _simmerCanAdvance(lit) {
        if (!lit) return false;
        if (this.getCatalystMethod() !== "shell_simmer") return false;
        let filled = 0;
        for (const s of this.entry.simmer) {
            if (!s) continue;
            if (!isSimmerIngredient(s.id)) return false;
            filled += 1;
        }
        return filled >= 2;
    }

    isSimmerAdvancing() {
        return this._simmerCanAdvance(this.isLit());
    }

    _refreshSimmerUi() {
        const panel = this.scene.campfirePanel;
        if (panel?.visible && panel.campfire === this) panel.refresh();
    }

    _tickShellSimmer(lit) {
        if (!this._simmerCanAdvance(lit)) {
            if ((this.entry.cookProgress || 0) > 0) {
                this.entry.cookProgress -= 1;
                if (this.entry.cookProgress <= 0) {
                    this.entry.cookProgress = 0;
                    delete this.entry.simmerBarMinutes;
                }
                this._refreshSimmerUi();
            } else {
                delete this.entry.simmerBarMinutes;
                this._refreshSimmerUi();
            }
            return;
        }

        const filled = this.simmerFilledCount();
        const need = filled * SIMMER_MINUTES_PER_SLOT;
        this.entry.simmerBarMinutes = need;
        this.entry.cookProgress = (this.entry.cookProgress || 0) + 1;
        if (this.entry.cookProgress >= need) {
            const ids = this.entry.simmer
                .filter(s => s && isSimmerIngredient(s.id))
                .map(s => s.id);
            const coconutMeta = this.scene.getItem(this.entry.catalyst?.id);
            const meal = makeCoconutMealStack(
                id => this.scene.getItem(id),
                ids,
                coconutMeta,
                this.scene.worldMinuteIndex?.()
            );
            this.clearSimmer();
            this.entry.cookProgress = 0;
            delete this.entry.simmerBarMinutes;
            this.setCatalyst(meal);
            return;
        }
        this._refreshSimmerUi();
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

    inRange() {
        const dx = this.x - this.scene.player.x;
        const dy = this.y - this.scene.player.y;
        const r = this.scene.tileSize * this.scene.player.interactionRange;
        return dx * dx + dy * dy <= r * r;
    }

    tooltipText() {
        const name = this.meta?.name || "Storage";
        const slots = this.entry?.slots || [];
        const total = typeof Place !== "undefined"
            ? (Place.storageSlotCount(this.meta, this.entry) || slots.length || 6)
            : (slots.length || 6);
        let used = 0;
        for (const s of slots) {
            if (s && s.quantity > 0) used++;
        }
        return `${name} (${used}/${total})`;
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
        if (typeof Hide !== "undefined" && Hide.isFleshedHide(meta)) {
            const prog = Hide.dryProgressOf(stack);
            const max = Hide.DRY_MINUTES || 1440;
            const pct = Math.max(0, Math.min(100, Math.floor((prog / max) * 100)));
            return `${name} (${hideName}, ${pct}% dry)`;
        }
        return `${name} (${hideName})`;
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

    inRange() {
        const dx = this.x - this.scene.player.x;
        const dy = this.y - this.scene.player.y;
        const r = this.scene.tileSize * this.scene.player.interactionRange;
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
                () => this.tooltipText(pointer),
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
        super.applyVisual();
        this.setDepth(this._floorDepth());
        this._syncFrame();
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

    occupantName(slot) {
        const id = this.entry?.occupants?.[slot];
        if (!id) return "Empty";
        const scene = this.scene;
        const pawn = (scene.party || []).find((p) => p.pawnId === id)
            || scene.partySys?.wanderers?.find?.((p) => p.pawnId === id);
        if (pawn?.pawnName || pawn?.displayName) return pawn.pawnName || pawn.displayName;
        for (const rp of scene.remotePlayers?.values?.() || []) {
            if (rp.id === id) return rp.displayName || "Empty";
        }
        return "Occupied";
    }

    tooltipText(pointer) {
        if (!this.scene || !this.active) return "";
        const slot = pointer ? this.slotAtPointer(pointer) : 0;
        const who = this.occupantName(slot);
        const name = this.meta?.name || "Lean-to";
        return `${name}\n${who}`;
    }
}