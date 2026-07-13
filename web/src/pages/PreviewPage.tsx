import { Link } from "react-router-dom";
import { PublicIntro, PublicShell } from "../components/PublicShell";

export function PreviewPage() {
  const cards = [
    {
      to: "/preview/enrollment",
      title: "Program enrollment",
      description:
        "Discord-linked identity, profile, goals, context, and reminder preferences.",
    },
    {
      to: "/preview/form/interviewee_report",
      title: "Interviewee report",
      description:
        "Recording, code, attendance, experience ratings, and private/shared feedback.",
    },
    {
      to: "/preview/form/interviewer_report",
      title: "Interviewer report",
      description:
        "Technical and behavioural rubric, hints, code, and structured feedback.",
    },
    {
      to: "/preview/packet",
      title: "Interviewer packet",
      description:
        "Private problem statement, hint ladder, and solution notes.",
    },
    {
      to: "/app/admin/problems",
      title: "Question library",
      description: "Manage round sets and open participant-facing previews without publishing the bank.",
    },
    {
      to: "/login",
      title: "Participant login",
      description:
        "Email-code authentication and the signed-in dashboard handoff.",
    },
  ];
  return (
    <PublicShell>
      <PublicIntro
        eyebrow="Experience library"
        title="Walk every participant flow."
        description="Interactive previews use the same React components as the live product. Submissions are disabled, and test recordings are discarded after upload."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-western-300 hover:shadow-lg"
          >
            <h2 className="font-black text-slate-950 group-hover:text-western-800">
              {card.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {card.description}
            </p>
            <div className="mt-5 text-xs font-black text-western-700">
              Open preview →
            </div>
          </Link>
        ))}
      </div>
    </PublicShell>
  );
}
