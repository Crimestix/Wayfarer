import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { facilityCandidates } from '../../domain/bastion';
import { placeScale } from '../../domain/placeScale';
import {
  allRoomsOf,
  floorCandidates,
  floorsOf,
  guessLevel,
  houseOf,
  isRoom,
  parseRoomPlan,
  roomCandidates,
  roomSources,
} from '../../domain/rooms';
import { createEntity, type Place } from '../../domain/schema';
import { addBastion } from '../bastion/actions';
import { createArticle, createArticleOfKind } from '../wiki/actions';
import { draftOf, entityFromDraft, placeTreeRows } from './model';
import { addRooms, moveFloor, moveRoom, setFloors, takeRoomSources } from './rooms';

async function keepDb() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const data = () => db.getSnapshot();
  const keep = db.put('entities', createEntity({ kind: 'place', name: 'Graufeste' })) as Place;
  const place = (name: string, parentId: string, more: Partial<Place['place']> = {}) => {
    const entity = createEntity({ kind: 'place', name });
    return db.put('entities', {
      ...entity,
      place: { ...entity.place, parentId, ...more },
    }) as Place;
  };
  /** Das Haus als Namen: Etage (oder „–“ ohne Etage) mit ihren Räumen. */
  const shape = (id = keep.id) =>
    houseOf(data(), id).floors.map((entry) => [
      entry.floor?.name ?? '–',
      ...entry.rooms.map((room) => room.name),
    ]);
  return { db, data, keep, place, shape };
}

describe('Etagen und Räume', () => {
  it('liest ein ganzes Haus: Etage mit Doppelpunkt oder mit Eingerücktem', () => {
    expect(
      parseRoomPlan(
        '1 Torhaus – Fallgitter\n\nKeller:\nWeinkeller\nGruft: noch nicht betreten\n\nTurm\n  Wachstube\nBrunnen',
      ),
    ).toEqual({
      floors: [
        {
          name: 'Keller',
          tagline: '',
          rooms: [
            { name: 'Weinkeller', tagline: '' },
            { name: 'Gruft', tagline: 'noch nicht betreten' },
          ],
        },
        { name: 'Turm', tagline: '', rooms: [{ name: 'Wachstube', tagline: '' }] },
      ],
      rooms: [
        { name: '1 Torhaus', tagline: 'Fallgitter' },
        { name: 'Brunnen', tagline: '' },
      ],
    });
  });

  it('legt Etagen von oben nach unten an, mit ihren Räumen darunter', async () => {
    const { db, data, keep, shape } = await keepDb();
    addRooms(db, keep.id, 'Obergeschoss:\nSchlafkammer\n\nErdgeschoss:\n2 Halle\n1 Torhaus\n\nHof');
    expect(shape()).toEqual([
      ['Obergeschoss', 'Schlafkammer'],
      ['Erdgeschoss', '1 Torhaus', '2 Halle'],
      ['–', 'Hof'],
    ]);
    expect(houseOf(data(), keep.id).total).toBe(4);
    expect(allRoomsOf(data(), keep.id)).toHaveLength(4);
    // Eine Etage, die es schon gibt, wird genommen; eine neue steht unter den vorhandenen.
    addRooms(db, keep.id, 'erdgeschoss:\nKüche\n\nKeller:\nGruft');
    expect(shape()).toEqual([
      ['Obergeschoss', 'Schlafkammer'],
      ['Erdgeschoss', '1 Torhaus', '2 Halle', 'Küche'],
      ['Keller', 'Gruft'],
      ['–', 'Hof'],
    ]);
    const [upper, ground] = floorsOf(data(), keep.id);
    // Etage und Raum stehen bei ihrem Ort – und heißen so.
    expect(isRoom(data(), upper)).toBe(true);
    expect(placeScale(data(), upper!)).toBe('floor');
    expect(placeScale(data(), allRoomsOf(data(), keep.id)[0]!)).toBe('room');
    // Ein Haus mit Etagen ist deshalb keine Siedlung.
    expect(placeScale(data(), data().entities[keep.id] as Place)).toBeNull();

    // Im Baum der Orte stehen sie nur auf Wunsch – dann unter ihrem Ort, Etagen von oben nach unten.
    const names = (withRooms: boolean) =>
      placeTreeRows(data(), { [keep.id]: true, [ground!.id]: true }, null, withRooms)
        .filter((row) => row.depth > 0 || row.place.id === keep.id)
        .map((row) => `${'·'.repeat(row.depth)}${row.place.name}`);
    expect(names(false)).toEqual(['Graufeste']);
    expect(names(true)).toEqual([
      'Graufeste',
      '·Obergeschoss',
      '·Erdgeschoss',
      '··1 Torhaus',
      '··2 Halle',
      '··Küche',
      '·Keller',
      '·Hof',
    ]);
  });

  it('ordnet Etagen und hängt Räume um', async () => {
    const { db, data, keep, shape } = await keepDb();
    addRooms(db, keep.id, 'Turm:\nWachstube\n\nKeller:\nGruft\n\nHalle');
    const [tower, cellar] = floorsOf(data(), keep.id);
    moveFloor(db, cellar!.id, -1);
    expect(shape().map((row) => row[0])).toEqual(['Keller', 'Turm', '–']);
    // Ganz oben geht es nicht weiter hinauf.
    moveFloor(db, cellar!.id, -1);
    expect(shape().map((row) => row[0])).toEqual(['Keller', 'Turm', '–']);
    const hall = houseOf(data(), keep.id).floors.at(-1)!.rooms[0]!;
    moveRoom(db, hall.id, tower!.id);
    expect(shape()).toEqual([
      ['Keller', 'Gruft'],
      ['Turm', 'Halle', 'Wachstube'],
    ]);
    moveRoom(db, hall.id, keep.id);
    expect(shape().at(-1)).toEqual(['–', 'Halle']);
  });

  it('schlägt Orte, die Räume enthalten, als Etagen vor – mit der üblichen Lage', async () => {
    const { db, data, keep, place, shape } = await keepDb();
    expect([
      guessLevel('Keller'),
      guessLevel('Erdgeschoss'),
      guessLevel('2. Stock'),
      guessLevel('Nordflügel'),
    ]).toEqual([-1, 0, 2, null]);
    const cellar = place('Keller', keep.id);
    place('Gruft', cellar.id, { room: true });
    const upper = place('1. Stock', keep.id);
    const ground = place('Erdgeschoss', keep.id);
    // Eine Gegend heißt vielleicht „Ebene“ – eine Etage ist sie nicht. Und ein Dorf auch nicht.
    place('Graue Ebene', keep.id, { category: 'Ebene' });
    const village = place('Unterdorf', keep.id, { category: 'Dorf' });
    place('Dorfkeller', village.id, { room: true });
    const store = place('Vorratskammer', keep.id, { category: 'Kammer' });
    expect(floorCandidates(data(), keep.id).map((p) => p.name)).toEqual([
      '1. Stock',
      'Erdgeschoss',
      'Keller',
    ]);
    expect(roomCandidates(data(), keep.id).map((p) => p.id)).toEqual([store.id]);
    const undo = setFloors(db, [cellar.id, upper.id, ground.id]);
    expect(shape()).toEqual([['1. Stock'], ['Erdgeschoss'], ['Keller', 'Gruft']]);
    expect(floorCandidates(data(), keep.id)).toEqual([]);
    undo();
    expect(floorsOf(data(), keep.id)).toEqual([]);
  });

  it('lässt beim Bearbeiten Etage und Raum wählen – und behält es', async () => {
    const { db, data, keep, place } = await keepDb();
    const hall = place('Halle', keep.id);
    const asFloor = entityFromDraft({ ...draftOf(hall, data()), room: true, floor: true }, hall);
    expect((asFloor as Place).place).toMatchObject({ room: true, floor: true });
    db.put('entities', asFloor);
    // Wer nur den Namen ändert, verliert die Etage nicht.
    const renamed = entityFromDraft(
      { ...draftOf(data().entities[hall.id] as Place, data()), name: 'Große Halle' },
      data().entities[hall.id] as Place,
    );
    expect((renamed as Place).place).toMatchObject({ room: true, floor: true });
    // Kein Raum mehr: Dann ist es auch keine Etage.
    const plain = entityFromDraft(
      { ...draftOf(renamed as Place, data()), room: false },
      renamed as Place,
    );
    expect((plain as Place).place).toMatchObject({ room: false, floor: false });
  });
});

describe('Etagen und Räume aus Artikeln', () => {
  async function written() {
    const base = await keepDb();
    const { db } = base;
    const made = createArticleOfKind(db, {
      title: 'Schwarzturm',
      parentId: null,
      kind: 'place',
      scaffold: false,
    })!;
    const tower = made.entity as Place;
    const root = made.article.id;
    const cellar = createArticle(db, { title: 'Keller', parentId: root })!;
    const wine = createArticle(db, { title: 'Weinkeller', parentId: cellar.id })!;
    createArticle(db, { title: 'Gruft', parentId: cellar.id });
    const guard = createArticle(db, { title: 'Wachstube', parentId: root })!;
    // Gehört einem Eintrag anderer Art: kein Raum.
    createArticleOfKind(db, {
      title: 'Turmwächter',
      parentId: root,
      kind: 'person',
      scaffold: false,
    });
    // Ein Ort darin, der schon einen Artikel hat – und ein Dorf, das sicher kein Raum ist.
    const hall = createArticleOfKind(db, {
      title: 'Halle',
      parentId: root,
      kind: 'place',
      scaffold: false,
    })!.entity as Place;
    db.put('entities', { ...hall, place: { ...hall.place, parentId: tower.id } });
    base.place('Turmdorf', tower.id, { category: 'Dorf' });
    return { ...base, tower, cellar, wine, guard, hall };
  }

  it('bietet an, was unter dem Ort geschrieben steht – in seiner Ordnung', async () => {
    const { data, tower } = await written();
    expect(
      roomSources(data(), tower.id).map((s) => [
        `${'·'.repeat(s.depth)}${s.name}`,
        s.guess,
        s.preselect,
        s.note,
      ]),
    ).toEqual([
      ['Halle', 'room', true, 'Ort darin'],
      ['Turmdorf', 'room', false, 'Dorf'],
      ['Keller', 'floor', true, 'Artikel ohne Eintrag'],
      ['·Gruft', 'room', true, 'Artikel ohne Eintrag'],
      ['·Weinkeller', 'room', true, 'Artikel ohne Eintrag'],
      ['Wachstube', 'room', true, 'Artikel ohne Eintrag'],
    ]);
  });

  it('macht daraus Etagen und Räume, deren Seite der geschriebene Artikel ist', async () => {
    const { db, data, tower, cellar, wine, hall, shape } = await written();
    const picks = roomSources(data(), tower.id)
      .filter((source) => source.preselect)
      .map((source) => ({ key: source.key, as: source.guess }));
    const result = takeRoomSources(db, tower.id, picks)!;
    expect([result.floors, result.rooms]).toEqual([1, 4]);
    expect(shape(tower.id)).toEqual([
      ['Keller', 'Gruft', 'Weinkeller'],
      ['–', 'Halle', 'Wachstube'],
    ]);
    const byName = (name: string) =>
      Object.values(data().entities).find((entity) => entity.name === name) as Place;
    // Der Artikel gehört jetzt dem Raum – und der Raum liegt auf der Etage aus dem Artikel darüber.
    expect(byName('Keller')).toMatchObject({
      lk: { resourceId: cellar.id },
      place: { parentId: tower.id, room: true, floor: true, level: -1 },
    });
    expect(byName('Weinkeller')).toMatchObject({
      lk: { resourceId: wine.id },
      place: { parentId: byName('Keller').id, room: true, floor: false },
    });
    expect((data().entities[hall.id] as Place).place.room).toBe(true);
    // Das Dorf blieb, was es war; nichts steht ein zweites Mal zur Wahl.
    expect(roomSources(data(), tower.id).map((s) => s.name)).toEqual(['Turmdorf']);

    result.undo();
    expect(shape(tower.id)).toEqual([['–']]);
    expect(byName('Keller')).toBeUndefined();
    expect(data().articles[cellar.id]).toBeDefined();
    expect((data().entities[hall.id] as Place).place.room).toBe(false);
  });

  it('hängt einen Raum an den Ort, wenn seine Etage nicht mitkommt', async () => {
    const { db, data, tower, shape } = await written();
    const wine = roomSources(data(), tower.id).find((source) => source.name === 'Weinkeller')!;
    takeRoomSources(db, tower.id, [{ key: wine.key, as: 'room' }]);
    expect(shape(tower.id)).toEqual([['–', 'Weinkeller']]);
  });

  it('bietet der Bastion die Räume auf den Etagen an, nicht die Etagen', async () => {
    const { db, data, keep } = await keepDb();
    addRooms(db, keep.id, 'Keller:\nSchmiede\n\nHalle');
    const bastion = addBastion(db, 'Graufeste', keep.id);
    expect(facilityCandidates(data(), data().bastions[bastion.id]!).map((c) => c.name)).toEqual([
      'Halle',
      'Schmiede',
    ]);
  });
});
