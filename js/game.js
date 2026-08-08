localStorage.clear();

var config = {
    type: Phaser.WEBGL,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "black",
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
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
        SceneMain
    ],
    pixelArt: true,
    roundPixels: true
};

var game = new Phaser.Game(config);
