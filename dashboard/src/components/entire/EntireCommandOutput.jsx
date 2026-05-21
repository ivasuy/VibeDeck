import React from "react";

export function EntireCommandOutput({ label, output }) {
  if (!output) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-oai-gray-200 bg-oai-gray-950 text-oai-gray-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:border-oai-gray-800">
      <div className="border-b border-white/10 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-oai-gray-400">
        {label}
      </div>
      <pre className="max-h-72 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs leading-5 text-oai-gray-100">
        <code>{output}</code>
      </pre>
    </div>
  );
}
