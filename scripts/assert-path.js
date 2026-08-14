/**
 * Standing-feet pathing must go around a 5×5 tree at the tile bottom —
 * the old cell-center sample treated that tile as empty.
 */
const Path = require("../shared/path");

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
if (blocked(center.x, center.y)) {
    throw new Error("fixture: cell center should miss the tree (that's the old bug)");
}
if (!blocked(stand.x, stand.y)) {
    throw new Error("fixture: standing pose in the tree tile must be blocked");
}

const from = { x: 3 * TS + 4, y: ty * TS + TS };
const to = { x: 8 * TS + 4, y: ty * TS + TS };
if (!blocked(stand.x, stand.y) || blocked(from.x, from.y) || blocked(to.x, to.y)) {
    throw new Error("fixture: from/to must be clear, tree tile blocked");
}

const path = Path.planPath(from, to, blocked, { cellSize: TS, maxRange: 12, side: 1 });
if (!path || !path.length) throw new Error("planPath returned no route around the tree");
for (const p of path) {
    if (blocked(p.x, p.y)) throw new Error(`path waypoint hits tree ${JSON.stringify(p)}`);
}

const steered = Path.steerToward({
    from,
    to,
    blocked,
    cellSize: TS,
    side: 1,
    dt: 16
});
if (!steered.path || !steered.path.length) {
    throw new Error("steerToward bee-lined through the tree");
}
if (Math.abs(steered.ny) < 0.15 && steered.nx > 0.9) {
    throw new Error("steerToward walked east into the tree instead of around");
}

const combat = Path.steerToward({
    from,
    to,
    blocked,
    cellSize: TS,
    side: 1,
    dt: 16,
    openRadius: 2,
    maxRange: 16
});
if (!combat.path || !combat.path.length) {
    throw new Error("combat steerToward bee-lined through the tree");
}
if (Math.abs(combat.ny) < 0.15 && combat.nx > 0.9) {
    throw new Error("combat steerToward walked east into the tree instead of around");
}

console.log("assert-path ok", path.length, "waypoints");
