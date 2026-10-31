import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The API serves the built web app when it exists (single-service hosting such as Render).
// Uses a throwaway build folder; needs no database.
describe('serving the web app', () => {
  let app;
  let dir;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sabilling-web-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
    process.env.WEB_DIST = dir;
    const { createApp } = await import('../src/app.js');
    app = createApp();
  });

  afterAll(() => {
    delete process.env.WEB_DIST;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns index.html for page addresses so the browser router can handle them', async () => {
    for (const page of ['/', '/clients', '/book/main', '/billing/new']) {
      const res = await request(app).get(page).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toContain('id="root"');
    }
  });

  it('caches hashed assets for a year', async () => {
    const res = await request(app).get('/assets/index-abc123.js').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('keeps API and upload errors as JSON', async () => {
    const api = await request(app).get('/api/no-such-route').expect(404);
    expect(api.body.error.code).toBe('NOT_FOUND');
    const upload = await request(app).get('/uploads/missing.jpg').expect(404);
    expect(upload.body.error).toEqual({ code: 'NOT_FOUND', message: 'File not found' });
    await request(app).post('/clients').expect(404);
  });
});
