import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  _mapCmeQuoteForTests,
  _parseCmeNumberForTests,
  _pickFrontMonthForTests,
  _resetCmeQuoteCacheForTests,
} from "../cmeQuotes";

describe("cmeQuotes parsers", () => {
  beforeEach(() => {
    _resetCmeQuoteCacheForTests();
  });

  it("parses CME last / volume strings", () => {
    assert.equal(_parseCmeNumberForTests("52.34"), 52.34);
    assert.equal(_parseCmeNumberForTests("+0.65"), 0.65);
    assert.equal(_parseCmeNumberForTests("-1.20"), -1.2);
    assert.equal(_parseCmeNumberForTests("532,369"), 532369);
    assert.equal(_parseCmeNumberForTests("78.12i"), 78.12);
    assert.equal(_parseCmeNumberForTests("+0.75%"), 0.75);
    assert.equal(_parseCmeNumberForTests("-"), null);
    assert.equal(_parseCmeNumberForTests(""), null);
  });

  it("picks highest-volume contract with a last print", () => {
    const front = _pickFrontMonthForTests([
      { last: "-", volume: "999,999", quoteCode: "CLZ9" },
      { last: "70.10", volume: "10,000", quoteCode: "CLV5" },
      { last: "71.00", volume: "250,000", quoteCode: "CLX5" },
      { last: "69.50", volume: "50,000", quoteCode: "CLZ5" },
    ]);
    assert.equal(front?.quoteCode, "CLX5");
  });

  it("prefers isFrontMonth flag when present", () => {
    const front = _pickFrontMonthForTests([
      { last: "70.10", volume: "10,000", quoteCode: "CLV5", isFrontMonth: false },
      { last: "71.00", volume: "100", quoteCode: "CLX5", isFrontMonth: true },
      { last: "69.50", volume: "50,000", quoteCode: "CLZ5", isFrontMonth: false },
    ]);
    assert.equal(front?.quoteCode, "CLX5");
  });

  it("maps a CME row into StockQuote with cme-group source", () => {
    const q = _mapCmeQuoteForTests(
      {
        last: "52.34",
        change: "+0.65",
        priorSettle: "51.69",
        open: "50.86",
        high: "53.16",
        low: "50.72",
        volume: "532,369",
        quoteCode: "CLH5",
        expirationMonth: "MAR 2015",
        productName: "Crude Oil Futures",
        productCode: "CL",
        updated: "16:43:15 CT<br /> 06 Feb 2015",
      },
      "CL=F",
      "10",
    );
    assert.equal(q.price, 52.34);
    assert.equal(q.change, 0.65);
    assert.ok(
      q.changePercent != null && Math.abs(q.changePercent - 1.257) < 0.01,
    );
    assert.equal(q.previousClose, 51.69);
    assert.equal(q.volume, 532369);
    assert.equal(q.symbol, "CLH5");
    assert.match(q.source, /^cme-group/);
    assert.match(q.shortName ?? "", /Crude Oil Futures/);
    assert.match(q.extendedAsOf ?? "", /16:43:15 CT/);
  });

  it("maps percentageChange from CME v2", () => {
    const q = _mapCmeQuoteForTests(
      {
        last: "92.17",
        change: "+0.69",
        percentageChange: "+0.75%",
        priorSettle: "91.48",
        quoteCode: "CLV6",
        productName: "Crude Oil Futures",
        isFrontMonth: true,
      },
      "CL=F",
      "10 minutes",
    );
    assert.equal(q.price, 92.17);
    assert.equal(q.changePercent, 0.75);
    assert.match(q.source, /cme-group/);
  });
});
