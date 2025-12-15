import path from "node:path";

// Keep this config dependency-free (no `vitest/config` import) so TypeScript
// doesn't require Vitest's type declarations just to open this file.
// Vitest will still read this file at runtime once `vitest` is installed.
export default {
  resolve: {
    alias: [
      // Support Next.js-style imports like "@/lib/..."
      { find: /^@\//, replacement: `${path.resolve(__dirname, ".")}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
};


