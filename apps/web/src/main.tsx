import { createRoot } from "react-dom/client";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

createRoot(root).render(
  <main className="mx-auto max-w-3xl p-8">
    <h1 className="text-3xl font-bold">AgentFICO</h1>
    <p className="mt-2">An open trust score for AI agents.</p>
  </main>,
);
