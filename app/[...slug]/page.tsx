import { Suspense } from "react";
import Workspace from "../workspace";

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div className="loading-screen">Loading your workspace…</div>}>
      <Workspace />
    </Suspense>
  );
}
