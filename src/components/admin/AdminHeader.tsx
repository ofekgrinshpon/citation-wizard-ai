import { useNavigate } from "react-router-dom";

interface AdminHeaderProps {
  email?: string;
  onSignOut: () => void;
}

const AdminHeader = ({ email, onSignOut }: AdminHeaderProps) => {
  const navigate = useNavigate();

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shadow-sm">
      <div className="flex items-center gap-3">
        <div className="text-2xl">🏛</div>
        <div>
          <h1 className="text-foreground text-lg font-bold">פאנל ניהול</h1>
          <p className="text-muted-foreground text-xs">{email}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/app")}
          className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg transition-colors"
        >
          ← חזור לאפליקציה
        </button>
        <button
          onClick={onSignOut}
          className="text-sm text-destructive hover:bg-destructive/10 px-3 py-1.5 rounded-lg transition-colors"
        >
          התנתק
        </button>
      </div>
    </header>
  );
};

export default AdminHeader;
