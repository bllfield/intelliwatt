// Simple SMT /v2/meterInfo/ test script.
// Runs against a single ESIID using env-backed SMT credentials.
// Usage (on droplet, as deploy user):
//   cd /home/deploy
//   set -a
//   . .intelliwatt.env
//   set +a
//   cd /home/deploy/apps/intelliwatt
//   node scripts/test_smt_meter_info.mjs <ESIID>
// or set SMT_METERINFO_ESIID in the environment.

async function main() {
  const {
    SMT_API_BASE_URL,
    SMT_USERNAME,
    SMT_PASSWORD,
    SMT_REQUESTOR_ID,
    SMT_REQUESTOR_AUTH_ID,
  } = process.env;

  // Base URL: default to production if env not set
  const baseUrl =
    SMT_API_BASE_URL && SMT_API_BASE_URL.trim().length > 0
      ? SMT_API_BASE_URL.trim().replace(/\/+$/, "")
      : "https://services.smartmetertexas.net";

  const username = (SMT_USERNAME || "").trim();
  const password = (SMT_PASSWORD || "").trim();

  // Per SMT guide:
  // - requestorID = Service ID user name
  // - requesterAuthenticationID = DUNS
  const requestorID = (SMT_REQUESTOR_ID || SMT_USERNAME || "").trim();
  const requesterAuthenticationID =
    (SMT_REQUESTOR_AUTH_ID || "134642921").trim();

  if (!username || !password) {
    console.error(
      "[TEST] Missing SMT_USERNAME or SMT_PASSWORD in environment. Aborting.",
    );
    process.exit(1);
  }

  if (!requestorID || !requesterAuthenticationID) {
    console.error(
      "[TEST] Missing SMT_REQUESTOR_ID or SMT_REQUESTOR_AUTH_ID in environment. Aborting.",
    );
    process.exit(1);
  }

  const rawArgs = process.argv.slice(2);
  let jsonMode = false;
  const args = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = (rawArgs[i] || "").trim();
    if (!arg) continue;
    if (arg.toLowerCase() === "--json") {
      jsonMode = true;
      continue;
    }
    if (arg.toLowerCase() === "--mode") {
      const next = rawArgs[i + 1] ? rawArgs[i + 1].trim() : "";
      if (next.toLowerCase() === "json") {
        jsonMode = true;
        i += 1;
        continue;
      }
    }
    args.push(arg);
  }

  if (jsonMode) {
    console.log = (...logArgs) => {
      console.error(...logArgs);
    };
  }

  const trimmedArgs = args.map((arg) => arg.trim()).filter(Boolean);
  let esiidFromArgs = "";
  for (let i = 0; i < trimmedArgs.length; i += 1) {
    const arg = trimmedArgs[i];
    if (arg.toLowerCase() === "--esiid") {
      esiidFromArgs =
        trimmedArgs[i + 1] && !trimmedArgs[i + 1].startsWith("--")
          ? trimmedArgs[i + 1]
          : "";
      break;
    }
    if (!arg.startsWith("--") && !esiidFromArgs) {
      esiidFromArgs = arg;
      break;
    }
  }

  const DEFAULT_ESIID = "10443720004529147";
  const esiidFromEnv = (process.env.SMT_METERINFO_ESIID || "").trim();
  const esiidInput = esiidFromArgs || esiidFromEnv || DEFAULT_ESIID;
  const esiidList = esiidInput
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (esiidList.length === 0) {
    console.error("[TEST] Unable to determine any ESIIDs to test.");
    process.exit(1);
  }

  const useJsonFormat = esiidList.length === 1;

  console.log("=== SMT meterInfo ESIID Test ===");
  console.log("Base URL:          ", baseUrl);
  console.log("ESIID(s) under test:", esiidList.join(", "));
  console.log("requestorID:       ", requestorID);
  console.log("auth ID (DUNS):    ", requesterAuthenticationID);
  console.log("");

  // ---------------------------------------------------------------------------
  // STEP 1: Get JWT token via /v2/token/
  // ---------------------------------------------------------------------------
  console.log("[STEP 1] Requesting SMT JWT access token...");

  const tokenUrl = `${baseUrl}/v2/token/`;

  let tokenRes;
  try {
    tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        password,
      }),
    });
  } catch (err) {
    console.error("[ERROR] Failed to call /v2/token/:", err);
    process.exit(1);
  }

  const tokenStatus = tokenRes.status;
  const tokenText = await tokenRes.text();

  console.log("  /v2/token/ status:", tokenStatus);
  console.log("  /v2/token/ body:  ", tokenText);
  console.log("");

  if (tokenStatus < 200 || tokenStatus >= 300) {
    console.error(
      "[RESULT] /v2/token/ did NOT succeed (non-2xx). Cannot proceed to meterInfo.",
    );
    process.exit(1);
  }

  let accessToken;
  try {
    const tokenJson = JSON.parse(tokenText);
    accessToken = tokenJson.accessToken;
  } catch (err) {
    console.error("[ERROR] Failed to parse token JSON:", err);
    process.exit(1);
  }

  if (!accessToken) {
    console.error(
      "[ERROR] Token response did not contain accessToken. Cannot proceed.",
    );
    process.exit(1);
  }

  console.log("[STEP 1] Got SMT JWT access token.");
  console.log("");

  // ---------------------------------------------------------------------------
  // STEP 2: Call /v2/meterInfo/ (Meter Information Request)
  // Per SMT guide example:
  // {
  //   "trans_id":"123",
  //   "requestorID":"SUMANTH_CSP",
  //   "requesterType":"CSP",
  //   "requesterAuthenticationID":"199999999999",
  //   "reportFormat":"CSV",
  //   "version":"L",
  //   "ESIIDMeterList":[ { "esiid":"..." } ],
//   "SMTTermsandConditions":"Y"
  // }
  // ---------------------------------------------------------------------------

  const meterInfoUrl = `${baseUrl}/v2/meterInfo/`;

  // Simple trans_id for traceability
  const transId = `TESTMI${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

  const meterInfoBody = {
    // NOTE: For INTELLIPATH, SMT delivers meter attributes via SFTP as CSV files when multiple ESIIDs are requested.
    // When only one ESIID is requested, SMT accepts JSON delivery and returns inline meter information (if enabled).
    trans_id: transId,
    requestorID,
    requesterType: "CSP",
    requesterAuthenticationID,
    reportFormat: useJsonFormat ? "JSON" : "CSV",
    version: "L",
    ESIIDMeterList: esiidList.map((esiid) => ({ esiid })),
    SMTTermsandConditions: "Y",
  };

  console.log("[STEP 2] Calling SMT /v2/meterInfo/ with payload:");
  console.log(JSON.stringify(meterInfoBody, null, 2));
  console.log("");

  let miRes;
  try {
    miRes = await fetch(meterInfoUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(meterInfoBody),
    });
  } catch (err) {
    console.error("[ERROR] Failed to call /v2/meterInfo/:", err);
    process.exit(1);
  }

  const miStatus = miRes.status;
  const miText = await miRes.text();

  console.log("  /v2/meterInfo/ status:", miStatus);
  console.log("  /v2/meterInfo/ body:");
  console.log(miText);
  console.log("");

  if (miStatus < 200 || miStatus >= 300) {
    console.error(
      "[RESULT] /v2/meterInfo/ did NOT succeed (non-2xx). SMT may be blocking meter attributes for this ESIID or this Service ID configuration.",
    );
    process.exit(1);
  }

  let parsedMeterInfo = null;
  try {
    parsedMeterInfo = JSON.parse(miText);
  } catch {
    parsedMeterInfo = null;
  }

  if (jsonMode) {
    const payload = {
      trans_id: meterInfoBody.trans_id,
      esiid: esiidList.length === 1 ? esiidList[0] : esiidList,
      status: miStatus,
      rawResponse: parsedMeterInfo ?? miText,
    };
    if (parsedMeterInfo && typeof parsedMeterInfo === "object") {
      if (parsedMeterInfo.MeterData) {
        payload.MeterData = parsedMeterInfo.MeterData;
      }
      if (!payload.trans_id && parsedMeterInfo.trans_id) {
        payload.trans_id = parsedMeterInfo.trans_id;
      }
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    console.log(
      `[RESULT] /v2/meterInfo/ returned status ${miStatus}. See body above for acknowledgement or fault codes.`,
    );
    console.log(
      "Meter attributes, if any, will be delivered via SFTP as CSV according to SMT’s configuration.",
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[FATAL] Unhandled error in meterInfo test:", err);
  process.exit(1);
});
