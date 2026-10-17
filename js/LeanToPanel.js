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
        this._buildMedical();
    }

    _buildMedical() {
        const sys = this.scene.settlementSys;
        if (!sys?.makeMedicalButton) return;
        this._medicalUi = sys.makeMedicalButton(() => {
            if (!this.leanTo) return;
            sys.toggleMedical(this.leanTo);
            this.refresh();
        });
        this.container.add(this._medicalUi.btn);
        this._medicalUi.btn.setVisible(false);
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
            const strokeW = typeof pixelUiWorldStroke === "function"
                ? pixelUiWorldStroke(scene)
                : 2 / (scene.worldZoom || 1);
            const enabled = this[state.enabledKey];
            if (!enabled) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(strokeW, OUTLINE);
                text.setColor("#6a5a4a");
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
        const slot = this._syncAction();
        if (this._actionMode === "wake") this.scene.tryLeanToWake?.(this.leanTo, slot);
        else if (slot >= 0) this.scene.tryLeanToRest?.(this.leanTo, slot);
    }

    /** Slot the local player is lying in, or -1. */
    _ownRestSlot() {
        const entry = this.leanTo?.entry;
        const pawn = this.scene.player;
        if (!entry || !pawn?._resting || pawn.isBodyDead?.()) return -1;
        const id = pawn.pawnId;
        if (!id) return -1;
        const occ = entry.occupants || [];
        if (pawn.lastSleep?.uid === entry.uid) {
            const s = pawn.lastSleep.slot || 0;
            if (!occ[s] || occ[s] === id) return s;
        }
        const i = occ.indexOf(id);
        return i >= 0 ? i : -1;
    }

    /** First bunk that is free for the local player, or -1. */
    _openSlot() {
        const entry = this.leanTo?.entry;
        const pawn = this.scene.player;
        if (!entry || !pawn || pawn.isBodyDead?.()) return -1;
        const scene = this.scene;
        const def = scene.getThing?.(entry.id) || this.leanTo.meta;
        const n = typeof Sleep !== "undefined"
            ? Sleep.slotCount(def, entry)
            : (entry.occupants?.length || 0);
        const id = pawn.pawnId;
        for (let i = 0; i < n; i++) {
            const taken = typeof scene._sleepSlotClaimed === "function"
                ? scene._sleepSlotClaimed(entry, i, id)
                : !!entry.occupants?.[i];
            if (!taken) return i;
        }
        return -1;
    }

    /**
     * Wake when the local player is already in this shelter.
     * Otherwise Rest, enabled when any bunk is free.
     * @returns {number} slot to use, or -1 when Rest has nowhere to go
     */
    _syncAction() {
        const mine = this._ownRestSlot();
        if (mine >= 0) {
            this.slot = mine;
            this._actionMode = "wake";
            return mine;
        }
        const open = this._openSlot();
        this.slot = open >= 0 ? open : 0;
        this._actionMode = "rest";
        return open;
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
        if (this._medicalUi?.btn?.visible
            && this._pointerOnRect(this._medicalUi.rect, this._medicalUi.btn, pointer)) return true;
        return this._pointerOnRect(this.destroyRect, this.destroyBtn, pointer);
    }

    open(leanTo) {
        if (this.scene.corpsePanel?.visible) this.scene.corpsePanel.close();
        if (this.scene.storagePanel?.visible) this.scene.storagePanel.close();
        if (this.scene.campfirePanel?.visible) this.scene.campfirePanel.close();
        if (this.scene.paintingCirclePanel?.visible) this.scene.paintingCirclePanel.close();
        this.scene.closeCraftStationMenu?.();
        this.leanTo = leanTo;
        this.slot = 0;
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
        this._medicalUi?.rect?.disableInteractive();
    }

    toggle(leanTo) {
        if (this.visible && this.leanTo === leanTo) this.close();
        else this.open(leanTo);
    }

    refresh() {
        if (!this.leanTo) return;
        const entry = this.leanTo.entry;
        const open = this._syncAction();
        const allEmpty = typeof Sleep !== "undefined"
            ? Sleep.isEmpty(entry)
            : !(entry?.occupants || []).some((id) => id);

        this.actionText.setText(this._actionMode === "wake" ? "Wake" : "Rest");
        this._actionEnabled = this._actionMode === "wake" ? true : open >= 0;
        this.actionBtn.setVisible(true);
        this._syncHitArea(this.actionRect, this._actionEnabled, this._actionBw, this._actionBh);

        this._destroyEnabled = allEmpty;
        this.destroyBtn.setVisible(true);
        this._syncHitArea(this.destroyRect, allEmpty, this._destroyBw, this._destroyBh);
        this._paintDestroy?.();

        if (!this._medicalUi) this._buildMedical();
        this.scene.settlementSys?.syncMedicalButton(this._medicalUi, this.leanTo);
        this._placeBottomRow();

        this._syncHover();
    }

    _placeBottomRow(y, actionW, addW, gap) {
        if (!this.destroyBtn) return;
        if (Number.isFinite(y)) this._bottomY = y;
        if (Number.isFinite(actionW)) this._bottomActionW = actionW;
        if (Number.isFinite(addW)) this._bottomAddW = addW;
        if (Number.isFinite(gap)) this._bottomGap = gap;
        const rowY = this._bottomY || 0;
        const bw = this._bottomActionW || this._destroyBw || 78;
        const aw = this._bottomAddW || this._actionBh || 28;
        const g = this._bottomGap || 8;
        this.scene.settlementSys?.placeAddActionRow(this._medicalUi, this.destroyBtn, {
            y: rowY,
            gap: g,
            addW: aw,
            actionW: bw,
            addOn: !!this._medicalUi?.btn?.visible,
            actionOn: true
        });
        if (!this.scene.settlementSys?.placeAddActionRow) {
            this.destroyBtn.setPosition(0, rowY);
        }
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
        if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(this.actionText, 16, this.scene);
        else {
            this.actionText.setResolution(zoom * (window.devicePixelRatio || 1));
            this.actionText.setFontSize(`${fontPx}px`);
            this.actionText.setScale(1 / zoom);
        }

        this.destroyRect.setSize(bw, bh);
        if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(this.destroyText, 16, this.scene);
        else {
            this.destroyText.setResolution(zoom * (window.devicePixelRatio || 1));
            this.destroyText.setFontSize(`${fontPx}px`);
            this.destroyText.setScale(1 / zoom);
        }

        const objH = this.leanTo.displayHeight || 16;
        this.actionBtn.setPosition(0, -(objH + clear + bh / 2));
        this._medicalUi?.setSize?.(bh);
        this._placeBottomRow(clear + bh / 2, bw, bh, 8 * ws);

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
