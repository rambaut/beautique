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

const FASTA = 'examples/data/YFV.fasta';
const METADATA = 'examples/data/YFV_metadata.tsv';

test('load metadata, take dates from it, and add discrete and continuous traits', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  const main = page.getByRole('main');
  const preview = page.getByLabel('XML preview').locator('pre');
  const shot = async (name: string): Promise<void> => {
    if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, `${name}.png`) });
  };

  await page.goto('/');
  await page.locator('.dropzone input[type=file]').setInputFiles([FASTA, METADATA]);
  await expect(page.getByText('71 taxa in total')).toBeVisible();
  const table = main.getByRole('row', { name: /^YFV_metadata/ });
  await expect(table).toContainText('71');
  await expect(page.getByLabel('Taxon column of YFV_metadata')).toHaveValue('0');
  await shot('metadata');

  // dates from a metadata column give the same dates as the labels
  await go(page, 'Samples and dates');
  await page.getByLabel('Tip dates').selectOption('column');
  await expect(main.getByText('Choose the metadata column that holds the sampling dates')).toHaveCount(0);
  await page.getByLabel('Date column').selectOption({ label: 'year (YFV_metadata)' });
  await expect(page.getByText('71 of 71 taxa dated, from 1940.000 to 2009.000')).toBeVisible();

  // a discrete trait from a metadata column
  await go(page, 'Traits');
  await page.getByRole('button', { name: 'New trait' }).click();
  await expect(main.getByText('The trait needs to be told where its values come from')).toBeVisible();
  await expect(page.getByRole('navigation').getByTitle('Problems to fix')).toHaveText('1');
  await page.getByLabel('Name').fill('country');
  await page.getByLabel('Values').selectOption({ label: 'country (YFV_metadata; e.g. Trinidad)' });
  await expect(main.getByText('18 states among 71 taxa')).toBeVisible();
  await expect(main.getByRole('row', { name: 'Brazil 21' })).toBeVisible();
  await expect(preview).toContainText('<generalDataType id="country.dataType">');
  await expect(preview).toContainText('<parameter id="country.rates" dimension="153" value="1" lower="0"/>');
  await page.getByLabel('Rates between states').selectOption('asymmetric');
  await expect(preview).toContainText('<parameter id="country.rates" dimension="306" value="1" lower="0"/>');
  await page.getByLabel('Count the changes of state').check();
  await expect(preview).toContainText('<markovJumpsTreeLikelihood id="country.treeLikelihood"');
  await shot('trait-discrete');

  // a continuous trait: choosing numbers makes it continuous, and a second value can be added
  await page.getByRole('button', { name: 'New trait' }).click();
  await page.getByLabel('Name').fill('country');
  await expect(main.getByText('The trait has the same name as another')).toBeVisible();
  await page.getByLabel('Name').fill('location');
  await page.getByLabel('Values').selectOption({ label: 'latitude (YFV_metadata; e.g. 10.4)' });
  await expect(page.getByLabel('Type')).toHaveValue('continuous');
  await page.getByLabel('Second value (longitude)').selectOption({ label: 'longitude (YFV_metadata; e.g. -61.3)' });
  await expect(main.getByRole('row', { name: '2 -80.1 40.5' })).toBeVisible();
  await page.getByLabel('The values are latitude and longitude').check();
  await expect(preview).toContainText('<traitDataLikelihood id="location.traitLikelihood" traitName="location"');
  await expect(preview).toContainText('displacementScheme="greatCircleDistance"');
  await expect(preview).toContainText(/<attr name="location">\s*10.4 -61.3\s*<\/attr>/);
  await shot('trait-continuous');

  await go(page, 'Priors');
  await expect(main.getByText('country.clock.rate')).toBeVisible();
  await go(page, 'MCMC');
  await page.getByLabel('Chain length').fill('2000');
  await page.getByLabel('Analysis name').fill('YFV_m4');
  await expect(page.getByRole('navigation').getByTitle('Problems to fix')).toHaveCount(0);

  // the project keeps the metadata: the CLI and a reopened project give the same XML
  await go(page, 'Generate');
  const dir = mkdtempSync(join(tmpdir(), 'beautique-e2e-'));
  const fromApp = join(dir, 'app.xml');
  const project = join(dir, 'project.json');
  const fromCli = join(dir, 'cli.xml');
  const reopened = join(dir, 'reopened.xml');
  await saveDownload(page, 'Download YFV_m4.xml', fromApp);
  await saveDownload(page, 'Save project', project);
  execFileSync('node', ['packages/cli/dist/beautique.js', 'generate', '-t', project, '-o', fromCli], { stdio: 'pipe' });
  expect(readFileSync(fromCli, 'utf8')).toBe(readFileSync(fromApp, 'utf8'));

  await page.getByRole('button', { name: 'New' }).click();
  await page.locator('header input[type=file]').setInputFiles(project);
  await go(page, 'Traits');
  await expect(main.getByRole('row', { name: /^location continuous Continuous phylogeography/ })).toBeVisible();
  await go(page, 'Generate');
  await saveDownload(page, 'Download YFV_m4.xml', reopened);
  expect(readFileSync(reopened, 'utf8')).toBe(readFileSync(fromApp, 'utf8'));
  if (process.env.SHOTS) copyFileSync(fromApp, join(process.env.SHOTS, 'YFV_m4.xml'));

  expect(problems).toEqual([]);
});
