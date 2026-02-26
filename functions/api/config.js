export async function onRequestGet({ env }) {
  return new Response(
    JSON.stringify({
      url: env.SUPABASE_URL,
      key: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY,
    }),
    { headers: { "content-type": "application/json; charset=utf-8" } }
  );
}
