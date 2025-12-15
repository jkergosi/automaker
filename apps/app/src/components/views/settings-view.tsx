"use client";

import { useState } from "react";
import { useAppStore } from "@/store/app-store";
import { Label } from "@/components/ui/label";
import {
  Key,
  Palette,
  Terminal,
  FlaskConical,
  Trash2,
  Settings2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

import { useCliStatus } from "./settings-view/hooks/use-cli-status";
import { useScrollTracking } from "@/hooks/use-scroll-tracking";
import { SettingsHeader } from "./settings-view/components/settings-header";
import { KeyboardMapDialog } from "./settings-view/components/keyboard-map-dialog";
import { DeleteProjectDialog } from "./settings-view/components/delete-project-dialog";
import { SettingsNavigation } from "./settings-view/components/settings-navigation";
import { ApiKeysSection } from "./settings-view/api-keys/api-keys-section";
import { ClaudeCliStatus } from "./settings-view/cli-status/claude-cli-status";
import { AppearanceSection } from "./settings-view/appearance/appearance-section";
import { KeyboardShortcutsSection } from "./settings-view/keyboard-shortcuts/keyboard-shortcuts-section";
import { FeatureDefaultsSection } from "./settings-view/feature-defaults/feature-defaults-section";
import { DangerZoneSection } from "./settings-view/danger-zone/danger-zone-section";
import type {
  Project as SettingsProject,
  Theme,
} from "./settings-view/shared/types";
import type { Project as ElectronProject } from "@/lib/electron";

// Navigation items for the side panel
const NAV_ITEMS = [
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "claude", label: "Claude", icon: Terminal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "audio", label: "Audio", icon: Volume2 },
  { id: "keyboard", label: "Keyboard Shortcuts", icon: Settings2 },
  { id: "defaults", label: "Feature Defaults", icon: FlaskConical },
  { id: "danger", label: "Danger Zone", icon: Trash2 },
];

export function SettingsView() {
  const {
    theme,
    setTheme,
    setProjectTheme,
    defaultSkipTests,
    setDefaultSkipTests,
    useWorktrees,
    setUseWorktrees,
    showProfilesOnly,
    setShowProfilesOnly,
    muteDoneSound,
    setMuteDoneSound,
    currentProject,
    moveProjectToTrash,
  } = useAppStore();

  // Convert electron Project to settings-view Project type
  const convertProject = (
    project: ElectronProject | null
  ): SettingsProject | null => {
    if (!project) return null;
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      theme: project.theme as Theme | undefined,
    };
  };

  const settingsProject = convertProject(currentProject);

  // Compute the effective theme for the current project
  const effectiveTheme = (settingsProject?.theme || theme) as Theme;

  // Handler to set theme - always updates global theme (user's preference),
  // and also sets per-project theme if a project is selected
  const handleSetTheme = (newTheme: typeof theme) => {
    // Always update global theme so user's preference persists across all projects
    setTheme(newTheme);
    // Also set per-project theme if a project is selected
    if (currentProject) {
      setProjectTheme(currentProject.id, newTheme);
    }
  };

  // Use CLI status hook
  const {
    claudeCliStatus,
    isCheckingClaudeCli,
    handleRefreshClaudeCli,
  } = useCliStatus();

  // Use scroll tracking hook
  const { activeSection, scrollToSection, scrollContainerRef } =
    useScrollTracking({
      items: NAV_ITEMS,
      filterFn: (item) => item.id !== "danger" || !!currentProject,
      initialSection: "api-keys",
    });

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showKeyboardMapDialog, setShowKeyboardMapDialog] = useState(false);

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden content-bg"
      data-testid="settings-view"
    >
      {/* Header Section */}
      <SettingsHeader />

      {/* Content Area with Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sticky Side Navigation */}
        <SettingsNavigation
          navItems={NAV_ITEMS}
          activeSection={activeSection}
          currentProject={currentProject}
          onNavigate={scrollToSection}
        />

        {/* Scrollable Content */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto space-y-6 pb-96">
            {/* API Keys Section */}
            <ApiKeysSection />

            {/* Claude CLI Status Section */}
            {claudeCliStatus && (
              <ClaudeCliStatus
                status={claudeCliStatus}
                isChecking={isCheckingClaudeCli}
                onRefresh={handleRefreshClaudeCli}
              />
            )}

            {/* Appearance Section */}
            <AppearanceSection
              effectiveTheme={effectiveTheme}
              currentProject={settingsProject}
              onThemeChange={handleSetTheme}
            />


            {/* Keyboard Shortcuts Section */}
            <KeyboardShortcutsSection
              onOpenKeyboardMap={() => setShowKeyboardMapDialog(true)}
            />

            {/* Audio Section */}
            <div
              id="audio"
              className="rounded-2xl border border-border/50 bg-gradient-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl shadow-sm shadow-black/5 overflow-hidden scroll-mt-6"
            >
              <div className="p-6 border-b border-border/50 bg-gradient-to-r from-transparent via-accent/5 to-transparent">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/20">
                    <Volume2 className="w-5 h-5 text-brand-500" />
                  </div>
                  <h2 className="text-lg font-semibold text-foreground tracking-tight">
                    Audio
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground/80 ml-12">
                  Configure audio and notification settings.
                </p>
              </div>
              <div className="p-6 space-y-4">
                {/* Mute Done Sound Setting */}
                <div className="group flex items-start space-x-3 p-3 rounded-xl hover:bg-accent/30 transition-colors duration-200 -mx-3">
                  <Checkbox
                    id="mute-done-sound"
                    checked={muteDoneSound}
                    onCheckedChange={(checked) =>
                      setMuteDoneSound(checked === true)
                    }
                    className="mt-1"
                    data-testid="mute-done-sound-checkbox"
                  />
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="mute-done-sound"
                      className="text-foreground cursor-pointer font-medium flex items-center gap-2"
                    >
                      <VolumeX className="w-4 h-4 text-brand-500" />
                      Mute notification sound when agents complete
                    </Label>
                    <p className="text-xs text-muted-foreground/80 leading-relaxed">
                      When enabled, disables the &quot;ding&quot; sound that
                      plays when an agent completes a feature. The feature
                      will still move to the completed column, but without
                      audio notification.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature Defaults Section */}
            <FeatureDefaultsSection
              showProfilesOnly={showProfilesOnly}
              defaultSkipTests={defaultSkipTests}
              useWorktrees={useWorktrees}
              onShowProfilesOnlyChange={setShowProfilesOnly}
              onDefaultSkipTestsChange={setDefaultSkipTests}
              onUseWorktreesChange={setUseWorktrees}
            />

            {/* Danger Zone Section - Only show when a project is selected */}
            <DangerZoneSection
              project={settingsProject}
              onDeleteClick={() => setShowDeleteDialog(true)}
            />
          </div>
        </div>
      </div>

      {/* Keyboard Map Dialog */}
      <KeyboardMapDialog
        open={showKeyboardMapDialog}
        onOpenChange={setShowKeyboardMapDialog}
      />

      {/* Delete Project Confirmation Dialog */}
      <DeleteProjectDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        project={currentProject}
        onConfirm={moveProjectToTrash}
      />
    </div>
  );
}
