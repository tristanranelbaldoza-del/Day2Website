import fs from 'node:fs';
import path from 'node:path';

let _cached;
export default function handler(_req, res) {
  try {
    if (!_cached) {
      const file = path.join(process.cwd(), '.frontend-seed.json');
      _cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    res.status(200).json(_cached);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
