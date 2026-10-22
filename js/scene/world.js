/**
 * SceneMain prototype methods (world).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainWorld = {

    createClockDisplay() {
        this.clockText = this.add.text(0, 0, "", {
            fontSize: "16px",
            fontFamily: PIXEL_UI_FONT,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 2
        }).setOrigin(0.5, 0).setDepth(9998);
        this.uiLayer.add(this.clockText);
        this.updateClockText();

        this.fpsText = this.add.text(0, 0, "", {
            fontSize: "16px",
            fontFamily: PIXEL_UI_FONT,
            color: "#a8e6a0",
            stroke: "#000000",
            strokeThickness: 2
        }).setOrigin(0.5, 0).setDepth(9998).setScrollFactor(0);
        this.uiLayer.add(this.fpsText);
        this._fpsVisible = false;
        this.fpsText.setVisible(false);
        /** @type {{ t: number, d: number }[]} frame deltas in the last ~1s */
        this._fpsSamples = [];
        this._fpsUiAcc = 0;

        // /debug location — blue X + red Y above the top inventory row
        const locStyle = {
            fontSize: "16px",
            fontFamily: PIXEL_UI_FONT,
            stroke: "#000000",
            strokeThickness: 2
        };
        this.locXText = this.add.text(0, 0, "", { ...locStyle, color: "#4da6ff" })
            .setOrigin(1, 1).setDepth(9998).setScrollFactor(0).setVisible(false);
        this.locYText = this.add.text(0, 0, "", { ...locStyle, color: "#ff5555" })
            .setOrigin(0, 1).setDepth(9998).setScrollFactor(0).setVisible(false);
        this.uiLayer.add(this.locXText);
        this.uiLayer.add(this.locYText);
        this._locationDebugVisible = false;
    },

    setFpsMeter(on) {
        this._fpsVisible = !!on;
        this.fpsText?.setVisible(this._fpsVisible);
        this._fpsSamples = [];
        this._fpsUiAcc = 0;
        if (!this._fpsVisible) {
            this.fpsText?.setText("");
        } else {
            // applyUiScale needs craft/UI buttons — skip if create() isn't finished yet
            if (this.craftContainer) this.applyUiScale?.();
            this.fpsText?.setText(this._fpsPlaceholderText());
        }
        return this._fpsVisible;
    },

    /** Dedicated MP: wildlife is server-owned — client mob count is meaningless. */
    _fpsShowsMobs() {
        return !(this.simAuth());
    },

    _fpsPlaceholderText() {
        return this._fpsShowsMobs() ? "— fps · 0 mobs" : "— fps";
    },

    setLocationDebug(on) {
        this._locationDebugVisible = !!on;
        this.locXText?.setVisible(this._locationDebugVisible);
        this.locYText?.setVisible(this._locationDebugVisible);
        if (!this._locationDebugVisible) {
            this.locXText?.setText("");
            this.locYText?.setText("");
        } else {
            if (this.craftContainer) this.applyUiScale?.();
            this.updateLocationDebug?.();
        }
        return this._locationDebugVisible;
    },

    updateLocationDebug() {
        if (!this._locationDebugVisible || !this.locXText || !this.locYText) return;
        const p = this.player;
        if (!p) {
            this.locXText.setText("—");
            this.locYText.setText(" —");
            return;
        }
        // Tile space at sprite bottom-middle (origin is bottom-left).
        // Keep fractional offset; don't round/floor/ceil.
        const ts = this.tileSize || 16;
        const w = p.displayWidth || p.width || ts;
        const feetX = (p.x + w * 0.5) / ts;
        const feetY = p.y / ts;
        const fmt = (v) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return "—";
            return n.toFixed(3);
        };
        this.locXText.setText(fmt(feetX));
        this.locYText.setText(` ${fmt(feetY)}`);
    },

    _layoutLocationDebug() {
        if (!this.locXText || !this.locYText) return;
        const s = this.uiScale || 1;
        const cx = this.scale.width / 2;
        const slotW = this.hotbar?.slotW || Math.round(32 * s);
        // Backpack slots sit one row above the hotbar; keep the coords above that row.
        const overflow0 = this.hotbar?.overflowSlots?.[0];
        const slot0 = this.hotbar?.slots?.[0];
        const anchor = overflow0 || slot0;
        const slotTop = anchor
            ? anchor.y - slotW
            : this.scale.height - Math.round(48 * s);
        const y = slotTop - Math.round(4 * s);
        if (typeof applyPixelUiFont === "function") {
            applyPixelUiFont(this.locXText, 16, s);
            applyPixelUiFont(this.locYText, 16, s);
        } else {
            const fs = pixelUiFontSize(16, s);
            this.locXText.setFontSize(`${fs}px`);
            this.locYText.setFontSize(`${fs}px`);
        }
        this.locXText.setStroke("#000000", Math.max(2, Math.round(2 * s)));
        this.locYText.setStroke("#000000", Math.max(2, Math.round(2 * s)));
        crispUiText(this.locXText);
        crispUiText(this.locYText);
        placeUiText(this.locXText, cx, y, 1, 1);
        placeUiText(this.locYText, cx, y, 0, 1);
    },

    updateFpsMeter(delta) {
        if (!this._fpsVisible || !this.fpsText) return;
        const d = Math.max(0.001, Number(delta) || 16);
        const now = this.time?.now || performance.now();
        this._fpsSamples.push({ t: now, d });
        // Keep a short window so dips show up; not Phaser's slow EMA
        const windowMs = 1000;
        while (this._fpsSamples.length > 1 && now - this._fpsSamples[0].t > windowMs) {
            this._fpsSamples.shift();
        }

        this._fpsUiAcc += d;
        if (this._fpsUiAcc < 100 && this._fpsSamples.length > 3) return;
        this._fpsUiAcc = 0;

        let sum = 0;
        let minFps = Infinity;
        for (let i = 0; i < this._fpsSamples.length; i++) {
            const sd = this._fpsSamples[i].d;
            sum += sd;
            const f = 1000 / sd;
            if (f < minFps) minFps = f;
        }
        const n = this._fpsSamples.length;
        const avg = n > 0 && sum > 0 ? Math.round((n * 1000) / sum) : 0;
        const min = Number.isFinite(minFps) ? Math.round(minFps) : avg;
        let next;
        if (this._fpsShowsMobs()) {
            const mobs = this.mobs?.countActive?.(true) ?? 0;
            next = `${avg} fps (min ${min}) · ${mobs} mobs`;
        } else {
            next = `${avg} fps (min ${min})`;
        }
        if (this.fpsText.text !== next) this.fpsText.setText(next);
    },

    /** FPS sits immediately under the clock. */
    _layoutFpsMeter() {
        if (!this.fpsText) return;
        const s = this.uiScale || 1;
        const pad = Math.round(8 * s);
        const clockBottom = this.clockText
            ? pad + Math.round(this.clockText.displayHeight || this.clockText.height || pixelUiFontSize(16, s))
            : pad;
        placeUiText(this.fpsText, this.scale.width / 2, clockBottom + Math.round(2 * s), 0.5, 0);
    },

    createLightVeil() {
        // Canvas overlay: destination-out punches real holes. Graphics ERASE and
        // RenderTexture.erase(stamp) both failed (solid circles / no holes).
        const key = "__night_veil";
        if (this.lightGfx?.destroy) this.lightGfx.destroy();
        if (!this.textures.exists(key)) this.textures.createCanvas(key, 64, 64);
        this._lightCanvasKey = key;
        this.lightGfx = this.add.image(0, 0, key).setOrigin(0, 0).setDepth(50);
        this.veilLayer?.add(this.lightGfx);
        this._uiCam.ignore(this.lightGfx);
        this.lightDirty = true;
        this._lightHadFlame = false;
        this._lightRadiusAnimating = false;
        this._fireLightEase = new Map();
        this.updateLightVeil();
    },

    markLightDirty() {
        this.lightDirty = true;
        this._campfireDirty = true;
    },

    updateTimeTint() {
        this.markLightDirty();
        this.updateLightVeil();
    },

    getCampfires() {
        const now = this.time?.now || 0;
        if (!this._campfireDirty && this._campfireCache && now - (this._campfireAt || 0) < 250) {
            return this._campfireCache;
        }
        const list = [];
        for (const chunk of this._loadedChunks || []) {
            if (!chunk.isLoaded) continue;
            for (const thing of chunk.things?.getChildren?.() || []) {
                if (thing.active && thing.meta?.campfire && typeof thing.burnMinute === "function") {
                    list.push(thing);
                }
            }
        }
        this._campfireCache = list;
        this._campfireAt = now;
        this._campfireDirty = false;
        return list;
    },

    /** Soft round brush. Stretched over each fire instead of a new gradient. */
    _lightBrush() {
        if (this._lightBrushCanvas) return this._lightBrushCanvas;
        if (typeof document === "undefined") return null;
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const g = canvas.getContext("2d");
        if (!g) return null;
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, "rgba(0,0,0,1)");
        grd.addColorStop(0.4, "rgba(0,0,0,0.85)");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd;
        g.fillRect(0, 0, 64, 64);
        this._lightBrushCanvas = canvas;
        return canvas;
    },

    updateLightVeil() {
        const img = this.lightGfx;
        const key = this._lightCanvasKey;
        if (!img || !key || !this.textures.exists(key)) return;
        const canvasTex = this.textures.get(key);
        const ctx = canvasTex?.context || canvasTex?.canvas?.getContext?.("2d");
        if (!ctx) return;

        if (this.lightDirty) {
            this.lightDirty = false;
            this._lightVersion = (this._lightVersion || 0) + 1;
        }

        const cam = this.cameras.main;
        const ts = this.tileSize;
        const now = this.time?.now ?? 0;
        const animating = this._lightRadiusAnimating;
        // Flicker is visible at 8 Hz; 20 Hz canvasTex.refresh hitch walking.
        const flameTick = (this._lightHadFlame || animating)
            ? Math.floor(now / 120)
            : 0;

        const { color, darkness: skyDark, wash: skyWash } = getTimeOfDayTint(this.gameMinutes);
        const r = (color >> 16) & 255;
        const g = (color >> 8) & 255;
        const b = color & 255;

        // Midday wash is a 2% tint. Keeping the veil up for that still
        // fullscreen-blends every frame, and a campfire then repaints the
        // canvas at flicker rate. That is the settlement hitch.
        if (skyDark < 0.03 && skyWash < 0.03) {
            img.setVisible(false);
            this._lightHadFlame = false;
            this._lightRadiusAnimating = false;
            this._lightOrigin = null;
            return;
        }

        const viewX0 = Math.floor(cam.worldView.x / ts);
        const viewY0 = Math.floor(cam.worldView.y / ts);
        const viewX1 = Math.ceil(cam.worldView.right / ts);
        const viewY1 = Math.ceil(cam.worldView.bottom / ts);
        const origin = this._lightOrigin;
        const edge = 2;
        const lightsChanged = (this._lightDrawnVersion !== (this._lightVersion || 0))
            || this._lightDrawnMinutes !== this.gameMinutes
            || this._lightDrawnFlame !== flameTick;
        const offPad = !origin
            || viewX0 < origin.x0 + edge
            || viewY0 < origin.y0 + edge
            || viewX1 > origin.x1 - edge
            || viewY1 > origin.y1 - edge;
        if (!lightsChanged && !offPad) return;

        let x0;
        let y0;
        let x1;
        let y1;
        if (origin && !offPad) {
            x0 = origin.x0;
            y0 = origin.y0;
            x1 = origin.x1;
            y1 = origin.y1;
        } else {
            const pad = 8;
            x0 = viewX0 - pad;
            y0 = viewY0 - pad;
            x1 = viewX1 + pad;
            y1 = viewY1 + pad;
            this._lightOrigin = { x0, y0, x1, y1 };
        }
        this._lightDrawnVersion = this._lightVersion || 0;
        this._lightDrawnMinutes = this.gameMinutes;
        this._lightDrawnFlame = flameTick;
        const wx = x0 * ts;
        const wy = y0 * ts;
        let ww = Math.max(ts, (x1 - x0) * ts);
        let wh = Math.max(ts, (y1 - y0) * ts);
        ww = Math.ceil(ww / 2) * 2;
        wh = Math.ceil(wh / 2) * 2;

        // Soft veil. Half resolution is four times less canvas work when a
        // fire flickers, and the quad still covers the same world rect.
        const cw = Math.max(2, Math.round(ww * 0.5));
        const ch = Math.max(2, Math.round(wh * 0.5));
        if (canvasTex.width !== cw || canvasTex.height !== ch) {
            canvasTex.setSize(cw, ch);
            img.setTexture(key);
        }
        img.setPosition(wx, wy);
        img.setDisplaySize(ww, wh);
        img.setVisible(true);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, cw, ch);
        ctx.setTransform(cw / ww, 0, 0, ch / wh, 0, 0);
        if (skyDark >= 0.02) {
            ctx.fillStyle = `rgba(6, 10, 20, ${Math.min(0.96, skyDark)})`;
            ctx.fillRect(0, 0, ww, wh);
        }
        if (skyWash >= 0.02) {
            ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(0.28, skyWash)})`;
            ctx.fillRect(0, 0, ww, wh);
        }

        let hadFlame = false;
        let radiusAnimating = false;
        if (typeof Fire !== "undefined") {
            const punches = [];
            const zoom = this.worldZoom || this.cameras.main?.zoom || 1;
            const ease = this._fireLightEase || (this._fireLightEase = new Map());
            for (const st of ease.values()) st.seen = false;
            for (const fire of this.getCampfires()) {
                const target = Fire.lightRadiusForEntry(fire.entry);
                const key = fire.entry?.uid || `${Math.round(fire.x)},${Math.round(fire.y)}`;
                let st = ease.get(key);
                if (!st) {
                    st = { shown: target, at: now };
                    ease.set(key, st);
                } else {
                    const dt = Math.max(0, Math.min(100, now - st.at));
                    st.shown = (typeof Light !== "undefined" && Light.smoothRadius)
                        ? Light.smoothRadius(st.shown, target, dt)
                        : target;
                    st.at = now;
                }
                st.seen = true;
                if (Math.abs(st.shown - target) > 0.03) radiusAnimating = true;
                const tiles = st.shown;
                if (!(tiles > 0.02)) continue;
                const kind = (typeof Light !== "undefined" && Light.kindOf)
                    ? Light.kindOf(fire.meta, Light.KIND.FLAME)
                    : "flame";
                const flick = (typeof Light !== "undefined" && Light.flicker)
                    ? Light.flicker(kind, now, Light.seedOf(fire.x, fire.y, fire.entry?.uid))
                    : { radiusMul: 1, core: 1, x: 0, y: 0, radiusPx: 0 };
                const flame = typeof Light !== "undefined" && Light.isFlame
                    ? Light.isFlame(kind)
                    : kind === "flame";
                if (flame) hadFlame = true;
                const dip = (flick.radiusPx || 0) / zoom;
                punches.push({
                    kind,
                    flame,
                    rad: Math.max(0, tiles * (flick.radiusMul || 1) * ts - dip),
                    fx: fire.x - wx + (flick.x || 0) * ts,
                    fy: fire.y - ts * 0.5 - wy + (flick.y || 0) * ts,
                    core: flick.core || 1
                });
            }
            for (const [k, st] of ease) {
                if (!st.seen) ease.delete(k);
            }
            // A fresh radial gradient per fire is the night hitch. Twelve
            // campfires were rebuilding that shader every flicker. One brush,
            // stretched to each radius, is the same falloff.
            const brush = this._lightBrush();
            ctx.globalCompositeOperation = "destination-out";
            if (brush) {
                ctx.imageSmoothingEnabled = true;
                for (const p of punches) {
                    if (!(p.rad > 0)) continue;
                    const d = p.rad * 2;
                    ctx.globalAlpha = Math.max(0, Math.min(1, p.core || 1));
                    ctx.drawImage(brush, p.fx - p.rad, p.fy - p.rad, d, d);
                }
                ctx.imageSmoothingEnabled = false;
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
        }
        this._lightHadFlame = hadFlame;
        this._lightRadiusAnimating = radiusAnimating;
        canvasTex.refresh();
    },

    worldToTile(wx, wy) {
        return {
            tx: Math.floor(wx / this.tileSize),
            ty: Math.floor(wy / this.tileSize)
        };
    },

    tileCenter(tx, ty) {
        return {
            x: tx * this.tileSize + this.tileSize / 2,
            y: ty * this.tileSize + this.tileSize
        };
    },

    getChunkAtWorld(wx, wy) {
        const px = this.chunkPx();
        return this.chunks[this.getKey(Math.floor(wx / px), Math.floor(wy / px))] || null;
    },

    /** Hover tooltip for non-lootable Things that define `tooltip` lines in Things.json. */
    wireThingTooltip(thing) {
        const linesOf = () => {
            if (Array.isArray(thing.entry?.tooltip) && thing.entry.tooltip.length) {
                return thing.entry.tooltip;
            }
            return thing.meta?.tooltip || [];
        };
        if (!linesOf().length) return;
        thing.setInteractive({ cursor: "pointer", pixelPerfect: false });
        thing.on("pointerover", (pointer) => {
            this.showTooltip(
                () => linesOf().join("\n"),
                pointer.x,
                pointer.y,
                thing
            );
        });
        thing.on("pointerout", () => {
            if (this._hoverTarget === thing) this._hoverTarget = null;
            if (this._tooltipTarget === thing) this.hideTooltip();
        });
    },

    wireDigTooltip(thing) {
        if (!thing?.meta?.diggable?.item) return;
        // Don't bake cursor: "default" — Phaser applies GO.cursor on native over
        // and that flashes the arrow when moving across a clay bank.
        thing.setInteractive({ pixelPerfect: false });
        if (thing.input) thing.input.cursor = "";
        if (thing._digTooltipWired) return;
        thing._digTooltipWired = true;
        thing.on("pointerover", (pointer) => {
            this.input?.setDefaultCursor?.(this._cursorFor?.(thing) || "default");
            this.showTooltip(
                () => this._digTooltipText(thing),
                pointer.x,
                pointer.y,
                thing
            );
        });
        thing.on("pointerout", () => {
            if (this._hoverTarget === thing) this._hoverTarget = null;
            if (this._tooltipTarget === thing) this.hideTooltip();
        });
    },

    _worldDisplayName() {
        const n = this.worldName || this.welcome?.worldName;
        return (n && String(n).trim()) || "World";
    },

    _spawnSignTooltip() {
        return [`Welcome to ${this._worldDisplayName()}!`];
    },

    /** Rock: click to knap + hover tip while holding pebble/flint. */
    wireRockKnapping(thing) {
        if (!thing || thing.meta?.id !== "rock") return;
        // Default arrow; _cursorFor switches to pointer only when knap tip is active
        thing.setInteractive({ cursor: "default", pixelPerfect: false });
        thing.on("pointerdown", (pointer) => {
            if (this._gamePaused) return;
            if (pointer.rightButtonDown?.()) return;
            if (this.pointerOnRockAdd?.(pointer) || this.pointerOnRockBills?.(pointer)) return;
            if (this.pointerOverWorldUi?.(pointer)) return;
            if (this._rockKnapTooltipText()) {
                this.knappingPanel?.tryOpenAtRock?.(thing);
                return;
            }
            if (!this._rockManageable?.(thing)) return;
            if (this._rockStationThing === thing) this._closeRockStation?.();
            else this._openRockStation?.(thing);
        });
        thing.on("pointerover", (pointer) => {
            this.showTooltip(
                () => {
                    const name = (typeof Stone !== "undefined" && Stone.rockLabel)
                        ? Stone.rockLabel(thing.entry)
                        : (thing.meta?.name || "Rock");
                    const hint = this._rockKnapTooltipText();
                    if (hint) return `${name}\n${hint}`;
                    if (this._rockManageable?.(thing)) return name;
                    return "";
                },
                pointer.x,
                pointer.y,
                thing
            );
        });
        thing.on("pointerout", () => {
            if (this._hoverTarget === thing) this._hoverTarget = null;
            if (this._tooltipTarget === thing) this.hideTooltip();
        });
    },

    _rockKnapTooltipText() {
        const held = this.player?.getHeldItem?.();
        if (!held || !(held.quantity > 0)) return "";
        if ((held.knapIconData || held.toolClass) && (held.id === "stone_tool" || held.id === "flint_tool")) {
            return "Click to reshape";
        }
        const meta = this.getItem(held.id);
        if (!meta?.knapping?.material) return "";
        return "Click to knap";
    },

    /** Skinworking bench (and later craft stations): click opens the C-key craft menu, filtered. */
    wireCraftStation(thing) {
        if (!thing || !thing.meta?.craftStation) return;
        thing.setInteractive({ cursor: "pointer" });
        thing.on("pointerover", (pointer) => {
            this.showTooltip(
                () => thing.tooltipText?.() || thing.meta?.name || "Craft",
                pointer.x,
                pointer.y,
                thing
            );
        });
        thing.on("pointerout", () => {
            if (this._hoverTarget === thing) this._hoverTarget = null;
            if (this._tooltipTarget === thing) this.hideTooltip();
        });
        thing.on("pointerdown", (pointer) => {
            if (pointer.rightButtonDown()) return;
            if (this.restBlocksWorldUi?.()) return;
            if (this.pointerOnCraftTake?.(pointer) || this.pointerOnCraftSettle?.(pointer)
                || this.pointerOnCraftBills?.(pointer) || this.pointerOnCraftRotate?.(pointer)) return;
            if (this._pointerOverCraftMenu?.(pointer)) return;
            if (this.pointerOverWorldUi?.(pointer)) return;
            if (!thing.inRange?.()) return;
            this.toggleCraftStationMenu(thing);
        });
        thing.on("destroy", () => {
            if (this._isSameCraftStation(thing)) this.closeCraftStationMenu();
        });
    },

    /** World object UIs (campfire, storage, corpse, stations) while lying in a lean-to. */
    restBlocksWorldUi() {
        return !!(this.player?._resting && !this.player?._bodyDead);
    },

    /** The bunk you're currently occupying. */
    _isOwnRestLeanTo(obj) {
        if (typeof LeanTo === "undefined" || !(obj instanceof LeanTo)) return false;
        const pawn = this.player;
        if (!pawn?._resting || pawn._bodyDead) return false;
        const uid = pawn.lastSleep?.uid;
        return !!(uid && obj.entry?.uid === uid);
    },

    /**
     * Screen HUD under the pointer. The occupied lean-to AABB is large and often
     * covers Craft/hotbar/health; skip the bunk there so those keep the finger.
     */
    _pointerOverHudChrome(pointer) {
        if (!pointer) return false;
        const over = (obj) => {
            if (!obj?.active || obj.visible === false) return false;
            const b = obj.getBounds?.();
            return !!(b && Phaser.Geom.Rectangle.Contains(b, pointer.x, pointer.y));
        };
        if (over(this.craft) || over(this.healthBtn) || over(this.equipmentBtn) || over(this.help)) {
            return true;
        }
        if (over(this.painBarZone) || over(this.kcBarZone) || over(this.weightBarZone)) return true;
        for (const slot of this.hotbar?.slots || []) {
            if (over(slot)) return true;
        }
        for (const slot of this.hotbar?.overflowSlots || []) {
            if (over(slot)) return true;
        }
        if (this.craftMenuVisible && over(this.craftContainer)) return true;
        if (this.partyPanel?.visible && this.partyPanel.containsPointer?.(pointer)) return true;
        if (this.healthPanel?.visible && this.healthPanel.containsPointer?.(pointer)) return true;
        if (this.equipmentPanel?.visible && this.equipmentPanel.containsPointer?.(pointer)) return true;
        if (this.settlementSys?.hudContains?.(pointer)) return true;
        return false;
    },

    _skipOwnRestLeanTo(obj, pointer) {
        return !!(this._isOwnRestLeanTo(obj) && this._pointerOverHudChrome(pointer));
    },

    _closeWorldUisForRest() {
        this.campfirePanel?.close?.();
        this.storagePanel?.close?.();
        this.paintingCirclePanel?.close?.();
        this.corpsePanel?.close?.();
        this.closeCraftStationMenu();
        this.knappingPanel?.close?.();
        this.clayFormingPanel?.close?.();
    },

    /**
     * True when the pointer is over world-anchored UI (corpse/campfire panels).
     * World click handlers must bail so rocks/corpses behind the chrome don't fire.
     */
    pointerOverWorldUi(pointer) {
        if (!pointer) return false;
        if (this.corpsePanel?.containsPointer?.(pointer)) return true;
        if (this.campfirePanel?.containsPointer?.(pointer)) return true;
        if (this.leanToPanel?.containsPointer?.(pointer)) return true;
        if (this.storagePanel?.containsPointer?.(pointer)) return true;
        if (this.settlementPanel?.containsPointer?.(pointer)) return true;
        if (this.resourceSummaryPanel?.containsPointer?.(pointer)) return true;
        if (this.researchTreePanel?.containsPointer?.(pointer)) return true;
        if (this.billsPanel?.containsPointer?.(pointer)) return true;
        if (this.storageFilterPanel?.containsPointer?.(pointer)) return true;
        if (this.fuelFilterPanel?.containsPointer?.(pointer)) return true;
        if (this.pigmentFilterPanel?.containsPointer?.(pointer)) return true;
        if (this.paintingCirclePanel?.containsPointer?.(pointer)) return true;
        if (this.settlementSys?.hudContains?.(pointer)) return true;
        if (this.pointerOnCraftTake?.(pointer)) return true;
        if (this.pointerOnCraftSettle?.(pointer)) return true;
        if (this.pointerOnCraftBills?.(pointer)) return true;
        if (this.pointerOnCraftRotate?.(pointer)) return true;
        if (this._pointerOverCraftMenu?.(pointer)) return true;
        if (this.partyPanel?.containsPointer?.(pointer)) return true;
        if (this.healthPanel?.containsPointer?.(pointer)) return true;
        if (this.equipmentPanel?.containsPointer?.(pointer)) return true;
        return false;
    },

    _pointerOverCraftMenu(pointer) {
        if (!this.craftMenuVisible || !this.craftContainer?.visible || !pointer) return false;
        // Screen-space HUD next to the C button (not camera-transformed getBounds).
        const d = this._craftMenuData;
        const x = this.craftContainer.x;
        const y = this.craftContainer.y;
        const w = d?.gridW || 0;
        const h = d?.gridH || 0;
        if (w > 0 && h > 0) {
            return pointer.x >= x && pointer.x <= x + w
                && pointer.y >= y && pointer.y <= y + h;
        }
        if (!this.craftContainer.getBounds) return false;
        return Phaser.Geom.Rectangle.Contains(this.craftContainer.getBounds(), pointer.x, pointer.y);
    },

    _craftSlotAtPointer(pointer) {
        if (!this.craftMenuVisible || !pointer || !Array.isArray(this._data)) return null;
        const pt = pointer;
        for (const row of this._data) {
            const slot = row?.slot;
            if (!slot?.active || slot.visible === false) continue;
            const b = slot.getBounds?.();
            if (b && Phaser.Geom.Rectangle.Contains(b, pt.x, pt.y)) return slot;
        }
        return null;
    },

    _heldHasDigPower() {
        if (typeof Dig === "undefined") return false;
        const held = this.player?.getHeldItem?.();
        if (!held || !(held.quantity > 0)) return false;
        return Dig.digFraction(held, (id) => this.getItem?.(id)) > 0;
    },

    _digTooltipText(thing) {
        if (typeof Dig === "undefined") return "";
        const held = this.player?.getHeldItem?.();
        if (Dig.depositTooltip) {
            return Dig.depositTooltip(
                thing?.meta,
                thing?.entry,
                held,
                (id) => this.getItem?.(id)
            ) || "";
        }
        if (!this._heldHasDigPower()) return "";
        return Dig.tooltipName?.(thing?.meta, thing?.entry) || thing?.meta?.name || "Clay Deposit";
    },

    /** Load all chunks covering tile coords [-radius, radius]². */
    async _loadSpawnNeighborhood(radius) {
        // Multiplayer: terrain comes from the server — don't locally generate a parallel world
        if (this.isNet) return;
        const px = this.chunkPx();
        for (let ty = -radius; ty <= radius; ty++) {
            for (let tx = -radius; tx <= radius; tx++) {
                const { x, y } = this.tileCenter(tx, ty);
                const cx = Math.floor(x / px);
                const cy = Math.floor((y - 1) / px);
                const key = this.getKey(cx, cy);
                if (!this.chunks[key]) this.chunks[key] = new Chunk(this, cx, cy);
                await this.chunks[key].load();
            }
        }
    },

    /** Tile keys occupied by things / lootables in loaded chunks. */
    _spawnOccupiedTiles() {
        const occupied = new Set();
        const ts = this.tileSize || 16;
        const mark = (entry) => {
            if (!entry) return;
            const def = this.getThing?.(entry.id);
            if (typeof Place !== "undefined" && Place.occupyTiles) {
                for (const t of Place.occupyTiles(entry, ts, def)) {
                    occupied.add(`${t.tx},${t.ty}`);
                }
                return;
            }
            const { tx, ty } = this.worldToTile(entry.x, entry.y - 1);
            occupied.add(`${tx},${ty}`);
        };
        for (const chunk of Object.values(this.chunks)) {
            for (const t of chunk.meta?.things || []) mark(t);
            for (const t of chunk.meta?.lootableThings || []) {
                if (!t?.gone) mark(t);
            }
        }
        return occupied;
    },

    _tileWalkable(tx, ty) {
        const cs = this.chunkSize;
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk?.isGenerated) return false;
        const localX = tx - chunk.x * cs;
        const localY = ty - chunk.y * cs;
        if (localX < 0 || localY < 0 || localX >= cs || localY >= cs) return false;
        const tile = chunk.meta.tiles[localX + localY * cs];
        if (!tile || tile === "water" || tile === "ice") return false;
        return true;
    },

    /**
     * Cast line from the pawn into the water tile, with the grub on the end.
     * Drawn after the camera snap so it stays on the sprite.
     */
    _tickFishLines() {
        if (!this._fishLines) this._fishLines = new Map();
        const live = new Set();
        const pawns = [];
        const push = (pawn) => {
            if (!pawn?.active || pawn._bodyDead) return;
            if (pawn._netWorkChannel?.kind !== "fish") return;
            const id = pawn.pawnId || pawn.id;
            if (!id || live.has(id)) return;
            live.add(id);
            pawns.push(pawn);
        };
        push(this.player);
        for (const pawn of this.party || []) push(pawn);
        for (const pawn of this.settlers || []) push(pawn);
        for (const pawn of pawns) this._drawFishLine(pawn);
        for (const [id, rec] of this._fishLines) {
            if (live.has(id)) continue;
            rec.gfx?.destroy();
            rec.bait?.destroy();
            this._fishLines.delete(id);
        }
    },

    _fishLineColor(pawn) {
        const held = pawn?.getHeldItem?.();
        const raw = held ? this.getItem?.(held.id)?.lineColor : null;
        if (typeof raw === "string" && /^#?[0-9a-fA-F]{6}$/.test(raw)) {
            return parseInt(raw.replace("#", ""), 16);
        }
        return 0x4dab36;
    },

    _fishHand(pawn) {
        const w = pawn.width || 16;
        const h = pawn.height || 16;
        const ch = pawn._netWorkChannel;
        let face = pawn.facing || ch?.facing || "down";
        if (
            ch?.kind === "fish"
            && typeof Fish !== "undefined"
            && Fish.facingBobber
            && Number.isFinite(ch.waterTx)
            && Number.isFinite(ch.waterTy)
        ) {
            face = Fish.facingBobber(pawn.x, pawn.y, ch.waterTx, ch.waterTy, face) || face;
        } else if (ch?.kind === "fish" && ch.facing) {
            face = ch.facing;
        }
        if (face === "left") return { x: Math.round(pawn.x + 1), y: Math.round(pawn.y - 8) };
        if (face === "right") return { x: Math.round(pawn.x + w - 2), y: Math.round(pawn.y - 8) };
        if (face === "up") return { x: Math.round(pawn.x + w * 0.5), y: Math.round(pawn.y - h + 3) };
        return { x: Math.round(pawn.x + w * 0.5), y: Math.round(pawn.y - 4) };
    },

    _plotFishPixels(gfx, x0, y0, x1, y1) {
        let x = x0 | 0;
        let y = y0 | 0;
        const destX = x1 | 0;
        const destY = y1 | 0;
        const dx = Math.abs(destX - x);
        const dy = Math.abs(destY - y);
        const sx = x < destX ? 1 : -1;
        const sy = y < destY ? 1 : -1;
        let err = dx - dy;
        for (let n = 0; n < 80; n++) {
            gfx.fillRect(x, y, 1, 1);
            if (x === destX && y === destY) break;
            const e2 = err * 2;
            if (e2 > -dy) {
                err -= dy;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                y += sy;
            }
        }
    },

    _drawFishLine(pawn) {
        const id = pawn.pawnId || pawn.id;
        if (!id) return;
        let rec = this._fishLines.get(id);
        if (!rec?.gfx?.active) {
            const gfx = this.add.graphics();
            this.mainLayer?.add(gfx);
            const bait = this.textures?.exists?.("grub")
                ? this.add.image(0, 0, "grub").setOrigin(0.5, 0.5)
                : null;
            if (bait) this.mainLayer?.add(bait);
            rec = {
                gfx,
                bait,
                thrownAt: null,
                landX: null,
                landY: null,
                color: this._fishLineColor(pawn)
            };
            this._fishLines.set(id, rec);
        }
        const ch = pawn._netWorkChannel;
        const ts = this.tileSize || 16;
        // Land once. A later water tile must not yank the bait after it has settled.
        if (rec.landX == null && Number.isFinite(ch?.waterTx) && Number.isFinite(ch?.waterTy)) {
            rec.landX = ch.waterTx * ts + ts / 2;
            rec.landY = ch.waterTy * ts + ts / 2;
        }
        if (rec.landX == null) return;
        const THROW_MS = 400;
        const ARC = 8;
        const now = performance.now();
        const speed = Number(this.tickSpeed);
        const scale = Number.isFinite(speed) ? Math.max(0, speed) : 1;
        if (rec.thrownAt == null) {
            const alreadyOut = (Number(ch?.progress) || 0) > 0.03;
            rec.thrownAt = now;
            rec.elapsed = alreadyOut ? THROW_MS : 0;
            rec.lastAt = now;
        }
        const wall = Math.min(100, Math.max(0, now - (rec.lastAt || now)));
        rec.lastAt = now;
        rec.elapsed = (rec.elapsed || 0) + wall * scale;
        const hand = this._fishHand(pawn);
        const landX = Math.round(rec.landX);
        const landY = Math.round(rec.landY);
        const t = Math.max(0, Math.min(1, rec.elapsed / THROW_MS));
        const biting = t >= 1 && !!ch?.bite;
        const bob = biting
            ? Math.round(Math.sin((rec.elapsed || 0) / 90) * 3)
            : (t >= 1 && (Math.floor(rec.elapsed / 420) % 2) ? 1 : 0);
        const pointAt = (u) => {
            const e = 1 - (1 - u) * (1 - u);
            const lift = Math.sin(Math.min(1, u) * Math.PI) * ARC * (u < 1 ? 1 : 0);
            return {
                x: Math.round(hand.x + (landX - hand.x) * e),
                y: Math.round(hand.y + (landY - hand.y) * e - lift) + (u >= 1 ? bob : 0)
            };
        };
        const g = rec.gfx;
        g.clear().setPosition(0, 0).setVisible(true);
        g.fillStyle(rec.color, 1);
        const tip = t >= 1
            ? { x: landX, y: landY + bob }
            : pointAt(t);
        if (t >= 1) {
            this._plotFishPixels(g, hand.x, hand.y, tip.x, tip.y);
        } else {
            const dist = Math.max(1, Math.ceil(Math.hypot(landX - hand.x, landY - hand.y)));
            const steps = Math.min(48, dist);
            let prev = pointAt(0);
            for (let i = 1; i <= steps; i++) {
                const u = Math.min(t, i / steps);
                const next = pointAt(u);
                this._plotFishPixels(g, prev.x, prev.y, next.x, next.y);
                prev = next;
                if (u >= t) break;
            }
        }
        const inFront = tip.y >= pawn.y;
        const depth = inFront ? (tip.y | 0) : ((pawn.y | 0) - 1);
        if (biting) {
            g.fillStyle(0xf2f0e6, 1);
            const mx = tip.x;
            const my = tip.y - 8;
            g.fillRect(mx, my, 1, 3);
            g.fillRect(mx, my + 4, 1, 1);
        }
        if (g.depth !== depth) g.setDepth(depth);
        if (rec.bait?.active) {
            rec.bait.setPosition(tip.x, tip.y).setDepth(inFront ? depth + 1 : depth).setVisible(true);
        }
    },

    /**
     * True when a bobber already sits on this water tile.
     * The host sim is checked first; puppets cover a remote client's view.
     */
    _fishTileTaken(tx, ty, exceptPawn) {
        const exceptId = exceptPawn?.pawnId || exceptPawn?.id || null;
        if (this.sim?._bobberOn?.(tx, ty, exceptId)) return true;
        const FishApi = typeof Fish !== "undefined" ? Fish : null;
        if (!FishApi?.bobberTaken) return false;
        const channels = [];
        const add = (id, ch) => {
            if (!ch || !Number.isFinite(Number(ch.waterTx))) return;
            channels.push({
                id: id || null,
                waterTx: ch.waterTx,
                waterTy: ch.waterTy
            });
        };
        const pawnCh = (pawn) => {
            if (!pawn) return;
            const id = pawn.pawnId || pawn.id || null;
            const net = pawn._netWorkChannel;
            if (net?.kind === "fish") add(id, net);
            else if (pawn.fishChannel) add(id, pawn.fishChannel);
        };
        pawnCh(this.player);
        for (const p of this.party || []) pawnCh(p);
        for (const p of this.settlers || []) pawnCh(p);
        for (const entry of this.remotePlayers?.values?.() || []) {
            if (entry?.fish) add(entry.pawnId || entry.id, entry.fish);
        }
        return FishApi.bobberTaken(tx, ty, channels, exceptId);
    },

    /**
     * Press Space with the rod while facing water. The server runs the cast.
     * @returns {boolean} true when this press was a cast attempt
     */
    tryFishCast(pawn = this.player) {
        const player = pawn || this.player;
        if (!player || player._bodyDead || !this.simAuth?.()) return false;
        const held = player.getHeldItem?.();
        if (held?.id !== "flimsy_rod") return false;
        const fishing = player._netWorkChannel?.kind === "fish";
        if (fishing) {
            this._netSendMove?.(true);
            this.net?.sendAction?.({
                type: (typeof NetProtocol !== "undefined" ? NetProtocol.Actions.FISH : "fish"),
                op: player._netWorkChannel.bite ? "hook" : "reel",
                pawnId: player.pawnId || player.id
            });
            return true;
        }
        const WG = typeof WorldGen !== "undefined" ? WorldGen : null;
        const FishApi = typeof Fish !== "undefined" ? Fish : null;
        if (!WG?.tileKeyAt || !FishApi?.castTile) return false;
        const spot = FishApi.castTile(
            player.x,
            player.y,
            player.facing || "down",
            (x, y) => WG.tileKeyAt(x, y)
        );
        if (!spot) return false;
        if (this._fishTileTaken(spot.tx, spot.ty, player)) return false;
        this._netSendMove?.(true);
        this.net?.sendAction?.({
            type: (typeof NetProtocol !== "undefined" ? NetProtocol.Actions.FISH : "fish"),
            tx: spot.tx,
            ty: spot.ty,
            pawnId: player.pawnId || player.id
        });
        return true;
    },

    /** Hover line for the water under the cursor while a rod is held. */
    _fishHoverText(pointer) {
        const player = this.player;
        if (!player || player.getHeldItem?.()?.id !== "flimsy_rod") return null;
        const WG = typeof WorldGen !== "undefined" ? WorldGen : null;
        const FishApi = typeof Fish !== "undefined" ? Fish : null;
        if (!WG?.tileKeyAt || !FishApi?.measure || !FishApi.describe || !this.cameras?.main) return null;
        if (this.pointerOverWorldUi?.(pointer)) return null;
        const wpt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const tile = this.worldToTile(wpt.x, wpt.y);
        if (WG.tileKeyAt(tile.tx, tile.ty) !== "water") return null;
        if (!this._fishHoverCache) this._fishHoverCache = new Map();
        const key = tile.tx + "," + tile.ty;
        let measured = this._fishHoverCache.get(key);
        if (!measured) {
            measured = FishApi.measure(tile.tx, tile.ty, (x, y) => WG.tileKeyAt(x, y) === "water");
            const tiles = measured.tiles?.length ? measured.tiles : [[tile.tx, tile.ty]];
            for (const pair of tiles) this._fishHoverCache.set(pair[0] + "," + pair[1], measured);
        }
        return FishApi.describe(measured, this.sim?.fisheries || null);
    },

    /** True if the world point sits on a water tile. */
    _isWaterAt(wx, wy) {
        const chunk = this.getChunkAtWorld(wx, wy);
        if (!chunk?.isGenerated || !chunk.meta?.tiles) return false;
        const { tx, ty } = this.worldToTile(wx, wy);
        const cs = this.chunkSize;
        const localX = tx - chunk.x * cs;
        const localY = ty - chunk.y * cs;
        if (localX < 0 || localY < 0 || localX >= cs || localY >= cs) return false;
        return chunk.meta.tiles[localX + localY * cs] === "water";
    },

    /** True if the world point sits on a water or ice tile. */
    _isWaterOrIceAt(wx, wy) {
        const chunk = this.getChunkAtWorld(wx, wy);
        if (!chunk?.isGenerated || !chunk.meta?.tiles) return false;
        const { tx, ty } = this.worldToTile(wx, wy);
        const cs = this.chunkSize;
        const localX = tx - chunk.x * cs;
        const localY = ty - chunk.y * cs;
        if (localX < 0 || localY < 0 || localX >= cs || localY >= cs) return false;
        const tile = chunk.meta.tiles[localX + localY * cs];
        return tile === "water" || tile === "ice";
    },

    /** True if the world point sits on an ice tile. */
    _isIceAt(wx, wy) {
        const chunk = this.getChunkAtWorld(wx, wy);
        if (!chunk?.isGenerated || !chunk.meta?.tiles) return false;
        const { tx, ty } = this.worldToTile(wx, wy);
        const cs = this.chunkSize;
        const localX = tx - chunk.x * cs;
        const localY = ty - chunk.y * cs;
        if (localX < 0 || localY < 0 || localX >= cs || localY >= cs) return false;
        return chunk.meta.tiles[localX + localY * cs] === "ice";
    },

    /** Move speed scale for standing in water (ice is not slowed). */
    terrainSpeedMult(wx, wy) {
        const chunk = this.getChunkAtWorld(wx, wy);
        if (!chunk?.isGenerated || !chunk.meta?.tiles) return 1;
        const { tx, ty } = this.worldToTile(wx, wy);
        const cs = this.chunkSize;
        const localX = tx - chunk.x * cs;
        const localY = ty - chunk.y * cs;
        if (localX < 0 || localY < 0 || localX >= cs || localY >= cs) return 1;
        const tile = chunk.meta.tiles[localX + localY * cs];
        return tile === "water" ? 0.5 : 1;
    },

    /**
     * Clear world Things/lootables on a tile (used so the spawn sign can sit at 0,0).
     */
    _clearTileThings(tx, ty) {
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk) return;
        const onTile = (entry) => {
            if (!entry) return false;
            const t = this.worldToTile(entry.x, entry.y - 1);
            return t.tx === tx && t.ty === ty;
        };
        if (chunk.meta.things) {
            chunk.meta.things = chunk.meta.things.filter((t) => !onTile(t));
        }
        if (chunk.meta.lootableThings) {
            chunk.meta.lootableThings = chunk.meta.lootableThings.filter((t) => !onTile(t));
        }
        if (chunk.isLoaded && chunk.things) {
            for (const spr of chunk.things.getChildren().slice()) {
                const t = this.worldToTile(spr.x, spr.y - 1);
                if (t.tx === tx && t.ty === ty) spr.destroy();
            }
        }
    },

    playerFeetTile(player = this.player) {
        if (!player) return null;
        const ts = this.tileSize || 16;
        const w = player.displayWidth || player.width || ts;
        return {
            tx: Math.floor((player.x + w * 0.5) / ts),
            ty: Math.floor(player.y / ts)
        };
    },

    resolveThingDef(raw) {
        const text = String(raw || "").trim();
        if (!text) return null;
        const needle = text.toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
        if (needle === "null" || needle === "none" || needle === "clear") {
            return { clear: true };
        }
        const things = (this.things?.() || []).filter(Boolean);
        return this.getThing?.(needle)
            || things.find((t) => (t.id || "").toLowerCase() === needle)
            || things.find((t) => (t.name || "").toLowerCase().replace(/\s+/g, "_") === needle)
            || things.find((t) => (t.name || "").toLowerCase() === text.toLowerCase().replace(/_/g, " "))
            || null;
    },

    _makeThingEntry(def, x, y) {
        if (!def?.id) return null;
        if (def.lootable) {
            return {
                lootable: true,
                entry: {
                    x, y,
                    id: def.id,
                    uid: `lt_${Math.round(x)}_${Math.round(y)}_${def.id}`
                }
            };
        }
        if (def.campfire) {
            return {
                lootable: false,
                entry: {
                    id: def.id,
                    x, y,
                    uid: `cf_${Math.round(x)}_${Math.round(y)}`,
                    fuel: [null, null],
                    cook: null,
                    catalyst: null,
                    simmer: [null, null, null, null],
                    cookProgress: 0,
                    burnRemaining: 0
                }
            };
        }
        if (def.storage) {
            const entry = {
                id: def.id,
                x, y,
                rot: 0,
                slots: typeof Place !== "undefined"
                    ? Place.emptySlots(def.storage.slots || 1)
                    : [null, null, null, null, null, null, null, null]
            };
            if (typeof Place !== "undefined") Place.ensureStorageEntry(entry, def);
            return { lootable: false, entry };
        }
        if (def.craftStation) {
            const entry = { id: def.id, x, y, rot: 0 };
            if (typeof Place !== "undefined") Place.ensureCraftStationEntry(entry);
            return { lootable: false, entry };
        }
        if (def.settlement || (typeof Place !== "undefined" && Place.isSettlementThing(def))) {
            const entry = { id: def.id, x, y, rot: 0 };
            if (typeof Place !== "undefined") Place.ensureSettlementEntry(entry);
            return { lootable: false, entry };
        }
        const custom = typeof ModKinds !== "undefined" ? ModKinds.applyInitEntry(def, x, y) : null;
        if (custom) return custom;
        return { lootable: false, entry: { id: def.id, x, y } };
    },

    _spawnThingSprite(chunk, entry, lootable) {
        if (!chunk?.isLoaded || !entry?.id) return null;
        const existing = (chunk.things?.getChildren?.() || []).find(
            (t) => t?.active && t.entry === entry
        );
        if (existing) {
            existing.applyVisual?.();
            return existing;
        }
        let thing;
        if (lootable) {
            thing = new LootableThing(this, entry, chunk);
        } else if (entry.id === "campfire" || entry.id === "unlit_campfire") {
            thing = new Campfire(this, entry);
        } else if (this.getThing(entry.id)?.sleep || Array.isArray(entry.occupants)) {
            const sleepDef = this.getThing(entry.id);
            thing = (sleepDef?.floor && typeof Hut !== "undefined")
                ? new Hut(this, entry)
                : new LeanTo(this, entry);
        } else if (this.getThing(entry.id)?.craftStation) {
            thing = new CraftStation(this, entry);
        } else if (this.getThing(entry.id)?.settlement
            || entry.id === "settling_stone"
            || (typeof Place !== "undefined" && Place.isSettlementThing(this.getThing(entry.id), entry))) {
            thing = new SettlingStone(this, entry);
        } else if ((typeof Research !== "undefined" && Research.isPaintingCircle?.(this.getThing(entry.id), entry))
            || Array.isArray(entry.slots) || this.getThing(entry.id)?.storage) {
            thing = Storage.create(this, entry);
        } else if (this.getThing(entry.id)?.figurine || entry.id === "clay_figurine") {
            thing = new ClayFigurine(this, entry);
        } else {
            const kindClass = typeof ModKinds !== "undefined"
                ? ModKinds.clientClassFor(this.getThing(entry.id), entry)
                : null;
            if (kindClass) {
                thing = new kindClass(this, entry);
            } else {
                thing = new Thing(this, entry.x, entry.y, entry.id, entry);
                if (entry.id === "rock") this.wireRockKnapping?.(thing);
                else if (entry.id === "sign") {
                    if (entry.spawnHint && this._spawnSignTooltip) {
                        entry.tooltip = this._spawnSignTooltip();
                    }
                    this.wireThingTooltip?.(thing);
                } else if (thing.meta?.diggable?.item) {
                    this.wireDigTooltip?.(thing);
                }
            }
            const panelId = typeof ModKinds !== "undefined"
                ? ModKinds.panelIdFor(this.getThing(entry.id), entry)
                : "";
            if (panelId && thing?.on) {
                thing.setInteractive?.({ cursor: "pointer" });
                thing.on("pointerdown", (pointer) => {
                    if (pointer?.rightButtonDown?.()) return;
                    if (typeof ModClient !== "undefined") ModClient.openPanel(panelId, this, thing);
                });
            }
        }
        chunk.things.add(thing);
        if (thing instanceof LeanTo) this._reconcileSleepOccupants?.(entry);
        return thing;
    },

    /**
     * Debug/admin: replace whatever is on (tx, ty). `entry` null = clear only.
     * @param {{ lootable?: boolean }} [opts]
     */
    setThingOnTile(tx, ty, entry, opts = {}) {
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk) return false;
        this._clearTileThings(tx, ty);
        if (!entry?.id) {
            this.markLightDirty?.();
            this.updateLightVeil?.();
            return true;
        }
        const lootable = opts.lootable != null
            ? !!opts.lootable
            : !!this.getThing(entry.id)?.lootable;
        if (lootable) {
            if (!Array.isArray(chunk.meta.lootableThings)) chunk.meta.lootableThings = [];
            chunk.meta.lootableThings.push(entry);
        } else {
            if (!Array.isArray(chunk.meta.things)) chunk.meta.things = [];
            chunk.meta.things.push(entry);
        }
        this._spawnThingSprite(chunk, entry, lootable);
        this.markLightDirty?.();
        this.updateLightVeil?.();
        return true;
    },

    /**
     * Random free tile in [-radius, radius]² (no Thing; walkable ground).
     * @returns {{ tx: number, ty: number, x: number, y: number }|null}
     */
    pickRandomSpawnTile(radius = 4, rand = null) {
        const rng = rand || mulberry32(hash2D(0, 0, worldSeed) ^ 0x504c4159);
        const occupied = this._spawnOccupiedTiles();
        const candidates = [];
        for (let ty = -radius; ty <= radius; ty++) {
            for (let tx = -radius; tx <= radius; tx++) {
                if (occupied.has(`${tx},${ty}`)) continue;
                if (!this._tileWalkable(tx, ty)) continue;
                const c = this.tileCenter(tx, ty);
                candidates.push({ tx, ty, x: c.x, y: c.y });
            }
        }
        if (!candidates.length) return null;
        return candidates[Math.floor(rng() * candidates.length)];
    },

    /**
     * Sign always at world origin tile (0,0); player teleports to a random free
     * tile in a radius-4 box (−4…4). Skipped for saves that already have a sign.
     */
    async ensureSpawnSign() {
        if (this._spawnSignBusy) return;
        if (this._spawnSignPlaced && this._playerSpawnPlaced) return;
        this._spawnSignBusy = true;
        try {
            const radius = 4; // diameter 8 → −4…4 inclusive
            await this._loadSpawnNeighborhood(radius);

            // Net: wait until the origin chunk has arrived from the server
            if (this.isNet) {
                const { x, y } = this.tileCenter(0, 0);
                const origin = this.getChunkAtWorld(x, y - 1);
                if (!origin?.isLoaded) return;
            }

            let hasSign = false;
            for (const chunk of Object.values(this.chunks)) {
                for (const t of chunk.meta?.things || []) {
                    if (t.id === "sign" && t.spawnHint) {
                    hasSign = true;
                        t.tooltip = this._spawnSignTooltip();
                    }
                }
            }

            if (!hasSign && !this._spawnSignPlaced && !this.simAuth()) {
                this._clearTileThings(0, 0);
                const { x, y } = this.tileCenter(0, 0);
                const chunk = this.getChunkAtWorld(x, y - 1);
                if (!chunk) return;
                const entry = {
                    id: "sign",
                    x,
                    y,
                    spawnHint: true,
                    tooltip: this._spawnSignTooltip()
                };
                chunk.meta.things.push(entry);
                if (chunk.isLoaded) {
                    const thing = new Thing(this, entry.x, entry.y, entry.id);
                    thing.entry = entry;
                    this.wireThingTooltip(thing);
                    chunk.things.add(thing);
                }
                this._spawnSignPlaced = true;
            } else {
                this._spawnSignPlaced = true;
            }

            // First join / fresh world — same random free-tile ring as respawn (−4…4).
            // Do not gate on hasSign: another character may already have placed the origin sign.
            if (!this._playerSpawnPlaced) {
                const pick = this.pickRandomSpawnTile(radius, Math.random);
                if (pick) {
                    this.player.teleport(pick.x, pick.y);
                    this.syncCameraToPlayer();
                    this.partySys?.placeUnposedCompanionsAt?.(this.player, this.net?.world?.poses, {
                        skipId: this.player?.pawnId
                    });
                    if (this.simAuth()) this._netSendMove(true);
                }
                this._playerSpawnPlaced = true;
            }
        } finally {
            this._spawnSignBusy = false;
        }
    },

    findCampfireOnTile(tx, ty) {
        for (const fire of this.getCampfires()) {
            const ft = this.worldToTile(fire.x, fire.y - 1);
            if (ft.tx === tx && ft.ty === ty) return fire;
        }
        return null;
    },

    placeCampfire(tx, ty, fuelLeft, fuelRight) {
        if (this.findCampfireOnTile(tx, ty)) return null;
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk || !chunk.isLoaded) return null;

        const entry = {
            id: 'campfire',
            x,
            y,
            fuel: [fuelLeft, fuelRight],
            cook: null,
            catalyst: null,
            simmer: [null, null, null, null],
            cookProgress: 0,
            burnRemaining: 0
        };
        chunk.meta.things.push(entry);
        const fire = new Campfire(this, entry);
        chunk.things.add(fire);
        this.markLightDirty();
        this.updateLightVeil();
        return fire;
    },

    resetPlaceRot() {
        this.placeRot = 0;
    },

    _heldPlaceableDef() {
        const held = this.player?.getHeldItem?.();
        if (!held || !(held.quantity > 0)) return null;
        const itemDef = this.getItem(held.id);
        const thingId = typeof Place !== "undefined"
            ? Place.heldPlaceThingId(itemDef, held)
            : itemDef?.place?.thing;
        if (!thingId) return null;
        const thingDef = this.getThing(thingId);
        if (!thingDef) return null;
        return { held, itemDef, thingId, thingDef };
    },

    _placeGhostBlocked() {
        if (this._gamePaused || this._worldSimFrozen || this.player?._bodyDead || this.player?._resting) return true;
        if (this.combatLog?.isComposing?.()) return true;
        if (isHudTextOpen(this)) return true;
        if (this._sculptUiOpen()) return true;
        return false;
    },

    _tileKeyAt(tx, ty) {
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk?.meta?.tiles) return null;
        const cs = this.chunkSize;
        const localX = tx - chunk.x * cs;
        const localY = ty - chunk.y * cs;
        if (localX < 0 || localY < 0 || localX >= cs || localY >= cs) return null;
        return chunk.meta.tiles[localX + localY * cs] || null;
    },

    _placeListsForTile(tx, ty) {
        const { x, y } = this.tileCenter(tx, ty);
        const home = this.getChunkAtWorld(x, y - 1);
        const things = [];
        const lootables = [];
        const seen = new Set();
        const add = (chunk) => {
            if (!chunk || seen.has(chunk)) return;
            seen.add(chunk);
            if (Array.isArray(chunk.meta?.things)) things.push(...chunk.meta.things);
            if (Array.isArray(chunk.meta?.lootableThings)) lootables.push(...chunk.meta.lootableThings);
        };
        add(home);
        const cs = this.chunkSize || 16;
        const ts = this.tileSize || 16;
        const cx = Math.floor(x / (cs * ts));
        const cy = Math.floor((y - 1) / (cs * ts));
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                add(this.getChunk?.(cx + dx, cy + dy));
            }
        }
        return {
            tileKey: this._tileKeyAt(tx, ty),
            things,
            lootables,
            chunk: home
        };
    },

    canPlaceAt(tx, ty) {
        if (!this.player) return false;
        const info = this._heldPlaceableDef();
        const def = info?.thingDef;
        const rot = typeof Place !== "undefined" ? Place.normalizeRot(this.placeRot) : (this.placeRot || 0);
        const ts = this.tileSize;
        const range = this.player.interactionRange;
        const { x, y } = this.tileCenter(tx, ty);
        if (typeof Place !== "undefined") {
            if (!Place.inPlaceRange(this.player.x, this.player.y, x, y, ts, range)) {
                return false;
            }
        }
        const fp = typeof Place !== "undefined" ? Place.footprintSize(def) : [1, 1];
        const tiles = typeof Place !== "undefined"
            ? (Place.placeOccupyTiles
                ? Place.placeOccupyTiles(tx, ty, rot, def)
                : Place.footprintTiles(tx, ty, rot, fp))
            : [{ tx, ty }];
        const getThing = (id) => this.getThing(id);
        for (const t of tiles) {
            if (typeof Place !== "undefined") {
                const occ = this._placeListsForTile(t.tx, t.ty);
                if (!Place.canPlaceOnTile({
                    tileKey: occ.tileKey,
                    things: occ.things,
                    lootables: occ.lootables,
                    tx: t.tx,
                    ty: t.ty,
                    tileSize: ts,
                    getThing,
                    placeDef: def
                })) return false;
            } else if (!this._tileKeyAt(t.tx, t.ty)) {
                return false;
            }
        }
        if (def?.settlement || (typeof Place !== "undefined" && Place.isSettlementThing(def))) {
            const S = typeof Settlement !== "undefined" ? Settlement : null;
            const { x, y } = this.tileCenter(tx, ty);
            if (S && !S.canPlace(this.settlementSys?.list || [], x, y, ts)) return false;
        }
        if (typeof Research !== "undefined" && Research.isPaintingCircle?.(def)) {
            const S = typeof Settlement !== "undefined" ? Settlement : null;
            const { x, y } = this.tileCenter(tx, ty);
            if (!S?.atPoint?.(this.settlementSys?.owned?.() || this.settlementSys?.list || [], x, y, ts, this.settlementSys?.ownerId?.())) {
                return false;
            }
        }
        return true;
    },

    _ensurePlaceGhost() {
        if (this._placeGhost && this._placeGhost.active) return this._placeGhost;
        const key = this.textures.exists("wicker_basket_0")
            ? "wicker_basket_0"
            : (this.textures.exists("wicker_basket") ? "wicker_basket" : "slot");
        const g = this.add.image(0, 0, key)
            .setOrigin(0.5, 1)
            .setAlpha(0.5)
            .setVisible(false)
            .setDepth(0);
        this.mainLayer.add(g);
        this._placeGhost = g;
        return g;
    },

    _hidePlaceGhost() {
        if (this._placeGhost) this._placeGhost.setVisible(false);
        if (this._placeGhostFrame) this._placeGhostFrame.setVisible(false);
        if (this._placeGhostInteract) this._placeGhostInteract.setVisible(false);
        if (this._hutGhostBack) this._hutGhostBack.setVisible(false);
        if (this._hutGhostFront) this._hutGhostFront.setVisible(false);
        this._placeGhostTile = null;
        this._placeGhostValid = false;
    },

    updatePlaceGhost() {
        const info = this._heldPlaceableDef();
        if (!info) {
            this.resetPlaceRot();
            this._hidePlaceGhost();
            return;
        }
        if (this._placeGhostBlocked()) {
            this._hidePlaceGhost();
            return;
        }
        const pointer = this.input.activePointer;
        if (!pointer || this.pointerOverWorldUi?.(pointer)) {
            this._hidePlaceGhost();
            return;
        }
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const { tx, ty } = this.worldToTile(world.x, world.y);
        const { x, y } = this.tileCenter(tx, ty);
        const inRange = typeof Place !== "undefined"
            ? Place.inPlaceRange(this.player.x, this.player.y, x, y, this.tileSize, this.player.interactionRange)
            : true;
        if (!inRange) {
            this._hidePlaceGhost();
            return;
        }
        const valid = this.canPlaceAt(tx, ty);
        const rot = typeof Place !== "undefined" ? Place.normalizeRot(this.placeRot) : (this.placeRot || 0);
        const hangKey = (typeof Hide !== "undefined" && Hide.isDryingRack(info.thingDef))
            ? Hide.hangingTextureKey(info.thingDef)
            : null;
        const rotTex = typeof Place !== "undefined"
            ? Place.facingTextureKey(info.thingDef, rot)
            : info.thingDef.key;
        const stoneGhostKey = (info.thingId === "grindstone" && typeof ensureStoneTexture === "function")
            ? ensureStoneTexture(this, "grindstone", 1, info.held?.stone)
            : null;
        const paintGhostKey = (info.thingId === "painting_circle" && typeof ensurePaintingCircleTexture === "function")
            ? ensurePaintingCircleTexture(this, info.held?.stone)
            : null;
        const ghost = this._ensurePlaceGhost();
        if (info.thingDef?.figurine) {
            const placeKey = (typeof ClayForming !== "undefined")
                ? (ClayForming.ensurePlaceIcon(this, info.held, rot) || info.held.formPlaceIcon)
                : info.held.formPlaceIcon;
            if (placeKey && this.textures.exists(placeKey)) ghost.setTexture(placeKey);
            else if (this.textures.exists("clay")) ghost.setTexture("clay");
            else if (this.textures.exists(info.thingDef.key)) ghost.setTexture(info.thingDef.key);
        } else if (info.thingDef?.floor && typeof ensureHutTextures === "function") {
            ensureHutTextures(this, info.thingDef);
            const floorTex = (typeof Place !== "undefined")
                ? Place.rotationTextureKey(info.thingDef.floor, rot)
                : info.thingDef.floor;
            if (this.textures.exists(floorTex)) ghost.setTexture(floorTex);
            else if (this.textures.exists(info.thingDef.floor)) ghost.setTexture(info.thingDef.floor);
        } else if (stoneGhostKey && this.textures.exists(stoneGhostKey)) ghost.setTexture(stoneGhostKey);
        else if (paintGhostKey && this.textures.exists(paintGhostKey)) ghost.setTexture(paintGhostKey);
        else if (info.thingId === "grindstone" && this.textures.exists("grindstone_1")) ghost.setTexture("grindstone_1");
        else if (hangKey && this.textures.exists(hangKey)) ghost.setTexture(hangKey);
        else if (this.textures.exists(rotTex)) ghost.setTexture(rotTex);
        else if (this.textures.exists(info.thingDef.key)) ghost.setTexture(info.thingDef.key);
        let gx = x;
        let gy = y;
        if (typeof Place !== "undefined") {
            const fp = Place.footprintSize(info.thingDef);
            const pos = Place.footprintWorldPos(tx, ty, rot, fp, this.tileSize);
            gx = pos.x;
            gy = pos.y;
        }
        ghost.setPosition(gx, gy);
        const floorH = ghost.displayHeight || ghost.height || 16;
        const hutGhost = !!info.thingDef?.floor;
        const floorDecal = hutGhost
            || (typeof Research !== "undefined" && Research.isPaintingCircle?.(info.thingDef))
            || !!info.thingDef?.figurine;
        if (floorDecal && this.groundLayer) {
            if (ghost.displayList !== this.groundLayer) this.groundLayer.add(ghost);
            ghost.setDepth(0.5);
        } else {
            if (this.mainLayer && ghost.displayList !== this.mainLayer) this.mainLayer.add(ghost);
            ghost.setDepth(gy - floorH - 1);
        }
        ghost.setAlpha(0.5);
        ghost.setTint(valid ? 0xffffff : 0xff5555);
        ghost.setVisible(true);
        if (hutGhost) {
            this._syncHutGhostWalls(info.thingDef, gx, gy, rot, valid);
        } else {
            if (this._hutGhostBack) this._hutGhostBack.setVisible(false);
            if (this._hutGhostFront) this._hutGhostFront.setVisible(false);
        }
        const frameTex = !hutGhost && (typeof Place !== "undefined" && info.thingDef?.sleep)
            ? Place.rotationWallTextureKey(info.thingDef.key, rot)
            : null;
        if (frameTex && this.textures.exists(frameTex)) {
            let frame = this._placeGhostFrame;
            if (!frame || !frame.active) {
                frame = this.add.image(gx, gy, frameTex).setOrigin(0.5, 1);
                this.mainLayer.add(frame);
                this._placeGhostFrame = frame;
            } else {
                frame.setTexture(frameTex);
            }
            frame.setPosition(gx, gy);
            frame.setDepth(gy + 2);
            frame.setAlpha(0.5);
            frame.setTint(valid ? 0xffffff : 0xff5555);
            frame.setVisible(true);
        } else if (this._placeGhostFrame) {
            this._placeGhostFrame.setVisible(false);
        }
        this._syncPlaceGhostInteract(info.thingDef, tx, ty, rot, valid);
        this._placeGhostTile = { tx, ty };
        this._placeGhostValid = valid;
    },

    _hutGhostPiece(spr, key, x, y, cx, cy, cw, ch, depth, tint) {
        if (!spr || !spr.active) {
            spr = this.add.image(x, y, key).setOrigin(0.5, 1);
            this.mainLayer.add(spr);
        } else if (spr.texture?.key !== key) {
            spr.setTexture(key);
        }
        spr.setCrop(cx, cy, cw, ch);
        spr.setPosition(x, y);
        spr.setDepth(depth);
        spr.setAlpha(0.5);
        spr.setTint(tint);
        spr.setVisible(true);
        return spr;
    },

    _syncHutGhostWalls(thingDef, x, y, rot, valid) {
        if (typeof ensureHutTextures === "function") ensureHutTextures(this, thingDef);
        const key = (typeof Place !== "undefined")
            ? Place.rotationTextureKey(thingDef.wall, rot)
            : thingDef.wall;
        if (!key || !this.textures.exists(key)) {
            if (this._hutGhostBack) this._hutGhostBack.setVisible(false);
            if (this._hutGhostFront) this._hutGhostFront.setVisible(false);
            return;
        }
        const size = Number(thingDef.spriteSize) || 32;
        const split = Number(thingDef.wallSplit) || 22;
        const tint = valid ? 0xffffff : 0xff5555;
        this._hutGhostBack = this._hutGhostPiece(
            this._hutGhostBack, key, x, y, 0, 0, size, split, y - size - 1, tint
        );
        this._hutGhostFront = this._hutGhostPiece(
            this._hutGhostFront, key, x, y, 0, split, size, Math.max(1, size - split), y + 2, tint
        );
        if (this._placeGhostFrame) this._placeGhostFrame.setVisible(false);
    },

    _syncPlaceGhostInteract(thingDef, tx, ty, rot, valid) {
        const ts = this.tileSize || 16;
        const tiles = typeof Place !== "undefined" && Place.placeOccupyTiles
            ? Place.placeOccupyTiles(tx, ty, rot, thingDef)
            : [];
        const origin = { tx, ty };
        const extra = tiles.find((t) => t.tx !== origin.tx || t.ty !== origin.ty);
        if (!extra || !Place.interactOffset?.(thingDef)) {
            if (this._placeGhostInteract) this._placeGhostInteract.setVisible(false);
            return;
        }
        const cx = extra.tx * ts + ts / 2;
        const cy = extra.ty * ts + ts / 2;
        let g = this._placeGhostInteract;
        if (!g || !g.active) {
            g = this.add.graphics();
            this.mainLayer?.add(g);
            this._placeGhostInteract = g;
        }
        const tint = valid ? 0xffffff : 0xff5555;
        g.clear();
        g.fillStyle(tint, 0.18);
        g.fillCircle(0, 0, ts * 0.28);
        g.lineStyle(1, tint, 0.9);
        g.strokeCircle(0, 0, ts * 0.28);
        g.setPosition(cx, cy);
        g.setDepth(cy - ts);
        g.setVisible(true);
        g.setAlpha(0.85);
    },

    _handlePlaceRotate() {
        if (!this.keyR || !Phaser.Input.Keyboard.JustDown(this.keyR)) return;
        if (this._placeGhostBlocked()) return;
        if (!this._heldPlaceableDef()) return;
        const info = this._heldPlaceableDef();
        if (typeof Place !== "undefined" && !Place.canRotate(info?.thingDef)) return;
        const shift = this.player?.keys?.SHIFT?.isDown;
        if (typeof Place !== "undefined") {
            this.placeRot = shift ? Place.rotateCCW(this.placeRot) : Place.rotateCW(this.placeRot);
        } else {
            this.placeRot = ((this.placeRot || 0) + (shift ? 270 : 90)) % 360;
        }
    },

    tryPlaceHeld() {
        const info = this._heldPlaceableDef();
        if (!info) return false;
        if (this._placeGhostBlocked()) return false;
        const tile = this._placeGhostTile;
        if (!tile || !this._placeGhostValid) return false;
        if (!this.canPlaceAt(tile.tx, tile.ty)) return false;
        const rot = typeof Place !== "undefined" ? Place.normalizeRot(this.placeRot) : (this.placeRot || 0);
        const isSettle = !!(info.thingDef?.settlement
            || (typeof Place !== "undefined" && Place.isSettlementThing(info.thingDef)));

        if (isSettle) {
            this.settlementSys?.promptNameThenPlace(tile.tx, tile.ty, rot);
            return true;
        }

        if (this.simAuth()) {
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.PLACE,
                tx: tile.tx,
                ty: tile.ty,
                rot,
                pawnId: this.player?.pawnId
            });
            if (!(info.held.quantity > 1)) this.resetPlaceRot();
            return true;
        }

        const placed = info.thingDef.sleep
            ? this.placeSleep(tile.tx, tile.ty, info.thingId, rot)
            : info.thingDef.craftStation
            ? this.placeCraftStation(tile.tx, tile.ty, info.thingId, rot)
            : (info.thingDef.settlement
                ? this.placeSettlement(tile.tx, tile.ty, rot)
                : info.thingDef.figurine
                    ? this.placeFigurine(tile.tx, tile.ty, info, rot)
                    : this.placeStorage(tile.tx, tile.ty, info.thingId, rot));
        if (!placed) return false;
        this.player.loseItem(info.held, 1);
        if (!(info.held.quantity > 0)) this.resetPlaceRot();
        return true;
    },

    placeStorage(tx, ty, thingId, rot = 0) {
        if (!this.canPlaceAt(tx, ty)) return null;
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk || !chunk.isLoaded) return null;
        const def = this.getThing(thingId);
        if (!def) return null;
        const isPaint = typeof Research !== "undefined" && Research.isPaintingCircle?.(def);
        const entry = {
            id: thingId,
            x,
            y,
            rot: typeof Place !== "undefined" ? Place.normalizeRot(rot) : rot
        };
        if (isPaint) {
            const heldStone = (typeof Stone !== "undefined" && Stone.normalizeStone)
                ? Stone.normalizeStone(this._heldPlaceableDef()?.held?.stone)
                : null;
            if (heldStone) entry.stone = heldStone;
        } else {
            entry.slots = typeof Place !== "undefined"
                ? Place.emptySlots(def.storage?.slots || 1)
                : [null, null, null, null, null, null, null, null];
            if (typeof Place !== "undefined") Place.ensureStorageEntry(entry, def);
            if (typeof Place !== "undefined" && Place.isStoragePit(def, entry)) {
                entry.digProgress = 0;
                entry.fillId = Place.pitFillForTile(this._tileKeyAt(tx, ty)) || "dirt";
            }
        }
        if (typeof Research !== "undefined") Research.ensureEntry(entry, def);
        chunk.meta.things.push(entry);
        const spr = Storage.create(this, entry);
        chunk.things.add(spr);
        return spr;
    },

    placeFigurine(tx, ty, info, rot = 0) {
        if (!this.canPlaceAt(tx, ty)) return null;
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk || !chunk.isLoaded) return null;
        const held = info?.held;
        if (!held?.formVoxels) return null;
        if (typeof Place !== "undefined" && !Place.canPlaceFigurine(held)) return null;
        const entry = {
            id: info.thingId || "clay_figurine",
            x,
            y,
            rot: typeof Place !== "undefined" ? Place.normalizeRot(rot) : rot
        };
        entry.formPose = 1;
        if (typeof Place !== "undefined") Place.ensureFigurineEntry(entry);
        const extras = typeof mealStackExtras === "function" ? mealStackExtras(held) : null;
        if (extras) Object.assign(entry, extras);
        if (typeof ClayForming !== "undefined") ClayForming.ensurePlaceIcon(this, entry, entry.rot);
        chunk.meta.things.push(entry);
        const spr = new ClayFigurine(this, entry);
        chunk.things.add(spr);
        return spr;
    },

    tryPickupFigurine(thing) {
        if (!thing?.entry || !thing.inRange?.()) return false;
        const entry = thing.entry;
        const extras = typeof mealStackExtras === "function" ? mealStackExtras(entry) : null;
        const stackId = "clay_figurine";
        const meta = this.getItem(stackId);
        if (!meta) return false;
        const x = thing.x;
        const y = thing.y;
        const chunk = this.getChunkAtWorld(x, y - 1);
        const list = chunk?.meta?.things;
        if (Array.isArray(list)) {
            const i = list.indexOf(entry);
            if (i >= 0) list.splice(i, 1);
        }
        thing.destroy();
        this.hideTooltip?.();
        const left = this.player.gainItem(meta, 1, undefined, extras);
        if (left > 0) {
            DroppedItem.spawn(this, x, y, meta, left, undefined, extras);
        }
        this.hotbar.dirty = true;
        return true;
    },

    placeSleep(tx, ty, thingId, rot = 0) {
        if (!this.canPlaceAt(tx, ty)) return null;
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk || !chunk.isLoaded) return null;
        const def = this.getThing(thingId);
        if (!def?.sleep) return null;
        const entry = {
            id: thingId,
            x,
            y,
            tx,
            ty,
            rot: typeof Place !== "undefined" ? Place.normalizeRot(rot) : rot
        };
        if (typeof Place !== "undefined") Place.ensureSleepEntry(entry, def);
        chunk.meta.things.push(entry);
        const spr = (def?.floor && typeof Hut !== "undefined")
            ? new Hut(this, entry)
            : new LeanTo(this, entry);
        chunk.things.add(spr);
        return spr;
    },

    placeCraftStation(tx, ty, thingId, rot = 0) {
        if (!this.canPlaceAt(tx, ty)) return null;
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk || !chunk.isLoaded) return null;
        const def = this.getThing(thingId);
        if (!def?.craftStation) return null;
        const entry = {
            id: thingId,
            x,
            y,
            rot: typeof Place !== "undefined" ? Place.normalizeRot(rot) : rot
        };
        const heldStone = (typeof Stone !== "undefined" && Stone.normalizeStone)
            ? Stone.normalizeStone(this._heldPlaceableDef()?.held?.stone)
            : null;
        if (heldStone) entry.stone = heldStone;
        if (typeof Place !== "undefined") Place.ensureCraftStationEntry(entry);
        chunk.meta.things.push(entry);
        const spr = new CraftStation(this, entry);
        chunk.things.add(spr);
        return spr;
    },

    placeSettlement(tx, ty, rot = 0, name = "Camp") {
        return this.settlementSys?.tryPlace(tx, ty, rot, name)?.spr || null;
    },

    findStorageByUid(uid) {
        if (!uid) return null;
        for (const chunk of Object.values(this.chunks || {})) {
            for (const t of chunk.things?.getChildren?.() || []) {
                if (t instanceof Storage && t.entry?.uid === uid) return t;
                if (t instanceof PaintingCircle && t.entry?.uid === uid) return t;
            }
        }
        return null;
    },

    tryPickupStorage(storage) {
        if (!storage || !storage.isEmpty?.()) return false;
        if (!storage.inRange?.()) return false;
        const entry = storage.entry;
        const itemId = typeof Place !== "undefined"
            ? Place.itemIdForThing(entry.id, this.items())
            : entry.id;

        if (this.simAuth()) {
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.STORAGE,
                op: "pickup",
                uid: entry.uid,
                x: storage.x,
                y: storage.y
            });
            return true;
        }

        if (typeof Place !== "undefined" && Place.isStoragePit(storage.meta, entry)) {
            const cost = Math.max(0, Math.floor(Number(entry.digTaken) || 0));
            if (cost > 0) {
                const fillId = entry.fillId === "snow" ? "snow" : "dirt";
                if ((this.player?.getNumItems?.(fillId) || 0) < cost) {
                    this.combatLog?.push(`Need ${cost} ${fillId}`);
                    return false;
                }
                this.player.loseAnyItem(fillId, cost);
            }
        }

        this._removeStorageThing(storage);
        const meta = this.getItem(itemId);
        const stone = (typeof Stone !== "undefined" && Stone.normalizeStone)
            ? Stone.normalizeStone(entry?.stone)
            : null;
        const extras = stone ? { stone } : null;
        if (meta) {
            const left = this.player.gainItem(meta, 1, undefined, extras);
            if (left > 0) {
                DroppedItem.spawn(this, storage.x, storage.y, meta, left, undefined, extras);
            }
        }
        this.hotbar.dirty = true;
        return true;
    },

    tryRemovePaintingCircle(circle) {
        if (!circle?.entry || !circle.inRange?.()) return false;
        const sys = this.settlementSys;
        if (sys?.circleRemoveBlockedReason?.(circle)) return false;
        const entry = circle.entry;
        const itemId = typeof Place !== "undefined"
            ? Place.itemIdForThing(entry.id, this.items())
            : entry.id;

        if (this.simAuth()) {
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.STORAGE,
                op: "pickup",
                uid: entry.uid,
                x: circle.x,
                y: circle.y
            });
            this.paintingCirclePanel?.close();
            return true;
        }

        this._dumpPaintingCirclePigment(circle);
        this._dumpPaintingCircleTally(circle);
        const wx = circle.x;
        const wy = circle.y;
        this._removePaintingCircleThing(circle);
        const meta = this.getItem(itemId);
        const stone = (typeof Stone !== "undefined" && Stone.normalizeStone)
            ? Stone.normalizeStone(entry?.stone)
            : null;
        const extras = stone ? { stone } : null;
        if (meta) {
            const left = this.player.gainItem(meta, 1, undefined, extras);
            if (left > 0) {
                DroppedItem.spawn(this, wx, wy, meta, left, undefined, extras);
            }
        }
        this.hotbar.dirty = true;
        return true;
    },

    _dumpPaintingCirclePigment(circle) {
        const R = typeof Research !== "undefined" ? Research : null;
        const id = R?.currentPigmentId?.(circle?.entry);
        if (!id) return;
        const meta = this.getItem(id);
        if (meta) DroppedItem.spawn(this, circle.x, circle.y, meta, 1);
    },

    _dumpPaintingCircleTally(circle) {
        const R = typeof Research !== "undefined" ? Research : null;
        if (!R?.hasTally?.(circle?.entry)) return;
        const id = R.TALLY_ITEM_ID || "tally_stick";
        const meta = this.getItem(id);
        if (meta) DroppedItem.spawn(this, circle.x, circle.y, meta, 1);
    },

    _tallyItemId() {
        return (typeof Research !== "undefined" && Research.TALLY_ITEM_ID) || "tally_stick";
    },

    _consumeHeldTallyStick() {
        const player = this.player;
        if (!player) return false;
        const idx = player._heldSlotIndex?.() ?? this.hotbar?.activeIndex ?? 0;
        const held = player.inventory?.[idx];
        if (!held || held.id !== this._tallyItemId()) return false;
        held.quantity = (held.quantity || 1) - 1;
        if (!(held.quantity > 0)) player.inventory[idx] = null;
        if (this.hotbar) this.hotbar.dirty = true;
        return true;
    },

    tryInstallTallyStick(circle) {
        if (!circle?.entry || !circle.inRange?.()) return false;
        const R = typeof Research !== "undefined" ? Research : null;
        if (!R?.installTally || R.hasTally?.(circle.entry)) return false;
        const held = this.player?.getHeldItem?.();
        if (!held || held.id !== this._tallyItemId()) return false;
        if (this.simAuth()) {
            const settle = this.settlementSys?.here?.(this.player);
            this.settlementSys?.sendNet("installTally", {
                settlementId: settle?.id,
                uid: circle.entry.uid
            });
            return true;
        }
        if (!this._consumeHeldTallyStick()) return false;
        if (!R.installTally(circle.entry)) return false;
        circle.applyVisual?.();
        this.settlementSys?.bumpWorkCache?.();
        return true;
    },

    tryRemoveTallyStick(circle) {
        if (!circle?.entry || !circle.inRange?.()) return false;
        const R = typeof Research !== "undefined" ? Research : null;
        if (!R?.hasTally?.(circle.entry)) return false;
        if (this.settlementSys?.circleTallyRemoveBlockedReason?.(circle)) return false;
        if (this.simAuth()) {
            const settle = this.settlementSys?.here?.(this.player);
            this.settlementSys?.sendNet("removeTally", {
                settlementId: settle?.id,
                uid: circle.entry.uid
            });
            return true;
        }
        if (!R.removeTally(circle.entry)) return false;
        const meta = this.getItem(this._tallyItemId());
        if (meta) {
            const left = this.player.gainItem(meta, 1);
            if (left > 0) DroppedItem.spawn(this, circle.x, circle.y, meta, left);
        }
        if (this.hotbar) this.hotbar.dirty = true;
        circle.applyVisual?.();
        this.settlementSys?.bumpWorkCache?.();
        this.paintingCirclePanel?.layout?.();
        return true;
    },

    _removePaintingCircleThing(circle) {
        if (!circle) return;
        const entry = circle.entry;
        const chunk = this.getChunkAtWorld(circle.x, circle.y - 1);
        if (chunk?.meta?.things && entry) {
            const i = chunk.meta.things.indexOf(entry);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        }
        if (this.paintingCirclePanel?.circle === circle) this.paintingCirclePanel.close();
        if (this.pigmentFilterPanel?.thing === circle) this.pigmentFilterPanel.close();
        this.settlementSys?.unlinkStation?.(entry?.uid);
        this.settlementSys?.bumpWorkCache?.();
        circle.destroy();
    },

    tryPickupCraftStation(station) {
        if (!station?.meta?.craftStation) return false;
        if (!station.inRange?.()) return false;
        this.closeCraftMenu();
        return this.tryPickupStorage(station);
    },

    tryRotateStation(thing, opts = {}) {
        if (!thing?.entry) return false;
        const id = thing.meta?.id || thing.entry.id;
        if (id !== "campfire" && id !== "unlit_campfire"
            && id !== "drying_rack" && id !== "skinworking_bench") return false;
        if (thing.inRange && !thing.inRange()) return false;
        const ccw = !!opts.ccw;
        if (this.simAuth()) {
            const fire = id === "campfire" || id === "unlit_campfire";
            this._netSendMove?.(true);
            this.net.sendAction({
                type: fire ? NetProtocol.Actions.CAMPFIRE : NetProtocol.Actions.STORAGE,
                op: "rotate",
                ccw,
                uid: thing.entry.uid,
                x: thing.x,
                y: thing.y,
                pawnId: this.player?.pawnId
            });
            return true;
        }
        if (typeof Place === "undefined" || !Place.nextSpotRot) return false;
        const ts = this.tileSize || 16;
        const next = Place.nextSpotRot(thing.entry, ts, thing.meta, (tx, ty) => this._localSpotFree(thing, tx, ty), ccw);
        if (next == null) return false;
        thing.entry.rot = next;
        thing.applyVisual?.();
        return true;
    },

    _localSpotFree(thing, tx, ty) {
        if (typeof Place === "undefined" || !Place.entryOnTile) return true;
        const ts = this.tileSize || 16;
        const kids = this.world?.things?.getChildren?.() || [];
        for (const other of kids) {
            if (!other?.active || other === thing || !other.entry) continue;
            if (Place.entryOnTile(other.entry, tx, ty, ts, other.meta)) return false;
        }
        return true;
    },

    tryDestroyCampfire(campfire) {
        if (!campfire || campfire.isLit?.()) return false;
        if (!campfire.inRange?.()) return false;
        const entry = campfire.entry;
        if (this.simAuth()) {
            this._invSwapGuardUntil = performance.now() + 1000;
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.CAMPFIRE,
                op: "destroy",
                uid: entry?.uid,
                x: campfire.x,
                y: campfire.y
            });
            this.campfirePanel?.close();
            return true;
        }
        this._dumpCampfireContents(campfire);
        this._removeCampfireThing(campfire);
        return true;
    },

    _campfireContentStacks(entry) {
        const stacks = [];
        const push = (s) => {
            if (s?.id && s.quantity > 0) stacks.push(s);
        };
        for (const s of entry?.fuel || []) push(s);
        push(entry?.cook);
        push(entry?.catalyst);
        for (const s of entry?.simmer || []) push(s);
        return stacks;
    },

    _dumpCampfireContents(campfire) {
        const entry = campfire?.entry;
        if (!entry) return;
        const now = this.worldMinuteIndex?.() ?? null;
        const x = campfire.x;
        const y = campfire.y;
        for (const stack of this._campfireContentStacks(entry)) {
            const meta = this.getItem(stack.id);
            if (!meta) continue;
            const extras = typeof mealStackExtras === "function" ? mealStackExtras(stack) : null;
            const spoilAt = typeof spoilAtForWorld === "function"
                ? spoilAtForWorld(stack, now)
                : stack.spoilAt;
            DroppedItem.spawn(this, x, y, meta, stack.quantity, spoilAt, extras);
        }
    },

    _removeCampfireThing(campfire) {
        if (!campfire) return;
        const entry = campfire.entry;
        const chunk = this.getChunkAtWorld(campfire.x, campfire.y - 1);
        if (chunk?.meta?.things && entry) {
            const i = chunk.meta.things.indexOf(entry);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        }
        if (this.campfirePanel?.campfire === campfire) this.campfirePanel.close();
        this.settlementSys?.unlinkStation?.(entry?.uid);
        campfire.destroy();
        this.markLightDirty?.();
    },

    _removeStorageThing(storage) {
        if (!storage) return;
        const entry = storage.entry;
        const chunk = this.getChunkAtWorld(storage.x, storage.y - 1);
        if (chunk?.meta?.things && entry) {
            const i = chunk.meta.things.indexOf(entry);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        }
        if (this.storagePanel?.storage === storage) this.storagePanel.close();
        if (this._isSameCraftStation(storage)) this.closeCraftStationMenu();
        this.settlementSys?.unlinkStation?.(entry?.uid);
        storage.destroy();
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
