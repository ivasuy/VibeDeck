import React from "react";
import { copy } from "../../lib/copy";
import { MetricStrip } from "../../ui/ops";

function uniqueSourceCount(items) {
  const values = new Set();
  for (const skill of items) {
    if (skill?.repoOwner && skill?.repoName) values.add(`${skill.repoOwner}/${skill.repoName}`.toLowerCase());
    else values.add("local");
  }
  return values.size;
}

function targetAssignmentCount(items) {
  return items.reduce((sum, skill) => sum + (Array.isArray(skill?.targets) ? skill.targets.length : 0), 0);
}

export function SkillSourceSummary({ items = [] }) {
  const rows = Array.isArray(items) ? items : [];
  const managedCount = rows.filter((skill) => skill?.managed).length;
  const localCount = rows.length - managedCount;

  return (
    <MetricStrip
      items={[
        {
          key: "installed",
          label: copy("skills.summary.installed"),
          value: rows.length.toLocaleString(),
          accent: "skills",
        },
        {
          key: "managed",
          label: copy("skills.summary.managed"),
          value: managedCount.toLocaleString(),
          accent: "project",
        },
        {
          key: "local",
          label: copy("skills.summary.local"),
          value: localCount.toLocaleString(),
          accent: "branch",
        },
        {
          key: "sources",
          label: copy("skills.summary.sources"),
          value: uniqueSourceCount(rows).toLocaleString(),
          detail: copy("skills.summary.links_detail", {
            count: targetAssignmentCount(rows).toLocaleString(),
          }),
          accent: "live",
        },
      ]}
    />
  );
}
