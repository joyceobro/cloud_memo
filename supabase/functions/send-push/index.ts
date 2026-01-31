import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const record = body.record;

    if (!record?.content || !record?.user_id) {
      return new Response("Invalid payload", { status: 400 });
    }

    // 1️⃣ 환경변수
    const sa = JSON.parse(
      Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!
    );

    // 2️⃣ JWT 생성 (OAuth2)
    const jwt = await create(
      { alg: "RS256", typ: "JWT" },
      {
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        exp: getNumericDate(60 * 60),
        iat: getNumericDate(0),
      },
      sa.private_key
    );

    // 3️⃣ Access Token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    const { access_token } = await tokenRes.json();

    // 4️⃣ FCM Push
    const fcmRes = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            topic: record.user_id, // 또는 token
            notification: {
              title: "새 메모",
              body: record.content.slice(0, 100),
            },
          },
        }),
      }
    );

    const result = await fcmRes.json();
    return Response.json(result);
  } catch (e) {
    console.error(e);
    return new Response("FCM error", { status: 500 });
  }
});
