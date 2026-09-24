// Site data that outlives a page: the lists you imported, and which built-in
// radars are out of service.
//
// WHY THIS IS NOT PART OF THE SCENARIO.
//
// The scenario is written to storage at the end of every assessment, which in
// practice means on every frame of a slider drag. Site lists do not change
// then, and re-serialising a few hundred imported rows on each frame is waste.
// The two also have different lifetimes: a scenario is one question you are
// asking, a site list is the data you ask it against. You change the first
// constantly and the second rarely.
//
// They are BOTH in a backup, because a backup that loses the data somebody
// spent an afternoon importing is not a backup. What a backup cannot hold is
// imported elevation: a raster runs to megabytes and would exceed the storage
// quota on its own. That exclusion is deliberate, and `makeBackup` names it in
// the file rather than leaving it to be discovered.

export const SITES_KEY = 'windfarm-radar-sites-v1';
export const BACKUP_FORMAT = 'windfarm-radar-backup';
export const BACKUP_VERSION = 1;

/** Nothing imported, nothing switched off. */
export function emptySites() {
  return { radars: [], farms: [], decommissioned: [], source: {} };
}

/**
 * Force a loaded object into the shape the rest of the code expects.
 *
 * Anything read back from storage or from a file somebody edited by hand has
 * to be treated as untrusted: a missing array here becomes a crash on the
 * first `.map` somewhere far away, and the stack trace points at the wrong
 * file entirely.
 */
export function normaliseSites(raw) {
  const s = emptySites();
  if (!raw || typeof raw !== 'object') return s;
  if (Array.isArray(raw.radars)) s.radars = raw.radars.filter((r) => r && typeof r === 'object');
  if (Array.isArray(raw.farms)) s.farms = raw.farms.filter((r) => r && typeof r === 'object');
  if (Array.isArray(raw.decommissioned)) {
    // Names only, de-duplicated. Built-in radar names are unique, checked by
    // the systems check, so a name is a stable key across data updates in a
    // way that an array index is not.
    s.decommissioned = [...new Set(raw.decommissioned.filter((n) => typeof n === 'string' && n))];
  }
  if (raw.source && typeof raw.source === 'object') s.source = { ...raw.source };
  return s;
}

export function saveSites(sites) {
  try {
    localStorage.setItem(SITES_KEY, JSON.stringify(normaliseSites(sites)));
    return true;
  } catch (err) {
    // A full or disabled store must not take the application down with it.
    return false;
  }
}

export function loadSites() {
  try {
    const raw = localStorage.getItem(SITES_KEY);
    if (!raw) return emptySites();
    return normaliseSites(JSON.parse(raw));
  } catch (err) {
    return emptySites();
  }
}

export function isDecommissioned(sites, name) {
  return Boolean(sites?.decommissioned?.includes(name));
}

/** Returns a NEW decommissioned list, so callers cannot mutate by accident. */
export function withDecommissioned(sites, name, off) {
  const current = sites?.decommissioned ?? [];
  if (off) return current.includes(name) ? [...current] : [...current, name];
  return current.filter((n) => n !== name);
}

/**
 * Drop the radars that are out of service.
 *
 * Imported radars are never filtered: you put them there yourself, and
 * removing one is what the Clear control is for.
 */
export function liveRadars(rows, sites) {
  if (!sites?.decommissioned?.length) return rows;
  return rows.filter((r) => r.imported || !sites.decommissioned.includes(r.name));
}

export function makeBackup(scenario, sites) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    savedAt: new Date().toISOString(),
    // Said in the file, not just in the documentation, because whoever opens
    // this in two years will have the file and not the documentation.
    notIncluded: 'Imported elevation data is not in this file. A raster runs to '
      + 'megabytes; re-import the .asc or .csv alongside this backup.',
    scenario,
    sites: normaliseSites(sites),
  };
}

/**
 * Read a backup, accepting the bare-scenario files written before this format
 * existed. Those stay loadable: a tool that cannot open its own older files
 * teaches people not to trust its exports.
 */
export function readBackup(text) {
  const parsed = JSON.parse(text);
  if (parsed && parsed.format === BACKUP_FORMAT) {
    return { scenario: parsed.scenario ?? {}, sites: normaliseSites(parsed.sites), legacy: false };
  }
  return { scenario: parsed ?? {}, sites: emptySites(), legacy: true };
}
