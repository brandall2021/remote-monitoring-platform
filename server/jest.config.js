/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/prisma"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
  clearMocks: true,
  restoreMocks: true,
  // Prisma y el resto del stack levantan conexiones al importarse: ningun test de esta bateria
  // necesita base de datos, asi que se mockea el client y se corre rapido.
  collectCoverageFrom: ["src/**/*.ts", "prisma/seed.ts"],
};
