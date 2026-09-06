import cors from "cors";
import express, { type Express } from "express";
import {
  getAllOptionsChains,
  getEnergyQuotes,
  getOptionsChain,
  getStockQuote,
} from "./market";
import { getMarketCharts } from "./marketCharts";
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
import { getLastGoodPhysicalMarkets, getPhysicalMarkets } from "./physical";
import { buildDecisionIntel } from "./intel";
import { buildTheaterWatch, getLastGoodTheaterWatch } from "./theaterWatch";
import {
  collectAllIronsightLinks,
  collectIronsightLinks,
  resolveIronsightConflicts,
  type IronsightConflictKey,
} from "./ironsightLinks";
import {
  cancelOrder,
  getTradingStatus,
  placeOptionOrder,
  previewOptionOrder,
} from "./orders";
import { maybeRecordHistory } from "./history/writer";
import {
  historyStatus,
  queryAlertsSince,
  queryFlowEvents,
  queryHeatmap,
  queryOptionSeries,
  queryStockSeries,
} from "./history/query";
import { buildAiPack, zipStore } from "./history/exportPack";
import { buildOsintPack } from "./osintPack";
import { buildDeepSeekPaste } from "./deepSeekPaste";
import { buildNewsPack } from "./newsPack";
import {
  buildStrategyIntel,
  strategyIntelMarkdown,
} from "./analytics/strategyIntel";
import { computeOiDeltas } from "./analytics/deltaOi";
import { buildGexProfile } from "./analytics/gex";
import { computeIvRank } from "./analytics/ivRank";
import {
  evaluateIntelAlarm,
  getIntelAlarmManual,
  getLatestIntelAlarm,
  setIntelAlarmManual,
  startIntelAlarmPolling,
} from "./intelAlarm";
import {
  evaluateDealAlarm,
  getLatestDealAlarm,
  startDealAlarmPolling,
} from "./dealAlarm";
import { buildDecisionFootprint, getDecisionFootprint } from "./analytics/decisionFootprint";
import { buildMarketSurprise, getMarketSurprise } from "./analytics/marketSurprise";
import { buildFroCatalyst } from "./analytics/froCatalyst";
import { buildLotteryProposal } from "./playbook/proposalEngine";
import {
  ensurePlaybookTables,
  getLatestProposal,
  getProposal,
  journalSummary,
  listJournal,
  recordJournalEntry,
  updateProposalStatus,
} from "./playbook/journal";
import { buildKineticRewind, stampKineticRewind } from "./analytics/kineticRewind";
import { getKineticStamps } from "./kineticStamp";
import { listMideastTargets } from "./analytics/mideastTargets";
import { buildIsraelStrikeTells, getLastIsraelStrikeTells, invalidateIsraelStrikeTellsCache } from "./analytics/israelStrikeTells";
import {
  getIsraelStrikeManual,
  setIsraelStrikeManual,
} from "./israelStrikeManual";
import {
  archiveBounds,
  getOsintArchiveStatus,
  queryAerialPeaks,
  queryAssetTrail,
  queryPlaybackFrame,
} from "./osintArchive";
import { startCyprusAisCollector } from "./aisstreamCyprus";
import {
  addExternalPosition,
  deleteExternalPosition,
  getExternalStorePath,
  isRobinhoodAccountKey,
  listExternalPositions,
  listMarkedExternalPositions,
  ROBINHOOD_ACCOUNT,
  ROBINHOOD_ACCOUNT_ID_KEY,
  sumExternalTotals,
  updateExternalPosition,
  type ExternalPositionInput,
} from "./externalPositions";
import {
  FULL_PORTFOLIO_ACCOUNT,
  getFullPortfolio,
  isFullPortfolioKey,
} from "./portfolioFull";
import { buildBookSummary } from "./bookSummary";
import { buildPoliticsCalendarChip } from "./analytics/politicsCalendar";
import {
  exportNewsReaderDigests,
  getNewsReaderJob,
  getNewsReaderStatus,
  listNewsReaderArticles,
  listNewsReaderRegionPacks,
  startNewsReaderRun,
  type NewsReaderStage,
  type NewsReaderTelegramMode,
} from "./newsReader";

const IRONSIGHT_FEED_STALE_MS = 45 * 60 * 1000;

function newestPubAgeMs(
  items: Array<{ pubDate?: string | null }>,
): number | null {
  let newest: number | null = null;
  for (const item of items) {
    if (!item.pubDate) continue;
    const t = Date.parse(item.pubDate);
    if (!Number.isFinite(t)) continue;
    if (newest == null || t > newest) newest = t;
  }
  if (newest == null) return null;
  return Math.max(0, Date.now() - newest);
}

export function createApp(): Express {
  const ironsightUrl = process.env.IRONSIGHT_URL ?? "http://localhost:3170";
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "tradehole", ts: new Date().toISOString() });
  });

  app.get("/api/book-summary", (_req, res) => {
    try {
      res.json(buildBookSummary());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/politics-calendar", (_req, res) => {
    try {
      res.json(buildPoliticsCalendarChip());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
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

  app.get("/api/options/:symbol/all", async (req, res) => {
    try {
      const all = await getAllOptionsChains(req.params.symbol.toUpperCase());
      res.json(all);
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

  app.get("/api/market/charts", async (req, res) => {
    try {
      const payload = await getMarketCharts(req.query.range);
      res.json(payload);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/theater-watch", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const force =
        req.query.refresh === "1" || req.query.refresh === "true";
      // Map / desk poll — skip DF+MS (own endpoints) so stamps/overlays stay under client timeout.
      const lite =
        req.query.lite === "1" ||
        req.query.lite === "true" ||
        req.query.map === "1" ||
        req.query.map === "true";
      const watch = await buildTheaterWatch({ force });
      if (lite) {
        res.json(watch);
        return;
      }
      const deal = getLatestDealAlarm();
      const intel = getLatestIntelAlarm();
      const extrasBudgetMs = 12_000;
      const extras = await Promise.race([
        (async () => {
          const decisionFootprint = await buildDecisionFootprint({
            theater: watch,
            deal,
            intel,
          });
          const marketSurprise = await buildMarketSurprise({
            theater: watch,
            deal,
            intel,
            footprint: decisionFootprint,
          });
          return { decisionFootprint, marketSurprise };
        })(),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), extrasBudgetMs),
        ),
      ]);
      res.json(extras ? { ...watch, ...extras } : watch);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  /** Decision Footprint Score 0–100 (diplomatic / execution / market stack). */
  app.get("/api/decision-footprint", async (req, res) => {
    try {
      const force =
        req.query.refresh === "1" || req.query.refresh === "true";
      const footprint = await getDecisionFootprint({ force });
      res.json(footprint);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  /** Israel Strike Pre-Launch Tells (AER/NAV/ELEC/DIP/POL + EXEC Shekel). */
  app.get("/api/israel-strike-tells", async (req, res) => {
    try {
      const force =
        req.query.refresh === "1" || req.query.refresh === "true";
      const tells = await buildIsraelStrikeTells({
        intel: getLatestIntelAlarm(),
        forceAerial: force,
        force,
      });
      res.json(tells);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  /** Instant last-good IST + theater for Map copy — never waits on ADS-B/RSS. */
  app.get("/api/map-copy-board", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const ist = getLastIsraelStrikeTells();
    const theater = getLastGoodTheaterWatch();
    res.json({
      israelStrike: ist?.tells ?? null,
      israelStrikeAgeMs: ist?.ageMs ?? null,
      theater,
      asOf: new Date().toISOString(),
    });
  });

  app.get("/api/israel-strike-tells/manual", (_req, res) => {
    res.json(getIsraelStrikeManual());
  });

  app.post("/api/israel-strike-tells/manual", (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        nav01?: {
          posture?: string;
          note?: string;
          navyCount?: number | null;
          navyThreshold?: number;
        };
      };
      const manual = setIsraelStrikeManual(
        body as Parameters<typeof setIsraelStrikeManual>[0],
      );
      invalidateIsraelStrikeTellsCache();
      res.json(manual);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  /** Named-target kinetic rewind (whole Mideast) — not Israel AER-01 High-go. */
  app.get("/api/kinetic-rewind", async (req, res) => {
    try {
      const target =
        typeof req.query.target === "string" ? req.query.target : undefined;
      const eventAt =
        typeof req.query.eventAt === "string" ? req.query.eventAt : undefined;
      const force =
        req.query.refresh === "1" || req.query.refresh === "true";
      const report = await buildKineticRewind({ target, eventAt, force });
      res.json(report);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/kinetic-rewind/targets", (_req, res) => {
    res.json({
      honesty:
        "Approximate pins, not official geometry. Confirmed strike ≠ ADS-B over target.",
      notHighGo: true,
      targets: listMideastTargets(),
    });
  });

  app.get("/api/kinetic-rewind/stamps", (_req, res) => {
    res.json(getKineticStamps());
  });

  app.post("/api/kinetic-rewind/stamp", (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        targetId?: string;
        eventAt?: string;
        headline?: string;
        note?: string;
        link?: string | null;
      };
      if (!body.targetId || !body.eventAt) {
        res.status(400).json({ error: "targetId and eventAt required" });
        return;
      }
      const stamp = stampKineticRewind({
        targetId: body.targetId,
        eventAt: body.eventAt,
        headline: body.headline,
        note: body.note,
        link: body.link ?? null,
      });
      res.json(stamp);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  /** FRO forward catalyst stack — Hormuz transits, TD3C/BDTI, deal crush, book action. */
  app.get("/api/fro-catalyst", async (req, res) => {
    try {
      const force =
        req.query.refresh === "1" || req.query.refresh === "true";
      const report = await buildFroCatalyst({ force });
      res.json(report);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  /** Human-in-the-loop lottery playbook — proposals only; never auto-place. */
  app.get("/api/playbook/proposals", async (req, res) => {
    try {
      const force =
        req.query.refresh === "1" || req.query.refresh === "true";
      const proposal = await buildLotteryProposal({ force });
      res.json(proposal);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  /** Desk strip — last persisted proposal without rebuilding intel. */
  app.get("/api/playbook/latest", (_req, res) => {
    try {
      ensurePlaybookTables();
      res.json({
        proposal: getLatestProposal(),
        asOf: new Date().toISOString(),
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.post("/api/playbook/proposals/:id/decision", async (req, res) => {
    try {
      const id = String(req.params.id ?? "");
      const body =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};
      const decision = String(body.decision ?? "");
      if (
        decision !== "accepted" &&
        decision !== "rejected" &&
        decision !== "snoozed" &&
        decision !== "accepted_manual"
      ) {
        res.status(400).json({
          error:
            "decision must be accepted | rejected | snoozed | accepted_manual",
        });
        return;
      }
      const proposal = getProposal(id);
      if (!proposal) {
        res.status(404).json({ error: "proposal not found" });
        return;
      }
      const payload = {
        decision: decision as
          | "accepted"
          | "rejected"
          | "snoozed"
          | "accepted_manual",
        note: typeof body.note === "string" ? body.note : undefined,
        orderId: typeof body.orderId === "string" ? body.orderId : undefined,
        fillPrice:
          typeof body.fillPrice === "number" ? body.fillPrice : undefined,
        pnl: typeof body.pnl === "number" ? body.pnl : undefined,
      };
      const updated = updateProposalStatus(id, decision, {});
      if (updated) recordJournalEntry(updated, payload);
      res.json({ proposal: updated, decision: payload });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/playbook/journal", async (req, res) => {
    try {
      const limit = Math.min(
        200,
        Math.max(1, Number(req.query.limit ?? 50) || 50),
      );
      ensurePlaybookTables();
      res.json({
        summary: journalSummary(),
        entries: listJournal(limit),
        asOf: new Date().toISOString(),
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });
  /** Market Surprise Score — Reality% − Market% edge per thesis. */
  app.get("/api/market-surprise", async (req, res) => {
    try {
      const force =
        req.query.refresh === "1" || req.query.refresh === "true";
      const surprise = await getMarketSurprise({ force });
      res.json(surprise);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  /** Ultimate 5-Lock Intel Alarm (Kharg/Hormuz stacked footprint). */
  app.get("/api/intel-alarm", async (req, res) => {
    try {
      const force =
        req.query.refresh === "1" || req.query.refresh === "true";
      const cached = getLatestIntelAlarm();
      const state =
        force || !cached ? await evaluateIntelAlarm() : cached;
      res.json(state);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.post("/api/intel-alarm", async (req, res) => {
    try {
      const body =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};
      setIntelAlarmManual(body);
      const refresh = body.refresh !== false;
      const state = refresh
        ? await evaluateIntelAlarm()
        : getLatestIntelAlarm() ??
          (await evaluateIntelAlarm());
      res.json({ ...state, manual: getIntelAlarmManual() });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.post("/api/intel-alarm/manual", async (req, res) => {
    try {
      const body =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};
      const manual = setIntelAlarmManual(body);
      const state = await evaluateIntelAlarm();
      res.json({ ...state, manual });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  /** Overnight Hormuz deal / fee / signature watch (Tasnim · ONA · Pezeshkian · US). */
  app.get("/api/deal-alarm", async (req, res) => {
    try {
      const force =
        req.query.refresh === "1" || req.query.refresh === "true";
      const cached = getLatestDealAlarm();
      const state =
        force || !cached ? await evaluateDealAlarm() : cached;
      res.json(state);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/market/snapshot", async (req, res) => {
    try {
      const forcePhysical =
        req.query.refresh === "1" || req.query.refresh === "true";
      // Physical scrapes (Edge probe / EIA / Yahoo) are budgeted inside getPhysicalMarkets
      // (~11s + last-good cache). Settle slightly above that so cache fallback can return.
      const FRO_TIMEOUT_MS = 8_000;
      const LEG_TIMEOUT_MS = 14_000;
      const VOL_TIMEOUT_MS = 22_000;
      const PHYSICAL_TIMEOUT_MS = 16_000;

      const settle = async <T>(
        p: Promise<T>,
        label: string,
        timeoutMs: number,
      ): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const value = await Promise.race([
            p,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(`${label} timed out after ${timeoutMs}ms`),
                  ),
                timeoutMs,
              );
            }),
          ]);
          return { ok: true, value };
        } catch (err) {
          return { ok: false, error: String(err) };
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      const [froS, energyS, optionsS, volatilityS, physicalS] =
        await Promise.all([
          settle(getStockQuote("FRO"), "fro", FRO_TIMEOUT_MS),
          settle(getEnergyQuotes(), "energy", LEG_TIMEOUT_MS),
          settle(getOptionsChain("FRO"), "options", LEG_TIMEOUT_MS),
          settle(
            getVolatilityReport("FRO", {
              focusStrike: 46,
              focusType: "call",
              focusExpiry: "2026-09-18",
            }),
            "volatility",
            VOL_TIMEOUT_MS,
          ),
          settle(getPhysicalMarkets({ force: forcePhysical }), "physical", PHYSICAL_TIMEOUT_MS),
        ]);

      if (!froS.ok) {
        res.status(502).json({ error: froS.error });
        return;
      }

      const fro = froS.value;
      const energy = energyS.ok ? energyS.value : null;
      const options = optionsS.ok ? optionsS.value : null;
      const volatility = volatilityS.ok ? volatilityS.value : null;
      // Prefer live physical; on settle failure paint last-good / never null-blank the panel.
      const physical = physicalS.ok
        ? physicalS.value
        : (() => {
            const cached = getLastGoodPhysicalMarkets();
            if (!cached) return null;
            return {
              ...cached,
              fromCache: true,
              stale: true,
              error: `physical settle failed (${physicalS.error}) — showing last-good.`,
              caveats: [
                ...cached.caveats,
                `Snapshot settle fallback · last live ${cached.fetchedAt}`,
              ],
            };
          })();
      const partialErrors = [
        !energyS.ok ? `energy: ${energyS.error}` : null,
        !optionsS.ok ? `options: ${optionsS.error}` : null,
        !volatilityS.ok ? `volatility: ${volatilityS.error}` : null,
        !physicalS.ok && !physical
          ? `physical: ${physicalS.error}`
          : null,
      ].filter((e): e is string => Boolean(e));

      if (energy && options && physical && !physical.fromCache && !physical.stale) {
        // History write is throttled (~5m) and must never block/break live quotes.
        void maybeRecordHistory({ fro, options, energy, physical }).catch(
          (err) => {
            console.warn("[tradehole] history write failed:", err);
          },
        );
      }

      res.json({
        fro,
        energy,
        options,
        volatility,
        physical,
        partialErrors: partialErrors.length ? partialErrors : undefined,
        history: historyStatus(),
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/history/status", (_req, res) => {
    res.json(historyStatus());
  });

  app.get("/api/history/series", (req, res) => {
    try {
      const symbol = String(req.query.symbol ?? "FRO").toUpperCase();
      const expiry = String(req.query.expiry ?? "2026-09-18");
      const strike = Number(req.query.strike ?? 46);
      const type = req.query.type === "put" ? "put" : "call";
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const series = queryOptionSeries({ symbol, expiry, strike, type, from });
      const stock = queryStockSeries({ symbol, from });
      res.json({ symbol, expiry, strike, type, series, stock });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/history/flow", (req, res) => {
    try {
      const symbol = String(req.query.symbol ?? "FRO").toUpperCase();
      const days = Number(req.query.days ?? 7);
      res.json({
        symbol,
        events: queryFlowEvents({
          symbol,
          days: Number.isFinite(days) ? days : 7,
        }),
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/history/alerts", (req, res) => {
    try {
      const symbol = String(req.query.symbol ?? "FRO").toUpperCase();
      const since = typeof req.query.since === "string" ? req.query.since : undefined;
      res.json({
        symbol,
        alerts: queryAlertsSince({ symbol, since }),
        status: historyStatus(),
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/history/heatmap", (req, res) => {
    try {
      const symbol = String(req.query.symbol ?? "FRO").toUpperCase();
      const expiry = String(req.query.expiry ?? "2026-09-18");
      res.json({ symbol, expiry, ...queryHeatmap({ symbol, expiry }) });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/osint-archive/status", (_req, res) => {
    res.json({
      ...getOsintArchiveStatus(),
      bounds: archiveBounds(),
    });
  });

  app.get("/api/osint-archive/range", (req, res) => {
    try {
      const atRaw =
        typeof req.query.at === "string" && req.query.at
          ? req.query.at
          : new Date().toISOString();
      const windowMs = Number(req.query.windowMs ?? 5 * 60_000);
      const kindsRaw =
        typeof req.query.kinds === "string" ? req.query.kinds : "";
      const kinds = kindsRaw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const frame = queryPlaybackFrame({
        at: atRaw,
        windowMs: Number.isFinite(windowMs) ? windowMs : 5 * 60_000,
        kinds: kinds.length ? kinds : undefined,
      });
      res.json(frame);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/osint-archive/peaks", (req, res) => {
    try {
      const to =
        typeof req.query.to === "string" && req.query.to
          ? req.query.to
          : new Date().toISOString();
      const fromDefault = new Date(
        Date.parse(to) - 48 * 3600_000,
      ).toISOString();
      const from =
        typeof req.query.from === "string" && req.query.from
          ? req.query.from
          : fromDefault;
      const limit = Number(req.query.limit ?? 2_000);
      res.json({
        from,
        to,
        peaks: queryAerialPeaks({
          from,
          to,
          limit: Number.isFinite(limit) ? limit : 2_000,
        }),
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/osint-archive/trail", (req, res) => {
    try {
      const assetKey = String(req.query.assetKey ?? "");
      if (!assetKey) {
        res.status(400).json({ error: "assetKey required" });
        return;
      }
      const to =
        typeof req.query.to === "string" && req.query.to
          ? req.query.to
          : new Date().toISOString();
      const fromDefault = new Date(
        Date.parse(to) - 6 * 3600_000,
      ).toISOString();
      const from =
        typeof req.query.from === "string" && req.query.from
          ? req.query.from
          : fromDefault;
      res.json({
        assetKey,
        from,
        to,
        trail: queryAssetTrail({ assetKey, from, to }),
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/strategy/:symbol", async (req, res) => {
    try {
      const intel = await buildStrategyIntel(req.params.symbol.toUpperCase());
      res.json(intel);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/strategy/:symbol/markdown", async (req, res) => {
    try {
      const intel = await buildStrategyIntel(req.params.symbol.toUpperCase());
      res.type("text/plain; charset=utf-8").send(strategyIntelMarkdown(intel));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/strategy/:symbol/gex.csv", async (req, res) => {
    try {
      const gex = await buildGexProfile(req.params.symbol.toUpperCase());
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="GEX_by_Strike_${req.params.symbol.toUpperCase()}.csv"`,
      );
      res.send(gex.csv);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/strategy/:symbol/oi-delta", (req, res) => {
    try {
      res.json({
        symbol: req.params.symbol.toUpperCase(),
        rows: computeOiDeltas(req.params.symbol.toUpperCase()),
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/strategy/:symbol/iv-rank", async (req, res) => {
    try {
      res.json(await computeIvRank(req.params.symbol.toUpperCase()));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  function exportOptsFromReq(req: {
    query: Record<string, unknown>;
    body?: unknown;
  }): {
    aisStatus?: string | null;
    aisNote?: string | null;
    bataanStatus?: string | null;
    bataanNote?: string | null;
    boxerStatus?: string | null;
    boxerNote?: string | null;
    newYorkStatus?: string | null;
    newYorkNote?: string | null;
    amphibStatus?: string | null;
    amphibNote?: string | null;
    irgcStatus?: string | null;
    irgcNote?: string | null;
    capeStatus?: string | null;
    capeNote?: string | null;
    romeStatus?: string | null;
    romeNote?: string | null;
    bataanSog?: string | null;
    bataanCourse?: string | null;
    bataanLat?: string | null;
    bataanLon?: string | null;
    boxerSog?: string | null;
    boxerCourse?: string | null;
    boxerLat?: string | null;
    boxerLon?: string | null;
    newYorkSog?: string | null;
    newYorkCourse?: string | null;
    newYorkLat?: string | null;
    newYorkLon?: string | null;
    vlccDivertCount?: string | null;
    navwarnForce?: string | null;
    irgcForce?: string | null;
    capeForce?: string | null;
    intelAlarmNote?: string | null;
  } {
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};
    const pick = (key: string): string | null =>
      (typeof body[key] === "string" ? (body[key] as string) : null) ??
      (typeof req.query[key] === "string" ? (req.query[key] as string) : null);
    return {
      aisStatus: pick("aisStatus"),
      aisNote: pick("aisNote"),
      bataanStatus: pick("bataanStatus"),
      bataanNote: pick("bataanNote"),
      boxerStatus: pick("boxerStatus"),
      boxerNote: pick("boxerNote"),
      newYorkStatus: pick("newYorkStatus"),
      newYorkNote: pick("newYorkNote"),
      amphibStatus: pick("amphibStatus"),
      amphibNote: pick("amphibNote"),
      irgcStatus: pick("irgcStatus"),
      irgcNote: pick("irgcNote"),
      capeStatus: pick("capeStatus"),
      capeNote: pick("capeNote"),
      romeStatus: pick("romeStatus"),
      romeNote: pick("romeNote"),
      bataanSog: pick("bataanSog"),
      bataanCourse: pick("bataanCourse"),
      bataanLat: pick("bataanLat"),
      bataanLon: pick("bataanLon"),
      boxerSog: pick("boxerSog"),
      boxerCourse: pick("boxerCourse"),
      boxerLat: pick("boxerLat"),
      boxerLon: pick("boxerLon"),
      newYorkSog: pick("newYorkSog"),
      newYorkCourse: pick("newYorkCourse"),
      newYorkLat: pick("newYorkLat"),
      newYorkLon: pick("newYorkLon"),
      vlccDivertCount: pick("vlccDivertCount"),
      navwarnForce: pick("navwarnForce"),
      irgcForce: pick("irgcForce"),
      capeForce: pick("capeForce"),
      intelAlarmNote: pick("intelAlarmNote"),
    };
  }

  /** Size-capped DeepSeek web-UI paste (clipboard-friendly). */
  app.get("/api/deepseek-paste", async (req, res) => {
    try {
      const symbol =
        typeof req.query.symbol === "string" && req.query.symbol.trim()
          ? req.query.symbol.trim().toUpperCase()
          : "FRO";
      const maxChars =
        typeof req.query.maxChars === "string"
          ? Number(req.query.maxChars)
          : undefined;
      const pack = await buildDeepSeekPaste({
        symbol,
        maxChars: Number.isFinite(maxChars) ? maxChars : undefined,
        ...exportOptsFromReq(req),
      });
      res.json(pack);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.post("/api/deepseek-paste", async (req, res) => {
    try {
      const body =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};
      const symbol =
        (typeof body.symbol === "string" && body.symbol.trim()
          ? body.symbol.trim()
          : typeof req.query.symbol === "string" && req.query.symbol.trim()
            ? req.query.symbol.trim()
            : "FRO"
        ).toUpperCase();
      const maxCharsRaw = body.maxChars ?? req.query.maxChars;
      const maxChars =
        typeof maxCharsRaw === "number"
          ? maxCharsRaw
          : typeof maxCharsRaw === "string"
            ? Number(maxCharsRaw)
            : undefined;
      const pack = await buildDeepSeekPaste({
        symbol,
        maxChars: Number.isFinite(maxChars as number)
          ? (maxChars as number)
          : undefined,
        ...exportOptsFromReq(req),
      });
      res.json(pack);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  /** Fast 7-bucket FRO/Hormuz OSINT pack (paste-ready markdown). */
  app.get("/api/export/:symbol/osint-pack", async (req, res) => {
    try {
      const pack = await buildOsintPack(
        req.params.symbol.toUpperCase(),
        exportOptsFromReq(req),
      );
      res.json(pack);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.post("/api/export/:symbol/osint-pack", async (req, res) => {
    try {
      const pack = await buildOsintPack(
        req.params.symbol.toUpperCase(),
        exportOptsFromReq(req),
      );
      res.json(pack);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  /** Unified EVERYTHING pack (dossier + theater + IRONSIGHT + physical + history). */
  app.get("/api/export/:symbol/ai-pack", async (req, res) => {
    try {
      const pack = await buildAiPack(
        req.params.symbol.toUpperCase(),
        exportOptsFromReq(req),
      );
      res.json(pack);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.post("/api/export/:symbol/ai-pack", async (req, res) => {
    try {
      const pack = await buildAiPack(
        req.params.symbol.toUpperCase(),
        exportOptsFromReq(req),
      );
      res.json(pack);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/export/:symbol/ai-bundle.zip", async (req, res) => {
    try {
      const pack = await buildAiPack(
        req.params.symbol.toUpperCase(),
        exportOptsFromReq(req),
      );
      const buf = zipStore(
        pack.files.map((f) => ({ name: f.name, content: f.content })),
      );
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="tradehole-${pack.symbol}-everything.zip"`,
      );
      res.send(buf);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.post("/api/export/:symbol/ai-bundle.zip", async (req, res) => {
    try {
      const pack = await buildAiPack(
        req.params.symbol.toUpperCase(),
        exportOptsFromReq(req),
      );
      const buf = zipStore(
        pack.files.map((f) => ({ name: f.name, content: f.content })),
      );
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="tradehole-${pack.symbol}-everything.zip"`,
      );
      res.send(buf);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/physical", async (req, res) => {
    try {
      const force =
        req.query.refresh === "1" || req.query.refresh === "true";
      const physical = await getPhysicalMarkets({ force });
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
      const msg = String(err);
      const expired = /session expired|token_expired/i.test(msg);
      res.status(expired ? 401 : 500).json({
        error: msg,
        sessionExpired: expired,
        ...getAuthStatus(),
      });
    }
  });

  app.post("/api/etrade/oauth/logout", (_req, res) => {
    clearSession();
    res.json({ ok: true });
  });

  app.get("/api/etrade/accounts", async (_req, res) => {
    try {
      const accounts = await listAccounts();
      const withoutRh = accounts.filter(
        (a) => !isRobinhoodAccountKey(a.accountIdKey),
      );
      res.json([FULL_PORTFOLIO_ACCOUNT, ...withoutRh, ROBINHOOD_ACCOUNT]);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/etrade/portfolio", async (req, res) => {
    try {
      const accountRef =
        typeof req.query.accountIdKey === "string"
          ? req.query.accountIdKey
          : typeof req.query.accountId === "string"
            ? req.query.accountId
            : undefined;

      /** Combined view — all included accounts + Robinhood in one payload. */
      if (isFullPortfolioKey(accountRef) || !accountRef) {
        const combined = await getFullPortfolio();
        res.json(combined);
        return;
      }

      /** Robinhood is a peer account — never merge into E*TRADE books. */
      if (isRobinhoodAccountKey(accountRef)) {
        const external = await listMarkedExternalPositions();
        const extTotals = sumExternalTotals(external);
        res.json({
          accountIdKey: ROBINHOOD_ACCOUNT_ID_KEY,
          accountId: null,
          accountDesc: "Robinhood",
          accountType: "EXTERNAL",
          accountMode: null,
          positions: external,
          totals: extTotals,
          externalTotals: extTotals,
          externalCount: external.length,
          fetchedAt: new Date().toISOString(),
        });
        return;
      }

      const portfolio = await getPortfolio(accountRef);
      const etradeRows = portfolio.positions.map((row) => ({
        ...row,
        broker: row.broker ?? "E*TRADE",
        brokerTag: row.brokerTag ?? "ET",
      }));
      res.json({
        ...portfolio,
        positions: etradeRows,
        totals: portfolio.totals,
        etradeTotals: portfolio.totals,
        externalTotals: {
          marketValue: 0,
          totalCost: 0,
          totalGain: 0,
          daysGain: 0,
        },
        externalCount: 0,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  app.get("/api/external-positions", async (_req, res) => {
    try {
      const positions = listExternalPositions();
      const marked = await listMarkedExternalPositions();
      res.json({
        positions,
        marked,
        totals: sumExternalTotals(marked),
        storePath: getExternalStorePath(),
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/external-positions", async (req, res) => {
    try {
      const body = req.body as ExternalPositionInput;
      const created = addExternalPosition(body);
      const marked = await listMarkedExternalPositions();
      res.status(201).json({
        position: created,
        marked: marked.find((m) => m.externalId === created.id) ?? null,
      });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.patch("/api/external-positions/:id", async (req, res) => {
    try {
      const updated = updateExternalPosition(
        String(req.params.id),
        req.body as Partial<ExternalPositionInput>,
      );
      const marked = await listMarkedExternalPositions();
      res.json({
        position: updated,
        marked: marked.find((m) => m.externalId === updated.id) ?? null,
      });
    } catch (err) {
      const msg = String(err);
      res.status(/not found/i.test(msg) ? 404 : 400).json({ error: msg });
    }
  });

  app.delete("/api/external-positions/:id", (req, res) => {
    try {
      const ok = deleteExternalPosition(String(req.params.id));
      if (!ok) {
        res.status(404).json({ error: "external position not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/etrade/orders", async (req, res) => {
    try {
      const accountIdKey =
        typeof req.query.accountIdKey === "string"
          ? req.query.accountIdKey
          : typeof req.query.accountId === "string"
            ? req.query.accountId
            : undefined;
      if (isRobinhoodAccountKey(accountIdKey)) {
        res.json({
          accountIdKey: ROBINHOOD_ACCOUNT_ID_KEY,
          orders: [],
          fetchedAt: new Date().toISOString(),
          note: "Robinhood is not an E*TRADE account — orders API skipped",
        });
        return;
      }
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

  app.post("/api/etrade/orders/cancel", async (req, res) => {
    try {
      const orderId = req.body?.orderId;
      const confirm = String(req.body?.confirm ?? "");
      const accountIdKey =
        typeof req.body?.accountIdKey === "string" ? req.body.accountIdKey : undefined;
      if (orderId == null || String(orderId).trim() === "") {
        res.status(400).json({ error: "orderId required" });
        return;
      }
      const result = await cancelOrder({
        accountIdKey,
        orderId: String(orderId),
        confirm,
      });
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
      const httpUp = response.ok;
      let feedsFresh = false;
      let telegramAgeMs: number | null = null;
      let newsAgeMs: number | null = null;
      let telegramCount = 0;
      let newsCount = 0;
      if (httpUp) {
        try {
          const payload = await collectIronsightLinks(
            ironsightUrl,
            "iran-israel",
          );
          const tg = payload.articles.filter((a) => a.panel === "telegram");
          const news = payload.articles.filter((a) => a.panel === "news");
          telegramCount = tg.length;
          newsCount = news.length;
          telegramAgeMs = newestPubAgeMs(tg);
          newsAgeMs = newestPubAgeMs(news);
          const tgPanel = payload.panelStatus.find(
            (p) => p.panel === "telegram" && p.conflict === "iran-israel",
          );
          const newsPanel = payload.panelStatus.find(
            (p) => p.panel === "news" && p.conflict === "iran-israel",
          );
          const tgOk =
            Boolean(tgPanel?.ok) &&
            telegramCount > 0 &&
            (telegramAgeMs == null || telegramAgeMs <= IRONSIGHT_FEED_STALE_MS);
          const newsOk =
            Boolean(newsPanel?.ok) &&
            newsCount > 0 &&
            (newsAgeMs == null || newsAgeMs <= IRONSIGHT_FEED_STALE_MS);
          // Fresh sample from either TG or news — empty panels = not fresh
          // (matches ELEC/PIKUD "offline" when IRONSIGHT HTTP is up but feeds empty).
          feedsFresh = tgOk || newsOk;
        } catch {
          feedsFresh = false;
        }
      }
      res.json({
        up: httpUp,
        feedsFresh,
        healthy: httpUp && feedsFresh,
        telegramAgeMs,
        newsAgeMs,
        telegramCount,
        newsCount,
        url: ironsightUrl,
        status: response.status,
      });
    } catch {
      res.json({
        up: false,
        feedsFresh: false,
        healthy: false,
        telegramAgeMs: null,
        newsAgeMs: null,
        telegramCount: 0,
        newsCount: 0,
        url: ironsightUrl,
        status: 0,
      });
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

  /**
   * Standalone news pack ZIP (RSS bodies + best-effort article HTML fetch).
   * Not the OSINT / AI_BRIEF / EVERYTHING pack.
   *
   * Query: conflict=all|iran-israel|russia-ukraine
   *        fetchLimit=100 (max 150)  concurrency=4
   *        telegram=robust|deep|sample  (default robust — full toolkit 30d dump)
   */
  app.get("/api/news-pack.zip", async (req, res) => {
    try {
      const raw =
        typeof req.query.conflict === "string" ? req.query.conflict : "all";
      let conflicts: "all" | IronsightConflictKey[];
      try {
        conflicts = resolveIronsightConflicts(raw);
      } catch (err) {
        res.status(400).json({ error: String(err) });
        return;
      }
      const fetchLimit =
        typeof req.query.fetchLimit === "string"
          ? Number(req.query.fetchLimit)
          : undefined;
      const concurrency =
        typeof req.query.concurrency === "string"
          ? Number(req.query.concurrency)
          : undefined;
      const telegramRaw =
        typeof req.query.telegram === "string"
          ? req.query.telegram.toLowerCase()
          : "robust";
      const telegramMode =
        telegramRaw === "deep" || telegramRaw === "sample"
          ? telegramRaw
          : "robust";
      const pack = await buildNewsPack(ironsightUrl, {
        conflicts: conflicts === "all" ? undefined : conflicts,
        fetchLimit: Number.isFinite(fetchLimit) ? fetchLimit : undefined,
        concurrency: Number.isFinite(concurrency) ? concurrency : undefined,
        telegramMode,
      });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="tradehole-news-pack.zip"`,
      );
      res.setHeader("X-News-Pack-Articles", String(pack.articleCount));
      res.setHeader("X-News-Pack-Fetched-Ok", String(pack.bodyFetchedOk));
      res.setHeader("X-News-Pack-Fetched-Fail", String(pack.bodyFetchedFail));
      res.setHeader("X-News-Pack-Telegram", String(pack.telegramCount));
      res.setHeader("X-News-Pack-Telegram-Mode", pack.telegramMode);
      res.send(pack.zip);
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  /** JSON metadata (no zip bodies) for debugging / status. */
  app.get("/api/news-pack", async (req, res) => {
    try {
      const raw =
        typeof req.query.conflict === "string" ? req.query.conflict : "all";
      let conflicts: "all" | IronsightConflictKey[];
      try {
        conflicts = resolveIronsightConflicts(raw);
      } catch (err) {
        res.status(400).json({ error: String(err) });
        return;
      }
      const fetchLimit =
        typeof req.query.fetchLimit === "string"
          ? Number(req.query.fetchLimit)
          : undefined;
      const concurrency =
        typeof req.query.concurrency === "string"
          ? Number(req.query.concurrency)
          : undefined;
      const telegramRaw =
        typeof req.query.telegram === "string"
          ? req.query.telegram.toLowerCase()
          : "robust";
      const telegramMode =
        telegramRaw === "deep" || telegramRaw === "sample"
          ? telegramRaw
          : "robust";
      const pack = await buildNewsPack(ironsightUrl, {
        conflicts: conflicts === "all" ? undefined : conflicts,
        fetchLimit: Number.isFinite(fetchLimit) ? fetchLimit : undefined,
        concurrency: Number.isFinite(concurrency) ? concurrency : undefined,
        telegramMode,
      });
      const articlesFile = pack.files.find((f) => f.name === "articles.json");
      res.type("json").send(
        articlesFile?.content ??
          JSON.stringify({
            generatedAt: pack.generatedAt,
            note: pack.note,
            articleCount: pack.articleCount,
            telegramCount: pack.telegramCount,
            telegramMode: pack.telegramMode,
            telegramCapability: pack.telegramCapability,
          }),
      );
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  // --- Local Python news_reader (RSS + Telegram web + extract + Ollama) ---
  app.get("/api/news-reader/status", async (_req, res) => {
    try {
      const status = await getNewsReaderStatus();
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/news-reader/job", (_req, res) => {
    res.json({ job: getNewsReaderJob() });
  });

  app.post("/api/news-reader/run", async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        stages?: NewsReaderStage;
        limit?: number;
        summarizeLimit?: number;
        telegramMode?: NewsReaderTelegramMode;
        model?: string;
      };
      const result = startNewsReaderRun({
        stages: body.stages,
        limit: body.limit,
        summarizeLimit: body.summarizeLimit,
        // Always web — Telethon only if you later opt in via env + explicit mode
        telegramMode: "web",
        model: body.model,
      });
      res.status(result.accepted ? 202 : 200).json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/news-reader/articles", (req, res) => {
    try {
      const limit =
        typeof req.query.limit === "string"
          ? Number(req.query.limit)
          : undefined;
      const offset =
        typeof req.query.offset === "string"
          ? Number(req.query.offset)
          : undefined;
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const region =
        typeof req.query.region === "string" ? req.query.region : undefined;
      const result = listNewsReaderArticles({
        limit: Number.isFinite(limit) ? limit : undefined,
        offset: Number.isFinite(offset) ? offset : undefined,
        status,
        region,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/news-reader/regions", (_req, res) => {
    res.json({ packs: listNewsReaderRegionPacks() });
  });

  app.get("/api/news-reader/export", (req, res) => {
    try {
      const limit =
        typeof req.query.limit === "string"
          ? Number(req.query.limit)
          : undefined;
      const status =
        typeof req.query.status === "string" ? req.query.status : "summarized";
      const pack = exportNewsReaderDigests({
        limit: Number.isFinite(limit) ? limit : 100,
        status,
      });
      res.json(pack);
    } catch (err) {
      res.status(500).json({ error: String(err) });
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
      // Server-side polls — do not require browser open.
      startIntelAlarmPolling();
      startDealAlarmPolling();
      startCyprusAisCollector();
      // Optional: kick news_reader ingest on boot (ingest only — summarize stays manual).
      if (process.env.NEWS_READER_AUTO_INGEST !== "0") {
        setTimeout(() => {
          void (async () => {
            try {
              const status = await getNewsReaderStatus();
              if (status.venvOk && !status.job?.running) {
                const r = startNewsReaderRun({ stages: "ingest" });
                if (r.accepted) {
                  console.log("[tradehole] news_reader auto-ingest started");
                }
              }
            } catch (err) {
              console.warn("[tradehole] news_reader auto-ingest skipped:", err);
            }
          })();
        }, 8_000);
      }
      resolve(port);
    });
    server.on("error", reject);
  });
}
