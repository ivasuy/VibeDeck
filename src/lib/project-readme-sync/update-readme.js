'use strict';

const fs = require("node:fs/promises");

const PROJECT_MARKER_START = "<!-- vibedeck:project-stats:start -->";
const PROJECT_MARKER_END = "<!-- vibedeck:project-stats:end -->";
const DEFAULT_IMAGE_PATH = "./project-readme-banner.svg";

function buildManagedProjectReadmeBlock({ imagePath = DEFAULT_IMAGE_PATH } = {}) {
  return [
    PROJECT_MARKER_START,
    `![VibeDeck Project Usage](${imagePath})`,
    PROJECT_MARKER_END,
  ].join("\n");
}

function upsertManagedProjectReadmeBlock({
  readme,
  markerStart = PROJECT_MARKER_START,
  markerEnd = PROJECT_MARKER_END,
  imagePath = DEFAULT_IMAGE_PATH,
} = {}) {
  const source = String(readme || "");
  const block = buildManagedProjectReadmeBlock({ imagePath });
  const start = source.indexOf(markerStart);
  const end = source.indexOf(markerEnd);

  if (start !== -1 && end !== -1 && end >= start) {
    const tail = end + markerEnd.length;
    return `${source.slice(0, start)}${block}${source.slice(tail)}`;
  }

  if (!source) {
    return `${block}\n`;
  }

  return `${source.endsWith("\n") ? source : `${source}\n`}${block}\n`;
}

async function writeManagedProjectReadme({
  readmePath = "README.md",
  readme,
}) {
  const source = typeof readme === "string" ? readme : await fs.readFile(readmePath, "utf8");
  const nextReadme = upsertManagedProjectReadmeBlock({ readme: source });
  await fs.writeFile(readmePath, nextReadme, "utf8");
  return nextReadme;
}

module.exports = {
  PROJECT_MARKER_START,
  PROJECT_MARKER_END,
  DEFAULT_IMAGE_PATH,
  buildManagedProjectReadmeBlock,
  upsertManagedProjectReadmeBlock,
  writeManagedProjectReadme,
};
