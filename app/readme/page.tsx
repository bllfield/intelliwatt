import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

export default async function ReadmePage() {
  const filePath = path.join(process.cwd(), "README.md");
  let content = "README.md not found.";
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    // leave default message
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold mb-4">Repository README</h1>
      <pre className="whitespace-pre-wrap leading-relaxed">{content}</pre>
    </main>
  );
}

