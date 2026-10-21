// Demonstrates the learning loop end to end:
// 1) remove three facts from the persona, 2) fill the clinic form (those fields stay empty),
// 3) type them by hand, 4) "Remember what I typed", 5) a different form now fills them automatically.
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../scripts/serve.mjs';
import { ROOT, launchWithExtension, loadProfile, tabIdFor } from './harness.mjs';

const REMOVE = ['Blood group', 'Allergies', 'Emergency contact phone'];
const persona = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'demo', 'meera.json'), 'utf8'));
const trimmed = { ...persona, facts: persona.facts.filter((f) => !REMOVE.includes(f.key)) };

const waitState = (page, states) =>
  page.waitForFunction((s) => s.includes(document.documentElement.dataset.dittoState), states, { timeout: 15 * 60 * 1000, polling: 250 });

const { server, url } = await startServer(0);
const { context, sw } = await launchWithExtension();
try {
  await loadProfile(sw, trimmed);
  console.log(`Profile starts with ${trimmed.facts.length} facts (removed: ${REMOVE.join(', ')})`);

  const clinic = await context.newPage();
  const clinicUrl = `${url}/forms/clinic.html`;
  await clinic.goto(clinicUrl);
  const clinicTab = await tabIdFor(sw, clinicUrl);
  await sw.evaluate(async (id) => self.__ditto.runOnTab(id, 'fill'), clinicTab);
  await waitState(clinic, ['done', 'error']);
  const before = await clinic.evaluate(() => ({
    blood: document.querySelector('[name=bloodGroup]').value,
    allergies: document.querySelector('[name=allergies]').value,
    ecPhone: document.querySelector('[name=ecPhone]').value,
  }));
  console.log('Clinic form after Ditto (should be empty):', before);

  // The person fills the gaps by hand.
  await clinic.selectOption('[name=bloodGroup]', 'B+');
  await clinic.fill('[name=allergies]', 'Penicillin');
  await clinic.fill('[name=ecPhone]', '+91 98400 67890');
  await clinic.fill('[name=reason]', 'Follow-up for a cough');

  const t0 = Date.now();
  await sw.evaluate(async (id) => self.__ditto.runOnTab(id, 'learn'), clinicTab);
  await waitState(clinic, ['review', 'error']);
  const proposals = await clinic.evaluate(() =>
    [...document.querySelector('[data-ditto-ui]').shadowRoot.querySelectorAll('label.change')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()),
  );
  console.log(`Ditto proposed (${((Date.now() - t0) / 1000).toFixed(1)} s):`);
  proposals.forEach((p) => console.log(`  - ${p}`));
  await clinic.evaluate(() => document.querySelector('[data-ditto-ui]').shadowRoot.querySelector('[data-action="save-learn"]').click());
  await waitState(clinic, ['learned', 'error']);
  const profile = await sw.evaluate(async () => (await chrome.storage.local.get('profile')).profile);
  const learned = profile.facts.filter((f) => !trimmed.facts.some((t) => t.key === f.key));
  console.log(`Profile now has ${profile.facts.length} facts. New:`, learned.map((f) => `${f.key}: ${f.value}`));

  const hack = await context.newPage();
  const hackUrl = `${url}/forms/hackathon.html`;
  await hack.goto(hackUrl);
  const hackTab = await tabIdFor(sw, hackUrl);
  await sw.evaluate(async (id) => self.__ditto.runOnTab(id, 'fill'), hackTab);
  await waitState(hack, ['done', 'error']);
  const after = await hack.evaluate(() => ({
    allergies: document.querySelector('[name=allergies]').value,
    ecPhone: document.querySelector('[name=ecPhone]').value,
  }));
  console.log('Hackathon form, filled with what Ditto just learned:', after);

  await clinic.close();
  const fresh = await context.newPage();
  await fresh.goto(clinicUrl);
  const freshTab = await tabIdFor(sw, clinicUrl);
  const t1 = Date.now();
  await sw.evaluate(async (id) => self.__ditto.runOnTab(id, 'fill'), freshTab);
  await waitState(fresh, ['done', 'error']);
  const again = await fresh.evaluate(() => ({
    blood: document.querySelector('[name=bloodGroup]').value,
    allergies: document.querySelector('[name=allergies]').value,
    ecPhone: document.querySelector('[name=ecPhone]').value,
    reason: document.querySelector('[name=reason]').value,
    stats: JSON.parse(document.getElementById('ditto-log').textContent).stats,
  }));
  console.log(`Clinic form again in a fresh tab (${((Date.now() - t1) / 1000).toFixed(1)} s):`, again);
} finally {
  await context.close();
  server.close();
}
