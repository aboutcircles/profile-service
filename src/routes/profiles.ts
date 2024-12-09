import { Router } from 'express';
import ProfileRepo from '../repositories/profileRepo';

const router = Router();

router.get('/search', (req, res) => {
  const query = req.query.query as string;
  if (!query) return res.status(400).json({ error: 'Query parameter is required' });

  const results = ProfileRepo.searchProfiles(query);
  res.json(results);
});

export default router;
