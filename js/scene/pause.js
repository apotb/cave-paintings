/**
 * SceneMain prototype methods (pause).
 * Installed onto SceneMain.prototype. Method bodies are unchanged.
 */
(function (root) {
    "use strict";
    root.SceneMainPause = {

    createButtons() {
        const s = this.uiScale || 1;
        this.craft = this.add.image(44 * s, this.scale.height / 2, 'craft');
        lockPixelHit(this.craft, 'craft', { cursor: 'pointer' });
        this.craft.on('pointerdown', (pointer) => {
            if (pointer?.button != null && pointer.button !== 0) return;
            this.toggleCraftMenu();
        });
        this.craft.on('pointerover', () => {
            if (!this.craftMenuVisible) this.craft.setTexture('craft_hover');
        });
        this.craft.on('pointerout', () => this.craft.setTexture(
            this.craftMenuVisible ? 'craft_open' : 'craft'
        ));
        this.craft.setOrigin(0.5, 0.5).setScale(6 * s);
        this.uiLayer.add(this.craft);

        this.healthBtn = this.add.image(44 * s, this.scale.height / 2 + 104 * s, "health");
        lockPixelHit(this.healthBtn, "health", { cursor: "pointer" });
        this.healthBtn.on("pointerdown", () => this.toggleHealthMenu());
        this.healthBtn.on("pointerover", () => {
            if (!this.healthPanel?.visible) this.healthBtn.setTexture("health_hover");
        });
        this.healthBtn.on("pointerout", () => {
            this.healthBtn.setTexture(this.healthPanel?.visible ? "health_open" : "health");
        });
        this.healthBtn.setOrigin(0.5, 0.5).setScale(6 * s);
        this.uiLayer.add(this.healthBtn);

        this.equipmentBtn = this.add.image(44 * s, this.scale.height / 2 - 104 * s, 'equipment');
        lockPixelHit(this.equipmentBtn, 'equipment', { cursor: 'pointer' });
        this.equipmentBtn.on('pointerdown', () => this.toggleEquipmentMenu());
        this.equipmentBtn.on('pointerover', () => {
            if (!this.equipmentPanel?.visible) this.equipmentBtn.setTexture('equipment_hover');
        });
        this.equipmentBtn.on('pointerout', () => {
            this.equipmentBtn.setTexture(this.equipmentPanel?.visible ? 'equipment_open' : 'equipment');
        });
        this.equipmentBtn.setOrigin(0.5, 0.5).setScale(6 * s);
        this.uiLayer.add(this.equipmentBtn);

        // Help (hover for controls; hold-click shows pressed art only)
        this._helpPressed = false;
        this.help = this.add.image(this.scale.width - 32 * s, this.scale.height - 32 * s, 'help');
        lockPixelHit(this.help, 'help', { useHandCursor: true });
        this.help.on('pointerover', (p) => {
            if (!this._helpPressed) this.help.setTexture('help_hover');
            this.showTooltip(() => this._helpTooltipText(), p.x, p.y, this.help);
        });
        this.help.on('pointerout', () => {
            if (!this._helpPressed) this.help.setTexture('help');
            if (this._tooltipTarget === this.help) this.hideTooltip();
        });
        this.help.on('pointerdown', () => {
            this._helpPressed = true;
            this.help.setTexture('help_open');
        });
        this.help.setOrigin(0.5, 0.5).setScale(3 * s);
        this.uiLayer.add(this.help);

        this.input.on('pointerup', () => {
            this._releasePressButton('_helpPressed', this.help, 'help');
        });
    },

    /** Clear a momentary press texture. */
    _releasePressButton(flagName, image, key) {
        if (!this[flagName] || !image) return;
        this[flagName] = false;
        const p = this.input.activePointer;
        const over = pointerHitsInteractive(image, p);
        const hoverKey = `${key}_hover`;
        image.setTexture(over ? hoverKey : key);
    },

    _helpTooltipText() {
        return [
            "WASD / Arrows — Move",
            "Shift — Sprint",
            "Space — Use / place / attack",
            "R — Rotate placement",
            "Shift+R — Rotate counter-clockwise",
            "Mouse — Aim attacks",
            "Left-click — Pick up / interact",
            "Right-click — Move 1 item",
            "Shift+Right-click — Move whole stack",
            "Ctrl+Right-click — Move half stack",
            "Q — Drop item",
            "Shift+Q — Drop stack",
            "Ctrl+Q — Drop 10",
            "F — Pick up dropped items",
            "1-9 — Hotbar slots",
            "C — Crafting",
            "E — Equipment",
            "H — Health",
            "T — Chat",
            ". / , — Next / previous party member",
            "Ctrl+1–6 — Select party member"
        ].join("\n");
    },

    createDeathOverlay() {
        this.deathOverlay = this.add.container(0, 0).setScrollFactor(0).setDepth(20000).setVisible(false);
        this.uiLayer.add(this.deathOverlay);
        this.deathBg = this.add.rectangle(0, 0, 400, 200, 0x000000, 0.75).setOrigin(0.5);
        this.deathTitle = crispUiText(this.add.text(0, -50, "You died", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "32px",
            color: "#ff6666",
            align: "center"
        }).setOrigin(0.5));
        this.deathRespawn = crispUiText(this.add.text(0, 20, "[ Respawn ]", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#e8e0d0"
        }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
        this.deathRespawnHere = crispUiText(this.add.text(0, 55, "[ Respawn Here (dev) ]", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#aaa090"
        }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
        this.deathOverlay.add([this.deathBg, this.deathTitle, this.deathRespawn, this.deathRespawnHere]);
        this.deathRespawn.on("pointerdown", () => this.respawnPlayer(false));
        this.deathRespawnHere.on("pointerdown", () => this.respawnPlayer(true));
        this._deathPos = { x: 0, y: 0 };
        this._pendingDeathText = null;
    },

    _yieldWorldBoot() {
        this._syncWaterSprite?.();
        this.syncCameraToPlayer?.();
        this._pumpChunkPaint?.();
        return new Promise((resolve) => {
            if (this.time?.delayedCall) this.time.delayedCall(0, resolve);
            else setTimeout(resolve, 0);
        });
    },

    /** Wait until chunks in a Chebyshev radius around a world point are visually loaded. */
    async _awaitChunksAround(wx, wy, radius) {
        const px = this.chunkPx();
        const ocx = Math.floor(wx / px);
        const ocy = Math.floor(wy / px);
        const r = Math.max(0, radius | 0);
        if (this.simAuth() && Number.isFinite(wx) && Number.isFinite(wy)) {
            if (this.net?.ensureChunksAround) this.net.ensureChunksAround(wx, wy, r);
            else this._netSendMove?.(true);
        }
        const cells = [];
        for (let y = ocy - r; y <= ocy + r; y++) {
            for (let x = ocx - r; x <= ocx + r; x++) {
                cells.push({ x, y, key: this.getKey(x, y) });
            }
        }
        const deadline = performance.now() + 60000;
        while (this.sys?.isActive?.() && !this._leavingGame && performance.now() < deadline) {
            let waiting = false;
            for (const cell of cells) {
                let ch = this.chunks[cell.key];
                if (!ch) {
                    ch = new Chunk(this, cell.x, cell.y);
                    this.chunks[cell.key] = ch;
                }
                const hasTiles = !!(ch.isGenerated || ch.meta?.tiles?.some?.((t) => t));
                if (!hasTiles) {
                    if (this.simAuth()) {
                        waiting = true;
                        continue;
                    }
                }
                if (!ch.isLoaded) {
                    waiting = true;
                    await ch.load();
                    await this._yieldWorldBoot();
                }
            }
            if (!waiting && cells.every((c) => this.chunks[c.key]?.isLoaded)) return;
            if (this.simAuth()) {
                if (this.net?.ensureChunksAround) this.net.ensureChunksAround(wx, wy, r);
                else this._netSendMove?.(true);
            }
            await this._yieldWorldBoot();
        }
    },

    async _runWorldBoot() {
        if (!this._isSingleplayerSession()) {
            this._worldBooting = false;
            this._hideGeneratingOverlay();
            return;
        }
        this._worldBooting = true;
        this._showGeneratingOverlay();
        this._syncWaterSprite();
        this.syncCameraToPlayer();
        try {
            try { this.physics?.world?.pause?.(); } catch (_) {}
            try { this.net?.setPaused?.(true); } catch (_) {}
            const viewR = Math.max(1, Math.min(2, this.renderDistance || 2));
            if (!this._playerSpawnPlaced) {
                await this._awaitChunksAround(0, 0, 2);
                await this.ensureSpawnSign();
                this._syncWaterSprite();
                this.syncCameraToPlayer();
            }
            const p = this.player;
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
                await this._awaitChunksAround(p.x, p.y, viewR);
            }
            this.syncCameraToPlayer();
            this._syncWaterSprite();
            this._netSendMove(true);
        } catch (e) {
            console.warn("[world boot]", e);
            this._worldBooting = false;
            this._hideGeneratingOverlay();
            try { this.physics?.world?.resume?.(); } catch (_) {}
            try { this.net?.setPaused?.(false); } catch (_) {}
            if (this.sys?.isActive?.() && !this._leavingGame) {
                this.scene.start("SceneMenu", {});
            }
            return;
        }
        try { this.physics?.world?.resume?.(); } catch (_) {}
        try { this.net?.setPaused?.(false); } catch (_) {}
        this._hideGeneratingOverlay();
        this._worldBooting = false;
        if (this.sys?.isActive?.() && !this._leavingGame) this._startCharacterAutosave();
    },

    _formatPlayerDeathMessage(killer) {
        const victim = this.playerName || this.player?.displayName?.() || "Player";
        let killerName = null;
        if (typeof killer === "string") killerName = killer;
        else if (killer) {
            killerName = killer.displayName?.() || killer.def?.name || killer.name || null;
        }
        return NetProtocol.deathMessage(victim, killerName);
    },

    /** Popup only: your name → "You" ("You were slain by …" / "You died"). */
    _deathOverlayText(chatText) {
        const victim = this.playerName || this.player?.displayName?.() || "Player";
        const text = String(chatText || "").replace(/\.+$/, "");
        if (!text) return "You died";
        const slain = `${victim} was slain by `;
        if (victim && text.startsWith(slain)) {
            return `You were slain by ${text.slice(slain.length)}`;
        }
        if (victim && text === `${victim} died`) return "You died";
        return text
            .replace(/^.+ was slain by /, "You were slain by ")
            .replace(/^.+ died$/, "You died");
    },

    _applyDeathMessage(msg) {
        const text = String(msg || "").replace(/\.+$/, "") || this._formatPlayerDeathMessage();
        this._deathMessage = text;
        if (this.deathTitle) this.deathTitle.setText(this._deathOverlayText(text));
        this.layoutDeathOverlay();
    },

    onPlayerDied(killer, opts = {}) {
        const leader = this.leader || this.player;
        this.partySys.leaderDead = true;
        this.partySys.clearPvpAggro?.();
        this._deathPos = { x: leader.x, y: leader.y };
        leader._tendChannel = null;
        leader._skinChannel = null;
        leader._eatChannel = null;
        if (this.player === leader) this.hideChannelBar?.();
        this.corpsePanel?.close?.(true);
        const dedicated = !!(this.simAuth());
        const spawnCorpse = opts.spawnCorpse !== false;
        // Dedicated: spawn a pending local corpse with a shared id so you can
        // see/loot it immediately; server adopts that id on DIE.
        const deathCorpse = spawnCorpse
            ? leader.createDeathCorpse({
                spawn: true,
                combatDeath: !!killer,
                persist: !dedicated
            })
            : leader.createDeathCorpse({ spawn: false, combatDeath: !!killer });
        if (dedicated && deathCorpse?.entry) {
            deathCorpse.entry.netSync = true;
            deathCorpse.entry.pendingServer = true;
            deathCorpse.entry.pendingAt = performance.now();
            if (!this.netCorpses) this.netCorpses = new Map();
            this.netCorpses.set(deathCorpse.entry.id, deathCorpse);
        }
        leader.setVisible(false);
        if (leader.body) leader.body.enable = false;
        leader.setVelocity(0, 0);
        // Keep character autosave + server session aligned with emptied gear
        if (this._lastYou) {
            this._lastYou = {
                ...this._lastYou,
                inventory: leader.inventory,
                overflow: leader.overflow,
                equipment: leader.equipment,
                dead: true,
                leaderDead: true
            };
        }
        if (this.simAuth()) {
            if (spawnCorpse) {
                this.net.sendAction({
                    type: NetProtocol.Actions.DIE,
                    corpseId: deathCorpse?.entry?.id || null,
                    x: deathCorpse?.x,
                    y: deathCorpse?.y,
                    pawnId: leader.pawnId
                });
            }
        }
        const msg = (dedicated && this._pendingDeathText)
            ? this._pendingDeathText
            : this._formatPlayerDeathMessage(killer);
        this._pendingDeathText = null;
        this._applyDeathMessage(msg);
        if (!dedicated) this.combatLog?.push(msg);
        const showOverlay = this.player === leader || !this.partySys?.living?.()?.length;
        this.deathOverlay?.setVisible(showOverlay);
        this.layoutDeathOverlay();
        this.partyPanel?.refresh?.();
    },

    layoutDeathOverlay() {
        if (!this.deathOverlay) return;
        const s = this.uiScale || 1;
        this.deathOverlay.setPosition(this.scale.width / 2, this.scale.height / 2);
        if (typeof applyPixelUiFont === "function") {
            applyPixelUiFont(this.deathTitle, 32, s);
            applyPixelUiFont(this.deathRespawn, 16, s);
            applyPixelUiFont(this.deathRespawnHere, 16, s);
            this.deathTitle.setWordWrapWidth(Math.round(380 * s));
        } else {
            this.deathTitle.setFontSize(pixelUiFontSize(32, s));
            this.deathTitle.setWordWrapWidth(Math.round(380 * s));
            this.deathRespawn.setFontSize(pixelUiFontSize(16, s));
            this.deathRespawnHere.setFontSize(pixelUiFontSize(16, s));
        }
        this.deathTitle.setAlign("center");
        this.deathBg.setSize(420 * s, 220 * s);
    },

    /** Put pawns back on the continuous physics pose before the next step. */
    restorePlayerPhysicsPos() {
        const restore = (p) => {
            if (!p?.active || p._physX == null) return;
            if (p.x !== p._physX || p.y !== p._physY) p.setPosition(p._physX, p._physY);
        };
        for (const p of this.party || []) restore(p);
        if (this.player && !(this.party || []).includes(this.player)) restore(this.player);
        for (const s of this.settlers || []) restore(s);
        for (const w of this.partySys?.wanderers || []) restore(w);
    },

    /**
     * After physics: remember the true pose, then snap camera scroll and
     * on-screen pawns to integer screen pixels (1/zoom world units). Physics
     * keeps using the unsnapped pose via restorePlayerPhysicsPos on preupdate.
     * Camera scroll must be on the same grid as the sprites — otherwise an odd
     * viewport leaves everyone on a half-pixel and NEAREST shimmers while you
     * walk. Camera targets the sprite center (not feet / origin 0,1).
     */
    syncCameraToPlayer() {
        const player = this.player;
        const cam = this.cameras?.main;
        if (!player?.active || !cam) return;
        const z = this.worldZoom || cam.zoom || 1;
        const save = (p) => {
            if (!p?.active) return;
            p._physX = p.x;
            p._physY = p.y;
        };
        for (const p of this.party || []) save(p);
        if (!(this.party || []).includes(player)) save(player);
        for (const s of this.settlers || []) save(s);
        for (const w of this.partySys?.wanderers || []) save(w);

        const c = typeof player.bodyCenter === "function"
            ? player.bodyCenter()
            : { x: player.x, y: player.y };
        cam.centerOn(
            Math.round(c.x * z) / z,
            Math.round(c.y * z) / z
        );
        if (typeof snapCameraScrollToPixels === "function") snapCameraScrollToPixels(cam, z);
        else {
            cam.scrollX = Math.round(cam.scrollX * z) / z;
            cam.scrollY = Math.round(cam.scrollY * z) / z;
        }

        const view = cam.worldView;
        const pad = 64;
        const onScreen = (p) => {
            if (!view) return p === player;
            return p.x > view.x - pad && p.x < view.right + pad
                && p.y > view.y - pad && p.y < view.bottom + pad;
        };
        const snap = (p) => {
            if (!p?.active) return;
            if (p !== player && !onScreen(p)) return;
            const s = typeof snapWorldToScreenPixel === "function"
                ? snapWorldToScreenPixel(cam, p.x, p.y, z)
                : { x: Math.round(p.x * z) / z, y: Math.round(p.y * z) / z };
            if (p.x !== s.x || p.y !== s.y) p.setPosition(s.x, s.y);
            p.syncFxRoot?.();
        };
        for (const p of this.party || []) snap(p);
        if (!(this.party || []).includes(player)) snap(player);
        for (const s of this.settlers || []) snap(s);
        for (const w of this.partySys?.wanderers || []) snap(w);
    },

    respawnPlayer(here) {
        let x = 0;
        let y = 0;
        if (here && this._deathPos) {
            x = this._deathPos.x;
            y = this._deathPos.y;
        } else {
            // Same random free-tile ring as a new game (−4…4)
            const pick = this.pickRandomSpawnTile(4, Math.random);
            if (pick) {
                x = pick.x;
                y = pick.y;
            }
        }
        const leader = this.leader || this.player;
        leader.respawnFresh(x, y);
        if (this.partySys) this.partySys.leaderDead = false;
        if (this.player !== leader) this.partySys?.switchControl?.(leader, { silentNet: true });
        this._pendingDeathText = null;
        this.deathOverlay?.setVisible(false);
        this.closeOpenMenus();
        this.syncCameraToPlayer();
        this.healthPanel?.refresh?.();
        if (this.simAuth()) {
            this.net.sendAction({ type: NetProtocol.Actions.RESPAWN });
            this._netAwaitPoseFromYou = !here;
            this._netSendMove(true);
        }
    },

    /** Close side menus, world panels, channel bar, and chat compose. */
    closeOpenMenus() {
        this.hideChannelBar?.();
        if (this.craftMenuVisible) this.closeCraftMenu();
        if (this.equipmentPanel?.visible) this.equipmentPanel.close();
        if (this.healthPanel?.visible) this.healthPanel.close();
        if (this.corpsePanel?.visible) this.corpsePanel.close();
        if (this.campfirePanel?.visible) this.campfirePanel.close();
        if (this.storagePanel?.visible) this.storagePanel.close();
        if (this.leanToPanel?.visible) this.leanToPanel.close();
        if (this.paintingCirclePanel?.visible) this.paintingCirclePanel.close();
        if (this.settlementSys?.isNaming?.()) this.settlementSys._hideNamePrompt();
        if (typeof CraftTemplateUi !== "undefined") CraftTemplateUi.closeAll();
        if (this.researchTreePanel?.visible) this.researchTreePanel.close({ restore: false });
        if (this.settlementPanel?.visible) this.settlementSys?.closePanel?.();
        if (this.billsPanel?.visible) this.billsPanel.close();
        if (this.storageFilterPanel?.visible) this.storageFilterPanel.close();
        if (this.fuelFilterPanel?.visible) this.fuelFilterPanel.close();
        if (this.pigmentFilterPanel?.visible) this.pigmentFilterPanel.close();
        if (this.combatLog?.composing) this.combatLog.closeChat(false);
    },

    _anyGameplayMenuOpen() {
        return !!(
            this.craftMenuVisible ||
            this.equipmentPanel?.visible ||
            this.healthPanel?.visible ||
            this.corpsePanel?.visible ||
            this.campfirePanel?.visible ||
            this.storagePanel?.visible ||
            this.leanToPanel?.visible ||
            this.settlementPanel?.visible ||
            this.researchTreePanel?.visible ||
            this.billsPanel?.visible ||
            this.storageFilterPanel?.visible ||
            this.fuelFilterPanel?.visible ||
            this.pigmentFilterPanel?.visible ||
            this.paintingCirclePanel?.visible
        );
    },

    _isSingleplayerSession() {
        return !!(this.net?.isLocal || this.localWorldId);
    },

    _setWorldSimFrozen(on) {
        if (!this._isSingleplayerSession()) {
            if (this._worldSimFrozen) this._applyWorldSimFrozen(false);
            return;
        }
        const next = !!on;
        if (next === !!this._worldSimFrozen) return;
        this._applyWorldSimFrozen(next);
    },

    _applyWorldSimFrozen(on) {
        this._worldSimFrozen = !!on;
        if (on) {
            this.net?.setPaused?.(true);
            this.physics?.world?.pause?.();
            this.anims?.pauseAll?.();
            this._holdChatFade();
            return;
        }
        if (this._gamePaused) return;
        this.net?.setPaused?.(false);
        this.physics?.world?.resume?.();
        this.anims?.resumeAll?.();
        this._releaseChatFade();
    },

    _isUnderPauseUi(obj) {
        const ui = this._pauseUi;
        if (!ui || !obj) return false;
        const roots = [];
        for (const [k, n] of Object.entries(ui)) {
            if (!n || k === "dim") continue;
            if (Array.isArray(n.nodes)) roots.push(...n.nodes);
            else roots.push(n);
        }
        let cur = obj;
        while (cur) {
            if (roots.includes(cur)) return true;
            cur = cur.parentContainer;
        }
        return false;
    },

    _syncPauseCursor() {
        const pointer = this.input?.activePointer;
        const hits = pointer ? (this.input.hitTestPointer(pointer) || []) : [];
        let overBtn = false;
        for (let i = hits.length - 1; i >= 0; i--) {
            const obj = hits[i];
            if (!obj?.active || !obj.input?.enabled) continue;
            if (obj === this._pauseUi?.dim) continue;
            if (!this._isUnderPauseUi(obj)) continue;
            if (obj.input.useHandCursor || obj.input.cursor === "pointer") {
                overBtn = true;
                break;
            }
        }
        const cur = overBtn ? "pointer" : "default";
        this.input?.setDefaultCursor?.("default");
        try {
            if (this.game?.canvas) this.game.canvas.style.cursor = cur;
        } catch (_) {}
    },

    _pauseMenuButton(x, y, label, onClick, opts = {}) {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const s = this.uiScale || 1;
        const stroke = Math.max(2, Math.round(2 * s));
        const medium = opts.size === "medium";
        const fontPx = pixelUiFontSize(medium ? 16 : 24, s);
        const text = crispUiText(this.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${fontPx}px`,
            color: "#d4c4a8"
        }).setOrigin(0.5));
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(text, medium ? 16 : 24, s);
        // large = title Singleplayer / Multiplayer; medium = Back / Help / Create
        const bw = Math.round((medium ? 148 : 240) * s);
        const bh = Math.round((medium ? 38 : 52) * s);
        const rect = this.add.rectangle(0, 0, bw, bh, BG, 1)
            .setStrokeStyle(stroke, OUTLINE)
            .setInteractive({ useHandCursor: true });
        const root = this.add.container(x, y, [rect, text]);
        root.setLabel = (next) => {
            text.setText(String(next));
        };
        root.restoreHover = () => {
            hovering = true;
            pressing = false;
            paint();
            try {
                if (this.game?.canvas) this.game.canvas.style.cursor = "pointer";
            } catch (_) {}
        };
        let hovering = false;
        let pressing = false;
        const paint = () => {
            if (pressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(stroke, OUTLINE_PRESS);
            } else if (hovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(stroke, OUTLINE_HOVER);
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(stroke, OUTLINE);
            }
        };
        rect.on("pointerover", () => { hovering = true; paint(); });
        rect.on("pointerout", () => { hovering = false; pressing = false; paint(); });
        rect.on("pointerdown", () => { pressing = true; paint(); });
        rect.on("pointerup", () => {
            const was = pressing;
            pressing = false;
            paint();
            if (was && hovering) onClick?.();
        });
        return root;
    },

    _guiScaleFit() {
        if (typeof Settings !== "undefined") {
            return Settings.guiScaleFit(this.scale?.width, this.scale?.height);
        }
        const w = this.scale?.width || window.innerWidth || 1024;
        const h = this.scale?.height || window.innerHeight || 768;
        return Math.min(w / 640, h / 480);
    },

    /** Highest fixed integer GUI scale for this window. */
    getMaxGuiScaleOption() {
        if (typeof Settings !== "undefined") {
            return Settings.getMaxGuiScaleOption(this.scale?.width, this.scale?.height);
        }
        return Math.max(1, Math.floor(this._guiScaleFit()));
    },

    _autoUiScale() {
        return this.getMaxGuiScaleOption();
    },

    _guiScaleButtonLabel() {
        if (typeof Settings !== "undefined") {
            return Settings.guiScaleButtonLabel(this.guiScalePref);
        }
        const pref = this.guiScalePref | 0;
        return pref === 0 ? "GUI Scale: Auto" : `GUI Scale: ${pref}`;
    },

    _cycleGuiScale() {
        const max = this.getMaxGuiScaleOption();
        const next = typeof Settings !== "undefined"
            ? Settings.cycleGuiScale(this.guiScalePref, max)
            : ((this.guiScalePref | 0) + 1 > max ? 0 : (this.guiScalePref | 0) + 1);
        this.guiScalePref = next;
        if (typeof Settings !== "undefined") Settings.saveGuiScale(next);
        else {
            try { localStorage.setItem("cp_gui_scale", String(next)); } catch (_) {}
        }
        this.updateUiScale();
        this.applyUiScale();
        this.time?.delayedCall?.(0, () => this._pauseUi?.guiScale?.restoreHover?.());
    },

    _bindFullscreenWatch() {
        try { this._fullscreenWatchOff?.(); } catch (_) {}
        this._fullscreenWatchOff = null;
        const api = typeof window !== "undefined" ? window.cavePaintings : null;
        if (!api?.onFullscreen) return;
        this._fullscreenWatchOff = api.onFullscreen((on) => {
            if (typeof Settings !== "undefined") Settings.noteFullscreen(on);
            const label = typeof Settings !== "undefined"
                ? Settings.fullscreenButtonLabel(on)
                : (on ? "Fullscreen: On" : "Fullscreen: Off");
            this._pauseUi?.fullscreen?.setLabel?.(label);
        });
    },

    _fullscreenButtonLabel() {
        const on = typeof Settings !== "undefined" ? Settings.loadFullscreen() : false;
        return typeof Settings !== "undefined"
            ? Settings.fullscreenButtonLabel(on)
            : (on ? "Fullscreen: On" : "Fullscreen: Off");
    },

    async _cyclePauseFullscreen() {
        const api = typeof window !== "undefined" ? window.cavePaintings : null;
        let cur = typeof Settings !== "undefined" && Settings.loadFullscreen();
        try {
            if (api?.isFullscreen) cur = await api.isFullscreen();
        } catch (_) {}
        const next = !cur;
        if (typeof Settings !== "undefined") Settings.saveFullscreen(next);
        try { await api?.setFullscreen?.(next); } catch (e) { console.warn(e); }
        this._pauseUi?.fullscreen?.setLabel?.(this._fullscreenButtonLabel());
        this.time?.delayedCall?.(0, () => this._pauseUi?.fullscreen?.restoreHover?.());
    },

    _pauseAdd(node, depth = 50001) {
        if (!node) return node;
        this.uiLayer.add(node);
        node.setDepth?.(depth);
        node.setScrollFactor?.(0);
        this.uiLayer.bringToTop(node);
        return node;
    },

    _destroyPauseUi() {
        const ui = this._pauseUi;
        this._pauseUi = null;
        if (!ui) return;
        try { ui.volumeSlider?.destroy?.(); } catch (_) {}
        for (const [k, n] of Object.entries(ui)) {
            if (k === "volumeSlider") continue;
            try { n.destroy?.(true); } catch (_) {}
        }
    },

    _openPauseMenu() {
        if (this._gamePaused || this._leavingGame) return;
        this._gamePaused = true;
        this.closeOpenMenus();
        if (this.knappingPanel?.visible) this.knappingPanel.finishOrClose?.();
        if (this.clayFormingPanel?.visible) this.clayFormingPanel.finishOrClose?.();
        this.hideTooltip?.();
        const prevHover = this._hoverTarget;
        this._hoverTarget = null;
        if (prevHover?.active && prevHover.input?.enabled) {
            try { prevHover.emit("pointerout", this.input.activePointer); } catch (_) {}
        }

        this._holdChatFade();
        this._pausePage = "root";
        if (this._isSingleplayerSession()) {
            this.net?.setPaused?.(true);
            this.physics?.world?.pause?.();
            this.anims?.pauseAll?.();
        }
        this._buildPauseMenu();
    },

    _buildPauseMenu() {
        this._destroyPauseUi();
        if (!this._gamePaused || this._leavingGame) return;
        const w = this.scale.width;
        const h = this.scale.height;
        const dim = this.add.rectangle(w / 2, h / 2, w + 4, h + 4, 0x000000, 0.55)
            .setInteractive({ cursor: "default", useHandCursor: false })
            .setScrollFactor(0);
        this._pauseAdd(dim, 50000);
        if (this._pausePage === "options") this._fillPauseOptions(dim, w, h);
        else this._fillPauseRoot(dim, w, h);
        this._syncPauseCursor();
    },

    _pauseRootLayout(w, h) {
        const s = this.uiScale || 1;
        const titleFs = pixelUiFontSize(32, s);
        const btnH = Math.round(52 * s);
        const gap = Math.round(60 * s);
        const titleGap = Math.round(24 * s);
        const pad = Math.round(16 * s);
        const totalH = titleFs + titleGap + btnH + gap * 2;
        let titleY = Math.round(h / 2 - totalH / 2 + titleFs / 2);
        titleY = Math.max(titleFs / 2 + pad, titleY);
        const y0 = Math.round(titleY + titleFs / 2 + titleGap + btnH / 2);
        return { s, titleFs, btnH, gap, titleY, y0 };
    },

    _fillPauseRoot(dim, w, h) {
        const L = this._pauseRootLayout(w, h);
        const title = crispUiText(this.add.text(w / 2, L.titleY,
            this._isSingleplayerSession() ? "Paused" : "Menu", {
                fontFamily: PIXEL_UI_FONT,
                fontSize: `${pixelUiFontSize(32, L.s)}px`,
                color: "#e8dcc8"
            }).setOrigin(0.5));
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(title, 32, L.s);
        const quitLabel = this._isSingleplayerSession() ? "Save and Quit" : "Leave Game";
        const resume = this._pauseMenuButton(w / 2, L.y0, "Resume", () => this._closePauseMenu());
        const options = this._pauseMenuButton(
            w / 2,
            L.y0 + L.gap,
            "Options",
            () => {
                this._pausePage = "options";
                this._buildPauseMenu();
            }
        );
        const quit = this._pauseMenuButton(w / 2, L.y0 + L.gap * 2, quitLabel, () => this._leaveGame());
        this._pauseAdd(title);
        this._pauseAdd(resume);
        this._pauseAdd(options);
        this._pauseAdd(quit);
        this._pauseUi = { dim, title, resume, options, quit };
    },

    _pauseOptionsLayout(h) {
        const s = this.uiScale || 1;
        const fs = typeof window !== "undefined" && window.cavePaintings?.diskSaves;
        const titleFs = pixelUiFontSize(32, s);
        const guiH = Math.round(38 * s);
        const backH = Math.round(38 * s);
        const titleGap = Math.round(16 * s);
        const gap = Math.round(10 * s);
        const inner = Math.round(8 * s);
        const sliderH = Math.round(16 * s);
        const handlePad = Math.round(4 * s);
        const labelSlot = Math.round(12 * s);
        const pad = Math.round(12 * s);
        const y0Off = Math.round(titleFs / 2) + titleGap + Math.round(guiH / 2);
        const fsYOff = fs ? y0Off + guiH + gap : y0Off;
        const volLabelTopOff = (fs ? fsYOff : y0Off) + Math.round(guiH / 2) + gap;
        const sliderYOff = volLabelTopOff + labelSlot + inner;
        const backYOff = sliderYOff + sliderH + handlePad + gap + Math.round(guiH / 2);
        const totalH = titleFs + titleGap + guiH / 2 + backYOff + backH / 2;
        let titleY = Math.round(h / 2 - totalH / 2 + titleFs / 2);
        titleY = Math.max(titleFs / 2 + pad, titleY);
        return {
            s,
            fs,
            titleFs,
            titleY,
            y0: titleY + y0Off,
            fsY: titleY + fsYOff,
            volLabelY: titleY + volLabelTopOff,
            sliderY: titleY + sliderYOff,
            backY: titleY + backYOff,
            sliderW: Math.round(280 * s)
        };
    },

    _pauseOptionsPanelGeom(w, h) {
        const L = this._pauseOptionsLayout(h);
        const s = L.s;
        const btnH = Math.round(38 * s);
        const padX = Math.round(28 * s);
        const padY = Math.round(16 * s);
        const top = L.titleY - Math.round(12 * s);
        const bot = L.backY + btnH / 2;
        return {
            x: w / 2,
            y: (top + bot) / 2,
            width: L.sliderW + Math.round(56 * s) + padX * 2,
            height: (bot - top) + padY * 2
        };
    },

    _fillPauseOptions(dim, w, h) {
        const L = this._pauseOptionsLayout(h);
        const panelG = this._pauseOptionsPanelGeom(w, h);
        const panel = this.add.rectangle(panelG.x, panelG.y, panelG.width, panelG.height, 0x1a1510, 0.92)
            .setStrokeStyle(Math.max(2, Math.round(2 * (this.uiScale || 1))), 0x6a5a45);
        const title = crispUiText(this.add.text(w / 2, L.titleY, "Options", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(32, L.s)}px`,
            color: "#e8dcc8"
        }).setOrigin(0.5));
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(title, 32, L.s);
        const guiScale = this._pauseMenuButton(
            w / 2,
            L.y0,
            this._guiScaleButtonLabel(),
            () => this._cycleGuiScale(),
            { size: "medium" }
        );
        let fullscreenBtn = null;
        if (L.fs) {
            fullscreenBtn = this._pauseMenuButton(
                w / 2,
                L.fsY,
                this._fullscreenButtonLabel(),
                () => this._cyclePauseFullscreen(),
                { size: "medium" }
            );
        }
        const volLabel = crispUiText(this.add.text(w / 2, L.volLabelY, "Music Volume", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(16, L.s)}px`,
            color: "#d4c4a8"
        }).setOrigin(0.5, 0));
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(volLabel, 16, L.s);
        const sliderW = L.sliderW;
        const volumeSlider = Settings.makePercentSlider(this, {
            x: Math.floor(w / 2 - sliderW / 2),
            y: Math.round(L.sliderY),
            width: sliderW,
            height: Math.round(16 * L.s),
            scale: L.s,
            value: Settings.loadMusicVolume(),
            onChange: (n) => {
                Settings.saveMusicVolume(n);
                if (typeof GameMusic !== "undefined") GameMusic.applyVolume();
            }
        });
        const back = this._pauseMenuButton(w / 2, L.backY, "Back", () => {
            this._pausePage = "root";
            this._buildPauseMenu();
        }, { size: "medium" });
        this._pauseAdd(panel);
        this._pauseAdd(title);
        this._pauseAdd(guiScale);
        if (fullscreenBtn) this._pauseAdd(fullscreenBtn);
        this._pauseAdd(volLabel);
        for (const n of volumeSlider.nodes) this._pauseAdd(n);
        this._pauseAdd(back);
        this._pauseUi = { dim, panel, title, guiScale, fullscreen: fullscreenBtn, volLabel, volumeSlider, back };
    },

    _closePauseMenu() {
        if (!this._gamePaused) return;
        this._releaseChatFade();
        this._gamePaused = false;
        this._pausePage = "root";
        if (this._isSingleplayerSession()) {
            this.net?.setPaused?.(false);
            this.physics?.world?.resume?.();
            this.anims?.resumeAll?.();
        }
        this._destroyPauseUi();
        this.input?.setDefaultCursor?.("default");
        try {
            if (this.game?.canvas) this.game.canvas.style.cursor = "default";
        } catch (_) {}
    },

    /** Clock used by combat-log / speech-bubble fade. Frozen while the pause menu is up. */
    _chatFadeNow() {
        if (this._chatFadeHold != null) return this._chatFadeHold;
        return this.time?.now || 0;
    },

    _holdChatFade() {
        if (this._chatFadeHold != null) return;
        this._chatFadeHold = this.time?.now || 0;
    },

    _releaseChatFade() {
        if (this._chatFadeHold == null) return;
        const now = this.time?.now || 0;
        const dt = now - this._chatFadeHold;
        this._chatFadeHold = null;
        if (!(dt > 0)) return;
        this._shiftChatFade(dt);
    },

    _shiftChatFade(dt) {
        const n = Number(dt);
        if (!(n > 0)) return;
        this.combatLog?.shiftFade?.(n);
        const seen = new Set();
        const bumpPawn = (p) => {
            if (!p || seen.has(p)) return;
            seen.add(p);
            const until = Number(p.chatBubbleUntil);
            if (Number.isFinite(until) && until > 0) p.chatBubbleUntil = until + n;
        };
        bumpPawn(this.player);
        for (const p of this.party || []) bumpPawn(p);
        for (const s of this.settlers || []) bumpPawn(s);
        for (const w of this.partySys?.wanderers || []) bumpPawn(w);
        for (const entry of this.remotePlayers?.values?.() || []) {
            const until = Number(entry.bubbleUntil);
            if (Number.isFinite(until) && until > 0) entry.bubbleUntil = until + n;
        }
    },

    _layoutPauseMenu() {
        if (this._generatingUi) {
            this._layoutGeneratingOverlay();
            return;
        }
        if (this._savingUi) {
            const w = this.scale.width;
            const h = this.scale.height;
            this._savingUi.bg?.setPosition(w / 2, h / 2).setSize(w + 4, h + 4);
            this._savingUi.text?.setPosition(w / 2, h / 2);
            return;
        }
        if (!this._pauseUi || !this._gamePaused) return;
        const w = this.scale.width;
        const h = this.scale.height;
        const ui = this._pauseUi;
        ui.dim?.setPosition(w / 2, h / 2).setSize(w + 4, h + 4);
        if (this._pausePage === "options") {
            const L = this._pauseOptionsLayout(h);
            const pg = this._pauseOptionsPanelGeom(w, h);
            ui.panel?.setPosition(pg.x, pg.y).setSize(pg.width, pg.height);
            ui.title?.setPosition(w / 2, L.titleY);
            ui.guiScale?.setPosition(w / 2, L.y0);
            ui.guiScale?.setLabel?.(this._guiScaleButtonLabel());
            ui.fullscreen?.setPosition(w / 2, L.fsY);
            ui.fullscreen?.setLabel?.(this._fullscreenButtonLabel());
            ui.volLabel?.setPosition(w / 2, L.volLabelY);
            ui.volumeSlider?.setPosition?.(Math.floor(w / 2 - L.sliderW / 2), Math.round(L.sliderY));
            ui.back?.setPosition(w / 2, L.backY);
            return;
        }
        const L = this._pauseRootLayout(w, h);
        ui.title?.setPosition(w / 2, L.titleY);
        ui.resume?.setPosition(w / 2, L.y0);
        ui.options?.setPosition(w / 2, L.y0 + L.gap);
        ui.quit?.setPosition(w / 2, L.y0 + L.gap * 2);
    },

    /** Full menu-colored screen while quit saves finish — blocks quick rejoin races. */
    _showSavingScreen() {
        if (this._pauseUi) {
            this._destroyPauseUi();
        }
        this._gamePaused = true;
        if (this._isSingleplayerSession()) {
            try { this.net?.setPaused?.(true); } catch (_) {}
            try { this.physics?.world?.pause?.(); } catch (_) {}
            // Do not pauseAll here — it is global and the scene is about to stop.
            // Pause-menu pauseAll is resumed in shutdown / the next create().
        }
        try { this.cameras?.main?.setBackgroundColor?.("#1a1510"); } catch (_) {}

        const w = this.scale.width;
        const h = this.scale.height;
        const bg = this.add.rectangle(w / 2, h / 2, w + 4, h + 4, 0x1a1510, 1)
            .setInteractive()
            .setScrollFactor(0)
            .setDepth(50000);
        const text = crispUiText(this.add.text(w / 2, h / 2, "Saving...", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(32, 1)}px`,
            color: "#e8dcc8"
        }).setOrigin(0.5).setScrollFactor(0).setDepth(50001));
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(text, 32, this.uiScale || 1);
        this.uiLayer.add(bg);
        this.uiLayer.add(text);
        this.uiLayer.bringToTop(bg);
        this.uiLayer.bringToTop(text);
        this._savingUi = { bg, text };
    },

    _showGeneratingOverlay() {
        if (this._generatingUi?.root?.active) {
            this._layoutGeneratingOverlay();
            return;
        }
        this._hideGeneratingOverlay();
        try { this.cameras?.main?.setBackgroundColor?.("#1a1510"); } catch (_) {}
        const w = this.scale.width;
        const h = this.scale.height;
        const bg = this.add.rectangle(w / 2, h / 2, w + 4, h + 4, 0x1a1510, 1)
            .setScrollFactor(0)
            .setInteractive({ cursor: "default", useHandCursor: false });
        const text = crispUiText(this.add.text(w / 2, h / 2, "Generating world...", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(32, 1)}px`,
            color: "#e8dcc8"
        }).setOrigin(0.5).setScrollFactor(0).setVisible(false));
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(text, 32, this.uiScale || 1);
        const root = this.add.container(0, 0, [bg, text]).setDepth(50000).setScrollFactor(0);
        this.uiLayer?.add(root);
        this.uiLayer?.bringToTop?.(root);
        this._generatingUi = { root, bg, text };
        // Overlay lives on the UI camera; world-camera hits (trees, camp, party
        // sprites) would still steal the hand cursor if main input stays on.
        if (this.cameras?.main) this.cameras.main.inputEnabled = false;
        try { this.input?.setDefaultCursor?.("default"); } catch (_) {}
        try {
            if (this.game?.canvas) this.game.canvas.style.cursor = "default";
        } catch (_) {}
        // Skip the label on sub-frame / couple-of-frame boots; keep the hold either way.
        try { this._generatingLabelTimer?.remove?.(false); } catch (_) {}
        this._generatingLabelTimer = this.time?.delayedCall?.(100, () => {
            this._generatingLabelTimer = null;
            const ui = this._generatingUi;
            if (!ui?.text?.active) return;
            ui.text.setVisible(true);
        }) || null;
    },

    _layoutGeneratingOverlay() {
        const ui = this._generatingUi;
        if (!ui) return;
        const w = this.scale.width;
        const h = this.scale.height;
        ui.bg?.setPosition(w / 2, h / 2).setSize(w + 4, h + 4);
        if (ui.text) {
            if (typeof applyPixelUiFont === "function") applyPixelUiFont(ui.text, 32, this.uiScale || 1);
            ui.text.setPosition(w / 2, h / 2);
        }
        if (ui.root && this.uiLayer) this.uiLayer.bringToTop(ui.root);
    },

    _hideGeneratingOverlay() {
        try { this._generatingLabelTimer?.remove?.(false); } catch (_) {}
        this._generatingLabelTimer = null;
        const ui = this._generatingUi;
        this._generatingUi = null;
        if (this.cameras?.main) this.cameras.main.inputEnabled = true;
        try { ui?.root?.destroy?.(true); } catch (_) {}
    },

    async _leaveGame() {
        if (this._leavingGame) return;
        this._leavingGame = true;
        this._netLeaving = true;
        this._netDisconnectHandled = true;
        try { this.input?.setDefaultCursor?.("default"); } catch (_) {}
        try {
            if (this.game?.canvas) this.game.canvas.style.cursor = "default";
        } catch (_) {}
        // Drop the close handler before closing the socket so onclose cannot
        // race into the Disconnected screen after an intentional Leave.
        this._unbindNetClose();
        this._teardownCharacterAutosave();
        this.closeOpenMenus();
        this._showSavingScreen();

        try {
            await this._saveCharacterNow(null, { final: true });
            this._charSaveFrozen = true;
            if (this.net?.isLocal) {
                await this.net.close();
            } else if (this.net) {
                try { this.net.close(); } catch (_) {}
            }
            // Let IndexedDB transactions finish before the menu accepts Play again.
            await new Promise((r) => setTimeout(r, 50));
        } catch (e) {
            console.warn("[leave game]", e);
        }

        if (this.sys?.isActive?.()) {
            // Phaser keeps the previous SceneMenu data when the 2nd arg is omitted,
            // so a prior { disconnected: true } would replay on Leave. Always pass {}.
            this.scene.start("SceneMenu", {});
        }
    },

    _handleEscapeKey() {
        if (this._leavingGame || this._worldBooting) return;
        if (!Phaser.Input.Keyboard.JustDown(this.keyEsc)) return;
        if (typeof CraftTemplateUi !== "undefined" && CraftTemplateUi.isOpen()) {
            CraftTemplateUi.handleEsc();
            return;
        }
        if (this.settlementSys?.isNaming?.()) {
            this.settlementSys._hideNamePrompt();
            return;
        }
        if (this.researchTreePanel?.visible) {
            this.researchTreePanel.handleEsc();
            return;
        }
        if (this.billsPanel?.visible) {
            this.billsPanel.handleEsc();
            return;
        }
        if (this.storageFilterPanel?.visible) {
            this.storageFilterPanel.handleEsc();
            return;
        }
        if (this.fuelFilterPanel?.visible) {
            this.fuelFilterPanel.handleEsc();
            return;
        }
        if (this.pigmentFilterPanel?.visible) {
            this.pigmentFilterPanel.handleEsc();
            return;
        }
        if (this.combatLog?.composing) return; // CombatLog closes chat
        if (this.knappingPanel?.visible) {
            this.knappingPanel.finishOrClose?.();
            return;
        }
        if (this.clayFormingPanel?.visible) {
            this.clayFormingPanel.handleEsc?.();
            return;
        }
        if (this._gamePaused) {
            if (this._pausePage === "options") {
                this._pausePage = "root";
                this._buildPauseMenu();
            } else {
                this._closePauseMenu();
            }
            return;
        }
        if (this._anyGameplayMenuOpen()) {
            this.closeOpenMenus();
            return;
        }
        this._openPauseMenu();
    },

    toggleHealthMenu() {
        if (!this.healthPanel) return;
        if (this._sculptUiOpen()) return;
        if (isHudTextOpen(this)) return;
        // Any health view open (own or corpse inspect) → close panel only
        if (this.healthPanel.visible) {
            this.healthPanel.close();
            return;
        }
        // Side menus exclude each other; also close the settlement overlay
        if (this.craftMenuVisible) this.closeCraftMenu();
        if (this.equipmentPanel?.visible) this.equipmentPanel.close();
        if (this.settlementPanel?.visible) this.settlementSys?.closePanel?.();
        this.healthPanel.open();
    },

    /** Close the station-filtered craft list and Take / Add / Bills chrome. */
    closeCraftStationMenu() {
        if (!this._craftFromStation && !this._craftStationThing) return;
        const thing = this._craftStationThing;
        if (this.billsPanel?.visible && (!thing || this.billsPanel.thing === thing)) {
            this.billsPanel.close();
        }
        this.closeCraftMenu();
    },

    _hideCraftStationChrome() {
        this._craftSettleUi?.btn?.setVisible?.(false);
        this._craftSettleUi?.rect?.disableInteractive?.();
        this._craftBillUi?.btn?.setVisible?.(false);
        this._craftBillUi?.rect?.disableInteractive?.();
        this._layoutCraftTakeButton();
    },

    _isSameCraftStation(thing) {
        const cur = this._craftStationThing;
        if (!thing || !cur) return false;
        if (cur === thing) return true;
        const a = cur.entry?.uid;
        const b = thing.entry?.uid;
        return !!(a && b && a === b);
    },

    _stationInteractVisible(thing) {
        if (!thing?.active) return false;
        if (this.craftMenuVisible && this._craftFromStation && this._isSameCraftStation(thing)) {
            return true;
        }
        const bills = this.billsPanel;
        if (bills?.visible && bills.thing) {
            if (bills.thing === thing) return true;
            const a = bills.thing.entry?.uid;
            const b = thing.entry?.uid;
            if (a && b && a === b) return true;
        }
        return false;
    },

    _refreshStationInteractMarks(...things) {
        const seen = new Set();
        const sync = (t) => {
            if (!t || seen.has(t)) return;
            seen.add(t);
            t._syncInteractMark?.();
        };
        for (const t of things) sync(t);
        sync(this._craftStationThing);
        sync(this.billsPanel?.thing);
    },

    _liveCraftStation(station) {
        if (station?.active) return station;
        const uid = station?.entry?.uid;
        return uid ? this.findCraftStationByUid(uid) : null;
    },

    closeCraftMenu() {
        const was = this.craftMenuVisible;
        const station = this._craftStationThing;
        this.craftMenuVisible = false;
        this._craftStationThing = null;
        this._craftFromStation = false;
        this._craftMenuSig = null;
        this.craftContainer?.setVisible(false);
        this._hideCraftStationChrome();
        this._hostCraftMenu?.();
        this._refreshStationInteractMarks(station);
        if (this._isUnderCraftMenu?.(this._tooltipTarget)) this.hideTooltip?.();
        if (this._isUnderCraftMenu?.(this._hoverTarget)) this._hoverTarget = null;
        if (!was) return;
        const p = this.input.activePointer;
        const hovering = pointerHitsInteractive(this.craft, p);
        this.craft.setTexture(hovering ? 'craft_hover' : 'craft');
        // Dedicated: apply any YOU gear that arrived while craft UI was open
        this._flushPendingYouGear?.();
    },

    toggleCraftMenu() {
        if (this._sculptUiOpen()) return;
        if (isHudTextOpen(this)) return;
        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        if (now - (this._craftToggleAt || 0) < 80) return;
        this._craftToggleAt = now;
        if (this.craftMenuVisible) {
            if (this._craftFromStation) this.closeCraftStationMenu();
            else this.closeCraftMenu();
            return;
        }
        if (this.equipmentPanel?.visible) this.equipmentPanel.close();
        if (this.healthPanel?.visible) this.healthPanel.close();
        if (this.settlementPanel?.visible) this.settlementSys?.closePanel?.();
        this._craftStationThing = null;
        this._craftFromStation = false;
        this._craftPage = 0;
        this.craftMenuVisible = true;
        this.refreshCraftMenu();
        this.positionCraftMenu();
        this.craftContainer.setVisible(true);
        this.craft.setTexture('craft_open');
    },

    toggleCraftStationMenu(thing) {
        if (!thing || this._sculptUiOpen()) return;
        if (isHudTextOpen(this)) return;
        if (this.player?._resting) return;
        if (this.craftMenuVisible && this._craftFromStation && (
            !this._craftStationThing || this._isSameCraftStation(thing)
        )) {
            this.closeCraftStationMenu();
            return;
        }
        if (this.craftMenuVisible && !this._craftFromStation) this.closeCraftMenu();
        if (this.equipmentPanel?.visible) this.equipmentPanel.close();
        if (this.healthPanel?.visible) this.healthPanel.close();
        if (this.settlementPanel?.visible) this.settlementSys?.closePanel?.();
        if (this.corpsePanel?.visible) this.corpsePanel.close();
        if (this.storagePanel?.visible) this.storagePanel.close();
        if (this.campfirePanel?.visible) this.campfirePanel.close();
        if (this.leanToPanel?.visible) this.leanToPanel.close();
        if (this.paintingCirclePanel?.visible) this.paintingCirclePanel.close();
        if (this.billsPanel?.visible && this.billsPanel.thing !== thing) this.billsPanel.close();
        if (this.storageFilterPanel?.visible) this.storageFilterPanel.close();
        if (this.fuelFilterPanel?.visible) this.fuelFilterPanel.close();
        if (this.pigmentFilterPanel?.visible) this.pigmentFilterPanel.close();
        const prev = this._craftStationThing;
        this._craftStationThing = thing;
        this._craftFromStation = true;
        this._craftPage = 0;
        this.craftMenuVisible = true;
        this.refreshCraftMenu();
        this.positionCraftMenu();
        this.craftContainer.setVisible(true);
        this.craft.setTexture('craft_open');
        this._refreshStationInteractMarks(prev, thing);
    },

    _updateCraftStationMenu() {
        if (this._craftFromStation || this._craftStationThing) {
            const station = this._liveCraftStation(this._craftStationThing);
            if (station && station !== this._craftStationThing) {
                this._craftStationThing = station;
                this._layoutCraftTakeButton();
                this._layoutCraftSettle();
            }
            if (!this.craftMenuVisible || !station?.active || !station.inRange?.()) {
                this.closeCraftStationMenu();
                return;
            }
            this._syncCraftTakeHover();
            return;
        }
        if (!this.craftMenuVisible) {
            if (this._craftTakeBtn?.visible || this._craftSettleUi?.btn?.visible
                || this._craftBillUi?.btn?.visible) {
                this._hideCraftStationChrome();
            }
            return;
        }
        const sig = this.nearbyCraftStationIds().join(",");
        if (sig !== this._craftNearbySig) {
            this._craftNearbySig = sig;
            this.refreshCraftMenu();
        }
    },

    toggleEquipmentMenu() {
        if (!this.equipmentPanel) return;
        if (this._sculptUiOpen()) return;
        if (isHudTextOpen(this)) return;
        this.equipmentPanel.toggle();
    },
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
