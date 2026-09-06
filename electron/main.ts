import { app, BrowserWindow, ipcMain, shell, safeStorage, clipboard } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import dotenv from "dotenv";

const isDev = !app.isPackaged;
let apiBase = process.env.TRADEHOLE_API_URL ?? "http://127.0.0.1:3169";
let apiChild: ChildProcess | null = null;
let ironsightChild: ChildProcess | null = null;
/** True only when Electron spawned IRONSIGHT (do not kill a pre-existing instance). */
let ironsightOwned = false;
let ironsightRestartAttempt = 0;
let ironsightRestartTimer: ReturnType<typeof setTimeout> | null = null;
let quitting = false;
let mainWindow: BrowserWindow | null = null;

const IRONSIGHT_DEFAULT_PORT = 3170;

app.setName("Tradehole");

function userEnvPath(): string {
  return path.join(app.getPath("userData"), ".env");
}

function loadEnv(): void {
  const candidates = [
    userEnvPath(),
    path.join(process.cwd(), ".env"),
    path.join(app.getAppPath(), ".env"),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
}

function tokenStorePath(): string {
  return path.join(app.getPath("userData"), "etrade-tokens.enc");
}

function saveTokens(tokens: { accessToken: string; accessTokenSecret: string }): void {
  const payload = JSON.stringify(tokens);
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(payload);
    fs.writeFileSync(tokenStorePath(), encrypted);
  } else {
    fs.writeFileSync(tokenStorePath() + ".json", payload, { mode: 0o600 });
  }
}

function loadTokens(): { accessToken: string; accessTokenSecret: string } | null {
  try {
    const encPath = tokenStorePath();
    const jsonPath = encPath + ".json";
    if (fs.existsSync(encPath) && safeStorage.isEncryptionAvailable()) {
      const buf = fs.readFileSync(encPath);
      return JSON.parse(safeStorage.decryptString(buf));
    }
    if (fs.existsSync(jsonPath)) {
      return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clearTokens(): void {
  for (const p of [tokenStorePath(), tokenStorePath() + ".json"]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

async function waitForApi(url: string, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`API did not become ready at ${url}`);
}

function apiEntryPath(): string {
  if (isDev) {
    return path.join(__dirname, "../dist-server/index.js");
  }
  return path.join(process.resourcesPath, "api", "index.js");
}

async function ensureApi(): Promise<void> {
  const port = Number(process.env.PORT ?? 3169);
  apiBase = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${apiBase}/api/health`);
    if (res.ok) return;
  } catch {
    /* start our own */
  }

  const entry = apiEntryPath();
  if (!fs.existsSync(entry)) {
    throw new Error(`API entry not found: ${entry}`);
  }

  const envPath = fs.existsSync(userEnvPath())
    ? userEnvPath()
    : path.join(process.cwd(), ".env");

  apiChild = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      DOTENV_CONFIG_PATH: envPath,
      TRADEHOLE_DATA_DIR: app.getPath("userData"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  apiChild.stdout?.on("data", (buf) => console.log(String(buf).trimEnd()));
  apiChild.stderr?.on("data", (buf) => console.error(String(buf).trimEnd()));
  apiChild.on("exit", (code) => {
    console.error(`[tradehole] API process exited (${code})`);
    apiChild = null;
  });

  await waitForApi(apiBase);
}

function ironsightBaseUrl(): string {
  return (process.env.IRONSIGHT_URL ?? `http://127.0.0.1:${IRONSIGHT_DEFAULT_PORT}`).replace(
    /\/$/,
    "",
  );
}

function ironsightPort(): number {
  try {
    const u = new URL(ironsightBaseUrl());
    if (u.port) return Number(u.port);
  } catch {
    /* fall through */
  }
  return IRONSIGHT_DEFAULT_PORT;
}

function augmentedPath(): string {
  const home = os.homedir();
  const extras = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local/bin"),
  ];
  const current = process.env.PATH ?? "";
  const parts = [...extras, ...current.split(path.delimiter).filter(Boolean)];
  return [...new Set(parts)].join(path.delimiter);
}

function findNodeBinary(): string | null {
  const candidates = [
    process.env.TRADEHOLE_NODE_PATH,
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    path.join(os.homedir(), ".local/bin/node"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveIronsightPath(): string | null {
  const configured =
    process.env.TRADEHOLE_IRONSIGHT_PATH ?? process.env.IRONSIGHT_PATH ?? "";
  const tradeholeRoot = path.resolve(__dirname, "..");
  const bases = [
    process.cwd(),
    tradeholeRoot,
    path.resolve(tradeholeRoot, ".."),
    path.join(os.homedir(), "Documents/GitHub/tradehole"),
    path.join(os.homedir(), "Documents/GitHub"),
    os.homedir(),
  ];

  const candidates: string[] = [];
  if (configured.trim()) {
    if (path.isAbsolute(configured)) {
      candidates.push(configured);
    } else {
      for (const base of bases) {
        candidates.push(path.resolve(base, configured));
      }
    }
  }

  candidates.push(
    path.resolve(tradeholeRoot, "../IRONSIGHT"),
    path.join(os.homedir(), "Documents/GitHub/IRONSIGHT"),
    path.join(os.homedir(), "Documents/IRONSIGHT"),
    path.join(os.homedir(), "GitHub/IRONSIGHT"),
    path.join(os.homedir(), "src/IRONSIGHT"),
    path.join(os.homedir(), "dev/IRONSIGHT"),
  );

  const seen = new Set<string>();
  for (const p of candidates) {
    const abs = path.resolve(p);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (fs.existsSync(path.join(abs, "package.json"))) return abs;
  }
  return null;
}

async function probeIronsight(url: string, attempts = 1): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function clearIronsightRestart(): void {
  if (ironsightRestartTimer) {
    clearTimeout(ironsightRestartTimer);
    ironsightRestartTimer = null;
  }
}

function scheduleIronsightRestart(): void {
  if (quitting || !ironsightOwned) return;
  clearIronsightRestart();
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(ironsightRestartAttempt, 5));
  ironsightRestartAttempt += 1;
  console.log(
    `[tradehole] IRONSIGHT exited — restarting in ${delay}ms (attempt ${ironsightRestartAttempt})`,
  );
  ironsightRestartTimer = setTimeout(() => {
    ironsightRestartTimer = null;
    void ensureIronsight();
  }, delay);
}

function spawnIronsight(ironsightPath: string): void {
  const port = ironsightPort();
  const nextCli = path.join(ironsightPath, "node_modules/next/dist/bin/next");
  const nodeBin = findNodeBinary();
  const env = {
    ...process.env,
    PATH: augmentedPath(),
    PORT: String(port),
  };

  console.log(`[tradehole] starting IRONSIGHT… (${ironsightPath} on :${port})`);

  if (nodeBin && fs.existsSync(nextCli)) {
    ironsightChild = spawn(nodeBin, [nextCli, "dev", "-p", String(port)], {
      cwd: ironsightPath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    // Fallback: shell npm (works when launched from a terminal with nvm/fnm)
    ironsightChild = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
      cwd: ironsightPath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
  }

  ironsightOwned = true;
  ironsightChild.stdout?.on("data", (buf) => console.log(`[ironsight] ${String(buf).trimEnd()}`));
  ironsightChild.stderr?.on("data", (buf) => console.error(`[ironsight] ${String(buf).trimEnd()}`));
  ironsightChild.on("exit", (code, signal) => {
    console.error(
      `[tradehole] IRONSIGHT exited code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
    ironsightChild = null;
    if (!quitting && ironsightOwned) {
      scheduleIronsightRestart();
    } else {
      ironsightOwned = false;
    }
  });
}

/**
 * Keep IRONSIGHT up while Tradehole is open.
 * - If already responding on IRONSIGHT_URL, leave it alone (not owned).
 * - Otherwise spawn sibling/env path and auto-restart on unexpected exit.
 */
async function ensureIronsight(): Promise<void> {
  if (quitting) return;
  const url = ironsightBaseUrl();

  const up = await probeIronsight(url, 1);
  if (up) {
    console.log(`[tradehole] IRONSIGHT already up at ${url} (not owned)`);
    ironsightOwned = false;
    ironsightRestartAttempt = 0;
    return;
  }

  if (ironsightChild && !ironsightChild.killed) return;

  const ironsightPath = resolveIronsightPath();
  if (!ironsightPath) {
    console.warn(
      "[tradehole] IRONSIGHT not found — set IRONSIGHT_PATH or TRADEHOLE_IRONSIGHT_PATH " +
        "(absolute path recommended for packaged .app) in Application Support .env, " +
        "or clone sibling ../IRONSIGHT and npm install there.",
    );
    return;
  }

  if (!fs.existsSync(path.join(ironsightPath, "node_modules"))) {
    console.warn(
      `[tradehole] IRONSIGHT at ${ironsightPath} has no node_modules — run npm install there first.`,
    );
    return;
  }

  spawnIronsight(ironsightPath);

  // Warm probe in background; reset backoff once healthy
  void (async () => {
    const ready = await probeIronsight(url, 60);
    if (ready) {
      console.log(`[tradehole] IRONSIGHT ready at ${url}`);
      ironsightRestartAttempt = 0;
    } else if (!quitting) {
      console.warn(`[tradehole] IRONSIGHT did not become ready at ${url}`);
    }
  })();
}

function appIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, "../build/icon.png"),
    path.join(process.resourcesPath, "icon.png"),
    path.join(app.getAppPath(), "build/icon.png"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function createWindow(): void {
  const icon = appIconPath();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Tradehole — FRO Monitor",
    backgroundColor: "#0c1210",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (icon && process.platform === "darwin") {
    app.dock?.setIcon(icon);
  }

  if (isDev) {
    void mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  loadEnv();

  try {
    if (!isDev) {
      await ensureApi();
    } else {
      // Dev expects separately started server; still probe default
      try {
        await waitForApi(apiBase, 8);
      } catch {
        console.warn("[tradehole] dev API not up yet — start with npm run dev");
      }
    }
  } catch (err) {
    console.error(err);
  }

  createWindow();

  // OSINT companion — do not block the window on Next.js boot
  void ensureIronsight();

  ipcMain.handle("api:base", () => apiBase);
  ipcMain.handle("runtime:info", () => {
    let buildTime =
      process.env.TRADEHOLE_BUILD_TIME ??
      process.env.npm_package_buildTime ??
      "";
    if (!buildTime) {
      try {
        const pkgPath = path.join(app.getAppPath(), "package.json");
        buildTime = fs.statSync(pkgPath).mtime.toISOString();
      } catch {
        buildTime = new Date(0).toISOString();
      }
    }
    return {
      packaged: app.isPackaged,
      buildTime,
      version: app.getVersion(),
      mode: app.isPackaged ? ("packaged" as const) : ("dev" as const),
    };
  });
  ipcMain.handle("tokens:load", () => loadTokens());
  ipcMain.handle("tokens:save", (_e, tokens: { accessToken: string; accessTokenSecret: string }) => {
    saveTokens(tokens);
    return true;
  });
  ipcMain.handle("tokens:clear", () => {
    clearTokens();
    return true;
  });
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    void shell.openExternal(url);
  });
  ipcMain.handle("clipboard:writeText", (_e, text: string) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });
  ipcMain.handle("window:alertOrderFill", (_e, urgent: boolean) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    if (!win) return;
    if (urgent) {
      win.show();
      win.focus();
      win.flashFrame(true);
      if (process.platform === "darwin") {
        app.dock?.bounce("critical");
      }
    } else {
      win.flashFrame(true);
      if (process.platform === "darwin") {
        app.dock?.bounce("informational");
      }
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
  clearIronsightRestart();
  if (apiChild && !apiChild.killed) {
    apiChild.kill();
  }
  if (ironsightOwned && ironsightChild && !ironsightChild.killed) {
    console.log("[tradehole] stopping owned IRONSIGHT child");
    ironsightChild.kill();
    ironsightChild = null;
    ironsightOwned = false;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
