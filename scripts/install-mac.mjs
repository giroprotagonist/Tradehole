#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const arch = process.arch === "arm64" ? "mac-arm64" : "mac";
const builtApp = path.join(root, "release", arch, "Tradehole.app");
const destApp = "/Applications/Tradehole.app";
const userData = path.join(
  process.env.HOME ?? "",
  "Library/Application Support/Tradehole",
);
const envSrc = path.join(root, ".env");
const envDest = path.join(userData, ".env");

if (!fs.existsSync(builtApp)) {
  console.error(`Built app not found at ${builtApp}`);
  process.exit(1);
}

console.log(`Installing ${builtApp} → ${destApp}`);

if (fs.existsSync(destApp)) {
  fs.rmSync(destApp, { recursive: true, force: true });
}

execSync(`cp -R "${builtApp}" "${destApp}"`, { stdio: "inherit" });

// Clear quarantine so Gatekeeper doesn't block an unsigned local build
try {
  execSync(`xattr -cr "${destApp}"`, { stdio: "inherit" });
} catch {
  console.warn("Could not clear quarantine attributes (xattr).");
}

fs.mkdirSync(userData, { recursive: true });
if (fs.existsSync(envSrc)) {
  fs.copyFileSync(envSrc, envDest);
  fs.chmodSync(envDest, 0o600);
  console.log(`Copied E*TRADE config → ${envDest}`);
} else {
  console.warn(`No .env found at ${envSrc}; add keys to ${envDest}`);
}

console.log("\nInstalled. Open with:");
console.log("  open -a Tradehole");
console.log("Or from Applications → Tradehole");
