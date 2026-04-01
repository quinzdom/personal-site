import fs from 'node:fs/promises';
import path from 'node:path';

const workspaceDir = process.cwd();
const outputFile = path.join(workspaceDir, 'likes_data.js');
const defaultCsvPath = path.join(workspaceDir, 'data-source', 'letterboxd', 'likes', 'films.csv');

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  const [headerLine, ...rowLines] = lines;
  const headers = parseCsvLine(headerLine);

  return rowLines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function serialize(ids) {
  const lines = ids.map((id) => `  ${JSON.stringify(id)},`);
  return `const likedMovieIds = new Set([\n${lines.join('\n')}\n]);\n`;
}

async function main() {
  const csvPath = process.argv[2] || defaultCsvPath;
  const text = await fs.readFile(csvPath, 'utf8');
  const rows = parseCsv(text);
  const ids = [...new Set(
    rows
      .map((row) => row['Letterboxd URI'] || '')
      .filter(Boolean)
      .map((uri) => `lb-${uri}`)
      .sort()
  )];

  await fs.writeFile(outputFile, serialize(ids));
  console.log(JSON.stringify({ likedMovies: ids.length, outputFile }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
