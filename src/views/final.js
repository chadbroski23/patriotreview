import { supabase } from '../supabase.js';
import { h, unwrap, backLink, submissionLabel, loadPdfUrl, pdfViewer } from '../ui.js';

const GENRES = ['Fiction', 'Poetry', 'Nonfic/Editorial', 'Devos'];
const label = (s) => !s?.sent_to_final_at ? 'Browse only' : s.final_decision === 'accepted' ? 'Accepted' : s.final_decision === 'rejected' ? 'Rejected' : 'Awaiting decision';

export async function finalList() {
  const [subs, statuses] = [unwrap(await supabase.from('submissions').select('id, submission_number, genre').order('submission_number')), unwrap(await supabase.from('submission_status').select('submission_id, sent_to_final_at, final_decision'))];
  const statusBy = new Map(statuses.map((s) => [s.submission_id, s]));
  const row = (s) => h('a', { class: 'row', href: `#/submission/${s.id}` }, h('span', {}, submissionLabel(s.submission_number)), h('span', { class: statusBy.get(s.id)?.sent_to_final_at ? 'status todo' : 'status done' }, label(statusBy.get(s.id))));
  const sent = subs.filter((s) => statusBy.get(s.id)?.sent_to_final_at);
  return h('main', {}, h('h1', {}, 'All Submissions'), h('p', { class: 'muted' }, 'Browse every blind submission below. Final Review contains work Elijah has officially sent to you.'),
    GENRES.map((genre) => { const group = subs.filter((s) => s.genre === genre); return group.length ? h('section', { class: 'genre-group' }, h('h2', {}, genre), h('div', { class: 'list' }, group.map(row))) : null; }),
    h('h2', {}, 'Final Review'), sent.length ? h('div', { class: 'list' }, sent.map(row)) : h('p', { class: 'muted' }, 'Nothing has been sent for final review yet.'));
}

export async function finalSubmission(ctx, profile, id) {
  const [sub, status] = [unwrap(await supabase.from('submissions').select('id, submission_number, storage_path, genre').eq('id', id).maybeSingle()), unwrap(await supabase.from('submission_status').select('sent_to_final_at, final_decision').eq('submission_id', id).maybeSingle())];
  if (!sub) return h('div', {}, backLink(), h('p', {}, 'Submission not found.'));
  const box = h('div', { class: 'vote-box' });
  if (status?.sent_to_final_at && !status.final_decision) {
    const message = h('p', { class: 'error', role: 'alert' }), accept = h('button', { class: 'btn', onclick: () => decide('accepted', 'ACCEPT') }, 'ACCEPT'), reject = h('button', { class: 'btn', onclick: () => decide('rejected', 'REJECT') }, 'REJECT');
    async function decide(decision, word) {
      if (!confirm(`Record your decision: ${word}?`)) return;
      accept.disabled = reject.disabled = true;
      const { error } = await supabase.rpc('record_final_decision', { p_submission_id: sub.id, p_decision: decision });
      if (error) { message.textContent = error.message; accept.disabled = reject.disabled = false; return; }
      box.replaceChildren(h('p', { class: 'notice' }, 'Decision recorded.'));
    }
    box.append(h('h2', {}, 'Final Decision'), h('div', { class: 'choices' }, accept, reject), message);
  } else if (status?.final_decision) box.append(h('p', { class: 'notice' }, `Final decision: ${status.final_decision === 'accepted' ? 'ACCEPTED' : 'REJECTED'}`));
  else box.append(h('p', { class: 'muted' }, 'Elijah has not sent this submission for final review. You may read it, but final-decision controls are not available.'));
  return h('main', {}, backLink(), h('h1', {}, submissionLabel(sub.submission_number)), h('p', { class: 'muted' }, sub.genre), pdfViewer(await loadPdfUrl(ctx, sub.storage_path)), box);
}
