/**
 * Bake a player look into a 48×64 spritesheet (16×16 frames) via canvas multiply.
 * Depends on shared/look.js (`Look`) and the six `player-*` part textures.
 */
const PlayerLook = (() => {
    const SHEET_W = 48;
    const SHEET_H = 64;
    const FRAME = 16;
    const FRAMES = 12;
    const DIRS = ["down", "left", "right", "up"];

    function data() {
        return typeof Look !== "undefined" ? Look : null;
    }

    function partsReady(scene) {
        const L = data();
        if (!L || !scene?.textures) return false;
        return L.DRAW_ORDER.every((part) => scene.textures.exists(L.partTextureKey(part)));
    }

    function loadParts(scene) {
        const L = data();
        if (!L || !scene?.load) return;
        for (const part of L.PARTS) {
            const key = L.partTextureKey(part);
            if (scene.textures?.exists(key)) continue;
            scene.load.image(key, `assets/player/${part}.png`);
        }
    }

    function partImage(scene, part) {
        const L = data();
        const key = L.partTextureKey(part);
        if (!scene.textures.exists(key)) return null;
        const tex = scene.textures.get(key);
        return tex.getSourceImage?.() || tex.source?.[0]?.image || null;
    }

    function paint(canvas, scene, look) {
        const L = data();
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, SHEET_W, SHEET_H);
        if (!L) return;
        const n = L.normalizeLook(look);
        const off = canvas._partScratch || document.createElement("canvas");
        off.width = SHEET_W;
        off.height = SHEET_H;
        canvas._partScratch = off;
        const octx = off.getContext("2d");
        for (const part of L.DRAW_ORDER) {
            const img = partImage(scene, part);
            if (!img) continue;
            octx.clearRect(0, 0, SHEET_W, SHEET_H);
            octx.globalCompositeOperation = "source-over";
            octx.drawImage(img, 0, 0);
            octx.globalCompositeOperation = "multiply";
            octx.fillStyle = L.css(n[part]);
            octx.fillRect(0, 0, SHEET_W, SHEET_H);
            octx.globalCompositeOperation = "destination-in";
            octx.drawImage(img, 0, 0);
            ctx.globalCompositeOperation = "source-over";
            ctx.drawImage(off, 0, 0);
        }
    }

    function addFrames(tex) {
        if (typeof Phaser !== "undefined" && Phaser.Textures?.Parsers?.SpriteSheet) {
            try {
                Phaser.Textures.Parsers.SpriteSheet(tex, 0, 0, 0, SHEET_W, SHEET_H, {
                    frameWidth: FRAME,
                    frameHeight: FRAME
                });
                return;
            } catch (_) { /* fall through */ }
        }
        for (let i = 0; i < FRAMES; i++) {
            if (tex.has(i) || tex.has(String(i))) continue;
            const x = (i % 3) * FRAME;
            const y = Math.floor(i / 3) * FRAME;
            tex.add(i, 0, x, y, FRAME, FRAME);
        }
    }

    function ensureAnims(scene, texKey) {
        if (!scene?.anims || !texKey) return;
        const anims = scene.anims;
        for (let row = 0; row < 4; row++) {
            const dir = DIRS[row];
            const start = row * 3;
            const walk = `${texKey}-walk-${dir}`;
            const idle = `${texKey}-idle-${dir}`;
            if (!anims.exists(walk)) {
                anims.create({
                    key: walk,
                    frames: anims.generateFrameNumbers(texKey, { start, end: start + 2 }),
                    frameRate: 5,
                    repeat: -1,
                    yoyo: true
                });
            }
            if (!anims.exists(idle)) {
                anims.create({
                    key: idle,
                    frames: [{ key: texKey, frame: start + 1 }],
                    frameRate: 10
                });
            }
        }
    }

    function nearest(scene, key) {
        try {
            scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
        } catch (_) {}
    }

    /**
     * Bake (or reuse) a spritesheet for this look.
     * @param {Phaser.Scene} scene
     * @param {object} look
     * @param {{ key?: string, replace?: boolean }} [opts]
     * @returns {string} texture key
     */
    function ensure(scene, look, opts = {}) {
        const L = data();
        const n = L ? L.normalizeLook(look) : look;
        const key = opts.key || (L ? L.lookKey(n) : "look-default");
        if (!scene?.textures) return key;
        if (!partsReady(scene)) {
            return scene.textures.exists("human") ? "human" : key;
        }

        if (scene.textures.exists(key) && !opts.replace) {
            ensureAnims(scene, key);
            return key;
        }

        const canvas = document.createElement("canvas");
        canvas.width = SHEET_W;
        canvas.height = SHEET_H;
        paint(canvas, scene, n);

        if (scene.textures.exists(key)) {
            const tex = scene.textures.get(key);
            const dest = tex.source?.[0]?.image;
            if (dest && dest.getContext) {
                const dctx = dest.getContext("2d");
                dctx.clearRect(0, 0, SHEET_W, SHEET_H);
                dctx.drawImage(canvas, 0, 0);
                tex.refresh();
            }
            nearest(scene, key);
            ensureAnims(scene, key);
            return key;
        }

        const tex = scene.textures.addCanvas(key, canvas);
        addFrames(tex);
        nearest(scene, key);
        ensureAnims(scene, key);
        return key;
    }

    function apply(sprite, look, opts = {}) {
        if (!sprite?.scene) return null;
        const key = ensure(sprite.scene, look, opts);
        const frame = sprite.frame?.name;
        if (sprite.texture?.key !== key) {
            const n = Number(frame);
            sprite.setTexture(key, Number.isFinite(n) ? n : 1);
        }
        sprite.look = data() ? data().normalizeLook(look) : look;
        return key;
    }

    function play(sprite, facing, moving) {
        if (!sprite) return;
        const tex = sprite.texture?.key;
        if (!tex) return;
        const dir = facing || "down";
        const key = `${tex}-${moving ? "walk" : "idle"}-${dir}`;
        const anims = sprite.scene?.anims;
        if (anims?.exists(key)) sprite.play(key, true);
        else {
            const idleFrame = { down: 1, left: 4, right: 7, up: 10 }[dir] ?? 1;
            sprite.setFrame?.(idleFrame);
        }
    }

    function fistColor(look) {
        const L = data();
        const n = L ? L.normalizeLook(look) : look;
        const c = n?.arms;
        return Number.isFinite(c) ? (c >>> 0) : 0xff8900;
    }

    function resolveTexture(scene, key, look) {
        if (look && partsReady(scene)) return ensure(scene, look);
        if (key && key !== "player" && scene.textures.exists(key)) return key;
        if (scene.textures.exists("human")) return "human";
        if (key && scene.textures.exists(key)) return key;
        return "human";
    }

    return {
        partsReady,
        loadParts,
        ensure,
        ensureAnims,
        apply,
        play,
        fistColor,
        resolveTexture,
        PREVIEW_KEY: "look-preview"
    };
})();
