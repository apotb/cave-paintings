class Thing extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, id) {
        const meta = scene.getThing(id);
        super(scene, x, y, meta.key);
        this.meta = meta;
        this.scene = scene;
        this._inStaticGroup = false;
        this.setOrigin(0.5, 1);
        this.setDepth(this.y);
        scene.mainLayer.add(this);
        this.setup(meta.hitboxSize);
        this.applyVisual();
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
        if (!this.scene.anims.exists(key)) {
            this.scene.anims.create({
                key,
                frames: this.scene.anims.generateFrameNumbers(this.meta.key),
                frameRate: a.frameRate ?? 8,
                repeat: a.repeat ?? -1
            });
        }
        return key;
    }

    applyVisual() {
        if (this.meta.anim) {
            const key = this.ensureAnim();
            if (key) this.play(key, true);
        } else {
            if (this.anims?.isPlaying) this.stop();
            this.setTexture(this.meta.key);
        }
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

class LootableThing extends Thing {
    constructor(scene, x, y, id) {
        super(scene, x, y, id);
        this.on('pointerdown', () => {
            if (this.canPickup()) this.pickUp();
        });
        this.on('pointerover', (pointer) => {
            const itemMeta = this.scene.getItem(this.meta.lootable.item);
            const stack = { id: itemMeta?.id, quantity: this.meta.lootable.yield ?? 1 };
            this.scene.showTooltip(
                () => this.scene.formatItemTooltip(itemMeta, stack.quantity),
                pointer.x,
                pointer.y,
                this
            );
        });
        this.on('pointerout', () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) this.scene.hideTooltip();
        });
    }

    setup(hitboxSize=0) {
        super.setup(hitboxSize);
        this.setInteractive({ cursor: 'pointer' });
    }

    morph(id) {
        super.morph(id);
        if (this.meta.lootable) {
            this.setInteractive({ cursor: 'pointer' });
        } else {
            this.disableInteractive();
        }
    }

    canPickup() {
        const dx = this.x - this.scene.player.x;
        const dy = this.y - this.scene.player.y;
        const d2 = dx*dx + dy*dy;
        const r = this.scene.tileSize * this.scene.player.interactionRange;
        return d2 <= r*r;
    }

    pickUp() {
        const item = this.scene.getItem(this.meta.lootable.item);
        const remaining = this.scene.player.gainItem(item, this.meta.lootable.yield);
        if (remaining > 0) DroppedItem.spawn(this.scene, this.x, this.y, item, remaining);
        this.scene.hideTooltip();
        const transform = this.meta.lootable.transform;
        if (transform) {
            this.morph(transform);
        } else this.destroy();
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
            if (!this.inRange()) return;
            this.scene.campfirePanel?.toggle(this);
        });
        this.on('destroy', () => {
            if (this.scene.campfirePanel?.campfire === this) {
                this.scene.campfirePanel.close();
            }
            this.scene.markLightDirty?.();
        });
    }

    isLit() {
        return !!this.meta.lit;
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
        this.entry.id = id;
        this.meta = def;
        this.applyVisual();
        this.setup(def.hitboxSize);
        this.setInteractive({ cursor: 'pointer' });
        if (!this.isLit()) this.entry.burnRemaining = 0;
        this.scene.markLightDirty?.();
        if (this.scene.tooltip?.visible && this.scene._tooltipTarget === this) {
            this.scene.refreshTooltip();
        }
        this.scene.campfirePanel?.refresh();
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
        if (prevMethod !== nextMethod) this.entry.cookProgress = 0;
        this.scene.campfirePanel?.refresh();
        this.scene.campfirePanel?.layout?.();
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
            || ((this.entry.cookProgress || 0) > 0 && this.entry.simmerBarMinutes != null);
        if (simmerActive) {
            this._tickShellSimmer(lit);
            return;
        }

        const cook = this.entry.cook;
        if (!cook) return;

        const recipe = method
            ? getCookRecipe(id => this.scene.getItem(id), cook.id, method)
            : null;
        const canAdvance = !!(lit && attending && method && recipe);

        if (!canAdvance) {
            // Drain when the fire is out (walking away only pauses)
            if ((this.entry.cookProgress || 0) > 0 && !lit) {
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
            return;
        }

        this.entry.roastBarMinutes = recipe.minutes;
        this.entry.cookProgress = (this.entry.cookProgress || 0) + 1;
        if (this.entry.cookProgress >= recipe.minutes) {
            const resultMeta = this.scene.getItem(recipe.result);
            delete this.entry.roastBarMinutes;
            if (resultMeta) {
                this.setCook(makeItemStack(resultMeta, cook.quantity || 1));
            } else {
                this.entry.cookProgress = 0;
                this.scene.campfirePanel?.refresh();
            }
            return;
        }
        this.scene.campfirePanel?.refresh();
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
                coconutMeta
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