#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const configured = process.env.IRONSIGHT_PATH ?? "../IRONSIGHT";
const ironsightPath = path.isAbsolute(configured)
  ? configured
  : path.resolve(root, configured);

if (!fs.existsSync(path.join(ironsightPath, "package.json"))) {
  console.error(`
IRONSIGHT not found at: ${ironsightPath}

Clone it next to this repo (or set IRONSIGHT_PATH in .env):

  git clone https://github.com/NoblerWorks-HQ/IRONSIGHT.git ../IRONSIGHT
  cd ../IRONSIGHT && npm install

Then re-run: npm run osint
`);
  process.exit(1);
}

console.log(`[osint] starting IRONSIGHT in ${ironsightPath} on :3170`);
const child = spawn("npm", ["run", "dev", "--", "-p", "3170"], {
  cwd: ironsightPath,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    PORT: "3170",
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
