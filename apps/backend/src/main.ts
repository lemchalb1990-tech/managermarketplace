import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import * as compression from 'compression';
import { join } from 'path';
import { AppModule } from './app.module';
import { frontendUrls } from './common/frontend-url.util';
import { installOutboundGuard } from './common/integrations.util';
import { runWithRequest } from './common/request-context';

async function bootstrap() {
  installOutboundGuard();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Respuestas comprimidas (gzip): el JSON del catálogo y los listados baja varias veces su peso.
  // Solo sobre 1 KB; las imágenes y PDF ya vienen comprimidos y la librería los salta.
  app.use(compression({ threshold: 1024 }));

  // Contexto por petición: permite saber qué usuario inició una importación.
  app.use((req: any, _res: any, next: () => void) => runWithRequest(req, next));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: [
      ...frontendUrls(),
      /\.easypanel\.host$/,
      /\.ondatasolution\.com$/,
      'http://localhost:3000',
    ],
    credentials: true,
  });

  // Servir imágenes bajo /api/uploads/ (pasa por el proxy de EasyPanel) y /uploads/ (local)
  const uploadsDir = join(process.cwd(), 'uploads');
  app.useStaticAssets(uploadsDir, { prefix: '/api/uploads' });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Backend corriendo en http://localhost:${port}/api`);
}
bootstrap();
