import { Input } from "@base-ui/react/input";
import React from "react";
import { copy } from "../../../lib/copy.js";
import { MatrixAvatar } from "../../foundation/MatrixAvatar.jsx";
import { SignalBox } from "../../foundation/SignalBox.jsx";
import { LiveSniffer } from "./LiveSniffer.jsx";

export function LandingExtras({
  handle,
  onHandleChange,
  specialHandle,
  handlePlaceholder,
  rankLabel,
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
      <SignalBox title={copy("landing.signal.identity_probe")} className="flex-1 min-h-[140px]">
        <div className="flex items-center space-x-6 h-full py-2">
          <MatrixAvatar name={handle} size={64} isTheOne={handle === specialHandle} />
          <div className="flex-1 text-left space-y-2">
            <div className="flex flex-col">
              <label className="text-[10px] text-matrix-muted uppercase mb-1 font-bold tracking-wider">
                {copy("landing.handle.label")}
              </label>
              <Input
                type="text"
                value={handle}
                onChange={onHandleChange}
                className="w-full bg-transparent border-b border-matrix-dim text-matrix-bright font-black text-xl md:text-2xl p-1 focus:outline-none focus:border-matrix-primary transition-colors"
                maxLength={10}
                placeholder={handlePlaceholder}
              />
            </div>
            <div className="text-[10px] text-matrix-muted uppercase tracking-tight">{rankLabel}</div>
          </div>
        </div>
      </SignalBox>

      <SignalBox title={copy("landing.signal.live_sniffer")} className="flex-1 min-h-[140px]">
        <div className="h-full py-1">
          <LiveSniffer />
        </div>
      </SignalBox>
    </div>
  );
}
