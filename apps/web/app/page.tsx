import { CORE_API_VERSION } from "@builder/core";

export default function HomePage() {
  return (
    <main>
      <h1>Character Builder</h1>
      <p>The builder is running. No content package is loaded yet.</p>
      <p>
        <small>Core API version {CORE_API_VERSION}</small>
      </p>
    </main>
  );
}
