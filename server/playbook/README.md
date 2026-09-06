# FRO lottery playbook (Phase 1)

Human-in-the-loop co-pilot. Proposes **HOLD / TRIM / WATCH / ADD / none** from live Tradehole intel. **Never auto-places** — E\*TRADE still requires preview + typed confirm phrase. Robinhood is advise-only (accept → manual fill + journal).

## Precedence

1. Veto **ADD** if Israel guidance is HOLD/watch, intel-alarm RED, fro-catalyst trim, or deal-alarm trim.
2. **TRIM** if fro/deal trim, fee-free edge ≥ threshold (blink path underpriced), or lottery edge ≤ trim threshold — unless regime is `catastrophe` (then HOLD).
3. **HOLD** if catastrophe / physical confirm, lottery edge ≥ hold threshold, or DF band ≥ execution_prep without deal trim.
4. **WATCH** if physical gap diverging / stall with thin physical.
5. **ADD** only if strategy-intel says add, no veto, and quality gates pass.

## Phase 2 (deferred)

Intraday scalp / morning-fade book — only after ≥30 journaled lottery decisions prove process discipline. Do not mix scalp sizing into the insurance book.
