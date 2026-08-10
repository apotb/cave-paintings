class SceneMain extends SceneBase {
    constructor() {
        super({ key: "SceneMain" });
    }

    create() {
        this.input.mouse.disableContextMenu();
        resolveCraftedWeights(this.items());
        resolveCraftedFuel(this.items());

        // Layers
        this.groundLayer = this.add.layer().setDepth(0);
        this.mainLayer = this.add.layer().setDepth(1);
        this.uiLayer = this.add.layer().setDepth(2);

        // Chunks
        this.chunkSize = 8;
        this.tileSize = 16;
        this.worldZoom = 3;
        this.chunks = {};
        this.chunkDebug = false;
        this.updateChunkDistances();
        this.updateUiScale();
        this.scale.on("resize", () => {
            this.updateChunkDistances();
            this.updateUiScale();
            this.applyUiScale();
        });

        // Water
        this._waterSprite = this.add.tileSprite(
            this.scale.width / 2, this.scale.height / 2,
            (roundUpToEven(this.scale.width / this.tileSize / this.worldZoom) + 2) * this.tileSize,
            (roundUpToEven(this.scale.height / this.tileSize / this.worldZoom) + 2) * this.tileSize,
            'water', 0
        ).setDepth(-1);
        this._waterFrame = 1;
        this.time.addEvent({
            delay: 500,
            callback: this.animateWater,
            callbackScope: this,
            loop: true 
        });
        this.groundLayer.add(this._waterSprite);

        // Combat targets (player, animals/monsters)
        this.damageables = this.add.group();
        this.mobs = this.physics.add.group();
        this.meleeSlots = new MeleeSlots(this);

        // Player
        this.player = new Player(this, 0, 0);
        this.damageables.add(this.player);
        /** One-time spawn setup: sign at (0,0), player in random free tile nearby. */
        this._spawnSignPlaced = false;
        this._spawnSignBusy = false;
        this._playerSpawnPlaced = false;
        // Manual camera follow (see syncCameraToPlayer). startFollow(..., true) floors
        // scroll while the player stays fractional → whole-world diagonal shake.
        // Snap to the screen-pixel grid (1/zoom world units) instead; physics untouched.
        this.cameras.main.setZoom(this.worldZoom);
        this.cameras.main.setRoundPixels(false);
        this.syncCameraToPlayer();

        // In-game clock: 1 game minute per real second, starts Day 1 08:00
        this.gameDay = 1;
        this.gameMinutes = 8 * 60;
        this.tickSpeed = 1;
        this._worldMinuteEvent = this.time.addEvent({
            delay: 1000,
            callback: this.worldMinuteTick,
            callbackScope: this,
            loop: true
        });

        // Collisions
        this._things = this.physics.add.staticGroup();
        this.physics.add.collider(this.player, this._things);
        // Overlap only — collider was body-checking / shoving the player during melee
        this.physics.add.overlap(this.player, this.mobs);
        this.physics.add.collider(this.mobs, this._things);
        this.droppedItems = this.add.group();

        // UI
        this.cameras.main.ignore(this.uiLayer);
        // No roundPixels on UI — overlays pinned to world sprites are pre-rounded to match
        // the main camera's setQuad snap; a second pass makes chat bubbles crawl while moving.
        this._uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height)
            .setScroll(0, 0)
            .setZoom(1)
            .setRoundPixels(false);
        let cameras = [this.groundLayer, this.mainLayer];
        if (this.physics.world.debug) cameras.push(this.physics.world.debugGraphic);
        this._uiCam.ignore(cameras);
        this.createLightVeil();
        this.createBars();
        this.hotbar = new Hotbar(this);
        this.createTooltip();
        this.createClockDisplay();
        this.combatLog = new CombatLog(this);
        this.createCraftMenu();
        this.createButtons();
        this.equipmentPanel = new EquipmentPanel(this);
        this.campfirePanel = new CampfirePanel(this);
        this.corpsePanel = new CorpsePanel(this);
        this.healthPanel = new HealthPanel(this);
        this.knappingPanel = new KnappingPanel(this);
        this.createDeathOverlay();
        this.applyUiScale();

        // Inputs
        this.key1 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
        this.key2 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
        this.key3 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);
        this.key4 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR);
        this.key5 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FIVE);
        this.key6 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SIX);
        this.key7 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SEVEN);
        this.key8 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.EIGHT);
        this.key9 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.NINE);
        this.key0 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ZERO);
        this.keyC = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);
        this.keyE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
        this.keyG = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G);
        this.keyH = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.H);
        this.keyT = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.T);
        /** Singleplayer chat display name */
        this.playerName = "Player";
    }

    createBars() {
        // Channel bar is parented to the player's fxRoot (world space) so it
        // stays locked after the render snap — see showChannelBar.
        this.channelBar = null;
        this._channelBarProgress = null;

        this.painBar = this.add.graphics();
        this.uiLayer.add(this.painBar);

        this.kcBar = this.add.graphics();
        this.uiLayer.add(this.kcBar);

        this.weightBar = this.add.graphics();
        this.uiLayer.add(this.weightBar);

        this.barIcons = this.add.image(0, 0, "bar_icons").setOrigin(0, 0);
        this.uiLayer.add(this.barIcons);

        this.painBarZone = this._makeBarZone(() => {
            const pct = Math.round((this.player.capacities?.pain?.() ?? 0) * 100);
            return `Pain: ${pct}%`;
        });
        this.kcBarZone = this._makeBarZone(() => {
            const kc = Math.ceil(this.player.kc);
            const sat = Math.ceil(this.player.saturation);
            let text = `Hunger: ${kc}/${this.player.stomach} kc`;
            if (sat > 0) text += `\nSatiety: ${sat}`;
            return text;
        });
        this.weightBarZone = this._makeBarZone(() => {
            const weight = this.player.getInventoryWeight();
            const strength = this.player.strength;
            return `Carry: ${weight}/${strength} kg${weight > strength ? ' (encumbered)' : ''}`;
        });

        this._lastPain = NaN;
        this._lastKc = NaN;
        this._lastSaturation = NaN;
        this._lastStomach = NaN;
        this._lastWeight = NaN;
        this._lastStrength = NaN;

        this.drawBars();
    }

    _makeBarZone(tooltipFn) {
        const zone = this.add.zone(0, 0, 1, 1).setOrigin(0, 0).setInteractive();
        zone.on("pointerover", p => this.showTooltip(tooltipFn, p.x, p.y, zone));
        zone.on("pointerout", () => this.hideTooltip());
        this.uiLayer.add(zone);
        return zone;
    }

    _setBarZone(zone, x, y, w, h) {
        zone.setPosition(x, y).setSize(w, h);
        if (zone.input && zone.input.hitArea) {
            zone.input.hitArea.setTo(0, 0, w, h);
        }
    }

    drawBars() {
        const s = this.uiScale || 1;
        const x = Math.round(24 * s);
        const y = Math.round(8 * s);
        const w = Math.round(300 * s);
        const h = Math.round(16 * s);
        const gap = Math.round(6 * s);
        const border = Math.max(1, Math.round(s));

        if (this.barIcons) {
            this.barIcons.setScale(s).setPosition(Math.round(4 * s), Math.round(8 * s));
        }

        const pain = Phaser.Math.Clamp(this.player.capacities?.pain?.() ?? 0, 0, 1);
        const kc = Math.ceil(this.player.kc);
        const sat = this.player.saturation;
        const stomach = this.player.stomach;
        const weight = this.player.getInventoryWeight();
        const strength = this.player.strength;

        const kcFrac = kc / stomach;
        const satFrac = Phaser.Math.Clamp(sat / stomach, 0, 1);

        // Pain (empty at 0%, fills toward 100%)
        this.painBar.clear();
        this._drawBar(this.painBar, x, y, w, h, pain, 0x000000, 0x222222, 0xD24A43, border);
        // Pain-shock threshold tick (RimWorld default 80%) — inside the bar only
        const shockT = Number(this.player.anatomy?.plan?.painShockThreshold) || 0.8;
        const tickX = x + Math.round(w * Phaser.Math.Clamp(shockT, 0, 1));
        const tickW = Math.max(1, Math.round(s));
        this.painBar.fillStyle(0x444444, 1);
        this.painBar.fillRect(tickX - Math.floor(tickW / 2), y, tickW, h);

        // Hunger (yellow) + satiety overlay (orange)
        const ky = y + h + gap;
        this.kcBar.clear();
        this._drawBar(this.kcBar, x, ky, w, h, kcFrac, 0x000000, 0x222222, 0xE0C14B, border);
        const satW = Math.floor(w * satFrac);
        if (satW > 0) {
            this.kcBar.fillStyle(0xE67E22, 1);
            this.kcBar.fillRect(x, ky, satW, h);
        }

        // Weight
        this.weightBar.clear();
        const wy = y + (h + gap) * 2;
        this.weightBar.fillStyle(0x000000, 0.6).fillRect(x - border, wy - border, w + border * 2, h + border * 2)
            .fillStyle(0x222222, 0.85).fillRect(x, wy, w, h);
        const limit1 = Math.max(1, this.player.strength);
        const limit2 = limit1 * 2;
        const clamped = Math.min(Math.max(0, weight), limit2);
        const width1 = Math.floor(w * Math.min(clamped, limit1) / limit1);
        if (width1 > 0) this.weightBar.fillStyle(0x2ECC71, 1).fillRect(x, wy, width1, h);
        const excess = Math.max(0, clamped - limit1);
        const width2 = Math.floor(w * excess / limit1);
        if (width2 > 0) this.weightBar.fillStyle(0xF39C12, 1).fillRect(x, wy, width2, h);

        this._setBarZone(this.painBarZone, x, y, w, h);
        this._setBarZone(this.kcBarZone, x, ky, w, h);
        this._setBarZone(this.weightBarZone, x, wy, w, h);

        this._lastPain = pain;
        this._lastKc = kc;
        this._lastSaturation = sat;
        this._lastStomach = stomach;
        this._lastWeight = weight;
        this._lastStrength = strength;
    }

    /**
     * Progress 0–1 bar above the player. Drawn in fxRoot local space (scaled
     * 1/zoom) so it stays locked to the sprite after the render snap — same
     * approach as chat bubbles. Screen-space projection jittered while walking.
     */
    showChannelBar(progress) {
        this._channelBarProgress = Phaser.Math.Clamp(progress, 0, 1);
        this._drawChannelBar();
    }

    hideChannelBar() {
        this._channelBarProgress = null;
        this.channelBar?.clear();
        this.channelBar?.setVisible(false);
    }

    _drawChannelBar() {
        const player = this.player;
        const frac = this._channelBarProgress;
        if (frac == null || !player?.active) {
            this.hideChannelBar();
            return;
        }

        const root = player.ensureFxRoot();
        player.syncFxRoot();

        if (!this.channelBar?.active) {
            this.channelBar = this.add.graphics();
            root.add(this.channelBar);
        } else if (this.channelBar.parentContainer !== root) {
            root.add(this.channelBar);
        }

        const s = this.uiScale || 1;
        const zoom = this.worldZoom || this.cameras.main?.zoom || 1;
        const w = Math.round(40 * s);
        const h = Math.round(5 * s);

        let lx, ly;
        if (player._prone) {
            lx = 0;
            ly = -Math.round(Math.max(player.width, player.height) * 0.5 + 2);
        } else {
            // Sprite origin is bottom-left — center X, just above top of sprite
            lx = Math.round(player.width * 0.5);
            ly = -Math.round(player.height + 2);
        }

        // 0–25% red → 25–50% → orange → 50–75% → yellow → 75–90% → green → 90–100% solid green
        const color = this._channelBarFillColor(frac);

        const g = this.channelBar;
        g.clear().setVisible(true);
        g.setScale(1 / zoom);
        g.setPosition(lx, ly);
        // Local draw in screen-pixel units; scale makes them world-sized
        this._drawBar(g, -Math.floor(w / 2), -h, w, h, frac, 0x000000, 0x222222, color, 2);
    }

    /** Smooth tend-bar fill color through the progress thresholds. */
    _channelBarFillColor(frac) {
        const t = Phaser.Math.Clamp(frac, 0, 1);
        const red = 0xD24A43;
        const orange = 0xE67A00;
        const yellow = 0xE6C200;
        const green = 0x3CB043;
        const lerp = (a, b, u) => {
            const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
            const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
            const r = Math.round(ar + (br - ar) * u);
            const g = Math.round(ag + (bg - ag) * u);
            const bl = Math.round(ab + (bb - ab) * u);
            return (r << 16) | (g << 8) | bl;
        };
        if (t < 0.25) return red;
        if (t < 0.5) return lerp(red, orange, (t - 0.25) / 0.25);
        if (t < 0.75) return lerp(orange, yellow, (t - 0.5) / 0.25);
        if (t < 0.9) return lerp(yellow, green, (t - 0.75) / 0.15);
        return green;
    }

    _drawBar(gfx, x, y, w, h, frac, borderColor, bgColor, fillColor, border=1) {
        // border
        gfx.fillStyle(borderColor, 0.6);
        gfx.fillRect(x - border, y - border, w + border * 2, h + border * 2);
        // background
        gfx.fillStyle(bgColor, 0.85);
        gfx.fillRect(x, y, w, h);
        // fill
        const fillW = Math.floor(w * frac);
        if (fillW > 0) {
            gfx.fillStyle(fillColor, 1.0);
            gfx.fillRect(x, y, fillW, h);
        }
    }

    createStatus() {
        this.status = this.add.image(this.scale.width / 4, this.scale.height - 8, "status");
        this.status.setOrigin(0.5, 1);
        this.uiLayer.add(this.status);
    }

    createTooltip() {
        this._tooltipPadding = 6;

        this.tooltip = this.add.container(0, 0).setDepth(9999).setVisible(false);
        this.tooltipBg = this.add.graphics();
        this.tooltipText = this.add.text(0, 0, "", {
            fontFamily: "PrimaryFont",
            fontSize: "18px",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 2,
            padding: { left: this._tooltipPadding, right: this._tooltipPadding, top: this._tooltipPadding, bottom: this._tooltipPadding }
        });
        this.tooltip.add([this.tooltipBg, this.tooltipText]);
        this.uiLayer.add(this.tooltip);

        this._tooltipSource = null;
        this._tooltipTarget = null;
        this._hoverTarget = null;

        const drawBg = () => {
            const pad = this._tooltipPadding;
            const w = this.tooltipText.width + pad * 2;
            const h = this.tooltipText.height + pad * 2;
            const radius = Math.max(4, Math.round(6 * (this.uiScale || 1)));
            this.tooltipBg.clear()
                .fillStyle(0x111111, 0.95)
                .fillRoundedRect(-pad, -pad, w, h, radius)
                .lineStyle(1, 0x000000, 0.6)
                .strokeRoundedRect(-pad, -pad, w, h, radius);
        };

        /** True for hotbar/save/bars/panels — combat may still show these tooltips. */
        this._isUiTooltipTarget = (obj) => {
            if (!obj) return false;
            const seen = new Set();
            let cur = obj;
            while (cur && !seen.has(cur)) {
                seen.add(cur);
                if (
                    cur === this.uiLayer ||
                    cur === this.craftContainer ||
                    cur === this.equipmentPanel?.container ||
                    cur === this.healthPanel?.root ||
                    cur === this.knappingPanel?.container ||
                    cur === this.knappingPanel?.helpBtn ||
                    cur === this.deathOverlay
                ) {
                    return true;
                }
                if (cur.parentContainer) {
                    cur = cur.parentContainer;
                    continue;
                }
                // Phaser Layer children use displayList, not parentContainer
                if (cur.displayList && cur.displayList !== cur) {
                    cur = cur.displayList;
                    continue;
                }
                break;
            }
            return false;
        };

        this.hideWorldTooltip = () => {
            if (this._tooltipTarget && this._isUiTooltipTarget(this._tooltipTarget)) return;
            this.hideTooltip();
        };

        this.showTooltip = (textOrFn, x, y, target=null) => {
            // Combat only suppresses world (thing/mob/drop) tooltips, not side UI
            if (this.player?.blocksTooltips?.() && !this._isUiTooltipTarget(target)) return;
            this._tooltipSource = (typeof textOrFn === "function") ? textOrFn : () => textOrFn;
            this._tooltipTarget = target;
            const t = this._tooltipSource() || "";
            this.tooltipText.setText(t);
            drawBg();
            this.tooltip.setVisible(!!t);
            // Keep tooltip above every UI sibling (knapping help used to bringToTop itself)
            this.uiLayer?.bringToTop?.(this.tooltip);
            this.positionTooltip(x, y);
        };

        this.refreshTooltip = () => {
            // Keep source when text is empty so hotbar swaps can re-show (e.g. rock knap tip)
            if (!this._tooltipSource) return;
            const t = this._tooltipSource() || "";
            if (!t) {
                this.tooltip.setVisible(false);
                return;
            }
            this.tooltipText.setText(t);
            drawBg();
            this.tooltip.setVisible(true);
        };

        this.hideTooltip = () => {
            this._tooltipSource = null;
            this._tooltipTarget = null;
            this.tooltip.setVisible(false);
        };

        this._pickHoverTarget = (pointer) => {
            const hits = this.input.hitTestPointer(pointer);

            // Knapping modal blocks world behind it (help uses pixelPerfect like main HUD)
            const knap = this.knappingPanel;
            if (knap?.visible && knap.backdrop) {
                const overKnap = Phaser.Geom.Rectangle.Contains(
                    knap.backdrop.getBounds(), pointer.x, pointer.y
                );
                if (overKnap) {
                    for (let i = hits.length - 1; i >= 0; i--) {
                        const obj = hits[i];
                        if (!obj?.active || !obj.input?.enabled) continue;
                        if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                        if (this._isUnderKnappingPanel(obj)) return obj;
                    }
                    return knap.backdrop;
                }
            }

            // Health panel blocks world/UI behind it
            const health = this.healthPanel;
            if (health?.visible && health.bg) {
                const overHealth = Phaser.Geom.Rectangle.Contains(
                    health.bg.getBounds(), pointer.x, pointer.y
                );
                if (overHealth) {
                    for (let i = hits.length - 1; i >= 0; i--) {
                        const obj = hits[i];
                        if (!obj?.active || !obj.input?.enabled) continue;
                        if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                        if (this._isUnderHealthPanel(obj)) return obj;
                    }
                    return health.bg;
                }
            }

            // Corpse loot panel (world-space) blocks behind it
            const corpseP = this.corpsePanel;
            if (corpseP?.visible && corpseP.bg) {
                const wpt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                const overCorpse = Phaser.Geom.Rectangle.Contains(
                    corpseP.bg.getBounds(), wpt.x, wpt.y
                );
                if (overCorpse) {
                    for (let i = hits.length - 1; i >= 0; i--) {
                        const obj = hits[i];
                        if (!obj?.active || !obj.input?.enabled) continue;
                        if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                        if (this._isUnderCorpsePanel(obj)) return obj;
                    }
                    return corpseP.bg;
                }
            }

            // Equipment panel body blocks world/UI behind it
            const panel = this.equipmentPanel;
            if (panel?.visible && panel.body) {
                const overPanel = Phaser.Geom.Rectangle.Contains(
                    panel.body.getBounds(), pointer.x, pointer.y
                );
                if (overPanel) {
                    for (let i = hits.length - 1; i >= 0; i--) {
                        const obj = hits[i];
                        if (!obj?.active || !obj.input?.enabled) continue;
                        if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                        if (this._isUnderEquipmentPanel(obj)) return obj;
                    }
                    return panel.body;
                }
            }

            for (let i = hits.length - 1; i >= 0; i--) {
                const obj = hits[i];
                if (!obj?.active || !obj.input?.enabled) continue;
                if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                return obj;
            }
            return null;
        };

        this._isUnderKnappingPanel = (obj) => {
            const panel = this.knappingPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (
                    cur === panel.container
                    || cur === panel.backdrop
                    || cur === panel.helpBtn
                    || cur === panel.gridHit
                    || cur === panel.btnRotate?.label
                    || cur === panel.btnFinish?.label
                ) {
                    return true;
                }
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderHealthPanel = (obj) => {
            const panel = this.healthPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.root || cur === panel.bg) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderCorpsePanel = (obj) => {
            const panel = this.corpsePanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container || cur === panel.bg || cur === panel.slotsLayer) {
                    return true;
                }
                if (panel.slotViews?.some(v =>
                    v.slot === cur || v.icon === cur || v.fill === cur || v.qty === cur
                )) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderEquipmentPanel = (obj) => {
            const panel = this.equipmentPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container || cur === panel.body || cur === panel.slotsLayer) {
                    return true;
                }
                if (panel.slotViews?.some(v => v.slot === cur || v.icon === cur)) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._cursorFor = (obj) => {
            if (!obj?.input) return 'default';
            // Rocks: hand cursor only when "Click to knap" tip would show
            if (obj.meta?.id === "rock") {
                return this._rockKnapTooltipText() ? "pointer" : "default";
            }
            if (obj.input.cursor) return obj.input.cursor;
            if (obj.input.useHandCursor) return 'pointer';
            return 'pointer';
        };

        // Reconcile hover after camera/player movement (Phaser only updates on mouse move)
        this.syncPointerHover = () => {
            const pointer = this.input.activePointer;
            const blockWorld = !!this.player?.blocksTooltips?.();

            if (this._wasTooltipBlocked && !blockWorld) {
                this._wasTooltipBlocked = false;
                this._hoverTarget = null; // re-fire pointerover after attack
            }
            if (blockWorld) this._wasTooltipBlocked = true;

            const hit = this._pickHoverTarget(pointer);
            // During attacks, ignore world hover for tooltips; side UI still works
            const top = (blockWorld && hit && !this._isUiTooltipTarget(hit)) ? null : hit;

            if (top !== this._hoverTarget) {
                const prev = this._hoverTarget;
                this._hoverTarget = top;

                if (prev && prev.active && prev.input?.enabled) {
                    prev.emit("pointerout", pointer);
                } else if (this._tooltipTarget && this._tooltipTarget !== top) {
                    this.hideTooltip();
                }

                if (top) top.emit("pointerover", pointer);
                else this.hideWorldTooltip();
            } else if (top && this.tooltip.visible) {
                this.positionTooltip(pointer.x, pointer.y);
            }

            this.input.setDefaultCursor(top ? this._cursorFor(top) : "default");
        };

        this.positionTooltip = (x, y) => {
            const pad = this._tooltipPadding;
            const offset = Math.round(14 * (this.uiScale || 1));
            let nx = x + offset, ny = y + offset;
            const maxX = this.scale.width - (this.tooltipText.width + pad * 2);
            const maxY = this.scale.height - (this.tooltipText.height + pad * 2);
            nx = Phaser.Math.Clamp(nx, 0, Math.max(0, maxX));
            ny = Phaser.Math.Clamp(ny, 0, Math.max(0, maxY));
            this.tooltip.setPosition(nx, ny);
        };

        this.input.on("pointermove", (pointer) => {
            if (this.tooltip.visible) this.positionTooltip(pointer.x, pointer.y);
        });
        // Snap player for draw only; restore true pose before the next physics step
        // so diagonal speed stays normalized (square-grid body snaps are √2-fast).
        this.events.on("preupdate", () => this.restorePlayerPhysicsPos());
        this.events.on("postupdate", () => {
            this.syncPointerHover();
            // After physics: snap player+camera for this frame's render
            this.syncCameraToPlayer();
            this.player?.syncFxRoot?.();
            this.player?._syncChatBubble?.();
            this.meleeSlots?.drawDebug?.();
            this.drawChunkDebug();
        });
        this.scale.on("resize", () => this.hideTooltip());
    }

    createClockDisplay() {
        this.clockText = this.add.text(0, 0, "", {
            fontSize: "16px",
            fontFamily: "monospace",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 3
        }).setOrigin(0.5, 0).setDepth(9998);
        this.uiLayer.add(this.clockText);
        this.updateClockText();

        this.fpsText = this.add.text(0, 0, "", {
            fontSize: "12px",
            fontFamily: "monospace",
            color: "#a8e6a0",
            stroke: "#000000",
            strokeThickness: 3
        }).setOrigin(0.5, 0).setDepth(9998).setVisible(false).setScrollFactor(0);
        this.uiLayer.add(this.fpsText);
        this._fpsVisible = false;
        /** @type {{ t: number, d: number }[]} frame deltas in the last ~1s */
        this._fpsSamples = [];
        this._fpsUiAcc = 0;
    }

    setFpsMeter(on) {
        this._fpsVisible = !!on;
        this.fpsText?.setVisible(this._fpsVisible);
        this._fpsSamples = [];
        this._fpsUiAcc = 0;
        if (!this._fpsVisible) {
            this.fpsText?.setText("");
        } else {
            this.applyUiScale?.();
            this.fpsText?.setText("— fps · 0 mobs");
        }
        return this._fpsVisible;
    }

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
        const mobs = this.mobs?.countActive?.(true) ?? 0;
        this.fpsText.setText(`${avg} fps (min ${min}) · ${mobs} mobs`);
    }

    createLightVeil() {
        // Per-tile sky veil on the scene list (not inside a Layer — Layer + MULTIPLY
        // was effectively a no-op). UI cam ignores it; depth sits above world layers.
        this.lightGfx = this.add.graphics().setDepth(50);
        this._uiCam.ignore(this.lightGfx);
        this.blockLight = new Map();
        this.lightDirty = true;
        this.updateLightVeil();
    }

    markLightDirty() {
        this.lightDirty = true;
    }

    updateTimeTint() {
        this.markLightDirty();
        this.updateLightVeil();
    }

    getCampfires() {
        const list = [];
        for (const chunk of Object.values(this.chunks)) {
            if (!chunk.isLoaded) continue;
            for (const thing of chunk.things.getChildren()) {
                // Prefer duck-typing over instanceof (breaks after live script reload)
                if (thing.active && thing.meta?.campfire && typeof thing.burnMinute === 'function') {
                    list.push(thing);
                }
            }
        }
        return list;
    }

    recomputeBlockLight() {
        this.blockLight.clear();
        const queue = [];
        for (const fire of this.getCampfires()) {
            if (!fire.isLit()) continue;
            const level = Number(fire.meta.lightLevel ?? 12);
            if (level <= 0) continue;
            const tx = Math.floor(fire.x / this.tileSize);
            const ty = Math.floor((fire.y - 1) / this.tileSize);
            const key = `${tx},${ty}`;
            const prev = this.blockLight.get(key) || 0;
            if (level > prev) {
                this.blockLight.set(key, level);
                queue.push({ tx, ty, level });
            }
        }

        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        while (queue.length) {
            const { tx, ty, level } = queue.shift();
            const next = level - 1;
            if (next <= 0) continue;
            for (const [dx, dy] of dirs) {
                const nx = tx + dx;
                const ny = ty + dy;
                const key = `${nx},${ny}`;
                const prev = this.blockLight.get(key) || 0;
                if (next > prev) {
                    this.blockLight.set(key, next);
                    queue.push({ tx: nx, ty: ny, level: next });
                }
            }
        }
    }

    updateLightVeil() {
        if (!this.lightGfx) return;

        if (this.lightDirty) {
            this.recomputeBlockLight();
            this.lightDirty = false;
            this._lightVersion = (this._lightVersion || 0) + 1;
        }

        const cam = this.cameras.main;
        const ts = this.tileSize;
        const sig = [
            Math.floor(cam.worldView.x / ts),
            Math.floor(cam.worldView.y / ts),
            this.gameMinutes,
            this._lightVersion || 0
        ].join(',');
        if (sig === this._lightSig) return;
        this._lightSig = sig;

        const { color, darkness: skyDark, wash: skyWash } = getTimeOfDayTint(this.gameMinutes);
        const r = (color >> 16) & 255;
        const g = (color >> 8) & 255;
        const b = color & 255;

        const pad = 2;
        const x0 = Math.floor(cam.worldView.x / ts) - pad;
        const y0 = Math.floor(cam.worldView.y / ts) - pad;
        const x1 = Math.ceil(cam.worldView.right / ts) + pad;
        const y1 = Math.ceil(cam.worldView.bottom / ts) + pad;

        this.lightGfx.clear();
        if (skyDark < 0.01 && skyWash < 0.01) return;

        for (let ty = y0; ty < y1; ty++) {
            for (let tx = x0; tx < x1; tx++) {
                const block = this.blockLight.get(`${tx},${ty}`) || 0;
                const light = 1 - Math.min(15, block) / 15;
                const dark = skyDark * light;
                const wash = skyWash * light;
                // Night: black veil. Dawn/golden: deep warm tint (pale washes bleach the art).
                if (dark >= 0.02) {
                    this.lightGfx.fillStyle(0x060a14, Math.min(0.96, dark));
                    this.lightGfx.fillRect(tx * ts, ty * ts, ts, ts);
                }
                if (wash >= 0.02) {
                    this.lightGfx.fillStyle(
                        Phaser.Display.Color.GetColor(r, g, b),
                        Math.min(0.28, wash)
                    );
                    this.lightGfx.fillRect(tx * ts, ty * ts, ts, ts);
                }
            }
        }
    }

    worldToTile(wx, wy) {
        return {
            tx: Math.floor(wx / this.tileSize),
            ty: Math.floor(wy / this.tileSize)
        };
    }

    tileCenter(tx, ty) {
        return {
            x: tx * this.tileSize + this.tileSize / 2,
            y: ty * this.tileSize + this.tileSize
        };
    }

    getChunkAtWorld(wx, wy) {
        const px = this.chunkPx();
        return this.chunks[this.getKey(Math.floor(wx / px), Math.floor(wy / px))] || null;
    }

    /** Hover tooltip for non-lootable Things that define `tooltip` lines in Things.json. */
    wireThingTooltip(thing) {
        if (!thing?.meta?.tooltip?.length) return;
        thing.setInteractive({ cursor: "pointer", pixelPerfect: false });
        thing.on("pointerover", (pointer) => {
            this.showTooltip(
                () => (thing.meta.tooltip || []).join("\n"),
                pointer.x,
                pointer.y,
                thing
            );
        });
        thing.on("pointerout", () => {
            if (this._hoverTarget === thing) this._hoverTarget = null;
            if (this._tooltipTarget === thing) this.hideTooltip();
        });
    }

    /** Rock: click to knap + hover tip while holding pebble/flint. */
    wireRockKnapping(thing) {
        if (!thing || thing.meta?.id !== "rock") return;
        // Default arrow; _cursorFor switches to pointer only when knap tip is active
        thing.setInteractive({ cursor: "default", pixelPerfect: false });
        thing.on("pointerdown", () => {
            this.knappingPanel?.tryOpenAtRock?.(thing);
        });
        thing.on("pointerover", (pointer) => {
            this.showTooltip(
                () => this._rockKnapTooltipText(),
                pointer.x,
                pointer.y,
                thing
            );
        });
        thing.on("pointerout", () => {
            if (this._hoverTarget === thing) this._hoverTarget = null;
            if (this._tooltipTarget === thing) this.hideTooltip();
        });
    }

    _rockKnapTooltipText() {
        const held = this.player?.getHeldItem?.();
        if (!held || !(held.quantity > 0)) return "";
        if (held.knapIconData && (held.id === "stone_tool" || held.id === "flint_tool")) {
            return "Click to reshape";
        }
        const meta = this.getItem(held.id);
        if (!meta?.knapping?.material) return "";
        return "Click to knap";
    }

    /** Load all chunks covering tile coords [-radius, radius]². */
    async _loadSpawnNeighborhood(radius) {
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
    }

    /** Tile keys occupied by things / lootables in loaded chunks. */
    _spawnOccupiedTiles() {
        const occupied = new Set();
        const mark = (entry) => {
            if (!entry) return;
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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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

            let hasSign = false;
            for (const chunk of Object.values(this.chunks)) {
                if (chunk.meta?.things?.some((t) => t.id === "sign" && t.spawnHint)) {
                    hasSign = true;
                    break;
                }
            }

            if (!hasSign && !this._spawnSignPlaced) {
                this._clearTileThings(0, 0);
                const { x, y } = this.tileCenter(0, 0);
                const chunk = this.getChunkAtWorld(x, y - 1);
                if (chunk) {
                    const entry = { id: "sign", x, y, spawnHint: true };
                    chunk.meta.things.push(entry);
                    if (chunk.isLoaded) {
                        const thing = new Thing(this, entry.x, entry.y, entry.id);
                        this.wireThingTooltip(thing);
                        chunk.things.add(thing);
                    }
                }
                this._spawnSignPlaced = true;
            } else {
                this._spawnSignPlaced = true;
            }

            // Fresh world only — don't move the player when loading a save
            if (!this._playerSpawnPlaced && !hasSign) {
                const pick = this.pickRandomSpawnTile(radius);
                if (pick) {
                    this.player.teleport(pick.x, pick.y);
                    this.syncCameraToPlayer();
                }
                this._playerSpawnPlaced = true;
            } else if (hasSign) {
                // Save already had spawn setup; keep loaded player position
                this._playerSpawnPlaced = true;
            }
        } finally {
            this._spawnSignBusy = false;
        }
    }

    findCampfireOnTile(tx, ty) {
        for (const fire of this.getCampfires()) {
            const ft = this.worldToTile(fire.x, fire.y - 1);
            if (ft.tx === tx && ft.ty === ty) return fire;
        }
        return null;
    }

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
    }

    /** Ground drops within the player's interaction range, nearest first. */
    nearbyDrops() {
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;
        return this.droppedItems.getChildren()
            .filter(d => d.active)
            .map(d => ({
                drop: d,
                dist: Phaser.Math.Distance.Between(px, py, d.x, d.y)
            }))
            .filter(e => e.dist * e.dist <= r2)
            .sort((a, b) => a.dist - b.dist)
            .map(e => e.drop);
    }

    consumeNearbyDrops(requirements) {
        // requirements: { stick: 15, leaf: 10 }
        const drops = this.nearbyDrops();

        const available = {};
        for (const id of Object.keys(requirements)) available[id] = 0;
        for (const d of drops) {
            const id = d.item?.id;
            if (id in available) available[id] += d.quantity;
        }
        for (const [id, need] of Object.entries(requirements)) {
            if ((available[id] || 0) < need) return false;
        }

        for (const [id, need] of Object.entries(requirements)) {
            let left = need;
            for (const d of drops) {
                if (left <= 0) break;
                if (d.item?.id !== id || !d.active) continue;
                const take = Math.min(d.quantity, left);
                d.quantity -= take;
                left -= take;
                if (d.quantity <= 0) d.destroy();
                else d.syncToEntry?.();
            }
        }
        return true;
    }

    /**
     * Tile for a new campfire from ground sticks/leaves.
     * Prefer nearest leaf pile; fall back to nearest stick pile.
     */
    campfireTileFromDrops(drops) {
        const leaf = drops.find(d => d.item?.id === "leaf");
        const stick = drops.find(d => d.item?.id === "stick");
        const anchor = leaf || stick;
        if (!anchor) return null;
        return this.worldToTile(anchor.x, anchor.y - 1);
    }

    tryUseFirestarter() {
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;

        // Relight nearest fueled unlit campfire
        let best = null;
        let bestD = Infinity;
        for (const fire of this.getCampfires()) {
            if (fire.isLit() || !fire.hasFuel()) continue;
            const dx = fire.x - px;
            const dy = fire.y - py;
            const d2 = dx * dx + dy * dy;
            if (d2 <= r2 && d2 < bestD) {
                bestD = d2;
                best = fire;
            }
        }
        if (best) {
            best.setKind('campfire');
            best.ensureBurning();
            this.updateLightVeil();
            return true;
        }

        // Ground recipe: 15 sticks + 10 leaves — spawn on the materials' tile
        // (leaves preferred over sticks), not the player's tile.
        const drops = this.nearbyDrops();
        const tile = this.campfireTileFromDrops(drops);
        if (!tile) return false;
        const { tx, ty } = tile;
        if (this.findCampfireOnTile(tx, ty)) return false;
        if (!this.consumeNearbyDrops({ stick: 15, leaf: 10 })) return false;

        const stick = this.getItem('stick');
        const leaf = this.getItem('leaf');
        const fire = this.placeCampfire(
            tx,
            ty,
            makeItemStack(leaf, 10, undefined, this.worldMinuteIndex()),
            makeItemStack(stick, 15, undefined, this.worldMinuteIndex())
        );
        if (fire) fire.ensureBurning();
        return !!fire;
    }

    tickCampfires() {
        let lightChanged = false;
        const openFire = this.campfirePanel?.visible ? this.campfirePanel.campfire : null;

        for (const fire of this.getCampfires()) {
            // Burn first so a fire that dies this minute starts draining cook progress immediately
            if (fire.isLit() && fire.burnMinute()) lightChanged = true;
            const lit = fire.isLit();
            // Stick-roast needs the menu open (tending); shell simmer runs unattended while lit
            fire.tickCook(lit, lit && fire === openFire);
        }
        if (lightChanged) this.updateLightVeil();
    }

    updateClockText() {
        if (!this.clockText) return;
        const h = Math.floor(this.gameMinutes / 60);
        const m = this.gameMinutes % 60;
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        this.clockText.setText(`Day ${this.gameDay}  ${hh}:${mm}`);
    }

    /**
     * Debug: change how fast the world clock ticks.
     * @param {Number} mult  1 = normal (1 game min / real sec), 60 ≈ 1 game hour/sec, 0 = pause
     */
    setTickSpeed(mult) {
        const m = Number(mult);
        if (!Number.isFinite(m) || m < 0) return this.tickSpeed;
        this.tickSpeed = m;
        if (this._worldMinuteEvent) {
            this._worldMinuteEvent.remove(false);
            this._worldMinuteEvent = null;
        }
        if (m > 0) {
            this._worldMinuteEvent = this.time.addEvent({
                delay: Math.max(1, 1000 / m),
                callback: this.worldMinuteTick,
                callbackScope: this,
                loop: true
            });
        }
        return this.tickSpeed;
    }

    /** Absolute in-game minute index (for regrow timers). */
    worldMinuteIndex() {
        return (Number(this.gameDay) || 1) * 1440 + (Number(this.gameMinutes) || 0);
    }

    /** Roll regrowAt = now + base * (0.85..1.15). */
    jitteredRegrowAt(baseMinutes) {
        const base = Math.max(1, Math.floor(Number(baseMinutes) || 0));
        const factor = 0.85 + Math.random() * 0.30;
        return this.worldMinuteIndex() + Math.max(1, Math.floor(base * factor));
    }

    /**
     * If entry.regrowAt is due, restore id / clear gone flags (no sprites).
     * @returns {boolean} true if entry was updated
     */
    applyDueLootableRegrow(entry) {
        if (!entry || entry.regrowAt == null) return false;
        if (this.worldMinuteIndex() < entry.regrowAt) return false;
        const id = entry.regrowId || entry.id;
        if (!id) return false;
        entry.id = id;
        delete entry.gone;
        delete entry.regrowAt;
        delete entry.regrowId;
        return true;
    }

    /** Finish a due regrow on a loaded chunk (morph or respawn sprite). */
    finishLootableRegrow(chunk, entry) {
        if (!this.applyDueLootableRegrow(entry)) return;
        const live = chunk.things?.getChildren?.().find(t => t.entry === entry);
        if (live && typeof live.morph === "function") {
            live.morph(entry.id);
        } else if (chunk.isLoaded) {
            chunk.things.add(new LootableThing(this, entry, chunk));
        }
        this.markLightDirty?.();
    }

    /** Scan loaded chunks only — unloaded catch up in makeThings. */
    tickLootableRegrows() {
        const now = this.worldMinuteIndex();
        for (const chunk of Object.values(this.chunks || {})) {
            if (!chunk?.isLoaded || !chunk.meta?.lootableThings) continue;
            for (const entry of chunk.meta.lootableThings) {
                if (entry.regrowAt == null || now < entry.regrowAt) continue;
                this.finishLootableRegrow(chunk, entry);
            }
        }
    }

    worldMinuteTick() {
        if (this.isPaused) return;

        this.gameMinutes += 1;
        if (this.gameMinutes >= 24 * 60) {
            this.gameMinutes = 0;
            this.gameDay += 1;
        }
        this.updateClockText();
        this.updateTimeTint();

        this.player.hungerTick();
        this.tickSpoilage();
        this.tickCampfires();
        this.tickLootableRegrows();
        this.tickBodySystems();
        this.tickBloodStains();
    }

    tickBodySystems() {
        if (this.player && !this.player.isBodyDead?.()) {
            BodyHealing.minuteTick(this.player, this);
        }
        for (const mob of this.mobs?.getChildren?.() || []) {
            if (mob?.active && !mob.isBodyDead?.()) BodyHealing.minuteTick(mob, this);
        }
        this.healthPanel?.refresh?.();
    }

    /** Soft cap — merging nearby drips keeps count low in normal fights. */
    static BLOOD_STAINS_MAX = 180;
    /** Merge into an existing pool if within this many pixels. */
    static BLOOD_MERGE_DIST = 6;
    static BLOOD_RADIUS_MIN = 0.9;
    static BLOOD_RADIUS_MAX = 5;
    /** Radius added when a drip merges into a pool. */
    static BLOOD_MERGE_GROW = 0.4;
    static BLOOD_LIFE_MINUTES = 1440; // 1 game day

    /** Debug: when false, skip spawning/painting blood stains. */
    setBloodDraw(on) {
        this.bloodDraw = !!on;
        for (const chunk of Object.values(this.chunks || {})) {
            if (!chunk?.isLoaded) continue;
            if (this.bloodDraw) this.rebuildBloodGfx(chunk);
            else {
                const rt = chunk._bloodRt;
                if (rt?.active) {
                    rt.clear();
                    rt.setVisible(false);
                }
                chunk._bloodGfx?.clear?.();
                chunk._bloodGfx?.setVisible?.(false);
            }
        }
        return this.bloodDraw;
    }

    spawnBloodStain(x, y) {
        if (this.bloodDraw === false) return;
        // No blood pools on water (ice is fine)
        if (this._isWaterAt(x, y - 1)) return;
        const chunk = LivingMob.ensureChunkAt(this, x, y);
        if (!chunk) return;
        if (!chunk.meta.bloodStains) chunk.meta.bloodStains = [];
        const list = chunk.meta.bloodStains;
        const mergeDist = SceneMain.BLOOD_MERGE_DIST;
        const mergeDistSq = mergeDist * mergeDist;

        // Grow a nearby pool instead of adding another circle
        let best = null;
        let bestD = mergeDistSq;
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            const dx = e.x - x;
            const dy = e.y - y;
            const d = dx * dx + dy * dy;
            if (d <= bestD) {
                bestD = d;
                best = e;
            }
        }
        if (best) {
            const grow = SceneMain.BLOOD_MERGE_GROW;
            best.radius = Math.min(
                SceneMain.BLOOD_RADIUS_MAX,
                (Number(best.radius) || SceneMain.BLOOD_RADIUS_MIN) + grow
            );
            // Pull pool slightly toward the new drip
            best.x = best.x * 0.75 + x * 0.25;
            best.y = best.y * 0.75 + y * 0.25;
            best.lifeMinutes = SceneMain.BLOOD_LIFE_MINUTES;
            if (chunk.isLoaded) this._paintBloodStain(chunk, best);
            return;
        }

        let needsRebuild = false;
        while (list.length >= SceneMain.BLOOD_STAINS_MAX) {
            list.shift();
            needsRebuild = true;
        }
        const entry = {
            x,
            y,
            radius: Phaser.Math.FloatBetween(
                SceneMain.BLOOD_RADIUS_MIN,
                Math.min(2.4, SceneMain.BLOOD_RADIUS_MAX)
            ),
            lifeMinutes: SceneMain.BLOOD_LIFE_MINUTES
        };
        list.push(entry);
        if (!chunk.isLoaded) return;
        if (needsRebuild) this.rebuildBloodGfx(chunk);
        else this._paintBloodStain(chunk, entry);
    }

    _bloodStampGfx() {
        if (!this._bloodStamp || !this._bloodStamp.active) {
            this._bloodStamp = this.make.graphics({ x: 0, y: 0, add: false });
        }
        return this._bloodStamp;
    }

    /** Chunk-local blood RT — one texture, stamp circles (no growing command list). */
    _ensureBloodRt(chunk) {
        if (chunk._bloodRt?.active) return chunk._bloodRt;
        const size = chunk.px();
        const rt = this.make.renderTexture({
            x: chunk.x * size,
            y: chunk.y * size,
            width: size,
            height: size,
            add: false
        }).setOrigin(0).setDepth(0.5);
        this.groundLayer.add(rt);
        chunk._bloodRt = rt;
        // Drop legacy Graphics mesh if present
        chunk._bloodGfx?.destroy?.();
        chunk._bloodGfx = null;
        return rt;
    }

    _paintBloodStain(chunk, entry) {
        if (this.bloodDraw === false) return;
        const r = Phaser.Math.Clamp(
            Number(entry.radius) || SceneMain.BLOOD_RADIUS_MIN,
            SceneMain.BLOOD_RADIUS_MIN,
            SceneMain.BLOOD_RADIUS_MAX
        );
        entry.radius = r;
        const rt = this._ensureBloodRt(chunk);
        rt.setVisible(true);
        const size = chunk.px();
        const lx = entry.x - chunk.x * size;
        const ly = entry.y - chunk.y * size;
        const stamp = this._bloodStampGfx();
        stamp.clear();
        stamp.fillStyle(0x6b1010, 0.55);
        stamp.fillCircle(0, 0, r);
        rt.draw(stamp, lx, ly);
    }

    /** Full redraw (after expiry / eviction / chunk load). */
    rebuildBloodGfx(chunk) {
        if (!chunk) return;
        if (this.bloodDraw === false) {
            if (chunk._bloodRt?.active) {
                chunk._bloodRt.clear();
                chunk._bloodRt.setVisible(false);
            }
            return;
        }
        const rt = this._ensureBloodRt(chunk);
        rt.clear().setVisible(true);
        for (const entry of chunk.meta?.bloodStains || []) {
            this._paintBloodStain(chunk, entry);
        }
    }

    /** @deprecated use rebuildBloodGfx — kept for Chunk.makeBloodStains call sites */
    _ensureBloodStainSprite(chunk, _entry) {
        this.rebuildBloodGfx(chunk);
    }

    tickBloodStains() {
        for (const chunk of Object.values(this.chunks || {})) {
            const list = chunk.meta?.bloodStains;
            if (!list?.length) continue;
            let removed = false;
            for (let i = list.length - 1; i >= 0; i--) {
                const e = list[i];
                e.lifeMinutes = (e.lifeMinutes || 0) - 1;
                if (e.lifeMinutes <= 0) {
                    list.splice(i, 1);
                    removed = true;
                }
            }
            if (removed && chunk.isLoaded) this.rebuildBloodGfx(chunk);
        }
    }

    tickSpoilage() {
        const now = this.worldMinuteIndex();
        const rot = this.getItem("rot");
        let dirty = false;
        let cookDirty = false;
        let corpsePanelDirty = false;
        const getItem = (id) => this.getItem(id);

        const applyStack = (stack) => {
            if (!stack) return stack;
            migrateStackSpoil(stack, now, getItem);
            const { stack: next, changed } = spoilStackIfDue(stack, now, rot);
            if (changed) dirty = true;
            return next;
        };

        const inv = this.player.inventory;
        for (let i = 0; i < inv.length; i++) {
            if (inv[i]) inv[i] = applyStack(inv[i]);
        }

        const eq = this.player.equipment;
        for (const key of ["head", "torso", "legs", "feet"]) {
            if (eq[key]) eq[key] = applyStack(eq[key]);
        }
        for (let i = 0; i < eq.waist.length; i++) {
            if (eq.waist[i]) eq.waist[i] = applyStack(eq.waist[i]);
        }

        const liveDrops = this.droppedItems?.getChildren?.() || [];
        for (const chunk of Object.values(this.chunks || {})) {
            const drops = chunk.meta?.drops;
            if (Array.isArray(drops)) {
                for (const entry of drops) {
                    if (!entry) continue;
                    migrateStackSpoil(entry, now, getItem);
                    const live = liveDrops.find((d) => d.active && d.entry === entry);
                    if (live) {
                        if (entry.spoilAt != null) live.spoilAt = entry.spoilAt;
                        else delete live.spoilAt;
                    }
                    if (entry.spoilAt == null) continue;
                    if (Math.round(now) < Math.round(entry.spoilAt)) continue;
                    dirty = true;
                    const qty = entry.quantity;
                    if (!rot) {
                        delete entry.spoilAt;
                        if (live) delete live.spoilAt;
                        continue;
                    }
                    const beforeId = entry.id;
                    entry.id = rot.id;
                    entry.quantity = qty;
                    delete entry.spoilAt;
                    delete entry.spoilMinutes;
                    delete entry.customName;
                    delete entry.food;
                    delete entry.ingredients;
                    delete entry.weight;
                    delete entry.kind;
                    delete entry.fillTint;
                    if (live) {
                        live.item = rot;
                        delete live.spoilAt;
                        live.quantity = qty;
                        if (beforeId !== rot.id) live.setTexture(rot.key);
                        live.syncToEntry?.();
                    }
                }
            }

            const corpses = chunk.meta?.corpses;
            if (Array.isArray(corpses)) {
                for (const corpseEntry of corpses) {
                    if (!Array.isArray(corpseEntry?.loot)) continue;
                    let lootChanged = false;
                    for (let i = 0; i < corpseEntry.loot.length; i++) {
                        if (!corpseEntry.loot[i]) continue;
                        const prevId = corpseEntry.loot[i].id;
                        const prevAt = corpseEntry.loot[i].spoilAt;
                        corpseEntry.loot[i] = applyStack(corpseEntry.loot[i]);
                        const cur = corpseEntry.loot[i];
                        if (cur?.id !== prevId || cur?.spoilAt !== prevAt) lootChanged = true;
                    }
                    if (lootChanged) {
                        dirty = true;
                        const panel = this.corpsePanel;
                        if (panel?.visible && panel.corpse?.entry === corpseEntry) {
                            corpsePanelDirty = true;
                        }
                    }
                }
            }

            const things = chunk.meta?.things;
            if (Array.isArray(things)) {
                for (const entry of things) {
                    if (!entry) continue;
                    const thingMeta = this.getThing?.(entry.id);
                    const isCamp = thingMeta?.campfire
                        || entry.id === "campfire"
                        || entry.id === "unlit_campfire"
                        || entry.cook !== undefined
                        || entry.catalyst !== undefined
                        || Array.isArray(entry.simmer);
                    if (!isCamp) continue;

                    if (entry.cook) {
                        const prevId = entry.cook.id;
                        entry.cook = applyStack(entry.cook);
                        if (entry.cook?.id !== prevId) {
                            entry.cookProgress = 0;
                            cookDirty = true;
                        }
                    }
                    if (entry.catalyst) {
                        const prevId = entry.catalyst.id;
                        entry.catalyst = applyStack(entry.catalyst);
                        if (entry.catalyst?.id !== prevId) cookDirty = true;
                    }
                    if (Array.isArray(entry.simmer)) {
                        for (let i = 0; i < entry.simmer.length; i++) {
                            if (!entry.simmer[i]) continue;
                            const prevId = entry.simmer[i].id;
                            entry.simmer[i] = applyStack(entry.simmer[i]);
                            if (entry.simmer[i]?.id !== prevId) cookDirty = true;
                        }
                    }
                }
            }
        }

        if (corpsePanelDirty) {
            const panel = this.corpsePanel;
            const corpse = panel?.corpse;
            if (panel && corpse?.entry) {
                panel.session = (corpse.entry.loot || []).map((s) => cloneItemStack(s));
                if (!panel.session.length) panel.session = [null];
                panel._rebuildSlots?.();
                panel.refresh?.();
            }
        }

        if (dirty) {
            this.hotbar.dirty = true;
            if (this.equipmentPanel?.visible) this.equipmentPanel.refresh();
        }
        if (cookDirty) this.campfirePanel?.refresh();
        if (this.tooltip?.visible) this.refreshTooltip();
    }

    /** Migrate spoil timers on all chunk meta (drops, corpses, campfires). */
    migrateWorldSpoilAt() {
        const now = this.worldMinuteIndex();
        const getItem = (id) => this.getItem(id);
        for (const chunk of Object.values(this.chunks || {})) {
            for (const entry of chunk.meta?.drops || []) {
                if (entry) migrateStackSpoil(entry, now, getItem);
            }
            for (const corpse of chunk.meta?.corpses || []) {
                for (const stack of corpse?.loot || []) {
                    if (stack) migrateStackSpoil(stack, now, getItem);
                }
            }
            for (const entry of chunk.meta?.things || []) {
                if (!entry) continue;
                if (entry.cook) migrateStackSpoil(entry.cook, now, getItem);
                if (entry.catalyst) migrateStackSpoil(entry.catalyst, now, getItem);
                for (const s of entry.simmer || []) {
                    if (s) migrateStackSpoil(s, now, getItem);
                }
            }
        }
    }

    /** Migrate/ensure spoilAt on stacks (after clock is known). */
    ensureSpoilAt(stacks) {
        if (!stacks) return;
        const now = this.worldMinuteIndex();
        const getItem = (id) => this.getItem(id);
        for (const stack of stacks) {
            if (!stack) continue;
            migrateStackSpoil(stack, now, getItem);
        }
    }

    /** @deprecated */
    ensureSpoilMinutes(stacks) {
        this.ensureSpoilAt(stacks);
    }

    /** Rename legacy item ids in inventory/loot stacks (e.g. wood_spear → wooden_spear). */
    _migrateLegacyItemIds(stacks) {
        if (!stacks) return;
        for (const stack of stacks) {
            if (!stack?.id) continue;
            if (stack.id === "wood_spear") stack.id = "wooden_spear";
        }
    }

    formatItemTooltip(item, quantity, spoilAt, stack = null) {
        const lines = [];
        const displayName = stack?.customName || item.name;
        const name = quantity > 1 ? `${displayName} x${quantity}` : displayName;
        lines.push(name);

        // Tip / tipped-spear quality on line 2 (knives still bake quality into the name)
        if (
            stack?.knapQuality
            && (stack.toolClass === "spear_tip" || !stack.toolClass)
        ) {
            const q = String(stack.knapQuality);
            lines.push(q.charAt(0).toUpperCase() + q.slice(1));
        }

        // Weight (stack.weight for dynamic meals)
        const weight = stack?.weight != null ? stack.weight : item.weight;
        if (weight > 0) {
            lines.push(`Weight: ${weight} kg`);
        }

        if (item.bandage) {
            const base = Math.round((Number(item.bandage.tendQuality) || 0) * 100);
            lines.push(`Tend quality: ${base}%`);
        }

        // Food (stack.food overrides meta for dynamic meals). 0 kcal = spoils only, not edible.
        const food = stack?.food || item.food;
        if (food) {
            const kc = Math.round(Number(food.kc ?? 0));
            if (kc > 0) {
                const full = Math.round(Number(food.kcFull ?? kc));
                const pct = full > 0 ? Math.round((kc / full) * 100) : 100;
                if (pct < 100) lines.push(`Food: ${kc} kcal (${pct}%)`);
                else lines.push(`Food: ${kc} kcal`);
            }

            const now = this.worldMinuteIndex?.() ?? null;
            let mins = null;
            if (spoilAt != null && now != null) {
                mins = remainingSpoilMinutes(spoilAt, now);
            } else if (stack?.spoilAt != null && now != null) {
                mins = remainingSpoilMinutes(stack.spoilAt, now);
            } else if (food.spoil != null) {
                mins = Math.round(food.spoil * 60);
            } else {
                mins = spoilDurationMinutes(item);
            }
            if (mins != null) {
                lines.push(`Spoils in: ${formatHours(Math.floor(mins / 60))}`);
            }

            if (quantity > 1) {
                const totWeight = Math.round(weight * quantity * 100) / 100;
                if (kc > 0) lines.push(`Stack total: ${totWeight} kg, ${kc * quantity} kcal`);
                else if (weight > 0) lines.push(`Stack total: ${totWeight} kg`);
            }
        } else if (quantity > 1 && weight > 0) {
            const totWeight = Math.round(weight * quantity * 100) / 100;
            lines.push(`Stack total: ${totWeight} kg`);
        }

        const knapWeapon = (stack?.toolClass && typeof Knapping !== "undefined")
            ? Knapping.weaponMetaFromStack(item, stack)
            : null;
        let weapon = knapWeapon?.weapon || item.weapon;
        let weaponMetaForDps = knapWeapon || item;
        if (
            !knapWeapon
            && stack?.knapQuality
            && item.weapon
            && typeof weaponMetaWithKnapQuality === "function"
        ) {
            weaponMetaForDps = weaponMetaWithKnapQuality(item, stack);
            weapon = weaponMetaForDps.weapon;
        }
        if (weapon) {
            const avg = typeof BodyCombat !== "undefined"
                ? BodyCombat.meleeWeaponAverageDps?.(weapon)
                : null;
            if (avg && avg.dps > 0) {
                const dps = avg.dps.toFixed(1);
                const dtype = avg.type || weapon.type || "melee";
                lines.push(`DPS: ${dps} ${dtype}`);
            } else {
                const dmg = Number(stack?.knapDamage ?? weapon.damage ?? 0);
                if (dmg > 0) {
                    const type = weapon.type ? ` ${weapon.type}` : "";
                    lines.push(`Damage: ${dmg}${type}`);
                } else if (weapon.type) {
                    lines.push(`Type: ${weapon.type}`);
                }
            }
        }
        // Skip legacy knap "Damage:" lines — weapons show DPS from verbs (like spears)
        let knapFlavor = stack?.tooltipExtra;
        if (
            !knapFlavor
            && stack?.toolClass === "knife"
        ) {
            knapFlavor = "Mr. Stabby";
        } else if (!knapFlavor && stack?.toolClass === "chopper") {
            knapFlavor = "Slow but heavy";
        }
        if (
            knapFlavor
            && knapFlavor !== "Needs a shaft"
            && !/^Damage:/i.test(knapFlavor)
        ) {
            lines.push(knapFlavor);
        }
        if (stack?.toolClass === "knife") {
            lines.push("Click a corpse to skin it for more resources");
        }

        if (item.fuel) {
            const kj = Number(item.fuel.kj ?? 0);
            if (kj > 0) lines.push(`Fuel: ${kj} kj`);
        }

        // Static tooltips only when not a custom-named meal
        if (!stack?.customName && Array.isArray(item.tooltip)) {
            for (const line of item.tooltip) lines.push(line);
        }

        // Equipment
        if (item.equip) {
            // Slot
            lines.push(`Slot: ${item.equip.slot}`);

            // Effects
            if (item.equip.effects) {
                // Add Slot
                const addSlot = item.equip.effects.addSlot;
                if (addSlot) {
                    const counts = {};
                    for (const s of addSlot) counts[s] = (counts[s] || 0) + 1;
                    for (const [s, n] of Object.entries(counts)) {
                        const label = s === 'hotbar' ? 'hotbar' : s;
                        lines.push(`+ ${n} ${label} slot${n > 1 ? 's' : ''}`);
                    }
                }
                
                // Strength
                const strength = item.equip.effects.strength;
                if (strength) {
                    lines.push(`+ ${strength} kg carry`)
                }

                const speed = item.equip.effects.speed;
                if (speed) {
                    lines.push(`+ ${Math.round(speed * 100)}% speed`);
                }
            }
        }

        return lines.join("\n");
    }

    createCraftMenu() {
        this.craftMenuVisible = false;
        this.craftContainer = this.add.container(0, 0).setVisible(false);
        this.uiLayer.add(this.craftContainer);
        this._data = [];
        this.scale.on('resize', () => this.positionCraftMenu());
    }

    positionCraftMenu() {
        const left = this.craft.x + this.craft.displayWidth / 2;
        const height = this._craftMenuData?.gridH || 0;
        const top = Phaser.Math.Clamp((this.scale.height - height) / 2, 0, this.scale.height - height);
        this.craftContainer.setPosition(Math.round(left), Math.round(top));
    }

    refreshCraftMenu() {
        if (!this.craftContainer) return;
        this.craftContainer.removeAll(true);
        this._data = [];

        const s = this.uiScale || 1;
        const pad = Math.round(4 * s);
        const slotImg = this.textures.get('slot').getSourceImage();
        const baseW = slotImg ? slotImg.width : 32;
        const baseH = slotImg ? slotImg.height : 32;
        const slotW = baseW * s;
        const slotH = baseH * s;

        const recipes = this.getKnownRecipes();
        if (!recipes.length) {
            this._craftMenuData = { cols: 3, rows: 0, gridW: 0, gridH: 0, slotW, slotH, pad };
            this.positionCraftMenu();
            return;
        }

        const cols = 3;
        const rows = Math.ceil(recipes.length / cols);
        const gridW = cols * slotW + (cols - 1) * pad;
        const gridH = rows * slotH + (rows - 1) * pad;
        this._craftMenuData = { cols, rows, gridW, gridH, slotW, slotH, pad };

        for (let i = 0; i < recipes.length; i++) {
            const recipe = recipes[i];
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = col * (slotW + pad);
            const y = row * (slotH + pad);

            // Slot
            const slot = this.add.image(x, y, 'slot').setOrigin(0, 0).setScale(s).setInteractive({ cursor: 'pointer' });
            this.craftContainer.add(slot);

            // Icon
            const icon = this.add.image(x + slotW / 2, y + slotH / 2, recipe.key).setOrigin(0.5, 0.5).setScale(3.0 * s);
            this.craftContainer.add(icon);

            // Quantity
            const quantity = this.add.text(x + slotW - 4 * s, y + slotH - 4 * s, recipe.quantity > 1 ? String(recipe.quantity) : '', {
                fontSize: `${Math.round(14 * s)}px`, fontFamily: 'monospace', stroke: '#000', strokeThickness: 2, align: 'right'
            }).setOrigin(1, 1).setVisible(recipe.quantity > 1);
            this.craftContainer.add(quantity);

            // Tooltip
            const tt = () => {
                const lines = [];
                lines.push(this.formatItemTooltip(this.getItem(recipe.id), recipe.quantity));
                lines.push('—');

                // Ingredients list
                for (const ingredient of recipe.ingredients) {
                    const have = this.player.getNumMatchingItems(ingredient);
                    lines.push(`${this._craftIngredientLabel(ingredient)}: ${have}/${ingredient.qty}`);
                }

                // Require nearby Thing
                if (recipe.requireThing) lines.push(`Requires nearby ${this.getThing(recipe.requireThing).name}`);

                return lines.join('\n');
            };

            slot.on('pointerover', (p) => this.showTooltip(tt, p.x, p.y, slot));
            slot.on('pointerout',  ()  => this.hideTooltip());

            // Craft
            slot.on('pointerdown', ()  => {
                if (this.canCraft(recipe)) {
                    this.doCraft(recipe);
                    this.hotbar.dirty = true;
                    this.refreshTooltip();
                    this.refreshCraftMenu();
                } else {
                    const shake = 3 * s;
                    const homes = [
                        [slot, x],
                        [icon, x + slotW / 2],
                        [quantity, x + slotW - 4 * s]
                    ];
                    for (const [obj] of homes) this.tweens.killTweensOf(obj);
                    if (slot._shakeTween) slot._shakeTween.stop();
                    slot._shakeTween = this.tweens.addCounter({
                        from: 0,
                        to: 1,
                        duration: 160,
                        onUpdate: (tw) => {
                            const offset = Math.sin(tw.getValue() * Math.PI * 4) * shake;
                            for (const [obj, home] of homes) obj.x = home + offset;
                        },
                        onComplete: () => {
                            for (const [obj, home] of homes) obj.x = home;
                            slot._shakeTween = null;
                        }
                    });
                }
            });

            this._data.push({ slot, icon, qty: quantity, recipe: recipe });
        }

        this.positionCraftMenu();
    }

    getKnownRecipes() {
        return this.items().filter(m => m?.recipe).map(meta => {
            const r = meta.recipe, ingredients = [];
            let requireThing = null, quantity = 1;
            for (const [k, v] of Object.entries(r)) {
                if (k === 'QUANTITY') quantity = +v || 1;
                else if (k === 'REQUIRE_THING') requireThing = String(v);
                else if (v && typeof v === 'object') {
                    ingredients.push({
                        id: k,
                        qty: +v.qty || 1,
                        toolClass: v.toolClass || null
                    });
                } else {
                    ingredients.push({ id: k, qty: +v || 1, toolClass: null });
                }
            }
            return {
                id: meta.id,
                name: meta.name,
                key: meta.key,
                ingredients,
                quantity,
                requireThing
            };
        });
    }

    /** Display name for a craft ingredient (supports knapped tip requirements). */
    _craftIngredientLabel(ingredient) {
        if (ingredient.toolClass === "spear_tip") {
            if (ingredient.id === "flint_tool") return "Flint Spear Tip";
            if (ingredient.id === "stone_tool") return "Stone Spear Tip";
        }
        return this.getItem(ingredient.id)?.name || ingredient.id;
    }

    hasNearbyThing(id) {
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;
        for (const chunk of Object.values(this.chunks)) {
            if (!chunk.isLoaded) continue;
            for (const thing of chunk.things.getChildren()) {
                if (!thing.active || thing.meta?.id !== id) continue;
                const dx = thing.x - px;
                const dy = thing.y - py;
                if (dx * dx + dy * dy <= r2) return true;
            }
        }
        return false;
    }

    canCraft(recipe) {
        if (!recipe.ingredients.every(
            (ingredient) => this.player.getNumMatchingItems(ingredient) >= ingredient.qty
        )) {
            return false;
        }
        if (recipe.requireThing && !this.hasNearbyThing(recipe.requireThing)) {
            return false;
        }
        return true;
    }

    doCraft(recipe) {
        const item = this.getItem(recipe.id);
        // Tipped spears inherit quality from the leftmost matching tip in the hotbar
        let tipQuality = null;
        const tipIng = recipe.ingredients?.find((i) => i.toolClass === "spear_tip");
        if (tipIng) {
            for (const stack of this.player.inventory) {
                if (!stack || stack.id !== tipIng.id) continue;
                if (stack.toolClass !== tipIng.toolClass) continue;
                tipQuality = stack.knapQuality || null;
                break;
            }
        }
        for (const ing of recipe.ingredients) this.player.loseMatchingItems(ing);

        if (tipQuality && (recipe.id === "stone_spear" || recipe.id === "flint_spear")) {
            const stack = makeItemStack(item, recipe.quantity || 1, undefined, this.worldMinuteIndex());
            stack.knapQuality = tipQuality;
            if (typeof this.player.gainStack === "function" && this.player.gainStack(stack)) {
                return;
            }
            DroppedItem.spawn(
                this, this.player.x, this.player.y, item, recipe.quantity || 1,
                undefined, { knapQuality: tipQuality }
            );
            return;
        }

        const remaining = this.player.gainItem(item, recipe.quantity);
        if (remaining > 0) DroppedItem.spawn(this, this.player.x, this.player.y, item, remaining);
    }

    createButtons() {
        const s = this.uiScale || 1;
        this.craft = this.add.image(44 * s, this.scale.height / 2, 'craft');
        this.craft.setInteractive({ cursor: 'pointer', pixelPerfect: true });
        this.craft.on('pointerdown', () => this.toggleCraftMenu());
        this.craft.on('pointerover', () => {
            if (!this.craftMenuVisible) this.craft.setTexture('craft_hover');
        });
        this.craft.on('pointerout', () => this.craft.setTexture(this.craftMenuVisible ? 'craft_open' : 'craft'));
        this.craft.setOrigin(0.5, 0.5).setScale(6 * s);
        this.uiLayer.add(this.craft);

        this.healthBtn = this.add.image(44 * s, this.scale.height / 2 + 104 * s, "health");
        this.healthBtn.setInteractive({ cursor: "pointer", pixelPerfect: true });
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
        this.equipmentBtn.setInteractive({ cursor: 'pointer', pixelPerfect: true });
        this.equipmentBtn.on('pointerdown', () => this.toggleEquipmentMenu());
        this.equipmentBtn.on('pointerover', () => {
            if (!this.equipmentPanel?.visible) this.equipmentBtn.setTexture('equipment_hover');
        });
        this.equipmentBtn.on('pointerout', () => {
            this.equipmentBtn.setTexture(this.equipmentPanel?.visible ? 'equipment_open' : 'equipment');
        });
        this.equipmentBtn.setOrigin(0.5, 0.5).setScale(6 * s);
        this.uiLayer.add(this.equipmentBtn);

        this._savePressed = false;
        this.save = this.add.image(this.scale.width - 80 * s, 32 * s, 'save');
        this.save.setInteractive({ useHandCursor: true, pixelPerfect: true });
        this.save.on('pointerdown', () => {
            this._savePressed = true;
            this.save.setTexture('save_open');
            this.saveFile();
            // Download can swallow Phaser pointerup; keep open briefly for press feedback
            this.time.delayedCall(150, () => {
                this._releasePressButton('_savePressed', this.save, 'save');
            });
        });
        this.save.on('pointerover', (p) => {
            if (!this._savePressed) this.save.setTexture('save_hover');
            this.showTooltip('Save', p.x, p.y, this.save);
        });
        this.save.on('pointerout', () => {
            if (!this._savePressed) this.save.setTexture('save');
            if (this._tooltipTarget === this.save) this.hideTooltip();
        });
        this.save.setOrigin(0.5, 0.5).setScale(3 * s);
        this.uiLayer.add(this.save);

        this._loadPressed = false;
        this.load = this.add.image(this.scale.width - 32 * s, 32 * s, 'load');
        this.load.setInteractive({ useHandCursor: true, pixelPerfect: true });
        this.load.on('pointerdown', () => {
            this._loadPressed = true;
            this.load.setTexture('load_open');
            // File dialog can swallow Phaser pointerup; release when dialog settles
            this.loadFile().finally(() => this._releasePressButton('_loadPressed', this.load, 'load'));
        });
        this.load.on('pointerover', (p) => {
            if (!this._loadPressed) this.load.setTexture('load_hover');
            this.showTooltip('Load', p.x, p.y, this.load);
        });
        this.load.on('pointerout', () => {
            if (!this._loadPressed) this.load.setTexture('load');
            if (this._tooltipTarget === this.load) this.hideTooltip();
        });
        this.load.setOrigin(0.5, 0.5).setScale(3 * s);
        this.uiLayer.add(this.load);

        // Help (hover for controls; hold-click shows pressed art only)
        this._helpPressed = false;
        this.help = this.add.image(this.scale.width - 32 * s, this.scale.height - 32 * s, 'help');
        this.help.setInteractive({ useHandCursor: true, pixelPerfect: true });
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
            this.help.setTexture('help_click');
        });
        this.help.setOrigin(0.5, 0.5).setScale(3 * s);
        this.uiLayer.add(this.help);

        this.input.on('pointerup', () => {
            this._releasePressButton('_savePressed', this.save, 'save');
            this._releasePressButton('_loadPressed', this.load, 'load');
            this._releasePressButton('_helpPressed', this.help, 'help');
        });
    }

    /** Clear a momentary press texture (browser dialogs often skip Phaser pointerup). */
    _releasePressButton(flagName, image, key) {
        if (!this[flagName] || !image) return;
        this[flagName] = false;
        const p = this.input.activePointer;
        const over = Phaser.Geom.Rectangle.Contains(image.getBounds(), p.x, p.y);
        const hoverKey = key === 'help' ? 'help_hover' : `${key}_hover`;
        image.setTexture(over ? hoverKey : key);
    }

    _helpTooltipText() {
        return [
            "WASD / Arrows — Move",
            "Shift — Sprint",
            "Space — Use item / Attack",
            "Mouse — Aim attacks",
            "Left-click — Pick up / interact",
            "Right-click — Move 1 item",
            "Shift+Right-click — Move whole stack",
            "Ctrl+Right-click — Move half stack",
            "Q — Drop item",
            "Shift+Q — Drop stack",
            "Ctrl+Q — Drop 10",
            "F — Pick up dropped items",
            "1-0 — Hotbar slots",
            "C — Crafting",
            "E — Equipment",
            "H — Health",
            "T — Chat"
        ].join("\n");
    }

    createDeathOverlay() {
        this.deathOverlay = this.add.container(0, 0).setScrollFactor(0).setDepth(20000).setVisible(false);
        this.uiLayer.add(this.deathOverlay);
        this.deathBg = this.add.rectangle(0, 0, 400, 200, 0x000000, 0.75).setOrigin(0.5);
        this.deathTitle = this.add.text(0, -50, "You died", {
            fontFamily: "monospace",
            fontSize: "36px",
            color: "#ff6666"
        }).setOrigin(0.5);
        this.deathRespawn = this.add.text(0, 20, "[ Respawn ]", {
            fontFamily: "monospace",
            fontSize: "20px",
            color: "#e8e0d0"
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        this.deathRespawnHere = this.add.text(0, 55, "[ Respawn Here (dev) ]", {
            fontFamily: "monospace",
            fontSize: "16px",
            color: "#aaa090"
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        this.deathOverlay.add([this.deathBg, this.deathTitle, this.deathRespawn, this.deathRespawnHere]);
        this.deathRespawn.on("pointerdown", () => this.respawnPlayer(false));
        this.deathRespawnHere.on("pointerdown", () => this.respawnPlayer(true));
        this._deathPos = { x: 0, y: 0 };
    }

    onPlayerDied() {
        this._deathPos = { x: this.player.x, y: this.player.y };
        this.player._tendChannel = null;
        this.player._skinChannel = null;
        this.hideChannelBar?.();
        this.corpsePanel?.close?.(true);
        this.player.createDeathCorpse();
        this.player.setVisible(false);
        if (this.player.body) this.player.body.enable = false;
        this.player.setVelocity(0, 0);
        this.combatLog?.push("You died.");
        this.deathOverlay?.setVisible(true);
        this.layoutDeathOverlay();
    }

    layoutDeathOverlay() {
        if (!this.deathOverlay) return;
        const s = this.uiScale || 1;
        this.deathOverlay.setPosition(this.scale.width / 2, this.scale.height / 2);
        this.deathTitle.setFontSize(Math.round(36 * s));
        this.deathRespawn.setFontSize(Math.round(20 * s));
        this.deathRespawnHere.setFontSize(Math.round(16 * s));
        this.deathBg.setSize(420 * s, 220 * s);
    }

    /** Put the player back on the continuous physics pose before the next step. */
    restorePlayerPhysicsPos() {
        const player = this.player;
        if (!player?.active || player._physX == null) return;
        if (player.x !== player._physX || player.y !== player._physY) {
            player.setPosition(player._physX, player._physY);
        }
    }

    /**
     * After physics: remember the true pose, then snap player + camera to the
     * screen-pixel grid for rendering (1/zoom world units). Physics keeps using
     * the unsnapped pose via restorePlayerPhysicsPos on preupdate.
     */
    syncCameraToPlayer() {
        const player = this.player;
        const cam = this.cameras?.main;
        if (!player?.active || !cam) return;
        const z = this.worldZoom || cam.zoom || 1;
        player._physX = player.x;
        player._physY = player.y;
        const x = Math.floor(player.x * z) / z;
        const y = Math.floor(player.y * z) / z;
        if (player.x !== x || player.y !== y) {
            player.setPosition(x, y);
        }
        cam.centerOn(x, y);
    }

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
        this.player.respawnFresh(x, y);
        this.deathOverlay?.setVisible(false);
        this.closeOpenMenus();
        this.syncCameraToPlayer();
        this.healthPanel?.refresh?.();
        this.combatLog?.push(here ? "Respawned here (dev)." : "Respawned.");
    }

    /** Close side menus, world panels, channel bar, and chat compose. */
    closeOpenMenus() {
        this.hideChannelBar?.();
        if (this.craftMenuVisible) this.closeCraftMenu();
        if (this.equipmentPanel?.visible) this.equipmentPanel.close();
        if (this.healthPanel?.visible) this.healthPanel.close();
        if (this.corpsePanel?.visible) this.corpsePanel.close();
        if (this.campfirePanel?.visible) this.campfirePanel.close();
        if (this.combatLog?.composing) this.combatLog.closeChat(false);
    }

    toggleHealthMenu() {
        if (!this.healthPanel) return;
        if (this.knappingPanel?.visible) return;
        // Any health view open (own or corpse inspect) → close panel only
        if (this.healthPanel.visible) {
            this.healthPanel.close();
            return;
        }
        // Side menus exclude each other; world UIs can stay open
        if (this.craftMenuVisible) this.closeCraftMenu();
        if (this.equipmentPanel?.visible) this.equipmentPanel.close();
        this.healthPanel.open();
    }

    closeCraftMenu() {
        if (!this.craftMenuVisible) return;
        this.craftMenuVisible = false;
        this.craftContainer.setVisible(false);
        const p = this.input.activePointer;
        const hovering = Phaser.Geom.Rectangle.Contains(this.craft.getBounds(), p.x, p.y);
        this.craft.setTexture(hovering ? 'craft_hover' : 'craft');
    }

    toggleCraftMenu() {
        if (this.knappingPanel?.visible) return;
        if (this.craftMenuVisible) {
            this.closeCraftMenu();
            return;
        }
        // Side menus exclude each other; world UIs can stay open
        if (this.equipmentPanel?.visible) this.equipmentPanel.close();
        if (this.healthPanel?.visible) this.healthPanel.close();
        this.craftMenuVisible = true;
        this.refreshCraftMenu();
        this.positionCraftMenu();
        this.craftContainer.setVisible(true);
        this.craft.setTexture('craft_open');
    }

    toggleEquipmentMenu() {
        if (!this.equipmentPanel) return;
        if (this.knappingPanel?.visible) return;
        this.equipmentPanel.toggle();
    }

    getKey(x, y) {
        return `${x},${y}`;
    }

    getChunk(x, y) {
        return this.chunks[this.getKey(x, y)] || null;
    }

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
        if (this.healthPanel?.isInspecting?.()) this.healthPanel.close();

        for (const chunk of Object.values(this.chunks || {})) chunk.unload();
        this.chunks = {};
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
        if (this.meleeSlots?.slots) {
            for (const s of this.meleeSlots.slots) s.owners = [];
        }
        this.markLightDirty?.();
        return n;
    }

    chunkPx() {
        return this.chunkSize * this.tileSize;
    }

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
    }

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
    }

    updateChunkDistances() {
        // How many world tiles fit on screen at the current zoom
        const viewTilesX = this.scale.width / (this.tileSize * this.worldZoom);
        const viewTilesY = this.scale.height / (this.tileSize * this.worldZoom);
        // Half the longer axis in chunks, plus margin so edges stay filled while moving
        const halfChunks = Math.max(viewTilesX, viewTilesY) / (2 * this.chunkSize);
        const margin = 2;
        this.renderDistance = Math.max(3, Math.ceil(halfChunks) + margin);
        this.cullDistance = this.renderDistance + 2;
    }

    updateUiScale() {
        // Scale UI relative to the original 1024x768 design; round to 0.5 for sharper pixels
        const raw = Math.min(this.scale.width / 1024, this.scale.height / 768);
        this.uiScale = Math.max(1, Math.round(raw * 2) / 2);
    }

    applyUiScale() {
        const s = this.uiScale || 1;

        if (this._uiCam) this._uiCam.setSize(this.scale.width, this.scale.height);

        this.drawBars();

        if (this.hotbar) this.hotbar.layout();

        if (this.tooltipText) {
            this._tooltipPadding = Math.round(6 * s);
            this.tooltipText.setFontSize(`${Math.round(18 * s)}px`);
            this.tooltipText.setPadding(this._tooltipPadding);
            this.tooltipText.setStroke('#000000', Math.max(2, Math.round(2 * s)));
        }

        const pad = 8 * s;
        const cx = this.scale.width / 2;
        if (this.clockText) {
            this.clockText.setFontSize(`${Math.round(16 * s)}px`);
            this.clockText.setStroke("#000000", Math.max(2, Math.round(3 * s)));
            this.clockText.setOrigin(0.5, 0).setPosition(cx, pad);
        }
        if (this.fpsText) {
            const clockBottom = this.clockText
                ? pad + (this.clockText.height || Math.round(16 * s))
                : pad;
            this.fpsText
                .setFontSize(`${Math.round(12 * s)}px`)
                .setStroke("#000000", Math.max(2, Math.round(3 * s)))
                .setOrigin(0.5, 0)
                .setPosition(cx, clockBottom + Math.round(2 * s));
        }

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
            this.save.setScale(3 * s).setPosition(this.scale.width - 80 * s, 32 * s);
            this.load.setScale(3 * s).setPosition(this.scale.width - 32 * s, 32 * s);
            if (this.help) {
                this.help.setScale(3 * s).setPosition(
                    this.scale.width - 32 * s,
                    this.scale.height - 32 * s
                );
            }
        }

        if (this.craftMenuVisible) this.refreshCraftMenu();
        else this.positionCraftMenu();

        if (this.equipmentPanel?.visible) {
            this.equipmentPanel.refresh();
            this.equipmentPanel.layout();
        } else if (this.equipmentPanel) {
            this.equipmentPanel.layout();
        }

        if (this.campfirePanel?.visible) this.campfirePanel.layout();
        if (this.knappingPanel?.visible) this.knappingPanel.layout();

        if (this._waterSprite) {
            const w = (roundUpToEven(this.scale.width / this.tileSize / this.worldZoom) + 2) * this.tileSize;
            const h = (roundUpToEven(this.scale.height / this.tileSize / this.worldZoom) + 2) * this.tileSize;
            this._waterSprite.setSize(w, h);
        }

        this.markLightDirty();
        this.updateLightVeil();
    }

    animateWater() {
        this._waterSprite.setFrame(this._waterFrame++);
        if (this._waterFrame > 3) this._waterFrame = 0;
    }

    async saveFile(filename=null) {
        filename = filename || `save-${Date.now()}.txt`;
        const data = LZString.compressToBase64(JSON.stringify({
            chunks: this.chunks,
            player: this.player,
            seed: worldSeed,
            clock: {
                day: this.gameDay,
                minutes: this.gameMinutes
            }
        }));
        const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return Promise.resolve();
    }

    async loadFile() {
        return new Promise((resolve, reject) => {
            this.isPaused = true;
            const fileInput = document.getElementById("fileLoader");
            fileInput.value = "";
            let settled = false;
            const settle = (fn, value) => {
                if (settled) return;
                settled = true;
                window.removeEventListener('focus', onWindowFocus);
                fileInput.removeEventListener('cancel', onFileCancel);
                fn(value);
            };
            // Cancel often skips onchange; when focus returns, treat as dismiss
            const onWindowFocus = () => {
                window.setTimeout(() => {
                    if (settled) return;
                    this.isPaused = false;
                    settle(resolve, null);
                }, 250);
            };
            const onFileCancel = () => {
                this.isPaused = false;
                settle(resolve, null);
            };
            fileInput.addEventListener('cancel', onFileCancel, { once: true });
            fileInput.onchange = (e) => {
                // Selection started — don't treat focus return as cancel mid-read
                window.removeEventListener('focus', onWindowFocus);
                fileInput.removeEventListener('cancel', onFileCancel);
                const file = e.target.files[0];
                if (!file) {
                    this.isPaused = false;
                    settle(reject, new Error("No file selected"));
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const data = JSON.parse(LZString.decompressFromBase64(JSON.parse(reader.result)));

                        for (const chunk of Object.values(this.chunks)) chunk.unload();
                        this.chunks = {};
                        this._spawnSignPlaced = false;
                        this._spawnSignBusy = false;
                        this._playerSpawnPlaced = true; // keep loaded player coords
                        this._things.clear(true, true);
                        if (this.mobs) {
                            for (const mob of this.mobs.getChildren().slice()) {
                                this.damageables.remove(mob);
                            }
                            this.mobs.clear(true, true);
                        }
                        if (this.droppedItems) {
                            this.droppedItems.clear(true, true);
                        }

                        // Seed
                        worldSeed = data.seed;
                        noise.seed(worldSeed);

                        // Chunks
                        for (const [key, meta] of Object.entries(data.chunks)) {
                            const drops = meta.drops || [];
                            this._migrateLegacyItemIds(drops);
                            for (const corpse of meta.corpses || []) {
                                this._migrateLegacyItemIds(corpse?.loot);
                            }
                            const chunk = new Chunk(this, meta.x, meta.y, {
                                tiles: meta.tiles,
                                things: meta.things,
                                lootableThings: meta.lootableThings,
                                mobs: meta.mobs || [],
                                drops,
                                bloodStains: meta.bloodStains || [],
                                corpses: meta.corpses || []
                            });
                            chunk.isGenerated = !chunk.meta.tiles.every(t => !t);
                            this.chunks[key] = chunk;
                        }

                        // Player
                        this.player.teleport(data.player.x, data.player.y);
                        this.syncCameraToPlayer();
                        if (data.player.body) {
                            this.player.anatomy.loadJSON(data.player.body);
                            this.player.capacities = new Capacities(this.player.anatomy);
                            this.player._bodyDead = false;
                            this.player._refreshDownedState?.();
                        }
                        this.player.kc = data.player.kc;
                        this.player.saturation = data.player.saturation;
                        this.player.inventory = data.player.inventory;
                        this._migrateLegacyItemIds(this.player.inventory);
                        this.player.loadEquipment(data.player.equipment);

                        // Clock before spoil migration (spoilAt is absolute world minutes)
                        this.gameDay = data.clock?.day ?? 1;
                        this.gameMinutes = data.clock?.minutes ?? 8 * 60;
                        this.updateClockText();
                        this.markLightDirty();
                        this.updateLightVeil();

                        this.ensureSpoilAt(this.player.inventory);
                        this.ensureSpoilAt([
                            this.player.equipment.head,
                            this.player.equipment.torso,
                            this.player.equipment.legs,
                            this.player.equipment.feet,
                            ...this.player.equipment.waist
                        ]);
                        this.migrateWorldSpoilAt();

                        // Refresh UI
                        this.hotbar.dirty = true;
                        this.deathOverlay?.setVisible(false);
                        this.healthPanel?.refresh?.();
                        if (this.campfirePanel?.visible) this.campfirePanel.close();
                        if (this.healthPanel?.visible) {
                            this.healthPanel.close();
                            this.healthBtn?.setTexture("health");
                        }
                        if (this.equipmentPanel?.visible) {
                            this.equipmentPanel.refresh();
                            this.equipmentPanel.layout();
                        }

                        settle(resolve, data);
                    } catch (err) {
                        console.error("Failed to parse save file:", err);
                        settle(reject, err);
                    } finally {
                        this.isPaused = false;
                    }
                };
                reader.onerror = () => {
                    this.isPaused = false;
                    settle(reject, reader.error || new Error("Failed to read file"));
                };
                reader.readAsText(file);
            };
            window.addEventListener('focus', onWindowFocus);
            fileInput.click();
        });
    }

    update(time, delta) {
        super.update(time, delta);

        // Calculate player chunk
        let snappedChunkX = Math.round(this.player.posX() / this.chunkSize);
        let snappedChunkY = Math.round(this.player.posY() / this.chunkSize);

        // Render chunks around the player
        for (let x = snappedChunkX - this.renderDistance; x < snappedChunkX + this.renderDistance; x++) {
            for (let y = snappedChunkY - this.renderDistance; y < snappedChunkY + this.renderDistance; y++) {
                const key = this.getKey(x, y);
                if (!this.chunks[key]) {
                    this.chunks[key] = new Chunk(this, x, y);
                }
            }
        }

        // Load/unload chunks (iterate known chunks so a shrink on resize unloads correctly)
        for (const chunk of Object.values(this.chunks)) {
            const dist = Phaser.Math.Distance.Between(
                snappedChunkX,
                snappedChunkY,
                chunk.x,
                chunk.y
            );
            if (dist <= this.renderDistance) {
                chunk.load();
            } else {
                chunk.unload();
            }
        }

        if (!this._spawnSignPlaced || !this._playerSpawnPlaced) this.ensureSpawnSign();

        // Process input (menus / hotbar / chat blocked while knapping — R/Esc stay in panel)
        const chatting = !!this.combatLog?.isComposing?.();
        const knapping = !!this.knappingPanel?.visible;
        if (!chatting && !knapping) {
            if (this.key1.isDown && this.hotbar.size >= 1) this.hotbar.changeSlot(0);
            if (this.key2.isDown && this.hotbar.size >= 2) this.hotbar.changeSlot(1);
            if (this.key3.isDown && this.hotbar.size >= 3) this.hotbar.changeSlot(2);
            if (this.key4.isDown && this.hotbar.size >= 4) this.hotbar.changeSlot(3);
            if (this.key5.isDown && this.hotbar.size >= 5) this.hotbar.changeSlot(4);
            if (this.key6.isDown && this.hotbar.size >= 6) this.hotbar.changeSlot(5);
            if (this.key7.isDown && this.hotbar.size >= 7) this.hotbar.changeSlot(6);
            if (this.key8.isDown && this.hotbar.size >= 8) this.hotbar.changeSlot(7);
            if (this.key9.isDown && this.hotbar.size >= 9) this.hotbar.changeSlot(8);
            if (this.key0.isDown && this.hotbar.size >= 10) this.hotbar.changeSlot(9);
            if (Phaser.Input.Keyboard.JustDown(this.keyC)) this.toggleCraftMenu();
            if (Phaser.Input.Keyboard.JustDown(this.keyE)) this.toggleEquipmentMenu();
            if (Phaser.Input.Keyboard.JustDown(this.keyH)) this.toggleHealthMenu();
            // Chat open is handled by CombatLog's window keydown listener (avoids
            // JustDown(T) dying after keyboard.enabled toggles miss the T keyup).
            if (Phaser.Input.Keyboard.JustDown(this.keyG)) {
                LivingMob.spawn(this, "human", this.player.x, this.player.y);
            }
        }

        // Update player
        this.knappingPanel?.update?.();
        this.player.update(time, delta);
        this.combatLog?.update?.();
        this.updateFpsMeter?.(delta);

        // Update living mobs (slice: AI may destroy self on chunk boundary)
        for (const mob of this.mobs.getChildren().slice()) {
            if (mob?.active && typeof mob.update === "function") {
                mob.update(time, delta);
            }
        }
        for (const drop of this.droppedItems.getChildren().slice()) {
            if (drop?.active && typeof drop.update === "function") {
                drop.update(time, delta);
            }
        }
        const pain = this.player.capacities?.pain?.() ?? 0;
        if (
            pain !== this._lastPain ||
            this.player.kc !== this._lastKc ||
            this.player.saturation !== this._lastSaturation ||
            this.player.stomach !== this._lastStomach ||
            this.player.getInventoryWeight() !== this._lastWeight ||
            this.player.strength !== this._lastStrength
        ) {
            this.drawBars();
            this.refreshTooltip();
        }
        if (this.hotbar.dirty) {
            this.hotbar.update();
            this.refreshTooltip();
            this.hotbar.dirty = false;
        }

        this.campfirePanel?.update();
        this.corpsePanel?.update();
        this.updateLightVeil();

        // Update water sprite position
        let position = [Math.round(this.player.posX()), Math.round(this.player.posY())];
        if (position !== this._oldPosition) {
            this._oldPosition = position;
            this._waterSprite.setPosition(
                position[0] * this.tileSize,
                position[1] * this.tileSize
            );
        }
    }
}