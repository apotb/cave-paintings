// Preserve multiplayer player id / menu prefs across reloads
// (legacy code cleared storage every boot — that breaks rejoins)

var config = {
    type: Phaser.WEBGL,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "black",
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        autoRound: true
    },
    render: {
        pixelArt: true,
        antialias: false,
        roundPixels: true,
        powerPreference: "high-performance"
    },
    physics: {
        default: "arcade",
        arcade: {
            debug: false,
            debugShowBody: true,
            debugShowVelocity: true
        }
    },
    scene: [
        SceneMenu,
        SceneNet,
        SceneMain
    ],
    pixelArt: true,
    roundPixels: true
};

var game = new Phaser.Game(config);

/**
 * Phaser 3.88+ suspends then resumes the AudioContext 100ms after the tab
 * becomes visible (iOS 17/18 workaround). On desktop that is an audible hitch.
 * Keep the iOS kick; elsewhere only resume if the context is actually stuck.
 */
function patchPhaserAudioTabHitch(game) {
    const sound = game?.sound;
    if (!sound || sound._cpTabHitchPatched) return;
    sound._cpTabHitchPatched = true;
    sound.pauseOnBlur = false;
    const evt = Phaser.Core?.Events?.VISIBLE || "visible";
    try { game.events.off(evt, sound.onGameVisible, sound); } catch (_) {}
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    sound.onGameVisible = function () {
        const ctx = this.context;
        if (!ctx) return;
        if (ios) {
            window.setTimeout(() => {
                try { ctx.suspend(); } catch (_) {}
                try { ctx.resume(); } catch (_) {}
            }, 100);
            return;
        }
        if (ctx.state === "suspended" || ctx.state === "interrupted") {
            try { ctx.resume(); } catch (_) {}
        }
    };
    try { game.events.on(evt, sound.onGameVisible, sound); } catch (_) {}
}

game.events.once("ready", () => patchPhaserAudioTabHitch(game));
