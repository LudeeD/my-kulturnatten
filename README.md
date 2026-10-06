# Min Kulturnat

An unofficial planner for Kulturnatten (Culture Night) in Copenhagen, Friday 9 October 2026,
18:00–24:00. Pick a few events and see them together on one map.

It is a static site: SvelteKit with the static adapter, MapLibre GL JS, and map tiles from
[OpenFreeMap](https://openfreemap.org). No backend, no login. The programme is a JSON snapshot
in `static/data/events.json`; the site never contacts kulturnatten.dk.

Requires Node 22.18 or newer and pnpm.

## Fetch the programme

```sh
pnpm install
pnpm run fetch
```

(`pnpm fetch` without `run` is a different, built-in pnpm command.)

This runs `scripts/fetch-events.ts`, which downloads the programme from kulturnatten.dk, drops
the duplicate records, normalises it to the types in `src/lib/types.ts`, and writes
`static/data/events.json`. It prints a summary and lists events with missing or implausible
coordinates.

The script exits with an error and leaves the existing file untouched if the result is empty,
has fewer than 150 events, or has lost more than 20% of the events in the existing file. Use
`pnpm run fetch --force` to accept a real drop.

## Develop

```sh
pnpm run dev       # dev server
pnpm run check     # type-check
pnpm run lint      # prettier + eslint
pnpm run build     # static site in build/
pnpm run preview   # serve build/ locally
```

- `src/lib/planner.svelte.ts`: all app state (picks, filters, selection, language, shared links).
- `src/lib/components/`: the list, the event card with its details, the map.
- `src/lib/geo.ts`: distances and the rough walking and cycling times shown under an open event.
  There is no routing; times are straight-line distance times 1.3.
- `src/lib/i18n.ts`: Danish and English UI strings, and English names for the programme's
  Danish-only category labels.

Picks are stored in `localStorage` and mirrored in the URL as programme numbers
(`#p=201,514,766`). Opening a link with other picks shows them as a shared plan until you choose
to add them to yours, replace yours, or go back. If you have no picks of your own, the linked
plan becomes yours.

## Deploy

`pnpm run build` writes plain static files to `build/`. All paths are relative, so the folder
works from a domain root or any subdirectory.

**GitHub Pages:** push to `main` and set Settings → Pages → Source to "GitHub Actions".
`.github/workflows/deploy.yml` fetches the programme, builds and deploys on every push, on
manual runs, and five times a day. If a scheduled fetch fails, the run fails and the previous
deployment stays in place. On a push or manual run, a failed fetch falls back to the committed
`events.json`.

**Cloudflare Pages:** build command `pnpm run fetch && pnpm run build`, output directory
`build`, environment variable `NODE_VERSION=24`. A failed fetch fails the build and Cloudflare
keeps the previous deployment. Cloudflare has no scheduled builds of its own; trigger a deploy
hook from a cron job if you want the programme refreshed automatically.

## Map tiles

The map uses OpenFreeMap's public instance with its `dark` style. It needs no API key and its
terms allow this use, but it comes with no uptime guarantee. Attribution is required and is
always shown on the map: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap".

The "Metro & trains" menu switches four layers on and off: metro lines, metro stations, train
tracks and train stations. Train tracks and train stations are already in those tiles.
The metro lines and stations (M1–M4, with their colours) come from `static/data/metro.json`, fetched from
OpenStreetMap with `pnpm run fetch:metro`. They rarely change, so that script is run by hand.
