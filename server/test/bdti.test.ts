import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeStockqObfuscated, parseStockq } from "../analytics/bdti";

describe("StockQ BDTI obfuscation", () => {
  it("decodes known Aug 28 2026 index cell to 2777.00", () => {
    // data-sq from live StockQ HTML for 2026/08/28
    assert.equal(
      decodeStockqObfuscated("MTY3MDcwMDExOHwyMTF8NTA0fDI3NzcufDB8MA=="),
      "2777.00",
    );
  });

  it("parses obfuscated table rows into dated points", () => {
    const html = `
<tr class=row1>
<td align=center>2026/08/28</td>
<td align=center><span class="sq-obfuscated" data-sq="MTY3MDcwMDExOHwyMTF8NTA0fDI3NzcufDB8MA=="></span></td>
<td align=center><span class=changedown><span class="sq-obfuscated" data-sq="MjAyMTM0ODY3M3wtMC58ODEwfDh8NzAyfDY="></span></span>%</td>
</tr>
<tr class=row1>
<td align=center>2026/08/27</td>
<td align=center><span class="sq-obfuscated" data-sq="MjA3MTQxNDYzNHw4MDF8MTMyfDJ8MzQzfC4wMA=="></span></td>
<td align=center><span class="sq-obfuscated" data-sq="NTk3OTUwODJ8Ljc1fDYzOHw1NzZ8LXw="></span>%</td>
</tr>`;
    const pts = parseStockq(html);
    assert.equal(pts.length, 2);
    assert.deepEqual(pts[1], { date: "2026-08-28", value: 2777 });
    assert.deepEqual(pts[0], { date: "2026-08-27", value: 2801 });
  });
});
