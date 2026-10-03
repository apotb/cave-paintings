/**
 * SceneMain prototype methods (craft).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainCraft = {

    formatItemTooltip(item, quantity, spoilAt, stack = null, opts = null) {
        const lines = [];
        const displayName = stack?.customName || item.name;
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

        // Tip / tipped-spear quality on line 2 (knives still bake quality into the name)
        if (
            stack?.knapQuality
            && (stack.toolClass === "spear_tip" || !stack.toolClass)
        ) {
            const q = String(stack.knapQuality);
            lines.push(q.charAt(0).toUpperCase() + q.slice(1));
        }

        // Weight (stack.weight for dynamic meals; knapped tools use item def)
        const knapTool = !!(stack?.toolClass || stack?.knapMaterial);
        const weight = knapTool
            ? (item.weight ?? 0)
            : (stack?.weight != null ? stack.weight : item.weight);
        if (weight > 0) {
            lines.push(`Weight: ${weight} kg`);
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
            && stack?.knapQuality
            && item.weapon
            && typeof weaponMetaWithKnapQuality === "function"
        ) {
            weaponMetaForDps = weaponMetaWithKnapQuality(item, stack);
            weapon = weaponMetaForDps.weapon;
        }
        if (weapon) {
            const avg = typeof BodyCombat !== "undefined"
                ? BodyCombat.meleeWeaponAverageDps?.(weapon)
                : null;
            if (avg && avg.dps > 0) {
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
        if (stack?.toolClass === "knife") {
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

        return lines.join("\n");
    },

    createCraftMenu() {
        this.craftMenuVisible = false;
        this._craftStationThing = null;
        this._craftFromStation = false;
        this._craftPage = 0;
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
    },

    _craftMenuLayoutSig() {
        const s = this.uiScale || 1;
        const stationId = this._craftStationThing?.meta?.id || "";
        const nearby = stationId ? "" : (this.nearbyCraftStationIds() || []).join(",");
        const page = this._craftPage || 0;
        return `${stationId}|${nearby}|${page}|${s}`;
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
            return;
        }
        const keepRecipeId = this._craftHoverRecipeId();
        this._craftMenuRefreshing = true;
        if (this._hoverTarget?.parentContainer === this.craftContainer) this._hoverTarget = null;
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

            // Tooltip
            const tt = () => {
                const lines = [];
                lines.push(this.formatItemTooltip(this.getItem(recipe.id), recipe.quantity));
                lines.push('—');

                for (const ingredient of recipe.ingredients) {
                    const have = this._craftIngredientHave(ingredient);
                    lines.push(`${this._craftIngredientLabel(ingredient)}: ${have}/${ingredient.qty}`);
                }

                if (recipe.requireThing) {
                    const thing = this.getThing(recipe.requireThing);
                    lines.push(`Requires nearby ${thing?.name || recipe.requireThing}`);
                }
                if (recipe.requireStation) {
                    const thing = this.getThing(recipe.requireStation);
                    lines.push(`Requires ${thing?.name || recipe.requireStation}`);
                }
                if (recipe.requireTool && this._craftRequireToolLabel(recipe.requireTool)) {
                    lines.push(`Requires held ${this._craftRequireToolLabel(recipe.requireTool)}`);
                }

                return lines.join('\n');
            };

            slot.on('pointerover', (p) => this.showTooltip(tt, p.x, p.y, slot));
            slot.on('pointerout', () => {
                if (this._craftMenuRefreshing) return;
                if (this._tooltipTarget === slot) this.hideTooltip();
            });

            // Craft
            slot.on('pointerdown', ()  => {
                if (this.canCraft(recipe)) {
                    this.doCraft(recipe);
                    this.hotbar.dirty = true;
                    this.refreshTooltip();
                    this.refreshCraftMenu();
                } else {
                    const shake = 3 * ui;
                    const homes = [
                        [slot, x],
                        [icon, x + slotW / 2],
                        [quantity, x + slotW - 4 * ui]
                    ];
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
                }
            });

            this._data.push({ slot, icon, qty: quantity, recipe, tt });
        }

        this.positionCraftMenu();
        this._layoutCraftTakeButton();
        this._layoutCraftSettle();
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
        const clear = 2;
        const x = station.x || 0;
        const y = station.y + clear + bh / 2;
        ui.setSize(bh);
        sys.syncStationButton(ui, station);
        sys.placeAddActionRow(ui, this._craftTakeBtn, {
            x, y, gap, addW: bh, actionW: bw,
            addOn: !!ui.btn.visible,
            actionOn: !!this._craftTakeBtn?.visible
        });
        this._layoutCraftBills(station, x, y, bw, bh, gap);
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

    _craftRecipeIconKey(recipe) {
        const meta = this.getItem(recipe.id);
        if (typeof Place !== "undefined" && Place.itemIconKey) {
            const key = Place.itemIconKey(meta, (id) => this.getThing(id), (k) => this.textures.exists(k));
            if (key && this.textures.exists(key)) return key;
        }
        if (recipe.key && this.textures.exists(recipe.key)) return recipe.key;
        if (this.textures.exists("null")) return "null";
        return "slot";
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
            return;
        }
        const s = this.uiScale || 1;
        const zoom = this.worldZoom || 1;
        const ws = s / zoom;
        const bw = 78 * ws;
        const bh = 28 * ws;
        const clear = 2;
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
        btn.setPosition(station.x, station.y + clear + bh / 2);
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
            if (typeof Research !== "undefined" && Research.recipeUnlocked) {
                const holder = this._playerResearchHolder?.() || null;
                if (!Research.recipeUnlocked(m.id, holder)) return false;
            }
            return true;
        }).map((meta) => {
            const r = meta.recipe, ingredients = [];
            let requireThing = null, requireStation = null, quantity = 1;
            let craftSeconds = 0, requireTool = null;
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
                craftSeconds,
                requireTool
            };
        });
    },

    /** Display name for a craft ingredient (supports knapped tip / any-hide requirements). */
    _craftIngredientLabel(ingredient) {
        if (ingredient.hideStage) {
            const stage = String(ingredient.hideStage);
            if (stage === "leather") return "Any Leather";
            const label = stage.charAt(0).toUpperCase() + stage.slice(1);
            return `Any ${label} Hide`;
        }
        if (ingredient.toolClass === "spear_tip") {
            if (ingredient.id === "flint_tool") return "Flint Spear Tip";
            if (ingredient.id === "stone_tool") return "Stone Spear Tip";
        }
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
            if (!who._stackMatchesCraft(s, hideStage ? { hideStage } : { id, toolClass: wantClass })) continue;
            sum += Math.max(0, Math.floor(Number(s.quantity) || 0));
        }
        return sum;
    },

    _craftIngredientHave(ingredient, pawn) {
        const who = pawn || this.player;
        let n = who.getNumMatchingItems?.(ingredient) || 0;
        const store = this._openCraftStorage(who);
        if (store) n += this._countSlotsMatching(store.entry?.slots, ingredient, who);
        return n;
    },

    _loseStorageCraft(store, match, qty, who) {
        if (!store || !(qty > 0) || !who?._stackMatchesCraft) return 0;
        const slots = store.entry?.slots;
        if (!Array.isArray(slots)) return 0;
        let remaining = Math.max(0, Math.floor(Number(qty) || 0));
        const hideStage = match?.hideStage || null;
        const id = match?.id;
        const wantClass = match?.toolClass || null;
        const takeFrom = (requireClass) => {
            for (let i = 0; i < slots.length && remaining > 0; i++) {
                const s = slots[i];
                if (!who._stackMatchesCraft(s, hideStage ? { hideStage } : { id })) continue;
                if (requireClass && s.toolClass !== requireClass) continue;
                if (!requireClass && wantClass && s.toolClass === wantClass) continue;
                const have = Math.max(0, Math.floor(Number(s.quantity) || 0));
                const take = Math.min(have, remaining);
                if (!(take > 0)) continue;
                s.quantity = have - take;
                remaining -= take;
                if (!(s.quantity > 0)) store.setSlot(i, null);
                else store.setSlot(i, s);
            }
        };
        if (hideStage) takeFrom(null);
        else if (wantClass) takeFrom(wantClass);
        else takeFrom(null);
        return Math.max(0, Math.floor(Number(qty) || 0) - remaining);
    },

    canCraft(recipe, pawn) {
        const who = pawn || this.player;
        if (!recipe.ingredients.every(
            (ingredient) => this._craftIngredientHave(ingredient, who) >= ingredient.qty
        )) {
            return false;
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

    doCraft(recipe) {
        if (recipe.craftSeconds > 0) {
            let station = null;
            if (recipe.requireStation) {
                station = this._findNearbyCraftStation(recipe.requireStation) || this._craftStationThing;
            } else if (recipe.requireThing) {
                station = this._findNearbyThing(recipe.requireThing);
            }
            this.player.beginCraft?.(recipe, station);
            return;
        }
        this._finishCraft(recipe);
    },

    _finishCraft(recipe, pawn) {
        const who = pawn || this.player;
        if (!this.canCraft(recipe, who)) return;
        // Dedicated MP: server consumes ingredients + grants/drops; YOU/snapshots update UI.
        // Do not mutate locally — that fought deferred YOU sync and spawned ghost ground piles.
        if (this.simAuth()) {
            this._netSendMove?.(true);
            const store = this._openCraftStorage(who);
            this.net.sendAction({
                type: NetProtocol.Actions.CRAFT,
                id: recipe.id,
                pawnId: who?.pawnId,
                storageUid: store?.entry?.uid || null
            });
            return;
        }
        const item = this.getItem(recipe.id);
        const store = this._openCraftStorage(who);
        // Tipped spears inherit quality from the leftmost matching tip in the hotbar
        let tipQuality = null;
        const tipIng = recipe.ingredients?.find((i) => i.toolClass === "spear_tip");
        if (tipIng) {
            for (const stack of who.inventory) {
                if (!stack || stack.id !== tipIng.id) continue;
                if (stack.toolClass !== tipIng.toolClass) continue;
                tipQuality = stack.knapQuality || null;
                break;
            }
        }
        for (const ing of recipe.ingredients) {
            const need = Math.max(0, Number(ing.qty) || 1);
            const fromInv = who.loseMatchingItems(ing);
            const left = Math.max(0, need - fromInv);
            if (left > 0) this._loseStorageCraft(store, ing, left, who);
        }

        this._consumeCraftTool(recipe, who);

        if (tipQuality && (recipe.id === "stone_spear" || recipe.id === "flint_spear")) {
            const stack = makeItemStack(item, recipe.quantity || 1, undefined, this.worldMinuteIndex());
            stack.knapQuality = tipQuality;
            if (typeof who.gainStack === "function" && who.gainStack(stack)) {
                return;
            }
            DroppedItem.spawn(
                this, who.x, who.y, item, recipe.quantity || 1,
                undefined, { knapQuality: tipQuality }
            );
            return;
        }

        const remaining = who.gainItem(item, recipe.quantity);
        if (remaining > 0) DroppedItem.spawn(this, who.x, who.y, item, remaining);
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
