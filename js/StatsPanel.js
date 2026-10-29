/**
 * Fullscreen stat window opened from a bio. List on the left, sources on the right.
 * Same shell as the research tree: opaque frame, dimmed world, pause, and close.
 */
class StatsPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.pawn = null;
        this.selected = "meleeHit";
        this._scroll = 0;
        this._pauseWhileOpen = true;
        this._sizeSig = "";
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(16200).setVisible(false);
        scene.uiLayer?.add(this.root);
        this._build();
        scene.input.on("wheel", (_p, _over, _dx, dy) => {
            if (!this.visible) return;
            const ptr = scene.input.activePointer;
            const b = this._listBounds;
            if (!b || ptr.x < b.x || ptr.x > b.x + b.w || ptr.y < b.y || ptr.y > b.y + b.h) return;
            this._scroll = Math.max(0, Math.min(this._maxScroll(), this._scroll + dy * 0.4));
            this._placeRows();
        });
    }

    _build() {
        const scene = this.scene;
        this.dim = scene.add.rectangle(0, 0, 800, 600, 0x080604, 0.72)
            .setOrigin(0, 0)
            .setInteractive({ cursor: "default" });
        this.frame = scene.add.rectangle(0, 0, 800, 600, 0x120e0a, 1)
            .setOrigin(0, 0)
            .setStrokeStyle(2, 0x2a2218)
            .setInteractive({ cursor: "default" });
        this.listBg = scene.add.rectangle(0, 0, 10, 10, 0x0e0c0a, 1)
            .setOrigin(0, 0)
            .setInteractive({ cursor: "default" });
        this.divider = scene.add.rectangle(0, 0, 2, 10, 0x2a2218, 1).setOrigin(0, 0);
        this.portrait = scene.add.sprite(0, 0, "human", 1).setOrigin(0.5, 0.5).setVisible(false);
        this.title = scene.add.text(0, 0, "Stats", {
            fontFamily: typeof PIXEL_UI_FONT !== "undefined" ? PIXEL_UI_FONT : "monospace",
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0, 0.5);
        this.closeBtn = this._btn("Close", () => this.close());
        this.pauseBtn = makePauseGameButton(scene, () => this._togglePause(), true);
        this.left = scene.add.container(0, 0);
        this.right = scene.add.container(0, 0);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this._detailMaskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.left.setMask(new Phaser.Display.Masks.BitmapMask(scene, this._maskGfx));
        this.right.setMask(new Phaser.Display.Masks.BitmapMask(scene, this._detailMaskGfx));
        this.root.add([
            this.dim, this.frame, this.listBg, this.divider,
            this.left, this.right, this.portrait, this.title, this.pauseBtn, this.closeBtn
        ]);
        this.dim.on("pointerup", (p) => {
            if (!this.visible || (p?.button && p.button !== 0)) return;
            const b = this.frame.getBounds();
            if (b && !Phaser.Geom.Rectangle.Contains(b, p.x, p.y)) this.close();
        });
        this._rows = [];
        this._detail = [];
        this._listH = 0;
        this._viewH = 0;
    }

    toggle(pawn) {
        if (this.visible) this.close();
        else this.open(pawn);
    }

    open(pawn) {
        this.pawn = pawn || null;
        this.visible = true;
        this.root.setVisible(true);
        this.scene.hideTooltip?.();
        this.scene.uiLayer?.bringToTop?.(this.root);
        this._sizeSig = "";
        this.refresh();
        this._syncPause();
        this.scene.bioPanel?._paintInfo?.();
    }

    close() {
        if (!this.visible && !this.root.visible) return;
        this.visible = false;
        this.root.setVisible(false);
        this.pawn = null;
        this.scene.hideTooltip?.();
        this._syncPause();
        this.scene.bioPanel?._paintInfo?.();
    }

    handleEsc() {
        if (!this.visible) return false;
        this.close();
        return true;
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer) return false;
        return pointer.x >= 0 && pointer.x <= this.scene.scale.width
            && pointer.y >= 0 && pointer.y <= this.scene.scale.height;
    }

    /** The control under the cursor, or the dim so nothing behind the window can take the hover. */
    hoverObjAt(pointer) {
        if (!this.containsPointer(pointer)) return null;
        if (this._over(this.pauseBtn?._bg, pointer)) return this.pauseBtn._bg;
        if (this._over(this.closeBtn?._bg, pointer)) return this.closeBtn._bg;
        const b = this._listBounds;
        if (b && pointer.x >= b.x && pointer.x <= b.x + b.w && pointer.y >= b.y && pointer.y <= b.y + b.h) {
            for (let i = this._rows.length - 1; i >= 0; i--) {
                const row = this._rows[i];
                if (!row.pick) continue;
                if (this._over(row.hit, pointer)) return row.hit;
            }
        }
        return this.dim;
    }

    _over(obj, pointer) {
        if (!obj?.active || obj.visible === false) return false;
        const bounds = obj.getBounds?.();
        return !!(bounds && Phaser.Geom.Rectangle.Contains(bounds, pointer.x, pointer.y));
    }

    refresh() {
        if (!this.visible) return;
        this._clear(this.left);
        this._clear(this.right);
        this._rows = [];
        this._detail = [];
        const m = this._metrics();
        this._sizeSig = `${m.W}x${m.H}:${m.s}`;
        const entries = this._entries();
        if (!entries.some((row) => row.id === this.selected)) {
            this.selected = entries.find((row) => row.id)?.id || "meleeHit";
        }
        this.highlight = this.scene.add.rectangle(0, 0, 10, 10, 0xe6c15a, 1).setOrigin(0, 0);
        this.left.add(this.highlight);
        this._opts = this._statOpts();
        let y = 0;
        let group = "";
        let stripeAt = 0;
        for (const entry of entries) {
            if (entry.group !== group) {
                group = entry.group;
                stripeAt = 0;
                const head = this._text(group, "#8a7a62", 12);
                const band = Math.max(Math.round(20 * m.s), head.height);
                head.setOrigin(0, 0.5);
                this.left.add(head);
                this._rows.push({ obj: head, y, pick: false, band });
                y += band;
            }
            const on = entry.id === this.selected;
            const color = on ? "#1a120c" : "#d4c4a8";
            const line = this._text(entry.label, color, 12);
            line.setOrigin(0, 0.5);
            line.setX(Math.round(8 * m.s));
            const value = this._text(this._statValue(entry), color, 12);
            value.setOrigin(1, 0.5);
            const band = Math.max(Math.round(20 * m.s), line.height, value.height);
            let stripe = null;
            if (stripeAt % 2 === 1) {
                stripe = this.scene.add.rectangle(0, y, 10, band, 0x262017, 1).setOrigin(0, 0);
                this.left.add(stripe);
            }
            stripeAt++;
            const choose = (p) => {
                if (p?.button && p.button !== 0) return;
                this.selected = entry.id;
                this.refresh();
            };
            const hit = this.scene.add.rectangle(0, y, 10, band, 0x000000, 0.001)
                .setOrigin(0, 0);
            hit.setInteractive({ useHandCursor: true });
            hit.on("pointerdown", choose);
            this.left.add(hit);
            this.left.add(line);
            this.left.add(value);
            this._rows.push({ obj: line, value, hit, stripe, band, y, pick: true, id: entry.id });
            y += band;
        }
        this.left.bringToTop(this.highlight);
        for (const row of this._rows) {
            if (row.obj) this.left.bringToTop(row.obj);
            if (row.value) this.left.bringToTop(row.value);
            if (row.hit) this.left.bringToTop(row.hit);
        }
        this._listH = y;
        const picked = entries.find((row) => row.id === this.selected);
        this._paintDetail(picked, m);
        this.layout();
    }

    layout() {
        if (!this.visible) return;
        const m = this._metrics();
        const sig = `${m.W}x${m.H}:${m.s}`;
        if (sig !== this._sizeSig) {
            this.refresh();
            return;
        }
        const scene = this.scene;
        this.dim.setSize(m.W, m.H);
        if (this.dim.input?.hitArea?.setSize) this.dim.input.hitArea.setSize(m.W, m.H);
        this.frame.setPosition(m.pad, m.pad).setSize(m.frameW, m.frameH);
        this.frame.setStrokeStyle(typeof pixelUiStroke === "function" ? pixelUiStroke(m.s) : 2, 0x2a2218);
        const headerY = m.pad + Math.round(18 * m.s);
        const name = this._title();
        this.title.setText(name);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.title, 16, m.s);
        const shown = this._syncPortrait();
        const icon = Math.round(16 * m.s);
        const gap = Math.round(6 * m.s);
        let titleX = m.pad + Math.round(14 * m.s);
        if (shown) {
            this.portrait.setScale(m.s);
            this.portrait.setPosition(titleX + icon / 2, headerY);
            titleX += icon + gap;
        }
        this.title.setPosition(titleX, headerY);
        const closeW = Math.round(52 * m.s);
        const closeH = Math.round(22 * m.s);
        this.closeBtn.setPosition(m.pad + m.frameW - Math.round(40 * m.s), headerY);
        this._fitBtnHit(this.closeBtn, closeW, closeH);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.closeBtn._txt, 12, m.s);
        const sp = !!scene._isSingleplayerSession?.();
        if (this.pauseBtn) {
            this.pauseBtn.setVisible(sp);
            this.pauseBtn._checked = !!this._pauseWhileOpen;
            const pauseSide = closeH;
            const pauseGap = Math.round(8 * m.s);
            this.pauseBtn.setPosition(
                this.closeBtn.x - closeW / 2 - pauseGap - pauseSide / 2,
                headerY
            );
            this._sizeCheckBtn(this.pauseBtn, pauseSide, pauseSide);
        }
        const top = m.pad + m.header;
        const listH = Math.max(40, m.frameH - m.header - m.inset);
        this.listBg.setPosition(m.pad, top).setSize(m.listW, listH);
        if (this.listBg.input?.hitArea?.setSize) this.listBg.input.hitArea.setSize(m.listW, listH);
        this.divider.setPosition(m.pad + m.listW, top).setSize(m.div, listH);
        this.left.setPosition(m.pad + m.inset, top);
        this.right.setPosition(m.pad + m.listW + m.div + m.inset, top);
        this._viewH = listH;
        this._listInnerW = Math.max(8, m.listW - m.inset * 2);
        this._listBounds = { x: m.pad, y: top, w: m.listW, h: listH };
        const picked = this._rows.find((row) => row.id === this.selected);
        if (picked) {
            const rowH = picked.band || picked.obj?.height || 0;
            if (picked.y < this._scroll) this._scroll = picked.y;
            else if (picked.y + rowH > this._scroll + this._viewH) {
                this._scroll = picked.y + rowH - this._viewH;
            }
        }
        this._scroll = Math.max(0, Math.min(this._maxScroll(), this._scroll));
        this._maskGfx.clear();
        this._maskGfx.fillStyle(0xffffff, 1);
        this._maskGfx.fillRect(m.pad, top, m.listW, listH);
        this._detailMaskGfx.clear();
        this._detailMaskGfx.fillStyle(0xffffff, 1);
        this._detailMaskGfx.fillRect(
            m.pad + m.listW + m.div,
            top,
            Math.max(1, m.frameW - m.listW - m.div),
            listH
        );
        this._placeRows();
    }

    _metrics() {
        const s = this.scene.uiScale || 1;
        const W = this.scene.scale.width;
        const H = this.scene.scale.height;
        const pad = Math.round(18 * s);
        const frameW = Math.max(200, W - pad * 2);
        const frameH = Math.max(180, H - pad * 2);
        const header = Math.round(36 * s);
        const inset = Math.round(12 * s);
        const listW = Math.max(Math.round(220 * s), Math.round(frameW * 0.34));
        const div = Math.max(1, Math.round(2 * s));
        const detailW = Math.max(40, frameW - listW - div - inset * 2);
        return { s, W, H, pad, frameW, frameH, header, inset, listW, div, detailW };
    }

    _maxScroll() {
        return Math.max(0, this._listH - this._viewH);
    }

    _placeRows() {
        let hi = null;
        const right = this._listInnerW || 10;
        const valueX = Math.max(0, right - Math.round(8 * (this.scene.uiScale || 1)));
        for (const row of this._rows) {
            const top = row.y - this._scroll;
            if (row.band) {
                const mid = top + row.band / 2;
                if (typeof placeUiText === "function") placeUiText(row.obj, row.obj.x, mid, 0, 0.5);
                else row.obj.setY(mid);
                if (row.value) {
                    if (typeof placeUiText === "function") placeUiText(row.value, valueX, mid, 1, 0.5);
                    else row.value.setPosition(valueX, mid);
                }
            } else {
                row.obj.setY(top);
            }
            if (row.hit) {
                row.hit.setPosition(0, top);
                row.hit.setSize(right, row.band || row.obj.height || 0);
            }
            if (row.stripe) {
                row.stripe.setPosition(0, top);
                row.stripe.setSize(right, row.band || 0);
            }
            if (row.id === this.selected) hi = row;
        }
        if (!this.highlight) return;
        if (!hi) {
            this.highlight.setVisible(false);
            return;
        }
        this.highlight.setVisible(true);
        this.highlight.setPosition(0, hi.y - this._scroll);
        this.highlight.setSize(right, hi.band || hi.obj.height || 0);
    }

    _syncPortrait() {
        const key = this._portraitKey();
        if (!key || !this.scene.textures?.exists(key)) {
            this.portrait?.setVisible(false);
            return false;
        }
        if (this.portrait.texture?.key !== key) this.portrait.setTexture(key, 1);
        else this.portrait.setFrame(1);
        try {
            this.scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
        } catch (_) { /* texture already filtered */ }
        this.portrait.setVisible(true);
        return true;
    }

    _portraitKey() {
        const scene = this.scene;
        const pawn = this.pawn;
        const direct = pawn?.texture?.key;
        if (direct && scene.textures?.exists(direct)) return direct;
        const look = pawn?.look || pawn?.bio?.look;
        if (look && typeof PlayerLook !== "undefined") {
            const baked = PlayerLook.ensure(scene, look);
            if (baked && scene.textures?.exists(baked)) return baked;
        }
        const corpse = scene.bioPanel?._selectedCorpse?.();
        const corpseKey = corpse?.texture?.key;
        if (corpseKey && scene.textures?.exists(corpseKey)) return corpseKey;
        if (scene.textures?.exists("human")) return "human";
        return null;
    }

    _title() {
        const p = this.pawn;
        const named = p?.displayName?.() || p?.pawnName || (typeof p?.name === "string" ? p.name : "");
        if (named) return named;
        const fromBio = this.scene.bioPanel?._pawnName?.();
        if (fromBio && fromBio !== "them") return fromBio;
        return "Stats";
    }

    _entries() {
        const S = typeof Skills !== "undefined" ? Skills : null;
        const rows = [];
        const caps = this._caps();
        const body = [
            ["consciousness", "Consciousness"],
            ["moving", "Moving"],
            ["manipulation", "Manipulation"],
            ["pain", "Pain"],
            ["breathing", "Breathing"],
            ["bloodPumping", "Blood pumping"],
            ["bloodFiltration", "Blood filtration"],
            ["digestion", "Digestion"],
            ["sight", "Sight"],
            ["hearing", "Hearing"],
            ["talking", "Talking"],
            ["eating", "Eating"],
            ["bloodLoss", "Blood loss"]
        ];
        const catalog = S?.STAT_ROWS || [];
        for (const row of catalog) {
            if (row.group === "Combat") rows.push(row);
        }
        for (const [id, label] of body) {
            rows.push({ group: "Body", id: `cap:${id}`, label, cap: id });
        }
        for (const row of catalog) {
            if (row.group === "Body") rows.push(row);
        }
        for (const row of catalog) {
            if (row.group === "Hunger" || row.group === "Work") rows.push(row);
        }
        if (!caps) return catalog.slice();
        return rows;
    }

    _caps() {
        const body = this.pawn?.anatomy;
        if (!body || typeof Capacities === "undefined") return null;
        return this.pawn.capacities || new Capacities(body);
    }

    _statOpts() {
        const S = typeof Skills !== "undefined" ? Skills : null;
        const opts = S?.workOpts?.(this.scene, this.pawn) || {};
        if (typeof BodyCombat !== "undefined") {
            const attacks = BodyCombat.collectAttacks?.(this.pawn) || [];
            opts.attacks = attacks.map((a) => ({
                name: a.name,
                damage: a.damage,
                cooldown: a.cooldown,
                weightMultiplier: a.def?.weightMultiplier
            }));
        }
        return opts;
    }

    _statValue(entry) {
        if (!entry) return "";
        if (entry.cap) {
            const value = this._caps()?.[entry.cap]?.();
            return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 1000) / 10}%` : "—";
        }
        const S = typeof Skills !== "undefined" ? Skills : null;
        return S?.describeStat?.(this.pawn, entry.id, this._opts || this._statOpts())?.valueText || "";
    }

    _paintDetail(entry, m) {
        const s = m?.s || this.scene.uiScale || 1;
        const wrap = m?.detailW || 320;
        if (!entry) return;
        const title = this._text(entry.label, "#f4f0e6", 16);
        this.right.add(title);
        this._detail.push(title);
        let y = title.height + Math.round(10 * s);
        if (entry.cap) {
            const shown = this._statValue(entry);
            const caps = this._caps();
            const sentence = this._text("How this part of the body is working.", "#8a7a62", 12);
            sentence.setWordWrapWidth(wrap);
            sentence.setPosition(0, y);
            this.right.add(sentence);
            this._detail.push(sentence);
            y += sentence.height + Math.round(10 * s);
            const lines = caps?.explain?.(entry.cap) || [];
            for (const line of lines) {
                const t = this._text(line, "#d4c4a8", 12);
                t.setWordWrapWidth(wrap);
                t.setPosition(0, y);
                this.right.add(t);
                this._detail.push(t);
                y += t.height + Math.round(3 * s);
            }
            y += Math.round(12 * s);
            const fin = this._text(shown, "#f4f0e6", 16);
            fin.setPosition(0, y);
            this.right.add(fin);
            this._detail.push(fin);
            return;
        }
        const S = typeof Skills !== "undefined" ? Skills : null;
        const opts = this._opts || this._statOpts();
        const report = S?.describeStat?.(this.pawn, entry.id, opts);
        const sentence = this._text(report?.sentence || "", "#8a7a62", 12);
        sentence.setWordWrapWidth(wrap);
        sentence.setPosition(0, y);
        this.right.add(sentence);
        this._detail.push(sentence);
        y += sentence.height + Math.round(10 * s);
        for (const line of report?.lines || []) {
            if (line.blank) {
                y += Math.round(16 * s);
                continue;
            }
            const t = this._text(`${line.label}: ${line.value}`, "#d4c4a8", 12);
            t.setWordWrapWidth(wrap);
            t.setPosition(0, y);
            this.right.add(t);
            this._detail.push(t);
            y += t.height + Math.round(3 * s);
        }
        if (report?.rangeTable) return;
        y += Math.round(12 * s);
        const fin = this._text(report?.valueText || "", "#f4f0e6", 16);
        fin.setPosition(0, y);
        this.right.add(fin);
        this._detail.push(fin);
    }

    _text(value, color, size) {
        const s = this.scene.uiScale || 1;
        const font = typeof pixelUiFontSize === "function" ? pixelUiFontSize(size, s) : Math.round(size * s);
        const t = this.scene.add.text(0, 0, value, {
            fontFamily: typeof PIXEL_UI_FONT !== "undefined" ? PIXEL_UI_FONT : "monospace",
            fontSize: `${font}px`,
            color: color || "#d4c4a8"
        }).setOrigin(0, 0);
        if (typeof crispUiText === "function") crispUiText(t);
        return t;
    }

    _clear(container) {
        container.removeAll(true);
    }

    _togglePause() {
        if (!this.scene._isSingleplayerSession?.()) return;
        this._pauseWhileOpen = !this._pauseWhileOpen;
        if (this.pauseBtn) {
            this.pauseBtn._checked = this._pauseWhileOpen;
            this.pauseBtn._paint?.();
        }
        this._syncPause();
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
        if (!should && scene.resourceSummaryPanel?.visible && scene.resourceSummaryPanel._pauseWhileOpen) return;
        scene._setWorldSimFrozen?.(should);
    }

    _btn(label, onClick) {
        const scene = this.scene;
        const bg = scene.add.rectangle(0, 0, 52, 22, 0x120e0a, 1)
            .setInteractive({ useHandCursor: true });
        const txt = scene.add.text(0, 0, label, {
            fontFamily: typeof PIXEL_UI_FONT !== "undefined" ? PIXEL_UI_FONT : "monospace",
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

    _sizeCheckBtn(c, w, h) {
        if (!c) return;
        c._w = w;
        c._h = h;
        c._bg.setSize(w, h);
        if (c._bg.input?.hitArea?.setSize) c._bg.input.hitArea.setSize(w, h);
        else if (c._bg.input?.hitArea?.setTo) c._bg.input.hitArea.setTo(0, 0, w, h);
        c._paint?.();
    }

    _fitBtnHit(btn, w, h) {
        const bg = btn?._bg;
        if (!bg) return;
        bg.setSize(w, h);
        if (bg.input?.hitArea?.setSize) bg.input.hitArea.setSize(w, h);
        else if (bg.input?.hitArea?.setTo) bg.input.hitArea.setTo(0, 0, w, h);
    }

}
