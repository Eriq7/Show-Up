// Test harness: runs the real index.html in jsdom the way it lives on the phone.
// The phone owns the clock and the disk (localStorage), so killing and
// relaunching the app keeps whatever the app managed to save.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { Cloud } from './cloud.mjs';

// Check-ins are dated by the phone's local calendar. Pin the zone so a test's "today" is the same on every machine.
process.env.TZ = 'UTC';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

// jsdom fires hashchange from setImmediate; queueing behind it keeps order deterministic.
const tick = () => new Promise(r => setImmediate(r));
export const wait = ms => new Promise(r => setTimeout(r, ms));

export class Phone {
  now = Date.UTC(2026, 9, 19, 22);
  disk = {};
  app = null;
  dialogs = [];
  confirmAnswer = true;
  language = 'zh-CN'; // the phone's system language

  // Pass the same cloud to a second Phone to model a new phone (or a re-added icon) on the same account.
  constructor(cloud = new Cloud()) { this.cloud = cloud; }

  advance(ms) { this.now += ms; }

  goOffline() { this.cloud.online = false; }

  // The browser fires `online` when the connection comes back.
  async goOnline() {
    this.cloud.online = true;
    this.app?.window.dispatchEvent(new this.app.window.Event('online'));
    await this.settle();
  }

  // Waits until the app has stopped talking to the cloud.
  async settle() {
    for (let quiet = 0; quiet < 5; ) {
      await tick();
      quiet = this.cloud.inflight ? 0 : quiet + 1;
    }
  }

  // Cold start: kill the running app (if any) and boot from disk.
  async launch() {
    this.kill();
    const phone = this;
    const dom = new JSDOM(HTML, {
      url: 'https://showup.test/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.Date.now = () => phone.now;
        Object.defineProperty(window.navigator, 'language', { get: () => phone.language });
        window.showUpCloud = phone.cloud.connect(window);
        for (const [k, v] of Object.entries(phone.disk)) window.localStorage.setItem(k, v);
        window.confirm = msg => { phone.dialogs.push(msg); return phone.confirmAnswer; };
        window.alert = msg => { phone.dialogs.push(msg); };
        window.HTMLElement.prototype.scrollIntoView = () => {};
        window.scrollTo = () => {};
      },
    });
    await new Promise(r => dom.window.addEventListener('load', r));
    this.app = new App(dom.window, this);
    await this.settle();
    return this.app;
  }

  kill() {
    if (!this.app) return;
    const ls = this.app.window.localStorage;
    this.disk = {};
    for (let i = 0; i < ls.length; i++) this.disk[ls.key(i)] = ls.getItem(ls.key(i));
    this.app.window.close();
    this.app = null;
  }
}

// What the user can see and tap.
class App {
  constructor(window, phone) {
    this.window = window;
    this.doc = window.document;
    this.phone = phone;
  }

  $(sel) { return this.doc.querySelector(sel); }

  get page() {
    return this.$('#page-workout').style.display === 'block' ? 'workout' : 'home';
  }

  get timer() { return this.$('#global-timer').textContent; }

  get syncStatus() { return this.$('#sync-status').textContent; }

  // Fills the login sheet: 'signin' | 'signup' | 'forgot'.
  async #submitAuth(view, fields) {
    if (!this.$('#auth-overlay').classList.contains('open')) this.$('#btn-login').click();
    if (view) this.$(`[data-auth-view="${view}"]`)?.click();
    for (const [id, value] of Object.entries(fields)) this.$(`#auth-${id}`).value = value;
    this.$('#auth-submit').click();
    await this.phone.settle();
  }

  signUp(email, password) { return this.#submitAuth('signup', { email, password }); }
  signIn(email, password) { return this.#submitAuth('signin', { email, password }); }
  enterCode(code) { return this.#submitAuth(null, { code }); }

  // Sign up and type in the code from the email.
  async register(email, password) {
    await this.signUp(email, password);
    await this.enterCode(this.phone.cloud.lastCode(email));
  }

  // A part's name as on its card ('胸', 'Chest', or one the user added) — taps that card on the home page.
  async openRoutine(name) {
    this.$(`button[aria-label="${name}训练"], button[aria-label="${name} workout"]`).click();
    await tick();
  }

  // Names of the part cards on the home page, in order.
  get partCards() {
    return [...this.doc.querySelectorAll('#parts .part')].map(b => b.querySelector('.part-name').textContent);
  }

  get toast() { return this.$('#toast').textContent; }

  // Parts shown on a day of the heatmap ('YYYY-MM-DD'), in card order. [] for an unlit day.
  heat(iso) {
    const cell = this.$(`#heat [data-iso="${iso}"]`);
    return cell.dataset.parts ? cell.dataset.parts.split('|') : [];
  }

  // How many of the last 14 days are lit on a part's card.
  litDays(name) {
    return [...this.doc.querySelectorAll('#parts .part')]
      .find(b => b.querySelector('.part-name').textContent === name)
      .querySelectorAll('.m.on').length;
  }

  // Whether today's little square on a part's card is lit.
  litToday(name) {
    return !!([...this.doc.querySelectorAll('#parts .part')]
      .find(b => b.querySelector('.part-name').textContent === name)
      .querySelector('.m.today.on'));
  }

  addPart(name) {
    this.$('#btn-add-part').click();
    this.$('#part-name').value = name;
    this.$('#part-add-confirm').click();
  }

  // The colour of a part's key square on its card.
  partColor(name) {
    const card = [...this.doc.querySelectorAll('#parts .part')].find(b => b.querySelector('.part-name').textContent === name);
    return card.querySelector('.key').dataset.color;
  }

  get partError() { return this.$('#part-error').textContent; }

  // Taps a day, then a part in the sheet that opens, to add or remove that check-in by hand.
  toggleDay(iso, name) {
    this.$(`#heat [data-iso="${iso}"]`).click();
    [...this.doc.querySelectorAll('#day-chips .chip')].find(c => c.textContent === name).click();
    this.$('#day-done').click();
  }

  // Pastes into the import sheet and confirms. Returns what the sheet said before importing.
  importOldData(text) {
    this.$('#btn-import').click();
    const box = this.$('#import-text');
    box.value = text;
    box.dispatchEvent(new this.window.Event('input', { bubbles: true }));
    const said = this.$('#import-summary').textContent;
    const btn = this.$('#import-confirm');
    if (!btn.disabled) btn.click();
    return said;
  }

  // The 中文 / English button under the dragons.
  switchLanguage() { this.$('#btn-lang').click(); }

  async goHome() {
    this.$('#btn-back').click();
    await tick();
  }

  // `part`: the part the exercise trains, when it isn't the one being trained.
  addExercise(name, sets, part) {
    this.$('.btn-add-exercise').click();
    this.$('#modal-name').value = name;
    this.$('#modal-sets').value = String(sets);
    if (part) [...this.doc.querySelectorAll('#modal-parts .chip')].find(c => c.textContent === part).click();
    this.$('.modal-confirm').click();
  }

  // Does the End workout button look ready (some exercise finished)?
  get endReady() { return this.$('.btn-end-workout').classList.contains('ready'); }

  // Works through the first `count` sets of an exercise: Rest then End rest, and Done on the last set.
  completeSets(exIdx, count) {
    const total = this.$(`#exercise-card-${exIdx}`).querySelectorAll('tbody tr').length;
    for (let i = 0; i < count; i++) {
      this.tapAction(exIdx, i);
      if (i < total - 1) this.tapAction(exIdx, i);
    }
  }

  row(exIdx, setIdx) {
    return this.$(`#exercise-card-${exIdx}`).querySelectorAll('tbody tr')[setIdx];
  }

  // Taps a number cell, leaving the keyboard up on its input.
  tapCell(exIdx, setIdx, field) {
    const col = { weight: 1, reps: 2, rest: 3 }[field];
    this.row(exIdx, setIdx).children[col].querySelector('span').click();
    return this.doc.activeElement;
  }

  // Types into whatever input has focus, keystroke by keystroke.
  type(text) {
    const inp = this.doc.activeElement;
    inp.value = '';
    for (const ch of text) {
      inp.value += ch;
      inp.dispatchEvent(new this.window.Event('input', { bubbles: true }));
    }
  }

  // Full edit: tap, type, dismiss the keyboard.
  editCell(exIdx, setIdx, field, value) {
    const inp = this.tapCell(exIdx, setIdx, field);
    this.type(String(value));
    inp.blur();
  }

  tapAction(exIdx, setIdx) {
    this.row(exIdx, setIdx).querySelector('.btn-action').click();
  }

  addSet(exIdx) { this.$(`#exercise-card-${exIdx} .btn-add-set`).click(); }

  // ⋯ → 删除动作; the confirm is answered by phone.confirmAnswer.
  deleteExercise(exIdx) {
    this.$(`#exercise-card-${exIdx} .exercise-menu-btn`).click();
    this.$('#exercise-menu-box .menu-item-danger').click();
  }

  async endWorkout() {
    this.$('.btn-end-workout').click();
    this.$('.confirm-ok').click();
    await tick();
    await this.phone.settle();
  }

  note(exIdx) { return this.$(`#exercise-card-${exIdx} .exercise-note`).value; }

  // Taps the note box and types, keystroke by keystroke, leaving the keyboard up.
  writeNote(exIdx, text) {
    this.$(`#exercise-card-${exIdx} .exercise-note`).focus();
    this.type(text);
  }

  // [] when the exercise isn't on the page at all.
  weights(exIdx) {
    const card = this.$(`#exercise-card-${exIdx}`);
    if (!card) return [];
    return [...card.querySelectorAll('tbody tr')].map(tr => Number(tr.children[1].textContent));
  }

  // null for a set whose reps are still behind the frosted glass; a cell being edited reads its input.
  reps(exIdx) {
    const card = this.$(`#exercise-card-${exIdx}`);
    if (!card) return [];
    return [...card.querySelectorAll('tbody tr')].map(tr => {
      const cell = tr.children[2];
      const inp = cell.querySelector('input');
      if (inp) return Number(inp.value);
      return cell.querySelector('.cell-masked') ? null : Number(cell.textContent);
    });
  }
}
