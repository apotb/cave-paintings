/**
 * World-anchored Materials + enable/disable controls for a Painting Circle.
 */
class PaintingCirclePanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.circle = null;
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
            if (this.circle) sys.togglePaintEnabled(this.circle);
            this._sync();
        });
        this._matUi = sys.makeWorldButton("Materials", () => {
            if (this.circle) sys.openPaintFilter?.(this.circle);
        });
        this._removeUi = sys.makeWorldButton("Remove", () => this._tryRemove());
        this._removeUi.rect?.on("pointerover", (pointer) => {
            const reason = this._blockedReason();
            if (reason) {
                this.scene.showTooltip(() => this._blockedReason() || "", pointer.x, pointer.y, this._removeUi.rect);
            }
        });
        this._removeUi.rect?.on("pointerout", () => {
            if (this.scene._tooltipTarget === this._removeUi?.rect) this.scene.hideTooltip();
        });
        this.container.add(this._enableUi.btn);
        this.container.add(this._matUi.btn);
        this.container.add(this._removeUi.btn);
        this._enableUi.btn.setVisible(false);
        this._matUi.btn.setVisible(false);
        this._removeUi.btn.setVisible(false);
    }

    _blockedReason() {
        return this.scene.settlementSys?.circleRemoveBlockedReason?.(this.circle) || null;
    }

    _tryRemove() {
        if (!this.circle || this._removeUi?._disabled) return;
        const R = typeof Research !== "undefined" ? Research : null;
        const painted = R?.paintedCount ? R.paintedCount(this.circle.entry) : 0;
        if (painted >= 1) {
            this.scene.settlementSys?.promptRemovePaintingCircle?.(this.circle, () => {
                this.scene.tryRemovePaintingCircle?.(this.circle);
            });
            return;
        }
        this.scene.tryRemovePaintingCircle?.(this.circle);
    }

    _sync() {
        const sys = this.scene.settlementSys;
        const ok = !!sys?.canManageCircle?.(this.circle);
        this._enableUi?.btn.setVisible(ok);
        this._matUi?.btn.setVisible(ok);
        this._removeUi?.btn.setVisible(!!this.circle);
        if (ok) {
            if (typeof ensurePointerInteractive === "function") {
                ensurePointerInteractive(this._enableUi.rect);
                ensurePointerInteractive(this._matUi.rect);
            }
            const R = typeof Research !== "undefined" ? Research : null;
            this._enableUi?.setEnabled?.(R ? R.isEnabled(this.circle.entry) : true);
        } else {
            this._enableUi?.rect?.disableInteractive?.();
            this._matUi?.rect?.disableInteractive?.();
        }
        if (this._removeUi) {
            const reason = this._blockedReason();
            this._removeUi.setEnabled?.(!reason);
            if (typeof ensurePointerInteractive === "function") {
                ensurePointerInteractive(this._removeUi.rect);
            }
            if (reason && this._removeUi.rect?.input) {
                this._removeUi.rect.input.cursor = "default";
                this._removeUi.rect.input.useHandCursor = false;
            }
            if (!reason && this.scene._tooltipTarget === this._removeUi.rect) {
                this.scene.hideTooltip();
            }
        }
        this._placeRow();
    }

    open(circle) {
        if (this.scene.restBlocksWorldUi?.()) return;
        if (this.scene.corpsePanel?.visible) this.scene.corpsePanel.close();
        if (this.scene.campfirePanel?.visible) this.scene.campfirePanel.close();
        if (this.scene.storagePanel?.visible) this.scene.storagePanel.close();
        if (this.scene.leanToPanel?.visible) this.scene.leanToPanel.close();
        this.scene.closeCraftStationMenu?.();
        this.circle = circle;
        if (circle?.entry && typeof Research !== "undefined") {
            Research.ensureEntry(circle.entry, circle.meta);
        }
        this.visible = true;
        this.container.setVisible(true);
        this.container.setPosition(circle.x, circle.y);
        this.layout();
    }

    toggle(circle) {
        if (this.visible && this.circle === circle) this.close();
        else this.open(circle);
    }

    close() {
        this.visible = false;
        this.circle = null;
        this.container.setVisible(false);
        this._enableUi?.btn.setVisible(false);
        this._matUi?.btn.setVisible(false);
        this._removeUi?.btn.setVisible(false);
        this.scene.hideTooltip();
    }

    layout() {
        if (!this.circle) return;
        const ws = this._worldUiScale();
        const bw = 96 * ws;
        const bh = 28 * ws;
        const gap = 8 * ws;
        this._row = { y: 2 + bh / 2, bw, bh, gap };
        this._enableUi?.setSize?.(bh);
        this._enableUi?.paint?.();
        if (this._matUi) {
            this._matUi.rect.setSize(bw, bh);
            if (typeof applyPixelUiWorldFont === "function") {
                applyPixelUiWorldFont(this._matUi.text, 14, this.scene);
            }
            this._matUi.paint?.();
        }
        if (this._removeUi) {
            this._removeUi.rect.setSize(bw, bh);
            if (typeof applyPixelUiWorldFont === "function") {
                applyPixelUiWorldFont(this._removeUi.text, 14, this.scene);
            }
            this._removeUi.paint?.();
        }
        this.container.setPosition(this.circle.x, this.circle.y);
        this._sync();
    }

    _placeRow() {
        const row = this._row;
        if (!row) return;
        this.scene.settlementSys?.placeAddActionRow(this._enableUi, this._matUi?.btn, {
            y: row.y,
            gap: row.gap,
            addW: row.bh,
            actionW: row.bw,
            addOn: !!this._enableUi?.btn?.visible,
            actionOn: !!this._matUi?.btn?.visible
        });
        const manageOn = !!this._enableUi?.btn?.visible || !!this._matUi?.btn?.visible;
        const removeY = manageOn ? row.y + row.bh + row.gap : row.y;
        this._removeUi?.btn.setPosition(0, removeY);
    }

    update() {
        if (!this.visible || !this.circle) return;
        if (!this.circle.active || !this.circle.inRange()) {
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
        if (hit(this._matUi?.rect, this._matUi?.btn?.visible)) return true;
        if (hit(this._removeUi?.rect, this._removeUi?.btn?.visible)) return true;
        return false;
    }
}
