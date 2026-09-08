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
