import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    identifier: "com.daedux.app",
    name: "Daedux",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "dist/assets": "views/mainview/assets",
      "dist/index.html": "views/mainview/index.html",
      "package.json": "../package.json",
      "public/tray-icon.png": "views/mainview/tray-icon.png",
      "public/tray-icon@2x.png": "views/mainview/tray-icon@2x.png",
      "src/bun/libMacWindowEffects.dylib": "bun/libMacWindowEffects.dylib",
    },
    linux: { bundleCEF: true, icon: "icon.png" },
    mac: {
      bundleCEF: false,
      icons: "assets/files/iconsets/daedux-emerald-dark.iconset",
    },
    win: { bundleCEF: false, icon: "icon.ico" },
  },
  release: {
    baseUrl: "https://github.com/agentika-labs/daedux/releases/download/",
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig;
