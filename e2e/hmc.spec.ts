import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function go(page: Page, step: string): Promise<void> {
  await page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${step}`) }).click();
}

async function saveDownload(page: Page, button: string, path: string): Promise<void> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  await (await downloading).saveAs(path);
}

test('switch on Hamiltonian Monte Carlo operators for the models that have them', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  const main = page.getByRole('main');
  const preview = page.getByLabel('XML preview').locator('pre');

  await page.goto('/');
  await go(page, 'Data');
  await page.locator('.dropzone input[type=file]').setInputFiles('examples/data/YFV.fasta');
  await expect(page.getByText('71 taxa in total')).toBeVisible();

  // nothing in the default analysis has gradient-based operators
  await go(page, 'MCMC');
  await expect(main.getByText('No model in this analysis has gradient-based operators.')).toBeVisible();

  await go(page, 'Clock');
  await page.getByLabel('Model', { exact: true }).selectOption('clock.uncorrelated');
  await go(page, 'Tree prior');
  await main
    .locator('section.card')
    .filter({ has: page.getByRole('heading', { name: 'Tree prior', exact: true }) })
    .getByLabel('Model', { exact: true })
    .selectOption('treePrior.skygrid');
  await page.getByLabel('Number of population sizes').fill('20');

  await go(page, 'MCMC');
  await expect(main.getByText(/Models in this analysis with gradient-based operators: .*Uncorrelated relaxed clock/)).toBeVisible();
  await expect(preview).toContainText('<discretizedBranchRates id="branchRates">');
  await page.getByLabel('Operators').selectOption('hmc');
  await expect(main.getByText('HMC(branchRates.rates)')).toBeVisible();
  await expect(main.getByText('HMC(skygrid.logPopSize, skygrid.precision)')).toBeVisible();
  await expect(preview).toContainText('<arbitraryBranchRates id="branchRates" centerAtOne="false">');
  await expect(preview).toContainText('usePreOrder="true"');
  await expect(preview).toContainText('<gammaPrior id="skygrid.precision.prior"');
  if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, 'hmc.png') });

  // the step size is the tuning value in the operators table, and an HMC operator can be switched off
  await go(page, 'Operators');
  await expect(main.getByRole('row', { name: /HMC\(branchRates\.rates\)/ })).toBeVisible();
  await page.getByLabel('Use HMC(skygrid.logPopSize, skygrid.precision)').uncheck();
  await expect(preview).not.toContainText('full.skygrid.gradient');
  await page.getByLabel('Use HMC(skygrid.logPopSize, skygrid.precision)').check();
  await expect(preview).toContainText('full.skygrid.gradient');

  await go(page, 'MCMC');
  await page.getByLabel('Chain length').fill('2000');
  await page.getByLabel('Analysis name').fill('YFV_hmc');
  await expect(page.getByRole('navigation').getByTitle('Problems to fix')).toHaveCount(0);

  await go(page, 'Generate');
  const dir = mkdtempSync(join(tmpdir(), 'beautique-e2e-'));
  const fromApp = join(dir, 'app.xml');
  const project = join(dir, 'project.json');
  const fromCli = join(dir, 'cli.xml');
  await saveDownload(page, 'Download YFV_hmc.xml', fromApp);
  await saveDownload(page, 'Save project', project);
  execFileSync('node', ['packages/cli/dist/beautique.js', 'generate', '-t', project, '-o', fromCli], { stdio: 'pipe' });
  expect(readFileSync(fromCli, 'utf8')).toBe(readFileSync(fromApp, 'utf8'));
  if (process.env.SHOTS) copyFileSync(fromApp, join(process.env.SHOTS, 'YFV_hmc.xml'));

  expect(problems).toEqual([]);
});
