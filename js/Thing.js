class Thing extends Phaser.Physics.Arcade.Image {
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
    }

    toJSON() {
        return {
            id: this.meta.id,
            x: this.x,
            y: this.y
        };
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
        this.setTexture(thing.key);
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
            const text = this.scene.formatItemTooltip(itemMeta, stack.quantity);
            this.scene.showTooltip(text, pointer.x, pointer.y);
        });
        this.on('pointerout', () => {
            this.scene.hideTooltip();
        });
    }

    setup(hitboxSize=0) {
        super.setup(hitboxSize);
        this.setInteractive({ useHandCursor: true });
    }

    morph(id) {
        super.morph(id);
        if (this.meta.lootable) {
            this.setInteractive({ useHandCursor: true });
        } else {
            this.disableInteractive();
            this.scene.input.setDefaultCursor('default');
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
        if (remaining > 0) new DroppedItem(this.scene, this.x, this.y, item, remaining);
        this.scene.hideTooltip();
        const transform = this.meta.lootable.transform;
        if (transform) {
            this.morph(transform);
        } else this.destroy();
    }
}