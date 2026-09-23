const path = require("path");

/**
 * Standalone Jest project for the Image Studio app (Issue #167, generalizing
 * the per-app pattern #160 introduced for Annotation): the root
 * frontend/jest.config.js only roots "src" (the Express/BFF), so independent
 * Vite apps under apps/ need their own entry point. Tests that used to live
 * under frontend/src/public/__tests__/imageStudio*.test.ts (importing across
 * the app boundary via relative paths) now live under this app's own src/,
 * next to the code they test.
 * @type {import('jest').Config}
 */
module.exports = {
  displayName: "image-studio",
  testEnvironment: path.resolve(__dirname, "../scripts/jest-dom-environment.js"),
  roots: [path.resolve(__dirname, "src")],
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: path.resolve(__dirname, "tsconfig.jest.json") }],
  },
  moduleNameMapper: {
    "\\.worker\\?worker$": path.resolve(__dirname, "src/__tests__/workerMock.js"),
  },
};
