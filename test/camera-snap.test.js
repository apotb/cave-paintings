const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");

const context = {};
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(require.resolve("../js/Utils.js"), "utf8")
    + "\nthis.cameraPixelFrac = cameraPixelFrac;\n"
    + "this.snapCameraScrollToPixels = snapCameraScrollToPixels;\n"
    + "this.snapWorldToScreenPixel = snapWorldToScreenPixel;\n",
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

test("sprite snap matches the camera grid", () => {
    const cam = { scrollX: 3, scrollY: 9, width: 1001, height: 777, zoom: 3 };
    context.snapCameraScrollToPixels(cam, 3);
    const p = context.snapWorldToScreenPixel(cam, 48.2, 90.7, 3);
    const sy = screenOf(p.y, cam.scrollY, cam.height, 3);
    const sx = screenOf(p.x, cam.scrollX, cam.width, 3);
    assert.ok(Math.abs(sy - Math.round(sy)) < 1e-6);
    assert.ok(Math.abs(sx - Math.round(sx)) < 1e-6);
});
