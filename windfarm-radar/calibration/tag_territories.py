#!/usr/bin/env python3
"""Tag every wind farm and radar with the territory it stands in.

WHY THIS SHIPS NO GEOMETRY

The source is a 48 MB territory-boundary shapefile with 3,156,054 points. None
of it is needed at runtime: the question it answers, "which country is this
site in", is settled once here and stored as a short string per record. The
alternative, shipping simplified outlines and testing at runtime, would cost
hundreds of kilobytes and be LESS accurate, because the test would run against
a simplified coastline rather than the full one.

WHAT IT IS NOT

It is not a coastline. The polygons are territories, so England's ring follows
the land borders with Scotland and Wales: England shares 5,669 vertices with
Scotland's ring and 23,964 with Wales's. Drawing these rings would draw those
borders as if they were coast. The map's coastline stays Natural Earth.

The Northern Ireland and Ireland rings share NO vertices, so the same border is
digitised twice from different data. Anything that tries to union these
territories has to cope with that; this does not need to.

Source: UK_IRELAND shapefile supplied by the user under CC BY 4.0. The files
carry no creator metadata, so the attribution below is as precise as they allow.

Run from the windfarm-radar directory, with the .shp somewhere readable:
  python3 calibration/tag_territories.py /path/to/UK_IRELAND.shp
"""
import json, math, struct, sys

NAMES = ['England', 'Scotland', 'Wales', 'Northern Ireland',
         'Ireland', 'Isle of Man', 'Channel Islands']


def read_polygons(path):
    raw = open(path, 'rb').read()
    code, = struct.unpack('>i', raw[0:4])
    if code != 9994:
        sys.exit(f'{path} is not a shapefile (file code {code}, expected 9994)')
    shptype, = struct.unpack('<i', raw[32:36])
    if shptype != 5:
        sys.exit(f'{path} holds shape type {shptype}, expected 5 (Polygon)')
    off, out = 100, []
    while off < len(raw):
        _, clen = struct.unpack('>ii', raw[off:off + 8])
        b = off + 8
        nparts, npoints = struct.unpack('<ii', raw[b + 36:b + 44])
        parts = struct.unpack(f'<{nparts}i', raw[b + 44:b + 44 + 4 * nparts])
        pbase = b + 44 + 4 * nparts
        co = struct.unpack(f'<{2 * npoints}d', raw[pbase:pbase + 16 * npoints])
        rings = []
        for k in range(nparts):
            s = parts[k]
            e = parts[k + 1] if k + 1 < nparts else npoints
            rings.append([(co[2 * i], co[2 * i + 1]) for i in range(s, e)])
        out.append(rings)
        off = b + clen * 2
    return out


def signed_area(ring):
    return sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
               for i in range(len(ring) - 1)) / 2.0


def build_index(polys):
    """Outer rings only, each with a bounding box so most tests reject cheaply."""
    terr = []
    for name, rings in zip(NAMES, polys):
        rs = []
        for r in rings:
            # Clockwise is an outer ring in a shapefile; anticlockwise is a
            # hole. Holes here are Irish lakes, and a point in a lake is still
            # in Ireland for this purpose, so they are ignored rather than
            # subtracted.
            if signed_area(r) >= 0:
                continue
            xs = [p[0] for p in r]
            ys = [p[1] for p in r]
            rs.append((min(xs), min(ys), max(xs), max(ys), r))
        terr.append((name, rs))
    return terr


def in_ring(x, y, ring):
    c = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def locate(terr, x, y):
    for name, rs in terr:
        for x0, y0, x1, y1, r in rs:
            if x0 <= x <= x1 and y0 <= y <= y1 and in_ring(x, y, r):
                return name
    return None


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__.strip().splitlines()[-1])
    terr = build_index(read_polygons(sys.argv[1]))
    total_rings = sum(len(rs) for _, rs in terr)
    print(f'{total_rings:,} outer rings across {len(terr)} territories')

    farms = json.load(open('data/uk-wind-farms.json'))
    radars = json.load(open('data/uk-radar-sites.json'))

    # The offshore flag and the geography are independent, so comparing them is
    # a real check rather than a restatement.
    onshore_in_sea, offshore_on_land = [], []
    counts = {}
    for f in farms:
        t = locate(terr, f['lon'], f['lat'])
        f['territory'] = t            # None stays null: offshore is not a country
        counts[t or 'offshore or outside'] = counts.get(t or 'offshore or outside', 0) + 1
        if t is None and not f.get('offshore'):
            onshore_in_sea.append(f)
        if t is not None and f.get('offshore'):
            offshore_on_land.append((f, t))
    for r in radars:
        r['territory'] = locate(terr, r['lon'], r['lat'])

    json.dump(farms, open('data/uk-wind-farms.json', 'w'), indent=0)
    json.dump(radars, open('data/uk-radar-sites.json', 'w'), indent=0)

    print('\nwind farms by territory:')
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f'  {k:24} {v:>5}')
    print(f'\ncross-check against the offshore flag, on {len(farms)} records:')
    print(f'  flagged onshore but outside every landmass: {len(onshore_in_sea)}')
    for f in onshore_in_sea:
        print(f"    {f['name'][:44]:46} {f['lat']:.4f},{f['lon']:.4f}")
    print(f'  flagged offshore but inside a landmass: {len(offshore_on_land)}')
    for f, t in offshore_on_land:
        print(f"    {f['name'][:44]:46} {f['lat']:.4f},{f['lon']:.4f}  in {t}")


if __name__ == '__main__':
    main()
