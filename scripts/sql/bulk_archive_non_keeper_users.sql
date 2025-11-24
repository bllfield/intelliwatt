-- Bulk archive non-keeper user data (HouseAddress + SmtAuthorization)
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

CREATE TEMP TABLE non_keeper_users AS
SELECT id
FROM "User"
WHERE id NOT IN (SELECT id FROM keeper_users);

WITH house_updates AS (
  UPDATE "HouseAddress"
  SET
    "isPrimary" = FALSE,
    "archivedAt" = COALESCE("archivedAt", NOW())
  WHERE "userId" IN (SELECT id FROM non_keeper_users)
  RETURNING id, "userId", "archivedAt"
),
auth_updates AS (
  UPDATE "SmtAuthorization"
  SET
    "archivedAt" = COALESCE("archivedAt", NOW()),
    "smtStatus" = 'archived',
    "smtStatusMessage" = 'Archived during data reset',
    "revokedReason" = 'bulk_archive'
  WHERE "userId" IN (SELECT id FROM non_keeper_users)
  RETURNING id, "userId", "archivedAt"
)
SELECT
  (SELECT COUNT(*) FROM keeper_users) AS keeper_count,
  (SELECT COUNT(*) FROM non_keeper_users) AS non_keeper_count,
  (SELECT COUNT(*) FROM house_updates) AS houses_archived,
  (SELECT COUNT(*) FROM auth_updates) AS authorizations_archived;

-- Inspect a sample of archived houses for non-keeper users
SELECT
  u."email",
  ha.id AS house_id,
  ha."archivedAt"
FROM "User" u
JOIN "HouseAddress" ha ON ha."userId" = u.id
WHERE u.id IN (SELECT id FROM non_keeper_users)
ORDER BY ha."archivedAt" DESC NULLS LAST
LIMIT 20;

-- Inspect a sample of archived SMT authorizations for non-keeper users
SELECT
  u."email",
  sa.id AS authorization_id,
  sa."archivedAt",
  sa."smtStatus",
  sa."revokedReason"
FROM "User" u
JOIN "SmtAuthorization" sa ON sa."userId" = u.id
WHERE u.id IN (SELECT id FROM non_keeper_users)
ORDER BY sa."archivedAt" DESC NULLS LAST
LIMIT 20;

COMMIT;

