const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const { loadDefs, DataStore } = require("./helpers/load");
const { createTestWorld, originChunk } = require("./helpers/simWorld");
const Place = require("../shared/place");
const Sleep = require("../shared/sleep");
const Research = require("../shared/research");
const Settlement = require("../shared/settlement");

loadDefs();

const TS = 16;

function thingDef(id) {
    return DataStore.getThing(id);
}

function hit(rects, x, y) {
    return rects.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
}

/** 2-bit indexed hut/wall.png, decoded once. */
function wallOpaqueGrid() {
    const data = fs.readFileSync(path.join(__dirname, "../assets/things/hut/wall.png"));
    let pos = 8;
    let w = 0;
    let h = 0;
    let bit = 0;
    let idat = Buffer.alloc(0);
    let trns = null;
    while (pos < data.length) {
        const ln = data.readUInt32BE(pos);
        const typ = data.slice(pos + 4, pos + 8).toString();
        const chunk = data.slice(pos + 8, pos + 8 + ln);
        pos += 12 + ln;
        if (typ === "IHDR") {
            w = chunk.readUInt32BE(0);
            h = chunk.readUInt32BE(4);
            bit = chunk[8];
        } else if (typ === "tRNS") trns = chunk;
        else if (typ === "IDAT") idat = Buffer.concat([idat, chunk]);
        else if (typ === "IEND") break;
    }
    const raw = zlib.inflateSync(idat);
    const rowBytes = Math.ceil((w * bit) / 8);
    const rows = [];
    let i = 0;
    let prev = Buffer.alloc(rowBytes);
    const paeth = (a, b, c) => {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
    };
    for (let yy = 0; yy < h; yy++) {
        const filt = raw[i++];
        const row = Buffer.from(raw.slice(i, i + rowBytes));
        i += rowBytes;
        if (filt === 1) {
            for (let xx = 0; xx < rowBytes; xx++) row[xx] = (row[xx] + (xx ? row[xx - 1] : 0)) & 255;
        } else if (filt === 2) {
            for (let xx = 0; xx < rowBytes; xx++) row[xx] = (row[xx] + prev[xx]) & 255;
        } else if (filt === 3) {
            for (let xx = 0; xx < rowBytes; xx++) {
                row[xx] = (row[xx] + (((xx ? row[xx - 1] : 0) + prev[xx]) >> 1)) & 255;
            }
        } else if (filt === 4) {
            for (let xx = 0; xx < rowBytes; xx++) {
                row[xx] = (row[xx] + paeth(xx ? row[xx - 1] : 0, prev[xx], xx ? prev[xx - 1] : 0)) & 255;
            }
        } else if (filt !== 0) {
            throw new Error(`filt ${filt}`);
        }
        rows.push(row);
        prev = row;
    }
    const grid = [];
    for (let yy = 0; yy < h; yy++) {
        const row = [];
        for (let xx = 0; xx < w; xx++) {
            const bitpos = xx * bit;
            const byte = rows[yy][bitpos >> 3];
            const shift = 8 - bit - (bitpos % 8);
            const idx = (byte >> shift) & ((1 << bit) - 1);
            const a = trns && idx < trns.length ? trns[idx] : 255;
            row.push(a >= 16);
        }
        grid.push(row);
    }
    return grid;
}

const WALL_OPAQUE = wallOpaqueGrid();

function placed(rot) {
    return { id: "hut", tx: 0, ty: 1, rot, x: 16, y: 32 };
}

test("hut footprint is a 2x2 square and a lean-to stays a strip", () => {
    const hut = thingDef("hut");
    const seen = new Set();
    for (const rot of [0, 90, 180, 270]) {
        const tiles = Place.footprintTiles(4, 6, rot, hut.footprint);
        assert.equal(tiles.length, 4, `rot ${rot}`);
        const keys = tiles.map((t) => `${t.tx},${t.ty}`);
        assert.equal(new Set(keys).size, 4, `rot ${rot} unique`);
        for (const k of keys) seen.add(`${rot}:${k}`);
    }
    const south = Place.footprintTiles(4, 6, 0, hut.footprint);
    assert.deepEqual(south.map((t) => [t.tx, t.ty]).sort(), [[4, 5], [4, 6], [5, 5], [5, 6]]);
    const lean = Place.footprintTiles(4, 6, 0, [2, 1]);
    assert.deepEqual(lean.map((t) => [t.tx, t.ty]), [[4, 6], [5, 6]]);
    const lean90 = Place.footprintTiles(4, 6, 90, [2, 1]);
    assert.equal(lean90.length, 2);
});

test("hut beds sit on the leaf patches and turn with the building", () => {
    const def = thingDef("hut");
    const entry = placed(0);
    const anchor = Place.spriteAnchor(entry, def, TS);
    assert.equal(anchor.x, 16);
    assert.equal(anchor.y, 32);
    const expect = [
        [9.5, 12.7],
        [22.5, 12.4],
        [9.5, 19.7],
        [22.3, 19.3]
    ];
    for (let i = 0; i < 4; i++) {
        const pos = Sleep.sleeperWorldPos(entry, i, TS, def);
        assert.ok(Math.abs(pos.x - expect[i][0]) < 0.05, `slot ${i} x ${pos.x}`);
        assert.ok(Math.abs(pos.y - expect[i][1]) < 0.05, `slot ${i} y ${pos.y}`);
    }
    const turned = Sleep.sleeperWorldPos({ ...entry, rot: 90 }, 0, TS, def);
    const off = Place.rotateAnchorOffset(-6.5, -19.3, 90, 32);
    const anchor90 = Place.spriteAnchor({ ...entry, rot: 90 }, def, TS);
    assert.ok(Math.abs(turned.x - (anchor90.x + off.dx)) < 0.05);
    assert.ok(Math.abs(turned.y - (anchor90.y + off.dy)) < 0.05);
    assert.equal(Sleep.restRotation(0, def), Math.PI / 2);
    assert.equal(Sleep.restRotation(90, def), Math.PI);
    assert.equal(Sleep.restRotation(180, def), -Math.PI / 2);
    assert.equal(Sleep.restRotation(270, def), 0);
    assert.equal(Sleep.restRotation(0, thingDef("lean_to")), Math.PI / 2);
});

test("hut wall mask matches the sprite and the doorway stays walkable", () => {
    const def = thingDef("hut");
    for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
            assert.equal(
                Place.wallMaskSolid(def.wallMask, x, y, 32),
                WALL_OPAQUE[y][x],
                `mask ${x},${y}`
            );
        }
    }
    const entry = placed(0);
    const rects = Place.collisionWorldRects(entry, def, TS);
    assert.ok(rects.length > 4);
    assert.equal(hit(rects, 16.5, 16.5), false, "interior");
    assert.equal(hit(rects, 2.5, 10.5), true, "west wall");
    assert.equal(Place.doorClearsPixel(def, 10, 29), true);
    assert.equal(hit(rects, 16.5, 29.5), false, "entrance is open");
    assert.equal(hit(rects, 6.5, 27.5), true, "wall beside the entrance stays solid");
    let bodyBlocked = false;
    for (let y = 24; y < 32; y++) {
        for (let x = 12; x < 20; x++) {
            if (hit(rects, x + 0.5, y + 0.5)) bodyBlocked = true;
        }
    }
    assert.equal(bodyBlocked, false, "8px body fits the entrance");

    const turned = Place.collisionWorldRects({ ...entry, rot: 90 }, def, TS);
    const anchor = Place.spriteAnchor({ ...entry, rot: 90 }, def, TS);
    const door = Place.rotateAnchorOffset(15.5 - 16, 29.5 - 32, 90, 32);
    assert.equal(hit(turned, anchor.x + door.dx, anchor.y + door.dy), false, "door follows rotation");
    const wall = Place.rotateAnchorOffset(2.5 - 16, 10.5 - 32, 90, 32);
    assert.equal(hit(turned, anchor.x + wall.dx, anchor.y + wall.dy), true, "wall follows rotation");
});

test("blood and vomit stop at the hut wall and can leave by the door", () => {
    const def = thingDef("hut");
    const entry = placed(0);
    const ring = Place.ringWorld(entry, def, TS);
    const inside = { x: ring.cx, y: ring.cy };
    const throughWall = Place.clipSpill(
        inside.x, inside.y, ring.cx, ring.cy - (ring.outer + 10), [ring]
    );
    const stopped = Math.hypot(throughWall.x - ring.cx, throughWall.y - ring.cy);
    assert.ok(stopped < ring.inner + 0.25, `spill crossed the wall at r=${stopped.toFixed(2)}`);
    assert.equal(Place.ringWallAt(ring, throughWall.x, throughWall.y), false);
    const door = Place.clipSpill(
        inside.x, inside.y, ring.cx, ring.cy + ring.outer + 12, [ring]
    );
    assert.ok(
        Math.abs(door.y - (ring.cy + ring.outer + 12)) < 0.5,
        "spill should pass out the entrance"
    );
    const turned = Place.ringWorld({ ...entry, rot: 90 }, def, TS);
    const side = Place.clipSpill(
        turned.cx, turned.cy, turned.cx, turned.cy - (turned.outer + 10), [turned]
    );
    const sideR = Math.hypot(side.x - turned.cx, side.y - turned.cy);
    assert.ok(sideR < turned.inner + 0.25, "rotated wall still stops a spill");
    const outDoor = Place.clipSpill(
        turned.cx, turned.cy, turned.cx - turned.outer - 12, turned.cy, [turned]
    );
    assert.ok(Math.abs(outDoor.x - (turned.cx - turned.outer - 12)) < 0.5);
    const embeddedR = (ring.inner + ring.outer) * 0.5;
    const embedded = { x: ring.cx, y: ring.cy - embeddedR };
    const pool = Place.clipSpill(
        embedded.x, embedded.y, ring.cx, ring.cy - (ring.outer + 8), [ring], 5
    );
    const poolR = Math.hypot(pool.x - ring.cx, pool.y - ring.cy);
    assert.ok(poolR + 5 <= ring.inner + 0.05, `pool still clears the wall at r=${poolR.toFixed(2)}`);
    const sitting = Place.clipSpill(embedded.x, embedded.y, embedded.x, embedded.y, [ring], 5);
    const sittingR = Math.hypot(sitting.x - ring.cx, sitting.y - ring.cy);
    assert.ok(sittingR + 5 <= ring.inner + 0.05, "a stain on the wall is pulled back inside");
});

test("a spatter from inside stops on the thatch, including beside the door", () => {
    const def = thingDef("hut");
    const entry = placed(0);
    const pix = (x, y) => {
        const anchor = Place.spriteAnchor(entry, def, TS);
        const off = Place.rotateAnchorOffset(x - 16, y - 32, entry.rot, 32);
        return { x: anchor.x + off.dx, y: anchor.y + off.dy };
    };
    const inside = pix(16.5, 16.5);
    const pastWall = pix(-2, 10.5);
    const held = Place.clipWallSpill(entry, def, TS, inside.x, inside.y, pastWall.x, pastWall.y, 2);
    assert.equal(Place.wallDiskHits(entry, def, TS, held.x, held.y, 2), false);
    assert.ok(Math.hypot(held.x - pastWall.x, held.y - pastWall.y) > 2);
    const pastDoor = pix(16.5, 40);
    const door = Place.clipWallSpill(entry, def, TS, inside.x, inside.y, pastDoor.x, pastDoor.y, 2);
    assert.ok(Math.hypot(door.x - pastDoor.x, door.y - pastDoor.y) < 0.5, "the drawn doorway stays open");
    const pastPost = pix(2, 36);
    const post = Place.clipWallSpill(entry, def, TS, inside.x, inside.y, pastPost.x, pastPost.y, 2);
    assert.equal(Place.wallDiskHits(entry, def, TS, post.x, post.y, 2), false);
    assert.ok(Math.hypot(post.x - pastPost.x, post.y - pastPost.y) > 2, "the door post still stops a spatter");
    const bunk = Sleep.sleeperWorldPos(entry, 1, TS, def);
    const fromBunk = Place.clipWallSpill(
        entry, def, TS, bunk.x, bunk.y, bunk.x + 8, bunk.y - 20, 2
    );
    assert.equal(Place.wallDiskHits(entry, def, TS, fromBunk.x, fromBunk.y, 2), false);
    const shifted = { x: bunk.x + 8, y: bunk.y - 8 };
    const center = pix(16, 16);
    const leaked = Place.clipWallSpill(
        entry, def, TS, shifted.x, shifted.y, shifted.x, shifted.y - 12, 2
    );
    assert.equal(Place.wallDiskHits(entry, def, TS, leaked.x, leaked.y, 2), false);
    assert.ok(
        Math.hypot(leaked.x - center.x, leaked.y - center.y)
            < Math.hypot(shifted.x - center.x, shifted.y - center.y),
        "a bunk shifted outside the thatch is pulled back in"
    );
    const ring = Place.ringWorld(entry, def, TS);
    // A chest above feet that are against the roof. The ring sits on the thatch,
    // so outer+4 is a sleeper shift, not someone standing clear.
    const outside = { x: ring.cx, y: ring.cy - (ring.outer + 8) };
    const stayed = Place.clipWallSpill(
        entry, def, TS, outside.x, outside.y, outside.x, outside.y - 10, 2
    );
    assert.ok(
        Math.hypot(stayed.x - ring.cx, stayed.y - ring.cy) > ring.outer,
        "someone standing outside is not pulled in"
    );
});

test("turning into the hut wall does not carry a pawn through it", () => {
    const def = thingDef("hut");
    const ring = Place.ringWorld(placed(0), def, TS);
    const through = Place.clampRingCenter(
        ring, ring.cx, ring.cy, ring.cx, ring.cy - (ring.outer + 6)
    );
    const throughR = Math.hypot(through.x - ring.cx, through.y - ring.cy);
    assert.ok(throughR < ring.inner, `center left the hut at r=${throughR.toFixed(2)}`);
    const ang = -Math.PI / 2;
    const press = ring.inner - 1;
    const sx = ring.cx + Math.cos(ang) * press;
    const sy = ring.cy + Math.sin(ang) * press;
    const turned = Place.clampRingCenter(
        ring, sx, sy,
        sx + Math.cos(ang) * 6 + 2,
        sy + Math.sin(ang) * 6
    );
    const turnedR = Math.hypot(turned.x - ring.cx, turned.y - ring.cy);
    assert.ok(turnedR < ring.inner, `turn stepped through at r=${turnedR.toFixed(2)}`);
    const along = Place.clampRingCenter(ring, ring.cx, ring.cy + 4, ring.cx + 3, ring.cy + 4);
    assert.ok(Math.abs(along.x - (ring.cx + 3)) < 0.01, "sliding inside the ring stays free");
    const doorToY = ring.cy + ring.outer + 8;
    const door = Place.clampRingCenter(ring, ring.cx, ring.cy, ring.cx, doorToY);
    assert.ok(Math.abs(door.y - doorToY) < 0.01, "the entrance still lets you out");
    const outside = Place.clampRingCenter(
        ring, ring.cx, ring.cy - (ring.outer + 6), ring.cx, ring.cy
    );
    const outsideR = Math.hypot(outside.x - ring.cx, outside.y - ring.cy);
    assert.ok(outsideR > ring.outer, `outside step entered at r=${outsideR.toFixed(2)}`);
    const far = Place.clampRingCenter(ring, ring.cx, ring.cy, ring.cx + 400, ring.cy);
    assert.equal(far.x, ring.cx + 400);
    const rad = 4;
    const keep = ring.inner - rad - 0.15;
    const a0 = -Math.PI / 2;
    const sx0 = ring.cx + Math.cos(a0) * keep;
    const sy0 = ring.cy + Math.sin(a0) * keep;
    const a1 = a0 + 0.2;
    const slid = Place.clampRingCenter(
        ring, sx0, sy0,
        ring.cx + Math.cos(a1) * (keep + 3),
        ring.cy + Math.sin(a1) * (keep + 3),
        rad
    );
    const slidR = Math.hypot(slid.x - ring.cx, slid.y - ring.cy);
    assert.ok(Math.abs(slidR - keep) < 0.05, `slide left the circle at r=${slidR.toFixed(2)}`);
    const slidA = Math.atan2(slid.y - ring.cy, slid.x - ring.cx);
    assert.ok(Math.abs(slidA - a1) < 0.05, "sliding keeps moving along the wall");
    const buried = Place.clampRingCenter(
        ring, ring.cx, ring.cy - (ring.inner - 1), ring.cx, ring.cy - (ring.inner - 1), rad
    );
    const buriedR = Math.hypot(buried.x - ring.cx, buried.y - ring.cy);
    assert.ok(buriedR <= keep + 0.05, "a body dug into the wall is pushed back to the circle");
});

test("walking down onto a hut stops at the thatch, not above it", () => {
    const def = thingDef("hut");
    const entry = placed(0);
    const ring = Place.ringWorld(entry, def, TS);
    const anchor = Place.spriteAnchor(entry, def, TS);
    const hx = 4;
    const hy = 2;
    const fromY = ring.cy - (ring.outer + 6);
    const held = Place.clampRingCenter(ring, ring.cx, fromY, ring.cx, fromY + 10, hx, hy);
    const feetY = held.y + hy;
    const thatchTop = anchor.y - 32 + 1;
    const gap = thatchTop - feetY;
    assert.ok(gap < 1.25, `feet stop ${gap.toFixed(2)}px above the roof`);
    assert.ok(gap > -0.25, `feet sink into the roof by ${(-gap).toFixed(2)}px`);
    const sideFrom = ring.cx + ring.outer + 6;
    const side = Place.clampRingCenter(
        ring, sideFrom, ring.cy, sideFrom - 10, ring.cy, hx, hy
    );
    const sideGap = (side.x - hx) - (ring.cx + ring.outer);
    assert.ok(Math.abs(sideGap - 0.15) < 0.05, `side of the body should meet the wall, gap ${sideGap.toFixed(2)}`);
});

function stepCompanion(world, pawn, rec, tx, ty) {
    const cc = world._ensureCompanionCreature(pawn, rec);
    const aiWorld = world._aiWorld();
    cc.x = rec.x;
    cc.y = rec.y;
    cc.role = "companion";
    cc.homeSettlementId = null;
    cc._resting = false;
    cc.ai._walkToward(tx, ty, false, aiWorld, 16);
    cc.applyDesiredVel(16);
    const sec = 0.016;
    const nx = cc.x + (cc.vx || 0) * sec;
    const ny = cc.y + (cc.vy || 0) * sec;
    const opts = { load: false, sleepFootprint: false };
    if (!world._partyPoseBlocked(cc, nx, cc.y, 0, opts)) cc.x = nx;
    if (!world._partyPoseBlocked(cc, cc.x, ny, 0, opts)) cc.y = ny;
    rec.x = cc.x;
    rec.y = cc.y;
}

test("a companion who stands up inside a hut can path out the door", () => {
    const { world, pawn } = createTestWorld();
    const def = world._thingDef("hut");
    const chunk = originChunk(world);
    const rec = world._companionFromSnap(pawn, {
        id: "buddy",
        name: "Buddy",
        x: 80,
        y: 100,
        inventory: [null, null, null, null, null]
    });
    pawn.party = [rec];
    for (const rot of [0, 90, 180, 270]) {
        chunk.things.length = 0;
        world._chunkRectCache = null;
        const placed = Place.footprintWorldPos(4, 6, rot, def.footprint, 16);
        const entry = {
            uid: `hut-${rot}`,
            id: "hut",
            rot,
            tx: 4,
            ty: 6,
            x: placed.x,
            y: placed.y
        };
        Place.ensureSleepEntry(entry, def);
        chunk.things.push(entry);
        const ring = Place.ringWorld(entry, def, 16);
        const beside = Sleep.besideWorldPos(entry, 16, def);
        const dx = beside.x - ring.cx;
        const dy = beside.y - ring.cy;
        const len = Math.hypot(dx, dy) || 1;
        const dest = {
            x: beside.x + (dx / len) * 40,
            y: beside.y + (dy / len) * 40
        };
        const cc = rec.creature;
        const two = Math.PI * 2;
        const norm = (v) => ((v % two) + two) % two;
        let a0 = norm(ring.door0);
        let a1 = norm(ring.door1);
        let span = a1 - a0;
        if (span < 0) span += two;
        const away = a0 + span / 2 + Math.PI;
        const wr = (ring.inner + ring.outer) * 0.5;
        const wallCx = ring.cx + Math.cos(away) * wr;
        const wallCy = ring.cy + Math.sin(away) * wr;
        const wallFeet = { x: wallCx - 8, y: wallCy + 4 };
        const wallBody = world._creatureBodyAt(cc, wallFeet.x, wallFeet.y);
        assert.equal(
            Place.rectHitsRing(ring, wallBody.left, wallBody.right, wallBody.top, wallBody.bottom),
            true,
            `rot ${rot} thatch sample misses the ring`
        );
        assert.equal(
            world._partyPoseBlocked(cc, wallFeet.x, wallFeet.y, 0),
            true,
            `rot ${rot} thatch stays solid`
        );
        const starts = [];
        for (let slot = 0; slot < 4; slot++) {
            starts.push(Sleep.sleeperWorldPos(entry, slot, 16, def));
        }
        starts.push({ x: ring.cx - 8, y: ring.cy + 8 });
        for (let s = 0; s < starts.length; s++) {
            const start = starts[s];
            rec.x = start.x;
            rec.y = start.y;
            cc.x = start.x;
            cc.y = start.y;
            cc._resting = false;
            cc.ai._path = null;
            cc.ai._pathGoalX = null;
            cc.ai._pathGoalY = null;
            cc.ai._stuckMs = 0;
            cc.ai._planAt = 0;
            if (world._partyPoseBlocked(cc, rec.x, rec.y, 0, { sleepFootprint: false })) {
                world._ejectOverlappingPose(rec, cc);
                rec.x = cc.x;
                rec.y = cc.y;
            }
            const before = Math.hypot(rec.x - dest.x, rec.y - dest.y);
            for (let i = 0; i < 240; i++) stepCompanion(world, pawn, rec, dest.x, dest.y);
            const after = Math.hypot(rec.x - dest.x, rec.y - dest.y);
            assert.ok(
                after < 8,
                `rot ${rot} start ${s} stuck at ${rec.x.toFixed(1)},${rec.y.toFixed(1)} (${after.toFixed(1)}px, was ${before.toFixed(1)})`
            );
        }
    }
});

test("hut is researched after camping and crafts just after the lean-to", () => {
    const items = require("../data/Items.json");
    const ids = items.filter(Boolean).map((it) => it.id);
    assert.equal(ids.indexOf("hut"), ids.indexOf("lean_to") + 1);
    const item = DataStore.getItem("hut");
    assert.equal(item.recipe.log, 12);
    assert.equal(item.recipe.stick, 20);
    assert.equal(item.recipe.leaf_cord, 12);
    assert.equal(item.recipe.leaf, 40);
    assert.equal(item.recipe.stick_frame, 4);
    assert.equal(Research.techIsWip("hut"), false);
    assert.ok(Research.techById("hut").unlocks.items.includes("hut"));
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    assert.equal(Research.recipeUnlocked("hut", s), false);
    Research.unlock(s, "hut");
    assert.equal(Research.recipeUnlocked("hut", s), true);
    assert.equal(Sleep.healBonus(thingDef("hut")), 12);
    assert.equal(Sleep.healBonus(thingDef("lean_to")), 8);
    const loads = Place.thingImageLoads(thingDef("hut"));
    assert.deepEqual(loads.map((l) => l.path), [
        "assets/things/hut/floor.png",
        "assets/things/hut/wall.png"
    ]);
});
