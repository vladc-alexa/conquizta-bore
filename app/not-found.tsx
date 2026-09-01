import Link from "next/link";

// Themed 404 — also the landing page for the admin "switch off" (⏻) button.
export default function NotFound() {
  return (
    <div className="w-full max-w-xl mx-auto text-center flex flex-col items-center gap-5 py-20">
      <div className="text-[4rem] leading-none">🚫</div>
      <h1 className="!mb-0 text-[2.5rem]">404</h1>
      <p className="text-[#c8a070] text-[0.95rem]">
        Pagina nu există — sau site-ul a fost oprit.
      </p>
      <Link
        href="/"
        className="font-cinzel text-[#f5e8c0] bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg px-5 py-2.5 hover:brightness-110"
      >
        ← Înapoi la dashboard
      </Link>
    </div>
  );
}
