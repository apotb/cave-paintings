const { test } = require("node:test");
const assert = require("node:assert/strict");
const Path = require("../shared/path");

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
