import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const coreDependency = packageJson.dependencies?.["@forge/core"];

if (typeof coreDependency === "string" && coreDependency.startsWith("file:")) {
  const corePath = path.resolve(coreDependency.slice("file:".length));
  const corePackagePath = path.join(corePath, "package.json");

  if (!fs.existsSync(corePackagePath)) {
    throw new Error(`Local @forge/core dependency not found at ${corePath}`);
  }

  execFileSync("npm", ["run", "build"], {
    cwd: corePath,
    stdio: "inherit",
  });
} else {
  const installedCore = path.resolve("node_modules/@forge/core/dist/index.js");
  if (!fs.existsSync(installedCore)) {
    throw new Error("@forge/core is not built or installed. Run npm install first.");
  }
}
