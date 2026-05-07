import { checkAdmin } from '../_lib/admin.js';
import { getSupabase } from '../_lib/contact-pipeline.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const denied = checkAdmin(req);
  if (denied) return res.status(denied.status).json(denied.body);

  try {
    const { data, error } = await getSupabase()
      .from('contact_submissions')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.status(200).json({ ok: true, rows: data });
  } catch (err) {
    console.error('[admin] list failed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
