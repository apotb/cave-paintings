class Hotbar {
    constructor(scene) {
        this.scene = scene;
        this.create();
    }

    changeSlot(index) {
        this.slots[this.activeIndex].setTexture('slot');
        this.slots[index].setTexture('active_slot');
        this.activeIndex = index;
    }

    nextSlot() {
        let index = this.activeIndex;
        index++;
        if (index >= this.size) index = 0;
        this.changeSlot(index);
    }

    prevSlot() {
        let index = this.activeIndex;
        index--;
        if (index < 0) index = this.size - 1;
        this.changeSlot(index);
    }

    getIndexAt(x, y) {
        for (let i = 0; i < this.slots.length; i++) {
            const b = this.slots[i].getBounds();
            if (Phaser.Geom.Rectangle.Contains(b, x, y)) return i;
        }
        return -1;
    }

    create() {
        this.size = 5;
        const padding = 4;

        const slotImg = this.scene.textures.get("slot").getSourceImage();
        const slotW = slotImg ? slotImg.width : 32;
        const spacing = slotW + padding;

        const totalW = spacing * this.size - padding;
        const startX = Math.floor((this.scene.scale.width - totalW) / 2) + padding + slotW / 4;
        const y = this.scene.scale.height - 16;

        this.activeIndex = 0;
        this.slots = [];
        this.icons = [];
        this.quantity = [];

        for (let i = 0; i < this.size; i++) {
            const slot = this.scene.add.image(startX + i * spacing, y, "slot")
                .setOrigin(0, 1)
                .setInteractive({ cursor: 'pointer' });
            slot.index = i;

            slot.on('pointerover', (pointer) => {
                const getText = () => {
                    const stacks = this.scene.player.inventory;
                    if (i >= stacks.length) return "";
                    const stack = stacks[i];
                    if (!stack) return "";
                    const meta = this.scene.getItem(stack.id);
                    return this.scene.formatItemTooltip(meta, stack.quantity);
                };
                const text = getText();
                if (text) this.scene.showTooltip(getText, pointer.x, pointer.y);
            });
            slot.on('pointerout', () => this.scene.hideTooltip());
            slot.on("pointerup", (pointer) => {
                // Only change slot if we haven't started dragging and the pointer didn't move much
                if (!this._dragging && this._pointerDownPos) {
                    const distance = Phaser.Math.Distance.Between(
                        this._pointerDownPos.x, this._pointerDownPos.y,
                        pointer.x, pointer.y
                    );
                    if (distance < this.dragDistanceThreshold) {
                        this.changeSlot(i);
                    }
                }
            });

            this.scene.uiLayer.add(slot);
            this.slots.push(slot);

            const icon = this.scene.add.image(slot.x + slotW / 2, slot.y - slotW / 2, "")
                .setOrigin(0.5, 0.5)
                .setVisible(false)
                .setScale(3.0);
            this.scene.uiLayer.add(icon);
            this.icons.push(icon);

            const quantity = this.scene.add.text(slot.x + slotW - 4, slot.y - 4, "", {
                fontSize: "14px",
                fontFamily: "monospace",
                align: "right",
                stroke: "#000",
                strokeThickness: 2
            }).setOrigin(1, 1).setVisible(false);
            this.scene.uiLayer.add(quantity);
            this.quantity.push(quantity);
        }

        // Dragging

        this._dragging = false;
        this._dragFrom = null;
        this._dragIcon = null;
        this._pointerDownPos = null;
        this._pointerIsDown = false;

        this.dragDistanceThreshold = 6;

        // Handle pointer down to track start position and time
        for (let i = 0; i < this.size; i++) {
            const slot = this.slots[i];
            
            slot.on('pointerdown', (pointer) => {
                this._pointerDownPos = { x: pointer.x, y: pointer.y };
                this._pointerIsDown = true;
                this._dragging = false;
            });

            slot.on('pointermove', (pointer) => {
                if (!this._pointerIsDown || this._dragging) return;

                const distance = Phaser.Math.Distance.Between(
                    this._pointerDownPos.x, this._pointerDownPos.y,
                    pointer.x, pointer.y
                );

                // Start dragging if moved far enough
                if (distance >= this.dragDistanceThreshold) {
                    const from = slot.index;
                    const inv = this.scene.player.inventory;
                    if (from < inv.length && inv[from]) {
                        const stack = inv[from];
                        const meta = this.scene.getItem(stack.id);
                        const texKey = (meta && (meta.key || meta.id)) || stack.id;
                        if (this.scene.textures.exists(texKey)) {
                            this._dragging = true;
                            this._dragFrom = from;
                            this.scene.hideTooltip();

                            this._dragIcon = this.scene.add.image(pointer.x, pointer.y, texKey)
                                .setOrigin(0.5, 0.5)
                                .setScale(3.0)
                                .setDepth(1000)
                                .setAlpha(0.9);
                            this.scene.uiLayer.add(this._dragIcon);
                        }
                    }
                }
            });
        }

        // Global pointer move to handle drag icon positioning (only when dragging)
        this.scene.input.on('pointermove', (pointer) => {
            if (this._dragIcon && this._dragging) {
                this._dragIcon.setPosition(pointer.x, pointer.y);
            }
        });

        // Global pointer up to handle drag end
        this.scene.input.on('pointerup', (pointer) => {
            if (this._dragging) {
                // Handle drag end
                const to = this.getIndexAt(pointer.x, pointer.y);
                const from = this._dragFrom;

                if (to !== -1 && from !== null && to !== from) {
                    const inv = this.scene.player.inventory;
                    while (inv.length < this.size) inv.push(null);

                    const a = inv[from] ?? null; // dragged stack
                    const b = inv[to]   ?? null; // target stack

                    if (a) {
                        if (b && a.id === b.id) {
                            // Same item -> stack into target up to maxStack
                            const meta = this.scene.getItem(a.id);
                            const maxStack = Math.max(1, meta?.maxStack || 1);
                            const space = Math.max(0, maxStack - b.quantity);

                            if (space > 0) {
                                const moved = Math.min(space, a.quantity);
                                b.quantity += moved;
                                a.quantity -= moved;
                                if (a.quantity <= 0) inv[from] = null; // emptied source
                            } else {
                                // Target full — fall back to swap
                                inv[from] = b;
                                inv[to]   = a;
                            }
                        } else {
                            // Empty target -> move, or different item -> swap
                            inv[to]   = a;
                            inv[from] = b || null;
                        }

                        this.changeSlot(to);
                        this.dirty = true;
                        this.scene.refreshTooltip();
                    }
                }

                if (this._dragIcon) this._dragIcon.destroy();
                this._dragIcon = null;
                this._dragFrom = null;
            }

            // Reset all tracking
            this._dragging = false;
            this._pointerIsDown = false;
            this._pointerDownPos = null;
        });

        // Keep layout correct on window resize
        this.scene.scale.on("resize", (size) => {
            this.scene._uiCam.setSize(size.width, size.height);
            const newStartX = Math.floor((size.width - totalW) / 2) + padding + slotW / 4;
            const newY = size.height - 16;
            this.slots.forEach((slot, i) => {
                slot.setPosition(newStartX + i * spacing, newY);

                const icon = this.icons[i];
                icon.setPosition(slot.x + slotW / 2, slot.y - slotW / 2);

                const quantity = this.quantity[i];
                quantity.setPosition(slot.x + slotW - 4, slot.y - 4);
            });
        });

        this.changeSlot(0);
        this.dirty = true;
    }

    update() {
        const stacks = this.scene.player.inventory;
        const slotCount = this.slots.length;

        for (let i = 0; i < slotCount; i++) {
            const icon = this.icons[i];
            const qty = this.quantity[i];

            if (i < stacks.length) {
                const stack = stacks[i];
                if (!stack) {
                    icon.setVisible(false);
                    qty.setVisible(false);
                    continue;
                }
                const meta = this.scene.getItem(stack.id);
                const texKey = (meta && (meta.key || meta.id)) || stack.id;

                if (this.scene.textures.exists(texKey)) {
                    icon.setTexture(texKey).setVisible(true);
                } else {
                    icon.setVisible(false);
                }

                if (stack.quantity > 1) {
                    qty.setText(String(stack.quantity)).setVisible(true);
                } else {
                    qty.setVisible(false);
                }
            } else {
                icon.setVisible(false);
                qty.setVisible(false);
            }
        }
    }
}