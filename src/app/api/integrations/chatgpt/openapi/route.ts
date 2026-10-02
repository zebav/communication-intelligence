import { NextResponse, type NextRequest } from "next/server";

export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Solvani ChatGPT Integration",
      version: "1.0.0",
      description: "Owner-authorized actions for Solvani contacts and conversation intelligence.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/integrations/chatgpt/contact-avatar": {
        post: {
          operationId: "setContactAvatar",
          summary: "Set a Solvani contact avatar",
          description: "Stores a user-provided contact image in Solvani's private vault and sets it as the verified avatar for the specified contact.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    personId: { type: "string", format: "uuid", description: "Preferred stable Solvani person ID." },
                    participantName: { type: "string", description: "Exact contact display name when personId is unavailable." },
                    imageBase64: { type: "string", description: "Raw base64 image bytes or a data URL." },
                    mimeType: { type: "string", enum: ["image/jpeg","image/png","image/webp","image/heic","image/heif"] },
                    filename: { type: "string" }
                  },
                  required: ["imageBase64","mimeType"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Avatar saved",
              content: { "application/json": { schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  personId: { type: "string", format: "uuid" },
                  assetId: { type: "string", format: "uuid" },
                  storageBucket: { type: "string" },
                  storagePath: { type: "string" }
                },
                required: ["ok","personId","assetId"]
              } } }
            },
            "401": { description: "Unauthorized" },
            "404": { description: "Contact not found" },
            "409": { description: "Ambiguous contact name" }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" }
      }
    }
  });
}
