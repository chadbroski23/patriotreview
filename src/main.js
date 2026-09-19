import './style.css';
import { supabase, configured, configError } from './supabase.js';
import { h, errorBox } from './ui.js';
import { loginView } from './views/login.js';
import { reviewerList, reviewerSubmission } from './views/reviewer.js';
import { finalList, finalSubmission } from './views/final.js';
import { editorList, editorSubmission, editorAdd } from './views/editor.js';

const app = document.getElementById('app');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Which screens each role has. (This only decides what to *show*.
// What each person is actually allowed to *read* is enforced by the database.)
const SCREENS = {
  reviewer: { home: reviewerList, submission: reviewerSubmission },
  final_reviewer: { home: finalList, submission: finalSubmission },
  editor: { home: editorList, submission: editorSubmission, add: editorAdd },
};

let profile = null;
let renderToken = 0;
let cleanups = [];

const ctx = {
  flash: '',
  onLeave: (fn) => cleanups.push(fn),
};

function mount(node) {
  app.replaceChildren(node);
}

function shell(content, { signedIn = true } = {}) {
  return h(
    'div',
    { class: 'page' + (content.classList?.contains('wide') ? ' wide' : '') },
    h(
      'header',
      { class: 'masthead' },
      h('a', { class: 'title', href: '#/' }, 'The Patriot Review'),
      signedIn ? h('button', { class: 'link', onclick: signOut }, 'Sign out') : null,
    ),
    content,
  );
}

async function signOut() {
  await supabase.auth.signOut();
  profile = null;
  location.hash = '#/';
  render();
}

async function render() {
  const token = ++renderToken;
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
  cleanups = [];

  if (!configured) {
    mount(shell(h('p', { class: 'error' }, configError), { signedIn: false }));
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (token !== renderToken) return;

  if (!session) {
    profile = null;
    mount(loginView({ onDone: render }));
    return;
  }

  if (!profile || profile.id !== session.user.id) {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, role, active')
      .eq('id', session.user.id)
      .maybeSingle();
    if (token !== renderToken) return;
    profile = data;
  }

  if (!profile || !profile.active) {
    mount(
      shell(
        h(
          'div',
          {},
          h('h1', {}, 'This account is not set up'),
          h('p', {}, 'Please ask the Senior Editor for help.'),
        ),
      ),
    );
    return;
  }

  const [route = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
  const name = route === '' ? 'home' : route;
  const view = SCREENS[profile.role]?.[name];
  const badId = name === 'submission' && !UUID.test(arg ?? '');
  if (!view || badId) {
    if (location.hash !== '#/') {
      location.hash = '#/'; // fires "hashchange", which renders the home screen
      return;
    }
    mount(shell(errorBox(new Error('Page not found.'))));
    return;
  }

  mount(shell(h('p', { class: 'muted' }, 'Loading…')));
  try {
    const node = await view(ctx, profile, arg);
    if (token !== renderToken) return;
    mount(shell(node));
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    if (token !== renderToken) return;
    mount(shell(errorBox(err)));
  }
}

if (configured) {
  // If the session ends (for example in another tab), go back to the sign-in screen.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && profile) {
      profile = null;
      setTimeout(render, 0);
    }
  });
}

window.addEventListener('hashchange', render);
render();
