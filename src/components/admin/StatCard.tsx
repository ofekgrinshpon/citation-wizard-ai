interface StatCardProps {
  icon: string;
  label: string;
  value: number;
  color?: string;
}

const StatCard = ({ icon, label, value, color }: StatCardProps) => {
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="text-muted-foreground text-xs">{label}</p>
          <p className={`text-2xl font-bold ${color || "text-foreground"}`}>{value}</p>
        </div>
      </div>
    </div>
  );
};

export default StatCard;
