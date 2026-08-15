class Hotbar {
    constructor(scene) {
        this.scene = scene;
        this.create();
    }

    changeSlot(index) {
        this.setActiveIndex(index, { notifyNet: true });
    }

    /**
     * Update selected hotbar slot textures + index.
     * @param {number} index
     * @param {{ notifyNet?: boolean }} [opts] notifyNet=false when syncing from YOU (avoid echo)
     */
    setActiveIndex(index, opts = {}) {
        const notifyNet = opts.notifyNet !== false;
        if (!Number.isInteger(index) || index < 0 || index >= this.size) return;
        if (index !== this.activeIndex) this.scene.resetPlaceRot?.();
        if (this.slots[this.activeIndex]) this.slots[this.activeIndex].setTexture("slot");
        if (this.slots[index]) this.slots[index].setTexture("active_slot");
        // Clear any other active textures (stale from YOU sync / resize races)
        for (let i = 0; i < this.slots.length; i++) {
            if (i === index) continue;
            if (this.slots[i]?.texture?.key === "active_slot") {
                this.slots[i].setTexture("slot");
            }
        }
        this.activeIndex = index;
        if (this.scene.player) this.scene.player.hotbarIndex = index;
        if (notifyNet && this.scene.isNet && this.scene.net?.connected) {
            this.scene.net.sendAction({
                type: NetProtocol.Actions.HOTBAR,
                index,
                pawnId: this.scene.player?.pawnId
            });
        }
    }

    /** Dedicated MP: tell the server; local inventory is already swapped (optimistic). */
    _notifyInvSwap(from, to, fromBag = 'hotbar', toBag = 'hotbar') {
        if (!(this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal)) return;
        if (typeof NetProtocol === "undefined" || !NetProtocol.Actions?.INV_SWAP) return;
        this.scene._invSwapGuardUntil = performance.now() + 500;
        this.scene.net.sendAction({
            type: NetProtocol.Actions.INV_SWAP,
            from,
            to,
            fromBag,
            toBag,
            pawnId: this.scene.player?.pawnId
        });
    }

    _slotRef(value, fallbackBag = 'hotbar') {
        if (value && typeof value === 'object' && Number.isInteger(value.index)) {
            return {
                bag: value.bag === 'overflow' ? 'overflow' : 'hotbar',
                index: value.index
            };
        }
        if (Number.isInteger(value)) return { bag: fallbackBag, index: value };
        return null;
    }

    /** Swap or merge two bag slots, then notify dedicated MP. */
    _applyInvSwap(fromRef, toRef) {
        const from = this._slotRef(fromRef);
        const to = this._slotRef(toRef);
        if (!from || !to) return false;
        if (from.bag === to.bag && from.index === to.index) return false;

        const player = this.scene.player;
        const fromInv = player.bagArray(from.bag);
        const toInv = player.bagArray(to.bag);
        const fromCap = from.bag === 'overflow' ? player.overflowSize : this.size;
        const toCap = to.bag === 'overflow' ? player.overflowSize : this.size;
        while (fromInv.length < fromCap) fromInv.push(null);
        while (toInv.length < toCap) toInv.push(null);
        if (from.index < 0 || to.index < 0 || from.index >= fromInv.length || to.index >= toInv.length) {
            return false;
        }

        const a = fromInv[from.index] ?? null;
        const b = toInv[to.index] ?? null;
        if (!a) return false;

        const aSpecial = typeof isSpecialStack === "function"
            ? isSpecialStack(a)
            : !!(a.customName || a.food || a.ingredients || a.toolClass);
        const bSpecial = typeof isSpecialStack === "function"
            ? isSpecialStack(b)
            : !!(b && (b.customName || b.food || b.ingredients || b.toolClass));
        if (b && a.id === b.id && !aSpecial && !bSpecial) {
            const meta = this.scene.getItem(a.id);
            const maxStack = Math.max(1, meta?.maxStack || 1);
            const space = Math.max(0, maxStack - b.quantity);

            if (space > 0) {
                const moved = Math.min(space, a.quantity);
                b.spoilLeft = mergeSpoilLeft(
                    b.quantity, b.spoilLeft,
                    moved, a.spoilLeft
                );
                delete b.spoilAt;
                mergeDryInto(b, b.quantity, moved, a.dryProgress);
                mergeSoakInto(b, b.quantity, moved, a.soakProgress);
                b.quantity += moved;
                a.quantity -= moved;
                if (a.quantity <= 0) fromInv[from.index] = null;
            } else {
                fromInv[from.index] = b;
                toInv[to.index] = a;
            }
        } else {
            toInv[to.index] = a;
            fromInv[from.index] = b || null;
        }

        this._notifyInvSwap(from.index, to.index, from.bag, to.bag);
        if (to.bag === 'hotbar') this.changeSlot(to.index);
        this.dirty = true;
        this.update();
        this.scene.refreshTooltip();
        return true;
    }

    /** Grow/shrink visible hotbar to match player.inventorySize. */
    setSize(n) {
        const size = Math.max(1, Math.floor(n));
        if (size === this.size) {
            this.layout();
            return;
        }

        while (this.slots.length < size) {
            this._buildSlot(this.slots.length);
        }
        while (this.slots.length > size) {
            const i = this.slots.length - 1;
            this.slots[i].destroy();
            this.icons[i].destroy();
            this.fillIcons[i].destroy();
            this.quantity[i].destroy();
            this.bars[i]?.destroy();
            destroyIngredientBadges(this.ingredientBadges[i]);
            this.slots.pop();
            this.icons.pop();
            this.fillIcons.pop();
            this.quantity.pop();
            this.bars.pop();
            this.ingredientBadges.pop();
        }

        this.size = size;
        if (this.activeIndex >= this.size) this.activeIndex = this.size - 1;
        for (let i = 0; i < this.size; i++) {
            this.slots[i].setTexture(i === this.activeIndex ? 'active_slot' : 'slot');
        }
        this.layout();
        this.dirty = true;
    }

    setOverflowSize(n) {
        const size = Math.max(0, Math.floor(n));
        if (!this.overflowSlots) {
            this.overflowSlots = [];
            this.overflowIcons = [];
            this.overflowFillIcons = [];
            this.overflowQuantity = [];
            this.overflowBars = [];
            this.overflowIngredientBadges = [];
        }
        if (size === this.overflowSize) {
            this.layout();
            return;
        }

        while (this.overflowSlots.length < size) {
            this._buildOverflowSlot(this.overflowSlots.length);
        }
        while (this.overflowSlots.length > size) {
            const i = this.overflowSlots.length - 1;
            this.overflowSlots[i].destroy();
            this.overflowIcons[i].destroy();
            this.overflowFillIcons[i].destroy();
            this.overflowQuantity[i].destroy();
            this.overflowBars[i]?.destroy();
            destroyIngredientBadges(this.overflowIngredientBadges[i]);
            this.overflowSlots.pop();
            this.overflowIcons.pop();
            this.overflowFillIcons.pop();
            this.overflowQuantity.pop();
            this.overflowBars.pop();
            this.overflowIngredientBadges.pop();
        }

        this.overflowSize = size;
        this.layout();
        this.dirty = true;
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

    getOverflowIndexAt(x, y) {
        for (let i = 0; i < (this.overflowSlots || []).length; i++) {
            const b = this.overflowSlots[i].getBounds();
            if (Phaser.Geom.Rectangle.Contains(b, x, y)) return i;
        }
        return -1;
    }

    getBagSlotAt(x, y) {
        const over = this.getOverflowIndexAt(x, y);
        if (over >= 0) return { bag: 'overflow', index: over };
        const hot = this.getIndexAt(x, y);
        if (hot >= 0) return { bag: 'hotbar', index: hot };
        return null;
    }

    layout() {
        const s = this.scene.uiScale || 1;
        const padding = Math.round(4 * s);
        const slotImg = this.scene.textures.get("slot").getSourceImage();
        const baseW = slotImg ? slotImg.width : 32;
        const slotW = baseW * s;
        const spacing = slotW + padding;

        const totalW = spacing * this.size - padding;
        // Slots use origin (0,1); startX is the left edge of the first slot
        const startX = Math.floor((this.scene.scale.width - totalW) / 2);
        const y = this.scene.scale.height - Math.round(16 * s);

        this.slotW = slotW;
        this.spacing = spacing;
        this.padding = padding;

        this.slots.forEach((slot, i) => {
            slot.setScale(s).setPosition(startX + i * spacing, y);

            const icon = this.icons[i];
            const fill = this.fillIcons[i];
            const cx = slot.x + slotW / 2;
            const cy = slot.y - slotW / 2;
            icon.setScale(3.0 * s).setPosition(cx, cy);
            fill.setScale(3.0 * s).setPosition(cx, cy);

            const quantity = this.quantity[i];
            quantity.setFontSize(`${pixelUiFontSize(16, s)}px`);
            quantity.setStroke('#000', Math.max(2, Math.round(2 * s)));
            quantity.setPosition(slot.x + slotW - 4 * s, slot.y - 4 * s);

            const stack = this.scene.player.inventory[i] || null;
            if (stack && stack.quantity > 1) {
                quantity.setText(String(stack.quantity)).setVisible(true);
            } else {
                quantity.setVisible(false);
            }
            const meta = stack ? this.scene.getItem(stack.id) : null;
            syncStackIcon(icon, fill, stack, meta, id => this.scene.getItem(id),
                this.scene.textures, 3.0 * s);
            syncIngredientBadges(
                this.ingredientBadges[i],
                quantity.x, quantity.y, s,
                stack,
                id => this.scene.getItem(id),
                this.scene.textures
            );
            const frac = (typeof Durability !== "undefined" && stack)
                ? Durability.slotBarFraction(stack, meta)
                : null;
            drawSlotConditionBar(this.bars[i], slot, frac);
        });

        const overCount = this.overflowSlots?.length || 0;
        if (overCount > 0) {
            const overW = spacing * overCount - padding;
            const overStartX = Math.floor((this.scene.scale.width - overW) / 2);
            const overY = y - slotW - padding;
            this.overflowSlots.forEach((slot, i) => {
                slot.setVisible(true).setScale(s).setPosition(overStartX + i * spacing, overY);
                const icon = this.overflowIcons[i];
                const fill = this.overflowFillIcons[i];
                const cx = slot.x + slotW / 2;
                const cy = slot.y - slotW / 2;
                icon.setScale(3.0 * s).setPosition(cx, cy);
                fill.setScale(3.0 * s).setPosition(cx, cy);

                const quantity = this.overflowQuantity[i];
                quantity.setFontSize(`${pixelUiFontSize(16, s)}px`);
                quantity.setStroke('#000', Math.max(2, Math.round(2 * s)));
                quantity.setPosition(slot.x + slotW - 4 * s, slot.y - 4 * s);

                const stack = (this.scene.player.overflow || [])[i] || null;
                if (stack && stack.quantity > 1) {
                    quantity.setText(String(stack.quantity)).setVisible(true);
                } else {
                    quantity.setVisible(false);
                }
                const meta = stack ? this.scene.getItem(stack.id) : null;
                syncStackIcon(icon, fill, stack, meta, id => this.scene.getItem(id),
                    this.scene.textures, 3.0 * s);
                syncIngredientBadges(
                    this.overflowIngredientBadges[i],
                    quantity.x, quantity.y, s,
                    stack,
                    id => this.scene.getItem(id),
                    this.scene.textures
                );
                const frac = (typeof Durability !== "undefined" && stack)
                    ? Durability.slotBarFraction(stack, meta)
                    : null;
                drawSlotConditionBar(this.overflowBars[i], slot, frac);
            });
        }

        this.dragDistanceThreshold = Math.round(6 * s);
    }

    _buildSlot(i) {
        const slot = this.scene.add.image(0, 0, "slot")
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
                return this.scene.formatItemTooltip(meta, stack.quantity, stack.spoilLeft ?? stack.spoilAt, stack);
            };
            const text = getText();
            if (text) this.scene.showTooltip(getText, pointer.x, pointer.y, slot);
        });
        slot.on('pointerout', () => this.scene.hideTooltip());
        slot.on("pointerup", (pointer) => {
            if (pointer.rightButtonReleased() || pointer.button === 2) return;
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

        slot.on('pointerdown', (pointer) => {
            if (pointer.rightButtonDown()) {
                if (this.scene.campfirePanel?.visible) {
                    if (this.scene.campfirePanel.tryQuickAddFuel(slot.index, pointer)) {
                        this.dirty = true;
                        this.scene.refreshTooltip();
                    }
                    return;
                }
                if (this.scene.storagePanel?.visible) {
                    if (this.scene.storagePanel.tryQuickAdd(slot.index, pointer)) {
                        this.dirty = true;
                        this.scene.refreshTooltip();
                    }
                    return;
                }
                if (this.scene.equipmentPanel?.visible) {
                    const result = this.scene.player.equipFromHotbarAuto(slot.index);
                    if (result.ok) {
                        this.dirty = true;
                        this.scene.equipmentPanel.refresh();
                        this.scene.equipmentPanel.layout();
                        this.scene.refreshTooltip();
                    }
                }
                return;
            }
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

            if (distance >= this.dragDistanceThreshold) {
                const from = slot.index;
                const inv = this.scene.player.inventory;
                if (from < inv.length && inv[from]) {
                    const stack = inv[from];
                    const meta = this.scene.getItem(stack.id);
                    const s = this.scene.uiScale || 1;
                    const drag = createStackDragIcon(this.scene, pointer.x, pointer.y, stack, meta, 3.0 * s);
                    if (drag) {
                        this._dragging = true;
                        this._dragFrom = { bag: 'hotbar', index: from };
                        this.scene.hideTooltip();
                        this._dragIcon = drag;
                    }
                }
            }
        });

        this.scene.uiLayer.add(slot);
        this.slots.push(slot);

        const icon = this.scene.add.image(0, 0, "")
            .setOrigin(0.5, 0.5)
            .setVisible(false)
            .setScale(3.0);
        this.scene.uiLayer.add(icon);
        this.icons.push(icon);

        const fill = this.scene.add.image(0, 0, "")
            .setOrigin(0.5, 0.5)
            .setVisible(false)
            .setScale(3.0);
        this.scene.uiLayer.add(fill);
        this.fillIcons.push(fill);

        const bar = this.scene.add.graphics();
        this.scene.uiLayer.add(bar);
        this.bars.push(bar);

        const quantity = crispUiText(this.scene.add.text(0, 0, "", {
            fontSize: `${pixelUiFontSize(16, 1)}px`,
            fontFamily: PIXEL_UI_FONT,
            align: "right",
            stroke: "#000",
            strokeThickness: 2
        }).setOrigin(1, 1).setVisible(false));
        this.scene.uiLayer.add(quantity);
        this.quantity.push(quantity);

        const badges = createIngredientBadges(this.scene, (img) => {
            this.scene.uiLayer.add(img);
        });
        this.ingredientBadges.push(badges);
    }

    _buildOverflowSlot(i) {
        const slot = this.scene.add.image(0, 0, "slot")
            .setOrigin(0, 1)
            .setInteractive({ cursor: 'pointer' });
        slot.index = i;
        slot.bag = 'overflow';

        slot.on('pointerover', (pointer) => {
            const getText = () => {
                const stacks = this.scene.player.overflow || [];
                if (i >= stacks.length) return "";
                const stack = stacks[i];
                if (!stack) return "";
                const meta = this.scene.getItem(stack.id);
                return this.scene.formatItemTooltip(meta, stack.quantity, stack.spoilLeft ?? stack.spoilAt, stack);
            };
            const text = getText();
            if (text) this.scene.showTooltip(getText, pointer.x, pointer.y, slot);
        });
        slot.on('pointerout', () => this.scene.hideTooltip());

        slot.on('pointerdown', (pointer) => {
            if (pointer.rightButtonDown()) return;
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
            if (distance < this.dragDistanceThreshold) return;
            const from = slot.index;
            const inv = this.scene.player.overflow || [];
            if (from < inv.length && inv[from]) {
                const stack = inv[from];
                const meta = this.scene.getItem(stack.id);
                const s = this.scene.uiScale || 1;
                const drag = createStackDragIcon(this.scene, pointer.x, pointer.y, stack, meta, 3.0 * s);
                if (drag) {
                    this._dragging = true;
                    this._dragFrom = { bag: 'overflow', index: from };
                    this.scene.hideTooltip();
                    this._dragIcon = drag;
                }
            }
        });

        this.scene.uiLayer.add(slot);
        this.overflowSlots.push(slot);

        const icon = this.scene.add.image(0, 0, "")
            .setOrigin(0.5, 0.5)
            .setVisible(false)
            .setScale(3.0);
        this.scene.uiLayer.add(icon);
        this.overflowIcons.push(icon);

        const fill = this.scene.add.image(0, 0, "")
            .setOrigin(0.5, 0.5)
            .setVisible(false)
            .setScale(3.0);
        this.scene.uiLayer.add(fill);
        this.overflowFillIcons.push(fill);

        const bar = this.scene.add.graphics();
        this.scene.uiLayer.add(bar);
        this.overflowBars.push(bar);

        const quantity = crispUiText(this.scene.add.text(0, 0, "", {
            fontSize: `${pixelUiFontSize(16, 1)}px`,
            fontFamily: PIXEL_UI_FONT,
            align: "right",
            stroke: "#000",
            strokeThickness: 2
        }).setOrigin(1, 1).setVisible(false));
        this.scene.uiLayer.add(quantity);
        this.overflowQuantity.push(quantity);

        const badges = createIngredientBadges(this.scene, (img) => {
            this.scene.uiLayer.add(img);
        });
        this.overflowIngredientBadges.push(badges);
    }

    create() {
        this.size = this.scene.player?.inventorySize || 5;

        this.activeIndex = 0;
        this.slots = [];
        this.icons = [];
        this.fillIcons = [];
        this.quantity = [];
        this.bars = [];
        this.ingredientBadges = [];
        this.overflowSize = 0;
        this.overflowSlots = [];
        this.overflowIcons = [];
        this.overflowFillIcons = [];
        this.overflowQuantity = [];
        this.overflowBars = [];
        this.overflowIngredientBadges = [];

        for (let i = 0; i < this.size; i++) {
            this._buildSlot(i);
        }

        this._dragging = false;
        this._dragFrom = null;
        this._dragIcon = null;
        this._pointerDownPos = null;
        this._pointerIsDown = false;

        this.dragDistanceThreshold = 6;

        // Global pointer move to handle drag icon positioning (only when dragging)
        this.scene.input.on('pointermove', (pointer) => {
            if (this._dragIcon && this._dragging) {
                this._dragIcon.setPosition(pointer.x, pointer.y);
            }
        });

        // Global pointer up to handle drag end
        this.scene.input.on('pointerup', (pointer) => {
            if (this._dragging) {
                const from = this._slotRef(this._dragFrom);
                let handled = false;
                const fromIndex = from?.index;
                const fromBag = from?.bag || 'hotbar';

                // Prefer dropping onto equipment panel
                if (this.scene.equipmentPanel?.visible && from) {
                    handled = this.scene.equipmentPanel.tryEquipFromHotbar(fromIndex, pointer, fromBag);
                }

                if (!handled && this.scene.partyPanel?.visible && from) {
                    const target = this.scene.partyPanel.pawnAtPointer(pointer);
                    if (target && target !== this.scene.player) {
                        handled = !!this.scene.partySys?.tryGive?.(this.scene.player, fromIndex, target, fromBag);
                    }
                }

                if (!handled && from) {
                    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
                    const party = this.scene.party || [];
                    for (const p of party) {
                        if (!p || p === this.scene.player || p.isBodyDead?.()) continue;
                        const hs = (p.hitboxSize || 8) + 6;
                        if (Math.abs(p.x - world.x) < hs && Math.abs(p.y - world.y) < hs * 2) {
                            handled = !!this.scene.partySys?.tryGive?.(this.scene.player, fromIndex, p, fromBag);
                            if (handled) break;
                        }
                    }
                }

                if (!handled && this.scene.campfirePanel?.visible && from) {
                    handled = this.scene.campfirePanel.tryAddFuelFromHotbar(fromIndex, pointer, fromBag);
                }

                if (!handled && this.scene.storagePanel?.visible && from) {
                    handled = this.scene.storagePanel.tryAddFromHotbar(fromIndex, pointer, fromBag);
                }

                if (!handled && from) {
                    const to = this.getBagSlotAt(pointer.x, pointer.y);
                    if (to && (to.bag !== from.bag || to.index !== from.index)) {
                        this._applyInvSwap(from, to);
                    }
                } else if (handled) {
                    this.dirty = true;
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

        this.layout();
        const startIdx = Math.max(
            0,
            Math.min(this.size - 1, Math.floor(Number(this.scene.player?.hotbarIndex) || 0))
        );
        this.setActiveIndex(startIdx, { notifyNet: false });
        this.dirty = true;

        this.scene.input.on('wheel', (_pointer, _over, deltaX, deltaY) => {
            const hp = this.scene.healthPanel;
            const p = this.scene.input.activePointer;
            if (hp?.visible && hp._pointerInInjView?.(p.x, p.y)) return;
            if (this.scene.craftMenuVisible && this.scene._pointerOverCraftMenu?.(p)) return;
            // Shift+wheel is often reported as deltaX (browser "horizontal scroll")
            const delta = deltaY || deltaX;
            if (delta < 0) this.prevSlot();
            else if (delta > 0) this.nextSlot();
        });
    }

    update() {
        const stacks = this.scene.player.inventory;
        const slotCount = this.slots.length;
        const s = this.scene.uiScale || 1;

        for (let i = 0; i < slotCount; i++) {
            const icon = this.icons[i];
            const fill = this.fillIcons[i];
            const qty = this.quantity[i];
            const badges = this.ingredientBadges[i];
            const stack = (i < stacks.length) ? stacks[i] : null;
            const meta = stack ? this.scene.getItem(stack.id) : null;
            const scale = 3.0 * s;

            syncStackIcon(icon, fill, stack, meta, id => this.scene.getItem(id),
                this.scene.textures, scale);

            if (!stack) {
                qty.setVisible(false);
                syncIngredientBadges(badges, qty.x, qty.y, s, null,
                    id => this.scene.getItem(id), this.scene.textures);
                drawSlotConditionBar(this.bars[i], this.slots[i], null);
                continue;
            }

            if (stack.quantity > 1) {
                qty.setText(String(stack.quantity)).setVisible(true);
            } else {
                qty.setVisible(false);
            }

            syncIngredientBadges(badges, qty.x, qty.y, s, stack,
                id => this.scene.getItem(id), this.scene.textures);

            const bar = this.bars[i];
            const frac = (typeof Durability !== "undefined" && stack)
                ? Durability.slotBarFraction(stack, meta)
                : null;
            drawSlotConditionBar(bar, this.slots[i], frac);
        }

        const over = this.scene.player.overflow || [];
        const overCount = this.overflowSlots?.length || 0;
        for (let i = 0; i < overCount; i++) {
            const icon = this.overflowIcons[i];
            const fill = this.overflowFillIcons[i];
            const qty = this.overflowQuantity[i];
            const badges = this.overflowIngredientBadges[i];
            const stack = (i < over.length) ? over[i] : null;
            const meta = stack ? this.scene.getItem(stack.id) : null;
            const scale = 3.0 * s;

            syncStackIcon(icon, fill, stack, meta, id => this.scene.getItem(id),
                this.scene.textures, scale);

            if (!stack) {
                qty.setVisible(false);
                syncIngredientBadges(badges, qty.x, qty.y, s, null,
                    id => this.scene.getItem(id), this.scene.textures);
                drawSlotConditionBar(this.overflowBars[i], this.overflowSlots[i], null);
                continue;
            }

            if (stack.quantity > 1) {
                qty.setText(String(stack.quantity)).setVisible(true);
            } else {
                qty.setVisible(false);
            }

            syncIngredientBadges(badges, qty.x, qty.y, s, stack,
                id => this.scene.getItem(id), this.scene.textures);

            const frac = (typeof Durability !== "undefined" && stack)
                ? Durability.slotBarFraction(stack, meta)
                : null;
            drawSlotConditionBar(this.overflowBars[i], this.overflowSlots[i], frac);
        }
    }
}
