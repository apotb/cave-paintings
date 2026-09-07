/**
 * Looping BGM via Web Audio (same graph as the title theme).
 * One track at a time; volume follows Settings.musicGain().
 */
const GameMusic = {
    _wantedKey: null,
    _playingKey: null,
    _src: null,
    _gain: null,
    _onUnlock: null,
    _onVis: null,
    _scene: null,

    volume() {
        return typeof Settings !== "undefined" ? Settings.musicGain() : 0.85;
    },

    play(scene, key, opts = {}) {
        if (!scene || !key) return;
        this._scene = scene;
        this._wantedKey = key;
        const sound = scene.sound;
        if (sound) sound.pauseOnBlur = false;
        if (typeof patchPhaserAudioTabHitch === "function") patchPhaserAudioTabHitch(scene.game);
        this._discardHtmlTitleAudio(scene);
        this._unbindUnlock();
        this._bindVis();
        const go = () => {
            if (this._wantedKey !== key) return;
            if (!scene.sys) return;
            const status = scene.sys.settings?.status;
            if (status == null || status >= Phaser.Scenes.SLEEPING) return;
            this._unbindUnlock();
            this._playNow(scene, key, { fade: opts.fade !== false });
        };
        if (sound?.locked) {
            this._onUnlock = go;
            sound.once("unlocked", this._onUnlock);
        } else {
            go();
        }
    },

    stop() {
        this._wantedKey = null;
        this._playingKey = null;
        this._unbindUnlock();
        this._unbindVis();
        this._stopGraph();
        const scene = this._scene;
        this._scene = null;
        if (scene) {
            this._discardHtmlTitleAudio(scene);
            try { scene.sound?.stopByKey?.("title"); } catch (_) {}
            try { scene.sound?.stopByKey?.("forest"); } catch (_) {}
        }
    },

    applyVolume() {
        const vol = this.volume();
        const gain = this._gain;
        const ctx = this._scene?.sound?.context;
        if (!gain || !ctx) return;
        try {
            gain.gain.cancelScheduledValues(ctx.currentTime);
            gain.gain.setValueAtTime(vol, ctx.currentTime);
        } catch (_) {
            try { gain.gain.value = vol; } catch (_) {}
        }
    },

    _playNow(scene, key, opts = {}) {
        if (this._wantedKey !== key) return;
        const ctx = scene.sound?.context;
        const buf = scene.cache?.audio?.get?.(key);
        if (!ctx || !buf) return;
        if (this._src && this._gain && this._playingKey === key) {
            this.applyVolume();
            return;
        }
        this._stopGraph();
        this._playingKey = null;
        const fade = !!opts.fade;
        const vol = this.volume();
        try {
            const gain = ctx.createGain();
            const dest = scene.sound.destination || ctx.destination;
            gain.connect(dest);
            gain.gain.value = fade ? 0 : vol;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            src.connect(gain);
            src.start(0);
            this._src = src;
            this._gain = gain;
            this._playingKey = key;
            if (fade) {
                const now = ctx.currentTime;
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(vol, now + 1.4);
            }
        } catch (_) {}
    },

    _stopGraph() {
        const src = this._src;
        const gain = this._gain;
        this._src = null;
        this._gain = null;
        if (src) {
            try { src.onended = null; } catch (_) {}
            try { src.stop(); } catch (_) {}
            try { src.disconnect(); } catch (_) {}
        }
        if (gain) {
            try { gain.disconnect(); } catch (_) {}
        }
    },

    _bindVis() {
        this._unbindVis();
        this._onVis = () => {
            if (document.visibilityState !== "visible") return;
            if (!this._wantedKey) return;
            const ctx = this._scene?.sound?.context;
            if (!ctx) return;
            if (ctx.state === "suspended" || ctx.state === "interrupted") {
                try { ctx.resume(); } catch (_) {}
            }
        };
        document.addEventListener("visibilitychange", this._onVis);
    },

    _unbindVis() {
        if (this._onVis) {
            try { document.removeEventListener("visibilitychange", this._onVis); } catch (_) {}
        }
        this._onVis = null;
    },

    _unbindUnlock() {
        const sound = this._scene?.sound;
        if (this._onUnlock && sound) {
            try { sound.off("unlocked", this._onUnlock); } catch (_) {}
        }
        this._onUnlock = null;
    },

    _discardHtmlTitleAudio(scene) {
        const el = scene?.game?._cpTitleAudio;
        if (!el) return;
        try { el.pause(); } catch (_) {}
        try { el.removeAttribute("src"); el.load?.(); } catch (_) {}
        scene.game._cpTitleAudio = null;
    }
};
