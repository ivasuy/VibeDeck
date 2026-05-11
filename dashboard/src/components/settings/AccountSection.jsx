import React from "react";
import { LogOut } from "lucide-react";
import { copy } from "../../lib/copy";
import { useAccountProfileSettings } from "./useAccountProfileSettings.js";
import { SignedOutAccountSection } from "./AccountSectionParts.jsx";
import { SectionCard } from "./Controls.jsx";

export function AccountSection() {
  const settings = useAccountProfileSettings();

  if (!settings.enabled) return null;
  if (!settings.signedIn) return <SignedOutAccountSection />;

  return (
    <SectionCard
      title={copy("settings.section.account")}
      subtitle={settings.email || settings.name.displayName}
      action={<SignOutButton onSignOut={settings.signOut} />}
    />
  );
}

function SignOutButton({ onSignOut }) {
  return (
    <button
      type="button"
      onClick={() => onSignOut()}
      className="inline-flex h-7 items-center gap-1.5 text-xs font-medium text-oai-gray-500 transition-colors hover:text-oai-gray-700 dark:hover:text-oai-gray-300"
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden />
      {copy("settings.account.signOut")}
    </button>
  );
}
