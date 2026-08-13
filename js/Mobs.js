class Mob extends Phaser.Physics.Arcade.Image {
    constructor(scene, x, y, key) {
        super(scene, x, y, key);
        this.hp = 20;
        this.mhp = 20;
    }

    /**
     * @param {Number} amount
     * @param {Object} [source]  attacker
     * @param {{ type?: string }} [opts]
     */
    takeDamage(amount, source = null, opts = null) {
        const dmg = Number(amount) || 0;
        if (!(dmg > 0) || this.hp <= 0) return 0;
        this.hp = Math.max(0, this.hp - dmg);
        if (this.hp <= 0) this.onDeath?.(source, opts);
        return dmg;
    }
}

/**
 * Data-driven living creature. `entry` is the object in chunk.meta.mobs (mutated for save).
 */
class LivingMob extends Phaser.Physics.Arcade.Sprite {
    /**
     * Spawn a mob into the world (and into the owning chunk's meta).
     * @param {Phaser.Scene} scene
     * @param {string} id  mob def id
     * @param {number} x
     * @param {number} y
     * @returns {LivingMob|null}
     */
    static spawn(scene, id, x, y) {
        const def = scene.getMob?.(id);
        if (!def) return null;

        const chunk = LivingMob.ensureChunkAt(scene, x, y - 1);
        if (!chunk) return null;
        if (!chunk.meta.mobs) chunk.meta.mobs = [];

        const entry = {
            id,
            uid: `mob-${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
            x,
            y,
            homeX: x,
            homeY: y
        };
        chunk.meta.mobs.push(entry);

        if (!chunk.isLoaded) return null;
        return new LivingMob(scene, entry, chunk);
    }

    /** Ensure a Chunk exists for world position (creates empty meta chunk if needed). */
    static ensureChunkAt(scene, wx, wy) {
        const px = scene.chunkPx();
        const cx = Math.floor(wx / px);
        const cy = Math.floor(wy / px);
        const key = scene.getKey(cx, cy);
        if (!scene.chunks[key]) {
            scene.chunks[key] = new Chunk(scene, cx, cy);
        }
        return scene.chunks[key];
    }

    /**
     * @param {Phaser.Scene} scene
     * @param {{ id: string, x: number, y: number, hp?: number }} entry
     * @param {Chunk} chunk
     */
    constructor(scene, entry, chunk) {
        const def = scene.getMob(entry.id);
        const key = def?.key || entry.id;
        super(scene, entry.x, entry.y, key, 0);

        this.entry = entry;
        this.chunk = chunk;
        this.def = def || { id: entry.id, key, speed: 1, hitboxSize: 8 };
        this.facing = "down";
        this._dead = false;
        // Home leash for wander (legacy saves: seed from current position)
        if (entry.homeX == null) entry.homeX = entry.x;
        if (entry.homeY == null) entry.homeY = entry.y;

        const planId = this.def.bodyPlan || "human";
        this.anatomy = new Body(scene, planId, this);
        if (entry.body) this.anatomy.loadJSON(entry.body);
        this.capacities = new Capacities(this.anatomy);

        const hitboxSize = Number(this.def.hitboxSize) || 8;
        this.hitboxSize = hitboxSize;

        scene.add.existing(this);
        scene.physics.add.existing(this);
        scene.mainLayer.add(this);
        this.setOrigin(0, 1);
        this.body.setSize(hitboxSize, hitboxSize)
            .setOffset((this.width - hitboxSize) / 2, hitboxSize);

        if (!scene.mobs) scene.mobs = scene.physics.add.group();
        scene.mobs.add(this);
        scene.damageables?.add(this);
        chunk.mobs.add(this);

        const AiClass = typeof MobAI !== "undefined" ? MobAI[this.def.ai] : null;
        this.ai = AiClass ? new AiClass(this) : null;
        // Restore combat aggro across save/load / chunk unload
        if (this.ai && entry.hostile) {
            this.ai.hostile = true;
            this.ai.timeSinceHitPlayer = 0;
            this.ai._deaggroTimer = 0;
        }

        this.unarmedSprite = null;
        this.attackTimer = 0;
        this.attackMax = 0;
        this.attackAngle = 0;
        this.currentAttack = null;
        this.attackWeapon = null;
        this.attackHitSet = null;

        this.on("destroy", () => {
            this._endAttack();
            this.ai?._releaseSlot?.();
            scene.meleeSlots?.release?.(this);
            if (scene._hoverTarget === this) scene._hoverTarget = null;
            if (scene._tooltipTarget === this) scene.hideTooltip();
            this.unarmedSprite?.destroy();
            this.unarmedSprite = null;
        });

        this.setInteractive({ cursor: "pointer" });
        this.on("pointerover", (pointer) => {
            const name = this.def?.name || this.def?.id || "Unknown";
            scene.showTooltip(name, pointer.x, pointer.y, this);
        });
        this.on("pointerout", () => {
            if (scene._hoverTarget === this) scene._hoverTarget = null;
            if (scene._tooltipTarget === this) scene.hideTooltip();
        });

        this.createAnimations();
        this.playAnim(`idle-${this.facing}`);
        this.setDepth(this.y);
    }

    /**
     * Walk/idle anims for this mob's texture. Keys are `{tex}-walk-down` etc.
     * so they never collide with the player's shared `walk-down` anims.
     * `def.anim.rowOrder` lists sheet rows top→bottom (default: down,left,right,up).
     */
    createAnimations() {
        const tex = this.def?.key || this.texture?.key;
        if (!tex || !this.scene?.textures?.exists(tex)) return;
        const anims = this.scene.anims;
        if (anims.exists(`${tex}-walk-down`)) return;

        const order = this.def?.anim?.rowOrder;
        const dirs = Array.isArray(order) && order.length === 4
            ? order
            : ["down", "left", "right", "up"];
        for (let row = 0; row < 4; row++) {
            const dir = dirs[row];
            const start = row * 3;
            const mid = start + 1;
            anims.create({
                key: `${tex}-walk-${dir}`,
                frames: anims.generateFrameNumbers(tex, { start, end: start + 2 }),
                // Match player walk cadence (Player.createAnimations uses 5)
                frameRate: 5,
                repeat: -1
            });
            anims.create({
                key: `${tex}-idle-${dir}`,
                frames: [{ key: tex, frame: mid }],
                frameRate: 10
            });
        }
    }

    playAnim(key) {
        if (!key) return;
        const tex = this.def?.key || this.texture?.key;
        const full = tex ? `${tex}-${key}` : key;
        if (!this.scene?.anims?.exists(full)) return;
        this.play(full, true);
    }

    isBodyDead() {
        return this._dead;
    }

    isIncapacitated() {
        // Reuse the capacities snapshot from this frame (avoid a second full body walk)
        if (!this.capacities) this.capacities = new Capacities(this.anatomy);
        return this.capacities.isPainShock() || this.capacities.isUnconscious();
    }

    displayName() {
        return this.def?.name || this.def?.id || "Someone";
    }

    getHeldWeaponMeta() {
        return null; // unarmed for now
    }

    /**
     * Unarmed fist fill. Humans (player sheet) use arm orange; others pitch black
     * unless `fistColor` is set on the mob def (hex number).
     */
    fistColor() {
        if (Number.isFinite(this.def?.fistColor)) return this.def.fistColor >>> 0;
        const key = this.def?.key || this.texture?.key;
        if (key === "player" || key === "human" || this.def?.id === "human") return 0xff8900;
        return 0x000000;
    }

    onBodyFatal() {
        this.die();
    }

    onBodyDamaged(source, _result) {
        this.capacities = new Capacities(this.anatomy);
        // anatomy.markDirty() already set; LivingMob.update syncs body JSON once/frame
        if (this._dead) return;
        // Same as player: capacity collapse (e.g. brain useless after head loss) kills now
        if (this.capacities.isDeadFromCapacities()) {
            this.onBodyFatal();
            return;
        }
        this.ai?.onDamaged?.(source);
        this.alertNearbyMobs(source);
    }

    /**
     * Hitting one animal triggers nearby AIs: scared flee, same-species pack aggro.
     * Does not re-alert (one hop) to avoid chain reactions across the map.
     */
    alertNearbyMobs(source) {
        const scene = this.scene;
        if (!scene?.mobs || !source) return;
        const ts = scene.tileSize || 16;
        const rangeTiles = 8;
        const range = rangeTiles * ts;
        const rangeSq = range * range;
        for (const other of scene.mobs.getChildren()) {
            if (!other || other === this || !other.active || other._dead) continue;
            if (typeof other.ai?.onDamaged !== "function") continue;
            const dx = other.x - this.x;
            const dy = other.y - this.y;
            if (dx * dx + dy * dy > rangeSq) continue;
            other.ai.onDamaged(source, { alert: true, victim: this });
        }
    }

    isAttacking() {
        return this.attackTimer > 0;
    }

    /**
     * Same unarmed thrust as the player (extend → hit window → retract).
     * Duration is wall-clock ms (tuned to the old 144Hz frame feel).
     * @returns {boolean} true if an attempt started
     */
    tryMeleeAttack(target, attack) {
        if (!target || !attack || this._dead || this.isIncapacitated()) return false;
        if (this.isAttacking()) return false;

        this.capacities = new Capacities(this.anatomy);
        // Same floor as player tend / melee — jaw or arms too wrecked = no swing
        if (!this.capacities.canManipulate()) return false;
        const c = this.bodyCenter();
        const tc = typeof target.bodyCenter === "function"
            ? target.bodyCenter()
            : { x: target.x, y: target.y };
        const ang = Math.atan2(tc.y - c.y, tc.x - c.x);
        const scale = this.capacities.actionDurationScale();
        const durationMs = meleeAttackDurationMs(attack.cooldown || 2, scale);

        this.currentAttack = attack;
        this.attackWeapon = {
            type: "melee",
            range: Number(attack.range) || 4,
            hitStart: 0.25,
            hitEnd: 0.75
        };
        this.attackMax = durationMs;
        this.attackTimer = durationMs;
        this.attackAngle = ang;
        this.attackHitSet = new Set();

        if (Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang))) {
            this.facing = Math.cos(ang) > 0 ? "right" : "left";
        } else {
            this.facing = Math.sin(ang) > 0 ? "down" : "up";
        }

        const fistColor = this.fistColor();
        if (!this.unarmedSprite) {
            this.unarmedSprite = this.scene.add.rectangle(c.x, c.y, 4, 10, fistColor, 1)
                .setOrigin(0.5, 1);
            this.scene.mainLayer.add(this.unarmedSprite);
        } else {
            this.unarmedSprite.setFillStyle(fistColor, 1);
        }
        this.unarmedSprite.setVisible(true);
        this._updateUnarmedSprite(0);
        return true;
    }

    _attackProgress() {
        if (this.attackMax <= 0) return 1;
        return 1 - (this.attackTimer / this.attackMax);
    }

    _updateUnarmedSprite(progress) {
        if (!this.unarmedSprite || !this.currentAttack) return;
        const range = Number(this.attackWeapon?.range) || Number(this.currentAttack.range) || 4;
        const c = this.bodyCenter();
        placeUnarmedThrustSprite(
            this.unarmedSprite, c.x, c.y, this.attackAngle, range, progress, this.y
        );
    }

    _meleeHitCheck(progress) {
        const w = this.attackWeapon;
        const attack = this.currentAttack;
        if (!w || !attack || !this.attackHitSet) return;
        const start = Number(w.hitStart ?? 0.25);
        const end = Number(w.hitEnd ?? 0.75);
        if (progress < start || progress > end) return;

        const seg = unarmedHitSegment(this.unarmedSprite, this.attackAngle);
        if (!seg) return;

        const group = this.scene.damageables;
        if (!group) return;
        const player = this.scene.player;
        for (const target of group.getChildren()) {
            if (!target || !target.active || target === this) continue;
            if (this.attackHitSet.has(target)) continue;
            if (target.isBodyDead?.()) continue;
            // Mobs only hit the player (no friendly fire on other living mobs)
            if (target !== player) continue;
            if (!meleeSegmentHitsTarget(seg.a, seg.b, 4, target)) continue;

            this.attackHitSet.add(target);
            BodyCombat.applyHit(this, target, attack);
            this.ai?.onDealtHit?.();
        }
    }

    _endAttack() {
        this.attackTimer = 0;
        this.attackMax = 0;
        this.attackWeapon = null;
        this.attackHitSet = null;
        this.currentAttack = null;
        if (this.unarmedSprite) this.unarmedSprite.setVisible(false);
    }

    _tickMeleeAttack(delta) {
        if (!this.isAttacking()) return;
        const progress = this._attackProgress();
        this._updateUnarmedSprite(progress);
        this._meleeHitCheck(progress);
        const dt = Number(delta);
        this.attackTimer -= Number.isFinite(dt) ? dt : 16;
        if (this.attackTimer <= 0) this._endAttack();
    }

    bodyCenter() {
        if (this._prone) return { x: this.x, y: this.y };
        return {
            x: this.x + this.width * 0.5,
            y: this.y - this.height * 0.5
        };
    }

    /**
     * Melee hurtbox (origin bottom-left when standing).
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
        const inset = 1;
        return {
            left: this.x + inset - pad,
            top: this.y - this.height + inset - pad,
            right: this.x + this.width - inset + pad,
            bottom: this.y - inset + pad
        };
    }

    isImmobile() {
        return !!this.capacities?.isImmobile?.();
    }

    /**
     * @param {Number} amount
     * @param {Object} [source]
     * @param {{ type?: string }} [opts]
     */
    takeDamage(amount, source = null, opts = null) {
        if (this._dead) return 0;
        if (opts?.attack) {
            const result = BodyCombat.applyHit(source, this, opts.attack, opts);
            return result?.damage || 0;
        }
        const fake = {
            damage: Number(amount) || 1,
            type: "blunt",
            verb: "struck",
            sourcePart: { name: "blow" },
            def: { variance: 0.05 },
            name: "Hit"
        };
        const result = BodyCombat.applyHit(source, this, fake, opts);
        return result?.damage || 0;
    }

    /**
     * @param {{ forceBody?: boolean }} [opts] forceBody: always write anatomy (save/unload)
     */
    syncToEntry(opts = null) {
        if (!this.entry) return;
        this.entry.x = this.x;
        this.entry.y = this.y;
        const forceBody = !!opts?.forceBody;
        if (forceBody || this.anatomy?._dirty) {
            this.entry.body = this.anatomy?.toJSON?.();
            if (this.anatomy) this.anatomy._dirty = false;
        }
        if (this.ai?.hostile) this.entry.hostile = true;
        else delete this.entry.hostile;
    }

    reassignChunkIfNeeded() {
        const scene = this.scene;
        const next = LivingMob.ensureChunkAt(scene, this.x, this.y - 1);
        if (!next || next === this.chunk) return;

        const old = this.chunk;
        if (old?.meta?.mobs) {
            const i = old.meta.mobs.indexOf(this.entry);
            if (i >= 0) old.meta.mobs.splice(i, 1);
            old.mobs?.remove(this);
        }
        if (!next.meta.mobs) next.meta.mobs = [];
        if (next.meta.mobs.indexOf(this.entry) < 0) next.meta.mobs.push(this.entry);
        this.chunk = next;

        // Unloaded destination: persist meta only (no duplicate on later makeMobs)
        if (!next.isLoaded) {
            this.syncToEntry({ forceBody: true });
            scene.damageables?.remove(this);
            scene.mobs?.remove(this);
            this.destroy();
            return;
        }
        next.mobs.add(this);
    }

    die(_source = null, _opts = null) {
        if (this._dead) return;
        this._dead = true;

        const scene = this.scene;
        const loot = [];
        const drops = this.def?.drops || [];
        for (const drop of drops) {
            const item = scene.getItem(drop.item);
            if (!item) continue;
            let qty;
            if (drop.min != null || drop.max != null) {
                const lo = Math.max(0, Math.floor(Number(drop.min ?? drop.max) || 0));
                const hi = Math.max(lo, Math.floor(Number(drop.max ?? drop.min) || 0));
                qty = Phaser.Math.Between(lo, hi);
            } else {
                qty = Number(drop.quantity) || 1;
            }
            if (qty > 0) loot.push(makeItemStack(item, qty, undefined, scene.worldMinuteIndex?.()));
        }

        // bodyCenter() respects standing (origin 0,1) and prone (origin 0.5,0.5)
        const c = this.bodyCenter();
        const key = this.def?.key || this.texture?.key || "human";
        const dedicated = !!(scene.isNet && scene.net?.connected && !scene.net.isLocal);
        const corpseId = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const corpseOpts = {
            id: corpseId,
            x: c.x,
            y: c.y,
            key,
            frame: 7,
            name: this.def?.name || "Corpse",
            loot,
            body: this.anatomy?.toJSON?.(),
            bodyPlan: this.def?.bodyPlan || this.anatomy?.planId || "human",
            mobId: this.def?.id || null
        };

        if (dedicated) {
            // Server authors the shared corpse; spawn locally with the same id so
            // snapshot/event reconcile instead of duplicating.
            const worldLoot = loot.map((s) => {
                const clone = typeof cloneItemStack === "function" ? cloneItemStack(s) : { ...s };
                if (clone && typeof migrateToSpoilAt === "function") {
                    migrateToSpoilAt(clone, scene.worldMinuteIndex?.() ?? null);
                }
                return clone;
            }).filter(Boolean);
            scene.net.sendAction({
                type: NetProtocol.Actions.MOB_DEATH,
                uid: this.entry?.uid || null,
                kind: this.def?.id || this.entry?.id || null,
                x: c.x,
                y: c.y,
                corpse: { ...corpseOpts, loot: worldLoot }
            });
            const corpse = Corpse.spawn(scene, corpseOpts);
            if (corpse?.entry) {
                corpse.entry.netSync = true;
                corpse.entry.pendingServer = true;
                corpse.entry.pendingAt = performance.now();
            }
            if (corpse && scene.netCorpses) scene.netCorpses.set(corpseId, corpse);
        } else {
            Corpse.spawn(scene, corpseOpts);
        }

        if (this.chunk?.meta?.mobs) {
            const i = this.chunk.meta.mobs.indexOf(this.entry);
            if (i >= 0) this.chunk.meta.mobs.splice(i, 1);
        }
        this.chunk?.mobs?.remove(this);
        scene.damageables?.remove(this);
        scene.mobs?.remove(this);
        this.destroy();
    }

    update(_time, delta) {
        if (!this.active || this._dead) return;
        this.capacities = new Capacities(this.anatomy);
        const prone = this.isImmobile() || this.isIncapacitated();

        // Preserve prior velocity so ice can ease toward the AI's new intent
        const startVx = this._iceVx ?? this.body?.velocity?.x ?? 0;
        const startVy = this._iceVy ?? this.body?.velocity?.y ?? 0;

        this.ai?.update(delta);
        this._tickMeleeAttack(delta);
        // Half move while swinging (same idea as the player)
        if (this.isAttacking() && this.body?.velocity) {
            this.setVelocity(this.body.velocity.x * 0.5, this.body.velocity.y * 0.5);
        }
        // Apply prone after AI so walk/idle anims don't overwrite the lay-down pose
        setCreatureProne(this, prone);

        const wantVx = prone ? 0 : (this.body?.velocity?.x ?? 0);
        const wantVy = prone ? 0 : (this.body?.velocity?.y ?? 0);
        this._iceVx = startVx;
        this._iceVy = startVy;
        applyEntityVelocity(this, wantVx, wantVy, delta, this.scene);

        this.setDepth(this.y);
        this.reassignChunkIfNeeded();
        if (!this.active) return;
        this.syncToEntry();
    }
}

/** Ground loot lifetime while its chunk is loaded (5 real minutes). */
const DROP_LIFE_MS = 5 * 60 * 1000;

function dropIconKey(scene, item, entry) {
    if (typeof Place !== "undefined" && Place.itemIconKey && scene?.getThing) {
        const key = Place.itemIconKey(item, (id) => scene.getThing(id));
        if (key) return key;
    }
    return item?.key || entry?.id || "";
}

/**
 * Ground item. `entry` lives in chunk.meta.drops (persisted like mobs).
 * lifeMs only ticks while the owning chunk is loaded.
 */
class DroppedItem extends Mob {
    /**
     * @param {Object} [stackExtras]  optional customName/food/ingredients for dynamic meals
     */
    static spawn(scene, x, y, item, quantity, spoilAt = undefined, stackExtras = null, noMerge = false) {
        if (!item || quantity <= 0) return null;

        const now = scene.worldMinuteIndex?.() ?? null;
        let incomingSpoil = spoilAt !== undefined
            ? spoilAt
            : defaultSpoilAt(item, now);
        if (incomingSpoil == null && now != null && stackExtras?.food?.spoil > 0) {
            incomingSpoil = Math.round(now) + Math.round(stackExtras.food.spoil * 60);
        }

        // Dedicated MP: server owns ground loot. LocalSim SP uses chunk.meta like offline.
        if (scene.isNet && scene.net?.connected && !scene.net.isLocal) {
            scene._netSendMove?.(true);
            scene.net.sendAction({
                type: NetProtocol.Actions.SPAWN_DROP,
                id: item.id,
                quantity,
                x,
                y,
                spoilAt: incomingSpoil,
                food: stackExtras?.food ? { ...stackExtras.food } : undefined,
                customName: stackExtras?.customName,
                ingredients: stackExtras?.ingredients,
                toolClass: stackExtras?.toolClass,
                sharpness: stackExtras?.sharpness,
                knapDamage: stackExtras?.knapDamage,
                knapMaterial: stackExtras?.knapMaterial,
                knapQuality: stackExtras?.knapQuality,
                tooltipExtra: stackExtras?.tooltipExtra,
                knapIconData: stackExtras?.knapIconData,
                durability: stackExtras?.durability
            });
            return null;
        }

        if (!scene.droppedItems) scene.droppedItems = scene.add.group();

        const maxStack = Math.max(1, item.maxStack || 1);
        const maxDist = scene.tileSize;
        let remaining = quantity;
        let last = null;

        const canMerge = !stackExtras?.customName
            && !stackExtras?.food
            && !stackExtras?.ingredients?.length
            && !stackExtras?.toolClass
            && stackExtras?.knapDamage == null
            && !stackExtras?.knapQuality
            && stackExtras?.durability == null;

        if (canMerge && !noMerge) {
            const nearby = scene.droppedItems.getChildren()
                .filter(drop => drop.active && drop.item?.id === item.id
                    && !drop.customName && !drop.food && !drop.ingredients
                    && !drop.toolClass                     && drop.knapDamage == null
                    && !drop.knapQuality
                    && drop.durability == null
                    && drop.quantity < maxStack)
                .map(drop => ({
                    drop,
                    dist: Phaser.Math.Distance.Between(x, y, drop.x, drop.y)
                }))
                .filter(entry => entry.dist <= maxDist)
                .sort((a, b) => a.dist - b.dist);

            for (const { drop } of nearby) {
                if (remaining <= 0) break;
                const space = maxStack - drop.quantity;
                const add = Math.min(space, remaining);
                drop.spoilAt = mergeSpoilAt(
                    drop.quantity, drop.spoilAt,
                    add, incomingSpoil
                );
                drop.quantity += add;
                // Merged stacks refresh despawn timer
                drop.lifeMs = DROP_LIFE_MS;
                drop.syncToEntry();
                remaining -= add;
                last = drop;
            }
        }

        if (scene.tooltip?.visible) scene.refreshTooltip();

        while (remaining > 0) {
            const add = Math.min(maxStack, remaining);
            const chunk = LivingMob.ensureChunkAt(scene, x, y - 1);
            if (!chunk) break;
            if (!chunk.meta.drops) chunk.meta.drops = [];

            const entry = DroppedItem.makeEntry(item, x, y, add, incomingSpoil, stackExtras);
            chunk.meta.drops.push(entry);

            if (chunk.isLoaded) {
                last = new DroppedItem(scene, entry, chunk);
            } else {
                last = null;
            }
            remaining -= add;
        }

        return last;
    }

    static makeEntry(item, x, y, quantity, spoilAt, stackExtras = null) {
        const entry = {
            id: item.id,
            x,
            y,
            quantity,
            lifeMs: DROP_LIFE_MS
        };
        if (spoilAt != null) entry.spoilAt = spoilAt;
        if (stackExtras?.customName) entry.customName = stackExtras.customName;
        if (stackExtras?.food) entry.food = { ...stackExtras.food };
        if (stackExtras?.ingredients) entry.ingredients = stackExtras.ingredients.slice();
        if (stackExtras?.weight != null) entry.weight = stackExtras.weight;
        if (stackExtras?.kind) entry.kind = stackExtras.kind;
        if (stackExtras?.fillTint != null) entry.fillTint = stackExtras.fillTint;
        if (stackExtras?.toolClass) entry.toolClass = stackExtras.toolClass;
        if (stackExtras?.sharpness != null) entry.sharpness = stackExtras.sharpness;
        if (stackExtras?.knapDamage != null) entry.knapDamage = stackExtras.knapDamage;
        if (stackExtras?.knapMaterial) entry.knapMaterial = stackExtras.knapMaterial;
        if (stackExtras?.tooltipExtra) entry.tooltipExtra = stackExtras.tooltipExtra;
        if (stackExtras?.knapIconData) entry.knapIconData = stackExtras.knapIconData;
        if (stackExtras?.knapQuality) entry.knapQuality = stackExtras.knapQuality;
        if (stackExtras?.durability != null) entry.durability = stackExtras.durability;
        if (stackExtras?.dryProgress != null) entry.dryProgress = stackExtras.dryProgress;
        return entry;
    }

    /**
     * @param {Phaser.Scene} scene
     * @param {Object} entry  chunk.meta.drops entry
     * @param {Chunk} chunk
     */
    constructor(scene, entry, chunk) {
        const item = scene.getItem(entry.id);
        const isMeal = !!(entry.ingredients?.length);
        const texKey = isMeal ? COCONUT_SHELL_KEY : dropIconKey(scene, item, entry);
        super(scene, entry.x, entry.y, texKey);

        this.entry = entry;
        this.chunk = chunk;
        this.item = item || { id: entry.id, key: texKey, maxStack: 1 };
        this.quantity = Number(entry.quantity) || 1;
        this.lifeMs = entry.lifeMs != null ? Number(entry.lifeMs) : DROP_LIFE_MS;
        if (typeof migrateStackSpoil === "function" && scene.worldMinuteIndex) {
            migrateStackSpoil(entry, scene.worldMinuteIndex(), (id) => scene.getItem(id));
        }
        if (entry.spoilAt != null) this.spoilAt = entry.spoilAt;
        if (entry.customName) this.customName = entry.customName;
        if (entry.food) this.food = { ...entry.food };
        if (entry.ingredients) this.ingredients = entry.ingredients.slice();
        if (entry.weight != null) this.stackWeight = entry.weight;
        if (entry.kind) this.kind = entry.kind;
        if (entry.fillTint != null) this.fillTint = entry.fillTint;
        if (entry.toolClass) this.toolClass = entry.toolClass;
        if (entry.sharpness != null) this.sharpness = entry.sharpness;
        if (entry.knapDamage != null) this.knapDamage = entry.knapDamage;
        if (entry.knapMaterial) this.knapMaterial = entry.knapMaterial;
        if (entry.tooltipExtra) this.tooltipExtra = entry.tooltipExtra;
        if (entry.knapIconData) this.knapIconData = entry.knapIconData;
        if (entry.knapQuality) this.knapQuality = entry.knapQuality;
        if (entry.durability != null) this.durability = entry.durability;
        if (entry.dryProgress != null) this.dryProgress = entry.dryProgress;

        // Knapped silhouette on the ground drop
        if (this.knapIconData && typeof Knapping !== "undefined") {
            const knapKey = Knapping.ensureToolTexture(scene, {
                knapIconData: this.knapIconData,
                knapIcon: entry.knapIcon
            });
            if (knapKey && scene.textures.exists(knapKey)) {
                this.knapIcon = knapKey;
                this.setTexture(knapKey);
            }
        }

        scene.add.existing(this);
        scene.physics.add.existing(this);
        scene.groundLayer.add(this);
        if (!scene.droppedItems) scene.droppedItems = scene.add.group();
        scene.droppedItems.add(this);
        if (!chunk.drops) chunk.drops = scene.add.group();
        chunk.drops.add(this);

        this.setOrigin(0, 1);
        this.setDepth(1);
        this.setScale(0.7);

        this.setDamping(true);
        this.setDrag(200, 200);
        this.setMaxVelocity(48, 48);

        if (isMeal && scene.textures.exists(COCONUT_FILL_KEY)) {
            const tint = this.fillTint != null
                ? this.fillTint
                : mixIngredientFillTint(id => scene.getItem(id), this.ingredients);
            this.fillOverlay = scene.add.image(entry.x, entry.y, COCONUT_FILL_KEY)
                .setOrigin(0, 1)
                .setScale(0.7)
                .setTint(tint)
                .setDepth(1.1);
            scene.groundLayer.add(this.fillOverlay);
            this._syncFillOverlay = () => {
                if (!this.active || !this.fillOverlay) return;
                this.fillOverlay.setPosition(this.x, this.y).setDepth(this.depth + 0.1);
            };
            scene.events.on("update", this._syncFillOverlay);
        }

        this.setInteractive({ cursor: "pointer" });
        this.on("pointerdown", (pointer) => {
            const took = this.tryPickup();
            if (!took && this.active) this.tooltip(pointer);
            else if (this.active && this.quantity > 0) this.tooltip(pointer);
        });
        this.on("pointerover", (pointer) => this.tooltip(pointer));
        this.on("pointerout", () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) scene.hideTooltip();
        });
        this.on("destroy", () => {
            if (this.scene._hoverTarget === this) this.scene._hoverTarget = null;
            if (this.scene._tooltipTarget === this) scene.hideTooltip();
            if (this._syncFillOverlay) {
                scene.events.off("update", this._syncFillOverlay);
                this._syncFillOverlay = null;
            }
            this.fillOverlay?.destroy();
            this.fillOverlay = null;
            if (!this._persisting) this._removeEntry();
            this.scene.droppedItems?.remove(this);
            this.chunk?.drops?.remove(this);
        });
    }

    syncToEntry() {
        if (!this.entry) return;
        this.entry.x = this.x;
        this.entry.y = this.y;
        this.entry.quantity = this.quantity;
        this.entry.lifeMs = this.lifeMs;
        if (this.spoilAt != null) this.entry.spoilAt = this.spoilAt;
        else delete this.entry.spoilAt;
        if (this.customName) this.entry.customName = this.customName;
        if (this.food) this.entry.food = { ...this.food };
        if (this.ingredients) this.entry.ingredients = this.ingredients.slice();
        if (this.stackWeight != null) this.entry.weight = this.stackWeight;
        if (this.kind) this.entry.kind = this.kind;
        if (this.fillTint != null) this.entry.fillTint = this.fillTint;
        if (this.toolClass) this.entry.toolClass = this.toolClass;
        if (this.sharpness != null) this.entry.sharpness = this.sharpness;
        if (this.knapDamage != null) this.entry.knapDamage = this.knapDamage;
        if (this.knapMaterial) this.entry.knapMaterial = this.knapMaterial;
        if (this.tooltipExtra) this.entry.tooltipExtra = this.tooltipExtra;
        if (this.knapIconData) this.entry.knapIconData = this.knapIconData;
        if (this.knapQuality) this.entry.knapQuality = this.knapQuality;
        if (this.durability != null) this.entry.durability = this.durability;
        else delete this.entry.durability;
        if (this.dryProgress != null) this.entry.dryProgress = this.dryProgress;
        else delete this.entry.dryProgress;
    }

    _removeEntry() {
        if (!this.entry || !this.chunk?.meta?.drops) return;
        const i = this.chunk.meta.drops.indexOf(this.entry);
        if (i >= 0) this.chunk.meta.drops.splice(i, 1);
    }

    /** Destroy sprite but keep meta (chunk unload). */
    persistDestroy() {
        this.syncToEntry();
        this._persisting = true;
        this.destroy();
    }

    reassignChunkIfNeeded() {
        const next = LivingMob.ensureChunkAt(this.scene, this.x, this.y - 1);
        if (!next || next === this.chunk) return;

        const old = this.chunk;
        if (old?.meta?.drops) {
            const i = old.meta.drops.indexOf(this.entry);
            if (i >= 0) old.meta.drops.splice(i, 1);
            old.drops?.remove(this);
        }
        if (!next.meta.drops) next.meta.drops = [];
        if (next.meta.drops.indexOf(this.entry) < 0) next.meta.drops.push(this.entry);
        this.chunk = next;

        if (!next.isLoaded) {
            this.persistDestroy();
            return;
        }
        if (!next.drops) next.drops = this.scene.add.group();
        next.drops.add(this);
    }

    update(_time, delta) {
        if (!this.active) return;
        // Server-owned drops: don't despawn locally or rewrite chunk meta
        if (this.entry?.netSync || (this.scene.isNet && !this.scene.net?.isLocal)) {
            return;
        }
        const speed = Number(this.scene.tickSpeed);
        const scale = Number.isFinite(speed) ? Math.max(0, speed) : 1;
        this.lifeMs -= delta * scale;
        if (this.lifeMs <= 0) {
            this.destroy();
            return;
        }
        this.reassignChunkIfNeeded();
        if (!this.active) return;
        this.syncToEntry();
    }

    /**
     * Try to move this drop into the player's inventory.
     * @returns {boolean} true if any quantity was taken
     */
    tryPickup() {
        if (!this.active || !this.item || !(this.quantity > 0)) return false;
        // Dedicated MP: ask the server. LocalSim SP takes from chunk.meta locally.
        if (this.scene.isNet && this.scene.net?.connected && !this.scene.net.isLocal) {
            if (this.entry?.netSync) {
                this.scene.net.sendAction({
                    type: NetProtocol.Actions.PICKUP,
                    dropId: this.entry.uid || null
                });
            }
            return false;
        }
        const player = this.scene.player;
        if (!player) return false;

        if (typeof hasStackExtras === "function" ? hasStackExtras(this) : (this.customName || this.food || this.ingredients || this.toolClass)) {
            const now = this.scene.worldMinuteIndex?.() ?? null;
            const spoilLeft = spoilLeftForCharacter(
                { spoilAt: this.spoilAt, spoilLeft: this.spoilLeft },
                now
            );
            const stack = {
                id: this.item.id,
                quantity: this.quantity,
                ...(this.customName ? { customName: this.customName } : {}),
                ...(this.food ? { food: { ...this.food } } : {}),
                ...(this.ingredients ? { ingredients: this.ingredients.slice() } : {}),
                ...(this.stackWeight != null ? { weight: this.stackWeight } : {}),
                ...(this.kind ? { kind: this.kind } : {}),
                ...(this.fillTint != null ? { fillTint: this.fillTint } : {}),
                ...(spoilLeft != null ? { spoilLeft } : {}),
                ...(this.toolClass ? { toolClass: this.toolClass } : {}),
                ...(this.sharpness != null ? { sharpness: this.sharpness } : {}),
                ...(this.knapDamage != null ? { knapDamage: this.knapDamage } : {}),
                ...(this.knapMaterial ? { knapMaterial: this.knapMaterial } : {}),
                ...(this.tooltipExtra ? { tooltipExtra: this.tooltipExtra } : {}),
                ...(this.knapIconData ? { knapIconData: this.knapIconData } : {}),
                ...(this.knapQuality ? { knapQuality: this.knapQuality } : {}),
                ...(this.durability != null ? { durability: this.durability } : {}),
                ...(this.dryProgress != null ? { dryProgress: this.dryProgress } : {})
            };
            const inv = player.inventory;
            const empty = inv.findIndex(s => !s);
            if (empty !== -1) {
                inv[empty] = stack;
                this.scene.hotbar.dirty = true;
                this.destroy();
                return true;
            }
            if (inv.length < player.inventorySize) {
                inv.push(stack);
                this.scene.hotbar.dirty = true;
                this.destroy();
                return true;
            }
            return false;
        }

        const before = this.quantity;
        const now = this.scene.worldMinuteIndex?.() ?? null;
        const spoilLeft = spoilLeftForCharacter(
            { spoilAt: this.spoilAt, spoilLeft: this.spoilLeft },
            now
        );
        const remaining = player.gainItem(this.item, this.quantity, spoilLeft);
        if (remaining === before) return false;
        this.scene.hotbar.dirty = true;
        if (remaining === 0) this.destroy();
        else {
            this.quantity = remaining;
            this.syncToEntry();
        }
        return true;
    }

    tooltip(pointer) {
        // Match hotbar: tipped spears carry knapQuality without toolClass.
        const stackProxy = (typeof hasStackExtras === "function" ? hasStackExtras(this) : (
            this.customName || this.food || this.ingredients || this.toolClass
            || this.knapQuality || this.knapDamage != null || this.knapIconData
        )) ? {
            customName: this.customName,
            food: this.food,
            ingredients: this.ingredients,
            weight: this.stackWeight,
            kind: this.kind,
            fillTint: this.fillTint,
            toolClass: this.toolClass,
            sharpness: this.sharpness,
            knapDamage: this.knapDamage,
            knapMaterial: this.knapMaterial,
            knapIconData: this.knapIconData,
            tooltipExtra: this.tooltipExtra,
            knapQuality: this.knapQuality,
            durability: this.durability,
            dryProgress: this.dryProgress,
            spoilAt: this.spoilAt,
            spoilLeft: this.spoilLeft
        } : null;
        this.scene.showTooltip(
            () => this.scene.formatItemTooltip(
                this.item, this.quantity, this.spoilAt, stackProxy
            ),
            pointer.x,
            pointer.y,
            this
        );
    }
}
