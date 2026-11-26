import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const FASTA = 'examples/data/YFV.fasta';

test('import a FASTA file, adjust settings and download the XML', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Data', level: 1 })).toBeVisible();
  await expect(page.getByLabel('XML preview').getByText('No sequence data has been loaded')).toBeVisible();

  await page.locator('input[type=file]').setInputFiles(FASTA);
  await expect(page.getByText('71 taxa in total')).toBeVisible();
  await expect(page.locator('.doc-name')).toHaveText('YFV');

  await page.getByRole('button', { name: 'Samples and dates' }).click();
  await expect(page.getByText('71 of 71 taxa dated, from 1940.000 to 2009.000')).toBeVisible();

  // a conditional field appears only when its condition holds, and is validated
  await page.getByRole('button', { name: 'Clock' }).click();
  await expect(page.getByLabel('Fixed rate')).toHaveCount(0);
  await page.getByLabel('Clock rate').selectOption('fixed');
  await page.getByLabel('Fixed rate').fill('0');
  await expect(page.getByRole('main').getByText('Fixed rate must be greater than 0')).toBeVisible();
  await expect(page.getByRole('navigation').getByTitle('Problems to fix')).toHaveText('1');
  await page.getByLabel('Clock rate').selectOption('auto');
  await expect(page.getByRole('navigation').getByTitle('Problems to fix')).toHaveCount(0);

  await page.getByRole('button', { name: 'MCMC' }).click();
  await page.getByLabel('Chain length').fill('20000');
  await expect(page.getByLabel('XML preview').locator('pre')).toContainText('chainLength="20000"');

  await page.getByRole('button', { name: 'Generate' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download YFV.xml' }).click();
  const download = await downloading;
  const dir = mkdtempSync(join(tmpdir(), 'beautique-e2e-'));
  const fromApp = join(dir, 'app.xml');
  await download.saveAs(fromApp);

  // the CLI must produce exactly the same file for the same choices
  const fromCli = join(dir, 'cli.xml');
  execFileSync('node', ['packages/cli/dist/beautique.js', 'generate', '-f', FASTA, '-s', 'mcmc.chainLength=20000', '-o', fromCli]);
  expect(readFileSync(fromApp, 'utf8')).toBe(readFileSync(fromCli, 'utf8'));

  await page.screenshot({ path: 'out/app-generate.png' });
  await page.getByRole('button', { name: 'Substitution' }).click();
  await page.screenshot({ path: 'out/app-substitution.png' });
  expect(problems).toEqual([]);
});
