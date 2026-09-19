import { supabase } from '../supabase.js';
import { h, unwrap, backLink, submissionLabel, loadPdfUrl, pdfViewer } from '../ui.js';

// Chloe / Mrs. Stafford: only submissions that passed appear (the database filters them).
// No author, no grade, no votes.

export async function finalList() {
  const [subs, statuses] = await Promise.all([
    supabase.from('submissions').select('id, submission_number').order('submission_number'),
    supabase.from('submission_status').select('submission_id, final_decision'),
  ]);
  const submissions = unwrap(subs);
  const decisions = new Map(unwrap(statuses).map((s) => [s.submission_id, s.final_decision]));

  return h(
    'main',
    {},
    h('h1', {}, 'Final Review'),
    submissions.length === 0
      ? h('p', { class: 'muted' }, 'Nothing to review yet. Submissions appear here after the reviewers finish voting.')
      : h(
          'div',
          { class: 'list' },
          submissions.map((s) => {
            const decision = decisions.get(s.id);
            return h(
              'a',
              { class: 'row', href: `#/submission/${s.id}` },
              h('span', {}, submissionLabel(s.submission_number)),
              decision
                ? h('span', { class: 'status done' }, decision === 'accepted' ? 'Accepted' : 'Rejected')
                : h('span', { class: 'status todo' }, 'Read PDF'),
            );
          }),
        ),
  );
}

export async function finalSubmission(ctx, profile, id) {
  const [subRes, statusRes] = await Promise.all([
    supabase.from('submissions').select('id, submission_number, storage_path').eq('id', id).maybeSingle(),
    supabase.from('submission_status').select('final_decision').eq('submission_id', id).maybeSingle(),
  ]);
  const sub = unwrap(subRes);
  if (!sub) return h('div', {}, backLink(), h('p', {}, 'Submission not found.'));
  const decided = Boolean(unwrap(statusRes)?.final_decision);
  const pdfUrl = await loadPdfUrl(ctx, sub.storage_path);

  const box = h('div', { class: 'vote-box' });
  const recorded = () => h('p', { class: 'notice' }, 'Decision recorded.');

  if (decided) {
    box.append(recorded());
  } else {
    const message = h('p', { class: 'error', role: 'alert' });
    const accept = h('button', { class: 'btn', onclick: () => decide('accepted', 'ACCEPT') }, 'ACCEPT');
    const reject = h('button', { class: 'btn', onclick: () => decide('rejected', 'REJECT') }, 'REJECT');

    async function decide(decision, word) {
      if (!confirm(`Record your decision: ${word}?\n\nYou cannot change it afterward.`)) return;
      message.textContent = '';
      accept.disabled = reject.disabled = true;
      const { error } = await supabase.rpc('record_final_decision', {
        p_submission_id: sub.id,
        p_decision: decision,
      });
      if (error) {
        message.textContent = 'Your decision was not saved. Please refresh and try again.';
        accept.disabled = reject.disabled = false;
        return;
      }
      box.replaceChildren(recorded());
    }

    box.append(h('h2', {}, 'Final Decision'), h('div', { class: 'choices' }, accept, reject), message);
  }

  return h('main', {}, backLink(), h('h1', {}, submissionLabel(sub.submission_number)), pdfViewer(pdfUrl), box);
}
