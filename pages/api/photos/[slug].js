import { handleUpload } from "@vercel/blob/client";
import { del } from "@vercel/blob";
import { Redis } from "@upstash/redis";
import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { canViewBoat, norm } from "../../../lib/owners";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
  automaticDeserialization: false,
});

const KEY = (slug) => `hara-photos:${slug}`;

async function getPhotos(slug) {
  const v = await redis.get(KEY(slug));
  if (!v) return [];
  try { return JSON.parse(v); } catch { return []; }
}
async function setPhotos(slug, list) {
  await redis.set(KEY(slug), JSON.stringify(list));
}

export default async function handler(req, res) {
  const slug = norm(req.query.slug);
  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  const email = session?.email;
  const allowed = !!email && canViewBoat(email, slug);

  if (req.method === "GET") {
    if (!allowed) return res.status(403).json({ error: "forbidden" });
    return res.status(200).json({ photos: await getPhotos(slug) });
  }

  if (req.method === "DELETE") {
    if (!allowed) return res.status(403).json({ error: "forbidden" });
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "url required" });
    const list = await getPhotos(slug);
    if (!list.some((p) => p.url === url)) {
      return res.status(404).json({ error: "not found" });
    }
    try { await del(url); } catch (e) { /* ignore – still drop from index */ }
    await setPhotos(slug, list.filter((p) => p.url !== url));
    return res.status(200).json({ ok: true });
  }

  if (req.method === "POST") {
    const body = req.body || {};

    // Client confirmation after a successful blob upload (works in dev,
    // and is idempotent with the onUploadCompleted webhook in prod).
    if (body.action === "register") {
      if (!allowed) return res.status(403).json({ error: "forbidden" });
      if (!body.url || !body.pathname) {
        return res.status(400).json({ error: "url and pathname required" });
      }
      const list = await getPhotos(slug);
      if (!list.some((p) => p.url === body.url)) {
        list.unshift({
          url: body.url,
          pathname: body.pathname,
          contentType: body.contentType || null,
          uploadedAt: Date.now(),
          uploadedBy: email,
        });
        await setPhotos(slug, list);
      }
      return res.status(200).json({ ok: true });
    }

    // Otherwise treat as a Vercel Blob client-upload token request.
    try {
      const jsonResponse = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (/* pathname, clientPayload */) => {
          if (!allowed) throw new Error("Unauthorized");
          return {
            allowedContentTypes: [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/heic",
              "image/heif",
            ],
            maximumSizeInBytes: 25 * 1024 * 1024, // 25 MB
            tokenPayload: JSON.stringify({ slug, email }),
          };
        },
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          try {
            const { slug: s, email: e } = JSON.parse(tokenPayload || "{}");
            if (!s) return;
            const list = await getPhotos(s);
            if (!list.some((p) => p.url === blob.url)) {
              list.unshift({
                url: blob.url,
                pathname: blob.pathname,
                contentType: blob.contentType || null,
                uploadedAt: Date.now(),
                uploadedBy: e || null,
              });
              await setPhotos(s, list);
            }
          } catch (e) {
            console.error("photos onUploadCompleted failed", e);
          }
        },
      });
      return res.status(200).json(jsonResponse);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "method not allowed" });
}
