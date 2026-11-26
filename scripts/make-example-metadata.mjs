#!/usr/bin/env node
/**
 * Writes examples/data/YFV_metadata.tsv from the taxon labels of YFV.fasta:
 * the year, the country, and the approximate coordinates of the country (its
 * centre, which is all the labels can tell us). Run once; the output is kept in the repository.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CENTRES = {
  Angola: [-12.3, 17.5],
  Bolivia: [-16.7, -64.7],
  Brazil: [-10.8, -52.9],
  BurkinaFaso: [12.3, -1.6],
  CentralAfricanRepublic: [6.6, 20.9],
  Colombia: [3.9, -73.1],
  Ecuador: [-1.4, -78.4],
  Ethiopia: [9.1, 40.5],
  Kenya: [0.2, 37.9],
  Nigeria: [9.1, 8.7],
  Panama: [8.5, -80.1],
  Peru: [-9.2, -75.0],
  RepublicofCongo: [-0.7, 15.2],
  Senegal: [14.5, -14.5],
  Sudan: [15.6, 30.2],
  Trinidad: [10.4, -61.3],
  Uganda: [1.4, 32.3],
  Venezuela: [7.1, -66.2],
};

const labels = readFileSync('examples/data/YFV.fasta', 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('>'))
  .map((line) => line.slice(1).trim());

const rows = labels.map((label) => {
  const year = label.split('_')[0];
  // one label gives the Central African Republic as "AfricanRepublic"
  const country = Object.keys(CENTRES).find((name) => label.endsWith(name) || name.endsWith(label.split('_').pop()));
  if (!country) throw new Error(`No country found in ${label}`);
  const [latitude, longitude] = CENTRES[country];
  return [label, year, country, latitude, longitude].join('\t');
});

writeFileSync('examples/data/YFV_metadata.tsv', ['taxon\tyear\tcountry\tlatitude\tlongitude', ...rows].join('\n') + '\n');
console.log(`Wrote ${rows.length} rows`);
