/**
 * A map of one AREA, not the whole country.
 *
 * The national map answers "where is everything". This answers "what is in
 * this square", which is the question you have when a developer names a search
 * area: a 100 mile box round a site, every wind farm in it, every radar that
 * can see into it, and how much of the box each radar covers.
 *
 * It renders to any canvas, so the same code draws the on-screen view and the
 * picture that goes into the Word, Excel and PDF reports. Drawing the report
 * image through a second path would let the two drift, and a report that shows
 * something the screen does not is worse than no picture.
 *
 * SCALE. The box is specified as a full width, and in whatever unit the caller
 * names: 100 miles means a 100 by 100 mile square, not a 100 mile radius. A
 * radius would be the more natural thing to code and the wrong thing to hand
 * someone who asked for a square.
 */

import { MAP_COLORS, groupOf } from './ukmap.js';
import { COASTLINE } from './coastline.js';
import { greatCircleM } from './uksites.js';

export const KM_PER_MILE = 1.609344;
const M_PER_DEG_LAT = 111132;
const mPerDegLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

/**
 * A square box about a centre. `widthKm` is the FULL width of the square.
 */
export function areaBox(centreLat, centreLon, widthKm) {
  const half = (widthKm * 1000) / 2;
  const dLat = half / M_PER_DEG_LAT;
  const dLon = half / mPerDegLon(centreLat);
  return {
    centreLat, centreLon, widthKm,
    south: centreLat - dLat, north: centreLat + dLat,
    west: centreLon - dLon, east: centreLon + dLon,
    halfM: half,
  };
}

/** Everything inside the box, with each site's range and bearing from centre. */
export function sitesInBox(box, farms, radars, { radarReachKm = 80 } = {}) {
  const inBox = (lat, lon) => lat >= box.south && lat <= box.north
    && lon >= box.west && lon <= box.east;
  const withGeom = (s) => ({
    ...s,
    rangeM: greatCircleM(box.centreLat, box.centreLon, s.lat, s.lon),
  });
  const inFarms = farms.filter((f) => inBox(f.lat, f.lon)).map(withGeom);
  // A radar OUTSIDE the box can still see into it, and leaving those out would
  // be the most misleading thing this could do. The reach is a screening
  // figure, not a detection range.
  const reachM = radarReachKm * 1000;
  const near = radars.filter((r) => {
    if (inBox(r.lat, r.lon)) return true;
    return greatCircleM(box.centreLat, box.centreLon, r.lat, r.lon) <= box.halfM * 1.5 + reachM;
  }).map((r) => ({ ...withGeom(r), inside: inBox(r.lat, r.lon) }));
  return { farms: inFarms, radars: near };
}

/** Pixel projection for a box on a canvas of this size. */
export function boxProjection(box, width, height, pad = 30) {
  const kx = Math.cos((box.centreLat * Math.PI) / 180);
  const spanX = (box.east - box.west) * kx;
  const spanY = box.north - box.south;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const cx = width / 2;
  const cy = height / 2;
  return {
    scale,
    project(lat, lon) {
      return [
        cx + (lon - box.centreLon) * kx * scale,
        cy - (lat - box.centreLat) * scale,
      ];
    },
    // Metres per pixel, for the scale bar, taken at the centre latitude.
    metresPerPx: M_PER_DEG_LAT / scale,
  };
}

/**
 * Draw the area map.
 *
 * `heat` is optional and is how many radars can see each farm, the same
 * quantity the national map shades. It is NOT a probability of anything, and
 * the legend says so.
 */
export function drawAreaMap(ctx, box, data, {
  width, height, title = '', heatByFarm = null, showRadarLinks = false, dark = true,
} = {}) {
  // MAP_COLORS is tuned for the dark national map. On a white page its farm
  // markers are near-invisible, which is how the first render of this came
  // out: 239 farms drawn and none of them readable. Light mode gets its own
  // ink, carrying the same meaning.
  const C = dark ? MAP_COLORS : {
    farmSeen: '#1d6fa5', farmUnseen: '#9aa7b2',
    radarBusy: '#b3402f', radarIdle: '#7a8894',
  };
  const proj = boxProjection(box, width, height);
  const bg = dark ? '#0b1116' : '#ffffff';
  const ink = dark ? '#cdd8e1' : '#1a1a1a';
  const faint = dark ? '#243039' : '#d8dee4';

  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Coastline, clipped to the box by the projection running off canvas.
  ctx.strokeStyle = dark ? '#2b4a5a' : '#9fb6c4';
  ctx.lineWidth = 1;
  for (const ring of COASTLINE) {
    ctx.beginPath();
    let started = false;
    for (const p of ring) {
      const [x, y] = proj.project(p[1], p[0]);
      if (x < -width || x > width * 2 || y < -height || y > height * 2) { started = false; continue; }
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // A graticule at a round spacing, so distance is readable off the picture.
  const stepKm = box.widthKm > 200 ? 50 : box.widthKm > 80 ? 20 : 10;
  ctx.strokeStyle = faint;
  ctx.setLineDash([2, 4]);
  ctx.lineWidth = 1;
  const stepDegLat = (stepKm * 1000) / M_PER_DEG_LAT;
  const stepDegLon = (stepKm * 1000) / mPerDegLon(box.centreLat);
  for (let k = -10; k <= 10; k += 1) {
    const lat = box.centreLat + k * stepDegLat;
    const lon = box.centreLon + k * stepDegLon;
    if (lat > box.south && lat < box.north) {
      const [, y] = proj.project(lat, box.centreLon);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    if (lon > box.west && lon < box.east) {
      const [x] = proj.project(box.centreLat, lon);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // The box edge itself, so it is obvious what was searched.
  const [bx0, by0] = proj.project(box.north, box.west);
  const [bx1, by1] = proj.project(box.south, box.east);
  ctx.strokeStyle = dark ? '#4a6a7a' : '#7a8a94';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);

  // Sight lines are OFF by default. In a 100 mile box over central Scotland
  // there are 239 farms and 11 radars, and drawing every pairing puts about
  // two thousand lines over the map: the farms disappear under them and the
  // picture stops carrying information. Where they are wanted they are drawn
  // faintly, and only the nearest few per radar.
  if (showRadarLinks) {
    ctx.strokeStyle = dark ? 'rgba(69,184,216,0.16)' : 'rgba(30,110,150,0.14)';
    ctx.lineWidth = 1;
    for (const r of data.radars) {
      const [rx, ry] = proj.project(r.lat, r.lon);
      const near = data.farms
        .map((f) => ({ f, d: greatCircleM(r.lat, r.lon, f.lat, f.lon) }))
        .filter((x) => x.d <= 80000)
        .sort((a, b) => a.d - b.d)
        .slice(0, 25);
      for (const { f } of near) {
        const [fx, fy] = proj.project(f.lat, f.lon);
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(fx, fy); ctx.stroke();
      }
    }
  }

  // Farms. Size carries turbine count where it is known, so a 100 machine
  // array does not draw the same as a single turbine.
  for (const f of data.farms) {
    const [x, y] = proj.project(f.lat, f.lon);
    const n = f.turbines || 0;
    const r = n ? Math.max(3, Math.min(11, 2.4 * Math.sqrt(n))) : 3;
    const seen = heatByFarm ? (heatByFarm.get(f.index) || 0) : null;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = seen === null ? C.farmSeen
      : seen === 0 ? C.farmUnseen
        : seen >= 3 ? C.radarBusy : C.farmSeen;
    ctx.globalAlpha = dark ? 0.85 : 0.72;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    // An outline in the OPPOSITE ink to the fill, so a marker reads against
    // both the sea and the land it may be sitting on.
    ctx.strokeStyle = dark ? 'rgba(0,0,0,0.65)' : 'rgba(20,40,60,0.55)';
    ctx.stroke();
  }

  // Radars, drawn as triangles so they never read as farms.
  for (const r of data.radars) {
    const [x, y] = proj.project(r.lat, r.lon);
    ctx.beginPath();
    ctx.moveTo(x, y - 7); ctx.lineTo(x + 6.5, y + 5); ctx.lineTo(x - 6.5, y + 5);
    ctx.closePath();
    ctx.fillStyle = r.inside ? C.radarBusy : C.radarIdle;
    ctx.fill();
    ctx.strokeStyle = dark ? '#0b1116' : '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = '600 11px system-ui, sans-serif';
    // Halo first, so a name over a coastline is still readable.
    ctx.lineWidth = 3;
    ctx.strokeStyle = bg;
    ctx.strokeText(r.name || '', x + 9, y + 4);
    ctx.fillStyle = ink;
    ctx.fillText(r.name || '', x + 9, y + 4);
  }

  // Scale bar, sized to a round number of kilometres.
  const barKm = stepKm;
  const barPx = (barKm * 1000) / proj.metresPerPx;
  const sx = 18;
  const sy = height - 22;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy); ctx.lineTo(sx + barPx, sy);
  ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4);
  ctx.moveTo(sx + barPx, sy - 4); ctx.lineTo(sx + barPx, sy + 4);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(`${barKm} km / ${(barKm / KM_PER_MILE).toFixed(0)} miles`, sx + barPx + 8, sy + 4);

  if (title) {
    ctx.fillStyle = ink;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(title, 18, 26);
  }
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = dark ? '#8595a3' : '#5a6a74';
  ctx.fillText(`${data.farms.length} wind farm records, ${data.radars.length} radars in reach`
    + ' · farm marker area follows turbine count where recorded', 18, 44);
  ctx.restore();
  return proj;
}
