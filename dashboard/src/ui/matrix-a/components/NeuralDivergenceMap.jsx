import React from "react";
import { copy } from "../../../lib/copy";
import { NeuralAdaptiveFleet } from "./NeuralAdaptiveFleet.jsx";

export const NeuralDivergenceMap = React.memo(function NeuralDivergenceMap({
  fleetData = [],
  className = "",
  title = copy("dashboard.model_breakdown.title"),
  footer = copy("dashboard.model_breakdown.footer"),
}) {
  const count = fleetData.length;
  const gridClass = count === 1 ? "grid grid-cols-1" : "grid grid-cols-1 md:grid-cols-2";

  return (
    <div className={`rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-5 ${className}`}>
      <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide mb-4">
        {title}
      </h3>
      <div className={`${gridClass} gap-5`}>
        {fleetData.map((fleet, index) => {
          const isFirstAndOdd = count > 1 && count % 2 !== 0 && index === 0;
          const itemClass = isFirstAndOdd ? "md:col-span-2" : "";

          return (
            <div key={`${fleet.label}-${index}`} className={itemClass}>
              <NeuralAdaptiveFleet
                label={fleet.label}
                totalPercent={fleet.totalPercent}
                usage={fleet.usage}
                models={fleet.models}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
