// Records the demo GIF/MP4 and the "learning loop" screenshots used in the README, site and write-up.
//   node eval/record-demo.mjs            (needs Ollama running; uses ffmpeg from imageio-ffmpeg)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer } from '../scripts/serve.mjs';
import { ROOT, launchWithExtension, loadProfile, tabIdFor } from './harness.mjs';

const SPEED = 5;
const OUT = path.join(ROOT, 'site', 'assets');
const SHOTS = path.join(OUT, 'screens');
const VIDEO_DIR = path.join(ROOT, 'eval', 'results', 'video');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const ffmpeg = execFileSync('python', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())']).toString().trim();
const persona = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'demo', 'meera.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitState = (page, states) => page.waitForFunction((s) => s.includes(document.documentElement.dataset.dittoState), states, { timeout: 15 * 60 * 1000, polling: 200 });

async function smoothScroll(page, to, ms) {
  await page.evaluate(
    ([target, duration]) =>
      new Promise((resolve) => {
        const start = window.scrollY;
        const end = target === 'bottom' ? document.documentElement.scrollHeight - innerHeight : target;
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / duration);
          window.scrollTo(0, start + (end - start) * (0.5 - Math.cos(Math.PI * k) / 2));
          if (k < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [to, ms],
  );
}

const { server, url } = await startServer(0);

// ---------- scene 1: the fill, recorded ----------
{
  const { context, sw } = await launchWithExtension({ video: VIDEO_DIR, viewport: { width: 1280, height: 800 } });
  await loadProfile(sw, persona);
  await sw.evaluate(async () => self.__ditto.warmup());
  const page = await context.newPage();
  const t0 = Date.now();
  const pageUrl = `${url}/forms/bank.html`;
  await page.goto(pageUrl);
  await page.waitForLoadState('networkidle');
  await sleep(2000);
  const tabId = await tabIdFor(sw, pageUrl);
  await page.evaluate((speed) => {
    const b = document.createElement('div');
    b.id = 'speed-badge';
    b.textContent = `\u25B6\u25B6 ${speed}\u00D7 speed: Gemma 4 E4B on a laptop CPU`;
    b.style.cssText = 'position:fixed;left:16px;top:52px;z-index:2147483646;background:#111827;color:#fff;font:600 13px system-ui;padding:6px 10px;border-radius:8px;opacity:.9';
    document.body.appendChild(b);
  }, SPEED);
  const a = (Date.now() - t0) / 1000;
  await sw.evaluate(async (id) => self.__ditto.runOnTab(id, 'fill'), tabId);
  await waitState(page, ['done', 'error']);
  const b = (Date.now() - t0) / 1000;
  await page.evaluate(() => document.getElementById('speed-badge').remove());
  await sleep(2500);
  await smoothScroll(page, 'bottom', 3500);
  await sleep(3000);
  const video = page.video();
  await page.close();
  await context.close();
  const webm = await video.path();
  console.log(`recorded ${webm} (fill from ${a.toFixed(1)}s to ${b.toFixed(1)}s)`);

  const segments =
    `[0:v]trim=0:${a.toFixed(2)},setpts=PTS-STARTPTS[v0];` +
    `[0:v]trim=${a.toFixed(2)}:${b.toFixed(2)},setpts=(PTS-STARTPTS)/${SPEED}[v1];` +
    `[0:v]trim=${b.toFixed(2)},setpts=PTS-STARTPTS[v2];` +
    `[v0][v1][v2]concat=n=3:v=1:a=0`;
  const mp4 = path.join(OUT, 'demo.mp4');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', webm, '-filter_complex', `${segments},fps=30,format=yuv420p[v]`, '-map', '[v]', '-c:v', 'libx264', '-crf', '23', '-movflags', '+faststart', mp4]);
  const gif = path.join(OUT, 'demo.gif');
  execFileSync(ffmpeg, [
    '-y', '-loglevel', 'error', '-i', webm, '-filter_complex',
    `${segments},fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    gif,
  ]);
  console.log(`demo.mp4 ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB, demo.gif ${(fs.statSync(gif).size / 1e6).toFixed(1)} MB`);
}

// ---------- scene 2: the learning loop, as screenshots ----------
{
  const REMOVE = ['Blood group', 'Allergies', 'Emergency contact phone'];
  const { context, sw } = await launchWithExtension({ viewport: { width: 1280, height: 800 } });
  await loadProfile(sw, { ...persona, facts: persona.facts.filter((f) => !REMOVE.includes(f.key)) });
  const clinic = await context.newPage();
  const clinicUrl = `${url}/forms/clinic.html`;
  await clinic.goto(clinicUrl);
  const clinicTab = await tabIdFor(sw, clinicUrl);
  await sw.evaluate(async (id) => self.__ditto.runOnTab(id, 'fill'), clinicTab);
  await waitState(clinic, ['done', 'error']);
  await clinic.screenshot({ path: path.join(SHOTS, 'learn-1-gaps.png') });

  await clinic.selectOption('[name=bloodGroup]', 'B+');
  await clinic.fill('[name=allergies]', 'Penicillin');
  await clinic.fill('[name=ecPhone]', '+91 98400 67890');
  await clinic.locator('[data-ditto-ui] [data-action="remember"]').click();
  await waitState(clinic, ['review', 'error']);
  await clinic.screenshot({ path: path.join(SHOTS, 'learn-2-review.png') });
  await clinic.locator('[data-ditto-ui] [data-action="save-learn"]').click();
  await waitState(clinic, ['learned', 'error']);
  await clinic.screenshot({ path: path.join(SHOTS, 'learn-3-saved.png') });

  const hack = await context.newPage();
  const hackUrl = `${url}/forms/hackathon.html`;
  await hack.goto(hackUrl);
  const hackTab = await tabIdFor(sw, hackUrl);
  await sw.evaluate(async (id) => self.__ditto.runOnTab(id, 'fill'), hackTab);
  await waitState(hack, ['done', 'error']);
  await hack.evaluate(() => document.querySelector('[name=diet]').scrollIntoView({ block: 'center' }));
  await sleep(400);
  await hack.screenshot({ path: path.join(SHOTS, 'learn-4-next-form.png') });
  await context.close();
  console.log('learning-loop screenshots saved');
}
server.close();
