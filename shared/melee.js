/**
 * Melee timing + hit-segment math (no Phaser). Shared by client Utils shims and server sim.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const GameMath = require("./gameMath");
        module.exports = factory(GameMath);
    } else {
        root.MeleeMath = factory(root.GameMath);
        // Browser globals matching js/Utils.js names (shims may alias)
        const M = root.MeleeMath;
        root.meleeThrustCurve = M.meleeThrustCurve;
        root.meleeAttackDurationMs = M.meleeAttackDurationMs;
        root.unarmedHitSegment = M.unarmedHitSegment;
        root.meleeSegmentHitsTarget = M.meleeSegmentHitsTarget;
        root.unarmedHitSegmentAt = M.unarmedHitSegmentAt;
        root.placeUnarmedThrustPoint = M.placeUnarmedThrustPoint;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (GameMath) {
    const clamp = GameMath?.clamp || ((v, a, b) => Math.max(a, Math.min(b, v)));

    /**
     * Shared jab curve for player + mob unarmed/weapon thrusts.
     * @returns {number} 0..1 (extend then retract)
     */
    function meleeThrustCurve(progress) {
        const peak = 0.4;
        if (progress <= peak) {
            const t = progress / peak;
            return 1 - (1 - t) * (1 - t);
        }
        const t = (progress - peak) / (1 - peak);
        return (1 - t) * (1 - t);
    }

    /** World position of the fist tip along aim. */
    function placeUnarmedThrustPoint(cx, cy, angle, range, progress) {
        const thrust = meleeThrustCurve(progress);
        const hold = 3;
        const dist = hold + (Number(range) || 4) * thrust;
        return {
            x: cx + Math.cos(angle) * dist,
            y: cy + Math.sin(angle) * dist
        };
    }

    /** Short segment around a fist sprite for hit tests. */
    function unarmedHitSegment(sprite, angle) {
        if (!sprite) return null;
        const c = { x: sprite.x, y: sprite.y };
        return {
            a: { x: c.x - Math.cos(angle) * 3, y: c.y - Math.sin(angle) * 3 },
            b: { x: c.x + Math.cos(angle) * 3, y: c.y + Math.sin(angle) * 3 }
        };
    }

    /** Headless: segment from body center + thrust (no sprite). */
    function unarmedHitSegmentAt(cx, cy, angle, range, progress) {
        const c = placeUnarmedThrustPoint(cx, cy, angle, range, progress);
        return {
            a: { x: c.x - Math.cos(angle) * 3, y: c.y - Math.sin(angle) * 3 },
            b: { x: c.x + Math.cos(angle) * 3, y: c.y + Math.sin(angle) * 3 }
        };
    }

    function meleeSegmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
        const abx = bx - ax;
        const aby = by - ay;
        const cdx = dx - cx;
        const cdy = dy - cy;
        const den = abx * cdy - aby * cdx;
        if (Math.abs(den) < 1e-8) return false;
        const acx = cx - ax;
        const acy = cy - ay;
        const t = (acx * cdy - acy * cdx) / den;
        const u = (acx * aby - acy * abx) / den;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }

    function meleeSegmentHitsRect(ax, ay, bx, by, box, radius = 0) {
        const left = box.left - radius;
        const right = box.right + radius;
        const top = box.top - radius;
        const bottom = box.bottom + radius;
        if (ax >= left && ax <= right && ay >= top && ay <= bottom) return true;
        if (bx >= left && bx <= right && by >= top && by <= bottom) return true;
        const edges = [
            [left, top, right, top],
            [right, top, right, bottom],
            [right, bottom, left, bottom],
            [left, bottom, left, top]
        ];
        for (const [ex1, ey1, ex2, ey2] of edges) {
            if (meleeSegmentsIntersect(ax, ay, bx, by, ex1, ey1, ex2, ey2)) return true;
        }
        return false;
    }

    function meleeDistPointToSegment(px, py, ax, ay, bx, by) {
        const abx = bx - ax;
        const aby = by - ay;
        const len2 = abx * abx + aby * aby;
        if (len2 <= 1e-8) return Math.hypot(px - ax, py - ay);
        let t = ((px - ax) * abx + (py - ay) * aby) / len2;
        t = clamp(t, 0, 1);
        return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
    }

    /**
     * Melee swing length in ms. Matches the old frame timer at 144Hz
     * (`frames = cooldownSec * 60`, real duration = frames / 144).
     */
    function meleeAttackDurationMs(cooldownSec, scale = 1) {
        const REF_FPS = 144;
        const cd = Number(cooldownSec);
        const sc = Number(scale);
        const sec = (Number.isFinite(cd) ? cd : 2) * (Number.isFinite(sc) && sc > 0 ? sc : 1);
        const ms = sec * (60 / REF_FPS) * 1000;
        return Math.max((8 / REF_FPS) * 1000, ms);
    }

    /** Unarmed / melee segment vs a damageable target. */
    function meleeSegmentHitsTarget(a, b, radius, target) {
        if (typeof target.hurtbox === "function") {
            return meleeSegmentHitsRect(a.x, a.y, b.x, b.y, target.hurtbox(0), radius);
        }
        let tx;
        let ty;
        let rad;
        if (typeof target.bodyCenter === "function") {
            const bc = target.bodyCenter();
            tx = bc.x;
            ty = bc.y;
            rad = Math.max(target.width || 16, target.height || 16) * 0.5;
        } else if (target.body?.center) {
            tx = target.body.center.x;
            ty = target.body.center.y;
            rad = Math.max(target.body.width || 16, target.body.height || 16) * 0.55;
        } else {
            tx = target.x;
            ty = target.y;
            rad = 10;
        }
        return meleeDistPointToSegment(tx, ty, a.x, a.y, b.x, b.y) <= rad + radius;
    }

    return {
        meleeThrustCurve,
        placeUnarmedThrustPoint,
        unarmedHitSegment,
        unarmedHitSegmentAt,
        meleeAttackDurationMs,
        meleeSegmentHitsTarget,
        meleeSegmentHitsRect,
        meleeSegmentsIntersect,
        meleeDistPointToSegment
    };
});
