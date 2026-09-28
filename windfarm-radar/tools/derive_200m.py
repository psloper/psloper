"""Derive a 200 m national grid from the committed 100 m blocks.

Max-pools 2x2, which preserves the property the 100 m data was built with: each
cell holds the HIGHEST source post, so an obstruction survives the resample
rather than being averaged away. Nothing is re-downloaded; this reads what is
already in data/terrain.

Exists so the offline single-file build has a middle option: the full build is
38.6 MB and the 500 m one is 3.5 MB, and 200 m lands between them.

    python3 tools/derive_200m.py
"""
import json, os, gzip, numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TDIR = os.path.join(HERE, 'data', 'terrain')
MAGIC = b"UKDEM1\0\0"
NODATA = -32768


def decode(path):
    raw = gzip.decompress(open(path, 'rb').read())
    assert raw[:8] == MAGIC, path
    lat0, lon0, dlat, dlon = np.frombuffer(raw, '<f8', 4, 8)
    nlat, nlon = np.frombuffer(raw, '<u4', 2, 40)
    d = np.frombuffer(raw, '<i2', int(nlat) * int(nlon), 56).reshape(int(nlat), int(nlon))
    return dict(lat0=float(lat0), lon0=float(lon0), dlat=float(dlat), dlon=float(dlon),
                a=np.cumsum(d.astype(np.int32), axis=1).astype(np.int16))


def encode(block, lat0, lon0, dlat, dlon):
    nlat, nlon = block.shape
    head = bytearray(MAGIC)
    head += np.array([lat0, lon0, dlat, dlon], dtype='<f8').tobytes()
    head += np.array([nlat, nlon], dtype='<u4').tobytes()
    head += np.array([NODATA], dtype='<i2').tobytes()
    head += b'\0' * 6
    wide = block.astype(np.int32)
    delta = np.diff(wide, axis=1, prepend=wide[:, :1])
    payload = np.clip(delta, -32767, 32767).astype('<i2')
    payload[:, 0] = block[:, 0]
    return gzip.compress(bytes(head) + payload.tobytes(), 9)


man = json.load(open(os.path.join(TDIR, 'manifest.json')))
c = man['coarse']
# The 200 m grid spans the same box as the 500 m one, at 2.5x the resolution.
dlat, dlon = c['dlat'] / 2.5, c['dlon'] / 2.5
nlat, nlon = int(c['nlat'] * 2.5), int(c['nlon'] * 2.5)
grid = np.full((nlat, nlon), NODATA, dtype=np.int16)
lat0, lon0 = c['lat0'], c['lon0']

for meta in man['blocks']:
    b = decode(os.path.join(TDIR, meta['file']))
    rows, cols = b['a'].shape
    src_lat = b['lat0'] + (np.arange(rows) + 0.5) * b['dlat']
    src_lon = b['lon0'] + (np.arange(cols) + 0.5) * b['dlon']
    gi = np.floor((src_lat - lat0) / dlat).astype(np.int64)
    gj = np.floor((src_lon - lon0) / dlon).astype(np.int64)
    iv = (gi >= 0) & (gi < nlat)
    jv = (gj >= 0) & (gj < nlon)
    if not iv.any() or not jv.any():
        continue
    sub = b['a'][np.ix_(iv, jv)]
    flat = (gi[iv][:, None] * nlon + gj[jv][None, :]).ravel()
    np.maximum.at(grid.reshape(-1), flat, sub.ravel())

sea = int((grid == NODATA).sum())
grid = np.where(grid == NODATA, 0, grid).astype(np.int16)
blob = encode(grid, lat0, lon0, dlat, dlon)
out = os.path.join(TDIR, 'uk-200m.bin')
open(out, 'wb').write(blob)

man['mid'] = {'file': 'uk-200m.bin', 'spacingM': 200, 'lat0': lat0, 'lon0': lon0,
              'dlat': dlat, 'dlon': dlon, 'nlat': nlat, 'nlon': nlon,
              'bytes': len(blob), 'seaCells': sea,
              'derivedFrom': '2x2 max-pool of the committed 100 m blocks'}
json.dump(man, open(os.path.join(TDIR, 'manifest.json'), 'w'), indent=1)
print(f"uk-200m.bin  {nlat} x {nlon}  {len(blob)/1e6:.2f} MB")
