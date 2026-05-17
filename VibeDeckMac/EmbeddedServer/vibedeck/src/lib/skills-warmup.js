const skills = require("./skills-manager");

function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Math.trunc(n).toLocaleString("en-US");
}

function plural(value, singular, pluralValue = `${singular}s`) {
  return Number(value) === 1 ? singular : pluralValue;
}

async function warmSkillMetadataIndex({ lifecycle = null, force = false, source = "all" } = {}) {
  lifecycle?.phase?.("Indexing skill metadata...");
  try {
    const result = await skills.warmDiscoverCatalog({
      force,
      source,
      onProgress: (payload) => lifecycle?.providerProgress?.("Skills", payload),
    });
    const total = Number(result?.totalCount || 0);
    const action = result?.warmed ? "indexed" : "using cached index for";
    lifecycle?.providerDone?.(
      "Skills",
      `${action} ${formatCount(total)} skill ${plural(total, "metadata row")}`,
    );
    return result;
  } catch (err) {
    lifecycle?.providerDone?.("Skills", `indexing skipped: ${err?.message || err}`);
    return {
      warmed: false,
      totalCount: 0,
      error: err?.message || String(err),
    };
  }
}

module.exports = {
  warmSkillMetadataIndex,
};
