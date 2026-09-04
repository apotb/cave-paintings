/**
 * Centered RimWorld-style storage filter overlay for settlement baskets.
 */
class StorageFilterPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.settle = null;
        this.thing = null;
        this._scroll = 0;
        this._contentH = 0;
        this._viewW = 0;
        this._viewH = 0;
        this._maxScroll = 0;
        this._bodyX = 10;
        this._bodyY = 52;
        this._collapsed = new Set();
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(15150).setVisible(false);
        scene.uiLayer?.add(this.root);
        this._build();
        this._bindScroll();
    }

    _SF() {
        return typeof StorageFilter !== "undefined" ? StorageFilter : null;
    }

    _build() {
        const scene = this.scene;
        this.bg = scene.add.rectangle(0, 0, 440, 400, 0x120e0a, 0.96)
            .setStrokeStyle(2, 0x2a2218)
            .setOrigin(0, 0)
            .setInteractive();
        this.title = scene.add.text(0, 0, "Storage", {
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
        this.prioBtn = this._btn(0, 0, "Priority: Normal", () => {}, { w: 160, h: 22 });
        this._bindPriority(this.prioBtn);
        this.body = scene.add.container(12, 36);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.body.setMask(this._maskGfx.createGeometryMask());
        this.scrollTrack = scene.add.rectangle(0, 0, 5, 100, 0x3a2e26, 1).setOrigin(0, 0).setVisible(false);
        this.scrollThumb = scene.add.rectangle(0, 0, 5, 20, 0x8a7260, 1).setOrigin(0, 0).setVisible(false);
        this.root.add([
            this.bg, this.title, this.subtitle, this.body,
            this.scrollTrack, this.scrollThumb,
            this.prioBtn, this.closeBtn
        ]);
    }

    _bindPriority(c) {
        const bg = c._bg;
        bg.off("pointerdown");
        bg.off("pointerup");
        bg.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            c._pressing = true;
            c._paint?.();
        });
        bg.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = !!c._pressing;
            c._pressing = false;
            c._paint?.();
            if (!was) return;
            const right = pointer.rightButtonReleased?.() || pointer.button === 2;
            this._cyclePriority(right ? -1 : 1);
        });
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
        const fill = opts.fill != null ? opts.fill : 0x120e0a;
        const fillPress = opts.fillPress != null ? opts.fillPress : 0x0a0806;
        const outline = opts.stroke != null ? opts.stroke : 0x2a2218;
        const color = opts.color || "#d4c4a8";
        const bg = scene.add.rectangle(0, 0, w, h, fill, 1)
            .setInteractive({ useHandCursor: true });
        const txt = scene.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "14px",
            color
        }).setOrigin(0.5);
        const c = scene.add.container(x, y, [bg, txt]);
        c._bg = bg;
        c._txt = txt;
        c._w = w;
        c._h = h;
        let hovering = false;
        let pressing = false;
        const strokeW = () => (typeof pixelUiStroke === "function"
            ? pixelUiStroke(scene.uiScale || 1) : 2);
        const paint = () => {
            const sw = strokeW();
            if (pressing) {
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
        bg.on("pointerover", () => { hovering = true; paint(); });
        bg.on("pointerout", () => {
            hovering = false;
            pressing = false;
            paint();
        });
        bg.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown()) return;
            pressing = true;
            paint();
        });
        bg.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = pressing && hovering;
            pressing = false;
            paint();
            if (was) onClick?.();
        });
        paint();
        return c;
    }

    _contentBox() {
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
        const thumbH = Math.max(16, Math.round(trackH * (this._viewH / Math.max(1, this._contentH))));
        const travel = Math.max(1, trackH - thumbH);
        const t = this._maxScroll > 0 ? this._scroll / this._maxScroll : 0;
        const x = this._bodyX + this._viewW + Math.round(4 * s);
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

    _filter() {
        const SF = this._SF();
        return SF ? SF.normalize(this.thing?.entry?.storageFilter) : { priority: "normal" };
    }

    _tree() {
        const SF = this._SF();
        const list = this.scene.items?.() || [];
        return SF ? SF.buildTree(list) : [];
    }

    _collapseAll() {
        this._collapsed = new Set();
        const walk = (nodes) => {
            for (const n of nodes || []) {
                if ((n.children && n.children.length) || (n.items && n.items.length)) {
                    this._collapsed.add(n.id);
                }
                if (n.children) walk(n.children);
            }
        };
        walk(this._tree());
    }

    _commit(next) {
        const SF = this._SF();
        if (!this.thing?.entry) return;
        if (SF) SF.applyToEntry(this.thing.entry, next);
        else this.thing.entry.storageFilter = next;
        const settle = this.settle;
        this.scene.settlementSys?.sendNet("setStorageFilter", {
            settlementId: settle?.id,
            uid: this.thing.entry.uid,
            filter: this.thing.entry.storageFilter || null
        });
        this.refresh();
    }

    _cyclePriority(dir) {
        const SF = this._SF();
        if (!SF) return;
        const f = this._filter();
        f.priority = SF.cyclePriority(f.priority, dir);
        this._commit(f);
    }

    open(settle, thing) {
        if (!settle || !thing?.entry?.uid) return;
        this.settle = settle;
        this.thing = thing;
        this._scroll = 0;
        this._collapseAll();
        this.visible = true;
        this.root.setVisible(true);
        this.layout();
        this.refresh();
    }

    close() {
        this.visible = false;
        this.settle = null;
        this.thing = null;
        this.root.setVisible(false);
        this.scrollTrack.setVisible(false);
        this.scrollThumb.setVisible(false);
    }

    handleEsc() {
        if (!this.visible) return false;
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
        const prioW = Math.round(168 * s);
        const prioH = Math.round(22 * s);
        const prioY = Math.round(42 * s);
        this.prioBtn.setPosition(pad + prioW / 2, prioY);
        this._sizeBtn(this.prioBtn, prioW, prioH, 12);
        const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2;
        this.bg.setStrokeStyle(sw, 0x2a2218);
        this._bodyX = pad;
        this._bodyY = prioY + Math.ceil(prioH / 2) + Math.ceil(sw / 2) + Math.round(8 * s);
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
        const tip = this.scene._tooltipTarget;
        if (tip) {
            let cur = tip;
            while (cur) {
                if (cur === this.body || cur === this.root) {
                    this.scene.hideTooltip?.();
                    break;
                }
                cur = cur.parentContainer;
            }
        }
        this.body.removeAll(true);
    }

    refresh() {
        if (!this.visible || !this.thing) return;
        const s = this.scene.uiScale || 1;
        const SF = this._SF();
        const name = this.thing?.meta?.name || this.thing?.entry?.id || "Basket";
        this.title.setText("Storage");
        this.subtitle.setText(String(name));
        const f = this._filter();
        const prio = SF?.PRIORITY_LABELS?.[f.priority] || "Normal";
        if (this.prioBtn._txt) this.prioBtn._txt.setText(`Priority: ${prio}`);
        this._clearBody();
        this._treeCache = this._tree();
        const { inset } = this._contentBox();
        const y = this._fillTree(this._treeCache, 0, inset, s, f, this._treeCache);
        this._contentH = Math.max(y + inset, 1);
        this._maxScroll = Math.max(0, this._contentH - this._viewH);
        this._setScroll(Math.min(this._scroll, this._maxScroll));
        this._refreshMask();
    }

    _label(text, x, y, size = 12, color = "#d4c4a8") {
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

    _iconKey(row) {
        if (row?.id && String(row.id).startsWith("tool:")) return null;
        const def = this.scene.getItem?.(row?.id) || row;
        if (typeof Place !== "undefined" && Place.itemIconKey) {
            const key = Place.itemIconKey(
                def,
                (id) => this.scene.getThing?.(id),
                (k) => this.scene.textures.exists(k)
            );
            if (key && this.scene.textures.exists(key)) return key;
        }
        if (row?.key && this.scene.textures.exists(row.key)) return row.key;
        if (def?.key && this.scene.textures.exists(def.key)) return def.key;
        return null;
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
        } else if (state === "mixed") {
            const dash = [];
            for (let x = 0; x <= 6; x++) {
                dash.push([x, 2], [x, 3]);
            }
            this._pixelGlyph(g, u, 0xe0c14b, dash);
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
        if (state === "mixed") return { fill: 0x3a3010, stroke: 0xe0c14b, text: "#ead9a0" };
        return { fill: 0x3a1816, stroke: 0xc44c3c, text: "#e8c0b8" };
    }

    _row(x, y, w, h, state, onClick) {
        const c = this._rowColors(state);
        const bg = this.scene.add.rectangle(x, y, w, h, c.fill, 1)
            .setOrigin(0, 0)
            .setStrokeStyle(1, c.stroke)
            .setInteractive({
                hitArea: new Phaser.Geom.Rectangle(0, 0, w, h),
                hitAreaCallback: (area, lx, ly) => this._clipHit(area, lx, ly),
                useHandCursor: true
            });
        bg.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (!this._pointerInBody(pointer)) return;
            onClick?.(pointer);
        });
        this.body.add(bg);
        return bg;
    }

    _fillTree(nodes, depth, y, sc, filter, root) {
        const SF = this._SF();
        const tree = root || this._treeCache || nodes;
        const { inset, innerW } = this._contentBox();
        const rowH = Math.round(26 * sc);
        const gap = Math.round(3 * sc);
        const step = Math.round(16 * sc);
        const chevW = Math.round(16 * sc);
        const iconS = Math.round(14 * sc);
        const statusX = inset + innerW - Math.round(12 * sc);
        const indent = step * Math.max(0, depth);
        for (const node of nodes || []) {
            const state = SF ? SF.categoryState(filter, tree, node.id) : "on";
            const collapsed = this._collapsed.has(node.id);
            const rowX = inset + indent;
            const rowW = Math.max(chevW + Math.round(24 * sc), innerW - indent);
            const hasKids = (node.children && node.children.length) || (node.items && node.items.length);
            const midY = y + rowH / 2;
            const colors = this._rowColors(state);
            this._row(rowX, y, rowW, rowH, state, (pointer) => {
                const local = pointer.x - (this.root.x + this._bodyX + rowX);
                if (hasKids && local < chevW) {
                    if (collapsed) this._collapsed.delete(node.id);
                    else this._collapsed.add(node.id);
                    this.refresh();
                    return;
                }
                if (!SF) return;
                this._commit(SF.toggleCategory(this._filter(), tree, node.id));
            });
            if (hasKids) {
                this._label(collapsed ? ">" : "v", rowX + Math.round(4 * sc), midY, 12, colors.text);
            }
            this._label(
                node.name,
                rowX + (hasKids ? chevW : Math.round(6 * sc)),
                midY,
                12,
                colors.text
            );
            this._addStatus(state, statusX, midY, sc);
            y += rowH + gap;
            if (collapsed) continue;
            y = this._fillTree(node.children || [], depth + 1, y, sc, filter, tree);
            for (const it of node.items || []) {
                const on = SF ? SF.itemState(filter, tree, it.id) === "on" : true;
                const itemState = on ? "on" : "off";
                const itemColors = this._rowColors(itemState);
                const itemMid = y + rowH / 2;
                const itemIndent = step * (depth + 1);
                const itemX = inset + itemIndent;
                const itemW = Math.max(iconS + Math.round(24 * sc), innerW - itemIndent);
                this._row(itemX, y, itemW, rowH, itemState, () => {
                    if (!SF) return;
                    this._commit(SF.toggleItem(this._filter(), tree, it.id));
                });
                const ic = this._iconKey(it);
                const iconCx = itemX + Math.round(10 * sc);
                if (ic) {
                    const icon = this.scene.add.image(iconCx, itemMid, ic)
                        .setDisplaySize(iconS, iconS);
                    this.body.add(icon);
                }
                this._label(
                    it.name,
                    itemX + Math.round(20 * sc),
                    itemMid,
                    12,
                    itemColors.text
                );
                this._addStatus(itemState, statusX, itemMid, sc);
                y += rowH + gap;
            }
        }
        return y;
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer) return false;
        const b = this.bg.getBounds();
        return Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y);
    }
}
