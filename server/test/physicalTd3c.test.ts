import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRelatedRoutes, parseTd3c } from "../physical";

describe("physical TD3C / route parsers", () => {
  const hellenic = `
    The rate for the TD3C route (270,000 mt Middle East Gulf to China) increased
    further this week with assessments rising from WS631.67 last Friday to WS677.22
    on Thursday. This gives a daily round-trip TCE of just under $704,000 for the
    standard Baltic VLCC. TD34 (Gulf of Oman/China) was 42 points higher than a week
    ago at WS272.5, meaning a round-trip TCE of over $261,800/day.
    In the Atlantic market, the rate for the 260,000 mt West Africa to China route
    (TD15) also strengthened, gaining 33 points to WS236.88, giving a round voyage
    TCE of about $210,600/day.
  `;

  it("prefers latest to-WS assessment over prior Friday WS", () => {
    const p = parseTd3c(hellenic);
    assert.equal(p.worldscale, 677.22);
    assert.equal(p.tceUsdPerDay, 704000);
  });

  it("parses TD34 / TD15 from Hellenic weekly prose", () => {
    const routes = parseRelatedRoutes(hellenic);
    const td34 = routes.find((r) => r.code === "TD34");
    const td15 = routes.find((r) => r.code === "TD15");
    assert.equal(td34?.worldscale, 272.5);
    assert.equal(td34?.tceUsdPerDay, 261800);
    assert.equal(td15?.worldscale, 236.88);
    assert.equal(td15?.tceUsdPerDay, 210600);
  });

  it("still parses classic Edge WS + TCE phrasing", () => {
    const edge =
      "On the TD3C (MEG-China) the rate was assessed at WS623 with a TCE of US$647,000/day.";
    const p = parseTd3c(edge);
    assert.equal(p.worldscale, 623);
    assert.equal(p.tceUsdPerDay, 647000);
  });
});
