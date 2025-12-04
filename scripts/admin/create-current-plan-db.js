const { Client } = require("pg");

async function ensureDatabase() {
  const defaultUrl =
    process.env.DIRECT_URL ||
    process.env.DEFAULT_DB_URL ||
    "postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/defaultdb?sslmode=require";

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
    console.log("Connecting to", defaultUrl);
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

