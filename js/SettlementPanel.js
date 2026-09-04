/**
 * Settlement overlay: people, jobs, stock, destroy.
 */
class SettlementPanel {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this.settle = null;
        this.tab = "people";
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(15100).setVisible(false);
        scene.uiLayer?.add(this.root);
        this._rows = [];
        this._stockRows = [];
        this._scroll = 0;
        this._contentH = 0;
        this._viewW = 0;
        this._viewH = 0;
        this._maxScroll = 0;
        this._bodyX = 10;
        this._bodyY = 62;
        this._scrollDrag = null;
        this._build();
        this._bindScroll();
    }

    _build() {
        const scene = this.scene;
        this.bg = scene.add.rectangle(0, 0, 280, 220, 0x120e0a, 0.94)
            .setStrokeStyle(2, 0x2a2218)
            .setOrigin(0, 0)
            .setInteractive({ cursor: "default" });
        this.title = scene.add.text(0, 0, "Camp", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
        this.title.on("pointerdown", () => {
            if (!this.settle) return;
            const current = this.settle.name || "Camp";
            scene.settlementSys?._showNamePrompt?.((name) => {
                scene.settlementSys.rename(this.settle, name);
            }, { placeholder: current });
        });
        this.destroyBtn = this._btn(0, 0, "Destroy", () => {
            if (this.settle) scene.settlementSys?.promptDestroy(this.settle);
        });
        this.closeBtn = this._btn(0, 0, "Close", () => scene.settlementSys?.closePanel());
        this.tabPeople = this._btn(0, 0, "People", () => this._setTab("people"));
        this.tabJobs = this._btn(0, 0, "Jobs", () => this._setTab("jobs"));
        this.tabStock = this._btn(0, 0, "Stock", () => this._setTab("stock"));
        this.body = scene.add.container(10, 64);
        this._maskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.body.setMask(this._maskGfx.createGeometryMask());
        this.scrollTrack = scene.add.rectangle(0, 0, 5, 100, 0x3a2e26, 1).setOrigin(0, 0).setVisible(false);
        this.scrollThumb = scene.add.rectangle(0, 0, 5, 20, 0x8a7260, 1).setOrigin(0, 0).setVisible(false);
        this.root.add([
            this.bg, this.title, this.destroyBtn, this.closeBtn,
            this.tabPeople, this.tabJobs, this.tabStock, this.body,
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
            if (!this._pointerInBody(p)) return;
            const step = Math.round(22 * (scene.uiScale || 1));
            this._setScroll(this._scroll + (dy > 0 ? step : -step));
        });
    }

    _pointerInBody(pointer) {
        if (!pointer || !this.visible) return false;
        const x = this.root.x + this._bodyX;
        const y = this.root.y + this._bodyY;
        return pointer.x >= x && pointer.x <= x + this._viewW
            && pointer.y >= y && pointer.y <= y + this._viewH;
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

    _btn(x, y, label, onClick, clip = false) {
        const scene = this.scene;
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const bg = scene.add.rectangle(0, 0, 64, 22, BG, 1)
            .setInteractive({ useHandCursor: true });
        const txt = scene.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "14px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        const c = scene.add.container(x, y, [bg, txt]);
        c._bg = bg;
        c._txt = txt;
        c._label = label;
        c._clip = !!clip;
        c._hovering = false;
        c._pressing = false;
        c._selected = false;
        const strokeW = () => (typeof pixelUiStroke === "function"
            ? pixelUiStroke(scene.uiScale || 1) : 2);
        const inClip = (pointer) => !c._clip || this._pointerInBody(pointer);
        const paint = () => {
            const sw = strokeW();
            if (c._pressing) {
                bg.setFillStyle(BG_PRESS, 1);
                bg.setStrokeStyle(sw, OUTLINE_PRESS);
            } else if (c._selected) {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(sw, OUTLINE_PRESS);
            } else if (c._hovering) {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(sw, OUTLINE_HOVER);
            } else {
                bg.setFillStyle(BG, 1);
                bg.setStrokeStyle(sw, OUTLINE);
            }
        };
        c._paint = paint;
        bg.on("pointerover", (pointer) => {
            if (!inClip(pointer)) return;
            c._hovering = true;
            paint();
        });
        bg.on("pointerout", () => {
            c._hovering = false;
            c._pressing = false;
            paint();
        });
        bg.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const ev = pointer?.event || event;
            const ctrlRight = !!(c._ctrlClick && pointer.rightButtonDown() && ev?.ctrlKey);
            if ((pointer.rightButtonDown() && !ctrlRight) || !inClip(pointer)) return;
            c._pressing = true;
            paint();
        });
        bg.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = c._pressing && c._hovering && inClip(pointer);
            c._pressing = false;
            paint();
            if (was) onClick?.(pointer);
        });
        paint();
        return c;
    }

    _fitBtnHit(btn, w, h) {
        const bg = btn?._bg;
        if (!bg) return;
        bg.setSize(w, h);
        if (bg.input?.hitArea?.setSize) bg.input.hitArea.setSize(w, h);
        else if (bg.input?.hitArea?.setTo) bg.input.hitArea.setTo(0, 0, w, h);
    }

    _syncTabs() {
        const set = (btn, on) => {
            if (!btn) return;
            btn._selected = on;
            btn._paint?.();
        };
        set(this.tabPeople, this.tab === "people");
        set(this.tabJobs, this.tab === "jobs");
        set(this.tabStock, this.tab === "stock");
    }

    _setTab(tab) {
        this.tab = tab;
        this._scroll = 0;
        this._syncTabs();
        this.refresh();
    }

    open(settle) {
        this.settle = settle;
        this.visible = true;
        this._scroll = 0;
        this.root.setVisible(true);
        this.layout();
        this._syncTabs();
    }

    close() {
        this.visible = false;
        this.settle = null;
        this.root.setVisible(false);
        this.scrollTrack.setVisible(false);
        this.scrollThumb.setVisible(false);
        this.scene.settlementSys?._drawRange?.(null, false);
    }

    layout() {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const w = Math.round(300 * s);
        const h = Math.round(260 * s);
        this.bg.setSize(w, h);
        if (this.bg.input?.hitArea?.setSize) {
            this.bg.input.hitArea.setSize(this.bg.width, this.bg.height);
        } else if (this.bg.input?.hitArea?.setTo) {
            this.bg.input.hitArea.setTo(0, 0, this.bg.width, this.bg.height);
        }
        this.root.setPosition(Math.round(16 * s), Math.round((scene.scale.height - h) / 2));
        if (typeof applyPixelUiFont === "function") {
            applyPixelUiFont(this.title, 16, s);
            applyPixelUiFont(this.destroyBtn._txt, 12, s);
            applyPixelUiFont(this.closeBtn._txt, 12, s);
            applyPixelUiFont(this.tabPeople._txt, 12, s);
            applyPixelUiFont(this.tabJobs._txt, 12, s);
            applyPixelUiFont(this.tabStock._txt, 12, s);
        }
        const headerY = Math.round(18 * s);
        this.title.setPosition(Math.round(12 * s), headerY);
        this.destroyBtn.setPosition(w - 110 * s, headerY);
        this.closeBtn.setPosition(w - 40 * s, headerY);
        this.tabPeople.setPosition(40 * s, 44 * s);
        this.tabJobs.setPosition(110 * s, 44 * s);
        this.tabStock.setPosition(180 * s, 44 * s);
        this._bodyX = Math.round(10 * s);
        this._bodyY = Math.round(62 * s);
        this._viewW = w - this._bodyX - Math.round(8 * s);
        this._viewH = h - this._bodyY - Math.round(8 * s);
        this.body.setPosition(this._bodyX, this._bodyY);
        this.destroyBtn._bg.setSize(64 * s, 22 * s);
        this.closeBtn._bg.setSize(52 * s, 22 * s);
        this.tabPeople._bg.setSize(68 * s, 22 * s);
        this.tabJobs._bg.setSize(56 * s, 22 * s);
        this.tabStock._bg.setSize(60 * s, 22 * s);
        const sw = typeof pixelUiStroke === "function" ? pixelUiStroke(s) : 2;
        this.bg.setStrokeStyle(sw, 0x2a2218);
        this.destroyBtn._paint?.();
        this.closeBtn._paint?.();
        this._syncTabs();
        if (this.visible && this.settle) this.refresh();
        else {
            this._maxScroll = Math.max(0, this._contentH - this._viewH);
            this._refreshMask();
            this._setScroll(this._scroll);
        }
    }

    _clearBody() {
        const tip = this.scene._tooltipTarget;
        if (tip && (tip.parentContainer === this.body || tip === this.body)) {
            this.scene.hideTooltip?.();
        }
        this.body.removeAll(true);
        this._rows = [];
        this._stockRows = [];
    }

    refresh() {
        if (!this.visible || !this.settle) return;
        const scene = this.scene;
        const s = scene.uiScale || 1;
        this.title.setText(this.settle.name || "Camp");
        this._clearBody();
        let contentH = 0;
        if (this.tab === "jobs") contentH = this._fillJobs(s);
        else if (this.tab === "stock") contentH = this._fillStock(s);
        else contentH = this._fillPeople(s);
        this._contentH = Math.max(contentH, 1);
        this._maxScroll = Math.max(0, this._contentH - this._viewH);
        this._setScroll(Math.min(this._scroll, this._maxScroll));
        this._refreshMask();
        this._syncTabs();
    }

    _label(text, x, y, size = 12, wrapW = 0) {
        const t = this.scene.add.text(x, y, text, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(size, this.scene.uiScale || 1)}px`,
            color: "#d4c4a8",
            wordWrap: wrapW > 0 ? { width: wrapW } : undefined
        });
        this.body.add(t);
        return t;
    }

    _rowLabel(text, x, y, rowH, size = 12) {
        const t = this._label(text, x, y + rowH / 2, size);
        t.setOrigin(0, 0.5);
        return t;
    }

    _peopleDivider(y, w, sc) {
        const g = this.scene.add.graphics();
        const stroke = Math.max(1, Math.round(sc));
        g.lineStyle(stroke, 0x6a5a4a, 1);
        g.lineBetween(0, 0, w, 0);
        g.setPosition(0, Math.round(y));
        this.body.add(g);
        return stroke;
    }

    _fillPeople(sc) {
        const scene = this.scene;
        const sys = scene.settlementSys;
        const party = (scene.party || []).filter((p) => p && !p.isBodyDead?.());
        const here = sys.settlersOf(this.settle.id);
        const barW = Math.max(4, Math.round(5 * sc));
        const innerW = Math.max(120, Math.round(this._viewW - barW - 4 * sc));
        const gap = Math.round(6 * sc);
        const colW = Math.max(80, Math.floor((innerW - gap) / 2));
        const rowH = Math.round(24 * sc);
        let y = 0;
        this._rowLabel("Party", 0, y, rowH, 12);
        y += rowH;
        y = this._fillPeopleGrid(party, y, colW, gap, rowH, sc, "party");
        y += Math.round(8 * sc);
        this._peopleDivider(y, innerW, sc);
        this._rowLabel("Here", 0, y, rowH, 12);
        y += rowH;
        if (!here.length) {
            this._rowLabel("(none)", Math.round(8 * sc), y, rowH, 12);
            y += rowH;
        } else {
            y = this._fillPeopleGrid(here, y, colW, gap, rowH, sc, "here");
        }
        return y + 8 * sc;
    }

    _fillPeopleGrid(list, y0, colW, gap, rowH, sc, kind) {
        const scene = this.scene;
        const sys = scene.settlementSys;
        const P = typeof Party !== "undefined" ? Party : { CAP: 6 };
        const others = kind === "here"
            ? sys.owned().filter((s) => s.id !== this.settle.id)
            : [];
        const partyFull = (scene.party?.length || 0) >= (P.CAP || 6);
        const btnW = Math.round(40 * sc);
        const btnH = Math.round(20 * sc);
        const btnGap = Math.round(4 * sc);
        let y = y0;
        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            const col = i % 2;
            if (col === 0 && i > 0) y += rowH;
            const x = col * (colW + gap);
            const name = p.displayName?.() || p.pawnName || "?";
            const isLeader = p === scene.leader;
            const showSend = kind === "here" && others[0];
            const showDrop = kind === "party" && !isLeader;
            const showTake = kind === "here";
            let btns = 0;
            if (showDrop || showTake) btns += 1;
            if (showSend) btns += 1;
            const btnsW = btns ? btns * btnW + Math.max(0, btns - 1) * btnGap : 0;
            const crownW = (isLeader && kind === "party") ? Math.round(12 * sc) : 0;
            const nameMax = Math.max(24, colW - btnsW - crownW - Math.round(6 * sc));
            const label = this._rowLabel(name, x, y, rowH, 12);
            if (label.width > nameMax) {
                let cut = name;
                while (cut.length > 1 && label.width > nameMax) {
                    cut = cut.slice(0, -1);
                    label.setText(`${cut}…`);
                }
            }
            if (isLeader && kind === "party" && scene.textures?.exists("leader")) {
                const crown = scene.add.image(
                    x + Math.min(label.width, nameMax) + Math.round(3 * sc),
                    y + rowH / 2,
                    "leader"
                ).setOrigin(0, 0.5).setScale(sc);
                this.body.add(crown);
            }
            const hitW = Math.max(8, colW - btnsW);
            const hit = scene.add.zone(x, y, hitW, rowH).setOrigin(0, 0);
            hit.setInteractive({ cursor: "default" });
            hit.on("pointerover", (pointer) => {
                if (!this._pointerInBody(pointer)) return;
                scene.showTooltip(() => this._personActionTip(p), pointer.x, pointer.y, hit);
            });
            hit.on("pointerout", () => {
                if (scene._tooltipTarget === hit) scene.hideTooltip?.();
            });
            this.body.add(hit);
            let bx = x + colW - btnW / 2;
            const by = y + rowH / 2;
            const addBtn = (text, fn, dim) => {
                const b = this._btn(bx, by, text, fn, true);
                b._bg.setSize(btnW, btnH);
                if (b._bg.input?.hitArea?.setSize) b._bg.input.hitArea.setSize(btnW, btnH);
                if (typeof applyPixelUiFont === "function") applyPixelUiFont(b._txt, 10, sc);
                if (dim) b.setAlpha(0.4);
                b._paint?.();
                this.body.add(b);
                bx -= btnW + btnGap;
                return b;
            };
            if (showSend) addBtn("Send", () => sys.transfer(p, others[0]));
            if (showDrop) addBtn("Drop", () => sys.dropOff(p, this.settle));
            if (showTake) addBtn("Take", () => sys.pickUp(p, this.settle), partyFull);
        }
        if (list.length) y += rowH;
        return y;
    }

    _personActionTip(p) {
        if (!p || p.isBodyDead?.()) return "";
        const controlled = !!(p.isControlled?.() || p === this.scene.player);
        let text = "";
        if (!controlled) {
            text = this.scene.partySys?.activityTooltip?.(p) || "";
            if (!text) {
                if (p.partyAI?.assistTarget && !p.partyAI.assistTarget.isBodyDead?.()) text = "Fighting";
                else text = "Idle";
            }
        }
        const rows = this.scene.partySys?.heldTooltipRows?.(p);
        if (rows?.length) return { text, rows };
        return text;
    }

    _fillJobs(sc) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const jobs = S?.JOBS || ["doctor", "cook", "chop", "leather", "gather", "haul"];
        const here = this.scene.settlementSys.settlersOf(this.settle.id);
        if (!here.length) {
            this._label("Drop people off to assign jobs.", 0, 0, 12);
            return 24 * sc;
        }

        const scene = this.scene;
        const nJobs = jobs.length;
        const barW = Math.max(4, Math.round(5 * sc));
        const tableW = Math.max(120, Math.round(this._viewW - barW - 4 * sc));
        const nameW = Math.round(58 * sc);
        const cellW = Math.max(18, Math.floor((tableW - nameW) / nJobs));
        const gridW = nameW + cellW * nJobs;
        const headerH = Math.round(18 * sc);
        const rowH = Math.round(22 * sc);
        const stroke = Math.max(1, Math.round(sc));
        const line = 0x2a2218;
        const headerBg = 0x1a1510;
        const cellBg = 0x120e0a;
        const cellHover = 0x2a2218;
        const cellPress = 0x0a0806;

        const headerFill = scene.add.rectangle(0, 0, gridW, headerH, headerBg, 1).setOrigin(0, 0);
        this.body.add(headerFill);

        for (let i = 0; i < nJobs; i++) {
            const j = jobs[i];
            const hx = nameW + i * cellW + cellW / 2;
            const hit = scene.add.rectangle(nameW + i * cellW, 0, cellW, headerH, headerBg, 1)
                .setOrigin(0, 0)
                .setInteractive({ cursor: "default" });
            hit.on("pointerover", (pointer) => {
                if (!this._pointerInBody(pointer)) return;
                const text = S?.jobTooltip ? S.jobTooltip(j) : j;
                scene.showTooltip(() => text, pointer.x, pointer.y, hit);
            });
            hit.on("pointerout", () => {
                if (scene._tooltipTarget === hit) scene.hideTooltip?.();
            });
            this.body.add(hit);
            const ht = this._label(S?.jobLabel?.(j) || j, hx, headerH / 2, 10);
            ht.setOrigin(0.5, 0.5);
        }

        for (let r = 0; r < here.length; r++) {
            const p = here[r];
            const rowY = headerH + r * rowH;
            const name = (p.displayName?.() || "?").slice(0, 8);
            const nt = this._label(name, Math.round(4 * sc), rowY + rowH / 2, 11);
            nt.setOrigin(0, 0.5);
            const jobRow = S ? S.jobsFor(this.settle, p.pawnId) : {};
            for (let i = 0; i < nJobs; i++) {
                const j = jobs[i];
                const pri = jobRow[j] || 0;
                const cellX = nameW + i * cellW;
                const bg = scene.add.rectangle(cellX, rowY, cellW, rowH, cellBg, 1)
                    .setOrigin(0, 0)
                    .setInteractive({ useHandCursor: true });
                const txt = scene.add.text(cellX + cellW / 2, rowY + rowH / 2, pri ? String(pri) : "–", {
                    fontFamily: PIXEL_UI_FONT,
                    fontSize: `${pixelUiFontSize(11, sc)}px`,
                    color: "#d4c4a8"
                }).setOrigin(0.5);
                if (typeof applyPixelUiFont === "function") applyPixelUiFont(txt, 11, sc);
                let hovering = false;
                let pressing = false;
                const paint = () => {
                    if (pressing) bg.setFillStyle(cellPress, 1);
                    else if (hovering) bg.setFillStyle(cellHover, 1);
                    else bg.setFillStyle(cellBg, 1);
                };
                bg.on("pointerover", (pointer) => {
                    if (!this._pointerInBody(pointer)) return;
                    hovering = true;
                    paint();
                });
                bg.on("pointerout", () => {
                    hovering = false;
                    pressing = false;
                    paint();
                });
                bg.on("pointerdown", (pointer) => {
                    if (!this._pointerInBody(pointer)) return;
                    pressing = true;
                    paint();
                });
                bg.on("pointerup", (pointer) => {
                    const was = pressing && hovering;
                    pressing = false;
                    paint();
                    if (!was || !this._pointerInBody(pointer)) return;
                    const right = !!(pointer.rightButtonReleased?.() || pointer.button === 2);
                    const next = S
                        ? (right ? S.cyclePriority(pri) : S.raisePriority(pri))
                        : 0;
                    S?.setJob(this.settle, p.pawnId, j, next);
                    this.scene.settlementSys?.sendNet("setJobs", {
                        settlementId: this.settle.id,
                        pawnId: p.pawnId,
                        jobs: this.settle.jobs?.[p.pawnId]
                    });
                    this.refresh();
                });
                this.body.add(bg);
                this.body.add(txt);
            }
        }

        const rows = here.length;
        const gridH = headerH + rowH * rows;
        const g = scene.add.graphics();
        g.lineStyle(stroke, line, 1);
        g.strokeRect(stroke / 2, stroke / 2, gridW - stroke, gridH - stroke);
        let vx = nameW;
        g.lineBetween(vx, 0, vx, gridH);
        for (let i = 1; i < nJobs; i++) {
            vx = nameW + i * cellW;
            g.lineBetween(vx, 0, vx, gridH);
        }
        let hy = headerH;
        g.lineBetween(0, hy, gridW, hy);
        for (let r = 1; r < rows; r++) {
            hy = headerH + r * rowH;
            g.lineBetween(0, hy, gridW, hy);
        }
        this.body.add(g);
        return gridH + 8 * sc;
    }

    _fillStock(sc) {
        const S = typeof Settlement !== "undefined" ? Settlement : null;
        const scene = this.scene;
        const sys = scene.settlementSys;
        const items = sys?.localStockItems?.(this.settle) || [];
        const settle = this.settle;
        settle.stock = S ? S.normalizeStock(settle.stock) : (settle.stock || {});
        let y = 0;
        const wrapW = Math.max(80, this._viewW - Math.round(12 * sc));
        const header = this._label("Set desired amount to store", 0, y, 11, wrapW);
        y += Math.max(18 * sc, Math.round(header.height + 6 * sc));
        if (!items.length) {
            this._label("Nothing gatherable in range.", 0, y, 11);
            return y + 18 * sc;
        }
        const btnX = this._viewW > 80 ? this._viewW - Math.round(72 * sc) : 200 * sc;
        const btnW = Math.round(24 * sc);
        const btnH = Math.round(20 * sc);
        this._stockRows = [];
        for (const id of items) {
            const meta = scene.getItem?.(id);
            const name = meta?.name || id;
            const label = this._label(`${name}  0/0`, 0, y, 11);
            const minus = this._btn(btnX, y + 8 * sc, "–", (pointer) => {
                this._nudgeStock(settle, id, -this._stockStep(pointer));
            }, true);
            const plus = this._btn(btnX + Math.round(32 * sc), y + 8 * sc, "+", (pointer) => {
                this._nudgeStock(settle, id, this._stockStep(pointer));
            }, true);
            this._fitBtnHit(minus, btnW, btnH);
            this._fitBtnHit(plus, btnW, btnH);
            minus._ctrlClick = true;
            plus._ctrlClick = true;
            minus._paint?.();
            plus._paint?.();
            this.body.add(minus);
            this.body.add(plus);
            const row = { id, name, label, minus, plus };
            this._stockRows.push(row);
            this._paintStockRow(row);
            y += 22 * sc;
        }
        this._restoreStockHover();
        return y + 8 * sc;
    }

    refreshStockLive() {
        if (!this.visible || this.tab !== "stock" || !this.settle) return;
        const items = this.scene.settlementSys?.localStockItems?.(this.settle) || [];
        const rows = this._stockRows || [];
        const ids = new Set(items);
        if (items.length !== rows.length || rows.some((r) => !ids.has(r.id))) {
            this.refresh();
            return;
        }
        for (const row of rows) this._paintStockRow(row);
    }

    _restoreStockHover() {
        const pointer = this.scene.input?.activePointer;
        if (!pointer || !this._pointerInBody(pointer)) return;
        for (const row of this._stockRows || []) {
            for (const b of [row.minus, row.plus]) {
                const bg = b?._bg;
                if (!bg?.getBounds) continue;
                const over = Phaser.Geom.Rectangle.Contains(bg.getBounds(), pointer.x, pointer.y);
                if (over) {
                    b._hovering = true;
                    b._paint?.();
                    this.scene._hoverTarget = bg;
                }
            }
        }
    }

    _paintStockRow(row) {
        if (!row?.label || !this.settle) return;
        const have = this.scene.settlementSys?.countBaskets(this.settle, row.id) || 0;
        const want = this.settle.stock[row.id] || 0;
        row.label.setText(`${row.name}  ${have}/${want}`);
    }

    _stockStep(pointer) {
        const ev = pointer?.event;
        const keys = this.scene?.player?.keys;
        const shift = !!(ev?.shiftKey || keys?.SHIFT?.isDown);
        const ctrl = !!(ev?.ctrlKey || ev?.metaKey || keys?.CTRL?.isDown);
        if (shift) return 100;
        if (ctrl) return 10;
        return 1;
    }

    _nudgeStock(settle, id, delta) {
        if (!settle || !id) return;
        const next = Math.max(0, Math.min(9999, (settle.stock[id] || 0) + delta));
        settle.stock[id] = next;
        this.scene.settlementSys?.sendNet("setStock", { settlementId: settle.id, stock: settle.stock });
        const row = (this._stockRows || []).find((r) => r.id === id);
        if (row) this._paintStockRow(row);
        else this.refresh();
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer) return false;
        const b = this.bg.getBounds();
        return Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y);
    }
}
