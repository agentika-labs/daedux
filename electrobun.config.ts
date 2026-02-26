import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Daedux",
    identifier: "com.daedux.app",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      "public/tray-icon.png": "views/mainview/tray-icon.png",
      "public/tray-icon@2x.png": "views/mainview/tray-icon@2x.png",
      "src/bun/libMacWindowEffects.dylib": "bun/libMacWindowEffects.dylib",
    },
    mac: { bundleCEF: false, icons: "icon.iconset" },
    linux: { bundleCEF: true, icon: "icon.png" },
    win: { bundleCEF: false, icon: "icon.ico" },
  },
  release: {
    baseUrl:
      "https://github.com/adamferguson/daedux/releases/download/",
  },
} satisfies ElectrobunConfig;
