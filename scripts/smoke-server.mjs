import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await startServer({
  host: '127.0.0.1',
  port: 0,
  isPackaged: true,
  workspaceRoot: path.join(projectRoot, '.smoke-workspace'),
  staticDir: path.join(projectRoot, 'dist'),
});

try {
  const runtimeResponse = await fetch(`${server.url}/api/runtime-info`);
  assert.equal(runtimeResponse.status, 200);
  const runtime = await runtimeResponse.json();
  assert.equal(typeof runtime.readyForImages, 'boolean');
  assert.equal(typeof runtime.readyForVideo, 'boolean');
  assert.equal(typeof runtime.tools, 'object');

  const jobsResponse = await fetch(`${server.url}/api/jobs`);
  assert.equal(jobsResponse.status, 200);
  const jobs = await jobsResponse.json();
  assert.ok(Array.isArray(jobs.jobs));

  const exportsResponse = await fetch(`${server.url}/api/exports`);
  assert.equal(exportsResponse.status, 200);
  const exportsPayload = await exportsResponse.json();
  assert.ok(Array.isArray(exportsPayload.files));

  console.log('SplatStudio server smoke check passed.');
} finally {
  await server.close();
}
