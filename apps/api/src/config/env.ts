import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Loads the process environment from disk exactly once, for every entrypoint
 * that touches configuration or the database — the API server, the worker, and
 * the migration CLI alike. Importing this before reading `process.env` keeps the
 * migration CLI from falling back to built-in defaults.
 *
 * `.env.local` holds machine-local credentials and wins over the shared `.env`;
 * dotenv never overwrites a variable already exported in the environment, so
 * CI and deployment secrets still take precedence over both files.
 */
// Four levels up from apps/api/{src,dist}/config is the workspace root,
// which is where the shared and machine-local env files live.
const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');

dotenv.config({ path: path.join(projectRoot, '.env.local') });
dotenv.config({ path: path.join(projectRoot, '.env') });
