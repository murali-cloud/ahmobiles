import { Suspense } from "react";
import Workspace from "../workspace";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="loading-screen">Loading sign-in…</div>}>
      <Workspace />
    </Suspense>
  );
}
