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
        this._buildDestroy();
        this._buildHeatLabel();

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

    _isSmokeHide() {
        return this.campfire?.getCatalystMethod() === 'smoke_hide';
    }

    /** Roast food slot (stick). */
    _cookSlotOpen() {
        if (!this.campfire) return false;
        if (this._isShellSimmer()) return false;
        if (this.campfire.getCook()) return true;
        return this._isStickRoast() || this._isSmokeHide();
    }

    /** Roast/smoke slot only takes an item with a recipe for the current tool. */
    _cookAccepts(stack) {
        if (!stack || !this.campfire) return false;
        const method = this.campfire.getCatalystMethod();
        if (!method) return false;
        return !!getCookRecipe(id => this.scene.getItem(id), stack.id, method);
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
                fontSize: `${pixelUiFontSize(16, 1)}px`,
                fontFamily: PIXEL_UI_FONT,
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
                            if (key === 'cook') return this._isSmokeHide() ? 'Smoke' : 'Roast';
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
            const heat = this.scene.add.text(0, 0, "", {
                fontSize: `${pixelUiFontSize(8, 1)}px`,
                fontFamily: PIXEL_UI_FONT,
                color: "#e8a040",
                stroke: "#000000",
                strokeThickness: 2
            }).setOrigin(0, 0).setVisible(false);
            this.container.add(heat);
            const bar = this.scene.add.graphics();
            this.container.add(bar);
            const badges = createIngredientBadges(this.scene, (img) => {
                this.container.add(img);
            });
            this.slotViews.push({ key, slot, icon, fill, qty, heat, bar, badges });
        }
    }

    _buildHeatLabel() {
        this.heatText = this.scene.add.text(0, 0, "", {
            fontSize: `${pixelUiFontSize(8, 1)}px`,
            fontFamily: PIXEL_UI_FONT,
            color: "#e8a040",
            stroke: "#000000",
            strokeThickness: 3,
            align: "center"
        }).setOrigin(0.5, 0.5).setVisible(false);
        this.container.add(this.heatText);
    }

    _buildDestroy() {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;

        this.destroyRect = this.scene.add.rectangle(0, 0, 90, 28, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });
        this.destroyText = this.scene.add.text(0, 0, "Destroy", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        this.destroyBtn = this.scene.add.container(0, 0, [this.destroyRect, this.destroyText]);

        this._destroyHovering = false;
        this._destroyPressing = false;
        this._destroyEnabled = false;
        this._destroyBw = 90;
        this._destroyBh = 28;
        this._paintDestroy = () => {
            const strokeW = 2 / (this.scene.worldZoom || 1);
            if (!this._destroyEnabled) {
                this.destroyRect.setFillStyle(BG, 1);
                this.destroyRect.setStrokeStyle(strokeW, OUTLINE);
                this.destroyText.setColor("#d4c4a8");
                return;
            }
            if (this._destroyPressing) {
                this.destroyRect.setFillStyle(BG_PRESS, 1);
                this.destroyRect.setStrokeStyle(strokeW, OUTLINE_PRESS);
            } else if (this._destroyHovering) {
                this.destroyRect.setFillStyle(BG, 1);
                this.destroyRect.setStrokeStyle(strokeW, OUTLINE_HOVER);
            } else {
                this.destroyRect.setFillStyle(BG, 1);
                this.destroyRect.setStrokeStyle(strokeW, OUTLINE);
            }
            this.destroyText.setColor("#d4c4a8");
        };

        this.destroyRect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown() || !this._destroyEnabled) return;
            this._destroyPressing = true;
            this._paintDestroy();
        });
        this.destroyRect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = this._destroyPressing;
            this._destroyPressing = false;
            this._syncDestroyHover();
            this._paintDestroy();
            if (was && this._destroyHovering && this._destroyEnabled) this._tryDestroy();
        });

        this.container.add(this.destroyBtn);
        this.destroyBtn.setVisible(false);
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
            pawnId: this.scene.player?.pawnId,
            ...extra
        });
    }

    open(campfire) {
        if (this.scene.restBlocksWorldUi?.()) return;
        // Only one world UI at a time; side menus (equip/craft/health) can stay open
        if (this.scene.corpsePanel?.visible) this.scene.corpsePanel.close();
        if (this.scene.storagePanel?.visible) this.scene.storagePanel.close();
        if (this.scene.leanToPanel?.visible) this.scene.leanToPanel.close();

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
        this.destroyBtn?.setVisible(false);
        this.destroyRect?.disableInteractive();
        this._destroyEnabled = false;
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
            const showHeat = showSlot
                && (view.key === "cook" || view.key === "catalyst" || view.key.startsWith("simmer:"))
                && typeof Fire !== "undefined"
                && Fire.stackShowsTemp(stack);
            if (view.heat) {
                if (showHeat) {
                    view.heat.setText(Fire.formatTemp(stack.temp));
                    view.heat.setColor(Fire.heatColor(Fire.heatBand(stack.temp)));
                    view.heat.setVisible(true);
                } else {
                    view.heat.setVisible(false);
                }
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

        const canDestroy = !this.campfire.isLit?.();
        this._destroyEnabled = canDestroy;
        this.destroyBtn?.setVisible(canDestroy);
        if (canDestroy) this._syncDestroyHitArea(true);
        else this.destroyRect?.disableInteractive();
        this._syncDestroyHover();
        this.refreshHeatLabel();
        this.refreshCookBar();
    }

    refreshHeatLabel() {
        const txt = this.heatText;
        if (!txt) return;
        if (!this.campfire || typeof Fire === "undefined") {
            txt.setVisible(false);
            return;
        }
        const temp = Number(this.campfire.entry?.pitTemp);
        const deg = Math.round(Number.isFinite(temp) ? temp : Fire.AMBIENT_TEMP);
        const band = Fire.heatBand(deg);
        txt.setText(Fire.formatTemp(deg));
        txt.setColor(Fire.heatColor(band));
        txt.setVisible(true);
    }

    refreshCookBar() {
        this.cookBarBg.clear();
        this.cookBarFill.clear();
        if (!this.campfire) return;

        let barView = null;
        let minutes = 0;

        let advancing = true;
        const simmerBar = this._isShellSimmer()
            || ((this.campfire.entry.cookProgress || 0) > 0 && (this.campfire.entry.simmerBarMinutes || 0) > 0);

        if (simmerBar) {
            const filled = this.campfire.simmerFilledCount();
            const progressAmt = this.campfire.entry.cookProgress || 0;
            // Keep bar visible while draining (fire out / <2 ingredients / spoiled vessel)
            if (filled < 2 && progressAmt <= 0) return;
            minutes = this.campfire.entry.simmerBarMinutes
                || Math.max(filled, 2) * SIMMER_MINUTES_PER_SLOT;
            barView = this.slotViews.find(v => v.key === 'catalyst');
            advancing = typeof Fire !== "undefined"
                ? Fire.isCookAdvancing(this.campfire.entry, (id) => this.scene.getItem(id))
                : this.campfire.isSimmerAdvancing();
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
            advancing = typeof Fire !== "undefined"
                ? Fire.isCookAdvancing(this.campfire.entry, (id) => this.scene.getItem(id))
                : this.campfire.isLit();
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
        const fontPx = pixelUiFontSize(16, s);
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
            if (view.heat) {
                const heatFont = pixelUiFontSize(8, s);
                view.heat.setResolution(zoom * (window.devicePixelRatio || 1));
                view.heat.setFontSize(`${heatFont}px`);
                view.heat.setStroke("#000000", Math.max(2, Math.round(2 * s)));
                view.heat.setScale(1 / zoom);
                view.heat.setPosition(p.x - slotW / 2 + 3 * ws, p.y - slotW / 2 + 2 * ws);
            }
        }

        const btnFontPx = pixelUiFontSize(16, s);
        const bw = 90 * ws;
        const bh = 28 * ws;
        this._destroyBw = bw;
        this._destroyBh = bh;
        this.destroyRect.setSize(bw, bh);
        this.destroyText.setResolution(zoom * (window.devicePixelRatio || 1));
        this.destroyText.setFontSize(`${btnFontPx}px`);
        this.destroyText.setScale(1 / zoom);
        this.destroyBtn.setPosition(0, fuelY + slotW / 2 + padding + bh / 2);

        if (this.heatText) {
            const heatFont = pixelUiFontSize(8, s);
            this.heatText.setResolution(zoom * (window.devicePixelRatio || 1));
            this.heatText.setFontSize(`${heatFont}px`);
            this.heatText.setStroke("#000000", Math.max(2, Math.round(3 * s)));
            this.heatText.setScale(1 / zoom);
            this.heatText.setPosition(0, 0);
        }

        this.container.setPosition(this.campfire.x, this.campfire.y);
        this.refreshHeatLabel();
        this.refresh();
    }

    _syncDestroyHitArea(enable) {
        const bw = this._destroyBw || 90;
        const bh = this._destroyBh || 28;
        if (!enable) {
            this.destroyRect?.disableInteractive();
            return;
        }
        this.destroyRect.setInteractive({ useHandCursor: true });
        if (this.destroyRect.input?.hitArea?.setTo) {
            this.destroyRect.input.hitArea.setTo(0, 0, bw, bh);
        }
    }

    pointerOnDestroy(pointer) {
        if (!this.visible || !this.destroyBtn?.visible || !this.destroyRect || !pointer) return false;
        const pt = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(this.destroyRect.getBounds(), pt.x, pt.y);
    }

    _syncDestroyHover() {
        const over = !!(this._destroyEnabled && this.pointerOnDestroy(this.scene.input.activePointer));
        if (over !== this._destroyHovering) {
            this._destroyHovering = over;
            if (!over) this._destroyPressing = false;
        }
        this._paintDestroy?.();
    }

    _tryDestroy() {
        if (!this._destroyEnabled || !this.campfire) return;
        this.scene.tryDestroyCampfire?.(this.campfire);
    }

    update() {
        if (!this.visible || !this.campfire) return;
        if (!this.campfire.active || !this.campfire.inRange()) {
            this.close();
            return;
        }
        this._syncDestroyHover();
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
        try {
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

            const inv = this._sourceInv();
            const stack = inv[hotbarIndex];
            if (!stack) return true;
            const meta = this.scene.getItem(stack.id);
            if (!meta?.fuel) return true;

            this._depositFuelIntoSlot(parseInt(key.slice(5), 10), hotbarIndex);
            return true;
        } finally {
            this._sourceBag = 'hotbar';
        }
    }

    tryAddFuelFromHotbar(hotbarIndex, pointer, bag = 'hotbar') {
        return this.tryAddFromHotbar(hotbarIndex, pointer, bag);
    }

    tryQuickAdd(hotbarIndex, pointer = null, bag = 'hotbar') {
        if (!this.visible || !this.campfire) return false;
        this._sourceBag = bag === 'overflow' ? 'overflow' : 'hotbar';
        try {
            const inv = this._sourceInv();
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

            const hasCookRecipe = this._cookAccepts(stack);
            const preferCook = hasCookRecipe;

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

            if (this._cookSlotOpen() && !this.campfire.getCook() && this._cookAccepts(stack)) {
                this._depositQty1FromHotbar('cook', hotbarIndex);
                return true;
            }
            return false;
        } finally {
            this._sourceBag = 'hotbar';
        }
    }

    tryQuickAddFuel(hotbarIndex, pointer = null, bag = 'hotbar') {
        return this.tryQuickAdd(hotbarIndex, pointer, bag);
    }

    _stackMoveExtras(stack) {
        return {
            dryProgress: stack?.dryProgress,
            soakProgress: stack?.soakProgress,
            temp: stack?.temp
        };
    }

    _fuelStackFrom(stack, quantity, now) {
        const spoilAt = spoilAtForWorld(stack, now);
        const out = {
            id: stack.id,
            quantity,
            ...(spoilAt != null ? { spoilAt } : {})
        };
        if (typeof Fire !== "undefined") Fire.copyStackTemp(stack, out);
        return out;
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
        if (typeof Fire !== "undefined") Fire.copyStackTemp(stack, one);
        return one;
    }

    /** Campfire/world stack clone (spoilAt). */
    _cloneStack(stack) {
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const spoilAt = spoilAtForWorld(stack, now);
        const clone = {
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
        if (typeof Fire !== "undefined") Fire.copyStackTemp(stack, clone);
        return clone;
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
        const inv = this._sourceInv();
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
        this._notifyCampfire("inv_to_slot", { inv: hotbarIndex, slot: "catalyst", amount: 1, bag: this._sourceBag === 'overflow' ? 'overflow' : 'hotbar' });
    }

    _depositSimmerFromHotbar(key, hotbarIndex) {
        if (!this._isShellSimmer()) return;
        const inv = this._sourceInv();
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
        this._notifyCampfire("inv_to_slot", { inv: hotbarIndex, slot: key, amount: 1, bag: this._sourceBag === 'overflow' ? 'overflow' : 'hotbar' });
    }

    _depositQty1FromHotbar(key, hotbarIndex) {
        if (!this.campfire) return;
        if (key === 'cook' && !this._cookSlotOpen()) return;

        const inv = this._sourceInv();
        const stack = inv[hotbarIndex];
        if (!stack) return;
        if (key === 'cook' && !this._cookAccepts(stack)) return;

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
        this._notifyCampfire("inv_to_slot", { inv: hotbarIndex, slot: key, amount: 1, bag: this._sourceBag === 'overflow' ? 'overflow' : 'hotbar' });
    }

    /** Insert a full stack object into inventory (preserves custom meal fields). */
    _tryInsertStack(stack) {
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const forInv = stack.spoilLeft != null ? stack : (() => {
            const c = cloneItemStack(stack) || stack;
            migrateToSpoilLeft(c, now);
            return c;
        })();
        if (this.scene.player.insertOwnedStack?.(forInv)) return true;
        // Fall back to gainItem (loses custom fields for non-meals; meals maxStack 1)
        if (forInv.customName || forInv.food) return false;
        const meta = this.scene.getItem(forInv.id);
        const left = this.scene.player.gainItem(
            meta, forInv.quantity, spoilLeftForCharacter(forInv, now),
            this._stackMoveExtras(forInv)
        );
        return left < forInv.quantity && left === 0;
    }

    _depositFuelIntoSlot(idx, hotbarIndex, pointer = null) {
        const inv = this._sourceInv();
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
            this.campfire.setFuel(idx, this._fuelStackFrom(stack, moved, now));
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
            mergeDryInto(dest, dest.quantity, moved, stack.dryProgress);
            mergeSoakInto(dest, dest.quantity, moved, stack.soakProgress);
            mergeTempInto(dest, dest.quantity, moved, stack.temp);
            dest.quantity += moved;
            stack.quantity -= moved;
            if (stack.quantity <= 0) inv[hotbarIndex] = null;
            this.campfire.setFuel(idx, dest);
        } else {
            // Different item: only full-stack swap
            if (want < stack.quantity) return;
            moved = stack.quantity;
            this.campfire.setFuel(idx, this._fuelStackFrom(stack, stack.quantity, now));
            inv[hotbarIndex] = this._toInvStack(dest);
        }

        this.scene.hotbar.dirty = true;
        this.refresh();
        this.scene.refreshTooltip();
        this._notifyCampfire("inv_to_slot", {
            inv: hotbarIndex,
            slot: `fuel:${idx}`,
            amount: moved,
            bag: this._sourceBag === 'overflow' ? 'overflow' : 'hotbar'
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
                meta, amount, spoilLeftForCharacter(stack, now),
                this._stackMoveExtras(stack)
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

    _giveSlotToParty(fromKey, target) {
        if (fromKey === "catalyst" && this._catalystLocked()) return false;
        const stack = this._stackFor(fromKey);
        if (!stack || !target) return false;
        const from = this.scene.player;
        if (!this.scene.partySys?.canGiveTo(from, target, stack)) return false;
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        const amount = fromKey.startsWith("fuel:") ? qty : 1;
        if (this._isDedicated()) {
            if (amount >= qty) this._setStack(fromKey, null);
            else {
                stack.quantity -= amount;
                this._setStack(fromKey, stack);
            }
            this._notifyCampfire("slot_to_inv", {
                slot: fromKey,
                inv: -1,
                amount,
                toPawnId: target.pawnId
            });
            this.layout();
            this.scene.refreshTooltip();
            return true;
        }
        const piece = this._cloneStack(stack);
        piece.quantity = amount;
        const invStack = this._toInvStack(piece);
        if (!this.scene.partySys.deliverGive(target, invStack)) {
            this.scene.combatLog?.push(`${target.displayName()} cannot carry that`);
            return false;
        }
        if (amount >= qty) this._setStack(fromKey, null);
        else {
            stack.quantity -= amount;
            this._setStack(fromKey, stack);
        }
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
        if (fromKey === 'catalyst' && this._catalystLocked()) return;
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
                mergeDryInto(dest, dest.quantity, moved, stack.dryProgress);
            mergeSoakInto(dest, dest.quantity, moved, stack.soakProgress);
                mergeTempInto(dest, dest.quantity, moved, stack.temp);
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
            amount: moved,
            bag: toBag
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
            if (!this._cookAccepts(a)) return;
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
                mergeDryInto(b, b.quantity, a.quantity, a.dryProgress);
                mergeSoakInto(b, b.quantity, a.quantity, a.soakProgress);
                mergeTempInto(b, b.quantity, a.quantity, a.temp);
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
        if (this.getSlotAt(pointer.x, pointer.y) != null) return true;
        if (!this.destroyBtn?.visible) return false;
        return this.pointerOnDestroy(pointer);
    }
}
