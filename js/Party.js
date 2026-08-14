/**
 * Client party: leader vs controlled pawn, recruiting, follow/food, wanderer director.
 */
class PartySystem {
    constructor(scene) {
        this.scene = scene;
        this.wanderers = [];
        this.pvpAggro = new Set();
        this.lastHitMob = null;
        this.lastHitAt = 0;
        this._combatSeenAt = 0;
        this.directorCd = 0;
        this._keyHandler = null;
        this._pointerBound = false;
        this.leaderDead = false;
        this._eatSittings = new Map();
        this._duelMap = new Map();
        this._duelIds = new Map();
        this._duelEntities = [];
    }

    bindSceneKeys() {
        const scene = this.scene;
        const kb = scene.input?.keyboard;
        if (!kb) return;
        // Scene instances are reused; KeyboardPlugin.destroy()s the previous Key objects.
        try { kb.removeAllKeys?.(true); } catch (_) {}
        scene.cursors = kb.createCursorKeys();
        scene.keys = kb.addKeys({
            W: Phaser.Input.Keyboard.KeyCodes.W,
            A: Phaser.Input.Keyboard.KeyCodes.A,
            S: Phaser.Input.Keyboard.KeyCodes.S,
            D: Phaser.Input.Keyboard.KeyCodes.D,
            Q: Phaser.Input.Keyboard.KeyCodes.Q,
            F: Phaser.Input.Keyboard.KeyCodes.F,
            SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE,
            SHIFT: Phaser.Input.Keyboard.KeyCodes.SHIFT,
            CTRL: Phaser.Input.Keyboard.KeyCodes.CTRL
        });
    }

    attachLeader(player) {
        const scene = this.scene;
        const id = scene.characterId || scene._netPlayerId || scene.character?.id || "leader";
        player.pawnId = id;
        player.ownerId = id;
        player.leaderId = id;
        player.role = "leader";
        player.faction = (typeof Party !== "undefined" && Party.partyFactionId)
            ? Party.partyFactionId(id)
            : `party:${id}`;
        player.pawnName = scene.playerName || scene.character?.name || "Player";
        player.hotbarIndex = player.hotbarIndex || 0;
        scene.leader = player;
        scene.player = player;
        scene.party = [player];
        this._wirePawn(player);
        this._bindHotkeys();
        this._pointerBound = false;
        this._bindWorldPointer();
    }

    _wirePawn(player) {
        const scene = this.scene;
        const dedicatedWanderer = this._isDedicatedNet() && player.role === "wanderer";
        if (!dedicatedWanderer) {
            if (scene._things?.children) scene.physics.add.collider(player, scene._things);
            if (scene.mobs?.children) scene.physics.add.overlap(player, scene.mobs);
        }
        scene.damageables?.add(player);
        player.setInteractive?.({ cursor: "pointer", pixelPerfect: false });
        if (!player._partyHoverBound) {
            player._partyHoverBound = true;
            player.on("pointerover", (pointer) => {
                scene.showTooltip?.(
                    () => scene.partySys?.hoverTooltip?.(player) || "",
                    pointer.x,
                    pointer.y,
                    player
                );
            });
            player.on("pointerout", () => {
                if (scene._tooltipTarget === player) scene.hideTooltip?.();
            });
        }
        if (!player.partyAI && player.role !== "wanderer") {
            player.partyAI = new PartyAI(player);
        }
        player.ensureNameLabel?.();
    }

    _enablePawnPhysics(pawn) {
        const body = pawn?.body;
        if (!body) return;
        const downed = !!(
            pawn._downed
            || pawn._prone
            || pawn.isIncapacitated?.()
            || pawn.isImmobile?.()
        );
        pawn.setVelocity?.(0, 0);
        pawn._iceVx = 0;
        pawn._iceVy = 0;
        body.enable = true;
        body.moves = !downed;
    }

    _disablePawnPhysics(pawn) {
        const body = pawn?.body;
        if (!body) return;
        pawn.setVelocity?.(0, 0);
        pawn._iceVx = 0;
        pawn._iceVy = 0;
        body.enable = false;
        body.moves = false;
    }

    _isDedicatedNet() {
        const scene = this.scene;
        return !!(scene.isNet && scene.net?.connected && !scene.net.isLocal);
    }

    _bindHotkeys() {
        const scene = this.scene;
        if (this._keyHandler) return;
        this._keyHandler = (event) => {
            const t = event.target;
            const tag = t && t.tagName ? String(t.tagName).toUpperCase() : "";
            if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
            if (scene.combatLog?.isComposing?.()) return;
            if (scene._gamePaused) return;
            if (scene.knappingPanel?.visible) return;

            const digit = this._ctrlPartyIndex(event);
            if (event.ctrlKey && !event.metaKey && digit != null) {
                event.preventDefault();
                event.stopPropagation();
                this.switchToIndex(digit);
                return;
            }
            if (event.code === "Period" || event.key === ".") this.cycle(1);
            if (event.code === "Comma" || event.key === ",") this.cycle(-1);
        };
        // Capture + preventDefault so the browser does not steal Ctrl+1–6 as tab shortcuts.
        window.addEventListener("keydown", this._keyHandler, true);
        scene.events.once("shutdown", () => this._unbindHotkeys());
        scene.events.once("destroy", () => this._unbindHotkeys());
    }

    _unbindHotkeys() {
        if (!this._keyHandler) return;
        window.removeEventListener("keydown", this._keyHandler, true);
        this._keyHandler = null;
    }

    _ctrlPartyIndex(event) {
        const code = event.code || "";
        if (/^Digit[1-6]$/.test(code)) return Number(code.slice(5)) - 1;
        if (/^Numpad[1-6]$/.test(code)) return Number(code.slice(6)) - 1;
        const key = event.key;
        if (key >= "1" && key <= "6") return Number(key) - 1;
        return null;
    }

    _bindWorldPointer() {
        const scene = this.scene;
        if (this._pointerBound) return;
        this._pointerBound = true;
        scene.input.on("gameobjectdown", (_pointer, obj) => {
            if (scene.pointerOverWorldUi?.(_pointer)) return;
            if (_pointer.rightButtonDown?.()) return;
            const careAlly = this._partyMemberUnderPointer(_pointer);
            if (
                careAlly
                && careAlly !== scene.player
                && (this._holdingBandage() || (this._holdingFood() && this._needsForceFeed(careAlly)))
            ) {
                this.tryAllyClick(careAlly);
                return;
            }
            if (obj?.role === "wanderer") {
                this.tryRecruit(obj);
                return;
            }
            if (scene.party?.includes(obj) && obj !== scene.player) {
                const P = typeof Party !== "undefined" ? Party : null;
                const downed = P?.walkThrough?.(obj);
                if (downed && !this._holdingBandage() && !this._holdingFood() && this._tryPickupUnderPointer(_pointer)) {
                    return;
                }
                this.tryAllyClick(obj);
            }
        });
    }

    roster() {
        const scene = this.scene;
        const rows = [];
        const leader = scene.leader;
        if (leader) {
            rows.push(leader);
        }
        for (const p of scene.party || []) {
            if (p && p !== leader && !p.isBodyDead?.()) rows.push(p);
        }
        return rows;
    }

    living() {
        return (typeof Party !== "undefined"
            ? Party.livingParty(this.scene.party)
            : (this.scene.party || []).filter((p) => p && !p.isBodyDead?.()));
    }

    switchToIndex(index) {
        const rows = this.roster();
        const pawn = rows[index];
        if (!pawn) return false;
        return this.switchControl(pawn);
    }

    cycle(dir) {
        const rows = this.roster().filter((p) => p && (!p.isBodyDead?.() || p === this.scene.leader));
        if (rows.length < 2) return false;
        const cur = this.scene.player;
        let i = rows.indexOf(cur);
        if (i < 0) i = 0;
        const next = rows[(i + (dir >= 0 ? 1 : rows.length - 1)) % rows.length];
        return this.switchControl(next);
    }

    switchControl(pawn, opts = {}) {
        const scene = this.scene;
        if (!pawn || scene.player === pawn) {
            if (pawn === scene.leader && this.leaderDead) {
                scene.deathOverlay?.setVisible(true);
                scene.layoutDeathOverlay?.();
            }
            return false;
        }
        const from = scene.player;
        if (pawn.isBodyDead?.() && pawn !== scene.leader) return false;

        scene.knappingPanel?.close?.();
        scene.player = pawn;
        pawn.cursors = scene.cursors;
        pawn.keys = scene.keys;
        this._enablePawnPhysics(pawn);
        if (from && this._isDedicatedNet()) this._disablePawnPhysics(from);
        if (this._isDedicatedNet() && (pawn._netProne || pawn._downed || pawn._prone || pawn.isIncapacitated?.())) {
            const tx = pawn._netTx;
            const ty = pawn._netTy;
            const w = pawn.width || 16;
            const h = pawn.height || 16;
            if (Number.isFinite(tx) && Number.isFinite(ty)) {
                if (pawn._prone) {
                    pawn.x = tx + w * 0.5;
                    pawn.y = ty - h * 0.5;
                } else {
                    pawn.x = tx;
                    pawn.y = ty;
                    if (typeof setCreatureProne === "function") setCreatureProne(pawn, true);
                }
            }
            pawn.setVelocity?.(0, 0);
        }
        pawn.syncWaistSlots?.();
        pawn.recomputeEquipmentEffects?.();
        // Taking control interrupts AI eat/tend so you don't inherit a channel bar
        // and then lose it to a hotbar-slot mismatch.
        pawn._cancelEat?.();
        if (pawn._tendChannel && !pawn._tendChannel.corpse) pawn._cancelTend?.();
        scene.hideChannelBar?.();
        if (scene.hotbar) {
            const hi = Math.max(0, Math.min((scene.hotbar.size || 5) - 1, pawn.hotbarIndex || 0));
            scene.hotbar.setSize?.(pawn.inventorySize || pawn.inventory?.length || 5);
            scene.hotbar.setActiveIndex(hi, { notifyNet: false });
            scene.hotbar.dirty = true;
        }
        scene.healthPanel?.refresh?.();
        scene.equipmentPanel?.refresh?.();
        from?.syncNameLabel?.();
        pawn.syncNameLabel?.();
        scene.syncCameraToPlayer?.();
        scene.partyPanel?.refresh?.();

        if (pawn === scene.leader && this.leaderDead) {
            scene.deathOverlay?.setVisible(true);
            scene.layoutDeathOverlay?.();
        } else {
            scene.deathOverlay?.setVisible(false);
        }

        if (scene.isNet && scene.net?.connected && !opts.silentNet) {
            scene.net.sendAction({
                type: NetProtocol.Actions.SWITCH_CONTROL,
                pawnId: pawn.pawnId
            });
        }
        return true;
    }

    spawnCompanion(opts = {}) {
        const scene = this.scene;
        const P = typeof Party !== "undefined" ? Party : { CAP: 6 };
        if ((scene.party?.length || 0) >= P.CAP) return null;
        const x = opts.x ?? (scene.player?.x || 0) + 16;
        const y = opts.y ?? (scene.player?.y || 0);
        const look = opts.look || (typeof Look !== "undefined" ? Look.randomLook() : null);
        const pawn = new Player(scene, x, y, look);
        pawn.pawnId = opts.id || (typeof NetRng !== "undefined" ? NetRng.uuid() : `p-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        pawn.ownerId = scene.leader?.ownerId || scene.characterId;
        pawn.leaderId = scene.leader?.pawnId;
        pawn.role = "companion";
        pawn.faction = (typeof Party !== "undefined" && Party.partyFactionId)
            ? Party.partyFactionId(pawn.ownerId)
            : `party:${pawn.ownerId}`;
        pawn.pawnName = opts.name || (typeof CavemanNames !== "undefined" ? CavemanNames.generate() : "Og");
        pawn.hotbarIndex = opts.hotbarIndex || 0;
        if (Array.isArray(opts.inventory)) pawn.inventory = opts.inventory;
        while (pawn.inventory.length < (pawn.inventorySize || 5)) pawn.inventory.push(null);
        if (opts.equipment) pawn.equipment = JSON.parse(JSON.stringify(opts.equipment));
        if (typeof opts.kc === "number") pawn.kc = opts.kc;
        if (typeof opts.saturation === "number") pawn.saturation = opts.saturation;
        if (typeof opts.stomach === "number") pawn.stomach = opts.stomach;
        if (opts.body && pawn.anatomy?.loadJSON) pawn.anatomy.loadJSON(opts.body);
        if (opts.facing) pawn.facing = opts.facing;
        pawn.recomputeEquipmentEffects?.();
        pawn.capacities = new Capacities(pawn.anatomy);
        pawn._netTx = pawn.x;
        pawn._netTy = pawn.y;
        scene.party.push(pawn);
        this._wirePawn(pawn);
        if (this._isDedicatedNet() && pawn !== scene.player) this._disablePawnPhysics(pawn);
        scene.partyPanel?.refresh?.();
        return pawn;
    }

    spawnWanderer(opts = {}) {
        const scene = this.scene;
        const look = opts.look || (typeof Look !== "undefined" ? Look.randomLook() : null);
        const pawn = new Player(scene, opts.x || 0, opts.y || 0, look);
        pawn.pawnId = opts.id || (typeof NetRng !== "undefined" ? NetRng.uuid() : `w-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        pawn.ownerId = null;
        pawn.leaderId = null;
        pawn.role = "wanderer";
        pawn.faction = (typeof Party !== "undefined" && Party.FACTION_WANDERERS) || "Wanderers";
        pawn.pawnName = opts.name || (typeof CavemanNames !== "undefined" ? CavemanNames.generate() : "Og");
        pawn.hostile = !!opts.hostile;
        pawn.recruitLocked = !!opts.recruitLocked;
        pawn.refusedBy = new Set(opts.refusedBy || []);
        const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
        pawn.heading = opts.heading || dirs[Math.floor(Math.random() * 4)];
        pawn.hotbarIndex = 0;
        if (opts.inventory) pawn.inventory = opts.inventory;
        else {
            const partyN = scene.party?.length || 1;
            const full = typeof Party !== "undefined" && Party.isPartyFull
                ? Party.isPartyFull(partyN)
                : partyN >= 6;
            pawn.inventory = typeof Party !== "undefined" && Party.rollWandererInventory
                ? Party.rollWandererInventory(undefined, { fullParty: full })
                : [{ id: "pebble", quantity: 2 }, { id: "stick", quantity: 3 }, { id: "leaf", quantity: 4 }, null, null];
            while (pawn.inventory.length < 5) pawn.inventory.push(null);
        }
        pawn.wandererAI = new WandererAI(pawn);
        this._wirePawn(pawn);
        if (this._isDedicatedNet() && pawn.body) {
            pawn.body.enable = false;
            pawn.body.moves = false;
        }
        pawn.ensureNameLabel?.();
        pawn.syncFxRoot?.();
        pawn.syncNameLabel?.();
        this.wanderers.push(pawn);
        return pawn;
    }

    applyRoughVitals(pawn, rng = Math.random) {
        const r = typeof rng === "function" ? rng : Math.random;
        pawn.kc = typeof Party !== "undefined" ? Party.rollRoughKc(r) : Math.round(300 + r() * 900);
        pawn.saturation = 0;
        const inj = typeof Party !== "undefined" ? Party.rollRoughInjury(r) : null;
        if (inj) {
            const part = pawn.anatomy?.part?.(inj.partName);
            if (part && !part.isDead?.()) part.injure(inj);
        }
        pawn.capacities = new Capacities(pawn.anatomy);
        pawn._refreshDownedState?.();
    }

    tryRecruit(wanderer) {
        const scene = this.scene;
        const me = scene.player;
        if (!wanderer || wanderer.role !== "wanderer" || wanderer.hostile || wanderer.recruitLocked) {
            return false;
        }
        if (!me || me.isBodyDead?.()) return false;
        const P = typeof Party !== "undefined" ? Party : null;
        if (P && !P.inInteractRange(me, wanderer, scene.tileSize)) return false;
        if ((scene.party?.length || 0) >= (P?.CAP || 6)) {
            scene.combatLog?.push("Party is full.");
            return false;
        }
        const myId = scene.leader?.pawnId || scene.characterId;
        if (wanderer.refusedBy?.has(myId)) return false;

        if (scene.isNet && scene.net?.connected && !scene.net.isLocal) {
            scene.net.sendAction({
                type: NetProtocol.Actions.RECRUIT,
                wandererId: wanderer.pawnId
            });
            return true;
        }

        const held = me.getHeldItem?.();
        const meta = held ? scene.getItem(held.id) : null;
        const food = held?.food || meta?.food;
        const holdingFood = !!(food && Number(food.kc ?? 0) > 0);
        const chance = P ? P.recruitChance(holdingFood) : holdingFood ? 0.75 : 0.5;
        if (holdingFood) this._consumeRecruitFood(me);
        if (Math.random() >= chance) {
            wanderer.refusedBy.add(myId);
            scene.combatLog?.push(`${wanderer.displayName()} is not interested.`);
            wanderer.syncNameLabel?.();
            return false;
        }
        this.acceptRecruit(wanderer);
        return true;
    }

    _consumeRecruitFood(pawn) {
        if (!pawn?.inventory) return;
        const scene = this.scene;
        const slot = pawn.isControlled?.()
            ? (scene.hotbar?.activeIndex ?? pawn.hotbarIndex ?? 0)
            : (pawn.hotbarIndex ?? 0);
        const held = pawn.inventory[slot];
        if (!held) return;
        const meta = scene.getItem?.(held.id);
        const food = held.food || meta?.food;
        if (!(Number(food?.kc ?? 0) > 0)) return;
        held.quantity = (held.quantity || 1) - 1;
        if (!(held.quantity > 0)) pawn.inventory[slot] = null;
        if (scene.hotbar) scene.hotbar.dirty = true;
    }

    acceptRecruit(wanderer) {
        const scene = this.scene;
        const name = wanderer.displayName();
        wanderer.role = "companion";
        wanderer.ownerId = scene.leader?.ownerId || scene.characterId;
        wanderer.leaderId = scene.leader?.pawnId;
        wanderer.faction = (typeof Party !== "undefined" && Party.partyFactionId)
            ? Party.partyFactionId(wanderer.ownerId)
            : `party:${wanderer.ownerId}`;
        wanderer.hostile = false;
        wanderer.wandererAI = null;
        this.applyRoughVitals(wanderer);
        wanderer.partyAI = new PartyAI(wanderer);
        this.wanderers = this.wanderers.filter((w) => w !== wanderer);
        if (!scene.party.includes(wanderer)) scene.party.push(wanderer);
        wanderer.syncNameLabel?.();
        scene.partyPanel?.refresh?.();
        scene.combatLog?.push(`${name} joins you.`);
        if (scene.net?.isLocal) {
            scene.net.sendAction?.({
                type: NetProtocol.Actions.RECRUIT,
                wandererId: wanderer.pawnId,
                accepted: true,
                pawn: this._pawnSnapshot(wanderer)
            });
        }
    }

    tryAllyClick(pawn) {
        const scene = this.scene;
        const me = scene.player;
        if (!pawn) return false;
        if (!scene.party?.includes(pawn)) return false;
        const held = me?.getHeldItem?.();
        const meta = held ? scene.getItem(held.id) : null;
        if (meta?.bandage) {
            const P = typeof Party !== "undefined" ? Party : null;
            if (pawn !== me && P && !P.inInteractRange(me, pawn, scene.tileSize)) {
                scene.combatLog?.push(`${pawn.displayName()} is too far away`);
                return true;
            }
            me.beginTend?.(pawn === me ? null : pawn);
            return true;
        }
        const food = held?.food || meta?.food;
        if (Number(food?.kc ?? 0) > 0 && this._needsForceFeed(pawn) && pawn !== me) {
            const P = typeof Party !== "undefined" ? Party : null;
            if (P && !P.inInteractRange(me, pawn, scene.tileSize)) {
                scene.combatLog?.push(`${pawn.displayName()} is too far away`);
                return true;
            }
            me.beginEat?.(held, {
                patient: pawn,
                sourcePawn: me,
                slot: scene.hotbar?.activeIndex
            });
            return true;
        }
        if (pawn === me) return false;
        return this.switchControl(pawn);
    }

    partyDropTarget(pointer) {
        const scene = this.scene;
        if (!scene.partyPanel?.visible || !pointer) return null;
        const target = scene.partyPanel.pawnAtPointer(pointer);
        if (!target || target === scene.player) return null;
        return target;
    }

    canGiveTo(fromPawn, toPawn, stack) {
        const scene = this.scene;
        if (!fromPawn || !toPawn || fromPawn === toPawn || !stack?.id) return false;
        if (!scene.party?.includes(toPawn)) return false;
        if (toPawn.isBodyDead?.()) return false;
        const P = typeof Party !== "undefined" ? Party : null;
        if (P && !P.inInteractRange(fromPawn, toPawn, scene.tileSize)) {
            scene.combatLog?.push(`${toPawn.displayName()} is too far away.`);
            return false;
        }
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        const probe = typeof cloneItemStack === "function" ? cloneItemStack(stack) : { ...stack };
        let need = qty;
        if (toPawn.canEquipLootStackIfSlotEmpty?.(probe)) need = Math.max(0, qty - 1);
        if (need > 0) {
            const rest = typeof cloneItemStack === "function" ? cloneItemStack(stack) : { ...stack };
            rest.quantity = need;
            const space = toPawn.countLootSpace?.(rest, need) ?? 0;
            if (space < need) {
                scene.combatLog?.push(`${toPawn.displayName()} cannot carry that.`);
                return false;
            }
        }
        return true;
    }

    deliverGive(toPawn, stack) {
        const scene = this.scene;
        if (!toPawn || !stack) return false;
        const whole = typeof cloneItemStack === "function" ? cloneItemStack(stack) : { ...stack };
        if (toPawn.canEquipLootStackIfSlotEmpty?.(whole) && toPawn.tryEquipLootStackIfSlotEmpty?.(whole)) {
            if (whole.quantity > 0 && !toPawn.gainStack(whole)) return false;
        } else if (!toPawn.gainStack(whole)) {
            return false;
        }
        scene.hotbar.dirty = true;
        scene.equipmentPanel?.refresh?.();
        return true;
    }

    tryGive(fromPawn, slot, toPawn) {
        const scene = this.scene;
        const stack = fromPawn?.inventory?.[slot];
        if (!this.canGiveTo(fromPawn, toPawn, stack)) return false;
        if (scene.isNet && scene.net?.connected && !scene.net.isLocal) {
            scene.net.sendAction({
                type: NetProtocol.Actions.GIVE_ITEM,
                fromPawnId: fromPawn.pawnId,
                fromSlot: slot,
                toPawnId: toPawn.pawnId
            });
            return true;
        }
        fromPawn.inventory[slot] = null;
        if (!this.deliverGive(toPawn, stack)) {
            fromPawn.inventory[slot] = stack;
            scene.combatLog?.push(`${toPawn.displayName()} cannot carry that.`);
            return false;
        }
        return true;
    }

    onMemberDied(pawn, killer, opts = {}) {
        const scene = this.scene;
        if (!pawn || pawn.role === "wanderer") {
            this._wandererDied(pawn, killer);
            return;
        }
        if (pawn === scene.leader) {
            this.leaderDead = true;
            return;
        }
        const name = pawn.displayName();
        const dedicated = !!(scene.isNet && scene.net?.connected && !scene.net.isLocal);
        const spawn = opts.spawn != null ? !!opts.spawn : !dedicated;
        pawn.createDeathCorpse?.({ spawn });
        scene.party = (scene.party || []).filter((p) => p !== pawn);
        if (scene.player === pawn) {
            const next = scene.leader && !scene.leader.isBodyDead?.()
                ? scene.leader
                : this.living()[0];
            if (next) this.switchControl(next, { silentNet: true });
            else scene.onPlayerDied?.(killer);
        }
        pawn.setVisible(false);
        if (pawn.body) pawn.body.enable = false;
        scene.combatLog?.push(`${name} died.`);
        scene.partyPanel?.refresh?.();
        scene.time?.delayedCall?.(0, () => pawn.destroy?.());
    }

    _wandererDied(pawn, killer) {
        const scene = this.scene;
        if (!pawn) return;
        const name = pawn.displayName?.() || "Wanderer";
        pawn.createDeathCorpse?.({ spawn: true });
        this.wanderers = this.wanderers.filter((w) => w !== pawn);
        pawn.setVisible(false);
        if (pawn.body) pawn.body.enable = false;
        const killerName = killer?.displayName?.() || (killer === scene.player ? "You" : null);
        if (killer === scene.player || scene.party?.includes(killer)) {
            scene.combatLog?.push(killerName === "You" || killer === scene.player
                ? `You slew ${name}.`
                : `${killer.displayName()} slew ${name}.`);
        }
        scene.time?.delayedCall?.(0, () => pawn.destroy?.());
    }

    nearestParty(x, y) {
        return typeof Party !== "undefined"
            ? Party.nearestLiving(this.scene.party, x, y)
            : this.scene.player;
    }

    /** One hop: hitting a passerby makes nearby unrecruited wanderers fight the party. */
    alertNearbyWanderers(victim, source) {
        if (!victim || !source) return;
        const scene = this.scene;
        if (source !== scene.player && source !== scene.leader && !scene.party?.includes(source)) {
            return;
        }
        const ts = scene.tileSize || 16;
        const tiles = (typeof Party !== "undefined" && Party.WANDERER_ALERT_TILES) || 10;
        const rangeSq = (tiles * ts) * (tiles * ts);
        for (const w of this.wanderers) {
            if (!w || w === victim || !w.active || w.isBodyDead?.()) continue;
            const dx = w.x - victim.x;
            const dy = w.y - victim.y;
            if (dx * dx + dy * dy > rangeSq) continue;
            w.wandererAI?.onDamaged?.(source);
            w.hostile = true;
            w.recruitLocked = true;
            if (typeof Party !== "undefined") Party.setWildAggroOwner?.(w, source);
            w.syncNameLabel?.();
        }
    }

    isAlly(a, b) {
        return typeof Party !== "undefined" ? Party.sameParty(a, b) : false;
    }

    markPvpHit(attacker) {
        const oid = attacker?.ownerId || attacker?._remote?.ownerId;
        if (oid && oid !== this.scene.leader?.ownerId && oid !== this.scene._netPlayerId) {
            this.pvpAggro.add(oid);
            this.syncRemoteNameColors();
        }
    }

    onPvpHit(ev) {
        const selfId = this.scene._netPlayerId || this.scene.leader?.ownerId || this.scene.leader?.pawnId;
        if (!ev || !selfId) return;
        if (this.scene.leader?._bodyDead) return;
        if (ev.attackerOwnerId && ev.attackerOwnerId === selfId && ev.victimOwnerId) {
            if (!this._ownerLeaderDead(ev.victimOwnerId)) {
                this.pvpAggro.add(ev.victimOwnerId);
                const vic = this._findRemoteTarget(ev.victimOwnerId, ev.victimId);
                if (vic) this.notePlayerHit(vic);
            }
        }
        if (ev.victimOwnerId && ev.victimOwnerId === selfId && ev.attackerOwnerId) {
            if (!this._ownerLeaderDead(ev.attackerOwnerId)) {
                this.pvpAggro.add(ev.attackerOwnerId);
                const atk = this._findRemoteTarget(ev.attackerOwnerId, ev.attackerId);
                if (atk) this.notePlayerHit(atk);
            }
        }
        this.syncRemoteNameColors();
        this.scene.partyPanel?.refresh?.();
    }

    _ownerLeaderDead(ownerId) {
        if (!ownerId) return false;
        const leader = this.scene.remotePlayers?.get(ownerId);
        return !!(leader && leader.dead);
    }

    syncRemoteNameColors() {
        for (const entry of this.scene.remotePlayers?.values?.() || []) {
            if (!entry?.name?.setColor) continue;
            entry.name.setColor(this.nameColorFor({
                ownerId: entry.ownerId,
                hostile: !!entry.hostile,
                role: entry.role
            }));
        }
    }

    clearPvpAggro(ownerId = null) {
        let changed = false;
        if (ownerId) {
            if (this.pvpAggro.delete(ownerId)) changed = true;
        } else if (this.pvpAggro.size) {
            this.pvpAggro.clear();
            changed = true;
        }
        const hit = this.lastHitMob;
        if (hit) {
            const oid = hit.ownerId || hit._remote?.ownerId;
            if (!ownerId || oid === ownerId) {
                this.lastHitMob = null;
                changed = true;
            }
        }
        for (const p of this.scene.party || []) {
            const t = p.partyAI?.assistTarget;
            if (!t) continue;
            const oid = t.ownerId || t._remote?.ownerId;
            if (!ownerId || oid === ownerId) {
                p.partyAI.setAssist(null);
                changed = true;
            }
        }
        if (changed) {
            this.syncRemoteNameColors();
            this.scene.partyPanel?.refresh?.();
        }
    }

    _playerCanFight(a, b) {
        const P = typeof Party !== "undefined" ? Party : null;
        const oa = P?.ownerIdOf?.(a) || a?.ownerId || a?._remote?.ownerId;
        const ob = P?.ownerIdOf?.(b) || b?.ownerId || b?._remote?.ownerId;
        const self = this.scene.leader?.ownerId || this.scene._netPlayerId;
        if (oa && ob) {
            if (oa === ob) return false;
            if (this._ownerLeaderDead(oa) || this._ownerLeaderDead(ob)) return false;
            return this.pvpAggro.has(oa) || this.pvpAggro.has(ob);
        }
        const ownerId = oa || ob;
        const wild = oa ? b : a;
        if (ownerId && self && ownerId !== self) return false;
        if (!P?.ownerEngagedWithWild) return true;
        return P.ownerEngagedWithWild(self || ownerId, wild, { lastHitMob: this.lastHitMob });
    }

    _findRemoteTarget(ownerId, pawnId) {
        if (!ownerId) return null;
        const remotes = this.scene.remotePlayers;
        if (!remotes) return null;
        let fallback = null;
        for (const entry of remotes.values()) {
            if (entry.ownerId !== ownerId || entry.dead) continue;
            const wrap = this._wrapRemote(entry);
            if (pawnId && entry.pawnId === pawnId) return wrap;
            if (!fallback) fallback = wrap;
        }
        return fallback;
    }

    _wrapRemote(entry) {
        if (!entry) return null;
        if (entry._combatTarget) return entry._combatTarget;
        const t = {
            _remote: entry,
            hitboxSize: 8,
            isBodyDead() { return !!entry.dead; },
            bodyCenter() { return { x: entry.x + 8, y: entry.y - 8 }; },
            hurtbox() {
                return {
                    left: entry.x,
                    right: entry.x + 16,
                    top: entry.y - 16,
                    bottom: entry.y
                };
            }
        };
        Object.defineProperty(t, "ownerId", { get: () => entry.ownerId });
        Object.defineProperty(t, "pawnId", { get: () => entry.pawnId });
        Object.defineProperty(t, "active", {
            get: () => !entry.dead && !!entry.root?.visible
        });
        Object.defineProperty(t, "x", { get: () => entry.x });
        Object.defineProperty(t, "y", { get: () => entry.y });
        entry._combatTarget = t;
        return t;
    }

    nameColorFor(pawn) {
        const P = typeof Party !== "undefined" ? Party : null;
        const ally = P?.COLOR_ALLY || "#80e080";
        const enemy = P?.COLOR_ENEMY || "#ff6666";
        const neu = P?.COLOR_NEUTRAL || "#ffffff";
        if (!pawn) return neu;
        if (pawn.role === "wanderer") return pawn.hostile ? enemy : neu;
        if (this.scene.party?.includes(pawn) || pawn === this.scene.leader) return ally;
        const oid = pawn.ownerId || pawn._remote?.ownerId;
        if (oid && this.pvpAggro.has(oid)) return enemy;
        if (pawn.hostile) return enemy;
        return neu;
    }

    _holdingBandage() {
        const scene = this.scene;
        const held = scene.player?.getHeldItem?.();
        const meta = held ? scene.getItem(held.id) : null;
        return !!meta?.bandage;
    }

    _holdingFood() {
        const scene = this.scene;
        const held = scene.player?.getHeldItem?.();
        if (!held) return false;
        const meta = scene.getItem(held.id);
        const food = held.food || meta?.food;
        return Number(food?.kc ?? 0) > 0;
    }

    _needsForceFeed(pawn) {
        if (!pawn || pawn.isBodyDead?.()) return false;
        return !!(pawn._downed || pawn._prone || pawn.isIncapacitated?.());
    }

    _partyMemberUnderPointer(pointer) {
        const scene = this.scene;
        const cam = scene.cameras?.main;
        if (!pointer || !cam) return null;
        const world = cam.getWorldPoint(pointer.x, pointer.y);
        const hit = (p) => {
            if (!p?.active || p.isBodyDead?.()) return false;
            const hs = (p.hitboxSize || 8) + 4;
            return Math.abs((p.x || 0) - world.x) < hs && Math.abs((p.y || 0) - world.y) < hs * 2;
        };
        for (const p of scene.party || []) {
            if (p && p !== scene.player && hit(p)) return p;
        }
        return null;
    }

    /** Living downed ally under the cursor (prone hitboxes often miss Phaser's test). */
    downedAllyUnderPointer(pointer) {
        const scene = this.scene;
        const cam = scene.cameras?.main;
        if (!pointer || !cam) return null;
        const world = cam.getWorldPoint(pointer.x, pointer.y);
        const P = typeof Party !== "undefined" ? Party : null;
        for (const p of scene.party || []) {
            if (!p?.active || p === scene.player) continue;
            if (p.isBodyDead?.() || p._bodyDead) continue;
            if (!(p._downed || p._prone || p.isIncapacitated?.() || P?.walkThrough?.(p))) {
                continue;
            }
            const hs = (p.hitboxSize || 8) + 6;
            if (Math.abs((p.x || 0) - world.x) <= hs && Math.abs((p.y || 0) - world.y) <= hs) {
                return p;
            }
        }
        return null;
    }

    _isWorldLoot(obj) {
        if (!obj?.active) return false;
        if (typeof obj.tryPickup === "function" && obj.item && obj.quantity != null) return true;
        if (typeof obj.pickUp === "function" && typeof obj.canPickup === "function" && obj.meta?.lootable) {
            return true;
        }
        return false;
    }

    _tryPickupUnderPointer(pointer) {
        const scene = this.scene;
        if (!pointer) return false;
        const hits = scene.input?.hitTestPointer?.(pointer) || [];
        for (let i = hits.length - 1; i >= 0; i--) {
            const obj = hits[i];
            if (!this._isWorldLoot(obj)) continue;
            if (typeof obj.tryPickup === "function" && obj.item) {
                obj.tryPickup();
                return true;
            }
            if (obj.canPickup?.()) {
                obj.pickUp();
                return true;
            }
        }
        return false;
    }

    pointerBlocksLoot(pointer) {
        const scene = this.scene;
        if (!pointer || !scene.player) return false;
        const cam = scene.cameras?.main;
        if (!cam) return false;
        const P = typeof Party !== "undefined" ? Party : null;
        const care = this._holdingBandage() || this._holdingFood();
        const world = cam.getWorldPoint(pointer.x, pointer.y);
        const hit = (p) => {
            if (!p?.active || p.isBodyDead?.()) return false;
            if (P?.walkThrough?.(p)) {
                if (!care) return false;
                if (this._holdingFood() && !this._holdingBandage() && !this._needsForceFeed(p)) {
                    return false;
                }
            }
            const hs = (p.hitboxSize || 8) + 4;
            return Math.abs((p.x || 0) - world.x) < hs && Math.abs((p.y || 0) - world.y) < hs * 2;
        };
        for (const w of this.wanderers) {
            if (w.role === "wanderer" && !w.hostile && hit(w)) return true;
        }
        for (const p of scene.party || []) {
            if (p && p !== scene.player && hit(p)) return true;
        }
        return false;
    }

    _itemLabel(item, itemId) {
        const id = item?.id || itemId;
        const meta = id ? this.scene.getItem?.(id) : null;
        return item?.customName || meta?.name || "";
    }

    /**
     * What a recruited pawn is busy with right now (empty if idle).
     * Used as a live tooltip source so the tip clears when the channel ends.
     */
    activityTooltip(pawn) {
        if (!pawn || pawn.isBodyDead?.()) return "";

        const tend = pawn._tendChannel;
        if (tend && !tend.corpse) {
            const who = tend.patient;
            const other = who && who !== pawn;
            const part = tend.targetHint?.partName || tend.target?.part?.name;
            const patient = other ? (who.displayName?.() || "ally") : null;
            if (other && part) return `Tending ${patient}'s ${part}`;
            if (other) return `Tending ${patient}`;
            if (part) return `Tending ${part}`;
            return "Tending";
        }
        if (pawn._skinChannel) return "Skinning";
        if (pawn._fleshChannel) return "Fleshing a hide";
        if (pawn._brainChannel) return "Brain tanning";
        if (pawn._craftChannel) {
            const recipe = pawn._craftChannel.recipe?.name;
            return recipe ? `Crafting ${recipe}` : "Crafting";
        }
        const eat = pawn._eatChannel;
        if (eat) {
            const foodName = this._itemLabel(eat.item, eat.itemId);
            const patient = eat.patient && eat.patient !== pawn;
            if (patient) {
                const pn = eat.patient.displayName?.() || "ally";
                return foodName ? `Feeding ${pn} ${foodName}` : `Feeding ${pn}`;
            }
            return foodName ? `Eating ${foodName}` : "Eating";
        }
        if (pawn.isVomiting?.()) return "Vomiting";
        if (this._isBeingTended(pawn)) return "Being tended";
        if (pawn._chopBar) return "Chopping";
        if (pawn._downed || pawn._prone || pawn.isIncapacitated?.()) return "Downed";
        return "";
    }

    /** World-hover tip: wanderer recruit text, or name + activity (incl. Downed). */
    hoverTooltip(pawn) {
        if (!pawn || pawn.isBodyDead?.()) return "";
        if (pawn.role === "wanderer") return this.recruitTooltip(pawn) || "";
        const busy = this.activityTooltip(pawn) || "";
        const downed = !!(pawn._downed || pawn._prone || pawn.isIncapacitated?.());
        if (!busy && !downed) return "";
        const name = pawn.displayName?.() || pawn.pawnName || "";
        const line = busy || "Downed";
        if (downed) return name ? `${name}\n${line}` : line;
        return line;
    }

    recruitTooltip(wanderer) {
        const scene = this.scene;
        const me = scene.player;
        const P = typeof Party !== "undefined" ? Party : { CAP: 6 };
        if (!wanderer || wanderer.role !== "wanderer") return "";
        const name = wanderer.displayName?.() || wanderer.pawnName || "Wanderer";
        if (wanderer.hostile || wanderer.recruitLocked) return name;
        const lines = [name];
        if ((scene.party?.length || 0) >= P.CAP) {
            lines.push("Party is full");
            return lines.join("\n");
        }
        const myId = scene.leader?.pawnId || scene.characterId;
        if (wanderer.refusedBy?.has(myId)) {
            lines.push("Not interested");
            return lines.join("\n");
        }
        lines.push("Click to recruit");
        const held = me?.getHeldItem?.();
        const meta = held ? scene.getItem(held.id) : null;
        const food = held?.food || meta?.food;
        if (food && Number(food.kc ?? 0) > 0) lines.push("They look interested");
        return lines.join("\n");
    }

    assistTargetFor(pawn) {
        return this.duelTargetFor(pawn);
    }

    duelTargetFor(entity) {
        const id = typeof Party !== "undefined"
            ? Party.pawnIdOf(entity)
            : (entity?.pawnId || entity?.id || entity?.uid);
        if (!id || !this._duelMap) return null;
        const t = this._duelMap.get(id);
        return t && !t.isBodyDead?.() ? t : null;
    }

    _rebuildDuelAssignments() {
        const P = typeof Party !== "undefined" ? Party : null;
        if (!P?.assignDuels) {
            this._duelMap = new Map();
            this._duelIds = new Map();
            this._duelEntities = [];
            return;
        }
        const scene = this.scene;
        const entries = [];
        const controlled = scene.player;
        for (const p of scene.party || []) {
            if (!p?.active || p.isBodyDead?.()) continue;
            const occupy = p === controlled || !!p.isControlled?.();
            entries.push({
                entity: p,
                occupyOnly: occupy,
                preferredTarget: occupy ? this._occupyTarget(p) : null
            });
        }
        for (const w of this.wanderers) {
            if (!w?.active || w.isBodyDead?.() || !w.hostile) continue;
            entries.push({ entity: w });
        }
        for (const mob of scene.mobs?.getChildren?.() || []) {
            if (!mob?.active || mob.isBodyDead?.()) continue;
            if (!(mob.ai?.hostile || mob.hostile || (mob.ai?.panicMs || 0) > 0)) continue;
            entries.push({ entity: mob });
        }
        const hunted = this._resolveAssistTarget(this.lastHitMob);
        if (hunted) entries.push({ entity: hunted });
        if (this.pvpAggro.size) {
            for (const entry of scene.remotePlayers?.values?.() || []) {
                if (!entry?.ownerId || !this.pvpAggro.has(entry.ownerId) || entry.dead) continue;
                const wrap = this._wrapRemote(entry);
                if (wrap) entries.push({ entity: wrap });
            }
        }
        const map = P.assignDuels(entries, this._duelIds, {
            tileSize: scene.tileSize || 16,
            canFight: (a, b) => this._playerCanFight(a, b)
        });
        this._duelMap = map;
        const ids = new Map();
        for (const [id, ent] of map) {
            const tid = P.pawnIdOf(ent);
            if (tid) ids.set(id, tid);
        }
        this._duelIds = ids;
        this._duelEntities = entries.map((e) => e.entity);
    }

    _occupyTarget(pawn) {
        const now = this.scene.time?.now || 0;
        if (this.lastHitMob && now - this.lastHitAt < 8000) {
            const resolved = this._resolveAssistTarget(this.lastHitMob);
            if (resolved && !resolved.isBodyDead?.()) return resolved;
        }
        const from = pawn || this.scene.player;
        const ts = this.scene.tileSize || 16;
        const cap = ((typeof Party !== "undefined" && Party.DUEL_CLUSTER_TILES) || 12) * ts;
        let best = null;
        let bestD = Infinity;
        const consider = (t) => {
            if (!t || t === from || t.isBodyDead?.()) return;
            const d = Math.hypot((t.x || 0) - (from?.x || 0), (t.y || 0) - (from?.y || 0));
            if (d > cap || d >= bestD) return;
            bestD = d;
            best = t;
        };
        for (const mob of this.scene.mobs?.getChildren?.() || []) {
            if (mob.ai?.hostile || mob.hostile) consider(mob);
        }
        for (const w of this.wanderers) {
            if (w?.hostile) consider(w);
        }
        if (this.pvpAggro.size) {
            for (const entry of this.scene.remotePlayers?.values?.() || []) {
                if (!entry?.ownerId || !this.pvpAggro.has(entry.ownerId) || entry.dead) continue;
                consider(this._wrapRemote(entry));
            }
        }
        return best;
    }

    _resolveAssistTarget(target) {
        if (!target) return null;
        if (this.scene.party?.includes(target) || target === this.scene.leader) return null;
        if (target._remote) {
            const entry = target._remote;
            if (entry.dead || !entry.root?.visible) return null;
            return target;
        }
        if (target.active && !target.isBodyDead?.()) return target;
        if (target.ownerId) return this._findRemoteTarget(target.ownerId, target.pawnId);
        return null;
    }

    _nearestPvpTarget(pawn) {
        if (!this.pvpAggro.size) return null;
        const from = pawn || this.scene.player;
        let best = null;
        let bestD = Infinity;
        for (const entry of this.scene.remotePlayers?.values?.() || []) {
            if (!entry?.ownerId || !this.pvpAggro.has(entry.ownerId) || entry.dead) continue;
            const wrap = this._wrapRemote(entry);
            if (!wrap?.active) continue;
            const d = Math.hypot((wrap.x || 0) - (from?.x || 0), (wrap.y || 0) - (from?.y || 0));
            if (d < bestD) {
                bestD = d;
                best = wrap;
            }
        }
        return best;
    }

    _aiHuntingParty(mob) {
        const t = mob.ai?._combatTarget;
        if (!t) return false;
        return this.scene.party?.includes(t) || t === this.scene.leader || t === this.scene.player;
    }

    notePlayerHit(target) {
        if (!target || this.scene.party?.includes(target)) return;
        if (target === this.scene.leader || target === this.scene.player) return;
        this.lastHitMob = target;
        this.lastHitAt = this.scene.time?.now || 0;
        const oid = target.ownerId || target._remote?.ownerId;
        if (!oid && typeof Party !== "undefined") {
            Party.setWildAggroOwner?.(target, this.scene.player);
        }
        const self = this.scene.leader?.ownerId || this.scene._netPlayerId;
        if (oid && self && oid !== self) {
            this.pvpAggro.add(oid);
            this.syncRemoteNameColors();
        }
    }

    update(time, delta) {
        const scene = this.scene;
        if (scene._gamePaused && scene._isSingleplayerSession?.()) return;
        const dedicated = !!(scene.isNet && scene.net?.connected && !scene.net.isLocal);
        if (!dedicated) this._rebuildDuelAssignments();

        for (const p of scene.party || []) {
            if (!p?.active) continue;
            p.update(time, delta);
            p.syncNameLabel?.();
            p.syncPawnChannelBar?.();
        }
        for (const w of this.wanderers) {
            if (!w?.active) continue;
            if (w._bodyDead) continue;
            if (dedicated) {
                this._puppetWanderer(w, delta);
            } else {
                w.wandererAI?.update(delta);
                if (w.isAttacking?.()) {
                    const progress = w._attackProgress?.() ?? 0;
                    if (w.weaponSprite?.visible) w._updateWeaponSprite?.(progress);
                    if (w.unarmedSprite?.visible) w._updateUnarmedSprite?.(progress);
                    w._meleeHitCheck?.(progress);
                    w.attackTimer -= delta;
                    if (w.attackTimer <= 0) w._endAttack?.();
                }
            }
            w.syncNameLabel?.();
        }
        this._tickBandage();
        this._tickFood();
        this._tickDirector(delta);
        if (!dedicated) this._despawnWanderersAtEdge();
        scene.partyPanel?.refresh?.();
        scene.partyPanel?.updatePips?.();
    }

    /** Dedicated: follow server pose, play walk/idle, keep name/hitbox on the sprite. */
    _puppetWanderer(w, delta) {
        const tx = w._netTx;
        const ty = w._netTy;
        if (Number.isFinite(tx) && Number.isFinite(ty)) {
            const fromX = Number.isFinite(w._netFromX) ? w._netFromX : w.x;
            const fromY = Number.isFinite(w._netFromY) ? w._netFromY : w.y;
            const err = Math.hypot(tx - fromX, ty - fromY);
            if (err > 72 || !Number.isFinite(w._netSnapAt)) {
                w.x = tx;
                w.y = ty;
            } else {
                const snapDt = w._netSnapDt || (1000 / 15);
                const age = performance.now() - w._netSnapAt;
                let u = snapDt > 0 ? age / snapDt : 1;
                if (u > 1) u = 1;
                w.x = fromX + (tx - fromX) * u;
                w.y = fromY + (ty - fromY) * u;
            }
            if (!w.isAttacking?.()) {
                const snapDist = Number.isFinite(w._netSnapDist) ? w._netSnapDist : err;
                const wantWalk = w._netMoving === true || snapDist > 1;
                if (wantWalk) {
                    w._puppetMoving = true;
                    w._puppetStillMs = 0;
                } else {
                    w._puppetStillMs = (w._puppetStillMs || 0) + (delta || 16);
                    if (w._puppetStillMs > 100) w._puppetMoving = false;
                }
                const moving = !!w._puppetMoving;
                if (moving) {
                    const dx = tx - fromX;
                    const dy = ty - fromY;
                    if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
                        if (Math.abs(dx) > Math.abs(dy)) w.facing = dx > 0 ? "right" : "left";
                        else w.facing = dy > 0 ? "down" : "up";
                    }
                }
                if (w.anims) w.anims.timeScale = 0.45;
                if (typeof PlayerLook !== "undefined") PlayerLook.play(w, w.facing || "down", moving);
            }
        }
        if (w.isAttacking?.()) {
            const progress = w._attackProgress?.() ?? 0;
            if (w.weaponSprite?.visible) w._updateWeaponSprite?.(progress);
            if (w.unarmedSprite?.visible) w._updateUnarmedSprite?.(progress);
            w.attackTimer -= delta;
            if (w.attackTimer <= 0) w._endAttack?.();
        }
        w.setVelocity?.(0, 0);
        w.setDepth(w.y | 0);
        w.syncFxRoot?.();
    }

    onRecruitResult(ev) {
        const scene = this.scene;
        const wid = ev?.wandererId;
        const w = this.wanderers.find((p) => p.pawnId === wid);
        if (!ev?.accepted) {
            const name = w?.displayName?.() || "Wanderer";
            const myId = scene.leader?.pawnId || scene.characterId || scene._netPlayerId;
            if (w && myId) w.refusedBy.add(myId);
            scene.combatLog?.push(`${name} is not interested.`);
            w?.syncNameLabel?.();
            return;
        }
        if (w) {
            this._promoteWanderer(w);
        }
        const name = ev.name || "Wanderer";
        scene.combatLog?.push(`${name} joins you.`);
    }

    _promoteWanderer(w) {
        const scene = this.scene;
        if (!w) return;
        this.wanderers = this.wanderers.filter((p) => p !== w);
        w.role = "companion";
        w.hostile = false;
        w.recruitLocked = false;
        w.wandererAI = null;
        w.ownerId = scene.leader?.ownerId || scene._netPlayerId;
        w.leaderId = scene.leader?.pawnId;
        w.faction = (typeof Party !== "undefined" && Party.partyFactionId)
            ? Party.partyFactionId(w.ownerId)
            : `party:${w.ownerId}`;
        if (!w.partyAI) w.partyAI = new PartyAI(w);
        this._enablePawnPhysics(w);
        this._wirePawn(w);
        w._netTx = w.x;
        w._netTy = w.y;
        if (!scene.party) scene.party = [];
        if (!scene.party.includes(w)) scene.party.push(w);
        w.syncNameLabel?.();
        scene.partyPanel?.refresh?.();
    }

    _tickBandage() {
        const scene = this.scene;
        if (this._partyInCombat()) {
            this._cancelAutoTends();
            return;
        }
        for (const pawn of scene.party || []) {
            if (!pawn || pawn === scene.player) continue;
            if (pawn.isBodyDead?.() || pawn.isVomiting?.() || pawn.isIncapacitated?.() || pawn._downed) continue;
            if (pawn.isImmobile?.()) continue;
            if (pawn.isAttacking?.() || pawn._eatChannel || pawn._tendChannel) continue;
            if (pawn.partyAI?.assistTarget) continue;
            pawn.capacities = pawn.capacities || (pawn.anatomy ? new Capacities(pawn.anatomy) : null);
            if (!pawn.capacities?.canManipulate?.()) continue;
            const job = this._pickAutoTend(pawn);
            if (!job) continue;
            pawn.beginTend?.(job.patient, {
                slot: job.slot,
                sourcePawn: job.source,
                silent: true,
                target: job.target
            });
        }
    }

    _cancelAutoTends() {
        const scene = this.scene;
        for (const pawn of scene.party || []) {
            if (!pawn || pawn === scene.player) continue;
            const ch = pawn._tendChannel;
            if (ch && !ch.corpse) pawn._cancelTend?.();
        }
    }

    _partyInCombat() {
        const scene = this.scene;
        const now = scene.time?.now || 0;
        if (this._liveCombat()) {
            this._combatSeenAt = now;
            return true;
        }
        return !!(this._combatSeenAt && now - this._combatSeenAt < 4000);
    }

    _liveCombat() {
        const scene = this.scene;
        const now = scene.time?.now || 0;
        const hit = this.lastHitMob;
        if (hit && now - this.lastHitAt < 8000 && !hit.isBodyDead?.()) return true;
        for (const p of scene.party || []) {
            if (!p || p.isBodyDead?.()) continue;
            if (p.isAttacking?.() || p.partyAI?.assistTarget) return true;
        }
        const ts = scene.tileSize || 16;
        const range = ((typeof Party !== "undefined" && Party.DUEL_CLUSTER_TILES) || 12) * ts;
        const nearParty = (x, y) => {
            for (const p of scene.party || []) {
                if (!p || p.isBodyDead?.()) continue;
                if (Math.hypot((x || 0) - p.x, (y || 0) - p.y) <= range) return true;
            }
            return false;
        };
        for (const w of this.wanderers) {
            if (w?.hostile && !w.isBodyDead?.() && nearParty(w.x, w.y)) return true;
        }
        for (const mob of scene.mobs?.getChildren?.() || []) {
            if (!mob?.active || mob.isBodyDead?.()) continue;
            if (!(mob.ai?.hostile || mob.hostile || (mob.ai?.panicMs || 0) > 0)) continue;
            if (nearParty(mob.x, mob.y)) return true;
        }
        for (const entry of scene.netMobs?.values?.() || []) {
            if (!entry || entry.dead || entry.prone) continue;
            if (!(entry.hostile || entry.panic || (entry.attackTimer || 0) > 0)) continue;
            if (nearParty(entry.x, entry.y)) return true;
        }
        if (this.pvpAggro.size) {
            for (const entry of scene.remotePlayers?.values?.() || []) {
                if (!entry?.ownerId || !this.pvpAggro.has(entry.ownerId) || entry.dead) continue;
                if (nearParty(entry.x, entry.y)) return true;
            }
        }
        return false;
    }

    _tendWoundKeys(patient, spec) {
        const pid = patient?.pawnId || patient?.id || "";
        const keys = [];
        const destroyed = spec?.destroyed?.partName || spec?.destroyedPartName;
        if (destroyed) keys.push(`${pid}#d:${destroyed}`);
        const part = spec?.part?.name || spec?.partName || "";
        const inj = spec?.inj;
        const injId = spec?.injuryId ?? inj?.id;
        if (injId != null && injId !== "") keys.push(`${pid}#i:${injId}`);
        if (inj || spec?.injuryName) {
            const name = spec?.injuryName || inj?.name || "";
            const idx = Number.isInteger(spec?.injuryIndex)
                ? spec.injuryIndex
                : (spec?.part && inj ? spec.part.injuries.indexOf(inj) : -1);
            keys.push(`${pid}#p:${part}:${idx}:${name}`);
            if (name) keys.push(`${pid}#p:${part}:${name}`);
        }
        return keys;
    }

    _reservedTendKeys(exceptTender) {
        const reserved = new Set();
        for (const p of this.scene.party || []) {
            if (!p || p === exceptTender) continue;
            const ch = p._tendChannel;
            if (!ch || ch.corpse) continue;
            const patient = ch.patient || p;
            const spec = ch.targetHint || ch.target;
            if (!spec) continue;
            for (const k of this._tendWoundKeys(patient, spec)) reserved.add(k);
        }
        return reserved;
    }

    _woundIsReserved(reserved, patient, spec) {
        if (!reserved?.size) return false;
        return this._tendWoundKeys(patient, spec).some((k) => reserved.has(k));
    }

    _isBeingTended(patient) {
        for (const p of this.scene.party || []) {
            const ch = p?._tendChannel;
            if (ch && !ch.corpse && ch.patient === patient) return true;
        }
        return false;
    }

    _isTendLocked(pawn) {
        if (!pawn) return false;
        const ch = pawn._tendChannel;
        if (ch && !ch.corpse) return true;
        return this._isBeingTended(pawn);
    }

    _pickBandage(tender, patient, selfOnly) {
        const scene = this.scene;
        const skipHeld = scene.player && scene.hotbar
            ? { pawn: scene.player, slot: scene.hotbar.activeIndex }
            : null;
        const bags = selfOnly ? [tender] : [tender, patient];
        const seen = new Set();
        for (const p of bags) {
            if (!p || seen.has(p)) continue;
            seen.add(p);
            for (let i = 0; i < (p.inventory || []).length; i++) {
                const stack = p.inventory[i];
                if (!stack) continue;
                if (skipHeld && p === skipHeld.pawn && i === skipHeld.slot) continue;
                const meta = scene.getItem(stack.id);
                if (!meta?.bandage) continue;
                return { source: p, slot: i, stack };
            }
        }
        return null;
    }

    _pickAutoTend(tender) {
        const scene = this.scene;
        const P = typeof Party !== "undefined" ? Party : { INTERACT_TILES: 4 };
        const ts = scene.tileSize || 16;
        const reserved = this._reservedTendKeys(tender);
        const others = [];
        let selfJob = null;
        for (const p of scene.party || []) {
            if (!p || p.isBodyDead?.() || !p.anatomy) continue;
            const skip = (spec) => this._woundIsReserved(reserved, p, spec);
            const target = BodyHealing?.pickTendTarget?.(p.anatomy, { skip });
            if (!target) continue;
            const bleeding = !!(target.inj?.bleeding || target.destroyed);
            if (p === tender) {
                const bandage = this._pickBandage(tender, tender, true);
                if (bandage) selfJob = { patient: p, bleeding, ...bandage, target };
                continue;
            }
            if (P && !P.inInteractRange(tender, p, ts)) continue;
            const bandage = this._pickBandage(tender, p, false);
            if (!bandage) continue;
            const dist = Math.hypot(p.x - tender.x, p.y - tender.y);
            others.push({ patient: p, bleeding, dist, ...bandage, target });
        }
        others.sort((a, b) => {
            if (a.bleeding !== b.bleeding) return a.bleeding ? -1 : 1;
            return a.dist - b.dist;
        });
        if (others.length && others[0].bleeding) return others[0];
        if (selfJob?.bleeding) return selfJob;
        if (others.length) return others[0];
        return selfJob;
    }

    _tickFood() {
        const scene = this.scene;
        const dedicated = !!(scene.isNet && scene.net?.connected && !scene.net.isLocal);
        const P = typeof Party !== "undefined" ? Party : { AUTO_EAT_BELOW: 1000, AUTO_EAT_UNTIL: 1400, INTERACT_TILES: 4 };
        const ts = scene.tileSize || 16;
        if (this._partyInCombat()) return;
        for (const pawn of scene.party || []) {
            if (!pawn || pawn === scene.player) continue;
            if (pawn.isBodyDead?.() || pawn.isVomiting?.() || pawn.isIncapacitated?.()) continue;
            if (pawn.isAttacking?.() || pawn._eatChannel || pawn._tendChannel) continue;
            if (dedicated && pawn._netEating) continue;
            if (pawn.partyAI?.assistTarget) continue;
            if ((pawn.kc || 0) >= P.AUTO_EAT_BELOW) {
                this._eatSittings.delete(pawn.pawnId);
                continue;
            }
            const mal = !!pawn.anatomy?.hediff?.("malnutrition");
            const sitting = this._eatSittings.get(pawn.pawnId);
            const until = sitting ? P.AUTO_EAT_UNTIL : P.AUTO_EAT_BELOW;
            if (sitting && pawn.kc >= until) {
                this._eatSittings.delete(pawn.pawnId);
                continue;
            }
            const pick = this._pickAutoEat(pawn, mal, ts);
            if (!pick) continue;
            const poisonous = this._isPoisonFood(pick.stack, scene);
            if (poisonous && sitting?.poisonStop) continue;
            const ok = pawn.beginEat(pick.stack, {
                slot: pick.slot,
                sourcePawn: pick.pawn
            });
            if (ok) {
                this._eatSittings.set(pawn.pawnId, {
                    until: poisonous ? pawn.kc + 1 : P.AUTO_EAT_UNTIL,
                    poisonStop: poisonous
                });
                if (scene.isNet && scene.net?.connected && !scene.net.isLocal) {
                    scene.net.sendAction({
                        type: NetProtocol.Actions.PARTY_EAT,
                        eaterId: pawn.pawnId,
                        fromPawnId: pick.pawn.pawnId,
                        slot: pick.slot
                    });
                }
            }
        }
    }

    _isPoisonFood(stack, scene) {
        const meta = scene.getItem(stack.id);
        const food = stack.food || meta?.food;
        return Number(food?.foodPoisonChance ?? 0) > 0;
    }

    _pickAutoEat(eater, allowPoison, ts) {
        const scene = this.scene;
        const P = typeof Party !== "undefined" ? Party : { INTERACT_TILES: 4 };
        const range = (P.INTERACT_TILES || 4) * ts;
        const skipHeld = scene.player && scene.hotbar
            ? { pawn: scene.player, slot: scene.hotbar.activeIndex }
            : null;
        const candidates = [];
        for (const p of scene.party || []) {
            if (!p || p.isBodyDead?.()) continue;
            const d = Math.hypot(p.x - eater.x, p.y - eater.y);
            if (p !== eater && d > range) continue;
            for (let i = 0; i < (p.inventory || []).length; i++) {
                const stack = p.inventory[i];
                if (!stack) continue;
                if (skipHeld && p === skipHeld.pawn && i === skipHeld.slot) continue;
                const meta = scene.getItem(stack.id);
                const food = stack.food || meta?.food;
                if (!(Number(food?.kc ?? 0) > 0)) continue;
                const poison = Number(food?.foodPoisonChance ?? 0) > 0;
                if (poison && !allowPoison) continue;
                const spoil = Number(stack.spoilAt ?? stack.spoilLeft ?? Infinity);
                candidates.push({ pawn: p, slot: i, stack, spoil, own: p === eater, poison });
            }
        }
        candidates.sort((a, b) => {
            if (a.spoil !== b.spoil) return a.spoil - b.spoil;
            if (a.own !== b.own) return a.own ? -1 : 1;
            return 0;
        });
        return candidates[0] || null;
    }

    _tickDirector(delta) {
        const scene = this.scene;
        if (scene.isNet && scene.net?.connected && !scene.net.isLocal) return;
        const speed = Number(scene.tickSpeed);
        const ts = Number.isFinite(speed) && speed >= 0 ? speed : 1;
        this.directorCd -= (delta / 1000) * ts;
        if (this.wanderers.some((w) => w?.active && !w.isBodyDead?.() && !w.hostile)) return;
        if (this.directorCd > 0) return;
        this.directorCd = typeof Party !== "undefined"
            ? Party.directorCooldown(scene.party?.length || 1)
            : 90;
        this._spawnOffscreenWanderers();
    }

    _spawnOffscreenWanderers(opts = {}) {
        const scene = this.scene;
        const player = scene.player;
        if (!player) return 0;
        const ts = scene.tileSize || 16;
        const cam = scene.cameras?.main;
        const zoom = scene.worldZoom || cam?.zoom || 3;
        const view = cam?.worldView;
        const viewW = view?.width > 8 ? view.width : (scene.scale?.width || 800) / zoom;
        const viewH = view?.height > 8 ? view.height : (scene.scale?.height || 600) / zoom;
        const dist = typeof Party !== "undefined" && Party.wandererApproachDist
            ? Party.wandererApproachDist(ts, viewW, viewH)
            : Math.max(16 * ts, Math.max(viewW, viewH) * 0.5 + 6 * ts);
        const origin = typeof player.bodyCenter === "function"
            ? player.bodyCenter()
            : { x: player.x, y: player.y };
        const dirs = [
            { x: 1, y: 0, h: { x: -1, y: 0 } },
            { x: -1, y: 0, h: { x: 1, y: 0 } },
            { x: 0, y: 1, h: { x: 0, y: -1 } },
            { x: 0, y: -1, h: { x: 0, y: 1 } }
        ];
        const vx = player.body?.velocity?.x || 0;
        const vy = player.body?.velocity?.y || 0;
        if (Math.abs(vx) > Math.abs(vy) && Math.abs(vx) > 4) {
            dirs.sort((a, b) => (vx > 0 ? b.x - a.x : a.x - b.x));
        } else if (Math.abs(vy) > 4) {
            dirs.sort((a, b) => (vy > 0 ? b.y - a.y : a.y - b.y));
        }
        const partyN = scene.party?.length || 1;
        const pack = typeof Party !== "undefined" && Party.wandererPackSize
            ? Party.wandererPackSize(partyN)
            : 1;
        const full = typeof Party !== "undefined" && Party.isPartyFull
            ? Party.isPartyFull(partyN)
            : partyN >= 6;

        let anchor = null;
        for (const dir of dirs) {
            for (let n = 0; n < 10 && !anchor; n++) {
                const d = dist + n * ts;
                const jitter = (Math.random() - 0.5) * ts * 4;
                const x = origin.x + dir.x * d + (dir.x === 0 ? jitter : 0);
                const y = origin.y + dir.y * d + (dir.y === 0 ? jitter : 0);
                const { tx, ty } = scene.worldToTile?.(x, y) || {};
                if (tx == null || !scene._tileWalkable?.(tx, ty)) continue;
                anchor = { x, y, heading: dir.h };
            }
        }
        if (!anchor) return 0;

        const line = typeof Party !== "undefined" && Party.wandererPackOffsets
            ? Party.wandererPackOffsets(pack, anchor.heading, ts * 1.35)
            : [{ x: 0, y: 0 }];
        let spawned = 0;
        for (const off of line) {
            let x = anchor.x + off.x;
            let y = anchor.y + off.y;
            const tile = scene.worldToTile?.(x, y) || {};
            if (tile.tx == null || !scene._tileWalkable?.(tile.tx, tile.ty)) {
                x = anchor.x;
                y = anchor.y;
            }
            const inv = typeof Party !== "undefined" && Party.rollWandererInventory
                ? Party.rollWandererInventory(undefined, { fullParty: full })
                : null;
            if (this.spawnWanderer({ x, y, heading: anchor.heading, inventory: inv })) spawned++;
        }
        return spawned;
    }

    _despawnWanderersAtEdge() {
        const scene = this.scene;
        const keep = [];
        const px = scene.chunkPx?.() || ((scene.chunkSize || 8) * (scene.tileSize || 16));
        const r = scene.genDistance || scene.cullDistance || scene.renderDistance || 6;
        const anchors = [];
        for (const p of scene.party || []) {
            if (!p?.active || p.isBodyDead?.()) continue;
            anchors.push({
                cx: Math.floor(p.x / px),
                cy: Math.floor(p.y / px)
            });
        }
        const inInterest = (w) => {
            const wcx = Math.floor(w.x / px);
            const wcy = Math.floor(w.y / px);
            for (const a of anchors) {
                if (Math.max(Math.abs(wcx - a.cx), Math.abs(wcy - a.cy)) <= r) return true;
            }
            return false;
        };
        for (const w of this.wanderers) {
            if (!w?.active || w.isBodyDead?.()) continue;
            const chunk = scene.getChunkAtWorld?.(w.x, w.y);
            // Keep passersby in the sim radius even before their chunk finishes
            // streaming (relog used to treat "not loaded yet" as walked-off).
            if (chunk?.isLoaded || inInterest(w)) {
                keep.push(w);
                continue;
            }
            if (w.hostile) this._persistHostileWanderer(w, chunk);
            w.destroy?.();
        }
        this.wanderers = keep;
    }

    _persistHostileWanderer(w, chunk) {
        if (!chunk?.meta) return;
        if (!Array.isArray(chunk.meta.wanderers)) chunk.meta.wanderers = [];
        chunk.meta.wanderers.push(this.serializeWanderer(w));
    }

    serializeWanderer(w) {
        return {
            id: w.pawnId,
            name: w.pawnName,
            look: w.look,
            x: w.x,
            y: w.y,
            facing: w.facing,
            heading: w.heading,
            inventory: w.inventory,
            body: w.anatomy?.toJSON?.(),
            hostile: !!w.hostile,
            recruitLocked: !!w.recruitLocked,
            refusedBy: [...(w.refusedBy || [])]
        };
    }

    loadChunkWanderers(chunk) {
        const list = chunk?.meta?.wanderers;
        if (!Array.isArray(list) || !list.length) return;
        const remain = [];
        for (const snap of list) {
            if (!snap?.hostile) continue;
            if (this.wanderers.some((w) => w.pawnId === snap.id)) {
                remain.push(snap);
                continue;
            }
            this.spawnWanderer(snap);
            remain.push(snap);
        }
        chunk.meta.wanderers = remain;
    }

    debugAddCompanion() {
        const scene = this.scene;
        const P = typeof Party !== "undefined" ? Party : { CAP: 6 };
        if ((scene.party?.length || 0) >= P.CAP) {
            scene.combatLog?.push("Party is full.");
            return;
        }
        const p = this.spawnCompanion({
            x: (scene.player?.x || 0) + 20,
            y: scene.player?.y || 0
        });
        if (p) {
            this.applyRoughVitals(p);
            scene.combatLog?.push(`${p.displayName()} joins you.`);
        }
    }

    debugSpawnWanderer() {
        const scene = this.scene;
        const n = this._spawnOffscreenWanderers() || 0;
        if (n > 1) scene.combatLog?.push(`${n} wanderers approach.`);
        else if (n === 1) scene.combatLog?.push("A wanderer approaches.");
        else scene.combatLog?.push("No room to spawn a wanderer.");
        if (n > 0) {
            this.directorCd = typeof Party !== "undefined"
                ? Party.directorCooldown(scene.party?.length || 1)
                : 90;
        }
        return n;
    }

    _pawnSnapshot(p) {
        return {
            id: p.pawnId,
            name: p.pawnName,
            look: p.look,
            kc: p.kc,
            saturation: p.saturation,
            stomach: p.stomach,
            inventory: p.inventory,
            equipment: p.equipment,
            hotbarIndex: p.hotbarIndex,
            body: p.anatomy?.toJSON?.() ?? null,
            hp: p.hp,
            mhp: p.mhp,
            facing: p.facing,
            x: p.x,
            y: p.y
        };
    }

    serializeParty() {
        const scene = this.scene;
        const leader = scene.leader;
        const members = [];
        for (const p of scene.party || []) {
            if (!p || p === leader) continue;
            if (p.isBodyDead?.()) continue;
            members.push(this._pawnSnapshot(p));
        }
        return {
            party: members,
            controlId: scene.player?.pawnId || leader?.pawnId,
            leaderDead: !!this.leaderDead
        };
    }

    applyJoinParty(you, character, opts = {}) {
        const scene = this.scene;
        const members = you?.party || character?.party || [];
        const poses = scene.net?.world?.poses || {};
        const dedicated = !!(scene.isNet && scene.net?.connected && !scene.net.isLocal);
        const guard = dedicated && scene._invSwapGuardUntil && performance.now() < scene._invSwapGuardUntil;
        const ids = new Set();
        for (const m of members) {
            if (!m?.id) continue;
            ids.add(m.id);
            const wanderer = this.wanderers.find((w) => w.pawnId === m.id);
            if (wanderer) this._promoteWanderer(wanderer);
            const existing = (scene.party || []).find((p) => p.pawnId === m.id);
            if (existing) {
                if (opts.join || dedicated) {
                    if (typeof m.kc === "number") existing.kc = m.kc;
                    if (typeof m.saturation === "number") existing.saturation = m.saturation;
                    if (typeof m.stomach === "number") existing.stomach = m.stomach;
                    if (dedicated) existing._netEating = !!m.eatChannel;
                    if (dedicated && !m.eatChannel && existing._eatChannel?.serverAuth) {
                        existing._eatChannel = null;
                    }
                    const skipGear = guard && existing === scene.player;
                    if (dedicated && !skipGear && Array.isArray(m.inventory)) {
                        const sig = this._gearSig(m.inventory, m.equipment, m.hotbarIndex);
                        if (sig !== existing._netGearSig) {
                            existing.inventory = m.inventory;
                            if (m.equipment) existing.equipment = JSON.parse(JSON.stringify(m.equipment));
                            if (typeof m.hotbarIndex === "number") existing.hotbarIndex = m.hotbarIndex;
                            existing._netGearSig = sig;
                        }
                        existing.syncWaistSlots?.();
                        existing.recomputeEquipmentEffects?.();
                        if (existing === scene.player) {
                            if (scene.hotbar) {
                                scene.hotbar.setSize?.(existing.inventorySize || 5);
                                scene.hotbar.dirty = true;
                            }
                            if (scene.equipmentPanel?.visible) {
                                scene.equipmentPanel.refresh();
                                scene.equipmentPanel.layout();
                            }
                        }
                    }
                    if (dedicated && m.body && existing.anatomy?.loadJSON) {
                        const bsig = this._bodySig(m.body);
                        if (bsig !== existing._netBodySig) {
                            try { existing.anatomy.loadJSON(m.body); } catch (_) {}
                            existing.capacities = new Capacities(existing.anatomy);
                            existing._refreshDownedState?.();
                            existing._netBodySig = bsig;
                        }
                    }
                }
                continue;
            }
            const pose = poses[m.id];
            const cluster = !pose && scene.player;
            this.spawnCompanion({
                ...m,
                x: pose?.x ?? (cluster ? scene.player.x + 16 * members.indexOf(m) : m.x),
                y: pose?.y ?? (cluster ? scene.player.y : m.y),
                facing: pose?.facing || m.facing
            });
        }
        if (dedicated && you?.party) {
            for (const p of [...(scene.party || [])]) {
                if (!p || p === scene.leader) continue;
                if (!ids.has(p.pawnId) && !p.isBodyDead?.()) {
                    this.onMemberDied(p, null, { spawn: false });
                }
            }
        }
        const controlId = you?.controlId || character?.controlId;
        if (controlId && opts.join) {
            const pawn = (scene.party || []).find((p) => p.pawnId === controlId);
            if (pawn && !pawn.isBodyDead?.()) this.switchControl(pawn, { silentNet: true });
        }
        if (opts.join && (you?.leaderDead || character?.leaderDead)) {
            this.leaderDead = true;
        } else if (you && you.dead === false && !you.leaderDead) {
            this.leaderDead = false;
        } else if (you?.leaderDead || you?.dead) {
            this.leaderDead = true;
        }
        scene.partyPanel?.refresh?.();
    }

    _gearSig(inv, eq, hotbar) {
        try {
            return JSON.stringify({ inv, eq, hi: hotbar });
        } catch (_) {
            return "";
        }
    }

    _bodySig(body) {
        try {
            return JSON.stringify(body);
        } catch (_) {
            return "";
        }
    }

    applyNetPoses(rp) {
        const scene = this.scene;
        if (!rp || !scene.isNet || scene.net?.isLocal) return;
        const ctrl = scene.player;
        if (scene.leader && scene.leader !== ctrl) {
            this._setNetPose(scene.leader, rp.x, rp.y, rp.facing, rp.prone, rp);
        }
        for (const mem of rp.party || []) {
            const pawn = (scene.party || []).find((p) => p.pawnId === mem.id);
            if (!pawn || pawn === ctrl) continue;
            this._setNetPose(pawn, mem.x, mem.y, mem.facing, mem.prone, mem);
        }
    }

    _setNetPose(pawn, x, y, facing, prone, motion = null) {
        if (!pawn) return;
        if (Number.isFinite(x) && Number.isFinite(y)) {
            const prevTx = Number.isFinite(pawn._netTx) ? pawn._netTx : pawn.x;
            const prevTy = Number.isFinite(pawn._netTy) ? pawn._netTy : pawn.y;
            pawn._netSnapDist = Math.hypot(x - prevTx, y - prevTy);
            pawn._netFromX = pawn.x;
            pawn._netFromY = pawn.y;
            pawn._netTx = x;
            pawn._netTy = y;
            pawn._netSnapAt = performance.now();
            pawn._netSnapDt = 1000 / ((typeof NetProtocol !== "undefined" && NetProtocol.SNAPSHOT_HZ) || 15);
        } else {
            if (Number.isFinite(x)) pawn._netTx = x;
            if (Number.isFinite(y)) pawn._netTy = y;
        }
        if (facing) pawn._netFacing = facing;
        if (prone != null) pawn._netProne = !!prone;
        if (typeof motion?.moving === "boolean") pawn._netMoving = motion.moving;
        if (Number.isFinite(motion?.vx)) pawn._netVx = motion.vx;
        if (Number.isFinite(motion?.vy)) pawn._netVy = motion.vy;
    }

    posesMap() {
        const out = {};
        for (const p of this.scene.party || []) {
            if (!p?.pawnId) continue;
            out[p.pawnId] = { x: p.x, y: p.y, facing: p.facing || "down" };
        }
        return out;
    }
}
