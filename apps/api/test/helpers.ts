import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

let counter = 0;
export const uid = () => `${Date.now().toString(36)}${counter++}`;

export async function signupTenant(app: INestApplication, label: string) {
  const slug = `t-${label}-${uid()}`;
  const adminEmail = `admin@${slug}.test`;
  const password = 'admin-pass-123';
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({
      tenantName: `Tenant ${label}`,
      tenantSlug: slug,
      adminEmail,
      adminName: 'Admin',
      password,
    })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ tenantSlug: slug, email: adminEmail, password })
    .expect(200);
  return {
    slug,
    adminEmail,
    password,
    token: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
