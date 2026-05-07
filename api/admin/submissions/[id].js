import { checkAdmin } from '../../_lib/admin.js';
import { getSupabase } from '../../_lib/contact-pipeline.js';

const ALLOWED = new Set(['reply_status', 'newsletter']);

export default async function handler(req, res) {
  const denied = checkAdmin(req);
  if (denied) return res.status(denied.status).json(denied.body);

  const { id } = req.query;
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  if (req.method === 'PATCH') {
    const patch = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (ALLOWED.has(k)) patch[k] = v;
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ ok: false, error: 'No valid fields to update' });
    }
    try {
      const { data, error } = await getSupabase()
        .from('contact_submissions')
        .update(patch).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json({ ok: true, row: data });
    } catch (err) {
      console.error('[admin] patch failed:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { error } = await getSupabase()
        .from('contact_submissions').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin] delete failed:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  res.setHeader('Allow', 'PATCH, DELETE');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
