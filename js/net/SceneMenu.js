/**
 * Title menu — Singleplayer / Multiplayer with client-owned characters (IndexedDB).
 */
const TITLE_CAVE_STAMPS = ["deer", "hand", "hide", "spear", "stick"];

class SceneMenu extends Phaser.Scene {
    constructor() {
        super({ key: "SceneMenu" });
    }

    init(data) {
        this._openDisconnected = !!(data && data.disconnected);
    }

    preload() {
        if (typeof PlayerLook !== "undefined") PlayerLook.loadParts(this);
        if (!this.textures.exists("menu-palm")) {
            this.load.image("menu-palm", "assets/things/palm_tree.png");
        }
        if (!this.textures.exists("ui-dice")) {
            this.load.image("ui-dice", "assets/ui/dice.png");
        }
        if (!this.textures.exists("menu-campfire")) {
            this.load.spritesheet("menu-campfire", "assets/things/campfire.png", {
                frameWidth: 16,
                frameHeight: 16
            });
        }
        for (const id of TITLE_CAVE_STAMPS) {
            const key = `title-${id}`;
            if (!this.textures.exists(key)) {
                this.load.image(key, `assets/ui/title/${id}.png`);
            }
        }
        if (!this.cache.audio.exists("title")) {
            this.load.audio("title", "assets/audio/title.ogg");
        }
    }

    create() {
        try { this.anims?.resumeAll?.(); } catch (_) {}
        // SceneMain's hover sets the game-wide default cursor to pointer. That
        // sticks across scene.start, so Leave left the title in the hand cursor.
        try { this.input?.setDefaultCursor?.("default"); } catch (_) {}
        try {
            const canvas = this.game?.canvas;
            if (canvas) canvas.style.cursor = "default";
        } catch (_) {}
        this.cameras.main.setBackgroundColor("#1a1510");
        this.cameras.main.setRoundPixels(false);
        hookPixelTextureClamp(this);
        this._dom = [];
        this._phase = "root";
        this._backAction = null;
        this._selectedCharacter = null;
        this._mode = null; // "sp" | "mp"
        this._mpHost = null;
        this._mpPassword = "";
        this._charNext = null;
        this._createFaceIdx = 0;
        this._armedDeleteId = null;
        this._armedDeleteBtn = null;
        this._armedDeleteTimer = null;
        this._mpProbe = null;
        this._mpJoinNet = null;
        this._mpConnectGen = 0;
        this._startingSp = false;
        this._ensurePlayerAnims();
        // Don't let the canvas steal tab/focus from HTML fields
        if (this.game?.canvas) this.game.canvas.tabIndex = -1;
        if (this._onMenuKeydown) {
            document.removeEventListener("keydown", this._onMenuKeydown, true);
        }
        this._onMenuKeydown = (e) => this._handleMenuEscape(e);
        document.addEventListener("keydown", this._onMenuKeydown, true);
        if (this._onResize) this.scale.off("resize", this._onResize);
        this._onResize = () => {
            if (!this.sys?.isActive?.()) return;
            if (this._resizeTimer) clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => this._relayout(), 40);
        };
        this.scale.on("resize", this._onResize);
        if (this._openDisconnected) this._phase = "disconnected";
        this._initCavePaintings();
        this._initCaveFire();
        this._initMenuCampfire();
        this._startTitleMusic();
        // Phaser emits 'shutdown' but does not call Scene.shutdown() by itself.
        this.events.off("shutdown", this.shutdown, this);
        this.events.once("shutdown", this.shutdown, this);
        // Wait for yoster — first paint otherwise falls back to Arial
        this._bootRoot();
    }

    update(_time, delta) {
        this._tickCavePaintings(delta);
        this._tickCaveFire();
    }

    async _ensurePrimaryFont() {
        if (this._primaryFontReady) return;
        if (typeof document === "undefined" || !document.fonts?.load) {
            this._primaryFontReady = true;
            return;
        }
        try {
            await document.fonts.load('32px "PrimaryFont"');
            await document.fonts.ready;
        } catch (_) {}
        this._primaryFontReady = true;
    }

    async _bootRoot() {
        await this._ensurePrimaryFont();
        if (!this.sys?.isActive?.()) return;
        if (this._openDisconnected || this._phase === "disconnected") {
            this._openDisconnected = false;
            this._showDisconnected();
            return;
        }
        this._showRoot();
    }

    _titleMusicVolume() {
        return typeof Settings !== "undefined" ? Settings.musicGain() : 0.85;
    }

    _hudUiScale() {
        const pref = typeof Settings !== "undefined" ? Settings.loadGuiScale() : 0;
        if (typeof Settings !== "undefined") {
            return Settings.resolveUiScale(pref, this.scale?.width, this.scale?.height);
        }
        const w = this.scale?.width || 1024;
        const h = this.scale?.height || 768;
        const max = Math.max(1, Math.floor(Math.min(w / 480, h / 360)));
        const n = pref | 0;
        if (n <= 0) return max;
        return Math.min(n, max);
    }

    /** 1× column height used to cap title scale so dense screens don't overflow. */
    _menuFitBudget() {
        switch (this._phase) {
            case "characters":
            case "worlds":
                return 420;
            default:
                return 360;
        }
    }

    _uiScale() {
        const hud = this._hudUiScale();
        const h = this.scale?.height || 768;
        return Math.min(hud, Math.max(1, Math.floor(h / this._menuFitBudget())));
    }

    _uiFont(basePx) {
        const px = typeof pixelUiFontSize === "function"
            ? pixelUiFontSize(basePx, this._uiScale())
            : Math.round((Number(basePx) || 16) * this._uiScale());
        return `${px}px`;
    }

    _uiStroke() {
        return Math.max(2, Math.round(2 * this._uiScale()));
    }

    _menuFormW() {
        return Math.round(280 * this._uiScale());
    }

    _applyTitleMusicVolume() {
        try {
            this._titleMusicTween?.stop?.();
        } catch (_) {}
        this._titleMusicTween = null;
        const vol = this._titleMusicVolume();
        const gain = this._titleGain;
        const ctx = this.sound?.context;
        if (!gain || !ctx) return;
        try {
            gain.gain.cancelScheduledValues(ctx.currentTime);
            gain.gain.setValueAtTime(vol, ctx.currentTime);
        } catch (_) {
            try { gain.gain.value = vol; } catch (_) {}
        }
    }

    _unbindVolumeSlider() {
        try { this._volumeSlider?.destroy?.(); } catch (_) {}
        this._volumeSlider = null;
    }

    _discardHtmlTitleAudio() {
        const el = this.game?._cpTitleAudio;
        if (!el) return;
        try { el.pause(); } catch (_) {}
        try { el.removeAttribute("src"); el.load?.(); } catch (_) {}
        this.game._cpTitleAudio = null;
    }

    _startTitleMusic() {
        this._discardHtmlTitleAudio();
        if (!this.cache?.audio?.exists?.("title") || !this.sound) return;
        this.sound.pauseOnBlur = false;
        if (typeof patchPhaserAudioTabHitch === "function") patchPhaserAudioTabHitch(this.game);
        this._unbindTitleUnlock();
        this._titleMusicWanted = true;
        this._bindTitleMusicVis();
        const play = () => {
            if (!this.sys || !this._titleMusicWanted) return;
            const status = this.sys.settings?.status;
            if (status == null || status >= Phaser.Scenes.SLEEPING) return;
            this._unbindTitleUnlock();
            this._playTitleNow({ fade: true });
        };
        if (this.sound.locked) {
            this._onTitleUnlock = play;
            this.sound.once("unlocked", this._onTitleUnlock);
        } else {
            play();
        }
    }

    _playTitleNow(opts = {}) {
        if (!this._titleMusicWanted) return;
        const ctx = this.sound?.context;
        const buf = this.cache?.audio?.get?.("title");
        if (!ctx || !buf) return;
        const fade = !!opts.fade;
        const vol = this._titleMusicVolume();
        if (this._titleSrc && this._titleGain) {
            this._applyTitleMusicVolume();
            return;
        }
        this._stopTitleGraph();
        try {
            const gain = ctx.createGain();
            const dest = this.sound.destination || ctx.destination;
            gain.connect(dest);
            gain.gain.value = fade ? 0 : vol;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            src.connect(gain);
            src.start(0);
            this._titleSrc = src;
            this._titleGain = gain;
            if (fade) {
                const now = ctx.currentTime;
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(vol, now + 1.4);
            }
        } catch (_) {}
    }

    _stopTitleGraph() {
        const src = this._titleSrc;
        const gain = this._titleGain;
        this._titleSrc = null;
        this._titleGain = null;
        if (src) {
            try { src.onended = null; } catch (_) {}
            try { src.stop(); } catch (_) {}
            try { src.disconnect(); } catch (_) {}
        }
        if (gain) {
            try { gain.disconnect(); } catch (_) {}
        }
    }

    _bindTitleMusicVis() {
        this._unbindTitleMusicVis();
        this._onTitleVis = () => {
            if (document.visibilityState !== "visible") return;
            if (!this._titleMusicWanted) return;
            const ctx = this.sound?.context;
            if (!ctx) return;
            if (ctx.state === "suspended" || ctx.state === "interrupted") {
                try { ctx.resume(); } catch (_) {}
            }
        };
        document.addEventListener("visibilitychange", this._onTitleVis);
    }

    _unbindTitleMusicVis() {
        if (this._onTitleVis) {
            try { document.removeEventListener("visibilitychange", this._onTitleVis); } catch (_) {}
        }
        this._onTitleVis = null;
    }

    _unbindTitleUnlock() {
        if (this._onTitleUnlock && this.sound) {
            try { this.sound.off("unlocked", this._onTitleUnlock); } catch (_) {}
        }
        this._onTitleUnlock = null;
    }

    _stopTitleMusic() {
        this._titleMusicWanted = false;
        this._unbindTitleUnlock();
        this._unbindTitleMusicVis();
        try {
            this._titleMusicTween?.stop?.();
        } catch (_) {}
        this._titleMusicTween = null;
        this._stopTitleGraph();
        this._discardHtmlTitleAudio();
        try { this.sound?.stopByKey?.("title"); } catch (_) {}
    }

    /** Nearest-neighbor + clamp wrap (POT textures otherwise REPEAT the opposite edge). */
    _pixelFilter(key) {
        if (!key || !this.textures.exists(key)) return;
        try {
            const tex = this.textures.get(key);
            tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
            clampTextureWrap(tex);
        } catch (_) {}
    }

    /**
     * Place a menu sprite/image on the integer pixel grid.
     * Uses top-left origin so floor(x/y) cannot land between texels.
     * @returns {Phaser.GameObjects.Sprite|Phaser.GameObjects.Image}
     */
    _placePixelIcon(obj, centerX, centerY, texScale = 3) {
        const s = Math.max(1, Math.round(Number(texScale) || 1));
        const fw = obj.frame?.realWidth || obj.frame?.width || obj.width || 16;
        const fh = obj.frame?.realHeight || obj.frame?.height || obj.height || 16;
        const dw = fw * s;
        const dh = fh * s;
        obj.setOrigin(0, 0);
        obj.setScale(s);
        obj.setPosition(
            Math.floor(centerX - dw / 2),
            Math.floor(centerY - dh / 2)
        );
        if (obj.texture?.key) this._pixelFilter(obj.texture.key);
        return obj;
    }

    _initCavePaintings() {
        if (this._caveRoot?.active) return;
        const root = this.add.container(0, 0);
        root.setDepth(-1000);
        this._caveRoot = root;
        this._caveStamps = [];
        this._caveLastKey = null;
        this._caveSpawnIn = 0;
        this._sendCaveBehind();
    }

    _destroyCavePaintings() {
        for (const stamp of this._caveStamps || []) {
            try { stamp.img?.destroy?.(); } catch (_) {}
        }
        this._caveStamps = [];
        if (this._caveRoot) {
            try { this._caveRoot.destroy(true); } catch (_) {}
            this._caveRoot = null;
        }
        this._caveLastKey = null;
    }

    /**
     * Night-veil punch from a fire at the viewer's feet: dark cave wall,
     * destination-out hole, Terrax flicker. Sits above stamps, under UI.
     */
    _initCaveFire() {
        if (this._caveFireImg?.active) return;
        const key = "__menu_cave_fire";
        if (!this.textures.exists(key)) this.textures.createCanvas(key, 64, 64);
        this._caveFireKey = key;
        const img = this.add.image(0, 0, key).setOrigin(0, 0).setDepth(-900);
        this._caveFireImg = img;
        this._caveFireSig = null;
        clampTextureWrap(this.textures.get(key));
        this._drawCaveFire(true);
        this._sendCaveBehind();
    }

    _destroyCaveFire() {
        try { this._caveFireImg?.destroy?.(); } catch (_) {}
        this._caveFireImg = null;
        this._caveFireSig = null;
        if (this._caveFireKey && this.textures.exists(this._caveFireKey)) {
            try { this.textures.remove(this._caveFireKey); } catch (_) {}
        }
        this._caveFireKey = null;
    }

    _tickCaveFire() {
        this._drawCaveFire(false);
    }

    _drawCaveFire(force) {
        const img = this._caveFireImg;
        const key = this._caveFireKey;
        if (!img?.active || !key || !this.textures.exists(key)) return;
        const canvasTex = this.textures.get(key);
        const ctx = canvasTex?.context || canvasTex?.canvas?.getContext?.("2d");
        if (!ctx) return;

        const now = this.time?.now ?? 0;
        const flameTick = Math.floor(now / 50);
        const w = Math.max(2, Math.ceil(this.scale.width / 2) * 2);
        const h = Math.max(2, Math.ceil(this.scale.height / 2) * 2);
        const sig = `${w},${h},${flameTick}`;
        if (!force && sig === this._caveFireSig) return;
        this._caveFireSig = sig;

        if (canvasTex.width !== w || canvasTex.height !== h) {
            canvasTex.setSize(w, h);
            img.setTexture(key);
            clampTextureWrap(canvasTex);
        }
        img.setPosition(0, 0);
        img.setDisplaySize(w, h);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "rgba(10, 7, 5, 0.52)";
        ctx.fillRect(0, 0, w, h);

        const fx = w * 0.5;
        const scale = 8;
        const frame = 16;
        // Flame centroid in the 16×16 sheet sits near (8.1, 8.1) from top-left.
        const fy = h + (8.1 / frame - 1) * frame * scale;
        const rad = Math.max(h * 0.72, w * 0.45);
        let dip = 0;
        if (typeof Light !== "undefined" && Light.flicker) {
            const flick = Light.flicker(Light.KIND.FLAME, now, Light.seedOf(fx, fy, "menu-fire"));
            const maxPx = Light.FIRE_RADIUS_PX || 7;
            dip = (flick.radiusPx || 0) * rad * (0.055 / maxPx);
        }
        const r = Math.max(8, rad - dip);

        ctx.globalCompositeOperation = "destination-out";
        const grd = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
        grd.addColorStop(0, "rgba(0,0,0,1)");
        grd.addColorStop(0.4, "rgba(0,0,0,0.85)");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(fx - r, fy - r, r * 2, r * 2);
        ctx.globalCompositeOperation = "source-over";
        canvasTex.refresh();
        this._placeMenuCampfire();
    }

    _initMenuCampfire() {
        if (this._menuCampfire?.active) {
            this._placeMenuCampfire();
            return;
        }
        if (!this.textures.exists("menu-campfire")) return;
        this._pixelFilter("menu-campfire");
        const animKey = "menu-campfire-anim";
        const existing = this.anims.get(animKey);
        if (existing && existing.frameRate !== 4) {
            this.anims.remove(animKey);
        }
        if (!this.anims.exists(animKey)) {
            this.anims.create({
                key: animKey,
                frames: this.anims.generateFrameNumbers("menu-campfire"),
                frameRate: 4,
                repeat: -1
            });
        }
        const spr = this.add.sprite(0, 0, "menu-campfire");
        spr.setDepth(-800);
        spr.play(animKey);
        this._menuCampfire = spr;
        this._placeMenuCampfire();
        this._sendCaveBehind();
    }

    _placeMenuCampfire() {
        const spr = this._menuCampfire;
        if (!spr?.active) return;
        spr.setOrigin(0.5, 1);
        spr.setScale(8);
        spr.setDepth(-800);
        spr.setPosition(Math.round(this.scale.width / 2), Math.round(this.scale.height));
    }

    _destroyMenuCampfire() {
        try { this._menuCampfire?.destroy?.(); } catch (_) {}
        this._menuCampfire = null;
    }

    _sendCaveBehind() {
        const root = this._caveRoot;
        if (root?.active) {
            root.setDepth(-1000);
            try { this.children?.sendToBack?.(root); } catch (_) {}
        }
        if (this._caveFireImg?.active) this._caveFireImg.setDepth(-900);
        this._placeMenuCampfire();
    }

    _caveStampKeys() {
        return TITLE_CAVE_STAMPS.filter((id) => this.textures.exists(`title-${id}`));
    }

    _pickCaveStampKey() {
        const keys = this._caveStampKeys();
        if (!keys.length) return null;
        const pool = keys.length > 1
            ? keys.filter((k) => `title-${k}` !== this._caveLastKey)
            : keys;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /**
     * Center Y for the next stamp. First is anywhere in 10–90%.
     * After that: opposite half of the 50% line from the previous stamp,
     * and ≥10% of screen height from the last two centers.
     */
    _caveNextSpawnCY() {
        const h = this.scale.height;
        const minCY = h * 0.10;
        const maxCY = h * 0.90;
        const mid = h * 0.50;
        const radius = h * 0.10;
        const stamps = this._caveStamps || [];
        const prev = stamps[stamps.length - 1];
        const prev2 = stamps[stamps.length - 2];
        let lo = minCY;
        let hi = maxCY;
        if (prev) {
            const pcy = prev.y + prev.h / 2;
            if (pcy < mid) {
                lo = Math.max(mid, pcy + radius);
                hi = maxCY;
            } else {
                lo = minCY;
                hi = Math.min(mid, pcy - radius);
            }
        }
        const ranges = this._caveCutRadius(lo, hi, prev2 ? prev2.y + prev2.h / 2 : null, radius);
        return this._cavePickRange(ranges);
    }

    _caveCutRadius(lo, hi, center, radius) {
        if (!(hi > lo)) return [];
        if (center == null || !Number.isFinite(center)) return [[lo, hi]];
        const holeLo = center - radius;
        const holeHi = center + radius;
        if (holeHi <= lo || holeLo >= hi) return [[lo, hi]];
        const out = [];
        if (holeLo > lo) out.push([lo, Math.min(hi, holeLo)]);
        if (holeHi < hi) out.push([Math.max(lo, holeHi), hi]);
        return out.filter(([a, b]) => b > a);
    }

    _cavePickRange(ranges) {
        const usable = (ranges || []).filter(([a, b]) => b > a);
        if (!usable.length) return null;
        const total = usable.reduce((s, [a, b]) => s + (b - a), 0);
        if (!(total > 0)) return null;
        let r = Math.random() * total;
        for (const [a, b] of usable) {
            r -= b - a;
            if (r <= 0) return a + Math.random() * (b - a);
        }
        const [a, b] = usable[usable.length - 1];
        return a + Math.random() * (b - a);
    }

    _spawnCavePainting() {
        if (!this._caveRoot?.active) return false;
        const id = this._pickCaveStampKey();
        if (!id) return false;
        const key = `title-${id}`;
        this._pixelFilter(key);

        const scale = 4 + Math.floor(Math.random() * 4);
        const dw = 32 * scale;
        const dh = 32 * scale;
        const cy = this._caveNextSpawnCY();
        if (cy == null) return false;
        const x = this.scale.width + dw * 0.25;
        const y = cy - dh / 2;

        const src = this.add.image(0, 0, key);
        src.setOrigin(0.5, 0.5);
        src.setScale(scale);
        if (Math.random() < 0.5) src.setFlipX(true);
        const img = this.add.renderTexture(0, 0, dw, dh);
        img.setOrigin(0.5, 0.5);
        img.setAlpha(0);
        img.setAngle((Math.random() * 2 - 1) * 30);
        img.draw(src, dw / 2, dh / 2);
        src.destroy();
        try {
            img.texture?.setFilter(Phaser.Textures.FilterMode.LINEAR);
            clampTextureWrap(img.texture);
        } catch (_) {}
        this._caveRoot.add(img);
        img.setPosition(x + dw / 2, y + dh / 2);

        const fadeIn = 2500 + Math.random() * 1500;
        this._caveStamps.push({
            img,
            key,
            x,
            y,
            w: dw,
            h: dh,
            vx: 12 + Math.random() * 7,
            age: 0,
            fadeIn,
            peakAlpha: 0.4 + Math.random() * 0.2
        });
        this._caveLastKey = key;
        this._sendCaveBehind();
        return true;
    }

    _killCaveStamp(stamp) {
        if (!stamp) return;
        try { stamp.img?.destroy?.(); } catch (_) {}
        this._caveStamps = (this._caveStamps || []).filter((s) => s !== stamp);
    }

    _cullCavePaintings() {
        for (const stamp of [...(this._caveStamps || [])]) {
            if (!stamp.img?.active) {
                this._killCaveStamp(stamp);
                continue;
            }
            if (stamp.x + stamp.w < 0) {
                this._killCaveStamp(stamp);
            }
        }
    }

    _tickCavePaintings(delta) {
        if (!this._caveRoot?.active) return;
        this.cameras.main.setRoundPixels(false);
        const dt = Math.max(0, Number(delta) || 0);
        this._caveSpawnIn -= dt;
        if (this._caveSpawnIn <= 0) {
            const spawned = this._spawnCavePainting();
            if (spawned) {
                this._caveSpawnIn = 9000 + Math.random() * 2000;
            } else {
                this._caveSpawnIn = 400 + Math.random() * 400;
            }
        }
        const dtSec = dt / 1000;
        for (const stamp of [...(this._caveStamps || [])]) {
            const img = stamp.img;
            if (!img?.active) {
                this._killCaveStamp(stamp);
                continue;
            }
            stamp.age += dt;
            stamp.x -= stamp.vx * dtSec;
            img.setPosition(stamp.x + stamp.w / 2, stamp.y + stamp.h / 2);

            let alpha = stamp.peakAlpha;
            if (stamp.age < stamp.fadeIn) {
                alpha = stamp.peakAlpha * (stamp.age / stamp.fadeIn);
            }
            img.setAlpha(alpha);

            if (stamp.x + stamp.w < 0) {
                this._killCaveStamp(stamp);
            }
        }
    }

    _snapshotDrafts() {
        return {
            host: this.hostInput?.value,
            pass: this.passInput?.value,
            name: this.nameInput?.value,
            worldName: this.worldNameInput?.value,
            seed: this.seedInput?.value,
            renameName: this.renameInput?.value,
            faceIdx: this._createFaceIdx,
            look: this._createLook,
            lookPart: this._createLookPart
        };
    }

    _menuInputKeys() {
        return ["hostInput", "passInput", "nameInput", "worldNameInput", "seedInput", "renameInput"];
    }

    _snapshotDomFocus() {
        const a = document.activeElement;
        for (const key of this._menuInputKeys()) {
            const el = this[key];
            if (el && el === a) {
                return {
                    key,
                    start: el.selectionStart,
                    end: el.selectionEnd
                };
            }
        }
        return null;
    }

    _restoreDomFocus(snap) {
        if (!snap) return;
        const el = this[snap.key];
        if (!el) return;
        el.focus();
        try {
            if (typeof snap.start === "number" && typeof snap.end === "number") {
                el.setSelectionRange(snap.start, snap.end);
            }
        } catch (_) {}
        this._syncKeyboardForDom();
    }

    _anyMenuInputFocused() {
        const a = document.activeElement;
        if (!a) return false;
        return this._menuInputKeys().some((key) => this[key] === a);
    }

    /** Phaser keyboard must stay off while a menu field is focused. */
    _syncKeyboardForDom() {
        const kb = this.input?.keyboard;
        if (!kb) return;
        kb.enabled = !this._anyMenuInputFocused();
    }

    /** Same as the on-screen Back button (capture so focused fields still work). */
    _handleMenuEscape(e) {
        if (e.key !== "Escape" && e.code !== "Escape") return;
        if (e.repeat) return;
        if (this._escapeLock) return;
        if (this._startingSp) return;
        if (!this.sys?.isActive?.()) return;
        if (this._phase === "root") return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        this._escapeLock = true;
        try {
            this._menuBack();
        } finally {
            queueMicrotask(() => { this._escapeLock = false; });
        }
    }

    /** One screen back from the current menu phase (not “last Back button”). */
    _menuBack() {
        switch (this._phase) {
            case "mpHelp":
                this._showMpHost();
                return;
            case "mpHost":
                this._showRoot();
                return;
            case "disconnected":
                this._beginMp();
                return;
            case "mpPassword":
                this._showCharacters({ next: "join" });
                return;
            case "characters":
                if (this._charNext === "join") this._showMpHost();
                else this._showRoot();
                return;
            case "createCharacter":
                this._showCharacters({ next: this._charNext });
                return;
            case "worlds":
                this._showCharacters({ next: "worlds" });
                return;
            case "createWorld":
                this._showWorlds();
                return;
            case "options":
                this._showRoot();
                return;
            case "rename":
                if (this._renameKind === "world") this._showWorlds();
                else this._showCharacters({ next: this._charNext });
                return;
            default:
                if (typeof this._backAction === "function") this._backAction();
        }
    }

    /** Rebuild the current menu screen after a window resize. */
    _relayout() {
        if (this._startingSp) return;
        if (!this.sys?.isActive?.() || !this.cameras?.main) return;
        const gw = this.scale.width;
        const gh = this.scale.height;
        this.cameras.main.setSize(gw, gh);
        this.cameras.main.setViewport(0, 0, gw, gh);
        const focus = this._snapshotDomFocus();
        const drafts = this._snapshotDrafts();
        const phase = this._phase;
        switch (phase) {
            case "root":
                this._showRoot();
                break;
            case "disconnected":
                this._showDisconnected();
                break;
            case "mpHost":
                this._showMpHost({ drafts, relayout: true });
                break;
            case "mpHelp":
                this._showMpHelp();
                break;
            case "mpPassword":
                this._showMpPassword({ drafts, relayout: true });
                break;
            case "characters":
                this._showCharacters({ next: this._charNext });
                break;
            case "createCharacter":
                this._showCreateCharacter({
                    next: this._charNext,
                    drafts,
                    relayout: true
                });
                break;
            case "worlds":
                this._showWorlds();
                break;
            case "createWorld":
                this._showCreateWorld({ drafts, relayout: true });
                break;
            case "options":
                this._showOptions();
                break;
            case "rename":
                this._showRename({
                    kind: this._renameKind,
                    id: this._renameId,
                    currentName: this._renameCurrent,
                    maxLen: this._renameMaxLen,
                    drafts,
                    relayout: true
                });
                break;
            default:
                this._showRoot();
                break;
        }
        this._cullCavePaintings();
        this._sendCaveBehind();
        this._restoreDomFocus(focus);
    }

    _ensurePlayerAnims() {
        // Walk/idle anims are created per baked look in PlayerLook.ensure
    }

    _unbindCreateHslInput() {
        if (this._onHslMove) {
            this.input?.off?.("pointermove", this._onHslMove);
            this.input?.off?.("pointerup", this._onHslUp);
            this.input?.off?.("pointerupoutside", this._onHslUp);
        }
        this._onHslMove = this._onHslUp = null;
        this._hslDrag = null;
    }

    _clear() {
        this._unbindCardListScroll();
        this._unbindCreateHslInput();
        this._unbindVolumeSlider();
        this._cancelMpProbe();
        this._backAction = null;
        if (this._armedDeleteTimer) {
            clearTimeout(this._armedDeleteTimer);
            this._armedDeleteTimer = null;
        }
        this._armedDeleteId = null;
        this._armedDeleteBtn = null;
        for (const o of this._dom) {
            try {
                o.destroy?.();
            } catch (_) {}
            try {
                o.remove?.();
            } catch (_) {}
        }
        this._dom = [];
        const cave = this._caveRoot;
        const fire = this._caveFireImg;
        const camp = this._menuCampfire;
        for (const child of this.children?.list?.slice?.() || []) {
            if (child === cave || child === fire || child === camp) continue;
            try { child.destroy(true); } catch (_) {}
        }
        this.cameras?.main?.setBackgroundColor?.("#1a1510");
        this._sendCaveBehind();
        this._previewSprite = null;
        this._previewGfx = null;
        this._previewFrame = null;
        this._createSwatches = null;
        this._createHslBars = null;
        this._optionsGuiScaleBtn = null;
        this.hostInput = this.passInput = this.nameInput = this.worldNameInput = this.seedInput = this.renameInput = null;
        this._syncKeyboardForDom();
    }

    _track(...nodes) {
        for (const n of nodes) {
            if (!n) continue;
            if (typeof n.setFontFamily === "function") crispUiText(n);
            this._dom.push(n);
        }
        this._sendCaveBehind();
        return nodes[0];
    }

    _title(text, yFrac = 0.14, fontSize = 32) {
        const w = this.scale.width;
        const h = this.scale.height;
        const s = this._uiScale();
        const sizePx = this._uiFont(fontSize);
        const label = this._track(this.add.text(0, 0, text, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: sizePx,
            color: "#e8dcc8"
        }).setOrigin(0, 0));
        const maxW = Math.max(120, w - 48);
        if (label.width > maxW && label.width > 0) {
            const cur = parseFloat(label.style.fontSize) || fontSize;
            const fit = Math.max(
                typeof pixelUiFontSize === "function" ? pixelUiFontSize(Math.min(32, fontSize), s) : 32,
                Math.floor(cur * maxW / label.width)
            );
            label.setFontSize(`${fit}px`);
        }
        const tx = Math.round(w / 2);
        const ty = Math.round(h * yFrac);
        label.setPosition(tx + Math.round(-label.width / 2), ty + Math.round(-label.height / 2));
        // If we somehow drew early, swap metrics once the face is ready
        if (!this._primaryFontReady) {
            this._ensurePrimaryFont().then(() => {
                if (!label?.active) return;
                label.setStyle({ fontFamily: PIXEL_UI_FONT, fontSize: sizePx, color: "#e8dcc8" });
                label.setFontFamily(PIXEL_UI_FONT);
                label.updateText?.();
                if (label.width > maxW && label.width > 0) {
                    const cur = parseFloat(label.style.fontSize) || fontSize;
                    const fit = Math.max(
                        typeof pixelUiFontSize === "function" ? pixelUiFontSize(Math.min(32, fontSize), s) : 32,
                        Math.floor(cur * maxW / label.width)
                    );
                    label.setFontSize(`${fit}px`);
                }
                label.setPosition(tx + Math.round(-label.width / 2), ty + Math.round(-label.height / 2));
            });
        }
        this._sendCaveBehind();
        return label;
    }

    _status(yFrac = 0.80) {
        const w = this.scale.width;
        const h = this.scale.height;
        this.status = this._track(this.add.text(w / 2, h * yFrac, "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: this._uiFont(16),
            color: "#c0b0a0",
            align: "center",
            wordWrap: { width: Math.min(Math.round(520 * this._uiScale()), w - 40) }
        }).setOrigin(0.5));
        return this.status;
    }

    /** Clear status feedback when the user edits a DOM field (e.g. duplicate-name errors). */
    _clearStatusOnInput(el) {
        if (!el) return;
        const clear = () => {
            this.status?.setColor?.("#c0b0a0");
            this.status?.setText("");
        };
        el.addEventListener("input", clear);
        el.addEventListener("change", clear);
    }

    /**
     * Menu button size presets (fixed box so every button of a tier matches).
     * large  — root Singleplayer / Multiplayer
     * medium — Back, Connect, Help, Create, Import, Join, …
     * small  — character / world card actions
     */
    _buttonSizePreset(size) {
        const s = this._uiScale();
        const presets = {
            large: { fontSize: 24, width: 240, height: 52 },
            medium: { fontSize: 16, width: 140, height: 38 },
            small: { fontSize: 16, width: 78, height: 28 }
        };
        const raw = (size === "large" || size === "lg" || size === "hero")
            ? presets.large
            : (size === "small" || size === "sm" || size === "compact")
                ? presets.small
                : presets.medium;
        return {
            fontSize: this._uiFont(raw.fontSize),
            width: Math.round(raw.width * s),
            height: Math.round(raw.height * s)
        };
    }

    /** Vertical center for stacked medium buttons (index 0 = base). */
    _mediumStackY(baseY, index = 0) {
        const step = this._buttonSizePreset("medium").height + Math.round(10 * this._uiScale());
        return baseY + step * index;
    }

    _button(x, y, label, onClick, opts = {}) {
        const BG = 0x120e0a;       // slightly darker than menu #1a1510
        const BG_PRESS = 0x0a0806; // even darker while pressed
        const OUTLINE = 0x2a2218;  // dark outline
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b; // gold
        const sizeKey = opts.size || (opts.compact ? "small" : "medium");
        const preset = this._buttonSizePreset(sizeKey);
        const fontSize = opts.fontSize || preset.fontSize;
        const bw = Math.max(1, Math.round(Number(opts.width ?? opts.minWidth ?? preset.width) || preset.width));
        const bh = Math.max(1, Math.round(Number(opts.height ?? opts.minHeight ?? preset.height) || preset.height));

        const text = crispUiText(this.add.text(0, 0, label, {
            fontFamily: PIXEL_UI_FONT,
            fontSize,
            color: "#d4c4a8"
        }).setOrigin(0, 0));
        text.setPosition(Math.round(-text.width / 2), Math.round(-text.height / 2));

        const stroke = this._uiStroke();
        const rect = this.add.rectangle(0, 0, bw, bh, BG, 1)
            .setStrokeStyle(stroke, OUTLINE)
            .setInteractive({ useHandCursor: true });

        const root = this.add.container(Math.round(x), Math.round(y), [rect, text]);
        let hovering = false;
        let pressing = false;

        const setActive = (on) => {
            opts.onActive?.(on);
        };

        const paint = () => {
            if (opts.armed) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(stroke, OUTLINE_PRESS);
                text.setColor("#e8d080");
            } else if (pressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(stroke, OUTLINE_PRESS);
                text.setColor("#d4c4a8");
            } else if (hovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(stroke, OUTLINE_HOVER);
                text.setColor("#d4c4a8");
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(stroke, OUTLINE);
                text.setColor("#d4c4a8");
            }
        };

        rect.on("pointerover", () => {
            hovering = true;
            paint();
            setActive(true);
        });
        rect.on("pointerout", () => {
            hovering = false;
            pressing = false;
            paint();
            setActive(false);
            opts.onPointerOut?.();
        });
        rect.on("pointerdown", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            pressing = true;
            paint();
            setActive(true);
        });
        rect.on("pointerup", (pointer, _lx, _ly, event) => {
            event?.stopPropagation?.();
            const wasPress = pressing;
            pressing = false;
            paint();
            if (wasPress && hovering) onClick?.();
            else if (!hovering) setActive(false);
        });

        this._track(root);
        if (label === "Back") this._backAction = onClick;
        root.btnWidth = bw;
        root.btnHeight = bh;
        root.btnRect = rect;
        root.btnText = text;
        root.layoutBtnText = () => {
            text.setPosition(Math.round(-text.width / 2), Math.round(-text.height / 2));
        };
        root.setBtnText = (str) => {
            text.setText(str);
            root.layoutBtnText();
        };
        root.restoreHover = () => {
            hovering = true;
            pressing = false;
            paint();
            setActive(true);
            try {
                if (this.game?.canvas) this.game.canvas.style.cursor = "pointer";
            } catch (_) {}
        };
        root.setArmed = (on) => {
            opts.armed = !!on;
            paint();
        };
        paint();
        return root;
    }

    _formatLastPlayed(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n) || n <= 0) return "Never played";
        const ago = Date.now() - n;
        if (ago < 60_000) return "just now";
        try {
            return new Date(n).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit"
            });
        } catch {
            return new Date(n).toLocaleString();
        }
    }

    _lastPlayedTs(row) {
        if (row && Object.prototype.hasOwnProperty.call(row, "lastPlayedAt")) {
            const n = Number(row.lastPlayedAt);
            return Number.isFinite(n) && n > 0 ? n : 0;
        }
        const n = Number(row?.updatedAt);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    _lastPlayedLabel(row) {
        const ts = this._lastPlayedTs(row);
        if (!ts) return "Never played";
        return `Last played ${this._formatLastPlayed(ts)}`;
    }

    _partyMembersLabel(character) {
        const n = Array.isArray(character?.party) ? character.party.length : 0;
        if (!(n > 0)) return "";
        return n === 1 ? "1 party member" : `${n} party members`;
    }

    _formatWorldClock(clock) {
        const day = Math.max(1, Math.floor(Number(clock?.gameDay) || 1));
        let mins = Math.floor(Number(clock?.gameMinutes) || 0);
        if (mins < 0) mins = 0;
        mins = mins % 1440;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        return { day: `Day ${day}`, time: `${hh}:${mm}` };
    }

    _clearArmedDelete() {
        if (this._armedDeleteTimer) {
            clearTimeout(this._armedDeleteTimer);
            this._armedDeleteTimer = null;
        }
        if (this._armedDeleteBtn?.active !== false && this._armedDeleteBtn?.btnText) {
            this._armedDeleteBtn.setArmed?.(false);
            this._armedDeleteBtn.setBtnText?.("Delete");
        }
        this._armedDeleteId = null;
        this._armedDeleteBtn = null;
    }

    _armDelete(cardId, deleteBtn) {
        if (this._armedDeleteId !== cardId) {
            this._clearArmedDelete();
        }
        this._armedDeleteId = cardId;
        this._armedDeleteBtn = deleteBtn;
        deleteBtn.setArmed?.(true);
        deleteBtn.setBtnText?.("Delete?");
        if (this._armedDeleteTimer) clearTimeout(this._armedDeleteTimer);
        this._armedDeleteTimer = setTimeout(() => {
            this._armedDeleteTimer = null;
            if (this._armedDeleteId !== cardId) return;
            this._clearArmedDelete();
        }, 3000);
    }

    /**
     * Terraria-style select card: icon, title, info, Play/Rename/Favorite, Export/Delete stack.
     * Play = 1 click; double-click empty card area also activates.
     */
    _selectCard(opts) {
        const {
            x,
            y,
            width,
            height,
            cardId,
            iconNode,
            title,
            lines = [],
            onActivate,
            onRename,
            onFavorite,
            favorited = false,
            onExport,
            onDelete,
            onHoverActive
        } = opts;

        const BG = 0x120e0a;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const s = this._uiScale();
        const stroke = this._uiStroke();
        const left = Math.round(x - width / 2);
        const top = Math.round(y - height / 2);
        const pad = Math.round(12 * s);
        // Fits 16px sprites at integer scale 3 (48×48) at GUI 1
        const iconSlot = Math.round(48 * s);

        const panel = this.add.rectangle(Math.round(x), Math.round(y), width, height, BG, 1)
            .setStrokeStyle(stroke, OUTLINE)
            .setInteractive({ useHandCursor: true });
        this._track(panel);

        let hovering = false;
        let lastClickAt = 0;
        const paintPanel = () => {
            panel.setStrokeStyle(stroke, hovering ? OUTLINE_HOVER : OUTLINE);
        };
        panel.on("pointerover", () => {
            hovering = true;
            paintPanel();
            onHoverActive?.(true);
        });
        panel.on("pointerout", () => {
            hovering = false;
            paintPanel();
            onHoverActive?.(false);
        });
        panel.on("pointerup", () => {
            const now = Date.now();
            if (now - lastClickAt < 350) {
                lastClickAt = 0;
                onActivate?.();
            } else {
                lastClickAt = now;
            }
        });

        if (iconNode) {
            // Icons use top-left origin from _placePixelIcon — center inside slot
            const fw = iconNode.frame?.realWidth || iconNode.frame?.width || 16;
            const fh = iconNode.frame?.realHeight || iconNode.frame?.height || 16;
            const s = Math.max(1, Math.round(iconNode.scaleX || 1));
            const cx = left + pad + iconSlot / 2;
            const cy = y;
            iconNode.setPosition(
                Math.floor(cx - (fw * s) / 2),
                Math.floor(cy - (fh * s) / 2)
            );
            if (iconNode.setDepth) iconNode.setDepth(1);
        }

        const sideBtnW = this._buttonSizePreset("small").width;
        const textLeft = left + pad + iconSlot + Math.round(10 * s);
        const textRight = left + width - pad - sideBtnW - Math.round(10 * s);
        const titleText = this.add.text(textLeft, top + Math.round(10 * s), title || "", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: this._uiFont(16),
            color: "#e8dcc8"
        }).setOrigin(0, 0);
        this._track(titleText);

        const info = crispUiText(this.add.text(textLeft, top + Math.round(34 * s), (lines || []).join(" / "), {
            fontFamily: PIXEL_UI_FONT,
            fontSize: `${Math.max(8, Math.round(12 * s))}px`,
            color: "#a89880"
        }).setOrigin(0, 0));
        this._track(info);

        const playBtn = this._button(0, 0, "Play", () => onActivate?.(), {
            size: "small",
            onActive: onHoverActive
        });
        const renameBtn = this._button(0, 0, "Rename", () => onRename?.(), { size: "small" });
        const favoriteBtn = onFavorite
            ? this._button(0, 0, "Favorite", () => onFavorite?.(!favorited), {
                size: "small",
                armed: !!favorited
            })
            : null;
        const exportBtn = this._button(0, 0, "Export", () => onExport?.(), { size: "small" });
        const deleteBtn = this._button(0, 0, "Delete", () => {
            if (this._armedDeleteId === cardId) {
                this._clearArmedDelete();
                onDelete?.();
                return;
            }
            this._armDelete(cardId, deleteBtn);
        }, { size: "small" });
        if (this._armedDeleteId === cardId) {
            deleteBtn.setArmed?.(true);
            deleteBtn.setBtnText?.("Delete?");
        }

        // Bottom-left actions — 8px under a one-line info row
        const btnY = top + Math.round(34 * s) + Math.round(12 * s) + Math.round(8 * s) + playBtn.btnHeight / 2;
        playBtn.x = textLeft + playBtn.btnWidth / 2;
        playBtn.y = btnY;
        renameBtn.x = playBtn.x + playBtn.btnWidth / 2 + Math.round(8 * s) + renameBtn.btnWidth / 2;
        renameBtn.y = btnY;
        if (favoriteBtn) {
            favoriteBtn.x = renameBtn.x + renameBtn.btnWidth / 2 + Math.round(8 * s) + favoriteBtn.btnWidth / 2;
            favoriteBtn.y = btnY;
        }

        // Top-right stack: Export, then Delete
        const sideGap = Math.round(6 * s);
        const sideX = left + width - pad - Math.max(exportBtn.btnWidth, deleteBtn.btnWidth) / 2;
        exportBtn.x = sideX;
        exportBtn.y = top + Math.round(10 * s) + exportBtn.btnHeight / 2;
        deleteBtn.x = sideX;
        deleteBtn.y = exportBtn.y + exportBtn.btnHeight / 2 + sideGap + deleteBtn.btnHeight / 2;

        return { panel, playBtn, renameBtn, favoriteBtn, exportBtn, deleteBtn, titleText, info, height };
    }

    /**
     * In-game rename screen (no window.prompt). Placeholder ghost text = current name.
     */
    _showRename({
        kind = "character",
        id = null,
        currentName = "",
        maxLen = 24,
        drafts = null,
        relayout = false
    } = {}) {
        if (!id) {
            if (kind === "world") this._showWorlds();
            else this._showCharacters({ next: this._charNext });
            return;
        }
        this._clear();
        this._phase = "rename";
        this._renameKind = kind;
        this._renameId = id;
        this._renameCurrent = currentName || (kind === "world" ? "World" : "Player");
        this._renameMaxLen = maxLen;

        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Rename");
        this._status();

        const typed = drafts?.renameName != null ? drafts.renameName : "";
        const formW = this._menuFormW();
        this.renameInput = this._domInput(
            w / 2 - formW / 2,
            h * 0.42,
            formW,
            this._renameCurrent,
            typed
        );
        this.renameInput.maxLength = maxLen;
        this._clearStatusOnInput(this.renameInput);
        if (!relayout) this.renameInput.focus();

        this._button(w / 2, h * 0.58, "Rename", async () => {
            const raw = (this.renameInput?.value || "").trim();
            const name = (raw || this._renameCurrent).slice(0, this._renameMaxLen);
            try {
                if (this._renameKind === "world") {
                    await WorldStore.rename(this._renameId, name);
                    await this._showWorlds();
                } else {
                    await CharacterStore.rename(this._renameId, name);
                    if (this._selectedCharacter?.id === this._renameId) {
                        this._selectedCharacter = await CharacterStore.get(this._renameId);
                    }
                    await this._showCharacters({ next: this._charNext });
                }
            } catch (e) {
                this.status?.setColor?.("#e06060");
                this.status?.setText(String(e.message || e));
            }
        });
        this._button(w / 2, this._mediumStackY(h * 0.58, 1), "Back", () => {
            if (this._renameKind === "world") this._showWorlds();
            else this._showCharacters({ next: this._charNext });
        });
    }

    _listFooter(y, { onBack, onImport, onCreate }) {
        const w = this.scale.width;
        const gap = this._buttonSizePreset("medium").width + Math.round(16 * this._uiScale());
        this._button(w / 2 - gap, y, "Back", onBack);
        this._button(w / 2, y, "Import", onImport);
        this._button(w / 2 + gap, y, "Create", onCreate);
    }

    /** Footer stays above the 8× campfire; overflowing cards scroll instead. */
    _listFooterY() {
        const h = this.scale.height;
        const fireH = 16 * 8;
        const btnH = this._buttonSizePreset("medium").height;
        return Math.round(h - fireH - btnH / 2 - Math.round(16 * this._uiScale()));
    }

    _cardListView() {
        const h = this.scale.height;
        const footerY = this._listFooterY();
        const btnH = this._buttonSizePreset("medium").height;
        const viewTop = Math.round(h * 0.26);
        const viewBottom = Math.round(footerY - btnH / 2 - 12);
        // Card stroke is 2px and sits on the rect edge — keep it inside the mask.
        const outlinePad = this._uiStroke();
        return {
            viewTop,
            viewBottom,
            footerY,
            outlinePad,
            viewH: Math.max(0, viewBottom - viewTop)
        };
    }

    _selectCardNodes(card, iconNode) {
        return [
            card?.panel,
            iconNode,
            card?.titleText,
            card?.info,
            card?.playBtn,
            card?.renameBtn,
            card?.favoriteBtn,
            card?.exportBtn,
            card?.deleteBtn
        ].filter(Boolean);
    }

    _unbindCardListScroll() {
        if (this._onCardListWheel) {
            this.input?.off?.("wheel", this._onCardListWheel);
            this._onCardListWheel = null;
        }
        try { this._cardListMask?.destroy?.(); } catch (_) {}
        try { this._cardListMaskGfx?.destroy?.(); } catch (_) {}
        this._cardListMask = null;
        this._cardListMaskGfx = null;
        this._cardList = null;
    }

    _syncCardListInput(content, viewTop, viewBottom) {
        const visit = (obj) => {
            if (!obj) return;
            if (obj.input) {
                let top = obj.y;
                let bot = obj.y;
                try {
                    const b = obj.getBounds();
                    top = b.top;
                    bot = b.bottom;
                } catch (_) {}
                obj.input.enabled = bot > viewTop && top < viewBottom;
            }
            if (obj.list) {
                for (const child of obj.list) visit(child);
            }
        };
        visit(content);
    }

    _bindCardListScroll(content, { viewTop, viewBottom, contentH, outlinePad = 2 }) {
        const viewH = Math.max(0, viewBottom - viewTop);
        const maxScroll = Math.max(0, Math.round(contentH - viewH));
        if (!(maxScroll > 0) || viewH <= 0) return;

        const maskGfx = this.make.graphics({ x: 0, y: 0, add: false });
        maskGfx.fillStyle(0xffffff, 1);
        maskGfx.fillRect(0, viewTop - outlinePad, this.scale.width, viewH + outlinePad * 2);
        const mask = maskGfx.createGeometryMask();
        content.setMask(mask);
        this._cardListMaskGfx = maskGfx;
        this._cardListMask = mask;

        let scroll = 0;
        const apply = (next) => {
            scroll = Math.max(0, Math.min(maxScroll, next));
            content.y = -Math.round(scroll);
            this._syncCardListInput(content, viewTop, viewBottom);
        };
        apply(0);

        this._onCardListWheel = (_p, _over, _dx, dy) => {
            const ptr = this.input?.activePointer;
            if (!ptr || ptr.y < viewTop || ptr.y > viewBottom) return;
            apply(scroll + dy * 0.45);
        };
        this.input.on("wheel", this._onCardListWheel);
        this._cardList = { content, apply, maxScroll };
    }
    _roundArrow(x, y, glyph, onClick) {
        const s = this._uiScale();
        const r = Math.round(18 * s);
        const stroke = this._uiStroke();
        const hit = this.add.circle(x, y, r, 0x2a2218, 1)
            .setStrokeStyle(stroke, 0x6a5a4a)
            .setInteractive({ useHandCursor: true });
        const label = crispUiText(this.add.text(0, 0, glyph, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: this._uiFont(16),
            color: "#d4c4a8"
        }));
        if (typeof placeUiTextInkCentered === "function") {
            placeUiTextInkCentered(label, x, y);
        } else {
            placeUiText(label, x, y, 0.5, 0.5);
        }
        hit.on("pointerover", () => {
            hit.setStrokeStyle(stroke, 0xc4b498);
            label.setColor("#fff0d0");
        });
        hit.on("pointerout", () => {
            hit.setStrokeStyle(stroke, 0x6a5a4a);
            label.setColor("#d4c4a8");
        });
        hit.on("pointerdown", onClick);
        this._track(hit, label);
        return hit;
    }

    _domInput(x, y, width, placeholder, value, opts = {}) {
        const s = this._uiScale();
        const fontPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(16, s) : Math.round(16 * s);
        const pad = Math.round(8 * s);
        const border = Math.max(1, Math.round(s));
        const el = document.createElement("input");
        el.type = opts.type || "text";
        el.placeholder = placeholder;
        el.value = value || "";
        if (opts.autocomplete) el.autocomplete = opts.autocomplete;
        if (opts.maxLength != null) el.maxLength = opts.maxLength;
        el.spellcheck = false;
        el.style.cssText = [
            "position:fixed",
            `left:${x}px`,
            `top:${y}px`,
            `width:${width}px`,
            `padding:${pad}px`,
            "font-family:PrimaryFont, monospace",
            `font-size:${fontPx}px`,
            "background:#2a2218",
            "color:#e8dcc8",
            `border:${border}px solid #6a5a4a`,
            `border-radius:${Math.round(4 * s)}px`,
            "z-index:1000",
            "pointer-events:auto",
            `outline:${border}px solid #6a5a4a`,
            "box-sizing:border-box"
        ].join(";");
        // Keep Phaser from treating clicks/keys on this field as game input
        for (const ev of ["mousedown", "mouseup", "touchstart", "touchend", "pointerdown", "pointerup"]) {
            el.addEventListener(ev, (e) => e.stopPropagation());
        }
        for (const ev of ["keydown", "keyup", "keypress"]) {
            el.addEventListener(ev, (e) => e.stopPropagation());
        }
        el.addEventListener("focus", () => {
            el.style.outline = `${Math.max(2, Math.round(2 * s))}px solid #d4a84b`;
            this._syncKeyboardForDom();
            try {
                this.game?.canvas?.blur?.();
            } catch (_) {}
        });
        el.addEventListener("blur", () => {
            el.style.outline = `${border}px solid #6a5a4a`;
            // Next field may focus in the same turn — wait before re-enabling Phaser keys
            this.time?.delayedCall?.(0, () => this._syncKeyboardForDom());
        });
        document.body.appendChild(el);
        this._dom.push(el);
        return el;
    }

    _showRoot() {
        this._clear();
        this._phase = "root";
        const w = this.scale.width;
        const h = this.scale.height;
        const step = this._buttonSizePreset("large").height + Math.round(8 * this._uiScale());
        this._title("CAVE PAINTINGS", 0.16, 64);
        this._status();
        this._button(w / 2, h * 0.42, "Singleplayer", () => this._beginSp(), { size: "large" });
        this._button(w / 2, h * 0.42 + step, "Multiplayer", () => this._beginMp(), { size: "large" });
        this._button(w / 2, h * 0.42 + step * 2, "Options", () => this._showOptions(), { size: "large" });
    }

    _maxGuiScaleOption() {
        return typeof Settings !== "undefined"
            ? Settings.getMaxGuiScaleOption(this.scale?.width, this.scale?.height)
            : Math.max(1, Math.floor(Math.min(
                (this.scale?.width || 1024) / 480,
                (this.scale?.height || 768) / 360
            )));
    }

    _guiScaleButtonLabel() {
        const pref = typeof Settings !== "undefined" ? Settings.loadGuiScale() : 0;
        return typeof Settings !== "undefined"
            ? Settings.guiScaleButtonLabel(pref)
            : (pref === 0 ? "GUI Scale: Auto" : `GUI Scale: ${pref}`);
    }

    _cycleTitleGuiScale() {
        const max = this._maxGuiScaleOption();
        const cur = typeof Settings !== "undefined" ? Settings.loadGuiScale() : 0;
        const next = typeof Settings !== "undefined" ? Settings.cycleGuiScale(cur, max) : 0;
        if (typeof Settings !== "undefined") Settings.saveGuiScale(next);
        this._showOptions();
        this.time?.delayedCall?.(0, () => this._optionsGuiScaleBtn?.restoreHover?.());
    }

    _showOptions() {
        this._clear();
        this._phase = "options";
        const w = this.scale.width;
        const h = this.scale.height;
        const s = this._uiScale();
        this._title("Options");
        const y0 = h * 0.40;
        this._optionsGuiScaleBtn = this._button(
            w / 2,
            y0,
            this._guiScaleButtonLabel(),
            () => this._cycleTitleGuiScale()
        );
        this._track(this.add.text(w / 2, y0 + Math.round(56 * s), "Music Volume", {
            fontFamily: PIXEL_UI_FONT,
            fontSize: this._uiFont(16),
            color: "#d4c4a8"
        }).setOrigin(0.5));
        const sliderW = this._menuFormW();
        const sliderX = Math.floor(w / 2 - sliderW / 2);
        const sliderY = Math.round(y0 + Math.round(78 * s));
        const vol = typeof Settings !== "undefined" ? Settings.loadMusicVolume() : 85;
        this._volumeSlider = Settings.makePercentSlider(this, {
            x: sliderX,
            y: sliderY,
            width: sliderW,
            height: Math.round(16 * s),
            scale: s,
            value: vol,
            onChange: (n) => {
                Settings.saveMusicVolume(n);
                this._applyTitleMusicVolume();
            }
        });
        this._track(...this._volumeSlider.nodes);
        this._button(w / 2, y0 + Math.round(160 * s), "Back", () => this._showRoot());
    }

    _showDisconnected() {
        this._clear();
        this._phase = "disconnected";
        this._mode = "mp";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Disconnected");
        this._button(w / 2, h * 0.42, "OK", () => this._beginMp(), { size: "large" });
    }

    async _beginSp() {
        this._mode = "sp";
        await this._showCharacters({ next: "worlds" });
    }

    async _beginMp() {
        this._mode = "mp";
        this._mpPassword = "";
        await this._showMpHost();
    }

    async _showMpHost(opts = {}) {
        this._clear();
        this._phase = "mpHost";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Multiplayer");
        this._status();
        const host = opts.drafts?.host
            ?? this._mpHost
            ?? localStorage.getItem("cp_join_host")
            ?? "127.0.0.1:21826";
        const formW = this._menuFormW();
        this.hostInput = this._domInput(w / 2 - formW / 2, h * 0.40, formW, "", host);
        this._button(w / 2, this._mediumStackY(h * 0.55, 0), "Connect", () => this._probeMultiplayer());
        this._button(w / 2, this._mediumStackY(h * 0.55, 1), "Help", () => this._showMpHelp());
        this._button(w / 2, this._mediumStackY(h * 0.55, 2), "Back", () => this._showRoot());
    }

    /** Inline black/white command chip; keeps surrounding sentence text unchanged. */
    _addCmdLine(x, y, before, command, after, style, wrap) {
        const s = this._uiScale();
        const beforeT = this._track(this.add.text(x, y, before, { ...style }).setOrigin(0, 0));
        const padX = Math.round(4 * s);
        const padY = Math.max(1, Math.round(s));
        const measure = this.add.text(0, 0, command, {
            fontFamily: style.fontFamily || PIXEL_UI_FONT,
            fontSize: style.fontSize || "16px",
            color: "#ffffff"
        }).setOrigin(0, 0).setVisible(false);
        const cmdW = measure.width;
        const cmdH = measure.height;
        measure.destroy();

        const cmdX = x + beforeT.width;
        const bg = this.add.rectangle(cmdX, y - padY, cmdW + padX * 2, cmdH + padY * 2, 0x000000, 1)
            .setOrigin(0, 0);
        const cmdT = this.add.text(cmdX + padX, y, command, {
            fontFamily: style.fontFamily || PIXEL_UI_FONT,
            fontSize: style.fontSize || "16px",
            color: "#ffffff"
        }).setOrigin(0, 0);
        cmdT.setDepth((bg.depth || 0) + 1);
        this._track(bg, cmdT);

        const afterX = cmdX + bg.width;
        const firstW = Math.max(40, x + wrap - afterX);
        const probe = this.add.text(0, 0, after, {
            fontFamily: style.fontFamily || PIXEL_UI_FONT,
            fontSize: style.fontSize || "16px",
            color: style.color || "#c0b0a0"
        }).setOrigin(0, 0).setVisible(false);

        let first = after;
        let rest = "";
        if (probe.width > firstW) {
            // Fit as many words as possible on the same line as the command
            const words = after.split(/(\s+)/);
            first = "";
            rest = after;
            let built = "";
            for (let i = 0; i < words.length; i++) {
                const next = built + words[i];
                probe.setText(next);
                if (probe.width > firstW) break;
                built = next;
                first = built;
                rest = words.slice(i + 1).join("");
            }
            if (!first.trim()) {
                // Nothing fits beside the chip — put all of `after` on the next line
                first = "";
                rest = after;
            }
        }
        probe.destroy();

        let bottom = y + Math.max(beforeT.height, bg.height);
        if (first) {
            const firstT = this._track(this.add.text(afterX, y, first, {
                ...style,
                wordWrap: { width: firstW }
            }).setOrigin(0, 0));
            bottom = Math.max(bottom, y + firstT.height);
        }
        if (rest.trim()) {
            // Hang under "Run" (after the "2. " number), not under the command chip
            const numM = this.add.text(0, 0, before.match(/^\d+\.\s*/)?.[0] || "", { ...style })
                .setVisible(false);
            const hangX = x + numM.width;
            numM.destroy();
            const restT = this._track(this.add.text(hangX, bottom + Math.round(2 * s), rest.replace(/^\s+/, ""), {
                ...style,
                wordWrap: { width: Math.max(40, wrap - (hangX - x)) }
            }).setOrigin(0, 0));
            bottom = bottom + Math.round(2 * s) + restT.height;
        }
        return bottom;
    }

    _showMpHelp() {
        this._clear();
        this._phase = "mpHelp";
        const w = this.scale.width;
        const h = this.scale.height;
        const title = this._title("Hosting a server", 0.14);

        const s = this._uiScale();
        const repoUrl = "https://github.com/apotb/cave-paintings";
        const wrap = Math.min(Math.round(520 * s), Math.max(120, w - Math.round(48 * s)));
        const left = Math.round((w - wrap) / 2);
        const style = {
            fontFamily: PIXEL_UI_FONT,
            fontSize: this._uiFont(16),
            color: "#c0b0a0",
            align: "left",
            lineSpacing: Math.round(6 * s),
            wordWrap: { width: wrap }
        };

        const body = [];
        const keep = (...nodes) => {
            this._track(...nodes);
            for (const n of nodes) {
                if (n) body.push(n);
            }
            return nodes[0];
        };

        let y = 0;
        const gap = Math.round(14 * s);
        const addLine = (text, opts = {}) => {
            const t = keep(this.add.text(left, y, text, { ...style, ...opts }).setOrigin(0, 0));
            y += t.height + (opts.gapAfter ?? gap);
            return t;
        };

        addLine("1. Use Git to clone the repository:");
        const numW = (() => {
            const m = this.add.text(0, 0, "1. ", { ...style }).setVisible(false);
            const nw = m.width;
            m.destroy();
            return nw;
        })();
        const linkIndent = numW + Math.round(12 * s);
        const link = keep(this.add.text(left + linkIndent, y, repoUrl, {
            fontFamily: PIXEL_UI_FONT,
            fontSize: this._uiFont(16),
            color: "#d4a84b",
            wordWrap: { width: Math.max(40, wrap - linkIndent) }
        }).setOrigin(0, 0).setInteractive({ useHandCursor: true }));
        link.on("pointerover", () => link.setColor("#ffe08a"));
        link.on("pointerout", () => link.setColor("#d4a84b"));
        link.on("pointerup", () => {
            try {
                window.open(repoUrl, "_blank", "noopener,noreferrer");
            } catch (_) {}
        });
        y += link.height + Math.round(18 * s);

        const cmdFrom = this._dom.length;
        y = this._addCmdLine(
            left, y,
            "2. Run ", "npm install", " when you first clone the repository, or after you update it.",
            style, wrap
        ) + gap;
        y = this._addCmdLine(
            left, y,
            "3. Run ", "npm start", " to start the server.",
            style, wrap
        ) + gap;
        for (let i = cmdFrom; i < this._dom.length; i++) body.push(this._dom[i]);

        addLine(
            "You are responsible for making the server reachable. Port forward, use a tunnel (ngrok, Cloudflare, etc.), or any similar setup. The address shown on start is a LAN address and is inaccessible unless you are playing LAN on the downloaded client.",
            { gapAfter: 0 }
        );

        const textH = y;
        const padX = Math.round(28 * s);
        const padY = Math.round(22 * s);
        const titleGap = Math.round(18 * s);
        const btnGap = Math.round(20 * s);
        const btnH = this._buttonSizePreset("medium").height;
        const boxH = textH + padY * 2;
        const stackH = title.height + titleGap + boxH + btnGap + btnH;
        const fireH = 16 * 8;
        const minTop = Math.round(16 * s);
        const maxBottom = h - fireH;
        let top = Math.round((h - stackH) / 2);
        if (top < minTop) top = minTop;
        if (top + stackH > maxBottom) top = Math.max(minTop, maxBottom - stackH);

        title.setPosition(Math.round(w / 2 - title.width / 2), top);
        const textTop = top + title.height + titleGap + padY;
        for (const n of body) n.y += textTop;

        const box = this.add.rectangle(
            Math.round(w / 2),
            Math.round(textTop + textH / 2),
            wrap + padX * 2,
            boxH,
            0x000000,
            1
        );
        box.setDepth(-500);
        this._track(box);
        this._sendCaveBehind();

        this._button(
            Math.round(w / 2),
            Math.round(textTop + textH + padY + btnGap + btnH / 2),
            "Back",
            () => this._showMpHost()
        );
    }

    _cancelMpProbe() {
        if (this._mpProbe) {
            try {
                this._mpProbe.abort?.();
            } catch (_) {}
            this._mpProbe = null;
        }
        this._mpConnectGen = (this._mpConnectGen || 0) + 1;
        if (this._mpJoinNet) {
            try {
                this._mpJoinNet.close();
            } catch (_) {}
            this._mpJoinNet = null;
        }
    }

    async _probeMultiplayer() {
        const hst = (this.hostInput?.value || "127.0.0.1:21826").trim();
        localStorage.setItem("cp_join_host", hst);
        this._mpHost = hst;
        this._mpPassword = "";
        const url = NetClient.wsUrlFromHostPort(hst);
        this.status?.setColor?.("#c0b0a0");
        this.status?.setText("Connecting…");

        this._cancelMpProbe();
        const gen = this._mpConnectGen;
        const probe = NetClient.probe(url);
        this._mpProbe = probe;
        try {
            await probe;
            if (gen !== this._mpConnectGen || this._phase !== "mpHost") return;
            this._mpProbe = null;
            await this._showCharacters({ next: "join" });
        } catch (e) {
            if (this._mpProbe === probe) this._mpProbe = null;
            if (e?.name === "AbortError" || gen !== this._mpConnectGen) return;
            if (this._phase !== "mpHost") return;
            this.status?.setColor?.("#e06060");
            this.status?.setText(String(e.message || e));
        }
    }

    _isPasswordError(msg) {
        const s = String(msg || "").toLowerCase();
        return s.includes("password");
    }

    async _showMpPassword(opts = {}) {
        this._clear();
        this._phase = "mpPassword";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Password");
        this._status();
        const formW = this._menuFormW();
        this.passInput = this._domInput(
            w / 2 - formW / 2,
            h * 0.40,
            formW,
            "",
            opts.drafts?.pass ?? "",
            { type: "password", autocomplete: "current-password" }
        );
        this._clearStatusOnInput(this.passInput);
        if (!opts.relayout) {
            this.time.delayedCall(0, () => this.passInput?.focus?.());
        }
        this._button(w / 2, h * 0.55, "Join", async () => {
            this._mpPassword = this.passInput?.value || "";
            await this._joinMultiplayer();
        });
        this._button(w / 2, this._mediumStackY(h * 0.55, 1), "Back", () => this._showCharacters({ next: "join" }));
    }

    async _showCharacters({ next = null } = {}) {
        this._clear();
        this._phase = "characters";
        this._charNext = next;
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Characters");
        this._status(0.20);
        this._ensurePlayerAnims();

        let list = [];
        try {
            list = await CharacterStore.list();
        } catch (e) {
            this.status.setText(String(e.message || e));
        }

        const s = this._uiScale();
        const cardW = Math.min(Math.round(560 * s), w - 48);
        const cardH = Math.round(96 * s);
        const gap = Math.round(10 * s);
        const { viewTop, viewBottom, footerY, outlinePad } = this._cardListView();
        const listRoot = this.add.container(0, 0);
        this._track(listRoot);
        let y = viewTop + cardH / 2 + outlinePad;

        for (const c of list) {
            const lookKey = typeof PlayerLook !== "undefined"
                ? PlayerLook.ensure(this, c.look)
                : "human";
            const spr = this.add.sprite(0, 0, lookKey, 1);
            this._placePixelIcon(spr, 0, 0, 3 * this._uiScale());
            this._track(spr);
            if (typeof PlayerLook !== "undefined") PlayerLook.play(spr, "down", false);

            const activate = async () => {
                this._selectedCharacter = c;
                if (next === "worlds") await this._showWorlds();
                else if (next === "join") await this._joinMultiplayer();
            };

            const card = this._selectCard({
                x: Math.round(w / 2),
                y,
                width: cardW - (cardW % 2),
                height: cardH,
                cardId: `char:${c.id}`,
                iconNode: spr,
                title: c.name || "Player",
                lines: [
                    this._partyMembersLabel(c),
                    this._lastPlayedLabel(c)
                ].filter(Boolean),
                onActivate: activate,
                onRename: () => {
                    this._showRename({
                        kind: "character",
                        id: c.id,
                        currentName: c.name || "Player",
                        maxLen: 24
                    });
                },
                favorited: !!c.favorite,
                onFavorite: async (on) => {
                    try {
                        const row = await CharacterStore.setFavorite(c.id, on);
                        if (this._selectedCharacter?.id === c.id) this._selectedCharacter = row;
                        await this._showCharacters({ next });
                    } catch (e) {
                        this.status?.setText(String(e.message || e));
                    }
                },
                onExport: () => CharacterStore.download(c),
                onDelete: async () => {
                    await CharacterStore.remove(c.id);
                    if (this._selectedCharacter?.id === c.id) this._selectedCharacter = null;
                    await this._showCharacters({ next });
                },
                onHoverActive: (on) => {
                    if (!spr.active) return;
                    if (typeof PlayerLook !== "undefined") PlayerLook.play(spr, "down", on);
                    else spr.setFrame(1);
                }
            });
            for (const node of this._selectCardNodes(card, spr)) listRoot.add(node);

            y += cardH + gap;
        }

        const n = list.length;
        const contentH = n > 0 ? n * cardH + (n - 1) * gap + outlinePad * 2 : 0;
        this._bindCardListScroll(listRoot, { viewTop, viewBottom, contentH, outlinePad });
        this._listFooter(footerY, {
            onBack: () => {
                if (next === "join") this._showMpHost();
                else this._showRoot();
            },
            onImport: async () => {
                try {
                    const text = await CharacterStore.pickFile();
                    const c = CharacterStore.importJson(text);
                    await CharacterStore.put(c);
                    await this._showCharacters({ next });
                } catch (e) {
                    if (String(e.message) !== "No file") this.status.setText(String(e.message || e));
                }
            },
            onCreate: () => this._showCreateCharacter({ next })
        });
    }

    _createLookNormalized() {
        if (typeof Look !== "undefined") return Look.normalizeLook(this._createLook);
        return this._createLook || {
            head: 0xff00ee,
            eyes: 0x000000,
            arms: 0xff8900,
            shirt: 0x006cff,
            pants: 0xff0000,
            shoes: 0x7a6c47
        };
    }

    _refreshCreatePreview() {
        const spr = this._previewSprite;
        if (!spr?.active || typeof PlayerLook === "undefined") return;
        const look = this._createLookNormalized();
        this._createLook = look;
        PlayerLook.ensure(this, look, { key: PlayerLook.PREVIEW_KEY, replace: true });
        if (spr.texture?.key !== PlayerLook.PREVIEW_KEY) {
            spr.setTexture(PlayerLook.PREVIEW_KEY, 1);
        }
        const facings = ["down", "right", "up", "left"];
        PlayerLook.play(spr, facings[this._createFaceIdx] || "down", true);
        this._paintCreateSwatches();
    }

    _paintCreateSwatches() {
        const look = this._createLookNormalized();
        const part = this._createLookPart || "head";
        for (const row of this._createSwatches || []) {
            const color = look[row.part] >>> 0;
            row.rect.setFillStyle(color, 1);
            this._paintSwatchOutline(row, part);
        }
    }

    _paintSwatchOutline(row, selectedPart) {
        if (!row?.rect) return;
        const stroke = this._uiStroke();
        const selected = row.part === (selectedPart || this._createLookPart);
        if (selected || row.pressing) {
            row.rect.setStrokeStyle(stroke, 0xd4a84b);
        } else if (row.hovering) {
            row.rect.setStrokeStyle(stroke, 0xffffff);
        } else {
            row.rect.setStrokeStyle(stroke, 0x2a2218);
        }
    }

    _syncCreateSliders() {
        this._syncCreateHslFromLook();
    }

    _syncCreateHslFromLook() {
        const L = typeof Look !== "undefined" ? Look : null;
        if (!L) return;
        const look = this._createLookNormalized();
        const part = this._createLookPart || "head";
        const hsl = L.rgbToHsl(look[part]);
        const prev = this._createHsl || hsl;
        // Black/white have no hue — keep the last hue so the rainbow handle doesn't jump.
        this._createHsl = {
            h: hsl.s < 0.001 || hsl.l < 0.001 || hsl.l > 0.999 ? prev.h : hsl.h,
            s: hsl.s,
            l: hsl.l
        };
        this._paintCreateHslBars();
    }

    _copyCreateColor() {
        const look = this._createLookNormalized();
        const part = this._createLookPart || "head";
        const color = look[part] >>> 0;
        this._copiedColor = color;
        const hex = typeof Look !== "undefined" ? Look.css(color) : `#${color.toString(16).padStart(6, "0")}`;
        try {
            navigator.clipboard?.writeText?.(hex);
        } catch (_) {}
    }

    async _pasteCreateColor() {
        let color = this._copiedColor;
        try {
            const text = await navigator.clipboard?.readText?.();
            if (typeof Look !== "undefined" && text) {
                const parsed = Look.parseColor(String(text).trim());
                if (parsed != null) color = parsed;
            }
        } catch (_) {}
        if (color == null) {
            this.status?.setText("Copy a color first.");
            return;
        }
        const part = this._createLookPart || "head";
        this._copiedColor = color >>> 0;
        this._createLook = {
            ...this._createLookNormalized(),
            [part]: color >>> 0
        };
        this._syncCreateHslFromLook();
        this._refreshCreatePreview();
    }

    _applyCreateHsl() {
        const L = typeof Look !== "undefined" ? Look : null;
        if (!L || !this._createHsl) return;
        const part = this._createLookPart || "head";
        const { h, s, l } = this._createHsl;
        this._createLook = {
            ...this._createLookNormalized(),
            [part]: L.hslToRgb(h, s, l)
        };
        this._paintCreateHslBars();
        this._refreshCreatePreview();
    }

    _fillHslBar(g, x, y, w, h, colorAt) {
        g.clear();
        const width = Math.max(1, Math.round(w));
        for (let i = 0; i < width; i++) {
            const t = width <= 1 ? 0 : i / (width - 1);
            g.fillStyle(colorAt(t), 1);
            g.fillRect(x + i, y, 1, h);
        }
        g.lineStyle(this._uiStroke(), 0x000000, 1);
        g.strokeRect(x - 1, y - 1, width + 2, h + 2);
    }

    _paintCreateHslBars() {
        const bars = this._createHslBars;
        const L = typeof Look !== "undefined" ? Look : null;
        if (!bars || !L || !this._createHsl) return;
        const { h, s, l } = this._createHsl;
        this._fillHslBar(bars.hue.g, bars.x, bars.hue.y, bars.w, bars.bh, (t) => L.hslToRgb(t * 360, 1, 0.5));
        this._fillHslBar(bars.sat.g, bars.x, bars.sat.y, bars.w, bars.bh, (t) => L.hslToRgb(h, t, l));
        this._fillHslBar(bars.light.g, bars.x, bars.light.y, bars.w, bars.bh, (t) => L.hslToRgb(h, s, t));
        const tHue = Phaser.Math.Clamp(h / 360, 0, 1);
        const tSat = Phaser.Math.Clamp(s, 0, 1);
        const tLight = Phaser.Math.Clamp(l, 0, 1);
        bars.hue.handle.setPosition(Math.round(bars.x + tHue * bars.w), bars.hue.y + bars.bh / 2);
        bars.sat.handle.setPosition(Math.round(bars.x + tSat * bars.w), bars.sat.y + bars.bh / 2);
        bars.light.handle.setPosition(Math.round(bars.x + tLight * bars.w), bars.light.y + bars.bh / 2);
    }

    _hslSetFromPointer(kind, pointer) {
        const bars = this._createHslBars;
        if (!bars || !this._createHsl) return;
        const t = Phaser.Math.Clamp((pointer.worldX - bars.x) / bars.w, 0, 1);
        if (kind === "hue") this._createHsl.h = t * 360;
        else if (kind === "sat") this._createHsl.s = t;
        else this._createHsl.l = t;
        this._applyCreateHsl();
    }

    _bindCreateHslInput() {
        this._unbindCreateHslInput();
        this._onHslMove = (p) => {
            if (!this._hslDrag || !p.isDown) return;
            this._hslSetFromPointer(this._hslDrag, p);
        };
        this._onHslUp = () => { this._hslDrag = null; };
        this.input.on("pointermove", this._onHslMove);
        this.input.on("pointerup", this._onHslUp);
        this.input.on("pointerupoutside", this._onHslUp);
    }

    _makeHslBar(kind, x, y, w, bh) {
        const s = this._uiScale();
        const g = this.add.graphics();
        const hit = this.add.rectangle(x + w / 2, y + bh / 2, w + Math.round(8 * s), bh + Math.round(8 * s), 0x000000, 0.001)
            .setInteractive({ useHandCursor: true });
        hit.on("pointerdown", (p) => {
            this._hslDrag = kind;
            this._hslSetFromPointer(kind, p);
        });
        const handle = this.add.rectangle(x, y + bh / 2, Math.max(4, Math.round(4 * s)), bh + Math.round(4 * s), 0xffffff)
            .setStrokeStyle(this._uiStroke(), 0x000000)
            .setDepth(8);
        this._track(g, hit, handle);
        return { g, hit, handle, y };
    }

    _onCreateSliderInput() {
        this._applyCreateHsl();
    }

    _showCreateCharacter({ next = null, drafts = null, relayout = false } = {}) {
        this._clear();
        this._phase = "createCharacter";
        this._charNext = next;
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("New Character");
        this._status(0.94);

        const L = typeof Look !== "undefined" ? Look : null;
        if (drafts?.look) this._createLook = L ? L.normalizeLook(drafts.look) : drafts.look;
        else if (!relayout || !this._createLook) {
            this._createLook = L ? L.normalizeLook(null) : this._createLookNormalized();
        }
        this._createLookPart = drafts?.lookPart || this._createLookPart || "head";

        const s = this._uiScale();
        const facings = ["down", "right", "up", "left"];
        if (typeof drafts?.faceIdx === "number") this._createFaceIdx = drafts.faceIdx;
        else if (!relayout) this._createFaceIdx = 0;

        const previewScale = Math.max(1, Math.round((h < 640 ? 5 : 6) * s));
        const fw = 16;
        const previewW = fw * previewScale;
        const previewH = fw * previewScale;
        const gap = Math.round(20 * s);
        const colGap = Math.round(28 * s);
        const rotateR = Math.round(18 * s);
        const swatchH = Math.round(22 * s);
        const labelBelow = Math.round(24 * s);
        const barH = Math.round(8 * s);
        const sliderStep = Math.round(18 * s);
        const smallBtnH = this._buttonSizePreset("small").height;
        const nameH = Math.round(36 * s);
        const btnH = this._buttonSizePreset("medium").height;
        const formToBtn = Math.round(16 * s);
        const lookDiceSize = this._diceButtonSize();
        const arrowSpan = Math.round(52 * s);
        const leftControlsH = Math.max(lookDiceSize, rotateR * 2);
        const leftW = Math.max(previewW, arrowSpan * 2 + rotateR * 2, lookDiceSize);
        const leftH = previewH + Math.round(12 * s) + leftControlsH;

        const parts = L?.PARTS || ["head", "eyes", "arms", "shirt", "pants", "shoes"];
        const labels = L?.PART_LABELS || {};
        const swatchW = Math.round(36 * s);
        const swatchGap = Math.round(18 * s);
        const rowW = parts.length * swatchW + (parts.length - 1) * swatchGap;
        const fieldW = this._menuFormW();
        const pairGap = this._buttonSizePreset("medium").width + Math.round(16 * s);
        const pairW = this._buttonSizePreset("medium").width * 2 + Math.round(16 * s);
        const rightW = Math.max(fieldW, rowW, pairW);
        const formH = swatchH + labelBelow + gap + sliderStep * 2 + barH + gap + smallBtnH + gap + nameH + formToBtn + btnH;

        const totalW = leftW + colGap + rightW;
        const blockH = Math.max(leftH, formH);
        const titleBottom = Math.round(h * 0.14 + Math.round(24 * s));
        const minTop = titleBottom + Math.round(8 * s);
        const maxBot = h - Math.round(24 * s);
        let colTop = Math.round((h - blockH) / 2);
        if (colTop < minTop) colTop = minTop;
        if (colTop + blockH > maxBot) colTop = Math.max(minTop, maxBot - blockH);

        const blockLeft = Math.round((w - totalW) / 2);
        const leftMidX = blockLeft + Math.round(leftW / 2);
        const formMidX = blockLeft + leftW + colGap + Math.round(rightW / 2);
        const leftTop = colTop + Math.round((blockH - leftH) / 2);
        const formTop = colTop + Math.round((blockH - formH) / 2);
        const footY = Math.round(leftTop + previewH);
        const arrowY = Math.round(footY + Math.round(12 * s) + leftControlsH / 2);
        const rowY = Math.round(formTop + swatchH / 2);
        const sliderTop = Math.round(formTop + swatchH + labelBelow + gap);
        const copyY = Math.round(sliderTop + sliderStep * 2 + barH + gap + smallBtnH / 2);
        const nameY = Math.round(copyY + smallBtnH / 2 + gap);
        const btnY = Math.round(nameY + nameH + formToBtn + btnH / 2);

        const previewKey = typeof PlayerLook !== "undefined"
            ? PlayerLook.ensure(this, this._createLook, { key: PlayerLook.PREVIEW_KEY, replace: true })
            : "human";
        const spr = this.add.sprite(0, 0, previewKey, 1);
        const footX = Math.floor(leftMidX - previewW / 2);
        spr.setOrigin(0, 1);
        spr.setScale(previewScale);
        spr.setPosition(footX, footY);
        this._pixelFilter(previewKey);
        this._track(spr);
        this._previewSprite = spr;

        const playWalk = () => {
            const facing = facings[this._createFaceIdx];
            if (typeof PlayerLook !== "undefined") PlayerLook.play(spr, facing, true);
        };
        playWalk();

        this._roundArrow(Math.floor(leftMidX - arrowSpan), arrowY, "↺", () => {
            this._createFaceIdx = (this._createFaceIdx + 1) % 4;
            playWalk();
        });
        this._roundArrow(Math.floor(leftMidX + arrowSpan), arrowY, "↻", () => {
            this._createFaceIdx = (this._createFaceIdx + 3) % 4;
            playWalk();
        });
        this._diceButton(Math.floor(leftMidX), arrowY, () => {
            this._createLook = L ? L.randomLook() : this._createLook;
            this._syncCreateHslFromLook();
            this._refreshCreatePreview();
        });

        const rowX = Math.floor(formMidX - rowW / 2);
        this._createSwatches = [];
        parts.forEach((part, i) => {
            const cx = Math.round(rowX + i * (swatchW + swatchGap) + swatchW / 2);
            const rect = this.add.rectangle(cx, rowY, swatchW, swatchH, this._createLook[part] >>> 0, 1)
                .setStrokeStyle(this._uiStroke(), 0x2a2218)
                .setInteractive({ useHandCursor: true });
            const labelY = Math.round(rowY + swatchH / 2 + Math.round(6 * s));
            const label = this.add.text(Math.round(cx), labelY, labels[part] || part, {
                fontFamily: PIXEL_UI_FONT,
                fontSize: this._uiFont(16),
                color: "#c0b0a0"
            });
            crispUiText(label);
            if (typeof placeUiText === "function") placeUiText(label, Math.round(cx), labelY, 0.5, 0);
            else label.setOrigin(0.5, 0);
            const row = { part, rect, hovering: false, pressing: false };
            rect.on("pointerover", () => {
                row.hovering = true;
                this._paintSwatchOutline(row);
            });
            rect.on("pointerout", () => {
                row.hovering = false;
                row.pressing = false;
                this._paintSwatchOutline(row);
            });
            rect.on("pointerdown", () => {
                row.pressing = true;
                this._createLookPart = part;
                this._paintCreateSwatches();
                this._syncCreateHslFromLook();
            });
            rect.on("pointerup", () => {
                row.pressing = false;
                this._paintSwatchOutline(row);
            });
            this._track(rect, label);
            this._createSwatches.push(row);
        });
        this._paintCreateSwatches();

        const sliderW = fieldW;
        const sliderX = Math.floor(formMidX - sliderW / 2);
        this._createHslBars = {
            x: sliderX,
            w: sliderW,
            bh: barH,
            hue: this._makeHslBar("hue", sliderX, sliderTop, sliderW, barH),
            sat: this._makeHslBar("sat", sliderX, sliderTop + sliderStep, sliderW, barH),
            light: this._makeHslBar("light", sliderX, sliderTop + sliderStep * 2, sliderW, barH)
        };
        this._bindCreateHslInput();
        this._syncCreateHslFromLook();

        const copyGap = Math.round(88 * s);
        this._button(formMidX - copyGap, copyY, "Copy", () => this._copyCreateColor(), { size: "small" });
        this._button(formMidX + copyGap, copyY, "Paste", () => this._pasteCreateColor(), { size: "small" });

        const nameVal = drafts?.name != null ? drafts.name : "";
        const formLeft = Math.floor(formMidX - fieldW / 2);
        const nameDiceSize = this._diceButtonSize();
        const nameDiceGap = Math.round(8 * s);
        const nameW = Math.max(120, fieldW - nameDiceGap - nameDiceSize);
        this.nameInput = this._domInput(formLeft, nameY, nameW, "Name", nameVal);
        this.nameInput.maxLength = 24;
        this._clearStatusOnInput(this.nameInput);
        const nameInputH = this.nameInput.offsetHeight || nameH;
        this._diceButton(
            formLeft + fieldW - nameDiceSize / 2,
            nameY + nameInputH / 2,
            () => {
                const gen = typeof CavemanNames !== "undefined" ? CavemanNames.generate() : "Og";
                if (this.nameInput) this.nameInput.value = gen;
            },
            nameDiceSize
        );
        if (!relayout) this.nameInput.focus();

        this._button(formMidX - pairGap / 2, btnY, "Back", () => this._showCharacters({ next: this._charNext }));
        this._button(formMidX + pairGap / 2, btnY, "Create", async () => {
            try {
                const name = (this.nameInput?.value || "").trim();
                if (!name) {
                    this.status?.setText("Enter a name.");
                    this.nameInput?.focus();
                    return;
                }
                const c = await CharacterStore.create(name, this._createLookNormalized());
                this._selectedCharacter = c;
                await this._showCharacters({ next: this._charNext });
            } catch (e) {
                this.status?.setText(String(e.message || e));
            }
        });
        if (this.status) {
            this.status.setPosition(w / 2, Math.min(h - 16, btnY + btnH / 2 + 22));
        }
    }

    async _showWorlds() {
        if (!this._selectedCharacter) {
            await this._showCharacters({ next: "worlds" });
            return;
        }
        this._clear();
        this._phase = "worlds";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Worlds");
        this._status(0.20);

        let list = [];
        try {
            list = await WorldStore.list();
        } catch (e) {
            this.status.setText(String(e.message || e));
        }

        const s = this._uiScale();
        const cardW = Math.min(Math.round(560 * s), w - 48);
        const cardH = Math.round(96 * s);
        const gap = Math.round(10 * s);
        const { viewTop, viewBottom, footerY, outlinePad } = this._cardListView();
        const listRoot = this.add.container(0, 0);
        this._track(listRoot);
        let y = viewTop + cardH / 2 + outlinePad;
        const palmKey = this.textures.exists("menu-palm") ? "menu-palm" : null;

        for (const world of list) {
            let icon = null;
            if (palmKey) {
                this._pixelFilter(palmKey);
                icon = this.add.image(0, 0, palmKey);
                this._placePixelIcon(icon, 0, 0, 2 * this._uiScale());
                this._track(icon);
            }

            const card = this._selectCard({
                x: Math.round(w / 2),
                y,
                width: cardW - (cardW % 2),
                height: cardH,
                cardId: `world:${world.id}`,
                iconNode: icon,
                title: world.name || "World",
                lines: (() => {
                    const clock = this._formatWorldClock(world.clock);
                    return [
                        clock.day,
                        clock.time,
                        this._lastPlayedLabel(world)
                    ];
                })(),
                onActivate: () => this._startSingleplayer(world),
                onRename: () => {
                    this._showRename({
                        kind: "world",
                        id: world.id,
                        currentName: world.name || "World",
                        maxLen: 32
                    });
                },
                favorited: !!world.favorite,
                onFavorite: async (on) => {
                    try {
                        await WorldStore.setFavorite(world.id, on);
                        await this._showWorlds();
                    } catch (e) {
                        this.status?.setText(String(e.message || e));
                    }
                },
                onExport: () => WorldStore.download(world),
                onDelete: async () => {
                    await WorldStore.remove(world.id);
                    await this._showWorlds();
                }
            });
            for (const node of this._selectCardNodes(card, icon)) listRoot.add(node);

            y += cardH + gap;
        }

        const n = list.length;
        const contentH = n > 0 ? n * cardH + (n - 1) * gap + outlinePad * 2 : 0;
        this._bindCardListScroll(listRoot, { viewTop, viewBottom, contentH, outlinePad });
        this._listFooter(footerY, {
            onBack: () => this._showCharacters({ next: "worlds" }),
            onImport: async () => {
                try {
                    const text = await WorldStore.pickFile();
                    const world = WorldStore.importJson(text);
                    await WorldStore.put(world);
                    await this._showWorlds();
                } catch (e) {
                    if (String(e.message) !== "No file") this.status.setText(String(e.message || e));
                }
            },
            onCreate: () => this._showCreateWorld()
        });
    }

    /** Terrain color for spawn preview (matches generateTile biomes, no trees). */
    _previewTileColor(tx, ty) {
        const inv = 1 / 6000;
        const nx = tx * inv;
        const ny = ty * inv;
        const elevation = octaveNoise2D(nx, ny, 2, 0.5, 2.5, 0);
        const temperature = octaveNoise2D(nx, ny, 3, 0.2, 4.2, 1);
        const river = Math.abs(octaveNoise2D(nx, ny, 3, 1.2, 0.7, 2));
        if (river < 0.005) return 0x3a6ea5;
        if (elevation < -0.2) return temperature < -0.4 ? 0xc8d8e8 : 0x3a6ea5;
        if (river < 0.0065 && elevation < 0.14) return 0x7a7a70;
        if (elevation < -0.19) return temperature < -0.25 ? 0xe8eef2 : 0xc2b280;
        if (elevation < 0.15) {
            if (temperature < -0.25) return 0xeef2f6;
            if (temperature < 0.25) return 0x5a8f4a;
            return 0xc2b280;
        }
        if (elevation < 0.25) {
            if (temperature < -0.25) return 0xdde6ee;
            if (temperature < 0.25) return 0x4a7a3a;
            return 0xb0a070;
        }
        if (elevation < 0.55) {
            if (temperature < -0.25) return 0xd0d8e0;
            if (temperature < 0.25) return 0x6a6a68;
            return 0xa87850;
        }
        if (elevation < 0.7) return 0x6a6a68;
        return 0xd0d8e0;
    }

    _drawSpawnPreview(seed, centerX, centerY) {
        if (this._previewGfx) {
            try {
                this._previewGfx.destroy();
            } catch (_) {}
            this._previewGfx = null;
        }
        if (this._previewFrame) {
            try {
                this._previewFrame.destroy();
            } catch (_) {}
            this._previewFrame = null;
        }

        const s = Number(seed) >>> 0;
        if (typeof noise !== "undefined") noise.seed(s);
        if (typeof worldSeed !== "undefined") worldSeed = s;

        const ui = this._uiScale();
        const tiles = 11;
        const px = Math.max(1, Math.round(10 * ui));
        const half = (tiles * px) / 2;
        const worldTs = 16;
        const origin = Math.floor(tiles / 2);
        const framePad = Math.round(4 * ui);
        const cx = Math.round(centerX);
        const cy = Math.round(centerY);

        const frame = this.add.rectangle(cx, cy, tiles * px + framePad * 2, tiles * px + framePad * 2, 0x120e0a, 1)
            .setStrokeStyle(this._uiStroke(), 0x2a2218);
        this._track(frame);
        this._previewFrame = frame;

        const g = this.add.graphics();
        const left = Math.round(cx - half);
        const top = Math.round(cy - half);
        for (let ty = 0; ty < tiles; ty++) {
            for (let tx = 0; tx < tiles; tx++) {
                const wx = (tx - origin) * worldTs;
                const wy = (ty - origin) * worldTs;
                const color = this._previewTileColor(wx, wy);
                g.fillStyle(color, 1);
                g.fillRect(left + tx * px, top + ty * px, px, px);
            }
        }
        const inset = Math.max(1, Math.round(px * 0.3));
        g.fillStyle(0xe8dcc8, 1);
        g.fillRect(left + origin * px + inset, top + origin * px + inset, px - inset * 2, px - inset * 2);
        this._track(g);
        this._previewGfx = g;
    }

    _diceButtonSize(minSide = 0) {
        const s = this._uiScale();
        const texScale = Math.max(1, Math.round(2 * s));
        const pad = Math.round(4 * s);
        return Math.max(Math.round(minSide) || 0, 16 * texScale + pad * 2);
    }

    /** Square button with dice icon (seed / look reroll). */
    _diceButton(x, y, onClick, size) {
        const BG = 0x120e0a;
        const BG_PRESS = 0x0a0806;
        const OUTLINE = 0x2a2218;
        const OUTLINE_HOVER = 0xffffff;
        const OUTLINE_PRESS = 0xd4a84b; // gold

        const s = this._uiScale();
        const stroke = this._uiStroke();
        const icon = this.add.image(0, 0, "ui-dice");
        this._pixelFilter("ui-dice");
        const tw = icon.frame?.realWidth || icon.width || 16;
        const th = icon.frame?.realHeight || icon.height || 16;
        const glyph = Math.max(tw, th);
        const texScale = Math.max(1, Math.round(2 * s));
        const pad = Math.round(4 * s);
        const side = Math.max(
            this._diceButtonSize(size),
            glyph * texScale + pad * 2
        );
        const rect = this.add.rectangle(0, 0, side, side, BG, 1)
            .setStrokeStyle(stroke, OUTLINE)
            .setInteractive({ useHandCursor: true });
        this._placePixelIcon(icon, 0, 0, texScale);

        const root = this.add.container(Math.floor(x), Math.floor(y), [rect, icon]);
        let hovering = false;
        let pressing = false;
        const paint = () => {
            if (pressing) {
                rect.setFillStyle(BG_PRESS, 1);
                rect.setStrokeStyle(stroke, OUTLINE_PRESS);
            } else if (hovering) {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(stroke, OUTLINE_HOVER);
            } else {
                rect.setFillStyle(BG, 1);
                rect.setStrokeStyle(stroke, OUTLINE);
            }
        };
        rect.on("pointerover", () => {
            hovering = true;
            paint();
        });
        rect.on("pointerout", () => {
            hovering = false;
            pressing = false;
            paint();
        });
        rect.on("pointerdown", () => {
            pressing = true;
            paint();
        });
        rect.on("pointerup", () => {
            const was = pressing;
            pressing = false;
            paint();
            if (was && hovering) onClick?.();
        });
        this._track(root);
        return root;
    }

    _showCreateWorld({ drafts = null, relayout = false } = {}) {
        this._clear();
        this._phase = "createWorld";
        const w = this.scale.width;
        const h = this.scale.height;
        this._title("Create");
        this._status(0.94);

        let seed;
        if (drafts?.seed != null && Number.isFinite(Number(drafts.seed))) {
            seed = Number(drafts.seed) >>> 0;
        } else {
            seed = WorldStore.findPlayableSeed(WorldStore.randomSeed());
        }

        const s = this._uiScale();
        const tiles = 11;
        const px = Math.max(1, Math.round(10 * s));
        const previewPad = Math.round(4 * s);
        const previewSize = tiles * px + previewPad * 2;
        const formW = this._menuFormW();
        const formLeft = w / 2 - formW / 2;
        const nameH = Math.round(36 * s);
        const diceSize = this._diceButtonSize();
        const rowGap = Math.round(12 * s);
        const formToBtn = Math.round(16 * s);
        const btnH = this._buttonSizePreset("medium").height;
        const titleBottom = Math.round(h * 0.14 + Math.round(24 * s));
        const availTop = titleBottom + Math.round(12 * s);
        const availBot = h - Math.round(36 * s);
        const columnH = previewSize + rowGap + nameH + rowGap + Math.max(nameH, diceSize) + formToBtn + btnH;
        const availH = Math.max(0, availBot - availTop);
        const colTop = availTop + Math.max(0, Math.floor((availH - columnH) / 2));
        const previewX = Math.round(w / 2);
        const previewY = Math.round(colTop + previewSize / 2);
        const nameY = Math.round(colTop + previewSize + rowGap);

        this._drawSpawnPreview(seed, previewX, previewY);

        const worldName = drafts?.worldName != null ? drafts.worldName : "New World";
        this.worldNameInput = this._domInput(formLeft, nameY, formW, "", worldName);
        this.worldNameInput.maxLength = 32;
        this._clearStatusOnInput(this.worldNameInput);

        const inputH = this.worldNameInput.offsetHeight || nameH;
        const seedGap = Math.round(8 * s);
        const seedW = Math.max(Math.round(120 * s), formW - seedGap - diceSize);
        const seedY = Math.round(nameY + inputH + rowGap);

        this.seedInput = this._domInput(formLeft, seedY, seedW, "", String(seed));
        this._diceButton(
            formLeft + formW - diceSize / 2,
            seedY + inputH / 2,
            () => {
                seed = WorldStore.findPlayableSeed(WorldStore.randomSeed());
                if (this.seedInput) this.seedInput.value = String(seed);
                this._drawSpawnPreview(seed, previewX, previewY);
            },
            diceSize
        );

        const refreshPreviewFromInput = () => {
            const raw = Number(this.seedInput?.value);
            if (!Number.isFinite(raw)) return;
            seed = raw >>> 0;
            this._drawSpawnPreview(seed, previewX, previewY);
        };
        this.seedInput.addEventListener("input", refreshPreviewFromInput);
        this.seedInput.addEventListener("change", refreshPreviewFromInput);
        if (!relayout) this.worldNameInput.focus();

        const seedBottom = seedY + Math.max(inputH, diceSize);
        const btnY = Math.round(seedBottom + formToBtn + btnH / 2);
        const pairGap = this._buttonSizePreset("medium").width + Math.round(16 * s);
        this._button(w / 2 - pairGap / 2, btnY, "Back", () => this._showWorlds());
        this._button(w / 2 + pairGap / 2, btnY, "Create", async () => {
            try {
                const name = (this.worldNameInput?.value || "New World").trim() || "New World";
                let nextSeed = Number(this.seedInput?.value);
                if (!Number.isFinite(nextSeed)) nextSeed = WorldStore.randomSeed();
                nextSeed = WorldStore.findPlayableSeed(nextSeed >>> 0);
                await WorldStore.create(name, { seed: nextSeed });
                await this._showWorlds();
            } catch (e) {
                this.status?.setText(String(e.message || e));
            }
        });
        if (this.status) {
            this.status.setPosition(w / 2, Math.min(h - 16, btnY + btnH / 2 + 22));
        }
    }

    async _startSingleplayer(world) {
        if (this._startingSp) return;
        const character = this._selectedCharacter;
        if (!character || !world) return;
        this._startingSp = true;
        this._cleanupDomOnly();
        try {
            const freshChar = await CharacterStore.get(character.id) || character;
            const freshWorld = await WorldStore.get(world.id) || world;
            const net = new LocalSim({ world: freshWorld, character: freshChar });
            try {
                const welcome = await net.connect();
                this._stopTitleMusic();
                this._startingSp = false;
                this.scene.start("SceneMain", {
                    net,
                    welcome,
                    displayName: freshChar.name,
                    characterId: freshChar.id,
                    character: freshChar,
                    localWorldId: freshWorld.id,
                    worldName: freshWorld.name,
                    joinHost: "local"
                });
            } catch (e) {
                await net.close();
                this.status?.setColor?.("#e06060");
                this.status?.setText(String(e.message || e));
                this._startingSp = false;
            }
        } catch (e) {
            this.status?.setColor?.("#e06060");
            this.status?.setText(String(e.message || e));
            this._startingSp = false;
        }
    }

    async _joinMultiplayer() {
        const character = this._selectedCharacter;
        if (!character) {
            this.status?.setText("Pick a character first.");
            return;
        }
        const host = this._mpHost || localStorage.getItem("cp_join_host") || "127.0.0.1:21826";
        const password = this._mpPassword || "";
        this.status?.setColor?.("#c0b0a0");
        this.status?.setText("Connecting…");
        this._cancelMpProbe();
        const gen = this._mpConnectGen;
        const net = new NetClient();
        this._mpJoinNet = net;
        const url = NetClient.wsUrlFromHostPort(host);
        try {
            const freshChar = await CharacterStore.get(character.id) || character;
            const snap = CharacterStore.toJoinSnapshot(freshChar);
            const welcome = await net.connect(url, {
                characterId: freshChar.id,
                displayName: freshChar.name,
                password,
                character: snap
            });
            if (gen !== this._mpConnectGen || this._mpJoinNet !== net) {
                try { net.close(); } catch (_) {}
                return;
            }
            this._mpJoinNet = null;
            this._clear();
            this._stopTitleMusic();
            this.scene.start("SceneMain", {
                net,
                welcome,
                displayName: freshChar.name,
                characterId: freshChar.id,
                character: freshChar,
                worldName: welcome?.worldName,
                joinHost: host
            });
        } catch (e) {
            if (this._mpJoinNet === net) this._mpJoinNet = null;
            try { net.close(); } catch (_) {}
            if (e?.name === "AbortError" || gen !== this._mpConnectGen) return;
            const msg = String(e.message || e);
            if (this._isPasswordError(msg)) {
                await this._showMpPassword();
                if (msg.toLowerCase().includes("bad")) {
                    this.status?.setColor?.("#e06060");
                    this.status?.setText(msg);
                }
                return;
            }
            // Only show errors on the screen that started the join
            if (this._phase !== "characters" && this._phase !== "mpPassword") return;
            this.status?.setColor?.("#e06060");
            this.status?.setText(msg);
        }
    }

    _cleanupDomOnly() {
        for (const o of this._dom) {
            if (o && o.tagName) {
                try {
                    o.remove();
                } catch (_) {}
            }
        }
        this._dom = this._dom.filter((o) => o && !o.tagName);
        this.hostInput = this.passInput = this.nameInput = this.worldNameInput = this.seedInput = this.renameInput = null;
        this._syncKeyboardForDom();
    }

    shutdown() {
        if (this._resizeTimer) {
            clearTimeout(this._resizeTimer);
            this._resizeTimer = null;
        }
        if (this._onResize) {
            this.scale.off("resize", this._onResize);
            this._onResize = null;
        }
        this._stopTitleMusic();
        try { this._destroyCavePaintings(); } catch (_) {}
        try { this._destroyMenuCampfire(); } catch (_) {}
        try { this._destroyCaveFire(); } catch (_) {}
        this._unbindVolumeSlider();
        this._unbindCreateHslInput();
        this._unbindCardListScroll();
        this._cleanupDomOnly();
        if (this._onMenuKeydown) {
            document.removeEventListener("keydown", this._onMenuKeydown, true);
            this._onMenuKeydown = null;
        }
        if (this.game?.canvas) this.game.canvas.tabIndex = 0;
        if (this.input?.keyboard) this.input.keyboard.enabled = true;
    }
}
