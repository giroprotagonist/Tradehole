import dotenv from "dotenv";
import { startServer } from "./app";

dotenv.config({
  path: process.env.DOTENV_CONFIG_PATH || undefined,
});

const PORT = Number(process.env.PORT ?? 3169);

void startServer(PORT).catch((err) => {
  console.error("[tradehole] failed to start API", err);
  process.exit(1);
});
