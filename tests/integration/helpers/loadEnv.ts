import { config } from "dotenv";

// The app reads DATABASE_URL / DIRECT_DATABASE_URL / API_DATABASE_URL from the environment; the
// unit suite never touches a database so it does not load .env. Integration specs do.
config();

for (const key of ["DATABASE_URL", "DIRECT_DATABASE_URL"]) {
  if (!process.env[key]) {
    throw new Error(
      `${key} is not set. The integration suite needs a live Postgres — see docs/deployment.md for the local recipe.`,
    );
  }
}
