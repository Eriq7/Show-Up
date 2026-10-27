// Test harness: runs the real index.html in jsdom the way it lives on the phone.
// The phone owns the clock and the disk (localStorage), so killing and
// relaunching the app keeps whatever the app managed to save.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { Cloud } from './cloud.mjs';

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
        window.showUpCloud = phone.cloud.connect(window);
        for (const [k, v] of Object.entries(phone.disk)) window.localStorage.setItem(k, v);
        window.confirm = msg => { phone.dialogs.push(msg); return phone.confirmAnswer; };
        window.alert = msg => { phone.dialogs.push(msg); };
        window.HTMLElement.prototype.scrollIntoView = () => {};
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

  // '胸' | '肩' | '背' ('Chest' | 'Shoulders' | 'Back' in English) — taps the matching dragon head on the home page.
  async openRoutine(name) {
    this.$(`button[aria-label="${name}训练"], button[aria-label="${name} workout"]`).click();
    await tick();
  }

  // The 中文 / English button under the dragons.
  switchLanguage() { this.$('#btn-lang').click(); }

  async goHome() {
    this.$('#btn-back').click();
    await tick();
  }

  addExercise(name, sets) {
    this.$('.btn-add-exercise').click();
    this.$('#modal-name').value = name;
    this.$('#modal-sets').value = String(sets);
    this.$('.modal-confirm').click();
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
