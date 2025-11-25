-- Delete SMT authorizations for every user except the five keeper accounts,
-- plus a short list of reusable QA/test emails.
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
FROM "User"
WHERE id NOT IN (SELECT id FROM keeper_users)
UNION
SELECT id
FROM "User"
WHERE lower("email") IN (
  'test@intelliwatt.com',
  'user@intelliwatt.com',
  'demo@intelliwatt.com',
  'sample@intelliwatt.com'
);

WITH deleted_authorizations AS (
  DELETE FROM "SmtAuthorization"
  WHERE "userId" IN (SELECT id FROM target_users)
  RETURNING id
)
SELECT
  (SELECT COUNT(*) FROM keeper_users) AS keeper_count,
  (SELECT COUNT(*) FROM target_users) AS users_targeted,
  (SELECT COUNT(*) FROM deleted_authorizations) AS authorizations_deleted;

COMMIT;


