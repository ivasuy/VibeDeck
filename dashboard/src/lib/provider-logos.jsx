import React from "react";
import { cn } from "./cn";

export const PROVIDER_LOGOS = {
  antigravity: "/brand-logos/antigravity.svg",
  "claude-code": "/brand-logos/claude-code.svg",
  claude: "/brand-logos/claude-code.svg",
  codex: "/brand-logos/codex.svg",
  copilot: "/brand-logos/copilot.svg",
  cursor: "/brand-logos/cursor.svg",
  factoryai: "/brand-logos/factoryai-droid.svg",
  "factoryai-droid": "/brand-logos/factoryai-droid.svg",
  gemini: "/brand-logos/gemini.svg",
  hermes: "/brand-logos/hermes.svg",
  kimi: "/brand-logos/kimi.svg",
  kiro: "/brand-logos/kiro.svg",
  openclaw: "/brand-logos/openclaw.svg",
  opencode: "/brand-logos/opencode.svg",
};

export const MONO_PROVIDERS = new Set([
  "cursor",
  "hermes",
  "kimi",
  "kiro",
  "openclaw",
  "opencode",
]);

const PROVIDER_ALIASES = {
  anthropic: "claude",
  claude_code: "claude",
  claude_code_cli: "claude",
  claude: "claude",
  code: "codex",
  openai: "codex",
  openai_codex: "codex",
  factory: "factoryai",
  factory_ai: "factoryai",
  google: "gemini",
  google_gemini: "gemini",
  open_code: "opencode",
  open_claw: "openclaw",
};

export function normalizeProviderKey(provider) {
  const raw = String(provider || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return PROVIDER_ALIASES[raw] || raw.replace(/_/g, "-");
}

export function providerDisplayName(provider) {
  const normalized = normalizeProviderKey(provider);
  if (normalized === "claude") return "Claude";
  if (normalized === "codex") return "Codex";
  if (normalized === "factoryai") return "Factory AI";
  if (normalized === "openclaw") return "OpenClaw";
  if (normalized === "opencode") return "OpenCode";
  if (!normalized) return "Provider";
  return normalized
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function ProviderLogo({
  provider,
  size = 16,
  className = "",
  title,
}) {
  const normalized = normalizeProviderKey(provider);
  const src = PROVIDER_LOGOS[normalized];
  const label = title || `${providerDisplayName(provider)} logo`;
  const style = { width: size, height: size };

  if (src && MONO_PROVIDERS.has(normalized)) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn("inline-block shrink-0 bg-current", className)}
        style={{
          ...style,
          WebkitMaskImage: `url(${src})`,
          maskImage: `url(${src})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
    );
  }

  if (src) {
    return (
      <img
        src={src}
        alt={label}
        width={size}
        height={size}
        className={cn("inline-block shrink-0 object-contain", className)}
        style={style}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex shrink-0 items-center justify-center text-oai-gray-400", className)}
      style={style}
    >
      <span
        aria-hidden="true"
        className="inline-block bg-current"
        style={{
          width: size,
          height: size,
          WebkitMaskImage: "url(/mark-mono.svg)",
          maskImage: "url(/mark-mono.svg)",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
    </span>
  );
}
