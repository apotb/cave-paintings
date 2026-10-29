/**
 * Fullscreen read-only list of everything a settlement currently holds.
 * Opened from the Manage tab. Pauses like the research tree.
 */
class ResourceSummaryPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.settle = null;
        this._scroll = 0;
        this._contentH = 0;
        this._viewW = 0;
        this._viewH = 0;
        this._maxScroll = 0;
        this._bodyX = 0;
        this._bodyY = 0;
        this._sig = null;
        this._pauseWhileOpen = true;
        this._showCategories = false;
        this._showDurability = true;
        this._sort = null;
        this._scrollDrag = null;
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(16100).setVisible(false);
        scene.uiLayer?.add(this.root);
        this._build();
        this._bindInput();
    }

    _build() {
        const scene = this.scene;
        this.dim = scene.add.rectangle(0, 0, 800, 600, 0x080604, 0.72)
            .setOrigin(0, 0)
            .setInteractive({ cursor: "default" });
        this.frame = scene.add.rectangle(0, 0, 800, 600, 0x120e0a, 0.97)
            .setOrigin(0, 0)
            .setStrokeStyle(2, 0x2a2218)
            .setInteractive({ cursor: "default" });
        this.title = scene.add.text(0, 0, "All Settlement Resources", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0, 0.5);
        this.headerBg = scene.add.rectangle(0, 0, 100, 22, 0x1a1612, 1).setOrigin(0, 0);
        this.headerName = scene.add.text(0, 0, "Name", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "12px",
            color: "#8a7a62"
        }).setOrigin(0, 0.5);
        this.headerAmount = scene.add.text(0, 0, "Amount", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "12px",
            color: "#8a7a62"
        }).setOrigin(1, 0.5);
        this.headerNameHit = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0)
            .setOrigin(0, 0)
            .setInteractive({ useHandCursor: true });
        this.headerAmountHit = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0)
            .setOrigin(0, 0)
            .setInteractive({ useHandCursor: true });
        this._bindSortHit(this.headerNameHit, "name");
        this._bindSortHit(this.headerAmountHit, "amount");
        this.closeBtn = this._btn("Close", () => this.close());
        this.categoryBtn = this._checkBtn("Categories", () => this._toggleCategories());
        this.categoryBtn._checked = false;
        this.categoryBtn._paint?.();
        this.durabilityBtn = this._checkBtn("Durability", () => this._toggleDurability());
        this.pauseBtn = makePauseGameButton(scene, () => this._togglePause(), true);
        this.body = scene.add.container(0, 0);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.body.setMask(new Phaser.Display.Masks.BitmapMask(scene, this._maskGfx));
        this.scrollTrack = scene.add.rectangle(0, 0, 5, 100, 0x3a2e26, 1).setOrigin(0, 0).setVisible(false);
        this.scrollThumb = scene.add.rectangle(0, 0, 5, 20, 0x8a7260, 1).setOrigin(0, 0).setVisible(false);
        this.root.add([
            this.dim, this.frame, this.title, this.headerBg, this.headerName, this.headerAmount,
            this.headerNameHit, this.headerAmountHit,
            this.body, this.scrollTrack, this.scrollThumb,
            this.categoryBtn, this.durabilityBtn, this.pauseBtn, this.closeBtn
        ]);
    }

    _btn(label, onClick) {
        const scene = this.scene;
        const bg = scene.add.rectangle(0, 0, 52, 22, 0x120e0a, 1)
            .setInteractive({ useHandCursor: true });
        const txt = scene.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "14px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        const c = scene.add.container(0, 0, [bg, txt]);
        c._bg = bg;
        c._txt = txt;
        c._hovering = false;
        c._pressing = false;
        const paint = () => {
            const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
            if (c._pressing) {
                bg.setFillStyle(0x0a0806, 1);
                bg.setStrokeStyle(sw, 0xd4a84b);
            } else if (c._hovering) {
                bg.setFillStyle(0x120e0a, 1);
                bg.setStrokeStyle(sw, 0xffffff);
            } else {
                bg.setFillStyle(0x120e0a, 1);
                bg.setStrokeStyle(sw, 0x2a2218);
            }
        };
        c._paint = paint;
        bg.on("pointerover", () => { c._hovering = true; paint(); });
        bg.on("pointerout", () => {
            c._hovering = false;
            c._pressing = false;
            paint();
        });
        bg.on("pointerdown", (p) => {
            if (p?.button && p.button !== 0) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p) => {
            const was = c._pressing;
            c._pressing = false;
            paint();
            if (was) onClick?.(p);
        });
        paint();
        return c;
    }

    _checkBtn(label, onClick) {
        const scene = this.scene;
        const bg = scene.add.rectangle(0, 0, 148, 22, 0x1e3d1a, 1)
            .setInteractive({ useHandCursor: true });
        const txt = scene.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "14px",
            color: "#d4e8d0"
        }).setOrigin(0, 0.5);
        const glyph = scene.add.graphics();
        const c = scene.add.container(0, 0, [bg, txt, glyph]);
        c._bg = bg;
        c._txt = txt;
        c._glyph = glyph;
        c._w = 148;
        c._h = 22;
        c._label = label;
        c._checked = true;
        c._hovering = false;
        c._pressing = false;
        const paint = () => {
            const s = scene.uiScale || 1;
            const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2;
            const on = !!c._checked;
            const fill = on ? 0x1e3d1a : 0x3a1816;
            const stroke = c._pressing ? 0xd4a84b : (c._hovering ? 0xffffff : (on ? 0x5cbf63 : 0xc44c3c));
            bg.setFillStyle(fill, 1);
            bg.setStrokeStyle(sw, stroke);
            txt.setColor(on ? "#d4e8d0" : "#e8c0b8");
            this._layoutCheck(c, s);
        };
        c._paint = paint;
        bg.on("pointerover", () => { c._hovering = true; paint(); });
        bg.on("pointerout", () => {
            c._hovering = false;
            c._pressing = false;
            paint();
        });
        bg.on("pointerdown", (p) => {
            if (p?.button && p.button !== 0) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p) => {
            const was = c._pressing;
            c._pressing = false;
            paint();
            if (was) onClick?.(p);
        });
        paint();
        return c;
    }

    _layoutCheck(c, s) {
        if (!c) return;
        const w = c._w || 0;
        const pad = Math.round(8 * s);
        if (c._txt) {
            c._txt.setOrigin(0, 0.5);
            c._txt.setPosition(Math.round(-w / 2 + pad), 0);
            c._txt.setText(c._label || "");
        }
        if (c._glyph) {
            c._glyph.setPosition(Math.round(w / 2 - Math.round(12 * s)), 0);
            this._drawStatusGlyph(c._glyph, c._checked ? "on" : "off", s);
        }
    }

    _checkBtnWidth(c, s) {
        const padX = Math.round(8 * s);
        const glyphW = Math.round(14 * s);
        const textW = Math.ceil(c?._txt?.width || 70);
        return padX + textW + Math.round(4 * s) + glyphW + padX;
    }

    _sizeCheckBtn(c, w, h) {
        if (!c) return;
        c._w = w;
        c._h = h;
        c._bg.setSize(w, h);
        if (c._bg.input?.hitArea?.setSize) c._bg.input.hitArea.setSize(w, h);
        else if (c._bg.input?.hitArea?.setTo) c._bg.input.hitArea.setTo(0, 0, w, h);
        c._paint?.();
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

    _drawStatusGlyph(g, state, sc) {
        if (!g) return;
        g.clear();
        const u = Math.max(1, Math.round(sc));
        if (state === "on") {
            this._pixelGlyph(g, u, 0x5cbf63, [
                [0, 3], [1, 4], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]
            ]);
        } else {
            const cross = [];
            for (let i = 0; i <= 6; i++) cross.push([i, i], [i, 6 - i]);
            this._pixelGlyph(g, u, 0xc44c3c, cross);
        }
    }

    _fitHit(hit, x, y, w, h) {
        if (!hit) return;
        hit.setPosition(x, y).setSize(w, h);
        if (hit.input?.hitArea?.setSize) hit.input.hitArea.setSize(w, h);
        else if (hit.input?.hitArea?.setTo) hit.input.hitArea.setTo(0, 0, w, h);
    }

    _fitBtnHit(btn, w, h) {
        const bg = btn?._bg;
        if (!bg) return;
        bg.setSize(w, h);
        if (bg.input?.hitArea?.setSize) bg.input.hitArea.setSize(w, h);
        else if (bg.input?.hitArea?.setTo) bg.input.hitArea.setTo(0, 0, w, h);
    }

    _bindInput() {
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
            if (!this._pointerInFrame(p)) return;
            const step = Math.round(22 * (scene.uiScale || 1));
            this._setScroll(this._scroll + (dy > 0 ? step : -step));
        });
        scene.input.on("pointerdown", (p) => {
            if (!this.visible) return;
            if (p?.button && p.button !== 0) return;
            const b = this.frame?.getBounds?.();
            this._pressInside = !!(b && Phaser.Geom.Rectangle.Contains(b, p.x, p.y));
        });
        this.dim.on("pointerup", (p) => {
            if (!this.visible || (p?.button && p.button !== 0)) return;
            if (this._pressInside) return;
            const b = this.frame.getBounds();
            if (b && !Phaser.Geom.Rectangle.Contains(b, p.x, p.y)) this.close();
        });
    }

    _pointerInFrame(pointer) {
        if (!pointer || !this.visible) return false;
        const b = this.frame?.getBounds?.();
        return !!(b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y));
    }

    _pointerStillOn(obj, pointer) {
        if (!obj || !pointer) return false;
        const b = obj.getBounds?.();
        return !!(b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y));
    }

    _bindSortHit(hit, key) {
        hit.on("pointerup", (p) => {
            if (!this.visible || this._showCategories) return;
            if (p?.button && p.button !== 0) return;
            if (!this._pointerStillOn(hit, p)) return;
            this._cycleSort(key);
        });
    }

    _sortMark(key) {
        if (this._showCategories) return "";
        if (!this._sort || this._sort.key !== key) return " ⇅";
        return this._sort.dir === "asc" ? " ↑" : " ↓";
    }

    _syncSortChrome() {
        if (this.headerName) this.headerName.setText("Name" + this._sortMark("name"));
        if (this.headerAmount) this.headerAmount.setText("Amount" + this._sortMark("amount"));
        const on = !this._showCategories;
        for (const hit of [this.headerNameHit, this.headerAmountHit]) {
            if (hit?.input) hit.input.enabled = on;
        }
    }

    _cycleSort(key) {
        if (this._showCategories) return;
        const cur = this._sort;
        if (!cur || cur.key !== key) this._sort = { key, dir: "asc" };
        else if (cur.dir === "asc") this._sort = { key, dir: "desc" };
        else this._sort = null;
        this._scroll = 0;
        this._sig = null;
        this._syncSortChrome();
        if (this.visible) this.refresh();
    }

    _toggleCategories() {
        this._showCategories = !this._showCategories;
        if (this._showCategories) this._sort = null;
        if (this.categoryBtn) {
            this.categoryBtn._checked = this._showCategories;
            this.categoryBtn._paint?.();
        }
        this._scroll = 0;
        this._sig = null;
        if (this.visible) this.layout();
    }

    _toggleDurability() {
        this._showDurability = !this._showDurability;
        if (this.durabilityBtn) {
            this.durabilityBtn._checked = this._showDurability;
            this.durabilityBtn._paint?.();
        }
        this._scroll = 0;
        this._sig = null;
        if (this.visible) this.layout();
    }

    _togglePause() {
        if (!this.scene._isSingleplayerSession?.()) return;
        this._pauseWhileOpen = !this._pauseWhileOpen;
        if (this.pauseBtn) {
            this.pauseBtn._checked = this._pauseWhileOpen;
            this.pauseBtn._paint?.();
        }
        this._syncPause();
        if (this.visible) this.refresh();
    }

    _syncPause() {
        const scene = this.scene;
        const should = !!(
            this.visible
            && this._pauseWhileOpen
            && scene._isSingleplayerSession?.()
        );
        if (!should && scene.researchTreePanel?.visible && scene.researchTreePanel._pauseWhileOpen) return;
        if (!should && scene.schedulePanel?.visible && scene.schedulePanel._pauseWhileOpen) return;
        if (!should && scene.statsPanel?.visible && scene.statsPanel._pauseWhileOpen) return;
        scene._setWorldSimFrozen?.(should);
    }

    open(settle) {
        if (!settle) return;
        this.settle = settle;
        this.visible = true;
        this._scroll = 0;
        this._sig = null;
        this.root.setVisible(true);
        const panel = this.scene.settlementPanel;
        if (panel?.root) panel.root.setVisible(false);
        this.layout();
        this._syncPause();
    }

    close(opts = {}) {
        const restore = opts.restore !== false;
        if (!this.visible && !this.root?.visible) return;
        this.visible = false;
        this.settle = null;
        this._scrollDrag = null;
        this._sig = null;
        this.root.setVisible(false);
        this.scene.hideTooltip?.();
        this._syncPause();
        const panel = this.scene.settlementPanel;
        if (restore && panel?.visible && panel.settle) {
            panel.root.setVisible(true);
            panel.layout();
        }
    }

    handleEsc() {
        if (!this.visible) return false;
        this.close();
        return true;
    }

    _collect() {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const sys = this.scene.settlementSys;
        const settle = this.settle;
        if (!S?.summarizeResources || !sys || !settle) return [];
        return S.summarizeResources(
            sys.addedBaskets(settle),
            sys.settlersOf(settle.id),
            sys.dropsInRange(settle),
            (id) => this.scene.getItem?.(id),
            { durability: this._showDurability !== false }
        );
    }

    _linesFor(rows) {
        const cmp = (a, b) => {
            if (typeof Settlement !== "undefined" && Settlement.resourceNameCmp) {
                return Settlement.resourceNameCmp(a.name, b.name);
            }
            return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
                sensitivity: "base"
            });
        };
        if (!this._showCategories) {
            const items = (rows || []).slice();
            const sort = this._sort;
            const dir = sort?.dir === "desc" ? -1 : 1;
            if (sort?.key === "amount") {
                items.sort((a, b) => {
                    const d = (Number(a.qty) - Number(b.qty)) * dir;
                    if (d) return d;
                    return cmp(a, b);
                });
            } else if (sort?.key === "name") {
                items.sort((a, b) => cmp(a, b) * dir);
            } else {
                items.sort(cmp);
            }
            return items.map((row) => ({ kind: "item", row, depth: 0 }));
        }
        const SF = typeof StorageFilter !== "undefined" ? StorageFilter : null;
        const tree = (typeof Settlement !== "undefined" && Settlement.resourceCategoryTree)
            ? Settlement.resourceCategoryTree(rows)
            : (SF?.CATEGORY_TREE || []);
        const byCat = new Map();
        for (const row of rows || []) {
            const id = row.categoryId || "junk";
            if (!byCat.has(id)) byCat.set(id, []);
            byCat.get(id).push(row);
        }
        for (const list of byCat.values()) list.sort(cmp);
        const lines = [];
        const subtree = (node) => {
            if (!node) return false;
            if (byCat.has(node.id)) return true;
            return (node.children || []).some(subtree);
        };
        const walk = (nodes, depth) => {
            for (const n of nodes || []) {
                if (!subtree(n)) continue;
                lines.push({ kind: "band", name: n.name, depth });
                const direct = byCat.get(n.id);
                if (direct) {
                    for (const row of direct) lines.push({ kind: "item", row, depth: depth + 1 });
                    byCat.delete(n.id);
                }
                walk(n.children, depth + 1);
            }
        };
        walk(tree, 0);
        if (byCat.size) {
            lines.push({ kind: "band", name: "Other", depth: 0 });
            const rest = [];
            for (const list of byCat.values()) rest.push(...list);
            rest.sort(cmp);
            for (const row of rest) lines.push({ kind: "item", row, depth: 1 });
        }
        return lines;
    }

    _drawMealIcon(scene, row, x, y, size) {
        const id = row?.sample?.id;
        if (id !== "coconut_meal") return false;
        const shell = typeof COCONUT_SHELL_KEY !== "undefined" ? COCONUT_SHELL_KEY : "cracked_coconut";
        const fill = typeof COCONUT_FILL_KEY !== "undefined" ? COCONUT_FILL_KEY : "cracked_coconut_overlay";
        if (!scene.textures.exists(shell) || !scene.textures.exists(fill)) return false;
        const base = scene.add.image(x, y, shell).setDisplaySize(size, size);
        this.body.add(base);
        const overlay = scene.add.image(x, y, fill).setDisplaySize(size, size);
        const tint = (typeof simmerNameFillTint === "function")
            ? simmerNameFillTint((itemId) => scene.getItem?.(itemId), row.name)
            : null;
        if (tint != null) overlay.setTint(tint);
        this.body.add(overlay);
        return true;
    }

    _itemIconKey(sample) {
        const scene = this.scene;
        const id = sample?.id;
        if (!id) return null;
        if (
            (sample.toolClass || sample.knapIconData || sample.knapIcon)
            && typeof Knapping !== "undefined"
            && typeof Knapping.ensureShapeTexture === "function"
        ) {
            try {
                const key = Knapping.ensureShapeTexture(scene, sample);
                if (key && scene.textures.exists(key)) return key;
            } catch (_) { /* item-def icon */ }
        }
        if ((id === "pebble" || id === "grindstone") && typeof ensureStoneTexture === "function") {
            const kind = id === "grindstone" ? "grindstone" : "pebble";
            // Pebble shade marks live on variant 2. A grindstone always stamps its mask.
            const variant = id === "pebble" ? 2 : 1;
            const key = ensureStoneTexture(scene, kind, variant, sample?.stone);
            if (key && scene.textures.exists(key)) return key;
        }
        if (id === "painting_circle" && typeof ensurePaintingCircleTexture === "function") {
            const key = ensurePaintingCircleTexture(scene, sample?.stone);
            if (key && scene.textures.exists(key)) return key;
        }
        if ((id === "stone_spear" || id === "flint_spear") && typeof ensureSpearTexture === "function") {
            const key = ensureSpearTexture(scene, sample?.knapMaterial, sample?.stone);
            if (key && scene.textures.exists(key)) return key;
        }
        const def = scene.getItem?.(id) || { id, key: id };
        if (typeof Place !== "undefined" && Place.itemIconKey) {
            const key = Place.itemIconKey(
                def,
                (tid) => scene.getThing?.(tid),
                (k) => scene.textures.exists(k)
            );
            if (key && scene.textures.exists(key)) return key;
        }
        if (def?.key && scene.textures.exists(def.key)) return def.key;
        if (scene.textures.exists(id)) return id;
        return null;
    }

    _text(x, y, str, size, color) {
        const s = this.scene.uiScale || 1;
        const t = this.scene.add.text(x, y, str, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${typeof pixelUiFontSize === "function" ? pixelUiFontSize(size, s) : size}px`,
            color
        });
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(t, size, s);
        this.body.add(t);
        return t;
    }

    refresh() {
        if (!this.visible || !this.settle) return;
        const rows = this._collect();
        const sortSig = (!this._showCategories && this._sort) ? `${this._sort.key}:${this._sort.dir}` : "default";
        const sig = rows.map((r) => `${r.categoryId}|${r.name}|${r.qty}`).join(";")
            + `:${this._viewW}x${this._viewH}:${this.scene.uiScale || 1}:${this._showCategories ? 1 : 0}:${this._showDurability !== false ? 1 : 0}:${sortSig}`;
        if (sig === this._sig && this.body.list?.length) return;
        const keep = this._scroll;
        this._sig = sig;
        this._rebuild(rows);
        this._contentH = Math.max(this._contentH, 1);
        this._maxScroll = Math.max(0, this._contentH - this._viewH);
        this._setScroll(Math.min(keep, this._maxScroll));
    }

    _rebuild(rows) {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        this.body.removeAll(true);
        const lines = this._linesFor(rows);
        const rowH = Math.round(22 * s);
        const barW = Math.max(4, Math.round(5 * s));
        const amountX = Math.max(40, this._viewW - barW - Math.round(6 * s));
        const iconS = Math.round(16 * s);
        let y = Math.round(4 * s);
        if (!lines.length) {
            const empty = this._text(Math.round(8 * s), y + rowH / 2, "Nothing stored.", 12, "#8a7a62");
            empty.setOrigin(0, 0.5);
            y += rowH;
            this._contentH = y + Math.round(8 * s);
            return;
        }
        const stripeW = Math.max(1, this._viewW);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (i % 2 === 1) {
                const stripe = scene.add.rectangle(0, y, stripeW, rowH, 0x262017, 1).setOrigin(0, 0);
                this.body.add(stripe);
            }
            const midY = y + rowH / 2;
            const indent = Math.round((8 + line.depth * 14) * s);
            if (line.kind === "band") {
                const band = this._text(indent, midY, line.name, 12, "#8a7a62");
                band.setOrigin(0, 0.5);
            } else {
                const row = line.row;
                let textX = indent;
                const iconX = indent + iconS / 2;
                if (this._drawMealIcon(scene, row, iconX, midY, iconS)) {
                    textX = indent + iconS + Math.round(4 * s);
                } else {
                    const iconKey = this._itemIconKey(row.sample);
                    if (iconKey) {
                        const icon = scene.add.image(iconX, midY, iconKey)
                            .setDisplaySize(iconS, iconS);
                        this.body.add(icon);
                        textX = indent + iconS + Math.round(4 * s);
                    }
                }
                const name = this._text(textX, midY, row.name, 12, "#d4c4a8");
                name.setOrigin(0, 0.5);
                const amt = this._text(amountX, midY, String(row.qty), 12, "#d4c4a8");
                amt.setOrigin(1, 0.5);
            }
            y += rowH;
        }
        this._contentH = y + Math.round(8 * s);
    }

    _setScroll(y) {
        this._scroll = Phaser.Math.Clamp(y, 0, this._maxScroll);
        this.body.setPosition(this._bodyX, this._bodyY - this._scroll);
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
            this.scrollThumb.input.hitArea.setSize(barW, thumbH);
        }
    }

    _refreshMask() {
        const wx = this.root.x + this._bodyX;
        const wy = this.root.y + this._bodyY;
        this._maskGfx.clear();
        this._maskGfx.fillStyle(0xffffff, 1);
        this._maskGfx.fillRect(wx, wy, this._viewW, this._viewH);
    }

    layout() {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const W = scene.scale.width;
        const H = scene.scale.height;
        this.dim.setSize(W, H);
        if (this.dim.input?.hitArea?.setSize) this.dim.input.hitArea.setSize(W, H);
        const pad = Math.round(18 * s);
        const frameW = Math.max(200, W - pad * 2);
        const frameH = Math.max(180, H - pad * 2);
        this.frame.setPosition(pad, pad).setSize(frameW, frameH);
        this.frame.setStrokeStyle(typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2, 0x2a2218);
        if (this.frame.input?.hitArea?.setSize) this.frame.input.hitArea.setSize(frameW, frameH);
        const headerY = pad + Math.round(18 * s);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.title, 16, s);
        this.title.setPosition(pad + Math.round(14 * s), headerY);
        const closeW = Math.round(52 * s);
        const closeH = Math.round(22 * s);
        this.closeBtn.setPosition(pad + frameW - Math.round(14 * s) - closeW / 2, headerY);
        this._fitBtnHit(this.closeBtn, closeW, closeH);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.closeBtn._txt, 12, s);
        this.closeBtn._paint?.();
        const sp = !!scene._isSingleplayerSession?.();
        const gap = Math.round(8 * s);
        let anchorRight = this.closeBtn.x - closeW / 2 - gap;
        if (this.pauseBtn) {
            this.pauseBtn.setVisible(sp);
            this.pauseBtn._checked = !!this._pauseWhileOpen;
            if (sp) {
                const pauseW = closeH;
                this.pauseBtn.setPosition(anchorRight - pauseW / 2, headerY);
                this._sizeCheckBtn(this.pauseBtn, pauseW, pauseW);
                anchorRight = this.pauseBtn.x - pauseW / 2 - gap;
            }
        }
        if (this.durabilityBtn) {
            this.durabilityBtn.setVisible(true);
            this.durabilityBtn._checked = this._showDurability !== false;
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.durabilityBtn._txt, 12, s);
            const durW = this._checkBtnWidth(this.durabilityBtn, s);
            this.durabilityBtn.setPosition(anchorRight - durW / 2, headerY);
            this._sizeCheckBtn(this.durabilityBtn, durW, closeH);
            anchorRight = this.durabilityBtn.x - durW / 2 - gap;
        }
        if (this.categoryBtn) {
            this.categoryBtn.setVisible(true);
            this.categoryBtn._checked = !!this._showCategories;
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.categoryBtn._txt, 12, s);
            const catW = this._checkBtnWidth(this.categoryBtn, s);
            this.categoryBtn.setPosition(anchorRight - catW / 2, headerY);
            this._sizeCheckBtn(this.categoryBtn, catW, closeH);
        }
        const colY = headerY + Math.round(20 * s);
        const colH = Math.round(22 * s);
        this._bodyX = pad + Math.round(12 * s);
        this._bodyY = colY + colH;
        const bottom = pad + frameH - Math.round(12 * s);
        this._viewW = Math.max(80, frameW - Math.round(24 * s));
        this._viewH = Math.max(40, bottom - this._bodyY);
        this.headerBg.setPosition(this._bodyX, colY).setSize(this._viewW, colH);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.headerName, 12, s);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.headerAmount, 12, s);
        this._syncSortChrome();
        this.headerName.setPosition(this._bodyX + Math.round(8 * s), colY + colH / 2);
        const barW = Math.max(4, Math.round(5 * s));
        this.headerAmount.setPosition(
            this._bodyX + this._viewW - barW - Math.round(6 * s),
            colY + colH / 2
        );
        const amountHitW = Math.min(
            this._viewW - 40,
            Math.ceil(this.headerAmount.width || 48) + Math.round(12 * s)
        );
        const nameHitW = Math.max(40, this._viewW - amountHitW);
        this._fitHit(this.headerNameHit, this._bodyX, colY, nameHitW, colH);
        this._fitHit(this.headerAmountHit, this._bodyX + nameHitW, colY, amountHitW, colH);
        this._refreshMask();
        if (this.visible) this.refresh();
        else this._layoutScrollbar();
    }

    hoverObjAt(pointer) {
        if (!pointer || !this.visible) return null;
        if (this.headerNameHit?.input?.enabled && this._pointerStillOn(this.headerNameHit, pointer)) return this.headerNameHit;
        if (this.headerAmountHit?.input?.enabled && this._pointerStillOn(this.headerAmountHit, pointer)) return this.headerAmountHit;
        if (this.categoryBtn?.visible && this._pointerStillOn(this.categoryBtn._bg, pointer)) return this.categoryBtn._bg;
        if (this.durabilityBtn?.visible && this._pointerStillOn(this.durabilityBtn._bg, pointer)) return this.durabilityBtn._bg;
        if (this.pauseBtn?.visible && this._pointerStillOn(this.pauseBtn._bg, pointer)) return this.pauseBtn._bg;
        if (this._pointerStillOn(this.closeBtn?._bg, pointer)) return this.closeBtn._bg;
        if (this._pointerInFrame(pointer)) return this.frame;
        return this.dim;
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer) return false;
        return pointer.x >= 0 && pointer.x <= this.scene.scale.width
            && pointer.y >= 0 && pointer.y <= this.scene.scale.height;
    }
}
