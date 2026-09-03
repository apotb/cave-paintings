/**
 * Client prefs (localStorage). GUI scale and music volume are shared by
 * the title menu and in-game pause Options.
 */
const Settings = {
    GUI_SCALE_KEY: "cp_gui_scale",
    MUSIC_VOLUME_KEY: "cp_music_volume",
    MUSIC_VOLUME_DEFAULT: 85,

    loadGuiScale() {
        try {
            const n = Number(localStorage.getItem(this.GUI_SCALE_KEY));
            if (Number.isFinite(n) && n >= 0) return Math.floor(n);
        } catch (_) {}
        return 0;
    },

    saveGuiScale(pref) {
        try {
            localStorage.setItem(this.GUI_SCALE_KEY, String(pref | 0));
        } catch (_) {}
    },

    loadMusicVolume() {
        try {
            const raw = localStorage.getItem(this.MUSIC_VOLUME_KEY);
            if (raw == null || raw === "") return this.MUSIC_VOLUME_DEFAULT;
            const n = Number(raw);
            if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
        } catch (_) {}
        return this.MUSIC_VOLUME_DEFAULT;
    },

    saveMusicVolume(percent) {
        const n = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        try {
            localStorage.setItem(this.MUSIC_VOLUME_KEY, String(n));
        } catch (_) {}
        return n;
    },

    /** Phaser gain for the stored (or given) 0–100 percent. */
    musicGain(percent) {
        const n = percent == null ? this.loadMusicVolume() : percent;
        const t = Math.max(0, Math.min(1, (Number(n) || 0) / 100));
        return t;
    },

    /**
     * Largest integer GUI scale that fits this window.
     * 480×360 reference so 1080p reaches 3 (not 1080/768 ≈ 1.4).
     */
    guiScaleFit(w, h) {
        const ww = w || window.innerWidth || 1024;
        const hh = h || window.innerHeight || 768;
        return Math.min(ww / 480, hh / 360);
    },

    getMaxGuiScaleOption(w, h) {
        return Math.max(1, Math.floor(this.guiScaleFit(w, h)));
    },

    guiScaleButtonLabel(pref) {
        const n = pref | 0;
        return n === 0 ? "GUI Scale: Auto" : `GUI Scale: ${n}`;
    },

    cycleGuiScale(pref, max) {
        const cap = Math.max(1, max | 0);
        let cur = pref | 0;
        if (cur < 0 || cur > cap) cur = 0;
        let next = cur + 1;
        if (next > cap) next = 0;
        return next;
    },

    /** Integer GUI scale for this window. 0 in storage means Auto (largest that fits). */
    resolveUiScale(pref, w, h) {
        const max = this.getMaxGuiScaleOption(w, h);
        let n = pref | 0;
        if (n < 0) n = 0;
        if (n > max) n = max;
        return n === 0 ? max : n;
    },

    /**
     * Click/drag bar, 0–100. Returns { nodes, destroy, setPosition, setValue, value }.
     * Call destroy() before the scene wipes display objects so input listeners drop.
     */
    makePercentSlider(scene, opts = {}) {
        const s = Math.max(1, Number(opts.scale) || 1);
        const width = Math.max(40, Math.round(opts.width || 280));
        const height = Math.max(8, Math.round(opts.height || 16));
        let x = Math.round(opts.x || 0);
        let y = Math.round(opts.y || 0);
        let value = Math.max(0, Math.min(100, Math.round(Number(opts.value) || 0)));
        let dragging = false;
        const stroke = Math.max(2, Math.round(2 * s));
        const handleW = Math.max(5, Math.round(5 * s));
        const handleH = height + Math.round(8 * s);
        const fontPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(16, 1) : 16;

        const g = scene.add.graphics();
        const hit = scene.add.rectangle(x + width / 2, y + height / 2, width + Math.round(10 * s), height + Math.round(14 * s), 0x000000, 0.001)
            .setInteractive({ useHandCursor: true });
        const handle = scene.add.rectangle(x, y + height / 2, handleW, handleH, 0xffffff)
            .setStrokeStyle(stroke, 0x000000);
        const pct = scene.add.text(x + width + Math.round(14 * s), y + height / 2, `${value}%`, {
            fontFamily: typeof PIXEL_UI_FONT !== "undefined" ? PIXEL_UI_FONT : "monospace",
            fontSize: `${fontPx}px`,
            color: "#d4c4a8"
        }).setOrigin(0, 0.5);
        if (typeof applyPixelUiFont === "function") applyPixelUiFont(pct, 16, s);
        else if (typeof crispUiText === "function") crispUiText(pct);

        const paint = () => {
            g.clear();
            g.fillStyle(0x2a2218, 1);
            g.fillRect(x, y, width, height);
            const fillW = Math.round(width * (value / 100));
            if (fillW > 0) {
                g.fillStyle(0xd4a84b, 1);
                g.fillRect(x, y, fillW, height);
            }
            g.lineStyle(stroke, 0x6a5a4a, 1);
            g.strokeRect(x, y, width, height);
            handle.setPosition(Math.round(x + fillW), Math.round(y + height / 2));
            hit.setPosition(x + width / 2, y + height / 2);
            pct.setText(`${value}%`);
            pct.setPosition(Math.round(x + width + Math.round(14 * s)), Math.round(y + height / 2));
        };

        const pointerX = (pointer) => pointer?.position?.x ?? pointer?.x ?? 0;

        const setFromPointer = (pointer) => {
            const t = Phaser.Math.Clamp((pointerX(pointer) - x) / width, 0, 1);
            const next = Math.round(t * 100);
            if (next === value) {
                paint();
                return;
            }
            value = next;
            paint();
            opts.onChange?.(value);
        };

        hit.on("pointerdown", (pointer) => {
            dragging = true;
            setFromPointer(pointer);
        });
        const onMove = (pointer) => {
            if (dragging) setFromPointer(pointer);
        };
        const onUp = () => { dragging = false; };
        scene.input?.on?.("pointermove", onMove);
        scene.input?.on?.("pointerup", onUp);
        scene.input?.on?.("pointerupoutside", onUp);
        paint();

        const nodes = [g, hit, handle, pct];
        return {
            nodes,
            get value() { return value; },
            setValue(n, silent) {
                value = Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
                paint();
                if (!silent) opts.onChange?.(value);
            },
            setPosition(nx, ny) {
                x = Math.round(nx);
                y = Math.round(ny);
                paint();
            },
            destroy() {
                dragging = false;
                try { scene.input?.off?.("pointermove", onMove); } catch (_) {}
                try { scene.input?.off?.("pointerup", onUp); } catch (_) {}
                try { scene.input?.off?.("pointerupoutside", onUp); } catch (_) {}
                for (const n of nodes) {
                    try { n.destroy?.(); } catch (_) {}
                }
            }
        };
    }
};
