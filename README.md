# Tradehole — FRO Options Dashboard

Local Electron + React desktop monitor for **FRO** options: Yahoo-backed market data, E\*TRADE portfolio / P&L / option orders, and an optional [IRONSIGHT](https://github.com/NoblerWorks-HQ/IRONSIGHT) OSINT embed.

> Quotes are delayed/unofficial (Yahoo). Not exchange real-time. Not investment advice. Live trading uses your own E\*TRADE keys — preview + confirm before place.

## Download (Windows / Mac)

CI builds run on every push to `main`:

1. Open **Actions** → latest **Build** workflow
2. Download **`tradehole-windows-x64`** (installer `.exe` + portable `.exe`) or **`tradehole-macos`**
3. Or create a GitHub **Release** — artifacts attach automatically

### Windows first run

1. Run the NSIS installer (`Tradehole-*-win-x64.exe`) **or** the portable exe
2. Create a config file (your keys, not anyone else’s):

   `%APPDATA%\Tradehole\.env`

   Copy from [`.env.example`](.env.example):

   ```env
   ETRADE_CONSUMER_KEY=...
   ETRADE_CONSUMER_SECRET=...
   ETRADE_ENV=sandbox
   ETRADE_ENABLE_TRADING=true
   PORT=3169
   ```

3. Restart Tradehole
4. In **Positions**, click **Open authorize URL** → approve on E\*TRADE → paste the code → **Complete OAuth**

SmartScreen may warn on unsigned builds — choose “More info” → “Run anyway” for a build you trust from this repo.

### macOS first run

Local: `npm run install:mac`  
Or download the CI zip, open `Tradehole.app`, and put keys in:

`~/Library/Application Support/Tradehole/.env`

## Dev quick start

```bash
cp .env.example .env
# put your E*TRADE key + secret in .env

npm install
npm run dev
```

Starts:

1. Local API on `http://127.0.0.1:3169`
2. Vite UI on `http://127.0.0.1:5173`
3. Electron shell

Status bar shows **`dev` vs `packaged`** plus build time. After OSINT/UI/classifier changes, run `npm run install:mac` so `/Applications/Tradehole.app` matches source (dev hot-reloads; the packaged app does not).

```bash
npm test          # classifier golden fixtures (node:test)
npm run typecheck
```

### Energy quotes (CME → Yahoo)

Markets **Oil & diesel** prefers CME Group delayed web quotes for NYMEX CL / HO / RB; ICE Brent (`BZ=F`) stays Yahoo. If CME returns **HTTP 403** (IP flagged for scraping), the API falls back to Yahoo and labels the card `Yahoo · CME blocked` (and `stale settle` when last == previous close — common Sunday Globex open while Yahoo still prints Friday).

**Physical TD3C** is a weekly Baltic reprint (Edge / Hellenic / Business Times), not a live API — multi-day lag is normal. Tradehole should show the newest parseable print (Hellenic weeklies often lead Edge).

### Refresh the packaged Mac app

Nathan’s desk usually runs **`/Applications/Tradehole.app`**, which embeds `Resources/api/index.js` — **not** the git working tree. After pulling energy/physical fixes:

```bash
# Quit Tradehole completely (Cmd+Q), then:
cd ~/Documents/GitHub/tradehole
git pull
npm run install:mac
open -a Tradehole
```

Or for a one-off without reinstalling the `.app`, run the live tree:

```bash
npm run dev          # API :3169 + Vite + Electron
# or API only:
npm run start:server
curl -s http://127.0.0.1:3169/api/energy | jq '.wti | {price,source,fetchedAt}'
curl -s 'http://127.0.0.1:3169/api/physical?refresh=1' | jq '.vlccTd3c | {worldscale,tceUsdPerDay,asOfIso,discoveryMethod}'
```

Hard-refresh the UI (Cmd+Shift+R) if the shell was already open against an old Vite/dev server.
## Environment

| Variable | Purpose |
|----------|---------|
| `ETRADE_CONSUMER_KEY` | Sandbox or production consumer key |
| `ETRADE_CONSUMER_SECRET` | Matching secret |
| `ETRADE_ENV` | `sandbox` (default) or `production` |
| `ETRADE_ENABLE_TRADING` | `true` / `false` — gates order preview/place |
| `PORT` | Local API port (default `3169`) |
| `IRONSIGHT_URL` | Embed URL (default `http://localhost:3170`) |
| `IRONSIGHT_PATH` | Path to IRONSIGHT clone for `npm run osint` |

**Never commit `.env`.** Rotate keys if they were shared in chat.

## E\*TRADE OAuth

1. Keys in `.env` (userData path for packaged apps — see above)
2. **Open authorize URL** → log in → copy verification code
3. **Complete OAuth**
4. Tokens stored via Electron `safeStorage` when available

Renew around midnight US/Eastern or after ~2h idle.

## Packaging

| Script | Output |
|--------|--------|
| `npm run dist:win` | Windows NSIS installer + portable (x64) under `release/` |
| `npm run dist:mac` | `Tradehole.app` under `release/mac*` |
| `npm run install:mac` | Build + copy to `/Applications` |

## Israel Strike Pre-Launch Tells

Markets tab panel (**Israel Strike Tells**, under Shekel) scores a DeepSeek-style AER/NAV/ELEC/DIP/POL composite (0–100) from **free OSINT only**:

- **Screenshot strip:** AER-01 · NAV-01 · EXEC-01 (Shekel) · scenario band — plus **Copy tells snapshot**
- **AER-01:** sequential `adsb.lol` mil + Levant/Med/Israel boxes (retries, last-good cache, disk-sticky ~18m under Application Support). On 429/fail: **OpenSky Network** bbox failover (callsign-typed only; labeled `opensky`). Banner: **FEED OK / FEED FAILED / DARK / DEGRADED**. Lit at ≥3 tankers. Independent of IRONSIGHT.
- **NAV-01:** optional **AISStream.io** Cyprus bbox (`AISSTREAM_API_KEY` — free signup at aisstream.io) auto-updates navy-like counts when LIVE. Without a key: panel/Map show **KEY UNSET**; key set but empty feed → **EMPTY** (no invented vessels). MT/VesselFinder deep links + **I count N** are backup only. No MarineTraffic paywall/CF bypass.
- **Auto:** Med/Israel NOTAM RSS + EUROCONTROL RSS + AWC intl SIGMET (ME filter), IDF silence heuristic (weak), Lebanon-border classifiers, embassy RSS, cabinet-leak **negative filter**, Shekel spike (`EXEC-01`), Pikud/RocketAlert via IRONSIGHT
- **Manual / Layer-3 (deep links):** FR24 Hatzerim KC cluster, USNS/Haifa AIS, Mode-5 IFF, GPSJam, GreyNoise

Does **not** auto-trade — alert + FRO HOLD/watch guidance only. Blank ADS-B ≠ all-clear (mil often dark). `POL-01` cabinet leak alone = feint.

API: `GET /api/israel-strike-tells?refresh=1` · `POST /api/israel-strike-tells/manual`

## OSINT Theater Map + Archive

The **Map** tab is the default home: Leaflet theater view (Israel–Iran–Horn/Somalia + margin) with live ADS-B, AIS, FIRMS, NOTAM/NAV boxes, and IRONSIGHT naval stamps.

Every successful poll also appends to **`osint-theater.db`** under Application Support (`TRADEHOLE_DATA_DIR` if set):

- Dense `asset_samples` / `zone_samples` retained **90 days**
- Levant `aerial_peaks` (tanker/AWACS time series) retained **365 days**
- Time scrubber on the map: **LIVE** ↔ **REPLAY** (←/→ step 1m, Space returns LIVE). Forward-only — nights before the archive existed cannot be backfilled.

APIs: `GET /api/osint-archive/status` · `/range?at=` · `/peaks` · `/trail?assetKey=`

## IRONSIGHT (optional)

Tradehole’s Electron main process **auto-starts** IRONSIGHT on `:3170` when the app opens (if it isn’t already up), keeps it as a supervised child with restart-on-exit, and stops only the instance it started on quit.

```bash
git clone https://github.com/NoblerWorks-HQ/IRONSIGHT.git ../IRONSIGHT
cd ../IRONSIGHT && npm install
```

Then open Tradehole (`npm run electron` / `npm run dev`, or the installed `.app`). Manual `npm run osint` is still available for debugging.

For a packaged `/Applications/Tradehole.app`, set an **absolute** `IRONSIGHT_PATH` or `TRADEHOLE_IRONSIGHT_PATH` in `~/Library/Application Support/Tradehole/.env` (or rely on `npm run install:mac`, which rewrites a sibling clone to an absolute path).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | API + Vite + Electron |
| `npm run start:server` | API only |
| `npm run osint` | Start sibling IRONSIGHT |
| `npm run typecheck` | TypeScript checks |
| `npm run dist:win` | Windows installer + portable |
| `npm run dist:mac` | macOS app directory |

## Stack

- Electron + React + Vite + TypeScript
- Express local API (`yahoo-finance2`)
- E\*TRADE REST + OAuth 1.0a
- Zustand
