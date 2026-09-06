import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyNavwarnItems,
  isFreshNavwarn,
} from "../analytics/navwarnClassifier";
import { classifyOilSignal } from "../analytics/decisionFootprint";
import { applyHighGoGates, mergeStickyAerialTracks, resetLevantAerialStickyForTests } from "../analytics/israelStrikeTells";
import {
  classifyShekelSpike,
  isNoisyHexWatch,
  SHEKEL_ROC_FLOOR,
  SHEKEL_ROC_PCT,
  SHEKEL_SPIKE_HARD,
} from "../intelAlarm";
import {
  blackSeaSpillover,
  classifyDealHeadline,
} from "../dealAlarm";
import { carryForwardTheaterStamps, romeTalksRegime } from "../theaterWatch";
import { classifyGoLanguageItems } from "../analytics/goLanguage";
import {
  classifyFirmsSpike,
  classifyIranBlackoutItems,
} from "../analytics/softElevatedArms";
import { buildPoliticsCalendarChip } from "../analytics/politicsCalendar";
import {
  classifyStrategicPressure,
  MOSSAD_SHAKEUP_RE,
} from "../analytics/strategicPressure";
import { classifyEastAfricaCape } from "../analytics/eastAfricaCape";
import {
  openSkyLooksMilCallsign,
  openSkyStateToAdsbAc,
} from "../opensky";
import { mergeAviationNews } from "../aviationText";
import { isAerialTanker, isAwacs, classifyAerialKind, isCivOrVipAirframe, isFollowWorthyMil } from "../analytics/aerialClassify";
import {
  collectWatchlistLastGood,
  enrollLevantWatch,
  enrollWideTheaterWatch,
  followRegionHint,
  FOLLOW_SILENT_TTL_MS,
  getAerialWatchlist,
  HEX_LOOKUPS_PER_CYCLE,
  inWideTheaterFootprint,
  looksLanded,
  noteWatchMisses,
  partitionWatchHits,
  pickFollowLookups,
  resetAerialFollowForTests,
  shouldEnroll,
  TANKER_STICKY_TTL_MS,
  WATCH_MAX,
} from "../analytics/aerialFollow";
import {
  applyAerialLifecycle,
  classifyDarkReason,
  resetAerialEventsForTests,
} from "../analytics/aerialEvents";
import { rotateTheaterBoxes, type AdsbAc } from "../adsbLol";
import { matchAisWatchBox, wsDataToTextForTests } from "../aisstreamCyprus";

describe("aerialClassify", () => {
  it("does not treat Embraer Legacy E35L as AWACS", () => {
    assert.equal(isAwacs("E35L", "Embraer Legacy 600", "T7JET"), false);
    assert.equal(isAwacs("E35L", "", "VPCYH"), false);
    assert.equal(isAwacs("E35B", "Legacy 650", "N939AJ"), false);
  });

  it("still matches real E-3 / E-7 type codes", () => {
    assert.equal(isAwacs("E3TF", "Boeing E-3 Sentry", "NATO01"), true);
    assert.equal(isAwacs("E3A", "", ""), true);
    assert.equal(isAwacs("E7A", "Wedgetail", ""), true);
    assert.equal(isAwacs("", "boeing e-3 sentry", ""), true);
  });

  it("keeps KC-135 tanker typing", () => {
    assert.equal(isAerialTanker("K35R", "", "RCH044"), true);
    assert.equal(isAerialTanker("E35L", "Legacy 600", "VPCYH"), false);
  });

  it("does not treat Reach C-17 / C-130 as tankers (RCH446-style false HOT)", () => {
    assert.equal(isAerialTanker("C17", "", "RCH446"), false);
    assert.equal(isAerialTanker("C17", "", "MOOSE87"), false);
    assert.equal(isAerialTanker("C30J", "", "RCH900"), false);
    assert.equal(isAerialTanker("", "", "RCH446"), true);
    assert.equal(classifyAerialKind("C17", "", "RCH446", "tanker"), "mil");
  });
  it("reclassifies sticky false AWACS E35L down to mil", () => {
    assert.equal(
      classifyAerialKind("E35L", "Legacy 600", "VPCYH", "awacs"),
      "mil",
    );
    assert.equal(classifyAerialKind("E3TF", "", "NATO01", "mil"), "awacs");
    assert.equal(classifyAerialKind("K35R", "", "RCH044", "mil"), "tanker");
  });
  it("does not follow VIP airliners / EMS / firefighting as theater mil", () => {
    assert.equal(isCivOrVipAirframe("P180"), true);
    assert.equal(isCivOrVipAirframe("E35L"), true);
    assert.equal(isFollowWorthyMil("P180", "", ""), false);
    assert.equal(isCivOrVipAirframe("A139"), true);
    assert.equal(isCivOrVipAirframe("CL2T"), true);
    assert.equal(isFollowWorthyMil("B77W", "", "AUH08"), false);
    assert.equal(isFollowWorthyMil("K35R", "", ""), true);
    assert.equal(isFollowWorthyMil("C17", "", "RCH446"), true);
    assert.equal(
      shouldEnroll({
        hex: "896636",
        flight: "AUH08",
        t: "B77W",
        lat: 38.06,
        lon: 24.05,
        gs: 190,
        alt_baro: 3100,
        dbFlags: 1,
      }),
      false,
    );
    assert.equal(
      shouldEnroll({
        hex: "ae0149",
        flight: "",
        t: "K35R",
        lat: 25.25,
        lon: 56.18,
        gs: 442,
        alt_baro: 25000,
        dbFlags: 1,
      }),
      true,
    );
  });
});

describe("navwarnClassifier", () => {
  const now = Date.parse("2026-08-13T12:00:00Z");

  it("fires Lock 4 on fresh hard Gulf NAVWARN (ghost warm; Kharg → hot)", () => {
    const c = classifyNavwarnItems(
      [
        {
          title: "NAVWARN: dangerous operations Northern Persian Gulf",
          pubDate: "2026-08-12T10:00:00Z",
        },
      ],
      now,
    );
    assert.equal(c.lock4Triggered, true);
    assert.equal(c.ghostStatus, "warm");

    const hot = classifyNavwarnItems(
      [
        {
          title: "NAVWARN exclusion zone west of Kharg / Persian Gulf",
          pubDate: "2026-08-12T10:00:00Z",
        },
      ],
      now,
    );
    assert.equal(hot.lock4Triggered, true);
    assert.equal(hot.ghostStatus, "hot");
  });

  it("rejects stale NAVWARN outside window", () => {
    assert.equal(
      isFreshNavwarn("2026-07-01T00:00:00Z", 168 * 3600_000, now),
      false,
    );
    const c = classifyNavwarnItems(
      [
        {
          title: "NAVWARN Hormuz exclusion zone",
          pubDate: "2026-07-01T00:00:00Z",
        },
      ],
      now,
    );
    assert.equal(c.lock4Triggered, false);
    assert.equal(c.ghostStatus, "quiet");
    assert.ok(c.rejectedStale.length >= 1);
  });
});

describe("classifyOilSignal", () => {
  it("level alone is elevated at low weight, not full spike", () => {
    const r = classifyOilSignal({
      wtiPx: 85,
      brentPx: 90,
      wtiChg: 0.2,
      brentChg: 0.1,
      aerialElevated: false,
      aerialMass: false,
    });
    assert.equal(r.oilElevated, true);
    assert.equal(r.oilSpike, false);
    assert.equal(r.oilLit, true);
    assert.ok(r.oilWeight <= 4);
    assert.match(r.label, /elevated/i);
  });

  it("sharp % alone is full-ish oil_spike", () => {
    const r = classifyOilSignal({
      wtiPx: 70,
      brentPx: 75,
      wtiChg: 3.5,
      brentChg: 0,
      aerialElevated: false,
    });
    assert.equal(r.oilSpike, true);
    assert.equal(r.oilElevated, false);
    assert.ok(r.oilWeight >= 7);
  });

  it("fresh level+same-day % breach is oil_spike", () => {
    const r = classifyOilSignal({
      wtiPx: 83,
      brentPx: 80,
      wtiChg: 1.2,
      brentChg: 0,
    });
    assert.equal(r.oilSpike, true);
    assert.equal(r.oilElevated, false);
  });
});

describe("applyHighGoGates", () => {
  it("demotes High-go without AER-01 HOT", () => {
    assert.equal(
      applyHighGoGates({
        scenario: "high_confidence_go",
        aer01Hot: false,
        aerialTankerCount: 5,
        score: 80,
      }),
      "medium_confidence",
    );
  });

  it("demotes High-go with incomplete tanker count", () => {
    assert.equal(
      applyHighGoGates({
        scenario: "high_confidence_go",
        aer01Hot: true,
        aerialTankerCount: 2,
        score: 80,
      }),
      "medium_confidence",
    );
  });

  it("keeps High-go when AER HOT + tankers + score", () => {
    assert.equal(
      applyHighGoGates({
        scenario: "high_confidence_go",
        aer01Hot: true,
        aerialTankerCount: 3,
        score: 55,
        aerialAwacsCount: 1,
      }),
      "high_confidence_go",
    );
  });

  it("demotes High-go when AWACS=0 (incomplete stack)", () => {
    assert.equal(
      applyHighGoGates({
        scenario: "high_confidence_go",
        aer01Hot: true,
        aerialTankerCount: 4,
        score: 47,
        aerialAwacsCount: 0,
      }),
      "medium_confidence",
    );
  });
});

describe("classifyShekelSpike", () => {
  it("hard threshold spikes", () => {
    const r = classifyShekelSpike(SHEKEL_SPIKE_HARD, 0);
    assert.equal(r.spiked, true);
    assert.equal(r.regime, "spiked");
  });

  it("roc floor + pct spikes", () => {
    const r = classifyShekelSpike(SHEKEL_ROC_FLOOR, SHEKEL_ROC_PCT);
    assert.equal(r.spiked, true);
  });

  it("quiet below firm", () => {
    const r = classifyShekelSpike(3.2, 0.1);
    assert.equal(r.spiked, false);
    assert.equal(r.regime, "quiet");
  });
});

describe("isNoisyHexWatch", () => {
  it("marks K35R on watched hex as noisy (not Mercury)", () => {
    assert.equal(
      isNoisyHexWatch({ hex: "AE041D", t: "K35R", desc: "STRATOTANKER" }),
      true,
    );
  });

  it("does not mark confirmed E-6 type as noisy", () => {
    assert.equal(isNoisyHexWatch({ hex: "AE041D", t: "E6", desc: "MERCURY" }), false);
  });
});

describe("romeTalksRegime", () => {
  it("always returns calendar_gap while walkout arm disabled", () => {
    assert.equal(romeTalksRegime(), "calendar_gap");
  });
});

describe("classifyGoLanguageItems", () => {
  it("hots on Home Front / shelter hard language", () => {
    const c = classifyGoLanguageItems(
      [
        {
          title: "Home Front Command tells civilians to open shelters amid Iran tension",
          pubDate: "2026-08-13T10:00:00Z",
          link: "https://example.com/hfc-shelters",
          source: "Kan",
        },
      ],
      Date.parse("2026-08-13T12:00:00Z"),
    );
    assert.equal(c.status, "hot");
    assert.ok(c.hardHits.length >= 1);
    assert.equal(c.hardHits[0]?.link, "https://example.com/hfc-shelters");
    assert.equal(c.hardHits[0]?.source, "Kan");
    assert.match(c.hardHits[0]?.title ?? "", /Home Front Command/);
  });

  it("warms on soft strike-prep language", () => {
    const c = classifyGoLanguageItems(
      [{ title: "IDF preparing to strike Iran if talks fail", pubDate: "2026-08-13T10:00:00Z" }],
      Date.parse("2026-08-13T12:00:00Z"),
    );
    assert.equal(c.status, "warm");
  });

  it("ignores Home Front Command foreign SAR / Colombia earthquake aid", () => {
    const c = classifyGoLanguageItems(
      [
        {
          title:
            "IDF: Preparations for the departure of the humanitarian delegation to Colombia: The humanitarian delegation led by the Home Front Command departed last night for Colombia",
          pubDate: "2026-08-14T07:17:58Z",
          source: "IDF Official",
        },
        {
          title:
            'משלחת "ברית רעים" של צה"ל, בהובלה משותפת של פיקוד העורף, תמריא לקולומביה בעקבות רעידת האדמה',
          pubDate: "2026-08-14T06:46:01Z",
          source: "Abu Ali Express",
        },
      ],
      Date.parse("2026-08-14T16:00:00Z"),
    );
    assert.equal(c.status, "quiet");
    assert.equal(c.hardHits.length, 0);
    assert.equal(c.softHits.length, 0);
  });
});

describe("softElevatedArms", () => {
  it("classifies Iran blackout headlines", () => {
    const a = classifyIranBlackoutItems(
      [
        {
          title: "Iran cuts internet nationwide amid protests — blackout reported",
          pubDate: "2026-08-13T08:00:00Z",
        },
      ],
      Date.parse("2026-08-13T12:00:00Z"),
    );
    assert.equal(a.lit, true);
    assert.ok(a.status === "warm" || a.status === "hot");
  });

  it("FIRMS spike when Hormuz counts elevated", () => {
    const quiet = classifyFirmsSpike({ hormuzCount: 5, babCount: 2, israelRegionCount: 1 });
    assert.equal(quiet.status, "quiet");
    const hot = classifyFirmsSpike({ hormuzCount: 45, babCount: 10, israelRegionCount: 5 });
    assert.equal(hot.status, "hot");
  });
});

describe("buildPoliticsCalendarChip", () => {
  it("keeps Hormuz MOU Sunday as PAST archive and surfaces Likud within horizon", () => {
    const chip = buildPoliticsCalendarChip(new Date("2026-08-13T12:00:00Z"));
    assert.ok(!chip.upcoming.some((e) => e.id.includes("mou")));
    assert.ok(chip.upcoming.some((e) => e.id.includes("likud")));
    assert.ok(chip.headline);
    assert.match(chip.headline!, /Likud/i);
    assert.ok(!chip.headline!.includes("Watch fall"));
    assert.ok(!/MOU|Sunday deadline/i.test(chip.headline!));
  });
});

describe("classifyStrategicPressure", () => {
  it("flags Mossad shakeup / failed plan headlines", () => {
    assert.ok(
      MOSSAD_SHAKEUP_RE.test(
        "Two senior Mossad officials fired over failed Iran regime-change plan",
      ),
    );
    const hits = classifyStrategicPressure(
      [
        {
          title:
            "Mossad Intelligence Directorate and Iran Division heads fired over failed destabilize plan",
          pubDate: "2026-08-12T10:00:00Z",
        },
      ],
      Date.parse("2026-08-13T12:00:00Z"),
    );
    const m = hits.find((h) => h.id === "mossad_shakeup");
    assert.ok(m?.lit);
  });

  it("flags Iran recovery mid-2027 restore language", () => {
    const hits = classifyStrategicPressure(
      [
        {
          title:
            "Israeli intelligence believes Iran's military will be fully restored to pre-war status by mid-2027",
          pubDate: "2026-08-12T10:00:00Z",
        },
      ],
      Date.parse("2026-08-13T12:00:00Z"),
    );
    assert.ok(hits.find((h) => h.id === "idf_recovery_stun")?.lit);
  });

  it("POL-03 rejects Autonomous/mourning MOU substring false positives", () => {
    const now = Date.parse("2026-08-15T12:00:00Z");
    const hits = classifyStrategicPressure(
      [
        {
          title:
            "Naval Academy Integrates Robotics, Autonomous Systems Into Summer Training",
          pubDate: "2026-08-14T10:00:00Z",
        },
        {
          title:
            "Red lights at Imam Hussein holy shrine in Karbala as mourning begins",
          pubDate: "2026-08-14T11:00:00Z",
        },
      ],
      now,
    );
    const mou = hits.find((h) => h.id === "mou_deadline_chatter");
    assert.equal(mou?.status, "quiet");
    assert.equal(mou?.lit, false);
    assert.deepEqual(mou?.evidence ?? [], []);
  });

  it("POL-03 Hormuz MOU / Sunday deadline arm is PAST and DISABLED", () => {
    const now = Date.parse("2026-08-15T12:00:00Z");
    const hits = classifyStrategicPressure(
      [
        {
          title: "US–Iran Hormuz MOU faces Sunday deadline as talks stall",
          pubDate: "2026-08-14T10:00:00Z",
        },
        {
          title:
            "Trump presses memorandum of understanding on Strait of Hormuz transit",
          pubDate: "2026-08-14T12:00:00Z",
        },
      ],
      now,
    );
    const mou = hits.find((h) => h.id === "mou_deadline_chatter");
    assert.equal(mou?.lit, false);
    assert.equal(mou?.status, "quiet");
    assert.deepEqual(mou?.evidence ?? [], []);
    assert.match(mou?.read ?? "", /PAST|DISABLED/i);
  });
});

describe("classifyEastAfricaCape", () => {
  const now = Date.parse("2026-08-14T18:00:00Z");
  const pub = "2026-08-14T12:00:00Z";

  it("stays quiet on inland al-Shabaab / hotel headlines", () => {
    const c = classifyEastAfricaCape(
      [
        { title: "al-Shabaab suicide bombers attack hotel in Mogadishu", pubDate: pub },
        { title: "al-Shabaab drone strike hits Somali army base inland", pubDate: pub },
      ],
      now,
    );
    assert.equal(c.regime, "quiet");
    assert.equal(c.signals.find((s) => s.id === "maritime_claim")?.lit, false);
    assert.equal(c.signals.find((s) => s.id === "somali_vlcc")?.lit, false);
    assert.equal(c.signals.find((s) => s.id === "houthi_transfer")?.lit, false);
  });

  it("watches a single maritime-capability claim (not Cape-closed)", () => {
    const c = classifyEastAfricaCape(
      [
        {
          title: "al-Shabaab claims maritime capability to hit ships off the Somali coast",
          pubDate: pub,
        },
      ],
      now,
    );
    assert.equal(c.regime, "watch");
    assert.equal(c.signals.find((s) => s.id === "maritime_claim")?.status, "warm");
    assert.match(c.read, /freight overlay|watch/i);
    assert.ok(!/Cape-closed/.test(c.read) || /not/.test(c.read));
  });

  it("forms on Houthi transfer + Puntland/Bosaso cluster", () => {
    const c = classifyEastAfricaCape(
      [
        {
          title: "Houthis transferring anti-ship missiles to al-Shabaab in Somalia",
          pubDate: pub,
        },
        {
          title: "U.S. expands AFRICOM military footprint in Bosaso, Puntland",
          pubDate: pub,
        },
      ],
      now,
    );
    assert.equal(c.regime, "forming");
    assert.ok(c.signals.find((s) => s.id === "houthi_transfer")?.lit);
    assert.ok(c.signals.find((s) => s.id === "puntland_base")?.lit);
  });

  it("treats Yemen training of al-Shabaab as transfer watch, not go", () => {
    const c = classifyEastAfricaCape(
      [
        {
          title:
            "Hundreds of al-Shabaab fighters travelled to Yemen for maritime drone training",
          pubDate: pub,
        },
      ],
      now,
    );
    assert.ok(c.signals.find((s) => s.id === "houthi_transfer")?.lit);
    assert.ok(c.regime === "watch" || c.regime === "forming");
  });

  it("goes hot on repeated Somali-basin VLCC headlines without printing High-go", () => {
    const c = classifyEastAfricaCape(
      [
        { title: "VLCC attacked off Somali coast near Kismayo", pubDate: pub },
        { title: "Oil tanker struck in the Somali basin, al-Shabaab claimed", pubDate: pub },
      ],
      now,
    );
    assert.equal(c.regime, "hot");
    assert.equal(c.signals.find((s) => s.id === "somali_vlcc")?.status, "hot");
    assert.match(c.read, /Not Israel High-go/i);
    assert.match(c.read, /not automatic Cape-closed/i);
  });

  it("ignores stale headlines outside 72h", () => {
    const c = classifyEastAfricaCape(
      [
        {
          title: "VLCC attacked off Somali coast near Kismayo",
          pubDate: "2026-08-10T12:00:00Z",
        },
      ],
      now,
    );
    assert.equal(c.regime, "quiet");
  });
});

describe("blackSeaSpillover (dealAlarm blind-spot #7)", () => {
  it("rejects RivieraMM-style status-quo / ceasefire churn", () => {
    const noise = [
      "Black Sea strikes on merchant ships continue as Russia rejects reported Ukrainian ceasefire proposal - rivieramm.com",
      "Russia rejects Ukrainian ceasefire proposal amid ongoing Black Sea attacks",
      "NATO discusses Black Sea security as strikes continue",
      "Black Sea grain exports face uncertainty after diplomatic talks stall",
    ];
    for (const t of noise) {
      assert.equal(blackSeaSpillover(t), false, t);
      assert.equal(classifyDealHeadline(t), null, t);
    }
  });

  it("fires HOLD on merchant hit, port closure, or grain corridor death", () => {
    const hard = [
      "Merchant ship struck by missile in Black Sea near Odesa",
      "Grain freighter damaged after drone attack in Black Sea",
      "Ukraine closes Odesa port after Black Sea mining threat",
      "Black Sea grain corridor suspended after latest attacks",
      "Russia ends Black Sea grain deal — exports halt",
    ];
    for (const t of hard) {
      assert.equal(blackSeaSpillover(t), true, t);
      const ev = classifyDealHeadline(t);
      assert.ok(ev, t);
      assert.equal(ev!.kind, "black_sea_spillover");
      assert.equal(ev!.action, "hold");
    }
  });
});

describe("dealAlarm usBlink false positives", () => {
  it("does not TRIM on Iran ultimatum demanding US lift blockade (serious/us substring)", () => {
    const t =
      "Iran has issued an ultimatum to the United States to return to serious diplomacy and lift the naval blockade, threatening an expansion of the war if these demands are not met.";
    const ev = classifyDealHeadline(t);
    assert.ok(ev, t);
    assert.notEqual(ev!.kind, "us_blink", t);
    assert.equal(ev!.kind, "deal_breakdown");
    assert.equal(ev!.action, "hold");
  });

  it("still TRIMs on enacted US sanctions/blockade relief", () => {
    const t =
      "White House lifts naval blockade and eases Iran oil sanctions after Oman deal framework";
    const ev = classifyDealHeadline(t);
    assert.ok(ev);
    assert.equal(ev!.kind, "us_blink");
    assert.equal(ev!.action, "trim");
  });
});

describe("openskyFailover", () => {
  it("maps OpenSky state vectors to AdsbAc with callsign mil heuristic", () => {
    const row = [
      "ae4a2f",
      "RCH123  ",
      "United States",
      1,
      1,
      34.8,
      32.0,
      10000,
      false,
      200,
      270,
      0,
      null,
      10500,
      "1200",
      false,
      0,
    ];
    const ac = openSkyStateToAdsbAc(row);
    assert.ok(ac);
    assert.equal(ac!.hex, "ae4a2f");
    assert.equal(ac!.flight?.trim(), "RCH123");
    assert.equal(ac!.lat, 32.0);
    assert.equal(ac!.lon, 34.8);
    assert.ok(openSkyLooksMilCallsign("RCH123"));
    assert.equal(!!(ac!.dbFlags && ac!.dbFlags & 1), true);
    assert.equal(openSkyLooksMilCallsign("THY8AB"), false);
  });
});

describe("aviationTextMerge", () => {
  it("dedupes titles across free aviation batches", () => {
    const out = mergeAviationNews(
      [
        [{ title: "NOTAM Cyprus", link: "a", pubDate: "x", source: "g" }],
        [{ title: "NOTAM Cyprus", link: "b", pubDate: "y", source: "e" }],
        [{ title: "SIGMET LLBB", link: "c", pubDate: "z", source: "awc" }],
      ],
      10,
    );
    assert.equal(out.length, 2);
    assert.equal(out[0]!.title, "NOTAM Cyprus");
    assert.equal(out[1]!.title, "SIGMET LLBB");
  });
});

describe("aerialFollow", () => {
  it("enrolls tanker/mil in-box and follows them outside without scoring them in the partition", () => {
    resetAerialFollowForTests();
    const now = "2026-08-17T17:43:00Z";
    const tankerIn: AdsbAc = {
      hex: "ae0263",
      flight: "TEXACO1",
      t: "K35R",
      lat: 31.7,
      lon: 34.5,
      gs: 400,
      alt_baro: 19000,
      dbFlags: 1,
    };
    enrollLevantWatch([tankerIn], now);
    const tankerOut: AdsbAc = {
      ...tankerIn,
      lat: 29.1,
      lon: 47.9,
    };
    const civ: AdsbAc = {
      hex: "4ca87c",
      flight: "ELY001",
      t: "B738",
      lat: 32.0,
      lon: 34.8,
      gs: 420,
      alt_baro: 35000,
    };
    const part = partitionWatchHits({
      acs: [tankerOut, civ],
      inBox: (a) =>
        (a.lat ?? 0) >= 29.5 &&
        (a.lat ?? 0) <= 36.5 &&
        (a.lon ?? 0) >= 31 &&
        (a.lon ?? 0) <= 37.5,
    });
    assert.equal(part.followed.length, 1);
    assert.equal(part.followed[0]!.hex, "ae0263");
    assert.equal(part.inBox.length, 1);
    assert.equal(part.inBox[0]!.hex, "4ca87c");
    assert.equal(looksLanded({ hex: "ae0263", alt_baro: "ground", gs: 5 }), true);
    assert.equal(shouldEnroll(civ), false);
    assert.equal(shouldEnroll(tankerIn), true);
    assert.equal(followRegionHint(26.0, 54.0), "Gulf/Hormuz");
    assert.equal(followRegionHint(31.7, 34.5), "Levant/E-Med");
  });

  it("enrolls military across the wide theater footprint, not Levant-only", () => {
    resetAerialFollowForTests();
    const now = "2026-08-17T17:50:00Z";
    const gulfKc: AdsbAc = {
      hex: "ae9999",
      flight: "SHELL99",
      t: "K35R",
      lat: 26.0,
      lon: 54.0,
      gs: 400,
      alt_baro: 28000,
      dbFlags: 1,
    };
    const redSeaC17: AdsbAc = {
      hex: "ae144c",
      flight: "RCH446",
      t: "C17",
      lat: 18.0,
      lon: 40.0,
      gs: 420,
      alt_baro: 33000,
      dbFlags: 1,
    };
    const conusKc: AdsbAc = {
      hex: "ae0001",
      flight: "TEXACO9",
      t: "K35R",
      lat: 38.0,
      lon: -97.0,
      gs: 400,
      alt_baro: 28000,
      dbFlags: 1,
    };
    enrollWideTheaterWatch([gulfKc, redSeaC17, conusKc], now);
    const part = partitionWatchHits({
      acs: [
        { ...gulfKc, lat: 42.0, lon: 12.0 },
        conusKc,
      ],
      inBox: () => false,
    });
    assert.equal(part.followed.some((a) => a.hex === "ae9999"), true);
    assert.equal(part.followed.some((a) => a.hex === "ae0001"), false);
    assert.equal(inWideTheaterFootprint(gulfKc), true);
    assert.equal(inWideTheaterFootprint(conusKc), false);
  });

  it("does not follow unwatched global mil", () => {
    resetAerialFollowForTests();
    const gulfKc: AdsbAc = {
      hex: "ae9999",
      flight: "SHELL99",
      t: "K35R",
      lat: 26.0,
      lon: 54.0,
      gs: 400,
      alt_baro: 28000,
      dbFlags: 1,
    };
    const part = partitionWatchHits({
      acs: [gulfKc],
      inBox: () => false,
    });
    assert.equal(part.followed.length, 0);
    assert.equal(part.inBox.length, 0);
  });

  it("looks up more than three missing hexes per cycle (tankers first)", () => {
    resetAerialFollowForTests();
    const now = "2026-08-17T18:00:00Z";
    const acs: AdsbAc[] = [];
    for (let i = 0; i < 10; i += 1) {
      acs.push({
        hex: `ae10${i.toString().padStart(2, "0")}`,
        flight: `TEX${i}`,
        t: "K35R",
        lat: 26 + i * 0.1,
        lon: 54,
        gs: 400,
        alt_baro: 28000,
        dbFlags: 1,
      });
    }
    enrollWideTheaterWatch(acs, now);
    const picked = pickFollowLookups(
      acs.map((a) => a.hex!),
      Date.now(),
    );
    assert.equal(picked.length, HEX_LOOKUPS_PER_CYCLE);
    assert.ok(HEX_LOOKUPS_PER_CYCLE >= 8);
  });

  it("does not evict a DARK tanker when the watchlist fills with newer mil", () => {
    resetAerialFollowForTests();
    const now = "2026-08-17T18:10:00Z";
    const tanker: AdsbAc = {
      hex: "ae0263",
      flight: "TEXACO1",
      t: "K35R",
      lat: 31.7,
      lon: 34.5,
      gs: 400,
      alt_baro: 19000,
      track: 10,
      dbFlags: 1,
    };
    enrollLevantWatch([tanker], now);
    const mil: AdsbAc[] = [];
    for (let i = 0; i < WATCH_MAX; i += 1) {
      mil.push({
        hex: `ae2${i.toString(16).padStart(4, "0")}`,
        flight: `RCH${i}`,
        t: "C17",
        lat: 26.0,
        lon: 54.0 + (i % 8) * 0.1,
        gs: 420,
        alt_baro: 33000,
        dbFlags: 1,
      });
    }
    enrollWideTheaterWatch(mil, "2026-08-17T18:12:00Z");
    const hexes = getAerialWatchlist().map((w) => w.hex);
    assert.ok(hexes.includes("ae0263"));
    assert.ok(getAerialWatchlist().length <= WATCH_MAX);
  });

  it("keeps DARK tankers on last-good for the sticky window and does not prune at ~72s", () => {
    resetAerialFollowForTests();
    const t0 = Date.parse("2026-08-17T18:20:00Z");
    const tanker: AdsbAc = {
      hex: "ae05ad",
      flight: "SHELL11",
      t: "K35R",
      lat: 32.1,
      lon: 34.8,
      gs: 410,
      alt_baro: 21000,
      track: 5,
      dbFlags: 1,
    };
    enrollLevantWatch([tanker], new Date(t0).toISOString());
    const plus72 = new Date(t0 + 72_000).toISOString();
    noteWatchMisses(new Set(), plus72);
    const at72 = collectWatchlistLastGood(new Set(), t0 + 72_000);
    assert.equal(at72.some((w) => w.hex === "ae05ad"), true);
    assert.equal(at72.find((w) => w.hex === "ae05ad")!.stale, true);
    assert.ok((at72.find((w) => w.hex === "ae05ad")!.ageSec ?? 0) >= 70);
    assert.equal(at72.find((w) => w.hex === "ae05ad")!.trackDeg, 5);

    const at25m = collectWatchlistLastGood(new Set(), t0 + 25 * 60_000);
    assert.equal(at25m.some((w) => w.hex === "ae05ad"), true);

    const at31m = collectWatchlistLastGood(new Set(), t0 + TANKER_STICKY_TTL_MS + 5_000);
    assert.equal(at31m.some((w) => w.hex === "ae05ad"), false);
    assert.equal(
      getAerialWatchlist().some((w) => w.hex === "ae05ad"),
      true,
      "hex stay enrolled for follow lookups after display TTL",
    );

    noteWatchMisses(new Set(), new Date(t0 + FOLLOW_SILENT_TTL_MS + 1_000).toISOString());
    assert.equal(
      getAerialWatchlist().some((w) => w.hex === "ae05ad"),
      false,
    );
  });

  it("DARK last-good is display-only and does not satisfy High-go tanker count", () => {
    resetAerialFollowForTests();
    const t0 = Date.parse("2026-08-17T18:30:00Z");
    enrollLevantWatch(
      [
        {
          hex: "ae0263",
          flight: "TEXACO1",
          t: "K35R",
          lat: 31.7,
          lon: 34.5,
          gs: 400,
          alt_baro: 19000,
          dbFlags: 1,
        },
      ],
      new Date(t0).toISOString(),
    );
    const dark = collectWatchlistLastGood(new Set(), t0 + 180_000);
    assert.ok(dark.length >= 1);
    assert.equal(
      applyHighGoGates({
        scenario: "high_confidence_go",
        aer01Hot: true,
        aerialTankerCount: 0,
        score: 80,
        aerialAwacsCount: 1,
      }),
      "medium_confidence",
    );
  });
});

describe("levant aerial sticky merge", () => {
  it("keeps a dropped tanker on last-good with heading after a live miss", () => {
    resetAerialFollowForTests();
    resetLevantAerialStickyForTests();
    const t0 = "2026-08-17T18:40:00Z";
    const live = {
      hex: "ae0263",
      callsign: "TEXACO1",
      kind: "tanker" as const,
      acType: "K35R",
      lat: 31.72,
      lon: 34.51,
      trackDeg: 350,
      gsKt: 420,
      altFt: 19000,
      bearingHint: "northbound" as const,
      trail: [{ lat: 31.72, lon: 34.51, at: t0 }],
      source: "adsb.lol" as const,
      inBox: true,
      followed: false,
    };
    const first = mergeStickyAerialTracks([live], t0, { feedFullyFailed: false });
    assert.equal(first.live.length, 1);
    assert.equal(first.lastGood.length, 0);
    const later = mergeStickyAerialTracks([], "2026-08-17T18:41:12Z", {
      feedFullyFailed: false,
    });
    assert.equal(later.live.length, 0);
    const dark = later.lastGood.find((t) => t.hex === "ae0263");
    assert.ok(dark);
    assert.equal(dark!.stale, true);
    assert.equal(dark!.trackDeg, 350);
    assert.ok((dark!.ageSec ?? 0) >= 70);
  });
});

describe("naval stamp last-good", () => {
  it("keeps previous IRONSIGHT pins when the live pack is empty", () => {
    const prev = [
      {
        id: "arg-LHD-5",
        kind: "arg" as const,
        label: "Bataan",
        lat: 26.2,
        lon: 52.1,
        status: "Gulf",
        region: "Gulf",
      },
    ];
    const dark = carryForwardTheaterStamps([], prev, Date.now() - 60_000);
    assert.equal(dark.length, 1);
    assert.equal(dark[0]!.stale, true);
    const live = carryForwardTheaterStamps(
      [{ ...prev[0]!, stale: false }],
      prev,
    );
    assert.equal(live.length, 1);
    assert.equal(live[0]!.stale, false);
  });
});

describe("rotateTheaterBoxes", () => {
  it("always polls Gulf + alwaysPoll corridor and rotates fringe", () => {
    const boxes = [
      { id: "gulf", countsForGulfRegime: true },
      { id: "iraq", countsForGulfRegime: false, alwaysPoll: true },
      { id: "syria", countsForGulfRegime: false, alwaysPoll: true },
      { id: "saudi", countsForGulfRegime: false },
      { id: "iran", countsForGulfRegime: false },
      { id: "redsea", countsForGulfRegime: false },
    ];
    const a = rotateTheaterBoxes(boxes, { idx: 0 }, 2);
    const ids = a.selected.map((b) => b.id);
    assert.ok(ids.includes("gulf"));
    assert.ok(ids.includes("iraq"));
    assert.ok(ids.includes("syria"));
    assert.equal(a.selected.length, 5);
    const b = rotateTheaterBoxes(boxes, { idx: a.nextIdx }, 2);
    const fringe = [...ids, ...b.selected.map((x) => x.id)].filter(
      (id) => id === "saudi" || id === "iran" || id === "redsea",
    );
    assert.ok(new Set(fringe).size >= 3);
  });

  it("skips fringe tiles when perCycle is 0 so hex-follow can take the budget", () => {
    const boxes = [
      { id: "gulf", countsForGulfRegime: true },
      { id: "iraq", countsForGulfRegime: false, alwaysPoll: true },
      { id: "saudi", countsForGulfRegime: false },
      { id: "iran", countsForGulfRegime: false },
    ];
    const a = rotateTheaterBoxes(boxes, { idx: 0 }, 0);
    const ids = a.selected.map((b) => b.id);
    assert.ok(ids.includes("gulf"));
    assert.ok(ids.includes("iraq"));
    assert.equal(ids.includes("saudi"), false);
    assert.equal(ids.includes("iran"), false);
  });
});

describe("AIS watch boxes", () => {
  it("matches Cyprus / Hormuz / Bab and not Tel Aviv", () => {
    assert.equal(matchAisWatchBox(34.7, 33.0), "cyprus");
    assert.equal(matchAisWatchBox(26.5, 56.3), "hormuz");
    assert.equal(matchAisWatchBox(12.6, 43.4), "bab");
    assert.equal(matchAisWatchBox(32.08, 34.78), null);
  });

  it("decodes Blob / ArrayBuffer AIS frames (not [object Blob])", async () => {
    const payload = JSON.stringify({
      MessageType: "PositionReport",
      MetaData: { MMSI: 1 },
    });
    const bytes = Uint8Array.from(Buffer.from(payload));
    const fromAb = await wsDataToTextForTests(bytes.buffer);
    assert.equal(fromAb, payload);
    const blob = new Blob([payload], { type: "application/json" });
    const fromBlob = await wsDataToTextForTests(blob);
    assert.equal(fromBlob, payload);
    assert.equal(String(blob), "[object Blob]");
  });
});

describe("froCatalyst", () => {
  it("flags collapsed Hormuz transits", () => {
    const { scoreHormuzTransits } = require("../analytics/froCatalyst") as typeof import("../analytics/froCatalyst");
    const hot = scoreHormuzTransits({
      id: "hormuz",
      name: "Hormuz",
      portid: "chokepoint6",
      latest: {
        date: "2026-08-10",
        nTotal: 8,
        nTanker: 3,
        nCargo: 2,
        nContainer: 1,
        nDryBulk: 2,
      },
      prev: null,
      changePct7d: -40,
      avg7d: 20,
      avg30d: 45,
      points: [],
      note: "",
    });
    assert.equal(hot.status, "hot");
  });

  it("detects physical divergence when TD3C lags and BDTI flat", () => {
    const { scorePhysicalGap } = require("../analytics/froCatalyst") as typeof import("../analytics/froCatalyst");
    const gap = scorePhysicalGap(
      {
        latest: { date: "2026-08-14", value: 2100 },
        prev: { date: "2026-08-13", value: 2095 },
        changePct1d: 0.2,
        changePct5d: 1.5,
        points: [],
        sourceUrl: "",
        note: "",
        structuralBias: "unknown",
        biasNote: "",
        asOf: "",
        lagDays: 4,
      },
      {
        worldscale: 420,
        tceUsdPerDay: 120000,
        asOfLabel: "Aug 7",
        asOfIso: "2026-08-07",
        lagDays: 10,
        lagHours: 240,
        route: "TD3C",
        excerpt: "",
        sourceUrl: null,
        sourceTitle: null,
        note: "",
        relatedRoutes: [],
        periodCharter: null,
        deepLinks: [],
        discoveryMethod: null,
        candidatesTried: 0,
        honestyGaps: [],
      },
    );
    assert.equal(gap.gap, "diverging");
  });

  it("builds catastrophe regime when Hormuz hot and BDTI rising", () => {
    const { buildFroCatalystFromInputs } = require("../analytics/froCatalyst") as typeof import("../analytics/froCatalyst");
    const report = buildFroCatalystFromInputs({
      chokepoints: {
        asOf: "",
        dataAsOf: "2026-08-10",
        dataLagDays: 20,
        source: "",
        portal: "",
        lagNote: "",
        read: "",
        deepLinks: [],
        hormuz: {
          id: "hormuz",
          name: "Hormuz",
          portid: "chokepoint6",
          latest: {
            date: "2026-08-10",
            nTotal: 6,
            nTanker: 2,
            nCargo: 1,
            nContainer: 0,
            nDryBulk: 3,
          },
          prev: null,
          changePct7d: -50,
          avg7d: 12,
          avg30d: 40,
          points: [],
          note: "",
        },
        bab: {
          id: "bab",
          name: "Bab",
          portid: "chokepoint4",
          latest: null,
          prev: null,
          changePct7d: null,
          avg7d: null,
          avg30d: null,
          points: [],
          note: "",
        },
        cape: {
          id: "cape",
          name: "Cape",
          portid: "chokepoint7",
          latest: null,
          prev: null,
          changePct7d: null,
          avg7d: null,
          avg30d: null,
          points: [],
          note: "",
        },
      },
      physical: null,
      bdti: {
        latest: { date: "2026-08-14", value: 2300 },
        prev: { date: "2026-08-13", value: 2200 },
        changePct1d: 4.5,
        changePct5d: 10,
        points: [],
        sourceUrl: "",
        note: "",
        structuralBias: "structural",
        biasNote: "",
        asOf: "",
        lagDays: 4,
      },
      deal: null,
      surprise: null,
      theater: null,
    });
    assert.equal(report.regime, "catastrophe");
    assert.equal(report.catalysts.find((c) => c.id === "hormuz_transits")?.status, "hot");
  });
});

describe("mideast named-target + kinetic rewind", () => {
  const {
    matchNamedTargets,
    findTargetById,
  } = require("../analytics/mideastTargets") as typeof import("../analytics/mideastTargets");
  const {
    classifyKineticHeadline,
    isJordanEastCorridor,
    rewindHitsNearTarget,
    rewindBbox,
    haversineKm,
    KINETIC_HONESTY,
  } = require("../analytics/kineticRewind") as typeof import("../analytics/kineticRewind");

  it("matches Gaza / Golan / Jordan corridor pins", () => {
    const rafah = matchNamedTargets("IDF struck Rafah overnight");
    assert.equal(rafah[0]?.id, "rafah");
    const golan = matchNamedTargets("Israel hits Mount Hermon on the Golan");
    assert.ok(golan.some((t) => t.id === "mount-hermon"));
    const strip = matchNamedTargets("Strike on the Gaza Strip reported");
    assert.equal(strip[0]?.id, "gaza-strip");
    const azraq = matchNamedTargets("KC-135s staged near Azraq / Muwaffaq Salti");
    assert.ok(azraq.some((t) => t.id === "azraq"));
  });

  it("matches Abu al-Duhur / T4 / Tiyas name variants", () => {
    const abu = matchNamedTargets(
      "Israel strikes Abu al-Duhur airbase in Idlib",
    );
    assert.equal(abu[0]?.id, "abu-al-duhur");
    const t4 = matchNamedTargets("IDF hit T-4 / Tiyas airbase in Homs");
    assert.ok(t4.some((t) => t.id === "t4-tiyas"));
    const t4bare = matchNamedTargets("Israel struck T4 airbase overnight");
    assert.ok(t4bare.some((t) => t.id === "t4-tiyas"));
    assert.equal(findTargetById("abu-al-duhur")?.lat.toFixed(2), "35.73");
  });

  it("does not treat Assad-the-person as Ain al-Asad airbase", () => {
    const hits = matchNamedTargets(
      "Bashar al-Assad says Israel attacked Damascus suburbs",
    );
    assert.equal(
      hits.find((t) => t.id === "ain-al-asad"),
      undefined,
    );
  });

  it("confirms Israel/US/Iran strike wires on named bases and rejects conjecture", () => {
    const hit = classifyKineticHeadline({
      title: "Israel strikes Abu al-Duhur airbase in Idlib, Syria",
      pubDate: "2026-08-18T02:10:00Z",
    });
    assert.equal(hit.confirmed, true);
    assert.equal(hit.conjecture, false);
    assert.equal(hit.targets[0]?.id, "abu-al-duhur");
    assert.equal(hit.actor, "israel");

    const wire = classifyKineticHeadline({
      title:
        "Israeli airstrikes hit Abu al-Duhur / Abu Duhur air base in Idlib",
    });
    assert.equal(wire.confirmed, true);
    assert.equal(wire.targets[0]?.id, "abu-al-duhur");
    assert.equal(wire.actor, "israel");

    const idlib = matchNamedTargets(
      "Israel hit the air base in Idlib, state TV says",
    );
    assert.equal(idlib[0]?.id, "abu-al-duhur");

    const guess = classifyKineticHeadline({
      title: "Israel may strike T4 airbase next week, officials say",
    });
    assert.equal(guess.conjecture, true);
    assert.equal(guess.confirmed, false);

    const us = classifyKineticHeadline({
      title: "CENTCOM airstrike hits Ain al-Asad Air Base in Iraq",
    });
    assert.equal(us.confirmed, true);
    assert.equal(us.targets[0]?.id, "ain-al-asad");
  });

  it("flags Jordan-east corridor westbound lon>36 lat 30–33 as SOFT tell", () => {
    assert.equal(
      isJordanEastCorridor({ lat: 31.6, lon: 36.8, trackDeg: 270 }),
      true,
    );
    assert.equal(
      isJordanEastCorridor({ lat: 31.6, lon: 36.8, trackDeg: 90 }),
      false,
    );
    assert.equal(
      isJordanEastCorridor({ lat: 31.6, lon: 35.9, trackDeg: 270 }),
      false,
    );
    assert.equal(
      isJordanEastCorridor({ lat: 34.1, lon: 36.8, trackDeg: 270 }),
      false,
    );
    assert.equal(
      isJordanEastCorridor({ lat: 31.6, lon: 36.8, trackDeg: null }),
      false,
    );
  });

  it("sorts rewind hits by distance and keeps closest sample per hex", () => {
    const target = { lat: 35.732, lon: 37.104 };
    const hits = rewindHitsNearTarget(
      [
        {
          assetKey: "hex:ae04b4",
          kind: "tanker",
          lat: 31.5,
          lon: 36.5,
          ts: "2026-08-18T01:40:00Z",
          trackDeg: 275,
          gsKt: 420,
          altFt: 28000,
          label: "RCH044",
          source: "adsb.lol",
        },
        {
          assetKey: "hex:ae04b4",
          kind: "tanker",
          lat: 32.9,
          lon: 36.8,
          ts: "2026-08-18T02:00:00Z",
          trackDeg: 268,
          gsKt: 410,
          altFt: 27000,
          label: "RCH044",
          source: "adsb.lol",
        },
        {
          assetKey: "hex:ae1111",
          kind: "tanker",
          lat: 35.5,
          lon: 36.9,
          ts: "2026-08-18T02:05:00Z",
          trackDeg: 90,
          gsKt: 400,
          altFt: 30000,
          label: "QID25",
          source: "adsb.lol",
        },
        {
          assetKey: "civ1",
          kind: "ais",
          lat: 35.73,
          lon: 37.1,
          ts: "2026-08-18T02:00:00Z",
          trackDeg: 0,
          gsKt: 10,
          altFt: null,
          label: "skip",
          source: "ais",
        },
      ],
      target,
    );
    assert.ok(hits.length >= 2);
    assert.equal(hits[0]?.assetKey, "hex:ae1111");
    assert.ok(hits[0]!.distKm < hits[1]!.distKm);
    assert.equal(hits.filter((h) => h.assetKey === "hex:ae04b4").length, 1);
    const ae = hits.find((h) => h.assetKey === "hex:ae04b4")!;
    const closer = haversineKm(target.lat, target.lon, 32.9, 36.8);
    assert.ok(Math.abs(ae.distKm - Math.round(closer * 10) / 10) < 0.2);
    assert.equal(ae.corridorTell, true);
    assert.match(KINETIC_HONESTY, /Confirmed strike ≠ ADS-B over target/);

    const box = rewindBbox(target, 400);
    assert.ok(box.latMin < 32.37 && box.latMax > 35.73);
    assert.ok(box.lonMin < 36.44 && box.lonMax > 37.10);
    const jordanEast = haversineKm(target.lat, target.lon, 32.37, 37.036);
    assert.ok(jordanEast < 400);
    assert.ok(jordanEast > 300);
  });
});

describe("aerialEvents", () => {
  it("classifies descent RTB vs EMCON dark", () => {
    assert.equal(
      classifyDarkReason({ altFt: 4000, gsKt: 220, trackDeg: 270, bearingHint: "westbound" }),
      "descent_rtb",
    );
    assert.equal(
      classifyDarkReason({ altFt: 32000, gsKt: 420, trackDeg: 90, bearingHint: "orbit/unknown" }),
      "emcon_orbit",
    );
  });

  it("emits LIVE → DARK and LIVE → LANDED transitions", () => {
    resetAerialEventsForTests();
    const now = "2026-08-19T19:28:00.000Z";
    applyAerialLifecycle({
      tracks: [
        {
          hex: "ae0418",
          callsign: "TEXACO2",
          kind: "tanker",
          acType: "K35R",
          lat: 32.5,
          lon: 34.2,
          trackDeg: 270,
          gsKt: 380,
          altFt: 22000,
          bearingHint: "westbound",
          inBox: true,
        },
      ],
      lastGoodTracks: [],
      landed: [],
      nowIso: now,
    });
    const darkAt = "2026-08-19T19:31:00.000Z";
    const r2 = applyAerialLifecycle({
      tracks: [],
      lastGoodTracks: [
        {
          hex: "ae0265",
          callsign: "TEXACO3",
          kind: "tanker",
          acType: "K35R",
          lat: 32.1,
          lon: 34.4,
          trackDeg: 250,
          gsKt: 180,
          altFt: 6000,
          bearingHint: "westbound",
          inBox: true,
          ageSec: 180,
          lastSeenAt: now,
          stale: true,
        },
      ],
      landed: [
        {
          hex: "ae05ad",
          flight: "TEXACO1",
          t: "K35R",
          lat: 32.01,
          lon: 34.89,
          gs: 0,
          alt_baro: "ground",
        },
      ],
      nowIso: darkAt,
    });
    assert.ok(r2.events.length >= 2);
    const landed = r2.events.find((e) => e.to === "landed");
    assert.ok(landed);
    assert.match(landed!.detail, /LLBG/);
    const dark = r2.events.find((e) => e.hex === "ae0265");
    assert.ok(dark);
    assert.equal(dark!.to, "dark");
    assert.equal(dark!.darkReason, "descent_rtb");
    assert.match(r2.aer01Churn.summary, /LANDED|DARK/);
  });
});

describe("world desk region packs", () => {
  const {
    articleMatchesRegionPack,
    findRegionPack,
    listRegionPacks,
  } = require("../analytics/regionPacks") as typeof import("../analytics/regionPacks");

  it("lists desks and matches Levant vs Ukraine titles", () => {
    assert.ok(listRegionPacks().some((p) => p.id === "levant"));
    const levant = findRegionPack("levant")!;
    const ua = findRegionPack("ukraine_europe")!;
    assert.equal(
      articleMatchesRegionPack(levant, {
        title: "IDF clears Blue Line sector near Litani",
      }),
      true,
    );
    assert.equal(
      articleMatchesRegionPack(levant, {
        title: "Kyiv reports Black Sea grain strike",
      }),
      false,
    );
    assert.equal(
      articleMatchesRegionPack(ua, {
        title: "Kyiv reports Black Sea grain strike",
      }),
      true,
    );
    assert.equal(
      articleMatchesRegionPack(findRegionPack("all")!, { title: "anything" }),
      true,
    );
  });
});
