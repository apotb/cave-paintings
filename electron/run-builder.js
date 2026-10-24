delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ATOM_SHELL_INTERNAL_RUN_AS_NODE;

const path = require("path");
const { spawn } = require("child_process");
const cli = require.resolve("electron-builder/cli.js");
const allowHotfix = path.join(__dirname, "..", "scripts", "electron-builder-version.js");
const child = spawn(process.execPath, ["-r", allowHotfix, cli, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env
});
child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
});
