class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, look = null) {
        const tex = typeof PlayerLook !== "undefined"
            ? PlayerLook.ensure(scene, look)
            : (scene.textures?.exists("human") ? "human" : "player");
        super(scene, x, y, tex, 1);
        this.look = typeof Look !== "undefined" ? Look.normalizeLook(look) : look;
        if (this.frame?.width !== 16) this.setFrame(1);

        // Physics — hitbox matches human mob def
        scene.mainLayer.add(this);
        scene.physics.add.existing(this);
        const human = scene.getMob?.("human");
        this.hitboxSize = Number(human?.hitboxSize) || 8;
        this.body.setSize(this.hitboxSize, this.hitboxSize)
            .setOffset((this.width - this.hitboxSize) / 2, this.hitboxSize);
        this.setOrigin(0, 1);

        // Body combat (RimWorld-style); flat hp kept only as unused legacy
        this.hp = 100;
        this.mhp = 100;
        this.anatomy = new Body(scene, "human", this);
        this.capacities = new Capacities(this.anatomy);
        this._bodyDead = false;
        this._hitKiller = null;
        this._hitKillerAt = 0;
        this._downed = false;
        this._tendChannel = null; // { remaining, max, slot }
        /** Knife skinning channel on a corpse (same bar as tend). */
        this._skinChannel = null;
        /** Scraper fleshing channel on a drying rack (same bar as tend/skin). */
        this._fleshChannel = null;
        /** Brain-tan channel on a drying rack (same bar as flesh). */
        this._brainChannel = null;
        /** Station craft channel (awl at a skinworking bench). */
        this._craftChannel = null;
        /** Eating channel (same bar as tend/skin). */
        this._eatChannel = null;
        this._chopBar = null;
        /** After Space uses food/tool, ignore autofire until Space is released. */
        this._blockSpaceAutofire = false;
        this._lastHotbarSlot = null;
        this.currentAttack = null;
        this.unarmedSprite = null;

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

        // Movement — base speed matches the human mob def
        this.speed = Number(human?.speed) || 3.5;
        this.sprintFactor = 1.5;
        this.interactionRange = 4.0;

        // Party identity (scene binds WASD once; companions share those keys)
        this.pawnId = null;
        this.ownerId = null;
        this.leaderId = null;
        this.role = "leader";
        this.pawnName = null;
        this.hotbarIndex = 0;
        this.partyAI = null;
        this._resting = false;
        this._restWalk = null;
        this.lastSleep = null;
        this._wokeFromRest = false;
        this.wandererAI = null;
        this.hostile = false;
        this.recruitLocked = false;
        this.refusedBy = null;
        this.heading = null;
        this._nameLabel = null;
        this._nameCrown = null;

        // Input — always the scene-level bindings (never per-companion)
        this.cursors = scene.cursors;
        this.keys = scene.keys;
        /** Hold F pickup radius in tiles (standing on / very near the drop). */
        this.pickupRange = 0.55;

        // Animations
        this.createAnimations();
        this.facing = "down";
        if (typeof PlayerLook !== "undefined") PlayerLook.play(this, this.facing, false);
        else this.play("idle-down");

        // Melee attack
        this.attackTimer = 0;
        this.attackMax = 0;
        this.attackWeapon = null;
        this.attackAngle = 0;
        this.attackHitSet = null;
        this.weaponSprite = null;
        this.tooltipBlockUntil = 0;

        // World FX parent: same x/y as this sprite every frame so roundPixels can't
        // desync overlays (chat / debug) from the player.
        this.fxRoot = null;
        this.chatBubble = null;
        this.chatBubbleUntil = 0;
        this.on("destroy", () => {
            this._nameLabel?.destroy();
            this._nameCrown?.destroy();
            this.chatBubble?.destroy();
            this.fxRoot?.destroy(true);
            this.fxRoot = null;
            this.chatBubble = null;
            this._nameLabel = null;
            this._nameCrown = null;
            this._recruitTip = null;
            this._ownChannelBar?.destroy();
            this._ownChannelBar = null;
            if (typeof clearSleepFx === "function") clearSleepFx(this);
            else if (typeof clearSleepZzz === "function") clearSleepZzz(this);
        });
    }

    /** Container locked to this.x/this.y (no rotation — world overlays stay axis-aligned). */
    ensureFxRoot() {
        if (this.fxRoot?.active) return this.fxRoot;
        this.fxRoot = this.scene.add.container(this.x, this.y);
        this.scene.mainLayer?.add(this.fxRoot);
        return this.fxRoot;
    }

    /** Call after movement each frame — copies exact sprite position. */
    syncFxRoot() {
        const root = this.fxRoot;
        if (root?.active) {
            root.setPosition(this.x, this.y);
            root.setRotation(0);
            root.setDepth((this.y | 0) + 40);
        }
        // Party nametags live above the night veil, so they are not children of
        // fxRoot and need their own world-space snap after the render pixel lock.
        this._syncNameHudPos();
    }

    syncSortDepth() {
        if (this._resting) {
            const lean = this.scene?.findLeanToByUid?.(this.lastSleep?.uid);
            this.setDepth(typeof sleepSortDepth === "function"
                ? sleepSortDepth(this, lean, this.lastSleep?.slot)
                : ((lean?.y || this.y) + 1));
            return;
        }
        this.setDepth(this.y | 0);
    }

    /** Show `msg` above the player for `durationMs` (matches public chat fade). */
    showChatBubble(msg, durationMs = 10000) {
        if (!msg) return;
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const zoom = scene.worldZoom || scene.cameras?.main?.zoom || 1;
        const fontPx = pixelUiFontSize(16, s);
        if (!this.chatBubble) {
            this.chatBubble = scene.add.text(0, 0, "", {
                fontFamily: PIXEL_UI_FONT,
                fontSize: `${fontPx}px`,
                color: "#ffffff",
                stroke: "#000000",
                strokeThickness: Math.max(2, Math.round(3 * s)),
                align: "center",
                wordWrap: { width: Math.round(140 * s), useAdvancedWrap: true }
            }).setOrigin(0.5, 1);
        }
        this._bindChatHud(this.chatBubble);
        this.chatBubble
            .setResolution(zoom * (window.devicePixelRatio || 1))
            .setFontSize(`${fontPx}px`)
            .setStroke("#000000", Math.max(2, Math.round(3 * s)))
            .setWordWrapWidth(Math.round(140 * s), true)
            .setScale(1 / zoom)
            .setText(String(msg))
            .setVisible(true)
            .setAlpha(1);
        this.chatBubbleUntil = (scene.time?.now || 0) + durationMs;
        this.syncFxRoot();
        this._syncChatBubble();
    }

    /** Re-apply GUI / world zoom to an existing chat bubble (scale changes mid-display). */
    applyChatBubbleScale() {
        const bubble = this.chatBubble;
        if (!bubble?.active) return;
        const scene = this.scene;
        const s = scene.uiScale || 1;
        const zoom = scene.worldZoom || scene.cameras?.main?.zoom || 1;
        const fontPx = pixelUiFontSize(16, s);
        bubble
            .setResolution(zoom * (window.devicePixelRatio || 1))
            .setFontSize(`${fontPx}px`)
            .setStroke("#000000", Math.max(2, Math.round(3 * s)))
            .setWordWrapWidth(Math.round(140 * s), true)
            .setScale(1 / zoom);
        this._syncChatBubble();
    }

    /** Re-apply GUI / world zoom to the nametag (scale changes without recreating). */
    applyNameLabelScale() {
        const label = this._nameLabel;
        if (!label?.active) return;
        const scene = this.scene;
        const zoom = scene.worldZoom || 3;
        const s = scene.uiScale || 1;
        const dpr = window.devicePixelRatio || 1;
        const key = `${s}:${zoom}:${dpr}`;
        if (this._nameLabelScaleKey === key) return;
        this._nameLabelScaleKey = key;
        const font = pixelUiFontSize(8, s);
        const stroke = Math.max(2, Math.round(3 * s));
        label
            .setFontSize(`${font}px`)
            .setStroke("#000000", stroke)
            .setResolution(zoom * dpr)
            .setScale(1 / zoom);
    }

    /**
     * Local offset only — parent fxRoot shares this.x/this.y with the sprite.
     */
    _syncChatBubble() {
        const bubble = this.chatBubble;
        if (!bubble?.active) return;
        const now = this.scene.time?.now || 0;
        if (now >= this.chatBubbleUntil) {
            bubble.setVisible(false);
            return;
        }

        this.ensureFxRoot();
        this.syncFxRoot();

        this._bindChatHud(bubble);

        const label = this._nameLabel;
        const zoom = this.scene.worldZoom || 3;
        const nameH = Math.ceil(
            (label?.height || 12) * (label?.scaleY || 1 / zoom)
        );
        const a = this._nameAnchorLocal();
        let lx = this.x + a.x;
        let ly = this.y + a.y;
        const crown = this._nameCrown;
        if (crown?.active && crown.visible) {
            const s = this.scene.uiScale || 1;
            const glyphH = Math.ceil(10 * s / zoom) + 1;
            ly = this.y + a.y - glyphH - Math.ceil(crown.displayHeight || 0) - 1;
        } else {
            ly -= nameH + 2;
        }

        const fadeMs = 2000;
        const remaining = this.chatBubbleUntil - now;
        const alpha = remaining < fadeMs
            ? Phaser.Math.Clamp(remaining / fadeMs, 0, 1)
            : 1;
        bubble.setPosition(lx, ly).setVisible(true).setAlpha(alpha);
    }

    toJSON() {
        // Prefer continuous physics pose over the render-only pixel snap
        return {
            x: this._physX ?? this.x,
            y: this._physY ?? this.y,
            body: this.anatomy?.toJSON?.(),
            kc: this.kc,
            saturation: this.saturation,
            inventory: this.inventory,
            equipment: this.equipment,
        };
    }

    displayName() {
        if (this.pawnName) return this.pawnName;
        if (this.role === "leader") return this.scene.playerName || "Player";
        if (this.role === "wanderer") return "Wanderer";
        return this.scene.playerName || "Someone";
    }

    isControlled() {
        return this.scene?.player === this;
    }

    playAnim(key) {
        if (!key) return;
        const walk = key.startsWith("walk-");
        const facing = key.replace(/^(walk|idle)-/, "") || this.facing || "down";
        if (typeof PlayerLook !== "undefined") PlayerLook.play(this, facing, walk);
    }

    /**
     * AI melee: aim at `target` instead of the mouse.
     */
    tryMeleeAttack(target, attack = null) {
        if (!target || this.isAttacking() || this._bodyDead) return false;
        if (this.isVomiting() || this.isIncapacitated()) return false;
        this.capacities = new Capacities(this.anatomy);
        if (!this.capacities.canManipulate()) return false;
        const c = this.bodyCenter();
        const tc = typeof target.bodyCenter === "function"
            ? target.bodyCenter()
            : { x: target.x, y: target.y };
        const angle = Math.atan2(tc.y - c.y, tc.x - c.x);
        const atk = attack || this._pickMeleeAttack(angle);
        if (!atk) return false;
        const meta = this.getHeldWeaponMeta();
        const scale = this.capacities.actionDurationScale();
        const durationMs = meleeAttackDurationMs(atk.cooldown || 2, scale);
        this.currentAttack = atk;
        const useWeaponArt = !!(meta?.key && meta?.weapon?.type === "melee" && !atk.unarmed);
        this.attackWeapon = useWeaponArt
            ? meta.weapon
            : { type: "melee", range: atk.range || 4, hitStart: 0.25, hitEnd: 0.75 };
        this.attackMax = durationMs;
        this.attackTimer = this.attackMax;
        this.attackAngle = Number.isFinite(angle) ? angle : 0;
        this.attackHitSet = new Set();
        this._attackWoreHeld = false;
        this._attackChoppedTree = false;
        this.facing = this.facingFromAngle(this.attackAngle);
        if (this.scene.isNet && this.scene.net?.connected) {
            this.scene._netSendMove?.(true);
            this._sendNetAttack(this.attackAngle);
        }
        if (useWeaponArt) {
            const key = meta.key || meta.id;
            if (!this.weaponSprite) {
                this.weaponSprite = this.scene.add.image(0, 0, key)
                    .setOrigin(0.2, 0.8)
                    .setVisible(false);
            } else if (this.scene.textures.exists(key)) {
                this.weaponSprite.setTexture(key);
            }
            this._attachAttackSprite(this.weaponSprite);
            this.weaponSprite.setOrigin(0.2, 0.8).setScale(1).setVisible(true).setDepth(1);
            this.unarmedSprite?.setVisible(false);
            if (meta.weapon?.knapSilhouette) {
                this._knapTipCell = this._knapExtremeCellAlongAim(this.attackAngle, true);
                this._knapGripCell = this._knapExtremeCellAlongAim(this.attackAngle, false);
            } else {
                this._knapTipCell = null;
                this._knapGripCell = null;
            }
            this._updateWeaponSprite(0);
        } else {
            const fistColor = this.fistColor();
            if (!this.unarmedSprite) {
                this.unarmedSprite = this.scene.add.rectangle(0, 0, 4, 10, fistColor, 1)
                    .setOrigin(0.5, 1);
            } else {
                this.unarmedSprite.setFillStyle(fistColor, 1);
            }
            this._attachAttackSprite(this.unarmedSprite);
            this.unarmedSprite.setVisible(true);
            this.weaponSprite?.setVisible(false);
            this._updateUnarmedSprite(0);
        }
        return true;
    }

    /** Head-local nametag offset (fxRoot / world-HUD space). Fixed 16×16 body — walk frames can change this.width and bounce the tag. */
    _nameAnchorLocal() {
        if (this._prone) return { x: 0, y: -Math.round(16 * 0.5 + 4) };
        return { x: 8, y: -20 };
    }

    _bindNameHud(obj) {
        if (!obj?.active) return;
        this.scene._liftAboveVeil?.(obj, 60);
    }

    _bindChatHud(obj) {
        if (!obj?.active) return;
        this.scene._liftAboveVeil?.(obj, 61);
    }

    _syncNameHudPos() {
        const label = this._nameLabel;
        const crown = this._nameCrown;
        if (!label?.active && !crown?.active) return;
        const a = this._nameAnchorLocal();
        if (label?.active) {
            this._bindNameHud(label);
            label.setPosition(this.x + a.x, this.y + a.y);
        }
        if (crown?.active) {
            this._bindNameHud(crown);
            const zoom = this.scene.worldZoom || 3;
            const s = this.scene.uiScale || 1;
            const glyphH = Math.ceil(10 * s / zoom) + 1;
            crown.setPosition(this.x + a.x, this.y + a.y - glyphH);
        }
    }

    ensureNameLabel() {
        if (this._nameLabel?.active) return this._nameLabel;
        this._nameLabelScaleKey = null;
        const scene = this.scene;
        const zoom = scene.worldZoom || 3;
        const s = scene.uiScale || 1;
        const font = pixelUiFontSize(8, s);
        const stroke = Math.max(2, Math.round(3 * s));
        const color = scene.partySys?.nameColorFor?.(this) || "#ffffff";
        this._nameLabel = scene.add.text(8, -18, this.displayName(), {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${font}px`,
            color,
            stroke: "#000000",
            strokeThickness: stroke,
            align: "center"
        }).setOrigin(0.5, 1);
        this._nameLabel.setResolution(zoom * (window.devicePixelRatio || 1));
        this._nameLabel.setScale(1 / zoom);
        this._bindNameHud(this._nameLabel);
        return this._nameLabel;
    }

    syncNameLabel() {
        const label = this.ensureNameLabel();
        if (!label) return;
        this.applyNameLabelScale();
        const controlled = this.isControlled();
        const hide = controlled || this._bodyDead;
        label.setVisible(!hide);
        if (hide) {
            this._nameCrown?.setVisible(false);
            return;
        }
        const name = this.displayName();
        if (label.text !== name) label.setText(name);
        const color = this.scene.partySys?.nameColorFor?.(this) || "#ffffff";
        if (label.style?.color !== color) label.setColor(color);
        this._recruitTip?.setVisible(false);
        this._syncNameCrown();
        this._syncNameHudPos();
    }

    ensureNameCrown() {
        if (this._nameCrown?.active) return this._nameCrown;
        if (!this.scene.textures.exists("leader")) return null;
        this._nameCrown = this.scene.add.image(8, -20, "leader")
            .setOrigin(0.5, 1)
            .setVisible(false);
        this._bindNameHud(this._nameCrown);
        return this._nameCrown;
    }

    /** Crown over the leader nametag while you are controlling someone else. */
    _syncNameCrown() {
        const scene = this.scene;
        const show = this === scene.leader && !this.isControlled() && !this._bodyDead;
        if (!show) {
            this._nameCrown?.setVisible(false);
            return;
        }
        const crown = this.ensureNameCrown();
        if (!crown) return;
        const zoom = scene.worldZoom || 3;
        const s = scene.uiScale || 1;
        const scale = s / zoom;
        if (crown.scaleX !== scale) crown.setScale(scale);
        crown.setVisible(true);
    }

    syncPawnChannelBar() {
        const ch = this._eatChannel || this._tendChannel || this._skinChannel
            || this._fleshChannel || this._brainChannel || this._craftChannel;
        if (this.isControlled()) {
            this._ownChannelBar?.setVisible(false);
            return;
        }
        if (!ch) {
            this._ownChannelBar?.clear();
            this._ownChannelBar?.setVisible(false);
            return;
        }
        const frac = Phaser.Math.Clamp(1 - ch.remaining / ch.max, 0, 1);
        this._ownChannelBar = this.scene._ensureWorldHudBar?.(this._ownChannelBar)
            || this._ownChannelBar
            || this.scene.add.graphics();
        const zoom = this.scene.worldZoom || 3;
        const w = 40;
        const h = 5;
        const lx = this._prone ? 0 : Math.round(this.width * 0.5);
        const ly = this._prone
            ? -Math.round(Math.max(this.width, this.height) * 0.5 + 2)
            : -Math.round(this.height + 2);
        const color = this.scene._channelBarFillColor?.(frac) || 0x80e080;
        const g = this._ownChannelBar;
        g.clear().setVisible(true);
        g.setScale(1 / zoom);
        g.setPosition(this.x + lx, this.y + ly);
        this.scene._drawBar?.(g, -Math.floor(w / 2), -h, w, h, frac, 0x000000, 0x222222, color, 2);
    }

    isBodyDead() {
        return this._bodyDead;
    }

    isIncapacitated() {
        if (!this.capacities) return false;
        return this.capacities.isPainShock() || this.capacities.isUnconscious();
    }

    isVomiting() {
        return !!(this._vomit && this._vomit.remainingMs > 0);
    }

    /**
     * Start a RimWorld-style vomit bout (5–15s). Ignores if already vomiting.
     * @param {{ remainingMs?: number, fromServer?: boolean, silentLog?: boolean }} [opts]
     */
    startVomit(opts = {}) {
        if (this._bodyDead || this.isVomiting()) return;
        this._cancelEat();
        const remaining = Number(opts.remainingMs);
        this._vomit = {
            remainingMs: remaining > 0 ? remaining : Phaser.Math.Between(5000, 15000),
            dripAccMs: 0,
            fromServer: !!opts.fromServer
        };
        this.setVelocity(0, 0);
        if (this.isAttacking()) this._endAttack?.();
        if (!opts.silentLog) {
            const you = this.isControlled?.();
            this.scene.combatLog?.push(you ? "You vomit." : `${this.displayName()} vomits.`);
        }
        if (!this._vomit.fromServer) this._vomitDrip();
    }

    _vomitDrip() {
        if (!this._vomit?.fromServer) {
            const lose = 0.04 * (Number(this.stomach) || 1600);
            this.starve(lose);
        }
        const c = typeof this.bodyCenter === "function"
            ? this.bodyCenter()
            : { x: this.x, y: this.y };
        const ts = this.scene.tileSize || 16;
        let dx = 0;
        let dy = 0;
        if (this.facing === "right") dx = 1;
        else if (this.facing === "left") dx = -1;
        else if (this.facing === "down") dy = 1;
        else dy = -1;
        const dist = ts * 0.4;
        this.scene.spawnVomitStain?.(
            c.x + dx * dist,
            c.y + dy * dist - (dy === 0 ? ts * 0.15 : 0),
            { facing: this.facing }
        );
    }

    _tickVomit(dt) {
        if (!this.isVomiting()) return;
        this._vomit.remainingMs -= dt;
        if (this._vomit.fromServer) {
            if (this._vomit.remainingMs <= 0) this._vomit = null;
            return;
        }
        this._vomit.dripAccMs += dt;
        while (this._vomit.dripAccMs >= 2500) {
            this._vomit.dripAccMs -= 2500;
            if (this._vomit.remainingMs > 0) this._vomitDrip();
        }
        if (this._vomit.remainingMs <= 0) this._vomit = null;
    }

    /** Legs/moving too wrecked to walk (prone, no crawling). */
    isImmobile() {
        return !!this.capacities?.isImmobile?.();
    }

    /**
     * Apply durability wear to the held hotbar stack (SP / LocalSim).
     * Dedicated MP: server owns this.
     */
    wearHeld(amount) {
        if (!(amount > 0)) return false;
        if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) return false;
        if (typeof Durability === "undefined") return false;
        const idx = this.isControlled?.()
            ? (this.scene.hotbar?.activeIndex ?? this.hotbarIndex ?? 0)
            : (this.hotbarIndex ?? 0);
        const result = Durability.wearInventorySlot(
            this.inventory,
            idx,
            amount,
            (id) => this.scene.getItem(id)
        );
        if (result.leftover) {
            if (!this.gainStack(result.leftover)) {
                const meta = this.scene.getItem(result.leftover.id);
                if (meta) {
                    const now = this.scene.worldMinuteIndex?.() ?? null;
                    DroppedItem.spawn(
                        this.scene, this.x, this.y, meta, result.leftover.quantity,
                        spoilAtForWorld(result.leftover, now),
                        typeof mealStackExtras === "function" ? mealStackExtras(result.leftover) : null
                    );
                }
            }
        }
        if (this.scene.hotbar) this.scene.hotbar.dirty = true;
        if (result.broke) {
            this.scene.combatLog?.push(Durability.breakMessage(result.name, true));
        }
        return result.broke;
    }

    getHeldWeaponMeta() {
        const stack = this.getHeldItem();
        if (!stack) return null;
        const meta = this.scene.getItem(stack.id);
        if (typeof Knapping !== "undefined" && stack.toolClass) {
            if (stack.knapIconData) Knapping.ensureToolTexture(this.scene, stack);
            const knap = Knapping.weaponMetaFromStack(meta, stack);
            if (knap?.weapon?.type === "melee") return knap;
        }
        if (meta?.weapon?.type === "melee") {
            if (stack.knapQuality && typeof weaponMetaWithKnapQuality === "function") {
                return weaponMetaWithKnapQuality(meta, stack);
            }
            return meta;
        }
        return null;
    }

    /**
     * Insert a unique stack (meals / knapped tools). Returns false if inventory full
     * (caller should drop on ground).
     */
    gainStack(stack) {
        if (!stack || !(stack.quantity > 0)) return false;
        const clone = typeof cloneItemStack === "function" ? cloneItemStack(stack) : { ...stack };
        const nullIndex = this.inventory.findIndex((s) => !s);
        if (nullIndex !== -1) {
            this.inventory[nullIndex] = clone;
            this.scene.hotbar.dirty = true;
            return true;
        }
        if (this.inventory.length < this.inventorySize) {
            this.inventory.push(clone);
            this.scene.hotbar.dirty = true;
            return true;
        }
        return false;
    }

    /** Unarmed fist fill — matches arm color on the character look. */
    fistColor() {
        if (typeof PlayerLook !== "undefined") return PlayerLook.fistColor(this.look);
        return 0xff8900;
    }

    onBodyFatal(_part = null, _reason = null) {
        if (this._bodyDead) return;
        this._bodyDead = true;
        this.setVelocity(0, 0);
        if (this._resting || this._restWalk) this.scene?._wakePawn?.(this);
        const environmental = _reason === "bloodLoss" || _reason === "starvation";
        const killer = !environmental && this._hitKiller
            ? this._hitKiller
            : null;
        this._hitKiller = null;
        this._hitKillerAt = 0;
        if (this.role === "wanderer" || this.role === "companion") {
            this.scene.partySys?.onMemberDied?.(this, killer);
            return;
        }
        this.scene.onPlayerDied?.(killer);
    }

    onBodyDamaged(_attacker, _result) {
        if (_attacker) {
            this._hitKiller = _attacker;
            this._hitKillerAt = this.scene?.time?.now ?? 0;
            if (this.role === "wanderer") {
                this.wandererAI?.onDamaged?.(_attacker);
                this.hostile = true;
                this.recruitLocked = true;
                this.scene.partySys?.alertNearbyWanderers?.(this, _attacker);
            }
            if (this.scene?.party?.includes(this) || this === this.scene?.leader) {
                this.scene.partySys?.markPvpHit?.(_attacker);
            }
        }
        this.capacities = new Capacities(this.anatomy);
        this._refreshDownedState();
        this.scene.healthPanel?.refresh?.();
        if (!(_result?.damage > 0)) return;
        this.scene?._onSleepCombatHit?.(this, _attacker);
        if (this._restWalk) {
            this._restWalk = null;
            this.scene?._intendedSleep?.().delete(this.pawnId);
        }
    }

    _refreshDownedState() {
        if (this._bodyDead) return;
        if (!this.capacities || this.capacities.body !== this.anatomy) {
            this.capacities = new Capacities(this.anatomy);
        }
        if (this.capacities.isDeadFromCapacities()) {
            this.onBodyFatal(null, "capacity");
            return;
        }
        this._downed =
            this.capacities.isImmobile() ||
            this.capacities.isPainShock() ||
            this.capacities.isUnconscious();
    }

    respawnFresh(x, y) {
        this._bodyDead = false;
        this._hitKiller = null;
        this._hitKillerAt = 0;
        this._downed = false;
        this._tendChannel = null;
        this._skinChannel = null;
        this._fleshChannel = null;
        this._brainChannel = null;
        this._craftChannel = null;
        this._eatChannel = null;
        this._vomit = null;
        setCreatureProne(this, false);
        this.anatomy.fullHeal();
        this.capacities = new Capacities(this.anatomy);
        this.kc = 1200;
        this.saturation = 0;
        this.teleport(x, y);
        this.setVisible(true);
        if (this.body) this.body.enable = true;
        this.scene.hotbar?.setSize?.(this.inventorySize);
        this.scene.hotbar.dirty = true;
        this.scene.equipmentPanel?.refresh?.();
    }

    /**
     * Take a loot stack into inventory. Returns false if nothing could be taken.
     * Overflow that doesn't fit is dropped at feet (still counts as taken from corpse).
     */
    takeLootStack(stack) {
        if (!stack || !(stack.quantity > 0)) return false;
        const special = typeof isSpecialStack === "function"
            ? isSpecialStack(stack)
            : !!(stack.customName || stack.food || stack.ingredients || stack.toolClass);
        if (special) {
            const clone = cloneItemStack(stack);
            const nullIndex = this.inventory.findIndex(s => !s);
            if (nullIndex !== -1) {
                this.inventory[nullIndex] = clone;
                this.scene.hotbar.dirty = true;
                return true;
            }
            if (this.inventory.length < this.inventorySize) {
                this.inventory.push(clone);
                this.scene.hotbar.dirty = true;
                return true;
            }
            const meta = this.scene.getItem(stack.id);
            if (!meta) return false;
            const now = this.scene.worldMinuteIndex?.() ?? null;
            DroppedItem.spawn(
                this.scene, this.x, this.y, meta, clone.quantity,
                spoilAtForWorld(clone, now), mealStackExtras(clone)
            );
            return true;
        }
        const meta = this.scene.getItem(stack.id);
        if (!meta) return false;
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const left = spoilLeftForCharacter(stack, now);
        const remaining = this.gainItem(meta, stack.quantity, left, {
            dryProgress: stack.dryProgress,
            soakProgress: stack.soakProgress
        });
        if (remaining === stack.quantity) return false;
        if (remaining > 0) {
            DroppedItem.spawn(
                this.scene, this.x, this.y, meta, remaining,
                spoilAtForWorld({ spoilLeft: left }, now),
                mealStackExtras({ ...stack, quantity: remaining })
            );
        }
        return true;
    }

    /**
     * Dump equipment then full hotbar into a corpse, clear gear/inv (pouch-safe).
     * Call on death before respawn UI.
     * @param {{ spawn?: boolean }} [opts] spawn=false clears gear without a local corpse
     *   (dedicated MP: server authors the corpse).
     */
    createDeathCorpse(opts = {}) {
        const spawn = opts.spawn !== false;
        // Snapshot hotbar BEFORE unequipping pouches (keeps slots 6+)
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const toLoot = (s) => {
            const clone = cloneItemStack(s);
            if (!clone || now == null) return clone;
            migrateToSpoilAt(clone, now);
            return clone;
        };
        const hotbarSnap = this.inventory.map(s => (s ? toLoot(s) : null));

        const loot = [];
        for (const key of ["head", "torso", "legs", "feet"]) {
            const s = this.equipment[key];
            if (s) loot.push(toLoot(s));
        }
        for (const s of this.equipment.waist || []) {
            if (s) loot.push(toLoot(s));
        }
        for (const s of hotbarSnap) {
            if (s) loot.push(s);
        }

        // Clear without syncInventorySize dropping overflow (already snapped)
        this.equipment = { head: null, torso: null, legs: null, feet: null, waist: [] };
        this.inventory = [];
        for (let i = 0; i < this.baseInventorySize; i++) this.inventory.push(null);
        this.inventorySize = this.baseInventorySize;
        this.recomputeEquipmentEffects();
        if (this.isControlled?.()) {
            this.scene.hotbar?.setSize?.(this.inventorySize);
            this.scene.hotbar.dirty = true;
            this.scene.equipmentPanel?.refresh?.();
        }

        // bodyCenter() respects standing (origin 0,1) and prone (origin 0.5,0.5)
        const c = this.bodyCenter();
        const corpseName = this.displayName() || this.pawnName || "Someone";
        const playerCorpse = this.role !== "wanderer";
        if (!spawn) {
            return { x: c.x, y: c.y, loot, name: corpseName };
        }
        return Corpse.spawn(this.scene, {
            x: c.x,
            y: c.y,
            key: this.texture?.key || "human",
            look: this.look || null,
            frame: 7,
            name: corpseName,
            loot,
            body: this.anatomy?.toJSON?.(),
            bodyPlan: this.anatomy?.planId || "human",
            mobId: "human",
            playerCorpse
        });
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
                const now = this.scene.worldMinuteIndex?.() ?? null;
                DroppedItem.spawn(
                    this.scene, this.x, this.y,
                    meta, stack.quantity, spoilAtForWorld(stack, now), extras
                );
            }
            this.inventory.length = size;
        }

        if (this.scene.hotbar && this.isControlled?.()) {
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
     * True if tryEquipLootStackIfSlotEmpty would succeed (no mutation).
     */
    canEquipLootStackIfSlotEmpty(stack) {
        if (!stack || !(stack.quantity > 0)) return false;
        const meta = this.scene.getItem(stack.id);
        const want = this.getEquipSlotName(meta);
        if (!want) return false;

        if (want === "waist") {
            const cap = this.getWaistCapacity();
            if (cap <= 0) return false;
            for (let i = 0; i < cap; i++) {
                if (!this.equipment.waist[i]) return true;
            }
            return false;
        }
        if (this.getEquipmentStack(want)) return false;
        if (!this.canChangeBodySlot(want, meta)) return false;
        return true;
    }

    /**
     * Equip a loot stack into its natural slot only if that slot is empty.
     * Consumes 1 from `stack` in place. Returns true if equipped.
     */
    tryEquipLootStackIfSlotEmpty(stack) {
        if (!this.canEquipLootStackIfSlotEmpty(stack)) return false;
        const meta = this.scene.getItem(stack.id);
        const want = this.getEquipSlotName(meta);

        let slotKey;
        if (want === "waist") {
            const cap = this.getWaistCapacity();
            let empty = -1;
            for (let i = 0; i < cap; i++) {
                if (!this.equipment.waist[i]) {
                    empty = i;
                    break;
                }
            }
            if (empty === -1) return false;
            slotKey = `waist:${empty}`;
        } else {
            slotKey = want;
        }

        const one = cloneItemStack(stack);
        one.quantity = 1;
        this.setEquipmentStack(slotKey, one);
        stack.quantity -= 1;
        this.syncWaistSlots();
        this.recomputeEquipmentEffects();
        this.scene.hotbar.dirty = true;
        return true;
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
            let different = -1;
            for (let i = 0; i < cap; i++) {
                const worn = this.equipment.waist[i];
                if (!worn) {
                    if (empty === -1) empty = i;
                } else if (worn.id !== stack.id && different === -1) {
                    different = i;
                }
            }
            const idx = empty !== -1 ? empty : different;
            if (idx === -1) return { ok: false, reason: 'same' };
            slotKey = `waist:${idx}`;
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
            this.setEquipmentStack(slotKey, makeItemStack(meta, 1, stack.spoilLeft));
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
            this.setEquipmentStack(slotKey, makeItemStack(meta, 1, stack.spoilLeft));
        }

        this.syncWaistSlots();
        this.recomputeEquipmentEffects();
        this.scene.hotbar.dirty = true;
        this._notifyNetGear(typeof NetProtocol !== "undefined" ? NetProtocol.Actions.EQUIP : "equip", {
            from: hotbarIndex,
            slot: slotKey,
            pawnId: this.pawnId
        });
        return { ok: true };
    }

    /** Dedicated MP: server owns gear — local mutate would be stomped by YOU. */
    _notifyNetGear(type, payload) {
        const scene = this.scene;
        if (!(scene.isNet && scene.net?.connected && !scene.net.isLocal)) return;
        if (!type) return;
        scene._invSwapGuardUntil = performance.now() + 500;
        scene.net.sendAction({ type, pawnId: this.pawnId, ...payload });
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
            dest.spoilLeft = mergeSpoilLeft(
                dest.quantity, dest.spoilLeft,
                equipped.quantity, equipped.spoilLeft
            );
            delete dest.spoilAt;
            mergeDryInto(dest, dest.quantity, equipped.quantity, equipped.dryProgress);
            mergeSoakInto(dest, dest.quantity, equipped.quantity, equipped.soakProgress);
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
            this.setEquipmentStack(slotKey, makeItemStack(destMeta, 1, dest.spoilLeft));
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
        this._notifyNetGear(typeof NetProtocol !== "undefined" ? NetProtocol.Actions.UNEQUIP : "unequip", {
            slot: slotKey,
            to: hotbarIndex
        });
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
        // Keep render-snap restore in sync (otherwise next preupdate warps back)
        this._physX = x;
        this._physY = y;
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
        if (this._bodyDead) return 0;
        // Prefer structured body hit
        if (opts?.attack) {
            const result = BodyCombat.applyHit(source, this, opts.attack, opts);
            return result?.damage || 0;
        }
        // Fallback: treat amount as blunt injury to rolled limb
        const fake = {
            damage: Number(amount) || 1,
            type: opts?.type === "sharp" ? "sharp" : "blunt",
            verb: "struck",
            sourcePart: { name: "blow" },
            def: { variance: 0.05 },
            name: "Hit"
        };
        const result = BodyCombat.applyHit(source, this, fake, opts);
        return result?.damage || 0;
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
        if (this._prone) return { x: this.x, y: this.y };
        return {
            x: this.x + this.width * 0.5,
            y: this.y - this.height * 0.5
        };
    }

    /** Body center in fxRoot local space (root is pinned to this.x/this.y). */
    bodyCenterLocal() {
        if (this._prone) return { x: 0, y: 0 };
        return {
            x: this.width * 0.5,
            y: -this.height * 0.5
        };
    }

    /** Parent attack VFX to fxRoot so roundPixels can't desync them from the player. */
    _attachAttackSprite(spr) {
        if (!spr) return;
        const root = this.ensureFxRoot();
        this.syncFxRoot();
        if (spr.parentContainer !== root) root.add(spr);
    }

    /**
     * Solid body bounds for melee (origin bottom-left when standing).
     * Insets empty frame edges so the box matches the drawn character.
     */
    hurtbox(pad = 0) {
        if (this._prone) {
            const hw = this.width * 0.35;
            const hh = this.height * 0.35;
            return {
                left: this.x - hw - pad,
                top: this.y - hh - pad,
                right: this.x + hw + pad,
                bottom: this.y + hh + pad
            };
        }
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

    _pickMeleeAttack(angle) {
        if (typeof Chop !== "undefined" && typeof BodyCombat !== "undefined") {
            const held = this.getHeldItem();
            if (Chop.chopFraction(held) > 0) {
                const chop = Chop.pickChopFromAttacks(BodyCombat.collectAttacks(this));
                const c = this.bodyCenter();
                if (chop && this.scene.aimHitsChoppableTrunk?.(c, angle)) return chop;
            }
        }
        return BodyCombat.pickAttack(this);
    }

    /** Rebuild held-weapon meta from a server attack-art payload. */
    _weaponMetaFromNetArt(art) {
        if (!art || art.unarmed || !(art.key || art.itemId)) return null;
        const scene = this.scene;
        let key = art.key || art.itemId;
        if (
            art.knapIconData
            && typeof Knapping !== "undefined"
            && typeof Knapping.ensureToolTexture === "function"
        ) {
            try {
                key = Knapping.ensureToolTexture(scene, {
                    id: art.itemId || "knap",
                    knapIconData: art.knapIconData,
                    knapIcon: art.key
                }) || key;
            } catch (_) { /* fall through */ }
        }
        if (!key || !scene.textures?.exists?.(key)) return null;
        return {
            key,
            id: art.itemId || key,
            weapon: {
                type: "melee",
                range: Number(art.range) || 12,
                knapSilhouette: !!art.knapSilhouette
            }
        };
    }

    startMeleeAttack(meta = null, opts = {}) {
        if (this.isAttacking() || this._bodyDead) return false;
        if (this._resting) return false;
        if (this.isVomiting()) return false;
        if (this.isIncapacitated()) return false;
        if (this._eatChannel) this._cancelEat();
        if (this._tendChannel || this._skinChannel || this._fleshChannel || this._brainChannel || this._craftChannel) return false;

        this.capacities = new Capacities(this.anatomy);
        if (!this.capacities.canManipulate()) return false;

        const pointer = this.scene.input.activePointer;
        const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const c = this.bodyCenter();
        let angle = Number.isFinite(opts.angle)
            ? opts.angle
            : Math.atan2(world.y - c.y, world.x - c.x);
        if (!Number.isFinite(angle)) angle = 0;

        const attack = this._pickMeleeAttack(angle);
        if (!attack) return false;

        const scale = this.capacities.actionDurationScale();
        const durationMs = meleeAttackDurationMs(attack.cooldown || 2, scale);

        this.currentAttack = attack;
        const art = opts.art && typeof opts.art === "object" ? opts.art : null;
        let held = meta || this.getHeldWeaponMeta();
        if (art) {
            if (art.unarmed) held = null;
            else held = this._weaponMetaFromNetArt(art) || held;
        }
        // Offhand fist / pure unarmed: short reach — never inherit spear range/art.
        // Server puppets may have a stale local pick; trust attack-art when present.
        const artWeapon = !!(art && !art.unarmed && held?.weapon?.type === "melee");
        const useWeaponArt = !!(held?.key && held?.weapon?.type === "melee" && (artWeapon || !attack.unarmed));
        this.attackWeapon = useWeaponArt
            ? held.weapon
            : { type: "melee", range: attack.range || 4, hitStart: 0.25, hitEnd: 0.75 };
        this.attackMax = durationMs;
        this.attackTimer = this.attackMax;
        if (Number(art?.max) > 0) {
            this.attackMax = Number(art.max);
            this.attackTimer = this.attackMax;
        }
        this.attackAngle = angle;
        this.attackHitSet = new Set();
        this._attackWoreHeld = false;
        this._attackChoppedTree = false;
        this.facing = this.facingFromAngle(angle);
        this.scene.hideWorldTooltip?.();

        if (!opts.silentNet && this.scene.isNet && this.scene.net?.connected) {
            // Keep server pose current so hitboxes match what you see
            this.scene._netSendMove?.(true);
            this._sendNetAttack(angle);
        }

        if (useWeaponArt) {
            const key = held.key || held.id;
            if (!this.weaponSprite) {
                this.weaponSprite = this.scene.add.image(0, 0, key)
                    .setOrigin(0.2, 0.8)
                    .setVisible(false);
            } else if (this.scene.textures.exists(key)) {
                this.weaponSprite.setTexture(key);
            }
            this._attachAttackSprite(this.weaponSprite);
            this.weaponSprite.setOrigin(0.2, 0.8).setScale(1).setVisible(true).setDepth(1);
            this.unarmedSprite?.setVisible(false);
            // Grip near body, tip forward — never re-pick from world pos (jitter while moving)
            if (held.weapon?.knapSilhouette) {
                this._knapTipCell = this._knapExtremeCellAlongAim(angle, true);
                this._knapGripCell = this._knapExtremeCellAlongAim(angle, false);
            } else {
                this._knapTipCell = null;
                this._knapGripCell = null;
            }
            this._updateWeaponSprite(0);
        } else {
            // Tiny unarmed thrust rectangle (matches arm color on player sheet)
            const fistColor = this.fistColor();
            if (!this.unarmedSprite) {
                this.unarmedSprite = this.scene.add.rectangle(0, 0, 4, 10, fistColor, 1)
                    .setOrigin(0.5, 1);
            } else {
                this.unarmedSprite.setFillStyle(fistColor, 1);
            }
            this._attachAttackSprite(this.unarmedSprite);
            this.unarmedSprite.setVisible(true).setDepth(1);
            this.weaponSprite?.setVisible(false);
            this._updateUnarmedSprite(0);
        }
        return true;
    }

    _updateUnarmedSprite(progress) {
        if (!this.unarmedSprite || !this.currentAttack) return;
        this.syncFxRoot();
        const range = Number(this.attackWeapon?.range) || Number(this.currentAttack.range) || 4;
        const c = this.bodyCenterLocal();
        placeUnarmedThrustSprite(
            this.unarmedSprite, c.x, c.y, this.attackAngle, range, progress, null
        );
        this.unarmedSprite.setDepth(1);
    }

    _attackProgress() {
        if (this.attackMax <= 0) return 1;
        return 1 - (this.attackTimer / this.attackMax);
    }

    /** Art tip points up-right (-45°) at rotation 0 → add +45° so tip follows aim. */
    _spearRotation(aimAngle) {
        return aimAngle + Math.PI / 4;
    }

    /** Knapped silhouettes have tip facing up → +90° so tip follows aim. */
    _weaponAimRotation(aimAngle) {
        if (this.attackWeapon?.knapSilhouette) return aimAngle + Math.PI / 2;
        return this._spearRotation(aimAngle);
    }

    /** Jab: 0→1 extends out, 1→0 pulls back (shared with mobs). */
    _spearThrust(progress) {
        return meleeThrustCurve(progress);
    }

    _updateWeaponSprite(progress) {
        if (!this.weaponSprite || !this.attackWeapon) return;
        this.syncFxRoot();
        const range = Number(this.attackWeapon.range) || 12;
        const thrust = this._spearThrust(progress);
        const c = this.bodyCenterLocal();
        const ang = this.attackAngle;
        const rot = this._weaponAimRotation(ang);
        this.weaponSprite.setRotation(rot);

        // Knapped tools: grip near the body; tip extends forward (not tip-at-hold,
        // which left most of the silhouette behind the player).
        if (this.attackWeapon.knapSilhouette) {
            const hold = 5;
            const anchorDist = hold + range * thrust;
            const ax = c.x + Math.cos(ang) * anchorDist;
            const ay = c.y + Math.sin(ang) * anchorDist;
            const gripCell = this._knapGripCell
                || this._knapExtremeCellAlongAim(ang, false);
            if (gripCell) {
                const gripOff = this._weaponFrameLocalOffset(gripCell.x, gripCell.y);
                this.weaponSprite.setPosition(ax - gripOff.x, ay - gripOff.y);
            } else {
                this.weaponSprite.setPosition(ax, ay);
            }
            this.weaponSprite.setDepth(1);
            return;
        }

        // Spears: anchor mid-shaft at hold + range * thrust
        const hold = 6;
        const anchorDist = hold + range * thrust;
        const ax = c.x + Math.cos(ang) * anchorDist;
        const ay = c.y + Math.sin(ang) * anchorDist;
        const fw = this.weaponSprite.frame?.width || this.weaponSprite.width || 16;
        const fh = this.weaponSprite.frame?.height || this.weaponSprite.height || 16;
        const mid = this._weaponFrameLocalOffset((fw - 1) * 0.5, (fh - 1) * 0.5);
        this.weaponSprite.setPosition(ax - mid.x, ay - mid.y);
        this.weaponSprite.setDepth(1);
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
     * Sprite lives in fxRoot local space when attacking.
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
        const ox = localX * cos - localY * sin;
        const oy = localX * sin + localY * cos;
        if (spr.parentContainer && this.fxRoot && spr.parentContainer === this.fxRoot) {
            return { x: this.x + spr.x + ox, y: this.y + spr.y + oy };
        }
        return { x: spr.x + ox, y: spr.y + oy };
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

    /** Cached opaque pixel coords for a knapped tool texture. */
    _knapOpaqueCells(spr) {
        const key = spr?.texture?.key;
        if (!key) return null;
        if (!this._knapOpaqueCache) this._knapOpaqueCache = new Map();
        if (this._knapOpaqueCache.has(key)) return this._knapOpaqueCache.get(key);

        const w = spr.frame?.width || spr.width || 16;
        const h = spr.frame?.height || spr.height || 16;
        let src = null;
        try {
            src = spr.texture.getSourceImage();
        } catch (_) {
            return null;
        }
        if (!src) return null;
        let data = null;
        if (src.getContext) {
            try {
                data = src.getContext("2d").getImageData(0, 0, w, h).data;
            } catch (_) {
                return null;
            }
        } else if (typeof document !== "undefined") {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            ctx.drawImage(src, 0, 0);
            data = ctx.getImageData(0, 0, w, h).data;
        }
        if (!data) return null;

        const cells = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (data[(y * w + x) * 4 + 3] < 16) continue;
                cells.push({ x, y });
            }
        }
        const out = cells.length ? cells : null;
        this._knapOpaqueCache.set(key, out);
        return out;
    }

    /**
     * Opaque cell farthest (tip) or nearest (grip) along aim in frame space.
     * Ignores current sprite world pos.
     */
    _knapExtremeCellAlongAim(ang, wantTip) {
        const spr = this.weaponSprite;
        const cells = this._knapOpaqueCells(spr);
        if (!cells?.length) return null;
        const w = spr.frame?.width || spr.width || 16;
        const h = spr.frame?.height || spr.height || 16;
        const rot = this._weaponAimRotation(ang);
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        let best = null;
        let bestProj = wantTip ? -Infinity : Infinity;
        for (const cell of cells) {
            const localX = cell.x - spr.originX * w;
            const localY = cell.y - spr.originY * h;
            const ox = localX * cosR - localY * sinR;
            const oy = localX * sinR + localY * cosR;
            const proj = ox * cosA + oy * sinA;
            if (wantTip ? proj > bestProj : proj < bestProj) {
                bestProj = proj;
                best = cell;
            }
        }
        return best;
    }

    /** @deprecated Prefer _knapExtremeCellAlongAim(ang, true) */
    _knapTipCellAlongAim(ang) {
        return this._knapExtremeCellAlongAim(ang, true);
    }

    /**
     * Tiny tip-only segment for knapped tools — no spear frame / centroid span.
     */
    _getKnapHitSegment() {
        const spr = this.weaponSprite;
        if (!spr || !spr.visible) return null;
        const tipCell = this._knapTipCell || this._knapExtremeCellAlongAim(this.attackAngle, true);
        if (!tipCell) return null;
        const tip = this._weaponFrameToWorld(tipCell.x, tipCell.y);
        if (!tip) return null;
        const ang = this.attackAngle;
        // ~2px of blade behind the tip — stays on the stone, not empty frame
        const len = 2;
        return {
            a: {
                x: tip.x - Math.cos(ang) * len,
                y: tip.y - Math.sin(ang) * len
            },
            b: tip
        };
    }

    _meleeHitCheck(progress) {
        const w = this.attackWeapon;
        const attack = this.currentAttack;
        if (!w || !attack) return;
        // Dedicated MP: server SimWorld resolves BodyCombat hits.
        if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
            return;
        }
        const start = Number(w.hitStart ?? 0.25);
        const end = Number(w.hitEnd ?? 0.75);
        if (progress < start || progress > end) return;

        let seg = null;
        let radius = 3;
        if (this.weaponSprite?.visible) {
            if (w.knapSilhouette) {
                seg = this._getKnapHitSegment();
                radius = 0; // tip pixel only — no fat padding past the stone
            } else {
                seg = this._getSpearHitSegment();
            }
        } else if (this.unarmedSprite?.visible) {
            seg = unarmedHitSegment(this.unarmedSprite, this.attackAngle);
            // Fist sprite is in fxRoot local space
            if (seg && this.fxRoot && this.unarmedSprite.parentContainer === this.fxRoot) {
                seg.a.x += this.x;
                seg.a.y += this.y;
                seg.b.x += this.x;
                seg.b.y += this.y;
            }
            radius = 4;
        }
        if (!seg && !(typeof Chop !== "undefined" && Chop.isChopAttack(attack))) return;

        const group = this.scene.damageables;
        if (seg && group) {
            for (const target of group.getChildren()) {
                if (!target || !target.active || target === this) continue;
                if (this.attackHitSet.has(target)) continue;
                if (target.isBodyDead?.()) continue;
                if (typeof Party !== "undefined" && Party.sameFaction?.(this, target)) continue;

                if (!meleeSegmentHitsTarget(seg.a, seg.b, radius, target)) continue;

                this.attackHitSet.add(target);
                BodyCombat.applyHit(this, target, attack);
                this.scene.partySys?.notePlayerHit?.(target);
                if (!attack.unarmed) {
                    this.wearHeld(1);
                    this._attackWoreHeld = true;
                }
            }
        }

        this._tryChopHit(seg);
    }

    _tryChopHit(seg) {
        if (this._attackChoppedTree) return;
        if (typeof Chop === "undefined" || !Chop.isChopAttack(this.currentAttack)) return;
        const frac = Chop.chopFraction(this.getHeldItem());
        if (!(frac > 0)) return;
        const trees = this.scene.choppableThingsNear?.(this.x, this.y, Chop.AIM_REACH + 16) || [];
        const c = this.bodyCenter();
        const aimSeg = Chop.aimSegment(c.x, c.y, this.attackAngle, Chop.AIM_REACH);
        let best = null;
        let bestD = Infinity;
        for (const t of trees) {
            if (!t || this.attackHitSet.has(t)) continue;
            const hs = t.hitboxSize || t.meta?.hitboxSize || 5;
            const hit = (seg && Chop.trunkHitsSegment(seg, t.x, t.y, hs, Chop.HIT_RADIUS))
                || Chop.trunkHitsSegment(aimSeg, t.x, t.y, hs, Chop.HIT_RADIUS);
            if (!hit) continue;
            const dx = t.x - this.x;
            const dy = t.y - this.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
                best = t;
                bestD = d;
            }
        }
        if (!best) return;
        this._attackChoppedTree = true;
        this.attackHitSet.add(best);
        this.scene.applyLocalChop?.(best, frac);
        if (!this.currentAttack.unarmed && !this._attackWoreHeld) {
            this.wearHeld(1);
            this._attackWoreHeld = true;
        }
    }

    noteChopProgress(thing, frac, felled) {
        if (felled || !thing?.active) {
            this._chopBar = null;
            this.scene.hideTreeChopBar?.();
            return;
        }
        const f = Phaser.Math.Clamp(Number(frac) || 0, 0, 1);
        this._chopBar = { thing, frac: f };
        this.scene.showTreeChopBar?.(thing, f);
    }

    _tickChopBar() {
        if (!this._chopBar) return;
        const thing = this._chopBar.thing;
        if (!thing?.active) {
            this._chopBar = null;
            this.scene.hideTreeChopBar?.();
            return;
        }
        const held = this.getHeldItem();
        if (typeof Chop === "undefined" || !(Chop.chopFraction(held) > 0)) {
            this._chopBar = null;
            this.scene.hideTreeChopBar?.();
            return;
        }
        const dx = this.x - thing.x;
        const dy = this.y - thing.y;
        const range = Chop.BAR_RANGE || 48;
        if (dx * dx + dy * dy > range * range) {
            this._chopBar = null;
            this.scene.hideTreeChopBar?.();
            return;
        }
        this.scene.showTreeChopBar?.(thing, this._chopBar.frac);
    }

    _endAttack() {
        this.attackTimer = 0;
        this.attackMax = 0;
        this.attackWeapon = null;
        this.attackHitSet = null;
        this.currentAttack = null;
        this._knapTipCell = null;
        this._knapGripCell = null;
        if (this.weaponSprite) this.weaponSprite.setVisible(false);
        if (this.unarmedSprite) this.unarmedSprite.setVisible(false);
        this.tooltipBlockUntil = (this.scene.time?.now ?? 0) + 250;
    }

    /**
     * Satiety multiplier for a food stack/def (default 0.1 if unset).
     * Meals fall back to 0.3 when missing.
     */
    _satietyRatio(food, meta = null, isMeal = false) {
        const raw = food?.satietyRatio ?? meta?.food?.satietyRatio;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) return n;
        return isMeal ? 0.3 : 0.1;
    }

    /**
     * Eat up to stomach capacity.
     * @returns {number} kcal actually consumed (0 if none)
     */
    eat(food, meta = null) {
        const kc = Number(food?.kc ?? 0);
        if (!(kc > 0)) return 0;
        if (this.kc >= this.stomach) return 0;
        const consumed = Math.min(kc, this.stomach - this.kc);
        this.kc += consumed;
        this.saturation += consumed * this._satietyRatio(food, meta, false);
        return consumed;
    }

    /**
     * Roll food-poison chance after a successful eat.
     * @param {Object} food stack or item food block
     * @param {Object} [meta] item def
     */
    _tryFoodPoison(food, meta = null) {
        const result = typeof Hediffs !== "undefined"
            ? Hediffs.tryFoodPoison?.(this.anatomy, food, meta, null, this)
            : null;
        if (!result) return;
        this.capacities = new Capacities(this.anatomy);
        this.scene.combatLog?.push(result.message);
        this.scene.healthPanel?.refresh?.();
    }

    starve(kc) {
        this.saturation -= kc;
        if (this.saturation < 0) {
            this.kc = Math.max(this.kc + this.saturation, 0);
            this.saturation = 0;
        }
    }

    hungerTick() {
        // Snapshot before drain — malnutrition recovery uses this so a minute that
        // starts fed still counts as fed even if hungerRateFactor empties the stomach.
        this._malnutritionFed = (this.kc > 0) || (this.saturation > 0);

        // 2000 kcal over 1440 game minutes (one day) while idle
        let tick = this.hunger / (24 * 60);
        if (this.isSprinting) tick *= 1.5;
        tick *= this.getEncumbrance().hungerRate;
        this.capacities = this.capacities || new Capacities(this.anatomy);
        tick *= this.capacities.hungerRateFactor?.() || 1;
        if (typeof Sleep !== "undefined") tick *= Sleep.hungerMult?.(this._resting) ?? 1;
        this.starve(tick);
        // Malnutrition hediff rises/falls in Hediffs.minuteTick
    }

    /**
     * How many of `stack` would fit in inventory right now (no mutation).
     * Used so corpse right-click doesn't optimistic-clear a slot the server will reject.
     */
    countLootSpace(stack, want = 1) {
        if (!stack?.id) return 0;
        const item = this.scene.getItem(stack.id);
        if (!item) return 0;
        const wantN = Math.max(0, Math.floor(Number(want) || 0));
        if (!wantN) return 0;
        const maxStack = Math.max(1, Number(item.maxStack) || 1);
        const special = typeof isSpecialStack === "function"
            ? isSpecialStack(stack)
            : !!(stack.customName || stack.food || stack.ingredients || stack.toolClass);
        const weight = typeof Carry !== "undefined"
            ? Carry.unitWeight(stack, item)
            : (Number(item.weight) || 0);
        const weightLeft = Math.max(0, this.strength * 2 - this.getInventoryWeight());
        const allowedByWeight = weight > 0
            ? Math.floor((weightLeft + Math.pow(10, -8)) / weight)
            : wantN;
        if (allowedByWeight <= 0) return 0;

        let space = 0;
        if (!special) {
            for (const slot of this.inventory) {
                if (!slot || slot.id !== item.id || slot.quantity >= maxStack) continue;
                if (slot.customName || slot.food || slot.ingredients || slot.toolClass) continue;
                space += maxStack - slot.quantity;
            }
        }
        const empty = this.inventory.filter((s) => !s).length
            + Math.max(0, this.inventorySize - this.inventory.length);
        space += empty * maxStack;
        return Math.min(wantN, space, allowedByWeight);
    }

    gainItem(item, amount = 1, spoilLeft = undefined, extras = null) {
        let remaining = amount;
        const unitW = typeof Carry !== "undefined"
            ? Carry.unitWeight({ id: item.id }, item)
            : (Number(item.weight) || 0);
        const cap = typeof Carry !== "undefined"
            ? Carry.carryCap(this.strength)
            : this.strength * 2;
        const fitNow = () => {
            if (typeof Carry !== "undefined") {
                return Carry.countFit(
                    remaining,
                    unitW,
                    this.getInventoryWeight(),
                    cap
                );
            }
            const weightLeft = Math.max(0, cap - this.getInventoryWeight());
            const allowed = unitW > 0
                ? Math.floor((weightLeft + Math.pow(10, -8)) / unitW)
                : remaining;
            return Math.min(remaining, allowed);
        };
        const incomingSpoil = spoilLeft !== undefined
            ? spoilLeft
            : defaultSpoilLeft(item);

        // Fill existing stacks first (never merge into meals / food-overridden stacks)
        for (const slot of this.inventory) {
            if (!slot || slot.id !== item.id || slot.quantity >= item.maxStack) continue;
            if (slot.customName || slot.food || slot.ingredients || slot.toolClass) continue;
            const space = item.maxStack - slot.quantity;
            const toAdd = Math.min(space, remaining, fitNow());
            if (!(toAdd > 0)) break;
            slot.spoilLeft = mergeSpoilLeft(
                slot.quantity, slot.spoilLeft,
                toAdd, incomingSpoil
            );
            delete slot.spoilAt;
            mergeDryInto(slot, slot.quantity, toAdd, extras?.dryProgress);
            mergeSoakInto(slot, slot.quantity, toAdd, extras?.soakProgress);
            slot.quantity += toAdd;
            remaining -= toAdd;
            if (remaining === 0) {
                this.scene.hotbar.dirty = true;
                return remaining;
            }
        }

        // Create new stacks as needed
        while (remaining > 0) {
            const toAdd = Math.min(item.maxStack, remaining, fitNow());
            if (!(toAdd > 0)) break;
            const stack = makeItemStack(item, toAdd, incomingSpoil);
            const dry = Math.floor(Number(extras?.dryProgress) || 0);
            if (dry > 0) stack.dryProgress = dry;
            const soak = Math.floor(Number(extras?.soakProgress) || 0);
            if (soak > 0) stack.soakProgress = soak;
            const nullIndex = this.inventory.findIndex(s => !s);
            if (nullIndex !== -1) {
                this.inventory[nullIndex] = stack;
                remaining -= toAdd;
                continue;
            }
            if (this.inventory.length >= this.inventorySize) break;
            this.inventory.push(stack);
            remaining -= toAdd;
        }
        if (remaining !== amount) {
            this.scene.hotbar.dirty = true;
            this.scene._scheduleCharacterSave?.();
        }
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
        return this.loseMatchingItems({ id, qty: amount });
    }

    _stackMatchesCraft(stack, match) {
        if (!stack || !match) return false;
        if (match.hideStage) {
            const getItem = (id) => this.scene.getItem?.(id);
            if (typeof Hide !== "undefined" && Hide.stackIsHideStage) {
                return Hide.stackIsHideStage(stack, match.hideStage, getItem);
            }
            return this.scene.getItem?.(stack.id)?.hide?.stage === match.hideStage;
        }
        if (!stack.id || stack.id !== match.id) return false;
        if (match.toolClass && stack.toolClass !== match.toolClass) return false;
        return true;
    }

    /**
     * Remove stacks matching id (and optional toolClass / hideStage). Prefer exact toolClass matches.
     * @param {{ id?: string, qty?: number, toolClass?: string|null, hideStage?: string|null }} match
     */
    loseMatchingItems(match) {
        let remaining = Math.max(0, Number(match?.qty) || 1);
        const wantClass = match?.toolClass || null;
        const hideStage = match?.hideStage || null;
        const id = match?.id;
        if ((!hideStage && !id) || !(remaining > 0)) return 0;
        let numLost = 0;

        const takeFrom = (requireClass) => {
            for (let i = 0; i < this.inventory.length && remaining > 0; i++) {
                const s = this.inventory[i];
                if (!this._stackMatchesCraft(s, hideStage ? { hideStage } : { id })) continue;
                if (requireClass && s.toolClass !== requireClass) continue;
                if (!requireClass && wantClass && s.toolClass === wantClass) continue;
                const take = Math.min(s.quantity, remaining);
                s.quantity -= take;
                remaining -= take;
                numLost += take;
                if (s.quantity <= 0) this.inventory[i] = null;
            }
        };

        if (hideStage) {
            takeFrom(null);
        } else {
            if (wantClass) takeFrom(wantClass);
            // Only fall back to bare id when no toolClass was required
            if (!wantClass) takeFrom(null);
        }

        if (numLost > 0) this.scene.hotbar.dirty = true;
        return numLost;
    }

    getNumItems(id) {
        return this.getNumMatchingItems({ id });
    }

    /**
     * Count stacks matching id (and optional toolClass / hideStage).
     * @param {{ id?: string, toolClass?: string|null, hideStage?: string|null }} match
     */
    getNumMatchingItems(match) {
        const hideStage = match?.hideStage || null;
        const id = match?.id;
        const wantClass = match?.toolClass || null;
        if (!hideStage && !id) return 0;
        let sum = 0;
        for (const stack of this.inventory) {
            if (!this._stackMatchesCraft(stack, hideStage ? { hideStage } : { id, toolClass: wantClass })) continue;
            sum += stack.quantity;
        }
        return sum;
    }

    getHeldItem() {
        const idx = this.isControlled?.()
            ? (this.scene.hotbar?.activeIndex ?? this.hotbarIndex ?? 0)
            : (this.hotbarIndex ?? 0);
        return this.inventory[idx] || null;
    }

    useHeldItem() {
        const item = this.getHeldItem();
        if (item) return this.useItem(item);
        return null;
    }

    /** Hold Space to keep attacking (weapon or unarmed). */
    tryWeaponAutofire() {
        if (this.isAttacking() || this._tendChannel || this._skinChannel || this._fleshChannel || this._brainChannel || this._craftChannel || this._eatChannel || this._bodyDead) return;
        if (this.isVomiting() || this.isIncapacitated()) return;
        const item = this.getHeldItem();
        if (!item) {
            this.startMeleeAttack(null);
            return;
        }
        const meta = this.scene.getItem(item.id);
        if (meta?.bandage) return; // channel handled separately
        if (item.toolClass === "knife") {
            // Skinning is click-on-corpse; Space still attacks with the knife
        }
        // Firestarter weapons: Space near piles/unlit fire lights; otherwise attack
        if (meta?.use === "light_fire" && this.scene.canUseFirestarter?.()) {
            this.scene.tryUseFirestarter();
            this._blockSpaceAutofire = true;
            return;
        }
        if (typeof Place !== "undefined" && Place.placeThingId(meta)) {
            this.scene.tryPlaceHeld?.();
            this._blockSpaceAutofire = true;
            return;
        }
        const weaponMeta = this.getHeldWeaponMeta();
        if (weaponMeta?.weapon?.type === "melee") {
            this.startMeleeAttack(weaponMeta);
        } else {
            this.startMeleeAttack(null);
        }
    }

    /** Aim angle toward the mouse (same math as startMeleeAttack). */
    _aimAngle() {
        const pointer = this.scene.input.activePointer;
        const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const c = this.bodyCenter();
        const angle = Math.atan2(world.y - c.y, world.x - c.x);
        return Number.isFinite(angle) ? angle : 0;
    }

    _sendNetAttack(angle) {
        if (!this.scene.isNet || !this.scene.net?.connected) return;
        let ang = Number(angle);
        if (!Number.isFinite(ang)) ang = this._aimAngle();
        this.scene.net.sendAction({
            type: NetProtocol.Actions.ATTACK,
            angle: ang,
            pawnId: this.pawnId
        });
    }

    beginTend(patient = null, opts = {}) {
        if (this._resting) return false;
        if (this._eatChannel) this._cancelEat();
        if (this._tendChannel || this._skinChannel || this._fleshChannel || this._brainChannel || this._craftChannel || this._bodyDead || this.isAttacking()) return false;
        if (this.isVomiting()) return false;
        this.capacities = new Capacities(this.anatomy);
        if (!this.capacities.canManipulate()) return false;
        if (this.isIncapacitated()) return false;
        const sourcePawn = opts.sourcePawn || this;
        const slot = opts.slot != null
            ? opts.slot
            : (this.isControlled?.()
                ? this.scene.hotbar.activeIndex
                : (this.hotbarIndex ?? 0));
        const item = sourcePawn.inventory?.[slot] || this.getHeldItem();
        if (!item) return false;
        const meta = this.scene.getItem(item.id);
        if (!meta?.bandage) return false;
        const who = patient && patient.anatomy ? patient : this;
        let skip = typeof opts.skip === "function" ? opts.skip : null;
        if (!skip) {
            const sys = this.scene.partySys;
            if (sys?._reservedTendKeys && sys?._woundIsReserved) {
                const reserved = sys._reservedTendKeys(this);
                skip = (spec) => sys._woundIsReserved(reserved, who, spec);
            }
        }
        const budget = Number(meta.bandage.batchSeverity);
        const pickOpts = skip
            ? { skip, batchSeverity: budget }
            : { batchSeverity: budget };
        let targets = BodyHealing.pickTendTargets?.(who.anatomy, pickOpts)
            || [];
        if (!targets.length) {
            const one = opts.target && (opts.target.inj || opts.target.destroyed) && !skip?.(opts.target)
                ? opts.target
                : BodyHealing.pickTendTarget(who.anatomy, skip ? { skip } : undefined);
            if (one) targets = [one];
        }
        if (!targets.length) {
            if (!opts.silent) {
                const claimed = skip && BodyHealing.pickTendTarget(who.anatomy);
                this.scene.combatLog?.push(
                    claimed ? "That wound is already being bandaged" : "Nothing to bandage"
                );
            }
            return false;
        }
        const target = targets[0];
        const targetHints = targets.map((t) => BodyHealing.tendTargetHint?.(t)).filter(Boolean);
        const seconds = Number(meta.bandage.channelSeconds) || 5;
        // Manipulation slows/speeds tending the same way Eating slows/speeds food.
        const scale = this.capacities.manipulationDurationScale();
        const max = seconds * 1000 * scale;
        this._tendChannel = {
            remaining: max,
            max,
            slot,
            sourcePawn,
            patient: who,
            // Locked at start so natural healing mid-channel doesn't retarget/cancel
            target,
            targets,
            targetHint: targetHints[0] || null,
            targetHints,
            // Base + max from item; actual quality rolled when the channel finishes
            qualityBase: Number(meta.bandage.tendQuality) || 0.4,
            qualityMax: Number(meta.bandage.tendQualityMax) || 0.7,
            itemId: item.id
        };
        if (this.isControlled?.()) this.scene.showChannelBar?.(0);
        else {
            this.setVelocity?.(0, 0);
            this.isSprinting = false;
        }
        return true;
    }

    /**
     * Start skinning a corpse with a held knife (5s channel, cancel if you swap off / walk away).
     */
    beginSkin(corpse) {
        if (this._eatChannel) this._cancelEat();
        if (this._tendChannel || this._skinChannel || this._fleshChannel || this._brainChannel || this._craftChannel || this._bodyDead || this.isAttacking()) return false;
        if (this.isVomiting()) return false;
        this.capacities = new Capacities(this.anatomy);
        if (!this.capacities.canManipulate()) return false;
        if (this.isIncapacitated()) return false;
        if (!corpse?.entry || corpse.entry.skinned || corpse.entry.stage === "carcass") return false;
        if (!corpse.inRange?.()) return false;
        const item = this.getHeldItem();
        if (!item || item.toolClass !== "knife") return false;

        // Close loot UI while skinning
        if (this.scene.corpsePanel?.visible) this.scene.corpsePanel.close();

        const seconds = 5;
        // Manipulation slows/speeds skinning the same way Eating slows/speeds food.
        const scale = this.capacities.manipulationDurationScale();
        const quality = typeof knapQualityDurationScale === "function"
            ? knapQualityDurationScale(item.knapQuality)
            : 1;
        const max = seconds * 1000 * scale * quality;
        this._skinChannel = {
            remaining: max,
            max,
            slot: this.isControlled?.()
                ? this.scene.hotbar.activeIndex
                : (this.hotbarIndex ?? 0),
            corpse,
            itemId: item.id
        };
        this.scene.showChannelBar?.(0);
        return true;
    }

    _cancelSkin() {
        if (!this._skinChannel) return;
        this._skinChannel = null;
        this.scene.hideChannelBar?.();
    }

    _tickSkin(delta) {
        if (!this._skinChannel) return;
        const slot = this.scene.hotbar.activeIndex;
        const held = this.getHeldItem();
        const corpse = this._skinChannel.corpse;
        if (
            slot !== this._skinChannel.slot
            || !held
            || held.toolClass !== "knife"
            || !corpse?.active
            || corpse.entry?.skinned
            || corpse.entry?.stage === "carcass"
            || !corpse.inRange?.()
        ) {
            this._cancelSkin();
            return;
        }
        this._skinChannel.remaining -= delta;
        const prog = 1 - this._skinChannel.remaining / this._skinChannel.max;
        this.scene.showChannelBar?.(Phaser.Math.Clamp(prog, 0, 1));
        if (this._skinChannel.remaining > 0) return;

        // Dedicated MP: server owns skinned + butcher loot (snapshots would stomp local applySkin).
        if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
            this.scene._netSendMove?.(true);
            this.scene.net.sendAction({
                type: NetProtocol.Actions.CORPSE_SKIN,
                corpseId: corpse.entry?.id,
                x: this.x,
                y: this.y
            });
        } else {
            corpse.applySkin?.();
            this.wearHeld(1);
        }
        this._skinChannel = null;
        this.scene.hideChannelBar?.();
        if (this.isControlled?.()) this.scene.corpsePanel?.open?.(corpse);
    }

    /**
     * Start fleshing a raw hide on a drying rack with a held scraper.
     */
    beginFlesh(rack) {
        if (this._eatChannel) this._cancelEat();
        if (this._tendChannel || this._skinChannel || this._fleshChannel || this._brainChannel || this._craftChannel || this._bodyDead || this.isAttacking()) {
            return false;
        }
        if (this.isVomiting()) return false;
        this.capacities = new Capacities(this.anatomy);
        if (!this.capacities.canManipulate()) return false;
        if (this.isIncapacitated()) return false;
        if (!rack?.entry || !rack.inRange?.()) return false;
        const item = this.getHeldItem();
        if (!item || item.toolClass !== "scraper") return false;
        if (typeof Hide === "undefined") return false;
        const stack = rack.getSlot?.(0);
        const meta = stack ? this.scene.getItem(stack.id) : null;
        if (!Hide.canScrape(meta)) return false;

        if (this.scene.storagePanel?.visible) this.scene.storagePanel.close();

        const seconds = Hide.FLESH_SECONDS || 10;
        const scale = this.capacities.manipulationDurationScale();
        const quality = typeof knapQualityDurationScale === "function"
            ? knapQualityDurationScale(item.knapQuality)
            : 1;
        const max = seconds * 1000 * scale * quality;
        this._fleshChannel = {
            remaining: max,
            max,
            slot: this.scene.hotbar.activeIndex,
            rack,
            itemId: item.id
        };
        this.scene.showChannelBar?.(0);
        return true;
    }

    _cancelFlesh() {
        if (!this._fleshChannel) return;
        this._fleshChannel = null;
        this.scene.hideChannelBar?.();
    }

    _tickFlesh(delta) {
        if (!this._fleshChannel) return;
        const slot = this.scene.hotbar.activeIndex;
        const held = this.getHeldItem();
        const rack = this._fleshChannel.rack;
        const stack = rack?.getSlot?.(0);
        const meta = stack ? this.scene.getItem(stack.id) : null;
        if (
            slot !== this._fleshChannel.slot
            || !held
            || held.toolClass !== "scraper"
            || !rack?.active
            || !rack.inRange?.()
            || typeof Hide === "undefined"
            || !Hide.canScrape(meta)
        ) {
            this._cancelFlesh();
            return;
        }
        this._fleshChannel.remaining -= delta;
        const prog = 1 - this._fleshChannel.remaining / this._fleshChannel.max;
        this.scene.showChannelBar?.(Phaser.Math.Clamp(prog, 0, 1));
        if (this._fleshChannel.remaining > 0) return;

        if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
            this.scene._netSendMove?.(true);
            this.scene.net.sendAction({
                type: NetProtocol.Actions.RACK_FLESH,
                uid: rack.entry?.uid,
                x: this.x,
                y: this.y
            });
        } else {
            const now = this.scene.worldMinuteIndex?.() ?? null;
            const next = Hide.scrapeStackFrom(stack, (id) => this.scene.getItem(id), now);
            if (next) rack.setSlot(0, next);
            this.wearHeld(1);
        }
        this._fleshChannel = null;
        this.scene.hideChannelBar?.();
    }

    /**
     * Rub brains into a dehaired hide hanging on a drying rack.
     */
    beginBrain(rack) {
        if (this._eatChannel) this._cancelEat();
        if (this._tendChannel || this._skinChannel || this._fleshChannel || this._brainChannel || this._craftChannel || this._bodyDead || this.isAttacking()) {
            return false;
        }
        if (this.isVomiting()) return false;
        this.capacities = new Capacities(this.anatomy);
        if (!this.capacities.canManipulate()) return false;
        if (this.isIncapacitated()) return false;
        if (!rack?.entry || !rack.inRange?.()) return false;
        const item = this.getHeldItem();
        if (!item) return false;
        if (typeof Hide === "undefined") return false;
        const heldMeta = this.scene.getItem(item.id);
        if (!Hide.isBrainItem(heldMeta)) return false;
        const stack = rack.getSlot?.(0);
        const meta = stack ? this.scene.getItem(stack.id) : null;
        if (!Hide.isDehairedHide(meta)) return false;

        if (this.scene.storagePanel?.visible) this.scene.storagePanel.close();

        const seconds = Hide.BRAIN_SECONDS || 10;
        const scale = this.capacities.manipulationDurationScale();
        const max = seconds * 1000 * scale;
        this._brainChannel = {
            remaining: max,
            max,
            slot: this.scene.hotbar.activeIndex,
            rack,
            itemId: item.id
        };
        this.scene.showChannelBar?.(0);
        return true;
    }

    _cancelBrain() {
        if (!this._brainChannel) return;
        this._brainChannel = null;
        this.scene.hideChannelBar?.();
    }

    _tickBrain(delta) {
        if (!this._brainChannel) return;
        const slot = this.scene.hotbar.activeIndex;
        const held = this.getHeldItem();
        const rack = this._brainChannel.rack;
        const stack = rack?.getSlot?.(0);
        const meta = stack ? this.scene.getItem(stack.id) : null;
        const heldMeta = held ? this.scene.getItem(held.id) : null;
        if (
            slot !== this._brainChannel.slot
            || !held
            || typeof Hide === "undefined"
            || !Hide.isBrainItem(heldMeta)
            || !rack?.active
            || !rack.inRange?.()
            || !Hide.isDehairedHide(meta)
        ) {
            this._cancelBrain();
            return;
        }
        this._brainChannel.remaining -= delta;
        const prog = 1 - this._brainChannel.remaining / this._brainChannel.max;
        this.scene.showChannelBar?.(Phaser.Math.Clamp(prog, 0, 1));
        if (this._brainChannel.remaining > 0) return;

        if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
            this.scene._netSendMove?.(true);
            this.scene.net.sendAction({
                type: NetProtocol.Actions.RACK_BRAIN,
                uid: rack.entry?.uid,
                x: this.x,
                y: this.y
            });
        } else {
            const now = this.scene.worldMinuteIndex?.() ?? null;
            const next = Hide.brainedStackFrom(stack, (id) => this.scene.getItem(id), now);
            if (next) rack.setSlot(0, next);
            this.loseItem(held, 1);
        }
        this._brainChannel = null;
        this.scene.hideChannelBar?.();
    }

    /**
     * Timed station craft with a held tool (awl). Cancel if you swap / walk away.
     */
    beginCraft(recipe, station) {
        if (this._eatChannel) this._cancelEat();
        if (this._tendChannel || this._skinChannel || this._fleshChannel || this._brainChannel || this._craftChannel || this._bodyDead || this.isAttacking()) {
            return false;
        }
        if (this.isVomiting()) return false;
        this.capacities = new Capacities(this.anatomy);
        if (!this.capacities.canManipulate()) return false;
        if (this.isIncapacitated()) return false;
        if (!station?.active || !station.inRange?.()) return false;
        if (!this.scene.canCraft?.(recipe)) return false;
        const item = this.getHeldItem();
        const wantClass = recipe.requireTool?.toolClass;
        if (wantClass && (!item || item.toolClass !== wantClass)) return false;

        const seconds = Math.max(0.1, Number(recipe.craftSeconds) || 1);
        const scale = this.capacities.manipulationDurationScale();
        const quality = typeof knapQualityDurationScale === "function"
            ? knapQualityDurationScale(item?.knapQuality)
            : 1;
        const material = typeof knapMaterialDurationScale === "function"
            ? knapMaterialDurationScale(item?.knapMaterial)
            : 1;
        const max = seconds * 1000 * scale * quality * material;
        this._craftChannel = {
            remaining: max,
            max,
            slot: this.scene.hotbar.activeIndex,
            station,
            recipe,
            toolClass: wantClass || null
        };
        this.scene.showChannelBar?.(0);
        return true;
    }

    _cancelCraft() {
        if (!this._craftChannel) return;
        this._craftChannel = null;
        this.scene.hideChannelBar?.();
    }

    _tickCraft(delta) {
        if (!this._craftChannel) return;
        const slot = this.scene.hotbar.activeIndex;
        const held = this.getHeldItem();
        const station = this._craftChannel.station;
        const recipe = this._craftChannel.recipe;
        const wantClass = this._craftChannel.toolClass;
        if (
            slot !== this._craftChannel.slot
            || (wantClass && (!held || held.toolClass !== wantClass))
            || !station?.active
            || !station.inRange?.()
        ) {
            this._cancelCraft();
            return;
        }
        this._craftChannel.remaining -= delta;
        const prog = 1 - this._craftChannel.remaining / this._craftChannel.max;
        this.scene.showChannelBar?.(Phaser.Math.Clamp(prog, 0, 1));
        if (this._craftChannel.remaining > 0) return;

        this._craftChannel = null;
        this.scene.hideChannelBar?.();
        this.scene._finishCraft?.(recipe);
        this.scene.hotbar && (this.scene.hotbar.dirty = true);
        this.scene.refreshCraftMenu?.();
        this.scene.refreshTooltip?.();
    }

    _cancelTend() {
        if (!this._tendChannel) return;
        this._tendChannel = null;
        if (this.isControlled?.()) this.scene.hideChannelBar?.();
    }

    _tickTend(delta) {
        if (!this._tendChannel) return;
        const ch = this._tendChannel;
        // Skinning reused this channel historically; don't treat a knife job as a bandage.
        if (ch.corpse) return;
        if (this.isAttacking?.()) {
            this._cancelTend();
            return;
        }
        const src = ch.sourcePawn || this;
        const slot = this.isControlled?.() && src === this
            ? this.scene.hotbar.activeIndex
            : (ch.slot ?? this.hotbarIndex ?? 0);
        if (this.isControlled?.() && src === this && slot !== ch.slot) {
            this._cancelTend();
            return;
        }
        const held = src.inventory?.[slot];
        if (!held || held.id !== ch.itemId) {
            this._cancelTend();
            return;
        }
        const patient = ch.patient || this;
        if (patient !== this && patient?.active) {
            const P = typeof Party !== "undefined" ? Party : null;
            if (P && !P.inInteractRange(this, patient, this.scene.tileSize)) {
                this._cancelTend();
                return;
            }
        }
        ch.remaining -= delta;
        const prog = 1 - ch.remaining / ch.max;
        if (this.isControlled?.()) this.scene.showChannelBar?.(Phaser.Math.Clamp(prog, 0, 1));
        if (ch.remaining > 0) return;

        const hints = Array.isArray(ch.targetHints) && ch.targetHints.length
            ? ch.targetHints
            : [ch.targetHint || ch.target];
        const body = patient.anatomy || this.anatomy;
        const hintPayload = (h) => ({
            partName: h?.partName || h?.part?.name || null,
            injuryIndex: h?.injuryIndex,
            injuryId: h?.injuryId ?? h?.inj?.id,
            injuryName: h?.injuryName || h?.inj?.name || null,
            injurySeverity: h?.injurySeverity ?? h?.inj?.severity,
            destroyedPartName: h?.destroyedPartName || h?.destroyed?.partName || null
        });

        // Dedicated MP: server applies tend + consumes bandage (YOU syncs body/inv).
        if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
            const first = hintPayload(hints[0] || {});
            this.scene._netSendMove?.(true);
            this.scene.net.sendAction({
                type: NetProtocol.Actions.TEND,
                itemId: ch.itemId,
                pawnId: this.pawnId || null,
                patientId: patient.pawnId || null,
                fromPawnId: src.pawnId || null,
                slot,
                ...first,
                targets: hints.map(hintPayload)
            });
            this._tendChannel = null;
            if (this.isControlled?.()) this.scene.hideChannelBar?.();
            return;
        }

        const applied = [];
        for (const hint of hints) {
            const resolved = BodyHealing.resolveTendTarget?.(body, hint)
                || (BodyHealing.isTendTargetValid(body, hint) ? hint : null);
            if (resolved) applied.push(resolved);
        }
        if (!applied.length) {
            // Wound closed on its own — finish the channel, keep the bandage
            const healer = this.isControlled?.() ? "you" : this.displayName();
            this.scene.combatLog?.push(`The wound healed before ${healer} finished`);
            this._tendChannel = null;
            if (this.isControlled?.()) this.scene.hideChannelBar?.();
            this.scene.healthPanel?.refresh?.();
            return;
        }

        const quality = BodyHealing.rollTendQuality(
            ch.qualityBase,
            ch.qualityMax
        );
        for (const t of applied) BodyHealing.applyTend(body, t, quality);
        if (typeof src.loseItemAt === "function") src.loseItemAt(ch.slot, 1);
        else this.loseAnyItem(ch.itemId, 1);
        const who = this.isControlled?.() ? "You" : this.displayName();
        const poss = patient.isControlled?.() ? "your" : `${patient.displayName()}'s`;
        const tendMsg = BodyHealing.tendLogLine?.(who, poss, quality, applied, body)
            || `${who} finished bandaging (${Math.round(quality * 100)}%)`;
        this.scene.combatLog?.push(tendMsg);
        this._tendChannel = null;
        if (this.isControlled?.()) this.scene.hideChannelBar?.();
        this.scene.healthPanel?.refresh?.();
        this.scene.hotbar.dirty = true;
    }

    /** Dynamic coconut meals leave leftover kcal on the stack; other food is consumed whole. */
    _isPartialFood(item) {
        return !!(item?.customName || item?.ingredients?.length);
    }

    /**
     * Resolve eat duration in seconds for a food stack.
     * Meals without eatSeconds use clamp(1.5 + kc/150, 2, 8).
     * Fallback: clamp(1 + kc/120, 1, 6).
     */
    _eatSecondsFor(food, isMeal) {
        const explicit = Number(food?.eatSeconds);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        const kc = Math.max(0, Number(food?.kc) || 0);
        if (isMeal) return Phaser.Math.Clamp(1.5 + kc / 150, 2, 8);
        return Phaser.Math.Clamp(1 + kc / 120, 1, 6);
    }

    beginEat(item, opts = {}) {
        const patient = opts.patient && opts.patient !== this ? opts.patient : null;
        if (patient) {
            if (this._eatChannel) this._cancelEat();
            if (this._tendChannel && !this._tendChannel.corpse) this._cancelTend?.();
        }
        if (this._tendChannel || this._skinChannel || this._fleshChannel || this._brainChannel || this._craftChannel || this._eatChannel || this._bodyDead || this.isAttacking()) {
            return false;
        }
        if (this.isVomiting() || this.isIncapacitated()) return false;
        if (patient && (patient.isBodyDead?.() || !patient.active)) return false;
        const meta = this.scene.getItem(item.id);
        const food = item.food || meta?.food;
        const total = Number(food?.kc ?? 0);
        if (!(total > 0)) return false;
        const isMeal = this._isPartialFood(item);
        const who = patient || this;
        const room = who.stomach - who.kc;
        if (isMeal && !(room > 0)) return false;

        // Dedicated MP: server owns hunger + food stacks.
        const partyEat = !!(opts.sourcePawn || opts.slot != null || patient);
        const dedicated = !!(this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal);
        const serverAuth = !!opts.serverAuth || dedicated;
        if (serverAuth && dedicated && !partyEat) {
            this.scene._netSendMove?.(true);
            this.scene.net.sendAction({ type: NetProtocol.Actions.USE, pawnId: this.pawnId });
        }

        this.capacities = new Capacities(this.anatomy);
        const seconds = this._eatSecondsFor(food, isMeal);
        const scale = this.capacities.eatingDurationScale();
        const max = seconds * 1000 * scale;
        const sourcePawn = opts.sourcePawn || this;
        const slot = opts.slot != null
            ? opts.slot
            : (this.isControlled?.() ? this.scene.hotbar.activeIndex : (this.hotbarIndex ?? 0));
        this._eatChannel = {
            remaining: max,
            max,
            slot,
            sourcePawn,
            patient,
            item,
            itemId: item.id,
            isMeal,
            serverAuth
        };
        if (this.isControlled?.()) this.scene.showChannelBar?.(0);
        return true;
    }

    _cancelEat() {
        if (!this._eatChannel) return;
        const serverAuth = !!this._eatChannel.serverAuth;
        this._eatChannel = null;
        if (this.isControlled?.()) this.scene.hideChannelBar?.();
        if (serverAuth && this.isControlled?.() && this.scene.net?.connected && !this.scene.net.isLocal) {
            this.scene.net.sendAction({ type: NetProtocol.Actions.CANCEL_CHANNEL, pawnId: this.pawnId });
        }
    }

    _tickEat(delta) {
        if (!this._eatChannel) return;
        if (this.isVomiting() || this._bodyDead) {
            this._cancelEat();
            return;
        }
        const patient = this._eatChannel.patient;
        if (patient) {
            if (patient.isBodyDead?.() || !patient.active) {
                this._cancelEat();
                return;
            }
            const P = typeof Party !== "undefined" ? Party : null;
            if (P && !P.inInteractRange(this, patient, this.scene.tileSize)) {
                this._cancelEat();
                return;
            }
        } else if (this.isIncapacitated()) {
            this._cancelEat();
            return;
        }

        // Dedicated MP: server owns channel progress + nutrition (EVENT/YOU).
        // Don't compare stack object identity — YOU replaces inventory arrays every sync.
        const src = this._eatChannel.sourcePawn || this;
        const fromSelf = src === this;
        const slot = this.isControlled?.() && fromSelf
            ? this.scene.hotbar.activeIndex
            : (this._eatChannel.slot ?? this.hotbarIndex ?? 0);
        if (this.isControlled?.() && fromSelf && slot !== this._eatChannel.slot) {
            this._cancelEat();
            return;
        }
        if (this._eatChannel.serverAuth && fromSelf && this.isControlled?.()) {
            const held = this.getHeldItem();
            if (!held || held.id !== this._eatChannel.itemId) {
                this._cancelEat();
                return;
            }
            this._eatChannel.item = held;
            return;
        }

        const held = src.inventory?.[slot] || null;
        if (
            !held
            || held.id !== this._eatChannel.itemId
        ) {
            this._cancelEat();
            return;
        }
        this._eatChannel.item = held;
        const meta = this.scene.getItem(held.id);
        const food = held.food || meta?.food;
        if (!(Number(food?.kc ?? 0) > 0)) {
            this._cancelEat();
            return;
        }

        this._eatChannel.remaining -= delta;
        const prog = 1 - this._eatChannel.remaining / this._eatChannel.max;
        if (this.isControlled?.()) this.scene.showChannelBar?.(Phaser.Math.Clamp(prog, 0, 1));
        if (this._eatChannel.remaining > 0) return;

        this.finishEat(held);
    }

    /**
     * Apply nutrition at end of eat channel.
     * Normal foods: always consume 1, satiety from full item kc, stomach fill up to cap.
     * Partial meals: leftovers on stack, satiety only for kcal that fit.
     */
    finishEat(item) {
        const serverAuth = !!this._eatChannel?.serverAuth;
        const sourcePawn = this._eatChannel?.sourcePawn || this;
        const patient = this._eatChannel?.patient || null;
        const slot = this._eatChannel?.slot;
        this._eatChannel = null;
        if (this.isControlled?.()) this.scene.hideChannelBar?.();
        const dedicated = this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal;
        if (dedicated && patient) {
            this.scene._netSendMove?.(true);
            this.scene.net.sendAction({
                type: NetProtocol.Actions.FEED,
                patientId: patient.pawnId || null,
                fromPawnId: sourcePawn.pawnId || this.pawnId || null,
                slot,
                itemId: item?.id
            });
            return;
        }
        // Dedicated MP: server already applied nutrition + consumed the stack (YOU syncs).
        if (serverAuth) return;
        const who = patient || this;
        const meta = this.scene.getItem(item.id);
        const food = item.food || meta?.food;
        const total = Number(food?.kc ?? 0);
        if (!(total > 0)) return;

        const isMeal = this._isPartialFood(item);
        const room = Math.max(0, who.stomach - who.kc);

        if (isMeal) {
            const consumed = Math.min(total, room);
            if (!(consumed > 0)) return;
            who.kc += consumed;
            who.saturation += consumed * this._satietyRatio(food, meta, true);
            who._tryFoodPoison?.(food, meta);
            if (consumed >= total) {
                sourcePawn.loseItem(item);
            } else {
                if (!item.food) item.food = { ...(meta?.food || {}) };
                if (item.food.kcFull == null) item.food.kcFull = Math.round(total);
                item.food.kc = Math.max(0, Math.round(total - consumed));
                if (item.food.kc <= 0) sourcePawn.loseItem(item);
            }
        } else {
            // Full satiety even if stomach was already full (overflow discarded)
            who.kc += Math.min(total, room);
            who.saturation += total * this._satietyRatio(food, meta, false);
            who._tryFoodPoison?.(food, meta);
            sourcePawn.loseItem(item);
        }
        this.scene.hotbar.dirty = true;
        this.scene.partyPanel?.refresh?.();
    }

    useItem(item) {
        if (this.isVomiting()) return null;
        const meta = this.scene.getItem(item.id);
        // Stack-level food (dynamic meals) overrides item def
        const food = item.food || meta?.food;
        // 0 kcal foods still spoil but are not edible
        if (food && Number(food.kc ?? 0) > 0) {
            this.beginEat(item);
            return "use";
        }
        if (meta?.bandage) {
            this.beginTend();
            return "use";
        }
        if (typeof Place !== "undefined" && Place.placeThingId(meta)) {
            this.scene.tryPlaceHeld?.();
            return "use";
        }
        // Melee + firestarter (sharp stick): light when aiming at piles / unlit fire
        if (meta?.use === "light_fire" && this.scene.canUseFirestarter?.()) {
            this.scene.tryUseFirestarter();
            return "use";
        }
        const weaponMeta = this.getHeldWeaponMeta();
        if (weaponMeta?.weapon?.type === "melee") {
            this.startMeleeAttack(weaponMeta);
            return "attack";
        }
        if (meta?.weapon?.type === "ranged") {
            return null;
        }
        if (meta.use === "light_fire") {
            this.scene.tryUseFirestarter();
            return "use";
        }
        return null;
    }

    getInventoryWeight() {
        if (typeof Carry !== "undefined") {
            return Carry.gearMass(
                this.inventory,
                this.equipment,
                (id) => this.scene.getItem(id)
            );
        }
        let total = 0;
        for (const stack of this.inventory) {
            if (!stack) continue;
            const meta = this.scene.getItem(stack.id);
            const knap = !!(stack.toolClass || stack.knapMaterial);
            const w = knap
                ? (meta?.weight ?? 0)
                : (stack.weight != null ? stack.weight : meta.weight);
            total += (Number(w) || 0) * stack.quantity;
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
            const knap = !!(stack.toolClass || stack.knapMaterial);
            const w = knap
                ? (meta?.weight ?? 0)
                : (stack.weight != null ? stack.weight : meta.weight);
            total += (Number(w) || 0) * stack.quantity;
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

    /**
     * Dedicated MP: uncontrolled party members follow server poses.
     * Linear interp across the snapshot interval (same as net mobs) so they
     * don't idle-then-step every 15 Hz tick.
     */
    _puppetFromNet(delta) {
        const tx = this._netTx;
        const ty = this._netTy;
        this.setVelocity?.(0, 0);
        this.isSprinting = false;
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
        const downed = !!(
            this._netProne
            || this._downed
            || this._prone
            || this.isImmobile?.()
            || this.isIncapacitated?.()
        );
        if (this._resting) {
            this.setVelocity?.(0, 0);
            this._iceVx = 0;
            this._iceVy = 0;
            if (Number.isFinite(tx) && Number.isFinite(ty)) {
                this.x = tx;
                this.y = ty;
            }
            setCreatureRest?.(this, true, this.lastSleep?.rot);
            return;
        }
        if (downed) {
            this.facing = "right";
            // Server pose is feet-anchored. Apply it first, then origin shift.
            if (this._prone) {
                const w = this.width || 16;
                const h = this.height || 16;
                this.x = tx + w * 0.5;
                this.y = ty - h * 0.5;
            } else {
                this.x = tx;
                this.y = ty;
            }
            this._puppetMoving = false;
            this.setVelocity?.(0, 0);
            this._iceVx = 0;
            this._iceVy = 0;
            if (typeof setCreatureProne === "function") setCreatureProne(this, true);
            else {
                this.anims?.stop?.();
                if (this.texture?.frameTotal > 7) this.setFrame(7);
            }
            return;
        }
        const fromX = Number.isFinite(this._netFromX) ? this._netFromX : this.x;
        const fromY = Number.isFinite(this._netFromY) ? this._netFromY : this.y;
        const err = Math.hypot(tx - fromX, ty - fromY);
        if (this.isAttacking()) {
            this.x = tx;
            this.y = ty;
        } else if (err > 72 || !Number.isFinite(this._netSnapAt)) {
            this.x = tx;
            this.y = ty;
        } else {
            const snapDt = this._netSnapDt || (1000 / 15);
            const age = performance.now() - this._netSnapAt;
            let u = snapDt > 0 ? age / snapDt : 1;
            if (u > 1) u = 1;
            this.x = fromX + (tx - fromX) * u;
            this.y = fromY + (ty - fromY) * u;
        }
        // Walk/idle from the snapshot's server-to-server travel (constant for
        // the whole 15 Hz interval). Per-frame pixel delta flickers because
        // render snapping moves 1px some frames and 0 the next.
        const snapDist = Number.isFinite(this._netSnapDist) ? this._netSnapDist : err;
        const wantWalk = !this.isAttacking()
            && (this._netMoving === true || snapDist > 1);
        if (wantWalk) {
            this._puppetMoving = true;
            this._puppetStillMs = 0;
        } else {
            this._puppetStillMs = (this._puppetStillMs || 0) + (delta || 16);
            if (this._puppetStillMs > 100) this._puppetMoving = false;
        }
        const moving = !!this._puppetMoving;
        if (moving) {
            const dx = tx - fromX;
            const dy = ty - fromY;
            if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
                if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? "right" : "left";
                else this.facing = dy > 0 ? "down" : "up";
            }
        } else if (this._netFacing) {
            this.facing = this._netFacing;
        }
        if (this.anims) this.anims.timeScale = 1;
        if (typeof PlayerLook !== "undefined") {
            PlayerLook.play(this, this.facing || "down", moving);
        }
    }

    update(time, delta) {
        if (this._bodyDead) {
            this.setVelocity(0, 0);
            return;
        }
        if (this.role === "wanderer") return;

        const dt = delta || (this.scene.game.loop.delta || 16);
        const paused = !!this.scene._gamePaused;
        const composing = !!this.scene.combatLog?.isComposing?.();
        const knapping = !!this.scene.knappingPanel?.visible;
        const controlled = this.isControlled?.();

        // SP pause freezes everyone; channels still finish if we got here in MP.
        if (paused) {
            this.setVelocity(0, 0);
            this.isSprinting = false;
            if (this._tendChannel) this._tickTend(dt);
            if (this._skinChannel) this._tickSkin(dt);
            if (this._fleshChannel) this._tickFlesh(dt);
            if (this._brainChannel) this._tickBrain(dt);
            if (this._craftChannel) this._tickCraft(dt);
            if (this._eatChannel) this._tickEat(dt);
            this._tickChopBar();
            this._tickVomit(dt);
            this.syncSortDepth();
            this.syncFxRoot?.();
            return;
        }

        if (this._tendChannel) this._tickTend(dt);
        if (this._skinChannel) this._tickSkin(dt);
        if (this._fleshChannel) this._tickFlesh(dt);
        if (this._brainChannel) this._tickBrain(dt);
        if (this._craftChannel) this._tickCraft(dt);
        if (this._eatChannel) this._tickEat(dt);
        this._tickChopBar();
        this._tickVomit(dt);

        this.capacities = new Capacities(this.anatomy);
        this._refreshDownedState();
        if (this._bodyDead) return;

        if (!controlled) {
            const dedicated = !!(this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal);
            if (dedicated) {
                const tendLock = !!(this._tendChannel && !this._tendChannel.corpse)
                    || !!this.scene.partySys?._isBeingTended?.(this);
                const prone = !!(
                    this._netProne
                    || this._downed
                    || this.isImmobile?.()
                    || this.isIncapacitated?.()
                );
                if (tendLock) this.setVelocity?.(0, 0);
                else this._puppetFromNet(dt);
                if (this._resting) {
                    if (typeof pinRestingCreature === "function") pinRestingCreature(this, this.scene);
                    else setCreatureRest?.(this, true, this.lastSleep?.rot);
                } else if (typeof setCreatureProne === "function") {
                    setCreatureProne(this, prone && !this._bodyDead);
                }
                if (this.isAttacking()) {
                    const progress = this._attackProgress();
                    if (this.weaponSprite?.visible) this._updateWeaponSprite(progress);
                    if (this.unarmedSprite?.visible) this._updateUnarmedSprite(progress);
                    this.attackTimer -= dt;
                    if (this.attackTimer <= 0) this._endAttack();
                }
                this.syncSortDepth();
                this.syncFxRoot?.();
                this.syncNameLabel?.();
                this._syncChatBubble?.();
                return;
            }
            if (this.isAttacking()) {
                const progress = this._attackProgress();
                if (this.weaponSprite?.visible) this._updateWeaponSprite(progress);
                if (this.unarmedSprite?.visible) this._updateUnarmedSprite(progress);
                this._meleeHitCheck(progress);
                this.attackTimer -= dt;
                if (this.attackTimer <= 0) this._endAttack();
            }
            this.partyAI?.update(dt);
            if (this.body && !this._resting) {
                const canWalk = !this.isIncapacitated() && !this.isImmobile() && !this.isVomiting();
                this.body.moves = canWalk;
            }
            if (this._resting && typeof pinRestingCreature === "function") {
                pinRestingCreature(this, this.scene);
            } else {
                this.syncSortDepth();
            }
            this.syncFxRoot?.();
            this.syncNameLabel?.();
            this._syncChatBubble?.();
            return;
        }

        if (composing || knapping) {
            this.setVelocity(0, 0);
            this.syncSortDepth();
            this.syncFxRoot?.();
            return;
        }

        const incapacitated = this.isIncapacitated();
        const immobile = this.isImmobile();
        const vomiting = this.isVomiting();
        if (this._resting && this.cursors && this.keys) {
            const movingKeys = this.cursors.left.isDown || this.keys.A.isDown
                || this.cursors.right.isDown || this.keys.D.isDown
                || this.cursors.up.isDown || this.keys.W.isDown
                || this.cursors.down.isDown || this.keys.S.isDown;
            if (movingKeys) this.scene._tryWakePlayer?.();
        }
        const resting = !!this._resting;
        const restWalk = !!this._restWalk;
        const prone = immobile || incapacitated || resting;
        if (this.body) {
            this.body.moves = !prone && !vomiting;
            if (prone || vomiting) {
                this.setVelocity(0, 0);
                this._iceVx = 0;
                this._iceVy = 0;
            }
        }
        if (resting) {
            if (typeof pinRestingCreature === "function") pinRestingCreature(this, this.scene);
            else setCreatureRest(this, true, this.lastSleep?.rot);
        } else setCreatureProne(this, prone);

        if (restWalk && this.cursors && this.keys) {
            const movingKeys = this.cursors.left.isDown || this.keys.A.isDown
                || this.cursors.right.isDown || this.keys.D.isDown
                || this.cursors.up.isDown || this.keys.W.isDown
                || this.cursors.down.isDown || this.keys.S.isDown;
            if (movingKeys) {
                this._restWalk = null;
                this.scene._intendedSleep?.().delete(this.pawnId);
            }
        }

        if (this._restWalk && !this._resting) {
            const spec = this._restWalk;
            const lean = this.scene.findLeanToByUid?.(spec.uid);
            const entry = lean?.entry;
            const def = entry ? this.scene.getThing(entry.id) : null;
            if (!entry || typeof Sleep === "undefined") {
                this._restWalk = null;
            } else {
                const pos = Sleep.sleeperWorldPos(entry, spec.slot, this.scene.tileSize, def);
                const d = Math.hypot(this.x - pos.x, this.y - pos.y);
                const arrive = Sleep.ARRIVE_PX || 16;
                if (d < arrive) {
                    this.scene._occupySlot?.(this, entry, spec.slot);
                } else {
                    const len = d || 1;
                    const speed = this.speed * this.scene.tileSize
                        * Math.max(0.05, Math.min(1.5, this.capacities?.moving?.() || 1));
                    applyEntityVelocity(
                        this,
                        ((pos.x - this.x) / len) * speed,
                        ((pos.y - this.y) / len) * speed,
                        delta,
                        this.scene
                    );
                    this.syncSortDepth();
                    this.syncFxRoot?.();
                    this.syncNameLabel?.();
                    return;
                }
            }
        }

        // Movement — no crawling; immobile / incapacitated / vomiting stay put
        const skipMove = !!this._skipMove;
        this._skipMove = false;
        let x = 0, y = 0;
        if (!prone && !vomiting && !restWalk && !skipMove && this.cursors && this.keys) {
            const left  = this.cursors.left.isDown  || this.keys.A.isDown;
            const right = this.cursors.right.isDown || this.keys.D.isDown;
            const up    = this.cursors.up.isDown    || this.keys.W.isDown;
            const down  = this.cursors.down.isDown  || this.keys.S.isDown;
            x = (right ? 1 : 0) - (left ? 1 : 0);
            y = (down ? 1 : 0) - (up ? 1 : 0);
            if (x !== 0 || y !== 0) {
                const len = Math.hypot(x, y);
                x /= len; y /= len;
            }
        }

        const encumbrance = this.getEncumbrance();
        const moving = x !== 0 || y !== 0;
        const attacking = this.isAttacking();
        const tending = !!this._tendChannel || !!this._eatChannel || !!this._fleshChannel || !!this._brainChannel || !!this._craftChannel;
        const livingLegs = this.anatomy.livingLegs();
        const canSprint = livingLegs >= 2
            && !prone
            && !vomiting
            && !tending
            && !encumbrance.cannotSprint
            && this.kc > 0;

        this.isSprinting = !attacking
            && !tending
            && !vomiting
            && moving
            && this.keys?.SHIFT?.isDown
            && canSprint;

        let moveMul = this.capacities.moving();
        if (tending) moveMul *= 0.5;
        if (attacking) moveMul *= 0.5;

        const speed = this.speed * this.scene.tileSize
            * (this.isSprinting ? this.sprintFactor : 1)
            * encumbrance.speedMultiplier
            * this.equipSpeedMultiplier
            * Math.max(0.05, Math.min(1.5, moveMul))
            * (this.scene.terrainSpeedMult?.(this.x, this.y - 1) ?? 1);
        this.anims.timeScale = this.isSprinting ? 1.5 : 1.0;

        const wantVx = (prone || vomiting) ? 0 : x * speed;
        const wantVy = (prone || vomiting) ? 0 : y * speed;
        applyEntityVelocity(this, wantVx, wantVy, delta, this.scene);
        this.syncSortDepth();

        const sliding = Math.hypot(this._iceVx ?? 0, this._iceVy ?? 0) > 12
            && !!this.scene._isIceAt?.(this.x, this.y - 1);

        if (!prone && !vomiting) {
            const walk = moving || sliding;
            if (attacking) {
                this.facing = this.facingFromAngle(this.attackAngle);
            } else if (moving) {
                if (Math.abs(x) > Math.abs(y)) this.facing = x > 0 ? "right" : "left";
                else this.facing = y > 0 ? "down" : "up";
            } else if (sliding) {
                const sx = this._iceVx || 0;
                const sy = this._iceVy || 0;
                if (Math.abs(sx) > Math.abs(sy)) this.facing = sx > 0 ? "right" : "left";
                else this.facing = sy > 0 ? "down" : "up";
            }
            if (typeof PlayerLook !== "undefined") PlayerLook.play(this, this.facing, walk);
            else this.play(walk ? `walk-${this.facing}` : `idle-${this.facing}`, true);
        }

        if (attacking) {
            const progress = this._attackProgress();
            if (this.weaponSprite?.visible) this._updateWeaponSprite(progress);
            if (this.unarmedSprite?.visible) this._updateUnarmedSprite(progress);
            this._meleeHitCheck(progress);
            this.attackTimer -= dt;
            if (this.attackTimer <= 0) this._endAttack();
        }

        if (this.keys.F.isDown) this.tryPickupNearby();

        if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) {
            const heldItem = this.getHeldItem();
            if (heldItem) {
                let amount = 1;
                if (this.keys.SHIFT.isDown) amount = heldItem.quantity;
                else if (this.keys.CTRL.isDown) amount = 10;
                if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
                    const now = this.scene.worldMinuteIndex?.() ?? null;
                    const spoilAt = spoilAtForWorld(heldItem, now);
                    const extras = mealStackExtras(heldItem);
                    this.scene._netSendMove?.(true);
                    this.scene.net.sendAction({
                        type: NetProtocol.Actions.DROP,
                        amount,
                        x: this.x,
                        y: this.y,
                        pawnId: this.pawnId,
                        stack: {
                            id: heldItem.id,
                            quantity: heldItem.quantity,
                            spoilAt,
                            ...(extras || {})
                        }
                    });
                    // Optimistic local remove — YOU snapshot reconciles
                    this.loseItemAt(this.scene.hotbar.activeIndex, amount);
                    this.scene.hotbar.dirty = true;
                    return;
                }
                const now = this.scene.worldMinuteIndex?.() ?? null;
                const spoilAt = spoilAtForWorld(heldItem, now);
                const extras = mealStackExtras(heldItem);
                const numDropped = this.loseItemAt(this.scene.hotbar.activeIndex, amount);
                DroppedItem.spawn(
                    this.scene, this.x, this.y,
                    this.scene.getItem(heldItem.id), numDropped, spoilAt, extras
                );
                this.scene.hotbar.dirty = true;
            }
        }

        if (!incapacitated && !vomiting) {
            if (!this.keys.SPACE.isDown) {
                this._blockSpaceAutofire = false;
            }
            if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
                const used = this.useHeldItem();
                // Eating / lighting / bandaging / placing: don't punch while Space is still held.
                // Melee weapons that also have `use` (sharp stick) only block when they used.
                if (used === "use") {
                    this._blockSpaceAutofire = true;
                }
            } else if (
                this.keys.SPACE.isDown &&
                !this._tendChannel &&
                !this._eatChannel &&
                !this._fleshChannel &&
                !this._brainChannel &&
                !this._craftChannel
            ) {
                // Hold Space: keep eating through a food stack (same idea as weapon autofire)
                const held = this.getHeldItem();
                const heldMeta = held ? this.scene.getItem(held.id) : null;
                const food = held?.food || heldMeta?.food;
                if (held && food && Number(food.kc ?? 0) > 0) {
                    this.beginEat(held);
                } else if (!this._blockSpaceAutofire) {
                    this.tryWeaponAutofire();
                }
            }
        }
        this.syncFxRoot?.();
        this.syncNameLabel?.();
        this._syncChatBubble?.();
    }

    /** Pick up dropped items within pickupRange (nearest first). */
    tryPickupNearby() {
        // Dedicated MP: server resolves pickup. LocalSim SP picks up from chunk.meta locally.
        if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
            const now = performance.now();
            if (now - (this._netPickupAt || 0) < 150) return;
            this._netPickupAt = now;
            const group = this.scene.droppedItems;
            if (!group) {
                this.scene.net.sendAction({ type: NetProtocol.Actions.PICKUP, pawnId: this.pawnId });
                return;
            }
            const r = this.scene.tileSize * this.pickupRange;
            const r2 = r * r;
            const nearest = group.getChildren()
                .filter(d => d?.active && d.entry?.netSync)
                .map(d => ({
                    drop: d,
                    d2: Phaser.Math.Distance.Squared(this.x, this.y, d.x, d.y)
                }))
                .filter(e => e.d2 <= r2)
                .sort((a, b) => a.d2 - b.d2)[0];
            this.scene.net.sendAction({
                type: NetProtocol.Actions.PICKUP,
                dropId: nearest?.drop?.entry?.uid || null,
                pawnId: this.pawnId
            });
            return;
        }
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
        if (typeof PlayerLook !== "undefined") {
            PlayerLook.ensureAnims(this.scene, this.texture?.key);
            return;
        }
        // Global manager so LivingMobs (and anything else) can reuse these keys
        const anims = this.scene.anims;
        if (!anims.exists("walk-down")) {
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
        }
        // Menu may have created walks + idle-down only — fill any missing idles
        if (!anims.exists("idle-down")) {
            anims.create({ key: "idle-down", frames: [{ key: "player", frame: 1 }], frameRate: 10 });
        }
        if (!anims.exists("idle-left")) {
            anims.create({ key: "idle-left", frames: [{ key: "player", frame: 4 }], frameRate: 10 });
        }
        if (!anims.exists("idle-right")) {
            anims.create({ key: "idle-right", frames: [{ key: "player", frame: 7 }], frameRate: 10 });
        }
        if (!anims.exists("idle-up")) {
            anims.create({ key: "idle-up", frames: [{ key: "player", frame: 10 }], frameRate: 10 });
        }
    }
}
