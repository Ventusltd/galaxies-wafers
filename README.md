# galaxies-wafers

Code galaxies with layers, in the manner of Grid Atlas.

The ground is **the wafer**: every permanently numbered line of the estate placed by one frozen law, `r = sqrt(key)`, `theta = key x golden angle`. It is the basemap and it never changes (`wafer.mjs`). The page (`index.html`, `app.mjs`, `lib.mjs`) is inherited unchanged from [testcode/202609151339](https://globalgrid2050.com/testcode/202609151339/).

On top of it sit **layers** (`layers/`, listed in `layers/manifest.json`), toggled from the LAYERS panel and loaded lazily, with Grid Atlas's states: `WAIT`, `LOAD`, `OK`, `EMPTY`, `FAIL`.

## The layer format

A layer is a `CodeFeatureCollection`: GeoJSON in shape, but geometry carries **permanent keys, never coordinates**.

```json
{ "type": "Feature", "geometry": { "type": "Point", "key": 8285 }, "properties": { } }
{ "type": "Feature", "geometry": { "type": "LineString", "keys": [3, 4] }, "properties": { } }
```

The substrate turns a key into a place, so a layer cannot disagree with the ground about where anything is. `build/build_layers.py` refuses to write a key the numbered database does not contain, and records the hash of every source it read.

## Layers so far

| layer | what it draws | evidence |
|---|---|---|
| copying | lines carried by 2 to 40 functions, 12+ characters | the family index |
| crossname | differently named functions sharing substantial lines, containment excluded | the family index |
| blocks | functions inside a named, numbered block | the live block register |
| engine | the grid engine's functions | the live block register |
| grid-engine-shell | the grid engine's functions with each module's export subpath, schema and NOT_COMPUTED keys; feeds the ELEMENT cards | the live block register, the engine's package.json and module source, `node verify.mjs` |
| declared | dependencies the register declares | `depends_on` |
| learned | rules learned from recorded composition failures | the chemistry star |

## What is not claimed

A shared line is not a call or a dependency. A declared dependency is what an author wrote down. A learned rule is a counted failure, not a proof of coupling.
