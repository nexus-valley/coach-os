import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";

const quickLinks = [
  ["Platform", "/#platform"],
  ["Features", "/#features"],
  ["Why CoachFort", "/#why-coachfort"],
  ["About", "/#about"],
  ["Support", "/support"],
];

const policyLinks = [
  ["Terms", "/terms"],
  ["Privacy", "/privacy"],
  ["Payment Policy", "/payment-policy"],
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-[#D8E8F0] bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 text-sm sm:px-6 md:grid-cols-[1.3fr_0.8fr_1fr] lg:px-8">
        <div>
          <CoachFortBrandAsset className="h-12 w-44" variant="fullLogo" />
          <p className="mt-5 max-w-md leading-7 text-[#425B76]">
            CoachFort is built by Nexus Valley Technologies to help coaching
            teams in India and overseas manage students, courses, payments,
            reminders, and growth workflows from one clean platform.
          </p>
          <p className="mt-6 text-[#66788F]">
            &copy; 2026 Nexus Valley Technologies. All rights reserved.
          </p>
        </div>

        <div>
          <p className="font-semibold text-[#0B1F33]">Quick links</p>
          <div className="mt-4 grid gap-3">
            {quickLinks.map(([label, href]) => (
              <a
                className="font-medium text-[#425B76] transition hover:text-[#145DA0]"
                href={href}
                key={label}
              >
                {label}
              </a>
            ))}
          </div>
          <p className="mt-8 font-semibold text-[#0B1F33]">Policies</p>
          <div className="mt-4 grid gap-3">
            {policyLinks.map(([label, href]) => (
              <a
                className="font-medium text-[#425B76] transition hover:text-[#145DA0]"
                href={href}
                key={label}
              >
                {label}
              </a>
            ))}
          </div>
        </div>

        <div>
          <p className="font-semibold text-[#0B1F33]">Support</p>
          <address className="mt-4 not-italic leading-7 text-[#425B76]">
            Nexus Valley Technologies
            <br />
            9/443-3 Pari Nagar Extension
            <br />
            CAK Road
            <br />
            Karur, Tamil Nadu 639002
            <br />
            India
          </address>
          <a
            className="mt-4 inline-flex font-semibold text-[#145DA0] transition hover:text-[#0F4C81]"
            href="mailto:support@coachfort.com"
          >
            support@coachfort.com
          </a>
          <a
            className="mt-3 block font-semibold text-[#145DA0] transition hover:text-[#0F4C81]"
            href="https://wa.me/917338841434"
            rel="noreferrer"
            target="_blank"
          >
            WhatsApp: +91 7338841434
          </a>
        </div>
      </div>
    </footer>
  );
}
