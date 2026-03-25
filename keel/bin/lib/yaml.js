// yaml.js — Minimal YAML serializer/parser (no external dependencies)
// Covers the subset used by keel state files:
//   strings, numbers, booleans, null, arrays of objects, nested objects
'use strict';

/**
 * Parse a YAML string into a JS value.
 * Supports: scalars, block sequences, block mappings, inline [] and {}.
 * @param {string} text
 * @returns {*}
 */
function parseYaml(text) {
  const lines = text.split('\n');
  const result = parseValue(lines, 0, 0);
  return result.value;
}

/**
 * Serialize a JS value to a YAML string.
 * @param {*} value
 * @returns {string}
 */
function stringifyYaml(value) {
  return serializeValue(value, 0) + '\n';
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a value starting at lines[index], with the given base indent.
 * Returns { value, nextIndex }.
 */
function parseValue(lines, index, baseIndent) {
  // Skip blank lines and comments at this level
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      index++;
      continue;
    }
    break;
  }

  if (index >= lines.length) return { value: null, nextIndex: index };

  const line = lines[index];
  const indent = getIndent(line);
  const trimmed = line.trim();

  // Block sequence entry
  if (trimmed.startsWith('- ') || trimmed === '-') {
    return parseSequence(lines, index, indent);
  }

  // Empty sequence shorthand
  if (trimmed === '[]') {
    return { value: [], nextIndex: index + 1 };
  }

  // Mapping
  if (trimmed.includes(': ') || trimmed.endsWith(':')) {
    return parseMapping(lines, index, indent);
  }

  // Scalar fallback
  return { value: parseScalar(trimmed), nextIndex: index + 1 };
}

function parseSequence(lines, startIndex, baseIndent) {
  const arr = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) { i++; continue; }

    const indent = getIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) break; // unexpected deeper indent without '-'

    if (!trimmed.startsWith('- ') && trimmed !== '-') break;

    const rest = trimmed.slice(2).trim(); // content after '- '

    if (rest === '' || rest === '{}') {
      // Next lines are the object body
      if (rest === '{}') {
        arr.push({});
        i++;
        continue;
      }
      // Empty dash — look ahead for indented mapping
      i++;
      if (i < lines.length) {
        const nextIndent = getIndent(lines[i]);
        if (nextIndent > baseIndent) {
          const parsed = parseMapping(lines, i, nextIndent);
          arr.push(parsed.value);
          i = parsed.nextIndex;
          continue;
        }
      }
      arr.push(null);
      continue;
    }

    // Inline scalar after '- '
    if (!rest.includes(': ') && !rest.endsWith(':')) {
      arr.push(parseScalar(rest));
      i++;
      continue;
    }

    // Inline mapping key on same line as '-': e.g. '- rule: SCOPE-001'
    // Treat the rest as the first key:value, then collect subsequent indented lines
    const itemIndent = baseIndent + 2;
    // Build a synthetic block: the first key is on this line, rest follow
    const syntheticLines = [' '.repeat(itemIndent) + rest];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i];
      const nextTrimmed = nextLine.trim();
      if (nextTrimmed === '' || nextTrimmed.startsWith('#')) { i++; continue; }
      const nextIndent = getIndent(nextLine);
      if (nextIndent <= baseIndent) break;
      syntheticLines.push(nextLine);
      i++;
    }
    const parsed = parseMapping(syntheticLines, 0, itemIndent);
    arr.push(parsed.value);
  }

  return { value: arr, nextIndex: i };
}

function parseMapping(lines, startIndex, baseIndent) {
  const obj = {};
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) { i++; continue; }

    const indent = getIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) break; // continuation handled by caller

    // Must be a key: value line
    const colonIdx = trimmed.indexOf(': ');
    const isTrailingColon = trimmed.endsWith(':') && colonIdx === -1;

    if (colonIdx === -1 && !isTrailingColon) break;

    let key, valueStr;
    if (isTrailingColon) {
      key = trimmed.slice(0, -1).trim();
      valueStr = '';
    } else {
      key = trimmed.slice(0, colonIdx).trim();
      valueStr = trimmed.slice(colonIdx + 2).trim();
    }

    // Unquote key if needed
    key = unquote(key);

    i++;

    if (valueStr === '' || valueStr === null) {
      // Value is on subsequent lines
      if (i < lines.length) {
        const nextLine = lines[i];
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed === '' || nextTrimmed.startsWith('#')) {
          obj[key] = null;
          continue;
        }
        const nextIndent = getIndent(nextLine);
        if (nextIndent > baseIndent) {
          if (nextTrimmed.startsWith('- ') || nextTrimmed === '-') {
            const parsed = parseSequence(lines, i, nextIndent);
            obj[key] = parsed.value;
            i = parsed.nextIndex;
          } else {
            const parsed = parseMapping(lines, i, nextIndent);
            obj[key] = parsed.value;
            i = parsed.nextIndex;
          }
          continue;
        }
      }
      obj[key] = null;
      continue;
    }

    // Inline value
    if (valueStr === '[]') {
      obj[key] = [];
    } else if (valueStr === '{}') {
      obj[key] = {};
    } else if (valueStr.startsWith('[')) {
      obj[key] = parseInlineSequence(valueStr);
    } else {
      obj[key] = parseScalar(valueStr);
    }
  }

  return { value: obj, nextIndex: i };
}

function parseInlineSequence(str) {
  // e.g. "[SCOPE-001, GOAL-001]"
  const inner = str.slice(1, str.lastIndexOf(']')).trim();
  if (inner === '') return [];
  return inner.split(',').map(s => parseScalar(s.trim()));
}

function parseScalar(str) {
  if (str === 'null' || str === '~' || str === '') return null;
  if (str === 'true') return true;
  if (str === 'false') return false;
  // Quoted string
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return unquote(str);
  }
  // Number
  if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);
  return str;
}

function unquote(str) {
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
  }
  return str;
}

function getIndent(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}

// ─── Serializer ──────────────────────────────────────────────────────────────

function serializeValue(value, indent) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return serializeString(value);

  const pad = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map(item => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length === 0) return `${pad}-`;
        const firstKey = keys[0];
        const firstVal = serializeValue(item[firstKey], indent + 2);
        let out = `${pad}- ${firstKey}: ${firstVal}`;
        for (let k = 1; k < keys.length; k++) {
          const key = keys[k];
          const val = item[key];
          out += '\n' + serializeKeyValue(key, val, indent + 2);
        }
        return out;
      }
      return `${pad}- ${serializeValue(item, indent + 2)}`;
    }).join('\n');
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return keys.map(key => serializeKeyValue(key, value[key], indent)).join('\n');
  }

  return String(value);
}

function serializeKeyValue(key, value, indent) {
  const pad = ' '.repeat(indent);

  if (value === null || value === undefined) {
    return `${pad}${key}: null`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}${key}: []`;
    return `${pad}${key}:\n` + serializeValue(value, indent + 2);
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return `${pad}${key}: {}`;
    return `${pad}${key}:\n` + serializeValue(value, indent + 2);
  }
  return `${pad}${key}: ${serializeValue(value, indent)}`;
}

function serializeString(str) {
  // Quote if contains special chars or looks like a reserved word
  const needsQuotes =
    str === '' ||
    str === 'true' || str === 'false' || str === 'null' || str === '~' ||
    /^-?\d+(\.\d+)?$/.test(str) ||
    str.includes(':') || str.includes('#') || str.includes('\n') ||
    str.startsWith(' ') || str.endsWith(' ') ||
    str.startsWith('"') || str.startsWith("'") ||
    str.startsWith('[') || str.startsWith('{') ||
    str.startsWith('*') || str.startsWith('&') || str.startsWith('!');

  if (!needsQuotes) return str;
  return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

module.exports = { parseYaml, stringifyYaml };
