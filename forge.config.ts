import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { PublisherGithub } from '@electron-forge/publisher-github';

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      // Unpack node-pty's full directory tree from the asar. The
      // auto-unpack-natives plugin only handles `*.node` files, but
      // node-pty on Windows ALSO needs to LoadLibraryW its sibling
      // `winpty.dll`, `winpty-agent.exe`, `conpty.dll`, and
      // `OpenConsole.exe` — those have to live on disk, not inside
      // the asar archive. Without this, terminals silently fail to
      // spawn after install (pty.node loads but its dependent DLLs
      // can't be located).
      unpack: '**/node_modules/node-pty/**',
    },
    name: 'Claude Code Studio',
    // executableName must match what auto-update expects post-install.
    // Squirrel uses the productName for the install dir; this controls the .exe.
    executableName: 'claude-code-studio',
    // Override the plugin-vite default ignore (which excludes everything
    // outside `.vite/`). We need our two Vite externals — `node-pty` and
    // `systeminformation` — on disk because they're declared as external
    // in `vite.main.config.ts` and the bundled main process emits bare
    // `require()` calls for them.
    //
    // We include the whole `/node_modules` tree; electron-packager's
    // `prune: true` (default) strips devDependencies after copy, so the
    // final asar only carries production deps. This is more permissive
    // than the official forge template's "bundle everything via Vite"
    // approach but is correct for our native-module use case.
    ignore: (file: string | undefined): boolean => {
      if (!file) return false;
      // file always starts with '/'
      if (file === '/.vite' || file.startsWith('/.vite/')) return false;
      if (file === '/package.json') return false;
      if (file === '/node_modules' || file.startsWith('/node_modules/')) return false;
      // Exclude everything else: src/, configs, .git/, out/, journals, etc.
      return true;
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      // Required for Squirrel auto-update: the friendly name shown in
      // Programs & Features and used by update.electronjs.org for matching.
      name: 'claude_code_studio',
      authors: 'LxveAce',
      description:
        'Full desktop GUI for Claude Code with resource monitoring and cloud sync',
      // --- Branding hooks (uncomment + provide assets to enable) -----------
      // setupIcon: './assets/installer.ico',
      // loadingGif: './assets/loading.gif',
      // iconUrl:
      //   'https://raw.githubusercontent.com/LxveAce/claude-code-studio/master/assets/app-icon.ico',
      // --- Code signing (Windows) ------------------------------------------
      // certificateFile: process.env.WINDOWS_CERT_PATH,
      // certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
      // signWithParams: '/tr http://timestamp.digicert.com /td sha256 /fd sha256',
    }),
    new MakerZIP({}, ['darwin']),
  ],
  publishers: [
    // GitHub Releases publisher — `npm run publish` will draft a release
    // and upload Squirrel artifacts. update-electron-app reads from this
    // same release feed at runtime.
    //
    // Auth: requires GITHUB_TOKEN env var with `repo` scope at publish time.
    // We do NOT bake any token into source — publish is a manual maintainer
    // action, not a CI step (yet).
    new PublisherGithub({
      repository: {
        owner: 'LxveAce',
        name: 'claude-code-studio',
      },
      // Draft releases so the maintainer can review release notes before
      // exposing them to update.electronjs.org's release feed.
      draft: true,
      // prerelease: false by default — flip per-publish via env if shipping
      // to a beta channel. Beta channel UX is exposed in Settings but the
      // actual feed routing is set here at publish time.
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
    }),
  ],
};

export default config;
