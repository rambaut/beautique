import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const FASTA = 'examples/data/YFV.fasta';
const CLI = 'packages/cli/dist/beautique.js';

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

test('start from a built-in template and answer only what it asks for', async ({ page }) => {
  const problems = watchConsole(page);
  const main = page.getByRole('main');
  const steps = page.getByRole('navigation').getByRole('listitem');
  const preview = page.getByLabel('XML preview').locator('pre');
  const dir = mkdtempSync(join(tmpdir(), 'beautique-e2e-'));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Template', level: 1 })).toBeVisible();
  await expect(steps).toHaveCount(15);
  if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, 'template-chooser.png') });

  // choosing a template leaves four steps, and says what the template is
  await main.getByRole('button', { name: /^Population history \(skygrid\)/ }).click();
  await expect(page.getByRole('heading', { name: 'Data', level: 1 })).toBeVisible();
  await expect(steps).toHaveText([/^Template/, /^Data/, /^Settings/, /^Generate/]);
  await expect(main.getByText(/uncorrelated lognormal relaxed clock and a Bayesian skygrid/)).toBeVisible();
  await page.locator('.dropzone input[type=file]').setInputFiles(FASTA);
  await expect(page.getByText('71 taxa in total')).toBeVisible();
  await expect(page.locator('.doc-name')).toHaveText('YFV');

  // the settings it asks for, and no others
  await go(page, 'Settings');
  await expect(main.locator('.field > label')).toHaveText([
    'Analysis name',
    'Number of population sizes',
    'Time of the last grid point',
    'Chain length',
  ]);
  await page.getByLabel('Number of population sizes').fill('1');
  await expect(page.getByRole('navigation').getByRole('button', { name: /^Settings/ }).getByTitle('Problems to fix')).toHaveText('1');
  await page.getByLabel('Number of population sizes').fill('20');
  await page.getByLabel('Chain length').fill('2000');
  await page.getByLabel('Analysis name').fill('YFV_skygrid');
  await expect(page.getByRole('navigation').getByTitle('Problems to fix')).toHaveCount(0);
  await expect(preview).toContainText('<gtrModel id="gtr">');
  await expect(preview).toContainText('<discretizedBranchRates id="branchRates">');
  await expect(preview).toContainText('<parameter id="skygrid.logPopSize" dimension="20"');
  if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, 'template-settings.png') });

  // the same template and answers on the command line give the same file
  await go(page, 'Generate');
  const fromApp = join(dir, 'app.xml');
  const fromCli = join(dir, 'cli.xml');
  await saveDownload(page, 'Download YFV_skygrid.xml', fromApp);
  execFileSync(
    'node',
    [CLI, 'generate', '-t', 'skygrid-relaxed', '-d', FASTA, '-n', 'YFV_skygrid', '-s', 'models.treePrior.gridPoints=20', '-s', 'mcmc.chainLength=2000', '-o', fromCli],
    { stdio: 'pipe' },
  );
  expect(readFileSync(fromCli, 'utf8')).toBe(readFileSync(fromApp, 'utf8'));

  // everything the template decided can still be seen and changed
  await page.getByRole('button', { name: 'Show all steps' }).click();
  await expect(steps).toHaveCount(15);
  await go(page, 'Clock');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('clock.uncorrelated');

  // another template takes over the data that is loaded
  await go(page, 'Template');
  await main.getByRole('button', { name: /^Outbreak growth rate/ }).click();
  await expect(page.getByText('71 taxa in total')).toBeVisible();
  await expect(preview).toContainText('<exponentialGrowth id="exponential"');
  await expect(preview).not.toContainText('gmrfSkyGridLikelihood');

  // a problem with something the template fixed leads to the step where it can be put right
  await main.getByRole('button', { name: 'show all steps' }).click();
  await go(page, 'Template');
  await main.getByRole('button', { name: /^Discrete phylogeography/ }).click();
  await expect(main.getByText('Trait "location" (discrete) from field 2 of the taxon labels, split on "|"')).toBeVisible();
  await go(page, 'Generate');
  await main.getByRole('button', { name: /^No date could be read from 71 of 71 taxon labels/ }).click();
  await expect(page.getByRole('heading', { name: 'Samples and dates', level: 1 })).toBeVisible();
  await expect(steps).toHaveCount(15);

  expect(problems).toEqual([]);
});

test('load a module file, save the design as a template and use the template', async ({ page }) => {
  const problems = watchConsole(page);
  const main = page.getByRole('main');
  const preview = page.getByLabel('XML preview').locator('pre');
  const dir = mkdtempSync(join(tmpdir(), 'beautique-e2e-'));
  const template = join(dir, 'tn93.template.json');

  await page.goto('/');
  // a file that is not a module is refused with a reason
  await page.getByLabel('Load module files').setInputFiles({ name: 'broken.js', mimeType: 'text/javascript', buffer: Buffer.from('export const x = 1;') });
  await expect(main.getByRole('alert')).toContainText('broken.js: Not a BEAUtique module file');
  await page.getByLabel('Load module files').setInputFiles('examples/modules/tn93.module.js');
  await expect(main.getByRole('row', { name: /TN93 substitution\.tn93 Substitution model tn93\.module\.js/ })).toBeVisible();
  await expect(main.getByRole('alert')).toHaveCount(0);

  await main.getByRole('button', { name: 'Design the analysis step by step' }).click();
  await page.locator('.dropzone input[type=file]').setInputFiles(FASTA);
  await expect(page.getByText('71 taxa in total')).toBeVisible();
  await go(page, 'Substitution');
  await page.getByLabel('Model', { exact: true }).selectOption('substitution.tn93');
  await expect(preview).toContainText('<TN93Model id="tn93">');
  await page.getByLabel('Start both transition rates at the same value').uncheck();
  await page.getByLabel('Initial C-T transition rate').fill('3.5');
  await expect(preview).toContainText('<parameter id="kappa2" value="3.5" lower="0"/>');
  await go(page, 'MCMC');
  await page.getByLabel('Chain length').fill('2000');

  // the design, without the data, with one more setting to ask for
  await go(page, 'Save as template');
  await page.getByLabel('What the template is for').fill('TN93 with a strict clock, for testing.');
  await expect(page.getByLabel('Ask for Analysis name')).toBeChecked();
  await page.getByLabel('Ask for Base frequencies').check();
  if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, 'template-save.png') });
  await saveDownload(page, 'Download YFV.template.json', template);
  const saved = JSON.parse(readFileSync(template, 'utf8'));
  expect(saved.kind).toBe('template');
  expect(saved.name).toBe('analysis');
  expect(saved.data.alignments).toEqual([]);
  expect(saved.partitions).toMatchObject([{ alignment: null, name: '' }]);
  expect(saved.template).toEqual({
    description: 'TN93 with a strict clock, for testing.',
    ask: ['name', 'mcmc.chainLength', 'models.substitution.frequencies'],
  });

  // used again: it asks for those three settings and keeps the rest
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Open a template file').setInputFiles(template);
  await expect(main.getByText('TN93 with a strict clock, for testing.')).toBeVisible();
  await page.locator('.dropzone input[type=file]').setInputFiles(FASTA);
  await go(page, 'Settings');
  await expect(main.locator('.field > label')).toHaveText(['Analysis name', 'Base frequencies', 'Chain length']);
  await expect(page.getByLabel('Chain length')).toHaveValue('2000');
  await page.getByLabel('Base frequencies').selectOption('equal');
  await expect(preview).toContainText('<parameter id="kappa2" value="3.5" lower="0"/>');
  await expect(preview).not.toContainText('<deltaExchange');

  await go(page, 'Generate');
  const fromApp = join(dir, 'app.xml');
  const fromCli = join(dir, 'cli.xml');
  await saveDownload(page, 'Download YFV.xml', fromApp);
  execFileSync(
    'node',
    [CLI, 'generate', '-m', 'examples/modules/tn93.module.js', '-t', template, '-d', FASTA, '-s', 'models.substitution.frequencies=equal', '-o', fromCli],
    { stdio: 'pipe' },
  );
  expect(readFileSync(fromCli, 'utf8')).toBe(readFileSync(fromApp, 'utf8'));

  expect(problems).toEqual([]);
});
