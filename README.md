# GridMind

**AI Circuit Lab & Pit Wall Strategy Simulator** — design a circuit, watch AI drivers
learn it, then call the race from the pit wall.

GridMind uses a fictional championship, teams and drivers. It runs entirely in the
browser: there is no server, no account and no paid service behind it.

## Modules

| # | Module | Role |
|---|---|---|
| 1 | Track Studio | Draw and edit the circuit; pit lane, DRS zones, sectors |
| 2 | Driver Evolution | Train AI drivers on the circuit with a genetic algorithm |
| 3 | Race Engine | Simulate a full race with tyres, fuel and incidents |
| 4 | Strategy Optimiser | Monte Carlo evaluation of candidate strategies |
| 5 | Live Pit Wall | Play strategist during a race, then review the debrief |

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, app shell, GitHub Pages pipeline | Done |
| 1 | Track Studio, track geometry, car physics, test drive | Done |
| 2 | Sensors, neural network, genetic algorithm, training view | Done |
| 3 | Multi-car racing, slipstream, traffic training, track profile | Done |
| 4 | Lap-level race engine: tyres, fuel, pit stops, safety car, weather | Done |
| 5 | Monte Carlo strategy optimiser | Next |
| 6 | Live Pit Wall and debrief | Planned |
| 7 | Polish, calibration, sharing | Planned |

## Develop

Requires Node 22+.

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (Vitest)
npm run lint       # ESLint
npm run build      # type-check + production build into dist/
npm run sim:train  # headless training: -- [preset index | all] [generations] [population] [seed]
npm run sim:race   # headless racecraft: -- [preset index] [solo generations] [traffic generations] [seed]
npm run sim:lap    # headless lap-level races: -- [preset index] [laps] [rain chance] [seed] [races]
npm run preview    # serve the production build locally
```

## Layout

- `src/core` — pure, deterministic, DOM-free simulation code (seeded RNG). Runs
  unchanged on the main thread, in Web Workers, in tests and in Node scripts.
- `src/ui` — React interface. `src/render` — Canvas drawing. `src/workers` — Web Workers.
- `tests` — Vitest unit tests. `scripts` — headless training / calibration runs.

## Deploy (free, no card)

Hosting is GitHub Pages, built by GitHub Actions — both free for public repositories.

1. Create a **public** repository on github.com and push this project to its `main` branch.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml` and publishes `dist/`.

The build uses relative asset paths and hash-based routes (`#/studio`), so it works under
any `username.github.io/<repo>/` path with no extra configuration.
