import { supabase } from '../supabase.js';
import { h, unwrap, backLink, submissionLabel, loadPdfUrl, pdfViewer } from '../ui.js';

// Regular reviewer: list of submissions, then read + vote.
// The database only ever gives this person: submission number, PDF file, and their OWN votes.

export async function reviewerList(ctx, profile) {
  const [subs, mine] = await Promise.all([
    supabase.from('submissions').select('id, submission_number').order('submission_number'),
    supabase.from('votes').select('submission_id'),
  ]);
  const submissions = unwrap(subs);
  const voted = new Set(unwrap(mine).map((v) => v.submission_id));

  return h(
    'main',
    {},
    h('h1', {}, 'Welcome, ', profile.display_name),
    h('h2', {}, 'Submissions'),
    submissions.length === 0
      ? h('p', { class: 'muted' }, 'No submissions yet. Check back soon.')
      : h(
          'div',
          { class: 'list' },
          submissions.map((s) =>
            h(
              'a',
              { class: 'row', href: `#/submission/${s.id}` },
              h('span', {}, submissionLabel(s.submission_number)),
              voted.has(s.id)
                ? h('span', { class: 'status done' }, 'Reviewed')
                : h('span', { class: 'status todo' }, 'Not reviewed'),
            ),
          ),
        ),
  );
}

export async function reviewerSubmission(ctx, profile, id) {
  const [subRes, voteRes] = await Promise.all([
    supabase.from('submissions').select('id, submission_number, storage_path').eq('id', id).maybeSingle(),
    supabase.from('votes').select('id').eq('submission_id', id).maybeSingle(),
  ]);
  const sub = unwrap(subRes);
  if (!sub) return h('div', {}, backLink(), h('p', {}, 'Submission not found.'));
  const alreadyVoted = Boolean(unwrap(voteRes));
  const pdfUrl = await loadPdfUrl(ctx, sub.storage_path);

  const voteBox = h('div', { class: 'vote-box' });
  const recorded = () => h('p', { class: 'notice' }, 'Vote recorded.');

  if (alreadyVoted) {
    voteBox.append(recorded());
  } else {
    const message = h('p', { class: 'error', role: 'alert' });
    const yes = h('button', { class: 'btn', onclick: () => cast('yes') }, '👍 YES');
    const no = h('button', { class: 'btn', onclick: () => cast('no') }, '👎 NO');

    async function cast(vote) {
      if (!confirm(`Submit your vote: ${vote === 'yes' ? 'YES' : 'NO'}?\n\nYou cannot change it afterward.`)) return;
      message.textContent = '';
      yes.disabled = no.disabled = true;
      const { error } = await supabase
        .from('votes')
        .insert({ submission_id: sub.id, reviewer_id: profile.id, vote });
      // 23505 = already voted (e.g. in another tab): the database refused, and that's fine.
      if (error && error.code !== '23505') {
        message.textContent = 'Your vote was not saved. Please try again.';
        yes.disabled = no.disabled = false;
        return;
      }
      voteBox.replaceChildren(recorded());
    }

    voteBox.append(
      h('h2', {}, 'Should this submission move forward?'),
      h('div', { class: 'choices' }, yes, no),
      message,
    );
  }

  return h('main', {}, backLink(), h('h1', {}, submissionLabel(sub.submission_number)), pdfViewer(pdfUrl), voteBox);
}
