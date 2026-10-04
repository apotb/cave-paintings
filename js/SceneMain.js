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
        this._worldSimFrozen = false;
        this._chatFadeHold = null;
        this._worldBooting = !!(this.net?.isLocal || this.localWorldId);
        this._generatingUi = null;
        this._generatingLabelTimer = null;
        this._pauseUi = null;
        this._pausePage = "root";
        this._savingUi = null;
        // 0 = Auto; 1..N = fixed integer scale (N from resolution)
        this.guiScalePref = typeof Settings !== "undefined" ? Settings.loadGuiScale() : 0;
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
        this.clayFormingPanel = null;
        this.deathOverlay = null;
        this.player = null;
        this.leader = null;
        this.party = [];
        this.settlers = [];
        this.partySys = null;
        this.partyPanel = null;
        this.settlementSys = null;
        this.settlementPanel = null;
        this.researchTreePanel = null;
        this.billsPanel = null;
        this.storageFilterPanel = null;
        this.fuelFilterPanel = null;
        this.pigmentFilterPanel = null;
        this.paintingCirclePanel = null;
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
        this.craftContainer = null;
        this.craftMenuVisible = false;
        this._craftStationThing = null;
        this._craftFromStation = false;
        this._craftSettleUi = null;
        this._craftBillUi = null;
        this._craftTakeBtn = null;
        this._craftTakeRect = null;
        this._craftTakeText = null;
        this._craftMenuSig = null;
        this._craftMenuData = null;
        this.fpsText = this.locXText = this.locYText = null;
        this._waterSprite = null;
        // Scene instance is reused. Stale tile coords would skip the first
        // backdrop move, so water stays off-camera until the player changes tiles.
        this._oldWaterX = null;
        this._oldWaterY = null;
        this.groundLayer = this.mainLayer = this.uiLayer = this.veilLayer = this.worldHudLayer = null;
        this._hoverTarget = null;
        this._tooltipTarget = null;
        this._things = null;
        this.mobs = null;
        this.damageables = null;
        this._chunkRtPool = null;
        this._chunkPaintQ = null;
        this._paintBusy = false;
        // Phaser never auto-calls Scene.shutdown(); bind it so pauseAll is resumed.
        this.events.off("shutdown", this.shutdown, this);
        this.events.once("shutdown", this.shutdown, this);
    }

    /** True when SimWorld owns gameplay (LocalSim host or dedicated MP). */
    simAuth() {
        return !!(this.isNet && this.net && this.net.connected);
    }

    create() {
        hookPixelTextureClamp(this);
        this._bindFullscreenWatch();
        // pauseAll is global. Save-and-quit used to leave every Animation paused,
        // so the 2nd world join froze campfires, walks, and anything else that plays.
        try { this.anims?.resumeAll?.(); } catch (_) {}
        try { this.sound?.stopByKey?.("title"); } catch (_) {}
        if (typeof GameMusic !== "undefined") GameMusic.play(this, "forest", { fade: true });
        this.input.mouse.disableContextMenu();

        // Shared world seed from listen server (identical terrain for all clients)
        if (this.isNet && this.welcome?.seed != null) {
            worldSeed = this.welcome.seed;
            noise.seed(worldSeed);
        }

        // Layers
        this.groundLayer = this.add.layer().setDepth(0);
        this.mainLayer = this.add.layer().setDepth(1);
        this.uiLayer = this.add.layer().setDepth(2);
        // HUD tips sit on their own list so panel stencil masks cannot wash them out.
        this.tooltipLayer = this.add.layer().setDepth(40000);
        // Night overlay between the world and party HUD. UI cam ignores these
        // so world-locked HUD is not also drawn unzoomed at raw world coordinates.
        this.veilLayer = this.add.layer().setDepth(50);
        this.worldHudLayer = this.add.layer().setDepth(200);

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

        // Finalized DataStore is authority. The Phaser cache is a published view.
        if (typeof Content !== "undefined") {
            Content.publishToScene(this);
        }
        resolveCraftedWeights(this.items());
        resolveCraftedFuel(this.items());

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
        this._restSpeedElapsedMs = 0;
        this._worldMinuteEvent = null;

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
        let cameras = [this.groundLayer, this.mainLayer, this.veilLayer, this.worldHudLayer];
        if (this.physics.world.debug) cameras.push(this.physics.world.debugGraphic);
        this._uiCam.ignore(cameras);
        // Camera.ignore(Layer) only tags children that exist *now*. Layers are
        // empty here, so later world sprites still hit-test on the UI camera at
        // their world x/y (as screen pixels). Stamp the Layer itself so willRender
        // rejects them regardless of add order — otherwise a lean-to you're in
        // steals HUD clicks/tooltips.
        this.uiLayer.cameraFilter |= this.cameras.main.id;
        if (this.tooltipLayer) this.tooltipLayer.cameraFilter |= this.cameras.main.id;
        for (const layer of cameras) {
            if (layer && layer !== this.physics.world.debugGraphic) {
                layer.cameraFilter |= this._uiCam.id;
            }
        }
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
        this.settlementSys = new SettlementSystem(this);
        this.settlers = [];
        this.equipmentPanel = new EquipmentPanel(this);
        this.campfirePanel = new CampfirePanel(this);
        this.leanToPanel = new LeanToPanel(this);
        this.storagePanel = new StoragePanel(this);
        this.corpsePanel = new CorpsePanel(this);
        this.healthPanel = new HealthPanel(this);
        this.knappingPanel = new KnappingPanel(this);
        this.clayFormingPanel = new ClayFormingPanel(this);
        this.createDeathOverlay();
        this.partyPanel = new PartyPanel(this);
        this.settlementPanel = new SettlementPanel(this);
        this.researchTreePanel = new ResearchTreePanel(this);
        this.billsPanel = new BillsPanel(this);
        this.storageFilterPanel = new StorageFilterPanel(this);
        this.fuelFilterPanel = new FuelFilterPanel(this);
        this.pigmentFilterPanel = new PigmentFilterPanel(this);
        this.paintingCirclePanel = new PaintingCirclePanel(this);
        this.applyUiScale();
        if (this._worldBooting) this._showGeneratingOverlay();

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
        // Player pose is final now. Place the backdrop before the first paint
        // so water tiles are not black while the world comes up.
        this._syncWaterSprite();
        this._playReady = true;
    }

    shutdown() {
        this._playReady = false;
        try { this._fullscreenWatchOff?.(); } catch (_) {}
        this._fullscreenWatchOff = null;
        this._unbindSceneListeners();
        if (typeof GameMusic !== "undefined") GameMusic.stop();
        this._teardownCharacterAutosave?.();
        this._hideGeneratingOverlay?.();
        this._worldBooting = false;
        this._unbindNetClose();
        if (this._gamePaused || this._worldSimFrozen) {
            try { this.net?.setPaused?.(false); } catch (_) {}
            try { this.physics?.world?.resume?.(); } catch (_) {}
            try { this.anims?.resumeAll?.(); } catch (_) {}
            this._gamePaused = false;
            this._worldSimFrozen = false;
        }
        try { this._destroyPauseUi?.(); } catch (_) {}
        try { this.input?.setDefaultCursor?.("default"); } catch (_) {}
        try {
            const canvas = this.game?.canvas;
            if (canvas) canvas.style.cursor = "default";
        } catch (_) {}
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

    /** Soft cap — merging nearby drips keeps count low in normal fights. */
    static BLOOD_STAINS_MAX = 180;
    /** Merge into an existing pool if within this many pixels. */
    static BLOOD_MERGE_DIST = 6;
    static BLOOD_RADIUS_MIN = 0.9;
    static BLOOD_RADIUS_MAX = 5;
    /** Radius added when a drip merges into a pool. */
    static BLOOD_MERGE_GROW = 0.4;
    static BLOOD_LIFE_MINUTES = 1440; // 1 game day

    update(time, delta) {
        super.update(time, delta);

        this._handleEscapeKey();
        if (this._leavingGame) {
            this._hidePlaceGhost();
            this.combatLog?.update?.();
            return;
        }
        if (this._worldBooting) {
            this._hidePlaceGhost();
            this._syncWaterSprite();
            this._pumpChunkPaint();
            return;
        }
        // SP pause / research freeze freeze the sim; dedicated MP menu must keep receiving world updates
        if ((this._gamePaused || this._worldSimFrozen) && this._isSingleplayerSession()) {
            this._hidePlaceGhost();
            this.combatLog?.update?.();
            if (!this._gamePaused && this.researchTreePanel?.visible) {
                this.researchTreePanel.refresh();
            }
            return;
        }

        // Camera pawn chunk. Companions no longer stream a second neighborhood.
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
        // Camera-only streaming: keep a 2-chunk unload buffer so walking does
        // not churn sprites every time you cross a chunk edge.
        const unloadR = this.cullDistance || loadR + 2;
        const genR = this.genDistance || unloadR;
        // Camera pawn plus nearby party (not map-split members). Anchoring the
        // whole party loaded every explored chunk while companions lagged.
        const stream = [];
        const ts = this.tileSize || 16;
        const pushAnchor = (p) => {
            if (!p?.active || typeof p.posX !== "function") return;
            stream.push({
                x: Math.floor(p.posX() / this.chunkSize),
                y: Math.floor(p.posY() / this.chunkSize)
            });
        };
        pushAnchor(this.player);
        for (const p of this.party || []) {
            if (!p || p === this.player) continue;
            if (typeof Party !== "undefined" && Party.beyondFollowLeash?.(p, this.player, ts)) {
                continue;
            }
            pushAnchor(p);
        }
        if (!stream.length && snapped.length) stream.push(snapped[0]);
        for (const a of stream) {
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

        const pending = [];
        for (const a of stream) {
            for (let x = a.x - loadR; x <= a.x + loadR; x++) {
                for (let y = a.y - loadR; y <= a.y + loadR; y++) {
                    const chunk = this.chunks[this.getKey(x, y)];
                    if (!chunk || chunk.isLoaded) continue;
                    const d = Math.max(Math.abs(a.x - x), Math.abs(a.y - y));
                    pending.push({ chunk, d });
                }
            }
        }
        pending.sort((a, b) => a.d - b.d);
        const budget = Math.max(1, Math.min(32, this._chunkLoadBurst || 8));
        this._chunkLoadBurst = 0;
        for (let i = 0; i < pending.length && i < budget; i++) pending[i].chunk.load();
        this._pumpChunkPaint();

        if (!this._worldBooting && (!this._spawnSignPlaced || !this._playerSpawnPlaced)) this.ensureSpawnSign();

        // Process input (menus / hotbar / chat blocked while knapping — R/Esc stay in panel)
        const chatting = !!this.combatLog?.isComposing?.();
        const knapping = this._sculptUiOpen();
        const naming = isHudTextOpen(this);
        const researchOpen = !!this.researchTreePanel?.visible;
        if (!chatting && !knapping && !naming && !researchOpen && !this._gamePaused) {
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
        this.clayFormingPanel?.update?.();
        if (this.partySys) this.partySys.update(time, delta);
        else this.player.update(time, delta);
        this.settlementSys?.update?.(time, delta);
        if (this.researchTreePanel?.visible) this.researchTreePanel.refresh();
        this.updatePlaceGhost();
        if (this.isNet) {
            if (this.net?.isLocal && !this._worldBooting) this.net.tickFromScene?.(delta);
            this._netSendMove();
            this._netUpdateRemotes(delta);
            this._netUpdateMobs(delta);
        }
        this._tickSleepZzz?.(delta);
        this._tickPaintFx?.(delta);
        this.combatLog?.update?.();
        this.updateFpsMeter?.(delta);
        this.updateLocationDebug?.();
        // In case a YOU arrived while knapping/craft was open and close missed a flush
        this._flushPendingYouGear?.();

        const drops = this.droppedItems.getChildren();
        for (let i = drops.length - 1; i >= 0; i--) {
            const drop = drops[i];
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
        this.paintingCirclePanel?.update();
        this._updateCraftStationMenu();
        this.corpsePanel?.update();
        this.updateLightVeil();
        this._syncWaterSprite();
    }
}

(function () {
    const sceneMixins = [
        SceneMainSession,
        SceneMainNetActors,
        SceneMainNetProps,
        SceneMainNetEvents,
        SceneMainNetStations,
        SceneMainHud,
        SceneMainTooltip,
        SceneMainWorld,
        SceneMainRest,
        SceneMainCraft,
        SceneMainPause,
        SceneMainChunks
    ];
    for (let mixinIndex = 0; mixinIndex < sceneMixins.length; mixinIndex++) {
        const methods = sceneMixins[mixinIndex];
        if (!methods) throw new Error("SceneMain mixin missing at index " + mixinIndex);
        for (const name of Object.keys(methods)) {
            if (name === "constructor" || Object.prototype.hasOwnProperty.call(SceneMain.prototype, name)) {
                throw new Error("SceneMain method already defined: " + name);
            }
            Object.defineProperty(SceneMain.prototype, name, {
                value: methods[name],
                writable: true,
                configurable: true,
                enumerable: false
            });
        }
    }
})();
