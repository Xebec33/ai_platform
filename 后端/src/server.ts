import { createApp } from './app.js';

const app = await createApp({ logger: true });
try {
  await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
