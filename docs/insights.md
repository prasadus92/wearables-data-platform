# How the insight layer works

Every sentence the product says about a reading is computed by three pure
functions in `packages/health-core/src/insights.ts`, shared verbatim by web
and mobile and unit-testable without any ambient state. The governing rule:
describe the data relative to the person's own history, never judge health.

## Typical range

The shaded band on every chart is a personal baseline: the mean of the
displayed points plus and minus one standard deviation. It needs at least 5
points; below that the UI says "Collecting data to learn your typical range"
instead of drawing a band that would be noise.

Two properties to be aware of:

- The band is computed from the points in the selected window at the selected
  resolution. Switching from 7d to 90d recalibrates it, deliberately: the
  question answered is "how does this reading sit against what I am looking
  at". A production refinement is a fixed trailing 30 day baseline that stays
  put across views, plus percentile bands instead of standard deviation for
  robustness to outliers (queued in the scaling notes).
- At day resolution each point is already a daily mean, so the band reflects
  day-to-day variation, never intra-day swings.

## The status sentence

"Within your typical range" means the latest reading falls inside the band.
Outside the band, the sentence carries the deviation from the personal mean
("Above your typical range (+12%)"); a deviation that rounds to zero percent
omits the number. The metric's good direction never colors the wording: a
rising heart rate is reported identically to a rising HRV, because a single
reading is no verdict in either direction.

## Week over week delta

The small chip compares the mean of the most recent 7 days against the mean
of the 7 days before that, shown only when the data actually spans 14 or more
days and both windows contain readings. It renders in neutral styling for the
same non-diagnostic reason.

## Clinical reference bands

Some charts add a second, lighter band with a population reference where one
is broadly accepted: blood oxygen 95% and up, breathing rate 12 to 20 breaths
per minute for adults, systolic blood pressure 90 to 120 mmHg. These come
from `METRIC_META` and are labeled as typical ranges, never as targets, and
the info popover on every metric ends with a note that nothing here replaces
medical advice.

## Demo mode data

Demo wearables stream synthetic heart rate, HRV, and blood oxygen through the
exact production pipeline (webhooks, queue, workers). Breathing rate and
blood pressure have no demo source upstream, so the platform seeds thirty
days of plausible values itself at demo connect (`backend/app/services/`
`demo_seed.py`, deterministic per user). Demo mode is synthetic end to end,
so every chart carries data; real devices in Live populate the same charts
through sleep summaries and direct streams.
