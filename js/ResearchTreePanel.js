/**
 * Fullscreen RimWorld-style research tree. Opened from the settlement Research tab.
 * Left pane inspects the selected project; the tree occupies the remaining width.
 */
class ResearchTreePanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.settle = null;
        this._panX = 0;
        this._panY = 0;
        this._zoom = 0.5;
        this._drag = null;
        this._keyPan = { left: false, right: false, up: false, down: false };
        this._contentW = 0;
        this._contentH = 0;
        this._viewX = 0;
        this._viewY = 0;
        this._viewW = 0;
        this._viewH = 0;
        this._detailX = 0;
        this._detailY = 0;
        this._detailW = 0;
        this._detailH = 0;
        this._nodes = [];
        this._detailHits = [];
        this._selectedId = null;
        this._pathIds = new Set();
        this._edgeDraw = [];
        this._sig = null;
        this._pauseWhileOpen = true;
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(16000).setVisible(false);
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
            .setStrokeStyle(2, 0x2a2218);
        this.detailBg = scene.add.rectangle(0, 0, 200, 600, 0x0e0c0a, 1)
            .setOrigin(0, 0)
            .setInteractive({ cursor: "default" });
        this.divider = scene.add.rectangle(0, 0, 2, 600, 0x2a2218, 1).setOrigin(0, 0);
        this.detailBody = scene.add.container(0, 0);
        this.pointsTxt = scene.add.text(0, 0, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "12px",
            color: "#8a7a62"
        }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
        this.pointsTxt.on("pointerover", (pointer) => {
            if (!this.visible) return;
            scene.showTooltip(() => this._pointsTip(), pointer.x, pointer.y, this.pointsTxt);
        });
        this.pointsTxt.on("pointerout", (pointer) => {
            if (this._pointerStillOn(this.pointsTxt, pointer)) return;
            if (scene._tooltipTarget === this.pointsTxt) scene.hideTooltip?.();
        });
        this.closeBtn = this._btn("Close", () => this.close());
        this.pauseBtn = this._checkBtn("Pause game", () => this._togglePause());
        this.researchBtn = this._btn("Research", () => this._spendSelected());
        this._researchDisabledReason = "";
        this.researchBtn._bg.on("pointerover", (pointer) => {
            const text = this._researchDisabledReason;
            if (!text || !this.visible) return;
            scene.showTooltip(() => this._researchDisabledReason || "", pointer.x, pointer.y, this.researchBtn._bg);
        });
        this.researchBtn._bg.on("pointerout", (pointer) => {
            if (this._pointerStillOn(this.researchBtn._bg, pointer)) return;
            if (scene._tooltipTarget === this.researchBtn._bg) scene.hideTooltip?.();
        });
        this.viewHit = scene.add.rectangle(0, 0, 100, 100, 0x0a0806, 1)
            .setOrigin(0, 0)
            .setInteractive({ cursor: "default" });
        this.world = scene.add.container(0, 0);
        this.lines = scene.add.graphics();
        this.world.add(this.lines);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.world.setMask(new Phaser.Display.Masks.BitmapMask(scene, this._maskGfx));
        this.root.add([
            this.dim, this.frame, this.viewHit, this.world,
            this.detailBg, this.divider, this.detailBody, this.researchBtn,
            this.pointsTxt, this.pauseBtn, this.closeBtn
        ]);
    }

    _btn(label, onClick) {
        const scene = this.scene;
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const bg = scene.add.rectangle(0, 0, 52, 22, BG, 1)
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
        c._selected = false;
        c._disabled = false;
        const strokeW = () => (typeof pixelUiStroke === "function"
            ? pixelUiStroke(scene.uiScale || 1) : 2);
        const paint = () => {
            const sw = strokeW();
            if (c._disabled) {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(sw, OUTLINE);
                txt.setColor("#6a5a4a");
            } else if (c._pressing) {
                bg.setFillStyle(BG_PRESS, 1);
                bg.setStrokeStyle(sw, OUTLINE_PRESS);
                txt.setColor("#d4c4a8");
            } else if (c._selected) {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(sw, OUTLINE_PRESS);
                txt.setColor("#d4c4a8");
            } else if (c._hovering) {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(sw, OUTLINE_HOVER);
                txt.setColor("#d4c4a8");
            } else {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(sw, OUTLINE);
                txt.setColor("#d4c4a8");
            }
        };
        c._paint = paint;
        c._setEnabled = (on) => {
            c._disabled = !on;
            if (!on) {
                c._hovering = false;
                c._pressing = false;
                if (bg.input) {
                    bg.input.cursor = "default";
                    bg.input.useHandCursor = false;
                }
            } else if (typeof ensurePointerInteractive === "function") {
                ensurePointerInteractive(bg);
            } else if (bg.input) {
                bg.input.cursor = "pointer";
                bg.input.useHandCursor = true;
            }
            paint();
        };
        bg.on("pointerover", () => {
            if (c._disabled) return;
            c._hovering = true;
            paint();
        });
        bg.on("pointerout", () => {
            c._hovering = false;
            c._pressing = false;
            paint();
        });
        bg.on("pointerdown", (p) => {
            if (c._disabled || (p?.button && p.button !== 0)) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (p) => {
            const was = c._pressing && !c._disabled;
            c._pressing = false;
            paint();
            if (was) onClick?.(p);
        });
        paint();
        return c;
    }

    _checkBtn(label, onClick) {
        const scene = this.scene;
        const w = 148;
        const h = 22;
        const bg = scene.add.rectangle(0, 0, w, h, 0x1e3d1a, 1)
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
        c._w = w;
        c._h = h;
        c._label = label;
        c._check = true;
        c._checked = true;
        c._hovering = false;
        c._pressing = false;
        const paint = () => {
            const s = scene.uiScale || 1;
            const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2;
            const colors = this._rowColors(c._checked ? "on" : "off");
            if (c._pressing) {
                bg.setFillStyle(colors.fill, 1);
                bg.setStrokeStyle(sw, 0xd4a84b);
            } else if (c._hovering) {
                bg.setFillStyle(colors.fill, 1);
                bg.setStrokeStyle(sw, 0xffffff);
            } else {
                bg.setFillStyle(colors.fill, 1);
                bg.setStrokeStyle(sw, colors.stroke);
            }
            txt.setColor(colors.text);
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
        if (!c?._check) return;
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

    _sizeCheckBtn(c, w, h) {
        if (!c) return;
        c._w = w;
        c._h = h;
        c._bg.setSize(w, h);
        if (c._bg.input?.hitArea?.setSize) c._bg.input.hitArea.setSize(w, h);
        else if (c._bg.input?.hitArea?.setTo) c._bg.input.hitArea.setTo(0, 0, w, h);
        const s = this.scene.uiScale || 1;
        if (c._txt && typeof applyPixelUiFont === "function") applyPixelUiFont(c._txt, 12, s);
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
            for (let i = 0; i <= 6; i++) {
                cross.push([i, i], [i, 6 - i]);
            }
            this._pixelGlyph(g, u, 0xc44c3c, cross);
        }
    }

    _rowColors(state) {
        if (state === "on") return { fill: 0x1e3d1a, stroke: 0x5cbf63, text: "#d4e8d0" };
        return { fill: 0x3a1816, stroke: 0xc44c3c, text: "#e8c0b8" };
    }

    _togglePause() {
        if (!this.scene._isSingleplayerSession?.()) return;
        this._pauseWhileOpen = !this._pauseWhileOpen;
        if (this.pauseBtn) {
            this.pauseBtn._checked = this._pauseWhileOpen;
            this.pauseBtn._paint?.();
        }
        this._syncResearchSimPause();
    }

    _syncResearchSimPause() {
        const scene = this.scene;
        const should = !!(
            this.visible
            && this._pauseWhileOpen
            && scene._isSingleplayerSession?.()
        );
        scene._setWorldSimFrozen?.(should);
    }

    _fitBtnHit(btn, w, h) {
        const bg = btn?._bg;
        if (!bg) return;
        bg.setSize(w, h);
        if (bg.input?.hitArea?.setSize) bg.input.hitArea.setSize(w, h);
        else if (bg.input?.hitArea?.setTo) bg.input.hitArea.setTo(0, 0, w, h);
    }

    _isPanButton(p) {
        return !p || p.button === 0 || p.button === 1 || !!(p.middleButtonDown?.());
    }

    _eventPoint(e) {
        const canvas = this.scene.game?.canvas;
        if (!canvas) return { x: e.clientX, y: e.clientY };
        const rect = canvas.getBoundingClientRect();
        const w = this.scene.scale.width || rect.width || 1;
        const h = this.scene.scale.height || rect.height || 1;
        return {
            x: (e.clientX - rect.left) * (w / (rect.width || 1)),
            y: (e.clientY - rect.top) * (h / (rect.height || 1))
        };
    }

    _startViewPan(p, opts) {
        if (!p || !this.visible) return false;
        if (!opts?.anywhere && !this._pointerInView(p)) return false;
        this._drag = {
            x: p.x,
            y: p.y,
            panX: this._panX,
            panY: this._panY,
            middle: !!opts?.middle
        };
        return true;
    }

    _bindMiddlePan() {
        const canvas = this.scene.game?.canvas;
        if (!canvas || canvas._researchMiddlePan) return;
        canvas._researchMiddlePan = true;
        const onDown = (e) => {
            if (!this.visible || e.button !== 1) return;
            e.preventDefault();
            const p = this._eventPoint(e);
            this._drag = { x: p.x, y: p.y, panX: this._panX, panY: this._panY, middle: true };
        };
        const onMove = (e) => {
            if (!this.visible || !this._drag?.middle) return;
            if (!((e.buttons || 0) & 4)) return;
            e.preventDefault();
            const p = this._eventPoint(e);
            this._panX = this._drag.panX + (p.x - this._drag.x);
            this._panY = this._drag.panY + (p.y - this._drag.y);
            this._applyPan();
        };
        const onUp = (e) => {
            if (e.button !== 1) return;
            if (this.visible) e.preventDefault();
            if (this._drag?.middle) this._drag = null;
        };
        const blockAutoscroll = (e) => {
            if (this.visible && e.button === 1) e.preventDefault();
        };
        canvas.addEventListener("mousedown", onDown, true);
        window.addEventListener("mousemove", onMove, true);
        window.addEventListener("mouseup", onUp, true);
        canvas.addEventListener("auxclick", blockAutoscroll, true);
    }

    _bindKeyPan() {
        if (this._keyPanBound) return;
        this._keyPanBound = true;
        this._keyPan = { left: false, right: false, up: false, down: false };
        const apply = (e, on) => {
            let hit = false;
            if (e.code === "KeyA" || e.code === "ArrowLeft") {
                this._keyPan.left = on;
                hit = true;
            }
            if (e.code === "KeyD" || e.code === "ArrowRight") {
                this._keyPan.right = on;
                hit = true;
            }
            if (e.code === "KeyW" || e.code === "ArrowUp") {
                this._keyPan.up = on;
                hit = true;
            }
            if (e.code === "KeyS" || e.code === "ArrowDown") {
                this._keyPan.down = on;
                hit = true;
            }
            return hit;
        };
        window.addEventListener("keydown", (e) => {
            if (!this.visible) return;
            if (this.scene.combatLog?.isComposing?.() || this.scene.settlementSys?.isNaming?.()) return;
            if (e.repeat && apply(e, true)) {
                e.preventDefault();
                return;
            }
            if (apply(e, true)) e.preventDefault();
        }, true);
        window.addEventListener("keyup", (e) => {
            apply(e, false);
        }, true);
        window.addEventListener("blur", () => {
            this._keyPan = { left: false, right: false, up: false, down: false };
        });
    }

    _bindInput() {
        const scene = this.scene;
        this._bindMiddlePan();
        this._bindKeyPan();
        this.viewHit.on("pointerdown", (p) => {
            if (!this.visible || !this._isPanButton(p)) return;
            this._startViewPan(p, { middle: p?.button === 1 });
        });
        scene.input.on("pointerdown", (p) => {
            if (!this.visible) return;
            if (p?.button === 1 || p?.middleButtonDown?.()) {
                this._startViewPan(p, { anywhere: true, middle: true });
                return;
            }
            if (p?.button && p.button !== 0) return;
            const b = this.frame?.getBounds?.();
            this._pressInside = !!(b && Phaser.Geom.Rectangle.Contains(b, p.x, p.y));
        });
        this.dim.on("pointerup", (p) => {
            if (!this.visible || (p?.button && p.button !== 0)) return;
            if (this._drag || this._pressInside) return;
            const b = this.frame.getBounds();
            if (b && !Phaser.Geom.Rectangle.Contains(b, p.x, p.y)) this.close();
        });
        const endDrag = (p) => {
            if (this._drag?.middle) return;
            this._drag = null;
            this._pressInside = false;
        };
        scene.input.on("pointerup", endDrag);
        scene.input.on("pointerupoutside", endDrag);
        scene.input.on("pointermove", (p) => {
            if (!this.visible) return;
            if (!this._drag || this._drag.middle) return;
            this._panX = this._drag.panX + (p.x - this._drag.x);
            this._panY = this._drag.panY + (p.y - this._drag.y);
            this._applyPan();
        });
        scene.input.on("wheel", (pointer, _over, _dx, dy) => {
            if (!this.visible) return;
            const p = pointer || scene.input.activePointer;
            if (!this._pointerInView(p)) return;
            const delta = Number(dy) || 0;
            if (!delta) return;
            const next = Phaser.Math.Clamp(this._zoom * Math.pow(1.0012, -delta), 0.25, 2.5);
            if (Math.abs(next - this._zoom) < 0.0001) return;
            this._zoomAt(next, p.x, p.y);
        });
    }

    _zoomAt(next, screenX, screenY) {
        const z0 = this._zoom || 1;
        const z1 = Math.max(0.25, Number(next) || z0);
        const wx = (screenX - this._viewX - this._panX) / z0;
        const wy = (screenY - this._viewY - this._panY) / z0;
        this._zoom = z1;
        this._panX = screenX - this._viewX - wx * z1;
        this._panY = screenY - this._viewY - wy * z1;
        this._applyPan();
    }

    _centerView() {
        const z = this._zoom || 1;
        this._panX = (this._viewW - this._contentW * z) / 2;
        this._panY = (this._viewH - this._contentH * z) / 2;
    }

    _clampPan() {
        const z = this._zoom || 1;
        const scaledW = this._contentW * z;
        const scaledH = this._contentH * z;
        if (scaledW <= this._viewW) this._panX = (this._viewW - scaledW) / 2;
        else this._panX = Math.min(0, Math.max(this._viewW - scaledW, this._panX));
        if (scaledH <= this._viewH) this._panY = (this._viewH - scaledH) / 2;
        else this._panY = Math.min(0, Math.max(this._viewH - scaledH, this._panY));
    }

    _applyPan() {
        this._clampPan();
        this.world.setScale(this._zoom || 1);
        this.world.setPosition(this._viewX + this._panX, this._viewY + this._panY);
    }

    _tickKeyPan() {
        if (!this.visible) return;
        if (this._drag && !this._drag.middle) {
            const p = this.scene.input?.activePointer;
            if (p?.isDown) return;
            this._drag = null;
        }
        if (this._drag?.middle) return;
        const scene = this.scene;
        if (scene.combatLog?.isComposing?.() || scene.settlementSys?.isNaming?.()) return;
        const held = this._keyPan || {};
        const cursors = scene.cursors;
        const keys = scene.keys;
        const left = !!(held.left || cursors?.left?.isDown || keys?.A?.isDown);
        const right = !!(held.right || cursors?.right?.isDown || keys?.D?.isDown);
        const up = !!(held.up || cursors?.up?.isDown || keys?.W?.isDown);
        const down = !!(held.down || cursors?.down?.isDown || keys?.S?.isDown);
        let dx = (left ? 1 : 0) - (right ? 1 : 0);
        let dy = (up ? 1 : 0) - (down ? 1 : 0);
        if (!dx && !dy) return;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const dt = Math.min(50, Number(scene.game?.loop?.delta) || 16) / 1000;
        const speed = 480 * (scene.uiScale || 1);
        this._panX += dx * speed * dt;
        this._panY += dy * speed * dt;
        this._applyPan();
    }

    _refreshMask() {
        this._maskGfx.clear();
        this._maskGfx.fillStyle(0xffffff, 1);
        this._maskGfx.fillRect(this._viewX, this._viewY, this._viewW, this._viewH);
    }

    _researchEntries() {
        return this.scene.settlementSys?.researchCircleEntries?.(this.settle) || [];
    }

    _points() {
        const R = typeof Research !== "undefined" ? Research : null;
        if (!R?.pointsBreakdown) return { paintings: 0, tokens: 0, books: 0, spent: 0, total: 0 };
        return R.pointsBreakdown(this._researchEntries(), { settle: this.settle });
    }

    open(settle) {
        if (!settle) return;
        this.settle = settle;
        this.visible = true;
        this._panX = 0;
        this._panY = 0;
        this._zoom = 0.5;
        this._sig = null;
        this._selectedId = null;
        this._pathIds = new Set();
        this.root.setVisible(true);
        const panel = this.scene.settlementPanel;
        if (panel?.root) panel.root.setVisible(false);
        this.layout();
        this.refresh();
        this._centerView();
        this._applyPan();
        this._syncResearchSimPause();
    }

    close(opts = {}) {
        const restore = opts.restore !== false;
        if (!this.visible && !this.root.visible) return;
        this.visible = false;
        this.settle = null;
        this._drag = null;
        this._sig = null;
        this._selectedId = null;
        this._pathIds = new Set();
        this.root.setVisible(false);
        this.scene.hideTooltip?.();
        this._syncResearchSimPause();
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

    _contentSig() {
        const pts = this._points();
        let techs = "";
        try { techs = JSON.stringify(this.settle?.techs || {}); } catch (_) { techs = ""; }
        const s = this.scene.uiScale || 1;
        const size = `${this.scene.scale.width}x${this.scene.scale.height}:${s}`;
        return `${this.settle?.id || ""}:${pts.total}:${techs}:${size}`;
    }

    refresh() {
        if (!this.visible || !this.settle) return;
        this._tickKeyPan();
        const sig = this._contentSig();
        if (sig === this._sig && this._nodes.length) {
            this._paintHeader();
            return;
        }
        this._sig = sig;
        this._rebuild();
    }

    _paintHeader() {
        const pts = this._points();
        const noun = pts.total === 1 ? "point" : "points";
        this.pointsTxt.setText(`${pts.total} research ${noun}`);
        if (this.pointsTxt.input?.hitArea?.setSize) {
            this.pointsTxt.input.hitArea.setSize(
                Math.max(this.pointsTxt.width, 1),
                Math.max(this.pointsTxt.height, 1)
            );
        }
    }

    _pointsTip() {
        const R = typeof Research !== "undefined" ? Research : null;
        const pts = this._points();
        const rows = [
            ...((R?.currencies && R.currencies()) || [
                { id: "paintings", name: "Paintings", icon: "painting_circle" },
                { id: "tokens", name: "Tokens", icon: "null" },
                { id: "books", name: "Books", icon: "null" }
            ]),
            { id: "spent", name: "Research", icon: R?.UI_SCIENCE_KEY || "science" }
        ];
        const paintingsKey = typeof ensurePaintingsUiIcon === "function"
            ? ensurePaintingsUiIcon(this.scene)
            : (R?.UI_ICON_KEY || "painting_circle");
        const scienceKey = R?.UI_SCIENCE_KEY || "science";
        const lines = rows.map((row) => {
            let icon = null;
            if (row.id === "paintings") {
                icon = (paintingsKey && this.scene.textures.exists(paintingsKey))
                    ? paintingsKey
                    : this._itemIconKey("painting_circle");
            } else if (row.id === "spent") {
                icon = this.scene.textures.exists(scienceKey) ? scienceKey : this._itemIconKey("null");
            } else {
                icon = this._itemIconKey(row.icon || "null");
            }
            const value = row.id === "spent"
                ? String(Math.max(0, Math.floor(Number(pts.spent) || 0)))
                : String(pts[row.id] ?? 0);
            return { icon, label: row.name, value, hangMinus: row.id === "spent" };
        });
        return { text: "", lines };
    }

    _select(techId) {
        if (!techId) return;
        this._selectedId = techId;
        this._syncPath();
        this.scene.hideTooltip?.();
        this._paintLines();
        this._paintAllNodes();
        this._fillDetail();
    }

    _syncPath() {
        this._pathIds = this._ancestorIds(this._selectedId);
    }

    _ancestorIds(techId) {
        const ids = new Set();
        const R = typeof Research !== "undefined" ? Research : null;
        const walk = (id) => {
            if (!id || ids.has(id)) return;
            ids.add(id);
            const t = R?.techById?.(id);
            for (const p of t?.prereqs || []) walk(p);
        };
        walk(techId);
        return ids;
    }

    _spendSelected() {
        const R = typeof Research !== "undefined" ? Research : null;
        const tech = R?.techById?.(this._selectedId);
        if (!tech) return;
        this.scene.settlementPanel?._tryUnlock?.(tech);
    }

    _rebuild() {
        const scene = this.scene;
        const R = typeof Research !== "undefined" ? Research : null;
        const s = scene.uiScale || 1;
        this._paintHeader();
        for (const n of this._nodes) {
            if (scene._tooltipTarget === n.bg) scene.hideTooltip?.();
            n.go?.destroy?.();
        }
        this._nodes = [];
        this._edgeDraw = [];
        this.lines.clear();
        if (!R?.treeLayout || !this.settle) {
            this._fillDetail();
            return;
        }
        R.ensureTechs(this.settle);
        const boxW = Math.round(164 * s);
        const boxH = Math.round(52 * s);
        const layout = R.treeLayout({
            boxW,
            boxH,
            colGap: Math.round(72 * s),
            rowGap: Math.round(18 * s),
            treeGap: Math.round(40 * s),
            pad: Math.round(16 * s)
        });
        this._contentW = layout.width;
        this._contentH = layout.height;
        const pts = this._points();
        const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2;
        const inset = Math.max(10, Math.round(20 * s));
        const laneGap = Math.max(4, Math.round(6 * s));
        const routed = R.layoutEdgePaths
            ? R.layoutEdgePaths(layout, { inset, laneGap, stroke: sw })
            : [];
        const byEdge = new Map();
        for (const r of routed) byEdge.set(`${r.from}->${r.to}`, r.path);
        this._edgeSw = Math.max(2, sw);
        for (const e of layout.edges) {
            const a = layout.byId[e.from];
            const b = layout.byId[e.to];
            if (!a || !b) continue;
            const path = byEdge.get(`${e.from}->${e.to}`)
                || (R.edgePath && R.edgePath(a, b, { inset, obstacles: layout.nodes, stroke: sw }))
                || [];
            if (!path.length) continue;
            this._edgeDraw.push({
                from: e.from,
                to: e.to,
                path,
                done: R.hasTech(this.settle, e.from)
            });
        }
        for (const node of layout.nodes) {
            const tech = node.tech;
            const unlocked = R.hasTech(this.settle, tech.id);
            const miss = R.missingPrereqs(this.settle, tech);
            const cost = Math.max(0, Math.floor(Number(tech.cost) || 0));
            const can = !unlocked && !miss.length && pts.total >= cost && cost > 0;
            const locked = !unlocked && miss.length;
            let fill = 0x16120e;
            let stroke = 0x3a2e26;
            let titleCol = "#6a5a4a";
            let subCol = "#4a3e36";
            if (unlocked) {
                fill = 0x1e3324;
                stroke = 0x6a9a70;
                titleCol = "#c4dcc8";
                subCol = "#8aaa90";
            } else if (can) {
                fill = 0x3a3220;
                stroke = 0xd4b060;
                titleCol = "#e8d4a0";
                subCol = "#c4a060";
            } else if (!locked) {
                fill = 0x2a2218;
                stroke = 0x8a7260;
                titleCol = "#d4c4a8";
                subCol = "#8a7a62";
            }
            const go = scene.add.container(node.x, node.y);
            const shape = this._eraShape(tech.era);
            const rec = {
                go,
                tech,
                w: node.w,
                h: node.h,
                shape,
                fill,
                statusStroke: stroke,
                sw,
                _hovering: false,
                _pressing: false
            };
            rec.bg = this._makeNodeBg(scene, rec);
            const cap = shape === "hex" ? this._hexCap(node.h, sw) : 0;
            const sidePad = shape === "oval"
                ? Math.round(14 * s)
                : Math.round(8 * s) + (shape === "hex" ? Math.round(cap * 0.55) : 0);
            const iconKey = this._techIconKey(tech);
            const iconMaxW = Math.round(24 * s);
            const iconMaxH = Math.max(iconMaxW, node.h - Math.round(10 * s));
            let icon = null;
            if (iconKey && scene.textures.exists(iconKey)) {
                icon = scene.add.image(0, node.h / 2, iconKey);
                if (typeof fitUiIcon === "function") fitUiIcon(icon, iconMaxW, iconMaxH);
                else icon.setDisplaySize(iconMaxW, iconMaxW);
            }
            const iconW = icon ? icon.displayWidth : 0;
            const textMaxW = Math.max(
                40,
                node.w - sidePad * 2 - (iconW ? iconW + Math.round(4 * s) : 0)
            );
            const name = scene.add.text(sidePad, 0, tech.name, {
                fontFamily: PIXEL_UI_FONT,
                fontSize: `${pixelUiFontSize(12, s)}px`,
                color: titleCol,
                wordWrap: { width: textMaxW }
            }).setOrigin(0, 0);
            const sub = (R.techCostLabel && R.techCostLabel(tech))
                || (cost > 0 ? `${cost} pt${cost === 1 ? "" : "s"}` : "Free");
            const subTxt = scene.add.text(sidePad, 0, sub, {
                fontFamily: PIXEL_UI_FONT,
                fontSize: `${pixelUiFontSize(10, s)}px`,
                color: subCol,
                wordWrap: { width: textMaxW }
            }).setOrigin(0, 0);
            if (typeof applyPixelUiFont === "function") {
                applyPixelUiFont(name, 12, s);
                applyPixelUiFont(subTxt, 10, s);
            }
            const lineGap = Math.max(0, Math.round(1 * s));
            const blockH = (name.height || 0) + lineGap + (subTxt.height || 0);
            const y0 = Math.round((node.h - blockH) / 2);
            name.setY(y0);
            subTxt.setY(y0 + (name.height || 0) + lineGap);
            const kids = [rec.bg, name, subTxt];
            if (icon) {
                icon.setX(node.w - sidePad - iconW / 2);
                kids.push(icon);
            }
            go.add(kids);
            rec.bg.on("pointerover", (pointer) => {
                if (!this._pointerInView(pointer)) return;
                rec._hovering = true;
                this._paintNode(rec);
            });
            rec.bg.on("pointerout", () => {
                rec._hovering = false;
                rec._pressing = false;
                this._paintNode(rec);
            });
            rec.bg.on("pointerdown", (pointer) => {
                if (pointer?.button === 1 || pointer?.middleButtonDown?.()) {
                    this._startViewPan(pointer, { anywhere: true, middle: true });
                    return;
                }
                if (pointer?.button && pointer.button !== 0) return;
                this._drag = null;
                rec._pressing = true;
                this._paintNode(rec);
            });
            rec.bg.on("pointerup", (pointer) => {
                const was = rec._pressing;
                rec._pressing = false;
                this._paintNode(rec);
                if (!was || !this._pointerInView(pointer)) return;
                this._select(tech.id);
            });
            this.world.add(go);
            this._nodes.push(rec);
        }
        this._syncPath();
        this._paintLines();
        this._paintAllNodes();
        this._applyPan();
        this._fillDetail();
    }

    _paintLines() {
        this.lines.clear();
        const sw = this._edgeSw || 2;
        const GOLD = 0xd4a84b;
        const pathIds = this._pathIds || new Set();
        const rest = [];
        const hi = [];
        for (const e of this._edgeDraw) {
            if (this._selectedId && pathIds.has(e.from) && pathIds.has(e.to)) hi.push(e);
            else rest.push(e);
        }
        const stroke = (e, color, width) => {
            if (!e.path?.length) return;
            this.lines.lineStyle(width, color, 1);
            this.lines.beginPath();
            this.lines.moveTo(e.path[0][0], e.path[0][1]);
            for (let i = 1; i < e.path.length; i++) this.lines.lineTo(e.path[i][0], e.path[i][1]);
            this.lines.strokePath();
        };
        for (const e of rest) stroke(e, e.done ? 0x6a9a70 : 0x3a2e26, sw);
        for (const e of hi) stroke(e, GOLD, sw);
    }

    _paintAllNodes() {
        for (const n of this._nodes) this._paintNode(n);
    }

    _paintNode(n) {
        if (!n?.bg) return;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        let stroke = n.statusStroke;
        if (n._pressing) stroke = OUTLINE_PRESS;
        else if (n.tech?.id === this._selectedId) stroke = OUTLINE_PRESS;
        else if (this._pathIds?.has(n.tech?.id)) stroke = OUTLINE_PRESS;
        else if (n._hovering) stroke = OUTLINE_HOVER;
        this._drawNodeBg(n.bg, n.w, n.h, n.shape, n.fill, stroke, n.sw);
    }

    _eraShape(era) {
        if (typeof Research !== "undefined" && Research.eraShape) return Research.eraShape(era);
        const key = String(era || "").toLowerCase();
        if (key === "paleolithic") return "oval";
        if (key === "neolithic") return "hex";
        return "rect";
    }

    _hexCap(h, sw) {
        if (typeof Research !== "undefined" && Research.hexCap) return Research.hexCap(h, sw);
        return Math.max(8, Math.round((h - (Number(sw) || 0)) * 0.3));
    }

    _hexPoints(w, h, sw) {
        const inset = (Number(sw) || 0) * 0.5;
        const cap = this._hexCap(h, sw);
        const x0 = inset;
        const y0 = inset;
        const x1 = w - inset;
        const y1 = h - inset;
        const midY = h * 0.5;
        return [
            { x: x0 + cap, y: y0 },
            { x: x1 - cap, y: y0 },
            { x: x1, y: midY },
            { x: x1 - cap, y: y1 },
            { x: x0 + cap, y: y1 },
            { x: x0, y: midY }
        ];
    }

    /** Stadium / pill: flat top and bottom, semicircle ends. */
    _pillRect(w, h, sw) {
        const inset = (Number(sw) || 0) * 0.5;
        const rw = Math.max(2, w - inset * 2);
        const rh = Math.max(2, h - inset * 2);
        return { x: inset, y: inset, w: rw, h: rh, radius: rh * 0.5 };
    }

    _pillContains(area, x, y) {
        const w = area.width;
        const h = area.height;
        const r = Math.min(area.radius, h * 0.5, w * 0.5);
        if (y < 0 || y > h || x < 0 || x > w) return false;
        if (x >= r && x <= w - r) return true;
        const cy = h * 0.5;
        const cx = x < r ? r : w - r;
        const dx = x - cx;
        const dy = y - cy;
        return dx * dx + dy * dy <= r * r;
    }

    _drawNodeBg(bg, w, h, shape, fill, stroke, sw) {
        if (shape === "rect") {
            bg.setFillStyle(fill, 1);
            bg.setStrokeStyle(sw, stroke);
            return;
        }
        bg.clear();
        bg.fillStyle(fill, 1);
        bg.lineStyle(sw, stroke, 1);
        if (shape === "oval") {
            const p = this._pillRect(w, h, sw);
            bg.fillRoundedRect(p.x, p.y, p.w, p.h, p.radius);
            bg.strokeRoundedRect(p.x, p.y, p.w, p.h, p.radius);
            return;
        }
        const pts = this._hexPoints(w, h, sw);
        bg.beginPath();
        bg.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) bg.lineTo(pts[i].x, pts[i].y);
        bg.closePath();
        bg.fillPath();
        bg.strokePath();
    }

    _makeNodeBg(scene, rec) {
        const { w, h, shape, fill, statusStroke, sw } = rec;
        if (shape === "rect") {
            const bg = scene.add.rectangle(0, 0, w, h, fill, 1)
                .setOrigin(0, 0)
                .setStrokeStyle(sw, statusStroke);
            if (typeof ensurePointerInteractive === "function") ensurePointerInteractive(bg);
            else bg.setInteractive({ useHandCursor: true });
            return bg;
        }
        const g = scene.add.graphics();
        if (typeof g.setSize === "function") g.setSize(w, h);
        else {
            g.width = w;
            g.height = h;
        }
        this._drawNodeBg(g, w, h, shape, fill, statusStroke, sw);
        let hit;
        let hitFn;
        if (shape === "oval") {
            hit = new Phaser.Geom.Rectangle(0, 0, w, h);
            hit.radius = h * 0.5;
            hitFn = (area, x, y) => this._pillContains(area, x, y);
        } else {
            hit = new Phaser.Geom.Polygon(this._hexPoints(w, h, sw));
            hitFn = Phaser.Geom.Polygon.Contains;
        }
        g.setInteractive({ hitArea: hit, hitAreaCallback: hitFn, useHandCursor: true, cursor: "pointer" });
        if (g.input) {
            g.input.cursor = "pointer";
            g.input.useHandCursor = true;
        }
        return g;
    }

    _clearDetail() {
        if ((this._detailHits || []).some((o) => this.scene._tooltipTarget === o)) {
            this.scene.hideTooltip?.();
        }
        this.detailBody.removeAll(true);
        this._detailHits = [];
    }

    _itemIconKey(itemId) {
        if (!itemId) return null;
        const def = this.scene.getItem?.(itemId)
            || this.scene.getThing?.(itemId)
            || { id: itemId, key: itemId };
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
        if (this.scene.textures.exists("null")) return "null";
        return null;
    }

    _techIconKey(tech) {
        const R = typeof Research !== "undefined" ? Research : null;
        if (tech?.icon) {
            const key = this._resolveTechIcon(tech.icon);
            if (key) return key;
        }
        for (const id of tech?.unlocks?.items || []) {
            const key = this._itemIconKey(id);
            if (key && key !== "null" && this.scene.textures.exists(key)) return key;
        }
        for (const id of tech?.unlocks?.bills || []) {
            const key = this._billStation(id)?.icon;
            if (key && key !== "null" && this.scene.textures.exists(key)) return key;
        }
        for (const t of tech?.unlocks?.text || []) {
            const thingId = R?.unlockTextIcon?.(t);
            if (!thingId) continue;
            const key = this._itemIconKey(thingId);
            if (key && key !== "null" && this.scene.textures.exists(key)) return key;
        }
        return null;
    }

    _resolveTechIcon(icon) {
        const id = String(icon || "");
        if (!id) return null;
        const R = typeof Research !== "undefined" ? Research : null;
        if (id === (R?.UI_TITLE_HAND_KEY || "title-hand") || id === "hand") {
            if (typeof ensureCultureHandIcon === "function") {
                const key = ensureCultureHandIcon(this.scene);
                if (key && this.scene.textures.exists(key)) return key;
            }
            if (this.scene.textures.exists(R?.UI_TITLE_HAND_KEY || "title-hand")) {
                return R?.UI_TITLE_HAND_KEY || "title-hand";
            }
        }
        const key = this._itemIconKey(id);
        if (key && key !== "null" && this.scene.textures.exists(key)) return key;
        if (this.scene.textures.exists(id)) return id;
        return null;
    }

    _itemName(id) {
        const def = this.scene.getItem?.(id) || this.scene.getThing?.(id);
        if (def?.name) return def.name;
        return String(id || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }

    _jobName(id) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        if (S?.JOB_NAMES?.[id]) return S.JOB_NAMES[id];
        if (S?.jobTooltip) {
            const tip = String(S.jobTooltip(id) || "");
            const line = tip.split("\n")[0];
            if (line) return line;
        }
        if (S?.jobLabel) {
            const lab = S.jobLabel(id);
            if (lab) return lab;
        }
        return this._itemName(id);
    }

    _billName(id) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const rec = S?.billRecipeById?.(id);
        if (rec && S.billRecipeTitle) return S.billRecipeTitle(rec);
        return this._itemName(id);
    }

    _billStation(id) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const kind = S?.billStationKindOf?.(id);
        const thingId = S?.billStationThingId?.(kind);
        if (!thingId) return null;
        const thing = this.scene.getThing?.(thingId);
        const name = thing?.name || this._itemName(thingId);
        const icon = this._itemIconKey(thingId);
        return { thingId, name, icon };
    }

    _billStationTip(id) {
        const st = this._billStation(id);
        if (!st) return null;
        const icon = st.icon && st.icon !== "null" ? st.icon : st.thingId;
        return () => ({
            lines: [{ icon, label: st.name }]
        });
    }

    _itemTip(id) {
        const def = this.scene.getItem?.(id);
        if (!def || typeof this.scene.formatItemTooltip !== "function") return null;
        return () => this.scene.formatItemTooltip(def, 1, null, { id, quantity: 1 });
    }

    _isUnlockWithoutIcon(label) {
        const R = typeof Research !== "undefined" ? Research : null;
        if (R?.isActionUnlock) return R.isActionUnlock(label);
        const s = String(label || "").trim();
        if (!s) return true;
        if (/knapping/i.test(s)) return true;
        if (/\bjob\b/i.test(s)) return true;
        return false;
    }

    _unlockRows(tech) {
        const rows = [];
        const R = typeof Research !== "undefined" ? Research : null;
        const missing = this.scene.textures.exists("null") ? "null" : null;
        for (const id of tech?.unlocks?.items || []) {
            if (!id) continue;
            rows.push({
                label: this._itemName(id),
                icon: this._itemIconKey(id) || missing,
                tip: this._itemTip(id)
            });
        }
        for (const id of tech?.unlocks?.jobs || []) {
            if (!id) continue;
            rows.push({ label: `Job: ${this._jobName(id)}`, icon: null });
        }
        for (const id of tech?.unlocks?.bills || []) {
            if (!id) continue;
            rows.push({
                label: `Bill: ${this._billName(id)}`,
                icon: null,
                tip: this._billStationTip(id)
            });
        }
        for (const t of tech?.unlocks?.text || []) {
            if (!t) continue;
            const label = String(t);
            const thingId = R?.unlockTextIcon?.(label);
            rows.push({
                label,
                icon: thingId
                    ? (this._itemIconKey(thingId) || missing)
                    : (this._isUnlockWithoutIcon(label) ? null : missing)
            });
        }
        return rows;
    }

    _addText(x, y, str, size, color, originX = 0, originY = 0, wrapW = 0) {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const txt = scene.add.text(x, y, str, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${typeof pixelUiFontSize === "function" ? pixelUiFontSize(size, s) : size}px`,
            color,
            wordWrap: wrapW > 0 ? { width: wrapW } : undefined
        }).setOrigin(originX, originY);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(txt, size, s);
        this.detailBody.add(txt);
        return txt;
    }

    _addListRow(x, y, w, h, label, iconKey, onClick, dim, tip, color) {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const clickable = typeof onClick === "function";
        const tipFn = typeof tip === "function" ? tip : null;
        const interactive = clickable || !!tipFn;
        const bg = scene.add.rectangle(x, y, w, h, 0x120e0a, clickable ? 1 : 0)
            .setOrigin(0, 0);
        if (interactive) {
            if (typeof ensurePointerInteractive === "function") ensurePointerInteractive(bg);
            else bg.setInteractive({ useHandCursor: true, cursor: "pointer" });
            if (clickable) {
                const rec = {
                    _bg: bg,
                    _hovering: false,
                    _pressing: false
                };
                const paint = () => {
                    const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2;
                    if (rec._pressing) bg.setStrokeStyle(sw, 0xd4a84b);
                    else if (rec._hovering) bg.setStrokeStyle(sw, 0xffffff);
                    else bg.setStrokeStyle(sw, 0x2a2218);
                };
                bg.on("pointerover", () => { rec._hovering = true; paint(); });
                bg.on("pointerout", () => { rec._hovering = false; rec._pressing = false; paint(); });
                bg.on("pointerdown", (p) => {
                    if (p?.button && p.button !== 0) return;
                    rec._pressing = true;
                    paint();
                });
                bg.on("pointerup", (p) => {
                    const was = rec._pressing;
                    rec._pressing = false;
                    paint();
                    if (was) onClick?.(p);
                });
                paint();
            }
            if (tipFn) {
                bg.on("pointerover", (pointer) => {
                    const text = tipFn();
                    if (text) scene.showTooltip(tipFn, pointer.x, pointer.y, bg);
                });
                bg.on("pointerout", (pointer) => {
                    if (this._pointerStillOn(bg, pointer)) return;
                    if (scene._tooltipTarget === bg) scene.hideTooltip?.();
                });
            }
            this._detailHits.push(bg);
        }
        this.detailBody.add(bg);
        const iconS = Math.round(14 * s);
        let textX = x + Math.round(6 * s);
        if (iconKey && scene.textures.exists(iconKey)) {
            const icon = scene.add.image(textX, y + h / 2, iconKey);
            if (typeof fitUiIcon === "function") fitUiIcon(icon, iconS, h);
            else icon.setDisplaySize(iconS, iconS);
            const iconW = icon.displayWidth || iconS;
            icon.setX(textX + iconW / 2);
            this.detailBody.add(icon);
            textX += iconW + Math.round(6 * s);
        }
        this._addText(
            textX,
            y + h / 2,
            label,
            12,
            color || (dim ? "#6a5a4a" : "#d4c4a8"),
            0,
            0.5,
            Math.max(20, w - (textX - x) - Math.round(6 * s))
        );
        return h;
    }

    _fillDetail() {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const R = typeof Research !== "undefined" ? Research : null;
        this._clearDetail();
        const pad = Math.round(12 * s);
        const wrapW = Math.max(40, this._detailW - pad * 2);
        const innerX = this._detailX + pad;
        const topY = this._detailY + pad;
        const tech = R?.techById?.(this._selectedId);
        const btnH = Math.round(28 * s);
        const btnW = Math.max(40, this._detailW - pad * 2);
        const btnY = this._detailY + this._detailH - pad - btnH / 2;
        this.researchBtn.setPosition(this._detailX + this._detailW / 2, btnY);
        this._fitBtnHit(this.researchBtn, btnW, btnH);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.researchBtn._txt, 14, s);

        if (!tech) {
            this.researchBtn.setVisible(false);
            this._researchDisabledReason = "";
            if (scene._tooltipTarget === this.researchBtn._bg) scene.hideTooltip?.();
            this._addText(
                this._detailX + this._detailW / 2,
                this._detailY + this._detailH / 2,
                "Select a research",
                12,
                "#6a5a4a",
                0.5,
                0.5,
                wrapW
            );
            return;
        }

        this.researchBtn.setVisible(true);
        const unlocked = !!(R.hasTech && R.hasTech(this.settle, tech.id));
        const pts = this._points();
        const can = !!(R.canUnlock && R.canUnlock(this.settle, tech.id, pts.total));
        const cost = Math.max(0, Math.floor(Number(tech.cost) || 0));
        if (unlocked) this.researchBtn._txt.setText("Researched");
        else this.researchBtn._txt.setText(cost > 0 ? `Research  ${cost}` : "Research");
        this.researchBtn._setEnabled(can);
        this._researchDisabledReason = (R.unlockBlockedReason
            && R.unlockBlockedReason(this.settle, tech.id, pts.total)) || "";
        if (this._researchDisabledReason && this.researchBtn._bg.input) {
            this.researchBtn._bg.input.cursor = "pointer";
            this.researchBtn._bg.input.useHandCursor = true;
        }
        if (!this._researchDisabledReason && scene._tooltipTarget === this.researchBtn._bg) {
            scene.hideTooltip?.();
        }

        let y = topY;
        const name = this._addText(innerX, y, tech.name, 16, "#e8dcc8", 0, 0, wrapW);
        y += Math.round(name.height + 6 * s);
        if (tech.quote) {
            const quote = this._addText(innerX, y, `'${tech.quote}'`, 12, "#8a7a62", 0, 0, wrapW);
            y += Math.round(quote.height + 6 * s);
        }
        if (tech.era) {
            const era = this._addText(innerX, y, tech.era, 11, "#6a5a4a");
            y += Math.round(era.height + 14 * s);
        }

        const unlocks = this._unlockRows(tech);
        const rowH = Math.round(22 * s);
        const rowGap = Math.max(4, Math.round(4 * s));
        if (unlocks.length) {
            const uh = this._addText(innerX, y, "Unlocks", 10, "#8a7a62");
            y += Math.round(uh.height + 6 * s);
            for (const row of unlocks) {
                this._addListRow(innerX, y, wrapW, rowH, row.label, row.icon, null, false, row.tip);
                y += rowH;
            }
            y += Math.round(10 * s);
        }

        const prereqs = (tech.prereqs || []).map((id) => R.techById?.(id)).filter(Boolean);
        const prereqBlock = prereqs.length
            ? Math.round(16 * s) + prereqs.length * rowH + Math.max(0, prereqs.length - 1) * rowGap
            : 0;
        const prereqY = Math.max(
            y,
            this._detailY + this._detailH - pad - btnH - Math.round(12 * s) - prereqBlock
        );
        y = prereqY;
        if (prereqs.length) {
            const ph = this._addText(innerX, y, "Prerequisites", 10, "#8a7a62");
            y += Math.round(ph.height + 6 * s);
            for (const pre of prereqs) {
                const have = !!(R.hasTech && R.hasTech(this.settle, pre.id));
                this._addListRow(
                    innerX,
                    y,
                    wrapW,
                    rowH,
                    pre.name,
                    this._techIconKey(pre),
                    () => this._select(pre.id),
                    false,
                    null,
                    have ? "#7dba6a" : "#e07070"
                );
                y += rowH + rowGap;
            }
        }
    }

    _pointerStillOn(obj, pointer) {
        if (!obj || !pointer) return false;
        const b = obj.getBounds?.();
        return !!(b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y));
    }

    /** Hit-test using the object's Phaser hit area (needed for pill/hex Graphics). */
    _pointerOnInteractive(obj, pointer) {
        if (!obj || !pointer || !obj.active) return false;
        const input = obj.input;
        if (input && input.enabled !== false && input.hitArea && typeof input.hitAreaCallback === "function") {
            const mat = typeof obj.getWorldTransformMatrix === "function"
                ? obj.getWorldTransformMatrix()
                : null;
            if (mat && typeof mat.applyInverse === "function") {
                const local = mat.applyInverse(pointer.x, pointer.y);
                const px = (local?.x || 0) + (Number(obj.displayOriginX) || 0);
                const py = (local?.y || 0) + (Number(obj.displayOriginY) || 0);
                try {
                    if (input.hitAreaCallback(input.hitArea, px, py, obj)) return true;
                } catch (_) { /* fall through */ }
            }
        }
        return this._pointerStillOn(obj, pointer);
    }

    _pointerInView(pointer) {
        if (!pointer || !this.visible) return false;
        return pointer.x >= this._viewX && pointer.x <= this._viewX + this._viewW
            && pointer.y >= this._viewY && pointer.y <= this._viewY + this._viewH;
    }

    _pointerInDetail(pointer) {
        if (!pointer || !this.visible) return false;
        return pointer.x >= this._detailX && pointer.x <= this._detailX + this._detailW
            && pointer.y >= this._detailY && pointer.y <= this._detailY + this._detailH;
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
        const detailW = Math.max(120, Math.round(frameW * 0.25));
        this._detailX = pad;
        this._detailY = pad;
        this._detailW = detailW;
        this._detailH = frameH;
        this.detailBg.setPosition(this._detailX, this._detailY).setSize(detailW, frameH);
        if (this.detailBg.input?.hitArea?.setSize) {
            this.detailBg.input.hitArea.setSize(detailW, frameH);
        }
        const divW = Math.max(1, Math.round(2 * s));
        this.divider.setPosition(pad + detailW, pad).setSize(divW, frameH);
        const headerY = pad + Math.round(18 * s);
        const closeW = Math.round(52 * s);
        const closeH = Math.round(22 * s);
        this.closeBtn.setPosition(pad + frameW - Math.round(40 * s), headerY);
        this._fitBtnHit(this.closeBtn, closeW, closeH);
        const sp = !!scene._isSingleplayerSession?.();
        if (this.pauseBtn) {
            this.pauseBtn.setVisible(sp);
            this.pauseBtn._checked = !!this._pauseWhileOpen;
            if (typeof applyPixelUiFont === "function") {
                applyPixelUiFont(this.pauseBtn._txt, 12, s);
            }
            const padX = Math.round(8 * s);
            const glyphW = Math.round(14 * s);
            const textW = Math.ceil(this.pauseBtn._txt?.width || 70);
            const pauseW = padX + textW + Math.round(4 * s) + glyphW + padX;
            const pauseH = closeH;
            const gap = Math.round(8 * s);
            this.pauseBtn.setPosition(
                this.closeBtn.x - closeW / 2 - gap - pauseW / 2,
                headerY
            );
            this._sizeCheckBtn(this.pauseBtn, pauseW, pauseH);
        }
        this.pointsTxt.setPosition(pad + detailW + Math.round(14 * s), headerY);
        const innerPad = Math.round(12 * s);
        const btnH = Math.round(28 * s);
        const btnW = Math.max(40, this._detailW - innerPad * 2);
        this.researchBtn.setPosition(
            this._detailX + this._detailW / 2,
            this._detailY + this._detailH - innerPad - btnH / 2
        );
        this._fitBtnHit(this.researchBtn, btnW, btnH);
        if (typeof applyPixelUiFont === "function") {
            applyPixelUiFont(this.pointsTxt, 12, s);
            applyPixelUiFont(this.closeBtn._txt, 12, s);
            applyPixelUiFont(this.researchBtn._txt, 14, s);
        }
        const inset = Math.round(8 * s);
        this._viewX = pad + detailW + divW + inset;
        this._viewY = pad + Math.round(36 * s);
        this._viewW = Math.max(40, pad + frameW - inset - this._viewX);
        this._viewH = Math.max(40, pad + frameH - inset - this._viewY);
        this.viewHit.setPosition(this._viewX, this._viewY).setSize(this._viewW, this._viewH);
        if (this.viewHit.input?.hitArea?.setSize) {
            this.viewHit.input.hitArea.setSize(this._viewW, this._viewH);
        }
        this._refreshMask();
        this._applyPan();
        if (this.visible) this.refresh();
    }

    hoverObjAt(pointer) {
        if (!pointer || !this.visible) return null;
        if (this._pointerStillOn(this.pointsTxt, pointer)) return this.pointsTxt;
        if (this.pauseBtn?.visible && this.pauseBtn._bg && this._pointerStillOn(this.pauseBtn._bg, pointer)) {
            return this.pauseBtn._bg;
        }
        if (this.closeBtn && this._pointerStillOn(this.closeBtn._bg, pointer)) return this.closeBtn._bg;
        if (this.researchBtn?.visible && this._pointerStillOn(this.researchBtn._bg, pointer)) {
            return this.researchBtn._bg;
        }
        for (let i = (this._detailHits || []).length - 1; i >= 0; i--) {
            const obj = this._detailHits[i];
            if (obj?.active && this._pointerOnInteractive(obj, pointer)) return obj;
        }
        if (this._pointerInDetail(pointer)) return this.detailBg;
        if (!this._pointerInView(pointer)) return null;
        for (let i = this._nodes.length - 1; i >= 0; i--) {
            const bg = this._nodes[i].bg;
            if (bg?.active && this._pointerOnInteractive(bg, pointer)) return bg;
        }
        return this.viewHit;
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer) return false;
        return pointer.x >= 0 && pointer.x <= this.scene.scale.width
            && pointer.y >= 0 && pointer.y <= this.scene.scale.height;
    }
}
