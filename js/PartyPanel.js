/**
 * Right-side party roster (hidden while party.length < 2).
 */
class PartyPanel {
    constructor(scene) {
        this.scene = scene;
        this.rows = [];
        this.pips = [];
        this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(15000);
        scene.uiLayer?.add(this.root);
        this.visible = false;
        this.layout();
    }

    layout() {
        this._layoutKey = null;
        this.refresh();
    }

    /** Cheap per-frame: offscreen pips + vitals. Full card rebuild only when roster/layout changes. */
    tick() {
        const scene = this.scene;
        this.updatePips();
        const roster = scene.partySys?.roster?.() || [];
        const show = roster.length >= 2;
        if (!show) {
            if (this.visible) this.refresh();
            return;
        }
        const s = scene.uiScale || 1;
        const ids = [];
        for (let i = 0; i < roster.length; i++) ids.push(roster[i]?.pawnId || i);
        const key = `${ids.join("\0")}|${scene.player?.pawnId || ""}|${scene.leader?.pawnId || ""}|${s}|${scene.scale.width}|${scene.scale.height}`;
        if (key !== this._layoutKey) {
            this.refresh();
            return;
        }
        for (let i = 0; i < this.rows.length; i++) {
            const row = this.rows[i];
            const pawn = row.pawn;
            if (!pawn) continue;
            const dead = !!pawn.isBodyDead?.();
            const far = this._isDetached(pawn);
            const a = dead ? 0.4 : far ? 0.55 : 1;
            if (row.root.alpha !== a) row.root.setAlpha(a);
            this._drawVitals(row, pawn, s, row._cardW);
        }
    }

    refresh() {
        const scene = this.scene;
        const sys = scene.partySys;
        const roster = sys?.roster?.() || [];
        const show = roster.length >= 2;
        this.root.setVisible(show);
        this.visible = show;
        if (!show) {
            this._layoutKey = null;
            this._clearRows();
            return;
        }
        const s = scene.uiScale || 1;
        const ids = [];
        for (let i = 0; i < roster.length; i++) ids.push(roster[i]?.pawnId || i);
        this._layoutKey = `${ids.join("\0")}|${scene.player?.pawnId || ""}|${scene.leader?.pawnId || ""}|${s}|${scene.scale.width}|${scene.scale.height}`;
        const P = typeof Party !== "undefined" ? Party : { COLOR_ALLY: "#80e080" };
        while (this.rows.length < roster.length) this._makeRow();
        while (this.rows.length > roster.length) {
            const extra = this.rows.pop();
            extra.root.destroy(true);
        }
        let maxNameW = 0;
        let maxNameH = Math.round(12 * s);
        roster.forEach((pawn, i) => {
            const row = this.rows[i];
            row.pawn = pawn;
            row.name.setText(pawn.displayName?.() || "?");
            row.name.setColor(P.COLOR_ALLY);
            if (typeof applyPixelUiFont === "function") {
                applyPixelUiFont(row.name, 8, s);
                applyPixelUiFont(row.warn, 8, s);
            } else {
                row.name.setFontSize(pixelUiFontSize(8, s));
            }
            maxNameW = Math.max(maxNameW, row.name.displayWidth || row.name.width || 0);
            maxNameH = Math.max(maxNameH, row.name.displayHeight || row.name.height || 0);
        });
        const padX = 8 * s;
        const padY = 4 * s;
        const sprH = 32 * s;
        const vitalsH = 11 * s;
        const w = Math.max(56 * s, maxNameW + padX * 2);
        const h = padY + sprH + 2 * s + vitalsH + 1 * s + maxNameH + padY;
        const rowH = h + 4 * s;
        const total = (roster.length - 1) * rowH;
        const startY = -total / 2;
        this.root.setPosition(
            Math.round(scene.scale.width - w / 2 - 8 * s),
            Math.round(scene.scale.height / 2)
        );
        roster.forEach((pawn, i) => {
            const row = this.rows[i];
            row.root.setPosition(0, startY + i * rowH);
            this._layoutCard(row, w, h, s, sprH, padY, maxNameH);
            const tex = pawn.texture?.key || "human";
            if (row.spr.texture?.key !== tex) row.spr.setTexture(tex, 1);
            else row.spr.setFrame(1);
            row.spr.setScale(2 * s);
            row.crown.setVisible(pawn === scene.leader);
            row.crown.setScale(s);
            const controlled = pawn === scene.player;
            if (controlled) {
                row.bg.setFillStyle(0x2f6b32, 0.88);
                row.bg.setStrokeStyle(Math.max(2, Math.round(2 * s)), 0xb8ffb8, 1);
                row.name.setColor("#d8ffd8");
            } else {
                row.bg.setFillStyle(0x000000, 0.32);
                row.bg.setStrokeStyle(0);
                row.name.setColor(P.COLOR_ALLY);
            }
            const dead = !!pawn.isBodyDead?.();
            const far = this._isDetached(pawn);
            row.root.setAlpha(dead ? 0.4 : far ? 0.55 : 1);
            row._cardW = w;
            row._vitalsSig = null;
            this._drawVitals(row, pawn, s, w);
        });
    }

    _isDetached(pawn) {
        const ctrl = this.scene.player;
        if (!ctrl || pawn === ctrl) return false;
        const P = typeof Party !== "undefined" ? Party : { FOLLOW_DETACH: 12 };
        const d = typeof Party !== "undefined"
            ? Party.distTiles(pawn, ctrl, this.scene.tileSize)
            : Math.hypot(pawn.x - ctrl.x, pawn.y - ctrl.y) / (this.scene.tileSize || 16);
        return d > (P.FOLLOW_DETACH || 12);
    }

    _bagsFull(pawn) {
        if (!pawn) return false;
        const bagFull = (arr, cap) => {
            const n = Math.max(0, Math.floor(Number(cap) || 0));
            if (!(n > 0)) return true;
            const list = arr || [];
            for (let i = 0; i < n; i++) {
                if (!list[i]) return false;
            }
            return true;
        };
        const hotCap = Math.max(
            Number(pawn.inventorySize) || 0,
            Array.isArray(pawn.inventory) ? pawn.inventory.length : 0
        );
        const overCap = Math.max(
            Number(pawn.overflowSize) || 0,
            Array.isArray(pawn.overflow) ? pawn.overflow.length : 0,
            pawn.getOverflowBonus?.() || 0
        );
        return bagFull(pawn.inventory, hotCap) && bagFull(pawn.overflow, overCap);
    }

    /** Integer-pixel "!" so it stays sharp next to the 3px carry bar. */
    _drawPixelBang(g, right, midY, u) {
        const stemW = u;
        const stemH = 3 * u;
        const dot = u;
        const gap = u;
        const pad = u;
        const totalW = stemW + pad * 2;
        const totalH = stemH + gap + dot;
        const x0 = Math.round(right - totalW);
        const y0 = Math.round(midY - totalH / 2);
        g.fillStyle(0x000000, 1);
        g.fillRect(x0, y0, totalW, stemH);
        g.fillRect(x0, y0 + stemH + gap, totalW, dot);
        g.fillStyle(0xffcc66, 1);
        g.fillRect(x0 + pad, y0, stemW, stemH);
        g.fillRect(x0 + pad, y0 + stemH + gap, stemW, dot);
    }

    _drawVitals(row, pawn, s, cardW) {
        const cap = pawn.capacities || (pawn.anatomy ? new Capacities(pawn.anatomy) : null);
        const pain = Phaser.Math.Clamp(cap?.pain?.() ?? 0, 0, 1);
        const stomach = Math.max(1, Number(pawn.stomach) || 2000);
        const kc = Number(pawn.kc) || 0;
        const sat = Number(pawn.saturation) || 0;
        const weight = pawn.getInventoryWeight?.() ?? 0;
        const strength = Math.max(1, Number(pawn.strength) || 1);
        const starving = kc <= 0;
        const downed = !!pawn._downed;
        const bags = this._bagsFull(pawn);
        const sig = `${pain.toFixed(3)}|${kc}|${sat}|${weight}|${strength}|${starving}|${downed}|${bags}|${s}|${cardW || 0}`;
        if (row._vitalsSig === sig) return;
        row._vitalsSig = sig;
        const g = row.vitals;
        g.clear();
        const kcFrac = Phaser.Math.Clamp(kc / stomach, 0, 1);
        const satFrac = Phaser.Math.Clamp(sat / stomach, 0, 1);
        const w = Math.max(28 * s, (cardW || 56 * s) - 16 * s);
        const h = 3 * s;
        const gap = 1 * s;
        const x = -w / 2;
        let y = 0;

        g.fillStyle(0x111111, 0.9);
        g.fillRect(x, y, w, h);
        g.fillStyle(0xD24A43, 1);
        g.fillRect(x, y, w * pain, h);
        const shockT = Number(pawn.anatomy?.plan?.painShockThreshold) || 0.8;
        const tickW = Math.max(1, Math.round(s));
        g.fillStyle(0x444444, 1);
        g.fillRect(x + Math.round(w * Phaser.Math.Clamp(shockT, 0, 1)) - Math.floor(tickW / 2), y, tickW, h);

        y += h + gap;
        g.fillStyle(0x111111, 0.9);
        g.fillRect(x, y, w, h);
        g.fillStyle(0xE0C14B, 1);
        g.fillRect(x, y, w * kcFrac, h);
        const satW = Math.floor(w * satFrac);
        if (satW > 0) {
            g.fillStyle(0xE67E22, 1);
            g.fillRect(x, y, satW, h);
        }

        y += h + gap;
        g.fillStyle(0x111111, 0.9);
        g.fillRect(x, y, w, h);
        const limit1 = strength;
        const clamped = Math.min(Math.max(0, weight), limit1 * 2);
        const width1 = Math.floor(w * Math.min(clamped, limit1) / limit1);
        if (width1 > 0) {
            g.fillStyle(0x2ECC71, 1);
            g.fillRect(x, y, width1, h);
        }
        const width2 = Math.floor(w * Math.max(0, clamped - limit1) / limit1);
        if (width2 > 0) {
            g.fillStyle(0xF39C12, 1);
            g.fillRect(x, y, width2, h);
        }
        if (bags) {
            const u = Math.max(1, Math.round(s));
            this._drawPixelBang(g, x - u, y + h / 2, u);
        }

        const warn = downed ? "!" : starving ? "H" : "";
        row.warn.setVisible(!!warn);
        if (row.warn.text !== warn) row.warn.setText(warn);
    }

    _layoutCard(row, w, h, s, sprH, padY, nameH) {
        row.bg.setSize(w, h);
        if (row.hit.width !== w || row.hit.height !== h) {
            row.hit.setSize(w, h);
            row.hit.setInteractive({ useHandCursor: true });
        }
        const top = -h / 2 + padY;
        row.spr.setPosition(0, top + sprH * 0.45);
        row.crown.setPosition(14 * s, top + 4 * s);
        row.warn.setPosition(w / 2 - 8 * s, top + 6 * s);
        row.vitals.setPosition(0, top + sprH + 1 * s);
        row.name.setPosition(0, h / 2 - padY - nameH);
    }

    _makeRow() {
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const w = 56 * s;
        const h = 64 * s;
        const root = scene.add.container(0, 0).setScrollFactor(0);
        const bg = scene.add.rectangle(0, 0, w, h, 0x000000, 0.35).setOrigin(0.5);
        // Zone matches the card; container hit-areas reset on setSize and sit at origin.
        const hit = scene.add.zone(0, 0, w, h).setOrigin(0.5);
        hit.setInteractive({ useHandCursor: true });
        const spr = scene.add.sprite(0, -10 * s, "human", 1).setOrigin(0.5, 0.5).setScale(2 * s);
        const crown = scene.add.image(14 * s, -22 * s, "leader").setOrigin(0.5).setVisible(false);
        const name = crispUiText(scene.add.text(0, 18 * s, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(8, 1)}px`,
            color: "#80e080",
            stroke: "#000000",
            strokeThickness: 3,
            align: "center"
        }).setOrigin(0.5, 0));
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(name, 8, s);
        const vitals = scene.add.graphics();
        const warn = crispUiText(scene.add.text(18 * s, -20 * s, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(8, 1)}px`,
            color: "#ffcc66",
            stroke: "#000000",
            strokeThickness: 3
        }).setOrigin(0.5));
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(warn, 8, s);
        root.add([bg, spr, crown, name, vitals, warn, hit]);
        const row = { root, bg, hit, spr, crown, name, vitals, warn, pawn: null };
        hit.on("pointerdown", () => {
            if (scene._gamePaused) return;
            if (row.pawn) scene.partySys?.tryAllyClick?.(row.pawn, { forceSwitch: true });
        });
        hit.on("pointerover", (p) => {
            if (scene._gamePaused || !row.pawn) return;
            scene.showTooltip?.(() => {
                const pawn = row.pawn;
                if (!pawn) return "";
                const name = pawn.displayName?.() || "";
                const controlled = !!(pawn.isControlled?.() || pawn === scene.player);
                const busy = controlled ? "" : (scene.partySys?.activityTooltip?.(pawn) || "");
                const text = busy ? `${name}\n${busy}` : name;
                return scene.partySys?.withHeldTooltip?.(pawn, text) || text;
            }, p.x, p.y, hit);
        });
        hit.on("pointerout", () => {
            if (scene._tooltipTarget === hit) scene.hideTooltip?.();
        });
        this.root.add(root);
        this.rows.push(row);
        return row;
    }

    _clearRows() {
        for (const row of this.rows) row.root.destroy(true);
        this.rows = [];
        for (const pip of this.pips) pip.destroy();
        this.pips = [];
    }

    containsPointer(pointer) {
        if (!this.visible || !pointer) return false;
        for (const row of this.rows) {
            const b = row.hit?.getBounds?.() || row.bg?.getBounds?.();
            if (b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y)) return true;
        }
        return false;
    }

    pawnAtPointer(pointer) {
        if (!this.visible || !pointer) return null;
        for (const row of this.rows) {
            const b = row.hit?.getBounds?.() || row.bg?.getBounds?.();
            if (b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y)) return row.pawn;
        }
        return null;
    }

    /** Screen-space pos of a pawn's visual center (origin 0,1 is feet-left). */
    _pawnScreenPos(pawn, cam, view, zoom) {
        const c = typeof pawn.bodyCenter === "function"
            ? pawn.bodyCenter()
            : { x: (pawn.x || 0) + 8, y: (pawn.y || 0) - 8 };
        return {
            x: (c.x - view.x) * zoom + (cam.x || 0),
            y: (c.y - view.y) * zoom + (cam.y || 0)
        };
    }

    /** Clip center→target to the padded screen rect (stay on the bearing). */
    _rayToRect(cx, cy, px, py, left, top, right, bottom) {
        const dx = px - cx;
        const dy = py - cy;
        let t = Infinity;
        if (dx > 1e-9) t = Math.min(t, (right - cx) / dx);
        else if (dx < -1e-9) t = Math.min(t, (left - cx) / dx);
        if (dy > 1e-9) t = Math.min(t, (bottom - cy) / dy);
        else if (dy < -1e-9) t = Math.min(t, (top - cy) / dy);
        if (!Number.isFinite(t) || t <= 0) return { x: cx, y: cy };
        return { x: cx + dx * t, y: cy + dy * t };
    }

    updatePips() {
        const scene = this.scene;
        const cam = scene.cameras?.main;
        if (!cam || !this.visible) {
            for (const p of this.pips) p.setVisible(false);
            return;
        }
        const view = cam.worldView;
        const s = scene.uiScale || 1;
        const members = (scene.party || []).filter((p) => p && p !== scene.player && !p.isBodyDead?.());
        while (this.pips.length < members.length) {
            const img = scene.add.triangle(0, 0, 0, 6, 5, 0, 10, 6, 0x80e080, 0.9)
                .setScrollFactor(0)
                .setDepth(15001);
            scene.uiLayer?.add(img);
            this.pips.push(img);
        }
        while (this.pips.length > members.length) {
            this.pips.pop().destroy();
        }
        const zoom = cam.zoom || scene.worldZoom || 1;
        const w = cam.width || scene.scale.width;
        const h = cam.height || scene.scale.height;
        const ox = cam.x || 0;
        const oy = cam.y || 0;
        const pad = 12 * s;
        const cx = ox + w / 2;
        const cy = oy + h / 2;
        members.forEach((pawn, i) => {
            const pip = this.pips[i];
            const sp = this._pawnScreenPos(pawn, cam, view, zoom);
            const inside = sp.x >= ox && sp.x <= ox + w && sp.y >= oy && sp.y <= oy + h;
            pip.setVisible(!inside);
            if (inside) return;
            const hit = this._rayToRect(cx, cy, sp.x, sp.y, ox + pad, oy + pad, ox + w - pad, oy + h - pad);
            pip.setPosition(hit.x, hit.y);
            pip.setRotation(Math.atan2(sp.y - cy, sp.x - cx) + Math.PI / 2);
            pip.setScale(s);
        });
    }
}
