import * as toml from 'toml';
import * as path from 'path';
import * as fs from 'fs';

const config = toml.parse(fs.readFileSync('./config.toml', 'utf8'));

console.log(config.topPage);
console.log(config.pdfKeywords);
console.log(config.projectTitle);