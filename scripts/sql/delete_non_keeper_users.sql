-- Bulk delete all non-keeper users, their entries, referrals, profiles, SMT data, and houses.
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

WITH entry_delete AS (
  DELETE FROM "Entry"
  WHERE "userId" IN (SELECT id FROM target_users)
  RETURNING id
),
usage_delete AS (
  DELETE FROM "UsageData"
  WHERE "userId" IN (SELECT id FROM target_users)
  RETURNING id
),
plan_delete AS (
  DELETE FROM "UtilityPlan"
  WHERE "userId" IN (SELECT id FROM target_users)
  RETURNING id
),
session_delete AS (
  DELETE FROM "Session"
  WHERE "userId" IN (SELECT id FROM target_users)
  RETURNING id
),
commission_delete AS (
  DELETE FROM "CommissionRecord"
  WHERE "userId" IN (SELECT id FROM non_keeper_users)
  RETURNING id
),
jackpot_delete AS (
  DELETE FROM "JackpotPayout"
  WHERE "userId" IN (SELECT id FROM non_keeper_users)
  RETURNING id
),
referral_delete AS (
  DELETE FROM "Referral"
  WHERE "referredById" IN (SELECT id FROM target_users)
  RETURNING id
),
profile_delete AS (
  DELETE FROM "UserProfile"
  WHERE "userId" IN (SELECT id FROM target_users)
  RETURNING id
),
auth_delete AS (
  DELETE FROM "SmtAuthorization"
  WHERE "userId" IN (SELECT id FROM target_users)
  RETURNING id
),
house_delete AS (
  DELETE FROM "HouseAddress"
  WHERE "userId" IN (SELECT id FROM target_users)
  RETURNING id
),
user_delete AS (
  DELETE FROM "User"
  WHERE id IN (SELECT id FROM target_users)
  RETURNING id
)
SELECT
  (SELECT COUNT(*) FROM keeper_users) AS keeper_count,
  (SELECT COUNT(*) FROM target_users) AS users_removed,
  (SELECT COUNT(*) FROM entry_delete) AS entries_deleted,
  (SELECT COUNT(*) FROM usage_delete) AS usage_deleted,
  (SELECT COUNT(*) FROM plan_delete) AS plans_deleted,
  (SELECT COUNT(*) FROM session_delete) AS sessions_deleted,
  (SELECT COUNT(*) FROM commission_delete) AS commissions_deleted,
  (SELECT COUNT(*) FROM jackpot_delete) AS jackpot_deleted,
  (SELECT COUNT(*) FROM auth_delete) AS authorizations_deleted,
  (SELECT COUNT(*) FROM house_delete) AS houses_deleted,
  (SELECT COUNT(*) FROM referral_delete) AS referrals_deleted,
  (SELECT COUNT(*) FROM profile_delete) AS profiles_deleted;

-- Confirm that no non-keeper emails remain
SELECT "email"
FROM "User"
WHERE lower("email") NOT IN (
  'omoneo@o2epcm.com',
  'cgoldstein@seia.com',
  'whill@hilltrans.com',
  'erhamilton@messer.com',
  'zander86@gmail.com'
)
ORDER BY "email";

COMMIT;

