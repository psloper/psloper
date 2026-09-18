#!/usr/bin/env python3
"""Rebuild data/uk-wind-farms.json and data/uk-radar-sites.json from source.

Both inputs are mirrored on GitHub, which is the only bulk-data host this
session's network policy allows. Everything else tried (Overpass, OpenStreetMap,
data.gov.uk, ArcGIS, nats.aero, caa.co.uk, Zenodo, Copernicus) is refused at the
egress proxy with a 403 on CONNECT.

Sources
-------
A. Wind farms
   wri/global-power-plant-database, output_database/global_power_plant_database.csv
   WRI Global Power Plant Database v1.3.0, CC BY 4.0. Unmaintained since early
   2022. 771 of the 780 UK wind rows carry geolocation_source = "UK Renewable
   Energy Planning Database", so this is REPD data at one remove.

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
import csv, io, json, math, re, sys, urllib.request

RAW = "https://raw.githubusercontent.com"
GPPD = f"{RAW}/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv"
SECTOR = f"{RAW}/VATSIM-UK/UK-Sector-File/main/Misc%20Other/Radar%20Sites.txt"
ATC = f"{RAW}/open-air-data/atc-radar/master/data/radars.geojson"

UK_BOX = (-11.0, 2.2, 49.0, 61.0)  # lon_min, lon_max, lat_min, lat_max
MERGE_RADIUS_M = 6000  # sources name the same site differently, so match on position


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
    rows = csv.DictReader(io.StringIO(get(GPPD).decode("utf-8")))
    out = []
    for x in rows:
        if x["country"] != "GBR" or x["primary_fuel"] != "Wind" or not x["latitude"]:
            continue
        out.append({
            "name": x["name"],
            "lat": round(float(x["latitude"]), 5),
            "lon": round(float(x["longitude"]), 5),
            "mw": round(float(x["capacity_mw"]), 1),
            "year": int(float(x["commissioning_year"])) if x["commissioning_year"] else None,
            "geo": x["geolocation_source"],
        })
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
    print(f"wind farms: {len(farms)} ({sum(f['mw'] for f in farms):.0f} MW)", file=sys.stderr)
    print(f"radar sites: {len(radars)} "
          f"({sum(1 for r in radars if len(r['sources']) == 2)} in both sources)", file=sys.stderr)
    print("now regenerate js/uksites.js with calibration/build_uksites.py", file=sys.stderr)


if __name__ == "__main__":
    main()
