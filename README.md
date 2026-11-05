# COASTAL — Seagrass Restoration Planner

A simple, map-based demo for planning the placement of COASTAL structures. Search for a coast, choose a seagrass species, adjust the area and planting pattern, and see the calculated positions, quantities and material cost.

## Open the demo

1. Unzip the complete `COASTAL-Planner` folder.
2. Open **`OPEN-COASTAL.html`** in a modern browser.
3. Keep an internet connection for the live map and online place search. The planting calculations, coordinate entry and saved starting locations work locally.

The single-file demo contains the application code and bundled map library. It does not download map tiles in advance. If your browser restricts features when opening a file directly, use the local server below. Saved plans belong to the browser and address you use; a file opened directly and a local server have separate storage.

### Run the editable source

From a terminal inside this folder:

```sh
python3 -m http.server 8000 --directory dist
```

Then open **http://localhost:8000**. On Windows, `py -m http.server 8000 --directory dist` may be the appropriate Python command. Press **Ctrl+C** in the terminal to stop the server. No package installation, build step or mapping SDK key is required. Python is only serving static files; there is no application backend.

The source is in `dist/`. Serve that directory rather than opening its `index.html` directly, because it uses JavaScript modules. The packaged `OPEN-COASTAL.html` is the version intended for direct opening.

The optional `Start-COASTAL.command` (macOS) and `Start-COASTAL.bat` (Windows) launchers open the same standalone file. Opening `OPEN-COASTAL.html` directly is sufficient.

### Rebuild the portable app after editing

From the project folder, run `python3 build_standalone.py` (or `py build_standalone.py` on Windows). This embeds the current source, styles, Leaflet and images into `OPEN-COASTAL.html`. The bundler uses Python's standard library and does not install packages. Run the source server while editing, then rebuild the portable copy when ready.

## A three-step demo

1. **Choose a location.** Try a saved Thai coastal locality, search a place name, or enter latitude and longitude such as `12.5880, 100.9560`. Place the plot at your intended location. The saved places and initial example are starting points for exploring the interface, not approved restoration sites.
2. **Set your plan.** Choose a species, move the area slider and compare **Staggered**, **Grid** and **Patches**. The map and quantities update from calculated positions. You can draw a boundary for a more specific shape and open the additional controls to change spacing, orientation, clearance, unit cost and spare percentage.
3. **Review and take it with you.** Inspect the planting plan, save it in this browser, export its positions as CSV or GeoJSON, or use the print view and your browser's **Save as PDF** option.

## What the app does

- Shows an interactive OpenStreetMap basemap using Leaflet.
- Searches real place names using the Open-Meteo geocoding API, with saved localities and coordinate entry available without that service.
- Provides three species choices: spoon seagrass (*Halophila ovalis*), narrowleaf seagrass (*Halodule uninervis*) and fineleaf seagrass (*Halodule pinifolia*).
- Calculates an adjustable square plot or a user-drawn polygon.
- Generates individual structure coordinates for three geometric arrangements, including boundary clearance.
- Updates the structure count, spare quantity, order quantity and estimated structure cost.
- Displays a close-up of the generated arrangement.
- Saves plans locally in the current browser, with no account required.
- Exports CSV coordinates and GeoJSON geometry. GeoJSON uses longitude, latitude order.
- Provides a print layout for browser printing or PDF output.
- Uses a responsive ocean-coloured interface, translucent panels, readable system typography and motion that respects the browser's reduced-motion setting.

## What the numbers mean

This is a **geometry and materials planner**. Its calculations do not determine whether a location is ecologically suitable, select a species for that habitat, or predict survival, growth or wave reduction. Choosing a species labels the plan; it does not establish a scientifically optimal spacing.

The following are visible, editable planning assumptions:

| Input | Initial value | Interpretation |
| --- | ---: | --- |
| Planning area | 400 m² | Area of the example plot, not established seagrass coverage |
| Centre-to-centre spacing | 2 m | Demo planning preset, not a species-specific planting recommendation |
| Circular clearance diameter | 0.30 m | Assumed circle enclosing the structure; its 0.15 m radius is kept inside the boundary |
| Structure unit cost | US$6 | Value supplied in the project poster, used as a demo assumption |
| Spares | 10% | Additional structures for the material estimate, rounded up |

The circular clearance is an assumed envelope, not a verified measurement of the apparatus. Replace it with a suitable dimension for the actual structure before using the layout for practical planning.

The calculation is:

```text
placed structures = number of generated positions that fit the boundary and clearance
spares = ceiling(placed structures × spare percentage / 100)
order quantity = placed structures + spares
estimated structure cost = order quantity × unit cost
```

Spare structures have no assigned planting coordinates. The estimate covers structures only; it does not include plants, collection, labour, boats, surveys, permits, transport or monitoring.

### Example comparison

For a 400 m² square, 2 m spacing, 0.30 m circular clearance, zero rotation, 10% spares and US$6 per structure, the deterministic layouts produce:

| Pattern | Placed structures | Spares | Order quantity | Structure cost |
| --- | ---: | ---: | ---: | ---: |
| Staggered | 120 | 12 | 132 | US$792 |
| Grid | 100 | 10 | 110 | US$660 |
| Patches | 36 | 4 | 40 | US$240 |

Changing the boundary or orientation can change the number of complete positions that fit. These figures are geometric results, not predicted ecological outcomes.

### Pattern and geometry details

**Grid** uses equal row and column pitch. **Staggered** alternates the horizontal row offset by half the spacing and uses a row pitch of `spacing × √3 / 2`. **Patches** uses complete groups of four positions arranged as a small square, with group centres separated by three times the spacing. An incomplete group at the boundary is omitted.

The engine enumerates positions and checks that each lies inside the boundary with the chosen clearance. It is not a maximum-packing optimizer. It uses a local equirectangular projection with an Earth radius of 6,371,008.8 m, suitable for a small-site planning approximation rather than a survey or construction specification. The engine rejects invalid polygons and limits computational work. Polygons crossing the antimeridian, polygons with holes and latitudes beyond ±80° are unsupported. The engine's area ceiling is 100,000 m² and its structure ceiling is 50,000; interface controls may use a smaller range.

## Site selection and scientific context

The basemap is a geographic reference. It does not supply habitat mapping, depth, underwater light, currents, wave exposure, sediment condition, existing seagrass, donor availability or permitting information. A saved locality may be centred on land. A successful place search means that the place was found, not that planting there is recommended.

Research on seagrass restoration supports careful habitat and donor selection and shows that outcomes depend on site conditions and restoration design. The papers below provide context for field planning; they do not validate this application's default spacing, structure clearance, species choices or apparatus performance.

- van Katwijk, M. M. et al. (2009). **Guidelines for seagrass restoration: Importance of habitat selection and donor population, spreading of risks, and ecosystem engineering effects.** *Marine Pollution Bulletin*. [DOI: 10.1016/j.marpolbul.2008.09.028](https://doi.org/10.1016/j.marpolbul.2008.09.028)
- van Katwijk, M. M. et al. (2016). **Global analysis of seagrass restoration: the importance of large-scale planting.** *Journal of Applied Ecology*. [DOI: 10.1111/1365-2664.12562](https://doi.org/10.1111/1365-2664.12562)
- Seagrass-Watch. [Seagrass identification guidance](https://www.seagrasswatch.org/idseagrass/).

## Online services and local data

| Function | Where it runs / what it needs |
| --- | --- |
| Layout geometry, quantities and cost | In the browser; no server calculation |
| Saved locality lookup and coordinate parsing | In the browser |
| Other place-name searches | Online request to Open-Meteo, using GeoNames data |
| Basemap imagery | Online requests for the visible OpenStreetMap tiles |
| Saved plans | Browser local storage; no cross-device synchronization |
| CSV, GeoJSON and print output | Generated in the browser |

Online search is performed when submitted, with a 9-second request timeout, serialized requests spaced at least one second apart and an in-memory cache. A failed network request is reported rather than replaced with invented search results. The saved localities remain available. Map tiles may be available from the browser's ordinary cache, but this is not a guaranteed offline map.

Saved data is specific to the browser and site origin, and can be lost when browser data is cleared. Export a plan when you need a portable copy. No login system, cloud database, shared workspace or backend storage is included.

### Provider terms and attribution

- **OpenStreetMap:** retain the visible **© OpenStreetMap contributors** attribution. Map data is provided under the [OpenStreetMap copyright and licence terms](https://www.openstreetmap.org/copyright). The standard tile service has its own [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). This demo requests visible tiles and does not bulk-download, prefetch an offline area or package tiles. For a larger public deployment, choose a tile provider and capacity appropriate to the expected traffic.
- **Open-Meteo / GeoNames:** the [geocoding API documentation](https://open-meteo.com/en/docs/geocoding-api) describes the search service and its GeoNames source. The free endpoint is keyless for eligible non-commercial use under [Open-Meteo's terms](https://open-meteo.com/en/terms). Review commercial-service requirements before using this demo commercially. [GeoNames](https://www.geonames.org/) is the underlying place-name source.
- **Leaflet:** the bundled Leaflet library is covered by its [BSD 2-Clause licence](https://github.com/Leaflet/Leaflet/blob/v1.9.4/LICENSE).
- **Project poster:** supplied as project material by the user. Its inclusion does not grant a new licence to third-party logos or imagery shown in the poster.

No Nominatim service is used. Satellite imagery is not included because a suitable imagery licence was not established for this demo.

## Source files

```text
COASTAL-Planner/
  OPEN-COASTAL.html     Direct-open packaged demo
  README.md            Setup, assumptions and provider references
  package.json         JavaScript module and test configuration
  dist/
    index.html         Source application markup
    styles.css         Base visual styling
    polish.css         Floating glass layout, typography and responsive refinements
    app.js             Interface, map interactions, storage and exports
    planner.js         Deterministic geographic layout and cost calculations
    geocoder.js        Saved localities, coordinates and online place search
    motion.js          Interaction animation and reduced-motion support
    vendor/            Bundled Leaflet assets
    assets/            COASTAL poster and app icon
  tests/
    planner.test.mjs   Geometry and calculation tests
```

### Run the calculation tests

With a current Node.js installation, from the project folder:

```sh
node --test tests/planner.test.mjs
```

The tests exercise the geometric planner. They do not verify ecological suitability, field performance or the availability of third-party services.
