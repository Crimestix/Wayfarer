// Baut Backups im Format der alten Wayfarer-Version (v157) mit deren eigenen Modulen und
// prüft sie mit validateCampaign. Alle Inhalte sind erfunden.
// Aufruf: node make-fixtures.mjs <pfad-zu-Wayfarer-v157/public> <ausgabeordner>
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [oldPublic, outDir] = process.argv.slice(2);
const load = (name) => import(pathToFileURL(join(oldPublic, name)).href);

const { campaignDefaults, validateCampaign } = await load('campaign-model.js');
const { stamp, parts, initial, label, clock } = await load('calendar.js');
const { moons } = await load('sky.js');
const { saveDatabaseEntry } = await load('database-model.js');
const { recordDossierOpinion, undoDossierOpinion, addDossierEntry, updateDossierEntry } = await load('dossier-model.js');
const { newExploration } = await load('exploration-model.js');
const { mapIdentity } = await load('routes-model.js');
const { PARTY } = await load('party-model.js');

const DAY = 1440;
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function full() {
  const s = campaignDefaults();
  const t0 = s.now; // 17. Tauwind 701 AD, 16:00
  s.now = t0 + 2 * DAY + 5 * 60; // 19. Tauwind, 21:00
  s.previous = s.now - 60;
  s.lk = 'https://www.legendkeeper.com/app/beispielprojekt/startseite/';
  s.sky = { caldus: stamp(701, 0, 3, 4, 30) };
  s.travelScales = { 'karte-aschenmark': 2.5 };

  // ── Notizen ──────────────────────────────────────────────────────────────
  s.notes[0].body = 'Ankunft in Hohenfurt. Die Wache am Tor war nervös.\n\nIlse Kornblum bot ein Zimmer an.';
  s.notes.push(
    { id: 'session13', title: 'Session 13 – Der Turm im Nebel', body: 'Aufbruch zur Salzstraße.', at: t0 + DAY + 8 * 60 },
    { id: 'c7a1e0a4-3f6e-4d2b-9a55-0b1f0e6d2a11', title: 'Gerüchte in Hohenfurt', body: 'Im Lahmen Eber heißt es, der Turm sei seit dem Winter unbesetzt.', at: t0 + 30 },
    { id: 'exploration-log', title: 'Abenteuerverlauf · Exploration', body: '18. Tauwind 701 AD · 09:00 · Gruppe\nAufbruch: Hohenfurt → Graufels', at: t0 + DAY + 9 * 60 },
  );
  s.active = 'session13';

  // ── Termine ──────────────────────────────────────────────────────────────
  s.events.push(
    {
      id: 'markt', category: 'local', title: 'Salzmarkt in Hohenfurt', at: stamp(701, 0, 22), timed: false, kind: 'world',
      details: 'Drei Tage Markt auf dem Furtplatz.', done: false, locationId: 'p-hohenfurt', durationDays: 3,
      repeat: { unit: 'month', interval: 1 }, important: true,
    },
    {
      id: 'e5b1c7d2-88aa-4c0e-b6f1-2f0a9d3e4c55', title: 'Treffen mit Ardo Venn am Turm', at: stamp(701, 0, 20, 18, 30), timed: true, kind: 'plan',
      details: 'Er will die Karte sehen.', done: false, locationId: 'p-turm',
    },
    { id: 'wachwechsel', title: 'Wachwechsel am Tor', at: stamp(701, 0, 10, 6, 0), timed: true, kind: 'world', details: '', done: false, repeat: { unit: 'week', interval: 2 } },
    { id: 'erledigt', title: 'Zoll bezahlen', at: stamp(701, 0, 16, 12, 0), timed: true, kind: 'plan', details: '', done: true },
  );

  // ── Orte und Weltdatenbank ───────────────────────────────────────────────
  let world = {
    places: [
      { id: 'p-mark', name: 'Aschenmark', kind: 'region', parentId: null },
      { id: 'p-hohenfurt', name: 'Hohenfurt', kind: 'city', parentId: 'p-mark', wikiId: 'lkres-hohenfurt', wikiProjectId: 'proj1' },
      { id: 'p-eber', name: 'Zum Lahmen Eber', kind: 'site', parentId: 'p-hohenfurt' },
      { id: 'p-strasse', name: 'Alte Salzstraße', kind: 'route', parentId: null, anchorId: 'anker-strasse' },
      { id: 'p-turm', name: 'Wachturm Graufels', kind: 'site', parentId: null },
      { id: 'Ort #7 (Mühle/alt)', name: 'Verlassene Mühle', kind: 'site', parentId: 'p-mark' },
    ],
    visits: [],
  };
  world = saveDatabaseEntry(world, 'place', {
    id: 'p-mark', name: 'Aschenmark', placeClass: 'Territorium', type: 'Grafschaft',
    description: 'Karges Hügelland zwischen Fluss und Salzsümpfen.', aliases: ['Die Mark'], tags: ['Grenzland'],
  });
  world = saveDatabaseEntry(world, 'place', {
    id: 'p-hohenfurt', name: 'Hohenfurt', placeClass: 'Siedlung', type: 'Stadt',
    wikiUrl: 'https://www.legendkeeper.com/app/beispielprojekt/hohenfurt/',
  });
  const db = (category, entry) => (world = saveDatabaseEntry(world, category, entry));
  db('species', { id: 's-mensch', name: 'Mensch', lifespan: 80 });
  db('species', { id: 's-halbelf', name: 'Halbelf', parentSpeciesId: 's-mensch', lifespan: 180, description: 'Selten in der Mark.' });
  db('abilities', { id: 'a-dunkelsicht', name: 'Dunkelsicht' });
  db('languages', { id: 'l-gemein', name: 'Gemeinsprache' });
  db('languages', { id: 'l-zwergisch', name: 'Zwergisch' });
  db('scripts', { id: 'sc-runen', name: 'Markrunen' });
  db('organizations', { id: 'o-wacht', name: 'Graufelser Wacht', type: 'Stadtwache', description: 'Hält Turm und Furt.', roles: ['Hauptmann', 'Späher'] });
  db('organizations', { id: 'o-gilde', name: 'Salzgilde', type: 'Gilde' });
  db('organizations', { id: 'o-zoll', name: 'Zollstube', type: 'Amt' });
  db('families', { id: 'f-venn', name: 'Familie Venn' });
  db('characters', {
    id: 'c-ardo', name: 'Ardo Venn', title: 'Hauptmann', firstName: 'Ardo', lastName: 'Venn', alias: 'Der Graue',
    gender: 'Männlich', profession: 'Hauptmann der Wacht', speciesId: 's-mensch', birthPlaceId: 'p-hohenfurt', homeId: 'p-hohenfurt',
    workPlaceId: 'p-turm', abilityIds: ['a-dunkelsicht'], languageIds: ['l-gemein', 'l-zwergisch'], scriptIds: ['sc-runen'],
    birth: { year: 660, month: 3, day: 12 }, description: 'Müder Veteran, der den Turm nicht aufgeben will.', portrait: PIXEL,
    aliases: ['Venn'], tags: ['Wacht'],
    dynamic: { locationId: 'p-turm', health: 'Alte Beinwunde.', goals: 'Den Turm halten, bis Ablösung kommt.', opinions: { group: 5, tomlin: 2 } },
  });
  db('characters', {
    id: 'c-ilse', name: 'Ilse Kornblum', profession: 'Wirtin', npcRef: { projectId: 'proj1', resourceId: 'lkres-ilse' },
    homeId: 'p-eber', dynamic: { locationId: 'p-eber', opinions: { group: 4 } },
  });
  db('characters', { id: 'c-edda', name: 'Edda Venn', gender: 'Weiblich', biologicalAge: 71, ageEstimate: { age: 70, asOf: { year: 700, month: 5, day: 1 } } });
  db('characters', { id: 'c-veres-db', name: 'Veres', partyId: 'veres', speciesId: 's-halbelf', homeId: 'p-hohenfurt', description: 'Aufgewachsen an der Furt.' });
  db('characters', { id: 'c-faehrmann', name: 'Der Fährmann', noted: true });
  world.database.relations = [
    { id: 'r1', type: 'contains', from: 'p-mark', to: 'p-turm' },
    { id: 'r2', type: 'political', from: 'p-hohenfurt', to: 'p-mark' },
    { id: 'r3', type: 'connects', from: 'p-strasse', to: 'p-hohenfurt' },
    { id: 'r4', type: 'seat', from: 'o-wacht', to: 'p-turm' },
    { id: 'r5', type: 'operates', from: 'o-wacht', to: 'p-mark' },
    { id: 'r6', type: 'connection', from: 'o-wacht', to: 'o-gilde' },
    { id: 'r7', type: 'orgPart', from: 'o-zoll', to: 'o-gilde' },
    { id: 'r8', type: 'membership', from: 'c-ardo', to: 'o-wacht', role: 'Hauptmann' },
    { id: 'r9', type: 'familyMember', from: 'c-ardo', to: 'f-venn' },
    { id: 'r10', type: 'mother', from: 'c-edda', to: 'c-ardo' },
    { id: 'r11', type: 'guardian', from: 'c-ilse', to: 'c-faehrmann' },
    { id: 'r12', type: 'seat', from: 'o-gilde', to: 'p-hohenfurt' },
  ];
  world.maps = [{ id: 'karte-aschenmark', placeId: 'p-mark', kind: 'region', environment: 'surface', frame: [4000, 3000] }];
  world.mapPreferences = [{ id: 'karte-aschenmark', favorite: true, lastOpenedAt: 1760000000000 }];
  world.wikiAssignments = [{ id: 'proj1:lkres-hohenfurt', projectId: 'proj1', resourceId: 'lkres-hohenfurt', signature: '', at: '2026-10-20T18:00:00.000Z' }];
  world.visits = [
    { id: 'v1', at: t0 - 3 * DAY, placeId: 'p-hohenfurt' },
    { id: 'v2', at: t0 - 60, placeId: 'p-eber' },
    { id: 'v3', at: t0 + DAY + 9 * 60, placeId: 'p-strasse', travelId: 't-reise', arrivalId: 'p-turm', originId: 'p-eber' },
    { id: 'v4', at: t0 + 2 * DAY, placeId: null },
    { id: 'v5', at: t0 + 2 * DAY + 60, placeId: 'p-turm' },
  ];
  s.world = world;

  // ── Timer ────────────────────────────────────────────────────────────────
  s.timers = [
    { id: 't-reise', name: 'Reise nach Graufels', kind: 'activity', activityType: 'travel', who: '', target: 'Wachturm Graufels', concentration: false, start: t0 + DAY + 9 * 60, end: t0 + DAY + 15 * 60, stoppedAt: null, participants: PARTY.map((p) => p.id) },
    { id: 't-unsichtbar', name: 'Unsichtbarkeit', kind: 'effect', who: 'Tomlin', target: 'Naelmira', concentration: true, start: s.now - 20, end: s.now + 40, stoppedAt: null, participants: ['naelmira'] },
    { id: 't-ritual', name: 'Ritual: Magie entdecken', kind: 'activity', activityType: 'task', who: 'Nex', target: '', concentration: false, start: t0 + 10, end: t0 + 20, stoppedAt: t0 + 15, participants: ['nex'] },
    { id: 't-fackel', name: 'Fackel', kind: 'effect', who: '', target: '', concentration: false, start: s.now - 30, end: s.now + 30 },
  ];
  s.removedTimers = ['t-geloescht'];

  // ── Gefährten ────────────────────────────────────────────────────────────
  s.characters = {
    tomlin: {
      className: 'Magier · Illusion', level: 7, ac: 13, spellDC: 16, perception: 12, investigation: 18, insight: 12,
      portrait: PIXEL, notes: 'Trägt das Buch der Schleier bei sich.', languages: ['Gemeinsprache', 'Elfisch'],
      proficiencies: [
        { kind: 'skill', name: 'Arkane Kunde', rank: 'expertise', bonus: 10 },
        { kind: 'save', name: 'Intelligenz', rank: 'trained', bonus: 7 },
        { kind: 'tool', name: 'Kalligrafenwerkzeug', rank: 'trained', bonus: null },
      ],
      locationHistory: [
        { id: 'lh1', name: 'Hohenfurt', at: t0 - 3 * DAY },
        { id: 'lh2', name: 'Bibliothek der Furt', at: t0 + 120 },
      ],
      condition: { exhaustion: 2, travelMinutes: 600, checks: [{ id: 'reise-tomlin-9', at: t0 + DAY + 14 * 60, hour: 9, status: 'failure' }] },
      ddbImport: 'ddb-2026-10-18',
    },
    neil: { level: 6, portrait: 'https://beispiel.invalid/neil.webp' },
    veres: { ac: 19, notes: 'Schwur am Furtstein.' },
  };

  // ── NPC-Meinungen, Bekanntheit, Dossier ──────────────────────────────────
  let state = { npcOpinions: { proj1: { 'lkres-ilse': { neil: 3 } } }, dossierJournal: undefined };
  const apply = (patch) => (state = { ...state, ...patch });
  apply(recordDossierOpinion(state, { id: 'j-ilse-1', projectId: 'proj1', resourceId: 'lkres-ilse', people: ['tomlin'], value: 4, text: 'Tomlin hat die Zeche bezahlt.', at: t0 + 60, createdAt: 1760000100000 }));
  apply(recordDossierOpinion(state, { id: 'j-ilse-2', projectId: 'proj1', resourceId: 'lkres-ilse', people: ['tomlin'], value: 5, text: 'Er hat ihren Sohn geheilt.', at: t0 + DAY, createdAt: 1760000200000 }));
  const everyone = PARTY.map((p) => p.id);
  apply(recordDossierOpinion(state, { id: 'j-fremd-1', projectId: 'proj1', resourceId: 'lkres-fremder', people: everyone, value: 3, text: '', at: t0 + 90, createdAt: 1760000300000 }));
  apply(recordDossierOpinion(state, { id: 'j-fremd-2', projectId: 'proj1', resourceId: 'lkres-fremder', people: everyone, value: 2, text: 'Die Gruppe hat ihn beim Würfeln bloßgestellt.', at: t0 + DAY + 30, createdAt: 1760000400000 }));
  apply(recordDossierOpinion(state, { id: 'j-zoellner-1', projectId: 'proj1', resourceId: 'lkres-zoellner', people: ['corrin'], value: 6, text: 'Corrin hat für ihn getanzt.', at: t0 + 100, createdAt: 1760000500000 }));
  apply(undoDossierOpinion(state, state.dossierJournal['j-zoellner-1'], { id: 'j-zoellner-2', at: t0 + 110, createdAt: 1760000600000 }));
  let journal = state.dossierJournal;
  journal = addDossierEntry(journal, { id: 'j-note', projectId: 'proj1', resourceId: 'lkres-ilse', kind: 'note', text: 'Ilse kennt den alten Schmugglerpfad.', participants: [], at: t0 + 70, createdAt: 1760000700000 });
  journal = addDossierEntry(journal, { id: 'j-promise', projectId: 'proj1', resourceId: 'lkres-ilse', kind: 'promise', text: 'Nachricht von ihrem Bruder aus Graufels mitbringen.', participants: ['tomlin', 'veres'], at: t0 + 80, dueAt: s.now + 5 * DAY, createdAt: 1760000800000 });
  journal = addDossierEntry(journal, { id: 'j-debt', projectId: 'proj1', resourceId: 'lkres-fremder', kind: 'debt', text: '12 Goldstücke Spielschuld.', participants: ['neil'], at: t0 + 95, dueAt: s.now - DAY, createdAt: 1760000900000 });
  journal = addDossierEntry(journal, { id: 'j-favor', projectId: 'proj1', resourceId: 'lkres-ilse', kind: 'favor', text: 'Ein freies Zimmer, wann immer sie zurückkehren.', participants: everyone, at: t0 + DAY + 10, createdAt: 1760001000000 });
  journal = addDossierEntry(journal, { id: 'j-agreement', projectId: 'proj1', resourceId: 'lkres-fremder', kind: 'agreement', text: 'Schweigen über den Vorfall am Würfeltisch.', participants: [], at: t0 + DAY + 40, createdAt: 1760001100000 });
  journal = updateDossierEntry(journal, 'j-agreement', { doneAt: t0 + 2 * DAY });
  s.npcOpinions = state.npcOpinions;
  s.dossierJournal = journal;
  s.npcKnowledge = { proj1: { 'lkres-ilse': true, 'lkres-fremder': true, 'lkres-geruecht': false, 'lkres-bote': true } };

  // ── Bereiche ohne Platz im neuen Modell ──────────────────────────────────
  const mapKey = mapIdentity({ resourceId: 'karte', documentId: 'aschenmark' });
  const anchor = (id, name, point) => ({ id, mapKey, name, point, frame: [4000, 3000], favorite: false, revision: 1, sourceId: null, deleted: false });
  s.travelLibrary = {
    anchors: [anchor('anker-furt', 'Hohenfurt', [1200, 900]), anchor('anker-turm', 'Graufels', [2600, 700]), anchor('anker-strasse', 'Salzstraße', [1900, 800])],
    routes: [{ id: 'route-1', mapKey, name: 'Über die Salzstraße', startId: 'anker-furt', endId: 'anker-turm', points: [[1200, 900], [1900, 800], [2600, 700]], frame: [4000, 3000], anchorRevisions: [1, 1], favorite: true, lastUsedAt: 1760000000000 }],
  };
  s.explorations = { 'exp-1': newExploration({ id: 'exp-1', name: 'Durch die Salzsümpfe', origin: 'Hohenfurt', destination: 'Graufels', participants: everyone, at: t0 + DAY + 9 * 60 }) };
  s.rests = {
    'rast-1': {
      id: 'rast-1', place: 'Zum Lahmen Eber', kind: 'sleep', participants: ['tomlin', 'neil'], noteId: null,
      steps: [{ at: t0 + 6 * 60, safe: true, fire: true, paused: false, modes: { tomlin: 'sleep', neil: 'watch' }, results: {} }],
    },
  };
  s.dungeons = { duskryn: { rooms: { b1: { status: 'explored', notes: 'Eingangshalle, Falle entschärft.' }, b2: { status: 'open' } } } };

  return validateCampaign(s);
}

function minimal() {
  // So sieht ein Spielstand aus, an dem außer der Uhr nichts verändert wurde.
  const s = campaignDefaults();
  s.now += 90;
  s.previous = s.now - 90;
  return validateCampaign(s);
}

mkdirSync(outDir, { recursive: true });
for (const [name, build] of [['v157-voll.json', full], ['v157-minimal.json', minimal]]) {
  const state = build();
  // Die alte Version schreibt Backups genau so: JSON.stringify(state, null, 2).
  writeFileSync(join(outDir, name), JSON.stringify(state, null, 2) + '\n');
  console.log(name, 'ok');
}

// Stichproben der alten Zeitrechnung: belegen, dass alte und neue Weltzeit dieselbe Zahl sind.
const samples = [];
let seed = 157;
const random = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
const dates = [
  // Schaltjahre richten sich nach dem kosmischen Jahr (AD + 27387): 1, 613 und 701 AD sind welche, 13 und 413 AD nicht.
  [0, 0, 1, 0, 0], [0, 1, 28, 12, 0], [1, 1, 29, 23, 59], [1, 2, 1, 0, 0], [13, 1, 28, 0, 0], [13, 2, 1, 0, 0], [413, 1, 28, 6, 30],
  [613, 1, 29, 6, 30], [700, 11, 31, 23, 59], [701, 0, 1, 0, 0], [701, 0, 17, 16, 0], [701, 0, 19, 0, 0], [701, 1, 29, 12, 0],
  [701, 2, 1, 0, 0], [701, 11, 31, 23, 59], [702, 0, 1, 0, 0], [702, 1, 28, 23, 59], [0, 2, 14, 0, 0], [100000, 11, 31, 23, 59],
];
for (let i = 0; i < 250; i++) {
  const year = random(2000), month = random(12);
  dates.push([year, month, 1 + random(28), random(24), random(60)]);
}
for (const [year, month, day, hour, minute] of dates) {
  const at = stamp(year, month, day, hour, minute), p = parts(at);
  samples.push({ year, month, day, hour, minute, stamp: at, cosmic: p.cosmic, weekday: p.weekday, label: label(at), clock: clock(at) });
}
writeFileSync(join(outDir, 'v157-zeit.json'), JSON.stringify({ initial, moons: moons.map(({ id, period, shift }) => ({ id, period, shift })), samples }) + '\n');
console.log('v157-zeit.json ok', samples.length);
