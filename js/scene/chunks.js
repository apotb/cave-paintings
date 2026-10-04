/**
 * SceneMain prototype methods (chunks).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainChunks = {

    getKey(x, y) {
        return `${x},${y}`;
    },

    getChunk(x, y) {
        return this.chunks[this.getKey(x, y)] || null;
    },

    /**
     * Drop every chunk (and live world sprites). Nearby chunks are recreated
     * next frame as the player stays in range — same path as first exploration.
     * @returns {number} how many chunks were discarded
     */
    regenChunks() {
        const n = Object.keys(this.chunks || {}).length;
        // World panels hold refs into chunk things/corpses
        if (this.corpsePanel?.visible) this.corpsePanel.close(true);
        if (this.campfirePanel?.visible) this.campfirePanel.close();
        if (this.storagePanel?.visible) this.storagePanel.close();
        if (this.leanToPanel?.visible) this.leanToPanel.close();
        if (this.paintingCirclePanel?.visible) this.paintingCirclePanel.close();
        if (this.craftMenuVisible) this.closeCraftMenu();
        if (this.healthPanel?.isInspecting?.()) this.healthPanel.close();

        for (const chunk of Object.values(this.chunks || {})) chunk.unload();
        this.chunks = {};
        this._loadedChunks = [];
        this._thingCells = new Map();
        if (typeof Structures !== "undefined") Structures.clearPending?.();
        // Re-place the origin sign in the new world, but do not reset player spawn —
        // /regen must keep the current camera/player position.
        this._spawnSignPlaced = false;
        this._spawnSignBusy = false;
        this._things?.clear(true, true);
        if (this.mobs) {
            for (const mob of this.mobs.getChildren().slice()) {
                this.damageables?.remove(mob);
            }
            this.mobs.clear(true, true);
        }
        if (this.droppedItems) this.droppedItems.clear(true, true);
        if (this.corpses) {
            for (const c of this.corpses.getChildren().slice()) c.destroy();
            this.corpses.clear(true, true);
        }
        this.markLightDirty?.();
        return n;
    },

    chunkPx() {
        return this.chunkSize * this.tileSize;
    },

    allocChunkRt(wx, wy) {
        const w = this.chunkPx();
        this._chunkRtPool = this._chunkRtPool || [];
        let rt = null;
        while (this._chunkRtPool.length) {
            const cand = this._chunkRtPool.pop();
            if (cand?.active && cand.scene) {
                rt = cand;
                break;
            }
            try { cand?.destroy?.(); } catch (_) {}
        }
        if (!rt) {
            rt = this.make.renderTexture({
                x: wx,
                y: wy,
                width: w,
                height: w,
                add: false
            }).setOrigin(0).setDepth(0).setVisible(false);
        } else {
            rt.setPosition(wx, wy).setVisible(false);
            rt.clear();
        }
        return rt;
    },

    recycleChunkRt(rt) {
        if (!rt) return;
        this.groundLayer?.remove?.(rt);
        rt.setVisible(false);
        try { rt.clear(); } catch (_) {}
        this._chunkRtPool = this._chunkRtPool || [];
        this._chunkRtPool.push(rt);
    },

    _trackLoadedChunk(chunk) {
        if (!chunk) return;
        const list = this._loadedChunks || (this._loadedChunks = []);
        if (list.indexOf(chunk) < 0) list.push(chunk);
    },

    _untrackLoadedChunk(chunk) {
        const list = this._loadedChunks;
        if (!list || !chunk) return;
        const i = list.indexOf(chunk);
        if (i >= 0) list.splice(i, 1);
    },

    enqueueChunkPaint(chunk) {
        return new Promise((resolve) => {
            this._chunkPaintQ = this._chunkPaintQ || [];
            this._chunkPaintQ.push({ chunk, resolve });
        });
    },

    dropChunkPaint(chunk) {
        const q = this._chunkPaintQ;
        if (!q?.length) return;
        this._chunkPaintQ = q.filter((job) => {
            if (job.chunk !== chunk) return true;
            job.resolve();
            return false;
        });
    },

    _pumpChunkPaint() {
        const q = this._chunkPaintQ;
        if (!q?.length) return;
        const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
        while (q.length) {
            const job = q.shift();
            const chunk = job?.chunk;
            if (!chunk?.isLoaded || chunk.scene !== this) {
                job.resolve();
                continue;
            }
            try {
                chunk._paintGround();
            } catch (_) {}
            job.resolve();
            const now = typeof performance !== "undefined" ? performance.now() : Date.now();
            if (now - t0 >= 6) break;
        }
        this._paintBusy = false;
    },

    /** Debug: draw chunk border grid over the camera view. */
    setChunkDebug(on) {
        this.chunkDebug = !!on;
        if (!this.chunkDebug) {
            this._chunkDebugGfx?.clear();
            this._chunkDebugGfx?.setVisible(false);
            return this.chunkDebug;
        }
        this.drawChunkDebug();
        return this.chunkDebug;
    },

    drawChunkDebug() {
        if (!this.chunkDebug) return;
        if (!this._chunkDebugGfx) {
            this._chunkDebugGfx = this.add.graphics().setDepth(100);
            this.mainLayer.add(this._chunkDebugGfx);
        }
        const g = this._chunkDebugGfx;
        g.clear().setVisible(true);

        const cam = this.cameras.main;
        const px = this.chunkPx();
        const wv = cam.worldView;
        const cx0 = Math.floor(wv.x / px);
        const cy0 = Math.floor(wv.y / px);
        const cx1 = Math.ceil(wv.right / px);
        const cy1 = Math.ceil(wv.bottom / px);

        g.lineStyle(1, 0x55ffaa, 0.55);
        for (let cx = cx0; cx <= cx1; cx++) {
            const x = cx * px;
            g.lineBetween(x, cy0 * px, x, cy1 * px);
        }
        for (let cy = cy0; cy <= cy1; cy++) {
            const y = cy * px;
            g.lineBetween(cx0 * px, y, cx1 * px, y);
        }
    },

    updateChunkDistances() {
        // How many world tiles fit on screen at the current zoom
        const viewTilesX = this.scale.width / (this.tileSize * this.worldZoom);
        const viewTilesY = this.scale.height / (this.tileSize * this.worldZoom);
        // Half the longer axis in chunks, plus margin so edges stay filled while moving
        const halfChunks = Math.max(viewTilesX, viewTilesY) / (2 * this.chunkSize);
        const margin = 1;
        this.renderDistance = Math.max(3, Math.ceil(halfChunks) + margin);
        // Prefetch / keep generated beyond the visible ring
        this.cullDistance = this.renderDistance + 2;
        this.genDistance = this.cullDistance;
    },

    updateUiScale() {
        if (typeof Settings !== "undefined") {
            this.uiScale = Settings.resolveUiScale(
                this.guiScalePref,
                this.scale?.width,
                this.scale?.height
            );
            const max = Settings.getMaxGuiScaleOption(this.scale?.width, this.scale?.height);
            let pref = this.guiScalePref | 0;
            if (pref < 0) pref = 0;
            if (pref > max) pref = max;
            this.guiScalePref = pref;
            return;
        }
        const max = this.getMaxGuiScaleOption();
        let pref = this.guiScalePref | 0;
        if (pref < 0) pref = 0;
        if (pref > max) pref = max;
        this.guiScalePref = pref;

        if (pref === 0) {
            this.uiScale = this._autoUiScale();
        } else {
            this.uiScale = pref;
        }
    },

    applyUiScale() {
        if (this._leavingGame || !this.uiLayer) return;
        const s = this.uiScale || 1;

        if (this._uiCam) this._uiCam.setSize(this.scale.width, this.scale.height);

        this.drawBars();

        if (this.hotbar) this.hotbar.layout();

        if (this.tooltipText) {
            this._tooltipPadding = Math.round(6 * s);
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.tooltipText, 16, s);
            else this.tooltipText.setFontSize(`${pixelUiFontSize(16, s)}px`);
            this.tooltipText.setPadding(this._tooltipPadding);
            this.tooltipText.setStroke("#000000", Math.max(2, Math.round(2 * s)));
            if (typeof crispUiText === "function") crispUiText(this.tooltipText);
            if (this.tooltipSub) {
                if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.tooltipSub, 16, s);
                else this.tooltipSub.setFontSize(`${pixelUiFontSize(16, s)}px`);
                this.tooltipSub.setStroke("#000000", Math.max(2, Math.round(2 * s)));
                if (typeof crispUiText === "function") crispUiText(this.tooltipSub);
            }
            if (this.tooltip?.visible) {
                this._tooltipDrawn = false;
                this.refreshTooltip?.();
            }
        }

        const pad = Math.round(8 * s);
        const cx = this.scale.width / 2;
        if (this.clockText) {
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.clockText, 16, s);
            else this.clockText.setFontSize(`${pixelUiFontSize(16, s)}px`);
            this.clockText.setStroke("#000000", Math.max(2, Math.round(2 * s)));
            if (typeof crispUiText === "function") crispUiText(this.clockText);
            placeUiText(this.clockText, cx, pad, 0.5, 0);
        }
        if (this.fpsText) {
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(this.fpsText, 16, s);
            else this.fpsText.setFontSize(`${pixelUiFontSize(16, s)}px`);
            this.fpsText.setStroke("#000000", Math.max(2, Math.round(2 * s)));
            if (typeof crispUiText === "function") crispUiText(this.fpsText);
            this._layoutFpsMeter();
        }
        this._layoutLocationDebug?.();

        if (this.craft) {
            this.craft.setScale(6 * s).setPosition(44 * s, this.scale.height / 2);
            if (this.equipmentBtn) {
                this.equipmentBtn.setScale(6 * s).setPosition(44 * s, this.scale.height / 2 - 104 * s);
            }
            if (this.healthBtn) {
                this.healthBtn.setScale(6 * s).setPosition(44 * s, this.scale.height / 2 + 104 * s);
            }
            this.healthPanel?.layout?.();
            this.combatLog?.layout?.();
            this.layoutDeathOverlay();
            if (this.help) {
                this.help.setScale(3 * s).setPosition(
                    this.scale.width - 32 * s,
                    this.scale.height - 32 * s
                );
            }
            this.partyPanel?.layout?.();
            this.settlementPanel?.layout?.();
            this.researchTreePanel?.layout?.();
            this.billsPanel?.layout?.();
            this.storageFilterPanel?.layout?.();
            this.fuelFilterPanel?.layout?.();
            this.pigmentFilterPanel?.layout?.();
            this.settlementSys?.layoutHud?.();
            this._layoutFpsMeter?.();
        }

        if (this.craftMenuVisible) this.refreshCraftMenu();
        else this.positionCraftMenu();

        if (this._gamePaused && this._pauseUi) this._buildPauseMenu();
        else this._layoutPauseMenu();
        if (this._generatingUi) this._layoutGeneratingOverlay();

        if (this.equipmentPanel?.visible) {
            this.equipmentPanel.refresh();
            this.equipmentPanel.layout();
        } else if (this.equipmentPanel) {
            this.equipmentPanel.layout();
        }

        if (this.campfirePanel?.visible) this.campfirePanel.layout();
        if (this.storagePanel?.visible) this.storagePanel.layout();
        if (this.leanToPanel?.visible) this.leanToPanel.layout();
        if (this.paintingCirclePanel?.visible) this.paintingCirclePanel.layout();
        if (this.knappingPanel) this.knappingPanel.layout();
        if (this.clayFormingPanel) this.clayFormingPanel.layout();

        this.player?.applyChatBubbleScale?.();
        for (const p of this.party || []) {
            if (p && p !== this.player) {
                p.applyNameLabelScale?.();
                p.applyChatBubbleScale?.();
            }
        }
        for (const w of this.partySys?.wanderers || []) {
            w.applyNameLabelScale?.();
            w.applyChatBubbleScale?.();
        }
        for (const s of this.settlers || []) {
            s.applyNameLabelScale?.();
            s.applyChatBubbleScale?.();
        }
        if (this.remotePlayers?.size) {
            for (const entry of this.remotePlayers.values()) {
                this._netApplyRemoteLabelScale(entry);
            }
        }

        if (this._waterSprite) {
            const w = (roundUpToEven(this.scale.width / this.tileSize / this.worldZoom) + 2) * this.tileSize;
            const h = (roundUpToEven(this.scale.height / this.tileSize / this.worldZoom) + 2) * this.tileSize;
            this._waterSprite.setSize(w, h);
        }

        this.markLightDirty();
        this.updateLightVeil();
    },

    animateWater() {
        if (!this._waterSprite?.active || !this._waterSprite.scene) return;
        this._waterSprite.setFrame(this._waterFrame++);
        if (this._waterFrame > 3) this._waterFrame = 0;
    },

    _syncWaterSprite() {
        const spr = this._waterSprite;
        const p = this.player;
        if (!spr?.active || !p || typeof p.posX !== "function") return;
        const wx = Math.round(p.posX());
        const wy = Math.round(p.posY());
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
        const ts = this.tileSize;
        const x = wx * ts;
        const y = wy * ts;
        const cam = this.cameras?.main?.worldView;
        const left = spr.x - spr.width * spr.originX;
        const top = spr.y - spr.height * spr.originY;
        const covers = cam
            && left <= cam.x
            && top <= cam.y
            && left + spr.width >= cam.right
            && top + spr.height >= cam.bottom;
        if (covers && wx === this._oldWaterX && wy === this._oldWaterY) return;
        this._oldWaterX = wx;
        this._oldWaterY = wy;
        if (spr.x !== x || spr.y !== y) spr.setPosition(x, y);
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
