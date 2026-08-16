/**
 * Centered freeform knapping GUI — chip a pebble/flint against a rock.
 * Blank is only consumed after the first chip; Close (no chips) returns free.
 * Finished tools can be reopened to reshape (rotate free; chip risks destroy).
 */
class KnappingPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.material = "pebble";
        this.textureKey = "pebble";
        this.blankItemId = null;
        this.blankSlotIndex = -1;
        this.grid = null;
        this.pixels = null;
        this._finished = false;
        this._shattered = false;
        this._chipped = false;
        this._blankConsumed = false;
        this._rework = false;
        this._rotated = false;

        this.cellPx = 14;
        this._previewKey = "knap_session_preview";
        this.container = scene.add.container(0, 0).setVisible(false).setDepth(120).setScrollFactor(0);
        scene.uiLayer?.add(this.container);

        // Backdrop blocks the world. Panel chrome is NOT interactive — same reason
        // the main HUD help works: nothing steals hits from under the ? button.
        this.backdrop = scene.add.rectangle(0, 0, 800, 600, 0x000000, 0.55)
            .setOrigin(0.5)
            .setInteractive({ cursor: "default" });
        this.panelBg = scene.add.rectangle(0, 0, 420, 354, 0x2a241c, 0.96)
            .setOrigin(0.5)
            .setStrokeStyle(2, 0x6a5a45);

        this.title = crispUiText(scene.add.text(0, -147, "Knapping", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "24px",
            color: "#e8e0d0"
        }).setOrigin(0.5));

        this.preview = crispUiText(scene.add.text(0, 118, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#c8b090",
            align: "center",
            wordWrap: { width: 380 }
        }).setOrigin(0.5));

        // Dark well + upscaled source-texture preview (chips carve real pixels)
        const gridSize = this.cellPx * Knapping.SIZE;
        this.gridWell = scene.add.rectangle(0, -10, gridSize + 4, gridSize + 4, 0x1a1612, 1)
            .setOrigin(0.5);
        {
            const n = Knapping.SIZE;
            const canvas = document.createElement("canvas");
            canvas.width = n;
            canvas.height = n;
            if (scene.textures.exists(this._previewKey)) scene.textures.remove(this._previewKey);
            scene.textures.addCanvas(this._previewKey, canvas);
        }
        this.gridImage = scene.add.image(0, -10, this._previewKey)
            .setOrigin(0.5)
            .setVisible(false);
        this.gridHit = scene.add.rectangle(0, -10, gridSize, gridSize, 0x000000, 0.001)
            .setOrigin(0.5)
            .setInteractive({ cursor: "default" });

        this.btnRotate = this._makeBtn(-70, 142, "Rotate", () => this.rotate());
        this.btnFinish = this._makeBtn(70, 142, "Close", () => this.finishOrClose());

        // Same pattern as SceneMain.createButtons() help: uiLayer sibling + pixelPerfect
        this._helpPressed = false;
        this.helpBtn = scene.add.image(0, 0, "help_alt");
        this.helpBtn.setInteractive({ useHandCursor: true, pixelPerfect: true });
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
        this.helpBtn.setOrigin(0.5, 0.5).setScale(3).setDepth(130).setVisible(false);
        scene.uiLayer.add(this.helpBtn);

        this.container.add([
            this.backdrop,
            this.panelBg,
            this.title,
            this.preview,
            this.gridWell,
            this.gridImage,
            this.gridHit,
            this.btnRotate.label,
            this.btnFinish.label
        ]);

        scene.input.on("pointerup", () => {
            this._releaseHelpPress();
        });

        this.gridHit.on("pointerdown", (p) => this._onGridClick(p));
        this.gridHit.on("pointermove", (p) => this._updateGridCursor(p));
        this.gridHit.on("pointerout", () => this._setGridCursor(false));

        this._keyR = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
        this._keyEsc = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    }

    _helpTooltipText() {
        return [
            "Knife — tapered blade with some body (not forked)",
            "Scraper — wide flat flake (thin), little/no taper",
            "Chopper — big solid leftover (don't thin it into a flake)",
            "Awl — small pierce spike / butt with a point",
            "Spear tip — long and thin",
            "Flake — unclear leftover chip"
        ].join("\n");
    }

    /** Same idea as SceneMain._releasePressButton for help / help_alt. */
    _releaseHelpPress() {
        if (!this._helpPressed || !this.helpBtn) return;
        this._helpPressed = false;
        const p = this.scene.input.activePointer;
        const hits = this.scene.input.hitTestPointer(p) || [];
        const over = hits.includes(this.helpBtn);
        this.helpBtn.setTexture(over ? "help_alt_hover" : "help_alt");
    }

    _makeBtn(x, y, text, fn) {
        const label = crispUiText(this.scene.add.text(x, y, `[ ${text} ]`, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#e8e0d0"
        }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
        label.on("pointerover", () => label.setColor("#ffffff"));
        label.on("pointerout", () => label.setColor("#e8e0d0"));
        label.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            fn();
        });
        return { label };
    }

    _syncFinishLabel() {
        this.btnFinish.label.setText(this._chipped ? "[ Finish ]" : "[ Close ]");
    }

    layout() {
        const cam = this.scene.cameras.main;
        const cx = cam.width * 0.5;
        const cy = cam.height * 0.5;
        this.container.setPosition(cx, cy);
        this.backdrop.setSize(cam.width + 40, cam.height + 40);
        // Knapping stays 1:1 with the chip grid — GUI scale must not enlarge text alone.
        this.title.setFontSize(pixelUiFontSize(24, 1));
        this.preview.setFontSize(pixelUiFontSize(16, 1));
        this.btnRotate?.label.setFontSize(pixelUiFontSize(16, 1));
        this.btnFinish?.label.setFontSize(pixelUiFontSize(16, 1));
        // Screen-space top-right of the 420×354 panel
        this.helpBtn
            ?.setScale(3)
            .setPosition(cx + 210 - 32, cy - 177 + 32);
    }

    /**
     * Called when player clicks a rock while holding a blank or finished tool.
     * @returns {boolean}
     */
    tryOpenAtRock(rock) {
        if (this.visible) return false;
        if (!rock || rock.meta?.id !== "rock") return false;
        const pointer = this.scene.input?.activePointer;
        if (this.scene.pointerOverWorldUi?.(pointer)) return false;
        const player = this.scene.player;
        if (!player || player._bodyDead || player.isIncapacitated?.() || player._resting) return false;
        // Close whatever menu is open, then start knapping
        this.scene.closeOpenMenus?.();
        this.scene.player?._cancelSkin?.();

        const r = (this.scene.tileSize || 16) * (player.interactionRange || 4);
        const dx = rock.x - player.x;
        const dy = rock.y - player.y;
        if (dx * dx + dy * dy > r * r) return false;

        const held = player.getHeldItem();
        if (!held || !(held.quantity > 0)) return false;
        const meta = this.scene.getItem(held.id);
        const slotIndex = this.scene.hotbar?.activeIndex ?? -1;

        // Reshape an existing knapped tool (needs saved silhouette)
        const rework = !!(held.knapIconData && (held.id === "stone_tool" || held.id === "flint_tool"));
        if (rework) {
            const pixels = Knapping.unpackIconData(held.knapIconData);
            if (!pixels) return false;
            const grid = Knapping.gridFromPixels(pixels);
            if (!grid || Knapping.mass(grid) < 1) return false;

            this._rework = true;
            this.blankItemId = held.id;
            this.blankSlotIndex = slotIndex;
            this.material = held.knapMaterial === "flint" || held.id === "flint_tool"
                ? "flint"
                : "pebble";
            this.textureKey = meta?.key || this.material;
            this.grid = grid;
            this.pixels = pixels;
            this._reworkDurability = held.durability;
            this._reworkQuality = held.knapQuality || null;
            this._reworkToolClass = held.toolClass || null;
        } else {
            const knap = meta?.knapping;
            if (!knap?.material) return false;

            this._rework = false;
            this._reworkDurability = undefined;
            this._reworkQuality = null;
            this._reworkToolClass = null;
            this.blankItemId = held.id;
            this.blankSlotIndex = slotIndex;
            this.material = knap.material === "flint" ? "flint" : "pebble";
            this.textureKey = meta.key || this.material;
            const blank = Knapping.blankFromTexture(this.scene, this.textureKey);
            this.grid = blank.grid;
            this.pixels = blank.pixels;
        }

        this._finished = false;
        this._shattered = false;
        this._chipped = false;
        this._blankConsumed = false;
        this._rotated = false;

        this.visible = true;
        this.container.setVisible(true);
        this._helpPressed = false;
        this.helpBtn?.setTexture("help_alt").setVisible(true);
        this.layout();
        this._redraw();
        this._refreshPreview();
        this._syncFinishLabel();
        this.scene.hideTooltip?.();
        this.scene.hideWorldTooltip?.();
        return true;
    }

    _isDedicated() {
        return !!(this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal);
    }

    _notifyKnap(op, extra = {}) {
        if (!this._isDedicated() || typeof NetProtocol === "undefined") return;
        this.scene._invSwapGuardUntil = performance.now() + 1200;
        this.scene._netSendMove?.(true);
        this.scene.net.sendAction({
            type: NetProtocol.Actions.KNAP,
            op,
            slot: this.blankSlotIndex,
            id: this.blankItemId,
            pawnId: this.scene.player?.pawnId,
            ...extra
        });
    }

    _consumeBlankOnce() {
        if (this._blankConsumed || !this.blankItemId) return;
        const player = this.scene.player;
        if (!player) return;
        // Prefer the held slot so the finished tool can go back there
        const idx = this.blankSlotIndex;
        let n = 0;
        if (idx >= 0 && player.inventory[idx]?.id === this.blankItemId) {
            n = player.loseItemAt?.(idx, 1) ?? 0;
        }
        if (!(n > 0)) n = player.loseAnyItem?.(this.blankItemId, 1) ?? 0;
        if (n > 0) {
            this._blankConsumed = true;
            this.scene.hotbar.dirty = true;
            this._notifyKnap("consume");
        }
    }

    /** Persist rotate-only reshape onto the still-held tool (no chip / no consume). */
    _writeBackOrientation() {
        if (!this._rework || this._blankConsumed || !this.grid || !this.pixels) return;
        const player = this.scene.player;
        if (!player) return;
        const idx = this.blankSlotIndex;
        const slot = idx >= 0 ? player.inventory[idx] : null;
        if (!slot || slot.id !== this.blankItemId) return;
        const packed = Knapping.packIconData(this.grid, this.pixels);
        if (!packed) return;
        slot.knapIconData = packed;
        slot.knapIcon = null;
        Knapping.ensureToolTexture(this.scene, slot);
        this.scene.hotbar.dirty = true;
        this._notifyKnap("orient", { knapIconData: packed });
    }

    _redraw() {
        if (!this.grid || !this.pixels) {
            this.gridImage.setVisible(false);
            return;
        }
        const n = Knapping.SIZE;
        const tex = this.scene.textures.get(this._previewKey);
        const canvas = tex.getSourceImage();
        const ctx = canvas.getContext("2d");
        const masked = Knapping.maskedPixels(this.grid, this.pixels);
        ctx.clearRect(0, 0, n, n);
        const img = ctx.createImageData(n, n);
        img.data.set(masked);
        ctx.putImageData(img, 0, 0);
        if (typeof tex.refresh === "function") tex.refresh();
        const side = n * this.cellPx;
        this.gridImage
            .setTexture(this._previewKey)
            .setDisplaySize(side, side)
            .setVisible(true);
    }

    _refreshPreview() {
        // Blanks stay blank until first chip; rework shows the current guess immediately
        if (!this.grid || (!this._chipped && !this._rework)) {
            this.preview.setText("");
            return;
        }
        const result = Knapping.classify(this.grid, this.material);
        this.preview.setText(result.preview);
    }

    /** @returns {{ gx: number, gy: number }|null} filled stone cell under pointer, else null */
    _stoneCellAt(pointer) {
        if (!this.visible || !this.grid || this._shattered || this._finished) return null;
        const n = Knapping.SIZE;
        const cell = this.cellPx;
        const bounds = this.gridHit.getBounds();
        const gx = Math.floor((pointer.x - bounds.centerX) / cell + n / 2);
        const gy = Math.floor((pointer.y - bounds.centerY) / cell + n / 2);
        if (gx < 0 || gy < 0 || gx >= n || gy >= n) return null;
        if (!this.grid[gy][gx]) return null;
        // Only the silhouette rim can be struck — no interior pits
        if (!Knapping.isEdgeCell(this.grid, gx, gy)) return null;
        return { gx, gy };
    }

    _setGridCursor(pointerOverStone) {
        const cur = pointerOverStone ? "pointer" : "default";
        if (this.gridHit.input) this.gridHit.input.cursor = cur;
        // Force canvas update while still hovering the same hit rect
        if (this.scene?.input?.manager?.canvas) {
            this.scene.input.manager.canvas.style.cursor = cur;
        }
    }

    _updateGridCursor(pointer) {
        this._setGridCursor(!!this._stoneCellAt(pointer));
    }

    _onGridClick(pointer) {
        const cell = this._stoneCellAt(pointer);
        if (!cell) return;
        this._applyChip(cell.gx, cell.gy);
        // Cursor may need to drop if that cell (or neighbors) vanished
        this._updateGridCursor(pointer);
    }

    _applyChip(x, y) {
        const out = Knapping.chip(this.grid, x, y);
        if (!(out.removed > 0)) return;

        // First real chip spends the blank
        this._consumeBlankOnce();
        this._chipped = true;
        this._syncFinishLabel();

        this.grid = out.grid;
        this._redraw();
        if (out.shattered) {
            this._shattered = true;
            this.preview.setText(out.reason || "It shattered");
            this.scene.combatLog?.push(out.reason || "It shattered");
            // Stay open — player dismisses with Finish
            this.btnFinish.label.setText("[ Finish ]");
            return;
        }
        this._refreshPreview();
    }

    rotate() {
        if (!this.visible || !this.grid || this._shattered || this._finished) return; // locked after fail
        this.grid = Knapping.rotateCW(this.grid);
        if (this.pixels) this.pixels = Knapping.rotatePixelsCW(this.pixels);
        this._rotated = true;
        this._redraw();
        this._refreshPreview();
    }

    /** Close without cost if untouched; finish tool, or dismiss after a fail. */
    finishOrClose() {
        if (!this.visible || this._finished) return;
        if (this._shattered) {
            this.close();
            return;
        }
        if (!this._chipped) {
            // Rotate-only rework: keep the new orientation on the held tool
            if (this._rework && this._rotated) this._writeBackOrientation();
            this.close();
            return;
        }
        this.finish();
    }

    finish() {
        if (!this.visible || this._finished) return;
        // Failed knap: Finish just closes (blank already spent)
        if (this._shattered) {
            this.close();
            return;
        }
        if (!this.grid || !this._chipped) {
            this.close();
            return;
        }
        const fail = Knapping.shatterCheck(this.grid);
        if (fail.shattered) {
            this._shattered = true;
            this.preview.setText(fail.reason || "It crumbled");
            this.scene.combatLog?.push(fail.reason || "It crumbled");
            this.btnFinish.label.setText("[ Finish ]");
            return;
        }

        this._consumeBlankOnce();
        let stack = null;
        try {
            const result = Knapping.classify(this.grid, this.material);
            stack = Knapping.makeToolStack(result, {
                grid: this.grid,
                pixels: this.pixels,
                scene: this.scene
            });
        } catch (_) {
            const result = Knapping.classify(this.grid, this.material);
            stack = Knapping.makeToolStack(result, {
                grid: this.grid,
                pixels: this.pixels,
                scene: this.scene
            });
        }
        if (this._rework && typeof Durability !== "undefined") {
            Durability.carryDurabilityAfterRework(
                {
                    durability: this._reworkDurability,
                    knapQuality: this._reworkQuality,
                    toolClass: this._reworkToolClass,
                    id: this.blankItemId
                },
                stack,
                this.scene.getItem(this.blankItemId),
                this.scene.getItem(stack.id)
            );
        }
        this._finished = true;
        const verb = this._rework ? "reshaped" : "knapped";
        const ok = this._grantTool(stack);
        if (ok) {
            this.scene.combatLog?.push(`You ${verb} a ${stack.customName}`);
        } else {
            this.scene.combatLog?.push?.(
                `You ${verb} a ${stack?.customName || "tool"}, but it fell out of reach`
            );
        }
        this.close();
    }

    /**
     * Put the finished tool in the hotbar (prefer the blank's old slot), else drop.
     * @returns {boolean}
     */
    _grantTool(stack) {
        const player = this.scene.player;
        if (!player || !stack) return false;
        const meta = this.scene.getItem(stack.id) || {
            id: stack.id,
            key: stack.knapMaterial === "flint" ? "flint" : "pebble",
            maxStack: 1,
            name: stack.customName || "Tool",
            weight: 0.3
        };
        const clone = typeof cloneItemStack === "function"
            ? cloneItemStack(stack)
            : { ...stack };

        if (this._isDedicated()) {
            this._notifyKnap("finish", { stack: clone });
        }

        // Prefer the slot that held the blank (now empty after consume)
        const prefer = this.blankSlotIndex;
        if (prefer >= 0 && prefer < player.inventorySize && !player.inventory[prefer]) {
            player.inventory[prefer] = clone;
            this.scene.hotbar.dirty = true;
            return true;
        }
        if (typeof player.gainStack === "function" && player.gainStack(stack)) {
            return true;
        }
        // gainStack clones again — if it failed, try manual insert then ground drop
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
        // Dedicated: server drops the overflow — don't also SPAWN_DROP a stripped copy
        if (this._isDedicated()) return true;
        const drop = DroppedItem.spawn(
            this.scene, player.x, player.y, meta, 1, undefined,
            typeof knapStackExtras === "function" ? knapStackExtras(stack) : mealStackExtras?.(stack)
        );
        return !!drop;
    }

    close() {
        if (!this.visible) return;
        if (this._blankConsumed && !this._finished) this._notifyKnap("abort");
        this.visible = false;
        this.container.setVisible(false);
        this.grid = null;
        this.pixels = null;
        this.blankItemId = null;
        this.blankSlotIndex = -1;
        this._finished = false;
        this._shattered = false;
        this._chipped = false;
        this._blankConsumed = false;
        this._rework = false;
        this._rotated = false;
        this._syncFinishLabel();
        this._setGridCursor(false);
        if (this.scene._tooltipTarget === this.helpBtn) this.scene.hideTooltip();
        this._helpPressed = false;
        this.helpBtn?.setTexture("help_alt").setVisible(false);
        // Dedicated: apply YOU gear that arrived while knapping UI owned inventory
        this.scene._flushPendingYouGear?.();
    }

    update() {
        if (!this.visible) return;
        if (Phaser.Input.Keyboard.JustDown(this._keyR)) this.rotate();
        // Esc = same as Close/Finish (grant tool if you've chipped — don't void it)
        if (Phaser.Input.Keyboard.JustDown(this._keyEsc)) this.finishOrClose();
    }
}
