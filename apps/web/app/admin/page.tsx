import { redirect } from "next/navigation";

/** The admin's start page: the accounts, until the overview comes (AND-353, second part). */
export default function AdminPage() {
  redirect("/admin/accounts");
}
