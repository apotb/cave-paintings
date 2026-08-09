/**
 * Scared animal: calm wander, panics and flees when hit.
 */
class ScaredAnimalAI extends DoofusAI {
    constructor(mob) {
        super(mob);
        this.panicMs = 0;
        this.PANIC_DURATION = 10000;
        this.PANIC_PLAYER_RANGE = 5;
        this.PANIC_SPEED_MULT = 3.6;
        this.PANIC_FLEE_CHANCE = 0.75;
    }

    onDamaged(_source = null, _opts = null) {
        this.panicMs = this.PANIC_DURATION;
        this._beginPanicDash();
    }

    update(delta) {
        const mob = this.mob;
        if (!mob?.active || mob.isBodyDead?.()) return;

        if (this.panicMs > 0) {
            this._updatePanic(delta);
            return;
        }
        super.update(delta);
    }

    _updatePanic(delta) {
        const mob = this.mob;
        const player = mob.scene.player;
        const ts = mob.scene.tileSize || 16;

        if (player) {
            const distTiles = Math.hypot(
                (mob.x - player.x) / ts,
                (mob.y - player.y) / ts
            );
            if (distTiles > this.PANIC_PLAYER_RANGE) this.panicMs -= delta;
        } else {
            this.panicMs -= delta;
        }

        if (this.panicMs <= 0) {
            this.panicMs = 0;
            mob.anims.timeScale = 1;
            this._beginIdle();
            return;
        }

        this.timer -= delta;
        if (this.timer <= 0) this._beginPanicDash();
        this._applyWalk(this.PANIC_SPEED_MULT);
    }

    _beginPanicDash() {
        this.state = "walk";
        const dirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        let pick = null;
        const player = this.mob.scene.player;
        if (player && Math.random() < this.PANIC_FLEE_CHANCE) {
            let fx = this.mob.x - player.x;
            let fy = this.mob.y - player.y;
            const flen = Math.hypot(fx, fy);
            if (flen > 0.001) {
                fx /= flen;
                fy /= flen;
                const weights = dirs.map(([dx, dy]) => {
                    const len = Math.hypot(dx, dy) || 1;
                    const align = (dx / len) * fx + (dy / len) * fy;
                    return Math.max(0.08, align + 1);
                });
                pick = this._weightedPick(dirs, weights);
            }
        }
        if (!pick) pick = Phaser.Utils.Array.GetRandom(dirs);
        this.dirX = pick[0];
        this.dirY = pick[1];
        this.timer = Phaser.Math.Between(120, 350);
    }

    _weightedPick(items, weights) {
        let total = 0;
        for (const w of weights) total += w;
        let r = Math.random() * total;
        for (let i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
        }
        return items[items.length - 1];
    }
}
