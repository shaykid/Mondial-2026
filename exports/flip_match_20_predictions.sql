-- Flip all stored predictions for match 20: Portugal vs Uzbekistan
-- This swaps home_score and away_score for every prediction row on that match.
-- Run a score recalculation afterward if you need points to reflect the new picks.

START TRANSACTION;

UPDATE predictions p
JOIN (
  SELECT id,
         away_score AS new_home_score,
         home_score AS new_away_score
  FROM predictions
  WHERE match_id = 20
) x ON x.id = p.id
SET p.home_score = x.new_home_score,
    p.away_score = x.new_away_score
WHERE p.match_id = 20;

COMMIT;
