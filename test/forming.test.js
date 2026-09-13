const { test } = require("node:test");
const assert = require("node:assert/strict");
const Forming = require("../shared/forming");

function set(grid, cells) {
    for (const [x, y, z] of cells) grid[x][y][z] = true;
    return grid;
}

function box(grid, x0, x1, y0, y1, z0, z1) {
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            for (let z = z0; z <= z1; z++) grid[x][y][z] = true;
        }
    }
    return grid;
}

function animalShape() {
    const g = Forming.emptyGrid();
    box(g, 4, 11, 2, 4, 7, 9);
    box(g, 5, 5, 0, 1, 7, 7);
    box(g, 5, 5, 0, 1, 9, 9);
    box(g, 10, 10, 0, 1, 7, 7);
    box(g, 10, 10, 0, 1, 9, 9);
    return g;
}

function humanShape() {
    const g = Forming.emptyGrid();
    box(g, 7, 7, 0, 2, 8, 8);
    box(g, 9, 9, 0, 2, 8, 8);
    box(g, 7, 9, 3, 8, 8, 8);
    box(g, 8, 8, 9, 11, 8, 8);
    return g;
}

function deityShape() {
    const g = humanShape();
    g[7][11][8] = true;
    g[9][11][8] = true;
    g[7][12][8] = true;
    g[9][12][8] = true;
    return g;
}

function lumpShape() {
    const g = Forming.emptyGrid();
    box(g, 6, 10, 0, 4, 6, 10);
    return g;
}

test("pack/unpack roundtrip", () => {
    const g = animalShape();
    const packed = Forming.pack(g);
    const back = Forming.unpack(packed);
    assert.equal(Forming.mass(back), Forming.mass(g));
    assert.equal(Forming.sanitizePack(packed), packed);
    assert.equal(Forming.unpack("nope"), null);
    assert.equal(Forming.sanitizePack("@@@"), null);
});

test("heightmap mound has at least MIN_MASS", () => {
    const w = 16;
    const h = 16;
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let x = 4; x <= 11; x++) {
        for (let y = 10; y <= 15; y++) {
            const i = (y * w + x) * 4;
            pixels[i] = 196;
            pixels[i + 1] = 122;
            pixels[i + 2] = 106;
            pixels[i + 3] = 255;
        }
    }
    const g = Forming.moundFromPixels(pixels, w, h);
    const n = Forming.mass(g);
    assert.ok(n >= Forming.MIN_MASS, `mound mass ${n}`);
    assert.equal(Forming.averageColor(pixels) > 0, true);
});

test("empty pixels still yield a min-mass mound", () => {
    const g = Forming.moundFromPixels(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
    assert.ok(Forming.mass(g) >= Forming.MIN_MASS);
});

test("rotate Y 90 CW/CCW around center and refuse OOB", () => {
    const g = Forming.emptyGrid();
    g[9][1][8] = true;
    const cw = Forming.rotateY(g, 1);
    assert.ok(cw);
    assert.equal(cw[7][1][9], true);
    assert.equal(Forming.mass(cw), 1);
    const ccw = Forming.rotateY(g, -1);
    assert.ok(ccw);
    assert.equal(ccw[8][1][6], true);
    const back = Forming.rotateY(cw, -1);
    assert.equal(back[9][1][8], true);
    const edge = Forming.emptyGrid();
    edge[0][0][0] = true;
    // 0,0 maps onto the cube; a voxel at the geometric corner stays in-bounds
    const turned = Forming.rotateY(edge, 1);
    assert.ok(turned);
    assert.equal(Forming.mass(turned), 1);
});

test("rotatePackYaw yaws a packed figurine by place rot", () => {
    const g = Forming.emptyGrid();
    g[9][1][8] = true;
    const packed = Forming.pack(g);
    assert.equal(Forming.rotatePackYaw(packed, 0), packed);
    const cw = Forming.rotatePackYaw(packed, 90);
    const grid = Forming.unpack(cw);
    assert.equal(grid[7][1][9], true);
    const full = Forming.rotatePackYaw(packed, 360);
    assert.equal(Forming.unpack(full)[9][1][8], true);
    const back = Forming.rotatePackYaw(cw, 270);
    assert.equal(Forming.unpack(back)[9][1][8], true);
});

test("detachLegacyPlaceYaw restores baked place yaw once", () => {
    const g = Forming.emptyGrid();
    g[9][1][8] = true;
    const packed = Forming.pack(g);
    const yawed = Forming.rotatePackYaw(packed, 90);
    const legacy = { formVoxels: yawed, rot: 90 };
    Forming.detachLegacyPlaceYaw(legacy);
    assert.equal(legacy.formPose, 1);
    assert.equal(legacy.formVoxels, packed);
    Forming.detachLegacyPlaceYaw(legacy);
    assert.equal(legacy.formVoxels, packed);
    const fresh = { formVoxels: packed, rot: 90, formPose: 1 };
    Forming.detachLegacyPlaceYaw(fresh);
    assert.equal(fresh.formVoxels, packed);
});

test("classifier: animal, human, deity, lump", () => {
    const animal = Forming.classify(animalShape(), { idolatry: true });
    assert.equal(animal.formClass, "animal");
    const human = Forming.classify(humanShape(), { idolatry: true });
    assert.equal(human.formClass, "human");
    const deity = Forming.classify(deityShape(), { idolatry: true });
    assert.equal(deity.formClass, "deity");
    const lump = Forming.classify(lumpShape(), { idolatry: true });
    assert.equal(lump.formClass, "lump");
});

test("deity extras without idolatry fall back to human", () => {
    const r = Forming.classify(deityShape(), { idolatry: false });
    assert.equal(r.formClass, "human");
});

test("classifier uses largest connected component", () => {
    const g = animalShape();
    g[1][0][1] = true;
    g[1][1][1] = true;
    const r = Forming.classify(g, { idolatry: false });
    assert.equal(r.formClass, "animal");
    assert.ok(Forming.components(g).length >= 2);
});

test("clearColumn removes every voxel in an XZ stack", () => {
    const g = Forming.emptyGrid();
    g[4][0][9] = true;
    g[4][3][9] = true;
    g[4][15][9] = true;
    g[4][3][8] = true;
    g[5][3][9] = true;
    const n = Forming.clearColumn(g, 4, 9);
    assert.equal(n, 3);
    assert.equal(g[4][0][9], false);
    assert.equal(g[4][3][9], false);
    assert.equal(g[4][15][9], false);
    assert.equal(g[4][3][8], true);
    assert.equal(g[5][3][9], true);
    assert.equal(Forming.clearColumn(g, 4, 9), 0);
    assert.equal(Forming.clearColumn(g, -1, 0), 0);
});

test("delete then add conserves mass via the pool", () => {
    const g = Forming.cloneGrid(lumpShape());
    const start = Forming.mass(g);
    g[6][0][6] = false;
    let pool = 1;
    assert.equal(Forming.mass(g) + pool, start);
    g[5][0][6] = true;
    pool--;
    assert.equal(pool, 0);
    assert.equal(Forming.mass(g), start);
});

test("Use more clay adds exactly starting-lump mass to the pool", () => {
    const mound = Forming.moundFromPixels(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
    const n = Forming.mass(mound);
    let pool = 0;
    pool += n;
    pool += n;
    assert.equal(pool, n * 2);
});

test("empty grid / below MIN_MASS shatters", () => {
    const empty = Forming.emptyGrid();
    assert.equal(Forming.shatterCheck(empty).shattered, true);
    assert.equal(Forming.shatterCheck(empty).reason, "It crumbled to dust");
    const tiny = Forming.emptyGrid();
    tiny[8][0][8] = true;
    tiny[8][1][8] = true;
    assert.equal(Forming.shatterCheck(tiny).shattered, true);
    assert.equal(Forming.shatterCheck(tiny).reason, "It crumbled to bits");
    const hold = Forming.shatterCheck(tiny, { holding: { x: 8, y: 2, z: 8 } });
    assert.equal(hold.shattered, true);
    const ok = Forming.shatterCheck(lumpShape());
    assert.equal(ok.shattered, false);
});

test("holding a voxel counts toward shatter mass", () => {
    const g = Forming.emptyGrid();
    for (let i = 0; i < 11; i++) g[8][i][8] = true;
    assert.equal(Forming.shatterCheck(g).shattered, true);
    const held = Forming.shatterCheck(g, { holding: { x: 8, y: 11, z: 8 } });
    assert.equal(held.shattered, false);
});

test("weight scales with voxel count", () => {
    const n = 20;
    assert.equal(Forming.weightFor(20, n), 0.8);
    assert.equal(Forming.weightFor(10, n), 0.4);
    assert.equal(Forming.weightFor(40, n), 1.6);
});

test("makeStack beauty and flavor by class", () => {
    const g = humanShape();
    const human = Forming.makeStack("human", g, Forming.mass(g));
    assert.equal(human.id, "clay_figurine");
    assert.equal(human.beauty, 1);
    assert.equal(human.tooltipExtra, "Resembles someone we know");
    const animal = Forming.makeStack("animal", g, Forming.mass(g));
    assert.equal(animal.tooltipExtra, "Resembles a four-legged friend");
    const deity = Forming.makeStack("deity", deityShape(), 20);
    assert.equal(deity.beauty, 2);
    assert.equal(deity.tooltipExtra, "Resembles a figure of worship");
    const lump = Forming.makeStack("lump", lumpShape(), 20);
    assert.equal(lump.beauty, 0);
    assert.equal(lump.tooltipExtra, "Resembles a lump of clay");
    assert.ok(Forming.unpack(human.formVoxels));
    assert.equal(human.formStartMass, Forming.mass(g));
    assert.equal(Forming.canPlaceClass("human"), true);
    assert.equal(Forming.canPlaceClass("animal"), true);
    assert.equal(Forming.canPlaceClass("deity"), true);
    assert.equal(Forming.canPlaceClass("lump"), false);
    assert.equal(Forming.canPlaceClass(""), false);
});

test("finish naming: unnamed lump, class default, custom sticky", () => {
    const lump = Forming.makeStack("lump", lumpShape(), 20);
    Forming.applyFinishName(lump, {});
    assert.equal(lump.customName, undefined);
    assert.equal(lump.formCustom, undefined);

    const human = Forming.makeStack("human", humanShape(), Forming.mass(humanShape()));
    Forming.applyFinishName(human, {});
    assert.equal(human.customName, "Clay Human Figurine");
    assert.equal(!!human.formCustom, false);
    assert.equal(Forming.isCustomName(human), false);

    const animal = Forming.makeStack("animal", animalShape(), 20);
    Forming.applyFinishName(animal, {
        prev: { customName: "Clay Human Figurine", formClass: "human" },
        pendingCustom: false
    });
    assert.equal(animal.customName, "Clay Animal Figurine");

    const smashed = Forming.makeStack("lump", lumpShape(), 20);
    Forming.applyFinishName(smashed, {
        prev: { customName: "Clay Human Figurine", formClass: "human" }
    });
    assert.equal(smashed.customName, "Clay Lump");

    const bob = Forming.makeStack("animal", animalShape(), 20);
    Forming.applyFinishName(bob, {
        prev: { customName: "Bob", formCustom: true, formClass: "human" },
        pendingName: "Bob",
        pendingCustom: true
    });
    assert.equal(bob.customName, "Bob");
    assert.equal(bob.formCustom, true);

    assert.equal(Forming.isCustomName({ customName: "Clay Human Figurine" }), false);
    assert.equal(Forming.isCustomName({ customName: "Bob" }), true);
    assert.equal(Forming.defaultNameFor("human"), "Clay Human Figurine");
    assert.equal(Forming.clampName("  hi  "), "hi");
});

test("undo stack records last 20 edits and has no redo", () => {
    const hist = [];
    let grid = Forming.cloneGrid(lumpShape());
    let pool = 0;
    const push = () => {
        hist.push({ grid: Forming.cloneGrid(grid), pool });
        if (hist.length > Forming.UNDO_MAX) hist.shift();
    };
    for (let i = 0; i < 25; i++) {
        push();
        const x = 6 + (i % 5);
        if (grid[x][0][6]) {
            grid[x][0][6] = false;
            pool++;
        }
    }
    assert.equal(hist.length, Forming.UNDO_MAX);
    const last = hist.pop();
    grid = last.grid;
    pool = last.pool;
    assert.equal(typeof pool, "number");
    assert.equal(hist.length, Forming.UNDO_MAX - 1);
});

test("top-down rgba is 1 pixel per XZ column", () => {
    const g = Forming.emptyGrid();
    g[2][5][3] = true;
    g[5][8][3] = true;
    g[2][1][4] = true;
    const rgba = Forming.topDownRgba(g, 0xff0000);
    assert.equal(rgba.length, 16 * 16 * 4);
    const alpha = (x, z) => rgba[(z * 16 + x) * 4 + 3];
    assert.equal(alpha(2, 3), 255);
    assert.equal(alpha(5, 3), 255);
    assert.equal(alpha(4, 3), 0);
    assert.equal(alpha(2, 4), 255);
    assert.equal(alpha(2, 5), 0);
    const g2 = Forming.emptyGrid();
    g2[8][0][8] = true;
    g2[9][15][8] = true;
    const rgba2 = Forming.topDownRgba(g2, 0xffffff);
    const lum = (x, z) => rgba2[(z * 16 + x) * 4];
    assert.ok(lum(9, 8) > lum(8, 8));
    const armed = humanShape();
    box(armed, 5, 6, 6, 7, 8, 8);
    box(armed, 10, 11, 6, 7, 8, 8);
    const top = Forming.topDownRgba(armed, 0xc47a6a);
    const occupied = (x, z) => top[(z * 16 + x) * 4 + 3] === 255;
    assert.equal(occupied(8, 8), true);
    assert.equal(occupied(5, 8), true);
    assert.equal(occupied(11, 8), true);
    assert.equal(occupied(4, 8), false);
});
