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
