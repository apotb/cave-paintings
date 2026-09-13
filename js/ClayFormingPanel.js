/**
 * Centered clay-forming GUI — sculpt a 16³ lump (knapping's cousin).
 * First voxel edit spends 1 clay; Close with no edits refunds.
 */
class ClayFormingPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.grid = null;
        this.pool = 0;
        this.startMass = Forming?.MIN_MASS || 12;
        this.color = 0xc47a6a;
        this.blankItemId = "clay";
        this.blankSlotIndex = -1;
        this.tool = "move";
        this._finished = false;
        this._shattered = false;
        this._edited = false;
        this._blankConsumed = false;
        this._extraClay = 0;
        this._holding = null;
        this._undo = [];
        this._hover = null;
        this._rework = false;
        this._invFormClass = "lump";
        this._invPrev = null;
        this._pendingName = "";
        this._formCustom = false;

        this.wellPx = 256;
        this.panelW = 480;
        // Extra header strip so save/load/help sit above Add / Move / Delete.
        this.panelH = 480;

        this.container = scene.add.container(0, 0).setVisible(false).setDepth(16000).setScrollFactor(0);
        scene.uiLayer?.add(this.container);

        this.backdrop = scene.add.rectangle(0, 0, 800, 600, 0x000000, 0.55)
            .setOrigin(0.5)
            .setInteractive({ cursor: "default" });
        this.panelBg = scene.add.rectangle(0, 0, this.panelW, this.panelH, 0x2a241c, 0.96)
            .setOrigin(0.5)
            .setStrokeStyle(2, 0x6a5a45);

        this.title = crispUiText(scene.add.text(0, -216, "Clay Forming", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "24px",
            color: "#e8e0d0"
        }).setOrigin(0.5));

        this.btnAdd = this._makeBtn(-110, -148, "Add", () => this.setTool("add"));
        this.btnMove = this._makeBtn(0, -148, "Move", () => this.setTool("move"));
        this.btnDelete = this._makeBtn(110, -148, "Delete", () => this.setTool("delete"));
        this.btnName = this._makeBtn(0, -184, "Name", () => this._onNameClick());

        this.gridWell = scene.add.rectangle(0, 4, this.wellPx + 4, this.wellPx + 4, 0x1a1612, 1)
            .setOrigin(0.5);

        this.preview = crispUiText(scene.add.text(0, 148, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#c8b090",
            align: "center",
            wordWrap: { width: 440 }
        }).setOrigin(0.5));

        this.poolTxt = crispUiText(scene.add.text(0, 174, "Clay: 0", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#c8b090"
        }).setOrigin(0.5));

        this.btnRotate = this._makeBtn(-178, 206, "Rotate", () => this.rotate(1));
        this.btnUndo = this._makeBtn(-62, 206, "Undo", () => this.undo());
        this.btnMore = this._makeBtn(58, 206, "Use more clay", () => this.useMoreClay());
        this.btnFinish = this._makeBtn(186, 206, "Close", () => this.finishOrClose());

        this._helpPressed = false;
        this.helpBtn = scene.add.image(0, 0, "help_alt");
        lockPixelHit(this.helpBtn, "help_alt", { useHandCursor: true });
        this.helpBtn.on("pointerover", (p) => {
            if (!this._helpPressed) this.helpBtn.setTexture("help_alt_hover");
            this.scene.showTooltip(() => this._helpTooltipText(), p.x, p.y, this.helpBtn);
        });
        this.helpBtn.on("pointerout", () => {
            if (!this._helpPressed) this.helpBtn.setTexture("help_alt");
            if (this.scene._tooltipTarget === this.helpBtn) this.scene.hideTooltip();
        });
        this.helpBtn.on("pointerdown", () => {
            this._helpPressed = true;
            this.helpBtn.setTexture("help_alt_open");
        });
        this.helpBtn.setOrigin(0.5, 0.5).setScale(3).setDepth(16010).setVisible(false);
        scene.uiLayer.add(this.helpBtn);

        this._tplKind = null;
        this._savePressed = false;
        this._loadPressed = false;
        this.saveBtn = this._makeTplBtn("save", "Save template", () => this._onSaveClick());
        this.loadBtn = this._makeTplBtn("load", "Load template", () => this._onLoadClick());

        this.container.add([
            this.backdrop,
            this.panelBg,
            this.title,
            this.preview,
            this.gridWell,
            this.poolTxt,
            this.btnAdd.label,
            this.btnMove.label,
            this.btnDelete.label,
            this.btnName.label,
            this.btnRotate.label,
            this.btnUndo.label,
            this.btnMore.label,
            this.btnFinish.label
        ]);

        scene.input.on("pointerup", () => {
            this._releaseHelpPress();
            this._releaseTplPress("save");
            this._releaseTplPress("load");
        });

        this._keyR = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
        this._keyZ = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
        this._key1 = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
        this._key2 = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
        this._key3 = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);
        this._keyShift = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
        this._keyCtrl = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
        this._keyMeta = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.META);

        this._orbit = ClayForming.sphericalFromDefault();
        this._threeReady = false;
        this._dragOrbit = null;
        this._orbitPointerId = null;
        this._lmbDown = false;
        this._shiftHeld = false;
        this._hoverTint = null;
        this._hoverTintKey = "";

        scene.events.once("shutdown", () => this._teardownThree());
        scene.events.once("destroy", () => this._teardownThree());
    }

    _helpTooltipText() {
        const holder = this.scene._playerResearchHolder?.() || this.scene.player;
        const unlocked = typeof Forming !== "undefined" && typeof Research !== "undefined"
            ? Forming.techniquesFor(holder, (h, id) => Research.techUnlocked(id, h))
            : { animal: true, human: true, deity: false };
        const lines = (typeof Forming !== "undefined" ? Forming.helpLines(unlocked) : [])
            .slice();
        lines.push("1/2/3 Add / Move / Delete");
        lines.push("R rotate, Shift+R reverse");
        lines.push("Shift-click Delete to clear a column");
        lines.push("Drag empty space or right-drag to orbit · Ctrl+Z undo");
        return lines.join("\n");
    }

    _releaseHelpPress() {
        if (!this._helpPressed || !this.helpBtn) return;
        this._helpPressed = false;
        const p = this.scene.input.activePointer;
        const over = pointerHitsInteractive(this.helpBtn, p);
        this.helpBtn.setTexture(over ? "help_alt_hover" : "help_alt");
    }

    _tplTex(kind, suffix) {
        const base = kind === "save" ? "save_alt" : "load_alt";
        return suffix ? `${base}_${suffix}` : base;
    }

    _makeTplBtn(kind, tooltip, fn) {
        const scene = this.scene;
        const idle = this._tplTex(kind);
        const img = scene.add.image(0, 0, idle);
        lockPixelHit(img, idle, { useHandCursor: true });
        img.on("pointerover", (p) => {
            if (!this._tplPressed(kind)) img.setTexture(this._tplTex(kind, "hover"));
            this.scene.showTooltip(() => tooltip, p.x, p.y, img);
        });
        img.on("pointerout", () => {
            if (!this._tplPressed(kind)) img.setTexture(this._tplTex(kind));
            if (this.scene._tooltipTarget === img) this.scene.hideTooltip();
        });
        img.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            this._setTplPressed(kind, true);
            img.setTexture(this._tplTex(kind, "open"));
            fn();
        });
        img.setOrigin(0.5, 0.5).setScale(3).setDepth(16010).setVisible(false);
        scene.uiLayer.add(img);
        return img;
    }

    _tplPressed(kind) {
        return kind === "save" ? this._savePressed : this._loadPressed;
    }

    _setTplPressed(kind, on) {
        if (kind === "save") this._savePressed = !!on;
        else this._loadPressed = !!on;
    }

    _releaseTplPress(kind) {
        if (!this._tplPressed(kind)) return;
        if (typeof CraftTemplateUi !== "undefined" && CraftTemplateUi.isOpen() && this._tplKind === kind) {
            return;
        }
        this._setTplPressed(kind, false);
        const btn = kind === "save" ? this.saveBtn : this.loadBtn;
        if (!btn) return;
        const p = this.scene.input.activePointer;
        const over = pointerHitsInteractive(btn, p);
        btn.setTexture(over ? this._tplTex(kind, "hover") : this._tplTex(kind));
    }

    _syncTemplateButtons() {
        const open = typeof CraftTemplateUi !== "undefined" && CraftTemplateUi.isOpen();
        if (!open) this._tplKind = null;
        const paint = (btn, kind) => {
            if (!btn) return;
            const held = open && this._tplKind === kind;
            if (held) {
                btn.setTexture(this._tplTex(kind, "open"));
                return;
            }
            this._setTplPressed(kind, false);
            const p = this.scene.input.activePointer;
            const over = pointerHitsInteractive(btn, p);
            btn.setTexture(over ? this._tplTex(kind, "hover") : this._tplTex(kind));
        };
        paint(this.saveBtn, "save");
        paint(this.loadBtn, "load");
    }

    _makeBtn(x, y, text, fn) {
        const label = crispUiText(this.scene.add.text(x, y, `[ ${text} ]`, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#e8e0d0"
        }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
        label.on("pointerover", () => {
            if (label._disabled) return;
            label.setColor("#ffffff");
        });
        label.on("pointerout", () => this._paintTools());
        label.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (label._disabled) return;
            fn();
        });
        label._base = text;
        return { label };
    }

    _resetNameValue() {
        if (typeof Forming === "undefined") return "Clay Lump";
        return Forming.defaultNameFor(this._invFormClass || "lump");
    }

    _syncNameLabel() {
        const lab = this.btnName?.label;
        if (!lab) return;
        const named = typeof Forming !== "undefined" ? Forming.clampName(this._pendingName) : String(this._pendingName || "").trim();
        if (named) {
            lab.setText(named);
            lab._base = named;
        } else {
            lab.setText("[ Name ]");
            lab._base = "Name";
        }
        this._paintTools();
    }

    _onNameClick() {
        if (!this.visible || this._shattered || this._finished) return;
        if (typeof CraftTemplateUi === "undefined" || typeof Forming === "undefined") return;
        CraftTemplateUi.closeAll();
        const resetValue = this._resetNameValue();
        const pending = Forming.clampName(this._pendingName);
        CraftTemplateUi.promptName(this.scene, {
            title: "Name this figurine",
            placeholder: resetValue,
            value: pending,
            confirm: "Save",
            reset: "Reset",
            resetValue,
            maxLength: Forming.NAME_MAX,
            onOk: (name) => {
                const clamped = Forming.clampName(name);
                if (!clamped) return;
                this._pendingName = clamped;
                this._formCustom = clamped !== Forming.clampName(resetValue);
                this._markEdited();
                this._syncNameLabel();
                CraftTemplateUi.closeAll();
            }
        });
    }

    _paintTools() {
        const set = (btn, active) => {
            const lab = btn.label;
            if (lab._disabled) {
                lab.setColor("#6a5a45");
                return;
            }
            lab.setColor(active ? "#ffe7a0" : "#e8e0d0");
        };
        set(this.btnAdd, this.tool === "add");
        set(this.btnMove, this.tool === "move");
        set(this.btnDelete, this.tool === "delete");
        const nameLab = this.btnName?.label;
        if (nameLab) {
            nameLab._disabled = this._shattered || this._finished;
            if (nameLab._disabled) nameLab.setColor("#6a5a45");
            else if (this._pendingName) nameLab.setColor("#c8b090");
            else nameLab.setColor("#e8e0d0");
        }
        this.btnRotate.label._disabled = this._shattered;
        this.btnUndo.label._disabled = this._shattered || !this._undo.length;
        this.btnMore.label._disabled = this._shattered || this._spareClay() < 1;
        this.btnRotate.label.setColor(this._shattered ? "#6a5a45" : "#e8e0d0");
        this.btnUndo.label.setColor(this.btnUndo.label._disabled ? "#6a5a45" : "#e8e0d0");
        this.btnMore.label.setColor(this.btnMore.label._disabled ? "#6a5a45" : "#e8e0d0");
    }

    _syncFinishLabel() {
        const committed = this._edited || this._extraClay > 0;
        this.btnFinish.label.setText(committed || this._shattered ? "[ Finish ]" : "[ Close ]");
        this._layoutBottomButtons(this.scene.uiScale || 1);
    }

    _syncPool() {
        this.poolTxt.setText(`Clay: ${this.pool}`);
        this._paintTools();
    }

    layout() {
        const s = this.scene.uiScale || 1;
        const cam = this.scene.cameras.main;
        const cx = cam.width * 0.5;
        const cy = cam.height * 0.5;
        this.container.setPosition(cx, cy);
        this.backdrop.setSize(cam.width + 40, cam.height + 40);
        if (this.backdrop.input?.hitArea?.setSize) {
            this.backdrop.input.hitArea.setSize(cam.width + 40, cam.height + 40);
        }

        const panelW = this.panelW * s;
        const panelH = this.panelH * s;
        this.panelBg.setSize(panelW, panelH);
        this.panelBg.setStrokeStyle(
            typeof pixelUiStroke === "function" ? pixelUiStroke(s) : Math.max(2, Math.round(2 * s)),
            0x6a5a45
        );

        const well = this.wellPx * s;
        this.gridWell.setPosition(0, Math.round(4 * s)).setSize(well + 4 * s, well + 4 * s);

        this.title.setPosition(0, Math.round(-216 * s));
        this.btnName.label.setPosition(0, Math.round(-184 * s));
        this.btnAdd.label.setPosition(Math.round(-110 * s), Math.round(-148 * s));
        this.btnMove.label.setPosition(0, Math.round(-148 * s));
        this.btnDelete.label.setPosition(Math.round(110 * s), Math.round(-148 * s));
        this.preview.setPosition(0, Math.round(148 * s));
        if (typeof this.preview.setWordWrapWidth === "function") {
            this.preview.setWordWrapWidth(Math.round(440 * s));
        } else {
            this.preview.setStyle({ wordWrap: { width: Math.round(440 * s) } });
        }
        this.poolTxt.setPosition(0, Math.round(174 * s));

        if (typeof applyPixelUiFont === "function") {
            applyPixelUiFont(this.title, 24, s);
            applyPixelUiFont(this.preview, 16, s);
            applyPixelUiFont(this.poolTxt, 16, s);
            for (const b of [this.btnName, this.btnAdd, this.btnMove, this.btnDelete, this.btnRotate, this.btnUndo, this.btnMore, this.btnFinish]) {
                applyPixelUiFont(b.label, 16, s);
            }
        } else {
            this.title.setFontSize(pixelUiFontSize(24, s));
            this.preview.setFontSize(pixelUiFontSize(16, s));
            this.poolTxt.setFontSize(pixelUiFontSize(16, s));
            for (const b of [this.btnName, this.btnAdd, this.btnMove, this.btnDelete, this.btnRotate, this.btnUndo, this.btnMore, this.btnFinish]) {
                b?.label.setFontSize(pixelUiFontSize(16, s));
            }
        }

        this._layoutBottomButtons(s);
        this._syncNameLabel();

        const inset = Math.round(32 * s);
        this.helpBtn
            ?.setScale(3 * s)
            .setPosition(cx + panelW / 2 - inset, cy - panelH / 2 + inset);
        this.saveBtn
            ?.setScale(3 * s)
            .setPosition(cx - panelW / 2 + inset, cy - panelH / 2 + inset);
        const saveW = this.saveBtn?.displayWidth || Math.round(16 * 3 * s);
        const gap = Math.round(4 * s);
        this.loadBtn
            ?.setScale(3 * s)
            .setPosition(cx - panelW / 2 + inset + saveW + gap, cy - panelH / 2 + inset);
        if (this.visible) this._layoutOverlay();
    }

    _layoutBottomButtons(s) {
        const y = Math.round(206 * s);
        const labels = [
            this.btnRotate?.label,
            this.btnUndo?.label,
            this.btnMore?.label,
            this.btnFinish?.label
        ].filter(Boolean);
        if (!labels.length) return;
        const widths = labels.map((lab) => Math.max(1, lab.displayWidth || lab.width || 0));
        const total = widths.reduce((a, b) => a + b, 0);
        const panelW = this.panelW * s;
        const inset = Math.round(20 * s);
        const inner = Math.max(total, panelW - inset * 2);
        const gap = labels.length > 1 ? (inner - total) / (labels.length - 1) : 0;
        let x = -inner / 2;
        for (let i = 0; i < labels.length; i++) {
            labels[i].setPosition(Math.round(x + widths[i] / 2), y);
            x += widths[i] + gap;
        }
    }

    _layoutOverlay() {
        if (!this.visible) {
            ClayForming.hideOverlay();
            return;
        }
        const b = this.gridWell.getBounds();
        ClayForming.showOverlay(b, this.scene.game?.canvas);
        this._bindOverlay();
        const renderer = ClayForming.getRenderer();
        if (this._camera && renderer) {
            this._camera.aspect = Math.max(0.01, b.width / Math.max(1, b.height));
            this._camera.updateProjectionMatrix();
        }
        this._renderThree();
    }

    canOpenHeld(held) {
        if (!held || !(held.quantity > 0)) return false;
        const player = this.scene.player;
        const holder = this.scene._playerResearchHolder?.() || player;
        if (typeof Research !== "undefined" && !Research.techUnlocked("clay_forming", holder)) {
            return false;
        }
        if (held.id === "clay") return true;
        return held.id === "clay_figurine" && !!held.formVoxels;
    }

    tryOpen() {
        if (this.visible) return false;
        if (typeof THREE === "undefined" || typeof Forming === "undefined") return false;
        const player = this.scene.player;
        if (!player || player._bodyDead || player.isIncapacitated?.() || player._resting) return false;
        const held = player.getHeldItem();
        if (!held || !(held.quantity > 0)) return false;
        const rework = held.id === "clay_figurine" && !!held.formVoxels;
        if (!rework && held.id !== "clay") return false;
        const holder = this.scene._playerResearchHolder?.() || player;
        if (typeof Research !== "undefined" && !Research.techUnlocked("clay_forming", holder)) {
            return false;
        }
        const slotIndex = this.scene.hotbar?.activeIndex ?? -1;
        const blank = ClayForming.blankFromTexture(this.scene, "clay");
        let grid;
        let startMass;
        let color;
        if (rework) {
            const pack = Forming.sanitizePack(held.formVoxels);
            grid = pack ? Forming.unpack(pack) : null;
            if (!grid) return false;
            startMass = Math.max(
                Forming.MIN_MASS,
                Number(held.formStartMass) || blank?.startMass || Forming.mass(grid)
            );
            const tint = Number(held.formColor);
            color = (Number.isFinite(tint) && tint > 0)
                ? (tint >>> 0)
                : (blank?.color || 0xc47a6a);
        } else {
            if (!blank?.grid) return false;
            grid = Forming.cloneGrid(blank.grid);
            startMass = Math.max(Forming.MIN_MASS, blank.startMass || Forming.mass(grid));
            color = blank.color || 0xc47a6a;
        }

        this.scene.closeOpenMenus?.();
        this.scene.player?._cancelSkin?.();

        this._rework = rework;
        if (rework) {
            this._invFormClass = Forming.sanitizeClass(held.formClass);
            this._invPrev = {
                customName: held.customName,
                formCustom: !!held.formCustom,
                formClass: this._invFormClass
            };
            this._pendingName = Forming.hasAssignedName(held) ? Forming.clampName(held.customName) : "";
            this._formCustom = Forming.isCustomName(held);
        } else {
            this._invFormClass = "lump";
            this._invPrev = null;
            this._pendingName = "";
            this._formCustom = false;
        }
        this.blankItemId = held.id;
        this.blankSlotIndex = slotIndex;
        this.grid = grid;
        this.startMass = startMass;
        this.color = color;
        this.pool = 0;
        this.tool = "move";
        this._finished = false;
        this._shattered = false;
        this._edited = false;
        this._blankConsumed = false;
        this._extraClay = 0;
        this._holding = null;
        this._undo = [];
        this._hover = null;
        this._hoverTint = null;
        this._hoverTintKey = "";
        this._orbit = ClayForming.sphericalFromDefault();

        this.visible = true;
        this.container.setVisible(true);
        this._helpPressed = false;
        this.helpBtn?.setTexture("help_alt").setVisible(true);
        this._tplKind = null;
        this._savePressed = false;
        this._loadPressed = false;
        this.saveBtn?.setTexture("save_alt").setVisible(true);
        this.loadBtn?.setTexture("load_alt").setVisible(true);
        this.layout();
        this._ensureThree();
        this._rebuildVoxels();
        this._refreshPreview();
        this._syncFinishLabel();
        this._syncPool();
        this.scene.hideTooltip?.();
        this.scene.hideWorldTooltip?.();
        return true;
    }

    _isDedicated() {
        return !!(this.scene.simAuth());
    }

    _notifyForm(op, extra = {}) {
        if (!this._isDedicated() || typeof NetProtocol === "undefined") return;
        this.scene._netSendMove?.(true);
        this.scene.net.sendAction({
            type: NetProtocol.Actions.FORM,
            op,
            slot: this.blankSlotIndex,
            id: this.blankItemId,
            startMass: this.startMass,
            pawnId: this.scene.player?.pawnId,
            ...extra
        });
    }

    _consumeClayOnce() {
        if (this._blankConsumed) return;
        if (this._isDedicated()) {
            this._blankConsumed = true;
            this._notifyForm("consume");
            return;
        }
        const player = this.scene.player;
        if (!player) return;
        const idx = this.blankSlotIndex;
        const want = this.blankItemId;
        let n = 0;
        if (idx >= 0 && player.inventory[idx]?.id === want) {
            n = player.loseItemAt?.(idx, 1) ?? 0;
        }
        if (!(n > 0) && want === "clay") n = player.loseAnyItem?.(want, 1) ?? 0;
        if (n > 0) {
            this._blankConsumed = true;
            this.scene.hotbar.dirty = true;
        }
    }

    _countClay(player) {
        let n = 0;
        for (const bag of [player?.inventory, player?.overflow]) {
            for (const s of bag || []) {
                if (s?.id === "clay") n += s.quantity || 0;
            }
        }
        return n;
    }

    _spareClay() {
        const player = this.scene.player;
        let n = this._countClay(player);
        if (!this._blankConsumed) {
            const slot = player?.inventory?.[this.blankSlotIndex];
            if (slot?.id === "clay" && slot.quantity > 0) n -= 1;
        }
        return Math.max(0, n);
    }

    _takeOneClay(player) {
        const takeBag = (arr) => {
            if (!Array.isArray(arr)) return false;
            for (let i = 0; i < arr.length; i++) {
                const s = arr[i];
                if (s?.id !== "clay" || !(s.quantity > 0)) continue;
                s.quantity -= 1;
                if (s.quantity <= 0) arr[i] = null;
                return true;
            }
            return false;
        };
        if (takeBag(player.inventory)) return true;
        return takeBag(player.overflow);
    }

    setTool(id) {
        if (!this.visible || this._shattered) return;
        if (id !== "add" && id !== "move" && id !== "delete") return;
        if (this.tool !== id && this._holding) this._returnHeld();
        this.tool = id;
        this._paintTools();
        this._updateHover();
    }

    _pushUndo() {
        if (this._shattered || typeof Forming === "undefined") return;
        this._undo.push({
            grid: Forming.cloneGrid(this.grid),
            pool: this.pool
        });
        while (this._undo.length > Forming.UNDO_MAX) this._undo.shift();
        this._paintTools();
    }

    undo() {
        if (!this.visible || this._shattered || !this._undo.length) return;
        if (this._holding) this._returnHeld();
        const prev = this._undo.pop();
        this.grid = prev.grid;
        this.pool = prev.pool;
        this._rebuildVoxels();
        this._refreshPreview();
        this._syncPool();
    }

    rotate(dir) {
        if (!this.visible || !this.grid || this._shattered || this._finished) return;
        if (this._holding) this._returnHeld();
        const next = Forming.rotateY(this.grid, dir >= 0 ? 1 : -1);
        if (!next) return;
        this._pushUndo();
        this.grid = next;
        this._markEdited();
        this._rebuildVoxels();
        this._refreshPreview();
    }

    useMoreClay() {
        if (!this.visible || this._shattered || this._finished) return;
        if (this._spareClay() < 1) return;
        this._consumeClayOnce();
        if (this._isDedicated()) {
            this._notifyForm("addClay");
        } else {
            const player = this.scene.player;
            if (!player || !this._takeOneClay(player)) return;
            this.scene.hotbar.dirty = true;
        }
        this._extraClay += 1;
        this.pool += this.startMass;
        this._syncFinishLabel();
        this._refreshPreview();
        this._syncPool();
    }

    _currentClassName() {
        if (typeof Forming === "undefined" || !this.grid) return "Clay Lump";
        const holder = this.scene._playerResearchHolder?.() || this.scene.player;
        const idolatry = typeof Research !== "undefined" && Research.techUnlocked("idolatry", holder);
        const g = Forming.cloneGrid(this.grid);
        if (this._holding && Forming.inBounds(this._holding.x, this._holding.y, this._holding.z)) {
            g[this._holding.x][this._holding.y][this._holding.z] = true;
        }
        const result = Forming.classify(g, { idolatry });
        return Forming.NAMES[result.formClass] || "Clay Lump";
    }

    _previewAvailable() {
        if (typeof Forming === "undefined" || !this.grid) return this.pool || 0;
        return Forming.mass(this.grid) + this.pool + (this._holding ? 1 : 0);
    }

    _canSaveTemplate() {
        if (!this.visible || this._shattered || this._finished || !this.grid) return false;
        if (typeof Forming === "undefined") return false;
        return this._previewAvailable() >= (Forming.MIN_MASS || 12);
    }

    _onSaveClick() {
        if (!this._canSaveTemplate()) return;
        if (typeof CraftTemplateUi === "undefined" || typeof CraftTemplates === "undefined") return;
        if (typeof Forming === "undefined") return;
        this._tplKind = "save";
        CraftTemplateUi.closeAll();
        this._tplKind = "save";
        CraftTemplateUi.promptName(this.scene, {
            title: "Name this template",
            placeholder: this._currentClassName(),
            value: typeof Forming !== "undefined" ? Forming.clampName(this._pendingName) : this._pendingName,
            confirm: "Save",
            onChange: (open) => {
                if (open) this._tplKind = "save";
                this._syncTemplateButtons();
            },
            onOk: (name) => this._commitSave(name),
            onCancel: () => this._syncTemplateButtons()
        });
        this._syncTemplateButtons();
    }

    _commitSave(name) {
        const list = typeof Settings !== "undefined" ? Settings.loadFormTemplates() : [];
        const existing = CraftTemplates.findByName(list, name);
        if (existing) {
            CraftTemplateUi.confirm(this.scene, {
                title: `Replace ${existing.name}?`,
                confirm: "Replace",
                onYes: () => this._writeSave(name),
                onNo: () => this._syncTemplateButtons()
            });
            this._syncTemplateButtons();
            return;
        }
        this._writeSave(name);
    }

    _writeSave(name) {
        if (this._holding) this._returnHeld();
        if (!this._canSaveTemplate()) {
            CraftTemplateUi.closeAll();
            return;
        }
        const packed = Forming.pack(this.grid);
        if (!Forming.sanitizePack(packed)) {
            CraftTemplateUi.closeAll();
            return;
        }
        const list = typeof Settings !== "undefined" ? Settings.loadFormTemplates() : [];
        const next = CraftTemplates.upsert(list, { name, packed });
        if (typeof Settings !== "undefined") Settings.saveFormTemplates(next.list);
        CraftTemplateUi.closeAll();
        this._syncTemplateButtons();
    }

    _templateRows() {
        const list = typeof Settings !== "undefined" ? Settings.loadFormTemplates() : [];
        const available = this._previewAvailable();
        const spare = this._spareClay();
        const startMass = this.startMass;
        return list.map((entry) => {
            const cost = CraftTemplates.loadCost(entry.packed, available, startMass, Forming);
            const extra = cost ? cost.extra : 0;
            const needMore = extra > spare;
            return {
                id: entry.id,
                name: entry.name,
                packed: entry.packed,
                extra,
                canLoad: !needMore && !this._shattered && !this._finished,
                costLabel: extra > 0 && !needMore ? `Clay: ${extra}` : "",
                needLabel: needMore ? `Need ${extra - spare} more clay` : ""
            };
        });
    }

    _onLoadClick() {
        if (!this.visible || this._shattered || this._finished) return;
        if (typeof CraftTemplateUi === "undefined" || typeof CraftTemplates === "undefined") return;
        this._openLoadList();
    }

    _openLoadList() {
        this._tplKind = "load";
        CraftTemplateUi.showLoadList(this.scene, {
            title: "Load template",
            rows: this._templateRows(),
            onChange: (open) => {
                if (open) this._tplKind = "load";
                this._syncTemplateButtons();
            },
            onClose: () => this._syncTemplateButtons(),
            onLoad: (row) => {
                if (this.applyTemplate(row)) CraftTemplateUi.closeAll();
                this._syncTemplateButtons();
            },
            onDelete: (row) => this._confirmDelete(row)
        });
        this._syncTemplateButtons();
    }

    _confirmDelete(row) {
        const label = String(row?.name || "template");
        CraftTemplateUi.confirm(this.scene, {
            title: `Delete ${label}?`,
            confirm: "Delete",
            onYes: () => {
                const list = typeof Settings !== "undefined" ? Settings.loadFormTemplates() : [];
                const next = CraftTemplates.removeById(list, row.id);
                if (typeof Settings !== "undefined") Settings.saveFormTemplates(next);
                this._openLoadList();
            },
            onNo: () => this._syncTemplateButtons()
        });
        this._syncTemplateButtons();
    }

    applyTemplate(row) {
        if (!this.visible || this._shattered || this._finished || !this.grid) return false;
        if (typeof Forming === "undefined" || typeof CraftTemplates === "undefined") return false;
        if (this._holding) this._returnHeld();
        const packed = Forming.sanitizePack(row?.packed);
        const next = packed ? Forming.unpack(packed) : null;
        if (!next) return false;
        const need = Forming.mass(next);
        if (need < (Forming.MIN_MASS || 12)) return false;
        const available = Forming.mass(this.grid) + this.pool;
        const extra = CraftTemplates.extraClayLumps(need, available, this.startMass);
        if (extra > this._spareClay()) return false;
        const prevGrid = Forming.cloneGrid(this.grid);
        const prevPool = this.pool;
        for (let i = 0; i < extra; i++) this.useMoreClay();
        this.pool += Forming.mass(this.grid);
        this.grid = Forming.emptyGrid();
        if (this.pool < need) {
            this.grid = prevGrid;
            this.pool = prevPool;
            return false;
        }
        this.grid = next;
        this.pool -= need;
        this._undo = [];
        this._markEdited();
        this._rebuildVoxels();
        const fail = Forming.shatterCheck(this.grid);
        if (fail.shattered) this._fail(fail.reason);
        this._refreshPreview();
        this._syncPool();
        return !this._shattered;
    }

    _markEdited() {
        this._consumeClayOnce();
        this._edited = true;
        this._syncFinishLabel();
    }

    _returnHeld() {
        if (!this._holding || !this.grid) return;
        const h = this._holding;
        if (Forming.inBounds(h.x, h.y, h.z)) this.grid[h.x][h.y][h.z] = true;
        this._holding = null;
        this._rebuildVoxels();
        this._syncGhost();
    }

    handleEsc() {
        if (!this.visible) return;
        if (typeof CraftTemplateUi !== "undefined" && CraftTemplateUi.isOpen()) {
            CraftTemplateUi.handleEsc();
            return;
        }
        if (this._holding) {
            this._returnHeld();
            return;
        }
        this.finishOrClose();
    }

    finishOrClose() {
        if (!this.visible || this._finished) return;
        if (this._holding) this._returnHeld();
        if (this._shattered) {
            this.close();
            return;
        }
        if (!this._edited && this._extraClay <= 0) {
            this.close();
            return;
        }
        this.finish();
    }

    finish() {
        if (!this.visible || this._finished) return;
        if (this._holding) this._returnHeld();
        if (this._shattered) {
            this.close();
            return;
        }
        if (!this.grid || (!this._edited && this._extraClay <= 0)) {
            this.close();
            return;
        }
        const fail = Forming.shatterCheck(this.grid);
        if (fail.shattered) {
            this._fail(fail.reason);
            return;
        }
        this._consumeClayOnce();
        const holder = this.scene._playerResearchHolder?.() || this.scene.player;
        const idolatry = typeof Research !== "undefined" && Research.techUnlocked("idolatry", holder);
        const result = Forming.classify(this.grid, { idolatry });
        const stack = Forming.makeStack(result.formClass, this.grid, this.startMass);
        Forming.applyFinishName(stack, {
            prev: this._invPrev,
            pendingName: this._pendingName,
            pendingCustom: this._formCustom
        });
        if (typeof ClayForming !== "undefined") {
            stack.formColor = this.color;
            ClayForming.ensureFormTexture(this.scene, stack);
        }
        this._finished = true;
        const label = stack.customName || Forming.defaultNameFor(stack.formClass) || "figurine";
        const formed = Forming.isCustomName(stack) ? `You formed ${label}` : `You formed a ${label}`;
        const ok = this._grantStack(stack);
        if (ok) this.scene.combatLog?.push(formed);
        else {
            this.scene.combatLog?.push?.(
                `${formed}, but it fell out of reach`
            );
        }
        this.close();
    }

    _grantStack(stack) {
        const player = this.scene.player;
        if (!player || !stack) return false;
        const clone = typeof cloneItemStack === "function" ? cloneItemStack(stack) : { ...stack };
        if (this._isDedicated()) {
            this._notifyForm("finish", { stack: clone });
            return true;
        }
        const prefer = this.blankSlotIndex;
        if (prefer >= 0 && prefer < player.inventorySize && !player.inventory[prefer]) {
            player.inventory[prefer] = clone;
            this.scene.hotbar.dirty = true;
            return true;
        }
        if (typeof player.gainStack === "function" && player.gainStack(stack)) return true;
        const nullIndex = player.inventory.findIndex((s) => !s);
        if (nullIndex !== -1) {
            player.inventory[nullIndex] = clone;
            this.scene.hotbar.dirty = true;
            return true;
        }
        if (player.inventory.length < player.inventorySize) {
            player.inventory.push(clone);
            this.scene.hotbar.dirty = true;
            return true;
        }
        const meta = this.scene.getItem(stack.id) || {
            id: stack.id,
            key: "clay",
            maxStack: 1,
            name: stack.customName || Forming.defaultNameFor(stack.formClass) || "Figurine",
            weight: stack.weight || 0.8
        };
        const drop = DroppedItem.spawn(
            this.scene, player.x, player.y, meta, 1, undefined,
            typeof mealStackExtras === "function" ? mealStackExtras(stack) : stack
        );
        return !!drop;
    }

    _fail(reason) {
        this._shattered = true;
        this.pool = 0;
        this._holding = null;
        this.preview.setText(reason || "It crumbled");
        this.scene.combatLog?.push(reason || "It crumbled");
        this._syncFinishLabel();
        this._paintTools();
        this._rebuildVoxels();
    }

    _maybeShatterFromDelete() {
        const fail = Forming.shatterCheck(this.grid, {
            holding: this._holding ? { x: this._holding.x, y: this._holding.y, z: this._holding.z } : null
        });
        if (fail.shattered) this._fail(fail.reason);
    }

    close() {
        if (!this.visible) return;
        if (typeof CraftTemplateUi !== "undefined") CraftTemplateUi.closeAll();
        if (this._blankConsumed && !this._finished) this._notifyForm("abort");
        this.visible = false;
        this.container.setVisible(false);
        this.grid = null;
        this._holding = null;
        this._undo = [];
        this._finished = false;
        this._shattered = false;
        this._edited = false;
        this._blankConsumed = false;
        this._extraClay = 0;
        this._rework = false;
        this._invFormClass = "lump";
        this._invPrev = null;
        this._pendingName = "";
        this._formCustom = false;
        this._syncFinishLabel();
        if (this.scene._tooltipTarget === this.helpBtn) this.scene.hideTooltip();
        if (this.scene._tooltipTarget === this.saveBtn || this.scene._tooltipTarget === this.loadBtn) {
            this.scene.hideTooltip();
        }
        this._helpPressed = false;
        this.helpBtn?.setTexture("help_alt").setVisible(false);
        this._tplKind = null;
        this._savePressed = false;
        this._loadPressed = false;
        this.saveBtn?.setTexture("save_alt").setVisible(false);
        this.loadBtn?.setTexture("load_alt").setVisible(false);
        this._unbindOverlay();
        ClayForming.hideOverlay();
        this.scene._flushPendingYouGear?.();
    }

    _refreshPreview() {
        if (!this.grid || (!this._edited && this._extraClay <= 0 && !this._rework) || this._shattered) {
            if (!this._shattered) this.preview.setText("");
            return;
        }
        const holder = this.scene._playerResearchHolder?.() || this.scene.player;
        const idolatry = typeof Research !== "undefined" && Research.techUnlocked("idolatry", holder);
        const g = Forming.cloneGrid(this.grid);
        if (this._holding && Forming.inBounds(this._holding.x, this._holding.y, this._holding.z)) {
            g[this._holding.x][this._holding.y][this._holding.z] = true;
        }
        const result = Forming.classify(g, { idolatry });
        this.preview.setText(result.preview);
    }

    _ensureThree() {
        if (typeof THREE === "undefined") return;
        if (!this._threeReady) {
            const renderer = ClayForming.getRenderer();
            if (!renderer) return;
            this._tScene = new THREE.Scene();
            ClayForming.addLights(this._tScene);
            this._ground = ClayForming.makeGround();
            this._tScene.add(this._ground);
            this._mesh = ClayForming.makeVoxelMesh(this.color);
            this._tScene.add(this._mesh);
            const ghostMat = new THREE.MeshLambertMaterial({
                color: this.color,
                transparent: true,
                opacity: 0.4,
                depthWrite: false
            });
            this._ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat);
            this._ghost.visible = false;
            this._tScene.add(this._ghost);
            const hoverMat = new THREE.MeshLambertMaterial({
                color: 0xffffff,
                emissive: 0x332211,
                transparent: true,
                opacity: 0.35,
                depthWrite: false
            });
            this._hoverMesh = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 1.05), hoverMat);
            this._hoverMesh.visible = false;
            this._tScene.add(this._hoverMesh);
            this._camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
            this._raycaster = new THREE.Raycaster();
            this._pointer = new THREE.Vector2();
            this._threeReady = true;
            this._bindOverlay();
        }
        if (this._camera && this._orbit) ClayForming.applySpherical(this._camera, this._orbit);
    }

    _teardownThree() {
        this._unbindOverlay();
        ClayForming.hideOverlay();
        this._threeReady = false;
    }

    _bindOverlay() {
        const el = ClayForming.getRenderer()?.domElement;
        if (!el || this._overlayBound) return;
        this._onDown = (ev) => this._onPointerDown(ev);
        this._onMove = (ev) => this._onPointerMove(ev);
        this._onUp = (ev) => this._onPointerUp(ev);
        this._onCtx = (ev) => ev.preventDefault();
        el.addEventListener("pointerdown", this._onDown);
        el.addEventListener("pointermove", this._onMove);
        el.addEventListener("contextmenu", this._onCtx);
        window.addEventListener("pointermove", this._onMove);
        window.addEventListener("pointerup", this._onUp);
        window.addEventListener("pointercancel", this._onUp);
        window.addEventListener("contextmenu", this._onCtx);
        this._overlayBound = true;
    }

    _unbindOverlay() {
        this._releaseOrbit();
        const el = ClayForming.getRenderer()?.domElement;
        if (el && this._onDown) {
            el.removeEventListener("pointerdown", this._onDown);
            el.removeEventListener("pointermove", this._onMove);
            el.removeEventListener("contextmenu", this._onCtx);
        }
        if (this._onMove) window.removeEventListener("pointermove", this._onMove);
        if (this._onUp) {
            window.removeEventListener("pointerup", this._onUp);
            window.removeEventListener("pointercancel", this._onUp);
        }
        if (this._onCtx) window.removeEventListener("contextmenu", this._onCtx);
        this._overlayBound = false;
    }

    _releaseOrbit(ev) {
        const el = ClayForming.getRenderer()?.domElement;
        const id = ev?.pointerId ?? this._orbitPointerId;
        if (el && id != null) {
            try { el.releasePointerCapture(id); } catch (_) { /* already released */ }
        }
        this._orbitPointerId = null;
        this._dragOrbit = null;
    }

    _beginOrbit(ev, pending = false) {
        this._dragOrbit = {
            x: ev.clientX,
            y: ev.clientY,
            theta: this._orbit.theta,
            phi: this._orbit.phi,
            button: ev.button,
            active: !pending
        };
        this._orbitPointerId = ev.pointerId;
        const el = ClayForming.getRenderer()?.domElement;
        try { el?.setPointerCapture?.(ev.pointerId); } catch (_) { /* ignore */ }
    }

    _orbitButtonReleased(ev) {
        if (!this._dragOrbit) return false;
        const btn = this._dragOrbit.button ?? 2;
        const bit = btn === 2 ? 2 : 1;
        return ev.type === "pointercancel"
            || ev.button === btn
            || (ev.pointerId === this._orbitPointerId && (ev.buttons & bit) === 0);
    }

    _ndcFromEvent(ev) {
        const el = ClayForming.getRenderer()?.domElement;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) return null;
        this._pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
        this._pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
        return this._pointer;
    }

    _hitVoxels() {
        if (!this._raycaster || !this._camera || !this._mesh) return null;
        this._raycaster.setFromCamera(this._pointer, this._camera);
        const hits = this._raycaster.intersectObject(this._mesh);
        return hits[0] || null;
    }

    _groundCell() {
        if (!this._raycaster || !this._camera) return null;
        this._raycaster.setFromCamera(this._pointer, this._camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const pt = new THREE.Vector3();
        if (!this._raycaster.ray.intersectPlane(plane, pt)) return null;
        const x = Math.floor(pt.x);
        const z = Math.floor(pt.z);
        if (!Forming.inBounds(x, 0, z)) return null;
        return { x, y: 0, z };
    }

    _pickFilled() {
        const hit = this._hitVoxels();
        if (!hit) return null;
        return ClayForming.cellFromPoint(hit.point.clone().addScaledVector(hit.face.normal, -0.02));
    }

    _pickEmpty() {
        const hit = this._hitVoxels();
        if (hit) return ClayForming.faceNeighbor(hit);
        return this._groundCell();
    }

    _onPointerDown(ev) {
        if (!this.visible || this._finished) return;
        if (typeof CraftTemplateUi !== "undefined" && CraftTemplateUi.isOpen()) return;
        if (ev.button === 2) {
            this._beginOrbit(ev, false);
            ev.preventDefault();
            return;
        }
        if (ev.button !== 0) return;
        this._lmbDown = true;
        this._shiftHeld = !!(ev.shiftKey || this._keyShift?.isDown);
        this._ndcFromEvent(ev);
        if (this._hitVoxels()) {
            this._applyToolClick();
            return;
        }
        this._beginOrbit(ev, true);
    }

    _onPointerMove(ev) {
        if (!this.visible) return;
        if (this._dragOrbit) {
            if (this._orbitPointerId != null && ev.pointerId !== this._orbitPointerId) return;
            const dx = ev.clientX - this._dragOrbit.x;
            const dy = ev.clientY - this._dragOrbit.y;
            if (!this._dragOrbit.active) {
                if ((dx * dx + dy * dy) < 25) return;
                this._dragOrbit.active = true;
            }
            this._orbit.theta = this._dragOrbit.theta - dx * 0.01;
            this._orbit.phi = this._dragOrbit.phi - dy * 0.01;
            ClayForming.applySpherical(this._camera, this._orbit);
            this._renderThree();
            return;
        }
        const el = ClayForming.getRenderer()?.domElement;
        if (el && ev.target !== el && !el.contains(ev.target)) return;
        this._ndcFromEvent(ev);
        this._updateHover(ev);
        this._renderThree();
    }

    _onPointerUp(ev) {
        if (this._dragOrbit && this._orbitButtonReleased(ev)) {
            const emptyClick = this._dragOrbit.button === 0 && !this._dragOrbit.active;
            const sx = this._dragOrbit.x;
            const sy = this._dragOrbit.y;
            this._releaseOrbit(ev);
            if (emptyClick && this.visible && !this._finished) {
                this._ndcFromEvent({ clientX: sx, clientY: sy });
                this._applyToolClick();
            }
        }
        if (ev.button === 0) this._lmbDown = false;
    }

    _applyToolClick() {
        if (this._shattered || this._dragOrbit) return;
        if (this.tool === "delete") {
            const cell = this._pickFilled();
            if (!cell || !this.grid[cell.x][cell.y][cell.z]) return;
            this._pushUndo();
            const column = this._shiftHeld || this._keyShift?.isDown;
            let n = 0;
            if (column) {
                n = Forming.clearColumn(this.grid, cell.x, cell.z);
            } else {
                this.grid[cell.x][cell.y][cell.z] = false;
                n = 1;
            }
            if (!(n > 0)) {
                this._undo.pop();
                return;
            }
            this.pool += n;
            this._markEdited();
            this._rebuildVoxels();
            this._maybeShatterFromDelete();
            this._refreshPreview();
            this._syncPool();
            return;
        }
        if (this.tool === "add") {
            const cell = this._pickEmpty();
            if (!cell || this.pool <= 0) return;
            if (this.grid[cell.x][cell.y][cell.z]) return;
            if (!Forming.isAdjacentFilled(this.grid, cell.x, cell.y, cell.z) && Forming.mass(this.grid) > 0) {
                return;
            }
            this._pushUndo();
            this.grid[cell.x][cell.y][cell.z] = true;
            this.pool -= 1;
            this._markEdited();
            this._rebuildVoxels();
            this._refreshPreview();
            this._syncPool();
            return;
        }
        if (this.tool === "move") {
            if (this._holding) {
                const cell = this._pickEmpty();
                if (!cell) {
                    this._returnHeld();
                    return;
                }
                if (this.grid[cell.x][cell.y][cell.z]) return;
                this.grid[cell.x][cell.y][cell.z] = true;
                this._holding = null;
                this._rebuildVoxels();
                this._refreshPreview();
                this._syncPool();
                return;
            }
            const cell = this._pickFilled();
            if (!cell || !this.grid[cell.x][cell.y][cell.z]) return;
            this._pushUndo();
            this.grid[cell.x][cell.y][cell.z] = false;
            this._holding = { x: cell.x, y: cell.y, z: cell.z };
            this._markEdited();
            this._rebuildVoxels();
            this._syncGhost();
            this._refreshPreview();
        }
    }

    _toolHighlight(tool) {
        if (tool === "add") return { color: 0x3ddc6a, emissive: 0x0f4a24 };
        if (tool === "move") return { color: 0xff9933, emissive: 0x5a2808 };
        return { color: 0xff3a30, emissive: 0xaa1410 };
    }

    _applyToolHighlight(mesh, tool) {
        const mat = mesh?.material;
        if (!mat?.color) return;
        const c = this._toolHighlight(tool);
        mat.color.setHex(c.color);
        if (mat.emissive) mat.emissive.setHex(c.emissive);
    }

    _updateHover(ev) {
        const filled = this._pickFilled();
        const empty = this._pickEmpty();
        this._hover = this.tool === "add" || (this.tool === "move" && this._holding) ? empty : filled;
        const shift = !!(ev?.shiftKey || this._keyShift?.isDown);
        const tintFilled = !!filled && !this._shattered
            && (this.tool === "delete" || (this.tool === "move" && !this._holding));
        const tintKey = tintFilled
            ? `${this.tool}:${shift ? 1 : 0}:${filled.x},${filled.y},${filled.z}`
            : "";
        if (tintKey !== this._hoverTintKey) {
            this._hoverTintKey = tintKey;
            this._hoverTint = tintFilled
                ? {
                    x: filled.x,
                    y: filled.y,
                    z: filled.z,
                    color: this._toolHighlight(this.tool).color,
                    column: this.tool === "delete" && shift
                }
                : null;
            this._rebuildVoxels();
        }
        if (this._hoverMesh) {
            this._applyToolHighlight(this._hoverMesh, this.tool);
            const cell = this._hover;
            const showOverlay = !!cell && !this._shattered && !tintFilled
                && (this.tool !== "add" || this.pool > 0);
            if (showOverlay) {
                this._hoverMesh.visible = true;
                this._hoverMesh.scale.set(1, 1, 1);
                this._hoverMesh.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
            } else {
                this._hoverMesh.visible = false;
                this._hoverMesh.scale.set(1, 1, 1);
            }
        }
        this._syncGhost();
    }

    _syncGhost() {
        if (!this._ghost) return;
        const cell = (this.tool === "add" && this.pool > 0 && !this._shattered)
            ? this._hover
            : (this.tool === "move" && this._holding ? this._hover : null);
        if (cell && !this.grid[cell.x]?.[cell.y]?.[cell.z]) {
            this._ghost.visible = true;
            this._applyToolHighlight(this._ghost, this.tool);
            this._ghost.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
        } else {
            this._ghost.visible = false;
        }
    }

    _rebuildVoxels() {
        this._ensureThree();
        if (!this._mesh || !this.grid) return;
        ClayForming.fillVoxelMesh(this._mesh, this.grid, this.color, null, this._hoverTint);
        this._renderThree();
    }

    _renderThree() {
        const renderer = ClayForming.getRenderer();
        if (!renderer || !this._tScene || !this._camera || !this.visible) return;
        renderer.render(this._tScene, this._camera);
    }

    update() {
        if (!this.visible) return;
        if (typeof CraftTemplateUi !== "undefined" && CraftTemplateUi.isOpen()) {
            this._renderThree();
            if (typeof ClayForming !== "undefined") ClayForming.syncHudTooltip(this.scene);
            return;
        }
        if (Phaser.Input.Keyboard.JustDown(this._key1)) this.setTool("add");
        if (Phaser.Input.Keyboard.JustDown(this._key2)) this.setTool("move");
        if (Phaser.Input.Keyboard.JustDown(this._key3)) this.setTool("delete");
        if (Phaser.Input.Keyboard.JustDown(this._keyR)) {
            this.rotate(this._keyShift.isDown ? -1 : 1);
        }
        const undoKey = Phaser.Input.Keyboard.JustDown(this._keyZ)
            && (this._keyCtrl.isDown || this._keyMeta.isDown);
        if (undoKey) this.undo();
        if (this.tool === "delete" && this._hover && !this._dragOrbit) {
            const shift = !!this._keyShift?.isDown;
            const key = `delete:${shift ? 1 : 0}:${this._hover.x},${this._hover.y},${this._hover.z}`;
            if (key !== this._hoverTintKey) this._updateHover();
        }
        this._renderThree();
        if (typeof ClayForming !== "undefined") ClayForming.syncHudTooltip(this.scene);
    }
}
