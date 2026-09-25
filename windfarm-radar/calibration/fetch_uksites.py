#!/usr/bin/env python3
"""Rebuild data/uk-wind-farms.json and data/uk-radar-sites.json from source.

Every authoritative host is refused by this environment's network policy with a
403 on CONNECT, including data.gov.uk, nats.aero, caa.co.uk, Overpass,
OpenStreetMap, ArcGIS, Zenodo and Copernicus. GitHub is the only bulk-data host
that answers, so everything below is reached through a GitHub mirror rather than
its publisher. That is a real limitation on how much weight any of it carries.

Sources
-------
A. Wind farms: the UK Renewable Energy Planning Database (REPD)
   Ventusltd/globalgrid2050, testcode/<snapshot>/atlas/data/repd-identities/*.json

   The REPD is the UK government's record of every renewable project from
   inception through planning, construction, operation and decommissioning. It
   is Crown copyright, published under the Open Government Licence v3, which
   permits reuse with attribution. The repository mirroring it declares no
   licence of its own; what is used here are the OGL-licensed facts, and both
   the REPD and the mirror are attributed.

   Each record carries a development status. THAT IS THE POINT: most rows are
   not operating plant. Of 2,489 wind records, 832 are operational and 838 were
   refused, withdrawn, abandoned or expired. Treating the table as a list of
   wind farms overstates the fleet roughly threefold.

   The snapshot is a derived rendering, not the official download, so its
   currency depends on when whoever made it last refreshed it. Check the
   snapshot directory name, which is a timestamp, before relying on it.

B. Radar sites, source A
   VATSIM-UK/UK-Sector-File, "Misc Other/Radar Sites.txt"
   A flight-simulation community sector file. NO declared licence: the file is
   read and summarised here, and the derived coordinates are recorded, but the
   file itself is not redistributed. 17 NATS En Route sites and 32 aerodrome
   sites. Its military section is the literal line ";Mil Radars TBA".

C. Radar sites, source B
   open-air-data/atc-radar, data/radars.geojson
   ODbL / DbCL. Chiefly FAA sites; 23 features fall in the UK and Ireland box.

The derived radar list is a database derived from an ODbL source, so it is
offered under ODbL. Attribution to both projects is required.
"""
import glob, json, math, os, re, shutil, subprocess, sys, tempfile, urllib.request

RAW = "https://raw.githubusercontent.com"
SECTOR = f"{RAW}/VATSIM-UK/UK-Sector-File/main/Misc%20Other/Radar%20Sites.txt"
ATC = f"{RAW}/open-air-data/atc-radar/master/data/radars.geojson"
REPD_REPO = "https://github.com/Ventusltd/globalgrid2050.git"

UK_BOX = (-11.0, 3.0, 49.0, 61.5)  # lon_min, lon_max, lat_min, lat_max
MERGE_RADIUS_M = 6000  # the two radar sources name the same site differently

# REPD development statuses that mean the project exists or is expected to.
LIVE_STATUSES = ("Operational", "Under Construction", "Awaiting Construction",
                 "Application Submitted")


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=180) as r:
        return r.read()


def dms(token: str) -> float:
    """N053.27.00.300 -> 53.450083"""
    m = re.match(r"([NSEW])(\d+)\.(\d+)\.(\d+)\.(\d+)$", token)
    if not m:
        raise ValueError(f"not a sector-file coordinate: {token!r}")
    hemi, d, mi, sec, frac = m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5))
    v = d + mi / 60 + (sec + frac / 1000) / 3600
    return -v if hemi in "SW" else v


def great_circle_m(a_lat, a_lon, b_lat, b_lon):
    r = 6371008.8
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


def wind_farms():
    """Clone the REPD mirror, take its newest snapshot, keep the wind rows."""
    tmp = tempfile.mkdtemp(prefix="repd-")
    try:
        subprocess.run(["git", "clone", "--depth", "1", "-q", "--filter=blob:limit=6m",
                        REPD_REPO, tmp], check=True)
        snaps = sorted(glob.glob(os.path.join(tmp, "testcode/*/atlas/data/repd-identities")))
        if not snaps:
            raise SystemExit("no REPD snapshot found in the mirror; its layout has changed")
        print(f"REPD snapshot: {snaps[-1].split('testcode/')[1].split('/')[0]}", file=sys.stderr)
        rec = {}
        for f in glob.glob(os.path.join(snaps[-1], "*.json")):
            rec.update(json.load(open(f)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    out = []
    for ref, v in rec.items():
        tech = v.get("technology") or ""
        if not tech.startswith("wind"):
            continue
        # "approximate_lease_area_centre" and "missing" are the mirror's own
        # admission that it does not know where the project is. Drop them.
        if v.get("geometry_status") != "valid":
            continue
        if v.get("latitude") is None or v.get("longitude") is None:
            continue
        name = (v.get("name") or "").strip()
        if not name:
            name = f"REPD {ref} (no name recorded), {v.get('planning_authority') or 'unknown authority'}"
        out.append({
            "ref": ref, "name": name,
            "lat": round(float(v["latitude"]), 5), "lon": round(float(v["longitude"]), 5),
            "mw": round(float(v.get("capacity_mw") or 0), 1),
            "status": v["status"],
            "offshore": tech == "wind_offshore",
            "authority": v.get("planning_authority") or "",
        })
    out.sort(key=lambda x: x["name"])
    return out


def radar_sites():
    primary, group = [], None
    for line in get(SECTOR).decode("utf-8").splitlines():
        line = line.strip()
        if line.startswith(";"):
            group = line[1:].strip()
            continue
        if not line.startswith("RADAR2:"):
            continue
        p = line.split(":")
        primary.append({
            "name": p[1], "lat": dms(p[2]), "lon": dms(p[3]),
            "role": "en-route" if (group or "").startswith("NERL") else "aerodrome",
        })

    secondary = []
    for f in json.loads(get(ATC))["features"]:
        lon, lat = f["geometry"]["coordinates"]
        if UK_BOX[0] < lon < UK_BOX[1] and UK_BOX[2] < lat < UK_BOX[3]:
            secondary.append({"name": f["properties"].get("name", ""), "lat": lat, "lon": lon})

    sites = []
    for a in primary:
        best = None
        for b in secondary:
            d = great_circle_m(a["lat"], a["lon"], b["lat"], b["lon"])
            if d < MERGE_RADIUS_M and (best is None or d < best[0]):
                best = (d, b)
        s = {"name": a["name"], "role": a["role"],
             "lat": round(a["lat"], 5), "lon": round(a["lon"], 5),
             "sources": ["vatsim-uk"]}
        if best:
            s["sources"].append("atc-radar")
            s["alt_name"] = best[1]["name"]
            s["alt_lat"] = round(best[1]["lat"], 5)
            s["alt_lon"] = round(best[1]["lon"], 5)
            s["source_disagreement_m"] = round(best[0])
        sites.append(s)

    claimed = {s.get("alt_name") for s in sites}
    for b in secondary:
        if b["name"] in claimed:
            continue
        sites.append({"name": b["name"].title(), "role": "unclassified",
                      "lat": round(b["lat"], 5), "lon": round(b["lon"], 5),
                      "sources": ["atc-radar"]})
    return sites


def main():
    farms, radars = wind_farms(), radar_sites()
    json.dump(farms, open("data/uk-wind-farms.json", "w"), indent=0)
    json.dump(radars, open("data/uk-radar-sites.json", "w"), indent=0)
    live = [f for f in farms if f["status"] in LIVE_STATUSES]
    print(f"wind records: {len(farms)}", file=sys.stderr)
    print(f"  built or in the pipeline: {len(live)} ({sum(f['mw'] for f in live):,.0f} MW)", file=sys.stderr)
    print(f"  will not be built as recorded: {len(farms) - len(live)}", file=sys.stderr)
    print(f"radar sites: {len(radars)} "
          f"({sum(1 for r in radars if len(r['sources']) == 2)} in both sources)", file=sys.stderr)
    print("now regenerate js/uksites.js with calibration/build_uksites.py", file=sys.stderr)


if __name__ == "__main__":
    main()
