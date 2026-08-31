import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  // crossOriginResourcePolicy overridden from Helmet's default
  // ('same-origin') to 'cross-origin' — found by actually curling a real
  // response with an Origin header, not assumed: Cross-Origin-Resource-Policy
  // is a SEPARATE browser check from CORS, enforced even when
  // Access-Control-Allow-Origin correctly permits the origin. Left at the
  // default, it would have silently blocked the applicant-session SDK's
  // fetch() calls in real browsers despite CORS otherwise being configured
  // correctly — the kind of gap that works in curl/Postman and breaks
  // silently in an actual browser. Every other Helmet default is kept as-is.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // Permissive (reflect any origin) rather than an allowlist — a
  // deliberate choice, not an oversight. The real protection for the new
  // browser-facing applicant-session routes is the token itself (scoped to
  // one applicant, short-lived), not an origin check; CORS is a
  // browser-enforced restriction on reading cross-origin responses, so
  // enabling it globally doesn't expose the existing API-key/admin routes
  // to anything a malicious page could exploit — a browser script still
  // can't produce a secret it was never given. `credentials` stays unset:
  // the SDK sends its token explicitly via the Authorization header, no
  // cookies involved. Methods are limited to what's actually used today;
  // revisit once Phase 7's dashboard needs browser-based PATCH/DELETE. See
  // the applicant-session plan.
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('LybID API')
    .setDescription(
      'Self-hosted identity verification platform for Libyan banks and fintechs — Powered by Marsa',
    )
    .setVersion('0.1.0')
    .addBearerAuth(undefined, 'bearer')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'apiKey')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`LybID API listening on port ${port} (docs at /docs)`);
}

bootstrap();
