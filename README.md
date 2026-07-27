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

## IRONSIGHT (optional)

```bash
git clone https://github.com/NoblerWorks-HQ/IRONSIGHT.git ../IRONSIGHT
cd ../IRONSIGHT && npm install
cd ../tradehole && npm run osint
```

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
