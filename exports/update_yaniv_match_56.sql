-- Update יניב איטח's prediction for match 56: Türkiye vs USA
START TRANSACTION;

UPDATE predictions
SET home_score = 2,
    away_score = 1,
    points = 0,
    submitted_at = CURRENT_TIMESTAMP
WHERE user_id = 250
  AND match_id = 56;

COMMIT;
