// Exports, and the method/limits text that goes with every one of them.
//
// Any number that leaves this tool goes out with its provenance attached. A
// screening result that gets forwarded without its assumptions is worse than
// no result.

import { makeBackup } from './store.js';
import { M_PER_FT } from './geo.js';
import { AUTHOR, authorLine } from './authorship.js';
import { SEVERITY_LABELS } from './findings.js';
import { REFERENCES, STATUS_LABELS, statusCounts } from './references.js';
import { buildXlsx, buildDocx } from './officewriter.js';


export const IMPORT_HTML = "<h3>Getting data in and out</h3>\n<p>Written to be followed, not skimmed. Nothing here needs a login, an internet connection, or any software you do not already have. Every file is read inside the page: <strong>nothing you open is uploaded anywhere.</strong></p>\n<hr />\n<h3>Part 1: Getting data OUT</h3>\n<h4>Step 1. Set the scenario up the way you want it reported</h4>\n<p>Everything exported is a snapshot of what is on screen at that moment. Change a slider after exporting and the export does not change with it.</p>\n<h4>Step 2. Click <strong>Export</strong> in the top bar</h4>\n<p>A panel opens listing everything available.</p>\n<h4>Step 3. Pick what you need</h4>\n<table><thead><tr><th>You want</th><th>Choose</th><th>You get</th><th>Opens in</th></tr></thead><tbody>\n<tr><td>Something to print or email</td><td><strong>Assessment report .pdf</strong></td><td>a print view</td><td>choose \"Save as PDF\" in the print dialog</td></tr>\n<tr><td>Something to edit and send</td><td><strong>Assessment report .docx</strong></td><td><code>.docx</code></td><td>Word, Google Docs, LibreOffice</td></tr>\n<tr><td>Every table in one workbook</td><td><strong>All tables .xlsx</strong></td><td><code>.xlsx</code></td><td>Excel, Google Sheets, LibreOffice</td></tr>\n<tr><td>Something to send someone</td><td><strong>Assessment report</strong></td><td><code>.md</code></td><td>Word, Notepad, any editor, GitHub</td></tr>\n<tr><td>The numbers to work on yourself</td><td><strong>Assessment</strong></td><td><code>.csv</code></td><td>Excel</td></tr>\n<tr><td>The turbine-by-turbine results</td><td><strong>Turbines</strong></td><td><code>.csv</code></td><td>Excel</td></tr>\n<tr><td>The aircraft track</td><td><strong>Flight track</strong></td><td><code>.csv</code></td><td>Excel</td></tr>\n<tr><td>To keep everything, including data you imported</td><td><strong>Backup: settings and imported data</strong></td><td><code>.json</code></td><td>this tool</td></tr>\n<tr><td>A picture of a sweep</td><td>Heat map <strong>PNG</strong> or <strong>SVG</strong></td><td>image</td><td>anything</td></tr>\n</tbody></table>\n<h4>Step 3a. If you chose PDF</h4>\n<p>A new tab opens with the report laid out for print, and the print dialog appears. In the <strong>Destination</strong> or <strong>Printer</strong> list choose <strong>Save as PDF</strong>, then <strong>Save</strong>. The browser writes the PDF, which is why the text stays selectable and the page breaks fall in sensible places.</p>\n<p><strong>If nothing opens</strong>, your browser blocked the pop-up. Allow pop-ups for this page and press PDF again, or download the Word file and print that to PDF.</p>\n<h4>Step 3b. What is in the Excel workbook</h4>\n<p>Four sheets, one per table:</p>\n<table><thead><tr><th>Sheet</th><th>What is on it</th></tr></thead><tbody>\n<tr><td>Summary</td><td>Every number in the assessment, as item and value</td></tr>\n<tr><td>Turbines</td><td>One row per machine, 26 columns, numbers stored as numbers</td></tr>\n<tr><td>Flight track</td><td>One row per second of the aircraft track</td></tr>\n<tr><td>Evidence</td><td>The whole evidence register, with each source's status and caution</td></tr>\n</tbody></table>\n<p>Numbers are written as numbers, not text, so you can total and chart them without converting anything first.</p>\n<h4>Step 4. Click the button. The file saves to your Downloads folder</h4>\n<p><strong>If nothing downloads</strong>, the page is running somewhere that blocks downloads. Use the <strong>View / copy</strong> button beside it instead, then select all the text and copy it into a file yourself. The content is identical.</p>\n<h4>Step 5. Backups</h4>\n<p>Export <strong>Backup: settings and imported data</strong> as <code>.json</code>. It carries the whole scenario, every site list you imported, and any radar you marked out of service. Open it later with <strong>Load a saved backup</strong>.</p>\n<p><strong>What a backup does not carry: imported elevation data.</strong> A raster runs to megabytes and would not fit alongside everything else, so keep the <code>.asc</code> or <code>.csv</code> next to the backup and re-import it. The backup file says so inside itself rather than leaving you to find out.</p>\n<p>Your imported site lists also persist on their own, without a backup: close the tab, come back, and they are still there. The backup is for moving them to another machine, or keeping a copy before you change something.</p>\n<p>A backup file written by an older build held the settings alone. Those still open; the tool says the file carried no site lists rather than silently restoring nothing.</p>\n<p>Older wording, for anyone with a file from before: export <strong>Scenario</strong> as <code>.json</code>, keep the file, and open it with the scenario import. Everything comes back, including imported turbine schedules.</p>\n<hr />\n<h3>Part 2: Getting data IN</h3>\n<p>There are <strong>four</strong> separate things you can import. They are different, and picking the wrong one is the commonest mistake.</p>\n<table><thead><tr><th>What you have</th><th>Use</th><th>One row per</th></tr></thead><tbody>\n<tr><td>A layout: every turbine, with coordinates</td><td><strong>Turbine schedule</strong></td><td>machine</td></tr>\n<tr><td>A list of projects</td><td><strong>Wind farm site list</strong></td><td>project</td></tr>\n<tr><td>A list of radar sites</td><td><strong>Radar site list</strong></td><td>radar</td></tr>\n<tr><td>Ground heights</td><td><strong>Elevation data</strong></td><td>point</td></tr>\n</tbody></table>\n<p>All four live on the <strong>Site &amp; data</strong> tab, under <strong>Import real data</strong>.</p>\n<hr />\n<h4>Before you start: get your coordinates right</h4>\n<p>You can use <strong>either</strong> of these. Not a mixture.</p>\n<p><strong>Option A, latitude and longitude.</strong> Decimal degrees, WGS84. Correct: <code>55.37770</code> and <code>-3.75300</code>. <strong>Wrong:</strong> <code>55\u00b0 22' 39\" N</code>. Convert it first: degrees + minutes/60 + seconds/3600, and put a minus sign in front for west or south.</p>\n<p><strong>Option B, eastings and northings.</strong> Whole metres, in whatever grid your survey used. You must then also set <strong>Radar easting</strong> and <strong>Radar northing</strong> on the Site &amp; data tab to the radar's position in that same grid, because the tool reads your coordinates relative to it. Get that wrong and everything lands in the wrong place.</p>\n<p class=\"hint\">If in doubt use latitude and longitude. It needs no other settings.</p>\n<hr />\n<h4>Import 1: a wind farm site list (one row per project)</h4>\n<h5>Step 1. Open the template</h5>\n<p><code>samples/windfarm-sites-template.csv</code>. Double-click it; it opens in Excel.</p>\n<h5>Step 2. Look at what the columns mean</h5>\n<table><thead><tr><th>Column</th><th>Required?</th><th>What it is</th><th>If you leave it out</th></tr></thead><tbody>\n<tr><td><code>name</code></td><td><strong>Required</strong></td><td>Anything you will recognise</td><td>The row is skipped</td></tr>\n<tr><td><code>latitude</code>, <code>longitude</code></td><td><strong>Required</strong>*</td><td>Decimal degrees</td><td>The row is skipped</td></tr>\n<tr><td><code>easting</code>, <code>northing</code></td><td><strong>Required</strong>*</td><td>Metres in your grid</td><td>The row is skipped</td></tr>\n<tr><td><code>capacity mw</code></td><td>Optional</td><td>Megawatts, a number</td><td>Recorded as 0 MW</td></tr>\n<tr><td><code>status</code></td><td>Optional</td><td>Operational, Under Construction, Awaiting Construction, Application Submitted, Refused, Withdrawn</td><td>Shown as \"Not stated\"</td></tr>\n<tr><td><code>offshore</code></td><td>Optional</td><td><code>yes</code> or <code>no</code></td><td>Sea or land stays as you set it</td></tr>\n<tr><td><code>reference</code></td><td>Optional</td><td>Your planning or job reference</td><td>Nothing</td></tr>\n<tr><td><code>turbines</code></td><td>Optional</td><td>How many machines</td><td>Nothing</td></tr>\n<tr><td><code>tip height</code></td><td>Optional</td><td>Metres to blade tip</td><td>Nothing</td></tr>\n</tbody></table>\n<p>* You need <strong>one</strong> of the two position pairs, not both.</p>\n<h5>Step 3. Delete the example rows and type yours in</h5>\n<p>Keep the header row exactly as it is. You may add columns the tool does not know about; they are ignored rather than causing an error.</p>\n<h5>Step 4. Save as CSV or XLSX</h5>\n<p>Excel: <strong>File \u2192 Save As \u2192</strong> pick <code>CSV UTF-8 (Comma delimited)</code> or <code>Excel Workbook (.xlsx)</code>. Both work. If Excel warns you about losing formatting, that is fine; say yes.</p>\n<h5>Step 5. Import it</h5>\n<p>Site &amp; data tab \u2192 <strong>Wind farm site list</strong> \u2192 <strong>Choose .xlsx or .csv</strong> \u2192 pick your file.</p>\n<h5>Step 6. Read the message underneath</h5>\n<p>It tells you how many rows came in, how many were skipped and why, and <strong>every column you left out</strong>. It does not fill anything in silently.</p>\n<h5>Step 7. Use them</h5>\n<p><strong>Real UK sites</strong> picker \u2192 your file appears as its own group at the top of the list, above the UK planning database. Pick one, pick a radar, press <strong>Place this pairing</strong>.</p>\n<hr />\n<h4>Import 2: a radar site list (one row per radar)</h4>\n<h5>Step 1. Open <code>samples/radar-sites-template.csv</code></h5>\n<h5>Step 2. The columns</h5>\n<table><thead><tr><th>Column</th><th>Required?</th><th>What it is</th><th>If you leave it out</th></tr></thead><tbody>\n<tr><td><code>name</code></td><td><strong>Required</strong></td><td>The site name</td><td>The row is skipped</td></tr>\n<tr><td><code>latitude</code>, <code>longitude</code></td><td><strong>Required</strong>*</td><td>Decimal degrees</td><td>The row is skipped</td></tr>\n<tr><td><code>easting</code>, <code>northing</code></td><td><strong>Required</strong>*</td><td>Metres in your grid</td><td>The row is skipped</td></tr>\n<tr><td><code>role</code></td><td>Optional</td><td><code>en-route</code>, <code>aerodrome</code>, <code>air defence</code>, <code>weather</code>, <code>marine</code></td><td>Listed as unclassified</td></tr>\n<tr><td><code>antenna height</code></td><td><strong>Strongly advised</strong></td><td>Metres above ground to the aerial</td><td>Falls back to the Radar tab value, which is a guess</td></tr>\n<tr><td><code>azimuth beamwidth</code></td><td><strong>Strongly advised</strong></td><td>Degrees, the 3 dB width</td><td>Falls back to the Radar tab</td></tr>\n<tr><td><code>elevation beamwidth</code></td><td><strong>Strongly advised</strong></td><td>Degrees, the 3 dB width</td><td>Falls back to the Radar tab</td></tr>\n<tr><td><code>beam tilt</code></td><td><strong>Strongly advised</strong></td><td>Degrees, the elevation of peak gain</td><td>Falls back to the Radar tab</td></tr>\n<tr><td><code>frequency</code></td><td><strong>Strongly advised</strong></td><td>GHz, MHz or Hz; the unit is worked out from the magnitude</td><td>Falls back to the Radar tab</td></tr>\n<tr><td><code>gain</code></td><td><strong>Strongly advised</strong></td><td>dBi</td><td>Falls back to the Radar tab</td></tr>\n<tr><td><code>peak power</code></td><td>Useful</td><td>kW or W</td><td>Falls back to the Radar tab</td></tr>\n<tr><td><code>ground level</code></td><td>Optional</td><td>Metres above sea level at the site</td><td>Nothing</td></tr>\n<tr><td><code>band</code></td><td>Optional</td><td>L-band, S-band, C-band, X-band</td><td>Nothing</td></tr>\n<tr><td><code>operator</code></td><td>Optional</td><td>Who runs it</td><td>Nothing</td></tr>\n<tr><td><code>notes</code></td><td>Optional</td><td>Anything, for example how sure you are of the position</td><td>Nothing</td></tr>\n</tbody></table>\n<p>* One of the two pairs.</p>\n<p class=\"hint\"><strong>Antenna height is the one to get right.</strong> It sets the radio horizon directly: the distance a radar can see goes as the square root of its height. A 10 m error moves the horizon by kilometres.</p>\n<h5>What the tool tells you it is missing</h5>\n<p>Those six columns after <code>name</code> and the position are the ones that decide the answer. They are ranked, and the ranking is measured rather than asserted: each figure in <code>docs/RADAR-PARAMETERS-TO-ASK-FOR.md</code> is the effect on the worst detection margin of getting that parameter wrong.</p>\n<table><thead><tr><th>Parameter</th><th>A plausible error</th><th>Moves the worst margin by</th></tr></thead><tbody>\n<tr><td>Antenna height</td><td>out by 10 m</td><td><strong>10.6 dB</strong></td></tr>\n<tr><td>Azimuth beamwidth</td><td>out by 0.4 deg</td><td><strong>8.2 dB</strong></td></tr>\n<tr><td>Elevation beamwidth</td><td>out by 1 deg</td><td><strong>8.0 dB</strong></td></tr>\n<tr><td>Beam tilt</td><td>out by 2 deg</td><td><strong>7.5 dB</strong></td></tr>\n<tr><td>Frequency</td><td>S-band assumed, actually L-band</td><td><strong>6.7 dB</strong></td></tr>\n<tr><td>Antenna gain</td><td>out by 3 dB</td><td><strong>6.0 dB</strong></td></tr>\n</tbody></table>\n<p>If any of them is absent, a panel opens straight after the import saying which ones, for how many of your sites, and what each is worth. It also drafts a request you can copy and send to the radar operator, ordered so the thing worth chasing hardest is at the top. An operator handed an unexplained list of twelve parameters usually sends nothing back; one told why a number matters usually finds it.</p>\n<p>Nothing is filled in silently. Where a figure is missing the tool uses the representative value on the Radar tab and the panel says so, because a default written in at import time is indistinguishable from a measurement afterwards.</p>\n<h4>Step 3 to 7: exactly as above</h4>\n<p>Same save, same import button, same message, same picker. Imported radars appear in the radar dropdown as their own group.</p>\n<hr />\n<h4>Import 3: a turbine schedule (one row per machine)</h4>\n<p>Use this when you have a real layout, not a list of projects.</p>\n<table><thead><tr><th>Column</th><th>Required?</th><th>Notes</th></tr></thead><tbody>\n<tr><td><code>id</code></td><td>Recommended</td><td>Anything: WTG01, T1, a number</td></tr>\n<tr><td>position</td><td><strong>Required</strong></td><td><code>latitude</code>/<code>longitude</code> <strong>or</strong> <code>easting</code>/<code>northing</code></td></tr>\n<tr><td><code>ground level</code></td><td>Recommended</td><td>Metres above sea level at the base. Survey data beats anything the tool models</td></tr>\n<tr><td><code>hub height</code></td><td>Recommended</td><td>Metres</td></tr>\n<tr><td><code>rotor diameter</code></td><td>Recommended</td><td>Metres</td></tr>\n<tr><td><code>tip height</code></td><td>Optional</td><td>Used if hub height is missing</td></tr>\n<tr><td><code>rpm</code></td><td>Optional</td><td>Rotor speed</td></tr>\n<tr><td><code>tower base diameter</code>, <code>tower top diameter</code></td><td>Optional</td><td>Metres</td></tr>\n<tr><td><code>blade chord</code></td><td>Optional</td><td>Metres, the widest part of the blade</td></tr>\n<tr><td><code>blades</code></td><td>Optional</td><td>Usually 3</td></tr>\n</tbody></table>\n<p>Title blocks and blank rows above the table are skipped automatically, so a schedule straight from a consultant usually imports as it stands.</p>\n<p>Sample: <code>samples/turbines-example.xlsx</code> and <code>.csv</code>.</p>\n<hr />\n<h4>Import 4: elevation data</h4>\n<table><thead><tr><th>Format</th><th>Extension</th><th>Where it comes from</th></tr></thead><tbody>\n<tr><td>ESRI ASCII Grid</td><td><code>.asc</code></td><td>What almost every free elevation source exports. <strong>The best option</strong></td></tr>\n<tr><td>Google Earth</td><td><code>.kml</code>, <code>.kmz</code></td><td>Export a path or points</td></tr>\n<tr><td>A spreadsheet</td><td><code>.xlsx</code>, <code>.csv</code></td><td>Columns: position plus <code>elevation</code></td></tr>\n</tbody></table>\n<p>After importing, the tool reports what fraction of the modelled area your file actually covers. If that is low, the edges fall back to the synthetic surface and any masking conclusion near the edges is worthless.</p>\n<hr />\n<h3>Part 3: When it goes wrong</h3>\n<table><thead><tr><th>Message or symptom</th><th>What it means</th><th>Fix</th></tr></thead><tbody>\n<tr><td>\"No header row found\"</td><td>The tool could not find your column names</td><td>Check the header spelling against the tables above. It looks in the first 12 rows</td></tr>\n<tr><td>\"Found a name column but no position\"</td><td>No coordinates</td><td>Add <code>latitude</code> and <code>longitude</code>, or <code>easting</code> and <code>northing</code></td></tr>\n<tr><td>\"row(s) skipped for no name or no position\"</td><td>Exactly that: those rows had neither</td><td>Look for blank names, text in a number column, or degrees-and-minutes instead of decimals</td></tr>\n<tr><td>Everything lands in the sea</td><td>Latitude and longitude swapped</td><td>In the UK, latitude is roughly 50 to 61 and longitude roughly \u22128 to +2</td></tr>\n<tr><td>Sites are in the wrong county</td><td>Eastings and northings, wrong radar grid position</td><td>Set <strong>Radar easting</strong> and <strong>Radar northing</strong> on the Site &amp; data tab</td></tr>\n<tr><td>Nothing downloads</td><td>The page cannot save files where it is running</td><td>Use <strong>View / copy</strong> and paste into a file</td></tr>\n<tr><td>Numbers import as text</td><td>Excel formatted the column as text</td><td>Select the column, <strong>Data \u2192 Text to Columns \u2192 Finish</strong></td></tr>\n</tbody></table>\n<hr />\n<h3>Part 4: A note you should not skip</h3>\n<p>The built-in UK wind farm positions are <strong>planning records, not survey data</strong>. Measured against the two sites where real turbine coordinates were available, they are out by about <strong>1,100 m</strong>. If you import your own surveyed positions, the tool says so and stops applying that figure, because it has no idea how accurate your file is.</p>\n<p>Nothing this tool produces can support a planning submission. It is for finding the obvious problems early.</p>\n<h4>The national map</h4>\n<p>The <strong>UK map</strong> button opens a view of the whole country: every radar in the built-in list, every wind farm in the planning database, and which of them can see which.</p>\n<h5>What the colours mean</h5>\n<p>The heat map shows <strong>how many radars can see the turbines in that area</strong>. It is not a probability of interference, not a measure of severity, and not a forecast of whether anyone will object. A farm that four radars can see glows four times as brightly as one a single radar can see, and that is all it says.</p>\n<p>The screen behind it is <strong>line of sight and range only</strong>. It asks one question, geometrically: standing at the antenna, with the earth curving away at standard refraction, is the top of a turbine above the intervening ground? It does not ask whether the return would cross a detection threshold, survive the clutter filter, or ever reach a controller. Click a radar for that.</p>\n<p>That choice is deliberate. A national map coloured by detection margin would have to invent radar parameters for 55 sites whose real numbers nobody has, and would look far more authoritative than it could be. Geometry needs positions, heights and ground, and all three are real.</p>\n<h5>The assumptions, and which one matters most</h5>\n<table><thead><tr><th>Assumption</th><th>Value</th><th>Why it matters</th></tr></thead><tbody>\n<tr><td>Turbine tip height</td><td>150 m</td><td>The planning database gives no height. <strong>This is the biggest lever on the result.</strong> A 100 m tip sees less; a 200 m tip sees more.</td></tr>\n<tr><td>Antenna height</td><td>20 m above ground</td><td>No mounting is published for most sites. A lattice tower at 30 m reaches noticeably further.</td></tr>\n<tr><td>Refraction</td><td>k = 4/3</td><td>Under a surface duct the radar sees further, so a farm called hidden may not be.</td></tr>\n<tr><td>Terrain</td><td>500 m national grid, 48 samples per profile</td><td>The per-site assessment uses 128 samples and 100 or 200 m ground, so a narrow ridge can be missed here and caught there.</td></tr>\n<tr><td>Farm position</td><td>planning centroid</td><td>Out by about 1,100 m in the median case. At the margin of visibility that error decides the answer.</td></tr>\n</tbody></table>\n<p>Terrain matters more than any of them: with real ground <strong>2,283 pairings are in line of sight; treating the country as flat sea level gives 5,229</strong>. More than half of what a flat earth would show is hidden by hills.</p>\n<h5>Ireland</h5>\n<p>The Irish coastline is drawn and four Irish radar points are shown, but those four are marked *unclassified* and come from a low-confidence source. <strong>No Republic of Ireland wind farm data is loaded at all.</strong> Nothing in the built-in list is south of the border. Use the site list import to add it.</p>\n<h5>Adding your own data</h5>\n<p>Two buttons on the map take a wind farm site list or a radar site list, as <code>.xlsx</code> or <code>.csv</code>, one row per site with a name and a position. Templates are in <code>samples/</code>. Imported sites are drawn alongside the built-in lists, are included in the screen, and are marked as imported in the panel.</p>\n<p>Imported sites carry <strong>no position uncertainty figure</strong>. The 1,100 m the planning database was measured to carry does not apply to them, and this tool does not know how yours were surveyed.</p>\n<h5>Clicking through to an assessment</h5>\n<p>Click a radar once to select it and read its counts. Click the same radar again to load it, against its nearest operational or under-construction farm, into the full 3D assessment. That replaces the current scenario, which is why it takes two clicks rather than one.</p>\n<h5>The coastline</h5>\n<p>Natural Earth 1:10m Admin 0 Countries, public domain, simplified to about 440 m and shipped in the repository because this tool makes no network request. It is <strong>for drawing only</strong>. Do not measure anything off it and do not use it to decide whether a point is on land. Distances in the screen come from the coordinates, not from the outline.</p>";

export const METHOD_HTML = `
<div class="warn-box">
  <strong>This is a first-order screening model, not a technical assessment.</strong>
  It is built to explore how the variables interact and to find the obvious problems
  early. It cannot support a planning submission, a safety case, or an objection.
  A formal assessment needs the radar operator's own validated model, the real
  radar parameters, real terrain data, and measured or modelled turbine radar
  cross-section at the relevant frequency and aspect angles.
</div>

<h3>What is computed from published results</h3>
<ul>
  <li><strong>Earth curvature and line of sight.</strong> Equivalent-earth method.
      Heights are reduced by <code>d²/(2·a<sub>e</sub>)</code> where
      <code>a<sub>e</sub> = k·R<sub>earth</sub></code>, so a straight line in the model
      (and in the 3D view) is a real ray. At the default <code>k = 4/3</code> this
      reproduces the familiar <code>d<sub>km</sub> = 4.12·√h<sub>m</sub></code> horizon
      rule, which the test suite checks.</li>
  <li><strong>Radar range equation.</strong> Monostatic point-target form:
      <span class="formula">Pr = Pt · G² · λ² · σ / ( (4π)³ · R⁴ · L )</span>
      Noise is <code>k·T₀·B·F</code> with <code>T₀ = 290 K</code>.</li>
  <li><strong>Detection threshold.</strong> Albersheim's closed-form approximation for
      the single-pulse SNR needed to reach a given P<sub>d</sub> at a given
      P<sub>fa</sub> after non-coherent integration, for a non-fluctuating target.
      Quoted validity is 0.1 ≤ P<sub>d</sub> ≤ 0.9 and 1e-7 ≤ P<sub>fa</sub> ≤ 1e-3;
      the tool warns when you leave that range. Target fluctuation is handled as a
      margin you set, not as a second model.</li>
  <li><strong>Diffraction.</strong> Single knife-edge, ITU-R P.526 form:
      <span class="formula">v = h · √( (2/λ) · (1/d₁ + 1/d₂) )
J(v) = 6.9 + 20·log₁₀( √((v−0.1)² + 1) + v − 0.1 )   dB,  v > −0.78</span>
      Two internal checks hold this honest: J(0) must be 6.02 dB (the textbook
      grazing value) and J(−0.78) must be exactly 0 dB. Both are in the test suite.</li>
  <li><strong>Doppler.</strong> <code>f_d = 2·v_r·f/c</code>. For a rotor the blade
      velocity is tangential, so the largest radial component over a revolution is
      <code>v_tip · sin θ</code>, where θ is the angle between the line of sight and
      the rotor axis. This is why wind direction changes the answer: a turbine facing
      the radar shows almost no blade Doppler, one presenting its rotor edge-on shows
      the full tip speed.</li>
  <li><strong>Blind speeds.</strong> <code>v_b = n·PRF·λ/2</code>, with reported
      velocity folded into the unambiguous interval.</li>
  <li><strong>Antenna pattern.</strong> Gaussian main beam
      (<code>−12·(θ/θ₃dB)²</code>, exactly −3 dB at half the 3 dB beamwidth) with
      cosecant-squared elevation shaping above the beam peak.</li>
</ul>

<h3>Wind, and what it does to the turbine</h3>
<ul>
  <li><strong>Yaw.</strong> Turbines yaw into the wind, so wind direction sets the angle between the
      radar line of sight and the rotor axis. Peak blade radial velocity is
      <code>v_tip &middot; sin &theta;</code> against that angle. This part is exact geometry.</li>
  <li><strong>Rotor speed.</strong> A variable-speed, pitch-regulated machine holds close to a constant
      tip-speed ratio below rated wind speed, then roughly constant rotor speed from rated to cut-out,
      and idles outside that band. Blade Doppler therefore scales with wind speed up to rated and then
      plateaus. The idle fraction outside the operating band is a parameter, not a published figure.</li>
  <li><strong>Wind climate.</strong> Speed within a direction sector is taken as Weibull distributed,
      with scale from the sector mean via <code>U = c &middot; &Gamma;(1 + 1/k)</code>. The roses shipped
      with the tool are ILLUSTRATIVE SHAPES, not site data, and every percentage derived from them
      inherits that.</li>
</ul>

<h3>Sea surface</h3>
<ul>
  <li><strong>Multipath</strong> is the standard two-ray formulation. The direct and surface-reflected
      rays combine as <code>F = |1 + &rho;<sub>s</sub>&Gamma;e<sup>-j&Delta;&phi;</sup>|</code> with a
      two-way effect of F&#8308;, and
      <code>&Delta;&phi; = 4&pi;h<sub>r</sub>h<sub>t</sub>/(&lambda;R)</code>. Surface roughness enters
      through the Ament factor
      <code>&rho;<sub>s</sub> = exp(-2(2&pi;&sigma;<sub>h</sub>sin&psi;/&lambda;)&sup2;)</code>, so wave
      height drives the result directly: a calm sea is a good mirror and puts deep nulls in low-level
      coverage, a rough sea washes the lobing out. Checked against theory: the lobe peak is +12.04 dB.
      The divergence factor is neglected, which makes the modelled lobing a worst case at long range.</li>
  <li><strong>Sea clutter</strong> is distributed, so its RCS is sigma-zero times the illuminated cell
      area <code>R &middot; &theta;<sub>az</sub> &middot; &Delta;R &middot; sec&psi;</code>. Its rejection
      is capped well below the radar's improvement factor against fixed clutter, because the Gaussian
      Doppler spread assumed here has far lighter tails than real spiky sea clutter and would otherwise
      cancel it almost perfectly.</li>
  <li><strong>Sigma-zero itself is PARAMETRIC.</strong> Every constant is an input. A real assessment
      takes it from a validated model (GIT, TSC) or the Nathanson tables at the relevant band,
      polarisation, grazing angle and sea state. None of those was retrievable here, so none is
      reproduced.</li>
  <li><strong>Wave height from wind</strong> uses the fully-developed (Pierson-Moskowitz) form
      <code>H<sub>s</sub> &asymp; 0.0248 U&sup2;</code>. Real sites are fetch and duration limited and a
      swell-dominated sea does not follow it at all.</li>
</ul>

<h3>Atmosphere</h3>
<ul>
  <li><strong>Refraction</strong> is expressed as the effective earth radius factor. The presets span
      sub-refractive through surface ducting so a masking argument can be tested against conditions
      other than the standard atmosphere. Ducting is common over the sea and can defeat terrain
      screening outright.</li>
  <li><strong>Gaseous and rain attenuation</strong> are taken together as a single two-way dB/km figure
      the user supplies. This tool does not assert ITU-R P.676 or P.838 coefficients it has not read.</li>
</ul>

<h3>Imported data</h3>
<ul>
  <li>Turbine schedules and elevation data are parsed in the page. Nothing is uploaded.</li>
  <li>Imported terrain reports the fraction of the modelled area it actually covers. Cells with no data
      within the search radius fall back to the base elevation and are counted as holes, because a
      terrain model with gaps must not be mistaken for a complete one.</li>
  <li>Latitude and longitude are projected equirectangularly about the site origin, which is accurate to
      well under a metre at these distances but is NOT a national grid transformation.</li>
  <li>KML altitudes come from whatever produced them. Google Earth clamps placemarks to the ground by
      default, and its terrain is not survey grade. Use a published DEM for anything load-bearing.</li>
  <li>The optional online elevation lookup is OFF by default and UNVERIFIED: it could not be exercised,
      because the environment this tool was built in has no outbound network access.</li>
</ul>

<h3>Materials, and what actually scatters</h3>
<ul>
  <li>A glass-fibre blade shell is largely <strong>transparent</strong> at microwave frequencies: the
      illumination passes through the dielectric. What returns the signal is the conductive structure
      inside it, principally the <strong>carbon-fibre spar caps</strong> where they are used and the
      <strong>lightning protection system</strong>, which is metallic by definition and runs the length
      of the blade to its receptors.</li>
  <li>Open work reports the <strong>tower as the dominant scatterer at all aspect angles</strong>. That
      is why treating only the blades does not solve the problem, and why the tool reports the split
      between tower and blade return explicitly.</li>
  <li>The split that matters operationally is the one <em>after</em> clutter filtering. The tower is
      stationary and a clutter filter can cancel it; the blades move and it largely cannot. So the
      blades can dominate what survives even where the tower dominates what arrives.</li>
  <li><strong>Absorbent treatment conflicts with lightning protection.</strong> A lightning protection
      system exists to be the most conductive path available; absorbent treatment works by not
      reflecting. Reconciling them is a real engineering problem, and treatment must also survive
      leading-edge erosion at tip speeds near 90 m/s for a 25-year life.</li>
  <li>The material deltas in this tool are <strong>indicative and relative</strong>, applied on top of
      the RCS values you set, visible in the interface and overridable. They are not measurements.</li>
</ul>

<h3>Reference targets</h3>
<p>Radar cross-section is given as a CLASS figure, never a platform figure. It varies by tens of
decibels with aspect, frequency and polarisation, and real values for specific military platforms are
controlled information. The library exists to show how target size interacts with turbine clutter, not
to assert the performance of any aircraft.</p>

<h3>Engineering approximations made for this tool</h3>
<p>These are not published models. They are stated here so they can be argued with.</p>
<ul>
  <li><strong>Turbine as two scatterers.</strong> The tower and nacelle are treated as
      a stationary return that a clutter filter can cancel; the blades are treated as a
      moving return that it largely cannot. Real turbine returns are a time-varying
      signature with blade flash, hub lines and tower-blade interaction that this
      split does not reproduce.</li>
  <li><strong>Blade Doppler spectrum.</strong> Blade return power is taken as uniformly
      distributed in radial velocity between zero and the tip value. The real
      distribution is weighted by the RCS and chord distribution along the span.</li>
  <li><strong>Rotor as a partially filling screen.</strong> The swept disc is mostly
      empty air, so blockage is taken as the rotor solidity rather than treating the
      whole disc as opaque. Loss is <code>−20·log₁₀(1 − fill)</code>.</li>
  <li><strong>Narrow obstacle correction.</strong> The classical knife edge is
      infinitely wide. A turbine tower is not, so its knife-edge loss is scaled by the
      fraction of the first Fresnel zone the tower actually spans. This has the right
      limits at both ends but is not a validated model.</li>
  <li><strong>Range sidelobes.</strong> Contamination of neighbouring range cells uses a
      parametric skirt from a peak sidelobe level you set, not a real compression
      waveform.</li>
  <li><strong>Antenna sidelobes.</strong> Azimuth is a Gaussian main lobe held flat at
      the peak azimuth sidelobe level you set, so the sidelobe region is an envelope
      rather than a lobe structure. Checked against a uniform rectangular aperture, it
      meets the first sidelobe exactly and sits 4.6 to 12.9&nbsp;dB above the next five,
      so it over-states rather than under-states off-boresight clutter. The level itself
      is an assumption unless your operator supplied one: at a farm 2 to 3&nbsp;km out a
      10&nbsp;dB error in it moves the detection margin by 20&nbsp;dB and can change
      whether a track survives.</li>
  <li><strong>Integration and clutter.</strong> Clutter is compared against the
      detection threshold as if it integrated like noise. Real clutter is correlated,
      so this is optimistic where clutter dominates.</li>
  <li><strong>Tracker.</strong> Two plots to initiate, three scans of coast. Real
      trackers are considerably more sophisticated, and a real system's plot extractor
      may reject or merge turbine plots before the tracker ever sees them.</li>
</ul>

<h3>Not modelled at all</h3>
<ul>
  <li>Ground-reflection multipath and lobing, which can move detection performance by
      many dB at low elevation and is a first-order effect for low targets.</li>
  <li>Secondary surveillance radar: reflections, garbling and false replies. This tool
      is primary radar only.</li>
  <li>Real terrain, unless you import it. The default surface is synthetic and controlled by the
      terrain panel; masking conclusions from synthetic terrain mean nothing for a real site.</li>
  <li><strong>Regulatory conformance.</strong> Two documents have now been read and their figures
      recorded with the quotes they came from: CAA CAP 670 (Third Issue, Amendment 1/2019) and the
      EUROCONTROL Standard for Radar Surveillance in En-Route Airspace and Major Terminal Areas
      (SUR.ET1.ST01.1000-STD-01-01, Edition 1.0, March 1997). Exactly one figure this tool uses is
      supported by them: the default probability of detection of 0.9, which both recommend for a
      conventional primary radar. Nothing else here has been checked against any requirement, and no
      ICAO document has been read at all. The tool computes physics. It does not know what any
      authority requires. Do not present any output as showing conformance with anything.</li>
  <li><strong>Where the real UK sites come from.</strong> The site picker places a real wind
      farm against a real civil radar. Farm positions are facility centroids from the UK
      Renewable Energy Planning Database by way of WRI's Global Power Plant Database v1.3.0
      (CC BY 4.0), last released in early 2022, so they are neither current nor per-turbine.
      Radar positions are merged from two community aviation data sets, which disagree with
      each other by a median of 1.4 km and by up to 5.9 km; neither is an official source.
      No military radar is in either set or in the BUILT-IN list, and MOD safeguarding is
      what most often decides a real UK application. You can import military radar positions
      yourself: the site list importer recognises an air defence role and the map draws those
      sites separately, so an imported air defence radar is never counted as a civil PSR. It
      remains your data and your responsibility, this tool asserts nothing about where those
      sites are, and it models an air defence radar with the same primary-radar physics as
      any other, which is a poorer fit the further the real system is from a conventional
      2D surveillance radar. Placing a pairing gives you a realistic geometry to explore. It
      does not give you a site assessment.</li>
  <li>Wind farm effects on communications, navigation aids, or seismic arrays.</li>
  <li>Aerodrome obstacle limitation surfaces and physical safeguarding.</li>
  <li>Weather radar product corruption beyond the generic clutter treatment.</li>
</ul>

<h3>Sources retrieved for this build</h3>
<p>Egress was restricted in the environment where this tool was written, so the
primary standards documents could not be fetched and read directly. The formulas
above are stated in their standard reference form and validated against values
that are independently known (6.02 dB at grazing incidence, 0 dB at the v = −0.78
cut-off, 13.1 dB required SNR for P<sub>d</sub> = 0.9 / P<sub>fa</sub> = 1e-6, the
4.12·√h horizon rule). What follows was confirmed at search-summary level only:</p>
<ul>
  <li>UK CAA <strong>CAP 764</strong>, <em>Policy and Guidelines on Wind Turbines</em>:
      30 km guide distance for assessing radar impact; 10 km for considering effects on
      secondary surveillance radar; and the statement that no 'standard' radar cross
      section can be identified for micro, medium or large turbines given the number of
      factors involved. The default RCS values in this tool are therefore starting
      points, not authority.</li>
  <li>Published measurement and simulation work puts turbine RCS across roughly
      20 to 45 dBsm at microwave frequencies, varying strongly with blade pitch, yaw
      orientation and rotation.</li>
  <li>Reported turbine blade tip speeds of roughly 70 to 105 m/s for machines in
      current service, which is what puts blade Doppler inside a conventional clutter
      filter's pass band.</li>
  <li>Blade and tower construction: that glass-fibre shells are largely radar-transparent, that
      carbon spar caps and lightning protection systems are the conductive structure inside them, and
      that the tower is reported as the dominant scatterer at all aspects. Also the QinetiQ and Vestas
      stealth blade trial (a 44 m prototype blade on a V90 in Norfolk, 2009), reported as achieving
      reductions in line with expectations, and a body of patent work on making absorbent layers
      compatible with lightning protection. Search-summary level only; no figure from any of it is
      used as a constant in this model.</li>
  <li>Mitigation practice described in the literature and by industry: blanking,
      non-automatic initiation zones, in-fill radar, post-detection range/azimuth
      gating, and advanced signal processing. CAA CAP 670 SUR 13, cited by CAP 764 as
      holding the detailed analysis, has been read: it places duties on the service
      provider rather than setting thresholds, so nothing here is gated on it.</li>
</ul>
<p><strong>Verify every one of these against the current edition before citing
them.</strong> Of the documents in this list, only CAP 670 has been read in full.</p>
`;

// ------------------------------------------------------------------ helpers

function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const num = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '');
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

// ------------------------------------------------------------------ exports

export function buildTurbinesCsv(result) {
  const rows = [[
    'id', 'east_m', 'north_m', 'ground_amsl_m', 'hub_height_m', 'rotor_diameter_m', 'rpm',
    'ground_range_m', 'slant_range_m', 'bearing_deg', 'elevation_deg',
    'visibility', 'terrain_loss_two_way_db',
    'rotor_aspect_deg', 'tip_speed_ms', 'max_radial_ms', 'doppler_hz',
    'folded_velocity_ms', 'apparent_speed_kt', 'clutter_pass_fraction',
    'raw_rcs_dbsm', 'effective_rcs_dbsm', 'return_snr_db', 'above_threshold',
    'reaches_display', 'saturating',
  ]];
  for (const t of result.turbineResults) {
    rows.push([
      t.turbine.id, num(t.turbine.east, 0), num(t.turbine.north, 0), num(t.turbine.groundM, 1),
      num(t.turbine.hubHeightM, 1), num(t.turbine.rotorDiameterM, 1), num(t.rpm, 2),
      num(t.hub.ground, 0), num(t.hub.slant, 0), num(t.hub.bearing, 2), num(t.hub.elevationDeg, 3),
      t.visibility, num(t.terrainLossHubDb, 2),
      num(t.aspectDeg, 1), num(t.vTipMs, 1), num(t.vRadMaxMs, 1), num(t.fdMaxHz, 1),
      num(t.foldedMs, 2), num(t.apparentSpeedKt, 1), num(t.passFraction, 4),
      num(t.rawRcsDbsm, 2), num(t.effectiveRcsDbsm, 2), num(t.snrEffDb, 2),
      t.falsePlot ? 'yes' : 'no', t.plotted ? 'yes' : 'no', t.saturating ? 'yes' : 'no',
    ]);
  }
  return csv(rows);
}

export function exportTurbinesCsv(result) {
  download(`turbines-${stamp()}.csv`, buildTurbinesCsv(result), 'text/csv');
}

export function buildTrackCsv(result) {
  const rows = [[
    'time_s', 'along_track_m', 'east_m', 'north_m', 'altitude_ft', 'heading_deg',
    'ground_range_m', 'slant_range_m', 'bearing_deg', 'elevation_deg',
    'terrain_loss_db', 'turbine_shadow_loss_db', 'snr_db', 'sinr_db', 'scr_db',
    'turbine_clutter_cost_db', 'sea_clutter_cost_db', 'multipath_db', 'atmospheric_loss_db',
    'radial_velocity_ms', 'mti_response_db',
    'margin_db', 'status', 'blanked', 'in_naiz', 'plot', 'tracked', 'recovered_by_infill',
  ]];
  for (const p of result.points) {
    rows.push([
      num(p.timeS, 1), num(p.alongM, 0), num(p.east, 0), num(p.north, 0),
      num(p.amsl / M_PER_FT, 0), num(p.headingDeg, 1),
      num(p.geom.ground, 0), num(p.geom.slant, 0), num(p.geom.bearing, 2), num(p.geom.elevationDeg, 3),
      num(p.terrainLossDb, 2), num(p.shadowLossDb, 2), num(p.snrDb, 2), num(p.sinrDb, 2),
      Number.isFinite(p.scrDb) ? num(p.scrDb, 2) : 'inf',
      num(p.turbineClutterCostDb, 2), num(p.seaClutterCostDb, 2),
      num(p.multipathDb, 2), num(p.atmosphericLossDb, 3),
      num(p.radialMs, 1), num(p.targetMtiDb, 2),
      num(p.effectiveMarginDb, 2), p.status,
      p.blanked ? 'yes' : 'no', p.inNaiz ? 'yes' : 'no',
      p.plot ? 'yes' : 'no', p.tracked ? 'yes' : 'no', p.recoveredByInfill ? 'yes' : 'no',
    ]);
  }
  return csv(rows);
}

export function exportTrackCsv(result) {
  download(`flight-track-${stamp()}.csv`, buildTrackCsv(result), 'text/csv');
}

export function exportScenario(scenario) {
  download(`scenario-${stamp()}.json`, JSON.stringify(scenario, null, 2), 'application/json');
}

// Split out from exportJson so the payload can be built and checked without a
// browser. Everything that leaves this tool goes through here or
// buildReportMarkdown, so both are worth testing.
export function buildAssessmentPayload(result) {
  return {
    generated: new Date().toISOString(),
    tool: 'Wind Farm / Radar Interference Assessor',
    disclaimer: 'First-order screening model. Not a technical or safety assessment. '
      + 'See the method and limits section before using any figure.',
    scenario: result.scenario,
    derived: {
      effectiveEarthRadiusM: result.ae,
      lambdaM: result.radar.lambdaM,
      requiredSnrDb: result.radar.requiredSnrDb,
      albersheimWithinValidity: result.radar.albersheimValid,
      pulsesPerScan: result.radar.pulsesPerScan,
      rangeResolutionM: result.radar.rangeResolutionM,
      unambiguousRangeM: result.radar.unambiguousRangeM,
      firstBlindSpeedMs: result.radar.firstBlindSpeedMs,
      surfaceHorizonM: result.radar.horizonM,
      farFieldM: result.radar.farFieldM,
      noisePowerDbw: 10 * Math.log10(result.radar.noiseW),
    },
    summary: {
      ...result.summary,
      worstPoint: undefined, worstClutter: undefined, worstShadow: undefined,
      gapStart: undefined, gapEnd: undefined,
    },
    findings: result.findings.map((f) => ({
      id: f.id, severity: f.severity, basis: f.basis,
      title: f.title, detail: f.detail, metrics: f.metrics, source: f.source,
    })),
    turbines: result.turbineResults.map((t) => ({
      id: t.turbine.id,
      position: { east: t.turbine.east, north: t.turbine.north, groundAmslM: t.turbine.groundM },
      hubHeightM: t.turbine.hubHeightM,
      rotorDiameterM: t.turbine.rotorDiameterM,
      rpm: t.rpm,
      groundRangeM: t.hub.ground, slantRangeM: t.hub.slant,
      bearingDeg: t.hub.bearing, elevationDeg: t.hub.elevationDeg,
      visibility: t.visibility, terrainLossTwoWayDb: t.terrainLossHubDb,
      rotorAspectDeg: t.aspectDeg, tipSpeedMs: t.vTipMs, maxRadialMs: t.vRadMaxMs,
      dopplerHz: t.fdMaxHz, foldedVelocityMs: t.foldedMs, apparentSpeedKt: t.apparentSpeedKt,
      clutterPassFraction: t.passFraction,
      rawRcsDbsm: t.rawRcsDbsm, effectiveRcsDbsm: t.effectiveRcsDbsm,
      returnSnrDb: t.snrEffDb, aboveThreshold: t.falsePlot,
      blankedFromDisplay: !!t.blanked, reachesDisplay: !!t.plotted, saturating: t.saturating,
    })),
    track: result.points.map((p) => ({
      timeS: p.timeS, altitudeFt: p.amsl / M_PER_FT,
      groundRangeM: p.geom.ground, bearingDeg: p.geom.bearing, elevationDeg: p.geom.elevationDeg,
      snrDb: p.snrDb, sinrDb: p.sinrDb, marginDb: p.effectiveMarginDb,
      terrainLossDb: p.terrainLossDb, shadowLossDb: p.shadowLossDb,
      status: p.status, plot: p.plot, tracked: p.tracked,
      blanked: p.blanked, recoveredByInfill: !!p.recoveredByInfill,
    })),
    mitigationZones: { blanking: result.blankZone, nonAutoInitiation: result.naizZone },
  };
}

export function exportJson(result) {
  download(`assessment-${stamp()}.json`,
    JSON.stringify(buildAssessmentPayload(result), null, 2), 'application/json');
}

export function buildReportMarkdown(result, delta) {
  const s = result.scenario;
  const r = result.radar;
  const sum = result.summary;
  const L = [];
  const P = (x) => L.push(x);

  P(`# Wind farm / radar screening assessment`);
  P('');
  P(`**${s.name}**  `);
  P(`${authorLine()}  `);
  P(`Generated ${new Date().toISOString()}`);
  P('');
  P('> **First-order screening model. Not a technical or safety assessment.**  ');
  P('> Figures below come from closed-form approximations and synthetic terrain. They are');
  P('> for exploring the problem, not for submission. See "Method and limits" at the end.');
  P('');

  P('## Headline');
  P('');
  const top = result.findings.filter((f) => f.severity === 'critical' || f.severity === 'major');
  if (top.length) {
    for (const f of top) P(`- **${SEVERITY_LABELS[f.severity]}**: ${f.title}`);
  } else {
    P('- No critical or major issues found in this configuration.');
  }
  P('');

  P('## Configuration');
  P('');
  P('| Item | Value |');
  P('| --- | --- |');
  P(`| Radar | ${r.label || r.preset} |`);
  P(`| Frequency | ${(r.freqHz / 1e9).toFixed(3)} GHz (λ = ${(r.lambdaM * 100).toFixed(1)} cm) |`);
  P(`| Peak power / gain | ${(r.peakPowerW / 1000).toFixed(1)} kW / ${r.gainDbi} dBi |`);
  P(`| Beamwidths (az × el) | ${r.azBeamwidthDeg}° × ${r.elBeamwidthDeg}°, peak at ${r.elPeakDeg}° |`);
  P(`| PRF / scan rate | ${r.prfHz} Hz / ${r.rpm} rpm |`);
  P(`| Antenna height | ${r.heightAgl} m AGL (${r.amslM.toFixed(0)} m AMSL) |`);
  P(`| Detection criterion | Pd ${r.pd}, Pfa ${r.pfa.toExponential(0)}, +${r.fluctuationMarginDb} dB fluctuation margin |`);
  P(`| Required single-pulse SNR | ${r.requiredSnrDb.toFixed(1)} dB (${r.pulsesPerScan.toFixed(0)} pulses per scan) |`);
  P(`| Range resolution | ${r.rangeResolutionM.toFixed(0)} m |`);
  P(`| Unambiguous range | ${(r.unambiguousRangeM / 1000).toFixed(1)} km |`);
  P(`| First blind speed | ${r.firstBlindSpeedMs.toFixed(1)} m/s (${(r.firstBlindSpeedMs / 0.514444).toFixed(0)} kt) |`);
  P(`| Clutter filter | ±${r.mtiNotchMs} m/s notch, ${r.mtiRejectionDb} dB rejection |`);
  P(`| k-factor | ${s.environment.kFactor.toFixed(3)} (surface horizon ${(r.horizonM / 1000).toFixed(1)} km) |`);
  P('');
  if (s.farm.ukPairing) {
    const u = s.farm.ukPairing;
    P(`| Real pairing loaded | ${u.farm} to ${u.radar} (${u.role}) |`);
    P(`| True great-circle range | ${(u.trueRangeM / 1000).toFixed(1)} km`
      + `${u.clamped ? ', CLAMPED to the 60 km limit of this model' : ''} |`);
    P(`| Position provenance | REPD planning record (not turbine positions); community radar site data |`);
    P(`| Position accuracy | \u00b1${u.uncertaintyM} m measured, `
      + `${(100 * u.uncertaintyFraction).toFixed(0)}% of the range `
      + `(coordinates are STATED to \u00b11 m; that is precision, not accuracy) |`);
  }
  P('');
  P(`| Wind farm | Value |`);
  P('| --- | --- |');
  P(`| Turbines | ${sum.turbineCount} (${s.farm.layout} layout) |`);
  P(`| Machine | ${s.farm.preset}: hub ${s.farm.hubHeightM} m, rotor ${s.farm.rotorDiameterM} m, ${s.farm.rpm} rpm |`);
  P(`| Tip height | ${(s.farm.hubHeightM + s.farm.rotorDiameterM / 2).toFixed(0)} m AGL |`);
  P(`| Assumed RCS | tower ${s.farm.towerRcsDbsm} dBsm, blades ${s.farm.bladeRcsDbsm} dBsm (NOT authoritative) |`);
  P(`| Distance from radar | ${(sum.nearestTurbineM / 1000).toFixed(2)} to ${(sum.farthestTurbineM / 1000).toFixed(2)} km |`);
  P(`| Wind direction | from ${s.farm.windFromDeg}° |`);
  P('');
  P(`| Reference target | Value |`);
  P('| --- | --- |');
  P(`| Type | ${s.target.preset} |`);
  P(`| RCS | ${s.target.rcsDbsm} dBsm |`);
  P(`| Profile | ${s.target.profile}, ${s.target.speedKt} kt, ${s.target.altitudeFt} ft |`);
  P('');

  P('## Results');
  P('');
  P('| Metric | Value |');
  P('| --- | --- |');
  P(`| Turbines in line of sight | ${sum.visibleCount} of ${sum.turbineCount} |`);
  P(`| Turbine returns above the detection threshold | ${sum.falsePlotCount} |`);
  P(`| Turbine plots reaching the display | ${sum.displayedPlotCount}`
    + `${sum.suppressedPlotCount ? ` (${sum.suppressedPlotCount} suppressed by blanking)` : ''} |`);
  P(`| Peak blade Doppler | ${sum.maxDopplerHz.toFixed(0)} Hz |`);
  P(`| Worst apparent (folded) speed | ${sum.maxApparentSpeedKt.toFixed(0)} kt |`);
  P(`| Strongest turbine return | ${sum.maxTurbineSnrDb.toFixed(1)} dB SNR |`);
  P(`| Track samples without a track | ${sum.untrackedCount} of ${sum.trackPoints} |`);
  P(`| Longest track gap | ${sum.longestGapSeconds.toFixed(0)} s (${(sum.longestGapMetres / 1000).toFixed(1)} km) |`);
  if (sum.blankedAreaKm2) P(`| Coverage removed by blanking | ${sum.blankedAreaKm2.toFixed(0)} km² |`);
  if (sum.naizAreaKm2) P(`| Non-auto-initiation zone area | ${sum.naizAreaKm2.toFixed(0)} km² |`);
  if (sum.recoveredCount) P(`| Samples recovered by in-fill | ${sum.recoveredCount} |`);
  P('');

  P('## Findings');
  P('');
  for (const f of result.findings) {
    P(`### [${SEVERITY_LABELS[f.severity]}] ${f.title}`);
    P('');
    P(f.detail);
    P('');
    if (f.metrics && Object.keys(f.metrics).length) {
      P('| | |');
      P('| --- | --- |');
      for (const [k, v] of Object.entries(f.metrics)) P(`| ${k} | ${v} |`);
      P('');
    }
    P(`*Basis: ${f.basis}.*`);
    if (f.source) P(`*Source: ${f.source}*`);
    P('');
  }

  if (delta) {
    P('## Effect of the selected mitigation');
    P('');
    P('| Metric | Without mitigation | With mitigation | Change |');
    P('| --- | --- | --- | --- |');
    for (const row of delta) {
      P(`| ${row.label} | ${row.before} | ${row.after} | ${row.change} |`);
    }
    P('');
  }

  P('## Turbine detail');
  P('');
  P('| ID | Range km | Brg | Sight | Aspect | Tip m/s | Doppler Hz | Folded kt | Eff RCS dBsm | Return dB | Plot |');
  P('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const t of result.turbineResults) {
    P(`| ${t.turbine.id} | ${(t.hub.ground / 1000).toFixed(2)} | ${t.hub.bearing.toFixed(0)}° | `
      + `${t.visibility} | ${t.aspectDeg.toFixed(0)}° | ${t.vTipMs.toFixed(0)} | `
      + `${t.fdMaxHz.toFixed(0)} | ${t.apparentSpeedKt.toFixed(0)} | ${t.effectiveRcsDbsm.toFixed(1)} | `
      + `${t.snrEffDb.toFixed(1)} | ${t.falsePlot ? 'YES' : 'no'} |`);
  }
  P('');

  P('## Evidence register');
  P('');
  P('Every model component and screening threshold in this tool traces to something. This is what,');
  P('and how well. **Read the status column.**');
  P('');
  const counts = statusCounts();
  P(`Of ${REFERENCES.length} entries: `
    + Object.entries(counts).map(([k, v]) => `${v} ${STATUS_LABELS[k].toLowerCase()}`).join(', ')
    + `. **${counts.read || 0} ${(counts.read || 0) === 1 ? 'was' : 'were'} read in full.**`);
  P('');
  P('The environment this tool was built in had no general outbound network access. Formulas taken');
  P('from standard references were validated against independently known values instead, which is a');
  P('different kind of confidence and is recorded per entry below.');
  P('');
  for (const r of REFERENCES) {
    const who = [r.authors, r.org].filter(Boolean).join(', ');
    P(`### ${r.title}`);
    P('');
    P(`*${[who, r.venue, r.year, r.type].filter(Boolean).join(' · ')}*`);
    P('');
    P(`**Status: ${STATUS_LABELS[r.status]}**`);
    P('');
    if (r.reports) { P(`What it reports: ${r.reports}`); P(''); }
    if (r.validation) { P(`How this tool checked it: ${r.validation}`); P(''); }
    if (r.caution) { P(`Caution: ${r.caution}`); P(''); }
    if (r.supports && r.supports.length) { P(`Supports: ${r.supports.join('; ')}`); P(''); }
  }

  P('## Method and limits');
  P('');
  P(htmlToMarkdown(METHOD_HTML));
  P('');
  return L.join('\n');
}

function htmlToMarkdown(html) {
  return html
    .replace(/<div class="warn-box">([\s\S]*?)<\/div>/g, (_, i) => `> ${i.trim().replace(/\s+/g, ' ')}\n`)
    .replace(/<h3>(.*?)<\/h3>/g, '\n### $1\n')
    .replace(/<span class="formula">([\s\S]*?)<\/span>/g, (_, i) => `\n\`\`\`\n${i.trim()}\n\`\`\`\n`)
    .replace(/<li>([\s\S]*?)<\/li>/g, (_, i) => `- ${i.trim().replace(/\s+/g, ' ')}`)
    .replace(/<\/?(ul|p)>/g, '\n')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/<sub>(.*?)<\/sub>/g, '_$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function exportReport(result, delta) {
  download(`assessment-report-${stamp()}.md`, buildReportMarkdown(result, delta), 'text/markdown');
}

// One definition of each export, used by both the download and the view path,
// so the two can never drift apart. Downloads are blocked in some embedded
// contexts, and an export you cannot read is not an export.
export const EXPORTS = {
  report: {
    label: 'Assessment report',
    filename: 'assessment-report',
    extension: 'md',
    mime: 'text/markdown',
    build: (result, delta) => buildReportMarkdown(result, delta),
  },
  json: {
    label: 'Full results',
    filename: 'assessment',
    extension: 'json',
    mime: 'application/json',
    build: (result) => JSON.stringify(buildAssessmentPayload(result), null, 2),
  },
  turbines: {
    label: 'Turbine table',
    filename: 'turbines',
    extension: 'csv',
    mime: 'text/csv',
    build: (result) => buildTurbinesCsv(result),
  },
  track: {
    label: 'Flight track results',
    filename: 'flight-track',
    extension: 'csv',
    mime: 'text/csv',
    build: (result) => buildTrackCsv(result),
  },
  scenario: {
    // Named a backup rather than a scenario because that is what it now is.
    // It used to hold the settings alone, which meant somebody who imported a
    // radar list, took a backup and came back the next day had lost the list
    // and had no way of knowing until they looked for it.
    label: 'Backup: settings and imported data',
    filename: 'backup',
    extension: 'json',
    mime: 'application/json',
    build: (result) => JSON.stringify(makeBackup(result.scenario, result.sites), null, 2),
  },
  // Word and Excel are written in the page with no library, the same way the
  // xlsx reader works. They are BINARY, so they carry no text preview.
  word: {
    label: 'Assessment report (Word)',
    filename: 'assessment-report',
    extension: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    binary: true,
    build: async (result, delta, figures) => buildDocx(
      appendFigureBlocks(reportToBlocks(buildReportMarkdown(result, delta)), figures)),
  },
  excel: {
    label: 'All tables (Excel)',
    filename: 'assessment',
    extension: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    binary: true,
    build: async (result, delta, figures) => buildXlsx(
      buildWorkbookSheets(result, figures)),
  },
};


// ===========================================================================
// Word, Excel and PDF
// ===========================================================================

/**
 * Turn the report Markdown into Word blocks. The Markdown is the single source
 * of the report's content, so Word and PDF are renderings of it rather than
 * separate documents that can drift from it.
 */
/**
 * A figure: a canvas the tool has already drawn, carried into the exports.
 *
 *   { name, caption, dataUrl, widthPx, heightPx }
 *
 * The SAME pixels go into the Word file, the spreadsheet and the print view.
 * Re-rendering a chart separately for each format is how a report ends up
 * showing something the screen does not, and this tool's whole argument is
 * that what you see is what it computed.
 */
export function dataUrlToBytes(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return null;
  const b64 = dataUrl.slice(comma + 1);
  const bin = typeof atob === 'function'
    ? atob(b64)
    : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Append the figures to a block list as their own section.
 *
 * They go at the END rather than being threaded through the text. A figure
 * dropped mid-argument has to be referred to by number to be worth anything,
 * and numbering them here would mean numbering them in the Markdown, the Word
 * file and the print view identically or not at all.
 */
export function appendFigureBlocks(blocks, figures) {
  const usable = (figures || []).filter((f) => f && f.dataUrl);
  if (!usable.length) return blocks;
  const out = blocks.slice();
  out.push({ type: 'heading', level: 2, text: 'Figures' });
  out.push({
    type: 'para',
    text: 'Each of these is the picture the tool drew for this scenario, not a '
      + 'redrawing of it. The heat map and the area map carry their own scale and '
      + 'legend, because a map without either is a picture rather than evidence.',
  });
  for (const f of usable) {
    const png = dataUrlToBytes(f.dataUrl);
    out.push({
      type: 'image',
      png,
      widthPx: f.widthPx,
      heightPx: f.heightPx,
      name: f.name,
      caption: f.caption || f.name,
      dataUrl: f.dataUrl,
    });
  }
  return out;
}

export function reportToBlocks(md) {
  const blocks = [];
  const lines = md.split('\n');
  let table = null;
  let para = [];

  const flush = () => {
    if (para.length) { blocks.push({ type: 'para', text: para.join(' ') }); para = []; }
  };
  const flushTable = () => {
    if (table && table.length) blocks.push({ type: 'table', rows: table });
    table = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('|')) {
      flush();
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;   // the separator row
      (table = table || []).push(cells);
      continue;
    }
    flushTable();
    if (line.startsWith('#')) {
      flush();
      const level = line.length - line.replace(/^#+/, '').length;
      blocks.push({ type: 'heading', level, text: line.slice(level).trim() });
    } else if (line.startsWith('> ')) {
      // A block quote runs over several lines in the Markdown and is ONE
      // paragraph, so it accumulates like any other rather than becoming a
      // paragraph per line.
      para.push(line.slice(2).trim());
    } else if (line.startsWith('- ')) {
      flush();
      blocks.push({ type: 'para', text: `\u2022 ${line.slice(2)}` });
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  flushTable();
  return blocks;
}

/** Every table the assessment produces, as sheets for one workbook. */
export function buildWorkbookSheets(result, figures) {
  const toRows = (text) => text.split('\n').filter(Boolean).map((line) => {
    const cells = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i += 1; } else q = false; } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    // Put numbers in as numbers so the spreadsheet can total and chart them.
    return cells.map((c) => {
      const t = c.trim();
      if (t === '') return '';
      const n = Number(t);
      return Number.isFinite(n) && /^[-+]?[0-9.eE+-]+$/.test(t) ? n : c;
    });
  });

  return [
    { name: 'Summary', rows: (() => {
      // Flatten the JSON payload into two columns, which is what a reader of a
      // spreadsheet actually wants from a nested result object.
      const rows = [['Item', 'Value']];
      const walk = (obj, prefix) => {
        for (const [k, v] of Object.entries(obj)) {
          const key = prefix ? `${prefix} / ${k}` : k;
          if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
          else if (Array.isArray(v)) rows.push([key, v.length ? `${v.length} item(s)` : '']);
          else rows.push([key, v === null || v === undefined ? '' : v]);
        }
      };
      walk(buildAssessmentPayload(result), '');
      return rows;
    })() },
    { name: 'Turbines', rows: toRows(buildTurbinesCsv(result)) },
    { name: 'Flight track', rows: toRows(buildTrackCsv(result)) },
    { name: 'Evidence', rows: [
      ['Reference', 'Status', 'What it reports', 'Caution'],
      ...REFERENCES.map((r) => [r.title, STATUS_LABELS[r.status] || r.status,
        r.reports || '', r.caution || '']),
    ] },
    // Figures go on their own sheet rather than being dropped over the data.
    // A picture anchored across the turbine table hides the rows underneath
    // it, and a reader who sorts that table then finds the picture has not
    // moved with it.
    ...figureSheet(figures),
  ];
}

/** The figures as one sheet, each under its caption, or nothing if there are none. */
function figureSheet(figures) {
  const usable = (figures || []).filter((f) => f && f.dataUrl);
  if (!usable.length) return [];
  const rows = [['Figure', 'What it shows']];
  const images = [];
  // Each picture is anchored below its own caption row, with enough rows left
  // between them that a 400 px image does not sit on top of the next caption.
  let row = 2;
  for (const f of usable) {
    rows[row] = [f.name || 'Figure', f.caption || ''];
    const png = dataUrlToBytes(f.dataUrl);
    const h = Math.max(1, f.heightPx || 360);
    const w = Math.max(1, f.widthPx || 640);
    const drawnH = w > 900 ? Math.round((h * 900) / w) : h;
    images.push({
      png, widthPx: w, heightPx: h, anchorRow: row + 1, anchorCol: 0,
      name: f.name, caption: f.caption,
    });
    // 20 px a row is Excel's default height, so this leaves the picture room.
    row += Math.ceil(drawnH / 20) + 3;
  }
  for (let i = 0; i < row; i += 1) if (!rows[i]) rows[i] = [''];
  return [{ name: 'Figures', rows, images }];
}

/**
 * Open the report in a print view and ask the browser to print it. The browser
 * writes the PDF, which means real pagination, real fonts and selectable text
 * rather than a hand-rolled PDF that would do none of those things well.
 */
export function printReport(result, delta, figures) {
  const md = buildReportMarkdown(result, delta);
  const blocks = appendFigureBlocks(reportToBlocks(md), figures);
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bold = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const body = blocks.map((b) => {
    if (b.type === 'heading') return `<h${Math.min(b.level, 4)}>${bold(b.text)}</h${Math.min(b.level, 4)}>`;
    if (b.type === 'table') {
      return '<table>' + b.rows.map((row, i) => '<tr>' + row.map((c) => (i === 0
        ? `<th>${bold(c)}</th>` : `<td>${bold(c)}</td>`)).join('') + '</tr>').join('') + '</table>';
    }
    if (b.type === 'image') {
      // The data URL goes straight in. A print view has no server to fetch
      // from, and the browser's own print-to-PDF then embeds the picture.
      return `<figure><img src="${b.dataUrl}" alt="${esc(b.caption || '')}">`
        + `<figcaption>${esc(b.caption || '')}</figcaption></figure>`;
    }
    return `<p>${bold(b.text)}</p>`;
  }).join('\n');

  const win = window.open('', '_blank');
  if (!win) return false;    // pop-up blocked; the caller says so
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(result.scenario.name || 'Assessment report')}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 10.5pt/1.45 "Segoe UI", Calibri, Arial, sans-serif; color: #15191d; max-width: 180mm; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  h2 { font-size: 13pt; margin: 16pt 0 4pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
  h3 { font-size: 11.5pt; margin: 12pt 0 3pt; }
  h4 { font-size: 10.5pt; margin: 10pt 0 2pt; }
  p { margin: 0 0 6pt; }
  table { border-collapse: collapse; width: 100%; margin: 4pt 0 10pt; font-size: 9.5pt; }
  th, td { border: 1px solid #bbb; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #eef1f4; }
  h2, h3, table { break-after: avoid; page-break-after: avoid; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  figure { margin: 8pt 0 12pt; break-inside: avoid; page-break-inside: avoid; text-align: center; }
  figure img { max-width: 100%; height: auto; border: 1px solid #ccc; }
  figcaption { font-size: 9pt; color: #555; font-style: italic; margin-top: 3pt; }
</style></head><body>${body}</body></html>`);
  win.document.close();
  // Give the new document a moment to lay out before the print dialog opens,
  // or Chrome occasionally prints a blank first page.
  win.setTimeout(() => { win.focus(); win.print(); }, 250);
  return true;
}

export async function downloadExport(kind, result, delta, figures) {
  const e = EXPORTS[kind];
  if (!e) return;
  const data = await e.build(result, delta, figures);
  download(`${e.filename}-${stamp()}.${e.extension}`, data, e.mime);
}

export function buildExport(kind, result, delta) {
  const e = EXPORTS[kind];
  if (!e) return null;
  // A Word or Excel file is a ZIP. There is nothing useful to show as text, so
  // say that rather than printing bytes at the user.
  if (e.binary) {
    return { text: null, binary: true, label: e.label, extension: e.extension };
  }
  return { text: e.build(result, delta), label: e.label, extension: e.extension };
}

// Downloads started by the page are inert inside a sandboxed frame, so the
// tool checks rather than offering a control that silently does nothing.
export function downloadsAvailable() {
  try {
    return window.self === window.top;
  } catch (err) {
    return false;   // cross-origin frame: we are definitely embedded
  }
}

// ------------------------------------------------------- mitigation delta

export function buildDelta(before, after) {
  const fmt = (v, unit = '', d = 0) => `${Number.isFinite(v) ? v.toFixed(d) : 'n/a'}${unit}`;
  const rows = [];
  const push = (label, b, a, unit, d, lowerIsBetter = true) => {
    const change = a - b;
    const dir = Math.abs(change) < (d ? Math.pow(10, -d) / 2 : 0.5) ? 'same'
      : (lowerIsBetter ? (change < 0 ? 'better' : 'worse') : (change > 0 ? 'better' : 'worse'));
    rows.push({
      label,
      before: fmt(b, unit, d), after: fmt(a, unit, d),
      change: `${change > 0 ? '+' : ''}${fmt(change, unit, d)}`,
      dir,
    });
  };

  push('Turbine plots reaching the display', before.summary.displayedPlotCount, after.summary.displayedPlotCount, '', 0);
  push('Turbine returns above threshold', before.summary.falsePlotCount, after.summary.falsePlotCount, '', 0);
  push('Strongest turbine return', before.summary.maxTurbineSnrDb, after.summary.maxTurbineSnrDb, ' dB', 1);
  push('Track samples without a track', before.summary.untrackedCount, after.summary.untrackedCount, '', 0);
  push('Longest track gap', before.summary.longestGapSeconds, after.summary.longestGapSeconds, ' s', 0);
  push('Track samples below threshold', before.summary.lostCount, after.summary.lostCount, '', 0);
  push('Worst clutter cost on track',
    before.summary.worstClutter ? before.summary.worstClutter.clutterCostDb : 0,
    after.summary.worstClutter ? after.summary.worstClutter.clutterCostDb : 0, ' dB', 1);
  push('Coverage removed by mitigation', before.summary.blankedAreaKm2, after.summary.blankedAreaKm2, ' km²', 0);
  push('Non-auto-initiation zone', before.summary.naizAreaKm2, after.summary.naizAreaKm2, ' km²', 0);
  return rows;
}
