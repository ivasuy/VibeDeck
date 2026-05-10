import React from "react";
import { Card } from "../ui/openai/components";

export function LivePage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <Card>
        <h1 className="text-xl font-semibold text-oai-black dark:text-white">Live Workbench</h1>
      </Card>
    </main>
  );
}
