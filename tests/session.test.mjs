import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Phone, MINUTE, HOUR, wait } from './phone.mjs';

let phone;
afterEach(() => phone.kill());

// A chest workout with 平板卧推 set 1 at 60 lbs, never ended.
async function chestWorkoutNotEnded() {
  phone = new Phone();
  const app = await phone.launch();
  await app.openRoutine('胸');
  app.addExercise('平板卧推', 3);
  app.editCell(0, 0, 'weight', 60);
  return app;
}

test('switching to another routine and confirming keeps the unfinished workout for next time', async () => {
  const app = await chestWorkoutNotEnded();
  await app.goHome();
  phone.advance(30 * MINUTE);

  await app.openRoutine('背');
  await app.endWorkout();
  await app.openRoutine('胸');

  assert.deepEqual(app.weights(0), [60, 0, 0]);
});

test('tapping another routine by mistake and cancelling stays home and the workout keeps running', async () => {
  const app = await chestWorkoutNotEnded();
  await app.goHome();
  phone.advance(10 * MINUTE);
  phone.confirmAnswer = false;

  await app.openRoutine('背');
  const pageAfterCancel = app.page;
  await app.openRoutine('胸');

  assert.deepEqual({ pageAfterCancel, timer: app.timer }, { pageAfterCancel: 'home', timer: '00:10:00' });
});

test('a workout started over 4 hours ago is saved and ended, so reopening starts fresh with its data', async () => {
  await chestWorkoutNotEnded();
  phone.advance(5 * HOUR);

  const app = await phone.launch();
  await app.openRoutine('胸');

  assert.deepEqual({ timer: app.timer, weights: app.weights(0) }, { timer: '00:00:00', weights: [60, 0, 0] });
});

test('a workout left running for days is saved silently when the next routine starts', async () => {
  await chestWorkoutNotEnded();
  phone.advance(3 * 24 * HOUR);

  const app = await phone.launch();
  await app.openRoutine('背');
  await app.endWorkout();
  await app.openRoutine('胸');

  assert.deepEqual({ dialogs: phone.dialogs, weights: app.weights(0) }, { dialogs: [], weights: [60, 0, 0] });
});

test('an app left open on the workout page starts fresh once the workout passes 4 hours', async () => {
  const app = await chestWorkoutNotEnded();
  phone.advance(5 * HOUR);

  await wait(1100); // one tick of the on-screen timer

  assert.deepEqual({ timer: app.timer, weights: app.weights(0) }, { timer: '00:00:00', weights: [60, 0, 0] });
});

test('a number still being typed when the workout is ended is saved for next time', async () => {
  phone = new Phone();
  const app = await phone.launch();
  await app.openRoutine('胸');
  app.addExercise('平板卧推', 3);

  app.tapCell(0, 0, 'weight');
  app.type('70');
  await app.endWorkout();
  await app.openRoutine('胸');

  assert.deepEqual(app.weights(0), [70, 0, 0]);
});

test('a note written on an exercise is there the next time that routine is trained', async () => {
  phone = new Phone();
  const app = await phone.launch();
  await app.openRoutine('胸');
  app.addExercise('平板卧推', 3);

  app.writeNote(0, '左肩有点紧\n下次先热身');
  await app.endWorkout();
  await app.openRoutine('胸');

  assert.equal(app.note(0), '左肩有点紧\n下次先热身');
});

test('workouts saved before notes existed still open, with an empty note', async () => {
  phone = new Phone();
  phone.disk['showup:state'] = JSON.stringify({
    routines: {
      chest: { displayName: '胸', lastTrainedAt: phone.now - HOUR, exercises: [
        { name: '平板卧推', sets: [{ weight: 60, reps: 8, restSeconds: 90 }, { weight: 60, reps: 8, restSeconds: null }] }
      ] },
      shoulders: { displayName: '肩', lastTrainedAt: null, exercises: [] },
      back: { displayName: '背', lastTrainedAt: null, exercises: [] }
    },
    activeSession: null
  });
  const app = await phone.launch();

  await app.openRoutine('胸');

  assert.deepEqual({ weights: app.weights(0), note: app.note(0) }, { weights: [60, 60], note: '' });
});

test('a number still being typed when the next button is tapped is kept', async () => {
  phone = new Phone();
  const app = await phone.launch();
  await app.openRoutine('胸');
  app.addExercise('平板卧推', 3);

  app.tapCell(0, 0, 'weight');
  app.type('70');
  app.tapAction(0, 0); // 开始休息, keyboard still up

  assert.deepEqual(app.weights(0), [70, 0, 0]);
});

// 平板卧推 4 sets of 60 lbs × 12, as saved on the phone's disk.
function benchPressOnDisk(activeSession = null) {
  const set = { weight: 60, reps: 12, restSeconds: 90 };
  const exercises = [{ name: '平板卧推', note: '', sets: [set, set, set, { ...set, restSeconds: null }] }];
  phone.disk['showup:state'] = JSON.stringify({
    routines: {
      chest: { displayName: '胸', lastTrainedAt: phone.now - 3 * 24 * HOUR, exercises },
      shoulders: { displayName: '肩', lastTrainedAt: null, exercises: [] },
      back: { displayName: '背', lastTrainedAt: null, exercises: [] }
    },
    activeSession: activeSession && { ...activeSession, exercises }
  });
}

// Last chest workout was 平板卧推 4 sets of 60 lbs × 12; chest is opened again for a new workout.
async function benchPressAgain() {
  phone = new Phone();
  benchPressOnDisk();
  const app = await phone.launch();
  await app.openRoutine('胸');
  return app;
}

test('reps from last time are hidden behind glass when an exercise is trained again', async () => {
  const app = await benchPressAgain();

  const repsText = [0, 1, 2, 3].map(i => app.row(0, i).children[2].textContent).join(' ');

  assert.deepEqual({ reps: app.reps(0), shows12: repsText.includes('12') }, { reps: [null, null, null, null], shows12: false });
});

test('tapping the reps of a finished set opens the glass with last time\'s number ready to edit', async () => {
  const app = await benchPressAgain();
  app.tapAction(0, 0); // 开始休息: set 1 done

  const inp = app.tapCell(0, 0, 'reps');

  assert.equal(inp.value, '12');
});

test('one set with more reps than last time opens the glass on the rest of that exercise', async () => {
  const app = await benchPressAgain();
  app.tapAction(0, 0);

  app.editCell(0, 0, 'reps', 13);

  assert.deepEqual(app.reps(0), [13, 12, 12, 12]);
});

test('a set with fewer reps than last time leaves the rest of the exercise behind glass', async () => {
  const app = await benchPressAgain();
  app.tapAction(0, 0);

  app.editCell(0, 0, 'reps', 11);

  assert.deepEqual(app.reps(0), [11, null, null, null]);
});

test('the glass on a set not reached yet does not open when tapped', async () => {
  const app = await benchPressAgain();

  const focused = app.tapCell(0, 2, 'reps');

  assert.deepEqual({ reps: app.reps(0)[2], keyboard: focused.tagName }, { reps: null, keyboard: 'BODY' });
});

test('more weight with the same reps as last time counts as progress, even without retyping the reps', async () => {
  const app = await benchPressAgain();
  app.editCell(0, 0, 'weight', 65);
  app.tapAction(0, 0);

  app.tapCell(0, 0, 'reps'); // 12 is already right, nothing to type

  assert.deepEqual(app.reps(0), [12, 12, 12, 12]);
});

test('less weight never counts as progress, however many reps', async () => {
  const app = await benchPressAgain();
  app.editCell(0, 0, 'weight', 55);
  app.tapAction(0, 0);

  app.editCell(0, 0, 'reps', 14);

  assert.deepEqual(app.reps(0), [14, null, null, null]);
});

test('glass that opened stays open after the reps are changed back to last time\'s', async () => {
  const app = await benchPressAgain();
  app.tapAction(0, 0);
  app.editCell(0, 0, 'reps', 13);

  app.editCell(0, 0, 'reps', 12);
  app.tapAction(0, 0); // 结束休息 redraws the page

  assert.deepEqual(app.reps(0), [12, 12, 12, 12]);
});

test('the rest of the glass opens while the keyboard is still up, without closing it', async () => {
  const app = await benchPressAgain();
  app.tapAction(0, 0);

  const inp = app.tapCell(0, 0, 'reps');
  app.type('13');

  assert.deepEqual({ reps: app.reps(0), stillTyping: app.doc.activeElement === inp }, { reps: [13, 12, 12, 12], stillTyping: true });
});

test('which glass was opened survives the app being killed mid-workout', async () => {
  let app = await benchPressAgain();
  app.tapAction(0, 0);
  app.editCell(0, 0, 'reps', 11);

  app = await phone.launch();
  await app.openRoutine('胸');

  assert.deepEqual(app.reps(0), [11, null, null, null]);
});

test('the next workout hides everything again, with this time\'s reps behind the glass', async () => {
  const app = await benchPressAgain();
  app.tapAction(0, 0);
  app.editCell(0, 0, 'reps', 13);
  await app.endWorkout();

  await app.openRoutine('胸');
  const hidden = app.reps(0);
  app.tapAction(0, 0);
  const inp = app.tapCell(0, 0, 'reps');

  assert.deepEqual({ hidden, behindGlass: inp.value }, { hidden: [null, null, null, null], behindGlass: '13' });
});

test('sets with nothing from last time show their reps: a new exercise, a set added today, reps left at 0', async () => {
  const app = await benchPressAgain();

  app.addExercise('飞鸟', 3);
  app.addSet(0);
  const today = { newExercise: app.reps(1), addedSet: app.reps(0)[4] };
  await app.endWorkout();
  await app.openRoutine('胸'); // 飞鸟's reps were never filled in

  assert.deepEqual({ ...today, leftAtZero: app.reps(1) }, { newExercise: [0, 0, 0], addedSet: 12, leftAtZero: [0, 0, 0] });
});

test('an exercise deleted and added back by the same name hides last time\'s reps again', async () => {
  const app = await benchPressAgain();
  app.deleteExercise(0);

  app.addExercise('平板卧推', 4);

  assert.deepEqual(app.reps(0), [null, null, null, null]);
});

test('a workout already running when this update arrives shows its reps as before', async () => {
  phone = new Phone();
  benchPressOnDisk({ routineKey: 'chest', startedAt: phone.now - 10 * MINUTE, currentSetCursors: { 0: 0 }, restingState: null });
  const app = await phone.launch();

  await app.openRoutine('胸');

  assert.deepEqual(app.reps(0), [12, 12, 12, 12]);
});
