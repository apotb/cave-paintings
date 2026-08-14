/**
 * Health schematic (status2.png) + capacities / injuries list.
 * Anchored on the left (like equipment). Can inspect player or a corpse body.
 *
 * Part overlays use black silhouette masks in assets/ui/status_parts/.
 * Draw order is back→front so smaller / nested parts paint over parents.
 */
class HealthPanel {
    /** Part names in paint order (large / outer first → small / inner last). */
    static PART_OVERLAY_ORDER = [
        "Torso",
        "Waist", "Pelvis", "Spine", "Ribcage", "Sternum",
        "Heart", "Stomach", "Liver",
        "Left Lung", "Right Lung", "Left Kidney", "Right Kidney",
        "Neck",
        "Left Arm", "Right Arm",
        "Left Humerus", "Right Humerus", "Left Radius", "Right Radius",
        "Left Hand", "Right Hand",
        "Left Shoulder", "Right Shoulder",
        "Left Clavicle", "Right Clavicle",
        "Left Thumb", "Right Thumb",
        "Left Index Finger", "Right Index Finger",
        "Left Middle Finger", "Right Middle Finger",
        "Left Ring Finger", "Right Ring Finger",
        "Left Pinky Finger", "Right Pinky Finger",
        "Left Leg", "Right Leg",
        "Left Femur", "Right Femur", "Left Tibia", "Right Tibia",
        "Left Foot", "Right Foot",
        "Left Big Toe", "Right Big Toe",
        "Left Second Toe", "Right Second Toe",
        "Left Middle Toe", "Right Middle Toe",
        "Left Fourth Toe", "Right Fourth Toe",
        "Left Little Toe", "Right Little Toe",
        "Head",
        "Jaw", "Nose", "Left Eye", "Right Eye", "Left Ear", "Right Ear",
        "Skull", "Tongue",
        "Brain"
    ];

    static partTexKey(name) {
        return `status_part_${String(name).replace(/ /g, "_")}`;
    }

    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        /** @type {Body|null} when set, show this instead of player */
        this._inspectBody = null;
        this._inspectTitle = null;

        this.root = scene.add.container(0, 0);
        this.root.setScrollFactor(0).setDepth(9000).setVisible(false);
        scene.uiLayer.add(this.root);

        this.bg = scene.add.rectangle(0, 0, 300, 380, 0x1a1410, 0.92)
            .setOrigin(0.5)
            .setStrokeStyle(2, 0x6b5344);
        // Capture pointer so world/tooltips behind the panel don't receive hover
        this.bg.setInteractive({ cursor: "default" });
        this.root.add(this.bg);

        this.title = crispUiText(scene.add.text(0, -170, "Health", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#f0e6d8"
        }).setOrigin(0.5));
        this.root.add(this.title);

        this.doll = scene.add.image(-90, 0, "status2").setOrigin(0.5);
        this.root.add(this.doll);

        this.overlayLayer = scene.add.container(0, 0);
        this.root.add(this.overlayLayer);
        /** @type {Object.<string, Phaser.GameObjects.Image>} */
        this._partOverlays = {};
        this._initPartOverlays();

        this.capLayer = scene.add.container(0, 0);
        this.root.add(this.capLayer);
        /** @type {Phaser.GameObjects.Text[]} */
        this._capRows = [];

        this.injHeader = crispUiText(scene.add.text(0, 0, "Injuries:", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "8px",
            color: "#ddd0c0"
        }).setOrigin(0, 0));
        this.root.add(this.injHeader);

        // Scrollable injuries list (stats above stay fixed)
        this.injView = scene.add.container(0, 0);
        this.root.add(this.injView);
        this.injContent = scene.add.container(0, 0);
        this.injView.add(this.injContent);

        /** @type {{ bg: Phaser.GameObjects.Rectangle, text: Phaser.GameObjects.Text, bleeding: boolean }[]} */
        this._injLines = [];

        this._injMaskGfx = scene.make.graphics({ x: 0, y: 0, add: false });
        this.injContent.setMask(this._injMaskGfx.createGeometryMask());

        // Invisible hit bounds for wheel/hover tests (not interactive — avoids finger cursor)
        this.injHit = scene.add.rectangle(0, 0, 100, 100, 0x000000, 0)
            .setOrigin(0, 0)
            .setVisible(false);
        this.root.add(this.injHit);

        this.scrollTrack = scene.add.rectangle(0, 0, 5, 100, 0x3a2e26, 1).setOrigin(0, 0);
        this.scrollThumb = scene.add.rectangle(0, 0, 5, 20, 0x8a7260, 1).setOrigin(0, 0);
        this.scrollTrack.setVisible(false);
        this.scrollThumb.setVisible(false);
        this.root.add(this.scrollTrack);
        this.root.add(this.scrollThumb);

        this._injScroll = 0;
        this._injContentH = 0;
        this._injViewH = 0;
        this._injViewW = 0;
        this._injMaxScroll = 0;
        this._scrollDrag = null;

        this.scrollThumb.setInteractive({ useHandCursor: false, cursor: "default" });
        this.scrollThumb.on("pointerdown", (p) => {
            this._scrollDrag = {
                startY: p.y,
                startScroll: this._injScroll
            };
        });
        scene.input.on("pointerup", () => { this._scrollDrag = null; });
        scene.input.on("pointermove", (p) => {
            if (!this.visible || !this._scrollDrag || this._injMaxScroll <= 0) return;
            const trackTravel = Math.max(1, this._injViewH - this.scrollThumb.height);
            const dy = p.y - this._scrollDrag.startY;
            const scrollDelta = (dy / trackTravel) * this._injMaxScroll;
            this._setInjScroll(this._scrollDrag.startScroll + scrollDelta);
        });
        scene.input.on("wheel", (_p, _over, _dx, dy) => {
            if (!this.visible || this._injMaxScroll <= 0) return;
            const ptr = scene.input.activePointer;
            if (!this._pointerInInjView(ptr.x, ptr.y)) return;
            this._setInjScroll(this._injScroll + dy * 0.35);
        });

        // Bake Text/interactive rows at boot so the first open isn't a hitch
        this._ensureCapRows(13);
        this._setInjLines(Array.from({ length: 32 }, () => ({ text: "." })));
        this._setInjLines([{ text: "None" }]);
        this._lastDollScale = null;
        this._overlayRefreshQueued = false;
    }

    _initPartOverlays() {
        for (const name of HealthPanel.PART_OVERLAY_ORDER) {
            const key = HealthPanel.partTexKey(name);
            if (!this.scene.textures.exists(key)) continue;
            const img = this.scene.add.image(0, 0, key).setOrigin(0.5).setVisible(false);
            this.overlayLayer.add(img);
            this._partOverlays[name] = img;
        }
    }

    isInspecting() {
        return !!this._inspectBody;
    }

    /** Open player health (clears corpse inspect). */
    open() {
        this._inspectBody = null;
        this._inspectTitle = null;
        this._injScroll = 0;
        this.visible = true;
        this.root.setVisible(true);
        this.refresh();
        this.scene.healthBtn?.setTexture("health_open");
    }

    /**
     * Show a corpse / other body's injuries (left panel).
     * @param {Body} body
     * @param {string} title
     */
    openInspect(body, title) {
        if (!body) return;
        this._inspectBody = body;
        this._inspectTitle = title || "Corpse";
        this._injScroll = 0;
        this.visible = true;
        this.root.setVisible(true);
        this.refresh();
        this.scene.healthBtn?.setTexture("health_open");
    }

    close() {
        this._clearCapTooltip();
        this._scrollDrag = null;
        this.visible = false;
        this.root.setVisible(false);
        this._inspectBody = null;
        this._inspectTitle = null;
        const p = this.scene.input?.activePointer;
        const btn = this.scene.healthBtn;
        if (btn) {
            const hovering = p && Phaser.Geom.Rectangle.Contains(btn.getBounds(), p.x, p.y);
            btn.setTexture(hovering ? "health_hover" : "health");
        }
    }

    toggle() {
        if (this.visible && !this.isInspecting()) this.close();
        else this.open();
    }

    _clearCapTooltip() {
        const t = this.scene._tooltipTarget;
        if (!t) return;
        if (this._capRows.includes(t)) this.scene.hideTooltip?.();
        else if (this._injLines.some((row) => row.text === t)) this.scene.hideTooltip?.();
    }

    _pointerInInjView(screenX, screenY) {
        const b = this.injHit.getBounds();
        return Phaser.Geom.Rectangle.Contains(b, screenX, screenY);
    }

    _setInjScroll(y) {
        this._injScroll = Phaser.Math.Clamp(y, 0, this._injMaxScroll);
        this.injContent.setY(-this._injScroll);
        this._layoutScrollbar();
    }

    _layoutScrollbar() {
        const s = this.scene.uiScale || 1;
        const need = this._injMaxScroll > 0.5;
        this.scrollTrack.setVisible(need);
        this.scrollThumb.setVisible(need);
        if (!need) return;

        const trackH = this._injViewH;
        const thumbH = Math.max(16 * s, trackH * (this._injViewH / Math.max(this._injContentH, 1)));
        const travel = Math.max(1, trackH - thumbH);
        const t = this._injMaxScroll > 0 ? this._injScroll / this._injMaxScroll : 0;
        this.scrollTrack.setSize(5 * s, trackH);
        this.scrollThumb.setSize(5 * s, thumbH);
        this.scrollThumb.setPosition(this.scrollTrack.x, this.scrollTrack.y + travel * t);
        if (this.scrollThumb.input?.hitArea?.setSize) {
            this.scrollThumb.input.hitArea.setSize(this.scrollThumb.width, this.scrollThumb.height);
        }
    }

    /** Human schematic doll; animal plans set showDoll: false. */
    _showsDoll(body) {
        if (!body?.plan) return true;
        return body.plan.showDoll !== false;
    }

    layout() {
        const s = this.scene.uiScale || 1;
        const body = this._inspectBody || this.scene.player?.anatomy;
        const showDoll = this._showsDoll(body);
        // No diagram → drop the doll column; keep roughly the old stats-column width
        const panelW = (showDoll ? 300 : 180) * s;
        const panelH = 380 * s;
        const pad = 12 * s;
        const gap = 8 * s;
        this.bg.setSize(panelW, panelH);
        if (this.bg.input?.hitArea?.setSize) {
            this.bg.input.hitArea.setSize(this.bg.width, this.bg.height);
        }

        // Left side, beside the craft/equipment/health buttons (same idea as equipment)
        const btn = this.scene.healthBtn || this.scene.craft || this.scene.equipmentBtn;
        const left = btn
            ? btn.x + btn.displayWidth / 2 + 8 * s
            : 80 * s;
        const top = Phaser.Math.Clamp(
            (this.scene.scale.height - panelH) / 2,
            8 * s,
            Math.max(8 * s, this.scene.scale.height - panelH - 8 * s)
        );
        this.root.setPosition(Math.round(left + panelW / 2), Math.round(top + panelH / 2));

        this.title.setFontSize(pixelUiFontSize(16, s)).setPosition(0, -panelH / 2 + 18 * s);

        this.doll.setVisible(showDoll);
        this.overlayLayer.setVisible(showDoll);

        const titleBottom = -panelH / 2 + 34 * s;
        const contentBottom = panelH / 2 - pad;
        const scrollBarW = 7 * s;
        let listX;
        let wrapW;
        if (showDoll) {
            // Fit doll in panel height with a little margin; sit left, vertically centered under title
            const maxDollH = contentBottom - titleBottom - 4 * s;
            const srcH = this.doll.height || 178;
            const dollScale = Math.min(1.65 * s, maxDollH / srcH);
            this.doll.setScale(dollScale);
            const dollW = this.doll.displayWidth;
            const dollX = -panelW / 2 + pad + dollW / 2;
            const dollY = (titleBottom + contentBottom) / 2;
            this.doll.setPosition(dollX, dollY);
            this.overlayLayer.setPosition(dollX, dollY);
            if (this._lastDollScale !== dollScale) {
                this._lastDollScale = dollScale;
                for (const img of Object.values(this._partOverlays)) {
                    img.setScale(dollScale).setPosition(0, 0);
                }
            }
            listX = dollX + dollW / 2 + gap;
            wrapW = Math.max(80 * s, panelW / 2 - pad - listX - scrollBarW);
        } else {
            listX = -panelW / 2 + pad;
            wrapW = Math.max(80 * s, panelW - pad * 2 - scrollBarW);
        }
        const listTop = titleBottom + 2 * s;
        const fontSize = pixelUiFontSize(8, s);
        const lineH = fontSize + PIXEL_FONT_CELL;

        this.capLayer.setPosition(listX, listTop);
        for (let i = 0; i < this._capRows.length; i++) {
            const row = this._capRows[i];
            row.setFontSize(fontSize).setPosition(0, i * lineH);
            if (row.input?.hitArea?.setSize) {
                row.input.hitArea.setSize(Math.max(row.width, 1), Math.max(row.height, 1));
            }
        }

        const headerY = listTop + this._capRows.length * lineH + 4 * s;
        this.injHeader.setFontSize(fontSize).setPosition(listX, headerY);

        const viewTop = headerY + lineH;
        const viewH = Math.max(24 * s, contentBottom - viewTop);
        this._injViewW = wrapW;
        this._injViewH = viewH;

        this.injView.setPosition(listX, viewTop);
        let y = 0;
        for (let i = 0; i < this._injLines.length; i++) {
            const line = this._injLines[i];
            if (!line.text.visible) continue;
            line.text.setFontSize(fontSize).setWordWrapWidth(wrapW);
            // Row height from wrap count × lineH — not text.height (font metrics
            // add empty descent, so the red bar looked bottom-heavy).
            const wrapped = line.text.getWrappedText?.(String(line.text.text || ""));
            const rows = Math.max(1, (wrapped && wrapped.length) || 1);
            const h = rows * lineH;
            const padY = Math.max(0, Math.round((lineH - fontSize) * 0.5));
            line.text.setPosition(1 * s, y + padY);
            line.bg.setPosition(0, y).setSize(wrapW, h);
            const showBg = !!(line.bleeding || line.destroyed);
            line.bg.setVisible(showBg);
            if (line.bleeding) line.bg.setFillStyle(0x3a0808, 1);
            else if (line.destroyed) line.bg.setFillStyle(0x0e0d0c, 1);
            if (line.text.input?.hitArea?.setSize) {
                line.text.input.hitArea.setSize(Math.max(wrapW, 1), Math.max(h, 1));
            }
            y += h;
        }
        this._injContentH = Math.max(y, 1);
        this._injMaxScroll = Math.max(0, this._injContentH - viewH);
        this._setInjScroll(Math.min(this._injScroll, this._injMaxScroll));

        // Geometry mask in world space (root is centered on screen)
        const wx = this.root.x + listX;
        const wy = this.root.y + viewTop;
        this._injMaskGfx.clear();
        this._injMaskGfx.fillStyle(0xffffff, 1);
        this._injMaskGfx.fillRect(wx, wy, wrapW, viewH);

        this.injHit.setPosition(listX, viewTop).setSize(wrapW + scrollBarW, viewH);

        this.scrollTrack.setPosition(listX + wrapW + 2 * s, viewTop);
        this._layoutScrollbar();
    }

    /** Color from damage: green@0 → yellow@1 sev → orange@50%hp → red@≤25%hp */
    _partColor(part) {
        if (!part || part.isDead()) return 0x331111;
        // Use local HP — not efficiency() (that is 0 when a parent like Torso is destroyed)
        const frac = typeof part.hpFraction === "function" ? part.hpFraction() : part.efficiency();
        const sev = part.damageSeverity();
        if (sev <= 0 && frac >= 0.999) return 0x3CB043;
        let c;
        if (sev < 1 && frac > 0.5) {
            const u = Phaser.Math.Clamp(sev / 1, 0, 1);
            c = this._lerpColor(0x3CB043, 0xE6C200, u);
        } else if (frac > 0.25) {
            if (frac <= 0.5) c = this._lerpColor(0xE67A00, 0xD24A43, Phaser.Math.Clamp((0.5 - frac) / 0.25, 0, 1));
            else c = 0xE6C200;
        } else {
            c = 0xD24A43;
        }
        if (frac <= 0.25) c = 0xD24A43;
        else if (frac <= 0.5) c = this._lerpColor(0xE67A00, 0xD24A43, (0.5 - frac) / 0.25);
        return c;
    }

    _lerpColor(a, b, t) {
        const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
        const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        const r = Math.round(ar + (br - ar) * t);
        const g = Math.round(ag + (bg - ag) * t);
        const bl = Math.round(ab + (bb - ab) * t);
        return (r << 16) | (g << 8) | bl;
    }

    /**
     * @param {{ text: string, bleeding?: boolean, tip?: string|null }[]} lines
     */
    _setInjLines(lines) {
        while (this._injLines.length < lines.length) {
            const bg = this.scene.add.rectangle(0, 0, 10, 10, 0x3a0808, 1)
                .setOrigin(0, 0)
                .setVisible(false);
            const text = crispUiText(this.scene.add.text(0, 0, "", {
                fontFamily: PIXEL_UI_FONT,
                fontSize: "8px",
                color: "#ddd0c0"
            }).setOrigin(0, 0));
            text.setInteractive({ useHandCursor: false });
            const row = { bg, text, bleeding: false, destroyed: false, tip: null };
            text.on("pointerover", (p) => {
                // Live getter so severity/stage tips update while hovering
                this.scene.showTooltip(() => row.tip || "", p.x, p.y, text);
            });
            text.on("pointerout", () => {
                if (this.scene._tooltipTarget === text) this.scene.hideTooltip?.();
            });
            this.injContent.add(bg);
            this.injContent.add(text);
            this._injLines.push(row);
        }
        for (let i = 0; i < this._injLines.length; i++) {
            const row = this._injLines[i];
            if (i < lines.length) {
                row.text.setText(lines[i].text).setVisible(true);
                row.bleeding = !!lines[i].bleeding;
                row.destroyed = !!lines[i].destroyed;
                row.tip = lines[i].tip || null;
                row.bg.setVisible(row.bleeding || row.destroyed);
            } else {
                row.text.setText("").setVisible(false);
                row.bleeding = false;
                row.destroyed = false;
                row.tip = null;
                row.bg.setVisible(false);
                if (this.scene._tooltipTarget === row.text) this.scene.hideTooltip?.();
            }
        }
    }

    _ensureCapRows(count) {
        while (this._capRows.length < count) {
            const row = crispUiText(this.scene.add.text(0, 0, "", {
                fontFamily: PIXEL_UI_FONT,
                fontSize: "8px",
                color: "#ddd0c0"
            }).setOrigin(0, 0));
            row.setInteractive({ useHandCursor: false });
            row.on("pointerover", (p) => {
                this.scene.showTooltip(() => {
                    if (!row._capKey || row._capValue == null) return "";
                    if (row._capKey === "pain") {
                        if (!(row._capValue > 0.001)) return "";
                    } else if (row._capKey !== "bloodLoss" && !(row._capValue < 0.999)) {
                        return "";
                    }
                    const body = this._inspectBody || this.scene.player?.anatomy;
                    if (!body) return "";
                    const caps = new Capacities(body);
                    const lines = caps.explain(row._capKey);
                    return lines?.length ? lines.join("\n") : "";
                }, p.x, p.y, row);
            });
            row.on("pointerout", () => {
                if (this.scene._tooltipTarget === row) this.scene.hideTooltip?.();
            });
            this.capLayer.add(row);
            this._capRows.push(row);
        }
        for (let i = 0; i < this._capRows.length; i++) {
            this._capRows[i].setVisible(i < count);
            if (i >= count) {
                this._capRows[i]._capKey = null;
                this._capRows[i]._capValue = null;
                if (this.scene._tooltipTarget === this._capRows[i]) this.scene.hideTooltip?.();
            }
        }
    }

    refresh() {
        if (!this.visible) return;
        const body = this._inspectBody || this.scene.player?.anatomy;
        if (!body) return;

        const caps = new Capacities(body);
        const c = caps.all();
        const pct = (v) => `${Math.round(v * 100)}%`;
        const title = this._inspectTitle || "Health";
        this.title.setText(title);

        // Hoverable capacities (Pain is display-only; Blood Loss always tips)
        const talkLabel = this._showsDoll(body) ? "Talking" : "Vocalization";
        const rows = [
            { key: "consciousness", label: "Consciousness", value: c.consciousness },
            { key: "moving", label: "Moving", value: c.moving },
            { key: "manipulation", label: "Manipulation", value: c.manipulation },
            { key: "pain", label: "Pain", value: c.pain },
            { key: "breathing", label: "Breathing", value: c.breathing },
            { key: "bloodPumping", label: "Blood Pumping", value: c.bloodPumping },
            { key: "bloodFiltration", label: "Blood Filtration", value: c.bloodFiltration },
            { key: "digestion", label: "Digestion", value: c.digestion },
            { key: "sight", label: "Sight", value: c.sight },
            { key: "hearing", label: "Hearing", value: c.hearing },
            { key: "talking", label: talkLabel, value: c.talking },
            { key: "eating", label: "Eating", value: c.eating },
            { key: "bloodLoss", label: "Blood Loss", value: c.bloodLoss }
        ];

        this._ensureCapRows(rows.length);
        for (let i = 0; i < rows.length; i++) {
            const def = rows[i];
            const row = this._capRows[i];
            row.setText(`${def.label}: ${pct(def.value)}`);
            row._capKey = def.key;
            row._capValue = def.value;
            const canTip = !!def.key && (
                def.key === "bloodLoss"
                || (def.key === "pain" ? def.value > 0.001 : def.value < 0.999)
            );
            if (row.input) row.input.enabled = canTip;
            if (row.input?.hitArea?.setSize) {
                row.input.hitArea.setSize(Math.max(row.width, 1), Math.max(row.height, 1));
            }
            if (!canTip && this.scene._tooltipTarget === row) this.scene.hideTooltip?.();
        }

        /** @type {{ text: string, bleeding?: boolean, tip?: string|null }[]} */
        const lines = [];
        let any = false;
        /** @type {Object.<string, { partName: string, tended?: boolean }>} */
        const stumpByPart = {};
        for (const d of body.destroyedBleed || []) {
            if (d?.partName) stumpByPart[d.partName] = d;
        }
        const fmtBleedDay = (perDay) => {
            if (!(perDay > 0)) return null;
            return `Bleeding: ${Math.round(perDay * 100)}%/day`;
        };
        const pushStumpBleed = (partName) => {
            const stump = stumpByPart[partName];
            if (!stump) return;
            delete stumpByPart[partName];
            // Tended stumps don't list a wound — just "Part: Destroyed" remains
            if (stump.tended) return;
            const tipLines = [];
            if (typeof BodyHealing !== "undefined") {
                const line = fmtBleedDay(BodyHealing.stumpBleedPerDay(stump));
                if (line) tipLines.push(line);
            }
            const label = typeof BodyHealing !== "undefined"
                ? BodyHealing.destroyedBleedLabel(body, partName)
                : "missing (bleeding)";
            lines.push({
                text: `  ${label}`,
                bleeding: true,
                tip: tipLines.length ? tipLines.join("\n") : null
            });
        };
        const pushInjuries = (part) => {
            for (const inj of part.injuries) {
                const bleeding = !inj.permanent && !!inj.bleeding && !inj.tended;
                const tag = inj.permanent ? "scar" : inj.tended ? "tended" : bleeding ? "bleeding" : "";
                const tipLines = [];
                if (bleeding && typeof BodyHealing !== "undefined") {
                    const line = fmtBleedDay(BodyHealing.injuryBleedPerDay(inj, part));
                    if (line) tipLines.push(line);
                }
                if (inj.tended && !inj.permanent) {
                    const q = Phaser.Math.Clamp(Number(inj.tendQuality) || 0, 0, 1);
                    tipLines.push(`Tend quality: ${Math.round(q * 100)}%`);
                }
                if (inj.sourceLabel) tipLines.push(`From ${inj.sourceLabel}`);
                lines.push({
                    text: `  ${inj.severity.toFixed(1)} ${inj.name}${tag ? ` (${tag})` : ""}`,
                    bleeding,
                    tip: tipLines.length ? tipLines.join("\n") : null
                });
            }
        };
        for (const part of Object.values(body.parts())) {
            if (part.isDead()) {
                // Destroyed parts: header + stump only (no old cut list)
                const tip = part.destroySource ? `From ${part.destroySource}` : null;
                lines.push({ text: `${part.name}: Destroyed`, destroyed: true, tip });
                pushStumpBleed(part.name);
                any = true;
                continue;
            }
            // Keep injury history even when a parent limb is destroyed (toes, etc.).
            if (!part.injuries.length) continue;
            any = true;
            lines.push({ text: `${part.name}: ${part.hp().toFixed(1)}/${Number(part.mhp).toFixed(1)}` });
            pushInjuries(part);
        }
        for (const stump of Object.values(stumpByPart)) {
            lines.push({ text: `${stump.partName}: Destroyed`, destroyed: true });
            pushStumpBleed(stump.partName);
            any = true;
        }

        // Whole-body hediffs (food poisoning, malnutrition, …)
        const hediffs = body.hediffs || [];
        if (hediffs.length) {
            any = true;
            lines.push({ text: "Whole Body:" });
            for (const h of hediffs) {
                const label = typeof Hediffs !== "undefined"
                    ? Hediffs.displayLabel(h, this.scene)
                    : h.id;
                const tip = typeof Hediffs !== "undefined"
                    ? Hediffs.tooltipFor(h, this.scene)
                    : null;
                lines.push({ text: `  ${label}`, tip });
            }
        }

        if (!any) lines.push({ text: "None" });
        this._setInjLines(lines);
        // Keep scroll position across refreshes (tickBodySystems); clamp in layout()

        this.layout();
        // Doll tints are the heavy bit — do them next frame so the panel opens immediately
        this._queueOverlayRefresh();

        // Live-update open tooltip (hediff severity, capacity explain, …)
        const tipTarget = this.scene._tooltipTarget;
        if (tipTarget && this.scene.tooltip?.visible) {
            const onInj = this._injLines.some((row) => row.text === tipTarget);
            const onCap = this._capRows.includes(tipTarget);
            if (onInj || onCap) this.scene.refreshTooltip?.();
        }
    }

    _queueOverlayRefresh() {
        if (this._overlayRefreshQueued) return;
        this._overlayRefreshQueued = true;
        this.scene.time.delayedCall(0, () => {
            this._overlayRefreshQueued = false;
            if (!this.visible) return;
            const body = this._inspectBody || this.scene.player?.anatomy;
            if (body) this._refreshPartOverlays(body);
        });
    }

    _refreshPartOverlays(body) {
        if (!this._showsDoll(body)) {
            for (const img of Object.values(this._partOverlays)) {
                if (img.visible) img.setVisible(false);
                img._lastTint = null;
            }
            return;
        }
        for (const name of HealthPanel.PART_OVERLAY_ORDER) {
            const img = this._partOverlays[name];
            if (!img) continue;
            const part = body.part(name);
            if (!part) {
                if (img.visible) img.setVisible(false);
                img._lastTint = null;
                continue;
            }
            const frac = typeof part.hpFraction === "function" ? part.hpFraction() : part.efficiency();
            const damaged = part.isDead() || part.damageSeverity() > 0 || frac < 0.999;
            if (!damaged) {
                if (img.visible) img.setVisible(false);
                img._lastTint = null;
                continue;
            }
            const color = this._partColor(part);
            if (!img.visible || img._lastTint !== color) {
                img.setVisible(true);
                img.setTintFill(color);
                img._lastTint = color;
            }
        }
    }
}
