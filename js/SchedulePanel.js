/**
 * Schedule popup. Opened from the Manage tab. The 24-hour grid is too wide
 * for the side panel, so it sits in its own window.
 */
const SCHEDULE_FILL = {
    anything: 0x5a5a5a,
    work: 0xe07028,
    recreation: 0x7a4ea3,
    sleep: 0x3d6cb5
};
const SCHEDULE_FROM_LETTER = { a: "anything", w: "work", r: "recreation", s: "sleep" };
const SCHEDULE_MODES = [
    ["anything", "Anything"],
    ["work", "Work"],
    ["recreation", "Recreation"],
    ["sleep", "Sleep"]
];

function shadeScheduleColor(color, mul) {
    const m = Number(mul) > 0 ? Number(mul) : 1;
    const ch = (shift) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 255) * m)));
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

class SchedulePanel {
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
        this._mode = "anything";
        this._drag = null;
        this._draft = null;
        this._rows = [];
        this._pawns = [];
        this._modeBtns = [];
        this._scrollDrag = null;
        this._pressInside = false;
        this._geom = null;
        this._nameNeed = 0;
        this._nameWidths = new Map();
        this._pauseWhileOpen = false;
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
        this.frame = scene.add.rectangle(0, 0, 400, 300, 0x120e0a, 0.97)
            .setOrigin(0, 0)
            .setStrokeStyle(2, 0x2a2218)
            .setInteractive({ cursor: "default" });
        this.title = scene.add.text(0, 0, "Schedule", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0, 0.5);
        this.closeBtn = this._chromeBtn("Close", () => this.close());
        this.pauseBtn = makePauseGameButton(scene, () => this._togglePause(), false);
        this.modes = scene.add.container(0, 0);
        this.hourBar = scene.add.container(0, 0);
        this.body = scene.add.container(0, 0);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.body.setMask(new Phaser.Display.Masks.BitmapMask(scene, this._maskGfx));
        this.scrollTrack = scene.add.rectangle(0, 0, 5, 100, 0x3a2e26, 1).setOrigin(0, 0).setVisible(false);
        this.scrollThumb = scene.add.rectangle(0, 0, 5, 20, 0x8a7260, 1).setOrigin(0, 0).setVisible(false);
        this.root.add([
            this.dim, this.frame, this.title,
            this.modes, this.body, this.hourBar, this.scrollTrack, this.scrollThumb,
            this.pauseBtn, this.closeBtn
        ]);
    }

    _chromeBtn(label, onClick) {
        const scene = this.scene;
        const bg = scene.add.rectangle(0, 0, 52, 22, 0x120e0a, 1)
            .setStrokeStyle(2, 0x2a2218)
            .setInteractive({ useHandCursor: true, cursor: "pointer" });
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
            bg.setFillStyle(c._pressing ? 0x0a0806 : 0x120e0a, 1);
            bg.setStrokeStyle(sw, c._pressing || c._hovering ? 0xffffff : 0x2a2218);
        };
        c._paint = paint;
        bg.on("pointerover", () => { c._hovering = true; paint(); });
        bg.on("pointerout", () => { c._hovering = false; c._pressing = false; paint(); });
        bg.on("pointerdown", (p, _x, _y, event) => {
            event?.stopPropagation?.();
            if (p?.rightButtonDown?.() || p?.button === 2) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p) => {
            const was = c._pressing;
            c._pressing = false;
            paint();
            if (!was || (p?.button && p.button !== 0)) return;
            onClick();
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

    _modeBtn(x, y, w, h, mode, label) {
        const scene = this.scene;
        const fill = SCHEDULE_FILL[mode] || SCHEDULE_FILL.anything;
        const bg = scene.add.rectangle(0, 0, w, h, fill, 1)
            .setStrokeStyle(2, 0x2a2218)
            .setInteractive({ useHandCursor: true, cursor: "pointer" });
        const txt = scene.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "14px",
            color: mode === "work" ? "#1a120c" : "#d4c4a8"
        }).setOrigin(0.5);
        const c = scene.add.container(x, y, [bg, txt]);
        c._bg = bg;
        c._txt = txt;
        c._mode = mode;
        c._fill = fill;
        c._hovering = false;
        c._pressing = false;
        c._selected = mode === this._mode;
        const paint = () => {
            const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(scene.uiScale || 1) : 2;
            const color = c._pressing ? shadeScheduleColor(c._fill, 0.72) : c._fill;
            bg.setFillStyle(color, 1);
            const stroke = c._pressing || c._selected ? 0xd4a84b : (c._hovering ? 0xffffff : 0x1a120c);
            bg.setStrokeStyle(sw, stroke);
        };
        c._paint = paint;
        bg.on("pointerover", () => { c._hovering = true; paint(); });
        bg.on("pointerout", () => { c._hovering = false; c._pressing = false; paint(); });
        bg.on("pointerdown", (p, _x, _y, event) => {
            event?.stopPropagation?.();
            if (p?.rightButtonDown?.() || p?.button === 2) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p) => {
            const was = c._pressing;
            c._pressing = false;
            paint();
            if (!was || (p?.button && p.button !== 0)) return;
            this._selectMode(mode);
        });
        paint();
        return c;
    }

    _bindInput() {
        const scene = this.scene;
        this.scrollThumb.setInteractive({ useHandCursor: false, cursor: "default" });
        this.scrollThumb.on("pointerdown", (p, _x, _y, event) => {
            event?.stopPropagation?.();
            this._scrollDrag = { startY: p.y, startScroll: this._scroll };
        });
        scene.input.on("pointerup", () => {
            this._scrollDrag = null;
            if (this._endDrag()) this.refresh();
        });
        scene.input.on("pointermove", (p) => {
            this._onDragMove(p);
            if (!this.visible || !this._scrollDrag || this._maxScroll <= 0) return;
            const travel = Math.max(1, this._viewH - this.scrollThumb.height);
            const dy = p.y - this._scrollDrag.startY;
            this._setScroll(this._scrollDrag.startScroll + (dy / travel) * this._maxScroll);
        });
        scene.input.on("wheel", (pointer, _over, _dx, dy) => {
            if (!this.visible || this._maxScroll <= 0 || !dy) return;
            const p = pointer || scene.input.activePointer;
            if (!this._pointerInFrame(p)) return;
            const step = Math.round(22 * (scene.uiScale || 1));
            const before = this._scroll;
            this._setScroll(this._scroll + (dy > 0 ? step : -step));
            if (this._drag && this._scroll !== before) this._extendDrag(p);
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
        if (!should && scene.resourceSummaryPanel?.visible && scene.resourceSummaryPanel._pauseWhileOpen) return;
        if (!should && scene.statsPanel?.visible && scene.statsPanel._pauseWhileOpen) return;
        scene._setWorldSimFrozen?.(should);
    }

    open(settle) {
        if (!settle) return;
        if (this._drag) this._endDrag();
        this.settle = settle;
        this.visible = true;
        this._scroll = 0;
        this._mode = "anything";
        this._sig = null;
        this._pressInside = true;
        this.root.setVisible(true);
        const panel = this.scene.settlementPanel;
        if (panel?.root) panel.root.setVisible(false);
        this.layout();
        this._syncPause();
    }

    close(opts = {}) {
        const restore = opts.restore !== false;
        if (this._drag) this._endDrag();
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

    _here() {
        return this.scene.settlementSys?.settlersOf?.(this.settle?.id) || [];
    }

    _settlerName(pawn) {
        const raw = pawn?.displayName?.();
        if (raw == null || raw === "") return "?";
        return String(raw);
    }

    _namePad(s) {
        return Math.round(4 * s);
    }

    _nameProbeText() {
        if (this._nameProbe?.scene) return this._nameProbe;
        const probe = this.scene.add.text(0, 0, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "8px"
        });
        probe.setVisible(false);
        this._nameProbe = probe;
        return probe;
    }

    /** Pixel width of a schedule name at the row font size. */
    _nameTextWidth(label, s) {
        const text = String(label || "");
        const px = typeof pixelUiFontSize === "function" ? pixelUiFontSize(11, s) : 8;
        const key = `${px}\0${text}`;
        const cached = this._nameWidths.get(key);
        if (cached > 0) return cached;
        const probe = this._nameProbeText();
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(probe, 11, s);
        else probe.setFontSize(`${px}px`);
        probe.setText(text);
        const w = Math.ceil(probe.displayWidth || probe.width || 0);
        if (w > 0) {
            this._nameWidths.set(key, w);
            return w;
        }
        return Math.max(1, text.length) * px;
    }

    /**
     * Name column stays at the old fixed width for short names, and grows
     * when a longer name would otherwise run under the hour cells.
     */
    _nameColumnWidth(here, s) {
        const minW = Math.round(56 * s);
        const pad = this._namePad(s);
        let widest = 0;
        for (let i = 0; i < (here?.length || 0); i++) {
            widest = Math.max(widest, this._nameTextWidth(this._settlerName(here[i]), s));
        }
        return Math.max(minW, pad + widest + pad);
    }

    _nameNeedFor(here, s) {
        if (!here?.length) return 0;
        return this._nameColumnWidth(here, s);
    }

    layout() {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const W = scene.scale.width;
        const H = scene.scale.height;
        const margin = Math.round(16 * s);
        const pad = Math.round(12 * s);
        const titleH = Math.round(36 * s);
        const gap = Math.round(8 * s);
        const bottom = Math.round(12 * s);
        const barW = Math.max(4, Math.round(5 * s));
        const barGap = Math.round(4 * s);
        const here = this.visible ? this._here() : [];
        this._nameNeed = this._nameNeedFor(here, s);
        const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2;
        this.dim.setSize(W, H);
        if (this.dim.input?.hitArea?.setSize) this.dim.input.hitArea.setSize(W, H);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.title, 14, s);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.closeBtn._txt, 12, s);
        const sp = !!scene._isSingleplayerSession?.();
        if (this.pauseBtn) {
            this.pauseBtn.setVisible(sp);
            this.pauseBtn._checked = !!this._pauseWhileOpen;
            if (sp) this.pauseBtn._bg.setInteractive({ useHandCursor: true, cursor: "pointer" });
            else this.pauseBtn._bg.disableInteractive?.();
        }
        const closeW = Math.round(52 * s);
        const closeH = Math.round(22 * s);
        const pauseW = sp && this.pauseBtn ? closeH : 0;
        this.closeBtn._bg.setSize(closeW, closeH);
        if (this.closeBtn._bg.input?.hitArea?.setSize) {
            this.closeBtn._bg.input.hitArea.setSize(closeW, closeH);
        }
        this.closeBtn._paint?.();

        let frameW;
        let frameH;
        let gridW = 0;
        let cellS = 0;
        let nameW = 0;
        let viewH = 0;
        if (!here.length) {
            frameW = Math.min(W - margin * 2, Math.round(360 * s));
            frameH = titleH + gap + Math.round(28 * s) + bottom;
        } else {
            const availW = Math.max(220, W - margin * 2);
            const minNameW = Math.round(56 * s);
            nameW = Math.max(minNameW, this._nameNeed || minNameW);
            cellS = Math.round(20 * s);
            const inner = availW - pad * 2 - barGap - barW;
            if (nameW + cellS * 24 > inner) {
                cellS = Math.max(8, Math.floor((inner - nameW) / 24));
            }
            // Hour cells can shrink to the existing minimum. Past that, the
            // window fills the screen and the name column takes what is left.
            if (nameW + cellS * 24 > inner) {
                const room = inner - 8 * 24;
                if (room >= minNameW) {
                    cellS = 8;
                    nameW = room;
                } else {
                    nameW = minNameW;
                    cellS = Math.max(8, Math.floor((inner - nameW) / 24));
                }
            }
            gridW = nameW + cellS * 24;
            const modeH = Math.round(22 * s);
            const hourH = cellS;
            const rowH = cellS;
            const chrome = titleH + gap + modeH + gap + hourH + bottom;
            const maxFrameH = Math.max(chrome + rowH, H - margin * 2);
            const contentH = rowH * here.length;
            viewH = Math.min(contentH, Math.max(rowH, maxFrameH - chrome));
            frameW = pad + gridW + barGap + barW + pad;
            frameH = chrome + viewH;
        }
        const titleW = Math.ceil(this.title.width || Math.round(72 * s));
        const headerNeed = pad + titleW + gap + (pauseW ? pauseW + gap : 0) + closeW + pad;
        frameW = Math.min(W - margin * 2, Math.max(frameW, headerNeed));
        const frameX = Math.round(Math.max(margin, (W - frameW) / 2));
        const frameY = Math.round(Math.max(margin, (H - frameH) / 2));
        this.frame.setPosition(frameX, frameY).setSize(frameW, frameH);
        this.frame.setStrokeStyle(sw, 0x2a2218);
        if (this.frame.input?.hitArea?.setSize) this.frame.input.hitArea.setSize(frameW, frameH);
        this.title.setPosition(frameX + pad, frameY + titleH / 2);
        this.closeBtn.setPosition(frameX + frameW - pad - closeW / 2, frameY + titleH / 2);
        if (this.pauseBtn && sp) {
            this.pauseBtn.setPosition(
                this.closeBtn.x - closeW / 2 - gap - pauseW / 2,
                frameY + titleH / 2
            );
            this._sizeCheckBtn(this.pauseBtn, closeH, closeH);
        }

        const modeY = frameY + titleH + gap;
        const modeH = here.length ? Math.round(22 * s) : 0;
        const hourY = modeY + (here.length ? modeH + gap : 0);
        this._bodyX = frameX + pad;
        this._bodyY = here.length ? hourY + cellS : hourY;
        this._viewW = gridW;
        this._viewH = viewH;
        this.modes.setPosition(this._bodyX, modeY);
        this.hourBar.setPosition(this._bodyX, hourY);
        this.hourBar.setVisible(!!here.length);
        this._geom = {
            rows: here.length,
            cellS,
            nameW,
            gridW,
            modeH: here.length ? modeH : Math.round(28 * s),
            pad
        };
        this._sig = null;
        this._refreshMask();
        this._inLayout = true;
        try {
            if (this.visible) this.refresh();
            else this._layoutScrollbar();
        } finally {
            this._inLayout = false;
        }
    }

    _refreshMask() {
        this._maskGfx.clear();
        this._maskGfx.fillStyle(0xffffff, 1);
        this._maskGfx.fillRect(this._bodyX, this._bodyY, Math.max(1, this._viewW), Math.max(1, this._viewH));
    }

    _setScroll(y) {
        this._scroll = Phaser.Math.Clamp(y, 0, this._maxScroll);
        this.body.setPosition(this._bodyX, this._bodyY - this._scroll);
        this._layoutScrollbar();
    }

    _layoutScrollbar() {
        const s = this.scene.uiScale || 1;
        const need = this._maxScroll > 0.5 && this.visible;
        this.scrollTrack.setVisible(need);
        this.scrollThumb.setVisible(need);
        if (!need) return;
        const barW = Math.max(4, Math.round(5 * s));
        const barGap = Math.round(4 * s);
        const trackH = this._viewH;
        const thumbH = Math.max(16 * s, trackH * (this._viewH / Math.max(this._contentH, 1)));
        const travel = Math.max(1, trackH - thumbH);
        const t = this._maxScroll > 0 ? this._scroll / this._maxScroll : 0;
        const x = this._bodyX + this._viewW + barGap;
        this.scrollTrack.setPosition(x, this._bodyY).setSize(barW, trackH);
        this.scrollThumb.setPosition(x, this._bodyY + travel * t).setSize(barW, thumbH);
        if (this.scrollThumb.input?.hitArea?.setSize) {
            this.scrollThumb.input.hitArea.setSize(this.scrollThumb.width, this.scrollThumb.height);
        }
    }

    _sigFor(here) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const rows = here.map((p) => {
            const pid = p.pawnId || p.id;
            const name = this._settlerName(p);
            return `${pid}${p.favorite ? "*" : ""}:${name}:${S ? S.scheduleFor(this.settle, pid) : ""}`;
        }).join("|");
        const g = this._geom || {};
        return `${rows}|${g.gridW}x${g.viewH || this._viewH}`;
    }

    /** Minute of the game day, 0–1439. The clock advances in whole minutes. */
    _clockMinute() {
        const m = Math.floor(Number(this.scene.gameMinutes) || 0);
        return ((m % 1440) + 1440) % 1440;
    }

    refresh() {
        this._tickDragScroll();
        if (!this.visible || !this.settle || !this._geom || this._drag) return;
        const here = this._here();
        const nameNeed = this._nameNeedFor(here, this.scene.uiScale || 1);
        if (!this._inLayout && (this._geom.rows !== here.length || nameNeed !== this._nameNeed)) {
            this.layout();
            return;
        }
        const sig = this._sigFor(here);
        if (sig === this._sig) {
            this._placeNowLine();
            return;
        }
        this._sig = sig;
        this._clearContent();
        if (!here.length) this._drawEmpty();
        else this._drawGrid(here);
        this._contentH = this._pendingH || 0;
        this._maxScroll = Math.max(0, this._contentH - this._viewH);
        this._setScroll(this._scroll);
    }

    _clearContent() {
        this.modes.removeAll(true);
        this.hourBar.removeAll(true);
        this.body.removeAll(true);
        this._modeBtns = [];
        this._rows = [];
        this._pawns = [];
        this._nowMark = null;
        this.scene.hideTooltip?.();
    }

    _drawEmpty() {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const t = scene.add.text(0, 0, "Drop people off to set a schedule.", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(12, s)}px`,
            color: "#d4c4a8",
            wordWrap: { width: Math.max(80, (this.frame.width || 200) - Math.round(32 * s)) }
        }).setOrigin(0, 0);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(t, 12, s);
        this.modes.add(t);
        this._pendingH = 0;
        this.body.setPosition(this._bodyX, this._bodyY);
    }

    _drawGrid(here) {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const g = this._geom;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const cellS = g.cellS;
        const nameW = g.nameW;
        const gridW = g.gridW;
        const modeH = g.modeH;
        const stroke = Math.max(1, Math.round(s));
        const gap = Math.round(4 * s);
        const n = SCHEDULE_MODES.length;
        const bw = Math.max(8, Math.floor((gridW - gap * (n - 1)) / n));
        this._modeBtns = [];
        for (let i = 0; i < n; i++) {
            const [mode, label] = SCHEDULE_MODES[i];
            const btn = this._modeBtn(i * (bw + gap) + bw / 2, modeH / 2, bw, modeH, mode, label);
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(btn._txt, 11, s);
            if (mode === "work") btn._txt.setColor("#1a120c");
            btn._paint?.();
            this.modes.add(btn);
            this._modeBtns.push(btn);
        }

        const headerBg = scene.add.rectangle(0, 0, gridW, cellS, 0x1a1510, 1).setOrigin(0, 0);
        this.hourBar.add(headerBg);
        for (let i = 0; i < 24; i++) {
            const colX = nameW + i * cellS;
            const hit = scene.add.rectangle(colX, 0, cellS, cellS, 0x000000, 0)
                .setOrigin(0, 0)
                .setInteractive({ useHandCursor: true, cursor: "pointer" });
            hit.on("pointerover", (pointer) => {
                const ampm = typeof Settings !== "undefined" && Settings.loadAmPm();
                const text = (typeof ClockFormat !== "undefined")
                    ? ClockFormat.formatHourMinute(i, 0, ampm)
                    : `${String(i).padStart(2, "0")}:00`;
                scene.showTooltip(() => text, pointer.x, pointer.y, hit);
            });
            hit.on("pointerout", (pointer) => {
                if (this._pointerStillOn(hit, pointer)) return;
                if (scene._tooltipTarget === hit) scene.hideTooltip?.();
            });
            this.hourBar.add(hit);
            const ht = scene.add.text(colX + cellS / 2, cellS / 2, String(i), {
                fontFamily: PIXEL_UI_FONT,
                fontSize: `${pixelUiFontSize(10, s)}px`,
                color: "#d4c4a8"
            }).setOrigin(0.5);
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(ht, 10, s);
            this.hourBar.add(ht);
        }

        this._rows = [];
        this._pawns = here;
        for (let r = 0; r < here.length; r++) {
            const p = here[r];
            const pid = p.pawnId || p.id;
            const row = scene.add.container(0, r * cellS);
            const name = this._settlerName(p);
            const controlled = !!(p.isControlled?.() || p === scene.player);
            const nt = scene.add.text(this._namePad(s), cellS / 2, name, {
                fontFamily: PIXEL_UI_FONT,
                fontSize: `${pixelUiFontSize(11, s)}px`,
                color: p.favorite ? "#d4a84b" : (controlled ? "#b8ffb8" : "#d4c4a8")
            }).setOrigin(0, 0.5);
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(nt, 11, s);
            row.add(nt);
            const sched = S ? S.scheduleFor(this.settle, pid) : "a".repeat(24);
            const cells = [];
            for (let i = 0; i < 24; i++) {
                const mode = SCHEDULE_FROM_LETTER[sched.charAt(i)] || "anything";
                const bg = scene.add.rectangle(nameW + i * cellS, 0, cellS, cellS, this._fill(mode), 1)
                    .setOrigin(0, 0)
                    .setInteractive({ useHandCursor: true, cursor: "pointer" });
                this._clipInput(bg);
                bg.on("pointerdown", (pointer, _lx, _ly, event) => {
                    event?.stopPropagation?.();
                    if (pointer.rightButtonDown?.() || pointer.button === 2) return;
                    if (!this._pointerInBody(pointer)) return;
                    this._beginDrag(r, i);
                });
                row.add(bg);
                cells.push({ bg });
            }
            this.body.add(row);
            this._rows.push({ pawnId: pid, cells });
        }

        const rowsH = cellS * here.length;
        const gfx = scene.add.graphics();
        gfx.lineStyle(stroke, 0x1a120c, 1);
        gfx.strokeRect(stroke / 2, stroke / 2, gridW - stroke, rowsH - stroke);
        for (let i = 0; i <= 24; i++) {
            const x = nameW + i * cellS;
            gfx.lineBetween(x, 0, x, rowsH);
        }
        gfx.lineBetween(0, 0, 0, rowsH);
        for (let r = 1; r < here.length; r++) {
            gfx.lineBetween(0, r * cellS, gridW, r * cellS);
        }
        this.body.add(gfx);
        this._nowMark = scene.add.rectangle(0, 0, stroke, rowsH, 0xe8dcc8, 1).setOrigin(0, 0);
        this.body.add(this._nowMark);
        this._placeNowLine();
        this._pendingH = rowsH;
        this.body.setPosition(this._bodyX, this._bodyY - this._scroll);
    }

    /** Light vertical mark at the current minute, through the settler rows only. */
    _placeNowLine() {
        const g = this._geom;
        const mark = this._nowMark;
        if (!g?.cellS || !mark?.active) return;
        const stroke = Math.max(1, Math.round(this.scene.uiScale || 1));
        const x = Math.round(g.nameW + (this._clockMinute() / 60) * g.cellS);
        const clamped = Math.max(g.nameW, Math.min(g.gridW - stroke, x));
        mark.setPosition(clamped, 0).setSize(stroke, mark.height);
        this.body.bringToTop(mark);
    }

    _fill(mode) {
        return SCHEDULE_FILL[mode] || SCHEDULE_FILL.anything;
    }

    _selectMode(mode) {
        if (!SCHEDULE_FILL[mode]) return;
        this._mode = mode;
        for (const btn of this._modeBtns || []) {
            btn._selected = btn._mode === mode;
            btn._paint?.();
        }
    }

    _beginDrag(row, hour) {
        this.scene.hideTooltip?.();
        if (!this._draft) this._draft = new Map();
        this._drag = { row, hour };
        this._paintAt(row, hour);
    }

    _paintAt(row, hour) {
        const rec = this._rows?.[row];
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!rec || !S?.paintSchedule || hour < 0 || hour > 23) return;
        const cur = this._draft.has(rec.pawnId)
            ? this._draft.get(rec.pawnId)
            : S.scheduleFor(this.settle, rec.pawnId);
        const next = S.paintSchedule(cur, hour, this._mode || "anything");
        this._draft.set(rec.pawnId, next);
        const mode = SCHEDULE_FROM_LETTER[next.charAt(hour)] || "anything";
        rec.cells[hour]?.bg?.setFillStyle(this._fill(mode), 1);
    }

    _paintLine(r0, h0, r1, h1) {
        const steps = Math.max(Math.abs(r1 - r0), Math.abs(h1 - h0));
        if (!(steps > 0)) {
            this._paintAt(r1, h1);
            return;
        }
        let pr = null;
        let ph = null;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const r = Math.round(r0 + (r1 - r0) * t);
            const h = Math.round(h0 + (h1 - h0) * t);
            if (r === pr && h === ph) continue;
            this._paintAt(r, h);
            pr = r;
            ph = h;
        }
    }

    _cellAtPointer(pointer, clampY) {
        const n = this._rows?.length || 0;
        if (!(n > 0) || !pointer) return null;
        const cellS = this._geom?.cellS || 1;
        const nameW = this._geom?.nameW || 0;
        const localX = pointer.x - this._bodyX;
        let localY = pointer.y - this._bodyY + this._scroll;
        if (clampY) {
            const x0 = this._bodyX;
            const x1 = x0 + (this._viewW || 0);
            if (pointer.x < x0 || pointer.x > x1) return null;
            const viewTop = this._scroll;
            const viewBot = this._scroll + Math.max(0, (this._viewH || 0) - 1);
            localY = Math.max(viewTop, Math.min(viewBot, localY));
        } else if (!this._pointerInBody(pointer)) {
            return null;
        }
        const row = Math.floor(localY / cellS);
        const hour = Math.floor((localX - nameW) / cellS);
        if (row < 0 || row >= n || hour < 0 || hour >= 24) return null;
        return { row, hour };
    }

    /** Keep painting the cell under the pointer after a scroll during a drag. */
    _extendDrag(pointer) {
        const drag = this._drag;
        if (!drag || !pointer) return;
        const cell = this._cellAtPointer(pointer, true);
        if (!cell || (cell.row === drag.row && cell.hour === drag.hour)) return;
        this._paintLine(drag.row, drag.hour, cell.row, cell.hour);
        drag.row = cell.row;
        drag.hour = cell.hour;
    }

    /** -1 above the list, 1 below it, 0 when the pointer is in the middle of the grid. */
    _dragScrollDir(pointer) {
        if (!pointer || this._maxScroll <= 0) return 0;
        const x0 = this._bodyX;
        const x1 = x0 + (this._viewW || 0);
        if (pointer.x < x0 || pointer.x > x1) return 0;
        const edge = Math.round(18 * (this.scene.uiScale || 1));
        const top = this._bodyY;
        const bot = top + (this._viewH || 0);
        if (pointer.y < top + edge) return -1;
        if (pointer.y > bot - edge) return 1;
        return 0;
    }

    /** Scroll while a paint drag is held at the top or bottom of the list. */
    _tickDragScroll() {
        if (!this.visible || !this._drag) return;
        const pointer = this.scene.input?.activePointer;
        const dir = this._dragScrollDir(pointer);
        if (!dir) {
            this._dragScrollAt = 0;
            return;
        }
        const now = this.scene.time?.now || 0;
        const prev = this._dragScrollAt || now;
        this._dragScrollAt = now;
        const dt = Math.min(50, Math.max(0, now - prev));
        if (!(dt > 0)) return;
        const before = this._scroll;
        const speed = 240 * (this.scene.uiScale || 1);
        this._setScroll(this._scroll + dir * speed * (dt / 1000));
        if (this._scroll !== before) this._extendDrag(pointer);
    }

    _onDragMove(pointer) {
        if (!this.visible || !this._drag || !pointer) return;
        this._extendDrag(pointer);
    }

    /** Persist a paint stroke. Returns true when a row changed. */
    _endDrag() {
        const draft = this._draft;
        const drag = this._drag;
        this._drag = null;
        this._draft = null;
        this._dragScrollAt = 0;
        if (!drag || !draft || !this.settle) return false;
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (!S?.setSchedule) return false;
        const settle = this.settle;
        let changed = false;
        for (const [pid, row] of draft) {
            if (row === S.scheduleFor(settle, pid)) continue;
            const saved = S.setSchedule(settle, pid, row);
            const pawn = (this._pawns || []).find((p) => (p.pawnId || p.id) === pid);
            if (pawn) S.rememberSchedule?.(pawn, saved);
            this.scene.settlementSys?.sendNet("setSchedule", {
                settlementId: settle.id,
                pawnId: pid,
                schedule: saved
            });
            changed = true;
        }
        if (changed) {
            this.scene.settlementSys?.bumpWorkCache?.();
            this._sig = null;
        }
        return changed;
    }

    _pointerInFrame(pointer) {
        if (!pointer || !this.visible) return false;
        const b = this.frame?.getBounds?.();
        return !!(b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y));
    }

    _pointerInBody(pointer) {
        if (!pointer || !this.visible) return false;
        return pointer.x >= this._bodyX && pointer.x <= this._bodyX + this._viewW
            && pointer.y >= this._bodyY && pointer.y <= this._bodyY + this._viewH;
    }

    _pointerStillOn(obj, pointer) {
        if (!obj || !pointer) return false;
        const b = obj.getBounds?.();
        return !!(b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y));
    }

    _clipHit(hitArea, x, y) {
        if (!Phaser.Geom.Rectangle.Contains(hitArea, x, y)) return false;
        return this._pointerInBody(this.scene.input.activePointer);
    }

    _clipInput(obj) {
        if (obj?.input) obj.input.hitAreaCallback = (area, x, y) => this._clipHit(area, x, y);
        return obj;
    }

    _underRoot(obj) {
        let cur = obj;
        while (cur) {
            if (cur === this.root || cur === this.body || cur === this.modes || cur === this.hourBar) return true;
            cur = cur.parentContainer;
        }
        return false;
    }

    hoverObjAt(pointer) {
        if (!pointer || !this.visible) return null;
        const visit = (obj) => {
            if (!obj?.active || obj === this.dim || obj === this.frame) return null;
            const kids = obj.list;
            if (Array.isArray(kids)) {
                for (let i = kids.length - 1; i >= 0; i--) {
                    const hit = visit(kids[i]);
                    if (hit) return hit;
                }
            }
            if (!obj.input?.enabled) return null;
            const b = obj.getBounds?.();
            if (!b || !Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y)) return null;
            if (this._underBody(obj) && !this._pointerInBody(pointer)) return null;
            return obj;
        };
        return visit(this.root);
    }

    _underBody(obj) {
        let cur = obj;
        while (cur) {
            if (cur === this.body) return true;
            cur = cur.parentContainer;
        }
        return false;
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer) return false;
        return pointer.x >= 0 && pointer.x <= this.scene.scale.width
            && pointer.y >= 0 && pointer.y <= this.scene.scale.height;
    }
}
