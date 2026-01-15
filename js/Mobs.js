class Mob extends Phaser.Physics.Arcade.Image {
    constructor(scene, x, y, key) {
        super(scene, x, y, key);
    }
}

class DroppedItem extends Mob {
    constructor(scene, x, y, item, quantity) {
        super(scene, x, y, item.key);
        this.item = item;
        this.quantity = quantity;

        scene.add.existing(this);
        scene.physics.add.existing(this);
        scene.groundLayer.add(this);

        this.setOrigin(0, 1);
        this.setDepth(1);
        this.setScale(0.7);

        this.setDamping(true);
        this.setDrag(200, 200);
        this.setMaxVelocity(48, 48);

        // Despawn event
        scene.time.addEvent({
            delay: 1000 * 60 * 60, // 1 IRL hour
            callback: this.destroy,
            callbackScope: this,
            loop: true 
        });

        this.setInteractive({ cursor: 'pointer', pixelPerfect: true });
        this.on('pointerdown', (pointer) => {
            const remaining = this.scene.player.gainItem(this.item, this.quantity);
            if (remaining === 0) this.destroy();
            else {
                this.quantity = remaining;
                this.tooltip(pointer);
            }
        });
        this.on('pointerover', (pointer) => this.tooltip(pointer));
        this.on('pointerout', () => scene.hideTooltip());
        this.on('destroy', () => scene.hideTooltip());
    }

    tooltip(pointer) {
        const text = this.scene.formatItemTooltip(this.item, this.quantity);
        this.scene.showTooltip(text, pointer.x, pointer.y);
    }
}