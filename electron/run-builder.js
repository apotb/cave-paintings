delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ATOM_SHELL_INTERNAL_RUN_AS_NODE;

const { spawn } = require("child_process");
const cli = require.resolve("electron-builder/cli.js");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env
});
child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
});
