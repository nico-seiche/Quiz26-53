// Spiele mit weniger Teilnehmern (inkl. Gästen) zählen nicht für die Gesamtwertung
const MIN_PLAYERS_FOR_SCORING = 10;

// Serien-Bonus: Ab der 2. richtigen Antwort in Folge gibt es pro Serienschritt Extrapunkte, bis zu einer Obergrenze
const STREAK_BONUS_PER_STEP = 50;
const STREAK_BONUS_MAX = 250;

// Team-Modus: immer genau 2 Teams, Mindestgröße pro Team
const TEAM_COUNT = 2;
const MIN_PLAYERS_PER_TEAM = 2;

// Level: alle 2000 gewerteten Punkte ein Level (Level 1 ab 0 Punkten)
const POINTS_PER_LEVEL = 2000;

function levelInfo(points) {
  const level = Math.floor(points / POINTS_PER_LEVEL) + 1;
  const intoLevel = points % POINTS_PER_LEVEL;
  return { level, intoLevel, perLevel: POINTS_PER_LEVEL, toNext: POINTS_PER_LEVEL - intoLevel };
}

function streakBonus(streak) {
  return Math.min(Math.max(streak - 1, 0) * STREAK_BONUS_PER_STEP, STREAK_BONUS_MAX);
}

// Rangliste: zählt nur Spiele ab dem Stichtag aus quiz.app_settings (Reset ohne Löschen, siehe Migration 022)
const SINCE_RESET = `r.played_at >= COALESCE((SELECT value::timestamptz FROM quiz.app_settings WHERE key = 'leaderboard_since'), '-infinity'::timestamptz)`;

module.exports = {
  SINCE_RESET, MIN_PLAYERS_FOR_SCORING, STREAK_BONUS_PER_STEP, STREAK_BONUS_MAX, TEAM_COUNT, MIN_PLAYERS_PER_TEAM, streakBonus,
  POINTS_PER_LEVEL, levelInfo,
};
