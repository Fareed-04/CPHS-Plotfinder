# Central Park Plot Finder (v3)

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
| `data/panoramas.json` | 27 360° points from the existing 3DVista tour (positions read from the tour's own map). |
| `data/outline.json` | Outline of the scheme traced from the plan (used by the Focus view). |
| `data/roads.json` | Ferozepur Road (OpenStreetMap) and Hunza Road (traced from the plan) for the road highlight. |

## Views and controls

- **Satellite**: the plan sits on the satellite at 80% opacity (slider in Layers).
- **Master plan**: the whole plan as one opaque sheet on the satellite, like Zameen's map view.
- **Focus**: satellite and plan, with everything outside Central Park (Al Haram Garden and neighbouring societies) washed out.
- Speech-bubble button: landmark callouts on/off. **2D/3D** button: flat or tilted view. Home: back to the start view.
- Start view: standing on Ferozepur Road looking into the scheme (`START` at the top of the start-view section in `js/app.js`). Any view can be linked with `?view=lng,lat,zoom,bearing,pitch`; `index.html?calibrate` shows the current values. `?mode=plan` or `?mode=focus` opens in that view.

## Alignment (making the plan sit exactly on the satellite)

Open `index.html?calibrate`. Then:

1. Rough placement with the arrow buttons or keyboard (arrows move, Q/E rotate, +/− scale, Shift = 10×).
2. **Add control point**: click a sharp feature on the plan (roundabout centre, road junction, boundary corner), then click the same spot on the satellite. Repeat 4–8 times, spread around the edges.
3. Each point shows its error in metres. Under 2 m is good. Skip a point that is off.
4. **Download georef.json** and save it over `data/georef.json`.

## Master plan tiles

The plan is served as a tile set in `plan-tiles/{z}/{x}/{y}.webp` (zoom 11–19, about 34 MB), rendered straight from the PDF at 10 px per PDF point so plot numbers stay sharp when zoomed in. If the alignment (`data/georef.json`) changes, rebuild the tiles with `tools/tiler.py` (zoom 19) and then `tools/pyr.py 18 10` (lower zooms). Run them from a folder holding the plan PDF as `map.pdf`, `T.json` (plan-to-map transform) and an `out/` link to this project; they need Python with pypdfium2, opencv-python, numpy and Pillow. `?calibrate` uses the older single-image overlay so you can align without rebuilding.

Tiles seen during a visit stay in memory (no reload when panning back), and the satellite and plan tiles around the scheme are fetched in the background a few seconds after the page opens.

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
- `tour.id`: the 3DVista panorama id (e.g. `panorama_…`). When the tour is in `CPHS Published File_V2/` next to `index.html` (same site), the page loads it hidden in the background after the map, skips its welcome screen, and switches panoramas by id, so a hotspot opens at once. Opening by id matters: the tour holds both the Jan 2026 and Sept 2026 shots under the same names, and opening by name picks the old one.
- `tour.media`: playlist number, used only when the tour is on another site (the hosted copy at `tour.liveUrl`). Cross-site, the page cannot hide the welcome screen.
- `tour.welcome`: which tour containers the ENTER button shows/hides. If the tour is re-published and the welcome screen comes back, read the new ids from the ENTER button in `script_general.js`.
- The tour's portrait-orientation lock was removed by deleting `"lockedOrientation":"landscape"` from `CPHS Published File_V2/script_general.js`. Re-publishing from 3DVista brings it back unless it is switched off in the 3DVista project settings.
- The 27 points come from the tour's map and `data/panoramas.json` is regenerated from `script_general.js`. Sept panoramas that are not placed on the tour map (Gate 2, Gate 3, D Block, Main Park, Cricket Ground - Main Park, Main Park (1)) have no map position yet.
- Old test points are only shown with `?test`.

Fastest way to fill this in: shoot with GPS on (most 360 cameras and phones record it), then a script reads the GPS from each panorama file and writes this JSON. The 3DVista map's own hotspot positions can also be read from the published tour's `script.js`.

## Known data issues to check

- Plots were assigned to blocks automatically by following the number sequences on the plan, then refined so no block repeats a number. 4 residential numbers still appear twice (A-207, A-1152, E-41, E-419); the page warns on these. Stray numbers inside non-plot areas (e.g. a "1" inside the hospital) are removed. Commercial strips have their own numbering and are labelled "Commercial".
- Three areas along the 120 ft Road have no block name on the plan (shown as "Unlabelled area 1/2/3"), and one area near Hunza Road is guessed as Block K from a single "13K" label.
- Plot size (marla) isn't in the plan text for most plots. A plot list (Excel) with size, status and price would add it.

## Ideas for later

See the project thread for the prioritised list: plot outlines with size and status colours, availability/price layer, "nearby" distances, shareable links (done), WhatsApp enquiry button, drone 3D, time-lapse construction progress, etc.
