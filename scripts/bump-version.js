/**
 * Bump the game version in package.json, package-lock.json, and version.json.
 * Usage: npm run bump --patch|--minor|--major
 * Does not commit or tag.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const LEVELS = ["patch", "minor", "major"];

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(msg) {
    console.error(msg);
    process.exit(1);
}

function envFlag(name) {
    const v = process.env[`npm_config_${name}`];
    return v === "true" || v === "";
}

function pickedLevel() {
    const args = process.argv.slice(2).map((s) => String(s).trim().toLowerCase().replace(/^--/, ""));
    const fromArg = args.find((a) => LEVELS.includes(a));
    if (fromArg) return fromArg;
    const fromEnv = LEVELS.filter((l) => envFlag(l));
    if (fromEnv.length > 1) fail("Pick one of --patch, --minor, or --major");
    return fromEnv[0] || "";
}

const level = pickedLevel();
if (!LEVELS.includes(level)) {
    fail("Usage: npm run bump --patch|--minor|--major");
}

const pkgPath = path.join(ROOT, "package.json");
const verPath = path.join(ROOT, "version.json");
const from = String(readJson(pkgPath).version || "").trim();
if (!from) fail("package.json has no version");
const jsonVer = String(readJson(verPath).version || "").trim();
if (jsonVer !== from) {
    fail(`version.json (${jsonVer}) does not match package.json (${from})`);
}

const env = { ...process.env };
for (const name of LEVELS) delete env[`npm_config_${name}`];

const result = spawnSync("npm", ["version", level, "--no-git-tag-version"], {
    cwd: ROOT,
    env,
    stdio: "inherit"
});
if (result.status !== 0) process.exit(result.status || 1);

const next = String(readJson(pkgPath).version || "").trim();
if (!next) fail("npm version did not update package.json");
fs.writeFileSync(verPath, `${JSON.stringify({ version: next }, null, 2)}\n`);
console.log(`${from} → ${next}`);
