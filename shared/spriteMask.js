/**
 * Opaque pixels of the living sprites (16×16 frames, 4 rows × 3).
 * Bit 0 of each row is the left edge. Alpha above 8 counts as body.
 * Humans, deer, and boars share these sheets; player looks are the human silhouette.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SpriteMask = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const FRAME = 16;
    const DIRS = ["down", "left", "right", "up"];
    /** Each frame is 16 row masks. */
    const FRAMES = {
    human: [
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x1ff8,0x3ffc,0x3ffc,0x3ffc,0x3ffc,0x3ff0,0x3ff0,0x0e70,0x0e70,0x0070],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x1ff8,0x3ffc,0x3ffc,0x3ffc,0x3ffc,0x3ffc,0x0ff0,0x0e70,0x0e70,0x0000],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x1ff8,0x3ffc,0x3ffc,0x3ffc,0x3ffc,0x0ffc,0x0ffc,0x0e70,0x0e70,0x0e00],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x03c0,0x03c0,0x07e0,0x0ff0,0x0ff0,0x03c0,0x0660,0x0660,0x0000],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x03c0,0x03c0,0x03c0,0x03c0,0x03c0,0x03c0,0x03c0,0x03c0,0x0000],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x03c0,0x03c0,0x07e0,0x0ff0,0x0ff0,0x03c0,0x0660,0x0660,0x0000],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x03c0,0x03c0,0x07e0,0x0ff0,0x0ff0,0x03c0,0x0660,0x0660,0x0000],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x03c0,0x03c0,0x03c0,0x03c0,0x03c0,0x03c0,0x03c0,0x03c0,0x0000],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x03c0,0x03c0,0x07e0,0x0ff0,0x0ff0,0x03c0,0x0660,0x0660,0x0000],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x1ff8,0x3ffc,0x3ffc,0x3ffc,0x3ffc,0x3ff0,0x3ff0,0x0e70,0x0070,0x0000],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x1ff8,0x3ffc,0x3ffc,0x3ffc,0x3ffc,0x3ffc,0x0ff0,0x0e70,0x0e70,0x0000],
        [0x0000,0x07e0,0x07e0,0x07e0,0x07e0,0x07e0,0x1ff8,0x3ffc,0x3ffc,0x3ffc,0x3ffc,0x0ffc,0x0ffc,0x0e70,0x0e00,0x0000]
    ],
    deer: [
        [0x0000,0x0000,0x2004,0x2bd4,0x1ff8,0x0ff0,0x07e0,0x07c0,0x07c0,0x03c0,0x07e0,0x07e0,0x0660,0x0660,0x0060,0x0060],
        [0x0000,0x0000,0x2004,0x2bd4,0x1ff8,0x0ff0,0x07e0,0x07e0,0x03c0,0x03c0,0x07e0,0x07e0,0x0660,0x0660,0x0660,0x0000],
        [0x0000,0x0000,0x2004,0x2bd4,0x1ff8,0x0ff0,0x07e0,0x03e0,0x03e0,0x03c0,0x07e0,0x07e0,0x0660,0x0660,0x0600,0x0600],
        [0x0000,0x0400,0x0500,0x0300,0x0140,0x00c0,0x00f0,0x00fc,0x00fc,0x07e0,0x07e0,0x0fe0,0x0e70,0x1ad0,0x1290,0x0000],
        [0x0000,0x0400,0x0500,0x0300,0x0140,0x00c0,0x00f0,0x00fc,0x00fc,0x07e0,0x07e0,0x0ff0,0x0c30,0x0c30,0x0c30,0x0000],
        [0x0000,0x0400,0x0500,0x0300,0x0140,0x00c0,0x00f0,0x00fc,0x00fc,0x07e0,0x07e0,0x0fe0,0x0e70,0x1ad0,0x1290,0x0000],
        [0x0000,0x0020,0x00a0,0x00c0,0x0280,0x0300,0x0f00,0x3f00,0x3f00,0x07e0,0x07e0,0x07f0,0x0e70,0x0b58,0x0948,0x0000],
        [0x0000,0x0020,0x00a0,0x00c0,0x0280,0x0300,0x0f00,0x3f00,0x3f00,0x07e0,0x07e0,0x0ff0,0x0c30,0x0c30,0x0c30,0x0000],
        [0x0000,0x0020,0x00a0,0x00c0,0x0280,0x0300,0x0f00,0x3f00,0x3f00,0x07e0,0x07e0,0x07f0,0x0e70,0x0b58,0x0948,0x0000],
        [0x0000,0x0180,0x03c0,0x03c0,0x07e0,0x07e0,0x07e0,0x0bf0,0x1bf8,0x2bd4,0x27e4,0x0660,0x0660,0x0660,0x0060,0x0060],
        [0x0000,0x0180,0x03c0,0x03c0,0x07e0,0x07e0,0x07e0,0x0ff0,0x1bd8,0x2bd4,0x27e4,0x0660,0x0660,0x0660,0x0660,0x0000],
        [0x0000,0x0180,0x03c0,0x03c0,0x07e0,0x07e0,0x07e0,0x0fd0,0x1fd8,0x2bd4,0x27e4,0x0660,0x0660,0x0660,0x0600,0x0600]
    ],
    boar: [
        [0x0000,0x0000,0x0000,0x0000,0x0000,0x03c0,0x07e0,0x07e0,0x07c0,0x07c0,0x03c0,0x07e0,0x07e0,0x0660,0x0060,0x0060],
        [0x0000,0x0000,0x0000,0x0000,0x0000,0x03c0,0x07e0,0x07e0,0x07e0,0x03c0,0x03c0,0x07e0,0x07e0,0x0660,0x0660,0x0000],
        [0x0000,0x0000,0x0000,0x0000,0x0000,0x03c0,0x07e0,0x07e0,0x03e0,0x03e0,0x03c0,0x07e0,0x07e0,0x0660,0x0600,0x0600],
        [0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0040,0x00f0,0x00fc,0x00fc,0x07e0,0x07e0,0x0770,0x0550,0x0000],
        [0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0040,0x00f0,0x00fc,0x00fc,0x07e0,0x07e0,0x0660,0x0660,0x0000],
        [0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0040,0x00f0,0x00fc,0x00fc,0x07e0,0x07e0,0x0770,0x0550,0x0000],
        [0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0200,0x0f00,0x3f00,0x3f00,0x07e0,0x07e0,0x0ee0,0x0aa0,0x0000],
        [0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0200,0x0f00,0x3f00,0x3f00,0x07e0,0x07e0,0x0660,0x0660,0x0000],
        [0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0200,0x0f00,0x3f00,0x3f00,0x07e0,0x07e0,0x0ee0,0x0aa0,0x0000],
        [0x0000,0x0000,0x0000,0x03c0,0x03c0,0x03c0,0x07e0,0x07e0,0x03e0,0x03e0,0x03c0,0x07e0,0x0660,0x0660,0x0060,0x0060],
        [0x0000,0x0000,0x0000,0x03c0,0x03c0,0x03c0,0x07e0,0x07e0,0x07e0,0x03c0,0x03c0,0x07e0,0x0660,0x0660,0x0660,0x0000],
        [0x0000,0x0000,0x0000,0x03c0,0x03c0,0x03c0,0x07e0,0x07e0,0x07c0,0x07c0,0x03c0,0x07e0,0x0660,0x0660,0x0600,0x0600]
    ],
    };

    const union = {};
    for (const key of Object.keys(FRAMES)) {
        union[key] = DIRS.map((_, row) => {
            const rows = new Array(FRAME).fill(0);
            for (let f = 0; f < 3; f++) {
                const frame = FRAMES[key][row * 3 + f];
                for (let y = 0; y < FRAME; y++) rows[y] |= frame[y];
            }
            return rows;
        });
    }

    function opaque(rows, x, y) {
        x = x | 0;
        y = y | 0;
        if (x < 0 || y < 0 || x >= FRAME || y >= FRAME) return false;
        return ((rows[y] >> x) & 1) === 1;
    }

    function sleepApi() {
        if (typeof Sleep !== "undefined" && Sleep.restRotation) return Sleep;
        if (typeof require === "function") {
            try { return require("./sleep"); } catch (_) { return null; }
        }
        return null;
    }

    function maskKeyOf(target) {
        if (!target || typeof target !== "object") return null;
        const named = target.maskKey;
        if (named && FRAMES[named]) return named;
        const plan = target.def?.bodyPlan || target.anatomy?.planId || target.bodyPlan || null;
        const id = target.def?.id || target.def?.key || target.mobId || null;
        const tex = target.texture?.key || target.key || null;
        if (id === "deer" || plan === "deer" || tex === "deer") return "deer";
        if (id === "boar" || plan === "boar" || tex === "boar") return "boar";
        if (
            id === "human" || plan === "human" || tex === "human"
            || target.kind === "player"
            || (typeof tex === "string" && tex.indexOf("look-") === 0)
        ) return "human";
        return null;
    }

    /**
     * Draw pose for damage. Standing sprites are feet-origin.
     * A downed body is the right-facing frame turned onto its side.
     * A sleeper's x/y is already that center.
     */
    function poseOf(target) {
        const key = maskKeyOf(target);
        if (!key) return null;
        const w = Number(target.width) > 0 ? Number(target.width) : FRAME;
        const h = Number(target.height) > 0 ? Number(target.height) : FRAME;
        const x = Number(target.x) || 0;
        const y = Number(target.y) || 0;
        const resting = !!target._resting;
        const prone = !!(target._prone || resting);
        if (!prone) {
            const facing = DIRS.indexOf(target.facing);
            const row = facing >= 0 ? facing : 0;
            return {
                key,
                rows: union[key][row],
                x, y, w, h,
                originX: 0,
                originY: 1,
                rotation: 0,
                scale: 1
            };
        }
        let rotation = -Math.PI / 2;
        let scale = 1;
        let cx = x;
        let cy = y;
        if (resting) {
            const S = sleepApi();
            scale = Number(S?.SCALE) > 0 ? Number(S.SCALE) : 0.85;
            if (Number.isFinite(target.lastSleep?.ang)) rotation = target.lastSleep.ang;
            else if (target.lastSleep && S?.restRotation) {
                rotation = S.restRotation(target.lastSleep.rot, null);
            }
        } else if (Number(target.originX) !== 0.5) {
            cx = x + w * 0.5;
            cy = y - h * 0.5;
        }
        return {
            key,
            rows: FRAMES[key][7],
            x: cx,
            y: cy,
            w, h,
            originX: 0.5,
            originY: 0.5,
            rotation,
            scale
        };
    }

    function worldOf(px, py, pose) {
        const s = pose.scale || 1;
        const lx = (px - pose.originX * pose.w) * s;
        const ly = (py - pose.originY * pose.h) * s;
        const rot = pose.rotation || 0;
        if (!rot) return { x: pose.x + lx, y: pose.y + ly };
        const c = Math.cos(rot);
        const sn = Math.sin(rot);
        return {
            x: pose.x + lx * c - ly * sn,
            y: pose.y + lx * sn + ly * c
        };
    }

    function distPointToSegment(px, py, ax, ay, bx, by) {
        const abx = bx - ax;
        const aby = by - ay;
        const len2 = abx * abx + aby * aby;
        if (len2 <= 1e-8) return Math.hypot(px - ax, py - ay);
        let t = ((px - ax) * abx + (py - ay) * aby) / len2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
    }

    function eachOpaque(pose, fn) {
        const rows = pose.rows;
        for (let y = 0; y < FRAME; y++) {
            let bits = rows[y];
            if (!bits) continue;
            for (let x = 0; x < FRAME; x++) {
                if ((bits & 1) === 1) fn(x, y);
                bits >>= 1;
            }
        }
    }

    /**
     * True/false when this target has a body mask. Null when it does not,
     * so callers can fall back to a rectangle.
     * `radius` is the weapon's thickness, not a pad on the body.
     */
    function segmentHits(ax, ay, bx, by, radius, target) {
        const pose = poseOf(target);
        if (!pose) return null;
        const r = (Number(radius) || 0) + 0.5 * (pose.scale || 1);
        let hit = false;
        eachOpaque(pose, (x, y) => {
            if (hit) return;
            const p = worldOf(x + 0.5, y + 0.5, pose);
            if (distPointToSegment(p.x, p.y, ax, ay, bx, by) <= r) hit = true;
        });
        return hit;
    }

    /** Distance from a point to the opaque body. 0 when the point is on a pixel. */
    function edgeDist(ax, ay, target) {
        const pose = poseOf(target);
        if (!pose) return null;
        const reach = 0.5 * (pose.scale || 1);
        let best = Infinity;
        eachOpaque(pose, (x, y) => {
            const p = worldOf(x + 0.5, y + 0.5, pose);
            const d = Math.hypot(ax - p.x, ay - p.y);
            if (d < best) best = d;
        });
        if (!Number.isFinite(best)) return null;
        return Math.max(0, best - reach);
    }

    /** Axis-aligned bounds of the opaque body, grown by `pad`. */
    function bounds(target, pad = 0) {
        const pose = poseOf(target);
        if (!pose) return null;
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        eachOpaque(pose, (x, y) => {
            const corners = [
                worldOf(x, y, pose),
                worldOf(x + 1, y, pose),
                worldOf(x + 1, y + 1, pose),
                worldOf(x, y + 1, pose)
            ];
            for (let i = 0; i < 4; i++) {
                const p = corners[i];
                if (p.x < left) left = p.x;
                if (p.y < top) top = p.y;
                if (p.x > right) right = p.x;
                if (p.y > bottom) bottom = p.y;
            }
        });
        if (!Number.isFinite(left)) return null;
        const p = Number(pad) || 0;
        return { left: left - p, top: top - p, right: right + p, bottom: bottom + p };
    }

    return {
        FRAMES,
        maskKeyOf,
        poseOf,
        opaque,
        segmentHits,
        edgeDist,
        bounds
    };
});
