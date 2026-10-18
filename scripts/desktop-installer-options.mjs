import { join } from "node:path";

// Shared by distribution builds and the isolated Windows lifecycle check.
export function windowsInstallerOptions(icons) {
  return {
    oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, shortcutName: "Fussenn",
    deleteAppDataOnUninstall: false,
    installerIcon: join(icons, "fussenn.ico"), uninstallerIcon: join(icons, "fussenn.ico"),
  };
}
