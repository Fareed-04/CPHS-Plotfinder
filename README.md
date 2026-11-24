# Central Park Plot Finder (first build)

A static web page: satellite map + transparent master plan overlay + forgiving plot search + 360° hotspots that open the 3DVista tour. No server code, no API keys, no paid map.

## Run it

It needs a local web server (browsers block `fetch` from `file://`):

```
cd "E:\Business\Plot Finder\plot-finder"
python -m http.server 8000
```

Then open http://localhost:8000. To put it on the client's site, upload the whole folder; it can also be embedded with an `<iframe>`.

## What is in it

| Path | What |
|---|---|
| `index.html`, `css/`, `js/` | The page. `js/search.js` is the search parser, `js/georef.js` the plan-to-map maths, `js/app.js` the UI. |
| `vendor/` | MapLibre GL 4.7.1 (open source, BSD-3). |
| `overlay/` | Master plan rendered from `CPHS MAP.pdf` with a transparent background, cut into 16 tiles. |
| `data/plots.json` | 14,895 plots pulled from the CAD PDF text: block, plot label, number, sub-number (51/1), position, label angle, residential/commercial. |
| `data/georef.json` | How the plan sits on the earth (see Alignment). |
| `data/panoramas.json` | 360° points. Currently 61 test points along main roads. |

## Alignment (making the plan sit exactly on the satellite)

Open `index.html?calibrate`. Then:

1. Rough placement with the arrow buttons or keyboard (arrows move, Q/E rotate, +/− scale, Shift = 10×).
2. **Add control point**: click a sharp feature on the plan (roundabout centre, road junction, boundary corner), then click the same spot on the satellite. Repeat 4–8 times, spread around the edges.
3. Each point shows its error in metres. Under 2 m is good. Skip a point that is off.
4. **Download georef.json** and save it over `data/georef.json`.

The current `georef.json` is only a rough guess, because the satellite imagery could not be checked while this was built.

## Search: what it understands

`6 b`, `6b`, `b6`, `B-6`, `plot 6 block B`, `Plot No. 6, B block`, `plot six b`, `51/1 A`, `1101-C`, `double a 5` → that plot.
`6` → plot 6 in every block (all shown on the map). `block b` → every plot in B. `commercial 98 b` → prefers commercial plots.
`mosque`, `hospitl` (typo), `park d` → landmarks from the plan. A missing plot falls back to the same number in other blocks.

## Connecting 3DVista panoramas

Each entry in `data/panoramas.json`:

```json
{
  "id": "cp_b_boulevard_03",
  "title": "Block B Main Boulevard",
  "lngLat": [74.35512, 31.33201],
  "type": "street",
  "heading": 214,
  "tour": { "media": 17 }
}
```

- Position: `lngLat` (from the camera GPS, or from the 3DVista map) or `plan` `[x, y]` in master plan units if it was placed on the plan.
- `tour.media`: the panorama number in the 3DVista playlist. The page opens `tour/index.htm#media=17` in a full-screen viewer (the URL pattern is in `tour.deepLink` at the top of the file and can be changed).
- Put the published 3DVista tour in a `tour/` folder next to `index.html` (or set `tour.url` to its web address).
- Delete the `placeholder` test points once real ones exist.

Fastest way to fill this in: shoot with GPS on (most 360 cameras and phones record it), then a script reads the GPS from each panorama file and writes this JSON. The 3DVista map's own hotspot positions can also be read from the published tour's `script.js`.

## Known data issues to check

- Plots were assigned to blocks automatically by following the number sequences on the plan. 355 of 14,519 block+number pairs appear more than once, mostly in Blocks A, B, D and G. The page warns when a searched plot is one of these. A block-boundary drawing (or the CAD DWG with block layers) would fix this.
- Three areas along the 120 ft Road have no block name on the plan (shown as "Unlabelled area 1/2/3"), and one area near Hunza Road is guessed as Block K from a single "13K" label.
- Plot size (marla) isn't in the plan text for most plots. A plot list (Excel) with size, status and price would add it.

## Ideas for later

See the project thread for the prioritised list: plot outlines with size and status colours, availability/price layer, "nearby" distances, shareable links (done), WhatsApp enquiry button, drone 3D, time-lapse construction progress, etc.
