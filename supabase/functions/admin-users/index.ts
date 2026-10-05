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
    if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      return json({ error: "Use at least 8 characters, including uppercase, lowercase, a number, and a symbol." }, 400);
    }

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
      app_metadata: { must_change_password: true },
    });
    if (createError || !created.user) return json({ error: createError?.message ?? "Could not create the account." }, 400);

    const { error: assignmentError } = await service.from("user_roles").insert({ user_id: created.user.id, role });
    if (assignmentError) {
      await service.auth.admin.deleteUser(created.user.id);
      return json({ error: "The account could not be assigned its access level." }, 500);
    }

    return json({ user: { id: created.user.id, email, name, role } }, 201);
  }

  if (body.action === "role") {
    const userId = typeof body.userId === "string" ? body.userId : "";
    const role = body.role === "admin" || body.role === "staff" ? body.role : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) || !role) {
      return json({ error: "A valid user and access level are required." }, 400);
    }
    if (userId === authData.user.id && role !== "admin") {
      return json({ error: "You cannot remove your own administrator access." }, 409);
    }

    const { data: currentRole, error: currentRoleError } = await service
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    if (currentRoleError) return json({ error: "Could not verify the current access level." }, 500);
    if (currentRole?.role === "admin" && role === "staff") {
      const { count, error: countError } = await service
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin");
      if (countError) return json({ error: "Could not verify the administrator count." }, 500);
      if ((count ?? 0) <= 1) return json({ error: "The last administrator cannot be changed to Staff." }, 409);
    }

    const { error: updateError } = await service
      .from("user_roles")
      .upsert({ user_id: userId, role }, { onConflict: "user_id" });
    if (updateError) return json({ error: "Could not update the access level." }, 500);
    return json({ user: { id: userId, role } });
  }

  return json({ error: "Unknown admin action." }, 400);
});