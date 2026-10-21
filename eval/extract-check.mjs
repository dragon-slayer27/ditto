// Model-free check that runs in CI: loads the real extension in Chromium and verifies that field
// extraction on every demo form finds the right fields, labels, sections and skip rules.
import { startServer } from '../scripts/serve.mjs';
import { launchWithExtension, tabIdFor } from './harness.mjs';

const EXPECT = {
  job: { count: 28, has: [['Legal first name', 'My information'], ['Notice period', 'Experience']], skips: { 'Why do you want to work at Northwind?': 'essay' } },
  bank: { count: 26, has: [["Applicant's Full Name", '1. PERSONAL DETAILS'], ['Name', '4. NOMINATION (Nominee details)'], ['Aadhaar No. (last 4 digits only)', '1. PERSONAL DETAILS']], skips: {} },
  clinic: { count: 23, has: [['Phone', 'Patient details'], ['Phone', 'Emergency contact'], ['Do you have any of these conditions?', 'Medical history']], skips: { "Reason for today's visit": 'essay' } },
  rental: { count: 18, has: [['Full name', 'About you'], ['Food preference', 'Household'], ['Pets', 'Household']], skips: { 'Anything else we should know?': 'essay' } },
  hackathon: { count: 19, has: [['T-shirt size', 'Logistics'], ['You are a...', 'You']], skips: { 'I agree to the HackSloth Code of Conduct': 'consent', 'Subscribe me to the HackSloth newsletter': 'consent' } },
};

const { server, url } = await startServer(0);
const { context, sw } = await launchWithExtension();
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};
try {
  for (const [name, exp] of Object.entries(EXPECT)) {
    const page = await context.newPage();
    const pageUrl = `${url}/forms/${name}.html`;
    await page.goto(pageUrl);
    await page.waitForLoadState('networkidle');
    const tabId = await tabIdFor(sw, pageUrl);
    await sw.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['lib/text.js', 'content/extract.js'] }), tabId);
    const [{ result }] = await sw.evaluate(
      async (id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => globalThis.Ditto.extract.extractFields().fields }),
      tabId,
    );
    console.log(`${name}: ${result.length} fields`);
    if (result.length !== exp.count) fail(`${name}: expected ${exp.count} fields, got ${result.length}`);
    for (const [label, section] of exp.has) {
      if (!result.some((f) => f.label === label && f.section === section)) fail(`${name}: no field "${label}" in section "${section}"`);
    }
    for (const [label, reason] of Object.entries(exp.skips)) {
      const f = result.find((x) => x.label === label);
      if (!f || f.skip !== reason) fail(`${name}: "${label}" should be skipped as ${reason}, got ${f ? f.skip || 'not skipped' : 'missing'}`);
    }
    await page.close();
  }
} finally {
  await context.close();
  server.close();
}
console.log(failures ? `${failures} problem(s)` : 'Extraction looks right on every demo form.');
process.exit(failures ? 1 : 0);
