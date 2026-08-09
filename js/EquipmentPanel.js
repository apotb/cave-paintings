class EquipmentPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.slotViews = []; // { key, slot, icon }
        this._dragging = false;
        this._dragFromKey = null;
        this._dragIcon = null;
        this._pointerDownPos = null;
        this._pointerIsDown = false;

        // Normalized anchors on status.png (origin top-left of image)
        this.anchors = {
            head:  { x: 0.50, y: 0.10 },
            torso: { x: 0.50, y: 0.38 },
            legs:  { x: 0.50, y: 0.62 },
            feet:  { x: 0.50, y: 0.90 }
        };

        this.container = scene.add.container(0, 0).setVisible(false).setDepth(50);
        scene.uiLayer.add(this.container);

        this.body = scene.add.image(0, 0, 'status').setOrigin(0, 0);
        // Capture pointer so world/tooltips behind the panel don't receive hover
        this.body.setInteractive({ cursor: 'default' });
        this.container.add(this.body);

        this.slotsLayer = scene.add.container(0, 0);
        this.container.add(this.slotsLayer);

        scene.input.on('pointermove', (pointer) => {
            if (this._dragIcon && this._dragging) {
                this._dragIcon.setPosition(pointer.x, pointer.y);
            }
        });

        scene.input.on('pointerup', (pointer) => this._onPointerUp(pointer));
    }

    toggle() {
        if (this.visible) this.close();
        else this.open();
    }

    open() {
        // Side menus exclude each other; world UIs (corpse / campfire) can stay open
        if (this.scene.craftMenuVisible) this.scene.closeCraftMenu();
        if (this.scene.healthPanel?.visible) this.scene.healthPanel.close();
        this.visible = true;
        this.container.setVisible(true);
        this.refresh();
        this.layout();
        if (this.scene.equipmentBtn) {
            this.scene.equipmentBtn.setTexture('equipment_open');
        }
    }

    close() {
        this.visible = false;
        this.container.setVisible(false);
        this._cancelDrag();
        if (this.scene.equipmentBtn) {
            const p = this.scene.input.activePointer;
            const btn = this.scene.equipmentBtn;
            const hovering = Phaser.Geom.Rectangle.Contains(btn.getBounds(), p.x, p.y);
            btn.setTexture(hovering ? 'equipment_hover' : 'equipment');
        }
    }

    getSlotAt(x, y) {
        if (!this.visible) return null;
        for (const view of this.slotViews) {
            if (Phaser.Geom.Rectangle.Contains(view.slot.getBounds(), x, y)) {
                return view.key;
            }
        }
        return null;
    }

    _slotLabel(key) {
        if (key.startsWith('waist:')) return 'Waist';
        const labels = { head: 'Head', torso: 'Torso', legs: 'Legs', feet: 'Feet' };
        return labels[key] || key;
    }

    layout() {
        const s = this.scene.uiScale || 1;
        const btn = this.scene.equipmentBtn;
        if (!btn) return;

        const bodyScale = 3 * s;
        this.body.setScale(bodyScale);
        const bw = this.body.displayWidth;
        const bh = this.body.displayHeight;

        const left = btn.x + btn.displayWidth / 2 + 2 * s;
        const top = Phaser.Math.Clamp(
            (this.scene.scale.height - bh) / 2,
            0,
            Math.max(0, this.scene.scale.height - bh)
        );
        this.container.setPosition(Math.round(left), Math.round(top));

        this._layoutSlots(bw, bh, s);
    }

    _layoutSlots(bw, bh, s) {
        const slotImg = this.scene.textures.get('slot').getSourceImage();
        const base = slotImg ? slotImg.width : 16;
        const slotScale = s;
        const slotW = base * slotScale;
        const half = slotW / 2;
        const pad = Math.round(4 * s);
        const spacing = slotW + pad;

        let legsCX = 0.5 * bw;
        let legsCY = this.anchors.legs.y * bh;

        for (const view of this.slotViews) {
            if (view.key.startsWith('waist:')) continue;
            const a = this.anchors[view.key];
            const x = a.x * bw - half;
            const y = a.y * bh - half;
            view.slot.setScale(slotScale).setPosition(x, y);
            view.icon.setScale(3 * s).setPosition(x + half, y + half);
            view.fill.setScale(3 * s).setPosition(x + half, y + half);
            view.homeX = x;
            view.homeY = y;
            view.iconHomeX = x + half;
            view.iconHomeY = y + half;
            if (view.key === 'legs') {
                legsCX = x + half;
                legsCY = y + half;
            }
            const stack = this.scene.player.getEquipmentStack(view.key);
            const meta = stack ? this.scene.getItem(stack.id) : null;
            syncStackIcon(view.icon, view.fill, stack, meta,
                id => this.scene.getItem(id), this.scene.textures, 3 * s);
            syncIngredientBadges(
                view.badges,
                x + slotW - 4 * s, y + slotW - 4 * s, s,
                stack,
                id => this.scene.getItem(id),
                this.scene.textures
            );
        }

        for (const view of this.slotViews) {
            if (!view.key.startsWith('waist:')) continue;
            const i = parseInt(view.key.slice(6), 10);
            const side = (i % 2 === 0) ? -1 : 1;
            const row = Math.floor(i / 2);
            const cx = legsCX + side * spacing;
            const cy = legsCY + row * spacing;
            view.slot.setScale(slotScale).setPosition(cx - half, cy - half);
            view.icon.setScale(3 * s).setPosition(cx, cy);
            view.fill.setScale(3 * s).setPosition(cx, cy);
            view.homeX = cx - half;
            view.homeY = cy - half;
            view.iconHomeX = cx;
            view.iconHomeY = cy;
            const stack = this.scene.player.getEquipmentStack(view.key);
            const meta = stack ? this.scene.getItem(stack.id) : null;
            syncStackIcon(view.icon, view.fill, stack, meta,
                id => this.scene.getItem(id), this.scene.textures, 3 * s);
            syncIngredientBadges(
                view.badges,
                cx + half - 4 * s, cy + half - 4 * s, s,
                stack,
                id => this.scene.getItem(id),
                this.scene.textures
            );
        }
    }

    refresh() {
        this.slotsLayer.removeAll(true);
        this.slotViews = [];

        const keys = ['head', 'torso', 'legs', 'feet'];
        for (const key of keys) {
            this._addSlotView(key);
        }

        const waistCap = this.scene.player.getWaistCapacity();
        for (let i = 0; i < waistCap; i++) {
            this._addSlotView(`waist:${i}`);
        }

        this._updateIcons();
        const s = this.scene.uiScale || 1;
        this._layoutSlots(this.body.displayWidth, this.body.displayHeight, s);
    }

    _addSlotView(key) {
        const slot = this.scene.add.image(0, 0, 'slot')
            .setOrigin(0, 0)
            .setInteractive({ cursor: 'pointer' });
        slot.equipKey = key;

        const icon = this.scene.add.image(0, 0, '')
            .setOrigin(0.5, 0.5)
            .setVisible(false)
            .setScale(3);

        slot.on('pointerover', (p) => {
            const stack = this.scene.player.getEquipmentStack(key);
            if (!stack) {
                this.scene.showTooltip(this._slotLabel(key), p.x, p.y, slot);
                return;
            }
            const meta = this.scene.getItem(stack.id);
            this.scene.showTooltip(
                () => this.scene.formatItemTooltip(meta, stack.quantity, stack.spoilMinutes, stack),
                p.x, p.y, slot
            );
        });
        slot.on('pointerout', () => {
            if (this.scene._tooltipTarget === slot) this.scene.hideTooltip();
        });

        slot.on('pointerdown', (pointer) => {
            if (pointer.rightButtonDown()) {
                const result = this.scene.player.unequipToFirstHotbarSlot(key);
                if (result.ok) {
                    this.refresh();
                    this.layout();
                    this.scene.hotbar.dirty = true;
                    this.scene.refreshTooltip();
                } else {
                    this._shakeSlot(key);
                }
                return;
            }
            this._pointerDownPos = { x: pointer.x, y: pointer.y };
            this._pointerIsDown = true;
            this._dragFromKey = key;
            this._dragging = false;
        });

        slot.on('pointermove', (pointer) => {
            if (!this._pointerIsDown || this._dragging) return;
            if (this._dragFromKey !== key) return;
            const dist = Phaser.Math.Distance.Between(
                this._pointerDownPos.x, this._pointerDownPos.y,
                pointer.x, pointer.y
            );
            const threshold = Math.round(6 * (this.scene.uiScale || 1));
            if (dist < threshold) return;

            const stack = this.scene.player.getEquipmentStack(key);
            if (!stack) return;
            const meta = this.scene.getItem(stack.id);
            const sc = this.scene.uiScale || 1;
            const drag = createStackDragIcon(this.scene, pointer.x, pointer.y, stack, meta, 3 * sc);
            if (!drag) return;

            this._dragging = true;
            this.scene.hideTooltip();
            this._dragIcon = drag;
        });

        const fill = this.scene.add.image(0, 0, '')
            .setOrigin(0.5, 0.5)
            .setVisible(false)
            .setScale(3);

        this.slotsLayer.add(slot);
        this.slotsLayer.add(icon);
        this.slotsLayer.add(fill);
        const badges = createIngredientBadges(this.scene, (img) => {
            this.slotsLayer.add(img);
        });
        this.slotViews.push({ key, slot, icon, fill, badges });
    }

    _updateIcons() {
        const s = this.scene.uiScale || 1;
        for (const view of this.slotViews) {
            const stack = this.scene.player.getEquipmentStack(view.key);
            const meta = stack ? this.scene.getItem(stack.id) : null;
            syncStackIcon(view.icon, view.fill, stack, meta,
                id => this.scene.getItem(id), this.scene.textures, 3 * s);
            const slotW = view.slot.displayWidth;
            const rightX = view.slot.x + slotW - 4 * s;
            const bottomY = view.slot.y + slotW - 4 * s;
            syncIngredientBadges(view.badges, rightX, bottomY, s, stack,
                id => this.scene.getItem(id), this.scene.textures);
        }
    }

    _cancelDrag() {
        if (this._dragIcon) this._dragIcon.destroy();
        this._dragIcon = null;
        this._dragging = false;
        this._dragFromKey = null;
        this._pointerIsDown = false;
        this._pointerDownPos = null;
    }

    _shakeSlot(key) {
        const view = this.slotViews.find(v => v.key === key);
        if (!view) return;
        const s = this.scene.uiScale || 1;
        const shake = 3 * s;
        const homeX = view.homeX ?? view.slot.x;
        const homeY = view.homeY ?? view.slot.y;
        const iconHomeX = view.iconHomeX ?? view.icon.x;
        const iconHomeY = view.iconHomeY ?? view.icon.y;

        if (view._shakeTween) view._shakeTween.stop();
        view.slot.setPosition(homeX, homeY);
        view.icon.setPosition(iconHomeX, iconHomeY);
        view.fill?.setPosition(iconHomeX, iconHomeY);

        view._shakeTween = this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 160,
            onUpdate: (tw) => {
                const offset = Math.sin(tw.getValue() * Math.PI * 4) * shake;
                view.slot.x = homeX + offset;
                view.icon.x = iconHomeX + offset;
                if (view.fill) view.fill.x = iconHomeX + offset;
            },
            onComplete: () => {
                view.slot.setPosition(homeX, homeY);
                view.icon.setPosition(iconHomeX, iconHomeY);
                view.fill?.setPosition(iconHomeX, iconHomeY);
                view._shakeTween = null;
            }
        });
    }

    _onPointerUp(pointer) {
        if (!this._dragging) {
            this._pointerIsDown = false;
            this._pointerDownPos = null;
            this._dragFromKey = null;
            return;
        }

        const fromKey = this._dragFromKey;
        const hotbar = this.scene.hotbar;
        const toHotbar = hotbar.getIndexAt(pointer.x, pointer.y);

        let ok = false;
        if (toHotbar !== -1) {
            const result = this.scene.player.unequipToHotbar(fromKey, toHotbar);
            ok = result.ok;
            if (!ok) this._shakeSlot(fromKey);
        } else {
            const toEquip = this.getSlotAt(pointer.x, pointer.y);
            if (toEquip && toEquip !== fromKey) {
                // Drag between equip slots: unequip to temp via hotbar swap is hard;
                // use direct swap if same category
                ok = this._swapEquipSlots(fromKey, toEquip);
                if (!ok) this._shakeSlot(fromKey);
            }
        }

        this._cancelDrag();
        this.refresh();
        this.layout();
        hotbar.dirty = true;
        this.scene.refreshTooltip();
    }

    _swapEquipSlots(fromKey, toKey) {
        const player = this.scene.player;
        const a = player.getEquipmentStack(fromKey);
        const b = player.getEquipmentStack(toKey);
        if (!a) return false;

        const aMeta = this.scene.getItem(a.id);
        const aWant = player.getEquipSlotName(aMeta);
        const toBody = toKey.startsWith('waist:') ? 'waist' : toKey;
        if (aWant !== toBody) return false;

        if (b) {
            const bMeta = this.scene.getItem(b.id);
            const bWant = player.getEquipSlotName(bMeta);
            const fromBody = fromKey.startsWith('waist:') ? 'waist' : fromKey;
            if (bWant !== fromBody) return false;
        }

        // Provider rules when moving off a body slot
        if (!fromKey.startsWith('waist:') && !b) {
            if (!player.canChangeBodySlot(fromKey, null)) return false;
        }
        if (!fromKey.startsWith('waist:') && b) {
            const bMeta = this.scene.getItem(b.id);
            if (!player.canChangeBodySlot(fromKey, bMeta)) return false;
        }
        if (!toKey.startsWith('waist:')) {
            if (!player.canChangeBodySlot(toKey, aMeta)) return false;
        }

        player.setEquipmentStack(fromKey, b);
        player.setEquipmentStack(toKey, a);
        player.syncWaistSlots();
        player.recomputeEquipmentEffects();
        return true;
    }

    /** Called by Hotbar when a hotbar drag is released over an equip slot */
    tryEquipFromHotbar(hotbarIndex, pointer) {
        const key = this.getSlotAt(pointer.x, pointer.y);
        if (!key) return false;
        const result = this.scene.player.equipFromHotbar(hotbarIndex, key);
        if (!result.ok) {
            this._shakeSlot(key);
            return true; // consumed drop attempt
        }
        this.refresh();
        this.layout();
        this.scene.hotbar.dirty = true;
        this.scene.refreshTooltip();
        return true;
    }
}
