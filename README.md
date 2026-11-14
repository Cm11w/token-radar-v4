# Token Radar — risk-adjusted launch board (radar-4)

A token launch radar for make.fun's `token-radar-01` bounty. It reads the
sealed DefiLlama snapshot, ranks every pre-token protocol by a **risk-adjusted
implied value**, and shows an **uncertainty band** per row instead of a single
exact number.

## What makes this one different

- **Ranked by value after risk.** The headline number is the implied value
  after a haircut from five measured risk signals: chain concentration, TVL
  volatility, record length, size below the watchlist floor, and how widely
  traded tokens in the category disagree on value.
- **A band, not a point.** Each row's low end uses the P25 market multiple
  plus the full risk haircut; the high end uses the P75 multiple with no
  haircut. Each row also states the rank it would hold at either end.
- **A risk story per protocol.** The detail view breaks the risk score into
  its five parts, narrates the two drivers that matter most, and names what
  would change the ranking. A dedicated Risk view ranks by risk itself.
- **Measured, never assumed.** The multiple, the quartiles, and the category
  dispersion all come from the traded tokens in the same snapshot, at run
  time. No protocol name is special-cased.

## Layout

- `main.ts` — entrypoint: snapshot in, `board.json` + `data.js` +
  `dashboard/` + `screenshots/` + `dossier.json` out.
- `lib/model.ts` — snapshot parsing, market measurement, the risk model,
  board scoring, gate validation.
- `lib/farm.ts` — farm plans (sized by risk, with costs and times) and risk
  narratives.
- `dashboard/` — the static page (no network, no framework): board, detail,
  risk, live, and method views, hash-routed.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte.
- `screenshots/` — four JPEG renders of the page: board, detail, risk,
  filtered.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>
```

The program is deterministic: two runs write identical bytes.

## Honesty notes

Implied values are this entry's own claim, never make.fun's. A protocol is
described as *recording* no token, never as having none — the snapshot is
DefiLlama's record, not proof. Nothing here predicts whether or when a token
is issued.
