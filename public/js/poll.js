// Balkendiagramme für Umfrage-Ergebnisse (Host-Bildschirm und Ergebnis-Seite), ohne externe Bibliothek.
// questions: [{ text, answers, multi, counts, respondents }]
function pollChartHtml(q, { big = false } = {}) {
  const total = Math.max(1, q.respondents);
  const max = Math.max(1, ...q.counts);
  const top = q.counts.indexOf(Math.max(...q.counts));
  return `
    <div class="poll-chart ${big ? 'big' : ''}">
      <h3 class="poll-q">${escapeHtml(q.text)}</h3>
      <div class="muted poll-meta">${q.respondents} ${q.respondents === 1 ? 'Antwort' : 'Antworten'}${q.multi ? ' · Mehrfachnennungen möglich' : ''}</div>
      ${q.answers.map((a, i) => {
        const pct = Math.round((q.counts[i] / total) * 100);
        return `
        <div class="poll-row ${q.respondents && i === top && q.counts[i] > 0 ? 'top' : ''}">
          <div class="poll-label">${escapeHtml(a)}</div>
          <div class="poll-bar"><span class="c${i % 4}" style="width:${(q.counts[i] / max) * 100}%"></span></div>
          <div class="poll-count">${pct} % <span class="muted">(${q.counts[i]})</span></div>
        </div>`;
      }).join('')}
    </div>`;
}

function pollResultsHtml(results, opts) {
  return `
    <div class="muted center" style="margin-bottom:.5rem">${results.participants} ${results.participants === 1 ? 'Teilnehmer' : 'Teilnehmer'}</div>
    ${results.questions.map((q) => `<div class="card">${pollChartHtml(q, opts)}</div>`).join('')}`;
}
