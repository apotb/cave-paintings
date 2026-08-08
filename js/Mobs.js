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

class DroppedItem extends Mob {
    /**
     * @param {Object} [stackExtras]  optional customName/food/ingredients for dynamic meals
     */
    static spawn(scene, x, y, item, quantity, spoilMinutes = undefined, stackExtras = null) {
        if (!item || quantity <= 0) return null;

        if (!scene.droppedItems) {
            scene.droppedItems = scene.add.group();
        }

        const maxStack = Math.max(1, item.maxStack || 1);
        const maxDist = scene.tileSize;
        let remaining = quantity;
        let last = null;
        const incomingSpoil = spoilMinutes !== undefined
            ? spoilMinutes
            : defaultSpoilMinutes(item);

        // Custom meals never merge with other drops
        const canMerge = !stackExtras?.customName;

        if (canMerge) {
            const nearby = scene.droppedItems.getChildren()
                .filter(drop => drop.active && drop.item?.id === item.id && !drop.customName && drop.quantity < maxStack)
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
                remaining -= add;
                last = drop;
            }
        }

        if (scene.tooltip?.visible) scene.refreshTooltip();

        while (remaining > 0) {
            const add = Math.min(maxStack, remaining);
            last = new DroppedItem(scene, x, y, item, add, incomingSpoil, stackExtras);
            remaining -= add;
        }

        return last;
    }

    constructor(scene, x, y, item, quantity, spoilMinutes = undefined, stackExtras = null) {
        const isMeal = !!(stackExtras?.ingredients?.length);
        const texKey = isMeal ? COCONUT_SHELL_KEY : item.key;
        super(scene, x, y, texKey);
        this.item = item;
        this.quantity = quantity;
        const spoil = spoilMinutes !== undefined ? spoilMinutes : defaultSpoilMinutes(item);
        if (spoil != null) this.spoilMinutes = spoil;
        if (stackExtras?.customName) this.customName = stackExtras.customName;
        if (stackExtras?.food) this.food = { ...stackExtras.food };
        if (stackExtras?.ingredients) this.ingredients = stackExtras.ingredients.slice();
        if (stackExtras?.weight != null) this.stackWeight = stackExtras.weight;
        if (stackExtras?.kind) this.kind = stackExtras.kind;
        if (stackExtras?.fillTint != null) this.fillTint = stackExtras.fillTint;

        scene.add.existing(this);
        scene.physics.add.existing(this);
        scene.groundLayer.add(this);
        if (!scene.droppedItems) scene.droppedItems = scene.add.group();
        scene.droppedItems.add(this);

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
            this.fillOverlay = scene.add.image(x, y, COCONUT_FILL_KEY)
                .setOrigin(0, 1)
                .setScale(0.7)
                .setTint(tint)
                .setDepth(1.1);
            scene.groundLayer.add(this.fillOverlay);
            this._syncFillOverlay = () => {
                if (!this.active || !this.fillOverlay) return;
                this.fillOverlay.setPosition(this.x, this.y).setDepth(this.depth + 0.1);
            };
            scene.events.on('update', this._syncFillOverlay);
        }

        scene.time.addEvent({
            delay: 1000 * 60 * 60,
            callback: this.destroy,
            callbackScope: this,
            loop: true
        });

        this.setInteractive({ cursor: 'pointer' });
        this.on('pointerdown', (pointer) => {
            if (this.customName) {
                const stack = {
                    id: this.item.id,
                    quantity: this.quantity,
                    customName: this.customName,
                    ...(this.food ? { food: { ...this.food } } : {}),
                    ...(this.ingredients ? { ingredients: this.ingredients.slice() } : {}),
                    ...(this.stackWeight != null ? { weight: this.stackWeight } : {}),
                    ...(this.kind ? { kind: this.kind } : {}),
                    ...(this.fillTint != null ? { fillTint: this.fillTint } : {}),
                    ...(this.spoilMinutes != null ? { spoilMinutes: this.spoilMinutes } : {})
                };
                const inv = this.scene.player.inventory;
                const empty = inv.findIndex(s => !s);
                if (empty !== -1) {
                    inv[empty] = stack;
                    this.scene.hotbar.dirty = true;
                    this.destroy();
                    return;
                }
                if (inv.length < this.scene.player.inventorySize) {
                    inv.push(stack);
                    this.scene.hotbar.dirty = true;
                    this.destroy();
                    return;
                }
                return;
            }
            const remaining = this.scene.player.gainItem(
                this.item, this.quantity, this.spoilMinutes
            );
            if (remaining === 0) this.destroy();
            else {
                this.quantity = remaining;
                this.tooltip(pointer);
            }
        });
        this.on('pointerover', (pointer) => this.tooltip(pointer));
        this.on('pointerout', () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) scene.hideTooltip();
        });
        this.on('destroy', () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) scene.hideTooltip();
            if (this._syncFillOverlay) {
                scene.events.off('update', this._syncFillOverlay);
                this._syncFillOverlay = null;
            }
            this.fillOverlay?.destroy();
            this.fillOverlay = null;
        });
    }

    tooltip(pointer) {
        const stackProxy = this.customName ? {
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
