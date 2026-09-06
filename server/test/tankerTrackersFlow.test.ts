import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTankerTrackersMessages } from "../analytics/tankerTrackersFlow";

const SAMPLE = `
<div class="tgme_widget_message_wrap">
  <time datetime="2026-08-30T10:03:31+00:00"></time>
  <div class="tgme_widget_message_text js-message_text" dir="auto">
    Over the past 28 days, Arab states shipped out 6.92 million barrels of crude oil per day via the US Navy blockade line.
    Of that total, 2.53 Mbpd came from oil terminals in the Gulf of Oman while another 4.39 Mbpd passed through the Strait of Hormuz mostly to supply other tankers waiting in the Gulf of Oman.
  </div>
</div>
<div class="tgme_widget_message_wrap">
  <time datetime="2026-08-28T02:01:34+00:00"></time>
  <div class="tgme_widget_message_text js-message_text" dir="auto">
    Over the past seven full days, crude oil exports departing the US Navy blockade line averaged 6.7 million barrels per day.
  </div>
</div>
<div class="tgme_widget_message_wrap">
  <time datetime="2026-08-27T13:28:41+00:00"></time>
  <div class="tgme_widget_message_text js-message_text" dir="auto">
    flows over the past seven days stand at just 3.7 million barrels a day, Samir Madani says.
  </div>
</div>
`;

describe("parseTankerTrackersMessages", () => {
  it("extracts blockade-line Mbpd with Hormuz breakdown", () => {
    const prints = parseTankerTrackersMessages(SAMPLE);
    assert.ok(prints.length >= 2);
    const latest = prints.find((p) => p.bpdMillions === 6.92);
    assert.ok(latest);
    assert.equal(latest.asOfDate, "2026-08-30");
    assert.equal(latest.hormuzMbpd, 4.39);
    assert.match(latest.windowLabel, /28d/);
  });

  it("parses 7d average prints", () => {
    const prints = parseTankerTrackersMessages(SAMPLE);
    const seven = prints.find((p) => p.bpdMillions === 6.7);
    assert.ok(seven);
    assert.equal(seven.asOfDate, "2026-08-28");
    assert.match(seven.windowLabel, /7d/);
  });
});
