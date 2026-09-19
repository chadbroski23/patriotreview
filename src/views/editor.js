import { supabase } from '../supabase.js';
import { h, unwrap, backLink, pad, submissionLabel, loadPdfUrl, pdfViewer } from '../ui.js';

const GENRES = ['Fiction', 'Poetry', 'Nonfic/Editorial', 'Devos'];
const review = (yes, cast, total) => {
  const value = cast ? yes / cast * 100 : 0;
  return { progress: `${cast}/${total}`, percent: `${value.toFixed(value % 1 ? 1 : 0)}%`, relation: value > 50 ? 'ABOVE 50%' : value < 50 ? 'BELOW 50%' : 'AT 50%' };
};
const finalText = (s) => !s?.sent_to_final_at ? 'Not sent' : s.final_decision === 'accepted' ? 'Accepted' : s.final_decision === 'rejected' ? 'Rejected' : 'Sent to Chloe';

export async function editorList(ctx) {
  const results = await Promise.all([
    supabase.from('submissions').select('id, submission_number, genre, withdrawn_at').order('submission_number'),
    supabase.from('submission_authors').select('submission_id, author_name, author_grade'),
    supabase.from('submission_status').select('submission_id, sent_to_final_at, final_decision'),
    supabase.from('votes').select('submission_id, vote'),
    supabase.from('profiles').select('id').eq('role', 'reviewer').eq('active', true),
  ]);
  const [subs, authors, statuses, votes, people] = results.map(unwrap);
  const authorBy = new Map(authors.map((x) => [x.submission_id, x]));
  const statusBy = new Map(statuses.map((x) => [x.submission_id, x]));
  const tally = new Map(), total = people.length;
  votes.forEach((v) => { const x = tally.get(v.submission_id) || { yes: 0, cast: 0 }; x.cast++; if (v.vote === 'yes') x.yes++; tally.set(v.submission_id, x); });
  const live = subs.filter((s) => !s.withdrawn_at);
  const count = (fn) => live.filter(fn).length;
  const stats = [['Total submissions', live.length], ['Awaiting review', count((s) => !(tally.get(s.id)?.cast))], ['Reviewing', count((s) => { const n = tally.get(s.id)?.cast || 0; return n && n < total; })], ['Ready for Elijah', count((s) => (tally.get(s.id)?.cast || 0) === total && !statusBy.get(s.id)?.sent_to_final_at)], ['Sent to Chloe', count((s) => statusBy.get(s.id)?.sent_to_final_at && !statusBy.get(s.id)?.final_decision)], ['Accepted', count((s) => statusBy.get(s.id)?.final_decision === 'accepted')], ['Rejected', count((s) => statusBy.get(s.id)?.final_decision === 'rejected')]];
  const rows = subs.map((s) => {
    const a = authorBy.get(s.id), t = tally.get(s.id) || { yes: 0, cast: 0 }, r = review(t.yes, t.cast, total);
    return h('tr', { onclick: () => location.hash = `#/submission/${s.id}` },
      h('td', {}, h('a', { href: `#/submission/${s.id}`, onclick: (e) => e.stopPropagation() }, pad(s.submission_number))),
      h('td', {}, a?.author_name || ''), h('td', {}, a?.author_grade || ''), h('td', {}, s.genre),
      h('td', {}, `${r.progress} · ${r.percent}`), h('td', {}, s.withdrawn_at ? 'Withdrawn' : finalText(statusBy.get(s.id))));
  });
  const flash = ctx.flash; ctx.flash = '';
  return h('main', { class: 'wide' },
    h('div', { class: 'title-row' }, h('h1', {}, 'Editorial Overview'), h('a', { class: 'btn primary', href: '#/add' }, '+ ADD SUBMISSION')),
    h('div', { class: 'stats' }, stats.map(([label, value]) => h('div', { class: 'stat' }, h('strong', {}, String(value)), h('span', {}, label)))),
    h('h2', {}, 'Submissions'), flash ? h('p', { class: 'notice' }, flash) : null,
    subs.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Author', 'Grade', 'Genre', 'Review', 'Status'].map((x) => h('th', {}, x)))), h('tbody', {}, rows))) : h('p', { class: 'muted' }, 'No submissions yet.'));
}

export async function editorSubmission(ctx, profile, id) {
  const results = await Promise.all([
    supabase.from('submissions').select('id, submission_number, storage_path, genre, withdrawn_at').eq('id', id).maybeSingle(),
    supabase.from('submission_authors').select('author_name, author_grade').eq('submission_id', id).maybeSingle(),
    supabase.from('submission_status').select('sent_to_final_at, final_decision').eq('submission_id', id).maybeSingle(),
    supabase.from('votes').select('reviewer_id, vote').eq('submission_id', id),
    supabase.from('profiles').select('id, display_name, active').eq('role', 'reviewer').order('display_name'),
  ]);
  const [sub, author, status, votes, reviewers] = results.map(unwrap);
  if (!sub) return h('div', {}, backLink(), h('p', {}, 'Submission not found.'));
  const active = reviewers.filter((x) => x.active).length, yes = votes.filter((x) => x.vote === 'yes').length, summary = review(yes, votes.length, active), voteBy = new Map(votes.map((x) => [x.reviewer_id, x.vote]));
  const msg = h('p', { class: 'error', role: 'alert' });
  async function action(label, rpc, args, question) {
    if (!confirm(question)) return;
    const { error } = await supabase.rpc(rpc, args);
    if (error) return void (msg.textContent = error.message);
    ctx.flash = label; location.hash = '#/';
  }
  const name = h('input', { type: 'text', value: author?.author_name || '', required: true });
  const grade = h('input', { type: 'text', value: author?.author_grade || '', required: true });
  const genre = h('select', {}, GENRES.map((g) => h('option', { value: g, selected: g === sub.genre }, g)));
  const file = h('input', { type: 'file', accept: 'application/pdf,.pdf' });
  const edit = h('details', { class: 'admin-controls' }, h('summary', {}, 'Edit details / replace PDF'),
    h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = '';
      let { error } = await supabase.rpc('update_submission_details', { p_submission_id: sub.id, p_author_name: name.value, p_author_grade: grade.value, p_genre: genre.value });
      if (error) return void (msg.textContent = error.message);
      if (file.files[0]) ({ error } = await supabase.storage.from('submissions').upload(sub.storage_path, file.files[0], { contentType: 'application/pdf', upsert: true }));
      if (error) return void (msg.textContent = error.message);
      ctx.flash = 'Submission details updated.'; location.hash = '#/';
    } }, h('div', { class: 'field' }, h('label', {}, 'Author Name'), name), h('div', { class: 'field' }, h('label', {}, 'Grade'), grade), h('div', { class: 'field' }, h('label', {}, 'Genre'), genre), h('div', { class: 'field' }, h('label', {}, 'Replace PDF (optional)'), file), h('button', { class: 'btn', type: 'submit' }, 'SAVE CHANGES')));
  const controls = h('div', { class: 'admin-controls' }, h('h2', {}, 'Admin Controls'),
    !sub.withdrawn_at ? h('button', { class: 'btn primary', onclick: () => action('Sent to Chloe.', 'send_to_final_review', { p_submission_id: sub.id }, `Send ${submissionLabel(sub.submission_number)} to Chloe / Mrs. Stafford?`) }, 'SEND TO CHLOE') : null,
    status?.sent_to_final_at ? h('button', { class: 'btn', onclick: () => action('Removed from final review.', 'remove_from_final_review', { p_submission_id: sub.id }, 'Remove this from final review and clear its final decision?') }, 'REMOVE FROM FINAL REVIEW') : null,
    status?.final_decision ? h('button', { class: 'btn', onclick: () => action('Final decision reset.', 'reset_final_decision', { p_submission_id: sub.id }, 'Remove Chloe’s final decision?') }, 'RESET FINAL DECISION') : null,
    h('button', { class: 'btn', onclick: () => action(sub.withdrawn_at ? 'Submission restored.' : 'Submission withdrawn.', 'set_submission_withdrawn', { p_submission_id: sub.id, p_withdrawn: !sub.withdrawn_at }, `${sub.withdrawn_at ? 'Restore' : 'Withdraw'} this submission?`) }, sub.withdrawn_at ? 'RESTORE SUBMISSION' : 'WITHDRAW SUBMISSION'),
    h('button', { class: 'btn', onclick: () => action('All votes reset.', 'reset_submission_votes', { p_submission_id: sub.id }, 'Reset all votes? This cannot be undone.') }, 'RESET ALL VOTES'), msg);
  const rows = reviewers.filter((x) => x.active || voteBy.has(x.id)).map((p) => h('tr', {}, h('td', {}, p.display_name), h('td', {}, voteBy.get(p.id) === 'yes' ? '👍 Yes' : voteBy.get(p.id) === 'no' ? '👎 No' : 'Not voted'), h('td', {}, voteBy.has(p.id) ? h('button', { class: 'link', onclick: () => action(`Vote reset for ${p.display_name}.`, 'reset_submission_votes', { p_submission_id: sub.id, p_reviewer_id: p.id }, `Remove ${p.display_name}'s vote?`) }, 'Reset vote') : null)));
  const pdfUrl = await loadPdfUrl(ctx, sub.storage_path);
  return h('main', { class: 'wide' }, backLink(), h('h1', {}, submissionLabel(sub.submission_number)), sub.withdrawn_at ? h('p', { class: 'notice' }, 'Withdrawn from the normal workflow') : null,
    h('dl', { class: 'facts' }, h('dt', {}, 'Author'), h('dd', {}, author?.author_name || ''), h('dt', {}, 'Grade'), h('dd', {}, author?.author_grade || ''), h('dt', {}, 'Genre'), h('dd', {}, sub.genre), h('dt', {}, 'Review progress'), h('dd', {}, `${summary.progress} reviewers have voted`), h('dt', {}, 'Current vote'), h('dd', {}, `${yes} YES · ${summary.percent} YES — ${summary.relation}`), h('dt', {}, 'Final review'), h('dd', {}, finalText(status))),
    pdfViewer(pdfUrl), controls, edit, h('h2', {}, 'Reviewer Votes'), h('div', { class: 'table-wrap' }, h('table', { class: 'narrow' }, h('tbody', {}, rows))));
}

export async function editorAdd(ctx) {
  const name = h('input', { type: 'text', required: true }), grade = h('input', { type: 'text', required: true }), genre = h('select', {}, GENRES.map((g) => h('option', { value: g }, g))), file = h('input', { type: 'file', accept: 'application/pdf,.pdf', required: true }), message = h('p', { class: 'error' }), button = h('button', { class: 'btn primary', type: 'submit' }, 'UPLOAD SUBMISSION');
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault(); const pdf = file.files[0]; if (!pdf || (!/\.pdf$/i.test(pdf.name) && pdf.type !== 'application/pdf')) return void (message.textContent = 'Please choose a PDF.');
    button.disabled = true; let created;
    try { const rows = unwrap(await supabase.rpc('create_submission', { p_author_name: name.value, p_author_grade: grade.value, p_genre: genre.value })); created = Array.isArray(rows) ? rows[0] : rows; const { error } = await supabase.storage.from('submissions').upload(created.new_path, pdf, { contentType: 'application/pdf' }); if (error) throw error; ctx.flash = `${submissionLabel(created.new_number)} added.`; location.hash = '#/'; }
    catch (err) { if (created) await supabase.from('submissions').delete().eq('id', created.new_id); message.textContent = err.message || 'Upload failed.'; button.disabled = false; }
  } }, h('div', { class: 'field' }, h('label', {}, 'Author Name'), name), h('div', { class: 'field' }, h('label', {}, 'Grade'), grade), h('div', { class: 'field' }, h('label', {}, 'Genre'), genre), h('div', { class: 'field' }, h('label', {}, 'PDF'), file), message, button);
  return h('main', {}, backLink(), h('h1', {}, 'Add Submission'), form);
}
