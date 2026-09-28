# Real elevation data

The tool ships with real ground heights for the British Isles. They are
**pre-baked into the repository**, not fetched when the page runs.

## Why pre-baked

Twelve elevation sources were probed. Eleven are unreachable from the
environment this was built in. One answers:

    https://copernicus-dem-30m.s3.amazonaws.com/

That is Copernicus DEM GLO-30 on AWS Open Data: free, global, no API key, 30 m
posts, served as Cloud Optimized GeoTIFF with HTTP range requests.

**It sends no CORS headers.** An OPTIONS preflight carrying an `Origin` returns
403, and a ranged GET comes back with no `Access-Control-Allow-Origin`. This
tool runs entirely in the page, so a browser cannot read that bucket. The data
is therefore fetched by `tools/build_terrain.py` at build time and committed.

That also keeps a property the tool would otherwise lose: it opens no
third-party connections and uploads nothing. Loading terrain reads files served
beside the page, like its own JavaScript.

## What is committed

| File | Contents | Size |
|---|---|---|
| `data/terrain/uk-500m.bin` | 500 m national grid, always loaded | 1.57 MB |
| `data/terrain/uk-100m-*.bin` | 30 blocks at 100 m, 2 degrees each, loaded on demand | 26.3 MB |
| **Total** | | **27.9 MB** |

The largest single block is 2.35 MB. A typical session downloads the national
grid plus one or two blocks, so about 3 to 4 MB.

Format: gzip over a 56-byte header and row-wise delta-encoded `int16` metres.
Delta encoding is worth about 23 per cent on terrain and costs ten lines to undo.

Rebuild with `python3 tools/build_terrain.py` (needs numpy, tifffile, imagecodecs).

## Validated against heights you can look up

| Location | Reads | Published | Error |
|---|---|---|---|
| Ben Nevis summit | 1342 m | 1345 m | −3 m |
| Scafell Pike summit | 972 m | 978 m | −6 m |
| Snowdon summit | 1071 m | 1085 m | −14 m |
| Loch Linnhe, open water | 0.0 m | 0 | 0 |
| Sound of Mull, open water | 0.0 m | 0 | 0 |

The highest cell in the Ben Nevis tile is 1343 m, which is correct, because it
is the highest point in the British Isles. `test/terrain.test.mjs` repeats every
one of these against the committed files.

The **published** copy carries the same bytes as base64 text, because the
artifact host serves no binary type. It was checked separately: all 30 blocks
decode with matching headers, and the worst error against a published height is
14.0 m, the same Snowdon figure.

## Repository cost, and when to reconsider it

The terrain is **27 MB of a 32 MB repository**: about 85 per cent of it. Before
this it was roughly 5 MB.

The files are already gzipped, so git cannot delta-compress them and cannot
compress them further. **Every future rebuild of the terrain adds another
~27 MB to history, permanently.** Rebuild it rarely, and if it needs to change
often, move it out to a release asset or drop to the 200 m grid, which is
8.3 MB for the same national coverage.

## The resample max-pools, and that is deliberate

Each target cell takes the **highest** 30 m post that falls in it, not the
nearest one.

Nearest-neighbour sampling was tried first and discards summits: Snowdon came
out at 1052 m, 33 m low, and Scafell Pike 11 m low, because the true peak post
is not the one a 100 m grid lands on. For line of sight that is the dangerous
direction to be wrong in, since it makes a beam look as though it clears a hill
it does not. Max-pooling recovered 19 m at Snowdon and errs toward saying a path
is blocked.

The same choice means a 500 m coastal cell reads as land rather than water,
because it contains the shoreline. That is the intended behaviour, and there is
a test asserting it.

## Does the resampling choice change conclusions, or only the picture?

Measured, not assumed. `node tools/terrain_verdict_impact.mjs` runs 178 real UK
radar-to-farm pairings between 2 and 22 km through the full analysis, three
ways: the shipped max-pooled data, a nearest-neighbour control set built from
the same source at the same resolution, and the synthetic surface.

**Max-pooled against nearest-neighbour**, where the only difference is the
resample:

| | Differs |
|---|---|
| Turbines the radar can see | 16 of 178 (9%) |
| Turbine plots reaching the display | 24 of 178 (13%) |
| Worst detection margin | median 0.01 dB, max 11.66 dB |

In 12 of the 16 disagreements, **nearest-neighbour saw more turbines** than
max-pooling: the beam looked clear where the higher resample says it is
blocked. The worst case is Accolade Wines at 15.4 km, where nearest-neighbour
reports all 12 turbines visible and max-pooling finds 7 of them masked.

So the resample is not cosmetic. It changes the answer in about one case in
ten, and almost always in the permissive direction.

**Real terrain against the synthetic surface** is starker:

| Surface | Line-of-sight outcomes across 178 pairings |
|---|---|
| Synthetic | **12 of 12 visible in every single case** |
| Real | 12/12 in 141, partially masked in 27, fully masked in 10 |

The synthetic surface never masked anything at real UK ranges. Terrain
screening is described in the tool as the strongest mitigation available, and
before this data it could not produce one.

## Two things it does not fix

**It is a surface model.** GLO-30 includes trees and buildings; it is not bare
earth. For whether a beam clears an obstruction that is arguably right. For a
turbine base ground level in forest it reads high.

**Accuracy is not precision.** The grid is 100 m, but the position it is sampled
at carries its own error. The built-in UK wind farm positions are planning
records, measured as out by about **1,100 m**. Measured inside that radius:

| Terrain | Median height spread | 90th percentile | Worst |
|---|---|---|---|
| Flat / coastal (under 100 m) | 232 m | 474 m | 841 m |
| Rolling (100 to 300 m) | 331 m | 562 m | 876 m |
| Upland (over 300 m) | 543 m | 764 m | 1,176 m |

Sampled in the Ben Nevis tile, the most mountainous in Britain, so treat these
as upper bounds. The point stands: real terrain sampled at an uncertain position
is a precise number with a large unknown error, and that is worse than an
obviously synthetic surface because it looks authoritative.

**Use it with surveyed positions.** The tool already imports surveyed turbine
schedules and `.asc` elevation grids, and that combination is the accurate path.

## Using it

Site & data tab, **Real elevation (Copernicus 30 m)**. A UK pairing has to be
placed first, because the data is anchored on the radar: the scene origin,
east = north = 0, is the radar, not the farm.

The Terrain tab then says plainly that real elevation is in use and that the
synthetic landform controls are ignored.

## Licence

Free, full and open under the Copernicus programme. Credit ESA / Copernicus.
