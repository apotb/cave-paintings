/**
 * SceneMain prototype methods (tooltip).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainTooltip = {

    createTooltip() {
        this._tooltipPadding = 6;

        this.tooltip = this.add.container(0, 0).setDepth(40000).setVisible(false).setAlpha(1);
        this.tooltipBg = this.add.graphics().setAlpha(1);
        this.tooltipText = crispUiText(this.add.text(0, 0, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(16, 1)}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 2,
            padding: { left: this._tooltipPadding, right: this._tooltipPadding, top: this._tooltipPadding, bottom: this._tooltipPadding }
        }));
        this.tooltipHunger = this.add.graphics().setVisible(false);
        this.tooltipSub = crispUiText(this.add.text(0, 0, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(16, 1)}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 2,
            padding: { left: this._tooltipPadding, right: this._tooltipPadding, top: this._tooltipPadding, bottom: this._tooltipPadding }
        })).setVisible(false);
        this.tooltipGear = this.add.container(0, 0);
        this.tooltip.add([
            this.tooltipBg, this.tooltipText, this.tooltipHunger, this.tooltipSub, this.tooltipGear
        ]);
        this.tooltip.clearMask?.(true);
        (this.tooltipLayer || this.uiLayer).add(this.tooltip);

        this._tooltipSource = null;
        this._tooltipTarget = null;
        this._hoverTarget = null;
        this._tooltipGearSig = null;
        this._tooltipGearW = 0;
        this._tooltipGearH = 0;
        this._tooltipHungerSig = "";
        this._tooltipHungerW = 0;
        this._tooltipHungerH = 0;
        this._tooltipBoxW = 0;
        this._tooltipBoxH = 0;
        this._tooltipDrawn = false;

        /** True for hotbar/save/bars/panels — combat may still show these tooltips. */
        this._isUiTooltipTarget = (obj) => {
            if (!obj) return false;
            const seen = new Set();
            let cur = obj;
            while (cur && !seen.has(cur)) {
                seen.add(cur);
                if (
                    cur === this.uiLayer ||
                    cur === this.craft ||
                    cur === this.healthBtn ||
                    cur === this.equipmentBtn ||
                    cur === this.help ||
                    cur === this.craftContainer ||
                    cur === this.equipmentPanel?.container ||
                    cur === this.healthPanel?.root ||
                    cur === this.knappingPanel?.container ||
                    cur === this.knappingPanel?.helpBtn ||
                    cur === this.clayFormingPanel?.container ||
                    cur === this.clayFormingPanel?.helpBtn ||
                    cur === this.clayFormingPanel?.saveBtn ||
                    cur === this.clayFormingPanel?.loadBtn ||
                    cur === this.deathOverlay ||
                    cur === this.partyPanel?.root ||
                    cur === this.settlementPanel?.root ||
                    cur === this.researchTreePanel?.root ||
                    cur === this.billsPanel?.root ||
                    cur === this.storageFilterPanel?.root ||
                    cur === this.fuelFilterPanel?.root ||
                    cur === this.pigmentFilterPanel?.root ||
                    cur === this.storagePanel?.container ||
                    cur === this.campfirePanel?.container ||
                    cur === this.paintingCirclePanel?.container ||
                    cur === this.painBarZone ||
                    cur === this.kcBarZone ||
                    cur === this.weightBarZone ||
                    this.hotbar?.slots?.includes(cur) ||
                    this.hotbar?.overflowSlots?.includes(cur)
                ) {
                    return true;
                }
                if (cur.parentContainer) {
                    cur = cur.parentContainer;
                    continue;
                }
                // Phaser Layer children use displayList, not parentContainer
                if (cur.displayList && cur.displayList !== cur) {
                    cur = cur.displayList;
                    continue;
                }
                break;
            }
            return false;
        };

        /** Tip text depends on pointer pose (bunk slot, storage hover) — refresh without a new over-event. */
        this._tooltipFollowsPointer = (obj) => {
            if (!obj) return false;
            if (obj._settlePersonTip) return true;
            if (typeof LeanTo !== "undefined" && obj instanceof LeanTo) return true;
            if (typeof Storage !== "undefined" && obj instanceof Storage) return true;
            if (obj === this.player && this.partySys?.selfHeldActionTooltip?.(obj)) return true;
            if (this._isHoverPawn(obj) || obj.role === "settler") return true;
            return false;
        };

        /** Traveling companions we keep hovered over trees so work anims don't strobe the tip. */
        this._isHoverPawn = (obj) => {
            if (!obj?.active || obj._resting) return false;
            if (obj === this.player) return false;
            if (obj.role === "settler") return false;
            const role = obj.role;
            if (role === "companion" || role === "leader" || role === "wanderer") {
                return true;
            }
            if ((this.party || []).includes(obj)) return true;
            return false;
        };

        this._pointerOnCreature = (pointer, sprite) => {
            if (!pointer || !sprite?.active) return false;
            const wpt = this.cameras?.main?.getWorldPoint?.(pointer.x, pointer.y);
            if (!wpt) return false;
            if (typeof creaturePointerHit === "function") {
                return creaturePointerHit(sprite, wpt.x, wpt.y);
            }
            const body = 16;
            const sx = Number(sprite.x) || 0;
            const sy = Number(sprite.y) || 0;
            return wpt.x >= sx && wpt.x <= sx + body
                && wpt.y >= sy - body && wpt.y <= sy;
        };

        this.hideWorldTooltip = () => {
            if (this._tooltipTarget && this._isUiTooltipTarget(this._tooltipTarget)) return;
            this.hideTooltip();
        };

        this.showTooltip = (textOrFn, x, y, target=null) => {
            // Combat / name-camp overlay suppress world (thing/mob/drop) tooltips, not side UI
            if (
                (this.player?.blocksTooltips?.() || isHudTextOpen(this))
                && !this._isUiTooltipTarget(target)
            ) return;
            // Native Phaser over-events still fire on the work object (tree, bush,
            // campfire) while a pawn is under the cursor. Don't let those steal the tip.
            if (
                target
                && target !== this._hoverTarget
                && !this._isUiTooltipTarget(target)
                && this._isHoverPawn(this._hoverTarget)
                && this._pointerOnCreature(this.input?.activePointer, this._hoverTarget)
            ) return;
            this._tooltipSource = (typeof textOrFn === "function") ? textOrFn : () => textOrFn;
            this._tooltipTarget = target;
            const shown = this._applyTooltipPayload();
            this.tooltip.setAlpha(1);
            this.tooltip.setVisible(shown);
            // Keep tooltip above every UI sibling (knapping help used to bringToTop itself)
            const tipLayer = this.tooltipLayer || this.uiLayer;
            tipLayer?.bringToTop?.(this.tooltip);
            this.positionTooltip(x, y);
            if (typeof ClayForming !== "undefined") ClayForming.syncHudTooltip(this);
        };

        this.refreshTooltip = () => {
            // Keep source when text is empty so hotbar swaps can re-show (e.g. rock knap tip)
            if (!this._tooltipSource) return;
            const target = this._tooltipTarget;
            if (target && (target.scene == null || target.active === false)) {
                this.hideWorldTooltip();
                return;
            }
            const shown = this._applyTooltipPayload();
            this.tooltip.setVisible(shown);
            if (typeof ClayForming !== "undefined") ClayForming.syncHudTooltip(this);
        };

        this.hideTooltip = () => {
            this._tooltipSource = null;
            this._tooltipTarget = null;
            this._tooltipDrawn = false;
            this._clearTooltipGear();
            this._syncTooltipHunger(null, "");
            this.tooltipSub?.setText("");
            this.tooltipSub?.setVisible(false);
            this.tooltip.setVisible(false);
            this.tooltip.setAlpha(1);
            if (typeof ClayForming !== "undefined") ClayForming.hideHudTooltip();
        };

        this._pickHoverTarget = (pointer) => {
            const hits = this.input.hitTestPointer(pointer);

            // Knapping modal blocks world behind it (help uses pixel hit like main HUD)
            const knap = this.knappingPanel;
            if (knap?.visible && knap.backdrop) {
                const overKnap = Phaser.Geom.Rectangle.Contains(
                    knap.backdrop.getBounds(), pointer.x, pointer.y
                );
                if (overKnap) {
                    for (let i = hits.length - 1; i >= 0; i--) {
                        const obj = hits[i];
                        if (!obj?.active || !obj.input?.enabled) continue;
                        if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                        if (this._isUnderKnappingPanel(obj)) return obj;
                    }
                    return knap.backdrop;
                }
            }
            const form = this.clayFormingPanel;
            if (form?.visible && form.backdrop) {
                const overForm = Phaser.Geom.Rectangle.Contains(
                    form.backdrop.getBounds(), pointer.x, pointer.y
                );
                if (overForm) {
                    for (let i = hits.length - 1; i >= 0; i--) {
                        const obj = hits[i];
                        if (!obj?.active || !obj.input?.enabled) continue;
                        if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                        if (this._isUnderFormingPanel(obj)) return obj;
                    }
                    return form.backdrop;
                }
            }

            // Health panel blocks world/UI behind it
            const health = this.healthPanel;
            if (health?.visible && health.bg) {
                const overHealth = Phaser.Geom.Rectangle.Contains(
                    health.bg.getBounds(), pointer.x, pointer.y
                );
                if (overHealth) {
                    for (let i = hits.length - 1; i >= 0; i--) {
                        const obj = hits[i];
                        if (!obj?.active || !obj.input?.enabled) continue;
                        if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                        if (this._isUnderHealthPanel(obj)) return obj;
                    }
                    return health.bg;
                }
            }

            // Centered overlays sit above the left settlement panel (depth 15150 > 15100).
            // Check them first or the overlapping left strip fights the cursor and eats clicks.
            const researchP = this.researchTreePanel;
            if (researchP?.visible && researchP.containsPointer?.(pointer)) {
                const row = researchP.hoverObjAt?.(pointer);
                if (row) return row;
                return researchP.frame || researchP.dim;
            }

            const billsP = this.billsPanel;
            if (billsP?.visible && billsP.containsPointer?.(pointer)) {
                return this._pickMaskedPanelHover(
                    pointer, hits, billsP.bg,
                    (obj) => this._isUnderBillsPanel(obj)
                );
            }

            const storageFP = this.storageFilterPanel;
            if (storageFP?.visible && storageFP.containsPointer?.(pointer)) {
                const row = storageFP.hoverObjAt?.(pointer);
                if (row) return row;
                return this._pickMaskedPanelHover(
                    pointer, hits, storageFP.bg,
                    (obj) => this._isUnderStorageFilterPanel(obj)
                );
            }

            const fuelFP = this.fuelFilterPanel;
            if (fuelFP?.visible && fuelFP.containsPointer?.(pointer)) {
                const row = fuelFP.hoverObjAt?.(pointer);
                if (row) return row;
                return this._pickMaskedPanelHover(
                    pointer, hits, fuelFP.bg,
                    (obj) => this._isUnderFuelFilterPanel(obj)
                );
            }

            const paintFP = this.pigmentFilterPanel;
            if (paintFP?.visible && paintFP.containsPointer?.(pointer)) {
                const row = paintFP.hoverObjAt?.(pointer);
                if (row) return row;
                return this._pickMaskedPanelHover(
                    pointer, hits, paintFP.bg,
                    (obj) => this._isUnderPigmentFilterPanel(obj)
                );
            }

            const settleP = this.settlementPanel;
            if (settleP?.visible && settleP.containsPointer?.(pointer)) {
                const row = settleP.hoverObjAt?.(pointer);
                if (row) return row;
                return this._pickMaskedPanelHover(
                    pointer, hits, settleP.bg,
                    (obj) => this._isUnderSettlementPanel(obj)
                );
            }

            // Corpse loot panel (world-space). Slots keep their tips; the body
            // underneath must stay the hover target so a second click still
            // reads "(corpse)" and toggles the menu shut.
            const corpseP = this.corpsePanel;
            if (corpseP?.visible && corpseP.bg) {
                const wpt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                const overPanel = Phaser.Geom.Rectangle.Contains(
                    corpseP.bg.getBounds(), wpt.x, wpt.y
                );
                const body = corpseP.corpse;
                const bodyBounds = body?.active ? body.getBounds?.() : null;
                const overBody = !!(bodyBounds && Phaser.Geom.Rectangle.Contains(
                    bodyBounds, wpt.x, wpt.y
                ));
                if (overPanel || overBody) {
                    if (overPanel) {
                        for (let i = hits.length - 1; i >= 0; i--) {
                            const obj = hits[i];
                            if (!obj?.active || !obj.input?.enabled) continue;
                            if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                            if (obj === corpseP.bg) continue;
                            if (this._isUnderCorpsePanel(obj)) return obj;
                        }
                    }
                    if (overBody) return body;
                    return corpseP.bg;
                }
            }

            // Campfire panel (world-space): only slots steal hits — the hole over the
            // fire must stay clickable so toggle-close still works.
            const campP = this.campfirePanel;
            if (campP?.visible && campP.containsPointer?.(pointer)) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                    if (this._isUnderCampfirePanel(obj)) return obj;
                }
                if (campP.pointerOnDestroy?.(pointer)) return campP.destroyRect;
                if (this._pointerOnWorldBtn?.(campP._settleUi, pointer)) return campP._settleUi.rect;
                if (this._pointerOnWorldBtn?.(campP._billUi, pointer)) return campP._billUi.rect;
                if (this._pointerOnWorldBtn?.(campP._fuelUi, pointer)) return campP._fuelUi.rect;
                const campSlot = this._worldPanelSlotAt?.(campP, pointer);
                if (campSlot) return campSlot;
                const keepCamp = this._tooltipTarget || this._hoverTarget;
                if (keepCamp?.active && this._isUnderCampfirePanel(keepCamp)) return keepCamp;
                return null;
            }

            const storeP = this.storagePanel;
            if (storeP?.visible && storeP.containsPointer?.(pointer)) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                    if (this._isUnderStoragePanel(obj)) return obj;
                }
                if (storeP.pointerOnTake?.(pointer)) return storeP.takeRect;
                if (this._pointerOnWorldBtn?.(storeP._settleUi, pointer)) return storeP._settleUi.rect;
                if (this._pointerOnWorldBtn?.(storeP._billUi, pointer)) return storeP._billUi.rect;
                const storeSlot = this._worldPanelSlotAt?.(storeP, pointer);
                if (storeSlot) return storeSlot;
                const keepStore = this._tooltipTarget || this._hoverTarget;
                if (keepStore?.active && this._isUnderStoragePanel(keepStore)) return keepStore;
                return null;
            }

            const leanP = this.leanToPanel;
            if (leanP?.visible && leanP.containsPointer?.(pointer)) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                    if (this._isUnderLeanToPanel(obj)) return obj;
                }
                if (leanP._pointerOnRect?.(leanP.destroyRect, leanP.destroyBtn, pointer)) {
                    return leanP.destroyRect;
                }
                return leanP.actionRect;
            }

            const paintP = this.paintingCirclePanel;
            if (paintP?.visible && paintP.containsPointer?.(pointer)) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                    if (this._isUnderPaintingCirclePanel(obj)) return obj;
                }
                if (this._pointerOnWorldBtn?.(paintP._enableUi, pointer)) return paintP._enableUi.rect;
                if (this._pointerOnWorldBtn?.(paintP._matUi, pointer)) return paintP._matUi.rect;
                if (this._pointerOnWorldBtn?.(paintP._removeUi, pointer)) return paintP._removeUi.rect;
                const keepPaint = this._tooltipTarget || this._hoverTarget;
                if (keepPaint?.active && this._isUnderPaintingCirclePanel(keepPaint)) return keepPaint;
                return null;
            }

            if (this.pointerOnCraftTake?.(pointer) || this.pointerOnCraftSettle?.(pointer)
                || this.pointerOnCraftBills?.(pointer)) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                    if (this._isUnderCraftTake(obj) || this._isUnderCraftMenu(obj)) return obj;
                }
                const craftSlot = this._craftSlotAtPointer?.(pointer);
                if (craftSlot) return craftSlot;
                if (this.pointerOnCraftBills?.(pointer)) return this._craftBillUi?.rect;
                if (this.pointerOnCraftSettle?.(pointer)) return this._craftSettleUi?.rect;
                if (this.pointerOnCraftTake?.(pointer)) return this._craftTakeRect;
                const keepCraft = this._tooltipTarget || this._hoverTarget;
                if (keepCraft?.active && this._isUnderCraftMenu?.(keepCraft)) return keepCraft;
                return null;
            }

            // Equipment panel body blocks world/UI behind it
            const panel = this.equipmentPanel;
            if (panel?.visible && panel.body) {
                const overPanel = Phaser.Geom.Rectangle.Contains(
                    panel.body.getBounds(), pointer.x, pointer.y
                );
                if (overPanel) {
                    for (let i = hits.length - 1; i >= 0; i--) {
                        const obj = hits[i];
                        if (!obj?.active || !obj.input?.enabled) continue;
                        if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                        if (this._isUnderEquipmentPanel(obj)) return obj;
                    }
                    return panel.body;
                }
            }

            // HUD / screen-space UI always beats world sprites (lean-to AABB, etc.)
            for (let i = hits.length - 1; i >= 0; i--) {
                const obj = hits[i];
                if (!obj?.active || !obj.input?.enabled) continue;
                if (!this._objectShown?.(obj)) continue;
                if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                if (this._isUiTooltipTarget(obj)) return obj;
            }

            const switchAlly = this.partySys?.worldSwitchTarget?.(pointer);

            // Empty lean-to bunks beat a sleeper's standing AABB (90°/270°),
            // but not a standing ally you're trying to click. The bunk you're in
            // is hoverable too (finger cursor / Rest tip) unless the pointer is
            // on HUD chrome that the big AABB would steal.
            if (!switchAlly) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (!(obj instanceof LeanTo)) continue;
                    if (this._skipOwnRestLeanTo?.(obj, pointer)) continue;
                    const slot = obj.slotAtPointer?.(pointer) ?? 0;
                    const occ = obj.entry?.occupants?.[slot];
                    if (!occ || occ === this.player?.pawnId) return obj;
                }
            }

            const downedAlly = this.partySys?.downedAllyUnderPointer?.(pointer);
            if (downedAlly) return downedAlly;

            const me = this.player;
            if (
                me
                && this.partySys?.selfHeldActionTooltip?.(me)
                && this._pointerOnCreature(pointer, me)
            ) {
                return me;
            }

            // Standing companions beat trees under the cursor so chop/gather
            // animations don't flicker the tip. Parked settlers do not — baskets
            // and stations need to stay clickable while people work at them.
            const keepPawn = this._hoverTarget || this._tooltipTarget;
            if (this._isHoverPawn(keepPawn) && this._pointerOnCreature(pointer, keepPawn)) {
                return keepPawn;
            }
            if (switchAlly && switchAlly.role !== "settler") return switchAlly;

            for (let i = hits.length - 1; i >= 0; i--) {
                const obj = hits[i];
                if (!obj?.active || !obj.input?.enabled) continue;
                if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                if (this._skipOwnRestLeanTo?.(obj, pointer)) continue;
                if (obj.role === "settler" && obj.homeSettlementId) continue;
                // Dead party sprites stay click-through for loot; downed allies
                // must still hover so the name / "Downed" tip can show.
                if (
                    this.party?.includes(obj)
                    && (obj.isBodyDead?.() || obj._bodyDead || obj._resting)
                ) continue;
                return obj;
            }
            for (const p of this.settlers || []) {
                if (!p?.active || p._resting || p.isBodyDead?.()) continue;
                if (this._pointerOnCreature(pointer, p)) return p;
            }
            return null;
        };

        this._isUnderKnappingPanel = (obj) => {
            const panel = this.knappingPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (
                    cur === panel.container
                    || cur === panel.backdrop
                    || cur === panel.helpBtn
                    || cur === panel.gridHit
                    || cur === panel.btnRotate?.label
                    || cur === panel.btnFinish?.label
                ) {
                    return true;
                }
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderFormingPanel = (obj) => {
            const panel = this.clayFormingPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (
                    cur === panel.container
                    || cur === panel.backdrop
                    || cur === panel.helpBtn
                    || cur === panel.saveBtn
                    || cur === panel.loadBtn
                    || cur === panel.btnAdd?.label
                    || cur === panel.btnMove?.label
                    || cur === panel.btnDelete?.label
                    || cur === panel.btnRotate?.label
                    || cur === panel.btnUndo?.label
                    || cur === panel.btnMore?.label
                    || cur === panel.btnFinish?.label
                ) {
                    return true;
                }
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderHealthPanel = (obj) => {
            const panel = this.healthPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.root || cur === panel.bg) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        // Masked panel rows often drop out of hitTestPointer. Prefer a child
        // over the chrome bg, and keep the current hover if the cursor is
        // still inside it — otherwise each hover-scan pointerouts the tip.
        this._pointerInObj = (pointer, obj) => {
            const b = obj?.getBounds?.();
            return !!(pointer && b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y));
        };
        this._pickMaskedPanelHover = (pointer, hits, bg, isUnder) => {
            for (let i = hits.length - 1; i >= 0; i--) {
                const obj = hits[i];
                if (!obj?.active || !obj.input?.enabled) continue;
                if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                if (obj === bg) continue;
                if (isUnder(obj)) return obj;
            }
            const keep = this._tooltipTarget || this._hoverTarget;
            if (keep?.active && isUnder(keep) && this._pointerInObj(pointer, keep)) return keep;
            return bg;
        };

        this._isUnderSettlementPanel = (obj) => {
            const panel = this.settlementPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.root || cur === panel.bg || cur === panel.body) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderBillsPanel = (obj) => {
            const panel = this.billsPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.root || cur === panel.bg || cur === panel.body) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderStorageFilterPanel = (obj) => {
            const panel = this.storageFilterPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.root || cur === panel.bg || cur === panel.body) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderFuelFilterPanel = (obj) => {
            const panel = this.fuelFilterPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.root || cur === panel.bg || cur === panel.body) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderPigmentFilterPanel = (obj) => {
            const panel = this.pigmentFilterPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.root || cur === panel.bg || cur === panel.body) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderCorpsePanel = (obj) => {
            const panel = this.corpsePanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container || cur === panel.bg || cur === panel.slotsLayer) {
                    return true;
                }
                if (panel.slotViews?.some(v =>
                    v.slot === cur || v.icon === cur || v.fill === cur || v.qty === cur
                )) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderCampfirePanel = (obj) => {
            const panel = this.campfirePanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container || cur === panel.destroyBtn ||
                    cur === panel.destroyRect || cur === panel.destroyText) return true;
                if (cur === panel._settleUi?.btn || cur === panel._settleUi?.rect ||
                    cur === panel._settleUi?.icon) return true;
                if (cur === panel._billUi?.btn || cur === panel._billUi?.rect ||
                    cur === panel._billUi?.text) return true;
                if (cur === panel._fuelUi?.btn || cur === panel._fuelUi?.rect ||
                    cur === panel._fuelUi?.text) return true;
                if (panel.slotViews?.some(v =>
                    v.slot === cur || v.icon === cur || v.fill === cur || v.qty === cur
                )) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderStoragePanel = (obj) => {
            const panel = this.storagePanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container || cur === panel.takeBtn ||
                    cur === panel.takeRect || cur === panel.takeText) return true;
                if (cur === panel._settleUi?.btn || cur === panel._settleUi?.rect ||
                    cur === panel._settleUi?.icon) return true;
                if (cur === panel._billUi?.btn || cur === panel._billUi?.rect ||
                    cur === panel._billUi?.text) return true;
                if (panel.slotViews?.some(v =>
                    v.slot === cur || v.icon === cur || v.fill === cur || v.qty === cur
                )) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderLeanToPanel = (obj) => {
            const panel = this.leanToPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container || cur === panel.actionBtn ||
                    cur === panel.actionRect || cur === panel.actionText ||
                    cur === panel.destroyBtn || cur === panel.destroyRect ||
                    cur === panel.destroyText) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderPaintingCirclePanel = (obj) => {
            const panel = this.paintingCirclePanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container) return true;
                if (cur === panel._enableUi?.btn || cur === panel._enableUi?.rect ||
                    cur === panel._enableUi?.glyph) return true;
                if (cur === panel._matUi?.btn || cur === panel._matUi?.rect ||
                    cur === panel._matUi?.text) return true;
                if (cur === panel._removeUi?.btn || cur === panel._removeUi?.rect ||
                    cur === panel._removeUi?.text) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderCraftTake = (obj) => {
            let cur = obj;
            while (cur) {
                if (cur === this._craftTakeBtn || cur === this._craftTakeRect ||
                    cur === this._craftTakeText) return true;
                if (cur === this._craftSettleUi?.btn || cur === this._craftSettleUi?.rect ||
                    cur === this._craftSettleUi?.icon) return true;
                if (cur === this._craftBillUi?.btn || cur === this._craftBillUi?.rect ||
                    cur === this._craftBillUi?.text) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderCraftMenu = (obj) => {
            if (!obj) return false;
            let cur = obj;
            while (cur) {
                if (cur === this.craftContainer) return true;
                cur = cur.parentContainer;
            }
            return this._isUnderCraftTake(obj);
        };

        this._objectShown = (obj) => {
            if (!obj?.active) return false;
            let cur = obj;
            const seen = new Set();
            while (cur && !seen.has(cur)) {
                seen.add(cur);
                if (cur.visible === false) return false;
                if (cur === this.craftContainer && !this.craftMenuVisible) return false;
                cur = cur.parentContainer;
            }
            return true;
        };

        this._isUnderEquipmentPanel = (obj) => {
            const panel = this.equipmentPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container || cur === panel.body || cur === panel.slotsLayer) {
                    return true;
                }
                if (panel.slotViews?.some(v => v.slot === cur || v.icon === cur)) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._worldPanelSlotAt = (panel, pointer) => {
            if (!panel || !pointer) return null;
            const key = panel.getSlotAt?.(pointer.x, pointer.y);
            if (key == null) return null;
            const view = panel.slotViews?.find((v) => v.key === key);
            return view?.slot?.active ? view.slot : null;
        };

        this._cursorFor = (obj) => {
            if (this._isUnderStoragePanel?.(obj) || this._isUnderCampfirePanel?.(obj)
                || this._isUnderPaintingCirclePanel?.(obj)) {
                return "pointer";
            }
            if (!obj?.input) return 'default';
            // Rocks: hand cursor only when "Click to knap" tip would show
            if (obj.meta?.id === "rock") {
                return this._rockKnapTooltipText() ? "pointer" : "default";
            }
            if (obj.meta?.diggable?.item) {
                // Empty GO.cursor: Phaser setCursor would flash the arrow between deposits.
                obj.input.cursor = "";
                return this._heldHasDigPower() ? "pointer" : "default";
            }
            if (obj.input.cursor) return obj.input.cursor;
            if (obj.input.useHandCursor) return 'pointer';
            return 'default';
        };

        // Reconcile hover after camera/player movement (Phaser only updates on mouse move)
        this.syncPointerHover = () => {
            if (this._worldBooting || this._generatingUi) {
                this.input.setDefaultCursor("default");
                try {
                    if (this.game?.canvas) this.game.canvas.style.cursor = "default";
                } catch (_) {}
                return;
            }
            if (this._gamePaused) {
                this._syncPauseCursor();
                return;
            }
            this._hoverAcc = (this._hoverAcc || 0) + (this.game?.loop?.delta || 16);
            const pointer = this.input.activePointer;
            const cam = this.cameras.main;
            const camCell = cam
                ? `${(cam.worldView.x / 8) | 0}:${(cam.worldView.y / 8) | 0}`
                : "";
            const ptrCell = `${pointer.x | 0}:${pointer.y | 0}`;
            const moved = camCell !== this._hoverCamCell || ptrCell !== this._hoverPtrCell;
            const wait = moved ? 90 : 140;
            if (this._hoverAcc < wait && this._hoverCamCell != null) return;
            this._hoverAcc = 0;
            this._hoverCamCell = camCell;
            this._hoverPtrCell = ptrCell;
            const blockWorld = !!(
                this.player?.blocksTooltips?.()
                || isHudTextOpen(this)
            );

            if (this._wasTooltipBlocked && !blockWorld) {
                this._wasTooltipBlocked = false;
                this._hoverTarget = null; // re-fire pointerover after attack
            }
            if (blockWorld) this._wasTooltipBlocked = true;

            const hit = this._pickHoverTarget(pointer);
            // During attacks, ignore world hover for tooltips; side UI still works
            let top = (blockWorld && hit && !this._isUiTooltipTarget(hit)) ? null : hit;

            // Don't let a world sprite steal an active HUD hover (lean-to while
            // lying in it used to pointerout Craft/hotbar/health and hide tips).
            // Pixel-hit HUD icons use the current sprite mask — don't inflate
            // to the frame AABB or transparent padding would stick the hover.
            if (
                this._isUiTooltipTarget(this._hoverTarget)
                && this._objectShown?.(this._hoverTarget)
                && (!top || !this._isUiTooltipTarget(top))
            ) {
                const prev = this._hoverTarget;
                if (!prev._lockPixelHitKey) {
                    const b = prev.getBounds?.();
                    if (b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y)) {
                        top = prev;
                    }
                }
            }

            // Texture/setInteractive resets drop the object from Phaser's hit list for
            // a frame (or until the next mouse move). If the cursor is still inside
            // the last hover sprite, keep it so lighting a campfire doesn't hide the tip.
            if (!top && !blockWorld && !this.pointerOverWorldUi?.(pointer) && this._hoverTarget?.active) {
                const prev = this._hoverTarget;
                if (!this._skipOwnRestLeanTo?.(prev, pointer)) {
                    if (this._isHoverPawn(prev) || prev.role === "settler") {
                        if (this._pointerOnCreature(pointer, prev)) top = prev;
                    } else {
                        const b = prev.getBounds?.();
                        if (b) {
                            if (this._isUiTooltipTarget(prev)) {
                                if (!prev._lockPixelHitKey
                                    && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y)) {
                                    top = prev;
                                }
                            } else {
                                const wpt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                                if (Phaser.Geom.Rectangle.Contains(b, wpt.x, wpt.y)) top = prev;
                            }
                        }
                    }
                }
            }

            // A tree/bush/fire can sit on top in the display list while the cursor is
            // still in the pawn's click box. Keep the pawn so the tip doesn't strobe.
            if (
                !blockWorld
                && this._isHoverPawn(this._hoverTarget)
                && (!top || (!this._isUiTooltipTarget(top) && top !== this._hoverTarget))
                && !this.pointerOverWorldUi?.(pointer)
                && this._pointerOnCreature(pointer, this._hoverTarget)
            ) {
                top = this._hoverTarget;
            }

            if (top !== this._hoverTarget) {
                const prev = this._hoverTarget;
                this._hoverTarget = top;

                if (prev && prev.active && prev.input?.enabled) {
                    prev.emit("pointerout", pointer);
                } else if (this._tooltipTarget && this._tooltipTarget !== top) {
                    this.hideTooltip();
                }

                if (top) top.emit("pointerover", pointer);
                else this.hideWorldTooltip();
            } else if (top && this.tooltip?.visible && this.tooltip.scene) {
                this.positionTooltip(pointer.x, pointer.y);
                if (this._tooltipFollowsPointer(top)) this.refreshTooltip();
            } else if (
                top
                && top.input?.enabled
                && this._objectShown?.(top)
                && !this.tooltip?.visible
            ) {
                // Rest pinning used to drop Phaser's over-state without a mouse
                // move; pointerover never fired again until you left and re-entered.
                top.emit("pointerover", pointer);
            }

            this.input.setDefaultCursor(top ? this._cursorFor(top) : "default");
        };

        this.positionTooltip = (x, y) => {
            const offset = Math.round(14 * (this.uiScale || 1));
            let nx = x + offset, ny = y + offset;
            const w = this._tooltipBoxW || (this.tooltipText.width + this._tooltipPadding * 2);
            const h = this._tooltipBoxH || (this.tooltipText.height + this._tooltipPadding * 2);
            const maxX = this.scale.width - w;
            const maxY = this.scale.height - h;
            nx = Phaser.Math.Clamp(nx, 0, Math.max(0, maxX));
            ny = Phaser.Math.Clamp(ny, 0, Math.max(0, maxY));
            this.tooltip.setPosition(nx, ny);
            if (typeof ClayForming !== "undefined") ClayForming.syncHudTooltip(this);
        };

        this.input.on("pointermove", (pointer) => {
            if (!this._playReady || this._leavingGame) return;
            if (!this.tooltip?.visible) return;
            this.positionTooltip(pointer.x, pointer.y);
            if (this._tooltipFollowsPointer(this._tooltipTarget)) this.refreshTooltip();
        });
        // Snap player for draw only; restore true pose before the next physics step
        // so diagonal speed stays normalized (square-grid body snaps are √2-fast).
        this._onPreUpdate = () => {
            if (!this._playReady || this._leavingGame) return;
            this.restorePlayerPhysicsPos();
        };
        this._onPostUpdate = () => {
            if (!this._playReady || this._leavingGame) return;
            if (this._worldBooting || this._generatingUi) {
                this.input?.setDefaultCursor?.("default");
                try {
                    if (this.game?.canvas) this.game.canvas.style.cursor = "default";
                } catch (_) {}
                this._syncWaterSprite();
                this.syncCameraToPlayer();
                this._pumpChunkPaint?.();
                return;
            }
            this.syncPointerHover();
            // After physics: snap player+camera for this frame's render
            this.syncCameraToPlayer();
            this.player?._syncChatBubble?.();
            if (this._channelBarProgress != null) this._drawChannelBar();
            this._tickTreeChopBars();
            this.drawChunkDebug();
        };
        this.events.on("preupdate", this._onPreUpdate);
        this.events.on("postupdate", this._onPostUpdate);
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
