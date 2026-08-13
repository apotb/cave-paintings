class SceneMain extends SceneBase {
    constructor() {
        super({ key: "SceneMain" });
    }

    init(data = {}) {
        this.net = data.net || null;
        this.welcome = data.welcome || null;
        this.displayName = data.displayName || null;
        this.joinHost = data.joinHost || localStorage.getItem("cp_join_host") || "";
        this.characterId = data.characterId || data.character?.id || null;
        this.character = data.character || null;
        this.localWorldId = data.localWorldId || null;
        this.worldName = data.worldName || data.welcome?.worldName || null;
        this.isNet = !!this.net;
        this.offline = !!data.offline || !this.isNet;
        this.remotePlayers = new Map();
        this.netMobs = new Map();
        this.netDrops = new Map();
        this.netCorpses = new Map();
        this._netPlayerId = this.welcome?.playerId || this.characterId || null;
        this._netLeaving = false;
        this._netDisconnectHandled = false;
        this._charSaveTimer = null;
        this._charSaveBusy = false;
        this._charSavePromise = null;
        this._lastYou = this.welcome?.you || null;
        this._onVisSave = null;
        this._gamePaused = false;
        this._pauseUi = null;
        this._savingUi = null;
        // 0 = Auto; 1..N = fixed integer scale (N from resolution)
        this.guiScalePref = this._loadGuiScalePref();
        this._leavingGame = false;
        // Scene instance is reused across Play → Leave → Play; Phaser destroys
        // display objects on shutdown but leaves these refs pointing at dead objects.
        this.clockText = null;
        this.lightGfx = null;
        this._uiCam = null;
        this.hotbar = null;
        this.combatLog = null;
        this.equipmentPanel = null;
        this.campfirePanel = null;
        this.corpsePanel = null;
        this.healthPanel = null;
        this.knappingPanel = null;
        this.deathOverlay = null;
        this.player = null;
        this.chunks = null;
        this.droppedItems = null;
    }

    create() {
        this.input.mouse.disableContextMenu();
        resolveCraftedWeights(this.items());
        resolveCraftedFuel(this.items());

        // Shared world seed from listen server (identical terrain for all clients)
        if (this.isNet && this.welcome?.seed != null) {
            worldSeed = this.welcome.seed;
            noise.seed(worldSeed);
        }

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

        // Shared body defs must see Phaser JSON cache before Body() runs.
        // (Phaser.Scene.data is a DataManager — do not confuse with DataStore.)
        if (typeof DataStore !== "undefined") {
            DataStore.initFromPhaserScene(this);
        }

        // Player
        this.player = new Player(this, 0, 0, this.character?.look);
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
        // Multiplayer: server owns day/minute/tickSpeed — applied from welcome + snapshots
        this.gameDay = 1;
        this.gameMinutes = 8 * 60;
        this.tickSpeed = 1;
        this._worldMinuteEvent = null;
        // Don't apply welcome clock yet — clockText / lightGfx are created below.
        if (!this.isNet) {
        this._worldMinuteEvent = this.time.addEvent({
            delay: 1000,
            callback: this.worldMinuteTick,
            callbackScope: this,
            loop: true
        });
        }

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
        if (this.isNet && this.welcome?.clock) {
            this._netApplyClock(this.welcome.clock, { catchUp: false });
        }
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
        this.keyH = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.H);
        this.keyT = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.T);
        this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        /** Display name (chat / MP) */
        this.playerName = this.displayName
            || this.welcome?.you?.name
            || localStorage.getItem("cp_display_name")
            || "Player";

        if (this.isNet) this._setupNetPlay();
    }

    /** Session play (WebSocket MP or LocalSim SP): sync via protocol, character owned client-side. */
    _setupNetPlay() {
        this._netPlayerId = this.welcome?.playerId || this.net?.playerId || this.characterId || this._netPlayerId;
        const you = this.welcome?.you || {};
        if (typeof you.x === "number" && typeof you.y === "number") {
            this.player.teleport(you.x, you.y);
            this.syncCameraToPlayer();
        }
        // First SP entry into a world: let ensureSpawnSign run pickRandomSpawnTile (same as respawn).
        // Dedicated MP / rejoin already have an authoritative pose on YOU.
        this._playerSpawnPlaced = !this.welcome?.firstSpawn;
        this.player.createAnimations?.();
        // Apply join snapshot once (including SP gear); later LocalSim YOU won't stomp inventory
        this._netForceYouInv = true;
        if (you.inventory || you.kc != null || you.equipment) this._netApplyYou(you);
        this._netForceYouInv = false;

        this.net.on(NetProtocol.Types.SNAPSHOT, (payload) => this._netApplySnapshot(payload));
        this.net.on(NetProtocol.Types.EVENT, (payload) => this._netApplyEvent(payload));
        this.net.on(NetProtocol.Types.CHUNK, (payload) => this._netApplyChunk(payload));
        this.net.on(NetProtocol.Types.YOU, (payload) => {
            this._netApplyYou(payload);
            this._scheduleCharacterSave(payload);
        });
        this.net.on(NetProtocol.Types.SESSION_END, (payload) => {
            if (payload?.reason && payload.reason !== "disconnect") {
                this._netDisconnectReason = payload.reason === "kicked"
                    ? "Kicked from server."
                    : String(payload.reason);
            }
            if (payload?.you) this._lastYou = payload.you;
            // Leave flow already saves + awaits LocalSim.close; skip racing another save.
            if (!this._leavingGame && !this._netLeaving) {
                this._saveCharacterNow(payload?.you);
            }
        });
        this.net.on(NetProtocol.Types.REJECT, (payload) => {
            this._netDisconnectReason = payload?.reason || "Kicked from server.";
        });
        this.net.on("close", () => this._netOnDisconnect());

        // LocalSim needs Chunk helpers from this scene before RESYNC interest
        this.net.attachScene?.(this);

        this.net.flushAndListen();
        this.net.sendAction({ type: NetProtocol.Actions.RESYNC });
        // Push pose immediately so others can see us before first WASD
        this._netSendMove(true);

        // Periodic character autosave (IndexedDB)
        this._charSaveTimer = this.time.addEvent({
            delay: 15000,
            loop: true,
            callback: () => this._saveCharacterNow()
        });
        this._onVisSave = () => {
            if (document.visibilityState === "hidden") this._saveCharacterNow();
        };
        document.addEventListener("visibilitychange", this._onVisSave);
    }

    _playerCharacterPartial() {
        const pl = this.player;
        if (!pl) return null;
        return {
            name: this.playerName || pl.name,
            inventory: pl.inventory,
            equipment: pl.equipment,
            hotbarIndex: pl.hotbarIndex,
            kc: pl.kc,
            saturation: pl.saturation,
            stomach: pl.stomach,
            body: pl.anatomy?.toJSON?.() ?? null,
            hp: pl.hp,
            mhp: pl.mhp,
            look: pl.look || this.character?.look || null,
            facing: pl.facing,
            x: pl.x,
            y: pl.y
        };
    }

    _scheduleCharacterSave(you) {
        if (you) this._lastYou = you;
        // Debounce burst YOU updates
        if (this._charSaveSoon) return;
        this._charSaveSoon = true;
        this.time?.delayedCall?.(400, () => {
            this._charSaveSoon = false;
            this._saveCharacterNow();
        });
    }

    async _saveCharacterNow(youOverride = null) {
        if (!this.characterId || typeof CharacterStore === "undefined") return;
        // Wait for any in-flight save so leave/quit never skips a write.
        while (this._charSavePromise) {
            await this._charSavePromise;
        }
        this._charSaveBusy = true;
        this._charSavePromise = (async () => {
            try {
                // SP: client inventory is authoritative — push into LocalSim pawn first
                if (this.net?.isLocal) {
                    const partial = this._playerCharacterPartial();
                    if (partial) this.net.syncPawnFromClient?.(partial);
                }
                let base = this.character;
                if (!base) base = await CharacterStore.get(this.characterId);
                if (!base) {
                    base = CharacterStore.defaultCharacter(this.playerName || "Player");
                    base.id = this.characterId;
                }
                const you = youOverride || this._lastYou || (this.net?.isLocal
                    ? this._playerCharacterPartial()
                    : null);
                const next = you ? CharacterStore.applyYou(base, you) : base;
                // Always fold current client gear for local sessions
                if (this.net?.isLocal) {
                    const pl = this._playerCharacterPartial();
                    if (pl) Object.assign(next, CharacterStore.applyYou(next, pl));
                }
                this.character = await CharacterStore.put(next);
            } catch (e) {
                console.warn("[character save]", e);
            } finally {
                this._charSaveBusy = false;
                this._charSavePromise = null;
            }
        })();
        return this._charSavePromise;
    }

    _netOnDisconnect() {
        if (this._netLeaving || this._netDisconnectHandled) return;
        this._netDisconnectHandled = true;
        this._netDisconnectReason = null;
        const disconnected = !this._isSingleplayerSession();
        // Save before menu (SESSION_END may already have written; this covers abrupt close)
        Promise.resolve(this._saveCharacterNow()).finally(() => {
            this._netKickToMenu(disconnected ? { disconnected: true } : {});
        });
    }

    _netKickToMenu(data = {}) {
        if (this._netLeaving) return;
        this._netLeaving = true;
        this._teardownCharacterAutosave();
        try {
            this.net?.close();
        } catch (_) {}
        this.scene.start("SceneMenu", data);
    }

    _teardownCharacterAutosave() {
        if (this._charSaveTimer) {
            this._charSaveTimer.remove?.(false);
            this._charSaveTimer = null;
        }
        if (this._onVisSave) {
            document.removeEventListener("visibilitychange", this._onVisSave);
            this._onVisSave = null;
        }
    }

    _netApplyYou(you) {
        if (!you || !this.isNet || !this.player) return;
        // LocalSim SP: after join, inventory is client-authored — don't stomp with pawn YOU
        // (vitals still apply; hunger is owned by LocalSim's clock).
        // Dedicated MP: while dead, client already dumped gear into a corpse — never
        // re-apply stale server inventory (that was the /kms dupe).
        const applyGear = (!this.net?.isLocal || this._netForceYouInv) && !this.player._bodyDead;
        if (this.player._bodyDead) {
            this._lastYou = {
                ...you,
                inventory: this.player.inventory,
                equipment: this.player.equipment,
                dead: true
            };
        } else {
            this._lastYou = you;
        }
        // Dedicated: honor server death (anatomy / PvP)
        if (
            you.dead
            && !this.player._bodyDead
            && this.net?.connected
            && !this.net.isLocal
            && !this.deathOverlay?.visible
        ) {
            this.player._bodyDead = true;
            this.player.setVelocity(0, 0);
            // Server already authored the corpse — don't dump a second empty one.
            this.onPlayerDied(null, { spawnCorpse: false });
            return;
        }
        if (this._netAwaitPoseFromYou && typeof you.x === "number" && typeof you.y === "number") {
            this.player.teleport(you.x, you.y);
            this.syncCameraToPlayer();
            this._netAwaitPoseFromYou = false;
            this._netSendMove(true);
        }
        // Dedicated: stash latest server gear. Knapping UI owns local gear while open;
        // apply as soon as it closes. Craft/campfire stay live so craft grants, /give,
        // and pickup update the hotbar immediately.
        // Do NOT drop YOU forever while `_invSwapGuardUntil` is set — that caused /give,
        // pickup, and eat qty to only appear after relog.
        if (applyGear && (Array.isArray(you.inventory) || you.equipment)) {
            this._pendingYouGear = {
                inventory: Array.isArray(you.inventory) ? you.inventory : null,
                equipment: you.equipment || null,
                hotbarIndex: you.hotbarIndex
            };
            this._flushPendingYouGear();
        }
        if (typeof you.kc === "number") this.player.kc = you.kc;
        if (typeof you.saturation === "number") this.player.saturation = you.saturation;
        if (typeof you.stomach === "number") this.player.stomach = you.stomach;
        if (you.eatChannel && typeof you.eatChannel.progress === "number"
            && this.net?.connected && !this.net.isLocal
            && this.player._eatChannel) {
            // Only while local eat channel is active — ignore stale YOU after cancel
            this.showChannelBar?.(Phaser.Math.Clamp(you.eatChannel.progress, 0, 1));
        } else if (
            this.net?.connected && !this.net.isLocal
            && !you.eatChannel
            && !this.player._eatChannel
            && !this.player._tendChannel
            && !this.player._skinChannel
        ) {
            this.hideChannelBar?.();
        }
        if (applyGear && you.body && this.player.anatomy?.loadJSON) {
            try {
                this.player.anatomy.loadJSON(you.body);
                this.player.capacities = new Capacities(this.player.anatomy);
                this.player._refreshDownedState?.();
            } catch (_) {}
        }
        // Dedicated: server prone flag (immobile / pain shock / unconscious)
        if (this.player && typeof you.prone === "boolean") {
            setCreatureProne(
                this.player,
                !!you.prone && !this.player._bodyDead && !you.dead
            );
        }
    }

    /**
     * True while a UI fully owns local gear and must not be stomped by YOU.
     * Craft is excluded: recipes are clicks only (no local gear edits) — blocking YOU
     * while craft was open hid crafted items until close and spawned phantom overflow drops.
     * Campfire is excluded: transfers use `_invSwapGuardUntil` for campfire slots only.
     */
    _inventoryUiOwnsGear() {
        return !!this.knappingPanel?.visible;
    }

    /**
     * Apply stashed YOU inventory/equipment unless knapping/craft UI owns local gear.
     * Safe to call from update / UI close; no-ops if nothing pending or UI is open.
     */
    _flushPendingYouGear() {
        const pending = this._pendingYouGear;
        if (!pending || !this.player || this.player._bodyDead) return;
        // LocalSim: inventory is client-authored after join
        if (this.net?.isLocal && !this._netForceYouInv) return;
        if (this._inventoryUiOwnsGear()) return;

        const cloneStack = (s) => {
            if (!s) return null;
            if (typeof cloneItemStack === "function") return cloneItemStack(s);
            try {
                return JSON.parse(JSON.stringify(s));
            } catch (_) {
                return { ...s };
            }
        };

        if (Array.isArray(pending.inventory)) {
            const size = this.player.inventorySize || 5;
            const inv = pending.inventory.slice(0, size).map(cloneStack);
            while (inv.length < size) inv.push(null);
            this.player.inventory = inv;
            if (typeof pending.hotbarIndex === "number") {
                const hi = Math.max(0, Math.min(
                    (this.hotbar?.size || this.player.inventorySize || 5) - 1,
                    Math.floor(pending.hotbarIndex)
                ));
                this.player.hotbarIndex = hi;
                this.hotbar?.setActiveIndex?.(hi, { notifyNet: false });
            }
            if (this.hotbar) {
                this.hotbar.dirty = true;
                // layout() resyncs icon positions + textures (update alone can miss when
                // called from a net handler while the campfire world UI is open)
                this.hotbar.layout?.();
                this.hotbar.dirty = false;
            }
        }

        if (pending.equipment && this.player.equipment) {
            const eq = pending.equipment;
            this.player.equipment = {
                head: cloneStack(eq.head),
                torso: cloneStack(eq.torso),
                legs: cloneStack(eq.legs),
                feet: cloneStack(eq.feet),
                waist: Array.isArray(eq.waist) ? eq.waist.map(cloneStack) : []
            };
            this.player.syncWaistSlots?.();
            this.player.recomputeEquipmentEffects?.();
            if (this.equipmentPanel?.visible) {
                this.equipmentPanel.refresh();
                this.equipmentPanel.layout();
            }
        }

        this._pendingYouGear = null;
        if (this.craftMenuVisible) this.refreshCraftMenu?.();
    }

    _netApplyChunk(meta) {
        if (!meta || !this.isNet) return;
        const key = this.getKey(meta.x, meta.y);
        const existing = this.chunks[key];
        if (existing?.isLoaded) return;
        // Prefer local client blood VFX over empty server bloodStains arrays
        const mergeBlood = (serverList, localList) => {
            const local = Array.isArray(localList) ? localList : [];
            const server = Array.isArray(serverList) ? serverList : [];
            if (!server.length) return local;
            if (!local.length) return server;
            return local.concat(server);
        };
        if (existing && !existing.isGenerated) {
            // Prefer server terrain when we haven't finished local gen
            const prevBlood = existing.meta?.bloodStains;
            existing.meta = {
                tiles: meta.tiles,
                things: meta.things || [],
                lootableThings: meta.lootableThings || [],
                mobs: meta.mobs || [],
                drops: meta.drops || [],
                bloodStains: mergeBlood(meta.bloodStains, prevBlood),
                corpses: meta.corpses || []
            };
            existing.isGenerated = !!(meta.tiles && meta.tiles.some((t) => !!t));
            return;
        }
        if (existing) return;
        const chunk = new Chunk(this, meta.x, meta.y, {
            tiles: meta.tiles,
            things: meta.things || [],
            lootableThings: meta.lootableThings || [],
            mobs: meta.mobs || [],
            drops: meta.drops || [],
            bloodStains: meta.bloodStains || [],
            corpses: meta.corpses || []
        });
        chunk.isGenerated = !!(meta.tiles && meta.tiles.some((t) => !!t));
        this.chunks[key] = chunk;
    }

    _netMakeRemote(rp) {
        const zoom = this.worldZoom || 3;
        const s = this.uiScale || 1;
        const root = this.add.container(rp.x, rp.y);
        root.setDepth(rp.y || 0);
        this.mainLayer.add(root);

        const lookKey = typeof PlayerLook !== "undefined"
            ? PlayerLook.ensure(this, rp.look)
            : "human";
        const spr = this.add.sprite(0, 0, lookKey, 1).setOrigin(0, 1);
        root.add(spr);

        const nameFont = Math.round(10 * s);
        const nameStroke = Math.max(2, Math.round(3 * s));
        const name = this.add.text(8, -18, rp.name || "?", {
            fontFamily: "monospace",
            fontSize: `${nameFont}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: nameStroke,
            align: "center"
        }).setOrigin(0.5, 1);
        name.setResolution(zoom * (window.devicePixelRatio || 1));
        name.setScale(1 / zoom);
        root.add(name);

        const bubbleFont = Math.round(11 * s);
        const bubble = this.add.text(8, -30, "", {
            fontFamily: "monospace",
            fontSize: `${bubbleFont}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: nameStroke,
            align: "center",
            wordWrap: { width: Math.round(140 * s), useAdvancedWrap: true }
        }).setOrigin(0.5, 1).setVisible(false);
        bubble.setResolution(zoom * (window.devicePixelRatio || 1));
        bubble.setScale(1 / zoom);
        root.add(bubble);

        if (typeof PlayerLook !== "undefined") PlayerLook.play(spr, rp.facing || "down", false);
        else if (this.anims.exists("idle-down")) spr.play("idle-down", true);

        const fistColor = typeof PlayerLook !== "undefined"
            ? PlayerLook.fistColor(rp.look)
            : 0xff8900;
        const fist = this.add.rectangle(0, 0, 4, 10, fistColor, 1)
            .setOrigin(0.5, 1)
            .setVisible(false);
        root.add(fist);

        return {
            root,
            spr,
            name,
            bubble,
            fist,
            bubbleUntil: 0,
            x: rp.x,
            y: rp.y,
            tx: rp.x,
            ty: rp.y,
            facing: rp.facing || "down",
            displayName: rp.name || "?",
            attackTimer: 0,
            attackMax: 0,
            attackAngle: 0,
            prone: !!(rp.prone || rp.dead),
            look: rp.look || null,
            tex: spr.texture?.key
        };
    }

    _netApplySnapshot(snap) {
        if (!snap || !this.isNet) return;
        if (snap.clock) this._netApplyClock(snap.clock);
        const selfId = this._netPlayerId || this.net?.playerId;
        const seen = new Set();
        for (const rp of snap.players || []) {
            if (!rp?.id || rp.id === selfId) continue;
            seen.add(rp.id);
            let entry = this.remotePlayers.get(rp.id);
            if (!entry) {
                entry = this._netMakeRemote(rp);
                this.remotePlayers.set(rp.id, entry);
            }
            entry.tx = rp.x;
            entry.ty = rp.y;
            entry.facing = rp.facing || "down";
            entry.displayName = rp.name || entry.displayName || "?";
            entry.name.setText(entry.displayName);
            if (rp.look && typeof Look !== "undefined" && !Look.looksEqual(entry.look, rp.look)) {
                if (typeof PlayerLook !== "undefined") {
                    PlayerLook.apply(entry.spr, rp.look);
                    entry.tex = entry.spr.texture?.key;
                    entry.animKey = null;
                    if (entry.fist) entry.fist.setFillStyle(PlayerLook.fistColor(rp.look), 1);
                }
                entry.look = rp.look;
            }
            entry.spr.setAlpha(1);
            entry.prone = !!(rp.prone || rp.dead);
            // Dead players leave a corpse — no translucent ghost puppet
            entry.root.setVisible(!rp.dead);
            if (rp.dead) {
                if (entry.fist) entry.fist.setVisible(false);
                if (entry.weapon) entry.weapon.setVisible(false);
            } else if (rp.attacking && Number.isFinite(rp.attackAngle)) {
                // Keep / start remote swing from snapshot if event was missed
                if (!(entry.attackTimer > 0)) {
                    this._netStartRemoteAttack(entry, rp.attackAngle, rp.facing, rp.attackArt);
                } else {
                    entry.attackAngle = rp.attackAngle;
                    if (rp.attackArt) entry.attackArt = rp.attackArt;
                }
            }
        }
        for (const [id, entry] of this.remotePlayers) {
            if (!seen.has(id)) {
                entry.root.destroy(true);
                this.remotePlayers.delete(id);
            }
        }
        this._netApplyMobs(snap.mobs || []);
        this._netApplyDrops(snap.drops || []);
        this._netApplyCorpses(snap.corpses || []);
        this._netApplyCampfires(snap.campfires || []);
    }

    /**
     * Apply authoritative world clock from the listen server.
     * @param {{ gameDay?: number, gameMinutes?: number, day?: number, minutes?: number, tickSpeed?: number }} clock
     * @param {{ catchUp?: boolean }} [opts]
     */
    _netApplyClock(clock, opts = {}) {
        if (!clock || !this.isNet) return;
        const day = Number(clock.gameDay ?? clock.day);
        const mins = Number(clock.gameMinutes ?? clock.minutes);
        if (!Number.isFinite(day) || !Number.isFinite(mins)) return;

        const prevIdx = this.worldMinuteIndex();
        this.gameDay = Math.max(1, Math.floor(day));
        this.gameMinutes = ((Math.floor(mins) % 1440) + 1440) % 1440;

        if (clock.tickSpeed != null && Number.isFinite(Number(clock.tickSpeed))) {
            this.tickSpeed = Math.max(0, Number(clock.tickSpeed));
        }

        this.updateClockText();
        if (this.lightGfx && this.worldMinuteIndex() !== prevIdx) this.updateTimeTint();

        if (opts.catchUp === false) return;

        // Drive local minute systems when the shared clock advances
        let steps = this.worldMinuteIndex() - prevIdx;
        if (steps <= 0) return;
        const cap = this.tickSpeed > 1 ? 60 : 8;
        if (steps > cap) steps = 1; // huge jump: snap once, don't melt CPU
        for (let i = 0; i < steps; i++) {
            // Net sessions: hunger drain is owned by LocalSim / dedicated server (YOU).
            if (!(this.isNet && this.net?.connected)) {
                this.player?.hungerTick?.();
            } else if (this.net?.isLocal && this.player) {
                // LocalSim skips hungerTick; still refresh the fed snapshot each minute
                // so malnutrition (and /heal's sticky flag) advances correctly.
                this.player._malnutritionFed =
                    (Number(this.player.kc) > 0) || (Number(this.player.saturation) > 0);
            }
            this.tickSpoilage();
            this.tickCorpseDecay();
            // Dedicated MP: campfire burn/cook is server-authored (events + snapshots).
            if (!(this.isNet && this.net?.connected && !this.net.isLocal)) {
                this.tickCampfires();
                this.tickLootableRegrows();
            }
            this.tickBodySystems();
            this.tickBloodStains();
        }
    }

    _netDropKey(d) {
        return d.uid || `${d.id}:${Math.round(d.x)}:${Math.round(d.y)}:${d.quantity || 1}`;
    }

    _netApplyDrops(drops) {
        // LocalSim SP: chunk meta owns ground loot (same as offline)
        if (this.net?.isLocal) return;
        if (!this.netDrops) this.netDrops = new Map();
        if (!this.droppedItems) this.droppedItems = this.add.group();
        const seen = new Set();
        for (const d of drops) {
            if (!d?.id) continue;
            const key = this._netDropKey(d);
            seen.add(key);
            let spr = this.netDrops.get(key);
            if (!spr || !spr.active) {
                const chunk = LivingMob.ensureChunkAt(this, d.x, d.y - 1);
                if (!chunk) continue;
                const entry = {
                    uid: d.uid || key,
                    id: d.id,
                    x: d.x,
                    y: d.y,
                    quantity: d.quantity || 1,
                    spoilAt: d.spoilAt,
                    food: d.food,
                    customName: d.customName,
                    netSync: true,
                    lifeMs: 1e9
                };
                this._netCopyDropExtras(entry, d);
                // Don't persist into chunk.meta — snapshot owns the list
                spr = new DroppedItem(this, entry, chunk);
                this.netDrops.set(key, spr);
            } else {
                spr.x = d.x;
                spr.y = d.y;
                spr.quantity = d.quantity || 1;
                if (spr.entry) {
                    spr.entry.x = d.x;
                    spr.entry.y = d.y;
                    spr.entry.quantity = spr.quantity;
                    // Server may have lazily spoiled while this drop was out of view
                    if (d.id && d.id !== spr.entry.id) {
                        spr.entry.id = d.id;
                        const meta = this.getItem(d.id);
                        if (meta) {
                            spr.item = meta;
                            if (meta.key && this.textures.exists(meta.key)) spr.setTexture(meta.key);
                        }
                    }
                    if (d.spoilAt != null) {
                        spr.entry.spoilAt = d.spoilAt;
                        spr.spoilAt = d.spoilAt;
                    } else {
                        delete spr.entry.spoilAt;
                        delete spr.spoilAt;
                    }
                    if (d.food) {
                        spr.entry.food = d.food;
                        spr.food = { ...d.food };
                    } else {
                        delete spr.entry.food;
                        delete spr.food;
                    }
                    if (d.customName) {
                        spr.entry.customName = d.customName;
                        spr.customName = d.customName;
                    } else {
                        delete spr.entry.customName;
                        delete spr.customName;
                    }
                    this._netCopyDropExtras(spr.entry, d);
                    this._netSyncDropSpriteExtras(spr);
                }
            }
        }
        for (const [key, spr] of [...this.netDrops.entries()]) {
            if (seen.has(key)) continue;
            this.netDrops.delete(key);
            if (spr?.active) {
                if (typeof spr.persistDestroy === "function") spr.persistDestroy();
                else spr.destroy();
            }
        }
        // Remove any leftover local-only drops (no netSync) so they can't desync
        for (const drop of (this.droppedItems?.getChildren?.() || []).slice()) {
            if (!drop?.active) continue;
            if (drop.entry?.netSync) continue;
            if (typeof drop.persistDestroy === "function") drop.persistDestroy();
            else drop.destroy();
        }
    }

    /** Copy tip/knap/meal extras from a net drop payload onto an entry object. */
    _netCopyDropExtras(entry, d) {
        if (!entry || !d) return;
        const assign = (key, val) => {
            if (val != null && val !== "") entry[key] = val;
            else delete entry[key];
        };
        assign("toolClass", d.toolClass);
        assign("sharpness", d.sharpness);
        assign("knapDamage", d.knapDamage);
        assign("knapMaterial", d.knapMaterial);
        assign("knapQuality", d.knapQuality);
        assign("tooltipExtra", d.tooltipExtra);
        assign("knapIconData", d.knapIconData);
        assign("kind", d.kind);
        assign("fillTint", d.fillTint);
        assign("durability", d.durability);
        if (d.ingredients) {
            entry.ingredients = Array.isArray(d.ingredients)
                ? d.ingredients.slice()
                : d.ingredients;
        } else {
            delete entry.ingredients;
        }
        if (d.weight != null) entry.weight = d.weight;
        else delete entry.weight;
    }

    /** Mirror entry extras onto the live DroppedItem sprite fields used by tooltips. */
    _netSyncDropSpriteExtras(spr) {
        if (!spr?.entry) return;
        const e = spr.entry;
        spr.toolClass = e.toolClass;
        spr.sharpness = e.sharpness;
        spr.knapDamage = e.knapDamage;
        spr.knapMaterial = e.knapMaterial;
        spr.knapQuality = e.knapQuality;
        spr.tooltipExtra = e.tooltipExtra;
        spr.knapIconData = e.knapIconData;
        spr.kind = e.kind;
        spr.fillTint = e.fillTint;
        spr.durability = e.durability;
        spr.ingredients = e.ingredients;
        spr.stackWeight = e.weight;
        if (e.food) spr.food = { ...e.food };
        else delete spr.food;
        if (e.customName) spr.customName = e.customName;
        else delete spr.customName;
    }

    /**
     * Upsert one dedicated-MP corpse sprite. Does not reconcile/remove others.
     * @param {object} c server corpse entry
     * @param {{ pending?: boolean, confirmed?: boolean }} [opts]
     */
    _netUpsertCorpse(c, opts = {}) {
        if (!c?.id || this.net?.isLocal) return null;
        if (!this.netCorpses) this.netCorpses = new Map();
        if (!this.corpses) this.corpses = this.add.group();
        const loot = Array.isArray(c.loot)
            ? c.loot.map((s) => (typeof cloneItemStack === "function" ? cloneItemStack(s) : s)).filter(Boolean)
            : [];
        let key = c.key || "human";
        if (typeof PlayerLook !== "undefined") {
            key = PlayerLook.resolveTexture(this, key, c.look);
        } else if (!this.textures.exists(key) || key === "player") {
            if (this.textures.exists("human")) key = "human";
            else if (this.textures.exists("deer")) key = "deer";
        }
        const frame = c.frame != null ? c.frame : 7;
        let spr = this.netCorpses.get(c.id);
        if (!spr || !spr.active) {
            const chunk = LivingMob.ensureChunkAt(this, c.x, c.y);
            if (!chunk) return null;
            const entry = {
                id: c.id,
                x: c.x,
                y: c.y,
                key,
                look: c.look || null,
                frame,
                name: c.name || "Corpse",
                loot,
                body: c.body || null,
                bodyPlan: c.bodyPlan || "human",
                mobId: c.mobId || null,
                skinned: !!c.skinned,
                diedAt: c.diedAt,
                stage: c.stage === "carcass" ? "carcass" : "corpse",
                netSync: true
            };
            if (opts.pending) {
                entry.pendingServer = true;
                entry.pendingAt = performance.now();
            }
            spr = new Corpse(this, entry, chunk);
            this.netCorpses.set(c.id, spr);
            // Keep meta in sync so chunk reload / tooling can find the corpse
            if (!chunk.meta.corpses) chunk.meta.corpses = [];
            if (!chunk.meta.corpses.some((e) => e?.id === entry.id)) {
                chunk.meta.corpses.push(entry);
            }
            return spr;
        }
        const chunk = LivingMob.ensureChunkAt(this, c.x, c.y);
        if (!chunk) return spr;
        spr.x = c.x;
        spr.y = c.y;
        spr.setDepth((Number(c.y) || 0) + 1);
        if (typeof spr._setCorpseHitArea === "function") spr._setCorpseHitArea();
        else if (spr.input) spr.input.enabled = true;
        // Re-attach to the live chunk group after unload detached netSync corpses
        if (spr.chunk !== chunk) {
            spr.chunk?.corpses?.remove(spr);
            spr.chunk = chunk;
            if (!chunk.corpses) chunk.corpses = this.add.group();
            chunk.corpses.add(spr);
        } else if (chunk.corpses && !chunk.corpses.contains(spr)) {
            chunk.corpses.add(spr);
        }
        if (spr.entry) {
            spr.entry.x = c.x;
            spr.entry.y = c.y;
            spr.entry.key = key;
            spr.entry.frame = frame;
            spr.entry.name = c.name || spr.entry.name || "Corpse";
            spr.entry.skinned = !!c.skinned;
            spr.entry.body = c.body != null ? c.body : spr.entry.body;
            spr.entry.bodyPlan = c.bodyPlan || spr.entry.bodyPlan || "human";
            spr.entry.mobId = c.mobId != null ? c.mobId : spr.entry.mobId;
            spr.entry.loot = loot;
            if (c.diedAt != null) spr.entry.diedAt = c.diedAt;
            if (c.stage) spr.entry.stage = c.stage;
            spr.entry.netSync = true;
            spr.applyStageAppearance?.();
            if (opts.pending) {
                spr.entry.pendingServer = true;
                spr.entry.pendingAt = performance.now();
            } else if (opts.confirmed) {
                delete spr.entry.pendingServer;
                delete spr.entry.pendingAt;
            }
            if (this.corpsePanel?.visible && this.corpsePanel.corpse === spr) {
                this.corpsePanel.syncFromEntry?.();
            }
        }
        return spr;
    }

    _netApplyCorpses(corpses) {
        // LocalSim SP: chunk meta owns corpses (same as offline)
        if (this.net?.isLocal) return;
        // Malformed payload (e.g. single object) would iterate keys and wipe everyone
        if (!Array.isArray(corpses)) return;
        if (!this.netCorpses) this.netCorpses = new Map();
        if (!this.corpses) this.corpses = this.add.group();
        const seen = new Set();
        const now = performance.now();
        for (const c of corpses) {
            if (!c?.id) continue;
            seen.add(c.id);
            const spr = this._netUpsertCorpse(c, { confirmed: true });
            if (spr?.entry) spr.entry._missedSnaps = 0;
        }
        for (const [id, spr] of [...this.netCorpses.entries()]) {
            if (seen.has(id)) continue;
            // Keep briefly if event spawned it and snapshot hasn't caught up yet
            if (spr?.entry?.pendingServer && now - (spr.entry.pendingAt || 0) < 3000) continue;
            // Don't yank a corpse out from under an open loot UI
            if (this.corpsePanel?.corpse === spr) continue;
            // One empty/partial snapshot (common around player death) must not
            // sparkle-despawn every nearby corpse — require a few consecutive misses.
            const missed = (spr?.entry?._missedSnaps || 0) + 1;
            if (spr?.entry) spr.entry._missedSnaps = missed;
            if (missed < 5) continue;
            this.netCorpses.delete(id);
            if (spr?.active) {
                // Silent — sparkle is reserved for authoritative corpse remove events
                spr.destroy();
            }
        }
        // Strip leftover local-only corpses (e.g. stale client spawn)
        for (const corpse of (this.corpses?.getChildren?.() || []).slice()) {
            if (!corpse?.active) continue;
            if (corpse.entry?.netSync) continue;
            if (this.corpsePanel?.corpse === corpse) continue;
            corpse.destroy();
        }
    }

    _netEnsureMobAnims(tex) {
        if (!tex || !this.textures.exists(tex)) return;
        if (this.anims.exists(`${tex}-walk-down`)) return;
        const dirs = ["down", "left", "right", "up"];
        for (let row = 0; row < 4; row++) {
            const dir = dirs[row];
            const start = row * 3;
            this.anims.create({
                key: `${tex}-walk-${dir}`,
                frames: this.anims.generateFrameNumbers(tex, { start, end: start + 2 }),
                frameRate: 5,
                repeat: -1
            });
            this.anims.create({
                key: `${tex}-idle-${dir}`,
                frames: [{ key: tex, frame: start + 1 }],
                frameRate: 10
            });
        }
    }

    _netMakeMob(m) {
        const kind = m.kind || "deer";
        const def = this.getMob?.(kind);
        const texKey = def?.key || kind;
        const tex = this.textures.exists(texKey) ? texKey
            : (this.textures.exists(kind) ? kind
                : (this.textures.exists("deer") ? "deer" : null));
        const root = this.add.container(m.x, m.y);
        this.mainLayer.add(root);
        let spr;
        if (tex) {
            this._netEnsureMobAnims(tex);
            spr = this.add.sprite(0, 0, tex, 1).setOrigin(0, 1);
            const idle = `${tex}-idle-down`;
            if (this.anims.exists(idle)) spr.play(idle, true);
        } else {
            spr = this.add.circle(0, -4, 5, 0x88aa55);
        }
        root.add(spr);

        const label = m.name || def?.name || kind || "Creature";
        const hitOpts = tex
            ? { cursor: "pointer", pixelPerfect: true }
            : { cursor: "pointer" };
        spr.setInteractive(hitOpts);
        spr.on("pointerover", (pointer) => {
            const live = this.netMobs.get(m.id);
            this.showTooltip(live?.name || label, pointer.x, pointer.y, spr);
        });
        spr.on("pointerout", () => {
            if (this._hoverTarget === spr) this._hoverTarget = null;
            if (this._tooltipTarget === spr) this.hideTooltip();
        });
        spr.on("destroy", () => {
            if (this._hoverTarget === spr) this._hoverTarget = null;
            if (this._tooltipTarget === spr) this.hideTooltip();
        });

        const fistColor = this._netFistColor({ kind, look: m.look });
        const fist = this.add.rectangle(0, 0, 4, 10, fistColor, 1)
            .setOrigin(0.5, 1)
            .setVisible(false);
        root.add(fist);

        const now = performance.now();
        return {
            id: m.id,
            root,
            spr,
            tex,
            kind,
            name: label,
            fist,
            x: m.x,
            y: m.y,
            fromX: m.x,
            fromY: m.y,
            tx: m.x,
            ty: m.y,
            snapAt: now,
            snapDt: 1000 / (NetProtocol.SNAPSHOT_HZ || 15),
            facing: m.facing || "down",
            moving: !!m.moving,
            serverMoving: !!m.moving,
            vx: m.vx || 0,
            vy: m.vy || 0,
            animKey: null,
            facingHoldUntil: 0,
            attackTimer: 0,
            attackMax: 0,
            attackAngle: 0,
            look: m.look || null
        };
    }

    _netApplyMobs(mobs) {
        // LocalSim SP: LivingMobs own wildlife — ignore empty/leftover puppets.
        // Dedicated: restore snapshot puppets (server SimCreatures).
        if (this.net?.isLocal) {
            if (this.netMobs?.size) {
                for (const entry of this.netMobs.values()) entry.root?.destroy?.(true);
                this.netMobs.clear();
            }
            return;
        }
        const seen = new Set();
        const now = performance.now();
        const snapDt = 1000 / (NetProtocol.SNAPSHOT_HZ || 15);
        for (const m of mobs) {
            if (!m?.id) continue;
            seen.add(m.id);
            let entry = this.netMobs.get(m.id);
            if (!entry) {
                entry = this._netMakeMob(m);
                this.netMobs.set(m.id, entry);
            } else {
                entry.fromX = entry.x;
                entry.fromY = entry.y;
                entry.tx = m.x;
                entry.ty = m.y;
                entry.snapAt = now;
                entry.snapDt = snapDt;
            }
            entry.kind = m.kind || entry.kind;
            if (m.name) entry.name = m.name;
            // Trust server facing — don't invent from lerp error
            if (m.facing) entry.facing = m.facing;
            if (Number.isFinite(m.vx)) entry.vx = m.vx;
            if (Number.isFinite(m.vy)) entry.vy = m.vy;
            if (typeof m.moving === "boolean") entry.serverMoving = m.moving;
            entry.panic = !!m.panic;
            entry.state = m.state || entry.state;
            entry.prone = !!m.prone;
            if (m.look) entry.look = m.look;
            if (m.attacking && Number.isFinite(m.attackAngle)) {
                if (!(entry.attackTimer > 0)) {
                    this._netStartRemoteAttack(entry, m.attackAngle, m.facing, m.attackArt);
                } else {
                    entry.attackAngle = m.attackAngle;
                    if (m.attackArt) entry.attackArt = m.attackArt;
                }
            }
        }
        for (const [id, entry] of this.netMobs) {
            if (!seen.has(id)) {
                entry.root.destroy(true);
                this.netMobs.delete(id);
            }
        }
    }

    _netUpdateMobs(delta) {
        const now = performance.now();
        const dt = Math.max(1, delta || 16) / 1000;
        const tileSize = this.tileSize || 16;
        const humanRef = 3.5;
        for (const entry of this.netMobs.values()) {
            const snapDt = entry.snapDt || (1000 / 15);
            const age = now - (entry.snapAt || now);
            let u = snapDt > 0 ? age / snapDt : 1;
            if (u > 1) u = 1 + Math.min(0.15, (u - 1) * 0.25);

            const err = Math.hypot(entry.tx - entry.fromX, entry.ty - entry.fromY);
            const prevX = entry.x;
            const prevY = entry.y;
            if (err > 72) {
                entry.x = entry.tx;
                entry.y = entry.ty;
                entry.fromX = entry.tx;
                entry.fromY = entry.ty;
            } else {
                entry.x = entry.fromX + (entry.tx - entry.fromX) * Math.min(1, u);
                entry.y = entry.fromY + (entry.ty - entry.fromY) * Math.min(1, u);
            }

            entry.root.setPosition(entry.x, entry.y);
            entry.root.setDepth(entry.y);

            if (entry.attackTimer > 0) {
                entry.attackTimer = Math.max(0, entry.attackTimer - (delta || 16));
                const progress = entry.attackMax > 0
                    ? 1 - entry.attackTimer / entry.attackMax
                    : 1;
                this._netUpdateRemoteAttackSprites(entry, progress);
                if (entry.attackTimer <= 0) {
                    if (entry.fist) entry.fist.setVisible(false);
                    if (entry.weapon) entry.weapon.setVisible(false);
                    entry.attackArt = null;
                }
            } else {
                if (entry.fist?.visible) entry.fist.setVisible(false);
                if (entry.weapon?.visible) entry.weapon.setVisible(false);
            }

            const dx = entry.x - prevX;
            const dy = entry.y - prevY;
            const speedPx = Math.hypot(dx, dy) / dt;
            const tilesPerSec = speedPx / tileSize;
            const serverSpeed = Math.hypot(entry.vx || 0, entry.vy || 0) / tileSize;
            const moveSignal = Math.max(tilesPerSec, serverSpeed);

            // Walk/idle from server intent, with soft hysteresis on visual speed
            if (entry.serverMoving === true || entry.state === "panic" || moveSignal > 0.25) {
                entry.moving = true;
            } else if (entry.serverMoving === false || moveSignal < 0.08) {
                entry.moving = false;
            }

            const tex = entry.tex;
            if (!tex || !entry.spr?.play) continue;
            if (typeof setPuppetProne === "function") {
                // Mobs: container is feet-anchored; shift sprite to body center while prone
                setPuppetProne(entry.spr, !!entry.prone, { feetAnchored: true });
            }
            if (entry.prone) {
                entry.animKey = null;
                continue;
            }
            const facing = entry.facing || "down";
            const key = `${tex}-${entry.moving ? "walk" : "idle"}-${facing}`;
            // Only restart anim when the key changes (play every frame kills cadence)
            if (key !== entry.animKey && this.anims.exists(key)) {
                entry.animKey = key;
                entry.spr.play(key, true);
            }
            if (entry.spr.anims) {
                // Match playback to actual travel speed — don't floor panic anims at a
                // full gallop or a limping deer still looks like it's sprinting.
                entry.spr.anims.timeScale = entry.moving
                    ? Phaser.Math.Clamp(
                        Math.max(moveSignal, 0.35) / humanRef,
                        0.2,
                        2.2
                    )
                    : 1;
            }
        }
    }

    _netShowRemoteBubble(playerId, msg) {
        const entry = this.remotePlayers.get(playerId);
        if (!entry || !msg) return;
        const text = String(msg).replace(/^<[^>]+>\s*/, "");
        if (!text) return;
        entry.bubble.setText(text).setVisible(true).setAlpha(1);
        entry.bubbleUntil = (this.time?.now || 0) + 10000;
        this._netLayoutRemoteLabels(entry);
    }

    _netLayoutRemoteLabels(entry) {
        const spr = entry.spr;
        const nameH = Math.ceil((entry.name.height || 12) * (entry.name.scaleY || 1));
        const prone = !!(entry.prone || spr?._prone);
        let nameX;
        let nameY;
        if (prone) {
            // Sprite is centered in the container while downed
            nameX = 0;
            nameY = -Math.round(Math.max(spr.width || 16, spr.height || 16) * 0.5 + 4);
        } else {
            nameX = Math.round((spr.width || 16) * 0.5);
            nameY = -Math.round((spr.height || 16) + 4);
        }
        entry.name.setPosition(nameX, nameY);
        const bubbleOn = entry.bubble.visible && (this.time?.now || 0) < entry.bubbleUntil;
        if (bubbleOn) {
            entry.bubble.setPosition(nameX, nameY - nameH - 2);
        }
    }

    /** Refresh remote name / chat bubble fonts after GUI scale changes. */
    _netApplyRemoteLabelScale(entry) {
        if (!entry) return;
        const zoom = this.worldZoom || 3;
        const s = this.uiScale || 1;
        const res = zoom * (window.devicePixelRatio || 1);
        const stroke = Math.max(2, Math.round(3 * s));
        if (entry.name?.active) {
            entry.name
                .setFontSize(`${Math.round(10 * s)}px`)
                .setStroke("#000000", stroke)
                .setResolution(res)
                .setScale(1 / zoom);
        }
        if (entry.bubble?.active) {
            entry.bubble
                .setFontSize(`${Math.round(11 * s)}px`)
                .setStroke("#000000", stroke)
                .setWordWrapWidth(Math.round(140 * s), true)
                .setResolution(res)
                .setScale(1 / zoom);
        }
        this._netLayoutRemoteLabels(entry);
    }

    _netApplyEvent(ev) {
        if (!ev || !this.isNet) return;
        if (ev.kind === "world_regen" && ev.seed != null) {
            this._netOnWorldRegen(ev.seed);
            return;
        }
        if (ev.kind === "chat" && ev.text) {
            const selfId = this._netPlayerId || this.net?.playerId;
            const text = String(ev.text);
            const isJoin = / joined\.$/.test(text);
            const isLeave = / left\.$/.test(text);
            const isPlayerChat = !!(ev.from || /^<.+>\s/.test(text));
            const yellow = isJoin || isLeave || isPlayerChat;
            this.combatLog?.push?.(text, yellow ? { color: CombatLog.COLOR_CHAT } : null);
            if (ev.from && ev.from !== selfId) {
                this._netShowRemoteBubble(ev.from, text);
            }
        }
        if (ev.kind === "death" && ev.text) {
            const selfId = this._netPlayerId || this.net?.playerId;
            const msg = String(ev.text).replace(/\.+$/, "");
            if (ev.playerId === selfId) {
                this._pendingDeathText = msg;
                if (this.player?._bodyDead || this.deathOverlay?.visible) {
                    this._applyDeathMessage(msg);
                }
            }
        }
        if (ev.kind === "channel" && ev.channel === "eat") {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.playerId === selfId && this.net?.connected && !this.net.isLocal) {
                if (ev.done || ev.cancelled) {
                    this.player._eatChannel = null;
                    this.hideChannelBar?.();
                } else if (typeof ev.progress === "number" && this.player._eatChannel) {
                    // Drop in-flight progress after local/server cancel
                    this.showChannelBar?.(Phaser.Math.Clamp(ev.progress, 0, 1));
                }
            }
        }
        if (ev.kind === "player_left") {
            const e = this.remotePlayers.get(ev.playerId);
            if (e) {
                e.root.destroy(true);
                this.remotePlayers.delete(ev.playerId);
            }
        }
        if (ev.kind === "attack") {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.playerId && ev.playerId === selfId) return;
            if (ev.playerId) {
                let entry = this.remotePlayers.get(ev.playerId);
                if (!entry) {
                    // Remote may not exist yet — create a stub from the event pose
                    entry = this._netMakeRemote({
                        id: ev.playerId,
                        name: "?",
                        x: ev.x ?? 0,
                        y: ev.y ?? 0,
                        facing: ev.facing || "down"
                    });
                    this.remotePlayers.set(ev.playerId, entry);
                }
                this._netStartRemoteAttack(entry, Number(ev.angle) || 0, ev.facing, ev.art);
            } else if (ev.uid && this.netMobs) {
                const puppet = this.netMobs.get(ev.uid);
                if (puppet) {
                    this._netStartRemoteAttack(puppet, Number(ev.angle) || 0, ev.facing, ev.art);
                }
            }
        }
        if (ev.kind === "combat_log") {
            this.combatLog?.push?.(ev.text, {
                combat: !!ev.combat,
                segments: ev.segments || null,
                color: ev.color || null
            });
        }
        if (ev.kind === "bleed") {
            this._netApplyBleedFx(ev);
        }
        if (ev.kind === "damage" && ev.amount != null) {
            const amt = Math.round(Number(ev.amount) || 0);
            if (amt > 0) {
                this.combatLog?.push?.(`Hit for ${amt}`, {
                    color: CombatLog.COLOR_WEAPON
                });
            }
        }
        if (ev.kind === "lootable") {
            this._netApplyLootableEvent(ev);
        }
        if (ev.kind === "corpse") {
            this._netApplyCorpseEvent(ev);
        }
        if (ev.kind === "mob") {
            this._netApplyMobEvent(ev);
        }
        if (ev.kind === "campfire") {
            this._netApplyCampfireEvent(ev);
        }
    }

    /**
     * Dedicated MP: server cues bleed FX; each client paints local random stains.
     * Patterns intentionally differ per client.
     */
    _netApplyBleedFx(ev) {
        if (!ev || this.bloodDraw === false) return;
        if (!this.net?.connected || this.net.isLocal) return;
        const x = Number(ev.x);
        const y = Number(ev.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const n = Math.max(1, Math.min(4, Math.floor(Number(ev.n) || 1)));
        const burst = ev.burst !== false;

        const paint = () => {
            // Prefer a live corpse sprite (death swap), else the event's bodyCenter.
            // Do not re-derive from puppets — standing offsets on center-anchored
            // prone poses were painting pools a body-height above the victim.
            const anchor = this._netBleedAnchor(ev, x, y);
            if (typeof BodyHealing?.spawnBleedFxAt === "function") {
                BodyHealing.spawnBleedFxAt(this, anchor.x, anchor.y, 1, burst);
            } else {
                const ang = Math.random() * Math.PI * 2;
                const dist = (0.08 + Math.random() * 0.45) * (this.tileSize || 16);
                this.spawnBloodStain?.(
                    anchor.x + Math.cos(ang) * dist,
                    anchor.y + Math.sin(ang) * dist
                );
            }
        };

        if (burst || !this.time?.delayedCall) {
            for (let i = 0; i < n; i++) paint();
            return;
        }
        const tickSpeed = Math.max(0.05, Number(this.tickSpeed) || 1);
        const minuteMs = Math.max(80, 1000 / tickSpeed);
        for (let i = 0; i < n; i++) {
            const delay = Math.floor(((i + 0.5) / n) * minuteMs * (0.7 + Math.random() * 0.5));
            this.time.delayedCall(Math.min(delay, minuteMs - 1), paint);
        }
    }

    /**
     * World point for bleed FX. Server already sent bodyCenter() at emit time.
     * Pin to a corpse when the bleeder has died so delayed drips track the body.
     */
    _netBleedAnchor(ev, fallbackX, fallbackY) {
        const pinned = this._netBleedCorpsePin(ev, fallbackX, fallbackY);
        if (pinned) return pinned;
        return { x: fallbackX, y: fallbackY };
    }

    /** Snap bleed FX to a nearby corpse (same owner death / same spot). */
    _netBleedCorpsePin(ev, x, y) {
        if (!this.netCorpses?.size && !this.corpses?.getChildren) return null;
        const remote = ev.ownerId ? this.remotePlayers?.get(ev.ownerId) : null;
        const ownerDead = !!(remote && (remote.root && !remote.root.visible));
        // Only snap when the bleeder is gone / dead, or a corpse sits on the point
        const maxDist = ownerDead ? 40 : 10;
        const maxD = maxDist * maxDist;
        let best = null;
        let bestD = maxD;
        const consider = (spr) => {
            if (!spr?.active) return;
            const dx = spr.x - x;
            const dy = spr.y - y;
            const d = dx * dx + dy * dy;
            if (d <= bestD) {
                bestD = d;
                best = spr;
            }
        };
        if (this.netCorpses) {
            for (const spr of this.netCorpses.values()) consider(spr);
        }
        if (this.corpses?.getChildren) {
            for (const spr of this.corpses.getChildren()) consider(spr);
        }
        return best ? { x: best.x, y: best.y } : null;
    }

    /** Spawn/remove wildlife from dedicated server (chunk meta + puppets). */
    _netApplyMobEvent(ev) {
        if (!ev || this.net?.isLocal) return;
        if (ev.op === "remove" && ev.uid) {
            const puppet = this.netMobs?.get(ev.uid);
            if (puppet) {
                puppet.root?.destroy?.(true);
                this.netMobs.delete(ev.uid);
            }
            this._netRemoveLivingMobByUid(ev.uid);
            // Strip from chunk meta so it won't reappear on reload
            for (const chunk of Object.values(this.chunks || {})) {
                const list = chunk?.meta?.mobs;
                if (!Array.isArray(list)) continue;
                const i = list.findIndex((m) => m?.uid === ev.uid);
                if (i >= 0) list.splice(i, 1);
            }
            return;
        }
        if (ev.op === "add" && ev.entry?.id) {
            const entry = ev.entry;
            if (!entry.uid) return;
            const chunk = LivingMob.ensureChunkAt(this, entry.x, entry.y - 1);
            if (!chunk) return;
            if (!chunk.meta.mobs) chunk.meta.mobs = [];
            if (!chunk.meta.mobs.some((m) => m?.uid === entry.uid)) {
                chunk.meta.mobs.push(entry);
            }
            // Dedicated: presentation via snapshot puppets — do not spawn LivingMob
        }
    }

    _netFindLivingMobByUid(uid) {
        if (!uid || !this.mobs) return null;
        for (const m of this.mobs.getChildren()) {
            if (m?.entry?.uid === uid) return m;
        }
        return null;
    }

    _netRemoveLivingMobByUid(uid) {
        const mob = this._netFindLivingMobByUid(uid);
        if (!mob) return;
        if (mob.chunk?.meta?.mobs && mob.entry) {
            const i = mob.chunk.meta.mobs.indexOf(mob.entry);
            if (i >= 0) mob.chunk.meta.mobs.splice(i, 1);
        }
        mob.chunk?.mobs?.remove(mob);
        this.damageables?.remove(mob);
        this.mobs?.remove(mob);
        mob._dead = true;
        mob.destroy();
    }

    /** Immediate corpse add/remove from dedicated server (before next snapshot). */
    _netApplyCorpseEvent(ev) {
        if (!ev || this.net?.isLocal) return;
        if (!this.netCorpses) this.netCorpses = new Map();
        if (ev.op === "remove" && ev.id) {
            const spr = this.netCorpses.get(ev.id);
            this.netCorpses.delete(ev.id);
            if (this.corpsePanel?.corpse === spr) this.corpsePanel.close(true);
            if (spr?.active) {
                Corpse.puffAway?.(this, spr.x, spr.y);
                spr.destroy();
            }
            return;
        }
        if ((ev.op === "loot" || ev.op === "skin" || ev.op === "carcass") && ev.entry?.id) {
            const spr = this.netCorpses.get(ev.entry.id);
            if (spr?.entry) {
                if (ev.op === "skin" || ev.op === "carcass" || ev.entry.skinned != null) {
                    spr.entry.skinned = !!ev.entry.skinned || ev.op === "carcass";
                }
                if (ev.op === "carcass" || ev.entry.stage) {
                    spr.entry.stage = ev.entry.stage || "carcass";
                    if (ev.entry.diedAt != null) spr.entry.diedAt = ev.entry.diedAt;
                    spr.applyStageAppearance?.();
                    if (this.player?._skinChannel?.corpse === spr) {
                        this.player._cancelSkin?.();
                    }
                }
                if (Array.isArray(ev.entry.loot)) {
                    const loot = ev.entry.loot
                        .map((s) => (typeof cloneItemStack === "function" ? cloneItemStack(s) : s))
                        .filter(Boolean);
                    spr.entry.loot = loot;
                    if (this.corpsePanel?.visible && this.corpsePanel.corpse === spr) {
                        this.corpsePanel.syncFromEntry?.();
                        if (ev.op === "carcass") this.corpsePanel._showCorpseHealth?.();
                    }
                }
                this.refreshTooltip?.();
            }
            return;
        }
        if (ev.op === "add" && ev.entry?.id) {
            // Upsert only — never full-reconcile from a single event (that wiped
            // other corpses and lost new ones to in-flight empty snapshots).
            this._netUpsertCorpse(ev.entry, { pending: true });
        }
    }

    _lootableEventMatch(e, ev) {
        if (!e) return false;
        if (ev.uid && e.uid) return e.uid === ev.uid;
        const dx = Math.abs(Number(e.x) - Number(ev.x));
        const dy = Math.abs(Number(e.y) - Number(ev.y));
        if (dx >= 1.5 || dy >= 1.5) return false;
        if (ev.removed || ev.gone) {
            return !ev.id || e.id === ev.id || e.regrowId === ev.id;
        }
        if (ev.respawn) {
            return !ev.id || e.id === ev.id || e.regrowId === ev.id;
        }
        // Transform: same pose is enough (id on the wire is the new id)
        return true;
    }

    /** Apply server harvest / regrow to a loaded chunk's lootableThings. */
    _netApplyLootableEvent(ev) {
        if (!ev || this.net?.isLocal) return;
        const keys = [];
        if (Number.isInteger(ev.cx) && Number.isInteger(ev.cy)) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    keys.push(this.getKey(ev.cx + dx, ev.cy + dy));
                }
            }
        }
        let chunk = this.chunks[this.getKey(ev.cx, ev.cy)];
        let list = chunk?.meta?.lootableThings;
        let entry = null;
        const match = (e) => this._lootableEventMatch(e, ev);
        for (const k of keys) {
            const c = this.chunks[k];
            const lst = c?.meta?.lootableThings;
            if (!Array.isArray(lst)) continue;
            const found = lst.find(match);
            if (found) {
                chunk = c;
                list = lst;
                entry = found;
                break;
            }
        }
        if (!chunk?.meta) return;
        if (!Array.isArray(chunk.meta.lootableThings)) chunk.meta.lootableThings = [];
        if (!list) list = chunk.meta.lootableThings;
        const live = (chunk.things?.getChildren?.() || []).find(
            (t) => t?.entry && (entry ? t.entry === entry : match(t.entry))
        ) || null;

        const stamp = (e) => {
            if (ev.uid && e && !e.uid) e.uid = ev.uid;
        };

        if (ev.removed) {
            if (entry) {
                const i = list.indexOf(entry);
                if (i >= 0) list.splice(i, 1);
            }
            if (live?.active) live.destroy();
            this.hideTooltip?.();
            this.markLightDirty?.();
            return;
        }

        if (ev.respawn) {
            if (!entry) {
                entry = {
                    id: ev.id,
                    x: ev.x,
                    y: ev.y,
                    uid: ev.uid || null
                };
                list.push(entry);
            } else {
                entry.id = ev.id;
                stamp(entry);
                delete entry.gone;
                delete entry.regrowAt;
                delete entry.regrowId;
            }
            if (live && typeof live.morph === "function") {
                live.morph(entry.id);
            } else if (chunk.isLoaded && !live) {
                chunk.things.add(new LootableThing(this, entry, chunk));
            }
            this.markLightDirty?.();
            return;
        }

        // Don't invent a second copy in the wrong chunk if the original isn't loaded
        if (!entry) return;
        stamp(entry);
        if (ev.id != null) entry.id = ev.id;
        if (ev.gone) {
            entry.gone = true;
            if (ev.regrowId) entry.regrowId = ev.regrowId;
            if (ev.regrowAt != null) entry.regrowAt = ev.regrowAt;
            if (live?.active) live.destroy();
        } else {
            delete entry.gone;
            if (ev.regrowId) entry.regrowId = ev.regrowId;
            else delete entry.regrowId;
            if (ev.regrowAt != null) entry.regrowAt = ev.regrowAt;
            else delete entry.regrowAt;
            if (live && typeof live.morph === "function" && live.meta?.id !== entry.id) {
                live.morph(entry.id);
            }
        }
        this.hideTooltip?.();
        this.markLightDirty?.();
    }

    _netFindCampfire(src, hint = {}) {
        const x = Number(src?.x);
        const y = Number(src?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { chunk: null, entry: null };
        const keys = [];
        const hcx = Number.isInteger(hint.cx) ? hint.cx : Number.isInteger(src.cx) ? src.cx : null;
        const hcy = Number.isInteger(hint.cy) ? hint.cy : Number.isInteger(src.cy) ? src.cy : null;
        if (hcx != null && hcy != null) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    keys.push(this.getKey(hcx + dx, hcy + dy));
                }
            }
        }
        keys.push(this.getKey(
            Math.floor(x / this.chunkPx()),
            Math.floor((y - 1) / this.chunkPx())
        ));
        const uid = src.uid || hint.uid || null;
        const match = (t) => {
            if (!t) return false;
            if (uid && t.uid && t.uid === uid) return true;
            const camp = t.id === "campfire" || t.id === "unlit_campfire" || Array.isArray(t.fuel);
            if (!camp) return false;
            return Math.abs(Number(t.x) - x) < 1.5 && Math.abs(Number(t.y) - y) < 1.5;
        };
        let chunk = (hcx != null && hcy != null) ? (this.chunks[this.getKey(hcx, hcy)] || null) : null;
        let entry = null;
        for (const k of keys) {
            const c = this.chunks[k];
            const lst = c?.meta?.things;
            if (!Array.isArray(lst)) continue;
            const found = lst.find(match);
            if (found) {
                chunk = c;
                entry = found;
                break;
            }
        }
        if (!chunk) chunk = this.getChunkAtWorld?.(x, y - 1) || null;
        return { chunk, entry, x, y };
    }

    _netCampfireHeld(entry) {
        if (performance.now() < (this._invSwapGuardUntil || 0)) {
            const open = this.campfirePanel?.visible && this.campfirePanel.campfire?.entry;
            if (open && entry && (open === entry || (open.uid && open.uid === entry.uid))) {
                return true;
            }
        }
        return false;
    }

    _netApplyCampfirePayload(src, opts = {}) {
        if (!src || this.net?.isLocal) return;
        const found = this._netFindCampfire(src, opts);
        let { chunk, entry, x, y } = found;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (!chunk?.meta) return;
        if (!Array.isArray(chunk.meta.things)) chunk.meta.things = [];

        const incomingRev = Number(src.rev ?? opts.rev);
        const curRev = Number(entry?.rev);
        if (entry && Number.isFinite(curRev) && Number.isFinite(incomingRev) && incomingRev < curRev) {
            return;
        }

        const held = entry && this._netCampfireHeld(entry);
        const newer = Number.isFinite(incomingRev) && Number.isFinite(curRev) && incomingRev > curRev;
        const progressOnly = !!(held && opts.snapshot && !newer);

        if (!entry) {
            entry = {
                uid: src.uid || opts.uid || `cf_${Math.round(x)}_${Math.round(y)}`,
                id: src.id || "campfire",
                x,
                y,
                rev: Number.isFinite(incomingRev) ? incomingRev : 0,
                fuel: src.fuel || [null, null],
                cook: src.cook ?? null,
                catalyst: src.catalyst ?? null,
                simmer: src.simmer || [null, null, null, null],
                cookProgress: src.cookProgress || 0,
                burnRemaining: src.burnRemaining || 0,
                roastBarMinutes: src.roastBarMinutes || 0,
                simmerBarMinutes: src.simmerBarMinutes || 0
            };
            chunk.meta.things.push(entry);
        } else if (progressOnly) {
            if (src.id) entry.id = src.id;
            if (src.cookProgress != null) entry.cookProgress = src.cookProgress;
            if (src.burnRemaining != null) entry.burnRemaining = src.burnRemaining;
            if (src.roastBarMinutes != null) entry.roastBarMinutes = src.roastBarMinutes;
            if (src.simmerBarMinutes != null) entry.simmerBarMinutes = src.simmerBarMinutes;
            if (Number.isFinite(incomingRev)) entry.rev = Math.max(curRev || 0, incomingRev);
            this._netSyncCampfireSprite(chunk, entry, src.id || entry.id, x, y);
            this.campfirePanel?.refreshCookBar?.();
            return;
        } else {
            entry.uid = src.uid || opts.uid || entry.uid;
            if (src.id) entry.id = src.id;
            entry.x = x;
            entry.y = y;
            if (Number.isFinite(incomingRev)) entry.rev = incomingRev;
            if (src.fuel) entry.fuel = src.fuel;
            if ("cook" in src) entry.cook = src.cook;
            if ("catalyst" in src) entry.catalyst = src.catalyst;
            if (src.simmer) entry.simmer = src.simmer;
            if (src.cookProgress != null) entry.cookProgress = src.cookProgress;
            if (src.burnRemaining != null) entry.burnRemaining = src.burnRemaining;
            if (src.roastBarMinutes != null) entry.roastBarMinutes = src.roastBarMinutes;
            else delete entry.roastBarMinutes;
            if (src.simmerBarMinutes != null) entry.simmerBarMinutes = src.simmerBarMinutes;
            else delete entry.simmerBarMinutes;
        }
        this._netSyncCampfireSprite(chunk, entry, src.id || entry.id, x, y);
        this.markLightDirty?.();
        this.updateLightVeil?.();
        this.campfirePanel?.refresh?.();
    }

    _netFindCampfireSprite(entry, x, y) {
        const uid = entry?.uid || null;
        const fires = this.getCampfires();
        let byPos = null;
        for (const fire of fires) {
            if (!fire?.active) continue;
            if (entry && fire.entry === entry) return fire;
            if (uid && fire.entry?.uid && fire.entry.uid === uid) return fire;
            if (
                !byPos
                && Number.isFinite(x) && Number.isFinite(y)
                && Math.abs(fire.x - x) < 1.5
                && Math.abs(fire.y - y) < 1.5
            ) {
                byPos = fire;
            }
        }
        return byPos;
    }

    _netSyncCampfireSprite(chunk, entry, wantId, x, y) {
        if (!entry) return;
        const id = wantId || entry.id;
        const live = this._netFindCampfireSprite(entry, x, y);
        if (live) {
            if (live.entry !== entry) live.entry = entry;
            if (id && typeof live.setKind === "function" && live.meta?.id !== id) {
                live.setKind(id);
            }
            this._netDedupeCampfireSprites(entry, x, y, live);
            return;
        }
        if (chunk?.isLoaded) chunk.things.add(new Campfire(this, entry));
    }

    _netDedupeCampfireSprites(entry, x, y, keep) {
        const uid = entry?.uid || keep?.entry?.uid || null;
        for (const fire of this.getCampfires()) {
            if (fire === keep || !fire?.active) continue;
            const sameUid = !!(uid && fire.entry?.uid && fire.entry.uid === uid);
            const samePos = Number.isFinite(x) && Number.isFinite(y)
                && Math.abs(fire.x - x) < 1.5
                && Math.abs(fire.y - y) < 1.5;
            if (!sameUid && !samePos) continue;
            if (this.campfirePanel?.campfire === fire) this.campfirePanel.campfire = keep;
            fire.destroy();
        }
    }

    _netApplyCampfireEvent(ev) {
        if (!ev || this.net?.isLocal) return;
        const src = ev.entry || ev;
        this._netApplyCampfirePayload(src, {
            snapshot: false,
            cx: ev.cx,
            cy: ev.cy,
            uid: ev.uid || src.uid,
            rev: ev.rev
        });
    }

    _netApplyCampfires(list) {
        if (this.net?.isLocal) return;
        if (!Array.isArray(list)) return;
        for (const src of list) {
            if (!src) continue;
            this._netApplyCampfirePayload(src, {
                snapshot: true,
                cx: src.cx,
                cy: src.cy,
                uid: src.uid,
                rev: src.rev
            });
        }
    }

    /** Unarmed thrust fill for remotes / net mobs. */
    _netFistColor(entry) {
        if (entry?.look && typeof PlayerLook !== "undefined") {
            return PlayerLook.fistColor(entry.look);
        }
        const kind = entry?.kind || "";
        if (kind === "human" || kind === "player") return 0xff8900;
        const def = kind && typeof this.getMob === "function" ? this.getMob(kind) : null;
        if (Number.isFinite(def?.fistColor)) return def.fistColor >>> 0;
        return 0x000000;
    }

    _netStartRemoteAttack(entry, angle, facing = null, art = null) {
        if (!entry) return;
        const a = Number(angle);
        entry.attackAngle = Number.isFinite(a) ? a : 0;
        const resolvedArt = art && typeof art === "object"
            ? { ...art }
            : { unarmed: true, range: 4, max: 833 };
        entry.attackArt = resolvedArt;
        const max = Number(resolvedArt.max);
        entry.attackMax = Number.isFinite(max) && max > 0 ? max : 833;
        entry.attackTimer = entry.attackMax;
        if (facing) entry.facing = facing;
        else if (Number.isFinite(a)) {
            const ang = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            if (ang >= Math.PI * 0.25 && ang < Math.PI * 0.75) entry.facing = "down";
            else if (ang >= Math.PI * 0.75 && ang < Math.PI * 1.25) entry.facing = "left";
            else if (ang >= Math.PI * 1.25 && ang < Math.PI * 1.75) entry.facing = "up";
            else entry.facing = "right";
        }

        const useWeapon = !resolvedArt.unarmed && !!resolvedArt.key;
        if (useWeapon) {
            let texKey = resolvedArt.key;
            if (
                resolvedArt.knapIconData
                && typeof Knapping !== "undefined"
                && typeof Knapping.ensureToolTexture === "function"
            ) {
                try {
                    texKey = Knapping.ensureToolTexture(this, {
                        id: resolvedArt.itemId || "knap",
                        knapIconData: resolvedArt.knapIconData,
                        knapIcon: resolvedArt.key
                    }) || texKey;
                    resolvedArt.key = texKey;
                } catch (_) { /* fall through */ }
            }
            if (!this.textures.exists(texKey)) {
                // Missing texture — fist fallback
                resolvedArt.unarmed = true;
            } else {
                if (!entry.weapon || !entry.weapon.active) {
                    entry.weapon = this.add.image(0, 0, texKey)
                        .setOrigin(0.2, 0.8)
                        .setVisible(false);
                    entry.root.add(entry.weapon);
                } else if (entry.weapon.texture?.key !== texKey) {
                    entry.weapon.setTexture(texKey);
                }
                entry.weapon.setOrigin(0.2, 0.8).setScale(1).setVisible(true).setDepth(1);
                if (entry.fist) entry.fist.setVisible(false);
                this._netUpdateRemoteAttackSprites(entry, 0);
                return;
            }
        }

        if (!entry.fist || !entry.fist.active) {
            const color = this._netFistColor(entry);
            entry.fist = this.add.rectangle(0, 0, 4, 10, color, 1)
                .setOrigin(0.5, 1);
            entry.root.add(entry.fist);
        } else {
            entry.fist.setFillStyle(this._netFistColor(entry), 1);
        }
        entry.fist.setVisible(true);
        if (entry.weapon) entry.weapon.setVisible(false);
        this._netUpdateRemoteAttackSprites(entry, 0);
    }

    /** Animate remote fist / weapon along aim (local coords inside entry.root). */
    _netUpdateRemoteAttackSprites(entry, progress) {
        if (!entry) return;
        const art = entry.attackArt || { unarmed: true, range: 4 };
        const ang = entry.attackAngle || 0;
        const cx = (entry.spr?.width || 16) * 0.5;
        const cy = -(entry.spr?.height || 16) * 0.5;
        const useWeapon = !art.unarmed && entry.weapon?.visible;

        if (useWeapon) {
            const range = Number(art.range) || 12;
            const thrust = typeof meleeThrustCurve === "function"
                ? meleeThrustCurve(progress)
                : progress;
            const hold = art.knapSilhouette ? 5 : 6;
            const anchorDist = hold + range * thrust;
            const ax = cx + Math.cos(ang) * anchorDist;
            const ay = cy + Math.sin(ang) * anchorDist;
            const rot = art.knapSilhouette ? ang + Math.PI / 2 : ang + Math.PI / 4;
            entry.weapon.setRotation(rot);

            const fw = entry.weapon.frame?.width || entry.weapon.width || 16;
            const fh = entry.weapon.frame?.height || entry.weapon.height || 16;
            // Mid-frame local offset (sprite origin 0.2, 0.8)
            const localX = (fw - 1) * 0.5 - entry.weapon.originX * fw;
            const localY = (fh - 1) * 0.5 - entry.weapon.originY * fh;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            const ox = localX * cos - localY * sin;
            const oy = localX * sin + localY * cos;
            entry.weapon.setPosition(ax - ox, ay - oy);
            entry.weapon.setDepth(1);
            return;
        }

        if (entry.fist && typeof placeUnarmedThrustSprite === "function") {
            placeUnarmedThrustSprite(
                entry.fist, cx, cy, ang, Number(art.range) || 4, progress, null
            );
        }
    }

    _netOnWorldRegen(seed) {
        worldSeed = seed;
        noise.seed(worldSeed);
        this.regenChunks();
        for (const entry of this.netMobs.values()) entry.root?.destroy?.(true);
        this.netMobs.clear();
        for (const spr of this.netDrops.values()) {
            if (spr?.active) {
                if (typeof spr.persistDestroy === "function") spr.persistDestroy();
                else spr.destroy();
            }
        }
        this.netDrops.clear();
        if (this.netCorpses) {
            for (const spr of this.netCorpses.values()) {
                if (spr?.active) spr.destroy();
            }
            this.netCorpses.clear();
        }
        this._spawnSignPlaced = false;
        this._spawnSignBusy = false;
        this._netAwaitPoseFromYou = true;
        this.net.sendAction({ type: NetProtocol.Actions.RESYNC });
    }

    _netSendMove(force = false) {
        if (!this.isNet || !this.net?.connected || !this.player) return;
        const now = performance.now();
        if (!force && this._netMoveAt && now - this._netMoveAt < 1000 / NetProtocol.MOVE_HZ) return;
        this._netMoveAt = now;

        const p = this.player;
        let x = 0;
        let y = 0;
        if (
            !this._gamePaused
            && !p.isIncapacitated?.()
            && !p.isImmobile?.()
            && !p.isVomiting?.()
        ) {
            const left = p.cursors.left.isDown || p.keys.A.isDown;
            const right = p.cursors.right.isDown || p.keys.D.isDown;
            const up = p.cursors.up.isDown || p.keys.W.isDown;
            const down = p.cursors.down.isDown || p.keys.S.isDown;
            x = (right ? 1 : 0) - (left ? 1 : 0);
            y = (down ? 1 : 0) - (up ? 1 : 0);
        }
        this.net.sendMove({
            x,
            y,
            sprint: !this._gamePaused && !!p.isSprinting,
            facing: p.facing || "down",
            px: p.x,
            py: p.y,
            viewChunks: this.genDistance || this.cullDistance || this.renderDistance || 6
        });
    }

    _netUpdateRemotes(delta) {
        const t = Math.min(1, (delta || 16) / 1000 * 14);
        const now = this.time?.now || 0;
        for (const entry of this.remotePlayers.values()) {
            entry.x = Phaser.Math.Linear(entry.x, entry.tx, t);
            entry.y = Phaser.Math.Linear(entry.y, entry.ty, t);
            entry.root.setPosition(entry.x, entry.y);
            // Same Y-sort as local Player / Things / net mobs (not y+40 — that floats above trees)
            entry.root.setDepth(entry.y);
            const attacking = entry.attackTimer > 0;
            const prone = !!entry.prone;
            if (typeof setPuppetProne === "function") {
                setPuppetProne(entry.spr, prone);
            }
            const moving = !attacking && !prone && Math.hypot(entry.tx - entry.x, entry.ty - entry.y) > 0.35;
            if (moving) {
                const dx = entry.tx - entry.x;
                const dy = entry.ty - entry.y;
                entry.facing = Math.abs(dx) > Math.abs(dy)
                    ? (dx > 0 ? "right" : "left")
                    : (dy > 0 ? "down" : "up");
            }
            if (!prone) {
                const facing = entry.facing || "down";
                if (typeof PlayerLook !== "undefined") {
                    PlayerLook.play(entry.spr, facing, moving);
                } else {
                    const key = moving ? `walk-${facing}` : `idle-${facing}`;
                    if (this.anims.exists(key)) entry.spr.play(key, true);
                }
            }

            if (attacking) {
                entry.attackTimer = Math.max(0, entry.attackTimer - delta);
                const progress = entry.attackMax > 0
                    ? 1 - entry.attackTimer / entry.attackMax
                    : 1;
                this._netUpdateRemoteAttackSprites(entry, progress);
                if (entry.attackTimer <= 0) {
                    if (entry.fist) entry.fist.setVisible(false);
                    if (entry.weapon) entry.weapon.setVisible(false);
                    entry.attackArt = null;
                } else {
                    const art = entry.attackArt;
                    const useWeapon = art && !art.unarmed && entry.weapon;
                    if (entry.fist) entry.fist.setVisible(!useWeapon);
                    if (entry.weapon) entry.weapon.setVisible(!!useWeapon);
                }
            } else {
                if (entry.fist?.visible) entry.fist.setVisible(false);
                if (entry.weapon?.visible) entry.weapon.setVisible(false);
            }

            if (entry.bubble.visible) {
                if (now >= entry.bubbleUntil) {
                    entry.bubble.setVisible(false);
                } else {
                    const fadeMs = 2000;
                    const remaining = entry.bubbleUntil - now;
                    entry.bubble.setAlpha(
                        remaining < fadeMs ? Phaser.Math.Clamp(remaining / fadeMs, 0, 1) : 1
                    );
                }
            }
            this._netLayoutRemoteLabels(entry);
        }
    }

    shutdown() {
        this._teardownCharacterAutosave?.();
        if (this._gamePaused) {
            try { this.net?.setPaused?.(false); } catch (_) {}
            try { this.physics?.world?.resume?.(); } catch (_) {}
            this._gamePaused = false;
        }
        // Leave already saved + closed LocalSim; don't kick off another async close.
        if (this._leavingGame) {
            this._netLeaving = true;
            return;
        }
        if (this.isNet && this.characterId && !this._netLeaving) {
            try {
                this._saveCharacterNow();
            } catch (_) {}
        }
        this._netLeaving = true;
        if (this.isNet) this.net?.close();
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

        const zoom = this.worldZoom || this.cameras.main?.zoom || 1;
        const w = 40;
        const h = 5;

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
        if (typeof Durability !== "undefined" && Durability.rampBarFillColor) {
            return Durability.rampBarFillColor(frac);
        }
        return 0x3CB043;
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

        this.tooltip = this.add.container(0, 0).setDepth(40000).setVisible(false);
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

            // Campfire panel (world-space): only slots steal hits — the hole over the
            // fire must stay clickable so toggle-close still works.
            const campP = this.campfirePanel;
            if (campP?.visible && campP.containsPointer?.(pointer)) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                    if (this._isUnderCampfirePanel(obj)) return obj;
                }
                return campP.container;
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

        this._isUnderCampfirePanel = (obj) => {
            const panel = this.campfirePanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container) return true;
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
        }).setOrigin(0.5, 0).setDepth(9998).setScrollFactor(0);
        this.uiLayer.add(this.fpsText);
        this._fpsVisible = true;
        this.fpsText.setVisible(true).setText(this._fpsPlaceholderText());
        /** @type {{ t: number, d: number }[]} frame deltas in the last ~1s */
        this._fpsSamples = [];
        this._fpsUiAcc = 0;

        // /debug location — blue X + red Y above hotbar center
        const locStyle = {
            fontSize: "14px",
            fontFamily: "monospace",
            stroke: "#000000",
            strokeThickness: 3
        };
        this.locXText = this.add.text(0, 0, "", { ...locStyle, color: "#4da6ff" })
            .setOrigin(1, 1).setDepth(9998).setScrollFactor(0).setVisible(false);
        this.locYText = this.add.text(0, 0, "", { ...locStyle, color: "#ff5555" })
            .setOrigin(0, 1).setDepth(9998).setScrollFactor(0).setVisible(false);
        this.uiLayer.add(this.locXText);
        this.uiLayer.add(this.locYText);
        this._locationDebugVisible = false;
    }

    setFpsMeter(on) {
        this._fpsVisible = !!on;
        this.fpsText?.setVisible(this._fpsVisible);
        this._fpsSamples = [];
        this._fpsUiAcc = 0;
        if (!this._fpsVisible) {
            this.fpsText?.setText("");
        } else {
            // applyUiScale needs craft/UI buttons — skip if create() isn't finished yet
            if (this.craftContainer) this.applyUiScale?.();
            this.fpsText?.setText(this._fpsPlaceholderText());
        }
        return this._fpsVisible;
    }

    /** Dedicated MP: wildlife is server-owned — client mob count is meaningless. */
    _fpsShowsMobs() {
        return !(this.isNet && this.net && !this.net.isLocal);
    }

    _fpsPlaceholderText() {
        return this._fpsShowsMobs() ? "— fps · 0 mobs" : "— fps";
    }

    setLocationDebug(on) {
        this._locationDebugVisible = !!on;
        this.locXText?.setVisible(this._locationDebugVisible);
        this.locYText?.setVisible(this._locationDebugVisible);
        if (!this._locationDebugVisible) {
            this.locXText?.setText("");
            this.locYText?.setText("");
        } else {
            if (this.craftContainer) this.applyUiScale?.();
            this.updateLocationDebug?.();
        }
        return this._locationDebugVisible;
    }

    updateLocationDebug() {
        if (!this._locationDebugVisible || !this.locXText || !this.locYText) return;
        const p = this.player;
        if (!p) {
            this.locXText.setText("—");
            this.locYText.setText(" —");
            return;
        }
        // Tile space at sprite bottom-middle (origin is bottom-left).
        // Keep fractional offset; don't round/floor/ceil.
        const ts = this.tileSize || 16;
        const w = p.displayWidth || p.width || ts;
        const feetX = (p.x + w * 0.5) / ts;
        const feetY = p.y / ts;
        const fmt = (v) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return "—";
            // 4 decimals covers 1/16 px-per-tile steps without float junk
            return n.toFixed(4).replace(/\.?0+$/, "");
        };
        this.locXText.setText(fmt(feetX));
        this.locYText.setText(` ${fmt(feetY)}`);
    }

    _layoutLocationDebug() {
        if (!this.locXText || !this.locYText) return;
        const s = this.uiScale || 1;
        const cx = this.scale.width / 2;
        const slot0 = this.hotbar?.slots?.[0];
        const slotW = this.hotbar?.slotW || Math.round(32 * s);
        const slotTop = slot0
            ? slot0.y - slotW
            : this.scale.height - Math.round(48 * s);
        const y = slotTop - Math.round(4 * s);
        const font = `${Math.round(14 * s)}px`;
        const stroke = Math.max(2, Math.round(3 * s));
        this.locXText
            .setFontSize(font)
            .setStroke("#000000", stroke)
            .setOrigin(1, 1)
            .setPosition(cx, y);
        this.locYText
            .setFontSize(font)
            .setStroke("#000000", stroke)
            .setOrigin(0, 1)
            .setPosition(cx, y);
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
        if (this._fpsShowsMobs()) {
            const mobs = this.mobs?.countActive?.(true) ?? 0;
            this.fpsText.setText(`${avg} fps (min ${min}) · ${mobs} mobs`);
        } else {
            this.fpsText.setText(`${avg} fps (min ${min})`);
        }
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
        const linesOf = () => {
            if (Array.isArray(thing.entry?.tooltip) && thing.entry.tooltip.length) {
                return thing.entry.tooltip;
            }
            return thing.meta?.tooltip || [];
        };
        if (!linesOf().length) return;
        thing.setInteractive({ cursor: "pointer", pixelPerfect: false });
        thing.on("pointerover", (pointer) => {
            this.showTooltip(
                () => linesOf().join("\n"),
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

    _worldDisplayName() {
        const n = this.worldName || this.welcome?.worldName;
        return (n && String(n).trim()) || "World";
    }

    _spawnSignTooltip() {
        return [`Welcome to ${this._worldDisplayName()}!`];
    }

    /** Rock: click to knap + hover tip while holding pebble/flint. */
    wireRockKnapping(thing) {
        if (!thing || thing.meta?.id !== "rock") return;
        // Default arrow; _cursorFor switches to pointer only when knap tip is active
        thing.setInteractive({ cursor: "default", pixelPerfect: false });
        thing.on("pointerdown", (pointer) => {
            if (this.pointerOverWorldUi?.(pointer)) return;
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

    /**
     * True when the pointer is over world-anchored UI (corpse/campfire panels).
     * World click handlers must bail so rocks/corpses behind the chrome don't fire.
     */
    pointerOverWorldUi(pointer) {
        if (!pointer) return false;
        if (this.corpsePanel?.containsPointer?.(pointer)) return true;
        if (this.campfirePanel?.containsPointer?.(pointer)) return true;
        return false;
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
        // Multiplayer: terrain comes from the server — don't locally generate a parallel world
        if (this.isNet) return;
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

            // Net: wait until the origin chunk has arrived from the server
            if (this.isNet) {
                const { x, y } = this.tileCenter(0, 0);
                const origin = this.getChunkAtWorld(x, y - 1);
                if (!origin?.isLoaded) return;
            }

            let hasSign = false;
            for (const chunk of Object.values(this.chunks)) {
                for (const t of chunk.meta?.things || []) {
                    if (t.id === "sign" && t.spawnHint) {
                    hasSign = true;
                        t.tooltip = this._spawnSignTooltip();
                    }
                }
            }

            if (!hasSign && !this._spawnSignPlaced) {
                this._clearTileThings(0, 0);
                const { x, y } = this.tileCenter(0, 0);
                const chunk = this.getChunkAtWorld(x, y - 1);
                if (!chunk) return;
                const entry = {
                    id: "sign",
                    x,
                    y,
                    spawnHint: true,
                    tooltip: this._spawnSignTooltip()
                };
                    chunk.meta.things.push(entry);
                    if (chunk.isLoaded) {
                        const thing = new Thing(this, entry.x, entry.y, entry.id);
                    thing.entry = entry;
                        this.wireThingTooltip(thing);
                        chunk.things.add(thing);
                }
                this._spawnSignPlaced = true;
            } else {
                this._spawnSignPlaced = true;
            }

            // First join / fresh world — same random free-tile ring as respawn (−4…4).
            // Do not gate on hasSign: another character may already have placed the origin sign.
            if (!this._playerSpawnPlaced) {
                const pick = this.pickRandomSpawnTile(radius, Math.random);
                if (pick) {
                    this.player.teleport(pick.x, pick.y);
                    this.syncCameraToPlayer();
                    if (this.net?.isLocal) {
                        this.net.syncPawnFromClient?.(this._playerCharacterPartial());
                        this.net.rememberPose?.();
                    } else if (this.isNet && this.net?.connected) {
                        this._netSendMove(true);
                    }
                }
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

    /** Pointer world position for firestarter aim, or null. */
    _firestarterAimWorld() {
        const pointer = this.input?.activePointer;
        if (!pointer || !this.cameras?.main) return null;
        return this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    }

    /**
     * Tile under a ground drop's sprite. Drops use origin (0, 1), so the stored
     * x,y is the bottom-left — using that directly often picks the tile to the
     * left of the visible pile.
     */
    _dropVisualTile(drop) {
        if (!drop) return null;
        const b = drop.getBounds?.();
        if (b && Number.isFinite(b.centerX) && Number.isFinite(b.centerY)) {
            return this.worldToTile(b.centerX, b.centerY);
        }
        const w = Number(drop.displayWidth) || this.tileSize * 0.7;
        return this.worldToTile(Number(drop.x) + w * 0.5, Number(drop.y) - 1);
    }

    _pickDropNearAim(drops, aim, itemId) {
        const list = drops.filter(d => d.item?.id === itemId);
        if (!list.length) return null;
        if (!aim) return list[0];
        const aimR2 = (this.tileSize * 1.25) * (this.tileSize * 1.25);
        let aimed = null;
        let nearest = list[0];
        let nearestD = Infinity;
        for (const d of list) {
            const dx = d.x - aim.x;
            const dy = d.y - aim.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < nearestD) {
                nearestD = d2;
                nearest = d;
            }
            const b = d.getBounds?.();
            const underCursor = d2 <= aimR2
                || !!(b && Phaser.Geom.Rectangle.Contains(b, aim.x, aim.y));
            if (underCursor && !aimed) aimed = d;
        }
        return aimed || nearest;
    }

    /**
     * Tile for a new campfire from ground sticks/leaves.
     * Prefer the leaf pile under the cursor (else nearest leaf to aim);
     * fall back to sticks only if there are no leaves.
     */
    campfireTileFromDrops(drops, aim = null) {
        const anchor = this._pickDropNearAim(drops, aim, "leaf")
            || this._pickDropNearAim(drops, aim, "stick");
        if (!anchor) return null;
        return this._dropVisualTile(anchor);
    }

    /**
     * True when Space + firestarter should light instead of attack:
     * cursor on/near an in-range unlit fueled campfire, or on/near stick/leaf
     * piles with enough materials in interaction range for a new fire.
     */
    canUseFirestarter() {
        const pointer = this.input?.activePointer;
        if (!pointer || !this.player) return false;
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;
        const aimR = this.tileSize * 1.25;
        const aimR2 = aimR * aimR;

        const nearAim = (x, y, spr = null) => {
            const dx = x - world.x;
            const dy = y - world.y;
            if (dx * dx + dy * dy <= aimR2) return true;
            const b = spr?.getBounds?.();
            return !!(b && Phaser.Geom.Rectangle.Contains(b, world.x, world.y));
        };

        for (const fire of this.getCampfires()) {
            if (!fire?.active || fire.isLit() || !fire.hasFuel()) continue;
            const dx = fire.x - px;
            const dy = fire.y - py;
            if (dx * dx + dy * dy > r2) continue;
            if (nearAim(fire.x, fire.y, fire)) return true;
        }

        const drops = this.nearbyDrops();
        let sticks = 0;
        let leaves = 0;
        let aimAtMaterial = false;
        for (const d of drops) {
            const id = d.item?.id;
            if (id === "stick") sticks += d.quantity;
            else if (id === "leaf") leaves += d.quantity;
            if ((id === "stick" || id === "leaf") && nearAim(d.x, d.y, d)) {
                aimAtMaterial = true;
            }
        }
        if (!aimAtMaterial || sticks < 15 || leaves < 10) return false;
        const tile = this.campfireTileFromDrops(drops, world);
        if (!tile) return false;
        if (this.findCampfireOnTile(tile.tx, tile.ty)) return false;
        return true;
    }

    tryUseFirestarter() {
        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this._netSendMove?.(true);
            const aim = this._firestarterAimWorld();
            this.net.sendAction({
                type: NetProtocol.Actions.LIGHT_FIRE,
                x: aim?.x,
                y: aim?.y
            });
            return true;
        }
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
            this.player?.wearHeld?.(1);
            return true;
        }

        // Ground recipe: 15 sticks + 10 leaves — spawn on the leaves' tile
        // (the pile under the cursor, else nearest leaf to aim).
        const drops = this.nearbyDrops();
        const tile = this.campfireTileFromDrops(drops, this._firestarterAimWorld());
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
        if (fire) this.player?.wearHeld?.(1);
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
        if (!this.clockText?.active || !this.clockText.scene) return;
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
        // Net: server advances the clock; local timer stays off
        if (this.isNet) return this.tickSpeed;
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
        // Multiplayer clock is applied from server snapshots
        if (this.isNet) return;

        this.gameMinutes += 1;
        if (this.gameMinutes >= 24 * 60) {
            this.gameMinutes = 0;
            this.gameDay += 1;
        }
        this.updateClockText();
        this.updateTimeTint();

        this.player.hungerTick();
        this.tickSpoilage();
        this.tickCorpseDecay();
        this.tickCampfires();
        this.tickLootableRegrows();
        this.tickBodySystems();
        this.tickBloodStains();
    }

    tickBodySystems() {
        // Dedicated: server owns bleed/heal/hediffs. Blood VFX arrives via "bleed" events.
        // Running minuteTick here double-applied bloodLoss and only dripped on one client.
        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this.healthPanel?.refresh?.();
            return;
        }
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

    spawnBloodStain(x, y, opts = null) {
        if (this.bloodDraw === false) return;
        // No blood pools on water (ice is fine)
        if (this._isWaterAt(x, y - 1)) return;
        const chunk = LivingMob.ensureChunkAt(this, x, y);
        if (!chunk) return;
        if (!chunk.meta.bloodStains) chunk.meta.bloodStains = [];
        const list = chunk.meta.bloodStains;
        const kind = opts?.kind || "blood";
        const isVomit = kind === "vomit";
        const color = opts?.color != null
            ? opts.color
            : (isVomit ? 0x7a9e28 : 0x6b1010);
        const rMin = opts?.radiusMin != null
            ? opts.radiusMin
            : (isVomit ? 0.7 : SceneMain.BLOOD_RADIUS_MIN);
        const rMax = opts?.radiusMax != null
            ? opts.radiusMax
            : (isVomit ? 1.8 : Math.min(2.4, SceneMain.BLOOD_RADIUS_MAX));
        const rCap = opts?.radiusCap != null
            ? opts.radiusCap
            : (isVomit ? 4.5 : SceneMain.BLOOD_RADIUS_MAX);
        const grow = opts?.grow != null
            ? opts.grow
            : (isVomit ? 0.35 : SceneMain.BLOOD_MERGE_GROW);
        const alpha = opts?.alpha != null
            ? opts.alpha
            : (isVomit ? 0.7 : 0.55);
        const mergeDist = isVomit
            ? SceneMain.BLOOD_MERGE_DIST * 1.35
            : SceneMain.BLOOD_MERGE_DIST;
        const mergeDistSq = mergeDist * mergeDist;

        // Grow a nearby pool of the same kind instead of adding another circle
        let best = null;
        let bestD = mergeDistSq;
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if ((e.kind || "blood") !== kind) continue;
            const dx = e.x - x;
            const dy = e.y - y;
            const d = dx * dx + dy * dy;
            if (d <= bestD) {
                bestD = d;
                best = e;
            }
        }
        if (best) {
            best.radius = Math.min(
                rCap,
                (Number(best.radius) || rMin) + grow
            );
            // Pull pool slightly toward the new drip
            best.x = best.x * 0.75 + x * 0.25;
            best.y = best.y * 0.75 + y * 0.25;
            best.lifeMinutes = SceneMain.BLOOD_LIFE_MINUTES;
            best.color = color;
            best.kind = kind;
            best.alpha = alpha;
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
            kind,
            color,
            alpha,
            radius: Phaser.Math.FloatBetween(rMin, Math.min(rMax, rCap)),
            lifeMinutes: SceneMain.BLOOD_LIFE_MINUTES
        };
        list.push(entry);
        if (!chunk.isLoaded) return;
        if (needsRebuild) this.rebuildBloodGfx(chunk);
        else this._paintBloodStain(chunk, entry);
    }

    /**
     * Projectile bile spray: staggered elongated droplets fly from the mouth
     * in a cone, then leave small puddle stains on impact.
     * @param {number} x mouth / origin x
     * @param {number} y mouth / origin y
     * @param {{ facing?: string }} [opts]
     */
    spawnVomitStain(x, y, opts = null) {
        const facing = opts?.facing || "down";
        let fx = 0;
        let fy = 1;
        if (facing === "right") { fx = 1; fy = 0; }
        else if (facing === "left") { fx = -1; fy = 0; }
        else if (facing === "up") { fx = 0; fy = -1; }
        const px = -fy;
        const py = fx;

        // Sickly bile / olive / mustard — not neon highlighter green
        const palette = [
            0x6b8f22, 0x7a9e28, 0x9bb83a, 0xa8a030,
            0xc2c84a, 0x5a7a1c, 0x8a6e20, 0x4e6818
        ];

        const count = Phaser.Math.Between(14, 22);
        for (let i = 0; i < count; i++) {
            const delay = i * Phaser.Math.Between(10, 26);
            // Mix short dribbles with longer projectiles
            const roll = Math.random();
            const dist = roll < 0.25
                ? Phaser.Math.FloatBetween(4, 10)
                : roll < 0.7
                    ? Phaser.Math.FloatBetween(10, 22)
                    : Phaser.Math.FloatBetween(20, 34);
            const cone = 2.5 + dist * 0.32;
            const spread = (Math.random() - 0.5) * 2 * cone;
            const jx = (Math.random() - 0.5) * 1.5;
            const jy = (Math.random() - 0.5) * 1.5;
            const landX = x + fx * dist + px * spread + jx;
            const landY = y + fy * dist + py * spread + jy;
            const color = Phaser.Utils.Array.GetRandom(palette);
            const size = Phaser.Math.FloatBetween(0.55, 1.55);
            const flightMs = Phaser.Math.Clamp(
                110 + dist * 7 + Phaser.Math.Between(0, 60),
                120,
                380
            );

            this.time.delayedCall(delay, () => {
                if (!this.sys?.isActive?.()) return;
                this._spawnVomitDroplet(x, y, landX, landY, {
                    color,
                    size,
                    flightMs,
                    fx,
                    fy,
                    px,
                    py
                });
            });
        }
    }

    /**
     * One flying vomit droplet; leaves ground stains on impact.
     * @param {number} sx
     * @param {number} sy
     * @param {number} lx
     * @param {number} ly
     * @param {{ color: number, size: number, flightMs: number, fx: number, fy: number, px: number, py: number }} opts
     */
    _spawnVomitDroplet(sx, sy, lx, ly, opts) {
        const dx = lx - sx;
        const dy = ly - sy;
        const len = Math.hypot(dx, dy) || 1;
        const angle = Math.atan2(dy, dx);
        const color = opts.color;
        const r = opts.size;

        // Elongated blob stretched along flight direction
        const blob = this.add.circle(sx, sy, r, color, 0.92);
        this.mainLayer?.add(blob);
        blob.setDepth(sy + 28);
        blob.setRotation(angle);
        const stretchX = Phaser.Math.FloatBetween(1.7, 2.6);
        const stretchY = Phaser.Math.FloatBetween(0.4, 0.65);
        blob.setScale(stretchX, stretchY);

        // Loft the path slightly (screen-up) so it reads as a spray arc in top-down
        const loft = Phaser.Math.FloatBetween(3, 8);
        const sideWobble = (Math.random() - 0.5) * 3;
        const midX = (sx + lx) * 0.5 + opts.px * sideWobble;
        const midY = (sy + ly) * 0.5 + opts.py * sideWobble - loft;

        const state = { t: 0 };
        this.tweens.add({
            targets: state,
            t: 1,
            duration: opts.flightMs,
            ease: "Cubic.easeOut",
            onUpdate: () => {
                if (!blob.active) return;
                const t = state.t;
                const omt = 1 - t;
                // Quadratic Bezier mouth → loft → land
                blob.x = omt * omt * sx + 2 * omt * t * midX + t * t * lx;
                blob.y = omt * omt * sy + 2 * omt * t * midY + t * t * ly;
                const bulge = 1 + Math.sin(t * Math.PI) * 0.4;
                blob.setScale(stretchX * bulge, stretchY * bulge);
                blob.setAlpha(0.95 - t * 0.12);
                blob.setDepth(blob.y + 28);

                // Occasional mid-air drip trail
                if (t > 0.2 && t < 0.85 && Math.random() < 0.04) {
                    this.spawnBloodStain(blob.x, blob.y, {
                        kind: "vomit",
                        color,
                        alpha: Phaser.Math.FloatBetween(0.35, 0.55),
                        radiusMin: 0.35,
                        radiusMax: 0.8,
                        radiusCap: 2.2,
                        grow: 0.2
                    });
                }
            },
            onComplete: () => {
                if (blob.active) blob.destroy();
                // Primary splat
                this.spawnBloodStain(lx, ly, {
                    kind: "vomit",
                    color,
                    alpha: Phaser.Math.FloatBetween(0.55, 0.8),
                    radiusMin: 0.7,
                    radiusMax: 1.9,
                    radiusCap: 4.2,
                    grow: 0.4
                });
                // Satellite flecks
                const flecks = Phaser.Math.Between(1, 3);
                for (let i = 0; i < flecks; i++) {
                    const ang = Math.random() * Math.PI * 2;
                    const d = Phaser.Math.FloatBetween(1.5, 5);
                    this.spawnBloodStain(
                        lx + Math.cos(ang) * d,
                        ly + Math.sin(ang) * d,
                        {
                            kind: "vomit",
                            color: Phaser.Utils.Array.GetRandom([
                                color, 0x5a7a1c, 0x8a6e20
                            ]),
                            alpha: Phaser.Math.FloatBetween(0.4, 0.65),
                            radiusMin: 0.35,
                            radiusMax: 0.9,
                            radiusCap: 2.5,
                            grow: 0.2
                        }
                    );
                }
            }
        });
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
        const isVomit = (entry.kind || "blood") === "vomit";
        const rCap = isVomit ? 4.5 : SceneMain.BLOOD_RADIUS_MAX;
        const rMin = isVomit ? 0.55 : SceneMain.BLOOD_RADIUS_MIN;
        const r = Phaser.Math.Clamp(
            Number(entry.radius) || rMin,
            rMin,
            rCap
        );
        entry.radius = r;
        const rt = this._ensureBloodRt(chunk);
        rt.setVisible(true);
        const size = chunk.px();
        const lx = entry.x - chunk.x * size;
        const ly = entry.y - chunk.y * size;
        const stamp = this._bloodStampGfx();
        stamp.clear();
        const color = entry.color != null ? entry.color : (isVomit ? 0x7a9e28 : 0x6b1010);
        const alpha = entry.alpha != null ? entry.alpha : (isVomit ? 0.7 : 0.55);

        if (isVomit) {
            // Irregular small puddle — lobes stay subtle so it doesn't read as big circles
            stamp.fillStyle(color, alpha);
        stamp.fillCircle(0, 0, r);
            stamp.fillStyle(color, Math.min(1, alpha + 0.05));
            stamp.fillCircle(r * 0.4, r * 0.15, r * 0.45);
            stamp.fillCircle(-r * 0.35, r * 0.25, r * 0.38);
            // Darker sludge fleck
            stamp.fillStyle(0x3d5210, alpha * 0.5);
            stamp.fillCircle(-r * 0.15, -r * 0.1, r * 0.22);
            // Dull highlight (not neon)
            stamp.fillStyle(0xc5c85a, alpha * 0.28);
            stamp.fillCircle(r * 0.08, r * 0.02, r * 0.18);
        } else {
            stamp.fillStyle(color, alpha);
            stamp.fillCircle(0, 0, r);
        }
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

    /** Live sprite for a chunk corpse entry, if the chunk is loaded. */
    _liveCorpseSprite(chunk, entry) {
        if (!entry) return null;
        const groups = [chunk?.corpses, this.corpses];
        for (const g of groups) {
            const kids = g?.getChildren?.() || [];
            const hit = kids.find((c) => c?.active && c.entry === entry);
            if (hit) return hit;
        }
        if (entry.id && this.netCorpses?.has(entry.id)) return this.netCorpses.get(entry.id);
        return null;
    }

    _convertCorpseToCarcass(chunk, entry, now) {
        const Decay = typeof CorpseDecay !== "undefined" ? CorpseDecay : null;
        if (!Decay || !entry) return;
        const getItem = (id) => this.getItem(id);
        const dump = Decay.lootToDumpOnCarcass(entry.loot, getItem);
        for (const stack of dump) {
            const meta = getItem(stack.id);
            if (!meta) continue;
            const extras = typeof mealStackExtras === "function" ? mealStackExtras(stack) : null;
            const spoilAt = typeof spoilAtForWorld === "function"
                ? spoilAtForWorld(stack, now)
                : stack.spoilAt;
            DroppedItem.spawn(this, entry.x, entry.y, meta, stack.quantity, spoilAt, extras);
        }
        entry.loot = Decay.buildCarcassLoot(entry.mobId, {
            getItem,
            now,
            rng: () => Math.random(),
            makeStack: (item, qty, at) => makeWorldItemStack(item, qty, undefined, at)
        });
        entry.stage = "carcass";
        entry.skinned = true;

        const spr = this._liveCorpseSprite(chunk, entry);
        if (spr) {
            spr.applyStageAppearance?.();
            if (this.player?._skinChannel?.corpse === spr) {
                this.player._cancelSkin?.();
            }
            const panel = this.corpsePanel;
            if (panel?.visible && panel.corpse === spr) {
                panel.syncFromEntry?.();
                panel._showCorpseHealth?.();
            }
        }
        this.refreshTooltip?.();
    }

    _decayRemoveCorpse(chunk, entry) {
        const spr = this._liveCorpseSprite(chunk, entry);
        if (spr?.removeForever) {
            spr.removeForever();
            return;
        }
        const list = chunk?.meta?.corpses;
        if (!Array.isArray(list) || !entry) return;
        const i = list.indexOf(entry);
        if (i >= 0) list.splice(i, 1);
    }

    /**
     * Corpse → carcass after 12h, carcass → gone after 30d.
     * Dedicated MP: server owns this (events + snapshots).
     */
    tickCorpseDecay() {
        if (this.isNet && this.net?.connected && !this.net.isLocal) return;
        const Decay = typeof CorpseDecay !== "undefined" ? CorpseDecay : null;
        if (!Decay) return;
        const now = this.worldMinuteIndex();
        for (const chunk of Object.values(this.chunks || {})) {
            const list = chunk?.meta?.corpses;
            if (!Array.isArray(list) || !list.length) continue;
            for (let i = list.length - 1; i >= 0; i--) {
                const entry = list[i];
                if (!entry) continue;
                Decay.ensureDiedAt(entry, now);
                const next = Decay.stageFor(entry.diedAt, now);
                if (next === "gone") {
                    this._decayRemoveCorpse(chunk, entry);
                    continue;
                }
                if (next === "carcass" && entry.stage !== "carcass") {
                    this._convertCorpseToCarcass(chunk, entry, now);
                }
            }
        }
    }

    tickSpoilage() {
        const now = this.worldMinuteIndex();
        const rot = this.getItem("rot");
        let dirty = false;
        let cookDirty = false;
        let corpsePanelDirty = false;
        const getItem = (id) => this.getItem(id);
        // Dedicated MP: server owns character spoilLeft (YOU). LocalSim / offline tick locally.
        const skipPlayerSpoil = this.isNet && this.net?.connected && !this.net.isLocal;

        const applyWorldStack = (stack) => {
            if (!stack) return stack;
            migrateToSpoilAt(stack, now, getItem);
            const { stack: next, changed } = spoilStackIfDue(stack, now, rot);
            if (changed) dirty = true;
            return next;
        };

        const applyCharacterStack = (stack) => {
            if (!stack) return stack;
            migrateToSpoilLeft(stack, now, getItem);
            tickSpoilLeft(stack);
            const { stack: next, changed } = spoilStackIfDue(stack, now, rot);
            if (changed) dirty = true;
            return next;
        };

        if (!skipPlayerSpoil) {
        const inv = this.player.inventory;
        for (let i = 0; i < inv.length; i++) {
                if (inv[i]) inv[i] = applyCharacterStack(inv[i]);
        }

        const eq = this.player.equipment;
        for (const key of ["head", "torso", "legs", "feet"]) {
                if (eq[key]) eq[key] = applyCharacterStack(eq[key]);
        }
        for (let i = 0; i < eq.waist.length; i++) {
                if (eq.waist[i]) eq.waist[i] = applyCharacterStack(eq.waist[i]);
            }
        }

        const liveDrops = this.droppedItems?.getChildren?.() || [];
        for (const chunk of Object.values(this.chunks || {})) {
            const drops = chunk.meta?.drops;
            if (Array.isArray(drops)) {
                for (const entry of drops) {
                    if (!entry) continue;
                    migrateToSpoilAt(entry, now, getItem);
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
                    delete entry.spoilLeft;
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
                        corpseEntry.loot[i] = applyWorldStack(corpseEntry.loot[i]);
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
                        entry.cook = applyWorldStack(entry.cook);
                        if (entry.cook?.id !== prevId) {
                            entry.cookProgress = 0;
                            cookDirty = true;
                        }
                    }
                    if (entry.catalyst) {
                        const prevId = entry.catalyst.id;
                        entry.catalyst = applyWorldStack(entry.catalyst);
                        if (entry.catalyst?.id !== prevId) cookDirty = true;
                    }
                    if (Array.isArray(entry.simmer)) {
                        for (let i = 0; i < entry.simmer.length; i++) {
                            if (!entry.simmer[i]) continue;
                            const prevId = entry.simmer[i].id;
                            entry.simmer[i] = applyWorldStack(entry.simmer[i]);
                            if (entry.simmer[i]?.id !== prevId) cookDirty = true;
                        }
                    }
                }
            }
        }

        if (corpsePanelDirty) {
            const panel = this.corpsePanel;
            if (panel?.visible && panel.corpse?.entry) {
                panel.syncFromEntry?.();
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
                if (entry) migrateToSpoilAt(entry, now, getItem);
            }
            for (const corpse of chunk.meta?.corpses || []) {
                for (const stack of corpse?.loot || []) {
                    if (stack) migrateToSpoilAt(stack, now, getItem);
                }
            }
            for (const entry of chunk.meta?.things || []) {
                if (!entry) continue;
                if (entry.cook) migrateToSpoilAt(entry.cook, now, getItem);
                if (entry.catalyst) migrateToSpoilAt(entry.catalyst, now, getItem);
                for (const s of entry.simmer || []) {
                    if (s) migrateToSpoilAt(s, now, getItem);
                }
            }
        }
    }

    /** Migrate/ensure spoilLeft on character stacks (after clock is known). */
    ensureSpoilLeft(stacks) {
        if (!stacks) return;
        const now = this.worldMinuteIndex();
        const getItem = (id) => this.getItem(id);
        migrateCharacterStacks(stacks, now, getItem);
        }

    /** @deprecated Use ensureSpoilLeft */
    ensureSpoilAt(stacks) {
        this.ensureSpoilLeft(stacks);
    }

    /** @deprecated */
    ensureSpoilMinutes(stacks) {
        this.ensureSpoilLeft(stacks);
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
        let name = quantity > 1 ? `${displayName} x${quantity}` : displayName;
        const food = stack?.food || item.food;
        let namePct = null;
        if (typeof Durability !== "undefined" && stack) {
            const max = Durability.maxDurability(stack, item);
            if (max > 0) {
                const pct = Math.round(Durability.durabilityFraction(stack, item) * 100);
                if (pct < 100) namePct = pct;
            }
        }
        if (namePct == null && food) {
            const kc = Number(food.kc ?? 0);
            const full = Number(food.kcFull ?? kc);
            if (kc > 0 && full > 0) {
                const pct = Math.round((kc / full) * 100);
                if (pct < 100) namePct = pct;
            }
        }
        if (namePct != null) name = `${name} (${namePct}%)`;
        lines.push(name);

        // Tip / tipped-spear quality on line 2 (knives still bake quality into the name)
        if (
            stack?.knapQuality
            && (stack.toolClass === "spear_tip" || !stack.toolClass)
        ) {
            const q = String(stack.knapQuality);
            lines.push(q.charAt(0).toUpperCase() + q.slice(1));
        }

        // Weight (stack.weight for dynamic meals; knapped tools use item def)
        const knapTool = !!(stack?.toolClass || stack?.knapMaterial);
        const weight = knapTool
            ? (item.weight ?? 0)
            : (stack?.weight != null ? stack.weight : item.weight);
        if (weight > 0) {
            lines.push(`Weight: ${weight} kg`);
        }

        if (item.bandage) {
            const base = Math.round((Number(item.bandage.tendQuality) || 0) * 100);
            lines.push(`Tend quality: ${base}%`);
        }

        // Food (stack.food overrides meta for dynamic meals). 0 kcal = spoils only, not edible.
        if (food) {
            const kc = Math.round(Number(food.kc ?? 0));
            if (kc > 0) {
                lines.push(`Food: ${kc} kcal`);
                const satR = Number(food.satietyRatio ?? item.food?.satietyRatio);
                if (Number.isFinite(satR) && satR >= 0) {
                    const shown = Number.isInteger(satR)
                        ? String(satR)
                        : String(Math.round(satR * 100) / 100);
                    lines.push(`Satiety: ×${shown}`);
                }
            }

            const now = this.worldMinuteIndex?.() ?? null;
            let mins = null;
            if (stack?.spoilLeft != null) {
                mins = Math.max(0, Math.round(stack.spoilLeft));
            } else if (stack?.spoilAt != null && now != null) {
                mins = remainingSpoilMinutes(stack.spoilAt, now);
            } else if (spoilAt != null && now != null) {
                // 3rd arg may be spoilLeft (remaining) or spoilAt (absolute)
                const asRemaining = Math.round(spoilAt);
                const asAbsolute = remainingSpoilMinutes(spoilAt, now);
                // Absolute timestamps are worldMinuteIndex-scale; remaining timers are durations.
                mins = (spoilAt >= now) ? asAbsolute : Math.max(0, asRemaining);
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
        if (!this.craftContainer || !this.craft) return;
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
        // Dedicated MP: server consumes ingredients + grants/drops; YOU/snapshots update UI.
        // Do not mutate locally — that fought deferred YOU sync and spawned ghost ground piles.
        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.CRAFT,
                id: recipe.id
            });
            return;
        }
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

        // NOTE: must not use this.save / this.load — those clobber Phaser scene plugins
        // (LoaderPlugin is this.load). Overwriting them breaks SceneMain.preload on rejoin.
        this._savePressed = false;
        this.saveBtn = this.add.image(this.scale.width - 80 * s, 32 * s, 'save');
        this.saveBtn.setInteractive({ useHandCursor: true, pixelPerfect: true });
        this.saveBtn.on('pointerdown', () => {
            this._savePressed = true;
            this.saveBtn.setTexture('save_open');
            this.saveFile();
            // Download can swallow Phaser pointerup; keep open briefly for press feedback
            this.time.delayedCall(150, () => {
                this._releasePressButton('_savePressed', this.saveBtn, 'save');
            });
        });
        this.saveBtn.on('pointerover', (p) => {
            if (!this._savePressed) this.saveBtn.setTexture('save_hover');
            this.showTooltip('Save', p.x, p.y, this.saveBtn);
        });
        this.saveBtn.on('pointerout', () => {
            if (!this._savePressed) this.saveBtn.setTexture('save');
            if (this._tooltipTarget === this.saveBtn) this.hideTooltip();
        });
        this.saveBtn.setOrigin(0.5, 0.5).setScale(3 * s);
        this.uiLayer.add(this.saveBtn);

        this._loadPressed = false;
        this.loadBtn = this.add.image(this.scale.width - 32 * s, 32 * s, 'load');
        this.loadBtn.setInteractive({ useHandCursor: true, pixelPerfect: true });
        this.loadBtn.on('pointerdown', () => {
            this._loadPressed = true;
            this.loadBtn.setTexture('load_open');
            // File dialog can swallow Phaser pointerup; release when dialog settles
            this.loadFile().finally(() => this._releasePressButton('_loadPressed', this.loadBtn, 'load'));
        });
        this.loadBtn.on('pointerover', (p) => {
            if (!this._loadPressed) this.loadBtn.setTexture('load_hover');
            this.showTooltip('Load', p.x, p.y, this.loadBtn);
        });
        this.loadBtn.on('pointerout', () => {
            if (!this._loadPressed) this.loadBtn.setTexture('load');
            if (this._tooltipTarget === this.loadBtn) this.hideTooltip();
        });
        this.loadBtn.setOrigin(0.5, 0.5).setScale(3 * s);
        this.uiLayer.add(this.loadBtn);

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
            this.help.setTexture('help_open');
        });
        this.help.setOrigin(0.5, 0.5).setScale(3 * s);
        this.uiLayer.add(this.help);

        this.input.on('pointerup', () => {
            this._releasePressButton('_savePressed', this.saveBtn, 'save');
            this._releasePressButton('_loadPressed', this.loadBtn, 'load');
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
            color: "#ff6666",
            align: "center"
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
        this._pendingDeathText = null;
    }

    _formatPlayerDeathMessage(killer) {
        const victim = this.playerName || this.player?.displayName?.() || "Player";
        let killerName = null;
        if (typeof killer === "string") killerName = killer;
        else if (killer) {
            killerName = killer.displayName?.() || killer.def?.name || killer.name || null;
        }
        return NetProtocol.deathMessage(victim, killerName);
    }

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
    }

    _applyDeathMessage(msg) {
        const text = String(msg || "").replace(/\.+$/, "") || this._formatPlayerDeathMessage();
        this._deathMessage = text;
        if (this.deathTitle) this.deathTitle.setText(this._deathOverlayText(text));
        this.layoutDeathOverlay();
    }

    onPlayerDied(killer, opts = {}) {
        this._deathPos = { x: this.player.x, y: this.player.y };
        this.player._tendChannel = null;
        this.player._skinChannel = null;
        this.player._eatChannel = null;
        this.hideChannelBar?.();
        this.corpsePanel?.close?.(true);
        const dedicated = !!(this.isNet && this.net?.connected && !this.net.isLocal);
        const spawnCorpse = opts.spawnCorpse !== false;
        // Dedicated: spawn a pending local corpse with a shared id so you can
        // see/loot it immediately; server adopts that id on DIE.
        const deathCorpse = spawnCorpse
            ? this.player.createDeathCorpse({ spawn: true })
            : this.player.createDeathCorpse({ spawn: false });
        if (dedicated && deathCorpse?.entry) {
            deathCorpse.entry.netSync = true;
            deathCorpse.entry.pendingServer = true;
            deathCorpse.entry.pendingAt = performance.now();
            if (!this.netCorpses) this.netCorpses = new Map();
            this.netCorpses.set(deathCorpse.entry.id, deathCorpse);
        }
        this.player.setVisible(false);
        if (this.player.body) this.player.body.enable = false;
        this.player.setVelocity(0, 0);
        // Keep character autosave + server session aligned with emptied gear
        if (this._lastYou) {
            this._lastYou = {
                ...this._lastYou,
                inventory: this.player.inventory,
                equipment: this.player.equipment,
                dead: true
            };
        }
        if (this.isNet && this.net?.connected) {
            if (this.net.isLocal) {
                this.net.syncPawnFromClient?.(this._playerCharacterPartial());
            } else if (spawnCorpse) {
                this.net.sendAction({
                    type: NetProtocol.Actions.DIE,
                    corpseId: deathCorpse?.entry?.id || null,
                    x: deathCorpse?.x,
                    y: deathCorpse?.y
                });
            }
        }
        const msg = (dedicated && this._pendingDeathText)
            ? this._pendingDeathText
            : this._formatPlayerDeathMessage(killer);
        this._pendingDeathText = null;
        this._applyDeathMessage(msg);
        if (!dedicated) this.combatLog?.push(msg);
        this.deathOverlay?.setVisible(true);
        this.layoutDeathOverlay();
    }

    layoutDeathOverlay() {
        if (!this.deathOverlay) return;
        const s = this.uiScale || 1;
        this.deathOverlay.setPosition(this.scale.width / 2, this.scale.height / 2);
        this.deathTitle.setFontSize(Math.round(36 * s));
        this.deathTitle.setWordWrapWidth(Math.round(380 * s));
        this.deathTitle.setAlign("center");
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
     * Use round (not floor) so +X/+Y and -X/-Y feel the same speed.
     * Camera targets the sprite center (not feet / origin 0,1).
     */
    syncCameraToPlayer() {
        const player = this.player;
        const cam = this.cameras?.main;
        if (!player?.active || !cam) return;
        const z = this.worldZoom || cam.zoom || 1;
        player._physX = player.x;
        player._physY = player.y;
        const x = Math.round(player.x * z) / z;
        const y = Math.round(player.y * z) / z;
        if (player.x !== x || player.y !== y) {
            player.setPosition(x, y);
        }
        const c = typeof player.bodyCenter === "function"
            ? player.bodyCenter()
            : { x, y };
        cam.centerOn(
            Math.round(c.x * z) / z,
            Math.round(c.y * z) / z
        );
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
        this._pendingDeathText = null;
        this.deathOverlay?.setVisible(false);
        this.closeOpenMenus();
        this.syncCameraToPlayer();
        this.healthPanel?.refresh?.();
        if (this.isNet && this.net?.connected) {
            if (!this.net.isLocal) {
                this.net.sendAction({ type: NetProtocol.Actions.RESPAWN });
                this._netAwaitPoseFromYou = !here;
            } else {
                this.net.syncPawnFromClient?.(this._playerCharacterPartial());
            }
            this._netSendMove(true);
        }
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

    _anyGameplayMenuOpen() {
        return !!(
            this.craftMenuVisible ||
            this.equipmentPanel?.visible ||
            this.healthPanel?.visible ||
            this.corpsePanel?.visible ||
            this.campfirePanel?.visible
        );
    }

    _isSingleplayerSession() {
        return !!(this.net?.isLocal || this.localWorldId);
    }

    _pauseMenuButton(x, y, label, onClick) {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const text = this.add.text(0, 0, label, {
            fontFamily: "PrimaryFont",
            fontSize: "18px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        // Fixed size so label updates don't rebuild the hit area / wipe listeners
        const bw = 260;
        const bh = 44;
        const rect = this.add.rectangle(0, 0, bw, bh, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });
        const root = this.add.container(x, y, [rect, text]);
        root.setLabel = (next) => {
            text.setText(String(next));
        };
        let hovering = false;
        let pressing = false;
        const paint = () => {
            if (pressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(2, OUTLINE_PRESS);
            } else if (hovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(2, OUTLINE_HOVER);
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(2, OUTLINE);
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
    }

    _loadGuiScalePref() {
        try {
            const n = Number(localStorage.getItem("cp_gui_scale"));
            if (Number.isFinite(n) && n >= 0) return Math.floor(n);
        } catch (_) {}
        return 0;
    }

    _saveGuiScalePref(pref) {
        try {
            localStorage.setItem("cp_gui_scale", String(pref));
        } catch (_) {}
    }

    /**
     * Largest integer GUI scale that fits this window.
     * 480×360 reference so 1080p reaches 3 (not 1080/768 ≈ 1.4).
     */
    _guiScaleFit() {
        const w = this.scale?.width || window.innerWidth || 1024;
        const h = this.scale?.height || window.innerHeight || 768;
        return Math.min(w / 480, h / 360);
    }

    /** Highest fixed integer GUI scale for this window. */
    getMaxGuiScaleOption() {
        return Math.max(1, Math.floor(this._guiScaleFit()));
    }

    _autoUiScale() {
        return this.getMaxGuiScaleOption();
    }

    _guiScaleButtonLabel() {
        const pref = this.guiScalePref | 0;
        return pref === 0 ? "GUI Scale: Auto" : `GUI Scale: ${pref}`;
    }

    _cycleGuiScale() {
        const max = this.getMaxGuiScaleOption();
        let cur = this.guiScalePref | 0;
        if (cur < 0 || cur > max) cur = 0;
        let next = cur + 1;
        if (next > max) next = 0;
        this.guiScalePref = next;
        this._saveGuiScalePref(next);
        this.updateUiScale();
        this.applyUiScale();
        // Label after apply — applyUiScale → _layoutPauseMenu may also refresh it
        this._pauseUi?.guiScale?.setLabel?.(this._guiScaleButtonLabel());
    }

    _openPauseMenu() {
        if (this._gamePaused || this._leavingGame) return;
        this.closeOpenMenus();
        if (this.knappingPanel?.visible) this.knappingPanel.finishOrClose?.();

        this._gamePaused = true;
        if (this._isSingleplayerSession()) {
            this.net?.setPaused?.(true);
            this.physics?.world?.pause?.();
        }

        const w = this.scale.width;
        const h = this.scale.height;
        const dim = this.add.rectangle(w / 2, h / 2, w + 4, h + 4, 0x000000, 0.55)
            .setInteractive();
        const title = this.add.text(w / 2, h * 0.36,
            this._isSingleplayerSession() ? "Paused" : "Menu", {
                fontFamily: "PrimaryFont",
                fontSize: "32px",
                color: "#e8dcc8"
            }).setOrigin(0.5);
        const quitLabel = this._isSingleplayerSession() ? "Save and Quit" : "Leave Game";
        const y0 = h * 0.46;
        const gap = 52;
        const resume = this._pauseMenuButton(w / 2, y0, "Resume", () => this._closePauseMenu());
        const guiScale = this._pauseMenuButton(
            w / 2,
            y0 + gap,
            this._guiScaleButtonLabel(),
            () => this._cycleGuiScale()
        );
        const quit = this._pauseMenuButton(w / 2, y0 + gap * 2, quitLabel, () => this._leaveGame());

        this.uiLayer.add(dim);
        this.uiLayer.add(title);
        this.uiLayer.add(resume);
        this.uiLayer.add(guiScale);
        this.uiLayer.add(quit);
        this.uiLayer.bringToTop(dim);
        this.uiLayer.bringToTop(title);
        this.uiLayer.bringToTop(resume);
        this.uiLayer.bringToTop(guiScale);
        this.uiLayer.bringToTop(quit);

        this._pauseUi = { dim, title, resume, guiScale, quit };
    }

    _closePauseMenu() {
        if (!this._gamePaused) return;
        this._gamePaused = false;
        if (this._isSingleplayerSession()) {
            this.net?.setPaused?.(false);
            this.physics?.world?.resume?.();
        }
        const ui = this._pauseUi;
        this._pauseUi = null;
        if (ui) {
            for (const n of Object.values(ui)) {
                try { n.destroy?.(true); } catch (_) {}
            }
        }
    }

    _layoutPauseMenu() {
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
        const { dim, title, resume, guiScale, quit } = this._pauseUi;
        const y0 = h * 0.46;
        const gap = 52;
        dim.setPosition(w / 2, h / 2).setSize(w + 4, h + 4);
        title.setPosition(w / 2, h * 0.36);
        resume?.setPosition(w / 2, y0);
        guiScale?.setPosition(w / 2, y0 + gap);
        guiScale?.setLabel?.(this._guiScaleButtonLabel());
        quit?.setPosition(w / 2, y0 + gap * 2);
    }

    /** Full menu-colored screen while quit saves finish — blocks quick rejoin races. */
    _showSavingScreen() {
        if (this._pauseUi) {
            for (const n of Object.values(this._pauseUi)) {
                try { n.destroy?.(true); } catch (_) {}
            }
            this._pauseUi = null;
        }
        this._gamePaused = true;
        if (this._isSingleplayerSession()) {
            try { this.net?.setPaused?.(true); } catch (_) {}
            try { this.physics?.world?.pause?.(); } catch (_) {}
        }
        try { this.cameras?.main?.setBackgroundColor?.("#1a1510"); } catch (_) {}

        const w = this.scale.width;
        const h = this.scale.height;
        const bg = this.add.rectangle(w / 2, h / 2, w + 4, h + 4, 0x1a1510, 1)
            .setInteractive();
        const text = this.add.text(w / 2, h / 2, "Saving...", {
            fontFamily: "monospace",
            fontSize: "28px",
            color: "#e8dcc8"
        }).setOrigin(0.5);
        this.uiLayer.add(bg);
        this.uiLayer.add(text);
        this.uiLayer.bringToTop(bg);
        this.uiLayer.bringToTop(text);
        this._savingUi = { bg, text };
    }

    async _leaveGame() {
        if (this._leavingGame) return;
        this._leavingGame = true;
        this._netLeaving = true;
        this._teardownCharacterAutosave();
        this.closeOpenMenus();
        this._showSavingScreen();

        try {
            await this._saveCharacterNow();
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
            this.scene.start("SceneMenu");
        }
    }

    _handleEscapeKey() {
        if (this._leavingGame) return;
        if (!Phaser.Input.Keyboard.JustDown(this.keyEsc)) return;
        if (this.combatLog?.composing) return; // CombatLog closes chat
        if (this.knappingPanel?.visible) return; // KnappingPanel closes itself
        if (this._gamePaused) {
            this._closePauseMenu();
            return;
        }
        if (this._anyGameplayMenuOpen()) {
            this.closeOpenMenus();
            return;
        }
        this._openPauseMenu();
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
        // Dedicated: apply any YOU gear that arrived while craft UI was open
        this._flushPendingYouGear?.();
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
        // Prefetch / keep generated beyond the visible ring
        this.cullDistance = this.renderDistance + 2;
        this.genDistance = this.cullDistance;
    }

    updateUiScale() {
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
            this.saveBtn?.setScale(3 * s).setPosition(this.scale.width - 80 * s, 32 * s);
            this.loadBtn?.setScale(3 * s).setPosition(this.scale.width - 32 * s, 32 * s);
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
        this._layoutPauseMenu();

        this.player?.applyChatBubbleScale?.();
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

                        // Clock before spoil migration
                        this.gameDay = data.clock?.day ?? 1;
                        this.gameMinutes = data.clock?.minutes ?? 8 * 60;
                        this.updateClockText();
                        this.markLightDirty();
                        this.updateLightVeil();

                        this.ensureSpoilLeft(this.player.inventory);
                        this.ensureSpoilLeft([
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

        this._handleEscapeKey();
        if (this._leavingGame) {
            this.combatLog?.update?.();
            return;
        }
        // SP pause freezes the sim; dedicated MP menu must keep receiving world updates
        if (this._gamePaused && this._isSingleplayerSession()) {
            this.combatLog?.update?.();
            return;
        }

        // Calculate player chunk
        let snappedChunkX = Math.round(this.player.posX() / this.chunkSize);
        let snappedChunkY = Math.round(this.player.posY() / this.chunkSize);

        // Prefetch chunks beyond the viewport so generation finishes before you see the edge
        const genR = this.genDistance || this.cullDistance || this.renderDistance;
        for (let x = snappedChunkX - genR; x <= snappedChunkX + genR; x++) {
            for (let y = snappedChunkY - genR; y <= snappedChunkY + genR; y++) {
                const key = this.getKey(x, y);
                if (!this.chunks[key]) {
                    // Multiplayer: only accept server CHUNK payloads (avoids Thing desync)
                    if (this.isNet) continue;
                    this.chunks[key] = new Chunk(this, x, y);
                }
            }
        }

        // Load/unload chunks (iterate known chunks so a shrink on resize unloads correctly)
        let startedLoads = 0;
        for (const chunk of Object.values(this.chunks)) {
            const dist = Phaser.Math.Distance.Between(
                snappedChunkX,
                snappedChunkY,
                chunk.x,
                chunk.y
            );
            if (dist <= genR) {
                if (!chunk.isLoaded) {
                    if (startedLoads >= 1) continue;
                    startedLoads++;
                }
                chunk.load();
            } else {
                chunk.unload();
            }
        }

        if (!this._spawnSignPlaced || !this._playerSpawnPlaced) this.ensureSpawnSign();

        // Process input (menus / hotbar / chat blocked while knapping — R/Esc stay in panel)
        const chatting = !!this.combatLog?.isComposing?.();
        const knapping = !!this.knappingPanel?.visible;
        if (!chatting && !knapping && !this._gamePaused) {
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
        }

        // Update player
        this.knappingPanel?.update?.();
        this.player.update(time, delta);
        if (this.isNet) {
            this._netSendMove();
            this._netUpdateRemotes(delta);
            this._netUpdateMobs(delta);
        }
        this.combatLog?.update?.();
        this.updateFpsMeter?.(delta);
        this.updateLocationDebug?.();
        // In case a YOU arrived while knapping/craft was open and close missed a flush
        this._flushPendingYouGear?.();

        // Update living mobs (slice: AI may destroy self on chunk boundary)
        // Dedicated MP: wildlife is server-owned; LivingMobs only for LocalSim / offline.
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