const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");

const context = {};
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(require.resolve("../js/Utils.js"), "utf8")
    + "\nthis.lieQuarterTurns = lieQuarterTurns;\n"
    + "this.pixelLieScale = pixelLieScale;\n"
    + "this.rotatePixelsCW = rotatePixelsCW;\n"
    + "this.syncLyingDraw = syncLyingDraw;\n"
    + "this.setCreatureProne = setCreatureProne;\n"
    + "this.setCreatureRest = setCreatureRest;\n"
    + "this.lyingSortDepth = lyingSortDepth;\n"
    + "this.corpseSortDepth = corpseSortDepth;\n"
    + "this.creatureSortDepth = creatureSortDepth;\n"
    + "this.frameLocalCut = frameLocalCut;\n",
    context
);

test("downed pose is a clockwise quarter-turn of the right-facing frame", () => {
    assert.equal(context.lieQuarterTurns(-Math.PI / 2), 3);
    assert.equal(context.lieQuarterTurns(Math.PI / 2), 1);
    assert.equal(context.lieQuarterTurns(Math.PI), 2);
    assert.equal(context.lieQuarterTurns(0), 0);
    assert.equal(context.lieQuarterTurns(Math.PI * 2), 0);
});

test("a downed body sorts at its near edge, in front of a prop on that line", () => {
    // Feet-anchored puppet: y is the south edge. A rock at that y sorts behind.
    assert.equal(context.lyingSortDepth(-16, 16, false), -15);
    assert.ok(context.lyingSortDepth(-16, 16, false) > -16);
    // Corpse y is the body center. South edge is 8px lower.
    assert.equal(context.lyingSortDepth(-20, 16, true), -11);
    assert.equal(context.lyingSortDepth(8, 16, false), 9);
});

test("a corpse stays at its near edge until a person overlaps it", () => {
    const body = { x: 0, y: 0, w: 16, h: 16, centered: true };
    assert.equal(context.corpseSortDepth(body, []), context.lyingSortDepth(0, 16, true));
    // Beside the body: still in front of a prop on the south edge.
    assert.equal(context.corpseSortDepth(body, [
        { x: 40, y: 0, w: 16, h: 16, centerX: false }
    ]), 9);
    // Standing on the body: just behind their feet, so they draw on top.
    const onTop = context.corpseSortDepth(body, [
        { x: -4, y: 0, w: 16, h: 16, centerX: false }
    ]);
    assert.equal(onTop, -0.5);
    assert.ok(onTop < 0);
    // Already south of the near edge: leave the prop sort alone.
    assert.equal(context.corpseSortDepth(body, [
        { x: -4, y: 20, w: 16, h: 16, centerX: false }
    ]), 9);
});

test("creature sort treats a corpse as ground under an overlapping settler", () => {
    const settler = {
        active: true,
        x: -4,
        y: 0,
        width: 16,
        height: 16,
        originX: 0,
        originY: 1
    };
    const corpse = {
        _corpse: true,
        x: 0,
        y: 0,
        width: 16,
        height: 16,
        originX: 0.5,
        originY: 0.5,
        scene: { player: null, party: [], settlers: [settler] }
    };
    assert.equal(
        context.creatureSortDepth(corpse, { prone: true, centered: true, y: 0, height: 16 }),
        -0.5
    );
});

test("lying scale covers an even number of screen pixels", () => {
    const z = 3;
    for (const scale of [1, 0.85, 0.5]) {
        const vis = context.pixelLieScale(scale, z);
        const screen = 16 * vis * z;
        assert.ok(Math.abs(screen - Math.round(screen)) < 1e-9, `screen ${screen}`);
        assert.equal(Math.round(screen) % 2, 0);
    }
    assert.equal(context.pixelLieScale(1, 3), 1);
    const bed = 16 * context.pixelLieScale(0.85, 3) * 3;
    assert.equal(Math.round(bed), 40);
});

test("clockwise pixel turn matches a Phaser quarter rotation", () => {
    const n = 2;
    const src = new Uint8ClampedArray([
        1, 0, 0, 255,  2, 0, 0, 255,
        3, 0, 0, 255,  4, 0, 0, 255
    ]);
    const turned = context.rotatePixelsCW(src, n, 1);
    assert.equal(turned[0], 3);
    assert.equal(turned[4], 1);
    assert.equal(turned[8], 4);
    assert.equal(turned[12], 2);
    const back = context.rotatePixelsCW(turned, n, 3);
    assert.equal(back[0], 1);
    assert.equal(back[4], 2);
    assert.equal(back[8], 3);
    assert.equal(back[12], 4);
    const downed = context.rotatePixelsCW(src, n, 3);
    assert.equal(downed[0], 2);
    assert.equal(downed[4], 4);
    assert.equal(downed[8], 1);
    assert.equal(downed[12], 3);
});

function fakeSprite() {
    return {
        x: 10,
        y: 20,
        texture: {
            key: "human",
            frameTotal: 12,
            has(name) { return name === 7 || name === "7"; },
            get() { return null; }
        },
        frame: { name: 4 },
        rotation: 0,
        originX: 0,
        originY: 1,
        scaleX: 1,
        scaleY: 1,
        anims: { isPlaying: false, stop() { this.isPlaying = false; } },
        scene: {
            worldZoom: 3,
            textures: {
                get() { return null; },
                exists() { return false; }
            }
        },
        setRotation(a) { this.rotation = a; },
        setOrigin(x, y) { this.originX = x; this.originY = y; },
        setScale(s) { this.scaleX = this.scaleY = s; },
        setTexture(key, frame) {
            this.texture = { ...this.texture, key };
            this.frame = { name: frame };
        },
        setFrame(frame) { this.frame = { name: frame }; },
        setVelocity() {},
        clearTint() {}
    };
}

test("lying down keeps the feet and falls back to rotation without a canvas", () => {
    const sprite = fakeSprite();
    context.setCreatureProne(sprite, true);
    assert.equal(sprite.x, 18);
    assert.equal(sprite.y, 12);
    assert.equal(sprite.originX, 0.5);
    assert.equal(sprite.originY, 0.5);
    assert.equal(sprite._prone, true);
    assert.equal(sprite.rotation, -Math.PI / 2);
    context.setCreatureProne(sprite, true);
    assert.equal(sprite.x, 18);
    assert.equal(sprite.y, 12);
    context.setCreatureProne(sprite, false);
    assert.equal(sprite.x, 10);
    assert.equal(sprite.y, 20);
    assert.equal(sprite.originX, 0);
    assert.equal(sprite.originY, 1);
    assert.equal(sprite.rotation, 0);
    assert.equal(sprite._prone, false);
});

test("a bunk pose quantizes scale and does not rotate the quad when the turn is baked", () => {
    const sprite = fakeSprite();
    const made = [];
    sprite.scene.textures = {
        exists(key) { return made.includes(key); },
        get(key) {
            if (key !== "human") return null;
            return {
                has(name) { return name === 7 || name === "7"; },
                get() {
                    return { name: 7, cutX: 16, cutY: 32, cutWidth: 16, cutHeight: 16, sourceIndex: 0 };
                },
                source: [{ image: {} }]
            };
        },
        addCanvas(key) {
            made.push(key);
            return { key, setFilter() {} };
        }
    };
    context.document = {
        createElement() {
            return {
                width: 0,
                height: 0,
                getContext() {
                    return {
                        imageSmoothingEnabled: true,
                        drawImage() {},
                        getImageData() {
                            return { data: new Uint8ClampedArray(16 * 16 * 4) };
                        },
                        putImageData() {}
                    };
                }
            };
        }
    };
    context.Sleep = {
        SCALE: 0.85,
        restRotation() { return -Math.PI / 2; }
    };
    try {
        context.setCreatureRest(sprite, true, 180, { sleep: {} });
        assert.equal(sprite.rotation, 0);
        assert.equal(sprite._prone, true);
        assert.equal(sprite._resting, true);
        assert.equal(sprite.texture.key, "human__lieq3__7");
        assert.equal(sprite.scaleX, context.pixelLieScale(0.85, 3));
        assert.equal(sprite.x, 18);
        assert.equal(sprite.y, 12);
        context.setCreatureRest(sprite, true, 180, { sleep: {} });
        assert.equal(made.length, 1);
        assert.equal(sprite.texture.key, "human__lieq3__7");
    } finally {
        delete context.document;
        delete context.Sleep;
    }
});

test("a packed frame keeps its cut inside the original image", () => {
    const packed = context.frameLocalCut({
        _cpLocalX: 16,
        _cpLocalY: 32,
        cutX: 17,
        cutY: 133,
        cutWidth: 16,
        cutHeight: 16
    });
    assert.equal(packed.x, 16);
    assert.equal(packed.y, 32);
    assert.equal(packed.w, 16);
    assert.equal(packed.h, 16);
    const plain = context.frameLocalCut({
        cutX: 16,
        cutY: 32,
        width: 16,
        height: 16
    });
    assert.equal(plain.x, 16);
    assert.equal(plain.y, 32);
});

test("lying bake crops the sheet the frame points at", () => {
    const drawn = [];
    const atlas = { width: 1024, height: 1024 };
    const sheet = { width: 48, height: 64 };
    const frame = {
        name: "7",
        cutX: 17,
        cutY: 133,
        cutWidth: 16,
        cutHeight: 16,
        sourceIndex: 0,
        source: { image: atlas }
    };
    const sprite = fakeSprite();
    sprite.scene.textures = {
        exists() { return false; },
        get() {
            return {
                has(name) { return name === 7 || name === "7"; },
                get() { return frame; },
                source: [{ image: sheet }],
                getSourceImage() { return sheet; }
            };
        },
        addCanvas() { return { setFilter() {} }; }
    };
    context.document = {
        createElement() {
            return {
                width: 0,
                height: 0,
                getContext() {
                    return {
                        imageSmoothingEnabled: true,
                        drawImage(...args) { drawn.push(args); },
                        getImageData() {
                            return { data: new Uint8ClampedArray(16 * 16 * 4) };
                        },
                        putImageData() {}
                    };
                }
            };
        }
    };
    try {
        context.syncLyingDraw(sprite, -Math.PI / 2, 1);
        assert.equal(drawn.length, 1);
        assert.equal(drawn[0][0], atlas);
        assert.equal(drawn[0][1], 17);
        assert.equal(drawn[0][2], 133);
        assert.equal(sprite.texture.key, "human__lieq3__7");
    } finally {
        delete context.document;
    }
});
