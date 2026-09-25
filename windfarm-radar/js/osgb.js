// British National Grid to WGS84, and back.
//
// This exists because the importer used to treat an easting and a northing as
// an OFFSET from a nominal radar grid position, not as a national grid
// reference. For a schedule written in true OSGB36 eastings and northings,
// which is most UK planning and safeguarding data, that put every site
// hundreds of kilometres from where it belongs unless the user happened to set
// the radar grid position to match.
//
// Two steps, and they are different things:
//
//  1. The PROJECTION, between National Grid eastings and northings and
//     latitude and longitude on the Airy 1830 ellipsoid. This is exact
//     arithmetic (Redfearn's series) and is checked here against the worked
//     example in the Ordnance Survey's guide to coordinate systems.
//
//  2. The DATUM SHIFT, between OSGB36 and WGS84. OSGB36 is not a geocentric
//     datum and the true relationship varies across the country, which is why
//     the OS publishes OSTN15, a correction grid accurate to a centimetre or
//     so. OSTN15 is about 20 MB and this tool ships offline, so what is used
//     here is the 7-parameter Helmert approximation instead.
//
// ACCURACY. The Helmert approximation is good to a few metres across Great
// Britain, against OSTN15's centimetres. That is the right trade for this
// tool: the planning-database positions it is mostly converting carry about
// 1,100 m of error, so a few metres of datum approximation is three orders of
// magnitude below the noise it sits in. It is NOT good enough to set out a
// turbine foundation, and nothing here should be used for that.
//
// PROVENANCE, and it is split because the two halves have different standing.
//
// The FRAMEWORK is confirmed by the Ordnance Survey's own guide to coordinate
// systems, one page of which was supplied and is stored at
// docs/evidence/os-coordinate-systems-guide.txt. It states that the National
// Grid "consists of: a traditional geodetic datum using the Airy 1830
// ellipsoid; a TRF called OSGB36 ... and a Transverse Mercator map
// projection", which is exactly the three-part structure implemented here,
// and that "National Grid coordinates are nowadays determined by GNSS plus a
// transformation rather than theodolite triangulation", which is what this
// module does.
//
// The NUMBERS are not on that page and remain unverified against an OS
// document. The projection constants and the worked example came from a search
// result; the Helmert parameters are the widely published OSGB36 set and were
// not checked against a primary source. Every Ordnance Survey host is blocked
// from the environment this was built in. The test suite checks the projection
// against the worked example and checks the datum shift lands in the band a GB
// point should move, which catches a transposed sign but would not catch a
// wrong parameter in the last decimal place.
//
// ETRS89 IS NOT WGS84, and the OS page is explicit that OS Net uses ETRS89.
// The two were coincident in 1989 and have drifted apart with the motion of
// the Eurasian plate, by roughly a metre now. A GNSS position given as ETRS89
// and used here as WGS84 carries that error. It is smaller than the few metres
// the Helmert approximation already costs, so it is not corrected, but it is
// not nothing and it is not the same thing.
//
// HEIGHTS ARE A SEPARATE PROBLEM AND THIS MODULE DOES NOT TOUCH THEM. British
// map heights are Ordnance Datum Newlyn, which the OS page describes as a
// tide-gauge datum levelled from Newlyn, where each bench mark carries "an
// orthometric height only". The elevation data this tool ships is Copernicus,
// referenced to the EGM2008 geoid. Those are different vertical datums. See
// VERTICAL_DATUM below.

const DEG = Math.PI / 180;

/** Airy 1830, the ellipsoid the National Grid is projected on. */
export const AIRY_1830 = { a: 6377563.396, b: 6356256.909 };

/** GRS80 / WGS84. The difference between the two is below a millimetre. */
export const WGS84 = { a: 6378137.0, b: 6356752.3142 };

/** The National Grid projection. */
export const NATIONAL_GRID = {
  F0: 0.9996012717,   // scale factor on the central meridian
  lat0: 49 * DEG,     // true origin
  lon0: -2 * DEG,
  E0: 400000,         // false origin, metres
  N0: -100000,
  note: 'True origin 49 N, 2 W. False origin 400000 E, -100000 N. Scale factor '
    + '0.9996012717 on the central meridian.',
};

/**
 * OSGB36 to WGS84, the Helmert 7-parameter approximation.
 * Reverse the signs for WGS84 to OSGB36.
 */
export const HELMERT_OSGB36_TO_WGS84 = {
  tx: 446.448, ty: -125.157, tz: 542.060,      // metres
  s: -20.4894e-6,                              // scale, parts per million
  rx: 0.1502, ry: 0.2470, rz: 0.8421,          // rotations, seconds of arc
  accuracy: 'A few metres across Great Britain. OSTN15 is the centimetre-accurate '
    + 'transformation and is not used here because it needs a 20 MB correction grid.',
};

function toCartesian(lat, lon, h, ell) {
  const { a, b } = ell;
  const e2 = (a * a - b * b) / (a * a);
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const nu = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  return {
    x: (nu + h) * cosLat * Math.cos(lon),
    y: (nu + h) * cosLat * Math.sin(lon),
    z: ((1 - e2) * nu + h) * sinLat,
  };
}

function fromCartesian(p, ell) {
  const { a, b } = ell;
  const e2 = (a * a - b * b) / (a * a);
  const lon = Math.atan2(p.y, p.x);
  const r = Math.hypot(p.x, p.y);
  let lat = Math.atan2(p.z, r * (1 - e2));
  let nu = a;
  // Converges in a handful of passes at these latitudes; the bound is there so
  // a pathological input cannot spin forever.
  for (let i = 0; i < 12; i++) {
    const sinLat = Math.sin(lat);
    nu = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    const next = Math.atan2(p.z + e2 * nu * sinLat, r);
    if (Math.abs(next - lat) < 1e-13) { lat = next; break; }
    lat = next;
  }
  return { lat, lon, h: r / Math.cos(lat) - nu };
}

function helmert(p, t, invert = false) {
  const sign = invert ? -1 : 1;
  const s = 1 + sign * t.s;
  const SEC = Math.PI / 180 / 3600;
  const rx = sign * t.rx * SEC, ry = sign * t.ry * SEC, rz = sign * t.rz * SEC;
  return {
    x: sign * t.tx + p.x * s - p.y * rz + p.z * ry,
    y: sign * t.ty + p.x * rz + p.y * s - p.z * rx,
    z: sign * t.tz - p.x * ry + p.y * rx + p.z * s,
  };
}

/** OSGB36 latitude and longitude in degrees to National Grid metres. */
export function osgb36ToGrid(latDeg, lonDeg) {
  const { a, b } = AIRY_1830;
  const { F0, lat0, lon0, E0, N0 } = NATIONAL_GRID;
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const e2 = (a * a - b * b) / (a * a);
  const n = (a - b) / (a + b);
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const dLat = lat - lat0, sLat = lat + lat0;
  const M = b * F0 * (
    (1 + n + 1.25 * n * n + 1.25 * n * n * n) * dLat
    - (3 * n + 3 * n * n + 2.625 * n * n * n) * Math.sin(dLat) * Math.cos(sLat)
    + (1.875 * n * n + 1.875 * n * n * n) * Math.sin(2 * dLat) * Math.cos(2 * sLat)
    - (35 / 24) * n * n * n * Math.sin(3 * dLat) * Math.cos(3 * sLat));

  const cos3 = cosLat ** 3, cos5 = cosLat ** 5;
  const tan2 = tanLat * tanLat, tan4 = tan2 * tan2;
  const I = M + N0;
  const II = (nu / 2) * sinLat * cosLat;
  const III = (nu / 24) * sinLat * cos3 * (5 - tan2 + 9 * eta2);
  const IIIA = (nu / 720) * sinLat * cos5 * (61 - 58 * tan2 + tan4);
  const IV = nu * cosLat;
  const V = (nu / 6) * cos3 * (nu / rho - tan2);
  const VI = (nu / 120) * cos5 * (5 - 18 * tan2 + tan4 + 14 * eta2 - 58 * tan2 * eta2);

  const d = lon - lon0, d2 = d * d;
  return {
    easting: E0 + IV * d + V * d2 * d + VI * d2 * d2 * d,
    northing: I + II * d2 + III * d2 * d2 + IIIA * d2 * d2 * d2,
  };
}

/** National Grid metres to OSGB36 latitude and longitude in degrees. */
export function gridToOsgb36(easting, northing) {
  const { a, b } = AIRY_1830;
  const { F0, lat0, lon0, E0, N0 } = NATIONAL_GRID;
  const e2 = (a * a - b * b) / (a * a);
  const n = (a - b) / (a + b);

  let lat = lat0, M = 0;
  // Iterate the meridional arc until the northing matches to a tenth of a
  // millimetre, which is far finer than anything downstream can use.
  for (let i = 0; i < 40; i++) {
    lat += (northing - N0 - M) / (a * F0);
    const dLat = lat - lat0, sLat = lat + lat0;
    M = b * F0 * (
      (1 + n + 1.25 * n * n + 1.25 * n * n * n) * dLat
      - (3 * n + 3 * n * n + 2.625 * n * n * n) * Math.sin(dLat) * Math.cos(sLat)
      + (1.875 * n * n + 1.875 * n * n * n) * Math.sin(2 * dLat) * Math.cos(2 * sLat)
      - (35 / 24) * n * n * n * Math.sin(3 * dLat) * Math.cos(3 * sLat));
    if (Math.abs(northing - N0 - M) < 1e-4) break;
  }

  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;
  const t2 = tanLat * tanLat, t4 = t2 * t2, t6 = t4 * t2;
  const sec = 1 / cosLat;

  const VII = tanLat / (2 * rho * nu);
  const VIII = tanLat / (24 * rho * nu ** 3) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2);
  const IX = tanLat / (720 * rho * nu ** 5) * (61 + 90 * t2 + 45 * t4);
  const X = sec / nu;
  const XI = sec / (6 * nu ** 3) * (nu / rho + 2 * t2);
  const XII = sec / (120 * nu ** 5) * (5 + 28 * t2 + 24 * t4);
  const XIIA = sec / (5040 * nu ** 7) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);

  const dE = easting - E0, dE2 = dE * dE;
  return {
    lat: (lat - VII * dE2 + VIII * dE2 * dE2 - IX * dE2 * dE2 * dE2) / DEG,
    lon: (lon0 + X * dE - XI * dE2 * dE + XII * dE2 * dE2 * dE
      - XIIA * dE2 * dE2 * dE2 * dE) / DEG,
  };
}

/** National Grid easting and northing to WGS84 latitude and longitude. */
export function gridToWgs84(easting, northing) {
  const o = gridToOsgb36(easting, northing);
  const c = toCartesian(o.lat * DEG, o.lon * DEG, 0, AIRY_1830);
  const w = fromCartesian(helmert(c, HELMERT_OSGB36_TO_WGS84), WGS84);
  return { lat: w.lat / DEG, lon: w.lon / DEG };
}

/** WGS84 latitude and longitude to National Grid easting and northing. */
export function wgs84ToGrid(latDeg, lonDeg) {
  const c = toCartesian(latDeg * DEG, lonDeg * DEG, 0, WGS84);
  const o = fromCartesian(helmert(c, HELMERT_OSGB36_TO_WGS84, true), AIRY_1830);
  return osgb36ToGrid(o.lat / DEG, o.lon / DEG);
}

/**
 * Does this pair of numbers look like a British National Grid reference?
 *
 * The grid runs 0 to 700000 east and 0 to 1300000 north, so a pair inside that
 * box and large enough not to be a local offset is almost certainly a grid
 * reference. Used to decide whether a column of eastings should be converted
 * or treated as metres from the site, which is a guess, so the importer
 * reports which reading it took rather than making it silently.
 */
export function looksLikeNationalGrid(easting, northing) {
  return Number.isFinite(easting) && Number.isFinite(northing)
    && easting >= 0 && easting <= 700000
    && northing >= 0 && northing <= 1300000
    && (easting > 1000 || northing > 1000);
}

/**
 * Could this pair also be an Irish Grid reference?
 *
 * The Irish Grid runs 0 to 400000 east and 0 to 500000 north, which sits
 * entirely inside the British National Grid box. A pair in the overlap cannot
 * be told apart from the numbers alone, and reading an Irish reference as a
 * British one puts the site roughly 100 km out. The importer cannot resolve
 * this, so it says so rather than choosing silently.
 */
export function ambiguousWithIrishGrid(easting, northing) {
  return looksLikeNationalGrid(easting, northing)
    && easting <= 400000 && northing <= 500000;
}

/**
 * The vertical datum mismatch, named rather than silently carried.
 *
 * Everything this tool computes from heights ABOVE GROUND LEVEL is unaffected:
 * antenna height on its mast, turbine hub and tip above the pad. Those are
 * differences, and a datum cancels in a difference.
 *
 * What is affected is any height ABOVE SEA LEVEL that crosses between the two
 * worlds. The tool prints AMSL figures derived from Copernicus terrain, which
 * is EGM2008. A height read off a British drawing, a spot height or a bench
 * mark is Ordnance Datum Newlyn. Comparing one with the other carries the
 * difference between the two geoids, which in Great Britain is a sub-metre
 * quantity but is not zero.
 *
 * No correction is applied, because applying one would need a geoid separation
 * model this tool does not have and cannot fetch. The point of this constant
 * is that the mismatch is stated where someone comparing numbers will find it.
 */
export const VERTICAL_DATUM = {
  toolUses: 'EGM2008, through Copernicus DEM GLO-30.',
  britishMapsUse: 'Ordnance Datum Newlyn (ODN).',
  corrected: false,
  affectsAgl: false,
  aglNote: 'Heights above ground level are differences, so the datum cancels. Antenna '
    + 'height, hub height and tip height are all unaffected.',
  affectsAmsl: true,
  amslNote: 'Any height above sea level this tool prints is EGM2008-based. A spot height or '
    + 'bench mark from a British drawing is ODN. The two differ by a sub-metre amount across '
    + 'Great Britain, so do not treat them as interchangeable when checking one against the '
    + 'other. The size of the difference is NOT quantified here: it needs a geoid separation '
    + 'model this tool does not carry.',
  ref: 'Ordnance Survey, A guide to coordinate systems in Great Britain, '
    + 'docs/evidence/os-coordinate-systems-guide.txt',
};
