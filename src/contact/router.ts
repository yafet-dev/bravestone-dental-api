import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { parseContact, saveContact } from './service';

export const contactRouter = Router();
contactRouter.post('/', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many messages. Please try again in 15 minutes.' },
}), async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  // Hidden field catches simple automated form submissions without storing them.
  if (request.body?.website) {
    response.status(400).json({ message: 'Unable to submit this message.' });
    return;
  }
  const input = parseContact(request.body);
  if (!input) {
    response.status(400).json({ message: 'Enter a name (2–100 characters), a valid phone number or email address, and a message (10–5,000 characters).' });
    return;
  }
  try {
    response.status(201).json(await saveContact(input));
  } catch {
    response.status(503).json({ message: 'We could not save your message. Please try again shortly.' });
  }
});
