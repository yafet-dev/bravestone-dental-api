import './env';
import { createApp } from './app';

const port = Number(process.env.PORT || 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`Bravestone Dental API running at http://localhost:${port}`);
  console.log(`Swagger UI available at http://localhost:${port}/docs`);
});
