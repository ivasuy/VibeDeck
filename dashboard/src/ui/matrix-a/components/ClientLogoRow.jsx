import React from "react";
import { CLIENTS } from "./ClientLogos.jsx";

export function ClientLogoRow({ className = "" }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-3 ${className}`}>
      {CLIENTS.map(({ id, name, Icon }) => (
        <div
          key={id}
          className="flex items-center gap-1.5 px-2 py-1 rounded border border-matrix-ghost/50 bg-matrix-panel/50"
          title={name}
        >
          <Icon className="w-4 h-4 text-matrix-primary" />
          <span className="text-caption text-matrix-bright">{name}</span>
        </div>
      ))}
    </div>
  );
}

export default ClientLogoRow;
