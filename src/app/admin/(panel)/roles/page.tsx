"use client";
import { Badge } from "@/components/ui/badge";
import { ResourcePage } from "@/components/admin/resource-page";

interface Role { _id: string; name: string; slug: string; permissions: string[]; isSystem?: boolean }

export default function RolesPage() {
  return (
    <ResourcePage<Role>
      resource="roles"
      title="Roles & permissions"
      subtitle="System roles (admin/manager/staff) can be edited but not deleted or renamed."
      columns={[
        { key: "name", label: "Role", render: (r) => <span className="font-medium">{r.name}{r.isSystem && <Badge tone="muted" className="ml-2">system</Badge>}</span> },
        { key: "slug", label: "Slug", className: "font-mono text-xs" },
        { key: "permissions", label: "Permissions", render: (r) => <span className="text-xs text-muted">{r.permissions.length} granted</span> },
      ]}
      fields={[
        { name: "name", label: "Name", type: "text", required: true },
        { name: "slug", label: "Slug", type: "text", required: true },
        { name: "permissions", label: "Permissions", type: "permissions" },
      ]}
      defaults={{ permissions: [] }}
    />
  );
}
