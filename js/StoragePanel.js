class StoragePanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.storage = null;
        this.slotViews = [];

        this.container = scene.add.container(0, 0).setVisible(false).setDepth(250);
        if (scene._uiCam) scene._uiCam.ignore(this.container);

        this._dragging = false;
        this._dragFromKey = null;
        this._dragIcon = null;
        this._pointerDownPos = null;
        this._pointerIsDown = false;

        this._buildSlots();
        this._buildTake();

        this.dryBarBg = scene.add.graphics();
        this.dryBarFill = scene.add.graphics();
        this.container.add(this.dryBarBg);
        this.container.add(this.dryBarFill);

        scene.input.on("pointermove", (pointer) => {
            if (this._dragIcon && this._dragging) {
                this._dragIcon.setPosition(pointer.x, pointer.y);
            }
        });
        scene.input.on("pointerup", (pointer) => this._onPointerUp(pointer));
    }

    _worldUiScale() {
        const s = this.scene.uiScale || 1;
        const zoom = this.scene.worldZoom || 1;
        return s / zoom;
    }

    _slotCount() {
        const entry = this.storage?.entry;
        const def = this.storage?.meta;
        if (typeof Place !== "undefined") return Place.storageSlotCount(def, entry) || 6;
        return Array.isArray(entry?.slots) ? entry.slots.length : 6;
    }

    _isDryingRack() {
        if (typeof Hide === "undefined") return false;
        return Hide.isDryingRack(this.storage?.meta, this.storage?.entry);
    }

    _acceptsStack(stack) {
        if (!stack) return false;
        const meta = this.scene.getItem(stack.id);
        const def = this.storage?.meta;
        if (typeof Hide !== "undefined") return Hide.slotAccepts(def, meta);
        return true;
    }

    _slotMax() {
        if (typeof Hide === "undefined") return 0;
        return Hide.slotMax(this.storage?.meta) || 0;
    }

    _prepareOutgoing(stack) {
        const piece = this._cloneStack(stack);
        if (!this._isDryingRack() || typeof Hide === "undefined") return piece;
        const now = this.scene.worldMinuteIndex?.() ?? null;
        return Hide.hangStack(piece, now, (id) => this.scene.getItem(id));
    }

    tryHangHeldHide(storage) {
        if (!storage || typeof Hide === "undefined") return false;
        if (!Hide.isDryingRack(storage.meta, storage.entry)) return false;
        if (!storage.inRange?.()) return false;
        const dest = storage.getSlot(0);
        if (dest && dest.quantity > 0) return false;
        const idx = this.scene.hotbar?.activeIndex;
        if (!Number.isInteger(idx) || idx < 0) return false;
        const held = this.scene.player?.inventory?.[idx];
        if (!held) return false;
        const meta = this.scene.getItem(held.id);
        if (!Hide.isHide(meta)) return false;
        const prev = this.storage;
        const was = this.visible;
        this.storage = storage;
        this._depositFromHotbar("0", idx, null, 1);
        const hung = !!(storage.getSlot(0)?.quantity > 0);
        if (!was) {
            this.storage = prev;
            if (!prev) {
                this.visible = false;
                this.container.setVisible(false);
            }
        } else {
            this.refresh();
        }
        return hung;
    }

    _buildSlots() {
        for (let i = 0; i < 6; i++) {
            const key = String(i);
            const slot = this.scene.add.image(0, 0, "slot")
                .setOrigin(0.5, 0.5)
                .setInteractive({ cursor: "pointer" });
            slot.storageKey = key;

            const icon = this.scene.add.image(0, 0, "")
                .setOrigin(0.5, 0.5)
                .setVisible(false)
                .setScale(3);

            const qty = this.scene.add.text(0, 0, "", {
                fontSize: `${pixelUiFontSize(16, 1)}px`,
                fontFamily: PIXEL_UI_FONT,
                color: "#ffffff",
                stroke: "#000000",
                strokeThickness: 2
            }).setOrigin(1, 1).setVisible(false);

            slot.on("pointerover", (p) => {
                this.scene.showTooltip(
                    () => {
                        const stack = this._stackFor(key);
                        if (!stack) {
                            const label = this.storage?.meta?.storage?.slotLabel;
                            return label || "Storage";
                        }
                        const meta = this.scene.getItem(stack.id);
                        const spoilPaused = typeof Hide !== "undefined"
                            && Hide.isDryingRack(this.storage?.meta, this.storage?.entry)
                            && Hide.isHide(meta);
                        return this.scene.formatItemTooltip(
                            meta, stack.quantity, stack.spoilAt, stack, { spoilPaused }
                        );
                    },
                    p.x, p.y, slot
                );
            });
            slot.on("pointerout", () => {
                if (this.scene._tooltipTarget === slot) this.scene.hideTooltip();
            });

            slot.on("pointerdown", (pointer) => {
                if (pointer.rightButtonDown()) {
                    this._returnStackToHotbar(key, pointer);
                    return;
                }
                this._pointerDownPos = { x: pointer.x, y: pointer.y };
                this._pointerIsDown = true;
                this._dragFromKey = key;
                this._dragging = false;
            });

            slot.on("pointermove", (pointer) => {
                if (!this._pointerIsDown || this._dragging) return;
                if (this._dragFromKey !== key) return;
                const dist = Phaser.Math.Distance.Between(
                    this._pointerDownPos.x, this._pointerDownPos.y,
                    pointer.x, pointer.y
                );
                const threshold = Math.round(6 * (this.scene.uiScale || 1));
                if (dist < threshold) return;

                const stack = this._stackFor(key);
                if (!stack) return;
                const meta = this.scene.getItem(stack.id);
                const sc = this.scene.uiScale || 1;
                const drag = createStackDragIcon(this.scene, pointer.x, pointer.y, stack, meta, 3 * sc);
                if (!drag) return;

                this._dragging = true;
                this.scene.hideTooltip();
                this._dragIcon = drag;
            });

            const fill = this.scene.add.image(0, 0, "")
                .setOrigin(0.5, 0.5)
                .setVisible(false)
                .setScale(3);

            this.container.add(slot);
            this.container.add(icon);
            this.container.add(fill);
            this.container.add(qty);
            const bar = this.scene.add.graphics();
            this.container.add(bar);
            const badges = createIngredientBadges(this.scene, (img) => {
                this.container.add(img);
            });
            this.slotViews.push({ key, slot, icon, fill, qty, bar, badges });
        }
    }

    _buildTake() {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;

        this.takeRect = this.scene.add.rectangle(0, 0, 78, 28, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });
        this.takeText = this.scene.add.text(0, 0, "Take", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        this.takeBtn = this.scene.add.container(0, 0, [this.takeRect, this.takeText]);

        this._takeHovering = false;
        this._takePressing = false;
        this._takeEnabled = true;
        this._takeBw = 78;
        this._takeBh = 28;
        this._paintTake = () => {
            const strokeW = 2 / (this.scene.worldZoom || 1);
            if (!this._takeEnabled) {
                this.takeRect.setFillStyle(BG, 1);
                this.takeRect.setStrokeStyle(strokeW, OUTLINE);
                this.takeText.setColor("#d4c4a8");
                return;
            }
            if (this._takePressing) {
                this.takeRect.setFillStyle(BG_PRESS, 1);
                this.takeRect.setStrokeStyle(strokeW, OUTLINE_PRESS);
            } else if (this._takeHovering) {
                this.takeRect.setFillStyle(BG, 1);
                this.takeRect.setStrokeStyle(strokeW, OUTLINE_HOVER);
            } else {
                this.takeRect.setFillStyle(BG, 1);
                this.takeRect.setStrokeStyle(strokeW, OUTLINE);
            }
            this.takeText.setColor("#d4c4a8");
        };

        this.takeRect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown() || !this._takeEnabled) return;
            this._takePressing = true;
            this._paintTake();
        });
        this.takeRect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = this._takePressing;
            this._takePressing = false;
            this._syncTakeHover();
            this._paintTake();
            if (was && this._takeHovering && this._takeEnabled) this._tryTake();
        });

        this.container.add(this.takeBtn);
    }

    _stackFor(key) {
        if (!this.storage) return null;
        const idx = typeof Place !== "undefined"
            ? Place.parseSlotIndex(key, this._slotCount())
            : parseInt(key, 10);
        if (idx < 0) return null;
        return this.storage.getSlot(idx);
    }

    _setStack(key, stack) {
        if (!this.storage) return;
        const idx = typeof Place !== "undefined"
            ? Place.parseSlotIndex(key, this._slotCount())
            : parseInt(key, 10);
        if (idx < 0) return;
        this.storage.setSlot(idx, stack);
    }

    _isDedicated() {
        return !!(this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal);
    }

    _notifyStorage(op, extra = {}) {
        if (!this._isDedicated() || !this.storage || typeof NetProtocol === "undefined") return;
        const entry = this.storage.entry || {};
        if (!entry.uid && typeof Place !== "undefined") {
            Place.ensureStorageEntry(entry, this.storage.meta);
        }
        if (op !== "attend" && op !== "leave") {
            this.scene._invSwapGuardUntil = performance.now() + 1000;
            this.scene._netSendMove?.(true);
        }
        this.scene.net.sendAction({
            type: NetProtocol.Actions.STORAGE,
            op,
            uid: entry.uid,
            x: this.storage.x,
            y: this.storage.y,
            pawnId: this.scene.player?.pawnId,
            ...extra
        });
    }

    open(storage) {
        if (this.scene.restBlocksWorldUi?.()) return;
        if (this.scene.corpsePanel?.visible) this.scene.corpsePanel.close();
        if (this.scene.campfirePanel?.visible) this.scene.campfirePanel.close();
        if (this.scene.leanToPanel?.visible) this.scene.leanToPanel.close();

        if (this.storage && this.storage !== storage) this._notifyStorage("leave");
        this.storage = storage;
        if (storage?.entry && typeof Place !== "undefined") {
            Place.ensureStorageEntry(storage.entry, storage.meta);
        }
        this.visible = true;
        this.container.setVisible(true);
        this.container.setPosition(storage.x, storage.y);
        this.refresh();
        this.layout();
        this._notifyStorage("attend");
    }

    toggle(storage) {
        if (this.visible && this.storage === storage) this.close();
        else this.open(storage);
    }

    close() {
        this._notifyStorage("leave");
        this.visible = false;
        this.storage = null;
        this.container.setVisible(false);
        this._cancelDrag();
        this.scene.hideTooltip();
        this.scene._flushPendingYouGear?.();
        if (this.scene.hotbar) {
            this.scene.hotbar.dirty = true;
            this.scene.hotbar.layout?.();
            this.scene.hotbar.dirty = false;
        }
    }

    refresh() {
        if (!this.storage) return;
        const ws = this._worldUiScale();
        const n = this._slotCount();

        for (let i = 0; i < this.slotViews.length; i++) {
            const view = this.slotViews[i];
            const showSlot = i < n;
            view.slot.setVisible(showSlot);
            if (showSlot) view.slot.setInteractive({ cursor: "pointer" });
            else view.slot.disableInteractive();

            const stack = showSlot ? this._stackFor(view.key) : null;
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
            drawSlotConditionBar(view.bar, view.slot, showSlot ? frac : null);
        }

        const empty = !!this.storage.isEmpty?.();
        this._takeEnabled = empty;
        this.takeBtn.setVisible(true);
        this.takeBtn.setAlpha(empty ? 1 : 0.35);
        if (empty) this._syncTakeHitArea(true);
        else this.takeRect.disableInteractive();
        this._syncTakeHover();
        this.refreshDryBar();
    }

    refreshDryBar() {
        this.dryBarBg?.clear();
        this.dryBarFill?.clear();
        if (!this.storage || typeof Hide === "undefined") return;
        const def = this.storage.meta;
        if (!Hide.isDryingRack(def, this.storage.entry)) return;
        const stack = this.storage.getSlot(0);
        const meta = stack ? this.scene.getItem(stack.id) : null;
        if (!Hide.isFleshedHide(meta)) return;
        const view = this.slotViews[0];
        if (!view?.slot?.visible) return;
        const minutes = Hide.DRY_MINUTES || 1440;
        const prog = Hide.dryProgressOf(stack);
        if (!(minutes > 0)) return;

        const src = 64;
        const slotW = view.slot.displayWidth;
        const slotH = view.slot.displayHeight;
        const px = slotW / src;
        const barH = 4 * px;
        const inset = 4 * px;
        const x = view.slot.x - slotW / 2 + inset;
        const y = view.slot.y + slotH / 2 - barH;
        const maxW = slotW - inset * 2;
        const progress = Phaser.Math.Clamp(prog / minutes, 0, 1);
        if (progress > 0) {
            this.dryBarFill.fillStyle(0xe8a040, 1);
            this.dryBarFill.fillRect(x, y, maxW * progress, barH);
        }
    }

    layout() {
        if (!this.storage) return;
        const s = this.scene.uiScale || 1;
        const ws = this._worldUiScale();
        const padding = 4 * ws;
        const slotImg = this.scene.textures.get("slot").getSourceImage();
        const baseW = slotImg ? slotImg.width : 32;
        const slotW = baseW * ws;
        const spacing = slotW + padding;
        const objH = this.storage.displayHeight || 16;
        const clear = 2;
        const n = this._slotCount();
        const cols = Math.min(3, Math.max(1, n));
        const rows = Math.ceil(n / cols);
        const bottomRowY = -(objH + clear + slotW / 2);

        const zoom = this.scene.worldZoom || 1;
        for (let i = 0; i < this.slotViews.length; i++) {
            const view = this.slotViews[i];
            if (i >= n) continue;
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = (col - (cols - 1) / 2) * spacing;
            const y = bottomRowY - (rows - 1 - row) * spacing;
            view.slot.setScale(ws).setPosition(x, y);
            view.icon.setScale(3 * ws).setPosition(x, y);
            view.fill.setScale(3 * ws).setPosition(x, y);
            view.qty.setStroke("#000000", Math.max(2, Math.round(2 * s)));
            if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(view.qty, 16, this.scene);
            else {
                view.qty.setResolution(zoom * (window.devicePixelRatio || 1));
                view.qty.setFontSize(`${pixelUiFontSize(16, s)}px`);
                view.qty.setScale(1 / zoom);
            }
            view.qty.setPosition(x + slotW / 2 - 4 * ws, y + slotW / 2 - 4 * ws);
        }

        const bw = 78 * ws;
        const bh = 28 * ws;
        this._takeBw = bw;
        this._takeBh = bh;
        this.takeRect.setSize(bw, bh);
        if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(this.takeText, 16, this.scene);
        else {
            this.takeText.setResolution(zoom * (window.devicePixelRatio || 1));
            this.takeText.setFontSize(`${pixelUiFontSize(16, s)}px`);
            this.takeText.setScale(1 / zoom);
        }
        this.takeBtn.setPosition(0, clear + bh / 2);

        this.container.setPosition(this.storage.x, this.storage.y);
        this.refresh();
    }

    _syncTakeHitArea(enable) {
        const bw = this._takeBw || 78;
        const bh = this._takeBh || 28;
        if (!enable) {
            this.takeRect.disableInteractive();
            return;
        }
        this.takeRect.setInteractive({ useHandCursor: true });
        if (this.takeRect.input?.hitArea?.setTo) {
            this.takeRect.input.hitArea.setTo(0, 0, bw, bh);
        }
    }

    pointerOnTake(pointer) {
        if (!this.visible || !this.takeBtn?.visible || !this.takeRect || !pointer) return false;
        const pt = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(this.takeRect.getBounds(), pt.x, pt.y);
    }

    _syncTakeHover() {
        const over = !!(this._takeEnabled && this.pointerOnTake(this.scene.input.activePointer));
        if (over !== this._takeHovering) {
            this._takeHovering = over;
            if (!over) this._takePressing = false;
        }
        this._paintTake?.();
    }

    update() {
        if (!this.visible || !this.storage) return;
        if (!this.storage.active || !this.storage.inRange()) {
            this.close();
            return;
        }
        this._syncTakeHover();
    }

    getSlotAt(screenX, screenY) {
        if (!this.visible) return null;
        const pt = this.scene.cameras.main.getWorldPoint(screenX, screenY);
        for (const view of this.slotViews) {
            if (!view.slot.visible) continue;
            if (Phaser.Geom.Rectangle.Contains(view.slot.getBounds(), pt.x, pt.y)) {
                return view.key;
            }
        }
        return null;
    }

    containsPointer(pointer) {
        if (!this.visible || !this.container?.visible || !pointer) return false;
        if (this.getSlotAt(pointer.x, pointer.y) != null) return true;
        if (!this.takeBtn?.visible) return false;
        return this.pointerOnTake(pointer);
    }

    _sourceInv(bag = this._sourceBag) {
        const p = this.scene.player;
        if (bag === 'overflow') {
            if (!Array.isArray(p.overflow)) p.overflow = [];
            return p.overflow;
        }
        return p.inventory;
    }

    tryAddFromHotbar(hotbarIndex, pointer, bag = 'hotbar') {
        this._sourceBag = bag === 'overflow' ? 'overflow' : 'hotbar';
        const key = this.getSlotAt(pointer.x, pointer.y);
        if (!key) {
            this._sourceBag = 'hotbar';
            return false;
        }
        this._depositFromHotbar(key, hotbarIndex, pointer);
        this._sourceBag = 'hotbar';
        return true;
    }

    tryQuickAdd(hotbarIndex, pointer = null, bag = 'hotbar') {
        if (!this.visible || !this.storage) return false;
        this._sourceBag = bag === 'overflow' ? 'overflow' : 'hotbar';
        try {
            const inv = this._sourceInv();
            const stack = inv[hotbarIndex];
            if (!stack) return false;
            if (!this._acceptsStack(stack)) return false;
            const n = this._slotCount();
            for (let pass = 0; pass < 2; pass++) {
                for (let i = 0; i < n; i++) {
                    const dest = this.storage.getSlot(i);
                    if (pass === 0) {
                        if (!dest || dest.id !== stack.id) continue;
                        if (typeof isSpecialStack === "function" && (isSpecialStack(stack) || isSpecialStack(dest))) continue;
                        const meta = this.scene.getItem(stack.id);
                        const maxStack = Math.max(1, meta?.maxStack || 1);
                        if (dest.quantity >= maxStack) continue;
                        this._depositFromHotbar(String(i), hotbarIndex, pointer);
                        return true;
                    }
                    if (!dest) {
                        this._depositFromHotbar(String(i), hotbarIndex, pointer);
                        return true;
                    }
                }
            }
            return false;
        } finally {
            this._sourceBag = 'hotbar';
        }
    }

    _oneFromStack(stack) {
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const spoilAt = spoilAtForWorld(stack, now);
        const one = {
            id: stack.id,
            quantity: 1,
            ...(spoilAt != null ? { spoilAt } : {})
        };
        const extras = typeof mealStackExtras === "function" ? mealStackExtras(stack) : null;
        if (extras) Object.assign(one, extras);
        return one;
    }

    _cloneStack(stack) {
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const spoilAt = spoilAtForWorld(stack, now);
        const clone = cloneItemStack(stack) || { id: stack.id, quantity: stack.quantity };
        if (spoilAt != null) clone.spoilAt = spoilAt;
        delete clone.spoilLeft;
        return clone;
    }

    _toInvStack(stack) {
        const clone = this._cloneStack(stack);
        const now = this.scene.worldMinuteIndex?.() ?? null;
        migrateToSpoilLeft(clone, now);
        return clone;
    }

    _tryInsertStack(stack) {
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const forInv = stack.spoilLeft != null ? stack : (() => {
            const c = cloneItemStack(stack) || stack;
            migrateToSpoilLeft(c, now);
            return c;
        })();
        if (this.scene.player.insertOwnedStack?.(forInv)) return true;
        if (forInv.customName || forInv.food) return false;
        const meta = this.scene.getItem(forInv.id);
        const left = this.scene.player.gainItem(
            meta, forInv.quantity, spoilLeftForCharacter(forInv, now),
            { dryProgress: forInv.dryProgress, soakProgress: forInv.soakProgress }
        );
        return left < forInv.quantity && left === 0;
    }

    _depositFromHotbar(key, hotbarIndex, pointer = null, amountCap = null) {
        if (!this.storage) return;
        const inv = this._sourceInv();
        const stack = inv[hotbarIndex];
        if (!stack) return;
        if (!this._acceptsStack(stack)) return;
        const meta = this.scene.getItem(stack.id);
        const dest = this._stackFor(key);
        const special = typeof isSpecialStack === "function" && isSpecialStack(stack);
        const want = pointer != null && typeof quickMoveAmount === "function"
            ? quickMoveAmount(stack.quantity, pointer, this.scene)
            : stack.quantity;
        const slotMax = this._slotMax();
        const now = this.scene.worldMinuteIndex?.() ?? null;
        let moved = 0;

        if (!dest) {
            moved = Math.min(stack.quantity, want);
            if (amountCap != null) moved = Math.min(moved, amountCap);
            if (slotMax > 0) moved = Math.min(moved, slotMax);
            if (!(moved > 0)) return;
            const piece = this._prepareOutgoing(stack);
            piece.quantity = moved;
            this._setStack(key, piece);
            stack.quantity -= moved;
            if (stack.quantity <= 0) inv[hotbarIndex] = null;
        } else if (dest.id === stack.id && !special && !(typeof isSpecialStack === "function" && isSpecialStack(dest))) {
            const maxStack = Math.max(1, meta?.maxStack || 1);
            let space = Math.max(0, maxStack - dest.quantity);
            if (slotMax > 0) space = Math.min(space, Math.max(0, slotMax - dest.quantity));
            if (space <= 0) return;
            moved = Math.min(space, want, stack.quantity);
            if (amountCap != null) moved = Math.min(moved, amountCap);
            if (!(moved > 0)) return;
            dest.spoilAt = mergeSpoilAt(
                dest.quantity, dest.spoilAt,
                moved, spoilAtForWorld(stack, now)
            );
            mergeDryInto(dest, dest.quantity, moved, stack.dryProgress);
            mergeSoakInto(dest, dest.quantity, moved, stack.soakProgress);
            mergeTempInto(dest, dest.quantity, moved, stack.temp);
            dest.quantity += moved;
            stack.quantity -= moved;
            if (stack.quantity <= 0) inv[hotbarIndex] = null;
            this._setStack(key, dest);
        } else {
            if (!this._acceptsStack(stack)) return;
            if (want < stack.quantity) return;
            if (slotMax > 0 && stack.quantity > slotMax) return;
            moved = stack.quantity;
            this._setStack(key, this._prepareOutgoing(stack));
            inv[hotbarIndex] = this._toInvStack(dest);
        }

        this.scene.hotbar.dirty = true;
        this.refresh();
        this.scene.refreshTooltip();
        this._notifyStorage("inv_to_slot", {
            inv: hotbarIndex,
            slot: key,
            amount: moved,
            bag: this._sourceBag === 'overflow' ? 'overflow' : 'hotbar'
        });
    }

    _returnStackToHotbar(key, pointer = null) {
        const stack = this._stackFor(key);
        if (!stack) return;
        const now = this.scene.worldMinuteIndex?.() ?? null;
        let moved = stack.quantity;

        if (stack.customName || stack.food) {
            if (!this._tryInsertStack(this._toInvStack(stack))) return;
            this._setStack(key, null);
        } else {
            const meta = this.scene.getItem(stack.id);
            if (!meta) return;
            const want = pointer != null && typeof quickMoveAmount === "function"
                ? quickMoveAmount(stack.quantity, pointer, this.scene)
                : stack.quantity;
            const amount = Math.min(stack.quantity, want);
            if (!(amount > 0)) return;
            const remaining = this.scene.player.gainItem(
                meta, amount, spoilLeftForCharacter(stack, now),
                { dryProgress: stack.dryProgress, soakProgress: stack.soakProgress }
            );
            moved = amount - remaining;
            if (moved <= 0) return;
            stack.quantity -= moved;
            if (stack.quantity <= 0) this._setStack(key, null);
            else this._setStack(key, stack);
        }
        this.layout();
        this.scene.hotbar.dirty = true;
        this.scene.refreshTooltip();
        this._notifyStorage("slot_to_inv", { slot: key, inv: -1, amount: moved });
    }

    _giveSlotToParty(fromKey, target) {
        const stack = this._stackFor(fromKey);
        if (!stack || !target) return false;
        const from = this.scene.player;
        if (!this.scene.partySys?.canGiveTo(from, target, stack)) return false;
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        if (this._isDedicated()) {
            this._setStack(fromKey, null);
            this._notifyStorage("slot_to_inv", {
                slot: fromKey,
                inv: -1,
                amount: qty,
                toPawnId: target.pawnId
            });
            this.layout();
            this.scene.refreshTooltip();
            return true;
        }
        const invStack = this._toInvStack(stack);
        if (!this.scene.partySys.deliverGive(target, invStack)) {
            this.scene.combatLog?.push(`${target.displayName()} cannot carry that`);
            return false;
        }
        this._setStack(fromKey, null);
        this.layout();
        this.scene.hotbar.dirty = true;
        this.scene.refreshTooltip();
        return true;
    }

    _onPointerUp(pointer) {
        if (!this._dragging) {
            this._pointerIsDown = false;
            this._pointerDownPos = null;
            this._dragFromKey = null;
            return;
        }

        const fromKey = this._dragFromKey;
        const stack = this._stackFor(fromKey);
        if (stack) {
            const partyTarget = this.scene.partySys?.partyDropTarget?.(pointer);
            if (partyTarget && this._giveSlotToParty(fromKey, partyTarget)) {
                // given
            } else {
                const toBag = this.scene.hotbar.getBagSlotAt?.(pointer.x, pointer.y);
                if (toBag) {
                    this._dropSlotToHotbar(fromKey, toBag.index, toBag.bag);
                } else {
                    const toKey = this.getSlotAt(pointer.x, pointer.y);
                    if (toKey && toKey !== fromKey) {
                        this._moveBetweenSlots(fromKey, toKey);
                    }
                }
            }
        }

        this.layout();
        this._cancelDrag();
    }

    _dropSlotToHotbar(fromKey, toHotbar, bag = 'hotbar') {
        const stack = this._stackFor(fromKey);
        if (!stack) return;
        const toBag = bag === 'overflow' ? 'overflow' : 'hotbar';
        const player = this.scene.player;
        const inv = player.bagArray(toBag);
        const cap = player.bagCap(toBag);
        if (toHotbar < 0 || toHotbar >= cap) return;
        while (inv.length <= toHotbar && inv.length < cap) inv.push(null);
        const dest = inv[toHotbar];
        const now = this.scene.worldMinuteIndex?.() ?? null;
        let moved = stack.quantity;

        if (!dest) {
            inv[toHotbar] = this._toInvStack(stack);
            this._setStack(fromKey, null);
        } else if (dest.id === stack.id && !stack.customName && !dest.customName
            && !(typeof isSpecialStack === "function" && (isSpecialStack(stack) || isSpecialStack(dest)))) {
            const meta = this.scene.getItem(dest.id);
            const maxStack = Math.max(1, meta?.maxStack || 1);
            const space = maxStack - dest.quantity;
            if (space > 0) {
                moved = Math.min(space, stack.quantity);
                dest.spoilLeft = mergeSpoilLeft(
                    dest.quantity, dest.spoilLeft,
                    moved, spoilLeftForCharacter(stack, now)
                );
                delete dest.spoilAt;
                mergeDryInto(dest, dest.quantity, moved, stack.dryProgress);
                mergeSoakInto(dest, dest.quantity, moved, stack.soakProgress);
                mergeTempInto(dest, dest.quantity, moved, stack.temp);
                dest.quantity += moved;
                stack.quantity -= moved;
                if (stack.quantity <= 0) this._setStack(fromKey, null);
                else this._setStack(fromKey, stack);
            }
        } else {
            inv[toHotbar] = this._toInvStack(stack);
            this._setStack(fromKey, this._cloneStack(dest));
        }

        this.scene.hotbar.dirty = true;
        this.scene.refreshTooltip();
        this._notifyStorage("slot_to_inv", {
            slot: fromKey,
            inv: toHotbar,
            amount: moved,
            bag: toBag
        });
    }

    _moveBetweenSlots(fromKey, toKey) {
        const a = this._stackFor(fromKey);
        if (!a) return;
        const b = this._stackFor(toKey);
        if (!b) {
            this._setStack(toKey, a);
            this._setStack(fromKey, null);
        } else if (a.id === b.id && !a.customName && !b.customName
            && !(typeof isSpecialStack === "function" && (isSpecialStack(a) || isSpecialStack(b)))) {
            const meta = this.scene.getItem(a.id);
            const maxStack = Math.max(1, meta?.maxStack || 1);
            const space = Math.max(0, maxStack - b.quantity);
            if (space <= 0) {
                this._setStack(fromKey, b);
                this._setStack(toKey, a);
            } else {
                const moved = Math.min(space, a.quantity);
                b.spoilAt = mergeSpoilAt(b.quantity, b.spoilAt, moved, a.spoilAt);
                mergeDryInto(b, b.quantity, moved, a.dryProgress);
                mergeSoakInto(b, b.quantity, moved, a.soakProgress);
                mergeTempInto(b, b.quantity, moved, a.temp);
                b.quantity += moved;
                a.quantity -= moved;
                this._setStack(toKey, b);
                this._setStack(fromKey, a.quantity > 0 ? a : null);
            }
        } else {
            this._setStack(fromKey, b);
            this._setStack(toKey, a);
        }
        this._notifyStorage("slot_to_slot", { from: fromKey, to: toKey });
    }

    _tryTake() {
        if (!this.storage || !this.storage.isEmpty()) return;
        this.scene.tryPickupStorage?.(this.storage);
    }

    _cancelDrag() {
        this._dragging = false;
        this._dragFromKey = null;
        this._pointerIsDown = false;
        this._pointerDownPos = null;
        if (this._dragIcon) {
            this._dragIcon.destroy();
            this._dragIcon = null;
        }
    }
}
