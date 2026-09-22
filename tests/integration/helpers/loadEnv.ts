import { config } from "dotenv";

/**
 * Loads .env for the integration suite. The unit suite deliberately runs with nothing configured,
 * so it never loads this.
 *
 * Note what this does NOT do: assert that a database is configured. It used to, which made every
 * spec in this directory require Postgres whether or not it touched one — and that is wrong for a
 * spec whose only external dependency is a browser. The requirement belongs to the thing that
 * actually needs it, so `fixtures.ts` raises it on first use instead. A browser-only spec in this
 * lane now needs a browser and nothing else.
 */
config();
