const ESIID_UNDER_TEST = "10443720004529147";

async function main() {
  const {
    SMT_API_BASE_URL,
    SMT_USERNAME,
    SMT_PASSWORD,
    SMT_REQUESTOR_ID,
    SMT_REQUESTOR_AUTH_ID,
  } = process.env;

  const baseUrl =
    SMT_API_BASE_URL && SMT_API_BASE_URL.trim().length > 0
      ? SMT_API_BASE_URL.trim().replace(/\/+$/, "")
      : "https://services.smartmetertexas.net";

  const username = (SMT_USERNAME || "").trim();
  const password = (SMT_PASSWORD || "").trim();
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

  console.log("=== SMT meterInfo ESIID Test ===");
  console.log("Base URL:         ", baseUrl);
  console.log("ESIID under test: ", ESIID_UNDER_TEST);
  console.log("requestorID:      ", requestorID);
  console.log("auth ID (DUNS):   ", requesterAuthenticationID);
  console.log("");

  // Step 1: request JWT token
  const tokenUrl = `${baseUrl}/v2/token/`;
  console.log("[STEP 1] Requesting SMT JWT access token...");

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
    console.error("[ERROR] Failed to call SMT /v2/token/:", err);
    process.exit(1);
  }

  const tokenText = await tokenRes.text();
  console.log("  /v2/token/ status:", tokenRes.status);
  console.log("  /v2/token/ body:  ", tokenText);
  console.log("");

  if (!tokenRes.ok) {
    console.error(
      "[ERROR] SMT /v2/token/ did not return 200. Cannot proceed to /v2/meterInfo/.",
    );
    process.exit(1);
  }

  let accessToken;
  try {
    const tokenJson = JSON.parse(tokenText);
    accessToken = tokenJson.access_token || tokenJson.accessToken;
  } catch (err) {
    console.error("[ERROR] Failed to parse token JSON:", err);
    process.exit(1);
  }

  if (!accessToken) {
    console.error(
      "[ERROR] No access_token in SMT token response. Check SMT credentials.",
    );
    process.exit(1);
  }

  console.log("[STEP 1] Got SMT JWT access token.");
  console.log("");

  // Step 2: call /v2/meterInfo/
  const meterInfoUrl = `${baseUrl}/v2/meterInfo/`;
  const transId = `TEST${Date.now().toString(36).toUpperCase()}`;

  const meterInfoBody = {
    MeterSearchRequest: {
      trans_id: transId,
      requestorID,
      requesterType: "CSP",
      requesterAuthenticationID,
      reportFormat: "JSON",
      deliveryMode: "API",
      version: "L",
      ESIIDMeterList: [
        {
          esiid: ESIID_UNDER_TEST,
        },
      ],
      SMTTermsandConditions: "Y",
    },
  };

  console.log("[STEP 2] Calling SMT /v2/meterInfo/ with payload:");
  console.log(JSON.stringify(meterInfoBody, null, 2));
  console.log("");

  let miRes;
  console.log("[DEBUG] Using SMT username header:", username);
  try {
    miRes = await fetch(meterInfoUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        // Ensure SMT sees the same service ID username in the header.
        username,
      },
      body: JSON.stringify(meterInfoBody),
    });
  } catch (err) {
    console.error("[ERROR] Failed to call SMT /v2/meterInfo/:", err);
    process.exit(1);
  }

  const miText = await miRes.text();
  console.log("  /v2/meterInfo/ status:", miRes.status);
  console.log("  /v2/meterInfo/ body:");
  console.log(miText);

  if (!miRes.ok) {
    console.error(
      "[RESULT] /v2/meterInfo/ did NOT succeed (non-2xx). SMT may be blocking meter attributes for this ESIID with the current authorization.",
    );
    process.exit(2);
  }

  console.log("");
  console.log(
    "[RESULT] /v2/meterInfo/ returned a successful status code. Inspect the body above for meter attributes or acknowledgements.",
  );
  console.log(
    "If SMT only returns an acknowledgement with correlationId, actual meter details may arrive later via SFTP depending on SMT’s configuration.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[FATAL] Unhandled error in meterInfo test:", err);
  process.exit(1);
});

