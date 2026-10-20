// Fake cloud: stands in for Supabase at the app's cloud adapter (`window.showUpCloud`).
// One Cloud is the server, shared by every phone in a test. Each launched app
// connects to it, and its login lives in that app's localStorage like the real SDK's.
const tick = () => new Promise(r => setImmediate(r));
const copy = v => JSON.parse(JSON.stringify(v));

function cloudError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

export class Cloud {
  online = true;
  users = {};      // email -> { id, password, confirmed }
  states = {};     // userId -> { state, updatedAt }
  history = [];    // { userId, clientId, routineKey, startedAt, endedAt, exercises }
  backups = [];    // { userId, state, updatedAt }
  outbox = [];     // emails sent: { to, code, kind }
  inflight = 0;

  // The code in the latest email sent to this address.
  lastCode(email) {
    return this.outbox.filter(m => m.to === email).at(-1)?.code;
  }

  state(email) { return this.states[this.users[email].id]?.state; }
  workouts(email) { return this.history.filter(w => w.userId === this.users[email].id); }

  // Every request takes a turn of the event loop and fails when the phone has no network.
  async request(fn) {
    this.inflight++;
    try {
      await tick();
      if (!this.online) throw cloudError('offline');
      return fn();
    } finally {
      this.inflight--;
    }
  }

  sendCode(to, kind) {
    const code = String(100000 + this.outbox.length);
    this.outbox.push({ to, code, kind });
  }

  connect(window) {
    const cloud = this;
    const SESSION = 'fake-cloud-session';
    const session = () => window.localStorage.getItem(SESSION);
    const login = user => {
      window.localStorage.setItem(SESSION, user.id);
      return { id: user.id, email: user.email };
    };
    const me = () => {
      const id = session();
      if (!id) throw cloudError('not_signed_in');
      return id;
    };
    const userByEmail = email => cloud.users[email];

    return {
      async currentUser() {
        const id = session();
        const user = Object.values(cloud.users).find(u => u.id === id);
        return user ? { id: user.id, email: user.email } : null;
      },
      signUp: (email, password) => cloud.request(() => {
        if (password.length < 6) throw cloudError('weak_password');
        if (!userByEmail(email)) {
          cloud.users[email] = { id: `user-${Object.keys(cloud.users).length + 1}`, email, password, confirmed: false };
        }
        if (!userByEmail(email).confirmed) cloud.sendCode(email, 'signup');
      }),
      resendSignupCode: email => cloud.request(() => cloud.sendCode(email, 'signup')),
      verifySignupCode: (email, code) => cloud.request(() => {
        const user = userByEmail(email);
        if (!user || cloud.lastCode(email) !== code) throw cloudError('otp_expired');
        user.confirmed = true;
        return login(user);
      }),
      signIn: (email, password) => cloud.request(() => {
        const user = userByEmail(email);
        if (!user || user.password !== password) throw cloudError('invalid_credentials');
        if (!user.confirmed) throw cloudError('email_not_confirmed');
        return login(user);
      }),
      sendResetCode: email => cloud.request(() => {
        if (userByEmail(email)) cloud.sendCode(email, 'recovery');
      }),
      verifyResetCode: (email, code) => cloud.request(() => {
        const user = userByEmail(email);
        if (!user || cloud.lastCode(email) !== code) throw cloudError('otp_expired');
        return login(user);
      }),
      setPassword: password => cloud.request(() => {
        Object.values(cloud.users).find(u => u.id === me()).password = password;
      }),
      pullState: () => cloud.request(() => {
        const row = cloud.states[me()];
        return row ? copy(row) : null;
      }),
      pushState: (state, updatedAt) => cloud.request(() => {
        cloud.states[me()] = copy({ state, updatedAt });
      }),
      appendWorkout: workout => cloud.request(() => {
        const userId = me();
        if (cloud.history.some(w => w.userId === userId && w.clientId === workout.clientId)) return;
        cloud.history.push({ userId, ...copy(workout) });
      }),
      backupState: (state, updatedAt) => cloud.request(() => {
        cloud.backups.push({ userId: me(), ...copy({ state, updatedAt }) });
      }),
    };
  }
}
