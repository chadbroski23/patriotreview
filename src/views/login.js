import { supabase } from '../supabase.js';
import { ROSTER, emailFor } from '../roster.js';
import { h } from '../ui.js';

// Step 1: pick your name.  Step 2: type your password.
// Everyone (including the ten names in the list) signs in through Supabase Auth,
// so the database always knows exactly who is voting.
export function loginView({ onDone }) {
  const page = h('div', { class: 'page' });
  const masthead = () => h('header', { class: 'masthead' }, h('span', { class: 'title' }, 'The Patriot Review'));

  function showNames() {
    page.replaceChildren(
      masthead(),
      h('h1', {}, 'Who are you?'),
      h(
        'div',
        { class: 'names' },
        ROSTER.map((person) => h('button', { class: 'btn', onclick: () => showPassword(person) }, person.name)),
      ),
    );
  }

  function showPassword(person) {
    const input = h('input', {
      id: 'pw',
      type: 'password',
      autocomplete: 'current-password',
      required: true,
    });
    const message = h('p', { class: 'error', role: 'alert' });
    const enter = h('button', { class: 'btn primary', type: 'submit' }, 'Enter');

    const form = h(
      'form',
      {
        class: 'stack',
        onsubmit: async (event) => {
          event.preventDefault();
          message.textContent = '';
          enter.disabled = true;
          enter.textContent = 'Signing in…';
          const { error } = await supabase.auth.signInWithPassword({
            email: emailFor(person),
            password: input.value,
          });
          if (error) {
            message.textContent = "That password didn't work. Please try again.";
            enter.disabled = false;
            enter.textContent = 'Enter';
            input.select();
            return;
          }
          onDone();
        },
      },
      h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Password'), input),
      message,
      h('div', { class: 'row-buttons' }, enter),
    );

    page.replaceChildren(
      masthead(),
      h('h1', {}, person.name),
      form,
      h('p', {}, h('button', { class: 'link', type: 'button', onclick: showNames }, '← Not you? Go back')),
    );
    input.focus();
  }

  showNames();
  return page;
}
