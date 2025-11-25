-- Delete jackpot entries for every user except the five designated keeper accounts.
-- Keeper emails (case-insensitive):
--   omoneo@o2epcm.com
--   cgoldstein@seia.com
--   whill@hilltrans.com
--   erhamilton@messer.com
--   zander86@gmail.com

BEGIN;

CREATE TEMP TABLE keeper_users AS
SELECT id
FROM "User"
WHERE lower("email") IN (
  'omoneo@o2epcm.com',
  'cgoldstein@seia.com',
  'whill@hilltrans.com',
  'erhamilton@messer.com',
  'zander86@gmail.com'
);

CREATE TEMP TABLE target_users AS
SELECT id
FROM "User";

WITH deleted_entries AS (
  DELETE FROM "Entry"
  WHERE "userId" IN (SELECT id FROM target_users)
  RETURNING id
)
SELECT
  (SELECT COUNT(*) FROM keeper_users) AS keeper_count,
  (SELECT COUNT(*) FROM target_users) AS non_keeper_count,
  (SELECT COUNT(*) FROM deleted_entries) AS entries_deleted;

COMMIT;


