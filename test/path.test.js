const { test } = require("node:test");
const assert = require("node:assert/strict");
const Path = require("../shared/path");

test("clipToRange pulls a far dest onto the maxRange circle", () => {
    const from = { x: 0, y: 0 };
    const far = Path.clipToRange(from.x, from.y, 160, 0, 10, 16);
    assert.equal(far.x, 160);
    assert.equal(far.y, 0);
    const farther = Path.clipToRange(from.x, from.y, 320, 0, 10, 16);
    assert.equal(farther.x, 160);
    assert.equal(farther.y, 0);
});

test("planPath goes around a tree that blocks standing feet, not cell center", () => {
    const TS = 16;
    const tx = 5;
    const ty = 10;
    const tree = {
        left: tx * TS + TS / 2 - 2.5,
        right: tx * TS + TS / 2 + 2.5,
        top: ty * TS + TS - 5,
        bottom: ty * TS + TS
    };

    function bodyAt(x, y) {
        return { left: x + 4, right: x + 12, top: y - 8, bottom: y };
    }
    function overlaps(a, b) {
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }
    function blocked(x, y) {
        return overlaps(bodyAt(x, y), tree);
    }

    const center = { x: tx * TS + TS / 2, y: ty * TS + TS / 2 };
    const stand = Path.cellStand(tx, ty, TS);
    assert.equal(blocked(center.x, center.y), false, "cell center misses the tree");
    assert.equal(blocked(stand.x, stand.y), true, "standing pose in the tree tile is blocked");

    const from = { x: 3 * TS + 4, y: ty * TS + TS };
    const to = { x: 8 * TS + 4, y: ty * TS + TS };
    assert.equal(blocked(from.x, from.y), false);
    assert.equal(blocked(to.x, to.y), false);

    const path = Path.planPath(from, to, blocked, { cellSize: TS, maxRange: 12, side: 1 });
    assert.ok(path && path.length, "planPath returned a route");
    for (const p of path) {
        assert.equal(blocked(p.x, p.y), false, `waypoint hits tree ${JSON.stringify(p)}`);
    }

    const steered = Path.steerToward({
        from, to, blocked, cellSize: TS, side: 1, dt: 16
    });
    assert.ok(steered.path && steered.path.length, "steerToward did not bee-line");
    assert.ok(!(Math.abs(steered.ny) < 0.15 && steered.nx > 0.9), "did not walk east into the tree");

    const combat = Path.steerToward({
        from, to, blocked, cellSize: TS, side: 1, dt: 16, openRadius: 2, maxRange: 16
    });
    assert.ok(combat.path && combat.path.length);
    assert.ok(!(Math.abs(combat.ny) < 0.15 && combat.nx > 0.9));
});

test("planPath goes around a long wall beyond the old 12-tile / 280-step cap", () => {
    const TS = 16;
    const wallY = 10;
    function blocked(x, y) {
        const c = Path.cellOf(x, y, TS);
        return c.cy === wallY && c.cx >= 5 && c.cx <= 20;
    }
    const from = Path.cellStand(3, wallY, TS);
    const to = Path.cellStand(22, wallY, TS);
    assert.equal(blocked(from.x, from.y), false);
    assert.equal(blocked(to.x, to.y), false);

    const path = Path.planPath(from, to, blocked, { cellSize: TS, maxRange: 20, side: 1 });
    assert.ok(path && path.length, "long-range planPath returned a route");
    for (const p of path) {
        assert.equal(blocked(p.x, p.y), false, `waypoint hits wall ${JSON.stringify(p)}`);
    }
    const last = path[path.length - 1];
    assert.ok(
        Math.hypot(last.x - to.x, last.y - to.y) < TS,
        "path reaches the far side of the wall"
    );

    const steered = Path.steerToward({
        from, to, blocked, cellSize: TS, side: 1, dt: 16, maxRange: 20
    });
    assert.ok(steered.path && steered.path.length, "steerToward did not bee-line through the wall");
    assert.equal(blocked(from.x + steered.nx * 8, from.y + steered.ny * 8), false);
});

test("steerToward does not replan when a follow target drifts", () => {
    const TS = 16;
    function blocked(x, y) {
        const c = Path.cellOf(x, y, TS);
        return c.cy === 10 && c.cx >= 4 && c.cx <= 8;
    }
    const from = Path.cellStand(2, 10, TS);
    const to = Path.cellStand(12, 10, TS);
    const first = Path.steerToward({
        from, to, blocked, cellSize: TS, side: 1, dt: 16, maxRange: 16
    });
    assert.equal(first.replanned, true);
    assert.ok(first.path && first.path.length);

    const drifted = { x: to.x + 64, y: to.y };
    let probes = 0;
    function counted(x, y) {
        probes++;
        return blocked(x, y);
    }
    const second = Path.steerToward({
        from,
        to: drifted,
        blocked: counted,
        cellSize: TS,
        side: first.side,
        dt: 16,
        maxRange: 16,
        path: first.path,
        pathGoal: first.pathGoal
    });
    assert.equal(second.replanned, false);
    assert.ok(second.path && second.path.length);
    assert.ok(probes < 80, `follow drift should not A* (${probes} blocked probes)`);
});

test("steerToward on a committed path does not probe a far dest", () => {
    const TS = 16;
    function blocked(x, y) {
        const c = Path.cellOf(x, y, TS);
        return c.cy === 10 && c.cx >= 4 && c.cx <= 8;
    }
    const from = Path.cellStand(2, 10, TS);
    const to = Path.cellStand(12, 10, TS);
    const first = Path.steerToward({
        from, to, blocked, cellSize: TS, side: 1, dt: 16, maxRange: 16
    });
    assert.ok(first.path && first.path.length);

    const far = { x: to.x + 48 * TS, y: to.y };
    let destProbes = 0;
    function counted(x, y) {
        if (Math.abs(x - far.x) < 64 && Math.abs(y - far.y) < 64) destProbes++;
        return blocked(x, y);
    }
    Path.steerToward({
        from,
        to: far,
        blocked: counted,
        cellSize: TS,
        side: first.side,
        dt: 16,
        maxRange: 16,
        path: first.path,
        pathGoal: first.pathGoal
    });
    assert.equal(destProbes, 0, "committed follow must not dest-LOS 48 tiles out");
});

test("steerToward overlapping waits for allowReplan instead of probing dest", () => {
    const TS = 16;
    function blocked(x, y) {
        const c = Path.cellOf(x, y, TS);
        return c.cy === 10 && c.cx >= 4 && c.cx <= 8;
    }
    const from = Path.cellStand(2, 10, TS);
    const to = Path.cellStand(12, 10, TS);
    const first = Path.steerToward({
        from, to, blocked, cellSize: TS, side: 1, dt: 16, maxRange: 16, overlapping: true
    });
    let probes = 0;
    function counted(x, y) {
        probes++;
        return blocked(x, y);
    }
    const second = Path.steerToward({
        from,
        to,
        blocked: counted,
        cellSize: TS,
        side: first.side,
        dt: 16,
        maxRange: 16,
        path: first.path,
        pathGoal: first.pathGoal,
        overlapping: true,
        allowReplan: false
    });
    assert.equal(second.replanned, false);
    assert.ok(probes < 40, `replan window should skip dest probes (${probes})`);
});

test("steerToward does not dest-LOS a far blocked target", () => {
    const TS = 16;
    const from = { x: 32, y: 32 };
    const to = { x: 32 + 80 * TS, y: 32 };
    let farProbes = 0;
    let totalProbes = 0;
    function blocked(x, y) {
        totalProbes++;
        if (Math.abs(x - to.x) < TS && Math.abs(y - to.y) < TS) {
            farProbes++;
            return true;
        }
        return false;
    }
    for (let i = 0; i < 8; i++) {
        const steered = Path.steerToward({
            from, to, blocked, cellSize: TS, dt: 16, maxRange: 12
        });
        assert.equal(steered.arrived, false);
        assert.ok(steered.nx > 0.9, "should still walk toward the far target");
    }
    assert.equal(farProbes, 0, `far blocked dest must not be probed (${farProbes})`);
    assert.ok(totalProbes < 4000, `local window only (${totalProbes} blocked probes)`);
});

test("planPath skirts a vertical lean-to toward a dest on the closed-in side", () => {
    const TS = 16;
    const Place = require("../shared/place");
    const def = { hitboxSize: 5, sleep: { slots: 2 }, footprint: [2, 1] };
    const tx = 8;
    const ty = 8;
    const rot = 90;
    const pos = Place.footprintWorldPos(tx, ty, rot, def.footprint, TS);
    const entry = { id: "lean_to", tx, ty, rot, x: pos.x, y: pos.y };
    const wall = Place.collisionWorldRect(entry, def, TS);
    const pad = 1;
    const box = {
        left: wall.left - pad,
        right: wall.right + pad,
        top: wall.top - pad,
        bottom: wall.bottom + pad
    };

    function bodyAt(x, y) {
        const left = x + 4;
        const top = y - 8;
        return { left, right: left + 8, top, bottom: top + 8 };
    }
    function overlaps(a, b, grow) {
        const g = grow || 0;
        return a.left - g < b.right && a.right + g > b.left
            && a.top - g < b.bottom && a.bottom + g > b.top;
    }
    function blocked(x, y) {
        return overlaps(bodyAt(x, y), box, 2);
    }

    const from = { x: pos.x, y: box.bottom + 20 };
    const to = { x: box.left - 24, y: (box.top + box.bottom) / 2 };
    assert.equal(blocked(from.x, from.y), false, "start south of lean-to");
    assert.equal(blocked(to.x, to.y), false, "dest west of lean-to");

    const westStand = Path.cellStand(tx - 1, ty, TS);
    assert.equal(
        blocked(westStand.x, westStand.y),
        false,
        "open west laying spot must not block the west tile"
    );

    const path = Path.planPath(from, to, blocked, { cellSize: TS, maxRange: 16, side: 1 });
    assert.ok(path && path.length, "planPath returned a route around the lean-to");
    for (const p of path) {
        assert.equal(blocked(p.x, p.y), false, `waypoint hits lean-to ${JSON.stringify(p)}`);
    }

    let x = from.x;
    let y = from.y;
    let st = Path.steerToward({
        from: { x, y }, to, blocked, cellSize: TS, side: 1, dt: 16, maxRange: 16
    });
    let flips = 0;
    let side = st.side;
    for (let i = 0; i < 220; i++) {
        st = Path.steerToward({
            from: { x, y },
            to,
            blocked,
            cellSize: TS,
            side: st.side,
            path: st.path,
            pathGoal: st.pathGoal,
            stuckMs: st.stuckMs,
            lastWpDist: st.lastWpDist,
            dt: 16,
            maxRange: 16
        });
        if (st.side !== side) {
            flips++;
            side = st.side;
        }
        const step = 1.6;
        const nx = x + st.nx * step;
        const ny = y + st.ny * step;
        if (!blocked(nx, y)) x = nx;
        if (!blocked(x, ny)) y = ny;
        if (Math.hypot(to.x - x, to.y - y) < 12) break;
    }
    assert.ok(
        Math.hypot(to.x - x, to.y - y) < 20,
        `should reach the west dest, ended at ${x.toFixed(1)},${y.toFixed(1)} dest ${to.x.toFixed(1)},${to.y.toFixed(1)}`
    );
    assert.ok(flips < 6, `avoid-side flipped ${flips} times (jiggle)`);
    assert.ok(x < box.left - 4, `should finish west of the lean-to, x=${x.toFixed(1)}`);
});

test("steerToward goes around a campfire+lean-to pinch instead of jiggling", () => {
    const TS = 16;
    const Place = require("../shared/place");
    const def = { hitboxSize: 5, sleep: { slots: 2 }, footprint: [2, 1] };
    const tx = 8;
    const ty = 8;
    const rot = 90;
    const pos = Place.footprintWorldPos(tx, ty, rot, def.footprint, TS);
    const entry = { id: "lean_to", tx, ty, rot, x: pos.x, y: pos.y };
    const wall = Place.collisionWorldRect(entry, def, TS);
    const lean = {
        left: wall.left - 1,
        right: wall.right + 1,
        top: wall.top - 1,
        bottom: wall.bottom + 1
    };
    const fire = {
        x: lean.left - 10,
        y: (lean.top + lean.bottom) * 0.5
    };
    const fireBox = {
        left: fire.x - 3.5,
        right: fire.x + 3.5,
        top: fire.y - 6,
        bottom: fire.y + 1
    };

    function bodyAt(x, y) {
        const left = x + 4;
        const top = y - 8;
        return { left, right: left + 8, top, bottom: top + 8 };
    }
    function overlaps(a, b, grow) {
        const g = grow || 0;
        return a.left - g < b.right && a.right + g > b.left
            && a.top - g < b.bottom && a.bottom + g > b.top;
    }
    function blocked(x, y) {
        const body = bodyAt(x, y);
        return overlaps(body, lean, 2) || overlaps(body, fireBox, 2);
    }

    const from = { x: pos.x, y: lean.bottom + 18 };
    const to = { x: fire.x, y: fire.y };
    assert.equal(blocked(from.x, from.y), false);

    let x = from.x;
    let y = from.y;
    let st = Path.steerToward({
        from: { x, y },
        to,
        blocked,
        cellSize: TS,
        side: 1,
        dt: 16,
        maxRange: 16,
        openRadius: 2
    });
    let flips = 0;
    let side = st.side;
    for (let i = 0; i < 280; i++) {
        st = Path.steerToward({
            from: { x, y },
            to,
            blocked,
            cellSize: TS,
            side: st.side,
            path: st.path,
            pathGoal: st.pathGoal,
            stuckMs: st.stuckMs,
            lastWpDist: st.lastWpDist,
            dt: 16,
            maxRange: 16,
            openRadius: 2
        });
        if (st.side !== side) {
            flips++;
            side = st.side;
        }
        const step = 1.6;
        const nx = x + st.nx * step;
        const ny = y + st.ny * step;
        if (!blocked(nx, y)) x = nx;
        if (!blocked(x, ny)) y = ny;
        if (Math.hypot(fire.x - x, fire.y - y) < 18) break;
    }
    assert.ok(
        Math.hypot(fire.x - x, fire.y - y) < 28,
        `should reach the fire, ended ${x.toFixed(1)},${y.toFixed(1)} fire ${fire.x.toFixed(1)},${fire.y.toFixed(1)}`
    );
    assert.ok(
        Math.abs(y - fire.y) < 20,
        `should not stay south of the fire, y=${y.toFixed(1)} fireY=${fire.y.toFixed(1)}`
    );
    assert.ok(flips < 8, `avoid-side flipped ${flips} times (jiggle)`);
});

test("steerToward goes around a 1×1 basket instead of running into it", () => {
    const TS = 16;
    const x = 8 * TS + 8;
    const y = 8 * TS + TS;
    const basket = {
        left: x - 6,
        right: x + 6,
        top: y - 9,
        bottom: y + 1
    };
    function bodyAt(px, py) {
        return { left: px + 4, right: px + 12, top: py - 8, bottom: py };
    }
    function blocked(px, py) {
        const b = bodyAt(px, py);
        return b.right > basket.left && b.left < basket.right
            && b.bottom > basket.top && b.top < basket.bottom;
    }
    const from = { x, y: y + 20 };
    const to = { x, y: y - 48 };
    assert.equal(blocked(from.x, from.y), false);
    let xPos = from.x;
    let yPos = from.y;
    let path = null;
    let pathGoal = null;
    let side = 1;
    let stuckMs = 0;
    let lastFrom = null;
    let lastWpDist = 0;
    let overlapped = 0;
    const speed = 3.5 * TS * (16 / 1000);
    for (let i = 0; i < 240; i++) {
        const overlapping = blocked(xPos, yPos);
        const st = Path.steerToward({
            from: { x: xPos, y: yPos },
            to,
            blocked,
            cellSize: TS,
            side,
            path,
            pathGoal,
            stuckMs,
            lastFrom,
            lastWpDist,
            maxRange: 12,
            dt: 16,
            overlapping,
            openRadius: 2
        });
        path = st.path;
        pathGoal = st.pathGoal;
        side = st.side;
        stuckMs = st.stuckMs;
        lastFrom = st.lastFrom;
        lastWpDist = st.lastWpDist;
        if (st.arrived) break;
        const nx = xPos + st.nx * speed;
        const ny = yPos + st.ny * speed;
        if (!blocked(nx, yPos)) xPos = nx;
        if (!blocked(xPos, ny)) yPos = ny;
        if (blocked(xPos, yPos)) overlapped++;
    }
    assert.ok(yPos < y - 16, `should finish north of the basket, y=${yPos.toFixed(1)}`);
    assert.ok(overlapped < 24, `stuck overlapping the basket for ${overlapped} steps`);
});

test("steerToward goes around two baskets instead of walking into the gap", () => {
    const TS = 16;
    const Place = require("../shared/place");
    const def = { hitboxSize: 5, hitbox: [[10, 11], [6, 11]] };
    const y = 8 * TS + TS;
    const left = Place.collisionWorldRect({ id: "wicker_basket", x: 72, y, rot: 0 }, def, TS);
    const right = Place.collisionWorldRect({ id: "wicker_basket", x: 88, y, rot: 0 }, def, TS);
    function bodyAt(px, py) {
        return { left: px + 2, right: px + 14, top: py - 10, bottom: py + 2 };
    }
    function overlaps(a, b) {
        return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
    }
    function blocked(px, py) {
        const b = bodyAt(px, py);
        return overlaps(b, left) || overlaps(b, right);
    }
    const from = { x: 80, y: y + 24 };
    const to = { x: 80, y: y - 24 };
    assert.equal(blocked(from.x, from.y), false);
    let xPos = from.x;
    let yPos = from.y;
    let path = null;
    let pathGoal = null;
    let side = 1;
    let stuckMs = 0;
    let lastWpDist = 0;
    let overlapped = 0;
    const speed = 3.5 * TS * (16 / 1000);
    for (let i = 0; i < 280; i++) {
        const st = Path.steerToward({
            from: { x: xPos, y: yPos },
            to,
            blocked,
            cellSize: TS,
            side,
            path,
            pathGoal,
            stuckMs,
            lastWpDist,
            maxRange: 12,
            dt: 16,
            openRadius: 0
        });
        path = st.path;
        pathGoal = st.pathGoal;
        side = st.side;
        stuckMs = st.stuckMs;
        lastWpDist = st.lastWpDist;
        if (st.arrived) break;
        const nx = xPos + st.nx * speed;
        const ny = yPos + st.ny * speed;
        if (!blocked(nx, yPos)) xPos = nx;
        if (!blocked(xPos, ny)) yPos = ny;
        if (blocked(xPos, yPos)) overlapped++;
        if (yPos < y - 16) break;
    }
    assert.ok(yPos < y - 12, `should finish north of the baskets, y=${yPos.toFixed(1)}`);
    assert.ok(overlapped < 20, `stuck overlapping a basket for ${overlapped} steps`);
});

test("steerToward stops on the stand beside a blocked goal instead of pacing", () => {
    const TS = 16;
    const rack = { x: 136, y: 144 };
    // Drying-rack feet: a short solid, plus the 1px thing pad pathing uses.
    const solid = {
        left: rack.x - 3.5,
        right: rack.x + 3.5,
        top: rack.y - 6,
        bottom: rack.y + 1
    };
    function bodyAt(px, py) {
        return { left: px + 2, right: px + 14, top: py - 10, bottom: py + 2 };
    }
    function blocked(px, py) {
        const b = bodyAt(px, py);
        return b.right > solid.left && b.left < solid.right
            && b.bottom > solid.top && b.top < solid.bottom;
    }
    const to = { x: rack.x, y: rack.y + 6 };
    assert.equal(blocked(to.x, to.y), true, "haul spot against the rack is blocked");
    let x = rack.x;
    let y = rack.y + 48;
    let path = null;
    let pathGoal = null;
    let side = 1;
    let stuckMs = 0;
    let lastWpDist = 0;
    let arrived = false;
    let flips = 0;
    let prevNy = 0;
    const speed = 3.5 * TS * (16 / 1000);
    for (let i = 0; i < 180; i++) {
        const st = Path.steerToward({
            from: { x, y },
            to,
            blocked,
            cellSize: TS,
            side,
            path,
            pathGoal,
            stuckMs,
            lastWpDist,
            maxRange: 12,
            dt: 16,
            openRadius: 2
        });
        path = st.path;
        pathGoal = st.pathGoal;
        side = st.side;
        stuckMs = st.stuckMs;
        lastWpDist = st.lastWpDist;
        if (prevNy && Math.sign(st.ny) !== Math.sign(prevNy) && Math.abs(st.ny) > 0.5) flips++;
        prevNy = st.ny;
        if (st.arrived) {
            arrived = true;
            break;
        }
        const nx = x + st.nx * speed;
        const ny = y + st.ny * speed;
        if (!blocked(nx, y)) x = nx;
        if (!blocked(x, ny)) y = ny;
    }
    assert.equal(arrived, true, `paced at ${x.toFixed(1)},${y.toFixed(1)} goal ${to.x},${to.y}`);
    assert.ok(flips < 3, `heading flipped ${flips} times across the stand`);
    assert.equal(blocked(x, y), false, "settled inside the rack");
    assert.ok(Math.hypot(to.x - x, to.y - y) < 24, `stand is ${Math.hypot(to.x - x, to.y - y).toFixed(1)}px from the pile`);
});

test("steerToward keeps one stand when dest is tight instead of circling it", () => {
    const TS = 16;
    const fire = { x: 80, y: 80 };
    const fireBox = {
        left: fire.x - 4,
        right: fire.x + 4,
        top: fire.y - 7,
        bottom: fire.y + 2
    };
    const lean = {
        left: fire.x + 8,
        right: fire.x + 22,
        top: fire.y - 24,
        bottom: fire.y + 24
    };
    function bodyAt(x, y) {
        return { left: x + 4, right: x + 12, top: y - 8, bottom: y };
    }
    function overlaps(a, b, g) {
        const p = g || 0;
        return a.left - p < b.right && a.right + p > b.left
            && a.top - p < b.bottom && a.bottom + p > b.top;
    }
    function blocked(x, y) {
        const body = bodyAt(x, y);
        return overlaps(body, lean, 2) || overlaps(body, fireBox, 2);
    }
    const from = { x: fire.x - 10, y: fire.y + 36 };
    const to = { x: fire.x, y: fire.y };
    assert.equal(blocked(from.x, from.y), false);

    const first = Path.steerToward({
        from, to, blocked, cellSize: TS, side: 1, dt: 16, maxRange: 16, openRadius: 2
    });
    assert.ok(first.pathGoal, "expected a stand");
    const gx = first.pathGoal.x;
    const gy = first.pathGoal.y;
    let flips = 0;
    let st = first;
    for (let i = 0; i < 40; i++) {
        const x = from.x + (i % 3) - 1;
        const y = from.y + ((i * 2) % 5) - 2;
        st = Path.steerToward({
            from: { x, y },
            to,
            blocked,
            cellSize: TS,
            side: st.side,
            path: st.path,
            pathGoal: st.pathGoal,
            stuckMs: 0,
            lastWpDist: st.lastWpDist,
            dt: 16,
            maxRange: 16,
            openRadius: 2
        });
        if (Math.hypot((st.pathGoal?.x || 0) - gx, (st.pathGoal?.y || 0) - gy) > 6) flips++;
    }
    assert.ok(flips < 3, `stand jumped ${flips} times (would spin around the fire)`);
});

test("steerToward with openRadius 0 keeps the exact dest instead of parking nearby", () => {
    const TS = 16;
    const wall = { left: 70, right: 90, top: 40, bottom: 90 };
    function blocked(x, y) {
        const left = x + 4;
        const top = y - 8;
        return left < wall.right && left + 8 > wall.left
            && top < wall.bottom && top + 8 > wall.top;
    }
    const from = { x: 80, y: 120 };
    const to = { x: 48, y: 64 };
    assert.equal(blocked(from.x, from.y), false);
    assert.equal(blocked(to.x, to.y), false);
    let st = Path.steerToward({
        from, to, blocked, cellSize: TS, side: 1, dt: 16, maxRange: 16, openRadius: 0
    });
    const gx = st.pathGoal?.x;
    const gy = st.pathGoal?.y;
    assert.ok(Math.hypot(gx - to.x, gy - to.y) < 8, "exact dest was relocated");
    for (let i = 0; i < 20; i++) {
        st = Path.steerToward({
            from: { x: from.x + (i % 3), y: from.y },
            to,
            blocked,
            cellSize: TS,
            side: st.side,
            path: st.path,
            pathGoal: st.pathGoal,
            stuckMs: 0,
            lastWpDist: st.lastWpDist,
            dt: 16,
            maxRange: 16,
            openRadius: 0
        });
        assert.ok(
            Math.hypot((st.pathGoal?.x || 0) - to.x, (st.pathGoal?.y || 0) - to.y) < 10,
            `dest hopped to ${st.pathGoal?.x},${st.pathGoal?.y}`
        );
    }
});

test("steerToward does not A* every frame when allowReplan is false", () => {
    const TS = 16;
    const wall = { left: 64, right: 96, top: 16, bottom: 80 };
    let calls = 0;
    function blocked(x, y) {
        calls++;
        const left = x + 4;
        const top = y - 8;
        return left < wall.right && left + 8 > wall.left
            && top < wall.bottom && top + 8 > wall.top;
    }
    const from = { x: 80, y: 100 };
    const to = { x: 80, y: 8 };
    const first = Path.steerToward({
        from, to, blocked, cellSize: TS, side: 1, dt: 16, maxRange: 16, allowReplan: true
    });
    calls = 0;
    let st = first;
    for (let i = 0; i < 40; i++) {
        st = Path.steerToward({
            from,
            to,
            blocked,
            cellSize: TS,
            side: st.side,
            path: st.path,
            pathGoal: st.pathGoal,
            stuckMs: 2000,
            lastWpDist: st.lastWpDist,
            dt: 16,
            maxRange: 16,
            allowReplan: false
        });
    }
    assert.ok(calls < 800, `blocked() ran ${calls} times without a replan window`);
});

test("planPath blocked() stays cheap across a 16-tile open field", () => {
    let calls = 0;
    function blocked() {
        calls++;
        return false;
    }
    const from = { x: 8, y: 16 };
    const to = { x: 8 + 16 * 12, y: 16 };
    const path = Path.planPath(from, to, blocked, { cellSize: 16, maxRange: 16, side: 1 });
    assert.ok(path && path.length, "open-field planPath returned a route");
    assert.ok(calls < 4000, `blocked() ran ${calls} times`);
});

test("wall slide drops a bank that walks away once the step ahead is clear", () => {
    function blocked(x) {
        return x > 30;
    }
    const from = { x: 20, y: 88 };
    const len = Math.hypot(20, -28);
    const slid = Path.commitWallSlide(
        from, 20 / len, -28 / len, blocked,
        { bank: { axis: "y", dir: 1 } },
        { look: 4, goal: { x: 40, y: 60 }, cell: 16 }
    );
    assert.ok(slid, "the step toward the goal is open");
    assert.ok(slid.ny < 0, `kept walking away, ny=${slid && slid.ny}`);
});

test("wall slide follows the path around a lean-to instead of the goal axis", () => {
    function blocked(x, y) {
        return y < 150;
    }
    const from = { x: 22, y: 157 };
    const dx = 4 - from.x;
    const dy = 144 - from.y;
    const len = Math.hypot(dx, dy);
    const slid = Path.commitWallSlide(
        from, dx / len, dy / len, blocked,
        { bank: null },
        { look: 4, goal: { x: 96, y: 96 }, cell: 16, prefer: { x: -1, y: -1 } }
    );
    assert.ok(slid, "the way along the shelter is open");
    assert.ok(slid.nx < 0, `slid toward the goal instead of the path, nx=${slid && slid.nx}`);
});

test("wall slide holds one direction when the goal is straight across a river", () => {
    const wallX = 96;
    const blocked = (x) => x >= wallX;
    let x = 92;
    let y = 70;
    let bank = null;
    let prev = 0;
    let flips = 0;
    for (let i = 0; i < 40; i++) {
        const dx = 160 - x;
        const dy = 80 - y;
        const len = Math.hypot(dx, dy) || 1;
        const slid = Path.commitWallSlide(
            { x, y }, dx / len, dy / len, blocked, { bank },
            { look: 4, goal: { x: 160, y: 80 }, cell: 16, prefer: { x: 1, y: 1 } }
        );
        assert.ok(slid, "one axis stays open");
        bank = slid.bank;
        assert.ok(x + slid.nx * 4 < wallX, "slide does not step into the river");
        if (slid.bank && prev && slid.bank.dir !== prev) flips++;
        if (slid.bank) prev = slid.bank.dir;
        x += slid.nx * 3;
        y += slid.ny * 3;
    }
    assert.equal(flips, 0);
    assert.ok(Math.abs(y - 78) > 20, `walked along the bank, y=${y}`);
});

test("steerToward does not A* just because the pawn overlaps a thing", () => {
    const TS = 16;
    function blocked(x, y) {
        const c = Path.cellOf(x, y, TS);
        return c.cy === 10 && c.cx >= 4 && c.cx <= 8;
    }
    const from = Path.cellStand(2, 10, TS);
    const to = Path.cellStand(12, 10, TS);
    const first = Path.steerToward({
        from, to, blocked, cellSize: TS, side: 1, dt: 16, maxRange: 16
    });
    let probes = 0;
    function counted(x, y) {
        probes++;
        return blocked(x, y);
    }
    const second = Path.steerToward({
        from,
        to,
        blocked: counted,
        cellSize: TS,
        side: first.side,
        dt: 16,
        maxRange: 16,
        path: first.path,
        pathGoal: first.pathGoal,
        overlapping: true
    });
    assert.equal(second.replanned, false);
    assert.ok(second.path && second.path.length);
    assert.ok(probes < 80, `overlap should not A* (${probes} blocked probes)`);
});

test("gap lanes sit between neighboring drying racks", () => {
    const Place = require("../shared/place");
    const TS = 16;
    const def = { id: "drying_rack", hitboxSize: 5, dryingRack: true };
    const y = 9 * TS;
    const racks = [4, 5, 6].map((tx) => {
        const x = tx * TS + TS / 2;
        return Place.collisionWorldRect({ id: "drying_rack", x, y, rot: 0 }, def, TS);
    });
    const lanes = Path.gapLanes(racks);
    assert.equal(lanes.length, 2);
    const x0 = 4 * TS + TS / 2;
    assert.equal(Path.inGapLane(lanes, x0, y, 20), true, "feet at the left rack sit in the gap");
    assert.equal(Path.inGapLane(lanes, x0 + 8, y, 20), false, "the solid between gaps is not a lane");
    const far = Place.collisionWorldRect(
        { id: "drying_rack", x: 12 * TS + TS / 2, y, rot: 0 }, def, TS
    );
    assert.equal(Path.gapLanes([racks[0], far]).length, 0, "a meadow is not a lane");
});

test("a companion walks between a row of drying racks", () => {
    const Place = require("../shared/place");
    const { createTestWorld, originChunk } = require("./helpers/simWorld");
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const ty = 8;
    for (let tx = 3; tx <= 12; tx++) {
        const pos = Place.footprintWorldPos(tx, ty, 0, [1, 1], 16);
        chunk.things.push({
            uid: `rack-${tx}`,
            id: "drying_rack",
            x: pos.x,
            y: pos.y,
            rot: 0,
            tx,
            ty
        });
    }
    world._chunkRectCache = null;
    world._solidRects = null;
    const rackY = (ty + 1) * 16;
    const rec = world._companionFromSnap(pawn, {
        id: "buddy",
        name: "Buddy",
        x: 112,
        y: rackY + 48,
        inventory: [null, null, null, null, null]
    });
    pawn.party = [rec];
    const cc = world._ensureCompanionCreature(pawn, rec);
    const poseOpts = { load: false, sleepFootprint: false };
    assert.equal(
        world._partyPoseBlocked(cc, 104, rackY, 2, poseOpts),
        false,
        "path padding must leave the gap between racks open"
    );
    assert.equal(
        world._partyPoseBlocked(cc, 112, rackY, 0, poseOpts),
        true,
        "the rack itself stays solid"
    );
    // Start in front of the row, off the lane, where the old route dropped
    // the gap waypoint early and paced left-right along the racks.
    rec.x = 108;
    rec.y = rackY + 16;
    cc.x = rec.x;
    cc.y = rec.y;
    const dest = { x: 108, y: rackY - 48 };
    const x0 = rec.x;
    let minY = rec.y;
    let maxDx = 0;
    let flips = 0;
    let prevSign = 0;
    function step() {
        cc.x = rec.x;
        cc.y = rec.y;
        cc.role = "companion";
        cc.homeSettlementId = null;
        cc._resting = false;
        cc.ai._walkToward(dest.x, dest.y, false, world._aiWorld(), 16);
        const vx = cc.vx || 0;
        const sign = Math.abs(vx) > 8 ? Math.sign(vx) : 0;
        if (sign && prevSign && sign !== prevSign && rec.y > rackY - 2) flips++;
        if (sign) prevSign = sign;
        cc.applyDesiredVel(16);
        const nx = cc.x + (cc.vx || 0) * 0.016;
        const ny = cc.y + (cc.vy || 0) * 0.016;
        if (!world._partyPoseBlocked(cc, nx, cc.y, 0, poseOpts)) cc.x = nx;
        if (!world._partyPoseBlocked(cc, cc.x, ny, 0, poseOpts)) cc.y = ny;
        rec.x = cc.x;
        rec.y = cc.y;
    }
    for (let i = 0; i < 320; i++) {
        step();
        if (rec.y < minY) minY = rec.y;
        maxDx = Math.max(maxDx, Math.abs(rec.x - x0));
        if (rec.y < rackY - 12) break;
    }
    assert.ok(
        minY < rackY - 12,
        `should cross the row, ended ${rec.x.toFixed(1)},${rec.y.toFixed(1)}`
    );
    assert.ok(
        maxDx < 20,
        `should use a gap, not walk around the row (drifted ${maxDx.toFixed(1)}px)`
    );
    assert.ok(flips < 2, `paced in front of the gap (${flips} reversals)`);
});

test("a companion walks between a row of wicker baskets", () => {
    const Place = require("../shared/place");
    const { createTestWorld, originChunk } = require("./helpers/simWorld");
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const def = world._thingDef("wicker_basket");
    assert.equal(Place.isGapFurniture(def), true);
    const ty = 8;
    for (let tx = 3; tx <= 12; tx++) {
        const pos = Place.footprintWorldPos(tx, ty, 0, [1, 1], 16);
        chunk.things.push({
            uid: `basket-${tx}`,
            id: "wicker_basket",
            x: pos.x,
            y: pos.y,
            rot: 0,
            tx,
            ty
        });
    }
    world._chunkRectCache = null;
    world._solidRects = null;
    const rowY = (ty + 1) * 16;
    const rec = world._companionFromSnap(pawn, {
        id: "buddy",
        name: "Buddy",
        x: 104,
        y: rowY + 48,
        inventory: [null, null, null, null, null]
    });
    pawn.party = [rec];
    const cc = world._ensureCompanionCreature(pawn, rec);
    const poseOpts = { load: false, sleepFootprint: false };
    assert.equal(
        world._partyPoseBlocked(cc, 104, rowY, 2, poseOpts),
        false,
        "path padding must leave the gap between baskets open"
    );
    assert.equal(
        world._partyPoseBlocked(cc, 96, rowY, 0, poseOpts),
        true,
        "the basket itself stays solid"
    );
    assert.equal(
        world._partyPoseBlocked(cc, 96, rowY + 5, 0, poseOpts),
        true,
        "a shallow hit on the basket face stays solid"
    );
    rec.x = 104;
    rec.y = rowY + 20;
    cc.x = rec.x;
    cc.y = rec.y;
    const dest = { x: 104, y: rowY - 48 };
    const x0 = rec.x;
    let minY = rec.y;
    let maxDx = 0;
    let flips = 0;
    let prevSign = 0;
    for (let i = 0; i < 400; i++) {
        cc.x = rec.x;
        cc.y = rec.y;
        cc.role = "companion";
        cc.homeSettlementId = null;
        cc._resting = false;
        cc.ai._walkToward(dest.x, dest.y, false, world._aiWorld(), 16);
        const vx = cc.vx || 0;
        const sign = Math.abs(vx) > 8 ? Math.sign(vx) : 0;
        if (sign && prevSign && sign !== prevSign && rec.y > rowY - 2) flips++;
        if (sign) prevSign = sign;
        cc.applyDesiredVel(16);
        const nx = cc.x + (cc.vx || 0) * 0.016;
        const ny = cc.y + (cc.vy || 0) * 0.016;
        if (!world._partyPoseBlocked(cc, nx, cc.y, 0, poseOpts)) cc.x = nx;
        if (!world._partyPoseBlocked(cc, cc.x, ny, 0, poseOpts)) cc.y = ny;
        rec.x = cc.x;
        rec.y = cc.y;
        if (rec.y < minY) minY = rec.y;
        maxDx = Math.max(maxDx, Math.abs(rec.x - x0));
        if (rec.y < rowY - 12) break;
    }
    assert.ok(
        minY < rowY - 12,
        `should cross the row, ended ${rec.x.toFixed(1)},${rec.y.toFixed(1)}`
    );
    assert.ok(
        maxDx < 24,
        `should use a gap, not walk around the row (drifted ${maxDx.toFixed(1)}px)`
    );
    assert.ok(flips < 3, `paced in front of the gap (${flips} reversals)`);
});

test("a companion walks between campfires and a drying rack, not into a bench", () => {
    const Place = require("../shared/place");
    const { createTestWorld, originChunk } = require("./helpers/simWorld");
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const ty = 8;
    const row = [
        { id: "campfire", tx: 4 },
        { id: "campfire", tx: 5 },
        { id: "skinworking_bench", tx: 6, rot: 0 },
        { id: "drying_rack", tx: 7 },
        { id: "campfire", tx: 8 }
    ];
    for (let i = 0; i < row.length; i++) {
        const it = row[i];
        const def = world._thingDef(it.id);
        const pos = Place.footprintWorldPos(it.tx, ty, it.rot || 0, def.footprint || [1, 1], 16);
        chunk.things.push({
            uid: `st-${it.tx}`,
            id: it.id,
            x: pos.x,
            y: pos.y,
            rot: it.rot || 0,
            tx: it.tx,
            ty
        });
    }
    world._chunkRectCache = null;
    world._solidRects = null;
    const rackY = (ty + 1) * 16;
    const rec = world._companionFromSnap(pawn, {
        id: "buddy",
        name: "Buddy",
        x: 88,
        y: rackY + 48,
        inventory: [null, null, null, null, null]
    });
    pawn.party = [rec];
    const cc = world._ensureCompanionCreature(pawn, rec);
    const poseOpts = { load: false, sleepFootprint: false };
    assert.equal(
        world._partyPoseBlocked(cc, 80, rackY, 0, poseOpts),
        true,
        "a campfire center stays solid"
    );
    assert.equal(
        world._partyPoseBlocked(cc, 88, rackY, 0, poseOpts),
        true,
        "the gap beside a skinworking bench stays solid"
    );
    assert.equal(
        world._partyPoseBlocked(cc, 88, rackY, 2, poseOpts),
        true,
        "pathing must not aim through the bench gap"
    );
    function cross(startX) {
        rec.x = startX;
        rec.y = rackY + 20;
        cc.x = rec.x;
        cc.y = rec.y;
        cc.ai._path = null;
        const dest = { x: startX, y: rackY - 48 };
        let minY = rec.y;
        let maxDx = 0;
        let flips = 0;
        let prevSign = 0;
        for (let i = 0; i < 400; i++) {
            cc.x = rec.x;
            cc.y = rec.y;
            cc.role = "companion";
            cc.homeSettlementId = null;
            cc._resting = false;
            cc.ai._walkToward(dest.x, dest.y, false, world._aiWorld(), 16);
            const vx = cc.vx || 0;
            const sign = Math.abs(vx) > 8 ? Math.sign(vx) : 0;
            if (sign && prevSign && sign !== prevSign && rec.y > rackY - 2) flips++;
            if (sign) prevSign = sign;
            cc.applyDesiredVel(16);
            const nx = cc.x + (cc.vx || 0) * 0.016;
            const ny = cc.y + (cc.vy || 0) * 0.016;
            if (!world._partyPoseBlocked(cc, nx, cc.y, 0, poseOpts)) cc.x = nx;
            if (!world._partyPoseBlocked(cc, cc.x, ny, 0, poseOpts)) cc.y = ny;
            rec.x = cc.x;
            rec.y = cc.y;
            if (rec.y < minY) minY = rec.y;
            maxDx = Math.max(maxDx, Math.abs(rec.x - startX));
            if (rec.y < rackY - 12) break;
        }
        assert.ok(
            minY < rackY - 12,
            `from ${startX} should cross, ended ${rec.x.toFixed(1)},${rec.y.toFixed(1)}`
        );
        assert.ok(
            maxDx < 20,
            `from ${startX} should use a gap (drifted ${maxDx.toFixed(1)}px)`
        );
        assert.ok(flips < 3, `from ${startX} paced in front of the gap (${flips} reversals)`);
    }
    // South of a campfire pair. The bench beside them is solid, so a start
    // in front of it must go elsewhere without stepping into the board.
    cross(80);
    rec.x = 104;
    rec.y = rackY + 20;
    cc.x = rec.x;
    cc.y = rec.y;
    cc.ai._path = null;
    const bench = Place.collisionWorldRect(
        chunk.things.find((t) => t.id === "skinworking_bench"),
        world._thingDef("skinworking_bench"),
        16
    );
    for (let i = 0; i < 400; i++) {
        cc.x = rec.x;
        cc.y = rec.y;
        cc.role = "companion";
        cc.homeSettlementId = null;
        cc._resting = false;
        cc.ai._walkToward(104, rackY - 48, false, world._aiWorld(), 16);
        cc.applyDesiredVel(16);
        const nx = cc.x + (cc.vx || 0) * 0.016;
        const ny = cc.y + (cc.vy || 0) * 0.016;
        if (!world._partyPoseBlocked(cc, nx, cc.y, 0, poseOpts)) cc.x = nx;
        if (!world._partyPoseBlocked(cc, cc.x, ny, 0, poseOpts)) cc.y = ny;
        rec.x = cc.x;
        rec.y = cc.y;
        const body = world._creatureBodyAt(cc, rec.x, rec.y);
        assert.ok(
            !(body.right > bench.left && body.left < bench.right
                && body.bottom > bench.top && body.top < bench.bottom),
            `stepped into the bench at ${rec.x.toFixed(1)},${rec.y.toFixed(1)}`
        );
    }
});

test("stepMove keeps a short step on one axis split", () => {
    let probes = 0;
    const blocked = (x) => {
        probes++;
        return x >= 1;
    };
    const step = Path.stepMove(0, 0, 2, 1, blocked, null);
    assert.equal(step.x, 0);
    assert.equal(step.y, 1);
    assert.equal(step.arrived, false);
    assert.ok(probes <= 2, `short step probed ${probes} times`);
});

test("stepMove stops at a thin wall instead of jumping it or rejecting the step", () => {
    const blocked = (x) => x >= 10 && x <= 14;
    const step = Path.stepMove(0, 0, 40, 0, blocked, null);
    assert.ok(step.x >= 6 && step.x < 10, `stopped at ${step.x}`);
    assert.equal(step.arrived, false);
});

test("stepMove lands on a waypoint instead of sailing past it", () => {
    const step = Path.stepMove(0, 0, 30, 0, () => false, { x: 8, y: 0 });
    assert.ok(Math.hypot(step.x - 8, step.y) <= 2, `landed at ${step.x}`);
    assert.equal(step.arrived, true);
});

test("a clear long step still covers the whole distance", () => {
    const step = Path.stepMove(0, 0, 36, 0, () => false, null);
    assert.ok(Math.abs(step.x - 36) < 0.05, `ended at ${step.x}`);
    assert.equal(step.arrived, false);
});

test("a settler at sleep tick speed still walks between drying racks", () => {
    const Place = require("../shared/place");
    const Settlement = require("../shared/settlement");
    const { createTestWorld, originChunk } = require("./helpers/simWorld");

    function cross(startX, startYOff, stickX) {
        const { world, pawn } = createTestWorld();
        const chunk = originChunk(world);
        const ty = 8;
        for (let tx = 3; tx <= 12; tx++) {
            const pos = Place.footprintWorldPos(tx, ty, 0, [1, 1], 16);
            chunk.things.push({
                uid: `rack-${tx}`,
                id: "drying_rack",
                x: pos.x,
                y: pos.y,
                rot: 0,
                tx,
                ty
            });
        }
        world._chunkRectCache = null;
        const rackY = (ty + 1) * 16;
        const settle = Settlement.createSettlement({
            x: startX,
            y: rackY + startYOff,
            ownerId: pawn.id
        });
        const rec = world._settlerFromSnap({
            id: "settler1",
            name: "Parked",
            x: startX,
            y: rackY + startYOff,
            ownerId: pawn.id,
            homeSettlementId: settle.id,
            inventory: [null, null, null, null, null]
        });
        settle.jobs = {};
        settle.jobs[rec.id] = Settlement.defaultJobs();
        world.settlements.push(settle);
        world.settlers.push(rec);
        world._ensureSettlerCreature(rec);
        chunk.lootableThings.push({
            uid: "sticks-north",
            id: "sticks",
            x: stickX,
            y: rackY - 64
        });
        world.tickSpeed = 12;
        world.baseTickSpeed = 12;
        const x0 = rec.x;
        let maxDx = 0;
        let minY = rec.y;
        for (let i = 0; i < 80; i++) {
            world.tick(16);
            maxDx = Math.max(maxDx, Math.abs(rec.x - x0));
            if (rec.y < minY) minY = rec.y;
            if (rec.y < rackY - 12) break;
        }
        assert.ok(
            minY < rackY - 12,
            `from ${startX} should cross at 12×, ended ${rec.x.toFixed(1)},${rec.y.toFixed(1)}`
        );
        return maxDx;
    }

    // Straight at a rack, where an 11px step used to sail past the gap
    // waypoint and pace in front of the row.
    const drift = cross(100, 24, 100);
    assert.ok(drift < 28, `should use a gap, drifted ${drift.toFixed(1)}px`);
});

test("a settler at sleep tick speed still walks between wicker baskets", () => {
    const Place = require("../shared/place");
    const Settlement = require("../shared/settlement");
    const { createTestWorld, originChunk } = require("./helpers/simWorld");
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const ty = 8;
    for (let tx = 3; tx <= 12; tx++) {
        const pos = Place.footprintWorldPos(tx, ty, 0, [1, 1], 16);
        chunk.things.push({
            uid: `basket-${tx}`,
            id: "wicker_basket",
            x: pos.x,
            y: pos.y,
            rot: 0,
            tx,
            ty
        });
    }
    world._chunkRectCache = null;
    const rowY = (ty + 1) * 16;
    const startX = 104;
    const settle = Settlement.createSettlement({
        x: startX,
        y: rowY + 24,
        ownerId: pawn.id
    });
    const rec = world._settlerFromSnap({
        id: "settler1",
        name: "Parked",
        x: startX,
        y: rowY + 24,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        inventory: [null, null, null, null, null]
    });
    settle.jobs = {};
    settle.jobs[rec.id] = Settlement.defaultJobs();
    world.settlements.push(settle);
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    chunk.lootableThings.push({
        uid: "sticks-north",
        id: "sticks",
        x: startX,
        y: rowY - 64
    });
    world.tickSpeed = 12;
    world.baseTickSpeed = 12;
    const x0 = rec.x;
    let maxDx = 0;
    let minY = rec.y;
    for (let i = 0; i < 80; i++) {
        world.tick(16);
        maxDx = Math.max(maxDx, Math.abs(rec.x - x0));
        if (rec.y < minY) minY = rec.y;
        if (rec.y < rowY - 12) break;
    }
    assert.ok(
        minY < rowY - 12,
        `should cross at 12×, ended ${rec.x.toFixed(1)},${rec.y.toFixed(1)}`
    );
    assert.ok(maxDx < 28, `should use a gap, drifted ${maxDx.toFixed(1)}px`);
});

test("a settler walks between a campfire and a drying rack without shuffling", () => {
    const Place = require("../shared/place");
    const Settlement = require("../shared/settlement");
    const { createTestWorld, originChunk } = require("./helpers/simWorld");
    const prevNow = Date.now;
    let now = prevNow();
    Date.now = () => now;
    try {
        function cross(startX) {
            now += 5000;
            const { world, pawn } = createTestWorld();
            const chunk = originChunk(world);
            const ty = 8;
            for (const it of [
                { id: "campfire", tx: 5 },
                { id: "drying_rack", tx: 6 }
            ]) {
                const def = world._thingDef(it.id);
                const pos = Place.footprintWorldPos(it.tx, ty, 0, def.footprint || [1, 1], 16);
                chunk.things.push({
                    uid: `${it.id}-${startX}`,
                    id: it.id,
                    x: pos.x,
                    y: pos.y,
                    rot: 0,
                    tx: it.tx,
                    ty
                });
            }
            world._chunkRectCache = null;
            const rackY = (ty + 1) * 16;
            const settle = Settlement.createSettlement({
                x: startX,
                y: rackY + 40,
                ownerId: pawn.id
            });
            const rec = world._settlerFromSnap({
                id: "settler1",
                name: "Parked",
                x: startX,
                y: rackY + 40,
                ownerId: pawn.id,
                homeSettlementId: settle.id,
                inventory: [null, null, null, null, null]
            });
            world.settlements.push(settle);
            world.settlers.push(rec);
            const cc = world._ensureSettlerCreature(rec);
            let flips = 0;
            let prevSign = 0;
            let still = 0;
            let maxStill = 0;
            let shuffle = 0;
            let minY = rec.y;
            for (let i = 0; i < 120; i++) {
                now += 16;
                cc.x = rec.x;
                cc.y = rec.y;
                cc.role = "settler";
                cc.homeSettlementId = settle.id;
                cc._resting = false;
                world._aiStuckDt = 16;
                cc.ai._walkToward(startX, rackY - 48, false, world._aiWorld(), 16);
                cc.applyDesiredVel(16);
                const bx = cc.x;
                const by = cc.y;
                world._stepSettlerPose(cc, 0.016);
                rec.x = cc.x;
                rec.y = cc.y;
                const moved = Math.hypot(cc.x - bx, cc.y - by);
                const vx = cc.vx || 0;
                const vy = cc.vy || 0;
                if (rec.y > rackY - 8) {
                    const sign = Math.abs(vx) > 8 ? Math.sign(vx) : 0;
                    if (sign && prevSign && sign !== prevSign) flips++;
                    if (sign) prevSign = sign;
                    if (Math.abs(vx) > 36 && Math.abs(vy) < 12) shuffle++;
                    if (moved < 0.15) {
                        still++;
                        maxStill = Math.max(maxStill, still);
                    } else still = 0;
                }
                if (rec.y < minY) minY = rec.y;
                if (rec.y < rackY - 16) break;
            }
            assert.ok(
                minY < rackY - 12,
                `from ${startX} should cross, ended ${rec.x.toFixed(1)},${rec.y.toFixed(1)}`
            );
            assert.ok(flips < 2, `from ${startX} reversed in front of the gap (${flips})`);
            assert.equal(shuffle, 0, `from ${startX} strafed along the stations (${shuffle} frames)`);
            assert.ok(maxStill < 8, `from ${startX} stood still for ${maxStill} frames`);
        }
        cross(88);
        cross(96);
        cross(100);
        cross(104);
    } finally {
        Date.now = prevNow;
    }
});
