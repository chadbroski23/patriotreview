import { supabase } from '../supabase.js';
import { h, unwrap, backLink, pad, submissionLabel, loadPdfUrl, pdfViewer } from '../ui.js';

// Senior Editor: sees everything and adds submissions.
// All of this works only because the database recognises this account as the editor.

const MAX_PDF_BYTES = 20 * 1024 * 1024; // matches the storage bucket limit

const reviewText = (status, yes, cast, total) => {
  if (status === 'passed') return `${yes}/${cast} — PASS`;
  if (status === 'cut') return `${yes}/${cast} — CUT`;
  return `Voting (${cast}/${total} in)`;
};

const finalText = (status, decision) => {
  if (status !== 'passed') return '—';
  if (decision === 'accepted') return 'ACCEPTED';
  if (decision === 'rejected') return 'REJECTED';
  return 'Pending';
};

export async function editorList(ctx) {
  const [subs, authors, statuses, votes, people] = await Promise.all([
    supabase.from('submissions').select('id, submission_number').order('submission_number'),
    supabase.from('submission_authors').select('submission_id, author_name, author_grade'),
    supabase.from('submission_status').select('submission_id, review_status, final_decision'),
    supabase.from('votes').select('submission_id, vote'),
    supabase.from('profiles').select('id').eq('role', 'reviewer').eq('active', true),
  ]);
  const submissions = unwrap(subs);
  const authorBy = new Map(unwrap(authors).map((a) => [a.submission_id, a]));
  const statusBy = new Map(unwrap(statuses).map((s) => [s.submission_id, s]));
  const totalReviewers = unwrap(people).length;
  const tally = new Map();
  for (const v of unwrap(votes)) {
    const t = tally.get(v.submission_id) || { yes: 0, cast: 0 };
    t.cast += 1;
    if (v.vote === 'yes') t.yes += 1;
    tally.set(v.submission_id, t);
  }

  const flash = ctx.flash;
  ctx.flash = '';

  const rows = submissions.map((s) => {
    const author = authorBy.get(s.id);
    const status = statusBy.get(s.id);
    const t = tally.get(s.id) || { yes: 0, cast: 0 };
    const go = () => (location.hash = `#/submission/${s.id}`);
    return h(
      'tr',
      { onclick: go },
      h('td', {}, h('a', { href: `#/submission/${s.id}`, onclick: (e) => e.stopPropagation() }, pad(s.submission_number))),
      h('td', {}, author?.author_name ?? ''),
      h('td', {}, author?.author_grade ?? ''),
      h('td', {}, reviewText(status?.review_status, t.yes, t.cast, totalReviewers)),
      h('td', {}, finalText(status?.review_status, status?.final_decision)),
    );
  });

  return h(
    'main',
    { class: 'wide' },
    h(
      'div',
      { class: 'title-row' },
      h('h1', {}, 'Submissions'),
      h('a', { class: 'btn primary', href: '#/add' }, '+ ADD SUBMISSION'),
    ),
    flash ? h('p', { class: 'notice' }, flash) : null,
    submissions.length === 0
      ? h('p', { class: 'muted' }, 'No submissions yet. Click “+ ADD SUBMISSION” to upload the first one.')
      : h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, ['#', 'Author', 'Grade', 'Review', 'Final'].map((c) => h('th', {}, c)))),
            h('tbody', {}, rows),
          ),
        ),
  );
}

export async function editorSubmission(ctx, profile, id) {
  const [subRes, authorRes, statusRes, votesRes, peopleRes] = await Promise.all([
    supabase.from('submissions').select('id, submission_number, storage_path').eq('id', id).maybeSingle(),
    supabase.from('submission_authors').select('author_name, author_grade').eq('submission_id', id).maybeSingle(),
    supabase.from('submission_status').select('review_status, final_decision').eq('submission_id', id).maybeSingle(),
    supabase.from('votes').select('reviewer_id, vote').eq('submission_id', id),
    supabase.from('profiles').select('id, display_name, active').eq('role', 'reviewer').order('display_name'),
  ]);
  const sub = unwrap(subRes);
  if (!sub) return h('div', {}, backLink(), h('p', {}, 'Submission not found.'));
  const author = unwrap(authorRes);
  const status = unwrap(statusRes);
  const votes = unwrap(votesRes);
  const reviewers = unwrap(peopleRes);
  const voteBy = new Map(votes.map((v) => [v.reviewer_id, v.vote]));
  const activeCount = reviewers.filter((r) => r.active).length;
  const yes = votes.filter((v) => v.vote === 'yes').length;
  const pdfUrl = await loadPdfUrl(ctx, sub.storage_path);

  const voteRows = reviewers
    .filter((r) => r.active || voteBy.has(r.id))
    .map((r) => {
      const v = voteBy.get(r.id);
      return h(
        'tr',
        {},
        h('td', {}, r.display_name),
        h('td', {}, v === 'yes' ? '👍 Yes' : v === 'no' ? '👎 No' : h('span', { class: 'muted' }, 'Not voted yet')),
      );
    });

  return h(
    'main',
    { class: 'wide' },
    backLink(),
    h('h1', {}, submissionLabel(sub.submission_number)),
    h(
      'dl',
      { class: 'facts' },
      h('dt', {}, 'Author'),
      h('dd', {}, author?.author_name ?? ''),
      h('dt', {}, 'Grade'),
      h('dd', {}, author?.author_grade ?? ''),
      h('dt', {}, 'Review'),
      h('dd', {}, reviewText(status?.review_status, yes, votes.length, activeCount)),
      h('dt', {}, 'Final'),
      h('dd', {}, finalText(status?.review_status, status?.final_decision)),
    ),
    pdfViewer(pdfUrl),
    h('h2', {}, 'Votes'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'narrow' }, h('tbody', {}, voteRows))),
  );
}

export async function editorAdd(ctx) {
  const name = h('input', { id: 'author', type: 'text', required: true, autocomplete: 'off' });
  const grade = h('input', { id: 'grade', type: 'text', required: true, autocomplete: 'off', inputmode: 'numeric' });
  const file = h('input', { id: 'pdf', type: 'file', accept: 'application/pdf,.pdf', required: true });
  const message = h('p', { class: 'error', role: 'alert' });
  const button = h('button', { class: 'btn primary', type: 'submit' }, 'UPLOAD SUBMISSION');

  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (event) => {
        event.preventDefault();
        message.textContent = '';
        const pdf = file.files[0];
        if (!pdf) return void (message.textContent = 'Please choose a PDF file.');
        if (!/\.pdf$/i.test(pdf.name) && pdf.type !== 'application/pdf')
          return void (message.textContent = 'That file is not a PDF.');
        if (pdf.size > MAX_PDF_BYTES) return void (message.textContent = 'That PDF is larger than 20 MB.');

        button.disabled = true;
        button.textContent = 'Uploading…';
        let created = null;
        try {
          // 1. The database picks the next number and the neutral filename.
          const rows = unwrap(
            await supabase.rpc('create_submission', {
              p_author_name: name.value,
              p_author_grade: grade.value,
            }),
          );
          created = Array.isArray(rows) ? rows[0] : rows;
          // 2. The PDF is stored under that neutral filename (the original filename is never used).
          const up = await supabase.storage
            .from('submissions')
            .upload(created.new_path, pdf, { contentType: 'application/pdf', upsert: false });
          if (up.error) throw up.error;
          ctx.flash = `${submissionLabel(created.new_number)} added.`;
          location.hash = '#/';
        } catch (err) {
          console.error(err);
          if (created) await supabase.from('submissions').delete().eq('id', created.new_id); // undo the half-finished upload
          message.textContent = `The upload did not work: ${err.message || 'unknown error'}. Nothing was saved.`;
          button.disabled = false;
          button.textContent = 'UPLOAD SUBMISSION';
        }
      },
    },
    h('div', { class: 'field' }, h('label', { for: 'author' }, 'Author Name'), name),
    h('div', { class: 'field' }, h('label', { for: 'grade' }, 'Grade'), grade),
    h('div', { class: 'field' }, h('label', { for: 'pdf' }, 'PDF'), file),
    message,
    h('div', { class: 'row-buttons' }, button),
  );

  return h('main', {}, backLink(), h('h1', {}, 'Add Submission'), form);
}
