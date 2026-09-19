import { supabase } from '../supabase.js';
import { h, unwrap, backLink, submissionLabel, loadPdfUrl, pdfViewer } from '../ui.js';

const GENRES = ['Fiction', 'Poetry', 'Nonfic/Editorial', 'Devos'];

export async function reviewerList(ctx, profile) {
  const [subs, mine] = [unwrap(await supabase.from('submissions').select('id, submission_number, genre').order('submission_number')), unwrap(await supabase.from('votes').select('submission_id'))];
  const voted = new Set(mine.map((v) => v.submission_id));
  return h('main', {}, h('h1', {}, 'Welcome, ', profile.display_name), h('h2', {}, 'Submissions'),
    subs.length ? GENRES.map((genre) => {
      const group = subs.filter((s) => s.genre === genre);
      return group.length ? h('section', { class: 'genre-group' }, h('h2', {}, genre), h('div', { class: 'list' }, group.map((s) => h('a', { class: 'row', href: `#/submission/${s.id}` }, h('span', {}, submissionLabel(s.submission_number)), h('span', { class: voted.has(s.id) ? 'status done' : 'status todo' }, voted.has(s.id) ? 'Reviewed' : 'Not reviewed'))))) : null;
    }) : h('p', { class: 'muted' }, 'No submissions yet. Check back soon.'));
}

export async function reviewerSubmission(ctx, profile, id) {
  const [sub, oldVote] = [unwrap(await supabase.from('submissions').select('id, submission_number, storage_path, genre').eq('id', id).maybeSingle()), unwrap(await supabase.from('votes').select('id, vote').eq('submission_id', id).maybeSingle())];
  if (!sub) return h('div', {}, backLink(), h('p', {}, 'Submission not found.'));
  const message = h('p', { class: 'error', role: 'alert' }), box = h('div', { class: 'vote-box' });
  const yes = h('button', { class: `btn ${oldVote?.vote === 'yes' ? 'primary' : ''}` }, '👍 YES');
  const no = h('button', { class: `btn ${oldVote?.vote === 'no' ? 'primary' : ''}` }, '👎 NO');
  async function cast(vote) {
    if (!confirm(`${oldVote ? 'Change' : 'Submit'} your vote to ${vote.toUpperCase()}?`)) return;
    yes.disabled = no.disabled = true; message.textContent = '';
    const query = oldVote ? supabase.from('votes').update({ vote }).eq('id', oldVote.id).eq('reviewer_id', profile.id) : supabase.from('votes').insert({ submission_id: sub.id, reviewer_id: profile.id, vote });
    const { error } = await query;
    if (error) { message.textContent = 'Your vote was not saved. Please refresh and try again.'; yes.disabled = no.disabled = false; return; }
    box.replaceChildren(h('p', { class: 'notice' }, `Your current vote: ${vote === 'yes' ? '👍 YES' : '👎 NO'}`), h('p', { class: 'muted' }, 'You can change it whenever you need to.'), h('div', { class: 'choices' }, yes, no));
  }
  yes.onclick = () => cast('yes'); no.onclick = () => cast('no');
  box.append(oldVote ? h('p', { class: 'notice' }, `Your current vote: ${oldVote.vote === 'yes' ? '👍 YES' : '👎 NO'}`) : h('h2', {}, 'Should this submission move forward?'), h('div', { class: 'choices' }, yes, no), message);
  return h('main', {}, backLink(), h('h1', {}, submissionLabel(sub.submission_number)), h('p', { class: 'muted' }, sub.genre), pdfViewer(await loadPdfUrl(ctx, sub.storage_path)), box);
}
