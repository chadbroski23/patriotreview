import { supabase } from './supabase.js';

// Tiny DOM helper. Text is always inserted as text (never as HTML), so nothing typed
// into the site can inject code.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid);
  }
  return el;
}

export const pad = (n) => String(n).padStart(3, '0');
export const submissionLabel = (n) => `Submission #${pad(n)}`;

// Throw on a Supabase error, otherwise hand back the data.
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export const backLink = () => h('a', { class: 'back', href: '#/' }, '← Back to Submissions');

// Download a PDF (permission is checked by the database) and show it in the browser's own viewer.
export async function loadPdfUrl(ctx, storagePath) {
  const { data, error } = await supabase.storage.from('submissions').download(storagePath);
  if (error) throw error;
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  ctx.onLeave(() => URL.revokeObjectURL(url));
  return url;
}

export function pdfViewer(url) {
  return h(
    'div',
    { class: 'pdf' },
    h('iframe', { src: url, title: 'Submission PDF' }),
    h('p', { class: 'small' }, h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open PDF in a new tab')),
  );
}

export function errorBox(err) {
  return h(
    'div',
    {},
    h('p', { class: 'error' }, 'Something went wrong.'),
    err && err.message ? h('p', { class: 'small' }, err.message) : null,
    h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again'),
  );
}
