import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="card mx-auto mt-16 max-w-md text-center">
      <h1 className="mb-2 text-lg font-semibold">Not allowed</h1>
      <p className="mb-4 text-sm text-slate-600">Your role does not have access to this page.</p>
      <Link href="/" className="btn-secondary">Back to board</Link>
    </div>
  );
}
