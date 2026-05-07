const { ADMIN_PASSWORD } = process.env;

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!ADMIN_PASSWORD) return res.status(501).json({ ok: false, error: 'Admin not configured' });
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Wrong password' });
  }
  return res.status(200).json({ ok: true });
}
