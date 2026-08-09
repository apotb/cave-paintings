class Mob extends Phaser.Physics.Arcade.Image {
    constructor(scene, x, y, key) {
        super(scene, x, y, key);
        this.hp = 20;
        this.mhp = 20;
    }

    /**
     * @param {Number} amount
     * @param {Object} [source]  attacker
     * @param {{ type?: string }} [opts]
     */
    takeDamage(amount, source = null, opts = null) {
        const dmg = Number(amount) || 0;
        if (!(dmg > 0) || this.hp <= 0) return 0;
        this.hp = Math.max(0, this.hp - dmg);
        if (this.hp <= 0) this.onDeath?.(source, opts);
        return dmg;
    }
}

/**
 * Data-driven living creature. `entry` is the object in chunk.meta.mobs (mutated for save).
 */
class LivingMob extends Phaser.Physics.Arcade.Sprite {
    /**
     * Spawn a mob into the world (and into the owning chunk's meta).
     * @param {Phaser.Scene} scene
     * @param {string} id  mob def id
     * @param {number} x
     * @param {number} y
     * @returns {LivingMob|null}
     */
    static spawn(scene, id, x, y) {
        const def = scene.getMob?.(id);
        if (!def) return null;

        const chunk = LivingMob.ensureChunkAt(scene, x, y - 1);
        if (!chunk) return null;
        if (!chunk.meta.mobs) chunk.meta.mobs = [];

        const entry = {
            id,
            x,
            y,
            hp: def.hp
        };
        chunk.meta.mobs.push(entry);

        if (!chunk.isLoaded) return null;
        return new LivingMob(scene, entry, chunk);
    }

    /** Ensure a Chunk exists for world position (creates empty meta chunk if needed). */
    static ensureChunkAt(scene, wx, wy) {
        const px = scene.chunkPx();
        const cx = Math.floor(wx / px);
        const cy = Math.floor(wy / px);
        const key = scene.getKey(cx, cy);
        if (!scene.chunks[key]) {
            scene.chunks[key] = new Chunk(scene, cx, cy);
        }
        return scene.chunks[key];
    }

    /**
     * @param {Phaser.Scene} scene
     * @param {{ id: string, x: number, y: number, hp?: number }} entry
     * @param {Chunk} chunk
     */
    constructor(scene, entry, chunk) {
        const def = scene.getMob(entry.id);
        const key = def?.key || entry.id;
        super(scene, entry.x, entry.y, key, 0);

        this.entry = entry;
        this.chunk = chunk;
        this.def = def || { id: entry.id, key, hp: 20, speed: 1, hitboxSize: 8 };
        this.mhp = Number(this.def.hp) || 20;
        this.hp = entry.hp != null ? Number(entry.hp) : this.mhp;
        this.facing = "down";

        const hitboxSize = Number(this.def.hitboxSize) || 8;
        this.hitboxSize = hitboxSize;

        scene.add.existing(this);
        scene.physics.add.existing(this);
        scene.mainLayer.add(this);
        this.setOrigin(0, 1);
        this.body.setSize(hitboxSize, hitboxSize)
            .setOffset((this.width - hitboxSize) / 2, hitboxSize);

        if (!scene.mobs) scene.mobs = scene.physics.add.group();
        scene.mobs.add(this);
        scene.damageables?.add(this);
        chunk.mobs.add(this);

        const AiClass = typeof MobAI !== "undefined" ? MobAI[this.def.ai] : null;
        this.ai = AiClass ? new AiClass(this) : null;

        // World-space bar locked to this mob (same approach as campfire panel):
        // share the mob's exact world coords after physics — no camera reprojection / Math.round.
        this.hpBarGfx = scene.add.graphics();
        scene.mainLayer.add(this.hpBarGfx);
        this._hpBarFrac = null;
        this._hpBarColorCached = null;
        this._syncHpBarTransform = () => {
            const gfx = this.hpBarGfx;
            if (!gfx || !this.active || !gfx.visible) return;
            const w = 14;
            gfx.setPosition(
                this.x + this.width * 0.5 - w * 0.5,
                this.y - this.height - 3
            );
            gfx.setDepth(this.y + 0.1);
        };
        scene.events.on("postupdate", this._syncHpBarTransform);
        this.on("destroy", () => {
            scene.events.off("postupdate", this._syncHpBarTransform);
            this._syncHpBarTransform = null;
            if (scene._hoverTarget === this) scene._hoverTarget = null;
            if (scene._tooltipTarget === this) scene.hideTooltip();
            this.hpBarGfx?.destroy();
            this.hpBarGfx = null;
        });

        this.setInteractive({ cursor: "pointer" });
        this.on("pointerover", (pointer) => {
            const name = this.def?.name || this.def?.id || "Unknown";
            scene.showTooltip(name, pointer.x, pointer.y, this);
        });
        this.on("pointerout", () => {
            if (scene._hoverTarget === this) scene._hoverTarget = null;
            if (scene._tooltipTarget === this) scene.hideTooltip();
        });

        this.scene.player?.createAnimations?.();
        this.playAnim(`idle-${this.facing}`);
        this.setDepth(this.y);
        this._updateHpBar();
    }

    playAnim(key) {
        if (!key || !this.scene?.anims?.exists(key)) return;
        this.play(key, true);
    }

    /** Green → yellow (50%) → orange (25%) → red (10%). */
    _hpBarColor(frac) {
        const stops = [
            { t: 1.0, c: 0x3CB043 },  // green
            { t: 0.5, c: 0xE6C200 },  // yellow
            { t: 0.25, c: 0xE67A00 }, // orange
            { t: 0.1, c: 0xD24A43 }   // red
        ];
        const f = Phaser.Math.Clamp(frac, 0, 1);
        if (f >= stops[0].t) return stops[0].c;
        if (f <= stops[stops.length - 1].t) return stops[stops.length - 1].c;

        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i];
            const b = stops[i + 1];
            if (f <= a.t && f >= b.t) {
                const u = (a.t - f) / (a.t - b.t);
                const ar = (a.c >> 16) & 0xff, ag = (a.c >> 8) & 0xff, ab = a.c & 0xff;
                const br = (b.c >> 16) & 0xff, bg = (b.c >> 8) & 0xff, bb = b.c & 0xff;
                const r = Math.round(ar + (br - ar) * u);
                const g = Math.round(ag + (bg - ag) * u);
                const bl = Math.round(ab + (bb - ab) * u);
                return (r << 16) | (g << 8) | bl;
            }
        }
        return stops[stops.length - 1].c;
    }

    _updateHpBar() {
        const gfx = this.hpBarGfx;
        if (!gfx) return;
        if (!(this.hp < this.mhp) || this.hp <= 0) {
            gfx.setVisible(false);
            this._hpBarFrac = null;
            this._hpBarColorCached = null;
            return;
        }
        gfx.setVisible(true);
        this._syncHpBarTransform?.();

        const frac = Phaser.Math.Clamp(this.hp / this.mhp, 0, 1);
        const color = this._hpBarColor(frac);
        // Redraw only when fill/color changes; motion is handled in postupdate
        if (this._hpBarFrac === frac && this._hpBarColorCached === color) return;
        this._hpBarFrac = frac;
        this._hpBarColorCached = color;

        const w = 14;
        const h = 2;
        gfx.clear();
        gfx.fillStyle(0x000000, 0.75);
        gfx.fillRect(-1, -1, w + 2, h + 2);
        gfx.fillStyle(0x333333, 1);
        gfx.fillRect(0, 0, w, h);
        gfx.fillStyle(color, 1);
        gfx.fillRect(0, 0, Math.max(1, Math.round(w * frac)), h);
    }

    bodyCenter() {
        return {
            x: this.x + this.width * 0.5,
            y: this.y - this.height * 0.5
        };
    }

    /**
     * Melee hurtbox (origin bottom-left): roughly the drawn body.
     */
    hurtbox(pad = 0) {
        const inset = 1;
        return {
            left: this.x + inset - pad,
            top: this.y - this.height + inset - pad,
            right: this.x + this.width - inset + pad,
            bottom: this.y - inset + pad
        };
    }

    /**
     * @param {Number} amount
     * @param {Object} [source]
     * @param {{ type?: string }} [opts]
     */
    takeDamage(amount, source = null, opts = null) {
        const dmg = Number(amount) || 0;
        if (!(dmg > 0) || this.hp <= 0) return 0;
        this.hp = Math.max(0, this.hp - dmg);
        this.syncToEntry();
        this._updateHpBar();
        if (this.hp <= 0) {
            this.die(source, opts);
        } else {
            this.ai?.onDamaged?.(source, opts);
        }
        return dmg;
    }

    syncToEntry() {
        if (!this.entry) return;
        this.entry.x = this.x;
        this.entry.y = this.y;
        this.entry.hp = this.hp;
    }

    reassignChunkIfNeeded() {
        const scene = this.scene;
        const next = LivingMob.ensureChunkAt(scene, this.x, this.y - 1);
        if (!next || next === this.chunk) return;

        const old = this.chunk;
        if (old?.meta?.mobs) {
            const i = old.meta.mobs.indexOf(this.entry);
            if (i >= 0) old.meta.mobs.splice(i, 1);
            old.mobs?.remove(this);
        }
        if (!next.meta.mobs) next.meta.mobs = [];
        if (next.meta.mobs.indexOf(this.entry) < 0) next.meta.mobs.push(this.entry);
        this.chunk = next;

        // Unloaded destination: persist meta only (no duplicate on later makeMobs)
        if (!next.isLoaded) {
            this.syncToEntry();
            scene.damageables?.remove(this);
            scene.mobs?.remove(this);
            this.destroy();
            return;
        }
        next.mobs.add(this);
    }

    die(_source = null, _opts = null) {
        if (this._dead) return;
        this._dead = true;

        const scene = this.scene;
        const drops = this.def?.drops || [];
        for (const drop of drops) {
            const item = scene.getItem(drop.item);
            if (!item) continue;
            let qty;
            if (drop.min != null || drop.max != null) {
                const lo = Math.max(0, Math.floor(Number(drop.min ?? drop.max) || 0));
                const hi = Math.max(lo, Math.floor(Number(drop.max ?? drop.min) || 0));
                qty = Phaser.Math.Between(lo, hi);
            } else {
                qty = Number(drop.quantity) || 1;
            }
            if (qty > 0) DroppedItem.spawn(scene, this.x, this.y, item, qty);
        }

        if (this.chunk?.meta?.mobs) {
            const i = this.chunk.meta.mobs.indexOf(this.entry);
            if (i >= 0) this.chunk.meta.mobs.splice(i, 1);
        }
        this.chunk?.mobs?.remove(this);
        scene.damageables?.remove(this);
        scene.mobs?.remove(this);
        this.destroy();
    }

    update(_time, delta) {
        if (!this.active || this._dead || this.hp <= 0) return;
        this.ai?.update(delta);
        this.setDepth(this.y);
        this.reassignChunkIfNeeded();
        if (!this.active) return;
        this.syncToEntry();
        this._updateHpBar();
    }
}

/** Ground loot lifetime while its chunk is loaded (5 real minutes). */
const DROP_LIFE_MS = 5 * 60 * 1000;

/**
 * Ground item. `entry` lives in chunk.meta.drops (persisted like mobs).
 * lifeMs only ticks while the owning chunk is loaded.
 */
class DroppedItem extends Mob {
    /**
     * @param {Object} [stackExtras]  optional customName/food/ingredients for dynamic meals
     */
    static spawn(scene, x, y, item, quantity, spoilMinutes = undefined, stackExtras = null) {
        if (!item || quantity <= 0) return null;

        if (!scene.droppedItems) scene.droppedItems = scene.add.group();

        const maxStack = Math.max(1, item.maxStack || 1);
        const maxDist = scene.tileSize;
        let remaining = quantity;
        let last = null;
        const incomingSpoil = spoilMinutes !== undefined
            ? spoilMinutes
            : defaultSpoilMinutes(item);

        const canMerge = !stackExtras?.customName
            && !stackExtras?.food
            && !stackExtras?.ingredients?.length;

        if (canMerge) {
            const nearby = scene.droppedItems.getChildren()
                .filter(drop => drop.active && drop.item?.id === item.id
                    && !drop.customName && !drop.food && !drop.ingredients
                    && drop.quantity < maxStack)
                .map(drop => ({
                    drop,
                    dist: Phaser.Math.Distance.Between(x, y, drop.x, drop.y)
                }))
                .filter(entry => entry.dist <= maxDist)
                .sort((a, b) => a.dist - b.dist);

            for (const { drop } of nearby) {
                if (remaining <= 0) break;
                const space = maxStack - drop.quantity;
                const add = Math.min(space, remaining);
                drop.spoilMinutes = mergeSpoilMinutes(
                    drop.quantity, drop.spoilMinutes,
                    add, incomingSpoil
                );
                drop.quantity += add;
                // Merged stacks refresh despawn timer
                drop.lifeMs = DROP_LIFE_MS;
                drop.syncToEntry();
                remaining -= add;
                last = drop;
            }
        }

        if (scene.tooltip?.visible) scene.refreshTooltip();

        while (remaining > 0) {
            const add = Math.min(maxStack, remaining);
            const chunk = LivingMob.ensureChunkAt(scene, x, y - 1);
            if (!chunk) break;
            if (!chunk.meta.drops) chunk.meta.drops = [];

            const entry = DroppedItem.makeEntry(item, x, y, add, incomingSpoil, stackExtras);
            chunk.meta.drops.push(entry);

            if (chunk.isLoaded) {
                last = new DroppedItem(scene, entry, chunk);
            } else {
                last = null;
            }
            remaining -= add;
        }

        return last;
    }

    static makeEntry(item, x, y, quantity, spoilMinutes, stackExtras = null) {
        const entry = {
            id: item.id,
            x,
            y,
            quantity,
            lifeMs: DROP_LIFE_MS
        };
        if (spoilMinutes != null) entry.spoilMinutes = spoilMinutes;
        if (stackExtras?.customName) entry.customName = stackExtras.customName;
        if (stackExtras?.food) entry.food = { ...stackExtras.food };
        if (stackExtras?.ingredients) entry.ingredients = stackExtras.ingredients.slice();
        if (stackExtras?.weight != null) entry.weight = stackExtras.weight;
        if (stackExtras?.kind) entry.kind = stackExtras.kind;
        if (stackExtras?.fillTint != null) entry.fillTint = stackExtras.fillTint;
        return entry;
    }

    /**
     * @param {Phaser.Scene} scene
     * @param {Object} entry  chunk.meta.drops entry
     * @param {Chunk} chunk
     */
    constructor(scene, entry, chunk) {
        const item = scene.getItem(entry.id);
        const isMeal = !!(entry.ingredients?.length);
        const texKey = isMeal ? COCONUT_SHELL_KEY : (item?.key || entry.id);
        super(scene, entry.x, entry.y, texKey);

        this.entry = entry;
        this.chunk = chunk;
        this.item = item || { id: entry.id, key: texKey, maxStack: 1 };
        this.quantity = Number(entry.quantity) || 1;
        this.lifeMs = entry.lifeMs != null ? Number(entry.lifeMs) : DROP_LIFE_MS;
        if (entry.spoilMinutes != null) this.spoilMinutes = entry.spoilMinutes;
        if (entry.customName) this.customName = entry.customName;
        if (entry.food) this.food = { ...entry.food };
        if (entry.ingredients) this.ingredients = entry.ingredients.slice();
        if (entry.weight != null) this.stackWeight = entry.weight;
        if (entry.kind) this.kind = entry.kind;
        if (entry.fillTint != null) this.fillTint = entry.fillTint;

        scene.add.existing(this);
        scene.physics.add.existing(this);
        scene.groundLayer.add(this);
        if (!scene.droppedItems) scene.droppedItems = scene.add.group();
        scene.droppedItems.add(this);
        if (!chunk.drops) chunk.drops = scene.add.group();
        chunk.drops.add(this);

        this.setOrigin(0, 1);
        this.setDepth(1);
        this.setScale(0.7);

        this.setDamping(true);
        this.setDrag(200, 200);
        this.setMaxVelocity(48, 48);

        if (isMeal && scene.textures.exists(COCONUT_FILL_KEY)) {
            const tint = this.fillTint != null
                ? this.fillTint
                : mixIngredientFillTint(id => scene.getItem(id), this.ingredients);
            this.fillOverlay = scene.add.image(entry.x, entry.y, COCONUT_FILL_KEY)
                .setOrigin(0, 1)
                .setScale(0.7)
                .setTint(tint)
                .setDepth(1.1);
            scene.groundLayer.add(this.fillOverlay);
            this._syncFillOverlay = () => {
                if (!this.active || !this.fillOverlay) return;
                this.fillOverlay.setPosition(this.x, this.y).setDepth(this.depth + 0.1);
            };
            scene.events.on("update", this._syncFillOverlay);
        }

        this.setInteractive({ cursor: "pointer" });
        this.on("pointerdown", (pointer) => {
            const took = this.tryPickup();
            if (!took && this.active) this.tooltip(pointer);
            else if (this.active && this.quantity > 0) this.tooltip(pointer);
        });
        this.on("pointerover", (pointer) => this.tooltip(pointer));
        this.on("pointerout", () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) scene.hideTooltip();
        });
        this.on("destroy", () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) scene.hideTooltip();
            if (this._syncFillOverlay) {
                scene.events.off("update", this._syncFillOverlay);
                this._syncFillOverlay = null;
            }
            this.fillOverlay?.destroy();
            this.fillOverlay = null;
            if (!this._persisting) this._removeEntry();
            this.scene.droppedItems?.remove(this);
            this.chunk?.drops?.remove(this);
        });
    }

    syncToEntry() {
        if (!this.entry) return;
        this.entry.x = this.x;
        this.entry.y = this.y;
        this.entry.quantity = this.quantity;
        this.entry.lifeMs = this.lifeMs;
        if (this.spoilMinutes != null) this.entry.spoilMinutes = this.spoilMinutes;
        else delete this.entry.spoilMinutes;
        if (this.customName) this.entry.customName = this.customName;
        if (this.food) this.entry.food = { ...this.food };
        if (this.ingredients) this.entry.ingredients = this.ingredients.slice();
        if (this.stackWeight != null) this.entry.weight = this.stackWeight;
        if (this.kind) this.entry.kind = this.kind;
        if (this.fillTint != null) this.entry.fillTint = this.fillTint;
    }

    _removeEntry() {
        if (!this.entry || !this.chunk?.meta?.drops) return;
        const i = this.chunk.meta.drops.indexOf(this.entry);
        if (i >= 0) this.chunk.meta.drops.splice(i, 1);
    }

    /** Destroy sprite but keep meta (chunk unload). */
    persistDestroy() {
        this.syncToEntry();
        this._persisting = true;
        this.destroy();
    }

    reassignChunkIfNeeded() {
        const next = LivingMob.ensureChunkAt(this.scene, this.x, this.y - 1);
        if (!next || next === this.chunk) return;

        const old = this.chunk;
        if (old?.meta?.drops) {
            const i = old.meta.drops.indexOf(this.entry);
            if (i >= 0) old.meta.drops.splice(i, 1);
            old.drops?.remove(this);
        }
        if (!next.meta.drops) next.meta.drops = [];
        if (next.meta.drops.indexOf(this.entry) < 0) next.meta.drops.push(this.entry);
        this.chunk = next;

        if (!next.isLoaded) {
            this.persistDestroy();
            return;
        }
        if (!next.drops) next.drops = this.scene.add.group();
        next.drops.add(this);
    }

    update(_time, delta) {
        if (!this.active) return;
        this.lifeMs -= delta;
        if (this.lifeMs <= 0) {
            this.destroy();
            return;
        }
        this.reassignChunkIfNeeded();
        if (!this.active) return;
        this.syncToEntry();
    }

    /**
     * Try to move this drop into the player's inventory.
     * @returns {boolean} true if any quantity was taken
     */
    tryPickup() {
        if (!this.active || !this.item || !(this.quantity > 0)) return false;
        const player = this.scene.player;
        if (!player) return false;

        if (typeof hasStackExtras === "function" ? hasStackExtras(this) : (this.customName || this.food || this.ingredients)) {
            const stack = {
                id: this.item.id,
                quantity: this.quantity,
                ...(this.customName ? { customName: this.customName } : {}),
                ...(this.food ? { food: { ...this.food } } : {}),
                ...(this.ingredients ? { ingredients: this.ingredients.slice() } : {}),
                ...(this.stackWeight != null ? { weight: this.stackWeight } : {}),
                ...(this.kind ? { kind: this.kind } : {}),
                ...(this.fillTint != null ? { fillTint: this.fillTint } : {}),
                ...(this.spoilMinutes != null ? { spoilMinutes: this.spoilMinutes } : {})
            };
            const inv = player.inventory;
            const empty = inv.findIndex(s => !s);
            if (empty !== -1) {
                inv[empty] = stack;
                this.scene.hotbar.dirty = true;
                this.destroy();
                return true;
            }
            if (inv.length < player.inventorySize) {
                inv.push(stack);
                this.scene.hotbar.dirty = true;
                this.destroy();
                return true;
            }
            return false;
        }

        const before = this.quantity;
        const remaining = player.gainItem(this.item, this.quantity, this.spoilMinutes);
        if (remaining === before) return false;
        this.scene.hotbar.dirty = true;
        if (remaining === 0) this.destroy();
        else {
            this.quantity = remaining;
            this.syncToEntry();
        }
        return true;
    }

    tooltip(pointer) {
        const stackProxy = (this.customName || this.food || this.ingredients) ? {
            customName: this.customName,
            food: this.food,
            ingredients: this.ingredients,
            weight: this.stackWeight,
            kind: this.kind,
            fillTint: this.fillTint
        } : null;
        this.scene.showTooltip(
            () => this.scene.formatItemTooltip(
                this.item, this.quantity, this.spoilMinutes, stackProxy
            ),
            pointer.x,
            pointer.y,
            this
        );
    }
}
