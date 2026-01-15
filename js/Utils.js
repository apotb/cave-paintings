/**
 * Returns the SceneMain object.
 * @return  {Player}        Player object.
 */
function getScene() {
    return game.scene.scenes[0];
}

/**
 * Returns the player object.
 * @return  {Player}        Player object.
 */
function getPlayer() {
    return getScene().player;
}

/**
 * Returns the number of chunks.
 * @return  {Number}        Number of chunks.
 */
function numChunks() {
    return Object.values(getScene().chunks).length;
}

/**
 * ( ͡° ͜ʖ ͡°)
 */
function superChunkLoadingMachine() {
    const player = getScene().player;
    player.speed = 3.5 * 30;
    player.keys.S.isDown = true;
}

/**
 * Round up to the nearest even number.
 * @param   {Number} num    Number to round up.
 * @return  {Number}        The rounded number.
 */
function roundUpToEven(num) {
    let x = Math.ceil(num);
    return (x % 2 === 0) ? x : x + 1;
}

/**
 * Mulberry32 pseudorandom number generator
 * @param  {Number} a  The seed value (32-bit integer)
 * @return {Function}  A function that, when called, returns a
 *                     deterministic pseudorandom float in [0, 1)
 * @see https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
 */
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

/**
 * Returns a hash code from a string
 * @param  {String} str The string to hash.
 * @return {Number}    A 32bit integer
 * @see http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
 */
function hashCode(str) {
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        let chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

/**
 * Thomas Wang's 32-bit integer hash functions
 * @param  {Number} x    The X coordinate
 * @param  {Number} y    The Y coordinate
 * @param  {Number} seed A world seed to offset results
 * @return {Number}      A 32-bit unsigned integer
 * @see http://web.archive.org/web/20071223173210/http://www.cris.com/~Ttwang/tech/inthash.htm
 */
function hash2D(x, y, seed) {
    let h = x * 374761393 + y * 668265263 + seed * 0x9e3779b1;
    h = (h ^ (h >> 13)) * 1274126177;
    h ^= h >> 16;
    return h >>> 0;
}

/**
 * Formats a number of hours into "Xd Yh" or "Xh".
 * @param   {Number} hours  The number of hours.
 * @return  {String}        A formatted string (e.g. "5d 3h", "12h").
 */
function formatHours(hours) {
    const h = Math.max(0, Math.floor(hours));
    const d = Math.floor(h / 24);
    const remH = h % 24;
    if (d > 0) return `${d}d${remH ? ` ${remH}h` : ""}`;
    return `${remH}h`;
}