import cors from "cors";
import express, { type Express } from "express";
import {
  getEnergyQuotes,
  getOptionsChain,
  getStockQuote,
} from "./market";
import {
  clearSession,
  completeOAuth,
  getAuthStatus,
  getPortfolio,
  listAccounts,
  listOrders,
  renewAccessToken,
  setAccessTokens,
  startOAuth,
} from "./etrade";
import { getVolatilityReport } from "./volatility";
import { buildLlmDossier } from "./dossier";
import { getPhysicalMarkets } from "./physical";
import { buildDecisionIntel } from "./intel";
import {
  collectAllIronsightLinks,
  collectIronsightLinks,
  resolveIronsightConflicts,
} from "./ironsightLinks";
import {
  getTradingStatus,
  placeOptionOrder,
  previewOptionOrder,
} from "./orders";

export function createApp(): Express {
  const ironsightUrl = process.env.IRONSIGHT_URL ?? "http://localhost:3170";
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "tradehole", ts: new Date().toISOString() });
  });

  app.get("/api/quote/:symbol", async (req, res) => {
    try {
      const quote = await getStockQuote(req.params.symbol.toUpperCase());
      res.json(quote);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/options/:symbol", async (req, res) => {
    try {
      const expiry = typeof req.query.expiry === "string" ? req.query.expiry : undefined;
      const chain = await getOptionsChain(req.params.symbol.toUpperCase(), expiry);
      res.json(chain);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/energy", async (_req, res) => {
    try {
      const quotes = await getEnergyQuotes();
      res.json(quotes);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/market/snapshot", async (_req, res) => {
    try {
      const [fro, energy, options, volatility, physical] = await Promise.all([
        getStockQuote("FRO"),
        getEnergyQuotes(),
        getOptionsChain("FRO"),
        getVolatilityReport("FRO", {
          focusStrike: 46,
          focusType: "call",
          focusExpiry: "2026-09-18",
        }),
        getPhysicalMarkets(),
      ]);
      res.json({
        fro,
        energy,
        options,
        volatility,
        physical,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/physical", async (_req, res) => {
    try {
      const physical = await getPhysicalMarkets();
      res.json(physical);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/intel/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const intel = await buildDecisionIntel(symbol);
      res.json(intel);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/volatility/:symbol", async (req, res) => {
    try {
      const expiry = typeof req.query.expiry === "string" ? req.query.expiry : undefined;
      const focusExpiry =
        typeof req.query.focusExpiry === "string" ? req.query.focusExpiry : "2026-09-18";
      const focusStrike = Number(req.query.focusStrike ?? 46);
      const focusType = req.query.focusType === "put" ? "put" : "call";
      const report = await getVolatilityReport(req.params.symbol.toUpperCase(), {
        expiry,
        focusExpiry,
        focusStrike: Number.isFinite(focusStrike) ? focusStrike : 46,
        focusType,
      });
      res.json(report);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/dossier/:symbol", async (req, res) => {
    try {
      const dossier = await buildLlmDossier(req.params.symbol.toUpperCase());
      if (req.query.format === "json") {
        res.json(dossier);
        return;
      }
      res.type("text/plain; charset=utf-8").send(dossier.text);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/dossier/:symbol/meta", async (req, res) => {
    try {
      const dossier = await buildLlmDossier(req.params.symbol.toUpperCase());
      res.json({
        symbol: dossier.symbol,
        generatedAt: dossier.generatedAt,
        byteLength: dossier.byteLength,
        sources: dossier.sources,
        text: dossier.text,
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/etrade/status", (_req, res) => {
    res.json(getAuthStatus());
  });

  app.post("/api/etrade/oauth/start", async (_req, res) => {
    try {
      const result = await startOAuth();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/etrade/oauth/complete", async (req, res) => {
    try {
      const verifier = String(req.body?.verifier ?? "").trim();
      if (!verifier) {
        res.status(400).json({ error: "verifier required" });
        return;
      }
      const tokens = await completeOAuth(verifier);
      res.json({ ok: true, tokens });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/etrade/oauth/restore", (req, res) => {
    try {
      const accessToken = String(req.body?.accessToken ?? "");
      const accessTokenSecret = String(req.body?.accessTokenSecret ?? "");
      if (!accessToken || !accessTokenSecret) {
        res.status(400).json({ error: "accessToken and accessTokenSecret required" });
        return;
      }
      setAccessTokens(accessToken, accessTokenSecret);
      res.json({ ok: true, ...getAuthStatus() });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/etrade/oauth/renew", async (_req, res) => {
    try {
      await renewAccessToken();
      res.json({ ok: true, ...getAuthStatus() });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/etrade/oauth/logout", (_req, res) => {
    clearSession();
    res.json({ ok: true });
  });

  app.get("/api/etrade/accounts", async (_req, res) => {
    try {
      const accounts = await listAccounts();
      res.json(accounts);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/etrade/portfolio", async (req, res) => {
    try {
      const accountIdKey =
        typeof req.query.accountIdKey === "string" ? req.query.accountIdKey : undefined;
      const portfolio = await getPortfolio(accountIdKey);
      res.json(portfolio);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/etrade/orders", async (req, res) => {
    try {
      const accountIdKey =
        typeof req.query.accountIdKey === "string" ? req.query.accountIdKey : undefined;
      const status =
        typeof req.query.status === "string" && req.query.status !== "ALL"
          ? req.query.status
          : undefined;
      const symbol =
        typeof req.query.symbol === "string" ? req.query.symbol : undefined;
      const count = req.query.count != null ? Number(req.query.count) : 50;
      const orders = await listOrders({
        accountIdKey,
        status,
        symbol,
        count: Number.isFinite(count) ? count : 50,
      });
      res.json(orders);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/etrade/trading/status", (_req, res) => {
    res.json(getTradingStatus());
  });

  app.post("/api/etrade/orders/preview", async (req, res) => {
    try {
      const body = req.body ?? {};
      const allowedActions = new Set([
        "BUY_OPEN",
        "SELL_OPEN",
        "BUY_CLOSE",
        "SELL_CLOSE",
      ]);
      const orderAction = String(body.orderAction ?? "BUY_OPEN");
      if (!allowedActions.has(orderAction)) {
        res.status(400).json({ error: "Invalid orderAction" });
        return;
      }

      const rawPriceType = String(body.priceType ?? "LIMIT").toUpperCase();
      const priceType =
        rawPriceType === "MARKET"
          ? "MARKET"
          : rawPriceType === "TRAILING_STOP_CNST" ||
              rawPriceType === "TRAILING_STOP"
            ? "TRAILING_STOP_CNST"
            : "LIMIT";

      const trailRaw =
        body.trailAmount != null ? body.trailAmount : body.stopPrice;

      const result = await previewOptionOrder({
        accountIdKey:
          typeof body.accountIdKey === "string" ? body.accountIdKey : undefined,
        symbol: String(body.symbol ?? "FRO").toUpperCase(),
        callPut: body.callPut === "PUT" ? "PUT" : "CALL",
        expiry: String(body.expiry ?? "2026-09-18"),
        strike: Number(body.strike ?? 46),
        orderAction: orderAction as
          | "BUY_OPEN"
          | "SELL_OPEN"
          | "BUY_CLOSE"
          | "SELL_CLOSE",
        quantity: Number(body.quantity ?? 1),
        priceType,
        limitPrice: body.limitPrice != null ? Number(body.limitPrice) : undefined,
        trailAmount: trailRaw != null ? Number(trailRaw) : undefined,
        orderTerm: body.orderTerm,
        marketSession: body.marketSession,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.post("/api/etrade/orders/place", async (req, res) => {
    try {
      const previewToken = String(req.body?.previewToken ?? "").trim();
      const confirm = String(req.body?.confirm ?? "");
      if (!previewToken) {
        res.status(400).json({ error: "previewToken required" });
        return;
      }
      const result = await placeOptionOrder(previewToken, confirm);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/ironsight/status", async (_req, res) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(ironsightUrl, { signal: controller.signal });
      clearTimeout(timer);
      res.json({
        up: response.ok,
        url: ironsightUrl,
        status: response.status,
      });
    } catch {
      res.json({ up: false, url: ironsightUrl, status: 0 });
    }
  });

  app.get("/api/ironsight/news-blast", async (req, res) => {
    try {
      const raw =
        typeof req.query.conflict === "string" ? req.query.conflict : "all";
      let payload;
      try {
        const resolved = resolveIronsightConflicts(raw);
        payload =
          resolved === "all"
            ? await collectAllIronsightLinks(ironsightUrl)
            : await collectIronsightLinks(ironsightUrl, resolved[0]);
      } catch (err) {
        res.status(400).json({ error: String(err) });
        return;
      }
      const anyOk = payload.panelStatus.some((p) => p.ok);
      if (!anyOk) {
        res.status(502).json({
          error: `IRONSIGHT unreachable at ${ironsightUrl}. Start it with npm run osint.`,
          panelStatus: payload.panelStatus,
        });
        return;
      }
      res.json({
        ...payload,
        json: JSON.stringify(payload, null, 2),
      });
    } catch (err) {
      res.status(502).json({
        error: `IRONSIGHT link blast failed: ${String(err)}`,
      });
    }
  });

  return app;
}

export function startServer(port = Number(process.env.PORT ?? 3169)): Promise<number> {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => {
      console.log(`[tradehole] API listening on http://127.0.0.1:${port}`);
      console.log(`[tradehole] E*TRADE env: ${process.env.ETRADE_ENV ?? "sandbox"}`);
      resolve(port);
    });
    server.on("error", reject);
  });
}
