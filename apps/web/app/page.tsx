import { IntakeForm } from "@/features/intake-form";
import { ProjectList } from "@/features/project-list";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
      <IntakeForm />
      <ProjectList />
    </div>
  );
}
