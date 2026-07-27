import { contextBridge, ipcRenderer } from "electron";

export type StoredTokens = {
  accessToken: string;
  accessTokenSecret: string;
};

const tradehole = {
  getApiBase: (): Promise<string> => ipcRenderer.invoke("api:base"),
  loadTokens: (): Promise<StoredTokens | null> => ipcRenderer.invoke("tokens:load"),
  saveTokens: (tokens: StoredTokens): Promise<boolean> =>
    ipcRenderer.invoke("tokens:save", tokens),
  clearTokens: (): Promise<boolean> => ipcRenderer.invoke("tokens:clear"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
};

contextBridge.exposeInMainWorld("tradehole", tradehole);

export type TradeholeBridge = typeof tradehole;
