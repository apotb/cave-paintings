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
        this.renderDistance = 4;
        this.cullDistance = this.renderDistance + 2;
        this.chunks = {};

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

        // Player
        this.player = new Player(this, 0, 0);
        this.cameras.main.startFollow(this.player);
        this.cameras.main.setZoom(this.worldZoom);

        // Collisions
        this._things = this.physics.add.staticGroup();
        this.physics.add.collider(this.player, this._things);

        // UI
        this.cameras.main.ignore(this.uiLayer);
        this._uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height).setScroll(0, 0).setZoom(1);
        let cameras = [this.groundLayer, this.mainLayer];
        if (this.physics.world.debug) cameras.push(this.physics.world.debugGraphic);
        this._uiCam.ignore(cameras);
        this.createBars();
        // this.createStatus();
        this.hotbar = new Hotbar(this);
        this.createTooltip();
        this.createCraftMenu();
        this.createButtons();

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
    }

    createBars() {
        this.barsConfig = {
            x: 24,
            y: 8,
            w: 300,
            h: 16,
            gap: 6
        };

        this.barIcons = this.add.image(4, 8, "bar_icons").setOrigin(0, 0);
        this.uiLayer.add(this.barIcons);

        this.hpBar = this.add.graphics();
        this.hpBar.on("pointerover", p =>
            this.showTooltip(() => `HP: ${Math.ceil(this.player.hp)}/${this.player.mhp}`, p.x, p.y)
        ).on("pointerout", () => this.hideTooltip());
        this.uiLayer.add(this.hpBar);

        this.kcBar = this.add.graphics();
        this.kcBar.on("pointerover", p =>
            this.showTooltip(() => `Hunger: ${Math.ceil(this.player.kc)}/${this.player.stomach} kc`, p.x, p.y)
        ).on("pointerout", () => this.hideTooltip());
        this.uiLayer.add(this.kcBar);

        this.weightBar = this.add.graphics();
        this.weightBar.on("pointerover", p =>
            this.showTooltip(() => {
                const weight = this.player.getInventoryWeight()
                const strength = this.player.strength;
                return `Carry: ${weight}/${strength} kg${weight > strength ? ' (encumbered)' : ''}`;
            }, p.x, p.y)
        ).on("pointerout", () => this.hideTooltip());
        this.uiLayer.add(this.weightBar);

        this._lastHp = NaN;
        this._lastMhp = NaN;
        this._lastKc = NaN;
        this._lastStomach = NaN;
        this._lastWeight = NaN;
        this._lastStrength = NaN;

        this.drawBars();

        this.scale.on("resize", () => this.drawBars());
    }

    drawBars() {
        const { x, y, w, h, gap } = this.barsConfig;

        const hp = Math.ceil(this.player.hp);
        const mhp = this.player.mhp;
        const kc = Math.ceil(this.player.kc);
        const stomach = this.player.stomach;
        const weight = this.player.getInventoryWeight();
        const strength = this.player.strength;

        const hpFrac = hp / mhp;
        const kcFrac = kc / stomach;

        // HP
        this.hpBar.clear();
        this._drawBar(this.hpBar, x, y, w, h, hpFrac, 0x000000, 0x222222, 0xD24A43);

        // KC
        this.kcBar.clear();
        this._drawBar(this.kcBar, x, y + h + gap, w, h, kcFrac, 0x000000, 0x222222, 0xE0C14B);

        // Weight
        this.weightBar.clear();
        const wy = y + (h + gap) * 2;
        this.weightBar.fillStyle(0x000000, 0.6).fillRect(x - 1, wy - 1, w + 2, h + 2)
            .fillStyle(0x222222, 0.85).fillRect(x, wy, w, h);
        const limit1 = Math.max(1, this.player.strength);
        const limit2 = limit1 * 2;
        const clamped = Math.min(Math.max(0, weight), limit2);
        const width1 = Math.floor(w * Math.min(clamped, limit1) / limit1);
        if (width1 > 0) this.weightBar.fillStyle(0x2ECC71, 1).fillRect(x, wy, width1, h);
        const excess = Math.max(0, clamped - limit1);
        const width2 = Math.floor(w * excess / limit1);
        if (width2 > 0) this.weightBar.fillStyle(0xF39C12, 1).fillRect(x, wy, width2, h);

        this.hpBar.setInteractive(new Phaser.Geom.Rectangle(x,y,w,h),Phaser.Geom.Rectangle.Contains);
        this.kcBar.setInteractive(new Phaser.Geom.Rectangle(x,y+h+gap,w,h),Phaser.Geom.Rectangle.Contains);
        this.weightBar.setInteractive(new Phaser.Geom.Rectangle(x,wy,w,h),Phaser.Geom.Rectangle.Contains);

        this._lastHp = hp;
        this._lastMhp = mhp;
        this._lastKc = kc;
        this._lastStomach = stomach;
        this._lastWeight = weight;
        this._lastStrength = strength;
    }

    _drawBar(gfx, x, y, w, h, frac, borderColor, bgColor, fillColor) {
        // border
        gfx.fillStyle(borderColor, 0.6);
        gfx.fillRect(x - 1, y - 1, w + 2, h + 2);
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
        const padding = 6;

        this.tooltip = this.add.container(0, 0).setDepth(9999).setVisible(false);
        this.tooltipBg = this.add.graphics();
        this.tooltipText = this.add.text(0, 0, "", {
            fontFamily: "PrimaryFont",
            fontSize: "18px",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 2,
            padding: { left: padding, right: padding, top: padding, bottom: padding }
        });
        this.tooltip.add([this.tooltipBg, this.tooltipText]);
        this.uiLayer.add(this.tooltip);

        this._tooltipSource = null;

        const drawBg = () => {
            const w = this.tooltipText.width + padding * 2;
            const h = this.tooltipText.height + padding * 2;
            this.tooltipBg.clear()
                .fillStyle(0x111111, 0.95)
                .fillRoundedRect(-padding, -padding, w, h, 6)
                .lineStyle(1, 0x000000, 0.6)
                .strokeRoundedRect(-padding, -padding, w, h, 6);
        };

        this.showTooltip = (textOrFn, x, y) => {
            this._tooltipSource = (typeof textOrFn === "function") ? textOrFn : () => textOrFn;
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
            this.tooltip.setVisible(false);
        };

        this.positionTooltip = (x, y) => {
            const offset = 14;
            let nx = x + offset, ny = y + offset;
            const maxX = this.scale.width - (this.tooltipText.width + padding * 2);
            const maxY = this.scale.height - (this.tooltipText.height + padding * 2);
            nx = Phaser.Math.Clamp(nx, 0, Math.max(0, maxX));
            ny = Phaser.Math.Clamp(ny, 0, Math.max(0, maxY));
            this.tooltip.setPosition(nx, ny);
        };

        this.input.on("pointermove", (pointer) => {
            if (this.tooltip.visible) this.positionTooltip(pointer.x, pointer.y);
        });
        this.scale.on("resize", () => this.hideTooltip());
    }

    formatItemTooltip(item, quantity) {
        const lines = [];
        const name = quantity > 1 ? `${item.name} x${quantity}` : item.name;
        lines.push(name);

        // Weight
        const weight = item.weight;
        if (weight > 0) {
            lines.push(`Weight: ${weight} kg`);
        }

        // Food
        if (item.food) {
            const kc = Number(item.food.kc ?? 0);
            lines.push(`Food: ${kc} kcal`);

            const spoilTime = item.food.spoil ?? 0;
            if (spoilTime > 0) lines.push(`Spoils in: ${formatHours(spoilTime)} (${spoilTime}h)`);

            if (quantity > 1) {
                const totKc = kc * quantity;
                const totWeight = Math.round(weight * quantity * 100) / 100;
                lines.push(`Stack total: ${totWeight} kg, ${totKc} kcal`);
            }
        } else if (quantity > 1 && weight > 0) {
            const totWeight = Math.round(weight * quantity * 100) / 100;
            lines.push(`Stack total: ${totWeight} kg`);
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
                        lines.push(`+ ${s} slot${n > 1 ? ` x${n}` : ''}`);
                    }
                }
                
                // Strength
                const strength = item.equip.effects.strength;
                if (strength) {
                    lines.push(`+ ${strength} kg carry`)
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

        const pad = 4;
        const slotImg = this.textures.get('slot').getSourceImage();
        const slotW = slotImg ? slotImg.width : 32;
        const slotH = slotImg ? slotImg.height : 32;

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
            const slot = this.add.image(x, y, 'slot').setOrigin(0, 0).setInteractive({ cursor: 'pointer' });
            this.craftContainer.add(slot);

            // Icon
            const icon = this.add.image(x + slotW / 2, y + slotH / 2, recipe.key).setOrigin(0.5, 0.5).setScale(3.0);
            this.craftContainer.add(icon);

            // Quantity
            const quantity = this.add.text(x + slotW - 4, y + slotH - 4, recipe.quantity > 1 ? String(recipe.quantity) : '', {
                fontSize: '14px', fontFamily: 'monospace', stroke: '#000', strokeThickness: 2, align: 'right'
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

            slot.on('pointerover', (p) => this.showTooltip(tt, p.x, p.y));
            slot.on('pointerout',  ()  => this.hideTooltip());

            // Craft
            slot.on('pointerdown', ()  => {
                if (this.canCraft(recipe)) {
                    this.doCraft(recipe);
                    this.hotbar.dirty = true;
                    this.refreshTooltip();
                    this.refreshCraftMenu();
                } else {
                    this.tweens.add({ targets: slot, x: slot.x + 3, yoyo: true, duration: 40, repeat: 2 });
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

    canCraft(recipe) {
        return recipe.ingredients.every(ingredient => this.player.getNumItems(ingredient.id) >= ingredient.qty);
    }

    doCraft(recipe) {
        const item = this.getItem(recipe.id);
        for (const ing of recipe.ingredients) this.player.loseAnyItem(ing.id, ing.qty);
        const remaining = this.player.gainItem(item, recipe.quantity);
        if (remaining > 0) new DroppedItem(this, this.player.x, this.player.y, item, remaining);
    }

    createButtons() {
        this.craft = this.add.image(32, this.scale.height / 2, 'craft');
        this.craft.setInteractive({ cursor: 'pointer', pixelPerfect: true });
        this.craft.on('pointerdown', () => this.toggleCraftMenu());
        this.craft.on('pointerover', () => {
            if (!this.craftMenuVisible) this.craft.setTexture('craft_hover');
        });
        this.craft.on('pointerout', () => this.craft.setTexture(this.craftMenuVisible ? 'craft_open' : 'craft'));
        this.craft.setOrigin(0.5, 0.5).setScale(6);
        this.uiLayer.add(this.craft);

        this.save = this.add.image(this.scale.width - 80, 32, 'save');
        this.save.setInteractive({ useHandCursor: true, pixelPerfect: true });
        this.save.on('pointerdown', async () => {
            this.save.setTexture('save_open');
            await this.saveFile();
            this.save.setTexture('save');
        });
        this.save.on('pointerover', () => this.save.setTexture('save_hover'));
        this.save.on('pointerout', () => this.save.setTexture('save'));
        this.save.setOrigin(0.5, 0.5).setScale(3);
        this.uiLayer.add(this.save);

        this.load = this.add.image(this.scale.width - 32, 32, 'load');
        this.load.setInteractive({ useHandCursor: true, pixelPerfect: true });
        this.load.on('pointerdown', async () => {
            this.load.setTexture('load_open');
            await this.loadFile();
            this.load.setTexture('load');
        });
        this.load.on('pointerover', () => this.load.setTexture('load_hover'));
        this.load.on('pointerout', () => this.load.setTexture('load'));
        this.load.setOrigin(0.5, 0.5).setScale(3);
        this.uiLayer.add(this.load);
    }

    toggleCraftMenu() {
        this.craftMenuVisible = !this.craftMenuVisible;
        if (this.craftMenuVisible) {
            this.refreshCraftMenu();
            this.positionCraftMenu();
        }
        this.craftContainer.setVisible(this.craftMenuVisible);
        this.craft.setTexture(this.craftMenuVisible ? 'craft_open' : 'craft_hover');
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

    animateWater() {
        this._waterSprite.setFrame(this._waterFrame++);
        if (this._waterFrame > 3) this._waterFrame = 0;
    }

    async saveFile(filename=null) {
        filename = filename || `save-${Date.now()}.txt`;
        const data = LZString.compressToBase64(JSON.stringify({
            chunks: this.chunks,
            player: this.player,
            seed: worldSeed
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

                        // Refresh UI
                        this.hotbar.dirty = true;

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

        // Load/unload chunks around the player
        for (let x = snappedChunkX - this.cullDistance; x < snappedChunkX + this.cullDistance; x++) {
            for (let y = snappedChunkY - this.cullDistance; y < snappedChunkY + this.cullDistance; y++) {
                const chunk = this.getChunk(x, y);
                if (!chunk) continue;
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

        // Update player
        this.player.update();
        if (
            this.player.hp !== this._lastHp ||
            this.player.mhp !== this._lastMhp ||
            this.player.kc !== this._lastKc ||
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