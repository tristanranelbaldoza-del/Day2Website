// Shared auth helper for admin routes. Single shared password from env,
// passed as `Authorization: Bearer <password>`. Same model as server.js.

const { ADMIN_PASSWORD } = process.env;

export const ADMIN_CONFIGURED = Boolean(ADMIN_PASSWORD);

// Returns null on success; an error response object on failure (so the
// caller can early-return). Centralises the 401/501 wiring.
export function checkAdmin(req) {
  if (!ADMIN_CONFIGURED) return { status: 501, body: { ok: false, error: 'Admin not configured' } };
  const auth = (req.headers.authorization || '').toString();
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token !== ADMIN_PASSWORD) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } };
  }
  return null;
}
