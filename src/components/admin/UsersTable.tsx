interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
}

interface UsersTableProps {
  users: UserProfile[];
}

const UsersTable = ({ users }: UsersTableProps) => {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">אימייל</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם מלא</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">תאריך הצטרפות</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center py-8 text-muted-foreground">
                  אין משתמשים רשומים
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-foreground">{u.email || "—"}</td>
                  <td className="px-4 py-3 text-foreground">{u.full_name || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(u.created_at).toLocaleDateString("he-IL")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UsersTable;
