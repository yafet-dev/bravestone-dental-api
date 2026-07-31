import './env';
import app from './app';
import { assertTwoFactorConfiguration } from './auth/twoFactor';
import { ensureCareHandoffListener, stopCareHandoffListener } from './clinic/handoffs/events';

const port = Number(process.env.PORT || 4000);
assertTwoFactorConfiguration();

const server = app.listen(port, () => {
  console.log(`Bravestone Dental API running at http://localhost:${port}`);
  console.log(`Swagger UI available at http://localhost:${port}/docs`);
});

// Open the care handoff listener at boot rather than on the first stream
// request, so the very first doctor signal of the day is pushed instead of
// waiting on a connection handshake. A failure here is logged and retried in the
// background; handoffs fall back to their polling refresh meanwhile.
void ensureCareHandoffListener();

// SSE connections are long-lived, so an unhandled shutdown would leave the
// listener connection and every open stream dangling.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void stopCareHandoffListener().finally(() => process.exit(0));
    });
  });
}
