class SceneMain extends SceneBase {
    constructor() {
        super({ key: "SceneMain" });
    }

    create() {
        this.input.mouse.disableContextMenu();

        // Layers
        this.groundLayer = this.add.layer().setDepth(0);
        this.mainLayer = this.add.layer().setDepth(1);
        this.uiLayer = this.add.layer().setDepth(2);

        // Chunks
        this.chunkSize = 8;
        this.tileSize = 16;
        this.worldZoom = 3;
        this.chunks = {};
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

        // Combat targets (player, future animals/monsters)
        this.damageables = this.add.group();

        // Player
        this.player = new Player(this, 0, 0);
        this.damageables.add(this.player);
        this.cameras.main.startFollow(this.player);
        this.cameras.main.setZoom(this.worldZoom);

        // In-game clock: 1 game minute per real second, starts Day 1 08:00
        this.gameDay = 1;
        this.gameMinutes = 8 * 60;
        this.time.addEvent({
            delay: 1000,
            callback: this.worldMinuteTick,
            callbackScope: this,
            loop: true
        });

        // Collisions
        this._things = this.physics.add.staticGroup();
        this.physics.add.collider(this.player, this._things);
        this.droppedItems = this.add.group();

        // UI
        this.cameras.main.ignore(this.uiLayer);
        this._uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height).setScroll(0, 0).setZoom(1);
        let cameras = [this.groundLayer, this.mainLayer];
        if (this.physics.world.debug) cameras.push(this.physics.world.debugGraphic);
        this._uiCam.ignore(cameras);
        this.createLightVeil();
        this.createBars();
        this.hotbar = new Hotbar(this);
        this.createTooltip();
        this.createClockDisplay();
        this.createCraftMenu();
        this.createButtons();
        this.equipmentPanel = new EquipmentPanel(this);
        this.campfirePanel = new CampfirePanel(this);
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
    }

    createBars() {
        this.hpBar = this.add.graphics();
        this.uiLayer.add(this.hpBar);

        this.kcBar = this.add.graphics();
        this.uiLayer.add(this.kcBar);

        this.weightBar = this.add.graphics();
        this.uiLayer.add(this.weightBar);

        this.barIcons = this.add.image(0, 0, "bar_icons").setOrigin(0, 0);
        this.uiLayer.add(this.barIcons);

        this.hpBarZone = this._makeBarZone(() =>
            `HP: ${Math.ceil(this.player.hp)}/${this.player.mhp}`
        );
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

        this._lastHp = NaN;
        this._lastMhp = NaN;
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

        const hp = Math.ceil(this.player.hp);
        const mhp = this.player.mhp;
        const kc = Math.ceil(this.player.kc);
        const sat = this.player.saturation;
        const stomach = this.player.stomach;
        const weight = this.player.getInventoryWeight();
        const strength = this.player.strength;

        const hpFrac = hp / mhp;
        const kcFrac = kc / stomach;
        const satFrac = Phaser.Math.Clamp(sat / stomach, 0, 1);

        // HP
        this.hpBar.clear();
        this._drawBar(this.hpBar, x, y, w, h, hpFrac, 0x000000, 0x222222, 0xD24A43, border);

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

        this._setBarZone(this.hpBarZone, x, y, w, h);
        this._setBarZone(this.kcBarZone, x, ky, w, h);
        this._setBarZone(this.weightBarZone, x, wy, w, h);

        this._lastHp = hp;
        this._lastMhp = mhp;
        this._lastKc = kc;
        this._lastSaturation = sat;
        this._lastStomach = stomach;
        this._lastWeight = weight;
        this._lastStrength = strength;
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

        this.showTooltip = (textOrFn, x, y, target=null) => {
            this._tooltipSource = (typeof textOrFn === "function") ? textOrFn : () => textOrFn;
            this._tooltipTarget = target;
            const t = this._tooltipSource() || "";
            this.tooltipText.setText(t);
            drawBg();
            this.tooltip.setVisible(!!t);
            this.positionTooltip(x, y);
        };

        this.refreshTooltip = () => {
            if (!this.tooltip.visible || !this._tooltipSource) return;
            const t = this._tooltipSource() || "";
            if (!t) {
                this.hideTooltip();
                return;
            }
            this.tooltipText.setText(t);
            drawBg();
        };

        this.hideTooltip = () => {
            this._tooltipSource = null;
            this._tooltipTarget = null;
            this.tooltip.setVisible(false);
        };

        this._pickHoverTarget = (pointer) => {
            const hits = this.input.hitTestPointer(pointer);

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
            if (obj.input.cursor) return obj.input.cursor;
            if (obj.input.useHandCursor) return 'pointer';
            return 'pointer';
        };

        // Reconcile hover after camera/player movement (Phaser only updates on mouse move)
        this.syncPointerHover = () => {
            const pointer = this.input.activePointer;
            const top = this._pickHoverTarget(pointer);

            if (top !== this._hoverTarget) {
                const prev = this._hoverTarget;
                this._hoverTarget = top;

                if (prev && prev.active && prev.input?.enabled) {
                    prev.emit('pointerout', pointer);
                } else if (this._tooltipTarget && this._tooltipTarget !== top) {
                    this.hideTooltip();
                }

                if (top) top.emit('pointerover', pointer);
                else this.hideTooltip();
            } else if (top && this.tooltip.visible) {
                this.positionTooltip(pointer.x, pointer.y);
            }

            this.input.setDefaultCursor(top ? this._cursorFor(top) : 'default');
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
        this.events.on("postupdate", () => this.syncPointerHover());
        this.scale.on("resize", () => this.hideTooltip());
    }

    createClockDisplay() {
        this.clockText = this.add.text(0, 0, "", {
            fontSize: "16px",
            fontFamily: "monospace",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 3
        }).setOrigin(0, 1).setDepth(9998);
        this.uiLayer.add(this.clockText);
        this.updateClockText();
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

    consumeNearbyDrops(requirements) {
        // requirements: { stick: 15, leaf: 10 }
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;

        const drops = this.droppedItems.getChildren()
            .filter(d => d.active)
            .map(d => ({
                drop: d,
                dist: Phaser.Math.Distance.Between(px, py, d.x, d.y)
            }))
            .filter(e => e.dist * e.dist <= r2)
            .sort((a, b) => a.dist - b.dist)
            .map(e => e.drop);

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
            }
        }
        return true;
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

        // Ground recipe: 15 sticks + 10 leaves
        const { tx, ty } = this.worldToTile(this.player.x, this.player.y - 1);
        if (this.findCampfireOnTile(tx, ty)) return false;
        if (!this.consumeNearbyDrops({ stick: 15, leaf: 10 })) return false;

        const stick = this.getItem('stick');
        const leaf = this.getItem('leaf');
        const fire = this.placeCampfire(
            tx,
            ty,
            makeItemStack(leaf, 10),
            makeItemStack(stick, 15)
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
    }

    tickSpoilage() {
        let dirty = false;
        const rot = this.getItem("rot");

        const spoilStack = (stack) => {
            if (!stack || stack.spoilMinutes == null) return stack;
            stack.spoilMinutes -= 1;
            if (stack.spoilMinutes > 0) return stack;
            dirty = true;
            if (!rot) {
                delete stack.spoilMinutes;
                return stack;
            }
            return { id: rot.id, quantity: stack.quantity };
        };

        const inv = this.player.inventory;
        for (let i = 0; i < inv.length; i++) {
            if (inv[i]) inv[i] = spoilStack(inv[i]);
        }

        const eq = this.player.equipment;
        for (const key of ["head", "torso", "legs", "feet"]) {
            if (eq[key]) eq[key] = spoilStack(eq[key]);
        }
        for (let i = 0; i < eq.waist.length; i++) {
            if (eq.waist[i]) eq.waist[i] = spoilStack(eq.waist[i]);
        }

        for (const drop of this.droppedItems.getChildren()) {
            if (!drop.active || drop.spoilMinutes == null) continue;
            drop.spoilMinutes -= 1;
            if (drop.spoilMinutes > 0) continue;
            dirty = true;
            if (!rot) {
                delete drop.spoilMinutes;
                continue;
            }
            drop.item = rot;
            delete drop.spoilMinutes;
            drop.setTexture(rot.key);
        }

        let cookDirty = false;
        for (const fire of this.getCampfires()) {
            if (fire.entry.cook) {
                const prevId = fire.entry.cook.id;
                fire.entry.cook = spoilStack(fire.entry.cook);
                if (fire.entry.cook?.id !== prevId) {
                    fire.entry.cookProgress = 0;
                    cookDirty = true;
                }
            }
            if (fire.entry.catalyst) {
                const prevId = fire.entry.catalyst.id;
                fire.entry.catalyst = spoilStack(fire.entry.catalyst);
                if (fire.entry.catalyst?.id !== prevId) cookDirty = true;
            }
            if (Array.isArray(fire.entry.simmer)) {
                for (let i = 0; i < fire.entry.simmer.length; i++) {
                    if (!fire.entry.simmer[i]) continue;
                    const prevId = fire.entry.simmer[i].id;
                    fire.entry.simmer[i] = spoilStack(fire.entry.simmer[i]);
                    // Spoiled/junk slots block simmer and drain progress over time (don't hard-reset)
                    if (fire.entry.simmer[i]?.id !== prevId) cookDirty = true;
                }
            }
        }

        if (dirty) {
            this.hotbar.dirty = true;
            if (this.equipmentPanel?.visible) this.equipmentPanel.refresh();
        }
        if (cookDirty) this.campfirePanel?.refresh();
        if (this.tooltip?.visible) this.refreshTooltip();
    }

    ensureSpoilMinutes(stacks) {
        if (!stacks) return;
        for (const stack of stacks) {
            if (!stack) continue;
            if (stack.spoilMinutes != null) continue;
            if (stack.food?.spoil != null) {
                stack.spoilMinutes = Math.round(stack.food.spoil * 60);
                continue;
            }
            const meta = this.getItem(stack.id);
            if (meta?.food?.spoil) {
                stack.spoilMinutes = defaultSpoilMinutes(meta);
            }
        }
    }

    formatItemTooltip(item, quantity, spoilMinutes, stack = null) {
        const lines = [];
        const displayName = stack?.customName || item.name;
        const name = quantity > 1 ? `${displayName} x${quantity}` : displayName;
        lines.push(name);

        // Weight (stack.weight for dynamic meals)
        const weight = stack?.weight != null ? stack.weight : item.weight;
        if (weight > 0) {
            lines.push(`Weight: ${weight} kg`);
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

            const mins = spoilMinutes != null
                ? spoilMinutes
                : (food.spoil != null ? Math.round(food.spoil * 60) : defaultSpoilMinutes(item));
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

        if (item.weapon) {
            const dmg = Number(item.weapon.damage ?? 0);
            if (dmg > 0) lines.push(`Damage: ${dmg}`);
            if (item.weapon.type) lines.push(`Type: ${item.weapon.type}`);
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
                    const meta = this.getItem(ingredient.id);
                    lines.push(`${meta.name}: ${this.player.getNumItems(ingredient.id)}/${ingredient.qty}`);
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
                else ingredients.push({ id: k, qty: +v || 1 });
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
        if (!recipe.ingredients.every(ingredient => this.player.getNumItems(ingredient.id) >= ingredient.qty)) {
            return false;
        }
        if (recipe.requireThing && !this.hasNearbyThing(recipe.requireThing)) {
            return false;
        }
        return true;
    }

    doCraft(recipe) {
        const item = this.getItem(recipe.id);
        for (const ing of recipe.ingredients) this.player.loseAnyItem(ing.id, ing.qty);
        const remaining = this.player.gainItem(item, recipe.quantity);
        if (remaining > 0) DroppedItem.spawn(this, this.player.x, this.player.y, item, remaining);
    }

    createButtons() {
        const s = this.uiScale || 1;
        this.craft = this.add.image(44 * s, this.scale.height / 2 + 52 * s, 'craft');
        this.craft.setInteractive({ cursor: 'pointer', pixelPerfect: true });
        this.craft.on('pointerdown', () => this.toggleCraftMenu());
        this.craft.on('pointerover', () => {
            if (!this.craftMenuVisible) this.craft.setTexture('craft_hover');
        });
        this.craft.on('pointerout', () => this.craft.setTexture(this.craftMenuVisible ? 'craft_open' : 'craft'));
        this.craft.setOrigin(0.5, 0.5).setScale(6 * s);
        this.uiLayer.add(this.craft);

        this.equipmentBtn = this.add.image(44 * s, this.scale.height / 2 - 52 * s, 'equipment');
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

        this.save = this.add.image(this.scale.width - 80 * s, 32 * s, 'save');
        this.save.setInteractive({ useHandCursor: true, pixelPerfect: true });
        this.save.on('pointerdown', async () => {
            this.save.setTexture('save_open');
            await this.saveFile();
            this.save.setTexture('save');
        });
        this.save.on('pointerover', (p) => {
            this.save.setTexture('save_hover');
            this.showTooltip('Save', p.x, p.y, this.save);
        });
        this.save.on('pointerout', () => {
            this.save.setTexture('save');
            this.hideTooltip();
        });
        this.save.setOrigin(0.5, 0.5).setScale(3 * s);
        this.uiLayer.add(this.save);

        this.load = this.add.image(this.scale.width - 32 * s, 32 * s, 'load');
        this.load.setInteractive({ useHandCursor: true, pixelPerfect: true });
        this.load.on('pointerdown', async () => {
            this.load.setTexture('load_open');
            await this.loadFile();
            this.load.setTexture('load');
        });
        this.load.on('pointerover', (p) => {
            this.load.setTexture('load_hover');
            this.showTooltip('Load', p.x, p.y, this.load);
        });
        this.load.on('pointerout', () => {
            this.load.setTexture('load');
            this.hideTooltip();
        });
        this.load.setOrigin(0.5, 0.5).setScale(3 * s);
        this.uiLayer.add(this.load);
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
        if (this.craftMenuVisible) {
            this.closeCraftMenu();
            return;
        }
        if (this.equipmentPanel?.visible) this.equipmentPanel.close();
        if (this.campfirePanel?.visible) this.campfirePanel.close();
        this.craftMenuVisible = true;
        this.refreshCraftMenu();
        this.positionCraftMenu();
        this.craftContainer.setVisible(true);
        this.craft.setTexture('craft_open');
    }

    toggleEquipmentMenu() {
        if (!this.equipmentPanel) return;
        this.equipmentPanel.toggle();
    }

    getKey(x, y) {
        return `${x},${y}`;
    }

    getChunk(x, y) {
        return this.chunks[this.getKey(x, y)] || null;
    }

    chunkPx() {
        return this.chunkSize * this.tileSize;
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

        if (this.clockText) {
            const pad = 8 * s;
            this.clockText.setFontSize(`${Math.round(16 * s)}px`);
            this.clockText.setStroke("#000000", Math.max(2, Math.round(3 * s)));
            this.clockText.setPosition(pad, this.scale.height - pad);
        }

        if (this.craft) {
            this.craft.setScale(6 * s).setPosition(44 * s, this.scale.height / 2 + 52 * s);
            if (this.equipmentBtn) {
                this.equipmentBtn.setScale(6 * s).setPosition(44 * s, this.scale.height / 2 - 52 * s);
            }
            this.save.setScale(3 * s).setPosition(this.scale.width - 80 * s, 32 * s);
            this.load.setScale(3 * s).setPosition(this.scale.width - 32 * s, 32 * s);
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
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) {
                    this.isPaused = false;
                    reject(new Error("No file selected"));
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const data = JSON.parse(LZString.decompressFromBase64(JSON.parse(reader.result)));

                        for (const chunk of Object.values(this.chunks)) chunk.unload();
                        this.chunks = {};
                        this._things.clear(true, true);

                        // Seed
                        worldSeed = data.seed;
                        noise.seed(worldSeed);

                        // Chunks
                        for (const [key, meta] of Object.entries(data.chunks)) {
                            const chunk = new Chunk(this, meta.x, meta.y, {
                                tiles: meta.tiles,
                                things: meta.things,
                                lootableThings: meta.lootableThings
                            });
                            chunk.isGenerated = !chunk.meta.tiles.every(t => !t);
                            this.chunks[key] = chunk;
                        }

                        // Player
                        this.player.teleport(data.player.x, data.player.y);
                        this.player.hp = data.player.hp;
                        this.player.mhp = data.player.mhp;
                        this.player.kc = data.player.kc;
                        this.player.saturation = data.player.saturation;
                        this.player.inventory = data.player.inventory;
                        this.player.loadEquipment(data.player.equipment);
                        this.ensureSpoilMinutes(this.player.inventory);
                        this.ensureSpoilMinutes([
                            this.player.equipment.head,
                            this.player.equipment.torso,
                            this.player.equipment.legs,
                            this.player.equipment.feet,
                            ...this.player.equipment.waist
                        ]);

                        // Clock
                        this.gameDay = data.clock?.day ?? 1;
                        this.gameMinutes = data.clock?.minutes ?? 8 * 60;
                        this.updateClockText();
                        this.markLightDirty();
                        this.updateLightVeil();

                        // Refresh UI
                        this.hotbar.dirty = true;
                        if (this.campfirePanel?.visible) this.campfirePanel.close();
                        if (this.equipmentPanel?.visible) {
                            this.equipmentPanel.refresh();
                            this.equipmentPanel.layout();
                        }

                        resolve(data);
                    } catch (err) {
                        console.error("Failed to parse save file:", err);
                        reject(err);
                    } finally {
                        this.isPaused = false;
                    }
                };
                reader.readAsText(file);
            };
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

        // Process input
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

        // Update player
        this.player.update();
        if (
            this.player.hp !== this._lastHp ||
            this.player.mhp !== this._lastMhp ||
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