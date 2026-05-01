export default function RootLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,rgba(46,203,234,0.22),transparent_30rem),linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF7FC_100%)] px-5 text-[#0B1F33]">
      <div className="w-full max-w-md rounded-3xl border border-[#D8E8F0] bg-white p-8 text-center shadow-2xl shadow-[#0B2A3D]/10">
        <div className="mx-auto h-11 w-11 animate-pulse rounded-2xl bg-[#2ECBEA] shadow-lg shadow-[#2ECBEA]/25" />
        <h1 className="mt-6 text-xl font-semibold">Loading CoachOS</h1>
        <p className="mt-2 text-sm leading-6 text-[#425B76]">
          Preparing your Nexus Valley workspace.
        </p>
      </div>
    </main>
  );
}
