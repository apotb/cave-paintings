/**
 * Harmless wander AI: idle pauses alternating with short random walks.
 * No reaction to damage or the player.
 */
class DoofusAI {
    constructor(mob) {
        this.mob = mob;
        this.state = "idle";
        this.timer = 0;
        this.dirX = 0;
        this.dirY = 0;
        this._beginIdle();
    }

    update(delta) {
        const mob = this.mob;
        if (!mob?.active || mob.isBodyDead?.() || mob.hp <= 0) return;
        // Capacities are refreshed before AI each frame — stay put while downed
        if (mob.isImmobile?.() || mob.isIncapacitated?.()) {
            mob.setVelocity(0, 0);
            return;
        }

        this.timer -= delta;
        if (this.timer <= 0) {
            if (this.state === "idle") this._beginWalk();
            else this._beginIdle();
        }

        if (this.state === "walk") {
            this._applyWalk(1);
        } else {
            mob.setVelocity(0, 0);
            mob.anims.timeScale = 1;
            mob.playAnim(`idle-${mob.facing}`);
        }
    }

    /** Chill roam speed; chase/combat should use `def.speed` instead. */
    _wanderBase() {
        const mob = this.mob;
        const w = Number(mob.def?.wanderSpeed);
        if (Number.isFinite(w) && w > 0) return w;
        return Number(mob.def?.speed) || 1;
    }

    /**
     * Walk anims are authored for human walk speed (~3.5 tiles/s at timeScale 1).
     * Scale cadence with actual movement so slow wander doesn't look like a sprint.
     */
    _animTimeScale(tilesPerSec) {
        const human = this.mob.scene.getMob?.("human");
        const ref = Number(human?.speed) || 3.5;
        return Phaser.Math.Clamp(tilesPerSec / ref, 0.2, 2.5);
    }

    _applyWalk(speedMult) {
        const mob = this.mob;
        // Same as player / NeutralAnimal: Moving capacity slows damaged legs
        const moveMul = mob.capacities?.moving
            ? Math.max(0.05, Math.min(1.5, mob.capacities.moving()))
            : 1;
        const tilesPerSec = this._wanderBase() * speedMult * moveMul
            * (mob.scene.terrainSpeedMult?.(mob.x, mob.y - 1) ?? 1);
        const speed = tilesPerSec * mob.scene.tileSize;
        let x = this.dirX;
        let y = this.dirY;
        const len = Math.hypot(x, y) || 1;
        x /= len;
        y /= len;
        mob.setVelocity(x * speed, y * speed);

        if (Math.abs(x) > Math.abs(y)) {
            mob.facing = x > 0 ? "right" : "left";
        } else if (y !== 0) {
            mob.facing = y > 0 ? "down" : "up";
        }
        mob.anims.timeScale = this._animTimeScale(tilesPerSec);
        mob.playAnim(`walk-${mob.facing}`);
    }

    _beginIdle() {
        this.state = "idle";
        this.dirX = 0;
        this.dirY = 0;
        this.timer = Phaser.Math.Between(1000, 3000);
    }

    _beginWalk() {
        this.state = "walk";
        const dirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        const mob = this.mob;
        const homeX = mob.entry?.homeX;
        const homeY = mob.entry?.homeY;
        const ts = mob.scene?.tileSize || 16;
        // Soft leash ~4 tiles (bias home); hard leash ~7 tiles (always walk home)
        const SOFT = 4;
        const HARD = 7;

        let pick = null;
        if (homeX != null && homeY != null) {
            const hx = (homeX - mob.x) / ts;
            const hy = (homeY - mob.y) / ts;
            const dist = Math.hypot(hx, hy);
            if (dist > 0.15) {
                const nx = hx / dist;
                const ny = hy / dist;
                const forceHome = dist >= HARD || (dist >= SOFT && Math.random() < 0.65);
                if (forceHome) {
                    const weights = dirs.map(([dx, dy]) => {
                        const len = Math.hypot(dx, dy) || 1;
                        const align = (dx / len) * nx + (dy / len) * ny;
                        return Math.max(0.05, align + 1);
                    });
                    pick = this._weightedPickDirs(dirs, weights);
                }
            }
        }
        if (!pick) pick = Phaser.Utils.Array.GetRandom(dirs);
        this.dirX = pick[0];
        this.dirY = pick[1];
        this.timer = Phaser.Math.Between(1000, 2000);
    }

    _weightedPickDirs(items, weights) {
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
