import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Phone, HOUR } from './phone.mjs';

const EMAIL = 'eric@example.com';
const PASSWORD = 'squat-rack';

let phones = [];
afterEach(() => { phones.forEach(p => p.kill()); phones = []; });

function newPhone(cloud) {
  const phone = new Phone(cloud);
  phones.push(phone);
  return phone;
}

// A finished chest workout: 平板卧推 set 1 at 60 lbs.
async function chestWorkout(app, weight = 60) {
  await app.openRoutine('胸');
  if (!app.weights(0).length) app.addExercise('平板卧推', 3);
  app.editCell(0, 0, 'weight', weight);
  await app.endWorkout();
}

test('after the home screen icon is deleted, signing in again brings the workouts back', async () => {
  const phone = newPhone();
  const app = await phone.launch();
  await app.register(EMAIL, PASSWORD);
  await chestWorkout(app);

  const reAdded = newPhone(phone.cloud); // a new icon starts with empty storage
  const fresh = await reAdded.launch();
  await fresh.signIn(EMAIL, PASSWORD);
  await fresh.openRoutine('胸');

  assert.deepEqual(fresh.weights(0), [60, 0, 0]);
});

test('ending a workout with network says it was saved to the cloud', async () => {
  const app = await newPhone().launch();
  await app.register(EMAIL, PASSWORD);

  await chestWorkout(app);

  assert.equal(app.syncStatus, '✓ 已保存到云端');
});

const OFFLINE_STATUS = '网络不好，还没上传到云端。数据已保存在手机上，下次联网打开会自动上传。';

test('ending a workout offline says it is not uploaded yet, and it uploads once the network is back', async () => {
  const phone = newPhone();
  const app = await phone.launch();
  await app.register(EMAIL, PASSWORD);

  phone.goOffline();
  await chestWorkout(app);
  const whileOffline = app.syncStatus;
  await phone.goOnline();

  assert.deepEqual(
    { whileOffline, afterReconnect: app.syncStatus, inCloudHistory: phone.cloud.workouts(EMAIL).length },
    { whileOffline: OFFLINE_STATUS, afterReconnect: '✓ 已保存到云端', inCloudHistory: 1 });
});

test('a workout ended offline and closed uploads the next time the app opens with network', async () => {
  const phone = newPhone();
  const app = await phone.launch();
  await app.register(EMAIL, PASSWORD);
  phone.goOffline();
  await chestWorkout(app);
  phone.kill();

  phone.advance(24 * 60 * 60 * 1000);
  phone.cloud.online = true; // network is back, but the app isn't running to notice
  const reopened = await phone.launch();
  const other = await newPhone(phone.cloud).launch();
  await other.signIn(EMAIL, PASSWORD);
  await other.openRoutine('胸');

  assert.deepEqual(
    { status: reopened.syncStatus, inCloudHistory: phone.cloud.workouts(EMAIL).length, onAnotherPhone: other.weights(0) },
    { status: '✓ 已同步', inCloudHistory: 1, onAnotherPhone: [60, 0, 0] });
});

test('every ended workout adds to the cloud history and earlier ones stay', async () => {
  const phone = newPhone();
  const app = await phone.launch();
  await app.register(EMAIL, PASSWORD);

  await chestWorkout(app, 60);
  phone.advance(2 * 24 * 60 * 60 * 1000);
  await chestWorkout(app, 65);

  const history = phone.cloud.workouts(EMAIL).map(w => [w.routineKey, w.exercises[0].sets[0].weight]);
  assert.deepEqual(history, [['chest', 60], ['chest', 65]]);
});

test('when two phones both changed, the newer data wins and the older copy is kept in the cloud', async () => {
  const phoneA = newPhone();
  const a = await phoneA.launch();
  await a.register(EMAIL, PASSWORD);
  await chestWorkout(a, 60);
  const phoneB = newPhone(phoneA.cloud);
  const b = await phoneB.launch();
  await b.signIn(EMAIL, PASSWORD);

  phoneA.goOffline();                   // A trains without network...
  await chestWorkout(a, 70);
  phoneA.cloud.online = true;
  phoneB.advance(HOUR);                 // ...and later B trains with network
  await chestWorkout(b, 80);
  await phoneA.goOnline();
  await a.openRoutine('胸');

  const backups = phoneA.cloud.backups.map(x => x.state.routines.chest.exercises[0].sets[0].weight);
  assert.deepEqual({ onA: a.weights(0), backups }, { onA: [80, 0, 0], backups: [70] });
});

test('signing up on a phone that already has workouts keeps them and puts them in the cloud', async () => {
  const phone = newPhone();
  const app = await phone.launch();
  await chestWorkout(app); // trained before this version had accounts

  await app.register(EMAIL, PASSWORD);
  await app.openRoutine('胸');
  const onThisPhone = app.weights(0);
  const other = await newPhone(phone.cloud).launch();
  await other.signIn(EMAIL, PASSWORD);
  await other.openRoutine('胸');

  assert.deepEqual({ onThisPhone, onAnotherPhone: other.weights(0) },
                   { onThisPhone: [60, 0, 0], onAnotherPhone: [60, 0, 0] });
});
