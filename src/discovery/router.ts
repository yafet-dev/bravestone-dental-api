import { Router } from 'express';
import {
  createDiscoveryEntry,
  deleteDiscoveryEntry,
  listDiscoveryEntries,
  updateDiscoveryEntry,
} from './service';
import type { DiscoveryEntryInput } from './types';

export const discoveryRouter = Router();

discoveryRouter.get('/entries', async (_request, response, next) => {
  try {
    const entries = await listDiscoveryEntries();
    response.json({ entries });
  } catch (error) {
    next(error);
  }
});

discoveryRouter.post('/entries', async (request, response, next) => {
  try {
    const entry = await createDiscoveryEntry(request.body as DiscoveryEntryInput);
    response.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

discoveryRouter.put('/entries/:id', async (request, response, next) => {
  try {
    const entry = await updateDiscoveryEntry(request.params.id, request.body as DiscoveryEntryInput);
    response.json({ entry });
  } catch (error) {
    next(error);
  }
});

discoveryRouter.delete('/entries/:id', async (request, response, next) => {
  try {
    await deleteDiscoveryEntry(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
