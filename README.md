# Min Kulturnat

An unofficial planner for Kulturnatten (Culture Night) in Copenhagen, Friday 9 October 2026,
18:00–24:00. A group opens one link and sorts events into numbered tiers together, before and
during the night. It is a tier list, not a route: the tiers have no names and no order inside.

It is a static site: SvelteKit with the static adapter, MapLibre GL JS, and map tiles from
[OpenFreeMap](https://openfreemap.org). No login and no backend of its own: the shared plan is
an [Automerge](https://automerge.org) document (see [The shared plan](#the-shared-plan)). The
programme is a JSON snapshot in `static/data/events.json`; the site never contacts
kulturnatten.dk.

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

- `src/lib/planner.svelte.ts`: all app state (the plan, filters, selection, language).
- `src/lib/plan.ts`: the plan's document shape, the Automerge repo, and the short names on chips
  and pins.
- `src/lib/components/`: the tier rows (`PlanView`, with the drag and drop), a place's panel, the
  programme list, the event details view, the map.
- `src/service-worker.ts`: caches the app and the programme so the list still works offline.
  Map tiles are not cached.
- `src/lib/geo.ts`: distances and the rough walking and cycling times shown under an open event.
  There is no routing; times are straight-line distance times 1.3.
- `src/lib/i18n.ts`: Danish and English UI strings, and English names for the programme's
  Danish-only category labels.

## The shared plan

A plan is a set of places (events), each in a numbered tier or Unsorted, with who last moved it. A shared
plan also has one chat, where a message can be about a place. There are always at least two tiers, and one empty tier after the last one in use (up to nine):
putting a place in it adds the next, and emptying the last ones takes them away again. Places are moved by dragging their chip to another tier (press and hold on touch), or with
the up and down arrow keys on a focused chip.

A plan starts out private: it lives in IndexedDB on the device, has no link, and nothing about it
is sent anywhere (the sync server is not even connected to). Pressing Share asks first, then puts
the plan online and gives out its link (`#plan=<id>`); that cannot be undone. Plans opened from
someone's link are shared by definition. The top bar always says which of the two a plan is.

Every device keeps its own copy in IndexedDB and edits it directly, so the plan also works
offline; the copies merge through a sync server. If two people move the same place at once, one
of the moves wins on every device. Chat messages only ever add up.

The sync server is in `sync-server/`: a small Node program that stores shared plans and relays
changes between the phones that have one open. It has no accounts, so it limits what a stranger
can do instead: it only accepts connections from the site's own origin, caps the size of a
message, the connections per address and the messages per minute, and stops taking new
connections once its data passes 500 MB. All of these are environment variables at the top of
`server.js`.

To run it, copy the folder to a server and `docker compose up -d --build`. It listens on
`127.0.0.1:3030`; put a reverse proxy with TLS in front, for example in Caddy:

```
sync.example.org {
	reverse_proxy 127.0.0.1:3030
}
```

Then build the site with `VITE_SYNC_URL=wss://sync.example.org` (in the GitHub workflow, the
repository variable of that name). Without it, the site uses the Automerge project's public
server, `wss://sync.automerge.org`, which has no uptime guarantee. For local development against
your own server, add `http://localhost:5173` to its `ALLOWED_ORIGINS`.

A plan is created the first time a place is added. Picks from the earlier version of the app
(named lists in `localStorage`) start the first plan, in Unsorted. The old `#p=` links no
longer open anything.

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

The map uses OpenFreeMap's public instance, with its `positron` style in light mode and `fiord`
in dark mode (the app follows the system setting). It needs no API key and its
terms allow this use, but it comes with no uptime guarantee. Attribution is required and is
always shown on the map: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap".

The "Metro & trains" menu switches four layers on and off: metro lines, metro stations, train
tracks and train stations. Train tracks and train stations are already in those tiles.
The metro lines and stations (M1–M4, with their colours) come from `static/data/metro.json`, fetched from
OpenStreetMap with `pnpm run fetch:metro`. They rarely change, so that script is run by hand.
