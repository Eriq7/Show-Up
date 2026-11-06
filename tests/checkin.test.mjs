import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Phone, HOUR } from './phone.mjs';

const EMAIL = 'eric@example.com';
const PASSWORD = 'squat-rack';
const TODAY = '2026-10-19'; // the Phone's clock starts here (see phone.mjs)

let phones = [];
afterEach(() => { phones.forEach(p => p.kill()); phones = []; });

function newPhone(cloud) {
  const phone = new Phone(cloud);
  phones.push(phone);
  return phone;
}

// ───── automatic check-in ─────

test('finishing every set of an exercise and ending the workout lights that part today', async () => {
  const app = await newPhone().launch();
  await app.openRoutine('胸');
  app.addExercise('卧推', 3);
  app.completeSets(0, 3);
  await app.endWorkout();

  assert.deepEqual(
    { page: app.page, today: app.heat(TODAY), card: app.litToday('胸'), toast: app.toast },
    { page: 'home', today: ['胸'], card: true, toast: '胸已打卡' });
});

test('two of three sets is not enough: nothing lights and the app says so', async () => {
  const app = await newPhone().launch();
  await app.openRoutine('胸');
  app.addExercise('卧推', 3);
  app.completeSets(0, 2);
  await app.endWorkout();

  assert.deepEqual(
    { today: app.heat(TODAY), card: app.litToday('胸'), toast: app.toast },
    { today: [], card: false, toast: '没有做完的动作，今天不打卡' });
});

test('opening a part and leaving without training lights nothing', async () => {
  const app = await newPhone().launch();
  await app.openRoutine('胸');
  await app.endWorkout();

  assert.deepEqual(app.heat(TODAY), []);
});

test('an exercise lights the part it belongs to, even from another part’s card', async () => {
  const app = await newPhone().launch();
  app.addPart('肱肌');
  await app.openRoutine('胸');
  app.addExercise('卧推', 3);
  app.addExercise('锤式弯举', 3, '肱肌');
  app.completeSets(0, 3);
  app.completeSets(1, 3);
  await app.endWorkout();

  assert.deepEqual(
    { today: app.heat(TODAY), toast: app.toast, chest: app.litToday('胸'), brachialis: app.litToday('肱肌') },
    { today: ['胸', '肱肌'], toast: '胸、肱肌已打卡', chest: true, brachialis: true });
});

test('finishing only the other part’s exercise lights only that part', async () => {
  const app = await newPhone().launch();
  app.addPart('肱肌');
  await app.openRoutine('胸');
  app.addExercise('卧推', 3);
  app.addExercise('锤式弯举', 3, '肱肌');
  app.completeSets(0, 2);
  app.completeSets(1, 3);
  await app.endWorkout();

  assert.deepEqual(
    { today: app.heat(TODAY), chest: app.litToday('胸') },
    { today: ['肱肌'], chest: false });
});

test('the exercise keeps its part for next time', async () => {
  const phone = newPhone();
  const app = await phone.launch();
  app.addPart('肱肌');
  await app.openRoutine('胸');
  app.addExercise('锤式弯举', 3, '肱肌');
  await app.endWorkout();

  const again = await phone.launch();
  await again.openRoutine('胸');
  again.completeSets(0, 3);
  await again.endWorkout();

  assert.deepEqual(again.heat(TODAY), ['肱肌']);
});

test('a part the user adds can be trained and lights up', async () => {
  const app = await newPhone().launch();
  app.addPart('腿');
  await app.openRoutine('腿');
  app.addExercise('深蹲', 3);
  app.completeSets(0, 3);
  await app.endWorkout();

  assert.deepEqual({ cards: app.partCards, today: app.heat(TODAY) }, { cards: ['胸', '肩', '背', '腿'], today: ['腿'] });
});

test('a part name that already exists is refused', async () => {
  const app = await newPhone().launch();
  app.addPart('胸');

  assert.deepEqual({ cards: app.partCards, error: app.partError }, { cards: ['胸', '肩', '背'], error: '已经有“胸”了' });
});

test('workouts saved before parts existed still check in', async () => {
  const phone = newPhone();
  const set = { weight: 100, reps: 8, restSeconds: null };
  const routine = (displayName, exercises) => ({ displayName, lastTrainedAt: null, exercises });
  phone.disk['showup:state'] = JSON.stringify({
    routines: {
      chest: routine('胸', [{ name: '卧推', note: '', sets: [set, set, set] }]),
      shoulders: routine('肩', []),
      back: routine('背', []),
    },
    activeSession: null,
  });
  const app = await phone.launch();
  await app.openRoutine('胸');
  app.completeSets(0, 3);
  await app.endWorkout();

  assert.deepEqual({ cards: app.partCards, today: app.heat(TODAY) }, { cards: ['胸', '肩', '背'], today: ['胸'] });
});

test('a part missing from saved data does not come back', async () => {
  const phone = newPhone();
  phone.disk['showup:state'] = JSON.stringify({
    routines: { chest: { displayName: '胸', lastTrainedAt: null, exercises: [] } },
    partOrder: ['chest'],
    activeSession: null,
  });
  const app = await phone.launch();

  assert.deepEqual(app.partCards, ['胸']);
});

test('a workout that sat unended past 4 hours checks in on the day it started', async () => {
  const phone = newPhone();
  const app = await phone.launch();
  await app.openRoutine('胸');
  app.addExercise('卧推', 3);
  app.completeSets(0, 3);
  phone.advance(5 * HOUR); // now 03:00 the next day

  const reopened = await phone.launch();

  assert.deepEqual({ started: reopened.heat('2026-10-19'), next: reopened.heat('2026-10-20') }, { started: ['胸'], next: [] });
});

test('switching to another part saves the unfinished one and it checks in', async () => {
  const app = await newPhone().launch();
  await app.openRoutine('胸');
  app.addExercise('卧推', 3);
  app.completeSets(0, 3);
  await app.goHome();

  await app.openRoutine('背');
  await app.goHome();

  assert.deepEqual(app.heat(TODAY), ['胸']);
});

test('check-ins are still there after the app is closed and reopened', async () => {
  const phone = newPhone();
  const app = await phone.launch();
  await app.openRoutine('胸');
  app.addExercise('卧推', 3);
  app.completeSets(0, 3);
  await app.endWorkout();

  const reopened = await phone.launch();

  assert.deepEqual({ today: reopened.heat(TODAY), card: reopened.litDays('胸') }, { today: ['胸'], card: 1 });
});

test('the End workout button turns ready once an exercise is finished', async () => {
  const app = await newPhone().launch();
  await app.openRoutine('胸');
  app.addExercise('卧推', 2);
  const before = app.endReady;
  app.completeSets(0, 2);

  assert.deepEqual({ before, after: app.endReady }, { before: false, after: true });
});

// ───── by hand ─────

test('tapping a day adds a part to it, tapping again takes it off', async () => {
  const app = await newPhone().launch();

  app.toggleDay('2026-10-10', '背');
  const added = app.heat('2026-10-10');
  app.toggleDay('2026-10-10', '背');

  assert.deepEqual({ added, removed: app.heat('2026-10-10') }, { added: ['背'], removed: [] });
});

// ───── colours ─────

test('each part has its own colour, and parts past the seventh share grey', async () => {
  const app = await newPhone().launch();
  const added = ['腹肌', '腿', '上斜方肌', '肱肌', '小腿'];
  added.forEach(name => app.addPart(name));

  assert.deepEqual(
    ['胸', '肩', '背', ...added].map(name => app.partColor(name)),
    ['#c03809', '#bf8532', '#205bf7', '#00aa95', '#047745', '#8f81e8', '#9f40a8', '#8e8e93']);
});

// ───── old app data ─────

const OLD_APP_EXPORT = JSON.stringify({
  app: 'gym-log', version: 1, exportedAt: '2026-10-18T00:00:00.000Z', startDate: '2026-09-01',
  sections: [
    { id: 'chest', name: '胸', per: 20, mode: 'count' },
    { id: 'back', name: '背', per: 20, mode: 'count' },
    { id: 'shoulder', name: '肩膀', note: '侧平举', per: 3, mode: 'week' },
    { id: 'abs', name: '腹肌', per: 3, mode: 'week' },
  ],
  logs: {
    chest: ['2026-10-01', '2026-10-01', '2026-10-05'],
    back: ['2026-10-03'],
    shoulder: ['2026-10-05'],
    abs: ['2026-10-05', '2026-10-07'],
  },
});

test('old app records land on the heatmap day for day, with chest, back and shoulder matched to the existing parts', async () => {
  const app = await newPhone().launch();
  app.importOldData(OLD_APP_EXPORT);

  const days = ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07'].map(d => app.heat(d));
  assert.deepEqual(
    { cards: app.partCards, days },
    { cards: ['胸', '肩', '背', '腹肌'], days: [['胸'], ['背'], ['胸', '肩', '腹肌'], ['腹肌']] });
});

test('importing the same old app data twice changes nothing', async () => {
  const app = await newPhone().launch();
  app.importOldData(OLD_APP_EXPORT);
  const once = ['2026-10-01', '2026-10-05'].map(d => app.heat(d));
  app.importOldData(OLD_APP_EXPORT);

  assert.deepEqual(
    { cards: app.partCards, days: ['2026-10-01', '2026-10-05'].map(d => app.heat(d)) },
    { cards: ['胸', '肩', '背', '腹肌'], days: once });
});

test('imported records are still there after the app is reopened', async () => {
  const phone = newPhone();
  const app = await phone.launch();
  app.importOldData(OLD_APP_EXPORT);

  const reopened = await phone.launch();

  assert.deepEqual(reopened.heat('2026-10-05'), ['胸', '肩', '腹肌']);
});

test('text that is not the old app’s data is refused and nothing changes', async () => {
  const app = await newPhone().launch();
  const said = app.importOldData('hello');

  assert.deepEqual({ cards: app.partCards, today: app.heat('2026-10-05'), said }, { cards: ['胸', '肩', '背'], today: [], said: '这不是旧 App 复制出来的数据。' });
});

test('a day with only an old record and a day with a new check-in both show', async () => {
  const app = await newPhone().launch();
  app.importOldData(OLD_APP_EXPORT);
  await app.openRoutine('胸');
  app.addExercise('卧推', 3);
  app.completeSets(0, 3);
  await app.endWorkout();

  assert.deepEqual({ old: app.heat('2026-10-05'), today: app.heat(TODAY) }, { old: ['胸', '肩', '腹肌'], today: ['胸'] });
});

// ───── cloud ─────

for (const cloudNewer of [true, false]) {
  test(`check-ins made on two phones at once are both kept (${cloudNewer ? 'the first phone’s' : 'the second phone’s'} data is newer)`, async () => {
    const a = newPhone();
    const appA = await a.launch();
    await appA.register(EMAIL, PASSWORD);
    const b = newPhone(a.cloud);
    const appB = await b.launch();
    await appB.signIn(EMAIL, PASSWORD);

    a.goOffline();
    if (cloudNewer) a.advance(HOUR); else b.advance(HOUR);
    appA.toggleDay('2026-10-10', '胸');
    appB.toggleDay('2026-10-12', '背');
    await a.settle(); // both uploads fail: there's no network
    await b.settle();
    await a.goOnline();
    await b.goOnline();
    const reA = await a.launch();
    const reB = await b.launch();

    const days = app => ['2026-10-10', '2026-10-12'].map(d => app.heat(d));
    assert.deepEqual({ a: days(reA), b: days(reB) }, { a: [['胸'], ['背']], b: [['胸'], ['背']] });
  });
}

test('records imported before signing in are not replaced by what is already in the cloud', async () => {
  const a = newPhone();
  const appA = await a.launch();
  await appA.register(EMAIL, PASSWORD);
  await appA.openRoutine('胸');
  appA.addExercise('卧推', 3);
  await appA.endWorkout();

  const b = newPhone(a.cloud);
  const appB = await b.launch();
  // Only chest, so the import adds days and no part: the days are all there is to keep.
  appB.importOldData(JSON.stringify({ sections: [{ id: 'chest', name: '胸' }], logs: { chest: ['2026-10-05'] } }));
  await appB.signIn(EMAIL, PASSWORD);

  assert.deepEqual(appB.heat('2026-10-05'), ['胸']);
});
