/**
 * World-anchored corpse loot UI: take-only, 5 cols, rows grow upward.
 * Empty holes stick for the open session; compact on close.
 * Corpse is only removed when the UI closes on an empty inventory.
 */
class CorpsePanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.corpse = null;
        /** @type {(Object|null)[]} session loot including null holes */
        this.session = [];
        this.slotViews = [];

        this.container = scene.add.container(0, 0).setVisible(false).setDepth(60);
        if (scene._uiCam) scene._uiCam.ignore(this.container);

        this.bg = scene.add.rectangle(0, 0, 16, 16, 0x1a1410, 0.85)
            .setOrigin(0.5, 1)
            .setStrokeStyle(2, 0x6b5344)
            .setInteractive({ cursor: "default" });
        this.container.add(this.bg);

        this.slotsLayer = scene.add.container(0, 0);
        this.container.add(this.slotsLayer);

        this._dragging = false;
        this._dragFrom = null;
        this._dragIcon = null;
        this._pointerDownPos = null;
        this._pointerIsDown = false;

        scene.input.on("pointermove", (pointer) => {
            if (this._dragIcon && this._dragging) {
                this._dragIcon.setPosition(pointer.x, pointer.y);
            }
        });
        scene.input.on("pointerup", (pointer) => this._onPointerUp(pointer));
    }

    toggle(corpse) {
        if (this.visible && this.corpse === corpse) this.close();
        else this.open(corpse);
    }

    update() {
        if (!this.visible || !this.corpse) return;
        if (!this.corpse.active || !this.corpse.inRange?.()) {
            this.close();
        }
    }

    open(corpse) {
        if (!corpse?.entry) return;
        if (corpse.inRange && !corpse.inRange()) return;
        // Only one world UI at a time; side menus (equip/craft/health) can stay open
        if (this.scene.campfirePanel?.visible) this.scene.campfirePanel.close();

        this.corpse = corpse;
        this.session = (corpse.entry.loot || []).map(s => cloneItemStack(s));
        this._hadLootOnOpen = this.session.some(Boolean);
        // Empty corpse: one inert slot until the UI is closed
        if (!this.session.length) this.session = [null];

        this.visible = true;
        this.container.setVisible(true);
        this._rebuildSlots();
        this.layout();
        this.refresh();
        this._showCorpseHealth();
    }

    _showCorpseHealth() {
        const entry = this.corpse?.entry;
        const hp = this.scene.healthPanel;
        if (!hp) return;
        // Equipment/craft already using the left rail — skip inspect overlay
        if (this.scene.equipmentPanel?.visible || this.scene.craftMenuVisible) return;
        if (!entry?.body) {
            if (hp.visible) hp.close();
            return;
        }
        const planId = entry.bodyPlan || entry.body.planId || "human";
        const body = new Body(this.scene, planId, null);
        body.loadJSON(entry.body);
        const name = entry.name || "Corpse";
        hp.openInspect(body, name === "Corpse" ? "Corpse" : `${name} (corpse)`);
    }

    _closeCorpseHealth() {
        const hp = this.scene.healthPanel;
        if (hp?.isInspecting?.()) hp.close();
    }

    /**
     * @param {boolean} [skipCompact] if true, skip rewriting entry (used while destroying)
     */
    close(skipCompact = false) {
        if (!this.visible && !this.corpse) return;
        this._cancelDrag();
        this.scene.hideTooltip();
        this._closeCorpseHealth();

        const corpse = this.corpse;
        if (corpse && !skipCompact) {
            corpse.setLootFromSession(this.session);
            if (corpse.isEmpty()) {
                this.visible = false;
                this.corpse = null;
                this.session = [];
                this.container.setVisible(false);
                this._clearSlots();
                corpse.removeForever();
                return;
            }
        }

        this.visible = false;
        this.corpse = null;
        this.session = [];
        this.container.setVisible(false);
        this._clearSlots();
    }

    _clearSlots() {
        for (const view of this.slotViews) {
            view.slot.destroy();
            view.icon.destroy();
            view.fill.destroy();
            view.qty.destroy();
            destroyIngredientBadges(view.badges);
        }
        this.slotViews = [];
        this.slotsLayer.removeAll(false);
    }

    _rebuildSlots() {
        this._clearSlots();
        if (!this.session.length) this.session = [null];
        const n = this.session.length;
        for (let i = 0; i < n; i++) {
            this._buildSlot(i);
        }
    }

    _buildSlot(index) {
        const slot = this.scene.add.image(0, 0, "slot")
            .setOrigin(0, 0)
            .setInteractive({ cursor: "pointer" });
        slot.corpseIndex = index;

        const icon = this.scene.add.image(0, 0, "").setOrigin(0.5, 0.5).setVisible(false);
        const fill = this.scene.add.image(0, 0, "").setOrigin(0.5, 0.5).setVisible(false);
        const qty = this.scene.add.text(0, 0, "", {
            fontSize: "14px",
            fontFamily: "monospace",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 2
        }).setOrigin(1, 1).setVisible(false);

        const badges = createIngredientBadges(this.scene, (img) => {
            this.slotsLayer.add(img);
        });

        slot.on("pointerover", (p) => {
            const stack = this.session[index];
            if (!stack) {
                this.scene.showTooltip("Empty", p.x, p.y, slot);
                return;
            }
            const meta = this.scene.getItem(stack.id);
            this.scene.showTooltip(
                () => this.scene.formatItemTooltip(
                    meta, stack.quantity, stack.spoilMinutes, stack
                ),
                p.x, p.y, slot
            );
        });
        slot.on("pointerout", () => {
            if (this.scene._tooltipTarget === slot) this.scene.hideTooltip();
        });

        slot.on("pointerdown", (pointer) => {
            // Empty slots are display-only
            if (!this.session[index]) return;
            if (pointer.rightButtonDown()) {
                this._takeToInventory(index);
                return;
            }
            this._pointerDownPos = { x: pointer.x, y: pointer.y };
            this._pointerIsDown = true;
            this._dragFrom = index;
            this._dragging = false;
        });

        slot.on("pointermove", (pointer) => {
            if (!this._pointerIsDown || this._dragging) return;
            if (this._dragFrom !== index) return;
            const dist = Phaser.Math.Distance.Between(
                this._pointerDownPos.x, this._pointerDownPos.y,
                pointer.x, pointer.y
            );
            const threshold = Math.round(6 * (this.scene.uiScale || 1));
            if (dist < threshold) return;
            const stack = this.session[index];
            if (!stack) return;
            const meta = this.scene.getItem(stack.id);
            const sc = this.scene.uiScale || 1;
            const drag = createStackDragIcon(this.scene, pointer.x, pointer.y, stack, meta, 3 * sc);
            if (!drag) return;
            this._dragging = true;
            this.scene.hideTooltip();
            this._dragIcon = drag;
        });

        this.slotsLayer.add(slot);
        this.slotsLayer.add(icon);
        this.slotsLayer.add(fill);
        this.slotsLayer.add(qty);
        this.slotViews.push({ index, slot, icon, fill, qty, badges });
    }

    _worldUiScale() {
        const s = this.scene.uiScale || 1;
        const zoom = this.scene.worldZoom || 1;
        return s / zoom;
    }

    layout() {
        if (!this.corpse || !this.visible) return;
        const ws = this._worldUiScale();
        const cols = 5;
        const n = this.slotViews.length;
        const rows = Math.max(1, Math.ceil(n / cols));
        const slotImg = this.scene.textures.get("slot").getSourceImage();
        const base = slotImg ? slotImg.width : 16;
        const slotScale = ws;
        const slotW = base * slotScale;
        const pad = 2 * ws;
        const spacing = slotW + pad;
        const gridW = Math.min(cols, n) * spacing - pad;
        const gridH = rows * spacing - pad;

        // Rows grow upward; bottom row centered above corpse
        this.container.setPosition(this.corpse.x, this.corpse.y - 8);
        this.bg.setSize(gridW + 8 * ws, gridH + 8 * ws);
        this.bg.setPosition(0, 0);
        if (this.bg.input?.hitArea?.setSize) {
            this.bg.input.hitArea.setSize(this.bg.width, this.bg.height);
        }

        for (let i = 0; i < n; i++) {
            const view = this.slotViews[i];
            const col = i % cols;
            const rowFromBottom = Math.floor(i / cols);
            const x = -gridW / 2 + col * spacing;
            const y = -pad * 2 - slotW - rowFromBottom * spacing;
            view.slot.setScale(slotScale).setPosition(x, y);
            const cx = x + slotW / 2;
            const cy = y + slotW / 2;
            view.icon.setPosition(cx, cy);
            view.fill.setPosition(cx, cy);
            view.qty.setPosition(x + slotW - 2 * ws, y + slotW - 2 * ws);
            syncIngredientBadges(
                view.badges,
                view.qty.x, view.qty.y, ws,
                this.session[i],
                id => this.scene.getItem(id),
                this.scene.textures
            );
        }
    }

    refresh() {
        if (!this.visible) return;
        const ws = this._worldUiScale();
        for (const view of this.slotViews) {
            const stack = this.session[view.index];
            const meta = stack ? this.scene.getItem(stack.id) : null;
            syncStackIcon(
                view.icon, view.fill, stack, meta,
                id => this.scene.getItem(id), this.scene.textures, 3 * ws
            );
            if (stack && stack.quantity > 1) {
                view.qty.setText(String(stack.quantity)).setVisible(true);
            } else {
                view.qty.setVisible(false);
            }
            syncIngredientBadges(
                view.badges,
                view.qty.x, view.qty.y, ws,
                stack,
                id => this.scene.getItem(id),
                this.scene.textures
            );
        }
        this.layout();
    }

    _syncPersist() {
        if (!this.corpse) return;
        this.corpse.setLootFromSession(this.session);
    }

    _afterTake() {
        this._syncPersist();
        this.scene.hotbar.dirty = true;
        this.scene.refreshTooltip?.();
        // Looted corpses: last item taken → close UI/health and destroy immediately
        if (this._hadLootOnOpen && !this.session.some(Boolean)) {
            const corpse = this.corpse;
            this.close(true);
            corpse?.removeForever();
            return;
        }
        this.refresh();
    }

    /**
     * Right-click take: if equipment menu is open and the item's slot is empty,
     * equip there; otherwise move into inventory/hotbar.
     */
    _takeToInventory(index) {
        const stack = this.session[index];
        if (!stack) return;

        if (
            this.scene.equipmentPanel?.visible &&
            this.scene.player.tryEquipLootStackIfSlotEmpty?.(stack)
        ) {
            if (!(stack.quantity > 0)) this.session[index] = null;
            this._afterTake();
            this.scene.equipmentPanel.refresh();
            this.scene.equipmentPanel.layout();
            return;
        }

        const ok = this.scene.player.takeLootStack?.(stack);
        if (!ok) return;
        this.session[index] = null;
        this._afterTake();
    }

    /**
     * Place session stack into a hotbar index (merge / empty slot).
     * @returns {boolean}
     */
    tryDepositToHotbar(hotbarIndex) {
        if (this._dragFrom == null) return false;
        const stack = this.session[this._dragFrom];
        if (!stack) return false;
        const inv = this.scene.player.inventory;
        while (inv.length <= hotbarIndex) inv.push(null);
        const dest = inv[hotbarIndex];
        const meta = this.scene.getItem(stack.id);
        if (!meta) return false;

        const special = !!(stack.customName || stack.food || stack.ingredients);
        if (!dest) {
            inv[hotbarIndex] = cloneItemStack(stack);
            this.session[this._dragFrom] = null;
            this._afterTake();
            return true;
        }
        if (!special && dest.id === stack.id && !dest.customName && !dest.food && !dest.ingredients) {
            const maxStack = Math.max(1, meta.maxStack || 1);
            const space = Math.max(0, maxStack - dest.quantity);
            if (space <= 0) return false;
            const moved = Math.min(space, stack.quantity);
            dest.spoilMinutes = mergeSpoilMinutes(
                dest.quantity, dest.spoilMinutes,
                moved, stack.spoilMinutes
            );
            dest.quantity += moved;
            stack.quantity -= moved;
            if (stack.quantity <= 0) this.session[this._dragFrom] = null;
            else this.session[this._dragFrom] = stack;
            this._afterTake();
            return true;
        }
        return false;
    }

    _onPointerUp(pointer) {
        if (this._dragging && this._dragFrom != null) {
            let handled = false;
            const hotIdx = this.scene.hotbar?.getIndexAt?.(pointer.x, pointer.y);
            if (hotIdx != null && hotIdx >= 0) {
                handled = this.tryDepositToHotbar(hotIdx);
            }
            if (this._dragIcon) this._dragIcon.destroy();
            this._dragIcon = null;
            this._dragFrom = null;
        }
        this._dragging = false;
        this._pointerIsDown = false;
        this._pointerDownPos = null;
    }

    _cancelDrag() {
        if (this._dragIcon) this._dragIcon.destroy();
        this._dragIcon = null;
        this._dragFrom = null;
        this._dragging = false;
        this._pointerIsDown = false;
        this._pointerDownPos = null;
    }

    /** For hover blocking — bounds of panel background in world space. */
    getBounds() {
        return this.bg?.getBounds?.() || null;
    }
}
