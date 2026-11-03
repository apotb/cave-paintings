class StoragePanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.storage = null;
        this.slotViews = [];

        this.container = scene.add.container(0, 0).setVisible(false).setDepth(250);
        if (scene._uiCam) scene._uiCam.ignore(this.container);

        this._dragging = false;
        this._dragFromKey = null;
        this._dragIcon = null;
        this._pointerDownPos = null;
        this._pointerIsDown = false;

        this._buildSlots();
        this._buildTake();
        this._buildSettle();
        this._buildDye();

        this.dryBarBg = scene.add.graphics();
        this.dryBarFill = scene.add.graphics();
        this.container.add(this.dryBarBg);
        this.container.add(this.dryBarFill);

        scene.input.on("pointermove", (pointer) => {
            if (this._dragIcon && this._dragging) {
                this._dragIcon.setPosition(pointer.x, pointer.y);
            }
        });
        scene.input.on("pointerup", (pointer) => this._onPointerUp(pointer));
    }

    _worldUiScale() {
        const s = this.scene.uiScale || 1;
        const zoom = this.scene.worldZoom || 1;
        return s / zoom;
    }

    _isStoragePit() {
        return typeof Place !== "undefined"
            && Place.isStoragePit(this.storage?.meta, this.storage?.entry);
    }

    _pitFinished() {
        if (!this._isStoragePit()) return true;
        return Place.pitFinished(this.storage?.entry);
    }

    _slotCount() {
        if (this._isStoragePit() && !this._pitFinished()) return 0;
        const entry = this.storage?.entry;
        const def = this.storage?.meta;
        if (typeof Place !== "undefined") return Place.storageSlotCount(def, entry) || 8;
        return Array.isArray(entry?.slots) ? entry.slots.length : 8;
    }

    _pitFillCost() {
        return Math.max(0, Math.floor(Number(this.storage?.entry?.digTaken) || 0));
    }

    _pitDestroyReady() {
        if (!this._isStoragePit()) return null;
        if (!this.storage?.isEmpty?.()) return false;
        const cost = this._pitFillCost();
        if (!(cost > 0)) return true;
        const fillId = Place.pitFillItem(this.storage.entry);
        return (this.scene.player?.getNumItems?.(fillId) || 0) >= cost;
    }

    /** Check or cross plus the pile it takes to fill the hole. */
    _destroyCostTip() {
        if (!this._isStoragePit()) return "";
        const cost = this._pitFillCost();
        if (!(cost > 0)) return "";
        const fillId = Place.pitFillItem(this.storage?.entry);
        const meta = this.scene.getItem?.(fillId);
        const name = meta?.name || fillId;
        const have = (this.scene.player?.getNumItems?.(fillId) || 0) >= cost;
        return {
            text: "",
            lines: [
                { plain: true, label: "Filling this hole will cost:" },
                { mark: have ? "on" : "off", label: `x${cost} ${name}` }
            ]
        };
    }

    _isDryingRack() {
        if (typeof Hide === "undefined") return false;
        return Hide.isDryingRack(this.storage?.meta, this.storage?.entry);
    }

    _acceptsStack(stack) {
        if (!stack) return false;
        const meta = this.scene.getItem(stack.id);
        const def = this.storage?.meta;
        if (typeof Hide !== "undefined" && !Hide.slotAccepts(def, meta)) return false;
        if (def?.id === "fishing_net") {
            const slot = this.storage?.entry?.slots?.[0];
            if (slot?.id) return false;
            return this._netCanBait();
        }
        return true;
    }

    /** A grub goes in only while this water can still be fished. */
    _netCanBait() {
        const entry = this.storage?.entry;
        const WG = typeof WorldGen !== "undefined" ? WorldGen : null;
        const FishApi = typeof Fish !== "undefined" ? Fish : null;
        if (!entry || !WG?.tileKeyAt || !FishApi?.measure || !FishApi.fishable) return false;
        const ts = this.scene.tileSize || 16;
        const tx = Math.floor(entry.x / ts);
        const ty = Math.floor((entry.y - 1) / ts);
        const measured = FishApi.measure(tx, ty, (x, y) => WG.tileKeyAt(x, y) === "water");
        const fisheries = this.scene.sim?.fisheries || null;
        return !!FishApi.fishable(measured, fisheries);
    }

    _slotMax() {
        if (typeof Hide === "undefined") return 0;
        return Hide.slotMax(this.storage?.meta) || 0;
    }

    _prepareOutgoing(stack) {
        const piece = this._cloneStack(stack);
        if (!this._isDryingRack() || typeof Hide === "undefined") return piece;
        const now = this.scene.worldMinuteIndex?.() ?? null;
        return Hide.hangStack(piece, now, (id) => this.scene.getItem(id));
    }

    tryHangHeldHide(storage) {
        if (!storage || typeof Hide === "undefined") return false;
        if (!Hide.isDryingRack(storage.meta, storage.entry)) return false;
        if (!storage.inRange?.()) return false;
        const dest = storage.getSlot(0);
        if (dest && dest.quantity > 0) return false;
        const idx = this.scene.hotbar?.activeIndex;
        if (!Number.isInteger(idx) || idx < 0) return false;
        const held = this.scene.player?.inventory?.[idx];
        if (!held) return false;
        const meta = this.scene.getItem(held.id);
        if (!Hide.isHide(meta)) return false;
        const prev = this.storage;
        const was = this.visible;
        this.storage = storage;
        this._depositFromHotbar("0", idx, null, 1);
        const hung = !!(storage.getSlot(0)?.quantity > 0);
        if (!was) {
            this.storage = prev;
            if (!prev) {
                this.visible = false;
                this.container.setVisible(false);
            }
        } else {
            this.refresh();
        }
        return hung;
    }

    _buildSlots() {
        for (let i = 0; i < 8; i++) {
            const key = String(i);
            const slot = this.scene.add.image(0, 0, "slot")
                .setOrigin(0.5, 0.5)
                .setInteractive({ cursor: "pointer" });
            slot.storageKey = key;

            const icon = this.scene.add.image(0, 0, "")
                .setOrigin(0.5, 0.5)
                .setVisible(false)
                .setScale(3);

            const qty = this.scene.add.text(0, 0, "", {
                fontSize: `${pixelUiFontSize(16, 1)}px`,
                fontFamily: PIXEL_UI_FONT,
                color: "#ffffff",
                stroke: "#000000",
                strokeThickness: 2
            }).setOrigin(1, 1).setVisible(false);

            slot.on("pointerover", (p) => {
                this.scene.showTooltip(
                    () => {
                        const stack = this._stackFor(key);
                        if (!stack) {
                            const label = this.storage?.meta?.storage?.slotLabel;
                            return label || "Storage";
                        }
                        const meta = this.scene.getItem(stack.id);
                        const def = this.storage?.meta;
                        const entry = this.storage?.entry;
                        const spoilPaused = typeof Hide !== "undefined"
                            && Hide.isDryingRack(def, entry)
                            && Hide.pausesRackSpoil(meta);
                        const spoilScale = (!spoilPaused && typeof Place !== "undefined"
                            && Place.pitSlowsSpoil(def, entry))
                            ? Number(def?.storage?.spoilScale)
                            : null;
                        return this.scene.formatItemTooltip(
                            meta, stack.quantity, stack.spoilAt, stack, { spoilPaused, spoilScale }
                        );
                    },
                    p.x, p.y, slot
                );
            });
            slot.on("pointerout", (pointer) => {
                if (this.scene._tooltipTarget !== slot) return;
                if (pointer && this.getSlotAt(pointer.x, pointer.y) === key) return;
                this.scene.hideTooltip();
            });

            slot.on("pointerdown", (pointer) => {
                if (pointer.rightButtonDown()) {
                    this._returnStackToHotbar(key, pointer);
                    return;
                }
                this._pointerDownPos = { x: pointer.x, y: pointer.y };
                this._pointerIsDown = true;
                this._dragFromKey = key;
                this._dragging = false;
            });

            slot.on("pointermove", (pointer) => {
                if (!this._pointerIsDown || this._dragging) return;
                if (this._dragFromKey !== key) return;
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

            const fill = this.scene.add.image(0, 0, "")
                .setOrigin(0.5, 0.5)
                .setVisible(false)
                .setScale(3);

            this.container.add(slot);
            this.container.add(icon);
            this.container.add(fill);
            this.container.add(qty);
            const bar = this.scene.add.graphics();
            this.container.add(bar);
            const badges = createIngredientBadges(this.scene, (img) => {
                this.container.add(img);
            });
            this.slotViews.push({ key, slot, icon, fill, qty, bar, badges });
        }
    }

    _buildTake() {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;

        this.takeRect = this.scene.add.rectangle(0, 0, 78, 28, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });
        this.takeText = this.scene.add.text(0, 0, "Take", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        this.takeBtn = this.scene.add.container(0, 0, [this.takeRect, this.takeText]);

        this._takeHovering = false;
        this._takePressing = false;
        this._takeEnabled = true;
        this._takeBw = 78;
        this._takeBh = 28;
        this._paintTake = () => {
            const strokeW = typeof pixelUiWorldStroke === "function"
                ? pixelUiWorldStroke(this.scene)
                : 2 / (this.scene.worldZoom || 1);
            if (!this._takeEnabled) {
                this.takeRect.setFillStyle(BG, 1);
                this.takeRect.setStrokeStyle(strokeW, OUTLINE);
                this.takeText.setColor("#6a5a4a");
                return;
            }
            if (this._takePressing) {
                this.takeRect.setFillStyle(BG_PRESS, 1);
                this.takeRect.setStrokeStyle(strokeW, OUTLINE_PRESS);
            } else if (this._takeHovering) {
                this.takeRect.setFillStyle(BG, 1);
                this.takeRect.setStrokeStyle(strokeW, OUTLINE_HOVER);
            } else {
                this.takeRect.setFillStyle(BG, 1);
                this.takeRect.setStrokeStyle(strokeW, OUTLINE);
            }
            this.takeText.setColor("#d4c4a8");
        };

        this.takeRect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown() || !this._takeEnabled) return;
            this._takePressing = true;
            this._paintTake();
        });
        this.takeRect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = this._takePressing;
            this._takePressing = false;
            this._syncTakeHover();
            this._paintTake();
            if (was && this._takeHovering && this._takeEnabled) this._tryTake();
        });
        this.takeRect.on("pointerover", (p) => {
            if (!this._destroyCostTip()) return;
            this.scene.showTooltip(() => this._destroyCostTip() || "", p.x, p.y, this.takeRect);
        });
        this.takeRect.on("pointerout", () => {
            if (this.scene._tooltipTarget === this.takeRect) this.scene.hideTooltip();
        });

        this.container.add(this.takeBtn);
    }

    _buildSettle() {
        const sys = this.scene.settlementSys;
        if (!sys) return;
        this._settleUi = sys.makeStationButton(() => {
            if (this.storage) sys.toggleStation(this.storage);
            this._syncSettle();
        });
        this._billUi = sys.makeWorldButton("Storage", () => {
            if (!this.storage) return;
            const S = typeof Settlement !== "undefined" ? Settlement : null;
            const kind = S?.stationKind?.(this.storage?.entry?.id || this.storage?.meta?.id);
            if (kind === "rack") sys.openBills?.(this.storage);
            else sys.openStorageFilter?.(this.storage);
        });
        this._rotateUi = sys.makeRotateButton((ccw) => {
            if (this.storage) this.scene.tryRotateStation?.(this.storage, { ccw });
        });
        this.container.add(this._settleUi.btn);
        this.container.add(this._billUi.btn);
        this.container.add(this._rotateUi.btn);
        this._settleUi.btn.setVisible(false);
        this._billUi.btn.setVisible(false);
        this._rotateUi.btn.setVisible(false);
    }

    _canColor() {
        const id = this.storage?.entry?.id || this.storage?.meta?.id;
        return id === "wicker_basket" || id === "storage_pit";
    }

    _buildDye() {
        const scene = this.scene;
        const BG_STROKE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const size = 28;
        const rect = scene.add.rectangle(0, 0, size, size, 0x6c552e, 1)
            .setStrokeStyle(2, BG_STROKE)
            .setInteractive({ useHandCursor: true });
        const btn = scene.add.container(0, 0, [rect]);
        const ui = {
            btn,
            rect,
            _hovering: false,
            _pressing: false,
            _side: size
        };
        const strokeW = () => (typeof pixelUiWorldStroke === "function"
            ? pixelUiWorldStroke(scene)
            : 2 / (scene.worldZoom || 1));
        const currentHex = () => {
            if (typeof Place !== "undefined" && Place.basketDyeColor) {
                return Place.basketDyeColor(this.storage?.entry?.dye);
            }
            return "6c552e";
        };
        const paint = () => {
            if (!rect?.active || !rect.geom) return;
            const sw = strokeW();
            rect.setFillStyle(parseInt(currentHex(), 16), 1);
            if (ui._pressing || this._dyeOpen) rect.setStrokeStyle(sw, OUTLINE_PRESS);
            else if (ui._hovering) rect.setStrokeStyle(sw, OUTLINE_HOVER);
            else rect.setStrokeStyle(sw, BG_STROKE);
        };
        ui.paint = paint;
        ui.setSize = (side) => {
            if (!rect?.active || !rect.geom) return;
            const n = Math.max(8, Number(side) || size);
            ui._side = n;
            rect.setSize(n, n);
            if (rect.input) {
                if (rect.input.hitArea?.setTo) rect.input.hitArea.setTo(0, 0, n, n);
                else if (rect.input.hitArea?.setSize) rect.input.hitArea.setSize(n, n);
            } else {
                rect.setInteractive({ useHandCursor: true });
            }
            paint();
        };
        rect.on("pointerover", (pointer) => {
            ui._hovering = true;
            paint();
            scene.showTooltip?.(() => "Color", pointer.x, pointer.y, rect);
        });
        rect.on("pointerout", (pointer) => {
            if (pointer) {
                const cam = scene.cameras?.main;
                const pt = cam ? cam.getWorldPoint(pointer.x, pointer.y) : { x: pointer.x, y: pointer.y };
                const b = rect.getBounds?.();
                if (b && Phaser.Geom.Rectangle.Contains(b, pt.x, pt.y)) return;
            }
            ui._hovering = false;
            ui._pressing = false;
            paint();
            if (scene._tooltipTarget === rect) scene.hideTooltip?.();
        });
        rect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown()) return;
            ui._pressing = true;
            paint();
        });
        rect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = ui._pressing && ui._hovering;
            ui._pressing = false;
            paint();
            if (was) this._setDyeOpen(!this._dyeOpen);
        });
        this._dyeUi = ui;
        this.container.add(btn);
        btn.setVisible(false);
        paint();

        const menu = scene.add.container(0, 0).setVisible(false);
        const bg = scene.add.rectangle(0, 0, size, size, 0x120e0a, 1)
            .setStrokeStyle(2, BG_STROKE);
        menu.add(bg);
        const dyes = (typeof Place !== "undefined" && Place.BASKET_DYES) || [];
        const swatches = [];
        for (let i = 0; i < dyes.length; i++) {
            const dye = dyes[i];
            const sw = scene.add.rectangle(0, 0, size, size, 0x241910, 1)
                .setStrokeStyle(2, BG_STROKE)
                .setInteractive({ useHandCursor: true });
            const icon = scene.add.image(0, 0, "slot")
                .setOrigin(0.5, 0.5)
                .setVisible(false);
            const row = { dye, rect: sw, icon, _hovering: false, _pressing: false };
            sw.on("pointerover", (pointer) => {
                row._hovering = true;
                this._paintDyeSwatches();
                scene.showTooltip?.(() => dye.name, pointer.x, pointer.y, sw);
            });
            sw.on("pointerout", (pointer) => {
                if (pointer) {
                    const cam = scene.cameras?.main;
                    const pt = cam ? cam.getWorldPoint(pointer.x, pointer.y) : { x: pointer.x, y: pointer.y };
                    const b = sw.getBounds?.();
                    if (b && Phaser.Geom.Rectangle.Contains(b, pt.x, pt.y)) return;
                }
                row._hovering = false;
                row._pressing = false;
                this._paintDyeSwatches();
                if (scene._tooltipTarget === sw) scene.hideTooltip?.();
            });
            sw.on("pointerdown", (pointer, _lx, _ly, event) => {
                event?.stopPropagation?.();
                if (pointer.rightButtonDown()) return;
                row._pressing = true;
                this._paintDyeSwatches();
            });
            sw.on("pointerup", (pointer, _lx, _ly, event) => {
                event?.stopPropagation?.();
                const was = row._pressing && row._hovering;
                row._pressing = false;
                this._paintDyeSwatches();
                if (was) this._chooseDye(dye.color);
            });
            menu.add(sw);
            menu.add(icon);
            swatches.push(row);
        }
        this._dyeMenu = menu;
        this._dyeMenuBg = bg;
        this._dyeSwatches = swatches;
        this._dyeOpen = false;
        this.container.add(menu);
        for (const row of swatches) row.rect.disableInteractive();
    }

    _setDyeOpen(on) {
        const open = !!on && this._canColor() && !!this.visible;
        this._dyeOpen = open;
        this._dyeMenu?.setVisible(open);
        for (const row of this._dyeSwatches || []) {
            if (open) {
                if (typeof ensurePointerInteractive === "function") ensurePointerInteractive(row.rect);
                else row.rect?.setInteractive?.({ useHandCursor: true });
            } else {
                row.rect?.disableInteractive?.();
                row._hovering = false;
                row._pressing = false;
                if (this.scene._tooltipTarget === row.rect) this.scene.hideTooltip?.();
            }
        }
        if (open) this.container.bringToTop(this._dyeMenu);
        this._paintDyeSwatches();
        this._dyeUi?.paint?.();
    }

    _chooseDye(color) {
        const entry = this.storage?.entry;
        if (!entry || !this._canColor()) return;
        const dye = (typeof Place !== "undefined" && Place.normalizeBasketDye)
            ? Place.normalizeBasketDye(color)
            : null;
        if (dye) entry.dye = dye;
        else delete entry.dye;
        this.storage.applyVisual?.();
        this._syncDyeButton();
        this._notifyStorage("dye", { dye: dye || null });
        if (this.scene.hotbar) this.scene.hotbar.dirty = true;
    }

    _syncDyeButton() {
        const show = this._canColor() && !!this.visible;
        this._dyeUi?.btn?.setVisible(show);
        if (!show) {
            this._dyeUi?.rect?.disableInteractive?.();
            if (this._dyeOpen) this._setDyeOpen(false);
            return;
        }
        if (typeof ensurePointerInteractive === "function") ensurePointerInteractive(this._dyeUi.rect);
        else this._dyeUi?.rect?.setInteractive?.({ useHandCursor: true });
        this._dyeUi?.paint?.();
        this._paintDyeSwatches();
    }

    _paintDyeSwatches() {
        const scene = this.scene;
        const sw = typeof pixelUiWorldStroke === "function"
            ? pixelUiWorldStroke(scene)
            : 2 / (scene.worldZoom || 1);
        const current = (typeof Place !== "undefined" && Place.normalizeBasketDye)
            ? Place.normalizeBasketDye(this.storage?.entry?.dye)
            : null;
        if (this._dyeMenuBg?.active) {
            this._dyeMenuBg.setStrokeStyle(sw, 0x2a2218);
        }
        for (const row of this._dyeSwatches || []) {
            const rect = row.rect;
            if (!rect?.active) continue;
            const picked = (typeof Place !== "undefined" && Place.normalizeBasketDye)
                ? Place.normalizeBasketDye(row.dye.color) === current
                : false;
            const key = this._dyePreviewKey(row.dye.color);
            const icon = row.icon;
            if (icon?.active && key && scene.textures?.exists?.(key)) {
                if (icon.texture?.key !== key) icon.setTexture(key);
                this._fitDyeIcon(row);
                icon.setVisible(true);
                rect.setFillStyle(0x241910, 1);
            } else {
                icon?.setVisible(false);
                rect.setFillStyle(parseInt(row.dye.color, 16), 1);
            }
            if (row._pressing || picked) rect.setStrokeStyle(sw, 0xd4a84b);
            else if (row._hovering) rect.setStrokeStyle(sw, 0xffffff);
            else rect.setStrokeStyle(sw, 0xc4b49a);
        }
    }

    _dyePreviewKey(color) {
        const scene = this.scene;
        const id = this.storage?.entry?.id || this.storage?.meta?.id;
        if (!scene?.textures || !id) return null;
        if (id === "storage_pit" && typeof ensureStoragePitTexture === "function") {
            return ensureStoragePitTexture(scene, color);
        }
        if (id === "wicker_basket" && typeof ensureBasketDyeTexture === "function") {
            const meta = this.storage.meta;
            let base = (typeof Place !== "undefined" && Place.facingTextureKey)
                ? Place.facingTextureKey(meta, this.storage.entry?.rot)
                : (meta?.key || "wicker_basket");
            if (!scene.textures.exists(base)) {
                const plain = meta?.key || "wicker_basket";
                if (scene.textures.exists(plain)) base = plain;
            }
            return ensureBasketDyeTexture(scene, base, color);
        }
        return null;
    }

    _fitDyeIcon(row) {
        const icon = row?.icon;
        if (!icon?.active) return;
        const n = row._side || row.rect?.width || 28;
        const stroke = (typeof pixelUiWorldStroke === "function")
            ? pixelUiWorldStroke(this.scene)
            : 1;
        const inset = Math.max(stroke, n * 0.08);
        const box = Math.max(4, n - inset * 2);
        icon.setDisplaySize(box, box);
    }

    _layoutDyeMenu(side) {
        const swatches = this._dyeSwatches || [];
        if (!this._dyeMenu || !swatches.length) return;
        const n = Math.max(8, Number(side) || 28);
        const cols = 3;
        const rows = Math.ceil(swatches.length / cols);
        const gap = Math.max(2, n * 0.22);
        const pad = Math.max(3, n * 0.2);
        const menuW = pad * 2 + cols * n + (cols - 1) * gap;
        const menuH = pad * 2 + rows * n + (rows - 1) * gap;
        this._dyeMenuBg?.setSize(menuW, menuH);
        for (let i = 0; i < swatches.length; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = -menuW / 2 + pad + n / 2 + col * (n + gap);
            const y = -menuH / 2 + pad + n / 2 + row * (n + gap);
            const rect = swatches[i].rect;
            swatches[i]._side = n;
            rect.setSize(n, n).setPosition(x, y);
            swatches[i].icon?.setPosition(x, y);
            this._fitDyeIcon(swatches[i]);
            if (rect.input?.hitArea?.setTo) rect.input.hitArea.setTo(0, 0, n, n);
            else if (rect.input?.hitArea?.setSize) rect.input.hitArea.setSize(n, n);
        }
        this._dyeMenuSize = { w: menuW, h: menuH };
        this._paintDyeSwatches();
    }

    _placeDyeMenu() {
        const dye = this._dyeUi?.btn;
        const size = this._dyeMenuSize;
        if (!dye || !size || !this._dyeMenu) return;
        const gap = this._actionRow?.gap || 8;
        const side = this._dyeUi?._side || 28;
        // Hang the menu down from the dye button so it stays clear of Take.
        this._dyeMenu.setPosition(
            dye.x - side / 2 - gap - size.w / 2,
            dye.y + (size.h - side) / 2
        );
    }

    _pointerOnDye(pointer) {
        if (!this.visible || !pointer) return false;
        const pt = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const hit = (rect, vis) => !!(vis && rect?.getBounds
            && Phaser.Geom.Rectangle.Contains(rect.getBounds(), pt.x, pt.y));
        if (hit(this._dyeUi?.rect, this._dyeUi?.btn?.visible)) return true;
        if (!this._dyeMenu?.visible) return false;
        if (hit(this._dyeMenuBg, true)) return true;
        for (const row of this._dyeSwatches || []) {
            if (hit(row.rect, true)) return true;
        }
        return false;
    }

    _syncSettle() {
        this.scene.settlementSys?.syncStationButton(this._settleUi, this.storage);
        const added = this.scene.settlementSys?.isAdded(this.storage);
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const kind = S?.stationKind?.(this.storage?.entry?.id || this.storage?.meta?.id);
        const showBills = !!added && (kind === "storage" || kind === "rack");
        this._billUi?.btn.setVisible(showBills);
        this._billUi?.setLabel?.(kind === "rack" ? "Bills" : "Storage");
        this._placeActionRow();
    }

    _stackFor(key) {
        if (!this.storage) return null;
        const idx = typeof Place !== "undefined"
            ? Place.parseSlotIndex(key, this._slotCount())
            : parseInt(key, 10);
        if (idx < 0) return null;
        return this.storage.getSlot(idx);
    }

    _setStack(key, stack) {
        if (!this.storage) return;
        const idx = typeof Place !== "undefined"
            ? Place.parseSlotIndex(key, this._slotCount())
            : parseInt(key, 10);
        if (idx < 0) return;
        this.storage.setSlot(idx, stack);
    }

    _isDedicated() {
        return !!(this.scene.simAuth());
    }

    _notifyStorage(op, extra = {}) {
        if (!this._isDedicated() || !this.storage || typeof NetProtocol === "undefined") return;
        const entry = this.storage.entry || {};
        if (!entry.uid && typeof Place !== "undefined") {
            Place.ensureStorageEntry(entry, this.storage.meta);
        }
        if (op !== "attend" && op !== "leave") {
            this.scene._invSwapGuardUntil = performance.now() + 1000;
            this.scene._netSendMove?.(true);
        }
        this.scene.net.sendAction({
            type: NetProtocol.Actions.STORAGE,
            op,
            uid: entry.uid,
            x: this.storage.x,
            y: this.storage.y,
            pawnId: this.scene.player?.pawnId,
            ...extra
        });
    }

    open(storage) {
        if (this.scene.restBlocksWorldUi?.()) return;
        if (this.scene.corpsePanel?.visible) this.scene.corpsePanel.close();
        if (this.scene.campfirePanel?.visible) this.scene.campfirePanel.close();
        if (this.scene.leanToPanel?.visible) this.scene.leanToPanel.close();
        if (this.scene.paintingCirclePanel?.visible) this.scene.paintingCirclePanel.close();
        this.scene.closeCraftStationMenu?.();

        if (this.storage && this.storage !== storage) {
            this.storage.syncPitLid?.(false);
            this._notifyStorage("leave");
        }
        const prev = this.storage;
        this.storage = storage;
        this.scene._refreshStationInteractMarks?.(prev, storage);
        if (storage) {
            storage._storageTipHold = false;
            if (this.scene._storageTipHold === storage) this.scene._storageTipHold = null;
        }
        if (storage?.entry && typeof Place !== "undefined") {
            Place.ensureStorageEntry(storage.entry, storage.meta);
        }
        this._setDyeOpen(false);
        this.visible = true;
        this.container.setVisible(true);
        this.container.setPosition(storage.x, storage.y);
        storage.syncPitLid?.(true);
        this.refresh();
        this.layout();
        this._notifyStorage("attend");
    }

    toggle(storage) {
        if (this.visible && this.storage === storage) this.close();
        else this.open(storage);
    }

    close() {
        const prev = this.storage;
        this._setDyeOpen(false);
        this._notifyStorage("leave");
        this.visible = false;
        this.storage = null;
        this.scene._refreshStationInteractMarks?.(prev);
        prev?.syncPitLid?.(false);
        this.container.setVisible(false);
        this._cancelDrag();
        // The hover scan rebuilds a tip it just hid, which flashes the contents
        // icons. Keep the sprite's own tip; hold a new one until the pointer leaves.
        const keepSpriteTip = !!(prev && this.scene._tooltipTarget === prev);
        if (!keepSpriteTip) this.scene.hideTooltip();
        if (prev) {
            prev._storageTipHold = true;
            this.scene._storageTipHold = prev;
        }
        this.scene._flushPendingYouGear?.();
        if (this.scene.hotbar) {
            this.scene.hotbar.dirty = true;
            this.scene.hotbar.layout?.();
            this.scene.hotbar.dirty = false;
        }
    }

    refresh() {
        if (!this.storage) return;
        const ws = this._worldUiScale();
        const n = this._slotCount();

        for (let i = 0; i < this.slotViews.length; i++) {
            const view = this.slotViews[i];
            const showSlot = i < n;
            view.slot.setVisible(showSlot);
            if (showSlot) ensurePointerInteractive(view.slot);
            else disableInteractiveIfOn(view.slot);

            const stack = showSlot ? this._stackFor(view.key) : null;
            const meta = stack ? this.scene.getItem(stack.id) : null;
            syncStackIcon(
                view.icon, view.fill, stack, meta,
                id => this.scene.getItem(id), this.scene.textures, 3 * ws
            );
            if (stack && stack.quantity > 1) {
                view.qty.setText(String(stack.quantity)).setVisible(true);
            } else {
                view.qty.setVisible(false);
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

        this._syncTakeButton();
        this._syncDyeButton();
        this.refreshDryBar();
    }

    /** Enable Fill/Take from the pit's contents and what the player is holding. */
    _syncTakeButton() {
        if (!this.storage) return;
        const empty = !!this.storage.isEmpty?.();
        const pitReady = this._pitDestroyReady();
        const label = this._isStoragePit() ? "Fill" : "Take";
        const enabled = pitReady == null ? empty : !!pitReady;
        if (this.takeText?.text !== label || enabled !== this._takeEnabled) {
            this.takeText?.setText(label);
            this._takeEnabled = enabled;
            this.takeBtn?.setVisible(true);
        }
        // Stay hoverable while greyed out so the fill-cost tip can show.
        this._syncTakeHitArea(true);
        if (this.takeRect?.input) {
            this.takeRect.input.cursor = enabled ? "pointer" : "default";
            this.takeRect.input.useHandCursor = !!enabled;
        }
        this._syncTakeHover();
    }

    refreshDryBar() {
        this.dryBarBg?.clear();
        this.dryBarFill?.clear();
        if (!this.storage || typeof Hide === "undefined") return;
        const def = this.storage.meta;
        if (!Hide.isDryingRack(def, this.storage.entry)) return;
        const stack = this.storage.getSlot(0);
        const meta = stack ? this.scene.getItem(stack.id) : null;
        if (!Hide.isFleshedHide(meta)) return;
        const view = this.slotViews[0];
        if (!view?.slot?.visible) return;
        const minutes = Hide.DRY_MINUTES || 1440;
        const prog = Hide.dryProgressOf(stack);
        if (!(minutes > 0)) return;

        const src = 64;
        const slotW = view.slot.displayWidth;
        const slotH = view.slot.displayHeight;
        const px = slotW / src;
        const barH = 4 * px;
        const inset = 4 * px;
        const x = view.slot.x - slotW / 2 + inset;
        const y = view.slot.y + slotH / 2 - barH;
        const maxW = slotW - inset * 2;
        const progress = Phaser.Math.Clamp(prog / minutes, 0, 1);
        if (progress > 0) {
            this.dryBarFill.fillStyle(0xe8a040, 1);
            this.dryBarFill.fillRect(x, y, maxW * progress, barH);
        }
    }

    layout() {
        if (!this.storage) return;
        const s = this.scene.uiScale || 1;
        const ws = this._worldUiScale();
        const padding = 4 * ws;
        const slotImg = this.scene.textures.get("slot").getSourceImage();
        const baseW = slotImg ? slotImg.width : 32;
        const slotW = baseW * ws;
        const spacing = slotW + padding;
        const objH = this.storage.displayHeight || 16;
        const n = this._slotCount();
        const cols = typeof Place !== "undefined"
            ? Place.storageLayoutCols(n)
            : Math.min(4, Math.max(1, n));
        const rows = Math.ceil(n / cols);
        const bottomRowY = typeof worldUiAboveY === "function"
            ? worldUiAboveY(this.scene, objH, slotW)
            : -(objH + 2 + slotW / 2);

        const zoom = this.scene.worldZoom || 1;
        for (let i = 0; i < this.slotViews.length; i++) {
            const view = this.slotViews[i];
            if (i >= n) continue;
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = (col - (cols - 1) / 2) * spacing;
            const y = bottomRowY - (rows - 1 - row) * spacing;
            view.slot.setScale(ws).setPosition(x, y);
            view.icon.setScale(3 * ws).setPosition(x, y);
            view.fill.setScale(3 * ws).setPosition(x, y);
            view.qty.setStroke("#000000", Math.max(2, Math.round(2 * s)));
            if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(view.qty, 16, this.scene);
            else {
                view.qty.setResolution(zoom * (window.devicePixelRatio || 1));
                view.qty.setFontSize(`${pixelUiFontSize(16, s)}px`);
                view.qty.setScale(1 / zoom);
            }
            view.qty.setPosition(x + slotW / 2 - 4 * ws, y + slotW / 2 - 4 * ws);
        }

        const bw = 78 * ws;
        const bh = 28 * ws;
        this._takeBw = bw;
        this._takeBh = bh;
        this.takeRect.setSize(bw, bh);
        if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(this.takeText, 16, this.scene);
        else {
            this.takeText.setResolution(zoom * (window.devicePixelRatio || 1));
            this.takeText.setFontSize(`${pixelUiFontSize(16, s)}px`);
            this.takeText.setScale(1 / zoom);
        }
        const actionY = typeof worldUiButtonY === "function"
            ? worldUiButtonY(this.scene, 0, bh)
            : 2 + bh / 2;
        const gap = 8 * ws;
        this._actionRow = { y: actionY, bw, bh, gap };
        this._settleUi?.setSize(bh);
        this._dyeUi?.setSize(bh);
        this._layoutDyeMenu(bh);
        this._syncSettle();
        if (this._billUi) {
            this._billUi.rect.setSize(bw, bh);
            if (typeof applyPixelUiWorldFont === "function") applyPixelUiWorldFont(this._billUi.text, 14, this.scene);
            this._billUi.paint?.();
        }

        this.container.setPosition(this.storage.x, this.storage.y);
        this.refresh();
        this._placeActionRow();
    }

    _placeActionRow() {
        const row = this._actionRow;
        if (!row) return;
        const addOn = !!this._settleUi?.btn?.visible;
        const actionOn = !!this.takeBtn?.visible;
        this.scene.settlementSys?.placeAddActionRow(this._settleUi, this.takeBtn, {
            y: row.y, gap: row.gap, addW: row.bh, actionW: row.bw,
            addOn, actionOn
        });
        this.scene.settlementSys?.placeRotateBeside(this._rotateUi, {
            y: row.y, gap: row.gap, addW: row.bh, actionW: row.bw, side: row.bh,
            addOn, actionOn, visible: this.visible && this._isDryingRack(),
            addBtn: this._settleUi?.btn, actionBtn: this.takeBtn
        });
        const colorable = this._canColor();
        const billOn = !!this._billUi?.btn?.visible;
        const dyeOn = colorable && !!this.visible;
        this.scene.settlementSys?.placeAddActionRow(this._dyeUi, this._billUi?.btn, {
            y: row.y + row.bh + row.gap,
            gap: row.gap,
            addW: row.bh,
            actionW: row.bw,
            addOn: dyeOn,
            actionOn: billOn
        });
        if (!colorable && this._billUi?.btn) {
            this._billUi.btn.setPosition(0, row.y + row.bh + row.gap);
        }
        this._syncDyeButton();
        this._placeDyeMenu();
    }

    _syncTakeHitArea(enable) {
        const bw = this._takeBw || 78;
        const bh = this._takeBh || 28;
        if (!enable) {
            disableInteractiveIfOn(this.takeRect);
            return;
        }
        ensurePointerInteractive(this.takeRect);
        if (this.takeRect.input?.hitArea?.setTo) {
            this.takeRect.input.hitArea.setTo(0, 0, bw, bh);
        }
    }

    pointerOnTake(pointer) {
        if (!this.visible || !this.takeBtn?.visible || !this.takeRect || !pointer) return false;
        const pt = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(this.takeRect.getBounds(), pt.x, pt.y);
    }

    _syncTakeHover() {
        const over = !!(this._takeEnabled && this.pointerOnTake(this.scene.input.activePointer));
        if (over !== this._takeHovering) {
            this._takeHovering = over;
            if (!over) this._takePressing = false;
        }
        this._paintTake?.();
    }

    update() {
        if (!this.visible || !this.storage) return;
        if (!this.storage.active || !this.storage.inRange()) {
            this.close();
            return;
        }
        this._syncTakeButton();
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

    containsPointer(pointer) {
        if (!this.visible || !this.container?.visible || !pointer) return false;
        if (this.getSlotAt(pointer.x, pointer.y) != null) return true;
        const pt = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const hit = (rect, vis) => !!(vis && rect?.getBounds
            && Phaser.Geom.Rectangle.Contains(rect.getBounds(), pt.x, pt.y));
        if (this.takeBtn?.visible && this.pointerOnTake(pointer)) return true;
        if (hit(this._settleUi?.rect, this._settleUi?.btn?.visible)) return true;
        if (hit(this._billUi?.rect, this._billUi?.btn?.visible)) return true;
        if (hit(this._rotateUi?.rect, this._rotateUi?.btn?.visible)) return true;
        if (this._pointerOnDye(pointer)) return true;
        return false;
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
        const key = this.getSlotAt(pointer.x, pointer.y);
        if (!key) {
            this._sourceBag = 'hotbar';
            return false;
        }
        this._depositFromHotbar(key, hotbarIndex, pointer);
        this._sourceBag = 'hotbar';
        return true;
    }

    tryQuickAdd(hotbarIndex, pointer = null, bag = 'hotbar') {
        if (!this.visible || !this.storage) return false;
        this._sourceBag = bag === 'overflow' ? 'overflow' : 'hotbar';
        try {
            const inv = this._sourceInv();
            const stack = inv[hotbarIndex];
            if (!stack) return false;
            if (!this._acceptsStack(stack)) return false;
            const n = this._slotCount();
            const want = pointer != null && typeof quickMoveAmount === "function"
                ? quickMoveAmount(stack.quantity, pointer, this.scene)
                : stack.quantity;
            if (!(want > 0)) return false;
            const slots = [];
            for (let i = 0; i < n; i++) slots.push(this.storage.getSlot(i));
            const meta = this.scene.getItem(stack.id);
            const plan = typeof Place !== "undefined" && Place.planStorageDeposits
                ? Place.planStorageDeposits(slots, stack, want, {
                    maxStack: Math.max(1, meta?.maxStack || 1),
                    slotMax: this._slotMax(),
                    special: typeof isSpecialStack === "function" && isSpecialStack(stack),
                    destSpecial: (dest) => typeof isSpecialStack === "function" && isSpecialStack(dest)
                })
                : [];
            if (!plan.length) return false;
            for (const step of plan) {
                if (!inv[hotbarIndex]) break;
                this._depositFromHotbar(String(step.index), hotbarIndex, pointer, step.amount);
            }
            return true;
        } finally {
            this._sourceBag = 'hotbar';
        }
    }

    _oneFromStack(stack) {
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const spoilAt = spoilAtForWorld(stack, now);
        const one = {
            id: stack.id,
            quantity: 1,
            ...(spoilAt != null ? { spoilAt } : {})
        };
        const extras = typeof mealStackExtras === "function" ? mealStackExtras(stack) : null;
        if (extras) Object.assign(one, extras);
        return one;
    }

    _cloneStack(stack) {
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const spoilAt = spoilAtForWorld(stack, now);
        const clone = cloneItemStack(stack) || { id: stack.id, quantity: stack.quantity };
        if (spoilAt != null) clone.spoilAt = spoilAt;
        delete clone.spoilLeft;
        return clone;
    }

    _toInvStack(stack) {
        const clone = this._cloneStack(stack);
        const now = this.scene.worldMinuteIndex?.() ?? null;
        migrateToSpoilLeft(clone, now);
        return clone;
    }

    /** Fields gainItem must keep so a worn tool still draws its bar before YOU. */
    _invMoveExtras(stack) {
        const extras = {
            dryProgress: stack?.dryProgress,
            soakProgress: stack?.soakProgress,
            stone: stack?.stone,
            dye: stack?.dye
        };
        if (stack?.durability != null) extras.durability = stack.durability;
        const knap = typeof knapStackExtras === "function" ? knapStackExtras(stack) : null;
        if (knap) Object.assign(extras, knap);
        return extras;
    }

    _tryInsertStack(stack) {
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const forInv = stack.spoilLeft != null ? stack : (() => {
            const c = cloneItemStack(stack) || stack;
            migrateToSpoilLeft(c, now);
            return c;
        })();
        if (this.scene.player.insertOwnedStack?.(forInv)) return true;
        if (forInv.customName || forInv.food) return false;
        const meta = this.scene.getItem(forInv.id);
        const left = this.scene.player.gainItem(
            meta, forInv.quantity, spoilLeftForCharacter(forInv, now),
            this._invMoveExtras(forInv)
        );
        return left < forInv.quantity && left === 0;
    }

    _depositFromHotbar(key, hotbarIndex, pointer = null, amountCap = null) {
        if (!this.storage) return;
        const inv = this._sourceInv();
        const stack = inv[hotbarIndex];
        if (!stack) return;
        if (!this._acceptsStack(stack)) return;
        const meta = this.scene.getItem(stack.id);
        const dest = this._stackFor(key);
        const special = typeof isSpecialStack === "function" && isSpecialStack(stack);
        const want = amountCap != null
            ? amountCap
            : (pointer != null && typeof quickMoveAmount === "function"
                ? quickMoveAmount(stack.quantity, pointer, this.scene)
                : stack.quantity);
        const slotMax = this._slotMax();
        const now = this.scene.worldMinuteIndex?.() ?? null;
        let moved = 0;

        if (!dest) {
            moved = Math.min(stack.quantity, want);
            if (slotMax > 0) moved = Math.min(moved, slotMax);
            if (!(moved > 0)) return;
            const piece = this._prepareOutgoing(stack);
            piece.quantity = moved;
            this._setStack(key, piece);
            stack.quantity -= moved;
            if (stack.quantity <= 0) inv[hotbarIndex] = null;
        } else if (dest.id === stack.id
            && (stack.id === "arrow"
                ? (typeof Ranged !== "undefined" && Ranged.sameArrow(dest, stack))
                : (!special && !(typeof isSpecialStack === "function" && isSpecialStack(dest))))
            && (typeof stackStonesMatch !== "function" || stackStonesMatch(dest, stack))
            && (typeof stackDyesMatch !== "function" || stackDyesMatch(dest, stack))) {
            const maxStack = Math.max(1, meta?.maxStack || 1);
            let space = Math.max(0, maxStack - dest.quantity);
            if (slotMax > 0) space = Math.min(space, Math.max(0, slotMax - dest.quantity));
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
            this._setStack(key, dest);
        } else {
            if (!this._acceptsStack(stack)) return;
            if (want < stack.quantity) return;
            if (slotMax > 0 && stack.quantity > slotMax) return;
            moved = stack.quantity;
            this._setStack(key, this._prepareOutgoing(stack));
            inv[hotbarIndex] = this._toInvStack(dest);
        }

        this.scene.hotbar.dirty = true;
        this.refresh();
        this.scene.refreshTooltip();
        this._notifyStorage("inv_to_slot", {
            inv: hotbarIndex,
            slot: key,
            amount: moved,
            bag: this._sourceBag === 'overflow' ? 'overflow' : 'hotbar'
        });
    }

    _returnStackToHotbar(key, pointer = null) {
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
                this._invMoveExtras(stack)
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
        this._notifyStorage("slot_to_inv", { slot: key, inv: -1, amount: moved });
    }

    _giveSlotToParty(fromKey, target) {
        const stack = this._stackFor(fromKey);
        if (!stack || !target) return false;
        const from = this.scene.player;
        if (!this.scene.partySys?.canGiveTo(from, target, stack)) return false;
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        if (this._isDedicated()) {
            this._setStack(fromKey, null);
            this._notifyStorage("slot_to_inv", {
                slot: fromKey,
                inv: -1,
                amount: qty,
                toPawnId: target.pawnId
            });
            this.layout();
            this.scene.refreshTooltip();
            return true;
        }
        const invStack = this._toInvStack(stack);
        if (!this.scene.partySys.deliverGive(target, invStack)) {
            this.scene.combatLog?.push(`${target.displayName()} cannot carry that`);
            return false;
        }
        this._setStack(fromKey, null);
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
        } else if (dest.id === stack.id && !stack.customName && !dest.customName
            && (stack.id === "arrow"
                ? (typeof Ranged !== "undefined" && Ranged.sameArrow(dest, stack))
                : !(typeof isSpecialStack === "function" && (isSpecialStack(stack) || isSpecialStack(dest))))
            && (typeof stackStonesMatch !== "function" || stackStonesMatch(dest, stack))
            && (typeof stackDyesMatch !== "function" || stackDyesMatch(dest, stack))) {
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
        } else {
            inv[toHotbar] = this._toInvStack(stack);
            this._setStack(fromKey, this._cloneStack(dest));
        }

        this.scene.hotbar.dirty = true;
        this.scene.refreshTooltip();
        this._notifyStorage("slot_to_inv", {
            slot: fromKey,
            inv: toHotbar,
            amount: moved,
            bag: toBag
        });
    }

    _moveBetweenSlots(fromKey, toKey) {
        const a = this._stackFor(fromKey);
        if (!a) return;
        const b = this._stackFor(toKey);
        if (!b) {
            this._setStack(toKey, a);
            this._setStack(fromKey, null);
        } else if (a.id === b.id && !a.customName && !b.customName
            && (a.id === "arrow"
                ? (typeof Ranged !== "undefined" && Ranged.sameArrow(a, b))
                : !(typeof isSpecialStack === "function" && (isSpecialStack(a) || isSpecialStack(b))))
            && (typeof stackStonesMatch !== "function" || stackStonesMatch(a, b))
            && (typeof stackDyesMatch !== "function" || stackDyesMatch(a, b))) {
            const meta = this.scene.getItem(a.id);
            const maxStack = Math.max(1, meta?.maxStack || 1);
            const space = Math.max(0, maxStack - b.quantity);
            if (space <= 0) {
                this._setStack(fromKey, b);
                this._setStack(toKey, a);
            } else {
                const moved = Math.min(space, a.quantity);
                b.spoilAt = mergeSpoilAt(b.quantity, b.spoilAt, moved, a.spoilAt);
                mergeDryInto(b, b.quantity, moved, a.dryProgress);
                mergeSoakInto(b, b.quantity, moved, a.soakProgress);
                mergeTempInto(b, b.quantity, moved, a.temp);
                b.quantity += moved;
                a.quantity -= moved;
                this._setStack(toKey, b);
                this._setStack(fromKey, a.quantity > 0 ? a : null);
            }
        } else {
            this._setStack(fromKey, b);
            this._setStack(toKey, a);
        }
        this._notifyStorage("slot_to_slot", { from: fromKey, to: toKey });
        this.scene.refreshTooltip?.();
    }

    _tryTake() {
        if (!this.storage || !this.storage.isEmpty()) return;
        this.scene.tryPickupStorage?.(this.storage);
    }

    _cancelDrag() {
        this._dragging = false;
        this._dragFromKey = null;
        this._pointerIsDown = false;
        this._pointerDownPos = null;
        if (this._dragIcon) {
            this._dragIcon.destroy();
            this._dragIcon = null;
        }
    }
}
