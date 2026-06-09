import { existsSync } from 'node:fs';
import { config } from 'dotenv';

if (existsSync('backend.env')) {
  config({ path: 'backend.env', quiet: true });
} else {
  config({ path: '.env', quiet: true });
}
