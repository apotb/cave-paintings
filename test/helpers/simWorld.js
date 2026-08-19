const os = require("os");
const path = require("path");
const { SimWorld, chunkKey } = require("../../server/SimWorld");
const Protocol = require("../../shared/protocol");
const { loadDefs } = require("./load");

loadDefs();

function emptyChunk(cx, cy) {
    return {
        cx,
        cy,
        tiles: [],
        things: [],
        lootableThings: [],
        drops: [],
        mobs: [],
        corpses: [],
        bloodStains: []
    };
}

function emptyPawn(id = "p1") {
    return {
        id,
        name: "Tester",
        x: 32,
        y: 32,
        facing: "down",
        vx: 0,
        vy: 0,
        moveX: 0,
        moveY: 0,
        sprint: false,
        kc: 1200,
        saturation: 0,
        stomach: 1600,
        hunger: 2000,
        inventory: [null, null, null, null, null],
        overflow: [],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
        hotbarIndex: 0,
        hp: 100,
        mhp: 100,
        body: null,
        dead: false,
        prone: false,
        attackTimer: 0,
        attackMax: 0,
        attackAngle: 0,
        connected: true,
        viewChunks: 6,
        poseAuth: true,
        look: null,
        party: [],
        controlId: id,
        ownerId: id
    };
}

/**
 * Tiny in-memory SimWorld: inject origin neighborhood so handleAction
 * does not WorldGen via _ensureChunk.
 */
function createTestWorld(opts = {}) {
    const w = new SimWorld({
        root: opts.root || path.join(os.tmpdir(), "cave-paintings-test"),
        worldName: opts.worldName || "t",
        props: opts.props || {}
    });
    for (let cx = -1; cx <= 1; cx++) {
        for (let cy = -1; cy <= 1; cy++) {
            const key = chunkKey(cx, cy);
            if (!w.chunks.has(key)) w.chunks.set(key, emptyChunk(cx, cy));
        }
    }
    const pawn = emptyPawn(opts.playerId || "p1");
    Object.assign(pawn, opts.pawn || {});
    w.players.set(pawn.id, pawn);
    w._ensurePlayerCreature(pawn);
    return { world: w, pawn, Protocol };
}

function originChunk(world) {
    return world.chunks.get(chunkKey(0, 0));
}

module.exports = {
    chunkKey,
    emptyChunk,
    emptyPawn,
    createTestWorld,
    originChunk
};
