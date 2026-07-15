import fs from "node:fs/promises";

await Promise.all([
  fs.rm("dist", { recursive: true, force: true }),
  fs.rm(".tmp-test", { recursive: true, force: true }),
]);
