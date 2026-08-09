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

        // Hunger: 2000 kcal per game day while standing still (ticked once per game minute)
        this.kc = 1200;
        this.stomach = 1600;
        this.hunger = 2000;
        this.saturation = 0;

        // Inventory / hotbar
        this.inventory = [];
        this.baseInventorySize = 5;
        this.inventorySize = 5;
        this.baseStrength = 15;
        this.strength = 15;
        this.equipSpeedMultiplier = 1;
        this.equipment = {
            head: null,
            torso: null,
            legs: null,
            feet: null,
            waist: []
        };

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
            Q: Phaser.Input.Keyboard.KeyCodes.Q,
            Z: Phaser.Input.Keyboard.KeyCodes.Z,
            SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE,
            SHIFT: Phaser.Input.Keyboard.KeyCodes.SHIFT,
            CTRL: Phaser.Input.Keyboard.KeyCodes.CTRL
        });
        /** Hold Z pickup radius in tiles (standing on / very near the drop). */
        this.pickupRange = 0.55;

        // Animations
        this.createAnimations();
        this.facing = "down";
        this.play("idle-down");

        // Melee attack
        this.attackTimer = 0;
        this.attackMax = 0;
        this.attackWeapon = null;
        this.attackAngle = 0;
        this.attackHitSet = null;
        this.weaponSprite = null;
        this.tooltipBlockUntil = 0;
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
            equipment: this.equipment,
        }
    }

    getWaistGrant(itemId) {
        if (!itemId) return 0;
        const meta = this.scene.getItem(itemId);
        const add = meta?.equip?.effects?.addSlot;
        if (!add) return 0;
        let n = 0;
        for (const s of add) if (s === 'waist') n++;
        return n;
    }

    getWaistCapacity() {
        let n = 0;
        for (const key of ['head', 'torso', 'legs', 'feet']) {
            const stack = this.equipment[key];
            if (stack) n += this.getWaistGrant(stack.id);
        }
        return n;
    }

    countWaistOccupied() {
        let n = 0;
        for (const stack of this.equipment.waist) if (stack) n++;
        return n;
    }

    syncWaistSlots() {
        const cap = this.getWaistCapacity();
        while (this.equipment.waist.length < cap) this.equipment.waist.push(null);
        if (this.equipment.waist.length > cap) {
            this.equipment.waist.length = cap;
        }
    }

    getHotbarBonus() {
        let n = 0;
        const pieces = [
            this.equipment.head,
            this.equipment.torso,
            this.equipment.legs,
            this.equipment.feet,
            ...this.equipment.waist
        ];
        for (const stack of pieces) {
            if (!stack) continue;
            const add = this.scene.getItem(stack.id)?.equip?.effects?.addSlot;
            if (!add) continue;
            for (const s of add) if (s === 'hotbar') n++;
        }
        return n;
    }

    recomputeEquipmentEffects() {
        let str = this.baseStrength;
        let speedMul = 1;
        const pieces = [
            this.equipment.head,
            this.equipment.torso,
            this.equipment.legs,
            this.equipment.feet,
            ...this.equipment.waist
        ];
        for (const stack of pieces) {
            if (!stack) continue;
            const meta = this.scene.getItem(stack.id);
            const effects = meta?.equip?.effects;
            str += Number(effects?.strength || 0);
            speedMul += Number(effects?.speed || 0);
        }
        this.strength = str;
        this.equipSpeedMultiplier = speedMul;
        this.syncInventorySize();
    }

    /** Resize hotbar inventory to base + equipment hotbar grants; overflow drops at feet. */
    syncInventorySize() {
        const size = Math.max(1, this.baseInventorySize + this.getHotbarBonus());
        this.inventorySize = size;

        while (this.inventory.length < size) this.inventory.push(null);

        if (this.inventory.length > size) {
            for (let i = size; i < this.inventory.length; i++) {
                const stack = this.inventory[i];
                if (!stack) continue;
                const meta = this.scene.getItem(stack.id);
                if (!meta) continue;
                const extras = mealStackExtras(stack);
                DroppedItem.spawn(
                    this.scene, this.x, this.y,
                    meta, stack.quantity, stack.spoilMinutes, extras
                );
            }
            this.inventory.length = size;
        }

        if (this.scene.hotbar) {
            this.scene.hotbar.setSize(size);
            this.scene.hotbar.dirty = true;
        }
    }

    /** @param {string} slotKey e.g. 'head' or 'waist:0' */
    getEquipmentStack(slotKey) {
        if (slotKey.startsWith('waist:')) {
            const i = parseInt(slotKey.slice(6), 10);
            return this.equipment.waist[i] || null;
        }
        return this.equipment[slotKey] || null;
    }

    setEquipmentStack(slotKey, stack) {
        if (slotKey.startsWith('waist:')) {
            const i = parseInt(slotKey.slice(6), 10);
            while (this.equipment.waist.length <= i) this.equipment.waist.push(null);
            this.equipment.waist[i] = stack;
        } else {
            this.equipment[slotKey] = stack;
        }
    }

    /** Target equip slot name for an item ('head'|'torso'|...|'waist') */
    getEquipSlotName(itemMeta) {
        return itemMeta?.equip?.slot || null;
    }

    canChangeBodySlot(slotName, incomingMeta) {
        // Waist slots don't grant further waists in current data
        if (slotName === 'waist' || String(slotName).startsWith('waist:')) return true;

        const current = this.equipment[slotName];
        const oldGrant = current ? this.getWaistGrant(current.id) : 0;
        const newGrant = incomingMeta ? this.getWaistGrant(incomingMeta.id) : 0;
        const newCap = this.getWaistCapacity() - oldGrant + newGrant;
        return this.countWaistOccupied() <= newCap;
    }

    /**
     * Equip from hotbar into the natural slot for that item (hotswaps if occupied).
     */
    equipFromHotbarAuto(hotbarIndex) {
        const stack = this.inventory[hotbarIndex];
        if (!stack) return { ok: false, reason: 'empty' };

        const meta = this.scene.getItem(stack.id);
        const want = this.getEquipSlotName(meta);
        if (!want) return { ok: false, reason: 'not_equip' };

        let slotKey;
        if (want === 'waist') {
            const cap = this.getWaistCapacity();
            if (cap <= 0) return { ok: false, reason: 'no_waist' };
            let empty = -1;
            for (let i = 0; i < cap; i++) {
                if (!this.equipment.waist[i]) {
                    empty = i;
                    break;
                }
            }
            slotKey = `waist:${empty !== -1 ? empty : 0}`;
        } else {
            slotKey = want;
        }

        return this.equipFromHotbar(hotbarIndex, slotKey);
    }

    /**
     * Unequip into the first empty hotbar slot.
     */
    unequipToFirstHotbarSlot(slotKey) {
        const inv = this.inventory;
        let idx = inv.findIndex(s => !s);
        if (idx === -1) {
            if (inv.length < this.inventorySize) idx = inv.length;
            else return { ok: false, reason: 'no_space' };
        }
        return this.unequipToHotbar(slotKey, idx);
    }

    /**
     * Equip one item from hotbar index into equip slot key.
     * @returns {{ok:boolean, reason?:string}}
     */
    equipFromHotbar(hotbarIndex, slotKey) {
        const inv = this.inventory;
        const stack = inv[hotbarIndex];
        if (!stack) return { ok: false, reason: 'empty' };

        const meta = this.scene.getItem(stack.id);
        const wantSlot = this.getEquipSlotName(meta);
        if (!wantSlot) return { ok: false, reason: 'not_equip' };

        const isWaist = slotKey.startsWith('waist:');
        const bodySlot = isWaist ? 'waist' : slotKey;
        if (wantSlot !== bodySlot) return { ok: false, reason: 'wrong_slot' };

        if (isWaist) {
            const idx = parseInt(slotKey.slice(6), 10);
            if (idx < 0 || idx >= this.getWaistCapacity()) return { ok: false, reason: 'no_waist' };
        } else if (!this.canChangeBodySlot(slotKey, meta)) {
            return { ok: false, reason: 'waist_blocked' };
        }

        const existing = this.getEquipmentStack(slotKey);

        // Equipables are typically maxStack 1; move whole stack / swap with existing
        if (stack.quantity !== 1 && existing) {
            return { ok: false, reason: 'complex_stack' };
        }

        if (stack.quantity > 1) {
            stack.quantity -= 1;
            this.setEquipmentStack(slotKey, makeItemStack(meta, 1, stack.spoilMinutes));
            if (existing) {
                // Try to return existing to an empty inventory slot
                const empty = inv.findIndex(s => !s);
                if (empty !== -1) inv[empty] = existing;
                else if (inv.length < this.inventorySize) inv.push(existing);
                else {
                    stack.quantity += 1;
                    this.setEquipmentStack(slotKey, existing);
                    return { ok: false, reason: 'no_space' };
                }
            }
        } else {
            inv[hotbarIndex] = existing;
            this.setEquipmentStack(slotKey, makeItemStack(meta, 1, stack.spoilMinutes));
        }

        this.syncWaistSlots();
        this.recomputeEquipmentEffects();
        this.scene.hotbar.dirty = true;
        return { ok: true };
    }

    /**
     * Move equipped item to a hotbar index (swap if occupied with compatible gear).
     */
    unequipToHotbar(slotKey, hotbarIndex) {
        const equipped = this.getEquipmentStack(slotKey);
        if (!equipped) return { ok: false, reason: 'empty' };

        const isWaist = slotKey.startsWith('waist:');
        if (!isWaist && !this.canChangeBodySlot(slotKey, null)) {
            return { ok: false, reason: 'waist_blocked' };
        }

        const inv = this.inventory;
        while (inv.length <= hotbarIndex) inv.push(null);
        const dest = inv[hotbarIndex];

        if (!dest) {
            inv[hotbarIndex] = equipped;
            this.setEquipmentStack(slotKey, null);
        } else if (dest.id === equipped.id) {
            const meta = this.scene.getItem(dest.id);
            const maxStack = Math.max(1, meta?.maxStack || 1);
            if (dest.quantity + equipped.quantity > maxStack) return { ok: false, reason: 'full' };
            dest.spoilMinutes = mergeSpoilMinutes(
                dest.quantity, dest.spoilMinutes,
                equipped.quantity, equipped.spoilMinutes
            );
            dest.quantity += equipped.quantity;
            this.setEquipmentStack(slotKey, null);
        } else {
            const destMeta = this.scene.getItem(dest.id);
            const want = this.getEquipSlotName(destMeta);
            const bodySlot = isWaist ? 'waist' : slotKey;
            if (!want || want !== bodySlot) return { ok: false, reason: 'wrong_slot' };
            if (!isWaist && !this.canChangeBodySlot(slotKey, destMeta)) {
                return { ok: false, reason: 'waist_blocked' };
            }
            inv[hotbarIndex] = equipped;
            this.setEquipmentStack(slotKey, makeItemStack(destMeta, 1, dest.spoilMinutes));
            if (dest.quantity > 1) {
                dest.quantity -= 1;
                const empty = inv.findIndex(s => !s);
                if (empty !== -1) inv[empty] = dest;
                else if (inv.length < this.inventorySize) inv.push(dest);
                else {
                    // rollback
                    inv[hotbarIndex] = dest;
                    this.setEquipmentStack(slotKey, equipped);
                    return { ok: false, reason: 'no_space' };
                }
            }
        }

        this.syncWaistSlots();
        this.recomputeEquipmentEffects();
        this.scene.hotbar.dirty = true;
        return { ok: true };
    }

    loadEquipment(data) {
        this.equipment = {
            head: data?.head ?? null,
            torso: data?.torso ?? null,
            legs: data?.legs ?? null,
            feet: data?.feet ?? null,
            waist: Array.isArray(data?.waist) ? data.waist.slice() : []
        };
        this.syncWaistSlots();
        this.recomputeEquipmentEffects();
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

    /**
     * @param {Number} amount
     * @param {Object} [source]
     * @param {{ type?: string }} [opts]
     */
    takeDamage(amount, source = null, opts = null) {
        const dmg = Number(amount) || 0;
        if (!(dmg > 0)) return 0;
        const before = this.hp;
        this.damage(dmg);
        return before - this.hp;
    }

    heal(amount) {
        this.damage(-amount);
    }

    isAttacking() {
        return this.attackTimer > 0;
    }

    /** Hide tooltips during an attack and briefly after it ends. */
    blocksTooltips() {
        return this.isAttacking() || (this.scene.time?.now ?? 0) < this.tooltipBlockUntil;
    }

    /** Player body center in world space (origin is bottom-left). */
    bodyCenter() {
        return {
            x: this.x + this.width * 0.5,
            y: this.y - this.height * 0.5
        };
    }

    /**
     * Solid body bounds for melee (origin bottom-left).
     * Insets empty frame edges so the box matches the drawn character.
     */
    hurtbox(pad = 0) {
        const insetX = Math.max(2, Math.floor(this.width * 0.2));
        const insetTop = Math.max(1, Math.floor(this.height * 0.12));
        const insetBottom = Math.max(1, Math.floor(this.height * 0.06));
        return {
            left: this.x + insetX - pad,
            top: this.y - this.height + insetTop - pad,
            right: this.x + this.width - insetX + pad,
            bottom: this.y - insetBottom + pad
        };
    }

    facingFromAngle(angle) {
        const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (a >= Math.PI * 0.25 && a < Math.PI * 0.75) return "down";
        if (a >= Math.PI * 0.75 && a < Math.PI * 1.25) return "left";
        if (a >= Math.PI * 1.25 && a < Math.PI * 1.75) return "up";
        return "right";
    }

    startMeleeAttack(meta) {
        if (this.isAttacking()) return false;
        const w = meta?.weapon;
        if (!w || w.type !== "melee") return false;

        const pointer = this.scene.input.activePointer;
        const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const c = this.bodyCenter();
        let angle = Math.atan2(world.y - c.y, world.x - c.x);
        if (!Number.isFinite(angle)) angle = 0;

        this.attackWeapon = w;
        this.attackMax = Math.max(1, Math.floor(Number(w.useTime) || 20));
        this.attackTimer = this.attackMax;
        this.attackAngle = angle;
        this.attackHitSet = new Set();
        this.facing = this.facingFromAngle(angle);
        this.scene.hideTooltip?.();

        const key = meta.key || meta.id;
        if (!this.weaponSprite) {
            // Grip at bottom-left of diagonal art; tip at top-right
            this.weaponSprite = this.scene.add.image(c.x, c.y, key)
                .setOrigin(0.2, 0.8)
                .setVisible(false);
            this.scene.mainLayer.add(this.weaponSprite);
        } else if (this.scene.textures.exists(key)) {
            this.weaponSprite.setTexture(key);
        }
        this.weaponSprite
            .setOrigin(0.2, 0.8)
            .setVisible(true)
            .setDepth(this.y + 1);
        this._updateWeaponSprite(0);
        return true;
    }

    _attackProgress() {
        if (this.attackMax <= 0) return 1;
        return 1 - (this.attackTimer / this.attackMax);
    }

    /** Art tip points up-right (-45°) at rotation 0 → add +45° so tip follows aim. */
    _spearRotation(aimAngle) {
        return aimAngle + Math.PI / 4;
    }

    /**
     * Jab: 0→1 extends out, 1→0 pulls back to the player.
     * @returns {Number} thrust 0..1
     */
    _spearThrust(progress) {
        // ~40% of the anim extend, ~60% retract (snappy jab)
        const peak = 0.4;
        if (progress <= peak) {
            const t = progress / peak;
            // ease-out
            return 1 - (1 - t) * (1 - t);
        }
        const t = (progress - peak) / (1 - peak);
        // ease-in back to body
        return (1 - t) * (1 - t);
    }

    _updateWeaponSprite(progress) {
        if (!this.weaponSprite || !this.attackWeapon) return;
        const range = Number(this.attackWeapon.range) || 12;
        const thrust = this._spearThrust(progress);
        // Anchor the mid-shaft at hold + range * thrust (between grip-forward and tip-forward).
        const hold = 6;
        const anchorDist = hold + range * thrust;
        const c = this.bodyCenter();
        const ang = this.attackAngle;
        const rot = this._spearRotation(ang);
        this.weaponSprite.setRotation(rot);

        const ax = c.x + Math.cos(ang) * anchorDist;
        const ay = c.y + Math.sin(ang) * anchorDist;
        const fw = this.weaponSprite.frame?.width || this.weaponSprite.width || 16;
        const fh = this.weaponSprite.frame?.height || this.weaponSprite.height || 16;
        // Midpoint along the diagonal shaft (butt → tip)
        const mid = this._weaponFrameLocalOffset((fw - 1) * 0.5, (fh - 1) * 0.5);
        this.weaponSprite.setPosition(ax - mid.x, ay - mid.y);
        this.weaponSprite.setDepth(this.y + 1);
    }

    /** World-space offset from sprite origin to a frame-space pixel (uses current rotation). */
    _weaponFrameLocalOffset(frameX, frameY) {
        const spr = this.weaponSprite;
        const w = spr.frame?.width || spr.width || 16;
        const h = spr.frame?.height || spr.height || 16;
        const localX = frameX - spr.originX * w;
        const localY = frameY - spr.originY * h;
        const cos = Math.cos(spr.rotation);
        const sin = Math.sin(spr.rotation);
        return {
            x: localX * cos - localY * sin,
            y: localX * sin + localY * cos
        };
    }

    /**
     * Transform a frame-space pixel on the weapon sprite into world coords.
     */
    _weaponFrameToWorld(frameX, frameY) {
        const spr = this.weaponSprite;
        if (!spr || !spr.visible) return null;
        const w = spr.frame?.width || spr.width || 16;
        const h = spr.frame?.height || spr.height || 16;
        const localX = frameX - spr.originX * w;
        const localY = frameY - spr.originY * h;
        const cos = Math.cos(spr.rotation);
        const sin = Math.sin(spr.rotation);
        return {
            x: spr.x + localX * cos - localY * sin,
            y: spr.y + localX * sin + localY * cos
        };
    }

    /**
     * Distal (tip) half of the spear in world space.
     * Art is a 16×16 diagonal: grip ~bottom-left, tip ~top-right.
     */
    _getSpearHitSegment() {
        const spr = this.weaponSprite;
        if (!spr || !spr.visible) return null;
        const w = spr.frame?.width || spr.width || 16;
        const h = spr.frame?.height || spr.height || 16;
        const tip = this._weaponFrameToWorld(w - 1, 0);
        const butt = this._weaponFrameToWorld(0, h - 1);
        if (!tip || !butt) return null;
        // Midpoint → tip = top / sharp half of the spear
        const mid = {
            x: butt.x + (tip.x - butt.x) * 0.5,
            y: butt.y + (tip.y - butt.y) * 0.5
        };
        return { a: mid, b: tip };
    }

    _meleeHitCheck(progress) {
        const w = this.attackWeapon;
        if (!w) return;
        const start = Number(w.hitStart ?? 0.25);
        const end = Number(w.hitEnd ?? 0.75);
        if (progress < start || progress > end) return;

        const seg = this._getSpearHitSegment();
        if (!seg) return;
        const dmg = Number(w.damage) || 0;
        if (!(dmg > 0)) return;

        // Thickness of the spear hit capsule (half-width in px)
        const radius = 3;

        const group = this.scene.damageables;
        if (!group) return;
        for (const target of group.getChildren()) {
            if (!target || !target.active || target === this) continue;
            if (this.attackHitSet.has(target)) continue;
            if (typeof target.takeDamage !== "function") continue;

            if (!this._meleeSegmentHitsTarget(seg.a, seg.b, radius, target)) continue;

            this.attackHitSet.add(target);
            target.takeDamage(dmg, this, { type: "melee" });
        }
    }

    /** Thick spear segment vs target hurtbox / body. */
    _meleeSegmentHitsTarget(a, b, radius, target) {
        if (typeof target.hurtbox === "function") {
            return this._segmentHitsRect(a.x, a.y, b.x, b.y, target.hurtbox(0), radius);
        }

        let tx, ty, rad;
        if (typeof target.bodyCenter === "function") {
            const bc = target.bodyCenter();
            tx = bc.x; ty = bc.y;
            rad = Math.max(target.width, target.height) * 0.5;
        } else if (target.body) {
            tx = target.body.center.x;
            ty = target.body.center.y;
            rad = Math.max(target.body.width, target.body.height) * 0.55;
        } else {
            tx = target.x;
            ty = target.y;
            rad = 10;
        }
        const dist = this._distPointToSegment(tx, ty, a.x, a.y, b.x, b.y);
        return dist <= rad + radius;
    }

    /** Capsule (segment + radius) vs AABB — expand the box, then test the segment. */
    _segmentHitsRect(ax, ay, bx, by, box, radius = 0) {
        const left = box.left - radius;
        const right = box.right + radius;
        const top = box.top - radius;
        const bottom = box.bottom + radius;

        if (ax >= left && ax <= right && ay >= top && ay <= bottom) return true;
        if (bx >= left && bx <= right && by >= top && by <= bottom) return true;

        const edges = [
            [left, top, right, top],
            [right, top, right, bottom],
            [right, bottom, left, bottom],
            [left, bottom, left, top]
        ];
        for (const [ex1, ey1, ex2, ey2] of edges) {
            if (this._segmentsIntersect(ax, ay, bx, by, ex1, ey1, ex2, ey2)) return true;
        }
        return false;
    }

    _closestPointOnSegment(px, py, ax, ay, bx, by) {
        const abx = bx - ax;
        const aby = by - ay;
        const len2 = abx * abx + aby * aby;
        if (len2 <= 1e-8) return { x: ax, y: ay };
        let t = ((px - ax) * abx + (py - ay) * aby) / len2;
        t = Phaser.Math.Clamp(t, 0, 1);
        return { x: ax + abx * t, y: ay + aby * t };
    }

    _distPointToSegment(px, py, ax, ay, bx, by) {
        const c = this._closestPointOnSegment(px, py, ax, ay, bx, by);
        return Math.hypot(px - c.x, py - c.y);
    }

    _segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
        const abx = bx - ax, aby = by - ay;
        const cdx = dx - cx, cdy = dy - cy;
        const den = abx * cdy - aby * cdx;
        if (Math.abs(den) < 1e-8) return false;
        const acx = cx - ax, acy = cy - ay;
        const t = (acx * cdy - acy * cdx) / den;
        const u = (acx * aby - acy * abx) / den;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }

    _endAttack() {
        this.attackTimer = 0;
        this.attackMax = 0;
        this.attackWeapon = null;
        this.attackHitSet = null;
        if (this.weaponSprite) this.weaponSprite.setVisible(false);
        this.tooltipBlockUntil = (this.scene.time?.now ?? 0) + 250;
    }

    /**
     * Eat up to stomach capacity.
     * @returns {number} kcal actually consumed (0 if none)
     */
    eat(food) {
        const kc = Number(food?.kc ?? 0);
        if (!(kc > 0)) return 0;
        if (this.kc >= this.stomach) return 0;
        const consumed = Math.min(kc, this.stomach - this.kc);
        this.kc += consumed;
        this.saturation += consumed * 0.1;
        return consumed;
    }

    starve(kc) {
        this.saturation -= kc;
        if (this.saturation < 0) {
            this.kc = Math.max(this.kc + this.saturation, 0);
            this.saturation = 0;
        }
    }

    hungerTick() {
        // 2000 kcal over 1440 game minutes (one day) while idle
        let tick = this.hunger / (24 * 60);
        if (this.isSprinting) tick *= 1.5;
        tick *= this.getEncumbrance().hungerRate;
        this.starve(tick);
        if (this.kc === 0) this.damage(0.25);
    }

    gainItem(item, amount = 1, spoilMinutes = undefined) {
        let remaining = amount;
        const weightLeft = Math.max(0, this.strength * 2 - this.getInventoryWeight());
        let allowedByWeight = Math.floor((weightLeft + Math.pow(10, -8)) / item.weight);
        const incomingSpoil = spoilMinutes !== undefined
            ? spoilMinutes
            : defaultSpoilMinutes(item);

        // Fill existing stacks first (never merge into meals / food-overridden stacks)
        for (const slot of this.inventory) {
            if (!slot || slot.id !== item.id || slot.quantity >= item.maxStack) continue;
            if (slot.customName || slot.food || slot.ingredients) continue;
            const space = item.maxStack - slot.quantity;
            const toAdd = Math.min(space, remaining, allowedByWeight);
            slot.spoilMinutes = mergeSpoilMinutes(
                slot.quantity, slot.spoilMinutes,
                toAdd, incomingSpoil
            );
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
            const stack = makeItemStack(item, toAdd, incomingSpoil);
            const nullIndex = this.inventory.findIndex(s => !s);
            if (nullIndex !== -1) {
                this.inventory[nullIndex] = stack;
                remaining -= toAdd;
                allowedByWeight -= toAdd;
                continue;
            }
            if (this.inventory.length >= this.inventorySize) break;
            this.inventory.push(stack);
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

    /** Hold Space to keep attacking with a weapon. */
    tryWeaponAutofire() {
        if (this.isAttacking()) return;
        const item = this.getHeldItem();
        if (!item) return;
        const meta = this.scene.getItem(item.id);
        if (meta?.weapon?.type === "melee") {
            this.startMeleeAttack(meta);
        }
        // ranged autofire when projectiles exist
    }

    /** Dynamic coconut meals can be partially eaten; normal food is all-or-nothing. */
    _isPartialFood(item) {
        return !!(item?.customName || item?.ingredients?.length);
    }

    useItem(item) {
        const meta = this.scene.getItem(item.id);
        // Stack-level food (dynamic meals) overrides item def
        const food = item.food || meta?.food;
        // 0 kcal foods still spoil but are not edible
        if (food && Number(food.kc ?? 0) > 0) {
            const total = Number(food.kc);
            const room = this.stomach - this.kc;
            if (room <= 0) return;
            // Stacked food: only eat a whole unit (no partial across a stack)
            if ((item.quantity || 1) > 1 && room < total) return;
            // Non-meals (apple, roast beef, …): must fit the whole item
            const isMeal = this._isPartialFood(item);
            if (!isMeal && room < total) return;

            const consumed = this.eat(food);
            if (!(consumed > 0)) return;

            if (!isMeal || consumed >= total) {
                this.loseItem(item);
            } else {
                // Leftover kcal stays on this meal only
                if (!item.food) item.food = { ...(meta?.food || {}) };
                if (item.food.kcFull == null) item.food.kcFull = Math.round(total);
                item.food.kc = Math.max(0, Math.round(total - consumed));
                if (item.food.kc <= 0) {
                    this.loseItem(item);
                }
            }
            this.scene.hotbar.dirty = true;
            return;
        }
        if (meta?.weapon?.type === "melee") {
            this.startMeleeAttack(meta);
            return;
        }
        if (meta?.weapon?.type === "ranged") {
            // Projectiles not implemented yet
            return;
        }
        if (meta.use === 'light_fire') {
            this.scene.tryUseFirestarter();
        }
    }

    getInventoryWeight() {
        let total = 0;
        for (const stack of this.inventory) {
            if (!stack) continue;
            const meta = this.scene.getItem(stack.id);
            const w = stack.weight != null ? stack.weight : meta.weight;
            total += w * stack.quantity;
        }
        const worn = [
            this.equipment.head,
            this.equipment.torso,
            this.equipment.legs,
            this.equipment.feet,
            ...this.equipment.waist
        ];
        for (const stack of worn) {
            if (!stack) continue;
            const meta = this.scene.getItem(stack.id);
            const w = stack.weight != null ? stack.weight : meta.weight;
            total += w * stack.quantity;
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
        const moving = x !== 0 || y !== 0;
        const attacking = this.isAttacking();
        this.isSprinting = !attacking
            && moving
            && this.keys.SHIFT.isDown
            && !encumbrance.cannotSprint
            && this.kc > 0;
        const speed = this.speed * this.scene.tileSize
            * (this.isSprinting ? this.sprintFactor : 1)
            * encumbrance.speedMultiplier
            * this.equipSpeedMultiplier;
        this.anims.timeScale = this.isSprinting ? 1.5 : 1.0;

        this.setVelocity(x * speed, y * speed);
        this.setDepth(this.y);

        // Animation (attack locks facing toward aim)
        if (attacking) {
            this.facing = this.facingFromAngle(this.attackAngle);
            this.play(moving ? `walk-${this.facing}` : `idle-${this.facing}`, true);
        } else if (moving) {
            if (Math.abs(x) > Math.abs(y)) {
                this.facing = x > 0 ? "right" : "left";
            } else {
                this.facing = y > 0 ? "down" : "up";
            }
            this.play(`walk-${this.facing}`, true);
        } else {
            this.play(`idle-${this.facing}`, true);
        }

        // Melee attack tick
        if (attacking) {
            const progress = this._attackProgress();
            this._updateWeaponSprite(progress);
            this._meleeHitCheck(progress);
            this.attackTimer -= 1;
            if (this.attackTimer <= 0) this._endAttack();
        }

        // Hold Z to pick up nearby ground items
        if (this.keys.Z.isDown) {
            this.tryPickupNearby();
        }

        // Drop item
        if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) {
            const heldItem = this.getHeldItem();
            if (heldItem) {
                let amount = 1;
                if (this.keys.SHIFT.isDown) amount = heldItem.quantity;
                else if (this.keys.CTRL.isDown) amount = 10;
                const spoilMinutes = heldItem.spoilMinutes;
                const extras = mealStackExtras(heldItem);
                const numDropped = this.loseItemAt(this.scene.hotbar.activeIndex, amount);
                DroppedItem.spawn(
                    this.scene, this.x, this.y,
                    this.scene.getItem(heldItem.id), numDropped, spoilMinutes, extras
                );
                this.scene.hotbar.dirty = true;
            }
        }

        // Use held item (tap); weapons also autofire while Space is held
        if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
            this.useHeldItem();
        } else if (this.keys.SPACE.isDown) {
            this.tryWeaponAutofire();
        }
    }

    /** Pick up dropped items within pickupRange (nearest first). */
    tryPickupNearby() {
        const group = this.scene.droppedItems;
        if (!group) return;
        const r = this.scene.tileSize * this.pickupRange;
        const r2 = r * r;
        const drops = group.getChildren()
            .filter(d => d?.active && typeof d.tryPickup === "function")
            .map(d => ({
                drop: d,
                d2: Phaser.Math.Distance.Squared(this.x, this.y, d.x, d.y)
            }))
            .filter(e => e.d2 <= r2)
            .sort((a, b) => a.d2 - b.d2);

        for (const { drop } of drops) {
            drop.tryPickup();
        }
    }

    createAnimations() {
        // Global manager so LivingMobs (and anything else) can reuse these keys
        const anims = this.scene.anims;
        if (anims.exists("walk-down")) return;
        anims.create({
            key: "walk-down",
            frames: anims.generateFrameNumbers("player", { start: 0, end: 2 }),
            frameRate: 5,
            repeat: -1,
            yoyo: true
        });
        anims.create({
            key: "walk-left",
            frames: anims.generateFrameNumbers("player", { start: 3, end: 5 }),
            frameRate: 5,
            repeat: -1,
            yoyo: true
        });
        anims.create({
            key: "walk-right",
            frames: anims.generateFrameNumbers("player", { start: 6, end: 8 }),
            frameRate: 5,
            repeat: -1,
            yoyo: true
        });
        anims.create({
            key: "walk-up",
            frames: anims.generateFrameNumbers("player", { start: 9, end: 11 }),
            frameRate: 5,
            repeat: -1,
            yoyo: true
        });
        anims.create({ key: "idle-down", frames: [ { key: "player", frame: 1 } ], frameRate: 10 });
        anims.create({ key: "idle-left", frames: [ { key: "player", frame: 4 } ], frameRate: 10 });
        anims.create({ key: "idle-right", frames: [ { key: "player", frame: 7 } ], frameRate: 10 });
        anims.create({ key: "idle-up", frames: [ { key: "player", frame: 10 } ], frameRate: 10 });
    }
}
