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

// Packaged .app cwd is not the repo — rewrite relative IRONSIGHT_PATH to absolute
const siblingIronsight = path.resolve(root, "../IRONSIGHT");
if (fs.existsSync(path.join(siblingIronsight, "package.json")) && fs.existsSync(envDest)) {
  let envText = fs.readFileSync(envDest, "utf8");
  const absLine = `IRONSIGHT_PATH=${siblingIronsight}`;
  if (/^IRONSIGHT_PATH=/m.test(envText)) {
    envText = envText.replace(/^IRONSIGHT_PATH=.*$/m, absLine);
  } else {
    envText = `${envText.trimEnd()}\n${absLine}\n`;
  }
  fs.writeFileSync(envDest, envText, { mode: 0o600 });
  console.log(`Set IRONSIGHT_PATH → ${siblingIronsight}`);
} else if (!fs.existsSync(path.join(siblingIronsight, "package.json"))) {
  console.warn(
    `No sibling IRONSIGHT at ${siblingIronsight}. ` +
      `Set absolute IRONSIGHT_PATH in ${envDest} for OSINT auto-start.`,
  );
}

// Packaged API needs absolute TRADEHOLE_ROOT to find news_reader + .venv
if (fs.existsSync(path.join(root, "news_reader")) && fs.existsSync(envDest)) {
  let envText = fs.readFileSync(envDest, "utf8");
  const absRoot = `TRADEHOLE_ROOT=${root}`;
  if (/^TRADEHOLE_ROOT=/m.test(envText)) {
    envText = envText.replace(/^TRADEHOLE_ROOT=.*$/m, absRoot);
  } else {
    envText = `${envText.trimEnd()}\n${absRoot}\n`;
  }
  fs.writeFileSync(envDest, envText, { mode: 0o600 });
  console.log(`Set TRADEHOLE_ROOT → ${root}`);
}

console.log("\nInstalled. Open with:");
console.log("  open -a Tradehole");
console.log("Or from Applications → Tradehole");
console.log("IRONSIGHT auto-starts with the app when IRONSIGHT_PATH resolves.");
