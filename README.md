# Asset Dashboard

A Persian (RTL) Flask dashboard for tracking what you own and what it is worth,
in toman, dollars and euros. Prices come live from Iranian markets, and
everything you enter stays in your browser.

## Features

- **Live prices** from two sources:
  - **TGJU** for gold, coins, currencies and crypto.
  - **TSETMC** (Tehran Stock Exchange) for shares *and* ETFs such as عیار,
    آگاس and آرام.
- **Starts empty.** There are no seeded rows; you add exactly what you hold,
  either from the market search or by hand.
- **Target allocation and drift.** Give each asset a target share of the
  portfolio. The table shows target, actual and drift, coloured green under
  2 points, amber from 2 to 5, and orange above 5. When anything drifts past
  5 points a rebalance banner names it.
- **Emergency cushion.** An amount you keep for a rainy day, assigned to one
  asset. It counts towards total value but is removed from the percentage
  denominator *and* from the asset holding it, so that asset does not read as
  permanently over target and skew every rebalance.
- **Price freshness.** Each row shows when its price was last updated
  ("۳ ساعت پیش"), flagged once it is older than 24 hours. After a refresh, any
  price that could not be fetched is named rather than counted.
- **Net worth over time.** One snapshot per day, viewable in toman, dollars or
  euros, with an allocation donut alongside.
- Everything persists to `localStorage`. No database, no accounts, no server
  state.

> **Reading the trend chart.** The figure next to it is a *change in total
> value*, not a rate of return: it moves when you buy or sell, not only when
> prices move. The toman view is also nominal, so under high inflation it rises
> even when purchasing power does not. The dollar view is the more honest proxy
> for purchasing power.

## Project layout

```text
flask_app.py              Flask app and routes (entry point)
providers.py              Fans search/quote requests out to the providers
tgju.py                   Catalog and price scraping for gold/currency/crypto
tsetmc.py                 Search and prices for Tehran Stock Exchange symbols
run.py                    Launcher: creates the venv, installs deps, serves
run.ps1                   Launcher script (Windows, PowerShell)
run.sh                    Launcher script (macOS/Linux)
requirements.txt          Dependencies (Flask, requests)
templates/index.html      UI
static/styles.css         Styles
static/app.js             Client-side logic
```

## Running it

### With the launcher

**Windows** — right-click `run.ps1` and choose **Run with PowerShell** (that
path already bypasses the execution policy). Or from a shell:

```powershell
powershell -ExecutionPolicy Bypass -File run.ps1
```

**macOS / Linux:**

```bash
chmod +x run.sh   # first time only
./run.sh
```

The first run creates a `.venv` and installs Flask and requests into it; after
that it starts immediately. Your browser opens once the server is up. Press
`Ctrl+C` in the same window to stop it.

If port 5000 is taken (AirPlay usually holds it on macOS) the launcher moves to
the next free port and prints the real address.

> Launcher output is plain ASCII English so it survives any terminal code page.
> The Persian lives in the dashboard itself.

### By hand

```bash
pip install -r requirements.txt
python flask_app.py      # reloader on, for development
```

Then open `http://127.0.0.1:5000/`. To use a different port:

```bash
PORT=8000 python flask_app.py
```

## API

- `GET /api/search?q=<query>` — search symbols across every market. Each result
  carries `provider`, `code`, `symbol`, `name`, `market`, `currency` and `unit`.
- `POST /api/quote` — fetch several prices at once.
  Body: `{"items": [{"id": "...", "provider": "tgju|tsetmc", "code": "..."}]}`
  Response: `{"results": {"<id>": {"value": ..., "currency": "IRR|USD"}}, "failed": [...]}`

Prices quoted in rial (TGJU and TSETMC) are converted to toman server-side.
Crypto is returned as a dollar price.

## Troubleshooting prices

Both providers ship a diagnostic you can run wherever the sites are reachable.
They print exactly what each page parsed to, which is the fastest way to tell a
blocked network apart from a page whose layout changed.

```bash
python tgju.py                              # a sample across all categories
python tgju.py crypto-bitcoin geram18       # specific codes

python tsetmc.py عیار آگاس آرام نهال موج    # check symbol lookup
```

Both TGJU and TSETMC frequently refuse non-Iranian IPs, so a failure abroad is
usually the network rather than the code.

## Adding a symbol

Shares and exchange-traded funds need no setup — they are searched live against
TSETMC. TSETMC stores names with the Arabic letters ي/ك while a Persian keyboard
produces ی/ک, so queries are folded to both spellings before searching;
otherwise a symbol like عیار can silently return nothing.

To add gold, a currency or a coin, append a row to `CATALOG` in
[`tgju.py`](tgju.py) with the `code` matching the TGJU profile-page slug, the
Persian `name`, a `unit`, `kind` set to `irr` or `usd`, and a `category`.

## Notes

- Data lives only in the browser that entered it. Clearing site data clears the
  portfolio; there is no export yet.
- The dev server is fine for personal local use, which is what this is for.
