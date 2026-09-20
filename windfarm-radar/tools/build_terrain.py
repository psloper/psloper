"""Pre-bake UK elevation data into the repository.

WHY THIS IS A BUILD STEP AND NOT A RUNTIME FETCH.

The only elevation source reachable from this project's network is the
Copernicus DEM GLO-30 bucket on AWS Open Data:

    https://copernicus-dem-30m.s3.amazonaws.com/

It serves HTTP range requests and is publicly listable, but it sends NO CORS
headers: an OPTIONS preflight carrying an Origin returns 403, and a ranged GET
comes back without Access-Control-Allow-Origin. A browser therefore cannot read
it. Since this tool runs entirely in the page, the data has to be fetched here,
at build time, and committed. That also keeps the promise the tool makes: it
opens no third-party connections and uploads nothing.

WHAT IS PRODUCED

    data/terrain/manifest.json     grid geometry and the list of blocks
    data/terrain/uk-500m.bin       one coarse national grid, always loaded
    data/terrain/uk-100m-*.bin     2-degree blocks at 100 m, loaded on demand

Each .bin is gzip over row-wise delta-encoded int16 metres. Delta encoding is
worth about 23 per cent on terrain and costs ten lines to undo in the browser.

Run from the windfarm-radar directory:

    python3 tools/build_terrain.py                # download and build
    python3 tools/build_terrain.py --cache DIR    # reuse saved .npy grids

Needs numpy, tifffile and imagecodecs.
"""

import argparse, gzip, io, json, os, sys, time, urllib.request
import concurrent.futures as cf
import numpy as np
import tifffile

BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
M_PER_DEG = 111320.0
REF_LAT = 55.0                     # cells are made square at this latitude
COS_REF = float(np.cos(np.radians(REF_LAT)))

# Whole-degree bounding box for the British Isles.
LAT0, LAT1 = 49.0, 61.0
LON0, LON1 = -9.0, 3.0

NODATA = -32768
BLOCK_DEG = 2                      # 100 m data ships in 2-degree blocks
MAGIC = b"UKDEM1\0\0"


def tile_key(lat, lon):
    ns = f"N{lat:02d}" if lat >= 0 else f"S{abs(lat):02d}"
    ew = f"E{lon:03d}" if lon >= 0 else f"W{abs(lon):03d}"
    return f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"


def make_grid(spacing_m):
    dlat = spacing_m / M_PER_DEG
    dlon = spacing_m / (M_PER_DEG * COS_REF)
    nlat = int(np.ceil((LAT1 - LAT0) / dlat))
    nlon = int(np.ceil((LON1 - LON0) / dlon))
    return dict(spacing=spacing_m, dlat=dlat, dlon=dlon, nlat=nlat, nlon=nlon,
                a=np.full((nlat, nlon), NODATA, dtype=np.int16))


def fetch_tile(latlon):
    lat, lon = latlon
    k = tile_key(lat, lon)
    url = f"{BUCKET}/{k}/{k}.tif"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                return lat, lon, r.read()
        except Exception:
            if attempt == 2:
                return lat, lon, None
            time.sleep(2 * (attempt + 1))


def existing_tiles():
    """HEAD every candidate tile; most of the box is open ocean with no tile."""
    cands = [(la, lo) for la in range(int(LAT0), int(LAT1))
             for lo in range(int(LON0), int(LON1))]

    def probe(t):
        la, lo = t
        k = tile_key(la, lo)
        req = urllib.request.Request(f"{BUCKET}/{k}/{k}.tif", method="HEAD")
        try:
            with urllib.request.urlopen(req, timeout=30):
                return t
        except Exception:
            return None

    with cf.ThreadPoolExecutor(16) as ex:
        return [t for t in ex.map(probe, cands) if t]


def resample_into(grids, lat, lon, blob):
    """Max-pool the 30 m source onto each target grid.

    NOT nearest neighbour. Picking the nearest source post discards summits:
    measured on the first build, Snowdon came out 33 m low and Scafell Pike 11 m
    low, because the true peak post is not the one a 100 m grid lands on. For
    line of sight that is the dangerous direction to be wrong in, since it makes
    a beam look as though it clears a hill it does not. Taking the HIGHEST
    source post in each target cell keeps the obstruction and errs towards
    saying a path is blocked.
    """
    with tifffile.TiffFile(io.BytesIO(blob)) as tf:
        page = tf.pages[0]
        arr = page.asarray()
        tags = {t.name: t.value for t in page.tags}
    tlon0, tlat0 = tags["ModelTiepointTag"][3], tags["ModelTiepointTag"][4]
    tdx, tdy = tags["ModelPixelScaleTag"][0], tags["ModelPixelScaleTag"][1]
    rows, cols = arr.shape

    # Latitude and longitude of every source post centre.
    src_lat = tlat0 - (np.arange(rows) + 0.5) * tdy
    src_lon = tlon0 + (np.arange(cols) + 0.5) * tdx
    vals = np.rint(np.clip(arr, -1000, 9000)).astype(np.int16)

    for g in grids:
        gi = np.floor((src_lat - LAT0) / g["dlat"]).astype(np.int64)
        gj = np.floor((src_lon - LON0) / g["dlon"]).astype(np.int64)
        iv = (gi >= 0) & (gi < g["nlat"])
        jv = (gj >= 0) & (gj < g["nlon"])
        if not iv.any() or not jv.any():
            continue
        sub = vals[np.ix_(iv, jv)]
        flat = (gi[iv][:, None] * g["nlon"] + gj[jv][None, :]).ravel()
        np.maximum.at(g["a"].reshape(-1), flat, sub.ravel())


def encode(block, lat0, lon0, dlat, dlon):
    """Header + row-wise delta int16, gzipped.

    NO-DATA CELLS ARE SEA, AND ARE STORED AS 0 m.

    A cell is left at NODATA only when no Copernicus post fell in it, and that
    happens only where no Copernicus tile exists. GLO-30 covers all land, so
    within the British Isles box that means open ocean. Storing them as 0 is a
    statement of fact, not a guess, and it matters because a NODATA value
    breaks the delta chain: the step from -32768 to a real height exceeds what
    an int16 delta can carry, so it clips and every later value in the row is
    wrong. The first build had exactly that defect.
    """
    nlat, nlon = block.shape
    sea = int((block == NODATA).sum())
    block = np.where(block == NODATA, 0, block).astype(np.int16)
    head = bytearray(MAGIC)
    head += np.array([lat0, lon0, dlat, dlon], dtype="<f8").tobytes()
    head += np.array([nlat, nlon], dtype="<u4").tobytes()
    head += np.array([NODATA], dtype="<i2").tobytes()
    head += b"\0\0\0\0\0\0"                       # pad to a multiple of 8
    wide = block.astype(np.int32)
    delta = np.diff(wide, axis=1, prepend=wide[:, :1])
    payload = np.clip(delta, -32767, 32767).astype("<i2")
    payload[:, 0] = block[:, 0]
    return gzip.compress(bytes(head) + payload.tobytes(), 9), sea


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="directory holding grid_<spacing>.npy from a previous run")
    ap.add_argument("--out", default="data/terrain")
    args = ap.parse_args()

    coarse = make_grid(500)
    fine = make_grid(100)
    grids = [coarse, fine]

    cached = False
    if args.cache:
        try:
            coarse["a"] = np.load(os.path.join(args.cache, "grid_500.npy"))
            fine["a"] = np.load(os.path.join(args.cache, "grid_100.npy"))
            cached = True
            print(f"reusing cached grids from {args.cache}")
        except OSError:
            print("cache incomplete, downloading instead")

    if not cached:
        tiles = existing_tiles()
        print(f"{len(tiles)} Copernicus tiles cover the box")
        done = 0
        with cf.ThreadPoolExecutor(8) as ex:
            for lat, lon, blob in ex.map(fetch_tile, tiles):
                done += 1
                if blob is None:
                    print(f"  FAILED {lat} {lon}", file=sys.stderr)
                    continue
                resample_into(grids, lat, lon, blob)
                if done % 12 == 0:
                    print(f"  {done}/{len(tiles)}")

    os.makedirs(args.out, exist_ok=True)
    manifest = {
        "source": "Copernicus DEM GLO-30 (COP-DEM_GLO-30-DGED), AWS Open Data",
        "bucket": BUCKET,
        "model": "digital SURFACE model: includes trees and buildings, not bare earth",
        "licence": "Free, full and open under the Copernicus programme. Credit ESA / Copernicus.",
        "built": time.strftime("%Y-%m-%d"),
        "bounds": {"lat0": LAT0, "lat1": LAT1, "lon0": LON0, "lon1": LON1},
        "refLat": REF_LAT,
        "nodata": NODATA,
        "noTileCells": "stored as 0 m: no Copernicus tile means open sea",
        "coarse": None,
        "blocks": [],
    }

    path = os.path.join(args.out, "uk-500m.bin")
    blob, sea_coarse = encode(coarse["a"], LAT0, LON0, coarse["dlat"], coarse["dlon"])
    with open(path, "wb") as f:
        f.write(blob)
    manifest["coarse"] = {
        "file": "uk-500m.bin", "spacingM": 500,
        "lat0": LAT0, "lon0": LON0, "dlat": coarse["dlat"], "dlon": coarse["dlon"],
        "nlat": coarse["nlat"], "nlon": coarse["nlon"],
        "bytes": os.path.getsize(path),
        "seaCells": sea_coarse,
    }
    print(f"\nuk-500m.bin  {os.path.getsize(path)/1e6:.2f} MB")

    rows = int(np.ceil(BLOCK_DEG / fine["dlat"]))
    cols = int(np.ceil(BLOCK_DEG / fine["dlon"]))
    total = 0
    for i in range(0, fine["nlat"], rows):
        for j in range(0, fine["nlon"], cols):
            sub = fine["a"][i:i + rows, j:j + cols]
            if (sub == NODATA).all():
                continue
            blat = LAT0 + i * fine["dlat"]
            blon = LON0 + j * fine["dlon"]
            name = f"uk-100m-{round(blat)}-{round(blon)}.bin".replace("--", "-m")
            p = os.path.join(args.out, name)
            blob, sea = encode(np.ascontiguousarray(sub), blat, blon, fine["dlat"], fine["dlon"])
            with open(p, "wb") as f:
                f.write(blob)
            size = os.path.getsize(p)
            total += size
            manifest["blocks"].append({
                "file": name, "spacingM": 100,
                "lat0": blat, "lon0": blon,
                "dlat": fine["dlat"], "dlon": fine["dlon"],
                "nlat": int(sub.shape[0]), "nlon": int(sub.shape[1]),
                "bytes": size, "seaCells": sea,
            })
    print(f"{len(manifest['blocks'])} blocks at 100 m, {total/1e6:.1f} MB, "
          f"largest {max(b['bytes'] for b in manifest['blocks'])/1e6:.2f} MB")

    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"total committed {(total + manifest['coarse']['bytes'])/1e6:.1f} MB")


if __name__ == "__main__":
    main()
