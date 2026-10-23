// Spiele mit weniger Teilnehmern (inkl. Gästen) zählen nicht für die Gesamtwertung
const MIN_PLAYERS_FOR_SCORING = 10;

// Serien-Bonus: Ab der 2. richtigen Antwort in Folge gibt es pro Serienschritt Extrapunkte, bis zu einer Obergrenze
const STREAK_BONUS_PER_STEP = 50;
const STREAK_BONUS_MAX = 250;

// Team-Modus: erlaubte Teamanzahlen und Mindestgröße pro Team
const TEAM_COUNTS = [2, 3, 4];
const MIN_PLAYERS_PER_TEAM = 2;

function streakBonus(streak) {
  return Math.min(Math.max(streak - 1, 0) * STREAK_BONUS_PER_STEP, STREAK_BONUS_MAX);
}

module.exports = {
  MIN_PLAYERS_FOR_SCORING, STREAK_BONUS_PER_STEP, STREAK_BONUS_MAX, TEAM_COUNTS, MIN_PLAYERS_PER_TEAM, streakBonus,
};
