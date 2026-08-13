class CampfirePanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.campfire = null;
        this.slotViews = []; // { key, slot, icon, qty }

        this.container = scene.add.container(0, 0).setVisible(false).setDepth(100);
        // Scene root (not a Layer) so Phaser input depth-sort works; above time veil (depth 50).
        if (scene._uiCam) scene._uiCam.ignore(this.container);

        this._dragging = false;
        this._dragFromKey = null;
        this._dragIcon = null;
        this._pointerDownPos = null;
        this._pointerIsDown = false;

        this._buildSlots();

        this.cookBarBg = scene.add.graphics();
        this.cookBarFill = scene.add.graphics();
        this.container.add(this.cookBarBg);
        this.container.add(this.cookBarFill);

        scene.input.on('pointermove', (pointer) => {
            if (this._dragIcon && this._dragging) {
                this._dragIcon.setPosition(pointer.x, pointer.y);
            }
        });
        scene.input.on('pointerup', (pointer) => this._onPointerUp(pointer));
    }

    _worldUiScale() {
        const s = this.scene.uiScale || 1;
        const zoom = this.scene.worldZoom || 1;
        return s / zoom;
    }

    _isShellSimmer() {
        return this.campfire?.getCatalystMethod() === 'shell_simmer';
    }

    _isStickRoast() {
        return this.campfire?.getCatalystMethod() === 'stick_roast';
    }

    /** Roast food slot (stick). */
    _cookSlotOpen() {
        if (!this.campfire) return false;
        if (this._isShellSimmer()) return false;
        if (this.campfire.getCook()) return true;
        return this._isStickRoast();
    }

    /** Four simmer ingredient slots (coconut), or leftovers after vessel spoils. */
    _simmerSlotsOpen() {
        if (!this.campfire) return false;
        return this._isShellSimmer() || this.campfire.hasSimmerContents();
    }

    /** Can't remove vessel while roast food or simmer ingredients are loaded. */
    _catalystLocked() {
        if (!this.campfire) return false;
        if (this.campfire.getCook()) return true;
        return this.campfire.hasSimmerContents();
    }

    _buildSlots() {
        const keys = [
            'cook',
            'simmer:0', 'simmer:1', 'simmer:2', 'simmer:3',
            'catalyst',
            'fuel:0', 'fuel:1'
        ];
        for (const key of keys) {
            const slot = this.scene.add.image(0, 0, 'slot')
                .setOrigin(0.5, 0.5)
                .setInteractive({ cursor: 'pointer' });
            slot.campfireKey = key;

            const icon = this.scene.add.image(0, 0, '')
                .setOrigin(0.5, 0.5)
                .setVisible(false)
                .setScale(3);

            const qty = this.scene.add.text(0, 0, '', {
                fontSize: '14px',
                fontFamily: 'monospace',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 2
            }).setOrigin(1, 1).setVisible(false);

            slot.on('pointerover', (p) => {
                if (key === 'cook' && !this._cookSlotOpen()) return;
                if (key.startsWith('simmer:') && !this._simmerSlotsOpen()) return;
                this.scene.showTooltip(
                    () => {
                        if (key === 'cook' && !this._cookSlotOpen()) return '';
                        if (key.startsWith('simmer:') && !this._simmerSlotsOpen()) return '';
                        const stack = this._stackFor(key);
                        if (!stack) {
                            if (key === 'cook') return 'Roast';
                            if (key.startsWith('simmer:')) return 'Ingredient';
                            if (key === 'catalyst') return 'Cooking tool';
                            return 'Fuel';
                        }
                        const meta = this.scene.getItem(stack.id);
                        return this.scene.formatItemTooltip(
                            meta, stack.quantity, stack.spoilAt, stack
                        );
                    },
                    p.x, p.y, slot
                );
            });
            slot.on('pointerout', () => {
                if (this.scene._tooltipTarget === slot) this.scene.hideTooltip();
            });

            slot.on('pointerdown', (pointer) => {
                if (key === 'cook' && !this._cookSlotOpen()) return;
                if (key.startsWith('simmer:') && !this._simmerSlotsOpen()) return;
                if (pointer.rightButtonDown()) {
                    if (key === 'catalyst' && this._catalystLocked()) return;
                    this._returnStackToHotbar(key, pointer);
                    return;
                }
                if (key === 'catalyst' && this._catalystLocked()) return;
                this._pointerDownPos = { x: pointer.x, y: pointer.y };
                this._pointerIsDown = true;
                this._dragFromKey = key;
                this._dragging = false;
            });

            slot.on('pointermove', (pointer) => {
                if (!this._pointerIsDown || this._dragging) return;
                if (this._dragFromKey !== key) return;
                if (key === 'cook' && !this._cookSlotOpen()) return;
                if (key.startsWith('simmer:') && !this._simmerSlotsOpen()) return;
                if (key === 'catalyst' && this._catalystLocked()) return;
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

            const fill = this.scene.add.image(0, 0, '')
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

    _stackFor(key) {
        if (!this.campfire) return null;
        if (key === 'cook') return this.campfire.getCook();
        if (key === 'catalyst') return this.campfire.getCatalyst();
        if (key.startsWith('simmer:')) {
            return this.campfire.getSimmer(parseInt(key.slice(7), 10));
        }
        if (key.startsWith('fuel:')) {
            return this.campfire.getFuel(parseInt(key.slice(5), 10));
        }
        return null;
    }

    _setStack(key, stack) {
        if (!this.campfire) return;
        if (key === 'cook') {
            this.campfire.setCook(stack);
            return;
        }
        if (key === 'catalyst') {
            this.campfire.setCatalyst(stack);
            return;
        }
        if (key.startsWith('simmer:')) {
            this.campfire.setSimmer(parseInt(key.slice(7), 10), stack);
            return;
        }
        if (key.startsWith('fuel:')) {
            this.campfire.setFuel(parseInt(key.slice(5), 10), stack);
        }
    }

    _isDedicated() {
        return !!(this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal);
    }

    _notifyCampfire(op, extra = {}) {
        if (!this._isDedicated() || !this.campfire || typeof NetProtocol === "undefined") return;
        const entry = this.campfire.entry || {};
        if (!entry.uid) {
            entry.uid = `cf_${Math.round(this.campfire.x)}_${Math.round(this.campfire.y)}`;
        }
        if (op !== "attend" && op !== "leave") {
            this.scene._invSwapGuardUntil = performance.now() + 1000;
            this.scene._netSendMove?.(true);
        }
        this.scene.net.sendAction({
            type: NetProtocol.Actions.CAMPFIRE,
            op,
            uid: entry.uid,
            x: this.campfire.x,
            y: this.campfire.y,
            ...extra
        });
    }

    open(campfire) {
        // Only one world UI at a time; side menus (equip/craft/health) can stay open
        if (this.scene.corpsePanel?.visible) this.scene.corpsePanel.close();
        if (this.scene.storagePanel?.visible) this.scene.storagePanel.close();

        if (this.campfire && this.campfire !== campfire) this._notifyCampfire("leave");
        this.campfire = campfire;
        if (campfire?.entry && !campfire.entry.uid) {
            campfire.entry.uid = `cf_${Math.round(campfire.x)}_${Math.round(campfire.y)}`;
        }
        this.visible = true;
        this.container.setVisible(true);
        this.container.setPosition(campfire.x, campfire.y);
        this.refresh();
        this.layout();
        this._notifyCampfire("attend");
    }

    toggle(campfire) {
        if (this.visible && this.campfire === campfire) this.close();
        else this.open(campfire);
    }

    close() {
        this._notifyCampfire("leave");
        this.visible = false;
        this.campfire = null;
        this.container.setVisible(false);
        this.cookBarBg.clear();
        this.cookBarFill.clear();
        this._cancelDrag();
        this.scene.hideTooltip();
        // Dedicated: apply any YOU gear that arrived while the panel was open
        this.scene._flushPendingYouGear?.();
        if (this.scene.hotbar) {
            this.scene.hotbar.dirty = true;
            this.scene.hotbar.layout?.();
            this.scene.hotbar.dirty = false;
        }
    }

    refresh() {
        if (!this.campfire) return;
        const ws = this._worldUiScale();
        const cookOpen = this._cookSlotOpen();
        const simmerOpen = this._simmerSlotsOpen();

        for (const view of this.slotViews) {
            let showSlot = true;
            if (view.key === 'cook') showSlot = cookOpen;
            else if (view.key.startsWith('simmer:')) showSlot = simmerOpen;

            view.slot.setVisible(showSlot);
            if (showSlot) view.slot.setInteractive({ cursor: 'pointer' });
            else view.slot.disableInteractive();

            const stack = showSlot ? this._stackFor(view.key) : null;
            const meta = stack ? this.scene.getItem(stack.id) : null;
            syncStackIcon(
                view.icon, view.fill, stack, meta,
                id => this.scene.getItem(id), this.scene.textures, 3 * ws
            );
            if (stack) {
                if (stack.quantity > 1) {
                    view.qty.setText(String(stack.quantity)).setVisible(true);
                } else {
                    view.qty.setVisible(false);
                }
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
        this.refreshCookBar();
    }

    refreshCookBar() {
        this.cookBarBg.clear();
        this.cookBarFill.clear();
        if (!this.campfire) return;

        let barView = null;
        let minutes = 0;

        let advancing = true;
        const simmerBar = this._isShellSimmer()
            || ((this.campfire.entry.cookProgress || 0) > 0 && this.campfire.entry.simmerBarMinutes != null);

        if (simmerBar) {
            const filled = this.campfire.simmerFilledCount();
            const progressAmt = this.campfire.entry.cookProgress || 0;
            // Keep bar visible while draining (fire out / <2 ingredients / spoiled vessel)
            if (filled < 2 && progressAmt <= 0) return;
            minutes = this.campfire.entry.simmerBarMinutes
                || Math.max(filled, 2) * SIMMER_MINUTES_PER_SLOT;
            barView = this.slotViews.find(v => v.key === 'catalyst');
            advancing = this.campfire.isSimmerAdvancing();
        } else {
            const cook = this.campfire.getCook();
            const progressAmt = this.campfire.entry.cookProgress || 0;
            if (!cook || !this._cookSlotOpen()) {
                if (progressAmt <= 0) return;
            }
            const method = this.campfire.getCatalystMethod();
            let recipe = method
                ? getCookRecipe(id => this.scene.getItem(id), cook?.id, method)
                : null;
            if (!recipe && cook) {
                const cookMeta = this.scene.getItem(cook.id);
                for (const m of Object.keys(cookMeta?.cook || {})) {
                    recipe = getCookRecipe(id => this.scene.getItem(id), cook.id, m);
                    if (recipe) break;
                }
            }
            minutes = this.campfire.entry.roastBarMinutes
                || recipe?.minutes
                || 0;
            if (!(minutes > 0) || (progressAmt <= 0 && !recipe)) return;
            barView = this.slotViews.find(v => v.key === 'cook');
            // Orange while the fire is lit; gray only when draining after it goes out.
            // Don't use isRoastAdvancing() — dedicated MP can have a valid roast
            // (server-ticked) while the client helper still thinks it's paused.
            advancing = this.campfire.isLit();
        }

        if (!barView || !barView.slot.visible || !(minutes > 0)) return;

        const src = 64;
        const slotW = barView.slot.displayWidth;
        const slotH = barView.slot.displayHeight;
        const px = slotW / src;
        const barH = 4 * px;
        const inset = 4 * px;
        const x = barView.slot.x - slotW / 2 + inset;
        const y = barView.slot.y + slotH / 2 - barH;
        const maxW = slotW - inset * 2;
        const progress = Phaser.Math.Clamp(
            (this.campfire.entry.cookProgress || 0) / minutes,
            0,
            1
        );

        if (progress > 0) {
            // Amber while cooking, gray while paused/draining
            this.cookBarFill.fillStyle(advancing ? 0xe8a040 : 0x888888, 1);
            this.cookBarFill.fillRect(x, y, maxW * progress, barH);
        }
    }

    layout() {
        if (!this.campfire) return;
        const s = this.scene.uiScale || 1;
        const ws = this._worldUiScale();

        const padding = 4 * ws;
        const slotImg = this.scene.textures.get('slot').getSourceImage();
        const baseW = slotImg ? slotImg.width : 32;
        const slotW = baseW * ws;
        const spacing = slotW + padding;
        const fireH = this.campfire.displayHeight;
        const clear = 2;
        const catalystY = -(fireH + clear + slotW / 2);
        const aboveY = catalystY - (slotW + padding);
        const fuelY = clear + slotW / 2;

        const positions = {
            cook: { x: 0, y: aboveY },
            catalyst: { x: 0, y: catalystY },
            'fuel:0': { x: -spacing / 2, y: fuelY },
            'fuel:1': { x: spacing / 2, y: fuelY },
            // Four ingredients in one row above the coconut
            'simmer:0': { x: -1.5 * spacing, y: aboveY },
            'simmer:1': { x: -0.5 * spacing, y: aboveY },
            'simmer:2': { x: 0.5 * spacing, y: aboveY },
            'simmer:3': { x: 1.5 * spacing, y: aboveY }
        };

        const zoom = this.scene.worldZoom || 1;
        const fontPx = Math.round(14 * s);
        const strokePx = Math.max(2, Math.round(2 * s));
        for (const view of this.slotViews) {
            const p = positions[view.key];
            if (!p) continue;
            view.slot.setScale(ws).setPosition(p.x, p.y);
            view.icon.setScale(3 * ws).setPosition(p.x, p.y);
            view.fill.setScale(3 * ws).setPosition(p.x, p.y);
            view.qty.setResolution(zoom * (window.devicePixelRatio || 1));
            view.qty.setFontSize(`${fontPx}px`);
            view.qty.setStroke('#000000', strokePx);
            view.qty.setScale(1 / zoom);
            view.qty.setPosition(p.x + slotW / 2 - 4 * ws, p.y + slotW / 2 - 4 * ws);
        }
        this.container.setPosition(this.campfire.x, this.campfire.y);
        this.refresh();
    }

    update() {
        if (!this.visible || !this.campfire) return;
        if (!this.campfire.active || !this.campfire.inRange()) {
            this.close();
            return;
        }
        // Keep simmer/roast bar in sync while draining or cooking
        this.refreshCookBar();
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

    tryAddFromHotbar(hotbarIndex, pointer) {
        const key = this.getSlotAt(pointer.x, pointer.y);
        if (!key) return false;

        if (key === 'cook') {
            this._depositQty1FromHotbar('cook', hotbarIndex);
            return true;
        }
        if (key.startsWith('simmer:')) {
            this._depositSimmerFromHotbar(key, hotbarIndex);
            return true;
        }
        if (key === 'catalyst') {
            this._depositCatalystFromHotbar(hotbarIndex);
            return true;
        }

        const inv = this.scene.player.inventory;
        const stack = inv[hotbarIndex];
        if (!stack) return true;
        const meta = this.scene.getItem(stack.id);
        if (!meta?.fuel) return true;

        this._depositFuelIntoSlot(parseInt(key.slice(5), 10), hotbarIndex);
        return true;
    }

    tryAddFuelFromHotbar(hotbarIndex, pointer) {
        return this.tryAddFromHotbar(hotbarIndex, pointer);
    }

    tryQuickAdd(hotbarIndex, pointer = null) {
        if (!this.visible || !this.campfire) return false;
        const inv = this.scene.player.inventory;
        const stack = inv[hotbarIndex];
        if (!stack) return false;

        const meta = this.scene.getItem(stack.id);
        const isCatalyst = !!meta?.cook?.method;

        if (isCatalyst && !this.campfire.getCatalyst()) {
            this._depositCatalystFromHotbar(hotbarIndex);
            return true;
        }

        // Only add ingredients while a real shell vessel is present (not spoiled rot)
        if (this._isShellSimmer() && isSimmerIngredient(stack.id)) {
            for (let i = 0; i < 4; i++) {
                if (!this.campfire.getSimmer(i)) {
                    this._depositSimmerFromHotbar(`simmer:${i}`, hotbarIndex);
                    return true;
                }
            }
        }

        const hasCookRecipe = !!(meta?.cook && Object.values(meta.cook).some(r => r?.result));
        const preferCook = !!(meta?.food || hasCookRecipe);

        if (preferCook && this._cookSlotOpen() && !this.campfire.getCook()) {
            this._depositQty1FromHotbar('cook', hotbarIndex);
            return true;
        }

        if (meta?.fuel && !isCatalyst) {
            for (let pass = 0; pass < 2; pass++) {
                for (let idx = 0; idx < 2; idx++) {
                    const dest = this.campfire.getFuel(idx);
                    if (pass === 0) {
                        if (!dest || dest.id !== stack.id) continue;
                        const maxStack = Math.max(1, meta.maxStack || 1);
                        if (dest.quantity >= maxStack) continue;
                        this._depositFuelIntoSlot(idx, hotbarIndex, pointer);
                        return true;
                    }
                    if (!dest) {
                        this._depositFuelIntoSlot(idx, hotbarIndex, pointer);
                        return true;
                    }
                }
            }
        }

        // Sharp stick / tools that are also fuel: prefer fuel if catalyst filled
        if (meta?.fuel && isCatalyst && this.campfire.getCatalyst()) {
            for (let idx = 0; idx < 2; idx++) {
                if (!this.campfire.getFuel(idx)) {
                    this._depositFuelIntoSlot(idx, hotbarIndex, pointer);
                    return true;
                }
            }
        }

        if (isCatalyst) {
            this._depositCatalystFromHotbar(hotbarIndex);
            return true;
        }

        if (this._cookSlotOpen() && !this.campfire.getCook()) {
            this._depositQty1FromHotbar('cook', hotbarIndex);
            return true;
        }
        return false;
    }

    tryQuickAddFuel(hotbarIndex, pointer = null) {
        return this.tryQuickAdd(hotbarIndex, pointer);
    }

    _oneFromStack(stack) {
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const spoilAt = spoilAtForWorld(stack, now);
        const one = {
            id: stack.id,
            quantity: 1,
            ...(spoilAt != null ? { spoilAt } : {})
        };
        if (stack.customName) one.customName = stack.customName;
        if (stack.food) one.food = { ...stack.food };
        if (stack.ingredients) one.ingredients = stack.ingredients.slice();
        if (stack.weight != null) one.weight = stack.weight;
        if (stack.kind) one.kind = stack.kind;
        if (stack.fillTint != null) one.fillTint = stack.fillTint;
        return one;
    }

    /** Campfire/world stack clone (spoilAt). */
    _cloneStack(stack) {
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const spoilAt = spoilAtForWorld(stack, now);
        return {
            id: stack.id,
            quantity: stack.quantity,
            ...(spoilAt != null ? { spoilAt } : {}),
            ...(stack.customName ? { customName: stack.customName } : {}),
            ...(stack.food ? { food: { ...stack.food } } : {}),
            ...(stack.ingredients ? { ingredients: stack.ingredients.slice() } : {}),
            ...(stack.weight != null ? { weight: stack.weight } : {}),
            ...(stack.kind ? { kind: stack.kind } : {}),
            ...(stack.fillTint != null ? { fillTint: stack.fillTint } : {})
        };
    }

    /** Inventory stack from a campfire/world stack (spoilLeft). */
    _toInvStack(stack) {
        const clone = this._cloneStack(stack);
        const now = this.scene.worldMinuteIndex?.() ?? null;
        migrateToSpoilLeft(clone, now);
        return clone;
    }

    _depositCatalystFromHotbar(hotbarIndex) {
        if (!this.campfire) return;
        const inv = this.scene.player.inventory;
        const stack = inv[hotbarIndex];
        if (!stack) return;
        const meta = this.scene.getItem(stack.id);
        if (!meta?.cook?.method) return;

        const dest = this.campfire.getCatalyst();
        if (dest && this._catalystLocked()) return;
        if (dest && dest.id === stack.id) return;

        if (!dest) {
            this.campfire.setCatalyst(this._oneFromStack(stack));
            stack.quantity -= 1;
            if (stack.quantity <= 0) inv[hotbarIndex] = null;
        } else {
            const returning = this._toInvStack(dest);
            this.campfire.setCatalyst(this._oneFromStack(stack));
            stack.quantity -= 1;
            if (stack.quantity <= 0) {
                inv[hotbarIndex] = returning;
            } else {
                if (!this._tryInsertStack(returning)) {
                    stack.quantity += 1;
                    this.campfire.setCatalyst(dest);
                    return;
                }
            }
        }

        this.scene.hotbar.dirty = true;
        this.layout();
        this.scene.refreshTooltip();
        this._notifyCampfire("inv_to_slot", { inv: hotbarIndex, slot: "catalyst", amount: 1 });
    }

    _depositSimmerFromHotbar(key, hotbarIndex) {
        if (!this._isShellSimmer()) return;
        const inv = this.scene.player.inventory;
        const stack = inv[hotbarIndex];
        if (!stack || !isSimmerIngredient(stack.id)) return;

        const dest = this._stackFor(key);
        if (dest) return; // qty 1, no swap into occupied for simplicity unless empty

        this._setStack(key, this._oneFromStack(stack));
        stack.quantity -= 1;
        if (stack.quantity <= 0) inv[hotbarIndex] = null;

        this.scene.hotbar.dirty = true;
        this.refresh();
        this.scene.refreshTooltip();
        this._notifyCampfire("inv_to_slot", { inv: hotbarIndex, slot: key, amount: 1 });
    }

    _depositQty1FromHotbar(key, hotbarIndex) {
        if (!this.campfire) return;
        if (key === 'cook' && !this._cookSlotOpen()) return;

        const inv = this.scene.player.inventory;
        const stack = inv[hotbarIndex];
        if (!stack) return;

        const dest = this._stackFor(key);
        if (dest && dest.id === stack.id) return;

        if (!dest) {
            this._setStack(key, this._oneFromStack(stack));
            stack.quantity -= 1;
            if (stack.quantity <= 0) inv[hotbarIndex] = null;
        } else {
            const returning = this._toInvStack(dest);
            this._setStack(key, this._oneFromStack(stack));
            stack.quantity -= 1;
            if (stack.quantity <= 0) {
                inv[hotbarIndex] = returning;
            } else if (!this._tryInsertStack(returning)) {
                stack.quantity += 1;
                this._setStack(key, dest);
                return;
            }
        }

        this.scene.hotbar.dirty = true;
        this.refresh();
        this.scene.refreshTooltip();
        this._notifyCampfire("inv_to_slot", { inv: hotbarIndex, slot: key, amount: 1 });
    }

    /** Insert a full stack object into inventory (preserves custom meal fields). */
    _tryInsertStack(stack) {
        const inv = this.scene.player.inventory;
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const forInv = stack.spoilLeft != null ? stack : (() => {
            const c = cloneItemStack(stack) || stack;
            migrateToSpoilLeft(c, now);
            return c;
        })();
        const empty = inv.findIndex(s => !s);
        if (empty !== -1) {
            inv[empty] = forInv;
            return true;
        }
        if (inv.length < this.scene.player.inventorySize) {
            inv.push(forInv);
            return true;
        }
        // Fall back to gainItem (loses custom fields for non-meals; meals maxStack 1)
        if (forInv.customName || forInv.food) return false;
        const meta = this.scene.getItem(forInv.id);
        const left = this.scene.player.gainItem(
            meta, forInv.quantity, spoilLeftForCharacter(forInv, now)
        );
        return left < forInv.quantity && left === 0;
    }

    _depositFuelIntoSlot(idx, hotbarIndex, pointer = null) {
        const inv = this.scene.player.inventory;
        const stack = inv[hotbarIndex];
        if (!stack) return;
        const meta = this.scene.getItem(stack.id);
        const dest = this.campfire.getFuel(idx);
        const want = pointer != null && typeof quickMoveAmount === "function"
            ? quickMoveAmount(stack.quantity, pointer, this.scene)
            : stack.quantity;
        const now = this.scene.worldMinuteIndex?.() ?? null;
        let moved = 0;

        if (!dest) {
            moved = Math.min(stack.quantity, want);
            if (!(moved > 0)) return;
            const spoilAt = spoilAtForWorld(stack, now);
            this.campfire.setFuel(idx, {
                id: stack.id,
                quantity: moved,
                ...(spoilAt != null ? { spoilAt } : {})
            });
            stack.quantity -= moved;
            if (stack.quantity <= 0) inv[hotbarIndex] = null;
        } else if (dest.id === stack.id) {
            const maxStack = Math.max(1, meta?.maxStack || 1);
            const space = Math.max(0, maxStack - dest.quantity);
            if (space <= 0) return;
            moved = Math.min(space, want, stack.quantity);
            if (!(moved > 0)) return;
            dest.spoilAt = mergeSpoilAt(
                dest.quantity, dest.spoilAt,
                moved, spoilAtForWorld(stack, now)
            );
            dest.quantity += moved;
            stack.quantity -= moved;
            if (stack.quantity <= 0) inv[hotbarIndex] = null;
            this.campfire.setFuel(idx, dest);
        } else {
            // Different item: only full-stack swap
            if (want < stack.quantity) return;
            const spoilAt = spoilAtForWorld(stack, now);
            moved = stack.quantity;
            this.campfire.setFuel(idx, {
                id: stack.id,
                quantity: stack.quantity,
                ...(spoilAt != null ? { spoilAt } : {})
            });
            inv[hotbarIndex] = this._toInvStack(dest);
        }

        this.scene.hotbar.dirty = true;
        this.refresh();
        this.scene.refreshTooltip();
        this._notifyCampfire("inv_to_slot", {
            inv: hotbarIndex,
            slot: `fuel:${idx}`,
            amount: moved
        });
    }

    _returnStackToHotbar(key, pointer = null) {
        if (key === 'catalyst' && this._catalystLocked()) return;
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
                meta, amount, spoilLeftForCharacter(stack, now)
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
        this._notifyCampfire("slot_to_inv", { slot: key, inv: -1, amount: moved });
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
            const toHotbar = this.scene.hotbar.getIndexAt(pointer.x, pointer.y);
            if (toHotbar !== -1) {
                this._dropSlotToHotbar(fromKey, toHotbar);
            } else {
                const toKey = this.getSlotAt(pointer.x, pointer.y);
                if (toKey && toKey !== fromKey) {
                    this._moveBetweenSlots(fromKey, toKey);
                }
            }
        }

        this.layout();
        this._cancelDrag();
    }

    _dropSlotToHotbar(fromKey, toHotbar) {
        if (fromKey === 'catalyst' && this._catalystLocked()) return;
        const stack = this._stackFor(fromKey);
        if (!stack) return;
        const inv = this.scene.player.inventory;
        while (inv.length <= toHotbar) inv.push(null);
        const dest = inv[toHotbar];
        const now = this.scene.worldMinuteIndex?.() ?? null;
        let moved = stack.quantity;

        if (!dest) {
            inv[toHotbar] = this._toInvStack(stack);
            this._setStack(fromKey, null);
        } else if (dest.id === stack.id && !stack.customName && !dest.customName) {
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
                dest.quantity += moved;
                stack.quantity -= moved;
                if (stack.quantity <= 0) this._setStack(fromKey, null);
                else this._setStack(fromKey, stack);
            }
        } else if (fromKey === 'cook' || fromKey === 'catalyst' || fromKey.startsWith('simmer:')) {
            if (fromKey === 'catalyst') {
                const dMeta = this.scene.getItem(dest.id);
                if (!dMeta?.cook?.method) return;
            }
            if (fromKey.startsWith('simmer:') && !isSimmerIngredient(dest.id)) return;

            const one = this._oneFromStack(dest);
            dest.quantity -= 1;
            inv[toHotbar] = this._toInvStack(stack);
            this._setStack(fromKey, one);
            if (dest.quantity > 0) {
                const leftStack = this._toInvStack(dest);
                if (!this._tryInsertStack(leftStack)) {
                    inv[toHotbar] = dest;
                    dest.quantity += 1;
                    this._setStack(fromKey, stack);
                    return;
                }
            } else {
                // dest fully moved into campfire slot
            }
        } else {
            inv[toHotbar] = this._toInvStack(stack);
            this._setStack(fromKey, this._cloneStack(dest));
        }

        this.scene.hotbar.dirty = true;
        this.scene.refreshTooltip();
        this._notifyCampfire("slot_to_inv", {
            slot: fromKey,
            inv: toHotbar,
            amount: moved
        });
    }

    _moveBetweenSlots(fromKey, toKey) {
        if (fromKey === 'catalyst' && this._catalystLocked()) return;
        if (toKey === 'catalyst' && this._catalystLocked()) return;

        const a = this._stackFor(fromKey);
        if (!a) return;
        const b = this._stackFor(toKey);

        if (toKey === 'catalyst') {
            const meta = this.scene.getItem(a.id);
            if (!meta?.cook?.method) return;
            if (b && b.id === a.id) return;
            const one = this._oneFromStack(a);
            if (!b) {
                a.quantity -= 1;
                this._setStack('catalyst', one);
                this._setStack(fromKey, a.quantity > 0 ? a : null);
            } else if (a.quantity <= 1) {
                this._setStack(fromKey, b);
                this._setStack('catalyst', one);
            } else {
                return;
            }
            this._notifyCampfire("slot_to_slot", { from: fromKey, to: toKey });
            return;
        }

        if (toKey.startsWith('simmer:')) {
            if (!this._simmerSlotsOpen()) return;
            // Rearrange leftovers after vessel spoils; only add new food with a live shell
            if (!fromKey.startsWith('simmer:') && !this._isShellSimmer()) return;
            if (!isSimmerIngredient(a.id)) return;
            if (b) {
                if (fromKey.startsWith('simmer:') && a.quantity <= 1) {
                    this._setStack(fromKey, b);
                    this._setStack(toKey, a);
                    this._notifyCampfire("slot_to_slot", { from: fromKey, to: toKey });
                }
                return;
            }
            const one = this._oneFromStack(a);
            a.quantity -= 1;
            this._setStack(toKey, one);
            this._setStack(fromKey, a.quantity > 0 ? a : null);
            this._notifyCampfire("slot_to_slot", { from: fromKey, to: toKey });
            return;
        }

        if (toKey === 'cook') {
            if (!this._cookSlotOpen()) return;
            if (b && b.id === a.id) return;
            const one = this._oneFromStack(a);
            if (!b) {
                a.quantity -= 1;
                this._setStack('cook', one);
                this._setStack(fromKey, a.quantity > 0 ? a : null);
            } else if (a.quantity <= 1) {
                this._setStack(fromKey, b);
                this._setStack('cook', one);
            } else {
                return;
            }
            this._notifyCampfire("slot_to_slot", { from: fromKey, to: toKey });
            return;
        }

        if (fromKey === 'cook' || fromKey === 'catalyst' || fromKey.startsWith('simmer:')) {
            if (!b) {
                this._setStack(fromKey, null);
                this._setStack(toKey, a);
            } else if (b.id === a.id && !a.customName) {
                const meta = this.scene.getItem(b.id);
                const maxStack = Math.max(1, meta?.maxStack || 1);
                if (b.quantity >= maxStack) return;
                b.spoilAt = mergeSpoilAt(
                    b.quantity, b.spoilAt,
                    a.quantity, a.spoilAt
                );
                b.quantity += a.quantity;
                this._setStack(toKey, b);
                this._setStack(fromKey, null);
            } else if (b.quantity <= 1) {
                if (fromKey === 'catalyst') {
                    const bMeta = this.scene.getItem(b.id);
                    if (!bMeta?.cook?.method) return;
                }
                this._setStack(fromKey, b);
                this._setStack(toKey, a);
            } else {
                return;
            }
            this._notifyCampfire("slot_to_slot", { from: fromKey, to: toKey });
            return;
        }

        this._setStack(fromKey, b);
        this._setStack(toKey, a);
        this._notifyCampfire("slot_to_slot", { from: fromKey, to: toKey });
    }

    _cancelDrag() {
        if (this._dragIcon) this._dragIcon.destroy();
        this._dragIcon = null;
        this._dragging = false;
        this._dragFromKey = null;
        this._pointerIsDown = false;
        this._pointerDownPos = null;
    }

    /** True if screen pointer is over campfire slot chrome (not the empty center over the fire). */
    containsPointer(pointer) {
        if (!this.visible || !this.container?.visible || !pointer) return false;
        return this.getSlotAt(pointer.x, pointer.y) != null;
    }
}
