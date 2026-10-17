/**
 * One GPU texture for world sprites.
 *
 * Y-sort draws trees, items, and stations in foot order, so a different
 * image on each object is its own draw. A camp does that hundreds of times
 * a frame. Copies of those images live on one sheet; the sprites keep their
 * old keys and frames, and the original image stays put for pixel reads.
 */
const WorldAtlas = (() => {
    const KEY = "__world_atlas";
    const SIZE = 1024;
    const PAD = 1;
    const MAX_SIDE = 128;

    function state(scene) {
        const mgr = scene?.textures;
        if (!mgr || typeof document === "undefined") return null;
        if (mgr._cpAtlas?.canvas && mgr.exists(KEY)) return mgr._cpAtlas;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.imageSmoothingEnabled = false;
        if (!mgr.exists(KEY)) {
            if (mgr.addCanvas) mgr.addCanvas(KEY, canvas);
            else mgr.addImage?.(KEY, canvas);
        }
        if (!mgr.exists(KEY)) return null;
        const nearest = (typeof Phaser !== "undefined" && Phaser.Textures)
            ? Phaser.Textures.FilterMode.NEAREST
            : 0;
        try { mgr.get(KEY).setFilter(nearest); } catch (_) {}
        const st = {
            canvas,
            ctx,
            rows: [],
            cursorY: 0,
            hook: false
        };
        mgr._cpAtlas = st;
        if (!mgr._cpAtlasHook) {
            mgr._cpAtlasHook = true;
            const host = { textures: mgr };
            mgr.on("addtexture", (key) => {
                const live = mgr._cpAtlas;
                if (!live?.canvas || key === KEY) return;
                const tex = mgr.exists(key) ? mgr.get(key) : null;
                const src = tex?.source?.[0];
                if (!src || src.isCanvas || src.isRenderTexture || src.isGLTexture) return;
                if (place(host, live, key, false)) upload(host, live);
            });
        }
        return st;
    }

    function alloc(st, w, h) {
        const needW = w + PAD * 2;
        const needH = h + PAD * 2;
        const rows = st.rows;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.h < needH || row.x + needW > SIZE) continue;
            const x = row.x + PAD;
            const y = row.y + PAD;
            row.x += needW;
            return { x, y };
        }
        if (st.cursorY + needH > SIZE) return null;
        const y = st.cursorY + PAD;
        st.rows.push({ y: st.cursorY, h: needH, x: needW });
        st.cursorY += needH;
        return { x: PAD, y };
    }

    function extrude(ctx, img, x, y, w, h) {
        ctx.drawImage(img, x, y);
        ctx.drawImage(img, 0, 0, w, 1, x, y - 1, w, 1);
        ctx.drawImage(img, 0, h - 1, w, 1, x, y + h, w, 1);
        ctx.drawImage(img, 0, 0, 1, h, x - 1, y, 1, h);
        ctx.drawImage(img, w - 1, 0, 1, h, x + w, y, 1, h);
        ctx.drawImage(img, 0, 0, 1, 1, x - 1, y - 1, 1, 1);
        ctx.drawImage(img, w - 1, 0, 1, 1, x + w, y - 1, 1, 1);
        ctx.drawImage(img, 0, h - 1, 1, 1, x - 1, y + h, 1, 1);
        ctx.drawImage(img, w - 1, h - 1, 1, 1, x + w, y + h, 1, 1);
    }

    function retarget(tex, ox, oy, atlasSource) {
        const frames = tex?.frames;
        if (!frames) return false;
        let moved = false;
        for (const name in frames) {
            const frame = frames[name];
            if (!frame || frame._cpAtlas) continue;
            frame.source = atlasSource;
            frame.cutX = (frame.cutX || 0) + ox;
            frame.cutY = (frame.cutY || 0) + oy;
            const cut = frame.data?.cut;
            if (cut) {
                cut.x += ox;
                cut.y += oy;
                cut.r += ox;
                cut.b += oy;
            }
            frame.updateUVs?.();
            frame._cpAtlas = true;
            moved = true;
        }
        return moved;
    }

    function place(scene, st, key, allowCanvas) {
        if (!key || key === KEY || key.charCodeAt(0) === 95) return false;
        const mgr = scene.textures;
        if (!mgr.exists(key)) return false;
        const tex = mgr.get(key);
        const src = tex?.source?.[0];
        if (!src || src.isRenderTexture || src.isGLTexture) return false;
        if (tex.source.length !== 1) return false;
        if (!allowCanvas && src.isCanvas) return false;
        const img = src.image;
        const w = img?.width || 0;
        const h = img?.height || 0;
        if (w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) return false;
        const frames = tex.frames;
        if (!frames) return false;
        for (const name in frames) {
            if (frames[name]?._cpAtlas) return false;
        }
        const atlasSource = mgr.get(KEY)?.source?.[0];
        if (!atlasSource) return false;
        const spot = alloc(st, w, h);
        if (!spot) return false;
        extrude(st.ctx, img, spot.x, spot.y, w, h);
        // getSourceImage reads frame.source. Pixel bakes (rocks, spears, huts)
        // must keep seeing the original image after the frame points at the sheet.
        if (!tex._cpOrigImage) {
            tex._cpOrigImage = img;
            tex.getSourceImage = function () { return img; };
        }
        return retarget(tex, spot.x, spot.y, atlasSource);
    }

    function upload(scene, st) {
        const tex = scene.textures.get(KEY);
        const src = tex?.source?.[0];
        try { src?.update?.(); } catch (_) {}
        const nearest = (typeof Phaser !== "undefined" && Phaser.Textures)
            ? Phaser.Textures.FilterMode.NEAREST
            : 0;
        try { tex?.setFilter?.(nearest); } catch (_) {}
        if (typeof clampTextureWrap === "function") clampTextureWrap(tex);
    }

    function pack(scene) {
        const st = state(scene);
        if (!st) return;
        const keys = scene.textures.getTextureKeys();
        let dirty = false;
        for (let i = 0; i < keys.length; i++) {
            if (place(scene, st, keys[i], false)) dirty = true;
        }
        if (dirty) upload(scene, st);
    }

    function adopt(scene, key) {
        const mgr = scene?.textures;
        const st = mgr?._cpAtlas;
        if (!st?.canvas || !mgr.exists(KEY)) return;
        if (place(scene, st, key, true)) upload(scene, st);
    }

    return { pack, adopt };
})();
