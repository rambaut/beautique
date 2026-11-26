import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/** Go to a step using the navigation. */
async function go(page: Page, step: string): Promise<void> {
  await page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${step}`) }).click();
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

async function saveDownload(page: Page, button: string, path: string): Promise<void> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  await (await downloading).saveAs(path);
}

const FASTA = 'examples/data/YFV.fasta';

test('import a FASTA file, adjust settings and download the XML', async ({ page }) => {
  const problems = watchConsole(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Data', level: 1 })).toBeVisible();
  await expect(page.getByLabel('XML preview').getByText('No sequence data has been loaded')).toBeVisible();

  await page.locator('.dropzone input[type=file]').setInputFiles(FASTA);
  await expect(page.getByText('71 taxa in total')).toBeVisible();
  await expect(page.locator('.doc-name')).toHaveText('YFV');

  await go(page, 'Samples and dates');
  await expect(page.getByText('71 of 71 taxa dated, from 1940.000 to 2009.000')).toBeVisible();

  // a conditional field appears only when its condition holds, and is validated
  await go(page, 'Clock');
  await expect(page.getByLabel('Fixed rate')).toHaveCount(0);
  await page.getByLabel('Clock rate').selectOption('fixed');
  await page.getByLabel('Fixed rate').fill('0');
  await expect(page.getByRole('main').getByText('Fixed rate must be greater than 0')).toBeVisible();
  await expect(page.getByRole('navigation').getByTitle('Problems to fix')).toHaveText('1');
  await page.getByLabel('Clock rate').selectOption('auto');
  await expect(page.getByRole('navigation').getByTitle('Problems to fix')).toHaveCount(0);

  await go(page, 'MCMC');
  await page.getByLabel('Chain length').fill('20000');
  await expect(page.getByLabel('XML preview').locator('pre')).toContainText('chainLength="20000"');

  await go(page, 'Generate');
  const dir = mkdtempSync(join(tmpdir(), 'beautique-e2e-'));
  const fromApp = join(dir, 'app.xml');
  await saveDownload(page, 'Download YFV.xml', fromApp);

  // the CLI must produce exactly the same file for the same choices
  const fromCli = join(dir, 'cli.xml');
  execFileSync('node', ['packages/cli/dist/beautique.js', 'generate', '-f', FASTA, '-s', 'mcmc.chainLength=20000', '-o', fromCli]);
  expect(readFileSync(fromApp, 'utf8')).toBe(readFileSync(fromCli, 'utf8'));

  await page.screenshot({ path: 'out/app-generate.png' });
  await go(page, 'Substitution');
  await page.screenshot({ path: 'out/app-substitution.png' });
  expect(problems).toEqual([]);
});

test('partition, choose models, edit priors and operators, then save and reopen the project', async ({ page }) => {
  const problems = watchConsole(page);
  const preview = page.getByLabel('XML preview').locator('pre');
  const main = page.getByRole('main');

  await page.goto('/');
  await page.locator('.dropzone input[type=file]').setInputFiles(FASTA);
  await expect(page.getByText('71 taxa in total')).toBeVisible();

  // codon partitions: 654 sites split 436 / 218, each with its own substitution model
  await go(page, 'Partitions');
  await page.getByLabel('YFV', { exact: true }).selectOption('12+3');
  await expect(main.getByRole('row', { name: /^CP1\+2/ })).toContainText('436');
  await expect(main.getByRole('row', { name: /^CP3/ })).toContainText('218');
  await expect(preview).toContainText('<relativeRate weight="3">');

  // linking CP3 to the other substitution model and separating it again
  await page.getByLabel('Substitution model for CP3').selectOption({ index: 0 });
  await expect(preview).not.toContainText('relativeRate');
  await page.getByLabel('Substitution model for CP3').selectOption('Separate copy');
  await expect(preview).toContainText('id="CP3.kappa"');

  await go(page, 'Substitution');
  await main.locator('section.card', { hasText: 'CP1+2' }).getByLabel('Model', { exact: true }).selectOption('substitution.gtr');
  await expect(preview).toContainText('id="CP1+2.gtr.rates"');
  await main.locator('section.card', { hasText: 'CP3' }).getByLabel('Among-site rate heterogeneity model').selectOption('');
  await expect(preview).not.toContainText('CP3.alpha');

  await go(page, 'Clock');
  await page.getByLabel('Model', { exact: true }).selectOption('clock.uncorrelated');
  await expect(preview).toContainText('id="ucld.stdev"');

  await go(page, 'Tree prior');
  await main.locator('section.card', { hasText: 'Tree prior' }).getByLabel('Model', { exact: true }).selectOption('treePrior.skygrid');
  await page.getByLabel('Number of population sizes').fill('20');
  await expect(preview).toContainText('id="skygrid.logPopSize" dimension="20"');

  // priors: an invalid value is reported, a valid one reaches the XML
  await go(page, 'Priors');
  const sigma = page.getByLabel('sigma of the prior for CP3.kappa');
  await sigma.fill('0');
  await expect(main.getByText('CP3.kappa: Lognormal prior: sigma must be greater than 0')).toBeVisible();
  await expect(page.getByRole('navigation').getByTitle('Problems to fix')).toHaveText('1');
  await sigma.fill('2');
  await expect(preview).toContainText('<logNormalPrior mu="1" sigma="2" offset="0">');
  await page.getByLabel('Prior for ucld.stdev', { exact: true }).selectOption('gamma');
  await page.getByLabel('shape of the prior for ucld.stdev').fill('2');
  await expect(preview).toContainText('<gammaPrior shape="2" scale="1" offset="0">');
  await page.getByLabel('Initial value of ucld.stdev').fill('0.5');
  await expect(preview).toContainText('id="ucld.stdev" value="0.5"');

  await go(page, 'Operators');
  await page.getByLabel('Weight of scale(CP3.kappa)').fill('4');
  await expect(preview).toContainText('<scaleOperator scaleFactor="0.75" weight="4">');
  await page.getByLabel('Use Fixed-height subtree prune and regraft').uncheck();
  await expect(preview).not.toContainText('fixedHeightSubtreePruneRegraft');

  await go(page, 'MCMC');
  await page.getByLabel('Chain length').fill('2000');
  await page.getByLabel('Analysis name').fill('YFV_full');

  await go(page, 'Generate');
  const first = 'out/e2e-full.xml';
  const project = 'out/e2e-full.beautique.json';
  await saveDownload(page, 'Download YFV_full.xml', first);
  await saveDownload(page, 'Save project', project);

  // a reopened project gives exactly the same analysis, in the app and from the CLI
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.locator('label.button input[type=file]').setInputFiles(project);
  await expect(page.locator('.doc-name')).toHaveText('YFV_full');
  await go(page, 'Partitions');
  await expect(main.getByRole('row', { name: /^CP3/ })).toContainText('218');
  await go(page, 'Generate');
  const dir = mkdtempSync(join(tmpdir(), 'beautique-e2e-'));
  const reopened = join(dir, 'reopened.xml');
  await saveDownload(page, 'Download YFV_full.xml', reopened);
  expect(readFileSync(reopened, 'utf8')).toBe(readFileSync(first, 'utf8'));

  const fromCli = join(dir, 'cli.xml');
  execFileSync('node', ['packages/cli/dist/beautique.js', 'generate', '-t', project, '-o', fromCli]);
  expect(readFileSync(fromCli, 'utf8')).toBe(readFileSync(first, 'utf8'));

  await go(page, 'Priors');
  await page.screenshot({ path: 'out/app-priors.png' });
  await go(page, 'Partitions');
  await page.screenshot({ path: 'out/app-partitions.png' });
  expect(problems).toEqual([]);
});
