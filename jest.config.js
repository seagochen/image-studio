const path = require("path");

/**
 * Jest project for the Image Studio browser app. Tests live next to the code under
 * src/__tests__; the DOM environment is a jsdom-backed node environment
 * (scripts/jest-dom-environment.js). Server tests use node:test (npm run test:server).
 * @type {import('jest').Config}
 */
module.exports = {
  displayName: "image-studio",
  testEnvironment: path.resolve(__dirname, "scripts/jest-dom-environment.js"),
  roots: [path.resolve(__dirname, "src")],
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: path.resolve(__dirname, "tsconfig.jest.json") }],
  },
  moduleNameMapper: {
    "\\.worker\\?worker$": path.resolve(__dirname, "src/__tests__/workerMock.js"),
  },
};
