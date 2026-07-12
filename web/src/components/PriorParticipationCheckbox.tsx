import { Checkbox } from "./ui/checkbox";

export function PriorParticipationCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`mt-6 flex cursor-pointer items-center gap-3 rounded-2xl border p-4 text-sm font-bold transition-colors ${
        checked
          ? "border-western-400 bg-western-50 text-western-950 shadow-sm dark:border-western-500 dark:bg-western-950/40 dark:text-western-100"
          : "border-slate-300 bg-slate-50 text-slate-800 hover:border-western-300 hover:bg-western-50/60 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:border-western-600 dark:hover:bg-western-950/25"
      }`}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="size-5 border-2 border-slate-500 bg-white data-[state=checked]:border-western-700 data-[state=checked]:bg-western-700 dark:border-slate-400 dark:bg-slate-950 dark:data-[state=checked]:border-western-400 dark:data-[state=checked]:bg-western-500"
      />
      <span>{label}</span>
    </label>
  );
}
