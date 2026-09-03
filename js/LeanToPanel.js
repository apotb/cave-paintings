class LeanToPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.leanTo = null;
        this.slot = 0;

        this.container = scene.add.container(0, 0).setVisible(false).setDepth(250);
        if (scene._uiCam) scene._uiCam.ignore(this.container);

        this._buildAction();
        this._buildDestroy();
    }

    _worldUiScale() {
        const s = this.scene.uiScale || 1;
        const zoom = this.scene.worldZoom || 1;
        return s / zoom;
    }

    _buildAction() {
        const built = this._makeTakeButton("Rest", "action", () => this._tryAction());
        this.actionRect = built.rect;
        this.actionText = built.text;
        this.actionBtn = built.btn;
        this._actionHovering = false;
        this._actionPressing = false;
        this._actionEnabled = false;
        this._actionBw = 78;
        this._actionBh = 28;
        this._actionMode = "rest";
        this._paintAction = built.paint;
        this.container.add(this.actionBtn);
    }

    _buildDestroy() {
        const built = this._makeTakeButton("Destroy", "destroy", () => {
            this.scene.tryDestroyLeanTo?.(this.leanTo);
        });
        this.destroyRect = built.rect;
        this.destroyText = built.text;
        this.destroyBtn = built.btn;
        this._destroyHovering = false;
        this._destroyPressing = false;
        this._destroyEnabled = false;
        this._destroyBw = 78;
        this._destroyBh = 28;
        this._paintDestroy = built.paint;
        this.destroyBtn.setVisible(false);
        this.container.add(this.destroyBtn);
    }

    _makeTakeButton(label, kind, onClick) {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const scene = this.scene;
        const rect = scene.add.rectangle(0, 0, 78, 28, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });
        const text = scene.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        const btn = scene.add.container(0, 0, [rect, text]);
        const state = {
            hoveringKey: `_${kind}Hovering`,
            pressingKey: `_${kind}Pressing`,
            enabledKey: `_${kind}Enabled`
        };
        const paint = () => {
            const strokeW = 2 / (scene.worldZoom || 1);
            const enabled = this[state.enabledKey];
            if (!enabled) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(strokeW, OUTLINE);
                text.setColor("#d4c4a8");
                return;
            }
            if (this[state.pressingKey]) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(strokeW, OUTLINE_PRESS);
            } else if (this[state.hoveringKey]) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(strokeW, OUTLINE_HOVER);
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(strokeW, OUTLINE);
            }
            text.setColor("#d4c4a8");
        };
        rect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown() || !this[state.enabledKey]) return;
            this[state.pressingKey] = true;
            paint();
        });
        rect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = this[state.pressingKey];
            this[state.pressingKey] = false;
            this._syncHover();
            paint();
            if (was && this[state.hoveringKey] && this[state.enabledKey]) onClick();
        });
        return { rect, text, btn, paint };
    }

    _tryAction() {
        if (this._actionMode === "wake") this.scene.tryLeanToWake?.(this.leanTo, this.slot);
        else this.scene.tryLeanToRest?.(this.leanTo, this.slot);
    }

    _syncHitArea(rect, enable, bw, bh) {
        if (!enable) {
            rect.disableInteractive();
            return;
        }
        rect.setInteractive({ useHandCursor: true });
        if (rect.input?.hitArea?.setTo) rect.input.hitArea.setTo(0, 0, bw, bh);
    }

    _pointerOnRect(rect, btn, pointer) {
        if (!this.visible || !btn?.visible || !rect || !pointer) return false;
        const pt = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(rect.getBounds(), pt.x, pt.y);
    }

    _syncHover() {
        const pointer = this.scene.input.activePointer;
        const actionOver = !!(this._actionEnabled && this._pointerOnRect(this.actionRect, this.actionBtn, pointer));
        if (actionOver !== this._actionHovering) {
            this._actionHovering = actionOver;
            if (!actionOver) this._actionPressing = false;
        }
        const destroyOver = !!(this._destroyEnabled && this._pointerOnRect(this.destroyRect, this.destroyBtn, pointer));
        if (destroyOver !== this._destroyHovering) {
            this._destroyHovering = destroyOver;
            if (!destroyOver) this._destroyPressing = false;
        }
        this._paintAction?.();
        this._paintDestroy?.();
    }

    containsPointer(pointer) {
        if (!this.visible || !this.container?.visible || !pointer) return false;
        if (this._pointerOnRect(this.actionRect, this.actionBtn, pointer)) return true;
        return this._pointerOnRect(this.destroyRect, this.destroyBtn, pointer);
    }

    open(leanTo, slot) {
        if (this.scene.corpsePanel?.visible) this.scene.corpsePanel.close();
        if (this.scene.storagePanel?.visible) this.scene.storagePanel.close();
        if (this.scene.campfirePanel?.visible) this.scene.campfirePanel.close();
        this.leanTo = leanTo;
        this.slot = Math.max(0, Math.floor(Number(slot) || 0));
        this.visible = true;
        this.container.setVisible(true);
        this.refresh();
        this.layout();
    }

    close() {
        this.visible = false;
        this.leanTo = null;
        this._actionHovering = false;
        this._actionPressing = false;
        this._destroyHovering = false;
        this._destroyPressing = false;
        this.container.setVisible(false);
        this.actionRect?.disableInteractive();
        this.destroyRect?.disableInteractive();
    }

    toggle(leanTo, slot) {
        if (this.visible && this.leanTo === leanTo && this.slot === slot) this.close();
        else this.open(leanTo, slot);
    }

    refresh() {
        if (!this.leanTo) return;
        const entry = this.leanTo.entry;
        const pawn = this.scene.player;
        const pawnId = pawn?.pawnId;
        const occ = entry?.occupants?.[this.slot] || null;
        const emptySlot = !occ;
        const mine = !!(occ && pawnId && occ === pawnId);
        const allEmpty = typeof Sleep !== "undefined" ? Sleep.isEmpty(entry) : emptySlot;

        this._actionMode = mine ? "wake" : "rest";
        this.actionText.setText(mine ? "Wake" : "Rest");
        this._actionEnabled = mine
            ? true
            : emptySlot && !!pawn && !pawn.isBodyDead?.();
        this.actionBtn.setVisible(true);
        this.actionBtn.setAlpha(this._actionEnabled ? 1 : 0.35);
        this._syncHitArea(this.actionRect, this._actionEnabled, this._actionBw, this._actionBh);

        this._destroyEnabled = allEmpty;
        this.destroyBtn.setVisible(allEmpty);
        if (allEmpty) this._syncHitArea(this.destroyRect, true, this._destroyBw, this._destroyBh);
        else this.destroyRect.disableInteractive();

        this._syncHover();
    }

    layout() {
        if (!this.leanTo) return;
        const s = this.scene.uiScale || 1;
        const zoom = this.scene.worldZoom || 1;
        const ws = this._worldUiScale();
        const bw = 78 * ws;
        const bh = 28 * ws;
        const clear = 2;
        const fontPx = pixelUiFontSize(16, s);
        this._actionBw = bw;
        this._actionBh = bh;
        this._destroyBw = bw;
        this._destroyBh = bh;

        this.actionRect.setSize(bw, bh);
        this.actionText.setResolution(zoom * (window.devicePixelRatio || 1));
        this.actionText.setFontSize(`${fontPx}px`);
        this.actionText.setScale(1 / zoom);

        this.destroyRect.setSize(bw, bh);
        this.destroyText.setResolution(zoom * (window.devicePixelRatio || 1));
        this.destroyText.setFontSize(`${fontPx}px`);
        this.destroyText.setScale(1 / zoom);

        const objH = this.leanTo.displayHeight || 16;
        this.actionBtn.setPosition(0, -(objH + clear + bh / 2));
        this.destroyBtn.setPosition(0, clear + bh / 2);

        this.container.setPosition(this.leanTo.x, this.leanTo.y);
        this.refresh();
    }

    update() {
        if (!this.visible || !this.leanTo) return;
        if (!this.leanTo.active || !this.leanTo.inRange?.()) {
            this.close();
            return;
        }
        this.container.setPosition(this.leanTo.x, this.leanTo.y);
        this._syncHover();
    }
}
