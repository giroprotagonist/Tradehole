import { contextBridge, ipcRenderer } from "electron";

export type StoredTokens = {
  accessToken: string;
  accessTokenSecret: string;
};

const tradehole = {
  getApiBase: (): Promise<string> => ipcRenderer.invoke("api:base"),
  getRuntimeInfo: (): Promise<{
    packaged: boolean;
    buildTime: string;
    version: string;
    mode: "dev" | "packaged";
  }> => ipcRenderer.invoke("runtime:info"),
  loadTokens: (): Promise<StoredTokens | null> => ipcRenderer.invoke("tokens:load"),
  saveTokens: (tokens: StoredTokens): Promise<boolean> =>
    ipcRenderer.invoke("tokens:save", tokens),
  clearTokens: (): Promise<boolean> => ipcRenderer.invoke("tokens:clear"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  /** Write clipboard without requiring document focus (async export builds). */
  writeClipboard: (text: string): Promise<boolean> =>
    ipcRenderer.invoke("clipboard:writeText", text),
  /** Flash dock / taskbar when an order fills (or soft attention for cancels). */
  alertOrderFill: (urgent = true): Promise<void> =>
    ipcRenderer.invoke("window:alertOrderFill", urgent),
};

contextBridge.exposeInMainWorld("tradehole", tradehole);

export type TradeholeBridge = typeof tradehole;
