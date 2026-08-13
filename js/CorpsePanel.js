/**
 * World-anchored corpse loot UI: take-only, 5 cols, rows grow upward.
 * Empty holes stick while anything remains; taking the last item closes and despawns.
 */
class CorpsePanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.corpse = null;
        /** @type {(Object|null)[]} session loot including null holes */
        this.session = [];
        this.slotViews = [];

        this.container = scene.add.container(0, 0).setVisible(false).setDepth(100);
        // Scene root (not a Layer) so Phaser input depth-sort works; above time veil (depth 50).
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
        // Close other world/craft UIs; equipment can stay open for right-click equip-from-loot
        if (this.scene.campfirePanel?.visible) this.scene.campfirePanel.close();
        if (this.scene.storagePanel?.visible) this.scene.storagePanel.close();
        if (this.scene.craftMenuVisible) this.scene.closeCraftMenu();

        this.corpse = corpse;
        this.session = (corpse.entry.loot || []).map(s => cloneItemStack(s));
        this._hadLootOnOpen = this.session.some(Boolean);
        // Empty corpse: one inert slot until the UI is closed
        if (!this.session.length) this.session = [null];

        this.visible = true;
        this.container.setVisible(true);
        // Above corpses (≈y) and the time veil (50); keep relative order by world Y
        const dy = Number(corpse.y) || 0;
        this.container.setDepth(Math.max(100, dy + 80));
        this._rebuildSlots();
        this.layout();
        this.refresh();
        this._showCorpseHealth();
    }

    _showCorpseHealth() {
        const entry = this.corpse?.entry;
        const hp = this.scene.healthPanel;
        if (!hp) return;
        if (!entry?.body) {
            if (hp.visible) hp.close();
            return;
        }
        const planId = entry.bodyPlan || entry.body.planId || "human";
        const body = new Body(this.scene, planId, null);
        body.loadJSON(entry.body);
        const name = entry.name || "Corpse";
        const carcass = entry.stage === "carcass";
        const label = name === "Corpse"
            ? (carcass ? "Carcass" : "Corpse")
            : `${name} (${carcass ? "carcass" : "corpse"})`;
        hp.openInspect(body, label);
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
        const sessionEmpty = !this.session.some(Boolean);
        if (corpse && !skipCompact) {
            if (!this._dedicatedNet()) {
                corpse.setLootFromSession(this.session);
            }
            if (sessionEmpty || corpse.isEmpty?.()) {
                this.visible = false;
                this.corpse = null;
                this.session = [];
                this.container.setVisible(false);
                this._clearSlots();
                if (this._dedicatedNet()) this._notifyServerDismiss(corpse);
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
            view.bar?.destroy();
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
            fontFamily: "PrimaryFont",
            align: "right",
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
                    meta, stack.quantity, stack.spoilAt, stack
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
                this._takeToInventory(index, pointer);
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
        const bar = this.scene.add.graphics();
        this.slotsLayer.add(bar);
        this.slotViews.push({ index, slot, icon, fill, qty, bar, badges });
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

        const s = this.scene.uiScale || 1;
        const zoom = this.scene.worldZoom || 1;
        const fontPx = Math.round(14 * s);
        const strokePx = Math.max(2, Math.round(2 * s));
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
            // Crisp screen-sized glyphs under worldZoom (same as campfire qty)
            view.qty.setResolution(zoom * (window.devicePixelRatio || 1));
            view.qty.setFontSize(`${fontPx}px`);
            view.qty.setStroke("#000", strokePx);
            view.qty.setScale(1 / zoom);
            view.qty.setPosition(x + slotW - 4 * ws, y + slotW - 4 * ws);
            syncIngredientBadges(
                view.badges,
                view.qty.x, view.qty.y, ws,
                this.session[i],
                id => this.scene.getItem(id),
                this.scene.textures
            );
            const stack = this.session[i];
            const meta = stack ? this.scene.getItem(stack.id) : null;
            const frac = (typeof Durability !== "undefined" && stack)
                ? Durability.slotBarFraction(stack, meta)
                : null;
            drawSlotConditionBar(view.bar, view.slot, frac);
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
            const frac = (typeof Durability !== "undefined" && stack)
                ? Durability.slotBarFraction(stack, meta)
                : null;
            drawSlotConditionBar(view.bar, view.slot, frac);
        }
        this.layout();
    }

    _syncPersist() {
        if (!this.corpse) return;
        // Dedicated: server owns corpse loot — never write the local session over it.
        if (this._dedicatedNet()) return;
        this.corpse.setLootFromSession(this.session);
    }

    _dedicatedNet() {
        return !!(this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal);
    }

    /** Tell the dedicated server we took qty from a corpse slot. */
    _notifyServerTake(index, quantity, opts = null) {
        if (!this._dedicatedNet()) return;
        const id = this.corpse?.entry?.id;
        const stack = this.session[index];
        if (!id || !(quantity > 0) || !stack?.id) return;
        const player = this.scene.player;
        this.scene._netSendMove?.(true);
        this.scene.net.sendAction({
            type: NetProtocol.Actions.CORPSE_TAKE,
            corpseId: id,
            index,
            itemId: stack.id,
            quantity,
            equipIfEmpty: !!opts?.equipIfEmpty,
            x: player?.x,
            y: player?.y
        });
    }

    /** Dedicated: ask the server to despawn an empty corpse after the loot UI closes. */
    _notifyServerDismiss(corpse) {
        if (!this._dedicatedNet()) return;
        const id = corpse?.entry?.id;
        if (!id) return;
        const player = this.scene.player;
        this.scene._netSendMove?.(true);
        this.scene.net.sendAction({
            type: NetProtocol.Actions.CORPSE_DISMISS,
            corpseId: id,
            x: player?.x,
            y: player?.y
        });
    }

    /** Rebuild session from authoritative entry loot (dedicated snapshots / events). */
    syncFromEntry() {
        if (!this.corpse?.entry || !this.visible) return;
        const loot = (this.corpse.entry.loot || [])
            .filter(Boolean)
            .map((s) => (typeof cloneItemStack === "function" ? cloneItemStack(s) : { ...s }));
        const pool = loot.slice();

        // Sticky holes while open: never compact the grid mid-session.
        // Rematch remaining stacks into existing slots; extras (e.g. skin loot) append.
        if (!this.session.length) this.session = [null];
        for (let i = 0; i < this.session.length; i++) {
            if (!this.session[i]) continue;
            const id = this.session[i].id;
            const j = pool.findIndex((s) => s && s.id === id);
            if (j >= 0) this.session[i] = pool.splice(j, 1)[0];
            else this.session[i] = null;
        }
        // Failed takes / snapshot rewind: put leftover stacks back into sticky holes
        // before growing the grid (otherwise each rejected right-click adds a slot).
        for (let i = 0; i < this.session.length && pool.length; i++) {
            if (this.session[i]) continue;
            this.session[i] = pool.shift();
        }
        let grew = false;
        for (const s of pool) {
            this.session.push(s);
            grew = true;
        }
        this._hadLootOnOpen = this._hadLootOnOpen || this.session.some(Boolean);
        if (!this.session.some(Boolean)) {
            // Took the last item (or another player did) — despawn immediately.
            // Never-looted empty corpses stay open for inspect until closed.
            if (this._hadLootOnOpen) {
                this.close();
                return;
            }
            if (!this.session.length) this.session = [null];
            this.refresh();
            return;
        }
        if (grew) this._rebuildSlots();
        else this.refresh();
    }

    _afterTake() {
        this._syncPersist();
        this.scene.hotbar.dirty = true;
        this.scene.refreshTooltip?.();
        if (!this.session.some(Boolean) && this._hadLootOnOpen) {
            this.close();
            return;
        }
        this.refresh();
    }

    /**
     * Right-click take: if equipment menu is open and the item's slot is empty,
     * equip there; otherwise move into inventory/hotbar.
     * Amount: 1 / Shift=all / Ctrl=half (equip path always takes 1).
     */
    _takeToInventory(index, pointer = null) {
        const stack = this.session[index];
        if (!stack) return;

        const equipOpen = !!this.scene.equipmentPanel?.visible;
        const canEquipEmpty = !!(
            equipOpen
            && this.scene.player.canEquipLootStackIfSlotEmpty?.(stack)
        );

        if (canEquipEmpty) {
            if (this._dedicatedNet()) {
                this._notifyServerTake(index, 1, { equipIfEmpty: true });
            }
            if (!this.scene.player.tryEquipLootStackIfSlotEmpty?.(stack)) {
                // Race / local reject — fall through to inventory take
            } else {
                if (!(stack.quantity > 0)) this.session[index] = null;
                this._afterTake();
                this.scene.equipmentPanel.refresh();
                this.scene.equipmentPanel.layout();
                return;
            }
        }

        const amount = Math.min(
            stack.quantity,
            typeof quickMoveAmount === "function"
                ? quickMoveAmount(stack.quantity, pointer, this.scene)
                : 1
        );
        if (!(amount > 0)) return;

        // Dedicated: optimistic holes locally; server confirms via YOU + corpse loot event.
        // If nothing fits, leave the stack in this slot — don't send a take the server will reject.
        if (this._dedicatedNet()) {
            const canTake = this.scene.player.countLootSpace?.(stack, amount) ?? 0;
            if (!(canTake > 0)) return;
            const moved = Math.min(amount, canTake);
            this._notifyServerTake(index, moved);
            if (moved >= stack.quantity) {
                this.session[index] = null;
            } else {
                stack.quantity -= moved;
                if (stack.quantity <= 0) this.session[index] = null;
            }
            this._afterTake();
            return;
        }

        if (amount >= stack.quantity) {
            const ok = this.scene.player.takeLootStack?.(stack);
            if (!ok) return;
            this.session[index] = null;
            this._afterTake();
            return;
        }

        const part = cloneItemStack(stack);
        part.quantity = amount;
        const ok = this.scene.player.takeLootStack?.(part);
        if (!ok) return;
        stack.quantity -= amount;
        if (stack.quantity <= 0) this.session[index] = null;
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

        if (this._dedicatedNet()) {
            const meta = this.scene.getItem(stack.id);
            if (!meta) return false;
            const dest = this.scene.player.inventory[hotbarIndex];
            let moved = stack.quantity;
            if (dest && (dest.id !== stack.id || dest.customName || dest.food || dest.ingredients
                || stack.customName || stack.food || stack.ingredients)) {
                return false;
            }
            if (dest && dest.id === stack.id) {
                const maxStack = Math.max(1, meta.maxStack || 1);
                const space = Math.max(0, maxStack - dest.quantity);
                if (space <= 0) return false;
                moved = Math.min(space, stack.quantity);
            }
            this._notifyServerTake(this._dragFrom, moved);
            if (moved >= stack.quantity) this.session[this._dragFrom] = null;
            else {
                stack.quantity -= moved;
                if (stack.quantity <= 0) this.session[this._dragFrom] = null;
            }
            this._afterTake();
            return true;
        }

        const inv = this.scene.player.inventory;
        while (inv.length <= hotbarIndex) inv.push(null);
        const dest = inv[hotbarIndex];
        const meta = this.scene.getItem(stack.id);
        if (!meta) return false;

        const special = !!(stack.customName || stack.food || stack.ingredients);
        if (!dest) {
            const moved = Math.max(1, Math.floor(Number(stack.quantity) || 1));
            const from = this._dragFrom;
            inv[hotbarIndex] = (() => {
                const c = cloneItemStack(stack);
                migrateToSpoilLeft(c, this.scene.worldMinuteIndex?.() ?? null);
                return c;
            })();
            this.session[this._dragFrom] = null;
            this._afterTake();
            return true;
        }
        if (!special && dest.id === stack.id && !dest.customName && !dest.food && !dest.ingredients) {
            const maxStack = Math.max(1, meta.maxStack || 1);
            const space = Math.max(0, maxStack - dest.quantity);
            if (space <= 0) return false;
            const moved = Math.min(space, stack.quantity);
            const now = this.scene.worldMinuteIndex?.() ?? null;
            dest.spoilLeft = mergeSpoilLeft(
                dest.quantity, dest.spoilLeft,
                moved, spoilLeftForCharacter(stack, now)
            );
            delete dest.spoilAt;
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

    /** For hover/click blocking — true if screen pointer is over the panel in world space. */
    containsPointer(pointer) {
        if (!this.visible || !this.bg || !pointer) return false;
        const cam = this.scene.cameras?.main;
        if (!cam) return false;
        const wpt = cam.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(this.bg.getBounds(), wpt.x, wpt.y);
    }

    /** For hover blocking — bounds of panel background in world space. */
    getBounds() {
        return this.bg?.getBounds?.() || null;
    }
}
