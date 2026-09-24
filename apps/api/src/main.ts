// main.ts is the first file that runs when the API starts.
// It creates the Nest app, applies global settings, mounts Swagger and starts listening.
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // helmet sets the security headers a public API should always send.
  app.use(helmet());

  // Every route is versioned from day one. Changing the shape of a response later
  // means adding /v2, not breaking the customers already on /v1.
  app.setGlobalPrefix('api/v1');

  // No global ValidationPipe here on purpose: that pipe is built on
  // class-validator, and this project validates with Zod so the same schema can
  // be shared with the web app. Routes apply ZodValidationPipe per handler, and
  // every Zod object schema strips unknown keys - so a client still cannot
  // smuggle in a field the schema never declared, tenantId above all.

  // The web app runs on a different Railway service, so it is a cross-origin caller.
  // credentials:true is required because auth travels in httpOnly cookies.
  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  });

  // Swagger is public in development and closed in production, because the schema
  // of every endpoint is a map of the API for anyone probing it.
  if (config.get<string>('NODE_ENV') !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('Inventory SaaS API')
      .setDescription('Multi-tenant office asset register.')
      .setVersion('0.1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  }

  // Railway injects PORT. Binding to 0.0.0.0 is required: the default binds only
  // inside the container and the deploy fails its health check.
  const port = Number(config.get('PORT', 3001));
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
