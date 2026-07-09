import { readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

const version = String(packageJson.version ?? "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Expected package.json version to use x.y.z SemVer, got '${version}'`);
}

const minAppVersion = String(manifest.minAppVersion ?? "");
if (!minAppVersion) {
  throw new Error("manifest.json must define minAppVersion");
}

manifest.version = version;
versions[version] = minAppVersion;

writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);
