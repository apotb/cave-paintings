class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        super(scene, x, y, "player", 0);

        // Physics
        scene.mainLayer.add(this);
        scene.physics.add.existing(this);
        this.hitboxSize = 8;
        this.body.setSize(this.hitboxSize, this.hitboxSize)
            .setOffset((this.width - this.hitboxSize) / 2, this.hitboxSize);
        this.setOrigin(0, 1);

        // Health
        this.hp = 100;
        this.mhp = 100;

        // Hunger
        this.kc = 1200;
        this.stomach = 1600;
        this.hunger = 2000;
        this.saturation = 0;
        this.scene.time.addEvent({
            delay: 1000 * 60 * 24 / this.hunger,
            callback: this.hungerTick,
            callbackScope: this,
            loop: true 
        });

        // Inventory
        this.inventory = [];
        this.inventorySize = 5;
        this.strength = 15;

        // Movement
        this.speed = 3.5;
        this.sprintFactor = 1.5;
        this.interactionRange = 4.0;

        // Input
        this.cursors = scene.input.keyboard.createCursorKeys();
        this.keys = scene.input.keyboard.addKeys({
            W: Phaser.Input.Keyboard.KeyCodes.W,
            A: Phaser.Input.Keyboard.KeyCodes.A,
            S: Phaser.Input.Keyboard.KeyCodes.S,
            D: Phaser.Input.Keyboard.KeyCodes.D,
            T: Phaser.Input.Keyboard.KeyCodes.T,
            SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE,
            SHIFT: Phaser.Input.Keyboard.KeyCodes.SHIFT,
            CTRL: Phaser.Input.Keyboard.KeyCodes.CTRL
        });

        // Animations
        this.createAnimations();
        this.facing = "down";
        this.play("idle-down");
    }

    toJSON() {
        return {
            x: this.x,
            y: this.y,
            hp: this.hp,
            mhp: this.mhp,
            kc: this.kc,
            saturation: this.saturation,
            inventory: this.inventory,
        }
    }

    posX() {
        return this.x / this.scene.tileSize;
    }

    posY() {
        return this.y / this.scene.tileSize;
    }

    teleport(x, y) {
        this.setPosition(x, y);
    }

    damage(amount) {
        this.hp = Phaser.Math.Clamp(this.hp - amount, 0, this.mhp);
    }

    heal(amount) {
        this.damage(-amount);
    }

    eat(food) {
        if (this.kc === this.stomach) return false;
        this.kc = Math.min(this.kc + food.kc, this.stomach);
        this.saturation += food.kc * 0.1;
        return true;
    }

    starve(kc) {
        this.saturation -= kc;
        if (this.saturation < 0) {
            this.kc = Math.max(this.kc + this.saturation, 0);
            this.saturation = 0;
        }
    }

    hungerTick() {
        let tick = 1;
        if (this.isSprinting) tick += 0.5;
        tick *= this.getEncumbrance().hungerRate;
        this.starve(tick);
        if (this.kc === 0) this.damage(0.25);
    }

    gainItem(item, amount=1) {
        let remaining = amount;
        const weightLeft = Math.max(0, this.strength * 2 - this.getInventoryWeight());
        let allowedByWeight = Math.floor((weightLeft + Math.pow(10, -8)) / item.weight);

        // Fill existing stacks first
        for (const slot of this.inventory) {
            if (!slot || slot.id !== item.id || slot.quantity >= item.maxStack) continue;
            const space = item.maxStack - slot.quantity;
            const toAdd = Math.min(space, remaining, allowedByWeight);
            slot.quantity += toAdd;
            remaining -= toAdd;
            allowedByWeight -= toAdd;
            if (remaining === 0 || allowedByWeight === 0) {
                this.scene.hotbar.dirty = true;
                return remaining;
            }
        }

        // Create new stacks as needed
        while (remaining > 0 && allowedByWeight > 0) {
            const toAdd = Math.min(item.maxStack, remaining, allowedByWeight);
            const nullIndex = this.inventory.findIndex(s => !s);
            if (nullIndex !== -1) {
                this.inventory[nullIndex] = { id: item.id, quantity: toAdd };
                remaining -= toAdd;
                allowedByWeight -= toAdd;
                continue;
            }
            if (this.inventory.length >= this.inventorySize) break;
            this.inventory.push({ id: item.id, quantity: toAdd });
            remaining -= toAdd;
            allowedByWeight -= toAdd;
        }
        if (remaining !== amount) this.scene.hotbar.dirty = true;
        return remaining;
    }

    loseItem(item, amount=1) {
        const numLost = Math.min(item.quantity, amount);
        item.quantity -= numLost;
        if (item.quantity <= 0) this.inventory[this.inventory.indexOf(item)] = null;
        if (numLost > 0) this.scene.hotbar.dirty = true;
        return numLost;
    }

    loseItemAt(index, amount=1) {
        const stack = this.inventory[index];
        if (!stack) return 0;
        return this.loseItem(stack, amount);
    }

    loseAnyItem(id, amount=1) {
        let remaining = amount;
        let numLost = 0;
        for (let i = 0; i < this.inventory.length && remaining > 0; i++) {
            const s = this.inventory[i];
            if (!s || s.id !== id) continue;
            const take = Math.min(s.quantity, remaining);
            s.quantity -= take;
            remaining -= take;
            numLost += take;
            if (s.quantity <= 0) this.inventory[i] = null;
        }
        if (numLost > 0) this.scene.hotbar.dirty = true;
        return numLost;
    }

    getNumItems(id) {
        let sum = 0;
        for (const stack of this.inventory) {
            if (stack && stack.id === id) sum += stack.quantity;
        }
        return sum;
    }

    getHeldItem() {
        return this.inventory[this.scene.hotbar.activeIndex] || null;
    }

    useHeldItem() {
        const item = this.getHeldItem();
        if (item) this.useItem(item);
    }

    useItem(item) {
        const meta = this.scene.getItem(item.id);
        if (meta.food) {
            const canEat = this.eat(meta.food);
            if (canEat) this.loseItem(item);
        }
    }

    getInventoryWeight() {
        let total = 0;
        for (const stack of this.inventory) {
            if (!stack) continue;
            const meta = this.scene.getItem(stack.id);
            total += meta.weight * stack.quantity;
        }
        return Math.round(total * 100) / 100;
    }

    getEncumbrance() {
        const w = this.getInventoryWeight();
        const m = Math.min(Math.max(w - this.strength, 0), this.strength) / this.strength;
        return {
            speedMultiplier: 1.0 - 0.6 * m,
            hungerRate: 1.0 + 0.5 * m,
            cannotSprint: m > 0
        }
    }

    update() {
        // Movement
        const left  = this.cursors.left.isDown  || this.keys.A.isDown;
        const right = this.cursors.right.isDown || this.keys.D.isDown;
        const up    = this.cursors.up.isDown    || this.keys.W.isDown;
        const down  = this.cursors.down.isDown  || this.keys.S.isDown;

        let x = (right ? 1 : 0) - (left ? 1 : 0);
        let y = (down ? 1 : 0) - (up ? 1 : 0);
        if (x !== 0 || y !== 0) {
            const len = Math.hypot(x, y);
            x /= len; y /= len;
        }

        const encumbrance = this.getEncumbrance();
        this.isSprinting = this.keys.SHIFT.isDown && !encumbrance.cannotSprint && this.kc > 0;
        const speed = this.speed * this.scene.tileSize * (this.isSprinting ? this.sprintFactor : 1) * encumbrance.speedMultiplier;
        this.anims.timeScale = this.isSprinting ? 1.5 : 1.0;

        this.setVelocity(x * speed, y * speed);
        this.setDepth(this.y);

        // Animation
        if (x !== 0 || y !== 0) {
            if (Math.abs(x) > Math.abs(y)) {
                this.facing = x > 0 ? "right" : "left";
            } else {
                this.facing = y > 0 ? "down" : "up";
            }
            this.play(`walk-${this.facing}`, true);
        } else {
            this.play(`idle-${this.facing}`, true);
        }

        // Drop item
        if (Phaser.Input.Keyboard.JustDown(this.keys.T)) {
            let heldItem = this.getHeldItem();
            if (!heldItem) return;
            let amount = 1;
            if (this.keys.SHIFT.isDown) amount = heldItem.quantity;
            else if (this.keys.CTRL.isDown) amount = 10;
            const numDropped = this.loseItemAt(this.scene.hotbar.activeIndex, amount);
            new DroppedItem(this.scene, this.x, this.y, this.scene.getItem(heldItem.id), numDropped);
            this.scene.hotbar.dirty = true;
        }

        // Use held item
        if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.useHeldItem();
    }

    createAnimations() {
        if (this.anims.exists("walk-down")) return;
        this.anims.create({
            key: "walk-down",
            frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }),
            frameRate: 5,
            repeat: -1,
            yoyo: true
        });
        this.anims.create({
            key: "walk-left",
            frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }),
            frameRate: 5,
            repeat: -1,
            yoyo: true
        });
        this.anims.create({
            key: "walk-right",
            frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }),
            frameRate: 5,
            repeat: -1,
            yoyo: true
        });
        this.anims.create({
            key: "walk-up",
            frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }),
            frameRate: 5,
            repeat: -1,
            yoyo: true
        });
        this.anims.create({ key: "idle-down", frames: [ { key: "player", frame: 1 } ], frameRate: 10 });
        this.anims.create({ key: "idle-left", frames: [ { key: "player", frame: 4 } ], frameRate: 10 });
        this.anims.create({ key: "idle-right", frames: [ { key: "player", frame: 7 } ], frameRate: 10 });
        this.anims.create({ key: "idle-up", frames: [ { key: "player", frame: 10 } ], frameRate: 10 });
    }
}
