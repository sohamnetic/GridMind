# GridMind

**AI Circuit Lab & Pit Wall Strategy Simulator** — design a circuit, watch AI drivers
learn it, then call the race from the pit wall.

Live: https://sohamnetic.github.io/GridMind/

GridMind uses a fictional championship, teams and drivers. It runs entirely in the
browser: there is no server, no account and no paid service behind it.

## What you do with it

| # | Module | What it does |
|---|---|---|
| 1 | Track Studio | Draw and edit a circuit: pit lane, DRS zones, sectors. Test-drive it with the keyboard. Share it as a link. |
| 2 | Driver Evolution | AI drivers learn the circuit by neuroevolution, first alone, then racing each other. |
| 3 | Race Engine | A full race for twenty cars, lap by lap: tyres, fuel, pit stops, safety cars, weather. Also wheel-to-wheel races between the trained drivers. |
| 4 | Strategy Optimiser | Thousands of simulated races rank the pit strategies for one car. |
| 5 | Live Pit Wall | You make the calls during a race; the debrief rates each one against the strategy engine. |

### Championship season

The **Season** button in the top bar starts a career: pick one of the ten teams and one of
its two cars, and run it through a calendar of five or ten rounds. Every round is a race
weekend:

1. **Practice.** Six blocks of track time to share between qualifying pace, race pace and
   pit-stop drills. The race runs come back as a chart of how each tyre wears that weekend.
2. **Qualifying.** Three knockout parts (20 cars, then 15, then 10), two runs in each. You
   choose how hard the driver pushes on every run: quicker laps against ruined ones.
3. **The race.** On the Live Pit Wall, from your qualifying slot, or left to the engineer.

Points go into the drivers' and teams' tables. Prize money buys development in four areas
(aerodynamics, tyre care, pit crew, reliability), while the other teams find pace of their
own every round. The career is saved in the browser.

The home page offers the five preset circuits, which come with drivers already trained,
so every module works on them straight away. On every screen a **coach strip** under the
top bar says what to do there, makes the button it is talking about glow, and offers the
next step once the screen's job is done. The top bar ticks off the steps done for the
circuit that is open.

## How it is built

### One rule

Everything under `src/core` is pure, deterministic TypeScript with no DOM in it, and all
of its randomness comes from one seeded generator (`core/math/rng.ts`). The same code runs
on the page, in Web Workers, in the unit tests and in the Node scripts, and a seed always
gives the same training run or race.

### Two levels of simulation

| | Physics level | Lap level |
|---|---|---|
| Used for | Test drive, driver training, wheel-to-wheel races | Full races, the optimiser, the pit wall |
| Unit of time | 1/60 s | One lap |
| A car is | A bicycle-model car with tyres, downforce and drag, driven by a neural network | A handful of numbers: pace, tyre wear, fuel, position |
| Cost | Thousands of steps a second | About a millisecond for a 50-lap, 20-car race |

The **track profile** (`core/profile/trackProfile.ts`) is the bridge. It turns a circuit and
the best trained lap into what the lap-level engine needs: base lap time, tyre stress,
pit-lane time loss, overtaking difficulty.

### The parts

```
src/
  core/
    math/        seeded random numbers, small helpers
    track/       spline, 2 m samples, analysis and validation, presets, pit lane, save format
    physics/     car model, lap timer, slipstream, DRS and contact
    ai/          neural network, sensors, genetic algorithm
    evolution/   training alone, training in traffic, wheel-to-wheel races, driver files
    profile/     track profile
    race/        lap-level engine: tyres, weather, strategies, the grid of teams and drivers
    strategy/    candidate strategies, Monte Carlo runs, statistics, staged search
    pitwall/     re-planning mid-race, rollouts, decision points, team radio, debrief
    season/      championship: calendar, practice, knockout qualifying, points, development
  share/         a circuit packed into a link
  workers/       training, racing, Monte Carlo pool, pit-wall advice and debrief
  render/        canvas drawing of tracks and cars
  state/         zustand stores, saving to the browser
  ui/            React screens: home, the app shell and coach, the season, one folder per module
scripts/         headless runs of the same core code
tests/           Vitest
public/drivers/  pre-trained drivers for the preset circuits
```

### Ideas worth knowing about

- **Drivers** are small feed-forward networks (13 inputs, two hidden layers, steering and
  throttle out) evolved by a genetic algorithm. A second stage adds eight traffic inputs,
  with zero weights so the lap they already drive is unchanged, and trains them in heats.
- **A race is a plain object**, random generator included. It can be copied at any lap and
  continued along different futures. The optimiser and the debrief are both built on this.
- **Comparisons are paired.** Every strategy in an optimiser study meets the same grids,
  weather and safety cars race for race, so differences come from the strategy and not
  from luck. Retirements and safety cars are drawn from their own per-lap stream so they
  stay the same when one car changes its plan.
- **The optimiser searches in stages**: every candidate gets a short first round, the
  leaders are re-raced on races none of them has seen, and the pit window is mapped last.
- **The debrief has no hindsight.** Each call is judged by playing the race out many
  times from that lap, once for each option. The weather in those futures follows the
  forecast for a few laps and is rolled afresh beyond it.
- **A season is a plain object too.** Each step (a practice session, a part of qualifying,
  a race result, an upgrade) is a function from one season to the next, drawn from the
  season's seed, so the same choices always give the same season. The race itself is the
  ordinary race engine, given the qualifying grid and a list of how each car differs from
  the standard one.
- **Workers share nothing.** They exchange messages and hand typed arrays over, because
  GitHub Pages cannot send the headers that shared memory needs.
- **Share links carry the circuit itself**, compressed, after the `#`. That part of an
  address never leaves the browser, so nothing is uploaded.

## Develop

Requires Node 22+.

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (Vitest)
npm run lint       # ESLint
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

Headless runs of the simulation, for calibration and checking:

| Command | What it runs | Arguments |
|---|---|---|
| `npm run sim:train` | Driver training | `[preset \| all] [generations] [population] [seed]` |
| `npm run sim:race` | Racecraft training and a wheel-to-wheel race | `[preset] [solo generations] [traffic generations] [seed]` |
| `npm run sim:lap` | Lap-level races and their averages | `[preset] [laps] [rain chance] [seed] [races]` |
| `npm run sim:optimise` | A strategy study, run twice to compare | `[preset] [laps] [rain chance] [driver] [final runs] [seed]` |
| `npm run sim:pitwall` | A pit-wall race, its radio and its debrief | `[preset] [laps] [rain chance] [driver] [seed] [samples]` |
| `npm run sim:pretrain` | Rebuilds the drivers in `public/drivers` | `[preset \| all] [generations] [population] [seed] [kept]` |
| `npm run sim:season` | Whole championship seasons with a fixed player, for balance | `[team] [rounds] [sprint \| full] [seed] [seasons] [risk] [qualifying blocks]` |

Pass arguments after `--`, for example `npm run sim:lap -- 4 50 0.2`. Presets are numbered
0 to 4: Pinewood Short, Copperline Oval, Harbour Streets, Vento Ring, Kestrel Park.

The pre-trained drivers depend on the presets and the car physics exactly as they were
when the drivers were trained. If either changes, `tests/drivers.test.ts` fails; run
`npm run sim:pretrain` to make the files again.

## Deploy (free, no card)

Hosting is GitHub Pages, built by GitHub Actions — both free for public repositories.

1. Create a **public** repository on github.com and push this project to its `main` branch.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml` (lint, tests, build) and
   publishes `dist/`.

The build uses relative asset paths and hash-based routes (`#/studio`), so it works under
any `username.github.io/<repo>/` path with no extra configuration. The page makes no
requests to anywhere but its own address.
