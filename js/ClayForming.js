/**
 * Client clay-forming helpers: lump from clay.png, Three.js bake of inventory
 * icons, and a 1:1 occupancy blit for the 16×16 place ghost.
 */
const ClayForming = {
    WELL_PX: 256,
    PLACE_PX: 16,
    MAX_INSTANCES: 16 * 16 * 16,

    readNativePixels(scene, textureKey) {
        const tex = scene?.textures?.exists(textureKey)
            ? scene.textures.get(textureKey)
            : null;
        if (!tex) return null;
        let src = null;
        try {
            src = tex.getSourceImage?.() || tex.get?.()?.source?.image;
        } catch (_) {
            src = null;
        }
        if (!src || !(src.width > 0) || !(src.height > 0)) return null;
        const w = src.width | 0;
        const h = src.height | 0;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        try {
            ctx.drawImage(src, 0, 0);
            const data = ctx.getImageData(0, 0, w, h).data;
            return { pixels: new Uint8ClampedArray(data), w, h };
        } catch (_) {
            return null;
        }
    },

    blankFromTexture(scene, textureKey = "clay") {
        const raw = this.readNativePixels(scene, textureKey);
        if (!raw || typeof Forming === "undefined") {
            const grid = typeof Forming !== "undefined" ? Forming.fallbackMound() : null;
            return {
                grid,
                color: 0xc47a6a,
                startMass: grid && typeof Forming !== "undefined" ? Forming.mass(grid) : 12
            };
        }
        const grid = Forming.moundFromPixels(raw.pixels, raw.w, raw.h);
        return {
            grid,
            color: Forming.averageColor(raw.pixels),
            startMass: Forming.mass(grid)
        };
    },

    hashPack(pack) {
        const s = String(pack || "");
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16);
    },

    aoAt(grid, x, y, z) {
        if (typeof Forming === "undefined") return 1;
        let n = 0;
        for (const [nx, ny, nz] of Forming.neighbors6(x, y, z)) {
            if (Forming.inBounds(nx, ny, nz) && grid[nx][ny][nz]) n++;
        }
        return Math.max(0.45, 1 - n * 0.08);
    },

    getRenderer() {
        if (this._renderer) return this._renderer;
        if (typeof THREE === "undefined" || typeof document === "undefined") return null;
        const renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true
        });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1, 2));
        const el = renderer.domElement;
        el.style.position = "fixed";
        el.style.left = "0";
        el.style.top = "0";
        el.style.pointerEvents = "none";
        el.style.display = "none";
        el.style.zIndex = "8";
        document.body.appendChild(el);
        this._renderer = renderer;
        return renderer;
    },

    hideOverlay() {
        const el = this._renderer?.domElement;
        if (!el) return;
        el.style.display = "none";
        el.style.pointerEvents = "none";
        this.hideHudTooltip();
    },

    hideHudTooltip() {
        const el = this._hudTip;
        if (!el) return;
        el.style.display = "none";
        el.textContent = "";
    },

    /**
     * Phaser tooltips draw on the game canvas, under the Three.js well (z-index 8).
     * Mirror the tip into a DOM node above the clay so help/save/load stay readable.
     */
    syncHudTooltip(scene) {
        const forming = scene?.clayFormingPanel;
        const tip = scene?.tooltip;
        const show = !!(forming?.visible && tip?.visible);
        if (!show) {
            this.hideHudTooltip();
            if (tip) tip.setAlpha(1);
            return;
        }
        tip.setAlpha(0);

        let el = this._hudTip;
        if (!el) {
            el = document.createElement("div");
            el.id = "clay-form-hud-tip";
            el.style.cssText = [
                "position:fixed",
                "z-index:9",
                "pointer-events:none",
                "box-sizing:border-box",
                "background:#111111",
                "border:1px solid #000000",
                "color:#ffffff",
                "font-family:PrimaryFont,monospace",
                "white-space:pre",
                "line-height:1.25"
            ].join(";");
            document.body.appendChild(el);
            this._hudTip = el;
        }

        const s = scene.uiScale || 1;
        const pad = scene._tooltipPadding || 6;
        const fontPx = typeof pixelUiFontSize === "function" ? pixelUiFontSize(16, s) : Math.round(16 * s);
        const radius = Math.max(4, Math.round(6 * s));
        const stroke = Math.max(2, Math.round(2 * s));
        const head = scene.tooltipText?.text || "";
        const tail = scene.tooltipSub?.visible ? (scene.tooltipSub.text || "") : "";
        const text = tail ? `${head}\n${tail}` : head;
        el.textContent = text;
        el.style.display = text ? "block" : "none";
        el.style.padding = `${pad}px`;
        el.style.fontSize = `${fontPx}px`;
        el.style.borderRadius = `${radius}px`;
        el.style.textShadow = [
            `-${stroke}px 0 #000`,
            `${stroke}px 0 #000`,
            `0 -${stroke}px #000`,
            `0 ${stroke}px #000`
        ].join(",");

        const canvas = scene.game?.canvas;
        const gr = canvas?.getBoundingClientRect?.();
        const cw = canvas?.width || scene.scale?.width || 1;
        const ch = canvas?.height || scene.scale?.height || 1;
        const sx = gr && cw ? gr.width / cw : 1;
        const sy = gr && ch ? gr.height / ch : 1;
        const boxW = scene._tooltipBoxW || 0;
        const boxH = scene._tooltipBoxH || 0;
        const left = (gr ? gr.left : 0) + (tip.x - pad) * sx;
        const top = (gr ? gr.top : 0) + (tip.y - pad) * sy;
        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
        if (boxW > 0) el.style.minWidth = `${Math.round(boxW * sx)}px`;
        if (boxH > 0) el.style.minHeight = `${Math.round(boxH * sy)}px`;
    },

    showOverlay(bounds, gameCanvas) {
        const renderer = this.getRenderer();
        if (!renderer || !bounds) return null;
        const el = renderer.domElement;
        const gr = gameCanvas?.getBoundingClientRect?.();
        const cw = gameCanvas?.width || bounds.width;
        const ch = gameCanvas?.height || bounds.height;
        const sx = gr && cw ? gr.width / cw : 1;
        const sy = gr && ch ? gr.height / ch : 1;
        const left = (gr ? gr.left : 0) + bounds.left * sx;
        const top = (gr ? gr.top : 0) + bounds.top * sy;
        const w = Math.max(1, bounds.width * sx);
        const h = Math.max(1, bounds.height * sy);
        el.style.display = "block";
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        el.style.pointerEvents = "auto";
        const bufW = Math.max(1, Math.round(bounds.width));
        const bufH = Math.max(1, Math.round(bounds.height));
        renderer.setPixelRatio(Math.min(typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1, 2));
        renderer.setSize(bufW, bufH, false);
        return renderer;
    },

    applyDefaultCamera(cam) {
        const d = 26;
        cam.position.set(8 + d, 8 + d, 8 + d);
        cam.up.set(0, 1, 0);
        cam.lookAt(8, 8, 8);
        cam.updateProjectionMatrix?.();
    },

    /** World-space frame of filled voxels (centers of the occupied AABB). */
    gridFrame(grid) {
        const cells = [];
        if (typeof Forming !== "undefined") {
            Forming.forEachVoxel(grid, (x, y, z) => cells.push([x, y, z]));
        }
        const box = (typeof Forming !== "undefined" && cells.length)
            ? Forming.aabbOf(cells)
            : { minX: 0, minY: 0, minZ: 0, w: 16, h: 16, d: 16 };
        if (!(box.w > 0)) {
            return { cx: 8, cy: 8, cz: 8, radius: 12, hw: 8, hh: 8, hd: 8 };
        }
        return {
            cx: box.minX + box.w * 0.5,
            cy: box.minY + box.h * 0.5,
            cz: box.minZ + box.d * 0.5,
            radius: Math.max(0.75, Math.hypot(box.w, box.h, box.d) * 0.5),
            hw: box.w * 0.5,
            hh: box.h * 0.5,
            hd: box.d * 0.5
        };
    },

    applyIconCamera(cam, grid) {
        const f = this.gridFrame(grid);
        const fov = ((cam.fov || 42) * Math.PI) / 180;
        const dist = (f.radius / Math.tan(fov * 0.5)) * 1.06;
        const s = dist / Math.sqrt(3);
        cam.near = Math.max(0.05, dist - f.radius * 3);
        cam.far = dist + f.radius * 4;
        cam.position.set(f.cx + s, f.cy + s, f.cz + s);
        cam.up.set(0, 1, 0);
        cam.lookAt(f.cx, f.cy, f.cz);
        cam.updateProjectionMatrix?.();
    },

    sphericalFromDefault() {
        const d = 26;
        const x = d;
        const y = d;
        const z = d;
        const r = Math.hypot(x, y, z);
        return {
            radius: r,
            theta: Math.atan2(x, z),
            phi: Math.acos(Math.max(-1, Math.min(1, y / r)))
        };
    },

    applySpherical(cam, sph) {
        const phi = Math.max(0.08, Math.min(Math.PI - 0.08, sph.phi));
        const r = sph.radius;
        cam.position.set(
            8 + r * Math.sin(phi) * Math.sin(sph.theta),
            8 + r * Math.cos(phi),
            8 + r * Math.sin(phi) * Math.cos(sph.theta)
        );
        cam.up.set(0, 1, 0);
        cam.lookAt(8, 8, 8);
    },

    addLights(scene) {
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const dir = new THREE.DirectionalLight(0xfff2e0, 0.85);
        dir.position.set(12, 22, 8);
        scene.add(dir);
        const fill = new THREE.DirectionalLight(0xc8d8ff, 0.28);
        fill.position.set(-8, 6, -10);
        scene.add(fill);
    },

    makeGround() {
        const pts = [
            0, 0, 0, 16, 0, 0,
            16, 0, 0, 16, 0, 16,
            16, 0, 16, 0, 0, 16,
            0, 0, 16, 0, 0, 0
        ];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        const mat = new THREE.LineBasicMaterial({ color: 0x8a7a62, transparent: true, opacity: 0.35 });
        return new THREE.LineSegments(geo, mat);
    },

    makeVoxelMesh(color) {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const mesh = new THREE.InstancedMesh(geo, mat, this.MAX_INSTANCES);
        if (THREE.DynamicDrawUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.userData.baseColor = color >>> 0;
        return mesh;
    },

    fillVoxelMesh(mesh, grid, color, skip, hover) {
        if (!mesh || typeof Forming === "undefined") return 0;
        const dummy = this._dummy || (this._dummy = new THREE.Object3D());
        const tint = this._tint || (this._tint = new THREE.Color());
        const base = color >>> 0;
        const br = ((base >> 16) & 255) / 255;
        const bg = ((base >> 8) & 255) / 255;
        const bb = (base & 255) / 255;
        const hoverCol = hover?.color >>> 0;
        const hr = ((hoverCol >> 16) & 255) / 255;
        const hg = ((hoverCol >> 8) & 255) / 255;
        const hb = (hoverCol & 255) / 255;
        const hasHover = !!(hover && Number.isFinite(hover.x) && Number.isFinite(hover.z));
        let i = 0;
        Forming.forEachVoxel(grid, (x, y, z) => {
            if (skip && skip.x === x && skip.y === y && skip.z === z) return;
            dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            const ao = this.aoAt(grid, x, y, z);
            const lit = hasHover && hover.x === x && hover.z === z
                && (hover.column || hover.y === y);
            if (lit) tint.setRGB(hr * ao, hg * ao, hb * ao);
            else tint.setRGB(br * ao, bg * ao, bb * ao);
            mesh.setColorAt(i, tint);
            i++;
        });
        mesh.count = i;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere?.();
        mesh.userData.baseColor = base;
        return i;
    },

    cellFromPoint(pt) {
        if (!pt) return null;
        const x = Math.floor(pt.x);
        const y = Math.floor(pt.y);
        const z = Math.floor(pt.z);
        if (typeof Forming === "undefined" || !Forming.inBounds(x, y, z)) return null;
        return { x, y, z };
    },

    faceNeighbor(hit) {
        if (!hit?.face?.normal) return null;
        const cell = this.cellFromPoint(hit.point.clone().addScaledVector(hit.face.normal, -0.01));
        if (!cell) return null;
        const n = hit.face.normal;
        const nx = cell.x + Math.round(n.x);
        const ny = cell.y + Math.round(n.y);
        const nz = cell.z + Math.round(n.z);
        if (!Forming.inBounds(nx, ny, nz)) return null;
        return { x: nx, y: ny, z: nz };
    },

    _copyCanvas(src, dw, dh) {
        const c = document.createElement("canvas");
        c.width = dw;
        c.height = dh;
        const ctx = c.getContext("2d");
        if (!ctx) return null;
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, dw, dh);
        ctx.drawImage(src, 0, 0, dw, dh);
        return c;
    },

    _addPhaserCanvas(scene, key, canvas, nearest) {
        if (!scene?.textures || !canvas) return null;
        if (scene.textures.exists(key)) {
            try { scene.textures.remove(key); } catch (_) { /* keep going */ }
        }
        scene.textures.addCanvas(key, canvas);
        if (nearest) {
            const tex = scene.textures.get(key);
            tex?.setFilter?.(typeof Phaser !== "undefined" ? Phaser.Textures.FilterMode.NEAREST : 0);
        }
        return key;
    },

    /**
     * Rebuild UI (well-res 3D) + 16×16 occupancy top-down textures from packed voxels.
     * @returns {string|null} UI texture key
     */
    ensureFormTexture(scene, stack) {
        if (!scene?.textures || !stack?.formVoxels || typeof Forming === "undefined") return null;
        const pack = Forming.sanitizePack(stack.formVoxels);
        if (!pack) return stack.formIcon && scene.textures.exists(stack.formIcon) ? stack.formIcon : null;
        const hash = this.hashPack(pack);
        const uiKey = `form_ui2_${hash}`;
        const tdKey = `form_td3_${hash}`;
        if (!scene.textures.exists(tdKey)) this._bakePlace(scene, pack, tdKey, stack);
        if (scene.textures.exists(tdKey)) stack.formPlaceIcon = tdKey;
        if (typeof THREE === "undefined") {
            return stack.formIcon && scene.textures.exists(stack.formIcon) ? stack.formIcon : null;
        }
        if (!scene.textures.exists(uiKey)) this._bakeUi(scene, pack, uiKey, stack);
        if (scene.textures.exists(uiKey)) stack.formIcon = uiKey;
        return stack.formIcon || null;
    },

    /** Top-down place sprite for `rot` without rewriting the stack's voxels. */
    ensurePlaceIcon(scene, stack, rot) {
        if (!scene?.textures || !stack?.formVoxels || typeof Forming === "undefined") {
            return stack?.formPlaceIcon && scene?.textures?.exists(stack.formPlaceIcon)
                ? stack.formPlaceIcon
                : null;
        }
        const pack = Forming.sanitizePack(stack.formVoxels);
        if (!pack) return null;
        const yawed = rot ? (Forming.rotatePackYaw(pack, rot) || pack) : pack;
        const preview = { formVoxels: yawed, formColor: stack.formColor };
        this.ensureFormTexture(scene, preview);
        return preview.formPlaceIcon || null;
    },

    clayColor(scene) {
        if (this._clayColor != null) return this._clayColor;
        const raw = this.readNativePixels(scene, "clay");
        this._clayColor = (raw && typeof Forming !== "undefined")
            ? Forming.averageColor(raw.pixels)
            : 0xc47a6a;
        return this._clayColor;
    },

    _gridColor(stack, scene) {
        const n = Number(stack?.formColor);
        if (Number.isFinite(n) && n > 0) return n >>> 0;
        return this.clayColor(scene);
    },

    _bakeUi(scene, pack, uiKey, stack) {
        const renderer = this.getRenderer();
        if (!renderer) return;
        const grid = Forming.unpack(pack);
        if (!grid) return;
        const color = this._gridColor(stack, scene);
        const bakeScene = new THREE.Scene();
        this.addLights(bakeScene);
        const mesh = this.makeVoxelMesh(color);
        this.fillVoxelMesh(mesh, grid, color);
        bakeScene.add(mesh);

        const prevEl = renderer.domElement.style.display;
        const prevPe = renderer.domElement.style.pointerEvents;
        const prevW = renderer.domElement.width;
        const prevH = renderer.domElement.height;
        const prevPr = renderer.getPixelRatio();

        renderer.setPixelRatio(1);
        renderer.setClearColor(0x000000, 0);

        const well = this.WELL_PX;
        renderer.setSize(well, well, false);
        const persp = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
        this.applyIconCamera(persp, grid);
        renderer.render(bakeScene, persp);
        const uiCanvas = this._copyCanvas(renderer.domElement, well, well);
        if (uiCanvas) this._addPhaserCanvas(scene, uiKey, uiCanvas);

        mesh.geometry.dispose();
        mesh.material.dispose();

        renderer.setPixelRatio(prevPr || 1);
        if (prevW && prevH) renderer.setSize(prevW, prevH, false);
        renderer.domElement.style.display = prevEl;
        renderer.domElement.style.pointerEvents = prevPe;
    },

    _bakePlace(scene, pack, tdKey, stack) {
        const grid = Forming.unpack(pack);
        if (!grid || typeof document === "undefined") return;
        const n = Forming.SIZE;
        const canvas = document.createElement("canvas");
        canvas.width = n;
        canvas.height = n;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        const rgba = Forming.topDownRgba(grid, this._gridColor(stack, scene));
        const img = ctx.createImageData(n, n);
        img.data.set(rgba);
        ctx.putImageData(img, 0, 0);
        this._addPhaserCanvas(scene, tdKey, canvas, true);
    }
};
