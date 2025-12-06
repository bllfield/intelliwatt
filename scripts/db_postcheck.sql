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
)
SELECT
  (SELECT count(*) FROM "User") AS users_total,
  (SELECT count(*) FROM "User" WHERE email IN (SELECT email FROM keep_emails)) AS users_whitelist,
  (SELECT count(*) FROM "HouseAddress") AS houses_total,
  (SELECT count(*) FROM "SmtAuthorization") AS smt_auth_total,
  (SELECT count(*) FROM "SmtInterval") AS smt_interval_total,
  (SELECT count(*) FROM "SmtBillingRead") AS smt_billing_total;
