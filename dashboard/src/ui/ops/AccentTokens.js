import {
  Activity,
  BadgeCheck,
  FolderKanban,
  GitBranch,
  Layers3,
  Package2,
  ShieldAlert,
  Wallet,
} from "lucide-react";

const ACCENT_TOKENS = {
  default: {
    icon: Layers3,
    badgeClassName:
      "border-[color:var(--vd-ops-muted-border)] bg-[color:var(--vd-ops-muted-soft)] text-[color:var(--vd-ops-muted-text)]",
    panelClassName:
      "border-[color:var(--vd-ops-muted-border)] bg-[color:var(--vd-ops-muted-soft)]/60",
    barClassName: "bg-[color:var(--vd-ops-muted-border)]",
  },
  live: {
    icon: Activity,
    badgeClassName:
      "border-[color:var(--vd-ops-live-border)] bg-[color:var(--vd-ops-live-soft)] text-[color:var(--vd-ops-live-text)]",
    panelClassName:
      "border-[color:var(--vd-ops-live-border)] bg-[color:var(--vd-ops-live-soft)]/60",
    barClassName: "bg-[color:var(--vd-ops-live-text)]",
  },
  project: {
    icon: FolderKanban,
    badgeClassName:
      "border-[color:var(--vd-ops-project-border)] bg-[color:var(--vd-ops-project-soft)] text-[color:var(--vd-ops-project-text)]",
    panelClassName:
      "border-[color:var(--vd-ops-project-border)] bg-[color:var(--vd-ops-project-soft)]/60",
    barClassName: "bg-[color:var(--vd-ops-project-text)]",
  },
  cost: {
    icon: Wallet,
    badgeClassName:
      "border-[color:var(--vd-ops-cost-border)] bg-[color:var(--vd-ops-cost-soft)] text-[color:var(--vd-ops-cost-text)]",
    panelClassName:
      "border-[color:var(--vd-ops-cost-border)] bg-[color:var(--vd-ops-cost-soft)]/60",
    barClassName: "bg-[color:var(--vd-ops-cost-text)]",
  },
  branch: {
    icon: GitBranch,
    badgeClassName:
      "border-[color:var(--vd-ops-branch-border)] bg-[color:var(--vd-ops-branch-soft)] text-[color:var(--vd-ops-branch-text)]",
    panelClassName:
      "border-[color:var(--vd-ops-branch-border)] bg-[color:var(--vd-ops-branch-soft)]/60",
    barClassName: "bg-[color:var(--vd-ops-branch-text)]",
  },
  skills: {
    icon: Package2,
    badgeClassName:
      "border-[color:var(--vd-ops-skills-border)] bg-[color:var(--vd-ops-skills-soft)] text-[color:var(--vd-ops-skills-text)]",
    panelClassName:
      "border-[color:var(--vd-ops-skills-border)] bg-[color:var(--vd-ops-skills-soft)]/60",
    barClassName: "bg-[color:var(--vd-ops-skills-text)]",
  },
  entire: {
    icon: Layers3,
    badgeClassName:
      "border-[color:var(--vd-ops-entire-border)] bg-[color:var(--vd-ops-entire-soft)] text-[color:var(--vd-ops-entire-text)]",
    panelClassName:
      "border-[color:var(--vd-ops-entire-border)] bg-[color:var(--vd-ops-entire-soft)]/60",
    barClassName: "bg-[color:var(--vd-ops-entire-text)]",
  },
  confidence: {
    icon: BadgeCheck,
    badgeClassName:
      "border-[color:var(--vd-ops-confidence-border)] bg-[color:var(--vd-ops-confidence-soft)] text-[color:var(--vd-ops-confidence-text)]",
    panelClassName:
      "border-[color:var(--vd-ops-confidence-border)] bg-[color:var(--vd-ops-confidence-soft)]/60",
    barClassName: "bg-[color:var(--vd-ops-confidence-text)]",
  },
  destructive: {
    icon: ShieldAlert,
    badgeClassName:
      "border-[color:var(--vd-ops-danger-border)] bg-[color:var(--vd-ops-danger-soft)] text-[color:var(--vd-ops-danger-text)]",
    panelClassName:
      "border-[color:var(--vd-ops-danger-border)] bg-[color:var(--vd-ops-danger-soft)]/60",
    barClassName: "bg-[color:var(--vd-ops-danger-text)]",
  },
};

export function getAccentToken(accent = "default") {
  return ACCENT_TOKENS[accent] || ACCENT_TOKENS.default;
}

export { ACCENT_TOKENS };
