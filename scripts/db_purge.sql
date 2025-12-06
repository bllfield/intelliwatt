-- Purge all non-whitelisted users and related SMT/house data.
-- Whitelist emails remain intact.

-- Preview counts before deletion
WITH keep_emails AS (
  SELECT UNNEST(ARRAY[
    'csuttle@pegasusresidential.com',
    'pharrison@ilcenter.org',
    'zander86@gmail.com',
    'erhamilton@messer.com',
    'whill@hilltrans.com',
    'cgoldstein@seia.com',
    'omoneo@o2epcm.com'
  ]) AS email
), doomed_users AS (
  SELECT id, email FROM "User" WHERE email NOT IN (SELECT email FROM keep_emails)
), doomed_houses AS (
  SELECT id, esiid FROM "HouseAddress" WHERE "userId" IN (SELECT id FROM doomed_users)
), doomed_esiids AS (
  SELECT DISTINCT esiid FROM doomed_houses WHERE esiid IS NOT NULL
  UNION
  SELECT DISTINCT esiid FROM "SmtAuthorization" WHERE "userId" IN (SELECT id FROM doomed_users)
)
SELECT
  (SELECT count(*) FROM keep_emails)        AS keep_count,
  (SELECT count(*) FROM doomed_users)       AS doomed_users,
  (SELECT count(*) FROM doomed_houses)      AS doomed_houses,
  (SELECT count(*) FROM doomed_esiids)      AS doomed_esiids,
  (SELECT count(*) FROM "User")            AS users_total,
  (SELECT count(*) FROM "HouseAddress")    AS houses_total;

BEGIN;

CREATE TEMP TABLE keep_emails AS
SELECT UNNEST(ARRAY[
  'csuttle@pegasusresidential.com',
  'pharrison@ilcenter.org',
  'zander86@gmail.com',
  'erhamilton@messer.com',
  'whill@hilltrans.com',
  'cgoldstein@seia.com',
  'omoneo@o2epcm.com'
]) AS email;

CREATE TEMP TABLE doomed_users AS
SELECT id, email FROM "User" WHERE email NOT IN (SELECT email FROM keep_emails);

CREATE TEMP TABLE doomed_houses AS
SELECT id, esiid FROM "HouseAddress" WHERE "userId" IN (SELECT id FROM doomed_users);

CREATE TEMP TABLE doomed_esiids AS
SELECT DISTINCT esiid FROM doomed_houses WHERE esiid IS NOT NULL
UNION
SELECT DISTINCT esiid FROM "SmtAuthorization" WHERE "userId" IN (SELECT id FROM doomed_users);

-- SMT datasets tied to doomed ESIIDs
DELETE FROM "SmtBillingRead" WHERE esiid IN (SELECT esiid FROM doomed_esiids);
DELETE FROM "SmtInterval"    WHERE esiid IN (SELECT esiid FROM doomed_esiids);
DELETE FROM "SmtMeterInfo"   WHERE esiid IN (SELECT esiid FROM doomed_esiids) OR "houseId" IN (SELECT id FROM doomed_houses);

-- House-linked artifacts
DELETE FROM "GreenButtonUpload" WHERE "houseId" IN (SELECT id FROM doomed_houses);
DELETE FROM "ManualUsageUpload" WHERE "houseId" IN (SELECT id FROM doomed_houses);
DELETE FROM "EntryStatusLog" WHERE "entryId" IN (SELECT id FROM "Entry" WHERE "houseId" IN (SELECT id FROM doomed_houses) OR "userId" IN (SELECT id FROM doomed_users));
DELETE FROM "EntryExpiryDigest" WHERE "entryId" IN (SELECT id FROM "Entry" WHERE "houseId" IN (SELECT id FROM doomed_houses) OR "userId" IN (SELECT id FROM doomed_users));
DELETE FROM "Entry" WHERE "houseId" IN (SELECT id FROM doomed_houses) OR "userId" IN (SELECT id FROM doomed_users);

-- User-linked artifacts
DELETE FROM "CommissionRecord" WHERE "userId" IN (SELECT id FROM doomed_users);
DELETE FROM "JackpotPayout"   WHERE "userId" IN (SELECT id FROM doomed_users);
DELETE FROM "Session"         WHERE "userId" IN (SELECT id FROM doomed_users);
DELETE FROM "UsageData"       WHERE "userId" IN (SELECT id FROM doomed_users);
DELETE FROM "UtilityPlan"     WHERE "userId" IN (SELECT id FROM doomed_users);
DELETE FROM "TestimonialSubmission" WHERE "userId" IN (SELECT id FROM doomed_users);
DELETE FROM "Referral" WHERE "referredById" IN (SELECT id FROM doomed_users) OR "referredUserId" IN (SELECT id FROM doomed_users);
DELETE FROM "ManualUsageUpload" WHERE "userId" IN (SELECT id FROM doomed_users);
DELETE FROM "SmtAuthorization" WHERE "userId" IN (SELECT id FROM doomed_users) OR "houseAddressId" IN (SELECT id FROM doomed_houses);
DELETE FROM "NormalizedCurrentPlan" WHERE "userId" IN (SELECT id FROM doomed_users) OR "homeId" IN (SELECT id FROM doomed_houses);
DELETE FROM "GreenButtonUpload" WHERE "houseId" IN (SELECT id FROM doomed_houses);

-- Houses and profiles
DELETE FROM "HouseAddress" WHERE id IN (SELECT id FROM doomed_houses);
DELETE FROM "UserProfile"  WHERE "userId" IN (SELECT id FROM doomed_users);

-- Users last
DELETE FROM "User" WHERE id IN (SELECT id FROM doomed_users);

COMMIT;

-- Post-check of remaining counts
WITH keep_emails AS (
  SELECT UNNEST(ARRAY[
    'csuttle@pegasusresidential.com',
    'pharrison@ilcenter.org',
    'zander86@gmail.com',
    'erhamilton@messer.com',
    'whill@hilltrans.com',
    'cgoldstein@seia.com',
    'omoneo@o2epcm.com',
    'mclittlef@gmail.com'
  ]) AS email
)
SELECT
  (SELECT count(*) FROM "User")                         AS users_total,
  (SELECT count(*) FROM "HouseAddress")                 AS houses_total,
  (SELECT count(*) FROM "SmtAuthorization")             AS smt_auth_total,
  (SELECT count(*) FROM "SmtInterval")                  AS smt_interval_total,
  (SELECT count(*) FROM "SmtBillingRead")               AS smt_billing_total,
  (SELECT count(*) FROM "User" WHERE email IN (SELECT email FROM keep_emails)) AS users_remaining_whitelist;
