/**
 * Bake a player look into a 48×64 spritesheet (16×16 frames) via canvas multiply.
 * Depends on shared/look.js (`Look`), shared/apparel.js (`Apparel`), the six
 * `player-*` part textures, and precolored sheets in assets/player/armor.
 */
const PlayerLook = (() => {
    const SHEET_W = 48;
    const SHEET_H = 64;
    const FRAME = 16;
    const FRAMES = 12;
    const DIRS = ["down", "left", "right", "up"];
    /** Worn sheets. Item-icon keys stay on the item id, so these use a prefix. */
    const ARMOR_IDS = [
        "cactus_flower",
        "hide_loincloth",
        "hide_tunic",
        "leaf_loincloth",
        "leaf_sandals",
        "leaf_wrap",
        "leather_kilt",
        "leather_tunic"
    ];

    function armorTextureKey(id) {
        return `player-armor-${id}`;
    }

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
        for (const id of ARMOR_IDS) {
            const key = armorTextureKey(id);
            if (scene.textures?.exists(key)) continue;
            scene.load.image(key, `assets/player/armor/${id}.png`);
        }
    }

    function sourceImage(scene, key) {
        if (!scene?.textures?.exists(key)) return null;
        const tex = scene.textures.get(key);
        return tex.getSourceImage?.() || tex.source?.[0]?.image || null;
    }

    function partImage(scene, part) {
        const L = data();
        return sourceImage(scene, L.partTextureKey(part));
    }

    /**
     * Equipped ids whose armor sheet is loaded, inner layers first.
     * @param {Phaser.Scene} scene
     * @param {string[]} [worn]
     * @returns {string[]}
     */
    function orderedWorn(scene, worn) {
        const ids = Array.isArray(worn) ? worn.filter((id) => typeof id === "string" && id) : [];
        const getItem = (id) => {
            if (typeof scene?.getItem === "function") {
                const def = scene.getItem(id);
                if (def) return def;
            }
            if (typeof DataStore !== "undefined" && DataStore.getItem) return DataStore.getItem(id);
            return null;
        };
        const ordered = (typeof Apparel !== "undefined" && Apparel.visualDrawOrder)
            ? Apparel.visualDrawOrder(ids, getItem)
            : ids.slice();
        return ordered.filter((id) => !!sourceImage(scene, armorTextureKey(id)));
    }

    function itemDef(scene, id) {
        if (typeof scene?.getItem === "function") {
            const def = scene.getItem(id);
            if (def) return def;
        }
        if (typeof DataStore !== "undefined" && DataStore.getItem) return DataStore.getItem(id);
        return null;
    }

    function textureKey(look, wornIds, missing) {
        const L = data();
        const base = L ? L.lookKey(look) : "look-default";
        const worn = (!wornIds || !wornIds.length) ? base : `${base}~${wornIds.join("+")}`;
        const suffix = L ? L.missingSuffix(missing) : "";
        return suffix ? `${worn}~m${suffix}` : worn;
    }

    function scratchOf(canvas) {
        const off = canvas._partScratch || document.createElement("canvas");
        off.width = SHEET_W;
        off.height = SHEET_H;
        canvas._partScratch = off;
        return off;
    }

    /** Drop erased limb pixels from a scratch that already holds the part. */
    function eraseRects(octx, rects) {
        if (!rects || !rects.length) return;
        octx.globalCompositeOperation = "destination-out";
        octx.fillStyle = "#000";
        for (const r of rects) octx.fillRect(r.x, r.y, r.w, r.h);
    }

    /**
     * Armor shares the limb it covers. Head gear leaves with the head.
     * Torso, back, and waist sheets stay, including when the torso is destroyed.
     * @returns {"skip"|"pants"|"shoes"|null}
     */
    function armorMask(scene, id, missing) {
        if (!missing) return null;
        const slot = String(itemDef(scene, id)?.equip?.slot || "");
        if (slot === "head") return missing.head ? "skip" : null;
        if (slot === "legs") return "pants";
        if (slot === "feet") return "shoes";
        return null;
    }

    function paint(canvas, scene, look, wornIds, missing) {
        const L = data();
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, SHEET_W, SHEET_H);
        if (!L) return;
        const n = L.normalizeLook(look);
        const off = scratchOf(canvas);
        const octx = off.getContext("2d");
        const loss = missing || L.missingVisuals(null);
        for (const part of L.DRAW_ORDER) {
            if (L.hidesWholePart(part, loss)) continue;
            const img = partImage(scene, part);
            if (!img) continue;
            octx.globalCompositeOperation = "source-over";
            octx.clearRect(0, 0, SHEET_W, SHEET_H);
            octx.drawImage(img, 0, 0);
            octx.globalCompositeOperation = "multiply";
            octx.fillStyle = L.css(n[part]);
            octx.fillRect(0, 0, SHEET_W, SHEET_H);
            octx.globalCompositeOperation = "destination-in";
            octx.drawImage(img, 0, 0);
            const layer = part === "arms" || part === "pants" || part === "shoes" ? part : null;
            if (layer) eraseRects(octx, L.visualEraseRects(layer, loss));
            ctx.globalCompositeOperation = "source-over";
            ctx.drawImage(off, 0, 0);
        }
        // Sheets are precolored overlays. They cover one body region each and
        // leave arms, eyes, and uncovered skin transparent.
        const worn = Array.isArray(wornIds) ? wornIds : [];
        for (const id of worn) {
            const mask = armorMask(scene, id, loss);
            if (mask === "skip") continue;
            const img = sourceImage(scene, armorTextureKey(id));
            if (!img) continue;
            if (mask === "pants" || mask === "shoes") {
                octx.globalCompositeOperation = "source-over";
                octx.clearRect(0, 0, SHEET_W, SHEET_H);
                octx.drawImage(img, 0, 0);
                eraseRects(octx, L.visualEraseRects(mask, loss));
                ctx.globalCompositeOperation = "source-over";
                ctx.drawImage(off, 0, 0);
                continue;
            }
            ctx.globalCompositeOperation = "source-over";
            ctx.drawImage(img, 0, 0);
        }
    }

    /**
     * Knock missing limbs out of a fused mob sheet (assets/mobs/human.png)
     * using the player part silhouettes as a mask.
     * @param {Phaser.Scene} scene
     * @param {string} sourceKey
     * @param {object|null} missing
     * @returns {string}
     */
    function ensureFusedMask(scene, sourceKey, missing) {
        const L = data();
        const base = sourceKey || "human";
        const suffix = L ? L.missingSuffix(missing) : "";
        if (!suffix) return base;
        const key = `${base}~m${suffix}`;
        if (!scene?.textures) return key;
        if (scene.textures.exists(key)) return key;
        if (!partsReady(scene) || !scene.textures.exists(base)) return base;
        const img = sourceImage(scene, base);
        if (!img) return base;
        const canvas = document.createElement("canvas");
        canvas.width = SHEET_W;
        canvas.height = SHEET_H;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, SHEET_W, SHEET_H);
        ctx.drawImage(img, 0, 0);
        const loss = missing || L.missingVisuals(null);
        if (loss.head) {
            ctx.globalCompositeOperation = "destination-out";
            for (const part of ["head", "eyes"]) {
                const partImg = partImage(scene, part);
                if (partImg) ctx.drawImage(partImg, 0, 0);
            }
            ctx.globalCompositeOperation = "source-over";
        }
        const off = scratchOf(canvas);
        const octx = off.getContext("2d");
        const mask = document.createElement("canvas");
        mask.width = SHEET_W;
        mask.height = SHEET_H;
        const mctx = mask.getContext("2d");
        for (const layer of ["arms", "pants", "shoes"]) {
            const partImg = partImage(scene, layer);
            const rects = L.visualEraseRects(layer, loss);
            if (!partImg || !rects.length) continue;
            // One destination-in of the union. A second fillRect under
            // destination-in would throw away the rects drawn before it.
            mctx.clearRect(0, 0, SHEET_W, SHEET_H);
            mctx.fillStyle = "#fff";
            for (const r of rects) mctx.fillRect(r.x, r.y, r.w, r.h);
            octx.globalCompositeOperation = "source-over";
            octx.clearRect(0, 0, SHEET_W, SHEET_H);
            octx.drawImage(partImg, 0, 0);
            octx.globalCompositeOperation = "destination-in";
            octx.drawImage(mask, 0, 0);
            ctx.globalCompositeOperation = "destination-out";
            ctx.drawImage(off, 0, 0);
            ctx.globalCompositeOperation = "source-over";
        }
        const tex = scene.textures.addCanvas(key, canvas);
        addFrames(tex);
        nearest(scene, key);
        return key;
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
     * @param {{ key?: string, replace?: boolean, worn?: string[], body?: object }} [opts]
     * @returns {string} texture key
     */
    function ensure(scene, look, opts = {}) {
        const L = data();
        const n = L ? L.normalizeLook(look) : look;
        const missing = L ? L.missingVisuals(opts.body) : null;
        const worn = opts.key ? [] : orderedWorn(scene, opts.worn);
        const key = opts.key || textureKey(n, worn, missing);
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
        paint(canvas, scene, n, worn, missing);

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
        if (sprite._lieTexKey && sprite.texture?.key === sprite._lieTexKey) {
            sprite._lieSrcKey = key;
            sprite.look = data() ? data().normalizeLook(look) : look;
            return key;
        }
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
        if (sprite._lieTexKey && sprite.texture?.key === sprite._lieTexKey) return;
        const tex = sprite.texture?.key;
        if (!tex) return;
        const dir = facing || "down";
        const key = `${tex}-${moving ? "walk" : "idle"}-${dir}`;
        const anims = sprite.scene?.anims;
        // Idle is a one-shot clip; play() every frame restarts it. Walk/idle
        // flicker also restarts the walk yoyo from frame 0.
        if (sprite.anims?.currentAnim?.key === key) {
            if (moving && sprite.anims.isPlaying === false && anims?.exists(key)) {
                sprite.play(key, true);
            }
            return;
        }
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

    function resolveTexture(scene, key, look, body) {
        const L = data();
        const missing = L ? L.missingVisuals(body) : null;
        if (look && partsReady(scene)) return ensure(scene, look, { body });
        const base = key && key !== "player" && scene?.textures?.exists(key)
            ? key
            : (scene?.textures?.exists("human") ? "human" : key);
        const human = base === "human" || key === "human";
        if (human && L && L.missingSuffix(missing)) {
            return ensureFusedMask(scene, "human", missing);
        }
        if (key && key !== "player" && scene.textures.exists(key)) return key;
        if (scene.textures.exists("human")) return "human";
        if (key && scene.textures.exists(key)) return key;
        return "human";
    }

    return {
        partsReady,
        loadParts,
        armorTextureKey,
        orderedWorn,
        ensure,
        ensureAnims,
        ensureFusedMask,
        apply,
        play,
        fistColor,
        resolveTexture,
        PREVIEW_KEY: "look-preview"
    };
})();
