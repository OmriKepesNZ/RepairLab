import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Admin function is not configured." }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign-in is required." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: roleRow, error: roleError } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (roleError) return json({ error: "Could not verify administrator access." }, 500);
  if (roleRow?.role !== "admin") return json({ error: "Administrator access is required." }, 403);

  const body = await req.json().catch(() => ({}));
  if (body.action === "list") {
    const [{ data: userData, error: usersError }, { data: roleRows, error: rolesError }] = await Promise.all([
      service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      service.from("user_roles").select("user_id, role"),
    ]);
    if (usersError || rolesError) return json({ error: "Could not load user accounts." }, 500);

    const roles = new Map((roleRows ?? []).map((row) => [row.user_id, row.role]));
    return json({ users: userData.users.map((user) => ({
      id: user.id,
      email: user.email ?? "",
      name: typeof user.user_metadata?.name === "string" ? user.user_metadata.name : "",
      role: roles.get(user.id) ?? "staff",
    })) });
  }

  if (body.action === "create") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role === "admin" ? "admin" : body.role === "staff" ? "staff" : "";
    if (!name || !email || !password || !role) return json({ error: "Name, email, password, and role are required." }, 400);
    if (password.length < 8) return json({ error: "Use a password with at least 8 characters." }, 400);

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (createError || !created.user) return json({ error: createError?.message ?? "Could not create the account." }, 400);

    const { error: assignmentError } = await service.from("user_roles").insert({ user_id: created.user.id, role });
    if (assignmentError) {
      await service.auth.admin.deleteUser(created.user.id);
      return json({ error: "The account could not be assigned its access level." }, 500);
    }

    return json({ user: { id: created.user.id, email, name, role } }, 201);
  }

  return json({ error: "Unknown admin action." }, 400);
});