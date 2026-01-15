localStorage.clear();

var config = {
    type: Phaser.WEBGL,
    width: 1024,
    height: 768,
    backgroundColor: "black",
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
