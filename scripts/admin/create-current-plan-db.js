const { Client } = require("pg");

async function ensureDatabase() {
  const defaultUrl = process.env.DIRECT_URL || process.env.DEFAULT_DB_URL;
  if (!defaultUrl) {
    throw new Error(
      "Missing DIRECT_URL/DEFAULT_DB_URL. Refusing to run without an explicit database URL in environment variables.",
    );
  }

  const url = new URL(defaultUrl);

  const client = new Client({
    host: url.hostname,
    port: Number(url.port || "5432"),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "postgres",
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log("Connecting to DEFAULT_DB_URL/DIRECT_URL (redacted)");
    await client.connect();
    await client.query('CREATE DATABASE "intelliwatt_current_plan"');
    console.log("intelliwatt_current_plan database created");
  } catch (err) {
    if (err && err.code === "42P04") {
      console.log("intelliwatt_current_plan already exists");
    } else {
      console.error(err);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

ensureDatabase();

