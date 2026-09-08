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
    const STUCK_MS = 1100;
    const LOOK_PX = 24;
    const LOS_STEP = 3;
    const ARRIVE_PX = 2;

    function hypot(dx, dy) {
        return Math.hypot(dx, dy);
    }

    /** Reuse blocked() results for one plan / steer (A* + LOS share many poses). */
    function memoBlocked(blocked) {
        if (typeof blocked !== "function") return blocked;
        const cache = new Map();
        return function (x, y) {
            const kx = Math.round(x * 4);
            const ky = Math.round(y * 4);
            const k = kx * 1000003 + ky;
            const hit = cache.get(k);
            if (hit !== undefined) return hit;
            const v = !!blocked(x, y);
            cache.set(k, v);
            return v;
        };
    }

    function cellKey(cx, cy) {
        return ((cx + 512) << 16) | ((cy + 512) & 65535);
    }

    /** Pull a far dest onto the maxRange circle so A* stays local. */
    function clipToRange(fromX, fromY, toX, toY, maxRange, cell) {
        const c = cell || TILE;
        const maxPx = Math.max(1, Number(maxRange) || 12) * c;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const dist = hypot(dx, dy);
        if (!(dist > maxPx)) return { x: toX, y: toY };
        const s = maxPx / dist;
        return { x: fromX + dx * s, y: fromY + dy * s };
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
        const fat = Math.max(0, Number(opts && opts.fatPx) || 0);
        const pdx = dist > 0 ? -dy / dist : 0;
        const pdy = dist > 0 ? dx / dist : 0;
        for (let i = 1; i <= steps; i++) {
            const f = ((maxDist * i) / steps) / dist;
            const x = x0 + dx * f;
            const y = y0 + dy * f;
            if (blocked(x, y)) return false;
            if (fat > 0) {
                if (blocked(x + pdx * fat, y + pdy * fat)) return false;
                if (blocked(x - pdx * fat, y - pdy * fat)) return false;
            }
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
            { stepPx: 3, maxDist: reach, fatPx: 3 }
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
            while (j > i && !losClear(ax, ay, pts[j].x, pts[j].y, blocked, { fatPx: 3 })) j--;
            out.push(pts[j]);
            ax = pts[j].x;
            ay = pts[j].y;
            i = j + 1;
        }
        return out;
    }

    /**
     * Standing samples in a cell. 0.25 hits a centered 5px trunk; 0 and ~0.38
     * still overlap that trunk but can stand in the open side of a full-tile
     * building (the default 0.25 pose sits on the east half and kisses a
     * vertical lean-to).
     */
    function cellStandCandidates(cx, cy, cell) {
        const c = cell || TILE;
        const y = cy * c + c;
        const xs = [0.25, 0.12, 0, 0.38, 0.62, 0.75];
        const out = [];
        for (let i = 0; i < xs.length; i++) {
            out.push({ x: cx * c + c * xs[i], y });
        }
        return out;
    }

    function cellStandOpen(cx, cy, cell, blocked) {
        const pts = cellStandCandidates(cx, cy, cell);
        if (typeof blocked !== "function") return pts[0];
        for (let i = 0; i < pts.length; i++) {
            if (!blocked(pts[i].x, pts[i].y)) return pts[i];
        }
        return null;
    }

    function clearance(x, y, blocked, r) {
        const reach = r || 6;
        const dirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        let n = 0;
        for (let i = 0; i < dirs.length; i++) {
            if (!blocked(x + dirs[i][0] * reach, y + dirs[i][1] * reach)) n++;
        }
        return n;
    }

    function openPoint(x, y, blocked, cell, side, maxR, from) {
        if (!blocked(x, y)) return { x, y };
        const step = Math.max(8, cell * 0.55);
        const bias = side >= 0 ? 0.2 : -0.2;
        const rings = Number.isFinite(maxR) ? Math.max(0, maxR) : 6;
        let best = null;
        let bestScore = -Infinity;
        for (let r = 1; r <= rings; r++) {
            for (let a = 0; a < 8; a++) {
                const ang = (a / 8) * Math.PI * 2 + bias;
                const px = x + Math.cos(ang) * step * r;
                const py = y + Math.sin(ang) * step * r;
                if (blocked(px, py)) continue;
                if (!from) return { x: px, y: py };
                const clear = clearance(px, py, blocked, 6);
                let score = clear * 16 - r * 3;
                if (clear >= 4) score += 40;
                score -= hypot(px - from.x, py - from.y) * 0.02;
                if (score > bestScore) {
                    bestScore = score;
                    best = { x: px, y: py };
                }
            }
        }
        return best || { x, y };
    }

    function bestStand(from, dest, blocked, opts) {
        const cell = (opts && opts.cellSize) || TILE;
        const maxR = Number.isFinite(opts && opts.openRadius) ? Math.max(0, opts.openRadius) : 4;
        const step = Math.max(6, cell * 0.45);
        const losOpts = { stepPx: 3, fatPx: 3 };
        const candidates = [];
        if (!blocked(dest.x, dest.y)) candidates.push({ x: dest.x, y: dest.y, r: 0 });
        for (let r = 1; r <= maxR; r++) {
            for (let a = 0; a < 8; a++) {
                const ang = (a / 8) * Math.PI * 2;
                const x = dest.x + Math.cos(ang) * step * r;
                const y = dest.y + Math.sin(ang) * step * r;
                if (blocked(x, y)) continue;
                candidates.push({ x, y, r });
            }
        }
        if (!candidates.length) {
            const fallback = openPoint(dest.x, dest.y, blocked, cell, 1, Math.max(4, maxR), from);
            return fallback || { x: dest.x, y: dest.y };
        }
        let best = candidates[0];
        let bestScore = -Infinity;
        const destLos = from && losClear(from.x, from.y, dest.x, dest.y, blocked, losOpts);
        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            const clear = clearance(c.x, c.y, blocked, 6);
            const los = from && losClear(from.x, from.y, c.x, c.y, blocked, losOpts);
            let score = clear * 18 - c.r * 5;
            if (clear >= 4) score += 30;
            if (los && clear >= 4) score += destLos ? 50 : 8;
            score -= hypot(c.x - dest.x, c.y - dest.y) * 0.25;
            if (from) score -= hypot(c.x - from.x, c.y - from.y) * 0.02;
            if (score > bestScore) {
                bestScore = score;
                best = c;
            }
        }
        return { x: best.x, y: best.y };
    }

    function planPath(from, to, blocked, opts) {
        blocked = memoBlocked(blocked);
        const cell = (opts && opts.cellSize) || TILE;
        const maxR = (opts && opts.maxRange) || 12;
        const stepCap = Math.min(1600, Math.max(280, maxR * maxR));
        const side = (opts && opts.side) || 1;
        const start = cellOf(from.x, from.y, cell);
        const goal = cellOf(to.x, to.y, cell);
        const sx = start.cx;
        const sy = start.cy;
        const gx = goal.cx;
        const gy = goal.cy;
        if (sx === gx && sy === gy) return [{ x: to.x, y: to.y }];
        const standMemo = new Map();
        const standAt = (cx, cy) => {
            const k = cellKey(cx, cy);
            if (standMemo.has(k)) return standMemo.get(k);
            const pos = cellStandOpen(cx, cy, cell, blocked);
            standMemo.set(k, pos);
            return pos;
        };
        const hOf = (cx, cy) => Math.max(Math.abs(gx - cx), Math.abs(gy - cy));
        const came = new Map();
        came.set(cellKey(sx, sy), null);
        const gScore = new Map();
        gScore.set(cellKey(sx, sy), 0);
        const open = [[sx, sy]];
        const inOpen = new Set([cellKey(sx, sy)]);
        let found = null;
        let best = [sx, sy];
        let bestH = hOf(sx, sy);
        const dirs = dirOrder(gx - sx, gy - sy, side);
        let steps = 0;
        while (open.length && steps < stepCap) {
            let bi = 0;
            let bf = Infinity;
            for (let i = 0; i < open.length; i++) {
                const c = open[i];
                const g = gScore.get(cellKey(c[0], c[1])) || 0;
                const f = g + hOf(c[0], c[1]);
                if (f < bf) {
                    bf = f;
                    bi = i;
                }
            }
            const cur = open[bi];
            open[bi] = open[open.length - 1];
            open.pop();
            const cx = cur[0];
            const cy = cur[1];
            inOpen.delete(cellKey(cx, cy));
            steps++;
            const h = hOf(cx, cy);
            if (h < bestH) {
                bestH = h;
                best = cur;
            }
            if (cx === gx && cy === gy) {
                found = cur;
                break;
            }
            const gCur = gScore.get(cellKey(cx, cy)) || 0;
            const fromStand = standAt(cx, cy) || (cx === sx && cy === sy ? from : null);
            for (let d = 0; d < dirs.length; d++) {
                const nx = cx + dirs[d][0];
                const ny = cy + dirs[d][1];
                if (Math.abs(nx - sx) > maxR || Math.abs(ny - sy) > maxR) continue;
                const k = cellKey(nx, ny);
                const goalCell = nx === gx && ny === gy;
                const nbStand = standAt(nx, ny);
                if (!nbStand && !goalCell) continue;
                const ddx = dirs[d][0];
                const ddy = dirs[d][1];
                if (ddx && ddy) {
                    if (!standAt(cx + ddx, cy) || !standAt(cx, cy + ddy)) continue;
                }
                if (fromStand && nbStand) {
                    const mx = (fromStand.x + nbStand.x) * 0.5;
                    const my = (fromStand.y + nbStand.y) * 0.5;
                    const dx = nbStand.x - fromStand.x;
                    const dy = nbStand.y - fromStand.y;
                    const dist = hypot(dx, dy) || 1;
                    const fat = 3;
                    const pdx = -dy / dist;
                    const pdy = dx / dist;
                    if (blocked(mx, my)
                        || blocked(mx + pdx * fat, my + pdy * fat)
                        || blocked(mx - pdx * fat, my - pdy * fat)) continue;
                }
                const ng = gCur + 1;
                if (gScore.has(k) && ng >= gScore.get(k)) continue;
                gScore.set(k, ng);
                came.set(k, cur);
                if (!inOpen.has(k)) {
                    inOpen.add(k);
                    open.push([nx, ny]);
                }
            }
        }
        const end = found || best;
        if (!end || (end[0] === sx && end[1] === sy)) return null;
        const cells = [];
        let cur = end;
        const seen = new Set();
        while (cur && !seen.has(cellKey(cur[0], cur[1]))) {
            seen.add(cellKey(cur[0], cur[1]));
            cells.push(cur);
            cur = came.get(cellKey(cur[0], cur[1]));
        }
        cells.reverse();
        const pts = [];
        for (let i = 1; i < cells.length; i++) {
            const stand = standAt(cells[i][0], cells[i][1]);
            if (!stand || blocked(stand.x, stand.y)) continue;
            pts.push(stand);
        }
        if (found && !blocked(to.x, to.y)) pts.push({ x: to.x, y: to.y });
        else if (found) {
            const open = openPoint(to.x, to.y, blocked, cell, side, 4, from);
            if (open && !blocked(open.x, open.y)) pts.push(open);
        }
        if (!pts.length) return null;
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
            const pos = cellStandOpen(c.cx + dirs[i][0], c.cy + dirs[i][1], cell, blocked);
            if (pos) return pos;
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
     *   openRadius?: number,
     *   allowReplan?: boolean
     * }} input
     */
    function steerToward(input) {
        const from = input.from;
        const blocked = memoBlocked(input.blocked);
        const cell = input.cellSize || TILE;
        const dt = Number(input.dt) > 0 ? input.dt : 16;
        let side = input.side < 0 ? -1 : 1;
        let path = input.path && input.path.length ? input.path.slice() : null;
        let pathGoal = input.pathGoal || null;
        let stuckMs = Number(input.stuckMs) || 0;
        const maxRange = input.maxRange || 12;
        const lookPx = input.lookPx || LOOK_PX;

        let dest = { x: input.to.x, y: input.to.y };
        const dist0 = hypot(dest.x - from.x, dest.y - from.y);
        if (!(dist0 > ARRIVE_PX)) {
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
        if (path && path.length && blocked(path[0].x, path[0].y)) path.shift();
        const wp0 = path && path.length ? path[0] : dest;
        const wpDist = hypot(wp0.x - from.x, wp0.y - from.y);
        const lastWp = Number(input.lastWpDist);
        if (Number.isFinite(lastWp) && wpDist < lastWp - 0.25) stuckMs = 0;
        else stuckMs += dt;
        const overlapping = !!input.overlapping;
        let nextBlocked = false;
        if (path && path.length) {
            const wx = path[0].x;
            const wy = path[0].y;
            const wd = hypot(wx - from.x, wy - from.y);
            nextBlocked = blocked(wx, wy)
                || !losClear(from.x, from.y, wx, wy, blocked, { maxDist: wd });
        }
        const stuck = stuckMs > STUCK_MS;
        // Keep a still-valid route even if the follow target drifted — replanning
        // every 48px of leader motion is what hitchs FPS while you walk.
        const committed = !!(
            path && path.length && !nextBlocked && !stuck
        );
        let replanned = false;
        if (!committed) {
            const rawDest = { x: dest.x, y: dest.y };
            let openR = input.openRadius != null ? input.openRadius : 4;
            const allowReplan = input.allowReplan !== false;
            // Overlap is a slide, not a reason to A* the camp (baskets while chopping).
            if (!allowReplan || overlapping) {
                if (pathGoal) dest = { x: pathGoal.x, y: pathGoal.y };
            } else {
            const destBlocked = blocked(rawDest.x, rawDest.y);
            const destTight = !destBlocked && clearance(rawDest.x, rawDest.y, blocked, 6) < 3;
            const wantExact = input.openRadius === 0;
            if (destBlocked || (destTight && !wantExact)) openR = Math.max(openR, 3);
            const standSlack = Math.max(cell * 3, (openR + 1) * cell);
            const stickyGoal = pathGoal
                && !stuck
                && hypot(pathGoal.x - rawDest.x, pathGoal.y - rawDest.y) <= standSlack
                && !blocked(pathGoal.x, pathGoal.y);
            if (stickyGoal) dest = { x: pathGoal.x, y: pathGoal.y };
            else if (destBlocked || (destTight && !wantExact)) {
                dest = bestStand(from, rawDest, blocked, { cellSize: cell, openRadius: openR });
            } else if (wantExact) {
                dest = rawDest;
            } else {
                dest = openPoint(rawDest.x, rawDest.y, blocked, cell, side, openR, from);
            }
            const dist = hypot(dest.x - from.x, dest.y - from.y);
            const losMax = Math.min(dist, cell * Math.max(maxRange, 8));
            const clearToDest = losClear(
                from.x, from.y, dest.x, dest.y, blocked,
                { stepPx: 8, maxDist: losMax, fatPx: 0 }
            );
            const ahead = blockedAhead(from, dest, blocked, lookPx);
            const goalDrift = !pathGoal
                || hypot(dest.x - pathGoal.x, dest.y - pathGoal.y) > GOAL_DRIFT_PX;
            const pathDone = !path || !path.length;
            if (clearToDest && !stuck && !ahead && (pathDone || goalDrift)) {
                path = null;
            } else {
                let planned = planPath(from, dest, blocked, { cellSize: cell, maxRange, side });
                if (stuck && (!planned || !planned.length)) {
                    const flipped = -side;
                    const other = planPath(from, dest, blocked, {
                        cellSize: cell, maxRange, side: flipped
                    });
                    if (other && other.length) {
                        side = flipped;
                        planned = other;
                    }
                }
                path = planned;
                pathGoal = dest;
                stuckMs = 0;
                replanned = true;
                if (!path || !path.length) {
                    const n = firstFreeNeighbor(from, blocked, cell, side);
                    if (n) path = [n];
                }
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
            arrived: false,
            replanned
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
        clipToRange,
        blockedAhead,
        planPath,
        steerToward,
        steerHeading,
        openPoint,
        bestStand,
        clearance,
        stringPull,
        cellStand,
        cellStandOpen,
        cellOf
    };
});
