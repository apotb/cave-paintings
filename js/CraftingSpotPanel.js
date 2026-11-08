/**
 * World-anchored enable, Bills, and Remove controls for a Crafting Spot.
 */
class CraftingSpotPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.spot = null;
        scene.registerWorldMenu?.(this);
        this.container = scene.add.container(0, 0).setVisible(false).setDepth(250);
        if (scene._uiCam) scene._uiCam.ignore(this.container);
        this._build();
    }

    _worldUiScale() {
        const s = this.scene.uiScale || 1;
        const zoom = this.scene.worldZoom || 1;
        return s / zoom;
    }

    _build() {
        const sys = this.scene.settlementSys;
        if (!sys) return;
        this._enableUi = sys.makeEnableButton(() => {
            if (this.spot) sys.toggleCraftEnabled(this.spot);
            this._sync();
        });
        this._billsUi = sys.makeWorldButton("Bills", () => {
            if (this.spot) sys.openBills(this.spot);
        });
        this._removeUi = sys.makeWorldButton("Remove", () => {
            if (!this.spot) return;
            this.scene.tryRemoveCraftingSpot?.(this.spot);
        });
        this.container.add(this._enableUi.btn);
        this.container.add(this._billsUi.btn);
        this.container.add(this._removeUi.btn);
        this._enableUi.btn.setVisible(false);
        this._billsUi.btn.setVisible(false);
        this._removeUi.btn.setVisible(false);
    }

    _sync() {
        const sys = this.scene.settlementSys;
        const ok = !!sys?.canManageSpot?.(this.spot);
        this._enableUi?.btn.setVisible(ok);
        this._billsUi?.btn.setVisible(ok);
        this._removeUi?.btn.setVisible(ok);
        if (ok) {
            if (typeof ensurePointerInteractive === "function") {
                ensurePointerInteractive(this._enableUi.rect);
                ensurePointerInteractive(this._billsUi.rect);
                ensurePointerInteractive(this._removeUi.rect);
            }
            this._enableUi?.setEnabled?.(this.spot?.entry?.craftEnabled !== false);
        } else {
            this._enableUi?.rect?.disableInteractive?.();
            this._billsUi?.rect?.disableInteractive?.();
            this._removeUi?.rect?.disableInteractive?.();
        }
        this._placeRow();
    }

    open(spot) {
        if (this.scene.restBlocksWorldUi?.()) return;
        this.scene.closeOtherWorldMenus?.(this, spot);
        this.spot = spot;
        this.visible = true;
        this.container.setVisible(true);
        this.container.setPosition(spot.x, spot.y);
        this.layout();
    }

    toggle(spot) {
        if (this.visible && this.spot === spot) this.close();
        else this.open(spot);
    }

    close() {
        this.visible = false;
        this.spot = null;
        this.container.setVisible(false);
        this._enableUi?.btn.setVisible(false);
        this._billsUi?.btn.setVisible(false);
        this._removeUi?.btn.setVisible(false);
        this.scene.hideTooltip();
    }

    layout() {
        if (!this.spot) return;
        const ws = this._worldUiScale();
        const bw = 96 * ws;
        const bh = 28 * ws;
        const gap = 8 * ws;
        const y = typeof worldUiButtonY === "function"
            ? worldUiButtonY(this.scene, 0, bh)
            : 2 + bh / 2;
        this._row = { y, bw, bh, gap };
        this._enableUi?.setSize?.(bh);
        this._enableUi?.paint?.();
        if (this._billsUi) {
            this._billsUi.rect.setSize(bw, bh);
            if (typeof applyPixelUiWorldFont === "function") {
                applyPixelUiWorldFont(this._billsUi.text, 14, this.scene);
            }
            this._billsUi.paint?.();
        }
        if (this._removeUi) {
            this._removeUi.rect.setSize(bw, bh);
            if (typeof applyPixelUiWorldFont === "function") {
                applyPixelUiWorldFont(this._removeUi.text, 14, this.scene);
            }
            this._removeUi.paint?.();
        }
        this.container.setPosition(this.spot.x, this.spot.y);
        this._sync();
    }

    _placeRow() {
        const row = this._row;
        if (!row) return;
        this.scene.settlementSys?.placeAddActionRow(this._enableUi, this._billsUi?.btn, {
            y: row.y,
            gap: row.gap,
            addW: row.bh,
            actionW: row.bw,
            addOn: !!this._enableUi?.btn?.visible,
            actionOn: !!this._billsUi?.btn?.visible
        });
        const manageOn = !!this._enableUi?.btn?.visible || !!this._billsUi?.btn?.visible;
        const y = manageOn ? row.y + row.bh + row.gap : row.y;
        this._removeUi?.btn.setPosition(0, y);
    }

    update() {
        if (!this.visible || !this.spot) return;
        if (!this.spot.active || !this.spot.inRange()) {
            this.close();
            return;
        }
        this._sync();
    }

    containsPointer(pointer) {
        if (!this.visible || !this.container?.visible || !pointer) return false;
        const pt = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const hit = (rect, vis) => !!(vis && rect?.getBounds
            && Phaser.Geom.Rectangle.Contains(rect.getBounds(), pt.x, pt.y));
        if (hit(this._enableUi?.rect, this._enableUi?.btn?.visible)) return true;
        if (hit(this._billsUi?.rect, this._billsUi?.btn?.visible)) return true;
        if (hit(this._removeUi?.rect, this._removeUi?.btn?.visible)) return true;
        return false;
    }
}

