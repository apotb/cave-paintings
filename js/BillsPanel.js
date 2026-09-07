/**
 * Centered settlement bills overlay (RimWorld-style add / reorder / modes).
 */
class BillsPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.settle = null;
        this.thing = null;
        this.uid = null;
        this.view = "list";
        this.detailsId = null;
        this._scroll = 0;
        this._contentH = 0;
        this._viewW = 0;
        this._viewH = 0;
        this._maxScroll = 0;
        this._bodyX = 10;
        this._bodyY = 52;
        this._refreshing = false;
        this._lastShortageSig = "";
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(15150).setVisible(false);
        scene.uiLayer?.add(this.root);
        this._build();
        this._bindScroll();
    }

    _build() {
        const scene = this.scene;
        this.bg = scene.add.rectangle(0, 0, 440, 400, 0x120e0a, 0.96)
            .setStrokeStyle(2, 0x2a2218)
            .setOrigin(0, 0)
            .setInteractive();
        this.title = scene.add.text(0, 0, "Bills", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0.5, 0.5);
        this.subtitle = scene.add.text(0, 0, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "12px",
            color: "#8a7a62"
        }).setOrigin(0, 0.5);
        this.closeBtn = this._btn(0, 0, "Close", () => this.close(), { w: 52, h: 22 });
        this.body = scene.add.container(12, 36);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.body.setMask(this._maskGfx.createGeometryMask());
        this.scrollTrack = scene.add.rectangle(0, 0, 5, 100, 0x3a2e26, 1).setOrigin(0, 0).setVisible(false);
        this.scrollThumb = scene.add.rectangle(0, 0, 5, 20, 0x8a7260, 1).setOrigin(0, 0).setVisible(false);
        this.root.add([
            this.bg, this.title, this.subtitle, this.closeBtn, this.body,
            this.scrollTrack, this.scrollThumb
        ]);
    }

    _bindScroll() {
        const scene = this.scene;
        this.scrollThumb.setInteractive({ useHandCursor: false, cursor: "default" });
        this.scrollThumb.on("pointerdown", (p) => {
            this._scrollDrag = { startY: p.y, startScroll: this._scroll };
        });
        scene.input.on("pointerup", () => { this._scrollDrag = null; });
        scene.input.on("pointermove", (p) => {
            if (!this.visible || !this._scrollDrag || this._maxScroll <= 0) return;
            const travel = Math.max(1, this._viewH - this.scrollThumb.height);
            const dy = p.y - this._scrollDrag.startY;
            this._setScroll(this._scrollDrag.startScroll + (dy / travel) * this._maxScroll);
        });
        scene.input.on("wheel", (pointer, _over, _dx, dy) => {
            if (!this.visible || this._maxScroll <= 0) return;
            const p = pointer || scene.input.activePointer;
            if (!this.containsPointer(p)) return;
            const step = Math.round(28 * (scene.uiScale || 1));
            this._setScroll(this._scroll + (dy > 0 ? step : -step));
        });
    }

    _btn(x, y, label, onClick, opts = {}) {
        const scene = this.scene;
        const w = opts.w || 64;
        const h = opts.h || 22;
        const disabled = !!opts.disabled;
        const fill = opts.fill != null ? opts.fill : (disabled ? 0x141210 : 0x120e0a);
        const fillPress = opts.fillPress != null ? opts.fillPress : 0x0a0806;
        const outline = opts.stroke != null ? opts.stroke : (disabled ? 0x2a2622 : 0x2a2218);
        const color = opts.color || (disabled ? "#6a6258" : "#d4c4a8");
        const bg = scene.add.rectangle(0, 0, w, h, fill, 1)
            .setInteractive({ useHandCursor: !disabled, cursor: disabled ? "default" : undefined });
        const kids = [bg];
        let txt = null;
        let icon = null;
        let item = null;
        if (opts.itemKey && scene.textures.exists(opts.itemKey)) {
            item = scene.add.image(0, 0, opts.itemKey);
            kids.push(item);
        }
        if (opts.chevron) {
            icon = this._chevronGfx(opts.chevron, Math.min(w, h));
            kids.push(icon);
        } else {
            txt = scene.add.text(0, 0, label, {
                fontFamily: PIXEL_UI_FONT,
                fontSize: "14px",
                color
            }).setOrigin(opts.alignLeft ? 0 : 0.5, 0.5);
            kids.push(txt);
        }
        const c = scene.add.container(x, y, kids);
        c._bg = bg;
        c._txt = txt;
        c._item = item;
        c._alignLeft = !!opts.alignLeft;
        c._w = w;
        c._h = h;
        let hovering = false;
        let pressing = false;
        const strokeW = () => (typeof pixelUiStroke === "function"
            ? pixelUiStroke(scene.uiScale || 1) : 2);
        const paint = () => {
            const sw = strokeW();
            if (disabled) {
                bg.setFillStyle(fill, 1);
                bg.setStrokeStyle(sw, outline);
            } else if (pressing) {
                bg.setFillStyle(fillPress, 1);
                bg.setStrokeStyle(sw, 0xd4a84b);
            } else if (hovering) {
                bg.setFillStyle(fill, 1);
                bg.setStrokeStyle(sw, 0xffffff);
            } else {
                bg.setFillStyle(fill, 1);
                bg.setStrokeStyle(sw, outline);
            }
        };
        c._paint = paint;
        c._icon = icon;
        const tip = opts.tip ? String(opts.tip) : "";
        bg.on("pointerover", (pointer) => {
            if (disabled) return;
            hovering = true;
            paint();
            if (tip) scene.showTooltip(() => tip, pointer.x, pointer.y, bg);
        });
        bg.on("pointerout", (pointer) => {
            if (this._refreshing) return;
            const b = bg.getBounds?.();
            if (b && pointer && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y)) return;
            hovering = false;
            pressing = false;
            paint();
            if (tip && scene._tooltipTarget === bg) scene.hideTooltip?.();
        });
        bg.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (disabled || pointer.rightButtonDown()) return;
            pressing = true;
            paint();
        });
        bg.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (disabled) return;
            const was = pressing && hovering;
            pressing = false;
            paint();
            if (was) onClick?.();
        });
        paint();
        this._layoutBtnContent(c);
        return c;
    }

    _layoutBtnContent(c) {
        if (!c) return;
        const w = c._w;
        const h = c._h;
        const pad = Math.max(6, Math.round(h * 0.28));
        if (c._item) {
            const isz = Math.max(12, Math.round(h - 6));
            c._item.setDisplaySize(isz, isz);
            c._item.setPosition(-w / 2 + pad + isz / 2, 0);
        }
        if (c._txt) {
            if (c._alignLeft) {
                const iconW = c._item ? c._item.displayWidth : 0;
                const gap = iconW ? Math.max(4, Math.round(h * 0.18)) : 0;
                c._txt.setOrigin(0, 0.5).setPosition(-w / 2 + pad + iconW + gap, 0);
            } else {
                c._txt.setOrigin(0.5).setPosition(0, 0);
            }
        }
    }

    _chevronGfx(dir, side) {
        const g = this.scene.add.graphics();
        g.fillStyle(0xd4c4a8, 1);
        const w = Math.max(3, Math.round(side * 0.22));
        const h = Math.max(2, Math.round(side * 0.14));
        if (dir < 0) g.fillTriangle(0, -h, -w, h, w, h);
        else g.fillTriangle(0, h, -w, -h, w, -h);
        return g;
    }

    _contentBox(sc) {
        const sw = typeof pixelUiStroke === "function"
            ? pixelUiStroke(this.scene.uiScale || 1)
            : 2;
        const inset = Math.max(2, Math.ceil(sw / 2) + 1);
        const innerW = Math.max(80, Math.round(this._viewW - inset * 2));
        return { inset, innerW, sw };
    }

    _sizeBtn(c, w, h, font = 12) {
        if (!c) return;
        c._w = w;
        c._h = h;
        c._bg.setSize(w, h);
        if (c._bg.input?.hitArea?.setSize) c._bg.input.hitArea.setSize(w, h);
        else if (c._bg.input?.hitArea?.setTo) c._bg.input.hitArea.setTo(0, 0, w, h);
        const s = this.scene.uiScale || 1;
        if (c._txt && typeof applyPixelUiFont === "function") applyPixelUiFont(c._txt, font, s);
        this._layoutBtnContent(c);
        c._paint?.();
    }

    _pointerInBody(pointer) {
        if (!pointer || !this.visible) return false;
        const x = this.root.x + this._bodyX;
        const y = this.root.y + this._bodyY;
        return pointer.x >= x && pointer.x <= x + this._viewW
            && pointer.y >= y && pointer.y <= y + this._viewH;
    }

    _clipHit(hitArea, x, y) {
        if (!Phaser.Geom.Rectangle.Contains(hitArea, x, y)) return false;
        return this._pointerInBody(this.scene.input.activePointer);
    }

    _setScroll(y) {
        this._scroll = Phaser.Math.Clamp(y, 0, this._maxScroll);
        this.body.setY(this._bodyY - this._scroll);
        this._layoutScrollbar();
    }

    _layoutScrollbar() {
        const s = this.scene.uiScale || 1;
        const need = this._maxScroll > 0.5;
        this.scrollTrack.setVisible(need);
        this.scrollThumb.setVisible(need);
        if (!need) return;
        const barW = Math.max(4, Math.round(5 * s));
        const trackH = this._viewH;
        const thumbH = Math.max(16 * s, trackH * (this._viewH / Math.max(this._contentH, 1)));
        const travel = Math.max(1, trackH - thumbH);
        const t = this._maxScroll > 0 ? this._scroll / this._maxScroll : 0;
        const x = this._bodyX + this._viewW - barW;
        this.scrollTrack.setPosition(x, this._bodyY).setSize(barW, trackH);
        this.scrollThumb.setPosition(x, this._bodyY + travel * t).setSize(barW, thumbH);
        if (this.scrollThumb.input?.hitArea?.setSize) {
            this.scrollThumb.input.hitArea.setSize(this.scrollThumb.width, this.scrollThumb.height);
        }
    }

    _refreshMask() {
        const wx = this.root.x + this._bodyX;
        const wy = this.root.y + this._bodyY;
        this._maskGfx.clear();
        this._maskGfx.fillStyle(0xffffff, 1);
        this._maskGfx.fillRect(wx, wy, this._viewW, this._viewH);
    }

    _S() {
        return typeof Settlement !== "undefined" ? Settlement : null;
    }

    _kind() {
        const S = this._S();
        const id = this.thing?.entry?.id || this.thing?.meta?.id;
        return S?.stationKind?.(id) || null;
    }

    _list() {
        const S = this._S();
        return S ? S.billsOf(this.settle, this.uid).slice() : [];
    }

    _commit(list) {
        const S = this._S();
        if (!S || !this.settle || !this.uid) return;
        S.setBills(this.settle, this.uid, list);
        this.scene.settlementSys?.sendNet("setBills", {
            settlementId: this.settle.id,
            stationUid: this.uid,
            bills: S.billsOf(this.settle, this.uid)
        });
        this.refresh();
    }

    _itemIconKey(itemId) {
        if (!itemId) return null;
        const def = this.scene.getItem?.(itemId) || { id: itemId, key: itemId };
        if (typeof Place !== "undefined" && Place.itemIconKey) {
            const key = Place.itemIconKey(
                def,
                (id) => this.scene.getThing?.(id),
                (k) => this.scene.textures.exists(k)
            );
            if (key && this.scene.textures.exists(key)) return key;
        }
        if (def?.key && this.scene.textures.exists(def.key)) return def.key;
        if (this.scene.textures.exists(itemId)) return itemId;
        return null;
    }

    _billIconKey(billOrRec) {
        const rec = this._recipeOf(billOrRec);
        const craft = rec?.kind === "craft" || billOrRec?.kind === "craft";
        if (!craft) return null;
        return this._itemIconKey(rec?.outputId || billOrRec?.outputId || rec?.id || billOrRec?.recipeId);
    }

    _recipeOf(billOrRec) {
        const S = this._S();
        if (!S || !billOrRec) return billOrRec || null;
        if (billOrRec.name && (billOrRec.method || billOrRec.outputId || billOrRec.hideStage)) {
            return billOrRec;
        }
        return S.billRecipeById?.(billOrRec.recipeId || billOrRec.id) || billOrRec;
    }

    _inputs(billOrRec) {
        const S = this._S();
        if (!S) return [];
        const rec = this._recipeOf(billOrRec);
        if (S.billInputsFor) return S.billInputsFor(rec, this.scene.items?.() || []);
        return S.cookInputsForMethod(this.scene.items?.() || [], rec?.method) || [];
    }

    open(settle, thing) {
        if (!settle || !thing?.entry?.uid) return;
        const prev = this.thing;
        this.settle = settle;
        this.thing = thing;
        this.uid = thing.entry.uid;
        this.view = "list";
        this.detailsId = null;
        this._scroll = 0;
        this._lastShortageSig = "";
        this.visible = true;
        this.root.setVisible(true);
        this.layout();
        this.refresh();
        this.scene._refreshStationInteractMarks?.(prev, thing);
    }

    close() {
        const prev = this.thing;
        this.visible = false;
        this.settle = null;
        this.thing = null;
        this.uid = null;
        this.view = "list";
        this.detailsId = null;
        this.root.setVisible(false);
        this.scrollTrack.setVisible(false);
        this.scrollThumb.setVisible(false);
        this.scene._refreshStationInteractMarks?.(prev);
    }

    handleEsc() {
        if (!this.visible) return false;
        if (this.view !== "list") {
            this.view = "list";
            this.detailsId = null;
            this._scroll = 0;
            this.refresh();
            return true;
        }
        this.close();
        return true;
    }

    layout() {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const w = Math.round(460 * s);
        const h = Math.round(420 * s);
        this.bg.setSize(w, h);
        if (this.bg.input?.hitArea?.setSize) {
            this.bg.input.hitArea.setSize(this.bg.width, this.bg.height);
        } else if (this.bg.input?.hitArea?.setTo) {
            this.bg.input.hitArea.setTo(0, 0, this.bg.width, this.bg.height);
        }
        this.root.setPosition(
            Math.round((scene.scale.width - w) / 2),
            Math.round((scene.scale.height - h) / 2)
        );
        if (typeof applyPixelUiFont === "function") {
            applyPixelUiFont(this.title, 16, s);
            applyPixelUiFont(this.subtitle, 12, s);
        }
        const pad = Math.round(12 * s);
        const headerY = Math.round(18 * s);
        this.title.setPosition(Math.round(w / 2), headerY);
        this.subtitle.setPosition(pad, headerY);
        this.closeBtn.setPosition(w - Math.round(40 * s), headerY);
        this._sizeBtn(this.closeBtn, Math.round(52 * s), Math.round(22 * s), 12);
        const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2;
        this.bg.setStrokeStyle(sw, 0x2a2218);
        this._bodyX = pad;
        this._bodyY = Math.round(36 * s);
        this._viewW = w - pad * 2;
        this._viewH = h - this._bodyY - pad;
        this.body.setPosition(this._bodyX, this._bodyY);
        if (this.visible) this.refresh();
        else {
            this._maxScroll = Math.max(0, this._contentH - this._viewH);
            this._refreshMask();
            this._setScroll(this._scroll);
        }
    }

    _clearBody() {
        this.body.removeAll(true);
    }

    refresh() {
        if (!this.visible || !this.settle) return;
        this._refreshing = true;
        const s = this.scene.uiScale || 1;
        const name = this.thing?.meta?.name || this.thing?.entry?.id || "Station";
        this.title.setText("Bills");
        this.subtitle.setText(String(name));
        this._clearBody();
        let contentH = 0;
        if (this.view === "add") contentH = this._fillAdd(s);
        else if (this.view === "details") contentH = this._fillDetails(s);
        else contentH = this._fillList(s);
        this._contentH = Math.max(contentH, 1);
        this._maxScroll = Math.max(0, this._contentH - this._viewH);
        this._setScroll(Math.min(this._scroll, this._maxScroll));
        this._refreshMask();
        this._refreshing = false;
        this._lastShortageSig = this._shortageSig();
        this._restoreHoverTip();
    }

    refreshLive() {
        if (!this.visible || this.view !== "list" || !this.settle) return;
        const sig = this._shortageSig();
        if (sig === this._lastShortageSig) return;
        this.refresh();
    }

    _countItem(id) {
        return this.scene.settlementSys?.countItem?.(this.settle, id) || 0;
    }

    _shortageSig() {
        return this._list().map((b) => {
            const done = this._billComplete(b) ? 1 : 0;
            const short = this._billShort(b) ? 1 : 0;
            const qty = this._S()?.billQtyLabel?.(b, (id) => this._countItem(id)) || "";
            return `${b.id}:${short}:${done}:${qty}`;
        }).join("|");
    }

    _billComplete(bill) {
        const S = this._S();
        if (!S?.billIsComplete || !bill) return false;
        return S.billIsComplete(bill, (id) => this._countItem(id));
    }

    _billShort(bill) {
        const S = this._S();
        if (!S?.billWantsMaterials || !S?.billHasMaterials || !bill) return false;
        const countItem = (id) => this._countItem(id);
        if (!S.billWantsMaterials(bill, countItem)) return false;
        return !S.billHasMaterials(bill, {
            countItem,
            getItem: (id) => this.scene.getItem?.(id),
            items: this.scene.items?.() || []
        });
    }

    _restoreHoverTip() {
        const scene = this.scene;
        const p = scene.input?.activePointer;
        if (!p || !this.visible) return;
        const visit = (obj) => {
            if (!obj?.active) return false;
            if (obj.input?.enabled) {
                const b = obj.getBounds?.();
                if (b && Phaser.Geom.Rectangle.Contains(b, p.x, p.y)) {
                    obj.emit("pointerover", p);
                    return true;
                }
            }
            const kids = obj.list;
            if (Array.isArray(kids)) {
                for (let i = kids.length - 1; i >= 0; i--) {
                    if (visit(kids[i])) return true;
                }
            }
            return false;
        };
        visit(this.body);
    }

    _label(text, x, y, size = 12, color = "#d4c4a8") {
        const t = this.scene.add.text(x, y, text, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(size, this.scene.uiScale || 1)}px`,
            color
        });
        this.body.add(t);
        return t;
    }

    _rowLabel(text, x, y, size = 12, color = "#d4c4a8") {
        const t = this.scene.add.text(x, y, text, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(size, this.scene.uiScale || 1)}px`,
            color
        }).setOrigin(0, 0.5);
        if (typeof applyPixelUiFont === "function") {
            applyPixelUiFont(t, size, this.scene.uiScale || 1);
        }
        this.body.add(t);
        return t;
    }

    _pixelGlyph(g, u, color, cells) {
        g.fillStyle(0x000000, 1);
        for (let i = 0; i < cells.length; i++) {
            const x = cells[i][0] - 3;
            const y = cells[i][1] - 3;
            g.fillRect(x * u - u, y * u - u, 3 * u, 3 * u);
        }
        g.fillStyle(color, 1);
        for (let i = 0; i < cells.length; i++) {
            const x = cells[i][0] - 3;
            const y = cells[i][1] - 3;
            g.fillRect(x * u, y * u, u, u);
        }
    }

    _addStatus(state, cx, cy, sc) {
        const g = this.scene.add.graphics();
        const u = Math.max(1, Math.round(sc));
        g.setPosition(Math.round(cx), Math.round(cy));
        if (state === "on") {
            this._pixelGlyph(g, u, 0x5cbf63, [
                [0, 3], [1, 4], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]
            ]);
        } else {
            const cross = [];
            for (let i = 0; i <= 6; i++) {
                cross.push([i, i], [i, 6 - i]);
            }
            this._pixelGlyph(g, u, 0xc44c3c, cross);
        }
        this.body.add(g);
        return g;
    }

    _rowColors(state) {
        if (state === "on") return { fill: 0x1e3d1a, stroke: 0x5cbf63, text: "#d4e8d0" };
        return { fill: 0x3a1816, stroke: 0xc44c3c, text: "#e8c0b8" };
    }

    _billItemTip(ing) {
        const scene = this.scene;
        if (!ing?.id || typeof scene.formatItemTooltip !== "function") return ing?.name || "";
        const def = scene.getItem?.(ing.id);
        if (!def) return ing.name || "";
        return scene.formatItemTooltip(def, 1, null, { id: ing.id, quantity: 1 });
    }

    _row(x, y, w, h, state, onClick, tipFn) {
        const c = this._rowColors(state);
        const bg = this.scene.add.rectangle(x, y, w, h, c.fill, 1)
            .setOrigin(0, 0)
            .setStrokeStyle(1, c.stroke)
            .setInteractive({
                hitArea: new Phaser.Geom.Rectangle(0, 0, w, h),
                hitAreaCallback: (area, lx, ly) => this._clipHit(area, lx, ly),
                useHandCursor: true
            });
        bg.on("pointerover", (pointer) => {
            if (typeof tipFn !== "function") return;
            this.scene.showTooltip(() => tipFn() || "", pointer.x, pointer.y, bg);
        });
        bg.on("pointerout", (pointer) => {
            if (this._refreshing) return;
            const b = bg.getBounds?.();
            if (b && pointer && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y)) return;
            if (this.scene._tooltipTarget === bg) this.scene.hideTooltip?.();
        });
        bg.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (!this._pointerInBody(pointer)) return;
            onClick?.(pointer);
        });
        this.body.add(bg);
        return bg;
    }

    _fillList(sc) {
        const S = this._S();
        const { inset, innerW } = this._contentBox(sc);
        const bh = Math.round(22 * sc);
        const add = this._btn(inset + innerW / 2, inset + bh / 2, "Add bill", () => {
            this.view = "add";
            this._scroll = 0;
            this.refresh();
        }, { w: innerW, h: bh });
        this._sizeBtn(add, innerW, bh, 12);
        this.body.add(add);
        let y = inset + bh + Math.round(8 * sc);
        const bills = this._list();
        if (!bills.length) {
            this._label("No bills", inset, y, 12, "#8a7a62");
            return y + Math.round(22 * sc);
        }
        for (let i = 0; i < bills.length; i++) {
            y = this._fillBillRow(bills[i], i, y, innerW, inset, sc, S);
        }
        return y + Math.round(8 * sc);
    }

    _fillBillRow(bill, index, y, innerW, inset, sc, S) {
        const gap = Math.round(4 * sc);
        const bh = Math.round(22 * sc);
        const sq = bh;
        const cardSw = Math.max(3, Math.round(3 * sc));
        const pad = Math.max(Math.round(6 * sc), Math.ceil(cardSw / 2) + 2);
        const rowH = pad + sq + gap + bh + pad;
        let textX = inset + pad + sq + gap;
        const complete = this._billComplete(bill);
        const short = !complete && this._billShort(bill);
        const title = S?.billTitle?.(bill) || "Bill";
        const titleY = y + Math.round(6 * sc);
        const titleColor = (bill.paused || complete) ? "#8a7a62" : (short ? "#e07070" : "#d4c4a8");
        const bgFill = bill.paused ? 0x5a4a10 : (complete ? 0x2c2c2a : (short ? 0x3a1210 : 0x1a1510));
        const bgStroke = bill.paused ? 0xf0d060 : (complete ? 0x6e6e6a : (short ? 0xc44c3c : 0x3a2e26));
        const bg = this.scene.add.rectangle(
            inset, y, innerW, rowH,
            bgFill,
            1
        )
            .setOrigin(0, 0)
            .setStrokeStyle(cardSw, bgStroke);
        this.body.add(bg);

        const ax = inset + pad + sq / 2;
        const up = this._btn(ax, y + pad + sq / 2, "", () => {
            this._commit(S.moveBill(this._list(), bill.id, -1));
        }, { w: sq, h: sq, chevron: -1 });
        const down = this._btn(ax, y + rowH - pad - sq / 2, "", () => {
            this._commit(S.moveBill(this._list(), bill.id, 1));
        }, { w: sq, h: sq, chevron: 1 });
        this._sizeBtn(up, sq, sq, 12);
        this._sizeBtn(down, sq, sq, 12);
        this.body.add(up);
        this.body.add(down);

        const iconKey = this._billIconKey(bill);
        if (iconKey) {
            const iconSize = Math.round(16 * sc);
            const icon = this.scene.add.image(textX + iconSize / 2, titleY + iconSize / 2, iconKey)
                .setDisplaySize(iconSize, iconSize);
            if (complete) icon.setTint(0x888888);
            this.body.add(icon);
            textX += iconSize + gap;
        }
        const right = inset + innerW - pad;
        const xW = bh;
        const sW = bh;
        const detW = Math.round(64 * sc);
        const renW = Math.round(64 * sc);
        const name = this._label(title, textX, titleY, 13, titleColor);
        if (bill.paused) {
            const tw = Math.max(1, Math.round(name.width || name.displayWidth || 0));
            const th = name.height || name.displayHeight || pixelUiFontSize(13, sc);
            const strike = this.scene.add.rectangle(
                name.x,
                name.y + th / 2,
                tw,
                Math.max(2, Math.round(2 * sc)),
                0x8a7a62,
                1
            ).setOrigin(0, 0.5);
            this.body.add(strike);
        }
        if (short) {
            this._label(
                "NOT ENOUGH MATERIAL",
                textX,
                titleY + pixelUiFontSize(13, sc),
                10,
                "#e07070"
            );
        }
        const xBtn = this._btn(right - xW / 2, y + pad + bh / 2, "X", () => {
            this._commit(S.removeBill(this._list(), bill.id));
        }, {
            w: xW, h: bh, fill: 0x4a1818, stroke: 0xc44c3c, color: "#f0c0b0",
            tip: "Delete bill"
        });
        this._sizeBtn(xBtn, xW, bh, 12);
        this.body.add(xBtn);

        const sBtn = this._btn(right - xW - gap - sW / 2, y + pad + bh / 2, "S", () => {
            bill.paused = !bill.paused;
            this._commit(this._list().map((b) => (b.id === bill.id ? { ...b, paused: bill.paused } : b)));
        }, {
            w: sW,
            h: bh,
            fill: bill.paused ? 0x5a4a10 : 0x120e0a,
            stroke: bill.paused ? 0xf0d060 : 0x2a2218,
            color: bill.paused ? "#f0d060" : "#d4c4a8",
            tip: bill.paused ? "Unsuspend bill" : "Suspend bill"
        });
        this._sizeBtn(sBtn, sW, bh, 12);
        this.body.add(sBtn);

        const details = this._btn(right - xW - gap - sW - gap - detW / 2, y + pad + bh / 2, "Details", () => {
            this.view = "details";
            this.detailsId = bill.id;
            this._scroll = 0;
            this.refresh();
        }, { w: detW, h: bh });
        this._sizeBtn(details, detW, bh, 12);
        this.body.add(details);

        const rename = this._btn(
            right - xW - gap - sW - gap - detW - gap - renW / 2,
            y + pad + bh / 2,
            "Rename",
            () => this._promptRename(bill),
            { w: renW, h: bh }
        );
        this._sizeBtn(rename, renW, bh, 12);
        this.body.add(rename);

        const qtyY = y + pad + sq + gap + bh / 2;
        const modeLeft = textX;
        const modeRight = right;
        const small = bh;
        const qtyW = Math.round(48 * sc);
        const forever = bill.mode === "forever";
        const minus = this._btn(modeLeft + small / 2, qtyY, "-", () => this._nudgeQty(bill, -1), {
            w: small, h: small, disabled: forever
        });
        this._sizeBtn(minus, small, small, 14);
        this.body.add(minus);
        if (!forever) {
            const qtyColor = complete ? "#e07070" : "#d4c4a8";
            const qtyText = S.billQtyLabel(bill, (id) => this._countItem(id));
            const qty = this._label(qtyText, modeLeft + small + gap, qtyY, 12, qtyColor);
            qty.setOrigin(0, 0.5);
        }
        const plus = this._btn(modeLeft + small + gap + qtyW + small / 2, qtyY, "+", () => this._nudgeQty(bill, 1), {
            w: small, h: small, disabled: forever
        });
        this._sizeBtn(plus, small, small, 14);
        this.body.add(plus);
        const modeX = modeLeft + small * 2 + gap + qtyW + gap;
        const modeW = Math.max(bh, modeRight - modeX);
        const mode = this._btn(modeX + modeW / 2, qtyY, S.billModeLabel(bill.mode), () => {
            this._cycleMode(bill);
        }, { w: modeW, h: bh });
        this._sizeBtn(mode, modeW, bh, 12);
        this.body.add(mode);

        return y + rowH + Math.round(6 * sc);
    }

    _nudgeQty(bill, dir) {
        const next = this._list().map((b) => {
            if (b.id !== bill.id) return b;
            const copy = { ...b };
            if (copy.mode === "count") {
                const n = Math.max(1, Math.floor(Number(copy.n) || 1) + dir);
                copy.n = n;
                copy.remaining = Math.max(1, Math.floor(Number(copy.remaining) || n) + dir);
            } else if (copy.mode === "until") {
                copy.n = Math.max(1, Math.floor(Number(copy.n) || 1) + dir);
            }
            return copy;
        });
        this._commit(next);
    }

    _promptRename(bill) {
        const S = this._S();
        if (!bill || !S) return;
        const current = S.billTitle(bill) || "Bill";
        const max = S.NAME_MAX || 24;
        this.scene.settlementSys?._showNamePrompt?.((name) => {
            const nextName = String(name || "").trim().slice(0, max);
            this._commit(this._list().map((b) => (
                b.id === bill.id ? { ...b, name: nextName || null } : b
            )));
        }, {
            title: "Name this bill",
            confirm: "Rename",
            placeholder: current,
            value: bill.name || current
        });
    }

    _cycleMode(bill) {
        const S = this._S();
        const mode = S.cycleBillMode(bill.mode);
        const next = this._list().map((b) => {
            if (b.id !== bill.id) return b;
            const copy = { ...b, mode };
            if (mode === "count") {
                copy.remaining = Math.max(1, Math.floor(Number(copy.n) || 1));
            } else {
                copy.remaining = 0;
            }
            return copy;
        });
        this._commit(next);
    }

    _fillAdd(sc) {
        const S = this._S();
        const { inset, innerW } = this._contentBox(sc);
        const bh = Math.round(22 * sc);
        const backW = Math.round(52 * sc);
        const back = this._btn(inset + backW / 2, inset + bh / 2, "Back", () => {
            this.view = "list";
            this.refresh();
        }, { w: backW, h: bh });
        this._sizeBtn(back, backW, bh, 12);
        this.body.add(back);
        this._label("Add bill", inset + backW + Math.round(8 * sc), inset + bh / 2, 13)
            .setOrigin(0, 0.5);
        let y = inset + bh + Math.round(8 * sc);
        const recipes = S?.billRecipesFor?.(this._kind()) || [];
        if (!recipes.length) {
            const name = this.thing?.meta?.name || this.thing?.entry?.id || "Station";
            this._label(`No bills for ${name}`, inset, y, 12, "#8a7a62");
            return y + Math.round(24 * sc);
        }
        for (const rec of recipes) {
            const title = S?.billRecipeTitle?.(rec) || rec.name;
            const itemKey = this._billIconKey(rec);
            const row = this._btn(inset + innerW / 2, y + bh / 2, title, () => {
                this._addRecipe(rec);
            }, { w: innerW, h: bh, itemKey, alignLeft: rec.kind === "craft" });
            this._sizeBtn(row, innerW, bh, 12);
            this.body.add(row);
            y += bh + Math.round(6 * sc);
        }
        return y + Math.round(8 * sc);
    }

    _addRecipe(rec) {
        const S = this._S();
        if (!S || !rec) return;
        const inputs = this._inputs(rec);
        S.addBill(this.settle, this.uid, {
            kind: rec.kind,
            recipeId: rec.id,
            method: rec.method,
            outputId: rec.outputId || null,
            mode: "count",
            n: 1,
            allowedIds: inputs.map((i) => i.id)
        });
        const list = S.billsOf(this.settle, this.uid);
        const last = list[list.length - 1];
        S.syncBillResults?.(last, (id) => this.scene.getItem?.(id));
        this.scene.settlementSys?.sendNet("setBills", {
            settlementId: this.settle.id,
            stationUid: this.uid,
            bills: list
        });
        this.view = "list";
        this._scroll = 0;
        this.refresh();
    }

    _fillDetails(sc) {
        const S = this._S();
        const bill = this._list().find((b) => b.id === this.detailsId);
        const { inset, innerW } = this._contentBox(sc);
        const bh = Math.round(22 * sc);
        const backW = Math.round(52 * sc);
        const back = this._btn(inset + backW / 2, inset + bh / 2, "Back", () => {
            this.view = "list";
            this.detailsId = null;
            this.refresh();
        }, { w: backW, h: bh });
        this._sizeBtn(back, backW, bh, 12);
        this.body.add(back);
        let headX = inset + backW + Math.round(8 * sc);
        const headY = inset + bh / 2;
        const headIcon = this._billIconKey(bill);
        if (headIcon) {
            const iconSize = Math.round(16 * sc);
            const icon = this.scene.add.image(headX + iconSize / 2, headY, headIcon)
                .setDisplaySize(iconSize, iconSize);
            this.body.add(icon);
            headX += iconSize + Math.round(6 * sc);
        }
        this._label(`${S?.billTitle?.(bill) || "Bill"} ingredients`, headX, headY, 13)
            .setOrigin(0, 0.5);
        let y = inset + bh + Math.round(8 * sc);
        if (!bill) {
            this._label("That bill is gone.", inset, y, 12, "#8a7a62");
            return y + Math.round(24 * sc);
        }
        const rec = S.billRecipeById?.(bill.recipeId) || bill;
        const inputs = this._inputs(rec);
        if (!inputs.length) {
            this._label("No ingredients for this bill.", inset, y, 12, "#8a7a62");
            return y + Math.round(24 * sc);
        }
        const allowed = bill.allowedIds;
        const allOn = !allowed || !allowed.length;
        const rowH = Math.round(26 * sc);
        const gap = Math.round(3 * sc);
        const iconS = Math.round(14 * sc);
        const statusX = inset + innerW - Math.round(12 * sc);
        const allIds = inputs.map((i) => i.id);
        for (const ing of inputs) {
            const on = allOn || allowed.includes(ing.id);
            const itemState = on ? "on" : "off";
            const itemColors = this._rowColors(itemState);
            const itemMid = y + rowH / 2;
            this._row(inset, y, innerW, rowH, itemState, () => {
                this._toggleIngredient(bill, ing.id, allIds);
            }, () => this._billItemTip(ing));
            const ic = this._itemIconKey(ing.id)
                || (ing.key && this.scene.textures.exists(ing.key) ? ing.key : null);
            if (ic) {
                const icon = this.scene.add.image(inset + Math.round(10 * sc), itemMid, ic)
                    .setDisplaySize(iconS, iconS);
                this.body.add(icon);
            }
            this._rowLabel(
                ing.name,
                inset + Math.round(20 * sc),
                itemMid,
                12,
                itemColors.text
            );
            this._addStatus(itemState, statusX, itemMid, sc);
            y += rowH + gap;
        }
        return y + Math.round(8 * sc);
    }

    _toggleIngredient(bill, itemId, allIds) {
        const current = Array.isArray(bill.allowedIds) && bill.allowedIds.length
            ? bill.allowedIds.slice()
            : allIds.slice();
        const i = current.indexOf(itemId);
        if (i >= 0) {
            if (current.length <= 1) return;
            current.splice(i, 1);
        } else current.push(itemId);
        const allOn = allIds.every((id) => current.includes(id));
        const next = this._list().map((b) => {
            if (b.id !== bill.id) return b;
            const copy = { ...b, allowedIds: allOn ? null : current };
            this._S()?.syncBillResults?.(copy, (id) => this.scene.getItem?.(id));
            return copy;
        });
        this._commit(next);
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer) return false;
        const b = this.bg.getBounds();
        return Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y);
    }
}
