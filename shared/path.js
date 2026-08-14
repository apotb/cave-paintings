/**
 * Sticky grid path follow for party, wanderers, rest-walks, and wildlife detours.
 * Phaser-free (Node + browser UMD).
 *
 * Callers pass blocked(x, y) that matches how the creature actually moves.
 * Never drop a committed path just because a far dest has line of sight.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Path = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const TILE = 16;
    const WAYPOINT_PX = 10;
    const GOAL_DRIFT_PX = 48;
    const STUCK_MS = 400;
    const LOOK_PX = 24;
    const LOS_STEP = 3;
    const ARRIVE_PX = 2;

    function hypot(dx, dy) {
        return Math.hypot(dx, dy);
    }

    /**
     * Grid cell of a standing feet pose (origin 0,1). `y - 1` so feet on a
     * tile's bottom edge count as that tile, not the one below.
     */
    function cellOf(x, y, cell) {
        const c = cell || TILE;
        return {
            cx: Math.floor(x / c),
            cy: Math.floor((y - 1) / c)
        };
    }

    /**
     * Standing feet in a cell. Thing hitboxes sit at the tile bottom; the
     * geometric center is above them and used to miss every 1×1 tree.
     */
    function cellStand(cx, cy, cell) {
        const c = cell || TILE;
        return { x: cx * c + c * 0.25, y: cy * c + c };
    }

    function losClear(x0, y0, x1, y1, blocked, opts) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const dist = hypot(dx, dy);
        if (!(dist > 4)) return true;
        const stepPx = (opts && opts.stepPx) || LOS_STEP;
        const cap = opts && Number(opts.maxDist);
        const maxDist = Number.isFinite(cap) ? Math.min(dist, cap) : dist;
        const steps = Math.max(2, Math.ceil(maxDist / stepPx));
        for (let i = 1; i <= steps; i++) {
            const f = ((maxDist * i) / steps) / dist;
            if (blocked(x0 + dx * f, y0 + dy * f)) return false;
        }
        return true;
    }

    function blockedAhead(from, to, blocked, lookPx) {
        const look = lookPx || LOOK_PX;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = hypot(dx, dy) || 1;
        const reach = Math.min(look, dist);
        if (!(reach > 2)) return false;
        return !losClear(
            from.x,
            from.y,
            from.x + (dx / dist) * reach,
            from.y + (dy / dist) * reach,
            blocked,
            { stepPx: 3, maxDist: reach }
        );
    }

    /** BFS neighbor order biased so equal-cost left/right ties keep `side`. */
    function dirOrder(tdx, tdy, side) {
        const s = side >= 0 ? 1 : -1;
        const absx = Math.abs(tdx);
        const absy = Math.abs(tdy);
        let along;
        let perp;
        if (absy >= absx) {
            along = [0, tdy === 0 ? 1 : Math.sign(tdy)];
            perp = [s, 0];
        } else {
            along = [tdx === 0 ? 1 : Math.sign(tdx), 0];
            perp = [0, s];
        }
        const back = [-along[0], -along[1]];
        const other = [-perp[0], -perp[1]];
        const raw = [
            along,
            perp,
            [along[0] + perp[0], along[1] + perp[1]],
            [along[0] + other[0], along[1] + other[1]],
            other,
            back,
            [back[0] + perp[0], back[1] + perp[1]],
            [back[0] + other[0], back[1] + other[1]]
        ];
        const out = [];
        const seen = new Set();
        for (let i = 0; i < raw.length; i++) {
            const d = raw[i];
            if (!d[0] && !d[1]) continue;
            const k = `${d[0]},${d[1]}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(d);
        }
        return out;
    }

    function stringPull(from, pts, blocked) {
        if (!pts || pts.length <= 1) return pts;
        const out = [];
        let ax = from.x;
        let ay = from.y;
        let i = 0;
        while (i < pts.length) {
            let j = pts.length - 1;
            while (j > i && !losClear(ax, ay, pts[j].x, pts[j].y, blocked)) j--;
            out.push(pts[j]);
            ax = pts[j].x;
            ay = pts[j].y;
            i = j + 1;
        }
        return out;
    }

    function openPoint(x, y, blocked, cell, side, maxR) {
        if (!blocked(x, y)) return { x, y };
        const step = Math.max(8, cell * 0.55);
        const bias = side >= 0 ? 0.2 : -0.2;
        const rings = Number.isFinite(maxR) ? Math.max(0, maxR) : 6;
        for (let r = 1; r <= rings; r++) {
            for (let a = 0; a < 8; a++) {
                const ang = (a / 8) * Math.PI * 2 + bias;
                const px = x + Math.cos(ang) * step * r;
                const py = y + Math.sin(ang) * step * r;
                if (!blocked(px, py)) return { x: px, y: py };
            }
        }
        return { x, y };
    }

    function planPath(from, to, blocked, opts) {
        const cell = (opts && opts.cellSize) || TILE;
        const maxR = (opts && opts.maxRange) || 12;
        const side = (opts && opts.side) || 1;
        const start = cellOf(from.x, from.y, cell);
        const goal = cellOf(to.x, to.y, cell);
        const sx = start.cx;
        const sy = start.cy;
        const gx = goal.cx;
        const gy = goal.cy;
        if (sx === gx && sy === gy) return [{ x: to.x, y: to.y }];
        const keyOf = (cx, cy) => `${cx},${cy}`;
        const came = new Map();
        came.set(keyOf(sx, sy), null);
        const q = [[sx, sy]];
        let found = null;
        let best = [sx, sy];
        let bestH = Math.abs(gx - sx) + Math.abs(gy - sy);
        const dirs = dirOrder(gx - sx, gy - sy, side);
        let steps = 0;
        while (q.length && steps < 280) {
            const cur = q.shift();
            const cx = cur[0];
            const cy = cur[1];
            steps++;
            const h = Math.abs(gx - cx) + Math.abs(gy - cy);
            if (h < bestH) {
                bestH = h;
                best = cur;
            }
            if (cx === gx && cy === gy) {
                found = cur;
                break;
            }
            for (let d = 0; d < dirs.length; d++) {
                const nx = cx + dirs[d][0];
                const ny = cy + dirs[d][1];
                if (Math.abs(nx - sx) > maxR || Math.abs(ny - sy) > maxR) continue;
                const k = keyOf(nx, ny);
                if (came.has(k)) continue;
                const goalCell = nx === gx && ny === gy;
                const pos = cellStand(nx, ny, cell);
                if (!goalCell && blocked(pos.x, pos.y)) continue;
                const ddx = dirs[d][0];
                const ddy = dirs[d][1];
                if (ddx && ddy) {
                    const sideX = cellStand(cx + ddx, cy, cell);
                    const sideY = cellStand(cx, cy + ddy, cell);
                    if (blocked(sideX.x, sideX.y) || blocked(sideY.x, sideY.y)) continue;
                }
                came.set(k, cur);
                q.push([nx, ny]);
            }
        }
        const end = found || best;
        if (!end || (end[0] === sx && end[1] === sy)) return null;
        const cells = [];
        let cur = end;
        const seen = new Set();
        while (cur && !seen.has(keyOf(cur[0], cur[1]))) {
            seen.add(keyOf(cur[0], cur[1]));
            cells.push(cur);
            cur = came.get(keyOf(cur[0], cur[1]));
        }
        cells.reverse();
        const pts = [];
        for (let i = 1; i < cells.length; i++) {
            pts.push(cellStand(cells[i][0], cells[i][1], cell));
        }
        if (found) pts.push({ x: to.x, y: to.y });
        return stringPull(from, pts, blocked);
    }

    function consumeWaypoints(from, path) {
        if (!path || !path.length) return path;
        while (
            path.length
            && hypot(from.x - path[0].x, from.y - path[0].y) < WAYPOINT_PX
        ) {
            path.shift();
        }
        return path;
    }

    function firstFreeNeighbor(from, blocked, cell, side) {
        const c = cellOf(from.x, from.y, cell);
        const dirs = dirOrder(0, 1, side);
        for (let i = 0; i < dirs.length; i++) {
            const pos = cellStand(c.cx + dirs[i][0], c.cy + dirs[i][1], cell);
            if (!blocked(pos.x, pos.y)) return pos;
        }
        return null;
    }

    /**
     * @param {{
     *   from: {x:number,y:number},
     *   to: {x:number,y:number},
     *   blocked: (x:number,y:number)=>boolean,
     *   cellSize?: number,
     *   side?: number,
     *   path?: {x:number,y:number}[]|null,
     *   pathGoal?: {x:number,y:number}|null,
     *   stuckMs?: number,
     *   lastFrom?: {x:number,y:number}|null,
     *   maxRange?: number,
     *   dt?: number,
     *   lookPx?: number,
     *   overlapping?: boolean,
     *   openRadius?: number
     * }} input
     */
    function steerToward(input) {
        const from = input.from;
        const blocked = input.blocked;
        const cell = input.cellSize || TILE;
        const dt = Number(input.dt) > 0 ? input.dt : 16;
        let side = input.side < 0 ? -1 : 1;
        let path = input.path && input.path.length ? input.path.slice() : null;
        let pathGoal = input.pathGoal || null;
        let stuckMs = Number(input.stuckMs) || 0;
        const maxRange = input.maxRange || 12;
        const lookPx = input.lookPx || LOOK_PX;

        const dest = openPoint(
            input.to.x,
            input.to.y,
            blocked,
            cell,
            side,
            input.openRadius
        );
        const dist = hypot(dest.x - from.x, dest.y - from.y);
        if (!(dist > ARRIVE_PX)) {
            return {
                nx: 0,
                ny: 0,
                path: null,
                pathGoal: dest,
                side,
                stuckMs: 0,
                lastFrom: { x: from.x, y: from.y },
                lastWpDist: 0,
                arrived: true
            };
        }

        path = consumeWaypoints(from, path);
        const wp0 = path && path.length ? path[0] : dest;
        const wpDist = hypot(wp0.x - from.x, wp0.y - from.y);
        const lastWp = Number(input.lastWpDist);
        if (Number.isFinite(lastWp) && wpDist < lastWp - 0.25) stuckMs = 0;
        else stuckMs += dt;
        const overlapping = !!input.overlapping;
        const losMax = Math.min(dist, cell * Math.max(maxRange, 8));
        const clearToDest = !overlapping && losClear(
            from.x, from.y, dest.x, dest.y, blocked,
            { stepPx: 3, maxDist: losMax }
        );
        const ahead = overlapping || blockedAhead(from, dest, blocked, lookPx);
        const goalDrift = !pathGoal
            || hypot(dest.x - pathGoal.x, dest.y - pathGoal.y) > GOAL_DRIFT_PX;
        let nextBlocked = false;
        if (path && path.length) {
            const wx = path[0].x;
            const wy = path[0].y;
            const wd = hypot(wx - from.x, wy - from.y);
            nextBlocked = blocked(wx, wy)
                || !losClear(from.x, from.y, wx, wy, blocked, { maxDist: wd });
        }
        const stuck = stuckMs > STUCK_MS;
        const committed = !!(
            path && path.length && !goalDrift && !nextBlocked && !stuck && !overlapping
        );
        if (!committed) {
            const pathDone = !path || !path.length;
            if (clearToDest && !stuck && !ahead && (pathDone || goalDrift)) {
                path = null;
            } else {
                if (stuck) side = -side;
                path = planPath(from, dest, blocked, { cellSize: cell, maxRange, side });
                pathGoal = dest;
                stuckMs = 0;
                if (!path || !path.length) {
                    const n = firstFreeNeighbor(from, blocked, cell, side);
                    if (n) path = [n];
                }
            }
        }

        let gx = dest.x;
        let gy = dest.y;
        if (path && path.length) {
            gx = path[0].x;
            gy = path[0].y;
        }
        const dx = gx - from.x;
        const dy = gy - from.y;
        const len = hypot(dx, dy) || 1;
        return {
            nx: dx / len,
            ny: dy / len,
            path,
            pathGoal: pathGoal || dest,
            side,
            stuckMs,
            lastFrom: { x: from.x, y: from.y },
            lastWpDist: hypot(dx, dy),
            arrived: false
        };
    }

    function steerHeading(from, nx, ny, blocked, state, opts) {
        const cell = (opts && opts.cellSize) || TILE;
        const range = (opts && opts.rangeTiles) || 6;
        const len = hypot(nx, ny) || 1;
        const to = {
            x: from.x + (nx / len) * range * cell,
            y: from.y + (ny / len) * range * cell
        };
        if (!blockedAhead(from, to, blocked, LOOK_PX)) {
            return {
                nx: nx / len,
                ny: ny / len,
                path: null,
                pathGoal: null,
                side: state && state.side < 0 ? -1 : 1,
                stuckMs: 0,
                lastFrom: { x: from.x, y: from.y },
                lastWpDist: 0,
                arrived: false,
                detour: false
            };
        }
        const steered = steerToward({
            from,
            to,
            blocked,
            cellSize: cell,
            side: state && state.side,
            path: state && state.path,
            pathGoal: state && state.pathGoal,
            stuckMs: state && state.stuckMs,
            lastFrom: state && state.lastFrom,
            maxRange: range,
            dt: opts && opts.dt,
            overlapping: opts && opts.overlapping
        });
        steered.detour = true;
        return steered;
    }

    return {
        TILE,
        LOOK_PX,
        losClear,
        blockedAhead,
        planPath,
        steerToward,
        steerHeading,
        openPoint,
        stringPull,
        cellStand,
        cellOf
    };
});
