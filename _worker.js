export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      return new Response(
        JSON.stringify({
          url: env.SUPABASE_URL,
          key: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY,
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        }
      );
    }

    return env.ASSETS.fetch(request);
  },
};
