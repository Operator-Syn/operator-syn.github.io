import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmCommand, ["run", "test:e2e", "--", "--project=desktop"], {
  env: { ...process.env, PLAYWRIGHT_LIVE_ASSISTANT: "1" },
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(`[test:e2e:live] failed to start (${error.name})`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`[test:e2e:live] terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
