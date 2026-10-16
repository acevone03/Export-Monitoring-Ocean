import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold">NNR Export Monitor</h1>
      <p className="mb-6 text-sm text-slate-600">NNR Global Logistics · Export operations</p>
      <div className="card">
        <LoginForm />
      </div>
      <p className="mt-4 text-xs text-slate-500">No self-signup. Ask your supervisor for an account.</p>
    </div>
  );
}
