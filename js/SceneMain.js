class SceneMain extends SceneBase {
    constructor() {
        super({ key: "SceneMain" });
    }

    init(data = {}) {
        this._unbindSceneListeners();
        this._playReady = false;
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
        this._onNetClose = null;
        this._charSaveTimer = null;
        this._charSaveBusy = false;
        this._charSavePromise = null;
        this._charSaveSoon = false;
        this._charSaveSoonEvent = null;
        this._charSaveFrozen = false;
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
        this.storagePanel = null;
        this.corpsePanel = null;
        this.healthPanel = null;
        this.knappingPanel = null;
        this.deathOverlay = null;
        this.player = null;
        this.leader = null;
        this.party = [];
        this.partySys = null;
        this.partyPanel = null;
        this.chunks = null;
        this.droppedItems = null;
        this.corpses = null;
        this.netCorpses = new Map();
        this.cursors = null;
        this.keys = null;
        this.key1 = this.key2 = this.key3 = this.key4 = this.key5 = null;
        this.key6 = this.key7 = this.key8 = this.key9 = this.key0 = null;
        this.keyC = this.keyE = this.keyH = this.keyT = this.keyR = this.keyEsc = null;
        this.tooltip = null;
        this.tooltipText = null;
        this.painBar = this.kcBar = this.weightBar = this.barIcons = null;
        this.channelBar = this.treeChopBar = null;
        this.craft = this.healthBtn = this.equipmentBtn = this.help = null;
        this.fpsText = this.locXText = this.locYText = null;
        this._waterSprite = null;
        this.groundLayer = this.mainLayer = this.uiLayer = this.worldHudLayer = null;
        this._hoverTarget = null;
        this._tooltipTarget = null;
        this._things = null;
        this.mobs = null;
        this.damageables = null;
        this._chunkRtPool = null;
        this._chunkPaintQ = null;
        this._paintBusy = false;
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
        // Above the night veil (lightGfx depth 50). UI cam ignores this layer so
        // world-locked HUD is not also drawn unzoomed at raw world coordinates.
        this.worldHudLayer = this.add.layer().setDepth(51);

        // Chunks
        this.chunkSize = 8;
        this.tileSize = 16;
        this.worldZoom = 3;
        this.chunks = {};
        this._loadedChunks = [];
        this._thingCells = this._thingCells || new Map();
        this._chunkRtPool = [];
        this._chunkPaintQ = [];
        this._paintBusy = false;
        this.chunkDebug = false;
        this.updateChunkDistances();
        this.updateUiScale();
        this._onGameResize = () => {
            if (!this._playReady || this._leavingGame) return;
            this.updateChunkDistances();
            this.updateUiScale();
            this.applyUiScale();
            this.hideTooltip?.();
            this.positionCraftMenu?.();
        };
        this.scale.on("resize", this._onGameResize);

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

        // Shared body defs must see Phaser JSON cache before Body() runs.
        // (Phaser.Scene.data is a DataManager — do not confuse with DataStore.)
        if (typeof DataStore !== "undefined") {
            DataStore.initFromPhaserScene(this);
        }
        if (typeof Structures !== "undefined") {
            Structures.loadConfig(this.cache.json.get("structures"));
        }

        // Player
        this.partySys = new PartySystem(this);
        this.partySys.bindSceneKeys();
        this.player = new Player(this, 0, 0, this.character?.look);
        this.partySys.attachLeader(this.player);
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
        this._baseTickSpeed = 1;
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
        this._thingCells = new Map();
        this.physics.add.collider(
            this.player,
            this._things,
            null,
            (a, b) => (typeof Sleep === "undefined" || !Sleep.collideProcess) ? true : Sleep.collideProcess(a, b)
        );
        // Overlap only — collider was body-checking / shoving the player during melee
        this.physics.add.overlap(this.player, this.mobs);
        this.physics.add.collider(this.mobs, this._things);
        this.droppedItems = this.add.group();
        this.corpses = this.add.group();

        // UI
        this.cameras.main.ignore(this.uiLayer);
        // No roundPixels on UI — overlays pinned to world sprites are pre-rounded to match
        // the main camera's setQuad snap; a second pass makes chat bubbles crawl while moving.
        this._uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height)
            .setScroll(0, 0)
            .setZoom(1)
            .setRoundPixels(false);
        let cameras = [this.groundLayer, this.mainLayer, this.worldHudLayer];
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
        this.leanToPanel = new LeanToPanel(this);
        this.storagePanel = new StoragePanel(this);
        this.corpsePanel = new CorpsePanel(this);
        this.healthPanel = new HealthPanel(this);
        this.knappingPanel = new KnappingPanel(this);
        this.createDeathOverlay();
        this.partyPanel = new PartyPanel(this);
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
        this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
        this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        this.placeRot = 0;
        /** Display name (chat / MP) */
        this.playerName = this.displayName
            || this.welcome?.you?.name
            || localStorage.getItem("cp_display_name")
            || "Player";

        if (this.isNet) this._setupNetPlay();
        this._playReady = true;
    }

    /** Session play (WebSocket MP or LocalSim SP): sync via protocol, character owned client-side. */
    _setupNetPlay() {
        this._netPlayerId = this.welcome?.playerId || this.net?.playerId || this.characterId || this._netPlayerId;
        const you = this.welcome?.you || {};
        if (typeof you.x === "number" && typeof you.y === "number") {
            this.player.teleport(you.x, you.y);
            this.syncCameraToPlayer();
        }
        this._netWandererGraceUntil = performance.now() + 3000;
        if (this.welcome?.wanderers) this._netApplyWanderers(this.welcome.wanderers);
        // First SP entry into a world: let ensureSpawnSign run pickRandomSpawnTile (same as respawn).
        // Dedicated MP / rejoin already have an authoritative pose on YOU.
        this._playerSpawnPlaced = !this.welcome?.firstSpawn;
        this.player.createAnimations?.();
        // Apply join snapshot once (including SP gear); later LocalSim YOU won't stomp inventory
        this._netForceYouInv = true;
        if (you.inventory || you.kc != null || you.equipment) this._netApplyYou(you);
        this._netForceYouInv = false;
        this.partySys?.applyJoinParty?.(you, this.character, { join: true });
        this._restorePartySleep?.();

        this.net.clearHandlers?.();
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
        if (this._onNetClose) this.net.off("close", this._onNetClose);
        this._onNetClose = () => this._netOnDisconnect();
        this.net.on("close", this._onNetClose);

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
        const pl = this.leader || this.player;
        if (!pl) return null;
        const extra = this.partySys?.serializeParty?.() || {};
        return {
            name: this.playerName || pl.pawnName || pl.name,
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
            y: pl.y,
            controlId: extra.controlId || this.player?.pawnId,
            leaderDead: !!extra.leaderDead,
            party: extra.party || [],
            lastSleep: pl.lastSleep || null,
            resting: !!pl._resting
        };
    }

    _scheduleCharacterSave(you) {
        if (you) this._lastYou = you;
        // Debounce burst YOU updates
        if (this._charSaveSoon || this._charSaveFrozen || this._leavingGame) return;
        this._charSaveSoon = true;
        this._charSaveSoonEvent = this.time?.delayedCall?.(400, () => {
            this._charSaveSoon = false;
            this._charSaveSoonEvent = null;
            if (this._charSaveFrozen || this._leavingGame) return;
            this._saveCharacterNow();
        });
    }

    _cloneSaveStack(s) {
        if (!s) return null;
        if (typeof cloneItemStack === "function") return cloneItemStack(s);
        try {
            return JSON.parse(JSON.stringify(s));
        } catch (_) {
            return { id: s.id, quantity: s.quantity || 1 };
        }
    }

    /** Live gear snapshot for IndexedDB — what is on the hotbar, not a stale YOU. */
    _characterSavePartial() {
        this._flushPendingYouGear?.();
        const raw = this._playerCharacterPartial();
        if (!raw) return null;
        const eq = raw.equipment;
        const cloneEq = (equipment) => {
            if (!equipment || typeof equipment !== "object") return equipment;
            return {
                head: this._cloneSaveStack(equipment.head),
                torso: this._cloneSaveStack(equipment.torso),
                legs: this._cloneSaveStack(equipment.legs),
                feet: this._cloneSaveStack(equipment.feet),
                waist: Array.isArray(equipment.waist)
                    ? equipment.waist.map((s) => this._cloneSaveStack(s))
                    : []
            };
        };
        const cloneParty = (members) => {
            if (!Array.isArray(members)) return members;
            return members.map((m) => ({
                id: m.id,
                name: m.name,
                look: m.look,
                kc: m.kc,
                saturation: m.saturation,
                stomach: m.stomach,
                inventory: Array.isArray(m.inventory)
                    ? m.inventory.map((s) => this._cloneSaveStack(s))
                    : m.inventory,
                equipment: cloneEq(m.equipment),
                hotbarIndex: m.hotbarIndex,
                body: m.body,
                hp: m.hp,
                mhp: m.mhp,
                facing: m.facing,
                x: m.x,
                y: m.y,
                lastSleep: m.lastSleep || null,
                resting: !!m.resting
            }));
        };
        return {
            ...raw,
            inventory: Array.isArray(raw.inventory)
                ? raw.inventory.map((s) => this._cloneSaveStack(s))
                : raw.inventory,
            equipment: cloneEq(eq),
            party: cloneParty(raw.party)
        };
    }

    _inventoryFilledCount(inv) {
        return Array.isArray(inv) ? inv.filter(Boolean).length : -1;
    }

    async _saveCharacterNow(youOverride = null, opts = {}) {
        if (!this.characterId || typeof CharacterStore === "undefined") return;
        if (this._charSaveFrozen) return;
        if (this._leavingGame && !opts.final) return;
        // Wait for any in-flight save so leave/quit never skips a write.
        while (this._charSavePromise) {
            await this._charSavePromise;
            if (this._charSaveFrozen) return;
            if (this._leavingGame && !opts.final) return;
        }
        this._charSaveBusy = true;
        this._charSavePromise = (async () => {
            try {
                const live = this._characterSavePartial();
                // SP: client inventory is authoritative — push into LocalSim pawn first
                if (this.net?.isLocal && live) this.net.syncPawnFromClient?.(live);
                let base = this.character;
                if (!base) base = await CharacterStore.get(this.characterId);
                if (!base) {
                    base = CharacterStore.defaultCharacter(this.playerName || "Player");
                    base.id = this.characterId;
                }
                const you = youOverride || this._lastYou;
                const pawn = this.leader || this.player;
                const pawnHere = !!(pawn && pawn.scene === this);
                const liveCount = this._inventoryFilledCount(live?.inventory);
                const youCount = this._inventoryFilledCount(you?.inventory);
                // Prefer the hotbar on screen. `_lastYou` is often a stale pawn/YOU
                // from join or hotbar-select and used to revert /give and pickups.
                const useLive = !!(live && Array.isArray(live.inventory)
                    && (pawnHere || liveCount >= youCount));
                const payload = useLive ? live : you;
                const next = payload ? CharacterStore.applyYou(base, payload) : base;
                this.character = await CharacterStore.put(next);
                if (useLive) this._lastYou = { ...(this._lastYou || {}), ...live };
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
        if (this._netLeaving || this._netDisconnectHandled || this._leavingGame) return;
        this._netDisconnectHandled = true;
        this._netDisconnectReason = null;
        const disconnected = !this._isSingleplayerSession();
        // Save before menu (SESSION_END may already have written; this covers abrupt close)
        Promise.resolve(this._saveCharacterNow()).finally(() => {
            // Leave already owns the menu transition — don't overwrite it with Disconnected.
            if (this._leavingGame || this._netLeaving) return;
            this._netKickToMenu(disconnected ? { disconnected: true } : {});
        });
    }

    _unbindNetClose() {
        if (this.net && this._onNetClose) {
            try { this.net.off("close", this._onNetClose); } catch (_) {}
        }
        this._onNetClose = null;
    }

    _netKickToMenu(data = {}) {
        if (this._netLeaving || this._leavingGame) return;
        this._netLeaving = true;
        this._unbindNetClose();
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
        if (this._charSaveSoonEvent) {
            this._charSaveSoonEvent.remove?.(false);
            this._charSaveSoonEvent = null;
        }
        this._charSaveSoon = false;
        if (this._onVisSave) {
            document.removeEventListener("visibilitychange", this._onVisSave);
            this._onVisSave = null;
        }
    }

    _netApplyYou(you) {
        if (!you || !this.isNet || !this.player) return;
        const youPawn = (this.party || []).find((p) => p.pawnId === you.id)
            || this.leader
            || this.player;
        const hud = youPawn === this.player;
        // LocalSim SP: after join, inventory is client-authored — don't stomp with pawn YOU
        // (vitals still apply; hunger is owned by LocalSim's clock).
        // Dedicated MP: while dead, client already dumped gear into a corpse — never
        // re-apply stale server inventory (that was the /kms dupe).
        const applyGear = (!this.net?.isLocal || this._netForceYouInv) && !youPawn._bodyDead;
        if (youPawn._bodyDead) {
            this._lastYou = {
                ...you,
                inventory: youPawn.inventory,
                equipment: youPawn.equipment,
                dead: true
            };
        } else {
            this._lastYou = you;
        }
        // Dedicated: honor server death (anatomy / PvP) for the crowned leader
        if (
            you.dead
            && !youPawn._bodyDead
            && this.net?.connected
            && !this.net.isLocal
            && !this.deathOverlay?.visible
        ) {
            youPawn._bodyDead = true;
            youPawn.setVelocity(0, 0);
            // Server already authored the corpse — don't dump a second empty one.
            this.onPlayerDied(null, { spawnCorpse: false });
            return;
        }
        if (this._netAwaitPoseFromYou && typeof you.x === "number" && typeof you.y === "number") {
            youPawn.teleport(you.x, you.y);
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
            this._pendingYouTarget = youPawn;
            this._pendingYouGear = {
                inventory: Array.isArray(you.inventory) ? you.inventory : null,
                equipment: you.equipment || null,
                hotbarIndex: you.hotbarIndex
            };
            this._flushPendingYouGear();
        }
        if (typeof you.kc === "number") youPawn.kc = you.kc;
        if (typeof you.saturation === "number") youPawn.saturation = you.saturation;
        if (typeof you.stomach === "number") youPawn.stomach = you.stomach;
        if (hud && you.eatChannel && typeof you.eatChannel.progress === "number"
            && this.net?.connected && !this.net.isLocal
            && youPawn._eatChannel) {
            // Only while local eat channel is active — ignore stale YOU after cancel
            this.showChannelBar?.(Phaser.Math.Clamp(you.eatChannel.progress, 0, 1));
        } else if (
            hud
            && this.net?.connected && !this.net.isLocal
            && !you.eatChannel
            && !youPawn._eatChannel
            && !youPawn._tendChannel
            && !youPawn._skinChannel
        ) {
            this.hideChannelBar?.();
        }
        if (applyGear && you.body && youPawn.anatomy?.loadJSON) {
            try {
                youPawn.anatomy.loadJSON(you.body);
                youPawn.capacities = new Capacities(youPawn.anatomy);
                youPawn._refreshDownedState?.();
            } catch (_) {}
        }
        this._netApplyYouVomit(you, youPawn);
        // Dedicated: server rest is per-world. Character `resting` is global, so
        // YOU.resting=false must stand you up when this world has no bed.
        if (youPawn && typeof you.resting === "boolean") {
            if (you.resting) {
                youPawn._resting = true;
                if (you.lastSleep) youPawn.lastSleep = you.lastSleep;
                if (typeof pinRestingCreature === "function") pinRestingCreature(youPawn, this);
                else setCreatureRest?.(youPawn, true, you.lastSleep?.rot ?? you.restRot);
            } else if (youPawn._resting) {
                setCreatureRest?.(youPawn, false);
                youPawn._resting = false;
            }
        } else if (youPawn && typeof you.prone === "boolean" && !youPawn._resting) {
            setCreatureProne(
                youPawn,
                !!you.prone && !youPawn._bodyDead && !you.dead
            );
        }
        if (you.party || you.controlId) {
            this.partySys?.applyJoinParty?.(you, this.character);
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
        const target = this._pendingYouTarget || this.leader || this.player;
        if (!pending || !target || target._bodyDead) return;
        // LocalSim: inventory is client-authored after join
        if (this.net?.isLocal && !this._netForceYouInv) return;
        if (target === this.player && this._inventoryUiOwnsGear()) return;
        // Keep the latest YOU stashed during an optimistic hotbar/equip edit so a
        // stale packet cannot snap icons back. Update flushes once the guard ends.
        if (
            target === this.player
            && this.net?.connected
            && !this.net.isLocal
            && performance.now() < (this._invSwapGuardUntil || 0)
        ) {
            return;
        }

        const cloneStack = (s) => {
            if (!s) return null;
            if (typeof cloneItemStack === "function") return cloneItemStack(s);
            try {
                return JSON.parse(JSON.stringify(s));
            } catch (_) {
                return { ...s };
            }
        };

        // Equipment first so pouch/hotbar grants resize inventorySize before
        // we slice the incoming hotbar (gifted pouches used to stay visually
        // equipped with no extra slots until unequip/re-equip).
        if (pending.equipment && target.equipment) {
            const eq = pending.equipment;
            target.equipment = {
                head: cloneStack(eq.head),
                torso: cloneStack(eq.torso),
                legs: cloneStack(eq.legs),
                feet: cloneStack(eq.feet),
                waist: Array.isArray(eq.waist) ? eq.waist.map(cloneStack) : []
            };
            target.syncWaistSlots?.();
            target.recomputeEquipmentEffects?.();
            if (target === this.player && this.equipmentPanel?.visible) {
                this.equipmentPanel.refresh();
                this.equipmentPanel.layout();
            }
        }

        if (Array.isArray(pending.inventory)) {
            const size = target.inventorySize || 5;
            const inv = pending.inventory.slice(0, size).map(cloneStack);
            while (inv.length < size) inv.push(null);
            target.inventory = inv;
            if (typeof pending.hotbarIndex === "number") {
                const hi = Math.max(0, Math.min(
                    (this.hotbar?.size || target.inventorySize || 5) - 1,
                    Math.floor(pending.hotbarIndex)
                ));
                target.hotbarIndex = hi;
                if (target === this.player) {
                    this.hotbar?.setActiveIndex?.(hi, { notifyNet: false });
                }
            }
            if (target === this.player && this.hotbar) {
                this.hotbar.setSize?.(target.inventorySize || size);
                this.hotbar.dirty = true;
                // layout() resyncs icon positions + textures (update alone can miss when
                // called from a net handler while the campfire world UI is open)
                this.hotbar.layout?.();
                this.hotbar.dirty = false;
            }
        }

        this._pendingYouGear = null;
        this._pendingYouTarget = null;
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
                corpses: meta.corpses || [],
                wanderers: meta.wanderers || []
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
            corpses: meta.corpses || [],
            wanderers: meta.wanderers || []
        });
        chunk.isGenerated = !!(meta.tiles && meta.tiles.some((t) => !!t));
        this.chunks[key] = chunk;
    }

    _netRemoteKey(playerId, pawnId = null) {
        if (pawnId && playerId && pawnId !== playerId) return `${playerId}:${pawnId}`;
        return playerId;
    }

    _netRemoveRemotesForOwner(ownerId) {
        if (!ownerId || !this.remotePlayers) return;
        for (const [id, entry] of [...this.remotePlayers]) {
            if (id === ownerId || entry.ownerId === ownerId) {
                if (typeof clearSleepFx === "function") clearSleepFx(entry);
                else if (typeof clearSleepZzz === "function") clearSleepZzz(entry);
                this._netDestroyRemote(entry);
                this.remotePlayers.delete(id);
            }
        }
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

        const nameFont = pixelUiFontSize(8, s);
        const nameStroke = Math.max(2, Math.round(3 * s));
        const name = this.add.text(8, -18, rp.name || "?", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${nameFont}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: nameStroke,
            align: "center"
        }).setOrigin(0.5, 1);
        name.setResolution(zoom * (window.devicePixelRatio || 1));
        name.setScale(1 / zoom);
        this._liftAboveVeil(name, 60);

        const bubbleFont = pixelUiFontSize(16, s);
        const bubble = this.add.text(8, -30, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${bubbleFont}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: nameStroke,
            align: "center",
            wordWrap: { width: Math.round(140 * s), useAdvancedWrap: true }
        }).setOrigin(0.5, 1).setVisible(false);
        bubble.setResolution(zoom * (window.devicePixelRatio || 1));
        bubble.setScale(1 / zoom);
        this._liftAboveVeil(bubble, 61);

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
            fromX: rp.x,
            fromY: rp.y,
            tx: rp.x,
            ty: rp.y,
            snapAt: performance.now(),
            snapDt: 1000 / (NetProtocol.SNAPSHOT_HZ || 15),
            facing: rp.facing || "down",
            vx: rp.vx || 0,
            vy: rp.vy || 0,
            serverMoving: !!rp.moving,
            moving: !!rp.moving,
            stillMs: 0,
            animKey: null,
            displayName: rp.name || "?",
            attackTimer: 0,
            attackMax: 0,
            attackAngle: 0,
            prone: !!(rp.prone || rp.dead),
            look: rp.look || null,
            tex: spr.texture?.key
        };
    }

    _netStampRemotePose(entry, pose) {
        if (!entry || !pose) return;
        entry.fromX = entry.x;
        entry.fromY = entry.y;
        const prevTx = Number.isFinite(entry.tx) ? entry.tx : entry.x;
        const prevTy = Number.isFinite(entry.ty) ? entry.ty : entry.y;
        entry.snapDist = Math.hypot(pose.x - prevTx, pose.y - prevTy);
        entry.tx = pose.x;
        entry.ty = pose.y;
        entry.snapAt = performance.now();
        entry.snapDt = 1000 / (NetProtocol.SNAPSHOT_HZ || 15);
        if (typeof pose.moving === "boolean") entry.serverMoving = pose.moving;
        if (Number.isFinite(pose.vx)) entry.vx = pose.vx;
        if (Number.isFinite(pose.vy)) entry.vy = pose.vy;
    }

    _netApplySnapshot(snap) {
        if (!snap || !this.isNet) return;
        if (snap.clock) this._netApplyClock(snap.clock);
        const selfId = this._netPlayerId || this.net?.playerId;
        const seen = new Set();
        for (const rp of snap.players || []) {
            if (!rp?.id) continue;
            if (rp.id === selfId) {
                this.partySys?.applyNetPoses?.(rp);
                continue;
            }
            seen.add(rp.id);
            let entry = this.remotePlayers.get(rp.id);
            if (!entry) {
                entry = this._netMakeRemote(rp);
                this.remotePlayers.set(rp.id, entry);
            } else {
                this._netStampRemotePose(entry, rp);
            }
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
            entry.ownerId = rp.id;
            entry.pawnId = rp.id;
            entry.dead = !!rp.dead;
            const nColor = this.partySys?.nameColorFor?.({
                ownerId: rp.id,
                hostile: !!rp.hostile
            }) || "#ffffff";
            entry.name.setColor(nColor);
            entry.spr.setAlpha(1);
            entry.prone = !!(rp.prone || rp.dead);
            entry.resting = !!rp.resting;
            entry.injured = !!rp.injured;
            entry.restRot = rp.restRot ?? rp.lastSleep?.rot;
            entry.lastSleep = rp.lastSleep || null;
            // Dead players leave a corpse — no translucent ghost puppet
            entry.root.setVisible(!rp.dead);
            entry.name?.setVisible(!rp.dead);
            if (rp.dead) entry.bubble?.setVisible(false);
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
            for (const mem of rp.party || []) {
                if (!mem?.id) continue;
                const mid = `${rp.id}:${mem.id}`;
                seen.add(mid);
                let mEntry = this.remotePlayers.get(mid);
                if (!mEntry) {
                    mEntry = this._netMakeRemote({
                        ...mem,
                        name: mem.name,
                        look: mem.look,
                        x: mem.x,
                        y: mem.y,
                        facing: mem.facing
                    });
                    this.remotePlayers.set(mid, mEntry);
                } else {
                    this._netStampRemotePose(mEntry, mem);
                }
                mEntry.facing = mem.facing || "down";
                mEntry.displayName = mem.name || mEntry.displayName;
                mEntry.name.setText(mEntry.displayName);
                mEntry.ownerId = rp.id;
                mEntry.pawnId = mem.id;
                mEntry.dead = !!mem.dead;
                mEntry.name.setColor(this.partySys?.nameColorFor?.({
                    ownerId: rp.id,
                    hostile: !!mem.hostile
                }) || "#ffffff");
                mEntry.prone = !!(mem.prone || mem.dead);
                mEntry.resting = !!mem.resting;
                mEntry.injured = !!mem.injured;
                mEntry.restRot = mem.restRot ?? mem.lastSleep?.rot;
                mEntry.lastSleep = mem.lastSleep || null;
                mEntry.root.setVisible(!mem.dead);
                mEntry.name?.setVisible(!mem.dead);
                if (mem.dead) mEntry.bubble?.setVisible(false);
                if (mem.look && typeof Look !== "undefined" && !Look.looksEqual(mEntry.look, mem.look)) {
                    if (typeof PlayerLook !== "undefined") {
                        PlayerLook.apply(mEntry.spr, mem.look);
                        mEntry.tex = mEntry.spr.texture?.key;
                    }
                    mEntry.look = mem.look;
                }
                if (mem.dead) {
                    if (mEntry.fist) mEntry.fist.setVisible(false);
                    if (mEntry.weapon) mEntry.weapon.setVisible(false);
                } else if (mem.attacking && Number.isFinite(mem.attackAngle)) {
                    if (!(mEntry.attackTimer > 0)) {
                        this._netStartRemoteAttack(mEntry, mem.attackAngle, mem.facing, mem.attackArt);
                    } else {
                        mEntry.attackAngle = mem.attackAngle;
                        if (mem.attackArt) mEntry.attackArt = mem.attackArt;
                    }
                }
            }
        }
        for (const [id, entry] of this.remotePlayers) {
            if (!seen.has(id)) {
                if (typeof clearSleepFx === "function") clearSleepFx(entry);
                else if (typeof clearSleepZzz === "function") clearSleepZzz(entry);
                this._netDestroyRemote(entry);
                this.remotePlayers.delete(id);
            }
        }
        this._netApplyMobs(snap.mobs || []);
        this._netApplyDrops(snap.drops || []);
        this._netApplyCorpses(snap.corpses || []);
        this._netApplyCampfires(snap.campfires || []);
        this._netApplyStorages(snap.storages || []);
        this._netApplyWanderers(snap.wanderers || []);
    }

    _netApplyWanderers(list) {
        if (this.net?.isLocal) return;
        const sys = this.partySys;
        if (!sys) return;
        const incoming = list || [];
        if (!incoming.length && this._netWandererGraceUntil && performance.now() < this._netWandererGraceUntil) {
            return;
        }
        const seen = new Set();
        for (const w of list || []) {
            if (!w?.id) continue;
            seen.add(w.id);
            let pawn = sys.wanderers.find((p) => p.pawnId === w.id);
            if (!pawn) {
                pawn = sys.spawnWanderer({
                    id: w.id,
                    name: w.name,
                    look: w.look,
                    x: w.x,
                    y: w.y,
                    facing: w.facing,
                    heading: w.heading,
                    inventory: w.inventory,
                    hostile: w.hostile,
                    recruitLocked: w.recruitLocked,
                    refusedBy: w.refusedBy
                });
                pawn._netFromX = w.x;
                pawn._netFromY = w.y;
                pawn._netTx = w.x;
                pawn._netTy = w.y;
                pawn._netSnapAt = performance.now();
                pawn._netSnapDt = 1000 / ((typeof NetProtocol !== "undefined" && NetProtocol.SNAPSHOT_HZ) || 15);
                pawn._netMoving = typeof w.moving === "boolean"
                    ? w.moving
                    : !!(w.heading && (Math.abs(w.heading.x) + Math.abs(w.heading.y) > 0));
                if (w.heading) pawn.heading = w.heading;
            } else {
                if (pawn._netTx == null) {
                    pawn.x = w.x;
                    pawn.y = w.y;
                }
                const prevTx = Number.isFinite(pawn._netTx) ? pawn._netTx : pawn.x;
                const prevTy = Number.isFinite(pawn._netTy) ? pawn._netTy : pawn.y;
                pawn._netSnapDist = Math.hypot(w.x - prevTx, w.y - prevTy);
                pawn._netFromX = pawn.x;
                pawn._netFromY = pawn.y;
                pawn._netTx = w.x;
                pawn._netTy = w.y;
                pawn._netSnapAt = performance.now();
                pawn._netSnapDt = 1000 / ((typeof NetProtocol !== "undefined" && NetProtocol.SNAPSHOT_HZ) || 15);
                pawn._netMoving = typeof w.moving === "boolean"
                    ? w.moving
                    : !!(w.heading && (Math.abs(Number(w.heading.x)) + Math.abs(Number(w.heading.y)) > 0));
                pawn.facing = w.facing || pawn.facing;
                pawn.heading = w.heading || pawn.heading;
                pawn.hostile = !!w.hostile;
                pawn.recruitLocked = !!w.recruitLocked;
                pawn.refusedBy = new Set(w.refusedBy || []);
                if (w.attacking && Number.isFinite(w.attackAngle) && !pawn.isAttacking?.()) {
                    pawn.startMeleeAttack?.(null, {
                        silentNet: true,
                        angle: w.attackAngle
                    });
                }
            }
        }
        sys.wanderers = sys.wanderers.filter((p) => {
            if (seen.has(p.pawnId)) return true;
            p.destroy?.();
            return false;
        });
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
            if (clock.baseTickSpeed != null && Number.isFinite(Number(clock.baseTickSpeed))) {
                this._baseTickSpeed = Math.max(0, Number(clock.baseTickSpeed));
            }
        }

        this.updateClockText();
        if (this.lightGfx && this.worldMinuteIndex() !== prevIdx) this.updateTimeTint();

        if (this.net?.isLocal) this.applyRestClock?.();

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
                for (const p of this.party || []) {
                    if (p && p !== this.player && !p.isBodyDead?.()) p.hungerTick?.();
                }
            } else if (this.net?.isLocal && this.player) {
                // LocalSim skips hungerTick; still refresh the fed snapshot each minute
                // so malnutrition (and /heal's sticky flag) advances correctly.
                for (const p of this.party || [this.player]) {
                    if (!p || p.isBodyDead?.()) continue;
                    p._malnutritionFed =
                        (Number(p.kc) > 0) || (Number(p.saturation) > 0);
                }
            }
            this.tickSoakDrops();
            this.tickSpoilage();
            this.tickCorpseDecay();
            // Dedicated MP: campfire burn/cook is server-authored (events + snapshots).
            if (!(this.isNet && this.net?.connected && !this.net.isLocal)) {
                this.tickCampfires();
                this.tickDryingRacks();
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
                            const iconKey = (typeof Place !== "undefined" && Place.itemIconKey)
                                ? Place.itemIconKey(meta, (id) => this.getThing(id), (k) => this.textures.exists(k))
                                : meta.key;
                            if (iconKey && this.textures.exists(iconKey)) spr.setTexture(iconKey);
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
        assign("dryProgress", d.dryProgress);
        assign("soakProgress", d.soakProgress);
        assign("soakDoneAt", d.soakDoneAt);
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
        spr.dryProgress = e.dryProgress;
        spr.soakProgress = e.soakProgress;
        spr.soakDoneAt = e.soakDoneAt;
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
        if (!this.corpses?.children) this.corpses = this.add.group();
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
                playerCorpse: !!c.playerCorpse,
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
            if (!chunk.corpses?.children) {
                chunk.ensureSpriteGroups?.();
                if (!chunk.corpses) chunk.corpses = new Phaser.GameObjects.Group(this);
            }
            chunk.corpses.add(spr);
        } else if (chunk.corpses?.children && !chunk.corpses.contains(spr)) {
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
            spr.entry.playerCorpse = !!(c.playerCorpse || spr.entry.playerCorpse);
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
        if (!this.corpses?.children) this.corpses = this.add.group();
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
            look: m.look || null,
            panic: !!m.panic,
            hostile: !!m.hostile,
            prone: !!m.prone
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
            entry.hostile = !!m.hostile;
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
            entry.root.setDepth(entry.y | 0);

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
                if (entry.resting) {
                    setPuppetProne(entry.spr, true, {
                        feetAnchored: true,
                        resting: true,
                        restRot: entry.restRot
                    });
                } else {
                    setPuppetProne(entry.spr, !!entry.prone, { feetAnchored: true });
                }
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

    _netDestroyRemote(entry) {
        if (!entry) return;
        entry.name?.destroy?.();
        entry.bubble?.destroy?.();
        entry.root?.destroy?.(true);
    }

    _netLayoutRemoteLabels(entry) {
        const spr = entry.spr;
        const nameH = Math.ceil((entry.name.height || 12) * (entry.name.scaleY || 1));
        const resting = !!(entry.resting || spr?._resting);
        const prone = !!(entry.prone || spr?._prone);
        let nameX;
        let nameY;
        if (resting) {
            // Container is sleeper body center; sprite sits at local 0,0.
            nameX = 0;
            nameY = -Math.round(16 * 0.5 + 4);
        } else if (prone) {
            // Container is feet-anchored; sprite is shifted to body center.
            nameX = Math.round((spr.width || 16) * 0.5);
            nameY = -Math.round(Math.max(spr.width || 16, spr.height || 16) * 0.5 + 4);
        } else {
            nameX = Math.round((spr.width || 16) * 0.5);
            nameY = -Math.round((spr.height || 16) + 4);
        }
        const wx = entry.x + nameX;
        const wy = entry.y + nameY;
        if (entry.name?.active) {
            this._liftAboveVeil(entry.name, 60);
            entry.name.setPosition(wx, wy);
        }
        const bubbleOn = entry.bubble?.visible && (this.time?.now || 0) < entry.bubbleUntil;
        if (entry.bubble?.active) {
            this._liftAboveVeil(entry.bubble, 61);
            if (bubbleOn) entry.bubble.setPosition(wx, wy - nameH - 2);
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
                .setFontSize(`${pixelUiFontSize(8, s)}px`)
                .setStroke("#000000", stroke)
                .setResolution(res)
                .setScale(1 / zoom);
        }
        if (entry.bubble?.active) {
            entry.bubble
                .setFontSize(`${pixelUiFontSize(16, s)}px`)
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
            const isJoin = / joined\.?$/.test(text);
            const isLeave = / left\.?$/.test(text);
            const isPlayerChat = !!(ev.from || /^<.+>\s/.test(text));
            const yellow = isJoin || isLeave || isPlayerChat;
            this.combatLog?.push?.(text, yellow ? { color: CombatLog.COLOR_CHAT } : null);
            if (ev.from && ev.from !== selfId) {
                this._netShowRemoteBubble(ev.from, text);
            }
        }
        if (ev.kind === "death") {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.text) {
                const msg = String(ev.text).replace(/\.+$/, "");
                if (ev.playerId === selfId) {
                    this._pendingDeathText = msg;
                    if (this.player?._bodyDead || this.deathOverlay?.visible) {
                        this._applyDeathMessage(msg);
                    }
                }
            }
            if (ev.playerId) {
                if (ev.playerId === selfId) this.partySys?.clearPvpAggro?.();
                else this.partySys?.clearPvpAggro?.(ev.playerId);
            }
        }
        if (ev.kind === "channel" && ev.channel === "eat") {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.playerId === selfId && this.net?.connected && !this.net.isLocal) {
                const pawn = ev.pawnId
                    ? (this.party || []).find((p) => p.pawnId === ev.pawnId)
                    : this.player;
                const hud = !pawn || pawn === this.player;
                if (ev.done || ev.cancelled) {
                    if (pawn) pawn._eatChannel = null;
                    else this.player._eatChannel = null;
                    if (hud) this.hideChannelBar?.();
                } else if (typeof ev.progress === "number" && hud && this.player._eatChannel) {
                    this.showChannelBar?.(Phaser.Math.Clamp(ev.progress, 0, 1));
                }
            }
        }
        if (ev.kind === "party_death") {
            const pawn = (this.party || []).find((p) => p.pawnId === ev.pawnId);
            if (pawn) this.partySys?.onMemberDied?.(pawn, null, { spawn: false });
        }
        if (ev.kind === "player_left") {
            this.partySys?.clearPvpAggro?.(ev.playerId);
            this._netRemoveRemotesForOwner(ev.playerId);
        }
        if (ev.kind === "attack") {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.playerId && ev.playerId !== selfId) {
                const key = this._netRemoteKey(ev.playerId, ev.pawnId);
                let entry = this.remotePlayers.get(key);
                if (!entry) {
                    entry = this._netMakeRemote({
                        id: key,
                        name: "?",
                        x: ev.x ?? 0,
                        y: ev.y ?? 0,
                        facing: ev.facing || "down"
                    });
                    this.remotePlayers.set(key, entry);
                    entry.ownerId = ev.playerId;
                    entry.pawnId = ev.pawnId || ev.playerId;
                }
                this._netStartRemoteAttack(entry, Number(ev.angle) || 0, ev.facing, ev.art);
            } else if (
                ev.playerId === selfId
                && ev.pawnId
                && ev.pawnId !== this.player?.pawnId
                && !this.net?.isLocal
            ) {
                // Dedicated puppets: start the swing at the server pose.
                // LocalSim SP already plays companion attacks in PartyAI — echoing
                // `_pawn` x/y here snapped them onto the focused member.
                const pawn = (this.party || []).find((p) => p.pawnId === ev.pawnId);
                if (pawn) {
                    if (Number.isFinite(ev.x) && Number.isFinite(ev.y)) {
                        pawn.x = ev.x;
                        pawn.y = ev.y;
                        pawn._netTx = ev.x;
                        pawn._netTy = ev.y;
                    }
                    pawn.startMeleeAttack?.(null, {
                        silentNet: true,
                        angle: Number(ev.angle) || 0,
                        art: ev.art || null
                    });
                }
            } else if (ev.wandererId || (ev.uid && this.partySys?.wanderers?.some?.((p) => p.pawnId === ev.uid))) {
                const wid = ev.wandererId || ev.uid;
                const pawn = this.partySys?.wanderers?.find?.((p) => p.pawnId === wid);
                if (pawn) {
                    if (Number.isFinite(ev.x) && Number.isFinite(ev.y)) {
                        pawn.x = ev.x;
                        pawn.y = ev.y;
                        pawn._netTx = ev.x;
                        pawn._netTy = ev.y;
                    }
                    pawn.startMeleeAttack?.(null, {
                        silentNet: true,
                        angle: Number(ev.angle) || 0,
                        art: ev.art || null
                    });
                }
            } else if (!ev.playerId && ev.uid && this.netMobs) {
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
        if (ev.kind === "pvp_hit") {
            this.partySys?.onPvpHit?.(ev);
        }
        if (ev.kind === "pvp_clear") {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.ownerId && ev.ownerId !== selfId) {
                this.partySys?.clearPvpAggro?.(ev.ownerId);
            } else if (ev.ownerId === selfId) {
                this.partySys?.clearPvpAggro?.();
            }
        }
        if (ev.kind === "recruit") {
            this.partySys?.onRecruitResult?.(ev);
        }
        if (ev.kind === "vomit") {
            this._netApplyVomitEvent(ev);
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
        if (ev.kind === "chop") {
            this._netApplyChopEvent(ev);
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
        if (ev.kind === "storage") {
            this._netApplyStorageEvent(ev);
        }
        if (ev.kind === "thing_set") {
            this._netApplyThingSet(ev);
        }
    }

    /**
     * Dedicated MP: server cues vomit lock + spray. Each client paints local stains.
     */
    _netApplyVomitEvent(ev) {
        if (!ev || !this.net?.connected || this.net.isLocal) return;
        const selfId = this._netPlayerId || this.net?.playerId;
        if (ev.playerId === selfId && !ev.drip) {
            const remaining = Number(ev.remainingMs);
            this.player?.startVomit?.({
                remainingMs: remaining > 0 ? remaining : undefined,
                fromServer: true,
                silentLog: true
            });
        }
        const x = Number(ev.x);
        const y = Number(ev.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            this.spawnVomitStain?.(x, y, { facing: ev.facing || "down" });
        }
    }

    _netApplyYouVomit(you, pawn = null) {
        const target = pawn || this.leader || this.player;
        if (!you || !target || !this.net?.connected || this.net.isLocal) return;
        const remaining = Number(you.vomit?.remainingMs);
        if (remaining > 0) {
            if (!target.isVomiting?.()) {
                target.startVomit?.({
                    remainingMs: remaining,
                    fromServer: true,
                    silentLog: true
                });
            } else if (target._vomit) {
                target._vomit.fromServer = true;
                target._vomit.remainingMs = remaining;
            }
            return;
        }
        if (target._vomit?.fromServer) target._vomit = null;
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

    choppableThingsNear(wx, wy, rangePx) {
        const r = Number(rangePx);
        const range = Number.isFinite(r) && r > 0 ? r : 48;
        const r2 = range * range;
        const out = [];
        for (const chunk of Object.values(this.chunks || {})) {
            const kids = chunk.things?.getChildren?.() || [];
            for (const t of kids) {
                if (!t?.active || t.entry?.gone) continue;
                const def = t.meta || this.getThing(t.entry?.id);
                if (typeof Chop === "undefined" || !Chop.isChoppable(def)) continue;
                const dx = t.x - wx;
                const dy = t.y - wy;
                if (dx * dx + dy * dy <= r2) out.push(t);
            }
        }
        return out;
    }

    aimHitsChoppableTrunk(center, angle) {
        if (typeof Chop === "undefined" || !center) return false;
        const seg = Chop.aimSegment(center.x, center.y, angle, Chop.AIM_REACH);
        const trees = this.choppableThingsNear(center.x, center.y, Chop.AIM_REACH + 16);
        for (const t of trees) {
            const hs = t.hitboxSize || t.meta?.hitboxSize || 5;
            if (Chop.trunkHitsSegment(seg, t.x, t.y, hs, Chop.HIT_RADIUS)) return true;
        }
        return false;
    }

    applyLocalChop(thing, frac) {
        const entry = thing?.entry;
        if (!entry || typeof Chop === "undefined") return null;
        const def = this.getThing(entry.id) || thing.meta;
        if (!Chop.isChoppable(def)) return null;
        const result = Chop.applyChop(entry, frac);
        this.player?.noteChopProgress?.(thing, result.progress, false);
        if (!result.felled) return result;
        const drops = Chop.rollDrops(def, () => Math.random());
        const piles = Chop.scatterFellPiles(drops, entry.x, entry.y, () => Math.random());
        Chop.fellToStump(entry, def);
        if (typeof thing.morph === "function") thing.morph(entry.id);
        for (const p of piles) {
            const meta = this.getItem(p.id);
            if (meta && p.quantity > 0) {
                DroppedItem.spawn(this, p.x, p.y, meta, p.quantity, undefined, null, true);
            }
        }
        this.player?.noteChopProgress?.(thing, 1, true);
        this.hideTooltip?.();
        this.markLightDirty?.();
        return result;
    }

    _chopEventMatch(e, ev) {
        if (!e) return false;
        if (ev.uid && e.uid && e.uid === ev.uid) return true;
        if (ev.uid && e.uid && e.uid !== ev.uid) return false;
        const x = Number(ev.x);
        const y = Number(ev.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        return Math.abs(Number(e.x) - x) < 1.5 && Math.abs(Number(e.y) - y) < 1.5;
    }

    _netApplyChopEvent(ev) {
        if (!ev || this.net?.isLocal) return;
        const x = Number(ev.x);
        const y = Number(ev.y);
        const keys = [];
        if (Number.isInteger(ev.cx) && Number.isInteger(ev.cy)) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    keys.push(this.getKey(ev.cx + dx, ev.cy + dy));
                }
            }
        }
        if (Number.isFinite(x) && Number.isFinite(y)) {
            keys.push(this.getKey(
                Math.floor(x / this.chunkPx()),
                Math.floor((y - 1) / this.chunkPx())
            ));
        }
        const match = (e) => this._chopEventMatch(e, ev);
        let chunk = null;
        let entry = null;
        let listName = ev.list === "lootable" ? "lootableThings" : "things";
        const lists = listName === "lootableThings"
            ? ["lootableThings", "things"]
            : ["things", "lootableThings"];
        for (const k of keys) {
            const c = this.chunks[k];
            if (!c?.meta) continue;
            for (const name of lists) {
                const lst = c.meta[name];
                if (!Array.isArray(lst)) continue;
                const found = lst.find(match);
                if (found) {
                    chunk = c;
                    entry = found;
                    listName = name;
                    break;
                }
            }
            if (entry) break;
        }
        if (entry) {
            if (ev.felled) {
                if (ev.id) entry.id = ev.id;
                delete entry.chopProgress;
                delete entry.regrowAt;
                delete entry.regrowId;
                delete entry.gone;
            } else if (ev.chopProgress != null) {
                entry.chopProgress = ev.chopProgress;
            }
            const live = (chunk.things?.getChildren?.() || []).find(
                (t) => t?.entry === entry || (t?.entry && match(t.entry))
            ) || null;
            if (ev.felled && live && typeof live.morph === "function" && ev.id) {
                live.morph(ev.id);
            }
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.playerId && ev.playerId === selfId) {
                this.player?.noteChopProgress?.(live, ev.chopProgress, !!ev.felled);
            }
        } else {
            const selfId = this._netPlayerId || this.net?.playerId;
            if (ev.playerId && ev.playerId === selfId && ev.felled) {
                this.player?.noteChopProgress?.(null, 1, true);
            }
        }
        if (ev.felled) {
            this.hideTooltip?.();
            this.markLightDirty?.();
        }
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
        if (src.removed || opts.removed) {
            this._netRemoveCampfire(src, opts);
            return;
        }
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
                roastBarMinutes: src.roastBarMinutes || 0
            };
            if ((src.simmerBarMinutes || 0) > 0) entry.simmerBarMinutes = src.simmerBarMinutes;
            chunk.meta.things.push(entry);
        } else if (progressOnly) {
            if (src.id) entry.id = src.id;
            if (src.cookProgress != null) entry.cookProgress = src.cookProgress;
            if (src.burnRemaining != null) entry.burnRemaining = src.burnRemaining;
            if (src.roastBarMinutes != null) entry.roastBarMinutes = src.roastBarMinutes;
            if ((src.simmerBarMinutes || 0) > 0) entry.simmerBarMinutes = src.simmerBarMinutes;
            else delete entry.simmerBarMinutes;
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
            if ((src.simmerBarMinutes || 0) > 0) entry.simmerBarMinutes = src.simmerBarMinutes;
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
            } else {
                live.applyVisual?.();
            }
            live.applySmokeVisual?.();
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
        if (ev.removed) {
            this._netRemoveCampfire(ev, {
                cx: ev.cx,
                cy: ev.cy,
                uid: ev.uid
            });
            return;
        }
        const src = ev.entry || ev;
        this._netApplyCampfirePayload(src, {
            snapshot: false,
            cx: ev.cx,
            cy: ev.cy,
            uid: ev.uid || src.uid,
            rev: ev.rev
        });
    }

    _netRemoveCampfire(src, opts = {}) {
        const found = this._netFindCampfire(src, opts);
        const chunk = found.chunk;
        const entry = found.entry;
        const x = Number.isFinite(found.x) ? found.x : Number(src.x);
        const y = Number.isFinite(found.y) ? found.y : Number(src.y);
        const uid = src.uid || opts.uid || entry?.uid;
        const live = this._netFindCampfireSprite(entry || { uid }, x, y);
        if (chunk?.meta?.things && entry) {
            const i = chunk.meta.things.indexOf(entry);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        } else if (chunk?.meta?.things && uid) {
            const i = chunk.meta.things.findIndex((t) => t?.uid === uid);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        }
        if (live) {
            if (this.campfirePanel?.campfire === live) this.campfirePanel.close();
            live.destroy();
        }
        this.markLightDirty?.();
        this.updateLightVeil?.();
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

    _netFindStorage(src, hint = {}) {
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
            const store = Array.isArray(t.slots) || this.getThing?.(t.id)?.storage
                || this.getThing?.(t.id)?.craftStation
                || this.getThing?.(t.id)?.sleep
                || Array.isArray(t.occupants);
            if (!store) return false;
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

    _netStorageHeld(entry) {
        if (performance.now() < (this._invSwapGuardUntil || 0)) {
            const open = this.storagePanel?.visible && this.storagePanel.storage?.entry;
            if (open && entry && (open === entry || (open.uid && open.uid === entry.uid))) {
                return true;
            }
        }
        return false;
    }

    _netApplyStoragePayload(src, opts = {}) {
        if (!src || this.net?.isLocal) return;
        if (src.removed || opts.removed) {
            this._netRemoveStorage(src, opts);
            return;
        }
        const found = this._netFindStorage(src, opts);
        let { chunk, entry, x, y } = found;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (!chunk?.meta) return;
        if (!Array.isArray(chunk.meta.things)) chunk.meta.things = [];

        const incomingRev = Number(src.rev ?? opts.rev);
        const curRev = Number(entry?.rev);
        if (entry && Number.isFinite(curRev) && Number.isFinite(incomingRev) && incomingRev < curRev) {
            return;
        }

        const held = entry && this._netStorageHeld(entry);
        const newer = Number.isFinite(incomingRev) && Number.isFinite(curRev) && incomingRev > curRev;
        if (held && opts.snapshot && !newer) return;

        if (!entry) {
            const def = this.getThing(src.id);
            const isStation = !!(src.craftStation || def?.craftStation);
            const isSleep = !!(src.sleep || def?.sleep || Array.isArray(src.occupants));
            entry = {
                uid: src.uid || opts.uid || `${isSleep ? "sl" : isStation ? "cs" : "st"}_${Math.round(x)}_${Math.round(y)}`,
                id: src.id || (isSleep ? "lean_to" : isStation ? "skinworking_bench" : "wicker_basket"),
                x,
                y,
                rot: typeof Place !== "undefined" ? Place.normalizeRot(src.rot) : (src.rot || 0),
                rev: Number.isFinite(incomingRev) ? incomingRev : 0
            };
            if (isSleep) {
                if (Array.isArray(src.occupants)) entry.occupants = src.occupants;
                if (typeof Place !== "undefined") Place.ensureSleepEntry(entry, def);
            } else if (isStation) {
                if (typeof Place !== "undefined") Place.ensureCraftStationEntry(entry);
            } else {
                entry.slots = Array.isArray(src.slots) ? src.slots : [null, null, null, null, null, null];
                if (typeof Place !== "undefined") {
                    Place.ensureStorageEntry(entry, this.getThing(entry.id));
                }
            }
            chunk.meta.things.push(entry);
        } else {
            entry.uid = src.uid || opts.uid || entry.uid;
            if (src.id) entry.id = src.id;
            entry.x = x;
            entry.y = y;
            if (Number.isFinite(incomingRev)) entry.rev = incomingRev;
            if (src.rot != null) {
                entry.rot = typeof Place !== "undefined" ? Place.normalizeRot(src.rot) : src.rot;
            }
            if (Array.isArray(src.slots)) entry.slots = src.slots;
            if (Array.isArray(src.occupants)) entry.occupants = src.occupants;
        }
        this._netSyncStorageSprite(chunk, entry, x, y);
        this.storagePanel?.refresh?.();
        this.leanToPanel?.refresh?.();
        this._reconcileSleepOccupants?.(entry);
    }

    _netSyncStorageSprite(chunk, entry, x, y) {
        if (!entry) return;
        const def = this.getThing(entry.id);
        const isStation = !!(def?.craftStation);
        const isSleep = !!(def?.sleep || Array.isArray(entry.occupants));
        let live = isSleep
            ? this.findLeanToByUid(entry.uid)
            : isStation
            ? this.findCraftStationByUid(entry.uid)
            : this.findStorageByUid(entry.uid);
        if (!live) {
            for (const t of chunk?.things?.getChildren?.() || []) {
                const matchType = isSleep
                    ? (t instanceof LeanTo)
                    : isStation ? (t instanceof CraftStation) : (t instanceof Storage);
                if (!matchType) continue;
                if (t.entry === entry) { live = t; break; }
                if (Math.abs(t.x - x) < 1.5 && Math.abs(t.y - y) < 1.5) { live = t; break; }
            }
        }
        // Chunk load used to spawn a generic Thing (0° / not clickable). Replace it.
        if (!live) {
            for (const t of chunk?.things?.getChildren?.() || []) {
                if (!t?.active) continue;
                if (t instanceof CraftStation || t instanceof Storage || t instanceof LeanTo) continue;
                const sameUid = !!(entry.uid && t.entry?.uid === entry.uid);
                const samePos = Number.isFinite(x) && Number.isFinite(y)
                    && Math.abs(t.x - x) < 1.5 && Math.abs(t.y - y) < 1.5
                    && t.meta?.id === entry.id;
                if (sameUid || samePos) t.destroy();
            }
        }
        if (live) {
            if (live.entry !== entry) live.entry = entry;
            if (!isSleep) {
                live.x = x;
                live.y = y;
            }
            live.applyVisual?.();
            return;
        }
        if (chunk?.isLoaded) {
            const spr = isSleep
                ? new LeanTo(this, entry)
                : isStation ? new CraftStation(this, entry) : Storage.create(this, entry);
            chunk.things.add(spr);
        }
    }

    findCraftStationByUid(uid) {
        if (!uid) return null;
        for (const chunk of Object.values(this.chunks || {})) {
            for (const t of chunk.things?.getChildren?.() || []) {
                if (t instanceof CraftStation && t.entry?.uid === uid) return t;
            }
        }
        return null;
    }

    _netRemoveStorage(src, opts = {}) {
        const found = this._netFindStorage(src, opts);
        const { chunk, entry, x, y } = found;
        const uid = src.uid || opts.uid || entry?.uid;
        const live = this.findStorageByUid(uid)
            || this.findCraftStationByUid(uid)
            || this.findLeanToByUid(uid)
            || (chunk?.things?.getChildren?.() || []).find((t) =>
                (t instanceof Storage || t instanceof CraftStation || t instanceof LeanTo) && (
                    t.entry === entry
                    || (Number.isFinite(x) && Math.abs(t.x - x) < 1.5 && Math.abs(t.y - y) < 1.5)
                )
            );
        if (chunk?.meta?.things && entry) {
            const i = chunk.meta.things.indexOf(entry);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        } else if (chunk?.meta?.things && uid) {
            const i = chunk.meta.things.findIndex((t) => t?.uid === uid);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        }
        if (live) {
            if (this.storagePanel?.storage === live) this.storagePanel.close();
            if (this._craftStationThing === live) this.closeCraftMenu();
            if (this.leanToPanel?.leanTo === live) this.leanToPanel.close();
            live.destroy();
        }
    }

    _netApplyStorageEvent(ev) {
        if (!ev || this.net?.isLocal) return;
        this._netApplyStoragePayload(ev, {
            snapshot: false,
            cx: ev.cx,
            cy: ev.cy,
            uid: ev.uid,
            rev: ev.rev,
            removed: !!ev.removed
        });
    }

    _netApplyStorages(list) {
        if (this.net?.isLocal) return;
        if (!Array.isArray(list)) return;
        for (const src of list) {
            if (!src) continue;
            this._netApplyStoragePayload(src, {
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

    _netApplyThingSet(ev) {
        if (!ev || this.net?.isLocal) return;
        const tx = Math.floor(Number(ev.tx));
        const ty = Math.floor(Number(ev.ty));
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
        this.setThingOnTile(tx, ty, ev.entry || null, { lootable: !!ev.lootable });
    }

    _netSendMove(force = false) {
        if (!this.isNet || !this.net?.connected || !this.player) return;
        const now = performance.now();
        if (!force && this._netMoveAt && now - this._netMoveAt < 1000 / NetProtocol.MOVE_HZ) return;
        this._netMoveAt = now;

        const p = this.player;
        let x = 0;
        let y = 0;
        const downed = !!(p.isIncapacitated?.() || p.isImmobile?.() || p._downed
            || (p._prone && !p._resting));
        if (
            !this._gamePaused
            && !downed
            && !p.isVomiting?.()
        ) {
            const left = (p.cursors || this.cursors)?.left?.isDown || (p.keys || this.keys)?.A?.isDown;
            const right = (p.cursors || this.cursors)?.right?.isDown || (p.keys || this.keys)?.D?.isDown;
            const up = (p.cursors || this.cursors)?.up?.isDown || (p.keys || this.keys)?.W?.isDown;
            const down = (p.cursors || this.cursors)?.down?.isDown || (p.keys || this.keys)?.S?.isDown;
            x = (right ? 1 : 0) - (left ? 1 : 0);
            y = (down ? 1 : 0) - (up ? 1 : 0);
        }
        const pose = typeof creatureFeetPose === "function"
            ? creatureFeetPose(p)
            : { x: p.x, y: p.y };
        this.net.sendMove({
            x,
            y,
            sprint: !this._gamePaused && !!p.isSprinting,
            facing: p.facing || "down",
            px: pose.x,
            py: pose.y,
            pawnId: p.pawnId || this._netPlayerId,
            partyPoses: (this.party || [])
                .filter((m) => m && m !== p && !m.isBodyDead?.())
                .map((m) => ({
                    id: m.pawnId,
                    x: m.x,
                    y: m.y,
                    facing: m.facing || "down",
                    sprint: !!m.isSprinting,
                    attacking: !!m.isAttacking?.(),
                    attackAngle: m.attackAngle ?? null,
                    tending: !!(m._tendChannel && !m._tendChannel.corpse)
                        || !!this.partySys?._isTendLocked?.(m)
                })),
            viewChunks: this.genDistance || this.cullDistance || this.renderDistance || 6
        });
    }

    _netUpdateRemotes(delta) {
        const now = this.time?.now || 0;
        for (const entry of this.remotePlayers.values()) {
            const fromX = Number.isFinite(entry.fromX) ? entry.fromX : entry.x;
            const fromY = Number.isFinite(entry.fromY) ? entry.fromY : entry.y;
            const err = Math.hypot((entry.tx - fromX), (entry.ty - fromY));
            if (err > 72 || !Number.isFinite(entry.snapAt)) {
                entry.x = entry.tx;
                entry.y = entry.ty;
            } else {
                const snapDt = entry.snapDt || (1000 / 15);
                const age = performance.now() - entry.snapAt;
                let u = snapDt > 0 ? age / snapDt : 1;
                if (u > 1) u = 1;
                entry.x = fromX + (entry.tx - fromX) * u;
                entry.y = fromY + (entry.ty - fromY) * u;
            }
            entry.root.setPosition(entry.x, entry.y);
            // Sleepers sort in front of the lean-to (its feet), not by body-center Y.
            if (entry.resting && typeof sleepSortDepth === "function") {
                const lean = this.findLeanToByUid?.(entry.lastSleep?.uid);
                entry.root.setDepth(sleepSortDepth(entry.root, lean, entry.lastSleep?.slot));
            } else {
                entry.root.setDepth(entry.y | 0);
            }
            const attacking = entry.attackTimer > 0;
            const prone = !!entry.prone;
            if (prone) {
                entry.x = entry.tx;
                entry.y = entry.ty;
                entry.root.setPosition(entry.x, entry.y);
            }
            if (typeof setPuppetProne === "function") {
                if (entry.resting) {
                    const lean = this.findLeanToByUid?.(entry.lastSleep?.uid);
                    const spec = entry.lastSleep;
                    if (lean?.entry && typeof Sleep !== "undefined") {
                        const pos = Sleep.sleeperWorldPos(
                            lean.entry,
                            spec?.slot || 0,
                            this.tileSize,
                            lean.meta
                        );
                        entry.x = pos.x;
                        entry.y = pos.y;
                        entry.root.setPosition(pos.x, pos.y);
                    }
                    setPuppetProne(entry.spr, true, {
                        feetAnchored: false,
                        resting: true,
                        restRot: entry.restRot ?? lean?.entry?.rot
                    });
                } else {
                    setPuppetProne(entry.spr, prone, { feetAnchored: true });
                }
            }
            const snapDist = Number.isFinite(entry.snapDist) ? entry.snapDist : err;
            const wantWalk = !attacking && !prone
                && (entry.serverMoving === true || snapDist > 1);
            if (wantWalk) {
                entry.moving = true;
                entry.stillMs = 0;
            } else {
                entry.stillMs = (entry.stillMs || 0) + (delta || 16);
                if (entry.stillMs > 100) entry.moving = false;
            }
            if (prone) {
                entry.facing = "right";
            } else if (entry.moving) {
                const dx = entry.tx - fromX;
                const dy = entry.ty - fromY;
                if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
                    entry.facing = Math.abs(dx) > Math.abs(dy)
                        ? (dx > 0 ? "right" : "left")
                        : (dy > 0 ? "down" : "up");
                }
            }
            if (!prone) {
                const facing = entry.facing || "down";
                const key = `${entry.tex || entry.spr?.texture?.key}-${entry.moving ? "walk" : "idle"}-${facing}`;
                if (typeof PlayerLook !== "undefined") {
                    PlayerLook.play(entry.spr, facing, !!entry.moving);
                } else {
                    if (key !== entry.animKey && this.anims.exists(key)) {
                        entry.animKey = key;
                        entry.spr.play(key, true);
                    }
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
            if (entry.name?.setColor) {
                entry.name.setColor(this.partySys?.nameColorFor?.({
                    ownerId: entry.ownerId,
                    hostile: !!entry.hostile,
                    role: entry.role
                }) || "#ffffff");
            }
        }
    }

    _unbindSceneListeners() {
        if (this._onGameResize && this.scale) {
            this.scale.off("resize", this._onGameResize);
        }
        this._onGameResize = null;
        if (this._onPreUpdate) this.events?.off("preupdate", this._onPreUpdate);
        if (this._onPostUpdate) this.events?.off("postupdate", this._onPostUpdate);
        this._onPreUpdate = null;
        this._onPostUpdate = null;
        this._playReady = false;
    }

    shutdown() {
        this._playReady = false;
        this._unbindSceneListeners();
        this._teardownCharacterAutosave?.();
        this._unbindNetClose();
        if (this._gamePaused) {
            try { this.net?.setPaused?.(false); } catch (_) {}
            try { this.physics?.world?.resume?.(); } catch (_) {}
            try { this.anims?.resumeAll?.(); } catch (_) {}
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
        // World action bars sit above the time-of-day veil (depth 51 > lightGfx 50)
        // so night/dawn wash can't hide them. Position is world space; postupdate
        // redraws after the player snap so they stay locked to the sprite.
        this._channelBarProgress = null;
        this._chopBarThing = null;
        this._chopBarFrac = null;
        this.channelBar = this._ensureWorldHudBar(this.channelBar);
        this.treeChopBar = this._ensureWorldHudBar(this.treeChopBar);

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
            return `Carry: ${weight}/${strength} kg${weight > strength ? " (encumbered)" : ""}`;
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
        if (this._leavingGame || !this.painBar?.active || !this.player) return;
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
     * World HUD above the time-of-day veil. Parent into worldHudLayer (depth 51)
     * so the UI camera never draws a second unzoomed copy at world x/y.
     */
    _liftAboveVeil(obj, depth = 51) {
        if (!obj) return obj;
        if (obj.parentContainer) obj.parentContainer.remove(obj);
        const layer = this.worldHudLayer;
        if (layer) {
            if (obj.displayList !== layer) layer.add(obj);
        } else {
            this.add.existing(obj);
            this._uiCam?.ignore(obj);
        }
        obj.setDepth(depth);
        return obj;
    }

    _ensureWorldHudBar(existing) {
        const depth = 51;
        if (existing?.active) return this._liftAboveVeil(existing, depth);
        return this._liftAboveVeil(this.add.graphics().setVisible(false), depth);
    }

    /**
     * Progress 0–1 bar above the player. World-space, scaled 1/zoom so it stays
     * a constant screen size. Redrawn after the render snap in postupdate.
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

        this.channelBar = this._ensureWorldHudBar(this.channelBar);

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
        g.setPosition(player.x + lx, player.y + ly);
        // Local draw in screen-pixel units; scale makes them world-sized
        this._drawBar(g, -Math.floor(w / 2), -h, w, h, frac, 0x000000, 0x222222, color, 2);
    }

    showTreeChopBar(thing, frac) {
        if (!thing?.active) {
            this.hideTreeChopBar();
            return;
        }
        this._chopBarThing = thing;
        this._chopBarFrac = Phaser.Math.Clamp(Number(frac) || 0, 0, 1);
        this._drawTreeChopBar();
    }

    hideTreeChopBar() {
        this._chopBarThing = null;
        this._chopBarFrac = null;
        this.treeChopBar?.clear();
        this.treeChopBar?.setVisible(false);
    }

    _drawTreeChopBar() {
        const thing = this._chopBarThing;
        const frac = this._chopBarFrac;
        if (frac == null || !thing?.active) {
            this.hideTreeChopBar();
            return;
        }

        this.treeChopBar = this._ensureWorldHudBar(this.treeChopBar);

        const zoom = this.worldZoom || this.cameras.main?.zoom || 1;
        const w = 40;
        const h = 5;
        const color = this._channelBarFillColor(frac);
        const g = this.treeChopBar;
        g.clear().setVisible(true);
        g.setScale(1 / zoom);
        g.setPosition(thing.x, thing.y - thing.height - 2);
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
        this.tooltipText = crispUiText(this.add.text(0, 0, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(16, 1)}px`,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 2,
            padding: { left: this._tooltipPadding, right: this._tooltipPadding, top: this._tooltipPadding, bottom: this._tooltipPadding }
        }));
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
                    cur === this.deathOverlay ||
                    cur === this.partyPanel?.root
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
            const target = this._tooltipTarget;
            if (target && (target.scene == null || target.active === false)) {
                this.hideWorldTooltip();
                return;
            }
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
                if (campP.pointerOnDestroy?.(pointer)) return campP.destroyRect;
                return campP.container;
            }

            const storeP = this.storagePanel;
            if (storeP?.visible && storeP.containsPointer?.(pointer)) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                    if (this._isUnderStoragePanel(obj)) return obj;
                }
                if (storeP.pointerOnTake?.(pointer)) return storeP.takeRect;
                return storeP.container;
            }

            const leanP = this.leanToPanel;
            if (leanP?.visible && leanP.containsPointer?.(pointer)) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                    if (this._isUnderLeanToPanel(obj)) return obj;
                }
                if (leanP._pointerOnRect?.(leanP.destroyRect, leanP.destroyBtn, pointer)) {
                    return leanP.destroyRect;
                }
                return leanP.actionRect;
            }

            if (this.pointerOnCraftTake?.(pointer)) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                    if (this._isUnderCraftTake(obj)) return obj;
                }
                return this._craftTakeRect;
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

            const switchAlly = this.partySys?.worldSwitchTarget?.(pointer);

            // Empty lean-to bunks beat a sleeper's standing AABB (90°/270°),
            // but not a standing ally you're trying to click.
            if (!switchAlly) {
                for (let i = hits.length - 1; i >= 0; i--) {
                    const obj = hits[i];
                    if (!obj?.active || !obj.input?.enabled) continue;
                    if (!(obj instanceof LeanTo)) continue;
                    const slot = obj.slotAtPointer?.(pointer) ?? 0;
                    if (!obj.entry?.occupants?.[slot]) return obj;
                }
            }

            const downedAlly = this.partySys?.downedAllyUnderPointer?.(pointer);
            if (downedAlly) return downedAlly;

            for (let i = hits.length - 1; i >= 0; i--) {
                const obj = hits[i];
                if (!obj?.active || !obj.input?.enabled) continue;
                if (obj === this.tooltip || obj.parentContainer === this.tooltip) continue;
                // Dead party sprites stay click-through for loot; downed allies
                // must still hover so the name / "Downed" tip can show.
                if (
                    this.party?.includes(obj)
                    && (obj.isBodyDead?.() || obj._bodyDead || obj._resting)
                ) continue;
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
                if (cur === panel.container || cur === panel.destroyBtn ||
                    cur === panel.destroyRect || cur === panel.destroyText) return true;
                if (panel.slotViews?.some(v =>
                    v.slot === cur || v.icon === cur || v.fill === cur || v.qty === cur
                )) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderStoragePanel = (obj) => {
            const panel = this.storagePanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container || cur === panel.takeBtn ||
                    cur === panel.takeRect || cur === panel.takeText) return true;
                if (panel.slotViews?.some(v =>
                    v.slot === cur || v.icon === cur || v.fill === cur || v.qty === cur
                )) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderLeanToPanel = (obj) => {
            const panel = this.leanToPanel;
            if (!panel) return false;
            let cur = obj;
            while (cur) {
                if (cur === panel.container || cur === panel.actionBtn ||
                    cur === panel.actionRect || cur === panel.actionText ||
                    cur === panel.destroyBtn || cur === panel.destroyRect ||
                    cur === panel.destroyText) return true;
                cur = cur.parentContainer;
            }
            return false;
        };

        this._isUnderCraftTake = (obj) => {
            let cur = obj;
            while (cur) {
                if (cur === this._craftTakeBtn || cur === this._craftTakeRect ||
                    cur === this._craftTakeText) return true;
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
            let top = (blockWorld && hit && !this._isUiTooltipTarget(hit)) ? null : hit;

            // Texture/setInteractive resets drop the object from Phaser's hit list for
            // a frame (or until the next mouse move). If the cursor is still inside
            // the last hover sprite, keep it so lighting a campfire doesn't hide the tip.
            if (!top && !blockWorld && this._hoverTarget?.active) {
                const prev = this._hoverTarget;
                const b = prev.getBounds?.();
                if (b) {
                    const wpt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                    if (Phaser.Geom.Rectangle.Contains(b, wpt.x, wpt.y)) top = prev;
                }
            }

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
            } else if (top && this.tooltip?.visible && this.tooltip.scene) {
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
            if (!this._playReady || this._leavingGame) return;
            if (this.tooltip?.visible) this.positionTooltip(pointer.x, pointer.y);
        });
        // Snap player for draw only; restore true pose before the next physics step
        // so diagonal speed stays normalized (square-grid body snaps are √2-fast).
        this._onPreUpdate = () => {
            if (!this._playReady || this._leavingGame) return;
            this.restorePlayerPhysicsPos();
        };
        this._onPostUpdate = () => {
            if (!this._playReady || this._leavingGame) return;
            this.syncPointerHover();
            // After physics: snap player+camera for this frame's render
            this.syncCameraToPlayer();
            this.player?._syncChatBubble?.();
            if (this._channelBarProgress != null) this._drawChannelBar();
            if (this._chopBarFrac != null) this._drawTreeChopBar();
            this.drawChunkDebug();
        };
        this.events.on("preupdate", this._onPreUpdate);
        this.events.on("postupdate", this._onPostUpdate);
    }

    createClockDisplay() {
        this.clockText = this.add.text(0, 0, "", {
            fontSize: "16px",
            fontFamily: PIXEL_UI_FONT,
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 2
        }).setOrigin(0.5, 0).setDepth(9998);
        this.uiLayer.add(this.clockText);
        this.updateClockText();

        this.fpsText = this.add.text(0, 0, "", {
            fontSize: "16px",
            fontFamily: PIXEL_UI_FONT,
            color: "#a8e6a0",
            stroke: "#000000",
            strokeThickness: 2
        }).setOrigin(0.5, 0).setDepth(9998).setScrollFactor(0);
        this.uiLayer.add(this.fpsText);
        this._fpsVisible = true;
        this.fpsText.setVisible(true).setText(this._fpsPlaceholderText());
        /** @type {{ t: number, d: number }[]} frame deltas in the last ~1s */
        this._fpsSamples = [];
        this._fpsUiAcc = 0;

        // /debug location — blue X + red Y above hotbar center
        const locStyle = {
            fontSize: "16px",
            fontFamily: PIXEL_UI_FONT,
            stroke: "#000000",
            strokeThickness: 2
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
        const fs = pixelUiFontSize(16, s);
        const stroke = Math.max(2, Math.round(fs / 8));
        crispUiText(this.locXText);
        crispUiText(this.locYText);
        this.locXText.setFontSize(`${fs}px`).setStroke("#000000", stroke);
        this.locYText.setFontSize(`${fs}px`).setStroke("#000000", stroke);
        placeUiText(this.locXText, cx, y, 1, 1);
        placeUiText(this.locYText, cx, y, 0, 1);
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
        crispUiText(this.fpsText);
        const s = this.uiScale || 1;
        const pad = Math.round(8 * s);
        const clockBottom = this.clockText
            ? pad + Math.round(this.clockText.height || pixelUiFontSize(16, s))
            : pad;
        placeUiText(this.fpsText, this.scale.width / 2, clockBottom + Math.round(2 * s), 0.5, 0);
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
        for (const chunk of this._loadedChunks || []) {
            if (!chunk.isLoaded) continue;
            for (const thing of chunk.things?.getChildren?.() || []) {
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

        const wx = x0 * ts;
        const wy = y0 * ts;
        const ww = (x1 - x0) * ts;
        const wh = (y1 - y0) * ts;
        const washColor = Phaser.Display.Color.GetColor(r, g, b);

        const fillSky = (dark, wash) => {
            if (dark >= 0.02) {
                this.lightGfx.fillStyle(0x060a14, Math.min(0.96, dark));
                this.lightGfx.fillRect(wx, wy, ww, wh);
            }
            if (wash >= 0.02) {
                this.lightGfx.fillStyle(washColor, Math.min(0.28, wash));
                this.lightGfx.fillRect(wx, wy, ww, wh);
            }
        };

        // No campfire light: one overlay instead of hundreds of tile rects (walking hitch).
        if (!this.blockLight.size) {
            fillSky(skyDark, skyWash);
        } else {
            for (let ty = y0; ty < y1; ty++) {
                for (let tx = x0; tx < x1; tx++) {
                    const block = this.blockLight.get(`${tx},${ty}`) || 0;
                    const light = 1 - Math.min(15, block) / 15;
                    const dark = skyDark * light;
                    const wash = skyWash * light;
                    if (dark >= 0.02) {
                        this.lightGfx.fillStyle(0x060a14, Math.min(0.96, dark));
                        this.lightGfx.fillRect(tx * ts, ty * ts, ts, ts);
                    }
                    if (wash >= 0.02) {
                        this.lightGfx.fillStyle(washColor, Math.min(0.28, wash));
                        this.lightGfx.fillRect(tx * ts, ty * ts, ts, ts);
                    }
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

    /** Skinworking bench (and later craft stations): click opens the station recipe list. */
    wireCraftStation(thing) {
        if (!thing || !thing.meta?.craftStation) return;
        thing.setInteractive({ cursor: "pointer" });
        thing.on("pointerover", (pointer) => {
            this.showTooltip(
                () => thing.tooltipText?.() || thing.meta?.name || "Craft",
                pointer.x,
                pointer.y,
                thing
            );
        });
        thing.on("pointerout", () => {
            if (this._hoverTarget === thing) this._hoverTarget = null;
            if (this._tooltipTarget === thing) this.hideTooltip();
        });
        thing.on("pointerdown", (pointer) => {
            if (pointer.rightButtonDown()) return;
            if (this.pointerOverWorldUi?.(pointer)) return;
            if (this.restBlocksWorldUi?.()) return;
            if (!thing.inRange?.()) return;
            this.toggleCraftStationMenu(thing);
        });
        thing.on("destroy", () => {
            if (this._craftStationThing === thing) this.closeCraftMenu();
        });
    }

    /** World object UIs (campfire, storage, corpse, stations) while lying in a lean-to. */
    restBlocksWorldUi() {
        return !!(this.player?._resting && !this.player?._bodyDead);
    }

    _closeWorldUisForRest() {
        this.campfirePanel?.close?.();
        this.storagePanel?.close?.();
        this.corpsePanel?.close?.();
        if (this.craftMenuVisible) this.closeCraftMenu();
        this.knappingPanel?.close?.();
    }

    /**
     * True when the pointer is over world-anchored UI (corpse/campfire panels).
     * World click handlers must bail so rocks/corpses behind the chrome don't fire.
     */
    pointerOverWorldUi(pointer) {
        if (!pointer) return false;
        if (this.corpsePanel?.containsPointer?.(pointer)) return true;
        if (this.campfirePanel?.containsPointer?.(pointer)) return true;
        if (this.leanToPanel?.containsPointer?.(pointer)) return true;
        if (this.storagePanel?.containsPointer?.(pointer)) return true;
        if (this.pointerOnCraftTake?.(pointer)) return true;
        if (this._pointerOverCraftMenu?.(pointer)) return true;
        if (this.partyPanel?.containsPointer?.(pointer)) return true;
        return false;
    }

    _pointerOverCraftMenu(pointer) {
        if (!this.craftMenuVisible || !this.craftContainer?.visible || !pointer) return false;
        if (!this.craftContainer.getBounds) return false;
        return Phaser.Geom.Rectangle.Contains(this.craftContainer.getBounds(), pointer.x, pointer.y);
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

    playerFeetTile(player = this.player) {
        if (!player) return null;
        const ts = this.tileSize || 16;
        const w = player.displayWidth || player.width || ts;
        return {
            tx: Math.floor((player.x + w * 0.5) / ts),
            ty: Math.floor(player.y / ts)
        };
    }

    resolveThingDef(raw) {
        const text = String(raw || "").trim();
        if (!text) return null;
        const needle = text.toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
        if (needle === "null" || needle === "none" || needle === "clear") {
            return { clear: true };
        }
        const things = (this.things?.() || []).filter(Boolean);
        return this.getThing?.(needle)
            || things.find((t) => (t.id || "").toLowerCase() === needle)
            || things.find((t) => (t.name || "").toLowerCase().replace(/\s+/g, "_") === needle)
            || things.find((t) => (t.name || "").toLowerCase() === text.toLowerCase().replace(/_/g, " "))
            || null;
    }

    _makeThingEntry(def, x, y) {
        if (!def?.id) return null;
        if (def.lootable) {
            return {
                lootable: true,
                entry: {
                    x, y,
                    id: def.id,
                    uid: `lt_${Math.round(x)}_${Math.round(y)}_${def.id}`
                }
            };
        }
        if (def.campfire) {
            return {
                lootable: false,
                entry: {
                    id: def.id,
                    x, y,
                    uid: `cf_${Math.round(x)}_${Math.round(y)}`,
                    fuel: [null, null],
                    cook: null,
                    catalyst: null,
                    simmer: [null, null, null, null],
                    cookProgress: 0,
                    burnRemaining: 0
                }
            };
        }
        if (def.storage) {
            const entry = {
                id: def.id,
                x, y,
                rot: 0,
                slots: typeof Place !== "undefined"
                    ? Place.emptySlots(def.storage.slots || 6)
                    : [null, null, null, null, null, null]
            };
            if (typeof Place !== "undefined") Place.ensureStorageEntry(entry, def);
            return { lootable: false, entry };
        }
        if (def.craftStation) {
            const entry = { id: def.id, x, y, rot: 0 };
            if (typeof Place !== "undefined") Place.ensureCraftStationEntry(entry);
            return { lootable: false, entry };
        }
        return { lootable: false, entry: { id: def.id, x, y } };
    }

    _spawnThingSprite(chunk, entry, lootable) {
        if (!chunk?.isLoaded || !entry?.id) return null;
        const existing = (chunk.things?.getChildren?.() || []).find(
            (t) => t?.active && t.entry === entry
        );
        if (existing) {
            existing.applyVisual?.();
            return existing;
        }
        let thing;
        if (lootable) {
            thing = new LootableThing(this, entry, chunk);
        } else if (entry.id === "campfire" || entry.id === "unlit_campfire") {
            thing = new Campfire(this, entry);
        } else if (this.getThing(entry.id)?.sleep || Array.isArray(entry.occupants)) {
            thing = new LeanTo(this, entry);
        } else if (this.getThing(entry.id)?.craftStation) {
            thing = new CraftStation(this, entry);
        } else if (Array.isArray(entry.slots) || this.getThing(entry.id)?.storage) {
            thing = Storage.create(this, entry);
        } else {
            thing = new Thing(this, entry.x, entry.y, entry.id, entry);
            if (entry.id === "rock") this.wireRockKnapping?.(thing);
            else if (entry.id === "sign") {
                if (entry.spawnHint && this._spawnSignTooltip) {
                    entry.tooltip = this._spawnSignTooltip();
                }
                this.wireThingTooltip?.(thing);
            }
        }
        chunk.things.add(thing);
        if (thing instanceof LeanTo) this._reconcileSleepOccupants?.(entry);
        return thing;
    }

    /**
     * Debug/admin: replace whatever is on (tx, ty). `entry` null = clear only.
     * @param {{ lootable?: boolean }} [opts]
     */
    setThingOnTile(tx, ty, entry, opts = {}) {
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk) return false;
        this._clearTileThings(tx, ty);
        if (!entry?.id) {
            this.markLightDirty?.();
            this.updateLightVeil?.();
            return true;
        }
        const lootable = opts.lootable != null
            ? !!opts.lootable
            : !!this.getThing(entry.id)?.lootable;
        if (lootable) {
            if (!Array.isArray(chunk.meta.lootableThings)) chunk.meta.lootableThings = [];
            chunk.meta.lootableThings.push(entry);
        } else {
            if (!Array.isArray(chunk.meta.things)) chunk.meta.things = [];
            chunk.meta.things.push(entry);
        }
        this._spawnThingSprite(chunk, entry, lootable);
        this.markLightDirty?.();
        this.updateLightVeil?.();
        return true;
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

    resetPlaceRot() {
        this.placeRot = 0;
    }

    _heldPlaceableDef() {
        const held = this.player?.getHeldItem?.();
        if (!held || !(held.quantity > 0)) return null;
        const itemDef = this.getItem(held.id);
        const thingId = typeof Place !== "undefined" ? Place.placeThingId(itemDef) : itemDef?.place?.thing;
        if (!thingId) return null;
        const thingDef = this.getThing(thingId);
        if (!thingDef) return null;
        return { held, itemDef, thingId, thingDef };
    }

    _placeGhostBlocked() {
        if (this._gamePaused || this.player?._bodyDead || this.player?._resting) return true;
        if (this.combatLog?.isComposing?.()) return true;
        if (this.knappingPanel?.visible) return true;
        if (this.craftMenuVisible) return true;
        if (this.equipmentPanel?.visible) return true;
        if (this.healthPanel?.visible) return true;
        if (this.campfirePanel?.visible) return true;
        if (this.storagePanel?.visible) return true;
        if (this.leanToPanel?.visible) return true;
        if (this.corpsePanel?.visible) return true;
        return false;
    }

    _tileKeyAt(tx, ty) {
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk?.meta?.tiles) return null;
        const cs = this.chunkSize;
        const localX = tx - chunk.x * cs;
        const localY = ty - chunk.y * cs;
        if (localX < 0 || localY < 0 || localX >= cs || localY >= cs) return null;
        return chunk.meta.tiles[localX + localY * cs] || null;
    }

    _placeListsForTile(tx, ty) {
        const { x, y } = this.tileCenter(tx, ty);
        const home = this.getChunkAtWorld(x, y - 1);
        const things = [];
        const lootables = [];
        const seen = new Set();
        const add = (chunk) => {
            if (!chunk || seen.has(chunk)) return;
            seen.add(chunk);
            if (Array.isArray(chunk.meta?.things)) things.push(...chunk.meta.things);
            if (Array.isArray(chunk.meta?.lootableThings)) lootables.push(...chunk.meta.lootableThings);
        };
        add(home);
        const cs = this.chunkSize || 16;
        const ts = this.tileSize || 16;
        const cx = Math.floor(x / (cs * ts));
        const cy = Math.floor((y - 1) / (cs * ts));
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                add(this.getChunk?.(cx + dx, cy + dy));
            }
        }
        return {
            tileKey: this._tileKeyAt(tx, ty),
            things,
            lootables,
            chunk: home
        };
    }

    canPlaceAt(tx, ty) {
        if (!this.player) return false;
        const info = this._heldPlaceableDef();
        const def = info?.thingDef;
        const rot = typeof Place !== "undefined" ? Place.normalizeRot(this.placeRot) : (this.placeRot || 0);
        const ts = this.tileSize;
        const range = this.player.interactionRange;
        const { x, y } = this.tileCenter(tx, ty);
        if (typeof Place !== "undefined") {
            if (!Place.inPlaceRange(this.player.x, this.player.y, x, y, ts, range)) {
                return false;
            }
        }
        const fp = typeof Place !== "undefined" ? Place.footprintSize(def) : [1, 1];
        const tiles = typeof Place !== "undefined"
            ? Place.footprintTiles(tx, ty, rot, fp)
            : [{ tx, ty }];
        const getThing = (id) => this.getThing(id);
        for (const t of tiles) {
            if (typeof Place !== "undefined") {
                const occ = this._placeListsForTile(t.tx, t.ty);
                if (!Place.canPlaceOnTile({
                    tileKey: occ.tileKey,
                    things: occ.things,
                    lootables: occ.lootables,
                    tx: t.tx,
                    ty: t.ty,
                    tileSize: ts,
                    getThing
                })) return false;
            } else if (!this._tileKeyAt(t.tx, t.ty)) {
                return false;
            }
        }
        return true;
    }

    _ensurePlaceGhost() {
        if (this._placeGhost && this._placeGhost.active) return this._placeGhost;
        const key = this.textures.exists("wicker_basket_0")
            ? "wicker_basket_0"
            : (this.textures.exists("wicker_basket") ? "wicker_basket" : "slot");
        const g = this.add.image(0, 0, key)
            .setOrigin(0.5, 1)
            .setAlpha(0.5)
            .setVisible(false)
            .setDepth(0);
        this.mainLayer.add(g);
        this._placeGhost = g;
        return g;
    }

    _hidePlaceGhost() {
        if (this._placeGhost) this._placeGhost.setVisible(false);
        if (this._placeGhostFrame) this._placeGhostFrame.setVisible(false);
        this._placeGhostTile = null;
        this._placeGhostValid = false;
    }

    updatePlaceGhost() {
        const info = this._heldPlaceableDef();
        if (!info) {
            this.resetPlaceRot();
            this._hidePlaceGhost();
            return;
        }
        if (this._placeGhostBlocked()) {
            this._hidePlaceGhost();
            return;
        }
        const pointer = this.input.activePointer;
        if (!pointer || this.pointerOverWorldUi?.(pointer)) {
            this._hidePlaceGhost();
            return;
        }
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const { tx, ty } = this.worldToTile(world.x, world.y);
        const { x, y } = this.tileCenter(tx, ty);
        const inRange = typeof Place !== "undefined"
            ? Place.inPlaceRange(this.player.x, this.player.y, x, y, this.tileSize, this.player.interactionRange)
            : true;
        if (!inRange) {
            this._hidePlaceGhost();
            return;
        }
        const valid = this.canPlaceAt(tx, ty);
        const rot = typeof Place !== "undefined" ? Place.normalizeRot(this.placeRot) : (this.placeRot || 0);
        const hangKey = (typeof Hide !== "undefined" && Hide.isDryingRack(info.thingDef))
            ? Hide.hangingTextureKey(info.thingDef)
            : null;
        const rotTex = typeof Place !== "undefined"
            ? Place.rotationTextureKey(info.thingDef.key, rot)
            : info.thingDef.key;
        const ghost = this._ensurePlaceGhost();
        if (hangKey && this.textures.exists(hangKey)) ghost.setTexture(hangKey);
        else if (this.textures.exists(rotTex)) ghost.setTexture(rotTex);
        else if (this.textures.exists(info.thingDef.key)) ghost.setTexture(info.thingDef.key);
        let gx = x;
        let gy = y;
        if (typeof Place !== "undefined") {
            const fp = Place.footprintSize(info.thingDef);
            const pos = Place.footprintWorldPos(tx, ty, rot, fp, this.tileSize);
            gx = pos.x;
            gy = pos.y;
        }
        ghost.setPosition(gx, gy);
        const floorH = ghost.displayHeight || ghost.height || 16;
        ghost.setDepth(gy - floorH - 1);
        ghost.setAlpha(0.5);
        ghost.setTint(valid ? 0xffffff : 0xff5555);
        ghost.setVisible(true);
        const frameTex = (typeof Place !== "undefined" && info.thingDef?.sleep)
            ? Place.rotationFrameTextureKey(info.thingDef.key, rot)
            : null;
        if (frameTex && this.textures.exists(frameTex)) {
            let frame = this._placeGhostFrame;
            if (!frame || !frame.active) {
                frame = this.add.image(gx, gy, frameTex).setOrigin(0.5, 1);
                this.mainLayer.add(frame);
                this._placeGhostFrame = frame;
            } else {
                frame.setTexture(frameTex);
            }
            frame.setPosition(gx, gy);
            frame.setDepth(gy + 2);
            frame.setAlpha(0.5);
            frame.setTint(valid ? 0xffffff : 0xff5555);
            frame.setVisible(true);
        } else if (this._placeGhostFrame) {
            this._placeGhostFrame.setVisible(false);
        }
        this._placeGhostTile = { tx, ty };
        this._placeGhostValid = valid;
    }

    _handlePlaceRotate() {
        if (!this.keyR || !Phaser.Input.Keyboard.JustDown(this.keyR)) return;
        if (this._placeGhostBlocked()) return;
        if (!this._heldPlaceableDef()) return;
        const info = this._heldPlaceableDef();
        if (typeof Place !== "undefined" && !Place.canRotate(info?.thingDef)) return;
        const shift = this.player?.keys?.SHIFT?.isDown;
        if (typeof Place !== "undefined") {
            this.placeRot = shift ? Place.rotateCCW(this.placeRot) : Place.rotateCW(this.placeRot);
        } else {
            this.placeRot = ((this.placeRot || 0) + (shift ? 270 : 90)) % 360;
        }
    }

    tryPlaceHeld() {
        const info = this._heldPlaceableDef();
        if (!info) return false;
        if (this._placeGhostBlocked()) return false;
        const tile = this._placeGhostTile;
        if (!tile || !this._placeGhostValid) return false;
        if (!this.canPlaceAt(tile.tx, tile.ty)) return false;
        const rot = typeof Place !== "undefined" ? Place.normalizeRot(this.placeRot) : (this.placeRot || 0);

        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.PLACE,
                tx: tile.tx,
                ty: tile.ty,
                rot,
                pawnId: this.player?.pawnId
            });
            if (!(info.held.quantity > 1)) this.resetPlaceRot();
            return true;
        }

        const placed = info.thingDef.sleep
            ? this.placeSleep(tile.tx, tile.ty, info.thingId, rot)
            : info.thingDef.craftStation
            ? this.placeCraftStation(tile.tx, tile.ty, info.thingId, rot)
            : this.placeStorage(tile.tx, tile.ty, info.thingId, rot);
        if (!placed) return false;
        this.player.loseItem(info.held, 1);
        if (!(info.held.quantity > 0)) this.resetPlaceRot();
        return true;
    }

    placeStorage(tx, ty, thingId, rot = 0) {
        if (!this.canPlaceAt(tx, ty)) return null;
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk || !chunk.isLoaded) return null;
        const def = this.getThing(thingId);
        if (!def) return null;
        const entry = {
            id: thingId,
            x,
            y,
            rot: typeof Place !== "undefined" ? Place.normalizeRot(rot) : rot,
            slots: typeof Place !== "undefined"
                ? Place.emptySlots(def.storage?.slots || 6)
                : [null, null, null, null, null, null]
        };
        if (typeof Place !== "undefined") Place.ensureStorageEntry(entry, def);
        chunk.meta.things.push(entry);
        const spr = Storage.create(this, entry);
        chunk.things.add(spr);
        return spr;
    }

    placeSleep(tx, ty, thingId, rot = 0) {
        if (!this.canPlaceAt(tx, ty)) return null;
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk || !chunk.isLoaded) return null;
        const def = this.getThing(thingId);
        if (!def?.sleep) return null;
        const entry = {
            id: thingId,
            x,
            y,
            tx,
            ty,
            rot: typeof Place !== "undefined" ? Place.normalizeRot(rot) : rot
        };
        if (typeof Place !== "undefined") Place.ensureSleepEntry(entry, def);
        chunk.meta.things.push(entry);
        const spr = new LeanTo(this, entry);
        chunk.things.add(spr);
        return spr;
    }

    placeCraftStation(tx, ty, thingId, rot = 0) {
        if (!this.canPlaceAt(tx, ty)) return null;
        const { x, y } = this.tileCenter(tx, ty);
        const chunk = this.getChunkAtWorld(x, y - 1);
        if (!chunk || !chunk.isLoaded) return null;
        const def = this.getThing(thingId);
        if (!def?.craftStation) return null;
        const entry = {
            id: thingId,
            x,
            y,
            rot: typeof Place !== "undefined" ? Place.normalizeRot(rot) : rot
        };
        if (typeof Place !== "undefined") Place.ensureCraftStationEntry(entry);
        chunk.meta.things.push(entry);
        const spr = new CraftStation(this, entry);
        chunk.things.add(spr);
        return spr;
    }

    findStorageByUid(uid) {
        if (!uid) return null;
        for (const chunk of Object.values(this.chunks || {})) {
            for (const t of chunk.things?.getChildren?.() || []) {
                if (t instanceof Storage && t.entry?.uid === uid) return t;
            }
        }
        return null;
    }

    tryPickupStorage(storage) {
        if (!storage || !storage.isEmpty?.()) return false;
        if (!storage.inRange?.()) return false;
        const entry = storage.entry;
        const itemId = typeof Place !== "undefined"
            ? Place.itemIdForThing(entry.id, this.items())
            : entry.id;

        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this._invSwapGuardUntil = performance.now() + 1000;
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.STORAGE,
                op: "pickup",
                uid: entry.uid,
                x: storage.x,
                y: storage.y
            });
            return true;
        }

        this._removeStorageThing(storage);
        const meta = this.getItem(itemId);
        if (meta) {
            const left = this.player.gainItem(meta, 1);
            if (left > 0) {
                DroppedItem.spawn(this, storage.x, storage.y, meta, left);
            }
        }
        this.hotbar.dirty = true;
        return true;
    }

    tryPickupCraftStation(station) {
        if (!station?.meta?.craftStation) return false;
        if (!station.inRange?.()) return false;
        this.closeCraftMenu();
        return this.tryPickupStorage(station);
    }

    tryDestroyCampfire(campfire) {
        if (!campfire || campfire.isLit?.()) return false;
        if (!campfire.inRange?.()) return false;
        const entry = campfire.entry;
        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this._invSwapGuardUntil = performance.now() + 1000;
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.CAMPFIRE,
                op: "destroy",
                uid: entry?.uid,
                x: campfire.x,
                y: campfire.y
            });
            this.campfirePanel?.close();
            return true;
        }
        this._dumpCampfireContents(campfire);
        this._removeCampfireThing(campfire);
        return true;
    }

    _campfireContentStacks(entry) {
        const stacks = [];
        const push = (s) => {
            if (s?.id && s.quantity > 0) stacks.push(s);
        };
        for (const s of entry?.fuel || []) push(s);
        push(entry?.cook);
        push(entry?.catalyst);
        for (const s of entry?.simmer || []) push(s);
        return stacks;
    }

    _dumpCampfireContents(campfire) {
        const entry = campfire?.entry;
        if (!entry) return;
        const now = this.worldMinuteIndex?.() ?? null;
        const x = campfire.x;
        const y = campfire.y;
        for (const stack of this._campfireContentStacks(entry)) {
            const meta = this.getItem(stack.id);
            if (!meta) continue;
            const extras = typeof mealStackExtras === "function" ? mealStackExtras(stack) : null;
            const spoilAt = typeof spoilAtForWorld === "function"
                ? spoilAtForWorld(stack, now)
                : stack.spoilAt;
            DroppedItem.spawn(this, x, y, meta, stack.quantity, spoilAt, extras);
        }
    }

    _removeCampfireThing(campfire) {
        if (!campfire) return;
        const entry = campfire.entry;
        const chunk = this.getChunkAtWorld(campfire.x, campfire.y - 1);
        if (chunk?.meta?.things && entry) {
            const i = chunk.meta.things.indexOf(entry);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        }
        if (this.campfirePanel?.campfire === campfire) this.campfirePanel.close();
        campfire.destroy();
        this.markLightDirty?.();
    }

    _removeStorageThing(storage) {
        if (!storage) return;
        const entry = storage.entry;
        const chunk = this.getChunkAtWorld(storage.x, storage.y - 1);
        if (chunk?.meta?.things && entry) {
            const i = chunk.meta.things.indexOf(entry);
            if (i >= 0) chunk.meta.things.splice(i, 1);
        }
        if (this.storagePanel?.storage === storage) this.storagePanel.close();
        if (this._craftStationThing === storage) this.closeCraftMenu();
        storage.destroy();
    }

    findLeanToByUid(uid) {
        if (!uid) return null;
        for (const chunk of Object.values(this.chunks || {})) {
            for (const t of chunk.things?.getChildren?.() || []) {
                if (t instanceof LeanTo && t.entry?.uid === uid) return t;
            }
        }
        return null;
    }

    forEachSleepEntry(fn) {
        for (const chunk of Object.values(this.chunks || {})) {
            const list = chunk.meta?.things;
            if (!Array.isArray(list)) continue;
            for (const entry of list) {
                const def = this.getThing(entry?.id);
                if (!entry || !(def?.sleep || Array.isArray(entry.occupants))) continue;
                fn(entry, def, chunk);
            }
        }
    }

    _reconcileSleepOccupants(entry) {
        if (!entry || !Array.isArray(entry.occupants)) return;
        const dedicated = !!(this.isNet && this.net?.connected && !this.net.isLocal);
        for (let i = 0; i < entry.occupants.length; i++) {
            const id = entry.occupants[i];
            if (!id) continue;
            const pawn = (this.party || []).find((p) => p && p.pawnId === id);
            if (!pawn || pawn.isBodyDead?.()) {
                if (!dedicated) entry.occupants[i] = null;
                continue;
            }
            // Occupancy is "in this bed now", not "slept here once".
            if (!pawn._resting) {
                if (!dedicated) entry.occupants[i] = null;
                continue;
            }
            this._occupySlot(pawn, entry, i);
        }
        for (const pawn of this.party || []) {
            if (!pawn?._resting || pawn.isBodyDead?.()) continue;
            const last = pawn.lastSleep;
            if (last?.uid !== entry.uid) continue;
            const slot = last.slot || 0;
            if (entry.occupants[slot] && entry.occupants[slot] !== pawn.pawnId) {
                this._wakePawn(pawn, { manual: true });
                const def = this.getThing(entry.id);
                const pos = typeof Sleep !== "undefined"
                    ? Sleep.besideWorldPos(entry, this.tileSize, def)
                    : { x: entry.x, y: entry.y };
                pawn.x = pos.x;
                pawn.y = pos.y;
            }
        }
    }

    _findPawnSleepBed(pawn) {
        const id = pawn?.pawnId;
        const pose = this.net?.world?.poses?.[id];
        const hint = pose?.lastSleep || pawn?.lastSleep;
        if (id) {
            let occ = null;
            this.forEachSleepEntry((entry) => {
                if (occ || !Array.isArray(entry.occupants)) return;
                const slot = entry.occupants.indexOf(id);
                if (slot >= 0) occ = { entry, slot };
            });
            if (occ) return occ;
        }
        if (hint?.uid) {
            const lean = this.findLeanToByUid(hint.uid);
            if (lean?.entry) return { entry: lean.entry, slot: hint.slot || 0, lean };
        }
        const saved = this.net?.isLocal ? this.net.world?.chunks : null;
        if (saved && typeof Sleep !== "undefined" && Sleep.bedInChunkMap) {
            return Sleep.bedInChunkMap(saved, id, hint);
        }
        return null;
    }

    _clearPawnSleepOccupancy(pawn) {
        const id = pawn?.pawnId;
        if (!id) return;
        this.forEachSleepEntry((e) => {
            if (!Array.isArray(e.occupants)) return;
            for (let i = 0; i < e.occupants.length; i++) {
                if (e.occupants[i] === id) e.occupants[i] = null;
            }
        });
        const saved = this.net?.isLocal ? this.net.world?.chunks : null;
        if (saved && typeof Sleep !== "undefined") Sleep.clearOccupantInChunkMap?.(saved, id);
    }

    _restorePartySleep() {
        const dedicated = !!(this.isNet && this.net?.connected && !this.net.isLocal);
        const poses = this.net?.world?.poses || {};
        for (const pawn of this.party || []) {
            if (!pawn || pawn.isBodyDead?.()) continue;
            const pose = poses[pawn.pawnId];
            if (pose?.lastSleep) pawn.lastSleep = pose.lastSleep;
            // Per-world logout pose wins. A pose without `resting` is treated as
            // awake so lastSleep (remembered bunk) cannot put people back to bed.
            const wantRest = pose && typeof pose.resting === "boolean"
                ? !!pose.resting
                : (pose ? false : !!pawn._resting);
            pawn._resting = wantRest;
            if (!wantRest) {
                if (!dedicated) this._clearPawnSleepOccupancy(pawn);
                setCreatureRest?.(pawn, false);
                continue;
            }
            const bed = this._findPawnSleepBed(pawn);
            if (bed?.entry) {
                const slot = bed.slot || 0;
                if (typeof Sleep !== "undefined"
                    && Sleep.isSlotOccupied(bed.entry, slot)
                    && bed.entry.occupants[slot] !== pawn.pawnId) {
                    const def = this.getThing(bed.entry.id);
                    const pos = Sleep.besideWorldPos(bed.entry, this.tileSize, def);
                    pawn.x = pos.x;
                    pawn.y = pos.y;
                    setCreatureRest?.(pawn, false);
                    pawn._resting = false;
                    continue;
                }
                this._occupySlot(pawn, bed.entry, slot);
                continue;
            }
            // Dedicated: chunks may not have arrived yet; YOU.resting is authoritative.
            if (pawn._resting && !dedicated) this._wakePawn(pawn, { manual: true });
        }
    }

    openLeanToPanel(leanTo, pointer) {
        const switchAlly = this.partySys?.worldSwitchTarget?.(pointer);
        if (switchAlly) {
            this.partySys.tryAllyClick(switchAlly);
            return;
        }
        const slot = leanTo.slotAtPointer?.(pointer) ?? 0;
        const occ = leanTo.entry?.occupants?.[slot];
        const ally = (this.party || []).find((p) => p && p.pawnId === occ && p !== this.player);
        if (ally && !ally.isBodyDead?.()) {
            const cam = this.cameras?.main;
            const world = cam && pointer ? cam.getWorldPoint(pointer.x, pointer.y) : null;
            const onAlly = !world || typeof creaturePointerHit !== "function"
                || creaturePointerHit(ally, world.x, world.y);
            if (onAlly) {
                this.partySys?.tryAllyClick?.(ally);
                return;
            }
        }
        if (!leanTo?.inRange?.()) return;
        if (this.restBlocksWorldUi?.()) {
            const uid = this.player?.lastSleep?.uid;
            if (!uid || leanTo.entry?.uid !== uid) return;
        }
        this.leanToPanel?.toggle(leanTo, slot);
    }

    _sleepLog(msg) {
        this.combatLog?.push?.(msg);
    }

    _cancelPawnChannels(pawn) {
        if (!pawn) return;
        pawn._cancelEat?.();
        if (pawn._tendChannel && !pawn._tendChannel.corpse) pawn._cancelTend?.();
        pawn._cancelKnap?.();
        pawn._cancelCraft?.();
    }

    _intendedSleep() {
        if (!this._sleepIntended) this._sleepIntended = new Map();
        return this._sleepIntended;
    }

    tryLeanToRest(leanTo, slot) {
        const pawn = this.player;
        if (!pawn || pawn.isBodyDead?.()) return false;
        const entry = leanTo?.entry;
        if (!entry) return false;
        if (typeof Sleep !== "undefined" && Sleep.isSlotOccupied(entry, slot) && entry.occupants[slot] !== pawn.pawnId) {
            this._sleepLog("That spot is taken.");
            return false;
        }
        if (pawn._downed || pawn.isIncapacitated?.() || pawn.isImmobile?.()) {
            const pos = typeof Sleep !== "undefined"
                ? Sleep.sleeperWorldPos(entry, slot, this.tileSize, leanTo.meta)
                : { x: leanTo.x, y: leanTo.y };
            const onTile = Math.hypot(pawn.x - pos.x, pawn.y - pos.y) < (this.tileSize || 16);
            if (!onTile) {
                this._sleepLog("They can't walk to the lean-to.");
                return false;
            }
        }
        this._cancelPawnChannels(pawn);
        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.SLEEP,
                op: "rest",
                uid: entry.uid,
                slot,
                pawnId: pawn.pawnId
            });
            this._orderRest(pawn, entry, slot, { autofill: false });
            this.leanToPanel?.close();
            return true;
        }
        this._orderRest(pawn, entry, slot, { autofill: true });
        this.leanToPanel?.close();
        return true;
    }

    tryLeanToWake(leanTo, slot) {
        const pawn = this.player;
        const occ = leanTo?.entry?.occupants?.[slot];
        if (!pawn || occ !== pawn.pawnId) return false;
        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this.net.sendAction({
                type: NetProtocol.Actions.SLEEP,
                op: "wake",
                pawnId: pawn.pawnId
            });
        }
        this._wakePawn(pawn, { manual: true });
        this.leanToPanel?.close();
        this.applyRestClock?.();
        return true;
    }

    tryDestroyLeanTo(leanTo) {
        const entry = leanTo?.entry;
        if (!entry || (typeof Sleep !== "undefined" && !Sleep.isEmpty(entry))) return false;
        if (!leanTo.inRange?.()) return false;
        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this.net.sendAction({
                type: NetProtocol.Actions.SLEEP,
                op: "destroy",
                uid: entry.uid,
                pawnId: this.player?.pawnId
            });
            this.leanToPanel?.close();
            return true;
        }
        this._cancelRestWalksTo(entry.uid);
        const itemDef = this.getItem(typeof Place !== "undefined"
            ? Place.itemIdForThing(entry.id, this.items())
            : "lean_to");
        const stacks = typeof Sleep !== "undefined"
            ? Sleep.salvageStacks(itemDef?.recipe)
            : [];
        const tiles = typeof Place !== "undefined"
            ? Place.entryFootprintTiles(entry, this.tileSize, leanTo.meta)
            : null;
        const piles = typeof Sleep !== "undefined"
            ? Sleep.scatterSalvagePiles(stacks, tiles, this.tileSize)
            : stacks.map((s) => ({ ...s, x: leanTo.x, y: leanTo.y }));
        for (const pile of piles) {
            const meta = this.getItem(pile.id);
            if (!meta || !(pile.quantity > 0)) continue;
            DroppedItem.spawn(this, pile.x, pile.y, meta, pile.quantity);
        }
        this._removeLeanToThing(leanTo);
        this.leanToPanel?.close();
        return true;
    }

    _removeLeanToThing(leanTo) {
        if (!leanTo) return;
        const entry = leanTo.entry;
        const uid = entry?.uid;
        const dropFrom = (chunk) => {
            const list = chunk?.meta?.things;
            if (!Array.isArray(list)) return;
            for (let i = list.length - 1; i >= 0; i--) {
                const e = list[i];
                if (e === entry || (uid && e?.uid === uid)) list.splice(i, 1);
            }
        };
        const ox = Number.isFinite(entry?.x) ? entry.x : leanTo.x;
        const oy = Number.isFinite(entry?.y) ? entry.y : leanTo.y;
        const home = this.getChunkAtWorld(ox, oy - 1)
            || this.getChunkAtWorld(leanTo.x, leanTo.y - 1);
        dropFrom(home);
        if (home) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    dropFrom(this.getChunk(home.x + dx, home.y + dy));
                }
            }
        }
        if (this.leanToPanel?.leanTo === leanTo) this.leanToPanel.close();
        leanTo.destroy();
    }

    _cancelRestWalksTo(uid) {
        const intended = this._intendedSleep();
        for (const [id, spec] of [...intended.entries()]) {
            if (spec?.uid !== uid) continue;
            intended.delete(id);
            const pawn = (this.party || []).find((p) => p.pawnId === id);
            if (pawn) {
                pawn._restWalk = null;
                this._sleepLog(`${pawn.pawnName || "They"} can't rest there.`);
            }
        }
    }

    _orderRest(pawn, entry, slot, opts = {}) {
        if (!pawn || !entry) return false;
        const id = pawn.pawnId;
        if (pawn._resting && pawn.lastSleep?.uid === entry.uid && pawn.lastSleep?.slot === slot) {
            return true;
        }
        if (typeof Sleep !== "undefined" && Sleep.isSlotOccupied(entry, slot) && entry.occupants[slot] !== id) {
            this._sleepLog("That spot is taken.");
            return false;
        }
        this._cancelPawnChannels(pawn);
        if (pawn._resting) this._wakePawn(pawn, { moving: true });
        pawn._restWalk = { uid: entry.uid, slot };
        pawn.lastSleep = { uid: entry.uid, slot };
        this._intendedSleep().set(id, { uid: entry.uid, slot });
        if (opts.autofill) this._autofillInjured(entry);
        return true;
    }

    _autofillInjured(originEntry) {
        const originSpr = this.findLeanToByUid(originEntry.uid);
        const ox = originSpr?.x ?? originEntry.x;
        const oy = originSpr?.y ?? originEntry.y;
        const ts = this.tileSize;
        const intended = this._intendedSleep();
        const taken = new Set();
        for (const spec of intended.values()) taken.add(`${spec.uid}:${spec.slot}`);
        this.forEachSleepEntry((e) => {
            (e.occupants || []).forEach((id, i) => {
                if (id) taken.add(`${e.uid}:${i}`);
            });
        });
        const slots = [];
        this.forEachSleepEntry((e, def, chunk) => {
            const spr = this.findLeanToByUid(e.uid);
            const x = spr?.x ?? e.x;
            const y = spr?.y ?? e.y;
            if (typeof Sleep !== "undefined" && !Sleep.inCampRange(ox, oy, x, y, ts)) return;
            const n = typeof Sleep !== "undefined" ? Sleep.slotCount(def, e) : 2;
            for (let i = 0; i < n; i++) {
                const key = `${e.uid}:${i}`;
                if (taken.has(key)) continue;
                slots.push({ entry: e, def, slot: i, x, y });
            }
        });
        const injured = (this.party || []).filter((p) => {
            if (!p || p === this.player || p.isBodyDead?.()) return false;
            if (p._resting || p._restWalk) return false;
            if (p._downed || p.isIncapacitated?.() || p.isImmobile?.()) return false;
            return typeof Sleep !== "undefined" ? Sleep.injuredForAutofill(p.anatomy) : false;
        });
        for (const pawn of injured) {
            const next = slots.shift();
            if (!next) break;
            taken.add(`${next.entry.uid}:${next.slot}`);
            this._orderRest(pawn, next.entry, next.slot, { autofill: false });
        }
    }

    _occupySlot(pawn, entry, slot) {
        if (!pawn || !entry) return false;
        if (!Array.isArray(entry.occupants)) entry.occupants = [null, null];
        if (entry.occupants[slot] && entry.occupants[slot] !== pawn.pawnId) {
            this._sleepLog("That spot is taken.");
            pawn._restWalk = null;
            this._intendedSleep().delete(pawn.pawnId);
            return false;
        }
        this.forEachSleepEntry((e) => {
            if (!Array.isArray(e.occupants)) return;
            for (let i = 0; i < e.occupants.length; i++) {
                if (e.occupants[i] === pawn.pawnId) e.occupants[i] = null;
            }
        });
        entry.occupants[slot] = pawn.pawnId;
        pawn._restWalk = null;
        pawn._resting = true;
        pawn.lastSleep = { uid: entry.uid, slot, rot: entry.rot };
        this._intendedSleep().delete(pawn.pawnId);
        pawn.setVelocity?.(0, 0);
        if (typeof pinRestingCreature === "function") pinRestingCreature(pawn, this);
        else {
            const pos = typeof Sleep !== "undefined"
                ? Sleep.sleeperWorldPos(entry, slot, this.tileSize, def)
                : { x: entry.x, y: entry.y };
            setCreatureRest?.(pawn, true, entry.rot);
            pawn.setPosition?.(pos.x, pos.y);
            pawn.syncSortDepth?.();
        }
        this.applyRestClock();
        this.leanToPanel?.refresh?.();
        if (pawn === this.player) {
            this._closeWorldUisForRest();
            this._netSendMove?.(true);
        }
        return true;
    }

    _wakePawn(pawn, opts = {}) {
        if (!pawn) return;
        const id = pawn.pawnId;
        const last = pawn.lastSleep;
        this.forEachSleepEntry((e) => {
            if (!Array.isArray(e.occupants)) return;
            for (let i = 0; i < e.occupants.length; i++) {
                if (e.occupants[i] === id) e.occupants[i] = null;
            }
        });
        if (this.net?.isLocal && this.net.world?.chunks && typeof Sleep !== "undefined") {
            Sleep.clearOccupantInChunkMap?.(this.net.world.chunks, id);
        }
        pawn._restWalk = null;
        this._intendedSleep().delete(id);
        setCreatureRest?.(pawn, false);
        pawn._resting = false;
        this._placePawnAtWakePos(pawn, last);
        pawn._skipMove = true;
        if (opts.help) pawn._wokeFromRest = true;
        if (opts.manual) pawn._wokeFromRest = false;
        this.applyRestClock();
        this.leanToPanel?.refresh?.();
    }

    /** Standing pose just outside the open side — same tile the Wake button uses. */
    _placePawnAtWakePos(pawn, last = null) {
        const spec = last || pawn?.lastSleep;
        if (!pawn || !spec?.uid || typeof Sleep === "undefined") return false;
        const lean = this.findLeanToByUid(spec.uid);
        const entry = lean?.entry;
        if (!entry) return false;
        const pos = Sleep.besideWorldPos(entry, this.tileSize, lean.meta);
        if (typeof ensureStandingFeetOrigin === "function") ensureStandingFeetOrigin(pawn);
        if (typeof pawn.teleport === "function") pawn.teleport(pos.x, pos.y);
        else pawn.setPosition?.(pos.x, pos.y);
        pawn.setVelocity?.(0, 0);
        pawn._physX = pos.x;
        pawn._physY = pos.y;
        if (pawn.body) {
            pawn.body.setVelocity?.(0, 0);
            if (typeof syncPawnPhysicsPose === "function") syncPawnPhysicsPose(pawn);
            else pawn.body.reset?.(pos.x, pos.y);
        }
        pawn._wakeIframes = 2;
        return true;
    }

    applyRestClock() {
        if (this.isNet && this.net?.connected && !this.net.isLocal) return this.tickSpeed;
        const base = Number.isFinite(this._baseTickSpeed) ? this._baseTickSpeed : (this.tickSpeed || 1);
        const speed = this.setTickSpeed(base);
        this.updateClockText?.();
        return speed;
    }

    _tickSleepZzz(delta) {
        const seen = new Set();
        const tick = (host) => {
            if (typeof tickSleepZzz === "function") tickSleepZzz(host, this, delta);
            if (typeof tickSleepHealFx === "function") tickSleepHealFx(host, this, delta);
        };
        for (const p of this.party || []) {
            if (!p || seen.has(p)) continue;
            seen.add(p);
            tick(p);
        }
        if (this.player && !seen.has(this.player)) tick(this.player);
        for (const entry of this.remotePlayers?.values?.() || []) tick(entry);
    }

    _restEffectiveSpeed(base) {
        const b = Number.isFinite(base) ? base : (this._baseTickSpeed || 1);
        const living = (this.party || []).filter((p) => p && !p.isBodyDead?.());
        const everyone = living.length > 0 && living.every((p) => p._resting);
        return typeof Sleep !== "undefined"
            ? Sleep.effectiveTickSpeed(b, everyone)
            : (everyone ? Math.max(4, b) : b);
    }

    _tryWakePlayer() {
        const pawn = this.player;
        if (!pawn?._resting) return;
        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this.net.sendAction({
                type: NetProtocol.Actions.SLEEP,
                op: "wake",
                pawnId: pawn.pawnId
            });
        }
        this._wakePawn(pawn, { manual: true });
    }

    tickSleepWalks(delta) {
        const ts = this.tileSize || 16;
        for (const pawn of this.party || []) {
            if (!pawn || pawn.isBodyDead?.()) continue;
            if (pawn._restWalk) {
                const spec = pawn._restWalk;
                const lean = this.findLeanToByUid(spec.uid);
                const entry = lean?.entry;
                if (!entry) {
                    pawn._restWalk = null;
                    this._sleepLog(`${pawn.pawnName || "They"} can't rest there.`);
                    continue;
                }
                const def = this.getThing(entry.id);
                const pos = Sleep.sleeperWorldPos(entry, spec.slot, ts, def);
                const c = pawn.bodyCenter?.() || { x: pawn.x, y: pawn.y };
                const d = Math.hypot(c.x - pos.x, c.y - pos.y);
                const arrive = Sleep.ARRIVE_PX || 16;
                if (d < arrive) {
                    this._occupySlot(pawn, entry, spec.slot);
                    continue;
                }
                if (pawn.isControlled?.()) continue;
                if (pawn.partyAI?._walkBodyToward) {
                    pawn.partyAI._walkBodyToward(pawn, pos.x, pos.y, ts, false, delta);
                } else {
                    pawn.partyAI?._walkToward?.(pawn, pos.x, pos.y, ts, false, delta);
                }
            } else if (pawn._resting) {
                pawn.setVelocity?.(0, 0);
                if (typeof pinRestingCreature === "function") pinRestingCreature(pawn, this);
                else {
                    const spec = pawn.lastSleep;
                    const lean = spec ? this.findLeanToByUid(spec.uid) : null;
                    setCreatureRest?.(pawn, true, spec?.rot ?? lean?.entry?.rot);
                }
            } else if (pawn._wokeFromRest && !pawn.partyAI?.assistTarget) {
                if (!this.partySys?._shouldDelaySleep?.(pawn)) this._tryReturnToBed(pawn);
            }
        }
    }

    _sleepSlotClaimed(entry, slot, exceptId) {
        if (!entry) return true;
        const occ = entry.occupants?.[slot];
        if (occ && occ !== exceptId) return true;
        for (const [id, spec] of this._intendedSleep()) {
            if (id === exceptId) continue;
            if (spec?.uid === entry.uid && spec.slot === slot) return true;
        }
        for (const p of this.party || []) {
            if (!p || p.pawnId === exceptId) continue;
            if (p._restWalk?.uid === entry.uid && p._restWalk.slot === slot) return true;
        }
        return false;
    }

    _tryInjuredRest(pawn) {
        if (!pawn || pawn === this.player || pawn.isControlled?.()) return;
        if (pawn._resting || pawn._restWalk || pawn._wokeFromRest) return;
        if (pawn.partyAI?.assistTarget) return;
        if (this.partySys?._shouldDelaySleep?.(pawn)) return;
        if (pawn._downed || pawn.isIncapacitated?.() || pawn.isImmobile?.()) return;
        if (typeof Sleep === "undefined" || !Sleep.injuredForAutofill(pawn.anatomy)) return;
        this._tryReturnToBed(pawn);
    }

    _tryReturnToBed(pawn) {
        if (!pawn || pawn._resting || pawn._restWalk) return;
        if (!Sleep.capableToFight(pawn) && (pawn._downed || pawn.isIncapacitated?.())) {
            pawn._wokeFromRest = false;
            return;
        }
        const id = pawn.pawnId;
        const last = pawn.lastSleep;
        let entry = null;
        let slot = 0;
        if (last?.uid) {
            const lean = this.findLeanToByUid(last.uid);
            entry = lean?.entry;
            slot = last.slot || 0;
            if (entry && this._sleepSlotClaimed(entry, slot, id)) entry = null;
        }
        if (!entry) {
            const ox = pawn.x;
            const oy = pawn.y;
            let best = null;
            let bestD = Infinity;
            this.forEachSleepEntry((e, def) => {
                const spr = this.findLeanToByUid(e.uid);
                const x = spr?.x ?? e.x;
                const y = spr?.y ?? e.y;
                if (!Sleep.inCampRange(ox, oy, x, y, this.tileSize)) return;
                const n = Sleep.slotCount(def, e);
                for (let i = 0; i < n; i++) {
                    if (this._sleepSlotClaimed(e, i, id)) continue;
                    const d = Math.hypot(ox - x, oy - y);
                    if (d < bestD) {
                        bestD = d;
                        best = { entry: e, slot: i };
                    }
                }
            });
            if (best) {
                entry = best.entry;
                slot = best.slot;
            }
        }
        pawn._wokeFromRest = false;
        if (entry) this._orderRest(pawn, entry, slot, { autofill: false });
    }

    _isLocalPartyPawn(pawn) {
        return !!(pawn && (this.party?.includes(pawn) || pawn === this.player || pawn === this.leader));
    }

    /** Stand capable resters in camp so they can defend, then return to bed after. */
    _wakeAbleResters(enemy, origin) {
        if (this.isNet && this.net?.connected && !this.net.isLocal) return;
        if (!enemy || enemy.isBodyDead?.()) return;
        const from = origin || this.player;
        const ts = this.tileSize || 16;
        const camp = (typeof Sleep !== "undefined" ? Sleep.CAMP_TILES : 12) * ts;
        const ox = from?.x ?? 0;
        const oy = from?.y ?? 0;
        for (const p of this.party || []) {
            if (!p || p.isBodyDead?.()) continue;
            if (!p._resting) continue;
            if (typeof Sleep !== "undefined" && !Sleep.capableToFight(p)) continue;
            if (Math.hypot(p.x - ox, p.y - oy) > camp) continue;
            this._wakePawn(p, { help: true });
            p.partyAI?.setAssist?.(enemy);
        }
        if (this.partySys) {
            this.partySys.lastHitMob = enemy;
            this.partySys.lastHitAt = this.time?.now || Date.now();
        }
    }

    _onSleepCombatHit(victim, attacker) {
        if (this.isNet && this.net?.connected && !this.net.isLocal) return;
        if (!victim || victim.isBodyDead?.()) return;
        if (attacker && typeof Party !== "undefined" && Party.sameFaction?.(victim, attacker)) return;
        if (!attacker || attacker === victim) return;
        if (!this._isLocalPartyPawn(victim)) return;
        this._wakeAbleResters(attacker, victim);
        if (!victim._resting) victim.partyAI?.setAssist?.(attacker);
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

    /** True when a ground drop (sprite or meta entry) sits on a water tile. */
    _dropIsOnWater(drop) {
        if (!drop) return false;
        if (typeof Hide !== "undefined") {
            const pt = Hide.dropSamplePoint(
                drop.x ?? drop.entry?.x,
                drop.y ?? drop.entry?.y,
                this.tileSize
            );
            if (this._isWaterAt(pt.x, pt.y)) return true;
        }
        const t = drop.getBounds ? this._dropVisualTile(drop) : null;
        if (!t) return false;
        const c = this.tileCenter(t.tx, t.ty);
        return this._isWaterAt(c.x, c.y - 1);
    }

    tickSoakDrops() {
        if (typeof Hide === "undefined") return;
        // Dedicated MP: soak conversion is server-authored (snapshots).
        if (this.isNet && this.net?.connected && !this.net.isLocal) return;
        const now = this.worldMinuteIndex();
        const getItem = (id) => this.getItem(id);
        const liveDrops = this.droppedItems?.getChildren?.() || [];
        for (const chunk of Object.values(this.chunks || {})) {
            const drops = chunk.meta?.drops;
            if (!Array.isArray(drops)) continue;
            for (const entry of drops) {
                if (!entry) continue;
                const live = liveDrops.find((d) => d.active && d.entry === entry);
                const onWater = this._dropIsOnWater(live || entry);
                const prevId = entry.id;
                const { converted } = Hide.tickSoakDrop(entry, now, getItem, onWater);
                if (live) {
                    live.soakProgress = entry.soakProgress;
                    live.soakDoneAt = entry.soakDoneAt;
                    if (converted && entry.id !== prevId) {
                        const meta = getItem(entry.id);
                        if (meta) {
                            live.item = meta;
                            const iconKey = meta.key || entry.id;
                            if (iconKey && this.textures.exists(iconKey)) live.setTexture(iconKey);
                        }
                    }
                    live.syncToEntry?.();
                }
            }
        }
        if (this.tooltip?.visible) this.refreshTooltip();
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
        if (this.player?._resting) return false;
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

    tickDryingRacks() {
        if (typeof Hide === "undefined") return;
        const getItem = (id) => this.getItem(id);
        for (const chunk of Object.values(this.chunks || {})) {
            const things = chunk.meta?.things;
            if (!Array.isArray(things)) continue;
            for (const entry of things) {
                if (!entry) continue;
                const def = this.getThing(entry.id);
                if (!Hide.isDryingRack(def, entry)) continue;
                const { changed } = Hide.tickRackEntry(entry, getItem);
                if (!changed) continue;
                const live = this.findStorageByUid(entry.uid)
                    || (chunk.things?.getChildren?.() || []).find((t) =>
                        t instanceof Storage && (
                            t.entry === entry
                            || (Math.abs(t.x - entry.x) < 1.5 && Math.abs(t.y - entry.y) < 1.5)
                        )
                    );
                live?.applyVisual?.();
                if (this.storagePanel?.visible && this.storagePanel.storage?.entry === entry) {
                    this.storagePanel.refresh();
                }
                if (this.tooltip?.visible && this._tooltipTarget === live) {
                    this.refreshTooltip();
                }
            }
        }
    }

    updateClockText() {
        if (!this.clockText?.active || !this.clockText.scene) return;
        const h = Math.floor(this.gameMinutes / 60);
        const m = this.gameMinutes % 60;
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        this.clockText.setText(`Day ${this.gameDay}  ${hh}:${mm}`);
        crispUiText(this.clockText);
        const s = this.uiScale || 1;
        placeUiText(this.clockText, this.scale.width / 2, Math.round(8 * s), 0.5, 0);
    }

    /**
     * Debug: change how fast the world clock ticks.
     * @param {Number} mult  1 = normal (1 game min / real sec), 60 ≈ 1 game hour/sec, 0 = pause
     */
    setTickSpeed(mult, opts = {}) {
        const m = Number(mult);
        if (!Number.isFinite(m) || m < 0) return this.tickSpeed;
        if (!opts.fromRest) this._baseTickSpeed = m;
        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this.tickSpeed = m;
            return this.tickSpeed;
        }
        const speed = opts.fromRest ? m : this._restEffectiveSpeed(this._baseTickSpeed);
        this.tickSpeed = speed;
        const localClock = this.net?.isLocal
            ? (this.net.world?.clock || this.net.sim?.world?.clock)
            : null;
        if (localClock) {
            localClock.baseTickSpeed = this._baseTickSpeed;
            localClock.tickSpeed = speed;
        }
        if (this.isNet) return this.tickSpeed;
        if (this._worldMinuteEvent) {
            this._worldMinuteEvent.remove(false);
            this._worldMinuteEvent = null;
        }
        if (speed > 0) {
            this._worldMinuteEvent = this.time.addEvent({
                delay: Math.max(1, 1000 / speed),
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
        for (const p of this.party || []) {
            if (p && p !== this.player && !p.isBodyDead?.()) p.hungerTick?.();
        }
        this.tickSoakDrops();
        this.tickSpoilage();
        this.tickCorpseDecay();
        this.tickCampfires();
        this.tickDryingRacks();
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
        for (const p of this.party || []) {
            if (p && p !== this.player && p.active && !p.isBodyDead?.()) {
                BodyHealing.minuteTick(p, this);
            }
        }
        for (const w of this.partySys?.wanderers || []) {
            if (w?.active && !w.isBodyDead?.()) BodyHealing.minuteTick(w, this);
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
        const { dump } = Decay.applyCarcassConversion(entry, {
            getItem,
            now,
            rng: () => Math.random(),
            makeStack: (item, qty, at) => makeWorldItemStack(item, qty, undefined, at)
        });
        for (const stack of dump) {
            const meta = getItem(stack.id);
            if (!meta) continue;
            const extras = typeof mealStackExtras === "function" ? mealStackExtras(stack) : null;
            const spoilAt = typeof spoilAtForWorld === "function"
                ? spoilAtForWorld(stack, now)
                : stack.spoilAt;
            DroppedItem.spawn(this, entry.x, entry.y, meta, stack.quantity, spoilAt, extras);
        }

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
            const pawns = (this.party && this.party.length) ? this.party : [this.player];
            for (const pawn of pawns) {
                if (!pawn || pawn.isBodyDead?.()) continue;
                const inv = pawn.inventory;
                if (Array.isArray(inv)) {
                    for (let i = 0; i < inv.length; i++) {
                        if (inv[i]) inv[i] = applyCharacterStack(inv[i]);
                    }
                }
                const eq = pawn.equipment;
                if (!eq) continue;
                for (const key of ["head", "torso", "legs", "feet"]) {
                    if (eq[key]) eq[key] = applyCharacterStack(eq[key]);
                }
                if (Array.isArray(eq.waist)) {
                    for (let i = 0; i < eq.waist.length; i++) {
                        if (eq.waist[i]) eq.waist[i] = applyCharacterStack(eq.waist[i]);
                    }
                }
            }
        }

        const liveDrops = this.droppedItems?.getChildren?.() || [];
        for (const chunk of Object.values(this.chunks || {})) {
            const drops = chunk.meta?.drops;
            if (Array.isArray(drops)) {
                for (const entry of drops) {
                    if (!entry) continue;
                    const live = liveDrops.find((d) => d.active && d.entry === entry);
                    const onWater = this._dropIsOnWater(live || entry);
                    const def = getItem(entry.id);
                    if (typeof Hide !== "undefined" && Hide.pausesDropDespawn(entry, def, onWater)) {
                        continue;
                    }
                    migrateToSpoilAt(entry, now, getItem);
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
                    const isStorage = !!(thingMeta?.storage || Array.isArray(entry.slots));
                    if (!isCamp && !isStorage) continue;

                    if (isStorage && Array.isArray(entry.slots)) {
                        const skipSpoil = typeof Hide !== "undefined"
                            && Hide.isDryingRack(thingMeta, entry);
                        if (!skipSpoil) {
                            for (let i = 0; i < entry.slots.length; i++) {
                                if (!entry.slots[i]) continue;
                                entry.slots[i] = applyWorldStack(entry.slots[i]);
                            }
                        }
                    }

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
        if (this.storagePanel?.visible) this.storagePanel.refresh();
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
                for (const s of entry.slots || []) {
                    if (!s) continue;
                    const skip = typeof Hide !== "undefined" && Hide.isDryingRack(this.getThing?.(entry.id), entry);
                    if (!skip) migrateToSpoilAt(s, now, getItem);
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
            if (typeof Hide !== "undefined") Hide.migrateStackItemId?.(stack);
            else if (stack.id === "wood_spear") stack.id = "wooden_spear";
        }
    }

    formatItemTooltip(item, quantity, spoilAt, stack = null, opts = null) {
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

            if (opts?.spoilPaused) {
                lines.push("Spoils: paused");
            } else {
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
            }
        }

        const fuelKj = Number(item.fuel?.kj ?? 0);
        if (fuelKj > 0) lines.push(`Fuel: ${fuelKj} kj`);

        if (quantity > 1) {
            const totWeight = Math.round(weight * quantity * 100) / 100;
            const parts = [];
            if (weight > 0) parts.push(`${totWeight} kg`);
            const foodKc = food ? Math.round(Number(food.kc ?? 0)) : 0;
            if (foodKc > 0) parts.push(`${foodKc * quantity} kcal`);
            if (fuelKj > 0) parts.push(`${Math.round(fuelKj * quantity * 100) / 100} kj`);
            if (parts.length) lines.push(`Stack total: ${parts.join(", ")}`);
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
        const chopLine = typeof Chop !== "undefined" ? Chop.chopPercentLine(stack) : null;
        if (chopLine) lines.push(chopLine);
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
        if (stack?.toolClass === "scraper") {
            lines.push("Click a drying rack to scrape a hide");
        }
        if (stack?.toolClass === "awl") {
            lines.push("Use with Skinworking Bench");
        }
        if (stack?.toolClass === "chopper" || (typeof Chop !== "undefined" && Chop.chopFraction(stack) > 0)) {
            lines.push("Attack trees to chop them down");
        }

        // Static tooltips only when not a custom-named meal
        if (!stack?.customName && Array.isArray(item.tooltip)) {
            const dryPct = (typeof Hide !== "undefined" && Hide.isFleshedHide(item))
                ? Hide.dryPercent(stack)
                : null;
            const soakPct = (typeof Hide !== "undefined" && Hide.isFleshedHide(item) && stack)
                ? Hide.soakPercent(stack, this.worldMinuteIndex?.() ?? null)
                : null;
            for (const line of item.tooltip) {
                if (dryPct != null && dryPct > 0 && /dry/i.test(String(line))) {
                    lines.push(`${line} (${dryPct}% dry)`);
                } else if (soakPct != null && soakPct > 0 && /water/i.test(String(line))) {
                    lines.push(`${line} (${soakPct}% soaked)`);
                } else {
                    lines.push(line);
                }
            }
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
        this._craftStationThing = null;
        this._craftPage = 0;
        this.craftContainer = this.add.container(0, 0).setVisible(false);
        this.uiLayer.add(this.craftContainer);
        this._data = [];
        this._buildCraftTakeButton();
        this.input.on("wheel", (pointer, _over, deltaX, deltaY) => {
            if (!this.craftMenuVisible) return;
            const p = pointer || this.input.activePointer;
            if (!this._pointerOverCraftMenu?.(p)) return;
            const delta = deltaY || deltaX;
            if (delta < 0) this._shiftCraftPage(-1);
            else if (delta > 0) this._shiftCraftPage(1);
        });
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

        const stationId = this._craftStationThing?.meta?.id || null;
        let recipes;
        if (stationId) {
            recipes = this.getKnownRecipes(stationId);
        } else {
            const nearbyIds = this.nearbyCraftStationIds();
            this._craftNearbySig = nearbyIds.join(",");
            recipes = this.getKnownRecipes(null);
            for (const id of nearbyIds) recipes = recipes.concat(this.getKnownRecipes(id));
        }
        const cols = 3;
        const maxRows = 4;
        const perPage = cols * maxRows;
        const pages = Math.max(1, Math.ceil(recipes.length / perPage));
        this._craftPage = Phaser.Math.Clamp(this._craftPage || 0, 0, pages - 1);
        const start = this._craftPage * perPage;
        const pageRecipes = recipes.slice(start, start + perPage);
        const rows = Math.max(1, Math.ceil(pageRecipes.length / cols) || 1);
        const gridW = cols * slotW + (cols - 1) * pad;
        const gridH = pageRecipes.length
            ? rows * slotH + (rows - 1) * pad
            : slotH;
        const pagerH = Math.round(28 * s);
        const pagerGap = Math.round(6 * s);
        const gridY = pagerH + pagerGap;
        this._craftMenuData = {
            cols, rows, gridW,
            gridH: gridY + gridH,
            slotW, slotH, pad,
            pages
        };

        this._addCraftPager(gridW, pagerH, s, this._craftPage, pages);

        for (let i = 0; i < pageRecipes.length; i++) {
            const recipe = pageRecipes[i];
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = col * (slotW + pad);
            const y = gridY + row * (slotH + pad);

            // Slot
            const slot = this.add.image(x, y, 'slot').setOrigin(0, 0).setScale(s).setInteractive({ cursor: 'pointer' });
            this.craftContainer.add(slot);

            // Icon
            const iconKey = this._craftRecipeIconKey(recipe);
            const icon = this.add.image(x + slotW / 2, y + slotH / 2, iconKey).setOrigin(0.5, 0.5).setScale(3.0 * s);
            this.craftContainer.add(icon);

            // Quantity
            const quantity = crispUiText(this.add.text(x + slotW - 4 * s, y + slotH - 4 * s, recipe.quantity > 1 ? String(recipe.quantity) : '', {
                fontSize: `${pixelUiFontSize(16, s)}px`, fontFamily: PIXEL_UI_FONT, stroke: '#000', strokeThickness: 2, align: 'right'
            }).setOrigin(1, 1).setVisible(recipe.quantity > 1));
            this.craftContainer.add(quantity);

            // Tooltip
            const tt = () => {
                const lines = [];
                lines.push(this.formatItemTooltip(this.getItem(recipe.id), recipe.quantity));
                lines.push('—');

                for (const ingredient of recipe.ingredients) {
                    const have = this.player.getNumMatchingItems(ingredient);
                    lines.push(`${this._craftIngredientLabel(ingredient)}: ${have}/${ingredient.qty}`);
                }

                if (recipe.requireThing) {
                    const thing = this.getThing(recipe.requireThing);
                    lines.push(`Requires nearby ${thing?.name || recipe.requireThing}`);
                }
                if (recipe.requireStation) {
                    const thing = this.getThing(recipe.requireStation);
                    lines.push(`Requires ${thing?.name || recipe.requireStation}`);
                }
                if (recipe.requireTool?.toolClass) {
                    lines.push(`Requires held ${this._craftToolClassLabel(recipe.requireTool.toolClass)}`);
                }

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
        this._layoutCraftTakeButton();
    }

    _shiftCraftPage(delta) {
        const pages = Math.max(1, this._craftMenuData?.pages || 1);
        const next = Phaser.Math.Clamp((this._craftPage || 0) + delta, 0, pages - 1);
        if (next === (this._craftPage || 0)) return;
        this.hideTooltip?.();
        this._craftPage = next;
        this.refreshCraftMenu();
    }

    _addCraftPager(gridW, pagerH, s, page, pages) {
        const y = pagerH / 2;
        const bw = Math.round(28 * s);
        const gap = Math.round(52 * s);
        this._addCraftNavArrow(
            gridW / 2 - gap, y, bw, pagerH, "<",
            page > 0, () => this._shiftCraftPage(-1), s
        );
        this._addCraftNavArrow(
            gridW / 2 + gap, y, bw, pagerH, ">",
            page < pages - 1, () => this._shiftCraftPage(1), s
        );
        const label = crispUiText(this.add.text(gridW / 2, y, `${page + 1} / ${pages}`, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(16, s)}px`,
            color: "#d4c4a8",
            stroke: "#000000",
            strokeThickness: Math.max(2, Math.round(2 * s))
        }).setOrigin(0.5));
        this.craftContainer.add(label);
    }

    _addCraftNavArrow(x, y, bw, bh, label, enabled, onClick, s) {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;
        const rect = this.add.rectangle(x, y, bw, bh, BG, 1)
            .setStrokeStyle(2, OUTLINE);
        const text = crispUiText(this.add.text(x, y, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${pixelUiFontSize(16, s)}px`,
            color: "#d4c4a8"
        }).setOrigin(0.5));
        this.craftContainer.add(rect);
        this.craftContainer.add(text);
        if (!enabled) {
            rect.setAlpha(0.35);
            text.setAlpha(0.35);
            return;
        }
        rect.setInteractive({ useHandCursor: true });
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
        rect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown()) return;
            pressing = true;
            paint();
        });
        rect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = pressing;
            pressing = false;
            paint();
            if (was && hovering) onClick();
        });
    }

    _craftRecipeIconKey(recipe) {
        const meta = this.getItem(recipe.id);
        if (typeof Place !== "undefined" && Place.itemIconKey) {
            const key = Place.itemIconKey(meta, (id) => this.getThing(id), (k) => this.textures.exists(k));
            if (key && this.textures.exists(key)) return key;
        }
        if (recipe.key && this.textures.exists(recipe.key)) return recipe.key;
        return "slot";
    }

    _buildCraftTakeButton() {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b;

        this._craftTakeRect = this.add.rectangle(0, 0, 78, 28, BG, 1)
            .setStrokeStyle(2, OUTLINE)
            .setInteractive({ useHandCursor: true });
        this._craftTakeText = this.add.text(0, 0, "Take", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "16px",
            color: "#d4c4a8"
        }).setOrigin(0.5);
        this._craftTakeBtn = this.add.container(0, 0, [this._craftTakeRect, this._craftTakeText])
            .setVisible(false)
            .setDepth(100);
        this._uiCam?.ignore(this._craftTakeBtn);

        this._craftTakeHovering = false;
        this._craftTakePressing = false;
        this._craftTakeBw = 78;
        this._craftTakeBh = 28;
        this._paintCraftTake = () => {
            const strokeW = 2 / (this.worldZoom || 1);
            const rect = this._craftTakeRect;
            const text = this._craftTakeText;
            if (!rect) return;
            if (this._craftTakePressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(strokeW, OUTLINE_PRESS);
            } else if (this._craftTakeHovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(strokeW, OUTLINE_HOVER);
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(strokeW, OUTLINE);
            }
            text?.setColor("#d4c4a8");
        };

        this._craftTakeRect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            if (pointer.rightButtonDown()) return;
            this._craftTakePressing = true;
            this._paintCraftTake();
        });
        this._craftTakeRect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const was = this._craftTakePressing;
            this._craftTakePressing = false;
            this._syncCraftTakeHover();
            this._paintCraftTake();
            if (was && this._craftTakeHovering) this._tryPickupCraftStation();
        });
    }

    _layoutCraftTakeButton() {
        const btn = this._craftTakeBtn;
        const station = this._craftStationThing;
        if (!btn) return;
        if (!this.craftMenuVisible || !station?.active) {
            this._craftTakeRect?.disableInteractive();
            btn.setVisible(false);
            this._craftTakeHovering = false;
            this._craftTakePressing = false;
            return;
        }
        const s = this.uiScale || 1;
        const zoom = this.worldZoom || 1;
        const ws = s / zoom;
        const bw = 78 * ws;
        const bh = 28 * ws;
        const clear = 2;
        this._craftTakeBw = bw;
        this._craftTakeBh = bh;
        this._craftTakeRect.setSize(bw, bh);
        this._craftTakeText.setResolution(zoom * (window.devicePixelRatio || 1));
        this._craftTakeText.setFontSize(`${pixelUiFontSize(16, s)}px`);
        this._craftTakeText.setScale(1 / zoom);
        this._craftTakeRect.setInteractive({ useHandCursor: true });
        if (this._craftTakeRect.input?.hitArea?.setTo) {
            this._craftTakeRect.input.hitArea.setTo(0, 0, bw, bh);
        }
        btn.setPosition(station.x, station.y + clear + bh / 2);
        btn.setVisible(true);
        this._paintCraftTake();
    }

    pointerOnCraftTake(pointer) {
        if (!this._craftTakeBtn?.visible || !this._craftTakeRect || !pointer) return false;
        const pt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return Phaser.Geom.Rectangle.Contains(this._craftTakeRect.getBounds(), pt.x, pt.y);
    }

    _syncCraftTakeHover() {
        const over = !!this.pointerOnCraftTake(this.input.activePointer);
        if (over !== this._craftTakeHovering) {
            this._craftTakeHovering = over;
            if (!over) this._craftTakePressing = false;
        }
        this._paintCraftTake?.();
    }

    _tryPickupCraftStation() {
        const station = this._craftStationThing;
        if (!station) return;
        this.tryPickupCraftStation(station);
    }

    _isRecipeMetaKey(k) {
        if (typeof Carry !== "undefined" && Carry.isRecipeMetaKey) return Carry.isRecipeMetaKey(k);
        return k === "QUANTITY" || k === "REQUIRE_THING" || k === "REQUIRE_STATION"
            || k === "CRAFT_SECONDS" || k === "REQUIRE_TOOL";
    }

    getKnownRecipes(stationId = null) {
        return this.items().filter((m) => {
            if (!m?.recipe) return false;
            const req = m.recipe.REQUIRE_STATION ? String(m.recipe.REQUIRE_STATION) : null;
            if (stationId) return req === stationId;
            return !req;
        }).map((meta) => {
            const r = meta.recipe, ingredients = [];
            let requireThing = null, requireStation = null, quantity = 1;
            let craftSeconds = 0, requireTool = null;
            for (const [k, v] of Object.entries(r)) {
                if (k === "QUANTITY") quantity = +v || 1;
                else if (k === "REQUIRE_THING") requireThing = String(v);
                else if (k === "REQUIRE_STATION") requireStation = String(v);
                else if (k === "CRAFT_SECONDS") craftSeconds = Math.max(0, Number(v) || 0);
                else if (k === "REQUIRE_TOOL") {
                    requireTool = {
                        toolClass: v?.toolClass ? String(v.toolClass) : null,
                        wear: Math.max(0, Number(v?.wear) || 0)
                    };
                } else if (this._isRecipeMetaKey(k)) continue;
                else if (v && typeof v === "object") {
                    ingredients.push({
                        id: k,
                        qty: +v.qty || 1,
                        toolClass: v.toolClass || null,
                        hideStage: v.hideStage ? String(v.hideStage) : null
                    });
                } else {
                    ingredients.push({ id: k, qty: +v || 1, toolClass: null, hideStage: null });
                }
            }
            const iconKey = (typeof Place !== "undefined" && Place.itemIconKey)
                ? Place.itemIconKey(meta, (id) => this.getThing(id), (k) => this.textures.exists(k))
                : meta.key;
            return {
                id: meta.id,
                name: meta.name,
                key: iconKey || meta.key,
                ingredients,
                quantity,
                requireThing,
                requireStation,
                craftSeconds,
                requireTool
            };
        });
    }

    /** Display name for a craft ingredient (supports knapped tip / any-hide requirements). */
    _craftIngredientLabel(ingredient) {
        if (ingredient.hideStage) {
            const stage = String(ingredient.hideStage);
            if (stage === "leather") return "Any Leather";
            const label = stage.charAt(0).toUpperCase() + stage.slice(1);
            return `Any ${label} Hide`;
        }
        if (ingredient.toolClass === "spear_tip") {
            if (ingredient.id === "flint_tool") return "Flint Spear Tip";
            if (ingredient.id === "stone_tool") return "Stone Spear Tip";
        }
        return this.getItem(ingredient.id)?.name || ingredient.id;
    }

    _craftToolClassLabel(toolClass) {
        if (toolClass === "awl") return "Awl";
        if (toolClass === "scraper") return "Scraper";
        if (toolClass === "knife") return "Knife";
        return toolClass || "tool";
    }

    _heldMatchesCraftTool(requireTool) {
        if (!requireTool?.toolClass) return true;
        const held = this.player?.getHeldItem?.();
        return !!(held && held.toolClass === requireTool.toolClass);
    }

    hasNearbyThing(id) {
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;
        for (const chunk of this._loadedChunks || []) {
            if (!chunk.isLoaded) continue;
            for (const thing of chunk.things?.getChildren?.() || []) {
                if (!thing.active || thing.meta?.id !== id) continue;
                const dx = thing.x - px;
                const dy = thing.y - py;
                if (dx * dx + dy * dy <= r2) return true;
            }
        }
        return false;
    }

    nearbyCraftStationIds() {
        const ids = [];
        const seen = new Set();
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;
        for (const chunk of this._loadedChunks || []) {
            if (!chunk.isLoaded) continue;
            for (const thing of chunk.things?.getChildren?.() || []) {
                const id = thing?.active && thing.meta?.craftStation ? thing.meta.id : null;
                if (!id || seen.has(id)) continue;
                const dx = thing.x - px;
                const dy = thing.y - py;
                if (dx * dx + dy * dy > r2) continue;
                seen.add(id);
                ids.push(id);
            }
        }
        return ids;
    }

    _findNearbyCraftStation(stationId) {
        if (!stationId) return null;
        const clicked = this._craftStationThing;
        if (clicked?.active && clicked.meta?.id === stationId && clicked.inRange?.()) {
            return clicked;
        }
        const r = this.tileSize * this.player.interactionRange;
        const r2 = r * r;
        const px = this.player.x;
        const py = this.player.y;
        for (const chunk of this._loadedChunks || []) {
            if (!chunk.isLoaded) continue;
            for (const thing of chunk.things?.getChildren?.() || []) {
                if (!thing?.active || thing.meta?.id !== stationId) continue;
                if (!thing.meta?.craftStation) continue;
                const dx = thing.x - px;
                const dy = thing.y - py;
                if (dx * dx + dy * dy <= r2) return thing;
            }
        }
        return null;
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
        if (recipe.requireStation && !this._findNearbyCraftStation(recipe.requireStation)) {
            return false;
        }
        if (recipe.requireTool && !this._heldMatchesCraftTool(recipe.requireTool)) {
            return false;
        }
        return true;
    }

    doCraft(recipe) {
        if (recipe.craftSeconds > 0) {
            const station = recipe.requireStation
                ? this._findNearbyCraftStation(recipe.requireStation)
                : this._craftStationThing;
            this.player.beginCraft?.(recipe, station);
            return;
        }
        this._finishCraft(recipe);
    }

    _finishCraft(recipe) {
        if (!this.canCraft(recipe)) return;
        // Dedicated MP: server consumes ingredients + grants/drops; YOU/snapshots update UI.
        // Do not mutate locally — that fought deferred YOU sync and spawned ghost ground piles.
        if (this.isNet && this.net?.connected && !this.net.isLocal) {
            this._netSendMove?.(true);
            this.net.sendAction({
                type: NetProtocol.Actions.CRAFT,
                id: recipe.id,
                pawnId: this.player?.pawnId
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

        const wear = Number(recipe.requireTool?.wear) || 0;
        if (wear > 0) this.player.wearHeld(wear);

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
        this.craft.on('pointerout', () => this.craft.setTexture(
            this.craftMenuVisible ? 'craft_open' : 'craft'
        ));
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
            this._releasePressButton('_helpPressed', this.help, 'help');
        });
    }

    /** Clear a momentary press texture. */
    _releasePressButton(flagName, image, key) {
        if (!this[flagName] || !image) return;
        this[flagName] = false;
        const p = this.input.activePointer;
        const over = Phaser.Geom.Rectangle.Contains(image.getBounds(), p.x, p.y);
        const hoverKey = `${key}_hover`;
        image.setTexture(over ? hoverKey : key);
    }

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
    }

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
        const leader = this.leader || this.player;
        this.partySys.leaderDead = true;
        this.partySys.clearPvpAggro?.();
        this._deathPos = { x: leader.x, y: leader.y };
        leader._tendChannel = null;
        leader._skinChannel = null;
        leader._eatChannel = null;
        if (this.player === leader) this.hideChannelBar?.();
        this.corpsePanel?.close?.(true);
        const dedicated = !!(this.isNet && this.net?.connected && !this.net.isLocal);
        const spawnCorpse = opts.spawnCorpse !== false;
        // Dedicated: spawn a pending local corpse with a shared id so you can
        // see/loot it immediately; server adopts that id on DIE.
        const deathCorpse = spawnCorpse
            ? leader.createDeathCorpse({ spawn: true })
            : leader.createDeathCorpse({ spawn: false });
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
                equipment: leader.equipment,
                dead: true,
                leaderDead: true
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
    }

    layoutDeathOverlay() {
        if (!this.deathOverlay) return;
        const s = this.uiScale || 1;
        this.deathOverlay.setPosition(this.scale.width / 2, this.scale.height / 2);
        this.deathTitle.setFontSize(pixelUiFontSize(32, s));
        this.deathTitle.setWordWrapWidth(Math.round(380 * s));
        this.deathTitle.setAlign("center");
        this.deathRespawn.setFontSize(pixelUiFontSize(16, s));
        this.deathRespawnHere.setFontSize(pixelUiFontSize(16, s));
        this.deathBg.setSize(420 * s, 220 * s);
    }

    /** Put pawns back on the continuous physics pose before the next step. */
    restorePlayerPhysicsPos() {
        const restore = (p) => {
            if (!p?.active || p._physX == null) return;
            if (p.x !== p._physX || p.y !== p._physY) p.setPosition(p._physX, p._physY);
        };
        for (const p of this.party || []) restore(p);
        if (this.player && !(this.party || []).includes(this.player)) restore(this.player);
        for (const w of this.partySys?.wanderers || []) restore(w);
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
        const snap = (p) => {
            if (!p?.active) return;
            p._physX = p.x;
            p._physY = p.y;
            const x = Math.round(p.x * z) / z;
            const y = Math.round(p.y * z) / z;
            if (p.x !== x || p.y !== y) p.setPosition(x, y);
            p.syncFxRoot?.();
        };
        for (const p of this.party || []) snap(p);
        if (!(this.party || []).includes(player)) snap(player);
        for (const w of this.partySys?.wanderers || []) snap(w);
        const c = typeof player.bodyCenter === "function"
            ? player.bodyCenter()
            : { x: player.x, y: player.y };
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
        const leader = this.leader || this.player;
        leader.respawnFresh(x, y);
        if (this.partySys) this.partySys.leaderDead = false;
        if (this.player !== leader) this.partySys?.switchControl?.(leader, { silentNet: true });
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
        if (this.storagePanel?.visible) this.storagePanel.close();
        if (this.leanToPanel?.visible) this.leanToPanel.close();
        if (this.combatLog?.composing) this.combatLog.closeChat(false);
    }

    _anyGameplayMenuOpen() {
        return !!(
            this.craftMenuVisible ||
            this.equipmentPanel?.visible ||
            this.healthPanel?.visible ||
            this.corpsePanel?.visible ||
            this.campfirePanel?.visible ||
            this.storagePanel?.visible ||
            this.leanToPanel?.visible
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
        const text = crispUiText(this.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "24px",
            color: "#d4c4a8"
        }).setOrigin(0.5));
        // Same box as title-screen Singleplayer / Multiplayer
        const bw = 240;
        const bh = 52;
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
            this.anims?.pauseAll?.();
        }

        const w = this.scale.width;
        const h = this.scale.height;
        const dim = this.add.rectangle(w / 2, h / 2, w + 4, h + 4, 0x000000, 0.55)
            .setInteractive();
        const title = crispUiText(this.add.text(w / 2, h * 0.36,
            this._isSingleplayerSession() ? "Paused" : "Menu", {
                fontFamily: PIXEL_UI_FONT,
                fontSize: "32px",
                color: "#e8dcc8"
            }).setOrigin(0.5));
        const quitLabel = this._isSingleplayerSession() ? "Save and Quit" : "Leave Game";
        const y0 = h * 0.46;
        const gap = 60;
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
            this.anims?.resumeAll?.();
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
        const gap = 60;
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
            try { this.anims?.pauseAll?.(); } catch (_) {}
        }
        try { this.cameras?.main?.setBackgroundColor?.("#1a1510"); } catch (_) {}

        const w = this.scale.width;
        const h = this.scale.height;
        const bg = this.add.rectangle(w / 2, h / 2, w + 4, h + 4, 0x1a1510, 1)
            .setInteractive();
        const text = crispUiText(this.add.text(w / 2, h / 2, "Saving...", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: "32px",
            color: "#e8dcc8"
        }).setOrigin(0.5));
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
        this._netDisconnectHandled = true;
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
        this._craftStationThing = null;
        this.craftContainer.setVisible(false);
        this._layoutCraftTakeButton();
        const p = this.input.activePointer;
        const hovering = Phaser.Geom.Rectangle.Contains(this.craft.getBounds(), p.x, p.y);
        this.craft.setTexture(hovering ? 'craft_hover' : 'craft');
        // Dedicated: apply any YOU gear that arrived while craft UI was open
        this._flushPendingYouGear?.();
    }

    toggleCraftMenu() {
        if (this.knappingPanel?.visible) return;
        if (this.craftMenuVisible && !this._craftStationThing) {
            this.closeCraftMenu();
            return;
        }
        // Station menu open → switch to hand list
        if (this.equipmentPanel?.visible) this.equipmentPanel.close();
        if (this.healthPanel?.visible) this.healthPanel.close();
        this._craftStationThing = null;
        this._craftPage = 0;
        this.craftMenuVisible = true;
        this.refreshCraftMenu();
        this.positionCraftMenu();
        this.craftContainer.setVisible(true);
        this.craft.setTexture('craft_open');
    }

    toggleCraftStationMenu(thing) {
        if (!thing || this.knappingPanel?.visible) return;
        if (this.player?._resting) return;
        if (this.craftMenuVisible && this._craftStationThing === thing) {
            this.closeCraftMenu();
            return;
        }
        if (this.equipmentPanel?.visible) this.equipmentPanel.close();
        if (this.healthPanel?.visible) this.healthPanel.close();
        this._craftStationThing = thing;
        this._craftPage = 0;
        this.craftMenuVisible = true;
        this.refreshCraftMenu();
        this.positionCraftMenu();
        this.craftContainer.setVisible(true);
        this.craft.setTexture('craft_open');
    }

    _updateCraftStationMenu() {
        if (!this.craftMenuVisible) return;
        if (this._craftStationThing) {
            const station = this._craftStationThing;
            if (!station.active || !station.inRange?.()) {
                this.closeCraftMenu();
                return;
            }
            this._syncCraftTakeHover();
            return;
        }
        const sig = this.nearbyCraftStationIds().join(",");
        if (sig !== this._craftNearbySig) {
            this._craftNearbySig = sig;
            this.refreshCraftMenu();
        }
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
        if (this.storagePanel?.visible) this.storagePanel.close();
        if (this.leanToPanel?.visible) this.leanToPanel.close();
        if (this.craftMenuVisible) this.closeCraftMenu();
        if (this.healthPanel?.isInspecting?.()) this.healthPanel.close();

        for (const chunk of Object.values(this.chunks || {})) chunk.unload();
        this.chunks = {};
        this._loadedChunks = [];
        this._thingCells = new Map();
        if (typeof Structures !== "undefined") Structures.clearPending?.();
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
        this.markLightDirty?.();
        return n;
    }

    chunkPx() {
        return this.chunkSize * this.tileSize;
    }

    allocChunkRt(wx, wy) {
        const w = this.chunkPx();
        this._chunkRtPool = this._chunkRtPool || [];
        let rt = null;
        while (this._chunkRtPool.length) {
            const cand = this._chunkRtPool.pop();
            if (cand?.active && cand.scene) {
                rt = cand;
                break;
            }
            try { cand?.destroy?.(); } catch (_) {}
        }
        if (!rt) {
            rt = this.make.renderTexture({
                x: wx,
                y: wy,
                width: w,
                height: w,
                add: false
            }).setOrigin(0).setDepth(0).setVisible(false);
        } else {
            rt.setPosition(wx, wy).setVisible(false);
            rt.clear();
        }
        return rt;
    }

    recycleChunkRt(rt) {
        if (!rt) return;
        this.groundLayer?.remove?.(rt);
        rt.setVisible(false);
        try { rt.clear(); } catch (_) {}
        this._chunkRtPool = this._chunkRtPool || [];
        this._chunkRtPool.push(rt);
    }

    _trackLoadedChunk(chunk) {
        if (!chunk) return;
        const list = this._loadedChunks || (this._loadedChunks = []);
        if (list.indexOf(chunk) < 0) list.push(chunk);
    }

    _untrackLoadedChunk(chunk) {
        const list = this._loadedChunks;
        if (!list || !chunk) return;
        const i = list.indexOf(chunk);
        if (i >= 0) list.splice(i, 1);
    }

    enqueueChunkPaint(chunk) {
        return new Promise((resolve) => {
            this._chunkPaintQ = this._chunkPaintQ || [];
            this._chunkPaintQ.push({ chunk, resolve });
        });
    }

    dropChunkPaint(chunk) {
        const q = this._chunkPaintQ;
        if (!q?.length) return;
        this._chunkPaintQ = q.filter((job) => {
            if (job.chunk !== chunk) return true;
            job.resolve();
            return false;
        });
    }

    _pumpChunkPaint() {
        if (this._paintBusy) return;
        const q = this._chunkPaintQ;
        if (!q?.length) return;
        while (q.length) {
            const job = q.shift();
            const chunk = job?.chunk;
            if (!chunk?.isLoaded || chunk.scene !== this) {
                job.resolve();
                continue;
            }
            this._paintBusy = true;
            Promise.resolve(chunk._paintGround())
                .then(() => job.resolve())
                .catch(() => job.resolve())
                .then(() => {
                    this._paintBusy = false;
                });
            break;
        }
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
        if (this._leavingGame || !this.uiLayer) return;
        const s = this.uiScale || 1;

        if (this._uiCam) this._uiCam.setSize(this.scale.width, this.scale.height);

        this.drawBars();

        if (this.hotbar) this.hotbar.layout();

        if (this.tooltipText) {
            this._tooltipPadding = Math.round(6 * s);
            this.tooltipText.setFontSize(`${pixelUiFontSize(16, s)}px`);
            this.tooltipText.setPadding(this._tooltipPadding);
            this.tooltipText.setStroke('#000000', Math.max(2, Math.round(2 * s)));
        }

        const pad = Math.round(8 * s);
        const cx = this.scale.width / 2;
        if (this.clockText) {
            const fs = pixelUiFontSize(16, s);
            crispUiText(this.clockText);
            this.clockText.setFontSize(`${fs}px`);
            this.clockText.setStroke("#000000", Math.max(2, Math.round(fs / 8)));
            placeUiText(this.clockText, cx, pad, 0.5, 0);
        }
        if (this.fpsText) {
            const fs = pixelUiFontSize(16, s);
            const clockBottom = this.clockText
                ? pad + Math.round(this.clockText.height || fs)
                : pad;
            crispUiText(this.fpsText);
            this.fpsText
                .setFontSize(`${fs}px`)
                .setStroke("#000000", Math.max(2, Math.round(fs / 8)));
            placeUiText(this.fpsText, cx, clockBottom + Math.round(2 * s), 0.5, 0);
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
            if (this.help) {
                this.help.setScale(3 * s).setPosition(
                    this.scale.width - 32 * s,
                    this.scale.height - 32 * s
                );
            }
            this.partyPanel?.layout?.();
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
        if (this.storagePanel?.visible) this.storagePanel.layout();
        if (this.leanToPanel?.visible) this.leanToPanel.layout();
        if (this.knappingPanel?.visible) this.knappingPanel.layout();
        this._layoutPauseMenu();

        this.player?.applyChatBubbleScale?.();
        for (const p of this.party || []) {
            if (p && p !== this.player) {
                p.applyNameLabelScale?.();
                p.applyChatBubbleScale?.();
            }
        }
        for (const w of this.partySys?.wanderers || []) {
            w.applyNameLabelScale?.();
            w.applyChatBubbleScale?.();
        }
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
        if (!this._waterSprite?.active || !this._waterSprite.scene) return;
        this._waterSprite.setFrame(this._waterFrame++);
        if (this._waterFrame > 3) this._waterFrame = 0;
    }

    update(time, delta) {
        super.update(time, delta);

        this._handleEscapeKey();
        if (this._leavingGame) {
            this._hidePlaceGhost();
            this.combatLog?.update?.();
            return;
        }
        // SP pause freezes the sim; dedicated MP menu must keep receiving world updates
        if (this._gamePaused && this._isSingleplayerSession()) {
            this._hidePlaceGhost();
            this.combatLog?.update?.();
            return;
        }

        // Calculate player chunk (union of all party pawns so scouts stay simulated)
        const anchors = (this.party && this.party.length)
            ? this.party.filter((p) => p?.active)
            : (this.player ? [this.player] : []);
        const snapped = anchors.map((p) => ({
            x: Math.floor(p.posX() / this.chunkSize),
            y: Math.floor(p.posY() / this.chunkSize)
        }));
        if (!snapped.length && this.player) {
            snapped.push({
                x: Math.floor(this.player.posX() / this.chunkSize),
                y: Math.floor(this.player.posY() / this.chunkSize)
            });
        }
        const loadR = this.renderDistance || this.cullDistance || this.genDistance;
        // One-chunk hysteresis only. Unloading at cullDistance (render+2) kept a
        // 15×15 sprite window after any walk (profiler: nLoaded 40 → 241, stayed ~206 on return).
        const unloadR = loadR + 1;
        const genR = this.genDistance || unloadR;
        // Sprite/physics streaming follows the camera pawn. The whole party as
        // load anchors left every explored chunk loaded while companions lagged.
        const stream = [];
        if (this.player?.active) {
            stream.push({
                x: Math.floor(this.player.posX() / this.chunkSize),
                y: Math.floor(this.player.posY() / this.chunkSize)
            });
        } else if (snapped.length) {
            stream.push(snapped[0]);
        }
        for (const a of snapped) {
            for (let x = a.x - genR; x <= a.x + genR; x++) {
                for (let y = a.y - genR; y <= a.y + genR; y++) {
                    const key = this.getKey(x, y);
                    if (!this.chunks[key]) {
                        if (this.isNet) continue;
                        this.chunks[key] = new Chunk(this, x, y);
                    }
                }
            }
        }

        const chunkDist = (chunk) => {
            let min = Infinity;
            for (let i = 0; i < stream.length; i++) {
                const a = stream[i];
                const d = Math.max(Math.abs(a.x - chunk.x), Math.abs(a.y - chunk.y));
                if (d < min) min = d;
            }
            return min;
        };

        const loaded = this._loadedChunks || (this._loadedChunks = []);
        let startedUnloads = 0;
        for (let i = loaded.length - 1; i >= 0; i--) {
            const chunk = loaded[i];
            if (!chunk?.isLoaded) {
                loaded.splice(i, 1);
                continue;
            }
            if (chunkDist(chunk) > unloadR) {
                if (startedUnloads >= 1) continue;
                startedUnloads++;
                chunk.unload();
            }
        }

        let best = null;
        let bestD = Infinity;
        for (const a of stream) {
            for (let x = a.x - loadR; x <= a.x + loadR; x++) {
                for (let y = a.y - loadR; y <= a.y + loadR; y++) {
                    const chunk = this.chunks[this.getKey(x, y)];
                    if (!chunk || chunk.isLoaded) continue;
                    const d = Math.max(Math.abs(a.x - x), Math.abs(a.y - y));
                    if (d < bestD) {
                        bestD = d;
                        best = chunk;
                    }
                }
            }
        }
        if (best) best.load();
        this._pumpChunkPaint();

        if (!this._spawnSignPlaced || !this._playerSpawnPlaced) this.ensureSpawnSign();

        // Process input (menus / hotbar / chat blocked while knapping — R/Esc stay in panel)
        const chatting = !!this.combatLog?.isComposing?.();
        const knapping = !!this.knappingPanel?.visible;
        if (!chatting && !knapping && !this._gamePaused) {
            const ctrl = !!this.keys?.CTRL?.isDown;
            if (!ctrl) {
                if (this.key1.isDown && this.hotbar.size >= 1) this.hotbar.changeSlot(0);
                if (this.key2.isDown && this.hotbar.size >= 2) this.hotbar.changeSlot(1);
                if (this.key3.isDown && this.hotbar.size >= 3) this.hotbar.changeSlot(2);
                if (this.key4.isDown && this.hotbar.size >= 4) this.hotbar.changeSlot(3);
                if (this.key5.isDown && this.hotbar.size >= 5) this.hotbar.changeSlot(4);
                if (this.key6.isDown && this.hotbar.size >= 6) this.hotbar.changeSlot(5);
            }
            if (this.key7.isDown && this.hotbar.size >= 7) this.hotbar.changeSlot(6);
            if (this.key8.isDown && this.hotbar.size >= 8) this.hotbar.changeSlot(7);
            if (this.key9.isDown && this.hotbar.size >= 9) this.hotbar.changeSlot(8);
            if (this.key0.isDown && this.hotbar.size >= 10) this.hotbar.changeSlot(9);
            if (Phaser.Input.Keyboard.JustDown(this.keyC)) this.toggleCraftMenu();
            if (Phaser.Input.Keyboard.JustDown(this.keyE)) this.toggleEquipmentMenu();
            if (Phaser.Input.Keyboard.JustDown(this.keyH)) this.toggleHealthMenu();
            this._handlePlaceRotate();
            // Chat open is handled by CombatLog's window keydown listener (avoids
            // JustDown(T) dying after keyboard.enabled toggles miss the T keyup).
        }

        // Update party (controlled + companions + wanderers)
        this.knappingPanel?.update?.();
        if (this.partySys) this.partySys.update(time, delta);
        else this.player.update(time, delta);
        this.updatePlaceGhost();
        if (this.isNet) {
            this._netSendMove();
            this._netUpdateRemotes(delta);
            this._netUpdateMobs(delta);
        }
        this._tickSleepZzz?.(delta);
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
        this.storagePanel?.update();
        this.leanToPanel?.update();
        this._updateCraftStationMenu();
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