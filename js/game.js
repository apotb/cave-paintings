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
