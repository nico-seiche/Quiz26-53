// Teams im Team-Modus: Namen, Wertung und Ausgleich bei ungleicher Größe
const TEAMS = [
  { name: 'Füchse', emoji: '🦊', color: '#e11d48' },
  { name: 'Eulen', emoji: '🦉', color: '#2563eb' },
];

// Teamwertung aus den Einzelpunkten. field wählt die Punkte (score = aktuell, prevScore = vor der Frage).
// Ausgleich: Hat ein Team einen Spieler weniger, bekommt es einen Geist-Spieler 👻 mit dem
// Punktedurchschnitt der echten Mitglieder des Teams.
function buildTeams(players, teamCount, field = 'score') {
  const teams = Array.from({ length: teamCount }, (_, i) => ({
    index: i,
    ...TEAMS[i],
    members: players.filter((p) => p.team === i),
  }));
  const maxSize = Math.max(...teams.map((t) => t.members.length));

  for (const t of teams) {
    t.size = t.members.length;
    t.base = t.members.reduce((sum, p) => sum + p[field], 0);
    t.ghost = t.size > 0 && t.size < maxSize;
    t.bonus = t.ghost ? Math.round(t.base / t.size) : 0;
    t.score = t.base + t.bonus;
  }
  return teams;
}

// Platzierung der Teams (gleiche Punkte: kleinere Teamnummer zuerst)
function rankTeams(teams) {
  return [...teams].sort((a, b) => b.score - a.score || a.index - b.index);
}

// Teams mit aktuellem Platz, Punkten und Platz/Punkten vor der letzten Frage
function standings(players, teamCount) {
  const now = buildTeams(players, teamCount, 'score');
  const before = buildTeams(players, teamCount, 'prevScore');
  const prevRank = new Map(rankTeams(before).map((t, i) => [t.index, i + 1]));
  const prevScore = new Map(before.map((t) => [t.index, t.score]));
  return rankTeams(now).map((t, i) => ({
    ...t,
    rank: i + 1,
    prevRank: prevRank.get(t.index),
    prevScore: prevScore.get(t.index),
    gained: t.score - prevScore.get(t.index),
  }));
}

module.exports = { TEAMS, buildTeams, rankTeams, standings };
