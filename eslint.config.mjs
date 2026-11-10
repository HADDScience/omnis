import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "generated/**",
    "node_modules/**",
    "public/uploads/**",
    "data/**",
    "prisma/demo-seed.ts",
    // withWorkflow 가 dev · build 때 만드는 Workflow 경로(그 안에 .gitignore 가 있어 커밋되지 않는다)
    "app/.well-known/workflow/**",
  ]),
  {
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
