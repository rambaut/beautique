import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  addTrait,
  alignmentFromText,
  assertDocument,
  bindData,
  deriveTaxa,
  generate,
  listSettings,
  looksLikeTable,
  makeTemplate,
  modulesFromExports,
  parseTable,
  parseValueSource,
  setCodonScheme,
  setSetting,
  settingField,
  templateRequirements,
  SLOT_LABELS,
  BEAUTIQUE_VERSION,
  TIME_UNITS,
  type AnalysisDocument,
  type ModuleDefinition,
  type ModuleRegistry,
  type TraitType,
  type TimeUnit,
  type Timeline,
} from '@beautique/core';
import { builtinTemplates, createRegistry, defaultTemplate, findTemplate } from '@beautique/modules';

const USAGE = `BEAUtique v${BEAUTIQUE_VERSION}: generate BEAST X analysis files

Usage:
  beautique generate --data <file> [options]    Write a BEAST XML file
  beautique describe [template] [--set ...]     List a template's settings and what it needs
  beautique templates                           List the built-in templates
  beautique template <project.json> [options]   Make a template from a project file
  beautique modules                             List the available modules

Options for generate:
  -t, --template <name>     A built-in template (see "templates"), or a template or project
                            file (JSON). Default: the template called "default"
  -d, --data <file>         Aligned sequences (FASTA or NEXUS); repeat for several files
      --metadata <file>     A table of metadata about the taxa (CSV or TSV with a header row;
                            the first column identifies the taxon); repeatable
      --discrete-trait <name=source>    Analyse a trait with discrete states. The source is the
                            name of a metadata column, or field:N for the Nth field of the taxon
                            label (field:-1 for the last; field:N:_ to split on "_"); repeatable
      --continuous-trait <name=source,source>   Analyse a continuous trait, with a source for
                            each dimension (latitude,longitude for coordinates); repeatable
      --date-column <name>  Read sampling dates from this metadata column
      --codon <scheme>      Partition by codon position: 12+3 or 1+2+3
  -o, --output <file>       Output file. Default: <name>.xml
  -n, --name <name>         Analysis name (stem of BEAST's output files)
      --taxon-set <name=pattern>  Define a taxon set: the taxa whose label matches the regular
                            expression, or name=@file for a file with one taxon per line; repeatable
      --clade <name=pattern>    As --taxon-set, and constrain the set to be a clade of the tree
      --timeline <name=spec>    Define a timeline; repeatable. The spec is one of:
                              12x1months        12 epochs of 1 month (days, weeks, months, years)
                              2020-03-23,2020-11-05   transitions at these dates
                              ago:0.5,1,2       transitions this many years before the last sample
  -s, --set <path=value>    Set a setting; repeatable (see "describe" for paths). Settings that
                            refer to taxon sets or timelines take their names. The model of a
                            trait is models.trait-<name>
      --date-field <n>      Field of the taxon label holding the date (1 = first, -1 = last)
      --date-delimiter <c>  Delimiter that separates label fields for dates
      --no-dates            Do not read dates from taxon labels
  -m, --module <file>       Load an extra module (JavaScript ES module); repeatable

Options for template:
  -o, --output <file>       Output file. Default: <name>.template.json
      --ask <path>          A setting to ask for when the template is used; repeatable
      --description <text>  What the template is for
`;

class UsageError extends Error {}

async function loadRegistry(paths: string[]): Promise<ModuleRegistry> {
  const extra: ModuleDefinition[] = [];
  for (const path of paths) {
    const loaded = await import(pathToFileURL(resolve(path)).href);
    try {
      extra.push(...modulesFromExports(loaded));
    } catch (e) {
      throw new UsageError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return createRegistry(extra);
}

async function loadDocument(path: string | undefined): Promise<AnalysisDocument> {
  if (!path) return defaultTemplate();
  const builtin = existsSync(path) ? undefined : findTemplate(path);
  if (builtin) return builtin.make();
  if (!existsSync(path)) {
    throw new UsageError(`"${path}" is neither a file nor a built-in template (${builtinTemplates.map((t) => t.id).join(', ')})`);
  }
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  assertDocument(parsed);
  return parsed;
}

function describe(doc: AnalysisDocument, registry: ModuleRegistry): string {
  const lines: string[] = [];
  if (doc.template?.description) lines.push(doc.template.description, '');
  const needs = doc.kind === 'template' ? templateRequirements(doc) : [];
  if (needs.length > 0) lines.push('Expects of the data', ...needs.map((n) => `  ${n}`), '');
  let group = '';
  for (const setting of listSettings(doc, registry)) {
    if (setting.group !== group) {
      group = setting.group;
      lines.push(`${group}`);
    }
    const flags = [setting.ask ? 'ask' : null, setting.explicit ? null : 'default'].filter(Boolean).join(', ');
    const choices = setting.field.type === 'choice' ? ` [${setting.field.choices.map((c) => c.value).join('|')}]` : '';
    lines.push(
      `  ${setting.path} = ${String(setting.value)}${flags ? ` (${flags})` : ''}`,
      `      ${setting.field.label}${choices}`,
    );
  }
  return lines.join('\n');
}

function splitAssignment(option: string, text: string): [string, string] {
  const eq = text.indexOf('=');
  if (eq < 1) throw new UsageError(`${option} expects name=value, got "${text}"`);
  return [text.slice(0, eq), text.slice(eq + 1)];
}

async function addTaxonSet(doc: AnalysisDocument, option: string, text: string, monophyletic: boolean): Promise<void> {
  const [name, pattern] = splitAssignment(option, text);
  const taxa = deriveTaxa(doc.data).taxa;
  let keys: string[];
  if (pattern.startsWith('@')) {
    const wanted = new Set(
      (await readFile(pattern.slice(1), 'utf8')).split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== ''),
    );
    keys = taxa.filter((t) => wanted.has(t.key) || wanted.has(t.label) || wanted.has(t.id)).map((t) => t.key);
    if (keys.length < wanted.size) {
      console.error(`Warning: ${wanted.size - keys.length} taxa listed for "${name}" are not in the data`);
    }
  } else {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      throw new UsageError(`${option}: "${pattern}" is not a valid regular expression`);
    }
    keys = taxa.filter((t) => regex.test(t.label)).map((t) => t.key);
  }
  if (keys.length === 0) throw new UsageError(`${option}: no taxa match "${pattern}"`);
  // a set the template already names keeps its id, so that settings referring to it still do
  const existing = (doc.taxonSets ??= []).find((s) => s.name === name);
  if (existing) {
    existing.taxa = keys;
    if (monophyletic) existing.monophyletic = true;
  } else {
    doc.taxonSets.push({ id: `taxonset-${name}`, name, taxa: keys, ...(monophyletic ? { monophyletic: true } : {}) });
  }
}

/** Apply `path=value` settings in order; returns the paths that were set. */
function applySettings(doc: AnalysisDocument, registry: ModuleRegistry, assignments: string[]): string[] {
  return assignments.map((assignment) => {
    const eq = assignment.indexOf('=');
    if (eq < 1) throw new UsageError(`--set expects path=value, got "${assignment}"`);
    setSetting(doc, registry, assignment.slice(0, eq), assignment.slice(eq + 1));
    return assignment.slice(0, eq);
  });
}

function addTraitOption(doc: AnalysisDocument, option: string, text: string, type: TraitType): void {
  const [name, sources] = splitAssignment(option, text);
  doc.traits = (doc.traits ?? []).filter((t) => t.name !== name);
  doc.components = doc.components.filter((c) => c.slot !== 'trait' || (doc.traits ?? []).some((t) => t.model === c.id));
  addTrait(doc, {
    name,
    type,
    sources: (type === 'discrete' ? [sources] : sources.split(',')).map((s) => parseValueSource(s, doc.data)),
    module: type === 'discrete' ? 'trait.discrete' : 'trait.continuous',
  });
}

function addTimeline(doc: AnalysisDocument, text: string): void {
  const [name, spec] = splitAssignment('--timeline', text);
  const base = { id: `timeline-${name}`, name };
  const regular = /^(\d+)x([\d.]+)([a-z]+)$/.exec(spec);
  let timeline: Timeline;
  if (regular) {
    if (!(regular[3] in TIME_UNITS)) throw new UsageError(`--timeline: unknown unit of time "${regular[3]}"`);
    timeline = { ...base, kind: 'regular', epochCount: Number(regular[1]), duration: Number(regular[2]), units: regular[3] as TimeUnit };
  } else if (spec.startsWith('ago:')) {
    timeline = { ...base, kind: 'heights', heights: spec.slice(4).split(',').map(Number) };
  } else {
    timeline = { ...base, kind: 'dates', dates: spec.split(',') };
  }
  doc.timelines = [...(doc.timelines ?? []).filter((t) => t.name !== name), timeline];
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      template: { type: 'string', short: 't' },
      data: { type: 'string', short: 'd', multiple: true },
      // accepted as an alias of --data
      fasta: { type: 'string', short: 'f', multiple: true },
      metadata: { type: 'string', multiple: true },
      'discrete-trait': { type: 'string', multiple: true },
      'continuous-trait': { type: 'string', multiple: true },
      'date-column': { type: 'string' },
      codon: { type: 'string' },
      output: { type: 'string', short: 'o' },
      name: { type: 'string', short: 'n' },
      set: { type: 'string', short: 's', multiple: true },
      'taxon-set': { type: 'string', multiple: true },
      clade: { type: 'string', multiple: true },
      timeline: { type: 'string', multiple: true },
      'date-field': { type: 'string' },
      'date-delimiter': { type: 'string' },
      'no-dates': { type: 'boolean' },
      module: { type: 'string', short: 'm', multiple: true },
      ask: { type: 'string', multiple: true },
      description: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  const command = positionals[0];
  if (values.version) {
    console.log(BEAUTIQUE_VERSION);
    return 0;
  }
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }

  const registry = await loadRegistry(values.module ?? []);

  if (command === 'modules') {
    for (const module of registry.all()) {
      console.log(`${module.id.padEnd(28)} ${SLOT_LABELS[module.slot]}: ${module.label}`);
    }
    return 0;
  }

  if (command === 'templates') {
    for (const template of builtinTemplates) {
      console.log(`${template.id.padEnd(28)} ${template.title}`);
      console.log(`${' '.repeat(28)} ${template.make().template?.description ?? ''}`);
    }
    return 0;
  }

  if (command === 'template') {
    if (!positionals[1]) throw new UsageError('template needs a project file');
    const project = await loadDocument(positionals[1]);
    for (const path of values.ask ?? []) {
      if (!settingField(project, registry, path)) throw new UsageError(`--ask: unknown setting "${path}" (see "describe")`);
    }
    const template = makeTemplate(project, { description: values.description, ask: values.ask });
    if (values.name) template.name = values.name;
    const output = values.output ?? `${project.name}.template.json`;
    await writeFile(output, `${JSON.stringify(template, null, 1)}\n`);
    console.error(`Wrote ${output}: asks for ${template.template?.ask.join(', ') || 'nothing'}`);
    return 0;
  }

  if (command === 'describe') {
    const doc = await loadDocument(positionals[1] ?? values.template);
    applySettings(doc, registry, values.set ?? []);
    console.log(describe(doc, registry));
    return 0;
  }

  if (command !== 'generate') throw new UsageError(`Unknown command "${command}"`);

  const fastaPaths = [...(values.data ?? []), ...(values.fasta ?? [])];
  let doc = await loadDocument(values.template);
  if (fastaPaths.length > 0) {
    const alignments = [];
    for (const [i, path] of fastaPaths.entries()) {
      const name = basename(path, extname(path));
      alignments.push(alignmentFromText(await readFile(path, 'utf8'), `alignment-${i + 1}`, name));
    }
    if (doc.data.alignments.length > 0) {
      throw new UsageError('The project already contains sequence data; --data can only be used with a template');
    }
    if (doc.name === 'analysis' && !values.name) doc.name = alignments[0].name;
    doc = bindData(doc, alignments);
  } else if (doc.data.alignments.length === 0) {
    throw new UsageError('No sequence data: give at least one --data file');
  }

  for (const path of values.metadata ?? []) {
    const content = await readFile(path, 'utf8');
    if (!looksLikeTable(content)) throw new UsageError(`${path} is not a CSV or TSV table`);
    const tables = (doc.data.tables ??= []);
    let n = tables.length + 1;
    while (tables.some((t) => t.id === `table-${n}`)) n++;
    tables.push(parseTable(content, `table-${n}`, basename(path, extname(path))));
  }

  if (values.codon !== undefined) {
    if (values.codon !== '12+3' && values.codon !== '1+2+3') throw new UsageError('--codon must be 12+3 or 1+2+3');
    for (const alignment of doc.data.alignments) setCodonScheme(doc, alignment, values.codon);
  }

  if (values['no-dates']) {
    doc.data.dates = { ...doc.data.dates, mode: 'none' };
  } else if (values['date-column'] !== undefined) {
    const source = parseValueSource(values['date-column'], doc.data);
    if (source.kind !== 'column') throw new UsageError('--date-column takes the name of a metadata column');
    doc.data.dates = { ...doc.data.dates, mode: 'column', table: source.table, column: source.column };
  } else if (values['date-field'] !== undefined) {
    const n = Number(values['date-field']);
    if (!Number.isInteger(n) || n === 0) throw new UsageError('--date-field must be a non-zero whole number');
    doc.data.dates = {
      mode: 'labelField',
      delimiter: values['date-delimiter'] ?? (doc.data.dates.mode === 'none' ? '|' : doc.data.dates.delimiter),
      field: n > 0 ? n - 1 : n,
    };
  } else if (values['date-delimiter'] !== undefined) {
    throw new UsageError('--date-delimiter needs --date-field');
  }

  for (const text of values['taxon-set'] ?? []) await addTaxonSet(doc, '--taxon-set', text, false);
  for (const text of values.clade ?? []) await addTaxonSet(doc, '--clade', text, true);
  for (const text of values.timeline ?? []) addTimeline(doc, text);
  for (const text of values['discrete-trait'] ?? []) addTraitOption(doc, '--discrete-trait', text, 'discrete');
  for (const text of values['continuous-trait'] ?? []) addTraitOption(doc, '--continuous-trait', text, 'continuous');

  if (values.name) setSetting(doc, registry, 'name', values.name);
  const given = new Set<string>([...(values.name ? ['name'] : []), ...applySettings(doc, registry, values.set ?? [])]);

  const unanswered = (values.template && fastaPaths.length > 0 ? (doc.template?.ask ?? []) : []).filter((path) => !given.has(path));
  if (unanswered.length > 0) {
    console.error(`Note: using the template's values for: ${unanswered.join(', ')}`);
  }

  const result = generate(doc, registry);
  for (const issue of result.issues) {
    console.error(`${issue.severity === 'error' ? 'Error' : 'Warning'}: ${issue.message}`);
  }
  if (result.xml === undefined) return 1;

  const output = values.output ?? `${doc.name}.xml`;
  await writeFile(output, result.xml);
  const dated = result.taxa.filter((t) => t.date !== undefined);
  const dates = dated.map((t) => t.date as number);
  console.error(
    `Wrote ${output}: ${result.taxa.length} taxa, ` +
      (dated.length > 0
        ? `tip dates ${Math.min(...dates).toFixed(2)} to ${Math.max(...dates).toFixed(2)}`
        : 'no tip dates'),
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof UsageError || (e as { code?: string })?.code?.startsWith('ERR_PARSE_ARGS')) {
      console.error('Run "beautique --help" for usage.');
    }
    process.exitCode = 1;
  },
);
