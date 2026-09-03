/**
 * Launch the Electron binary with ELECTRON_RUN_AS_NODE cleared.
 * Some editor/agent shells set that flag, which makes `electron .` run as Node
 * and require("electron") return a path string instead of the API.
 */
const { spawn } = require("child_process");
const path = require("path");

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ATOM_SHELL_INTERNAL_RUN_AS_NODE;

/** Chromium on macOS spam — not game failures. */
const GPU_NOISE = /ProduceOverlay|Invalid mailbox|skia_output_device_buffer_queue/;

const electronPath = require("electron");
const appRoot = path.join(__dirname, "..");
const child = spawn(electronPath, [appRoot, ...process.argv.slice(2)], {
    stdio: ["inherit", "inherit", "pipe"],
    env: process.env
});
child.stderr.on("data", (buf) => {
    const text = buf.toString();
    const kept = text.split("\n").filter((line) => line.length && !GPU_NOISE.test(line));
    if (!kept.length) return;
    process.stderr.write(kept.join("\n") + (text.endsWith("\n") ? "\n" : ""));
});
child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
});
