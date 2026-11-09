/**
 * SceneMain prototype methods (craft).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainCraft = {

    formatItemTooltip(item, quantity, spoilAt, stack = null, opts = null) {
        if (!item) {
            const label = stack?.customName || stack?.id || "Unknown";
            return quantity > 1 ? `${label} x${quantity}` : String(label);
        }
        const lines = [];
        const liveName = (stack && typeof Stone !== "undefined" && Stone.displayName)
            ? Stone.displayName(stack, (id) => this.getItem?.(id) || (item && item.id === id ? item : null))
            : null;
        const displayName = liveName || stack?.customName || item.name || item.id || "Unknown";
        let name = quantity > 1 ? `${displayName} x${quantity}` : displayName;
        const food = stack?.food || item.food;
        let namePct = null;
        if (typeof Durability !== "undefined" && stack) {
            const max = Durability.maxDurability(stack, item);
            if (max > 0) {
                const pct = Math.round(Durability.durabilityFraction(stack, item) * 100);
                if (pct < 100) namePct = pct;
            }
        }
        if (namePct == null && food) {
            const kc = Number(food.kc ?? 0);
            const full = Number(food.kcFull ?? kc);
            if (kc > 0 && full > 0) {
                const pct = Math.round((kc / full) * 100);
                if (pct < 100) namePct = pct;
            }
        }
        if (namePct != null) name = `${name} (${namePct}%)`;
        lines.push(name);

        // Weight (stack.weight for dynamic meals; knapped tools use item def)
        const knapTool = !!(stack?.toolClass || stack?.knapMaterial);
        const weight = knapTool
            ? (item.weight ?? 0)
            : (stack?.weight != null ? stack.weight : item.weight);
        if (weight > 0) {
            lines.push(`Weight: ${weight} kg`);
        }

        if (typeof Stone !== "undefined" && Stone.statLinesFor) {
            for (const line of Stone.statLinesFor(stack, item, (id) => this.getItem?.(id))) {
                lines.push(line);
            }
        }

        if (typeof Stats !== "undefined") {
            for (const line of Stats.tooltipLines(item, stack)) lines.push(line);
        }

        if (item.bandage) {
            const base = Math.round((Number(item.bandage.tendQuality) || 0) * 100);
            lines.push(`Tend quality: ${base}%`);
        }

        // Food (stack.food overrides meta for dynamic meals). 0 kcal = spoils only, not edible.
        if (food) {
            const kc = Math.round(Number(food.kc ?? 0));
            if (kc > 0) {
                lines.push(`Food: ${kc} kcal`);
                const satR = Number(food.satietyRatio ?? item.food?.satietyRatio);
                if (Number.isFinite(satR) && satR >= 0) {
                    const shown = Number.isInteger(satR)
                        ? String(satR)
                        : String(Math.round(satR * 100) / 100);
                    lines.push(`Satiety: ×${shown}`);
                }
            }

            if (opts?.spoilPaused) {
                lines.push("Spoils: paused");
            } else {
                const now = this.worldMinuteIndex?.() ?? null;
                let mins = null;
                if (stack?.spoilLeft != null) {
                    mins = Math.max(0, Math.round(stack.spoilLeft));
                } else if (stack?.spoilAt != null && now != null) {
                    mins = remainingSpoilMinutes(stack.spoilAt, now);
                } else if (spoilAt != null && now != null) {
                    // 3rd arg may be spoilLeft (remaining) or spoilAt (absolute)
                    const asRemaining = Math.round(spoilAt);
                    const asAbsolute = remainingSpoilMinutes(spoilAt, now);
                    // Absolute timestamps are worldMinuteIndex-scale; remaining timers are durations.
                    mins = (spoilAt >= now) ? asAbsolute : Math.max(0, asRemaining);
                } else if (food.spoil != null) {
                    mins = Math.round(food.spoil * 60);
                } else {
                    mins = spoilDurationMinutes(item);
                }
                if (mins != null) {
                    if (opts?.spoilScale != null && typeof spoilMinutesAtScale === "function") {
                        mins = spoilMinutesAtScale(mins, opts.spoilScale, now);
                    }
                    lines.push(`Spoils in: ${formatHours(Math.floor(mins / 60))}`);
                }
            }
        }

        const fuelKj = Number(item.fuel?.kj ?? 0);
        if (fuelKj > 0) {
            const fuelTemp = Number(item.fuel?.temp);
            lines.push(fuelTemp > 0
                ? `Fuel: ${fuelKj} kj, ${typeof Fire !== "undefined" ? Fire.formatTemp(fuelTemp) : `${Math.round(fuelTemp)}°C`}`
                : `Fuel: ${fuelKj} kj`);
        }

        if (quantity > 1) {
            const totWeight = Math.round(weight * quantity * 100) / 100;
            const parts = [];
            if (weight > 0) parts.push(`${totWeight} kg`);
            const foodKc = food ? Math.round(Number(food.kc ?? 0)) : 0;
            if (foodKc > 0) parts.push(`${foodKc * quantity} kcal`);
            if (fuelKj > 0) parts.push(`${Math.round(fuelKj * quantity * 100) / 100} kj`);
            if (parts.length) lines.push(`Stack total: ${parts.join(", ")}`);
        }

        const knapWeapon = (stack?.toolClass && typeof Knapping !== "undefined")
            ? Knapping.weaponMetaFromStack(item, stack)
            : null;
        let weapon = knapWeapon?.weapon || item.weapon;
        let weaponMetaForDps = knapWeapon || item;
        if (
            !knapWeapon
            && item.weapon
            && typeof weaponMetaWithKnapQuality === "function"
            && (stack?.knapQuality || stack?.id === "stone_spear" || stack?.id === "flint_spear")
        ) {
            weaponMetaForDps = weaponMetaWithKnapQuality(item, stack);
            weapon = weaponMetaForDps.weapon;
        }
        if (weapon) {
            const bowStack = { ...(stack || {}), id: stack?.id || item.id };
            const avg = typeof BodyCombat !== "undefined"
                ? BodyCombat.meleeWeaponAverageDps?.(weapon)
                : null;
            if (typeof Ranged !== "undefined" && Ranged.isBowStack?.(bowStack)) {
                lines.push(`Damage: ${Ranged.shotDamage(bowStack, null)}`);
            } else if (avg && avg.dps > 0) {
                const dps = avg.dps.toFixed(1);
                const dtype = avg.type || weapon.type || "melee";
                lines.push(`DPS: ${dps} ${dtype}`);
            } else {
                const dmg = Number(stack?.knapDamage ?? weapon.damage ?? 0);
                if (dmg > 0) {
                    const type = weapon.type ? ` ${weapon.type}` : "";
                    lines.push(`Damage: ${dmg}${type}`);
                } else if (weapon.type) {
                    lines.push(`Type: ${weapon.type}`);
                }
            }
        }
        const chopLine = typeof Chop !== "undefined" ? Chop.chopPercentLine(stack) : null;
        if (chopLine) lines.push(chopLine);
        const digLine = typeof Dig !== "undefined"
            ? Dig.digPercentLine(stack, (id) => this.getItem?.(id))
            : null;
        if (digLine) lines.push(digLine);
        // Skip legacy knap "Damage:" lines — weapons show DPS from verbs (like spears)
        let knapFlavor = stack?.tooltipExtra;
        if (
            !knapFlavor
            && stack?.toolClass === "knife"
        ) {
            knapFlavor = "'Mr. Stabby'";
        } else if (!knapFlavor && stack?.toolClass === "chopper") {
            knapFlavor = "Slow but heavy";
        }
        if (knapFlavor === "Mr. Stabby") knapFlavor = "'Mr. Stabby'";
        if (
            knapFlavor
            && knapFlavor !== "Needs a shaft"
            && !/^Damage:/i.test(knapFlavor)
        ) {
            lines.push(knapFlavor);
        }
        if (stack?.toolClass === "knife" || stack?.toolClass === "cleaver") {
            lines.push("Click a corpse to skin it for more resources");
        }
        if (stack?.toolClass === "scraper") {
            lines.push("Click a drying rack to scrape a hide");
        }
        if (stack?.toolClass === "awl") {
            lines.push("Use with Skinworking Bench");
        }
        if (stack?.toolClass === "chopper" || (typeof Chop !== "undefined" && Chop.chopFraction(stack) > 0)) {
            lines.push("Attack trees to chop them down");
        }

        // Slot / pack bonuses before flavor text so packs read Fuel → Slot → how-to.
        if (item.equip) {
            lines.push(`Slot: ${item.equip.slot}`);
            if (item.equip.effects) {
                const addSlot = item.equip.effects.addSlot;
                if (addSlot) {
                    const counts = {};
                    for (const s of addSlot) counts[s] = (counts[s] || 0) + 1;
                    for (const [s, n] of Object.entries(counts)) {
                        const label = s === "hotbar" ? "hotbar" : s === "overflow" ? "pack" : s;
                        lines.push(`+ ${n} ${label} slot${n > 1 ? "s" : ""}`);
                    }
                }
                const strength = item.equip.effects.strength;
                if (strength) {
                    lines.push(`+ ${strength} kg carry`);
                }
                const speed = item.equip.effects.speed;
                if (speed) {
                    lines.push(`+ ${Math.round(speed * 100)}% speed`);
                }
            }
            if (typeof Apparel !== "undefined") {
                for (const line of Apparel.armorTooltipLines(item)) lines.push(line);
            }
        }

        const placeId = item.place?.thing;
        if (placeId && typeof Needs !== "undefined" && Needs.effectivenessLine) {
            const placed = typeof this.getThing === "function" ? this.getThing(placeId) : null;
            const restLine = Needs.effectivenessLine(placed);
            if (restLine) lines.push(restLine);
        }

        // Static tooltips only when not a custom-named meal
        if (!stack?.customName && Array.isArray(item.tooltip)) {
            const holder = this._playerResearchHolder?.() || null;
            const tips = (typeof Research !== "undefined" && Research.tooltipLines)
                ? Research.tooltipLines(item, holder)
                : item.tooltip;
            const dryPct = (typeof Hide !== "undefined" && Hide.isFleshedHide(item))
                ? Hide.dryPercent(stack)
                : null;
            const soakPct = (typeof Hide !== "undefined" && Hide.isFleshedHide(item) && stack)
                ? Hide.soakPercent(stack, this.worldMinuteIndex?.() ?? null)
                : null;
            for (const line of tips) {
                if (dryPct != null && dryPct > 0 && /dry/i.test(String(line))) {
                    lines.push(`${line} (${dryPct}% dry)`);
                } else if (soakPct != null && soakPct > 0 && /water/i.test(String(line))) {
                    lines.push(`${line} (${soakPct}% soaked)`);
                } else {
                    lines.push(line);
                }
            }
        }

        if (typeof Fire !== "undefined" && Fire.stackShowsTemp(stack)) {
            lines.push(Fire.formatTemp(stack.temp));
        }

        if (stack?.toolClass === "hand_axe") lines.push("Increases log yield");
        if (stack?.toolClass === "cleaver") lines.push("Increases meat yield");

        return lines.join("\n");
    },

    createCraftMenu() {
        this.craftMenuVisible = false;
        this._craftStationThing = null;
        this._craftFromStation = false;
        this._craftPage = 0;
        this._craftQueue = [];
        this._craftQueueLive = false;
        this.craftContainer = this.add.container(0, 0).setVisible(false);
        this.uiLayer.add(this.craftContainer);
        this._data = [];
        this._buildCraftTakeButton();
        this.input.on("wheel", (pointer, _over, deltaX, deltaY) => {
            if (!this.craftMenuVisible) return;
            const p = pointer || this.input.activePointer;
            if (!this._pointerOverCraftMenu?.(p)) return;
            const delta = deltaY || deltaX;
            if (delta < 0) this._shiftCraftPage(-1);
            else if (delta > 0) this._shiftCraftPage(1);
        });
    },

    positionCraftMenu() {
        if (!this.craftContainer || !this.craft) return;
        this._hostCraftMenu();
        const left = this.craft.x + this.craft.displayWidth / 2;
        const height = this._craftMenuData?.gridH || 0;
        const top = Phaser.Math.Clamp((this.scale.height - height) / 2, 0, this.scale.height - height);
        this.craftContainer.setPosition(Math.round(left), Math.round(top));
    },

    /** Recipe list is always the C-key screen HUD, even when filtered to a station. */
    _hostCraftMenu() {
        const c = this.craftContainer;
        if (!c) return;
        if (this.worldHudLayer && (c.parentContainer === this.worldHudLayer || c.displayList === this.worldHudLayer)) {
            this.worldHudLayer.remove(c);
        }
        if (this.uiLayer && c.displayList !== this.uiLayer) {
            this.uiLayer.add(c);
        }
        if (this._uiCam) c.cameraFilter = (c.cameraFilter || 0) & ~this._uiCam.id;
        this._placeCraftAboveInventory();
    },

    /**
     * uiLayer draws in list order (depth is ignored). Hotbar and pack slots
     * added after the recipe list would cover it. Keep those objects just
     * under the craft container so later UI (buttons, panels) stays on top.
     */
    _inventoryUiObjects() {
        const hotbar = this.hotbar;
        if (!hotbar) return [];
        const out = [];
        const push = (obj) => {
            if (!obj) return;
            if (Array.isArray(obj)) {
                for (const inner of obj) push(inner);
                return;
            }
            out.push(obj);
        };
        push(hotbar.slots);
        push(hotbar.icons);
        push(hotbar.fillIcons);
        push(hotbar.quantity);
        push(hotbar.bars);
        push(hotbar.ingredientBadges);
        push(hotbar.overflowSlots);
        push(hotbar.overflowIcons);
        push(hotbar.overflowFillIcons);
        push(hotbar.overflowQuantity);
        push(hotbar.overflowBars);
        push(hotbar.overflowIngredientBadges);
        return out;
    },

    _placeCraftAboveInventory() {
        const list = this.uiLayer?.list;
        const craft = this.craftContainer;
        if (!Array.isArray(list) || !craft || craft.displayList !== this.uiLayer) return;
        const ci = list.indexOf(craft);
        if (ci < 0) return;
        const above = [];
        for (const obj of this._inventoryUiObjects()) {
            const oi = list.indexOf(obj);
            if (oi > ci) above.push({ obj, oi });
        }
        if (!above.length) return;
        above.sort((a, b) => a.oi - b.oi);
        for (let i = above.length - 1; i >= 0; i--) list.splice(above[i].oi, 1);
        for (let i = 0; i < above.length; i++) list.splice(ci + i, 0, above[i].obj);
    },

    _craftMenuLayoutSig() {
        const s = this.uiScale || 1;
        const stationId = this._craftStationThing?.meta?.id || "";
        const nearby = stationId ? "" : (this.nearbyCraftStationIds() || []).join(",");
        const page = this._craftPage || 0;
        const here = this.settlementSys?.here?.(this.player) ? "1" : "0";
        return `${stationId}|${nearby}|${page}|${s}|${here}`;
    },

    _craftHoverRecipeId() {
        const target = this._tooltipTarget;
        if (!target || !Array.isArray(this._data)) return null;
        const row = this._data.find((d) => d.slot === target);
        return row?.recipe?.id || null;
    },

    _restoreCraftTooltip(recipeId) {
        if (!recipeId || !this.craftMenuVisible) return;
        const row = this._data?.find((d) => d.recipe?.id === recipeId);
        const slot = row?.slot;
        const pointer = this.input?.activePointer;
        if (!slot?.active || !row.tt || !pointer) return;
        const hit = this._craftSlotAtPointer?.(pointer);
        if (hit !== slot) return;
        this.showTooltip(row.tt, pointer.x, pointer.y, slot);
        this._hoverTarget = slot;
    },

    refreshCraftMenu() {
        if (!this.craftContainer) return;
        const sig = this._craftMenuLayoutSig();
        if (sig === this._craftMenuSig && this.craftContainer.list?.length) {
            this.positionCraftMenu();
            this._layoutCraftTakeButton();
            this._layoutCraftSettle();
            this._layoutCraftQueue();
            return;
        }
        const keepRecipeId = this._craftHoverRecipeId();
        this._craftMenuRefreshing = true;
        if (this._hoverTarget?.parentContainer === this.craftContainer) this._hoverTarget = null;
        this._detachCraftQueueLayer();
        this.craftContainer.removeAll(true);
        this._data = [];
        this._craftMenuSig = sig;

        const s = this.uiScale || 1;
        const ui = s;
        const pad = Math.round(4 * ui);
        const slotImg = this.textures.get('slot').getSourceImage();
        const baseW = slotImg ? slotImg.width : 32;
        const baseH = slotImg ? slotImg.height : 32;
        const slotW = baseW * ui;
        const slotH = baseH * ui;

        const stationId = this._craftStationThing?.meta?.id || null;
        let recipes;
        if (stationId) {
            recipes = this.getKnownRecipes(stationId);
        } else {
            const nearbyIds = this.nearbyCraftStationIds();
            this._craftNearbySig = nearbyIds.join(",");
            recipes = this.getKnownRecipes(null);
            for (const id of nearbyIds) recipes = recipes.concat(this.getKnownRecipes(id));
            const spot = [];
            const rest = [];
            for (const recipe of recipes) {
                if (recipe?.id === "crafting_spot") spot.push(recipe);
                else rest.push(recipe);
            }
            recipes = spot.concat(rest);
        }
        const cols = 3;
        const maxRows = 4;
        const perPage = cols * maxRows;
        const pages = Math.max(1, Math.ceil(recipes.length / perPage));
        this._craftPage = Phaser.Math.Clamp(this._craftPage || 0, 0, pages - 1);
        const start = this._craftPage * perPage;
        const pageRecipes = recipes.slice(start, start + perPage);
        const rows = Math.max(1, Math.ceil(pageRecipes.length / cols) || 1);
        const gridW = cols * slotW + (cols - 1) * pad;
        const gridH = pageRecipes.length
            ? rows * slotH + (rows - 1) * pad
            : slotH;
        const pagerH = Math.round(28 * ui);
        const pagerGap = Math.round(6 * ui);
        const gridY = pagerH + pagerGap;
        this._craftMenuData = {
            cols, rows, gridW,
            gridH: gridY + gridH,
            queueTop: gridY,
            slotW, slotH, pad,
            pages
        };

        this._addCraftPager(gridW, pagerH, ui, this._craftPage, pages);

        for (let i = 0; i < pageRecipes.length; i++) {
            const recipe = pageRecipes[i];
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = col * (slotW + pad);
            const y = gridY + row * (slotH + pad);

            // Slot
            const slot = this.add.image(x, y, 'slot').setOrigin(0, 0).setScale(ui).setInteractive({ cursor: 'pointer' });
            this.craftContainer.add(slot);

            // Icon
            const iconKey = this._craftRecipeIconKey(recipe);
            const icon = this.add.image(x + slotW / 2, y + slotH / 2, iconKey).setOrigin(0.5, 0.5).setScale(3.0 * ui);
            this.craftContainer.add(icon);

            // Quantity
            const quantity = crispUiText(this.add.text(x + slotW - 4 * ui, y + slotH - 4 * ui, recipe.quantity > 1 ? String(recipe.quantity) : '', {
                fontSize: `${pixelUiFontSize(16, 1)}px`, fontFamily: PIXEL_UI_FONT, stroke: '#000', strokeThickness: 2, align: 'right'
            }).setOrigin(1, 1).setVisible(recipe.quantity > 1));
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(quantity, 16, s);
            this.craftContainer.add(quantity);

            // Tooltip. The preview stack is live, so the name follows the first stuff stack.
            const tt = () => this._craftRecipeTooltip(recipe);

            slot.on('pointerover', (p) => this.showTooltip(tt, p.x, p.y, slot));
            slot.on('pointerout', () => {
                if (this._craftMenuRefreshing) return;
                if (this._tooltipTarget === slot) this.hideTooltip();
            });

            const homes = [
                [slot, x],
                [icon, x + slotW / 2],
                [quantity, x + slotW - 4 * ui]
            ];
            const shakeSlot = () => {
                const shake = 3 * ui;
                for (const [obj] of homes) this.tweens.killTweensOf(obj);
                if (slot._shakeTween) slot._shakeTween.stop();
                slot._shakeTween = this.tweens.addCounter({
                    from: 0,
                    to: 1,
                    duration: 160,
                    onUpdate: (tw) => {
                        const offset = Math.sin(tw.getValue() * Math.PI * 4) * shake;
                        for (const [obj, home] of homes) obj.x = home + offset;
                    },
                    onComplete: () => {
                        for (const [obj, home] of homes) obj.x = home;
                        slot._shakeTween = null;
                    }
                });
            };

            // Craft. Right-click makes 5 output items; Ctrl makes 10; Shift makes as many as ingredients allow.
            slot.on('pointerdown', (pointer) => {
                if (recipe.id === "crafting_spot") {
                    if (!this.canCraft(recipe) || !this.settlementSys?.here?.(this.player)) {
                        shakeSlot();
                        return;
                    }
                    this.closeCraftMenu?.();
                    this.beginCraftingSpotPlace?.();
                    return;
                }
                if (!this.canCraft(recipe)) {
                    shakeSlot();
                    return;
                }
                const count = Math.max(1, this._craftClickCount(recipe, pointer));
                if (this.doCraft(recipe, count) === false) {
                    shakeSlot();
                    return;
                }
                this.hotbar.dirty = true;
                this.refreshTooltip();
                this.refreshCraftMenu();
            });

            this._data.push({ slot, icon, qty: quantity, recipe, tt });
        }

        this._attachCraftQueueLayer();
        this.positionCraftMenu();
        this._layoutCraftTakeButton();
        this._layoutCraftSettle();
        this._layoutCraftQueue();
        this._craftMenuRefreshing = false;
        this._restoreCraftTooltip(keepRecipeId);
    },

    _worldUiLive(ui) {
        const btn = ui?.btn;
        const rect = ui?.rect;
        return !!(btn?.active && btn.scene && rect?.active && rect.scene && rect.geom);
    },

    _discardWorldUi(key) {
        const ui = this[key];
        if (!ui) return;
        try { ui.btn?.destroy?.(); } catch (_) {}
        this[key] = null;
    },

    _placeCraftWorldBtn(btn) {
        if (!btn) return;
        if (typeof this._placeWorldHud === "function") this._placeWorldHud(btn, 250);
        else {
            btn.setDepth(250);
            this._uiCam?.ignore(btn);
        }
    },

    _layoutCraftSettle() {
        const station = this._craftStationThing;
        const sys = this.settlementSys;
        const s = this.uiScale || 1;
        const zoom = this.worldZoom || 1;
        const ws = s / zoom;
        const bw = this._craftTakeBw || 78 * ws;
        const bh = this._craftTakeBh || 28 * ws;
        const gap = 8 * ws;
        if (this._craftSettleUi && (this._craftSettleUi._screenUi || !this._worldUiLive(this._craftSettleUi))) {
            this._discardWorldUi("_craftSettleUi");
        }
        const show = !!(this.craftMenuVisible && station && sys);
        if (!show) {
            this._craftSettleUi?.btn?.setVisible?.(false);
            this._craftSettleUi?.rect?.disableInteractive?.();
            this._layoutCraftBills(null, 0, 0, bw, bh, gap);
            this._layoutCraftRotate();
            return;
        }
        if (!this._craftSettleUi) {
            this._craftSettleUi = sys.makeStationButton(() => {
                if (this._craftStationThing) sys.toggleStation(this._craftStationThing);
                this._layoutCraftSettle();
            });
            this._placeCraftWorldBtn(this._craftSettleUi.btn);
        }
        const ui = this._craftSettleUi;
        if (!ui) return;
        const x = station.x || 0;
        const y = worldUiButtonY(this, station.y, bh);
        ui.setSize(bh);
        sys.syncStationButton(ui, station);
        sys.placeAddActionRow(ui, this._craftTakeBtn, {
            x, y, gap, addW: bh, actionW: bw,
            addOn: !!ui.btn.visible,
            actionOn: !!this._craftTakeBtn?.visible
        });
        this._layoutCraftBills(station, x, y, bw, bh, gap);
        this._layoutCraftRotate();
    },

    _isSkinworkingBench(station) {
        const id = station?.meta?.id || station?.entry?.id;
        return id === "skinworking_bench";
    },

    _layoutCraftRotate() {
        const station = this._craftStationThing;
        const sys = this.settlementSys;
        const show = !!(this.craftMenuVisible && station?.active && sys
            && this._isSkinworkingBench(station));
        if (!show) {
            this._craftRotateUi?.btn?.setVisible?.(false);
            this._craftRotateUi?.rect?.disableInteractive?.();
            return;
        }
        if (this._craftRotateUi && !this._worldUiLive(this._craftRotateUi)) {
            this._discardWorldUi("_craftRotateUi");
        }
        if (!this._craftRotateUi) {
            this._craftRotateUi = sys.makeRotateButton((ccw) => {
                if (this._craftStationThing) this.tryRotateStation?.(this._craftStationThing, { ccw });
            });
            this._placeCraftWorldBtn(this._craftRotateUi.btn);
        }
        const ui = this._craftRotateUi;
        if (!ui) return;
        const s = this.uiScale || 1;
        const zoom = this.worldZoom || 1;
        const ws = s / zoom;
        const bw = this._craftTakeBw || 78 * ws;
        const bh = this._craftTakeBh || 28 * ws;
        const gap = 8 * ws;
        sys.placeRotateBeside(ui, {
            x: station.x || 0,
            y: worldUiButtonY(this, station.y, bh),
            gap,
            addW: bh,
            actionW: bw,
            side: bh,
            addOn: !!this._craftSettleUi?.btn?.visible,
            actionOn: !!this._craftTakeBtn?.visible,
            addBtn: this._craftSettleUi?.btn,
            actionBtn: this._craftTakeBtn,
            visible: true
        });
    },

    _layoutCraftBills(station, x, y, bw, bh, gap) {
        const sys = this.settlementSys;
        if (this._craftBillUi && !this._worldUiLive(this._craftBillUi)) {
            this._discardWorldUi("_craftBillUi");
        }
        const show = !!(this.craftMenuVisible && station && sys?.isAdded(station));
        if (!show) {
            this._craftBillUi?.btn?.setVisible?.(false);
            this._craftBillUi?.rect?.disableInteractive?.();
            return;
        }
        if (!this._craftBillUi) {
            this._craftBillUi = sys.makeWorldButton("Bills", () => {
                if (this._craftStationThing) sys.openBills?.(this._craftStationThing);
            });
            this._placeCraftWorldBtn(this._craftBillUi.btn);
        }
        const bill = this._craftBillUi;
        if (!bill) return;
        bill.btn.setVisible(true);
        bill.rect.setSize(bw, bh);
        bill.rect.setInteractive({ useHandCursor: true });
        if (bill.rect.input?.hitArea?.setTo) bill.rect.input.hitArea.setTo(0, 0, bw, bh);
        else if (bill.rect.input?.hitArea?.setSize) bill.rect.input.hitArea.setSize(bw, bh);
        if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(bill.text, 14, this);
        bill.paint?.();
        bill.btn.setPosition(x, y + bh + gap);
    },

    _shiftCraftPage(delta) {
        const pages = Math.max(1, this._craftMenuData?.pages || 1);
        const next = Phaser.Math.Clamp((this._craftPage || 0) + delta, 0, pages - 1);
        if (next === (this._craftPage || 0)) return;
        this.hideTooltip?.();
        this._craftPage = next;
        this.refreshCraftMenu();
    },

    _addCraftPager(gridW, pagerH, s, page, pages) {
        const y = pagerH / 2;
        const bw = Math.round(28 * s);
        const gap = Math.round(52 * s);
        this._addCraftNavArrow(
            gridW / 2 - gap, y, bw, pagerH, "<",
            page > 0, () => this._shiftCraftPage(-1), s
        );
        this._addCraftNavArrow(
            gridW / 2 + gap, y, bw, pagerH, ">",
            page < pages - 1, () => this._shiftCraftPage(1), s
        );
        const stroke = typeof pixelUiStroke === "function" ? pixelUiStroke(this.uiScale || 1) : Math.max(2, Math.round(2 * s));
        const label = this.add.text(gridW / 2, y, `${page + 1} / ${pages}`, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(16, 1)}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: stroke
        }).setOrigin(0.5);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(label, 16, this.uiScale || 1);
        else label.setFontSize(`${pixelUiFontSize(16, this.uiScale || 1)}px`);
        label.setStroke("#000000", stroke);
        if (typeof crispUiText === "function") crispUiText(label);
        this.craftContainer.add(label);
    },

    _addCraftNavArrow(x, y, bw, bh, label, enabled, onClick, s) {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const strokeOf = () => (typeof pixelUiStroke === "function" ? pixelUiStroke(this.uiScale || 1) : 2);
        const stroke = strokeOf();
        const rect = this.add.rectangle(x, y, bw, bh, BG, 1)
            .setStrokeStyle(stroke, OUTLINE);
        const text = crispUiText(this.add.text(x, y, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(16, 1)}px`,
            color: "#d4c4a8"
        }).setOrigin(0.5));
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(text, 16, this.uiScale || 1);
        this.craftContainer.add(rect);
        this.craftContainer.add(text);
        if (!enabled) {
            text.setColor("#6a5a4a");
            return;
        }
        rect.setInteractive({ useHandCursor: true });
        let hovering = false;
        let pressing = false;
        const paint = () => {
            const sw = strokeOf();
            if (pressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(sw, OUTLINE_PRESS);
            } else if (hovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(sw, OUTLINE_HOVER);
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(sw, OUTLINE);
            }
        };
        rect.on("pointerover", () => { hovering = true; paint(); });
        rect.on("pointerout", () => { hovering = false; pressing = false; paint(); });
        rect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown()) return;
            pressing = true;
            paint();
        });
        rect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = pressing;
            pressing = false;
            paint();
            if (was && hovering) onClick();
        });
    },

    _craftRecipeIconKey(recipe, stack) {
        const id = recipe?.id;
        // A queued craft passes the stuff it already paid for. The recipe grid
        // omits that and follows whatever pile is still in the bags.
        const preview = arguments.length > 1 ? stack : this._craftPreviewStack(recipe);
        if (id === "arrow" && typeof ensureArrowTexture === "function") {
            const mat = preview?.knapMaterial;
            const hasRock = mat === "flint" || mat === "pebble";
            // No blade yet: diorite tip only. The name stays Stone Arrow.
            const plain = (typeof Stone !== "undefined" && Stone.iconStone)
                ? Stone.iconStone("arrow")
                : "diorite";
            const key = ensureArrowTexture(
                this,
                hasRock ? mat : plain,
                hasRock ? preview?.stone : plain
            );
            if (key && this.textures.exists(key)) return key;
        }
        if ((id === "stone_spear" || id === "flint_spear") && typeof ensureSpearTexture === "function") {
            const mat = preview?.knapMaterial;
            const hasRock = mat === "flint" || mat === "pebble";
            // No rock yet: andesite gray only. Name and stats stay Stone Spear.
            const key = ensureSpearTexture(
                this,
                hasRock ? mat : "andesite",
                hasRock ? preview?.stone : "andesite"
            );
            if (key && this.textures.exists(key)) return key;
        }
        if (id === "grindstone" && typeof ensureStoneTexture === "function") {
            // No pebble yet: andesite gray. The name stays Grindstone.
            const stone = preview?.stone || "andesite";
            const key = ensureStoneTexture(this, "grindstone", 1, stone);
            if (key && this.textures.exists(key)) return key;
        }
        if (id === "painting_circle" && typeof ensurePaintingCircleTexture === "function") {
            // No pebble yet: andesite. The name stays Painting Circle.
            const stone = preview?.stone || "andesite";
            const key = ensurePaintingCircleTexture(this, stone);
            if (key && this.textures.exists(key)) return key;
        }
        const meta = this.getItem(recipe.id);
        if (typeof Place !== "undefined" && Place.itemIconKey) {
            const key = Place.itemIconKey(meta, (id) => this.getThing(id), (k) => this.textures.exists(k));
            if (key && this.textures.exists(key)) return key;
        }
        if (recipe.key && this.textures.exists(recipe.key)) return recipe.key;
        if (this.textures.exists("null")) return "null";
        return "slot";
    },

    /** Hotbar, then the pack, then the open basket. Same order the craft consumes. */
    _craftStuffBags(pawn) {
        const who = pawn || this.player;
        const store = this._openCraftStorage(who);
        return [who?.inventory, who?.overflow, store?.entry?.slots];
    },

    /**
     * Result this craft would produce from the first stuff stack.
     * No match leaves the plain name (Stone Spear, Grindstone) and an andesite icon.
     */
    _craftPreviewStack(recipe, pawn) {
        if (typeof Stone === "undefined" || !Stone.craftPreviewStack) return null;
        return Stone.craftPreviewStack(recipe, this._craftStuffBags(pawn));
    },

    /**
     * Spear tip this craft would consume: leftmost hotbar match, then the pack, then the open basket.
     * No match leaves the recipe icon as an andesite-colored tip named Stone Spear.
     */
    _craftPredictedTip(recipe, pawn) {
        if (recipe?.id !== "stone_spear" && recipe?.id !== "flint_spear" && recipe?.id !== "arrow") return null;
        if (typeof Stone === "undefined" || !Stone.firstStuffStack) return null;
        return Stone.firstStuffStack(recipe, this._craftStuffBags(pawn));
    },

    /**
     * First pebble this craft would consume: leftmost hotbar match, then the pack, then the open basket.
     * A missing pebble stays andesite. The name stays Grindstone until a pebble is in reach.
     */
    _craftPredictedPebble(recipe, pawn) {
        if (recipe?.id !== "grindstone" && recipe?.id !== "painting_circle") return null;
        if (typeof Stone === "undefined" || !Stone.firstStuffStack) return null;
        return Stone.firstStuffStack(recipe, this._craftStuffBags(pawn));
    },

    /**
     * Recipe icons are built once. Swap the texture when the first stuff stack changes
     * so a drop, pickup, or hotbar move updates the color along with the name.
     */
    _syncCraftRecipeIcons() {
        if (this._craftMenuRefreshing || !this.craftMenuVisible || !Array.isArray(this._data)) return;
        for (let i = 0; i < this._data.length; i++) {
            const row = this._data[i];
            const icon = row?.icon;
            if (!icon?.active || !row.recipe) continue;
            const key = this._craftRecipeIconKey(row.recipe);
            if (!key || icon.texture?.key === key || !this.textures?.exists?.(key)) continue;
            icon.setTexture(key);
        }
        const views = this._craftQueueViews || [];
        for (let i = 0; i < views.length; i++) {
            const view = views[i];
            if (!view?.slot?.visible) continue;
            this._setCraftQueueIcon(view);
        }
    },

    _buildCraftTakeButton() {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;

        this._craftTakeRect = this.add.rectangle(0, 0, 78, 28, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });
        this._craftTakeText = this.add.text(0, 0, "Take", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        this._craftTakeBtn = this.add.container(0, 0, [this._craftTakeRect, this._craftTakeText])
            .setVisible(false);
        this._placeCraftWorldBtn(this._craftTakeBtn);

        this._craftTakeHovering = false;
        this._craftTakePressing = false;
        this._craftTakeBw = 78;
        this._craftTakeBh = 28;
        this._paintCraftTake = () => {
            const strokeW = typeof pixelUiWorldStroke === "function"
                ? pixelUiWorldStroke(this)
                : 2 / (this.worldZoom || 1);
            const rect = this._craftTakeRect;
            const text = this._craftTakeText;
            if (!rect?.active || !rect.geom) return;
            if (this._craftTakePressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(strokeW, OUTLINE_PRESS);
            } else if (this._craftTakeHovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(strokeW, OUTLINE_HOVER);
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(strokeW, OUTLINE);
            }
            text?.setColor("#d4c4a8");
        };

        this._craftTakeRect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown()) return;
            this._craftTakePressing = true;
            this._paintCraftTake();
        });
        this._craftTakeRect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = this._craftTakePressing;
            this._craftTakePressing = false;
            this._syncCraftTakeHover();
            this._paintCraftTake();
            if (was && this._craftTakeHovering) this._tryPickupCraftStation();
        });
    },

    _layoutCraftTakeButton() {
        const btn = this._craftTakeBtn;
        const station = this._craftStationThing;
        if (!btn?.active || !this._craftTakeRect?.active || !this._craftTakeRect.geom) return;
        if (!this.craftMenuVisible || !station?.active) {
            this._craftTakeRect?.disableInteractive();
            btn.setVisible(false);
            this._craftTakeHovering = false;
            this._craftTakePressing = false;
            this._craftRotateUi?.btn?.setVisible?.(false);
            this._craftRotateUi?.rect?.disableInteractive?.();
            return;
        }
        const s = this.uiScale || 1;
        const zoom = this.worldZoom || 1;
        const ws = s / zoom;
        const bw = 78 * ws;
        const bh = 28 * ws;
        this._craftTakeBw = bw;
        this._craftTakeBh = bh;
        this._craftTakeRect.setSize(bw, bh);
        if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(this._craftTakeText, 16, this);
        else {
            this._craftTakeText.setResolution(zoom * (window.devicePixelRatio || 1));
            this._craftTakeText.setFontSize(`${pixelUiFontSize(16, s)}px`);
            this._craftTakeText.setScale(1 / zoom);
        }
        this._craftTakeRect.setInteractive({ useHandCursor: true });
        if (this._craftTakeRect.input?.hitArea?.setTo) {
            this._craftTakeRect.input.hitArea.setTo(0, 0, bw, bh);
        }
        btn.setPosition(station.x, worldUiButtonY(this, station.y, bh));
        btn.setVisible(true);
        this._paintCraftTake();
    },

    _pointerOnWorldBtn(ui, pointer) {
        if (!ui?.btn?.visible || !ui.rect || !pointer) return false;
        const pt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(ui.rect.getBounds(), pt.x, pt.y);
    },

    pointerOnCraftTake(pointer) {
        if (!this._craftTakeBtn?.visible || !this._craftTakeRect || !pointer) return false;
        const pt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(this._craftTakeRect.getBounds(), pt.x, pt.y);
    },

    pointerOnCraftSettle(pointer) {
        const ui = this._craftSettleUi;
        if (!ui?.btn?.visible || !ui.rect || !pointer) return false;
        const pt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(ui.rect.getBounds(), pt.x, pt.y);
    },

    pointerOnCraftBills(pointer) {
        const ui = this._craftBillUi;
        if (!ui?.btn?.visible || !ui.rect || !pointer) return false;
        const pt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(ui.rect.getBounds(), pt.x, pt.y);
    },

    pointerOnCraftRotate(pointer) {
        return this._pointerOnWorldBtn(this._craftRotateUi, pointer);
    },

    _syncCraftTakeHover() {
        const over = !!this.pointerOnCraftTake(this.input.activePointer);
        if (over !== this._craftTakeHovering) {
            this._craftTakeHovering = over;
            if (!over) this._craftTakePressing = false;
        }
        this._paintCraftTake?.();
    },

    _tryPickupCraftStation() {
        const station = this._craftStationThing;
        if (!station) return;
        this.tryPickupCraftStation(station);
    },

    _isRecipeMetaKey(k) {
        if (typeof Carry !== "undefined" && Carry.isRecipeMetaKey) return Carry.isRecipeMetaKey(k);
        return k === "QUANTITY" || k === "REQUIRE_THING" || k === "REQUIRE_STATION"
            || k === "CRAFT_SECONDS" || k === "REQUIRE_TOOL";
    },

    getKnownRecipes(stationId = null) {
        return this.items().filter((m) => {
            if (!m?.recipe) return false;
            const req = m.recipe.REQUIRE_STATION ? String(m.recipe.REQUIRE_STATION) : null;
            if (stationId) {
                if (req !== stationId) return false;
            } else if (req) return false;
            if (m.id === "crafting_spot" && !this.settlementSys?.here?.(this.player)) return false;
            if (typeof Research !== "undefined" && Research.recipeUnlocked) {
                const holder = this._playerResearchHolder?.() || null;
                if (!Research.recipeUnlocked(m.id, holder)) return false;
            }
            return true;
        }).map((meta) => {
            const r = meta.recipe, ingredients = [];
            let requireThing = null, requireStation = null, quantity = 1;
            let craftSeconds = null, requireTool = null;
            for (const [k, v] of Object.entries(r)) {
                if (k === "QUANTITY") quantity = +v || 1;
                else if (k === "REQUIRE_THING") requireThing = String(v);
                else if (k === "REQUIRE_STATION") requireStation = String(v);
                else if (k === "CRAFT_SECONDS") craftSeconds = Math.max(0, Number(v) || 0);
                else if (k === "REQUIRE_TOOL") {
                    requireTool = (typeof Carry !== "undefined" && Carry.parseRequireTool)
                        ? Carry.parseRequireTool(v)
                        : {
                            toolClass: v?.toolClass ? String(v.toolClass) : null,
                            wear: Math.max(0, Number(v?.wear) || 0)
                        };
                } else if (this._isRecipeMetaKey(k)) continue;
                else if (v && typeof v === "object") {
                    ingredients.push({
                        id: k,
                        qty: +v.qty || 1,
                        toolClass: v.toolClass || null,
                        hideStage: v.hideStage ? String(v.hideStage) : null
                    });
                } else {
                    ingredients.push({ id: k, qty: +v || 1, toolClass: null, hideStage: null });
                }
            }
            const iconKey = (typeof Place !== "undefined" && Place.itemIconKey)
                ? Place.itemIconKey(meta, (id) => this.getThing(id), (k) => this.textures.exists(k))
                : meta.key;
            return {
                id: meta.id,
                name: meta.name,
                key: iconKey || meta.key,
                ingredients,
                quantity,
                requireThing,
                requireStation,
                // No explicit time: half a second, and the click joins the queue.
                craftSeconds: craftSeconds == null ? 0.5 : craftSeconds,
                requireTool
            };
        });
    },

    /**
     * Crafted-item text, then icon rows: ingredients, a nearby thing, a station,
     * and a held tool. Several held tools list every picture; the tip cycles them.
     */
    _craftRecipeTooltip(recipe) {
        // An arrow's picture may be diorite, or the blade you would spend.
        // The words stay Stone Arrow and the item's own numbers, the same
        // way an unfilled Stone Spear does not turn into that rock.
        const stack = recipe?.id === "arrow" ? null : this._craftPreviewStack(recipe);
        const head = this.formatItemTooltip(this.getItem(recipe.id), recipe.quantity, null, stack);
        const lines = [];
        const viewBags = (typeof Stone !== "undefined" && Stone.bagsAfterQueue)
            ? Stone.bagsAfterQueue(this._craftStuffBags(), this._craftPendingRecipes())
            : null;
        for (const ingredient of recipe.ingredients || []) {
            const have = viewBags && Stone.ingredientHave
                ? Math.max(0, Stone.ingredientHave(recipe, viewBags, ingredient))
                : Math.max(0, this._craftIngredientHave(ingredient) - this._craftQueuedNeed(ingredient));
            lines.push({
                icon: this._craftIngredientIcon(ingredient),
                label: this._craftIngredientLabel(ingredient),
                value: `${have}/${ingredient.qty}`
            });
        }
        if (recipe.requireThing) {
            const thing = this.getThing(recipe.requireThing);
            lines.push({
                icon: this._craftStationIcon(recipe.requireThing),
                label: `Requires nearby ${thing?.name || recipe.requireThing}`
            });
        }
        if (recipe.requireStation) {
            const thing = this.getThing(recipe.requireStation);
            lines.push({
                icon: this._craftStationIcon(recipe.requireStation),
                label: `Requires ${thing?.name || recipe.requireStation}`
            });
        }
        const toolLabel = recipe.requireTool ? this._craftRequireToolLabel(recipe.requireTool) : "";
        if (toolLabel) {
            const icons = this._craftRequireToolIcons(recipe.requireTool);
            const row = { label: `Requires held ${toolLabel}` };
            if (icons.length) row.icon = icons[0];
            if (icons.length > 1) row.icons = icons;
            lines.push(row);
        }
        return { text: lines.length ? `${head}\n—` : head, lines };
    },

    /** Item, deer hide, andesite stone, or andesite knap picture for one ingredient row. */
    _craftIngredientIcon(ingredient) {
        if (!ingredient) return null;
        if (ingredient.hideStage) {
            const id = (typeof Settlement !== "undefined" && Settlement.hideItemId)
                ? Settlement.hideItemId("deer", ingredient.hideStage)
                : null;
            const key = this._craftItemIconKey(id);
            if (key) return key;
        }
        if (ingredient.toolClass) {
            const key = this._craftToolClassIcon(ingredient.toolClass);
            if (key) return key;
        }
        const id = ingredient.id;
        if (id && typeof Stone !== "undefined" && Stone.isStuffableItem?.(id)) {
            const stack = { id, quantity: 1, stone: "andesite" };
            if (id === "flint_spear") stack.knapMaterial = "flint";
            else if (id === "stone_spear") stack.knapMaterial = "andesite";
            if (typeof stuffedStackIconKey === "function") {
                const key = stuffedStackIconKey(this, stack);
                if (key && this.textures?.exists?.(key)) return key;
            }
        }
        if (
            id
            && id !== "flint"
            && typeof Stone !== "undefined"
            && Stone.normalizeStone
            && !Stone.isStuffableItem?.(id)
        ) {
            const stone = Stone.normalizeStone(id);
            if (stone && typeof ensureStoneTexture === "function") {
                const key = ensureStoneTexture(this, "pebble", 1, stone);
                if (key && this.textures?.exists?.(key)) return key;
            }
        }
        return this._craftItemIconKey(id);
    },

    /** Andesite rock, grindstone, or painting circle. Other stations use their world sprite. */
    _craftStationIcon(thingId) {
        if (!thingId) return null;
        if (thingId === "rock" && typeof ensureStoneTexture === "function") {
            const key = ensureStoneTexture(this, "rock", 1, "andesite");
            if (key && this.textures?.exists?.(key)) return key;
        }
        if (thingId === "grindstone" && typeof ensureStoneTexture === "function") {
            const key = ensureStoneTexture(this, "grindstone", 1, "andesite");
            if (key && this.textures?.exists?.(key)) return key;
        }
        if (thingId === "painting_circle" && typeof ensurePaintingCircleTexture === "function") {
            const key = ensurePaintingCircleTexture(this, "andesite");
            if (key && this.textures?.exists?.(key)) return key;
        }
        const meta = this.getThing?.(thingId);
        if (typeof Thing !== "undefined" && meta && Thing.textureKeyFor) {
            const key = Thing.textureKeyFor(this, meta, 0);
            if (key && this.textures?.exists?.(key)) return key;
        }
        const fallback = meta?.key || thingId;
        if (fallback && this.textures?.exists?.(fallback)) return fallback;
        return null;
    },

    _craftItemIconKey(itemId) {
        if (!itemId) return null;
        const def = this.getItem?.(itemId) || { id: itemId, key: itemId };
        if (typeof Place !== "undefined" && Place.itemIconKey) {
            const key = Place.itemIconKey(
                def,
                (id) => this.getThing?.(id),
                (k) => this.textures?.exists?.(k)
            );
            if (key && this.textures?.exists?.(key)) return key;
        }
        if (def?.key && this.textures?.exists?.(def.key)) return def.key;
        if (this.textures?.exists?.(itemId)) return itemId;
        return null;
    },

    /** Default knap picture for one tool class. Hard shapes use diorite. */
    _craftToolClassIcon(toolClass) {
        if (!toolClass || typeof Knapping === "undefined" || !Knapping.carveShapeIcon) return null;
        const stone = (typeof Stone !== "undefined" && Stone.iconStone)
            ? Stone.iconStone(toolClass)
            : "andesite";
        const data = Knapping.carveShapeIcon(this, toolClass, stone);
        if (!data || !Knapping.ensureToolTexture) return null;
        const key = Knapping.ensureToolTexture(this, { knapIconData: data, toolClass });
        if (key && this.textures?.exists?.(key)) return key;
        return null;
    },

    /** Andesite pictures for every class a held-tool line accepts, in recipe order. */
    _craftRequireToolIcons(requireTool) {
        const classes = (typeof Carry !== "undefined" && Carry.recipeToolClasses)
            ? Carry.recipeToolClasses(requireTool)
            : (requireTool?.toolClass ? [requireTool.toolClass] : []);
        const icons = [];
        for (const cls of classes) {
            const key = this._craftToolClassIcon(cls);
            if (key) icons.push(key);
        }
        return icons;
    },

    /** Display name for a craft ingredient (supports knapped tip / any-hide requirements). */
    _craftIngredientLabel(ingredient) {
        if (ingredient.hideStage) {
            const stage = String(ingredient.hideStage);
            if (stage === "leather") return "Any Leather";
            const label = stage.charAt(0).toUpperCase() + stage.slice(1);
            return `Any ${label} Hide`;
        }
        if (ingredient.toolClass === "spear_tip") return "Spear Tip";
        if (ingredient.toolClass === "blade") return "Stone Blade";
        return this.getItem(ingredient.id)?.name || ingredient.id;
    },

    _craftToolClassLabel(toolClass) {
        if (toolClass === "awl") return "Awl";
        if (toolClass === "scraper") return "Scraper";
        if (toolClass === "knife") return "Knife";
        return toolClass || "tool";
    },

    _craftRequireToolLabel(requireTool) {
        const classes = (typeof Carry !== "undefined" && Carry.recipeToolClasses)
            ? Carry.recipeToolClasses(requireTool)
            : (requireTool?.toolClass ? [requireTool.toolClass] : []);
        if (!classes.length) return "";
        const names = classes.map((c) => this._craftToolClassLabel(c));
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} or ${names[1]}`;
        return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
    },

    _heldMatchesCraftTool(requireTool, pawn) {
        const who = pawn || this.player;
        if (typeof Carry !== "undefined" && Carry.heldMatchesRecipeTool) {
            const held = who?.getHeldItem?.();
            const def = held ? this.getItem(held.id) : null;
            return Carry.heldMatchesRecipeTool(held, def, requireTool);
        }
        if (!requireTool?.toolClass) return true;
        return who?.heldToolClass?.() === requireTool.toolClass;
    },

    /** Wear a knapped tool, or consume 1 from a stackable single-use tool (bone). */
    _consumeCraftTool(recipe, pawn) {
        if (!(typeof Carry !== "undefined" && Carry.recipeToolClasses?.(recipe.requireTool)?.length)
            && !recipe.requireTool?.toolClass) return;
        const who = pawn || this.player;
        const held = who?.getHeldItem?.();
        const def = held ? this.getItem(held.id) : null;
        if (typeof Carry !== "undefined" && Carry.isSingleUseTool?.(held, def)) {
            const idx = who._heldSlotIndex?.()
                ?? (who.isControlled?.()
                    ? (this.hotbar?.activeIndex ?? who.hotbarIndex ?? 0)
                    : (who.hotbarIndex ?? 0));
            who.loseItemAt(idx, 1);
            return;
        }
        const wear = Number(recipe.requireTool.wear) || 0;
        if (wear > 0) who.wearHeld(wear);
    },

    hasNearbyThing(id, pawn) {
        return !!this._findNearbyThing(id, pawn);
    },

    _findNearbyThing(id, pawn) {
        if (!id) return null;
        const who = pawn || this.player;
        if (!who) return null;
        const r = this.tileSize * (who.interactionRange || 4);
        const r2 = r * r;
        const px = who.x;
        const py = who.y;
        let best = null;
        let bestD = Infinity;
        for (const chunk of this._loadedChunks || []) {
            if (!chunk.isLoaded) continue;
            for (const thing of chunk.things?.getChildren?.() || []) {
                if (!thing.active) continue;
                const have = thing.meta?.id;
                if (typeof Place !== "undefined" && Place.countsAsThing
                    ? !Place.countsAsThing(have, id)
                    : have !== id) continue;
                const dx = thing.x - px;
                const dy = thing.y - py;
                const d2 = dx * dx + dy * dy;
                if (d2 <= r2 && d2 < bestD) {
                    best = thing;
                    bestD = d2;
                }
            }
        }
        return best;
    },

    nearbyCraftStationIds() {
        const now = (typeof performance !== "undefined" && performance.now)
            ? performance.now()
            : (this.time?.now || 0);
        const px = this.player.x;
        const py = this.player.y;
        const cell = `${Math.round(px / 8)}:${Math.round(py / 8)}`;
        if (this._nearbyCraftAt && now - this._nearbyCraftAt < 200
            && this._nearbyCraftCell === cell && this._nearbyCraftIds) {
            return this._nearbyCraftIds;
        }
        const ids = [];
        const seen = new Set();
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        for (const chunk of this._loadedChunks || []) {
            if (!chunk.isLoaded) continue;
            for (const thing of chunk.things?.getChildren?.() || []) {
                const id = thing?.active && thing.meta?.craftStation ? thing.meta.id : null;
                if (!id || seen.has(id)) continue;
                const dx = thing.x - px;
                const dy = thing.y - py;
                if (dx * dx + dy * dy > r2) continue;
                seen.add(id);
                ids.push(id);
            }
        }
        ids.sort();
        this._nearbyCraftAt = now;
        this._nearbyCraftCell = cell;
        this._nearbyCraftIds = ids;
        return ids;
    },

    _findNearbyCraftStation(stationId, pawn) {
        if (!stationId) return null;
        const who = pawn || this.player;
        const clicked = this._craftStationThing;
        if (who === this.player && clicked?.active && clicked.meta?.id === stationId && clicked.inRange?.(who)) {
            return clicked;
        }
        const r = this.tileSize * (who?.interactionRange || 4);
        const r2 = r * r;
        const px = who.x;
        const py = who.y;
        for (const chunk of this._loadedChunks || []) {
            if (!chunk.isLoaded) continue;
            for (const thing of chunk.things?.getChildren?.() || []) {
                if (!thing?.active || thing.meta?.id !== stationId) continue;
                if (!thing.meta?.craftStation) continue;
                const dx = thing.x - px;
                const dy = thing.y - py;
                if (dx * dx + dy * dy <= r2) return thing;
            }
        }
        return null;
    },

    _openCraftStorage(pawn) {
        const panel = this.storagePanel;
        if (!panel?.visible || !panel.storage?.active) return null;
        const store = panel.storage;
        if (!store.inRange?.(pawn || this.player)) return null;
        return store;
    },

    _countSlotsMatching(slots, match, who) {
        if (!Array.isArray(slots) || !who?._stackMatchesCraft) return 0;
        const hideStage = match?.hideStage || null;
        const id = match?.id;
        const wantClass = match?.toolClass || null;
        if (!hideStage && !id) return 0;
        let sum = 0;
        for (const s of slots) {
            if (!who._stackMatchesCraft(s, hideStage ? { hideStage } : {
                id,
                toolClass: wantClass,
                stuffKey: match?.stuffKey || null
            })) continue;
            sum += Math.max(0, Math.floor(Number(s.quantity) || 0));
        }
        return sum;
    },

    _craftIngredientHave(ingredient, pawn) {
        const who = pawn || this.player;
        let n = who.getNumMatchingItems?.(ingredient) || 0;
        n += this._countSlotsMatching(who?.overflow, ingredient, who);
        const store = this._openCraftStorage(who);
        if (store) n += this._countSlotsMatching(store.entry?.slots, ingredient, who);
        return n;
    },

    /** Spend matching stacks. writeSlot is for containers that mirror the slot. */
    _loseCraftSlots(slots, match, qty, who, writeSlot, into) {
        if (!Array.isArray(slots) || !(qty > 0) || !who?._stackMatchesCraft) return 0;
        let remaining = Math.max(0, Math.floor(Number(qty) || 0));
        const hideStage = match?.hideStage || null;
        const id = match?.id;
        const wantClass = match?.toolClass || null;
        const put = (i, stack) => {
            if (writeSlot) writeSlot(i, stack);
            else slots[i] = stack;
        };
        const takeFrom = (requireClass) => {
            for (let i = 0; i < slots.length && remaining > 0; i++) {
                const s = slots[i];
                if (!who._stackMatchesCraft(s, hideStage ? { hideStage } : { id, stuffKey: match?.stuffKey || null })) continue;
                if (requireClass && s.toolClass !== requireClass) continue;
                if (!requireClass && wantClass && s.toolClass === wantClass) continue;
                const have = Math.max(0, Math.floor(Number(s.quantity) || 0));
                const take = Math.min(have, remaining);
                if (!(take > 0)) continue;
                if (into && who._pieceForCraftRefund) into.push(who._pieceForCraftRefund(s, take));
                s.quantity = have - take;
                remaining -= take;
                if (!(s.quantity > 0)) put(i, null);
                else put(i, s);
            }
        };
        if (hideStage) takeFrom(null);
        else if (wantClass) takeFrom(wantClass);
        else takeFrom(null);
        return Math.max(0, Math.floor(Number(qty) || 0) - remaining);
    },

    _loseStorageCraft(store, match, qty, who, into) {
        if (!store) return 0;
        return this._loseCraftSlots(store.entry?.slots, match, qty, who, (i, stack) => {
            store.setSlot(i, stack);
        }, into);
    },

    canCraft(recipe, pawn, opts) {
        const who = pawn || this.player;
        if (!opts?.skipIngredients) {
            const bags = this._craftStuffBags(who);
            if (typeof Stone !== "undefined" && Stone.craftTakesStuff?.(recipe?.id)
                && Stone.craftMaterial(recipe, bags) == null) {
                return false;
            }
            if (!recipe.ingredients.every(
                (ingredient) => this._craftIngredientHave(ingredient, who) >= ingredient.qty
            )) {
                return false;
            }
        }
        if (recipe.requireThing && !this.hasNearbyThing(recipe.requireThing, who)) {
            return false;
        }
        if (recipe.requireStation && !this._findNearbyCraftStation(recipe.requireStation, who)) {
            return false;
        }
        if (recipe.requireTool && !this._heldMatchesCraftTool(recipe.requireTool, who)) {
            return false;
        }
        return true;
    },

    /**
     * How many times to run a recipe for this click.
     * Right-click produces 5 output items (rounded up to a whole craft).
     * Ctrl produces 10 output items (rounded up to a whole craft).
     * Shift produces as many as ingredients and the held tool allow.
     * A plain click crafts once.
     */
    _craftClickCount(recipe, pointer) {
        const ev = pointer?.event;
        const keys = this.player?.keys;
        const shift = !!(ev?.shiftKey || keys?.SHIFT?.isDown);
        const ctrl = !!(ev?.ctrlKey || ev?.metaKey || keys?.CTRL?.isDown);
        const right = !!(pointer?.rightButtonDown?.() || pointer?.button === 2 || ev?.button === 2);
        const out = Math.max(1, Math.floor(Number(recipe?.quantity) || 1));
        let n = 1;
        if (shift) n = 999;
        else if (ctrl) n = Math.ceil(10 / out);
        else if (right) n = Math.ceil(5 / out);
        // Timed crafts channel one by one, so the queue has to be finite up front.
        // Offline play also has to stop itself; the sim path lets the server stop.
        const timed = (Number(recipe?.craftSeconds) || 0) > 0;
        if (timed || !this.simAuth?.()) n = Math.min(n, this._maxCraftRepeats(recipe));
        return Math.max(0, Math.floor(n));
    },

    /** Crafts possible from pockets, the open container, and the held tool. */
    _maxCraftRepeats(recipe, pawn) {
        const who = pawn || this.player;
        if (!recipe || !this.canCraft(recipe, who)) return 0;
        const pure = (typeof Stone !== "undefined" && Stone.craftRepeatCount)
            ? Stone.craftRepeatCount(recipe, this._craftStuffBags(who))
            : null;
        let n = pure != null ? pure : 999;
        if (pure == null) {
            for (const ing of recipe.ingredients || []) {
                const qty = Math.max(1, Math.floor(Number(ing.qty) || 1));
                const have = this._craftIngredientHave(ing, who);
                n = Math.min(n, Math.floor(have / qty));
            }
        }
        const tool = this._craftToolRepeats(recipe, who);
        if (tool != null) n = Math.min(n, tool);
        return Math.max(0, n);
    },

    /**
     * Uses left on the held tool, or null when the tool is not consumed.
     * A durability tool can finish the craft that breaks it.
     */
    _craftToolRepeats(recipe, pawn) {
        const rt = recipe?.requireTool;
        if (!rt) return null;
        const classes = (typeof Carry !== "undefined" && Carry.recipeToolClasses)
            ? Carry.recipeToolClasses(rt)
            : (rt.toolClass ? [rt.toolClass] : []);
        if (!classes.length) return null;
        const who = pawn || this.player;
        const held = who?.getHeldItem?.();
        const def = held ? this.getItem?.(held.id) : null;
        if (typeof Carry !== "undefined" && Carry.isSingleUseTool?.(held, def)) {
            return Math.max(0, Math.floor(Number(held?.quantity) || 0));
        }
        const wear = Number(rt.wear) || 0;
        if (!(wear > 0) || typeof Durability === "undefined") return null;
        const max = Durability.maxDurability(held, def);
        if (!(max > 0)) return null;
        const left = Durability.remainingDurability(held, def);
        if (!(left > 0)) return 1;
        return Math.max(1, Math.ceil(left / wear));
    },

    /**
     * Half-size column to the right of the recipe grid.
     * The first run sits at the top of the columns and crafts first.
     * Later runs appear under it. Back-to-back crafts of the same item and stuff share one box.
     */
    _craftQueueGeom() {
        const d = this._craftMenuData;
        const slotW = d?.slotW || 64;
        const slotH = d?.slotH || 64;
        const pad = d?.pad ?? 4;
        const qw = slotW / 2;
        const qh = slotH / 2;
        const gridW = d?.gridW || 0;
        const gridH = d?.gridH || 0;
        return { qw, qh, pad, gridW, gridH, top: d?.queueTop || 0, x: gridW + pad };
    },

    _craftQueueSame(a, b) {
        return !!(a && b && a.id === b.id);
    },

    /** Stone or tip already chosen for this craft. Empty when the item has no stuff. */
    _craftFaceKey(entry) {
        const id = entry?.recipe?.id || "";
        const face = entry?.paid || entry?.face || null;
        if (!id || !face) return "";
        if (id === "grindstone" || id === "painting_circle") {
            return "stone:" + (face.pebbleStone || "andesite");
        }
        if (id === "stone_spear" || id === "flint_spear" || id === "arrow") {
            return [
                "tip",
                face.tipMaterial || "",
                face.tipStone || "",
                face.tipQuality || ""
            ].join(":");
        }
        return "";
    },

    /** Picture and name for one queued craft. Null keeps the plain item. */
    _craftQueueStack(recipe, face) {
        if (!recipe || !face) return null;
        const id = recipe.id;
        if (id === "grindstone" || id === "painting_circle") {
            return { id, stone: face.pebbleStone || "andesite" };
        }
        if (id === "stone_spear" || id === "flint_spear" || id === "arrow") {
            const mat = face.tipMaterial;
            const stone = face.tipStone || null;
            if (mat !== "flint" && mat !== "pebble" && !stone) return null;
            const stack = { id };
            if (mat) stack.knapMaterial = mat;
            if (stone) stack.stone = stone;
            if (face.tipQuality) stack.knapQuality = face.tipQuality;
            return stack;
        }
        return null;
    },

    _craftFaceFromStack(recipe, stack) {
        const id = recipe?.id;
        const face = {
            tipQuality: null,
            tipMaterial: null,
            tipStone: null,
            pebbleStone: null
        };
        if (id === "grindstone" || id === "painting_circle") {
            face.pebbleStone = stack?.stone || "andesite";
            return face;
        }
        if (id === "stone_spear" || id === "flint_spear" || id === "arrow") {
            face.tipMaterial = stack?.knapMaterial || null;
            face.tipStone = stack?.stone || null;
            face.tipQuality = stack?.knapQuality || null;
        }
        return face;
    },

    /**
     * Stuff each new craft will copy, in queue order, before those ingredients
     * leave the bags. The server spends in this same order.
     */
    _forecastCraftFaces(recipe, count) {
        const n = Math.max(0, Math.floor(Number(count) || 0));
        const faces = [];
        if (!(n > 0)) return faces;
        const StoneApi = typeof Stone !== "undefined" ? Stone : null;
        if (!StoneApi?.craftPreviewStack || !StoneApi?.bagsAfterQueue) {
            for (let i = 0; i < n; i++) faces.push(this._craftFaceFromStack(recipe, null));
            return faces;
        }
        let bags = StoneApi.bagsAfterQueue(this._craftStuffBags?.() || [], this._craftPendingRecipes?.() || []);
        for (let i = 0; i < n; i++) {
            faces.push(this._craftFaceFromStack(recipe, StoneApi.craftPreviewStack(recipe, bags)));
            bags = StoneApi.bagsAfterQueue(bags, [recipe]);
        }
        return faces;
    },

    /** True when this craft can join the tail box, or the column has a free box. */
    _craftQueueJobFits(job) {
        const groups = this._craftQueueGroups();
        const limit = this._craftQueueLimit();
        const tail = groups[groups.length - 1];
        if (tail && this._craftQueueSame(tail.recipe, job?.recipe)) {
            const tailKey = typeof this._craftFaceKey === "function" ? this._craftFaceKey(tail) : "";
            const jobKey = typeof this._craftFaceKey === "function" ? this._craftFaceKey(job) : "";
            if (tailKey === jobKey) return true;
        }
        return groups.length < limit;
    },

    /** Consecutive crafts of one item and one stuff, in queue order. */
    _craftQueueGroups(jobs) {
        const list = jobs || this._craftQueue || [];
        const groups = [];
        const faceKey = typeof this._craftFaceKey === "function"
            ? (entry) => this._craftFaceKey(entry)
            : () => "";
        for (let i = 0; i < list.length; i++) {
            const job = list[i];
            if (!job?.recipe || job.void) continue;
            const prev = groups[groups.length - 1];
            if (prev && this._craftQueueSame(prev.recipe, job.recipe) && faceKey(prev) === faceKey(job)) {
                prev.count += 1;
                prev.indexes.push(i);
            } else {
                groups.push({
                    recipe: job.recipe,
                    count: 1,
                    start: i,
                    indexes: [i],
                    face: job.paid || job.face || null
                });
            }
        }
        return groups;
    },

    /**
     * How many crafts a queue-slot click removes.
     * Left is one, right is five, ctrl is ten, shift is the whole stack.
     */
    _craftQueueClickCount(pointer, have) {
        const total = Math.max(0, Math.floor(Number(have) || 0));
        if (!(total > 0)) return 0;
        const ev = pointer?.event;
        const keys = this.player?.keys;
        const shift = !!(ev?.shiftKey || keys?.SHIFT?.isDown);
        const ctrl = !!(ev?.ctrlKey || ev?.metaKey || keys?.CTRL?.isDown);
        const right = !!(pointer?.rightButtonDown?.() || pointer?.button === 2);
        let n = 1;
        if (shift) n = total;
        else if (ctrl) n = 10;
        else if (right) n = 5;
        return Math.min(total, n);
    },

    /**
     * Take crafts off the end of one queue stack and give the ingredients back.
     * The craft already running stays until that stack is cleared.
     */
    _unqueueCraftGroup(groupIndex, count) {
        const q = this._craftQueue || [];
        const group = this._craftQueueGroups(q)[groupIndex];
        if (!group || !(count > 0)) return 0;
        const n = Math.min(group.count, Math.floor(count));
        if (!(n > 0)) return 0;
        const idxs = group.indexes.slice(-n);
        const player = this.player;
        const live = !!(this._craftQueueLive && player?._craftChannel?.fromQueue);
        const cancelLive = live && idxs.includes(0);
        if (cancelLive) {
            this._craftQueueLive = false;
            player._craftChannel = null;
            player._hideChannelBar?.();
        }
        const ranges = [];
        for (let k = idxs.length - 1; k >= 0; k--) {
            const i = idxs[k];
            const job = q[i];
            if (!job || job.void) continue;
            if (!job.taken) {
                job.void = true;
                continue;
            }
            let server = 0;
            for (let j = 0; j < i; j++) {
                if (q[j]?.taken && !q[j].void) server++;
            }
            if (!this.simAuth?.()) this._refundCraftJob?.(player, job);
            q.splice(i, 1);
            const prev = ranges[ranges.length - 1];
            if (prev && server + prev.count === prev.index) {
                prev.index = server;
                prev.count += 1;
            } else {
                ranges.push({ index: server, count: 1 });
            }
        }
        if (this.simAuth?.()) {
            for (let i = 0; i < ranges.length; i++) {
                this._sendCraftAction({
                    op: "refund",
                    index: ranges[i].index,
                    count: ranges[i].count
                });
            }
        }
        if (cancelLive || !player?._craftChannel) this._pumpCraftQueue?.();
        this._layoutCraftQueue?.();
        this.refreshCraftMenu?.();
        this.refreshTooltip?.();
        if (this.hotbar) this.hotbar.dirty = true;
        return n;
    },

    _craftQueueSlotPos(i) {
        const g = this._craftQueueGeom();
        const step = g.qh + g.pad;
        return {
            x: g.x,
            y: g.top + i * step,
            w: g.qw,
            h: g.qh
        };
    },

    _craftQueueLimit() {
        const g = this._craftQueueGeom();
        const step = g.qh + g.pad;
        if (!(step > 0)) return 1;
        const top = (this.craftContainer?.y || 0) + g.top;
        const screenH = this.scale?.height;
        const space = screenH > top ? screenH - top : g.qh;
        return Math.max(1, Math.floor((space + g.pad) / step));
    },

    /**
     * How many more crafts fit. A run of the same item shares one box,
     * so it does not spend another slot. A new item needs a free box.
     */
    _craftQueueRoom(recipe) {
        const groups = this._craftQueueGroups();
        const limit = this._craftQueueLimit();
        const tail = groups[groups.length - 1];
        if (recipe && tail && this._craftQueueSame(tail.recipe, recipe)) return 999;
        const open = limit - groups.length;
        if (!recipe) return Math.max(0, open);
        return open > 0 ? 999 : 0;
    },

    _craftQueueScreenSpan() {
        const jobs = this._craftQueue;
        const d = this._craftMenuData;
        const c = this.craftContainer;
        if (!this.craftMenuVisible || !jobs?.length || !d || !c) return null;
        const g = this._craftQueueGeom();
        const n = this._craftQueueGroups(jobs).length;
        const localBottom = g.top + n * g.qh + (n - 1) * g.pad;
        return {
            left: c.x + g.gridW,
            right: c.x + g.x + g.qw,
            top: c.y + g.top,
            bottom: c.y + localBottom
        };
    },

    _craftIngredientsMatch(a, b) {
        if (!a || !b) return false;
        if (a.hideStage || b.hideStage) return !!a.hideStage && a.hideStage === b.hideStage;
        if (a.id !== b.id) return false;
        return (a.toolClass || null) === (b.toolClass || null);
    },

    _craftQueuedNeed(ingredient) {
        let n = 0;
        for (const job of this._craftQueue || []) {
            // Taken jobs already left the bags, so they are not still reserved.
            if (job?.taken) continue;
            for (const ing of job.recipe?.ingredients || []) {
                if (!this._craftIngredientsMatch(ing, ingredient)) continue;
                n += Math.max(1, Math.floor(Number(ing.qty) || 1));
            }
        }
        return n;
    },

    _craftToolKey(recipe) {
        const rt = recipe?.requireTool;
        if (!rt) return "";
        const classes = (typeof Carry !== "undefined" && Carry.recipeToolClasses)
            ? Carry.recipeToolClasses(rt).slice()
            : (rt.toolClass ? [String(rt.toolClass)] : []);
        if (!classes.length) return "";
        classes.sort();
        return classes.join(",");
    },

    _craftQueuedToolUses(recipe) {
        const key = this._craftToolKey(recipe);
        if (!key) return 0;
        let n = 0;
        for (const job of this._craftQueue || []) {
            if (this._craftToolKey(job.recipe) !== key) continue;
            if (this._craftToolRepeats(job.recipe) == null) continue;
            n += 1;
        }
        return n;
    },

    /** How many more of this recipe fit in pockets, the held tool, and the queue. */
    _craftQueueAfford(recipe, pawn) {
        const who = pawn || this.player;
        if (!recipe) return 0;
        if (recipe.requireThing && !this.hasNearbyThing(recipe.requireThing, who)) return 0;
        if (recipe.requireStation && !this._findNearbyCraftStation(recipe.requireStation, who)) return 0;
        if (recipe.requireTool && !this._heldMatchesCraftTool(recipe.requireTool, who)) return 0;
        const pendingBags = (typeof Stone !== "undefined" && Stone.bagsAfterQueue && Stone.craftRepeatCount)
            ? Stone.bagsAfterQueue(this._craftStuffBags(who), this._craftPendingRecipes())
            : null;
        const pure = pendingBags ? Stone.craftRepeatCount(recipe, pendingBags) : null;
        if (pure != null) {
            let n = pure;
            const tool = this._craftToolRepeats(recipe, who);
            if (tool != null) n = Math.min(n, tool - this._craftQueuedToolUses(recipe));
            return Math.max(0, Math.floor(n));
        }
        let n = 999;
        for (const ing of recipe.ingredients || []) {
            const qty = Math.max(1, Math.floor(Number(ing.qty) || 1));
            const have = (this._craftIngredientHave(ing, who) || 0) - this._craftQueuedNeed(ing);
            n = Math.min(n, Math.floor(have / qty));
        }
        const tool = this._craftToolRepeats(recipe, who);
        if (tool != null) n = Math.min(n, tool - this._craftQueuedToolUses(recipe));
        return Math.max(0, Math.floor(n));
    },

    _craftPlayerBusy(player) {
        if (!player) return true;
        return !!(
            player._eatChannel || player._tendChannel || player._skinChannel
            || player._fleshChannel || player._brainChannel || player._craftChannel
            || player._bodyDead || player.isAttacking?.() || player.isVomiting?.()
            || player.isIncapacitated?.()
        );
    },

    _stationForCraft(recipe) {
        if (!recipe) return null;
        if (recipe.requireStation) {
            return this._findNearbyCraftStation(recipe.requireStation) || this._craftStationThing || null;
        }
        if (recipe.requireThing) return this._findNearbyThing(recipe.requireThing);
        return null;
    },

    _enqueueCrafts(recipe, count) {
        let n = Math.floor(Number(count));
        if (!Number.isFinite(n) || n < 1) return 0;
        if (!this._craftQueue) this._craftQueue = [];
        n = Math.min(n, this._craftQueueAfford(recipe), this._craftQueueRoom(recipe));
        if (n < 1) return 0;
        const before = this._craftQueue.length;
        if (this.simAuth?.()) {
            const faces = this._forecastCraftFaces?.(recipe, n) || [];
            const asks = this._craftReserveAsks || (this._craftReserveAsks = []);
            let added = 0;
            const limit = faces.length || n;
            for (let i = 0; i < limit; i++) {
                const job = { recipe, taken: false, face: faces[i] || null };
                if (this._craftQueueJobFits && !this._craftQueueJobFits(job)) break;
                this._craftQueue.push(job);
                added++;
            }
            if (added > 0) {
                asks.push(added);
                this._sendCraftAction({ op: "reserve", id: recipe.id, count: added });
            }
        } else if (this._payCraftLocal) {
            for (let i = 0; i < n; i++) {
                const face = this._craftPayPreview?.(recipe) || null;
                if (this._craftQueueJobFits && !this._craftQueueJobFits({ recipe, face })) break;
                const paid = this._payCraftLocal(recipe);
                if (!paid) break;
                this._craftQueue.push({ recipe, taken: true, paid });
            }
        } else {
            for (let i = 0; i < n; i++) this._craftQueue.push({ recipe, taken: true });
        }
        this._pumpCraftQueue();
        this._layoutCraftQueue();
        return Math.max(0, this._craftQueue.length - before);
    },

    _pumpCraftQueue() {
        const q = this._craftQueue;
        if (!q?.length) {
            this._craftQueueLive = false;
            return;
        }
        const player = this.player;
        if (!player || player._craftChannel || this._craftPlayerBusy(player)) return;
        let guard = q.length;
        while (q.length && guard-- > 0) {
            const job = q[0];
            // The server has not taken these ingredients yet.
            if (!job?.taken) return;
            const recipe = job?.recipe;
            if (!recipe || !this.canCraft(recipe, player, { skipIngredients: true })) {
                this._dropCraftQueueHead();
                continue;
            }
            const station = this._stationForCraft(recipe);
            const needPlace = !!(recipe.requireStation || recipe.requireThing);
            if (needPlace && !station) {
                this._dropCraftQueueHead();
                continue;
            }
            const ok = player.beginCraft?.(recipe, station, 1, { skipIngredients: true }) === true;
            if (player._craftChannel) {
                if (ok) {
                    player._craftChannel.fromQueue = true;
                    this._craftQueueLive = true;
                }
                return;
            }
            this._dropCraftQueueHead();
        }
        this._craftQueueLive = false;
    },

    _onCraftQueueStep() {
        this._craftQueueLive = false;
        if (this._craftQueue?.length) this._craftQueue.shift();
        this._pumpCraftQueue();
        this._layoutCraftQueue();
    },

    _onCraftQueueCancelled() {
        this._refundOpenCraftQueue();
    },

    _updateCraftQueue() {
        const player = this.player;
        if (player?._bodyDead) {
            if (this._craftQueue?.length || this._craftQueueLive) this._refundOpenCraftQueue();
            this._drawCraftQueueSweep();
            return;
        }
        const ch = player?._craftChannel;
        if (this._craftQueueLive && (!ch || !ch.fromQueue)) {
            this._refundOpenCraftQueue();
        } else if (!ch && this._craftQueue?.length && !this._craftPlayerBusy(player)) {
            this._pumpCraftQueue();
            this._layoutCraftQueue();
        }
        if (this.craftMenuVisible) this._layoutCraftQueue();
        this._drawCraftQueueSweep();
    },

    _detachCraftQueueLayer() {
        const layer = this._craftQueueLayer;
        if (!layer?.active) return;
        layer.parentContainer?.remove(layer);
    },

    _attachCraftQueueLayer() {
        const layer = this._craftQueueLayer;
        if (!layer?.active || !this.craftContainer) return;
        if (layer.parentContainer !== this.craftContainer) this.craftContainer.add(layer);
    },

    _ensureCraftQueueLayer() {
        let layer = this._craftQueueLayer;
        if (!layer?.active || !layer.scene) {
            layer = this.add.container(0, 0).setVisible(false);
            const sweep = this.add.graphics();
            layer.add(sweep);
            this._craftQueueLayer = layer;
            this._craftQueueSweep = sweep;
            this._craftQueueViews = [];
            this._craftQueueSig = "";
        }
        this._attachCraftQueueLayer();
        return layer;
    },

    _makeCraftQueueView(layer) {
        const slot = this.add.image(0, 0, "slot").setOrigin(0, 0);
        const icon = this.add.image(0, 0, "slot").setOrigin(0.5, 0.5);
        const qty = crispUiText(this.add.text(0, 0, "", {
            fontSize: `${pixelUiFontSize(8, 1)}px`,
            fontFamily: PIXEL_UI_FONT,
            stroke: "#000",
            strokeThickness: 2,
            align: "right"
        }).setOrigin(1, 1).setVisible(false));
        const view = { slot, icon, qty, recipe: null };
        slot.on("pointerover", (p) => {
            const recipe = view.recipe;
            if (!recipe || !slot.visible) return;
            this.showTooltip(() => {
                const item = this.getItem(recipe.id);
                // The pile still in the bag is the next craft. This box already chose its stuff.
                return this.formatItemTooltip(item, recipe.quantity || 1, null, view.stack || null);
            }, p.x, p.y, slot);
        });
        slot.on("pointerout", () => {
            if (this._tooltipTarget === slot) this.hideTooltip();
        });
        slot.on("pointerdown", (pointer, _x, _y, event) => {
            event?.stopPropagation?.();
            if (!view.slot.visible || view.index == null) return;
            const n = this._craftQueueClickCount(pointer, view.count);
            if (!(n > 0)) return;
            this._unqueueCraftGroup(view.index, n);
        });
        layer.add(slot);
        layer.add(icon);
        layer.add(qty);
        return view;
    },

    _setCraftQueueIcon(view) {
        const icon = view?.icon;
        const recipe = view?.recipe;
        if (!icon?.active || !recipe) return;
        const key = this._craftRecipeIconKey(recipe, view.stack || null);
        if (!key || !this.textures?.exists?.(key) || icon.texture?.key === key) return;
        icon.setTexture(key);
    },

    _craftQueueSigNow() {
        const d = this._craftMenuData || {};
        const ids = (this._craftQueue || [])
            .filter((j) => j && !j.void)
            .map((j) => `${j.recipe?.id || ""}:${this._craftFaceKey?.(j) || ""}`)
            .join(",");
        return [
            this.craftMenuVisible ? 1 : 0,
            ids,
            d.slotW, d.slotH, d.pad, d.gridW, d.gridH, d.queueTop,
            this.uiScale || 1
        ].join("|");
    },

    _layoutCraftQueue() {
        if (!this.craftContainer?.scene && !this._craftQueue?.length) return;
        const layer = this._ensureCraftQueueLayer();
        if (!layer) return;
        const jobs = this._craftQueue || [];
        const groups = this._craftQueueGroups(jobs);
        const show = !!(this.craftMenuVisible && groups.length && this._craftMenuData);
        const sig = this._craftQueueSigNow();
        if (sig === this._craftQueueSig) {
            layer.setVisible(show);
            return;
        }
        this._craftQueueSig = sig;
        const views = this._craftQueueViews || (this._craftQueueViews = []);
        const ui = this.uiScale || 1;
        while (views.length < groups.length) views.push(this._makeCraftQueueView(layer));
        for (let i = 0; i < views.length; i++) {
            const view = views[i];
            const group = groups[i];
            const on = !!(show && group);
            view.recipe = group?.recipe || null;
            view.face = group?.face || null;
            view.stack = (on && group) ? this._craftQueueStack(group.recipe, group.face) : null;
            view.count = group?.count || 0;
            view.index = on ? i : null;
            view.slot.setVisible(on);
            view.icon.setVisible(on);
            if (!on) {
                view.qty.setVisible(false);
                if (view.slot.input) view.slot.disableInteractive();
                if (this._tooltipTarget === view.slot) this.hideTooltip?.();
                continue;
            }
            const pos = this._craftQueueSlotPos(i, groups.length);
            view.slot.setScale(ui / 2);
            view.slot.setPosition(Math.round(pos.x), Math.round(pos.y));
            view.icon.setScale(1.5 * ui);
            const cx = view.slot.x + view.slot.displayWidth / 2;
            const cy = view.slot.y + view.slot.displayHeight / 2;
            view.icon.setPosition(Math.round(cx), Math.round(cy));
            this._setCraftQueueIcon(view);
            const run = group.count;
            const out = Math.floor(Number(group.recipe?.quantity) || 1);
            const num = run > 1 ? run : (out > 1 ? out : 0);
            view.qty.setText(num > 0 ? String(num) : "");
            view.qty.setVisible(num > 0);
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(view.qty, 8, ui);
            view.qty.setStroke("#000000", 2);
            const inset = 2 * ui;
            view.qty.setPosition(
                Math.round(view.slot.x + view.slot.displayWidth - inset),
                Math.round(view.slot.y + view.slot.displayHeight - inset)
            );
            if (!view.slot.input) view.slot.setInteractive({ useHandCursor: true });
            else view.slot.input.enabled = true;
        }
        if (this._craftQueueSweep) layer.bringToTop(this._craftQueueSweep);
        for (let i = 0; i < views.length; i++) {
            if (views[i].qty?.visible) layer.bringToTop(views[i].qty);
        }
        layer.setVisible(show);
        if (show) this.craftContainer?.bringToTop?.(layer);
    },

    /**
     * Clockwise pie from 12 o'clock, clipped to the slot.
     * The filled sector is the trail; the last edge is the spinning line.
     */
    _craftSweepPoly(x, y, w, h, progress) {
        const p = Number(progress);
        if (!(p > 0) || !(w > 0) || !(h > 0)) return [];
        const left = x;
        const top = y;
        const right = x + w;
        const bottom = y + h;
        if (p >= 1) {
            return [
                { x: left, y: top },
                { x: right, y: top },
                { x: right, y: bottom },
                { x: left, y: bottom }
            ];
        }
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        const start = -Math.PI / 2;
        const sweep = p * Math.PI * 2;
        const tau = Math.PI * 2;
        const norm = (angle) => {
            let d = (angle - start) % tau;
            if (d < 0) d += tau;
            return d;
        };
        const edge = (angle) => {
            const dx = Math.cos(angle);
            const dy = Math.sin(angle);
            let t = Infinity;
            if (dx > 1e-8) t = Math.min(t, (right - cx) / dx);
            else if (dx < -1e-8) t = Math.min(t, (left - cx) / dx);
            if (dy > 1e-8) t = Math.min(t, (bottom - cy) / dy);
            else if (dy < -1e-8) t = Math.min(t, (top - cy) / dy);
            if (!Number.isFinite(t) || t < 0) t = 0;
            return { x: cx + dx * t, y: cy + dy * t };
        };
        const pts = [{ x: cx, y: cy }, edge(start)];
        const corners = [
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
            { x: left, y: top }
        ];
        const mid = [];
        for (let i = 0; i < corners.length; i++) {
            const c = corners[i];
            const d = norm(Math.atan2(c.y - cy, c.x - cx));
            if (d > 1e-3 && d < sweep - 1e-3) mid.push({ x: c.x, y: c.y, d });
        }
        mid.sort((a, b) => a.d - b.d);
        for (let i = 0; i < mid.length; i++) pts.push({ x: mid[i].x, y: mid[i].y });
        pts.push(edge(start + sweep));
        return pts;
    },

    _craftQueueProgress() {
        const ch = this.player?._craftChannel;
        if (!ch?.fromQueue || !(ch.max > 0)) return 0;
        return Phaser.Math.Clamp(1 - ch.remaining / ch.max, 0, 1);
    },

    _drawCraftQueueSweep() {
        const g = this._craftQueueSweep;
        if (!g?.active) return;
        g.clear();
        const slot = this._craftQueueViews?.[0]?.slot;
        if (!slot?.visible || !this.craftMenuVisible || !this._craftQueueLive) return;
        const box = { x: slot.x, y: slot.y, w: slot.displayWidth, h: slot.displayHeight };
        if (!(box.w > 0) || !(box.h > 0)) return;
        const progress = this._craftQueueProgress();
        if (!(progress > 0)) return;
        const poly = this._craftSweepPoly(box.x, box.y, box.w, box.h, progress);
        if (poly.length < 3) return;
        g.fillStyle(0x8a8a8a, 0.78);
        g.beginPath();
        g.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
        g.closePath();
        g.fillPath();
        if (progress < 0.999) {
            const end = poly[poly.length - 1];
            const cx = box.x + box.w / 2;
            const cy = box.y + box.h / 2;
            const thick = Math.max(1, Math.round(Math.min(box.w, box.h) * 0.06));
            g.lineStyle(thick, 0xe4e4e4, 0.95);
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(end.x, end.y);
            g.strokePath();
        }
    },

    doCraft(recipe, count = 1) {
        let n = Math.floor(Number(count));
        if (!Number.isFinite(n) || n < 1) n = 1;
        n = Math.min(999, n);
        if ((Number(recipe.craftSeconds) || 0) > 0) {
            return this._enqueueCrafts(recipe, n) > 0;
        }
        if (this.simAuth()) {
            this._finishCraft(recipe, this.player, n);
            return;
        }
        for (let i = 0; i < n; i++) {
            if (!this.canCraft(recipe)) break;
            this._finishCraft(recipe);
        }
    },

    _sendCraftAction(fields) {
        if (!this.simAuth?.() || typeof NetProtocol === "undefined" || !this.net?.sendAction) return;
        this._netSendMove?.(true);
        const who = this.player;
        const store = this._openCraftStorage?.(who);
        this.net.sendAction({
            type: NetProtocol.Actions.CRAFT,
            pawnId: who?.pawnId,
            storageUid: store?.entry?.uid || null,
            ...fields
        });
    },

    /** Tip and pebble captured before the ingredients leave the bags. */
    _craftPayPreview(recipe, who) {
        const tip = this._craftPredictedTip(recipe, who);
        let pebbleStone = null;
        if (recipe?.id === "grindstone" || recipe?.id === "painting_circle") {
            const pebble = this._craftPredictedPebble(recipe, who);
            pebbleStone = (typeof Stone !== "undefined" && Stone.normalizeStone)
                ? (Stone.normalizeStone(pebble?.stone) || "andesite")
                : (pebble?.stone || "andesite");
        }
        return {
            id: recipe?.id,
            tipQuality: tip?.knapQuality || null,
            tipMaterial: tip?.knapMaterial || null,
            tipStone: tip?.stone || null,
            pebbleStone
        };
    },

    _craftPendingRecipes() {
        const out = [];
        for (const job of this._craftQueue || []) {
            if (!job || job.taken || job.void || !job.recipe) continue;
            out.push(job.recipe);
        }
        return out;
    },

    _takeCraftIngredients(recipe, who, into) {
        const store = this._openCraftStorage(who);
        const takes = typeof Stone !== "undefined" && Stone.craftTakesStuff?.(recipe?.id);
        const material = takes && Stone.craftMaterial
            ? Stone.craftMaterial(recipe, this._craftStuffBags(who))
            : "";
        if (takes && material == null) return;
        for (const ing of recipe?.ingredients || []) {
            const match = (material && Stone.ingredientSuppliesStuff?.(ing))
                ? { ...ing, stuffKey: material }
                : ing;
            const need = Math.max(0, Number(match.qty) || 1);
            const fromInv = who.loseMatchingItems(match, into) || 0;
            let left = Math.max(0, need - fromInv);
            if (left > 0) {
                const fromPack = this._loseCraftSlots(who.overflow, match, left, who, null, into);
                if (fromPack > 0 && this.hotbar) this.hotbar.dirty = true;
                left = Math.max(0, left - fromPack);
            }
            if (left > 0) this._loseStorageCraft(store, match, left, who, into);
        }
    },

    /** Spend one craft's ingredients and remember enough to refund or finish it. */
    _payCraftLocal(recipe, pawn) {
        const who = pawn || this.player;
        if (!who || !this.canCraft(recipe, who)) return null;
        const preview = this._craftPayPreview(recipe, who);
        const refund = [];
        this._takeCraftIngredients(recipe, who, refund);
        return { ...preview, refund };
    },

    _refundCraftPiece(who, piece) {
        if (!who || !piece?.id) return;
        const qty = Math.max(1, Math.floor(Number(piece.quantity) || 1));
        const extras = piece.extras && typeof piece.extras === "object" ? piece.extras : null;
        const stack = { id: piece.id, quantity: qty, ...(extras || {}) };
        const special = !!(
            stack.toolClass || stack.knapIconData || stack.knapQuality
            || stack.customName || stack.food || stack.formClass
        );
        if (special && who.gainStack?.(stack)) return;
        const item = this.getItem?.(stack.id);
        if (!item || typeof who.gainItem !== "function") return;
        const left = who.gainItem(item, qty, stack.spoilLeft, extras);
        if (left > 0 && typeof DroppedItem !== "undefined") {
            DroppedItem.spawn(this, who.x, who.y, item, left, undefined, extras || undefined);
        }
    },

    _refundCraftJob(who, job) {
        for (const piece of job?.paid?.refund || []) this._refundCraftPiece(who, piece);
    },

    /** Give back every queued craft's ingredients and clear the queue. */
    _refundOpenCraftQueue() {
        const jobs = this._craftQueue ? this._craftQueue.slice() : [];
        const ch = this.player?._craftChannel;
        if (ch?.fromQueue) {
            this.player._craftChannel = null;
            this.player._hideChannelBar?.();
        }
        this._craftQueue = [];
        this._craftQueueLive = false;
        this._craftReserveAsks = [];
        if (this.simAuth?.()) {
            if (jobs.length) this._sendCraftAction({ op: "refund" });
        } else if (this.player) {
            for (const job of jobs) this._refundCraftJob(this.player, job);
        }
        if (this.hotbar) this.hotbar.dirty = true;
        this._layoutCraftQueue?.();
        this.refreshCraftMenu?.();
        this.refreshTooltip?.();
    },

    /** The craft at the head cannot start. Return its ingredients. */
    _dropCraftQueueHead() {
        const q = this._craftQueue;
        if (!q?.length) return;
        const job = q[0];
        if (this.simAuth?.()) {
            if (!job?.taken) return;
            q.shift();
            this._sendCraftAction({ op: "refund", count: 1 });
        } else {
            q.shift();
            this._refundCraftJob(this.player, job);
        }
        if (this.hotbar) this.hotbar.dirty = true;
        this._layoutCraftQueue?.();
        this.refreshCraftMenu?.();
        this.refreshTooltip?.();
    },

    /** Server accepted some of the reserves just sent. Drop the rest. */
    _onCraftReserve(accepted) {
        const asks = this._craftReserveAsks;
        if (!asks?.length) return;
        const asked = asks.shift();
        let got = Math.max(0, Math.floor(Number(accepted) || 0));
        const q = this._craftQueue || [];
        let takenBefore = 0;
        for (let i = 0; i < q.length; i++) if (q[i]?.taken) takenBefore++;
        let seen = 0;
        let acceptedIndex = 0;
        const voidOffsets = [];
        const next = [];
        for (let i = 0; i < q.length; i++) {
            const job = q[i];
            if (job.taken || seen >= asked) {
                next.push(job);
                continue;
            }
            seen++;
            if (!(got > 0)) continue;
            got--;
            if (job.void) {
                voidOffsets.push(acceptedIndex);
                acceptedIndex++;
                continue;
            }
            job.taken = true;
            acceptedIndex++;
            next.push(job);
        }
        this._craftQueue = next;
        if (voidOffsets.length && this.simAuth?.()) {
            const indexes = voidOffsets.map((off) => takenBefore + off);
            indexes.sort((a, b) => b - a);
            const ranges = [];
            for (let i = 0; i < indexes.length; i++) {
                const server = indexes[i];
                const prev = ranges[ranges.length - 1];
                if (prev && server + prev.count === prev.index) {
                    prev.index = server;
                    prev.count += 1;
                } else {
                    ranges.push({ index: server, count: 1 });
                }
            }
            for (let i = 0; i < ranges.length; i++) {
                this._sendCraftAction({
                    op: "refund",
                    index: ranges[i].index,
                    count: ranges[i].count
                });
            }
        }
        this._pumpCraftQueue?.();
        this._layoutCraftQueue?.();
        this.refreshCraftMenu?.();
        this.refreshTooltip?.();
    },

    _craftHoldsForSave() {
        if (Array.isArray(this._lastYou?.craftHolds)) {
            try { return JSON.parse(JSON.stringify(this._lastYou.craftHolds)); }
            catch (_) { return []; }
        }
        const out = [];
        for (const job of this._craftQueue || []) {
            if (!job?.paid) continue;
            try { out.push(JSON.parse(JSON.stringify(job.paid))); }
            catch (_) {}
        }
        return out;
    },

    _finishCraft(recipe, pawn, count = 1, opts = null) {
        const who = pawn || this.player;
        const fromQueue = !!opts?.fromQueue;
        // A queued craft spent its ingredients when it was added.
        if (!fromQueue && !this.canCraft(recipe, who)) return;
        // Dedicated MP: server consumes ingredients + grants/drops; YOU/snapshots update UI.
        // Do not mutate locally — that fought deferred YOU sync and spawned ghost ground piles.
        if (this.simAuth()) {
            let n = fromQueue ? 1 : Math.floor(Number(count));
            if (!Number.isFinite(n) || n < 1) n = 1;
            n = Math.min(999, n);
            const fields = { id: recipe.id, count: n };
            if (fromQueue) fields.op = "finish";
            this._sendCraftAction(fields);
            return;
        }
        const preview = fromQueue
            ? (this._craftQueue?.[0]?.paid || null)
            : this._craftPayPreview(recipe, who);
        if (!fromQueue) this._takeCraftIngredients(recipe, who, null);
        this._consumeCraftTool(recipe, who);
        this._grantCraftedItem(recipe, who, preview);
    },

    _grantCraftedItem(recipe, who, preview) {
        const item = this.getItem(recipe.id);
        const tipQuality = preview?.tipQuality || null;
        const tipMaterial = preview?.tipMaterial || null;
        const tipStone = preview?.tipStone || null;

        if (recipe.id === "stone_spear" || recipe.id === "flint_spear" || recipe.id === "arrow") {
            const stack = makeItemStack(item, recipe.quantity || 1, undefined, this.worldMinuteIndex());
            stack.knapMaterial = tipMaterial || "pebble";
            if (tipQuality) stack.knapQuality = tipQuality;
            if (tipStone) stack.stone = tipStone;
            const extras = { knapMaterial: stack.knapMaterial };
            if (stack.knapQuality) extras.knapQuality = stack.knapQuality;
            if (stack.stone) extras.stone = stack.stone;
            if (recipe.id === "arrow" && typeof who.gainItem === "function") {
                const left = who.gainItem(item, stack.quantity, undefined, extras);
                if (!(left > 0)) return;
                DroppedItem.spawn(this, who.x, who.y, item, left, undefined, extras);
                return;
            }
            if (typeof who.gainStack === "function" && who.gainStack(stack)) {
                return;
            }
            DroppedItem.spawn(
                this, who.x, who.y, item, recipe.quantity || 1,
                undefined, extras
            );
            return;
        }

        if (item?.quality) {
            let grade = "crude";
            if (typeof Skills !== "undefined" && Skills.knapQuality) {
                const lv = Skills.pawnLevel?.(who, "crafting")
                    ?? Skills.effectiveLevel?.(who?.bio, "crafting");
                const offset = Skills.traitStat?.(who?.bio, "craftingQuality") || 0;
                if (lv != null) grade = Skills.knapQuality(lv, Math.random, offset) || "crude";
            }
            const stack = makeItemStack(item, 1, undefined, this.worldMinuteIndex());
            stack.knapQuality = grade;
            if (typeof who.gainStack === "function" && who.gainStack(stack)) return;
            DroppedItem.spawn(this, who.x, who.y, item, 1, undefined, { knapQuality: grade });
            return;
        }

        if (recipe.id === "grindstone" || recipe.id === "painting_circle") {
            const stone = preview?.pebbleStone || "andesite";
            const stack = makeItemStack(item, recipe.quantity || 1, undefined, this.worldMinuteIndex());
            stack.stone = stone;
            const extras = { stone };
            if (typeof who.gainStack === "function" && who.gainStack(stack)) return;
            DroppedItem.spawn(this, who.x, who.y, item, recipe.quantity || 1, undefined, extras);
            return;
        }

        const remaining = who.gainItem(item, recipe.quantity);
        if (remaining > 0) DroppedItem.spawn(this, who.x, who.y, item, remaining);
    },

    _rockInReach(thing) {
        const p = this.player;
        if (!p || !thing) return false;
        const r = (this.tileSize || 16) * (p.interactionRange || 4);
        const dx = (thing.x || 0) - (p.x || 0);
        const dy = (thing.y || 0) - (p.y || 0);
        return dx * dx + dy * dy <= r * r;
    },

    _rockManageable(thing) {
        if (!thing || thing.meta?.id !== "rock") return false;
        if (!this.settlementSys?.canManageThing?.(thing)) return false;
        return this._rockInReach(thing);
    },

    _hideRockChrome() {
        for (const key of ["_rockSettleUi", "_rockBillUi"]) {
            const ui = this[key];
            if (!ui) continue;
            // Rejoin reuses this scene. Shutdown destroys the buttons and leaves
            // these refs on dead objects; disableInteractive then reads scene.sys.
            if (!this._worldUiLive(ui)) {
                this._discardWorldUi(key);
                continue;
            }
            ui.btn.setVisible(false);
            if (ui.rect.input?.enabled) ui.rect.disableInteractive();
        }
    },

    _closeRockStation() {
        const thing = this._rockStationThing;
        if (this.billsPanel?.visible && thing && this.billsPanel.thing === thing) {
            this.billsPanel.close();
        }
        this._rockStationThing = null;
        this._hideRockChrome();
    },

    _openRockStation(thing) {
        if (!thing) return;
        this.closeOtherWorldMenus?.("rock", thing);
        if (this.billsPanel?.visible && this.billsPanel.thing !== thing) this.billsPanel.close();
        this._rockStationThing = thing;
        this._layoutRockStation();
    },

    _updateRockStation() {
        const thing = this._rockStationThing;
        if (!thing?.active || !this._rockManageable(thing)) {
            if (thing) this._closeRockStation();
            else this._hideRockChrome();
            return;
        }
        this._layoutRockStation();
    },

    pointerOnRockAdd(pointer) {
        const ui = this._rockSettleUi;
        if (!ui?.btn?.visible || !ui.rect || !pointer) return false;
        const pt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(ui.rect.getBounds(), pt.x, pt.y);
    },

    pointerOnRockBills(pointer) {
        const ui = this._rockBillUi;
        if (!ui?.btn?.visible || !ui.rect || !pointer) return false;
        const pt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(ui.rect.getBounds(), pt.x, pt.y);
    },

    _layoutRockStation() {
        const rock = this._rockStationThing;
        const sys = this.settlementSys;
        const s = this.uiScale || 1;
        const zoom = this.worldZoom || 1;
        const ws = s / zoom;
        const bh = 28 * ws;
        const gap = 8 * ws;
        const show = !!(rock && sys && this._rockManageable(rock));
        if (!show) {
            this._hideRockChrome();
            return;
        }
        if (this._rockSettleUi && !this._worldUiLive(this._rockSettleUi)) {
            this._discardWorldUi("_rockSettleUi");
        }
        if (!this._rockSettleUi) {
            this._rockSettleUi = sys.makeStationButton(() => {
                const thing = this._rockStationThing;
                if (!thing) return;
                sys.toggleStation(thing);
                this._layoutRockStation();
            });
            this._placeCraftWorldBtn(this._rockSettleUi.btn);
        }
        const ui = this._rockSettleUi;
        const x = rock.x || 0;
        const y = worldUiButtonY(this, rock.y || 0, bh);
        ui.setSize(bh);
        sys.syncStationButton(ui, rock);
        sys.placeAddActionRow(ui, null, {
            x, y, gap, addW: bh, actionW: 0, addOn: true, actionOn: false
        });
        if (this._rockBillUi && !this._worldUiLive(this._rockBillUi)) {
            this._discardWorldUi("_rockBillUi");
        }
        const added = !!sys.isAdded(rock);
        if (!added) {
            this._rockBillUi?.btn?.setVisible?.(false);
            this._rockBillUi?.rect?.disableInteractive?.();
            return;
        }
        if (!this._rockBillUi) {
            this._rockBillUi = sys.makeWorldButton("Bills", () => {
                if (this._rockStationThing) sys.openBills?.(this._rockStationThing);
            });
            this._placeCraftWorldBtn(this._rockBillUi.btn);
        }
        const bills = this._rockBillUi;
        const bw = 78 * ws;
        bills.btn.setVisible(true);
        bills.rect.setSize(bw, bh);
        bills.rect.setInteractive({ useHandCursor: true });
        if (bills.rect.input?.hitArea?.setTo) bills.rect.input.hitArea.setTo(0, 0, bw, bh);
        else if (bills.rect.input?.hitArea?.setSize) bills.rect.input.hitArea.setSize(bw, bh);
        if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(bills.text, 14, this);
        bills.paint?.();
        bills.btn.setPosition(x, y + bh + gap);
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
