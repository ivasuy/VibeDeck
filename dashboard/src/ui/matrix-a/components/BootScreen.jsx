import { Button } from "@base-ui/react/button";
import React from "react";
import { copy } from "../../../lib/copy";

export function BootScreen({ onSkip }) {
  const canSkip = Boolean(onSkip);

  const className = `min-h-screen bg-matrix-dark text-matrix-primary font-matrix flex flex-col items-center justify-center p-8 text-center text-body ${
    canSkip ? "cursor-pointer" : ""
  }`;

  const content = (
    <>
      <div className="flex flex-col items-center gap-4">
        {/* Elegant loading spinner */}
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 border-2 border-matrix-panelStrong rounded-full"></div>
          <div className="absolute inset-0 border-2 border-transparent border-t-matrix-primary rounded-full animate-spin"></div>
        </div>
        {canSkip ? (
          <p className="text-caption text-matrix-muted uppercase mt-4">{copy("boot.skip_hint")}</p>
        ) : null}
      </div>
    </>
  );

  if (!canSkip) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Button
      className={className}
      onClick={onSkip}
      aria-label={copy("boot.skip_aria")}
      nativeButton={false}
      render={(renderProps) => {
        const { children, ...rest } = renderProps;
        return <div {...rest}>{children}</div>;
      }}
    >
      {content}
    </Button>
  );
}
