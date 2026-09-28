// A prompted route through the tool, from opening it to having an answer.
//
// The application has a national map, seven control tabs, four import paths and
// nine exports. Every one of them is reachable and none of them says which to
// do first. Somebody opening it for the first time can spend a while adjusting
// a synthetic scenario without realising the point is to load a real one.
//
// Each step reports whether it is already done from the application's own
// state rather than from a counter of clicks, so the list is honest when you
// come back to a job half finished. Where a step cannot be detected it says so
// instead of pretending: a tick nobody earned is worse than no tick.

export const STEPS = [
  {
    id: 'map',
    title: 'Open the national map',
    body: 'Every civil radar site and 2,694 planning records, screened for line of '
      + 'sight over real ground. This is where an assessment starts, and it opens '
      + 'on its own unless you turned that off.',
    action: 'Open the map',
    done: (st) => st.mapOpened,
  },
  {
    id: 'pick',
    title: 'Click a radar, then click it again',
    body: 'The first click reports what that radar can see. The second loads it '
      + 'against its nearest operational wind farm and drops you into the full '
      + 'assessment. Two clicks, because loading replaces what you have set up.',
    action: 'Open the map',
    done: (st) => st.pairingLoaded,
  },
  {
    id: 'ground',
    title: 'Check the ground is real',
    body: 'Real elevation loads with the site. Without it every pairing sits at flat '
      + 'sea level, which roughly doubles the number of farms called visible. The '
      + 'Terrain tab says which surface is in use.',
    action: 'Terrain tab',
    tab: 'terrain',
    done: (st) => st.realTerrain,
  },
  {
    id: 'radar',
    title: 'Put in the real radar parameters',
    body: 'The built-in figures are representative, not measured. Six parameters '
      + 'decide the answer, and antenna height decides it hardest: a 10 m error '
      + 'moves the worst margin by 10.6 dB. Import a radar list, or set them on '
      + 'the Radar tab. If a figure is missing the tool tells you what it is worth '
      + 'and drafts the request for it.',
    action: 'Radar tab',
    tab: 'radar',
    done: (st) => st.radarSupplied,
    note: (st) => (st.radarSupplied
      ? `${st.importedRadars} radar site(s) imported.`
      : 'Nothing imported yet, so the radar figures are the representative ones.'),
  },
  {
    id: 'farm',
    title: 'Put in the real turbine layout',
    body: 'A built-in farm is ONE point. Measured against the two sites where real '
      + 'coordinates were obtainable, that point is about 1,100 m from the array, '
      + 'and that error flips the visible-or-hidden verdict on 5.6% of farms. '
      + 'Import a turbine schedule to assess a real one.',
    action: 'Site & data tab',
    tab: 'site',
    done: (st) => st.turbinesImported,
  },
  {
    id: 'read',
    title: 'Read the findings, not just the number',
    body: 'Each finding carries its working and the evidence behind it. A finding '
      + 'marked as resting on a recalled source is telling you something about how '
      + 'far to trust it.',
    action: null,
    done: () => null,   // not detectable, and saying so is better than guessing
    note: () => 'The tool cannot tell whether you read them, so this one never ticks.',
  },
  {
    id: 'mitigate',
    title: 'Try the mitigations',
    body: 'Six of them, each with its own evidence. Mitigation delta in the top bar '
      + 'compares what you have switched on against nothing at all.',
    action: 'Mitigation tab',
    tab: 'mitigation',
    done: (st) => st.anyMitigation,
  },
  {
    id: 'export',
    title: 'Export the report',
    body: 'Word, Excel, PDF and Markdown, with the figures embedded and the evidence '
      + 'register attached. Take a backup too: it carries your imported data as well '
      + 'as the settings.',
    action: 'Open Export',
    done: (st) => st.exported,
  },
];

/** How far through the route the application's own state says you are. */
export function progress(state) {
  const scored = STEPS.filter((s) => s.done(state) !== null);
  const done = scored.filter((s) => s.done(state) === true).length;
  return { done, total: scored.length, steps: STEPS };
}
