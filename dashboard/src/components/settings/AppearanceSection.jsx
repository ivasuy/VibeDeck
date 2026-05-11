import React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme.js";
import { copy } from "../../lib/copy";
import { SectionCard, SegmentedControl, SettingsRow } from "./Controls.jsx";

function buildThemeOptions() {
  return [
    { value: "light", label: copy("settings.appearance.theme.light"), Icon: Sun },
    { value: "dark", label: copy("settings.appearance.theme.dark"), Icon: Moon },
    { value: "system", label: copy("settings.appearance.theme.system"), Icon: Monitor },
  ];
}

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <SectionCard title={copy("settings.section.appearance")}>
      <SettingsRow
        label={copy("settings.appearance.theme.label")}
        hint={copy("settings.appearance.theme.hint")}
        control={<SegmentedControl options={buildThemeOptions()} value={theme} onChange={setTheme} />}
      />
    </SectionCard>
  );
}
