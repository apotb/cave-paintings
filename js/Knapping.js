/**
 * Freeform 16×16 stone knapping: grid ops, RNG chips, shatter, classifier.
 */
const Knapping = {
    SIZE: 16,
    /** Below this many solid cells the blank is unusable / crumbled. */
    MIN_MASS: 10,
    // Components smaller than this are pruned as debris flakes
    SHATTER_COMP_MIN: 4,

    /** @returns {boolean[][]} */
    emptyGrid() {
        const n = this.SIZE;
        const g = new Array(n);
        for (let y = 0; y < n; y++) {
            g[y] = new Array(n).fill(false);
        }
        return g;
    },

    cloneGrid(grid) {
        return grid.map((row) => row.slice());
    },

    /**
     * Build solid mask + RGBA pixels from item texture (scaled into SIZE×SIZE).
     * @returns {{ grid: boolean[][], pixels: Uint8ClampedArray }}
     */
    blankFromTexture(scene, textureKey) {
        const pixels = this.readTexturePixels(scene, textureKey);
        if (!pixels) {
            const grid = this._fallbackBlank();
            return { grid, pixels: this._fallbackPixels(grid) };
        }
        const n = this.SIZE;
        const grid = this.emptyGrid();
        let any = false;
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const on = pixels[(y * n + x) * 4 + 3] > 80;
                grid[y][x] = on;
                if (on) any = true;
            }
        }
        if (!any) {
            const fb = this._fallbackBlank();
            return { grid: fb, pixels: this._fallbackPixels(fb) };
        }
        return { grid: this._ensureConnected(grid), pixels };
    },

    /** @deprecated use blankFromTexture */
    gridFromTexture(scene, textureKey) {
        return this.blankFromTexture(scene, textureKey).grid;
    },

    /**
     * Sample texture into SIZE×SIZE RGBA (nearest).
     * @returns {Uint8ClampedArray|null}
     */
    readTexturePixels(scene, textureKey) {
        const n = this.SIZE;
        const out = new Uint8ClampedArray(n * n * 4);
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

        if (!src || !(src.width > 0)) {
            let any = false;
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    const c = scene.textures.getPixel?.(x, y, textureKey);
                    const i = (y * n + x) * 4;
                    if (!c) continue;
                    out[i] = c.red ?? c.r ?? 0;
                    out[i + 1] = c.green ?? c.g ?? 0;
                    out[i + 2] = c.blue ?? c.b ?? 0;
                    out[i + 3] = c.alpha ?? c.a ?? 0;
                    if (out[i + 3] > 80) any = true;
                }
            }
            return any ? out : null;
        }

        const sw = src.width;
        const sh = src.height;
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(src, 0, 0);
        let data;
        try {
            data = ctx.getImageData(0, 0, sw, sh).data;
        } catch (_) {
            return null;
        }

        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / n));
                const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / n));
                const si = (sy * sw + sx) * 4;
                const di = (y * n + x) * 4;
                out[di] = data[si];
                out[di + 1] = data[si + 1];
                out[di + 2] = data[si + 2];
                out[di + 3] = data[si + 3];
            }
        }
        return out;
    },

    _fallbackBlank() {
        const n = this.SIZE;
        const grid = this.emptyGrid();
        const cx = (n - 1) / 2;
        const cy = (n - 1) / 2;
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const dx = (x - cx) / 5.5;
                const dy = (y - cy) / 6.5;
                grid[y][x] = dx * dx + dy * dy <= 1;
            }
        }
        return grid;
    },

    /** Flat stone-colored pixels for the oval fallback blank. */
    _fallbackPixels(grid) {
        const n = this.SIZE;
        const out = new Uint8ClampedArray(n * n * 4);
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (!grid[y][x]) continue;
                const i = (y * n + x) * 4;
                out[i] = 138;
                out[i + 1] = 122;
                out[i + 2] = 104;
                out[i + 3] = 255;
            }
        }
        return out;
    },

    /** Rotate SIZE×SIZE RGBA buffer 90° clockwise (matches rotateCW grid). */
    rotatePixelsCW(pixels) {
        const n = this.SIZE;
        const out = new Uint8ClampedArray(pixels.length);
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const si = (y * n + x) * 4;
                const nx = n - 1 - y;
                const ny = x;
                const di = (ny * n + nx) * 4;
                out[di] = pixels[si];
                out[di + 1] = pixels[si + 1];
                out[di + 2] = pixels[si + 2];
                out[di + 3] = pixels[si + 3];
            }
        }
        return out;
    },

    /** RGBA with chipped cells cleared — for preview / tool icon. */
    maskedPixels(grid, pixels) {
        const n = this.SIZE;
        const out = new Uint8ClampedArray(n * n * 4);
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (!grid[y][x]) continue;
                const i = (y * n + x) * 4;
                out[i] = pixels[i];
                out[i + 1] = pixels[i + 1];
                out[i + 2] = pixels[i + 2];
                out[i + 3] = pixels[i + 3];
            }
        }
        return out;
    },

    /** Solid mask from icon RGBA. */
    gridFromPixels(pixels) {
        const n = this.SIZE;
        const grid = this.emptyGrid();
        if (!pixels) return grid;
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                grid[y][x] = pixels[(y * n + x) * 4 + 3] > 80;
            }
        }
        return grid;
    },

    _centroid(grid) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let y = 0; y < this.SIZE; y++) {
            for (let x = 0; x < this.SIZE; x++) {
                if (!grid[y][x]) continue;
                sx += x;
                sy += y;
                n++;
            }
        }
        if (!n) return null;
        return { x: sx / n, y: sy / n };
    },

    /** Persistable base64 of masked RGBA (SIZE×SIZE×4). */
    packIconData(grid, pixels) {
        return this.packIconDataFromPixels(this.maskedPixels(grid, pixels));
    },

    /** Persistable base64 from a raw SIZE×SIZE×4 buffer (e.g. preview canvas). */
    packIconDataFromPixels(pixels) {
        if (!pixels?.length) return null;
        let bin = "";
        for (let i = 0; i < pixels.length; i++) bin += String.fromCharCode(pixels[i]);
        return btoa(bin);
    },

    unpackIconData(data) {
        if (!data || typeof data !== "string") return null;
        try {
            const bin = atob(data);
            const n = this.SIZE;
            if (bin.length !== n * n * 4) return null;
            const out = new Uint8ClampedArray(n * n * 4);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        } catch (_) {
            return null;
        }
    },

    /**
     * Ensure a Phaser canvas texture exists for this knapped tool.
     * Uses knapIconData; sets stack.knapIcon to the texture key.
     */
    ensureToolTexture(scene, stack) {
        if (!scene?.textures || !stack) return null;
        // Legacy knaps stored 0.05/0.06; tools use item-def weight (pebble/flint 0.3)
        if (stack.weight != null && (stack.toolClass || stack.knapMaterial)) {
            delete stack.weight;
        }
        let pixels = this.unpackIconData(stack.knapIconData);
        if (!pixels) {
            if (stack.knapIcon && scene.textures.exists(stack.knapIcon)) return stack.knapIcon;
            return null;
        }
        // Hash ALL pixels — a short base64 prefix collided (leading transparent rows)
        // so every tool reused the first baked texture.
        let hash = 2166136261;
        for (let i = 0; i < pixels.length; i++) {
            hash ^= pixels[i];
            hash = Math.imul(hash, 16777619);
        }
        const key = `knap_${(hash >>> 0).toString(16)}`;
        if (stack.knapIcon === key && scene.textures.exists(key)) return key;
        if (!scene.textures.exists(key)) {
            const n = this.SIZE;
            const canvas = document.createElement("canvas");
            canvas.width = n;
            canvas.height = n;
            const ctx = canvas.getContext("2d");
            const img = ctx.createImageData(n, n);
            img.data.set(pixels);
            ctx.putImageData(img, 0, 0);
            scene.textures.addCanvas(key, canvas);
        }
        stack.knapIcon = key;
        return key;
    },

    /** Keep largest connected component so blanks start as one stone. */
    _ensureConnected(grid) {
        const comps = this.components(grid);
        if (comps.length <= 1) return grid;
        comps.sort((a, b) => b.length - a.length);
        const keep = new Set(comps[0].map(([x, y]) => `${x},${y}`));
        const n = this.SIZE;
        const out = this.emptyGrid();
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                out[y][x] = keep.has(`${x},${y}`);
            }
        }
        return out;
    },

    mass(grid) {
        let m = 0;
        for (const row of grid) for (const c of row) if (c) m++;
        return m;
    },

    rotateCW(grid) {
        const n = this.SIZE;
        const out = this.emptyGrid();
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                out[x][n - 1 - y] = grid[y][x];
            }
        }
        return out;
    },

    isEdgeCell(grid, x, y) {
        if (!grid[y]?.[x]) return false;
        const n = this.SIZE;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= n || ny >= n || !grid[ny][nx]) return true;
        }
        return false;
    },

    /**
     * Remove a random flake around (x,y). Mutates a clone.
     * @returns {{ grid: boolean[][], shattered: boolean, reason: string|null, removed: number }}
     */
    chip(grid, x, y, rng = Math.random) {
        const n = this.SIZE;
        if (!grid[y]?.[x] || !this.isEdgeCell(grid, x, y)) {
            return { grid, shattered: false, reason: null, removed: 0 };
        }
        const next = this.cloneGrid(grid);
        // Mostly single-cell chips; rare small flakes — no giant 5–10 bites
        const roll = rng();
        let target = 1;
        if (roll >= 0.97) target = 3 + Math.floor(rng() * 2); // 3–4 (~3%)
        else if (roll >= 0.78) target = 2; // (~19%)

        // Prefer growing along a crack from the click; light tip bias
        const removed = [];
        const queue = [[x, y]];
        const seen = new Set([`${x},${y}`]);
        while (queue.length && removed.length < target) {
            const idx = rng() < 0.2
                ? queue.length - 1
                : Math.floor(rng() * queue.length);
            const [cx, cy] = queue.splice(idx, 1)[0];
            if (!next[cy][cx]) continue;
            next[cy][cx] = false;
            removed.push([cx, cy]);
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            // Shuffle dirs
            for (let i = dirs.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                const t = dirs[i];
                dirs[i] = dirs[j];
                dirs[j] = t;
            }
            for (const [dx, dy] of dirs) {
                const nx = cx + dx;
                const ny = cy + dy;
                const key = `${nx},${ny}`;
                if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
                if (!next[ny][nx] || seen.has(key)) continue;
                seen.add(key);
                queue.push([nx, ny]);
            }
        }

        // Drop tiny floating flakes, then keep the main blank if a chunk split off
        const pruned = this.keepMainPiece(this.pruneLooseDebris(next));
        const check = this.shatterCheck(pruned);
        return {
            grid: pruned,
            shattered: check.shattered,
            reason: check.reason,
            removed: removed.length
        };
    },

    /**
     * Remove connected components smaller than SHATTER_COMP_MIN (stray flakes
     * left after a crack). Larger cut-offs are handled by keepMainPiece.
     */
    pruneLooseDebris(grid) {
        const min = this.SHATTER_COMP_MIN;
        const comps = this.components(grid);
        if (comps.length <= 1) return grid;
        let culled = false;
        for (const c of comps) {
            if (c.length < min) {
                culled = true;
                break;
            }
        }
        if (!culled) return grid;
        const out = this.cloneGrid(grid);
        for (const c of comps) {
            if (c.length >= min) continue;
            for (const [x, y] of c) out[y][x] = false;
        }
        return out;
    },

    /**
     * After a cut splits the stone, keep the largest piece and drop the rest.
     * Shatter only happens later if that piece is below MIN_MASS.
     */
    keepMainPiece(grid) {
        const comps = this.components(grid);
        if (comps.length <= 1) return grid;
        let best = comps[0];
        for (let i = 1; i < comps.length; i++) {
            if (comps[i].length > best.length) best = comps[i];
        }
        const out = this.emptyGrid();
        for (const [x, y] of best) out[y][x] = true;
        return out;
    },

    /** Connected components as lists of [x,y]. */
    components(grid) {
        const n = this.SIZE;
        const seen = this.emptyGrid();
        const comps = [];
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (!grid[y][x] || seen[y][x]) continue;
                const cells = [];
                const stack = [[x, y]];
                seen[y][x] = true;
                while (stack.length) {
                    const [cx, cy] = stack.pop();
                    cells.push([cx, cy]);
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nx = cx + dx;
                        const ny = cy + dy;
                        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
                        if (!grid[ny][nx] || seen[ny][nx]) continue;
                        seen[ny][nx] = true;
                        stack.push([nx, ny]);
                    }
                }
                comps.push(cells);
            }
        }
        return comps;
    },

    shatterCheck(grid) {
        const m = this.mass(grid);
        if (m < this.MIN_MASS) {
            return { shattered: true, reason: "It crumbled to dust" };
        }
        return { shattered: false, reason: null };
    },

    _aabb(grid) {
        const n = this.SIZE;
        let minX = n, minY = n, maxX = -1, maxY = -1;
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (!grid[y][x]) continue;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < 0) return { w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
        return { w: maxX - minX + 1, h: maxY - minY + 1, minX, minY, maxX, maxY };
    },

    _distToEdge(grid) {
        const n = this.SIZE;
        const dist = Array.from({ length: n }, () => new Array(n).fill(Infinity));
        const q = [];
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (!grid[y][x]) continue;
                if (this.isEdgeCell(grid, x, y)) {
                    dist[y][x] = 0;
                    q.push([x, y]);
                }
            }
        }
        let i = 0;
        while (i < q.length) {
            const [x, y] = q[i++];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
                if (!grid[ny][nx]) continue;
                const nd = dist[y][x] + 1;
                if (nd < dist[ny][nx]) {
                    dist[ny][nx] = nd;
                    q.push([nx, ny]);
                }
            }
        }
        let sum = 0, count = 0;
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (!grid[y][x] || !Number.isFinite(dist[y][x])) continue;
                sum += dist[y][x];
                count++;
            }
        }
        return count ? sum / count : 0;
    },

    /** Longest contiguous edge-cell run (4-connected along boundary). */
    _edgeScore(grid) {
        const n = this.SIZE;
        const edges = [];
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (this.isEdgeCell(grid, x, y)) edges.push([x, y]);
            }
        }
        if (!edges.length) return 0;
        const set = new Set(edges.map(([x, y]) => `${x},${y}`));
        const seen = new Set();
        let best = 0;
        for (const [sx, sy] of edges) {
            const key0 = `${sx},${sy}`;
            if (seen.has(key0)) continue;
            let len = 0;
            const stack = [[sx, sy]];
            seen.add(key0);
            while (stack.length) {
                const [x, y] = stack.pop();
                len++;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = x + dx;
                    const ny = y + dy;
                    const k = `${nx},${ny}`;
                    if (!set.has(k) || seen.has(k)) continue;
                    seen.add(k);
                    stack.push([nx, ny]);
                }
            }
            if (len > best) best = len;
        }
        return best;
    },

    /**
     * Tip score: extremities of the AABB with locally thin cross-section.
     */
    _tipScore(grid) {
        const box = this._aabb(grid);
        if (box.w < 2 || box.h < 2) return 0;
        const candidates = [];
        const n = this.SIZE;
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (!this.isEdgeCell(grid, x, y)) continue;
                // Local thickness: solids in 3×3
                let local = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
                        if (grid[ny][nx]) local++;
                    }
                }
                const thin = 1 - Math.min(1, (local - 1) / 8);
                // Distance from center of mass AABB → extremity bonus
                const cx = (box.minX + box.maxX) / 2;
                const cy = (box.minY + box.maxY) / 2;
                const reach = Math.hypot(x - cx, y - cy)
                    / Math.max(1, Math.hypot(box.w, box.h) * 0.5);
                candidates.push(thin * 0.55 + Math.min(1, reach) * 0.45);
            }
        }
        if (!candidates.length) return 0;
        return Math.max(...candidates);
    },

    /**
     * Blade taper along the long axis: 0 = same thickness both ends, 1 = one end vanishes.
     * Knives need a real pointy end vs a thicker body — not a flat potato.
     */
    _taperScore(grid) {
        const box = this._aabb(grid);
        if (box.w < 3 || box.h < 2) return 0;
        const widths = [];
        if (box.w >= box.h) {
            for (let x = box.minX; x <= box.maxX; x++) {
                let c = 0;
                for (let y = box.minY; y <= box.maxY; y++) {
                    if (grid[y][x]) c++;
                }
                widths.push(c);
            }
        } else {
            for (let y = box.minY; y <= box.maxY; y++) {
                let c = 0;
                for (let x = box.minX; x <= box.maxX; x++) {
                    if (grid[y][x]) c++;
                }
                widths.push(c);
            }
        }
        const n = widths.length;
        const q = Math.max(1, Math.floor(n / 4));
        let left = 0;
        let right = 0;
        for (let i = 0; i < q; i++) left += widths[i];
        for (let i = n - q; i < n; i++) right += widths[i];
        left /= q;
        right /= q;
        const tipW = Math.min(left, right);
        const bodyW = Math.max(left, right);
        if (bodyW < 1.5) return 0;
        return Phaser.Math.Clamp(1 - tipW / bodyW, 0, 1);
    },

    /**
     * Fraction of long-axis slices with 2+ separate solid runs.
     * C-shapes / forks / hooks score high; a real blade stays ~0.
     */
    _forkRatio(grid) {
        const box = this._aabb(grid);
        if (box.w < 2 || box.h < 2) return 0;
        let multi = 0;
        let total = 0;
        const countRuns = (vals) => {
            let runs = 0;
            let on = false;
            for (const v of vals) {
                if (v && !on) {
                    runs++;
                    on = true;
                } else if (!v) {
                    on = false;
                }
            }
            return runs;
        };
        if (box.w >= box.h) {
            for (let x = box.minX; x <= box.maxX; x++) {
                const col = [];
                for (let y = box.minY; y <= box.maxY; y++) col.push(!!grid[y][x]);
                const runs = countRuns(col);
                if (runs === 0) continue;
                total++;
                if (runs >= 2) multi++;
            }
        } else {
            for (let y = box.minY; y <= box.maxY; y++) {
                const row = [];
                for (let x = box.minX; x <= box.maxX; x++) row.push(!!grid[y][x]);
                const runs = countRuns(row);
                if (runs === 0) continue;
                total++;
                if (runs >= 2) multi++;
            }
        }
        return total ? multi / total : 0;
    },

    /**
     * @param {boolean[][]} grid
     * @param {"pebble"|"flint"} material
     */
    classify(grid, material = "pebble") {
        const mass = this.mass(grid);
        const box = this._aabb(grid);
        const elong = Math.max(box.w, box.h) / Math.max(1, Math.min(box.w, box.h));
        const tip = this._tipScore(grid);
        const edge = this._edgeScore(grid);
        const thickness = this._distToEdge(grid);
        const taper = this._taperScore(grid);
        const fork = this._forkRatio(grid);
        const fill = mass / Math.max(1, box.w * box.h);
        const matMult = material === "flint" ? 1.25 : 1;

        // Order matters. Awl before spear/knife so butt+spike isn't stolen.
        // Spear = long fairly even shaft; knife = tapered blade with body.
        let toolClass = "blank";
        const minSide = Math.min(box.w, box.h);
        const maxSide = Math.max(box.w, box.h);
        if (
            // Small pierce spike (T / butt+point). AABB taper misses stems off the long axis.
            tip >= 0.55
            && mass >= 5
            && mass <= 24
            && maxSide <= 11
            && minSide <= 5
            && elong >= 1.2
            && fork <= 0.35
            && fill <= 0.7
            && (taper >= 0.35 || (tip >= 0.62 && mass <= 16))
        ) {
            toolClass = "awl";
        } else if (
            elong >= 2.15
            && tip >= 0.52
            && taper < 0.65
            && minSide <= 5
            && mass >= 12
            && mass <= 80
            && fork <= 0.15
        ) {
            toolClass = "spear_tip";
        } else if (
            tip >= 0.48
            && taper >= 0.22
            && elong >= 1.3
            && elong < 2.15
            && edge >= 8
            && mass >= 14
            && mass <= 60
            && fill >= 0.38
            && thickness < 1.7
            && fork <= 0.15
            && maxSide >= 6
        ) {
            toolClass = "knife";
        } else if (
            // Wide flat flake — must be thin or it steals every chopper core
            edge >= 8
            && taper < 0.28
            && thickness < 1.2
            && mass >= 14
            && mass <= 70
            && elong < 2.15
            && minSide >= 3
            && fork <= 0.25
        ) {
            toolClass = "scraper";
        } else if (
            // Heavy core leftover — thickness≥1.2 almost never fired on 16×16 silhouettes
            mass >= 28
            && fill >= 0.4
            && elong < 2.15
            && taper < 0.4
        ) {
            toolClass = "chopper";
        }

        const sharpness = Phaser.Math.Clamp(
            tip * 0.55 + Math.min(1, edge / 20) * 0.35 + (1 - Math.min(1, thickness / 3)) * 0.1,
            0.15,
            1
        );
        const quality = sharpness >= 0.7 ? "fine" : sharpness >= 0.45 ? "rough" : "crude";
        // Wide bands so Fine clearly outdamages Rough/Crude
        const qualityMult = { crude: 0.65, rough: 0.95, fine: 1.35 }[quality];

        const baseDmg = {
            knife: 7,
            scraper: 4,
            chopper: 9,
            awl: 3,
            spear_tip: 0,
            blank: 2
        }[toolClass] || 2;

        const damage = toolClass === "spear_tip" || toolClass === "blank"
            ? 0
            : Math.round(baseDmg * qualityMult * matMult * 10) / 10;

        const matLabel = material === "flint" ? "Flint" : "Stone";
        const classNames = {
            knife: "Knife",
            scraper: "Scraper",
            chopper: "Chopper",
            awl: "Awl",
            spear_tip: "Spear Tip",
            blank: "Flake"
        };
        const qLabel = quality.charAt(0).toUpperCase() + quality.slice(1);
        const name = toolClass === "spear_tip" || toolClass === "blank"
            ? `${matLabel} ${classNames[toolClass]}`
            : `${qLabel} ${matLabel} ${classNames[toolClass]}`;

        const preview = this.previewLine(toolClass, quality);

        return {
            toolClass,
            sharpness,
            quality,
            damage,
            name,
            preview,
            mass,
            tip,
            edge,
            elong,
            thickness,
            taper,
            fork,
            fill,
            material
        };
    },

    previewLine(toolClass, quality) {
        switch (toolClass) {
            case "knife": return `Looks like a ${quality} knife…`;
            case "scraper": return `Looks like a ${quality} scraper…`;
            case "chopper": return `Looks like a ${quality} chopper…`;
            case "awl": return `Looks like a ${quality} awl…`;
            case "spear_tip": return `Looks like a ${quality} spear tip…`;
            default: return "Unclear flake…";
        }
    },

    /**
     * Inventory stack for a finished knap (maxStack 1, unique stats).
     * @param {object} result  from classify()
     * @param {{ grid?: boolean[][], pixels?: Uint8ClampedArray, iconData?: string, scene?: Phaser.Scene }} [visual]
     */
    makeToolStack(result, visual = null) {
        const material = result.material === "flint" ? "flint" : "pebble";
        const id = material === "flint" ? "flint_tool" : "stone_tool";
        const stack = {
            id,
            quantity: 1,
            customName: result.name,
            toolClass: result.toolClass,
            sharpness: result.sharpness,
            knapDamage: result.damage,
            knapMaterial: material
            // weight comes from stone_tool / flint_tool defs (same as pebble / flint)
        };
        // Weapons use DPS from attack verbs (like spears) — no raw Damage: line
        if (result.toolClass === "blank") {
            stack.tooltipExtra = "Failed knapping";
        } else if (result.toolClass === "knife") {
            stack.tooltipExtra = "Mr. Stabby";
        } else if (result.toolClass === "chopper") {
            stack.tooltipExtra = "Slow but heavy";
        } else if (result.toolClass === "awl") {
            stack.tooltipExtra = "For sewing hides";
        }
        if (result.quality) stack.knapQuality = result.quality;
        try {
            let grid = visual?.grid || null;
            let pixels = visual?.pixels || null;
            if ((!grid || !pixels) && visual?.iconData) {
                pixels = this.unpackIconData(visual.iconData);
                grid = pixels ? this.gridFromPixels(pixels) : null;
            }
            if (grid && pixels) {
                stack.knapIconData = this.packIconData(grid, pixels);
            } else if (visual?.iconData) {
                stack.knapIconData = visual.iconData;
            }
            if (stack.knapIconData && visual?.scene) {
                this.ensureToolTexture(visual.scene, stack);
            }
        } catch (_) {
            // Icon bake must never block granting the tool
        }
        return stack;
    },

    /** Synthetic weapon meta for BodyCombat / autofire (multi-verb like spears). */
    weaponMetaFromStack(baseMeta, stack) {
        if (!stack || !baseMeta) return null;
        const cls = stack.toolClass;
        const dmg = Number(stack.knapDamage) || 0;
        if (!["knife", "scraper", "chopper", "awl"].includes(cls) || !(dmg > 0)) {
            return null;
        }
        const r = (n) => Math.round(n * 10) / 10;
        let attacks;
        if (cls === "knife") {
            attacks = [
                {
                    id: "knap_knife_slash",
                    name: "Slash",
                    damage: dmg,
                    type: "sharp",
                    verb: "cut",
                    cooldown: 2.0,
                    weightMultiplier: 1,
                    source: "hand"
                },
                {
                    id: "knap_knife_stab",
                    name: "Stab",
                    damage: r(dmg * 0.85),
                    type: "sharp",
                    verb: "stabbed",
                    cooldown: 1.7,
                    weightMultiplier: 0.65,
                    source: "hand"
                }
            ];
        } else if (cls === "scraper") {
            attacks = [
                {
                    id: "knap_scraper_edge",
                    name: "Scrape",
                    damage: dmg,
                    type: "sharp",
                    verb: "scraped",
                    cooldown: 2.0,
                    weightMultiplier: 1,
                    source: "hand"
                },
                {
                    id: "knap_scraper_hack",
                    name: "Hack",
                    damage: r(dmg * 0.75),
                    type: "sharp",
                    verb: "hacked",
                    cooldown: 2.3,
                    weightMultiplier: 0.55,
                    source: "hand"
                }
            ];
        } else if (cls === "chopper") {
            attacks = [
                {
                    id: "knap_chopper_chop",
                    name: "Chop",
                    damage: dmg,
                    type: "sharp",
                    verb: "chopped",
                    cooldown: 2.4,
                    weightMultiplier: 1,
                    source: "hand"
                },
                {
                    id: "knap_chopper_bash",
                    name: "Bash",
                    damage: r(dmg * 0.7),
                    type: "blunt",
                    verb: "bashed",
                    cooldown: 2.2,
                    weightMultiplier: 0.5,
                    source: "hand"
                }
            ];
        } else {
            // awl
            attacks = [
                {
                    id: "knap_awl_pierce",
                    name: "Pierce",
                    damage: dmg,
                    type: "sharp",
                    verb: "pierced",
                    cooldown: 1.6,
                    weightMultiplier: 1,
                    source: "hand"
                },
                {
                    id: "knap_awl_poke",
                    name: "Poke",
                    damage: r(dmg * 0.7),
                    type: "sharp",
                    verb: "poked",
                    cooldown: 1.4,
                    weightMultiplier: 0.6,
                    source: "hand"
                }
            ];
        }
        // Short hand tools — tip-anchored silhouette hits (not spear frame corners).
        const range = 2.8;
        return {
            ...baseMeta,
            name: stack.customName || baseMeta.name,
            key: stack.knapIcon || baseMeta.key,
            weapon: {
                type: "melee",
                range,
                hitStart: 0.3,
                hitEnd: 0.65,
                knapSilhouette: true,
                attacks
            }
        };
    }
};
