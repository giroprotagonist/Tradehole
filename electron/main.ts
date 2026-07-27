import { app, BrowserWindow, ipcMain, shell, safeStorage } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import dotenv from "dotenv";

const isDev = !app.isPackaged;
let apiBase = process.env.TRADEHOLE_API_URL ?? "http://127.0.0.1:3169";
let apiChild: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Tradehole — FRO Monitor",
    backgroundColor: "#0c1210",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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

  ipcMain.handle("api:base", () => apiBase);
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  if (apiChild && !apiChild.killed) {
    apiChild.kill();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
