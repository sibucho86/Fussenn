// Runs in bundled standard Node, so SQLite uses the same ABI as the build.
const { join } = require("node:path");
const server = process.argv[2];
process.chdir(server);
process.env.FUSSENN_SERVER_RUNNING = "true";
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  process.emit("SIGTERM");
  setTimeout(() => process.exit(0), 8000).unref();
};
process.on("message", (message) => { if (message === "shutdown") stop(); });
process.on("disconnect", stop);
// Windows descendants can retain an inherited IPC handle after Electron dies.
// Check the original parent as well, so its private server never stays behind.
const parent = process.ppid;
setInterval(() => {
  try { process.kill(parent, 0); }
  catch (error) { if (error.code === "ESRCH") stop(); }
}, 1000).unref();
require(join(server, "server.js"));
