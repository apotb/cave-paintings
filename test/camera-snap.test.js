const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");

const context = {};
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(require.resolve("../js/Utils.js"), "utf8")
    + "\nthis.cameraPixelFrac = cameraPixelFrac;\n"
    + "this.cameraFocusXBesidePanel = cameraFocusXBesidePanel;\n"
    + "this.cameraPanelShiftPixels = cameraPanelShiftPixels;\n"
    + "this.easePixelShift = easePixelShift;\n"
    + "this.waterSheetSize = waterSheetSize;\n"
    + "this.snapCameraScrollToPixels = snapCameraScrollToPixels;\n"
    + "this.snapWorldToScreenPixel = snapWorldToScreenPixel;\n"
    + "this.snapWorldOffsetToSubject = snapWorldOffsetToSubject;\n",
    context
);

/** Screen Y of a world point after Phaser's camera matrix (origin 0.5, no shake). */
function screenOf(world, scroll, viewSize, zoom) {
    const half = viewSize * 0.5;
    const origin = Math.floor(half + 0.5);
    const translate = origin - zoom * half;
    return zoom * (world - scroll) + translate;
}

test("odd viewport no longer leaves world pixels on a half pixel", () => {
    const cam = { scrollX: 40.2, scrollY: 80.4, width: 1512, height: 901, zoom: 3 };
    context.snapCameraScrollToPixels(cam, 3);
    for (const worldY of [0, 16, 128, 256]) {
        const sy = screenOf(worldY, cam.scrollY, cam.height, 3);
        assert.ok(Math.abs(sy - Math.round(sy)) < 1e-6, `y ${worldY} -> ${sy}`);
    }
    const seam = screenOf(128, cam.scrollY, cam.height, 3) - screenOf(0, cam.scrollY, cam.height, 3);
    assert.ok(Math.abs(seam - 128 * 3) < 1e-6);
});

test("even viewport stays on whole pixels", () => {
    const cam = { scrollX: 10, scrollY: 22.3, width: 800, height: 600, zoom: 3 };
    context.snapCameraScrollToPixels(cam, 3);
    const sy = screenOf(64, cam.scrollY, cam.height, 3);
    assert.ok(Math.abs(sy - Math.round(sy)) < 1e-6);
});

test("open settlement tab centers the body in the gap to its right", () => {
    const viewW = 1512;
    const zoom = 3;
    const bodyX = 100;
    const panelRight = 320;
    const focusX = context.cameraFocusXBesidePanel(bodyX, panelRight, viewW, zoom);
    const rounded = Math.round(focusX * zoom) / zoom;
    const cam = {
        scrollX: rounded - viewW * 0.5,
        scrollY: 0,
        width: viewW,
        height: 901,
        zoom
    };
    context.snapCameraScrollToPixels(cam, zoom);
    const sx = screenOf(bodyX, cam.scrollX, viewW, zoom);
    const target = (panelRight + viewW) * 0.5;
    assert.ok(Math.abs(sx - target) < 1, `screen ${sx} target ${target}`);
    assert.ok(sx > viewW * 0.5);
});

test("settlement offset stays locked to the body while it moves", () => {
    const viewW = 1513;
    const zoom = 3;
    const panelRight = 321.5;
    const half = viewW * 0.5;
    let prevDelta = null;
    for (let i = 0; i <= 90; i++) {
        const bodyX = i / 10;
        const closed = Math.round(bodyX * zoom) / zoom;
        const open = context.cameraFocusXBesidePanel(closed, panelRight, viewW, zoom);
        const camClosed = { scrollX: closed - half, scrollY: 0, width: viewW, height: 901, zoom };
        const camOpen = { scrollX: open - half, scrollY: 0, width: viewW, height: 901, zoom };
        context.snapCameraScrollToPixels(camClosed, zoom);
        context.snapCameraScrollToPixels(camOpen, zoom);
        const delta = screenOf(bodyX, camOpen.scrollX, viewW, zoom)
            - screenOf(bodyX, camClosed.scrollX, viewW, zoom);
        if (prevDelta == null) prevDelta = delta;
        assert.ok(Math.abs(delta - prevDelta) < 1e-6, `delta drifted to ${delta} at x ${bodyX}`);
        assert.ok(Math.abs(delta - Math.round(delta)) < 1e-6, `delta ${delta} is not a whole pixel`);
    }
});

function worldAtScreen(screen, scroll, viewSize, zoom) {
    const half = viewSize * 0.5;
    const origin = Math.floor(half + 0.5);
    const translate = origin - zoom * half;
    return scroll + (screen - translate) / zoom;
}

test("water sheet keeps one size and still covers the shifted view", () => {
    const viewW = 1512;
    const viewH = 901;
    const zoom = 3;
    const bodyX = 400;
    const bodyY = 300;
    const panelRight = 420;
    const focusX = context.cameraFocusXBesidePanel(bodyX, panelRight, viewW, zoom);
    const size = context.waterSheetSize(viewW, viewH, zoom, 16);
    const again = context.waterSheetSize(viewW, viewH, zoom, 16);
    assert.equal(size.width, again.width);
    assert.equal(size.height, again.height);
    const place = (fx, fy) => {
        const cx = Math.round(fx / 16) * 16;
        const cy = Math.round(fy / 16) * 16;
        return { left: cx - size.width / 2, top: cy - size.height / 2 };
    };
    const sheet = place(focusX, bodyY);
    assert.equal(sheet.left % 16, 0);
    assert.equal(sheet.top % 16, 0);
    const half = viewW * 0.5;
    const cam = { scrollX: focusX - half, scrollY: bodyY - viewH * 0.5, width: viewW, height: viewH, zoom };
    context.snapCameraScrollToPixels(cam, zoom);
    const worldLeft = worldAtScreen(0, cam.scrollX, viewW, zoom);
    const worldRight = worldAtScreen(viewW, cam.scrollX, viewW, zoom);
    const worldTop = worldAtScreen(0, cam.scrollY, viewH, zoom);
    const worldBottom = worldAtScreen(viewH, cam.scrollY, viewH, zoom);
    assert.ok(sheet.left <= worldLeft, `left ${sheet.left} > ${worldLeft}`);
    assert.ok(sheet.left + size.width >= worldRight);
    assert.ok(sheet.top <= worldTop);
    assert.ok(sheet.top + size.height >= worldBottom);
    assert.deepEqual(size, context.waterSheetSize(viewW, viewH, zoom, 16));
    assert.notEqual(place(bodyX, bodyY).left, sheet.left);
});

test("settlement camera shift starts and ends slowly", () => {
    const goal = 180;
    const dur = 700;
    let prev = 0;
    let early = 0;
    let mid = null;
    for (let ms = 0; ms <= dur; ms += 16.7) {
        const next = context.easePixelShift(0, goal, ms / dur);
        assert.equal(next, Math.round(next));
        assert.ok(next >= prev && next <= goal, `${prev} -> ${next}`);
        prev = next;
        if (ms <= 80) early = next;
        if (mid == null && ms >= dur * 0.5) mid = next;
    }
    assert.equal(prev, goal);
    assert.ok(early < goal * 0.12, `early move ${early} is still a lurch`);
    assert.ok(Math.abs(mid - goal / 2) <= 2);
    let back = goal;
    for (let ms = 0; ms <= dur; ms += 16.7) {
        const next = context.easePixelShift(goal, 0, ms / dur);
        assert.ok(next <= back && next >= 0);
        back = next;
    }
    assert.equal(back, 0);
});

test("covering menus keep the settlement camera offset", () => {
    const pauseSrc = fs.readFileSync(require.resolve("../js/scene/pause.js"), "utf8");
    vm.runInContext(pauseSrc, context);
    const bg = { lineWidth: 2, displayWidth: 300, width: 300 };
    const scene = (rootVisible, open) => ({
        player: {
            x: 100,
            y: 80,
            bodyCenter() { return { x: 100, y: 80 }; }
        },
        cameras: { main: { width: 1512, height: 901, zoom: 3 } },
        worldZoom: 3,
        game: { loop: { frame: null, delta: 700 } },
        settlementPanel: {
            visible: open,
            root: { visible: rootVisible, x: 16 },
            bg
        }
    });
    const focus = (rootVisible, open) => context.SceneMainPause._cameraFocus.call(scene(rootVisible, open));
    const shown = focus(true, true);
    const covered = focus(false, true);
    const closed = focus(false, false);
    assert.equal(covered.x, shown.x);
    assert.notEqual(closed.x, shown.x);
    assert.ok(shown.x < 100);
});

test("settler follow releases when the player leaves that view", () => {
    const pauseSrc = fs.readFileSync(require.resolve("../js/scene/pause.js"), "utf8");
    vm.runInContext(pauseSrc, context);
    const cam = { width: 300, height: 180, zoom: 3 };
    const player = { x: 0, y: 0, active: true };
    const settler = { x: 40, y: 0, active: true };
    const off = (focus) => context.SceneMainPause._playerOffFocusedView(player, focus, cam, 3);
    assert.equal(off(settler), false);
    assert.equal(off({ x: 60, y: 0 }), true);
    assert.equal(off({ x: 0, y: 20 }), false);
    assert.equal(off({ x: 0, y: -70 }), true);
});

test("a follower walking with the camera subject does not step backward", () => {
    const z = 3;
    const viewW = 1512;
    const viewH = 901;
    let subject = 200.1;
    let follower = 80.3;
    let prev = null;
    for (let i = 0; i < 48; i++) {
        subject += 0.5;
        follower += 0.5;
        const focusX = Math.round((subject + 8) * z) / z;
        const focusY = Math.round(40 * z) / z;
        const cam = {
            scrollX: focusX - viewW / 2,
            scrollY: focusY - viewH / 2,
            width: viewW,
            height: viewH,
            zoom: z
        };
        context.snapCameraScrollToPixels(cam, z);
        const subjectSnap = context.snapWorldToScreenPixel(cam, subject, 100, z);
        const placed = context.snapWorldOffsetToSubject(
            subjectSnap,
            { x: subject, y: 100 },
            { x: follower, y: 100 },
            z
        );
        const sx = screenOf(placed.x, cam.scrollX, viewW, z);
        const sy = screenOf(placed.y, cam.scrollY, viewH, z);
        assert.ok(Math.abs(sx - Math.round(sx)) < 1e-6, `x ${sx}`);
        assert.ok(Math.abs(sy - Math.round(sy)) < 1e-6, `y ${sy}`);
        if (prev != null) assert.equal(sx, prev);
        prev = sx;
    }
});

test("sprite snap matches the camera grid", () => {
    const cam = { scrollX: 3, scrollY: 9, width: 1001, height: 777, zoom: 3 };
    context.snapCameraScrollToPixels(cam, 3);
    const p = context.snapWorldToScreenPixel(cam, 48.2, 90.7, 3);
    const sy = screenOf(p.y, cam.scrollY, cam.height, 3);
    const sx = screenOf(p.x, cam.scrollX, cam.width, 3);
    assert.ok(Math.abs(sy - Math.round(sy)) < 1e-6);
    assert.ok(Math.abs(sx - Math.round(sx)) < 1e-6);
});
