import crypto from "node:crypto";
import {
  apiPost,
  apiPut,
  getPortfolio,
  type EtradeAccount,
  listAccounts,
  resolveAccountIdKey,
} from "./etrade";

/** Focus trade: FRO Sep 18 '26 $46 call — matches dashboard position focus. */
export const FRO_TRADE_DEFAULTS = {
  symbol: "FRO",
  strike: 46,
  expiry: "2026-09-18",
  callPut: "CALL" as const,
  orderAction: "BUY_OPEN" as const,
  quantity: 1,
  priceType: "LIMIT" as const,
  orderTerm: "GOOD_FOR_DAY" as const,
  marketSession: "REGULAR" as const,
};

export type OptionPriceType = "LIMIT" | "MARKET" | "TRAILING_STOP_CNST";

export type OptionOrderInput = {
  accountIdKey?: string;
  symbol: string;
  callPut: "CALL" | "PUT";
  expiry: string;
  strike: number;
  orderAction:
    | "BUY_OPEN"
    | "SELL_OPEN"
    | "BUY_CLOSE"
    | "SELL_CLOSE";
  quantity: number;
  priceType: OptionPriceType;
  /** Required for LIMIT */
  limitPrice?: number;
  /**
   * Trail amount ($) for TRAILING_STOP_CNST.
   * E*TRADE expects this in stopPrice — it is NOT a trigger level.
   */
  trailAmount?: number;
  orderTerm?: "GOOD_FOR_DAY" | "GOOD_UNTIL_CANCEL";
  marketSession?: "REGULAR" | "EXTENDED";
};

type OrderStrings = {
  allOrNone: string;
  priceType: string;
  limitPrice: string;
  stopPrice: string;
  offsetType: string | null;
  orderTerm: string;
  marketSession: string;
  symbol: string;
  securityType: string;
  callPut: string;
  expiryYear: string;
  expiryMonth: string;
  expiryDay: string;
  strikePrice: string;
  orderAction: string;
  orderedQuantity: string;
  quantity: string;
};

type StoredPreview = {
  accountIdKey: string;
  clientOrderId: string;
  previewId: string;
  placePayload: { PlaceOrderRequest: Record<string, unknown> };
  confirmPhrase: string;
  summary: string;
  expiresAt: number;
  used: boolean;
};

const PREVIEW_TTL_MS = 120_000;
const previewStore = new Map<string, StoredPreview>();

function tradingEnabled(): boolean {
  const v = (process.env.ETRADE_ENABLE_TRADING ?? "true").toLowerCase();
  return v !== "false" && v !== "0";
}

function requireTrading(): void {
  if (!tradingEnabled()) {
    throw new Error(
      "E*TRADE trading disabled — set ETRADE_ENABLE_TRADING=true in .env to allow orders",
    );
  }
}

function parseExpiry(expiry: string): { year: string; month: string; day: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry.trim());
  if (!m) {
    throw new Error(`Invalid expiry ${expiry} — use YYYY-MM-DD`);
  }
  return {
    year: m[1],
    month: String(Number(m[2])),
    day: String(Number(m[3])),
  };
}

function clientOrderId(): string {
  return `th${crypto.randomBytes(8).toString("hex").slice(0, 18)}`;
}

function buildOrderStrings(input: OptionOrderInput): OrderStrings {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be a positive number");
  }
  if (!Number.isFinite(input.strike) || input.strike <= 0) {
    throw new Error("Strike must be positive");
  }

  const { year, month, day } = parseExpiry(input.expiry);
  const qty = String(Math.floor(input.quantity));
  const priceType = input.priceType;
  let limitPrice = "0";
  let stopPrice = "0";
  let offsetType: string | null = null;

  if (priceType === "LIMIT") {
    if (input.limitPrice == null || !Number.isFinite(input.limitPrice) || input.limitPrice <= 0) {
      throw new Error("Limit price required for LIMIT orders");
    }
    limitPrice = input.limitPrice.toFixed(2);
  } else if (priceType === "TRAILING_STOP_CNST") {
    // E*TRADE: for trailing stops, stopPrice carries the $ trail amount (not a level).
    // Triggered trail executes as a market order — leave limitPrice at 0.
    if (
      input.trailAmount == null ||
      !Number.isFinite(input.trailAmount) ||
      input.trailAmount <= 0
    ) {
      throw new Error("Trail amount (stopPrice) must be > 0 for TRAILING_STOP_CNST");
    }
    stopPrice = input.trailAmount.toFixed(2);
    offsetType = "TRAILING_STOP_CNST";
  }

  const defaultTerm =
    priceType === "TRAILING_STOP_CNST"
      ? "GOOD_UNTIL_CANCEL"
      : FRO_TRADE_DEFAULTS.orderTerm;

  return {
    allOrNone: "false",
    priceType,
    limitPrice,
    stopPrice,
    offsetType,
    orderTerm: input.orderTerm ?? defaultTerm,
    marketSession: input.marketSession ?? FRO_TRADE_DEFAULTS.marketSession,
    symbol: input.symbol.toUpperCase(),
    securityType: "OPTN",
    callPut: input.callPut,
    expiryYear: year,
    expiryMonth: month,
    expiryDay: day,
    strikePrice: String(input.strike),
    orderAction: input.orderAction,
    orderedQuantity: qty,
    quantity: qty,
  };
}

function orderBodyFields(order: OrderStrings): Record<string, unknown> {
  const body: Record<string, unknown> = {
    allOrNone: order.allOrNone,
    priceType: order.priceType,
    limitPrice: order.limitPrice,
    stopPrice: order.stopPrice,
    orderTerm: order.orderTerm,
    marketSession: order.marketSession,
    Instrument: [
      {
        Product: {
          symbol: order.symbol,
          securityType: order.securityType,
          callPut: order.callPut,
          expiryYear: order.expiryYear,
          expiryMonth: order.expiryMonth,
          expiryDay: order.expiryDay,
          strikePrice: order.strikePrice,
        },
        orderAction: order.orderAction,
        orderedQuantity: order.orderedQuantity,
        quantity: order.quantity,
      },
    ],
  };
  if (order.offsetType) {
    body.offsetType = order.offsetType;
  }
  return body;
}

function buildPreviewPayload(clientId: string, order: OrderStrings) {
  return {
    PreviewOrderRequest: {
      // Top-level orderType stays OPTN for option legs; trail lives in priceType.
      orderType: "OPTN",
      clientOrderId: clientId,
      Order: [orderBodyFields(order)],
    },
  };
}

function buildPlacePayload(
  clientId: string,
  previewId: string,
  order: OrderStrings,
): { PlaceOrderRequest: Record<string, unknown> } {
  return {
    PlaceOrderRequest: {
      orderType: "OPTN",
      clientOrderId: clientId,
      PreviewIds: [{ previewId: String(previewId) }],
      Order: [orderBodyFields(order)],
    },
  };
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function etradeErrorMessage(resp: Record<string, unknown>): string | null {
  const err = resp.Error ?? resp.ErrorResponse ?? resp.error;
  if (!err) return null;
  if (typeof err === "string") return err;
  if (Array.isArray(err)) {
    return err
      .map((e) => {
        const row = e as Record<string, unknown>;
        return String(row.message ?? row.description ?? row.code ?? JSON.stringify(e));
      })
      .join("; ");
  }
  if (typeof err === "object") {
    const row = err as Record<string, unknown>;
    const code = row.code != null ? `code ${row.code}` : null;
    const msg = row.message != null ? String(row.message) : null;
    const desc = row.description != null ? String(row.description) : null;
    return [code, msg ?? desc].filter(Boolean).join(": ") || JSON.stringify(err);
  }
  return String(err);
}

function extractPreviewId(resp: Record<string, unknown>): string {
  const preview =
    (resp.PreviewOrderResponse as Record<string, unknown> | undefined) ??
    (resp.previewOrderResponse as Record<string, unknown> | undefined);
  if (!preview) {
    const etradeErr = etradeErrorMessage(resp);
    const keys = Object.keys(resp).join(", ") || "(empty)";
    throw new Error(
      etradeErr
        ? `E*TRADE preview rejected: ${etradeErr}`
        : `Missing PreviewOrderResponse in E*TRADE reply (keys: ${keys}). Often means not enough free contracts — cancel open sells first.`,
    );
  }
  const ids = preview.PreviewIds as
    | { previewId?: string | number }
    | Array<{ previewId?: string | number }>
    | undefined;
  const first = asArray(ids)[0] ?? (ids as { previewId?: string | number });
  const id = first?.previewId;
  if (id == null || id === "") {
    const etradeErr = etradeErrorMessage(resp);
    throw new Error(
      etradeErr
        ? `E*TRADE preview rejected: ${etradeErr}`
        : "No previewId returned — order may have been rejected",
    );
  }
  return String(id);
}

function extractMessages(resp: Record<string, unknown>): Array<{
  type: string;
  code: number | null;
  description: string;
}> {
  const preview = resp.PreviewOrderResponse as Record<string, unknown> | undefined;
  const order = preview?.Order as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
  const orderRow = asArray(order)[0] ?? (order as Record<string, unknown>);
  const messages = orderRow?.messages as { Message?: unknown } | undefined;
  return asArray(messages?.Message).map((m) => {
    const row = m as Record<string, unknown>;
    return {
      type: String(row.type ?? "INFO"),
      code: typeof row.code === "number" ? row.code : null,
      description: String(row.description ?? ""),
    };
  });
}

function orderSummary(order: OrderStrings): string {
  const expiryLabel = `${order.expiryMonth}/${order.expiryDay}/${order.expiryYear}`;
  let px: string;
  if (order.priceType === "LIMIT") {
    px = `@ $${order.limitPrice}`;
  } else if (order.priceType === "TRAILING_STOP_CNST") {
    px = `trail $${order.stopPrice} → MARKET`;
  } else {
    px = "MARKET";
  }
  return `${order.orderAction} ${order.quantity} ${order.symbol} ${expiryLabel} $${order.strikePrice} ${order.callPut} ${order.priceType} ${px} ${order.orderTerm}`;
}

function confirmPhrase(order: OrderStrings): string {
  return `PLACE ${order.orderAction} ${order.symbol} ${order.strikePrice} ${order.callPut}`;
}

async function resolveAccountKey(accountIdKey?: string): Promise<string> {
  return resolveAccountIdKey(accountIdKey);
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, row] of previewStore) {
    if (row.expiresAt <= now || row.used) previewStore.delete(key);
  }
}

export type OrderPreviewResult = {
  previewToken: string;
  confirmPhrase: string;
  summary: string;
  previewId: string;
  clientOrderId: string;
  accountIdKey: string;
  totalOrderValue: number | null;
  estimatedCommission: number | null;
  estimatedTotalAmount: number | null;
  symbolDescription: string | null;
  messages: Array<{ type: string; code: number | null; description: string }>;
  expiresAt: string;
  env: string;
};

export async function previewOptionOrder(input: OptionOrderInput): Promise<OrderPreviewResult> {
  requireTrading();
  purgeExpired();

  const accountIdKey = await resolveAccountKey(input.accountIdKey);
  const order = buildOrderStrings(input);
  const cid = clientOrderId();
  const payload = buildPreviewPayload(cid, order);

  const resp = await apiPost<Record<string, unknown>>(
    `/v1/accounts/${encodeURIComponent(accountIdKey)}/orders/preview`,
    payload,
  );

  const previewId = extractPreviewId(resp);
  const messages = extractMessages(resp);
  const preview = resp.PreviewOrderResponse as Record<string, unknown>;
  const orderResp = asArray(preview?.Order as unknown)[0] as Record<string, unknown> | undefined;
  const instrument = asArray(orderResp?.Instrument as unknown)[0] as
    | Record<string, unknown>
    | undefined;

  const placePayload = buildPlacePayload(cid, previewId, order);
  const token = crypto.randomUUID();
  const phrase = confirmPhrase(order);
  const summary = orderSummary(order);

  previewStore.set(token, {
    accountIdKey,
    clientOrderId: cid,
    previewId,
    placePayload,
    confirmPhrase: phrase,
    summary,
    expiresAt: Date.now() + PREVIEW_TTL_MS,
    used: false,
  });

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  return {
    previewToken: token,
    confirmPhrase: phrase,
    summary,
    previewId,
    clientOrderId: cid,
    accountIdKey,
    totalOrderValue: num(preview?.totalOrderValue),
    estimatedCommission: num(orderResp?.estimatedCommission),
    estimatedTotalAmount: num(orderResp?.estimatedTotalAmount),
    symbolDescription:
      instrument?.symbolDescription != null
        ? String(instrument.symbolDescription)
        : null,
    messages,
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
    env: process.env.ETRADE_ENV ?? "sandbox",
  };
}

export type OrderPlaceResult = {
  ok: true;
  orderId: string | null;
  orderType: string | null;
  symbolDescription: string | null;
  summary: string;
  accountIdKey: string;
  raw: Record<string, unknown>;
};

export async function placeOptionOrder(
  previewToken: string,
  confirm: string,
): Promise<OrderPlaceResult> {
  requireTrading();
  purgeExpired();

  const stored = previewStore.get(previewToken);
  if (!stored) {
    throw new Error("Preview expired or invalid — preview again before placing");
  }
  if (stored.used) {
    previewStore.delete(previewToken);
    throw new Error("Preview token already used");
  }
  if (stored.expiresAt <= Date.now()) {
    previewStore.delete(previewToken);
    throw new Error("Preview expired — preview again before placing");
  }
  if (confirm.trim() !== stored.confirmPhrase) {
    throw new Error(`Confirmation phrase must exactly match: ${stored.confirmPhrase}`);
  }

  stored.used = true;

  const resp = await apiPost<Record<string, unknown>>(
    `/v1/accounts/${encodeURIComponent(stored.accountIdKey)}/orders/place`,
    stored.placePayload,
  );

  previewStore.delete(previewToken);

  const place = resp.PlaceOrderResponse as Record<string, unknown> | undefined;
  const orderIds = asArray(
    place?.OrderIds as Array<{ orderId?: string | number }> | { orderId?: string | number },
  );
  const firstId = orderIds[0]?.orderId;
  const order = asArray(place?.Order as unknown)[0] as Record<string, unknown> | undefined;
  const instrument = asArray(order?.Instrument as unknown)[0] as
    | Record<string, unknown>
    | undefined;

  return {
    ok: true,
    orderId: firstId != null ? String(firstId) : null,
    orderType: place?.orderType != null ? String(place.orderType) : null,
    symbolDescription:
      instrument?.symbolDescription != null
        ? String(instrument.symbolDescription)
        : null,
    summary: stored.summary,
    accountIdKey: stored.accountIdKey,
    raw: resp,
  };
}

export type CancelOrderResult = {
  ok: true;
  orderId: string;
  cancelTime: string | null;
  accountId: string | null;
  confirmPhrase: string;
  messages: Array<{ type: string; code: number | null; description: string }>;
  raw: Record<string, unknown>;
};

export function cancelConfirmPhrase(orderId: string | number): string {
  return `CANCEL ORDER ${orderId}`;
}

export async function cancelOrder(opts: {
  accountIdKey?: string;
  orderId: string | number;
  confirm: string;
}): Promise<CancelOrderResult> {
  requireTrading();
  const orderId = String(opts.orderId).trim();
  if (!orderId) throw new Error("orderId required");
  const phrase = cancelConfirmPhrase(orderId);
  if (opts.confirm.trim() !== phrase) {
    throw new Error(`Confirmation phrase must exactly match: ${phrase}`);
  }

  const accountIdKey = await resolveAccountKey(opts.accountIdKey);
  const payload = {
    CancelOrderRequest: {
      orderId: Number(orderId),
    },
  };

  const resp = await apiPut<Record<string, unknown>>(
    `/v1/accounts/${encodeURIComponent(accountIdKey)}/orders/cancel`,
    payload,
  );

  const body = (resp.CancelOrderResponse ?? resp) as Record<string, unknown>;
  const messagesRoot = body.Messages ?? body.messages;
  const messages = asArray(
    (messagesRoot as { Message?: unknown } | undefined)?.Message ??
      (messagesRoot as { message?: unknown } | undefined)?.message,
  ).map((m) => {
    const row = m as Record<string, unknown>;
    return {
      type: String(row.type ?? "INFO"),
      code: typeof row.code === "number" ? row.code : null,
      description: String(row.description ?? ""),
    };
  });

  const cancelTimeRaw = body.cancelTime;
  const cancelTime =
    typeof cancelTimeRaw === "number"
      ? new Date(cancelTimeRaw).toISOString()
      : cancelTimeRaw != null
        ? String(cancelTimeRaw)
        : null;

  return {
    ok: true,
    orderId: body.orderId != null ? String(body.orderId) : orderId,
    cancelTime,
    accountId: body.accountId != null ? String(body.accountId) : null,
    confirmPhrase: phrase,
    messages,
    raw: resp,
  };
}

export function getTradingStatus(): {
  enabled: boolean;
  previewTtlSeconds: number;
  defaults: typeof FRO_TRADE_DEFAULTS;
} {
  return {
    enabled: tradingEnabled(),
    previewTtlSeconds: PREVIEW_TTL_MS / 1000,
    defaults: FRO_TRADE_DEFAULTS,
  };
}

export async function listAccountsForTrading(): Promise<EtradeAccount[]> {
  return listAccounts();
}

export async function getDefaultAccountPortfolio() {
  return getPortfolio();
}
